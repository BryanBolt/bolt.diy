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
  // colonne rigide : liaisons croisées pour que le tronc ne se plie pas en deux
  ['hip', 'sh'], ['hip', 'neck'], ['mid', 'neck'], ['sh', 'head'], ['mid', 'head'],
  ['sh', 'aFe'], ['aFe', 'aFw'], ['sh', 'aBe'], ['aBe', 'aBw'],
  ['hip', 'lFk'], ['lFk', 'lFa'], ['hip', 'lBk'], ['lBk', 'lBa'],
];

/** Raideur relative par articulation : la tête, les mains et les pieds traînent plus (effet « pantin »). */
const MULT: Record<string, number> = { mid: 1.5, sh: 1.4, neck: 1.2, head: 0.6, aFe: 0.8, aFw: 0.62, aBe: 0.8, aBw: 0.62, lFk: 0.95, lFa: 0.8, lBk: 0.95, lBa: 0.8 };
/** Poids de l'impulsion d'un coup sur chaque articulation. */
const IMP: Record<string, number> = { mid: 0.5, sh: 0.7, neck: 0.8, head: 1.1, aFe: 0.9, aFw: 1.3, aBe: 0.9, aBw: 1.3, lFk: 0.7, lFa: 1.0, lBk: 0.7, lBa: 1.0 };

export function cloneRig(r: Rig): Rig {
  const c = { headR: r.headR } as Rig;
  for (const k of ['hip', ...RIG_KEYS] as const) (c as unknown as Record<string, P>)[k] = { x: (r[k] as P).x, y: (r[k] as P).y };
  return c;
}

interface State { cur: Rig; prev: Rig }

/** Raideur selon l'état : 1 = suit la pose, proche de 0 = mou. */
export function stiffnessFor(state: string): number {
  switch (state) {
    case 'held': return 0.3;
    case 'hold': return 0.7;
    case 'launch': return 0.12;
    case 'ko': return 0.1;
    case 'down': return 0.12;
    case 'hit': case 'stagger': return 0.3;
    case 'block': case 'parry': return 0.55;
    case 'getup': return 0.4;
    case 'attack': return 0.62;
    case 'frozen': return 1;
    default: return 0.74; // debout : pantin souple, la tête et les bras suivent avec un léger retard
  }
}

/** Si l'angle plie du mauvais côté (signe du produit vectoriel), le segment distal est redressé dans le prolongement. */
function limitJoint(a: P, b: P, c: P, sign: number): void {
  const ux = b.x - a.x, uy = b.y - a.y, vx = c.x - b.x, vy = c.y - b.y;
  const cross = ux * vy - uy * vx;
  if (cross * sign >= 0) return;
  const ul = Math.hypot(ux, uy) || 1, vl = Math.hypot(vx, vy) || 1;
  // on ramène le segment sur la droite (le genou / coude se bloque à plat)
  c.x = b.x + (ux / ul) * vl;
  c.y = b.y + (uy / ul) * vl;
}

export class RagdollSystem {
  private m = new Map<number, State>();

  /** target : pose cible en coordonnées écran absolues. Retourne le squelette simulé. */
  step(id: number, target: Rig, stiff: number, frames: number, groundY: number, facing = 1): Rig {
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
        const sk = Math.min(1, stiff * (MULT[k] ?? 1));
        c.x += (t.x - c.x) * sk; c.y += (t.y - c.y) * sk;
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
      // articulations humaines : le genou ne plie que vers l'arrière, le coude que vers l'avant (pas d'hyper-extension)
      for (let pass = 0; pass < 2; pass++) {
        limitJoint(cur.hip, cur.lFk, cur.lFa, facing);
        limitJoint(cur.hip, cur.lBk, cur.lBa, facing);
        limitJoint(cur.sh, cur.aFe, cur.aFw, -facing);
        limitJoint(cur.sh, cur.aBe, cur.aBw, -facing);
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

  /** Impulsion d'un coup (style « party game ») : les membres partent dans la direction du choc. */
  impulse(id: number, vx: number, vy: number): void {
    const st = this.m.get(id);
    if (!st) return;
    for (const k of RIG_KEYS) {
      const p = st.prev[k] as P;
      const w = IMP[k] ?? 0.6;
      p.x -= vx * w; p.y -= vy * w;
    }
  }

  forget(alive: Set<number>): void {
    for (const id of this.m.keys()) if (!alive.has(id)) this.m.delete(id);
  }
}
