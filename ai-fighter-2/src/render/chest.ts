// Coffre de fin de vague : bois, argent, or, légendaire.
export const TIER_NAME = ['Coffre en bois', 'Coffre d\'argent', 'Coffre d\'or', 'Coffre légendaire'];
const BODY = ['#8a5a2b', '#9aa7b8', '#d9a62a', '#b06bff'];
const LID = ['#a86f36', '#c3cedb', '#f2c445', '#d29aff'];
const GLOW = ['255,220,150', '200,230,255', '255,215,90', '210,150,255'];

export function drawChestObj(ctx: CanvasRenderingContext2D, sx: number, sy: number, s: number, tier: number, opening: number, time: number): void {
  const t = Math.min(3, tier);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(s * 1.3, s * 1.3);
  // lueur
  const pulse = opening ? 1 : 0.6 + Math.sin(time * 0.12) * 0.25;
  const g = ctx.createRadialGradient(0, -20, 4, 0, -20, 70);
  g.addColorStop(0, `rgba(${GLOW[t]},${0.45 * pulse})`); g.addColorStop(1, `rgba(${GLOW[t]},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, -20, 70, 0, 7); ctx.fill();
  const shake = opening && opening < 56 ? Math.sin(opening * 1.6) * 2.5 : 0;
  ctx.translate(shake, 0);
  const lidOpen = opening > 56 ? Math.min(1, (opening - 56) / 10) : 0;
  ctx.strokeStyle = '#06101e'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
  ctx.fillStyle = BODY[t]; ctx.fillRect(-34, -34, 68, 34); ctx.strokeRect(-34, -34, 68, 34);
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(-34, -14, 68, 6);
  ctx.save();
  ctx.translate(-34, -34);
  ctx.rotate(-lidOpen * 1.1);
  ctx.fillStyle = LID[t];
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(34, -34, 68, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#ffe98a'; ctx.fillRect(-5, -34, 10, 14); ctx.strokeRect(-5, -34, 10, 14);
  if (lidOpen > 0) {
    ctx.fillStyle = `rgba(${GLOW[t]},0.85)`;
    ctx.beginPath(); ctx.moveTo(-26, -34); ctx.lineTo(-60 - lidOpen * 20, -150); ctx.lineTo(60 + lidOpen * 20, -150); ctx.lineTo(26, -34); ctx.closePath(); ctx.globalAlpha = 0.35 * (1 - Math.max(0, (opening - 70) / 25)); ctx.fill();
  }
  ctx.restore();
}
