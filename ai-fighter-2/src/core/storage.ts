import type { KeyMap, PadMap } from '../input/devices';

export interface Settings {
  lang: 'fr' | 'en';
  volume: number; // 0..1
  music: number;
  shake: boolean;
  touchSize: number; // 0.8..1.4
  touchOpacity: number;
  showHitboxes: boolean;
  name: string;
  keymap1?: KeyMap;
  keymap2?: KeyMap;
  padmap?: PadMap;
  reduceFx: boolean;
  serverUrl: string;
  lastChar: string;
  lastColor: number;
}

export interface Profile {
  stageReached: number; // 0..6 : stages terminés en campagne
  campaignWins: number;
  duelWins: number;
  bestSurvival: number;
  bestScore: number;
  totalKo: number;
  coins: number;
  unlockedChars: string[];
  playTimeFrames: number;
}

const SETTINGS_KEY = 'aif2.settings.v1';
const PROFILE_KEY = 'aif2.profile.v1';

const DEFAULT_SETTINGS: Settings = {
  lang: 'fr',
  volume: 0.8,
  music: 0.5,
  shake: true,
  touchSize: 1,
  touchOpacity: 0.55,
  showHitboxes: false,
  name: '',
  reduceFx: false,
  serverUrl: '',
  lastChar: 'kai',
  lastColor: 0,
};

const DEFAULT_PROFILE: Profile = {
  stageReached: 0,
  campaignWins: 0,
  duelWins: 0,
  bestSurvival: 0,
  bestScore: 0,
  totalKo: 0,
  coins: 0,
  unlockedChars: [],
  playTimeFrames: 0,
};

function read<T>(key: string, def: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...def };
    const parsed = JSON.parse(raw);
    return { ...def, ...parsed };
  } catch {
    return { ...def };
  }
}
function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage indisponible (navigation privée) : on continue sans sauvegarde */
  }
}

let settingsCache: Settings | null = null;
let profileCache: Profile | null = null;

export function loadSettings(): Settings {
  if (!settingsCache) settingsCache = read(SETTINGS_KEY, DEFAULT_SETTINGS);
  return settingsCache;
}
export function saveSettings(patch: Partial<Settings>): Settings {
  settingsCache = { ...loadSettings(), ...patch };
  write(SETTINGS_KEY, settingsCache);
  return settingsCache;
}
export function loadProfile(): Profile {
  if (!profileCache) profileCache = read(PROFILE_KEY, DEFAULT_PROFILE);
  return profileCache;
}
export function saveProfile(patch: Partial<Profile>): Profile {
  profileCache = { ...loadProfile(), ...patch };
  write(PROFILE_KEY, profileCache);
  return profileCache;
}
export function resetAll(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* ignore */
  }
  settingsCache = null;
  profileCache = null;
}
