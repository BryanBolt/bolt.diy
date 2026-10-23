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
import { PROTOCOL_VERSION, MAX_PLAYERS, makeRoomCode, normalizeRoomCode, DEFAULT_OPTIONS } from '../shared/protocol';

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
}

interface Room {
  code: string;
  clients: Client[];
  options: LobbyOptions;
  inGame: boolean;
  hashes: Map<number, Map<number, number>>;
  emptySince: number;
}

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
  for (let s = 0; s < MAX_PLAYERS; s++) if (!room.clients.some((c) => c.slot === s)) return s;
  return -1;
}
function freeColor(room: Room, wanted: number): number {
  for (let i = 0; i < 12; i++) {
    const c = (wanted + i) % 12;
    if (!room.clients.some((x) => x.color === c)) return c;
  }
  return wanted % 12;
}
function cleanName(s: unknown, fallback: string): string {
  const v = String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 14);
  return v || fallback;
}
function leaveRoom(c: Client): void {
  const room = c.room;
  if (!room) return;
  room.clients = room.clients.filter((x) => x !== c);
  c.room = null;
  if (room.inGame) broadcast(room, { t: 'drop', slot: c.slot, from: c.lastFrame + 1 });
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
      let code = makeRoomCode(Math.random);
      while (rooms.has(code)) code = makeRoomCode(Math.random);
      const room: Room = { code, clients: [], options: { ...DEFAULT_OPTIONS }, inGame: false, hashes: new Map(), emptySince: 0 };
      rooms.set(code, room);
      c.name = cleanName(msg.name, 'Hôte');
      c.charId = String(msg.charId ?? 'kai');
      c.color = Number(msg.color) | 0;
      c.ready = false;
      c.slot = 0;
      c.room = room;
      room.clients.push(c);
      send(c, { t: 'joined', slot: 0, code });
      send(c, { t: 'lobby', state: lobbyState(room) });
      return;
    }
    case 'join': {
      const code = normalizeRoomCode(String(msg.code ?? ''));
      const room = rooms.get(code);
      if (!room) { send(c, { t: 'error', code: 'noroom', message: `Salon ${code || '?'} introuvable.` }); return; }
      if (room.inGame) { send(c, { t: 'error', code: 'ingame', message: 'La partie a déjà commencé dans ce salon.' }); return; }
      const slot = freeSlot(room);
      if (slot < 0) { send(c, { t: 'error', code: 'full', message: 'Salon complet (4 joueurs).' }); return; }
      leaveRoom(c);
      c.name = cleanName(msg.name, `Joueur ${slot + 1}`);
      c.charId = String(msg.charId ?? 'kai');
      c.color = freeColor(room, Number(msg.color) | 0);
      c.ready = false;
      c.slot = slot;
      c.room = room;
      room.clients.push(c);
      room.emptySince = 0;
      send(c, { t: 'joined', slot, code });
      broadcast(room, { t: 'lobby', state: lobbyState(room) });
      return;
    }
    case 'leave':
      leaveRoom(c);
      return;
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
      for (const cl of room.clients) { cl.lastFrame = -1; cl.ready = false; }
      const maxRtt = Math.max(0, ...room.clients.map((x) => x.rtt));
      const delay = Math.min(8, Math.max(2, Math.ceil(maxRtt / 2 / 16.67) + 2));
      const state = lobbyState(room);
      broadcast(room, { t: 'start', seed: (Number(msg.seed) >>> 0) || 1, options: room.options, players: state.players, delay });
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
          console.warn(`[${room.code}] désynchronisation à la frame ${f}`);
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
  const c: Client = { ws, room: null, slot: -1, name: '', charId: 'kai', color: 0, ready: false, rtt: 0, lastFrame: -1, alive: true };
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
    leaveRoom(c);
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
  for (const [code, room] of rooms) if (room.clients.length === 0 && room.emptySince && now - room.emptySince > 60_000) rooms.delete(code);
}, 2000);

http.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Fighter 2 — serveur prêt sur le port ${PORT}`);
  const nets = networkInterfaces();
  const lan: string[] = [];
  for (const list of Object.values(nets)) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) lan.push(n.address);
  console.log(`  local  : http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  réseau : http://${ip}:${PORT}   (pour les téléphones sur le même Wi-Fi)`);
});
