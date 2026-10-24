// Chapeaux et auras (rendu seulement : Math.sin autorisé).

const INK = '#06101e';

function tri(ctx: CanvasRenderingContext2D, pts: number[][], fill: string, lw: number): void {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

/** Chapeau posé sur la tête (hx, hy = centre de la tête, r = rayon). */
export function drawHat(ctx: CanvasRenderingContext2D, hat: string, hx: number, hy: number, r: number, fx: number, S: number, time: number): void {
  if (!hat) return;
  const lw = Math.max(1.5, 2.2 * S);
  ctx.save();
  ctx.translate(hx, hy - r * 0.55);
  ctx.lineJoin = 'round';
  switch (hat) {
    case 'cap':
      tri(ctx, [[-r * 1.0, 0], [-r * 0.8, -r * 0.9], [r * 0.7, -r * 0.9], [r * 1.0, 0]], '#d93a3a', lw);
      tri(ctx, [[r * 0.6 * fx, -r * 0.1], [r * 1.9 * fx, r * 0.05], [r * 0.6 * fx, r * 0.25]], '#a82424', lw);
      break;
    case 'tophat':
      tri(ctx, [[-r * 1.3, 0], [-r * 1.3, -r * 0.25], [r * 1.3, -r * 0.25], [r * 1.3, 0]], '#1b1f2e', lw);
      tri(ctx, [[-r * 0.8, -r * 0.25], [-r * 0.8, -r * 1.9], [r * 0.8, -r * 1.9], [r * 0.8, -r * 0.25]], '#232838', lw);
      ctx.fillStyle = '#d93a3a'; ctx.fillRect(-r * 0.8, -r * 0.62, r * 1.6, r * 0.3);
      break;
    case 'party':
      tri(ctx, [[-r * 0.8, 0], [0, -r * 2.2], [r * 0.8, 0]], '#ff5fb0', lw);
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(0, -r * 2.25, r * 0.28, 0, 7); ctx.fill();
      ctx.fillStyle = '#4fd8ff'; ctx.fillRect(-r * 0.4, -r * 0.9, r * 0.2, r * 0.2); ctx.fillRect(r * 0.15, -r * 1.4, r * 0.2, r * 0.2);
      break;
    case 'halo': {
      const bob = Math.sin(time * 0.1) * r * 0.1;
      ctx.translate(0, -r * 0.9 + bob);
      ctx.strokeStyle = INK; ctx.lineWidth = lw + 3 * S; ctx.beginPath(); ctx.ellipse(0, 0, r * 1.0, r * 0.28, 0, 0, 7); ctx.stroke();
      ctx.strokeStyle = '#ffe98a'; ctx.lineWidth = Math.max(1.5, 3 * S); ctx.beginPath(); ctx.ellipse(0, 0, r * 1.0, r * 0.28, 0, 0, 7); ctx.stroke();
      break;
    }
    case 'wizard':
      tri(ctx, [[-r * 1.5, 0], [-r * 0.9, -r * 0.2], [r * 0.9, -r * 0.2], [r * 1.5, 0]], '#3b2a8a', lw);
      tri(ctx, [[-r * 0.85, -r * 0.2], [r * 0.15 * fx, -r * 2.5], [r * 0.85, -r * 0.2]], '#4a35b0', lw);
      ctx.fillStyle = '#ffe14d'; ctx.beginPath(); ctx.arc(-r * 0.1, -r * 1.1, r * 0.2, 0, 7); ctx.fill();
      break;
    case 'viking':
      tri(ctx, [[-r * 1.0, 0], [-r * 0.9, -r * 0.9], [r * 0.9, -r * 0.9], [r * 1.0, 0]], '#9aa4b5', lw);
      tri(ctx, [[-r * 0.9, -r * 0.5], [-r * 1.9, -r * 1.4], [-r * 1.2, -r * 0.2]], '#f2ead2', lw);
      tri(ctx, [[r * 0.9, -r * 0.5], [r * 1.9, -r * 1.4], [r * 1.2, -r * 0.2]], '#f2ead2', lw);
      break;
    case 'crown': {
      const pts: number[][] = [[-r * 0.9, 0], [-r * 0.9, -r * 1.1], [-r * 0.45, -r * 0.6], [0, -r * 1.3], [r * 0.45, -r * 0.6], [r * 0.9, -r * 1.1], [r * 0.9, 0]];
      tri(ctx, pts, '#ffcf3a', lw);
      ctx.fillStyle = '#d93a3a'; ctx.beginPath(); ctx.arc(0, -r * 0.35, r * 0.17, 0, 7); ctx.fill();
      break;
    }
  }
  ctx.restore();
}

const AURA_COL: Record<string, string[]> = {
  sparks: ['#fff7a8', '#ffe14d', '#ffffff'],
  fire: ['#ff5a2a', '#ff9a3d', '#ffd24d'],
  frost: ['#bff3ff', '#7fd8ff', '#ffffff'],
  shadow: ['#2a1a40', '#4b2a78', '#14081f'],
  rainbow: ['#ff5f5f', '#ffd24d', '#7dff9a', '#4fd8ff', '#b07cff'],
  gold: ['#ffd24d', '#fff1a0', '#e0a21a'],
};

/** Aura : particules qui tournent autour du corps ; plus denses quand le combattant bouge vite. */
export function drawAura(ctx: CanvasRenderingContext2D, aura: string, sx: number, sy: number, s: number, time: number, seed: number, speed: number): void {
  const cols = AURA_COL[aura];
  if (!cols) return;
  const n = 12 + Math.min(8, Math.round(speed * 2));
  ctx.save();
  const g = ctx.createRadialGradient(sx, sy - 40 * s, 4 * s, sx, sy - 40 * s, 70 * s);
  g.addColorStop(0, cols[0] + '55'); g.addColorStop(1, cols[0] + '00');
  ctx.fillStyle = g; ctx.beginPath(); ctx.ellipse(sx, sy - 40 * s, 56 * s, 76 * s, 0, 0, 7); ctx.fill();
  for (let i = 0; i < n; i++) {
    const a = time * 0.06 + (i / n) * Math.PI * 2 + seed;
    const rise = ((time * 0.02 + i * 0.37 + seed) % 1);
    const rx = 34 * s, ry = 13 * s;
    const px = sx + Math.cos(a) * rx * (1 - rise * 0.35);
    const py = sy - rise * 120 * s + Math.sin(a) * ry;
    const c = cols[i % cols.length];
    ctx.globalAlpha = (1 - rise) * (aura === 'shadow' ? 0.7 : 0.85);
    ctx.fillStyle = c;
    const sz = (aura === 'fire' ? 11 * (1 - rise * 0.6) : aura === 'shadow' ? 13 : 7) * s;
    if (aura === 'frost' || aura === 'sparks' || aura === 'gold') {
      ctx.beginPath(); ctx.moveTo(px, py - sz * 1.5); ctx.lineTo(px + sz, py); ctx.lineTo(px, py + sz * 1.5); ctx.lineTo(px - sz, py); ctx.closePath(); ctx.fill();
    } else { ctx.beginPath(); ctx.arc(px, py, sz, 0, 7); ctx.fill(); }
  }
  ctx.restore();
}
