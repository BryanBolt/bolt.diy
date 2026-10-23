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
    boss: { charId: 'tora', level: 2, name: 'Tora, le videur', line: 'La carte de membre, c\'est 49,90. Ou un KO.', rageLine: 'Bon. On passe au tarif de nuit.' },
    hazard: 'wind',
  },
  {
    id: 'neon',
    name: 'Toits néon',
    tagline: 'Neo-Tokyo, 2 h du matin. Les chats observent, les ninjas aussi.',
    theme: 'neon',
    width: 2300,
    waves: [w(['ninja', 2], ['thug', 2], ['thug', 2]), w(['ninja', 2], ['ninja', 2], ['gunner', 2]), w(['brute', 2], ['ninja', 3], ['shield', 3], ['thug', 3])],
    boss: { charId: 'zed', level: 3, name: 'Zed, l\'ombre louée', line: 'Je ne t\'ai pas vu venir. J\'étais devant toi.', rageLine: 'Tarif double pour les clients qui résistent.', minions: 'ninja' },
    hazard: 'drone',
  },
  {
    id: 'market',
    name: 'Marché de nuit',
    tagline: 'Des lanternes, des nouilles, et une mafia qui n\'aime pas les touristes.',
    theme: 'market',
    width: 2400,
    waves: [w(['thug', 3], ['bomber', 3], ['thug', 3]), w(['brute', 3], ['shield', 3], ['ninja', 3]), w(['bomber', 3], ['bomber', 3], ['thug', 4], ['shield', 4])],
    boss: { charId: 'vex', level: 4, name: 'Vex, la dompteuse', line: 'Mes fouets ont un nom. Celui-là s\'appelle "Facture".', rageLine: 'Et celui-là, "Majoration".' },
    hazard: 'barrel',
  },
  {
    id: 'metro',
    name: 'Métro fantôme',
    tagline: 'Dernière rame. Le conducteur est parti il y a vingt ans.',
    theme: 'metro',
    width: 2600,
    waves: [w(['ninja', 4], ['shield', 4], ['brute', 4]), w(['gunner', 4], ['thug', 5], ['bomber', 5], ['ninja', 4]), w(['brute', 5], ['shield', 5], ['gunner', 5], ['ninja', 5])],
    boss: { charId: 'frost', level: 5, name: 'Frost, le gardien', line: 'Ici, tout le monde descend. Définitivement.', rageLine: 'Terminus. Vraiment.', minions: 'thug' },
    hazard: 'train',
  },
  {
    id: 'tower',
    name: 'Tour de verre',
    tagline: 'Siège social de SYNERGIE S.A. Ils embauchent des "disrupteurs".',
    theme: 'tower',
    width: 2600,
    waves: [w(['thug', 6], ['shield', 6], ['gunner', 6], ['bomber', 6]), w(['brute', 6], ['ninja', 6], ['shield', 6], ['thug', 6]), w(['brute', 7], ['bomber', 7], ['gunner', 7], ['ninja', 7], ['shield', 7])],
    boss: { charId: 'blaze', level: 7, name: 'Blaze, directrice de la stratégie', line: 'On va faire un brainstorming. À coups de pied.', rageLine: 'Pivot stratégique : je vous brûle tous.', minions: 'bomber' },
    hazard: 'wind',
  },
  {
    id: 'core',
    name: 'Cœur de la singularité',
    tagline: 'Une IA a appris le karaté sur des vidéos. Elle a tout compris. Hélas.',
    theme: 'core',
    width: 2800,
    waves: [w(['ninja', 8], ['shield', 8], ['gunner', 8], ['brute', 8]), w(['brute', 8], ['bomber', 8], ['gunner', 9], ['shield', 9], ['ninja', 9]), w(['brute', 9], ['ninja', 9], ['bomber', 9], ['gunner', 9], ['shield', 10], ['thug', 10])],
    boss: { charId: 'nova', level: 10, name: 'NOVA, singularité', line: 'J\'ai analysé 10 000 combats. Tu es le 10 001e. Statistiquement, tu perds.', rageLine: 'Recalcul… Probabilité de défaite : non nulle. Inacceptable.', minions: 'ninja' },
    hazard: 'laser',
  },
];

export const SURVIVAL_STAGE: StageDef = {
  id: 'arena',
  name: 'Arène infinie',
  tagline: 'Jusqu\'au dernier.',
  theme: 'arena',
  width: 1800,
  waves: [],
  boss: { charId: 'gorr', level: 5, name: 'Gorr', line: 'GRRR.', rageLine: 'GRRRRRR !' },
  hazard: 'barrel',
};

export const DUEL_STAGES: StageDef[] = [...STAGES, SURVIVAL_STAGE].map((s) => ({ ...s, width: 1200, waves: [] as WaveSpec[] }));
