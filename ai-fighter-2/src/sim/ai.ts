// IA des ennemis et des bots. Produit un bitmask d'entrées comme un joueur :
// le reste de la simulation ne fait aucune différence entre humain et IA.
// Entièrement déterministe (utilise le générateur du monde).

import { IN } from './types';
import type { World, Fighter } from './types';
import { getChar } from './chars';
import { rand, randInt } from './sim';
import * as C from './constants';

function isAlive(f: Fighter): boolean {
  return f.state !== 'ko';
}

function pickTarget(w: World, f: Fighter): Fighter | null {
  let best: Fighter | null = null;
  let bd = Infinity;
  for (const o of w.fighters) {
    if (o === f || o.team === f.team || !isAlive(o)) continue;
    // les ennemis préfèrent les joueurs humains, puis la proximité
    const d = Math.abs(o.x - f.x) + Math.abs(o.z - f.z) * 0.7 + (o.controller === 'player' ? 0 : 80) + (o.state === 'down' ? 120 : 0);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function aiInput(w: World, f: Fighter): number {
  const ai = f.ai;
  if (!ai) return 0;
  if (f.state === 'ko' || f.state === 'down' || f.state === 'hit' || f.state === 'launch' || f.state === 'frozen' || f.state === 'stagger') {
    // sortie de sol plus rapide pour les boss
    return 0;
  }
  ai.timer--;
  if ((ai.kind === 'gunner' || ai.kind === 'bomber' || ai.kind === 'boss') && f.ki < C.KI_MAX) f.ki = Math.min(C.KI_MAX, f.ki + (ai.kind === 'boss' ? 0.15 : 0.25));
  // éviter les dangers de stage
  for (const h of w.hazards) {
    if (h.state === 'idle') continue;
    if (h.kind === 'train' && f.z < C.Z_MIN + 50) return IN.DOWN;
    if (h.kind === 'laser' && h.state === 'active' && Math.abs(h.x - f.x) < 60 && f.y === 0) return IN.JUMP;
    if (h.kind === 'barrel' && h.state === 'active' && Math.abs(h.z - f.z) < 34 && Math.abs(h.x - f.x) < 90 && f.y === 0) return IN.JUMP;
  }
  let target = w.fighters.find((o) => o.id === ai.target && isAlive(o)) ?? null;
  if (!target || ai.timer <= 0 || rand(w) < 0.01) {
    target = pickTarget(w, f);
    ai.target = target ? target.id : -1;
  }
  if (!target) {
    // plus d'ennemi : en campagne, un bot avance vers la droite pour déclencher la vague suivante
    if (!w.locked && (w.mode === 'campaign' || w.mode === 'survival') && f.team === 0 && w.phase === 'fight') return IN.RIGHT | ((w.frame + f.id) % 90 < 45 ? 0 : IN.DASH);
    return 0;
  }
  if (ai.intent === 'wait' && ai.aggro === 0) return 0; // mannequin

  const c = getChar(f.charId);
  const kind = ai.kind;
  const dx = target.x - f.x;
  const dz = target.z - f.z;
  const adx = Math.abs(dx);
  const adz = Math.abs(dz);
  const dirTo = dx >= 0 ? 1 : -1;
  const isBoss = kind === 'boss' || kind === 'bot';
  const react = C.DIFF_REACT[w.difficulty] + (isBoss ? 0.12 : 0) + ai.level * 0.012;
  const range = kind === 'gunner' ? 260 : kind === 'bomber' ? 220 : kind === 'brute' ? 72 : kind === 'ninja' ? 58 : kind === 'shield' ? 60 : 64;
  const meleeRange = 62 + f.stats.reach;

  // --- limite du nombre d'attaquants simultanés sur une même cible ---
  let attackers = 0;
  for (const o of w.fighters) {
    if (o !== f && o.team === f.team && o.ai && o.ai.target === target.id && (o.ai.intent === 'attack' || o.state === 'attack')) attackers++;
  }
  const crowded = attackers >= (isBoss ? 3 : 2);

  // --- choix d'intention ---
  if (ai.timer <= 0) {
    ai.timer = randInt(w, 14, 40);
    const r = rand(w);
    const low = f.hp < f.hpMax * 0.25;
    if (low && r < 0.25 && !isBoss) ai.intent = 'retreat';
    else if (crowded && r < 0.7) ai.intent = 'flank';
    else if ((kind === 'gunner' || kind === 'bomber') && adx < 150 && r < 0.6) ai.intent = 'retreat';
    else if (kind === 'shield' && adx < 90 && r < 0.55) ai.intent = 'guard';
    else if (adx > range + 16 || adz > 18) ai.intent = 'approach';
    else if (r < ai.aggro) ai.intent = 'attack';
    else if (r < ai.aggro + 0.15) ai.intent = 'guard';
    else ai.intent = 'wait';
  }

  let inp = 0;
  // --- réaction défensive : la cible attaque et nous regarde ---
  const targetAttacking = target.state === 'attack' && target.stateFrame <= 12 && target.facing === -dirTo && adx < 130 && adz < 36;
  if (targetAttacking && f.state !== 'attack' && rand(w) < (kind === 'shield' ? 0.85 : react)) {
    if (rand(w) < 0.5 || kind === 'brute' || kind === 'shield') {
      inp |= IN.GUARD; // parade/garde
      if (f.state === 'guard') inp |= IN.GUARD;
    } else {
      // esquive en profondeur
      inp |= IN.GUARD | (dz >= 0 ? IN.UP : IN.DOWN);
    }
    return inp;
  }
  // projectile entrant : saut ou garde
  for (const p of w.projectiles) {
    if (p.team === f.team) continue;
    if (Math.abs(p.z - f.z) < 36 && Math.abs(p.x - f.x) < 120 && Math.sign(p.vx) === (p.x < f.x ? 1 : -1) && rand(w) < react * 1.5) {
      return rand(w) < 0.5 ? IN.JUMP : IN.GUARD;
    }
  }

  // anti-chevauchement entre alliés
  for (const o of w.fighters) {
    if (o === f || o.team !== f.team || !isAlive(o)) continue;
    if (Math.abs(o.x - f.x) < 36 && Math.abs(o.z - f.z) < 24) {
      inp |= o.z > f.z ? IN.UP : IN.DOWN;
      if (f.z <= C.Z_MIN + 5) { inp &= ~IN.UP; inp |= IN.DOWN; }
      if (f.z >= C.Z_MAX - 5) { inp &= ~IN.DOWN; inp |= IN.UP; }
    }
  }

  switch (ai.intent) {
    case 'approach': {
      if (adz > 10) inp |= dz > 0 ? IN.DOWN : IN.UP;
      if (adx > range - 10) {
        inp |= dirTo > 0 ? IN.RIGHT : IN.LEFT;
        if (adx > 220 && (isBoss || kind === 'ninja')) inp |= IN.DASH;
      }
      // ninja : téléportation d'approche
      if (kind === 'ninja' && adx > 180 && f.ki >= 25 && rand(w) < 0.02) inp |= IN.SPECIAL | IN.DOWN;
      if (adx <= range && adz <= 14) { ai.intent = 'attack'; ai.timer = randInt(w, 10, 30); }
      break;
    }
    case 'flank': {
      // tourne autour à distance moyenne
      const want = range + 70;
      if (adx < want - 10) inp |= dirTo > 0 ? IN.LEFT : IN.RIGHT;
      else if (adx > want + 30) inp |= dirTo > 0 ? IN.RIGHT : IN.LEFT;
      if (adz < 40) inp |= f.z < 140 ? IN.DOWN : IN.UP;
      break;
    }
    case 'retreat': {
      inp |= dirTo > 0 ? IN.LEFT : IN.RIGHT;
      if ((kind === 'gunner' || kind === 'bomber') && f.ki >= 20 && adz < 24 && rand(w) < 0.08) inp |= IN.SPECIAL;
      if (adx > 230) ai.intent = kind === 'gunner' || kind === 'bomber' ? 'attack' : 'approach';
      break;
    }
    case 'guard': {
      inp |= IN.GUARD;
      if (adx < 40 && kind !== 'shield') inp |= dirTo > 0 ? IN.LEFT : IN.RIGHT;
      // le bouclier riposte au coup lourd quand la cible finit son coup
      if (kind === 'shield' && adx < meleeRange && target.state === 'attack' && target.stateFrame > 10 && rand(w) < 0.3) { inp = IN.HEAVY | (dirTo > 0 ? IN.RIGHT : IN.LEFT); }
      break;
    }
    case 'wait': {
      // se déplace légèrement pour rester vivant
      if ((w.frame + f.id * 7) % 40 < 10) inp |= dz > 0 ? IN.DOWN : IN.UP;
      if (adx > range + 60) ai.intent = 'approach';
      break;
    }
    case 'attack': {
      if (adz > 14) { inp |= dz > 0 ? IN.DOWN : IN.UP; }
      // se tourner vers la cible
      if (f.facing !== dirTo && f.state !== 'attack') inp |= dirTo > 0 ? IN.RIGHT : IN.LEFT;
      if (f.state === 'attack') break; // le tampon gère l'enchaînement ci-dessous
      const cadence = (w.frame + f.id * 3) % (f.rage ? 3 : isBoss ? 5 : kind === 'ninja' ? 6 : 9) === 0;
      if (!cadence) break;
      const r = rand(w);
      const superReady = f.superMeter >= C.SUPER_MAX;
      const kiReady = f.ki >= 25;
      if (kind === 'gunner' || kind === 'bomber') {
        if (adx > 100 && kiReady && adz < (kind === 'bomber' ? 30 : 20)) inp |= IN.SPECIAL;
        else if (adx < meleeRange + 10) inp |= r < 0.7 ? IN.LIGHT : IN.HEAVY;
        else inp |= dirTo > 0 ? IN.RIGHT : IN.LEFT;
        break;
      }
      if (adx > meleeRange + 20) {
        if (isBoss && kiReady && c.moves[c.special].projectile && r < 0.5) inp |= IN.SPECIAL;
        else if (adx < 160 && r < 0.35) inp |= IN.LIGHT | IN.DASH | (dirTo > 0 ? IN.RIGHT : IN.LEFT); // attaque de course
        else inp |= dirTo > 0 ? IN.RIGHT : IN.LEFT;
        break;
      }
      // en portée
      if (isBoss && superReady && r < 0.6) { inp |= IN.SUPER; break; }
      if (target.state === 'launch' && isBoss && r < 0.5) { inp |= IN.JUMP; break; }
      if (f.y > 0) { inp |= r < 0.5 ? IN.LIGHT : IN.HEAVY; break; }
      switch (kind) {
        case 'brute':
          if (kiReady && r < 0.3) inp |= IN.SPECIAL;
          else if (r < 0.55) inp |= IN.HEAVY;
          else if (r < 0.75) inp |= IN.HEAVY | (dirTo > 0 ? IN.RIGHT : IN.LEFT);
          else inp |= IN.LIGHT;
          break;
        case 'shield':
          if (r < 0.5) inp |= IN.HEAVY;
          else if (r < 0.7) inp |= IN.HEAVY | (dirTo > 0 ? IN.LEFT : IN.RIGHT);
          else if (r < 0.85) inp |= IN.LIGHT;
          else inp |= IN.GUARD;
          break;
        case 'ninja':
          if (r < 0.6) inp |= IN.LIGHT;
          else if (r < 0.75) inp |= IN.JUMP;
          else if (kiReady && r < 0.85) inp |= IN.SPECIAL;
          else inp |= IN.HEAVY | (dirTo > 0 ? IN.RIGHT : IN.LEFT);
          break;
        case 'boss':
        case 'bot':
          if (kiReady && r < 0.25) inp |= IN.SPECIAL | (rand(w) < 0.5 ? IN.DOWN : 0);
          else if (r < 0.55) inp |= IN.LIGHT;
          else if (r < 0.7) inp |= IN.HEAVY | (dirTo > 0 ? IN.RIGHT : IN.LEFT); // lanceur
          else if (r < 0.82) inp |= IN.HEAVY | (dirTo > 0 ? IN.LEFT : IN.RIGHT); // balayage
          else if (r < 0.9) inp |= IN.HEAVY;
          else inp |= IN.GUARD | (dirTo > 0 ? IN.RIGHT : IN.LEFT); // roulade à travers
          break;
        default:
          if (r < 0.7) inp |= IN.LIGHT;
          else if (r < 0.85) inp |= IN.HEAVY;
          else inp |= IN.HEAVY | (dirTo > 0 ? IN.LEFT : IN.RIGHT);
          break;
      }
      break;
    }
  }
  // enchaînements : continue de marteler LIGHT pendant un enchaînement léger réussi
  if (f.state === 'attack' && f.moveHits.length > 0 && f.chainIndex > 0 && f.chainIndex < 3 && (w.frame + f.id) % 4 === 0) {
    const r = rand(w);
    inp |= r < 0.75 ? IN.LIGHT : IN.HEAVY | (dirTo > 0 ? IN.RIGHT : IN.LEFT);
  }
  // lanceur touché -> poursuite aérienne (boss / bots)
  if (isBoss && f.state === 'attack' && f.moveId === c.launcher && f.moveHits.length > 0 && f.stateFrame > 12) inp |= IN.JUMP | IN.LIGHT;
  return inp;
}
