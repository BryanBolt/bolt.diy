// Rendu principal : canvas 960x540 virtuel mis à l'échelle, ordre de profondeur, ombres, projectiles, objets.
import type { World, Fighter, Projectile, Item } from '../sim/types';
import { VIEW_W, VIEW_H, HURT_HW, HURT_H } from '../sim/constants';
import { getChar, PALETTE } from '../sim/chars';
import { drawStickman, poseFor, colorsFor } from './stickman';
import { drawStage, themeAccent, drawForeground } from './stage';
import type { Hazard } from '../sim/types';
import { Fx } from './fx';
import { drawHud, type HudInfo } from './hud';
import { project, groundY, depthScale, applyCamera, type Camera } from './camera';

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fx = new Fx();
  cam: Camera = { x: 0, zoom: 1, cx: VIEW_W / 2, cy: VIEW_H / 2, shakeX: 0, shakeY: 0 };
  scale = 1;
  offX = 0;
  offY = 0;
  time = 0;
  showHitboxes = false;
  private ghostTick = 0;
  private fpsAcc = 0;
  private fpsCount = 0;
  fps = 60;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.scale = Math.min(w / VIEW_W, h / VIEW_H) * dpr;
    this.offX = (this.canvas.width - VIEW_W * this.scale) / 2;
    this.offY = (this.canvas.height - VIEW_H * this.scale) / 2;
  }

  /** Convertit une position écran (CSS px) en coordonnées virtuelles. */
  toVirtual(cssX: number, cssY: number): { x: number; y: number } {
    const dpr = this.canvas.width / this.canvas.clientWidth;
    return { x: (cssX * dpr - this.offX) / this.scale, y: (cssY * dpr - this.offY) / this.scale };
  }

  render(w: World, info: HudInfo, dtMs: number): void {
    this.time += dtMs / 16.667;
    this.fpsAcc += dtMs;
    this.fpsCount++;
    if (this.fpsAcc >= 500) { this.fps = Math.round((this.fpsCount * 1000) / this.fpsAcc); this.fpsAcc = 0; this.fpsCount = 0; }
    info.fps = this.fps;
    const ctx = this.ctx;
    const fx = this.fx;
    // caméra : suit la sim, zoom cinématique sur KO/super
    const targetZoom = w.slowmo > 0 ? 1.08 : fx.superFocus > 0.5 ? 1.05 : 1;
    this.cam.zoom += (targetZoom - this.cam.zoom) * 0.1;
    this.cam.x = w.camX;
    this.cam.shakeX = fx.shakeX;
    this.cam.shakeY = fx.shakeY;
    if (w.slowmo > 0 || fx.superFocus > 0.5) {
      const focus = w.fighters.find((f) => f.id === fx.superOwner) ?? w.fighters.find((f) => f.state === 'ko' && f.koTimer < 60);
      if (focus) {
        const p = project(this.cam, focus.x, focus.y + 50, focus.z);
        this.cam.cx += (p.sx - this.cam.cx) * 0.1;
        this.cam.cy += (p.sy - this.cam.cy) * 0.1;
      }
    } else {
      this.cam.cx += (VIEW_W / 2 - this.cam.cx) * 0.1;
      this.cam.cy += (VIEW_H / 2 - this.cam.cy) * 0.1;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07070c';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this.scale, 0, 0, this.scale, this.offX, this.offY);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, VIEW_W, VIEW_H);
    ctx.clip();
    applyCamera(ctx, this.cam);

    const theme = w.stage?.theme ?? 'dojo';
    fx.theme = theme;
    drawStage(ctx, theme, this.cam.x + this.cam.shakeX, w.stage?.width ?? VIEW_W, this.time, { l: w.arenaL, r: w.arenaR, locked: w.locked });

    // assombrissement super
    if (fx.superFocus > 0) {
      ctx.fillStyle = `rgba(5,5,20,${0.55 * fx.superFocus})`;
      ctx.fillRect(-200, -200, VIEW_W + 400, VIEW_H + 400);
    }

    // dangers en fond (train, drone)
    for (const h of w.hazards) if (h.kind === 'train' || h.kind === 'drone' || h.kind === 'wind') this.drawHazard(h, w);
    // ombres + anneaux
    const sorted = [...w.fighters].sort((a, b) => a.z - b.z);
    for (const f of sorted) this.drawShadow(f);
    for (const it of w.items) this.drawItemShadow(it);

    // images rémanentes
    this.ghostTick++;
    for (const f of w.fighters) {
      const m = f.state === 'attack' && f.moveId ? getChar(f.charId).moves[f.moveId] : null;
      const fast = f.state === 'run' || f.state === 'dodge' || (m && (m.kind === 'special' || m.kind === 'special2' || m.kind === 'super' || m.kind === 'run'));
      if (fast && this.ghostTick % 2 === 0) fx.addGhost(f, poseFor(f, this.time));
    }
    for (const g of fx.ghosts) {
      const { sx, sy, s } = project(this.cam, g.x, g.y, g.z);
      drawStickman(ctx, g.fighter, g.pose, { x: sx, y: sy, scale: s, facing: g.facing, alpha: (g.life / 14) * 0.35, ghost: true, time: this.time });
    }

    // entités triées par profondeur
    const drawables: { z: number; draw: () => void }[] = [];
    for (const f of sorted) drawables.push({ z: f.z, draw: () => this.drawFighter(f, w, info) });
    for (const p of w.projectiles) drawables.push({ z: p.z, draw: () => this.drawProjectile(p) });
    for (const it of w.items) drawables.push({ z: it.z, draw: () => this.drawItem(it) });
    for (const h of w.hazards) if (h.kind === 'barrel' || h.kind === 'laser') drawables.push({ z: h.kind === 'laser' ? 999 : h.z, draw: () => this.drawHazard(h, w) });
    drawables.sort((a, b) => a.z - b.z);
    for (const d of drawables) d.draw();

    fx.drawParticles(ctx, this.cam);
    drawForeground(ctx, theme, this.cam.x, this.time);
    fx.drawAmbient(ctx);
    fx.drawTexts(ctx, this.cam);
    if (fx.rageFlash > 0) { ctx.fillStyle = `rgba(255,40,40,${fx.rageFlash * 0.35})`; ctx.fillRect(-200, -200, VIEW_W + 400, VIEW_H + 400); }
    ctx.restore();

    // vignette légère
    const vg = ctx.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.5, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    drawHud(ctx, w, fx, this.cam, info, this.time);
  }

  private drawHazard(h: Hazard, w: World): void {
    const ctx = this.ctx;
    const t = this.time;
    switch (h.kind) {
      case 'train': {
        if (h.state === 'warn') {
          // feux clignotants sur la voie
          const on = Math.floor(t / 8) % 2 === 0;
          ctx.fillStyle = on ? '#ff3b3b' : '#5a1010';
          for (let x = 40; x < VIEW_W; x += 160) ctx.fillRect(x, groundY(h.z) - 14, 10, 10);
          ctx.fillStyle = `rgba(255,60,60,${on ? 0.12 : 0.04})`;
          ctx.fillRect(0, groundY(h.z) - 20, VIEW_W, 46);
        } else if (h.state === 'active') {
          const { sx, sy } = project(this.cam, h.x, 0, h.z);
          const len = 380, hgt = 120;
          ctx.fillStyle = '#2a3340';
          ctx.fillRect(sx - len / 2, sy - hgt, len, hgt);
          ctx.fillStyle = '#9fd3ff';
          for (let x = sx - len / 2 + 16; x < sx + len / 2 - 20; x += 44) ctx.fillRect(x, sy - hgt + 24, 30, 36);
          ctx.fillStyle = '#ffe14d';
          ctx.fillRect(h.dir < 0 ? sx - len / 2 + 6 : sx + len / 2 - 16, sy - 40, 10, 10);
          ctx.fillStyle = 'rgba(255,255,255,0.15)';
          ctx.fillRect(sx - len / 2, sy - hgt, len, 10);
          // traînée de vitesse
          ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          ctx.lineWidth = 2;
          for (let i = 0; i < 4; i++) { const y = sy - 20 - i * 25; ctx.beginPath(); ctx.moveTo(sx - h.dir * len / 2, y); ctx.lineTo(sx - h.dir * (len / 2 + 120), y); ctx.stroke(); }
        }
        break;
      }
      case 'laser': {
        const { sx } = project(this.cam, h.x, 0, h.z);
        if (h.state === 'warn') {
          ctx.strokeStyle = `rgba(255,60,60,${0.3 + Math.sin(t * 0.5) * 0.2})`;
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 8]);
          ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, VIEW_H); ctx.stroke();
          ctx.setLineDash([]);
        } else if (h.state === 'active') {
          const g = ctx.createLinearGradient(sx - 30, 0, sx + 30, 0);
          g.addColorStop(0, 'rgba(255,40,40,0)'); g.addColorStop(0.5, 'rgba(255,120,120,0.9)'); g.addColorStop(1, 'rgba(255,40,40,0)');
          ctx.fillStyle = g;
          ctx.fillRect(sx - 30, 0, 60, VIEW_H);
          ctx.fillStyle = '#fff';
          ctx.fillRect(sx - 2, 0, 4, VIEW_H);
        }
        break;
      }
      case 'barrel': {
        if (h.state === 'warn') {
          const edge = h.dir < 0 ? VIEW_W - 30 : 30;
          ctx.font = '900 26px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = Math.floor(t / 8) % 2 ? '#ff3b3b' : '#ffd166';
          ctx.fillText('⚠', edge, groundY(h.z) - 40);
          ctx.textAlign = 'left';
        } else if (h.state === 'active') {
          const { sx, sy, s } = project(this.cam, h.x, 0, h.z);
          ctx.save();
          ctx.translate(sx, sy - 22 * s);
          ctx.rotate(-h.x * 0.05 * h.dir);
          ctx.fillStyle = '#8a5a2b';
          ctx.strokeStyle = '#141622';
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(0, 0, 22 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
          ctx.strokeStyle = '#3b2412';
          ctx.beginPath(); ctx.moveTo(-22 * s, 0); ctx.lineTo(22 * s, 0); ctx.moveTo(0, -22 * s); ctx.lineTo(0, 22 * s); ctx.stroke();
          ctx.restore();
          ctx.beginPath(); ctx.ellipse(sx, sy, 22 * s, 7 * s, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fill();
        }
        break;
      }
      case 'drone': {
        if (h.state === 'idle') break;
        const { sx, sy, s } = project(this.cam, h.x, 150, h.z);
        const bob = Math.sin(t * 0.1) * 4;
        ctx.fillStyle = '#2a2f45';
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(sx, sy + bob, 26 * s, 10 * s, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        for (const dx of [-24, 24]) { ctx.beginPath(); ctx.ellipse(sx + dx * s, sy + bob - 8 * s, 14 * s, 3 * s, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(200,220,255,0.5)'; ctx.fill(); }
        ctx.fillStyle = h.state === 'active' && Math.floor(t / 4) % 2 ? '#ff3b3b' : '#ffd166';
        ctx.beginPath(); ctx.arc(sx, sy + bob + 6 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
        if (h.state === 'warn') { ctx.strokeStyle = 'rgba(255,60,60,0.5)'; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(sx, sy + bob); ctx.lineTo(sx, groundY(h.z)); ctx.stroke(); ctx.setLineDash([]); }
        break;
      }
      case 'wind': {
        if (h.state !== 'active') break;
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        for (let i = 0; i < 10; i++) {
          const y = 60 + ((i * 97 + t * 3) % 420);
          const x = ((i * 211 + t * 18 * h.dir) % (VIEW_W + 200) + VIEW_W + 200) % (VIEW_W + 200) - 100;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - h.dir * 60, y + 2); ctx.stroke();
        }
        break;
      }
    }
    void w;
  }

  private drawShadow(f: Fighter): void {
    const ctx = this.ctx;
    const gy = groundY(f.z) + this.cam.shakeY;
    const s = depthScale(f.z);
    const sx = f.x - this.cam.x + this.cam.shakeX;
    const h = Math.min(1, f.y / 160);
    // anneau d'équipe
    if (f.state !== 'ko' || f.team === 0) {
      const pal = f.team === 0 ? PALETTE[f.color % PALETTE.length] : null;
      ctx.beginPath();
      ctx.ellipse(sx, gy + 2, 26 * s, 9 * s, 0, 0, Math.PI * 2);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = pal ? pal.main : f.ai?.kind === 'boss' ? '#ffd166' : 'rgba(255,80,80,0.7)';
      ctx.globalAlpha = 0.9;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.beginPath();
    ctx.ellipse(sx, gy, (24 - h * 8) * s, (8 - h * 3) * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${0.35 - h * 0.15})`;
    ctx.fill();
    // étiquette P1..P4 sous l'anneau
    if (f.slot >= 0 && f.team === 0) {
      const pal = PALETTE[f.color % PALETTE.length];
      ctx.font = 'bold 10px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = pal.main;
      ctx.fillText(`P${f.slot + 1}`, sx, gy + 20 * s);
      ctx.textAlign = 'left';
    }
  }

  private drawFighter(f: Fighter, w: World, info: HudInfo): void {
    const ctx = this.ctx;
    const { sx, sy, s } = project(this.cam, f.x, f.y, f.z);
    const pose = poseFor(f, this.time);
    const col = colorsFor(f);
    const inv = f.invuln > 0 && f.state !== 'dodge' && f.state !== 'attack';
    const alpha = f.state === 'ko' && f.team !== 0 ? Math.max(0, 1 - Math.max(0, f.koTimer - 40) / 40) : inv && Math.floor(this.time * 2) % 2 === 0 ? 0.55 : 1;
    // aura (super prêt, super en cours, brûlure)
    if (f.superMeter >= 100 && f.state !== 'ko') {
      const pulse = 0.5 + Math.sin(this.time * 0.3) * 0.2;
      const g = ctx.createRadialGradient(sx, sy - 50 * s, 10, sx, sy - 50 * s, 70 * s);
      g.addColorStop(0, `rgba(255,209,102,${0.25 * pulse})`);
      g.addColorStop(1, 'rgba(255,209,102,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 80 * s, sy - 130 * s, 160 * s, 160 * s);
    }
    if (f.rage && f.state !== 'ko') {
      const pulse = 0.6 + Math.sin(this.time * 0.5) * 0.3;
      const g = ctx.createRadialGradient(sx, sy - 50 * s, 10, sx, sy - 50 * s, 80 * s);
      g.addColorStop(0, `rgba(255,40,40,${0.3 * pulse})`);
      g.addColorStop(1, 'rgba(255,40,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - 90 * s, sy - 140 * s, 180 * s, 170 * s);
      for (let i = 0; i < 3; i++) {
        const tt = this.time * 0.3 + i * 2.1;
        ctx.beginPath(); ctx.arc(sx + Math.sin(tt) * 14 * s, sy - (40 + ((tt * 10) % 70)) * s, 3 * s, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,90,90,0.8)'; ctx.fill();
      }
    }
    if (f.state === 'attack' && f.moveId && getChar(f.charId).moves[f.moveId].kind === 'super') {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = col.glow;
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.ellipse(sx, sy - 50 * s, (40 + i * 18 + (this.time * 4) % 18) * s, (60 + i * 18 + (this.time * 4) % 18) * s, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    drawStickman(ctx, f, pose, { x: sx, y: sy, scale: s, facing: f.facing, alpha, flash: this.fx.flash.get(f.id) ?? 0, time: this.time });
    // statuts
    if (f.status.burn > 0) {
      for (let i = 0; i < 3; i++) {
        const t = this.time * 0.5 + i * 2.1 + f.id;
        const px = sx + Math.sin(t) * 10 * s;
        const py = sy - (30 + i * 25 + (t * 8) % 20) * s;
        ctx.beginPath();
        ctx.arc(px, py, (6 - i) * s, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? 'rgba(255,120,40,0.8)' : 'rgba(255,200,80,0.6)';
        ctx.fill();
      }
    }
    if (f.state === 'frozen') {
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#9ff3ff';
      ctx.beginPath();
      ctx.moveTo(sx - 26 * s, sy + 2);
      ctx.lineTo(sx - 30 * s, sy - 60 * s);
      ctx.lineTo(sx - 10 * s, sy - 118 * s);
      ctx.lineTo(sx + 14 * s, sy - 112 * s);
      ctx.lineTo(sx + 30 * s, sy - 50 * s);
      ctx.lineTo(sx + 24 * s, sy + 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    // réanimation : barre
    if (f.state === 'ko' && f.revive > 0) {
      const bw = 50 * s;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(sx - bw / 2, sy - 50 * s, bw, 6);
      ctx.fillStyle = '#7cff9a';
      ctx.fillRect(sx - bw / 2, sy - 50 * s, bw * Math.min(1, f.revive / 100), 6);
    } else if (f.state === 'ko' && f.team === 0 && w.mode !== 'duel' && f.koTimer < 900) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7cff9a';
      if (Math.floor(this.time / 20) % 2 === 0) ctx.fillText('Maintiens ATTAQUE à côté pour réanimer', sx, sy - 40 * s);
      ctx.textAlign = 'left';
    }
    // charge du coup lourd
    if (f.heavyCharge > 8) {
      const t = f.heavyCharge / 45;
      ctx.beginPath();
      ctx.arc(sx, sy - 60 * s, (20 + t * 20) * s, 0, Math.PI * 2 * t);
      ctx.strokeStyle = t >= 0.66 ? '#ff5f5f' : '#ffd166';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // nom au-dessus (joueurs distants ou bots en duel)
    if (f.team !== 0 && w.mode === 'duel' || (f.slot >= 0 && !info.localSlots.includes(f.slot) && info.online)) {
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(f.name, sx, sy - 125 * s);
      ctx.textAlign = 'left';
    }
    if (this.showHitboxes) this.drawDebugBoxes(f);
  }

  private drawDebugBoxes(f: Fighter): void {
    const ctx = this.ctx;
    const { sx, sy, s } = project(this.cam, f.x, f.y, f.z);
    ctx.strokeStyle = 'rgba(80,200,255,0.8)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - HURT_HW * s, sy - HURT_H * s, HURT_HW * 2 * s, HURT_H * s);
    if (f.state === 'attack' && f.moveId) {
      const m = getChar(f.charId).moves[f.moveId];
      const fr = f.stateFrame;
      const active = fr > m.startup && fr <= m.startup + m.active;
      const cx = f.x + f.facing * (m.hit.x + f.stats.reach * 0.5);
      const hw = (m.hit.w + f.stats.reach) / 2;
      const p0 = project(this.cam, cx - hw, f.y + m.hit.y1, f.z);
      const p1 = project(this.cam, cx + hw, f.y + m.hit.y0, f.z);
      ctx.strokeStyle = active ? 'rgba(255,60,60,0.9)' : 'rgba(255,200,60,0.5)';
      ctx.strokeRect(p0.sx, p0.sy, p1.sx - p0.sx, p1.sy - p0.sy);
    }
  }

  private drawProjectile(p: Projectile): void {
    const ctx = this.ctx;
    const { sx, sy, s } = project(this.cam, p.x, p.y, p.z);
    const r = p.radius * s;
    ctx.save();
    switch (p.kind) {
      case 'shock': {
        ctx.globalAlpha = p.vx === 0 ? Math.max(0, p.life / 3) : 0.8;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.ellipse(sx, sy, r, r * 0.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'shuriken': {
        ctx.translate(sx, sy);
        ctx.rotate(this.time * 0.8);
        ctx.fillStyle = '#dfe6ee';
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const rr = i % 2 ? r * 0.35 : r;
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      }
      case 'bat': {
        ctx.translate(sx, sy);
        ctx.rotate(this.time * 0.6 * Math.sign(p.vx || 1));
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-18 * s, 0); ctx.lineTo(18 * s, 0);
        ctx.lineWidth = 9 * s; ctx.strokeStyle = '#141622'; ctx.stroke();
        ctx.lineWidth = 6 * s; ctx.strokeStyle = '#c98a4b'; ctx.stroke();
        break;
      }
      case 'bullet': {
        ctx.fillStyle = '#00f0ff';
        ctx.shadowColor = '#00f0ff';
        ctx.shadowBlur = 12;
        ctx.fillRect(sx - r * 1.6, sy - r * 0.35, r * 3.2, r * 0.7);
        break;
      }
      default: {
        const colors: Record<string, [string, string]> = { ki: ['#bff6ff', '#4fe3ff'], fire: ['#ffe14d', '#ff6a2a'], ice: ['#ffffff', '#7cf6ff'], orb: ['#ffffff', '#a86bff'], bottle: ['#7cff9a', '#39d353'] };
        const [c0, c1] = colors[p.kind] ?? colors.ki;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.4);
        g.addColorStop(0, c0);
        g.addColorStop(0.5, c1);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(sx, sy, r * 1.4, 0, Math.PI * 2);
        ctx.fill();
        // traînée
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = c1;
        ctx.lineWidth = r;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(sx - p.vx * 3, sy + p.vy * 3);
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawItemShadow(it: Item): void {
    const ctx = this.ctx;
    const gy = groundY(it.z) + this.cam.shakeY;
    const sx = it.x - this.cam.x + this.cam.shakeX;
    const s = depthScale(it.z);
    ctx.beginPath();
    ctx.ellipse(sx, gy, 16 * s, 5 * s, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fill();
  }

  private drawItem(it: Item): void {
    const ctx = this.ctx;
    const { sx, sy, s } = project(this.cam, it.x, it.y, it.z);
    const bob = it.kind === 'crate' ? 0 : Math.sin(this.time * 0.15 + it.id) * 3;
    ctx.save();
    ctx.translate(sx, sy + bob);
    switch (it.kind) {
      case 'crate': {
        const w = 44 * s, h = 40 * s;
        ctx.fillStyle = '#b07a3b';
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 3;
        ctx.fillRect(-w / 2, -h, w, h);
        ctx.strokeRect(-w / 2, -h, w, h);
        ctx.beginPath();
        ctx.moveTo(-w / 2, -h); ctx.lineTo(w / 2, 0);
        ctx.moveTo(w / 2, -h); ctx.lineTo(-w / 2, 0);
        ctx.stroke();
        if ((it.hp ?? 2) < 2) { ctx.strokeStyle = '#5a3a16'; ctx.beginPath(); ctx.moveTo(-w * 0.3, -h * 0.9); ctx.lineTo(0, -h * 0.4); ctx.lineTo(-w * 0.1, -h * 0.1); ctx.stroke(); }
        break;
      }
      case 'heal':
        ctx.fillStyle = '#39d353';
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, -12 * s, 11 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillRect(-2 * s, -18 * s, 4 * s, 12 * s);
        ctx.fillRect(-6 * s, -14 * s, 12 * s, 4 * s);
        break;
      case 'ki':
        ctx.fillStyle = '#4fe3ff';
        ctx.strokeStyle = '#141622';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(0, -24 * s); ctx.lineTo(9 * s, -12 * s); ctx.lineTo(0, 0); ctx.lineTo(-9 * s, -12 * s);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        break;
      case 'weapon':
        ctx.save();
        ctx.rotate(-0.9);
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-14 * s, 0); ctx.lineTo(22 * s, 0);
        ctx.lineWidth = 9 * s; ctx.strokeStyle = '#141622'; ctx.stroke();
        ctx.lineWidth = 6 * s; ctx.strokeStyle = '#c98a4b'; ctx.stroke();
        ctx.restore();
        break;
      case 'coin':
        ctx.fillStyle = '#ffe14d';
        ctx.strokeStyle = '#8a7400';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(0, -10 * s, 8 * s * Math.abs(Math.cos(this.time * 0.1 + it.id)), 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
    }
    ctx.restore();
  }
}

export { themeAccent };
