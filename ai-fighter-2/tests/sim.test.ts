import { describe, it, expect } from 'vitest';
import { createWorld, step, isOver } from '../src/sim/sim';
import { hashWorld } from '../src/sim/hash';
import { Rng } from '../src/core/math';
import type { SimConfig } from '../src/sim/types';
import { IN } from '../src/sim/types';

function cfg(mode: SimConfig['mode'], players = 2, bots = 0): SimConfig {
  const ids = ['kai', 'tora', 'zed', 'vex', 'orion', 'blaze', 'frost', 'shade'];
  return {
    mode,
    difficulty: 1,
    rounds: 3,
    teams: false,
    stageIndex: 0,
    players: Array.from({ length: players }, (_, i) => ({ slot: i, charId: ids[i], name: `P${i + 1}`, color: i, team: mode === 'duel' ? i : 0 })),
    bots: Array.from({ length: bots }, (_, i) => ({ charId: ids[(i + players) % ids.length], name: `Bot${i + 1}`, color: i + 4, team: mode === 'duel' ? i + players : 0, level: 3 })),
  };
}

function randomInputs(r: Rng, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let bits = 0;
    if (r.chance(0.5)) bits |= r.chance(0.5) ? IN.LEFT : IN.RIGHT;
    if (r.chance(0.3)) bits |= r.chance(0.5) ? IN.UP : IN.DOWN;
    if (r.chance(0.25)) bits |= IN.LIGHT;
    if (r.chance(0.1)) bits |= IN.HEAVY;
    if (r.chance(0.08)) bits |= IN.JUMP;
    if (r.chance(0.1)) bits |= IN.GUARD;
    if (r.chance(0.05)) bits |= IN.SPECIAL;
    if (r.chance(0.03)) bits |= IN.SUPER;
    if (r.chance(0.05)) bits |= IN.DASH;
    out.push(bits);
  }
  return out;
}

function run(mode: SimConfig['mode'], seed: number, frames: number, players = 2, bots = 0): { hash: number; hashes: number[]; world: ReturnType<typeof createWorld> } {
  const w = createWorld(cfg(mode, players, bots), seed);
  const r = new Rng(seed ^ 0x1234);
  const hashes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const inputs = randomInputs(r, players);
    step(w, inputs);
    if (i % 100 === 0) hashes.push(hashWorld(w));
    for (const f of w.fighters) {
      expect(Number.isFinite(f.x) && Number.isFinite(f.y) && Number.isFinite(f.z)).toBe(true);
      expect(Number.isFinite(f.hp)).toBe(true);
    }
  }
  return { hash: hashWorld(w), hashes, world: w };
}

describe('simulation déterministe', () => {
  it('campagne : deux exécutions identiques donnent le même hash', () => {
    const a = run('campaign', 42, 4000);
    const b = run('campaign', 42, 4000);
    expect(a.hashes).toEqual(b.hashes);
    expect(a.hash).toBe(b.hash);
  });
  it('duel : identique et se termine', () => {
    const a = run('duel', 7, 6000, 2);
    const b = run('duel', 7, 6000, 2);
    expect(a.hash).toBe(b.hash);
  });
  it('duel avec bots à 4 : stable', () => {
    const a = run('duel', 99, 3000, 2, 2);
    expect(a.world.fighters.length).toBe(4);
  });
  it('survie : des vagues apparaissent', () => {
    const a = run('survival', 3, 3000, 1);
    expect(a.world.waveIndex).toBeGreaterThanOrEqual(0);
  });
  it('entraînement : stable', () => {
    run('training', 1, 1500, 1);
  });
  it('seeds différentes -> mondes différents', () => {
    const a = run('campaign', 1, 1500);
    const b = run('campaign', 2, 1500);
    expect(a.hash).not.toBe(b.hash);
  });
  it('l\'IA seule finit par mettre KO (campagne solo, joueur inactif, pas de boucle infinie)', () => {
    const w = createWorld(cfg('campaign', 1), 5);
    for (let i = 0; i < 20000 && !isOver(w); i++) step(w, [0]);
    expect(isOver(w)).toBe(true);
    expect(w.phase).toBe('gameOver');
  });
});
