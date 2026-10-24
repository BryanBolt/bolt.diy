// Effets visuels (rendu uniquement) : particules, textes flottants, secousses, images rémanentes.
import type { SimEvent, World, Fighter } from '../sim/types';
import type { Camera } from './camera';
import { project } from './camera';
import type { Pose } from './stickman';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; max: number;
  size: number;
  color: string;
  kind: 'spark' | 'dust' | 'ring' | 'flame' | 'ice' | 'star' | 'shard' | 'coin';
  rot: number;
}

interface FloatText {
  x: number; y: number; z: number;
  text: string; color: string;
  life: number; max: number;
  big: boolean;
}

export interface Ghost {
  fighter: Fighter;
  pose: Pose;
  x: number; y: number; z: number;
  facing: number;
  life: number;
}

export class Fx {
  particles: Particle[] = [];
  texts: FloatText[] = [];
  ghosts: Ghost[] = [];
  shake = 0;
  shakeX = 0;
  shakeY = 0;
  flash = new Map<number, number>(); // id -> intensité
  superFocus = 0; // assombrissement pendant un super
  superOwner = -1;
  cracks: { x: number; z: number; life: number; seed: number; size: number }[] = [];
  hits: { target: number; attacker: number; dir: number; power: number }[] = []; // impulsions physiques à appliquer au rendu
  punch = 0; // à-coup de zoom sur les gros impacts
  impacts: { x: number; y: number; z: number; life: number; ang: number; color: string; size: number }[] = [];
  reduce = false;
  enabledShake = true;
  banner: { text: string; sub?: string; life: number; max: number; color: string } | null = null;
  comboPops = new Map<number, { hits: number; life: number }>();
  /** particules d'ambiance en coordonnées écran (pluie, braises, poussière…) */
  ambient: { x: number; y: number; vx: number; vy: number; life: number; max: number; kind: string }[] = [];
  theme = 'dojo';
  rageFlash = 0;
  alert: { text: string; life: number } | null = null;

  consume(events: SimEvent[], world: World): void {
    for (const e of events) {
      switch (e.t) {
        case 'hit': {
          if (e.blocked) {
            this.burst(e.x, e.y, e.z, 6, '#9fd3ff', 'spark', 3, 2);
            this.flash.set(e.target, 0.25);
          } else {
            const n = Math.round(8 + e.power * 10);
            this.burst(e.x, e.y, e.z, n, e.crit ? '#ffe14d' : '#ffffff', 'spark', 3 + e.power * 2, 4 + e.power * 2, e.dir);
            this.burst(e.x, e.y, e.z, 3, '#ff8a3d', 'star', 6 + e.power * 4, 1);
            this.flash.set(e.target, 0.9);
            if (e.power > 0.8) this.ring(e.x, e.y, e.z, '#ffffff', 30 + e.power * 30);
            if (e.power > 0.45) this.impacts.push({ x: e.x, y: e.y, z: e.z, life: 10, ang: e.dir > 0 ? 0 : Math.PI, color: e.crit ? '#ffe14d' : '#ffffff', size: 26 + e.power * 44 });
            if (e.power > 0.8) this.punch = Math.max(this.punch, 0.035 + e.power * 0.02);
            if (e.power > 1.05 && e.y < 40) this.cracks.push({ x: e.x, z: e.z, life: 150, seed: Math.floor(e.x * 7 + e.z), size: 30 + e.power * 26 });
          }
          this.hits.push({ target: e.target, attacker: e.attacker, dir: e.dir, power: e.blocked ? 0.25 : e.power });
          const a = world.fighters.find((f) => f.id === e.attacker);
          if (a && !e.blocked && a.comboHits >= 2) this.comboPops.set(a.id, { hits: a.comboHits, life: 60 });
          break;
        }
        case 'parry':
          this.ring(e.x, e.y, e.z, '#7cf6ff', 70);
          this.burst(e.x, e.y, e.z, 16, '#7cf6ff', 'spark', 4, 6);
          break;
        case 'ko':
          this.burst(e.x, e.y, e.z, 24, '#ffffff', 'star', 6, 6);
          this.ring(e.x, e.y, e.z, '#ff5f5f', 90);
          break;
        case 'text':
          this.texts.push({ x: e.x, y: e.y, z: e.z, text: e.text, color: e.color ?? '#fff', life: 70, max: 70, big: e.text.length < 12 && e.text === e.text.toUpperCase() });
          break;
        case 'shake':
          this.shake = Math.max(this.shake, e.power);
          break;
        case 'boom': {
          const col = e.elem === 'fire' ? '#ff8a3d' : e.elem === 'ice' ? '#bff3ff' : '#9aff6a';
          this.ring(e.x, e.y, e.z, '#ffffff', e.r * 1.6);
          this.ring(e.x, e.y, e.z, col, e.r * 1.1);
          this.burst(e.x, e.y, e.z, 34, col, 'spark', 5, 9);
          this.burst(e.x, e.y, e.z, 14, e.elem === 'fire' ? '#ffe14d' : '#ffffff', 'star', 7, 6);
          this.punch = Math.max(this.punch, 0.05);
          this.flash.set(-1, 0.5);
          break;
        }
        case 'pickup':
          this.burst(e.x, e.y, e.z, e.kind === 'crate' ? 14 : 8, e.kind === 'crate' && e.v ? ({ metal: '#b9c3d0', explosive: '#ff6a4a', ice: '#bff3ff', poison: '#9aff6a' } as Record<string, string>)[e.v] ?? '#c9a060' : e.kind === 'heal' ? '#7cff9a' : e.kind === 'ki' ? '#7cf6ff' : e.kind === 'coin' ? '#ffe14d' : '#c9a060', e.kind === 'crate' ? 'shard' : 'coin', 5, 4);
          break;
        case 'special':
          if (e.kind === 'super') {
            this.superFocus = 1;
            this.superOwner = e.id;
            this.ring(e.x, e.y + 50, e.z, '#ffd166', 160);
            this.burst(e.x, e.y + 50, e.z, 30, '#ffd166', 'spark', 4, 8);
          } else if (e.kind === 'transform') {
            this.ring(e.x, e.y + 50, e.z, '#ffffff', 220);
            this.ring(e.x, e.y + 50, e.z, '#ffd166', 140);
            this.burst(e.x, e.y + 50, e.z, 46, '#ffffff', 'spark', 5, 11);
            this.superFocus = 0.8;
            this.superOwner = e.id;
            this.punch = Math.max(this.punch, 0.07);
          } else if (e.kind === 'charge') {
            this.ring(e.x, e.y + 8, e.z, '#7cf6ff', 54);
            this.burst(e.x, e.y + 20, e.z, 6, '#bff6ff', 'spark', 3, 3);
          } else if (e.kind === 'muzzle') {
            this.burst(e.x, e.y, e.z, 5, '#ffe38a', 'spark', 3, 5);
            this.burst(e.x, e.y, e.z, 2, '#ffffff', 'star', 5, 1);
          } else if (e.kind === 'teleport') {
            this.burst(e.x, e.y + 50, e.z, 14, '#a86bff', 'dust', 6, 2);
          } else if (e.kind === 'shock') {
            this.ring(e.x, e.y + 10, e.z, '#ffffff', 120);
            this.cracks.push({ x: e.x, z: e.z, life: 150, seed: Math.floor(e.x * 3 + e.z), size: 80 });
            this.burst(e.x, e.y, e.z, 12, '#c9a060', 'dust', 6, 3);
          } else {
            this.burst(e.x, e.y + 60, e.z, 10, '#7cf6ff', 'spark', 3, 3);
          }
          break;
        case 'phase':
          this.onPhase(e.phase, world);
          break;
        case 'boss':
          this.banner = { text: '⚠ BOSS ⚠', sub: e.name, life: 170, max: 170, color: '#ff5f5f' };
          this.shake = Math.max(this.shake, 5);
          break;
        case 'cmd':
          this.burst(e.x, e.y - 90, e.z, 8, '#8fe3ff', 'spark', 3, 4);
          break;
        case 'counter':
          this.burst(e.x, e.y, e.z, 14, '#ff9f1c', 'spark', 4, 6);
          this.ring(e.x, e.y, e.z, '#ff9f1c', 60);
          break;
        case 'wall':
          this.burst(e.x, e.y, e.z, 12, '#d9c7a0', 'dust', 7, 4, e.dir);
          this.burst(e.x, e.y, e.z, 6, '#ffffff', 'spark', 3, 5, e.dir);
          break;
        case 'rage':
          this.rageFlash = 1;
          this.ring(e.x, e.y + 50, e.z, '#ff3b3b', 180);
          this.burst(e.x, e.y + 50, e.z, 40, '#ff5f5f', 'spark', 5, 9);
          break;
        case 'hazard': {
          const labels: Record<string, string> = { train: '⚠ RAME EN APPROCHE : quitte la voie du fond !', laser: '⚠ BALAYAGE LASER : saute !', barrel: '⚠ TONNEAU : saute ou change de ligne !', drone: '⚠ DRONE : écarte-toi de sa ligne !', wind: '💨 BOURRASQUE !' };
          if (e.state === 'warn') this.alert = { text: labels[e.kind] ?? '⚠', life: 110 };
          if (e.state === 'active' && e.kind === 'train') this.shake = Math.max(this.shake, 4);
          break;
        }
        case 'spawn':
          break;
        default:
          break;
      }
    }
  }

  onPhase(phase: string, w: World): void {
    const set = (text: string, sub: string | undefined, color: string, life = 110) => (this.banner = { text, sub, life, max: life, color });
    switch (phase) {
      case 'intro':
        if (w.mode === 'duel') set(`ROUND ${w.round + 1}`, w.stage?.name, '#ffd166', 120);
        else if (w.stage) set(w.stage.name.toUpperCase(), w.stage.tagline, '#ffd166', 150);
        break;
      case 'fight':
        if (w.mode === 'duel' && w.phaseTimer === 0) set('COMBAT !', undefined, '#ff5f5f', 50);
        break;
      case 'waveClear':
        set('VAGUE TERMINÉE', undefined, '#7cff9a', 70);
        break;
      case 'stageClear':
        set('STAGE TERMINÉ !', `Score ${w.score}`, '#ffd166', 200);
        break;
      case 'roundEnd':
        set(w.winnerTeam === -2 ? 'DOUBLE K.O.' : 'K.O.', undefined, '#ff5f5f', 150);
        break;
      case 'matchEnd':
        set(w.mode === 'duel' ? 'VICTOIRE' : 'CAMPAGNE TERMINÉE !', w.mode === 'duel' ? `Équipe ${w.winnerTeam + 1}` : `Score final ${w.score}`, '#ffd166', 400);
        break;
      case 'gameOver':
        set('GAME OVER', `Score ${w.score}`, '#ff5f5f', 400);
        break;
      default:
        break;
    }
  }

  burst(x: number, y: number, z: number, n: number, color: string, kind: Particle['kind'], size: number, speed: number, dir = 0): void {
    if (this.reduce) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random());
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * sp + dir * speed * 0.6,
        vy: Math.sin(a) * sp + (kind === 'dust' ? 1 : 2),
        vz: (Math.random() - 0.5) * 2,
        life: 0,
        max: 18 + Math.random() * 20,
        size: size * (0.6 + Math.random() * 0.8),
        color,
        kind,
        rot: Math.random() * Math.PI,
      });
    }
  }
  ring(x: number, y: number, z: number, color: string, size: number): void {
    this.particles.push({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0, max: 18, size, color, kind: 'ring', rot: 0 });
  }

  addGhost(f: Fighter, pose: Pose): void {
    if (this.reduce) return;
    this.ghosts.push({ fighter: f, pose, x: f.x, y: f.y, z: f.z, facing: f.facing, life: 14 });
    if (this.ghosts.length > 40) this.ghosts.shift();
  }

  update(frames: number): void {
    for (let k = 0; k < frames; k++) {
      for (const p of this.particles) {
        p.life++;
        p.x += p.vx;
        p.y += p.vy;
        p.z += p.vz;
        if (p.kind !== 'ring') p.vy -= p.kind === 'spark' ? 0.25 : 0.4;
        if (p.y < 0 && p.kind !== 'ring') { p.y = 0; p.vy = -p.vy * 0.3; p.vx *= 0.7; }
        p.rot += 0.2;
      }
      this.particles = this.particles.filter((p) => p.life < p.max);
      for (const im of this.impacts) im.life--;
      for (const c of this.cracks) c.life--;
      this.cracks = this.cracks.filter((c) => c.life > 0);
      this.impacts = this.impacts.filter((im) => im.life > 0);
      this.punch *= 0.86;
      for (const t of this.texts) { t.life--; t.y += 0.7; }
      this.texts = this.texts.filter((t) => t.life > 0);
      for (const g of this.ghosts) g.life--;
      this.ghosts = this.ghosts.filter((g) => g.life > 0);
      for (const [id, v] of this.flash) {
        const nv = v - 0.18;
        if (nv <= 0) this.flash.delete(id); else this.flash.set(id, nv);
      }
      for (const [id, c] of this.comboPops) { c.life--; if (c.life <= 0) this.comboPops.delete(id); }
      if (this.shake > 0) this.shake = Math.max(0, this.shake - 0.4);
      if (this.superFocus > 0) this.superFocus = Math.max(0, this.superFocus - 0.012);
      if (this.banner) { this.banner.life--; if (this.banner.life <= 0) this.banner = null; }
      if (this.alert) { this.alert.life--; if (this.alert.life <= 0) this.alert = null; }
      if (this.rageFlash > 0) this.rageFlash = Math.max(0, this.rageFlash - 0.03);
      this.stepAmbient();
    }
    if (this.shake > 0 && this.enabledShake) {
      this.shakeX = (Math.random() - 0.5) * this.shake * 3;
      this.shakeY = (Math.random() - 0.5) * this.shake * 3;
    } else {
      this.shakeX = this.shakeY = 0;
    }
  }

  private stepAmbient(): void {
    const t = this.theme;
    const spawn = this.reduce ? 0.3 : 1;
    const add = (kind: string, n: number, mk: () => { x: number; y: number; vx: number; vy: number; max: number }) => {
      for (let i = 0; i < n; i++) if (Math.random() < spawn) { const p = mk(); this.ambient.push({ ...p, life: 0, kind }); }
    };
    if (t === 'neon') add('rain', 3, () => ({ x: Math.random() * 1100 - 70, y: -10, vx: -1.5, vy: 14 + Math.random() * 4, max: 45 }));
    else if (t === 'market' || t === 'arena') add('ember', 0.4, () => ({ x: Math.random() * 960, y: 560, vx: (Math.random() - 0.5) * 0.6, vy: -0.8 - Math.random(), max: 240 }));
    else if (t === 'dojo') add('petal', 0.25, () => ({ x: Math.random() * 1000, y: -10, vx: -0.6 - Math.random() * 0.5, vy: 0.7 + Math.random() * 0.6, max: 500 }));
    else if (t === 'metro') add('spark', 0.08, () => ({ x: Math.random() * 960, y: 200 + Math.random() * 100, vx: (Math.random() - 0.5) * 3, vy: 2, max: 30 }));
    else if (t === 'core') add('digit', 0.5, () => ({ x: Math.random() * 960, y: 560, vx: 0, vy: -1.5 - Math.random() * 2, max: 200 }));
    else if (t === 'tower') add('cloud', 0.02, () => ({ x: 1000, y: 40 + Math.random() * 120, vx: -0.25, vy: 0, max: 4500 }));
    for (const a of this.ambient) { a.life++; a.x += a.vx; a.y += a.vy; if (a.kind === 'petal') a.x += Math.sin(a.life * 0.05) * 0.8; }
    this.ambient = this.ambient.filter((a) => a.life < a.max && a.y < 600 && a.x > -120 && a.x < 1100);
    if (this.ambient.length > 400) this.ambient.splice(0, this.ambient.length - 400);
  }

  drawAmbient(ctx: CanvasRenderingContext2D): void {
    for (const a of this.ambient) {
      const t = a.life / a.max;
      switch (a.kind) {
        case 'rain':
          ctx.strokeStyle = 'rgba(180,200,255,0.35)';
          ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x - a.vx * 1.5, a.y - a.vy * 1.2); ctx.stroke();
          break;
        case 'ember':
          ctx.fillStyle = `rgba(255,${140 + Math.round(60 * Math.sin(a.life * 0.2))},60,${0.8 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(a.x, a.y, 1.6, 0, Math.PI * 2); ctx.fill();
          break;
        case 'petal':
          ctx.fillStyle = `rgba(255,190,200,${0.7 * (1 - t)})`;
          ctx.beginPath(); ctx.ellipse(a.x, a.y, 3, 1.8, a.life * 0.1, 0, Math.PI * 2); ctx.fill();
          break;
        case 'spark':
          ctx.fillStyle = `rgba(255,230,150,${1 - t})`;
          ctx.fillRect(a.x, a.y, 2, 2);
          break;
        case 'digit':
          ctx.fillStyle = `rgba(0,240,255,${0.5 * (1 - t)})`;
          ctx.font = '10px monospace';
          ctx.fillText(a.life % 20 < 10 ? '1' : '0', a.x, a.y);
          break;
        case 'cloud':
          ctx.fillStyle = 'rgba(255,255,255,0.35)';
          ctx.beginPath(); ctx.ellipse(a.x, a.y, 60, 16, 0, 0, Math.PI * 2); ctx.ellipse(a.x + 30, a.y - 8, 40, 14, 0, 0, Math.PI * 2); ctx.fill();
          break;
      }
    }
  }

  /** Fissures au sol laissées par les gros impacts (s'estompent). */
  drawCracks(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const c of this.cracks) {
      const { sx, sy, s } = project(cam, c.x, 0, c.z);
      let seed = c.seed >>> 0 || 1;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      ctx.save();
      ctx.globalAlpha = Math.min(1, c.life / 40) * 0.8;
      ctx.strokeStyle = '#1a1208';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let b = 0; b < 7; b++) {
        const a = (b / 7) * Math.PI * 2 + rnd() * 0.5;
        let x = sx, y = sy;
        ctx.lineWidth = (3.2 - b * 0.15) * s;
        ctx.beginPath(); ctx.moveTo(x, y);
        const segs = 4 + Math.floor(rnd() * 3);
        for (let k = 0; k < segs; k++) {
          const aa = a + (rnd() - 0.5) * 0.9, len = (c.size / segs) * (0.6 + rnd() * 0.8) * s;
          x += Math.cos(aa) * len; y += Math.sin(aa) * len * 0.4;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** Cadre d'impact « manga » : rayons qui explosent, étoile à 8 branches, vite effacés. */
  drawImpacts(ctx: CanvasRenderingContext2D, cam: Camera): void {
    for (const im of this.impacts) {
      const { sx, sy, s } = project(cam, im.x, im.y, im.z);
      const t = 1 - im.life / 10;
      const R = im.size * s * (0.4 + t * 0.9);
      ctx.save();
      ctx.translate(sx, sy);
      ctx.globalAlpha = Math.min(1, im.life / 5);
      ctx.fillStyle = im.color;
      ctx.beginPath();
      const n = 8;
      for (let i = 0; i < n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2 + im.ang * 0.2;
        const r = i % 2 ? R * 0.18 : R * (i % 4 === 0 ? 1 : 0.62);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx: CanvasRenderingContext2D, cam: Camera): void {
    this.drawImpacts(ctx, cam);
    for (const p of this.particles) {
      const { sx, sy, s } = project(cam, p.x, p.y, p.z);
      const t = p.life / p.max;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      switch (p.kind) {
        case 'ring':
          ctx.lineWidth = 4 * (1 - t) + 1;
          ctx.beginPath();
          ctx.ellipse(sx, sy, p.size * s * (0.2 + t * 0.8), p.size * s * (0.2 + t * 0.8) * 0.7, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        case 'spark': {
          const len = p.size * s * (1 - t * 0.5);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx - p.vx * len * 0.4, sy + p.vy * len * 0.4);
          ctx.stroke();
          break;
        }
        case 'star': {
          const r = p.size * s * (1 - t);
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.rot);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const rr = i % 2 === 0 ? r : r * 0.4;
            ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case 'coin':
          ctx.beginPath();
          ctx.arc(sx, sy, p.size * s * 0.6, 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'shard':
        case 'dust':
        default:
          ctx.beginPath();
          ctx.save();
          ctx.translate(sx, sy);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size * s * 0.5, -p.size * s * 0.3, p.size * s, p.size * s * 0.6);
          ctx.restore();
          break;
      }
    }
    ctx.globalAlpha = 1;
  }

  drawTexts(ctx: CanvasRenderingContext2D, cam: Camera): void {
    ctx.textAlign = 'center';
    for (const t of this.texts) {
      const { sx, sy } = project(cam, t.x, t.y, t.z);
      const a = Math.min(1, t.life / 20);
      ctx.globalAlpha = a;
      ctx.font = t.big ? '900 22px "Segoe UI", system-ui, sans-serif' : 'bold 15px "Segoe UI", system-ui, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(t.text, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  }
}
