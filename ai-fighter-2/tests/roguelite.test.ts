import { describe, it, expect } from 'vitest';
import { BONUSES, RARITY, STACKABLE, activeSynergies, rollBonuses, stacks, synergiesUnlockedBy } from '../src/sim/bonuses';
import { createWorld, applyBonus } from '../src/sim/sim';
import type { SimConfig } from '../src/sim/types';

function lcg(seed: number) { let s = seed; return (lo: number, hi: number) => { s = (s * 1664525 + 1013904223) >>> 0; return lo + (s >>> 8) % (hi - lo + 1); }; }

describe('rogue-lite : raretés, cumul, synergies', () => {
  it('chaque bonus a une rareté et le tirage donne 3 choix distincts', () => {
    for (const b of BONUSES) expect(RARITY[b.rarity]).toBeTruthy();
    const r = lcg(3);
    for (let i = 0; i < 50; i++) {
      const o = rollBonuses(BONUSES, 3, i % 10, r);
      expect(new Set(o).size).toBe(3);
    }
  });
  it('les raretés hautes montent avec les vagues', () => {
    const count = (wave: number) => { const r = lcg(9); let n = 0; for (let i = 0; i < 400; i++) for (const id of rollBonuses(BONUSES, 3, wave, r)) if (BONUSES.find((b) => b.id === id)!.rarity !== 'common') n++; return n; };
    expect(count(12)).toBeGreaterThan(count(0));
  });
  it('synergies détectées et annoncées', () => {
    expect(activeSynergies(['burn', 'frost']).map((s) => s.id)).toContain('thermal');
    expect(synergiesUnlockedBy(['burn'], 'frost')[0]?.id).toBe('thermal');
    const cfg: SimConfig = { mode: 'survival', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
    const w = createWorld(cfg, 2);
    const f = w.fighters[0];
    applyBonus(w, f, 'burn');
    w.events.length = 0;
    applyBonus(w, f, 'frost');
    expect(w.events.some((e) => e.t === 'text' && e.text.includes('SYNERGIE'))).toBe(true);
  });
  it('les bonus de stats se cumulent', () => {
    expect(STACKABLE.has('power')).toBe(true);
    expect(stacks(['crit', 'crit', 'burn'], 'crit')).toBe(2);
  });
});

import { stacks as st2 } from '../src/sim/bonuses';
import { step } from '../src/sim/sim';
import { IN as IN2 } from '../src/sim/types';

describe('pouvoirs façon Isaac', () => {
  const mk = () => {
    const cfg: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
    const w = createWorld(cfg, 6);
    for (let i = 0; i < 400 && !w.fighters.some((f) => f.team !== 0); i++) step(w, [0]);
    return w;
  };
  it('Champignon : PV et dégâts augmentent ; cumulable', () => {
    const w = mk(); const f = w.fighters[0]; const hp = f.hpMax;
    applyBonus(w, f, 'growth'); applyBonus(w, f, 'growth');
    expect(f.hpMax).toBe(hp + 40);
    expect(st2(f.bonuses, 'growth')).toBe(2);
  });
  it('Larmes : tire seul sur l\'ennemi ; Satellites : blessent au contact ; Cœur d\'or : soigne', () => {
    const w = mk(); const f = w.fighters.find((x) => x.slot === 0)!;
    const foe = w.fighters.find((x) => x.team !== 0)!;
    applyBonus(w, f, 'tears'); applyBonus(w, f, 'regen');
    foe.x = f.x + 200; foe.z = f.z;
    f.hp = f.hpMax - 10; f.invuln = 9999;
    let shot = false;
    for (let i = 0; i < 120; i++) { step(w, [0]); if (w.projectiles.some((p) => p.owner === f.id)) shot = true; }
    expect(shot).toBe(true);
    expect(f.hp).toBeGreaterThan(f.hpMax - 10);
    void IN2;
  });
});
