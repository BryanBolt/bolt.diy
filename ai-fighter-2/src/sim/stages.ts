import type { StageDef, WaveSpec, EnemyKind } from './types';

function w(...spec: [EnemyKind, number][]): WaveSpec {
  return { enemies: spec.map(([kind, level]) => ({ kind, level })) };
}

export const STAGES: StageDef[] = [
  {
    id: 'dojo',
    name: 'Dojo de quartier',
    tagline: 'Le sensei a mis un panneau : "Fermé pour cause de bagarre".',
    theme: 'dojo',
    width: 2000,
    waves: [w(['thug', 1], ['thug', 1]), w(['thug', 1], ['thug', 1], ['thug', 2]), w(['brute', 1], ['thug', 2], ['thug', 2])],
    boss: { charId: 'tora', level: 2, name: 'Tora, le videur', line: 'La carte de membre, c\'est 49,90. Ou un KO.' },
  },
  {
    id: 'neon',
    name: 'Toits néon',
    tagline: 'Neo-Tokyo, 2 h du matin. Les chats observent, les ninjas aussi.',
    theme: 'neon',
    width: 2300,
    waves: [w(['ninja', 2], ['thug', 2], ['thug', 2]), w(['ninja', 2], ['ninja', 2], ['gunner', 2]), w(['brute', 2], ['ninja', 3], ['thug', 3], ['thug', 3])],
    boss: { charId: 'zed', level: 3, name: 'Zed, l\'ombre louée', line: 'Je ne t\'ai pas vu venir. J\'étais devant toi.' },
  },
  {
    id: 'market',
    name: 'Marché de nuit',
    tagline: 'Des lanternes, des nouilles, et une mafia qui n\'aime pas les touristes.',
    theme: 'market',
    width: 2400,
    waves: [w(['thug', 3], ['thug', 3], ['gunner', 3]), w(['brute', 3], ['brute', 3], ['ninja', 3]), w(['gunner', 3], ['gunner', 3], ['thug', 4], ['thug', 4])],
    boss: { charId: 'vex', level: 4, name: 'Vex, la dompteuse', line: 'Mes fouets ont un nom. Celui-là s\'appelle "Facture".' },
  },
  {
    id: 'metro',
    name: 'Métro fantôme',
    tagline: 'Dernière rame. Le conducteur est parti il y a vingt ans.',
    theme: 'metro',
    width: 2600,
    waves: [w(['ninja', 4], ['ninja', 4], ['brute', 4]), w(['gunner', 4], ['thug', 5], ['thug', 5], ['ninja', 4]), w(['brute', 5], ['brute', 5], ['gunner', 5], ['ninja', 5])],
    boss: { charId: 'frost', level: 5, name: 'Frost, le gardien', line: 'Ici, tout le monde descend. Définitivement.' },
  },
  {
    id: 'tower',
    name: 'Tour de verre',
    tagline: 'Siège social de SYNERGIE S.A. Ils embauchent des "disrupteurs".',
    theme: 'tower',
    width: 2600,
    waves: [w(['thug', 6], ['thug', 6], ['gunner', 6], ['gunner', 6]), w(['brute', 6], ['ninja', 6], ['ninja', 6], ['thug', 6]), w(['brute', 7], ['brute', 7], ['gunner', 7], ['ninja', 7], ['thug', 7])],
    boss: { charId: 'blaze', level: 7, name: 'Blaze, directrice de la stratégie', line: 'On va faire un brainstorming. À coups de pied.' },
  },
  {
    id: 'core',
    name: 'Cœur de la singularité',
    tagline: 'Une IA a appris le karaté sur des vidéos. Elle a tout compris. Hélas.',
    theme: 'core',
    width: 2800,
    waves: [w(['ninja', 8], ['ninja', 8], ['gunner', 8], ['brute', 8]), w(['brute', 8], ['brute', 8], ['gunner', 9], ['gunner', 9], ['ninja', 9]), w(['brute', 9], ['ninja', 9], ['ninja', 9], ['gunner', 9], ['thug', 10], ['thug', 10])],
    boss: { charId: 'nova', level: 10, name: 'NOVA, singularité', line: 'J\'ai analysé 10 000 combats. Tu es le 10 001e. Statistiquement, tu perds.' },
  },
];

export const SURVIVAL_STAGE: StageDef = {
  id: 'arena',
  name: 'Arène infinie',
  tagline: 'Jusqu\'au dernier.',
  theme: 'arena',
  width: 1800,
  waves: [],
  boss: { charId: 'gorr', level: 5, name: 'Gorr', line: 'GRRR.' },
};

export const DUEL_STAGES: StageDef[] = [...STAGES, SURVIVAL_STAGE].map((s) => ({ ...s, width: 1200, waves: [] as WaveSpec[] }));
