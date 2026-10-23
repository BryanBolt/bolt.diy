//! Modèle de données des Réflexes (système d'IA programmable inspiré des
//! Gambits de FFXII, renommé et adapté).
//!
//! Vocabulaire :
//! - **Réflexe** : une ligne « SI cible/condition ALORS action ».
//! - **Grimoire** : la liste des 12 Réflexes d'un personnage.
//! - **Posture** I / II / III : trois configurations sauvegardées du grimoire.
//! - **Sélecteur** : cible + condition intégrée (ex. « Allié : PV < 50 % »).
//!
//! Mode Fidèle : une ligne = un sélecteur + une action, rien d'autre.
//! Mode Étendu : une condition composée optionnelle (`ext`) peut s'ajouter ;
//! elle est ignorée tant que le mode étendu est désactivé.

use crate::data::{action, action_from_code, ActionId, ItemId, ITEMS};
use crate::status::StatusId;
use crate::types::{Element, Stat};

pub const MAX_SLOTS: usize = 12;
pub const POSTURES: usize = 3;
pub const POSTURE_NAMES: [&str; POSTURES] = ["I", "II", "III"];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Group {
    Ally,
    Foe,
    Myself,
}

impl Group {
    pub fn name(self) -> &'static str {
        match self {
            Group::Ally => "Allié",
            Group::Foe => "Ennemi",
            Group::Myself => "Soi",
        }
    }
}

/// Origine d'une entrée du catalogue (honnêteté sur la fidélité).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Origin {
    /// Principe documenté du système de référence.
    Reference,
    /// Adaptation nécessaire (seuils remis à l'échelle, etc.).
    Adaptation,
    /// Disponible uniquement en mode étendu.
    Extended,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Selector {
    // --- Allié ---
    AllyAny,
    AllyLeader,
    AllyChar(u8),
    AllyGuest,
    AllyLowestHp,
    AllyStrongestWeapon,
    AllyLowestDef,
    AllyLowestMdef,
    AllyHpBelow(u8),
    AllyHpCritical,
    AllyMpBelow(u8),
    AllyStatus(StatusId),
    // --- Ennemi ---
    FoeLeaderTarget,
    FoeNearestVisible,
    FoeAny,
    FoeTargetedByAlly,
    FoeNotTargeted,
    FoeTargetingLeader,
    FoeTargetingSelf,
    FoeTargetingAlly,
    FoeTargetingChar(u8),
    FoeNearest,
    FoeFurthest,
    FoeStatMost(Stat),
    FoeStatLeast(Stat),
    FoeHpBelowAbs(u32),
    FoeHpAtLeastAbs(u32),
    FoeHpFull,
    FoeHpBelowPct(u8),
    FoeHpAtLeastPct(u8),
    FoeHpCritical,
    FoeStatus(StatusId),
    FoeWeak(Element),
    FoeVulnerable(Element),
    FoeFlying,
    FoeUndead,
    FoeCountAtLeast(u8),
    // --- Soi ---
    SelfAlways,
    SelfHpBelow(u8),
    SelfMpBelow(u8),
    SelfHpCritical,
    SelfStatus(StatusId),
    SelfFoesAtLeast(u8),
    SelfTargeted,
    SelfItemAtLeast(ItemId, u8),
}

fn stat_phrase(s: Stat, most: bool) -> String {
    let (plural, fem) = match s {
        Stat::Hp | Stat::MaxHp | Stat::Mp | Stat::MaxMp => (true, false),
        Stat::Level => (false, false),
        _ => (false, true),
    };
    let adj = match (most, plural, fem) {
        (true, true, _) => "les plus élevés",
        (false, true, _) => "les plus bas",
        (true, false, true) => "la plus élevée",
        (false, false, true) => "la plus basse",
        (true, false, false) => "le plus élevé",
        (false, false, false) => "le plus bas",
    };
    format!("{} {}", s.name(), adj)
}

/// Seuil des « PV critiques » (fraction des PV max).
pub const CRITICAL_HP: f32 = 0.2;

pub const HERO_CODES: [&str; 3] = ["kael", "nyra", "lysa"];
pub const HERO_NAMES: [&str; 3] = ["Kael", "Nyra", "Lysa"];

impl Selector {
    pub fn group(self) -> Group {
        use Selector::*;
        match self {
            AllyAny | AllyLeader | AllyChar(_) | AllyGuest | AllyLowestHp | AllyStrongestWeapon | AllyLowestDef | AllyLowestMdef | AllyHpBelow(_) | AllyHpCritical | AllyMpBelow(_) | AllyStatus(_) => Group::Ally,
            SelfAlways | SelfHpBelow(_) | SelfMpBelow(_) | SelfHpCritical | SelfStatus(_) | SelfFoesAtLeast(_) | SelfTargeted | SelfItemAtLeast(..) => Group::Myself,
            _ => Group::Foe,
        }
    }

    pub fn label(self) -> String {
        use Selector::*;
        let g = self.group().name();
        let body = match self {
            AllyAny => "n'importe lequel".to_string(),
            AllyLeader => "meneur".to_string(),
            AllyChar(i) => HERO_NAMES.get(i as usize).copied().unwrap_or("?").to_string(),
            AllyGuest => "invité".to_string(),
            AllyLowestHp => "PV les plus bas".to_string(),
            AllyStrongestWeapon => "arme la plus forte".to_string(),
            AllyLowestDef => "défense la plus faible".to_string(),
            AllyLowestMdef => "rés. arcane la plus faible".to_string(),
            AllyHpBelow(p) | SelfHpBelow(p) => format!("PV < {} %", p),
            AllyHpCritical | SelfHpCritical | FoeHpCritical => "PV critiques".to_string(),
            AllyMpBelow(p) | SelfMpBelow(p) => format!("ÉT < {} %", p),
            AllyStatus(s) | FoeStatus(s) | SelfStatus(s) => s.def().name.to_string(),
            FoeLeaderTarget => "cible du meneur".to_string(),
            FoeNearestVisible => "le plus proche en vue".to_string(),
            FoeAny => "n'importe lequel".to_string(),
            FoeTargetedByAlly => "déjà visé par un allié".to_string(),
            FoeNotTargeted => "visé par aucun allié".to_string(),
            FoeTargetingLeader => "visant le meneur".to_string(),
            FoeTargetingSelf => "me visant".to_string(),
            FoeTargetingAlly => "visant un allié".to_string(),
            FoeTargetingChar(i) => format!("visant {}", HERO_NAMES.get(i as usize).copied().unwrap_or("?")),
            FoeNearest => "le plus proche".to_string(),
            FoeFurthest => "le plus éloigné".to_string(),
            FoeStatMost(s) => stat_phrase(s, true),
            FoeStatLeast(s) => stat_phrase(s, false),
            FoeHpBelowAbs(v) => format!("PV < {}", v),
            FoeHpAtLeastAbs(v) => format!("PV ≥ {}", v),
            FoeHpFull => "PV = 100 %".to_string(),
            FoeHpBelowPct(p) => format!("PV < {} %", p),
            FoeHpAtLeastPct(p) => format!("PV ≥ {} %", p),
            FoeWeak(e) => format!("faible : {}", e.name()),
            FoeVulnerable(e) => format!("vulnérable : {}", e.name()),
            FoeFlying => "volant".to_string(),
            FoeUndead => "mort-vivant".to_string(),
            FoeCountAtLeast(n) => format!("ennemis ≥ {}", n),
            SelfAlways => "toujours".to_string(),
            SelfFoesAtLeast(n) => format!("ennemis ≥ {}", n),
            SelfTargeted => "visé par un ennemi".to_string(),
            SelfItemAtLeast(it, n) => format!("{} ≥ {}", ITEMS[it as usize].name, n),
        };
        format!("{} : {}", g, body)
    }

    pub fn describe(self) -> String {
        use Selector::*;
        match self {
            AllyAny => "Tout allié pour qui l'action est utile (ordre de l'équipe).".into(),
            AllyLeader => "Le meneur de l'équipe.".into(),
            AllyChar(_) => "Ce personnage précis.".into(),
            AllyGuest => "L'invité qui accompagne l'équipe.".into(),
            AllyLowestHp => "L'allié vivant avec le moins de PV.".into(),
            AllyStrongestWeapon => "L'allié portant l'arme la plus puissante.".into(),
            AllyLowestDef => "L'allié à la défense la plus faible.".into(),
            AllyLowestMdef => "L'allié à la résistance arcanique la plus faible.".into(),
            AllyHpBelow(p) => format!("Un allié dont les PV sont sous {} % (le plus bas d'abord).", p),
            AllyHpCritical => "Un allié en PV critiques (< 20 %).".into(),
            AllyMpBelow(p) => format!("Un allié dont l'Éther est sous {} %.", p),
            AllyStatus(s) => format!("Un allié atteint de « {} ». {}", s.def().name, s.def().desc),
            FoeLeaderTarget => "L'ennemi actuellement visé par le meneur. Rien si le meneur ne vise personne.".into(),
            FoeNearestVisible => "L'ennemi le plus proche, dans le champ de vision et non invisible.".into(),
            FoeAny => "N'importe quel ennemi engagé (le plus proche d'abord).".into(),
            FoeTargetedByAlly => "Un ennemi déjà visé par un autre allié.".into(),
            FoeNotTargeted => "Un ennemi que personne ne vise encore.".into(),
            FoeTargetingLeader => "Un ennemi qui attaque le meneur.".into(),
            FoeTargetingSelf => "Un ennemi qui m'attaque.".into(),
            FoeTargetingAlly => "Un ennemi qui attaque un allié.".into(),
            FoeTargetingChar(_) => "Un ennemi qui attaque ce personnage.".into(),
            FoeNearest => "L'ennemi le plus proche (même hors de vue).".into(),
            FoeFurthest => "L'ennemi le plus éloigné.".into(),
            FoeStatMost(_) | FoeStatLeast(_) => "Compare la caractéristique entre tous les ennemis engagés.".into(),
            FoeHpBelowAbs(_) | FoeHpAtLeastAbs(_) => "Compare les PV actuels à un seuil fixe.".into(),
            FoeHpFull => "Ennemi intact (PV pleins). Idéal pour Chaparder avant d'attaquer.".into(),
            FoeHpBelowPct(_) | FoeHpAtLeastPct(_) => "Compare le pourcentage de PV.".into(),
            FoeHpCritical => "Ennemi presque vaincu (< 20 % PV).".into(),
            FoeStatus(s) => format!("Ennemi atteint de « {} ».", s.def().name),
            FoeWeak(e) => format!("Ennemi ayant une faiblesse NATURELLE à l'élément {}.", e.name()),
            FoeVulnerable(e) => format!("Ennemi subissant actuellement plus de dégâts de {} (faiblesse ou Naphte). [Étendu]", e.name()),
            FoeFlying => "Ennemi en vol (hors de portée des armes de mêlée).".into(),
            FoeUndead => "Ennemi mort-vivant (les soins le blessent).".into(),
            FoeCountAtLeast(n) => format!("Vrai si au moins {} ennemis sont engagés.", n),
            SelfAlways => "Toujours vrai : cible soi-même.".into(),
            SelfHpBelow(p) => format!("Mes PV sont sous {} %.", p),
            SelfMpBelow(p) => format!("Mon Éther est sous {} %.", p),
            SelfHpCritical => "Mes PV sont critiques (< 20 %).".into(),
            SelfStatus(s) => format!("Je suis atteint de « {} ».", s.def().name),
            SelfFoesAtLeast(n) => format!("Au moins {} ennemis sont engagés.", n),
            SelfTargeted => "Au moins un ennemi me vise.".into(),
            SelfItemAtLeast(it, n) => format!("L'inventaire contient au moins {} × {}. [Étendu]", n, ITEMS[it as usize].name),
        }
    }

    /// Code stable pour la sérialisation (jamais le texte affiché).
    pub fn code(self) -> String {
        use Selector::*;
        let ch = |i: u8| HERO_CODES.get(i as usize).copied().unwrap_or("?");
        match self {
            AllyAny => "ally.any".into(),
            AllyLeader => "ally.leader".into(),
            AllyChar(i) => format!("ally.char.{}", ch(i)),
            AllyGuest => "ally.guest".into(),
            AllyLowestHp => "ally.lowest_hp".into(),
            AllyStrongestWeapon => "ally.strongest_weapon".into(),
            AllyLowestDef => "ally.lowest_def".into(),
            AllyLowestMdef => "ally.lowest_mdef".into(),
            AllyHpBelow(p) => format!("ally.hp_lt.{}", p),
            AllyHpCritical => "ally.hp_critical".into(),
            AllyMpBelow(p) => format!("ally.mp_lt.{}", p),
            AllyStatus(s) => format!("ally.status.{}", s.code()),
            FoeLeaderTarget => "foe.leader_target".into(),
            FoeNearestVisible => "foe.nearest_visible".into(),
            FoeAny => "foe.any".into(),
            FoeTargetedByAlly => "foe.targeted_by_ally".into(),
            FoeNotTargeted => "foe.not_targeted".into(),
            FoeTargetingLeader => "foe.targeting_leader".into(),
            FoeTargetingSelf => "foe.targeting_self".into(),
            FoeTargetingAlly => "foe.targeting_ally".into(),
            FoeTargetingChar(i) => format!("foe.targeting_char.{}", ch(i)),
            FoeNearest => "foe.nearest".into(),
            FoeFurthest => "foe.furthest".into(),
            FoeStatMost(s) => format!("foe.most.{}", s.code()),
            FoeStatLeast(s) => format!("foe.least.{}", s.code()),
            FoeHpBelowAbs(v) => format!("foe.hp_lt.{}", v),
            FoeHpAtLeastAbs(v) => format!("foe.hp_ge.{}", v),
            FoeHpFull => "foe.hp_full".into(),
            FoeHpBelowPct(p) => format!("foe.hp_pct_lt.{}", p),
            FoeHpAtLeastPct(p) => format!("foe.hp_pct_ge.{}", p),
            FoeHpCritical => "foe.hp_critical".into(),
            FoeStatus(s) => format!("foe.status.{}", s.code()),
            FoeWeak(e) => format!("foe.weak.{}", e.code()),
            FoeVulnerable(e) => format!("foe.vulnerable.{}", e.code()),
            FoeFlying => "foe.flying".into(),
            FoeUndead => "foe.undead".into(),
            FoeCountAtLeast(n) => format!("foe.count_ge.{}", n),
            SelfAlways => "self.always".into(),
            SelfHpBelow(p) => format!("self.hp_lt.{}", p),
            SelfMpBelow(p) => format!("self.mp_lt.{}", p),
            SelfHpCritical => "self.hp_critical".into(),
            SelfStatus(s) => format!("self.status.{}", s.code()),
            SelfFoesAtLeast(n) => format!("self.foes_ge.{}", n),
            SelfTargeted => "self.targeted".into(),
            SelfItemAtLeast(it, n) => format!("self.item_ge.{}.{}", ITEMS[it as usize].code, n),
        }
    }

    pub fn from_code(code: &str) -> Option<Selector> {
        use Selector::*;
        let parts: Vec<&str> = code.split('.').collect();
        let num = |i: usize| parts.get(i).and_then(|p| p.parse::<u32>().ok());
        let hero = |i: usize| parts.get(i).and_then(|p| HERO_CODES.iter().position(|c| c == p)).map(|v| v as u8);
        let status = |i: usize| parts.get(i).and_then(|p| StatusId::from_code(p));
        let elem = |i: usize| parts.get(i).and_then(|p| Element::from_code(p));
        let stat = |i: usize| parts.get(i).and_then(|p| Stat::from_code(p));
        let sel = match (parts.first().copied()?, parts.get(1).copied()?) {
            ("ally", "any") => AllyAny,
            ("ally", "leader") => AllyLeader,
            ("ally", "char") => AllyChar(hero(2)?),
            ("ally", "guest") => AllyGuest,
            ("ally", "lowest_hp") => AllyLowestHp,
            ("ally", "strongest_weapon") => AllyStrongestWeapon,
            ("ally", "lowest_def") => AllyLowestDef,
            ("ally", "lowest_mdef") => AllyLowestMdef,
            ("ally", "hp_lt") => AllyHpBelow(num(2)? as u8),
            ("ally", "hp_critical") => AllyHpCritical,
            ("ally", "mp_lt") => AllyMpBelow(num(2)? as u8),
            ("ally", "status") => AllyStatus(status(2)?),
            ("foe", "leader_target") => FoeLeaderTarget,
            ("foe", "nearest_visible") => FoeNearestVisible,
            ("foe", "any") => FoeAny,
            ("foe", "targeted_by_ally") => FoeTargetedByAlly,
            ("foe", "not_targeted") => FoeNotTargeted,
            ("foe", "targeting_leader") => FoeTargetingLeader,
            ("foe", "targeting_self") => FoeTargetingSelf,
            ("foe", "targeting_ally") => FoeTargetingAlly,
            ("foe", "targeting_char") => FoeTargetingChar(hero(2)?),
            ("foe", "nearest") => FoeNearest,
            ("foe", "furthest") => FoeFurthest,
            ("foe", "most") => FoeStatMost(stat(2)?),
            ("foe", "least") => FoeStatLeast(stat(2)?),
            ("foe", "hp_lt") => FoeHpBelowAbs(num(2)?),
            ("foe", "hp_ge") => FoeHpAtLeastAbs(num(2)?),
            ("foe", "hp_full") => FoeHpFull,
            ("foe", "hp_pct_lt") => FoeHpBelowPct(num(2)? as u8),
            ("foe", "hp_pct_ge") => FoeHpAtLeastPct(num(2)? as u8),
            ("foe", "hp_critical") => FoeHpCritical,
            ("foe", "status") => FoeStatus(status(2)?),
            ("foe", "weak") => FoeWeak(elem(2)?),
            ("foe", "vulnerable") => FoeVulnerable(elem(2)?),
            ("foe", "flying") => FoeFlying,
            ("foe", "undead") => FoeUndead,
            ("foe", "count_ge") => FoeCountAtLeast(num(2)? as u8),
            ("self", "always") => SelfAlways,
            ("self", "hp_lt") => SelfHpBelow(num(2)? as u8),
            ("self", "mp_lt") => SelfMpBelow(num(2)? as u8),
            ("self", "hp_critical") => SelfHpCritical,
            ("self", "status") => SelfStatus(status(2)?),
            ("self", "foes_ge") => SelfFoesAtLeast(num(2)? as u8),
            ("self", "targeted") => SelfTargeted,
            ("self", "item_ge") => {
                let it = ITEMS.iter().position(|i| Some(&i.code) == parts.get(2))? as ItemId;
                SelfItemAtLeast(it, num(3)? as u8)
            }
            _ => return None,
        };
        Some(sel)
    }
}

pub struct CatalogEntry {
    pub selector: Selector,
    pub origin: Origin,
    /// Prix en Lumens dans les boutiques (valeur d'équilibrage ORIGINALE).
    pub price: u32,
    /// Disponible dès le début d'une partie.
    pub starter: bool,
}

/// Catalogue explicite de toutes les combinaisons cible/condition disponibles.
pub fn catalog() -> Vec<CatalogEntry> {
    use Selector::*;
    let mut v = Vec::new();
    let mut push = |s: Selector, o: Origin, price: u32, starter: bool| v.push(CatalogEntry { selector: s, origin: o, price, starter });
    // Allié
    push(AllyAny, Origin::Reference, 30, true);
    push(AllyLeader, Origin::Reference, 40, false);
    for i in 0..3 {
        push(AllyChar(i), Origin::Reference, 50, false);
    }
    push(AllyGuest, Origin::Reference, 50, false);
    push(AllyLowestHp, Origin::Reference, 80, false);
    push(AllyStrongestWeapon, Origin::Reference, 60, false);
    push(AllyLowestDef, Origin::Reference, 60, false);
    push(AllyLowestMdef, Origin::Reference, 60, false);
    for p in [100u8, 90, 80, 70, 60, 50, 40, 30, 20, 10] {
        push(AllyHpBelow(p), Origin::Reference, 40 + (100 - p as u32), matches!(p, 70 | 50 | 30));
    }
    push(AllyHpCritical, Origin::Reference, 70, false);
    for p in [100u8, 90, 80, 70, 60, 50, 40, 30, 20, 10] {
        push(AllyMpBelow(p), Origin::Reference, 40 + (100 - p as u32) / 2, false);
    }
    for s in StatusId::ALL {
        if s.def().reflex_visible {
            push(AllyStatus(s), Origin::Reference, 50, s == StatusId::Ko || s == StatusId::Venom);
        }
    }
    // Ennemi
    push(FoeLeaderTarget, Origin::Reference, 30, true);
    push(FoeNearestVisible, Origin::Reference, 30, true);
    push(FoeAny, Origin::Reference, 30, false);
    push(FoeTargetedByAlly, Origin::Reference, 60, false);
    push(FoeNotTargeted, Origin::Reference, 60, false);
    push(FoeTargetingLeader, Origin::Reference, 70, false);
    push(FoeTargetingSelf, Origin::Reference, 70, false);
    push(FoeTargetingAlly, Origin::Reference, 70, false);
    for i in 0..3 {
        push(FoeTargetingChar(i), Origin::Reference, 70, false);
    }
    push(FoeNearest, Origin::Reference, 40, true);
    push(FoeFurthest, Origin::Reference, 40, false);
    for s in Stat::ALL {
        push(FoeStatMost(s), Origin::Reference, 60, false);
        push(FoeStatLeast(s), Origin::Reference, 60, s == Stat::Hp);
    }
    // Seuils fixes : catalogue explicite. Les combinaisons exactes du jeu de
    // référence n'étant pas garanties, elles sont marquées « Adaptation ».
    for v in [500u32, 1000, 2000, 3000, 5000, 10000] {
        push(FoeHpBelowAbs(v), Origin::Adaptation, 60, false);
    }
    for v in [500u32, 1000, 2000, 3000, 5000, 10000, 50000, 100000] {
        push(FoeHpAtLeastAbs(v), Origin::Adaptation, 60, false);
    }
    push(FoeHpFull, Origin::Reference, 50, false);
    for p in [90u8, 70, 50, 30, 10] {
        push(FoeHpAtLeastPct(p), Origin::Reference, 50, false);
        push(FoeHpBelowPct(p), Origin::Reference, 50, false);
    }
    push(FoeHpCritical, Origin::Reference, 70, false);
    for s in StatusId::ALL {
        if s.def().reflex_visible && s != StatusId::Ko {
            push(FoeStatus(s), Origin::Reference, 50, false);
        }
    }
    for e in Element::ALL {
        push(FoeWeak(e), Origin::Reference, 80, false);
    }
    for e in Element::ALL {
        push(FoeVulnerable(e), Origin::Extended, 90, false);
    }
    push(FoeFlying, Origin::Reference, 70, false);
    push(FoeUndead, Origin::Reference, 70, false);
    for n in 2u8..=5 {
        push(FoeCountAtLeast(n), Origin::Adaptation, 60, false);
    }
    // Soi
    push(SelfAlways, Origin::Reference, 20, true);
    for p in [100u8, 90, 80, 70, 60, 50, 40, 30, 20, 10] {
        push(SelfHpBelow(p), Origin::Reference, 40, p == 30);
    }
    for p in [100u8, 90, 80, 70, 60, 50, 40, 30, 20, 10] {
        push(SelfMpBelow(p), Origin::Reference, 40, p == 10);
    }
    push(SelfHpCritical, Origin::Reference, 60, false);
    for s in StatusId::ALL {
        if s.def().reflex_visible && s != StatusId::Ko {
            push(SelfStatus(s), Origin::Reference, 50, false);
        }
    }
    for n in 2u8..=5 {
        push(SelfFoesAtLeast(n), Origin::Adaptation, 60, false);
    }
    push(SelfTargeted, Origin::Adaptation, 60, false);
    for it in 0..ITEMS.len() as u8 {
        push(SelfItemAtLeast(it, 3), Origin::Extended, 60, false);
    }
    v
}

// ---------------------------------------------------------------------------
// Mode étendu : conditions composées
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub enum ExtPred {
    SelfMpAbove(u8),
    SelfMpBelow(u8),
    SelfHpAbove(u8),
    TargetHpBelow(u8),
    TargetHpAbove(u8),
    TargetFlying,
    TargetWeak(Element),
    DistanceBelow(u16),
    ItemAtLeast(ItemId, u8),
    /// Économie : l'Éther restant après l'action reste ≥ ce pourcentage.
    KeepMpReserve(u8),
}

#[derive(Clone, Debug, PartialEq)]
pub enum ExtExpr {
    And(Vec<ExtExpr>),
    Or(Vec<ExtExpr>),
    Not(Box<ExtExpr>),
    Pred(ExtPred),
}

impl ExtPred {
    pub fn code(&self) -> String {
        match self {
            ExtPred::SelfMpAbove(p) => format!("self_mp_gt:{}", p),
            ExtPred::SelfMpBelow(p) => format!("self_mp_lt:{}", p),
            ExtPred::SelfHpAbove(p) => format!("self_hp_gt:{}", p),
            ExtPred::TargetHpBelow(p) => format!("target_hp_lt:{}", p),
            ExtPred::TargetHpAbove(p) => format!("target_hp_gt:{}", p),
            ExtPred::TargetFlying => "target_flying".into(),
            ExtPred::TargetWeak(e) => format!("target_weak:{}", e.code()),
            ExtPred::DistanceBelow(d) => format!("dist_lt:{}", d),
            ExtPred::ItemAtLeast(it, n) => format!("item_ge:{}:{}", ITEMS[*it as usize].code, n),
            ExtPred::KeepMpReserve(p) => format!("keep_mp:{}", p),
        }
    }

    pub fn label(&self) -> String {
        match self {
            ExtPred::SelfMpAbove(p) => format!("mon ÉT > {} %", p),
            ExtPred::SelfMpBelow(p) => format!("mon ÉT < {} %", p),
            ExtPred::SelfHpAbove(p) => format!("mes PV > {} %", p),
            ExtPred::TargetHpBelow(p) => format!("PV cible < {} %", p),
            ExtPred::TargetHpAbove(p) => format!("PV cible > {} %", p),
            ExtPred::TargetFlying => "cible volante".into(),
            ExtPred::TargetWeak(e) => format!("cible faible {}", e.name()),
            ExtPred::DistanceBelow(d) => format!("distance < {} m", d / 40),
            ExtPred::ItemAtLeast(it, n) => format!("{} ≥ {}", ITEMS[*it as usize].name, n),
            ExtPred::KeepMpReserve(p) => format!("garder {} % d'ÉT", p),
        }
    }

    fn parse(s: &str) -> Option<ExtPred> {
        let mut it = s.split(':');
        let head = it.next()?;
        let a = it.next();
        let b = it.next();
        let n = |x: Option<&str>| x.and_then(|v| v.parse::<u32>().ok());
        Some(match head {
            "self_mp_gt" => ExtPred::SelfMpAbove(n(a)? as u8),
            "self_mp_lt" => ExtPred::SelfMpBelow(n(a)? as u8),
            "self_hp_gt" => ExtPred::SelfHpAbove(n(a)? as u8),
            "target_hp_lt" => ExtPred::TargetHpBelow(n(a)? as u8),
            "target_hp_gt" => ExtPred::TargetHpAbove(n(a)? as u8),
            "target_flying" => ExtPred::TargetFlying,
            "target_weak" => ExtPred::TargetWeak(Element::from_code(a?)?),
            "dist_lt" => ExtPred::DistanceBelow(n(a)? as u16),
            "item_ge" => ExtPred::ItemAtLeast(ITEMS.iter().position(|i| i.code == a.unwrap_or(""))? as ItemId, n(b)? as u8),
            "keep_mp" => ExtPred::KeepMpReserve(n(a)? as u8),
            _ => return None,
        })
    }
}

impl ExtExpr {
    pub fn code(&self) -> String {
        match self {
            ExtExpr::And(v) => format!("and({})", v.iter().map(|e| e.code()).collect::<Vec<_>>().join(",")),
            ExtExpr::Or(v) => format!("or({})", v.iter().map(|e| e.code()).collect::<Vec<_>>().join(",")),
            ExtExpr::Not(e) => format!("not({})", e.code()),
            ExtExpr::Pred(p) => p.code(),
        }
    }

    pub fn label(&self) -> String {
        match self {
            ExtExpr::And(v) => v.iter().map(|e| e.label()).collect::<Vec<_>>().join(" ET "),
            ExtExpr::Or(v) => format!("({})", v.iter().map(|e| e.label()).collect::<Vec<_>>().join(" OU ")),
            ExtExpr::Not(e) => format!("NON {}", e.label()),
            ExtExpr::Pred(p) => p.label(),
        }
    }

    pub fn parse(s: &str) -> Option<ExtExpr> {
        let (e, rest) = Self::parse_inner(s.trim())?;
        if rest.trim().is_empty() {
            Some(e)
        } else {
            None
        }
    }

    fn parse_inner(s: &str) -> Option<(ExtExpr, &str)> {
        for (kw, kind) in [("and(", 0), ("or(", 1), ("not(", 2)] {
            if let Some(mut rest) = s.strip_prefix(kw) {
                let mut items = Vec::new();
                loop {
                    let (e, r) = Self::parse_inner(rest.trim_start())?;
                    items.push(e);
                    let r = r.trim_start();
                    if let Some(r2) = r.strip_prefix(',') {
                        rest = r2;
                    } else if let Some(r2) = r.strip_prefix(')') {
                        rest = r2;
                        break;
                    } else {
                        return None;
                    }
                }
                let e = match kind {
                    0 => ExtExpr::And(items),
                    1 => ExtExpr::Or(items),
                    _ => ExtExpr::Not(Box::new(items.into_iter().next()?)),
                };
                return Some((e, rest));
            }
        }
        let end = s.find([',', ')']).unwrap_or(s.len());
        Some((ExtExpr::Pred(ExtPred::parse(&s[..end])?), &s[end..]))
    }
}

// ---------------------------------------------------------------------------
// Grimoire
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct Rule {
    pub selector: Selector,
    pub action: ActionId,
    /// Condition composée (mode étendu uniquement).
    pub ext: Option<ExtExpr>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReflexSlot {
    pub enabled: bool,
    pub rule: Option<Rule>,
}

impl Default for ReflexSlot {
    fn default() -> Self {
        ReflexSlot { enabled: true, rule: None }
    }
}

#[derive(Clone, Debug, PartialEq, Default)]
pub struct Posture {
    pub slots: [ReflexSlot; MAX_SLOTS],
}

impl Posture {
    pub fn from_rules(rules: &[(Selector, ActionId)]) -> Posture {
        let mut p = Posture::default();
        for (i, (s, a)) in rules.iter().enumerate().take(MAX_SLOTS) {
            p.slots[i] = ReflexSlot { enabled: true, rule: Some(Rule { selector: *s, action: *a, ext: None }) };
        }
        p
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ReflexBook {
    pub enabled: bool,
    pub active: usize,
    pub postures: [Posture; POSTURES],
    /// Nombre d'emplacements débloqués (progression).
    pub unlocked: u8,
}

impl Default for ReflexBook {
    fn default() -> Self {
        ReflexBook { enabled: true, active: 0, postures: Default::default(), unlocked: MAX_SLOTS as u8 }
    }
}

impl ReflexBook {
    pub fn with_rules(rules: &[(Selector, ActionId)]) -> ReflexBook {
        let mut b = ReflexBook::default();
        b.postures[0] = Posture::from_rules(rules);
        b
    }

    pub fn current(&self) -> &Posture {
        &self.postures[self.active.min(POSTURES - 1)]
    }

    pub fn current_mut(&mut self) -> &mut Posture {
        let i = self.active.min(POSTURES - 1);
        &mut self.postures[i]
    }

    pub fn move_slot(&mut self, from: usize, up: bool) -> usize {
        let lim = self.unlocked as usize;
        let to = if up { from.checked_sub(1) } else if from + 1 < lim { Some(from + 1) } else { None };
        if let Some(to) = to {
            self.current_mut().slots.swap(from, to);
            to
        } else {
            from
        }
    }

    /// Sérialisation texte versionnée : une ligne par emplacement non vide.
    pub fn serialize(&self, owner: &str) -> String {
        let mut out = format!("book|{}|{}|{}|{}\n", owner, self.enabled as u8, self.active, self.unlocked);
        for (pi, p) in self.postures.iter().enumerate() {
            for (si, s) in p.slots.iter().enumerate() {
                if let Some(r) = &s.rule {
                    out.push_str(&format!(
                        "slot|{}|{}|{}|{}|{}|{}|{}\n",
                        owner,
                        pi,
                        si,
                        s.enabled as u8,
                        r.selector.code(),
                        action(r.action).code,
                        r.ext.as_ref().map(|e| e.code()).unwrap_or_default()
                    ));
                }
            }
        }
        out
    }

    /// Applique une ligne sérialisée. Les lignes invalides sont ignorées (robustesse aux migrations).
    pub fn apply_line(&mut self, parts: &[&str]) -> bool {
        match parts.first().copied() {
            Some("book") if parts.len() >= 5 => {
                self.enabled = parts[2] == "1";
                self.active = parts[3].parse().unwrap_or(0).min(POSTURES - 1);
                self.unlocked = parts[4].parse().unwrap_or(self.unlocked).clamp(1, MAX_SLOTS as u8);
                // Remise à zéro avant rechargement des emplacements.
                self.postures = Default::default();
                true
            }
            Some("slot") if parts.len() >= 8 => {
                let (Ok(pi), Ok(si)) = (parts[2].parse::<usize>(), parts[3].parse::<usize>()) else { return false };
                if pi >= POSTURES || si >= MAX_SLOTS {
                    return false;
                }
                let Some(selector) = Selector::from_code(parts[5]) else { return false };
                let Some(act) = action_from_code(parts[6]) else { return false };
                let ext = parts.get(7).filter(|s| !s.is_empty()).and_then(|s| ExtExpr::parse(s));
                self.postures[pi].slots[si] = ReflexSlot { enabled: parts[4] == "1", rule: Some(Rule { selector, action: act, ext }) };
                true
            }
            _ => false,
        }
    }
}

// ---------------------------------------------------------------------------
// Trace de décision (outil de débogage — n'influence jamais la décision)
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub enum SlotOutcome {
    Empty,
    Locked,
    Disabled,
    /// Le sélecteur ne trouve aucune unité.
    NoTarget,
    /// Des unités correspondent mais l'action ne leur serait pas utile / applicable.
    NoValidTarget,
    /// L'action ne peut pas être exécutée (ressource, statut, non apprise...).
    NotExecutable(&'static str),
    /// La condition étendue est fausse.
    ExtFailed,
    Chosen(crate::types::UnitId),
    /// Non évalué : une règle prioritaire a déjà été retenue.
    Skipped,
}

#[derive(Clone, Debug, PartialEq)]
pub struct SlotTrace {
    pub slot: u8,
    pub outcome: SlotOutcome,
}
