import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import type { SimConfig, World } from '../src/sim/types';

function bossWorld(): World {
  const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 8);
  w.waveIndex = w.stage!.waves.length - 1; // la vague suivante est le boss
  w.fighters = w.fighters.filter((f) => f.team === 0);
  for (let i = 0; i < 1500 && !w.fighters.some((f) => f.ai?.kind === 'boss'); i++) { step(w, [0]); if (w.phase === 'fight' && !w.fighters.some((f) => f.team !== 0)) w.phase = 'fight'; }
  return w;
}

describe('boss : zones annoncées et point faible', () => {
  it('le boss annonce une zone, elle explose, puis le point faible amplifie les dégâts', () => {
    const w = bossWorld();
    const boss = w.fighters.find((f) => f.ai?.kind === 'boss');
    expect(boss).toBeTruthy();
    boss!.stats.speed = 0; // reste en place
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.hp = p.hpMax = 99999;
    let warn = 0, boom = 0, weak = false;
    for (let i = 0; i < 900; i++) {
      step(w, [0]);
      for (const e of w.events) { if (e.t === 'zone') { if (e.phase === 'warn') warn++; else boom++; } }
      if (w.bossWeak > 0) weak = true;
    }
    expect(warn).toBeGreaterThan(0);
    expect(boom).toBe(warn);
    expect(weak).toBe(true);
  });
});
