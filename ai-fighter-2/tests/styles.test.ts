import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { ROSTER } from '../src/sim/chars';

function duel(charId: string) {
  const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId, name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 8);
  const p = w.fighters.find((f) => f.slot === 0)!;
  const e = w.fighters.find((f) => f.team !== 0)!;
  p.x = 300; p.z = 140; p.facing = 1;
  e.x = 338; e.z = 140; e.ai = null; e.controller = 'player'; e.slot = 3; e.hp = e.hpMax = 900; e.facing = -1;
  return { w, p, e };
}
const swing = (w: ReturnType<typeof duel>['w'], n = 30) => { step(w, [IN.LIGHT]); for (let i = 0; i < n; i++) step(w, [0]); };

describe('style de chaque héros', () => {
  it('chaque héros a une passive et des finisseurs distincts', () => {
    expect(new Set(ROSTER.map((c) => c.passive)).size).toBe(ROSTER.length);
    expect(new Set(ROSTER.map((c) => c.moves.c_cmb_rafale.damage + ':' + c.moves.c_cmb_rafale.startup)).size).toBeGreaterThan(3);
  });
  it('enchaînements de longueurs différentes (2, 3 ou 4 coups)', () => {
    const len = Object.fromEntries(ROSTER.map((c) => [c.id, c.lightChain.length]));
    expect(len.tora).toBe(2); expect(len.gorr).toBe(2); expect(len.kai).toBe(3); expect(len.zed).toBe(4); expect(len.nova).toBe(4);
    for (const c of ROSTER) for (const id of c.lightChain) expect(c.moves[id], `${c.id}.${id}`).toBeDefined();
  });
  it('Blaze enflamme, Frost ralentit, Shade empoisonne dans le dos', () => {
    let { w, e } = duel('blaze'); swing(w); expect(e.status.burn).toBeGreaterThan(0);
    ({ w, e } = duel('frost')); swing(w); expect(e.status.slow).toBeGreaterThan(0);
    const d = duel('shade'); d.e.facing = 1; swing(d.w); expect(d.e.status.poison).toBeGreaterThan(0);
  });
  it('Shade : ×1,5 dans le dos', () => {
    const back = duel('shade'); back.e.facing = 1; swing(back.w);
    const front = duel('shade'); swing(front.w);
    expect(900 - back.e.hp).toBeGreaterThan((900 - front.e.hp) * 1.2);
  });
  it('Zed enchaîne bien 4 coups', () => {
    const { w, p } = duel('zed');
    let maxChain = 0;
    for (let i = 0; i < 90; i++) { step(w, [i % 6 === 0 ? IN.LIGHT : 0]); maxChain = Math.max(maxChain, p.chainIndex); }
    expect(maxChain).toBeGreaterThanOrEqual(3);
  });
});
