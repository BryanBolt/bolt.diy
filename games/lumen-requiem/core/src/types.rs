//! Types de base partagés par tous les systèmes.

pub type UnitId = u16;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Team {
    Ally,
    Foe,
}

impl Team {
    pub fn other(self) -> Team {
        match self {
            Team::Ally => Team::Foe,
            Team::Foe => Team::Ally,
        }
    }
}

pub const ELEMENT_COUNT: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Element {
    Fire = 0,
    Ice,
    Thunder,
    Water,
    Earth,
    Wind,
    Holy,
    Dark,
}

impl Element {
    pub const ALL: [Element; ELEMENT_COUNT] = [
        Element::Fire,
        Element::Ice,
        Element::Thunder,
        Element::Water,
        Element::Earth,
        Element::Wind,
        Element::Holy,
        Element::Dark,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Element::Fire => "Feu",
            Element::Ice => "Givre",
            Element::Thunder => "Foudre",
            Element::Water => "Eau",
            Element::Earth => "Terre",
            Element::Wind => "Vent",
            Element::Holy => "Aube",
            Element::Dark => "Néant",
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Element::Fire => "fire",
            Element::Ice => "ice",
            Element::Thunder => "thunder",
            Element::Water => "water",
            Element::Earth => "earth",
            Element::Wind => "wind",
            Element::Holy => "holy",
            Element::Dark => "dark",
        }
    }

    pub fn from_code(s: &str) -> Option<Element> {
        Element::ALL.iter().copied().find(|e| e.code() == s)
    }

    pub fn color(self) -> u32 {
        match self {
            Element::Fire => 0xff6a2a,
            Element::Ice => 0x8fe3ff,
            Element::Thunder => 0xfff04a,
            Element::Water => 0x3a8dff,
            Element::Earth => 0xc08a3e,
            Element::Wind => 0x7dffb0,
            Element::Holy => 0xfff6d0,
            Element::Dark => 0xa35cff,
        }
    }
}

/// Sensibilité d'une unité à un élément. Une faiblesse « explicite » (Weak)
/// est distincte d'une simple vulnérabilité temporaire (ex. Naphte sur le feu).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Affinity {
    Normal,
    Weak,
    Resist,
    Immune,
    Absorb,
}

impl Affinity {
    pub fn multiplier(self) -> f32 {
        match self {
            Affinity::Normal => 1.0,
            Affinity::Weak => 1.5,
            Affinity::Resist => 0.5,
            Affinity::Immune => 0.0,
            Affinity::Absorb => -1.0,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stat {
    Hp,
    MaxHp,
    Mp,
    MaxMp,
    Level,
    Str,
    Mag,
    Spd,
    Def,
    Mdef,
}

impl Stat {
    pub const ALL: [Stat; 10] = [
        Stat::Hp,
        Stat::MaxHp,
        Stat::Mp,
        Stat::MaxMp,
        Stat::Level,
        Stat::Str,
        Stat::Mag,
        Stat::Spd,
        Stat::Def,
        Stat::Mdef,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Stat::Hp => "PV",
            Stat::MaxHp => "PV max",
            Stat::Mp => "ÉT",
            Stat::MaxMp => "ÉT max",
            Stat::Level => "niveau",
            Stat::Str => "force",
            Stat::Mag => "arcane",
            Stat::Spd => "vitesse",
            Stat::Def => "défense",
            Stat::Mdef => "rés. arcane",
        }
    }

    pub fn code(self) -> &'static str {
        match self {
            Stat::Hp => "hp",
            Stat::MaxHp => "maxhp",
            Stat::Mp => "mp",
            Stat::MaxMp => "maxmp",
            Stat::Level => "lvl",
            Stat::Str => "str",
            Stat::Mag => "mag",
            Stat::Spd => "spd",
            Stat::Def => "def",
            Stat::Mdef => "mdef",
        }
    }

    pub fn from_code(s: &str) -> Option<Stat> {
        Stat::ALL.iter().copied().find(|e| e.code() == s)
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Stats {
    pub max_hp: f32,
    pub max_mp: f32,
    pub str_: f32,
    pub mag: f32,
    pub def: f32,
    pub mdef: f32,
    pub spd: f32,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vec2 {
    pub x: f32,
    pub y: f32,
}

impl Vec2 {
    pub const fn new(x: f32, y: f32) -> Self {
        Vec2 { x, y }
    }
    pub fn dist(self, o: Vec2) -> f32 {
        let dx = self.x - o.x;
        let dy = self.y - o.y;
        (dx * dx + dy * dy).sqrt()
    }
}

pub fn clamp(v: f32, lo: f32, hi: f32) -> f32 {
    if v < lo {
        lo
    } else if v > hi {
        hi
    } else {
        v
    }
}
