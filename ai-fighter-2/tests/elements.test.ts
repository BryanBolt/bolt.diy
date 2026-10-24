import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';

function duel(charId: string, stageIndex = 0, mode: SimConfig['mode'] = 'training') {
  const cfg: SimConfig = {
    mode, difficulty: 1, rounds: 3, teams: false, stageIndex,
    players: [{ slot: 0, charId, name: 'A', color: 0, team: 0 }],
    bots: [{ charId: 'tora', name: 'B', color: 1, team: 1, level: 0 }],
  };
  const w = createWorld(cfg, 5);
  const a = w.fighters.find((f) => f.slot === 0)!;
  const t = w.fighters.find((f) => f !== a)!;
  if (t) { t.x = a.x + 60; t.z = a.z; } a.facing = 1;
  return { w, a, t };
}

function texts(w: ReturnType<typeof duel>['w'], frames: number, input: number, setup: () => void) {
  const out: string[] = [];
  for (let i = 0; i < frames; i++) {
    setup();
    step(w, [input]);
    for (const e of w.events) if (e.t === 'text') out.push(e.text);
  }
  return out;
}

describe('réactions élémentaires', () => {
  it('feu sur cible ralentie : FONTE', () => {
    const { w, t } = duel('blaze');
    const out = texts(w, 60, IN.LIGHT, () => { t.status.slow = 100; t.hp = 999; });
    expect(out.some((s) => s.includes('FONTE'))).toBe(true);
  });
  it('givre sur cible mouillée : GEL TOTAL', () => {
    const { w, t } = duel('frost');
    const out = texts(w, 60, IN.LIGHT, () => { t.status.wet = 200; t.hp = 999; });
    expect(out.some((s) => s.includes('GEL'))).toBe(true);
  });
  it('les Abysses mouillent les combattants', () => {
    const { w, a } = duel('kai', 6, 'campaign');
    for (let i = 0; i < 10; i++) step(w, [0]);
    expect(a.status.wet).toBeGreaterThan(0);
  });
});
