use lumen_core::game::*; use lumen_core::sim::btn;
fn main(){
    let mut res = vec![];
    for seed in 1..=24u64 {
        let mut g = Game::new(seed);
        let mut toggled = false; let mut last_room = false;
        let mut f = 0u32; let mut last=(0usize,0usize,String::new()); let mut end = "timeout";
        while f < 60*60*40 {
            f += 1;
            if let Some(r)=&g.run { last=(r.sector,r.layer, r.room.map(|k|k.name().to_string()).unwrap_or_default()); }
            let mut held = 0u16;
            let in_room = matches!(g.scene, Scene::Room);
            if in_room && !last_room { toggled = false; }
            last_room = in_room;
            match &g.scene {
                Scene::Room => { if !toggled && f % 5 == 0 { held = btn::SELECT; toggled = true; } }
                Scene::Shop{..} => { if f % 20 == 0 { held = btn::B; } }
                Scene::Story{..} => { if f % 10 == 0 { held = btn::START; } }
                _ => { if f % 20 == 0 { held = btn::A; } }
            }
            g.step(&[PlayerIn{held, cmd:0}, PlayerIn::default(), PlayerIn::default()]);
            if matches!(g.scene, Scene::Victory{..}) { end = "WIN"; break; }
            if matches!(g.scene, Scene::GameOver{..}) { end = "LOSE"; break; }
        }
        if end=="timeout" { println!("seed {} scene {:?}", seed, format!("{:?}", g.scene).chars().take(30).collect::<String>()); if let Some(b)=g.battle(){ for u in &b.units { if !u.gone { println!("  gauge{:.2} dcd{:.2} stun{:.2} cast{} manual{:?} st{:?} cd{:?} spcd{:.1}", u.gauge,u.decide_cd,u.hitstun,u.statuses.can_act(),u.manual,lumen_core::status::StatusId::ALL.iter().filter(|s|u.statuses.has(**s)).map(|s|s.code()).collect::<Vec<_>>(),u.cooldowns,u.special_cd); println!("  {} {} hp{:.0} x{:.0} y{:.0} eng{} job{:?} trace{:?}", u.name, if u.alive(){"A"}else{"K"}, u.hp,u.pos.x,u.pos.y,u.engaged,u.job.map(|j|(j.action,j.phase)), u.last_trace.iter().map(|t|format!("{:?}",t.outcome)).collect::<Vec<_>>().join(",").chars().take(160).collect::<String>()); } } } }
        if let Some(b)=g.battle(){ println!("inv count{:?} res{:?} t{:.0} cin{:.2} hitstop{:.2}", b.inventory.count,b.inventory.reserved,b.time,b.cinematic,b.hitstop); }
        let (s,l) = g.run.as_ref().map(|r|(r.sector,r.layer)).unwrap_or((9,9));
        let _=(s,l); res.push((seed,end,last.0,last.1,last.2.clone()));
    }
    for r in &res { println!("{:?}", r); }
}
