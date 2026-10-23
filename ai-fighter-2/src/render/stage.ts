// Décors procéduraux par thème, avec parallaxe. Tout est dessiné en primitives.
import { VIEW_W, VIEW_H } from '../sim/constants';
import { FLOOR_TOP, FLOOR_BOTTOM } from './camera';
import { Rng } from '../core/math';

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
  const span = width * 0.5 + VIEW_W;
  for (let x = -200; x < span; x += r.int(90, 170)) far.push({ x, w: r.int(70, 160), h: r.int(80, 260), kind: r.int(0, 3), seed: r.nextU32() });
  for (let x = -100; x < width + VIEW_W; x += r.int(160, 320)) mid.push({ x, w: r.int(30, 80), h: r.int(60, 180), kind: r.int(0, 4), seed: r.nextU32() });
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
  ctx.fillRect(0, 0, VIEW_W, FLOOR_TOP + 2);
  const props = propsFor(themeId, width);
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
    ctx.fillRect(0, FLOOR_TOP - 90, VIEW_W, 90);
  }
  // couche moyenne (parallaxe 0.6)
  ctx.save();
  ctx.translate(-camX * 0.6, 0);
  for (const p of props.mid) drawMid(ctx, t, p, time);
  ctx.restore();
  // sol
  const fg = ctx.createLinearGradient(0, FLOOR_TOP, 0, VIEW_H);
  fg.addColorStop(0, t.floor[0]);
  fg.addColorStop(1, t.floor[1]);
  ctx.fillStyle = fg;
  ctx.fillRect(0, FLOOR_TOP, VIEW_W, VIEW_H - FLOOR_TOP);
  // lignes de perspective
  ctx.strokeStyle = t.line;
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 1.5;
  const step = 120;
  const off = ((-camX) % step + step) % step;
  for (let x = off - step; x < VIEW_W + step; x += step) {
    const far = x;
    const near = (x - VIEW_W / 2) * 1.35 + VIEW_W / 2;
    ctx.beginPath();
    ctx.moveTo(far, FLOOR_TOP);
    ctx.lineTo(near, FLOOR_BOTTOM + 12);
    ctx.stroke();
  }
  for (let i = 0; i <= 4; i++) {
    const y = FLOOR_TOP + ((FLOOR_BOTTOM - FLOOR_TOP) * i * i) / 16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(VIEW_W, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // bord du fond (mur/garde-fou)
  ctx.fillStyle = t.mid;
  ctx.fillRect(0, FLOOR_TOP - 6, VIEW_W, 8);
  // murs d'arène verrouillée
  if (arena.locked) {
    for (const wx of [arena.l - camX, arena.r - camX]) {
      if (wx < -10 || wx > VIEW_W + 10) continue;
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
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(p.x, base - 200, 6, 200);
      ctx.fillStyle = t.mid;
      ctx.fillRect(p.x + 20, base - 50, 50, 50);
      ctx.fillStyle = '#4caf50';
      ctx.beginPath();
      ctx.arc(p.x + 45, base - 70, 22, 0, Math.PI * 2);
      ctx.fill();
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
