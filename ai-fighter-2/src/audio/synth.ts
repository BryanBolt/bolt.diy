// Synthèse audio procédurale (WebAudio) : aucun fichier son.
// - effets : couches bruit + oscillateurs, variation de hauteur et panoramique selon la position
// - musique : séquenceur par thème (accords, basse, lead, arpège, batterie), variante « boss »
import { loadSettings } from '../core/storage';

type Wave = OscillatorType;

interface Song {
  bpm: number;
  root: number; // Hz de la fondamentale (basse)
  chords: number[][]; // 4 accords, en demi-tons depuis root
  scale: number[]; // gamme pour le lead
  bass: number[]; // 16 pas : -1 silence, sinon index dans l'accord (0 fondamentale, 1 tierce, 2 quinte, 3 octave)
  lead: number[]; // 16 pas : -1 silence, sinon degré de la gamme
  leadOct: number;
  arp: boolean;
  kick: string;
  snare: string;
  hat: string;
  bassWave: Wave;
  leadWave: Wave;
  pad: boolean;
  swing: number; // 0..0.3
}

const K = (s: string) => s.replace(/ /g, '');

const SONGS: Record<string, Song> = {
  menu: { bpm: 92, root: 55, chords: [[0, 3, 7, 12], [8, 12, 15, 20], [5, 8, 12, 17], [3, 7, 10, 15]], scale: [0, 3, 5, 7, 10, 12], bass: [0, -1, -1, 0, -1, -1, 2, -1, 0, -1, -1, 0, -1, 3, -1, -1], lead: [-1, -1, 4, -1, -1, 5, -1, -1, -1, 3, -1, -1, 2, -1, -1, -1], leadOct: 3, arp: true, kick: K('x... .... x... ....'), snare: K('.... .... .... ....'), hat: K('..x. ..x. ..x. ..x.'), bassWave: 'triangle', leadWave: 'sine', pad: true, swing: 0 },
  dojo: { bpm: 124, root: 49, chords: [[0, 4, 7, 12], [5, 9, 12, 17], [7, 11, 14, 19], [0, 4, 7, 12]], scale: [0, 2, 4, 7, 9, 12, 14], bass: [0, 0, -1, 0, -1, 2, 0, -1, 0, 0, -1, 0, 3, -1, 2, -1], lead: [0, -1, 2, 4, -1, 5, 4, -1, 2, -1, 4, -1, 6, 5, 4, 2], leadOct: 3, arp: false, kick: K('x... x... x... x..x'), snare: K('.... x... .... x...'), hat: K('x.x. x.x. x.x. x.xx'), bassWave: 'square', leadWave: 'square', pad: false, swing: 0.1 },
  neon: { bpm: 140, root: 46.2, chords: [[0, 3, 7, 10], [0, 3, 7, 10], [5, 8, 12, 15], [3, 7, 10, 14]], scale: [0, 3, 5, 6, 7, 10, 12], bass: [0, 0, 3, 0, 0, 3, 0, 2, 0, 0, 3, 0, 0, 2, 3, 2], lead: [-1, 0, -1, 2, -1, 3, 4, -1, -1, 5, -1, 4, -1, 2, -1, -1], leadOct: 3, arp: true, kick: K('x... x... x... x...'), snare: K('.... x... .... x..x'), hat: K('x.xx x.xx x.xx x.xx'), bassWave: 'sawtooth', leadWave: 'square', pad: true, swing: 0 },
  market: { bpm: 128, root: 51.9, chords: [[0, 3, 7, 12], [0, 3, 7, 12], [8, 12, 15, 20], [7, 10, 14, 19]], scale: [0, 2, 3, 7, 8, 12, 14], bass: [0, -1, 0, 3, -1, 0, -1, 2, 0, -1, 0, 3, -1, 0, 2, -1], lead: [0, 2, 3, -1, 2, 0, -1, -1, 3, 4, 3, -1, 2, -1, 0, -1], leadOct: 3, arp: false, kick: K('x..x ..x. x..x ..x.'), snare: K('.... x... .... x...'), hat: K('..x. ..x. ..x. ..x.'), bassWave: 'triangle', leadWave: 'triangle', pad: true, swing: 0.15 },
  metro: { bpm: 112, root: 43.7, chords: [[0, 3, 7, 12], [3, 7, 10, 15], [5, 8, 12, 17], [2, 5, 9, 14]], scale: [0, 2, 3, 5, 7, 10, 12], bass: [0, -1, -1, 0, -1, -1, 0, -1, 3, -1, -1, 0, -1, 2, -1, -1], lead: [-1, -1, -1, 0, -1, -1, 2, -1, -1, -1, 3, -1, -1, 2, -1, 0], leadOct: 2, arp: true, kick: K('x... .... x.x. ....'), snare: K('.... x... .... x...'), hat: K('x.x. x.x. x.x. x.x.'), bassWave: 'sawtooth', leadWave: 'sine', pad: true, swing: 0 },
  tower: { bpm: 134, root: 58.3, chords: [[0, 4, 7, 11], [9, 12, 16, 19], [5, 9, 12, 16], [7, 11, 14, 17]], scale: [0, 2, 4, 5, 7, 9, 11, 12], bass: [0, -1, 0, -1, 2, -1, 0, 3, 0, -1, 0, -1, 2, -1, 3, 2], lead: [0, -1, 4, -1, 7, -1, 4, -1, 2, -1, 5, -1, 4, 2, 0, -1], leadOct: 3, arp: true, kick: K('x... x... x... x...'), snare: K('.... x... .... x...'), hat: K('x.x. x.x. x.x. x.x.'), bassWave: 'square', leadWave: 'triangle', pad: true, swing: 0.05 },
  core: { bpm: 152, root: 41.2, chords: [[0, 1, 7, 12], [0, 1, 7, 12], [6, 7, 13, 18], [5, 6, 12, 17]], scale: [0, 1, 5, 6, 7, 10, 12], bass: [0, 0, 0, -1, 0, 0, 3, -1, 0, 0, 0, -1, 2, 0, 1, -1], lead: [0, -1, 1, -1, 0, -1, 5, 6, -1, 5, -1, 1, 0, -1, -1, 2], leadOct: 3, arp: true, kick: K('x... x... x... x.x.'), snare: K('.... x... ..x. x...'), hat: K('xxxx xxxx xxxx xxxx'), bassWave: 'sawtooth', leadWave: 'sawtooth', pad: true, swing: 0 },
  arena: { bpm: 142, root: 49, chords: [[0, 3, 7, 12], [0, 3, 7, 12], [6, 10, 13, 18], [5, 8, 12, 17]], scale: [0, 3, 5, 6, 7, 10, 12], bass: [0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 3, 0, 2, 2, 1, 1], lead: [0, -1, -1, 3, -1, 4, -1, -1, 0, -1, 2, -1, 1, -1, 0, -1], leadOct: 3, arp: false, kick: K('x..x x..x x..x x.xx'), snare: K('.... x... .... x...'), hat: K('x.x. x.x. x.x. x.x.'), bassWave: 'square', leadWave: 'square', pad: false, swing: 0 },
  duel: { bpm: 146, root: 55, chords: [[0, 3, 7, 12], [10, 14, 17, 22], [8, 12, 15, 20], [7, 10, 14, 19]], scale: [0, 2, 3, 7, 10, 12, 14], bass: [0, 0, -1, 0, 3, -1, 0, -1, 0, 0, -1, 0, 2, -1, 3, 2], lead: [0, -1, 3, -1, 4, -1, 3, 2, 0, -1, 4, -1, 5, 4, 3, -1], leadOct: 3, arp: true, kick: K('x... x... x... x..x'), snare: K('.... x... .... x...'), hat: K('x.xx x.xx x.xx x.xx'), bassWave: 'sawtooth', leadWave: 'square', pad: true, swing: 0 },
};

export class Synth {
  ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private lastPlay = new Map<string, number>();
  // musique
  private song: Song | null = null;
  private songName = '';
  private step = 0;
  private nextStepTime = 0;
  intensity = 0; // 0 normal, 1 boss / furie

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
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    comp.connect(c.destination);
    this.sfxGain = c.createGain();
    this.sfxGain.connect(comp);
    this.musicGain = c.createGain();
    this.musicGain.connect(comp);
    this.applyVolume();
    const len = c.sampleRate * 1;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    if (this.songName) this.nextStepTime = c.currentTime + 0.1;
  }

  applyVolume(): void {
    const s = loadSettings();
    if (this.sfxGain) this.sfxGain.gain.value = s.volume * 0.9;
    if (this.musicGain) this.musicGain.gain.value = s.music * 0.3;
  }

  // ------------------------------------------------------------ primitives
  private out(pan: number, dest?: AudioNode): AudioNode {
    const c = this.ctx!;
    const target = dest ?? this.sfxGain!;
    if (!pan || !c.createStereoPanner) return target;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(target);
    return p;
  }

  private tone(freq: number, dur: number, type: Wave, vol: number, slide = 0, delay = 0, dest?: AudioNode, at?: number): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    const t0 = (at ?? c.currentTime) + delay;
    o.frequency.setValueAtTime(Math.max(20, freq), t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(dest ?? this.sfxGain!);
    o.start(t0);
    o.stop(t0 + dur + 0.03);
  }

  private noise(dur: number, vol: number, freq: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass', dest?: AudioNode, at?: number): void {
    if (!this.ctx || !this.noiseBuf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    const t0 = (at ?? c.currentTime) + delay;
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest ?? this.sfxGain!);
    src.start(t0, Math.random() * 0.5);
    src.stop(t0 + dur + 0.03);
  }

  /** « Grognement » court : sawtooth filtré, type voix. */
  private grunt(base: number, dur: number, vol: number, dest: AudioNode): void {
    if (!this.ctx) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.5;
    f.frequency.setValueAtTime(base * 4, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(base * 2, c.currentTime + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    o.frequency.setValueAtTime(base, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, c.currentTime + dur);
    o.connect(f); f.connect(g); g.connect(dest);
    o.start(); o.stop(c.currentTime + dur + 0.02);
  }

  // ------------------------------------------------------------ effets
  play(id: string, pan = 0): void {
    if (!this.ctx) return;
    const now = performance.now();
    const last = this.lastPlay.get(id) ?? 0;
    if (now - last < 28) return;
    this.lastPlay.set(id, now);
    const v = 1 + (Math.random() - 0.5) * 0.16; // variation de hauteur ±8 %
    const d = this.out(pan);
    const T = (f: number, dur: number, w: Wave, vol: number, slide = 0, delay = 0) => this.tone(f * v, dur, w, vol, slide * v, delay, d);
    const N = (dur: number, vol: number, f: number, q = 1, delay = 0, type: BiquadFilterType = 'bandpass') => this.noise(dur, vol, f * v, q, delay, type, d);
    switch (id) {
      case 'hit': N(0.07, 0.5, 1000, 1.4); T(170, 0.09, 'square', 0.22, -110); this.grunt(120 + Math.random() * 60, 0.12, 0.08, d); break;
      case 'hitheavy': N(0.15, 0.7, 450, 0.9); T(105, 0.18, 'square', 0.35, -75); T(58, 0.22, 'sine', 0.55, -28); this.grunt(100 + Math.random() * 40, 0.2, 0.14, d); break;
      case 'superhit': N(0.28, 0.85, 380, 0.7); T(85, 0.32, 'sawtooth', 0.4, -55); T(42, 0.4, 'sine', 0.65); this.grunt(90, 0.3, 0.18, d); break;
      case 'counter': T(900, 0.12, 'square', 0.18, -500); T(1400, 0.15, 'triangle', 0.14, 400, 0.03); N(0.12, 0.4, 2500, 2); break;
      case 'block': T(880, 0.06, 'square', 0.15, -300); N(0.05, 0.3, 2600, 3); break;
      case 'parry': T(1200, 0.25, 'sine', 0.3, 900); T(1800, 0.2, 'triangle', 0.22, 600, 0.03); N(0.12, 0.35, 4200, 2); break;
      case 'guardbreak': N(0.3, 0.6, 1400, 0.7); T(300, 0.3, 'sawtooth', 0.3, -240); T(120, 0.35, 'square', 0.2, -60, 0.05); break;
      case 'whoosh': N(0.09, 0.16, 1200, 0.8); break;
      case 'whoosh2': N(0.15, 0.28, 650, 0.8); N(0.1, 0.1, 2400, 1, 0.03); break;
      case 'jump': T(280, 0.13, 'triangle', 0.14, 260); break;
      case 'land': N(0.08, 0.3, 280, 1); T(68, 0.1, 'sine', 0.3, -30); break;
      case 'wall': N(0.18, 0.55, 500, 0.8); T(90, 0.22, 'square', 0.3, -50); break;
      case 'dodge': N(0.12, 0.2, 2000, 0.6); T(500, 0.1, 'sine', 0.08, 300); break;
      case 'kishot': T(620, 0.18, 'sawtooth', 0.15, -320); N(0.1, 0.2, 3000, 1); break;
      case 'shuriken': N(0.1, 0.25, 5000, 2); T(2400, 0.08, 'square', 0.06, -800); break;
      case 'shock': N(0.3, 0.5, 240, 0.6); T(48, 0.35, 'sine', 0.6, -18); break;
      case 'clash': T(1500, 0.1, 'square', 0.12, -700); N(0.1, 0.4, 3500, 2); break;
      case 'superstart': T(80, 0.6, 'sawtooth', 0.3, 400); T(160, 0.6, 'square', 0.15, 500); N(0.5, 0.3, 800, 0.5); this.duck(0.8); break;
      case 'ko': N(0.4, 0.8, 600, 0.6); T(200, 0.5, 'sawtooth', 0.4, -170); T(50, 0.6, 'sine', 0.7, -20); this.grunt(80, 0.4, 0.2, d); break;
      case 'pickup': T(880, 0.08, 'square', 0.12); T(1320, 0.12, 'square', 0.12, 0, 0.07); break;
      case 'weapon': T(300, 0.06, 'square', 0.15); T(450, 0.08, 'square', 0.15, 0, 0.06); T(600, 0.12, 'square', 0.15, 0, 0.12); break;
      case 'ak': N(0.07, 0.6, 1800, 0.7); T(150, 0.07, 'square', 0.3, -90); N(0.04, 0.35, 5000, 1.2); break;
      case 'pistol': N(0.11, 0.75, 1400, 0.7); T(110, 0.14, 'square', 0.4, -70); N(0.06, 0.4, 4200, 1.2, 0.01); break;
      case 'throw': N(0.2, 0.3, 900, 0.7); T(400, 0.15, 'triangle', 0.1, -200); break;
      case 'crate': N(0.08, 0.4, 700, 1); break;
      case 'cratebreak': N(0.2, 0.5, 500, 0.8); T(200, 0.1, 'square', 0.1, -100); N(0.15, 0.3, 1800, 1.5, 0.04); break;
      case 'ui': T(700, 0.05, 'square', 0.08); break;
      case 'confirm': T(600, 0.08, 'square', 0.12); T(900, 0.12, 'square', 0.12, 0, 0.06); break;
      case 'deny': T(200, 0.12, 'square', 0.12, -60); break;
      case 'buy': [880, 1100, 1320, 1760].forEach((f, i) => T(f, 0.1, 'square', 0.1, 0, i * 0.05)); break;
      case 'shop': [523, 659, 784, 1047, 784].forEach((f, i) => T(f, 0.18, 'triangle', 0.14, 0, i * 0.1)); break;
      case 'pause': T(500, 0.1, 'triangle', 0.15, -200); break;
      case 'unpause': T(300, 0.1, 'triangle', 0.15, 200); break;
      case 'wave': T(220, 0.2, 'sawtooth', 0.15, 110); T(330, 0.25, 'sawtooth', 0.12, 110, 0.1); break;
      case 'boss': for (let i = 0; i < 3; i++) T(55 * (i + 1), 0.6, 'sawtooth', 0.2, -10, i * 0.15); N(0.8, 0.3, 200, 0.5); this.duck(1.2); break;
      case 'rage': T(60, 0.8, 'sawtooth', 0.35, 30); T(90, 0.8, 'square', 0.2, 60, 0.1); N(1, 0.4, 300, 0.5); this.grunt(70, 0.6, 0.25, d); this.duck(1); break;
      case 'alarm': for (let i = 0; i < 3; i++) { T(900, 0.12, 'square', 0.12, 0, i * 0.25); T(700, 0.12, 'square', 0.12, 0, i * 0.25 + 0.12); } break;
      case 'train': N(1.2, 0.5, 300, 0.4, 0, 'lowpass'); T(70, 1.2, 'sawtooth', 0.25, 20); N(0.5, 0.3, 2500, 0.6, 0.1); break;
      case 'laser': T(1800, 0.5, 'sawtooth', 0.12, -900); N(0.5, 0.25, 4000, 1.5); break;
      case 'barrel': N(0.5, 0.3, 200, 0.6, 0, 'lowpass'); T(90, 0.5, 'triangle', 0.2, -20); break;
      case 'drone': T(440, 0.6, 'sawtooth', 0.08, 60); T(443, 0.6, 'sawtooth', 0.08, 60); break;
      case 'wind': N(1.5, 0.3, 600, 0.3, 0, 'lowpass'); break;
      case 'waveclear': [523, 659, 784].forEach((f, i) => T(f, 0.2, 'square', 0.12, 0, i * 0.08)); break;
      case 'go': T(440, 0.1, 'square', 0.15); T(880, 0.25, 'square', 0.15, 0, 0.1); break;
      case 'stageclear': [523, 659, 784, 1047].forEach((f, i) => T(f, 0.35, 'triangle', 0.18, 0, i * 0.12)); break;
      case 'victory': [392, 523, 659, 784, 1047].forEach((f, i) => T(f, 0.5, 'triangle', 0.18, 0, i * 0.14)); break;
      case 'gameover': [392, 349, 311, 262].forEach((f, i) => T(f, 0.5, 'sawtooth', 0.15, 0, i * 0.3)); break;
      case 'respawn': T(300, 0.3, 'sine', 0.2, 600); break;
      case 'revive': [440, 554, 659].forEach((f, i) => T(f, 0.25, 'triangle', 0.15, 0, i * 0.1)); break;
      default: break;
    }
  }

  /** Baisse brièvement la musique (gros impacts). */
  private duck(sec: number): void {
    if (!this.ctx || !this.musicGain) return;
    const g = this.musicGain.gain;
    const base = loadSettings().music * 0.3;
    const t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    g.setValueAtTime(base * 0.35, t);
    g.linearRampToValueAtTime(base, t + sec);
  }

  // ------------------------------------------------------------ musique
  startMusic(theme: string): void {
    const name = SONGS[theme] ? theme : theme === 'abyss' ? 'tower' : 'dojo';
    if (this.songName === name && this.song) return;
    this.song = SONGS[name];
    this.songName = name;
    this.step = 0;
    if (this.ctx) this.nextStepTime = this.ctx.currentTime + 0.05;
  }
  stopMusic(): void {
    this.song = null;
    this.songName = '';
  }

  /** À appeler à chaque frame de rendu : planifie les pas à venir (anticipation 120 ms). */
  tickMusic(): void {
    if (!this.song || !this.ctx || !this.musicGain) return;
    const c = this.ctx;
    const s = this.song;
    const bpm = s.bpm + (this.intensity > 0.5 ? 8 : 0);
    const stepDur = 60 / bpm / 4; // doubles-croches
    while (this.nextStepTime < c.currentTime + 0.12) {
      this.playStep(this.step, this.nextStepTime, stepDur);
      const swing = this.step % 2 === 1 ? s.swing * stepDur : -s.swing * stepDur;
      this.nextStepTime += stepDur + swing;
      this.step++;
    }
  }

  private playStep(step: number, at: number, stepDur: number): void {
    const s = this.song!;
    const g = this.musicGain!;
    const i = step % 16;
    const bar = Math.floor(step / 16) % 4;
    const chord = s.chords[bar];
    const boss = this.intensity > 0.5;
    const hz = (semi: number, oct = 0) => s.root * Math.pow(2, semi / 12 + oct);
    // basse
    const b = s.bass[i];
    if (b >= 0) {
      const semi = chord[Math.min(b, chord.length - 1)];
      this.tone(hz(semi), stepDur * 1.8, s.bassWave, boss ? 0.42 : 0.34, 0, 0, g, at);
      if (boss) this.tone(hz(semi, 1), stepDur * 1.2, 'square', 0.1, 0, 0, g, at);
    }
    // lead (mélodie) : varie par mesure
    const l = s.lead[(i + bar * 3) % 16];
    if (l >= 0 && (bar !== 1 || i % 2 === 0)) {
      const semi = chord[0] + s.scale[l % s.scale.length] + (l >= s.scale.length ? 12 : 0);
      this.tone(hz(semi, s.leadOct), stepDur * 0.9, s.leadWave, 0.07, 0, 0, g, at);
      if (boss) this.tone(hz(semi, s.leadOct + 1), stepDur * 0.5, 'square', 0.03, 0, 0, g, at);
    }
    // arpège
    if (s.arp && (i % 2 === 1 || boss)) {
      const semi = chord[(i >> 1) % chord.length];
      this.tone(hz(semi, 2), stepDur * 0.7, 'triangle', 0.05, 0, 0, g, at);
    }
    // nappe : 1 fois par mesure
    if (s.pad && i === 0) {
      for (const semi of chord.slice(0, 3)) this.tone(hz(semi, 1), stepDur * 16, 'sine', 0.045, 0, 0, g, at);
    }
    // batterie
    const kick = s.kick[i] === 'x';
    const snare = s.snare[i] === 'x' || (boss && i === 14);
    const hat = s.hat[i] === 'x' || boss;
    if (kick) { this.tone(52, 0.13, 'sine', 0.9, -38, 0, g, at); this.noise(0.03, 0.3, 200, 1, 0, 'lowpass', g, at); }
    if (snare) { this.noise(0.14, 0.42, 1800, 0.8, 0, 'bandpass', g, at); this.tone(190, 0.08, 'triangle', 0.25, -60, 0, g, at); }
    if (hat) this.noise(i % 4 === 2 ? 0.07 : 0.03, 0.11, 7000, 1, 0, 'highpass', g, at);
    // transition : roulement de caisse claire toutes les 4 mesures
    if (bar === 3 && i >= 12) this.noise(0.05, 0.25, 2200, 1, 0, 'bandpass', g, at);
  }
}
