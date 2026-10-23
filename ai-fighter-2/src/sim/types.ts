import type { GameMode } from '../../shared/protocol';

// ---- Entrées (bitmask par joueur et par frame) ----
export const IN = {
  LEFT: 1,
  RIGHT: 2,
  UP: 4,
  DOWN: 8,
  LIGHT: 16,
  HEAVY: 32,
  JUMP: 64,
  GUARD: 128,
  SPECIAL: 256,
  SUPER: 512,
  DASH: 1024,
  PAUSE: 2048,
  CONFIRM: 4096,
} as const;

export type FState =
  | 'idle'
  | 'walk'
  | 'run'
  | 'jump'
  | 'attack'
  | 'hit'
  | 'launch'
  | 'down'
  | 'getup'
  | 'guard'
  | 'block'
  | 'dodge'
  | 'parry'
  | 'stagger'
  | 'ko'
  | 'frozen'
  | 'revive'
  | 'win';

export type MoveKind =
  | 'light'
  | 'heavy'
  | 'launcher'
  | 'low'
  | 'run'
  | 'air'
  | 'airHeavy'
  | 'special'
  | 'special2'
  | 'super'
  | 'finisher';

export type ProjectileKind = 'ki' | 'fire' | 'ice' | 'shuriken' | 'bullet' | 'orb' | 'shock' | 'bottle';

export interface ProjectileDef {
  kind: ProjectileKind;
  speed: number;
  life: number;
  damage: number;
  radius: number;
  y: number; // hauteur de tir
  pierce?: boolean;
  count?: number; // tirs en éventail
  gravity?: number;
  homing?: number;
}

export interface MoveDef {
  id: string;
  name: string;
  kind: MoveKind;
  startup: number;
  active: number;
  recovery: number;
  /** boîte de coup : décalage avant, largeur, hauteur min/max, tolérance de profondeur */
  hit: { x: number; w: number; y0: number; y1: number; z: number };
  damage: number;
  hitstun: number;
  blockstun: number;
  kbx: number;
  kby: number;
  hitstop: number;
  lunge?: number; // impulsion avant au départ
  lungeAir?: number; // impulsion verticale
  launch?: boolean;
  knockdown?: boolean;
  low?: boolean;
  overhead?: boolean;
  unblockable?: boolean;
  armor?: boolean; // super-armure pendant startup+active
  guardBreak?: boolean; // casse la garde (grosse perte de jauge)
  cancelFrom?: number; // frame absolue à partir de laquelle on peut enchaîner
  next?: string[]; // coups autorisés en enchaînement
  kiCost?: number;
  superCost?: number;
  projectile?: ProjectileDef;
  multi?: { hits: number; every: number }; // coups multiples
  teleport?: number; // se téléporte derrière la cible (distance)
  invuln?: boolean; // invincible pendant startup
  freezeTarget?: number; // gèle la cible N frames
  burnTarget?: number;
  heal?: number; // soin au lanceur
  selfKnock?: boolean; // dash en avant pendant les frames actives
  sfx?: string;
  anim: string; // clé de pose pour le rendu
}

export interface CharStats {
  speed: number; // multiplicateur
  power: number;
  defense: number;
  hpMax: number;
  jump: number;
  reach: number; // bonus d'allonge en px
}

export interface CharDef {
  id: string;
  name: string;
  title: string;
  desc: string;
  color: number; // couleur de base (index palette)
  stats: CharStats;
  moves: Record<string, MoveDef>;
  /** mapping des commandes vers les ids de coups */
  lightChain: string[]; // enchaînement de coups légers
  heavy: string;
  launcher: string; // avant + lourd
  low: string; // arrière + lourd
  run: string; // course + léger
  air: string;
  airHeavy: string;
  special: string; // bouton spécial
  special2: string; // bas + spécial
  superMove: string;
  unlock?: { kind: 'stage' | 'wins' | 'start'; value: number };
  playable: boolean;
  skeleton?: Partial<SkeletonStyle>;
}

export interface SkeletonStyle {
  scale: number;
  thickness: number;
  headR: number;
  accessory: string; // 'headband' | 'scarf' | 'horns' | 'hood' | 'none' ...
}

export type EnemyKind = 'thug' | 'brute' | 'ninja' | 'gunner' | 'boss';

export type BonusId =
  | 'power'
  | 'speed'
  | 'vitality'
  | 'lifesteal'
  | 'kiflow'
  | 'burn'
  | 'thorns'
  | 'crit'
  | 'guard'
  | 'doublejump'
  | 'shockwave'
  | 'explode'
  | 'midas'
  | 'armor'
  | 'superflow'
  | 'frost'
  | 'berserk'
  | 'phoenix';

export interface StatusEffects {
  burn: number; // frames restantes
  burnDps: number;
  frozen: number;
  poison: number;
}

export interface AiState {
  kind: EnemyKind | 'bot';
  timer: number;
  intent: 'approach' | 'attack' | 'retreat' | 'wait' | 'flank' | 'guard';
  target: number; // id du combattant visé
  aggro: number; // 0..1 agressivité
  level: number;
}

export interface Fighter {
  id: number;
  charId: string;
  name: string;
  team: number;
  slot: number; // slot joueur (-1 si contrôlé par l'IA pure)
  controller: 'player' | 'ai';
  ai: AiState | null;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  hp: number;
  hpMax: number;
  ki: number;
  superMeter: number;
  guardMeter: number;
  state: FState;
  stateFrame: number;
  moveId: string | null;
  moveHits: number[]; // ids déjà touchés par le coup courant
  multiLeft: number;
  chainIndex: number; // position dans l'enchaînement léger
  freeze: number; // hit-stop
  invuln: number;
  armor: boolean;
  comboHits: number;
  comboTimer: number;
  comboDamage: number;
  guardFrames: number; // frames depuis l'appui garde (fenêtre de parade)
  lowGuard: boolean;
  prevInput: number;
  bufferedInput: number;
  bufferTimer: number;
  tapTimer: number; // double appui avant = course
  tapDir: number;
  runFrames: number;
  airJumps: number;
  heavyCharge: number;
  chargeBonus: number;
  hitFrames: number; // durée du hitstun/blockstun courant
  lastHitBy: number;
  koTimer: number;
  revive: number; // progression de réanimation (coop)
  lives: number;
  stats: CharStats;
  bonuses: BonusId[];
  status: StatusEffects;
  color: number;
  level: number;
  kills: number;
  phoenixUsed: boolean;
  nextMoveFrame: number; // frame simulée à partir de laquelle on peut ré-attaquer (anti-mash)
  wantsLeave: boolean;
}

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  owner: number;
  team: number;
  damage: number;
  life: number;
  radius: number;
  pierce: boolean;
  hits: number[];
  gravity: number;
  homing: number;
  bonus?: BonusId[];
}

export interface Item {
  id: number;
  kind: 'heal' | 'ki' | 'coin' | 'crate';
  x: number;
  y: number;
  z: number;
  vy: number;
  life: number;
  hp?: number;
}

export type SimEvent =
  | { t: 'hit'; x: number; y: number; z: number; power: number; blocked: boolean; crit: boolean; dir: number; attacker: number; target: number }
  | { t: 'parry'; x: number; y: number; z: number }
  | { t: 'ko'; x: number; y: number; z: number; id: number }
  | { t: 'sound'; id: string; x?: number }
  | { t: 'text'; x: number; y: number; z: number; text: string; color?: string }
  | { t: 'shake'; power: number }
  | { t: 'spawn'; id: number }
  | { t: 'phase'; phase: Phase }
  | { t: 'pickup'; kind: Item['kind']; x: number; y: number; z: number }
  | { t: 'special'; id: number; x: number; y: number; z: number; kind: string }
  | { t: 'bonus'; slot: number; bonus: BonusId };

export type Phase =
  | 'intro'
  | 'fight'
  | 'waveClear'
  | 'bonus'
  | 'stageClear'
  | 'roundEnd'
  | 'matchEnd'
  | 'gameOver';

export interface WaveSpec {
  enemies: { kind: EnemyKind; charId?: string; level: number }[];
}

export interface StageDef {
  id: string;
  name: string;
  tagline: string;
  theme: string; // palette/rendu
  width: number;
  waves: WaveSpec[];
  boss: { charId: string; level: number; name: string; line: string };
}

export interface BonusChoice {
  slot: number;
  options: BonusId[];
  cursor: number;
  chosen: number; // -1 tant que non validé
}

export interface SimConfig {
  mode: GameMode;
  difficulty: number;
  rounds: number;
  teams: boolean;
  stageIndex: number;
  players: { slot: number; charId: string; name: string; color: number; team: number }[];
  bots: { charId: string; name: string; color: number; team: number; level: number }[];
}

export interface World {
  frame: number;
  seed: number;
  rng: number; // état xorshift sérialisé
  mode: GameMode;
  difficulty: number;
  config: SimConfig;
  fighters: Fighter[];
  projectiles: Projectile[];
  items: Item[];
  nextId: number;
  phase: Phase;
  phaseTimer: number;
  paused: boolean;
  pausedBy: number;
  stageIndex: number;
  stage: StageDef | null;
  waveIndex: number;
  arenaL: number;
  arenaR: number;
  locked: boolean;
  camX: number;
  round: number;
  wins: number[]; // victoires par équipe (duel)
  roundTimer: number;
  score: number;
  coins: number;
  bonusChoices: BonusChoice[];
  events: SimEvent[];
  survivalWave: number;
  winnerTeam: number;
  slowmo: number; // frames de ralenti (KO cinématique) -> géré côté rendu via events, mais compte ici pour le timing
  elapsed: number;
}
