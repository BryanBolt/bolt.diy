//! Effets visuels (purement cosmétiques, n'influencent jamais la simulation).

use crate::rng::Rng;
use crate::types::Vec2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PKind {
    Spark,
    Glow,
    Ring,
    Slash,
    Text,
    Bolt,
    Shard,
    Rune,
    Pillar,
    Leaf,
}

#[derive(Clone, Debug)]
pub struct Particle {
    pub kind: PKind,
    pub pos: Vec2,
    pub vel: Vec2,
    pub life: f32,
    pub max: f32,
    pub size: f32,
    pub color: u32,
    pub angle: f32,
    pub spin: f32,
    pub gravity: f32,
    pub text: Option<String>,
    pub big: bool,
}

#[derive(Clone, Debug)]
pub struct Banner {
    pub text: String,
    pub sub: String,
    pub t: f32,
    pub max: f32,
    pub color: u32,
}

pub struct Fx {
    pub parts: Vec<Particle>,
    pub shake: f32,
    pub flash: f32,
    pub flash_color: u32,
    pub rng: Rng,
    pub banners: Vec<Banner>,
    /// Cinématique d'arcane ultime : (nom, couleur, temps restant, total).
    pub ult: Option<(String, u32, f32, f32)>,
    pub time: f32,
}

impl Default for Fx {
    fn default() -> Self {
        Fx { parts: Vec::new(), shake: 0.0, flash: 0.0, flash_color: 0xffffff, rng: Rng::new(1234), banners: Vec::new(), ult: None, time: 0.0 }
    }
}

impl Fx {
    pub fn clear(&mut self) {
        self.parts.clear();
        self.banners.clear();
        self.ult = None;
        self.shake = 0.0;
        self.flash = 0.0;
    }

    fn p(&mut self, kind: PKind, pos: Vec2, vel: Vec2, life: f32, size: f32, color: u32) -> &mut Particle {
        self.parts.push(Particle { kind, pos, vel, life, max: life, size, color, angle: 0.0, spin: 0.0, gravity: 0.0, text: None, big: false });
        self.parts.last_mut().unwrap()
    }

    pub fn burst(&mut self, pos: Vec2, color: u32, n: usize, speed: f32, size: f32) {
        for _ in 0..n {
            let a = self.rng.range(0.0, std::f32::consts::TAU);
            let s = self.rng.range(speed * 0.3, speed);
            let life = self.rng.range(0.25, 0.6);
            let sz = self.rng.range(size * 0.5, size);
            let p = self.p(PKind::Spark, pos, Vec2::new(a.cos() * s, a.sin() * s), life, sz, color);
            p.gravity = -600.0;
        }
    }

    pub fn glow(&mut self, pos: Vec2, color: u32, size: f32, life: f32) {
        self.p(PKind::Glow, pos, Vec2::default(), life, size, color);
    }

    pub fn ring(&mut self, pos: Vec2, color: u32, size: f32, life: f32) {
        self.p(PKind::Ring, pos, Vec2::default(), life, size, color);
    }

    pub fn slash(&mut self, pos: Vec2, color: u32, facing: f32, size: f32) {
        let a = if facing >= 0.0 { -0.4 } else { std::f32::consts::PI + 0.4 };
        let p = self.p(PKind::Slash, pos, Vec2::default(), 0.22, size, color);
        p.angle = a;
        p.spin = facing;
    }

    pub fn bolt(&mut self, from: Vec2, to: Vec2, color: u32) {
        let seed = self.rng.range(0.0, 100.0);
        let p = self.p(PKind::Bolt, from, Vec2::new(to.x - from.x, to.y - from.y), 0.25, 3.0, color);
        p.angle = seed;
    }

    pub fn rune(&mut self, pos: Vec2, color: u32, size: f32, life: f32) {
        let p = self.p(PKind::Rune, pos, Vec2::default(), life, size, color);
        p.spin = 1.5;
    }

    pub fn pillar(&mut self, pos: Vec2, color: u32, size: f32) {
        self.p(PKind::Pillar, pos, Vec2::default(), 0.6, size, color);
    }

    pub fn shards(&mut self, pos: Vec2, color: u32, n: usize) {
        for _ in 0..n {
            let a = self.rng.range(-2.6, -0.5);
            let s = self.rng.range(200.0, 520.0);
            let sz = self.rng.range(4.0, 9.0);
            let p = self.p(PKind::Shard, pos, Vec2::new(a.cos() * s, -a.sin() * s), 0.7, sz, color);
            p.gravity = -1400.0;
            p.spin = 9.0;
        }
    }

    pub fn leaves(&mut self, pos: Vec2, color: u32, n: usize) {
        for _ in 0..n {
            let vx = self.rng.range(-80.0, 80.0);
            let vy = self.rng.range(60.0, 220.0);
            let life = self.rng.range(0.8, 1.4);
            let p = self.p(PKind::Leaf, Vec2::new(pos.x + vx * 0.3, pos.y), Vec2::new(vx, vy), life, 5.0, color);
            p.spin = 4.0;
        }
    }

    pub fn text(&mut self, pos: Vec2, s: String, color: u32, big: bool) {
        let jitter = self.rng.range(-18.0, 18.0);
        let p = self.p(PKind::Text, Vec2::new(pos.x + jitter, pos.y), Vec2::new(0.0, 240.0), if big { 1.1 } else { 0.85 }, if big { 34.0 } else { 24.0 }, color);
        p.text = Some(s);
        p.big = big;
        p.gravity = -520.0;
    }

    pub fn banner(&mut self, text: &str, sub: &str, color: u32, dur: f32) {
        self.banners.push(Banner { text: text.into(), sub: sub.into(), t: 0.0, max: dur, color });
    }

    pub fn update(&mut self, dt: f32) {
        self.time += dt;
        self.shake = (self.shake - dt * 2.5).max(0.0);
        self.flash = (self.flash - dt * 3.0).max(0.0);
        for p in self.parts.iter_mut() {
            p.life -= dt;
            p.vel.y += p.gravity * dt;
            p.pos.x += p.vel.x * dt * if p.kind == PKind::Bolt { 0.0 } else { 1.0 };
            p.pos.y += p.vel.y * dt * if p.kind == PKind::Bolt { 0.0 } else { 1.0 };
            p.angle += p.spin * dt;
            if p.kind == PKind::Text {
                p.vel.y *= (-3.0 * dt).exp();
            }
        }
        self.parts.retain(|p| p.life > 0.0);
        if self.parts.len() > 900 {
            let n = self.parts.len() - 900;
            self.parts.drain(0..n);
        }
        for b in self.banners.iter_mut() {
            b.t += dt;
        }
        self.banners.retain(|b| b.t < b.max);
        if let Some(u) = self.ult.as_mut() {
            u.2 -= dt;
            if u.2 <= 0.0 {
                self.ult = None;
            }
        }
    }
}
