//! Catalogue de données : actions (arcanes, techniques, objets, artes),
//! objets, armes, gabarits de personnages et d'ennemis.
//!
//! Toutes les valeurs numériques sont des valeurs d'équilibrage ORIGINALES
//! de Lumen Requiem et ne prétendent reproduire aucun jeu existant.

use crate::status::{mask, negative_mask, StatusId};
use crate::types::{Affinity, Element, Stats, ELEMENT_COUNT};

pub type ActionId = u16;
pub type ItemId = u8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActionKind {
    Attack,
    HealMagic,
    OffenseMagic,
    SupportMagic,
    DebuffMagic,
    Technique,
    Item,
    Special,
}

impl ActionKind {
    pub fn name(self) -> &'static str {
        match self {
            ActionKind::Attack => "Attaque",
            ActionKind::HealMagic => "Arcane de soin",
            ActionKind::OffenseMagic => "Arcane offensif",
            ActionKind::SupportMagic => "Arcane de soutien",
            ActionKind::DebuffMagic => "Arcane d'affaiblissement",
            ActionKind::Technique => "Technique",
            ActionKind::Item => "Consommable",
            ActionKind::Special => "Arcane ultime",
        }
    }
}

/// Groupe de cibles qu'une action accepte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetKind {
    Foe,
    Ally,
    SelfOnly,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Effect {
    Damage { magical: bool },
    DamageStatus { magical: bool, status: StatusId, chance: f32 },
    Heal,
    Raise,
    AddStatus { status: StatusId, chance: f32 },
    Cleanse { mask: u32 },
    Dispel,
    Steal,
    RestoreMp { chance: f32 },
    HealMp,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Delivery {
    /// Coup au contact : la portée vient de l'arme si `range == 0`.
    Melee,
    /// Projectile qui voyage jusqu'à la cible.
    Projectile { speed: f32 },
    /// Effet instantané à l'issue de l'incantation.
    Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fx {
    Slash,
    Punch,
    Thrust,
    Wave,
    Bolt,
    Burst,
    Heal,
    Buff,
    Debuff,
    Item,
    Steal,
    Ultimate,
    Bite,
    Beam,
}

#[derive(Clone, Copy, Debug)]
pub struct ActionDef {
    pub code: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    pub kind: ActionKind,
    pub mp: f32,
    pub item: Option<ItemId>,
    /// Temps de préparation (charge / incantation), secondes.
    pub cast: f32,
    /// Durée de l'animation d'exécution ; l'effet tombe à mi-parcours.
    pub anim: f32,
    /// Récupération après l'action.
    pub recover: f32,
    /// 0 = portée de l'arme.
    pub range: f32,
    pub target: TargetKind,
    /// Peut viser une unité à terre (Relève).
    pub target_ko: bool,
    /// Rayon de zone autour de la cible (0 = monocible).
    pub area: f32,
    pub element: Option<Element>,
    pub power: f32,
    pub effect: Effect,
    /// Bloquée par Mutisme.
    pub magic: bool,
    pub reflectable: bool,
    /// None = dépend de l'arme.
    pub hits_air: Option<bool>,
    pub delivery: Delivery,
    pub fx: Fx,
    /// Projection verticale / horizontale (sensation de combo).
    pub launch: f32,
    pub knock: f32,
    /// Utilisable par les Réflexes (les arcanes ultimes ne le sont pas).
    pub reflex_ok: bool,
}

const fn base(code: &'static str, name: &'static str, desc: &'static str, kind: ActionKind) -> ActionDef {
    ActionDef {
        code,
        name,
        desc,
        kind,
        mp: 0.0,
        item: None,
        cast: 0.0,
        anim: 0.35,
        recover: 0.25,
        range: 0.0,
        target: TargetKind::Foe,
        target_ko: false,
        area: 0.0,
        element: None,
        power: 1.0,
        effect: Effect::Damage { magical: false },
        magic: false,
        reflectable: false,
        hits_air: None,
        delivery: Delivery::Melee,
        fx: Fx::Slash,
        launch: 0.0,
        knock: 60.0,
        reflex_ok: true,
    }
}

const fn spell(code: &'static str, name: &'static str, desc: &'static str, kind: ActionKind, mp: f32, cast: f32, power: f32, effect: Effect, target: TargetKind) -> ActionDef {
    let mut a = base(code, name, desc, kind);
    a.mp = mp;
    a.cast = cast;
    a.power = power;
    a.effect = effect;
    a.target = target;
    a.magic = true;
    a.reflectable = true;
    a.hits_air = Some(true);
    a.delivery = Delivery::Instant;
    a.range = 520.0;
    a.anim = 0.4;
    a.recover = 0.35;
    a.knock = 30.0;
    a.fx = match kind {
        ActionKind::HealMagic => Fx::Heal,
        ActionKind::SupportMagic => Fx::Buff,
        ActionKind::DebuffMagic => Fx::Debuff,
        _ => Fx::Burst,
    };
    a
}

const fn elem(mut a: ActionDef, e: Element) -> ActionDef {
    a.element = Some(e);
    a
}
const fn area(mut a: ActionDef, r: f32) -> ActionDef {
    a.area = r;
    a
}
const fn fx(mut a: ActionDef, f: Fx) -> ActionDef {
    a.fx = f;
    a
}
const fn noreflect(mut a: ActionDef) -> ActionDef {
    a.reflectable = false;
    a
}

const fn item(code: &'static str, name: &'static str, desc: &'static str, it: ItemId, power: f32, effect: Effect, target: TargetKind) -> ActionDef {
    let mut a = base(code, name, desc, ActionKind::Item);
    a.item = Some(it);
    a.power = power;
    a.effect = effect;
    a.target = target;
    a.range = 360.0;
    a.hits_air = Some(true);
    a.delivery = Delivery::Instant;
    a.cast = 0.15;
    a.anim = 0.3;
    a.recover = 0.3;
    a.fx = Fx::Item;
    a.knock = 0.0;
    a
}

const fn arte(code: &'static str, name: &'static str, desc: &'static str, mp: f32, power: f32, range: f32, launch: f32, knock: f32, f: Fx) -> ActionDef {
    let mut a = base(code, name, desc, ActionKind::Technique);
    a.mp = mp;
    a.power = power;
    a.range = range;
    a.launch = launch;
    a.knock = knock;
    a.fx = f;
    a.anim = 0.42;
    a.recover = 0.3;
    a
}

// ---------------------------------------------------------------------------
// Identifiants stables (index dans ACTIONS)
// ---------------------------------------------------------------------------
pub const A_ATTACK: ActionId = 0;
pub const A_SUTURE: ActionId = 1;
pub const A_SUTURE_PLUS: ActionId = 2;
pub const A_CHORALE: ActionId = 3;
pub const A_RELEVE: ActionId = 4;
pub const A_PURGE: ActionId = 5;
pub const A_EVEIL: ActionId = 6;
pub const A_BRAISE: ActionId = 7;
pub const A_GIVRE: ActionId = 8;
pub const A_ARC: ActionId = 9;
pub const A_ONDE: ActionId = 10;
pub const A_SEISME: ActionId = 11;
pub const A_RAFALE: ActionId = 12;
pub const A_AUBE: ActionId = 13;
pub const A_NEANT: ActionId = 14;
pub const A_IMPACT: ActionId = 15;
pub const A_BRASIER: ActionId = 16;
pub const A_EGIDE: ActionId = 17;
pub const A_PRISME: ActionId = 18;
pub const A_ELAN: ActionId = 19;
pub const A_ARDEUR: ActionId = 20;
pub const A_FERVEUR: ActionId = 21;
pub const A_MIROIR: ActionId = 22;
pub const A_SEVE: ActionId = 23;
pub const A_APPAT: ActionId = 24;
pub const A_AMPLEUR: ActionId = 25;
pub const A_VENIN: ActionId = 26;
pub const A_MUTISME: ActionId = 27;
pub const A_ENGOURDIR: ActionId = 28;
pub const A_BRUME: ActionId = 29;
pub const A_TORPEUR: ActionId = 30;
pub const A_DISSIPER: ActionId = 31;
pub const A_CHAPARDER: ActionId = 32;
pub const A_SIPHON: ActionId = 33;
pub const A_FRONDE: ActionId = 34;
pub const A_CROC: ActionId = 35;
pub const A_TAILLE: ActionId = 36;
pub const A_PLUIE: ActionId = 37;
pub const A_COMETE: ActionId = 38;
pub const A_UPPERCUT: ActionId = 39;
pub const A_TORNADE: ActionId = 40;
pub const A_I_TONIQUE: ActionId = 41;
pub const A_I_TONIQUE_PLUS: ActionId = 42;
pub const A_I_PLUME: ActionId = 43;
pub const A_I_ANTIVENIN: ActionId = 44;
pub const A_I_PANACEE: ActionId = 45;
pub const A_I_FIOLE: ActionId = 46;
pub const A_I_GRENADE: ActionId = 47;
pub const A_U_KAEL: ActionId = 48;
pub const A_U_NYRA: ActionId = 49;
pub const A_U_LYSA: ActionId = 50;
// Actions réservées aux ennemis
pub const A_E_BITE: ActionId = 51;
pub const A_E_VENOM_BITE: ActionId = 52;
pub const A_E_LASER: ActionId = 53;
pub const A_E_SLAM: ActionId = 54;
pub const A_E_SLEEP_SPORE: ActionId = 55;
pub const A_E_CRYSTAL_GAZE: ActionId = 56;
pub const A_E_SENTENCE: ActionId = 57;
pub const A_E_OIL: ActionId = 58;
pub const A_E_SELF_DESTRUCT: ActionId = 59;
pub const A_E_SUPERNOVA: ActionId = 60;
pub const A_E_DARK_WAVE: ActionId = 61;
pub const A_E_FROST_BREATH: ActionId = 62;
pub const A_E_REVERS: ActionId = 63;
pub const A_KIT_ZAP: ActionId = 64;

pub const IT_TONIQUE: ItemId = 0;
pub const IT_TONIQUE_PLUS: ItemId = 1;
pub const IT_PLUME: ItemId = 2;
pub const IT_ANTIVENIN: ItemId = 3;
pub const IT_PANACEE: ItemId = 4;
pub const IT_FIOLE: ItemId = 5;
pub const IT_GRENADE: ItemId = 6;
pub const ITEM_COUNT: usize = 7;

pub struct ItemDef {
    pub code: &'static str,
    pub name: &'static str,
    pub price: u32,
    pub action: ActionId,
}

pub static ITEMS: [ItemDef; ITEM_COUNT] = [
    ItemDef { code: "tonique", name: "Tonique", price: 40, action: A_I_TONIQUE },
    ItemDef { code: "tonique_plus", name: "Tonique+", price: 110, action: A_I_TONIQUE_PLUS },
    ItemDef { code: "plume", name: "Plume d'Aube", price: 160, action: A_I_PLUME },
    ItemDef { code: "antivenin", name: "Antivenin", price: 30, action: A_I_ANTIVENIN },
    ItemDef { code: "panacee", name: "Panacée", price: 120, action: A_I_PANACEE },
    ItemDef { code: "fiole", name: "Fiole d'Éther", price: 140, action: A_I_FIOLE },
    ItemDef { code: "grenade", name: "Grenade Lumen", price: 80, action: A_I_GRENADE },
];

use ActionKind::*;
use TargetKind::*;

pub static ACTIONS: [ActionDef; 65] = [
    // 0
    {
        let mut a = base("attack", "Attaque", "Frappe avec l'arme équipée.", Attack);
        a.recover = 0.2;
        a
    },
    // 1..6 soins
    spell("suture", "Suture", "Referme les plaies d'un allié.", HealMagic, 6.0, 0.9, 3.0, Effect::Heal, Ally),
    spell("suture_plus", "Suture+", "Soin puissant sur un allié.", HealMagic, 16.0, 1.4, 7.0, Effect::Heal, Ally),
    area(spell("chorale", "Chorale", "Soin de groupe autour de la cible.", HealMagic, 22.0, 1.8, 3.5, Effect::Heal, Ally), 260.0),
    {
        let mut a = spell("releve", "Relève", "Relève un allié à terre avec une partie de ses PV.", HealMagic, 20.0, 1.6, 0.3, Effect::Raise, Ally);
        a.target_ko = true;
        a.reflectable = false;
        a
    },
    noreflect(spell("purge", "Purge", "Dissout toutes les altérations négatives.", HealMagic, 12.0, 1.0, 0.0, Effect::Cleanse { mask: 0 }, Ally)),
    noreflect(spell("eveil", "Éveil", "Dissipe Torpeur, Vertige et Figé.", HealMagic, 5.0, 0.6, 0.0, Effect::Cleanse { mask: 0 }, Ally)),
    // 7..16 offensifs
    elem(spell("braise", "Braise", "Gerbe de feu.", OffenseMagic, 6.0, 1.0, 2.6, Effect::Damage { magical: true }, Foe), Element::Fire),
    elem(spell("givre", "Givre", "Pics de glace.", OffenseMagic, 6.0, 1.0, 2.6, Effect::Damage { magical: true }, Foe), Element::Ice),
    elem(fx(spell("arc", "Arc", "Décharge de foudre.", OffenseMagic, 6.0, 1.0, 2.6, Effect::Damage { magical: true }, Foe), Fx::Bolt), Element::Thunder),
    elem(spell("onde", "Onde", "Vague compressée.", OffenseMagic, 6.0, 1.0, 2.6, Effect::Damage { magical: true }, Foe), Element::Water),
    elem(spell("seisme", "Séisme", "Le sol se soulève.", OffenseMagic, 7.0, 1.1, 2.8, Effect::Damage { magical: true }, Foe), Element::Earth),
    elem(spell("rafale", "Rafale", "Lames de vent.", OffenseMagic, 6.0, 1.0, 2.6, Effect::Damage { magical: true }, Foe), Element::Wind),
    elem(spell("aube", "Aube", "Lumière purificatrice, fatale aux morts-vivants.", OffenseMagic, 10.0, 1.3, 3.2, Effect::Damage { magical: true }, Foe), Element::Holy),
    elem(spell("neant", "Néant", "Fragment de vide.", OffenseMagic, 10.0, 1.3, 3.2, Effect::Damage { magical: true }, Foe), Element::Dark),
    fx(spell("impact", "Impact", "Onde d'éther pure, non élémentaire.", OffenseMagic, 8.0, 1.2, 2.9, Effect::Damage { magical: true }, Foe), Fx::Beam),
    area(elem(spell("brasier", "Brasier", "Explosion de feu sur une zone.", OffenseMagic, 18.0, 2.0, 3.6, Effect::Damage { magical: true }, Foe), Element::Fire), 220.0),
    // 17..25 soutien
    spell("egide", "Égide", "Bouclier contre les coups physiques.", SupportMagic, 8.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Aegis, chance: 1.0 }, Ally),
    spell("prisme", "Prisme", "Bouclier contre les arcanes.", SupportMagic, 8.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Prism, chance: 1.0 }, Ally),
    spell("elan", "Élan", "Accélère la jauge d'action.", SupportMagic, 12.0, 1.2, 0.0, Effect::AddStatus { status: StatusId::Elan, chance: 1.0 }, Ally),
    spell("ardeur", "Ardeur", "Galvanise la force.", SupportMagic, 10.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Ardor, chance: 1.0 }, Ally),
    spell("ferveur", "Ferveur", "Amplifie la puissance arcanique.", SupportMagic, 10.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Fervor, chance: 1.0 }, Ally),
    spell("miroir", "Miroir", "Renvoie les arcanes ennemis.", SupportMagic, 12.0, 1.2, 0.0, Effect::AddStatus { status: StatusId::Mirror, chance: 1.0 }, Ally),
    spell("seve", "Sève", "Régénération continue.", SupportMagic, 9.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Seve, chance: 1.0 }, Ally),
    spell("appat", "Appât", "Attire les ennemis sur la cible.", SupportMagic, 6.0, 0.8, 0.0, Effect::AddStatus { status: StatusId::Lure, chance: 1.0 }, Ally),
    spell("ampleur", "Ampleur", "Double temporairement les PV max.", SupportMagic, 20.0, 1.6, 0.0, Effect::AddStatus { status: StatusId::Ampleur, chance: 1.0 }, Ally),
    // 26..31 affaiblissements
    spell("venin", "Venin", "Empoisonne la cible.", DebuffMagic, 5.0, 0.9, 0.0, Effect::AddStatus { status: StatusId::Venom, chance: 0.85 }, Foe),
    spell("mutisme", "Mutisme", "Réduit la cible au silence.", DebuffMagic, 6.0, 0.9, 0.0, Effect::AddStatus { status: StatusId::Mute, chance: 0.75 }, Foe),
    spell("engourdir", "Engourdir", "Ralentit la cible.", DebuffMagic, 8.0, 1.0, 0.0, Effect::AddStatus { status: StatusId::Numb, chance: 0.8 }, Foe),
    spell("brume", "Brume", "Aveugle la cible.", DebuffMagic, 5.0, 0.9, 0.0, Effect::AddStatus { status: StatusId::Mist, chance: 0.8 }, Foe),
    spell("torpeur", "Torpeur", "Endort la cible.", DebuffMagic, 8.0, 1.1, 0.0, Effect::AddStatus { status: StatusId::Torpor, chance: 0.7 }, Foe),
    noreflect(spell("dissiper", "Dissiper", "Retire les bonus de la cible.", DebuffMagic, 10.0, 1.0, 0.0, Effect::Dispel, Foe)),
    // 32..34 techniques
    {
        let mut a = base("chaparder", "Chaparder", "Tente de dérober un objet ou des Lumens.", Technique);
        a.effect = Effect::Steal;
        a.fx = Fx::Steal;
        a.knock = 0.0;
        a
    },
    {
        let mut a = base("siphon", "Siphon", "Aspire l'Éther ambiant (70 % de réussite).", Technique);
        a.effect = Effect::RestoreMp { chance: 0.7 };
        a.target = SelfOnly;
        a.delivery = Delivery::Instant;
        a.cast = 0.4;
        a.fx = Fx::Buff;
        a.hits_air = Some(true);
        a
    },
    {
        let mut a = base("fronde", "Fronde", "Tir de fronde : atteint les ennemis volants.", Technique);
        a.power = 1.1;
        a.range = 480.0;
        a.hits_air = Some(true);
        a.delivery = Delivery::Projectile { speed: 900.0 };
        a.fx = Fx::Thrust;
        a.knock = 40.0;
        a
    },
    // 35..40 artes (Kael / Nyra)
    {
        let mut a = arte("croc", "Croc Fendeur", "Onde tranchante qui file au sol.", 5.0, 1.6, 420.0, 0.0, 90.0, Fx::Wave);
        a.delivery = Delivery::Projectile { speed: 820.0 };
        a.hits_air = Some(false);
        a
    },
    arte("taille", "Taille Ascendante", "Coup montant qui projette en l'air.", 6.0, 1.8, 95.0, 620.0, 20.0, Fx::Slash),
    {
        let mut a = arte("pluie", "Pluie d'Acier", "Série d'estocs fulgurants.", 9.0, 2.6, 110.0, 0.0, 140.0, Fx::Thrust);
        a.anim = 0.55;
        a.hits_air = Some(true);
        a
    },
    {
        let mut a = arte("comete", "Poing Comète", "Ruée explosive vers l'avant.", 5.0, 1.7, 120.0, 0.0, 160.0, Fx::Punch);
        a.anim = 0.3;
        a
    },
    {
        let mut a = arte("uppercut", "Uppercut Solaire", "Uppercut enflammé, atteint les volants.", 6.0, 1.9, 80.0, 700.0, 10.0, Fx::Punch);
        a.element = Some(Element::Fire);
        a.hits_air = Some(true);
        a
    },
    {
        let mut a = arte("tornade", "Tornade de Talons", "Toupie de coups de pied.", 9.0, 2.5, 120.0, 200.0, 120.0, Fx::Slash);
        a.element = Some(Element::Wind);
        a.anim = 0.6;
        a.area = 140.0;
        a
    },
    // 41..47 objets
    item("i_tonique", "Tonique", "Rend 150 PV.", IT_TONIQUE, 150.0, Effect::Heal, Ally),
    item("i_tonique_plus", "Tonique+", "Rend 400 PV.", IT_TONIQUE_PLUS, 400.0, Effect::Heal, Ally),
    {
        let mut a = item("i_plume", "Plume d'Aube", "Relève un allié à terre.", IT_PLUME, 0.25, Effect::Raise, Ally);
        a.target_ko = true;
        a
    },
    item("i_antivenin", "Antivenin", "Soigne Venin.", IT_ANTIVENIN, 0.0, Effect::Cleanse { mask: 1 << (StatusId::Venom as u32) }, Ally),
    item("i_panacee", "Panacée", "Soigne toutes les altérations.", IT_PANACEE, 0.0, Effect::Cleanse { mask: 0 }, Ally),
    item("i_fiole", "Fiole d'Éther", "Rend 60 ÉT.", IT_FIOLE, 60.0, Effect::HealMp, Ally),
    {
        let mut a = item("i_grenade", "Grenade Lumen", "Explosion de feu (dégâts fixes 220).", IT_GRENADE, 220.0, Effect::Damage { magical: false }, Foe);
        a.element = Some(Element::Fire);
        a.area = 160.0;
        a.fx = Fx::Burst;
        a
    },
    // 48..50 arcanes ultimes (hors Réflexes)
    ult("u_kael", "Lame du Crépuscule", "Kael déchire le ciel d'une lame de lumière."),
    ult("u_nyra", "Mille Étoiles Filantes", "Nyra frappe à la vitesse de la lumière."),
    {
        let mut a = ult("u_lysa", "Chant de la Planète", "Lysa appelle la mémoire du monde : dégâts sacrés et soin total.");
        a.element = Some(Element::Holy);
        a
    },
    // 51.. actions ennemies
    {
        let mut a = base("e_bite", "Morsure", "Morsure vorace.", Attack);
        a.fx = Fx::Bite;
        a.cast = 0.35;
        a
    },
    {
        let mut a = base("e_venom_bite", "Croc venimeux", "Morsure empoisonnée.", Technique);
        a.effect = Effect::DamageStatus { magical: false, status: StatusId::Venom, chance: 0.6 };
        a.power = 0.9;
        a.cast = 0.5;
        a.fx = Fx::Bite;
        a
    },
    {
        let mut a = base("e_laser", "Rayon de Lumen", "Rayon concentré à distance.", Technique);
        a.range = 520.0;
        a.power = 1.2;
        a.cast = 0.8;
        a.delivery = Delivery::Projectile { speed: 1100.0 };
        a.fx = Fx::Beam;
        a.hits_air = Some(true);
        a.effect = Effect::Damage { magical: true };
        a
    },
    {
        let mut a = base("e_slam", "Écrasement", "Coup massif qui ébranle le sol.", Technique);
        a.power = 2.2;
        a.cast = 0.9;
        a.range = 150.0;
        a.area = 160.0;
        a.knock = 220.0;
        a.fx = Fx::Burst;
        a
    },
    {
        let mut a = spell("e_spore", "Spores soporifiques", "Nuage qui endort.", DebuffMagic, 0.0, 1.2, 0.0, Effect::AddStatus { status: StatusId::Torpor, chance: 0.5 }, Foe);
        a.area = 180.0;
        a
    },
    spell("e_gaze", "Regard de cristal", "Déclenche une cristallisation.", DebuffMagic, 0.0, 1.4, 0.0, Effect::AddStatus { status: StatusId::CrystalCountdown, chance: 0.6 }, Foe),
    spell("e_sentence", "Verdict", "Prononce une sentence.", DebuffMagic, 0.0, 1.5, 0.0, Effect::AddStatus { status: StatusId::Sentence, chance: 0.5 }, Foe),
    spell("e_oil", "Jet de naphte", "Imbibe la cible de naphte.", DebuffMagic, 0.0, 0.8, 0.0, Effect::AddStatus { status: StatusId::Naphtha, chance: 0.9 }, Foe),
    {
        let mut a = elem(spell("e_boom", "Autodestruction", "Explose en emportant ses ennemis.", OffenseMagic, 0.0, 1.6, 5.0, Effect::Damage { magical: true }, Foe), Element::Fire);
        a.area = 200.0;
        a.reflectable = false;
        a.range = 140.0;
        a
    },
    {
        let mut a = elem(spell("e_supernova", "Supernova Noire", "Le Séraph embrase le monde.", OffenseMagic, 30.0, 3.2, 4.2, Effect::Damage { magical: true }, Foe), Element::Dark);
        a.area = 2000.0;
        a.reflectable = false;
        a.range = 2000.0;
        a.fx = Fx::Ultimate;
        a
    },
    {
        let mut a = elem(spell("e_dark_wave", "Vague de Néant", "Onde de ténèbres.", OffenseMagic, 8.0, 1.2, 2.4, Effect::Damage { magical: true }, Foe), Element::Dark);
        a.area = 240.0;
        a.fx = Fx::Wave;
        a
    },
    {
        let mut a = elem(spell("e_frost", "Souffle glacial", "Souffle gelé en cône.", OffenseMagic, 0.0, 1.0, 2.0, Effect::Damage { magical: true }, Foe), Element::Ice);
        a.area = 200.0;
        a.reflectable = false;
        a
    },
    spell("e_revers", "Malédiction inverse", "Inverse soins et dégâts.", DebuffMagic, 0.0, 1.2, 0.0, Effect::AddStatus { status: StatusId::Revers, chance: 0.7 }, Foe),
    {
        let mut a = base("kit_zap", "Décharge Kit", "Petite décharge électrique du drone.", Technique);
        a.range = 400.0;
        a.power = 1.0;
        a.element = Some(Element::Thunder);
        a.delivery = Delivery::Projectile { speed: 1000.0 };
        a.hits_air = Some(true);
        a.fx = Fx::Bolt;
        a
    },
];

const fn ult(code: &'static str, name: &'static str, desc: &'static str) -> ActionDef {
    let mut a = base(code, name, desc, Special);
    a.power = 9.0;
    a.area = 4000.0;
    a.range = 4000.0;
    a.anim = 1.6;
    a.recover = 0.4;
    a.delivery = Delivery::Instant;
    a.hits_air = Some(true);
    a.fx = Fx::Ultimate;
    a.knock = 260.0;
    a.launch = 300.0;
    a.reflex_ok = false;
    a
}

pub fn action(id: ActionId) -> &'static ActionDef {
    &ACTIONS[id as usize]
}

pub fn action_from_code(code: &str) -> Option<ActionId> {
    ACTIONS.iter().position(|a| a.code == code).map(|i| i as ActionId)
}

/// Masques de purge (calculés à l'exécution car non-const).
pub fn cleanse_mask_for(id: ActionId) -> u32 {
    match id {
        A_PURGE | A_I_PANACEE => negative_mask(),
        A_EVEIL => mask(&[StatusId::Torpor, StatusId::Vertigo, StatusId::Frozen]),
        _ => match action(id).effect {
            Effect::Cleanse { mask } => mask,
            _ => 0,
        },
    }
}

// ---------------------------------------------------------------------------
// Armes et gabarits
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug)]
pub struct Weapon {
    pub name: &'static str,
    pub power: f32,
    pub range: f32,
    pub hits_air: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Hero,
    Brawler,
    Sage,
    Drone,
    Soldier,
    Hound,
    Bomb,
    Spider,
    Wraith,
    Jelly,
    Specimen,
    Knight,
    Wyvern,
    Golem,
    Seraph,
    KitDrone,
}

pub struct UnitTemplate {
    pub code: &'static str,
    pub name: &'static str,
    pub shape: Shape,
    pub color: u32,
    pub accent: u32,
    pub base: Stats,
    /// Croissance par niveau.
    pub growth: Stats,
    pub weapon: Weapon,
    pub actions: &'static [ActionId],
    pub affinities: [Affinity; ELEMENT_COUNT],
    pub flying: bool,
    pub undead: bool,
    pub boss: bool,
    pub immune: &'static [StatusId],
    pub scale: f32,
    pub xp: u32,
    pub lumens: u32,
    pub steal: Option<ItemId>,
}

const N: Affinity = Affinity::Normal;
const W: Affinity = Affinity::Weak;
const R: Affinity = Affinity::Resist;
const I: Affinity = Affinity::Immune;
const AB: Affinity = Affinity::Absorb;

const fn st(max_hp: f32, max_mp: f32, str_: f32, mag: f32, def: f32, mdef: f32, spd: f32) -> Stats {
    Stats { max_hp, max_mp, str_, mag, def, mdef, spd }
}

pub const T_KAEL: usize = 0;
pub const T_NYRA: usize = 1;
pub const T_LYSA: usize = 2;
pub const T_KIT: usize = 3;

pub static HEROES: [UnitTemplate; 4] = [
    UnitTemplate {
        code: "kael",
        name: "Kael",
        shape: Shape::Hero,
        color: 0x2b3a67,
        accent: 0xe8f0ff,
        base: st(420.0, 40.0, 15.0, 8.0, 10.0, 7.0, 10.0),
        growth: st(38.0, 3.0, 1.6, 0.6, 0.9, 0.6, 0.3),
        weapon: Weapon { name: "Lame Brisée", power: 1.0, range: 92.0, hits_air: false },
        actions: &[A_ATTACK, A_CROC, A_TAILLE, A_PLUIE, A_BRAISE, A_ARC, A_I_TONIQUE, A_I_TONIQUE_PLUS, A_I_PLUME, A_I_ANTIVENIN, A_I_PANACEE, A_I_FIOLE, A_I_GRENADE],
        affinities: [N; ELEMENT_COUNT],
        flying: false,
        undead: false,
        boss: false,
        immune: &[],
        scale: 1.0,
        xp: 0,
        lumens: 0,
        steal: None,
    },
    UnitTemplate {
        code: "nyra",
        name: "Nyra",
        shape: Shape::Brawler,
        color: 0x9a2b3c,
        accent: 0xffd9a0,
        base: st(360.0, 34.0, 13.0, 6.0, 8.0, 7.0, 14.0),
        growth: st(32.0, 2.5, 1.4, 0.5, 0.7, 0.6, 0.45),
        weapon: Weapon { name: "Gantelets", power: 0.8, range: 70.0, hits_air: false },
        actions: &[A_ATTACK, A_COMETE, A_UPPERCUT, A_TORNADE, A_CHAPARDER, A_FRONDE, A_SIPHON, A_I_TONIQUE, A_I_TONIQUE_PLUS, A_I_PLUME, A_I_ANTIVENIN, A_I_PANACEE, A_I_FIOLE, A_I_GRENADE],
        affinities: [N; ELEMENT_COUNT],
        flying: false,
        undead: false,
        boss: false,
        immune: &[],
        scale: 0.95,
        xp: 0,
        lumens: 0,
        steal: None,
    },
    UnitTemplate {
        code: "lysa",
        name: "Lysa",
        shape: Shape::Sage,
        color: 0xd86fa8,
        accent: 0xfff2c8,
        base: st(300.0, 80.0, 7.0, 16.0, 6.0, 12.0, 11.0),
        growth: st(26.0, 6.0, 0.5, 1.7, 0.5, 1.0, 0.35),
        weapon: Weapon { name: "Bâton de Saule", power: 0.7, range: 80.0, hits_air: false },
        actions: &[A_ATTACK, A_SUTURE, A_SUTURE_PLUS, A_CHORALE, A_RELEVE, A_PURGE, A_EVEIL, A_GIVRE, A_ONDE, A_RAFALE, A_SEISME, A_AUBE, A_IMPACT, A_EGIDE, A_PRISME, A_ELAN, A_SEVE, A_MIROIR, A_VENIN, A_MUTISME, A_BRUME, A_ENGOURDIR, A_TORPEUR, A_DISSIPER, A_SIPHON, A_I_TONIQUE, A_I_TONIQUE_PLUS, A_I_PLUME, A_I_ANTIVENIN, A_I_PANACEE, A_I_FIOLE],
        affinities: [N; ELEMENT_COUNT],
        flying: false,
        undead: false,
        boss: false,
        immune: &[],
        scale: 0.92,
        xp: 0,
        lumens: 0,
        steal: None,
    },
    UnitTemplate {
        code: "kit",
        name: "Kit-9",
        shape: Shape::KitDrone,
        color: 0x5ad1c9,
        accent: 0xffffff,
        base: st(260.0, 60.0, 9.0, 12.0, 8.0, 8.0, 12.0),
        growth: st(22.0, 3.0, 0.8, 1.0, 0.6, 0.6, 0.3),
        weapon: Weapon { name: "Arc électrique", power: 0.8, range: 400.0, hits_air: true },
        actions: &[A_KIT_ZAP, A_SUTURE, A_EGIDE, A_ARDEUR, A_FERVEUR, A_APPAT],
        affinities: [N, N, AB, W, N, N, N, N],
        flying: true,
        undead: false,
        boss: false,
        immune: &[StatusId::Venom, StatusId::Torpor],
        scale: 0.8,
        xp: 0,
        lumens: 0,
        steal: None,
    },
];

macro_rules! foe {
    ($code:expr, $name:expr, $shape:ident, $col:expr, $acc:expr, $base:expr, $wp:expr, $acts:expr, $aff:expr, fly=$fly:expr, undead=$ud:expr, boss=$boss:expr, immune=$imm:expr, scale=$sc:expr, xp=$xp:expr, lumens=$lm:expr, steal=$steal:expr) => {
        UnitTemplate {
            code: $code,
            name: $name,
            shape: Shape::$shape,
            color: $col,
            accent: $acc,
            base: $base,
            growth: st(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            weapon: $wp,
            actions: $acts,
            affinities: $aff,
            flying: $fly,
            undead: $ud,
            boss: $boss,
            immune: $imm,
            scale: $sc,
            xp: $xp,
            lumens: $lm,
            steal: $steal,
        }
    };
}

pub const F_SOLDIER: usize = 0;
pub const F_DRONE: usize = 1;
pub const F_HOUND: usize = 2;
pub const F_BOMB: usize = 3;
pub const F_SPIDER: usize = 4;
pub const F_WRAITH: usize = 5;
pub const F_JELLY: usize = 6;
pub const F_SPECIMEN_SMALL: usize = 7;
pub const F_SPECIMEN: usize = 8;
pub const F_KNIGHT: usize = 9;
pub const F_WYVERN: usize = 10;
pub const F_GOLEM: usize = 11;
pub const F_SERAPH: usize = 12;

const fn wp(power: f32, range: f32, air: bool) -> Weapon {
    Weapon { name: "", power, range, hits_air: air }
}

pub static FOES: [UnitTemplate; 13] = [
    foe!("soldier", "Sentinelle Solaris", Soldier, 0x3a4a5a, 0x7dffb0, st(170.0, 20.0, 11.0, 6.0, 8.0, 6.0, 9.0), wp(1.0, 85.0, false), &[A_ATTACK, A_E_LASER], [N, N, W, N, N, N, N, N], fly=false, undead=false, boss=false, immune=&[], scale=1.0, xp=14, lumens=18, steal=Some(IT_TONIQUE)),
    foe!("drone", "Drone Vigie", Drone, 0x8a9aa8, 0xff4a4a, st(110.0, 30.0, 8.0, 9.0, 6.0, 6.0, 12.0), wp(0.9, 380.0, true), &[A_E_LASER], [N, N, W, R, I, N, N, N], fly=true, undead=false, boss=false, immune=&[StatusId::Venom, StatusId::Torpor], scale=0.9, xp=12, lumens=15, steal=Some(IT_FIOLE)),
    foe!("hound", "Chien de Garde Lumen", Hound, 0x5a3a2a, 0x7dffb0, st(140.0, 0.0, 12.0, 3.0, 6.0, 4.0, 15.0), wp(0.9, 70.0, false), &[A_E_BITE, A_E_VENOM_BITE], [W, N, N, N, N, N, N, N], fly=false, undead=false, boss=false, immune=&[], scale=0.9, xp=12, lumens=10, steal=Some(IT_ANTIVENIN)),
    foe!("bomb", "Feu Follet Lumen", Bomb, 0xff8a2a, 0xffee88, st(130.0, 20.0, 6.0, 12.0, 5.0, 10.0, 10.0), wp(0.8, 70.0, false), &[A_ATTACK, A_BRAISE, A_E_SELF_DESTRUCT], [AB, W, N, W, N, N, N, N], fly=true, undead=false, boss=false, immune=&[StatusId::Torpor], scale=0.85, xp=16, lumens=20, steal=Some(IT_GRENADE)),
    foe!("spider", "Arachnide de Garde Mk.II", Spider, 0x50606e, 0xffaa33, st(2600.0, 200.0, 17.0, 14.0, 14.0, 10.0, 9.0), wp(1.1, 160.0, false), &[A_ATTACK, A_E_SLAM, A_E_LASER, A_E_OIL], [N, N, W, W, N, N, N, N], fly=false, undead=false, boss=true, immune=&[StatusId::Torpor, StatusId::Vertigo, StatusId::Frozen, StatusId::Crystal, StatusId::CrystalCountdown, StatusId::Sentence], scale=2.3, xp=160, lumens=300, steal=Some(IT_TONIQUE_PLUS)),
    foe!("wraith", "Âme de Lumen", Wraith, 0x8affd0, 0xffffff, st(190.0, 60.0, 6.0, 14.0, 4.0, 12.0, 10.0), wp(0.9, 80.0, false), &[A_ATTACK, A_NEANT, A_MUTISME], [N, N, N, N, N, N, W, AB], fly=false, undead=true, boss=false, immune=&[StatusId::Venom], scale=1.0, xp=20, lumens=22, steal=Some(IT_FIOLE)),
    foe!("jelly", "Méduse d'Éther", Jelly, 0x4ac3ff, 0xd0f4ff, st(170.0, 60.0, 6.0, 13.0, 6.0, 12.0, 9.0), wp(0.8, 90.0, true), &[A_ATTACK, A_ONDE, A_MUTISME, A_E_REVERS], [N, N, W, AB, N, N, N, N], fly=true, undead=false, boss=false, immune=&[], scale=0.95, xp=20, lumens=22, steal=Some(IT_PANACEE)),
    foe!("experiment", "Expérience 07", Specimen, 0x7a5a8a, 0xb0ff60, st(240.0, 40.0, 13.0, 10.0, 9.0, 7.0, 10.0), wp(1.0, 90.0, false), &[A_ATTACK, A_E_SLEEP_SPORE, A_E_VENOM_BITE], [W, N, N, N, N, N, N, N], fly=false, undead=false, boss=false, immune=&[], scale=1.15, xp=24, lumens=26, steal=Some(IT_TONIQUE)),
    foe!("lazare", "Spécimen Ω-Lazare", Specimen, 0x5a2a6a, 0xff4af0, st(4200.0, 400.0, 19.0, 18.0, 13.0, 14.0, 10.0), wp(1.2, 150.0, false), &[A_ATTACK, A_E_SLEEP_SPORE, A_E_REVERS, A_E_DARK_WAVE, A_MIROIR, A_SUTURE_PLUS], [W, N, N, N, N, N, W, AB], fly=false, undead=true, boss=true, immune=&[StatusId::Torpor, StatusId::Frozen, StatusId::Crystal, StatusId::CrystalCountdown, StatusId::Sentence, StatusId::Vertigo], scale=2.4, xp=300, lumens=500, steal=Some(IT_PLUME)),
    foe!("knight", "Chevalier d'Argent", Knight, 0xc8d0e0, 0x4aa8ff, st(330.0, 40.0, 18.0, 10.0, 15.0, 9.0, 11.0), wp(1.2, 100.0, false), &[A_ATTACK, A_E_SLAM, A_E_SENTENCE], [N, N, W, N, N, N, N, R], fly=false, undead=false, boss=false, immune=&[], scale=1.15, xp=34, lumens=40, steal=Some(IT_TONIQUE_PLUS)),
    foe!("wyvern", "Vouivre du Cratère", Wyvern, 0x3a6a4a, 0xffd040, st(290.0, 40.0, 16.0, 12.0, 10.0, 9.0, 13.0), wp(1.1, 120.0, true), &[A_ATTACK, A_E_FROST_BREATH], [N, W, N, N, I, R, N, N], fly=true, undead=false, boss=false, immune=&[], scale=1.2, xp=34, lumens=40, steal=Some(IT_FIOLE)),
    foe!("golem", "Golem de Cristal", Golem, 0x9ad0ff, 0xffffff, st(420.0, 30.0, 17.0, 8.0, 20.0, 8.0, 7.0), wp(1.3, 110.0, false), &[A_ATTACK, A_E_SLAM, A_E_CRYSTAL_GAZE], [N, N, N, W, AB, N, N, N], fly=false, undead=false, boss=false, immune=&[StatusId::Venom, StatusId::Crystal, StatusId::CrystalCountdown], scale=1.35, xp=38, lumens=44, steal=Some(IT_PANACEE)),
    foe!("seraph", "Séraph Ashka", Seraph, 0x1a1a2a, 0xe8e8ff, st(7400.0, 999.0, 23.0, 22.0, 15.0, 15.0, 13.0), wp(1.4, 140.0, true), &[A_ATTACK, A_E_DARK_WAVE, A_E_SUPERNOVA, A_E_SENTENCE, A_BRASIER, A_GIVRE, A_ARC], [N, N, N, N, N, N, W, AB], fly=false, undead=false, boss=true, immune=&[StatusId::Torpor, StatusId::Frozen, StatusId::Crystal, StatusId::CrystalCountdown, StatusId::Sentence, StatusId::Vertigo, StatusId::Mute, StatusId::Shackle], scale=1.6, xp=0, lumens=0, steal=Some(IT_PLUME)),
];
