// Interface en jeu : barres de vie, jauges, vagues, combos, bannières, choix de bonus, pause.
import type { World, Fighter } from '../sim/types';
import { SUPER_MAX, KI_MAX, FPS } from '../sim/constants';
import { view } from './camera';
import { getChar, PALETTE } from '../sim/chars';
import { BONUS_BY_ID, RARITY, activeSynergies, synergiesUnlockedBy, stacks } from '../sim/bonuses';
import type { Fx } from './fx';
import { project, type Camera } from './camera';
import { STAGES } from '../sim/stages';
import { SHOP_ITEMS, WEAPONS, ROOMS } from '../sim/types';
import { TIER_NAME } from './chest';
import { REVIVE_FRAMES } from '../sim/constants';
import { MINI_COUNTDOWN, MINI_SMASH_FRAMES, miniCursor } from '../sim/sim';

const FONT = '"Segoe UI", system-ui, -apple-system, sans-serif';

export interface HudInfo {
  localSlots: number[];
  waitingSlots: number[];
  stalledMs: number;
  desync: boolean;
  ping: number;
  fps: number;
  online: boolean;
  names: Map<number, string>;
  showDebug: boolean;
  hidden?: boolean;
  speaking?: Set<number>;
}

const ghostHp = new Map<number, number>();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, v: number, color: string, bg = 'rgba(0,0,0,0.55)', ghost?: number): void {
  roundRect(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  if (ghost !== undefined && ghost > v) {
    roundRect(ctx, x + 1, y + 1, Math.max(0, (w - 2) * ghost), h - 2, (h - 2) / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fill();
  }
  if (v > 0) {
    roundRect(ctx, x + 1, y + 1, Math.max(h - 2, (w - 2) * Math.min(1, v)), h - 2, (h - 2) / 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

export function drawHud(ctx: CanvasRenderingContext2D, w: World, fx: Fx, cam: Camera, info: HudInfo, time: number): void {
  if (info.hidden) return;
  ctx.textBaseline = 'alphabetic';
  const players = w.fighters.filter((f) => f.team === 0 && (f.slot >= 0 || f.ai?.kind === 'bot')) as Fighter[];
  const duel = w.mode === 'duel';
  const panelPlayers = duel ? w.fighters : players;
  // --- panneaux joueurs ---
  const n = Math.max(1, panelPlayers.length);
  const leftCount = duel ? Math.ceil(n / 2) : n;
  const rightCount = n - leftCount;
  const narrow = view.w < 760; // portrait
  const sideW = duel ? view.w / 2 - (narrow ? 60 : 90) : view.w - 40 - (narrow ? 62 : 0);
  const pw = Math.min(230, sideW / Math.max(1, Math.max(leftCount, rightCount)) - 8);
  const panelX = (i: number): number => {
    if (!duel || i < leftCount) return 20 + i * (pw + 8);
    const k = i - leftCount;
    return view.w - 20 - (rightCount - k) * (pw + 8) + 8;
  };
  panelPlayers.forEach((f, i) => drawPlayerPanel(ctx, f, panelX(i), 14, pw, info, w, time));
  const centerY = narrow ? 96 : !duel && n > 2 ? 92 : 30;
  // --- ennemis : petites barres au-dessus de la tête ---
  for (const f of w.fighters) {
    if (f.team === 0 || f.state === 'ko' || (duel)) continue;
    if (f.ai?.kind === 'boss') continue;
    const { sx, sy, s } = project(cam, f.x, f.y, f.z);
    const bw = 44 * s;
    bar(ctx, sx - bw / 2, sy - 118 * s, bw, 5, f.hp / f.hpMax, '#ff5f5f');
  }
  // --- boss ---
  const boss = w.fighters.find((f) => f.team !== 0 && f.ai?.kind === 'boss' && f.state !== 'ko');
  if (boss && !duel) {
    const bw = 420;
    const x = (view.w - bw) / 2;
    const y = view.h - 46;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(boss.name.toUpperCase(), view.w / 2, y - 6);
    bar(ctx, x, y, bw, 12, boss.hp / boss.hpMax, boss.hp / boss.hpMax < 0.3 ? '#ff2d2d' : '#ff7a3d', 'rgba(0,0,0,0.6)', ghostOf(boss));
    ctx.textAlign = 'left';
  }
  // --- centre : vague / round / timer ---
  ctx.textAlign = 'center';
  if (duel) {
    const t = Math.ceil(w.roundTimer / FPS);
    ctx.font = `900 34px ${FONT}`;
    ctx.fillStyle = t <= 10 ? '#ff5f5f' : '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 5;
    ctx.strokeText(String(t), view.w / 2, 48);
    ctx.fillText(String(t), view.w / 2, 48);
    // pastilles de victoires
    const need = Math.ceil(w.config.rounds / 2);
    const teams = [...new Set(w.fighters.map((f) => f.team))].sort();
    teams.forEach((team, ti) => {
      for (let k = 0; k < need; k++) {
        const px = view.w / 2 + (ti === 0 ? -1 : 1) * (40 + k * 14);
        ctx.beginPath();
        ctx.arc(px, 60, 5, 0, Math.PI * 2);
        ctx.fillStyle = k < w.wins[team] ? '#ffd166' : 'rgba(255,255,255,0.25)';
        ctx.fill();
      }
    });
  } else if (w.mode !== 'training') {
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    const total = w.stage ? w.stage.waves.length : 0;
    const label = w.mode === 'survival' ? `VAGUE ${w.waveIndex + 1}` : w.waveIndex >= total ? 'BOSS' : `VAGUE ${Math.max(1, w.waveIndex + 1)} / ${total}`;
    const stageLabel = w.mode === 'survival' ? 'SURVIE' : `STAGE ${w.stageIndex + 1}/${STAGES.length}`;
    ctx.fillText(`${stageLabel}  ·  ${label}`, view.w / 2, centerY);
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(`${w.score} pts   ·   ${w.coins} 🪙`, view.w / 2, centerY + 18);
    // flèche GO
    if (!w.locked && w.phase === 'fight' && Math.floor(time / 20) % 2 === 0) {
      ctx.font = `900 30px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 5;
      ctx.strokeText('GO  ➜', view.w - 110, view.h / 2 - 40);
      ctx.fillText('GO  ➜', view.w - 110, view.h / 2 - 40);
    }
  }
  ctx.textAlign = 'left';
  // --- entraînement : historique des directions et dernière commande ---
  if (w.mode === 'training') drawTrainingPad(ctx, w, info);
  // --- compteurs de combo ---
  for (const [id, c] of fx.comboPops) {
    const f = w.fighters.find((x) => x.id === id);
    if (!f) continue;
    const idx = panelPlayers.indexOf(f);
    if (idx < 0) continue;
    const x = panelX(idx);
    const y = 92;
    const pop = Math.min(1, c.life / 10);
    ctx.save();
    ctx.translate(x + 10, y);
    const sc = 1 + (1 - Math.min(1, (60 - c.life) / 6)) * 0.4;
    ctx.scale(sc, sc);
    ctx.globalAlpha = pop;
    ctx.font = `900 24px ${FONT}`;
    ctx.fillStyle = c.hits >= 10 ? '#ff5fb0' : c.hits >= 5 ? '#ffd166' : '#fff';
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.lineWidth = 4;
    ctx.strokeText(`${c.hits} HITS`, 0, 0);
    ctx.fillText(`${c.hits} HITS`, 0, 0);
    ctx.restore();
  }
  // --- bannière ---
  if (fx.banner) drawBanner(ctx, fx.banner);
  // --- choix de bonus ---
  if (w.phase === 'bonus') drawBonusChoice(ctx, w, info, time);
  if (w.phase === 'rooms') drawRooms(ctx, w, info);
  if (w.phase === 'chest' && w.chest) drawChestPrompt(ctx, w, info);
  if (w.phase === 'shop') drawShop(ctx, w, info, time);
  if (w.phase === 'mini') drawMini(ctx, w, info, time);
  if (fx.alert) drawAlert(ctx, fx.alert, time);
  // --- écrans de fin ---
  if (w.phase === 'matchEnd' || w.phase === 'gameOver') drawEndScreen(ctx, w, time);
  // --- pause ---
  if (w.paused) drawPause(ctx, w, info);
  // --- attente réseau ---
  if (info.stalledMs > 400 && info.waitingSlots.length) {
    const names = info.waitingSlots.map((s) => info.names.get(s) ?? `Joueur ${s + 1}`).join(', ');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, view.w / 2 - 180, view.h / 2 - 24, 360, 48, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Connexion… en attente de ${names}`, view.w / 2, view.h / 2 + 5);
    ctx.textAlign = 'left';
  }
  if (info.desync) {
    ctx.fillStyle = '#ff5f5f';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText('⚠ Désynchronisation détectée : les joueurs ne voient plus la même partie.', 20, view.h - 8);
  }
  if (info.showDebug) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${info.fps} fps${info.online ? `  ·  ping ${Math.round(info.ping)} ms` : ''}  ·  f${w.frame}`, view.w - 12, view.h - 8);
    ctx.textAlign = 'left';
  }
}

const ARROWS: Record<number, string> = { 0: '·', 1: '→', 2: '←', 4: '↓', 8: '↑', 5: '↘', 6: '↙', 9: '↗', 10: '↖' };

function drawTrainingPad(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  const f = w.fighters.find((x) => x.slot >= 0 && info.localSlots.includes(x.slot)) ?? w.fighters.find((x) => x.slot >= 0);
  if (!f) return;
  const y = view.h - 84;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, 20, y - 20, 330, 70, 10);
  ctx.fill();
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillStyle = '#9aa3c7';
  ctx.fillText('ENTRÉES (relatives au regard)', 30, y - 5);
  ctx.font = `bold 20px ${FONT}`;
  const items = f.hist.slice(-9);
  items.forEach((e, i) => {
    const age = w.frame - e.f;
    ctx.globalAlpha = Math.max(0.25, 1 - age / 90);
    ctx.fillStyle = e.m === 0 ? '#667' : '#fff';
    ctx.fillText(ARROWS[e.m] ?? '·', 32 + i * 34, y + 22);
  });
  ctx.globalAlpha = 1;
  if (w.frame - f.lastCmdFrame < 120 && f.lastCmd) {
    ctx.font = `900 15px ${FONT}`;
    ctx.fillStyle = '#8fe3ff';
    ctx.fillText(`✔ ${f.lastCmd}`, 200, y - 5);
  }
}

function ghostOf(f: Fighter): number {
  const cur = f.hp / f.hpMax;
  const g = ghostHp.get(f.id);
  const next = g === undefined ? cur : g > cur ? Math.max(cur, g - 0.004) : cur;
  ghostHp.set(f.id, next);
  return next;
}

function drawPlayerPanel(ctx: CanvasRenderingContext2D, f: Fighter, x: number, y: number, w: number, info: HudInfo, world: World, time: number): void {
  const pal = PALETTE[f.color % PALETTE.length];
  const c = getChar(f.charId);
  const ko = f.state === 'ko';
  ctx.globalAlpha = ko ? 0.6 : 1;
  // médaillon
  ctx.beginPath();
  ctx.arc(x + 20, y + 22, 19, 0, Math.PI * 2);
  ctx.fillStyle = '#141622';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 20, y + 22, 16, 0, Math.PI * 2);
  ctx.fillStyle = pal.main;
  ctx.fill();
  ctx.fillStyle = '#141622';
  ctx.font = `900 15px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(c.name[0], x + 20, y + 28);
  ctx.textAlign = 'left';
  // nom + slot
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  const talking = f.slot >= 0 && !!info.speaking?.has(f.slot);
  const tag = (talking ? '🔊 ' : '') + (f.slot >= 0 ? `P${f.slot + 1}` : 'IA');
  const label = `${tag} · ${f.name}${info.localSlots.includes(f.slot) && info.online ? ' (toi)' : ''}`;
  ctx.strokeText(label, x + 46, y + 12);
  ctx.fillText(label, x + 46, y + 12);
  // PV
  const hpv = Math.max(0, f.hp / f.hpMax);
  bar(ctx, x + 46, y + 17, w - 50, 12, hpv, hpv < 0.3 ? (Math.floor(time / 10) % 2 ? '#ff2d2d' : '#ff7a7a') : '#39d353', 'rgba(0,0,0,0.6)', ghostOf(f));
  // Ki
  bar(ctx, x + 46, y + 32, (w - 50) * 0.55, 6, f.ki / KI_MAX, '#4fe3ff');
  // Super
  const full = f.superMeter >= SUPER_MAX;
  bar(ctx, x + 46 + (w - 50) * 0.58, y + 32, (w - 50) * 0.42, 6, f.superMeter / SUPER_MAX, full ? (Math.floor(time / 8) % 2 ? '#ffd166' : '#fff') : '#ff9f1c');
  // vies
  if (world.mode !== 'duel' && world.mode !== 'training') {
    for (let i = 0; i < f.lives; i++) {
      ctx.beginPath();
      ctx.arc(x + 48 + i * 10, y + 46, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ff5fb0';
      ctx.fill();
    }
  }
  // bonus actifs
  if (f.bonuses.length) {
    ctx.font = `11px ${FONT}`;
    const icons = f.bonuses.slice(-8).map((b) => BONUS_BY_ID[b]?.icon ?? '•').join(' ');
    ctx.fillText(icons, x + 46 + Math.min(f.lives, 3) * 10 + (world.mode === 'duel' ? 0 : 8), y + 50);
    const syn = activeSynergies(f.bonuses);
    if (syn.length) { ctx.fillStyle = '#ffb830'; ctx.fillText('✨' + syn.map((q) => q.name).join(' · '), x + 46, y + 62); }
  }
  if (f.weapon > 0 && f.weaponKind && !ko) {
    const wp = WEAPONS[f.weaponKind];
    ctx.font = `bold 11px ${FONT}`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText(`${wp.icon} ${wp.name} ${f.weapon}`, x + 46 + (w - 50) * 0.58, y + 62);
  }
  if (full && !ko) {
    ctx.font = `bold 10px ${FONT}`;
    ctx.fillStyle = '#ffd166';
    ctx.fillText('SUPER PRÊT', x + 46 + (w - 50) * 0.58, y + 50 + (f.bonuses.length ? 0 : 0) - (f.bonuses.length ? -0 : 0) );
  }
  if (ko) {
    ctx.font = `900 12px ${FONT}`;
    ctx.fillStyle = '#ff5f5f';
    const canRevive = world.mode !== 'duel' && f.revive > 0;
    ctx.fillText(canRevive ? `RÉANIMATION ${Math.round((f.revive / REVIVE_FRAMES) * 100)} %` : f.lives > 0 || world.mode === 'duel' ? 'K.O.' : 'K.O. (attends un allié)', x + 46, y + 62);
  }
  ctx.globalAlpha = 1;
}

function drawBanner(ctx: CanvasRenderingContext2D, b: { text: string; sub?: string; life: number; max: number; color: string }): void {
  const t = 1 - b.life / b.max;
  const a = Math.min(1, b.life / 15, t * 10);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = 'center';
  const sc = 1 + Math.max(0, 0.25 - t * 2);
  ctx.translate(view.w / 2, view.h / 2 - 40);
  ctx.scale(sc, sc);
  ctx.font = `900 52px ${FONT}`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(b.text, 0, 0);
  ctx.fillStyle = b.color;
  ctx.fillText(b.text, 0, 0);
  if (b.sub) {
    ctx.font = `bold 17px ${FONT}`;
    ctx.lineWidth = 4;
    ctx.strokeText(b.sub, 0, 32);
    ctx.fillStyle = '#fff';
    ctx.fillText(b.sub, 0, 32);
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawBonusChoice(ctx: CanvasRenderingContext2D, w: World, info: HudInfo, time: number): void {
  ctx.fillStyle = 'rgba(10,10,20,0.55)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText('CHOISIS UN BONUS', view.w / 2, 90);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(w.frame - w.phaseFrame < 50 ? 'Patiente un instant…' : `← → choisir · Attaque valider · Lourd relancer (25 🪙, tu as ${w.coins})  ·  ${Math.ceil(w.phaseTimer / FPS)} s`, view.w / 2, 112);
  const rows = w.bonusChoices;
  const rowH = Math.min(120, 380 / Math.max(1, rows.length));
  rows.forEach((bc, ri) => {
    const f = w.fighters.find((x) => x.slot === bc.slot && x.team === 0);
    const y = 140 + ri * rowH;
    const pal = f ? PALETTE[f.color % PALETTE.length] : PALETTE[0];
    ctx.textAlign = 'left';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = pal.main;
    ctx.fillText(`P${bc.slot + 1} · ${f?.name ?? ''}${info.localSlots.includes(bc.slot) ? '  (toi)' : ''}`, 60, y - 6);
    bc.options.forEach((id, i) => {
      const b = BONUS_BY_ID[id];
      const cw = 260;
      const x = 60 + i * (cw + 16);
      const selected = bc.cursor === i;
      const chosen = bc.chosen === i;
      roundRect(ctx, x, y, cw, rowH - 22, 10);
      ctx.fillStyle = chosen ? 'rgba(255,209,102,0.35)' : selected ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.45)';
      ctx.fill();
      const rar = RARITY[b.rarity];
      ctx.lineWidth = selected ? 3 : 1.5;
      ctx.strokeStyle = chosen ? '#ffd166' : selected ? pal.main : rar.color;
      ctx.stroke();
      const own = f ? stacks(f.bonuses, id) : 0;
      const syn = f ? synergiesUnlockedBy(f.bonuses, id) : [];
      ctx.font = `26px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(b.icon, x + 12, y + 36);
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText(b.name, x + 52, y + 26);
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = '#ddd';
      wrapText(ctx, b.desc, x + 52, y + 46, cw - 64, 14);
      ctx.font = `bold 10px ${FONT}`;
      ctx.fillStyle = rar.color;
      ctx.fillText(rar.label.toUpperCase() + (own ? `  ·  ×${own + 1}` : ''), x + 52, y + 12);
      if (syn.length) {
        ctx.fillStyle = '#ffb830';
        ctx.fillText('✨ ' + syn[0].name + ' : ' + syn[0].desc, x + 12, y + rowH - 28);
      }
      if (chosen) {
        ctx.font = `bold 12px ${FONT}`;
        ctx.fillStyle = '#ffd166';
        ctx.fillText('✔ validé', x + cw - 70, y + rowH - 32);
      }
    });
  });
  void time;
  ctx.textAlign = 'left';
}

function drawAlert(ctx: CanvasRenderingContext2D, a: { text: string; life: number }, time: number): void {
  const blink = Math.floor(time / 10) % 2 === 0;
  ctx.save();
  ctx.globalAlpha = Math.min(1, a.life / 20);
  ctx.textAlign = 'center';
  ctx.font = `900 20px ${FONT}`;
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(a.text, view.w / 2, 130);
  ctx.fillStyle = blink ? '#ff5f5f' : '#ffd166';
  ctx.fillText(a.text, view.w / 2, 130);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawChestPrompt(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  const c = w.chest!;
  if (c.opening) return;
  ctx.textAlign = 'center';
  ctx.font = `900 22px ${FONT}`;
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  const txt = `${TIER_NAME[Math.min(3, c.tier)]} : approche-toi et frappe-le !`;
  ctx.strokeText(txt, view.w / 2, 110); ctx.fillStyle = '#ffe98a'; ctx.fillText(txt, view.w / 2, 110);
  ctx.font = `13px ${FONT}`; ctx.fillStyle = '#ddd';
  ctx.fillText(`S'ouvre tout seul dans ${Math.max(0, Math.ceil(20 - c.wait / FPS))} s`, view.w / 2, 132);
  void info;
  ctx.textAlign = 'left';
}

function drawRooms(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  const rm = w.rooms;
  if (!rm) return;
  ctx.fillStyle = 'rgba(10,10,20,0.72)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText('CHOISIS UNE SALLE', view.w / 2, 80);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(w.frame - w.phaseFrame < 50 ? 'Patiente un instant…' : `← → choisir · Attaque valider (le premier qui valide décide) · ${Math.ceil(w.phaseTimer / FPS)} s`, view.w / 2, 104);
  const cw = Math.min(280, (view.w - 120) / 3 - 14);
  rm.options.forEach((id, i) => {
    const r = ROOMS[id];
    const x = view.w / 2 - (cw * 3 + 28) / 2 + i * (cw + 14), y = 140, h = 230;
    const who = rm.cursors.filter((c) => c.cursor === i);
    roundRect(ctx, x, y, cw, h, 14);
    ctx.fillStyle = who.length ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.5)';
    ctx.fill();
    ctx.lineWidth = who.length ? 3 : 1.5;
    ctx.strokeStyle = who.length ? '#ffd166' : 'rgba(255,255,255,0.3)';
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `64px ${FONT}`; ctx.fillStyle = '#fff';
    ctx.fillText(r.icon, x + cw / 2, y + 90);
    ctx.font = `bold 18px ${FONT}`; ctx.fillText(r.name, x + cw / 2, y + 128);
    ctx.font = `13px ${FONT}`; ctx.fillStyle = '#ddd';
    wrapText(ctx, r.desc, x + 22, y + 156, cw - 44, 16);
    ctx.font = `bold 12px ${FONT}`; ctx.fillStyle = '#7de8ff';
    ctx.textAlign = 'center';
    ctx.fillText(who.map((c) => `P${c.slot + 1}`).join(' · '), x + cw / 2, y + h - 14);
  });
  void info;
  ctx.textAlign = 'left';
}

function drawMini(ctx: CanvasRenderingContext2D, w: World, info: HudInfo, time: number): void {
  const m = w.mini;
  if (!m) return;
  ctx.fillStyle = 'rgba(10,10,20,0.68)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText(m.kind === 'smash' ? 'ÉPREUVE : CASSE LES PLANCHES !' : 'ÉPREUVE : CONCENTRATION', view.w / 2, 64);
  const t = w.frame - m.start - MINI_COUNTDOWN;
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(m.kind === 'smash' ? 'Matraque Attaque (ou touche l\'écran) le plus vite possible !' : 'Appuie sur Attaque quand le curseur est dans la zone verte (3 essais, de plus en plus vite).', view.w / 2, 88);
  if (t < 0) {
    ctx.font = `900 90px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(String(Math.ceil(-t / 40)), view.w / 2, view.h / 2 + 30);
    ctx.textAlign = 'left';
    return;
  }
  const rowH = Math.min(120, 380 / Math.max(1, m.players.length));
  m.players.forEach((mp, ri) => {
    const f = w.fighters.find((x) => x.slot === mp.slot && x.team === 0);
    const pal = f ? PALETTE[f.color % PALETTE.length] : PALETTE[0];
    const y = 130 + ri * rowH;
    ctx.textAlign = 'left';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = pal.main;
    ctx.fillText(`P${mp.slot + 1} · ${f?.name ?? ''}${info.localSlots.includes(mp.slot) ? '  (toi)' : ''}${mp.done ? '  ✔' : ''}`, 60, y);
    const bx = 60, bw = view.w - 120;
    if (m.kind === 'smash') {
      const boards = 12, n = Math.min(boards, Math.floor(mp.n / 5));
      for (let i = 0; i < boards; i++) {
        const x = bx + i * (bw / boards);
        const broken = i < n;
        ctx.save();
        ctx.translate(x + 2, y + 18);
        if (broken) { ctx.fillStyle = '#6b4a30'; ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(6, 20); ctx.lineTo(bw / boards - 10, 40); ctx.closePath(); ctx.fill(); }
        else {
          const crack = i === n ? (mp.n % 5) / 5 : 0;
          ctx.fillStyle = '#c99a62'; ctx.fillRect(crack > 0 ? Math.sin(time) * crack * 2 : 0, 0, bw / boards - 8, 40);
          ctx.strokeStyle = '#7a5530'; ctx.lineWidth = 1.5; ctx.strokeRect(0, 0, bw / boards - 8, 40);
          if (crack > 0) { ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(8 + crack * 8, 20); ctx.lineTo(4, 40); ctx.stroke(); }
        }
        ctx.restore();
      }
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(`${mp.n} coups · +${Math.min(12, Math.floor(mp.n / 5)) * 4} 🪙`, bx, y + 74);
      const left = Math.max(0, MINI_SMASH_FRAMES - t);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(bx + 200, y + 64, bw - 200, 8);
      ctx.fillStyle = '#7dd0ff'; ctx.fillRect(bx + 200, y + 64, (bw - 200) * left / MINI_SMASH_FRAMES, 8);
    } else {
      const by = y + 28;
      ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(bx, by, bw, 26);
      ctx.fillStyle = 'rgba(255,200,60,0.5)'; ctx.fillRect(bx + bw * 0.26, by, bw * 0.48, 26);
      ctx.fillStyle = 'rgba(255,225,60,0.7)'; ctx.fillRect(bx + bw * 0.36, by, bw * 0.28, 26);
      ctx.fillStyle = 'rgba(80,255,150,0.85)'; ctx.fillRect(bx + bw * 0.44, by, bw * 0.12, 26);
      if (!mp.done) {
        const cx = bx + bw * miniCursor(w, mp);
        ctx.fillStyle = '#fff'; ctx.fillRect(cx - 3, by - 6, 6, 38);
      }
      ctx.font = `bold 13px ${FONT}`;
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(mp.results.map((r) => (r === 25 ? '★' : r >= 12 ? '●' : r > 0 ? '◐' : '○')).join('  ') + `   +${mp.results.reduce((a, b) => a + b, 0)} 🪙`, bx, y + 74);
    }
  });
  ctx.fillStyle = '#9fc4e6';
  ctx.font = `13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText('Les pièces gagnées vont dans la cagnotte commune (échoppe ensuite).', view.w / 2, view.h - 30);
  ctx.textAlign = 'left';
}

function drawShop(ctx: CanvasRenderingContext2D, w: World, info: HudInfo, time: number): void {
  ctx.fillStyle = 'rgba(10,10,20,0.6)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText('ÉCHOPPE DE NOUILLES', view.w / 2, 70);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(w.frame - w.phaseFrame < 50 ? 'Patiente un instant…' : `${w.coins} 🪙 en commun  ·  ← → choisir · Attaque acheter · Garde (Y) pour terminer  ·  ${Math.ceil(w.phaseTimer / FPS)} s`, view.w / 2, 92);
  const rows = w.shopChoices;
  const rowH = Math.min(110, 400 / Math.max(1, rows.length));
  const cw = Math.min(170, (view.w - 100) / SHOP_ITEMS.length - 8);
  rows.forEach((sc, ri) => {
    const f = w.fighters.find((x) => x.slot === sc.slot && x.team === 0);
    const y = 120 + ri * rowH;
    const pal = f ? PALETTE[f.color % PALETTE.length] : PALETTE[0];
    ctx.textAlign = 'left';
    ctx.font = `bold 14px ${FONT}`;
    ctx.fillStyle = pal.main;
    ctx.fillText(`P${sc.slot + 1} · ${f?.name ?? ''}${info.localSlots.includes(sc.slot) ? '  (toi)' : ''}${sc.done ? '  ✔ terminé' : ''}  ·  ${f ? `${Math.round(f.hp)}/${f.hpMax} PV · ${f.lives} vie${f.lives > 1 ? 's' : ''}` : ''}`, 50, y - 6);
    SHOP_ITEMS.forEach((it, i) => {
      const x = 50 + i * (cw + 8);
      const selected = sc.cursor === i && !sc.done;
      const affordable = w.coins >= it.cost;
      roundRect(ctx, x, y, cw, rowH - 26, 10);
      ctx.fillStyle = selected ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.45)';
      ctx.fill();
      if (selected) { ctx.lineWidth = 3; ctx.strokeStyle = pal.main; ctx.stroke(); }
      ctx.globalAlpha = affordable ? 1 : 0.45;
      ctx.font = `22px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(it.icon, x + 10, y + 30);
      ctx.font = `bold 13px ${FONT}`;
      ctx.fillText(it.name, x + 42, y + 22);
      ctx.font = `11px ${FONT}`;
      ctx.fillStyle = '#ddd';
      wrapText(ctx, it.desc, x + 42, y + 38, cw - 50, 13);
      ctx.font = `bold 12px ${FONT}`;
      ctx.fillStyle = '#ffe14d';
      ctx.fillText(`${it.cost} 🪙`, x + 10, y + rowH - 34);
      const n = sc.bought.filter((b) => b === it.id).length;
      if (n) { ctx.fillStyle = '#7cff9a'; ctx.fillText(`✔ ×${n}`, x + cw - 44, y + rowH - 34); }
      ctx.globalAlpha = 1;
    });
  });
  void time;
  ctx.textAlign = 'left';
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number): void {
  const words = text.split(' ');
  let line = '';
  for (const wd of words) {
    const test = line ? `${line} ${wd}` : wd;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      line = wd;
      y += lh;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}

function drawEndScreen(ctx: CanvasRenderingContext2D, w: World, time: number): void {
  const t = Math.min(1, (w.elapsed % 100000) / 60);
  void t;
  ctx.fillStyle = 'rgba(10,10,20,0.45)';
  ctx.fillRect(0, view.h / 2 - 40, view.w, 180);
  ctx.textAlign = 'center';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = '#fff';
  if (w.mode === 'duel') {
    const winners = w.fighters.filter((f) => f.team === w.winnerTeam).map((f) => f.name).join(' & ');
    ctx.fillText(w.winnerTeam >= 0 ? `${winners} remporte le match` : 'Match nul', view.w / 2, view.h / 2 + 60);
  } else {
    const ps = w.fighters.filter((f) => f.team === 0 && f.slot >= 0);
    const line = ps.map((p) => `${p.name} : ${p.kills} KO`).join('   ·   ');
    if (w.mode === 'campaign' && w.phase === 'matchEnd') {
      const epilogue = ['NOVA s\'éteint dans une pluie de pixels. La ville respire.', 'Le sensei rouvre le dojo. Le videur Tora sert les nouilles.', 'Quant au sandwich… il n\'a jamais été retrouvé.'];
      ctx.font = `italic 14px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      epilogue.forEach((l, i) => ctx.fillText(l, view.w / 2, view.h / 2 - 2 + i * 18 - 18));
    }
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(line, view.w / 2, view.h / 2 + 60);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(`Score ${w.score}   ·   ${w.coins} pièces   ·   ${w.mode === 'survival' ? `vague ${w.survivalWave}` : `stage ${w.stageIndex + 1}`}`, view.w / 2, view.h / 2 + 84);
  }
  if (Math.floor(time / 30) % 2 === 0) {
    ctx.fillStyle = '#ccc';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('Appuie sur Pause / Échap pour continuer', view.w / 2, view.h / 2 + 118);
  }
  ctx.textAlign = 'left';
}

function drawPause(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  ctx.fillStyle = 'rgba(5,6,14,0.72)';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.textAlign = 'center';
  ctx.font = `900 46px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('PAUSE', view.w / 2, 150);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = '#ccc';
  const who = info.names.get(w.pausedBy) ?? `Joueur ${w.pausedBy + 1}`;
  ctx.fillText(`mise en pause par ${who}`, view.w / 2, 178);
  ctx.textAlign = 'left';
}
