//! État du combat : unités, inventaire partagé, équipe (PartyManager),
//! événements. Les systèmes qui agissent sur cet état vivent dans
//! `ai.rs` (Réflexes) et `sim.rs` (planification, exécution, navigation).

use std::collections::VecDeque;

use crate::data::{action, ActionId, ItemId, Shape, UnitTemplate, Weapon, A_ATTACK, FOES, HEROES, ITEMS, ITEM_COUNT};
use crate::reflex::{ReflexBook, SlotTrace};
use crate::rng::Rng;
use crate::status::{StatusId, StatusSet};
use crate::types::{Affinity, Element, Stats, Team, UnitId, Vec2, ELEMENT_COUNT};

pub const GRAVITY: f32 = 2000.0;
pub const FLY_ALT: f32 = 150.0;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Controller {
    /// Contrôlé par le joueur humain n°p (0..3).
    Human(u8),
    Ai,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// Choisie par le Réflexe n° (0..11).
    Reflex(u8),
    /// Ordre manuel donné via le menu de commande.
    Manual,
    /// Action directe d'un joueur (combo, arte).
    Direct,
    /// Comportement imposé par un statut (Vertige, Rage).
    Status,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Phase {
    /// Déplacement vers la portée d'exécution.
    Approach,
    /// Préparation / incantation.
    Charge,
    /// Animation ; l'effet tombe à mi-parcours.
    Execute { hit_done: bool },
    /// Retour au calme.
    Recover,
}

#[derive(Clone, Copy, Debug)]
pub struct Job {
    pub action: ActionId,
    pub target: Option<UnitId>,
    pub source: Source,
    pub phase: Phase,
    pub t: f32,
    /// Une unité d'objet est réservée dans l'inventaire commun.
    pub reserved: bool,
    pub stuck: f32,
    /// Coup d'un combo direct (0, 1, 2).
    pub combo: u8,
}

#[derive(Clone, Copy, Debug)]
pub struct Order {
    pub action: ActionId,
    pub target: UnitId,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TplRef {
    Hero(usize),
    Foe(usize),
}

impl TplRef {
    pub fn tpl(self) -> &'static UnitTemplate {
        match self {
            TplRef::Hero(i) => &HEROES[i],
            TplRef::Foe(i) => &FOES[i],
        }
    }
}

#[derive(Clone, Debug)]
pub struct Unit {
    pub id: UnitId,
    pub team: Team,
    pub tpl: TplRef,
    pub name: String,
    pub level: u32,
    pub stats: Stats,
    pub hp: f32,
    pub mp: f32,
    pub pos: Vec2,
    pub vel: Vec2,
    pub facing: f32,
    pub flying: bool,
    pub undead: bool,
    pub boss: bool,
    pub affinities: [Affinity; ELEMENT_COUNT],
    pub statuses: StatusSet,
    pub actions: Vec<ActionId>,
    pub weapon: Weapon,
    pub controller: Controller,
    /// Joueur humain ayant activé le pilote automatique (ses Réflexes jouent pour lui).
    pub auto: bool,
    pub guest: bool,
    pub book: ReflexBook,
    /// Cible actuellement reconnue (pour « cible du meneur », « visant X »...).
    pub target: Option<UnitId>,
    /// Jauge d'action 0..1 (IA).
    pub gauge: f32,
    pub job: Option<Job>,
    pub manual: Option<Order>,
    pub decide_cd: f32,
    pub hitstun: f32,
    pub invuln: f32,
    pub surcharge: f32,
    pub guard: bool,
    pub on_ground: bool,
    pub stolen: bool,
    pub engaged: bool,
    /// Ne participe plus (ennemi vaincu et disparu).
    pub gone: bool,
    pub fade: f32,
    pub hit_flash: f32,
    pub cooldowns: Vec<(ActionId, f32)>,
    /// Délai entre deux actions spéciales (ennemis).
    pub special_cd: f32,
    pub anim_t: f32,
    pub last_trace: Vec<SlotTrace>,
    pub combo_window: f32,
    pub combo_next: u8,
    pub air_jumps: u8,
    pub bonus_crit: f32,
    pub lifesteal: f32,
    /// Vitesse horizontale désirée ce tick (contrôle / navigation).
    pub move_x: f32,
    pub approach_t: f32,
}

impl Unit {
    pub fn alive(&self) -> bool {
        !self.statuses.has(StatusId::Ko) && !self.gone
    }

    pub fn ko(&self) -> bool {
        self.statuses.has(StatusId::Ko) && !self.gone
    }

    /// PV max effectifs (Ampleur double les PV max).
    pub fn max_hp(&self) -> f32 {
        if self.statuses.has(StatusId::Ampleur) {
            self.stats.max_hp * 2.0
        } else {
            self.stats.max_hp
        }
    }

    pub fn hp_ratio(&self) -> f32 {
        if self.max_hp() <= 0.0 {
            0.0
        } else {
            self.hp / self.max_hp()
        }
    }

    pub fn mp_ratio(&self) -> f32 {
        if self.stats.max_mp <= 0.0 {
            1.0
        } else {
            self.mp / self.stats.max_mp
        }
    }

    pub fn is_airborne_target(&self) -> bool {
        self.flying || self.pos.y > 90.0
    }

    pub fn is_human(&self) -> bool {
        matches!(self.controller, Controller::Human(_))
    }

    /// Les Réflexes pilotent-ils cette unité ?
    pub fn ai_driven(&self) -> bool {
        !self.is_human() || self.auto
    }

    pub fn knows(&self, a: ActionId) -> bool {
        a == A_ATTACK || self.actions.contains(&a)
    }

    pub fn cooldown(&self, a: ActionId) -> f32 {
        self.cooldowns.iter().find(|c| c.0 == a).map(|c| c.1).unwrap_or(0.0)
    }

    pub fn stat_value(&self, s: crate::types::Stat) -> f32 {
        use crate::types::Stat::*;
        match s {
            Hp => self.hp,
            MaxHp => self.max_hp(),
            Mp => self.mp,
            MaxMp => self.stats.max_mp,
            Level => self.level as f32,
            Str => self.stats.str_,
            Mag => self.stats.mag,
            Spd => self.stats.spd,
            Def => self.stats.def,
            Mdef => self.stats.mdef,
        }
    }

    /// Multiplicateur élémentaire effectif, sans confondre faiblesse et vulnérabilité.
    pub fn element_mult(&self, e: Element) -> f32 {
        if e == Element::Earth && self.statuses.has(StatusId::Weightless) {
            return 0.0;
        }
        let mut m = self.affinities[e as usize].multiplier();
        if e == Element::Fire && self.statuses.has(StatusId::Naphtha) && m > 0.0 {
            m *= 2.0;
        }
        m
    }

    pub fn shape(&self) -> Shape {
        self.tpl.tpl().shape
    }
}

/// Inventaire commun avec réservations : un objet planifié par un personnage
/// est réservé jusqu'à son exécution (consommation) ou son annulation (libération).
#[derive(Clone, Debug, Default)]
pub struct Inventory {
    pub count: [u32; ITEM_COUNT],
    pub reserved: [u32; ITEM_COUNT],
}

impl Inventory {
    pub fn available(&self, it: ItemId) -> u32 {
        let i = it as usize;
        self.count[i].saturating_sub(self.reserved[i])
    }

    pub fn reserve(&mut self, it: ItemId) -> bool {
        if self.available(it) == 0 {
            return false;
        }
        self.reserved[it as usize] += 1;
        true
    }

    pub fn release(&mut self, it: ItemId) {
        let r = &mut self.reserved[it as usize];
        *r = r.saturating_sub(1);
    }

    /// Consomme une unité préalablement réservée.
    pub fn consume_reserved(&mut self, it: ItemId) -> bool {
        let i = it as usize;
        if self.reserved[i] == 0 || self.count[i] == 0 {
            return false;
        }
        self.reserved[i] -= 1;
        self.count[i] -= 1;
        true
    }

    pub fn add(&mut self, it: ItemId, n: u32) {
        self.count[it as usize] = (self.count[it as usize] + n).min(99);
    }
}

#[derive(Clone, Debug)]
pub struct Projectile {
    pub owner: UnitId,
    pub team: Team,
    pub action: ActionId,
    pub target: Option<UnitId>,
    pub pos: Vec2,
    pub vel: Vec2,
    pub life: f32,
    pub color: u32,
    pub hit: Vec<UnitId>,
    pub direct: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Ev {
    Damage { unit: UnitId, amount: f32, crit: bool, weak: bool, element: Option<Element> },
    Heal { unit: UnitId, amount: f32 },
    Mp { unit: UnitId, amount: f32 },
    Miss { unit: UnitId },
    Status { unit: UnitId, status: StatusId, added: bool },
    Ko { unit: UnitId },
    Raised { unit: UnitId },
    CastStart { unit: UnitId, action: ActionId },
    ActionFired { unit: UnitId, action: ActionId, target: Option<UnitId> },
    Impact { pos: Vec2, action: ActionId, color: u32 },
    Stolen { unit: UnitId, item: Option<ItemId>, lumens: u32 },
    Reflected { unit: UnitId },
    Ultimate { unit: UnitId, action: ActionId },
    Cancelled { unit: UnitId, reason: &'static str },
    Guarded { unit: UnitId },
    Jump { unit: UnitId },
}

#[derive(Clone, Debug)]
pub struct Settings {
    /// Mode Étendu : conditions composées actives.
    pub extended: bool,
    /// Intervalle mini entre deux évaluations du grimoire (s).
    pub decision_interval: f32,
    /// Rayon de vision pour « en vue ».
    pub view_radius: f32,
    /// Rayon d'engagement : ennemis considérés par les Réflexes.
    pub engage_radius: f32,
    /// Garder une trace de décision (outil de débogage).
    pub trace: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { extended: false, decision_interval: 0.12, view_radius: 900.0, engage_radius: 1400.0, trace: true }
    }
}

#[derive(Clone, Debug)]
pub struct Battle {
    pub units: Vec<Unit>,
    pub inventory: Inventory,
    pub leader: Option<UnitId>,
    pub rng: Rng,
    pub time: f32,
    pub settings: Settings,
    pub arena: (f32, f32),
    pub projectiles: Vec<Projectile>,
    pub events: Vec<Ev>,
    pub log: VecDeque<String>,
    pub lumens: u32,
    pub xp: u32,
    /// Arrêt sur image après un gros coup (ressenti).
    pub hitstop: f32,
    /// Ralenti cinématique d'arcane ultime : seules les unités listées bougent.
    pub cinematic: f32,
    pub cinematic_unit: Option<UnitId>,
    pub combo_count: u32,
    pub combo_timer: f32,
}

impl Battle {
    pub fn new(seed: u64) -> Battle {
        Battle {
            units: Vec::new(),
            inventory: Inventory::default(),
            leader: None,
            rng: Rng::new(seed),
            time: 0.0,
            settings: Settings::default(),
            arena: (0.0, 2200.0),
            projectiles: Vec::new(),
            events: Vec::new(),
            log: VecDeque::new(),
            lumens: 0,
            xp: 0,
            hitstop: 0.0,
            cinematic: 0.0,
            cinematic_unit: None,
            combo_count: 0,
            combo_timer: 0.0,
        }
    }

    pub fn unit(&self, id: UnitId) -> &Unit {
        &self.units[id as usize]
    }

    pub fn unit_mut(&mut self, id: UnitId) -> &mut Unit {
        &mut self.units[id as usize]
    }

    pub fn get(&self, id: UnitId) -> Option<&Unit> {
        self.units.get(id as usize).filter(|u| !u.gone)
    }

    pub fn log(&mut self, s: String) {
        if self.log.len() > 60 {
            self.log.pop_front();
        }
        self.log.push_back(s);
    }

    fn make_unit(&mut self, tpl_ref: TplRef, team: Team, level: u32, x: f32) -> UnitId {
        let tpl = tpl_ref.tpl();
        let id = self.units.len() as UnitId;
        let lv = level.max(1) as f32 - 1.0;
        let g = tpl.growth;
        let b = tpl.base;
        let stats = Stats {
            max_hp: b.max_hp + g.max_hp * lv,
            max_mp: b.max_mp + g.max_mp * lv,
            str_: b.str_ + g.str_ * lv,
            mag: b.mag + g.mag * lv,
            def: b.def + g.def * lv,
            mdef: b.mdef + g.mdef * lv,
            spd: b.spd + g.spd * lv,
        };
        let mut statuses = StatusSet::default();
        for s in tpl.immune {
            statuses.immune |= 1 << (*s as u32);
        }
        let y = if tpl.flying { FLY_ALT } else { 0.0 };
        self.units.push(Unit {
            id,
            team,
            tpl: tpl_ref,
            name: tpl.name.to_string(),
            level: level.max(1),
            stats,
            hp: stats.max_hp,
            mp: stats.max_mp,
            pos: Vec2::new(x, y),
            vel: Vec2::default(),
            facing: if team == Team::Ally { 1.0 } else { -1.0 },
            flying: tpl.flying,
            undead: tpl.undead,
            boss: tpl.boss,
            affinities: tpl.affinities,
            statuses,
            actions: tpl.actions.to_vec(),
            weapon: tpl.weapon,
            controller: Controller::Ai,
            auto: false,
            guest: false,
            book: ReflexBook::default(),
            target: None,
            gauge: 0.6,
            job: None,
            manual: None,
            decide_cd: 0.0,
            hitstun: 0.0,
            invuln: 0.0,
            surcharge: 0.0,
            guard: false,
            on_ground: true,
            stolen: false,
            engaged: team == Team::Ally,
            gone: false,
            fade: 0.0,
            hit_flash: 0.0,
            cooldowns: Vec::new(),
            special_cd: 0.0,
            anim_t: 0.0,
            last_trace: Vec::new(),
            combo_window: 0.0,
            combo_next: 0,
            air_jumps: 0,
            bonus_crit: 0.0,
            lifesteal: 0.0,
            move_x: 0.0,
            approach_t: 0.0,
        });
        id
    }

    pub fn add_hero(&mut self, hero: usize, level: u32, x: f32) -> UnitId {
        self.make_unit(TplRef::Hero(hero), Team::Ally, level, x)
    }

    pub fn add_foe(&mut self, foe: usize, level: u32, x: f32) -> UnitId {
        let id = self.make_unit(TplRef::Foe(foe), Team::Foe, level, x);
        // Les ennemis sont mis à l'échelle par un facteur de niveau simple.
        let u = self.unit_mut(id);
        let k = 1.0 + (level.saturating_sub(1) as f32) * 0.12;
        u.stats.max_hp *= k;
        u.stats.str_ *= 1.0 + (level.saturating_sub(1) as f32) * 0.06;
        u.stats.mag *= 1.0 + (level.saturating_sub(1) as f32) * 0.06;
        u.hp = u.stats.max_hp;
        u.gauge = 0.0;
        id
    }

    pub fn allies(&self) -> impl Iterator<Item = &Unit> {
        self.units.iter().filter(|u| u.team == Team::Ally && !u.gone)
    }

    pub fn foes(&self) -> impl Iterator<Item = &Unit> {
        self.units.iter().filter(|u| u.team == Team::Foe && !u.gone)
    }

    pub fn living_foes(&self) -> usize {
        self.foes().filter(|u| u.alive()).count()
    }

    /// L'équipe est hors de combat (tous à terre ou cristallisés, invité exclu).
    pub fn party_wiped(&self) -> bool {
        self.allies()
            .filter(|u| !u.guest)
            .all(|u| !u.alive() || u.statuses.has(StatusId::Crystal))
    }

    pub fn item_name(it: ItemId) -> &'static str {
        ITEMS[it as usize].name
    }

    pub fn action_name(a: ActionId) -> &'static str {
        action(a).name
    }

    /// Change de meneur (et de personnage contrôlé pour le joueur `player`).
    pub fn set_leader(&mut self, id: UnitId) {
        self.leader = Some(id);
    }
}

/// Trace de décision exposée à l'outil de débogage (re-export pratique).
pub use crate::reflex::SlotOutcome;
