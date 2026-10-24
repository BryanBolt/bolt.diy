//! Boucle de jeu roguelike, scènes, menus et méta-progression.
//!
//! Toute la logique est pilotée UNIQUEMENT par les entrées des joueurs
//! (`PlayerIn`) et un générateur seedé : le jeu est donc rejouable à
//! l'identique, ce qui permet le multijoueur en ligne en lockstep.

use crate::ai;
use crate::battle::{Battle, Controller, Ev, Inventory, TplRef};
use crate::data::*;
use crate::fx::Fx;
use crate::presets;
use crate::reflex::{catalog, CatalogEntry, ExtExpr, ExtPred, Group, Origin, ReflexBook, ReflexSlot, Rule, Selector, MAX_SLOTS, POSTURES, POSTURE_NAMES};
use crate::rng::Rng;
use crate::sim::{self, btn, HumanInput};
use crate::status::{Polarity, StatusId};
use crate::story::{self, Scene as StoryScene};
use crate::types::{Element, Team, UnitId, Vec2};

pub const MAX_PLAYERS: usize = 3;
pub const DT: f32 = 1.0 / 60.0;
pub const HEROES_N: usize = 3;
pub const BASE_SLOTS: u8 = 8;

pub mod snd {
    pub const HIT: u8 = 1;
    pub const CRIT: u8 = 2;
    pub const SLASH: u8 = 3;
    pub const CAST: u8 = 4;
    pub const HEAL: u8 = 5;
    pub const BUFF: u8 = 6;
    pub const DEBUFF: u8 = 7;
    pub const KO: u8 = 8;
    pub const JUMP: u8 = 9;
    pub const MOVE: u8 = 10;
    pub const OK: u8 = 11;
    pub const BACK: u8 = 12;
    pub const LEVEL: u8 = 13;
    pub const ULT: u8 = 14;
    pub const BOOM: u8 = 15;
    pub const COIN: u8 = 16;
    pub const GUARD: u8 = 17;
    pub const MISS: u8 = 18;
    pub const STEAL: u8 = 19;
    pub const WIN: u8 = 20;
    pub const LOSE: u8 = 21;
    pub const THUNDER: u8 = 22;
    pub const ICE: u8 = 23;
    pub const FIRE: u8 = 24;
    pub const DENY: u8 = 25;
}

pub mod music {
    pub const NONE: u8 = 0;
    pub const TITLE: u8 = 1;
    pub const MAP: u8 = 2;
    pub const BATTLE: u8 = 3;
    pub const BOSS: u8 = 4;
    pub const VICTORY: u8 = 5;
    pub const SAD: u8 = 6;
    pub const FINAL: u8 = 7;
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct PlayerIn {
    pub held: u16,
    /// 0 = rien ; n = bouton d'interface n-1 touché (tactile/souris).
    pub cmd: u16,
}

#[derive(Clone, Debug, Default)]
pub struct Player {
    pub joined: bool,
    pub hero: usize,
    pub held: u16,
    pub pressed: u16,
    /// Appuis + répétition automatique (navigation des menus).
    pub nav: u16,
    pub prev: u16,
    pub cmd: u16,
    pub rep: [f32; 4],
}

#[derive(Clone, Debug)]
pub struct Options {
    /// Mode « Suspens » : ouvrir un menu fige le combat.
    pub wait_mode: bool,
    pub extended: bool,
    pub debug: bool,
    pub show_log: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options { wait_mode: true, extended: false, debug: false, show_log: true }
    }
}

#[derive(Clone, Debug)]
pub struct Meta {
    pub fragments: u32,
    pub runs: u32,
    pub wins: u32,
    pub best_sector: u32,
    pub slots: [u8; HEROES_N],
    pub codex: Vec<bool>,
    pub start_items: u32,
    pub start_lvl: u32,
    pub books: [ReflexBook; HEROES_N],
    pub seen_prologue: bool,
    pub opts: Options,
}

impl Meta {
    pub fn new(n_catalog: usize) -> Meta {
        Meta {
            fragments: 0,
            runs: 0,
            wins: 0,
            best_sector: 0,
            slots: [BASE_SLOTS; HEROES_N],
            codex: vec![false; n_catalog],
            start_items: 0,
            start_lvl: 0,
            books: [presets::hero_book(T_KAEL), presets::hero_book(T_NYRA), presets::hero_book(T_LYSA)],
            seen_prologue: false,
            opts: Options::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Bonus {
    pub str_: f32,
    pub mag: f32,
    pub def: f32,
    pub hp: f32,
    pub mp: f32,
    pub spd: f32,
    pub crit: f32,
    pub lifesteal: f32,
}

#[derive(Clone, Debug)]
pub struct HeroRun {
    pub level: u32,
    pub xp: u32,
    pub hp_ratio: f32,
    pub mp_ratio: f32,
    pub ko: bool,
    pub extra: Vec<ActionId>,
    pub slot_bonus: u8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NodeKind {
    Fight,
    Elite,
    Rest,
    Shop,
    Event,
    Boss,
}

impl NodeKind {
    pub fn name(self) -> &'static str {
        match self {
            NodeKind::Fight => "Combat",
            NodeKind::Elite => "Élite",
            NodeKind::Rest => "Repos",
            NodeKind::Shop => "Marchand",
            NodeKind::Event => "Écho",
            NodeKind::Boss => "Gardien",
        }
    }
    pub fn color(self) -> u32 {
        match self {
            NodeKind::Fight => 0xff7a5a,
            NodeKind::Elite => 0xff3a7a,
            NodeKind::Rest => 0x5aff9a,
            NodeKind::Shop => 0xffd25a,
            NodeKind::Event => 0x9a7aff,
            NodeKind::Boss => 0xff2a2a,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Echo {
    Blade,
    Arcana,
    Stone,
    Heart,
    Spring,
    Swift,
    Hawk,
    Leech,
    Surge,
    Codex,
    Slot,
    Supplies,
    Purse,
    Lore,
}

pub const ECHOES: [Echo; 14] = [
    Echo::Blade,
    Echo::Arcana,
    Echo::Stone,
    Echo::Heart,
    Echo::Spring,
    Echo::Swift,
    Echo::Hawk,
    Echo::Leech,
    Echo::Surge,
    Echo::Codex,
    Echo::Slot,
    Echo::Supplies,
    Echo::Purse,
    Echo::Lore,
];

impl Echo {
    pub fn name(self) -> &'static str {
        match self {
            Echo::Blade => "Fil d'Argent",
            Echo::Arcana => "Flux Arcanique",
            Echo::Stone => "Peau de Basalte",
            Echo::Heart => "Cœur Vaillant",
            Echo::Spring => "Source Vive",
            Echo::Swift => "Pas de Plume",
            Echo::Hawk => "Œil du Faucon",
            Echo::Leech => "Soif de Lumen",
            Echo::Surge => "Marée Montante",
            Echo::Codex => "Codex Tactique",
            Echo::Slot => "Mémoire Étendue",
            Echo::Supplies => "Provisions",
            Echo::Purse => "Bourse Solaris",
            Echo::Lore => "Savoir Oublié",
        }
    }
    pub fn desc(self) -> &'static str {
        match self {
            Echo::Blade => "+15 % de force pour toute l'équipe.",
            Echo::Arcana => "+15 % de puissance arcanique.",
            Echo::Stone => "+15 % de défense et de résistance.",
            Echo::Heart => "+18 % de PV max, soigne 30 %.",
            Echo::Spring => "+25 % d'Éther max, rend tout l'Éther.",
            Echo::Swift => "+12 % de vitesse : jauges et pas plus rapides.",
            Echo::Hawk => "+7 % de chances de coup critique.",
            Echo::Leech => "Les coups rendent 6 % des dégâts en PV.",
            Echo::Surge => "La Surcharge démarre à moitié pleine en combat.",
            Echo::Codex => "Débloque 3 nouvelles conditions de Réflexe.",
            Echo::Slot => "+1 emplacement de Réflexe pour chaque héros.",
            Echo::Supplies => "3 Toniques, 1 Plume d'Aube, 1 Fiole d'Éther.",
            Echo::Purse => "+150 Lumens.",
            Echo::Lore => "Un héros apprend une technique ou un arcane.",
        }
    }
    pub fn color(self) -> u32 {
        match self {
            Echo::Blade => 0xff7a5a,
            Echo::Arcana => 0xb07aff,
            Echo::Stone => 0xc0a070,
            Echo::Heart => 0xff5a8a,
            Echo::Spring => 0x5ab0ff,
            Echo::Swift => 0x7dffb0,
            Echo::Hawk => 0xffe05a,
            Echo::Leech => 0xd02a4a,
            Echo::Surge => 0xffa02a,
            Echo::Codex => 0x5ad1c9,
            Echo::Slot => 0x7af0ff,
            Echo::Supplies => 0x9aff5a,
            Echo::Purse => 0xffd25a,
            Echo::Lore => 0xe0c0ff,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShopEntry {
    Item(ItemId),
    Codex(usize),
    Slot(usize),
    Heal,
}

#[derive(Clone, Debug)]
pub struct Run {
    pub sector: usize,
    pub layer: usize,
    pub map: Vec<Vec<NodeKind>>,
    pub path: Vec<usize>,
    pub heroes: [HeroRun; HEROES_N],
    pub bonus: Bonus,
    pub surge: bool,
    pub guest: bool,
    pub inventory: Inventory,
    pub lumens: u32,
    pub codex: Vec<bool>,
    pub battle: Option<Battle>,
    pub room: Option<NodeKind>,
    pub clear_t: f32,
    pub wipe_t: f32,
    pub kills: u32,
    pub echoes: Vec<Echo>,
    pub time: f32,
}

#[derive(Clone, Debug)]
pub enum After {
    Map,
    SectorIntro,
    Boss,
    NextSector,
    Victory,
    EventReward,
}

#[derive(Clone, Debug)]
pub enum Scene {
    Title,
    HowTo,
    Lobby,
    Story { sc: &'static StoryScene, idx: usize, chars: f32, then: After },
    Map,
    Room,
    Reward { choices: Vec<Echo> },
    Shop { stock: Vec<(ShopEntry, bool)> },
    Rest,
    GameOver { t: f32, frags: u32 },
    Victory { t: f32, frags: u32 },
    Sanctuary,
}

#[derive(Clone, Debug, PartialEq)]
pub enum EdMode {
    Rows,
    Group,
    Sel,
    Act,
    Ext,
}

#[derive(Clone, Debug, PartialEq)]
pub enum PickOpt {
    Clear,
    Group(Group),
    Sel(Selector),
    Act(ActionId, bool),
    Ext(Option<ExtExpr>),
}

#[derive(Clone, Debug)]
pub struct Editor {
    pub owner: usize,
    pub hero: usize,
    pub row: usize,
    pub mode: EdMode,
    pub pick: usize,
    pub options: Vec<PickOpt>,
    pub sel: Option<Selector>,
    pub act: Option<ActionId>,
    pub moving: bool,
    pub hidden: usize,
}

#[derive(Clone, Debug)]
pub struct Command {
    pub owner: usize,
    pub actor: UnitId,
    pub stage: u8,
    pub cursor: usize,
    pub actions: Vec<ActionId>,
    pub action: Option<ActionId>,
    pub targets: Vec<UnitId>,
}

#[derive(Clone, Debug)]
pub enum Overlay {
    Pause { owner: usize, cursor: usize },
    Editor(Editor),
    Command(Command),
}

pub const PAUSE_ITEMS: usize = 7;

pub struct Game {
    pub players: [Player; MAX_PLAYERS],
    pub scene: Scene,
    pub overlays: Vec<Overlay>,
    pub cursor: usize,
    pub run: Option<Run>,
    pub meta: Meta,
    pub meta_dirty: bool,
    pub catalog: Vec<CatalogEntry>,
    pub fx: Fx,
    pub sounds: Vec<u8>,
    pub music: u8,
    pub rng: Rng,
    pub frame: u64,
    pub time: f32,
    pub toast: Option<(String, f32)>,
    /// Caméra (purement visuelle).
    pub cam_x: f32,
    pub online: bool,
    /// Joueurs dont l'entrée a été consommée par un menu ce tick (masque).
    pub busy: u8,
}

pub fn xp_next(level: u32) -> u32 {
    30 + level * level * 7
}

impl Game {
    pub fn new(seed: u64) -> Game {
        let catalog = catalog();
        let n = catalog.len();
        let mut g = Game {
            players: Default::default(),
            scene: Scene::Title,
            overlays: Vec::new(),
            cursor: 0,
            run: None,
            meta: Meta::new(n),
            meta_dirty: false,
            catalog,
            fx: Fx::default(),
            sounds: Vec::new(),
            music: music::TITLE,
            rng: Rng::new(seed),
            frame: 0,
            time: 0.0,
            toast: None,
            cam_x: 0.0,
            online: false,
            busy: 0,
        };
        g.players[0].joined = true;
        g
    }

    pub fn sound(&mut self, s: u8) {
        if self.sounds.len() < 64 {
            self.sounds.push(s);
        }
    }

    pub fn toast(&mut self, s: impl Into<String>) {
        self.toast = Some((s.into(), 2.4));
    }

    pub fn slots_for(&self, h: usize) -> u8 {
        let bonus = self.run.as_ref().map(|r| r.heroes[h].slot_bonus).unwrap_or(0);
        (self.meta.slots[h] + bonus).min(MAX_SLOTS as u8)
    }

    pub fn selector_unlocked(&self, i: usize) -> bool {
        let e = &self.catalog[i];
        if e.origin == Origin::Extended && !self.meta.opts.extended {
            return false;
        }
        e.starter || self.meta.codex.get(i).copied().unwrap_or(false) || self.run.as_ref().map(|r| r.codex.get(i).copied().unwrap_or(false)).unwrap_or(false)
    }

    pub fn hero_actions(&self, h: usize) -> Vec<ActionId> {
        let mut v: Vec<ActionId> = HEROES[h].actions.to_vec();
        if let Some(r) = &self.run {
            for a in &r.heroes[h].extra {
                if !v.contains(a) {
                    v.push(*a);
                }
            }
        }
        v
    }

    pub fn battle(&self) -> Option<&Battle> {
        self.run.as_ref().and_then(|r| r.battle.as_ref())
    }

    pub fn battle_mut(&mut self) -> Option<&mut Battle> {
        self.run.as_mut().and_then(|r| r.battle.as_mut())
    }

    pub fn hero_unit(&self, h: usize) -> Option<UnitId> {
        self.battle().and_then(|b| b.units.iter().find(|u| u.tpl == TplRef::Hero(h) && !u.guest).map(|u| u.id))
    }

    /// Petit condensé de l'état (détection de désynchronisation en ligne).
    pub fn hash(&self) -> u32 {
        let mut h: u64 = self.frame ^ self.rng.state();
        if let Some(r) = &self.run {
            h = h.wrapping_mul(31).wrapping_add(r.lumens as u64);
            if let Some(b) = &r.battle {
                h ^= b.rng.state();
                for u in &b.units {
                    h = h.wrapping_mul(1_000_003).wrapping_add(u.hp.to_bits() as u64 ^ (u.pos.x.to_bits() as u64) << 7);
                }
            }
        }
        (h ^ (h >> 32)) as u32
    }

    // ------------------------------------------------------------------
    // Boucle principale
    // ------------------------------------------------------------------

    pub fn step(&mut self, inputs: &[PlayerIn]) {
        self.frame += 1;
        self.time += DT;
        for (i, p) in self.players.iter_mut().enumerate() {
            let inp = inputs.get(i).copied().unwrap_or_default();
            p.held = inp.held;
            p.pressed = inp.held & !p.prev;
            p.prev = inp.held;
            p.cmd = inp.cmd;
            let mut nav = p.pressed;
            for (k, bit) in [btn::UP, btn::DOWN, btn::LEFT, btn::RIGHT].iter().enumerate() {
                if p.held & bit != 0 {
                    p.rep[k] += DT;
                    if p.rep[k] > 0.38 {
                        p.rep[k] -= 0.09;
                        nav |= bit;
                    }
                } else {
                    p.rep[k] = 0.0;
                }
            }
            p.nav = nav;
        }
        if let Some((_, t)) = self.toast.as_mut() {
            *t -= DT;
            if *t <= 0.0 {
                self.toast = None;
            }
        }
        self.fx.update(DT);
        self.busy = 0;
        if let Some(r) = self.run.as_mut() {
            r.time += DT;
        }
        if !self.overlays.is_empty() {
            self.update_overlay();
            let freeze = self.meta.opts.wait_mode || !matches!(self.scene, Scene::Room);
            if freeze {
                return;
            }
        }
        match self.scene.clone() {
            Scene::Title => self.update_title(),
            Scene::HowTo => {
                if self.any_pressed(btn::A | btn::B | btn::START) || self.any_cmd().is_some() {
                    self.sound(snd::BACK);
                    self.goto(Scene::Title);
                }
            }
            Scene::Lobby => self.update_lobby(),
            Scene::Story { .. } => self.update_story(),
            Scene::Map => self.update_map(),
            Scene::Room => self.update_room(),
            Scene::Reward { choices } => self.update_reward(choices),
            Scene::Shop { stock } => self.update_shop(stock),
            Scene::Rest => self.update_rest(),
            Scene::GameOver { .. } | Scene::Victory { .. } => self.update_end(),
            Scene::Sanctuary => self.update_sanctuary(),
        }
        self.music = self.compute_music();
    }

    fn compute_music(&self) -> u8 {
        match &self.scene {
            Scene::Title | Scene::HowTo | Scene::Sanctuary | Scene::Lobby => music::TITLE,
            Scene::Story { sc, .. } => sc.mood,
            Scene::Map | Scene::Shop { .. } | Scene::Rest | Scene::Reward { .. } => music::MAP,
            Scene::Room => {
                let r = self.run.as_ref();
                match r.and_then(|r| r.room) {
                    Some(NodeKind::Boss) => {
                        if r.map(|r| r.sector).unwrap_or(0) >= 2 {
                            music::FINAL
                        } else {
                            music::BOSS
                        }
                    }
                    _ => {
                        if self.battle().map(|b| b.living_foes() == 0).unwrap_or(false) {
                            music::MAP
                        } else {
                            music::BATTLE
                        }
                    }
                }
            }
            Scene::GameOver { .. } => music::SAD,
            Scene::Victory { .. } => music::VICTORY,
        }
    }

    pub fn goto(&mut self, s: Scene) {
        self.scene = s;
        self.cursor = 0;
    }

    fn joined(&self) -> impl Iterator<Item = usize> + '_ {
        (0..MAX_PLAYERS).filter(|&i| self.players[i].joined)
    }

    fn any_pressed(&self, bits: u16) -> bool {
        self.joined().any(|i| self.players[i].pressed & bits != 0)
    }

    fn any_nav(&self, bits: u16) -> bool {
        self.joined().any(|i| self.players[i].nav & bits != 0)
    }

    fn any_cmd(&self) -> Option<u16> {
        self.joined().find_map(|i| if self.players[i].cmd > 0 { Some(self.players[i].cmd - 1) } else { None })
    }

    /// Navigation verticale générique. Renvoie Some(index) si validé.
    fn menu_nav(&mut self, n: usize) -> Option<usize> {
        if n == 0 {
            return None;
        }
        if let Some(id) = self.any_cmd() {
            let i = id as usize;
            if i < n {
                self.cursor = i;
                self.sound(snd::OK);
                return Some(i);
            }
        }
        if self.any_nav(btn::DOWN | btn::RIGHT) {
            self.cursor = (self.cursor + 1) % n;
            self.sound(snd::MOVE);
        }
        if self.any_nav(btn::UP | btn::LEFT) {
            self.cursor = (self.cursor + n - 1) % n;
            self.sound(snd::MOVE);
        }
        if self.any_pressed(btn::A) {
            self.sound(snd::OK);
            return Some(self.cursor.min(n - 1));
        }
        None
    }

    // ------------------------------------------------------------------
    // Scènes
    // ------------------------------------------------------------------

    fn update_title(&mut self) {
        // N'importe quelle manette peut rejoindre l'écran titre.
        for i in 0..MAX_PLAYERS {
            if self.players[i].pressed != 0 {
                self.players[i].joined = true;
            }
        }
        match self.menu_nav(3) {
            Some(0) => {
                for i in 0..MAX_PLAYERS {
                    self.players[i].joined = i == 0 || (self.players[i].joined && self.players[i].pressed != 0);
                    self.players[i].hero = i;
                }
                self.goto(Scene::Lobby);
            }
            Some(1) => self.goto(Scene::Sanctuary),
            Some(2) => self.goto(Scene::HowTo),
            _ => {}
        }
    }

    fn update_lobby(&mut self) {
        for i in 0..MAX_PLAYERS {
            let p = self.players[i].clone();
            if !p.joined && (p.pressed & (btn::A | btn::START) != 0) {
                self.players[i].joined = true;
                let taken: Vec<usize> = self.joined().filter(|&j| j != i).map(|j| self.players[j].hero).collect();
                self.players[i].hero = (0..HEROES_N).find(|h| !taken.contains(h)).unwrap_or(0);
                self.sound(snd::OK);
                continue;
            }
            if !p.joined {
                continue;
            }
            let dir = if p.nav & btn::RIGHT != 0 {
                1
            } else if p.nav & btn::LEFT != 0 {
                HEROES_N - 1
            } else {
                0
            };
            if dir != 0 {
                let taken: Vec<usize> = self.joined().filter(|&j| j != i).map(|j| self.players[j].hero).collect();
                let mut h = self.players[i].hero;
                for _ in 0..HEROES_N {
                    h = (h + dir) % HEROES_N;
                    if !taken.contains(&h) {
                        break;
                    }
                }
                self.players[i].hero = h;
                self.sound(snd::MOVE);
            }
            if i > 0 && p.pressed & btn::B != 0 {
                self.players[i].joined = false;
                self.sound(snd::BACK);
            }
        }
        let p0 = self.players[0].clone();
        if p0.pressed & btn::B != 0 {
            self.sound(snd::BACK);
            self.goto(Scene::Title);
            return;
        }
        let tap = self.any_cmd();
        if let Some(id) = tap {
            if (10..10 + HEROES_N as u16).contains(&id) {
                let h = (id - 10) as usize;
                let taken: Vec<usize> = self.joined().filter(|&j| j != 0).map(|j| self.players[j].hero).collect();
                if !taken.contains(&h) {
                    self.players[0].hero = h;
                    self.sound(snd::MOVE);
                }
            }
        }
        if p0.pressed & (btn::START | btn::A) != 0 || tap == Some(1) {
            self.sound(snd::OK);
            self.new_run();
        }
    }

    pub fn new_run(&mut self) {
        let n = self.catalog.len();
        let start_lvl = 3 + self.meta.start_lvl;
        let mk = || HeroRun { level: start_lvl, xp: 0, hp_ratio: 1.0, mp_ratio: 1.0, ko: false, extra: Vec::new(), slot_bonus: 0 };
        let mut inv = Inventory::default();
        inv.add(IT_TONIQUE, 4 + self.meta.start_items * 2);
        inv.add(IT_PLUME, 1);
        inv.add(IT_ANTIVENIN, 2);
        inv.add(IT_FIOLE, self.meta.start_items.min(2));
        let map = self.gen_map(0);
        self.run = Some(Run {
            sector: 0,
            layer: 0,
            map,
            path: Vec::new(),
            heroes: [mk(), mk(), mk()],
            bonus: Bonus::default(),
            surge: false,
            guest: false,
            inventory: inv,
            lumens: 60,
            codex: vec![false; n],
            battle: None,
            room: None,
            clear_t: 0.0,
            wipe_t: 0.0,
            kills: 0,
            echoes: Vec::new(),
            time: 0.0,
        });
        self.meta.runs += 1;
        self.meta_dirty = true;
        self.fx.clear();
        let then = After::SectorIntro;
        if !self.meta.seen_prologue {
            self.meta.seen_prologue = true;
            self.goto(Scene::Story { sc: &story::PROLOGUE, idx: 0, chars: 0.0, then });
        } else {
            self.goto(Scene::Story { sc: &story::SECTOR_START[0], idx: 0, chars: 0.0, then: After::Map });
        }
    }

    fn gen_map(&mut self, sector: usize) -> Vec<Vec<NodeKind>> {
        let mut map = vec![vec![NodeKind::Fight]];
        for layer in 1..6 {
            let n = 2 + self.rng.below(2) as usize;
            let mut row = Vec::new();
            for _ in 0..n {
                let r = self.rng.below(100);
                let k = if layer == 5 {
                    if r < 50 {
                        NodeKind::Rest
                    } else {
                        NodeKind::Shop
                    }
                } else if r < 42 {
                    NodeKind::Fight
                } else if r < 58 + sector as u32 * 3 {
                    NodeKind::Elite
                } else if r < 72 {
                    NodeKind::Event
                } else if r < 86 {
                    NodeKind::Shop
                } else {
                    NodeKind::Rest
                };
                row.push(k);
            }
            if layer == 2 && !row.contains(&NodeKind::Fight) {
                row[0] = NodeKind::Fight;
            }
            map.push(row);
        }
        map.push(vec![NodeKind::Boss]);
        map
    }

    fn update_story(&mut self) {
        let Scene::Story { sc, idx, chars, then } = self.scene.clone() else { return };
        let line = sc.lines.get(idx).map(|l| l.1).unwrap_or("");
        let total = line.chars().count() as f32;
        let nchars = chars + DT * 55.0;
        let advance = self.any_pressed(btn::A | btn::X | btn::B) || self.any_cmd() == Some(1);
        let skip = self.any_pressed(btn::START) || self.any_cmd() == Some(2);
        if skip || (advance && nchars >= total && idx + 1 >= sc.lines.len()) {
            self.sound(snd::OK);
            self.after(then);
            return;
        }
        if advance {
            if nchars < total {
                self.scene = Scene::Story { sc, idx, chars: total, then };
            } else {
                self.sound(snd::MOVE);
                self.scene = Scene::Story { sc, idx: idx + 1, chars: 0.0, then };
            }
            return;
        }
        self.scene = Scene::Story { sc, idx, chars: nchars, then };
    }

    fn after(&mut self, then: After) {
        match then {
            After::Map => self.goto(Scene::Map),
            After::SectorIntro => {
                let s = self.run.as_ref().map(|r| r.sector).unwrap_or(0);
                self.goto(Scene::Story { sc: &story::SECTOR_START[s], idx: 0, chars: 0.0, then: After::Map });
            }
            After::Boss => {
                self.build_room(NodeKind::Boss);
                self.goto(Scene::Room);
            }
            After::NextSector => {
                let next = self.run.as_ref().map(|r| r.sector + 1).unwrap_or(1);
                let map = self.gen_map(next);
                if let Some(r) = self.run.as_mut() {
                    r.sector = next;
                    r.layer = 0;
                    r.path.clear();
                    r.map = map;
                    r.guest = next >= 1;
                    for h in r.heroes.iter_mut() {
                        h.ko = false;
                        h.hp_ratio = h.hp_ratio.max(0.85);
                        h.mp_ratio = 1.0;
                    }
                }
                self.meta.best_sector = self.meta.best_sector.max(next as u32);
                self.meta_dirty = true;
                self.goto(Scene::Story { sc: &story::SECTOR_START[next.min(2)], idx: 0, chars: 0.0, then: After::Map });
            }
            After::Victory => {
                let frags = self.finish_run(true);
                self.goto(Scene::Victory { t: 0.0, frags });
            }
            After::EventReward => {
                let choices = self.roll_echoes(2);
                self.goto(Scene::Reward { choices });
            }
        }
    }

    fn update_map(&mut self) {
        let Some(run) = self.run.as_ref() else { return };
        let next = run.layer;
        let n = run.map.get(next).map(|r| r.len()).unwrap_or(0);
        for i in 0..MAX_PLAYERS {
            if self.players[i].joined && self.players[i].pressed & (btn::START | btn::Y) != 0 {
                self.open_editor(i);
                return;
            }
        }
        if self.any_cmd() == Some(900) {
            self.open_editor(0);
            return;
        }
        if let Some(i) = self.menu_nav(n) {
            let kind = self.run.as_ref().unwrap().map[next][i];
            self.run.as_mut().unwrap().path.push(i);
            self.enter_node(kind);
        }
    }

    fn enter_node(&mut self, kind: NodeKind) {
        match kind {
            NodeKind::Fight | NodeKind::Elite => {
                self.build_room(kind);
                self.goto(Scene::Room);
            }
            NodeKind::Boss => {
                if self.run.as_ref().map(|r| r.sector).unwrap_or(0) >= 2 {
                    self.goto(Scene::Story { sc: &story::FINAL_PRE, idx: 0, chars: 0.0, then: After::Boss });
                } else {
                    self.build_room(kind);
                    self.goto(Scene::Room);
                }
            }
            NodeKind::Rest => self.goto(Scene::Rest),
            NodeKind::Shop => {
                let stock = self.roll_shop();
                self.goto(Scene::Shop { stock });
            }
            NodeKind::Event => {
                let i = self.rng.below(story::EVENTS.len() as u32) as usize;
                self.goto(Scene::Story { sc: &story::EVENTS[i], idx: 0, chars: 0.0, then: After::EventReward });
            }
        }
    }

    fn advance_layer(&mut self) {
        if let Some(r) = self.run.as_mut() {
            r.layer += 1;
        }
        self.goto(Scene::Map);
    }

    // ------------------------------------------------------------------
    // Salles de combat
    // ------------------------------------------------------------------

    pub fn build_room(&mut self, kind: NodeKind) {
        let seed = self.rng.next_u64();
        let Some(run) = self.run.as_ref() else { return };
        let sector = run.sector;
        let layer = run.layer;
        let mut b = Battle::new(seed);
        b.settings.extended = self.meta.opts.extended;
        b.arena = (0.0, match kind {
            NodeKind::Boss => 1800.0,
            NodeKind::Elite => 2300.0,
            _ => 2100.0 + self.rng.range(0.0, 400.0),
        });
        // Héros
        let mut hero_ids = [0u16; HEROES_N];
        for (h, hid) in hero_ids.iter_mut().enumerate() {
            let hr = &run.heroes[h];
            let id = b.add_hero(h, hr.level, 140.0 + h as f32 * 70.0);
            let bo = run.bonus;
            let u = b.unit_mut(id);
            u.stats.str_ *= 1.0 + bo.str_;
            u.stats.mag *= 1.0 + bo.mag;
            u.stats.def *= 1.0 + bo.def;
            u.stats.mdef *= 1.0 + bo.def;
            u.stats.max_hp *= 1.0 + bo.hp;
            u.stats.max_mp *= 1.0 + bo.mp;
            u.stats.spd *= 1.0 + bo.spd;
            u.bonus_crit = bo.crit;
            u.lifesteal = bo.lifesteal;
            u.hp = (u.stats.max_hp * hr.hp_ratio).max(1.0);
            u.mp = u.stats.max_mp * hr.mp_ratio;
            u.gauge = 0.5;
            if run.surge {
                u.surcharge = 50.0;
            }
            for a in &hr.extra {
                if !u.actions.contains(a) {
                    u.actions.push(*a);
                }
            }
            let mut book = self.meta.books[h].clone();
            book.unlocked = (self.meta.slots[h] + hr.slot_bonus).min(MAX_SLOTS as u8);
            u.book = book;
            if hr.ko {
                u.hp = 0.0;
                u.statuses.apply(StatusId::Ko, None);
            }
            *hid = id;
        }
        if run.guest {
            let lvl = run.heroes.iter().map(|h| h.level).max().unwrap_or(1);
            let id = b.add_hero(T_KIT, lvl, 60.0);
            let u = b.unit_mut(id);
            u.guest = true;
            u.book = presets::hero_book(T_KIT);
        }
        // Contrôleurs humains
        for p in 0..MAX_PLAYERS {
            if self.players[p].joined {
                let h = self.players[p].hero.min(HEROES_N - 1);
                b.unit_mut(hero_ids[h]).controller = Controller::Human(p as u8);
            }
        }
        let lead_h = self.players[0].hero.min(HEROES_N - 1);
        b.leader = Some(hero_ids[lead_h]);
        b.inventory = run.inventory.clone();
        b.inventory.reserved = [0; ITEM_COUNT];
        // Ennemis
        let lvl = 1 + sector as u32 * 7 / 2 + layer as u32 / 2;
        let pool: &[usize] = match sector {
            0 => &[F_SOLDIER, F_SOLDIER, F_HOUND, F_DRONE, F_BOMB],
            1 => &[F_WRAITH, F_JELLY, F_SPECIMEN_SMALL, F_DRONE, F_BOMB, F_SOLDIER],
            _ => &[F_KNIGHT, F_WYVERN, F_GOLEM, F_WRAITH, F_SPECIMEN_SMALL],
        };
        let (lo, hi) = b.arena;
        let spawn = |b: &mut Battle, f: usize, lv: u32, x: f32, elite: bool| {
            let id = b.add_foe(f, lv, x);
            let u = b.unit_mut(id);
            u.book = presets::foe_book(f);
            u.cooldowns = presets::foe_initial_cooldowns(f);
            if elite {
                u.stats.max_hp *= 1.7;
                u.hp = u.stats.max_hp;
                u.stats.str_ *= 1.15;
                u.name = format!("★ {}", u.name);
            }
            id
        };
        match kind {
            NodeKind::Boss => {
                let boss = [F_SPIDER, F_SPECIMEN, F_SERAPH][sector.min(2)];
                spawn(&mut b, boss, lvl + 2, hi - 380.0, false);
                if sector == 0 {
                    spawn(&mut b, F_DRONE, lvl, hi - 600.0, false);
                    spawn(&mut b, F_DRONE, lvl, hi - 200.0, false);
                }
                for u in b.units.iter_mut().filter(|u| u.team == Team::Foe) {
                    u.engaged = true;
                }
            }
            NodeKind::Elite => {
                let e = pool[self.rng.below(pool.len() as u32) as usize];
                spawn(&mut b, e, lvl + 3, lo + 1000.0, true);
                let e2 = pool[self.rng.below(pool.len() as u32) as usize];
                spawn(&mut b, e2, lvl + 2, lo + 1150.0, true);
                for k in 0..2 {
                    let f = pool[self.rng.below(pool.len() as u32) as usize];
                    spawn(&mut b, f, lvl, lo + 1700.0 + k as f32 * 140.0, false);
                }
            }
            _ => {
                let packs = 2;
                let per = 2 + (layer as u32 + sector as u32) / 3;
                for pk in 0..packs {
                    let base_x = lo + 750.0 + pk as f32 * ((hi - lo) - 1000.0) * 0.7;
                    for k in 0..per {
                        let f = pool[self.rng.below(pool.len() as u32) as usize];
                        let x = base_x + k as f32 * 110.0 + self.rng.range(-30.0, 30.0);
                        spawn(&mut b, f, lvl, x.min(hi - 120.0), false);
                    }
                }
            }
        }
        let names: Vec<String> = b.foes().map(|f| f.name.clone()).collect();
        b.log(format!("Rencontre : {}", names.join(", ")));
        let run = self.run.as_mut().unwrap();
        run.battle = Some(b);
        run.room = Some(kind);
        run.clear_t = 0.0;
        run.wipe_t = 0.0;
        self.fx.clear();
        self.cam_x = 0.0;
        match kind {
            NodeKind::Boss => {
                let name = self.battle().and_then(|b| b.foes().find(|f| f.boss)).map(|f| f.name.clone()).unwrap_or_default();
                self.fx.banner(&name, "GARDIEN", 0xff3a5a, 3.0);
            }
            NodeKind::Elite => self.fx.banner("Rencontre d'élite", "Récompenses accrues", 0xff3a7a, 2.2),
            _ => {}
        }
    }

    fn controlled_unit(&self, p: usize) -> Option<UnitId> {
        let b = self.battle()?;
        b.units.iter().find(|u| u.controller == Controller::Human(p as u8)).map(|u| u.id)
    }

    fn update_room(&mut self) {
        // Commandes globales des joueurs.
        for p in 0..MAX_PLAYERS {
            if !self.players[p].joined || self.busy & (1 << p) != 0 || !self.overlays.is_empty() {
                continue;
            }
            let pr = self.players[p].pressed;
            let cmd = self.players[p].cmd;
            if pr & btn::START != 0 || cmd == 901 {
                self.overlays.push(Overlay::Pause { owner: p, cursor: 0 });
                self.sound(snd::OK);
                return;
            }
            if pr & btn::Y != 0 || cmd == 902 {
                self.open_command(p);
                return;
            }
            if pr & btn::LT != 0 || cmd == 903 {
                self.switch_character(p);
            }
            if pr & btn::SELECT != 0 || cmd == 904 {
                if let Some(id) = self.controlled_unit(p) {
                    let b = self.battle_mut().unwrap();
                    let u = b.unit_mut(id);
                    u.auto = !u.auto;
                    let on = u.auto;
                    let name = u.name.clone();
                    self.toast(format!("{} : pilote automatique {}", name, if on { "ACTIVÉ (Réflexes)" } else { "désactivé" }));
                    self.sound(snd::OK);
                }
            }
        }
        // Entrées de combat.
        let mut inputs = [HumanInput::default(); 4];
        for p in 0..MAX_PLAYERS {
            let owns_menu = self.busy & (1 << p) != 0 || self.overlays.iter().any(|o| match o {
                Overlay::Pause { owner, .. } => *owner == p,
                Overlay::Editor(e) => e.owner == p,
                Overlay::Command(c) => c.owner == p,
            });
            if self.players[p].joined && !owns_menu {
                inputs[p] = HumanInput { held: self.players[p].held, pressed: self.players[p].pressed };
            }
        }
        // Tactile : un appui sur la touche « RT » virtuelle arrive comme bit normal.
        let Some(run) = self.run.as_mut() else { return };
        let Some(b) = run.battle.as_mut() else { return };
        sim::tick(b, DT, &inputs);
        let events: Vec<Ev> = b.events.drain(..).collect();
        let b = run.battle.take().unwrap();
        for e in events {
            self.on_event(&b, e);
        }
        self.run.as_mut().unwrap().battle = Some(b);
        self.after_tick();
    }

    fn after_tick(&mut self) {
        // Meneur à terre : le joueur 1 reprend la main sur un autre héros.
        let lead_dead = self.battle().and_then(|b| b.leader.map(|l| !b.unit(l).alive())).unwrap_or(false);
        if lead_dead {
            let b = self.battle().unwrap();
            if !b.party_wiped() {
                self.switch_character(0);
            }
        }
        let run = self.run.as_mut().unwrap();
        let b = run.battle.as_ref().unwrap();
        let wiped = b.party_wiped();
        let cleared = b.living_foes() == 0;
        if wiped {
            run.wipe_t += DT;
            if run.wipe_t > 2.6 {
                let frags = self.finish_run(false);
                self.sound(snd::LOSE);
                self.goto(Scene::GameOver { t: 0.0, frags });
            }
            return;
        }
        if cleared {
            if run.clear_t == 0.0 {
                let boss = run.room == Some(NodeKind::Boss);
                self.fx.banner(if boss { "GARDIEN VAINCU" } else { "ZONE SÉCURISÉE" }, "Avancez vers la sortie →", 0x7dffb0, 2.6);
                self.sound(snd::WIN);
            }
            let run = self.run.as_mut().unwrap();
            run.clear_t += DT;
            let b = run.battle.as_ref().unwrap();
            let exit = b.arena.1 - 140.0;
            let leader_out = b.leader.map(|l| b.unit(l).pos.x > exit).unwrap_or(false);
            let all_humans_out = b.units.iter().filter(|u| u.is_human() && u.alive()).all(|u| u.pos.x > exit);
            let boss = run.room == Some(NodeKind::Boss);
            // Casual : si personne n'atteint la sortie, l'équipe y va d'elle-même après 7 s.
            if (leader_out || all_humans_out) && run.clear_t > 0.8 || (boss && run.clear_t > 3.0) || run.clear_t > 7.0 {
                self.finish_room();
            }
        }
    }

    fn switch_character(&mut self, p: usize) {
        let Some(b) = self.battle() else { return };
        let cur = b.units.iter().find(|u| u.controller == Controller::Human(p as u8)).map(|u| u.id);
        let cands: Vec<UnitId> = b.units.iter().filter(|u| u.team == Team::Ally && !u.guest && u.alive() && u.controller == Controller::Ai).map(|u| u.id).collect();
        if cands.is_empty() {
            return;
        }
        let next = match cur {
            Some(c) => cands.iter().copied().find(|&id| id > c).unwrap_or(cands[0]),
            None => cands[0],
        };
        let b = self.battle_mut().unwrap();
        if let Some(c) = cur {
            let u = b.unit_mut(c);
            u.controller = Controller::Ai;
            u.auto = false;
            u.guard = false;
        }
        b.unit_mut(next).controller = Controller::Human(p as u8);
        b.unit_mut(next).job = b.unit(next).job.filter(|j| !matches!(j.phase, crate::battle::Phase::Approach));
        if p == 0 {
            b.leader = Some(next);
        }
        let h = match b.unit(next).tpl {
            TplRef::Hero(h) => h,
            _ => 0,
        };
        let name = b.unit(next).name.clone();
        self.players[p].hero = h;
        self.toast(format!("J{} contrôle {}{}", p + 1, name, if p == 0 { " (meneur)" } else { "" }));
        self.sound(snd::MOVE);
    }

    fn finish_room(&mut self) {
        let kind = self.run.as_ref().and_then(|r| r.room).unwrap_or(NodeKind::Fight);
        self.sync_from_battle();
        let run = self.run.as_mut().unwrap();
        run.battle = None;
        run.room = None;
        self.fx.clear();
        match kind {
            NodeKind::Boss => {
                let sector = self.run.as_ref().unwrap().sector;
                let lum = 200 + sector as u32 * 100;
                self.run.as_mut().unwrap().lumens += lum;
                let then = if sector >= 2 { After::Victory } else { After::NextSector };
                self.goto(Scene::Story { sc: &story::SECTOR_END[sector.min(2)], idx: 0, chars: 0.0, then });
            }
            _ => {
                if kind == NodeKind::Elite {
                    self.run.as_mut().unwrap().lumens += 80;
                }
                let choices = self.roll_echoes(3);
                self.goto(Scene::Reward { choices });
            }
        }
    }

    fn sync_from_battle(&mut self) {
        let Some(run) = self.run.as_mut() else { return };
        let Some(b) = run.battle.as_ref() else { return };
        let mut lvl_up = Vec::new();
        for h in 0..HEROES_N {
            if let Some(u) = b.units.iter().find(|u| u.tpl == TplRef::Hero(h) && !u.guest) {
                let hr = &mut run.heroes[h];
                hr.ko = !u.alive();
                hr.hp_ratio = if hr.ko { 0.0 } else { (u.hp / u.stats.max_hp).clamp(0.05, 1.0) };
                hr.mp_ratio = if u.stats.max_mp > 0.0 { (u.mp / u.stats.max_mp).clamp(0.0, 1.0) } else { 1.0 };
                // Les KO se relèvent après le combat avec 1/4 des PV (jeu casual).
                if hr.ko {
                    hr.ko = false;
                    hr.hp_ratio = 0.25;
                }
                hr.xp += b.xp;
                while hr.xp >= xp_next(hr.level) {
                    hr.xp -= xp_next(hr.level);
                    hr.level += 1;
                    hr.hp_ratio = (hr.hp_ratio + 0.3).min(1.0);
                    lvl_up.push(HEROES[h].name);
                }
            }
        }
        run.inventory = b.inventory.clone();
        run.inventory.reserved = [0; ITEM_COUNT];
        run.lumens += b.lumens;
        run.kills += b.units.iter().filter(|u| u.team == Team::Foe && !u.alive()).count() as u32;
        if !lvl_up.is_empty() {
            lvl_up.dedup();
            self.toast(format!("Niveau supérieur : {} !", lvl_up.join(", ")));
            self.sound(snd::LEVEL);
        }
    }

    fn finish_run(&mut self, win: bool) -> u32 {
        let Some(r) = self.run.as_ref() else { return 0 };
        let frags = r.sector as u32 * 12 + r.layer as u32 * 2 + r.kills / 3 + if win { 40 } else { 0 };
        self.meta.fragments += frags;
        if win {
            self.meta.wins += 1;
            self.meta.best_sector = 3;
        }
        self.meta_dirty = true;
        self.run = None;
        self.overlays.clear();
        frags
    }

    fn roll_echoes(&mut self, n: usize) -> Vec<Echo> {
        let mut v: Vec<Echo> = Vec::new();
        let mut guard = 0;
        while v.len() < n && guard < 100 {
            guard += 1;
            let e = ECHOES[self.rng.below(ECHOES.len() as u32) as usize];
            if !v.contains(&e) {
                v.push(e);
            }
        }
        v
    }

    fn update_reward(&mut self, choices: Vec<Echo>) {
        if let Some(i) = self.menu_nav(choices.len()) {
            self.apply_echo(choices[i]);
            self.advance_layer();
        }
    }

    pub fn apply_echo(&mut self, e: Echo) {
        let locked: Vec<usize> = (0..self.catalog.len()).filter(|&i| !self.selector_unlocked(i) && self.catalog[i].origin != Origin::Extended).collect();
        let mut picks = Vec::new();
        if e == Echo::Codex {
            for _ in 0..3 {
                if locked.is_empty() {
                    break;
                }
                let i = locked[self.rng.below(locked.len() as u32) as usize];
                if !picks.contains(&i) {
                    picks.push(i);
                }
            }
        }
        let lore_pool: [(usize, ActionId); 9] = [
            (T_KAEL, A_GIVRE),
            (T_KAEL, A_EGIDE),
            (T_KAEL, A_CHAPARDER),
            (T_NYRA, A_BRAISE),
            (T_NYRA, A_SUTURE),
            (T_NYRA, A_ELAN),
            (T_LYSA, A_CHORALE),
            (T_LYSA, A_BRASIER),
            (T_LYSA, A_AMPLEUR),
        ];
        let lore = lore_pool[self.rng.below(lore_pool.len() as u32) as usize];
        let mut msg = format!("Écho obtenu : {}", e.name());
        let run = self.run.as_mut().unwrap();
        run.echoes.push(e);
        match e {
            Echo::Blade => run.bonus.str_ += 0.15,
            Echo::Arcana => run.bonus.mag += 0.15,
            Echo::Stone => run.bonus.def += 0.15,
            Echo::Heart => {
                run.bonus.hp += 0.18;
                for h in run.heroes.iter_mut() {
                    h.hp_ratio = (h.hp_ratio + 0.3).min(1.0);
                }
            }
            Echo::Spring => {
                run.bonus.mp += 0.25;
                for h in run.heroes.iter_mut() {
                    h.mp_ratio = 1.0;
                }
            }
            Echo::Swift => run.bonus.spd += 0.12,
            Echo::Hawk => run.bonus.crit += 0.07,
            Echo::Leech => run.bonus.lifesteal += 0.06,
            Echo::Surge => run.surge = true,
            Echo::Codex => {
                let names: Vec<String> = picks.iter().map(|&i| self.catalog[i].selector.label()).collect();
                for &i in &picks {
                    run.codex[i] = true;
                }
                msg = format!("Nouvelles conditions : {}", names.join(" · "));
            }
            Echo::Slot => {
                for h in run.heroes.iter_mut() {
                    h.slot_bonus += 1;
                }
            }
            Echo::Supplies => {
                run.inventory.add(IT_TONIQUE, 3);
                run.inventory.add(IT_PLUME, 1);
                run.inventory.add(IT_FIOLE, 1);
            }
            Echo::Purse => run.lumens += 150,
            Echo::Lore => {
                let hr = &mut run.heroes[lore.0];
                if !hr.extra.contains(&lore.1) {
                    hr.extra.push(lore.1);
                }
                msg = format!("{} apprend {} !", HEROES[lore.0].name, action(lore.1).name);
            }
        }
        self.toast(msg);
        self.sound(snd::LEVEL);
    }

    fn roll_shop(&mut self) -> Vec<(ShopEntry, bool)> {
        let mut v: Vec<(ShopEntry, bool)> = vec![
            (ShopEntry::Item(IT_TONIQUE), false),
            (ShopEntry::Item(IT_TONIQUE_PLUS), false),
            (ShopEntry::Item(IT_PLUME), false),
            (ShopEntry::Item(IT_ANTIVENIN), false),
            (ShopEntry::Item(IT_PANACEE), false),
            (ShopEntry::Item(IT_FIOLE), false),
            (ShopEntry::Item(IT_GRENADE), false),
        ];
        let locked: Vec<usize> = (0..self.catalog.len()).filter(|&i| !self.selector_unlocked(i) && self.catalog[i].origin != Origin::Extended).collect();
        for _ in 0..3 {
            if !locked.is_empty() {
                let i = locked[self.rng.below(locked.len() as u32) as usize];
                if !v.contains(&(ShopEntry::Codex(i), false)) {
                    v.push((ShopEntry::Codex(i), false));
                }
            }
        }
        let h = self.rng.below(HEROES_N as u32) as usize;
        v.push((ShopEntry::Slot(h), false));
        v.push((ShopEntry::Heal, false));
        v
    }

    pub fn shop_price(&self, e: ShopEntry) -> u32 {
        match e {
            ShopEntry::Item(it) => ITEMS[it as usize].price,
            ShopEntry::Codex(i) => self.catalog[i].price,
            ShopEntry::Slot(_) => 240,
            ShopEntry::Heal => 90,
        }
    }

    pub fn shop_label(&self, e: ShopEntry) -> String {
        match e {
            ShopEntry::Item(it) => {
                let have = self.run.as_ref().map(|r| r.inventory.count[it as usize]).unwrap_or(0);
                format!("{} (×{})", ITEMS[it as usize].name, have)
            }
            ShopEntry::Codex(i) => format!("Condition : {}", self.catalog[i].selector.label()),
            ShopEntry::Slot(h) => format!("+1 emplacement de Réflexe — {}", HEROES[h].name),
            ShopEntry::Heal => "Soins complets de l'équipe".to_string(),
        }
    }

    fn update_shop(&mut self, mut stock: Vec<(ShopEntry, bool)>) {
        let n = stock.len() + 1;
        if self.any_pressed(btn::B) {
            self.sound(snd::BACK);
            self.advance_layer();
            return;
        }
        if let Some(i) = self.menu_nav(n) {
            if i == stock.len() {
                self.advance_layer();
                return;
            }
            let (e, sold) = stock[i];
            let price = self.shop_price(e);
            let lumens = self.run.as_ref().map(|r| r.lumens).unwrap_or(0);
            if sold {
                self.sound(snd::DENY);
            } else if lumens < price {
                self.toast("Pas assez de Lumens.");
                self.sound(snd::DENY);
            } else {
                let run = self.run.as_mut().unwrap();
                run.lumens -= price;
                match e {
                    ShopEntry::Item(it) => run.inventory.add(it, 1),
                    ShopEntry::Codex(c) => {
                        run.codex[c] = true;
                        stock[i].1 = true;
                    }
                    ShopEntry::Slot(h) => {
                        run.heroes[h].slot_bonus += 1;
                        stock[i].1 = true;
                    }
                    ShopEntry::Heal => {
                        for h in run.heroes.iter_mut() {
                            h.hp_ratio = 1.0;
                            h.mp_ratio = 1.0;
                            h.ko = false;
                        }
                        stock[i].1 = true;
                    }
                }
                self.sound(snd::COIN);
            }
            let cur = self.cursor;
            self.scene = Scene::Shop { stock };
            self.cursor = cur;
        }
    }

    fn update_rest(&mut self) {
        if let Some(i) = self.menu_nav(3) {
            let run = self.run.as_mut().unwrap();
            match i {
                0 => {
                    for h in run.heroes.iter_mut() {
                        h.ko = false;
                        h.hp_ratio = (h.hp_ratio + 0.6).min(1.0);
                        h.mp_ratio = (h.mp_ratio + 0.6).min(1.0);
                    }
                    self.toast("L'équipe reprend des forces.");
                }
                1 => {
                    let h = (0..HEROES_N).min_by_key(|&h| run.heroes[h].level).unwrap_or(0);
                    run.heroes[h].level += 1;
                    let lv = run.heroes[h].level;
                    self.toast(format!("{} s'entraîne : niveau {} !", HEROES[h].name, lv));
                }
                _ => {
                    self.open_editor(0);
                    return;
                }
            }
            self.sound(snd::HEAL);
            self.advance_layer();
        }
    }

    fn update_end(&mut self) {
        match &mut self.scene {
            Scene::GameOver { t, .. } | Scene::Victory { t, .. } => *t += DT,
            _ => {}
        }
        let t = match &self.scene {
            Scene::GameOver { t, .. } | Scene::Victory { t, .. } => *t,
            _ => 0.0,
        };
        if t > 1.2 && (self.any_pressed(btn::A | btn::START) || self.any_cmd().is_some()) {
            self.sound(snd::OK);
            self.goto(Scene::Title);
        }
    }

    pub fn sanctuary_items(&self) -> Vec<(String, u32, bool)> {
        let mut v = Vec::new();
        for h in 0..HEROES_N {
            let s = self.meta.slots[h];
            let cost = 15 + (s as u32 - BASE_SLOTS as u32) * 12;
            v.push((format!("Mémoire de {} : emplacements {} → {}", HEROES[h].name, s, s + 1), cost, (s as usize) < MAX_SLOTS));
        }
        let locked = (0..self.catalog.len()).filter(|&i| !self.catalog[i].starter && !self.meta.codex[i] && self.catalog[i].origin != Origin::Extended).count();
        v.push((format!("Codex permanent : 2 conditions ({} restantes)", locked), 12, locked > 0));
        v.push((format!("Provisions de départ (niveau {})", self.meta.start_items), 10 + self.meta.start_items * 10, self.meta.start_items < 3));
        v.push((format!("Expérience héritée : niveau de départ +1 ({})", self.meta.start_lvl), 30 + self.meta.start_lvl * 20, self.meta.start_lvl < 3));
        v.push(("Réinitialiser les grimoires par défaut".to_string(), 0, true));
        v
    }

    fn update_sanctuary(&mut self) {
        let items = self.sanctuary_items();
        let n = items.len() + 1;
        if self.any_pressed(btn::B) {
            self.sound(snd::BACK);
            self.goto(Scene::Title);
            return;
        }
        if let Some(i) = self.menu_nav(n) {
            if i == items.len() {
                self.goto(Scene::Title);
                return;
            }
            let (_, cost, avail) = items[i].clone();
            if !avail || self.meta.fragments < cost {
                self.sound(snd::DENY);
                self.toast(if !avail { "Déjà au maximum." } else { "Pas assez de Fragments." });
                return;
            }
            self.meta.fragments -= cost;
            match i {
                0..=2 => self.meta.slots[i] += 1,
                3 => {
                    let locked: Vec<usize> = (0..self.catalog.len()).filter(|&i| !self.catalog[i].starter && !self.meta.codex[i] && self.catalog[i].origin != Origin::Extended).collect();
                    let mut names = Vec::new();
                    for _ in 0..2 {
                        let rest: Vec<usize> = locked.iter().copied().filter(|&c| !self.meta.codex[c]).collect();
                        if rest.is_empty() {
                            break;
                        }
                        let c = rest[self.rng.below(rest.len() as u32) as usize];
                        self.meta.codex[c] = true;
                        names.push(self.catalog[c].selector.label());
                    }
                    self.toast(format!("Débloqué : {}", names.join(" · ")));
                }
                4 => self.meta.start_items += 1,
                5 => self.meta.start_lvl += 1,
                _ => {
                    self.meta.books = [presets::hero_book(T_KAEL), presets::hero_book(T_NYRA), presets::hero_book(T_LYSA)];
                    self.toast("Grimoires réinitialisés.");
                }
            }
            self.meta_dirty = true;
            self.sound(snd::COIN);
        }
    }

    // ------------------------------------------------------------------
    // Superpositions : pause, éditeur de Réflexes, ordres manuels
    // ------------------------------------------------------------------

    pub fn open_editor(&mut self, owner: usize) {
        let hero = self.players[owner].hero.min(HEROES_N - 1);
        self.overlays.push(Overlay::Editor(Editor { owner, hero, row: 0, mode: EdMode::Rows, pick: 0, options: Vec::new(), sel: None, act: None, moving: false, hidden: 0 }));
        self.sound(snd::OK);
    }

    fn open_command(&mut self, owner: usize) {
        let Some(actor) = self.controlled_unit(owner).or_else(|| self.battle().and_then(|b| b.leader)) else { return };
        let actions = self.command_actions(actor);
        self.overlays.push(Overlay::Command(Command { owner, actor, stage: 1, cursor: 0, actions, action: None, targets: Vec::new() }));
        self.sound(snd::OK);
    }

    pub fn command_actions(&self, actor: UnitId) -> Vec<ActionId> {
        let Some(b) = self.battle() else { return vec![] };
        let u = b.unit(actor);
        let mut v: Vec<ActionId> = u.actions.iter().copied().filter(|&a| action(a).kind != ActionKind::Special).collect();
        if !v.contains(&A_ATTACK) {
            v.insert(0, A_ATTACK);
        }
        v.sort_by_key(|&a| match action(a).kind {
            ActionKind::Attack => 0,
            ActionKind::Technique => 1,
            ActionKind::HealMagic => 2,
            ActionKind::SupportMagic => 3,
            ActionKind::OffenseMagic => 4,
            ActionKind::DebuffMagic => 5,
            ActionKind::Item => 6,
            ActionKind::Special => 7,
        });
        v
    }

    fn update_overlay(&mut self) {
        let Some(top) = self.overlays.pop() else { return };
        let owner = match &top {
            Overlay::Pause { owner, .. } => *owner,
            Overlay::Editor(e) => e.owner,
            Overlay::Command(c) => c.owner,
        };
        self.busy |= 1 << owner;
        let base = self.overlays.len();
        let keep = match top {
            Overlay::Pause { owner, cursor } => self.update_pause(owner, cursor),
            Overlay::Editor(ed) => self.update_editor(ed),
            Overlay::Command(c) => self.update_command(c),
        };
        // Une nouvelle superposition a pu être empilée (ex. éditeur depuis la pause) : elle reste au sommet.
        let pushed = self.overlays.split_off(base.min(self.overlays.len()));
        if let Some(o) = keep {
            self.overlays.push(o);
        }
        self.overlays.extend(pushed);
    }

    fn owner_in(&self, owner: usize) -> (u16, u16, Option<u16>) {
        let p = &self.players[owner];
        let mut cmd = if p.cmd > 0 { Some(p.cmd - 1) } else { None };
        // Le tactile n'a qu'un appareil : on accepte aussi les tapes des autres joueurs.
        if cmd.is_none() {
            cmd = self.any_cmd();
        }
        (p.pressed, p.nav, cmd)
    }

    pub fn pause_label(&self, i: usize) -> String {
        let o = &self.meta.opts;
        match i {
            0 => "Reprendre".into(),
            1 => "Réflexes (programmer l'IA)".into(),
            2 => format!("Rythme : {}", if o.wait_mode { "SUSPENS (menus figent le combat)" } else { "FLUX (le combat continue)" }),
            3 => format!("Règles : {}", if o.extended { "ÉTENDU (conditions composées)" } else { "FIDÈLE" }),
            4 => format!("Analyse IA (débogage) : {}", if o.debug { "ON" } else { "OFF" }),
            5 => format!("Journal de combat : {}", if o.show_log { "ON" } else { "OFF" }),
            _ => "Abandonner la partie".into(),
        }
    }

    fn update_pause(&mut self, owner: usize, mut cursor: usize) -> Option<Overlay> {
        let (pr, nav, cmd) = self.owner_in(owner);
        if pr & (btn::B | btn::START) != 0 || cmd == Some(599) {
            self.sound(snd::BACK);
            return None;
        }
        if nav & btn::DOWN != 0 {
            cursor = (cursor + 1) % PAUSE_ITEMS;
            self.sound(snd::MOVE);
        }
        if nav & btn::UP != 0 {
            cursor = (cursor + PAUSE_ITEMS - 1) % PAUSE_ITEMS;
            self.sound(snd::MOVE);
        }
        let mut choose = None;
        if pr & btn::A != 0 {
            choose = Some(cursor);
        }
        if let Some(c) = cmd {
            if (500..500 + PAUSE_ITEMS as u16).contains(&c) {
                cursor = (c - 500) as usize;
                choose = Some(cursor);
            }
        }
        if let Some(i) = choose {
            self.sound(snd::OK);
            match i {
                0 => return None,
                1 => {
                    self.open_editor(owner);
                }
                2 => self.meta.opts.wait_mode = !self.meta.opts.wait_mode,
                3 => {
                    self.meta.opts.extended = !self.meta.opts.extended;
                    let ext = self.meta.opts.extended;
                    if let Some(b) = self.battle_mut() {
                        b.settings.extended = ext;
                    }
                }
                4 => self.meta.opts.debug = !self.meta.opts.debug,
                5 => self.meta.opts.show_log = !self.meta.opts.show_log,
                _ => {
                    let frags = self.finish_run(false);
                    self.goto(Scene::GameOver { t: 0.0, frags });
                    return None;
                }
            }
            self.meta_dirty = true;
        }
        Some(Overlay::Pause { owner, cursor })
    }

    fn sync_book_to_battle(&mut self, h: usize) {
        let unlocked = self.slots_for(h);
        let book = self.meta.books[h].clone();
        if let Some(id) = self.hero_unit(h) {
            let b = self.battle_mut().unwrap();
            let u = b.unit_mut(id);
            u.book = book;
            u.book.unlocked = unlocked;
            u.decide_cd = 0.0;
        }
        self.meta_dirty = true;
    }

    pub fn editor_options(&self, ed: &Editor) -> (Vec<PickOpt>, usize) {
        match ed.mode {
            EdMode::Group => (vec![PickOpt::Clear, PickOpt::Group(Group::Ally), PickOpt::Group(Group::Foe), PickOpt::Group(Group::Myself)], 0),
            EdMode::Sel => {
                let g = ed.sel.map(|s| s.group()).unwrap_or(Group::Foe);
                let mut v = Vec::new();
                let mut hidden = 0;
                for (i, e) in self.catalog.iter().enumerate() {
                    if e.selector.group() != g {
                        continue;
                    }
                    if self.selector_unlocked(i) {
                        v.push(PickOpt::Sel(e.selector));
                    } else {
                        hidden += 1;
                    }
                }
                (v, hidden)
            }
            EdMode::Act => {
                let g = ed.sel.map(|s| s.group()).unwrap_or(Group::Foe);
                let undead = ed.sel == Some(Selector::FoeUndead);
                let mut v: Vec<PickOpt> = self
                    .hero_actions(ed.hero)
                    .into_iter()
                    .filter(|&a| action(a).reflex_ok)
                    .map(|a| {
                        let d = action(a);
                        let heal_like = matches!(d.effect, Effect::Heal | Effect::Raise);
                        let ok = match (g, d.target) {
                            (Group::Foe, TargetKind::Foe) => true,
                            (Group::Foe, TargetKind::Ally) => heal_like && undead,
                            (Group::Ally, TargetKind::Ally) => true,
                            (Group::Myself, TargetKind::Ally) | (Group::Myself, TargetKind::SelfOnly) => true,
                            _ => false,
                        };
                        PickOpt::Act(a, ok)
                    })
                    .collect();
                v.sort_by_key(|o| match o {
                    PickOpt::Act(_, ok) => !ok,
                    _ => true,
                });
                (v, 0)
            }
            EdMode::Ext => {
                let mut v = vec![PickOpt::Ext(None)];
                for e in [
                    ExtExpr::Pred(ExtPred::SelfMpAbove(30)),
                    ExtExpr::Pred(ExtPred::KeepMpReserve(25)),
                    ExtExpr::Pred(ExtPred::TargetHpBelow(25)),
                    ExtExpr::Pred(ExtPred::TargetHpAbove(60)),
                    ExtExpr::Pred(ExtPred::TargetFlying),
                    ExtExpr::Not(Box::new(ExtExpr::Pred(ExtPred::TargetFlying))),
                    ExtExpr::Pred(ExtPred::DistanceBelow(240)),
                    ExtExpr::Pred(ExtPred::ItemAtLeast(IT_TONIQUE, 3)),
                    ExtExpr::And(vec![ExtExpr::Pred(ExtPred::SelfMpAbove(20)), ExtExpr::Pred(ExtPred::TargetHpBelow(40))]),
                    ExtExpr::Or(vec![ExtExpr::Pred(ExtPred::TargetWeak(Element::Fire)), ExtExpr::Pred(ExtPred::TargetFlying)]),
                ] {
                    v.push(PickOpt::Ext(Some(e)));
                }
                (v, 0)
            }
            EdMode::Rows => (vec![], 0),
        }
    }

    fn update_editor(&mut self, mut ed: Editor) -> Option<Overlay> {
        let (pr, nav, cmd) = self.owner_in(ed.owner);
        let h = ed.hero;
        let unlocked = self.slots_for(h) as usize;
        if ed.mode == EdMode::Rows {
            if pr & (btn::B | btn::START) != 0 || cmd == Some(234) {
                if ed.moving {
                    ed.moving = false;
                } else {
                    self.sound(snd::BACK);
                    return None;
                }
            }
            let mut edit = pr & btn::A != 0 || cmd == Some(230);
            if let Some(c) = cmd {
                match c {
                    100..=111 => {
                        let r = (c - 100) as usize;
                        if r == ed.row {
                            edit = true;
                        }
                        ed.row = r;
                        ed.moving = false;
                    }
                    200..=202 => {
                        ed.hero = (c - 200) as usize;
                        ed.row = 0;
                    }
                    210..=212 => {
                        self.meta.books[h].active = (c - 210) as usize;
                        self.sync_book_to_battle(h);
                        self.toast(format!("Posture {} active pour {}", POSTURE_NAMES[(c - 210) as usize], HEROES[h].name));
                    }
                    _ => {}
                }
            }
            if ed.moving && (nav & (btn::UP | btn::DOWN) != 0 || cmd == Some(232) || cmd == Some(233)) {
                let up = nav & btn::UP != 0 || cmd == Some(232);
                let lim = unlocked.max(1);
                if ed.row < lim {
                    let to = self.meta.books[h].move_slot(ed.row, up);
                    ed.row = to;
                    self.sync_book_to_battle(h);
                    self.sound(snd::MOVE);
                }
            } else {
                if nav & btn::DOWN != 0 || cmd == Some(233) {
                    ed.row = (ed.row + 1) % MAX_SLOTS;
                    self.sound(snd::MOVE);
                }
                if nav & btn::UP != 0 || cmd == Some(232) {
                    ed.row = (ed.row + MAX_SLOTS - 1) % MAX_SLOTS;
                    self.sound(snd::MOVE);
                }
            }
            if pr & btn::RB != 0 {
                ed.hero = (ed.hero + 1) % HEROES_N;
                self.sound(snd::MOVE);
            }
            if pr & btn::LB != 0 {
                ed.hero = (ed.hero + HEROES_N - 1) % HEROES_N;
                self.sound(snd::MOVE);
            }
            if pr & (btn::RT | btn::LT) != 0 {
                let bk = &mut self.meta.books[h];
                bk.active = if pr & btn::RT != 0 { (bk.active + 1) % POSTURES } else { (bk.active + POSTURES - 1) % POSTURES };
                let a = bk.active;
                self.sync_book_to_battle(h);
                self.toast(format!("Posture {} active pour {}", POSTURE_NAMES[a], HEROES[h].name));
                self.sound(snd::OK);
            }
            if pr & btn::SELECT != 0 || cmd == Some(220) {
                let bk = &mut self.meta.books[h];
                bk.enabled = !bk.enabled;
                let on = bk.enabled;
                self.sync_book_to_battle(h);
                self.toast(format!("Réflexes de {} : {}", HEROES[h].name, if on { "ACTIVÉS" } else { "DÉSACTIVÉS" }));
                self.sound(snd::OK);
            }
            if pr & btn::X != 0 || cmd == Some(231) {
                let row = ed.row;
                let slot = &mut self.meta.books[h].current_mut().slots[row];
                if slot.rule.is_some() {
                    slot.enabled = !slot.enabled;
                    self.sync_book_to_battle(h);
                    self.sound(snd::OK);
                }
            }
            if pr & btn::Y != 0 || cmd == Some(236) {
                ed.moving = !ed.moving;
                self.sound(snd::OK);
            }
            if cmd == Some(235) {
                let row = ed.row;
                self.meta.books[h].current_mut().slots[row] = ReflexSlot::default();
                self.sync_book_to_battle(h);
                self.sound(snd::BACK);
            }
            if edit && !ed.moving {
                if ed.row >= unlocked {
                    self.toast("Emplacement verrouillé : débloquez-le au Sanctuaire ou chez un marchand.");
                    self.sound(snd::DENY);
                } else {
                    ed.mode = EdMode::Group;
                    ed.pick = self.meta.books[h].current().slots[ed.row].rule.as_ref().map(|r| match r.selector.group() {
                        Group::Ally => 1,
                        Group::Foe => 2,
                        Group::Myself => 3,
                    }).unwrap_or(2);
                    ed.options = self.editor_options(&ed).0;
                    self.sound(snd::OK);
                }
            }
            return Some(Overlay::Editor(ed));
        }
        // --- Sélecteurs de liste ---
        let n = ed.options.len();
        if pr & btn::B != 0 || cmd == Some(234) {
            ed.mode = match ed.mode {
                EdMode::Group => EdMode::Rows,
                EdMode::Sel => EdMode::Group,
                EdMode::Act => EdMode::Sel,
                _ => EdMode::Act,
            };
            ed.options = self.editor_options(&ed).0;
            ed.pick = 0;
            self.sound(snd::BACK);
            return Some(Overlay::Editor(ed));
        }
        if n > 0 {
            if nav & btn::DOWN != 0 {
                ed.pick = (ed.pick + 1) % n;
                self.sound(snd::MOVE);
            }
            if nav & btn::UP != 0 {
                ed.pick = (ed.pick + n - 1) % n;
                self.sound(snd::MOVE);
            }
            if nav & btn::RIGHT != 0 {
                ed.pick = (ed.pick + 8).min(n - 1);
            }
            if nav & btn::LEFT != 0 {
                ed.pick = ed.pick.saturating_sub(8);
            }
        }
        let mut choose = if pr & btn::A != 0 { Some(ed.pick) } else { None };
        if let Some(c) = cmd {
            if c >= 300 && ((c - 300) as usize) < n {
                ed.pick = (c - 300) as usize;
                choose = Some(ed.pick);
            }
        }
        if let Some(i) = choose {
            let opt = ed.options.get(i).cloned();
            self.sound(snd::OK);
            match opt {
                Some(PickOpt::Clear) => {
                    let row = ed.row;
                    self.meta.books[h].current_mut().slots[row] = ReflexSlot::default();
                    self.sync_book_to_battle(h);
                    ed.mode = EdMode::Rows;
                }
                Some(PickOpt::Group(g)) => {
                    ed.mode = EdMode::Sel;
                    ed.sel = Some(match g {
                        Group::Ally => Selector::AllyAny,
                        Group::Foe => Selector::FoeNearestVisible,
                        Group::Myself => Selector::SelfAlways,
                    });
                    let (opts, hidden) = self.editor_options(&ed);
                    ed.options = opts;
                    ed.hidden = hidden;
                    let cur = self.meta.books[h].current().slots[ed.row].rule.as_ref().map(|r| r.selector);
                    ed.pick = ed.options.iter().position(|o| Some(o) == cur.map(PickOpt::Sel).as_ref()).unwrap_or(0);
                }
                Some(PickOpt::Sel(s)) => {
                    ed.sel = Some(s);
                    ed.mode = EdMode::Act;
                    ed.options = self.editor_options(&ed).0;
                    let cur = self.meta.books[h].current().slots[ed.row].rule.as_ref().map(|r| r.action);
                    ed.pick = ed.options.iter().position(|o| matches!(o, PickOpt::Act(a, _) if Some(*a) == cur)).unwrap_or(0);
                }
                Some(PickOpt::Act(a, _)) => {
                    ed.act = Some(a);
                    if self.meta.opts.extended {
                        ed.mode = EdMode::Ext;
                        ed.options = self.editor_options(&ed).0;
                        ed.pick = 0;
                    } else {
                        self.commit_rule(&ed, None);
                        ed.mode = EdMode::Rows;
                    }
                }
                Some(PickOpt::Ext(e)) => {
                    self.commit_rule(&ed, e);
                    ed.mode = EdMode::Rows;
                }
                None => {}
            }
        }
        Some(Overlay::Editor(ed))
    }

    fn commit_rule(&mut self, ed: &Editor, ext: Option<ExtExpr>) {
        let (Some(sel), Some(act)) = (ed.sel, ed.act) else { return };
        let h = ed.hero;
        self.meta.books[h].current_mut().slots[ed.row] = ReflexSlot { enabled: true, rule: Some(Rule { selector: sel, action: act, ext }) };
        self.sync_book_to_battle(h);
        self.toast(format!("Réflexe {} : {} → {}", ed.row + 1, sel.label(), action(act).name));
    }

    pub fn command_targets(&self, actor: UnitId, act: ActionId) -> Vec<UnitId> {
        let Some(b) = self.battle() else { return vec![] };
        let mut v: Vec<UnitId> = b.units.iter().filter(|u| !u.gone).map(|u| u.id).filter(|&t| ai::useful(b, actor, act, t) && ai::reachable(b, actor, act, t).is_ok()).collect();
        let x = b.unit(actor).pos.x;
        v.sort_by(|a, c| {
            let (ua, uc) = (b.unit(*a), b.unit(*c));
            (ua.team != b.unit(actor).team).cmp(&(uc.team != b.unit(actor).team)).then((ua.pos.x - x).abs().partial_cmp(&(uc.pos.x - x).abs()).unwrap_or(std::cmp::Ordering::Equal))
        });
        if action(act).target == TargetKind::Foe {
            // Ordre : la cible verrouillée d'abord.
            if let Some(t) = b.unit(actor).target {
                if let Some(i) = v.iter().position(|&x| x == t) {
                    let t = v.remove(i);
                    v.insert(0, t);
                }
            }
        }
        v
    }

    fn update_command(&mut self, mut c: Command) -> Option<Overlay> {
        let (pr, nav, cmd) = self.owner_in(c.owner);
        if self.battle().map(|b| !b.unit(c.actor).alive()).unwrap_or(true) {
            return None;
        }
        if pr & btn::Y != 0 || cmd == Some(499) {
            self.sound(snd::BACK);
            return None;
        }
        if c.stage == 1 {
            if pr & btn::B != 0 {
                self.sound(snd::BACK);
                return None;
            }
            if pr & (btn::LB | btn::RB) != 0 || cmd == Some(498) {
                let b = self.battle().unwrap();
                let allies: Vec<UnitId> = b.units.iter().filter(|u| u.team == Team::Ally && !u.guest && u.alive()).map(|u| u.id).collect();
                if let Some(i) = allies.iter().position(|&a| a == c.actor) {
                    c.actor = allies[(i + 1) % allies.len()];
                    c.actions = self.command_actions(c.actor);
                    c.cursor = 0;
                    self.sound(snd::MOVE);
                }
            }
            let n = c.actions.len();
            if nav & btn::DOWN != 0 {
                c.cursor = (c.cursor + 1) % n.max(1);
                self.sound(snd::MOVE);
            }
            if nav & btn::UP != 0 {
                c.cursor = (c.cursor + n.max(1) - 1) % n.max(1);
                self.sound(snd::MOVE);
            }
            let mut choose = pr & btn::A != 0;
            if let Some(id) = cmd {
                if id >= 400 && ((id - 400) as usize) < n {
                    c.cursor = (id - 400) as usize;
                    choose = true;
                }
            }
            if choose && n > 0 {
                let act = c.actions[c.cursor];
                let b = self.battle().unwrap();
                if let Err(e) = ai::can_execute(b, c.actor, act, false) {
                    self.toast(format!("Impossible : {}", e));
                    self.sound(snd::DENY);
                } else {
                    let targets = self.command_targets(c.actor, act);
                    if targets.is_empty() {
                        self.toast("Aucune cible valide pour cette action.");
                        self.sound(snd::DENY);
                    } else {
                        c.action = Some(act);
                        c.targets = targets;
                        c.stage = 2;
                        c.cursor = 0;
                        self.sound(snd::OK);
                    }
                }
            }
            return Some(Overlay::Command(c));
        }
        // Étape 2 : cible.
        if pr & btn::B != 0 {
            c.stage = 1;
            c.cursor = c.actions.iter().position(|&a| Some(a) == c.action).unwrap_or(0);
            self.sound(snd::BACK);
            return Some(Overlay::Command(c));
        }
        let n = c.targets.len().max(1);
        if nav & (btn::DOWN | btn::RIGHT) != 0 {
            c.cursor = (c.cursor + 1) % n;
            self.sound(snd::MOVE);
        }
        if nav & (btn::UP | btn::LEFT) != 0 {
            c.cursor = (c.cursor + n - 1) % n;
            self.sound(snd::MOVE);
        }
        let mut choose = pr & btn::A != 0;
        if let Some(id) = cmd {
            if id >= 450 && ((id - 450) as usize) < c.targets.len() {
                c.cursor = (id - 450) as usize;
                choose = true;
            }
        }
        if choose {
            let act = c.action.unwrap_or(A_ATTACK);
            let Some(&t) = c.targets.get(c.cursor) else { return Some(Overlay::Command(c)) };
            let actor = c.actor;
            let r = sim::issue_manual(self.battle_mut().unwrap(), actor, act, t);
            match r {
                Ok(()) => {
                    self.sound(snd::OK);
                    return None;
                }
                Err(e) => {
                    self.toast(format!("Ordre refusé : {}", e));
                    self.sound(snd::DENY);
                }
            }
        }
        Some(Overlay::Command(c))
    }

    // ------------------------------------------------------------------
    // Événements de combat → effets et sons
    // ------------------------------------------------------------------

    fn on_event(&mut self, b: &Battle, e: Ev) {
        let up = |id: UnitId| {
            let u = b.unit(id);
            Vec2::new(u.pos.x, u.pos.y + 70.0 * u.tpl.tpl().scale)
        };
        match e {
            Ev::Damage { unit, amount, crit, weak, element } => {
                let p = up(unit);
                let ally = b.unit(unit).team == Team::Ally;
                let col = if ally {
                    0xff6a6a
                } else if weak {
                    0xffd040
                } else if crit {
                    0xffa040
                } else {
                    0xffffff
                };
                let ec = element.map(|e| e.color()).unwrap_or(0xfff0d0);
                self.fx.text(p, format!("{}", amount.round() as i64), col, crit || weak);
                if weak {
                    self.fx.text(Vec2::new(p.x, p.y + 40.0), "FAIBLE !".into(), 0xffd040, false);
                }
                if crit {
                    self.fx.text(Vec2::new(p.x, p.y + 40.0), "CRITIQUE".into(), 0xffa040, false);
                }
                self.fx.burst(Vec2::new(p.x, p.y - 20.0), ec, if crit { 22 } else { 10 }, if crit { 560.0 } else { 380.0 }, 5.0);
                self.fx.shake = (self.fx.shake + if crit { 0.35 } else if ally { 0.2 } else { 0.1 }).min(0.8);
                self.sound(if crit { snd::CRIT } else { snd::HIT });
            }
            Ev::Heal { unit, amount } => {
                let p = up(unit);
                if amount > 0.5 {
                    self.fx.text(p, format!("+{}", amount.round() as i64), 0x7dff9a, false);
                } else {
                    self.fx.text(p, "Purifié".into(), 0xb0fff0, false);
                }
                self.fx.leaves(Vec2::new(p.x, p.y - 60.0), 0x7dffb0, 10);
                self.sound(snd::HEAL);
            }
            Ev::Mp { unit, amount } => {
                let p = up(unit);
                self.fx.text(p, format!("+{} ÉT", amount.round() as i64), 0x6ab0ff, false);
                self.fx.ring(Vec2::new(p.x, p.y - 30.0), 0x6ab0ff, 50.0, 0.4);
                self.sound(snd::BUFF);
            }
            Ev::Miss { unit } => {
                let p = up(unit);
                self.fx.text(p, "Raté".into(), 0x9aa0b0, false);
                self.sound(snd::MISS);
            }
            Ev::Status { unit, status, added } => {
                if added {
                    let p = up(unit);
                    let d = status.def();
                    self.fx.text(Vec2::new(p.x, p.y + 20.0), d.name.to_string(), d.color, false);
                    self.fx.ring(Vec2::new(p.x, p.y - 30.0), d.color, 70.0, 0.5);
                    self.sound(if d.polarity == Polarity::Positive { snd::BUFF } else { snd::DEBUFF });
                }
            }
            Ev::Ko { unit } => {
                let p = up(unit);
                let u = b.unit(unit);
                let boss = u.boss;
                let col = u.tpl.tpl().accent;
                self.fx.burst(p, col, if boss { 80 } else { 26 }, if boss { 900.0 } else { 500.0 }, 7.0);
                self.fx.ring(p, col, if boss { 400.0 } else { 120.0 }, 0.6);
                self.fx.shake = (self.fx.shake + if boss { 0.8 } else { 0.25 }).min(1.0);
                if boss {
                    self.fx.flash = 1.0;
                    self.fx.flash_color = 0xffffff;
                }
                self.sound(if boss { snd::BOOM } else { snd::KO });
            }
            Ev::Raised { unit } => {
                let p = up(unit);
                self.fx.pillar(Vec2::new(p.x, 0.0), 0xfff2a0, 70.0);
                self.fx.text(p, "Relevé !".into(), 0xfff2a0, true);
                self.sound(snd::HEAL);
            }
            Ev::CastStart { unit, action: act } => {
                let u = b.unit(unit);
                let a = action(act);
                let col = a.element.map(|e| e.color()).unwrap_or(match a.kind {
                    ActionKind::HealMagic => 0x7dffb0,
                    ActionKind::SupportMagic => 0xffe08a,
                    ActionKind::DebuffMagic => 0xc070ff,
                    ActionKind::Item => 0xd0ffd0,
                    _ => 0xff5a5a,
                });
                self.fx.rune(Vec2::new(u.pos.x, u.pos.y + 2.0), col, 60.0 * u.tpl.tpl().scale, a.cast.max(0.4));
                self.sound(snd::CAST);
            }
            Ev::ActionFired { unit, action: act, .. } => {
                let u = b.unit(unit);
                let a = action(act);
                if matches!(a.delivery, Delivery::Melee) {
                    let reach = ai::effective_range(u, act);
                    let p = Vec2::new(u.pos.x + u.facing * reach * 0.45, u.pos.y + 50.0 * u.tpl.tpl().scale);
                    let col = if u.team == Team::Ally { u.tpl.tpl().accent } else { 0xff7070 };
                    self.fx.slash(p, col, u.facing, reach * 0.75 + 20.0);
                    self.sound(snd::SLASH);
                } else if a.kind == ActionKind::Item {
                    self.sound(snd::BUFF);
                }
            }
            Ev::Impact { pos, action: act, color } => {
                let a = action(act);
                let p = pos;
                self.fx.glow(p, color, 90.0, 0.25);
                match a.element {
                    Some(Element::Fire) => {
                        self.fx.burst(p, 0xff8a2a, 26, 420.0, 7.0);
                        self.fx.ring(p, 0xffb050, 110.0 + a.area * 0.5, 0.4);
                        self.sound(snd::FIRE);
                    }
                    Some(Element::Ice) => {
                        self.fx.shards(p, 0xbff0ff, 14);
                        self.sound(snd::ICE);
                    }
                    Some(Element::Thunder) => {
                        self.fx.bolt(Vec2::new(p.x + 20.0, p.y + 520.0), p, 0xfff86a);
                        self.fx.flash = self.fx.flash.max(0.25);
                        self.fx.flash_color = 0xfff8c0;
                        self.sound(snd::THUNDER);
                    }
                    Some(Element::Holy) => {
                        self.fx.pillar(Vec2::new(p.x, 0.0), 0xfff6d0, 80.0);
                        self.sound(snd::HEAL);
                    }
                    Some(Element::Dark) => {
                        self.fx.ring(p, 0xa35cff, 140.0 + a.area * 0.4, 0.5);
                        self.fx.burst(p, 0x7a3cff, 20, 300.0, 6.0);
                        self.sound(snd::DEBUFF);
                    }
                    Some(e) => {
                        self.fx.burst(p, e.color(), 20, 380.0, 6.0);
                        self.fx.ring(p, e.color(), 100.0, 0.35);
                        self.sound(snd::CAST);
                    }
                    None => {
                        if !matches!(a.delivery, Delivery::Melee) {
                            self.fx.burst(p, color, 12, 300.0, 5.0);
                            self.fx.ring(p, color, 80.0, 0.3);
                        }
                    }
                }
                if a.area > 100.0 && a.kind != ActionKind::HealMagic {
                    self.fx.shake = (self.fx.shake + 0.3).min(1.0);
                }
            }
            Ev::Stolen { unit, item, lumens } => {
                let p = up(unit);
                let s = match item {
                    Some(it) => format!("Chapardé : {}", ITEMS[it as usize].name),
                    None if lumens > 0 => format!("+{} Lumens", lumens),
                    None => "Rien à prendre".into(),
                };
                self.fx.text(p, s, 0xffd25a, false);
                self.sound(snd::STEAL);
            }
            Ev::Reflected { unit } => {
                let p = up(unit);
                self.fx.ring(Vec2::new(p.x, p.y - 30.0), 0xe0f0ff, 90.0, 0.35);
                self.fx.text(p, "Miroir !".into(), 0xe0f0ff, false);
                self.sound(snd::GUARD);
            }
            Ev::Ultimate { unit, action: act } => {
                let u = b.unit(unit);
                let col = u.tpl.tpl().accent;
                let name = action(act).name.to_string();
                self.fx.ult = Some((name, col, 1.7, 1.7));
                self.fx.flash = 1.0;
                self.fx.flash_color = col;
                self.fx.shake = 1.0;
                for k in 0..6 {
                    let x = u.pos.x + (k as f32 - 2.5) * 160.0;
                    self.fx.pillar(Vec2::new(x, 0.0), col, 90.0);
                }
                self.fx.burst(Vec2::new(u.pos.x, 120.0), col, 120, 1200.0, 8.0);
                self.sound(snd::ULT);
            }
            Ev::Cancelled { unit, reason } => {
                let u = b.unit(unit);
                if u.is_human() && reason != "à terre" && reason != "remplacée par un ordre" {
                    let p = up(unit);
                    self.fx.text(p, reason.to_string(), 0x9aa0b0, false);
                    self.sound(snd::DENY);
                }
            }
            Ev::Guarded { unit } => {
                let u = b.unit(unit);
                self.fx.ring(Vec2::new(u.pos.x + u.facing * 30.0, u.pos.y + 50.0), 0x7ad7ff, 60.0, 0.25);
                self.sound(snd::GUARD);
            }
            Ev::Jump { .. } => self.sound(snd::JUMP),
        }
    }

    // ------------------------------------------------------------------
    // Sauvegarde de la méta-progression (texte versionné)
    // ------------------------------------------------------------------

    pub fn save_meta(&self) -> String {
        let m = &self.meta;
        let o = &m.opts;
        let mut s = String::from("lumen_meta|2\n");
        s += &format!("frag|{}\nruns|{}\nwins|{}\nbest|{}\n", m.fragments, m.runs, m.wins, m.best_sector);
        s += &format!("slots|{}|{}|{}\n", m.slots[0], m.slots[1], m.slots[2]);
        s += &format!("start|{}|{}\n", m.start_items, m.start_lvl);
        s += &format!("seen|{}\n", m.seen_prologue as u8);
        s += &format!("opt|{}|{}|{}|{}\n", o.wait_mode as u8, o.extended as u8, o.debug as u8, o.show_log as u8);
        for (i, e) in self.catalog.iter().enumerate() {
            if m.codex[i] {
                s += &format!("codex|{}\n", e.selector.code());
            }
        }
        for h in 0..HEROES_N {
            s += &m.books[h].serialize(HEROES[h].code);
        }
        s
    }

    pub fn load_meta(&mut self, text: &str) {
        let mut lines = text.lines();
        let Some(head) = lines.next() else { return };
        let version: u32 = head.strip_prefix("lumen_meta|").and_then(|v| v.parse().ok()).unwrap_or(0);
        if version == 0 {
            return;
        }
        let mut m = Meta::new(self.catalog.len());
        let mut book_loaded = [false; HEROES_N];
        for line in lines {
            let p: Vec<&str> = line.split('|').collect();
            let num = |i: usize| p.get(i).and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            match p[0] {
                "frag" => m.fragments = num(1),
                "runs" => m.runs = num(1),
                "wins" => m.wins = num(1),
                "best" => m.best_sector = num(1),
                "slots" => {
                    for h in 0..HEROES_N {
                        m.slots[h] = (num(h + 1) as u8).clamp(BASE_SLOTS, MAX_SLOTS as u8);
                    }
                }
                "start" => {
                    m.start_items = num(1).min(3);
                    m.start_lvl = num(2).min(3);
                }
                "seen" => m.seen_prologue = num(1) == 1,
                "opt" => {
                    m.opts.wait_mode = num(1) == 1;
                    m.opts.extended = num(2) == 1;
                    m.opts.debug = num(3) == 1;
                    m.opts.show_log = num(4) == 1;
                }
                "codex" => {
                    if let Some(i) = self.catalog.iter().position(|e| Some(e.selector.code().as_str()) == p.get(1).copied()) {
                        m.codex[i] = true;
                    }
                }
                "book" | "slot" => {
                    if let Some(h) = p.get(1).and_then(|c| HEROES.iter().position(|t| t.code == *c)) {
                        if h < HEROES_N {
                            if p[0] == "book" {
                                book_loaded[h] = true;
                            }
                            m.books[h].apply_line(&p);
                        }
                    }
                }
                _ => {}
            }
        }
        // Migration v1 → v2 : la v1 n'avait pas de seuil « Ennemi : PV = 100 % » ;
        // rien à convertir, les lignes inconnues sont simplement ignorées.
        for h in 0..HEROES_N {
            if !book_loaded[h] {
                m.books[h] = match h {
                    0 => presets::hero_book(T_KAEL),
                    1 => presets::hero_book(T_NYRA),
                    _ => presets::hero_book(T_LYSA),
                };
            }
        }
        self.meta = m;
    }
}
