// Lumen Requiem — hôte navigateur.
// Le jeu entier (logique, IA, menus, rendu) vit dans le module Rust/WebAssembly.
// Ce fichier ne fait que : charger le module, exécuter la liste de dessin,
// lire clavier/manettes/tactile, jouer le son, sauvegarder et relayer le réseau.
"use strict";

const B = {
  LEFT: 1, RIGHT: 2, UP: 4, DOWN: 8, A: 16, B: 32, X: 64, Y: 128,
  LB: 256, RB: 512, LT: 1024, RT: 2048, START: 4096, SELECT: 8192,
};
const MAX_PLAYERS = 3;
const STEP_MS = 1000 / 60;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let wasm = null;
let mem = null;
const dec = new TextDecoder();

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------
async function loadWasm() {
  let bytes;
  if (window.LUMEN_WASM_B64) {
    const bin = atob(window.LUMEN_WASM_B64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    const r = await fetch("lumen.wasm");
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  const { instance } = await WebAssembly.instantiate(bytes, {});
  wasm = instance.exports;
  mem = wasm.memory;
}

function initGame(seed) {
  wasm.lr_init(seed >>> 0, Math.floor(seed / 4294967296) >>> 0);
  try {
    const saved = localStorage.getItem("lumen_meta");
    if (saved) {
      const b = new TextEncoder().encode(saved);
      const p = wasm.lr_in_alloc(b.length);
      new Uint8Array(mem.buffer, p, b.length).set(b);
      wasm.lr_load_meta();
    }
  } catch (e) { /* stockage indisponible : partie sans sauvegarde */ }
}

function saveMeta() {
  const n = wasm.lr_save_meta();
  if (!n) return;
  const s = dec.decode(new Uint8Array(mem.buffer, wasm.lr_out_ptr(), n));
  try { localStorage.setItem("lumen_meta", s); } catch (e) { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Entrées
// ---------------------------------------------------------------------------
const KEYS = {
  ArrowLeft: B.LEFT, KeyA: B.LEFT, KeyQ: B.LEFT,
  ArrowRight: B.RIGHT, KeyD: B.RIGHT,
  ArrowUp: B.UP, KeyW: B.UP, KeyZ: B.UP,
  ArrowDown: B.DOWN, KeyS: B.DOWN,
  Space: B.A, Enter: B.A,
  KeyJ: B.X, KeyK: B.B, Backspace: B.B,
  KeyL: B.LB, KeyI: B.RB, KeyU: B.LT, KeyO: B.RT,
  KeyH: B.Y, Tab: B.Y, KeyP: B.SELECT, Escape: B.START,
};
let keyBits = 0;
addEventListener("keydown", (e) => {
  const b = KEYS[e.code];
  if (b) { keyBits |= b; e.preventDefault(); }
  audio.resume();
});
addEventListener("keyup", (e) => { const b = KEYS[e.code]; if (b) keyBits &= ~b; });
addEventListener("blur", () => { keyBits = 0; touchBits = 0; });

function padBits(gp) {
  if (!gp) return 0;
  const p = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
  let b = 0;
  if (p(0)) b |= B.A; if (p(1)) b |= B.B; if (p(2)) b |= B.X; if (p(3)) b |= B.Y;
  if (p(4)) b |= B.LB; if (p(5)) b |= B.RB; if (p(6)) b |= B.LT; if (p(7)) b |= B.RT;
  if (p(8)) b |= B.SELECT; if (p(9)) b |= B.START;
  if (p(12)) b |= B.UP; if (p(13)) b |= B.DOWN; if (p(14)) b |= B.LEFT; if (p(15)) b |= B.RIGHT;
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  if (ax < -0.45) b |= B.LEFT; if (ax > 0.45) b |= B.RIGHT;
  if (ay < -0.55) b |= B.UP; if (ay > 0.55) b |= B.DOWN;
  return b;
}

// Tactile : joystick virtuel + boutons
let touchBits = 0;
let stickBits = 0;
const touchUi = document.getElementById("touch");
const isTouch = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;
if (isTouch) touchUi.hidden = false;
const stick = document.getElementById("stick");
const knob = document.getElementById("knob");
let stickId = null;
function stickMove(e) {
  const r = stick.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let dx = e.clientX - cx, dy = e.clientY - cy;
  const max = r.width * 0.4;
  const len = Math.hypot(dx, dy);
  if (len > max) { dx *= max / len; dy *= max / len; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  stickBits = 0;
  if (dx < -max * 0.35) stickBits |= B.LEFT;
  if (dx > max * 0.35) stickBits |= B.RIGHT;
  if (dy < -max * 0.5) stickBits |= B.UP;
  if (dy > max * 0.5) stickBits |= B.DOWN;
}
stick.addEventListener("pointerdown", (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); stickMove(e); audio.resume(); });
stick.addEventListener("pointermove", (e) => { if (e.pointerId === stickId) stickMove(e); });
const stickEnd = (e) => { if (e.pointerId === stickId) { stickId = null; stickBits = 0; knob.style.transform = ""; } };
stick.addEventListener("pointerup", stickEnd);
stick.addEventListener("pointercancel", stickEnd);
for (const btn of touchUi.querySelectorAll("button[data-b]")) {
  const bit = B[btn.dataset.b];
  const down = (e) => { e.preventDefault(); touchBits |= bit; btn.classList.add("on"); audio.resume(); };
  const up = (e) => { e.preventDefault(); touchBits &= ~bit; btn.classList.remove("on"); };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
}

// Tapes / clics sur l'interface dessinée par le jeu
let pendingCmd = 0;
canvas.addEventListener("pointerdown", (e) => {
  audio.resume();
  if (!wasm) return;
  const id = wasm.lr_tap(e.clientX, e.clientY);
  if (id) pendingCmd = id;
});

// Bits envoyés pour chaque joueur local.
function localInputs() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  const connected = pads.filter((p) => p && p.connected);
  const out = [];
  for (let i = 0; i < MAX_PLAYERS; i++) out.push(padBits(connected[i]));
  out[0] |= keyBits | touchBits | stickBits;
  if (connected.length || keyBits || touchBits || stickBits) audio.resume();
  return out;
}

// ---------------------------------------------------------------------------
// Rendu de la liste de commandes
// ---------------------------------------------------------------------------
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
addEventListener("resize", resize);
resize();

const hex = (c) => "#" + (c | 0).toString(16).padStart(6, "0");
const rgba = (c, a) => `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`;
const fontCache = new Map();
function font(size, bold) {
  const k = (size * 4 | 0) * 2 + (bold ? 1 : 0);
  let f = fontCache.get(k);
  if (!f) { f = `${bold ? "700 " : ""}${Math.max(6, size).toFixed(1)}px "Segoe UI", system-ui, sans-serif`; fontCache.set(k, f); }
  return f;
}

function draw() {
  wasm.lr_render(W, H);
  const n = wasm.lr_cmd_len();
  const cmds = new Float32Array(mem.buffer, wasm.lr_cmd_ptr(), n);
  const strs = new Uint8Array(mem.buffer, wasm.lr_str_ptr(), wasm.lr_str_len());
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.shadowBlur = 0;
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#03060d";
  ctx.fillRect(0, 0, W, H);
  let i = 0;
  while (i < n) {
    const op = cmds[i];
    switch (op) {
      case 1: ctx.globalAlpha = cmds[i + 6]; ctx.fillStyle = hex(cmds[i + 5]); ctx.fillRect(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4]); i += 7; break;
      case 2: {
        ctx.globalAlpha = cmds[i + 7]; ctx.fillStyle = hex(cmds[i + 6]);
        ctx.beginPath(); rr(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5]); ctx.fill(); i += 8; break;
      }
      case 3: {
        ctx.globalAlpha = cmds[i + 8]; ctx.strokeStyle = hex(cmds[i + 7]); ctx.lineWidth = cmds[i + 6];
        ctx.beginPath(); rr(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5]); ctx.stroke(); i += 9; break;
      }
      case 4: ctx.globalAlpha = cmds[i + 5]; ctx.fillStyle = hex(cmds[i + 4]); ctx.beginPath(); ctx.arc(cmds[i + 1], cmds[i + 2], cmds[i + 3], 0, 6.2832); ctx.fill(); i += 6; break;
      case 5: {
        ctx.globalAlpha = cmds[i + 6]; ctx.strokeStyle = hex(cmds[i + 5]); ctx.lineWidth = cmds[i + 4];
        ctx.beginPath(); ctx.arc(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 7], cmds[i + 8]); ctx.stroke(); i += 9; break;
      }
      case 6: {
        ctx.globalAlpha = cmds[i + 7]; ctx.strokeStyle = hex(cmds[i + 6]); ctx.lineWidth = cmds[i + 5]; ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(cmds[i + 1], cmds[i + 2]); ctx.lineTo(cmds[i + 3], cmds[i + 4]); ctx.stroke(); i += 8; break;
      }
      case 7: {
        ctx.globalAlpha = cmds[i + 8]; ctx.fillStyle = hex(cmds[i + 7]);
        ctx.beginPath(); ctx.moveTo(cmds[i + 1], cmds[i + 2]); ctx.lineTo(cmds[i + 3], cmds[i + 4]); ctx.lineTo(cmds[i + 5], cmds[i + 6]); ctx.closePath(); ctx.fill(); i += 9; break;
      }
      case 8: {
        const off = cmds[i + 7], len = cmds[i + 8];
        ctx.globalAlpha = cmds[i + 5]; ctx.fillStyle = hex(cmds[i + 4]);
        ctx.font = font(cmds[i + 3], cmds[i + 9] > 0);
        ctx.textAlign = cmds[i + 6] === 1 ? "center" : cmds[i + 6] === 2 ? "right" : "left";
        ctx.fillText(dec.decode(strs.subarray(off, off + len)), cmds[i + 1], cmds[i + 2]);
        i += 10; break;
      }
      case 9: {
        const g = ctx.createLinearGradient(0, cmds[i + 2], 0, cmds[i + 2] + cmds[i + 4]);
        g.addColorStop(0, hex(cmds[i + 5])); g.addColorStop(1, hex(cmds[i + 6]));
        ctx.globalAlpha = cmds[i + 7]; ctx.fillStyle = g; ctx.fillRect(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4]); i += 8; break;
      }
      case 10: ctx.globalCompositeOperation = cmds[i + 1] === 1 ? "lighter" : "source-over"; i += 2; break;
      case 11: ctx.shadowBlur = cmds[i + 1]; ctx.shadowColor = hex(cmds[i + 2]); i += 3; break;
      case 12: {
        ctx.globalAlpha = cmds[i + 7]; ctx.fillStyle = hex(cmds[i + 6]);
        ctx.beginPath(); ctx.ellipse(cmds[i + 1], cmds[i + 2], cmds[i + 3], cmds[i + 4], cmds[i + 5], 0, 6.2832); ctx.fill(); i += 8; break;
      }
      case 14: {
        const np = cmds[i + 1];
        ctx.globalAlpha = cmds[i + 3]; ctx.fillStyle = hex(cmds[i + 2]);
        ctx.beginPath();
        for (let k = 0; k < np; k++) {
          const x = cmds[i + 4 + k * 2], y = cmds[i + 5 + k * 2];
          if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath(); ctx.fill(); i += 4 + np * 2; break;
      }
      case 15: {
        const x = cmds[i + 1], y = cmds[i + 2], r = cmds[i + 3], c = cmds[i + 4];
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(c, 1)); g.addColorStop(1, rgba(c, 0));
        ctx.globalAlpha = cmds[i + 5]; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2); i += 6; break;
      }
      default: i = n; // commande inconnue : on arrête proprement
    }
  }
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}
function rr(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---------------------------------------------------------------------------
// Audio : bruitages et musiques ORIGINALES, synthétisés en temps réel
// ---------------------------------------------------------------------------
const audio = (() => {
  let ac = null, master = null, musicGain = null, sfxGain = null, noiseBuf = null;
  let track = 0, nextTime = 0, stepIdx = 0, timer = null;
  const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

  function ensure() {
    if (ac) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = 0.7; master.connect(ac.destination);
    musicGain = ac.createGain(); musicGain.gain.value = 0.32; musicGain.connect(master);
    sfxGain = ac.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    timer = setInterval(schedule, 40);
    return true;
  }
  function resume() { if (ensure() && ac.state === "suspended") ac.resume(); }

  function tone(dest, type, f0, f1, t, dur, vol, attack = 0.005) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dest, t, dur, vol, freq, q = 1, type = "bandpass") {
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }

  const lastPlay = new Map();
  function sfx(code) {
    if (!ac || ac.state !== "running") return;
    const t = ac.currentTime;
    const prev = lastPlay.get(code) || 0;
    if (t - prev < 0.035) return;
    lastPlay.set(code, t);
    const o = sfxGain;
    switch (code) {
      case 1: noise(o, t, 0.09, 0.5, 1800, 0.8); tone(o, "square", 180, 70, t, 0.08, 0.15); break;
      case 2: noise(o, t, 0.16, 0.7, 2600, 0.6); tone(o, "sawtooth", 320, 60, t, 0.18, 0.25); break;
      case 3: noise(o, t, 0.12, 0.35, 5200, 2.5, "highpass"); break;
      case 4: tone(o, "sine", 660, 1320, t, 0.25, 0.12); tone(o, "triangle", 990, 1980, t + 0.05, 0.2, 0.06); break;
      case 5: [0, 4, 7, 12].forEach((s, k) => tone(o, "sine", midi(72 + s), 0, t + k * 0.05, 0.3, 0.12)); break;
      case 6: tone(o, "triangle", 520, 880, t, 0.22, 0.14); break;
      case 7: tone(o, "sawtooth", 300, 120, t, 0.3, 0.1); break;
      case 8: noise(o, t, 0.4, 0.5, 600, 0.7); tone(o, "square", 220, 40, t, 0.35, 0.18); break;
      case 9: tone(o, "square", 300, 560, t, 0.08, 0.06); break;
      case 10: tone(o, "square", 880, 0, t, 0.04, 0.05); break;
      case 11: tone(o, "square", 988, 0, t, 0.05, 0.07); tone(o, "square", 1318, 0, t + 0.05, 0.08, 0.07); break;
      case 12: tone(o, "square", 660, 330, t, 0.09, 0.06); break;
      case 13: [0, 4, 7, 12, 16].forEach((s, k) => tone(o, "square", midi(67 + s), 0, t + k * 0.07, 0.18, 0.08)); break;
      case 14: noise(o, t, 1.4, 0.6, 400, 0.4, "lowpass"); tone(o, "sawtooth", 80, 640, t, 1.2, 0.2, 0.3); tone(o, "sine", 1200, 2400, t + 0.6, 0.8, 0.1); break;
      case 15: noise(o, t, 1.0, 0.9, 300, 0.5, "lowpass"); tone(o, "sine", 120, 30, t, 0.9, 0.5); break;
      case 16: tone(o, "square", 1568, 0, t, 0.06, 0.06); tone(o, "square", 2093, 0, t + 0.06, 0.12, 0.06); break;
      case 17: tone(o, "triangle", 1200, 800, t, 0.1, 0.12); noise(o, t, 0.06, 0.2, 4000, 2); break;
      case 18: noise(o, t, 0.12, 0.2, 3000, 4, "highpass"); break;
      case 19: tone(o, "triangle", 1046, 1567, t, 0.12, 0.1); break;
      case 20: [0, 4, 7, 12].forEach((s, k) => tone(o, "triangle", midi(67 + s), 0, t + k * 0.09, 0.4, 0.12)); break;
      case 21: [0, -3, -7, -12].forEach((s, k) => tone(o, "triangle", midi(64 + s), 0, t + k * 0.18, 0.5, 0.12)); break;
      case 22: noise(o, t, 0.5, 0.8, 2400, 0.3); tone(o, "sawtooth", 1400, 90, t, 0.4, 0.15); break;
      case 23: tone(o, "sine", 2400, 1800, t, 0.25, 0.08); noise(o, t, 0.3, 0.25, 7000, 3, "highpass"); break;
      case 24: noise(o, t, 0.45, 0.6, 900, 0.5); tone(o, "sawtooth", 200, 60, t, 0.35, 0.12); break;
      case 25: tone(o, "square", 140, 110, t, 0.12, 0.08); break;
      default: break;
    }
  }

  // --- Musiques : partitions originales (pas de citation d'œuvres existantes) ---
  // Chaque piste : tempo, nombre de pas par temps, et des motifs en notes MIDI (0 = silence).
  const R = 0;
  const TRACKS = {
    1: { bpm: 74, div: 2, wave: "triangle", leadVol: 0.12,
      lead: [69, R, 72, 76, 74, R, 72, 71, 69, R, 64, R, 67, 69, 71, R, 72, R, 76, 79, 77, 76, 74, R, 76, R, 72, R, 69, R, R, R],
      bass: [45, R, R, R, 41, R, R, R, 43, R, R, R, 40, R, R, R, 45, R, R, R, 41, R, R, R, 38, R, R, R, 40, R, R, R],
      arp: [57, 60, 64, 60, 53, 57, 60, 57, 55, 59, 62, 59, 52, 55, 59, 55], drums: "" },
    2: { bpm: 96, div: 2, wave: "triangle", leadVol: 0.1,
      lead: [62, R, 65, R, 69, 67, 65, R, 64, R, 62, R, 60, 62, 64, R, 65, R, 69, R, 72, 71, 69, R, 67, R, 64, R, 62, R, R, R],
      bass: [38, R, 45, R, 36, R, 43, R, 34, R, 41, R, 36, R, 43, R],
      arp: [62, 65, 69, 65, 60, 64, 67, 64], drums: "k...h...k...h..." },
    3: { bpm: 150, div: 4, wave: "square", leadVol: 0.07,
      lead: [64, R, 67, R, 71, R, 72, 71, 69, R, 67, R, 66, R, 67, R, 64, R, 67, R, 71, R, 74, 72, 71, R, 69, R, 71, R, R, R,
             76, R, 74, R, 72, R, 71, R, 69, R, 71, 72, 74, R, 71, R, 67, R, 69, R, 71, R, 66, R, 64, R, R, R, R, R, R, R],
      bass: [40, 40, 52, 40, 40, 52, 40, 50, 36, 36, 48, 36, 38, 38, 50, 38],
      arp: [], drums: "k.h.s.h.k.k.s.hh" },
    4: { bpm: 160, div: 4, wave: "sawtooth", leadVol: 0.06,
      lead: [60, R, 63, R, 67, R, 68, R, 67, R, 63, R, 62, R, 63, R, 60, R, 63, R, 67, R, 70, 68, 67, R, 65, R, 67, R, R, R],
      bass: [36, 36, 48, 36, 36, 46, 36, 44, 32, 32, 44, 32, 34, 34, 46, 35],
      arp: [], drums: "k.hsk.hsk.hsk.ss" },
    5: { bpm: 120, div: 2, wave: "square", leadVol: 0.08,
      lead: [72, 72, 76, 79, R, 77, 76, 74, 76, R, 72, R, 74, 76, 77, 79, 81, R, 79, 77, 76, 74, 72, R, 74, R, 76, R, 72, R, R, R],
      bass: [48, R, 55, R, 53, R, 55, R, 45, R, 52, R, 53, R, 55, R],
      arp: [60, 64, 67, 72], drums: "k...s...k.k.s..." },
    6: { bpm: 68, div: 2, wave: "sine", leadVol: 0.12,
      lead: [65, R, R, 68, 72, R, 70, 68, 67, R, R, R, 63, R, 65, R, 68, R, R, 70, 72, R, 75, 73, 72, R, 70, R, 68, R, R, R],
      bass: [41, R, R, R, 37, R, R, R, 39, R, R, R, 36, R, R, R],
      arp: [53, 56, 60, 56, 49, 53, 56, 53, 51, 55, 58, 55, 48, 51, 55, 51], drums: "" },
    7: { bpm: 172, div: 4, wave: "sawtooth", leadVol: 0.06,
      lead: [62, R, 65, 69, 74, R, 72, R, 70, R, 69, R, 65, R, 67, R, 69, R, 70, R, 74, R, 77, 76, 74, R, 73, R, 74, R, R, R,
             74, 72, 70, 69, 70, R, 65, R, 67, 69, 70, 72, 73, R, 69, R, 62, R, R, R, 61, R, 62, R, R, R, R, R, R, R, R, R],
      bass: [38, 38, 50, 38, 34, 34, 46, 34, 36, 36, 48, 36, 33, 33, 45, 37],
      arp: [62, 65, 69, 74], drums: "k.hsk.hsk.hskkss" },
  };

  function schedule() {
    if (!ac || ac.state !== "running") return;
    const tr = TRACKS[track];
    if (!tr) return;
    const stepDur = 60 / tr.bpm / tr.div;
    while (nextTime < ac.currentTime + 0.12) {
      const i = stepIdx;
      const t = nextTime;
      const ln = tr.lead[i % tr.lead.length];
      if (ln) tone(musicGain, tr.wave, midi(ln), 0, t, stepDur * 1.8, tr.leadVol);
      if (tr.div === 4 ? i % 2 === 0 : true) {
        const bi = tr.div === 4 ? (i / 2) | 0 : i;
        const bn = tr.bass[bi % tr.bass.length];
        if (bn) tone(musicGain, "triangle", midi(bn), 0, t, stepDur * (tr.div === 4 ? 1.8 : 3.5), 0.16);
      }
      if (tr.arp.length) {
        const an = tr.arp[i % tr.arp.length];
        if (an) tone(musicGain, "sine", midi(an + 12), 0, t, stepDur * 1.2, 0.035);
      }
      if (tr.drums) {
        const d = tr.drums[i % tr.drums.length];
        if (d === "k") tone(musicGain, "sine", 140, 40, t, 0.18, 0.4);
        else if (d === "s") noise(musicGain, t, 0.12, 0.3, 1800, 0.7);
        else if (d === "h") noise(musicGain, t, 0.04, 0.12, 8000, 1, "highpass");
      }
      nextTime += stepDur;
      stepIdx++;
    }
  }

  function setTrack(n) {
    if (n === track) return;
    track = n;
    stepIdx = 0;
    if (ac) {
      nextTime = ac.currentTime + 0.05;
      musicGain.gain.cancelScheduledValues(ac.currentTime);
      musicGain.gain.setValueAtTime(0.0001, ac.currentTime);
      musicGain.gain.exponentialRampToValueAtTime(0.32, ac.currentTime + 0.6);
    }
  }
  return { resume, sfx, setTrack };
})();

// ---------------------------------------------------------------------------
// Réseau : lockstep par relais WebSocket
// ---------------------------------------------------------------------------
const net = {
  ws: null, slot: -1, peers: 0, started: false, delay: 4,
  buf: new Map(), // frame -> tableau d'entrées [ [held, cmd] | undefined ]
  slots: 0, sentUpTo: -1, left: new Set(),
};
const netPanel = document.getElementById("net");
const netStatus = document.getElementById("net-status");
const netUrl = document.getElementById("net-url");
netUrl.value = (location.protocol === "https:" ? "wss://" : "ws://") + (location.hostname || "localhost") + ":9001";
document.getElementById("net-btn").onclick = () => { netPanel.hidden = !netPanel.hidden; };
document.getElementById("net-close").onclick = () => { netPanel.hidden = true; };
document.getElementById("net-join").onclick = () => {
  try {
    const ws = new WebSocket(netUrl.value);
    net.ws = ws;
    netStatus.textContent = "Connexion…";
    ws.onopen = () => ws.send(JSON.stringify({ t: "join", room: document.getElementById("net-room").value || "halcyon" }));
    ws.onclose = () => { netStatus.textContent = "Déconnecté."; net.ws = null; };
    ws.onerror = () => { netStatus.textContent = "Serveur injoignable. Lancez « cargo run -p lumen_server »."; };
    ws.onmessage = (ev) => onNet(JSON.parse(ev.data));
  } catch (e) { netStatus.textContent = "Adresse invalide."; }
};
document.getElementById("net-start").onclick = () => {
  if (net.ws && net.slot === 0) net.ws.send(JSON.stringify({ t: "start", seed: Math.floor(Math.random() * 2 ** 31) }));
};
function onNet(m) {
  if (m.t === "welcome") {
    net.slot = m.slot; net.peers = m.peers;
    netStatus.textContent = `Connecté : vous êtes le joueur ${m.slot + 1} (${m.peers} dans le salon).`;
    document.getElementById("net-start").disabled = m.slot !== 0;
  } else if (m.t === "peers") {
    net.peers = m.peers;
    netStatus.textContent = `Joueur ${net.slot + 1} · ${m.peers} joueur(s) dans le salon.` + (net.slot === 0 ? " Lancez quand tout le monde est là." : " En attente de l'hôte…");
  } else if (m.t === "start") {
    net.started = true; net.slots = Math.min(m.players, MAX_PLAYERS); net.buf.clear(); net.left.clear(); net.sentUpTo = -1;
    initGame(m.seed);
    wasm.lr_set_online(1);
    for (let p = 0; p < MAX_PLAYERS; p++) wasm.lr_set_joined(p, p < net.slots ? 1 : 0);
    for (let f = 0; f < net.delay; f++) for (let s = 0; s < net.slots; s++) netStore(f, s, 0, 0);
    netPanel.hidden = true;
    frameNo = 0;
  } else if (m.t === "in") {
    netStore(m.f, m.s, m.h, m.c);
  } else if (m.t === "left") {
    net.left.add(m.s);
  } else if (m.t === "hash" && m.s !== net.slot) {
    if (wasm.lr_frame() === m.f && wasm.lr_hash() !== m.h) netStatus.textContent = "⚠ Désynchronisation détectée.";
  }
}
function netStore(f, s, h, c) {
  let a = net.buf.get(f);
  if (!a) { a = []; net.buf.set(f, a); }
  a[s] = [h, c];
}

// ---------------------------------------------------------------------------
// Boucle principale
// ---------------------------------------------------------------------------
let acc = 0, last = performance.now(), frameNo = 0, lastMusic = -1;
function stepLocal() {
  const bits = localInputs();
  for (let p = 0; p < MAX_PLAYERS; p++) wasm.lr_input(p, bits[p], p === 0 ? pendingCmd : 0);
  pendingCmd = 0;
  wasm.lr_step();
}
function stepOnline() {
  // Envoie notre entrée pour la frame (actuelle + délai), une seule fois par frame.
  const target = frameNo + net.delay;
  if (net.sentUpTo < target) {
    const bits = localInputs();
    const mine = bits[0] | bits[1] | bits[2];
    net.ws && net.ws.send(JSON.stringify({ t: "in", f: target, h: mine, c: pendingCmd }));
    netStore(target, net.slot, mine, pendingCmd);
    pendingCmd = 0;
    net.sentUpTo = target;
  }
  const a = net.buf.get(frameNo);
  for (let s = 0; s < net.slots; s++) {
    if (net.left.has(s)) continue;
    if (!a || !a[s]) return false; // on attend les autres joueurs
  }
  for (let p = 0; p < MAX_PLAYERS; p++) {
    const e = a && a[p] ? a[p] : [0, 0];
    wasm.lr_input(p, e[0], e[1]);
  }
  wasm.lr_step();
  net.buf.delete(frameNo);
  frameNo++;
  if (frameNo % 120 === 0 && net.ws) net.ws.send(JSON.stringify({ t: "hash", f: wasm.lr_frame(), h: wasm.lr_hash() }));
  return true;
}

function loop(now) {
  acc += Math.min(now - last, 250);
  last = now;
  let steps = 0;
  while (acc >= STEP_MS && steps < 5) {
    if (net.started) {
      if (!stepOnline()) { acc = Math.min(acc, STEP_MS); break; }
    } else {
      stepLocal();
    }
    acc -= STEP_MS;
    steps++;
  }
  const ns = wasm.lr_take_sounds();
  if (ns) {
    const s = new Uint8Array(mem.buffer, wasm.lr_out_ptr(), ns).slice();
    for (const c of s) audio.sfx(c);
  }
  const m = wasm.lr_music();
  if (m !== lastMusic) { audio.setTrack(m); lastMusic = m; }
  draw();
  if ((now | 0) % 60 < 17) saveMeta();
  requestAnimationFrame(loop);
}

window.lumenDebug = () => wasm && { frame: wasm.lr_frame(), hash: wasm.lr_hash() };

(async () => {
  const msg = document.getElementById("boot-msg");
  try {
    await loadWasm();
    initGame(Date.now());
    msg.textContent = "Prêt.";
    const go = document.getElementById("boot-go");
    go.hidden = false;
    const start = () => {
      audio.resume();
      document.getElementById("boot").remove();
      if (document.documentElement.requestFullscreen && isTouch) document.documentElement.requestFullscreen().catch(() => {});
      last = performance.now();
      requestAnimationFrame(loop);
    };
    go.onclick = start;
    addEventListener("keydown", function k(e) { if (e.code === "Enter" || e.code === "Space") { removeEventListener("keydown", k); if (document.getElementById("boot")) start(); } });
  } catch (e) {
    msg.textContent = "Impossible de charger le jeu : " + e;
  }
})();
