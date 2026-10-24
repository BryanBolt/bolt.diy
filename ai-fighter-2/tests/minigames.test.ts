import { describe, it, expect } from 'vitest';
import { createWorld, step, miniCursor, MINI_COUNTDOWN } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig, World } from '../src/sim/types';

function toMini(stageIndex: number): World {
  const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 4);
  w.fighters = w.fighters.filter((f) => f.team === 0);
  w.phase = 'stageClear'; w.phaseTimer = 0;
  step(w, [0]);
  expect(w.phase).toBe('mini');
  return w;
}

describe('mini-jeux entre les stages', () => {
  it('planches : matraquer rapporte des pièces, puis on arrive à l\'échoppe', () => {
    const w = toMini(0);
    expect(w.mini!.kind).toBe('smash');
    const coins = w.coins;
    for (let i = 0; i < MINI_COUNTDOWN; i++) step(w, [0]);
    for (let i = 0; i < 360; i++) step(w, [i % 2 === 0 ? IN.LIGHT : 0]); // 180 coups
    for (let i = 0; i < 20; i++) step(w, [0]);
    expect(w.phase).toBe('shop');
    expect(w.coins - coins).toBe(12 * 4);
  });
  it('timing : appuyer au centre = parfait, au bord = raté', () => {
    const w = toMini(1);
    expect(w.mini!.kind).toBe('timing');
    const coins = w.coins;
    const mp = w.mini!.players[0];
    let hit = 0;
    for (let i = 0; i < 4000 && w.phase === 'mini'; i++) {
      const c = miniCursor(w, mp);
      const press = w.frame - w.mini!.start > MINI_COUNTDOWN && Math.abs(c - 0.5) < 0.02 && hit === mp.round;
      if (press) hit++;
      step(w, [press ? IN.LIGHT : 0]);
      step(w, [0]);
    }
    expect(w.phase).toBe('shop');
    expect(w.coins - coins).toBeGreaterThanOrEqual(50);
  });
});
