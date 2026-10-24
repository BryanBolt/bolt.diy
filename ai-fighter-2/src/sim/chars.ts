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

const DEFAULT_SKEL: SkeletonStyle = { scale: 1, thickness: 5, headR: 11, accessory: 'none', torso: 1, legs: 1, arms: 1, trim: '', stance: 'agile' };

export const ROSTER: CharDef[] = [
  defineChar({
    id: 'kai', name: 'Kai', title: 'Le karatéka', desc: 'Équilibré. Enchaînements propres, Onde Ki à distance, Lune montante anti-aérienne.',
    color: 0, stats: { speed: 1, power: 1, defense: 1, hpMax: 120, jump: 1, reach: 0 }, moves: kaiMoves,
    skeleton: { accessory: 'headband', trim: 'belt gloves', stance: 'karate' },
  }),
  defineChar({
    id: 'tora', name: 'Tora', title: 'Le tigre de Bangkok', desc: 'Lent mais dévastateur. Coups lourds blindés qui brisent la garde.',
    color: 1, stats: { speed: 0.86, power: 1.3, defense: 1.2, hpMax: 150, jump: 0.9, reach: 4 }, moves: toraMoves,
    skeleton: { thickness: 6.5, headR: 12, accessory: 'bands', torso: 0.94, legs: 0.9, arms: 1.12, trim: 'gloves belt', stance: 'boxer' },
  }),
  defineChar({
    id: 'zed', name: 'Zed', title: 'L\'ombre furtive', desc: 'Très rapide, fragile. Kunaïs en éventail et Pas de l\'ombre derrière la cible.',
    color: 2, stats: { speed: 1.22, power: 0.82, defense: 0.85, hpMax: 95, jump: 1.15, reach: 0 }, moves: zedMoves,
    skeleton: { thickness: 4.2, headR: 10, accessory: 'scarf', legs: 1.1, trim: 'boots', stance: 'ninja' },
  }),
  defineChar({
    id: 'vex', name: 'Vex', title: 'La dompteuse', desc: 'Fouet d\'énergie à grande allonge. Le Lasso ramène l\'ennemi à toi.',
    color: 3, stats: { speed: 0.98, power: 0.92, defense: 0.95, hpMax: 110, jump: 1, reach: 18 }, moves: vexMoves,
    skeleton: { thickness: 4.6, accessory: 'ponytail', legs: 1.08, trim: 'gloves boots', stance: 'whip' },
  }),
  defineChar({
    id: 'orion', name: 'Orion', title: 'Le maître du Ki', desc: 'Zoneur : sphères perçantes, éventail de Ki, super à distance.',
    color: 4, stats: { speed: 0.95, power: 1.05, defense: 0.9, hpMax: 105, jump: 1, reach: 0 }, moves: orionMoves,
    skeleton: { accessory: 'halo', torso: 1.05, arms: 1.06, trim: 'sash', stance: 'monk' },
  }),
  defineChar({
    id: 'blaze', name: 'Blaze', title: 'La pyromane', desc: 'Pression constante : chaque coup lourd enflamme, dégâts sur la durée.',
    color: 5, stats: { speed: 1.08, power: 1.05, defense: 0.9, hpMax: 105, jump: 1.05, reach: 0 }, moves: blazeMoves,
    skeleton: { accessory: 'flamehair', trim: 'boots gloves', stance: 'agile' },
  }),
  defineChar({
    id: 'frost', name: 'Frost', title: 'Le gardien polaire', desc: 'Contrôle : gèle l\'ennemi sur place, Mur de glace défensif.',
    color: 6, stats: { speed: 0.94, power: 1, defense: 1.1, hpMax: 125, jump: 0.95, reach: 2 }, moves: frostMoves,
    skeleton: { accessory: 'hood', legs: 1.04, trim: 'sash gloves', stance: 'monk' },
  }),
  defineChar({
    id: 'shade', name: 'Shade', title: 'Le contre-attaquant', desc: 'Technique : Miroir contre les coups, Forme ombre traverse les ennemis.',
    color: 7, stats: { speed: 1.05, power: 1, defense: 0.95, hpMax: 110, jump: 1.05, reach: 0 }, moves: shadeMoves,
    skeleton: { accessory: 'cape', torso: 1.04, legs: 1.06, trim: 'belt', stance: 'ninja' },
  }),
  defineChar({
    id: 'gorr', name: 'Gorr', title: 'Le colosse', desc: 'Énorme. Tout fait mal. Débloqué en finissant le stage 3.',
    color: 8, stats: { speed: 0.78, power: 1.5, defense: 1.4, hpMax: 190, jump: 0.8, reach: 10 }, moves: gorrMoves,
    unlock: { kind: 'stage', value: 3 }, skeleton: { scale: 1.2, thickness: 8, headR: 13, accessory: 'horns', torso: 0.96, arms: 1.06, trim: 'gloves belt', stance: 'boxer' },
  }),
  defineChar({
    id: 'nova', name: 'Nova', title: 'La singularité', desc: 'IA de combat finale. Débloquée en finissant la campagne.',
    color: 9, stats: { speed: 1.1, power: 1.15, defense: 1.05, hpMax: 130, jump: 1.1, reach: 2 }, moves: novaMoves,
    unlock: { kind: 'stage', value: 6 }, skeleton: { accessory: 'visor', trim: 'sash boots', stance: 'whip' },
  }),
];

export const CHARS: Record<string, CharDef> = Object.fromEntries(ROSTER.map((c) => [c.id, c]));

// ---------------------------------------------------------------------------
// Commandes de combat (communes à tous les héros, façon jeux de combat) :
// quarts de cercle, dragon montant, tourbillon, saisies, poing éclair…
// Les notations suivent le pavé numérique, relatives au regard du combattant :
// 6 = avant, 4 = arrière, 2 = bas (vers l'écran), 8 = haut (vers le fond), 3 = bas-avant.
// ---------------------------------------------------------------------------
export interface CommandInfo {
  id: string;
  name: string;
  input: string; // saisie lisible
  assist: string; // raccourci manette/tactile
  note: string;
  cost: string;
}

export const COMMANDS: CommandInfo[] = [
  { id: 'c_fire', name: 'Boule de Ki', input: '↓ ↘ → + Attaque', assist: 'Spécial + avant', note: 'Projectile (feu, glace ou sphère selon le héros)', cost: '12 Ki' },
  { id: 'c_superfire', name: 'Grande boule de Ki', input: '↓ ↘ → ↓ ↘ → + Attaque', assist: 'Spécial + avant, jauge Super ≥ 50', note: 'Énorme projectile perçant', cost: '50 Super' },
  { id: 'c_dp', name: 'Dragon montant', input: '→ ↓ ↘ + Attaque', assist: 'Spécial + haut', note: 'Anti-aérien invincible au départ, projette en l\'air', cost: '15 Ki' },
  { id: 'c_tatsu', name: 'Tourbillon', input: '↓ ↙ ← + Lourd', assist: 'Spécial + arrière', note: 'Pied tournoyant à 4 coups qui avance', cost: '15 Ki' },
  { id: 'c_hundred', name: 'Cent pieds', input: '↓ ↘ → + Lourd', assist: '—', note: 'Rafale de 6 coups de pied', cost: '20 Ki' },
  { id: 'c_sonic', name: 'Onde basse', input: '← → + Attaque', assist: '—', note: 'Projectile rapide à ras du sol', cost: 'gratuit' },
  { id: 'c_flash', name: 'Salto éclair', input: '↓ ↑ + Lourd', assist: '—', note: 'Salto invincible, projette en l\'air', cost: 'gratuit' },
  { id: 'c_grab', name: 'Saisie', input: 'Attaque + Lourd', assist: '—', note: 'Imparable par la garde, projette l\'adversaire', cost: 'gratuit' },
  { id: 'c_piledriver', name: 'Piledriver (360°)', input: 'tour complet + Attaque', assist: '—', note: 'Saisie dévastatrice au corps à corps', cost: '30 Super' },
  { id: 'c_onein', name: 'Poing d\'un pouce', input: '↘ + Attaque', assist: '—', note: 'Frappe très courte, très puissante, brise-garde', cost: '10 Ki' },
  { id: 'c_ewgf', name: 'Poing éclair', input: '→ N ↓ ↘ + Attaque', assist: '—', note: 'Lanceur ultra rapide, ouvre les jongles', cost: '10 Ki' },
  { id: 'c_hop', name: 'Coup-sauté', input: '↘ + Lourd', assist: '—', note: 'Frappe haute (il faut garder debout) qui lance', cost: 'gratuit' },
  { id: 'c_side', name: 'Coup latéral', input: '→ + Attaque', assist: '—', note: 'Longue allonge, continue en enchaînement', cost: 'gratuit' },
  { id: 'c_wave', name: 'Onde Tonnerre (Kamehameha)', input: '↓ ↙ ← + Attaque', assist: '—', note: 'Immense rayon perçant', cost: '25 Ki' },
  { id: 'c_rocket', name: 'Poing fusée (Rocket Punch)', input: '← → + Lourd', assist: '—', note: 'Poing projectile perçant', cost: '14 Ki' },
  { id: 'c_falcon', name: 'Poing du faucon (Falcon Punch)', input: '→ ↓ ↘ + Lourd', assist: '—', note: 'Départ lent, blindé, dégâts énormes', cost: '30 Ki' },
  { id: 'c_meteor', name: 'Météores (Pegasus / Hokuto)', input: '↓ ↙ ← ↓ ↙ ← + Attaque', assist: '—', note: 'Pluie de 14 poings', cost: '40 Ki' },
  { id: 'c_purple', name: 'Pourpre vide (Hollow Purple)', input: '↓ ↙ ← ↓ ↙ ← + Lourd', assist: '—', note: 'Sphère géante qui efface tout', cost: '60 Super' },
  { id: 'c_omni', name: 'Omnislash', input: '↓ ↘ → ↓ ↘ → + Lourd', assist: '—', note: 'Bondit sur la cible et la hache en 10 coups', cost: '50 Super' },
  { id: 'c_serious', name: 'Coup sérieux (Serious Punch)', input: 'tour complet + Lourd', assist: '—', note: 'Un seul coup. Presque tout est KO', cost: '40 Super' },
  { id: 'c_step', name: 'Pas éclair (Shunpo / Hiraishin)', input: '↓ ↓ (double tap) + Lourd', assist: '—', note: 'Téléportation derrière la cible + frappe', cost: '8 Ki' },
  { id: 'c_rasen', name: 'Sphère tournoyante (Rasengan)', input: '↓ ↑ + Attaque', assist: '—', note: 'Sphère de Ki au corps à corps, 6 touches', cost: '20 Ki' },
  { id: 'c_rider', name: 'Rider Kick', input: 'En l\'air : → + Lourd', assist: '—', note: 'Coup de pied plongeant diagonal', cost: '8 Ki' },
  { id: 'c_cmb_rafale', name: 'Rafale', input: 'P P P puis E', assist: 'Attaque ×3 puis Ki', note: 'Finisseur : 8 coups rapides', cost: '18 Ki' },
  { id: 'c_cmb_tempete', name: 'Tempête de pieds', input: 'K K K puis E', assist: 'Lourd ×3 puis Ki', note: 'Finisseur : 7 coups de pied', cost: '18 Ki' },
  { id: 'c_cmb_briseur', name: 'Briseur', input: 'P K P puis E', assist: '—', note: 'Finisseur : lanceur pour jongler', cost: '15 Ki' },
  { id: 'c_cmb_seisme', name: 'Séisme', input: 'P P K puis E', assist: '—', note: 'Finisseur : onde de choc au sol', cost: '22 Ki' },
  { id: 'c_cmb_spirale', name: 'Spirale', input: 'K P K puis E', assist: '—', note: 'Finisseur : tourbillon qui avance', cost: '20 Ki' },
  { id: 'c_cmb_dragon', name: 'Dragon', input: 'P K K puis E', assist: '—', note: 'Finisseur : anti-aérien invincible', cost: '18 Ki' },
  { id: 'c_cmb_ecrase', name: 'Écrasement', input: 'K K P puis E', assist: '—', note: 'Finisseur : choc blindé, projette', cost: '25 Ki' },
  { id: 'c_cmb_eclair', name: 'Fente éclair', input: 'K P P puis E', assist: '—', note: 'Finisseur : fente qui projette loin', cost: '12 Ki' },
  { id: 'c_flurry', name: 'Rafale du dragon', input: 'Attaque ×4', assist: '—', note: '6 coups de poing éclair en fin d\'enchaînement', cost: 'gratuit' },
  { id: 'c_airflying', name: 'Coup volant', input: 'En l\'air : → + Attaque', assist: '—', note: 'Longue glissade aérienne', cost: 'gratuit' },
];

function commandMoves(c: CharDef): Record<string, MoveDef> {
  const sp = c.moves[c.special]?.projectile;
  const kind = sp && (sp.kind === 'fire' || sp.kind === 'ice' || sp.kind === 'orb') ? sp.kind : 'ki';
  const m: Record<string, MoveDef> = {};
  m.c_fire = mv('special', { id: 'c_fire', hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 }, damage: 0, name: 'Boule de Ki', anim: 'special', startup: 11, active: 3, recovery: 22, kiCost: 12, burnTarget: kind === 'fire' ? 100 : undefined, freezeTarget: kind === 'ice' ? 45 : undefined, projectile: { kind, speed: 8.5, life: 80, damage: 13, radius: 18, y: 55 } });
  m.c_superfire = mv('special', { id: 'c_superfire', hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 }, damage: 0, name: 'Grande boule de Ki', anim: 'super', startup: 16, active: 4, recovery: 30, superCost: 50, invuln: true, projectile: { kind: kind === 'ki' ? 'orb' : kind, speed: 7, life: 110, damage: 24, radius: 46, y: 60, pierce: true } });
  m.c_dp = mv('launcher', { id: 'c_dp', name: 'Dragon montant', anim: 'rising', startup: 5, active: 12, recovery: 30, damage: 14, hit: { x: 16, w: 64, y0: 0, y1: 150, z: 36 }, launch: true, kbx: 2, kby: 12, hitstop: 8, lunge: 3, lungeAir: 11, invuln: true, kiCost: 15, multi: { hits: 2, every: 6 } });
  m.c_tatsu = mv('heavy', { id: 'c_tatsu', name: 'Tourbillon', anim: 'tatsu', startup: 8, active: 22, recovery: 18, damage: 7, hit: { x: 6, w: 76, y0: 0, y1: 100, z: 36 }, kbx: 3, kby: 2, hitstun: 20, hitstop: 4, knockdown: false, lunge: 4.5, selfKnock: true, kiCost: 15, multi: { hits: 4, every: 5 } });
  m.c_hundred = mv('heavy', { id: 'c_hundred', name: 'Cent pieds', anim: 'flurrykick', startup: 6, active: 18, recovery: 22, damage: 4, hit: { x: 30, w: 76, y0: 0, y1: 90, z: 32 }, kbx: 1.4, kby: 0, hitstun: 18, hitstop: 3, knockdown: false, lunge: 0, kiCost: 20, multi: { hits: 6, every: 3 } });
  m.c_sonic = mv('special', { id: 'c_sonic', hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 }, damage: 0, name: 'Onde basse', anim: 'special', startup: 7, active: 2, recovery: 18, kiCost: 0, projectile: { kind: 'ki', speed: 13, life: 60, damage: 9, radius: 13, y: 28 } });
  m.c_flash = mv('launcher', { id: 'c_flash', name: 'Salto éclair', anim: 'flash', startup: 5, active: 10, recovery: 26, damage: 13, hit: { x: 10, w: 60, y0: 20, y1: 140, z: 36 }, launch: true, kbx: 2, kby: 11, hitstop: 8, lungeAir: 12, lunge: -1.5, invuln: true });
  m.c_grab = mv('heavy', { id: 'c_grab', name: 'Saisie', anim: 'grab', startup: 6, active: 3, recovery: 28, damage: 16, hit: { x: 22, w: 46, y0: 10, y1: 100, z: 26 }, unblockable: true, knockdown: true, kbx: 8, kby: 8, hitstop: 10 });
  m.c_piledriver = mv('heavy', { id: 'c_piledriver', name: 'Piledriver', anim: 'slam', startup: 8, active: 3, recovery: 40, damage: 30, hit: { x: 20, w: 46, y0: 10, y1: 100, z: 26 }, unblockable: true, knockdown: true, kbx: 3, kby: 4, hitstop: 16, superCost: 30, invuln: true });
  m.c_onein = mv('heavy', { id: 'c_onein', name: "Poing d'un pouce", anim: 'cross', startup: 9, active: 3, recovery: 20, damage: 19, hit: { x: 14, w: 42, y0: 20, y1: 100, z: 28 }, kbx: 12, kby: 3, knockdown: true, hitstop: 12, kiCost: 10, guardBreak: true });
  m.c_ewgf = mv('launcher', { id: 'c_ewgf', name: 'Poing éclair', anim: 'uppercut', startup: 8, active: 3, recovery: 24, damage: 14, hit: { x: 30, w: 58, y0: 0, y1: 120, z: 32 }, launch: true, kbx: 2.5, kby: 11, hitstop: 10, lunge: 6, kiCost: 10 });
  m.c_hop = mv('launcher', { id: 'c_hop', name: 'Coup-sauté', anim: 'knee', startup: 12, active: 3, recovery: 20, damage: 12, hit: { x: 28, w: 58, y0: 40, y1: 115, z: 32 }, launch: true, kbx: 2, kby: 9, hitstop: 8, overhead: true, lunge: 2 });
  m.c_side = mv('light', { id: 'c_side', name: 'Coup latéral', anim: 'kick', startup: 8, active: 4, recovery: 14, damage: 9, hit: { x: 50, w: 86, y0: 30, y1: 90, z: 30 }, kbx: 6, hitstun: 20, lunge: 3, cancelFrom: 11, next: ['l2', 'l3', 'heavy', 'launcher', 'special', 'special2', 'super'] });
  const Z = { x: 0, w: 0, y0: 0, y1: 0, z: 0 };
  m.c_wave = mv('special', { id: 'c_wave', name: 'Onde Tonnerre', hit: Z, damage: 0, anim: 'wave', startup: 22, active: 4, recovery: 30, kiCost: 25, projectile: { kind: 'orb', speed: 12, life: 70, damage: 22, radius: 40, y: 58, pierce: true } });
  m.c_rocket = mv('special', { id: 'c_rocket', name: 'Poing fusée', hit: Z, damage: 0, anim: 'cross', startup: 12, active: 3, recovery: 26, kiCost: 14, projectile: { kind: 'bat', speed: 14, life: 45, damage: 15, radius: 18, y: 55, pierce: true } });
  m.c_falcon = mv('heavy', { id: 'c_falcon', name: 'Poing du faucon', anim: 'falcon', startup: 26, active: 4, recovery: 34, damage: 36, hit: { x: 16, w: 60, y0: 10, y1: 120, z: 34 }, kbx: 14, kby: 6, knockdown: true, hitstop: 18, armor: true, lunge: 5, kiCost: 30 });
  m.c_meteor = mv('heavy', { id: 'c_meteor', name: 'Météores', anim: 'barrage', startup: 8, active: 42, recovery: 22, damage: 3, hit: { x: 20, w: 78, y0: 10, y1: 120, z: 34 }, kbx: 1.2, hitstun: 20, hitstop: 2, multi: { hits: 14, every: 3 }, lunge: 0.5, kiCost: 40 });
  m.c_purple = mv('special', { id: 'c_purple', name: 'Pourpre vide', hit: Z, damage: 0, anim: 'super', startup: 34, active: 4, recovery: 40, superCost: 60, invuln: true, projectile: { kind: 'orb', speed: 6, life: 130, damage: 42, radius: 70, y: 60, pierce: true } });
  m.c_omni = mv('heavy', { id: 'c_omni', name: 'Omnislash', anim: 'slash', startup: 10, active: 34, recovery: 26, damage: 5, hit: { x: 10, w: 90, y0: 0, y1: 130, z: 40 }, kbx: 1, hitstun: 20, hitstop: 2, multi: { hits: 10, every: 3 }, teleport: 40, superCost: 50, invuln: true });
  m.c_serious = mv('heavy', { id: 'c_serious', name: 'Coup sérieux', anim: 'serious', startup: 24, active: 3, recovery: 50, damage: 55, hit: { x: 14, w: 70, y0: 0, y1: 130, z: 40 }, kbx: 20, kby: 8, knockdown: true, hitstop: 24, superCost: 40, armor: true, guardBreak: true });
  m.c_step = mv('heavy', { id: 'c_step', name: 'Pas éclair', anim: 'backstab', startup: 4, active: 4, recovery: 14, damage: 12, hit: { x: 0, w: 70, y0: 0, y1: 120, z: 36 }, teleport: 60, kbx: 5, kby: 2, knockdown: true, hitstop: 6, invuln: true, kiCost: 8 });
  m.c_rasen = mv('special', { id: 'c_rasen', name: 'Sphère tournoyante', anim: 'palm', startup: 14, active: 14, recovery: 24, damage: 5, hit: { x: 24, w: 62, y0: 10, y1: 110, z: 34 }, kbx: 2, kby: 1, hitstun: 20, hitstop: 3, multi: { hits: 6, every: 2 }, lunge: 2, kiCost: 20 });
  m.c_rider = mv('air', { id: 'c_rider', name: 'Rider Kick', anim: 'rider', startup: 6, active: 20, recovery: 14, damage: 18, hit: { x: 20, w: 76, y0: -40, y1: 80, z: 34 }, lunge: 7, lungeAir: -9, kbx: 8, kby: 3, hitstun: 26, knockdown: true, hitstop: 10, kiCost: 8 });
  m.c_cmb_rafale = mv('heavy', { id: 'c_cmb_rafale', name: 'Rafale (P P P + E)', anim: 'barrage', startup: 7, active: 24, recovery: 20, damage: 4, hit: { x: 20, w: 80, y0: 10, y1: 120, z: 34 }, kbx: 1.2, hitstun: 18, hitstop: 2, multi: { hits: 8, every: 3 }, kiCost: 18 });
  m.c_cmb_tempete = mv('heavy', { id: 'c_cmb_tempete', name: 'Tempête de pieds (K K K + E)', anim: 'flurrykick', startup: 6, active: 20, recovery: 20, damage: 4, hit: { x: 30, w: 76, y0: 0, y1: 90, z: 34 }, kbx: 1.4, hitstun: 18, hitstop: 3, multi: { hits: 7, every: 3 }, kiCost: 18 });
  m.c_cmb_briseur = mv('launcher', { id: 'c_cmb_briseur', name: 'Briseur (P K P + E)', anim: 'uppercut', startup: 8, active: 4, recovery: 22, damage: 15, hit: { x: 24, w: 64, y0: 0, y1: 130, z: 34 }, launch: true, kbx: 2, kby: 12, hitstop: 10, lunge: 5, kiCost: 15 });
  m.c_cmb_seisme = mv('special', { id: 'c_cmb_seisme', name: 'Séisme (P P K + E)', hit: Z, damage: 0, anim: 'wave', startup: 14, active: 3, recovery: 24, kiCost: 22, projectile: { kind: 'shock', speed: 7, life: 34, damage: 18, radius: 42, y: 24, pierce: true } });
  m.c_cmb_spirale = mv('heavy', { id: 'c_cmb_spirale', name: 'Spirale (K P K + E)', anim: 'tatsu', startup: 8, active: 24, recovery: 18, damage: 6, hit: { x: 6, w: 76, y0: 0, y1: 100, z: 36 }, kbx: 3, hitstun: 20, hitstop: 4, lunge: 4.5, selfKnock: true, multi: { hits: 5, every: 4 }, kiCost: 20 });
  m.c_cmb_dragon = mv('launcher', { id: 'c_cmb_dragon', name: 'Dragon (P K K + E)', anim: 'rising', startup: 5, active: 12, recovery: 30, damage: 16, hit: { x: 16, w: 64, y0: 0, y1: 150, z: 36 }, launch: true, kbx: 2, kby: 12, hitstop: 8, lunge: 3, lungeAir: 11, invuln: true, multi: { hits: 2, every: 6 }, kiCost: 18 });
  m.c_cmb_ecrase = mv('heavy', { id: 'c_cmb_ecrase', name: 'Écrasement (K K P + E)', anim: 'slam', startup: 16, active: 4, recovery: 30, damage: 26, hit: { x: 20, w: 76, y0: 0, y1: 120, z: 40 }, knockdown: true, kbx: 4, kby: 5, hitstop: 14, armor: true, kiCost: 25 });
  m.c_cmb_eclair = mv('heavy', { id: 'c_cmb_eclair', name: 'Fente éclair (K P P + E)', anim: 'cross', startup: 6, active: 3, recovery: 18, damage: 14, hit: { x: 20, w: 60, y0: 20, y1: 110, z: 32 }, knockdown: true, kbx: 9, kby: 3, hitstop: 8, lunge: 8, kiCost: 12 });
  m.shoot = mv('light', { id: 'shoot', name: 'Tir', anim: 'shoot', startup: 1, active: 1, recovery: 3, damage: 0, hit: { x: 0, w: 0, y0: 0, y1: 0, z: 0 } });
  m.c_flurry = mv('light', { id: 'c_flurry', name: 'Rafale du dragon', anim: 'jab', startup: 4, active: 14, recovery: 16, damage: 3, hit: { x: 30, w: 62, y0: 20, y1: 100, z: 30 }, kbx: 0.8, hitstun: 14, hitstop: 2, multi: { hits: 6, every: 2 }, lunge: 1 });
  m.c_airflying = mv('air', { id: 'c_airflying', name: 'Coup volant', anim: 'airkick', startup: 5, active: 12, recovery: 12, damage: 11, hit: { x: 30, w: 70, y0: -30, y1: 70, z: 30 }, lunge: 6, kbx: 5, hitstun: 22, knockdown: true });
  return m;
}

for (const ch of ROSTER) Object.assign(ch.moves, commandMoves(ch));
// rafale du dragon : prolonge l'enchaînement léger
for (const ch of ROSTER) { const l3 = ch.moves.l3; if (l3.next) l3.next = [...l3.next, 'c_flurry']; }


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
  shield: 'frost',
  bomber: 'blaze',
};

export const ENEMY_NAMES: Record<string, string[]> = {
  thug: ['Voyou', 'Loubard', 'Sbire', 'Gros bras'],
  brute: ['Brute', 'Videur', 'Cogneur', 'Molosse'],
  ninja: ['Ombre', 'Furtif', 'Lame', 'Assassin'],
  gunner: ['Tireur', 'Sniper', 'Canonnier', 'Artilleur'],
  shield: ['Bouclier', 'Rempart', 'Mur', 'Garde'],
  bomber: ['Lanceur', 'Artificier', 'Pyro', 'Cocktail'],
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
  { name: 'Noir', main: '#17171c', dark: '#0a0a0d', glow: '#8a8f9c' },
];
