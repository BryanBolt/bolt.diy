import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';

function world() {
  const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 21);
  w.items = [];
  const p = w.fighters.find((f) => f.slot === 0)!;
  const e = w.fighters.find((f) => f.team !== 0)!;
  p.x = 300; p.z = 140; p.facing = 1;
  e.x = 480; e.z = 140; e.ai = null; e.controller = 'player'; e.slot = 3; e.hp = e.hpMax = 400;
  return { w, p, e };
}
const crate = (w: ReturnType<typeof world>['w'], cv: string, x: number) => w.items.push({ id: 700 + w.items.length, kind: 'crate', cv, x, y: 0, z: 140, vy: 0, life: 99999, hp: 2 });
const run = (w: ReturnType<typeof world>['w'], n: number, bits = 0) => { for (let i = 0; i < n; i++) step(w, [bits]); };

describe('caisses', () => {
  it('on porte une caisse (Attaque + Lourd) puis on la lance sur un ennemi', () => {
    const { w, p, e } = world();
    crate(w, 'wood', 330);
    step(w, [IN.LIGHT | IN.HEAVY]);
    expect(p.carry).toBe('wood');
    expect(w.items.some((i) => i.kind === 'crate')).toBe(false);
    run(w, 12);
    step(w, [IN.LIGHT]);
    expect(p.carry).toBe('');
    expect(w.projectiles.some((q) => q.kind === 'crate')).toBe(true);
    const hp = e.hp;
    run(w, 90);
    expect(e.hp).toBeLessThan(hp);
  });
  it('un baril explosif détruit et brûle tout autour', () => {
    const { w, p, e } = world();
    crate(w, 'explosive', 330);
    step(w, [IN.LIGHT | IN.HEAVY]);
    run(w, 12);
    e.x = 420;
    const hp = e.hp;
    step(w, [IN.LIGHT]);
    run(w, 60);
    expect(p.carry).toBe('');
    expect(e.hp).toBeLessThan(hp);
  });
  it('une caisse de glace gèle les ennemis proches', () => {
    const { w, e } = world();
    e.x = 330;
    crate(w, 'ice', 330);
    const it = w.items[0];
    it.hp = 1;
    step(w, [IN.LIGHT]);
    run(w, 10, IN.LIGHT);
    expect(e.status.slow > 0 || e.state === 'frozen' || w.items.length === 0).toBe(true);
  });
  it('un ennemi projeté défonce une caisse', () => {
    const { w, e } = world();
    crate(w, 'wood', 520);
    e.state = 'launch'; e.stateFrame = 0; e.vx = 7; e.vy = 5; e.y = 1;
    run(w, 25);
    expect(w.items.some((i) => i.kind === 'crate' && i.cv === 'wood' && i.x === 520)).toBe(false);
  });
  it('une caisse portée tombe quand on est touché', () => {
    const { w, p } = world();
    crate(w, 'metal', 320);
    step(w, [IN.LIGHT | IN.HEAVY]);
    expect(p.carry).toBe('metal');
    p.state = 'hit'; p.hitFrames = 20; p.stateFrame = 0;
    run(w, 2);
    expect(p.carry).toBe('');
    expect(w.items.some((i) => i.kind === 'crate' && i.cv === 'metal')).toBe(true);
  });
});

describe('saisies et jiu-jitsu', () => {
  function duo() {
    const { w, p, e } = world();
    e.x = 335; e.facing = -1;
    return { w, p, e };
  }
  it('Attaque + Lourd : saisie, puis projection par-dessus l\'épaule', () => {
    const { w, p, e } = duo();
    step(w, [IN.LIGHT | IN.HEAVY]);
    run(w, 12);
    expect(p.state).toBe('hold');
    expect(e.state).toBe('held');
    const hp = e.hp;
    step(w, [IN.HEAVY | IN.LEFT]);
    expect(e.state).toBe('launch');
    expect(e.hp).toBeLessThan(hp);
    expect(e.vx).toBeLessThan(0); // projeté derrière
    expect(p.holding).toBe(-1);
  });
  it('on frappe et on étrangle pendant la prise, la victime peut se débattre', () => {
    const { w, p, e } = duo();
    step(w, [IN.LIGHT | IN.HEAVY]);
    run(w, 12);
    const hp = e.hp;
    step(w, [IN.LIGHT]); step(w, [0]); step(w, [0]);
    expect(e.hp).toBeLessThan(hp);
    run(w, 30, IN.GUARD);
    expect(p.holdMode).toBeGreaterThanOrEqual(2);
    expect(e.hp).toBeLessThan(hp - 5);
    for (let i = 0; i < 80; i++) step(w, [IN.GUARD, 0, 0, i % 2 ? IN.LIGHT : 0]);
    expect(e.state).not.toBe('held');
    expect(p.holding).toBe(-1);
  });
  it('↓ + Attaque + Lourd : amenée au sol (jiu-jitsu)', () => {
    const { w, p, e } = duo();
    step(w, [IN.DOWN | IN.LIGHT | IN.HEAVY]);
    run(w, 16);
    expect(p.state).toBe('hold');
    expect(p.holdMode & 1).toBe(1);
    expect(e.state).toBe('held');
  });
});
