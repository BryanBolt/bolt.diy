// Simulation déterministe d'AI Fighter 2.
// step(world, inputs) fait avancer le monde d'une frame (1/60 s).
// Aucune dépendance à l'horloge, au hasard natif ni aux fonctions
// trigonométriques : deux machines avec les mêmes entrées obtiennent
// exactement le même monde (base du lockstep en ligne).

import { Rng, clamp, approach, q, sign } from '../core/math';
import { getChar, ENEMY_CHAR, ENEMY_NAMES } from './chars';
import { STAGES, SURVIVAL_STAGE, DUEL_STAGES } from './stages';
import { BONUSES, STACKABLE, stacks, activeSynergies, rollBonuses } from './bonuses';
import { aiInput } from './ai';
import * as C from './constants';
import { IN } from './types';
import { SHOP_ITEMS, WEAPONS } from './types';
import { readCommand, dirMaskOf, pushHistory } from './commands';
import { FORMS, FORM_FRAMES } from './forms';
import type { World, Fighter, SimConfig, MoveDef, Projectile, Item, BonusId, EnemyKind, StageDef, AiState, CharDef, SimEvent, Phase, FState, Hazard, ProjectileDef, WeaponKind } from './types';

// ---------------------------------------------------------------------------
// Création
// ---------------------------------------------------------------------------

export function createWorld(config: SimConfig, seed: number): World {
  const w: World = {
    frame: 0,
    seed,
    rng: new Rng(seed).s,
    mode: config.mode,
    difficulty: clamp(config.difficulty, 0, 3),
    config,
    fighters: [],
    projectiles: [],
    items: [],
    nextId: 1,
    phase: 'intro',
    grav: 1,
    phaseTimer: 0,
    phaseFrame: 0,
    paused: false,
    pausedBy: -1,
    stageIndex: config.stageIndex,
    stage: null,
    waveIndex: -1,
    arenaL: 0,
    arenaR: C.VIEW_W,
    locked: false,
    camX: 0,
    round: 0,
    wins: [0, 0, 0, 0],
    roundTimer: C.ROUND_FRAMES,
    score: 0,
    coins: 0,
    bonusChoices: [],
    shopChoices: [],
    hazards: [],
    fixtures: [],
    events: [],
    survivalWave: 0,
    winnerTeam: -1,
    slowmo: 0,
    elapsed: 0,
  };
  for (const p of config.players) {
    const f = makeFighter(w, p.charId, p.name, p.team, 0, p.color);
    f.slot = p.slot;
    f.controller = 'player';
    w.fighters.push(f);
  }
  for (const b of config.bots) {
    const f = makeFighter(w, b.charId, b.name, b.team, b.level, b.color);
    f.controller = 'ai';
    f.ai = makeAi('bot', b.level, w);
    w.fighters.push(f);
  }
  w.grav = [1, 0.35, 0.08][clamp(config.gravity ?? 0, 0, 2)];
  applyModifier(w);
  if (config.mode === 'duel') startDuelRound(w, true);
  else if (config.mode === 'training') startTraining(w);
  else startStage(w, config.mode === 'survival' ? SURVIVAL_STAGE : STAGES[clamp(config.stageIndex, 0, STAGES.length - 1)]);
  return w;
}

function rng(w: World): Rng {
  const r = new Rng(w.rng);
  return r;
}
function commitRng(w: World, r: Rng): void {
  w.rng = r.s;
}
/** Tirage aléatoire déterministe : [0,1) */
export function rand(w: World): number {
  const r = rng(w);
  const v = r.next();
  commitRng(w, r);
  return v;
}
export function randInt(w: World, lo: number, hi: number): number {
  const r = rng(w);
  const v = r.int(lo, hi);
  commitRng(w, r);
  return v;
}

function makeAi(kind: AiState['kind'], level: number, w: World): AiState {
  return { kind, timer: randInt(w, 10, 40), intent: 'approach', target: -1, aggro: C.DIFF_AGGRO[w.difficulty], level };
}

export function makeFighter(w: World, charId: string, name: string, team: number, level: number, color: number): Fighter {
  const c = getChar(charId);
  const stats = { ...c.stats };
  const f: Fighter = {
    id: w.nextId++,
    charId,
    name,
    team,
    slot: -1,
    controller: 'ai',
    ai: null,
    x: 200,
    y: 0,
    z: 140,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 1,
    hp: stats.hpMax,
    hpMax: stats.hpMax,
    ki: 0,
    superMeter: 0,
    guardMeter: C.GUARD_MAX,
    state: 'idle',
    stateFrame: 0,
    moveId: null,
    moveHits: [],
    multiLeft: 0,
    chainIndex: 0,
    freeze: 0,
    invuln: 0,
    armor: false,
    comboHits: 0,
    comboTimer: 0,
    comboDamage: 0,
    guardFrames: 99,
    lowGuard: false,
    prevInput: 0,
    bufferedInput: 0,
    bufferTimer: 0,
    tapTimer: 0,
    tapDir: 0,
    runFrames: 0,
    airJumps: 0,
    heavyCharge: 0,
    chargeBonus: 0,
    hitFrames: 0,
    lastHitBy: -1,
    koTimer: 0,
    revive: 0,
    lives: C.LIVES,
    stats,
    bonuses: [],
    status: { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 },
    color,
    level,
    kills: 0,
    phoenixUsed: false,
    nextMoveFrame: 0,
    wantsLeave: false,
    weapon: 0,
    weaponKind: '',
    rage: false,
    boss: false,
    hist: [],
    gunCd: 0,
    lastCmd: '',
    lastCmdFrame: -999,
    backHold: 0,
    cmb: '',
    cmbFrame: -999,
    phase2: false,
    form: 0,
    kiCharge: 0,
    carry: '',
    holding: -1,
    heldBy: -1,
    holdFrames: 0,
    holdMode: 0,
  };
  return f;
}

function makeEnemy(w: World, kind: EnemyKind, level: number, charId?: string, name?: string): Fighter {
  const mageIdx = kind === 'mage' ? randInt(w, 0, 3) : 0;
  const cid = charId ?? (kind === 'mage' ? ['blaze', 'frost', 'shade', 'nova'][mageIdx] : ENEMY_CHAR[kind]) ?? 'kai';
  const nm = name ?? ENEMY_NAMES[kind]?.[kind === 'mage' ? mageIdx : randInt(w, 0, 3)] ?? 'Ennemi';
  const special = kind === 'boss' || kind === 'mage' || kind === 'tank' || kind === 'shaman' || kind === 'grappler';
  const f = makeFighter(w, cid, nm, 1, level, special ? getChar(cid).color : 11);
  const diff = C.DIFF_HP[w.difficulty];
  const base = kind === 'boss' ? 2.8 : kind === 'tank' ? 2.3 : kind === 'grappler' ? 1.2 : kind === 'mage' ? 0.75 : kind === 'shaman' ? 0.85 : kind === 'brute' ? 1.25 : kind === 'ninja' ? 0.7 : kind === 'gunner' ? 0.75 : kind === 'shield' ? 1.1 : kind === 'bomber' ? 0.7 : 0.85;
  const players = humanCount(w);
  const crowd = kind === 'boss' ? 1 + (players - 1) * 0.6 : 1 + (players - 1) * 0.3;
  f.hpMax = Math.round(f.hpMax * base * (0.5 + level * 0.1) * diff * crowd);
  f.hp = f.hpMax;
  // en solo, les ennemis frappent un peu moins fort (pas d'allié pour réanimer)
  f.stats.power = f.stats.power * (kind === 'boss' ? 0.95 : kind === 'tank' ? 0.6 : 0.5) * (0.7 + level * 0.06) * C.DIFF_DMG[w.difficulty] * (players === 1 ? 0.88 : 1);
  f.stats.speed = f.stats.speed * (kind === 'ninja' ? 1.05 : kind === 'boss' ? 1.0 : kind === 'tank' ? 0.7 : kind === 'grappler' ? 0.95 : 0.9) * (0.92 + level * 0.012);
  f.stats.defense = f.stats.defense * (kind === 'boss' ? 1.1 : kind === 'shield' ? 1.12 : 0.9);
  f.ai = makeAi(kind, level, w);
  if (kind === 'boss') f.ai.aggro = Math.max(f.ai.aggro, 0.85);
  if (kind === 'tank') f.bonuses.push('armor');
  f.controller = 'ai';
  f.lives = 0;
  f.boss = kind === 'boss';
  return f;
}

// ---------------------------------------------------------------------------
// Phases / modes
// ---------------------------------------------------------------------------

function setPhase(w: World, phase: Phase, timer: number): void {
  w.phase = phase;
  w.phaseTimer = timer;
  w.phaseFrame = w.frame;
  w.events.push({ t: 'phase', phase });
}

function players(w: World): Fighter[] {
  return w.fighters.filter((f) => f.team === 0 && (f.slot >= 0 || f.controller === 'player' || f.ai?.kind === 'bot'));
}
function enemies(w: World): Fighter[] {
  return w.fighters.filter((f) => f.team !== 0);
}
function alive(f: Fighter): boolean {
  return f.state !== 'ko';
}

function placePlayers(w: World, x0: number): void {
  const ps = players(w);
  ps.forEach((f, i) => {
    f.x = x0 + [0, 42, 10, 56][i % 4] + Math.floor(i / 4) * 80;
    f.z = [150, 190, 112, 170][i % 4];
    f.y = 0;
    f.vx = f.vy = f.vz = 0;
    f.facing = 1;
    setState(f, 'idle');
    f.invuln = 0;
  });
}

/** Modificateurs du défi du jour. */
function applyModifier(w: World): void {
  const m = w.config.modifier;
  if (!m) return;
  for (const f of w.fighters) {
    if (f.controller !== 'player') continue;
    if (m === 'glass') { f.hpMax = Math.round(f.hpMax / 2); f.hp = f.hpMax; f.stats = { ...f.stats, power: f.stats.power * 1.7 }; }
    if (m === 'boosted') {
      const r = rng(w);
      for (const id of rollBonuses(BONUSES, 2, 0, (lo, hi) => r.int(lo, hi))) applyBonus(w, f, id);
      commitRng(w, r);
    }
  }
}

function startStage(w: World, stage: StageDef): void {
  w.grav = Math.min([1, 0.35, 0.08][clamp(w.config.gravity ?? 0, 0, 2)], stage.grav ?? 1);
  w.stage = stage;
  w.waveIndex = -1;
  w.fighters = w.fighters.filter((f) => f.team === 0);
  w.projectiles = [];
  w.items = [];
  w.hazards = [];
  w.fixtures = [];
  for (const f of players(w)) {
    if (f.state === 'ko') {
      f.lives = Math.max(f.lives, 1);
      respawn(w, f, 160);
    }
    f.hp = Math.min(f.hpMax, f.hp + Math.round(f.hpMax * 0.5));
    f.phoenixUsed = false;
  }
  placePlayers(w, 160);
  w.arenaL = 0;
  w.arenaR = C.VIEW_W;
  w.camX = 0;
  w.locked = false;
  setPhase(w, 'intro', 150);
}

function nextWave(w: World): void {
  if (!w.stage) return;
  w.waveIndex++;
  const stage = w.stage;
  const nWaves = w.mode === 'survival' ? Infinity : stage.waves.length;
  const isBoss = w.mode !== 'survival' && w.waveIndex >= nWaves;
  const ps = players(w).filter(alive);
  const px = ps.length ? ps.reduce((s, f) => s + f.x, 0) / ps.length : 200;
  // verrouille l'arène autour des joueurs
  w.arenaL = clamp(q(px - C.VIEW_W * 0.42), 0, stage.width - C.VIEW_W);
  w.arenaR = w.arenaL + C.VIEW_W;
  w.locked = true;
  const spec: { kind: EnemyKind; charId?: string; level: number }[] = isBoss
    ? [{ kind: 'boss', charId: stage.boss.charId, level: stage.boss.level }]
    : w.mode === 'survival'
      ? survivalWave(w, w.waveIndex)
      : stage.waves[w.waveIndex].enemies;
  const nPlayers = humanCount(w);
  const extra = isBoss ? 0 : Math.round((nPlayers - 1) * 0.6 * spec.length);
  const all: { kind: EnemyKind; charId?: string; level: number }[] = [...spec];
  for (let i = 0; i < extra; i++) all.push(spec[i % spec.length]);
  all.forEach((e, i) => {
    const enemy = e.kind === 'boss' ? makeEnemy(w, 'boss', e.level, e.charId, stage.boss.name) : makeEnemy(w, e.kind, e.level + (w.mode === 'survival' ? 0 : 0), e.charId);
    const side = i % 2 === 0 ? 1 : -1;
    enemy.x = side > 0 ? w.arenaR + 40 + i * 30 : w.arenaL - 40 - i * 30;
    enemy.z = clamp(60 + ((i * 71) % 170), C.Z_MIN, C.Z_MAX);
    enemy.facing = side > 0 ? -1 : 1;
    enemy.invuln = 20;
    w.fighters.push(enemy);
    w.events.push({ t: 'spawn', id: enemy.id });
  });
  if (isBoss) {
    const bf = w.fighters.find((x) => x.boss);
    w.events.push({ t: 'boss', id: bf ? bf.id : -1, name: stage.boss.name, line: stage.boss.line });
    w.events.push({ t: 'sound', id: 'boss' });
    w.slowmo = Math.max(w.slowmo, 30);
  } else {
    w.events.push({ t: 'sound', id: 'wave' });
  }
  // danger de stage
  w.hazards = [];
  placeFixtures(w, stage);
  if (stage.hazard) w.hazards.push({ id: w.nextId++, kind: stage.hazard, state: 'idle', timer: randInt(w, 240, 420), x: 0, z: 140, vx: 0, dir: -1, hits: [] });
  // armes au sol (kalachnikov garantie avant un boss)
  if (isBoss) w.items.push(makeWeaponItem(w, 'ak', w.arenaL + 160 + rand(w) * 640));
  else if (rand(w) < 0.45) w.items.push(makeWeaponItem(w, randomWeapon(w), w.arenaL + 140 + rand(w) * 680));
  // caisses
  const nCrates = isBoss ? 1 : randInt(w, 1, 2);
  for (let i = 0; i < nCrates; i++) {
    const cv = crateVariant(w);
    w.items.push({ id: w.nextId++, kind: 'crate', cv, x: q(w.arenaL + 120 + rand(w) * (C.VIEW_W - 240)), y: 0, z: randInt(w, 50, 230), vy: 0, life: 99999, hp: cv === 'metal' ? 4 : 2 });
  }
  setPhase(w, 'fight', 0);
}

function survivalWave(w: World, idx: number): { kind: EnemyKind; level: number }[] {
  const n = 2 + Math.floor(idx / 2) + (w.config.modifier === 'swarm' ? 3 : 0);
  const level = 1 + Math.floor(idx * 0.8);
  const kinds: EnemyKind[] = ['thug', 'thug', 'brute', 'ninja', 'gunner', 'mage', 'grappler', 'shaman', 'tank'];
  const out: { kind: EnemyKind; level: number }[] = [];
  for (let i = 0; i < Math.min(n, w.config.modifier === 'swarm' ? 10 : 7); i++) out.push({ kind: kinds[randInt(w, 0, Math.min(kinds.length - 1, 1 + Math.floor(idx / 2)))], level });
  if (idx > 0 && idx % 5 === 4) out.push({ kind: 'brute', level: level + 2 });
  return out;
}

function startBonusPhase(w: World): void {
  w.bonusChoices = [];
  for (const f of players(w)) {
    const pool = BONUSES.filter((b) => !f.bonuses.includes(b.id) || STACKABLE.has(b.id));
    const r = rng(w);
    const options = rollBonuses(pool, 3, w.waveIndex, (lo, hi) => r.int(lo, hi));
    commitRng(w, r);
    w.bonusChoices.push({ slot: f.slot, options, cursor: 0, chosen: f.controller === 'ai' ? 0 : -1 });
  }
  setPhase(w, 'bonus', 40 * C.FPS);
}

function finishBonusPhase(w: World): void {
  for (const bc of w.bonusChoices) {
    const f = w.fighters.find((x) => x.slot === bc.slot && x.team === 0);
    if (!f) continue;
    const chosen = bc.options[bc.chosen < 0 ? 0 : bc.chosen];
    applyBonus(w, f, chosen);
    w.events.push({ t: 'bonus', slot: bc.slot, bonus: chosen });
  }
  w.bonusChoices = [];
  w.locked = false;
  setPhase(w, 'fight', 0);
  w.events.push({ t: 'sound', id: 'go' });
}

export function applyBonus(w: World, f: Fighter, b: BonusId): void {
  const before = activeSynergies(f.bonuses).length;
  f.bonuses.push(b);
  if (activeSynergies(f.bonuses).length > before) {
    const sy = activeSynergies(f.bonuses).slice(-1)[0];
    w.events.push({ t: 'text', x: f.x, y: f.y + 170, z: f.z, text: `SYNERGIE : ${sy.name}`, color: '#ffb830' });
  }
  switch (b) {
    case 'power': f.stats.power *= 1.15; break;
    case 'speed': f.stats.speed *= 1.12; break;
    case 'vitality': f.hpMax += 30; f.hp = f.hpMax; break;
    case 'armor': f.stats.defense *= 1.15; break;
    default: break;
  }
}

/** Arme tirée au hasard ; les armes à feu arrivent au fil de la campagne. */
function randomWeapon(w: World): WeaponKind {
  const camp = w.mode === 'campaign';
  const st = w.stageIndex;
  const pool: WeaponKind[] = ['bat', 'bat', 'nunchaku', 'sword', 'spear'];
  if (st >= 1 || !camp) pool.push('pistol', 'katana', 'axe');
  if (st >= 2 || !camp) pool.push('ak', 'shotgun', 'hammer');
  if (st >= 3 || !camp) pool.push('laser');
  return pool[randInt(w, 0, pool.length - 1)];
}

function makeWeaponItem(w: World, wk: WeaponKind, x: number, y = 0): Item {
  return { id: w.nextId++, kind: 'weapon', wk, x: q(x), y, z: randInt(w, 60, 230), vy: y > 0 ? 3 : 0, life: 1500 };
}

function giveWeapon(w: World, f: Fighter, wk: WeaponKind, uses?: number): void {
  f.weaponKind = wk;
  f.weapon = Math.max(1, Math.min(WEAPONS[wk].uses, uses ?? WEAPONS[wk].uses));
  f.gunCd = 0;
  w.events.push({ t: 'text', x: f.x, y: f.y + 130, z: f.z, text: WEAPONS[wk].name.toUpperCase() + ' !', color: '#ffd166' });
  w.events.push({ t: 'sound', id: 'weapon', x: f.x });
}

function startShop(w: World): void {
  w.shopChoices = [];
  for (const f of players(w)) w.shopChoices.push({ slot: f.slot, cursor: 0, done: f.controller === 'ai', bought: [] });
  setPhase(w, 'shop', 75 * C.FPS);
  w.events.push({ t: 'sound', id: 'shop' });
}

function buyItem(w: World, f: Fighter, sc: { cursor: number; bought: string[] }): void {
  const item = SHOP_ITEMS[sc.cursor];
  if (!item) return;
  if (w.coins < item.cost) { w.events.push({ t: 'sound', id: 'deny' }); return; }
  if (item.id === 'heal' && f.hp >= f.hpMax) { w.events.push({ t: 'sound', id: 'deny' }); return; }
  if ((item.id === 'weapon' || item.id === 'ak') && f.weapon > 0) { w.events.push({ t: 'sound', id: 'deny' }); return; }
  w.coins -= item.cost;
  sc.bought.push(item.id);
  switch (item.id) {
    case 'life': f.lives++; break;
    case 'heal': f.hp = f.hpMax; break;
    case 'ki': f.ki = C.KI_MAX; f.superMeter = C.SUPER_MAX; break;
    case 'weapon': giveWeapon(w, f, 'bat'); break;
    case 'ak': giveWeapon(w, f, 'ak'); break;
    case 'bonus': {
      const pool = BONUSES.filter((b) => !f.bonuses.includes(b.id));
      const b = pool.length ? pool[randInt(w, 0, pool.length - 1)].id : 'power';
      applyBonus(w, f, b);
      w.events.push({ t: 'bonus', slot: f.slot, bonus: b });
      break;
    }
  }
  w.events.push({ t: 'sound', id: 'buy' });
}

// ---- dangers de stage ----
function stepHazards(w: World): void {
  const keep: Hazard[] = [];
  for (const h of w.hazards) {
    h.timer--;
    if (h.state === 'idle') {
      if (h.timer <= 0) {
        h.state = 'warn';
        h.timer = h.kind === 'wind' ? 60 : 100;
        h.hits = [];
        h.dir = rand(w) < 0.5 ? -1 : 1;
        switch (h.kind) {
          case 'train': h.z = C.Z_MIN + 12; h.x = h.dir < 0 ? w.arenaR + 400 : w.arenaL - 400; h.vx = 16 * h.dir; break;
          case 'laser': h.z = 140; h.x = h.dir < 0 ? w.arenaR + 20 : w.arenaL - 20; h.vx = 5 * h.dir; break;
          case 'barrel': h.z = randInt(w, C.Z_MIN + 20, C.Z_MAX - 20); h.x = h.dir < 0 ? w.arenaR + 30 : w.arenaL - 30; h.vx = 6.5 * h.dir; break;
          case 'drone': h.z = randInt(w, C.Z_MIN + 20, C.Z_MAX - 20); h.x = w.arenaL + 120 + rand(w) * (C.VIEW_W - 240); h.vx = 0; break;
          case 'wind': h.x = w.arenaL; h.z = 140; h.vx = 0; break;
        }
        w.events.push({ t: 'hazard', kind: h.kind, state: 'warn', x: h.x, z: h.z });
        w.events.push({ t: 'sound', id: h.kind === 'wind' ? 'wind' : 'alarm', x: h.x });
      }
    } else if (h.state === 'warn') {
      if (h.timer <= 0) {
        h.state = 'active';
        h.timer = h.kind === 'wind' ? 180 : h.kind === 'drone' ? 150 : 400;
        w.events.push({ t: 'hazard', kind: h.kind, state: 'active', x: h.x, z: h.z });
        w.events.push({ t: 'sound', id: h.kind, x: h.x });
        if (h.kind === 'train' || h.kind === 'laser') w.events.push({ t: 'shake', power: 3 });
      }
    } else {
      // actif
      h.x = q(h.x + h.vx);
      let done = h.timer <= 0;
      if (h.kind === 'train') {
        if ((h.dir < 0 && h.x < w.arenaL - 500) || (h.dir > 0 && h.x > w.arenaR + 500)) done = true;
        for (const f of w.fighters) {
          if (!alive(f) || h.hits.includes(f.id) || f.z > C.Z_MIN + 46 || f.invuln > 0) continue;
          if (Math.abs(f.x - h.x) > 190) continue;
          h.hits.push(f.id);
          hazardHit(w, f, 28, h.dir, 11, 9);
        }
      } else if (h.kind === 'laser') {
        if ((h.dir < 0 && h.x < w.arenaL - 40) || (h.dir > 0 && h.x > w.arenaR + 40)) done = true;
        for (const f of w.fighters) {
          if (!alive(f) || h.hits.includes(f.id) || f.y > 38 || f.invuln > 0 || f.state === 'dodge') continue;
          if (Math.abs(f.x - h.x) > 14) continue;
          h.hits.push(f.id);
          hazardHit(w, f, 16, h.dir, 6, 7);
        }
      } else if (h.kind === 'barrel') {
        if ((h.dir < 0 && h.x < w.arenaL + 10) || (h.dir > 0 && h.x > w.arenaR - 10)) { done = true; w.events.push({ t: 'pickup', kind: 'crate', x: h.x, y: 20, z: h.z }); w.events.push({ t: 'sound', id: 'cratebreak', x: h.x }); }
        for (const f of w.fighters) {
          if (!alive(f) || h.hits.includes(f.id) || f.y > 42 || f.invuln > 0 || f.state === 'dodge') continue;
          if (Math.abs(f.x - h.x) > 26 || Math.abs(f.z - h.z) > 30) continue;
          h.hits.push(f.id);
          hazardHit(w, f, 14, h.dir, 7, 6);
        }
      } else if (h.kind === 'drone') {
        // drone qui tire vers le bas toutes les 30 frames, puis repart
        if (h.timer % 30 === 0) {
          w.projectiles.push({ id: w.nextId++, kind: 'bullet', x: h.x, y: 150, z: h.z, vx: 0, vy: -9, owner: -1, team: 2, damage: 9, life: 30, radius: 9, pierce: false, hits: [], gravity: 0, homing: 0 });
          w.events.push({ t: 'sound', id: 'kishot', x: h.x });
        }
      } else if (h.kind === 'wind') {
        // bourrasque : pousse tout le monde dans un sens
        for (const f of w.fighters) if (alive(f) && f.state !== 'down') f.vx += 0.35 * h.dir * (f.y > 0 ? 2 : 1);
      }
      if (done) {
        h.state = 'idle';
        h.timer = randInt(w, 420, 720);
        w.events.push({ t: 'hazard', kind: h.kind, state: 'end', x: h.x, z: h.z });
      }
    }
    keep.push(h);
  }
  w.hazards = keep;
}

/** Pose les éléments interactifs du stage près des bords de l'arène (là où l'on envoie les ennemis). */
function placeFixtures(w: World, stage: StageDef): void {
  w.fixtures = [];
  const kind = stage.fixture;
  if (!kind) return;
  const add = (x: number, z: number) => w.fixtures.push({ id: w.nextId++, kind, x: q(x), z: q(z), used: false, cd: 0 });
  if (kind === 'current') { add(w.arenaL + C.VIEW_W / 2, 140); return; }
  if (kind === 'rail') { add(w.arenaL + 150 + rand(w) * 200, C.Z_MAX - 30); add(w.arenaR - 150 - rand(w) * 200, C.Z_MIN + 40); return; }
  add(w.arenaL + 55 + rand(w) * 40, randInt(w, C.Z_MIN + 30, C.Z_MAX - 30));
  add(w.arenaR - 55 - rand(w) * 40, randInt(w, C.Z_MIN + 30, C.Z_MAX - 30));
}

const FIXTURE_NAME: Record<string, string> = { paper: 'CLOISON !', sign: 'ENSEIGNE !', stall: 'ÉTAL RENVERSÉ !', rail: 'RAIL SOUS TENSION !', window: 'DÉFENESTRATION !', pylon: 'PYLÔNE !' };

function fixtureHit(w: World, f: Fighter, dmg: number, text: string, color: string): void {
  const real = Math.max(1, Math.round(dmg / f.stats.defense));
  damageRaw(w, f, real, f.lastHitBy);
  w.events.push({ t: 'hit', x: f.x, y: f.y + 50, z: f.z, power: 1.4, blocked: false, crit: false, dir: f.vx >= 0 ? 1 : -1, attacker: -1, target: f.id });
  w.events.push({ t: 'text', x: f.x, y: f.y + 150, z: f.z, text, color });
  w.events.push({ t: 'sound', id: 'hitheavy', x: f.x });
  w.events.push({ t: 'shake', power: 5 });
  f.freeze = Math.max(f.freeze, 8);
}

function stepFixtures(w: World): void {
  for (const x of w.fixtures) {
    if (x.cd > 0) x.cd--;
    if (x.kind === 'current') {
      // courant sous-marin : toutes les 12 s, une poussée de 2,5 s (le sens alterne)
      const t = w.frame % 720;
      if (t === 0) w.events.push({ t: 'text', x: w.arenaL + C.VIEW_W / 2, y: 260, z: 140, text: '🌊 COURANT !', color: '#7de8ff' });
      if (t < 150) {
        const dir = Math.floor(w.frame / 720) % 2 === 0 ? 1 : -1;
        for (const f of w.fighters) {
          if (f.state === 'ko' || f.state === 'held' || f.state === 'hold') continue;
          f.x = clamp(f.x + dir * 1.1, w.arenaL + 24, w.arenaR - 24);
        }
        w.events.push({ t: 'fixture', kind: 'current', x: dir, z: 0 });
      }
      continue;
    }
    if (x.used || x.cd > 0) continue;
    for (const f of w.fighters) {
      if (f.state !== 'launch' || Math.abs(f.vx) < 3 || Math.abs(f.x - x.x) > 36 || Math.abs(f.z - x.z) > 70) continue;
      const dir = f.vx >= 0 ? 1 : -1;
      w.events.push({ t: 'fixture', kind: x.kind, x: x.x, z: x.z });
      switch (x.kind) {
        case 'paper':
          x.used = true;
          fixtureHit(w, f, 14, FIXTURE_NAME.paper, '#ffd8a8');
          break;
        case 'sign':
          x.cd = 360;
          fixtureHit(w, f, 20, 'ENSEIGNE ! ⚡', '#ffe14d');
          f.freeze = 40;
          w.events.push({ t: 'boom', x: x.x, y: 120, z: x.z, elem: 'shock', r: 70 });
          break;
        case 'stall':
          x.used = true;
          fixtureHit(w, f, 12, FIXTURE_NAME.stall, '#ffb870');
          for (let i = 0; i < 3; i++) w.items.push({ id: w.nextId++, kind: 'coin', x: x.x + (i - 1) * 26, y: 40, z: x.z, vy: 6, vx: (i - 1) * 2, life: 900 });
          w.items.push({ id: w.nextId++, kind: 'heal', x: x.x, y: 40, z: x.z + 10, vy: 7, life: 900 });
          break;
        case 'rail':
          x.cd = 300;
          fixtureHit(w, f, 18, FIXTURE_NAME.rail, '#8fd8ff');
          f.freeze = 36;
          w.events.push({ t: 'boom', x: f.x, y: 20, z: f.z, elem: 'shock', r: 60 });
          break;
        case 'window': {
          x.used = true;
          const boss = f.ai?.kind === 'boss' || f.boss;
          if (!boss && f.team !== 0) {
            fixtureHit(w, f, 9999, FIXTURE_NAME.window, '#aeeaff');
            w.coins += 15; w.score += 200;
            w.slowmo = Math.max(w.slowmo, 35);
          } else fixtureHit(w, f, boss ? 30 : 16, FIXTURE_NAME.window, '#aeeaff');
          w.events.push({ t: 'sound', id: 'cratebreak', x: x.x });
          break;
        }
        case 'pylon':
          x.cd = 420;
          fixtureHit(w, f, 10, FIXTURE_NAME.pylon, '#ffe14d');
          w.events.push({ t: 'boom', x: x.x, y: 100, z: x.z, elem: 'shock', r: 150 });
          for (const o of w.fighters) if (o !== f && o.team !== f.team && alive(o) && Math.abs(o.x - x.x) < 160 && Math.abs(o.z - x.z) < 90) fixtureHit(w, o, 14, 'ARC ⚡', '#ffe14d');
          break;
      }
      void dir;
      break;
    }
  }
}

function hazardHit(w: World, f: Fighter, dmg: number, dir: number, kbx: number, kby: number): void {
  if ((f.state === 'guard' || f.state === 'block') && sign(dir) === -f.facing) {
    dmg = Math.round(dmg * 0.3);
    f.guardMeter -= 25;
  }
  const real = Math.max(1, Math.round(dmg / f.stats.defense));
  damageRaw(w, f, real, -1);
  w.events.push({ t: 'hit', x: f.x, y: f.y + 50, z: f.z, power: 1.2, blocked: false, crit: false, dir, attacker: -1, target: f.id });
  w.events.push({ t: 'sound', id: 'hitheavy', x: f.x });
  w.events.push({ t: 'shake', power: 4 });
  if (!alive(f)) return;
  setState(f, 'launch');
  f.vx = dir * kbx;
  f.vy = kby;
  f.y = Math.max(f.y, 0.1);
  f.freeze = 6;
}

function stepBossRage(w: World): void {
  for (const f of w.fighters) {
    if (f.ai && f.ai.kind === 'boss' && !f.rage && alive(f) && f.hp <= f.hpMax * 0.75 && !f.phase2) {
      // phase 2 : le boss appelle du renfort
      f.phase2 = true;
      const minions = w.stage?.boss.minions ?? 'thug';
      for (let i = 0; i < 2; i++) {
        const m = makeEnemy(w, minions, Math.max(1, f.level - 1));
        m.x = i === 0 ? w.arenaL - 40 : w.arenaR + 40;
        m.z = randInt(w, C.Z_MIN + 10, C.Z_MAX - 10);
        m.facing = i === 0 ? 1 : -1;
        m.invuln = 20;
        w.fighters.push(m);
        w.events.push({ t: 'spawn', id: m.id });
      }
      w.events.push({ t: 'text', x: f.x, y: f.y + 150, z: f.z, text: 'RENFORTS !', color: '#ffd166' });
      w.events.push({ t: 'shake', power: 4 });
    }
    if (!f.ai || f.ai.kind !== 'boss' || f.rage || !alive(f) || f.hp > f.hpMax * 0.5) continue;
    f.rage = true;
    f.stats.speed *= 1.12;
    f.stats.power *= 1.15;
    f.superMeter = C.SUPER_MAX;
    f.ki = C.KI_MAX;
    f.ai.aggro = 1;
    f.invuln = Math.max(f.invuln, 40);
    f.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
    if (f.state !== 'ko') setState(f, 'idle');
    w.events.push({ t: 'rage', id: f.id, x: f.x, y: f.y, z: f.z });
    w.events.push({ t: 'text', x: f.x, y: f.y + 150, z: f.z, text: 'FURIE !', color: '#ff5f5f' });
    if (w.stage) w.events.push({ t: 'text', x: w.arenaL + C.VIEW_W / 2, y: 300, z: 140, text: w.stage.boss.rageLine, color: '#ffd166' });
    w.events.push({ t: 'sound', id: 'rage', x: f.x });
    w.events.push({ t: 'shake', power: 6 });
    w.slowmo = Math.max(w.slowmo, 30);
    const minions = w.stage?.boss.minions;
    if (minions) {
      for (let i = 0; i < 2; i++) {
        const m = makeEnemy(w, minions, Math.max(1, f.level - 2));
        m.x = i === 0 ? w.arenaL - 40 : w.arenaR + 40;
        m.z = randInt(w, C.Z_MIN + 10, C.Z_MAX - 10);
        m.facing = i === 0 ? 1 : -1;
        m.invuln = 20;
        w.fighters.push(m);
        w.events.push({ t: 'spawn', id: m.id });
      }
    }
  }
}

const BOTTLE: ProjectileDef = { kind: 'bottle', speed: 6.5, life: 110, damage: 13, radius: 13, y: 70, gravity: 0.28 };

function startDuelRound(w: World, first: boolean): void {
  const stages = DUEL_STAGES;
  w.stage = stages[clamp(w.stageIndex, 0, stages.length - 1)];
  w.grav = Math.min([1, 0.35, 0.08][clamp(w.config.gravity ?? 0, 0, 2)], w.stage.grav ?? 1);
  w.projectiles = [];
  w.items = [];
  w.arenaL = 0;
  w.arenaR = w.stage.width;
  w.locked = true;
  w.roundTimer = C.ROUND_FRAMES;
  if (first) w.round = 0;
  else w.round++;
  const fs = w.fighters;
  const n = fs.length;
  fs.forEach((f, i) => {
    f.hp = f.hpMax;
    f.ki = 0;
    f.guardMeter = C.GUARD_MAX;
    f.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
    const t = n <= 1 ? 0.5 : i / (n - 1);
    f.x = q(140 + t * (w.stage!.width - 280));
    f.z = n <= 2 ? 150 : 150 + (i % 2 === 0 ? -34 : 34);
    f.y = 0;
    f.vx = f.vy = f.vz = 0;
    f.facing = t < 0.5 ? 1 : -1;
    setState(f, 'idle');
    f.invuln = 0;
    f.comboHits = 0;
  });
  w.camX = clamp((w.stage.width - C.VIEW_W) / 2, 0, w.stage.width - C.VIEW_W);
  setPhase(w, 'intro', 130);
}

function startTraining(w: World): void {
  w.stage = { ...STAGES[0], width: 1400, waves: [] };
  w.arenaL = 0;
  w.arenaR = w.stage.width;
  w.locked = true;
  placePlayers(w, 300);
  const dummy = makeEnemy(w, 'thug', 3, 'kai', 'Mannequin');
  dummy.hpMax = 300;
  dummy.hp = 300;
  dummy.x = 620;
  dummy.z = 140;
  dummy.facing = -1;
  dummy.ai!.aggro = 0;
  dummy.ai!.intent = 'wait';
  w.fighters.push(dummy);
  setPhase(w, 'fight', 0);
}

function respawn(w: World, f: Fighter, x?: number): void {
  const allies = players(w).filter((a) => a !== f && alive(a));
  f.hp = f.hpMax;
  f.ki = 0;
  f.guardMeter = C.GUARD_MAX;
  f.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
  f.x = x ?? (allies.length ? allies[0].x : w.camX + 200);
  f.y = 120;
  f.z = allies.length ? allies[0].z : 140;
  f.vx = f.vy = f.vz = 0;
  f.invuln = 100;
  f.koTimer = 0;
  f.revive = 0;
  setState(f, 'jump');
  w.events.push({ t: 'sound', id: 'respawn' });
}

// ---------------------------------------------------------------------------
// Pas de simulation
// ---------------------------------------------------------------------------

export function step(w: World, inputs: number[]): void {
  w.events = [];
  // pause (n'importe quel joueur)
  for (const f of w.fighters) {
    if (f.controller !== 'player') continue;
    const inp = inputs[f.slot] ?? 0;
    const pressed = inp & ~f.prevInput;
    if (pressed & IN.PAUSE) {
      if (!w.paused) {
        w.paused = true;
        w.pausedBy = f.slot;
        w.events.push({ t: 'sound', id: 'pause' });
      } else {
        w.paused = false;
        w.pausedBy = -1;
        w.events.push({ t: 'sound', id: 'unpause' });
      }
    }
  }
  if (w.paused) {
    for (const f of w.fighters) if (f.controller === 'player') f.prevInput = inputs[f.slot] ?? 0;
    return;
  }
  w.frame++;
  w.elapsed++;
  if (w.slowmo > 0) w.slowmo--;

  // --- phases ---
  stepPhase(w, inputs);

  const acting = w.phase === 'fight' || w.phase === 'waveClear' || w.phase === 'stageClear' || w.phase === 'roundEnd' || w.phase === 'matchEnd' || w.phase === 'gameOver';
  const canAct = w.phase === 'fight';

  // --- combattants ---
  for (const f of w.fighters) {
    let inp = 0;
    if (canAct) {
      if (f.controller === 'player') inp = inputs[f.slot] ?? 0;
      else if (f.ai) inp = aiInput(w, f);
    }
    stepFighter(w, f, inp, acting);
    f.prevInput = inp;
  }
  separate(w);
  stepShamans(w);
  // --- dangers, boss ---
  if (canAct && w.mode !== 'duel') { stepHazards(w); stepBossRage(w); stepFixtures(w); }
  // --- projectiles / objets ---
  stepProjectiles(w);
  stepItems(w);

  // nettoyage des ennemis de vague KO (jamais en duel : ils reviennent à la manche suivante)
  if (w.mode !== 'duel') w.fighters = w.fighters.filter((f) => !(f.state === 'ko' && f.team !== 0 && f.slot < 0 && f.koTimer > 80));

  // caméra : suit les joueurs (en duel : tous les combattants)
  const ps = (w.mode === 'duel' ? w.fighters : players(w)).filter(alive);
  if (ps.length) {
    let cx = 0;
    for (const p of ps) cx += p.x;
    cx /= ps.length;
    const target = clamp(q(cx - C.VIEW_W / 2), w.locked ? w.arenaL : 0, (w.locked ? w.arenaR : (w.stage?.width ?? C.VIEW_W)) - C.VIEW_W);
    w.camX = q(w.camX + (target - w.camX) * 0.12);
  }
}

const MENU_LOCK = 50;

function stepPhase(w: World, inputs: number[]): void {
  if (w.phaseTimer > 0) w.phaseTimer--;
  switch (w.phase) {
    case 'intro':
      if (w.phaseTimer === 0) {
        if (w.mode === 'duel') {
          setPhase(w, 'fight', 0);
          w.events.push({ t: 'sound', id: 'go' });
        } else if (w.mode === 'training') setPhase(w, 'fight', 0);
        else nextWave(w);
      }
      break;
    case 'fight': {
      if (w.mode === 'duel') stepDuel(w);
      else if (w.mode === 'training') {
        for (const e of enemies(w)) {
          if (e.state === 'idle' && e.hp < e.hpMax) e.hp = Math.min(e.hpMax, e.hp + 0.5);
          if (e.state === 'ko') { e.koTimer = 0; respawn(w, e, 620); e.hp = e.hpMax; }
        }
        for (const p of players(w)) if (p.state === 'ko') respawn(w, p, 300);
      } else stepCampaign(w);
      break;
    }
    case 'waveClear':
      if (w.phaseTimer === 0) {
        const last = w.mode !== 'survival' && w.stage && w.waveIndex >= w.stage.waves.length;
        if (last) {
          setPhase(w, 'stageClear', 300);
          w.events.push({ t: 'sound', id: 'stageclear' });
        } else if (w.waveIndex % 1 === 0) startBonusPhase(w);
      }
      break;
    case 'bonus': {
      let all = true;
      for (const bc of w.bonusChoices) {
        if (bc.chosen >= 0) continue;
        const f = w.fighters.find((x) => x.slot === bc.slot && x.team === 0);
        if (!f) { bc.chosen = 0; continue; }
        const inp = inputs[bc.slot] ?? 0;
        // les appuis des 0,8 premières secondes sont ignorés (on martèle encore Attaque en fin de combat)
        const pressed = w.frame - w.phaseFrame < MENU_LOCK ? 0 : inp & ~f.prevInput;
        if (pressed & IN.LEFT) { bc.cursor = (bc.cursor + 2) % 3; w.events.push({ t: 'sound', id: 'ui' }); }
        if (pressed & IN.RIGHT) { bc.cursor = (bc.cursor + 1) % 3; w.events.push({ t: 'sound', id: 'ui' }); }
        if (pressed & (IN.LIGHT | IN.CONFIRM)) { bc.chosen = bc.cursor; w.events.push({ t: 'sound', id: 'confirm' }); }
        else if (pressed & IN.HEAVY) {
          // relance des 3 propositions (25 pièces)
          if (w.coins >= 25) {
            w.coins -= 25;
            const pool = BONUSES.filter((b) => (!f.bonuses.includes(b.id) || STACKABLE.has(b.id)) && !bc.options.includes(b.id));
            const r = rng(w);
            const next = rollBonuses(pool, 3, w.waveIndex, (lo, hi) => r.int(lo, hi));
            commitRng(w, r);
            while (next.length < 3) next.push(bc.options[next.length]);
            bc.options = next;
            w.events.push({ t: 'sound', id: 'buy' });
          } else w.events.push({ t: 'sound', id: 'deny' });
        }
        f.prevInput = inp;
        if (bc.chosen < 0) all = false;
      }
      if (all || w.phaseTimer === 0) finishBonusPhase(w);
      break;
    }
    case 'stageClear':
      if (w.phaseTimer === 0) {
        if (w.stageIndex + 1 < STAGES.length) {
          startShop(w);
        } else {
          w.winnerTeam = 0;
          setPhase(w, 'matchEnd', 0);
          w.events.push({ t: 'sound', id: 'victory' });
        }
      }
      break;
    case 'shop': {
      let all = true;
      for (const sc of w.shopChoices) {
        if (sc.done) continue;
        const f = w.fighters.find((x) => x.slot === sc.slot && x.team === 0);
        if (!f) { sc.done = true; continue; }
        const inp = inputs[sc.slot] ?? 0;
        const pressed = w.frame - w.phaseFrame < MENU_LOCK ? 0 : inp & ~f.prevInput;
        const n = SHOP_ITEMS.length;
        if (pressed & IN.LEFT) { sc.cursor = (sc.cursor + n - 1) % n; w.events.push({ t: 'sound', id: 'ui' }); }
        if (pressed & IN.RIGHT) { sc.cursor = (sc.cursor + 1) % n; w.events.push({ t: 'sound', id: 'ui' }); }
        if (pressed & (IN.LIGHT | IN.CONFIRM)) buyItem(w, f, sc);
        if (pressed & IN.GUARD) { sc.done = true; w.events.push({ t: 'sound', id: 'confirm' }); }
        f.prevInput = inp;
        if (!sc.done) all = false;
      }
      if (all || w.phaseTimer === 0) {
        w.shopChoices = [];
        w.stageIndex++;
        startStage(w, STAGES[w.stageIndex]);
      }
      break;
    }
    case 'roundEnd':
      if (w.phaseTimer === 0) {
        const need = Math.ceil(w.config.rounds / 2);
        const winner = w.wins.findIndex((v) => v >= need);
        if (winner >= 0) {
          w.winnerTeam = winner;
          setPhase(w, 'matchEnd', 0);
          w.events.push({ t: 'sound', id: 'victory' });
        } else startDuelRound(w, false);
      }
      break;
    default:
      break;
  }
}

function stepCampaign(w: World): void {
  const ps = players(w);
  const es = enemies(w);
  // vagues
  if (w.locked) {
    if (es.length > 0 && es.every((e) => e.state === 'ko')) {
      w.locked = false;
      const isBossWave = w.stage && w.mode !== 'survival' && w.waveIndex >= w.stage.waves.length;
      setPhase(w, 'waveClear', isBossWave ? 120 : 70);
      w.events.push({ t: 'sound', id: 'waveclear' });
      if (w.mode === 'survival') w.survivalWave = w.waveIndex + 1;
      // soin de vague
      for (const p of ps) if (alive(p)) p.hp = Math.min(p.hpMax, p.hp + Math.round(p.hpMax * 0.12));
    }
  } else if (w.phase === 'fight') {
    // zone débloquée : avancer vers la droite déclenche la vague suivante
    const front = ps.filter(alive).reduce((m, p) => Math.max(m, p.x), 0);
    const stageW = w.stage?.width ?? C.VIEW_W;
    const trigger = Math.min(stageW - C.VIEW_W * 0.5, w.arenaR + 120);
    if (front >= trigger || w.waveIndex < 0) nextWave(w);
  }
  // KO / vies / réanimation
  const anyAlive = ps.some(alive);
  for (const p of ps) {
    if (p.state !== 'ko') continue;
    if (anyAlive) {
      if (p.lives <= 0 && p.koTimer > C.KO_REVIVABLE) continue; // hors-jeu définitif (sauf réanimation)
      if (p.koTimer > C.KO_REVIVABLE && p.lives > 0) {
        p.lives--;
        respawn(w, p);
      }
    } else if (p.koTimer > 100) {
      if (p.lives > 0) {
        p.lives--;
        respawn(w, p);
      }
    }
  }
  if (!anyAlive && ps.every((p) => p.lives <= 0 && p.koTimer > 100)) {
    setPhase(w, 'gameOver', 0);
    w.events.push({ t: 'sound', id: 'gameover' });
  }
}

function stepDuel(w: World): void {
  if (w.roundTimer > 0) w.roundTimer--;
  if (w.phase === 'fight' && w.roundTimer % 780 === 400 && w.items.filter((i) => i.kind === 'weapon').length < 2) {
    w.items.push(makeWeaponItem(w, randomWeapon(w), w.arenaL + 200 + rand(w) * (w.arenaR - w.arenaL - 400), 90));
    w.events.push({ t: 'sound', id: 'pickup' });
  }
  const teamsAlive = new Set<number>();
  for (const f of w.fighters) if (alive(f)) teamsAlive.add(f.team);
  let winner = -1;
  if (teamsAlive.size <= 1) {
    winner = teamsAlive.size === 1 ? [...teamsAlive][0] : -2;
  } else if (w.roundTimer === 0) {
    // décision aux PV restants
    const ratio: number[] = [0, 0, 0, 0];
    for (const f of w.fighters) ratio[f.team] += f.hp / f.hpMax;
    let best = -1;
    let bestV = -1;
    for (let t = 0; t < 4; t++) if (ratio[t] > bestV) { bestV = ratio[t]; best = t; }
    winner = best;
  }
  if (winner !== -1) {
    if (winner >= 0) w.wins[winner]++;
    for (const f of w.fighters) if (alive(f) && f.team === winner) setState(f, 'win');
    w.winnerTeam = winner;
    w.slowmo = 40;
    setPhase(w, 'roundEnd', 170);
    w.events.push({ t: 'sound', id: 'ko' });
  }
}

// ---------------------------------------------------------------------------
// Combattant
// ---------------------------------------------------------------------------

export function setState(f: Fighter, s: FState): void {
  f.state = s;
  f.stateFrame = 0;
  if (s !== 'attack') {
    f.moveId = null;
    f.moveHits = [];
    f.armor = false;
    f.multiLeft = 0;
  }
  if (s === 'idle' || s === 'walk') f.chainIndex = 0;
}

function hasSyn(f: Fighter, id: string): boolean {
  return f.bonuses.length > 1 && activeSynergies(f.bonuses).some((sy) => sy.id === id);
}

function hasBonus(f: Fighter, b: BonusId): boolean {
  return f.bonuses.includes(b);
}

const SHOOT_MOVE: MoveDef = { id: 'shoot', name: 'Tir', kind: 'light', startup: 1, active: 1, recovery: 3, hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 }, damage: 0, hitstun: 0, blockstun: 0, kbx: 0, kby: 0, hitstop: 0, anim: 'shoot' };

function currentMove(f: Fighter): MoveDef | null {
  if (f.state !== 'attack' || !f.moveId) return null;
  if (f.moveId === 'shoot') return SHOOT_MOVE;
  return getChar(f.charId).moves[f.moveId] ?? null;
}

function airborne(f: Fighter): boolean {
  return f.y > 0.01 || f.vy > 0;
}

function stepFighter(w: World, f: Fighter, inp: number, acting: boolean): void {
  const c = getChar(f.charId);
  if (f.invuln > 0) f.invuln--;
  if (f.comboTimer > 0) { f.comboTimer--; if (f.comboTimer === 0) { f.comboHits = 0; f.comboDamage = 0; } }
  if (f.bufferTimer > 0) { f.bufferTimer--; if (f.bufferTimer === 0) f.bufferedInput = 0; }
  if (f.tapTimer > 0) f.tapTimer--;
  if (f.state !== 'guard' && f.state !== 'block') f.guardFrames = Math.min(99, f.guardFrames + 1);
  // régénération de garde / ki
  if (f.state !== 'block' && f.guardMeter < C.GUARD_MAX) f.guardMeter = Math.min(C.GUARD_MAX, f.guardMeter + (hasBonus(f, 'guard') ? 0.5 : 0.25));
  if (hasBonus(f, 'kiflow') && f.ki < C.KI_MAX) f.ki = Math.min(C.KI_MAX, f.ki + 0.08 * stacks(f.bonuses, 'kiflow'));

  // statuts
  if (f.status.burn > 0 && f.state !== 'ko') {
    f.status.burn--;
    if (f.status.burn % 20 === 0) {
      damageRaw(w, f, f.status.burnDps, -1);
      w.events.push({ t: 'text', x: f.x, y: f.y + 110, z: f.z, text: `-${f.status.burnDps}`, color: '#ff8a3d' });
    }
  }

  if (f.status.slow > 0) f.status.slow--;
  if (f.status.wet > 0) f.status.wet--;
  if (w.stage?.theme === 'abyss' && f.state !== 'ko') f.status.wet = Math.max(f.status.wet, 60); // sous l'eau, tout le monde est trempé
  if (f.form > 0 && f.state !== 'ko') {
    f.form--;
    if (f.form === 0) endTransform(w, f);
    else if (f.ki < C.KI_MAX && w.frame % 12 === 0) f.ki = Math.min(C.KI_MAX, f.ki + 1);
  }
  if (f.status.poison > 0 && f.state !== 'ko') {
    f.status.poison--;
    if (f.status.poison % 15 === 0) {
      damageRaw(w, f, 2, -1);
      w.events.push({ t: 'text', x: f.x, y: f.y + 105, z: f.z, text: '-2', color: '#ff5f5f' });
    }
  }

  // historique des directions (commandes de combat)
  pushHistory(f, dirMaskOf(inp, f.facing), w.frame);
  if (f.gunCd > 0 && f.state !== 'attack') f.gunCd--;

  if (f.freeze > 0) {
    f.freeze--;
    return;
  }

  const pressed = inp & ~f.prevInput;
  // mémoire tampon des attaques (9 frames) : rend les enchaînements tolérants
  const attackBits = IN.LIGHT | IN.HEAVY | IN.SPECIAL | IN.SUPER | IN.JUMP;
  if (pressed & (IN.LIGHT | IN.HEAVY)) {
    if (w.frame - f.cmbFrame > 40) f.cmb = '';
    f.cmb = (f.cmb + (pressed & IN.LIGHT ? 'P' : '') + (pressed & IN.HEAVY ? 'K' : '')).slice(-4);
    f.cmbFrame = w.frame;
  }
  if (pressed & attackBits) {
    f.bufferedInput |= pressed & attackBits;
    f.bufferTimer = C.BUFFER_FRAMES;
  }
  const dirX = (inp & IN.RIGHT ? 1 : 0) - (inp & IN.LEFT ? 1 : 0);
  const dirZ = (inp & IN.DOWN ? 1 : 0) - (inp & IN.UP ? 1 : 0);

  f.stateFrame++;

  // intégrité des prises : si l'un des deux est touché ou disparaît, la prise est relâchée
  if (f.holding >= 0 && f.state !== 'hold') releaseHold(w, f);
  if (f.heldBy >= 0 && f.state !== 'held') { f.heldBy = -1; f.holdMode = 0; }
  if (f.carry && (f.state === 'hit' || f.state === 'launch' || f.state === 'stagger' || f.state === 'ko' || f.state === 'down' || f.state === 'frozen' || f.state === 'dodge')) dropCarry(w, f);
  switch (f.state) {
    case 'ko':
      f.koTimer++;
      physics(w, f);
      if (f.y <= 0) { f.vx *= 0.8; }
      // réanimation payante : le joueur KO appuie sur Attaque (pièces communes)
      if (w.mode !== 'duel' && w.mode !== 'training' && f.team === 0 && f.controller === 'player' && f.koTimer > 36 && (pressed & IN.LIGHT)) {
        if (w.coins >= C.REVIVE_COST) {
          w.coins -= C.REVIVE_COST;
          f.koTimer = 0;
          f.revive = 0;
          f.hp = Math.round(f.hpMax * 0.5);
          f.invuln = 90;
          f.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
          setState(f, 'getup');
          w.events.push({ t: 'text', x: f.x, y: 130, z: f.z, text: `RÉANIMÉ (−${C.REVIVE_COST} 🪙)`, color: '#7cff9a' });
          w.events.push({ t: 'sound', id: 'revive' });
          return;
        }
        w.events.push({ t: 'sound', id: 'deny' });
      }
      // réanimation coop : un allié proche maintient LIGHT
      if (w.mode !== 'duel') {
        const ally = w.fighters.find((a) => a !== f && a.team === f.team && alive(a) && Math.abs(a.x - f.x) < 60 && Math.abs(a.z - f.z) < 40 && (a.prevInput & IN.LIGHT) && (a.state === 'idle' || a.state === 'walk' || a.state === 'revive'));
        if (ally && f.koTimer < C.KO_REVIVABLE + 60) {
          f.revive += 1;
          if (ally.state !== 'revive') setState(ally, 'revive');
          ally.stateFrame = 0;
          if (f.revive >= C.REVIVE_FRAMES) {
            f.revive = 0;
            f.koTimer = 0;
            f.hp = Math.round(f.hpMax * 0.5);
            f.invuln = 90;
            f.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
            setState(f, 'getup');
            setState(ally, 'idle');
            w.events.push({ t: 'text', x: f.x, y: 120, z: f.z, text: 'RÉANIMÉ !', color: '#7cff9a' });
            w.events.push({ t: 'sound', id: 'revive' });
          }
        } else if (f.revive > 0) f.revive = Math.max(0, f.revive - 2);
      }
      return;
    case 'revive':
      if (!(inp & IN.LIGHT) || f.stateFrame > 3) setState(f, 'idle');
      return;
    case 'hold': {
      const v = w.fighters.find((o) => o.id === f.holding);
      if (!v || v.heldBy !== f.id || !alive(v) || v.state !== 'held') { releaseHold(w, f); return; }
      f.holdFrames++;
      v.holdMode = f.holdMode;
      v.x = q(f.x + f.facing * ((f.holdMode & 1) === 1 ? 22 : 30));
      v.z = f.z; v.vx = 0; v.vy = 0; v.y = 0;
      v.facing = (-f.facing) as 1 | -1;
      f.vx = 0;
      // modes : 0 debout · 1 au sol · +2 = étranglement (tant que Garde est maintenu)
      const mounted = (f.holdMode & 1) === 1;
      const choke = (inp & IN.GUARD) !== 0;
      if (choke && f.holdMode < 2) { f.holdMode |= 2; w.events.push({ t: 'text', x: v.x, y: 135, z: v.z, text: 'ÉTRANGLEMENT', color: '#ff6b6b' }); }
      else if (!choke && f.holdMode >= 2) f.holdMode &= 1;
      if (f.holdMode >= 2 && f.holdFrames % 8 === 0) {
        damageRaw(w, v, Math.max(1, Math.round(2 * f.stats.power)), f.id);
        w.events.push({ t: 'hit', x: v.x, y: v.y + 70, z: v.z, power: 0.35, blocked: false, crit: false, dir: f.facing, attacker: f.id, target: v.id });
        if (v.hp <= 0) { knockOut(w, v, f, f.facing, null); releaseHold(w, f); return; }
      }
      if (pressed & IN.LIGHT) {
        // frappe pendant la prise
        damageRaw(w, v, Math.max(1, Math.round(5 * f.stats.power / v.stats.defense)), f.id);
        f.comboHits++; f.comboTimer = C.COMBO_RESET;
        f.superMeter = Math.min(C.SUPER_MAX, f.superMeter + 3);
        v.holdFrames = Math.max(0, v.holdFrames - 4);
        w.events.push({ t: 'hit', x: v.x, y: v.y + 70, z: v.z, power: 0.7, blocked: false, crit: false, dir: f.facing, attacker: f.id, target: v.id });
        w.events.push({ t: 'sound', id: 'hit', x: v.x });
        f.freeze = 3; v.freeze = 3;
        if (v.hp <= 0) { knockOut(w, v, f, f.facing, null); releaseHold(w, f); return; }
      } else if (pressed & IN.HEAVY) {
        if (mounted) throwHeld(w, f, v, f.facing * 6, 4, 14); // pousse hors de la prise au sol
        else if (dirX !== 0 && dirX === f.facing) throwHeld(w, f, v, f.facing * 9.5, 7, 16); // projection devant
        else if (dirX !== 0) throwHeld(w, f, v, -f.facing * 9.5, 8, 16); // projection par-dessus l'épaule
        else throwHeld(w, f, v, f.facing * 2, 3, 22); // écrasement
        return;
      } else if (pressed & IN.JUMP) { releaseHold(w, f, f.facing * 3); return; }
      if (f.holdFrames > 260) releaseHold(w, f, f.facing * 3);
      return;
    }
    case 'held': {
      const a = w.fighters.find((o) => o.id === f.heldBy);
      if (!a || a.holding !== f.id) { f.heldBy = -1; setState(f, 'idle'); return; }
      // se débattre : marteler les boutons ; l'étranglement est plus dur à briser
      if (pressed & (IN.LIGHT | IN.HEAVY | IN.JUMP | IN.GUARD | IN.LEFT | IN.RIGHT | IN.UP | IN.DOWN)) f.holdFrames += f.controller === 'player' ? 9 : 5;
      else if (f.controller === 'ai' && rand(w) < 0.05) f.holdFrames += 9;
      f.holdFrames = Math.max(0, f.holdFrames - 0.3);
      if (f.holdFrames >= (a.holdMode >= 2 ? 95 : 70) + (getChar(a.charId).passive === 'titan' ? 30 : 0)) {
        w.events.push({ t: 'text', x: f.x, y: 135, z: f.z, text: 'ÉCHAPPÉ !', color: '#7cff9a' });
        w.events.push({ t: 'sound', id: 'parry', x: f.x });
        releaseHold(w, a, -a.facing * 5);
        a.freeze = 5;
      }
      return;
    }
    case 'charge': {
      // recharge du ki : on reste immobile, vulnérable, tant que Ki (ou Garde + Ki) est maintenu
      const keep = (inp & IN.SPECIAL) !== 0 && !dirX && !dirZ && airborne(f) === false;
      if (!keep || (pressed & (IN.LIGHT | IN.HEAVY | IN.JUMP))) { f.kiCharge = 0; setState(f, 'idle'); return; }
      f.kiCharge++;
      f.vx *= 0.7;
      f.ki = Math.min(C.KI_MAX, f.ki + (f.form > 0 ? 1.4 : 0.95));
      if (f.kiCharge % 30 === 0) w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y + 50, z: f.z, kind: 'charge' });
      if (f.ki >= C.KI_MAX && f.form === 0 && f.kiCharge >= 20 && FORMS[f.charId]) { f.kiCharge = 0; startMove(w, f, 'transform'); return; }
      physics(w, f);
      return;
    }
    case 'win':
      physics(w, f);
      return;
    case 'frozen':
      if (--f.status.frozen <= 0) setState(f, 'idle');
      physics(w, f);
      return;
    case 'down':
      physics(w, f);
      if (f.stateFrame >= C.DOWN_FRAMES) {
        setState(f, 'getup');
        f.invuln = C.GETUP_FRAMES + 6;
      }
      return;
    case 'getup':
      if (f.stateFrame >= C.GETUP_FRAMES) setState(f, 'idle');
      return;
    case 'stagger':
      physics(w, f);
      if (f.stateFrame >= 34) setState(f, 'idle');
      return;
    case 'parry':
      if (f.stateFrame >= 2 && tryAttack(w, f, c, inp, dirX, dirZ)) return;
      if (f.stateFrame >= 14) setState(f, 'idle');
      return;
    case 'hit':
      physics(w, f);
      if (f.stateFrame >= f.hitFrames) setState(f, 'idle');
      return;
    case 'launch':
      physics(w, f);
      if (f.y <= 0 && f.vy <= 0) {
        f.y = 0;
        f.vy = 0;
        setState(f, 'down');
        w.events.push({ t: 'sound', id: 'land' });
      }
      return;
    case 'block':
      physics(w, f);
      if (f.stateFrame >= f.hitFrames) setState(f, inp & IN.GUARD ? 'guard' : 'idle');
      return;
    case 'dodge': {
      const total = hasBonus(f, 'speed') ? C.DODGE_FRAMES + 4 : C.DODGE_FRAMES;
      if (f.stateFrame >= C.DODGE_INVULN[0] && f.stateFrame <= C.DODGE_INVULN[1]) f.invuln = Math.max(f.invuln, 1);
      physics(w, f);
      if (f.stateFrame >= total) setState(f, 'idle');
      return;
    }
    case 'attack':
      stepAttack(w, f, c, inp, dirX, dirZ);
      return;
    default:
      break;
  }

  // ---- états libres : idle / walk / run / jump / guard ----
  const onGround = !airborne(f);
  if (onGround && f.state === 'jump') {
    setState(f, 'idle');
    if (f.airJumps >= 2 && hasBonus(f, 'doublejump')) spawnShock(w, f, 0, 60, 10);
    f.airJumps = 0;
  }

  // recharge de ki : Ki maintenu sans assez de ki pour un spécial, ou Garde + Ki
  if (onGround && (inp & IN.SPECIAL) && dirX === 0 && dirZ === 0 && (f.state === 'idle' || f.state === 'walk' || f.state === 'guard') && f.ki < C.KI_MAX && ((inp & IN.GUARD) || f.ki < C.SPECIAL_KI) && !f.bufferedInput) {
    f.kiCharge = 0;
    setState(f, 'charge');
    w.events.push({ t: 'sound', id: 'charge', x: f.x });
    return;
  }

  // garde / esquive
  if (onGround && (inp & IN.GUARD) && f.state !== 'jump') {
    if (pressed & IN.GUARD) f.guardFrames = 0;
    // esquive : garde + direction (appui direction ou garde récent)
    const wantDodge = (dirX !== 0 || dirZ !== 0) && ((pressed & IN.GUARD) || (pressed & (IN.LEFT | IN.RIGHT | IN.UP | IN.DOWN)));
    if (wantDodge && f.state !== 'guard' || (wantDodge && f.state === 'guard' && f.stateFrame < 3)) {
      setState(f, 'dodge');
      f.vx = dirX * 7.5 * f.stats.speed;
      f.vz = dirZ * 4.5;
      if (dirX !== 0) f.facing = dirX as 1 | -1;
      f.invuln = 1;
      w.events.push({ t: 'sound', id: 'dodge' });
      return;
    }
    if (f.state !== 'guard') { setState(f, 'guard'); f.guardFrames = 0; }
    else f.guardFrames++;
    f.lowGuard = (inp & IN.DOWN) !== 0;
    // la garde suit l'ennemi le plus proche
    const near = nearestEnemy(w, f);
    if (near) f.facing = near.x >= f.x ? 1 : -1;
    f.vx *= 0.6;
    f.vz = 0;
    physics(w, f);
    return;
  } else if (f.state === 'guard') {
    setState(f, 'idle');
  }

  // attaques
  if (tryAttack(w, f, c, inp, dirX, dirZ)) return;

  // charge du coup lourd (maintien)
  if (onGround && (inp & IN.HEAVY) && dirX === 0 && dirZ === 0 && f.state !== 'run') {
    f.heavyCharge = Math.min(45, f.heavyCharge + 1);
  }

  // saut
  if ((pressed & IN.JUMP || (f.bufferedInput & IN.JUMP && onGround)) && (onGround || (f.airJumps < 2 && hasBonus(f, 'doublejump') && f.airJumps >= 1))) {
    f.bufferedInput &= ~IN.JUMP;
    f.vy = C.JUMP_V * f.stats.jump * jumpMul(w);
    f.airJumps++;
    if (f.state === 'run') f.vx = f.facing * C.RUN * f.stats.speed;
    setState(f, 'jump');
    f.y = Math.max(f.y, 0.1);
    w.events.push({ t: 'sound', id: 'jump' });
    if (dirX !== 0) f.facing = dirX as 1 | -1;
    physics(w, f);
    return;
  }

  // déplacement
  if (onGround) {
    // course : double appui ou bouton DASH
    if (pressed & (IN.LEFT | IN.RIGHT)) {
      const d = pressed & IN.RIGHT ? 1 : -1;
      if (f.tapTimer > 0 && f.tapDir === d) f.runFrames = 1;
      f.tapTimer = 14;
      f.tapDir = d;
    }
    const running = dirX !== 0 && ((inp & IN.DASH) !== 0 || (f.runFrames > 0 && dirX === f.tapDir));
    if (!running) f.runFrames = 0;
    if (dirX !== 0 || dirZ !== 0) {
      let faceDir: number = f.facing;
      if (dirX !== 0) {
        if (running || dirX === f.facing) { faceDir = dirX; f.backHold = 0; }
        else {
          f.backHold++;
          const foe = nearestEnemy(w, f);
          const foeAhead = !!foe && Math.abs(foe.x - f.x) < 170 && sign(foe.x - f.x) === f.facing;
          if (!(foeAhead && f.backHold <= 16)) faceDir = dirX;
        }
      } else f.backHold = 0;
      const pedal = dirX !== 0 && faceDir !== dirX;
      const spd = (running ? C.RUN : C.WALK) * f.stats.speed * (f.status.slow > 0 ? 0.55 : 1) * (f.carry ? 0.8 : 1) * (pedal ? 0.78 : 1);
      f.vx = dirX * spd;
      f.vz = dirZ * C.ZSPEED * (running ? 1.3 : 1);
      f.facing = faceDir as 1 | -1;
      setStateKeep(f, running ? 'run' : 'walk');
      if (running) f.runFrames++;
    } else {
      f.vx *= C.FRICTION;
      f.vz = 0;
      setStateKeep(f, 'idle');
    }
  } else {
    // nage / vol : maintenir Saut pousse vers le haut quand la gravité est faible
    if (w.grav < 0.5 && (inp & IN.JUMP)) f.vy = Math.min(f.vy + 0.5, 5.5);
    const asp = f.stats.speed * (f.status.slow > 0 ? 0.55 : 1);
    f.vx += dirX * C.AIR_CONTROL * asp;
    f.vx = clamp(f.vx, -C.RUN * asp, C.RUN * asp);
    f.vz = dirZ * C.ZSPEED * 0.7;
  }
  physics(w, f);
}

function setStateKeep(f: Fighter, s: FState): void {
  if (f.state !== s) setState(f, s);
}

function nearestEnemy(w: World, f: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bd = Infinity;
  for (const o of w.fighters) {
    if (o === f || o.team === f.team || !alive(o)) continue;
    const d = Math.abs(o.x - f.x) + Math.abs(o.z - f.z) * 0.5;
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Déclenche une attaque si une entrée (tampon compris) le demande.
/** Finisseur façon Budokai : P/K enchaînés puis E (Spécial). Retourne l'identifiant du coup, ou null. */
const FINISHERS: Record<string, string> = { PPP: 'c_cmb_rafale', KKK: 'c_cmb_tempete', PKP: 'c_cmb_briseur', PPK: 'c_cmb_seisme', KPK: 'c_cmb_spirale', PKK: 'c_cmb_dragon', KKP: 'c_cmb_ecrase', KPP: 'c_cmb_eclair' };
function comboFinisher(w: World, f: Fighter, c: CharDef): string | null {
  if (w.frame - f.cmbFrame > 40 || f.cmb.length < 3) return null;
  const id = FINISHERS[f.cmb.slice(-3)];
  const m = id ? c.moves[id] : null;
  if (!m || f.ki < (m.kiCost ?? 0)) return null;
  return id;
}

function tryAttack(w: World, f: Fighter, c: CharDef, inp: number, dirX: number, dirZ: number): boolean {
  const buf = f.bufferedInput;
  const onGround = !airborne(f);
  const running = f.state === 'run' && f.runFrames > 3;
  let moveId: string | null = null;
  const fwd = dirX !== 0 && dirX === f.facing;
  const back = dirX !== 0 && dirX === -f.facing;
  const down = dirZ > 0 || (inp & IN.DOWN) !== 0;

  if (buf & IN.SUPER) {
    if (f.superMeter >= C.SUPER_MAX && onGround) moveId = c.superMove;
    f.bufferedInput &= ~IN.SUPER;
    if (!moveId) w.events.push({ t: 'sound', id: 'deny' });
  }
  // porter une caisse (Attaque + Lourd à côté) puis la lancer (Attaque ou Lourd)
  if (onGround && f.carry === '' && (buf & IN.LIGHT) && (buf & IN.HEAVY)) {
    const it = crateNear(w, f);
    if (it && w.frame >= f.nextMoveFrame) {
      w.items = w.items.filter((x) => x !== it);
      f.carry = it.cv ?? 'wood';
      f.bufferedInput &= ~(IN.LIGHT | IN.HEAVY);
      w.events.push({ t: 'text', x: f.x, y: f.y + 140, z: f.z, text: 'Caisse en main', color: '#ffd166' });
      w.events.push({ t: 'sound', id: 'weapon', x: f.x });
      return true;
    }
  }
  if (f.carry !== '' && (buf & (IN.LIGHT | IN.HEAVY)) && w.frame >= f.nextMoveFrame) {
    throwCrate(w, f);
    f.bufferedInput &= ~(IN.LIGHT | IN.HEAVY);
    return true;
  }
  // commandes de combat (quarts de cercle, DP, saisies…)
  if (!moveId) {
    const gunHeld = f.weapon > 0 && !!f.weaponKind && WEAPONS[f.weaponKind].gun;
    const cmd = readCommand(f, { buf, inp, now: w.frame, onGround, ki: f.ki, superMeter: f.superMeter, chainIndex: gunHeld ? 99 : f.chainIndex, running });
    if (cmd && c.moves[cmd]) {
      f.bufferedInput &= ~(IN.LIGHT | IN.HEAVY);
      f.heavyCharge = 0;
      if (w.frame >= f.nextMoveFrame) { startMove(w, f, cmd); return true; }
    }
  }
  // arme à feu : Attaque = tir
  if (!moveId && f.weapon > 0 && f.weaponKind && WEAPONS[f.weaponKind].gun && onGround && ((buf & IN.LIGHT) || (inp & IN.LIGHT)) && f.gunCd <= 0) {
    f.bufferedInput &= ~IN.LIGHT;
    startShoot(w, f);
    return true;
  }
  if (!moveId && buf & IN.SPECIAL && onGround) {
    const fin = comboFinisher(w, f, c);
    if (fin && w.frame >= f.nextMoveFrame) { f.bufferedInput &= ~IN.SPECIAL; f.cmb = ''; startMove(w, f, fin); return true; }
  }
  if (!moveId && buf & IN.SPECIAL && !(inp & IN.GUARD)) {
    // raccourci manette / tactile : Spécial + direction = commande
    let id = down ? c.special2 : c.special;
    if (!down && fwd) id = 'c_fire';
    else if (!down && back) id = 'c_tatsu';
    else if (!down && (inp & IN.UP)) id = 'c_dp';
    const m = c.moves[id];
    if (onGround && f.ki >= (m.kiCost ?? C.SPECIAL_KI)) moveId = id;
    else if (f.controller === 'player') w.events.push({ t: 'sound', id: 'deny' });
    f.bufferedInput &= ~IN.SPECIAL;
  }
  // arme tenue : lourd = lancer l'arme
  if (!moveId && f.weapon > 0 && f.weaponKind && WEAPONS[f.weaponKind].throwable && (buf & IN.HEAVY) && onGround && !(fwd || back || down)) {
    f.bufferedInput &= ~IN.HEAVY;
    f.heavyCharge = 0;
    throwWeapon(w, f);
    return true;
  }
  // coup lourd : déclenché au relâchement (charge) ou immédiatement avec direction / en l'air
  const heavyReleased = f.heavyCharge > 0 && !(inp & IN.HEAVY);
  if (!moveId && (heavyReleased || (buf & IN.HEAVY && (fwd || back || down || !onGround || running)))) {
    if (!onGround) moveId = c.airHeavy;
    else if (running) moveId = c.run;
    else if (fwd) moveId = c.launcher;
    else if (back || down) moveId = c.low;
    else moveId = c.heavy;
    f.bufferedInput &= ~IN.HEAVY;
  }
  if (!moveId && buf & IN.LIGHT) {
    if (!onGround) moveId = c.air;
    else if (running) moveId = c.run;
    else moveId = c.lightChain[0];
    f.bufferedInput &= ~IN.LIGHT;
  }
  if (!moveId) return false;
  if (w.frame < f.nextMoveFrame) return false;
  startMove(w, f, moveId);
  return true;
}

function crateNear(w: World, f: Fighter): Item | null {
  let best: Item | null = null;
  let bd = Infinity;
  for (const it of w.items) {
    if (it.kind !== 'crate') continue;
    const dx = Math.abs(it.x - f.x), dz = Math.abs(it.z - f.z);
    if (dx > 64 || dz > 40) continue;
    const d = dx + dz;
    if (d < bd) { bd = d; best = it; }
  }
  return best;
}

function throwCrate(w: World, f: Fighter): void {
  const cv = f.carry;
  f.carry = '';
  setState(f, 'attack');
  f.moveId = 'heavy';
  f.stateFrame = 0;
  f.moveHits = [-1];
  w.projectiles.push({ id: w.nextId++, kind: 'crate', x: f.x + f.facing * 18, y: f.y + 110, z: f.z, vx: f.facing * 9.5, vy: 3.2, owner: f.id, team: f.team, damage: Math.round(24 * f.stats.power), life: 90, radius: 24, pierce: false, hits: [], gravity: 0.32, homing: 0, cv });
  w.events.push({ t: 'sound', id: 'throw', x: f.x });
}

/** Une caisse portée tombe quand on est touché. */
function dropCarry(w: World, f: Fighter): void {
  if (!f.carry) return;
  w.items.push({ id: w.nextId++, kind: 'crate', cv: f.carry, x: f.x, y: 20, z: f.z, vy: 3, vx: f.facing * -1.5, life: 99999, hp: f.carry === 'metal' ? 4 : 2 });
  f.carry = '';
}

function startHold(w: World, a: Fighter, t: Fighter, mode: number): void {
  a.holding = t.id; t.heldBy = a.id;
  a.holdFrames = 0; t.holdFrames = 0;
  a.holdMode = mode; t.holdMode = mode;
  setState(a, 'hold');
  setState(t, 'held');
  a.freeze = 0; t.freeze = 0;
  t.vx = 0; t.vy = 0; t.vz = 0; t.y = 0;
  w.events.push({ t: 'text', x: t.x, y: 140, z: t.z, text: mode === 1 ? 'AU SOL !' : 'SAISI !', color: '#ffd166' });
  w.events.push({ t: 'sound', id: 'counter', x: t.x });
}

/** Relâche la prise : le tenant et le tenu repartent libres (le tenu est repoussé de `push`). */
function releaseHold(w: World, a: Fighter, push = 0): void {
  const v = w.fighters.find((o) => o.id === a.holding);
  a.holding = -1;
  a.holdMode = 0;
  a.holdFrames = 0;
  if (a.state === 'hold') setState(a, 'idle');
  a.nextMoveFrame = w.frame + 12;
  if (v) {
    v.heldBy = -1;
    v.holdMode = 0;
    v.holdFrames = 0;
    if (v.state === 'held') { setState(v, 'idle'); v.vx = push; v.invuln = Math.max(v.invuln, 12); }
  }
}

/** Fin de prise par une projection : le tenu part en l'air (ragdoll). */
type Elem = 'none' | 'fire' | 'ice' | 'shock' | 'poison';

/** Élément principal d'un coup : projectile, effet du coup, arme, forme, passive du héros. */
function elementOf(a: Fighter, m: MoveDef, proj: Projectile | undefined, mw: ReturnType<typeof meleeOf>): Elem {
  if (proj) {
    if (proj.kind === 'fire') return 'fire';
    if (proj.kind === 'ice') return 'ice';
    if (proj.kind === 'bolt') return 'shock';
    if (proj.kind === 'poison') return 'poison';
  }
  if (m.burnTarget) return 'fire';
  if (m.freezeTarget || m.slowTarget) return 'ice';
  if (m.poisonTarget) return 'poison';
  if (mw?.fx === 'reflect') return 'fire';
  if (a.form > 0) { const e = FORMS[a.charId]?.elem; if (e && e !== 'none') return e; }
  const pa = getChar(a.charId).passive;
  return pa === 'ember' ? 'fire' : pa === 'chill' ? 'ice' : pa === 'ambush' ? 'poison' : 'none';
}

/** Applique la réaction et renvoie le multiplicateur de dégâts. */
function elementReaction(w: World, a: Fighter, t: Fighter, elem: Elem, dir: number): number {
  const st = t.status;
  const say = (text: string, color: string) => w.events.push({ t: 'text', x: t.x, y: t.y + 150, z: t.z, text, color });
  if (elem === 'fire') {
    if (st.slow > 0 || st.frozen > 0 || t.state === 'frozen') {
      st.slow = 0; st.frozen = 0; st.wet = 150;
      if (t.state === 'frozen') setState(t, 'idle');
      say('FONTE !', '#ff9a5a');
      return 1.35;
    }
    if (st.poison > 0) {
      st.poison = 0;
      say('EXPLOSION TOXIQUE !', '#b6ff4a');
      w.events.push({ t: 'boom', x: t.x, y: t.y + 40, z: t.z, elem: 'poison', r: 90 });
      for (const o of w.fighters) if (o !== t && o.team !== a.team && alive(o) && Math.abs(o.x - t.x) < 90 && Math.abs(o.z - t.z) < 50) { damageRaw(w, o, Math.max(1, Math.round(12 * a.stats.power)), a.id); o.status.poison = Math.max(o.status.poison, 90); }
      return 1.2;
    }
    if (st.wet > 0) { st.wet = 0; say('VAPEUR', '#dfe9f2'); return 0.85; }
  } else if (elem === 'ice') {
    if (st.burn > 0) { st.burn = 0; st.slow = Math.max(st.slow, 120); say('VAPEUR !', '#dfe9f2'); return 1.25; }
    if (st.wet > 0) {
      st.wet = 0; st.frozen = 70;
      if (t.y <= 0 && t.state !== 'launch' && t.state !== 'down' && t.state !== 'ko') setState(t, 'frozen');
      say('GEL TOTAL !', '#9ff');
      return 1.2;
    }
  } else if (elem === 'shock') {
    if (st.wet > 0) {
      st.wet = 0;
      say('ÉLECTROCUTION !', '#ffe14d');
      w.events.push({ t: 'boom', x: t.x, y: t.y + 50, z: t.z, elem: 'shock', r: 70 });
      t.hitFrames = Math.max(t.hitFrames, 0) + 25;
      w.slowmo = Math.max(w.slowmo, 8);
      return 1.8;
    }
  } else if (elem === 'poison') {
    if (st.burn > 0) { say('MIASME !', '#9f6'); st.slow = Math.max(st.slow, 100); return 1.15; }
  }
  void dir;
  return 1;
}

function throwHeld(w: World, a: Fighter, v: Fighter, vx: number, vy: number, dmg: number): void {
  const wasMount = (a.holdMode & 1) === 1;
  if (getChar(a.charId).passive === 'titan') dmg = Math.round(dmg * 1.5);
  releaseHold(w, a);
  damageRaw(w, v, Math.max(1, Math.round(dmg * a.stats.power / v.stats.defense)), a.id);
  w.events.push({ t: 'hit', x: v.x, y: v.y + 60, z: v.z, power: 1.2, blocked: false, crit: false, dir: sign(vx) || a.facing, attacker: a.id, target: v.id });
  w.events.push({ t: 'sound', id: 'hitheavy', x: v.x });
  w.events.push({ t: 'shake', power: 4 });
  a.freeze = 6; v.freeze = 6;
  a.comboHits++; a.comboTimer = C.COMBO_RESET;
  a.superMeter = Math.min(C.SUPER_MAX, a.superMeter + 10);
  if (v.hp <= 0) { knockOut(w, v, a, sign(vx) || a.facing, null); return; }
  setState(v, 'launch');
  v.vx = vx; v.vy = vy; v.y = 0.1;
  v.lastHitBy = a.id;
  if (wasMount) a.nextMoveFrame = w.frame + 8;
}

/** Vitesse de saut : plus haut quand la gravité baisse, sans partir dans l'espace. */
function jumpMul(w: World): number {
  return w.grav >= 1 ? 1 : Math.sqrt(w.grav * (1 + (1 - w.grav) * 2.6));
}

function startShoot(w: World, f: Fighter): void {
  const wk = f.weaponKind as WeaponKind;
  const ak = wk === 'ak';
  if (wk === 'shotgun') {
    setState(f, 'attack');
    f.moveId = 'shoot';
    f.moveHits = [-1];
    f.weapon--;
    f.gunCd = 30;
    const near = nearestEnemy(w, f);
    const pointBlank = !!near && Math.abs(near.x - f.x) < 95 && Math.abs(near.z - f.z) < 40;
    for (let i = 0; i < 5; i++) {
      const sp = (rand(w) - 0.5) * 1.6;
      w.projectiles.push({ id: w.nextId++, kind: 'slug', x: f.x + f.facing * 34, y: f.y + 62, z: f.z + (i - 2) * 3, vx: f.facing * (14 + rand(w) * 3), vy: sp, owner: f.id, team: f.team, damage: Math.max(1, Math.round((pointBlank ? 11 : 6) * f.stats.power)), life: 17, radius: 6, pierce: false, hits: [], gravity: 0, homing: 0, wk: 'shotgun' });
    }
    f.vx -= f.facing * 2.6;
    w.events.push({ t: 'special', id: f.id, x: f.x + f.facing * 36, y: f.y + 62, z: f.z, kind: 'muzzle' });
    w.events.push({ t: 'sound', id: 'ak', x: f.x });
    w.events.push({ t: 'shake', power: 2 });
    if (f.weapon <= 0) { f.weaponKind = ''; w.events.push({ t: 'text', x: f.x, y: f.y + 125, z: f.z, text: 'PLUS DE CARTOUCHES', color: '#ccc' }); }
    return;
  }
  setState(f, 'attack');
  f.moveId = 'shoot';
  f.moveHits = [-1];
  f.weapon--;
  f.gunCd = ak ? 4 : 13;
  const spread = ak ? (rand(w) - 0.5) * 0.9 : 0;
  w.projectiles.push({ id: w.nextId++, kind: 'slug', x: f.x + f.facing * 36, y: f.y + 62, z: f.z, vx: f.facing * (ak ? 17 : 19), vy: spread, owner: f.id, team: f.team, damage: Math.max(1, Math.round((ak ? 4 : 11) * f.stats.power)), life: ak ? 34 : 40, radius: 6, pierce: false, hits: [], gravity: 0, homing: 0, wk });
  f.vx -= f.facing * (ak ? 0.5 : 1.2);
  w.events.push({ t: 'special', id: f.id, x: f.x + f.facing * 36, y: f.y + 62, z: f.z, kind: 'muzzle' });
  w.events.push({ t: 'sound', id: ak ? 'ak' : 'pistol', x: f.x });
  if (f.weapon <= 0) {
    f.weaponKind = '';
    w.events.push({ t: 'text', x: f.x, y: f.y + 125, z: f.z, text: 'PLUS DE BALLES', color: '#ccc' });
  }
}

function throwWeapon(w: World, f: Fighter): void {
  const wk = (f.weaponKind || 'bat') as WeaponKind;
  const uses = f.weapon;
  f.weapon = 0;
  f.weaponKind = '';
  setState(f, 'attack');
  f.moveId = 'heavy';
  f.stateFrame = 0;
  f.moveHits = [-1]; // pas de boîte de coup : le projectile fait le travail
  const wd = WEAPONS[wk];
  const dmg = wd.gun ? 14 : 12 + wd.dmg * 5;
  w.projectiles.push({ id: w.nextId++, kind: 'bat', x: f.x + f.facing * 20, y: f.y + 62, z: f.z, vx: f.facing * 12, vy: 3.2, owner: f.id, team: f.team, damage: Math.round(dmg * f.stats.power), life: 70, radius: 16, pierce: false, hits: [], gravity: 0.3, homing: 0, wk, uses });
  w.events.push({ t: 'sound', id: 'throw', x: f.x });
}

function startMove(w: World, f: Fighter, moveId: string): void {
  const c = getChar(f.charId);
  const m = c.moves[moveId];
  if (!m) return;
  const charged = moveId === c.heavy ? f.heavyCharge : 0;
  f.heavyCharge = 0;
  if (moveId === 'transform') startTransform(w, f);
  if (m.kiCost) f.ki = Math.max(0, f.ki - m.kiCost);
  if (m.superCost) f.superMeter = m.superCost >= C.SUPER_MAX ? 0 : Math.max(0, f.superMeter - m.superCost);
  setState(f, 'attack');
  f.moveId = moveId;
  f.moveHits = [];
  f.multiLeft = m.multi ? m.multi.hits - 1 : 0;
  f.armor = !!m.armor || (charged >= 30) || (hasBonus(f, 'armor') && (m.kind === 'heavy' || m.kind === 'launcher'));
  f.chargeBonus = charged;
  if (m.invuln) f.invuln = Math.max(f.invuln, m.startup + 2);
  if (m.kind === 'light') { const ci = c.lightChain.indexOf(moveId); f.chainIndex = ci >= 0 ? ci + 1 : moveId === 'c_side' ? 1 : 3; }
  if (moveId.startsWith('c_')) {
    f.lastCmd = m.name;
    f.lastCmdFrame = w.frame;
    w.events.push({ t: 'cmd', id: f.id, name: m.name, x: f.x, y: f.y + 150, z: f.z });
  }
  // téléportation derrière la cible
  if (m.teleport) {
    const t = nearestEnemy(w, f);
    if (t && Math.abs(t.x - f.x) < 420) {
      f.x = q(t.x + (t.facing * 1) * m.teleport * 0.9);
      f.z = t.z;
      f.y = t.y;
      f.facing = t.x >= f.x ? 1 : -1;
      f.invuln = Math.max(f.invuln, m.startup + 4);
      w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y, z: f.z, kind: 'teleport' });
    }
  }
  // chorégraphie : se tourne vers l'adversaire proche, s'aligne sur sa ligne et avance pour que le coup porte
  if (!m.teleport && f.y <= 0 && m.kind !== 'super') {
    const t = nearestEnemy(w, f);
    if (t) {
      const dx = t.x - f.x, ad = Math.abs(dx);
      if (ad < 190 && Math.abs(t.z - f.z) < 70 && !(m.id === 'shoot')) {
        f.facing = dx >= 0 ? 1 : -1;
        f.z = q(clamp(f.z + clamp(t.z - f.z, -10, 10), C.Z_MIN, C.Z_MAX));
        const melee = m.kind === 'light' || m.kind === 'heavy' || m.kind === 'launcher' || m.kind === 'low';
        const gap = ad - (m.hit.x + m.hit.w * 0.55);
        if (melee && !m.lunge && !m.projectile && gap > 6) f.vx = f.facing * Math.min(gap * 0.14, 6);
      }
    }
  }
  if (m.lunge) f.vx = f.facing * m.lunge * f.stats.speed;
  if (m.lungeAir) f.vy = m.lungeAir;
  if (m.kind === 'super') {
    w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y, z: f.z, kind: 'super' });
    w.events.push({ t: 'text', x: f.x, y: f.y + 150, z: f.z, text: m.name, color: '#ffd166' });
    w.events.push({ t: 'shake', power: 6 });
    f.invuln = Math.max(f.invuln, m.startup + m.active);
  } else if (m.kind === 'special' || m.kind === 'special2') {
    w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y, z: f.z, kind: m.projectile ? 'cast' : 'burst' });
  }
  w.events.push({ t: 'sound', id: m.kind === 'super' ? 'superstart' : m.kind === 'light' ? 'whoosh' : 'whoosh2', x: f.x });
}

function stepAttack(w: World, f: Fighter, c: CharDef, inp: number, dirX: number, dirZ: number): void {
  const m = currentMove(f);
  if (!m) { setState(f, 'idle'); return; }
  if (f.moveId === 'shoot') {
    if (f.gunCd > 0) f.gunCd--;
    if (f.stateFrame >= 2 && f.gunCd <= 0) {
      if ((inp & IN.LIGHT) && f.weapon > 0 && f.weaponKind && WEAPONS[f.weaponKind].gun) startShoot(w, f);
      else setState(f, 'idle');
    }
    physics(w, f);
    return;
  }
  const fr = f.stateFrame; // 1-based
  const activeStart = m.startup + 1;
  const activeEnd = m.startup + m.active;
  const total = m.startup + m.active + m.recovery;
  const inAir = airborne(f);

  // projectile au premier frame actif
  const projDef = f.ai?.kind === 'bomber' && m.kind === 'special' ? BOTTLE : m.projectile;
  if (fr === activeStart && projDef) {
    const p = projDef;
    const n = p.count ?? 1;
    for (let i = 0; i < n; i++) {
      const spread = n > 1 ? (i - (n - 1) / 2) * 1.6 : 0;
      const pr: Projectile = {
        id: w.nextId++,
        kind: p.kind,
        x: f.x + f.facing * 30,
        y: f.y + p.y,
        z: f.z,
        vx: f.facing * p.speed,
        vy: spread + (p.kind === 'bottle' ? 7 : 0),
        owner: f.id,
        team: f.team,
        damage: Math.round(p.damage * f.stats.power * (f.chargeBonus ? 1 + f.chargeBonus / 60 : 1)),
        life: p.life,
        radius: p.radius,
        pierce: !!p.pierce,
        hits: [],
        gravity: p.gravity ?? 0,
        homing: p.homing ?? 0,
        bonus: f.bonuses.length ? f.bonuses : undefined,
      };
      w.projectiles.push(pr);
    }
    w.events.push({ t: 'sound', id: p.kind === 'shuriken' ? 'shuriken' : 'kishot', x: f.x });
  }
  // dash pendant les frames actives (charges)
  if (m.selfKnock && fr >= activeStart && fr <= activeEnd) f.vx = f.facing * (m.lunge ?? 6) * f.stats.speed;
  // armure seulement pendant startup + actif
  if (fr > activeEnd) f.armor = false;
  // coups multiples
  if (m.multi && fr > activeStart && fr <= activeEnd && (fr - activeStart) % m.multi.every === 0 && f.multiLeft > 0) {
    f.multiLeft--;
    f.moveHits = [];
  }
  // détection de coups
  if (fr >= activeStart && fr <= activeEnd && m.hit.w > 0 && f.moveHits[0] !== -1) {
    checkHits(w, f, m);
  }
  // atterrissage pendant un coup aérien
  if ((m.kind === 'air' || m.kind === 'airHeavy') && !inAir && fr > 2) {
    if (m.kind === 'airHeavy' && fr <= activeEnd) {
      // onde à l'impact du plongeon
      w.events.push({ t: 'shake', power: 3 });
      w.events.push({ t: 'sound', id: 'land', x: f.x });
      if (hasBonus(f, 'shockwave')) spawnShock(w, f, 0, 50, 8);
    }
    setState(f, 'idle');
    f.nextMoveFrame = w.frame + 4;
    physics(w, f);
    return;
  }
  // finisseur P/K + E : annule n'importe quel coup normal dès le départ (façon Budokai)
  if (f.bufferedInput & IN.SPECIAL && fr >= 3 && !inAir && (m.kind === 'light' || m.kind === 'heavy' || m.kind === 'launcher' || m.kind === 'low')) {
    const fin = comboFinisher(w, f, c);
    if (fin && fin !== f.moveId) { f.bufferedInput = 0; f.cmb = ''; startMove(w, f, fin); return; }
  }
  // annulation / enchaînement
  const cancelFrom = m.cancelFrom ?? activeEnd;
  if (fr >= cancelFrom && m.next && m.next.length && f.bufferedInput) {
    const hitSomething = f.moveHits.length > 0 || m.kind === 'light';
    if (hitSomething && tryChain(w, f, c, m, inp, dirX, dirZ)) return;
  }
  // esquive-annulation après un coup qui a touché (fenêtre de récupération)
  if (fr > activeEnd && (inp & IN.GUARD) && (dirX || dirZ) && f.moveHits.length > 0 && !inAir) {
    setState(f, 'dodge');
    f.vx = dirX * 7 * f.stats.speed;
    f.vz = dirZ * 4;
    return;
  }
  if (fr >= total) {
    setState(f, inAir ? 'jump' : 'idle');
    if (m.kind === 'super') f.nextMoveFrame = w.frame + 6;
  }
  physics(w, f);
}

function tryChain(w: World, f: Fighter, c: CharDef, m: MoveDef, inp: number, dirX: number, dirZ: number): boolean {
  const buf = f.bufferedInput;
  const fwd = dirX !== 0 && dirX === f.facing;
  const back = dirX !== 0 && dirX === -f.facing;
  const down = dirZ > 0 || (inp & IN.DOWN) !== 0;
  const inAir = airborne(f);
  if (buf & IN.SPECIAL && !inAir) {
    const fin = comboFinisher(w, f, c);
    if (fin) { f.bufferedInput = 0; f.cmb = ''; startMove(w, f, fin); return true; }
  }
  const candidates: string[] = [];
  if (buf & IN.SUPER && f.superMeter >= C.SUPER_MAX) candidates.push(c.superMove);
  if (buf & IN.SPECIAL) {
    const id = down ? c.special2 : c.special;
    if (f.ki >= (c.moves[id].kiCost ?? C.SPECIAL_KI)) candidates.push(id);
  }
  if (buf & IN.HEAVY) {
    if (inAir) candidates.push(c.airHeavy);
    else if (fwd) candidates.push(c.launcher);
    else if (back || down) candidates.push(c.low);
    else candidates.push(c.heavy);
  }
  if (buf & IN.LIGHT) {
    if (inAir) candidates.push(c.air);
    else {
      const next = c.lightChain[f.chainIndex];
      if (next) candidates.push(next);
      else candidates.push(c.heavy); // fin d'enchaînement : finisseur lourd
    }
  }
  if (buf & IN.JUMP && !inAir && m.kind === 'launcher' && f.moveHits.length) {
    // saut-annulation après un lanceur : poursuite aérienne
    f.bufferedInput &= ~IN.JUMP;
    f.vy = C.JUMP_V * f.stats.jump * 1.05;
    f.airJumps = 1;
    setState(f, 'jump');
    f.y = 0.1;
    return true;
  }
  for (const id of candidates) {
    if (m.next!.includes(id) || (m.kind === 'light' && id === c.heavy && f.chainIndex >= c.lightChain.length)) {
      f.bufferedInput = 0;
      startMove(w, f, id);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Collisions / dégâts
// ---------------------------------------------------------------------------

/** Coups qui profitent de l'arme blanche tenue (allonge, dégâts, usure). */
const MELEE_KINDS = new Set(['light', 'heavy', 'launcher', 'low', 'run', 'air', 'airHeavy']);
function meleeOf(f: Fighter, m: MoveDef): (typeof WEAPONS)[WeaponKind] | null {
  if (f.weapon <= 0 || !f.weaponKind || !MELEE_KINDS.has(m.kind) || m.id === 'shoot') return null;
  const wd = WEAPONS[f.weaponKind];
  return wd.gun ? null : wd;
}

function hitboxOf(f: Fighter, m: MoveDef): { x0: number; x1: number; y0: number; y1: number; z: number } {
  const reach = f.stats.reach + (meleeOf(f, m)?.reach ?? 0);
  const cx = f.x + f.facing * (m.hit.x + reach * 0.5);
  const hw = (m.hit.w + reach) / 2;
  return { x0: cx - hw, x1: cx + hw, y0: f.y + m.hit.y0, y1: f.y + m.hit.y1, z: m.hit.z };
}

function checkHits(w: World, f: Fighter, m: MoveDef): void {
  const hb = hitboxOf(f, m);
  for (const t of w.fighters) {
    if (t === f || t.team === f.team || !alive(t)) continue;
    if (f.moveHits.includes(t.id)) continue;
    if (t.invuln > 0 && !(t.state === 'down' && m.low)) continue;
    if (t.state === 'down' && !m.low) continue;
    if (Math.abs(t.z - f.z) > hb.z) continue;
    if (t.x + C.HURT_HW < hb.x0 || t.x - C.HURT_HW > hb.x1) continue;
    const th = t.state === 'down' ? 30 : C.HURT_H;
    if (t.y + th < hb.y0 || t.y > hb.y1) continue;
    f.moveHits.push(t.id);
    resolveHit(w, f, t, m);
  }
  // caisses
  for (const it of w.items) {
    if (it.kind !== 'crate' || f.moveHits.includes(it.id)) continue;
    if (Math.abs(it.z - f.z) > hb.z + 10) continue;
    if (it.x + 22 < hb.x0 || it.x - 22 > hb.x1) continue;
    if (it.y + 40 < hb.y0 || it.y > hb.y1) continue;
    f.moveHits.push(it.id);
    it.hp = (it.hp ?? 1) - 1;
    w.events.push({ t: 'hit', x: it.x, y: it.y + 25, z: it.z, power: 0.5, blocked: true, crit: false, dir: f.facing, attacker: f.id, target: it.id });
    w.events.push({ t: 'sound', id: 'crate', x: it.x });
    if (it.hp <= 0) breakCrate(w, it, f.facing, f);
  }
}

function facingToward(t: Fighter, x: number): boolean {
  return sign(x - t.x) === t.facing || Math.abs(x - t.x) < 6;
}

function resolveHit(w: World, a: Fighter, t: Fighter, m0: MoveDef, proj?: Projectile): void {
  let m = m0;
  let homerun = false;
  const mw = proj ? null : meleeOf(a, m0);
  if (mw) {
    // effet propre à chaque arme
    m = { ...m0, knockdown: m0.knockdown || !!mw.knock, burnTarget: m0.burnTarget ?? mw.burn, kbx: m0.kbx + (mw.knock ? 2.5 : 0) };
    if (mw.fx === 'guardbreak' || mw.fx === 'sunder') m.guardBreak = true;
    if (mw.fx === 'combo' || mw.fx === 'quake') m.hitstun = m0.hitstun + (mw.fx === 'quake' ? 16 : 4);
    if (mw.fx === 'homerun' && rand(w) < 0.22) { homerun = true; m = { ...m, launch: true, kbx: m.kbx + 9, kby: Math.max(m.kby, 9), hitstop: m.hitstop + 6 }; }
  }
  if (m.grab && !proj) {
    // saisie : on empoigne la cible (impossible si elle est en l'air, au sol, déjà tenue, ou si on tient déjà quelqu'un)
    if (t.state === 'launch' || t.state === 'down' || t.state === 'held' || t.heldBy >= 0 || a.holding >= 0 || t.state === 'ko') return;
    startHold(w, a, t, m.grabMode ?? 0);
    return;
  }
  const dir = proj ? sign(proj.vx) || a.facing : (t.x >= a.x ? 1 : -1);
  const srcX = proj ? proj.x - dir * 100 : a.x;
  // --- parade parfaite ---
  const parryWin = hasBonus(t, 'guard') ? C.PARRY_WINDOW + 3 : C.PARRY_WINDOW;
  const guarding = t.state === 'guard' && facingToward(t, srcX);
  if (guarding && t.guardFrames <= parryWin && !m.unblockable) {
    setState(t, 'parry');
    t.ki = Math.min(C.KI_MAX, t.ki + 20);
    t.superMeter = Math.min(C.SUPER_MAX, t.superMeter + 12);
    t.freeze = 8;
    t.guardMeter = C.GUARD_MAX;
    if (proj) {
      // renvoi du projectile
      proj.team = t.team;
      proj.owner = t.id;
      proj.vx = -proj.vx * 1.3;
      proj.hits = [];
      proj.life = 80;
      proj.damage = Math.round(proj.damage * 1.5);
    } else if (!a.armor || m.kind !== 'super') {
      setState(a, 'stagger');
      a.freeze = 10;
      a.vx = -dir * 3;
    }
    w.events.push({ t: 'parry', x: t.x + t.facing * 30, y: t.y + 60, z: t.z });
    w.events.push({ t: 'text', x: t.x, y: t.y + 130, z: t.z, text: 'PARADE !', color: '#7cf6ff' });
    w.events.push({ t: 'sound', id: 'parry', x: t.x });
    w.events.push({ t: 'shake', power: 2 });
    return;
  }
  // --- garde ---
  const guardOk = (t.state === 'guard' || t.state === 'block') && facingToward(t, srcX) && !m.unblockable && !(m.low && !t.lowGuard) && !(m.overhead && t.lowGuard);
  let dmg = computeDamage(w, a, t, m, proj);
  if (homerun) dmg = Math.round(dmg * 1.4);
  // capacités passives des héros
  const pa = getChar(a.charId).passive, pt = getChar(t.charId).passive;
  if (pa === 'whiplash' && Math.abs(t.x - a.x) > 78) { dmg = Math.round(dmg * 1.3); }
  if (pa === 'ambush' && !proj && t.facing === a.facing) { dmg = Math.round(dmg * 1.5); w.events.push({ t: 'text', x: t.x, y: t.y + 150, z: t.z, text: 'DANS LE DOS !', color: '#b07cff' }); }
  if (pt === 'bulwark' && t.state === 'attack') dmg = Math.max(1, Math.round(dmg * 0.75));
  // réactions élémentaires : l'élément du coup réagit avec l'état de la cible
  const elem = elementOf(a, m, proj, mw);
  if (elem !== 'none' && !guardOk) dmg = Math.round(dmg * elementReaction(w, a, t, elem, dir));
  if (proj?.wk === 'pistol' && rand(w) < 0.25) { dmg *= 2; w.events.push({ t: 'text', x: t.x, y: t.y + 150, z: t.z, text: 'TIR À LA TÊTE !', color: '#ff5f5f' }); }
  const crit = !proj && hasBonus(a, 'crit') && rand(w) < Math.min(0.5, 0.15 * stacks(a.bonuses, 'crit'));
  if (crit) {
    dmg = Math.round(dmg * 1.6);
    if (hasSyn(a, 'jackpot')) { w.coins += 3; w.events.push({ t: 'text', x: t.x, y: t.y + 130, z: t.z, text: '+3 🪙', color: '#ffe14d' }); }
  }
  // contre-coup : la cible était en préparation d'attaque
  const counter = !proj && t.state === 'attack' && t.moveId !== null && t.stateFrame <= getChar(t.charId).moves[t.moveId].startup && !t.armor;
  if (counter) dmg = Math.round(dmg * 1.3);
  if (!proj && meleeOf(a, m)) { a.weapon--; if (a.weapon === 0) { a.weaponKind = ''; w.events.push({ t: 'text', x: a.x, y: a.y + 125, z: a.z, text: 'ARME CASSÉE', color: '#ccc' }); w.events.push({ t: 'sound', id: 'cratebreak', x: a.x }); } }
  if (guardOk) {
    const chip = Math.round(dmg * (m.kind === 'super' || m.kind === 'special' ? 0.2 : 0.08));
    const guardDmg = m.guardBreak ? 60 : dmg * 0.95;
    t.guardMeter -= guardDmg;
    if (t.guardMeter <= 0) {
      t.guardMeter = 50;
      setState(t, 'stagger');
      t.freeze = 6;
      t.vx = dir * 4;
      w.events.push({ t: 'text', x: t.x, y: t.y + 130, z: t.z, text: 'GARDE BRISÉE', color: '#ff6b6b' });
      w.events.push({ t: 'sound', id: 'guardbreak', x: t.x });
      w.events.push({ t: 'shake', power: 4 });
      w.events.push({ t: 'hit', x: t.x, y: t.y + 60, z: t.z, power: 1, blocked: false, crit: false, dir, attacker: a.id, target: t.id });
      damageRaw(w, t, chip, a.id);
      return;
    }
    damageRaw(w, t, chip, a.id);
    setState(t, 'block');
    t.hitFrames = m.blockstun;
    t.vx = dir * m.kbx * 0.6;
    t.freeze = Math.max(2, m.hitstop - 2);
    if (!proj) a.freeze = Math.max(2, m.hitstop - 2);
    a.superMeter = Math.min(C.SUPER_MAX, a.superMeter + 2);
    w.events.push({ t: 'hit', x: t.x - dir * 10, y: t.y + 60, z: t.z, power: 0.5, blocked: true, crit: false, dir, attacker: a.id, target: t.id });
    w.events.push({ t: 'sound', id: 'block', x: t.x });
    return;
  }
  // --- armure ---
  const armored = t.armor && t.state === 'attack' && !m.unblockable && m.kind !== 'super';
  // --- dégâts ---
  if (t.state === 'frozen') { dmg = Math.round(dmg * 1.3); t.status.frozen = 0; }
  const prevHp = t.hp;
  damageRaw(w, t, dmg, a.id);
  // jauges
  a.ki = Math.min(C.KI_MAX, a.ki + (hasBonus(a, 'kiflow') ? 5 + 4 * stacks(a.bonuses, 'kiflow') : 4));
  a.superMeter = Math.min(C.SUPER_MAX, a.superMeter + dmg * 0.55 * (hasBonus(a, 'superflow') ? 2 : 1));
  t.superMeter = Math.min(C.SUPER_MAX, t.superMeter + dmg * 0.3 * (hasBonus(t, 'superflow') ? 2 : 1));
  t.ki = Math.min(C.KI_MAX, t.ki + 2);
  if (hasBonus(a, 'lifesteal')) a.hp = Math.min(a.hpMax, a.hp + stacks(a.bonuses, 'lifesteal'));
  if (hasBonus(t, 'thorns') && !proj) damageRaw(w, a, Math.round(dmg * 0.25 * Math.min(3, stacks(t.bonuses, 'thorns'))), t.id);
  if (m.heal) a.hp = Math.min(a.hpMax, a.hp + m.heal);
  // statuts
  const heavyish = m.kind === 'heavy' || m.kind === 'launcher' || m.kind === 'low' || m.kind === 'airHeavy';
  if (m.burnTarget || (heavyish && hasBonus(a, 'burn'))) {
    t.status.burn = Math.max(t.status.burn, m.burnTarget ?? 120);
    t.status.burnDps = Math.max(1, Math.round(2 * a.stats.power));
  }
  if (m.poisonTarget || (proj?.kind === 'poison')) t.status.poison = Math.max(t.status.poison, m.poisonTarget ?? 150);
  if (m.slowTarget || proj?.kind === 'ice') t.status.slow = Math.max(t.status.slow, m.slowTarget ?? 120);
  if (a.form > 0) {
    const el = FORMS[a.charId]?.elem;
    if (el === 'fire') { t.status.burn = Math.max(t.status.burn, 90); t.status.burnDps = Math.max(t.status.burnDps, 2); }
    else if (el === 'ice') t.status.slow = Math.max(t.status.slow, 100);
    else if (el === 'poison') t.status.poison = Math.max(t.status.poison, 120);
    else if (el === 'shock') m = { ...m, hitstun: m.hitstun + 10 };
  }
  // effets passifs après l'impact
  switch (pa) {
    case 'focus': a.ki = Math.min(C.KI_MAX, a.ki + 4); break;
    case 'overload': a.ki = Math.min(C.KI_MAX, a.ki + 2); break;
    case 'ember': t.status.burn = Math.max(t.status.burn, 70); t.status.burnDps = Math.max(t.status.burnDps, 1); break;
    case 'chill': t.status.slow = Math.max(t.status.slow, 70); break;
    case 'ambush': if (t.facing === a.facing) t.status.poison = Math.max(t.status.poison, 100); break;
    default: break;
  }
  // combo
  a.comboHits++;
  if (pa === 'astral' && !proj && a.comboHits % 3 === 0) {
    w.projectiles.push({ id: w.nextId++, kind: 'orb', x: a.x + a.facing * 30, y: a.y + 70, z: a.z, vx: a.facing * 7, vy: 0, owner: a.id, team: a.team, damage: Math.max(1, Math.round(7 * a.stats.power)), life: 50, radius: 12, pierce: false, hits: [t.id], gravity: 0, homing: 0.3 });
    w.events.push({ t: 'text', x: a.x, y: a.y + 140, z: a.z, text: 'ÉTOILE', color: '#7da8ff' });
  }
  if (pa === 'overload' && !proj && a.comboHits % 5 === 0) {
    const other = w.fighters.find((o) => o !== t && o.team !== a.team && alive(o) && Math.abs(o.x - t.x) < 170 && Math.abs(o.z - t.z) < 70);
    if (other) {
      damageRaw(w, other, Math.max(1, Math.round(9 * a.stats.power)), a.id);
      w.events.push({ t: 'hit', x: other.x, y: other.y + 70, z: other.z, power: 0.8, blocked: false, crit: false, dir, attacker: a.id, target: other.id });
      w.events.push({ t: 'text', x: other.x, y: other.y + 130, z: other.z, text: 'ARC !', color: '#ffe14d' });
      if (other.hp <= 0) knockOut(w, other, a, dir, null);
    }
  }
  a.comboTimer = C.COMBO_RESET;
  a.comboDamage += dmg;
  // hit-stop
  const stop = crit ? m.hitstop + 3 : m.hitstop;
  t.freeze = stop;
  if (!proj) a.freeze = stop;
  const power = clamp(dmg / 18, 0.3, 2);
  w.events.push({ t: 'hit', x: t.x - dir * 8, y: t.y + (m.hit.y0 + m.hit.y1) / 2, z: t.z, power, blocked: false, crit, dir, attacker: a.id, target: t.id });
  w.events.push({ t: 'sound', id: m.kind === 'super' ? 'superhit' : heavyish || m.kind === 'special' ? 'hitheavy' : 'hit', x: t.x });
  if (heavyish || m.kind === 'super' || crit) w.events.push({ t: 'shake', power: crit ? 5 : m.kind === 'super' ? 5 : 3 });
  // ralenti bref sur les gros impacts : sensation de puissance
  if (crit || counter || power > 1.15 || (m.launch && power > 0.8)) w.slowmo = Math.max(w.slowmo, crit || counter ? 10 : 7);
  if (crit) w.events.push({ t: 'text', x: t.x, y: t.y + 140, z: t.z, text: 'CRITIQUE', color: '#ffe14d' });
  if (counter) { w.events.push({ t: 'counter', x: t.x, y: t.y + 70, z: t.z }); w.events.push({ t: 'text', x: t.x, y: t.y + 155, z: t.z, text: 'CONTRE !', color: '#ff9f1c' }); w.events.push({ t: 'sound', id: 'counter', x: t.x }); }
  // onde de choc bonus
  if (heavyish && hasBonus(a, 'shockwave') && !proj) spawnShock(w, a, a.facing * 5, 45, 9);
  if (mw?.fx === 'bleed') {
    t.status.poison = Math.max(t.status.poison, 150);
    if (t.status.poison === 150) w.events.push({ t: 'text', x: t.x, y: t.y + 150, z: t.z, text: 'SAIGNEMENT', color: '#ff5f5f' });
  }
  if (homerun) { w.events.push({ t: 'text', x: t.x, y: t.y + 160, z: t.z, text: 'HOME RUN !', color: '#ffe14d' }); w.events.push({ t: 'shake', power: 6 }); }
  if (mw?.fx === 'quake' && t.hp > 0) spawnShock(w, t, 0, 64, 7, a);
  if (mw?.fx === 'sunder' && guardOk === false && t.armor === false && m.kind === 'heavy') w.events.push({ t: 'text', x: t.x, y: t.y + 150, z: t.z, text: 'ARMURE BRISÉE', color: '#c0c6d6' });
  if (t.hp <= 0) {
    knockOut(w, t, a, dir, m);
    return;
  }
  if (armored) {
    w.events.push({ t: 'text', x: t.x, y: t.y + 125, z: t.z, text: 'ARMURE', color: '#c0c6d6' });
    return;
  }
  // gel
  if (m.freezeTarget || (heavyish && hasBonus(a, 'frost') && rand(w) < 0.5)) {
    if (!airborne(t)) {
      t.status.frozen = m.freezeTarget ?? 60;
      setState(t, 'frozen');
      t.vx = dir * m.kbx * 0.3;
      w.events.push({ t: 'text', x: t.x, y: t.y + 125, z: t.z, text: 'GELÉ', color: '#9ff' });
      return;
    }
  }
  // réaction
  const juggle = airborne(t) || t.state === 'launch';
  const kbScale = 1 - Math.min(0.5, a.comboHits * 0.04);
  if (m.launch || juggle) {
    setState(t, 'launch');
    t.vx = dir * m.kbx * kbScale * 1.2;
    t.vy = Math.max(m.kby, juggle ? 6.5 : 0) * (juggle ? Math.max(0.55, 1 - a.comboHits * 0.06) : 1);
    if (t.y <= 0) t.y = 0.1;
  } else if (m.knockdown) {
    setState(t, 'launch');
    t.vx = dir * m.kbx * kbScale;
    t.vy = Math.max(3.5, m.kby);
    t.y = Math.max(t.y, 0.1);
  } else {
    setState(t, 'hit');
    t.hitFrames = Math.round(m.hitstun * (1 - Math.min(0.4, a.comboHits * 0.03))) + (counter ? 8 : 0);
    t.vx = mw?.fx === 'impale' || m.pull ? -dir * (m.pull ? 6 : 3.2) : dir * m.kbx * kbScale;
    if (mw?.fx === 'impale') { t.hitFrames += 10; }
  }
  t.facing = (-dir) as 1 | -1;
  void prevHp;
}

function computeDamage(w: World, a: Fighter, t: Fighter, m: MoveDef, proj?: Projectile): number {
  let base = proj ? proj.damage : m.damage * a.stats.power;
  if (!proj && a.chargeBonus) base *= 1 + a.chargeBonus / 56;
  if (!proj) { const mw = meleeOf(a, m); if (mw) base *= mw.dmg; }
  if (hasBonus(a, 'berserk') && a.hp < a.hpMax * (hasSyn(a, 'bloodlust') ? 0.6 : 0.35)) base *= 1.5;
  if (hasSyn(a, 'thermal') && (t.status.burn > 0 || t.state === 'frozen')) base *= 1.3;
  if (hasSyn(t, 'fortress')) base *= 0.85;
  if (a.team === 0 && a.bonuses.length) {
    // coopération : chaque allié qui partage un de tes bonus te donne +6 %
    let mates = 0;
    for (const o of w.fighters) if (o.id !== a.id && o.team === 0 && alive(o) && o.bonuses.some((b) => a.bonuses.includes(b))) mates++;
    if (mates) base *= 1 + 0.06 * Math.min(3, mates);
  }
  const mw2 = proj ? null : meleeOf(a, m);
  const scale = proj && proj.kind === 'slug' ? 1 : mw2?.fx === 'combo' ? Math.max(0.55, 1 - a.comboHits * 0.035) : Math.max(0.35, 1 - a.comboHits * 0.07);
  base *= scale;
  base /= mw2?.fx === 'sunder' ? Math.max(1, t.stats.defense * 0.6) : t.stats.defense;
  return Math.max(1, Math.round(base));
}

function damageRaw(w: World, t: Fighter, dmg: number, by: number): void {
  if (!alive(t)) return;
  t.hp -= dmg;
  t.lastHitBy = by;
  if (t.hp <= 0 && hasBonus(t, 'phoenix') && !t.phoenixUsed) {
    t.phoenixUsed = true;
    t.hp = Math.round(t.hpMax * 0.5);
    t.invuln = 90;
    w.events.push({ t: 'text', x: t.x, y: t.y + 140, z: t.z, text: 'PHÉNIX !', color: '#ffb347' });
    w.events.push({ t: 'sound', id: 'revive', x: t.x });
  }
  if (t.hp <= 0) {
    const a = w.fighters.find((f) => f.id === by);
    knockOut(w, t, a ?? null, a ? (t.x >= a.x ? 1 : -1) : 1, null);
  }
}

function knockOut(w: World, t: Fighter, a: Fighter | null, dir: number, m: MoveDef | null): void {
  if (t.state === 'ko') return;
  t.hp = 0;
  setState(t, 'ko');
  t.koTimer = 0;
  t.revive = 0;
  t.vx = dir * (m ? Math.max(6, m.kbx * 1.4) : 5);
  t.vy = m ? Math.max(6, m.kby + 5) : 6;
  t.y = Math.max(t.y, 0.1);
  t.status = { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 };
  w.events.push({ t: 'ko', x: t.x, y: t.y + 50, z: t.z, id: t.id });
  w.events.push({ t: 'sound', id: 'ko', x: t.x });
  w.events.push({ t: 'shake', power: 5 });
  if (a) {
    a.kills++;
    if (hasBonus(a, 'lifesteal')) a.hp = Math.min(a.hpMax, a.hp + 10 * stacks(a.bonuses, 'lifesteal'));
    if (hasBonus(a, 'explode')) { const ch = hasSyn(a, 'chain'); spawnShock(w, t, 0, ch ? 120 : 80, ch ? 24 : 16, a); }
    if (t.team !== 0 && a.team === 0) {
      const lvl = Math.max(1, t.level);
      w.score += 100 * lvl * (t.ai?.kind === 'boss' ? 10 : 1);
      const coins = (t.ai?.kind === 'boss' ? 25 : 5) * (hasBonus(a, 'midas') ? 3 : 1);
      w.coins += coins;
      w.events.push({ t: 'text', x: t.x, y: t.y + 120, z: t.z, text: `+${coins} 🪙`, color: '#ffe14d' });
    }
  }
  if (t.team !== 0) {
    w.slowmo = Math.max(w.slowmo, t.ai?.kind === 'boss' ? 60 : 8);
    // butin
    const dr = rand(w);
    if (dr < 0.14) w.items.push({ id: w.nextId++, kind: rand(w) < 0.5 ? 'heal' : 'ki', x: t.x, y: 40, z: t.z, vy: 4, life: 600 });
    else if (dr < 0.22) w.items.push({ ...makeWeaponItem(w, randomWeapon(w), t.x, 40), z: t.z });
    // une arme tenue par l'ennemi tombe à sa mort
    else if (t.weapon > 0 && t.weaponKind) w.items.push({ id: w.nextId++, kind: 'weapon', wk: t.weaponKind, x: t.x, y: 40, z: t.z, vy: 4, vx: dir * 3, uses: t.weapon, life: 900 });
  }
}

function spawnShock(w: World, f: Fighter, vx: number, radius: number, damage: number, owner?: Fighter): void {
  const o = owner ?? f;
  w.projectiles.push({ id: w.nextId++, kind: 'shock', x: f.x, y: f.y + 30, z: f.z, vx, vy: 0, owner: o.id, team: o.team, damage: Math.round(damage * o.stats.power), life: vx ? 40 : 3, radius, pierce: true, hits: [], gravity: 0, homing: 0 });
  w.events.push({ t: 'special', id: o.id, x: f.x, y: f.y, z: f.z, kind: 'shock' });
  w.events.push({ t: 'sound', id: 'shock', x: f.x });
}

function breakCrate(w: World, it: Item, dir: number, by: Fighter | null = null): void {
  w.items = w.items.filter((x) => x !== it);
  crateBurst(w, it.x, it.y, it.z, it.cv ?? 'wood', dir, by, 0);
}

/** Une caisse se brise : butin, ou effet de zone selon la variante (explosive, glace, poison). */
function crateBurst(w: World, x: number, y: number, z: number, cv: string, dir: number, by: Fighter | null, depth: number): void {
  const affected = (f: Fighter, rx: number, rz: number) => alive(f) && Math.abs(f.x - x) < rx && Math.abs(f.z - z) < rz && f.y < 120;
  w.events.push({ t: 'pickup', kind: 'crate', x, y: y + 20, z, v: cv });
  w.events.push({ t: 'sound', id: 'cratebreak', x });
  if (cv === 'explosive' || cv === 'ice' || cv === 'poison') {
    const r = cv === 'explosive' ? 120 : 105;
    w.events.push({ t: 'boom', x, y: y + 20, z, elem: cv === 'explosive' ? 'fire' : cv, r });
    w.events.push({ t: 'shake', power: cv === 'explosive' ? 6 : 3 });
    for (const f of w.fighters) {
      if (!affected(f, r, 70)) continue;
      if (by && f.team === by.team && f !== by && cv !== 'explosive') continue;
      const d = sign(f.x - x) || dir;
      if (cv === 'explosive') {
        damageRaw(w, f, Math.round(20 * (by?.stats.power ?? 1)), by?.id ?? -1);
        f.status.burn = Math.max(f.status.burn, 90); f.status.burnDps = Math.max(f.status.burnDps, 2);
        if (alive(f)) { setState(f, 'launch'); f.vx = d * 5; f.vy = 8; f.y = Math.max(f.y, 0.1); }
        else knockOut(w, f, by, d, null);
      } else if (cv === 'ice') {
        f.status.slow = Math.max(f.status.slow, 200);
        if (f.y <= 0 && f.state !== 'launch' && f.state !== 'down' && alive(f)) { f.status.frozen = 70; setState(f, 'frozen'); }
        w.events.push({ t: 'text', x: f.x, y: f.y + 125, z: f.z, text: 'GELÉ', color: '#9ff' });
      } else {
        f.status.poison = Math.max(f.status.poison, 220);
        f.status.slow = Math.max(f.status.slow, 160);
        w.events.push({ t: 'text', x: f.x, y: f.y + 125, z: f.z, text: 'EMPOISONNÉ', color: '#9f6' });
      }
    }
    if (cv === 'explosive' && depth < 3) {
      // réaction en chaîne
      for (const o of [...w.items]) if (o.kind === 'crate' && o.cv === 'explosive' && Math.abs(o.x - x) < r && Math.abs(o.z - z) < 70) { w.items = w.items.filter((q) => q !== o); crateBurst(w, o.x, o.y, o.z, 'explosive', dir, by, depth + 1); }
    }
    if (rand(w) < 0.5) w.items.push({ id: w.nextId++, kind: 'coin', x: x - dir * 24, y: 30, z: z + 10, vy: 6, vx: -dir * 2, life: 900 });
    return;
  }
  const r = rand(w);
  const metal = cv === 'metal';
  const kind: Item['kind'] = metal ? 'weapon' : r < 0.34 ? 'heal' : r < 0.6 ? 'ki' : r < 0.76 ? 'coin' : 'weapon';
  w.items.push({ id: w.nextId++, kind, wk: kind === 'weapon' ? randomWeapon(w) : undefined, x: x + dir * 20, y: 30, z, vy: 5, vx: dir * 2, life: 900 });
  if (metal) { w.items.push({ id: w.nextId++, kind: 'heal', x: x - dir * 24, y: 30, z: z + 10, vy: 6, vx: -dir * 2, life: 900 }); w.items.push({ id: w.nextId++, kind: 'coin', x: x + dir * 40, y: 30, z: z - 10, vy: 6, vx: dir * 3, life: 900 }); }
  else if (rand(w) < 0.4) w.items.push({ id: w.nextId++, kind: 'coin', x: x - dir * 24, y: 30, z: z + 10, vy: 6, vx: -dir * 2, life: 900 });
}

/** Choisit la variante d'une caisse selon l'avancée. */
function crateVariant(w: World): string {
  const r = rand(w);
  const st = w.mode === 'campaign' ? w.stageIndex : 3;
  if (r < 0.5) return 'wood';
  if (r < 0.62) return 'metal';
  if (r < 0.78) return 'explosive';
  if (r < 0.9) return st >= 1 ? 'ice' : 'wood';
  return st >= 2 ? 'poison' : 'wood';
}

// ---------------------------------------------------------------------------
// Physique, projectiles, objets
// ---------------------------------------------------------------------------

/** Les shamans soignent l'allié le plus blessé à proximité toutes les 3,5 s. */
function stepShamans(w: World): void {
  if (w.phase !== 'fight') return;
  for (const f of w.fighters) {
    if (!f.ai || f.ai.kind !== 'shaman' || !alive(f) || f.state === 'hit' || f.state === 'launch' || f.state === 'down') continue;
    if ((w.frame + f.id * 17) % 210 !== 0) continue;
    let best: Fighter | null = null;
    for (const o of w.fighters) {
      if (o === f || o.team !== f.team || !alive(o) || o.hp > o.hpMax * 0.75 || Math.abs(o.x - f.x) > 320) continue;
      if (!best || o.hp / o.hpMax < best.hp / best.hpMax) best = o;
    }
    if (!best) continue;
    best.hp = Math.min(best.hpMax, best.hp + Math.round(best.hpMax * 0.25));
    w.events.push({ t: 'text', x: best.x, y: best.y + 125, z: best.z, text: '+SOIN', color: '#7cff9a' });
    w.events.push({ t: 'pickup', kind: 'heal', x: best.x, y: best.y + 40, z: best.z });
    w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y + 60, z: f.z, kind: 'cast' });
  }
}

/** Les corps ne s'empilent pas : poussée douce sur x, glissement sur z quand ils se recouvrent. */
function separate(w: World): void {
  const fs = w.fighters;
  for (let i = 0; i < fs.length; i++) {
    const a = fs[i];
    if (a.y > 24 || a.state === 'ko' || a.state === 'down' || a.state === 'launch' || a.state === 'revive' || a.state === 'hold' || a.state === 'held') continue;
    for (let j = i + 1; j < fs.length; j++) {
      const b = fs[j];
      if (b.y > 24 || b.state === 'ko' || b.state === 'down' || b.state === 'launch' || b.state === 'revive' || b.state === 'hold' || b.state === 'held') continue;
      const dz = b.z - a.z;
      if (Math.abs(dz) >= 22) continue;
      const dx = b.x - a.x;
      const gap = 36 - Math.abs(dx);
      if (gap <= 0) continue;
      const dir = dx > 0 ? 1 : dx < 0 ? -1 : a.id < b.id ? 1 : -1;
      // le combattant en attaque/garde se fait moins pousser
      const wa = a.state === 'attack' ? 0.25 : 0.5, wb = b.state === 'attack' ? 0.25 : 0.5;
      const push = Math.min(gap, 6) * 0.5;
      a.x = q(a.x - dir * push * wa * 2);
      b.x = q(b.x + dir * push * wb * 2);
      if (Math.abs(dx) < 18) {
        const zd = dz >= 0 ? 1 : -1;
        a.z = q(clamp(a.z - zd * 1.2, C.Z_MIN, C.Z_MAX));
        b.z = q(clamp(b.z + zd * 1.2, C.Z_MIN, C.Z_MAX));
      }
    }
  }
}

function physics(w: World, f: Fighter): void {
  const inAir = f.y > 0 || f.vy > 0;
  if (inAir) {
    f.vy -= C.GRAV * w.grav * (f.state === 'launch' ? 0.9 : 1);
    if (w.grav < 1) {
      // milieu dense / apesanteur : traînée sur les deux axes et plafond
      f.vy *= 1 - (1 - w.grav) * 0.03;
      f.vx *= 1 - (1 - w.grav) * 0.012;
      if (f.y > 280) { f.y = 280; if (f.vy > 0) f.vy = 0; }
    }
    if (f.state === 'launch' || f.state === 'ko') f.vx *= 0.992; // traînée de l'air
    f.y += f.vy;
    if (f.y <= 0) {
      f.y = 0;
      if (f.state === 'ko') {
        f.vy = -f.vy * 0.35;
        if (f.vy < 1.5) f.vy = 0;
        f.vx *= 0.6;
      } else if (f.state === 'launch' && f.vy < -7 && f.stateFrame > 2) {
        // rebond
        f.vy = -f.vy * 0.3;
        w.events.push({ t: 'sound', id: 'land', x: f.x });
      } else f.vy = 0;
    }
  } else {
    f.vx *= f.state === 'hit' || f.state === 'block' || f.state === 'stagger' || f.state === 'dodge' ? 0.86 : 1;
    if (f.state === 'attack') f.vx *= 0.85;
    if (f.state === 'down' || f.state === 'ko' || f.state === 'launch' || f.state === 'getup') f.vx *= 0.86; // glissade au sol
    if (f.state === 'idle' || f.state === 'guard') f.vx *= C.FRICTION;
  }
  f.x = q(f.x + f.vx);
  f.z = q(clamp(f.z + f.vz, C.Z_MIN, C.Z_MAX));
  if (f.state === 'launch' && Math.abs(f.vx) > 2.5 && f.y < 70) {
    // un combattant projeté défonce les caisses sur son passage
    for (const it of w.items) {
      if (it.kind !== 'crate' || Math.abs(it.x - f.x) > 34 || Math.abs(it.z - f.z) > 34) continue;
      const by = w.fighters.find((o) => o.id === f.lastHitBy) ?? null;
      w.items = w.items.filter((q2) => q2 !== it);
      damageRaw(w, f, 6, by?.id ?? -1);
      w.events.push({ t: 'text', x: f.x, y: f.y + 130, z: f.z, text: 'CRASH !', color: '#ffe14d' });
      crateBurst(w, it.x, it.y, it.z, it.cv ?? 'wood', sign(f.vx) || 1, by, 0);
      f.vx *= 0.55;
      break;
    }
  }
  if (Math.abs(f.vx) < 0.05) f.vx = 0;
  // limites d'arène
  const left = w.locked ? w.arenaL + 24 : 24;
  const right = (w.locked ? w.arenaR : (w.stage?.width ?? C.VIEW_W)) - 24;
  const isEnemyEntering = f.team !== 0 && f.invuln > 0 && (f.x < left || f.x > right);
  if (!isEnemyEntering) {
    const flying = f.state === 'launch' || f.state === 'ko';
    if (f.x < left) { f.x = left; if (f.vx < 0) { if (flying && f.vx < -5) wallSplat(w, f, 1); f.vx = flying ? -f.vx * 0.45 : 0; } }
    if (f.x > right) { f.x = right; if (f.vx > 0) { if (flying && f.vx > 5) wallSplat(w, f, -1); f.vx = flying ? -f.vx * 0.45 : 0; } }
  }
}

function wallSplat(w: World, f: Fighter, dir: number): void {
  f.vy = Math.max(f.vy, 5);
  f.y = Math.max(f.y, 0.1);
  f.freeze = 4;
  w.events.push({ t: 'wall', x: f.x, y: f.y + 60, z: f.z, dir });
  w.events.push({ t: 'sound', id: 'wall', x: f.x });
  w.events.push({ t: 'shake', power: 3 });
}

function stepProjectiles(w: World): void {
  for (const p of w.projectiles) {
    p.life--;
    if (p.kind === 'shock' && p.vx === 0) {
      // onde statique : rayon croissant
      p.radius += 6;
    }
    if (p.homing) {
      let best: Fighter | null = null;
      let bd = Infinity;
      for (const f of w.fighters) {
        if (f.team === p.team || !alive(f)) continue;
        const d = Math.abs(f.x - p.x);
        if (d < bd) { bd = d; best = f; }
      }
      if (best) p.vy = approach(p.vy, clamp((best.y + 50 - p.y) * 0.1, -3, 3), p.homing);
    }
    p.vy -= p.gravity * w.grav;
    p.x = q(p.x + p.vx);
    p.y = q(p.y + p.vy);
    if (p.y < 0) p.life = 0;
    // collisions
    for (const f of w.fighters) {
      if (f.team === p.team || !alive(f) || p.hits.includes(f.id)) continue;
      if (f.invuln > 0 || f.state === 'down') continue;
      if (p.kind === 'bat' && f.y > 0 && p.y < f.y) continue;
      if (f.weapon > 0 && f.weaponKind === 'laser' && (f.state === 'attack' || f.state === 'guard' || f.state === 'block') && p.kind !== 'shock' && Math.abs(f.z - p.z) <= 34 && Math.abs(f.x - p.x) <= C.HURT_HW + p.radius + 30 && Math.sign(p.vx || 1) === -f.facing) {
        // le sabre renvoie le projectile à son tireur
        p.team = f.team; p.owner = f.id; p.vx = -p.vx * 1.2; p.hits = []; p.life = Math.max(p.life, 50); p.damage = Math.round(p.damage * 1.3);
        w.events.push({ t: 'text', x: f.x, y: f.y + 140, z: f.z, text: 'RENVOI !', color: '#7cf6ff' });
        w.events.push({ t: 'sound', id: 'parry', x: f.x });
        continue;
      }
      if (Math.abs(f.z - p.z) > 34 + p.radius * 0.3) continue;
      if (Math.abs(f.x - p.x) > C.HURT_HW + p.radius) continue;
      if (p.y + p.radius < f.y || p.y - p.radius > f.y + C.HURT_H) continue;
      p.hits.push(f.id);
      const owner = w.fighters.find((o) => o.id === p.owner);
      const m = projectileMove(p);
      if (owner) resolveHit(w, owner, f, m, p);
      else { const real = Math.max(1, Math.round(p.damage / f.stats.defense)); damageRaw(w, f, real, -1); if (alive(f)) { setState(f, 'hit'); f.hitFrames = 16; f.vx = 0; f.freeze = 3; } w.events.push({ t: 'hit', x: f.x, y: f.y + 60, z: f.z, power: 0.6, blocked: false, crit: false, dir: 1, attacker: -1, target: f.id }); w.events.push({ t: 'sound', id: 'hit', x: f.x }); }
      if (!p.pierce) p.life = 0;
    }
    // caisses
    for (const it of w.items) {
      if (it.kind !== 'crate' || p.hits.includes(it.id)) continue;
      if (Math.abs(it.z - p.z) > 40 || Math.abs(it.x - p.x) > 26 + p.radius) continue;
      p.hits.push(it.id);
      it.hp = (it.hp ?? 1) - 1;
      if (it.hp <= 0) breakCrate(w, it, sign(p.vx) || 1, w.fighters.find((o) => o.id === p.owner) ?? null);
      if (!p.pierce) p.life = 0;
    }
  }
  // collisions projectile/projectile : annulation
  for (let i = 0; i < w.projectiles.length; i++) {
    const a = w.projectiles[i];
    if (a.kind === 'shock' || a.life <= 0) continue;
    for (let j = i + 1; j < w.projectiles.length; j++) {
      const b = w.projectiles[j];
      if (b.kind === 'shock' || b.life <= 0 || a.team === b.team) continue;
      if (Math.abs(a.x - b.x) < a.radius + b.radius && Math.abs(a.z - b.z) < 40 && Math.abs(a.y - b.y) < a.radius + b.radius) {
        if (a.radius < b.radius) a.life = 0; else if (b.radius < a.radius) b.life = 0; else { a.life = 0; b.life = 0; }
        w.events.push({ t: 'hit', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: a.z, power: 0.8, blocked: true, crit: false, dir: 1, attacker: a.owner, target: b.owner });
        w.events.push({ t: 'sound', id: 'clash', x: a.x });
      }
    }
  }
  for (const p of w.projectiles) if (p.life <= 0 && p.kind === 'crate') crateBurst(w, p.x, Math.max(0, p.y - 20), p.z, p.cv ?? 'wood', sign(p.vx) || 1, w.fighters.find((o) => o.id === p.owner) ?? null, 0);
  for (const p of w.projectiles) if (p.life <= 0 && p.kind === 'bat' && p.wk) w.items.push({ id: w.nextId++, kind: 'weapon', wk: p.wk, x: p.x, y: Math.max(0, p.y), z: p.z, vy: Math.max(2, -p.vy * 0.5 + 2), vx: p.vx * 0.3, uses: p.uses, life: 1200 });
  w.projectiles = w.projectiles.filter((p) => p.life > 0);
}

function projectileMove(p: Projectile): MoveDef {
  const shock = p.kind === 'shock';
  const slug = p.kind === 'slug';
  const shot = p.wk === 'shotgun';
  const heavyProj = shock || p.kind === 'orb' || p.kind === 'bat' || p.kind === 'bottle' || p.kind === 'crate';
  return {
    id: 'proj', name: '', kind: 'special', anim: 'special', startup: 0, active: 1, recovery: 0,
    hit: { x: 0, w: 0, y0: -20, y1: 40, z: 40 }, damage: p.damage, hitstun: p.kind === 'bolt' ? 34 : shot ? 18 : p.wk === 'ak' ? 13 : slug ? 9 : shock ? 24 : 18, blockstun: slug ? 5 : 12,
    kbx: shock ? 6 : p.kind === 'bat' ? 7 : shot ? 4 : slug ? 1.2 : 4, kby: shock ? 5 : p.kind === 'bat' ? 4 : 0, hitstop: heavyProj ? 7 : slug ? 1 : 4, knockdown: heavyProj || p.kind === 'rock', launch: false,
    burnTarget: p.kind === 'fire' ? 120 : undefined, freezeTarget: p.kind === 'ice' ? 60 : undefined, low: false,
  };
}

function stepItems(w: World): void {
  for (const it of w.items) {
    it.life--;
    if (it.kind === 'crate') continue;
    // physique des objets au sol : chute, rebond amorti, glissade, limites de l'arène
    const airborneIt = it.y > 0 || it.vy > 0;
    if (airborneIt) {
      it.vy -= 0.5 * Math.max(0.25, w.grav);
      it.y += it.vy;
      if (it.y <= 0) {
        it.y = 0;
        if (it.vy < -2.2) it.vy = -it.vy * 0.38; // rebond
        else it.vy = 0;
      }
    }
    if (it.vx) {
      it.x = q(it.x + it.vx);
      it.vx *= it.y > 0 ? 0.99 : 0.82;
      if (Math.abs(it.vx) < 0.08) it.vx = 0;
      const lo = w.locked ? w.arenaL + 20 : 20, hi = (w.locked ? w.arenaR : (w.stage?.width ?? C.VIEW_W)) - 20;
      if (it.x < lo) { it.x = lo; it.vx = -it.vx * 0.4; }
      if (it.x > hi) { it.x = hi; it.vx = -it.vx * 0.4; }
    }
    for (const f of w.fighters) {
      if (f.team !== 0 || !alive(f) || f.state === 'down') continue;
      if (Math.abs(f.x - it.x) > 28 || Math.abs(f.z - it.z) > 26 || it.y > 40) continue;
      if (it.kind === 'heal' && f.hp >= f.hpMax) continue;
      if (it.kind === 'weapon' && (f.weapon > 0 || f.state === 'attack' || f.state === 'hit' || f.state === 'launch' || f.state === 'stagger' || f.state === 'frozen' || f.state === 'ko')) continue;
      it.life = 0;
      if (it.kind === 'weapon') giveWeapon(w, f, it.wk ?? 'bat', it.uses);
      if (it.kind === 'heal') { f.hp = Math.min(f.hpMax, f.hp + 35); w.events.push({ t: 'text', x: f.x, y: f.y + 120, z: f.z, text: '+35 PV', color: '#7cff9a' }); }
      else if (it.kind === 'ki') { f.ki = Math.min(C.KI_MAX, f.ki + 50); w.events.push({ t: 'text', x: f.x, y: f.y + 120, z: f.z, text: '+50 KI', color: '#7cf6ff' }); }
      else if (it.kind === 'coin') { const v = hasBonus(f, 'midas') ? 30 : 10; w.coins += v; w.score += v * 5; w.events.push({ t: 'text', x: f.x, y: f.y + 120, z: f.z, text: `+${v} 🪙`, color: '#ffe14d' }); }
      w.events.push({ t: 'pickup', kind: it.kind, x: it.x, y: it.y + 10, z: it.z });
      w.events.push({ t: 'sound', id: 'pickup', x: it.x });
      break;
    }
  }
  w.items = w.items.filter((it) => it.life > 0);
}

// ---------------------------------------------------------------------------
// Utilitaires d'intégration
// ---------------------------------------------------------------------------

/** Un joueur a quitté : son combattant passe sous contrôle de l'IA (déterministe). */
export function setSlotAi(w: World, slot: number): void {
  for (const f of w.fighters) {
    if (f.slot === slot && f.controller === 'player') {
      f.controller = 'ai';
      f.ai = makeAi('bot', 3, w);
      f.name = `${f.name} (IA)`;
      w.events.push({ t: 'text', x: f.x, y: f.y + 130, z: f.z, text: `${f.name}`, color: '#ccc' });
    }
  }
  for (const bc of w.bonusChoices) if (bc.slot === slot && bc.chosen < 0) bc.chosen = 0;
  for (const sc of w.shopChoices) if (sc.slot === slot) sc.done = true;
  if (w.paused && w.pausedBy === slot) { w.paused = false; w.pausedBy = -1; }
}

/** Nombre de joueurs humains actifs : sert à adapter la difficulté (points de vie, effectifs). */
function humanCount(w: World): number {
  return Math.max(1, w.fighters.filter((f) => f.team === 0 && f.slot >= 0 && f.controller === 'player').length);
}

function startTransform(w: World, f: Fighter): void {
  const fd = FORMS[f.charId];
  if (!fd || f.form > 0) return;
  f.form = FORM_FRAMES;
  f.stats.power *= fd.power; f.stats.speed *= fd.speed; f.stats.defense *= fd.defense; f.stats.reach += fd.reach;
  f.ki = 40;
  f.hp = Math.min(f.hpMax, f.hp + f.hpMax * 0.2);
  f.invuln = Math.max(f.invuln, 50);
  w.events.push({ t: 'text', x: f.x, y: f.y + 160, z: f.z, text: fd.name.toUpperCase(), color: fd.color });
  w.events.push({ t: 'special', id: f.id, x: f.x, y: f.y, z: f.z, kind: 'transform' });
  w.events.push({ t: 'shake', power: 6 });
  w.slowmo = Math.max(w.slowmo, 40);
}

function endTransform(w: World, f: Fighter): void {
  const fd = FORMS[f.charId];
  if (!fd) return;
  f.stats.power /= fd.power; f.stats.speed /= fd.speed; f.stats.defense /= fd.defense; f.stats.reach -= fd.reach;
  w.events.push({ t: 'text', x: f.x, y: f.y + 130, z: f.z, text: 'Forme terminée', color: '#ccc' });
}

/** Un joueur entre dans la partie en cours (déterministe, à la frame annoncée par le serveur). */
export function joinPlayer(w: World, slot: number, name: string, charId: string, color: number): void {
  const existing = w.fighters.find((f) => f.slot === slot);
  if (existing) {
    // place laissée à l'IA : le nouvel arrivant reprend ce combattant
    existing.name = name;
    if (existing.controller === 'ai') setSlotPlayer(w, slot);
    existing.name = name;
    return;
  }
  const team = w.mode === 'duel' ? (w.config.teams ? slot % 2 : slot) : 0;
  const f = makeFighter(w, charId, name, team, 0, color);
  f.slot = slot;
  f.controller = 'player';
  const mates = w.fighters.filter((x) => x.team === 0 && x.slot >= 0 && alive(x));
  const cx = mates.length ? mates.reduce((a, x) => a + x.x, 0) / mates.length : w.camX + C.VIEW_W / 2;
  const left = w.locked ? w.arenaL + 40 : 40;
  const right = (w.locked ? w.arenaR : (w.stage?.width ?? C.VIEW_W)) - 40;
  f.x = q(clamp(cx + (slot % 2 === 0 ? -60 : 60), left, right));
  f.z = [150, 190, 112, 170][slot % 4];
  f.facing = 1;
  f.invuln = 90;
  w.fighters.push(f);
  w.events.push({ t: 'text', x: f.x, y: 140, z: f.z, text: `${name} rejoint la partie !`, color: '#7cff9a' });
  w.events.push({ t: 'sound', id: 'wave' });
  w.events.push({ t: 'text', x: f.x, y: 175, z: f.z, text: `Difficulté adaptée : ${humanCount(w)} joueur${humanCount(w) > 1 ? 's' : ''}`, color: '#ffd166' });
}

/** Un joueur revient : il reprend son combattant (déterministe, à la frame annoncée par le serveur). */
export function setSlotPlayer(w: World, slot: number): void {
  for (const f of w.fighters) {
    if (f.slot === slot && f.controller === 'ai') {
      f.controller = 'player';
      f.ai = null;
      f.name = f.name.replace(/ \(IA\)$/, '');
      f.prevInput = 0;
      f.bufferedInput = 0;
      w.events.push({ t: 'text', x: f.x, y: f.y + 140, z: f.z, text: `${f.name} est de retour !`, color: '#7cff9a' });
    }
  }
}

export function isOver(w: World): boolean {
  return w.phase === 'matchEnd' || w.phase === 'gameOver';
}

export { players as livingPlayers, enemies as currentEnemies, alive as isAlive };
export type { SimEvent };
