import type { CharDef, MoveDef, MoveKind, ProjectileDef, SkeletonStyle } from './types';

// ---------------------------------------------------------------------------
// Roster d'AI Fighter 2. Toutes les données de coups sont ici : frames,
// boîtes de collision, dégâts, enchaînements. Les valeurs sont en frames (60/s)
// et en pixels du monde.
// ---------------------------------------------------------------------------

type Partialish = Partial<MoveDef> & { id: string; name: string; anim: string };

function mv(kind: MoveKind, base: Partialish): MoveDef {
  const defaults: Record<MoveKind, Omit<MoveDef, 'id' | 'name' | 'kind' | 'anim'>> = {
    light: { startup: 5, active: 3, recovery: 9, hit: { x: 34, w: 46, y0: 20, y1: 95, z: 30 }, damage: 6, hitstun: 16, blockstun: 10, kbx: 2.2, kby: 0, hitstop: 4, lunge: 1.2, sfx: 'light' },
    heavy: { startup: 13, active: 4, recovery: 20, hit: { x: 40, w: 58, y0: 10, y1: 100, z: 32 }, damage: 14, hitstun: 26, blockstun: 16, kbx: 6, kby: 0, hitstop: 8, lunge: 2.5, knockdown: true, sfx: 'heavy' },
    launcher: { startup: 10, active: 4, recovery: 18, hit: { x: 34, w: 50, y0: 0, y1: 110, z: 32 }, damage: 10, hitstun: 30, blockstun: 14, kbx: 1.5, kby: 11, hitstop: 7, launch: true, lunge: 1.5, sfx: 'heavy' },
    low: { startup: 9, active: 4, recovery: 16, hit: { x: 36, w: 58, y0: 0, y1: 40, z: 30 }, damage: 9, hitstun: 24, blockstun: 12, kbx: 3, kby: 0, hitstop: 6, low: true, knockdown: true, sfx: 'heavy' },
    run: { startup: 6, active: 6, recovery: 16, hit: { x: 36, w: 56, y0: 10, y1: 100, z: 34 }, damage: 11, hitstun: 24, blockstun: 12, kbx: 7, kby: 2, hitstop: 7, lunge: 7, knockdown: true, sfx: 'heavy' },
    air: { startup: 5, active: 6, recovery: 10, hit: { x: 30, w: 50, y0: -30, y1: 60, z: 30 }, damage: 7, hitstun: 18, blockstun: 10, kbx: 3, kby: 0, hitstop: 4, sfx: 'light' },
    airHeavy: { startup: 7, active: 12, recovery: 14, hit: { x: 24, w: 56, y0: -60, y1: 50, z: 34 }, damage: 13, hitstun: 28, blockstun: 14, kbx: 4, kby: 0, hitstop: 8, overhead: true, knockdown: true, lungeAir: -6, sfx: 'heavy' },
    special: { startup: 12, active: 6, recovery: 22, hit: { x: 40, w: 60, y0: 0, y1: 110, z: 36 }, damage: 16, hitstun: 30, blockstun: 16, kbx: 6, kby: 4, hitstop: 8, kiCost: 25, sfx: 'special' },
    special2: { startup: 10, active: 8, recovery: 20, hit: { x: 20, w: 70, y0: 0, y1: 130, z: 40 }, damage: 12, hitstun: 28, blockstun: 14, kbx: 3, kby: 10, hitstop: 7, kiCost: 25, launch: true, invuln: true, sfx: 'special' },
    super: { startup: 14, active: 30, recovery: 30, hit: { x: 50, w: 110, y0: -10, y1: 150, z: 60 }, damage: 40, hitstun: 40, blockstun: 20, kbx: 12, kby: 8, hitstop: 12, superCost: 100, invuln: true, unblockable: true, knockdown: true, multi: { hits: 5, every: 5 }, sfx: 'super' },
    finisher: { startup: 8, active: 4, recovery: 18, hit: { x: 40, w: 56, y0: 10, y1: 100, z: 32 }, damage: 12, hitstun: 30, blockstun: 14, kbx: 8, kby: 3, hitstop: 8, knockdown: true, lunge: 3, sfx: 'heavy' },
  };
  return { kind, ...defaults[kind], ...base } as MoveDef;
}

const KI_SHOT: ProjectileDef = { kind: 'ki', speed: 9, life: 70, damage: 12, radius: 16, y: 55 };

function baseMoves(p: {
  l1: string; l2: string; l3: string; heavy: string; launcher: string; low: string; run: string; air: string; airHeavy: string;
  special: string; special2: string; sup: string;
}): Record<string, MoveDef> {
  return {
    l1: mv('light', { id: 'l1', name: p.l1, anim: 'jab', cancelFrom: 7, next: ['l2', 'heavy', 'launcher', 'special', 'special2', 'super'] }),
    l2: mv('light', { id: 'l2', name: p.l2, anim: 'cross', damage: 7, cancelFrom: 8, next: ['l3', 'heavy', 'launcher', 'special', 'special2', 'super'] }),
    l3: mv('light', { id: 'l3', name: p.l3, anim: 'kick', startup: 7, active: 4, recovery: 14, damage: 10, kbx: 5, hitstun: 22, cancelFrom: 10, next: ['heavy', 'launcher', 'special', 'special2', 'super'], knockdown: false }),
    heavy: mv('heavy', { id: 'heavy', name: p.heavy, anim: 'heavy', next: ['special', 'super'], cancelFrom: 16 }),
    launcher: mv('launcher', { id: 'launcher', name: p.launcher, anim: 'uppercut', next: ['air', 'airHeavy', 'special2', 'super'], cancelFrom: 13 }),
    low: mv('low', { id: 'low', name: p.low, anim: 'sweep', next: ['special', 'super'], cancelFrom: 12 }),
    run: mv('run', { id: 'run', name: p.run, anim: 'knee', next: ['special', 'super'], cancelFrom: 11 }),
    air: mv('air', { id: 'air', name: p.air, anim: 'airkick', next: ['airHeavy'], cancelFrom: 9 }),
    airHeavy: mv('airHeavy', { id: 'airHeavy', name: p.airHeavy, anim: 'dive' }),
    special: mv('special', { id: 'special', name: p.special, anim: 'special', projectile: KI_SHOT }),
    special2: mv('special2', { id: 'special2', name: p.special2, anim: 'rising' }),
    super: mv('super', { id: 'super', name: p.sup, anim: 'super' }),
  };
}

function defineChar(c: Omit<CharDef, 'lightChain' | 'heavy' | 'launcher' | 'low' | 'run' | 'air' | 'airHeavy' | 'special' | 'special2' | 'superMove' | 'playable'> & { playable?: boolean }): CharDef {
  return {
    lightChain: ['l1', 'l2', 'l3'],
    heavy: 'heavy',
    launcher: 'launcher',
    low: 'low',
    run: 'run',
    air: 'air',
    airHeavy: 'airHeavy',
    special: 'special',
    special2: 'special2',
    superMove: 'super',
    playable: true,
    ...c,
  };
}

function patch(moves: Record<string, MoveDef>, id: string, p: Partial<MoveDef>): void {
  moves[id] = { ...moves[id], ...p };
}

// ---- KAI : karatéka équilibré ----------------------------------------------
const kaiMoves = baseMoves({
  l1: 'Jab', l2: 'Gyaku-zuki', l3: 'Mawashi-geri', heavy: 'Coup de hache', launcher: 'Dragon montant', low: 'Balayage', run: 'Genou volant',
  air: 'Coup sauté', airHeavy: 'Talon plongeant', special: 'Onde Ki', special2: 'Lune montante', sup: 'CENT POINGS',
});
patch(kaiMoves, 'super', { multi: { hits: 8, every: 3 }, damage: 7, name: 'CENT POINGS', lunge: 3 });

// ---- TORA : brute muay-thaï --------------------------------------------------
const toraMoves = baseMoves({
  l1: 'Direct', l2: 'Crochet au foie', l3: 'Coude tranchant', heavy: 'Marteau', launcher: 'Uppercut tigre', low: 'Fauche lourde', run: 'Épaule titan',
  air: 'Genou sauté', airHeavy: 'Écrasement', special: 'Rafale tigre', special2: 'Paume sismique', sup: 'HUIT PORTES',
});
patch(toraMoves, 'heavy', { damage: 19, startup: 16, recovery: 24, armor: true, guardBreak: true, kbx: 8 });
patch(toraMoves, 'special', { projectile: undefined, damage: 22, startup: 10, active: 8, lunge: 9, selfKnock: true, knockdown: true, armor: true, hit: { x: 36, w: 64, y0: 0, y1: 110, z: 36 }, anim: 'charge' });
patch(toraMoves, 'special2', { damage: 18, hit: { x: 30, w: 120, y0: 0, y1: 60, z: 60 }, kby: 9, anim: 'slam', invuln: false, armor: true });
patch(toraMoves, 'super', { multi: { hits: 4, every: 7 }, damage: 14, lunge: 2 });

// ---- ZED : ninja vif ---------------------------------------------------------
const zedMoves = baseMoves({
  l1: 'Griffe', l2: 'Double griffe', l3: 'Talon pivot', heavy: 'Lame tournoyante', launcher: 'Envol', low: 'Fouet bas', run: 'Glissade',
  air: 'Rafale aérienne', airHeavy: 'Chute nocturne', special: 'Pluie de kunaï', special2: 'Pas de l\'ombre', sup: 'DANSE DES LAMES',
});
patch(zedMoves, 'l1', { startup: 4, recovery: 7, damage: 5 });
patch(zedMoves, 'l2', { startup: 4, recovery: 7, damage: 5 });
patch(zedMoves, 'heavy', { startup: 10, recovery: 16, damage: 12, multi: { hits: 2, every: 4 } });
patch(zedMoves, 'special', { projectile: { kind: 'shuriken', speed: 12, life: 60, damage: 7, radius: 12, y: 60, count: 3 }, startup: 8, recovery: 16, kiCost: 20 });
patch(zedMoves, 'special2', { teleport: 60, damage: 14, startup: 6, active: 4, recovery: 12, launch: false, knockdown: true, kbx: 7, kby: 2, anim: 'backstab' });
patch(zedMoves, 'super', { multi: { hits: 10, every: 2 }, damage: 5, lunge: 4, active: 24 });

// ---- VEX : fouet d'énergie, allonge ---------------------------------------
const vexMoves = baseMoves({
  l1: 'Claque', l2: 'Fouetté', l3: 'Fouet circulaire', heavy: 'Fouet de liane', launcher: 'Crochet montant', low: 'Fouet rampant', run: 'Piqué',
  air: 'Fouet aérien', airHeavy: 'Fouet plongeant', special: 'Lasso', special2: 'Vrille', sup: 'MILLE FOUETS',
});
for (const id of ['l1', 'l2', 'l3', 'heavy', 'low', 'air']) patch(vexMoves, id, { hit: { ...vexMoves[id].hit, x: vexMoves[id].hit.x + 24, w: vexMoves[id].hit.w + 30 } });
patch(vexMoves, 'special', { projectile: undefined, damage: 14, hit: { x: 90, w: 120, y0: 0, y1: 110, z: 36 }, kbx: -9, kby: 1, hitstun: 34, anim: 'lasso' }); // attire l'ennemi
patch(vexMoves, 'special2', { damage: 10, hit: { x: 0, w: 200, y0: 0, y1: 130, z: 50 }, multi: { hits: 3, every: 5 }, kby: 8 });
patch(vexMoves, 'super', { multi: { hits: 8, every: 3 }, damage: 7, hit: { x: 70, w: 180, y0: -10, y1: 150, z: 60 } });

// ---- ORION : maître du Ki, projectiles --------------------------------------
const orionMoves = baseMoves({
  l1: 'Paume', l2: 'Double paume', l3: 'Pied céleste', heavy: 'Astre brisé', launcher: 'Comète', low: 'Onde basse', run: 'Charge stellaire',
  air: 'Paume aérienne', airHeavy: 'Météore', special: 'Sphère Ki', special2: 'Nova', sup: 'DÉTONATION STELLAIRE',
});
patch(orionMoves, 'special', { projectile: { kind: 'orb', speed: 7, life: 90, damage: 15, radius: 20, y: 55, pierce: true }, kiCost: 25, startup: 10, recovery: 18 });
patch(orionMoves, 'special2', { projectile: { kind: 'ki', speed: 8, life: 60, damage: 9, radius: 14, y: 50, count: 3 }, damage: 0, hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 }, launch: false, invuln: false, anim: 'special', kiCost: 30 });
patch(orionMoves, 'super', { projectile: { kind: 'orb', speed: 5, life: 120, damage: 20, radius: 40, y: 60, pierce: true, count: 3 }, multi: undefined, damage: 18, hit: { x: 40, w: 100, y0: -10, y1: 150, z: 60 }, active: 10, recovery: 26 });

// ---- BLAZE : pyro rushdown ---------------------------------------------------
const blazeMoves = baseMoves({
  l1: 'Poing ardent', l2: 'Croisé brûlant', l3: 'Pied volcanique', heavy: 'Marteau de lave', launcher: 'Geyser', low: 'Traînée de feu', run: 'Torche vivante',
  air: 'Étincelle', airHeavy: 'Météorite', special: 'Boule de feu', special2: 'Colonne de flammes', sup: 'NOVA SOLAIRE',
});
patch(blazeMoves, 'l3', { burnTarget: 90 });
patch(blazeMoves, 'heavy', { burnTarget: 120, damage: 13 });
patch(blazeMoves, 'special', { projectile: { kind: 'fire', speed: 8, life: 70, damage: 13, radius: 18, y: 50 }, burnTarget: 120 });
patch(blazeMoves, 'special2', { burnTarget: 150, damage: 14, hit: { x: 10, w: 80, y0: 0, y1: 180, z: 40 } });
patch(blazeMoves, 'run', { burnTarget: 60 });
patch(blazeMoves, 'super', { burnTarget: 240, damage: 12, multi: { hits: 5, every: 5 }, hit: { x: 20, w: 160, y0: -10, y1: 180, z: 70 } });

// ---- FROST : contrôle de glace ------------------------------------------------
const frostMoves = baseMoves({
  l1: 'Pique de givre', l2: 'Taille glacée', l3: 'Talon polaire', heavy: 'Marteau polaire', launcher: 'Stalagmite', low: 'Glissade gelée', run: 'Avalanche',
  air: 'Éclat', airHeavy: 'Grêlon', special: 'Lame de givre', special2: 'Mur de glace', sup: 'DRAGON DE GLACE',
});
patch(frostMoves, 'heavy', { freezeTarget: 70, damage: 12 });
patch(frostMoves, 'special', { projectile: { kind: 'ice', speed: 10, life: 70, damage: 10, radius: 16, y: 55 }, freezeTarget: 60 });
patch(frostMoves, 'special2', { freezeTarget: 90, damage: 8, hit: { x: 20, w: 90, y0: 0, y1: 140, z: 40 }, kby: 6, launch: false, knockdown: true });
patch(frostMoves, 'super', { freezeTarget: 120, multi: { hits: 4, every: 6 }, damage: 12 });

// ---- SHADE : ombre, contres ----------------------------------------------------
const shadeMoves = baseMoves({
  l1: 'Griffe d\'ombre', l2: 'Croc', l3: 'Faux', heavy: 'Éclipse', launcher: 'Ascension noire', low: 'Ombre rampante', run: 'Ruée',
  air: 'Voile', airHeavy: 'Chute du corbeau', special: 'Forme ombre', special2: 'Miroir', sup: 'NUIT TOTALE',
});
patch(shadeMoves, 'special', { projectile: undefined, teleport: 70, damage: 16, startup: 8, active: 4, recovery: 14, knockdown: true, kbx: 8, anim: 'backstab', invuln: true });
patch(shadeMoves, 'special2', { damage: 20, startup: 4, active: 14, recovery: 18, hit: { x: 10, w: 70, y0: 0, y1: 120, z: 36 }, invuln: true, launch: false, knockdown: true, kbx: 9, anim: 'counter', heal: 8 });
patch(shadeMoves, 'super', { multi: { hits: 6, every: 4 }, damage: 9, teleport: 80 });

// ---- GORR : colosse (déblocable) ----------------------------------------------
const gorrMoves = baseMoves({
  l1: 'Gifle', l2: 'Gifle double', l3: 'Coup de boule', heavy: 'Séisme', launcher: 'Épaule titan', low: 'Balayage lourd', run: 'Colosse',
  air: 'Marteau aérien', airHeavy: 'Chute titan', special: 'Poing volcan', special2: 'Avalanche', sup: 'SÉISME TITAN',
});
for (const id of ['l1', 'l2', 'l3']) patch(gorrMoves, id, { startup: gorrMoves[id].startup + 2, damage: gorrMoves[id].damage + 3 });
patch(gorrMoves, 'heavy', { damage: 24, startup: 18, recovery: 26, armor: true, guardBreak: true, kbx: 9, hit: { x: 40, w: 70, y0: 0, y1: 110, z: 40 } });
patch(gorrMoves, 'special', { projectile: undefined, damage: 24, armor: true, lunge: 6, selfKnock: true, knockdown: true, hit: { x: 36, w: 70, y0: 0, y1: 120, z: 40 }, anim: 'charge' });
patch(gorrMoves, 'special2', { damage: 20, hit: { x: 40, w: 160, y0: 0, y1: 60, z: 70 }, kby: 10, anim: 'slam', invuln: false, armor: true });
patch(gorrMoves, 'super', { multi: { hits: 3, every: 10 }, damage: 20, hit: { x: 30, w: 200, y0: -10, y1: 160, z: 80 } });

// ---- NOVA : boss final (déblocable) ------------------------------------------
const novaMoves = baseMoves({
  l1: 'Frappe binaire', l2: 'Piston', l3: 'Laser court', heavy: 'Frappe sismique', launcher: 'Éclair divin', low: 'Rafale basse', run: 'Charge éclair',
  air: 'Éclair', airHeavy: 'Foudre', special: 'Laser plasma', special2: 'Tempête', sup: 'SINGULARITÉ',
});
patch(novaMoves, 'special', { projectile: { kind: 'bullet', speed: 14, life: 60, damage: 9, radius: 10, y: 55, count: 2, pierce: true }, kiCost: 20, startup: 8, recovery: 14 });
patch(novaMoves, 'special2', { damage: 14, hit: { x: 0, w: 180, y0: 0, y1: 150, z: 60 }, multi: { hits: 3, every: 6 }, kby: 9 });
patch(novaMoves, 'super', { multi: { hits: 6, every: 4 }, damage: 10, projectile: { kind: 'orb', speed: 6, life: 90, damage: 15, radius: 30, y: 60, pierce: true, count: 2 } });

const DEFAULT_SKEL: SkeletonStyle = { scale: 1, thickness: 5, headR: 11, accessory: 'none' };

export const ROSTER: CharDef[] = [
  defineChar({
    id: 'kai', name: 'Kai', title: 'Le karatéka', desc: 'Équilibré. Enchaînements propres, Onde Ki à distance, Lune montante anti-aérienne.',
    color: 0, stats: { speed: 1, power: 1, defense: 1, hpMax: 120, jump: 1, reach: 0 }, moves: kaiMoves,
    skeleton: { accessory: 'headband' },
  }),
  defineChar({
    id: 'tora', name: 'Tora', title: 'Le tigre de Bangkok', desc: 'Lent mais dévastateur. Coups lourds blindés qui brisent la garde.',
    color: 1, stats: { speed: 0.86, power: 1.3, defense: 1.2, hpMax: 150, jump: 0.9, reach: 4 }, moves: toraMoves,
    skeleton: { thickness: 6.5, headR: 12, accessory: 'bands' },
  }),
  defineChar({
    id: 'zed', name: 'Zed', title: 'L\'ombre furtive', desc: 'Très rapide, fragile. Kunaïs en éventail et Pas de l\'ombre derrière la cible.',
    color: 2, stats: { speed: 1.22, power: 0.82, defense: 0.85, hpMax: 95, jump: 1.15, reach: 0 }, moves: zedMoves,
    skeleton: { thickness: 4.2, headR: 10, accessory: 'scarf' },
  }),
  defineChar({
    id: 'vex', name: 'Vex', title: 'La dompteuse', desc: 'Fouet d\'énergie à grande allonge. Le Lasso ramène l\'ennemi à toi.',
    color: 3, stats: { speed: 0.98, power: 0.92, defense: 0.95, hpMax: 110, jump: 1, reach: 18 }, moves: vexMoves,
    skeleton: { thickness: 4.6, accessory: 'ponytail' },
  }),
  defineChar({
    id: 'orion', name: 'Orion', title: 'Le maître du Ki', desc: 'Zoneur : sphères perçantes, éventail de Ki, super à distance.',
    color: 4, stats: { speed: 0.95, power: 1.05, defense: 0.9, hpMax: 105, jump: 1, reach: 0 }, moves: orionMoves,
    skeleton: { accessory: 'halo' },
  }),
  defineChar({
    id: 'blaze', name: 'Blaze', title: 'La pyromane', desc: 'Pression constante : chaque coup lourd enflamme, dégâts sur la durée.',
    color: 5, stats: { speed: 1.08, power: 1.05, defense: 0.9, hpMax: 105, jump: 1.05, reach: 0 }, moves: blazeMoves,
    skeleton: { accessory: 'flamehair' },
  }),
  defineChar({
    id: 'frost', name: 'Frost', title: 'Le gardien polaire', desc: 'Contrôle : gèle l\'ennemi sur place, Mur de glace défensif.',
    color: 6, stats: { speed: 0.94, power: 1, defense: 1.1, hpMax: 125, jump: 0.95, reach: 2 }, moves: frostMoves,
    skeleton: { accessory: 'hood' },
  }),
  defineChar({
    id: 'shade', name: 'Shade', title: 'Le contre-attaquant', desc: 'Technique : Miroir contre les coups, Forme ombre traverse les ennemis.',
    color: 7, stats: { speed: 1.05, power: 1, defense: 0.95, hpMax: 110, jump: 1.05, reach: 0 }, moves: shadeMoves,
    skeleton: { accessory: 'cape' },
  }),
  defineChar({
    id: 'gorr', name: 'Gorr', title: 'Le colosse', desc: 'Énorme. Tout fait mal. Débloqué en finissant le stage 3.',
    color: 8, stats: { speed: 0.78, power: 1.5, defense: 1.4, hpMax: 190, jump: 0.8, reach: 10 }, moves: gorrMoves,
    unlock: { kind: 'stage', value: 3 }, skeleton: { scale: 1.2, thickness: 8, headR: 13, accessory: 'horns' },
  }),
  defineChar({
    id: 'nova', name: 'Nova', title: 'La singularité', desc: 'IA de combat finale. Débloquée en finissant la campagne.',
    color: 9, stats: { speed: 1.1, power: 1.15, defense: 1.05, hpMax: 130, jump: 1.1, reach: 2 }, moves: novaMoves,
    unlock: { kind: 'stage', value: 6 }, skeleton: { accessory: 'visor' },
  }),
];

export const CHARS: Record<string, CharDef> = Object.fromEntries(ROSTER.map((c) => [c.id, c]));

export function getChar(id: string): CharDef {
  return CHARS[id] ?? CHARS.kai;
}

export function skeletonStyle(c: CharDef): SkeletonStyle {
  return { ...DEFAULT_SKEL, ...(c.skeleton ?? {}) };
}

// ---- Ennemis de campagne -------------------------------------------------------
// Les ennemis utilisent des versions bridées des héros (mêmes systèmes, IA différente).
export const ENEMY_CHAR: Record<string, string> = {
  thug: 'kai',
  brute: 'tora',
  ninja: 'zed',
  gunner: 'orion',
};

export const ENEMY_NAMES: Record<string, string[]> = {
  thug: ['Voyou', 'Loubard', 'Sbire', 'Gros bras'],
  brute: ['Brute', 'Videur', 'Cogneur', 'Molosse'],
  ninja: ['Ombre', 'Furtif', 'Lame', 'Assassin'],
  gunner: ['Tireur', 'Sniper', 'Canonnier', 'Artilleur'],
};

export const PALETTE: { name: string; main: string; dark: string; glow: string }[] = [
  { name: 'Rouge', main: '#ff4d4d', dark: '#8a1c1c', glow: '#ff9a9a' },
  { name: 'Orange', main: '#ff9f1c', dark: '#8a4b00', glow: '#ffd08a' },
  { name: 'Vert', main: '#39d353', dark: '#146b26', glow: '#9af5a8' },
  { name: 'Rose', main: '#ff5fb0', dark: '#8a1c5c', glow: '#ffb3dc' },
  { name: 'Bleu', main: '#4d8bff', dark: '#1c3f8a', glow: '#a3c4ff' },
  { name: 'Feu', main: '#ff6a2a', dark: '#8a2a00', glow: '#ffb38a' },
  { name: 'Cyan', main: '#3ad6ff', dark: '#0e5c73', glow: '#a9ecff' },
  { name: 'Violet', main: '#a86bff', dark: '#4b1c8a', glow: '#d3b8ff' },
  { name: 'Brun', main: '#c98a4b', dark: '#5c3a16', glow: '#ebc69c' },
  { name: 'Blanc', main: '#eef2ff', dark: '#6b7280', glow: '#ffffff' },
  { name: 'Jaune', main: '#ffe14d', dark: '#8a7400', glow: '#fff3a3' },
  { name: 'Acier', main: '#9aa7b8', dark: '#3b4452', glow: '#d6dde8' },
];
