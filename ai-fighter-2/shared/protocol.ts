// Protocole partagé client <-> serveur (WebSocket, JSON).
// Le serveur est un simple relais : il gère les salons et retransmet les
// entrées de chaque joueur. Toute la simulation tourne côté client en
// lockstep déterministe.

export const PROTOCOL_VERSION = 3;
/** Délai (en frames) entre le retour d'un joueur et sa reprise des commandes : laisse le temps à tous les clients de l'apprendre. */
export const REJOIN_MARGIN = 120;
export const MAX_PLAYERS = 4;

export type GameMode = 'campaign' | 'duel' | 'survival' | 'training';

export interface LobbyPlayer {
  slot: number; // 0..3
  name: string;
  charId: string;
  color: number; // index palette
  ready: boolean;
  isHost: boolean;
  connected: boolean;
}

export interface LobbyOptions {
  mode: GameMode;
  difficulty: 0 | 1 | 2 | 3; // facile, normal, difficile, cauchemar
  rounds: 1 | 3 | 5; // duel
  bots: number; // duel : nombre de bots ajoutés
  stage: number; // index de stage de départ
  teams: boolean; // duel par équipes
}

export interface LobbyState {
  code: string;
  players: LobbyPlayer[];
  options: LobbyOptions;
  inGame: boolean;
}

// --- Client -> serveur ---
export type ClientMsg =
  | { t: 'hello'; v: number }
  | { t: 'create'; name: string; charId: string; color: number }
  | { t: 'join'; code: string; name: string; charId: string; color: number }
  | { t: 'rejoin'; code: string; token: string } // retour dans une partie en cours après une coupure
  | { t: 'leave' }
  | { t: 'resync' } // demande à reconstruire la partie depuis le journal du serveur (après une désynchronisation)
  | { t: 'lobby'; charId?: string; color?: number; ready?: boolean; name?: string }
  | { t: 'options'; options: Partial<LobbyOptions> }
  | { t: 'start'; seed: number }
  | { t: 'input'; f: number; bits: number[] } // bits[i] = entrée de la frame f+i (redondance anti-perte)
  | { t: 'hash'; f: number; h: number }
  | { t: 'end' } // retour au salon (hôte)
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }; // réponse au ping du serveur (mesure de latence)

/** Changement de contrôle d'un slot : ai = true → une IA joue à sa place à partir de `from`. */
export interface CtlEvent {
  slot: number;
  from: number;
  ai: boolean;
}

// --- Serveur -> client ---
export type ServerMsg =
  | { t: 'welcome'; v: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'joined'; slot: number; code: string; token: string }
  | { t: 'lobby'; state: LobbyState }
  | { t: 'start'; seed: number; options: LobbyOptions; players: LobbyPlayer[]; delay: number }
  | { t: 'input'; slot: number; f: number; bits: number[] }
  | { t: 'drop'; slot: number; from: number } // le joueur a quitté : une IA le remplace à partir de la frame `from`
  | { t: 'rejoin'; slot: number; from: number } // le joueur est revenu : il reprend la main à la frame `from`
  | { t: 'resume'; seed: number; options: LobbyOptions; players: LobbyPlayer[]; delay: number; slot: number; from: number; log: { slot: number; rle: number[] }[]; events: CtlEvent[] }
  | { t: 'desync'; f: number }
  | { t: 'end' }
  | { t: 'pong'; ts: number }
  | { t: 'ping'; ts: number }
  | { t: 'chat'; slot: number; text: string };

/** Compression par plages [valeur, nombre, valeur, nombre…] des journaux d'entrées. */
export function encodeRle(arr: ArrayLike<number | undefined>, length = arr.length): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < length) {
    const v = arr[i] ?? 0;
    let n = 1;
    while (i + n < length && (arr[i + n] ?? 0) === v) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function decodeRle(rle: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < rle.length; i += 2) for (let k = 0; k < rle[i + 1]; k++) out.push(rle[i]);
  return out;
}

export function makeRoomCode(rand: () => number): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += alphabet[Math.floor(rand() * alphabet.length)];
  return s;
}

export function normalizeRoomCode(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 5);
}

export const DEFAULT_OPTIONS: LobbyOptions = {
  mode: 'campaign',
  difficulty: 1,
  rounds: 3,
  bots: 1,
  stage: 0,
  teams: false,
};
