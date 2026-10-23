// Point d'entrée : écrans, sessions (local / en ligne), boucle de jeu.
import './style.css';
import { InputManager } from './input/manager';
import { Renderer } from './render/renderer';
import { Synth } from './audio/synth';
import { TouchOverlay } from './ui/touch';
import { Session, type ReplayData } from './net/session';
import { NetClient, defaultServerUrl } from './net/client';
import { loadSettings, saveSettings, loadProfile, saveProfile, resetAll, saveOnlineResume, loadOnlineResume, saveLocalGame, loadLocalGame, type Profile } from './core/storage';
import { ROSTER, getChar } from './sim/chars';
import { STAGES } from './sim/stages';
import { IN } from './sim/types';
import type { SimConfig, SimEvent } from './sim/types';
import type { LobbyOptions, LobbyState, GameMode } from '../shared/protocol';
import { DEFAULT_OPTIONS, normalizeRoomCode, decodeRle } from '../shared/protocol';
import type { ServerMsg } from '../shared/protocol';
import * as S from './ui/screens';
import type { LobbyCard } from './ui/screens';
import type { HudInfo } from './render/hud';
import type { InputDevice, KeyMap, PadMap } from './input/devices';
import { KEYMAP_P1, KEYMAP_P2, PADMAP_DEFAULT, PAD_BUTTON_NAMES } from './input/devices';
import { drawQr } from './ui/qr';
import { VIEW_W } from './sim/constants';

const VERSION = '2.1.0';

type AppState = 'menu' | 'local-lobby' | 'online' | 'online-lobby' | 'options' | 'howto' | 'game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const input = new InputManager();
const renderer = new Renderer(canvas);
const synth = new Synth();
const touch = new TouchOverlay(input.touch);
const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
// version hébergée sans serveur (page publiée) : le mode en ligne n'est pas disponible
const noNet = !!(window as unknown as { __AIF2_NO_NET?: boolean }).__AIF2_NO_NET;

let state: AppState = 'menu';
let session: Session | null = null;
let net: NetClient | null = null;
let lobby: LobbyState | null = null;
let mySlot = -1;
let chat: { name: string; text: string }[] = [];
let localCards: LobbyCard[] = [];
let localOptions: LobbyOptions = { ...DEFAULT_OPTIONS };
let gameOnline = false;
let lastStartConfig: { config: SimConfig; localSlots: number[]; allSlots: number[] } | null = null;
let pauseShown = false;
let endShown = false;
let endTimer = 0;
let rotateHint: HTMLDivElement | null = null;
let lastMenuBits = 0;
let currentSeed = 0;
let reconnecting = false;
let resumeWaiter: ((ok: boolean) => void) | null = null;
let catchupEl: HTMLDivElement | null = null;
let recoEl: HTMLDivElement | null = null;
let resyncing = false;
let resyncCount = 0;
let lastResyncAt = 0;
let demo: Session | null = null;
let demoTimer = 0;
const demoHud: HudInfo = { localSlots: [], waitingSlots: [], stalledMs: 0, desync: false, ping: 0, fps: 60, online: false, names: new Map(), showDebug: false, hidden: true };
const names = new Map<number, string>();
const hud: HudInfo = { localSlots: [], waitingSlots: [], stalledMs: 0, desync: false, ping: 0, fps: 60, online: false, names, showDebug: false };

function settings() {
  return loadSettings();
}
function myName(): string {
  return settings().name || 'Joueur';
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/** Démo en arrière-plan des menus : deux IA s'affrontent dans un stage aléatoire. */
function startDemo(): void {
  demo?.dispose();
  const ids = ROSTER.filter((r) => !r.unlock).map((r) => r.id);
  const a = ids[Math.floor(Math.random() * ids.length)];
  let b = ids[Math.floor(Math.random() * ids.length)];
  if (b === a) b = ids[(ids.indexOf(a) + 1) % ids.length];
  const config: SimConfig = { mode: 'duel', difficulty: 2, rounds: 1, teams: false, stageIndex: Math.floor(Math.random() * 7),
    players: [], bots: [{ charId: a, name: getChar(a).name, color: getChar(a).color, team: 0, level: 4 }, { charId: b, name: getChar(b).name, color: getChar(b).color, team: 1, level: 4 }] };
  demo = new Session({ config, seed: (Math.random() * 0xffffffff) >>> 0, localSlots: [], allSlots: [], delay: 0, input });
  demoTimer = 0;
}

function goMenu(): void {
  state = 'menu';
  touch.show(false);
  input.clear();
  synth.startMusic('menu');
  const onlineResume = noNet ? null : loadOnlineResume();
  const localSave = loadLocalGame();
  const el = S.show(S.menuHtml(loadProfile(), hasTouch, VERSION, noNet, { online: onlineResume?.code, local: localSave ? localSave.label : undefined }));
  el.addEventListener('click', (e) => {
    const a = actionOf(e);
    synth.unlock();
    if (a === 'resume-online') resumeOnline();
    else if (a === 'resume-local') resumeLocal();
    else if (a === 'local') goLocalLobby();
    else if (a === 'online') { if (noNet) S.toast('Le jeu en ligne demande la version avec serveur (voir le README du dépôt). Ici : solo et multijoueur local sur cet appareil.', 7000); else goOnline(); }
    else if (a === 'howto') goHowTo(settings().lastChar);
    else if (a === 'options') goOptions();
  });
}

function actionOf(e: Event): string | null {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  return t?.dataset.action ?? null;
}
function dataOf(e: Event): DOMStringMap {
  const t = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
  return t?.dataset ?? {};
}

function goHowTo(charId: string): void {
  const prev = state;
  state = 'howto';
  const el = S.show(S.howToHtml(charId), 'wide');
  el.addEventListener('click', (e) => {
    const a = actionOf(e);
    if (a === 'back') { if (prev === 'game') { S.hide(); state = 'game'; showPauseMenu(); } else goMenu(); }
    else if (a === 'howto-char') goHowTo(dataOf(e).char ?? 'kai');
  });
  if (prev === 'game') state = 'game';
}

function goOptions(): void {
  state = 'options';
  const render = () => {
    const el = S.show(S.optionsHtml(settings(), loadProfile(), [...input.pads.values()].map((p) => p.label)), 'wide');
    el.addEventListener('input', (e) => {
      const t = e.target as HTMLInputElement;
      const key = t.dataset.set as keyof ReturnType<typeof settings> | undefined;
      if (!key) return;
      const val: unknown = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
      saveSettings({ [key]: val });
      synth.applyVolume();
      applySettings();
    });
    el.addEventListener('click', async (e) => {
      const a = actionOf(e);
      const d = dataOf(e);
      if (a === 'back') goMenu();
      else if (a === 'reset-profile') { if (confirm('Effacer toute la progression et les options ?')) { resetAll(); render(); } }
      else if (a === 'reset-controls') { saveSettings({ keymap1: KEYMAP_P1, keymap2: KEYMAP_P2, padmap: PADMAP_DEFAULT }); applySettings(); render(); }
      else if (a === 'rebind') {
        const which = d.map as 'keymap1' | 'keymap2';
        const key = d.key as keyof KeyMap;
        S.toast(`Appuie sur la nouvelle touche pour « ${key} » (Échap pour annuler)`, 6000);
        const code = await waitKey();
        if (code && code !== 'Escape') {
          const map = { ...(settings()[which] ?? (which === 'keymap1' ? KEYMAP_P1 : KEYMAP_P2)) };
          map[key] = [code];
          saveSettings({ [which]: map });
          applySettings();
        }
        render();
      } else if (a === 'rebind-pad') {
        const key = d.key as keyof PadMap;
        S.toast('Appuie sur le bouton de la manette…', 6000);
        const btn = await waitPadButton();
        if (btn >= 0) {
          const map = { ...(settings().padmap ?? PADMAP_DEFAULT) };
          map[key] = btn;
          saveSettings({ padmap: map });
          applySettings();
          S.toast(`→ ${PAD_BUTTON_NAMES[btn] ?? btn}`);
        }
        render();
      }
    });
  };
  render();
}

function waitKey(): Promise<string | null> {
  return new Promise((resolve) => {
    const h = (e: KeyboardEvent) => { e.preventDefault(); window.removeEventListener('keydown', h, true); resolve(e.code); };
    window.addEventListener('keydown', h, true);
    setTimeout(() => { window.removeEventListener('keydown', h, true); resolve(null); }, 6000);
  });
}
function waitPadButton(): Promise<number> {
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp) continue;
        for (let i = 0; i < gp.buttons.length; i++) if (gp.buttons[i].pressed) { resolve(i); return; }
      }
      if (performance.now() - start > 6000) { resolve(-1); return; }
      requestAnimationFrame(tick);
    };
    setTimeout(tick, 300);
  });
}

function applySettings(): void {
  const s = settings();
  input.setKeymaps(s.keymap1 ?? KEYMAP_P1, s.keymap2 ?? KEYMAP_P2);
  input.setPadMap(s.padmap ?? PADMAP_DEFAULT);
  renderer.fx.enabledShake = s.shake;
  renderer.fx.reduce = s.reduceFx;
  renderer.showHitboxes = s.showHitboxes;
  touch.applySettings();
}

// ---------------------------------------------------------------------------
// Lobby local
// ---------------------------------------------------------------------------

function freeSlot(cards: LobbyCard[]): number {
  for (let s = 0; s < 4; s++) if (!cards.some((c) => c.slot === s)) return s;
  return -1;
}
function nextFreeColor(cards: LobbyCard[], from: number): number {
  for (let i = 0; i < 12; i++) {
    const c = (from + i) % 12;
    if (!cards.some((x) => x.color === c)) return c;
  }
  return from;
}

function goLocalLobby(): void {
  state = 'local-lobby';
  gameOnline = false;
  localCards = [];
  input.clear();
  renderLocalLobby();
}

function addLocalPlayer(device: InputDevice): void {
  const slot = freeSlot(localCards);
  if (slot < 0) return;
  const s = settings();
  const charId = localCards.length === 0 ? s.lastChar : ROSTER[localCards.length % 8].id;
  localCards.push({ slot, name: localCards.length === 0 && s.name ? s.name : `Joueur ${slot + 1}`, charId, color: nextFreeColor(localCards, localCards.length === 0 ? s.lastColor : getChar(charId).color), ready: false, isHost: slot === Math.min(...localCards.map((c) => c.slot), slot), local: true, deviceLabel: device.label });
  localCards.sort((a, b) => a.slot - b.slot);
  localCards.forEach((c, i) => (c.isHost = i === 0));
  input.assign(slot, device);
  synth.play('confirm');
  renderLocalLobby();
}

function cycleChar(card: LobbyCard, dir: number): void {
  const idx = ROSTER.findIndex((r) => r.id === card.charId);
  card.charId = ROSTER[(idx + dir + ROSTER.length) % ROSTER.length].id;
  card.ready = false;
  synth.play('ui');
}

function renderLocalLobby(): void {
  if (state !== 'local-lobby') return;
  const view = { online: false, cards: localCards, options: localOptions, isHost: true, profile: loadProfile() };
  const el = S.show(S.lobbyHtml(view), 'wide');
  el.addEventListener('click', (e) => {
    const a = actionOf(e);
    const d = dataOf(e);
    const slot = Number(d.slot);
    const card = localCards.find((c) => c.slot === slot);
    synth.unlock();
    if (a === 'back') goMenu();
    else if (a === 'join-touch') { input.touch.active = true; addLocalPlayer(input.touch); }
    else if (a === 'prev-char' && card) { cycleChar(card, -1); renderLocalLobby(); }
    else if (a === 'next-char' && card) { cycleChar(card, 1); renderLocalLobby(); }
    else if (a === 'color' && card) { card.color = Number(d.color); renderLocalLobby(); }
    else if (a === 'ready' && card) { if (S.isUnlocked(card.charId, loadProfile())) { card.ready = !card.ready; synth.play('confirm'); renderLocalLobby(); } }
    else if (a === 'leave' && card) { e.preventDefault(); input.unassign(slot); localCards = localCards.filter((c) => c !== card); localCards.forEach((c, i) => (c.isHost = i === 0)); renderLocalLobby(); }
    else if (a === 'opt') { changeOption(localOptions, d.key ?? '', Number(d.dir)); renderLocalLobby(); }
    else if (a === 'start') startLocalGame();
  });
}

function changeOption(o: LobbyOptions, key: string, dir: number): void {
  const modes: GameMode[] = ['campaign', 'duel', 'survival', 'training'];
  switch (key) {
    case 'mode': o.mode = modes[(modes.indexOf(o.mode) + dir + modes.length) % modes.length]; if (o.mode === 'duel') o.stage = Math.min(o.stage, 6); break;
    case 'difficulty': o.difficulty = ((o.difficulty + dir + 4) % 4) as 0 | 1 | 2 | 3; break;
    case 'rounds': { const r: (1 | 3 | 5)[] = [1, 3, 5]; o.rounds = r[(r.indexOf(o.rounds) + dir + 3) % 3]; break; }
    case 'bots': o.bots = Math.max(0, Math.min(3, o.bots + dir)); break;
    case 'teams': o.teams = !o.teams; break;
    case 'stage': {
      const max = o.mode === 'duel' ? 6 : Math.min(STAGES.length - 1, loadProfile().stageReached);
      o.stage = (o.stage + dir + max + 1) % (max + 1);
      break;
    }
  }
  synth.play('ui');
}

/** Boucle du lobby local : rejoindre et naviguer avec n'importe quel périphérique. */
function tickLocalLobby(): void {
  const dev = input.firstUnassignedPress();
  if (dev) { addLocalPlayer(dev); return; } // l'appui qui fait rejoindre ne doit pas aussi valider « prêt »
  let changed = false;
  for (const card of localCards) {
    const d = input.deviceFor(card.slot) as (InputDevice & { lastBits?: number; prevBits?: number }) | undefined;
    if (!d) continue;
    const bits = d.lastBits ?? 0;
    const prev = d.prevBits ?? 0;
    const pressed = bits & ~prev;
    if (!pressed) continue;
    if (pressed & IN.LEFT) { cycleChar(card, -1); changed = true; }
    if (pressed & IN.RIGHT) { cycleChar(card, 1); changed = true; }
    if (pressed & IN.UP) { card.color = (card.color + 11) % 12; changed = true; }
    if (pressed & IN.DOWN) { card.color = (card.color + 1) % 12; changed = true; }
    if (pressed & (IN.LIGHT | IN.CONFIRM | IN.JUMP)) {
      if (card.ready && card.isHost && localCards.every((c) => c.ready)) { startLocalGame(); return; }
      if (S.isUnlocked(card.charId, loadProfile())) { card.ready = !card.ready; synth.play('confirm'); changed = true; }
      else S.toast(`🔒 ${S.unlockHint(card.charId)}`);
    }
    if (pressed & IN.HEAVY) {
      if (card.ready) { card.ready = false; changed = true; }
      else if (d.kind !== 'touch') { input.unassign(card.slot); localCards = localCards.filter((c) => c !== card); localCards.forEach((c, i) => (c.isHost = i === 0)); changed = true; break; }
    }
  }
  if (changed) renderLocalLobby();
  // portraits animés
  for (const cv of S.ui.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]')) S.drawPortrait(cv, cv.dataset.char ?? 'kai', Number(cv.dataset.color), renderer.time, cv.dataset.locked === '1');
  renderer.time += 1;
}

function buildConfig(cards: LobbyCard[], o: LobbyOptions): SimConfig {
  const duel = o.mode === 'duel';
  const players = cards.map((c, i) => ({ slot: c.slot, charId: c.charId, name: c.name, color: c.color, team: duel ? (o.teams ? i % 2 : i) : 0 }));
  const bots: SimConfig['bots'] = [];
  if (duel) {
    const used = new Set(players.map((p) => p.charId));
    for (let i = 0; i < o.bots && players.length + bots.length < 4; i++) {
      const pool = ROSTER.filter((r) => !used.has(r.id) && !r.unlock);
      const ch = pool[(i * 3 + cards.length) % pool.length] ?? ROSTER[0];
      used.add(ch.id);
      const idx = players.length + i;
      bots.push({ charId: ch.id, name: `${ch.name} (IA)`, color: nextFreeColor([...cards, ...bots.map((b, k) => ({ slot: 9 + k, name: '', charId: b.charId, color: b.color, ready: true, isHost: false, local: false }))], ch.color), team: o.teams ? idx % 2 : idx, level: 2 + o.difficulty });
    }
  }
  return { mode: o.mode, difficulty: o.difficulty, rounds: o.rounds, teams: o.teams, stageIndex: o.stage, players, bots };
}

function startLocalGame(): void {
  if (!localCards.length || !localCards.every((c) => c.ready)) return;
  const first = localCards[0];
  saveSettings({ lastChar: first.charId, lastColor: first.color });
  const config = buildConfig(localCards, localOptions);
  const slots = localCards.map((c) => c.slot);
  startGame(config, (Math.random() * 0xffffffff) >>> 0, slots, slots, 0, null);
}

// ---------------------------------------------------------------------------
// En ligne
// ---------------------------------------------------------------------------

function goOnline(prefill = ''): void {
  state = 'online';
  gameOnline = true;
  const s = settings();
  const el = S.show(S.onlineHtml(s, prefill, s.serverUrl), 'compact');
  const status = el.querySelector('#online-status') as HTMLDivElement;
  const nameEl = el.querySelector('#name') as HTMLInputElement;
  const codeEl = el.querySelector('#code') as HTMLInputElement;
  const serverEl = el.querySelector('#server') as HTMLInputElement;
  const persist = () => saveSettings({ name: nameEl.value.trim().slice(0, 14), serverUrl: serverEl.value.trim() });
  el.addEventListener('click', async (e) => {
    const a = actionOf(e);
    if (!a) return;
    synth.unlock();
    if (a === 'back') { net?.close(); net = null; goMenu(); return; }
    if (a !== 'create' && a !== 'join') return;
    persist();
    const code = normalizeRoomCode(codeEl.value);
    if (a === 'join' && code.length < 5) { status.textContent = 'Entre le code à 5 caractères du salon.'; return; }
    status.textContent = 'Connexion au serveur…';
    try {
      await ensureNet();
    } catch (err) {
      status.textContent = `Impossible de joindre le serveur (${(err as Error).message}). Vérifie que le serveur tourne (npm start) et l'adresse.`;
      return;
    }
    const s2 = settings();
    if (a === 'create') net!.send({ t: 'create', name: myName(), charId: s2.lastChar, color: s2.lastColor });
    else net!.send({ t: 'join', code, name: myName(), charId: s2.lastChar, color: s2.lastColor });
    status.textContent = 'Salon…';
  });
  if (prefill.length === 5 && s.name) {
    // lien direct : rejoindre automatiquement
    setTimeout(() => (el.querySelector('[data-action="join"]') as HTMLButtonElement)?.click(), 50);
  }
}

async function ensureNet(): Promise<void> {
  if (net && net.connectedFlag) return;
  net?.close();
  net = new NetClient();
  const url = settings().serverUrl || defaultServerUrl();
  await net.connect(url);
  bindNet(net);
  net.ping();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function showReco(text: string | null): void {
  if (!text) { recoEl?.remove(); recoEl = null; return; }
  if (!recoEl) { recoEl = document.createElement('div'); recoEl.className = 'reco'; document.body.appendChild(recoEl); }
  recoEl.textContent = text;
}

/** Retour dans la partie en ligne (page rechargée, appli fermée, coupure…). */
async function resumeOnline(): Promise<void> {
  const info = loadOnlineResume();
  if (!info) { S.toast('Aucune partie à reprendre.'); goMenu(); return; }
  gameOnline = true;
  S.toast('Reconnexion à la partie…', 4000);
  try {
    await ensureNet();
  } catch {
    S.toast("Impossible de joindre le serveur. Réessaie dans quelques secondes (tes coéquipiers t'attendent).", 6000);
    return;
  }
  const ok = await new Promise<boolean>((resolve) => {
    resumeWaiter = resolve;
    net!.send({ t: 'rejoin', code: info.code, token: info.token });
    setTimeout(() => resolve(false), 10000);
  });
  resumeWaiter = null;
  if (!ok && state !== 'game') S.toast("Impossible de reprendre la partie.", 5000);
}

/** Coupure pendant une partie : on retente tout seul, la partie continue avec une IA à ta place. */
async function autoReconnect(): Promise<void> {
  if (reconnecting) return;
  const info = loadOnlineResume();
  if (!info) { endSession(); goMenu(); return; }
  reconnecting = true;
  for (let attempt = 1; attempt <= 14 && state === 'game'; attempt++) {
    showReco(`Connexion perdue : une IA joue à ta place. Reconnexion… (${attempt}/14)`);
    await sleep(Math.min(1200 * attempt, 5000));
    try {
      net?.close();
      net = new NetClient();
      await net.connect(settings().serverUrl || defaultServerUrl());
      bindNet(net);
    } catch { continue; }
    const ok = await new Promise<boolean>((resolve) => {
      resumeWaiter = resolve;
      net!.send({ t: 'rejoin', code: info.code, token: info.token });
      setTimeout(() => resolve(false), 8000);
    });
    resumeWaiter = null;
    if (ok) { reconnecting = false; showReco(null); return; }
    if (!loadOnlineResume()) break; // le serveur a répondu « partie terminée »
  }
  reconnecting = false;
  showReco(null);
  if (state === 'game') {
    S.toast('Impossible de se reconnecter. Tu pourras reprendre depuis le menu tant que la partie dure.', 7000);
    endSession();
    goMenu();
  }
}

function handleResume(m: Extract<ServerMsg, { t: 'resume' }>): void {
  mySlot = m.slot;
  gameOnline = true;
  const cards: LobbyCard[] = m.players.map((p) => ({ ...p, local: p.slot === mySlot }));
  const config = buildConfig(cards, m.options);
  for (const p of m.players) names.set(p.slot, p.name);
  lobby = { code: '', players: m.players, options: m.options, inGame: true };
  const log: Record<number, number[]> = {};
  for (const e of m.log) log[e.slot] = decodeRle(e.rle);
  if (!input.deviceFor(mySlot) || !input.deviceFor(mySlot)!.connected()) {
    const pad = [...input.pads.values()][0];
    input.assign(mySlot, pad ?? (hasTouch && !matchMedia('(pointer:fine)').matches ? input.touch : input.keyboard1));
  }
  resyncing = false;
  startGame(config, m.seed, [mySlot], m.players.map((p) => p.slot), m.delay, net, { log, events: m.events, resumeFrom: m.from >= 0 ? m.from : undefined });
  resumeWaiter?.(true);
}

/** Reprise d'une partie locale sauvegardée automatiquement (après un plantage ou une fermeture). */
function resumeLocal(): void {
  const save = loadLocalGame();
  if (!save) { S.toast('Aucune partie locale à reprendre.'); return; }
  gameOnline = false;
  input.clear();
  const all = input.allDevices();
  for (const slot of save.allSlots) {
    const id = save.devs[slot];
    input.assign(slot, all.find((d) => d.id === id && d.connected()) ?? input.keyboard1);
  }
  const log: Record<number, number[]> = {};
  for (const e of save.log) log[e.slot] = decodeRle(e.rle);
  localOptions = { ...localOptions };
  startGame(save.config as SimConfig, save.seed, save.localSlots, save.allSlots, 0, null, { log, events: save.events, pauseWhenDone: true });
}

function autosaveLocal(): void {
  if (!session || gameOnline || session.catching || !lastStartConfig) return;
  const w = session.world;
  if (w.mode === 'training' || w.phase === 'matchEnd' || w.phase === 'gameOver') return;
  const lg = session.exportLog();
  const devs: Record<number, string> = {};
  for (const s of lastStartConfig.allSlots) devs[s] = input.deviceFor(s)?.id ?? 'kb1';
  const stage = w.stage?.name ?? '';
  saveLocalGame({ v: 1, ts: Date.now(), label: `${S.MODE_LABEL[w.mode]}${stage && w.mode !== 'duel' ? ' · ' + stage : ''}`, config: lastStartConfig.config, seed: currentSeed, localSlots: lastStartConfig.localSlots, allSlots: lastStartConfig.allSlots, devs, log: lg.slots, events: lg.events });
}

function bindNet(n: NetClient): void {
  n.onClose = (reason) => {
    if (net === n) net = null;
    if (state === 'game' && gameOnline) { void autoReconnect(); return; }
    if (state === 'online-lobby') {
      S.toast(`Connexion perdue (${reason}).`, 4000);
      goMenu();
    }
  };
  n.on('error', (m) => {
    if (m.t !== 'error') return;
    S.toast(m.message, 5000);
    const st = document.getElementById('online-status');
    if (st) st.textContent = m.message;
    if (m.code === 'gone') { saveOnlineResume(null); resumeWaiter?.(false); }
  });
  n.on('resume', (m) => { if (m.t === 'resume') handleResume(m); });
  // désynchronisation détectée par le serveur : on se reconstruit depuis son journal (il fait foi)
  n.on('desync', () => {
    if (state !== 'game' || !gameOnline || !session || resyncing || session.catching) return;
    if (resyncCount >= 4 || performance.now() - lastResyncAt < 6000) return;
    resyncing = true;
    resyncCount++;
    lastResyncAt = performance.now();
    session.frozen = true; // plus aucune entrée envoyée : tout ce qu'on a envoyé est déjà dans le journal du serveur
    showReco('Resynchronisation de la partie…');
    n.send({ t: 'resync' });
    setTimeout(() => { if (resyncing && session) { resyncing = false; session.frozen = false; } showReco(null); }, 8000);
  });
  n.on('drop', (m) => { if (m.t === 'drop') S.toast(`${names.get(m.slot) ?? 'Un joueur'} a perdu la connexion : une IA le remplace, il pourra revenir.`, 4500); });
  n.on('rejoin', (m) => { if (m.t === 'rejoin') S.toast(`${names.get(m.slot) ?? 'Un joueur'} revient dans la partie !`, 4000); });
  n.on('joined', (m) => {
    if (m.t !== 'joined') return;
    mySlot = m.slot;
    chat = [];
    history.replaceState(null, '', `?salon=${m.code}`);
    saveOnlineResume({ code: m.code, token: m.token, slot: m.slot, url: settings().serverUrl, ts: Date.now() });
  });
  n.on('lobby', (m) => { if (m.t === 'lobby') { lobby = m.state; if (state === 'online' || state === 'online-lobby') { state = 'online-lobby'; renderOnlineLobby(); } } });
  n.on('chat', (m) => { if (m.t === 'chat') { const p = lobby?.players.find((x) => x.slot === m.slot); chat.push({ name: p?.name ?? `P${m.slot + 1}`, text: m.text }); if (chat.length > 30) chat.shift(); if (state === 'online-lobby') renderOnlineLobby(); else S.toast(`${p?.name ?? 'Joueur'} : ${m.text}`); } });
  n.on('start', (m) => {
    if (m.t !== 'start') return;
    const cards: LobbyCard[] = m.players.map((p) => ({ ...p, local: p.slot === mySlot }));
    const config = buildConfig(cards, m.options);
    for (const p of m.players) names.set(p.slot, p.name);
    startGame(config, m.seed, [mySlot], m.players.map((p) => p.slot), m.delay, n);
  });
  n.on('end', () => {
    saveOnlineResume(null);
    if (state === 'game') { endSession(); state = 'online-lobby'; renderOnlineLobby(); }
  });
  setInterval(() => n.ping(), 3000);
}

function renderOnlineLobby(): void {
  if (!lobby || state !== 'online-lobby') return;
  const me = lobby.players.find((p) => p.slot === mySlot);
  const cards: LobbyCard[] = lobby.players.map((p) => ({ ...p, local: p.slot === mySlot, deviceLabel: p.slot === mySlot ? deviceLabelForMe() : undefined }));
  for (const p of lobby.players) names.set(p.slot, p.name);
  const joinUrl = `${location.origin}${location.pathname}?salon=${lobby.code}`;
  const view = { online: true, code: lobby.code, joinUrl, cards, options: lobby.options, isHost: !!me?.isHost, profile: loadProfile(), ping: net?.rtt, chat };
  const el = S.show(S.lobbyHtml(view), 'wide');
  const qr = el.querySelector<HTMLCanvasElement>('canvas[data-qr]');
  if (qr) { try { drawQr(qr, joinUrl, 112); } catch { qr.remove(); } }
  const chatBox = el.querySelector('#chat');
  if (chatBox) chatBox.scrollTop = chatBox.scrollHeight;
  el.addEventListener('click', async (e) => {
    const a = actionOf(e);
    const d = dataOf(e);
    if (!a) return;
    synth.unlock();
    const slot = Number(d.slot);
    const mine = slot === mySlot && me;
    if (a === 'back') { saveOnlineResume(null); net?.send({ t: 'leave' }); net?.close(); net = null; history.replaceState(null, '', location.pathname); goMenu(); }
    else if (a === 'prev-char' && mine) net?.send({ t: 'lobby', charId: cycleId(me.charId, -1), ready: false });
    else if (a === 'next-char' && mine) net?.send({ t: 'lobby', charId: cycleId(me.charId, 1), ready: false });
    else if (a === 'color' && mine) net?.send({ t: 'lobby', color: Number(d.color) });
    else if (a === 'ready' && mine) { if (S.isUnlocked(me.charId, loadProfile())) { saveSettings({ lastChar: me.charId, lastColor: me.color }); net?.send({ t: 'lobby', ready: !me.ready }); } }
    else if (a === 'opt' && me?.isHost) { const o = { ...lobby!.options }; changeOption(o, d.key ?? '', Number(d.dir)); net?.send({ t: 'options', options: o }); }
    else if (a === 'start' && me?.isHost) net?.send({ t: 'start', seed: (Math.random() * 0xffffffff) >>> 0 });
    else if (a === 'copy-link') { try { await navigator.clipboard.writeText(joinUrl); S.toast('Lien copié !'); } catch { S.toast(joinUrl, 5000); } }
    else if (a === 'share-link') { if (navigator.share) navigator.share({ title: 'AI Fighter 2', text: `Rejoins mon salon AI Fighter 2 : code ${lobby!.code}`, url: joinUrl }).catch(() => {}); else { try { await navigator.clipboard.writeText(joinUrl); S.toast('Lien copié !'); } catch { S.toast(joinUrl, 5000); } } }
  });
  el.querySelector('#chatform')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = el.querySelector('#chatinput') as HTMLInputElement;
    const text = inp.value.trim();
    if (text) net?.send({ t: 'chat', text });
    inp.value = '';
  });
}

function cycleId(id: string, dir: number): string {
  const idx = ROSTER.findIndex((r) => r.id === id);
  return ROSTER[(idx + dir + ROSTER.length) % ROSTER.length].id;
}

function deviceLabelForMe(): string {
  const d = input.deviceFor(mySlot);
  return d ? d.label : hasTouch ? 'Tactile / clavier / manette' : 'Clavier / manette';
}

/** En ligne, le périphérique local est choisi automatiquement : manette > tactile > clavier. */
function tickOnlineLobby(): void {
  if (!input.deviceFor(mySlot) || !input.deviceFor(mySlot)!.connected()) {
    const pad = [...input.pads.values()][0];
    input.assign(mySlot, pad ?? (hasTouch && !matchMedia('(pointer:fine)').matches ? input.touch : input.keyboard1));
  }
  const dev = input.firstUnassignedPress();
  if (dev && dev.kind === 'gamepad') { input.assign(mySlot, dev); renderOnlineLobby(); }
  // navigation au périphérique
  const me = lobby?.players.find((p) => p.slot === mySlot);
  const d = input.deviceFor(mySlot) as (InputDevice & { lastBits?: number; prevBits?: number }) | undefined;
  const typing = document.activeElement?.tagName === 'INPUT';
  if (me && d && d.kind !== 'touch' && !typing) {
    const pressed = (d.lastBits ?? 0) & ~(d.prevBits ?? 0);
    if (pressed & IN.LEFT) net?.send({ t: 'lobby', charId: cycleId(me.charId, -1), ready: false });
    if (pressed & IN.RIGHT) net?.send({ t: 'lobby', charId: cycleId(me.charId, 1), ready: false });
    if (pressed & IN.UP) net?.send({ t: 'lobby', color: (me.color + 11) % 12 });
    if (pressed & IN.DOWN) net?.send({ t: 'lobby', color: (me.color + 1) % 12 });
    if (pressed & (IN.LIGHT | IN.CONFIRM)) {
      if (me.ready && me.isHost && lobby!.players.every((p) => p.ready)) net?.send({ t: 'start', seed: (Math.random() * 0xffffffff) >>> 0 });
      else if (S.isUnlocked(me.charId, loadProfile())) net?.send({ t: 'lobby', ready: !me.ready });
    }
  }
  for (const cv of S.ui.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]')) S.drawPortrait(cv, cv.dataset.char ?? 'kai', Number(cv.dataset.color), renderer.time, cv.dataset.locked === '1');
  renderer.time += 1;
}

// ---------------------------------------------------------------------------
// Partie
// ---------------------------------------------------------------------------

function startGame(config: SimConfig, seed: number, localSlots: number[], allSlots: number[], delay: number, n: NetClient | null, replay?: ReplayData): void {
  endSession();
  currentSeed = seed;
  if (!replay) resyncCount = 0;
  showReco(null);
  state = 'game';
  S.hide();
  lastStartConfig = { config, localSlots, allSlots };
  for (const p of config.players) names.set(p.slot, p.name);
  hud.localSlots = localSlots;
  hud.online = !!n;
  demo?.dispose();
  demo = null;
  session = new Session({ config, seed, localSlots, allSlots, delay, input, net: n ?? undefined, replay });
  if (import.meta.env.DEV) session.debugLog = new Map();
  renderer.fx = new (renderer.fx.constructor as new () => typeof renderer.fx)();
  applySettings();
  if (!replay) renderer.fx.onPhase('intro', session.world);
  const usesTouch = localSlots.some((s) => input.deviceFor(s)?.kind === 'touch');
  touch.show(usesTouch);
  if (usesTouch) requestLandscape();
  pauseShown = false;
  endShown = false;
  endTimer = 0;
  const theme = config.mode === 'duel' ? 'duel' : (session.world.stage?.theme ?? 'dojo');
  synth.startMusic(theme);
}

function endSession(): void {
  session?.dispose();
  session = null;
  touch.show(false);
  synth.stopMusic();
  if (rotateHint) { rotateHint.remove(); rotateHint = null; }
}

function quitToLobby(): void {
  endSession();
  saveLocalGame(null);
  if (gameOnline && net) {
    const me = lobby?.players.find((p) => p.slot === mySlot);
    if (me?.isHost) net.send({ t: 'end' });
    else { saveOnlineResume(null); net.send({ t: 'leave' }); net.close(); net = null; goMenu(); return; }
    state = 'online-lobby';
    renderOnlineLobby();
  } else {
    for (const c of localCards) c.ready = false;
    goLocalLobby();
    // on garde les attributions de périphériques
    localCards = lastStartConfig ? lastStartConfig.config.players.map((p) => ({ slot: p.slot, name: p.name, charId: p.charId, color: p.color, ready: false, isHost: false, local: true, deviceLabel: input.deviceFor(p.slot)?.label })) : [];
    localCards.forEach((c, i) => (c.isHost = i === 0));
    renderLocalLobby();
  }
}

function showPauseMenu(): void {
  if (!session) return;
  const me = lobby?.players.find((p) => p.slot === mySlot);
  const el = S.show(S.pauseHtml(true, !!me?.isHost, gameOnline), 'compact');
  pauseShown = true;
  el.addEventListener('click', (e) => {
    const a = actionOf(e);
    if (a === 'resume') { session?.queue(session.localSlots[0], IN.PAUSE); }
    else if (a === 'controls') { goHowTo(lastStartConfig?.config.players.find((p) => p.slot === session?.localSlots[0])?.charId ?? 'kai'); }
    else if (a === 'quit') { S.hide(); pauseShown = false; quitToLobby(); }
  });
}

function showEndMenu(): void {
  if (!session) return;
  const w = session.world;
  const me = lobby?.players.find((p) => p.slot === mySlot);
  const isHost = !gameOnline || !!me?.isHost;
  const title = w.phase === 'gameOver' ? 'Game over' : w.mode === 'duel' ? (w.winnerTeam >= 0 ? `Victoire de l'équipe ${w.winnerTeam + 1}` : 'Match nul') : 'Victoire !';
  const lines: string[] = [];
  if (w.mode !== 'duel') lines.push(`Score ${w.score} · ${w.coins} pièces`, ...w.fighters.filter((f) => f.team === 0 && f.slot >= 0).map((f) => `${f.name} : ${f.kills} KO`));
  else lines.push(...w.fighters.map((f) => `${f.name} (équipe ${f.team + 1}) : ${w.wins[f.team]} manche${w.wins[f.team] > 1 ? 's' : ''}`));
  const el = S.show(S.endHtml(title, lines, { canReplay: isHost, canLobby: isHost, isHost, online: gameOnline }), 'compact');
  endShown = true;
  el.addEventListener('click', (e) => {
    const a = actionOf(e);
    if (a === 'replay') {
      if (gameOnline) net?.send({ t: 'start', seed: (Math.random() * 0xffffffff) >>> 0 });
      else if (lastStartConfig) startGame(lastStartConfig.config, (Math.random() * 0xffffffff) >>> 0, lastStartConfig.localSlots, lastStartConfig.allSlots, 0, null);
    } else if (a === 'lobby') quitToLobby();
    else if (a === 'menu') { endSession(); saveLocalGame(null); if (gameOnline && net) { saveOnlineResume(null); net.send({ t: 'leave' }); net.close(); net = null; } goMenu(); }
  });
}

function handleEvents(events: SimEvent[]): void {
  if (!session) return;
  const w = session.world;
  renderer.fx.consume(events, w);
  const profile = loadProfile();
  const patch: Partial<Profile> = {};
  let changed = false;
  const panOf = (x: number | undefined) => (x === undefined ? 0 : Math.max(-1, Math.min(1, (x - w.camX - VIEW_W / 2) / (VIEW_W * 0.7))));
  for (const e of events) {
    if (e.t === 'sound') synth.play(e.id, panOf(e.x));
    else if (e.t === 'hit' && !e.blocked) {
      const t = w.fighters.find((f) => f.id === e.target);
      if (t && t.slot >= 0 && session.localSlots.includes(t.slot)) input.rumble(t.slot, 60 + e.power * 60, Math.min(1, 0.3 + e.power * 0.5));
    } else if (e.t === 'ko') {
      const t = w.fighters.find((f) => f.id === e.id);
      const killer = t ? w.fighters.find((f) => f.id === t.lastHitBy) : null;
      if (killer && killer.slot >= 0 && session.localSlots.includes(killer.slot) && t && t.team !== 0) { patch.totalKo = (patch.totalKo ?? profile.totalKo) + 1; changed = true; }
    } else if (e.t === 'phase') {
      if (e.phase === 'matchEnd' || e.phase === 'gameOver') saveLocalGame(null);
      if (e.phase === 'stageClear' && w.mode === 'campaign') {
        const reached = Math.max(profile.stageReached, w.stageIndex + 1);
        if (reached > profile.stageReached) {
          patch.stageReached = reached;
          changed = true;
          for (const c of ROSTER) if (c.unlock?.kind === 'stage' && c.unlock.value === reached) S.toast(`🔓 Nouveau combattant débloqué : ${c.name} !`, 5000);
        }
        if (w.stageIndex + 1 < STAGES.length) synth.startMusic(STAGES[w.stageIndex + 1].theme);
      }
      if (e.phase === 'matchEnd' || e.phase === 'gameOver') {
        const best = Math.max(profile.bestScore, w.score);
        patch.bestScore = best;
        changed = true;
        if (w.mode === 'survival') patch.bestSurvival = Math.max(profile.bestSurvival, w.survivalWave);
        if (w.mode === 'campaign' && e.phase === 'matchEnd') patch.campaignWins = profile.campaignWins + 1;
        if (w.mode === 'duel' && e.phase === 'matchEnd') {
          const mine = w.fighters.some((f) => f.team === w.winnerTeam && f.slot >= 0 && session!.localSlots.includes(f.slot));
          if (mine) patch.duelWins = profile.duelWins + 1;
        }
      }
      if (e.phase === 'intro' && w.mode !== 'duel' && w.stage) synth.startMusic(w.stage.theme);
    }
  }
  if (changed) saveProfile(patch);
}

function requestLandscape(): void {
  const doc = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
  const p = doc.requestFullscreen?.() ?? doc.webkitRequestFullscreen?.();
  Promise.resolve(p).then(() => {
    const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
    so.lock?.('landscape').catch(() => {});
  }).catch(() => {});
}

function updateRotateHint(): void {
  const portrait = window.innerHeight > window.innerWidth;
  const need = state === 'game' && portrait && touch.root.style.display !== 'none';
  if (need && !rotateHint) {
    rotateHint = document.createElement('div');
    rotateHint.className = 'rotate-hint';
    rotateHint.innerHTML = '<div class="ico">📱</div><b>Tourne ton téléphone en paysage</b><span class="small muted">(touche pour continuer quand même)</span>';
    rotateHint.addEventListener('click', () => { rotateHint?.remove(); rotateHint = null; });
    document.body.appendChild(rotateHint);
  } else if (!need && rotateHint && !portrait) {
    rotateHint.remove();
    rotateHint = null;
  }
}

// ---------------------------------------------------------------------------
// Boucle principale
// ---------------------------------------------------------------------------

let lastFrameTime = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  const dt = lastFrameTime ? Math.min(100, now - lastFrameTime) : 16.7;
  lastFrameTime = now;
  input.pollAll();
  synth.tickMusic();
  if (state === 'local-lobby') tickLocalLobby();
  if (state === 'online-lobby') tickOnlineLobby();
  if (state === 'menu') {
    // valider au clavier/manette depuis le menu
    const bits = input.anyBits();
    const pressed = bits & ~lastMenuBits;
    lastMenuBits = bits;
    if (pressed & IN.CONFIRM) (S.ui.querySelector('[data-action="local"]') as HTMLButtonElement | null)?.focus();
  }
  if (state !== 'game' || !session) {
    // démo d'arrière-plan
    if (!demo || demo.world.phase === 'matchEnd' || demoTimer > 60 * 90) startDemo();
    if (demo) {
      demoTimer++;
      const steps = demo.update(now);
      renderer.fx.consume(demo.events, demo.world);
      demo.events = [];
      renderer.fx.update(steps);
      renderer.render(demo.world, demoHud, dt);
    }
    return;
  }
  const w = session.world;
  session.timeScale = w.slowmo > 0 ? 0.35 : 1;
  const steps = session.update(now);
  if (session.events.length) { handleEvents(session.events); session.events = []; }
  // reconstruction de la partie (reprise) : barre de progression
  if (session.catching) {
    if (!catchupEl) {
      catchupEl = document.createElement('div');
      catchupEl.className = 'catchup';
      catchupEl.innerHTML = '<b style="font-size:20px">Reprise de la partie…</b><div class="bar"><i></i></div><span class="small muted" id="catchpct"></span>';
      document.body.appendChild(catchupEl);
    }
    const pct = Math.round(session.progress() * 100);
    (catchupEl.querySelector('i') as HTMLElement).style.width = `${pct}%`;
    (catchupEl.querySelector('#catchpct') as HTMLElement).textContent = `${pct} %`;
  } else if (catchupEl) { catchupEl.remove(); catchupEl = null; }
  // connexion morte sans coupure franche (téléphone en veille, Wi-Fi perdu) : on force la reconnexion
  if (gameOnline && net && !reconnecting && performance.now() - net.lastRx > 9000) net.kill('délai dépassé');
  // sauvegarde automatique des parties locales
  if (!gameOnline && !session.catching && w.frame > 0 && w.frame % 300 === 0 && !w.paused) autosaveLocal();
  synth.intensity = w.mode !== 'duel' && w.fighters.some((f) => f.ai?.kind === 'boss' && f.state !== 'ko') ? 1 : 0;
  renderer.fx.update(steps);
  hud.waitingSlots = session.waitingSlots;
  hud.stalledMs = session.stalledMs;
  hud.desync = session.desync;
  hud.ping = net?.rtt ?? 0;
  hud.showDebug = settings().showHitboxes || gameOnline;
  renderer.render(w, hud, dt);
  updateRotateHint();
  // menus de pause / fin
  if (w.paused && !pauseShown && !endShown) showPauseMenu();
  if (!w.paused && pauseShown && state === 'game') { S.hide(); pauseShown = false; }
  if ((w.phase === 'matchEnd' || w.phase === 'gameOver') && !endShown) {
    endTimer += dt;
    if (endTimer > 2600 || (w.paused)) { if (w.paused) session.queue(session.localSlots[0], IN.PAUSE); showEndMenu(); }
  }
}

// sauvegarde quand la page se cache ou se ferme ; reconnexion quand elle revient
window.addEventListener('pagehide', () => autosaveLocal());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) autosaveLocal();
  else if (state === 'game' && gameOnline && (!net || !net.connectedFlag) && !reconnecting) void autoReconnect();
});

// bouton pause tactile
touch.onPause = () => { if (session) session.queue(session.localSlots[0], IN.PAUSE); };

// clic/touche : déverrouille l'audio
window.addEventListener('pointerdown', () => synth.unlock(), { passive: true });
window.addEventListener('keydown', () => synth.unlock());

// service worker (production uniquement)
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

applySettings();
// accès de débogage en développement (tests automatisés)
if (import.meta.env.DEV) (window as unknown as { __aif2: unknown }).__aif2 = { get session() { return session; }, get net() { return net; }, get resyncs() { return resyncCount; } };
const params = new URLSearchParams(location.search);
const salon = params.get('salon');
const resumeInfo = salon ? loadOnlineResume() : null;
if (salon && resumeInfo && resumeInfo.code === normalizeRoomCode(salon) && !noNet) {
  // lien de salon d'une partie dont j'ai déjà une place : on reprend au lieu de rejoindre
  goMenu();
  void resumeOnline();
} else if (salon) goOnline(normalizeRoomCode(salon));
else goMenu();
requestAnimationFrame(loop);
