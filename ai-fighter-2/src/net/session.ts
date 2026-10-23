// Session de jeu : lockstep déterministe.
// - en local : tous les slots sont lus sur cette machine, délai 0 ;
// - en ligne : les entrées locales sont envoyées pour la frame (f + délai),
//   et une frame n'est simulée que lorsque les entrées de TOUS les joueurs
//   sont connues. Le serveur ne fait que relayer.

import { createWorld, step, setSlotAi } from '../sim/sim';
import { hashWorld } from '../sim/hash';
import type { World, SimConfig, SimEvent } from '../sim/types';
import type { InputManager } from '../input/manager';
import type { NetClient } from './client';
import { FPS } from '../sim/constants';

export interface SessionOptions {
  config: SimConfig;
  seed: number;
  localSlots: number[];
  allSlots: number[];
  delay: number;
  input: InputManager;
  net?: NetClient;
}

const FRAME_MS = 1000 / FPS;
const MAX_STEPS_PER_UPDATE = 4;

export class Session {
  world: World;
  simFrame = 0; // nombre de step() exécutés
  sendFrame: number;
  readonly localSlots: number[];
  readonly allSlots: number[];
  readonly delay: number;
  private inputs = new Map<number, number[]>(); // slot -> bits par frame
  private dropAt = new Map<number, number>();
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

  /** Ajoute des bits (ex. PAUSE depuis un bouton tactile) à la prochaine entrée échantillonnée d'un slot local. */
  queue(slot: number, bits: number): void {
    this.queued.set(slot, (this.queued.get(slot) ?? 0) | bits);
  }

  constructor(o: SessionOptions) {
    this.world = createWorld(o.config, o.seed);
    this.localSlots = o.localSlots;
    this.allSlots = o.allSlots;
    this.delay = o.delay;
    this.input = o.input;
    this.net = o.net;
    this.sendFrame = o.delay;
    for (const s of o.allSlots) {
      const arr: number[] = [];
      for (let f = 0; f < o.delay; f++) arr[f] = 0;
      this.inputs.set(s, arr);
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
          this.dropAt.set(m.slot, Math.max(m.from, this.simFrame));
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

  private inputReady(slot: number, f: number): boolean {
    const d = this.dropAt.get(slot);
    if (d !== undefined && f >= d) return true;
    const arr = this.inputs.get(slot);
    return !!arr && arr[f] !== undefined;
  }

  private inputFor(slot: number, f: number): number {
    const d = this.dropAt.get(slot);
    if (d !== undefined && f >= d) return 0;
    return this.inputs.get(slot)?.[f] ?? 0;
  }

  /** Échantillonne les entrées locales pour la frame d'envoi, puis simule tant que possible. */
  update(now: number): number {
    if (!this.lastTime) this.lastTime = now;
    let dt = now - this.lastTime;
    this.lastTime = now;
    if (dt > 250) dt = 250; // onglet en arrière-plan : on ne rattrape pas plus de 250 ms
    this.acc += dt * this.timeScale;
    let steps = 0;
    while (this.acc >= FRAME_MS && steps < MAX_STEPS_PER_UPDATE) {
      // 1) entrées locales pour la frame d'envoi
      if (this.sendFrame <= this.simFrame + this.delay) {
        const f = this.sendFrame;
        const redundancy: Record<number, number[]> = {};
        for (const slot of this.localSlots) {
          let bits = this.input.bitsFor(slot);
          const qb = this.queued.get(slot);
          if (qb) { bits |= qb; this.queued.delete(slot); }
          const arr = this.inputs.get(slot)!;
          arr[f] = bits;
          this.onLocalInput?.(slot, bits);
          const prev = [arr[f - 2] ?? 0, arr[f - 1] ?? 0, bits];
          redundancy[slot] = prev;
        }
        if (this.net) {
          for (const slot of this.localSlots) {
            const r = redundancy[slot];
            const from = Math.max(0, f - 2);
            this.net.send({ t: 'input', f: from, bits: r.slice(r.length - (f - from + 1)) });
          }
        }
        this.sendFrame++;
      }
      // 2) simulation si toutes les entrées de la frame sont connues
      const f = this.simFrame;
      const missing: number[] = [];
      for (const slot of this.allSlots) if (!this.inputReady(slot, f)) missing.push(slot);
      if (missing.length) {
        this.waitingSlots = missing;
        this.stalledMs += FRAME_MS;
        this.acc = Math.min(this.acc, FRAME_MS * 2);
        break;
      }
      this.waitingSlots = [];
      this.stalledMs = 0;
      for (const [slot, at] of this.dropAt) if (at === f) setSlotAi(this.world, slot);
      const bits: number[] = [];
      for (const slot of this.allSlots) bits[slot] = this.inputFor(slot, f);
      step(this.world, bits);
      if (this.world.events.length) this.events.push(...this.world.events);
      this.simFrame++;
      this.acc -= FRAME_MS;
      steps++;
      if (this.net && this.simFrame % 60 === 0) {
        const h = hashWorld(this.world);
        this.net.send({ t: 'hash', f: this.simFrame, h });
      }
      // libère la mémoire des vieilles entrées
      if (this.simFrame % 600 === 0) {
        for (const arr of this.inputs.values()) for (let i = this.simFrame - 1200; i >= 0 && i < this.simFrame - 600 && arr[i] !== undefined; i++) delete arr[i];
      }
    }
    if (steps === MAX_STEPS_PER_UPDATE) this.acc = 0;
    return steps;
  }

  /** Fraction d'interpolation pour le rendu (0..1 entre deux frames simulées). */
  alpha(): number {
    return Math.min(1, this.acc / FRAME_MS);
  }
}
