// Chat vocal entre les joueurs d'un salon : WebRTC en maillage (chaque joueur est relié directement
// aux autres, l'audio ne passe jamais par le serveur). Le serveur relaie seulement la signalisation.
//
// Fonctionnement :
//  - rien ne démarre sans action du joueur (bouton micro) : aucun accès au micro par surprise ;
//  - « hello » annonce qu'on est dans la conversation ; le joueur au plus petit numéro envoie l'offre ;
//  - si le micro est refusé ou absent, on peut quand même écouter les autres.

import type { NetClient } from './client';

type Signal = { k: 'hello' } | { k: 'bye' } | { k: 'offer'; sdp: string } | { k: 'answer'; sdp: string } | { k: 'ice'; c: RTCIceCandidateInit };

interface Peer {
  slot: number;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  offered: boolean;
  pendingIce: RTCIceCandidateInit[];
  analyser?: AnalyserNode;
  level: number;
}

const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

/** off : pas dans la conversation · listen : écoute seule · ptt : appuyer-parler, en attente · talk : on parle (appuyé) · on / muted : micro ouvert actif / coupé */
export type VoiceState = 'off' | 'listen' | 'ptt' | 'talk' | 'on' | 'muted';
export type VoiceMode = 'ptt' | 'open';

export class VoiceChat {
  private net: NetClient | null = null;
  private mySlot = -1;
  private roster: number[] = [];
  private stream: MediaStream | null = null;
  private peers = new Map<number, Peer>();
  private told = new Set<number>();
  private ctx: AudioContext | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private localLevel = 0;
  private timer = 0;
  private joined = false;
  muted = false;
  mode: VoiceMode = 'ptt';
  private talking = false;
  volume = 1;
  /** joueurs qui parlent en ce moment (pour l'affichage) */
  speaking = new Set<number>();
  onChange: (() => void) | null = null;
  lastError = '';

  get state(): VoiceState {
    if (!this.joined) return 'off';
    if (!this.stream) return 'listen';
    if (this.mode === 'ptt') return this.talking ? 'talk' : 'ptt';
    return this.muted ? 'muted' : 'on';
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }
  static secure(): boolean {
    return window.isSecureContext;
  }

  /** (Re)branche le client réseau, par exemple après une reconnexion : on ré-annonce notre présence. */
  attach(net: NetClient | null): void {
    this.net = net;
    if (net) {
      net.on('rtc', (m) => { if (m.t === 'rtc') void this.onSignal(m.from, m.data); });
      if (this.joined) this.announce();
    }
  }

  setRoster(mySlot: number, slots: number[]): void {
    this.mySlot = mySlot;
    this.roster = slots.filter((s) => s !== mySlot);
    // un joueur parti : on ferme sa connexion
    for (const s of [...this.peers.keys()]) if (!this.roster.includes(s)) this.closePeer(s);
    if (this.joined) this.announce();
  }

  /** Rejoint la conversation : demande le micro (si refusé, on écoute seulement). */
  async join(): Promise<void> {
    if (this.joined) return;
    this.lastError = '';
    if (!VoiceChat.supported()) {
      this.lastError = VoiceChat.secure() ? 'Ton navigateur ne gère pas le chat vocal.' : 'Le micro demande une connexion sécurisée (https). Utilise l\'adresse https du jeu.';
    } else {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      } catch (e) {
        this.stream = null;
        this.lastError = (e as DOMException)?.name === 'NotAllowedError' ? 'Micro refusé : tu entends les autres mais ils ne t\'entendent pas.' : 'Micro introuvable : tu entends les autres.';
      }
    }
    this.joined = true;
    this.muted = false;
    this.talking = false;
    this.applyTrack(); // en appuyer-parler, le micro démarre coupé
    this.ensureCtx();
    if (this.stream && this.ctx) {
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.localAnalyser = this.ctx.createAnalyser();
      this.localAnalyser.fftSize = 512;
      src.connect(this.localAnalyser);
    }
    this.timer = window.setInterval(() => this.measure(), 120);
    this.announce();
    this.onChange?.();
  }

  leave(): void {
    if (!this.joined) return;
    for (const s of this.roster) this.send(s, { k: 'bye' });
    for (const s of [...this.peers.keys()]) this.closePeer(s);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.localAnalyser = null;
    this.told.clear();
    this.joined = false;
    this.muted = false;
    clearInterval(this.timer);
    this.speaking.clear();
    this.onChange?.();
  }

  /** Le micro n'émet que si : mode ouvert et non coupé, ou mode appuyer-parler et touche tenue. */
  private applyTrack(): void {
    if (!this.stream) return;
    const on = this.mode === 'open' ? !this.muted : this.talking;
    for (const t of this.stream.getAudioTracks()) t.enabled = on;
  }

  toggleMute(): void {
    if (!this.stream || this.mode !== 'open') return;
    this.muted = !this.muted;
    this.applyTrack();
    this.onChange?.();
  }

  /** Appuyer-parler : à appeler avec l'état de la touche / du bouton (sans effet en mode micro ouvert). */
  setTalking(on: boolean): void {
    if (on === this.talking) return;
    this.talking = on;
    if (this.mode === 'ptt') { this.applyTrack(); this.onChange?.(); }
  }

  setMode(mode: VoiceMode): void {
    this.mode = mode;
    this.talking = false;
    this.muted = false;
    this.applyTrack();
    this.onChange?.();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    for (const p of this.peers.values()) p.audio.volume = this.volume;
  }

  connectedCount(): number {
    let n = 0;
    for (const p of this.peers.values()) if (p.pc.connectionState === 'connected') n++;
    return n;
  }

  // ------------------------------------------------------------------ interne
  private ensureCtx(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch { this.ctx = null; }
  }

  private send(to: number, s: Signal): void {
    this.net?.send({ t: 'rtc', to, data: JSON.stringify(s) });
  }

  private announce(): void {
    for (const s of this.roster) this.send(s, { k: 'hello' });
  }

  private makePeer(slot: number): Peer {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    (audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    audio.volume = this.volume;
    audio.style.display = 'none';
    document.body.appendChild(audio);
    const peer: Peer = { slot, pc, audio, offered: false, pendingIce: [], level: 0 };
    pc.onicecandidate = (e) => { if (e.candidate) this.send(slot, { k: 'ice', c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      void audio.play().catch(() => { /* lecture bloquée jusqu'à une interaction : le bouton micro en est une */ });
      this.ensureCtx();
      if (this.ctx && !peer.analyser) {
        try {
          const src = this.ctx.createMediaStreamSource(audio.srcObject as MediaStream);
          peer.analyser = this.ctx.createAnalyser();
          peer.analyser.fftSize = 512;
          src.connect(peer.analyser);
        } catch { /* mesure du niveau indisponible : pas d'indicateur de voix, l'audio marche quand même */ }
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.closePeer(slot);
      this.onChange?.();
    };
    this.peers.set(slot, peer);
    return peer;
  }

  private closePeer(slot: number): void {
    const p = this.peers.get(slot);
    if (!p) return;
    this.peers.delete(slot);
    this.told.delete(slot);
    try { p.pc.close(); } catch { /* ignore */ }
    p.audio.srcObject = null;
    p.audio.remove();
    this.speaking.delete(slot);
    this.onChange?.();
  }

  private async onSignal(from: number, raw: string): Promise<void> {
    if (!this.joined) return; // personne n'est écouté tant qu'on n'a pas rejoint
    let s: Signal;
    try { s = JSON.parse(raw) as Signal; } catch { return; }
    if (s.k === 'bye') { this.closePeer(from); return; }
    if (s.k === 'hello') {
      let peer = this.peers.get(from);
      // connexion cassée d'un joueur qui revient : on repart de zéro
      if (peer && (peer.pc.connectionState === 'failed' || peer.pc.connectionState === 'disconnected' || peer.pc.connectionState === 'closed')) { this.closePeer(from); peer = undefined; }
      if (!this.told.has(from)) { this.told.add(from); this.send(from, { k: 'hello' }); }
      if (!peer && this.mySlot < from) {
        peer = this.makePeer(from);
        await this.offer(peer);
      }
      return;
    }
    let peer = this.peers.get(from);
    if (s.k === 'offer') {
      if (peer) this.closePeer(from);
      peer = this.makePeer(from);
      await peer.pc.setRemoteDescription({ type: 'offer', sdp: s.sdp });
      const tr = peer.pc.getTransceivers()[0];
      if (tr) {
        tr.direction = 'sendrecv';
        const track = this.stream?.getAudioTracks()[0] ?? null;
        if (track) await tr.sender.replaceTrack(track);
      }
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      const ans = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(ans);
      this.send(from, { k: 'answer', sdp: ans.sdp ?? '' });
      return;
    }
    if (!peer) return;
    if (s.k === 'answer') {
      await peer.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp }).catch(() => {});
      for (const c of peer.pendingIce.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
    } else if (s.k === 'ice') {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(s.c).catch(() => {});
      else peer.pendingIce.push(s.c);
    }
  }

  private async offer(peer: Peer): Promise<void> {
    peer.offered = true;
    const track = this.stream?.getAudioTracks()[0];
    if (track) peer.pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.stream!] });
    else peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
    const off = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(off);
    this.send(peer.slot, { k: 'offer', sdp: off.sdp ?? '' });
  }

  private levelOf(a: AnalyserNode | undefined | null): number {
    if (!a) return 0;
    const buf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
    return Math.sqrt(sum / buf.length);
  }

  /** Détecte qui parle (niveau sonore) toutes les ~120 ms. */
  private measure(): void {
    const before = [...this.speaking].sort().join(',');
    this.speaking.clear();
    this.localLevel = (this.mode === 'open' ? this.muted : !this.talking) ? 0 : this.levelOf(this.localAnalyser);
    if (this.localLevel > 0.04 && this.mySlot >= 0) this.speaking.add(this.mySlot);
    for (const p of this.peers.values()) {
      p.level = this.levelOf(p.analyser);
      if (p.level > 0.03) this.speaking.add(p.slot);
    }
    if ([...this.speaking].sort().join(',') !== before) this.onChange?.();
  }
}
