//! Générateur pseudo-aléatoire déterministe (xorshift64*).
//!
//! La simulation n'utilise QUE ce générateur : même graine + mêmes entrées
//! = même partie. C'est la base du multijoueur en ligne en lockstep.

#[derive(Clone, Debug)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng { state: seed ^ 0x9E37_79B9_7F4A_7C15 };
        if r.state == 0 {
            r.state = 0xDEAD_BEEF;
        }
        r.next_u64();
        r
    }

    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.state;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.state = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }

    /// Flottant uniforme dans [0, 1).
    pub fn f32(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32) / ((1u64 << 24) as f32)
    }

    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f32()
    }

    /// Entier uniforme dans [0, n).
    pub fn below(&mut self, n: u32) -> u32 {
        if n == 0 {
            return 0;
        }
        (self.next_u64() % n as u64) as u32
    }

    pub fn chance(&mut self, p: f32) -> bool {
        self.f32() < p
    }

    pub fn state(&self) -> u64 {
        self.state
    }
}
