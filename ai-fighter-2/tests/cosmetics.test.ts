import { describe, it, expect } from 'vitest';
import { HATS, AURAS, unlocked, validHat, validAura, cycleCosmetic } from '../shared/cosmetics';
import { createWorld } from '../src/sim/sim';
import type { SimConfig } from '../src/sim/types';

const none = { stageReached: 0, campaignWins: 0, duelWins: 0, bestSurvival: 0, totalKo: 0 };

describe('cosmétiques', () => {
  it('déblocages selon la progression', () => {
    const crown = HATS.find((h) => h.id === 'crown')!;
    expect(unlocked(crown, none)).toBe(false);
    expect(unlocked(crown, { ...none, stageReached: 7 })).toBe(true);
    expect(unlocked(HATS[0], none)).toBe(true);
    expect(unlocked(AURAS.find((a) => a.id === 'gold')!, { ...none, totalKo: 300 })).toBe(true);
  });
  it('seuls les identifiants connus sont acceptés (serveur)', () => {
    expect(validHat('crown')).toBe('crown');
    expect(validHat('<script>')).toBe('');
    expect(validAura('nope')).toBe('');
  });
  it('le cycle saute les cosmétiques verrouillés', () => {
    expect(cycleCosmetic(HATS, '', 1, none)).toBe('cap');
    expect(cycleCosmetic(HATS, 'cap', 1, none)).toBe('');
    expect(cycleCosmetic(HATS, 'cap', 1, { ...none, campaignWins: 1 })).toBe('tophat');
  });
  it('le chapeau et l\'aura choisis sont portés par le combattant', () => {
    const cfg: SimConfig = { mode: 'training', difficulty: 1, rounds: 1, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0, hat: 'wizard', aura: 'fire' }], bots: [] };
    const f = createWorld(cfg, 1).fighters[0];
    expect([f.hat, f.aura]).toEqual(['wizard', 'fire']);
  });
});

import { ACHIEVEMENTS, newlyUnlocked } from '../shared/achievements';
describe('boutique et succès', () => {
  it('un cosmétique payant n\'est débloqué qu\'une fois acheté', () => {
    const cat = HATS.find((h) => h.id === 'cat')!;
    expect(unlocked(cat, none)).toBe(false);
    expect(unlocked(cat, { ...none, owned: ['cat'] })).toBe(true);
  });
  it('les succès se débloquent d\'après le profil, une seule fois', () => {
    const p = { ...none, bestScore: 0, streak: 0, owned: [] as string[], totalKo: 120 };
    const first = newlyUnlocked(p, []);
    expect(first.map((a) => a.id)).toEqual(expect.arrayContaining(['ko10', 'ko100']));
    expect(newlyUnlocked(p, first.map((a) => a.id))).toEqual([]);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});
