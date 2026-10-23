//! Interface WebAssembly minimale (aucune dépendance) : l'hôte JS appelle
//! ces fonctions `extern "C"` et lit la mémoire linéaire.

use crate::game::{Game, PlayerIn, MAX_PLAYERS};
use crate::render::Canvas;

struct State {
    game: Game,
    canvas: Canvas,
    inputs: [PlayerIn; MAX_PLAYERS],
    sounds: Vec<u8>,
    out: Vec<u8>,
    inbuf: Vec<u8>,
}

static mut STATE: Option<State> = None;

#[allow(static_mut_refs)]
fn st() -> &'static mut State {
    unsafe { STATE.as_mut().expect("lr_init non appelé") }
}

#[no_mangle]
pub extern "C" fn lr_init(seed_lo: u32, seed_hi: u32) {
    let seed = (seed_hi as u64) << 32 | seed_lo as u64;
    unsafe {
        STATE = Some(State { game: Game::new(seed), canvas: Canvas::default(), inputs: Default::default(), sounds: Vec::new(), out: Vec::new(), inbuf: Vec::new() });
    }
}

/// Entrée du joueur `p` pour le prochain pas de simulation.
#[no_mangle]
pub extern "C" fn lr_input(p: u32, held: u32, cmd: u32) {
    if let Some(i) = st().inputs.get_mut(p as usize) {
        i.held = held as u16;
        i.cmd = cmd as u16;
    }
}

/// Un pas fixe de 1/60 s.
#[no_mangle]
pub extern "C" fn lr_step() {
    let s = st();
    let inputs = s.inputs;
    s.game.step(&inputs);
    s.sounds.extend(s.game.sounds.drain(..));
    for i in s.inputs.iter_mut() {
        i.cmd = 0;
    }
}

#[no_mangle]
pub extern "C" fn lr_set_joined(p: u32, joined: u32) {
    if let Some(pl) = st().game.players.get_mut(p as usize) {
        pl.joined = joined != 0;
    }
}

#[no_mangle]
pub extern "C" fn lr_set_online(on: u32) {
    st().game.online = on != 0;
}

#[no_mangle]
pub extern "C" fn lr_render(w: f32, h: f32) {
    let s = st();
    crate::ui::render(&mut s.game, &mut s.canvas, w, h);
}

#[no_mangle]
pub extern "C" fn lr_cmd_ptr() -> *const f32 {
    st().canvas.cmds.as_ptr()
}
#[no_mangle]
pub extern "C" fn lr_cmd_len() -> u32 {
    st().canvas.cmds.len() as u32
}
#[no_mangle]
pub extern "C" fn lr_str_ptr() -> *const u8 {
    st().canvas.strs.as_ptr()
}
#[no_mangle]
pub extern "C" fn lr_str_len() -> u32 {
    st().canvas.strs.len() as u32
}

/// Zone touchée -> identifiant de commande (0 = rien).
#[no_mangle]
pub extern "C" fn lr_tap(x: f32, y: f32) -> u32 {
    st().canvas.hit_test(x, y).map(|v| v as u32).unwrap_or(0)
}

/// Copie les sons en attente dans le tampon de sortie et renvoie leur nombre.
#[no_mangle]
pub extern "C" fn lr_take_sounds() -> u32 {
    let s = st();
    s.out.clear();
    s.out.extend(s.sounds.drain(..));
    s.out.len() as u32
}

#[no_mangle]
pub extern "C" fn lr_out_ptr() -> *const u8 {
    st().out.as_ptr()
}

#[no_mangle]
pub extern "C" fn lr_music() -> u32 {
    st().game.music as u32
}

#[no_mangle]
pub extern "C" fn lr_hash() -> u32 {
    st().game.hash()
}

#[no_mangle]
pub extern "C" fn lr_frame() -> u32 {
    st().game.frame as u32
}

/// Renvoie la longueur de la sauvegarde (dans le tampon de sortie) si elle a changé, sinon 0.
#[no_mangle]
pub extern "C" fn lr_save_meta() -> u32 {
    let s = st();
    if !s.game.meta_dirty {
        return 0;
    }
    s.game.meta_dirty = false;
    s.out = s.game.save_meta().into_bytes();
    s.out.len() as u32
}

#[no_mangle]
pub extern "C" fn lr_in_alloc(len: u32) -> *mut u8 {
    let s = st();
    s.inbuf = vec![0; len as usize];
    s.inbuf.as_mut_ptr()
}

#[no_mangle]
pub extern "C" fn lr_load_meta() {
    let s = st();
    if let Ok(t) = std::str::from_utf8(&s.inbuf) {
        let t = t.to_string();
        s.game.load_meta(&t);
    }
}
