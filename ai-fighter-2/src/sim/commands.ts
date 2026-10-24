// Détection des commandes de combat (quarts de cercle, dragon montant, 360°, etc.).
// Les directions sont relatives au regard du combattant :
//   FWD = vers l'avant, BACK = vers l'arrière, DOWN = vers l'écran (bas), UP = vers le fond (haut).
// Chaque combattant garde l'historique de ses changements de direction ; la détection est
// tolérante (diagonales comprises) comme dans les jeux de combat.

import { IN } from './types';
import type { Fighter } from './types';

export const D = { FWD: 1, BACK: 2, DOWN: 4, UP: 8 } as const;

export function dirMaskOf(inp: number, facing: number): number {
  let m = 0;
  const right = (inp & IN.RIGHT) !== 0;
  const left = (inp & IN.LEFT) !== 0;
  if (right && !left) m |= facing > 0 ? D.FWD : D.BACK;
  if (left && !right) m |= facing > 0 ? D.BACK : D.FWD;
  if (inp & IN.DOWN && !(inp & IN.UP)) m |= D.DOWN;
  if (inp & IN.UP && !(inp & IN.DOWN)) m |= D.UP;
  return m;
}

export function pushHistory(f: Fighter, mask: number, frame: number): void {
  const last = f.hist[f.hist.length - 1];
  if (last && last.m === mask) return;
  f.hist.push({ m: mask, f: frame });
  if (f.hist.length > 16) f.hist.shift();
}

/** Étape « neutre » : aucune direction. */
const N = -1;

/**
 * Cherche la suite d'étapes dans l'historique (ordre respecté, diagonales tolérées).
 * - window : la première étape doit dater de moins de `window` frames
 * - recent : la dernière étape doit être encore tenue, ou avoir été relâchée il y a moins de `recent` frames
 */
function seq(f: Fighter, now: number, steps: number[], window: number, recent: number): boolean {
  const h = f.hist;
  let k = 0;
  let lastIdx = -1;
  for (let i = 0; i < h.length; i++) {
    if (now - h[i].f > window + 60) continue;
    const st = steps[k];
    const ok = st === N ? h[i].m === 0 : (h[i].m & st) === st;
    if (ok) {
      if (k === 0 && now - h[i].f > window) continue;
      lastIdx = i;
      k++;
      if (k === steps.length) break;
    }
  }
  if (k < steps.length) return false;
  // prolonge sur la dernière étape (plusieurs entrées consécutives qui la satisfont)
  const last = steps[steps.length - 1];
  for (let i = lastIdx + 1; i < h.length; i++) {
    const ok = last === N ? h[i].m === 0 : (h[i].m & last) === last;
    if (ok) lastIdx = i;
  }
  const end = lastIdx + 1 < h.length ? h[lastIdx + 1].f : now;
  return now - end <= recent;
}

export const motions = {
  qcf: (f: Fighter, now: number) => seq(f, now, [D.DOWN, D.FWD], 20, 8),
  qcb: (f: Fighter, now: number) => seq(f, now, [D.DOWN, D.BACK], 20, 8),
  dqcf: (f: Fighter, now: number) => seq(f, now, [D.DOWN, D.FWD, D.DOWN, D.FWD], 44, 8),
  dqcb: (f: Fighter, now: number) => seq(f, now, [D.DOWN, D.BACK, D.DOWN, D.BACK], 44, 8),
  dd: (f: Fighter, now: number) => seq(f, now, [D.DOWN, N, D.DOWN], 16, 6),
  dp: (f: Fighter, now: number) => seq(f, now, [D.FWD, D.DOWN, D.FWD | D.DOWN], 24, 8),
  ewgf: (f: Fighter, now: number) => seq(f, now, [D.FWD, N, D.DOWN, D.FWD | D.DOWN], 26, 6),
  sonic: (f: Fighter, now: number) => seq(f, now, [D.BACK, D.FWD], 14, 6),
  flash: (f: Fighter, now: number) => seq(f, now, [D.DOWN, D.UP], 16, 6),
  /** tour complet : les quatre directions franchies dans les 40 dernières frames */
  circle: (f: Fighter, now: number) => {
    let seen = 0;
    for (const e of f.hist) if (now - e.f <= 40) seen |= e.m;
    const last = f.hist[f.hist.length - 1];
    return seen === (D.FWD | D.BACK | D.DOWN | D.UP) && !!last && last.m !== 0;
  },
};

export interface CommandCtx {
  buf: number; // boutons tamponnés
  inp: number;
  now: number;
  onGround: boolean;
  ki: number;
  superMeter: number;
  chainIndex: number;
  running: boolean;
}

/**
 * Retourne l'identifiant de la commande déclenchée par LIGHT / HEAVY (ou null).
 * Les commandes vérifient leur coût en Ki / Super ; sinon on retombe sur le coup normal.
 */
export function readCommand(f: Fighter, c: CommandCtx): string | null {
  const L = (c.buf & IN.LIGHT) !== 0;
  const H = (c.buf & IN.HEAVY) !== 0;
  if (!L && !H) return null;
  const m = dirMaskOf(c.inp, f.facing);
  const fwdNow = (m & D.FWD) !== 0 && !(m & D.DOWN);
  const dfNow = (m & D.FWD) !== 0 && (m & D.DOWN) !== 0;
  if (!c.onGround) return H && fwdNow && c.ki >= 8 ? 'c_rider' : L && fwdNow ? 'c_airflying' : null;
  if (L && H) return 'c_grab';
  // techniques cultes
  if (H && motions.dqcb(f, c.now) && c.superMeter >= 60) return 'c_purple';
  if (H && motions.dqcf(f, c.now) && c.superMeter >= 50) return 'c_omni';
  if (L && motions.dqcb(f, c.now) && c.ki >= 40) return 'c_meteor';
  if (H && motions.circle(f, c.now) && c.superMeter >= 40) return 'c_serious';
  if (H && motions.dp(f, c.now) && c.ki >= 30) return 'c_falcon';
  if (H && motions.sonic(f, c.now) && c.ki >= 14) return 'c_rocket';
  if (H && motions.dd(f, c.now) && c.ki >= 8) return 'c_step';
  if (L && motions.qcb(f, c.now) && c.ki >= 25) return 'c_wave';
  if (L && motions.flash(f, c.now) && c.ki >= 20) return 'c_rasen';
  if (L && motions.dqcf(f, c.now) && c.superMeter >= 50) return 'c_superfire';
  if (L && motions.circle(f, c.now) && c.superMeter >= 30) return 'c_piledriver';
  if (L && motions.ewgf(f, c.now) && c.ki >= 10) return 'c_ewgf';
  if (L && motions.dp(f, c.now) && c.ki >= 15) return 'c_dp';
  if (L && motions.qcf(f, c.now) && c.ki >= 12) return 'c_fire';
  if (H && motions.qcb(f, c.now) && c.ki >= 15) return 'c_tatsu';
  if (H && motions.qcf(f, c.now) && c.ki >= 20) return 'c_hundred';
  if (H && motions.flash(f, c.now)) return 'c_flash';
  if (L && motions.sonic(f, c.now)) return 'c_sonic';
  if (L && dfNow && c.ki >= 10) return 'c_onein';
  if (H && dfNow) return 'c_hop';
  if (L && fwdNow && !c.running && c.chainIndex === 0) return 'c_side';
  return null;
}
