// Poupée articulée (rendu uniquement) : les membres suivent la pose avec une raideur qui dépend de l'état.
// Debout : raideur 1 (pose exacte). Touché / projeté / KO : les membres traînent, battent, tombent et se posent sur le sol.
export interface P { x: number; y: number }
export interface Rig {
  hip: P; mid: P; sh: P; neck: P; head: P;
  aFe: P; aFw: P; aBe: P; aBw: P;
  lFk: P; lFa: P; lBk: P; lBa: P;
  headR: number;
}
export const RIG_KEYS = ['mid', 'sh', 'neck', 'head', 'aFe', 'aFw', 'aBe', 'aBw', 'lFk', 'lFa', 'lBk', 'lBa'] as const;
const BONES: [keyof Rig, keyof Rig][] = [
  ['hip', 'mid'], ['mid', 'sh'], ['sh', 'neck'], ['neck', 'head'],
  ['sh', 'aFe'], ['aFe', 'aFw'], ['sh', 'aBe'], ['aBe', 'aBw'],
  ['hip', 'lFk'], ['lFk', 'lFa'], ['hip', 'lBk'], ['lBk', 'lBa'],
];

export function cloneRig(r: Rig): Rig {
  const c = { headR: r.headR } as Rig;
  for (const k of ['hip', ...RIG_KEYS] as const) (c as unknown as Record<string, P>)[k] = { x: (r[k] as P).x, y: (r[k] as P).y };
  return c;
}

interface State { cur: Rig; prev: Rig }

/** Raideur selon l'état : 1 = suit la pose, proche de 0 = mou. */
export function stiffnessFor(state: string): number {
  switch (state) {
    case 'launch': return 0.1;
    case 'ko': return 0.07;
    case 'down': return 0.09;
    case 'hit': case 'stagger': return 0.34;
    case 'block': case 'parry': return 0.6;
    case 'getup': return 0.4;
    case 'attack': return 0.82;
    case 'frozen': return 1;
    default: return 0.9;
  }
}

export class RagdollSystem {
  private m = new Map<number, State>();

  /** target : pose cible en coordonnées écran absolues. Retourne le squelette simulé. */
  step(id: number, target: Rig, stiff: number, frames: number, groundY: number): Rig {
    let st = this.m.get(id);
    if (!st) { st = { cur: cloneRig(target), prev: cloneRig(target) }; this.m.set(id, st); }
    const n = Math.max(1, Math.min(3, Math.round(frames)));
    for (let it = 0; it < n; it++) {
      const { cur, prev } = st;
      // le bassin suit le combattant (physique de la simulation)
      const dxHip = target.hip.x - cur.hip.x, dyHip = target.hip.y - cur.hip.y;
      prev.hip.x += dxHip; prev.hip.y += dyHip;
      cur.hip.x = target.hip.x; cur.hip.y = target.hip.y;
      const loose = 1 - stiff;
      for (const k of RIG_KEYS) {
        const c = cur[k] as P, p = prev[k] as P, t = target[k] as P;
        const vx = (c.x - p.x) * (0.9 + 0.08 * stiff), vy = (c.y - p.y) * (0.9 + 0.08 * stiff);
        p.x = c.x; p.y = c.y;
        c.x += vx; c.y += vy + 0.55 * loose * loose;
        c.x += (t.x - c.x) * stiff; c.y += (t.y - c.y) * stiff;
      }
      // os : longueurs de la pose cible
      for (let pass = 0; pass < 3; pass++) {
        for (const [a, b] of BONES) {
          const pa = cur[a] as P, pb = cur[b] as P, ta = target[a] as P, tb = target[b] as P;
          const len = Math.hypot(tb.x - ta.x, tb.y - ta.y);
          let dx = pb.x - pa.x, dy = pb.y - pa.y;
          const d = Math.hypot(dx, dy) || 1e-4;
          const diff = (d - len) / d;
          dx *= diff; dy *= diff;
          if (a === 'hip') { pb.x -= dx; pb.y -= dy; } else { pa.x += dx * 0.5; pa.y += dy * 0.5; pb.x -= dx * 0.5; pb.y -= dy * 0.5; }
        }
      }
      // sol
      for (const k of RIG_KEYS) {
        const c = cur[k] as P, p = prev[k] as P;
        if (c.y > groundY) { c.y = groundY; p.y = groundY; p.x += (c.x - p.x) * 0.35; }
      }
      cur.headR = target.headR;
    }
    return st.cur;
  }

  forget(alive: Set<number>): void {
    for (const id of this.m.keys()) if (!alive.has(id)) this.m.delete(id);
  }
}
