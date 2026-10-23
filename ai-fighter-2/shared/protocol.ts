// Protocole partagé client <-> serveur (WebSocket, JSON).
// Le serveur est un simple relais : il gère les salons et retransmet les
// entrées de chaque joueur. Toute la simulation tourne côté client en
// lockstep déterministe.

export const PROTOCOL_VERSION = 2;
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
  | { t: 'leave' }
  | { t: 'lobby'; charId?: string; color?: number; ready?: boolean; name?: string }
  | { t: 'options'; options: Partial<LobbyOptions> }
  | { t: 'start'; seed: number }
  | { t: 'input'; f: number; bits: number[] } // bits[i] = entrée de la frame f+i (redondance anti-perte)
  | { t: 'hash'; f: number; h: number }
  | { t: 'end' } // retour au salon (hôte)
  | { t: 'chat'; text: string }
  | { t: 'ping'; ts: number }
  | { t: 'pong'; ts: number }
  | { t: 'ping'; ts: number }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'wait'; slot: number }; // le serveur signale un joueur en retard // réponse au ping du serveur (mesure de latence)

// --- Serveur -> client ---
export type ServerMsg =
  | { t: 'welcome'; v: number }
  | { t: 'error'; code: string; message: string }
  | { t: 'joined'; slot: number; code: string }
  | { t: 'lobby'; state: LobbyState }
  | { t: 'start'; seed: number; options: LobbyOptions; players: LobbyPlayer[]; delay: number }
  | { t: 'input'; slot: number; f: number; bits: number[] }
  | { t: 'drop'; slot: number; from: number } // le joueur a quitté : ses entrées sont neutres à partir de la frame `from`
  | { t: 'desync'; f: number }
  | { t: 'end' }
  | { t: 'pong'; ts: number }
  | { t: 'ping'; ts: number }
  | { t: 'chat'; slot: number; text: string }
  | { t: 'wait'; slot: number }; // le serveur signale un joueur en retard

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
