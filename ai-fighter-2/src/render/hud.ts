// Interface en jeu : barres de vie, jauges, vagues, combos, bannières, choix de bonus, pause.
import type { World, Fighter } from '../sim/types';
import { VIEW_W, VIEW_H, SUPER_MAX, KI_MAX, FPS } from '../sim/constants';
import { getChar, PALETTE } from '../sim/chars';
import { BONUS_BY_ID } from '../sim/bonuses';
import type { Fx } from './fx';
import { project, type Camera } from './camera';
import { STAGES } from '../sim/stages';
import { SHOP_ITEMS, WEAPONS } from '../sim/types';
import { REVIVE_FRAMES } from '../sim/constants';

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
  const sideW = duel ? VIEW_W / 2 - 90 : VIEW_W - 40;
  const pw = Math.min(230, sideW / Math.max(1, Math.max(leftCount, rightCount)) - 8);
  const panelX = (i: number): number => {
    if (!duel || i < leftCount) return 20 + i * (pw + 8);
    const k = i - leftCount;
    return VIEW_W - 20 - (rightCount - k) * (pw + 8) + 8;
  };
  panelPlayers.forEach((f, i) => drawPlayerPanel(ctx, f, panelX(i), 14, pw, info, w, time));
  const centerY = !duel && n > 2 ? 92 : 30;
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
    const x = (VIEW_W - bw) / 2;
    const y = VIEW_H - 46;
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText(boss.name.toUpperCase(), VIEW_W / 2, y - 6);
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
    ctx.strokeText(String(t), VIEW_W / 2, 48);
    ctx.fillText(String(t), VIEW_W / 2, 48);
    // pastilles de victoires
    const need = Math.ceil(w.config.rounds / 2);
    const teams = [...new Set(w.fighters.map((f) => f.team))].sort();
    teams.forEach((team, ti) => {
      for (let k = 0; k < need; k++) {
        const px = VIEW_W / 2 + (ti === 0 ? -1 : 1) * (40 + k * 14);
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
    ctx.fillText(`${stageLabel}  ·  ${label}`, VIEW_W / 2, centerY);
    ctx.font = `bold 13px ${FONT}`;
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(`${w.score} pts   ·   ${w.coins} 🪙`, VIEW_W / 2, centerY + 18);
    // flèche GO
    if (!w.locked && w.phase === 'fight' && Math.floor(time / 20) % 2 === 0) {
      ctx.font = `900 30px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 5;
      ctx.strokeText('GO  ➜', VIEW_W - 110, VIEW_H / 2 - 40);
      ctx.fillText('GO  ➜', VIEW_W - 110, VIEW_H / 2 - 40);
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
  if (w.phase === 'shop') drawShop(ctx, w, info, time);
  if (fx.alert) drawAlert(ctx, fx.alert, time);
  // --- écrans de fin ---
  if (w.phase === 'matchEnd' || w.phase === 'gameOver') drawEndScreen(ctx, w, time);
  // --- pause ---
  if (w.paused) drawPause(ctx, w, info);
  // --- attente réseau ---
  if (info.stalledMs > 400 && info.waitingSlots.length) {
    const names = info.waitingSlots.map((s) => info.names.get(s) ?? `Joueur ${s + 1}`).join(', ');
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    roundRect(ctx, VIEW_W / 2 - 180, VIEW_H / 2 - 24, 360, 48, 12);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 15px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(`Connexion… en attente de ${names}`, VIEW_W / 2, VIEW_H / 2 + 5);
    ctx.textAlign = 'left';
  }
  if (info.desync) {
    ctx.fillStyle = '#ff5f5f';
    ctx.font = `bold 12px ${FONT}`;
    ctx.fillText('⚠ Désynchronisation détectée : les joueurs ne voient plus la même partie.', 20, VIEW_H - 8);
  }
  if (info.showDebug) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = `11px ${FONT}`;
    ctx.textAlign = 'right';
    ctx.fillText(`${info.fps} fps${info.online ? `  ·  ping ${Math.round(info.ping)} ms` : ''}  ·  f${w.frame}`, VIEW_W - 12, VIEW_H - 8);
    ctx.textAlign = 'left';
  }
}

const ARROWS: Record<number, string> = { 0: '·', 1: '→', 2: '←', 4: '↓', 8: '↑', 5: '↘', 6: '↙', 9: '↗', 10: '↖' };

function drawTrainingPad(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  const f = w.fighters.find((x) => x.slot >= 0 && info.localSlots.includes(x.slot)) ?? w.fighters.find((x) => x.slot >= 0);
  if (!f) return;
  const y = VIEW_H - 84;
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
  ctx.translate(VIEW_W / 2, VIEW_H / 2 - 40);
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
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText('CHOISIS UN BONUS', VIEW_W / 2, 90);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(`← → choisir · Attaque valider · Lourd relancer (25 🪙, tu as ${w.coins})  ·  ${Math.ceil(w.phaseTimer / FPS)} s`, VIEW_W / 2, 112);
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
      if (selected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = chosen ? '#ffd166' : pal.main;
        ctx.stroke();
      }
      ctx.font = `26px ${FONT}`;
      ctx.fillStyle = '#fff';
      ctx.fillText(b.icon, x + 12, y + 36);
      ctx.font = `bold 15px ${FONT}`;
      ctx.fillText(b.name, x + 52, y + 26);
      ctx.font = `12px ${FONT}`;
      ctx.fillStyle = '#ddd';
      wrapText(ctx, b.desc, x + 52, y + 46, cw - 64, 14);
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
  ctx.strokeText(a.text, VIEW_W / 2, 130);
  ctx.fillStyle = blink ? '#ff5f5f' : '#ffd166';
  ctx.fillText(a.text, VIEW_W / 2, 130);
  ctx.restore();
  ctx.textAlign = 'left';
}

function drawShop(ctx: CanvasRenderingContext2D, w: World, info: HudInfo, time: number): void {
  ctx.fillStyle = 'rgba(10,10,20,0.6)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = `900 28px ${FONT}`;
  ctx.fillStyle = '#ffd166';
  ctx.fillText('ÉCHOPPE DE NOUILLES', VIEW_W / 2, 70);
  ctx.font = `13px ${FONT}`;
  ctx.fillStyle = '#ccc';
  ctx.fillText(`${w.coins} 🪙 en commun  ·  ← → choisir · Attaque acheter · Garde/Saut terminer  ·  ${Math.ceil(w.phaseTimer / FPS)} s`, VIEW_W / 2, 92);
  const rows = w.shopChoices;
  const rowH = Math.min(110, 400 / Math.max(1, rows.length));
  const cw = Math.min(170, (VIEW_W - 100) / SHOP_ITEMS.length - 8);
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
  ctx.fillRect(0, VIEW_H / 2 - 40, VIEW_W, 180);
  ctx.textAlign = 'center';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillStyle = '#fff';
  if (w.mode === 'duel') {
    const winners = w.fighters.filter((f) => f.team === w.winnerTeam).map((f) => f.name).join(' & ');
    ctx.fillText(w.winnerTeam >= 0 ? `${winners} remporte le match` : 'Match nul', VIEW_W / 2, VIEW_H / 2 + 60);
  } else {
    const ps = w.fighters.filter((f) => f.team === 0 && f.slot >= 0);
    const line = ps.map((p) => `${p.name} : ${p.kills} KO`).join('   ·   ');
    if (w.mode === 'campaign' && w.phase === 'matchEnd') {
      const epilogue = ['NOVA s\'éteint dans une pluie de pixels. La ville respire.', 'Le sensei rouvre le dojo. Le videur Tora sert les nouilles.', 'Quant au sandwich… il n\'a jamais été retrouvé.'];
      ctx.font = `italic 14px ${FONT}`;
      ctx.fillStyle = '#ffd166';
      epilogue.forEach((l, i) => ctx.fillText(l, VIEW_W / 2, VIEW_H / 2 - 2 + i * 18 - 18));
    }
    ctx.font = `bold 15px ${FONT}`;
    ctx.fillStyle = '#fff';
    ctx.fillText(line, VIEW_W / 2, VIEW_H / 2 + 60);
    ctx.fillStyle = '#ffe14d';
    ctx.fillText(`Score ${w.score}   ·   ${w.coins} pièces   ·   ${w.mode === 'survival' ? `vague ${w.survivalWave}` : `stage ${w.stageIndex + 1}`}`, VIEW_W / 2, VIEW_H / 2 + 84);
  }
  if (Math.floor(time / 30) % 2 === 0) {
    ctx.fillStyle = '#ccc';
    ctx.font = `13px ${FONT}`;
    ctx.fillText('Appuie sur Pause / Échap pour continuer', VIEW_W / 2, VIEW_H / 2 + 118);
  }
  ctx.textAlign = 'left';
}

function drawPause(ctx: CanvasRenderingContext2D, w: World, info: HudInfo): void {
  ctx.fillStyle = 'rgba(5,6,14,0.72)';
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  ctx.textAlign = 'center';
  ctx.font = `900 46px ${FONT}`;
  ctx.fillStyle = '#fff';
  ctx.fillText('PAUSE', VIEW_W / 2, 150);
  ctx.font = `14px ${FONT}`;
  ctx.fillStyle = '#ccc';
  const who = info.names.get(w.pausedBy) ?? `Joueur ${w.pausedBy + 1}`;
  ctx.fillText(`mise en pause par ${who}`, VIEW_W / 2, 178);
  ctx.textAlign = 'left';
}
