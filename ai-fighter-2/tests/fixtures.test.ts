import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { STAGES } from '../src/sim/stages';
import type { SimConfig, World } from '../src/sim/types';

function world(stageIndex: number): World {
  const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  const w = createWorld(cfg, 3);
  for (let i = 0; i < 400 && w.fighters.filter((f) => f.team !== 0).length === 0; i++) step(w, [0]);
  return w;
}

function fling(w: World, id: string): { hpBefore: number; foe: World['fighters'][number] } {
  const fx = w.fixtures.find((f) => f.kind === id)!;
  const foe = w.fighters.find((f) => f.team !== 0)!;
  foe.x = fx.x - 30; foe.z = fx.z; foe.y = 20;
  foe.state = 'launch'; foe.stateFrame = 0; foe.vx = 8; foe.vy = 2;
  const hpBefore = foe.hp;
  step(w, [0]);
  return { hpBefore, foe };
}

describe('stages interactifs', () => {
  it('chaque stage a son élément interactif', () => {
    expect(STAGES.map((s) => s.fixture)).toEqual(['paper', 'sign', 'stall', 'rail', 'window', 'pylon', 'current']);
  });
  it('cloison du dojo : dégâts puis détruite', () => {
    const w = world(0);
    const { hpBefore, foe } = fling(w, 'paper');
    expect(foe.hp).toBeLessThan(hpBefore);
    expect(w.fixtures.find((f) => f.kind === 'paper' && f.used)).toBeTruthy();
  });
  it('baie vitrée de la tour : défenestration (KO immédiat d\'un ennemi ordinaire)', () => {
    const w = world(4);
    const { foe } = fling(w, 'window');
    expect(foe.state).toBe('ko');
  });
  it('enseigne néon : réutilisable après sa recharge', () => {
    const w = world(1);
    fling(w, 'sign');
    const sign = w.fixtures.find((f) => f.kind === 'sign' && f.cd > 0);
    expect(sign).toBeTruthy();
    expect(sign!.used).toBe(false);
  });
});
