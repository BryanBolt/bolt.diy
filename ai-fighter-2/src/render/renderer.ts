// Rendu principal : canvas 960x540 virtuel mis à l'échelle, ordre de profondeur, ombres, projectiles, objets.
import { drawChestObj } from './chest';
import { growthScale, drawItemsBack, drawItemsFront, drawOrbs } from './itemfx';
import { stacks } from '../sim/bonuses';
import { orbitPos } from '../sim/sim';
import { drawAura } from './cosmetics';
import type { World, Fighter, Projectile, Item } from '../sim/types';
import { VIEW_W, VIEW_H, HURT_HW, HURT_H, REVIVE_FRAMES, REVIVE_COST } from '../sim/constants';
import { getChar, PALETTE } from '../sim/chars';
import { drawWeapon, weaponLength } from './weapons';
import { drawCrate } from './crates';
import { drawStickman, poseFor, colorsFor, lerpPose, computeRig, figureScale, type Pose } from './stickman';
import { RagdollSystem, stiffnessFor, cloneRig, RIG_KEYS, type P, type Rig } from './ragdoll';
import { drawStage, setStageExtent, themeAccent, drawForeground } from './stage';
import type { Hazard } from '../sim/types';
import { Fx } from './fx';
import { drawHud, type HudInfo } from './hud';
import { project, groundY, depthScale, applyCamera, view, type Camera } from './camera';

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  fx = new Fx();
  cam: Camera = { x: 0, zoom: 1, cx: VIEW_W / 2, cy: VIEW_H / 2, shakeX: 0, shakeY: 0 };
  scale = 1;
  exX = 0;
  exY = 0;
  offX = 0;
  offY = 0;
  time = 0;
  showHitboxes = false;
  private ghostTick = 0;
  private smooth = new Map<number, Pose>();
  private ragdolls = new RagdollSystem();
  private lastDt = 16.7;
  private pcx = VIEW_W / 2;
  private fpsAcc = 0;
  private fpsCount = 0;
  fps = 60;
  private lite = false; // qualité réduite automatique sur les appareils lents

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D indisponible');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const dpr = Math.min(window.matchMedia?.('(pointer: coarse)').matches ? 1.5 : 2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const portrait = h > w * 1.05;
    // paysage : on ajuste à la hauteur (le décor s'étend sur les côtés) ; portrait : on zoome (≈500 px de large visibles)
    this.scale = (portrait ? w / 500 : Math.min(w / VIEW_W, h / VIEW_H)) * dpr;
    view.w = this.canvas.width / this.scale;
    view.h = this.canvas.height / this.scale;
    this.exX = (view.w - VIEW_W) / 2;
    // portrait : l'action se place vers 42 % de la hauteur, les commandes tactiles occupent le bas
    this.exY = portrait ? view.h * 0.42 - VIEW_H / 2 : (view.h - VIEW_H) / 2;
    this.offX = this.exX * this.scale;
    this.offY = this.exY * this.scale;
  }

  /** Convertit une position écran (CSS px) en coordonnées virtuelles. */
  toVirtual(cssX: number, cssY: number): { x: number; y: number } {
    const dpr = this.canvas.width / this.canvas.clientWidth;
    return { x: (cssX * dpr - this.offX) / this.scale, y: (cssY * dpr - this.offY) / this.scale };
  }

  render(w: World, info: HudInfo, dtMs: number): void {
    this.time += dtMs / 16.667;
    this.lastDt = dtMs;
    if (Math.floor(this.time) % 120 === 0) this.ragdolls.forget(new Set(w.fighters.map((f) => f.id)));
    this.fpsAcc += dtMs;
    this.fpsCount++;
    if (this.fpsAcc >= 500) { this.fps = Math.round((this.fpsCount * 1000) / this.fpsAcc); this.fpsAcc = 0; this.fpsCount = 0; if (this.fps < 42) this.lite = true; else if (this.fps > 56) this.lite = false; }
    info.fps = this.fps;
    const ctx = this.ctx;
    const fx = this.fx;
    // caméra : suit la sim, zoom cinématique sur KO/super
    const targetZoom = w.slowmo > 0 ? 1.08 : fx.superFocus > 0.5 ? 1.05 : 1;
    this.cam.zoom += (targetZoom + fx.punch - this.cam.zoom) * 0.22;
    this.cam.x = w.camX;
    if (view.w < 900) {
      // portrait : la zone visible est plus étroite que celle de la simulation, la caméra suit donc les joueurs de plus près
      const ps = (w.mode === 'duel' ? w.fighters : w.fighters.filter((f) => f.team === 0)).filter((f) => f.state !== 'ko');
      if (ps.length) {
        const mean = ps.reduce((a, f) => a + f.x, 0) / ps.length;
        const lo = view.w / 2, hi = Math.max(lo, (w.locked ? w.arenaR : (w.stage?.width ?? VIEW_W)) - view.w / 2);
        const target = Math.max(lo, Math.min(hi, mean));
        this.pcx += (target - this.pcx) * 0.14;
      }
      this.cam.x = this.pcx - VIEW_W / 2;
    } else this.pcx = w.camX + VIEW_W / 2;
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
    applyCamera(ctx, this.cam);

    const theme = w.stage?.theme ?? 'dojo';
    fx.theme = theme;
    setStageExtent(view.w, this.exY, view.h - VIEW_H - this.exY);
    ctx.save();
    ctx.translate(-this.exX, 0);
    drawStage(ctx, theme, this.cam.x + this.cam.shakeX - this.exX, w.stage?.width ?? VIEW_W, this.time, { l: w.arenaL, r: w.arenaR, locked: w.locked });
    ctx.restore();

    // assombrissement super
    if (fx.superFocus > 0) {
      ctx.fillStyle = `rgba(5,5,20,${0.55 * fx.superFocus})`;
      ctx.fillRect(-900, -900, VIEW_W + 1800, VIEW_H + 1800);
      // lignes de vitesse radiales + bandes de cinéma
      ctx.save();
      ctx.translate(VIEW_W / 2, VIEW_H / 2);
      ctx.strokeStyle = `rgba(190,241,255,${0.35 * fx.superFocus})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 34; i++) {
        const a = i * 0.37 + Math.floor(this.time / 2) * 0.9;
        const r0 = 170 + ((i * 53 + this.time * 14) % 140), r1 = r0 + 90 + (i % 5) * 30;
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0 * 0.7); ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1 * 0.7); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = '#000';
      const bar = 34 * fx.superFocus;
      ctx.fillRect(-900, -900, VIEW_W + 1800, 900 + bar + this.exY);
      ctx.fillRect(-900, VIEW_H - bar - this.exY, VIEW_W + 1800, 900 + bar + this.exY);
    }

    this.drawCurrent(w);
    this.drawZones(w);
    // dangers en fond (train, drone)
    for (const h of w.hazards) if (h.kind === 'train' || h.kind === 'drone' || h.kind === 'wind') this.drawHazard(h, w);
    // ombres + anneaux
    const sorted = [...w.fighters].sort((a, b) => a.z - b.z);
    for (const f of sorted) this.drawShadow(f);
    fx.drawCracks(ctx, this.cam);
    for (const it of w.items) this.drawItemShadow(it);

    // impulsions des coups : la cible part dans le sens du choc, l'attaquant est entraîné par son geste
    for (const h of fx.hits) {
      this.ragdolls.impulse(h.target, h.dir * (3 + h.power * 7), -(1.5 + h.power * 3));
      this.ragdolls.impulse(h.attacker, h.dir * (1 + h.power * 2.5), 0);
    }
    fx.hits.length = 0;
    // images rémanentes
    this.ghostTick++;
    for (const f of w.fighters) {
      const m = f.state === 'attack' && f.moveId ? getChar(f.charId).moves[f.moveId] : null;
      const swing = m && f.stateFrame >= m.startup * 0.6 && f.stateFrame <= m.startup + m.active + 3;
      const fast = f.state === 'run' || f.state === 'dodge' || (m && (m.kind === 'special' || m.kind === 'special2' || m.kind === 'super' || m.kind === 'run'));
      if (swing || (fast && this.ghostTick % 2 === 0)) fx.addGhost(f, poseFor(f, this.time));
    }
    for (const g of fx.ghosts) {
      const { sx, sy, s } = project(this.cam, g.x, g.y, g.z);
      drawStickman(ctx, g.fighter, g.pose, { x: sx, y: sy, scale: s, facing: g.facing, alpha: (g.life / 14) * 0.45, ghost: true, time: this.time });
    }

    // entités triées par profondeur
    const drawables: { z: number; draw: () => void }[] = [];
    for (const f of sorted) drawables.push({ z: f.z, draw: () => this.drawFighter(f, w, info) });
    for (const p of w.projectiles) drawables.push({ z: p.z, draw: () => this.drawProjectile(p) });
    for (const it of w.items) drawables.push({ z: it.z, draw: () => this.drawItem(it) });
    if (w.chest) { const c = w.chest; drawables.push({ z: c.z, draw: () => { const q2 = project(this.cam, c.x, 0, c.z); drawChestObj(this.ctx, q2.sx, q2.sy, q2.s, c.tier, c.opening, this.time); } }); }
    for (const x of w.fixtures) if (x.kind !== 'current') drawables.push({ z: x.kind === 'rail' ? -999 : x.z - 1, draw: () => this.drawFixture(x, w) });
    for (const h of w.hazards) if (h.kind === 'barrel' || h.kind === 'laser') drawables.push({ z: h.kind === 'laser' ? 999 : h.z, draw: () => this.drawHazard(h, w) });
    drawables.sort((a, b) => a.z - b.z);
    for (const d of drawables) d.draw();

    fx.drawParticles(ctx, this.cam);
    ctx.save();
    ctx.translate(-this.exX, 0);
    drawForeground(ctx, theme, this.cam.x - this.exX, this.time);
    ctx.restore();
    fx.drawAmbient(ctx);
    fx.drawTexts(ctx, this.cam);
    if (fx.rageFlash > 0) { ctx.fillStyle = `rgba(255,40,40,${fx.rageFlash * 0.35})`; ctx.fillRect(-900, -900, VIEW_W + 1800, VIEW_H + 1800); }
    ctx.restore();

    // vignette légère
    if (fx.lightFlash > 0.02) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, fx.lightFlash * 0.6)})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0); // l'interface colle aux bords réels de l'écran
    const vg = ctx.createRadialGradient(view.w / 2, view.h / 2, view.h * 0.5, view.w / 2, view.h / 2, view.w * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, view.w, view.h);
    drawHud(ctx, w, fx, { ...this.cam, x: this.cam.x - this.exX, shakeY: this.cam.shakeY + this.exY }, info, this.time);
  }

  /** Courant sous-marin : traînées horizontales pendant la poussée. */
  private drawCurrent(w: World): void {
    if (!w.fixtures.some((x) => x.kind === 'current') || w.frame % 720 >= 150) return;
    const ctx = this.ctx;
    const dir = Math.floor(w.frame / 720) % 2 === 0 ? 1 : -1;
    ctx.save();
    ctx.strokeStyle = 'rgba(160,240,255,0.28)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      const y = 60 + ((i * 53) % (VIEW_H - 120));
      const x = ((this.time * 9 * dir + i * 137) % (VIEW_W + 200) + VIEW_W + 200) % (VIEW_W + 200) - 100;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - dir * (50 + (i % 3) * 30), y); ctx.stroke();
    }
    ctx.restore();
  }

  private drawFixture(x: { kind: string; x: number; z: number; used: boolean; cd: number }, _w: World): void {
    const ctx = this.ctx;
    const t = this.time;
    const { sx, sy, s } = project(this.cam, x.x, 0, x.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(s, s);
    const dim = x.cd > 0;
    switch (x.kind) {
      case 'paper': {
        ctx.fillStyle = '#5a3a22'; ctx.fillRect(-36, -128, 8, 128); ctx.fillRect(28, -128, 8, 128); ctx.fillRect(-36, -132, 72, 8); ctx.fillRect(-36, -66, 72, 5);
        if (!x.used) { ctx.fillStyle = 'rgba(255,244,222,0.92)'; ctx.fillRect(-28, -124, 56, 124); ctx.strokeStyle = '#b89a78'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -124); ctx.lineTo(0, 0); ctx.stroke(); }
        else { ctx.fillStyle = 'rgba(255,244,222,0.9)'; ctx.beginPath(); ctx.moveTo(-28, -124); ctx.lineTo(-10, -104); ctx.lineTo(-24, -80); ctx.lineTo(-28, -60); ctx.closePath(); ctx.fill(); }
        break;
      }
      case 'sign': {
        ctx.fillStyle = '#1b2230'; ctx.fillRect(-4, -150, 8, 150);
        const on = !dim && Math.floor(t / 6) % 7 !== 0;
        ctx.fillStyle = on ? '#ff3fa8' : '#4a1636'; ctx.fillRect(-34, -150, 68, 26);
        ctx.fillStyle = on ? '#3fe6ff' : '#14394a'; ctx.fillRect(-28, -144, 56, 14);
        if (dim) { ctx.strokeStyle = '#ffe14d'; ctx.lineWidth = 2; ctx.beginPath(); const a = Math.sin(t) * 10; ctx.moveTo(-10, -124); ctx.lineTo(-4 + a, -100); ctx.lineTo(6, -84); ctx.stroke(); }
        break;
      }
      case 'stall': {
        if (!x.used) {
          ctx.fillStyle = '#6b4224'; ctx.fillRect(-40, -40, 80, 40);
          for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#fff3dc' : '#d93a3a'; ctx.fillRect(-42 + i * 17, -96, 17, 26); }
          ctx.fillStyle = '#4a2c16'; ctx.fillRect(-40, -70, 5, 70); ctx.fillRect(35, -70, 5, 70);
          ctx.fillStyle = '#ffd36b'; ctx.beginPath(); ctx.arc(-14, -46, 7, 0, 7); ctx.arc(8, -46, 7, 0, 7); ctx.fill();
        } else { ctx.fillStyle = '#6b4224'; ctx.fillRect(-44, -12, 88, 12); ctx.fillStyle = '#d93a3a'; ctx.fillRect(-20, -22, 36, 10); }
        break;
      }
      case 'rail': {
        ctx.fillStyle = '#2a3340'; ctx.fillRect(-90, -8, 180, 10);
        for (let i = -90; i < 90; i += 18) { ctx.fillStyle = (i / 18) % 2 ? '#ffd23a' : '#222'; ctx.fillRect(i, -8, 18, 4); }
        if (!dim) { ctx.strokeStyle = `rgba(120,220,255,${0.4 + Math.sin(t * 0.8) * 0.3})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-90, -4); for (let i = -90; i <= 90; i += 18) ctx.lineTo(i, -4 + ((i * 7 + Math.floor(t / 3)) % 5) - 2); ctx.stroke(); }
        break;
      }
      case 'window': {
        ctx.fillStyle = '#0d1a2b'; ctx.fillRect(-42, -150, 84, 150);
        if (!x.used) { const g = ctx.createLinearGradient(-36, -144, 36, -6); g.addColorStop(0, 'rgba(160,220,255,0.75)'); g.addColorStop(1, 'rgba(60,110,170,0.55)'); ctx.fillStyle = g; ctx.fillRect(-36, -144, 72, 138); ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.moveTo(-20, -130); ctx.lineTo(10, -90); ctx.stroke(); }
        else { ctx.fillStyle = 'rgba(160,220,255,0.7)'; ctx.beginPath(); ctx.moveTo(-36, -144); ctx.lineTo(-14, -120); ctx.lineTo(-30, -96); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(36, -144); ctx.lineTo(18, -118); ctx.lineTo(34, -88); ctx.closePath(); ctx.fill(); }
        break;
      }
      case 'pylon': {
        ctx.fillStyle = '#2b3447'; ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(-6, -120); ctx.lineTo(6, -120); ctx.lineTo(14, 0); ctx.closePath(); ctx.fill();
        const r = 14 + (dim ? 0 : Math.sin(t * 0.3) * 3);
        ctx.fillStyle = dim ? '#3a4a66' : '#ffe14d'; ctx.beginPath(); ctx.arc(0, -132, r, 0, 7); ctx.fill();
        if (!dim) { ctx.strokeStyle = 'rgba(255,240,120,0.6)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, -132); ctx.lineTo(Math.sin(t) * 40, -150); ctx.stroke(); }
        break;
      }
    }
    ctx.restore();
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
    // pose lissée : les changements d'état s'enchaînent en fondu (chorégraphie fluide)
    const target = poseFor(f, this.time);
    const prev = this.smooth.get(f.id);
    const snappy = f.state === 'attack' || f.state === 'hit' || f.state === 'launch' ? 0.62 : f.state === 'run' || f.state === 'walk' ? 0.5 : 0.3;
    const k = prev ? 1 - Math.pow(1 - snappy, Math.min(3, this.lastDt / 16.7)) : 1;
    const pose = prev ? lerpPose(prev, target, k) : target;
    pose.spin = target.spin;
    this.smooth.set(f.id, pose);
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
    const bs = (f.boss ? 1.28 : 1) * growthScale(f);
    this.drawPower(f, sx, sy, s * bs, col);
    if (f.state === 'guard' || f.state === 'block') this.drawShield(f, sx, sy, s * bs);
    if (f.carry && f.state !== 'ko') { ctx.save(); ctx.translate(sx, sy - 150 * s * bs + Math.sin(this.time * 0.2) * 1.5); drawCrate(ctx, f.carry, s * bs * 0.8, this.time, false); ctx.restore(); }
    // ragdoll : les membres suivent la pose avec une raideur selon l'état (mous en vol et au sol)
    const stiff = stiffnessFor(f.state);
    const S = figureScale(f, s * bs);
    const rel = computeRig(f, pose, S, f.facing);
    const abs = cloneRig(rel);
    for (const k of ['hip', ...RIG_KEYS] as const) { (abs[k] as P).x += sx; (abs[k] as P).y += sy; }
    const sim = this.ragdolls.step(f.id, abs, stiff <= 0.82 ? stiff : 1, this.lastDt / 16.7, sy + f.y * s, f.facing);
    let rig: Rig | undefined;
    if (stiff <= 0.82) {
      rig = cloneRig(sim);
      for (const k of ['hip', ...RIG_KEYS] as const) { (rig[k] as P).x -= sx; (rig[k] as P).y -= sy; }
    }
    if (f.state !== 'ko') drawItemsBack(ctx, f, sx, sy, s * bs, this.time);
    if (f.aura && f.state !== 'ko') drawAura(ctx, f.aura, sx, sy, s * bs, this.time, f.id * 1.7, Math.abs(f.vx));
    if (w.mode === 'duel' && w.config.teams && f.state !== 'ko') {
      // anneau d'équipe sous les pieds : bleu / rouge
      ctx.save();
      ctx.strokeStyle = f.team === 0 ? '#4aa3ff' : '#ff5a4a';
      ctx.fillStyle = f.team === 0 ? 'rgba(74,163,255,0.18)' : 'rgba(255,90,74,0.18)';
      ctx.lineWidth = 3 * s;
      ctx.beginPath(); ctx.ellipse(sx, sy + 2, 34 * s * bs, 11 * s * bs, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    drawStickman(ctx, f, rig ? { ...pose, spin: 0 } : pose, { x: sx, y: sy, scale: s * bs, facing: f.facing, alpha, flash: this.fx.flash.get(f.id) ?? 0, time: this.time, rig, lite: this.lite });
    if (f.state !== 'ko') {
      drawItemsFront(ctx, f, sx, sy, s * bs, this.time);
      const orbs = stacks(f.bonuses, 'orbital');
      if (orbs) drawOrbs(ctx, Array.from({ length: orbs }, (_, i) => { const p = orbitPos(f, w.frame, i, orbs); const q = project(this.cam, p.x, f.y + 70, p.z); return q; }), this.time, f.bonuses.includes('burn'));
    }
    if (f.boss && f.state !== 'ko') this.drawBossMarks(f, sx, sy, s * bs);
    if (f.ai?.kind === 'boss' && w.bossWeak > 0 && f.state !== 'ko') this.drawWeakPoint(sx, sy, s * bs, w.bossWeak);
    if (f.controller === 'player' && f.state !== 'ko' && f.state !== 'down') {
      // repère de joueur au-dessus de la tête : flèche + pastille, toujours lisible
      const my = sy - 128 * s + Math.sin(this.time * 0.15 + f.id) * 3;
      ctx.save();
      ctx.translate(sx, my);
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(8, -6); ctx.lineTo(0, 6); ctx.closePath();
      ctx.fillStyle = col.glow; ctx.strokeStyle = '#06101e'; ctx.lineWidth = 2.5; ctx.stroke(); ctx.fill();
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.lineWidth = 3; ctx.strokeStyle = '#06101e'; ctx.strokeText('P' + (f.slot + 1), 0, -12);
      ctx.fillStyle = '#fff'; ctx.fillText('P' + (f.slot + 1), 0, -12);
      ctx.restore();
    }
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
    if (f.status.wet > 0) {
      for (let i = 0; i < 4; i++) {
        const t = (this.time * 0.9 + i * 17 + f.id * 5) % 40;
        ctx.beginPath();
        ctx.ellipse(sx + (i - 1.5) * 9 * s, sy - (95 - t * 2) * s, 1.8 * s, 3.2 * s, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(120,200,255,0.75)';
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
    // réanimation : anneau de progression + consignes lisibles
    if (f.state === 'ko' && f.team === 0 && w.mode !== 'duel' && w.mode !== 'training') this.drawRevivePrompt(f, w, info, sx, sy, s);
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

  /** Zones d'attaque annoncées : un cercle qui se remplit, rouge (ou à la couleur de l'élément). */
  private drawZones(w: World): void {
    if (!w.zones.length) return;
    const ctx = this.ctx;
    const COL: Record<string, string> = { none: '255,70,50', fire: '255,120,30', ice: '110,210,255', shock: '255,225,60', poison: '130,230,80' };
    for (const z of w.zones) {
      const { sx, sy, s } = project(this.cam, z.x, 0, z.z);
      const p = 1 - z.t / z.total;
      const c = COL[z.elem] ?? COL.none;
      const blink = z.t < 14 && Math.floor(this.time / 2) % 2 === 0;
      ctx.save();
      ctx.fillStyle = `rgba(${c},${0.10 + p * 0.22})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, z.rx * s, z.rz * s, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(${c},${0.25 + p * 0.35})`;
      ctx.beginPath(); ctx.ellipse(sx, sy, z.rx * s * p, z.rz * s * p, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = blink ? '#ffffff' : `rgba(${c},0.95)`;
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.beginPath(); ctx.ellipse(sx, sy, z.rx * s, z.rz * s, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `900 ${Math.round(22 * s)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${c},0.95)`;
      ctx.fillText('!', sx, sy + 7 * s);
      ctx.restore();
    }
  }

  /** Point faible du boss : cible lumineuse sur le torse pendant la fenêtre. */
  private drawWeakPoint(sx: number, sy: number, s: number, left: number): void {
    const ctx = this.ctx;
    const t = this.time;
    const cy = sy - 80 * s;
    const r = (16 + Math.sin(t * 0.35) * 3) * s;
    ctx.save();
    ctx.globalAlpha = Math.min(1, left / 20);
    ctx.strokeStyle = '#7dffb0';
    ctx.fillStyle = 'rgba(125,255,176,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(sx, cy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - r * 1.5, cy); ctx.lineTo(sx + r * 1.5, cy); ctx.moveTo(sx, cy - r * 1.5); ctx.lineTo(sx, cy + r * 1.5); ctx.stroke();
    ctx.restore();
  }

  private drawBossMarks(f: Fighter, sx: number, sy: number, s: number): void {
    const ctx = this.ctx;
    const t = this.time;
    // anneau doré pulsant au sol
    ctx.save();
    ctx.strokeStyle = f.rage ? '#ff3b3b' : '#ffd166';
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.6 + Math.sin(t * 0.2) * 0.3;
    ctx.beginPath(); ctx.ellipse(sx, sy + 2, 40 * s, 13 * s, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    // couronne + nom au-dessus de la tête
    const top = sy - 150 * s;
    ctx.save();
    ctx.translate(sx, top);
    ctx.fillStyle = '#ffd166';
    ctx.strokeStyle = '#141622';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 0); ctx.lineTo(-14, -14); ctx.lineTo(-7, -6); ctx.lineTo(0, -18); ctx.lineTo(7, -6); ctx.lineTo(14, -14); ctx.lineTo(14, 0); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.font = '900 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const label = `BOSS · ${f.name}`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(label, 0, 16);
    ctx.fillStyle = f.rage ? '#ff6b6b' : '#ffd166';
    ctx.fillText(label, 0, 16);
    ctx.restore();
  }

  private drawRevivePrompt(f: Fighter, w: World, info: HudInfo, sx: number, sy: number, s: number): void {
    const ctx = this.ctx;
    const me = f.slot >= 0 && info.localSlots.includes(f.slot);
    const pulse = 0.6 + Math.sin(this.time * 0.25) * 0.4;
    // anneau de progression
    const prog = Math.min(1, f.revive / REVIVE_FRAMES);
    ctx.save();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath(); ctx.ellipse(sx, sy - 24 * s, 40 * s, 40 * s, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#7cff9a';
    ctx.beginPath(); ctx.ellipse(sx, sy - 24 * s, 40 * s, 40 * s, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog); ctx.stroke();
    ctx.restore();
    if (f.koTimer > 1500) return;
    let line1: string;
    let line2 = '';
    if (me) {
      if (w.coins >= REVIVE_COST) { line1 = `Appuie sur ATTAQUE : te réanimer (${REVIVE_COST} 🪙)`; line2 = f.lives > 0 ? `ou attends ${Math.max(0, Math.ceil((900 - f.koTimer) / 60))} s : tu reviens avec une vie` : 'ou attends qu\'un allié te soigne'; }
      else if (f.lives > 0) line1 = `Retour dans ${Math.max(0, Math.ceil((900 - f.koTimer) / 60))} s (une vie)`;
      else line1 = 'Attends qu\'un allié te réanime';
    } else {
      line1 = 'Maintiens ATTAQUE près de lui pour le réanimer';
    }
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    const wTxt = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + 18;
    const by = sy - 92 * s;
    const bx = Math.max(wTxt / 2 + 8, Math.min(VIEW_W - wTxt / 2 - 8, sx));
    ctx.fillStyle = `rgba(10,30,15,${0.55 + pulse * 0.2})`;
    ctx.strokeStyle = '#7cff9a';
    ctx.lineWidth = 2;
    const hh = line2 ? 38 : 24;
    ctx.beginPath(); ctx.roundRect(bx - wTxt / 2, by - 16, wTxt, hh, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#eafff0';
    ctx.fillText(line1, bx, by);
    if (line2) { ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#b9e8c6'; ctx.fillText(line2, bx, by + 15); }
    ctx.restore();
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

  /** Bouclier de garde : demi-dôme facetté devant le combattant ; s'illumine au blocage, rougit quand la garde va casser. */
  private drawShield(f: Fighter, sx: number, sy: number, s: number): void {
    const ctx = this.ctx;
    const low = f.guardMeter < 30;
    const hit = f.state === 'block' ? 1 - Math.min(1, f.stateFrame / 10) : 0;
    const parry = f.state === 'guard' && f.guardFrames <= 7;
    const cx = sx + f.facing * 22 * s, cy = sy - (f.lowGuard ? 38 : 58) * s, R = (f.lowGuard ? 40 : 54) * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, cy);
    ctx.scale(f.facing, 1);
    const col = low ? '255,90,90' : parry ? '255,255,255' : '120,225,255';
    const g = ctx.createRadialGradient(0, 0, R * 0.2, 0, 0, R);
    g.addColorStop(0, `rgba(${col},0)`);
    g.addColorStop(1, `rgba(${col},${0.22 + hit * 0.45 + (parry ? 0.3 : 0)})`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -1.15, 1.15);
    ctx.closePath();
    ctx.fill();
    // facettes
    ctx.strokeStyle = `rgba(${col},${0.35 + hit * 0.5})`;
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) { const a = i * 0.46; ctx.moveTo(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R); }
    ctx.arc(0, 0, R, -1.15, 1.15);
    ctx.stroke();
    ctx.restore();
  }

  /** Effets de puissance : aura de charge, éclairs d'incantation, colonne d'énergie ascendante. */
  private drawPower(f: Fighter, sx: number, sy: number, s: number, col: { main: string; glow: string }): void {
    const ctx = this.ctx;
    if (f.state === 'ko' || f.state === 'down') return;
    const m = f.state === 'attack' && f.moveId ? getChar(f.charId).moves[f.moveId] : null;
    const charge = f.state === 'charge' ? Math.min(1, 0.45 + f.ki / 160 + f.kiCharge / 200) : Math.min(1, f.heavyCharge / 50);
    const casting = !!m && (m.kind === 'special' || m.kind === 'special2' || m.kind === 'super' || f.moveId!.startsWith('c_')) && f.stateFrame <= m.startup + 4;
    const formAura = f.form > 0 ? 0.55 + Math.sin(this.time * 0.2) * 0.08 : 0;
    const power = Math.max(charge, formAura, casting ? Math.min(1, 0.4 + f.stateFrame / Math.max(6, m!.startup)) : 0);
    if (power <= 0.05) return;
    const t = this.time;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // halo
    const R = (46 + power * 52) * s;
    const g = ctx.createRadialGradient(sx, sy - 52 * s, 4, sx, sy - 52 * s, R);
    g.addColorStop(0, `rgba(255,255,255,${0.35 * power})`);
    g.addColorStop(0.45, col.glow + Math.round(90 * power).toString(16).padStart(2, '0'));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(sx, sy - 52 * s, R, 0, Math.PI * 2); ctx.fill();
    // anneau au sol qui pulse
    ctx.strokeStyle = col.glow; ctx.globalAlpha = 0.7 * power; ctx.lineWidth = 3 * s;
    const pr = (24 + ((t * 2.2) % 30)) * s * (0.8 + power * 0.6);
    ctx.beginPath(); ctx.ellipse(sx, sy, pr, pr * 0.34, 0, 0, Math.PI * 2); ctx.stroke();
    // colonne d'énergie : traits qui montent
    ctx.globalAlpha = 0.75 * power; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const ph = (t * (0.9 + (i % 3) * 0.3) + i * 17) % 40;
      const x = sx + ((i * 37) % 44 - 22) * s * (0.6 + power * 0.5);
      ctx.strokeStyle = i % 2 ? '#fff' : col.glow; ctx.lineWidth = (2 + (i % 3)) * s;
      ctx.beginPath(); ctx.moveTo(x, sy - ph * 3.2 * s); ctx.lineTo(x, sy - (ph * 3.2 + 16 + power * 22) * s); ctx.stroke();
    }
    // éclairs (clignotent)
    if (power > 0.45 && Math.floor(t / 2) % 3 !== 0) {
      ctx.globalAlpha = 0.95; ctx.lineJoin = 'round';
      let seed = (Math.floor(t / 2) * 9301 + f.id * 49297) >>> 0;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let a = 0; a < 4; a++) {
        let x = sx + (rnd() - 0.5) * 20 * s, y = sy - (20 + rnd() * 80) * s;
        const dir = rnd() < 0.5 ? -1 : 1;
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let k = 0; k < 5; k++) { x += dir * (6 + rnd() * 12) * s * (0.6 + power); y += (rnd() - 0.5) * 24 * s; ctx.lineTo(x, y); }
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.4 * s; ctx.stroke();
        ctx.strokeStyle = col.glow; ctx.lineWidth = 1 * s; ctx.stroke();
      }
    }
    ctx.restore();
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
      case 'slug': {
        ctx.strokeStyle = 'rgba(255,230,140,0.9)';
        ctx.lineWidth = 3 * s;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.sign(p.vx || 1) * 20 * s, sy - p.vy * 1.2); ctx.stroke();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5 * s;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - Math.sign(p.vx || 1) * 9 * s, sy - p.vy * 0.5); ctx.stroke();
        break;
      }
      case 'bat': {
        // arme lancée : tourne sur elle-même autour de son centre
        const wk = p.wk ?? 'bat';
        ctx.translate(sx, sy);
        ctx.rotate(this.time * 0.55 * Math.sign(p.vx || 1));
        ctx.translate(-weaponLength(wk) * 0.4 * s, 0);
        drawWeapon(ctx, wk, s * 0.95, this.time, 4);
        break;
      }
      case 'crate': {
        ctx.translate(sx, sy);
        ctx.rotate(this.time * 0.22 * Math.sign(p.vx || 1));
        ctx.translate(0, 22 * s);
        drawCrate(ctx, p.cv ?? 'wood', s * 0.95, this.time, false);
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
        const colors: Record<string, [string, string]> = { ki: ['#bff6ff', '#4fe3ff'], fire: ['#ffe14d', '#ff6a2a'], ice: ['#ffffff', '#7cf6ff'], orb: ['#ffffff', '#a86bff'], bottle: ['#7cff9a', '#39d353'], poison: ['#eaffd0', '#6cff3a'], bolt: ['#ffffff', '#ffe14d'], rock: ['#e6d3b0', '#8a6a3a'], wind: ['#ffffff', '#bfe8ff'] };
        const [c0, c1] = colors[p.kind] ?? colors.ki;
        if (p.kind !== 'rock' && p.kind !== 'bottle') ctx.globalCompositeOperation = 'lighter';
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
        ctx.lineTo(sx - p.vx * (p.radius >= 30 ? 9 : 3), sy + p.vy * 3);
        ctx.stroke();
        if (p.radius >= 30) {
          // gros rayon : cœur blanc, halo pulsé et filaments
          ctx.globalAlpha = 0.9;
          ctx.fillStyle = '#fff';
          ctx.beginPath(); ctx.ellipse(sx - p.vx * 2, sy, r * (0.9 + Math.sin(this.time * 0.8) * 0.1), r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.7; ctx.strokeStyle = c0; ctx.lineWidth = 2 * s;
          for (let i = 0; i < 3; i++) {
            const o = Math.sin(this.time * 0.9 + i * 2.1) * r * 0.9;
            ctx.beginPath(); ctx.moveTo(sx, sy + o); ctx.lineTo(sx - p.vx * 7, sy + o * 0.4); ctx.stroke();
          }
        }
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
      case 'crate':
        drawCrate(ctx, it.cv ?? 'wood', s, this.time + it.id * 7, (it.hp ?? 2) < ((it.cv ?? 'wood') === 'metal' ? 4 : 2));
        break;
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
      case 'weapon': {
        const wk = it.wk ?? 'bat';
        // halo pour repérer l'arme au sol
        const halo = ctx.createRadialGradient(0, -8 * s, 2, 0, -8 * s, 30 * s);
        halo.addColorStop(0, 'rgba(255,230,140,0.55)');
        halo.addColorStop(1, 'rgba(255,230,140,0)');
        ctx.fillStyle = halo;
        ctx.fillRect(-32 * s, -40 * s, 64 * s, 64 * s);
        ctx.save();
        ctx.translate(0, -8 * s);
        ctx.lineCap = 'round';
        ctx.rotate(-0.25);
        ctx.translate(-weaponLength(wk) * 0.45 * s, 0);
        drawWeapon(ctx, wk, s * 0.95, this.time, 4);
        ctx.restore();
        break;
      }
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
