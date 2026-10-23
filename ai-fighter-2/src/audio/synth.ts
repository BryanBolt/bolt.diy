// Synthèse audio procédurale (WebAudio) : aucun fichier son, tout est généré.
import { loadSettings } from '../core/storage';

export class Synth {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxGain: GainNode | null = null;
  musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private musicTimer = 0;
  private musicStep = 0;
  private musicTheme = 'menu';
  private musicOn = false;
  private lastPlay = new Map<string, number>();

  /** À appeler lors d'une interaction utilisateur (politique d'autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.sfxGain = c.createGain();
    this.sfxGain.connect(this.master);
    this.musicGain = c.createGain();
    this.musicGain.connect(this.master);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    this.master.disconnect();
    this.master.connect(comp);
    comp.connect(c.destination);
    this.applyVolume();
    // bruit blanc partagé
    const len = c.sampleRate * 1;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  applyVolume(): void {
    const s = loadSettings();
    if (this.sfxGain) this.sfxGain.gain.value = s.volume * 0.9;
    if (this.musicGain) this.musicGain.gain.value = s.music * 0.35;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0, dest?: AudioNode): void {
    if (!this.ctx || !this.sfxGain) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t0 = c.currentTime + delay;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(dest ?? this.sfxGain);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number, filterFreq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.sfxGain || !this.noiseBuf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = c.createGain();
    const t0 = c.currentTime + delay;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxGain);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.02);
  }

  play(id: string, pan = 0): void {
    if (!this.ctx) return;
    void pan;
    // anti-spam : même son max toutes les 30 ms
    const now = performance.now();
    const last = this.lastPlay.get(id) ?? 0;
    if (now - last < 30) return;
    this.lastPlay.set(id, now);
    switch (id) {
      case 'hit': this.noise(0.08, 0.5, 900, 1.5); this.tone(180, 0.08, 'square', 0.25, -120); break;
      case 'hitheavy': this.noise(0.14, 0.7, 500, 1); this.tone(110, 0.16, 'square', 0.35, -80); this.tone(60, 0.2, 'sine', 0.5, -30); break;
      case 'superhit': this.noise(0.25, 0.8, 400, 0.8); this.tone(90, 0.3, 'sawtooth', 0.4, -60); this.tone(45, 0.35, 'sine', 0.6); break;
      case 'block': this.tone(900, 0.06, 'square', 0.15, -300); this.noise(0.05, 0.3, 2500, 3); break;
      case 'parry': this.tone(1200, 0.25, 'sine', 0.3, 900); this.tone(1800, 0.2, 'triangle', 0.2, 600, 0.03); this.noise(0.1, 0.3, 4000, 2); break;
      case 'guardbreak': this.noise(0.3, 0.6, 1500, 0.7); this.tone(300, 0.3, 'sawtooth', 0.3, -250); break;
      case 'whoosh': this.noise(0.09, 0.18, 1200, 0.8); break;
      case 'whoosh2': this.noise(0.14, 0.28, 700, 0.8); break;
      case 'jump': this.tone(300, 0.12, 'triangle', 0.15, 250); break;
      case 'land': this.noise(0.08, 0.3, 300, 1); this.tone(70, 0.1, 'sine', 0.3, -30); break;
      case 'dodge': this.noise(0.12, 0.2, 2000, 0.6); this.tone(500, 0.1, 'sine', 0.08, 300); break;
      case 'kishot': this.tone(600, 0.18, 'sawtooth', 0.15, -300); this.noise(0.1, 0.2, 3000, 1); break;
      case 'shuriken': this.noise(0.1, 0.25, 5000, 2); this.tone(2400, 0.08, 'square', 0.06, -800); break;
      case 'shock': this.noise(0.3, 0.5, 250, 0.6); this.tone(50, 0.35, 'sine', 0.6, -20); break;
      case 'clash': this.tone(1500, 0.1, 'square', 0.12, -700); this.noise(0.1, 0.4, 3500, 2); break;
      case 'superstart': this.tone(80, 0.6, 'sawtooth', 0.3, 400); this.tone(160, 0.6, 'square', 0.15, 500); this.noise(0.5, 0.3, 800, 0.5); break;
      case 'ko': this.noise(0.4, 0.8, 600, 0.6); this.tone(200, 0.5, 'sawtooth', 0.4, -170); this.tone(50, 0.6, 'sine', 0.7, -20); break;
      case 'pickup': this.tone(880, 0.08, 'square', 0.12); this.tone(1320, 0.12, 'square', 0.12, 0, 0.07); break;
      case 'crate': this.noise(0.08, 0.4, 700, 1); break;
      case 'cratebreak': this.noise(0.2, 0.5, 500, 0.8); this.tone(200, 0.1, 'square', 0.1, -100); break;
      case 'ui': this.tone(700, 0.05, 'square', 0.08); break;
      case 'confirm': this.tone(600, 0.08, 'square', 0.12); this.tone(900, 0.12, 'square', 0.12, 0, 0.06); break;
      case 'deny': this.tone(200, 0.12, 'square', 0.12, -60); break;
      case 'pause': this.tone(500, 0.1, 'triangle', 0.15, -200); break;
      case 'unpause': this.tone(300, 0.1, 'triangle', 0.15, 200); break;
      case 'wave': this.tone(220, 0.2, 'sawtooth', 0.15, 110); this.tone(330, 0.25, 'sawtooth', 0.12, 110, 0.1); break;
      case 'boss': for (let i = 0; i < 3; i++) this.tone(55 * (i + 1), 0.6, 'sawtooth', 0.2, -10, i * 0.15); this.noise(0.8, 0.3, 200, 0.5); break;
      case 'waveclear': [523, 659, 784].forEach((f, i) => this.tone(f, 0.2, 'square', 0.12, 0, i * 0.08)); break;
      case 'go': this.tone(440, 0.1, 'square', 0.15); this.tone(880, 0.25, 'square', 0.15, 0, 0.1); break;
      case 'stageclear': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, 0, i * 0.12)); break;
      case 'victory': [392, 523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.18, 0, i * 0.14)); break;
      case 'gameover': [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.15, 0, i * 0.3)); break;
      case 'respawn': this.tone(300, 0.3, 'sine', 0.2, 600); break;
      case 'revive': [440, 554, 659].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.15, 0, i * 0.1)); break;
      default: break;
    }
  }

  // ---- musique : boucle procédurale par thème ----
  startMusic(theme: string): void {
    this.musicTheme = theme;
    this.musicOn = true;
    this.musicStep = 0;
  }
  stopMusic(): void {
    this.musicOn = false;
  }

  private static SCALES: Record<string, { bpm: number; root: number; scale: number[]; bass: number[]; drums: boolean }> = {
    menu: { bpm: 96, root: 55, scale: [0, 3, 5, 7, 10], bass: [0, 0, 7, 5], drums: false },
    dojo: { bpm: 120, root: 49, scale: [0, 2, 5, 7, 9], bass: [0, 0, 5, 7], drums: true },
    neon: { bpm: 138, root: 46.2, scale: [0, 3, 5, 7, 10], bass: [0, 3, 0, 5], drums: true },
    market: { bpm: 126, root: 51.9, scale: [0, 2, 3, 7, 8], bass: [0, 0, 8, 7], drums: true },
    metro: { bpm: 110, root: 43.7, scale: [0, 2, 3, 5, 7], bass: [0, 3, 5, 3], drums: true },
    tower: { bpm: 132, root: 58.3, scale: [0, 2, 4, 7, 9], bass: [0, 4, 7, 4], drums: true },
    core: { bpm: 150, root: 41.2, scale: [0, 1, 5, 6, 10], bass: [0, 1, 0, 6], drums: true },
    arena: { bpm: 140, root: 49, scale: [0, 3, 5, 6, 10], bass: [0, 0, 3, 5], drums: true },
    duel: { bpm: 144, root: 55, scale: [0, 2, 3, 7, 10], bass: [0, 3, 7, 10], drums: true },
  };

  /** À appeler à chaque frame de rendu. */
  tickMusic(now: number): void {
    if (!this.musicOn || !this.ctx || !this.musicGain) return;
    const th = Synth.SCALES[this.musicTheme] ?? Synth.SCALES.menu;
    const stepMs = 60000 / th.bpm / 2; // croches
    if (now < this.musicTimer) return;
    this.musicTimer = now + stepMs;
    const s = this.musicStep++;
    const beat = s % 8;
    const bar = Math.floor(s / 8) % 4;
    const g = this.musicGain;
    // basse
    if (beat % 2 === 0) {
      const semis = th.bass[bar];
      const f = th.root * Math.pow(2, semis / 12);
      this.tone(f, stepMs / 1000 * 1.6, 'sawtooth', 0.35, 0, 0, g);
    }
    // mélodie pseudo-aléatoire mais stable (dépend du pas)
    if ((s * 7 + 3) % 5 < 3) {
      const idx = ((s * 13) >> 2) % th.scale.length;
      const oct = (s % 16) < 8 ? 2 : 3;
      const f = th.root * Math.pow(2, (th.scale[idx] + th.bass[bar]) / 12) * Math.pow(2, oct);
      this.tone(f, stepMs / 1000 * 0.9, 'square', 0.08, 0, 0, g);
    }
    if (th.drums) {
      if (beat === 0 || beat === 4) { this.tone(55, 0.12, 'sine', 0.9, -40, 0, g); }
      if (beat === 2 || beat === 6) this.noiseTo(g, 0.1, 0.35, 1800);
      if (beat % 2 === 1) this.noiseTo(g, 0.03, 0.12, 6000);
    }
  }

  private noiseTo(dest: AudioNode, dur: number, vol: number, freq: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = freq;
    const gn = c.createGain();
    gn.gain.setValueAtTime(vol, c.currentTime);
    gn.gain.exponentialRampToValueAtTime(0.001, c.currentTime + dur);
    src.connect(f);
    f.connect(gn);
    gn.connect(dest);
    src.start(c.currentTime, Math.random() * 0.5);
    src.stop(c.currentTime + dur + 0.02);
  }
}
