// Décors procéduraux par thème, avec parallaxe. Tout est dessiné en primitives.
// Étendue visible : VW = largeur totale, EY = marge au-dessus, VB = bas de l'écran (coordonnées de jeu 960×540).
let VW = 960, VB = 540, EY = 0;
export function setStageExtent(vw: number, extraTop: number, extraBottom: number): void { VW = vw; EY = extraTop; VB = 540 + extraBottom; }
import { FLOOR_TOP, FLOOR_BOTTOM } from './camera';
import { Rng } from '../core/math';
import { drawLowPolyRidge } from './lowpoly';

interface Theme {
  sky: [string, string];
  far: string;
  mid: string;
  floor: [string, string];
  line: string;
  accent: string;
  kind: 'dojo' | 'city' | 'market' | 'metro' | 'tower' | 'core' | 'arena';
}

const THEMES: Record<string, Theme> = {
  dojo: { sky: ['#f6e7c8', '#e9c9a0'], far: '#b58a5a', mid: '#8a5e3c', floor: ['#c8a067', '#a67c4b'], line: '#6b4a2a', accent: '#c0392b', kind: 'dojo' },
  neon: { sky: ['#0b0f2b', '#2a1457'], far: '#1a1f4d', mid: '#2e2a6a', floor: ['#2b2f55', '#1b1e3b'], line: '#4f4ca8', accent: '#ff4fd8', kind: 'city' },
  market: { sky: ['#1b1235', '#4a1f3d'], far: '#3b2448', mid: '#5a2f4c', floor: ['#4a3a3f', '#2f2429'], line: '#7a5a5f', accent: '#ffb347', kind: 'market' },
  metro: { sky: ['#121418', '#1f2730'], far: '#262e38', mid: '#333d49', floor: ['#3d4652', '#262c35'], line: '#5c6a7a', accent: '#8fd3ff', kind: 'metro' },
  tower: { sky: ['#9fd3ff', '#dff1ff'], far: '#7fb3d9', mid: '#5b8cb3', floor: ['#dfe7ef', '#b9c6d2'], line: '#8ea3b5', accent: '#2a7de1', kind: 'tower' },
  core: { sky: ['#06030f', '#1a0533'], far: '#2a0b4d', mid: '#3f0f6e', floor: ['#1a1030', '#0d0818'], line: '#7a3cff', accent: '#00f0ff', kind: 'core' },
  arena: { sky: ['#2b1d12', '#5a3a1e'], far: '#6b4a2a', mid: '#8c6239', floor: ['#b08552', '#8c6239'], line: '#5a3a1e', accent: '#ffd166', kind: 'arena' },
};

export function themeOf(id: string): Theme {
  return THEMES[id] ?? THEMES.dojo;
}

export function themeAccent(id: string): string {
  return themeOf(id).accent;
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface Prop {
  x: number;
  w: number;
  h: number;
  kind: number;
  seed: number;
}

const propsCache = new Map<string, { far: Prop[]; mid: Prop[] }>();

function propsFor(theme: string, width: number): { far: Prop[]; mid: Prop[] } {
  const key = `${theme}:${width}`;
  const cached = propsCache.get(key);
  if (cached) return cached;
  const r = new Rng(hashSeed(key));
  const far: Prop[] = [];
  const mid: Prop[] = [];
  const span = width * 0.5 + VW;
  for (let x = -500; x < span; x += r.int(90, 170)) far.push({ x, w: r.int(70, 160), h: r.int(80, 260), kind: r.int(0, 3), seed: r.nextU32() });
  for (let x = -500; x < width + VW; x += r.int(160, 320)) mid.push({ x, w: r.int(30, 80), h: r.int(60, 180), kind: r.int(0, 4), seed: r.nextU32() });
  const out = { far, mid };
  propsCache.set(key, out);
  return out;
}

export function drawStage(ctx: CanvasRenderingContext2D, themeId: string, camX: number, width: number, time: number, arena: { l: number; r: number; locked: boolean }): void {
  const t = themeOf(themeId);
  // ciel
  const g = ctx.createLinearGradient(0, 0, 0, FLOOR_TOP);
  g.addColorStop(0, t.sky[0]);
  g.addColorStop(1, t.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, -EY, VW, FLOOR_TOP + 2 + EY);
  const props = propsFor(themeId, width);
  // montagnes low poly en fond (parallaxe lente)
  if (t.kind !== 'metro') {
    ctx.save();
    ctx.translate(-camX * 0.1, 0);
    drawLowPolyRidge(ctx, hashSeed(themeId), FLOOR_TOP + 4, width * 0.4 + VW + 200, t.kind === 'tower' ? 190 : 140, t.far + 'aa', t.mid + '88');
    ctx.restore();
  }
  // couche lointaine (parallaxe 0.25)
  ctx.save();
  ctx.translate(-camX * 0.25, 0);
  for (const p of props.far) drawFar(ctx, t, p, time);
  ctx.restore();
  // horizon lumineux
  if (t.kind === 'city' || t.kind === 'core') {
    const hg = ctx.createLinearGradient(0, FLOOR_TOP - 90, 0, FLOOR_TOP);
    hg.addColorStop(0, 'rgba(255,255,255,0)');
    hg.addColorStop(1, t.accent + '44');
    ctx.fillStyle = hg;
    ctx.fillRect(0, FLOOR_TOP - 90, VW, 90);
  }
  // couche moyenne (parallaxe 0.6)
  ctx.save();
  ctx.translate(-camX * 0.6, 0);
  for (const p of props.mid) drawMid(ctx, t, p, time);
  ctx.restore();
  // sol
  const fg = ctx.createLinearGradient(0, FLOOR_TOP, 0, VB);
  fg.addColorStop(0, t.floor[0]);
  fg.addColorStop(1, t.floor[1]);
  ctx.fillStyle = fg;
  ctx.fillRect(0, FLOOR_TOP, VW, VB - FLOOR_TOP);
  // lignes de perspective
  ctx.strokeStyle = t.line;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  const step = 120;
  const off = ((-camX) % step + step) % step;
  for (let x = off - step; x < VW + step; x += step) {
    const far = x;
    const near = (x - VW / 2) * 1.35 + VW / 2;
    ctx.beginPath();
    ctx.moveTo(far, FLOOR_TOP);
    ctx.lineTo(near, FLOOR_BOTTOM + 12);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const y = FLOOR_TOP + ((FLOOR_BOTTOM - FLOOR_TOP) * i * i) / 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VW, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  drawFloorDetail(ctx, t, camX, time);
  // bord du fond (mur/garde-fou)
  ctx.fillStyle = t.mid;
  ctx.fillRect(0, FLOOR_TOP - 6, VW, 8);
  // murs d'arène verrouillée
  if (arena.locked) {
    for (const wx of [arena.l - camX, arena.r - camX]) {
      if (wx < -10 || wx > VW + 10) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(wx - 2, FLOOR_TOP - 40, 4, FLOOR_BOTTOM - FLOOR_TOP + 50);
    }
  }
}

function drawFar(ctx: CanvasRenderingContext2D, t: Theme, p: Prop, time: number): void {
  const base = FLOOR_TOP - 4;
  const r = new Rng(p.seed);
  ctx.fillStyle = t.far;
  switch (t.kind) {
    case 'dojo':
    case 'arena': {
      // montagnes
      ctx.beginPath();
      ctx.moveTo(p.x - p.w, base);
      ctx.lineTo(p.x, base - p.h * 0.8);
      ctx.lineTo(p.x + p.w * 0.6, base - p.h * 0.5);
      ctx.lineTo(p.x + p.w * 1.3, base);
      ctx.closePath();
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'city':
    case 'core':
    case 'tower': {
      ctx.fillRect(p.x, base - p.h, p.w, p.h);
      // fenêtres
      ctx.fillStyle = t.kind === 'tower' ? '#e8f4ff' : t.accent;
      for (let y = base - p.h + 8; y < base - 10; y += 14) {
        for (let x = p.x + 6; x < p.x + p.w - 8; x += 12) {
          const on = r.next() < (t.kind === 'tower' ? 0.7 : 0.35) || (t.kind === 'core' && Math.floor(time / 30 + x) % 7 === 0);
          if (on) {
            ctx.globalAlpha = t.kind === 'tower' ? 0.5 : 0.6;
            ctx.fillRect(x, y, 5, 7);
          }
        }
      }
      ctx.globalAlpha = 1;
      if (t.kind === 'core') {
        ctx.strokeStyle = t.accent;
        ctx.globalAlpha = 0.5;
        ctx.strokeRect(p.x, base - p.h, p.w, p.h);
        ctx.globalAlpha = 1;
      }
      break;
    }
    case 'market': {
      // toits en pente
      ctx.beginPath();
      ctx.moveTo(p.x, base);
      ctx.lineTo(p.x, base - p.h * 0.6);
      ctx.lineTo(p.x + p.w / 2, base - p.h * 0.6 - 30);
      ctx.lineTo(p.x + p.w, base - p.h * 0.6);
      ctx.lineTo(p.x + p.w, base);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'metro': {
      // piliers et voûte
      ctx.fillRect(p.x, base - 200, 18, 200);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(p.x + 9, base - 200, 60, Math.PI, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
  }
}

function drawMid(ctx: CanvasRenderingContext2D, t: Theme, p: Prop, time: number): void {
  const base = FLOOR_TOP - 2;
  switch (t.kind) {
    case 'dojo': {
      // piliers en bois + lanterne
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x, base - 150, 14, 150);
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.ellipse(p.x + 7, base - 160 + Math.sin(time * 0.05 + p.x) * 2, 10, 14, 0, 0, Math.PI * 2);
      ctx.fill();
      if (p.kind === 0) {
        ctx.fillStyle = '#eee';
        ctx.fillRect(p.x + 30, base - 120, 60, 80);
        ctx.fillStyle = t.mid;
        ctx.fillRect(p.x + 30, base - 120, 60, 6);
        ctx.font = 'bold 28px sans-serif';
        ctx.fillStyle = '#c0392b';
        ctx.fillText('道', p.x + 46, base - 65);
      }
      break;
    }
    case 'city': {
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x, base - p.h, p.w, p.h);
      // enseigne néon
      const colors = [t.accent, '#4fe3ff', '#ffe14d', '#7cff9a'];
      ctx.strokeStyle = colors[p.kind % colors.length];
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.6 + Math.sin(time * 0.1 + p.x) * 0.3;
      ctx.strokeRect(p.x + 6, base - p.h + 10, p.w - 12, 24);
      ctx.globalAlpha = 1;
      break;
    }
    case 'market': {
      // étal avec auvent
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x, base - 60, p.w + 30, 60);
      ctx.fillStyle = p.kind % 2 ? t.accent : '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(p.x - 6, base - 60);
      ctx.lineTo(p.x + p.w + 36, base - 60);
      ctx.lineTo(p.x + p.w + 30, base - 85);
      ctx.lineTo(p.x, base - 85);
      ctx.closePath();
      ctx.fill();
      // lanternes suspendues
      for (let i = 0; i < 3; i++) {
        const lx = p.x + 10 + i * 24;
        const ly = base - 110 + Math.sin(time * 0.06 + lx) * 3;
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        ctx.moveTo(lx, base - 140);
        ctx.lineTo(lx, ly);
        ctx.stroke();
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath();
        ctx.ellipse(lx, ly + 8, 7, 10, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'metro': {
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x, base - 90, p.w + 40, 90);
      ctx.fillStyle = '#111';
      ctx.fillRect(p.x + 8, base - 80, p.w + 24, 50);
      ctx.fillStyle = t.accent;
      ctx.globalAlpha = 0.5 + ((Math.floor(time / 20 + p.kind) % 5 === 0) ? 0.4 : 0);
      ctx.fillRect(p.x + 14, base - 74, p.w + 12, 20);
      ctx.globalAlpha = 1;
      break;
    }
    case 'tower': {
      // montant de baie vitrée + plante en pot
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(p.x, base - 200, 6, 200);
      ctx.fillStyle = '#6b7f94';
      ctx.fillRect(p.x + 26, base - 26, 22, 26);
      ctx.fillStyle = '#3f9d4f';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(p.x + 37 + Math.cos(i * 1.3) * 10, base - 36 - Math.abs(Math.sin(i * 1.3)) * 14, 9, 4, i * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'core': {
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      const pulse = Math.sin(time * 0.08 + p.x * 0.01) * 10;
      ctx.beginPath();
      ctx.arc(p.x, base - 120, 40 + pulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p.x, base - 120);
      ctx.lineTo(p.x, base);
      ctx.stroke();
      ctx.globalAlpha = 1;
      break;
    }
    case 'arena': {
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x, base - 80, 20, 80);
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.moveTo(p.x + 10, base - 110);
      ctx.lineTo(p.x + 34, base - 100);
      ctx.lineTo(p.x + 10, base - 90);
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}


function drawFloorDetail(ctx: CanvasRenderingContext2D, t: Theme, camX: number, time: number): void {
  ctx.save();
  switch (t.kind) {
    case 'metro': {
      // voie ferrée sur la ligne du fond (zone du train)
      const y0 = FLOOR_TOP + 4, y1 = FLOOR_TOP + 40;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(0, y0, VW, y1 - y0);
      ctx.strokeStyle = '#9aa7b8';
      ctx.lineWidth = 2;
      for (const y of [y0 + 8, y1 - 8]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y); ctx.stroke(); }
      ctx.fillStyle = '#5c4a3a';
      const off = ((-camX) % 34 + 34) % 34;
      for (let x = off - 34; x < VW; x += 34) ctx.fillRect(x, y0 + 4, 10, y1 - y0 - 8);
      // ligne jaune de sécurité
      ctx.fillStyle = 'rgba(255,225,77,0.5)';
      ctx.fillRect(0, y1 + 4, VW, 3);
      break;
    }
    case 'dojo': {
      // tatamis
      ctx.strokeStyle = 'rgba(80,50,20,0.25)';
      ctx.lineWidth = 2;
      const off = ((-camX * 1.1) % 180 + 180) % 180;
      for (let x = off - 180; x < VW + 180; x += 180) {
        ctx.beginPath(); ctx.moveTo(x, FLOOR_TOP + 70); ctx.lineTo((x - VW / 2) * 1.2 + VW / 2, FLOOR_BOTTOM + 12); ctx.stroke();
      }
      break;
    }
    case 'city': {
      // reflets des néons sur le sol mouillé
      const colors = [t.accent, '#4fe3ff', '#ffe14d'];
      const off = ((-camX * 0.6) % 300 + 300) % 300;
      for (let x = off - 300, i = 0; x < VW + 300; x += 300, i++) {
        const g = ctx.createLinearGradient(0, FLOOR_TOP, 0, FLOOR_BOTTOM);
        g.addColorStop(0, colors[i % 3] + '55');
        g.addColorStop(1, colors[i % 3] + '00');
        ctx.fillStyle = g;
        ctx.fillRect(x + 20, FLOOR_TOP, 70, FLOOR_BOTTOM - FLOOR_TOP);
      }
      break;
    }
    case 'market': {
      // pavés
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      const off = ((-camX) % 40 + 40) % 40;
      for (let row = 0; row < 5; row++) {
        const y = FLOOR_TOP + 20 + row * row * 9;
        for (let x = off - 40 + (row % 2) * 20; x < VW; x += 40) ctx.fillRect(x, y, 30, 5 + row * 2);
      }
      break;
    }
    case 'tower': {
      // marbre : reflets
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      const off = ((-camX * 0.8) % 240 + 240) % 240;
      for (let x = off - 240; x < VW + 240; x += 240) { ctx.beginPath(); ctx.moveTo(x, FLOOR_TOP); ctx.lineTo(x + 40, FLOOR_TOP); ctx.lineTo(x + 120, FLOOR_BOTTOM); ctx.lineTo(x + 60, FLOOR_BOTTOM); ctx.closePath(); ctx.fill(); }
      break;
    }
    case 'core': {
      // grille lumineuse pulsante
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.18 + Math.sin(time * 0.05) * 0.08;
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) { const y = FLOOR_TOP + ((FLOOR_BOTTOM - FLOOR_TOP) * i * i) / 64; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(VW, y); ctx.stroke(); }
      ctx.globalAlpha = 1;
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/** Premier plan (parallaxe > 1), dessiné par-dessus les combattants. */
export function drawForeground(ctx: CanvasRenderingContext2D, themeId: string, camX: number, time: number): void {
  const t = themeOf(themeId);
  ctx.save();
  const par = 1.3;
  const off = ((-camX * par) % 700 + 700) % 700;
  ctx.globalAlpha = 0.85;
  for (let x = off - 700; x < VW + 700; x += 700) {
    switch (t.kind) {
      case 'dojo':
        ctx.fillStyle = '#3b2412';
        ctx.fillRect(x + 40, VB - 120, 14, 120);
        ctx.fillStyle = '#c0392b';
        ctx.beginPath(); ctx.ellipse(x + 47, VB - 128 + Math.sin(time * 0.05 + x) * 3, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'city':
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(x, VB - 30); ctx.lineTo(x + 260, VB - 30); ctx.stroke();
        for (let k = 0; k < 6; k++) { ctx.beginPath(); ctx.moveTo(x + k * 50, VB - 30); ctx.lineTo(x + k * 50, VB); ctx.stroke(); }
        break;
      case 'market':
        ctx.strokeStyle = '#2a1a1f';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x + 100, 0); ctx.lineTo(x + 100, 70 + Math.sin(time * 0.04 + x) * 4); ctx.stroke();
        ctx.fillStyle = '#ff6b35';
        ctx.beginPath(); ctx.ellipse(x + 100, 86 + Math.sin(time * 0.04 + x) * 4, 14, 20, 0, 0, Math.PI * 2); ctx.fill();
        break;
      case 'metro':
        ctx.fillStyle = 'rgba(14,18,26,0.9)';
        ctx.fillRect(x + 300, 0, 28, VB);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(x + 300, 0, 4, VB);
        break;
      case 'tower':
        // garde-corps en verre au premier plan
        ctx.fillStyle = 'rgba(200,225,255,0.18)';
        ctx.fillRect(x, VB - 40, 700, 40);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(x, VB - 42, 700, 3);
        break;
      case 'core':
        ctx.strokeStyle = t.accent;
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(x, VB - 60); ctx.quadraticCurveTo(x + 200, VB - 140, x + 420, VB - 40); ctx.stroke();
        ctx.globalAlpha = 0.85;
        break;
      case 'arena':
        ctx.fillStyle = '#2b1d12';
        ctx.fillRect(x + 200, VB - 70, 26, 70);
        break;
    }
  }
  ctx.restore();
}
