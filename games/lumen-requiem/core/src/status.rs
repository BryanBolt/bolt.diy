//! StatusEffectSystem — moteur générique d'altérations d'état.
//!
//! Chaque statut est décrit par une définition data-driven (durée, effets
//! périodiques, restrictions, interactions). Les Réflexes lisent ces états
//! via ce module uniquement : aucun booléen dispersé dans le code.

pub const STATUS_COUNT: usize = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum StatusId {
    // --- négatifs ---
    Ko = 0,
    Crystal,          // pétrifié
    CrystalCountdown, // compte à rebours de cristallisation
    Frozen,           // figé (temps arrêté)
    Torpor,           // sommeil
    Vertigo,          // confusion
    Sentence,         // condamnation
    Mist,             // cécité
    Venom,            // poison
    Mute,             // silence
    Erosion,          // dégâts périodiques
    Naphtha,          // huile : vulnérable au feu
    Revers,           // inversion soins/dégâts
    Shackle,          // entrave : ne peut pas agir
    Anchor,           // ancrage : ne peut pas bouger
    Numb,             // engourdi : lenteur
    Fever,            // fièvre : soins réduits
    // --- positifs ---
    Lure,     // appât : attire les ennemis
    Aegis,    // égide : réduit dégâts physiques
    Prism,    // prisme : réduit dégâts arcaniques
    Elan,     // élan : accélère
    Ardor,    // ardeur : + dégâts physiques
    Fervor,   // ferveur : + puissance arcanique
    Mirror,   // miroir : renvoie les arcanes
    Specter,  // spectre : invisible
    Seve,     // sève : régénération
    Weightless, // apesanteur : lévitation
    Rage,     // rage : furie
    Ampleur,  // ampleur : PV max doublés
    Guarded,  // (interne) garde parfaite brève — non ciblable par Réflexes
}

impl StatusId {
    pub const ALL: [StatusId; STATUS_COUNT] = [
        StatusId::Ko,
        StatusId::Crystal,
        StatusId::CrystalCountdown,
        StatusId::Frozen,
        StatusId::Torpor,
        StatusId::Vertigo,
        StatusId::Sentence,
        StatusId::Mist,
        StatusId::Venom,
        StatusId::Mute,
        StatusId::Erosion,
        StatusId::Naphtha,
        StatusId::Revers,
        StatusId::Shackle,
        StatusId::Anchor,
        StatusId::Numb,
        StatusId::Fever,
        StatusId::Lure,
        StatusId::Aegis,
        StatusId::Prism,
        StatusId::Elan,
        StatusId::Ardor,
        StatusId::Fervor,
        StatusId::Mirror,
        StatusId::Specter,
        StatusId::Seve,
        StatusId::Weightless,
        StatusId::Rage,
        StatusId::Ampleur,
        StatusId::Guarded,
    ];

    pub fn from_index(i: usize) -> Option<StatusId> {
        StatusId::ALL.get(i).copied()
    }

    pub fn def(self) -> &'static StatusDef {
        &STATUS_DEFS[self as usize]
    }

    pub fn code(self) -> &'static str {
        self.def().code
    }

    pub fn from_code(s: &str) -> Option<StatusId> {
        StatusId::ALL.iter().copied().find(|st| st.code() == s)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Polarity {
    Negative,
    Positive,
}

pub struct StatusDef {
    pub code: &'static str,
    pub name: &'static str,
    pub desc: &'static str,
    pub polarity: Polarity,
    /// Durée par défaut en secondes (f32::INFINITY = jusqu'à suppression).
    pub duration: f32,
    pub can_act: bool,
    pub can_move: bool,
    pub blocks_magic: bool,
    /// Fraction des PV max perdue (positive) ou gagnée (négative) par seconde.
    pub hp_per_sec: f32,
    pub speed_mult: f32,
    pub removed_on_damage: bool,
    pub color: u32,
    /// Peut être supprimé par Purge / Panacée.
    pub cleansable: bool,
    /// Visible dans le catalogue de conditions des Réflexes.
    pub reflex_visible: bool,
}

const INF: f32 = f32::INFINITY;

macro_rules! sd {
    ($code:expr, $name:expr, $desc:expr, $pol:ident, $dur:expr, act=$act:expr, mov=$mov:expr, magic=$mg:expr, hp=$hp:expr, spd=$spd:expr, wake=$wake:expr, col=$col:expr, clean=$cl:expr) => {
        StatusDef {
            code: $code,
            name: $name,
            desc: $desc,
            polarity: Polarity::$pol,
            duration: $dur,
            can_act: $act,
            can_move: $mov,
            blocks_magic: $mg,
            hp_per_sec: $hp,
            speed_mult: $spd,
            removed_on_damage: $wake,
            color: $col,
            cleansable: $cl,
            reflex_visible: true,
        }
    };
}

pub static STATUS_DEFS: [StatusDef; STATUS_COUNT] = [
    sd!("ko", "À terre", "Hors de combat. Seule une Relève ou une Plume d'Aube peut relever.", Negative, INF, act=false, mov=false, magic=false, hp=0.0, spd=1.0, wake=false, col=0x666666, clean=false),
    sd!("crystal", "Cristallisé", "Changé en cristal : ne peut plus agir jusqu'à la purge.", Negative, INF, act=false, mov=false, magic=false, hp=0.0, spd=0.0, wake=false, col=0xb9c7d6, clean=true),
    sd!("crystal_cd", "Cristallisation", "Compte à rebours : cristallisé à expiration.", Negative, 12.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0x9fb2c6, clean=true),
    sd!("frozen", "Figé", "Le temps de l'unité est arrêté.", Negative, 6.0, act=false, mov=false, magic=false, hp=0.0, spd=0.0, wake=false, col=0x6fd0ff, clean=true),
    sd!("torpor", "Torpeur", "Endormi. Un coup réveille.", Negative, 14.0, act=false, mov=false, magic=false, hp=0.0, spd=0.0, wake=true, col=0x8a7dff, clean=true),
    sd!("vertigo", "Vertige", "Confus : frappe au hasard. Un coup physique dissipe.", Negative, 12.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=true, col=0xff8af0, clean=true),
    sd!("sentence", "Sentence", "À la fin du décompte, l'unité tombe à terre.", Negative, 15.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0x2b2b2b, clean=false),
    sd!("mist", "Brume", "Aveuglé : précision physique fortement réduite.", Negative, 20.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0x7c7c7c, clean=true),
    sd!("venom", "Venin", "Perd des PV en continu.", Negative, 24.0, act=true, mov=true, magic=false, hp=0.022, spd=1.0, wake=false, col=0x8cff4a, clean=true),
    sd!("mute", "Mutisme", "Ne peut plus lancer d'arcanes.", Negative, 20.0, act=true, mov=true, magic=true, hp=0.0, spd=1.0, wake=false, col=0xd0d0ff, clean=true),
    sd!("erosion", "Érosion", "Perte lente de PV.", Negative, 30.0, act=true, mov=true, magic=false, hp=0.01, spd=1.0, wake=false, col=0xb07050, clean=true),
    sd!("naphtha", "Naphte", "Imbibé : vulnérable au feu (dégâts ×2).", Negative, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0x403020, clean=true),
    sd!("revers", "Revers", "Soins et dégâts sont inversés.", Negative, 20.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xff4a8a, clean=true),
    sd!("shackle", "Entrave", "Ne peut pas agir (peut bouger).", Negative, 10.0, act=false, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xa08060, clean=true),
    sd!("anchor", "Ancrage", "Ne peut pas se déplacer.", Negative, 12.0, act=true, mov=false, magic=false, hp=0.0, spd=1.0, wake=false, col=0x705030, clean=true),
    sd!("numb", "Engourdi", "Actions et déplacements ralentis.", Negative, 20.0, act=true, mov=true, magic=false, hp=0.0, spd=0.55, wake=false, col=0x5070a0, clean=true),
    sd!("fever", "Fièvre", "Soins reçus divisés par deux, pas de régénération.", Negative, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xc0a040, clean=true),
    sd!("lure", "Appât", "Attire l'attention des ennemis.", Positive, 25.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xffb040, clean=false),
    sd!("aegis", "Égide", "Dégâts physiques reçus réduits d'un tiers.", Positive, 40.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xffd36a, clean=false),
    sd!("prism", "Prisme", "Dégâts arcaniques reçus réduits d'un tiers.", Positive, 40.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0x7ad7ff, clean=false),
    sd!("elan", "Élan", "Jauge d'action et déplacements accélérés.", Positive, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.5, wake=false, col=0x6effc8, clean=false),
    sd!("ardor", "Ardeur", "Dégâts physiques infligés +30 %.", Positive, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xff7040, clean=false),
    sd!("fervor", "Ferveur", "Puissance arcanique +30 %.", Positive, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xc890ff, clean=false),
    sd!("mirror", "Miroir", "Renvoie les arcanes réfléchissables.", Positive, 30.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xe0f0ff, clean=false),
    sd!("specter", "Spectre", "Invisible : esquive les coups physiques, hors de vue.", Positive, 20.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xb0b0ff, clean=false),
    sd!("seve", "Sève", "Régénère des PV en continu.", Positive, 30.0, act=true, mov=true, magic=false, hp=-0.02, spd=1.0, wake=false, col=0x60ff90, clean=false),
    sd!("weightless", "Apesanteur", "Flotte : immunisé à la Terre.", Positive, 40.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xd0fff0, clean=false),
    sd!("rage", "Rage", "Force accrue mais ne fait plus qu'attaquer.", Positive, 25.0, act=true, mov=true, magic=false, hp=0.0, spd=1.15, wake=false, col=0xff2020, clean=false),
    sd!("ampleur", "Ampleur", "PV max doublés.", Positive, 40.0, act=true, mov=true, magic=false, hp=0.0, spd=1.0, wake=false, col=0xffa0d0, clean=false),
    StatusDef {
        code: "guarded",
        name: "Garde",
        desc: "Interne.",
        polarity: Polarity::Positive,
        duration: 0.2,
        can_act: true,
        can_move: true,
        blocks_magic: false,
        hp_per_sec: 0.0,
        speed_mult: 1.0,
        removed_on_damage: false,
        color: 0xffffff,
        cleansable: false,
        reflex_visible: false,
    },
];

/// Instance d'un statut sur une unité.
#[derive(Clone, Copy, Debug, Default)]
pub struct StatusSlot {
    /// Temps restant en secondes ; 0 = absent.
    pub remaining: f32,
}

#[derive(Clone, Debug)]
pub struct StatusSet {
    pub slots: [StatusSlot; STATUS_COUNT],
    /// Immunités (bitmask par StatusId).
    pub immune: u32,
}

impl Default for StatusSet {
    fn default() -> Self {
        StatusSet { slots: [StatusSlot::default(); STATUS_COUNT], immune: 0 }
    }
}

/// Événements produits par le tick des statuts, appliqués ensuite par le CombatEngine.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum StatusEvent {
    Expired(StatusId),
    /// Perte (+) ou gain (-) de PV en fraction des PV max.
    HpTick(f32),
    SentenceFell,
    Crystallized,
}

impl StatusSet {
    pub fn has(&self, id: StatusId) -> bool {
        self.slots[id as usize].remaining > 0.0
    }

    pub fn remaining(&self, id: StatusId) -> f32 {
        self.slots[id as usize].remaining
    }

    pub fn is_immune(&self, id: StatusId) -> bool {
        self.immune & (1 << id as u32) != 0
    }

    /// Applique un statut. Retourne false si immunisé ou bloqué par une interaction.
    pub fn apply(&mut self, id: StatusId, duration: Option<f32>) -> bool {
        if self.is_immune(id) {
            return false;
        }
        if self.has(StatusId::Ko) && id != StatusId::Ko {
            return false;
        }
        if self.has(StatusId::Crystal) && id != StatusId::Ko {
            return false;
        }
        // Interactions : certains états s'excluent.
        match id {
            StatusId::Elan => self.remove(StatusId::Numb),
            StatusId::Numb => {
                if self.has(StatusId::Elan) {
                    self.remove(StatusId::Elan);
                    return true;
                }
            }
            StatusId::Ko => {
                // Le KO efface tout (aucun statut ne persiste dans cette implémentation).
                for s in self.slots.iter_mut() {
                    s.remaining = 0.0;
                }
            }
            StatusId::Crystal => {
                for (i, s) in self.slots.iter_mut().enumerate() {
                    if i != StatusId::Ko as usize {
                        s.remaining = 0.0;
                    }
                }
            }
            _ => {}
        }
        let d = duration.unwrap_or(id.def().duration);
        self.slots[id as usize].remaining = d.max(0.001);
        true
    }

    pub fn remove(&mut self, id: StatusId) {
        self.slots[id as usize].remaining = 0.0;
    }

    pub fn clear_all(&mut self) {
        for s in self.slots.iter_mut() {
            s.remaining = 0.0;
        }
    }

    /// Supprime tous les statuts négatifs purgeables. Retourne le nombre supprimé.
    pub fn cleanse(&mut self, mask: u32) -> u32 {
        let mut n = 0;
        for st in StatusId::ALL {
            if mask & (1 << st as u32) != 0 && self.has(st) && st.def().cleansable {
                self.remove(st);
                n += 1;
            }
        }
        n
    }

    /// Supprime les statuts positifs (Dissipation).
    pub fn dispel(&mut self) -> u32 {
        let mut n = 0;
        for st in StatusId::ALL {
            if st.def().polarity == Polarity::Positive && st != StatusId::Guarded && self.has(st) {
                self.remove(st);
                n += 1;
            }
        }
        n
    }

    pub fn can_act(&self) -> bool {
        StatusId::ALL.iter().all(|&s| !self.has(s) || s.def().can_act)
    }

    pub fn can_move(&self) -> bool {
        StatusId::ALL.iter().all(|&s| !self.has(s) || s.def().can_move)
    }

    pub fn can_cast(&self) -> bool {
        StatusId::ALL.iter().all(|&s| !self.has(s) || !s.def().blocks_magic)
    }

    pub fn speed_mult(&self) -> f32 {
        let mut m = 1.0;
        for st in StatusId::ALL {
            if self.has(st) {
                m *= st.def().speed_mult;
            }
        }
        m
    }

    /// Supprime les statuts qui se dissipent quand l'unité reçoit un coup.
    pub fn on_damaged(&mut self, physical: bool) {
        self.remove(StatusId::Torpor);
        if physical {
            self.remove(StatusId::Vertigo);
        }
    }

    pub fn negative_count(&self) -> u32 {
        StatusId::ALL
            .iter()
            .filter(|&&s| s != StatusId::Ko && s.def().polarity == Polarity::Negative && self.has(s))
            .count() as u32
    }

    /// Avance les durées. Un unit Figé ne voit pas ses autres compteurs avancer.
    pub fn tick(&mut self, dt: f32, out: &mut Vec<StatusEvent>) {
        let frozen = self.has(StatusId::Frozen);
        let mut hp = 0.0;
        for st in StatusId::ALL {
            let i = st as usize;
            let rem = self.slots[i].remaining;
            if rem <= 0.0 || rem.is_infinite() {
                continue;
            }
            if frozen && st != StatusId::Frozen {
                continue;
            }
            let d = st.def();
            if d.hp_per_sec != 0.0 {
                if !(d.hp_per_sec < 0.0 && self.has(StatusId::Fever)) {
                    hp += d.hp_per_sec * dt;
                }
            }
            let nr = rem - dt;
            if nr <= 0.0 {
                self.slots[i].remaining = 0.0;
                match st {
                    StatusId::Sentence => out.push(StatusEvent::SentenceFell),
                    StatusId::CrystalCountdown => out.push(StatusEvent::Crystallized),
                    _ => out.push(StatusEvent::Expired(st)),
                }
            } else {
                self.slots[i].remaining = nr;
            }
        }
        if hp != 0.0 {
            out.push(StatusEvent::HpTick(hp));
        }
    }
}

/// Masque de tous les statuts négatifs purgeables (Purge / Panacée).
pub fn negative_mask() -> u32 {
    let mut m = 0;
    for st in StatusId::ALL {
        if st.def().polarity == Polarity::Negative && st.def().cleansable {
            m |= 1 << st as u32;
        }
    }
    m
}

pub fn mask(ids: &[StatusId]) -> u32 {
    ids.iter().fold(0, |m, &s| m | (1 << s as u32))
}
