import type { BonusId } from './types';

export interface BonusDef {
  id: BonusId;
  name: string;
  desc: string;
  icon: string;
}

export const BONUSES: BonusDef[] = [
  { id: 'power', name: 'Force', desc: 'Dégâts +15 %', icon: '💪' },
  { id: 'speed', name: 'Vitesse', desc: 'Vitesse +12 %, esquive plus longue', icon: '⚡' },
  { id: 'vitality', name: 'Vitalité', desc: 'PV max +30 et soin complet', icon: '❤️' },
  { id: 'lifesteal', name: 'Vampire', desc: 'Vol de vie : +1 PV par coup, +10 par KO', icon: '🩸' },
  { id: 'kiflow', name: 'Siphon de Ki', desc: 'Chaque coup rend du Ki, Ki régénère', icon: '🌀' },
  { id: 'burn', name: 'Pyromane', desc: 'Chaque coup lourd enflamme l\'ennemi', icon: '🔥' },
  { id: 'thorns', name: 'Hérisson', desc: 'Renvoie 25 % des dégâts reçus', icon: '🌵' },
  { id: 'crit', name: 'Dé truqué', desc: 'Critique +15 % (dégâts ×1,6)', icon: '🎲' },
  { id: 'guard', name: 'Bastion', desc: 'Garde régénère 2× plus vite, parade plus large', icon: '🛡️' },
  { id: 'doublejump', name: 'Bottes à ressorts', desc: 'Double saut, onde de choc à l\'atterrissage', icon: '🥾' },
  { id: 'shockwave', name: 'Écho', desc: 'Les coups lourds lancent une onde de choc', icon: '💥' },
  { id: 'explode', name: 'Explosif', desc: 'Les ennemis KO explosent', icon: '🧨' },
  { id: 'midas', name: 'Midas', desc: 'Les KO rapportent 3× plus de pièces', icon: '🪙' },
  { id: 'armor', name: 'Plastron titane', desc: 'Super-armure sur les coups lourds, défense +', icon: '🦾' },
  { id: 'superflow', name: 'Overdrive', desc: 'La jauge de Super monte 2× plus vite', icon: '🌟' },
  { id: 'frost', name: 'Cryogénie', desc: 'Les coups lourds gèlent l\'ennemi', icon: '🧊' },
  { id: 'berserk', name: 'Berserk', desc: 'Dégâts +50 % sous 35 % de PV', icon: '😤' },
  { id: 'phoenix', name: 'Phénix', desc: 'Une fois par stage : on se relève à 50 % de vie', icon: '🔆' },
];

export const BONUS_BY_ID: Record<string, BonusDef> = Object.fromEntries(BONUSES.map((b) => [b.id, b]));
