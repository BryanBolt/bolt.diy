import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { FORMS } from '../src/sim/forms';

function world(charId = 'kai') {
  const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId, name: 'A', color: 0, team: 0 }], bots: [] };
  return createWorld(cfg, 5);
}

describe('recharge de ki et transformations', () => {
  it('Ki maintenu : le héros charge, puis se transforme à ki plein', () => {
    for (const id of Object.keys(FORMS)) {
      const w = world(id);
      const p = w.fighters.find((f) => f.slot === 0)!;
      const base = { power: p.stats.power, speed: p.stats.speed };
      p.ki = 0;
      let charged = false;
      for (let i = 0; i < 400 && p.form === 0; i++) { step(w, [IN.SPECIAL]); if (p.state === 'charge') charged = true; }
      expect(charged, id).toBe(true);
      expect(p.form, id).toBeGreaterThan(0);
      expect(p.stats.power, id).toBeCloseTo(base.power * FORMS[id].power, 5);
      // la forme prend fin et les stats reviennent
      for (let i = 0; i < 1000 && p.form > 0; i++) step(w, [0]);
      for (let i = 0; i < 1000 && p.form > 0; i++) step(w, [0]);
      expect(p.form, id).toBe(0);
      expect(p.stats.power, id).toBeCloseTo(base.power, 5);
      expect(p.stats.speed, id).toBeCloseTo(base.speed, 5);
    }
  });
  it('relâcher le bouton interrompt la charge', () => {
    const w = world();
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.ki = 0;
    for (let i = 0; i < 40; i++) step(w, [IN.SPECIAL]);
    expect(p.state).toBe('charge');
    const ki = p.ki;
    for (let i = 0; i < 10; i++) step(w, [0]);
    expect(p.state).not.toBe('charge');
    expect(p.ki).toBeGreaterThan(5);
    expect(p.ki).toBeLessThanOrEqual(ki + 1);
  });
});
