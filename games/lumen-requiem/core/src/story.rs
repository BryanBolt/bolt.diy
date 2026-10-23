//! Scénario original de Lumen Requiem.
//!
//! Il reprend les « codes » des grands RPG d'éco-fantasy cyberpunk de la fin
//! des années 90 (mégacorporation qui pompe l'énergie vitale d'une planète,
//! cellule de résistance, mercenaire à la mémoire trouée, héritière d'un
//! peuple ancien, ange déchu qui veut devenir dieu) avec des personnages,
//! lieux, dialogues et rebondissements entièrement originaux.

pub type Line = (&'static str, &'static str);

#[derive(Debug)]
pub struct Scene {
    pub title: &'static str,
    pub lines: &'static [Line],
    pub mood: u8,
}

pub const NARR: &str = "";

pub static PROLOGUE: Scene = Scene {
    title: "Prologue — Néo-Halcyon",
    mood: 6,
    lines: &[
        (NARR, "Néo-Halcyon, ville-machine suspendue au-dessus des Puits de Lumen."),
        (NARR, "Depuis cinquante ans, la Compagnie Solaris aspire la lueur verte qui dort sous la terre. Elle alimente les tours, les trains, les rêves."),
        (NARR, "Mais chaque nuit, les fleurs des Bas-Fonds ferment un peu plus tôt."),
        ("Nyra", "Tu es le mercenaire ? On m'avait dit « ancienne Lame d'Argent ». Je t'imaginais plus… impressionnant."),
        ("Kael", "On m'a payé pour ouvrir une porte. Pas pour impressionner."),
        ("Nyra", "La porte, c'est le Puits n°7. Les Racines vont l'éteindre. Ce soir."),
        ("Lysa", "Attendez. Vous entendez ? Sous le métal… quelqu'un chante."),
        ("Kael", "…Qui est-ce ?"),
        ("Lysa", "Lysa. Je vends des fleurs près de l'église effondrée. Et la planète me parle, parfois. Elle a peur."),
        ("Nyra", "Super. Une mystique. On y va, Lame Brisée ?"),
        (NARR, "ASTUCE : vos compagnons agissent seuls grâce à leurs RÉFLEXES. Ouvrez le menu (START / Entrée) pour les programmer."),
    ],
};

pub static SECTOR_START: [Scene; 3] = [
    Scene {
        title: "Secteur I — Les Bas-Fonds",
        mood: 2,
        lines: &[
            (NARR, "Sous la plaque, la ville d'en bas respire une brume verte."),
            ("Nyra", "Les sentinelles Solaris patrouillent jusqu'au Puits. On passe en force."),
            ("Kael", "Restez derrière moi."),
            ("Lysa", "Ou devant. Je soigne mieux quand je vois vos blessures."),
        ],
    },
    Scene {
        title: "Secteur II — L'Aiguille",
        mood: 2,
        lines: &[
            (NARR, "La tour-laboratoire de Solaris perce les nuages : l'Aiguille."),
            ("Kit-9", "BIP. Unité Kit-9. Évadé du niveau 40. Je connais le chemin. Je viens avec vous. Ce n'est pas une question."),
            ("Nyra", "Un drone qui parle. Évidemment."),
            ("Kit-9", "Je soigne, je protège, j'attire les coups. Je ne prends pas d'ordres. Mes réflexes sont… fixes."),
            (NARR, "Kit-9 rejoint l'équipe en tant qu'INVITÉ : il suit ses propres Réflexes et ne peut pas être contrôlé."),
        ],
    },
    Scene {
        title: "Secteur III — Le Cratère du Requiem",
        mood: 7,
        lines: &[
            (NARR, "Au nord, la terre s'ouvre sur une plaie de lumière : là où la Lumen remonte vers le ciel."),
            ("Lysa", "Toute la mémoire du monde converge ici. Les morts, les forêts, les océans… Il veut tout boire."),
            ("Kael", "Ashka."),
            ("Nyra", "Hé. Quoi qu'il t'ait montré là-haut, c'est toi qui décides qui tu es."),
        ],
    },
];

pub static SECTOR_END: [Scene; 3] = [
    Scene {
        title: "Le Puits n°7 s'éteint",
        mood: 6,
        lines: &[
            (NARR, "Le Puits n°7 s'effondre dans un soupir de lumière."),
            ("Lysa", "La Lumen… ce n'est pas de l'énergie. Ce sont des souvenirs. Ceux de tous ceux qui ont vécu ici."),
            ("Nyra", "Solaris brûle les souvenirs des morts pour éclairer ses tours ?"),
            ("Directeur Valcourt", "(sur tous les écrans) Des terroristes ont détruit le Puits n°7. Solaris rétablira la lumière. Coûte que coûte."),
            ("Kael", "Ils vont venir pour elle. Pour Lysa."),
        ],
    },
    Scene {
        title: "Projet Lazare",
        mood: 6,
        lines: &[
            ("Dr Morvane", "Remarquable. Le Spécimen Ω abattu par… le sujet 13. Kael. Tu ne te souviens pas de moi ?"),
            ("Kael", "Je n'ai jamais mis les pieds ici."),
            ("Dr Morvane", "Tes souvenirs de Lame d'Argent sont les siens. Ceux d'Ashka. Nous les avons copiés en toi, faute de mieux. Une ombre."),
            ("Lysa", "Kael… ne l'écoute pas."),
            (NARR, "Au-dessus d'eux, une aile noire déchire le verre de l'Aiguille. Séraph Ashka contemple la ville, puis s'envole vers le nord."),
        ],
    },
    Scene {
        title: "Requiem",
        mood: 5,
        lines: &[
            ("Séraph Ashka", "Tu portes mes souvenirs, petite ombre. Rends-les-moi."),
            ("Kael", "Garde ton passé. Moi, j'ai un présent."),
            ("Lysa", "Planète… chante avec moi."),
            (NARR, "Le chant de Lysa monte. La Lumen se détourne du ciel et retourne à la terre, comme une marée qui rentre."),
            (NARR, "Néo-Halcyon s'éteint pour une nuit. Le lendemain, dans les Bas-Fonds, des fleurs poussent entre les rails."),
            ("Nyra", "Bon. Il va falloir apprendre à vivre sans Solaris."),
            ("Kael", "On apprendra."),
            (NARR, "FIN — Merci d'avoir joué. Chaque nouvelle partie débloque des Fragments pour le Sanctuaire."),
        ],
    },
];

/// Avant le boss final.
pub static FINAL_PRE: Scene = Scene {
    title: "L'Ange Déchu",
    mood: 7,
    lines: &[
        ("Séraph Ashka", "Cinquante ans que cette planète se laisse saigner. Je vais la délivrer. En devenant elle."),
        ("Lysa", "Une planète n'est pas un trône !"),
        ("Séraph Ashka", "Alors elle sera un tombeau. Approchez."),
    ],
};

/// Petites scènes des nœuds « Écho » (événements), choisies au hasard.
pub static EVENTS: [Scene; 6] = [
    Scene {
        title: "Fleurs entre les rails",
        mood: 6,
        lines: &[("Lysa", "Une fleur a poussé ici, malgré tout. Prenons un instant."), ("Nyra", "Un instant. Pas deux.")],
    },
    Scene {
        title: "Le marchand de ferraille",
        mood: 2,
        lines: &[("Vieux Brann", "Des pièces de drone Solaris ! Je vous les échange contre ce que vous voulez, gamins.")],
    },
    Scene {
        title: "Souvenir d'argent",
        mood: 6,
        lines: &[("Kael", "(Une neige d'argent. Un village en flammes. Un homme aux cheveux noirs qui sourit. Ce souvenir… est-il à moi ?)")],
    },
    Scene {
        title: "La cellule des Racines",
        mood: 2,
        lines: &[("Nyra", "Les Racines tiennent une planque ici. Ils peuvent nous ravitailler, ou nous apprendre deux trois trucs.")],
    },
    Scene {
        title: "La voix sous le métal",
        mood: 6,
        lines: &[("Voix de la Planète", "…souviens… toi… de nous…"), ("Lysa", "Elle nous offre quelque chose. Il faut choisir.")],
    },
    Scene {
        title: "Terminal Solaris",
        mood: 2,
        lines: &[("Kit-9", "BIP. Terminal piratable. Je peux extraire des protocoles tactiques. Ou des crédits. Pas les deux.")],
    },
];

pub static GAME_OVER_LINES: [&str; 4] = [
    "La Lumen garde la mémoire de votre combat.",
    "Même les étoiles s'éteignent avant de renaître.",
    "La planète se souviendra. Recommencez.",
    "Une défaite n'est qu'un souvenir de plus.",
];
