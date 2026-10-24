//! Les 20 tests obligatoires du cahier des charges (section 22), plus des
//! tests de robustesse (sérialisation, catalogue, déterminisme).

use lumen_core::ai::{decide, explain};
use lumen_core::battle::{Battle, Controller, Phase, Source};
use lumen_core::data::*;
use lumen_core::presets;
use lumen_core::reflex::{ExtExpr, Posture, ReflexBook, Selector, Selector::*, SlotOutcome};
use lumen_core::sim::{self, HumanInput};
use lumen_core::status::StatusId;
use lumen_core::types::{Element, UnitId};

const DT: f32 = 1.0 / 60.0;

struct Setup {
    b: Battle,
    kael: UnitId,
    nyra: UnitId,
    lysa: UnitId,
    foe: UnitId,
}

/// Équipe de trois + un soldat ennemi proche. Aucun Réflexe par défaut.
fn setup() -> Setup {
    let mut b = Battle::new(42);
    let kael = b.add_hero(T_KAEL, 5, 100.0);
    let nyra = b.add_hero(T_NYRA, 5, 160.0);
    let lysa = b.add_hero(T_LYSA, 5, 60.0);
    let foe = b.add_foe(F_SOLDIER, 1, 300.0);
    b.leader = Some(kael);
    for id in [kael, nyra, lysa] {
        b.unit_mut(id).book = ReflexBook::default();
        b.unit_mut(id).gauge = 1.0;
    }
    b.unit_mut(foe).book = ReflexBook::default();
    Setup { b, kael, nyra, lysa, foe }
}

fn book(rules: &[(Selector, ActionId)]) -> ReflexBook {
    ReflexBook::with_rules(rules)
}

fn run(b: &mut Battle, secs: f32) {
    let inputs = [HumanInput::default(); 4];
    let n = (secs / DT) as usize;
    for _ in 0..n {
        sim::tick(b, DT, &inputs);
        b.events.clear();
    }
}

#[test]
fn t01_heal_priority() {
    let mut s = setup();
    s.b.unit_mut(s.kael).hp = s.b.unit(s.kael).max_hp() * 0.2;
    s.b.unit_mut(s.lysa).book = book(&[(AllyHpBelow(50), A_SUTURE), (FoeNearestVisible, A_ATTACK)]);
    let p = decide(&s.b, s.lysa, None).expect("une décision");
    assert_eq!(p.action, A_SUTURE);
    assert_eq!(p.target, s.kael);
    assert_eq!(p.slot, 0);
}

#[test]
fn t02_attack_priority() {
    let mut s = setup();
    s.b.unit_mut(s.kael).hp = s.b.unit(s.kael).max_hp() * 0.2;
    s.b.unit_mut(s.lysa).book = book(&[(FoeNearestVisible, A_ATTACK), (AllyHpBelow(50), A_SUTURE)]);
    let p = decide(&s.b, s.lysa, None).unwrap();
    assert_eq!(p.action, A_ATTACK);
    assert_eq!(p.target, s.foe);
}

#[test]
fn t03_resurrection() {
    let mut s = setup();
    sim::kill(&mut s.b, s.kael, None);
    s.b.unit_mut(s.lysa).book = book(&[(AllyStatus(StatusId::Ko), A_RELEVE), (FoeNearestVisible, A_ATTACK)]);
    let p = decide(&s.b, s.lysa, None).unwrap();
    assert_eq!((p.action, p.target), (A_RELEVE, s.kael));
    // Et l'action est réellement exécutée : Kael se relève.
    sim::start_job(&mut s.b, s.lysa, p.action, Some(p.target), Source::Reflex(p.slot));
    run(&mut s.b, 3.0);
    assert!(s.b.unit(s.kael).alive(), "Kael doit être relevé");
    assert!(s.b.unit(s.kael).hp > 0.0);
}

#[test]
fn t04_not_enough_mp_falls_back_to_item() {
    let mut s = setup();
    sim::kill(&mut s.b, s.kael, None);
    s.b.unit_mut(s.lysa).mp = 0.0;
    s.b.inventory.add(IT_PLUME, 1);
    s.b.unit_mut(s.lysa).book = book(&[(AllyStatus(StatusId::Ko), A_RELEVE), (AllyStatus(StatusId::Ko), A_I_PLUME), (FoeNearestVisible, A_ATTACK)]);
    let mut trace = Vec::new();
    let p = decide(&s.b, s.lysa, Some(&mut trace)).unwrap();
    assert_eq!(p.action, A_I_PLUME);
    assert_eq!(p.slot, 1);
    assert_eq!(trace[0].outcome, SlotOutcome::NotExecutable("Éther insuffisant"));
}

#[test]
fn t05_missing_item_is_skipped() {
    let mut s = setup();
    sim::kill(&mut s.b, s.kael, None);
    s.b.unit_mut(s.lysa).mp = 0.0;
    s.b.unit_mut(s.lysa).book = book(&[(AllyStatus(StatusId::Ko), A_RELEVE), (AllyStatus(StatusId::Ko), A_I_PLUME), (FoeNearestVisible, A_ATTACK)]);
    let p = decide(&s.b, s.lysa, None).unwrap();
    assert_eq!(p.action, A_ATTACK);
    assert_eq!(p.slot, 2);
}

#[test]
fn t06_disabled_slot_never_selected() {
    let mut s = setup();
    s.b.unit_mut(s.kael).hp = 10.0;
    let mut bk = book(&[(AllyHpBelow(50), A_SUTURE), (FoeNearestVisible, A_ATTACK)]);
    bk.postures[0].slots[0].enabled = false;
    s.b.unit_mut(s.lysa).book = bk;
    for _ in 0..10 {
        let p = decide(&s.b, s.lysa, None).unwrap();
        assert_ne!(p.slot, 0);
        assert_eq!(p.action, A_ATTACK);
    }
}

#[test]
fn t07_all_reflexes_disabled() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).book = book(&[(FoeNearestVisible, A_ATTACK)]);
    s.b.unit_mut(s.lysa).book.enabled = false;
    assert!(decide(&s.b, s.lysa, None).is_none());
    let hp_before = s.b.unit(s.foe).hp;
    // Les autres n'ont aucune règle : personne n'agit.
    run(&mut s.b, 3.0);
    assert!(s.b.unit(s.lysa).job.is_none());
    assert_eq!(s.b.unit(s.foe).hp, hp_before);
}

#[test]
fn t08_elemental_weakness() {
    let mut s = setup();
    let wyv = s.b.add_foe(F_WYVERN, 1, 260.0);
    s.b.unit_mut(s.lysa).book = book(&[(FoeWeak(Element::Fire), A_BRAISE), (FoeWeak(Element::Ice), A_GIVRE), (FoeNearestVisible, A_ATTACK)]);
    let mut tr = Vec::new();
    let p = decide(&s.b, s.lysa, Some(&mut tr)).unwrap();
    // Le soldat est faible à la foudre, pas au feu ; la vouivre est faible à la glace.
    assert_eq!(tr[0].outcome, SlotOutcome::NoTarget);
    assert_eq!((p.action, p.target), (A_GIVRE, wyv));
}

#[test]
fn t09_elemental_absorption() {
    let mut s = setup();
    let bomb = s.b.add_foe(F_BOMB, 1, 260.0);
    // Une absorption n'est PAS une faiblesse.
    s.b.unit_mut(s.kael).book = book(&[(FoeWeak(Element::Fire), A_BRAISE)]);
    assert!(decide(&s.b, s.kael, None).is_none());
    s.b.unit_mut(bomb).hp = 50.0;
    sim::apply(&mut s.b, s.kael, bomb, A_BRAISE, 1.0, false);
    assert!(s.b.unit(bomb).hp > 50.0, "le feu doit soigner une unité qui l'absorbe");
    // Le Naphte rend vulnérable sans créer de faiblesse explicite.
    let sold = s.foe;
    s.b.unit_mut(sold).statuses.apply(StatusId::Naphtha, None);
    assert!(s.b.unit(sold).element_mult(Element::Fire) > 1.0);
    let r = lumen_core::ai::resolve_targets(&s.b, s.kael, FoeWeak(Element::Fire));
    assert!(!r.contains(&sold));
    let r = lumen_core::ai::resolve_targets(&s.b, s.kael, FoeVulnerable(Element::Fire));
    assert!(r.contains(&sold));
}

#[test]
fn t10_leader_target() {
    let mut s = setup();
    let foe2 = s.b.add_foe(F_SOLDIER, 1, 500.0);
    s.b.unit_mut(s.kael).target = Some(foe2);
    s.b.unit_mut(s.nyra).book = book(&[(FoeLeaderTarget, A_ATTACK)]);
    let p = decide(&s.b, s.nyra, None).unwrap();
    assert_eq!(p.target, foe2);
    // Sans cible du meneur : pas d'invention de cible (8.2).
    s.b.unit_mut(s.kael).target = None;
    assert!(decide(&s.b, s.nyra, None).is_none());
}

#[test]
fn t11_target_dies_during_preparation() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).book = book(&[(FoeNearestVisible, A_GIVRE)]);
    run(&mut s.b, 0.3);
    let job = s.b.unit(s.lysa).job.expect("Lysa incante");
    assert_eq!(job.phase, Phase::Charge);
    sim::kill(&mut s.b, s.foe, None);
    run(&mut s.b, 0.1);
    assert!(s.b.unit(s.lysa).job.is_none(), "l'action doit être annulée proprement");
    let mp = s.b.unit(s.lysa).mp;
    assert_eq!(mp, s.b.unit(s.lysa).stats.max_mp, "pas de dépense pour une action annulée");
    // Nouvelle cible : le moteur repart sans blocage.
    let f2 = s.b.add_foe(F_SOLDIER, 1, 400.0);
    run(&mut s.b, 2.5);
    assert!(s.b.unit(f2).hp < s.b.unit(f2).max_hp());
}

#[test]
fn t12_mute_blocks_magic() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).statuses.apply(StatusId::Mute, None);
    s.b.unit_mut(s.lysa).book = book(&[(FoeNearestVisible, A_GIVRE), (FoeNearestVisible, A_ATTACK)]);
    let mut tr = Vec::new();
    let p = decide(&s.b, s.lysa, Some(&mut tr)).unwrap();
    assert_eq!(p.action, A_ATTACK);
    assert!(matches!(tr[0].outcome, SlotOutcome::NotExecutable(_)));
}

#[test]
fn t13_manual_command_overrides_reflex() {
    let mut s = setup();
    s.b.unit_mut(s.kael).hp = 100.0;
    s.b.unit_mut(s.lysa).book = book(&[(AllyHpBelow(90), A_SUTURE_PLUS)]);
    run(&mut s.b, 0.2);
    let j = s.b.unit(s.lysa).job.unwrap();
    assert_eq!(j.source, Source::Reflex(0));
    sim::issue_manual(&mut s.b, s.lysa, A_GIVRE, s.foe).unwrap();
    let j = s.b.unit(s.lysa).job.unwrap();
    assert_eq!((j.action, j.source), (A_GIVRE, Source::Manual));
    let hp = s.b.unit(s.foe).hp;
    run(&mut s.b, 2.0);
    assert!(s.b.unit(s.foe).hp < hp, "l'ordre manuel est réellement exécuté");
    // Après l'ordre, l'automatisation reprend (soin de Kael).
    run(&mut s.b, 4.0);
    assert!(s.b.unit(s.kael).hp > 100.0);
}

#[test]
fn t14_profile_switch() {
    let mut s = setup();
    let mut bk = book(&[(FoeNearestVisible, A_ATTACK)]);
    bk.postures[1] = Posture::from_rules(&[(FoeNearestVisible, A_GIVRE)]);
    s.b.unit_mut(s.lysa).book = bk;
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_ATTACK);
    s.b.unit_mut(s.lysa).book.active = 1;
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_GIVRE);
}

#[test]
fn t15_no_useless_heal() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).book = book(&[(AllyAny, A_SUTURE), (AllyHpBelow(100), A_SUTURE)]);
    assert!(decide(&s.b, s.lysa, None).is_none());
    // Même chose pour un bonus déjà présent.
    for id in [s.kael, s.nyra, s.lysa] {
        s.b.unit_mut(id).statuses.apply(StatusId::Aegis, None);
    }
    s.b.unit_mut(s.lysa).book = book(&[(AllyAny, A_EGIDE)]);
    assert!(decide(&s.b, s.lysa, None).is_none());
}

#[test]
fn t16_new_emergency() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).book = book(&[(AllyStatus(StatusId::Ko), A_RELEVE), (FoeNearestVisible, A_ATTACK)]);
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_ATTACK);
    sim::kill(&mut s.b, s.nyra, None);
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_RELEVE);
}

#[test]
fn t17_shared_inventory_no_duplication() {
    let mut s = setup();
    sim::kill(&mut s.b, s.kael, None);
    s.b.inventory.add(IT_PLUME, 1);
    let r = &[(AllyStatus(StatusId::Ko), A_I_PLUME)];
    s.b.unit_mut(s.lysa).book = book(r);
    s.b.unit_mut(s.nyra).book = book(r);
    s.b.unit_mut(s.foe).gone = true;
    run(&mut s.b, 0.1);
    let jobs = [s.lysa, s.nyra].iter().filter(|&&u| s.b.unit(u).job.is_some()).count();
    assert_eq!(jobs, 1, "une seule unité peut réserver la dernière plume");
    assert_eq!(s.b.inventory.reserved[IT_PLUME as usize], 1);
    run(&mut s.b, 3.0);
    assert_eq!(s.b.inventory.count[IT_PLUME as usize], 0);
    assert_eq!(s.b.inventory.reserved[IT_PLUME as usize], 0);
    assert!(s.b.unit(s.kael).alive());
}

#[test]
fn t18_no_valid_reflex_means_wait() {
    let mut s = setup();
    s.b.unit_mut(s.lysa).book = book(&[(AllyStatus(StatusId::Ko), A_RELEVE), (AllyHpBelow(50), A_SUTURE)]);
    assert!(decide(&s.b, s.lysa, None).is_none());
    let foe_hp = s.b.unit(s.foe).hp;
    let mp = s.b.unit(s.lysa).mp;
    run(&mut s.b, 2.0);
    assert_eq!(s.b.unit(s.foe).hp, foe_hp);
    assert_eq!(s.b.unit(s.lysa).mp, mp);
}

#[test]
fn t19_moves_into_range() {
    let mut s = setup();
    s.b.unit_mut(s.foe).pos.x = 1100.0;
    s.b.unit_mut(s.foe).engaged = true;
    s.b.unit_mut(s.kael).book = book(&[(FoeNearest, A_ATTACK)]);
    s.b.leader = Some(s.nyra);
    let x0 = s.b.unit(s.kael).pos.x;
    run(&mut s.b, 0.3);
    assert_eq!(s.b.unit(s.kael).job.unwrap().phase, Phase::Approach);
    let hp = s.b.unit(s.foe).hp;
    run(&mut s.b, 6.0);
    assert!(s.b.unit(s.kael).pos.x > x0 + 500.0, "Kael doit s'être rapproché");
    assert!(s.b.unit(s.foe).hp < hp, "puis avoir frappé");
}

#[test]
fn t19b_melee_cannot_reach_flying() {
    let mut s = setup();
    let drone = s.b.add_foe(F_DRONE, 1, 250.0);
    s.b.unit_mut(s.foe).gone = true;
    s.b.unit_mut(s.kael).book = book(&[(FoeFlying, A_ATTACK), (FoeFlying, A_ARC)]);
    let mut tr = Vec::new();
    let p = decide(&s.b, s.kael, Some(&mut tr)).unwrap();
    assert!(matches!(tr[0].outcome, SlotOutcome::NotExecutable(_)));
    assert_eq!((p.action, p.target), (A_ARC, drone));
}

#[test]
fn t20_long_battle_is_stable() {
    let mut b = Battle::new(7);
    let k = b.add_hero(T_KAEL, 8, 100.0);
    let n = b.add_hero(T_NYRA, 8, 150.0);
    let l = b.add_hero(T_LYSA, 8, 50.0);
    b.leader = Some(k);
    for (id, h) in [(k, T_KAEL), (n, T_NYRA), (l, T_LYSA)] {
        b.unit_mut(id).book = presets::hero_book(h);
    }
    b.inventory.add(IT_TONIQUE, 10);
    b.inventory.add(IT_PLUME, 3);
    b.inventory.add(IT_ANTIVENIN, 5);
    let boss = b.add_foe(F_SPIDER, 3, 900.0);
    b.unit_mut(boss).book = presets::foe_book(F_SPIDER);
    let mut adds = vec![];
    for i in 0..3 {
        let f = b.add_foe([F_HOUND, F_DRONE, F_WRAITH][i], 2, 700.0 + i as f32 * 120.0);
        b.unit_mut(f).book = presets::foe_book([F_HOUND, F_DRONE, F_WRAITH][i]);
        adds.push(f);
    }
    let inputs = [HumanInput::default(); 4];
    for step in 0..(180.0 / DT) as usize {
        sim::tick(&mut b, DT, &inputs);
        b.events.clear();
        if step % 900 == 450 {
            // Changements de posture en plein combat.
            let p = (step / 900) % 3;
            b.unit_mut(l).book.active = p;
        }
        if step % 1200 == 600 {
            // Renforts.
            let f = b.add_foe(F_SOLDIER, 2, 1500.0);
            b.unit_mut(f).book = presets::foe_book(F_SOLDIER);
        }
        for u in &b.units {
            assert!(u.pos.x.is_finite() && u.pos.y.is_finite(), "position invalide");
            assert!(u.hp.is_finite());
        }
        for i in 0..ITEM_COUNT {
            assert!(b.inventory.reserved[i] <= b.inventory.count[i] + 1);
        }
        if b.living_foes() == 0 || b.party_wiped() {
            break;
        }
    }
    // Lisible par l'outil de débogage.
    let lines = explain(&b, l);
    assert!(!lines.is_empty());
}

#[test]
fn human_controller_plays_combo() {
    let mut s = setup();
    s.b.unit_mut(s.kael).controller = Controller::Human(0);
    s.b.unit_mut(s.foe).pos.x = 170.0;
    let hp = s.b.unit(s.foe).hp;
    let mut inputs = [HumanInput::default(); 4];
    for f in 0..90 {
        inputs[0] = if f % 15 == 0 { HumanInput { held: lumen_core::sim::btn::X, pressed: lumen_core::sim::btn::X } } else { HumanInput::default() };
        sim::tick(&mut s.b, DT, &inputs);
    }
    assert!(s.b.unit(s.foe).hp < hp);
}

#[test]
fn serialization_roundtrip() {
    let mut bk = presets::hero_book(T_LYSA);
    bk.active = 2;
    bk.postures[0].slots[3].enabled = false;
    bk.postures[1].slots[0].rule.as_mut().unwrap().ext = ExtExpr::parse("and(self_mp_gt:20,not(target_flying))");
    let text = bk.serialize("lysa");
    let mut back = ReflexBook::default();
    for line in text.lines() {
        let parts: Vec<&str> = line.split('|').collect();
        assert!(back.apply_line(&parts), "ligne invalide : {line}");
    }
    assert_eq!(bk, back);
}

#[test]
fn catalog_codes_roundtrip() {
    for e in lumen_core::reflex::catalog() {
        let code = e.selector.code();
        assert_eq!(Selector::from_code(&code), Some(e.selector), "{code}");
        assert!(!e.selector.label().is_empty());
    }
    for (i, a) in ACTIONS.iter().enumerate() {
        assert_eq!(action_from_code(a.code), Some(i as ActionId), "code dupliqué {}", a.code);
    }
    assert_eq!(ACTIONS[A_KIT_ZAP as usize].code, "kit_zap");
    assert_eq!(ACTIONS[A_I_TONIQUE as usize].code, "i_tonique");
    assert_eq!(ACTIONS[A_U_KAEL as usize].code, "u_kael");
    for (i, it) in ITEMS.iter().enumerate() {
        assert_eq!(action(it.action).item, Some(i as ItemId));
    }
}

#[test]
fn extended_conditions_only_in_extended_mode() {
    let mut s = setup();
    s.b.unit_mut(s.kael).hp = 10.0;
    let mut bk = book(&[(AllyHpBelow(50), A_SUTURE), (FoeNearestVisible, A_ATTACK)]);
    bk.postures[0].slots[0].rule.as_mut().unwrap().ext = ExtExpr::parse("self_mp_gt:95");
    s.b.unit_mut(s.lysa).book = bk;
    s.b.unit_mut(s.lysa).mp = 10.0;
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_SUTURE, "mode fidèle : condition ignorée");
    s.b.settings.extended = true;
    assert_eq!(decide(&s.b, s.lysa, None).unwrap().action, A_ATTACK, "mode étendu : condition appliquée");
}

#[test]
fn determinism_same_seed_same_result() {
    let run_once = || {
        let mut b = Battle::new(99);
        let k = b.add_hero(T_KAEL, 5, 100.0);
        let l = b.add_hero(T_LYSA, 5, 60.0);
        b.leader = Some(k);
        b.unit_mut(k).book = presets::hero_book(T_KAEL);
        b.unit_mut(l).book = presets::hero_book(T_LYSA);
        for i in 0..3 {
            let f = b.add_foe(F_HOUND, 2, 500.0 + i as f32 * 90.0);
            b.unit_mut(f).book = presets::foe_book(F_HOUND);
        }
        run(&mut b, 20.0);
        b.units.iter().map(|u| (u.hp * 1000.0) as i64 + (u.pos.x * 10.0) as i64).sum::<i64>()
    };
    assert_eq!(run_once(), run_once());
}

#[test]
fn undead_hurt_by_healing() {
    let mut s = setup();
    let w = s.b.add_foe(F_WRAITH, 1, 260.0);
    s.b.unit_mut(s.lysa).book = book(&[(FoeUndead, A_SUTURE)]);
    let p = decide(&s.b, s.lysa, None).unwrap();
    assert_eq!(p.target, w);
    let hp = s.b.unit(w).hp;
    sim::apply(&mut s.b, s.lysa, w, A_SUTURE, 1.0, false);
    assert!(s.b.unit(w).hp < hp);
}

#[test]
fn mirror_reflects_and_revers_inverts() {
    let mut s = setup();
    s.b.unit_mut(s.foe).statuses.apply(StatusId::Mirror, None);
    let k_hp = s.b.unit(s.kael).hp;
    let foe_hp = s.b.unit(s.foe).hp;
    let total_before: f32 = [s.kael, s.nyra, s.lysa].iter().map(|&u| s.b.unit(u).hp).sum();
    sim::apply(&mut s.b, s.lysa, s.foe, A_GIVRE, 1.0, false);
    let total_after: f32 = [s.kael, s.nyra, s.lysa].iter().map(|&u| s.b.unit(u).hp).sum();
    assert_eq!(s.b.unit(s.foe).hp, foe_hp, "l'ennemi sous Miroir n'est pas touché");
    assert!(total_after < total_before, "le sort revient sur l'équipe");
    let _ = k_hp;
    // Revers : un soin blesse.
    s.b.unit_mut(s.nyra).hp = 200.0;
    s.b.unit_mut(s.nyra).statuses.apply(StatusId::Revers, None);
    sim::apply(&mut s.b, s.lysa, s.nyra, A_SUTURE, 1.0, false);
    assert!(s.b.unit(s.nyra).hp < 200.0);
}

#[test]
fn crystallized_units_are_not_targets() {
    // Régression : une statue de cristal « vivante » bloquait « ennemi le plus proche ».
    let mut s = setup();
    s.b.unit_mut(s.nyra).statuses.apply(StatusId::Crystal, None);
    s.b.unit_mut(s.nyra).pos.x = 250.0;
    s.b.unit_mut(s.foe).pos.x = 400.0;
    s.b.unit_mut(s.foe).book = book(&[(FoeNearest, A_ATTACK)]);
    let p = decide(&s.b, s.foe, None).expect("l'ennemi doit viser une cible valide");
    assert_ne!(p.target, s.nyra);
}
