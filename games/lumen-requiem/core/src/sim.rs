//! Systèmes temps réel du combat :
//! - ActionScheduler : jauges, file d'ordres manuels, phases d'action ;
//! - ActionExecutor : application des effets (dégâts, soins, statuts...) ;
//! - NavigationSystem : déplacement vers la portée, blocage, vol ;
//! - contrôle direct des joueurs (combos, artes, garde, saut, surcharge).
//!
//! Politique d'interruption (documentée) :
//! - une décision de Réflexe n'interrompt JAMAIS une action déjà engagée ;
//! - un ordre manuel remplace une action automatique encore en approche ou en
//!   charge ; si l'action est en cours d'animation, l'ordre attend la fin ;
//! - une unité qui perd la capacité d'agir (Torpeur, Figé...) abandonne son
//!   action non résolue (l'objet réservé est libéré) ;
//! - si la cible disparaît avant l'exécution, l'action est annulée et l'unité
//!   redevient immédiatement disponible pour un nouveau cycle de décision.

use crate::ai::{self, can_execute, in_range, reachable, useful};
use crate::battle::{Battle, Controller, Ev, Job, Order, Phase, Projectile, Source, TplRef, GRAVITY, FLY_ALT};
use crate::data::*;
use crate::status::{StatusEvent, StatusId};
use crate::types::{Team, UnitId, Vec2};

pub mod btn {
    pub const LEFT: u16 = 1;
    pub const RIGHT: u16 = 2;
    pub const UP: u16 = 4;
    pub const DOWN: u16 = 8;
    /// Saut / valider.
    pub const A: u16 = 16;
    /// Arte / retour.
    pub const B: u16 = 32;
    /// Attaque.
    pub const X: u16 = 64;
    /// Menu de commande.
    pub const Y: u16 = 128;
    /// Garde.
    pub const LB: u16 = 256;
    /// Changer de cible.
    pub const RB: u16 = 512;
    /// Changer de personnage.
    pub const LT: u16 = 1024;
    /// Arcane ultime (Surcharge).
    pub const RT: u16 = 2048;
    pub const START: u16 = 4096;
    /// Pilote automatique.
    pub const SELECT: u16 = 8192;
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Eq)]
pub struct HumanInput {
    pub held: u16,
    pub pressed: u16,
}

pub fn hero_artes(tpl: TplRef) -> [ActionId; 3] {
    match tpl {
        TplRef::Hero(T_KAEL) => [A_CROC, A_TAILLE, A_PLUIE],
        TplRef::Hero(T_NYRA) => [A_COMETE, A_UPPERCUT, A_TORNADE],
        TplRef::Hero(T_LYSA) => [A_GIVRE, A_SUTURE, A_AUBE],
        _ => [A_KIT_ZAP; 3],
    }
}

pub fn ultimate_of(tpl: TplRef) -> ActionId {
    match tpl {
        TplRef::Hero(T_NYRA) => A_U_NYRA,
        TplRef::Hero(T_LYSA) => A_U_LYSA,
        _ => A_U_KAEL,
    }
}

pub fn gauge_time(b: &Battle, id: UnitId) -> f32 {
    let u = b.unit(id);
    (2.5 - u.stats.spd * 0.045).max(0.9) / u.statuses.speed_mult().max(0.05)
}

pub fn move_speed(b: &Battle, id: UnitId) -> f32 {
    let u = b.unit(id);
    (240.0 + u.stats.spd * 4.0) * u.statuses.speed_mult()
}

fn is_offensive(a: ActionId) -> bool {
    action(a).target == TargetKind::Foe
}

/// Démarre une action. Réserve l'objet si nécessaire. Renvoie false si impossible.
pub fn start_job(b: &mut Battle, id: UnitId, act: ActionId, target: Option<UnitId>, source: Source) -> bool {
    let a = action(act);
    let mut reserved = false;
    if let Some(it) = a.item {
        if !b.inventory.reserve(it) {
            return false;
        }
        reserved = true;
    }
    let phase = match (source, target) {
        (Source::Direct, _) | (_, None) => Phase::Charge,
        (_, Some(t)) => {
            if in_range(b, id, act, t, 0.0) {
                Phase::Charge
            } else {
                Phase::Approach
            }
        }
    };
    let u = b.unit_mut(id);
    u.job = Some(Job { action: act, target, source, phase, t: 0.0, reserved, stuck: 0.0, combo: 0 });
    u.approach_t = 0.0;
    if let Some(t) = target {
        if is_offensive(act) || b.unit(t).team != b.unit(id).team {
            b.unit_mut(id).target = Some(t);
        }
        let dx = b.unit(t).pos.x - b.unit(id).pos.x;
        if dx.abs() > 4.0 {
            b.unit_mut(id).facing = dx.signum();
        }
    }
    if a.cast > 0.15 && phase == Phase::Charge {
        b.events.push(Ev::CastStart { unit: id, action: act });
    }
    true
}

pub fn cancel_job(b: &mut Battle, id: UnitId, reason: &'static str) {
    if let Some(job) = b.unit_mut(id).job.take() {
        if job.reserved {
            if let Some(it) = action(job.action).item {
                b.inventory.release(it);
            }
        }
        b.events.push(Ev::Cancelled { unit: id, reason });
    }
}

/// Ordre manuel (menu de commande). Prioritaire sur les Réflexes.
pub fn issue_manual(b: &mut Battle, id: UnitId, act: ActionId, target: UnitId) -> Result<(), &'static str> {
    can_execute(b, id, act, false)?;
    if !useful(b, id, act, target) {
        return Err("cible non valide pour cette action");
    }
    reachable(b, id, act, target)?;
    let job = b.unit(id).job;
    match job {
        None => {
            if !start_job(b, id, act, Some(target), Source::Manual) {
                return Err("objet épuisé");
            }
        }
        Some(j) if matches!(j.phase, Phase::Approach | Phase::Charge) && j.source != Source::Manual => {
            cancel_job(b, id, "remplacée par un ordre");
            if !start_job(b, id, act, Some(target), Source::Manual) {
                return Err("objet épuisé");
            }
        }
        Some(_) => {
            b.unit_mut(id).manual = Some(Order { action: act, target });
        }
    }
    let name = b.unit(id).name.clone();
    b.log(format!("Ordre : {} → {} sur {}", name, action(act).name, b.unit(target).name));
    Ok(())
}

/// Avance la simulation d'un pas fixe.
pub fn tick(b: &mut Battle, dt: f32, inputs: &[HumanInput]) {
    if b.hitstop > 0.0 {
        b.hitstop -= dt;
        return;
    }
    let cine = b.cinematic > 0.0;
    if cine {
        b.cinematic -= dt;
        if b.cinematic <= 0.0 {
            b.cinematic_unit = None;
        }
    }
    b.time += dt;
    if b.combo_timer > 0.0 {
        b.combo_timer -= dt;
        if b.combo_timer <= 0.0 {
            b.combo_count = 0;
        }
    }
    let n = b.units.len();
    for i in 0..n {
        let id = i as UnitId;
        if cine && b.cinematic_unit != Some(id) {
            continue;
        }
        update_unit(b, id, dt, inputs);
    }
    physics(b, dt, cine);
    if !cine {
        projectiles(b, dt);
    }
}

fn update_unit(b: &mut Battle, id: UnitId, dt: f32, inputs: &[HumanInput]) {
    {
        let u = b.unit_mut(id);
        if u.gone {
            return;
        }
        u.move_x = 0.0;
        u.hit_flash = (u.hit_flash - dt).max(0.0);
        u.invuln = (u.invuln - dt).max(0.0);
        u.special_cd = (u.special_cd - dt).max(0.0);
        u.combo_window = (u.combo_window - dt).max(0.0);
        u.anim_t += dt;
        for c in u.cooldowns.iter_mut() {
            c.1 = (c.1 - dt).max(0.0);
        }
        if u.ko() {
            if u.team == Team::Foe {
                u.fade += dt;
                if u.fade > 1.1 {
                    u.gone = true;
                }
            }
            return;
        }
    }
    // --- StatusEffectSystem ---
    let mut evs = Vec::new();
    b.unit_mut(id).statuses.tick(dt, &mut evs);
    for e in evs {
        match e {
            StatusEvent::HpTick(f) => {
                let maxhp = b.unit(id).max_hp();
                let amt = f * maxhp;
                if amt > 0.0 {
                    let u = b.unit_mut(id);
                    u.hp -= amt;
                    if u.hp <= 0.0 {
                        kill(b, id, None);
                        return;
                    }
                } else {
                    let u = b.unit_mut(id);
                    u.hp = (u.hp - amt).min(u.max_hp());
                }
            }
            StatusEvent::SentenceFell => {
                b.log(format!("{} : la Sentence tombe.", b.unit(id).name));
                kill(b, id, None);
                return;
            }
            StatusEvent::Crystallized => {
                b.unit_mut(id).statuses.apply(StatusId::Crystal, None);
                b.events.push(Ev::Status { unit: id, status: StatusId::Crystal, added: true });
                cancel_job(b, id, "cristallisé");
            }
            StatusEvent::Expired(s) => b.events.push(Ev::Status { unit: id, status: s, added: false }),
        }
    }
    {
        let u = b.unit_mut(id);
        let mh = u.max_hp();
        if u.hp > mh {
            u.hp = mh;
        }
    }
    if !b.unit(id).statuses.can_act() {
        if b.unit(id).job.map(|j| !matches!(j.phase, Phase::Recover)).unwrap_or(false) {
            cancel_job(b, id, "incapable d'agir");
        }
        b.unit_mut(id).manual = None;
        return;
    }
    if b.unit(id).hitstun > 0.0 {
        b.unit_mut(id).hitstun -= dt;
        return;
    }
    // Engagement des ennemis.
    if b.unit(id).team == Team::Foe && !b.unit(id).engaged {
        let pos = b.unit(id).pos;
        let near = b.allies().any(|h| h.alive() && !h.statuses.has(StatusId::Specter) && (h.pos.x - pos.x).abs() < 640.0);
        if near {
            engage(b, id);
        } else {
            return;
        }
    }
    match b.unit(id).controller {
        Controller::Human(p) if !b.unit(id).auto => {
            let inp = inputs.get(p as usize).copied().unwrap_or_default();
            human_control(b, id, inp);
        }
        _ => ai_control(b, id, dt),
    }
    progress_job(b, id, dt);
}

pub fn engage(b: &mut Battle, id: UnitId) {
    if b.unit(id).engaged {
        return;
    }
    b.unit_mut(id).engaged = true;
    let pos = b.unit(id).pos;
    let pack: Vec<UnitId> = b.foes().filter(|f| !f.engaged && (f.pos.x - pos.x).abs() < 420.0).map(|f| f.id).collect();
    for p in pack {
        b.unit_mut(p).engaged = true;
    }
}

fn ai_control(b: &mut Battle, id: UnitId, dt: f32) {
    if b.unit(id).job.is_none() {
        let gt = gauge_time(b, id);
        let u = b.unit_mut(id);
        if u.gauge < 1.0 {
            u.gauge = (u.gauge + dt / gt).min(1.0);
        }
        if b.unit(id).gauge >= 1.0 {
            if let Some(order) = b.unit_mut(id).manual.take() {
                let ok = can_execute(b, id, order.action, false).is_ok() && useful(b, id, order.action, order.target);
                if !ok || !start_job(b, id, order.action, Some(order.target), Source::Manual) {
                    b.events.push(Ev::Cancelled { unit: id, reason: "ordre devenu impossible" });
                }
            } else if b.unit(id).statuses.has(StatusId::Rage) {
                if let Some(&t) = ai::opponents(b, b.unit(id)).first() {
                    start_job(b, id, A_ATTACK, Some(t), Source::Status);
                }
            } else if b.unit(id).statuses.has(StatusId::Vertigo) {
                let pos = b.unit(id).pos;
                let cands: Vec<UnitId> = b.units.iter().filter(|u| u.id != id && u.alive() && !u.flying && (u.pos.x - pos.x).abs() < 500.0).map(|u| u.id).collect();
                if !cands.is_empty() {
                    let t = cands[b.rng.below(cands.len() as u32) as usize];
                    start_job(b, id, A_ATTACK, Some(t), Source::Status);
                }
            } else if b.unit(id).book.enabled {
                let interval = b.settings.decision_interval;
                let u = b.unit_mut(id);
                u.decide_cd -= dt;
                if u.decide_cd <= 0.0 {
                    u.decide_cd = interval;
                    let mut trace = std::mem::take(&mut b.unit_mut(id).last_trace);
                    let plan = ai::decide(b, id, if b.settings.trace { Some(&mut trace) } else { None });
                    b.unit_mut(id).last_trace = trace;
                    if let Some(p) = plan {
                        start_job(b, id, p.action, Some(p.target), Source::Reflex(p.slot));
                    }
                }
            }
        }
    }
    // Sans action : les alliés suivent le meneur (déplacement, pas une action).
    if b.unit(id).job.is_none() && b.unit(id).team == Team::Ally {
        if let Some(l) = b.leader {
            if l != id && b.unit(l).alive() && b.unit(id).statuses.can_move() {
                let slot = (id as f32 % 3.0) + 1.0;
                let goal = b.unit(l).pos.x - b.unit(l).facing * 90.0 * slot;
                let dx = goal - b.unit(id).pos.x;
                // En combat, pas de va-et-vient : on ne rejoint le meneur que s'il s'éloigne trop.
                let in_combat = b.foes().any(|f| f.alive() && f.engaged);
                let leash = if in_combat { 650.0 } else { 60.0 };
                if dx.abs() > leash {
                    let sp = move_speed(b, id) * if dx.abs() > 400.0 { 1.4 } else { 1.0 };
                    let u = b.unit_mut(id);
                    u.move_x = dx.signum() * sp;
                    u.facing = dx.signum();
                }
            }
        }
    }
}

fn target_still_valid(b: &Battle, act: ActionId, t: UnitId, actor: UnitId) -> bool {
    let Some(tu) = b.get(t) else { return false };
    if tu.statuses.has(StatusId::Crystal) && !matches!(action(act).effect, Effect::Cleanse { .. }) {
        return false;
    }
    let same = tu.team == b.unit(actor).team;
    match action(act).effect {
        Effect::Raise if same => tu.ko(),
        _ => tu.alive(),
    }
}

fn progress_job(b: &mut Battle, id: UnitId, dt: f32) {
    let Some(mut job) = b.unit(id).job else { return };
    let a = action(job.action);
    if let Some(t) = job.target {
        if !matches!(job.phase, Phase::Execute { hit_done: true } | Phase::Recover) && !target_still_valid(b, job.action, t, id) {
            cancel_job(b, id, "cible perdue");
            b.unit_mut(id).decide_cd = 0.0;
            return;
        }
    }
    let direct = job.source == Source::Direct;
    let (anim, recover) = if direct && job.action == A_ATTACK { (0.26, 0.16) } else { (a.anim, a.recover) };
    match job.phase {
        Phase::Approach => {
            let t = job.target.unwrap_or(id);
            if in_range(b, id, job.action, t, 0.0) {
                job.phase = Phase::Charge;
                job.t = 0.0;
                if a.cast > 0.15 {
                    b.events.push(Ev::CastStart { unit: id, action: job.action });
                }
            } else {
                // NavigationSystem : se rapprocher jusqu'à ~80 % de la portée.
                let dx = b.unit(t).pos.x - b.unit(id).pos.x;
                let sp = move_speed(b, id);
                b.unit_mut(id).approach_t += dt;
                if b.unit(id).statuses.can_move() {
                    let u = b.unit_mut(id);
                    u.move_x = dx.signum() * sp;
                    u.facing = dx.signum();
                    job.stuck = 0.0;
                } else {
                    job.stuck += dt;
                }
                if job.stuck > 2.0 || b.unit(id).approach_t > 7.0 {
                    b.unit_mut(id).job = Some(job);
                    cancel_job(b, id, "cible inaccessible");
                    return;
                }
            }
        }
        Phase::Charge => {
            job.t += dt * b.unit(id).statuses.speed_mult().max(0.3);
            if job.t >= a.cast {
                if let Err(r) = ai::can_execute_ex(b, id, job.action, false, job.reserved) {
                    b.unit_mut(id).job = Some(job);
                    cancel_job(b, id, r);
                    return;
                }
                if let Some(t) = job.target {
                    if !direct && !in_range(b, id, job.action, t, 50.0) {
                        job.phase = Phase::Approach;
                        b.unit_mut(id).job = Some(job);
                        return;
                    }
                    let dx = b.unit(t).pos.x - b.unit(id).pos.x;
                    if dx.abs() > 4.0 {
                        b.unit_mut(id).facing = dx.signum();
                    }
                }
                job.phase = Phase::Execute { hit_done: false };
                job.t = 0.0;
                b.unit_mut(id).anim_t = 0.0;
                b.events.push(Ev::ActionFired { unit: id, action: job.action, target: job.target });
            }
        }
        Phase::Execute { hit_done } => {
            job.t += dt;
            if !hit_done && job.t >= anim * 0.5 {
                job.phase = Phase::Execute { hit_done: true };
                b.unit_mut(id).job = Some(job);
                fire(b, id, job);
                // L'unité a pu tomber (autodestruction) ou l'action être annulée.
                match b.unit(id).job {
                    Some(j) => job = j,
                    None => return,
                }
                if !b.unit(id).alive() {
                    return;
                }
            }
            if job.t >= anim {
                job.phase = Phase::Recover;
                job.t = 0.0;
                if direct {
                    b.unit_mut(id).combo_window = recover + 0.12;
                }
            }
        }
        Phase::Recover => {
            job.t += dt;
            if job.t >= recover {
                let u = b.unit_mut(id);
                u.job = None;
                if !direct {
                    u.gauge = 0.0;
                }
                u.decide_cd = 0.0;
                return;
            }
        }
    }
    b.unit_mut(id).job = Some(job);
}

fn enemy_cooldown(act: ActionId) -> f32 {
    match act {
        A_E_SUPERNOVA => 32.0,
        A_E_SENTENCE => 28.0,
        A_E_OIL => 14.0,
        A_E_CRYSTAL_GAZE => 18.0,
        A_E_REVERS => 16.0,
        A_MIROIR => 20.0,
        A_SUTURE_PLUS => 12.0,
        _ => 0.0,
    }
}

/// ActionExecutor : résout l'action au moment de l'impact.
fn fire(b: &mut Battle, id: UnitId, job: Job) {
    let a = action(job.action);
    // Paiement des coûts au moment de l'exécution.
    if b.unit(id).mp + 1e-3 < a.mp {
        cancel_job(b, id, "Éther insuffisant");
        return;
    }
    b.unit_mut(id).mp -= a.mp;
    if let Some(it) = a.item {
        let ok = if job.reserved { b.inventory.consume_reserved(it) } else { false };
        if !ok {
            cancel_job(b, id, "objet épuisé");
            return;
        }
        if let Some(j) = b.unit_mut(id).job.as_mut() {
            j.reserved = false;
        }
    }
    if b.unit(id).team == Team::Foe && job.action != A_ATTACK {
        let boss = b.unit(id).boss;
        b.unit_mut(id).special_cd = if boss { 3.2 } else { 5.0 };
        let cd = enemy_cooldown(job.action);
        if cd > 0.0 {
            let u = b.unit_mut(id);
            if let Some(c) = u.cooldowns.iter_mut().find(|c| c.0 == job.action) {
                c.1 = cd;
            } else {
                u.cooldowns.push((job.action, cd));
            }
        }
    }
    let src_name = b.unit(id).name.clone();
    let tag = match job.source {
        Source::Reflex(s) => format!(" [Réflexe {}]", s + 1),
        Source::Manual => " [Ordre]".to_string(),
        _ => String::new(),
    };
    if job.source != Source::Direct || a.kind != ActionKind::Attack {
        let tname = job.target.map(|t| format!(" → {}", b.unit(t).name)).unwrap_or_default();
        b.log(format!("{} : {}{}{}", src_name, a.name, tname, tag));
    }
    let team = b.unit(id).team;
    let combo_mult = if job.source == Source::Direct && job.action == A_ATTACK { [1.0, 1.15, 1.5][job.combo.min(2) as usize] } else { 1.0 };
    if a.kind == ActionKind::Special {
        b.events.push(Ev::Ultimate { unit: id, action: job.action });
        let targets: Vec<UnitId> = b.units.iter().filter(|u| u.team != team && u.alive()).map(|u| u.id).collect();
        for t in targets {
            apply(b, id, t, job.action, 1.0, false);
        }
        if job.action == A_U_LYSA {
            let allies: Vec<UnitId> = b.units.iter().filter(|u| u.team == team && !u.gone).map(|u| u.id).collect();
            for t in allies {
                let u = b.unit_mut(t);
                if u.ko() {
                    u.statuses.remove(StatusId::Ko);
                    u.hp = u.max_hp() * 0.5;
                    b.events.push(Ev::Raised { unit: t });
                } else {
                    let amt = u.max_hp() - u.hp;
                    u.hp = u.max_hp();
                    b.events.push(Ev::Heal { unit: t, amount: amt });
                }
            }
        }
        b.hitstop = 0.12;
        return;
    }
    match a.delivery {
        Delivery::Melee => {
            if job.source == Source::Direct {
                // Coup direct : frappe tout ce qui est devant, au sol comme en l'air si l'arte le permet.
                let u = b.unit(id);
                let (x, y, f) = (u.pos.x, u.pos.y, u.facing);
                let reach = ai::effective_range(u, job.action) + 10.0;
                let air = ai::hits_air(u, job.action) || y > 60.0;
                let vy = if air { 200.0 } else { 90.0 };
                let mut hits: Vec<UnitId> = b
                    .units
                    .iter()
                    .filter(|t| t.team != team && t.alive())
                    .filter(|t| {
                        let dx = (t.pos.x - x) * f;
                        dx > -35.0 && dx < reach && (t.pos.y - y).abs() < vy
                    })
                    .map(|t| t.id)
                    .collect();
                if a.area > 0.0 {
                    hits.extend(b.units.iter().filter(|t| t.team != team && t.alive() && (t.pos.x - x).abs() < a.area && !hits.contains(&t.id) && (t.pos.y - y).abs() < vy).map(|t| t.id).collect::<Vec<_>>());
                }
                let fxpos = Vec2::new(x + f * reach * 0.6, y + 50.0);
                b.events.push(Ev::Impact { pos: fxpos, action: job.action, color: b.unit(id).tpl.tpl().accent });
                for t in hits {
                    apply(b, id, t, job.action, combo_mult, false);
                }
            } else if let Some(t) = job.target {
                if in_range(b, id, job.action, t, 45.0) {
                    let p = b.unit(t).pos;
                    b.events.push(Ev::Impact { pos: Vec2::new(p.x, p.y + 50.0), action: job.action, color: 0xffffff });
                    apply_area(b, id, t, job.action, 1.0);
                } else {
                    b.events.push(Ev::Miss { unit: t });
                }
            }
        }
        Delivery::Projectile { speed } => {
            let u = b.unit(id);
            let start = Vec2::new(u.pos.x + u.facing * 30.0, u.pos.y + if job.action == A_CROC { 20.0 } else { 55.0 });
            let target = if job.source == Source::Direct { None } else { job.target };
            let vel = match target {
                Some(t) => {
                    let tp = b.unit(t).pos;
                    let d = Vec2::new(tp.x - start.x, tp.y + 45.0 - start.y);
                    let l = (d.x * d.x + d.y * d.y).sqrt().max(1.0);
                    Vec2::new(d.x / l * speed, d.y / l * speed)
                }
                None => Vec2::new(u.facing * speed, 0.0),
            };
            let color = a.element.map(|e| e.color()).unwrap_or(u.tpl.tpl().accent);
            b.projectiles.push(Projectile { owner: id, team, action: job.action, target, pos: start, vel, life: 1.4, color, hit: Vec::new(), direct: job.source == Source::Direct });
        }
        Delivery::Instant => {
            let t = match job.target {
                Some(t) => t,
                None => {
                    if a.target == TargetKind::SelfOnly {
                        id
                    } else {
                        return;
                    }
                }
            };
            let p = b.unit(t).pos;
            let color = a.element.map(|e| e.color()).unwrap_or(match a.kind {
                ActionKind::HealMagic => 0x7dffb0,
                ActionKind::SupportMagic => 0xffe08a,
                ActionKind::DebuffMagic => 0xc070ff,
                _ => 0xffffff,
            });
            b.events.push(Ev::Impact { pos: Vec2::new(p.x, p.y + 50.0), action: job.action, color });
            apply_area(b, id, t, job.action, 1.0);
            if job.action == A_E_SELF_DESTRUCT {
                kill(b, id, None);
            }
        }
    }
}

fn apply_area(b: &mut Battle, src: UnitId, center: UnitId, act: ActionId, mult: f32) {
    let a = action(act);
    if a.area <= 0.0 {
        apply(b, src, center, act, mult, false);
        return;
    }
    let c = b.unit(center);
    let (cp, cteam) = (c.pos, c.team);
    let raise = matches!(a.effect, Effect::Raise);
    let ids: Vec<UnitId> = b
        .units
        .iter()
        .filter(|u| u.team == cteam && !u.gone && (u.alive() || raise) && u.pos.dist(cp) <= a.area)
        .map(|u| u.id)
        .collect();
    for t in ids {
        if t == center || useful(b, src, act, t) || matches!(a.effect, Effect::Damage { .. } | Effect::DamageStatus { .. }) {
            apply(b, src, t, act, mult, false);
        }
    }
}

/// Applique l'effet d'une action sur une cible (gère Miroir, Revers, morts-vivants).
pub fn apply(b: &mut Battle, src: UnitId, tgt: UnitId, act: ActionId, mult: f32, reflected: bool) {
    let a = action(act);
    if b.unit(tgt).gone {
        return;
    }
    // Miroir : renvoie vers le camp opposé à l'unité réfléchissante.
    if a.magic && a.reflectable && !reflected && src != tgt && b.unit(tgt).statuses.has(StatusId::Mirror) && b.unit(tgt).alive() {
        let tp = b.unit(tgt).pos;
        let other = b.unit(tgt).team.other();
        let dest = b
            .units
            .iter()
            .filter(|u| u.team == other && u.alive())
            .min_by(|x, y| x.pos.dist(tp).partial_cmp(&y.pos.dist(tp)).unwrap_or(std::cmp::Ordering::Equal).then(x.id.cmp(&y.id)))
            .map(|u| u.id);
        b.events.push(Ev::Reflected { unit: tgt });
        if let Some(d) = dest {
            apply(b, src, d, act, mult, true);
        }
        return;
    }
    let same_team = b.unit(src).team == b.unit(tgt).team;
    match a.effect {
        Effect::Damage { .. } | Effect::DamageStatus { .. } => {
            let physical = !matches!(a.effect, Effect::Damage { magical: true } | Effect::DamageStatus { magical: true, .. }) && a.kind != ActionKind::Special;
            if !b.unit(tgt).alive() {
                return;
            }
            match calc_damage(b, src, tgt, act, mult, physical) {
                None => {
                    b.events.push(Ev::Miss { unit: tgt });
                }
                Some((d, crit, weak)) => {
                    if d < 0.0 {
                        heal_raw(b, tgt, -d, true);
                    } else {
                        hurt(b, src, tgt, d, physical, crit, weak, a.element, act);
                        if let Effect::DamageStatus { status, chance, .. } = a.effect {
                            if b.unit(tgt).alive() && b.rng.chance(chance) && b.unit_mut(tgt).statuses.apply(status, None) {
                                b.events.push(Ev::Status { unit: tgt, status, added: true });
                            }
                        }
                    }
                }
            }
        }
        Effect::Heal => {
            let s = b.unit(src);
            let amount = if a.kind == ActionKind::Item {
                a.power
            } else {
                let fer = if s.statuses.has(StatusId::Fervor) { 1.3 } else { 1.0 };
                a.power * (s.stats.mag * 2.0 * fer + s.level as f32 * 1.5) * b.rng.range(0.95, 1.05)
            } * mult;
            if b.unit(tgt).undead && !same_team {
                hurt(b, src, tgt, amount, false, false, true, Some(crate::types::Element::Holy), act);
            } else if b.unit(tgt).alive() {
                heal_raw(b, tgt, amount, false);
            }
        }
        Effect::Raise => {
            let t = b.unit(tgt);
            if t.undead && !same_team {
                if !t.boss && t.alive() {
                    b.log(format!("{} se dissout dans la lumière !", t.name));
                    kill(b, tgt, Some(src));
                }
            } else if t.ko() {
                let u = b.unit_mut(tgt);
                u.statuses.remove(StatusId::Ko);
                u.hp = (u.max_hp() * a.power).max(1.0);
                u.gauge = 0.0;
                u.job = None;
                b.events.push(Ev::Raised { unit: tgt });
                b.log(format!("{} se relève !", b.unit(tgt).name));
            }
        }
        Effect::AddStatus { status, chance } => {
            let t = b.unit(tgt);
            if !t.alive() {
                return;
            }
            let ch = if t.boss && status.def().polarity == crate::status::Polarity::Negative { chance * 0.5 } else { chance };
            if b.rng.chance(ch) && b.unit_mut(tgt).statuses.apply(status, None) {
                b.events.push(Ev::Status { unit: tgt, status, added: true });
            } else {
                b.events.push(Ev::Miss { unit: tgt });
            }
        }
        Effect::Cleanse { .. } => {
            let m = cleanse_mask_for(act);
            let n = b.unit_mut(tgt).statuses.cleanse(m);
            if n > 0 {
                b.events.push(Ev::Heal { unit: tgt, amount: 0.0 });
            }
        }
        Effect::Dispel => {
            let n = b.unit_mut(tgt).statuses.dispel();
            if n == 0 {
                b.events.push(Ev::Miss { unit: tgt });
            }
        }
        Effect::Steal => {
            let (boss, stolen, alive, item) = {
                let t = b.unit(tgt);
                (t.boss, t.stolen, t.alive(), t.tpl.tpl().steal)
            };
            let chance = if boss { 0.3 } else { 0.55 };
            if stolen || !alive {
                b.events.push(Ev::Stolen { unit: tgt, item: None, lumens: 0 });
                b.log("Rien à chaparder.".to_string());
            } else if b.rng.chance(chance) {
                let lumens = 10 + b.rng.below(20);
                b.unit_mut(tgt).stolen = true;
                if let Some(it) = item {
                    b.inventory.add(it, 1);
                    b.log(format!("Chapardé : {} !", ITEMS[it as usize].name));
                } else {
                    b.lumens += lumens;
                }
                b.events.push(Ev::Stolen { unit: tgt, item, lumens });
            } else {
                b.events.push(Ev::Miss { unit: tgt });
            }
        }
        Effect::RestoreMp { chance } => {
            if b.rng.chance(chance) {
                let u = b.unit_mut(tgt);
                let amt = u.stats.max_mp * 0.35;
                u.mp = (u.mp + amt).min(u.stats.max_mp);
                b.events.push(Ev::Mp { unit: tgt, amount: amt });
            } else {
                b.events.push(Ev::Miss { unit: tgt });
            }
        }
        Effect::HealMp => {
            let u = b.unit_mut(tgt);
            let amt = a.power.min(u.stats.max_mp - u.mp);
            u.mp += amt;
            b.events.push(Ev::Mp { unit: tgt, amount: amt });
        }
    }
}

/// Calcul des dégâts. `None` = esquive. Valeur négative = absorption.
pub fn calc_damage(b: &mut Battle, src: UnitId, tgt: UnitId, act: ActionId, mult: f32, physical: bool) -> Option<(f32, bool, bool)> {
    let a = action(act);
    let s = b.unit(src).clone();
    let t = b.unit(tgt);
    let lvl = s.level as f32;
    let mut d;
    if a.kind == ActionKind::Item {
        d = a.power;
    } else if a.kind == ActionKind::Special {
        d = a.power * ((s.stats.str_ + s.stats.mag) * 1.5 + lvl * 2.0) * 40.0 / (40.0 + (t.stats.def + t.stats.mdef) * 0.5);
    } else if physical {
        if t.statuses.has(StatusId::Specter) {
            return None;
        }
        let acc = if s.statuses.has(StatusId::Mist) { 0.45 } else { 0.96 };
        if !b.rng.chance(acc) {
            return None;
        }
        let t = b.unit(tgt);
        let mut atk = s.stats.str_;
        if s.statuses.has(StatusId::Ardor) {
            atk *= 1.3;
        }
        if s.statuses.has(StatusId::Rage) {
            atk *= 1.5;
        }
        let wpow = if act == A_ATTACK { s.weapon.power } else { 1.0 };
        d = a.power * wpow * (atk * 2.0 + lvl * 1.5) * 40.0 / (40.0 + t.stats.def);
        if t.statuses.has(StatusId::Aegis) {
            d *= 0.66;
        }
    } else {
        let mut m = s.stats.mag;
        if s.statuses.has(StatusId::Fervor) {
            m *= 1.3;
        }
        d = a.power * (m * 2.0 + lvl * 1.5) * 40.0 / (40.0 + t.stats.mdef);
        if t.statuses.has(StatusId::Prism) {
            d *= 0.66;
        }
    }
    let t = b.unit(tgt);
    let mut weak = false;
    if let Some(e) = a.element {
        let m = t.element_mult(e);
        weak = m > 1.0;
        d *= m;
    }
    d *= mult * b.rng.range(0.92, 1.08);
    let mut crit = false;
    if physical && a.kind != ActionKind::Item && b.rng.chance(0.06 + s.bonus_crit) {
        crit = true;
        d *= 1.5;
    }
    if b.unit(tgt).statuses.has(StatusId::Revers) {
        d = -d;
    }
    Some((d, crit, weak))
}

fn heal_raw(b: &mut Battle, tgt: UnitId, amount: f32, absorb: bool) {
    let u = b.unit(tgt);
    if !u.alive() {
        return;
    }
    let mut amt = amount;
    if u.statuses.has(StatusId::Fever) {
        amt *= 0.5;
    }
    if u.statuses.has(StatusId::Revers) && !absorb {
        // Revers : un soin blesse.
        let src = tgt;
        hurt(b, src, tgt, amt, false, false, false, None, A_SUTURE);
        return;
    }
    let u = b.unit_mut(tgt);
    let real = amt.min(u.max_hp() - u.hp).max(0.0);
    u.hp += real;
    b.events.push(Ev::Heal { unit: tgt, amount: amt });
}

#[allow(clippy::too_many_arguments)]
pub fn hurt(b: &mut Battle, src: UnitId, tgt: UnitId, amount: f32, physical: bool, crit: bool, weak: bool, element: Option<crate::types::Element>, act: ActionId) {
    if !b.unit(tgt).alive() {
        return;
    }
    let mut amount = amount.max(0.0);
    let src_pos = b.unit(src).pos;
    // Garde : un joueur qui garde face à l'attaquant encaisse beaucoup moins.
    let guarding = {
        let t = b.unit(tgt);
        t.guard && ((src_pos.x - t.pos.x) * t.facing >= -10.0 || src == tgt)
    };
    if guarding {
        amount *= 0.25;
        b.events.push(Ev::Guarded { unit: tgt });
    }
    let a = action(act);
    {
        let t = b.unit_mut(tgt);
        t.hp -= amount;
        t.hit_flash = 0.14;
        t.statuses.on_damaged(physical);
    }
    b.events.push(Ev::Damage { unit: tgt, amount, crit, weak, element });
    if b.unit(tgt).team == Team::Foe {
        engage(b, tgt);
    }
    // Surcharge et combo.
    if b.unit(src).team == Team::Ally && src != tgt {
        b.combo_count += 1;
        b.combo_timer = 1.6;
        let u = b.unit_mut(src);
        u.surcharge = (u.surcharge + if a.kind == ActionKind::Technique { 4.0 } else { 2.2 }).min(100.0);
        if u.lifesteal > 0.0 {
            let heal = amount * u.lifesteal;
            u.hp = (u.hp + heal).min(u.max_hp());
        }
    }
    if b.unit(tgt).team == Team::Ally {
        let u = b.unit_mut(tgt);
        u.surcharge = (u.surcharge + 3.5).min(100.0);
    }
    if crit || weak || a.kind == ActionKind::Technique {
        b.hitstop = b.hitstop.max(0.045);
    }
    // Recul, projection, étourdissement.
    let boss = b.unit(tgt).boss;
    if (physical || a.knock > 100.0) && !guarding && src != tgt {
        let dir = (b.unit(tgt).pos.x - src_pos.x).signum();
        let dir = if dir == 0.0 { b.unit(src).facing } else { dir };
        let human_victim = b.unit(tgt).is_human();
        let t = b.unit_mut(tgt);
        if boss {
            t.vel.x += dir * a.knock * 0.15;
        } else {
            t.vel.x = dir * a.knock * if t.team == Team::Ally { 2.0 } else { 3.2 };
            if a.launch > 0.0 && !t.flying {
                t.vel.y = a.launch;
            } else if t.pos.y > 20.0 && !t.flying {
                t.vel.y = t.vel.y.max(180.0);
            }
            t.hitstun = if t.team == Team::Ally { 0.22 } else { 0.32 };
            if human_victim {
                if let Some(j) = t.job {
                    if j.source == Source::Direct && !matches!(j.phase, Phase::Recover) {
                        t.job = None;
                    }
                }
            }
        }
    }
    if b.unit(tgt).hp <= 0.0 {
        kill(b, tgt, Some(src));
    }
}

pub fn kill(b: &mut Battle, id: UnitId, _by: Option<UnitId>) {
    cancel_job(b, id, "à terre");
    {
        let u = b.unit_mut(id);
        u.hp = 0.0;
        u.statuses.apply(StatusId::Ko, None);
        u.manual = None;
        u.target = None;
        u.guard = false;
        u.gauge = 0.0;
        u.surcharge *= 0.5;
        if u.team == Team::Foe {
            u.vel.y = 320.0;
        }
    }
    b.events.push(Ev::Ko { unit: id });
    let (team, tpl, level, name, boss) = {
        let u = b.unit(id);
        (u.team, u.tpl.tpl(), u.level, u.name.clone(), u.boss)
    };
    if team == Team::Foe {
        b.xp += tpl.xp * (1 + level / 3);
        b.lumens += tpl.lumens;
        b.log(format!("{} est vaincu.", name));
        b.hitstop = b.hitstop.max(if boss { 0.4 } else { 0.07 });
    } else {
        b.log(format!("{} est à terre !", name));
    }
}

fn human_control(b: &mut Battle, id: UnitId, inp: HumanInput) {
    let mut held = inp.held;
    let mut pressed = inp.pressed;
    if b.unit(id).statuses.has(StatusId::Vertigo) {
        let swap = |v: u16| (v & !(btn::LEFT | btn::RIGHT)) | if v & btn::LEFT != 0 { btn::RIGHT } else { 0 } | if v & btn::RIGHT != 0 { btn::LEFT } else { 0 };
        held = swap(held);
        pressed = swap(pressed);
    }
    let speed = move_speed(b, id);
    let u = b.unit(id);
    let can_move = u.statuses.can_move();
    let job = u.job;
    let busy = job.map(|j| !matches!(j.phase, Phase::Recover)).unwrap_or(false);
    let after_hit = job.map(|j| j.source == Source::Direct && matches!(j.phase, Phase::Execute { hit_done: true } | Phase::Recover)).unwrap_or(true);
    let on_ground = u.on_ground;
    let guard = held & btn::LB != 0 && on_ground && !busy;
    b.unit_mut(id).guard = guard;
    let dir = (if held & btn::RIGHT != 0 { 1.0 } else { 0.0 }) - (if held & btn::LEFT != 0 { 1.0 } else { 0.0 });
    if can_move && !guard && (!busy || !on_ground) {
        let u = b.unit_mut(id);
        u.move_x = dir * speed;
        if dir != 0.0 && !busy {
            u.facing = dir;
        }
    }
    if pressed & btn::A != 0 && can_move && !busy {
        let u = b.unit_mut(id);
        if u.on_ground {
            u.vel.y = 800.0;
            u.on_ground = false;
            b.events.push(Ev::Jump { unit: id });
        } else if u.air_jumps == 0 {
            u.vel.y = 680.0;
            u.air_jumps = 1;
            b.events.push(Ev::Jump { unit: id });
        }
    }
    // Verrouillage de cible.
    let lock_valid = b.unit(id).target.map(|t| b.unit(t).alive() && b.unit(t).team != b.unit(id).team).unwrap_or(false);
    if pressed & btn::RB != 0 || !lock_valid {
        let x = b.unit(id).pos.x;
        let mut foes: Vec<(f32, UnitId)> = b.foes().filter(|f| f.alive() && (f.engaged || (f.pos.x - x).abs() < 900.0)).map(|f| (f.pos.x, f.id)).collect();
        foes.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if !foes.is_empty() {
            let cur = b.unit(id).target;
            let next = if pressed & btn::RB != 0 && lock_valid {
                let i = foes.iter().position(|f| Some(f.1) == cur).unwrap_or(0);
                foes[(i + 1) % foes.len()].1
            } else {
                foes.iter().min_by(|a, c| (a.0 - x).abs().partial_cmp(&(c.0 - x).abs()).unwrap_or(std::cmp::Ordering::Equal)).unwrap().1
            };
            b.unit_mut(id).target = Some(next);
        } else if !lock_valid {
            b.unit_mut(id).target = None;
        }
    }
    // Ordre manuel en attente (menu de commande).
    if b.unit(id).job.is_none() {
        if let Some(o) = b.unit_mut(id).manual.take() {
            if can_execute(b, id, o.action, false).is_ok() && useful(b, id, o.action, o.target) {
                start_job(b, id, o.action, Some(o.target), Source::Manual);
            }
        }
    }
    if !b.unit(id).statuses.can_act() {
        return;
    }
    // Arcane ultime.
    if pressed & btn::RT != 0 && b.unit(id).surcharge >= 100.0 && !busy {
        let ult = ultimate_of(b.unit(id).tpl);
        b.unit_mut(id).job = None;
        if start_job(b, id, ult, None, Source::Direct) {
            let u = b.unit_mut(id);
            u.surcharge = 0.0;
            u.invuln = 2.0;
            b.cinematic = action(ult).anim + 0.1;
            b.cinematic_unit = Some(id);
            b.log(format!("ARCANE ULTIME : {} !", action(ult).name));
        }
        return;
    }
    // Attaque (combo de 3 coups).
    if pressed & btn::X != 0 && (job.is_none() || (after_hit && b.unit(id).combo_window > 0.0)) {
        let next = match job {
            Some(j) if j.source == Source::Direct && j.action == A_ATTACK => (j.combo + 1).min(3),
            Some(j) if j.source == Source::Direct => 1,
            _ => 0,
        };
        if next < 3 {
            b.unit_mut(id).job = None;
            if start_job(b, id, A_ATTACK, None, Source::Direct) {
                if let Some(j) = b.unit_mut(id).job.as_mut() {
                    j.combo = next;
                }
                if dir != 0.0 {
                    b.unit_mut(id).facing = dir;
                }
                // Petit élan vers l'avant.
                let u = b.unit_mut(id);
                u.vel.x = u.facing * 160.0;
            }
        }
        return;
    }
    // Arte : neutre / haut / bas.
    if pressed & btn::B != 0 && (job.is_none() || after_hit) {
        let idx = if held & btn::UP != 0 {
            1
        } else if held & btn::DOWN != 0 {
            2
        } else {
            0
        };
        let act = hero_artes(b.unit(id).tpl)[idx];
        if can_execute(b, id, act, false).is_err() {
            b.events.push(Ev::Cancelled { unit: id, reason: "arte impossible" });
            return;
        }
        let a = action(act);
        let target = match (a.target, a.delivery) {
            (TargetKind::Ally, _) => {
                let team = b.unit(id).team;
                b.units
                    .iter()
                    .filter(|u| u.team == team && u.alive())
                    .min_by(|x, y| x.hp_ratio().partial_cmp(&y.hp_ratio()).unwrap_or(std::cmp::Ordering::Equal))
                    .map(|u| u.id)
            }
            (TargetKind::Foe, Delivery::Instant) => b.unit(id).target,
            _ => None,
        };
        if a.target == TargetKind::Foe && a.delivery == Delivery::Instant && target.is_none() {
            return;
        }
        b.unit_mut(id).job = None;
        if dir != 0.0 {
            b.unit_mut(id).facing = dir;
        }
        start_job(b, id, act, target, Source::Direct);
        if act == A_COMETE {
            let u = b.unit_mut(id);
            u.vel.x = u.facing * 700.0;
        }
        if act == A_TAILLE || act == A_UPPERCUT {
            let u = b.unit_mut(id);
            if u.on_ground {
                u.vel.y = 520.0;
            }
        }
    }
}

fn physics(b: &mut Battle, dt: f32, cine: bool) {
    let (lo, hi) = b.arena;
    let time = b.time;
    for u in b.units.iter_mut() {
        if u.gone {
            continue;
        }
        if cine && b.cinematic_unit != Some(u.id) {
            continue;
        }
        let frozen = u.statuses.has(StatusId::Frozen) || u.statuses.has(StatusId::Crystal);
        if frozen {
            u.vel = Vec2::default();
            continue;
        }
        let stunned = u.hitstun > 0.0 || u.ko();
        if u.flying && !u.ko() {
            let goal = FLY_ALT + 14.0 * (time * 2.2 + u.id as f32).sin();
            if u.hitstun > 0.0 {
                u.vel.y *= (-6.0 * dt).exp();
            } else {
                u.vel.y = (goal - u.pos.y) * 4.0;
            }
        } else {
            u.vel.y -= GRAVITY * dt;
        }
        if stunned {
            u.vel.x *= (-5.0 * dt).exp();
        } else if u.on_ground || u.flying {
            // Glissement résiduel (élan des coups) puis contrôle.
            let k = (-14.0 * dt).exp();
            u.vel.x = u.move_x + (u.vel.x - u.move_x) * k;
        } else {
            let k = (-4.0 * dt).exp();
            u.vel.x = u.move_x + (u.vel.x - u.move_x) * k;
        }
        u.pos.x += u.vel.x * dt;
        u.pos.y += u.vel.y * dt;
        if u.pos.y <= 0.0 {
            u.pos.y = 0.0;
            u.vel.y = 0.0;
            u.on_ground = true;
            u.air_jumps = 0;
        } else if !u.flying {
            u.on_ground = false;
        }
        if u.pos.x < lo + 20.0 {
            u.pos.x = lo + 20.0;
            u.vel.x = u.vel.x.max(0.0);
        }
        if u.pos.x > hi - 20.0 {
            u.pos.x = hi - 20.0;
            u.vel.x = u.vel.x.min(0.0);
        }
    }
}

fn projectiles(b: &mut Battle, dt: f32) {
    let mut i = 0;
    while i < b.projectiles.len() {
        let mut p = b.projectiles[i].clone();
        p.life -= dt;
        if let Some(t) = p.target {
            if b.unit(t).alive() {
                let tp = b.unit(t).pos;
                let d = Vec2::new(tp.x - p.pos.x, tp.y + 45.0 - p.pos.y);
                let l = (d.x * d.x + d.y * d.y).sqrt().max(1.0);
                let sp = (p.vel.x * p.vel.x + p.vel.y * p.vel.y).sqrt();
                p.vel = Vec2::new(d.x / l * sp, d.y / l * sp);
            }
        }
        p.pos.x += p.vel.x * dt;
        p.pos.y += p.vel.y * dt;
        let air = action(p.action).hits_air.unwrap_or(true);
        let mut done = p.life <= 0.0;
        let hits: Vec<UnitId> = match p.target {
            Some(t) => {
                let tu = b.unit(t);
                if tu.alive() && tu.pos.dist(Vec2::new(p.pos.x, p.pos.y - 45.0)) < 50.0 {
                    vec![t]
                } else {
                    vec![]
                }
            }
            None => b
                .units
                .iter()
                .filter(|u| u.team != p.team && u.alive() && !p.hit.contains(&u.id))
                .filter(|u| (u.pos.x - p.pos.x).abs() < 42.0 && if air { (u.pos.y + 45.0 - p.pos.y).abs() < 110.0 } else { u.pos.y < 70.0 })
                .map(|u| u.id)
                .collect(),
        };
        for h in hits {
            p.hit.push(h);
            b.events.push(Ev::Impact { pos: p.pos, action: p.action, color: p.color });
            apply(b, p.owner, h, p.action, 1.0, false);
            if p.target.is_some() || p.action != A_CROC {
                done = true;
            }
        }
        if p.pos.x < b.arena.0 - 50.0 || p.pos.x > b.arena.1 + 50.0 {
            done = true;
        }
        if done {
            b.projectiles.remove(i);
        } else {
            b.projectiles[i] = p;
            i += 1;
        }
    }
}
