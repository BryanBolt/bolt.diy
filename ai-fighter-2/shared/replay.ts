// Fichier de rediffusion : graine + journal des entrées suffisent à rejouer la partie à l'identique (déterminisme).
import type { CtlEvent } from './protocol';

export interface ReplayFile {
  v: 1;
  title: string;
  ts: number;
  config: unknown; // SimConfig
  seed: number;
  slots: { slot: number; rle: number[] }[];
  events: CtlEvent[];
  frames: number;
  hl: { f: number; label: string }[]; // moments forts
}

export function validReplay(r: unknown): r is ReplayFile {
  const o = r as ReplayFile;
  return !!o && o.v === 1 && typeof o.seed === 'number' && typeof o.frames === 'number' && o.frames > 0 && o.frames < 60 * 60 * 40
    && Array.isArray(o.slots) && Array.isArray(o.events) && Array.isArray(o.hl) && typeof o.config === 'object' && o.config !== null;
}
