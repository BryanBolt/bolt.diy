// Dessin des armes : le manche part de l'origine et l'arme s'étend vers +x (l'appelant oriente et place).
import type { WeaponKind } from '../sim/types';

const INK = '#141622';

function bar(ctx: CanvasRenderingContext2D, x0: number, x1: number, w: number, fill: string, ink = true): void {
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x1, 0);
  if (ink) { ctx.lineWidth = w + 3; ctx.strokeStyle = INK; ctx.stroke(); }
  ctx.lineWidth = w; ctx.strokeStyle = fill; ctx.stroke();
}

export function weaponLength(kind: WeaponKind): number {
  switch (kind) {
    case 'bat': return 46;
    case 'nunchaku': return 42;
    case 'katana': return 66;
    case 'sword': return 58;
    case 'spear': return 92;
    case 'axe': return 52;
    case 'hammer': return 50;
    case 'laser': return 64;
    case 'shotgun': return 46;
    case 'ak': return 40;
    default: return 20;
  }
}

export function drawWeapon(ctx: CanvasRenderingContext2D, kind: WeaponKind, S: number, time: number, thick = 4): void {
  ctx.save();
  ctx.lineJoin = 'round';
  switch (kind) {
    case 'bat':
      bar(ctx, -8 * S, 46 * S, thick + 3 * S, '#c98a4b');
      bar(ctx, 24 * S, 46 * S, thick + 5 * S, '#c98a4b');
      break;
    case 'nunchaku': {
      const sw = Math.sin(time * 0.5) * 8 * S;
      for (const [w, c, ink] of [[thick + 2.5 * S, INK, false], [thick - 1 * S, '#8a5a2b', false]] as [number, string, boolean][]) {
        ctx.lineCap = 'round'; ctx.lineWidth = w; ctx.strokeStyle = c;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(20 * S, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(20 * S, 0); ctx.lineTo(40 * S, sw); ctx.stroke();
        void ink;
      }
      break;
    }
    case 'katana':
      bar(ctx, -10 * S, 4 * S, thick, '#2a2f3a');
      ctx.fillStyle = INK; ctx.fillRect(3 * S, -7 * S, 3.5 * S, 14 * S); // garde
      ctx.fillStyle = '#d9b650'; ctx.fillRect(3.6 * S, -5.4 * S, 2.2 * S, 10.8 * S);
      ctx.beginPath(); ctx.moveTo(6 * S, -2.6 * S); ctx.lineTo(60 * S, -1.5 * S); ctx.lineTo(68 * S, 1 * S); ctx.lineTo(6 * S, 2.6 * S); ctx.closePath();
      ctx.fillStyle = '#e8eef6'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = INK; ctx.stroke();
      break;
    case 'sword':
      bar(ctx, -10 * S, 4 * S, thick, '#6b4a2a');
      ctx.fillStyle = INK; ctx.fillRect(2 * S, -10 * S, 4.5 * S, 20 * S);
      ctx.fillStyle = '#c9a23a'; ctx.fillRect(2.8 * S, -8.6 * S, 2.8 * S, 17.2 * S);
      ctx.beginPath(); ctx.moveTo(6.5 * S, -5 * S); ctx.lineTo(50 * S, -4 * S); ctx.lineTo(60 * S, 0); ctx.lineTo(50 * S, 4 * S); ctx.lineTo(6.5 * S, 5 * S); ctx.closePath();
      ctx.fillStyle = '#dfe6ee'; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
      ctx.strokeStyle = '#9aa7b8'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(10 * S, 0); ctx.lineTo(52 * S, 0); ctx.stroke();
      break;
    case 'spear':
      bar(ctx, -14 * S, 74 * S, thick * 0.9, '#8a6a3a');
      ctx.beginPath(); ctx.moveTo(72 * S, -6 * S); ctx.lineTo(94 * S, 0); ctx.lineTo(72 * S, 6 * S); ctx.closePath();
      ctx.fillStyle = '#e8eef6'; ctx.fill(); ctx.lineWidth = 1.8; ctx.strokeStyle = INK; ctx.stroke();
      ctx.fillStyle = '#c0392b'; ctx.fillRect(66 * S, -3 * S, 6 * S, 6 * S);
      break;
    case 'axe':
      bar(ctx, -8 * S, 46 * S, thick, '#7a5630');
      ctx.beginPath(); ctx.moveTo(36 * S, -3 * S); ctx.quadraticCurveTo(40 * S, -22 * S, 56 * S, -16 * S); ctx.lineTo(54 * S, 14 * S); ctx.quadraticCurveTo(40 * S, 20 * S, 36 * S, 3 * S); ctx.closePath();
      ctx.fillStyle = '#c8d0da'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = INK; ctx.stroke();
      break;
    case 'hammer':
      bar(ctx, -8 * S, 40 * S, thick, '#7a5630');
      ctx.fillStyle = INK; ctx.fillRect(34 * S, -14 * S, 22 * S, 28 * S);
      ctx.fillStyle = '#9aa3b2'; ctx.fillRect(35.6 * S, -12.4 * S, 18.8 * S, 24.8 * S);
      ctx.fillStyle = '#c3cad6'; ctx.fillRect(35.6 * S, -12.4 * S, 18.8 * S, 6 * S);
      break;
    case 'laser': {
      bar(ctx, -8 * S, 8 * S, thick + 1 * S, '#3a3f4a');
      const pulse = 0.85 + Math.sin(time * 0.6) * 0.15;
      ctx.shadowColor = '#4fe3ff'; ctx.shadowBlur = 16 * pulse;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(8 * S, 0); ctx.lineTo(64 * S, 0);
      ctx.lineWidth = (thick + 5 * S) * pulse; ctx.strokeStyle = 'rgba(79,227,255,0.85)'; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.lineWidth = Math.max(2, thick * 0.55); ctx.strokeStyle = '#ffffff'; ctx.stroke();
      break;
    }
    case 'shotgun':
      ctx.fillStyle = INK; ctx.fillRect(-12 * S, -3.5 * S, 12 * S, 8 * S);
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-11 * S, -2.5 * S, 10 * S, 6 * S);
      ctx.fillStyle = INK; ctx.fillRect(0, -4 * S, 46 * S, 7 * S);
      ctx.fillStyle = '#4a505c'; ctx.fillRect(1, -3 * S, 44 * S, 5 * S);
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(14 * S, 2 * S, 14 * S, 4.5 * S);
      break;
    case 'ak':
      ctx.fillStyle = INK; ctx.fillRect(-12 * S, -3 * S, 12 * S, 6 * S);
      ctx.fillStyle = '#8a5a2b'; ctx.fillRect(-11 * S, -2 * S, 10 * S, 4 * S);
      ctx.fillStyle = INK; ctx.fillRect(0, -3.5 * S, 40 * S, 7 * S);
      ctx.fillStyle = '#3a3f4a'; ctx.fillRect(1, -2.5 * S, 38 * S, 5 * S);
      ctx.fillStyle = INK; ctx.beginPath(); ctx.moveTo(16 * S, 3 * S); ctx.lineTo(22 * S, 14 * S); ctx.lineTo(17 * S, 15 * S); ctx.lineTo(12 * S, 3 * S); ctx.fill();
      break;
    case 'pistol':
      ctx.fillStyle = INK; ctx.fillRect(0, -3.5 * S, 18 * S, 7 * S); ctx.fillRect(0, 0, 5 * S, 10 * S);
      ctx.fillStyle = '#2a2f3a'; ctx.fillRect(1, -2.5 * S, 16 * S, 5 * S);
      break;
  }
  ctx.restore();
}
