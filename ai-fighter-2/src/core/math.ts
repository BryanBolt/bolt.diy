// Outils mathématiques déterministes pour la simulation.
// Règle d'or : rien ici ne dépend de la plateforme (pas de Math.sin/cos/pow
// dans la sim, pas de Date, pas de Math.random).

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

export function approach(v: number, target: number, step: number): number {
  if (v < target) return v + step > target ? target : v + step;
  if (v > target) return v - step < target ? target : v - step;
  return v;
}

/** Arrondi déterministe à 1/256 pour éviter la dérive flottante entre machines. */
export function q(v: number): number {
  return Math.round(v * 256) / 256;
}

/** Générateur xorshift32 : rapide, déterministe, sérialisable (un seul entier). */
export class Rng {
  s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 0x9e3779b9;
  }
  nextU32(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  /** [0, 1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }
  /** entier dans [lo, hi] inclus */
  int(lo: number, hi: number): number {
    return lo + (this.nextU32() % (hi - lo + 1));
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.nextU32() % arr.length];
  }
}

/** Hash FNV-1a 32 bits sur une liste de nombres (quantifiés). */
export function hashNumbers(nums: number[]): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < nums.length; i++) {
    const v = Math.round(nums[i] * 256) | 0;
    h ^= v & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 8) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 16) & 0xff;
    h = Math.imul(h, 0x01000193);
    h ^= (v >>> 24) & 0xff;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
