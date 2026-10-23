//! Rendu indépendant de la plateforme : le jeu produit une liste de commandes
//! de dessin (f32) et un tampon de textes UTF-8, que l'hôte (JS/Canvas2D)
//! exécute. Les zones cliquables (tactile/souris) sont enregistrées ici.

pub const OP_RECT: f32 = 1.0;
pub const OP_RRECT: f32 = 2.0;
pub const OP_STROKE: f32 = 3.0;
pub const OP_CIRCLE: f32 = 4.0;
pub const OP_RING: f32 = 5.0;
pub const OP_LINE: f32 = 6.0;
pub const OP_TRI: f32 = 7.0;
pub const OP_TEXT: f32 = 8.0;
pub const OP_GRAD: f32 = 9.0;
pub const OP_BLEND: f32 = 10.0;
pub const OP_GLOW: f32 = 11.0;
pub const OP_ELLIPSE: f32 = 12.0;
pub const OP_POLY: f32 = 14.0;
pub const OP_RADIAL: f32 = 15.0;

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl Rect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Rect {
        Rect { x, y, w, h }
    }
    pub fn contains(&self, px: f32, py: f32) -> bool {
        px >= self.x && px <= self.x + self.w && py >= self.y && py <= self.y + self.h
    }
}

#[derive(Default)]
pub struct Canvas {
    pub cmds: Vec<f32>,
    pub strs: Vec<u8>,
    /// (zone, identifiant de bouton)
    pub hits: Vec<(Rect, u16)>,
    pub w: f32,
    pub h: f32,
    /// Facteur d'échelle de l'interface.
    pub ui: f32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Align {
    Left,
    Center,
    Right,
}

impl Canvas {
    pub fn begin(&mut self, w: f32, h: f32) {
        self.cmds.clear();
        self.strs.clear();
        self.hits.clear();
        self.w = w;
        self.h = h;
        self.ui = if h > w * 1.05 { (w / 560.0).clamp(0.55, 2.2) } else { (w / 1100.0).min(h / 640.0).clamp(0.5, 2.2) };
    }

    fn c(color: u32) -> f32 {
        (color & 0xffffff) as f32
    }

    pub fn rect(&mut self, x: f32, y: f32, w: f32, h: f32, color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_RECT, x, y, w, h, Self::c(color), a]);
    }

    pub fn rrect(&mut self, r: Rect, rad: f32, color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_RRECT, r.x, r.y, r.w, r.h, rad, Self::c(color), a]);
    }

    pub fn stroke(&mut self, r: Rect, rad: f32, lw: f32, color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_STROKE, r.x, r.y, r.w, r.h, rad, lw, Self::c(color), a]);
    }

    pub fn circle(&mut self, x: f32, y: f32, r: f32, color: u32, a: f32) {
        if r > 0.0 {
            self.cmds.extend_from_slice(&[OP_CIRCLE, x, y, r, Self::c(color), a]);
        }
    }

    pub fn ring(&mut self, x: f32, y: f32, r: f32, lw: f32, color: u32, a: f32, a0: f32, a1: f32) {
        if r > 0.0 {
            self.cmds.extend_from_slice(&[OP_RING, x, y, r, lw, Self::c(color), a, a0, a1]);
        }
    }

    pub fn line(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, lw: f32, color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_LINE, x1, y1, x2, y2, lw, Self::c(color), a]);
    }

    pub fn tri(&mut self, p: [(f32, f32); 3], color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_TRI, p[0].0, p[0].1, p[1].0, p[1].1, p[2].0, p[2].1, Self::c(color), a]);
    }

    pub fn poly(&mut self, pts: &[(f32, f32)], color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_POLY, pts.len() as f32, Self::c(color), a]);
        for p in pts {
            self.cmds.push(p.0);
            self.cmds.push(p.1);
        }
    }

    pub fn ellipse(&mut self, x: f32, y: f32, rx: f32, ry: f32, rot: f32, color: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_ELLIPSE, x, y, rx.max(0.1), ry.max(0.1), rot, Self::c(color), a]);
    }

    pub fn grad(&mut self, x: f32, y: f32, w: f32, h: f32, c1: u32, c2: u32, a: f32) {
        self.cmds.extend_from_slice(&[OP_GRAD, x, y, w, h, Self::c(c1), Self::c(c2), a]);
    }

    pub fn radial(&mut self, x: f32, y: f32, r: f32, color: u32, a: f32) {
        if r > 0.0 {
            self.cmds.extend_from_slice(&[OP_RADIAL, x, y, r, Self::c(color), a]);
        }
    }

    /// 0 = normal, 1 = additif (lumières).
    pub fn blend(&mut self, mode: u8) {
        self.cmds.extend_from_slice(&[OP_BLEND, mode as f32]);
    }

    pub fn glow(&mut self, blur: f32, color: u32) {
        self.cmds.extend_from_slice(&[OP_GLOW, blur, Self::c(color)]);
    }

    pub fn text(&mut self, s: &str, x: f32, y: f32, size: f32, color: u32, a: f32, align: Align, bold: bool) {
        let off = self.strs.len() as f32;
        self.strs.extend_from_slice(s.as_bytes());
        let al = match align {
            Align::Left => 0.0,
            Align::Center => 1.0,
            Align::Right => 2.0,
        };
        self.cmds.extend_from_slice(&[OP_TEXT, x, y, size, Self::c(color), a, al, off, s.len() as f32, bold as u8 as f32]);
    }

    pub fn hit(&mut self, r: Rect, id: u16) {
        self.hits.push((r, id));
    }

    /// Dernière zone enregistrée qui contient le point (les plus récentes sont au-dessus).
    pub fn hit_test(&self, x: f32, y: f32) -> Option<u16> {
        self.hits.iter().rev().find(|(r, _)| r.contains(x, y)).map(|(_, id)| *id)
    }

    /// Bouton standard : fond, contour si sélectionné, libellé, zone cliquable.
    #[allow(clippy::too_many_arguments)]
    pub fn button(&mut self, r: Rect, label: &str, selected: bool, enabled: bool, id: u16, accent: u32) {
        let u = self.ui;
        let bg = if selected { 0x1d2a44 } else { 0x111827 };
        self.rrect(r, 8.0 * u, bg, 0.92);
        if selected {
            self.glow(14.0 * u, accent);
            self.stroke(r, 8.0 * u, 2.0 * u, accent, 1.0);
            self.glow(0.0, 0);
        } else {
            self.stroke(r, 8.0 * u, 1.0 * u, 0x3a4a66, 0.8);
        }
        let col = if enabled { 0xf2f6ff } else { 0x6b7280 };
        self.text(label, r.x + r.w * 0.5, r.y + r.h * 0.5, (r.h * 0.42).min(22.0 * u), col, 1.0, Align::Center, selected);
        self.hit(r, id);
    }

    pub fn panel(&mut self, r: Rect, a: f32) {
        let u = self.ui;
        self.rrect(r, 12.0 * u, 0x0a0f1c, a);
        self.stroke(r, 12.0 * u, 1.5 * u, 0x5ad1c9, 0.45);
    }

    pub fn bar(&mut self, x: f32, y: f32, w: f32, h: f32, ratio: f32, color: u32, back: u32) {
        let r = ratio.clamp(0.0, 1.0);
        self.rect(x, y, w, h, back, 0.85);
        if r > 0.0 {
            self.rect(x, y, w * r, h, color, 1.0);
            self.rect(x, y, w * r, h * 0.35, 0xffffff, 0.25);
        }
    }
}

/// Interpolation de couleurs RGB.
pub fn mix(a: u32, b: u32, t: f32) -> u32 {
    let t = t.clamp(0.0, 1.0);
    let ch = |s: u32| -> (f32, f32) { (((a >> s) & 255) as f32, ((b >> s) & 255) as f32) };
    let mut out = 0u32;
    for s in [16u32, 8, 0] {
        let (x, y) = ch(s);
        out |= ((x + (y - x) * t) as u32 & 255) << s;
    }
    out
}
