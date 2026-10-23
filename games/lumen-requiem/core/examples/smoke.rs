use lumen_core::game::*; use lumen_core::render::Canvas; use lumen_core::sim::btn;
fn main(){
    let mut g = Game::new(5);
    let mut c = Canvas::default();
    let mut scenes = std::collections::BTreeMap::new();
    for f in 0..60*60*12u32 {
        let mut held = 0u16;
        // appuie sur A une frame sur 20, START parfois, attaque en combat
        if f % 20 == 0 { held |= btn::A; }
        if matches!(g.scene, Scene::Room) { held = if f%10<5 {btn::X|btn::RIGHT} else {btn::RIGHT}; if f%97==0 {held|=btn::B;} if f%300==0 {held|=btn::RT;} }
        if matches!(g.scene, Scene::Story{..}) && f%30==0 { held |= btn::START; }
        g.step(&[PlayerIn{held, cmd:0}, PlayerIn::default(), PlayerIn::default()]);
        if f % 7 == 0 { lumen_core::ui::render(&mut g, &mut c, 1280.0, 720.0); }
        if f % 13 == 0 { lumen_core::ui::render(&mut g, &mut c, 390.0, 844.0); }
        let name = format!("{:?}", g.scene).split(|c:char| !c.is_alphanumeric()).next().unwrap().to_string();
        *scenes.entry(name).or_insert(0u32) += 1;
        if matches!(g.scene, Scene::Room) && f % 600 == 0 { if let Some(r)=&g.run { if let Some(b)=&r.battle { println!("f{} sector{} layer{} foes{} wiped{}", f, r.sector, r.layer, b.living_foes(), b.party_wiped()); if b.living_foes()==1 { for u in &b.units { if !u.gone && u.alive() { println!("  {} x={:.0} y={:.0} eng={} job={:?} hp={:.0} trace={:?}", u.name,u.pos.x,u.pos.y,u.engaged,u.job.map(|j|(j.action,j.phase)),u.hp, u.last_trace.iter().map(|t|format!("{}:{:?}",t.slot,t.outcome)).collect::<Vec<_>>()); } } } } } }
    }
    println!("{:?} cmds={} save={}", scenes, c.cmds.len(), g.save_meta().len());
}
