import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig, World } from '../src/sim/types';

function world(mode: 'campaign' | 'survival', stageIndex = 0): World {
  const cfg: SimConfig = { mode, difficulty: 1, rounds: 3, teams: false, stageIndex, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  return createWorld(cfg, 21);
}

describe('game design : élites, esquive parfaite, récompenses', () => {
  it('des ennemis d\'élite apparaissent plus loin dans la campagne', () => {
    let seen = 0;
    for (let seed = 1; seed < 12 && !seen; seed++) {
      const w = createWorld({ mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 5, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] }, seed);
      for (let i = 0; i < 300; i++) step(w, [0]);
      seen += w.fighters.filter((f) => f.affix).length;
    }
    expect(seen).toBeGreaterThan(0);
  });
  it('mini-boss en survie à la vague 10', () => {
    const w = world('survival');
    w.waveIndex = 8;
    for (const f of w.fighters) if (f.team !== 0) { f.hp = 0; f.state = 'ko'; }
    for (let i = 0; i < 400; i++) step(w, [0]);
    w.chest = null;
    w.phase = 'fight'; w.waveIndex = 8; w.locked = false;
    for (let i = 0; i < 30; i++) step(w, [0]);
    expect(w.fighters.some((f) => f.ai?.kind === 'boss')).toBe(true);
  });
  it('le boss vaincu donne un coffre légendaire avant la fin du stage', () => {
    const w = world('campaign');
    w.waveIndex = w.stage!.waves.length;
    for (let i = 0; i < 300 && !w.fighters.some((f) => f.ai?.kind === 'boss'); i++) step(w, [0]);
    for (const f of w.fighters) if (f.team !== 0) { f.hp = 0; f.state = 'ko'; }
    for (let i = 0; i < 400 && w.phase !== 'chest'; i++) step(w, [0]);
    expect(w.phase).toBe('chest');
    expect(w.chest!.tier).toBe(3);
    w.chest!.wait = 20 * 60;
    for (let i = 0; i < 300 && w.phase !== 'bonus'; i++) step(w, [0]);
    for (let i = 0; i < 80; i++) step(w, [0]);
    for (let i = 0; i < 40 * 60 && w.phase === 'bonus'; i++) step(w, [IN.LIGHT * (i % 2)]);
    expect(w.phase).toBe('stageClear');
  });
});
