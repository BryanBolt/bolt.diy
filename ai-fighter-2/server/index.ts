// Serveur AI Fighter 2 : salons + relais d'entrées (lockstep) + fichiers statiques.
// Lancement : npm start   (PORT=8787 par défaut)

import { createServer } from 'node:http';
import { readFile, stat, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, ServerMsg, LobbyPlayer, LobbyOptions, LobbyState } from '../shared/protocol';
import type { CtlEvent, PublicRoom, IceServer } from '../shared/protocol';
import { PROTOCOL_VERSION, MAX_PLAYERS, REJOIN_MARGIN, makeRoomCode, normalizeRoomCode, DEFAULT_OPTIONS, encodeRle } from '../shared/protocol';
import { randomUUID } from 'node:crypto';
import { todayUtc, isDateString, type DailyEntry } from '../shared/daily';
import { validReplay, type ReplayFile } from '../shared/replay';
import { validHat, validAura } from '../shared/cosmetics';
import { isProfane } from '../shared/moderation';

const PORT = Number(process.env.PORT ?? 8787);
const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = resolve(__dirname, '..', 'dist');

interface Client {
  ws: WebSocket;
  room: Room | null;
  slot: number;
  name: string;
  charId: string;
  color: number;
  team: number; // -1 : automatique (slot % 2)
  hat: string;
  aura: string;
  ready: boolean;
  rtt: number;
  lastFrame: number;
  alive: boolean;
  token: string;
  ip: string;
  lastActive: number; // dernière fois qu'une touche a été pressée (détection d'inactivité)
  afk: boolean; // une IA joue à sa place pour cause d'inactivité
}

interface Room {
  code: string;
  clients: Client[];
  options: LobbyOptions;
  inGame: boolean;
  hashes: Map<number, Map<number, number>>;
  emptySince: number;
  // reprise de partie : paramètres de départ, journal des entrées, changements de contrôle, places réservées
  start: { seed: number; options: LobbyOptions; players: LobbyPlayer[]; delay: number } | null;
  log: Map<number, number[]>;
  events: CtlEvent[];
  reserved: Map<number, { token: string; name: string; charId: string; color: number }>;
  maxFrame: number;
  banned: Set<string>; // adresses expulsées par l'hôte
}

const RESERVE_MS = 20 * 60_000;
/** Serveurs ICE envoyés aux clients : variable ICE_SERVERS (JSON) pour utiliser ton propre TURN, sinon STUN Google + relais public Open Relay. */
function iceServers(): IceServer[] {
  try {
    if (process.env.ICE_SERVERS) { const v = JSON.parse(process.env.ICE_SERVERS); if (Array.isArray(v) && v.length) return v as IceServer[]; }
  } catch { console.warn('ICE_SERVERS invalide (JSON attendu) : valeurs par défaut utilisées'); }
  return [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
  ];
}
const AFK_MS = Number(process.env.AFK_MS ?? 60_000);

const rooms = new Map<string, Room>();
const clients = new Set<Client>();

function send(c: Client, msg: ServerMsg): void {
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(msg));
}
function broadcast(room: Room, msg: ServerMsg, except?: Client): void {
  for (const c of room.clients) if (c !== except) send(c, msg);
}
function lobbyState(room: Room): LobbyState {
  const players: LobbyPlayer[] = room.clients
    .slice()
    .sort((a, b) => a.slot - b.slot)
    .map((c, i) => ({ slot: c.slot, name: c.name, charId: c.charId, color: c.color, ready: c.ready, isHost: i === 0, connected: true, team: c.team >= 0 ? c.team : c.slot % 2, hat: c.hat, aura: c.aura }));
  return { code: room.code, players, options: room.options, inGame: room.inGame };
}
function host(room: Room): Client | undefined {
  return room.clients.slice().sort((a, b) => a.slot - b.slot)[0];
}
function freeSlot(room: Room): number {
  for (let s = 0; s < MAX_PLAYERS; s++) if (!room.clients.some((c) => c.slot === s) && !room.reserved.has(s)) return s;
  return -1;
}
function freeColor(room: Room, wanted: number): number {
  for (let i = 0; i < 12; i++) {
    const c = (wanted + i) % 12;
    if (!room.clients.some((x) => x.color === c)) return c;
  }
  return wanted % 12;
}
function newRoom(isPublic: boolean): Room {
  let code = makeRoomCode(Math.random);
  while (rooms.has(code)) code = makeRoomCode(Math.random);
  const room: Room = { code, clients: [], options: { ...DEFAULT_OPTIONS, isPublic }, inGame: false, hashes: new Map(), emptySince: 0, start: null, log: new Map(), events: [], reserved: new Map(), maxFrame: 0, banned: new Set() };
  rooms.set(code, room);
  return room;
}

/** Salons publics rejoignables : en salon d'attente, au moins un joueur, une place libre. */
function openPublicRooms(): Room[] {
  return [...rooms.values()].filter((r) => r.options.isPublic && r.clients.length > 0 && r.clients.length < MAX_PLAYERS && r.options.mode !== 'training');
}

function publicList(): PublicRoom[] {
  return openPublicRooms().map((r) => {
    const players = lobbyState(r).players;
    return { code: r.code, host: players[0]?.name ?? '?', mode: r.options.mode, difficulty: r.options.difficulty, players: r.clients.length, max: MAX_PLAYERS, teams: r.options.teams, names: players.map((p) => p.name), inGame: r.inGame };
  }).sort((a, b) => b.players - a.players).slice(0, 30);
}

function seat(c: Client, room: Room, slot: number, name: unknown, charId: unknown, color: unknown, created: boolean, hat?: unknown, aura?: unknown): void {
  c.hat = validHat(hat);
  c.aura = validAura(aura);
  c.name = cleanName(name, slot === 0 ? 'Hôte' : `Joueur ${slot + 1}`);
  c.charId = String(charId ?? 'kai').slice(0, 16);
  c.color = freeColor(room, Number(color) | 0);
  c.ready = false;
  c.slot = slot;
  c.room = room;
  room.clients.push(c);
  room.emptySince = 0;
  send(c, { t: 'joined', slot, code: room.code, token: c.token, created });
  broadcast(room, { t: 'lobby', state: lobbyState(room) });
}

/** Un joueur rejoint une partie en cours : nouvel événement `join` à une frame future, reconstruction par rejeu du journal. */
function joinRunning(c: Client, room: Room, slot: number, name: unknown, charId: unknown, color: unknown, hat?: unknown, aura?: unknown): void {
  if (!room.start) return;
  c.hat = validHat(hat);
  c.aura = validAura(aura);
  c.name = cleanName(name, `Joueur ${slot + 1}`);
  c.charId = String(charId ?? 'kai').slice(0, 16);
  c.color = freeColor(room, Number(color) | 0);
  c.ready = false;
  c.slot = slot;
  c.lastActive = Date.now();
  c.afk = false;
  const lastEvt = room.events.reduce((m, e) => Math.max(m, e.from), 0);
  const from = Math.max(room.maxFrame + REJOIN_MARGIN, lastEvt + 1);
  c.lastFrame = from - 1;
  const ev: CtlEvent = { slot, from, ai: false, join: { name: c.name, charId: c.charId, color: c.color, hat: c.hat, aura: c.aura } };
  room.events.push(ev);
  room.emptySince = 0;
  c.room = room;
  room.clients.push(c);
  send(c, { t: 'joined', slot, code: room.code, token: c.token });
  send(c, { t: 'resume', seed: room.start.seed, options: room.start.options, players: room.start.players, delay: room.start.delay, slot, from, log: [...room.log].map(([s, arr]) => ({ slot: s, rle: encodeRle(arr) })), events: room.events });
  broadcast(room, { t: 'rejoin', slot, from, join: ev.join }, c);
  broadcast(room, { t: 'lobby', state: lobbyState(room) });
  console.log(`[${room.code}] ${c.name} rejoint la partie en cours (slot ${slot}) à la frame ${from}`);
}

function cleanName(s: unknown, fallback: string): string {
  const v = String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 14);
  return v && !isProfane(v) ? v : fallback;
}
/** `voluntary` : le joueur a choisi de partir (sa place n'est pas gardée) ; sinon coupure réseau (place réservée). */
function leaveRoom(c: Client, voluntary = true): void {
  const room = c.room;
  if (!room) return;
  room.clients = room.clients.filter((x) => x !== c);
  c.room = null;
  if (room.inGame) {
    const ev: CtlEvent = { slot: c.slot, from: c.lastFrame + 1, ai: true };
    room.events.push(ev);
    broadcast(room, { t: 'drop', slot: c.slot, from: ev.from });
    if (!voluntary) room.reserved.set(c.slot, { token: c.token, name: c.name, charId: c.charId, color: c.color });
  }
  if (room.clients.length === 0) {
    room.emptySince = Date.now();
  } else {
    broadcast(room, { t: 'lobby', state: lobbyState(room) });
  }
}

function handle(c: Client, msg: ClientMsg): void {
  switch (msg.t) {
    case 'hello':
      if (msg.v !== PROTOCOL_VERSION) send(c, { t: 'error', code: 'version', message: 'Version du jeu différente du serveur. Recharge la page.' });
      else send(c, { t: 'welcome', v: PROTOCOL_VERSION, ice: iceServers() });
      return;
    case 'pong':
      c.rtt = Math.max(0, Date.now() - Number(msg.ts));
      return;
    case 'ping':
      send(c, { t: 'pong', ts: msg.ts });
      return;
    case 'create': {
      leaveRoom(c);
      const room = newRoom(!!msg.public);
      seat(c, room, 0, msg.name, msg.charId, msg.color, true, msg.hat, msg.aura);
      return;
    }
    case 'list':
      send(c, { t: 'rooms', rooms: publicList() });
      return;
    case 'quick': {
      // partie rapide : le salon public le plus rempli, sinon on en ouvre un
      leaveRoom(c);
      const open = openPublicRooms().filter((r) => freeSlot(r) >= 0 && !r.banned.has(c.ip)).sort((a, b) => b.clients.length - a.clients.length)[0];
      if (open) {
        if (open.inGame && open.start) joinRunning(c, open, freeSlot(open), msg.name, msg.charId, msg.color, msg.hat, msg.aura);
        else seat(c, open, freeSlot(open), msg.name, msg.charId, msg.color, false, msg.hat, msg.aura);
        return;
      }
      const room = newRoom(true);
      seat(c, room, 0, msg.name, msg.charId, msg.color, true, msg.hat, msg.aura);
      return;
    }
    case 'join': {
      const code = normalizeRoomCode(String(msg.code ?? ''));
      const room = rooms.get(code);
      if (!room) { send(c, { t: 'error', code: 'noroom', message: `Salon ${code || '?'} introuvable.` }); return; }
      if (room.banned.has(c.ip)) { send(c, { t: 'error', code: 'banned', message: "L'hôte t'a expulsé de ce salon." }); return; }
      const slot = freeSlot(room);
      if (slot < 0) { send(c, { t: 'error', code: 'full', message: 'Salon complet (4 joueurs).' }); return; }
      leaveRoom(c);
      if (room.inGame && room.start) joinRunning(c, room, slot, msg.name, msg.charId, msg.color, msg.hat, msg.aura);
      else seat(c, room, slot, msg.name, msg.charId, msg.color, false, msg.hat, msg.aura);
      return;
    }
    case 'leave':
      leaveRoom(c, true);
      return;
    case 'kick': {
      const room = c.room;
      if (!room || host(room) !== c) return;
      const target = room.clients.find((x) => x.slot === Number(msg.slot));
      if (!target || target === c) return;
      send(target, { t: 'kicked' });
      if (target.ip && target.ip !== c.ip) room.banned.add(target.ip);
      room.reserved.delete(target.slot);
      leaveRoom(target, true);
      setTimeout(() => target.ws.close(), 200);
      console.log(`[${room.code}] ${target.name} expulsé par l'hôte`);
      return;
    }
    case 'rtc': {
      // chat vocal : le serveur ne fait que relayer la signalisation (SDP / ICE) à un joueur du même salon
      const room = c.room;
      if (!room || c.slot < 0) return;
      const data = typeof msg.data === 'string' ? msg.data : '';
      if (!data || data.length > 6000) return;
      const target = room.clients.find((x) => x.slot === Number(msg.to));
      if (target && target !== c) send(target, { t: 'rtc', from: c.slot, data });
      return;
    }
    case 'resync': {
      const room = c.room;
      if (!room || !room.inGame || !room.start || c.slot < 0) return;
      room.hashes.clear();
      send(c, { t: 'resume', seed: room.start.seed, options: room.start.options, players: room.start.players, delay: room.start.delay, slot: c.slot, from: -1, log: [...room.log].map(([s, arr]) => ({ slot: s, rle: encodeRle(arr) })), events: room.events });
      return;
    }
    case 'rejoin': {
      const room = rooms.get(normalizeRoomCode(String(msg.code ?? '')));
      const token = String(msg.token ?? '');
      if (!room || !room.inGame || !room.start || !token) { send(c, { t: 'error', code: 'gone', message: "Cette partie n'existe plus (elle est terminée ou le salon a été fermé)." }); return; }
      // même joueur toujours connecté ailleurs (ancien onglet) : on le déconnecte proprement
      const twin = room.clients.find((x) => x.token === token);
      if (twin && twin !== c) { leaveRoom(twin, false); twin.ws.terminate(); }
      let slot = -1;
      for (const [s, r] of room.reserved) if (r.token === token) slot = s;
      if (slot < 0) { send(c, { t: 'error', code: 'gone', message: "Ta place dans cette partie n'est plus disponible." }); return; }
      leaveRoom(c, true);
      const r = room.reserved.get(slot)!;
      room.reserved.delete(slot);
      c.name = r.name; c.charId = r.charId; c.color = r.color; c.token = token; c.slot = slot; c.ready = false; c.lastActive = Date.now(); c.afk = false;
      const lastEvt = room.events.reduce((m, e) => Math.max(m, e.from), 0);
      const from = Math.max(room.maxFrame + REJOIN_MARGIN, lastEvt + 1);
      c.lastFrame = from - 1;
      const ev: CtlEvent = { slot, from, ai: false };
      room.events.push(ev);
      room.emptySince = 0;
      c.room = room;
      room.clients.push(c);
      send(c, { t: 'joined', slot, code: room.code, token });
      send(c, { t: 'resume', seed: room.start.seed, options: room.start.options, players: room.start.players, delay: room.start.delay, slot, from, log: [...room.log].map(([s, arr]) => ({ slot: s, rle: encodeRle(arr) })), events: room.events });
      broadcast(room, { t: 'rejoin', slot, from }, c);
      console.log(`[${room.code}] ${c.name} (slot ${slot}) revient, reprise à la frame ${from}`);
      return;
    }
    case 'lobby': {
      const room = c.room;
      if (!room) return;
      if (msg.charId !== undefined) c.charId = String(msg.charId).slice(0, 16);
      if (msg.color !== undefined) c.color = Number(msg.color) | 0;
      if (msg.ready !== undefined) c.ready = !!msg.ready;
      if (msg.hat !== undefined) c.hat = validHat(msg.hat);
      if (msg.aura !== undefined) c.aura = validAura(msg.aura);
      if (msg.team !== undefined) c.team = Number(msg.team) === 1 ? 1 : 0;
      if (msg.name !== undefined) c.name = cleanName(msg.name, c.name);
      broadcast(room, { t: 'lobby', state: lobbyState(room) });
      return;
    }
    case 'options': {
      const room = c.room;
      if (!room || host(room) !== c) return;
      room.options = { ...room.options, ...msg.options };
      broadcast(room, { t: 'lobby', state: lobbyState(room) });
      return;
    }
    case 'start': {
      const room = c.room;
      if (!room || host(room) !== c || room.inGame) return;
      room.inGame = true;
      room.hashes.clear();
      room.log = new Map();
      room.events = [];
      room.reserved.clear();
      room.maxFrame = 0;
      for (const cl of room.clients) { cl.lastFrame = -1; cl.ready = false; cl.lastActive = Date.now(); cl.afk = false; }
      const maxRtt = Math.max(0, ...room.clients.map((x) => x.rtt));
      const delay = Math.min(8, Math.max(2, Math.ceil(maxRtt / 2 / 16.67) + 2));
      const state = lobbyState(room);
      room.start = { seed: (Number(msg.seed) >>> 0) || 1, options: { ...room.options }, players: state.players, delay };
      broadcast(room, { t: 'start', ...room.start });
      console.log(`[${room.code}] départ : ${state.players.length} joueurs, mode ${room.options.mode}, délai ${delay} frames (RTT max ${maxRtt} ms)`);
      return;
    }
    case 'input': {
      const room = c.room;
      if (!room || !room.inGame) return;
      if (!Array.isArray(msg.bits) || msg.bits.length > 8) return;
      const f = Number(msg.f) | 0;
      const bits = msg.bits.map((b) => Number(b) | 0);
      if (bits.some((b) => b !== 0)) {
        c.lastActive = Date.now();
        if (c.afk) {
          // le joueur inactif reprend la main : retour annoncé dans le futur, comme un joueur qui revient
          c.afk = false;
          const lastEvt = room.events.reduce((m, e) => Math.max(m, e.from), 0);
          const from = Math.max(room.maxFrame + REJOIN_MARGIN, lastEvt + 1);
          room.events.push({ slot: c.slot, from, ai: false });
          broadcast(room, { t: 'rejoin', slot: c.slot, from });
        }
      }
      c.lastFrame = Math.max(c.lastFrame, f + bits.length - 1);
      room.maxFrame = Math.max(room.maxFrame, c.lastFrame);
      let arr = room.log.get(c.slot);
      if (!arr) { arr = []; room.log.set(c.slot, arr); }
      if (f >= 0 && f < 400_000) for (let i = 0; i < bits.length; i++) if (arr[f + i] === undefined) arr[f + i] = bits[i];
      broadcast(room, { t: 'input', slot: c.slot, f, bits }, c);
      return;
    }
    case 'hash': {
      const room = c.room;
      if (!room || !room.inGame) return;
      const f = Number(msg.f) | 0;
      let m = room.hashes.get(f);
      if (!m) { m = new Map(); room.hashes.set(f, m); }
      m.set(c.slot, Number(msg.h) >>> 0);
      if (m.size >= room.clients.length) {
        const vals = new Set(m.values());
        if (vals.size > 1) {
          console.warn(`[${room.code}] désynchronisation à la frame ${f} : ${[...m].map(([sl, h]) => `slot${sl}=${h}`).join(' ')}`);
          broadcast(room, { t: 'desync', f });
        }
        for (const k of [...room.hashes.keys()]) if (k <= f) room.hashes.delete(k);
      }
      return;
    }
    case 'end': {
      const room = c.room;
      if (!room || host(room) !== c) return;
      room.inGame = false;
      room.reserved.clear();
      room.start = null;
      room.log = new Map();
      room.events = [];
      for (const cl of room.clients) cl.ready = false;
      broadcast(room, { t: 'end' });
      broadcast(room, { t: 'lobby', state: lobbyState(room) });
      return;
    }
    case 'chat': {
      const room = c.room;
      if (!room) return;
      broadcast(room, { t: 'chat', slot: c.slot, text: isProfane(String(msg.text ?? '')) ? '***' : String(msg.text ?? '').slice(0, 120) });
      return;
    }
    default:
      return;
  }
}

// ---- HTTP (fichiers statiques du build) ----
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json',
};

// ---- Idées / suggestions des joueurs ----
// POST /api/ideas {text, category, ctx} : enregistré dans IDEAS_FILE (JSONL), transmis à IDEAS_WEBHOOK (Discord, Slack, n8n, Make…)
// et/ou créé comme ticket GitHub (GITHUB_TOKEN + GITHUB_REPO). GET /ideas?key=IDEAS_KEY : liste lisible ; /api/ideas?key=… : JSON.
const IDEAS_FILE = process.env.IDEAS_FILE ?? join(resolve(__dirname, '..'), 'data', 'ideas.jsonl');
interface Idea { id: string; ts: number; text: string; category: string; name: string; ctx: Record<string, unknown> }
const ideasMem: Idea[] = [];
const ideaRate = new Map<string, number[]>();

async function loadIdeas(): Promise<void> {
  try {
    const raw = await readFile(IDEAS_FILE, 'utf8');
    for (const line of raw.split('\n')) if (line.trim()) { try { ideasMem.push(JSON.parse(line) as Idea); } catch { /* ligne abîmée */ } }
  } catch { /* pas encore de fichier */ }
}
void loadIdeas();

function readBody(req: import('node:http').IncomingMessage, max = 8192): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) { reject(new Error('trop gros')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function esc(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string); }

async function forwardIdea(idea: Idea): Promise<void> {
  const hook = process.env.IDEAS_WEBHOOK;
  if (hook) {
    try {
      await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content: `💡 **${idea.category}** — ${idea.name || 'anonyme'}\n${idea.text}`.slice(0, 1900), text: idea.text, ...idea }) });
    } catch (e) { console.warn('webhook idées : échec', (e as Error).message); }
  }
  const tok = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPO;
  if (tok && repo) {
    try {
      await fetch(`https://api.github.com/repos/${repo}/issues`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, accept: 'application/vnd.github+json', 'content-type': 'application/json', 'user-agent': 'ai-fighter-2' }, body: JSON.stringify({ title: `💡 [${idea.category}] ${idea.text.slice(0, 70)}`, body: `${idea.text}\n\n---\nDe : ${idea.name || 'anonyme'}\nContexte : \`${JSON.stringify(idea.ctx)}\``, labels: ['idée'] }) });
    } catch (e) { console.warn('ticket GitHub : échec', (e as Error).message); }
  }
}

async function handleIdeas(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean> {
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' };
  if (url.pathname === '/api/ideas' && req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
  if (url.pathname === '/api/ideas' && req.method === 'POST') {
    const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const now = Date.now();
    const recent = (ideaRate.get(fwd) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 6) { res.writeHead(429, cors); res.end(JSON.stringify({ ok: false, error: 'trop de suggestions, réessaie plus tard' })); return true; }
    try {
      const body = JSON.parse(await readBody(req)) as Partial<Idea> & { ctx?: Record<string, unknown> };
      const text = String(body.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 1200);
      if (text.length < 5) { res.writeHead(400, cors); res.end(JSON.stringify({ ok: false, error: 'idée trop courte' })); return true; }
      const idea: Idea = { id: randomUUID().slice(0, 8), ts: now, text, category: String(body.category ?? 'Autre').slice(0, 24), name: cleanName(body.name, ''), ctx: (body.ctx && typeof body.ctx === 'object' ? body.ctx : {}) as Record<string, unknown> };
      recent.push(now); ideaRate.set(fwd, recent);
      ideasMem.push(idea);
      try { await mkdir(dirname(IDEAS_FILE), { recursive: true }); await appendFile(IDEAS_FILE, JSON.stringify(idea) + '\n'); } catch (e) { console.warn('écriture idées impossible', (e as Error).message); }
      void forwardIdea(idea);
      console.log(`[idée] ${idea.category} · ${idea.name || 'anonyme'} : ${idea.text.slice(0, 80)}`);
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: idea.id }));
    } catch {
      res.writeHead(400, cors); res.end(JSON.stringify({ ok: false, error: 'requête invalide' }));
    }
    return true;
  }
  if ((url.pathname === '/ideas' || (url.pathname === '/api/ideas' && req.method === 'GET'))) {
    const key = process.env.IDEAS_KEY;
    if (!key) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Définis la variable IDEAS_KEY sur le serveur pour consulter les idées (puis /ideas?key=TA_CLE).'); return true; }
    if (url.searchParams.get('key') !== key) { res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Clé invalide.'); return true; }
    const list = ideasMem.slice().reverse();
    if (url.pathname === '/api/ideas') { res.writeHead(200, { ...cors, 'content-type': 'application/json' }); res.end(JSON.stringify(list)); return true; }
    const rows = list.map((i) => `<tr><td>${new Date(i.ts).toLocaleString('fr-FR')}</td><td>${esc(i.category)}</td><td>${esc(i.name)}</td><td>${esc(i.text)}</td><td><small>${esc(JSON.stringify(i.ctx))}</small></td></tr>`).join('');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Idées AI Fighter 2</title><style>body{font:14px system-ui;margin:16px;background:#0b1424;color:#eaf6ff}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #26405e;padding:6px 8px;text-align:left;vertical-align:top}small{color:#86a6c4}a{color:#7be4ff}</style><h1>💡 ${list.length} idée${list.length > 1 ? 's' : ''}</h1><p><a href="/api/ideas?key=${encodeURIComponent(key)}">Télécharger en JSON</a></p><table><tr><th>Date</th><th>Type</th><th>Joueur</th><th>Idée</th><th>Contexte</th></tr>${rows}</table>`);
    return true;
  }
  return false;
}

// ---- Défi du jour : classement par date (UTC) ----
// POST /api/daily {date, name, score, wave, charId} · GET /api/daily?date=YYYY-MM-DD → top 20. Persisté dans DAILY_FILE (JSONL).
const DAILY_FILE = process.env.DAILY_FILE ?? join(resolve(__dirname, '..'), 'data', 'daily.jsonl');
const dailyMem = new Map<string, Map<string, DailyEntry>>();
const dailyRate = new Map<string, number[]>();

function dailyPut(date: string, e: DailyEntry): boolean {
  let day = dailyMem.get(date);
  if (!day) { day = new Map(); dailyMem.set(date, day); }
  const old = day.get(e.name);
  if (old && old.score >= e.score) return false;
  day.set(e.name, e);
  return true;
}
function dailyTop(date: string): DailyEntry[] {
  return [...(dailyMem.get(date)?.values() ?? [])].sort((a, b) => b.score - a.score).slice(0, 20);
}
void (async () => {
  try {
    const raw = await readFile(DAILY_FILE, 'utf8');
    for (const line of raw.split('\n')) if (line.trim()) { try { const r = JSON.parse(line) as DailyEntry & { date: string }; dailyPut(r.date, r); } catch { /* ligne abîmée */ } }
  } catch { /* pas encore de fichier */ }
})();

async function handleDaily(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/daily') return false;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
  if (req.method === 'GET') {
    const date = url.searchParams.get('date') ?? todayUtc();
    if (!isDateString(date)) { res.writeHead(400, cors); res.end('{"ok":false}'); return true; }
    res.writeHead(200, cors); res.end(JSON.stringify({ ok: true, date, top: dailyTop(date) }));
    return true;
  }
  if (req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const now = Date.now();
    const recent = (dailyRate.get(ip) ?? []).filter((t) => now - t < 60_000);
    if (recent.length >= 8) { res.writeHead(429, cors); res.end('{"ok":false,"error":"trop de requêtes"}'); return true; }
    try {
      const b = JSON.parse(await readBody(req)) as Record<string, unknown>;
      const today = todayUtc(), yesterday = todayUtc(new Date(now - 86_400_000));
      const date = String(b.date ?? '');
      const score = Math.floor(Number(b.score));
      if (!isDateString(date) || (date !== today && date !== yesterday) || !Number.isFinite(score) || score < 0 || score > 5_000_000) { res.writeHead(400, cors); res.end('{"ok":false,"error":"score invalide"}'); return true; }
      recent.push(now); dailyRate.set(ip, recent);
      const e: DailyEntry = { name: cleanName(b.name, 'Anonyme'), score, wave: Math.max(0, Math.min(999, Math.floor(Number(b.wave)) || 0)), charId: String(b.charId ?? '').slice(0, 16), ts: now };
      if (dailyPut(date, e)) {
        try { await mkdir(dirname(DAILY_FILE), { recursive: true }); await appendFile(DAILY_FILE, JSON.stringify({ ...e, date }) + '\n'); } catch (err) { console.warn('écriture défi impossible', (err as Error).message); }
      }
      const top = dailyTop(date);
      res.writeHead(200, cors); res.end(JSON.stringify({ ok: true, rank: top.findIndex((x) => x.name === e.name) + 1, top }));
    } catch { res.writeHead(400, cors); res.end('{"ok":false,"error":"requête invalide"}'); }
    return true;
  }
  return false;
}

// ---- Rediffusions partageables ----
// POST /api/replay {…ReplayFile} → {id} · GET /api/replay?id=XXXXXX → le fichier. Gardées en mémoire (300 dernières) et dans REPLAYS_FILE (JSONL).
const REPLAYS_FILE = process.env.REPLAYS_FILE ?? join(resolve(__dirname, '..'), 'data', 'replays.jsonl');
const replayMem = new Map<string, ReplayFile>();
const replayRate = new Map<string, number[]>();
function replayPut(id: string, r: ReplayFile): void {
  replayMem.set(id, r);
  if (replayMem.size > 300) replayMem.delete(replayMem.keys().next().value as string);
}
void (async () => {
  try {
    const raw = await readFile(REPLAYS_FILE, 'utf8');
    for (const line of raw.split('\n')) if (line.trim()) { try { const r = JSON.parse(line) as { id: string; r: ReplayFile }; if (validReplay(r.r)) replayPut(r.id, r.r); } catch { /* ligne abîmée */ } }
  } catch { /* pas encore de fichier */ }
})();

async function handleReplay(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/replay') return false;
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS', 'content-type': 'application/json' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return true; }
  if (req.method === 'GET') {
    const r = replayMem.get(String(url.searchParams.get('id') ?? '').toUpperCase());
    if (!r) { res.writeHead(404, cors); res.end('{"ok":false,"error":"rediffusion introuvable"}'); return true; }
    res.writeHead(200, cors); res.end(JSON.stringify(r));
    return true;
  }
  if (req.method === 'POST') {
    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
    const now = Date.now();
    const recent = (replayRate.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 10) { res.writeHead(429, cors); res.end('{"ok":false,"error":"trop de partages"}'); return true; }
    try {
      const r = JSON.parse(await readBody(req, 400_000)) as ReplayFile;
      if (!validReplay(r)) { res.writeHead(400, cors); res.end('{"ok":false,"error":"rediffusion invalide"}'); return true; }
      const clean: ReplayFile = { v: 1, title: String(r.title ?? '').slice(0, 60), ts: now, config: r.config, seed: r.seed >>> 0, slots: r.slots, events: r.events, frames: r.frames, hl: r.hl.slice(0, 60).map((h) => ({ f: Number(h.f) | 0, label: String(h.label).slice(0, 40) })) };
      const id = makeRoomCode(Math.random) + makeRoomCode(Math.random).slice(0, 1);
      recent.push(now); replayRate.set(ip, recent);
      replayPut(id, clean);
      try { await mkdir(dirname(REPLAYS_FILE), { recursive: true }); await appendFile(REPLAYS_FILE, JSON.stringify({ id, r: clean }) + '\n'); } catch (err) { console.warn('écriture rediffusion impossible', (err as Error).message); }
      res.writeHead(200, cors); res.end(JSON.stringify({ ok: true, id }));
    } catch { res.writeHead(400, cors); res.end('{"ok":false,"error":"requête invalide"}'); }
    return true;
  }
  return false;
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (await handleIdeas(req, res, url)) return;
  if (await handleDaily(req, res, url)) return;
  if (await handleReplay(req, res, url)) return;
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, clients: clients.size }));
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Serveur AI Fighter 2 actif (WebSocket sur /ws). Lance `npm run build` pour servir le jeu ici, ou `npm run dev` pour le mode développement.');
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.includes('..')) { res.writeHead(400); res.end(); return; }
  let file = join(DIST, p);
  try {
    const st = await stat(file);
    if (st.isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(file);
    const ext = extname(file);
    res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream', 'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('404');
  }
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 8 * 1024 });
wss.on('connection', (ws, req) => {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const c: Client = { ip: fwd || req.socket.remoteAddress || '', lastActive: Date.now(), afk: false, ws, room: null, slot: -1, name: '', charId: 'kai', color: 0, team: -1, hat: '', aura: '', ready: false, rtt: 0, lastFrame: -1, alive: true, token: randomUUID() };
  clients.add(c);
  ws.on('message', (data) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    try {
      handle(c, msg);
    } catch (e) {
      console.error('erreur message', e);
    }
  });
  ws.on('pong', () => { c.alive = true; });
  ws.on('close', () => {
    leaveRoom(c, false); // coupure : si une partie est en cours, la place est gardée
    clients.delete(c);
  });
});

// ping applicatif (latence) + détection de connexions mortes
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.ws.terminate(); continue; }
    c.alive = false;
    c.ws.ping();
    send(c, { t: 'ping', ts: Date.now() });
  }
  const now = Date.now();
  for (const room of rooms.values()) {
    if (!room.inGame || room.clients.length < 2) continue;
    for (const c of room.clients) {
      if (c.afk || c.lastFrame < 0 || now - c.lastActive < AFK_MS) continue;
      c.afk = true;
      const ev: CtlEvent = { slot: c.slot, from: c.lastFrame + 1, ai: true };
      room.events.push(ev);
      broadcast(room, { t: 'drop', slot: c.slot, from: ev.from, afk: true });
      console.log(`[${room.code}] ${c.name} inactif depuis ${Math.round((now - c.lastActive) / 1000)} s : une IA joue à sa place`);
    }
  }
  for (const [code, room] of rooms) {
    const keep = room.inGame && room.reserved.size > 0 ? RESERVE_MS : 60_000;
    if (room.clients.length === 0 && room.emptySince && now - room.emptySince > keep) rooms.delete(code);
  }
}, 2000);

http.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Fighter 2 — serveur prêt sur le port ${PORT}`);
  const nets = networkInterfaces();
  const lan: string[] = [];
  for (const list of Object.values(nets)) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
  console.log(`  local  : http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  réseau : http://${ip}:${PORT}   (pour les téléphones sur le même Wi-Fi)`);
});
