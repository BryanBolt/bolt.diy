import { STAGES } from '../src/sim/stages';
import { describe, it, expect } from 'vitest';
import { createWorld, step, setSlotAi, isOver } from '../src/sim/sim';
import type { SimConfig, SimEvent } from '../src/sim/types';

function cfg(): SimConfig {
  return { mode: 'campaign', difficulty: 0, rounds: 3, teams: false, stageIndex: 0,
    players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'tora', name: 'B', color: 1, team: 0 }], bots: [] };
}

describe('campagne complète (IA aux commandes)', () => {
  it('se termine, passe par les dangers, la furie des boss, la boutique et les bonus', () => {
    const w = createWorld(cfg(), 2024);
    setSlotAi(w, 0);
    setSlotAi(w, 1);
    const seen = new Set<string>();
    const phases = new Set<string>();
    let frames = 0;
    while (!isOver(w) && frames < 60 * 60 * 30) {
      step(w, []);
      frames++;
      for (const e of w.events as SimEvent[]) {
        if (e.t === 'hazard') seen.add(`hazard:${e.kind}`);
        if (e.t === 'rage') seen.add('rage');
        if (e.t === 'zone') seen.add('zone:' + e.phase);
        if (e.t === 'phase') phases.add(e.phase);
        if (e.t === 'counter') seen.add('counter');
        if (e.t === 'wall') seen.add('wall');
      }
      for (const f of w.fighters) expect(Number.isFinite(f.x) && Number.isFinite(f.hp)).toBe(true);
    }
    expect(isOver(w)).toBe(true);
    expect(w.phase).toBe('matchEnd');
    expect(phases.has('bonus')).toBe(true);
    expect(phases.has('shop')).toBe(true);
    expect(seen.has('rage')).toBe(true);
    expect(seen.has('zone:warn') && seen.has('zone:boom')).toBe(true);
    expect([...seen].filter((s) => s.startsWith('hazard:')).length).toBeGreaterThanOrEqual(3);
    expect(seen.has('counter')).toBe(true);
    expect(w.stageIndex).toBe(STAGES.length - 1);
  });
});
