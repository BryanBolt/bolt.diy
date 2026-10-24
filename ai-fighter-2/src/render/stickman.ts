// Rendu des combattants : silhouettes pleines (aplats, membres épais, bouts arrondis), sans contour ni visage.
import type { Fighter } from '../sim/types';
import { getChar, skeletonStyle, PALETTE } from '../sim/chars';
import { lerp } from '../core/math';

// Conventions (degrés) : 0 = vers le bas, positif = vers l'avant (sens du regard).
// Bras  [haut, flexion]  : avant-bras = haut + flexion (la main remonte vers l'avant).
// Jambe [cuisse, flexion] : tibia = cuisse - flexion (le pied part vers l'arrière).
// 'g' à la place de la flexion du genou : pied posé au sol, flexion calculée.
type Knee = number | 'g';
interface AuthPose {
  lean: number; // torse : 0 vertical, + penché en avant
  tilt: number; // tête relative au torse
  aF: [number, number];
  aB: [number, number];
  lF: [number, Knee];
  lB: [number, Knee];
  h?: number; // hauteur de hanche
  air?: boolean; // en l'air : la hanche se cale sur le pied le plus bas
  ground?: boolean; // allongé
  spin?: number;
  hx?: number; // décalage du bassin vers l'avant (poids du corps)
}

export interface Pose {
  lean: number;
  tilt: number;
  aF: [number, number];
  aB: [number, number];
  lF: [number, number];
  lB: [number, number];
  h: number;
  spin?: number;
  hx: number;
}

const L = { torso: 34, arm: 22, fore: 22, thigh: 26, shin: 26 };
const DEG = Math.PI / 180;

function resolve(p: AuthPose): Pose {
  const full = L.thigh + L.shin;
  let H = p.ground ? 12 : p.h ?? 50;
  for (const l of [p.lF, p.lB]) if (l[1] === 'g') H = Math.min(H, full * Math.cos(l[0] * DEG) * 0.96);
  const knee = (t: number, k: Knee): number => {
    if (k !== 'g') return k;
    const v = Math.max(-1, Math.min(1, (H - L.thigh * Math.cos(t * DEG)) / L.shin));
    const a = Math.acos(v) / DEG;
    const opts: number[] = [];
    if (a <= t) opts.push(t - a);
    if (-a <= t) opts.push(t + a);
    return opts.length ? Math.min(...opts) : 0;
  };
  const lF: [number, number] = [p.lF[0], knee(p.lF[0], p.lF[1])];
  const lB: [number, number] = [p.lB[0], knee(p.lB[0], p.lB[1])];
  if (p.air) {
    const depth = (l: [number, number]) => L.thigh * Math.cos(l[0] * DEG) + L.shin * Math.cos((l[0] - l[1]) * DEG);
    H = Math.max(depth(lF), depth(lB));
  }
  return { lean: p.lean, tilt: p.tilt, aF: p.aF, aB: p.aB, lF, lB, h: H, spin: p.spin, hx: p.hx ?? 0 };
}

const A = (lean: number, tilt: number, aF: [number, number], aB: [number, number], lF: [number, Knee], lB: [number, Knee], h = 50, extra: Partial<AuthPose> = {}): AuthPose => ({ lean, tilt, aF, aB, lF, lB, h, ...extra });

const AUTH: Record<string, AuthPose> = {
  idle: A(3, 0, [12, 25], [-6, 18], [6, 'g'], [-8, 'g'], 51),
  guard: A(6, 0, [48, 108], [34, 118], [22, 'g'], [-22, 'g'], 44),
  lowGuard: A(10, 0, [50, 100], [34, 110], [40, 'g'], [-36, 'g'], 34),
  jump: A(6, 0, [70, 60], [-30, 35], [30, 80], [64, 100], 38, { air: true }),
  fall: A(-4, -8, [-40, 60], [-60, 70], [20, 30], [-10, 50], 40, { air: true }),
  hit: A(-20, -12, [-45, 22], [-22, 42], [-18, 'g'], [14, 'g'], 48),
  launch: A(-45, -20, [-70, 20], [-90, 20], [40, 30], [70, 40], 40, { air: true }),
  down: A(-90, 0, [-80, 10], [-60, 14], [82, 8], [74, 22], 12, { ground: true }),
  ko: A(-90, -6, [-110, 6], [-140, 10], [70, 10], [96, 14], 12, { ground: true }),
  getup: A(30, 6, [40, 80], [20, 100], [60, 90], [-30, 'g'], 30),
  stagger: A(-22, -14, [-30, 40], [30, 30], [-22, 'g'], [20, 'g'], 49),
  parry: A(10, 0, [30, 80], [95, 20], [24, 'g'], [-20, 'g'], 46),
  frozen: A(2, 0, [12, 25], [-6, 18], [6, 'g'], [-8, 'g'], 51),
  win: A(-6, -10, [30, 40], [175, 5], [8, 'g'], [-8, 'g'], 51),
  revive: A(28, 15, [70, 40], [80, 30], [50, 'g'], [-30, 'g'], 30),
  crouch: A(12, 2, [30, 100], [44, 100], [40, 'g'], [-40, 'g'], 32),
  shoot0: A(4, 0, [70, 20], [78, 15], [16, 'g'], [-16, 'g'], 48),
  shoot1: A(0, 0, [88, 2], [92, 2], [18, 'g'], [-18, 'g'], 47),
  grab0: A(14, 4, [50, 30], [60, 30], [22, 'g'], [-14, 'g'], 46),
  grab1: A(24, 6, [88, 4], [92, 4], [30, 'g'], [-24, 'g'], 44),
  // coups : [préparation, frappe]
  jab0: A(6, 0, [30, 115], [34, 118], [22, 'g'], [-22, 'g'], 44),
  jab1: A(12, 0, [88, 4], [14, 128], [-30, 'g'], [26, 'g'], 46),
  cross0: A(-2, 0, [50, 108], [-10, 120], [22, 'g'], [-22, 'g'], 44),
  cross1: A(16, 2, [40, 110], [90, 4], [24, 'g'], [-30, 'g'], 45),
  kick0: A(-6, 0, [30, 115], [18, 125], [50, 95], [-4, 'g'], 52),
  kick1: A(-14, -4, [30, 115], [18, 125], [86, 6], [-4, 'g'], 52),
  heavy0: A(-16, -6, [-60, 60], [-150, 40], [-18, 'g'], [18, 'g'], 46),
  heavy1: A(34, 8, [60, 40], [80, 10], [30, 'g'], [-38, 'g'], 42),
  uppercut0: A(18, 0, [40, 100], [-10, 100], [26, 'g'], [-30, 'g'], 38),
  uppercut1: A(-8, -8, [30, 115], [160, 10], [10, 'g'], [-14, 'g'], 50),
  sweep0: A(14, 2, [40, 100], [20, 110], [40, 'g'], [-40, 'g'], 32),
  sweep1: A(24, 4, [-30, 60], [40, 60], [58, 0], [-50, 'g'], 28),
  knee0: A(8, 0, [30, 115], [20, 120], [40, 115], [-4, 'g'], 51),
  knee1: A(8, -2, [30, 115], [20, 120], [80, 95], [-4, 'g'], 52),
  airkick0: A(0, 0, [50, 70], [-30, 50], [40, 90], [10, 70], 38, { air: true }),
  airkick1: A(-10, -4, [-40, 40], [-20, 50], [86, 4], [20, 110], 38, { air: true }),
  dive0: A(30, 0, [-40, 40], [-60, 40], [-20, 60], [20, 70], 38, { air: true }),
  dive1: A(-50, -6, [-60, 20], [-90, 20], [60, 5], [50, 30], 34, { air: true }),
  special0: A(-8, 0, [-40, 60], [-60, 70], [-20, 'g'], [20, 'g'], 44),
  special1: A(12, 2, [90, 0], [92, 0], [34, 'g'], [-34, 'g'], 42),
  rising0: A(20, 0, [30, 100], [-20, 120], [40, 'g'], [-40, 'g'], 36),
  rising1: A(-14, -10, [-10, 50], [172, 6], [40, 100], [0, 30], 40, { air: true }),
  super0: A(-10, 0, [-60, 70], [-70, 70], [-24, 'g'], [24, 'g'], 46),
  super1: A(14, 4, [96, 4], [100, 0], [34, 'g'], [-34, 'g'], 42),
  charge0: A(20, 6, [-40, 70], [60, 50], [-20, 'g'], [20, 'g'], 42),
  charge1: A(40, 10, [-60, 40], [80, 60], [50, 'g'], [-50, 'g'], 38),
  slam0: A(-14, -8, [170, 10], [175, 5], [-14, 'g'], [14, 'g'], 50),
  slam1: A(38, 18, [80, 40], [85, 45], [40, 'g'], [-40, 'g'], 34),
  lasso0: A(-6, 0, [40, 70], [-120, 60], [-16, 'g'], [16, 'g'], 46),
  lasso1: A(12, 2, [30, 60], [100, 0], [30, 'g'], [-30, 'g'], 44),
  backstab0: A(30, 8, [-50, 40], [-60, 50], [30, 'g'], [-34, 'g'], 42),
  backstab1: A(-10, 0, [40, 50], [-100, 10], [16, 'g'], [-20, 'g'], 48),
  counter0: A(-4, 0, [60, 100], [80, 90], [22, 'g'], [-20, 'g'], 46),
  counter1: A(18, 4, [-20, 40], [100, 0], [30, 'g'], [-30, 'g'], 44),
};

Object.assign(AUTH, {
  stance_karate: A(4, 0, [62, 62], [-12, 122], [34, 'g'], [-28, 'g'], 44),
  stance_boxer: A(8, 0, [36, 112], [20, 132], [18, 'g'], [-22, 'g'], 46),
  stance_ninja: A(14, 2, [50, 100], [30, 110], [38, 'g'], [-34, 'g'], 40),
  stance_whip: A(2, 0, [20, 50], [-4, 40], [10, 'g'], [-10, 'g'], 51),
  stance_monk: A(0, 0, [70, 34], [-8, 110], [20, 'g'], [-20, 'g'], 47),
  stance_agile: A(6, 0, [72, 34], [-20, 100], [14, 'g'], [-16, 'g'], 49),
  wave0: A(-6, 0, [-30, 100], [-40, 95], [30, 'g'], [-34, 'g'], 40),
  wave1: A(14, 2, [90, 0], [92, 0], [36, 'g'], [-38, 'g'], 40),
  falcon0: A(-24, -6, [40, 60], [-120, 20], [24, 'g'], [-30, 'g'], 42),
  falcon1: A(36, 10, [50, 40], [86, 4], [44, 'g'], [-46, 'g'], 38),
  serious0: A(-8, 0, [20, 90], [-20, 100], [14, 'g'], [-14, 'g'], 48),
  serious1: A(30, 6, [40, 60], [92, 2], [40, 'g'], [-40, 'g'], 36),
  palm0: A(4, 0, [10, 60], [-30, 110], [22, 'g'], [-22, 'g'], 46),
  palm1: A(14, 2, [96, 0], [20, 100], [34, 'g'], [-30, 'g'], 42),
  slash0: A(-16, -6, [150, 50], [160, 40], [16, 'g'], [-16, 'g'], 46),
  slash1: A(24, 6, [78, 10], [70, 15], [34, 'g'], [-34, 'g'], 42),
  slash2: A(-6, 0, [-60, 30], [-70, 30], [-20, 'g'], [26, 'g'], 46),
  barrage0: A(6, 0, [30, 115], [34, 118], [22, 'g'], [-22, 'g'], 44),
  barrage1: A(12, 0, [88, 4], [14, 128], [26, 'g'], [-26, 'g'], 44),
  rider0: A(0, 0, [-40, 40], [-60, 40], [10, 70], [-10, 60], 40, { air: true }),
  rider1: A(-55, -6, [-70, 20], [-90, 20], [70, 3], [50, 60], 34, { air: true }),
});
const HX: Record<string, number> = { jab1: 4, cross1: 8, heavy1: 12, uppercut1: 6, charge1: 14, slam1: 8, special1: 6, super1: 8, counter1: 8, wave1: 6, falcon0: -6, falcon1: 14, serious1: 12, palm1: 8, slash1: 10, kick1: -2, backstab1: 4, grab1: 6, lasso1: 6, dive0: 4 };
for (const k of Object.keys(HX)) AUTH[k].hx = HX[k];

export const POSES: Record<string, Pose> = Object.fromEntries(Object.entries(AUTH).map(([k, v]) => [k, resolve(v)]));

const ANIM_KEYS = ['wave', 'falcon', 'serious', 'palm', 'slash', 'barrage', 'rider', 'shoot', 'grab', 'jab', 'cross', 'kick', 'heavy', 'uppercut', 'sweep', 'knee', 'airkick', 'dive', 'special', 'rising', 'super', 'charge', 'slam', 'lasso', 'backstab', 'counter'];

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => lerp(x, y, t);
  return {
    lean: l(a.lean, b.lean),
    tilt: l(a.tilt, b.tilt),
    aF: [l(a.aF[0], b.aF[0]), l(a.aF[1], b.aF[1])],
    aB: [l(a.aB[0], b.aB[0]), l(a.aB[1], b.aB[1])],
    lF: [l(a.lF[0], b.lF[0]), l(a.lF[1], b.lF[1])],
    lB: [l(a.lB[0], b.lB[0]), l(a.lB[1], b.lB[1])],
    h: l(a.h, b.h),
    hx: l(a.hx, b.hx),
    spin: l(a.spin ?? 0, b.spin ?? 0),
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t: number): number {
  return t * t;
}

/** Cycle de marche / course : jambe qui avance = genou fléchi, jambe d'appui = pied au sol. */
function cycle(f: Fighter, time: number, run: boolean): Pose {
  const w = time * (run ? 0.42 : 0.26) + f.id;
  const sw = Math.sin(w), cw = Math.cos(w);
  const amp = run ? 42 : 24, flex = run ? 105 : 45, armAmp = run ? 46 : 22;
  return resolve({
    lean: run ? 20 : 5,
    tilt: run ? 4 : 0,
    aF: [-sw * armAmp, run ? 95 : 22],
    aB: [sw * armAmp, run ? 90 : 28],
    lF: [sw * amp, cw > 0.08 ? flex * cw : 'g'],
    lB: [-sw * amp, cw < -0.08 ? -flex * cw : 'g'],
    h: run ? 46 : 49,
  });
}

/** Calcule la pose courante d'un combattant (rendu uniquement : Math.sin autorisé). */
export function poseFor(f: Fighter, time: number): Pose {
  const s = f.state;
  const ph = time * 0.11 + f.id * 1.7;
  const breathe = Math.sin(ph);
  switch (s) {
    case 'idle': {
      const p = POSES['stance_' + skeletonStyle(getChar(f.charId)).stance] ?? POSES.idle;
      const bounce = Math.sin(ph * 2);
      return { ...p, h: p.h + bounce * 1.4, hx: Math.sin(ph) * 1.5, lean: p.lean + breathe * 1.2, aF: [p.aF[0] + breathe * 3, p.aF[1]], aB: [p.aB[0] - breathe * 2, p.aB[1] + bounce * 3] };
    }
    case 'walk':
      return cycle(f, time, false);
    case 'run':
      return cycle(f, time, true);
    case 'jump':
      return f.vy > 2 ? POSES.jump : f.vy < -2 ? POSES.fall : lerpPose(POSES.jump, POSES.fall, 0.5);
    case 'guard':
      return f.lowGuard ? POSES.lowGuard : POSES.guard;
    case 'block': {
      const p = f.lowGuard ? POSES.lowGuard : POSES.guard;
      return { ...p, lean: p.lean - 8 + f.stateFrame * 0.5 };
    }
    case 'hit':
      return lerpPose(POSES.hit, POSES.idle, Math.min(1, f.stateFrame / Math.max(1, f.hitFrames)) * 0.5);
    case 'launch':
      return { ...POSES.launch, lean: Math.max(-95, POSES.launch.lean - f.stateFrame * 2) };
    case 'down':
      return POSES.down;
    case 'ko':
      return f.y > 0.5 ? { ...POSES.launch, lean: Math.max(-100, -60 - f.stateFrame * 2) } : POSES.ko;
    case 'getup': {
      const t = easeOut(Math.min(1, f.stateFrame / 14));
      return t < 0.5 ? lerpPose(POSES.down, POSES.getup, t * 2) : lerpPose(POSES.getup, POSES.idle, (t - 0.5) * 2);
    }
    case 'stagger': {
      const p = POSES.stagger;
      return { ...p, lean: p.lean + Math.sin(f.stateFrame * 0.6) * 6 };
    }
    case 'parry':
      return lerpPose(POSES.parry, POSES.idle, easeIn(Math.min(1, f.stateFrame / 14)));
    case 'dodge': {
      const t = f.stateFrame / 20;
      const spin = (f.vx !== 0 ? 1 : 0) * t * 360 * (f.vx >= 0 === f.facing >= 0 ? 1 : -1);
      return { ...POSES.crouch, spin, h: 40 + Math.sin(t * Math.PI) * 6 };
    }
    case 'frozen':
      return POSES.frozen;
    case 'win': {
      const p = POSES.win;
      return { ...p, aB: [175 + Math.sin(time * 0.3) * 10, 5], h: p.h + Math.abs(Math.sin(time * 0.25)) * 5 };
    }
    case 'revive':
      return POSES.revive;
    case 'attack':
      return attackPose(f, time);
    default:
      return POSES.idle;
  }
}

function attackPose(f: Fighter, time: number): Pose {
  const c = getChar(f.charId);
  const m = f.moveId ? c.moves[f.moveId] : null;
  if (!m) return POSES.idle;
  const fr = f.stateFrame;
  const activeEnd = m.startup + m.active;
  if (m.id === 'shoot') return POSES.shoot1;
  if (m.anim === 'tatsu') return { ...POSES.airkick1, spin: ((fr % 14) / 14) * 360 * (fr > 4 ? 1 : 0), h: POSES.airkick1.h + 8 };
  if (m.anim === 'flurrykick') {
    const t = Math.floor(fr / 3) % 2;
    const p = POSES.kick1;
    const out: [number, number] = [86, 6], tuck: [number, number] = [30, 90];
    return { ...p, lean: -10, lF: t ? out : tuck, lB: t ? tuck : out };
  }
  if (m.anim === 'flash') return { ...POSES.rising1, spin: -Math.min(360, Math.max(0, (fr - 4) * 30)), h: POSES.rising1.h + 14 };
  const key = ANIM_KEYS.includes(m.anim) ? m.anim : 'jab';
  if (m.anim === 'jab' && m.multi && fr > m.startup && fr <= activeEnd) {
    const a = fr % 4 < 2;
    return { ...POSES.jab1, aF: a ? [88, 4] : [30, 115], aB: a ? [30, 115] : [88, 4] };
  }
  const p0 = POSES[key + '0'] ?? POSES.jab0;
  const p1 = POSES[key + '1'] ?? POSES.jab1;
  if ((key === 'barrage' || key === 'slash') && fr > m.startup && fr <= activeEnd) {
    const a = Math.floor((fr - m.startup) / (key === 'slash' ? 3 : 2)) % 2 === 0;
    if (key === 'slash') return a ? p1 : POSES.slash2;
    return { ...POSES.barrage1, aF: a ? [88, 4] : [30, 115], aB: a ? [30, 115] : [88, 4], hx: a ? 4 : -2, lean: 10 + (a ? 3 : -2) };
  }
  if (key === 'super') {
    if (fr <= m.startup) return lerpPose(POSES.idle, p0, easeOut(fr / Math.max(1, m.startup)));
    if (fr <= activeEnd) return Math.floor((fr - m.startup) / 4) % 2 === 0 ? p1 : POSES.cross1;
    return lerpPose(p1, POSES.idle, easeOut((fr - activeEnd) / Math.max(1, m.recovery)));
  }
  if (fr <= m.startup) {
    const t = fr / Math.max(1, m.startup);
    if (t < 0.65) return lerpPose(POSES.idle, p0, easeOut(t / 0.65));
    return lerpPose(p0, p1, easeIn((t - 0.65) / 0.35));
  }
  if (fr <= activeEnd) {
    if (m.multi) return { ...p1, aF: [p1.aF[0] + Math.sin(time * 1.5) * 15, p1.aF[1]] };
    // l'impact « traverse » : léger dépassement du buste et du bassin sur les 2 premières frames actives
    const over = Math.max(0, 1 - (fr - m.startup - 1) / 2);
    return over > 0 ? { ...p1, lean: p1.lean + 5 * over, hx: p1.hx + 4 * over } : p1;
  }
  return lerpPose(p1, POSES.idle, easeOut((fr - activeEnd) / Math.max(1, m.recovery)));
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

export interface DrawOpts {
  x: number; // position écran du centre des pieds
  y: number;
  scale: number;
  facing: number;
  alpha?: number;
  flash?: number; // 0..1 blanc (impact)
  outline?: string;
  ghost?: boolean;
  time: number;
  rim?: boolean; // passe de contour de lisibilité (interne)
}

export function colorsFor(f: Fighter): { main: string; dark: string; glow: string } {
  const pal = PALETTE[f.color % PALETTE.length] ?? PALETTE[0];
  return pal;
}

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** Couleur qui ressort sur le corps (bandeau, écharpe, visière). */
function accent(main: string): string {
  return luma(main) > 150 ? '#14161f' : '#ffffff';
}

export function drawStickman(ctx: CanvasRenderingContext2D, f: Fighter, pose: Pose, o: DrawOpts): void {
  if (!o.ghost && f.state !== 'ko') drawBody(ctx, f, pose, { ...o, rim: true, alpha: (o.alpha ?? 1) * 0.9 }, false);
  drawBody(ctx, f, pose, o, false);
  if (o.flash && o.flash > 0) drawBody(ctx, f, pose, { ...o, alpha: (o.alpha ?? 1) * Math.min(0.85, o.flash) }, true);
}

function drawBody(ctx: CanvasRenderingContext2D, f: Fighter, pose: Pose, o: DrawOpts, tint: boolean): void {
  const c = getChar(f.charId);
  const sk = skeletonStyle(c);
  const col = colorsFor(f);
  const S = o.scale * sk.scale * 1.1;
  const fx = o.facing;
  const rim = !!o.rim;
  const thick = (sk.thickness * 1.5 + 1.5) * S + (rim ? 4.2 * S : 0);
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.globalAlpha = o.alpha ?? 1;
  // étirement / écrasement selon la vitesse verticale (rendu seulement)
  if (!o.ghost && f.state !== 'ko' && f.state !== 'down') {
    const st = Math.max(-0.14, Math.min(0.16, Math.abs(f.vy) * 0.012 - (f.y <= 0.5 && f.state === 'jump' ? 0.12 : 0)));
    ctx.scale(1 - st * 0.55, 1 + st);
  }
  if (pose.spin) {
    ctx.translate(0, -50 * S);
    ctx.rotate(pose.spin * DEG * fx);
    ctx.translate(0, 50 * S);
  }
  const hipX = pose.hx * S * fx;
  const hipY = -pose.h * sk.legs * S;
  const lean = pose.lean * DEG;
  const TL = L.torso * sk.torso;
  const neckX = hipX + Math.sin(lean) * TL * S * fx;
  const neckY = hipY - Math.cos(lean) * TL * S;
  const headR = sk.headR * 1.12 * S;
  const headAng = (pose.lean + pose.tilt) * DEG;
  const headX = neckX + Math.sin(headAng) * (headR + 2 * S) * fx;
  const headY = neckY - Math.cos(headAng) * (headR + 2 * S);
  const shX = hipX + Math.sin(lean) * TL * 0.9 * S * fx;
  const shY = hipY - Math.cos(lean) * TL * 0.9 * S;

  const joint = (ox: number, oy: number, a1: number, l1: number, a2: number, l2: number): number[] => {
    const x1 = ox + Math.sin(a1 * DEG) * l1 * S * fx;
    const y1 = oy + Math.cos(a1 * DEG) * l1 * S;
    return [x1, y1, x1 + Math.sin(a2 * DEG) * l2 * S * fx, y1 + Math.cos(a2 * DEG) * l2 * S];
  };
  const arm = (a: [number, number]) => joint(shX, shY, a[0], L.arm * sk.arms, a[0] + a[1], L.fore * sk.arms);
  const leg = (l: [number, number]) => joint(hipX, hipY, l[0], L.thigh * sk.legs, l[0] - l[1], L.shin * sk.legs);
  const aF = arm(pose.aF), aB = arm(pose.aB), lF = leg(pose.lF), lB = leg(pose.lB);
  const footDir = (l: [number, number]): [number, number] => {
    const s = (l[0] - l[1]) * DEG;
    return [Math.cos(s) * fx, -Math.sin(s)];
  };

  const lum = luma(col.main);
  const rimColor = lum < 120 ? '#eaf2ff' : '#0a0c16';
  const main = rim ? rimColor : tint ? '#ffffff' : o.ghost ? '#aab1be' : col.main;
  const back = rim || tint || o.ghost ? main : lum < 70 ? shade(main, 0.22) : shade(main, -0.2);

  const flat = rim || tint || !!o.ghost;
  const trimCol = accent(col.main);
  const stroke = (pts: number[][], width: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };
  const limbs = (a: number[], origin: number[], fd: [number, number] | null, color: string) => {
    const pts = [origin, [a[0], a[1]], [a[2], a[3]]];
    if (fd) pts.push([a[2] + fd[0] * 6 * S, a[3] + fd[1] * 6 * S]);
    stroke(pts, thick, color);
    if (!fd) {
      ctx.beginPath();
      ctx.arc(a[2], a[3], thick * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
    if (flat) return;
    // détails de couleur contrastée : gants / bottes
    const wx = a[0] + (a[2] - a[0]) * 0.55, wy = a[1] + (a[3] - a[1]) * 0.55;
    if (!fd && sk.trim.includes('gloves')) {
      stroke([[wx, wy], [a[2], a[3]]], thick * 1.08, trimCol);
      ctx.beginPath(); ctx.arc(a[2], a[3], thick * 0.66, 0, Math.PI * 2); ctx.fillStyle = trimCol; ctx.fill();
    }
    if (fd && sk.trim.includes('boots')) stroke([[wx, wy], [a[2], a[3]], [a[2] + fd[0] * 6 * S, a[3] + fd[1] * 6 * S]], thick * 1.08, trimCol);
  };

  if (!tint && !rim) drawAccessoryBack(ctx, sk.accessory, neckX, neckY, shX, shY, fx, S, col, o.time, f);

  limbs(aB, [shX, shY], null, back);
  limbs(lB, [hipX, hipY], footDir(pose.lB), back);
  stroke([[hipX, hipY], [neckX, neckY]], thick * 1.18, main);
  if (!flat && (sk.trim.includes('belt') || sk.trim.includes('sash'))) {
    stroke([[hipX, hipY], [hipX + (neckX - hipX) * 0.2, hipY + (neckY - hipY) * 0.2]], thick * 1.32, trimCol);
    if (sk.trim.includes('sash')) stroke([[hipX, hipY], [hipX - fx * 10 * S, hipY + 14 * S + Math.sin(o.time * 0.25 + f.id) * 3 * S]], thick * 0.5, trimCol);
  }
  limbs(lF, [hipX, hipY], footDir(pose.lF), main);
  limbs(aF, [shX, shY], null, main);
  if (f.weapon > 0 && f.weaponKind && !tint && !rim) drawHeldWeapon(ctx, f.weaponKind, aF[2], aF[3], (pose.aF[0] + pose.aF[1]) * DEG, fx, S, thick * 0.6, o.time);
  ctx.beginPath();
  ctx.arc(headX, headY, headR + (rim ? 2.4 * S : 0), 0, Math.PI * 2);
  ctx.fillStyle = main;
  ctx.fill();
  if (tint || rim) { ctx.restore(); return; }
  drawAccessoryFront(ctx, sk.accessory, headX, headY, headR, fx, S, col, o.time, f);
  ctx.restore();
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt < 0) { r = Math.round(r * (1 + amt)); g = Math.round(g * (1 + amt)); b = Math.round(b * (1 + amt)); }
  else { r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt); }
  return `rgb(${r},${g},${b})`;
}

function drawAccessoryBack(ctx: CanvasRenderingContext2D, acc: string, nx: number, ny: number, sx: number, sy: number, fx: number, S: number, col: { main: string; dark: string; glow: string }, time: number, f: Fighter): void {
  const wave = Math.sin(time * 0.3 + f.id) * 4 * S;
  const motion = Math.min(1, Math.abs(f.vx) / 6);
  ctx.lineCap = 'round';
  if (acc === 'cape') {
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(sx - fx * (26 + motion * 30) * S, sy + 20 * S + wave, sx - fx * (18 + motion * 40) * S, sy + 58 * S);
    ctx.lineTo(sx - fx * 2 * S, sy + 50 * S);
    ctx.closePath();
    ctx.fillStyle = col.dark;
    ctx.fill();
  } else if (acc === 'scarf' || acc === 'headband' || acc === 'ponytail') {
    const base = acc === 'ponytail' ? [nx, ny - 14 * S] : acc === 'headband' ? [nx, ny - 16 * S] : [nx, ny + 2 * S];
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(base[0], base[1]);
      const len = (acc === 'ponytail' ? 26 : 22) * S;
      ctx.quadraticCurveTo(base[0] - fx * (len * 0.6 + motion * 20 * S), base[1] + 4 * S + wave * (i + 1) * 0.5, base[0] - fx * (len + motion * 28 * S), base[1] + (8 + i * 8) * S + wave);
      ctx.lineWidth = (acc === 'ponytail' ? 4 : 3) * S;
      ctx.strokeStyle = acc === 'ponytail' ? col.dark : accent(col.main);
      ctx.stroke();
    }
  }
}

function drawAccessoryFront(ctx: CanvasRenderingContext2D, acc: string, hx: number, hy: number, r: number, fx: number, S: number, col: { main: string; dark: string; glow: string }, time: number, f: Fighter): void {
  ctx.lineCap = 'round';
  switch (acc) {
    case 'headband':
      ctx.beginPath();
      ctx.moveTo(hx - r, hy - r * 0.35);
      ctx.lineTo(hx + r, hy - r * 0.35);
      ctx.lineWidth = 3.2 * S;
      ctx.strokeStyle = accent(col.main);
      ctx.stroke();
      break;
    case 'horns':
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + d * r * 0.6, hy - r * 0.7);
        ctx.lineTo(hx + d * r * 1.1, hy - r * 1.7);
        ctx.lineWidth = 3.5 * S;
        ctx.strokeStyle = col.dark;
        ctx.stroke();
      }
      break;
    case 'hood':
      ctx.beginPath();
      ctx.arc(hx, hy - 1 * S, r + 3 * S, Math.PI * 1.05, Math.PI * 1.95);
      ctx.lineWidth = 5 * S;
      ctx.strokeStyle = col.dark;
      ctx.stroke();
      break;
    case 'halo':
      ctx.beginPath();
      ctx.ellipse(hx, hy - r - 6 * S, r * 0.9, r * 0.28, 0, 0, Math.PI * 2);
      ctx.lineWidth = 2.5 * S;
      ctx.strokeStyle = col.glow;
      ctx.stroke();
      break;
    case 'flamehair': {
      for (let i = 0; i < 3; i++) {
        const t = time * 0.4 + i * 2 + f.id;
        ctx.beginPath();
        ctx.moveTo(hx - fx * (i - 1) * r * 0.45, hy - r * 0.8);
        ctx.quadraticCurveTo(hx - fx * (i - 1) * r * 0.6 + Math.sin(t) * 3 * S, hy - r * 1.6, hx - fx * ((i - 1) * r * 0.5 + 6 * S) + Math.sin(t * 1.3) * 4 * S, hy - r * (2 + Math.sin(t) * 0.2));
        ctx.lineWidth = 3 * S;
        ctx.strokeStyle = i === 1 ? '#ffd166' : col.main;
        ctx.stroke();
      }
      break;
    }
    case 'visor':
      ctx.beginPath();
      ctx.moveTo(hx - r * 0.3, hy - r * 0.15);
      ctx.lineTo(hx + fx * r * 1.05, hy - r * 0.15);
      ctx.lineWidth = 4 * S;
      ctx.strokeStyle = accent(col.main);
      ctx.stroke();
      break;
    case 'bands':
      // bandes aux poignets dessinées sur les mains ? (simplifié : bandeau)
      ctx.beginPath();
      ctx.moveTo(hx - r, hy - r * 0.4);
      ctx.lineTo(hx + r, hy - r * 0.4);
      ctx.lineWidth = 2.6 * S;
      ctx.strokeStyle = accent(col.main);
      ctx.stroke();
      break;
    default:
      break;
  }
}


function drawHeldWeapon(ctx: CanvasRenderingContext2D, kind: string, hx: number, hy: number, ang: number, fx: number, S: number, thick: number, time: number): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dx = Math.sin(ang) * fx, dy = Math.cos(ang);
  if (kind === 'bat') {
    const ex = hx + dx * 46 * S, ey = hy + dy * 46 * S;
    ctx.beginPath(); ctx.moveTo(hx - dx * 8 * S, hy - dy * 8 * S); ctx.lineTo(ex, ey);
    ctx.lineWidth = thick + 3 * S; ctx.strokeStyle = '#141622'; ctx.stroke();
    ctx.lineWidth = thick; ctx.strokeStyle = '#c98a4b'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo((hx + ex) / 2, (hy + ey) / 2); ctx.lineTo(ex, ey); ctx.lineWidth = thick + 1.5 * S; ctx.stroke();
  } else if (kind === 'nunchaku') {
    const mx = hx + dx * 20 * S, my = hy + dy * 20 * S;
    const sw = Math.sin(time * 0.5) * 10 * S;
    const ex = mx + dx * 20 * S - dy * sw, ey = my + dy * 20 * S + dx * sw;
    for (const [w, c] of [[thick + 2.5 * S, '#141622'], [thick - 1 * S, '#8a5a2b']] as [number, string][]) {
      ctx.lineWidth = w; ctx.strokeStyle = c;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(mx, my); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.strokeStyle = '#cfd6e0'; ctx.lineWidth = 1.2 * S;
    ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx + dx * 2 * S, my + dy * 2 * S); ctx.stroke();
  } else {
    // armes à feu : orientées vers l'avant
    const long = kind === 'ak';
    const len = (long ? 40 : 18) * S;
    const gx = hx + (long ? -4 : 0) * S * fx, gy = hy;
    ctx.fillStyle = '#141622';
    ctx.strokeStyle = '#141622';
    ctx.lineWidth = 2;
    // canon + corps
    ctx.fillRect(Math.min(gx, gx + fx * len), gy - 3.5 * S, len, 7 * S);
    ctx.fillStyle = long ? '#3a3f4a' : '#2a2f3a';
    ctx.fillRect(Math.min(gx, gx + fx * len) + 1, gy - 2.5 * S, len - 2, 5 * S);
    if (long) {
      // crosse en bois, chargeur courbe
      ctx.fillStyle = '#8a5a2b';
      ctx.fillRect(Math.min(gx, gx - fx * 12 * S), gy - 3 * S, 12 * S, 6 * S);
      ctx.fillStyle = '#141622';
      ctx.beginPath(); ctx.moveTo(gx + fx * 16 * S, gy + 3 * S); ctx.lineTo(gx + fx * 22 * S, gy + 14 * S); ctx.lineTo(gx + fx * 17 * S, gy + 15 * S); ctx.lineTo(gx + fx * 12 * S, gy + 3 * S); ctx.fill();
    } else {
      ctx.fillRect(gx - fx * 1 * S, gy, 5 * S * fx || 5 * S, 9 * S);
    }
    if (time % 3 < 1.2 && false) { /* réservé : lueur de bouche */ }
  }
  ctx.restore();
}
