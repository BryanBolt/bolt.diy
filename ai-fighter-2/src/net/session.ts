// Session de jeu : lockstep déterministe.
// - en local : tous les slots sont lus sur cette machine, délai 0 ;
// - en ligne : les entrées locales sont envoyées pour la frame (f + délai),
//   et une frame n'est simulée que lorsque les entrées de TOUS les joueurs
//   sont connues. Le serveur ne fait que relayer.
// - reprise : la partie peut être reconstruite en rejouant le journal des entrées
//   (déterminisme) ; un joueur absent est remplacé par une IA, puis reprend la main.

import { createWorld, step, setSlotAi, setSlotPlayer, joinPlayer } from '../sim/sim';
import { hashWorld } from '../sim/hash';
import type { World, SimConfig, SimEvent } from '../sim/types';
import type { InputManager } from '../input/manager';
import type { NetClient } from './client';
import type { CtlEvent } from '../../shared/protocol';
import { encodeRle } from '../../shared/protocol';
import { FPS } from '../sim/constants';

export interface ReplayData {
  /** journal des entrées par slot (une valeur par frame, depuis la frame 0) */
  log: Record<number, number[]>;
  /** passages IA / retours de joueurs */
  events: CtlEvent[];
  /** en ligne : frame à laquelle ce client reprend ses commandes */
  resumeFrom?: number;
  /** en local : démarre en pause une fois la partie reconstruite */
  pauseWhenDone?: boolean;
}

export interface SessionOptions {
  config: SimConfig;
  seed: number;
  localSlots: number[];
  allSlots: number[];
  delay: number;
  input: InputManager;
  net?: NetClient;
  replay?: ReplayData;
}

const FRAME_MS = 1000 / FPS;
const MAX_STEPS_PER_UPDATE = 4;
const CATCHUP_BUDGET_MS = 14;

export class Session {
  world: World;
  simFrame = 0; // nombre de step() exécutés
  sendFrame: number;
  readonly localSlots: number[];
  allSlots: number[];
  readonly delay: number;
  private inputs = new Map<number, number[]>(); // slot -> bits par frame
  private ctl: CtlEvent[] = [];
  private acc = 0;
  private lastTime = 0;
  private input: InputManager;
  private net?: NetClient;
  private unsub: (() => void)[] = [];
  stalledMs = 0;
  waitingSlots: number[] = [];
  desync = false;
  hashes = new Map<number, number>();
  onLocalInput: ((slot: number, bits: number) => void) | null = null;
  /** ralenti de rendu (cinématique) */
  timeScale = 1;
  /** événements accumulés depuis la dernière lecture (plusieurs frames possibles par rendu) */
  events: SimEvent[] = [];
  private queued = new Map<number, number>();
  /** reconstruction en cours (rejeu du journal) */
  catching = false;
  private catchTarget = 0;
  private pauseWhenDone = false;
  /** session gelée (reconstruction demandée) : plus de lecture ni d'envoi d'entrées */
  frozen = false;
  /** diagnostic (développement) : résumé de l'état toutes les 60 frames */
  debugLog: Map<number, string> | null = null;

  /** Ajoute des bits (ex. PAUSE depuis un bouton tactile) à la prochaine entrée échantillonnée d'un slot local. */
  queue(slot: number, bits: number): void {
    this.queued.set(slot, (this.queued.get(slot) ?? 0) | bits);
  }

  constructor(o: SessionOptions) {
    this.world = createWorld(o.config, o.seed);
    this.localSlots = o.localSlots;
    this.allSlots = o.allSlots.slice();
    if (o.replay) for (const e of o.replay.events) if (e.join) this.addSlot(e.slot);
    o = { ...o, allSlots: this.allSlots };
    this.delay = o.delay;
    this.input = o.input;
    this.net = o.net;
    this.sendFrame = o.delay;
    for (const s of o.allSlots) {
      const arr: number[] = [];
      for (let f = 0; f < o.delay; f++) arr[f] = 0;
      this.inputs.set(s, arr);
    }
    if (o.replay) {
      let maxLen = 0;
      for (const s of o.allSlots) {
        const src = o.replay.log[s];
        if (src && src.length) { this.inputs.set(s, src.slice()); maxLen = Math.max(maxLen, src.length); }
      }
      this.ctl = o.replay.events.map((e) => ({ ...e }));
      this.catchTarget = maxLen;
      this.catching = maxLen > 2;
      this.pauseWhenDone = !!o.replay.pauseWhenDone;
      this.sendFrame = o.replay.resumeFrom ?? Math.max(o.delay, ...o.localSlots.map((s) => this.inputs.get(s)?.length ?? 0));
    }
    if (this.net) {
      this.unsub.push(
        this.net.on('input', (m) => {
          if (m.t !== 'input') return;
          const arr = this.inputs.get(m.slot);
          if (!arr) return;
          for (let i = 0; i < m.bits.length; i++) if (arr[m.f + i] === undefined) arr[m.f + i] = m.bits[i];
        }),
      );
      this.unsub.push(
        this.net.on('drop', (m) => {
          if (m.t !== 'drop') return;
          this.ctl.push({ slot: m.slot, from: Math.max(m.from, this.simFrame), ai: true });
        }),
      );
      this.unsub.push(
        this.net.on('rejoin', (m) => {
          if (m.t !== 'rejoin') return;
          // la reprise doit être annoncée avant que cette frame soit jouée, sinon les clients divergeraient
          if (m.from <= this.simFrame) this.desync = true;
          if (m.join) this.addSlot(m.slot);
          this.ctl.push({ slot: m.slot, from: m.from, ai: false, join: m.join });
        }),
      );
      this.unsub.push(
        this.net.on('desync', () => {
          this.desync = true;
        }),
      );
    }
  }

  dispose(): void {
    for (const u of this.unsub) u();
    this.unsub = [];
  }

  /** Nouveau slot (joueur arrivé en cours de partie). */
  private addSlot(slot: number): void {
    if (!this.allSlots.includes(slot)) this.allSlots.push(slot);
    if (!this.inputs.has(slot)) this.inputs.set(slot, []);
  }

  /** Frame d'arrivée d'un joueur entré en cours de partie (-1 : présent dès le départ). */
  private joinFrame(slot: number): number {
    let best = -1;
    for (const e of this.ctl) if (e.slot === slot && e.join && (best < 0 || e.from < best)) best = e.from;
    return best;
  }

  /** Vrai si, à la frame f, ce slot est piloté par une IA (joueur parti). */
  private aiAt(slot: number, f: number): boolean {
    let ai = false;
    let best = -1;
    for (const e of this.ctl) if (e.slot === slot && e.from <= f && e.from >= best) { ai = e.ai; best = e.from; }
    return ai;
  }

  private inputReady(slot: number, f: number): boolean {
    const jf = this.joinFrame(slot);
    if (jf >= 0 && f < jf) return true; // pas encore dans la partie
    if (this.aiAt(slot, f)) return true;
    const arr = this.inputs.get(slot);
    return !!arr && arr[f] !== undefined;
  }

  private inputFor(slot: number, f: number): number {
    const jf = this.joinFrame(slot);
    if (jf >= 0 && f < jf) return 0;
    if (this.aiAt(slot, f)) return 0;
    return this.inputs.get(slot)?.[f] ?? 0;
  }

  /** Simule une frame si toutes les entrées sont connues. */
  private tryStep(live: boolean): boolean {
    const f = this.simFrame;
    const missing: number[] = [];
    for (const slot of this.allSlots) if (!this.inputReady(slot, f)) missing.push(slot);
    if (missing.length) {
      this.waitingSlots = missing;
      return false;
    }
    this.waitingSlots = [];
    for (const e of this.ctl) if (e.from === f) { if (e.join) joinPlayer(this.world, e.slot, e.join.name, e.join.charId, e.join.color); else if (e.ai) setSlotAi(this.world, e.slot); else setSlotPlayer(this.world, e.slot); }
    const bits: number[] = [];
    for (const slot of this.allSlots) bits[slot] = this.inputFor(slot, f);
    step(this.world, bits);
    this.simFrame++;
    if (this.debugLog && this.simFrame % 30 === 0) this.debugLog.set(this.simFrame, JSON.stringify(this.world.fighters.map((f) => [f.id, f.x, f.y, f.z, f.hp, f.state, f.controller[0], f.stateFrame, f.ki, f.freeze, f.invuln])) + '|' + this.world.rng + '|' + this.world.phase + '|' + this.world.roundTimer + '|h' + hashWorld(this.world) + '|p' + JSON.stringify(this.world.projectiles.map((p) => [p.id, p.x, p.y, p.life])) + '|i' + JSON.stringify(this.world.items.map((i) => [i.id, i.x, i.y, i.life])) + '|s' + this.world.score + ',' + this.world.coins + ',' + this.world.arenaL + ',' + this.world.round + ',' + JSON.stringify(this.world.fighters.map((f) => [f.superMeter, f.comboHits, f.weapon, f.vx, f.vy, f.facing])));
    if (live) {
      if (this.world.events.length) this.events.push(...this.world.events);
      if (this.net && this.simFrame % 60 === 0) this.net.send({ t: 'hash', f: this.simFrame, h: hashWorld(this.world) });
    }
    return true;
  }

  /** Progression de la reconstruction (0..1). */
  progress(): number {
    return this.catching && this.catchTarget > 0 ? Math.min(1, this.simFrame / this.catchTarget) : 1;
  }

  /** Journal des entrées jouées, compressé (sauvegarde locale / reprise). */
  exportLog(): { slots: { slot: number; rle: number[] }[]; events: CtlEvent[]; frames: number } {
    const slots = this.allSlots.map((slot) => ({ slot, rle: encodeRle(this.inputs.get(slot) ?? [], Math.min(this.simFrame, (this.inputs.get(slot) ?? []).length)) }));
    return { slots, events: this.ctl.map((e) => ({ ...e })), frames: this.simFrame };
  }

  /** Échantillonne les entrées locales pour la frame d'envoi, puis simule tant que possible. */
  update(now: number): number {
    if (this.frozen) { this.lastTime = now; return 0; }
    if (!this.lastTime) this.lastTime = now;
    let dt = now - this.lastTime;
    this.lastTime = now;
    if (dt > 250) dt = 250; // onglet en arrière-plan : on ne rattrape pas plus de 250 ms
    // --- reconstruction accélérée ---
    if (this.catching) {
      const t0 = performance.now();
      let n = 0;
      while (this.simFrame < this.catchTarget && performance.now() - t0 < CATCHUP_BUDGET_MS) {
        if (!this.tryStep(false)) break;
        n++;
      }
      if (this.simFrame >= this.catchTarget || n === 0) {
        this.catching = false;
        this.acc = 0;
        if (this.pauseWhenDone) { this.world.paused = true; this.world.pausedBy = this.localSlots[0] ?? 0; }
      }
      return n;
    }
    this.acc += dt * this.timeScale;
    let steps = 0;
    while (this.acc >= FRAME_MS && steps < MAX_STEPS_PER_UPDATE) {
      // 1) entrées locales pour la frame d'envoi
      if (this.sendFrame <= this.simFrame + this.delay) {
        const f = this.sendFrame;
        for (const slot of this.localSlots) {
          let bits = this.input.bitsFor(slot);
          const qb = this.queued.get(slot);
          if (qb) { bits |= qb; this.queued.delete(slot); }
          const arr = this.inputs.get(slot)!;
          arr[f] = bits;
          this.onLocalInput?.(slot, bits);
          if (this.net) {
            const from = Math.max(0, f - 2);
            const out: number[] = [];
            for (let i = from; i <= f; i++) out.push(arr[i] ?? 0);
            this.net.send({ t: 'input', f: from, bits: out });
          }
        }
        this.sendFrame++;
      }
      // 2) simulation si toutes les entrées de la frame sont connues
      if (!this.tryStep(true)) {
        this.stalledMs += FRAME_MS;
        this.acc = Math.min(this.acc, FRAME_MS * 2);
        break;
      }
      this.stalledMs = 0;
      this.acc -= FRAME_MS;
      steps++;
    }
    if (steps === MAX_STEPS_PER_UPDATE) this.acc = 0;
    return steps;
  }

  /** Fraction d'interpolation pour le rendu (0..1 entre deux frames simulées). */
  alpha(): number {
    return Math.min(1, this.acc / FRAME_MS);
  }
}
