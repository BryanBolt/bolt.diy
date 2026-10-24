// Rendu des objets du rogue-lite sur le personnage : chaque amélioration se voit (taille, ailes, pointes, flammes, orbes…).
import type { Fighter } from '../sim/types';
import { stacks } from '../sim/bonuses';

const has = (f: Fighter, b: string) => f.bonuses.includes(b as never);

/** Le personnage grandit avec Force, Champignon et Vitalité. */
export function growthScale(f: Fighter): number {
  if (!f.bonuses.length) return 1;
  const g = 0.055 * Math.min(8, stacks(f.bonuses, 'power') + stacks(f.bonuses, 'growth') * 1.5) + 0.015 * Math.min(6, stacks(f.bonuses, 'vitality'));
  return 1 + Math.min(0.6, g);
}

/** Objets sans effet de corps dédié : une icône qui orbite au-dessus de l'épaule. */
const FAMILIARS: Record<string, string> = { lifesteal: '🩸', kiflow: '🌀', crit: '🎲', shockwave: '💥', explode: '🧨', midas: '🪙', superflow: '🌟', regen: '💛', tears: '💧', vitality: '❤️', phoenix: '🔆' };

/** Calque arrière : ailes, traînée de vitesse, lueurs. */
export function drawItemsBack(ctx: CanvasRenderingContext2D, f: Fighter, sx: number, sy: number, s: number, time: number): void {
  if (!f.bonuses.length) return;
  ctx.save();
  const sp = stacks(f.bonuses, 'speed');
  if (sp) {
    // traînée de vitesse : des traits qui s'allongent à chaque prise
    const dir = -f.facing;
    ctx.strokeStyle = 'rgba(140,230,255,0.55)';
    ctx.lineCap = 'round';
    const mv = Math.min(1.4, 0.45 + Math.abs(f.vx) * 0.12);
    for (let i = 0; i < 2 + sp * 2; i++) {
      const y = sy - (18 + (i * 29) % 100) * s;
      const len = (22 + sp * 10) * mv * s;
      ctx.lineWidth = 2.4 * s;
      ctx.globalAlpha = 0.5 - i * 0.025;
      ctx.beginPath(); ctx.moveTo(sx + dir * 14 * s, y); ctx.lineTo(sx + dir * (14 * s + len + Math.sin(time * 0.3 + i) * 5), y); ctx.stroke();
    }
  }
  if (has(f, 'doublejump') || has(f, 'phoenix')) {
    const fire = has(f, 'phoenix');
    const flap = Math.sin(time * 0.2) * 0.18;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(sx, sy - 78 * s);
      ctx.scale(side, 1);
      ctx.rotate(flap);
      ctx.globalAlpha = 0.9;
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = fire ? ['#ff5a2a', '#ff8a3d', '#ffc24d', '#ffe98a'][k] : ['#e8f3ff', '#d2e6fb', '#bcd8f5', '#a6c9ee'][k];
        ctx.beginPath();
        ctx.moveTo(6 * s, 0);
        ctx.quadraticCurveTo((40 + k * 8) * s, (-34 + k * 14) * s, (58 + k * 10) * s, (-8 + k * 22) * s);
        ctx.quadraticCurveTo((30 + k * 4) * s, (6 + k * 10) * s, 6 * s, 10 * s);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  if (has(f, 'midas')) {
    const g = ctx.createRadialGradient(sx, sy - 60 * s, 4 * s, sx, sy - 60 * s, 70 * s);
    g.addColorStop(0, 'rgba(255,215,80,0.35)'); g.addColorStop(1, 'rgba(255,215,80,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 60 * s, 70 * s, 0, 7); ctx.fill();
  }
  if (has(f, 'berserk') && f.hp < f.hpMax * 0.35) {
    const g = ctx.createRadialGradient(sx, sy - 60 * s, 6 * s, sx, sy - 60 * s, 80 * s);
    g.addColorStop(0, `rgba(255,40,40,${0.35 + Math.sin(time * 0.4) * 0.12})`); g.addColorStop(1, 'rgba(255,40,40,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy - 60 * s, 80 * s, 0, 7); ctx.fill();
  }
  ctx.restore();
}

/** Calque avant : pointes, plaques, flammes, cristaux, bulle de garde, icônes en orbite. */
export function drawItemsFront(ctx: CanvasRenderingContext2D, f: Fighter, sx: number, sy: number, s: number, time: number): void {
  if (!f.bonuses.length) return;
  ctx.save();
  const mid = sy - 62 * s;
  if (has(f, 'armor')) {
    ctx.fillStyle = '#8d9aae'; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 2 * s;
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.ellipse(sx + side * 17 * s, sy - 86 * s, 11 * s, 7 * s, side * 0.4, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  if (has(f, 'thorns')) {
    const n = 5 + stacks(f.bonuses, 'thorns') * 2;
    ctx.fillStyle = '#d8d2c2'; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 1.5 * s;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.3;
      const bx = sx + Math.cos(a) * 15 * s, by = mid + Math.sin(a) * 26 * s;
      const tx = sx + Math.cos(a) * 28 * s, ty = mid + Math.sin(a) * 38 * s;
      ctx.beginPath(); ctx.moveTo(bx + Math.sin(a) * 4 * s, by - Math.cos(a) * 4 * s); ctx.lineTo(tx, ty); ctx.lineTo(bx - Math.sin(a) * 4 * s, by + Math.cos(a) * 4 * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  if (has(f, 'burn')) {
    for (let i = 0; i < 4; i++) {
      const t = (time * 0.06 + i * 0.27) % 1;
      const px = sx + (i % 2 ? 1 : -1) * (14 + i * 3) * s, py = sy - (82 + t * 26) * s;
      ctx.globalAlpha = 1 - t; ctx.fillStyle = i % 2 ? '#ff8a3d' : '#ffd24d';
      ctx.beginPath(); ctx.ellipse(px, py, (5 - t * 3) * s, (9 - t * 4) * s, 0, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  if (has(f, 'frost')) {
    ctx.fillStyle = 'rgba(190,243,255,0.9)'; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 1.5 * s;
    for (const [dx, dy, h] of [[-20, -72, 16], [22, -64, 13], [-12, -34, 11], [16, -92, 12]]) {
      ctx.beginPath(); ctx.moveTo(sx + dx * s, sy + dy * s - h * s); ctx.lineTo(sx + (dx + 5) * s, sy + dy * s); ctx.lineTo(sx + (dx - 5) * s, sy + dy * s); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
  const gd = stacks(f.bonuses, 'guard');
  if (gd) {
    ctx.strokeStyle = `rgba(120,190,255,${0.35 + gd * 0.08})`; ctx.fillStyle = 'rgba(120,190,255,0.07)'; ctx.lineWidth = (2 + gd) * s;
    ctx.beginPath(); ctx.ellipse(sx, mid, 38 * s, 62 * s, 0, 0, 7); ctx.fill(); ctx.stroke();
  }
  // icônes en orbite (une par objet distinct)
  const icons = [...new Set(f.bonuses.filter((b) => FAMILIARS[b]))];
  ctx.font = `${Math.round(15 * s)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  icons.forEach((b, i) => {
    const a = time * 0.035 + (i / icons.length) * Math.PI * 2;
    ctx.fillText(FAMILIARS[b], sx + Math.cos(a) * 44 * s, sy - 128 * s + Math.sin(a) * 10 * s - Math.abs(Math.sin(a)) * 4 * s);
  });
  ctx.restore();
}

/** Orbes satellites : positions identiques à la simulation (monde → écran via `project`). */
export function drawOrbs(ctx: CanvasRenderingContext2D, pts: { sx: number; sy: number; s: number }[], time: number, burn: boolean): void {
  ctx.save();
  for (const p of pts) {
    const r = 9 * p.s;
    const g = ctx.createRadialGradient(p.sx, p.sy, 1, p.sx, p.sy, r * 2);
    g.addColorStop(0, burn ? 'rgba(255,200,80,0.95)' : 'rgba(190,150,255,0.95)'); g.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 2, 0, 7); ctx.fill();
    ctx.fillStyle = burn ? '#fff1b0' : '#f1e6ff'; ctx.beginPath(); ctx.arc(p.sx, p.sy, r * 0.55 + Math.sin(time * 0.2) * 0.8, 0, 7); ctx.fill();
  }
  ctx.restore();
}
