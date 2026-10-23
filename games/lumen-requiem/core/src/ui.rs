//! GambitUI / HUD / menus / rendu du monde. Ne modifie jamais la simulation
//! (seule la caméra, purement visuelle, est mise à jour ici).

use std::f32::consts::{PI, TAU};

use crate::ai;
use crate::analyzer::{self, Severity};
use crate::battle::{Battle, Controller, Phase, Source, TplRef, Unit};
use crate::data::*;
use crate::fx::PKind;
use crate::game::*;
use crate::reflex::{Group, SlotOutcome, MAX_SLOTS, POSTURE_NAMES};
use crate::render::{mix, Align, Canvas, Rect};
use crate::status::StatusId;
use crate::story;
use crate::types::{Team, Vec2};

const CYAN: u32 = 0x5ad1c9;
const GOLD: u32 = 0xffd25a;
const WHITE: u32 = 0xf2f6ff;
const DIM: u32 = 0x8b95a8;
const RED: u32 = 0xff5a6a;
const GREEN: u32 = 0x7dffb0;
pub const PLAYER_COLORS: [u32; 3] = [0x5ad1ff, 0xff7ad1, 0xffd25a];

fn hsh(i: u32) -> f32 {
    let mut x = i.wrapping_mul(0x9E37_79B9) ^ 0x85EB_CA6B;
    x ^= x >> 15;
    x = x.wrapping_mul(0x2C1B_3C6D);
    x ^= x >> 12;
    (x & 0xffff) as f32 / 65535.0
}

pub struct View {
    pub s: f32,
    pub cx: f32,
    pub ox: f32,
    pub gy: f32,
    pub shx: f32,
    pub shy: f32,
}

impl View {
    pub fn x(&self, wx: f32) -> f32 {
        (wx - self.cx) * self.s + self.ox + self.shx
    }
    pub fn y(&self, wy: f32) -> f32 {
        self.gy - wy * self.s + self.shy
    }
}

pub fn render(g: &mut Game, c: &mut Canvas, w: f32, h: f32) {
    c.begin(w, h);
    let t = g.time;
    match g.scene.clone() {
        Scene::Title => draw_title(g, c, t),
        Scene::HowTo => draw_howto(c, t),
        Scene::Lobby => draw_lobby(g, c, t),
        Scene::Story { sc, idx, chars, .. } => draw_story(g, c, sc, idx, chars, t),
        Scene::Map => draw_map(g, c, t),
        Scene::Room => draw_room(g, c, t),
        Scene::Reward { choices } => draw_reward(g, c, &choices, t),
        Scene::Shop { stock } => draw_shop(g, c, &stock, t),
        Scene::Rest => draw_rest(g, c, t),
        Scene::GameOver { t: tt, frags } => draw_end(c, false, frags, tt, t),
        Scene::Victory { t: tt, frags } => draw_end(c, true, frags, tt, t),
        Scene::Sanctuary => draw_sanctuary(g, c, t),
    }
    let ovs = g.overlays.clone();
    for o in &ovs {
        match o {
            Overlay::Pause { cursor, .. } => draw_pause(g, c, *cursor),
            Overlay::Editor(ed) => draw_editor(g, c, ed, t),
            Overlay::Command(cm) => draw_command(g, c, cm),
        }
    }
    draw_screen_fx(g, c);
    if let Some((s, tt)) = &g.toast {
        let u = c.ui;
        let a = (tt * 3.0).min(1.0);
        let wd = (s.chars().count() as f32 * 10.5 * u + 40.0 * u).min(w - 20.0);
        let r = Rect::new((w - wd) * 0.5, 14.0 * u, wd, 40.0 * u);
        c.rrect(r, 20.0 * u, 0x0b1222, 0.9 * a);
        c.stroke(r, 20.0 * u, 1.5 * u, CYAN, 0.7 * a);
        c.text(s, w * 0.5, r.y + r.h * 0.5, 17.0 * u, WHITE, a, Align::Center, false);
    }
}

// ---------------------------------------------------------------------------
// Décors
// ---------------------------------------------------------------------------

fn draw_backdrop(c: &mut Canvas, v: &View, sector: usize, t: f32) {
    let (w, h) = (c.w, c.h);
    let (top, bot, glow) = match sector {
        0 => (0x050b14, 0x123a3a, 0x3cff9a),
        1 => (0x070616, 0x2a2060, 0x7aa8ff),
        _ => (0x12030c, 0x5a1430, 0xff6a3a),
    };
    c.grad(0.0, 0.0, w, v.gy + 4.0, top, bot, 1.0);
    // Lune / source de lumière
    c.blend(1);
    c.radial(w * 0.78, v.gy * 0.28, 220.0 * v.s, glow, 0.18);
    c.blend(0);
    // Couche lointaine
    let far = 0.18;
    let seg = 140.0;
    let start = ((v.cx * far - w / v.s) / seg).floor() as i32;
    for i in start..start + (w / (seg * v.s * 0.9)) as i32 + 6 {
        let wx = i as f32 * seg;
        let sx = (wx - v.cx * far) * v.s + v.ox;
        let hh = (180.0 + hsh(i as u32 * 7 + sector as u32) * 260.0) * v.s;
        let col = mix(top, bot, 0.35);
        match sector {
            2 => c.tri([(sx, v.gy), (sx + seg * v.s * 0.5, v.gy - hh * 1.2), (sx + seg * v.s * 1.1, v.gy)], col, 1.0),
            _ => c.rect(sx, v.gy - hh, seg * v.s * 0.82, hh, col, 1.0),
        }
    }
    // Couche moyenne
    let mid = 0.45;
    let seg = 190.0;
    let start = ((v.cx * mid - w / v.s) / seg).floor() as i32;
    for i in start..start + (w / (seg * v.s * 0.9)) as i32 + 6 {
        let wx = i as f32 * seg;
        let sx = (wx - v.cx * mid) * v.s + v.ox;
        let hh = (120.0 + hsh(i as u32 * 13 + 3 + sector as u32) * 200.0) * v.s;
        let col = mix(top, bot, 0.6);
        match sector {
            0 => {
                c.rect(sx, v.gy - hh, seg * v.s * 0.7, hh, col, 1.0);
                for k in 0..5 {
                    if hsh(i as u32 * 31 + k) > 0.55 {
                        let wy = v.gy - hh + (12.0 + k as f32 * 22.0) * v.s;
                        if wy < v.gy - 6.0 {
                            c.rect(sx + 10.0 * v.s, wy, 8.0 * v.s, 6.0 * v.s, 0xffe08a, 0.5);
                        }
                    }
                }
                // tuyaux de lumen
                if i % 3 == 0 {
                    c.rect(sx, v.gy - hh * 0.6, seg * v.s, 6.0 * v.s, 0x2a8a6a, 0.8);
                    c.blend(1);
                    c.rect(sx, v.gy - hh * 0.6 + 1.0 * v.s, seg * v.s, 2.0 * v.s, 0x5affb0, 0.35 + 0.2 * (t * 2.0 + i as f32).sin());
                    c.blend(0);
                }
            }
            1 => {
                c.rect(sx, v.gy - hh * 1.4, seg * v.s * 0.4, hh * 1.4, col, 1.0);
                c.blend(1);
                c.rect(sx + seg * v.s * 0.18, v.gy - hh * 1.4, 2.0 * v.s, hh * 1.4, 0x7aa8ff, 0.25);
                c.blend(0);
            }
            _ => {
                c.tri([(sx, v.gy), (sx + seg * v.s * 0.35, v.gy - hh), (sx + seg * v.s * 0.7, v.gy)], col, 1.0);
            }
        }
    }
    // Colonne de lumen (secteur 3)
    if sector == 2 {
        let sx = (2600.0 - v.cx * 0.3) * v.s + v.ox;
        c.blend(1);
        c.grad(sx - 60.0 * v.s, 0.0, 120.0 * v.s, v.gy, 0x3cff9a, 0x0a3a20, 0.35);
        c.blend(0);
    }
    // Brume
    c.grad(0.0, v.gy - 120.0 * v.s, w, 120.0 * v.s, bot, mix(bot, glow, 0.15), 0.35);
    // Sol
    let ground = match sector {
        0 => 0x15201f,
        1 => 0x15142a,
        _ => 0x24101a,
    };
    c.rect(0.0, v.gy, w, h - v.gy, ground, 1.0);
    c.rect(0.0, v.gy, w, 3.0 * v.s, mix(ground, glow, 0.5), 1.0);
    let tile = 120.0;
    let start = ((v.cx - w / v.s) / tile).floor() as i32;
    for i in start..start + (w / (tile * v.s)) as i32 + 4 {
        let sx = v.x(i as f32 * tile);
        c.line(sx, v.gy, sx - 30.0 * v.s, h, 1.0, mix(ground, glow, 0.18), 0.6);
    }
}

// ---------------------------------------------------------------------------
// Unités
// ---------------------------------------------------------------------------

fn hair_color(tpl: TplRef) -> u32 {
    match tpl {
        TplRef::Hero(T_KAEL) => 0xdfe6f2,
        TplRef::Hero(T_NYRA) => 0x2a1018,
        TplRef::Hero(T_LYSA) => 0x9a4a3a,
        _ => 0xcccccc,
    }
}

/// Angle de l'arme selon l'action en cours.
fn swing(u: &Unit) -> (f32, f32) {
    match u.job {
        Some(j) => {
            let a = action(j.action);
            match j.phase {
                Phase::Charge if a.cast > 0.2 => (-2.2, 1.0),
                Phase::Execute { .. } => {
                    let anim = if j.source == Source::Direct && j.action == A_ATTACK { 0.26 } else { a.anim };
                    let p = (j.t / anim).clamp(0.0, 1.0);
                    let combo_flip = if j.combo == 1 { -1.0 } else { 1.0 };
                    if a.magic || a.kind == ActionKind::Item {
                        (-2.0, 1.0)
                    } else if matches!(a.fx, Fx::Thrust | Fx::Punch) {
                        (0.0, 1.0 + (p * PI).sin() * 0.6)
                    } else if a.launch > 0.0 {
                        (1.2 - p * 3.0, 1.0)
                    } else {
                        (combo_flip * (-1.9 + p * 3.2), 1.0)
                    }
                }
                Phase::Recover => (0.9, 1.0),
                _ => (0.5, 1.0),
            }
        }
        None => (0.55 + (u.anim_t * 2.0).sin() * 0.05, 1.0),
    }
}

fn draw_humanoid(c: &mut Canvas, v: &View, u: &Unit, t: f32, alpha: f32) {
    let k = v.s * u.tpl.tpl().scale;
    let x = v.x(u.pos.x);
    let y = v.y(u.pos.y);
    let f = u.facing;
    let tpl = u.tpl.tpl();
    let flash = (u.hit_flash / 0.14).clamp(0.0, 1.0);
    let body = mix(tpl.color, 0xffffff, flash);
    let skin = mix(0xf3d2b8, 0xffffff, flash);
    let moving = u.vel.x.abs() > 30.0 && u.on_ground;
    let ph = if moving { (t * 13.0 + u.id as f32).sin() } else { 0.0 };
    let air = !u.on_ground && !u.flying;
    let hip = y - 34.0 * k;
    // Jambes
    let leg = |c: &mut Canvas, s: f32| {
        let (lx, ly) = if air { (x + s * 8.0 * k - f * 6.0 * k, y - 10.0 * k) } else { (x + (s * 6.0 + ph * s * 12.0) * k, y) };
        c.line(x + s * 5.0 * k, hip, lx, ly, 8.0 * k, mix(0x1a1d2a, 0xffffff, flash * 0.6), alpha);
    };
    leg(c, -1.0);
    leg(c, 1.0);
    // Cape / robe
    match u.tpl {
        TplRef::Hero(T_KAEL) => {
            let wave = (t * 5.0).sin() * 4.0 * k;
            c.poly(&[(x - f * 4.0 * k, y - 70.0 * k), (x - f * 26.0 * k, y - 14.0 * k + wave), (x - f * 6.0 * k, y - 22.0 * k)], 0x1a2440, alpha);
        }
        TplRef::Hero(T_LYSA) => {
            c.poly(&[(x - 13.0 * k, y - 66.0 * k), (x + 13.0 * k, y - 66.0 * k), (x + 22.0 * k, y - 18.0 * k), (x - 22.0 * k, y - 18.0 * k)], body, alpha);
        }
        _ => {}
    }
    // Torse
    c.rrect(Rect::new(x - 12.0 * k, y - 72.0 * k, 24.0 * k, 40.0 * k), 8.0 * k, body, alpha);
    c.rect(x - 12.0 * k, y - 40.0 * k, 24.0 * k, 4.0 * k, tpl.accent, alpha * 0.9);
    // Tête
    let hy = y - 88.0 * k;
    c.circle(x, hy, 15.0 * k, skin, alpha);
    c.rect(x + f * 5.0 * k - 2.0 * k, hy - 3.0 * k, 4.0 * k, 5.0 * k, 0x1a1a2a, alpha);
    // Cheveux
    let hc = mix(hair_color(u.tpl), 0xffffff, flash);
    match u.tpl {
        TplRef::Hero(T_KAEL) => {
            let pts = [
                (x - f * 16.0 * k, hy + 4.0 * k),
                (x - f * 30.0 * k, hy - 10.0 * k),
                (x - f * 12.0 * k, hy - 12.0 * k),
                (x - f * 20.0 * k, hy - 28.0 * k),
                (x - f * 2.0 * k, hy - 16.0 * k),
                (x + f * 6.0 * k, hy - 32.0 * k),
                (x + f * 10.0 * k, hy - 14.0 * k),
                (x + f * 22.0 * k, hy - 20.0 * k),
                (x + f * 16.0 * k, hy - 4.0 * k),
            ];
            c.poly(&pts, hc, alpha);
        }
        TplRef::Hero(T_NYRA) => {
            c.ellipse(x - f * 2.0 * k, hy - 8.0 * k, 17.0 * k, 11.0 * k, 0.0, hc, alpha);
            let sway = (t * 6.0).sin() * 5.0 * k;
            c.poly(&[(x - f * 12.0 * k, hy - 10.0 * k), (x - f * 34.0 * k, hy + 18.0 * k + sway), (x - f * 26.0 * k, hy + 26.0 * k + sway), (x - f * 8.0 * k, hy - 2.0 * k)], hc, alpha);
        }
        TplRef::Hero(T_LYSA) => {
            c.ellipse(x - f * 3.0 * k, hy - 6.0 * k, 18.0 * k, 13.0 * k, 0.0, hc, alpha);
            c.poly(&[(x - f * 14.0 * k, hy - 4.0 * k), (x - f * 20.0 * k, hy + 30.0 * k), (x - f * 6.0 * k, hy + 24.0 * k)], hc, alpha);
            c.circle(x - f * 12.0 * k, hy - 14.0 * k, 5.0 * k, 0xfff2c8, alpha);
        }
        _ => {
            // Soldat / chevalier : casque à visière lumineuse
            c.ellipse(x, hy - 2.0 * k, 17.0 * k, 15.0 * k, 0.0, mix(tpl.color, 0x000000, 0.2), alpha);
            c.blend(1);
            c.rect(x + f * 2.0 * k - 8.0 * k, hy - 3.0 * k, 16.0 * k, 4.0 * k, tpl.accent, alpha);
            c.blend(0);
        }
    }
    // Bras + arme
    let (ang, ext) = swing(u);
    let sx = x + f * 6.0 * k;
    let sy = y - 64.0 * k;
    let dir = (ang.cos() * f, ang.sin());
    let hx = sx + dir.0 * 22.0 * k * ext;
    let hyy = sy + dir.1 * 22.0 * k * ext;
    c.line(sx, sy, hx, hyy, 7.0 * k, body, alpha);
    let glowc = match u.tpl {
        TplRef::Hero(T_KAEL) => 0x9fd8ff,
        TplRef::Hero(T_LYSA) => 0xfff2c8,
        _ => tpl.accent,
    };
    match u.tpl.tpl().shape {
        Shape::Hero | Shape::Knight | Shape::Seraph => {
            let len = if u.tpl.tpl().shape == Shape::Seraph { 120.0 } else { 70.0 } * k;
            let ex = hx + dir.0 * len;
            let ey = hyy + dir.1 * len;
            c.line(hx, hyy, ex, ey, 6.0 * k, 0xdfe8f5, alpha);
            c.blend(1);
            c.glow(12.0 * k, glowc);
            c.line(hx, hyy, ex, ey, 2.5 * k, glowc, alpha * 0.9);
            c.glow(0.0, 0);
            c.blend(0);
        }
        Shape::Brawler => {
            c.circle(hx, hyy, 8.0 * k, tpl.accent, alpha);
            c.circle(x - f * 6.0 * k, y - 50.0 * k, 7.0 * k, tpl.accent, alpha);
        }
        Shape::Sage => {
            let ex = hx + dir.0 * 10.0 * k;
            c.line(ex, hyy - 50.0 * k, ex, hyy + 30.0 * k, 4.0 * k, 0x8a6a3a, alpha);
            c.blend(1);
            c.radial(ex, hyy - 54.0 * k, 16.0 * k, 0xfff2c8, alpha * 0.9);
            c.blend(0);
        }
        Shape::Soldier => {
            c.line(hx - dir.0 * 10.0 * k, hyy, hx + dir.0 * 40.0 * k, hyy + dir.1 * 40.0 * k, 7.0 * k, 0x2a2f3a, alpha);
        }
        _ => {}
    }
    if u.guard {
        c.blend(1);
        c.ring(x + f * 20.0 * k, y - 50.0 * k, 46.0 * k, 4.0 * k, 0x7ad7ff, 0.8, -1.2 + if f < 0.0 { PI } else { 0.0 }, 1.2 + if f < 0.0 { PI } else { 0.0 });
        c.blend(0);
    }
}

fn draw_ko(c: &mut Canvas, v: &View, u: &Unit) {
    let k = v.s * u.tpl.tpl().scale;
    let x = v.x(u.pos.x);
    let y = v.y(0.0);
    let tpl = u.tpl.tpl();
    c.ellipse(x, y - 8.0 * k, 34.0 * k, 9.0 * k, 0.0, tpl.color, 0.9);
    c.circle(x + 38.0 * k, y - 10.0 * k, 12.0 * k, 0xf3d2b8, 0.9);
    c.text("À TERRE", x, y - 34.0 * k, 12.0 * v.s.max(0.8), RED, 0.9, Align::Center, true);
}

fn draw_monster(c: &mut Canvas, v: &View, u: &Unit, t: f32) {
    let tpl = u.tpl.tpl();
    let k = v.s * tpl.scale;
    let x = v.x(u.pos.x);
    let y = v.y(u.pos.y);
    let f = u.facing;
    let alpha = if u.ko() { (1.0 - u.fade).clamp(0.0, 1.0) } else { 1.0 };
    let flash = (u.hit_flash / 0.14).clamp(0.0, 1.0);
    let col = mix(tpl.color, 0xffffff, flash);
    let acc = tpl.accent;
    let ph = t * 3.0 + u.id as f32;
    match tpl.shape {
        Shape::Soldier | Shape::Knight | Shape::Seraph => {
            if tpl.shape == Shape::Seraph {
                // Ailes déchirées
                let flap = (t * 2.2).sin() * 10.0 * k;
                for s in [-1.0f32, 1.0] {
                    let bx = x - f * 6.0 * k;
                    let by = y - 70.0 * k;
                    c.poly(&[(bx, by), (bx + s * 120.0 * k, by - 90.0 * k - flap), (bx + s * 150.0 * k, by - 10.0 * k), (bx + s * 100.0 * k, by + 10.0 * k), (bx + s * 120.0 * k, by + 50.0 * k + flap), (bx + s * 20.0 * k, by + 20.0 * k)], 0x0b0b16, alpha * 0.95);
                }
                c.blend(1);
                c.ring(x, y - 118.0 * k, 16.0 * k, 3.0 * k, 0xe8e8ff, alpha * 0.7, 0.0, TAU);
                c.blend(0);
                // cheveux longs
                c.poly(&[(x - 14.0 * k, y - 96.0 * k), (x + 14.0 * k, y - 100.0 * k), (x - f * 30.0 * k, y - 20.0 * k), (x - f * 40.0 * k, y - 30.0 * k)], 0xe0e4f0, alpha);
            }
            draw_humanoid(c, v, u, t, alpha);
        }
        Shape::Drone => {
            let r = 26.0 * k;
            c.circle(x, y - 40.0 * k, r, col, alpha);
            c.ring(x, y - 40.0 * k, r + 6.0 * k, 3.0 * k, 0x3a4a5a, alpha, 0.0, TAU);
            let rot = t * 30.0;
            c.line(x - 36.0 * k * rot.cos(), y - 72.0 * k, x + 36.0 * k * rot.cos(), y - 72.0 * k, 3.0 * k, 0xc0c8d0, alpha);
            c.line(x, y - 66.0 * k, x, y - 72.0 * k, 3.0 * k, 0xc0c8d0, alpha);
            c.blend(1);
            c.radial(x + f * 10.0 * k, y - 40.0 * k, 14.0 * k, acc, alpha);
            c.blend(0);
        }
        Shape::KitDrone => {
            let r = 20.0 * k;
            c.circle(x, y - 40.0 * k, r, col, alpha);
            c.circle(x + f * 6.0 * k, y - 42.0 * k, 7.0 * k, 0x0a1a1a, alpha);
            c.circle(x + f * 8.0 * k, y - 44.0 * k, 3.0 * k, 0xffffff, alpha);
            c.line(x, y - 60.0 * k, x - f * 6.0 * k, y - 76.0 * k, 2.0 * k, 0xffffff, alpha);
            c.blend(1);
            c.circle(x - f * 6.0 * k, y - 78.0 * k, 4.0 * k, 0x7dffb0, alpha * (0.6 + 0.4 * (t * 6.0).sin()));
            c.blend(0);
        }
        Shape::Hound => {
            let run = if u.vel.x.abs() > 30.0 { (t * 16.0).sin() } else { 0.0 };
            for s in [-1.0f32, 1.0] {
                c.line(x + s * 16.0 * k, y - 22.0 * k, x + s * 16.0 * k + run * s * 10.0 * k, y, 6.0 * k, col, alpha);
                c.line(x + s * 6.0 * k, y - 22.0 * k, x + s * 6.0 * k - run * s * 10.0 * k, y, 6.0 * k, col, alpha);
            }
            c.ellipse(x, y - 30.0 * k, 32.0 * k, 14.0 * k, 0.0, col, alpha);
            c.ellipse(x + f * 34.0 * k, y - 38.0 * k, 14.0 * k, 11.0 * k, 0.0, col, alpha);
            c.blend(1);
            for i in 0..4 {
                let sx = x - f * (i as f32 * 10.0 - 10.0) * k;
                c.tri([(sx - 4.0 * k, y - 42.0 * k), (sx, y - 56.0 * k), (sx + 4.0 * k, y - 42.0 * k)], acc, alpha * 0.8);
            }
            c.circle(x + f * 40.0 * k, y - 40.0 * k, 3.0 * k, acc, alpha);
            c.blend(0);
        }
        Shape::Bomb => {
            let fl = 1.0 + (t * 14.0 + u.id as f32).sin() * 0.06;
            c.blend(1);
            c.radial(x, y - 40.0 * k, 56.0 * k * fl, 0xff8a2a, alpha * 0.7);
            c.blend(0);
            c.circle(x, y - 40.0 * k, 26.0 * k * fl, col, alpha);
            c.circle(x - 8.0 * k, y - 46.0 * k, 5.0 * k, 0x2a0a00, alpha);
            c.circle(x + 8.0 * k, y - 46.0 * k, 5.0 * k, 0x2a0a00, alpha);
            c.ring(x, y - 34.0 * k, 8.0 * k, 3.0 * k, 0x2a0a00, alpha, 0.2, PI - 0.2);
            if let Some(cd) = u.cooldowns.iter().find(|c| c.0 == A_E_SELF_DESTRUCT) {
                if cd.1 > 0.0 && cd.1 < 5.0 {
                    c.text(&format!("{}", cd.1.ceil() as i32), x, y - 86.0 * k, 18.0 * v.s, 0xffee88, alpha, Align::Center, true);
                }
            }
        }
        Shape::Spider => {
            for i in 0..6 {
                let s = if i % 2 == 0 { -1.0 } else { 1.0 };
                let off = (i / 2) as f32 * 30.0 - 30.0;
                let lift = ((t * 8.0 + i as f32).sin() * 0.5 + 0.5) * 10.0 * k;
                let kx = x + (off + s * 40.0) * k;
                let ky = y - 60.0 * k - lift;
                c.line(x + off * k, y - 40.0 * k, kx, ky, 7.0 * k, 0x2a333c, alpha);
                c.line(kx, ky, kx + s * 22.0 * k, y, 6.0 * k, 0x2a333c, alpha);
            }
            c.ellipse(x, y - 46.0 * k, 52.0 * k, 26.0 * k, 0.0, col, alpha);
            c.rrect(Rect::new(x + f * 28.0 * k - 16.0 * k, y - 70.0 * k, 32.0 * k, 18.0 * k), 4.0 * k, 0x3a444e, alpha);
            c.line(x + f * 40.0 * k, y - 62.0 * k, x + f * 74.0 * k, y - 66.0 * k, 7.0 * k, 0x2a333c, alpha);
            c.blend(1);
            for i in 0..3 {
                c.circle(x + f * (20.0 + i as f32 * 9.0) * k, y - 52.0 * k, 4.0 * k, acc, alpha * (0.6 + 0.4 * (ph * 2.0 + i as f32).sin()));
            }
            c.blend(0);
        }
        Shape::Wraith => {
            let mut pts = Vec::new();
            for i in 0..=12 {
                let a = i as f32 / 12.0 * PI;
                let r = 28.0 * k;
                pts.push((x + a.cos() * r, y - 60.0 * k - a.sin() * r * 1.3));
            }
            for i in 0..=6 {
                let tx = x - 28.0 * k + i as f32 * 9.3 * k;
                let ty = y - 10.0 * k - ((t * 6.0 + i as f32).sin() * 0.5 + 0.5) * 14.0 * k;
                pts.push((tx, ty));
            }
            pts.reverse();
            c.blend(1);
            c.poly(&pts, col, alpha * 0.55);
            c.circle(x + f * 8.0 * k - 6.0 * k, y - 70.0 * k, 4.0 * k, 0xffffff, alpha);
            c.circle(x + f * 8.0 * k + 6.0 * k, y - 70.0 * k, 4.0 * k, 0xffffff, alpha);
            c.blend(0);
        }
        Shape::Jelly => {
            c.blend(1);
            c.ellipse(x, y - 52.0 * k, 30.0 * k, 22.0 * k, 0.0, col, alpha * 0.7);
            for i in 0..5 {
                let tx = x - 20.0 * k + i as f32 * 10.0 * k;
                let sw = (t * 4.0 + i as f32).sin() * 8.0 * k;
                c.line(tx, y - 36.0 * k, tx + sw, y - 4.0 * k, 3.0 * k, acc, alpha * 0.7);
            }
            c.radial(x, y - 56.0 * k, 22.0 * k, 0xffffff, alpha * 0.4);
            c.blend(0);
        }
        Shape::Specimen => {
            let br = 1.0 + (t * 3.0).sin() * 0.04;
            c.ellipse(x, y - 44.0 * k, 34.0 * k * br, 40.0 * k, 0.0, col, alpha);
            c.ellipse(x + f * 16.0 * k, y - 76.0 * k, 18.0 * k, 16.0 * k, 0.0, col, alpha);
            c.line(x - f * 10.0 * k, y - 70.0 * k, x - f * 40.0 * k, y - 96.0 * k, 4.0 * k, 0x3a3a4a, alpha);
            c.blend(1);
            let eyes = if tpl.boss { 5 } else { 2 };
            for i in 0..eyes {
                c.circle(x + f * (10.0 + i as f32 * 5.0) * k, y - (74.0 + (i % 2) as f32 * 7.0) * k, 3.0 * k, acc, alpha);
            }
            c.blend(0);
            c.line(x - 20.0 * k, y - 10.0 * k, x - 24.0 * k, y, 8.0 * k, col, alpha);
            c.line(x + 20.0 * k, y - 10.0 * k, x + 24.0 * k, y, 8.0 * k, col, alpha);
        }
        Shape::Wyvern => {
            let flap = (t * 7.0 + u.id as f32).sin();
            let wx = x - f * 4.0 * k;
            c.poly(&[(wx, y - 50.0 * k), (wx - f * 20.0 * k, y - 50.0 * k - 60.0 * k * flap), (wx + f * 50.0 * k, y - 50.0 * k - 40.0 * k * flap)], mix(col, 0x000000, 0.3), alpha);
            c.ellipse(x, y - 44.0 * k, 36.0 * k, 16.0 * k, 0.0, col, alpha);
            c.line(x - f * 30.0 * k, y - 44.0 * k, x - f * 70.0 * k, y - 30.0 * k + flap * 6.0 * k, 6.0 * k, col, alpha);
            c.ellipse(x + f * 42.0 * k, y - 56.0 * k, 16.0 * k, 10.0 * k, 0.2 * f, col, alpha);
            c.blend(1);
            c.circle(x + f * 48.0 * k, y - 58.0 * k, 3.0 * k, acc, alpha);
            c.blend(0);
            c.poly(&[(wx, y - 46.0 * k), (wx + f * 10.0 * k, y - 46.0 * k + 60.0 * k * flap), (wx + f * 60.0 * k, y - 40.0 * k + 30.0 * k * flap)], mix(col, 0xffffff, 0.15), alpha);
        }
        Shape::Golem => {
            let blocks = [(0.0, 24.0, 26.0), (0.0, 62.0, 30.0), (0.0, 96.0, 18.0)];
            for (dx, dy, r) in blocks {
                let cx = x + dx * k;
                let cy = y - dy * k;
                c.poly(&[(cx, cy - r * k), (cx + r * k, cy), (cx, cy + r * k * 0.8), (cx - r * k, cy)], col, alpha);
            }
            c.blend(1);
            c.radial(x + f * 6.0 * k, y - 96.0 * k, 10.0 * k, acc, alpha);
            c.blend(0);
            let sw = swing(u).0;
            c.line(x + f * 24.0 * k, y - 70.0 * k, x + f * (24.0 + sw.cos() * 34.0) * k, y - (70.0 - sw.sin() * 34.0) * k, 14.0 * k, col, alpha);
        }
        _ => draw_humanoid(c, v, u, t, alpha),
    }
}

fn draw_unit(c: &mut Canvas, v: &View, b: &Battle, u: &Unit, t: f32, g: &Game) {
    let k = v.s * u.tpl.tpl().scale;
    let x = v.x(u.pos.x);
    // Ombre
    let lift = (u.pos.y / 300.0).clamp(0.0, 0.7);
    c.ellipse(x, v.y(0.0) + 2.0, 28.0 * k * (1.0 - lift * 0.5), 6.0 * k, 0.0, 0x000000, 0.35 * (1.0 - lift));
    if u.team == Team::Ally && u.ko() {
        draw_ko(c, v, u);
        return;
    }
    if u.statuses.has(StatusId::Specter) {
        // invisible : silhouette translucide
    }
    if u.statuses.has(StatusId::Crystal) {
        let y = v.y(u.pos.y);
        c.poly(&[(x, y - 110.0 * k), (x + 30.0 * k, y - 60.0 * k), (x + 20.0 * k, y), (x - 20.0 * k, y), (x - 30.0 * k, y - 60.0 * k)], 0xb9c7d6, 0.9);
        return;
    }
    match u.tpl {
        TplRef::Hero(h) if h < 3 => draw_humanoid(c, v, u, t, if u.statuses.has(StatusId::Specter) { 0.35 } else { 1.0 }),
        _ => draw_monster(c, v, u, t),
    }
    if !u.alive() {
        return;
    }
    let top = v.y(u.pos.y) - (if u.tpl.tpl().shape == Shape::Seraph { 140.0 } else { 120.0 }) * k;
    // Statuts actifs
    let mut sx = x - 30.0 * v.s;
    for st in StatusId::ALL {
        if st != StatusId::Guarded && u.statuses.has(st) {
            c.circle(sx, top - 6.0 * v.s, 4.5 * v.s, st.def().color, 0.95);
            sx += 11.0 * v.s;
        }
    }
    // Préparation / télégraphe
    if let Some(j) = u.job {
        let a = action(j.action);
        if j.phase == Phase::Charge && a.cast > 0.3 {
            let p = (j.t / a.cast).clamp(0.0, 1.0);
            let bw = 60.0 * v.s;
            let col = if u.team == Team::Foe { RED } else { CYAN };
            c.bar(x - bw * 0.5, top + 4.0 * v.s, bw, 5.0 * v.s, p, col, 0x10141c);
            c.text(a.name, x, top - 18.0 * v.s, 13.0 * v.s.max(0.8), col, 1.0, Align::Center, true);
            if u.team == Team::Foe {
                c.text("!", x + 40.0 * v.s, top - 18.0 * v.s, 26.0 * v.s, 0xffee44, 0.6 + 0.4 * (t * 18.0).sin(), Align::Center, true);
            }
        }
    }
    if u.team == Team::Foe {
        let bw = if u.boss { 0.0 } else { 64.0 * v.s * u.tpl.tpl().scale.max(1.0) };
        if bw > 0.0 {
            c.bar(x - bw * 0.5, top - 2.0 * v.s, bw, 5.0 * v.s, u.hp_ratio(), mix(RED, GOLD, u.hp_ratio()), 0x10141c);
            if !u.engaged {
                c.text("…", x, top - 14.0 * v.s, 14.0 * v.s, DIM, 0.8, Align::Center, false);
            }
        }
        // Marqueurs : cible verrouillée par chaque joueur
        for (p, col) in PLAYER_COLORS.iter().enumerate() {
            if let Some(pu) = b.units.iter().find(|x| x.controller == Controller::Human(p as u8)) {
                if pu.target == Some(u.id) && g.players[p].joined {
                    let bob = (t * 6.0).sin() * 4.0 * v.s;
                    let ty = top - 26.0 * v.s - p as f32 * 12.0 * v.s + bob;
                    c.tri([(x - 9.0 * v.s, ty - 12.0 * v.s), (x + 9.0 * v.s, ty - 12.0 * v.s), (x, ty)], *col, 0.95);
                }
            }
        }
    } else {
        let tag = match u.controller {
            Controller::Human(p) => Some((format!("J{}{}", p + 1, if u.auto { " AUTO" } else { "" }), PLAYER_COLORS[p as usize % 3])),
            _ if u.guest => Some(("INVITÉ".to_string(), 0x7dffb0)),
            _ => None,
        };
        if let Some((s, col)) = tag {
            c.text(&s, x, top - 4.0 * v.s, 13.0 * v.s.max(0.85), col, 1.0, Align::Center, true);
            c.tri([(x - 6.0 * v.s, top + 4.0 * v.s), (x + 6.0 * v.s, top + 4.0 * v.s), (x, top + 12.0 * v.s)], col, 1.0);
        }
    }
}

fn draw_particles(c: &mut Canvas, v: &View, g: &Game) {
    c.blend(1);
    for p in &g.fx.parts {
        let a = (p.life / p.max).clamp(0.0, 1.0);
        let x = v.x(p.pos.x);
        let y = v.y(p.pos.y);
        match p.kind {
            PKind::Spark => c.circle(x, y, p.size * v.s * (0.4 + a * 0.6), p.color, a),
            PKind::Glow => c.radial(x, y, p.size * v.s * (1.6 - a * 0.6), p.color, a * 0.8),
            PKind::Ring => c.ring(x, y, p.size * v.s * (1.0 - a * 0.7), 4.0 * v.s * a + 1.0, p.color, a, 0.0, TAU),
            PKind::Slash => {
                let r = p.size * v.s;
                let prog = 1.0 - a;
                let (a0, a1) = if p.spin >= 0.0 { (-1.6 + prog * 0.6, 0.9 + prog * 0.4) } else { (PI - 0.9 - prog * 0.4, PI + 1.6 - prog * 0.6) };
                c.glow(18.0 * v.s, p.color);
                c.ring(x - p.spin * r * 0.4, y, r, 10.0 * v.s * a + 1.0, p.color, a, a0, a1);
                c.ring(x - p.spin * r * 0.4, y, r * 0.86, 3.0 * v.s, 0xffffff, a, a0 + 0.2, a1 - 0.2);
                c.glow(0.0, 0);
            }
            PKind::Bolt => {
                let mut px = x;
                let mut py = y;
                let tx = v.x(p.pos.x + p.vel.x);
                let ty = v.y(p.pos.y + p.vel.y);
                let n = 7;
                c.glow(16.0 * v.s, p.color);
                for i in 1..=n {
                    let f = i as f32 / n as f32;
                    let jx = if i == n { 0.0 } else { (hsh((p.angle as u32).wrapping_add(i)) - 0.5) * 50.0 * v.s };
                    let nx = x + (tx - x) * f + jx;
                    let ny = y + (ty - y) * f;
                    c.line(px, py, nx, ny, 4.0 * v.s * a + 1.0, p.color, a);
                    px = nx;
                    py = ny;
                }
                c.glow(0.0, 0);
            }
            PKind::Shard => {
                let r = p.size * v.s;
                let (ca, sa) = (p.angle.cos(), p.angle.sin());
                c.tri([(x + ca * r, y + sa * r), (x - sa * r * 0.4, y + ca * r * 0.4), (x + sa * r * 0.4, y - ca * r * 0.4)], p.color, a);
            }
            PKind::Rune => {
                let r = p.size * v.s;
                let rot = p.angle;
                c.ellipse(x, y, r, r * 0.28, 0.0, p.color, 0.15 * a);
                c.ring(x, y, r, 2.0 * v.s, p.color, a, 0.0, TAU);
                for i in 0..6 {
                    let an = rot + i as f32 * TAU / 6.0;
                    c.circle(x + an.cos() * r * 0.8, y + an.sin() * r * 0.22, 3.0 * v.s, p.color, a);
                }
            }
            PKind::Pillar => {
                let wd = p.size * v.s * (0.4 + a);
                c.grad(x - wd * 0.5, 0.0, wd, y, 0x000000, p.color, a * 0.8);
                c.radial(x, y, wd, p.color, a * 0.6);
            }
            PKind::Leaf => {
                c.ellipse(x, y, p.size * v.s, p.size * v.s * 0.5, p.angle, p.color, a);
            }
            PKind::Text => {}
        }
    }
    c.blend(0);
    for p in &g.fx.parts {
        if p.kind == PKind::Text {
            let a = (p.life / p.max * 2.0).clamp(0.0, 1.0);
            let pop = 1.0 + ((p.max - p.life) * 12.0).min(1.0) * 0.0 + if p.max - p.life < 0.08 { 0.4 } else { 0.0 };
            let s = p.size * v.s.max(0.7) * pop;
            let x = v.x(p.pos.x);
            let y = v.y(p.pos.y);
            let txt = p.text.as_deref().unwrap_or("");
            c.text(txt, x + 2.0, y + 2.0, s, 0x000000, a * 0.7, Align::Center, true);
            c.text(txt, x, y, s, p.color, a, Align::Center, true);
        }
    }
}

fn draw_projectiles(c: &mut Canvas, v: &View, b: &Battle) {
    c.blend(1);
    for p in &b.projectiles {
        let x = v.x(p.pos.x);
        let y = v.y(p.pos.y);
        let tail = 40.0 * v.s;
        let d = (p.vel.x * p.vel.x + p.vel.y * p.vel.y).sqrt().max(1.0);
        let (dx, dy) = (p.vel.x / d, -p.vel.y / d);
        c.glow(14.0 * v.s, p.color);
        if p.action == A_CROC {
            c.ring(x, y, 34.0 * v.s, 8.0 * v.s, p.color, 0.9, if dx > 0.0 { -1.2 } else { PI - 1.2 }, if dx > 0.0 { 1.2 } else { PI + 1.2 });
        } else {
            c.line(x - dx * tail, y - dy * tail, x, y, 6.0 * v.s, p.color, 0.8);
            c.circle(x, y, 7.0 * v.s, 0xffffff, 1.0);
        }
        c.glow(0.0, 0);
    }
    c.blend(0);
}

pub fn make_view(g: &mut Game, c: &Canvas) -> View {
    let (w, h) = (c.w, c.h);
    let portrait = h > w * 1.05;
    let s = if portrait { (w / 560.0).max(0.35) } else { (h / 560.0).min(w / 700.0).max(0.35) };
    let gy = if portrait { h * 0.46 } else { h - 118.0 * c.ui.max(0.6) };
    let half = w * 0.5 / s;
    if let Some(b) = g.battle() {
        let humans: Vec<f32> = b.units.iter().filter(|u| u.is_human() && u.alive()).map(|u| u.pos.x + u.facing * 80.0).collect();
        let target = if humans.is_empty() {
            b.leader.map(|l| b.unit(l).pos.x).unwrap_or(0.0)
        } else {
            humans.iter().sum::<f32>() / humans.len() as f32
        };
        let (lo, hi) = b.arena;
        let target = if hi - lo < half * 2.0 { (lo + hi) * 0.5 } else { target.clamp(lo + half, hi - half) };
        if g.cam_x == 0.0 {
            g.cam_x = target;
        }
        g.cam_x += (target - g.cam_x) * 0.1;
    }
    let sh = g.fx.shake;
    let shx = (g.time * 70.0).sin() * sh * 14.0 * s;
    let shy = (g.time * 83.0).cos() * sh * 10.0 * s;
    View { s, cx: g.cam_x, ox: w * 0.5, gy, shx, shy }
}

fn draw_room(g: &mut Game, c: &mut Canvas, t: f32) {
    let v = make_view(g, c);
    let sector = g.run.as_ref().map(|r| r.sector).unwrap_or(0);
    draw_backdrop(c, &v, sector, t);
    let Some(b) = g.battle().cloned() else { return };
    // Porte de sortie
    let exit_x = v.x(b.arena.1 - 70.0);
    let cleared = b.living_foes() == 0;
    c.rect(exit_x - 30.0 * v.s, v.gy - 170.0 * v.s, 60.0 * v.s, 170.0 * v.s, 0x0a0f18, 0.9);
    c.blend(1);
    c.grad(exit_x - 26.0 * v.s, v.gy - 166.0 * v.s, 52.0 * v.s, 166.0 * v.s, if cleared { 0x3cff9a } else { 0xff3a3a }, 0x000000, if cleared { 0.7 } else { 0.25 });
    c.blend(0);
    if cleared {
        let bob = (t * 4.0).sin() * 8.0 * v.s;
        c.text("SORTIE →", exit_x - 60.0 * v.s + bob, v.gy - 190.0 * v.s, 22.0 * v.s.max(0.8), GREEN, 1.0, Align::Center, true);
    }
    // Unités : ennemis derrière, alliés devant
    let mut order: Vec<&Unit> = b.units.iter().filter(|u| !u.gone).collect();
    order.sort_by_key(|u| (u.team == Team::Ally, u.alive(), u.is_human()));
    for u in order {
        draw_unit(c, &v, &b, u, t, g);
    }
    draw_projectiles(c, &v, &b);
    draw_particles(c, &v, g);
    draw_hud(g, c, &b, t, &v);
}

fn intent_text(u: &Unit, b: &Battle) -> (String, u32) {
    if !u.alive() {
        return ("à terre".into(), RED);
    }
    if !u.statuses.can_act() {
        return ("incapable d'agir".into(), 0xb0a0ff);
    }
    match u.job {
        Some(j) => {
            let a = action(j.action);
            let tgt = j.target.map(|t| format!(" → {}", b.unit(t).name)).unwrap_or_default();
            let tag = match j.source {
                Source::Reflex(s) => format!(" [R{}]", s + 1),
                Source::Manual => " [Ordre]".into(),
                Source::Status => " [Statut]".into(),
                Source::Direct => String::new(),
            };
            let col = match j.source {
                Source::Manual => GOLD,
                Source::Reflex(_) => CYAN,
                _ => WHITE,
            };
            let verb = match j.phase {
                Phase::Approach => "↗ ",
                Phase::Charge => "✦ ",
                _ => "▶ ",
            };
            (format!("{}{}{}{}", verb, a.name, tgt, tag), col)
        }
        None => {
            if u.manual.is_some() {
                ("ordre en attente".into(), GOLD)
            } else if u.is_human() && !u.auto {
                ("contrôle manuel".into(), DIM)
            } else if !u.book.enabled {
                ("Réflexes OFF : attend".into(), DIM)
            } else if u.gauge < 1.0 {
                ("prépare…".into(), DIM)
            } else {
                ("attend (aucun Réflexe valide)".into(), DIM)
            }
        }
    }
}

fn draw_hud(g: &Game, c: &mut Canvas, b: &Battle, t: f32, v: &View) {
    let u = c.ui;
    let (w, h) = (c.w, c.h);
    let portrait = h > w * 1.05;
    let allies: Vec<&Unit> = b.units.iter().filter(|x| x.team == Team::Ally && !x.gone).collect();
    let n = allies.len().max(1);
    let (cw, ch, x0, y0, cols) = if portrait {
        let cw = (w - 24.0 * u) / 2.0;
        (cw, 86.0 * u, 8.0 * u, v.gy + 16.0 * u, 2)
    } else {
        let cw = ((w - 20.0 * u) / n as f32).min(300.0 * u);
        (cw, 96.0 * u, (w - cw * n as f32) * 0.5, h - 102.0 * u, n)
    };
    for (i, a) in allies.iter().enumerate() {
        let col_i = i % cols;
        let row_i = i / cols;
        let r = Rect::new(x0 + col_i as f32 * (cw + 4.0 * u), y0 + row_i as f32 * (ch + 6.0 * u), cw - 4.0 * u, ch);
        let pc = match a.controller {
            Controller::Human(p) => PLAYER_COLORS[p as usize % 3],
            _ => 0x3a4a66,
        };
        c.rrect(r, 10.0 * u, 0x070c18, 0.86);
        c.stroke(r, 10.0 * u, if a.is_human() { 2.0 * u } else { 1.0 * u }, pc, 0.9);
        let px = r.x + 26.0 * u;
        let py = r.y + 28.0 * u;
        c.circle(px, py, 18.0 * u, a.tpl.tpl().color, 1.0);
        c.circle(px, py - 2.0 * u, 9.0 * u, 0xf3d2b8, 1.0);
        let tag = match a.controller {
            Controller::Human(p) => format!("J{}{}", p + 1, if a.auto { "·AUTO" } else { "" }),
            _ if a.guest => "INVITÉ".into(),
            _ => "IA".into(),
        };
        c.text(&format!("{}  Nv {}", a.name, a.level), r.x + 52.0 * u, r.y + 14.0 * u, 15.0 * u, WHITE, 1.0, Align::Left, true);
        c.text(&tag, r.x + r.w - 8.0 * u, r.y + 14.0 * u, 12.0 * u, pc, 1.0, Align::Right, true);
        if b.leader == Some(a.id) {
            c.text("★ meneur", r.x + r.w - 8.0 * u, r.y + 30.0 * u, 10.0 * u, GOLD, 1.0, Align::Right, false);
        }
        let bx = r.x + 52.0 * u;
        let bw = r.w - 60.0 * u;
        let hpr = a.hp_ratio();
        c.bar(bx, r.y + 26.0 * u, bw, 9.0 * u, hpr, if hpr < 0.25 { RED } else { 0x5aff8a }, 0x1a1f2a);
        c.text(&format!("{}/{}", a.hp.ceil() as i32, a.max_hp() as i32), bx + bw, r.y + 44.0 * u, 11.0 * u, WHITE, 0.9, Align::Right, false);
        c.bar(bx, r.y + 39.0 * u, bw * 0.55, 5.0 * u, a.mp_ratio(), 0x5aa0ff, 0x1a1f2a);
        if a.is_human() && !a.guest {
            let full = a.surcharge >= 100.0;
            c.bar(bx, r.y + 50.0 * u, bw, 6.0 * u, a.surcharge / 100.0, if full { mix(GOLD, 0xffffff, (t * 8.0).sin() * 0.5 + 0.5) } else { 0xffa02a }, 0x1a1f2a);
            if full {
                c.text("ARCANE ULTIME PRÊT (RT / O)", bx, r.y + 63.0 * u, 11.0 * u, GOLD, 1.0, Align::Left, true);
            }
        } else {
            c.bar(bx, r.y + 50.0 * u, bw, 4.0 * u, a.gauge, CYAN, 0x1a1f2a);
        }
        // Statuts
        let mut sx = r.x + 10.0 * u;
        for st in StatusId::ALL {
            if st != StatusId::Guarded && st != StatusId::Ko && a.statuses.has(st) {
                c.rrect(Rect::new(sx, r.y + 52.0 * u, 34.0 * u, 12.0 * u), 3.0 * u, st.def().color, 0.9);
                let nm: String = st.def().name.chars().take(4).collect();
                c.text(&nm, sx + 17.0 * u, r.y + 58.0 * u, 9.0 * u, 0x000000, 1.0, Align::Center, true);
                sx += 36.0 * u;
                if sx > r.x + 46.0 * u {
                    break;
                }
            }
        }
        let (it, icol) = intent_text(a, b);
        c.text(&it, r.x + 10.0 * u, r.y + r.h - 12.0 * u, 12.0 * u, icol, 1.0, Align::Left, false);
    }
    // Barre de boss
    if let Some(boss) = b.units.iter().find(|x| x.boss && x.alive()) {
        let bw = (w * 0.6).min(700.0 * u);
        let bx = (w - bw) * 0.5;
        let by = 62.0 * u;
        c.text(&boss.name, w * 0.5, by - 12.0 * u, 18.0 * u, 0xffd0d8, 1.0, Align::Center, true);
        c.bar(bx, by, bw, 12.0 * u, boss.hp_ratio(), mix(RED, 0xff9a3a, boss.hp_ratio()), 0x1a0a10);
        c.stroke(Rect::new(bx, by, bw, 12.0 * u), 2.0, 1.0 * u, 0xffd0d8, 0.6);
    }
    // Compteur de combo
    if b.combo_count >= 3 {
        let s = 1.0 + (b.combo_timer - 1.4).max(0.0) * 2.0;
        c.text(&format!("{}", b.combo_count), w - 30.0 * u, h * 0.32, 56.0 * u * s, GOLD, 1.0, Align::Right, true);
        c.text("COUPS", w - 30.0 * u, h * 0.32 + 34.0 * u, 16.0 * u, WHITE, 1.0, Align::Right, true);
    }
    // Info de salle
    if let Some(r) = &g.run {
        let sector_name = ["Bas-Fonds", "L'Aiguille", "Cratère du Requiem"][r.sector.min(2)];
        c.text(&format!("Secteur {} — {}   ·   Ennemis : {}   ·   {} Lumens", r.sector + 1, sector_name, b.living_foes(), r.lumens + b.lumens), 12.0 * u, 18.0 * u, 13.0 * u, DIM, 1.0, Align::Left, false);
    }
    // Boutons tactiles (pause / ordre / perso / auto)
    let bs = 38.0 * u;
    let labels = [("❚❚", 900u16), ("Ordre", 901), ("Perso", 902), ("Auto", 903)];
    for (i, (lab, id)) in labels.iter().enumerate() {
        let r = Rect::new(w - (i as f32 + 1.0) * (bs * 1.6 + 6.0 * u) - 4.0 * u, 34.0 * u, bs * 1.6, bs * 0.8);
        c.rrect(r, 8.0 * u, 0x0b1222, 0.7);
        c.stroke(r, 8.0 * u, 1.0 * u, 0x3a4a66, 0.8);
        c.text(lab, r.x + r.w * 0.5, r.y + r.h * 0.5, 13.0 * u, WHITE, 0.9, Align::Center, true);
        // Les identifiants de commande (cmd) sont décalés de 1 par l'hôte.
        c.hit(r, id + 1);
    }
    // Journal
    if g.meta.opts.show_log && !portrait {
        let lines: Vec<&String> = b.log.iter().rev().take(6).collect();
        for (i, l) in lines.iter().enumerate() {
            let a = 1.0 - i as f32 * 0.14;
            c.text(l, 12.0 * u, 40.0 * u + i as f32 * 16.0 * u, 12.0 * u, 0xc8d0e0, a, Align::Left, false);
        }
    }
    // Débogage des Réflexes
    if g.meta.opts.debug {
        let mut y = if portrait { 40.0 * u } else { 150.0 * u };
        let pw = 470.0 * u;
        for a in allies.iter().filter(|a| a.ai_driven()) {
            let lines = ai::explain(b, a.id);
            let hgt = (lines.len() as f32 + 0.6) * 14.0 * u;
            c.rrect(Rect::new(8.0 * u, y - 10.0 * u, pw, hgt), 6.0 * u, 0x000000, 0.65);
            for (i, l) in lines.iter().enumerate() {
                let col = if l.contains('✔') {
                    GREEN
                } else if l.contains("impossible") {
                    0xff9a7a
                } else if i == 0 {
                    GOLD
                } else {
                    0xb8c2d8
                };
                c.text(l, 14.0 * u, y + i as f32 * 14.0 * u, 11.0 * u, col, 1.0, Align::Left, i == 0);
            }
            y += hgt + 6.0 * u;
            if y > h * 0.7 {
                break;
            }
        }
    }
}

fn draw_screen_fx(g: &Game, c: &mut Canvas) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    if g.fx.flash > 0.0 {
        c.blend(1);
        c.rect(0.0, 0.0, w, h, g.fx.flash_color, g.fx.flash * 0.55);
        c.blend(0);
    }
    if let Some((name, col, tl, total)) = &g.fx.ult {
        let p = 1.0 - tl / total;
        let a = (tl * 3.0).min(1.0).min(p * 8.0);
        c.rect(0.0, 0.0, w, h, 0x000000, 0.35 * a);
        // Lignes de vitesse
        c.blend(1);
        for i in 0..18 {
            let y = hsh(i * 7 + (g.time * 20.0) as u32) * h;
            let x = (hsh(i * 13) * w + g.time * 2400.0) % (w * 1.4) - w * 0.2;
            c.line(x, y, x + 220.0 * u, y, 2.0 * u, *col, 0.4 * a);
        }
        c.blend(0);
        let by = h * 0.36;
        let slide = (1.0 - (p * 6.0).min(1.0)) * w;
        c.poly(&[(-20.0 + slide, by), (w + slide, by - 40.0 * u), (w + slide, by + 50.0 * u), (-20.0 + slide, by + 90.0 * u)], 0x05070c, 0.9 * a);
        c.glow(24.0 * u, *col);
        c.text(name, w * 0.5 + slide, by + 26.0 * u, 46.0 * u, *col, a, Align::Center, true);
        c.glow(0.0, 0);
        c.text("ARCANE ULTIME", w * 0.5 + slide, by - 12.0 * u, 16.0 * u, WHITE, a, Align::Center, true);
    }
    for (i, bn) in g.fx.banners.iter().enumerate() {
        let a = (bn.t * 4.0).min(1.0).min((bn.max - bn.t) * 3.0);
        let y = h * 0.22 + i as f32 * 70.0 * u;
        c.rect(0.0, y - 30.0 * u, w, 66.0 * u, 0x000000, 0.45 * a);
        c.glow(20.0 * u, bn.color);
        c.text(&bn.text, w * 0.5, y, 34.0 * u, bn.color, a, Align::Center, true);
        c.glow(0.0, 0);
        c.text(&bn.sub, w * 0.5, y + 26.0 * u, 14.0 * u, WHITE, a, Align::Center, false);
    }
}

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

fn bg_gradient(c: &mut Canvas, t: f32, top: u32, bot: u32) {
    let (w, h) = (c.w, c.h);
    c.grad(0.0, 0.0, w, h, top, bot, 1.0);
    c.blend(1);
    for i in 0..60u32 {
        let x = hsh(i * 3) * w;
        let speed = 20.0 + hsh(i * 5) * 50.0;
        let y = h - ((t * speed + hsh(i * 11) * h) % (h + 40.0));
        let s = 1.5 + hsh(i * 17) * 3.0;
        c.circle(x + (t + i as f32).sin() * 10.0, y, s * c.ui, 0x5affb0, 0.35 + 0.3 * (t * 2.0 + i as f32).sin());
    }
    c.blend(0);
}

fn menu_list(c: &mut Canvas, items: &[String], cursor: usize, x: f32, y: f32, wd: f32, ih: f32, base_id: u16, accent: u32) {
    for (i, s) in items.iter().enumerate() {
        let r = Rect::new(x, y + i as f32 * (ih + 8.0 * c.ui), wd, ih);
        // L'hôte envoie cmd = id + 1 ; le jeu soustrait 1.
        c.button(r, s, i == cursor, true, base_id + i as u16 + 1, accent);
    }
}

fn draw_title(g: &Game, c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x03060d, 0x0d2a2a);
    c.blend(1);
    c.radial(w * 0.5, h * 0.3, 380.0 * u, 0x3cff9a, 0.16);
    c.blend(0);
    c.glow(30.0 * u, 0x5affb0);
    c.text("LUMEN REQUIEM", w * 0.5, h * 0.24, (70.0 * u).min(w / 10.0), 0xeafff4, 1.0, Align::Center, true);
    c.glow(0.0, 0);
    c.text("RPG d'action roguelike · IA programmable par Réflexes · coop 1 à 3 joueurs", w * 0.5, h * 0.24 + 48.0 * u, 15.0 * u, 0x9fe8d0, 1.0, Align::Center, false);
    let items = vec!["Nouvelle partie".to_string(), format!("Sanctuaire  ({} Fragments)", g.meta.fragments), "Comment jouer".to_string()];
    let wd = (360.0 * u).min(w - 40.0);
    menu_list(c, &items, g.cursor, (w - wd) * 0.5, h * 0.45, wd, 48.0 * u, 0, CYAN);
    let joined = (0..MAX_PLAYERS).filter(|&i| g.players[i].joined).count();
    c.text(&format!("Manettes connectées en jeu : {}  ·  appuyez sur un bouton pour rejoindre", joined), w * 0.5, h - 54.0 * u, 13.0 * u, DIM, 1.0, Align::Center, false);
    c.text(&format!("Parties : {}  ·  Victoires : {}  ·  Meilleur secteur : {}", g.meta.runs, g.meta.wins, g.meta.best_sector.max(1)), w * 0.5, h - 32.0 * u, 12.0 * u, DIM, 0.8, Align::Center, false);
}

fn draw_howto(c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x03060d, 0x0b1a2a);
    let lines = [
        ("COMBAT", ""),
        ("Déplacement", "Stick / Croix · Flèches ou ZQSD · Pad tactile gauche"),
        ("Saut (double saut)", "A · Espace · bouton A"),
        ("Attaque (combo ×3)", "X · J"),
        ("Arte (neutre / ↑ / ↓)", "B · K  — consomme de l'Éther"),
        ("Garde", "LB · L  — réduit les dégâts de 75 %"),
        ("Changer de cible", "RB · I"),
        ("Arcane ultime (Surcharge pleine)", "RT · O"),
        ("Changer de personnage", "LT · U"),
        ("Ordre manuel à un allié", "Y · H"),
        ("Pilote automatique (vos Réflexes jouent)", "Select · P"),
        ("Pause / Réflexes", "Start · Entrée"),
        ("", ""),
        ("RÉFLEXES", "Chaque allié lit sa liste de haut en bas et exécute la PREMIÈRE"),
        ("", "règle dont la cible existe et dont l'action est possible."),
        ("", "Réordonnez, activez, désactivez : l'effet est immédiat."),
        ("Postures I / II / III", "Trois configurations par héros (LT/RT dans l'éditeur)."),
    ];
    let mut y = h * 0.1;
    for (a, b) in lines {
        let bold = b.is_empty() || a == "RÉFLEXES";
        c.text(a, w * 0.5 - 16.0 * u, y, 15.0 * u, if bold { GOLD } else { WHITE }, 1.0, Align::Right, bold);
        c.text(b, w * 0.5 + 16.0 * u, y, 14.0 * u, 0xb8c8e0, 1.0, Align::Left, false);
        y += 26.0 * u;
    }
    c.text("A / tap : retour", w * 0.5, h - 30.0 * u, 13.0 * u, DIM, 1.0, Align::Center, false);
    c.hit(Rect::new(0.0, 0.0, w, h), 1);
}

fn draw_lobby(g: &Game, c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x03060d, 0x14102a);
    c.text("FORMATION DE L'ÉQUIPE", w * 0.5, h * 0.1, 30.0 * u, WHITE, 1.0, Align::Center, true);
    c.text("Jusqu'à 3 joueurs en local (manettes) ou en ligne. Les héros non choisis sont pilotés par leurs Réflexes.", w * 0.5, h * 0.1 + 30.0 * u, 13.0 * u, DIM, 1.0, Align::Center, false);
    let cw = ((w - 60.0 * u) / 3.0).min(280.0 * u);
    let x0 = (w - cw * 3.0 - 20.0 * u) * 0.5;
    for p in 0..MAX_PLAYERS {
        let r = Rect::new(x0 + p as f32 * (cw + 10.0 * u), h * 0.24, cw, h * 0.5);
        let pl = &g.players[p];
        let col = PLAYER_COLORS[p];
        c.rrect(r, 14.0 * u, 0x0a0f1c, 0.92);
        c.stroke(r, 14.0 * u, if pl.joined { 2.5 * u } else { 1.0 * u }, if pl.joined { col } else { 0x3a4a66 }, 1.0);
        c.text(&format!("JOUEUR {}", p + 1), r.x + r.w * 0.5, r.y + 22.0 * u, 16.0 * u, col, 1.0, Align::Center, true);
        if pl.joined {
            let hero = pl.hero.min(2);
            let tpl = &HEROES[hero];
            // Portrait : on dessine le héros
            let fake = fake_unit(hero, t);
            let v = View { s: (r.h / 260.0).min(r.w / 160.0), cx: 0.0, ox: r.x + r.w * 0.5, gy: r.y + r.h * 0.68, shx: 0.0, shy: 0.0 };
            c.blend(1);
            c.radial(r.x + r.w * 0.5, r.y + r.h * 0.5, r.w * 0.45, tpl.accent, 0.15);
            c.blend(0);
            draw_humanoid(c, &v, &fake, t, 1.0);
            c.text(&format!("◀  {}  ▶", tpl.name), r.x + r.w * 0.5, r.y + r.h * 0.78, 22.0 * u, WHITE, 1.0, Align::Center, true);
            let role = ["Épéiste · artes tranchantes", "Lutteuse · vol et vitesse", "Mage · soins et arcanes"][hero];
            c.text(role, r.x + r.w * 0.5, r.y + r.h * 0.86, 12.0 * u, DIM, 1.0, Align::Center, false);
            if p == 0 {
                for hh in 0..3 {
                    let br = Rect::new(r.x + 10.0 * u + hh as f32 * (r.w - 20.0 * u) / 3.0, r.y + r.h - 34.0 * u, (r.w - 26.0 * u) / 3.0, 26.0 * u);
                    c.button(br, HEROES[hh].name, hh == hero, true, 10 + hh as u16 + 1, col);
                }
            }
        } else {
            let a = 0.5 + 0.5 * (t * 3.0).sin();
            c.text("Appuyez sur A", r.x + r.w * 0.5, r.y + r.h * 0.5, 18.0 * u, WHITE, a, Align::Center, true);
            c.text("pour rejoindre", r.x + r.w * 0.5, r.y + r.h * 0.5 + 24.0 * u, 14.0 * u, DIM, 1.0, Align::Center, false);
        }
    }
    let br = Rect::new(w * 0.5 - 140.0 * u, h * 0.8, 280.0 * u, 50.0 * u);
    c.button(br, "▶  COMMENCER (START)", true, true, 2, GOLD);
    c.text("B : retour · ← → : changer de héros", w * 0.5, h * 0.8 + 70.0 * u, 12.0 * u, DIM, 1.0, Align::Center, false);
}

fn fake_unit(hero: usize, t: f32) -> Unit {
    let mut b = Battle::new(1);
    let id = b.add_hero(hero, 1, 0.0);
    let mut u = b.units.remove(id as usize);
    u.anim_t = t;
    u
}

fn speaker_hero(name: &str) -> Option<usize> {
    match name {
        "Kael" => Some(0),
        "Nyra" => Some(1),
        "Lysa" => Some(2),
        _ => None,
    }
}

fn draw_story(_g: &Game, c: &mut Canvas, sc: &story::Scene, idx: usize, chars: f32, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    let (top, bot) = match sc.mood {
        6 => (0x05060f, 0x1a1030),
        7 => (0x12030c, 0x3a0a20),
        5 => (0x081a10, 0x2a5a3a),
        _ => (0x03080d, 0x0d2a2a),
    };
    bg_gradient(c, t, top, bot);
    c.text(sc.title, w * 0.5, h * 0.08, 24.0 * u, 0xd8fff0, 0.9, Align::Center, true);
    let Some(&(speaker, text)) = sc.lines.get(idx) else { return };
    if let Some(hh) = speaker_hero(speaker) {
        let fake = fake_unit(hh, t);
        let v = View { s: (h / 330.0).min(w / 300.0), cx: 0.0, ox: w * 0.5, gy: h * 0.6, shx: 0.0, shy: 0.0 };
        c.blend(1);
        c.radial(w * 0.5, h * 0.42, 200.0 * u, HEROES[hh].accent, 0.18);
        c.blend(0);
        draw_humanoid(c, &v, &fake, t, 1.0);
    } else if !speaker.is_empty() {
        c.blend(1);
        c.radial(w * 0.5, h * 0.42, 160.0 * u, if speaker.contains("Ashka") { 0xe8e8ff } else { 0xa0a0c0 }, 0.2);
        c.blend(0);
        c.ellipse(w * 0.5, h * 0.42, 50.0 * u, 70.0 * u, 0.0, 0x05060a, 0.9);
    }
    let bw = (w - 40.0 * u).min(900.0 * u);
    let r = Rect::new((w - bw) * 0.5, h * 0.66, bw, h * 0.26);
    c.panel(r, 0.9);
    if !speaker.is_empty() {
        let nr = Rect::new(r.x + 20.0 * u, r.y - 18.0 * u, (speaker.chars().count() as f32 * 11.0 + 30.0) * u, 32.0 * u);
        c.rrect(nr, 8.0 * u, 0x16243a, 1.0);
        c.text(speaker, nr.x + nr.w * 0.5, nr.y + nr.h * 0.5, 16.0 * u, GOLD, 1.0, Align::Center, true);
    }
    let shown: String = text.chars().take(chars as usize).collect();
    let fs = 18.0 * u;
    let max_chars = ((r.w - 50.0 * u) / (fs * 0.52)) as usize;
    let mut y = r.y + 34.0 * u;
    for line in wrap(&shown, max_chars.max(10)) {
        c.text(&line, r.x + 25.0 * u, y, fs, if speaker.is_empty() { 0xd0e8ff } else { WHITE }, 1.0, Align::Left, false);
        y += fs * 1.35;
    }
    c.text(&format!("{}/{}   A : suivant · START : passer", idx + 1, sc.lines.len()), r.x + r.w - 16.0 * u, r.y + r.h - 16.0 * u, 12.0 * u, DIM, 1.0, Align::Right, false);
    c.hit(Rect::new(0.0, 0.0, w, h), 2);
    let sk = Rect::new(w - 130.0 * u, 16.0 * u, 110.0 * u, 34.0 * u);
    c.button(sk, "Passer ▶▶", false, true, 3, CYAN);
}

pub fn wrap(s: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for word in s.split(' ') {
        if cur.chars().count() + word.chars().count() + 1 > max && !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
        if !cur.is_empty() {
            cur.push(' ');
        }
        cur.push_str(word);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn draw_party_strip(g: &Game, c: &mut Canvas, x: f32, y: f32, wd: f32) -> f32 {
    let u = c.ui;
    let Some(r) = &g.run else { return y };
    let mut yy = y;
    for h in 0..3 {
        let hr = &r.heroes[h];
        let tpl = &HEROES[h];
        c.circle(x + 14.0 * u, yy + 12.0 * u, 11.0 * u, tpl.color, 1.0);
        c.text(&format!("{} Nv {}", tpl.name, hr.level), x + 32.0 * u, yy + 6.0 * u, 14.0 * u, WHITE, 1.0, Align::Left, true);
        c.bar(x + 32.0 * u, yy + 16.0 * u, wd - 40.0 * u, 7.0 * u, hr.hp_ratio, 0x5aff8a, 0x1a1f2a);
        c.text(&format!("Réflexes : {} emplacements · Posture {}", g.slots_for(h), POSTURE_NAMES[g.meta.books[h].active]), x + 32.0 * u, yy + 33.0 * u, 11.0 * u, DIM, 1.0, Align::Left, false);
        yy += 48.0 * u;
    }
    c.text(&format!("{} Lumens", r.lumens), x, yy + 4.0 * u, 16.0 * u, GOLD, 1.0, Align::Left, true);
    yy += 24.0 * u;
    let inv: Vec<String> = (0..ITEM_COUNT).filter(|&i| r.inventory.count[i] > 0).map(|i| format!("{} ×{}", ITEMS[i].name, r.inventory.count[i])).collect();
    for line in wrap(&inv.join(" · "), ((wd / (11.0 * u * 0.55)) as usize).max(10)) {
        c.text(&line, x, yy, 12.0 * u, 0xb8c8e0, 1.0, Align::Left, false);
        yy += 16.0 * u;
    }
    if !r.echoes.is_empty() {
        let e: Vec<&str> = r.echoes.iter().map(|e| e.name()).collect();
        yy += 6.0 * u;
        for line in wrap(&format!("Échos : {}", e.join(", ")), ((wd / (11.0 * u * 0.55)) as usize).max(10)) {
            c.text(&line, x, yy, 11.0 * u, 0xd0b0ff, 1.0, Align::Left, false);
            yy += 15.0 * u;
        }
    }
    yy
}

fn draw_map(g: &Game, c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    let Some(r) = &g.run else { return };
    let (top, bot) = [(0x03080d, 0x0d2a2a), (0x05060f, 0x1a1a40), (0x12030c, 0x3a0a20)][r.sector.min(2)];
    bg_gradient(c, t, top, bot);
    let names = ["Secteur I — Les Bas-Fonds", "Secteur II — L'Aiguille", "Secteur III — Le Cratère du Requiem"];
    c.text(names[r.sector.min(2)], 24.0 * u, 30.0 * u, 24.0 * u, WHITE, 1.0, Align::Left, true);
    c.text("Choisissez votre chemin · START : Réflexes", 24.0 * u, 56.0 * u, 13.0 * u, DIM, 1.0, Align::Left, false);
    let portrait = h > w;
    let mw = if portrait { w } else { w * 0.66 };
    let layers = r.map.len();
    let mh = if portrait { h * 0.55 } else { h * 0.8 };
    let my = if portrait { 80.0 * u } else { h * 0.12 };
    let pos = |li: usize, ni: usize, n: usize| -> (f32, f32) {
        let x = 50.0 * u + (mw - 100.0 * u) * li as f32 / (layers - 1).max(1) as f32;
        let y = my + mh * (ni as f32 + 1.0) / (n as f32 + 1.0);
        (x, y)
    };
    // liens
    for li in 0..layers - 1 {
        for (a, _) in r.map[li].iter().enumerate() {
            for (bidx, _) in r.map[li + 1].iter().enumerate() {
                let p1 = pos(li, a, r.map[li].len());
                let p2 = pos(li + 1, bidx, r.map[li + 1].len());
                let on_path = r.path.get(li) == Some(&a) && (r.path.get(li + 1) == Some(&bidx) || (li + 1 == r.layer && bidx == g.cursor));
                c.line(p1.0, p1.1, p2.0, p2.1, if on_path { 3.0 * u } else { 1.0 * u }, if on_path { CYAN } else { 0x2a3a4a }, if on_path { 0.9 } else { 0.5 });
            }
        }
    }
    for (li, row) in r.map.iter().enumerate() {
        for (ni, k) in row.iter().enumerate() {
            let (x, y) = pos(li, ni, row.len());
            let done = li < r.layer && r.path.get(li) == Some(&ni);
            let current = li == r.layer;
            let sel = current && ni == g.cursor;
            let rad = if sel { 26.0 } else { 20.0 } * u * if *k == NodeKind::Boss { 1.4 } else { 1.0 };
            if sel {
                c.blend(1);
                c.radial(x, y, rad * 2.6, k.color(), 0.5 + 0.2 * (t * 5.0).sin());
                c.blend(0);
            }
            let a = if li < r.layer && !done { 0.3 } else { 1.0 };
            c.circle(x, y, rad, if done { 0x20303a } else { 0x0a0f1c }, a);
            c.ring(x, y, rad, 3.0 * u, k.color(), a, 0.0, TAU);
            let icon = match k {
                NodeKind::Fight => "⚔",
                NodeKind::Elite => "☠",
                NodeKind::Rest => "✚",
                NodeKind::Shop => "$",
                NodeKind::Event => "?",
                NodeKind::Boss => "♛",
            };
            c.text(icon, x, y, rad * 0.95, k.color(), a, Align::Center, true);
            if current {
                c.text(k.name(), x, y + rad + 14.0 * u, 12.0 * u, WHITE, 1.0, Align::Center, sel);
                c.hit(Rect::new(x - rad, y - rad, rad * 2.0, rad * 2.0), ni as u16 + 1);
            }
        }
    }
    let (px, py, pw) = if portrait { (20.0 * u, my + mh + 30.0 * u, w - 40.0 * u) } else { (mw + 10.0 * u, h * 0.14, w - mw - 30.0 * u) };
    c.panel(Rect::new(px - 10.0 * u, py - 14.0 * u, pw + 20.0 * u, h - py - 10.0 * u), 0.75);
    draw_party_strip(g, c, px, py, pw);
    let br = Rect::new(w - 200.0 * u, 18.0 * u, 180.0 * u, 40.0 * u);
    c.button(br, "Réflexes (START)", false, true, 901, CYAN);
}

fn draw_reward(g: &Game, c: &mut Canvas, choices: &[Echo], t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x05060f, 0x201040);
    c.text("ÉCHOS DE LUMEN", w * 0.5, h * 0.12, 32.0 * u, 0xe0d0ff, 1.0, Align::Center, true);
    c.text("La mémoire de la planète vous offre un don. Choisissez-en un.", w * 0.5, h * 0.12 + 32.0 * u, 14.0 * u, DIM, 1.0, Align::Center, false);
    let n = choices.len();
    let portrait = h > w;
    for (i, e) in choices.iter().enumerate() {
        let r = if portrait {
            let ch = (h * 0.62 - 20.0 * u * n as f32) / n as f32;
            Rect::new(20.0 * u, h * 0.25 + i as f32 * (ch + 16.0 * u), w - 40.0 * u, ch)
        } else {
            let cw = ((w - 80.0 * u) / n as f32).min(320.0 * u);
            let x0 = (w - cw * n as f32 - 20.0 * u * (n - 1) as f32) * 0.5;
            Rect::new(x0 + i as f32 * (cw + 20.0 * u), h * 0.28, cw, h * 0.5)
        };
        let sel = i == g.cursor;
        let lift = if sel { -10.0 * u } else { 0.0 };
        let r = Rect::new(r.x, r.y + lift, r.w, r.h);
        if sel {
            c.blend(1);
            c.radial(r.x + r.w * 0.5, r.y + r.h * 0.4, r.w * 0.7, e.color(), 0.35);
            c.blend(0);
        }
        c.rrect(r, 16.0 * u, 0x0a0a18, 0.95);
        c.stroke(r, 16.0 * u, if sel { 3.0 * u } else { 1.0 * u }, e.color(), 1.0);
        let cy = r.y + r.h * 0.32;
        c.blend(1);
        c.radial(r.x + r.w * 0.5, cy, 50.0 * u, e.color(), 0.8);
        c.blend(0);
        c.ring(r.x + r.w * 0.5, cy, 30.0 * u + (t * 3.0).sin() * 3.0 * u, 3.0 * u, e.color(), 1.0, 0.0, TAU);
        c.text(e.name(), r.x + r.w * 0.5, r.y + r.h * 0.58, 20.0 * u, WHITE, 1.0, Align::Center, true);
        let mut y = r.y + r.h * 0.68;
        for line in wrap(e.desc(), ((r.w - 30.0 * u) / (13.0 * u * 0.52)) as usize) {
            c.text(&line, r.x + r.w * 0.5, y, 13.0 * u, 0xc8d0e0, 1.0, Align::Center, false);
            y += 18.0 * u;
        }
        c.hit(r, i as u16 + 1);
    }
}

fn draw_shop(g: &Game, c: &mut Canvas, stock: &[(ShopEntry, bool)], t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x0d0a03, 0x2a200d);
    c.text("LE MARCHAND DES BAS-FONDS", w * 0.5, h * 0.08, 28.0 * u, GOLD, 1.0, Align::Center, true);
    let lumens = g.run.as_ref().map(|r| r.lumens).unwrap_or(0);
    c.text(&format!("{} Lumens", lumens), w * 0.5, h * 0.08 + 30.0 * u, 16.0 * u, WHITE, 1.0, Align::Center, true);
    let wd = (w - 40.0 * u).min(760.0 * u);
    let x = (w - wd) * 0.5;
    let ih = ((h * 0.72) / (stock.len() as f32 + 1.0) - 6.0 * u).min(40.0 * u);
    for (i, (e, sold)) in stock.iter().enumerate() {
        let r = Rect::new(x, h * 0.17 + i as f32 * (ih + 6.0 * u), wd, ih);
        let price = g.shop_price(*e);
        let label = if *sold { format!("{} — VENDU", g.shop_label(*e)) } else { format!("{}   ·   {} L", g.shop_label(*e), price) };
        c.button(r, &label, i == g.cursor, !*sold && lumens >= price, i as u16 + 1, GOLD);
    }
    let r = Rect::new(x, h * 0.17 + stock.len() as f32 * (ih + 6.0 * u), wd, ih);
    c.button(r, "Partir", g.cursor == stock.len(), true, stock.len() as u16 + 1, CYAN);
}

fn draw_rest(g: &Game, c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x030d08, 0x0d2a1a);
    c.blend(1);
    c.radial(w * 0.5, h * 0.35, 120.0 * u * (1.0 + (t * 4.0).sin() * 0.05), 0xffa040, 0.6);
    c.blend(0);
    c.text("UN FEU DE CAMP", w * 0.5, h * 0.14, 30.0 * u, 0xffe0b0, 1.0, Align::Center, true);
    let items = vec!["Se reposer : +60 % PV et Éther, relève les blessés".to_string(), "S'entraîner : +1 niveau au héros le plus faible".to_string(), "Méditer : ouvrir les Réflexes".to_string()];
    let wd = (w - 40.0 * u).min(620.0 * u);
    menu_list(c, &items, g.cursor, (w - wd) * 0.5, h * 0.52, wd, 46.0 * u, 0, 0xffa040);
}

fn draw_end(c: &mut Canvas, win: bool, frags: u32, tt: f32, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    if win {
        bg_gradient(c, t, 0x081a10, 0x2a5a3a);
    } else {
        bg_gradient(c, t, 0x0a0306, 0x2a0a14);
    }
    let a = (tt * 1.5).min(1.0);
    c.glow(30.0 * u, if win { GREEN } else { RED });
    c.text(if win { "LA PLANÈTE SE SOUVIENT" } else { "LA LUMIÈRE S'ÉTEINT" }, w * 0.5, h * 0.35, 40.0 * u, WHITE, a, Align::Center, true);
    c.glow(0.0, 0);
    let line = story::GAME_OVER_LINES[(frags as usize) % story::GAME_OVER_LINES.len()];
    c.text(if win { "Victoire ! Néo-Halcyon respire à nouveau." } else { line }, w * 0.5, h * 0.35 + 44.0 * u, 16.0 * u, 0xd0d8e8, a, Align::Center, false);
    c.text(&format!("+{} Fragments de mémoire", frags), w * 0.5, h * 0.55, 24.0 * u, 0xd0b0ff, a, Align::Center, true);
    c.text("A : retour au titre", w * 0.5, h * 0.75, 14.0 * u, DIM, a, Align::Center, false);
    c.hit(Rect::new(0.0, 0.0, w, h), 1);
}

fn draw_sanctuary(g: &Game, c: &mut Canvas, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    bg_gradient(c, t, 0x05040f, 0x1a1040);
    c.text("SANCTUAIRE DE LA MÉMOIRE", w * 0.5, h * 0.08, 30.0 * u, 0xe0d0ff, 1.0, Align::Center, true);
    c.text(&format!("{} Fragments", g.meta.fragments), w * 0.5, h * 0.08 + 32.0 * u, 18.0 * u, 0xd0b0ff, 1.0, Align::Center, true);
    let items = g.sanctuary_items();
    let mut labels: Vec<String> = items.iter().map(|(s, cost, av)| if *av { format!("{}   ·   {} F", s, cost) } else { format!("{}   (max)", s) }).collect();
    labels.push("Retour".into());
    let wd = (w - 40.0 * u).min(760.0 * u);
    menu_list(c, &labels, g.cursor, (w - wd) * 0.5, h * 0.2, wd, 42.0 * u, 0, 0xb07aff);
    let known = (0..g.catalog.len()).filter(|&i| g.selector_unlocked(i)).count();
    c.text(&format!("Conditions de Réflexe connues : {} / {}", known, g.catalog.len()), w * 0.5, h - 30.0 * u, 13.0 * u, DIM, 1.0, Align::Center, false);
}

// ---------------------------------------------------------------------------
// Superpositions
// ---------------------------------------------------------------------------

fn draw_pause(g: &Game, c: &mut Canvas, cursor: usize) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    c.rect(0.0, 0.0, w, h, 0x000000, 0.6);
    let wd = (w - 40.0 * u).min(560.0 * u);
    let r = Rect::new((w - wd) * 0.5, h * 0.14, wd, 56.0 * u * PAUSE_ITEMS as f32 + 90.0 * u);
    c.panel(r, 0.95);
    c.text("PAUSE", w * 0.5, r.y + 30.0 * u, 26.0 * u, WHITE, 1.0, Align::Center, true);
    let items: Vec<String> = (0..PAUSE_ITEMS).map(|i| g.pause_label(i)).collect();
    menu_list(c, &items, cursor, r.x + 20.0 * u, r.y + 64.0 * u, wd - 40.0 * u, 46.0 * u, 500, CYAN);
}

fn origin_tag(g: &Game, sel: crate::reflex::Selector) -> &'static str {
    match g.catalog.iter().find(|e| e.selector == sel).map(|e| e.origin) {
        Some(crate::reflex::Origin::Adaptation) => " ·adapt.",
        Some(crate::reflex::Origin::Extended) => " ·étendu",
        _ => "",
    }
}

fn draw_editor(g: &Game, c: &mut Canvas, ed: &Editor, t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    c.rect(0.0, 0.0, w, h, 0x02040a, 0.9);
    let portrait = h > w;
    let h_idx = ed.hero;
    let book = &g.meta.books[h_idx];
    let unlocked = g.slots_for(h_idx) as usize;
    c.text("GRIMOIRE DE RÉFLEXES", 20.0 * u, 26.0 * u, 22.0 * u, CYAN, 1.0, Align::Left, true);
    c.text(if g.meta.opts.extended { "Mode ÉTENDU" } else { "Mode FIDÈLE" }, 20.0 * u, 48.0 * u, 12.0 * u, DIM, 1.0, Align::Left, false);
    // Onglets héros
    let tab_w = 110.0 * u;
    let tx0 = if portrait { 20.0 * u } else { 300.0 * u };
    let ty = if portrait { 62.0 * u } else { 14.0 * u };
    for hh in 0..3 {
        let r = Rect::new(tx0 + hh as f32 * (tab_w + 6.0 * u), ty, tab_w, 34.0 * u);
        c.button(r, HEROES[hh].name, hh == h_idx, true, 200 + hh as u16 + 1, PLAYER_COLORS[hh]);
    }
    // Postures
    let px0 = tx0 + 3.0 * (tab_w + 6.0 * u) + 14.0 * u;
    for p in 0..3 {
        let r = Rect::new(px0 + p as f32 * 52.0 * u, ty, 46.0 * u, 34.0 * u);
        c.button(r, POSTURE_NAMES[p], p == book.active, true, 210 + p as u16 + 1, GOLD);
    }
    let mr = Rect::new(px0 + 3.0 * 52.0 * u + 10.0 * u, ty, 120.0 * u, 34.0 * u);
    c.button(mr, if book.enabled { "Réflexes : ON" } else { "Réflexes : OFF" }, !book.enabled, true, 221, if book.enabled { GREEN } else { RED });
    // Lignes
    let list_y = if portrait { 110.0 * u } else { 64.0 * u };
    let list_w = if portrait { w - 40.0 * u } else { w * 0.6 };
    let foot_h = 50.0 * u;
    let avail_h = if portrait { h * 0.55 } else { h - list_y - foot_h - 20.0 * u };
    let rh = (avail_h / MAX_SLOTS as f32 - 3.0 * u).min(38.0 * u);
    let posture = book.current();
    let unit = g.hero_unit(h_idx).and_then(|id| g.battle().map(|b| b.unit(id).clone()));
    for i in 0..MAX_SLOTS {
        let r = Rect::new(20.0 * u, list_y + i as f32 * (rh + 3.0 * u), list_w, rh);
        let slot = &posture.slots[i];
        let locked = i >= unlocked;
        let sel = i == ed.row;
        let bg = if sel { if ed.moving { 0x3a2a10 } else { 0x16243a } } else { 0x0a0f1c };
        c.rrect(r, 6.0 * u, bg, if locked { 0.5 } else { 0.95 });
        if sel {
            c.stroke(r, 6.0 * u, 2.0 * u, if ed.moving { GOLD } else { CYAN }, 1.0);
        }
        // Trace de décision
        if let Some(un) = &unit {
            if let Some(tr) = un.last_trace.iter().find(|x| x.slot as usize == i) {
                let col = match tr.outcome {
                    SlotOutcome::Chosen(_) => Some(GREEN),
                    SlotOutcome::NotExecutable(_) => Some(0xff9a7a),
                    _ => None,
                };
                if let Some(col) = col {
                    c.rect(r.x, r.y, 4.0 * u, r.h, col, 1.0);
                }
            }
        }
        let fs = (rh * 0.42).min(15.0 * u);
        c.text(&format!("{:>2}", i + 1), r.x + 22.0 * u, r.y + r.h * 0.5, fs, DIM, 1.0, Align::Right, true);
        if locked {
            c.text("🔒 verrouillé", r.x + 40.0 * u, r.y + r.h * 0.5, fs, 0x5a6478, 1.0, Align::Left, false);
            if let Some(rule) = &slot.rule {
                c.text(&format!("{} → {}", rule.selector.label(), action(rule.action).name), r.x + 170.0 * u, r.y + r.h * 0.5, fs * 0.9, 0x4a5468, 1.0, Align::Left, false);
            }
        } else {
            let on = slot.enabled && slot.rule.is_some();
            let pill = Rect::new(r.x + 34.0 * u, r.y + r.h * 0.2, 44.0 * u, r.h * 0.6);
            c.rrect(pill, r.h * 0.3, if on { 0x1a5a3a } else { 0x3a1a22 }, 1.0);
            c.text(if slot.rule.is_none() { "—" } else if slot.enabled { "ON" } else { "OFF" }, pill.x + pill.w * 0.5, pill.y + pill.h * 0.5, fs * 0.8, if on { GREEN } else { RED }, 1.0, Align::Center, true);
            match &slot.rule {
                Some(rule) => {
                    let a = action(rule.action);
                    let known = g.hero_actions(h_idx).contains(&rule.action) || rule.action == A_ATTACK;
                    let mut cond = rule.selector.label();
                    cond.push_str(origin_tag(g, rule.selector));
                    if let Some(e) = &rule.ext {
                        cond.push_str(&format!("  [ET {}]", e.label()));
                    }
                    let col = if slot.enabled { WHITE } else { 0x6b7280 };
                    let split = r.x + 90.0 * u + (list_w - 110.0 * u) * 0.6;
                    c.text(&cond, r.x + 90.0 * u, r.y + r.h * 0.5, fs, col, 1.0, Align::Left, false);
                    let cost = if a.mp > 0.0 {
                        format!("  {} ÉT", a.mp as i32)
                    } else if let Some(it) = a.item {
                        format!("  ×{}", g.run.as_ref().map(|r| r.inventory.count[it as usize]).unwrap_or(0))
                    } else {
                        String::new()
                    };
                    c.text(&format!("→ {}{}", a.name, cost), split, r.y + r.h * 0.5, fs, if !known { RED } else if slot.enabled { GOLD } else { 0x6b7280 }, 1.0, Align::Left, true);
                }
                None => c.text("(vide) — A pour programmer", r.x + 90.0 * u, r.y + r.h * 0.5, fs, 0x4a5468, 1.0, Align::Left, false),
            }
        }
        c.hit(r, 100 + i as u16 + 1);
    }
    // Panneau de détails
    let (dx, dy, dw) = if portrait { (20.0 * u, list_y + avail_h + 10.0 * u, w - 40.0 * u) } else { (list_w + 36.0 * u, list_y, w - list_w - 52.0 * u) };
    let dh = if portrait { h - dy - foot_h - 20.0 * u } else { avail_h };
    c.panel(Rect::new(dx, dy, dw, dh), 0.9);
    let mut y = dy + 22.0 * u;
    let maxc = ((dw - 24.0 * u) / (12.0 * u * 0.52)) as usize;
    if let Some(rule) = &posture.slots[ed.row].rule {
        let a = action(rule.action);
        c.text(&format!("Réflexe {}", ed.row + 1), dx + 12.0 * u, y, 15.0 * u, CYAN, 1.0, Align::Left, true);
        y += 22.0 * u;
        for line in wrap(&format!("SI {} : {}", rule.selector.label(), rule.selector.describe()), maxc) {
            c.text(&line, dx + 12.0 * u, y, 12.0 * u, WHITE, 1.0, Align::Left, false);
            y += 16.0 * u;
        }
        y += 4.0 * u;
        for line in wrap(&format!("ALORS {} ({}) : {} Coût {} ÉT · préparation {:.1} s.", a.name, a.kind.name(), a.desc, a.mp as i32, a.cast), maxc) {
            c.text(&line, dx + 12.0 * u, y, 12.0 * u, GOLD, 1.0, Align::Left, false);
            y += 16.0 * u;
        }
        y += 8.0 * u;
    }
    // Analyseur
    let actions = g.hero_actions(h_idx);
    let stock = |it: u8| g.run.as_ref().map(|r| r.inventory.count[it as usize]).unwrap_or(9);
    let adv = analyzer::analyze(posture, unlocked, &|a| a == A_ATTACK || actions.contains(&a), &stock);
    if !adv.is_empty() {
        c.text("Analyse", dx + 12.0 * u, y, 14.0 * u, 0xd0b0ff, 1.0, Align::Left, true);
        y += 18.0 * u;
        for a in adv.iter().take(7) {
            let col = match a.severity {
                Severity::Error => 0xff8a8a,
                Severity::Warn => 0xffd08a,
                Severity::Info => 0xa0b0c8,
            };
            for line in wrap(&format!("• {}", a.text), maxc) {
                if y > dy + dh - 14.0 * u {
                    break;
                }
                c.text(&line, dx + 12.0 * u, y, 11.0 * u, col, 1.0, Align::Left, false);
                y += 15.0 * u;
            }
        }
    }
    // Trace en direct
    if let Some(un) = &unit {
        if !un.last_trace.is_empty() && y < dy + dh - 60.0 * u {
            y += 6.0 * u;
            c.text("Dernière décision", dx + 12.0 * u, y, 14.0 * u, GREEN, 1.0, Align::Left, true);
            y += 18.0 * u;
            if let Some(b) = g.battle() {
                for l in ai::explain(b, un.id).iter().skip(1) {
                    if y > dy + dh - 14.0 * u {
                        break;
                    }
                    c.text(l, dx + 12.0 * u, y, 10.5 * u, if l.contains('✔') { GREEN } else { 0x9aa8c0 }, 1.0, Align::Left, false);
                    y += 14.0 * u;
                }
            }
        }
    }
    // Pied de page
    let fy = h - foot_h;
    let labels = [("Modifier (A)", 230u16), ("ON/OFF (X)", 231), ("▲", 232), ("▼", 233), (if ed.moving { "Déplacer ✓ (Y)" } else { "Déplacer (Y)" }, 236), ("Vider", 235), ("Fermer (B)", 234)];
    let bw = ((w - 40.0 * u) / labels.len() as f32 - 6.0 * u).min(150.0 * u);
    for (i, (lab, id)) in labels.iter().enumerate() {
        let r = Rect::new(20.0 * u + i as f32 * (bw + 6.0 * u), fy, bw, 38.0 * u);
        c.button(r, lab, false, true, id + 1, CYAN);
    }
    if !portrait {
        c.text("LB/RB : héros · LT/RT : posture · Select : tout ON/OFF", w - 20.0 * u, fy - 12.0 * u, 11.0 * u, DIM, 1.0, Align::Right, false);
    }
    if ed.mode != EdMode::Rows {
        draw_picker(g, c, ed, t);
    }
}

fn draw_picker(g: &Game, c: &mut Canvas, ed: &Editor, _t: f32) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    c.rect(0.0, 0.0, w, h, 0x000000, 0.55);
    let pw = (w - 40.0 * u).min(720.0 * u);
    let ph = h * 0.86;
    let r = Rect::new((w - pw) * 0.5, h * 0.07, pw, ph);
    c.panel(r, 0.97);
    let title = match ed.mode {
        EdMode::Group => "1/3 · Qui viser ?".to_string(),
        EdMode::Sel => "2/3 · Quelle condition ?".to_string(),
        EdMode::Act => format!("3/3 · Quelle action ? ({})", ed.sel.map(|s| s.label()).unwrap_or_default()),
        EdMode::Ext => "Condition supplémentaire (mode étendu)".to_string(),
        EdMode::Rows => String::new(),
    };
    c.text(&title, r.x + 20.0 * u, r.y + 26.0 * u, 18.0 * u, CYAN, 1.0, Align::Left, true);
    let n = ed.options.len();
    let ih = 30.0 * u;
    let desc_h = 64.0 * u;
    let visible = (((ph - 70.0 * u - desc_h) / (ih + 3.0 * u)) as usize).max(3);
    let start = if ed.pick >= visible / 2 { (ed.pick - visible / 2).min(n.saturating_sub(visible)) } else { 0 };
    for (k, i) in (start..n.min(start + visible)).enumerate() {
        let opt = &ed.options[i];
        let rr = Rect::new(r.x + 16.0 * u, r.y + 46.0 * u + k as f32 * (ih + 3.0 * u), pw - 32.0 * u, ih);
        let (label, ok) = match opt {
            PickOpt::Clear => ("✖ Vider cet emplacement".to_string(), true),
            PickOpt::Group(gr) => (
                match gr {
                    Group::Ally => "Allié — soigner, protéger, relever".to_string(),
                    Group::Foe => "Ennemi — attaquer, affaiblir, chaparder".to_string(),
                    Group::Myself => "Soi — se soigner, récupérer de l'Éther".to_string(),
                },
                true,
            ),
            PickOpt::Sel(s) => (format!("{}{}", s.label(), origin_tag(g, *s)), true),
            PickOpt::Act(a, ok) => {
                let d = action(*a);
                let cost = if d.mp > 0.0 {
                    format!(" · {} ÉT", d.mp as i32)
                } else if let Some(it) = d.item {
                    format!(" · stock ×{}", g.run.as_ref().map(|r| r.inventory.count[it as usize]).unwrap_or(0))
                } else {
                    String::new()
                };
                (format!("{}  ({}){}{}", d.name, d.kind.name(), cost, if *ok { "" } else { " — cible incompatible" }), *ok)
            }
            PickOpt::Ext(e) => (e.as_ref().map(|e| format!("ET {}", e.label())).unwrap_or_else(|| "Aucune (règle simple)".into()), true),
        };
        let sel = i == ed.pick;
        c.rrect(rr, 6.0 * u, if sel { 0x16243a } else { 0x0a0f1c }, 0.95);
        if sel {
            c.stroke(rr, 6.0 * u, 2.0 * u, CYAN, 1.0);
        }
        c.text(&label, rr.x + 12.0 * u, rr.y + rr.h * 0.5, 14.0 * u, if ok { WHITE } else { 0x7a8090 }, 1.0, Align::Left, sel);
        c.hit(rr, 300 + i as u16 + 1);
    }
    if n > visible {
        c.text(&format!("{} / {}", ed.pick + 1, n), r.x + pw - 20.0 * u, r.y + 26.0 * u, 12.0 * u, DIM, 1.0, Align::Right, false);
    }
    if ed.mode == EdMode::Sel && ed.hidden > 0 {
        c.text(&format!("{} conditions encore inconnues (Échos, marchands, Sanctuaire)", ed.hidden), r.x + 20.0 * u, r.y + ph - desc_h - 6.0 * u, 11.0 * u, 0xb090ff, 1.0, Align::Left, false);
    }
    let desc = match ed.options.get(ed.pick) {
        Some(PickOpt::Sel(s)) => s.describe(),
        Some(PickOpt::Act(a, _)) => {
            let d = action(*a);
            format!("{} Préparation {:.1} s · portée {}.", d.desc, d.cast, if d.range > 0.0 { format!("{} m", (d.range / 40.0) as i32) } else { "arme".into() })
        }
        Some(PickOpt::Clear) => "Supprime la règle de cet emplacement.".into(),
        Some(PickOpt::Ext(_)) => "Ajoute une condition (ET/OU/NON) évaluée sur la cible. Ignorée en mode fidèle.".into(),
        _ => "Choisissez le groupe de cibles visé par la règle.".into(),
    };
    let mut y = r.y + ph - desc_h + 14.0 * u;
    for line in wrap(&desc, ((pw - 40.0 * u) / (13.0 * u * 0.52)) as usize) {
        c.text(&line, r.x + 20.0 * u, y, 13.0 * u, 0xc8d0e0, 1.0, Align::Left, false);
        y += 17.0 * u;
    }
    c.text("A : choisir · B : retour · ←/→ : page", r.x + pw - 20.0 * u, r.y + ph - 12.0 * u, 11.0 * u, DIM, 1.0, Align::Right, false);
}

fn draw_command(g: &Game, c: &mut Canvas, cm: &Command) {
    let (w, h) = (c.w, c.h);
    let u = c.ui;
    let Some(b) = g.battle() else { return };
    let actor = b.unit(cm.actor);
    let pw = (w - 40.0 * u).min(460.0 * u);
    let n = if cm.stage == 1 { cm.actions.len() } else { cm.targets.len() };
    let ih = 28.0 * u;
    let visible = ((h * 0.6 / (ih + 3.0 * u)) as usize).max(4);
    let ph = (visible.min(n) as f32) * (ih + 3.0 * u) + 80.0 * u;
    let r = Rect::new((w - pw) * 0.5, (h - ph) * 0.35, pw, ph);
    c.panel(r, 0.95);
    let title = if cm.stage == 1 { format!("Ordre à {} (LB/RB : changer)", actor.name) } else { format!("{} → cible ?", cm.action.map(|a| action(a).name).unwrap_or("")) };
    c.text(&title, r.x + 16.0 * u, r.y + 22.0 * u, 16.0 * u, GOLD, 1.0, Align::Left, true);
    c.text(&format!("ÉT {}/{}", actor.mp as i32, actor.stats.max_mp as i32), r.x + pw - 16.0 * u, r.y + 22.0 * u, 12.0 * u, 0x6ab0ff, 1.0, Align::Right, false);
    let switch = Rect::new(r.x + pw - 130.0 * u, r.y + 36.0 * u, 114.0 * u, 22.0 * u);
    if cm.stage == 1 {
        c.button(switch, "Autre allié", false, true, 499, CYAN);
    }
    let start = if cm.cursor >= visible / 2 { (cm.cursor - visible / 2).min(n.saturating_sub(visible)) } else { 0 };
    for (k, i) in (start..n.min(start + visible)).enumerate() {
        let rr = Rect::new(r.x + 12.0 * u, r.y + 62.0 * u + k as f32 * (ih + 3.0 * u), pw - 24.0 * u, ih);
        let sel = i == cm.cursor;
        let (label, ok, id) = if cm.stage == 1 {
            let a = cm.actions[i];
            let d = action(a);
            let ok = ai::can_execute(b, cm.actor, a, false).is_ok();
            let extra = if d.mp > 0.0 {
                format!("   {} ÉT", d.mp as i32)
            } else if let Some(it) = d.item {
                format!("   ×{}", b.inventory.available(it))
            } else {
                String::new()
            };
            (format!("{}{}", d.name, extra), ok, 400 + i as u16 + 1)
        } else {
            let t = b.unit(cm.targets[i]);
            (format!("{}   PV {} %", t.name, (t.hp_ratio() * 100.0) as i32), true, 450 + i as u16 + 1)
        };
        c.rrect(rr, 6.0 * u, if sel { 0x16243a } else { 0x0a0f1c }, 0.95);
        if sel {
            c.stroke(rr, 6.0 * u, 2.0 * u, GOLD, 1.0);
        }
        c.text(&label, rr.x + 10.0 * u, rr.y + rr.h * 0.5, 14.0 * u, if ok { WHITE } else { 0x6b7280 }, 1.0, Align::Left, sel);
        c.hit(rr, id);
    }
    // Repère de cible dans le monde
    if cm.stage == 2 {
        if let Some(&t) = cm.targets.get(cm.cursor) {
            let mut g2_cam = g.cam_x;
            let _ = &mut g2_cam;
            let portrait = h > w * 1.05;
            let s = if portrait { (w / 560.0).max(0.35) } else { (h / 560.0).min(w / 700.0).max(0.35) };
            let gy = if portrait { h * 0.46 } else { h - 118.0 * u.max(0.6) };
            let tu = b.unit(t);
            let x = (tu.pos.x - g.cam_x) * s + w * 0.5;
            let y = gy - (tu.pos.y + 130.0 * tu.tpl.tpl().scale) * s;
            c.tri([(x - 14.0 * u, y - 24.0 * u), (x + 14.0 * u, y - 24.0 * u), (x, y)], GOLD, 1.0);
        }
    }
    c.text("A : valider · B : retour · Y : fermer", r.x + pw - 12.0 * u, r.y + ph - 10.0 * u, 11.0 * u, DIM, 1.0, Align::Right, false);
}

/// Cartes de joueur pour l'aide en bas de l'écran tactile (utilisé par l'hôte si besoin).
pub fn controller_label(c: Controller) -> String {
    match c {
        Controller::Human(p) => format!("J{}", p + 1),
        Controller::Ai => "IA".into(),
    }
}

#[allow(dead_code)]
fn unused(_: Vec2) {}
