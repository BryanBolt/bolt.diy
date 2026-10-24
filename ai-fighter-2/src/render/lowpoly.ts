// Décors « low poly » : maillage triangulé animé (menus) et crêtes facettées (stages).
// Rendu uniquement : Math.sin / hasard local autorisés.

function rnd(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

interface Mesh { cols: number; rows: number; pts: { x: number; y: number; ph: number }[]; w: number; h: number }
let mesh: Mesh | null = null;

function buildMesh(w: number, h: number): Mesh {
  const cols = Math.max(8, Math.round(w / 120)), rows = Math.max(5, Math.round(h / 120));
  const r = rnd(1337);
  const pts: Mesh['pts'] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const edge = i === 0 || j === 0 || i === cols || j === rows;
    const jx = edge ? 0 : (r() - 0.5) * 0.7, jy = edge ? 0 : (r() - 0.5) * 0.7;
    pts.push({ x: ((i + jx) / cols) * (w + 140) - 70, y: ((j + jy) / rows) * (h + 140) - 70, ph: r() * 6.28 });
  }
  return { cols, rows, pts, w, h };
}

/** Fond de menu : facettes bleu-cristal qui respirent, éclats flottants, balayage lumineux. */
export function drawLowPolyBackdrop(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): void {
  if (!mesh || mesh.w !== w || mesh.h !== h) mesh = buildMesh(w, h);
  const m = mesh;
  const t = time * 0.012;
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#04101f');
  bg.addColorStop(1, '#0a2a44');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const P = (i: number, j: number) => {
    const p = m.pts[j * (m.cols + 1) + i];
    return { x: p.x + Math.sin(t + p.ph) * 9, y: p.y + Math.cos(t * 0.8 + p.ph) * 9 };
  };
  const tri = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, k: number) => {
    const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3;
    const diag = (cx / w + cy / h) / 2;
    const shine = Math.max(0, Math.sin(t * 2 - diag * 7 + k * 3)) ** 6;
    const l = 14 + diag * 14 + k * 9 + shine * 30;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.closePath();
    ctx.fillStyle = `hsl(${202 + k * 12 - diag * 8}, 70%, ${l}%)`;
    ctx.fill();
    ctx.strokeStyle = `rgba(140,220,255,${0.05 + shine * 0.3})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  };
  for (let j = 0; j < m.rows; j++) for (let i = 0; i < m.cols; i++) {
    const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1);
    const k = ((i * 7 + j * 13) % 5) / 5;
    tri(a, b, c, k);
    tri(b, d, c, 1 - k);
  }
  // éclats de cristal flottants
  const r = rnd(99);
  for (let n = 0; n < 9; n++) {
    const bx = r() * w, by = r() * h, sz = 14 + r() * 34, sp = 0.4 + r() * 0.8, ph = r() * 6.28;
    const x = bx + Math.sin(t * sp + ph) * 20, y = ((by - time * 0.12 * sp) % (h + 80) + h + 80) % (h + 80) - 40;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.sin(t * sp + ph) * 0.5);
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.5, 0); ctx.lineTo(0, sz); ctx.lineTo(-sz * 0.5, 0); ctx.closePath();
    ctx.fillStyle = '#9fe8ff';
    ctx.fill();
    ctx.beginPath(); ctx.moveTo(0, -sz); ctx.lineTo(sz * 0.5, 0); ctx.lineTo(0, sz * 0.2); ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.18;
    ctx.fill();
    ctx.restore();
  }
  // vignette
  const vg = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,4,12,0.6)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** Crête de montagnes facettées (parallaxe) : chaque pic a une face claire et une face sombre. */
export function drawLowPolyRidge(ctx: CanvasRenderingContext2D, seed: number, baseY: number, width: number, height: number, light: string, dark: string): void {
  const r = rnd(seed);
  let x = -60;
  let prevY = baseY - r() * height * 0.5;
  while (x < width) {
    const dx = 50 + r() * 90;
    const peak = r() < 0.5;
    const ny = baseY - (peak ? 0.55 + r() * 0.45 : 0.1 + r() * 0.3) * height;
    const mx = x + dx * (0.35 + r() * 0.3);
    const my = Math.min(prevY, ny) - r() * height * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, baseY); ctx.lineTo(x, prevY); ctx.lineTo(mx, my); ctx.lineTo(mx, baseY); ctx.closePath();
    ctx.fillStyle = light; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(mx, baseY); ctx.lineTo(mx, my); ctx.lineTo(x + dx, ny); ctx.lineTo(x + dx, baseY); ctx.closePath();
    ctx.fillStyle = dark; ctx.fill();
    x += dx; prevY = ny;
  }
}
