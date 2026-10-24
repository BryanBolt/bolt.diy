import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { STAGES } from '../src/sim/stages';

function apex(gravity: number): number {
  const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, gravity, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 3);
  const p = w.fighters.find((f) => f.slot === 0)!;
  let max = 0;
  step(w, [IN.JUMP]);
  for (let i = 0; i < 260; i++) { step(w, [0]); max = Math.max(max, p.y); }
  return max;
}

describe('gravité', () => {
  it('lunaire et apesanteur : on saute plus haut et on retombe plus lentement, sans dépasser le plafond', () => {
    const a = apex(0), b = apex(1), c = apex(2);
    expect(b).toBeGreaterThan(a * 1.4);
    expect(c).toBeGreaterThan(a);
    expect(c).toBeLessThanOrEqual(281);
  });
  it('Abysses : gravité réduite, on nage en maintenant Saut', () => {
    const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: STAGES.length - 1, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
    const w = createWorld(cfg, 4);
    expect(w.grav).toBeCloseTo(0.3, 5);
    const p = w.fighters.find((f) => f.slot === 0)!;
    for (let i = 0; i < 200; i++) step(w, [i === 150 ? IN.JUMP : 0]);
    let y = 0;
    for (let i = 0; i < 90; i++) { step(w, [IN.JUMP]); y = Math.max(y, p.y); }
    expect(y).toBeGreaterThan(160);
  });
});
