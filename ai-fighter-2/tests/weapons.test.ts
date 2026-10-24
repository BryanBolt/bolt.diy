import { describe, it, expect } from 'vitest';
import { createWorld, step } from '../src/sim/sim';
import { IN, WEAPONS } from '../src/sim/types';
import type { WeaponKind, SimConfig } from '../src/sim/types';

function world() {
  const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
  return createWorld(cfg, 11);
}
const run = (w: ReturnType<typeof world>, frames: number[]) => { for (const b of frames) step(w, [b]); };

describe('armes', () => {
  it('chaque arme se ramasse (objet au sol qui tombe puis rebondit)', () => {
    for (const wk of Object.keys(WEAPONS) as WeaponKind[]) {
      const w = world();
      const p = w.fighters.find((f) => f.slot === 0)!;
      w.items.push({ id: 900, kind: 'weapon', wk, x: p.x + 5, y: 60, z: p.z, vy: 0, vx: 1, life: 900 });
      run(w, Array(90).fill(0));
      expect(p.weaponKind, wk).toBe(wk);
      expect(p.weapon).toBe(WEAPONS[wk].uses);
    }
  });
  it('arme blanche : dégâts et usure, l\'épée use plus vite que rien', () => {
    const w = world();
    const p = w.fighters.find((f) => f.slot === 0)!;
    const e = w.fighters.find((f) => f.team !== 0)!;
    p.weaponKind = 'sword'; p.weapon = 5; p.x = 300; p.z = 140; e.x = 340; e.z = 140; e.ai = null; e.controller = 'player'; e.slot = 3;
    run(w, [IN.LIGHT, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(p.weapon).toBeLessThan(5);
  });
  it('arme lancée : retombe en objet avec sa durabilité restante', () => {
    const w = world();
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.weaponKind = 'axe'; p.weapon = 4;
    run(w, [IN.HEAVY, IN.HEAVY, 0, 0, 0]);
    expect(p.weapon).toBe(0);
    expect(w.projectiles.some((q) => q.wk === 'axe')).toBe(true);
    run(w, Array(140).fill(0));
    const it = w.items.find((i) => i.kind === 'weapon' && i.wk === 'axe');
    expect(it).toBeTruthy();
    expect(it!.uses).toBe(4);
    expect(it!.y).toBe(0);
  });
  it('un katana ne se lance pas ; le fusil tire 5 plombs', () => {
    const w = world();
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.weaponKind = 'katana'; p.weapon = 5;
    run(w, [IN.HEAVY, 0, 0, 0, 0, 0]);
    expect(w.projectiles.some((q) => q.kind === 'bat')).toBe(false);
    const w2 = world();
    const p2 = w2.fighters.find((f) => f.slot === 0)!;
    p2.weaponKind = 'shotgun'; p2.weapon = 3;
    run(w2, [IN.LIGHT, IN.LIGHT]);
    expect(w2.projectiles.filter((q) => q.kind === 'slug').length).toBe(5);
    expect(p2.weapon).toBe(2);
  });
});
describe('menus de fin de niveau', () => {
  it('les appuis des premières frames sont ignorés (anti-martelage)', async () => {
    const { createWorld: cw, step: st } = await import('../src/sim/sim');
    const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
    const w = cw(cfg, 3);
    w.phase = 'waveClear'; w.phaseTimer = 1;
    st(w, [IN.LIGHT]);
    let guard = 0;
    while ((w.phase as string) !== 'bonus' && guard++ < 400) st(w, [IN.LIGHT]);
    expect(w.phase as string).toBe('bonus');
    // on martèle Attaque : rien n'est choisi pendant le verrou
    for (let i = 0; i < 20; i++) st(w, [i % 2 ? IN.LIGHT : 0]);
    expect(w.bonusChoices[0].chosen).toBe(-1);
    for (let i = 0; i < 60; i++) st(w, [0]);
    st(w, [IN.LIGHT]);
    expect(w.bonusChoices.length === 0 || w.bonusChoices[0].chosen >= 0 || (w.phase as string) !== 'bonus').toBe(true);
  });
});
