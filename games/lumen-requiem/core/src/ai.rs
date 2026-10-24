//! ReflexEngine — interpréteur de règles priorisées.
//!
//! Sous-systèmes :
//! - `resolve_targets` (TargetResolver) : unités correspondant au sélecteur,
//!   ordonnées selon la politique explicite du sélecteur ;
//! - `useful` / `reachable` (ActionValidator, niveau cible) ;
//! - `can_execute` (ActionValidator, niveau acteur) ;
//! - `eval_ext` (ConditionEvaluator du mode étendu).
//!
//! Règle d'or : on parcourt les Réflexes de 1 à 12 et on retient la PREMIÈRE
//! ligne qui possède une cible valide ET une action réalisable. Chaque cycle
//! de décision recommence à la ligne 1. Aucune décision cachée : si aucune
//! ligne n'est exécutable, l'unité attend.

use crate::battle::{Battle, Unit};
use crate::data::{action, cleanse_mask_for, ActionId, Delivery, Effect, TargetKind, A_ATTACK};
use crate::reflex::{ExtExpr, ExtPred, Selector, SlotOutcome, SlotTrace, CRITICAL_HP};
use crate::status::{Polarity, StatusId};
use crate::types::{Affinity, Team, UnitId};

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plan {
    pub action: ActionId,
    pub target: UnitId,
    pub slot: u8,
}

/// Une unité peut-elle sélectionner une nouvelle action ?
pub fn can_select(u: &Unit) -> bool {
    u.alive() && u.statuses.can_act() && u.job.is_none()
}

fn dist(a: &Unit, b: &Unit) -> f32 {
    a.pos.dist(b.pos)
}

/// Le meneur du camp de l'acteur : le meneur de l'équipe pour les alliés,
/// le premier ennemi vivant (boss en priorité) pour les adversaires.
pub fn leader_of(b: &Battle, team: Team) -> Option<UnitId> {
    match team {
        Team::Ally => b.leader,
        Team::Foe => b
            .foes()
            .filter(|u| u.alive())
            .max_by(|x, y| (x.boss as u8).cmp(&(y.boss as u8)).then(y.id.cmp(&x.id)))
            .map(|u| u.id),
    }
}

/// Adversaires ciblables par l'acteur : vivants, non invisibles, dans le rayon d'engagement.
/// Ordre : distance croissante puis identifiant (politique déterministe documentée).
pub fn opponents(b: &Battle, actor: &Unit) -> Vec<UnitId> {
    let mut v: Vec<(f32, UnitId)> = b
        .units
        .iter()
        .filter(|u| u.team != actor.team && u.alive() && !u.statuses.has(StatusId::Specter) && !u.statuses.has(StatusId::Crystal))
        .filter(|u| dist(actor, u) <= b.settings.engage_radius)
        .map(|u| (dist(actor, u), u.id))
        .collect();
    v.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
    v.into_iter().map(|x| x.1).collect()
}

/// Alliés de l'acteur (lui compris, à terre compris), dans l'ordre de l'équipe.
pub fn allies(b: &Battle, actor: &Unit) -> Vec<UnitId> {
    b.units.iter().filter(|u| u.team == actor.team && !u.gone).map(|u| u.id).collect()
}

fn pick_extreme(b: &Battle, ids: &[UnitId], key: impl Fn(&Unit) -> f32, most: bool) -> Vec<UnitId> {
    // `ids` est déjà trié par distance : en cas d'égalité, le plus proche gagne.
    let mut best: Option<(f32, UnitId)> = None;
    for &id in ids {
        let k = key(b.unit(id));
        let better = match best {
            None => true,
            Some((bk, _)) => {
                if most {
                    k > bk
                } else {
                    k < bk
                }
            }
        };
        if better {
            best = Some((k, id));
        }
    }
    best.map(|b| vec![b.1]).unwrap_or_default()
}

/// TargetResolver : renvoie les unités satisfaisant le sélecteur, ordonnées.
pub fn resolve_targets(b: &Battle, actor_id: UnitId, sel: Selector) -> Vec<UnitId> {
    use Selector::*;
    let actor = b.unit(actor_id);
    let leader = leader_of(b, actor.team);
    let living = |id: &UnitId| b.unit(*id).alive();
    let mut out: Vec<UnitId> = match sel {
        // ---------------- Allié ----------------
        AllyAny => allies(b, actor),
        AllyLeader => leader.filter(|l| b.unit(*l).team == actor.team).into_iter().collect(),
        AllyChar(i) => allies(b, actor).into_iter().filter(|id| b.unit(*id).tpl == crate::battle::TplRef::Hero(i as usize)).collect(),
        AllyGuest => allies(b, actor).into_iter().filter(|id| b.unit(*id).guest).collect(),
        AllyLowestHp => {
            let v: Vec<UnitId> = allies(b, actor).into_iter().filter(living).collect();
            pick_extreme(b, &v, |u| u.hp, false)
        }
        AllyStrongestWeapon => {
            let v: Vec<UnitId> = allies(b, actor).into_iter().filter(living).collect();
            pick_extreme(b, &v, |u| u.weapon.power * u.stats.str_, true)
        }
        AllyLowestDef => {
            let v: Vec<UnitId> = allies(b, actor).into_iter().filter(living).collect();
            pick_extreme(b, &v, |u| u.stats.def, false)
        }
        AllyLowestMdef => {
            let v: Vec<UnitId> = allies(b, actor).into_iter().filter(living).collect();
            pick_extreme(b, &v, |u| u.stats.mdef, false)
        }
        AllyHpBelow(p) => sorted_by_ratio(b, allies(b, actor).into_iter().filter(living).filter(|id| b.unit(*id).hp_ratio() * 100.0 < p as f32 - 1e-4).collect()),
        AllyHpCritical => sorted_by_ratio(b, allies(b, actor).into_iter().filter(living).filter(|id| b.unit(*id).hp_ratio() < CRITICAL_HP).collect()),
        AllyMpBelow(p) => allies(b, actor).into_iter().filter(living).filter(|id| b.unit(*id).stats.max_mp > 0.0 && b.unit(*id).mp_ratio() * 100.0 < p as f32 - 1e-4).collect(),
        AllyStatus(s) => allies(b, actor).into_iter().filter(|id| b.unit(*id).statuses.has(s)).collect(),
        // ---------------- Ennemi ----------------
        FoeLeaderTarget => {
            let opp = opponents(b, actor);
            leader.and_then(|l| b.unit(l).target).filter(|t| opp.contains(t)).into_iter().collect()
        }
        FoeNearestVisible => opponents(b, actor).into_iter().filter(|id| dist(actor, b.unit(*id)) <= b.settings.view_radius).take(1).collect(),
        FoeAny => opponents(b, actor),
        FoeTargetedByAlly => {
            let opp = opponents(b, actor);
            opp.into_iter().filter(|t| b.units.iter().any(|a| a.team == actor.team && a.id != actor.id && a.alive() && a.target == Some(*t))).collect()
        }
        FoeNotTargeted => {
            let opp = opponents(b, actor);
            opp.into_iter().filter(|t| !b.units.iter().any(|a| a.team == actor.team && a.id != actor.id && a.alive() && a.target == Some(*t))).collect()
        }
        FoeTargetingLeader => opponents(b, actor).into_iter().filter(|t| leader.is_some() && b.unit(*t).target == leader).collect(),
        FoeTargetingSelf => opponents(b, actor).into_iter().filter(|t| b.unit(*t).target == Some(actor.id)).collect(),
        FoeTargetingAlly => opponents(b, actor)
            .into_iter()
            .filter(|t| b.unit(*t).target.map(|x| b.unit(x).team == actor.team && b.unit(x).alive()).unwrap_or(false))
            .collect(),
        FoeTargetingChar(i) => opponents(b, actor)
            .into_iter()
            .filter(|t| b.unit(*t).target.map(|x| b.unit(x).tpl == crate::battle::TplRef::Hero(i as usize)).unwrap_or(false))
            .collect(),
        FoeNearest => opponents(b, actor).into_iter().take(1).collect(),
        FoeFurthest => opponents(b, actor).into_iter().last().into_iter().collect(),
        FoeStatMost(s) => pick_extreme(b, &opponents(b, actor), |u| u.stat_value(s), true),
        FoeStatLeast(s) => pick_extreme(b, &opponents(b, actor), |u| u.stat_value(s), false),
        FoeHpBelowAbs(v) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp < v as f32).collect(),
        FoeHpAtLeastAbs(v) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp >= v as f32).collect(),
        FoeHpFull => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp >= b.unit(*t).max_hp() - 0.5).collect(),
        FoeHpBelowPct(p) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp_ratio() * 100.0 < p as f32).collect(),
        FoeHpAtLeastPct(p) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp_ratio() * 100.0 >= p as f32).collect(),
        FoeHpCritical => opponents(b, actor).into_iter().filter(|t| b.unit(*t).hp_ratio() < CRITICAL_HP).collect(),
        FoeStatus(s) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).statuses.has(s)).collect(),
        FoeWeak(e) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).affinities[e as usize] == Affinity::Weak).collect(),
        FoeVulnerable(e) => opponents(b, actor).into_iter().filter(|t| b.unit(*t).element_mult(e) > 1.0).collect(),
        FoeFlying => opponents(b, actor).into_iter().filter(|t| b.unit(*t).flying).collect(),
        FoeUndead => opponents(b, actor).into_iter().filter(|t| b.unit(*t).undead).collect(),
        FoeCountAtLeast(n) => {
            let o = opponents(b, actor);
            if o.len() >= n as usize {
                o
            } else {
                vec![]
            }
        }
        // ---------------- Soi ----------------
        SelfAlways => vec![actor.id],
        SelfHpBelow(p) => cond_self(actor, actor.hp_ratio() * 100.0 < p as f32 - 1e-4),
        SelfMpBelow(p) => cond_self(actor, actor.stats.max_mp > 0.0 && actor.mp_ratio() * 100.0 < p as f32 - 1e-4),
        SelfHpCritical => cond_self(actor, actor.hp_ratio() < CRITICAL_HP),
        SelfStatus(s) => cond_self(actor, actor.statuses.has(s)),
        SelfFoesAtLeast(n) => cond_self(actor, opponents(b, actor).len() >= n as usize),
        SelfTargeted => cond_self(actor, opponents(b, actor).iter().any(|t| b.unit(*t).target == Some(actor.id))),
        SelfItemAtLeast(it, n) => cond_self(actor, b.inventory.available(it) >= n as u32),
    };
    // Appât : les ennemis (camp adverse au joueur) sont attirés en priorité.
    if actor.team == Team::Foe && sel.group() == crate::reflex::Group::Foe {
        out.sort_by_key(|id| !b.unit(*id).statuses.has(StatusId::Lure));
    }
    out
}

fn cond_self(actor: &Unit, c: bool) -> Vec<UnitId> {
    if c {
        vec![actor.id]
    } else {
        vec![]
    }
}

fn sorted_by_ratio(b: &Battle, mut v: Vec<UnitId>) -> Vec<UnitId> {
    v.sort_by(|x, y| b.unit(*x).hp_ratio().partial_cmp(&b.unit(*y).hp_ratio()).unwrap_or(std::cmp::Ordering::Equal).then(x.cmp(y)));
    v
}

/// ActionValidator (niveau cible) : l'action peut-elle affecter cette cible
/// et a-t-elle un intérêt ? (pas de soin sur PV pleins, pas de Relève sur un
/// vivant, pas de statut déjà présent, pas de purge sans altération...).
pub fn useful(b: &Battle, actor_id: UnitId, act: ActionId, target: UnitId) -> bool {
    let a = action(act);
    let actor = b.unit(actor_id);
    let Some(t) = b.get(target) else { return false };
    let same = t.team == actor.team;
    let heal_like = matches!(a.effect, Effect::Heal | Effect::Raise);
    let group_ok = match a.target {
        TargetKind::SelfOnly => target == actor_id,
        TargetKind::Foe => !same,
        // Les soins blessent les morts-vivants : ils peuvent viser un ennemi mort-vivant.
        TargetKind::Ally => same || (heal_like && t.undead),
    };
    if !group_ok {
        return false;
    }
    if t.statuses.has(StatusId::Crystal) && !matches!(a.effect, Effect::Cleanse { .. }) {
        return false;
    }
    match a.effect {
        Effect::Raise => {
            if same {
                t.ko()
            } else {
                t.alive() && !t.boss
            }
        }
        Effect::Heal => {
            if same {
                t.alive() && t.hp < t.max_hp() - 0.5
            } else {
                t.alive()
            }
        }
        Effect::HealMp | Effect::RestoreMp { .. } => t.alive() && t.stats.max_mp > 0.0 && t.mp < t.stats.max_mp - 0.5,
        Effect::AddStatus { status, .. } => t.alive() && !t.statuses.has(status) && !t.statuses.is_immune(status),
        Effect::Cleanse { .. } => {
            let m = cleanse_mask_for(act);
            !t.ko() && crate::status::StatusId::ALL.iter().any(|s| m & (1 << *s as u32) != 0 && t.statuses.has(*s))
        }
        Effect::Dispel => t.alive() && crate::status::StatusId::ALL.iter().any(|s| s.def().polarity == Polarity::Positive && *s != StatusId::Guarded && t.statuses.has(*s)),
        Effect::Damage { .. } | Effect::DamageStatus { .. } | Effect::Steal => t.alive(),
    }
}

pub fn effective_range(u: &Unit, act: ActionId) -> f32 {
    let a = action(act);
    if a.range > 0.0 {
        a.range
    } else {
        u.weapon.range
    }
}

pub fn hits_air(u: &Unit, act: ActionId) -> bool {
    action(act).hits_air.unwrap_or(u.weapon.hits_air)
}

/// La cible est-elle actuellement à portée d'exécution ?
pub fn in_range(b: &Battle, actor_id: UnitId, act: ActionId, target: UnitId, slack: f32) -> bool {
    if actor_id == target {
        return true;
    }
    let u = b.unit(actor_id);
    let t = b.unit(target);
    let r = effective_range(u, act) + slack;
    match action(act).delivery {
        Delivery::Melee => {
            let dx = (t.pos.x - u.pos.x).abs();
            let dy = (t.pos.y - u.pos.y).abs();
            dx <= r && (dy <= 90.0 || hits_air(u, act))
        }
        _ => u.pos.dist(t.pos) <= r,
    }
}

/// Distingue l'IMPOSSIBLE (mêlée contre volant) du TEMPORAIREMENT hors de portée
/// (un déplacement suffit : la cible reste valide).
pub fn reachable(b: &Battle, actor_id: UnitId, act: ActionId, target: UnitId) -> Result<(), &'static str> {
    let u = b.unit(actor_id);
    let t = b.unit(target);
    if actor_id == target {
        return Ok(());
    }
    if matches!(action(act).delivery, Delivery::Melee) && t.flying && !hits_air(u, act) {
        return Err("cible volante hors d'atteinte");
    }
    if !u.statuses.can_move() && !in_range(b, actor_id, act, target, 0.0) {
        return Err("ancré et hors de portée");
    }
    Ok(())
}

/// ActionValidator (niveau acteur).
pub fn can_execute(b: &Battle, actor_id: UnitId, act: ActionId, from_reflex: bool) -> Result<(), &'static str> {
    can_execute_ex(b, actor_id, act, from_reflex, false)
}

/// Variante tenant compte d'une unité d'objet déjà réservée par l'acteur lui-même.
pub fn can_execute_ex(b: &Battle, actor_id: UnitId, act: ActionId, from_reflex: bool, holds_reservation: bool) -> Result<(), &'static str> {
    let u = b.unit(actor_id);
    let a = action(act);
    if from_reflex && !a.reflex_ok {
        return Err("réservée au contrôle manuel");
    }
    if !u.knows(act) {
        return Err("non apprise");
    }
    if !u.statuses.can_act() {
        return Err("incapable d'agir");
    }
    if a.magic && !u.statuses.can_cast() {
        return Err("Mutisme : arcanes impossibles");
    }
    if u.statuses.has(StatusId::Rage) && act != A_ATTACK {
        return Err("Rage : attaque seulement");
    }
    if u.mp + 1e-3 < a.mp {
        return Err("Éther insuffisant");
    }
    if let Some(it) = a.item {
        if b.inventory.available(it) == 0 && !(holds_reservation && b.inventory.count[it as usize] > 0) {
            return Err("objet épuisé");
        }
    }
    if u.cooldown(act) > 0.0 || (u.team == Team::Foe && act != A_ATTACK && u.special_cd > 0.0) {
        return Err("en recharge");
    }
    Ok(())
}

/// ConditionEvaluator du mode étendu.
pub fn eval_ext(b: &Battle, actor_id: UnitId, act: ActionId, target: UnitId, e: &ExtExpr) -> bool {
    match e {
        ExtExpr::And(v) => v.iter().all(|x| eval_ext(b, actor_id, act, target, x)),
        ExtExpr::Or(v) => v.iter().any(|x| eval_ext(b, actor_id, act, target, x)),
        ExtExpr::Not(x) => !eval_ext(b, actor_id, act, target, x),
        ExtExpr::Pred(p) => {
            let u = b.unit(actor_id);
            let t = b.unit(target);
            match p {
                ExtPred::SelfMpAbove(v) => u.mp_ratio() * 100.0 > *v as f32,
                ExtPred::SelfMpBelow(v) => u.mp_ratio() * 100.0 < *v as f32,
                ExtPred::SelfHpAbove(v) => u.hp_ratio() * 100.0 > *v as f32,
                ExtPred::TargetHpBelow(v) => t.hp_ratio() * 100.0 < *v as f32,
                ExtPred::TargetHpAbove(v) => t.hp_ratio() * 100.0 > *v as f32,
                ExtPred::TargetFlying => t.flying,
                ExtPred::TargetWeak(el) => t.affinities[*el as usize] == Affinity::Weak,
                ExtPred::DistanceBelow(d) => u.pos.dist(t.pos) < *d as f32,
                ExtPred::ItemAtLeast(it, n) => b.inventory.available(*it) >= *n as u32,
                ExtPred::KeepMpReserve(v) => u.stats.max_mp <= 0.0 || (u.mp - action(act).mp) / u.stats.max_mp * 100.0 >= *v as f32,
            }
        }
    }
}

/// Cycle de décision complet. Renvoie la première règle exécutable, en
/// remplissant éventuellement une trace explicative (sans effet sur le choix).
pub fn decide(b: &Battle, actor_id: UnitId, mut trace: Option<&mut Vec<SlotTrace>>) -> Option<Plan> {
    if let Some(t) = trace.as_deref_mut() {
        t.clear();
    }
    let actor = b.unit(actor_id);
    if !can_select(actor) || !actor.book.enabled {
        return None;
    }
    let posture = actor.book.current();
    let unlocked = actor.book.unlocked as usize;
    let mut chosen: Option<Plan> = None;
    for (i, slot) in posture.slots.iter().enumerate() {
        let push = |trace: &mut Option<&mut Vec<SlotTrace>>, o: SlotOutcome| {
            if let Some(t) = trace.as_deref_mut() {
                t.push(SlotTrace { slot: i as u8, outcome: o });
            }
        };
        if chosen.is_some() {
            if slot.rule.is_some() && i < unlocked {
                push(&mut trace, SlotOutcome::Skipped);
            }
            continue;
        }
        if i >= unlocked {
            push(&mut trace, SlotOutcome::Locked);
            continue;
        }
        let Some(rule) = &slot.rule else {
            push(&mut trace, SlotOutcome::Empty);
            continue;
        };
        if !slot.enabled {
            push(&mut trace, SlotOutcome::Disabled);
            continue;
        }
        let candidates = resolve_targets(b, actor_id, rule.selector);
        if candidates.is_empty() {
            push(&mut trace, SlotOutcome::NoTarget);
            continue;
        }
        if let Err(r) = can_execute(b, actor_id, rule.action, true) {
            push(&mut trace, SlotOutcome::NotExecutable(r));
            continue;
        }
        let mut reach_err = None;
        let valid: Vec<UnitId> = candidates
            .into_iter()
            .filter(|&t| useful(b, actor_id, rule.action, t))
            .filter(|&t| match reachable(b, actor_id, rule.action, t) {
                Ok(()) => true,
                Err(e) => {
                    reach_err = Some(e);
                    false
                }
            })
            .collect();
        if valid.is_empty() {
            push(&mut trace, reach_err.map(SlotOutcome::NotExecutable).unwrap_or(SlotOutcome::NoValidTarget));
            continue;
        }
        let target = if b.settings.extended {
            if let Some(ext) = &rule.ext {
                match valid.iter().copied().find(|&t| eval_ext(b, actor_id, rule.action, t, ext)) {
                    Some(t) => t,
                    None => {
                        push(&mut trace, SlotOutcome::ExtFailed);
                        continue;
                    }
                }
            } else {
                valid[0]
            }
        } else {
            valid[0]
        };
        push(&mut trace, SlotOutcome::Chosen(target));
        chosen = Some(Plan { action: rule.action, target, slot: i as u8 });
    }
    chosen
}

/// Texte explicatif d'une trace pour l'outil de débogage.
pub fn explain(b: &Battle, actor_id: UnitId) -> Vec<String> {
    let u = b.unit(actor_id);
    let mut out = vec![format!("{} — Posture {} — Réflexes {}", u.name, crate::reflex::POSTURE_NAMES[u.book.active], if u.book.enabled { "ON" } else { "OFF" })];
    for tr in &u.last_trace {
        let slot = &u.book.current().slots[tr.slot as usize];
        let rule = slot.rule.as_ref().map(|r| format!("{} → {}", r.selector.label(), action(r.action).name)).unwrap_or_else(|| "(vide)".into());
        let o = match &tr.outcome {
            SlotOutcome::Empty => "vide".to_string(),
            SlotOutcome::Locked => "verrouillé".to_string(),
            SlotOutcome::Disabled => "désactivé".to_string(),
            SlotOutcome::NoTarget => "aucune cible".to_string(),
            SlotOutcome::NoValidTarget => "aucune cible utile".to_string(),
            SlotOutcome::NotExecutable(r) => format!("impossible : {}", r),
            SlotOutcome::ExtFailed => "condition étendue fausse".to_string(),
            SlotOutcome::Chosen(t) => {
                let tu = b.unit(*t);
                format!("✔ CHOISI → {} (PV {:.0} %)", tu.name, tu.hp_ratio() * 100.0)
            }
            SlotOutcome::Skipped => "non évalué".to_string(),
        };
        out.push(format!("{:>2}. {} — {}", tr.slot + 1, rule, o));
    }
    out
}
