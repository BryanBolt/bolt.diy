// Caisses et barils en « low poly » : facettes planes, reflets animés. L'origine est le centre du bas ; l'objet s'étend vers le haut.
const INK = '#141622';

function poly(ctx: CanvasRenderingContext2D, pts: number[], fill: string, stroke = INK): void {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = stroke;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

export const CRATE_COLORS: Record<string, [string, string]> = {
  wood: ['#d9a35a', '#8a5a2b'],
  metal: ['#b9c3d0', '#5d6878'],
  explosive: ['#ff6a4a', '#9c1f12'],
  ice: ['#bff3ff', '#4ab3d8'],
  poison: ['#9aff6a', '#2f8f1d'],
};

export function drawCrate(ctx: CanvasRenderingContext2D, cv: string, s: number, time: number, damaged = false): void {
  const w = 46 * s, h = 42 * s;
  const [light, dark] = CRATE_COLORS[cv] ?? CRATE_COLORS.wood;
  ctx.save();
  if (cv === 'explosive' || cv === 'poison') {
    // baril : tronc facetté (6 pans) + couvercle losange
    const bw = 40 * s, bh = 46 * s;
    const pulse = 0.6 + Math.sin(time * 0.18) * 0.4;
    ctx.shadowColor = cv === 'explosive' ? `rgba(255,90,40,${0.7 * pulse})` : `rgba(120,255,60,${0.6 * pulse})`;
    ctx.shadowBlur = 14 * s;
    poly(ctx, [-bw / 2, 0, -bw / 2, -bh, -bw / 6, -bh - 4 * s, -bw / 6, -4 * s], dark);
    poly(ctx, [-bw / 6, -4 * s, -bw / 6, -bh - 4 * s, bw / 6, -bh - 4 * s, bw / 6, -4 * s], light);
    poly(ctx, [bw / 6, -4 * s, bw / 6, -bh - 4 * s, bw / 2, -bh, bw / 2, 0], dark);
    ctx.shadowBlur = 0;
    // bandes + symbole
    ctx.fillStyle = INK;
    ctx.fillRect(-bw / 2, -bh * 0.72, bw, 4 * s);
    ctx.fillRect(-bw / 2, -bh * 0.22, bw, 4 * s);
    ctx.fillStyle = cv === 'explosive' ? '#ffe14d' : '#1b2a10';
    ctx.beginPath();
    ctx.moveTo(0, -bh * 0.62); ctx.lineTo(8 * s, -bh * 0.3); ctx.lineTo(-8 * s, -bh * 0.3);
    ctx.closePath();
    ctx.fill();
    if (cv === 'poison') {
      // bulles qui montent
      ctx.fillStyle = 'rgba(190,255,150,0.85)';
      for (let i = 0; i < 3; i++) { const p = (time * 0.04 + i * 0.37) % 1; ctx.beginPath(); ctx.arc((i - 1) * 9 * s, -bh - 4 * s - p * 22 * s, (3 - p * 2) * s, 0, Math.PI * 2); ctx.fill(); }
    } else {
      // mèche qui crépite
      ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -bh - 4 * s); ctx.lineTo(4 * s, -bh - 10 * s); ctx.stroke();
      ctx.fillStyle = Math.floor(time / 3) % 2 ? '#fff' : '#ff9a3a';
      ctx.beginPath(); ctx.arc(4 * s, -bh - 10 * s, 2.6 * s, 0, Math.PI * 2); ctx.fill();
    }
  } else if (cv === 'ice') {
    // cristal : prisme à facettes avec reflet qui balaie
    poly(ctx, [-w / 2, 0, -w / 2 + 4 * s, -h * 0.8, 0, -h - 6 * s, 0, 0], dark);
    poly(ctx, [0, 0, 0, -h - 6 * s, w / 2 - 4 * s, -h * 0.8, w / 2, 0], light);
    poly(ctx, [-w / 2 + 4 * s, -h * 0.8, 0, -h - 6 * s, w / 2 - 4 * s, -h * 0.8, 0, -h * 0.55], 'rgba(255,255,255,0.75)');
    const sweep = ((time * 0.02) % 1) * w * 1.6 - w * 0.3;
    ctx.save(); ctx.beginPath(); ctx.rect(-w / 2, -h - 6 * s, w, h + 6 * s); ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath(); ctx.moveTo(sweep - w / 2, 0); ctx.lineTo(sweep - w / 2 + 8 * s, 0); ctx.lineTo(sweep - w / 2 + 22 * s, -h); ctx.lineTo(sweep - w / 2 + 14 * s, -h); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#fff';
    const tw = 0.5 + Math.sin(time * 0.3) * 0.5;
    ctx.globalAlpha = tw; ctx.fillRect(w * 0.18, -h * 0.7, 3 * s, 3 * s); ctx.globalAlpha = 1;
  } else {
    // caisse (bois / métal) : faces avant, dessus et côté en aplats
    const top = 8 * s;
    poly(ctx, [-w / 2, 0, -w / 2, -h, w / 2, -h, w / 2, 0], light);
    poly(ctx, [-w / 2, -h, -w / 2 + top, -h - top, w / 2 + top, -h - top, w / 2, -h], cv === 'metal' ? '#e4eaf2' : '#efc27c');
    poly(ctx, [w / 2, -h, w / 2 + top, -h - top, w / 2 + top, -top, w / 2, 0], dark);
    ctx.strokeStyle = cv === 'metal' ? '#4a5463' : '#6b4420';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h); ctx.lineTo(w / 2, 0);
    ctx.moveTo(w / 2, -h); ctx.lineTo(-w / 2, 0);
    ctx.stroke();
    if (cv === 'metal') {
      ctx.fillStyle = '#e9eef5';
      for (const [rx, ry] of [[-w / 2 + 5 * s, -5 * s], [w / 2 - 5 * s, -5 * s], [-w / 2 + 5 * s, -h + 5 * s], [w / 2 - 5 * s, -h + 5 * s]]) { ctx.beginPath(); ctx.arc(rx, ry, 2.2 * s, 0, Math.PI * 2); ctx.fill(); }
    }
    if (damaged) { ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.9); ctx.lineTo(0, -h * 0.4); ctx.lineTo(-w * 0.1, -h * 0.1); ctx.stroke(); }
  }
  ctx.restore();
}
