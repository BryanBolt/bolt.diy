import type { BonusId } from './types';

export interface BonusDef {
  id: BonusId;
  name: string;
  desc: string;
  icon: string;
  rarity: Rarity;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export const RARITY: Record<Rarity, { label: string; color: string; weight: number }> = {
  common: { label: 'Commun', color: '#cfd8e3', weight: 60 },
  rare: { label: 'Rare', color: '#5ab0ff', weight: 28 },
  epic: { label: 'Épique', color: '#c77dff', weight: 10 },
  legendary: { label: 'Légendaire', color: '#ffb830', weight: 3 },
};

export const BONUSES: BonusDef[] = [
  { id: 'power', name: 'Force', desc: 'Dégâts +15 %', icon: '💪', rarity: 'common' },
  { id: 'speed', name: 'Vitesse', desc: 'Vitesse +12 %, esquive plus longue', icon: '⚡', rarity: 'common' },
  { id: 'vitality', name: 'Vitalité', desc: 'PV max +30 et soin complet', icon: '❤️', rarity: 'common' },
  { id: 'lifesteal', name: 'Vampire', desc: 'Vol de vie : +1 PV par coup, +10 par KO', icon: '🩸', rarity: 'rare' },
  { id: 'kiflow', name: 'Siphon de Ki', desc: 'Chaque coup rend du Ki, Ki régénère', icon: '🌀', rarity: 'common' },
  { id: 'burn', name: 'Pyromane', desc: 'Chaque coup lourd enflamme l\'ennemi', icon: '🔥', rarity: 'rare' },
  { id: 'thorns', name: 'Hérisson', desc: 'Renvoie 25 % des dégâts reçus', icon: '🌵', rarity: 'rare' },
  { id: 'crit', name: 'Dé truqué', desc: 'Critique +15 % (dégâts ×1,6)', icon: '🎲', rarity: 'common' },
  { id: 'guard', name: 'Bastion', desc: 'Garde régénère 2× plus vite, parade plus large', icon: '🛡️', rarity: 'common' },
  { id: 'doublejump', name: 'Bottes à ressorts', desc: 'Double saut, onde de choc à l\'atterrissage', icon: '🥾', rarity: 'rare' },
  { id: 'shockwave', name: 'Écho', desc: 'Les coups lourds lancent une onde de choc', icon: '💥', rarity: 'rare' },
  { id: 'explode', name: 'Explosif', desc: 'Les ennemis KO explosent', icon: '🧨', rarity: 'epic' },
  { id: 'midas', name: 'Midas', desc: 'Les KO rapportent 3× plus de pièces', icon: '🪙', rarity: 'rare' },
  { id: 'armor', name: 'Plastron titane', desc: 'Super-armure sur les coups lourds, défense +', icon: '🦾', rarity: 'rare' },
  { id: 'superflow', name: 'Overdrive', desc: 'La jauge de Super monte 2× plus vite', icon: '🌟', rarity: 'common' },
  { id: 'frost', name: 'Cryogénie', desc: 'Les coups lourds gèlent l\'ennemi', icon: '🧊', rarity: 'rare' },
  { id: 'berserk', name: 'Berserk', desc: 'Dégâts +50 % sous 35 % de PV', icon: '😤', rarity: 'epic' },
  { id: 'orbital', name: 'Satellites', desc: 'Des orbes tournent autour de toi et frappent les ennemis (+1 orbe par prise)', icon: '🪐', rarity: 'rare' },
  { id: 'tears', name: 'Larmes de feu', desc: 'Tu tires seul vers l\'ennemi le plus proche (cadence + à chaque prise)', icon: '💧', rarity: 'rare' },
  { id: 'growth', name: 'Champignon géant', desc: 'Tu grandis : PV +20, dégâts +10 %, taille bien visible', icon: '🍄', rarity: 'common' },
  { id: 'regen', name: 'Cœur d\'or', desc: 'Regain de vie en continu (+ à chaque prise)', icon: '💛', rarity: 'common' },
  { id: 'phoenix', name: 'Phénix', desc: 'Une fois par stage : on se relève à 50 % de vie', icon: '🔆', rarity: 'legendary' },
];

export const BONUS_BY_ID: Record<string, BonusDef> = Object.fromEntries(BONUSES.map((b) => [b.id, b]));

/** Bonus cumulables : reprendre le même augmente son effet. */
export const STACKABLE = new Set<string>(['power', 'speed', 'vitality', 'crit', 'lifesteal', 'thorns', 'kiflow', 'superflow', 'orbital', 'tears', 'growth', 'regen', 'armor', 'guard']);

export interface Synergy { id: string; name: string; needs: [BonusId, BonusId]; desc: string }
export const SYNERGIES: Synergy[] = [
  { id: 'thermal', name: 'Choc thermique', needs: ['burn', 'frost'], desc: '+30 % de dégâts sur cible brûlée ou gelée' },
  { id: 'bloodlust', name: 'Soif de sang', needs: ['lifesteal', 'berserk'], desc: 'Berserk dès 60 % de PV' },
  { id: 'chain', name: 'Réaction en chaîne', needs: ['explode', 'shockwave'], desc: 'Explosions de KO +50 %' },
  { id: 'fortress', name: 'Forteresse', needs: ['armor', 'guard'], desc: '-15 % de dégâts subis' },
  { id: 'cosmos', name: 'Système solaire', needs: ['orbital', 'burn'], desc: 'Les orbes enflamment' },
  { id: 'jackpot', name: 'Jackpot', needs: ['midas', 'crit'], desc: 'Les critiques font jaillir des pièces' },
];

export function stacks(bonuses: readonly BonusId[], b: BonusId): number {
  let n = 0;
  for (const x of bonuses) if (x === b) n++;
  return n;
}

export function activeSynergies(bonuses: readonly BonusId[]): Synergy[] {
  return SYNERGIES.filter((sy) => bonuses.includes(sy.needs[0]) && bonuses.includes(sy.needs[1]));
}

/** Synergies que ce bonus débloquerait. */
export function synergiesUnlockedBy(bonuses: readonly BonusId[], b: BonusId): Synergy[] {
  if (bonuses.includes(b)) return [];
  return SYNERGIES.filter((sy) => (sy.needs[0] === b && bonuses.includes(sy.needs[1])) || (sy.needs[1] === b && bonuses.includes(sy.needs[0])));
}

/** Tirage pondéré par rareté ; les raretés hautes deviennent plus fréquentes avec les vagues. */
export function rollBonuses(pool: BonusDef[], count: number, wave: number, int: (lo: number, hi: number) => number): BonusId[] {
  const out: BonusId[] = [];
  const left = pool.slice();
  const boost = 1 + Math.min(wave, 12) * 0.12;
  while (out.length < count && left.length) {
    const wt = left.map((b) => RARITY[b.rarity].weight * (b.rarity === 'common' ? 1 : boost));
    const total = wt.reduce((a, c) => a + c, 0);
    let roll = int(0, 9999) / 10000 * total;
    let idx = 0;
    for (; idx < left.length - 1; idx++) { roll -= wt[idx]; if (roll < 0) break; }
    out.push(left[idx].id);
    left.splice(idx, 1);
  }
  return out;
}
