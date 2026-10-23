//! Analyseur de grimoire (mode étendu, 18.5) : conseils, jamais de
//! modification forcée.

use crate::data::{action, ActionKind, Effect, TargetKind, A_ATTACK, A_SUTURE_PLUS};
use crate::reflex::{Group, Posture, Selector};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Info,
    Warn,
    Error,
}

pub struct Advice {
    pub slot: Option<usize>,
    pub severity: Severity,
    pub text: String,
}

fn always_true(sel: Selector) -> bool {
    matches!(sel, Selector::FoeNearestVisible | Selector::FoeAny | Selector::FoeNearest | Selector::FoeFurthest | Selector::SelfAlways)
}

/// `knows` indique si le personnage connaît l'action ; `stock` la quantité d'un objet.
pub fn analyze(p: &Posture, unlocked: usize, knows: &dyn Fn(u16) -> bool, stock: &dyn Fn(u8) -> u32) -> Vec<Advice> {
    let mut out = Vec::new();
    let mut seen: Vec<(String, u16)> = Vec::new();
    let mut masked_from: Option<usize> = None;
    for (i, slot) in p.slots.iter().enumerate() {
        let Some(r) = &slot.rule else { continue };
        let a = action(r.action);
        let push = |out: &mut Vec<Advice>, s: Severity, t: String| out.push(Advice { slot: Some(i), severity: s, text: t });
        if i >= unlocked {
            push(&mut out, Severity::Info, format!("Réflexe {} verrouillé : il ne sera jamais évalué.", i + 1));
            continue;
        }
        if !slot.enabled {
            continue;
        }
        if let Some(m) = masked_from {
            push(&mut out, Severity::Warn, format!("Réflexe {} rarement atteint : le n°{} est presque toujours valide.", i + 1, m + 1));
        }
        if !knows(r.action) {
            push(&mut out, Severity::Error, format!("Réflexe {} : « {} » n'est pas connu de ce personnage.", i + 1, a.name));
        }
        if let Some(it) = a.item {
            if stock(it) == 0 {
                push(&mut out, Severity::Warn, format!("Réflexe {} : plus aucun objet « {} » en stock.", i + 1, a.name));
            }
        }
        let g = r.selector.group();
        let heal_like = matches!(a.effect, Effect::Heal | Effect::Raise);
        let incompatible = match (g, a.target) {
            (Group::Foe, TargetKind::Ally) => !(heal_like && r.selector == Selector::FoeUndead),
            (Group::Ally, TargetKind::Foe) => true,
            (Group::Myself, TargetKind::Foe) => true,
            (Group::Foe, TargetKind::SelfOnly) | (Group::Ally, TargetKind::SelfOnly) => true,
            _ => false,
        };
        if incompatible {
            push(&mut out, Severity::Error, format!("Réflexe {} : la cible « {} » ne convient pas à « {} ».", i + 1, g.name(), a.name));
        }
        let key = (r.selector.code(), r.action);
        if seen.contains(&key) {
            push(&mut out, Severity::Warn, format!("Réflexe {} : doublon d'une règle précédente.", i + 1));
        } else {
            seen.push(key);
        }
        if r.action == A_SUTURE_PLUS {
            if let Selector::AllyHpBelow(p) | Selector::SelfHpBelow(p) = r.selector {
                if p >= 80 {
                    push(&mut out, Severity::Warn, format!("Réflexe {} : Suture+ dès {} % gaspille l'Éther.", i + 1, p));
                }
            }
        }
        if a.kind == ActionKind::Item && matches!(r.selector, Selector::AllyAny) && matches!(a.effect, Effect::Heal) {
            push(&mut out, Severity::Warn, format!("Réflexe {} : soigner « n'importe qui » avec des objets les consomme vite.", i + 1));
        }
        if masked_from.is_none() && always_true(r.selector) && (r.action == A_ATTACK || a.mp == 0.0) && a.item.is_none() {
            masked_from = Some(i);
        }
    }
    if p.slots.iter().take(unlocked).all(|s| s.rule.is_none() || !s.enabled) {
        out.push(Advice { slot: None, severity: Severity::Info, text: "Aucun Réflexe actif : ce personnage attendra vos ordres.".into() });
    }
    out
}
