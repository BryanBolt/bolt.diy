//! Grimoires de démonstration (section 16 du cahier des charges) et grimoires
//! des ennemis. Les ennemis utilisent EXACTEMENT le même moteur de Réflexes.

use crate::data::*;
use crate::reflex::{Posture, ReflexBook, Selector::*};
use crate::status::StatusId;
use crate::types::{Element, Stat};

/// 16.1 — Soigneur.
pub fn healer() -> Posture {
    Posture::from_rules(&[
        (AllyStatus(StatusId::Ko), A_RELEVE),
        (AllyStatus(StatusId::Ko), A_I_PLUME),
        (AllyHpBelow(30), A_SUTURE_PLUS),
        (AllyHpBelow(60), A_SUTURE),
        (AllyStatus(StatusId::Vertigo), A_EVEIL),
        (AllyStatus(StatusId::Frozen), A_EVEIL),
        (AllyStatus(StatusId::Mute), A_PURGE),
        (AllyStatus(StatusId::Venom), A_I_ANTIVENIN),
        // « Allié sans Égide » n'existe pas dans le catalogue : on utilise
        // « Allié : n'importe lequel » et le validateur ignore ceux qui l'ont déjà.
        (AllyAny, A_EGIDE),
        (SelfMpBelow(10), A_SIPHON),
        (FoeLeaderTarget, A_ATTACK),
        (FoeNearestVisible, A_ATTACK),
    ])
}

/// 16.2 — Guerrier offensif.
pub fn warrior() -> Posture {
    Posture::from_rules(&[
        (AllyStatus(StatusId::Ko), A_I_PLUME),
        (SelfHpBelow(30), A_I_TONIQUE),
        (FoeTargetingLeader, A_ATTACK),
        (FoeHpCritical, A_ATTACK),
        (FoeLeaderTarget, A_ATTACK),
        (FoeNearestVisible, A_ATTACK),
    ])
}

/// 16.3 — Mage offensif (les sorts non appris sont ignorés par le validateur).
pub fn mage() -> Posture {
    Posture::from_rules(&[
        (AllyStatus(StatusId::Ko), A_RELEVE),
        (SelfHpBelow(30), A_SUTURE),
        (FoeWeak(Element::Fire), A_BRAISE),
        (FoeWeak(Element::Ice), A_GIVRE),
        (FoeWeak(Element::Thunder), A_ARC),
        (FoeWeak(Element::Water), A_ONDE),
        (FoeWeak(Element::Wind), A_RAFALE),
        (FoeWeak(Element::Earth), A_SEISME),
        (FoeUndead, A_AUBE),
        (FoeLeaderTarget, A_IMPACT),
        (SelfMpBelow(10), A_SIPHON),
        (FoeNearestVisible, A_ATTACK),
    ])
}

/// 16.4 — Chapardeur.
pub fn thief() -> Posture {
    Posture::from_rules(&[
        (AllyStatus(StatusId::Ko), A_I_PLUME),
        (SelfHpBelow(30), A_I_TONIQUE),
        (FoeHpFull, A_CHAPARDER),
        (FoeLeaderTarget, A_ATTACK),
        (FoeNearestVisible, A_ATTACK),
    ])
}

pub fn hero_book(hero: usize) -> ReflexBook {
    let mut b = ReflexBook::default();
    match hero {
        T_KAEL => {
            // Guerrier (16.2) + une ligne pour les volants, que l'épée n'atteint pas.
            b.postures[0] = Posture::from_rules(&[
                (AllyStatus(StatusId::Ko), A_I_PLUME),
                (SelfHpBelow(30), A_I_TONIQUE),
                (FoeTargetingLeader, A_ATTACK),
                (FoeHpCritical, A_ATTACK),
                (FoeFlying, A_ARC),
                (FoeLeaderTarget, A_ATTACK),
                (FoeNearestVisible, A_ATTACK),
            ]);
            // Posture II — Boss : priorité à la survie, concentration sur le boss.
            b.postures[1] = Posture::from_rules(&[
                (AllyStatus(StatusId::Ko), A_I_PLUME),
                (SelfHpBelow(50), A_I_TONIQUE_PLUS),
                (AllyHpCritical, A_I_TONIQUE),
                (FoeStatMost(Stat::MaxHp), A_PLUIE),
                (FoeStatMost(Stat::MaxHp), A_ATTACK),
                (FoeNearestVisible, A_ATTACK),
            ]);
            // Posture III — Offensive : artes à volonté.
            b.postures[2] = Posture::from_rules(&[
                (SelfHpBelow(25), A_I_TONIQUE),
                (FoeWeak(Element::Fire), A_BRAISE),
                (FoeWeak(Element::Thunder), A_ARC),
                (FoeFlying, A_ARC),
                (FoeLeaderTarget, A_PLUIE),
                (FoeNearestVisible, A_CROC),
                (FoeNearestVisible, A_ATTACK),
            ]);
        }
        T_NYRA => {
            b.postures[0] = thief();
            b.postures[0].slots[3] = crate::reflex::ReflexSlot { enabled: true, rule: Some(crate::reflex::Rule { selector: FoeFlying, action: A_FRONDE, ext: None }) };
            b.postures[0].slots[4] = crate::reflex::ReflexSlot { enabled: true, rule: Some(crate::reflex::Rule { selector: FoeLeaderTarget, action: A_ATTACK, ext: None }) };
            b.postures[0].slots[5] = crate::reflex::ReflexSlot { enabled: true, rule: Some(crate::reflex::Rule { selector: FoeNearestVisible, action: A_ATTACK, ext: None }) };
            b.postures[1] = Posture::from_rules(&[
                (AllyStatus(StatusId::Ko), A_I_PLUME),
                (AllyHpBelow(40), A_I_TONIQUE),
                (AllyStatus(StatusId::Venom), A_I_ANTIVENIN),
                (FoeFlying, A_FRONDE),
                (FoeTargetingLeader, A_COMETE),
                (FoeLeaderTarget, A_ATTACK),
                (FoeNearestVisible, A_ATTACK),
            ]);
            b.postures[2] = Posture::from_rules(&[
                (SelfHpBelow(25), A_I_TONIQUE),
                (FoeFlying, A_UPPERCUT),
                (FoeCountAtLeast(3), A_TORNADE),
                (FoeHpCritical, A_COMETE),
                (FoeNearestVisible, A_ATTACK),
            ]);
        }
        T_LYSA => {
            // Soigneur (16.1) réordonné pour tenir dans les emplacements de départ.
            b.postures[0] = Posture::from_rules(&[
                (AllyStatus(StatusId::Ko), A_RELEVE),
                (AllyStatus(StatusId::Ko), A_I_PLUME),
                (AllyHpBelow(30), A_SUTURE_PLUS),
                (AllyHpBelow(60), A_SUTURE),
                (SelfMpBelow(10), A_SIPHON),
                (FoeFlying, A_GIVRE),
                (FoeLeaderTarget, A_ATTACK),
                (AllyStatus(StatusId::Venom), A_I_ANTIVENIN),
                (AllyAny, A_EGIDE),
                (AllyStatus(StatusId::Mute), A_PURGE),
                (AllyStatus(StatusId::Vertigo), A_EVEIL),
                (FoeNearestVisible, A_ATTACK),
            ]);
            b.postures[1] = Posture::from_rules(&[
                (AllyStatus(StatusId::Ko), A_RELEVE),
                (AllyHpBelow(50), A_SUTURE_PLUS),
                (AllyHpBelow(80), A_SUTURE),
                (AllyStatus(StatusId::Torpor), A_EVEIL),
                (AllyStatus(StatusId::CrystalCountdown), A_PURGE),
                (AllyStatus(StatusId::Revers), A_PURGE),
                (AllyAny, A_PRISME),
                (AllyAny, A_EGIDE),
                (FoeStatus(StatusId::Mirror), A_DISSIPER),
                (SelfMpBelow(20), A_SIPHON),
                (FoeLeaderTarget, A_ENGOURDIR),
                (FoeLeaderTarget, A_IMPACT),
            ]);
            b.postures[2] = mage();
        }
        _ => {
            // Kit-9 (invité non contrôlable).
            b.postures[0] = Posture::from_rules(&[
                (AllyHpBelow(40), A_SUTURE),
                (AllyLeader, A_ARDEUR),
                (SelfAlways, A_APPAT),
                (FoeLeaderTarget, A_KIT_ZAP),
                (FoeNearestVisible, A_KIT_ZAP),
            ]);
        }
    }
    b
}

pub fn foe_book(foe: usize) -> ReflexBook {
    let rules: &[(crate::reflex::Selector, ActionId)] = match foe {
        F_SOLDIER => &[(FoeFurthest, A_E_LASER), (FoeNearestVisible, A_ATTACK)],
        F_DRONE => &[(FoeNearestVisible, A_E_LASER), (FoeNearestVisible, A_ATTACK)],
        F_HOUND => &[(FoeNearest, A_E_VENOM_BITE), (FoeNearest, A_E_BITE)],
        F_BOMB => &[(FoeNearest, A_E_SELF_DESTRUCT), (FoeNearestVisible, A_BRAISE), (FoeNearest, A_ATTACK)],
        F_SPIDER => &[(FoeNearest, A_E_SLAM), (FoeLeaderTarget, A_E_OIL), (FoeFurthest, A_E_LASER), (FoeNearest, A_ATTACK)],
        F_WRAITH => &[(FoeNearestVisible, A_MUTISME), (FoeNearestVisible, A_NEANT), (FoeNearest, A_ATTACK)],
        F_JELLY => &[(FoeNearestVisible, A_E_REVERS), (FoeNearestVisible, A_ONDE), (FoeNearest, A_ATTACK)],
        F_SPECIMEN_SMALL => &[(FoeNearest, A_E_SLEEP_SPORE), (FoeNearest, A_E_VENOM_BITE), (FoeNearest, A_ATTACK)],
        F_SPECIMEN => &[
            (SelfHpBelow(40), A_SUTURE_PLUS),
            (SelfAlways, A_MIROIR),
            (FoeNearest, A_E_SLEEP_SPORE),
            (FoeLeaderTarget, A_E_REVERS),
            (FoeAny, A_E_DARK_WAVE),
            (FoeNearest, A_ATTACK),
        ],
        F_KNIGHT => &[(FoeLeaderTarget, A_E_SENTENCE), (FoeNearest, A_E_SLAM), (FoeNearest, A_ATTACK)],
        F_WYVERN => &[(FoeNearest, A_E_FROST_BREATH), (FoeNearest, A_ATTACK)],
        F_GOLEM => &[(FoeNearest, A_E_CRYSTAL_GAZE), (FoeNearest, A_E_SLAM), (FoeNearest, A_ATTACK)],
        _ => &[
            (FoeAny, A_E_SUPERNOVA),
            (FoeLeaderTarget, A_E_SENTENCE),
            (FoeCountAtLeast(2), A_BRASIER),
            (FoeNearest, A_E_DARK_WAVE),
            (FoeFlying, A_ARC),
            (FoeFurthest, A_GIVRE),
            (FoeNearest, A_ATTACK),
        ],
    };
    ReflexBook::with_rules(rules)
}

/// Délais initiaux de certaines capacités ennemies (ex. la bombe n'explose
/// qu'après un moment : il faut la neutraliser vite).
pub fn foe_initial_cooldowns(foe: usize) -> Vec<(ActionId, f32)> {
    match foe {
        F_BOMB => vec![(A_E_SELF_DESTRUCT, 11.0)],
        F_SERAPH => vec![(A_E_SUPERNOVA, 24.0), (A_E_SENTENCE, 10.0)],
        F_SPIDER => vec![(A_E_OIL, 6.0)],
        F_SPECIMEN => vec![(A_E_REVERS, 8.0)],
        _ => vec![],
    }
}
