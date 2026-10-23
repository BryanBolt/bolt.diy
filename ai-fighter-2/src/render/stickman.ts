// Rendu "encre" des combattants : squelette procédural, poses par état et par coup.
import type { Fighter } from '../sim/types';
import { getChar, skeletonStyle, PALETTE } from '../sim/chars';
import { lerp } from '../core/math';

// Angles en degrés. Membres : 0 = vers le bas, positif = vers l'avant (sens du regard).
// Torse : 0 = vertical, positif = penché en avant.
export interface Pose {
  lean: number;
  head: number;
  armL: [number, number];
  armR: [number, number];
  legL: [number, number];
  legR: [number, number];
  hipY: number;
  hipX: number;
  spin?: number; // rotation globale (roulade)
}

const P = (lean: number, head: number, armL: [number, number], armR: [number, number], legL: [number, number], legR: [number, number], hipY = 0, hipX = 0): Pose => ({ lean, head, armL, armR, legL, legR, hipY, hipX });

export const POSES: Record<string, Pose> = {
  idle: P(4, 2, [25, -45], [40, -75], [-12, 6], [14, -4]),
  guard: P(-2, 0, [55, -105], [75, -125], [-20, 10], [22, -8]),
  lowGuard: P(8, 0, [50, -100], [70, -120], [-55, 70], [50, 20], -22),
  jump: P(6, -4, [-20, -30], [60, -90], [-35, 55], [35, 30]),
  fall: P(-4, -8, [-40, -40], [-30, -60], [-20, 30], [25, 20]),
  hit: P(-16, -14, [-25, -30], [-40, -20], [-10, 10], [20, 0]),
  launch: P(-45, -30, [-60, -40], [-80, -30], [40, 20], [70, 10], 10),
  down: P(90, 8, [75, 5], [88, 0], [-86, 4], [-78, 10], -44),
  ko: P(90, 14, [70, 8], [100, -6], [-90, 0], [-70, 14], -45),
  getup: P(50, 4, [60, -40], [75, -60], [-70, 80], [40, 50], -24),
  stagger: P(-22, -20, [-30, -40], [30, -70], [-25, 15], [30, 0], 2),
  parry: P(10, 0, [30, -60], [95, -20], [-25, 12], [25, -8]),
  frozen: P(2, 0, [20, -40], [30, -60], [-10, 5], [12, -4]),
  win: P(-6, -10, [-30, -20], [185, -5], [-10, 5], [10, -5]),
  revive: P(28, 15, [70, -20], [80, -30], [-60, 100], [45, 60], -26),
  crouch: P(12, 2, [30, -60], [45, -80], [-60, 75], [55, 25], -24),
  shoot0: P(4, 0, [70, -10], [78, -8], [-14, 8], [18, -6]),
  shoot1: P(0, 0, [88, 0], [92, 0], [-18, 10], [22, -8], 0, -3),
  grab0: P(14, 4, [50, -20], [60, -20], [-14, 8], [22, -6]),
  grab1: P(24, 6, [88, 4], [92, 4], [-22, 12], [30, -10], 0, 6),
  // coups : [préparation, frappe]
  jab0: P(2, 0, [30, -60], [-25, -90], [-12, 6], [14, -4]),
  jab1: P(10, 0, [20, -50], [98, -2], [-16, 8], [22, -6]),
  cross0: P(-4, 0, [-20, -85], [45, -70], [-12, 6], [14, -4]),
  cross1: P(16, 2, [105, 0], [20, -50], [-22, 10], [30, -8], 0, 4),
  kick0: P(-6, 0, [30, -50], [-30, -60], [-14, 8], [-35, 45]),
  kick1: P(-14, 0, [-30, -40], [-50, -60], [-25, 12], [98, 2], 2),
  heavy0: P(-18, -6, [-60, -100], [-150, -40], [-15, 8], [10, 0], -4),
  heavy1: P(30, 10, [40, -30], [70, 10], [-30, 15], [35, -10], -2, 6),
  uppercut0: P(18, 6, [30, -40], [-20, -110], [-50, 60], [40, 20], -18),
  uppercut1: P(-12, -10, [-20, -30], [175, -5], [-15, 5], [30, -20], 10, 4),
  sweep0: P(14, 2, [40, -60], [-20, -70], [-60, 80], [-30, 40], -32),
  sweep1: P(26, 4, [-30, -60], [60, -30], [-65, 85], [92, 0], -34, 4),
  knee0: P(10, 0, [40, -70], [-30, -50], [-15, 8], [-20, 30]),
  knee1: P(14, -2, [-40, -50], [-60, -30], [-25, 12], [95, -20], 4, 6),
  airkick0: P(0, 0, [-20, -40], [40, -80], [-40, 60], [-20, 40]),
  airkick1: P(-10, -4, [-50, -40], [-20, -60], [-40, 60], [85, 70]),
  dive0: P(30, 0, [-40, -60], [-60, -60], [-20, 30], [20, 20]),
  dive1: P(65, 10, [60, 0], [90, -10], [-40, 20], [-20, 30], 6),
  special0: P(-8, 0, [-40, -110], [-50, -110], [-15, 8], [15, -4]),
  special1: P(12, 2, [95, -5], [100, 0], [-25, 12], [30, -8], 0, 4),
  rising0: P(20, 8, [20, -40], [-30, -120], [-55, 70], [45, 25], -20),
  rising1: P(-18, -14, [-30, -20], [178, -8], [-10, 0], [25, -30], 14, 2),
  super0: P(-10, 0, [-60, -100], [-70, -100], [-15, 8], [15, -4], -4),
  super1: P(14, 4, [110, 0], [100, -5], [-28, 14], [34, -10], 0, 6),
  charge0: P(20, 6, [-40, -70], [60, -90], [-20, 10], [20, -10]),
  charge1: P(38, 10, [-60, -60], [80, -110], [-45, 30], [50, -20], 2, 8),
  slam0: P(-16, -10, [-170, -10], [-175, -5], [-15, 8], [15, -4], 4),
  slam1: P(40, 20, [80, 40], [85, 45], [-55, 70], [50, 30], -22, 4),
  lasso0: P(-6, 0, [40, -70], [-120, -60], [-15, 8], [15, -4]),
  lasso1: P(12, 2, [30, -60], [100, 0], [-25, 12], [30, -8], 0, 4),
  backstab0: P(30, 8, [-50, -40], [-60, -50], [-30, 20], [35, -10], -6),
  backstab1: P(-10, 0, [40, -40], [-110, -10], [-20, 10], [25, -5], 0, 2),
  counter0: P(-4, 0, [60, -120], [80, -130], [-15, 8], [15, -4]),
  counter1: P(18, 4, [-20, -40], [105, 0], [-25, 12], [32, -8], 0, 6),
};

const ANIM_KEYS = ['shoot', 'grab', 'jab', 'cross', 'kick', 'heavy', 'uppercut', 'sweep', 'knee', 'airkick', 'dive', 'special', 'rising', 'super', 'charge', 'slam', 'lasso', 'backstab', 'counter'];

function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const l = (x: number, y: number) => lerp(x, y, t);
  return {
    lean: l(a.lean, b.lean),
    head: l(a.head, b.head),
    armL: [l(a.armL[0], b.armL[0]), l(a.armL[1], b.armL[1])],
    armR: [l(a.armR[0], b.armR[0]), l(a.armR[1], b.armR[1])],
    legL: [l(a.legL[0], b.legL[0]), l(a.legL[1], b.legL[1])],
    legR: [l(a.legR[0], b.legR[0]), l(a.legR[1], b.legR[1])],
    hipY: l(a.hipY, b.hipY),
    hipX: l(a.hipX, b.hipX),
    spin: l(a.spin ?? 0, b.spin ?? 0),
  };
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeIn(t: number): number {
  return t * t;
}

/** Calcule la pose courante d'un combattant (rendu uniquement : Math.sin autorisé). */
export function poseFor(f: Fighter, time: number): Pose {
  const s = f.state;
  const ph = time * 0.11 + f.id * 1.7;
  const breathe = Math.sin(ph) * 1.2;
  switch (s) {
    case 'idle': {
      const p = { ...POSES.idle, hipY: breathe };
      p.armL = [25 + Math.sin(ph) * 3, -45 + Math.sin(ph) * 2];
      p.armR = [40 + Math.sin(ph + 1) * 3, -75];
      return p;
    }
    case 'walk':
    case 'run': {
      const run = s === 'run';
      const speed = run ? 0.42 : 0.26;
      const w = time * speed + f.id;
      const amp = run ? 48 : 26;
      const sw = Math.sin(w);
      const p = P(run ? 18 : 6, run ? 4 : 1, [25 - sw * (run ? 55 : 22), run ? -90 : -50], [25 + sw * (run ? 55 : 22), run ? -90 : -50], [sw * amp, Math.max(0, -sw) * (run ? 90 : 40)], [-sw * amp, Math.max(0, sw) * (run ? 90 : 40)], Math.abs(sw) * (run ? 5 : 2));
      return p;
    }
    case 'jump':
      return f.vy > 2 ? POSES.jump : f.vy < -2 ? POSES.fall : lerpPose(POSES.jump, POSES.fall, 0.5);
    case 'guard':
      return f.lowGuard ? POSES.lowGuard : POSES.guard;
    case 'block': {
      const p = f.lowGuard ? POSES.lowGuard : POSES.guard;
      return { ...p, lean: p.lean - 8 + f.stateFrame * 0.5, hipX: -4 };
    }
    case 'hit':
      return lerpPose(POSES.hit, POSES.idle, Math.min(1, f.stateFrame / Math.max(1, f.hitFrames)) * 0.5);
    case 'launch':
      return { ...POSES.launch, lean: Math.max(-95, POSES.launch.lean - f.stateFrame * 2) };
    case 'down':
      return POSES.down;
    case 'ko':
      return f.y > 0.5 ? { ...POSES.launch, lean: Math.max(-100, -60 - f.stateFrame * 2) } : POSES.ko;
    case 'getup':
      return lerpPose(POSES.getup, POSES.idle, easeOut(f.stateFrame / 14));
    case 'stagger': {
      const p = { ...POSES.stagger };
      p.lean += Math.sin(f.stateFrame * 0.6) * 6;
      return p;
    }
    case 'parry':
      return lerpPose(POSES.parry, POSES.idle, easeIn(Math.min(1, f.stateFrame / 14)));
    case 'dodge': {
      const t = f.stateFrame / 20;
      const spin = (f.vx !== 0 ? 1 : 0) * t * 360 * (f.vx >= 0 === f.facing >= 0 ? 1 : -1);
      return { ...POSES.crouch, spin, hipY: -20 + Math.sin(t * Math.PI) * 6 };
    }
    case 'frozen':
      return POSES.frozen;
    case 'win': {
      const p = { ...POSES.win };
      p.armR = [185 + Math.sin(time * 0.3) * 10, -5];
      p.hipY = Math.abs(Math.sin(time * 0.25)) * 6;
      return p;
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
  if (m.id === 'shoot') return { ...POSES.shoot1, hipX: -Math.max(0, 3 - fr) };
  if (m.anim === 'tatsu') {
    const p = { ...POSES.airkick1 };
    p.spin = (fr % 14) / 14 * 360 * (fr > 4 ? 1 : 0);
    p.hipY = 8;
    return p;
  }
  if (m.anim === 'flurrykick') {
    const t = Math.floor(fr / 3) % 2;
    const p = { ...POSES.kick1 };
    p.legR = t ? [98, 2] : [-20, 20];
    p.legL = t ? [-20, 20] : [96, 2];
    p.lean = -10;
    return p;
  }
  if (m.anim === 'flash') {
    const p = { ...POSES.rising1 };
    p.spin = -Math.min(360, Math.max(0, (fr - 4) * 30));
    p.hipY = 14;
    return p;
  }
  const key = ANIM_KEYS.includes(m.anim) ? m.anim : 'jab';
  if (m.anim === 'jab' && m.multi) { const p = { ...POSES.jab1 }; p.armR = fr % 4 < 2 ? [98, -2] : [30, -50]; p.armL = fr % 4 < 2 ? [30, -50] : [98, -2]; if (fr > m.startup && fr <= m.startup + m.active) return p; }
  const p0 = POSES[key + '0'] ?? POSES.jab0;
  const p1 = POSES[key + '1'] ?? POSES.jab1;
  if (key === 'super') {
    // alternance rapide pendant les frames actives
    if (fr <= m.startup) return lerpPose(POSES.idle, p0, easeOut(fr / Math.max(1, m.startup)));
    if (fr <= activeEnd) return (Math.floor((fr - m.startup) / 4) % 2 === 0) ? p1 : POSES.cross1;
    return lerpPose(p1, POSES.idle, easeOut((fr - activeEnd) / Math.max(1, m.recovery)));
  }
  if (fr <= m.startup) {
    const t = fr / Math.max(1, m.startup);
    // préparation : idle -> p0 (65 % du temps), puis p0 -> p1 très vite
    if (t < 0.65) return lerpPose(POSES.idle, p0, easeOut(t / 0.65));
    return lerpPose(p0, p1, easeIn((t - 0.65) / 0.35));
  }
  if (fr <= activeEnd) {
    const p = { ...p1 };
    if (m.multi) p.armR = [p1.armR[0] + Math.sin(time * 1.5) * 15, p1.armR[1]];
    return p;
  }
  return lerpPose(p1, POSES.idle, easeOut((fr - activeEnd) / Math.max(1, m.recovery)));
}

// ---------------------------------------------------------------------------
// Dessin
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

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
}

export function colorsFor(f: Fighter): { main: string; dark: string; glow: string } {
  const pal = PALETTE[f.color % PALETTE.length] ?? PALETTE[0];
  return pal;
}

export function drawStickman(ctx: CanvasRenderingContext2D, f: Fighter, pose: Pose, o: DrawOpts): void {
  drawBody(ctx, f, pose, o, false);
  if (o.flash && o.flash > 0) drawBody(ctx, f, pose, { ...o, alpha: (o.alpha ?? 1) * Math.min(0.85, o.flash) }, true);
}

function drawBody(ctx: CanvasRenderingContext2D, f: Fighter, pose: Pose, o: DrawOpts, tint: boolean): void {
  const c = getChar(f.charId);
  const sk = skeletonStyle(c);
  const col = colorsFor(f);
  const S = o.scale * sk.scale;
  const fx = o.facing;
  const thick = sk.thickness * S;
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.globalAlpha = o.alpha ?? 1;
  if (pose.spin) {
    ctx.translate(0, -50 * S);
    ctx.rotate(pose.spin * DEG * fx);
    ctx.translate(0, 50 * S);
  }
  // squelette : hanche
  const hipX = pose.hipX * fx * S;
  const hipY = -(50 + pose.hipY) * S;
  const lean = pose.lean * DEG;
  const torsoLen = 34 * S;
  const neckX = hipX + Math.sin(lean) * torsoLen * fx;
  const neckY = hipY - Math.cos(lean) * torsoLen;
  const headR = sk.headR * S;
  const headAng = (pose.lean + pose.head) * DEG;
  const headX = neckX + Math.sin(headAng) * (headR + 3 * S) * fx;
  const headY = neckY - Math.cos(headAng) * (headR + 3 * S);
  const shoulderX = hipX + Math.sin(lean) * torsoLen * 0.9 * fx;
  const shoulderY = hipY - Math.cos(lean) * torsoLen * 0.9;

  const limb = (ox: number, oy: number, a1: number, l1: number, a2: number, l2: number): [number, number, number, number] => {
    const x1 = ox + Math.sin(a1 * DEG) * l1 * fx;
    const y1 = oy + Math.cos(a1 * DEG) * l1;
    const x2 = x1 + Math.sin(a2 * DEG) * l2 * fx;
    const y2 = y1 + Math.cos(a2 * DEG) * l2;
    return [x1, y1, x2, y2];
  };
  const UA = 22 * S, FA = 22 * S, TH = 26 * S, SH = 26 * S;
  const aL = limb(shoulderX, shoulderY, pose.armL[0], UA, pose.armL[0] + pose.armL[1], FA);
  const aR = limb(shoulderX, shoulderY, pose.armR[0], UA, pose.armR[0] + pose.armR[1], FA);
  const lL = limb(hipX, hipY, pose.legL[0], TH, pose.legL[0] + pose.legL[1], SH);
  const lR = limb(hipX, hipY, pose.legR[0], TH, pose.legR[0] + pose.legR[1], SH);

  const main = tint ? '#ffffff' : o.ghost ? col.glow : col.main;
  const dark = tint ? '#ffffff' : (o.outline ?? (o.ghost ? col.main : f.rage ? '#4a0a0a' : f.boss ? '#3a2a00' : '#141622'));

  const strokePath = (pts: number[][], width: number, color: string) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  // ordre : membre arrière, corps, membre avant
  const back = [[[shoulderX, shoulderY], [aL[0], aL[1]], [aL[2], aL[3]]], [[hipX, hipY], [lL[0], lL[1]], [lL[2], lL[3]]]];
  const front = [[[shoulderX, shoulderY], [aR[0], aR[1]], [aR[2], aR[3]]], [[hipX, hipY], [lR[0], lR[1]], [lR[2], lR[3]]]];
  const body = [[hipX, hipY], [neckX, neckY]];

  // cape / accessoires arrière
  if (!tint) drawAccessoryBack(ctx, sk.accessory, neckX, neckY, shoulderX, shoulderY, fx, S, col, o.time, f);

  // contours
  for (const pts of back) strokePath(pts, thick + 3.5 * S, dark);
  strokePath(body, thick + 4.5 * S, dark);
  for (const pts of front) strokePath(pts, thick + 3.5 * S, dark);
  // remplissage couleur
  const backColor = o.ghost || tint ? main : shade(main, -0.22);
  for (const pts of back) strokePath(pts, thick, backColor);
  strokePath(body, thick + 1.2 * S, main);
  for (const pts of front) strokePath(pts, thick, main);
  // mains / pieds
  for (const [px, py] of [[aL[2], aL[3]], [aR[2], aR[3]], [lL[2], lL[3]], [lR[2], lR[3]]]) {
    ctx.beginPath();
    ctx.arc(px, py, thick * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = dark;
    ctx.fill();
  }
  // arme tenue dans la main avant
  if (f.weapon > 0 && f.weaponKind && !tint) drawHeldWeapon(ctx, f.weaponKind, aR[2], aR[3], (pose.armR[0] + pose.armR[1]) * DEG, fx, S, thick, o.time);
  // tête
  ctx.beginPath();
  ctx.arc(headX, headY, headR + 2.2 * S, 0, Math.PI * 2);
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(headX, headY, headR, 0, Math.PI * 2);
  ctx.fillStyle = o.ghost || tint ? main : '#f3e9dc';
  ctx.fill();
  // yeux
  const ko = f.state === 'ko';
  if (tint) { ctx.restore(); return; }
  ctx.strokeStyle = '#141622';
  ctx.lineWidth = 1.6 * S;
  const ex = headX + fx * headR * 0.35;
  const ey = headY - headR * 0.1;
  if (ko) {
    for (const dx of [-3, 3]) {
      ctx.beginPath();
      ctx.moveTo(ex + (dx - 2) * S, ey - 2 * S); ctx.lineTo(ex + (dx + 2) * S, ey + 2 * S);
      ctx.moveTo(ex + (dx + 2) * S, ey - 2 * S); ctx.lineTo(ex + (dx - 2) * S, ey + 2 * S);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#141622';
    ctx.beginPath();
    ctx.arc(ex, ey, 1.6 * S, 0, Math.PI * 2);
    ctx.fill();
    // sourcil (expression)
    const angry = f.state === 'attack' || f.comboHits > 2;
    ctx.beginPath();
    ctx.moveTo(ex - 4 * S, ey - (angry ? 3 : 5) * S);
    ctx.lineTo(ex + 3 * S, ey - (angry ? 5.5 : 5) * S);
    ctx.stroke();
  }
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
      ctx.strokeStyle = acc === 'ponytail' ? '#141622' : col.main;
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
      ctx.strokeStyle = col.main;
      ctx.stroke();
      break;
    case 'horns':
      for (const d of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + d * r * 0.6, hy - r * 0.7);
        ctx.lineTo(hx + d * r * 1.1, hy - r * 1.7);
        ctx.lineWidth = 3.5 * S;
        ctx.strokeStyle = '#141622';
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
      ctx.strokeStyle = col.main;
      ctx.stroke();
      break;
    case 'bands':
      // bandes aux poignets dessinées sur les mains ? (simplifié : bandeau)
      ctx.beginPath();
      ctx.moveTo(hx - r, hy - r * 0.4);
      ctx.lineTo(hx + r, hy - r * 0.4);
      ctx.lineWidth = 2.6 * S;
      ctx.strokeStyle = '#141622';
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
