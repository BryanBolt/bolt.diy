// Serveur AI Fighter 2 : salons + relais d'entrées (lockstep) + fichiers statiques.
// Lancement : npm start   (PORT=8787 par défaut)

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientMsg, ServerMsg, LobbyPlayer, LobbyOptions, LobbyState } from '../shared/protocol';
import type { CtlEvent, PublicRoom } from '../shared/protocol';
import { PROTOCOL_VERSION, MAX_PLAYERS, REJOIN_MARGIN, makeRoomCode, normalizeRoomCode, DEFAULT_OPTIONS, encodeRle } from '../shared/protocol';
import { randomUUID } from 'node:crypto';

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
  ready: boolean;
  rtt: number;
  lastFrame: number;
  alive: boolean;
  token: string;
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
}

const RESERVE_MS = 20 * 60_000;

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
    .map((c, i) => ({ slot: c.slot, name: c.name, charId: c.charId, color: c.color, ready: c.ready, isHost: i === 0, connected: true }));
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
  const room: Room = { code, clients: [], options: { ...DEFAULT_OPTIONS, isPublic }, inGame: false, hashes: new Map(), emptySince: 0, start: null, log: new Map(), events: [], reserved: new Map(), maxFrame: 0 };
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

function seat(c: Client, room: Room, slot: number, name: unknown, charId: unknown, color: unknown, created: boolean): void {
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
function joinRunning(c: Client, room: Room, slot: number, name: unknown, charId: unknown, color: unknown): void {
  if (!room.start) return;
  c.name = cleanName(name, `Joueur ${slot + 1}`);
  c.charId = String(charId ?? 'kai').slice(0, 16);
  c.color = freeColor(room, Number(color) | 0);
  c.ready = false;
  c.slot = slot;
  const lastEvt = room.events.reduce((m, e) => Math.max(m, e.from), 0);
  const from = Math.max(room.maxFrame + REJOIN_MARGIN, lastEvt + 1);
  c.lastFrame = from - 1;
  const ev: CtlEvent = { slot, from, ai: false, join: { name: c.name, charId: c.charId, color: c.color } };
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
  return v || fallback;
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
      else send(c, { t: 'welcome', v: PROTOCOL_VERSION });
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
      seat(c, room, 0, msg.name, msg.charId, msg.color, true);
      return;
    }
    case 'list':
      send(c, { t: 'rooms', rooms: publicList() });
      return;
    case 'quick': {
      // partie rapide : le salon public le plus rempli, sinon on en ouvre un
      leaveRoom(c);
      const open = openPublicRooms().filter((r) => freeSlot(r) >= 0).sort((a, b) => b.clients.length - a.clients.length)[0];
      if (open) {
        if (open.inGame && open.start) joinRunning(c, open, freeSlot(open), msg.name, msg.charId, msg.color);
        else seat(c, open, freeSlot(open), msg.name, msg.charId, msg.color, false);
        return;
      }
      const room = newRoom(true);
      seat(c, room, 0, msg.name, msg.charId, msg.color, true);
      return;
    }
    case 'join': {
      const code = normalizeRoomCode(String(msg.code ?? ''));
      const room = rooms.get(code);
      if (!room) { send(c, { t: 'error', code: 'noroom', message: `Salon ${code || '?'} introuvable.` }); return; }
      const slot = freeSlot(room);
      if (slot < 0) { send(c, { t: 'error', code: 'full', message: 'Salon complet (4 joueurs).' }); return; }
      leaveRoom(c);
      if (room.inGame && room.start) joinRunning(c, room, slot, msg.name, msg.charId, msg.color);
      else seat(c, room, slot, msg.name, msg.charId, msg.color, false);
      return;
    }
    case 'leave':
      leaveRoom(c, true);
      return;
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
      c.name = r.name; c.charId = r.charId; c.color = r.color; c.token = token; c.slot = slot; c.ready = false;
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
      for (const cl of room.clients) { cl.lastFrame = -1; cl.ready = false; }
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
      broadcast(room, { t: 'chat', slot: c.slot, text: String(msg.text ?? '').slice(0, 120) });
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

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
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
wss.on('connection', (ws) => {
  const c: Client = { ws, room: null, slot: -1, name: '', charId: 'kai', color: 0, ready: false, rtt: 0, lastFrame: -1, alive: true, token: randomUUID() };
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
