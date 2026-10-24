import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig, World } from '../src/sim/types';

function world(): World {
  const cfg: SimConfig = { mode: 'survival', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 11);
  for (let i = 0; i < 400 && !w.fighters.some((f) => f.team !== 0); i++) step(w, [0]);
  return w;
}
const clear = (w: World) => { for (const f of w.fighters) if (f.team !== 0) f.hp = 0, f.state = 'ko'; };

describe('coffre de fin de vague et salles bonus', () => {
  it('la vague finie fait apparaître un coffre ; le frapper de près l\'ouvre, puis choix du bonus', () => {
    const w = world();
    clear(w);
    for (let i = 0; i < 400 && w.phase !== 'chest'; i++) step(w, [0]);
    expect(w.phase).toBe('chest');
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.x = w.chest!.x; p.z = w.chest!.z;
    for (let i = 0; i < 4; i++) step(w, [0]);
    step(w, [IN.LIGHT]);
    expect(w.chest!.opening).toBeGreaterThan(0);
    const coins = w.coins;
    for (let i = 0; i < 120 && w.phase === 'chest'; i++) step(w, [0]);
    expect(w.phase).toBe('bonus');
    expect(w.coins).toBeGreaterThan(coins);
  });
  it('sans personne près du coffre il s\'ouvre tout seul au bout de 20 s', () => {
    const w = world();
    clear(w);
    for (let i = 0; i < 400 && w.phase !== 'chest'; i++) step(w, [0]);
    for (let i = 0; i < 20 * 60 + 200 && w.phase === 'chest'; i++) step(w, [0]);
    expect(w.phase).toBe('bonus');
  });
  it('une vague sur deux : choix de salle ; la fontaine donne +1 vie et soigne', () => {
    const w = world();
    w.waveIndex = 1;
    clear(w);
    for (let i = 0; i < 400 && w.phase !== 'chest'; i++) step(w, [0]);
    w.chest!.wait = 20 * 60;
    for (let i = 0; i < 200 && w.phase !== 'bonus'; i++) step(w, [0]);
    for (let i = 0; i < 80; i++) step(w, [0]);
    for (let i = 0; i < 40 * 60 && w.phase === 'bonus'; i++) step(w, [IN.LIGHT * (i % 2)]);
    expect(w.phase).toBe('rooms');
    w.rooms!.options = ['heal', 'forge', 'gold'];
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.hp = 10; const lives = p.lives;
    for (let i = 0; i < 70; i++) step(w, [0]);
    step(w, [IN.LIGHT]);
    expect(w.phase).toBe('fight');
    expect(p.hp).toBeGreaterThan(10 + p.hpMax * 0.5);
    expect(p.lives).toBe(lives + 1);
  });
});
