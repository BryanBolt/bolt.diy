// Périphériques d'entrée : chacun produit un bitmask IN.* par frame.
import { IN } from '../sim/types';

export interface InputDevice {
  readonly id: string;
  readonly label: string;
  readonly kind: 'keyboard' | 'gamepad' | 'touch';
  poll(): number;
  /** vrai si un bouton d'action vient d'être pressé (pour "appuie pour rejoindre") */
  justPressedAction(): boolean;
  rumble?(ms: number, strength: number): void;
  connected(): boolean;
}

export interface KeyMap {
  left: string[];
  right: string[];
  up: string[];
  down: string[];
  light: string[];
  heavy: string[];
  jump: string[];
  guard: string[];
  special: string[];
  super: string[];
  dash: string[];
  pause: string[];
  confirm: string[];
}

// Les codes physiques (KeyW, KeyA...) marchent à la fois en AZERTY (ZQSD) et en QWERTY (WASD).
export const KEYMAP_P1: KeyMap = {
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  light: ['KeyJ'],
  heavy: ['KeyK'],
  jump: ['Space', 'KeyL'],
  guard: ['KeyU', 'ShiftRight'],
  special: ['KeyI'],
  super: ['KeyO'],
  dash: ['ShiftLeft'],
  pause: ['Escape', 'KeyP'],
  confirm: ['Enter', 'KeyJ', 'Space'],
};

export const KEYMAP_P2: KeyMap = {
  left: ['Numpad4'],
  right: ['Numpad6'],
  up: ['Numpad8'],
  down: ['Numpad5', 'Numpad2'],
  light: ['Numpad1'],
  heavy: ['Numpad3'],
  jump: ['Numpad0'],
  guard: ['Numpad7'],
  special: ['Numpad9'],
  super: ['NumpadAdd'],
  dash: ['NumpadDecimal'],
  pause: ['NumpadMultiply'],
  confirm: ['NumpadEnter', 'Numpad1'],
};

export const KEY_LABELS: Record<string, string> = {
  KeyA: 'Q / A', KeyD: 'D', KeyW: 'Z / W', KeyS: 'S', KeyJ: 'J', KeyK: 'K', KeyL: 'L', KeyU: 'U', KeyI: 'I', KeyO: 'O', Space: 'Espace',
  ShiftLeft: 'Maj G', ShiftRight: 'Maj D', Escape: 'Échap', KeyP: 'P', Enter: 'Entrée', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Numpad0: 'Num 0', Numpad1: 'Num 1', Numpad2: 'Num 2', Numpad3: 'Num 3', Numpad4: 'Num 4', Numpad5: 'Num 5', Numpad6: 'Num 6', Numpad7: 'Num 7', Numpad8: 'Num 8', Numpad9: 'Num 9',
  NumpadAdd: 'Num +', NumpadDecimal: 'Num .', NumpadMultiply: 'Num *', NumpadEnter: 'Num Entrée',
};

export function keyLabel(code: string): string {
  return KEY_LABELS[code] ?? code.replace(/^Key|^Digit/, '');
}

const pressedKeys = new Set<string>();
const tappedKeys = new Set<string>(); // touches pressées puis relâchées entre deux lectures (frappes très courtes)
let keyboardListening = false;

export function initKeyboard(): void {
  if (keyboardListening) return;
  keyboardListening = true;
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    pressedKeys.add(e.code);
    tappedKeys.add(e.code);
    // évite le scroll avec espace / flèches pendant le jeu
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code) && document.activeElement?.tagName !== 'INPUT') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => pressedKeys.delete(e.code));
  window.addEventListener('blur', () => pressedKeys.clear());
}

export function isKeyDown(code: string): boolean {
  return pressedKeys.has(code) || tappedKeys.has(code);
}

/** À appeler une fois par frame après la lecture de tous les périphériques. */
export function flushKeyTaps(): void {
  tappedKeys.clear();
}

export class KeyboardDevice implements InputDevice {
  readonly kind = 'keyboard' as const;
  private prevBits = 0;
  private lastBits = 0;
  constructor(public readonly id: string, public readonly label: string, public map: KeyMap) {
    initKeyboard();
  }
  private down(codes: string[]): boolean {
    for (const c of codes) if (pressedKeys.has(c) || tappedKeys.has(c)) return true;
    return false;
  }
  poll(): number {
    const m = this.map;
    let b = 0;
    if (this.down(m.left)) b |= IN.LEFT;
    if (this.down(m.right)) b |= IN.RIGHT;
    if (this.down(m.up)) b |= IN.UP;
    if (this.down(m.down)) b |= IN.DOWN;
    if (this.down(m.light)) b |= IN.LIGHT;
    if (this.down(m.heavy)) b |= IN.HEAVY;
    if (this.down(m.jump)) b |= IN.JUMP;
    if (this.down(m.guard)) b |= IN.GUARD;
    if (this.down(m.special)) b |= IN.SPECIAL;
    if (this.down(m.super)) b |= IN.SUPER;
    if (this.down(m.dash)) b |= IN.DASH;
    if (this.down(m.pause)) b |= IN.PAUSE;
    if (this.down(m.confirm)) b |= IN.CONFIRM;
    this.prevBits = this.lastBits;
    this.lastBits = b;
    return b;
  }
  justPressedAction(): boolean {
    const act = IN.LIGHT | IN.HEAVY | IN.JUMP | IN.CONFIRM;
    return (this.lastBits & act & ~this.prevBits) !== 0;
  }
  connected(): boolean {
    return true;
  }
}

// ---- Manette (API Gamepad, mapping standard) ----
export interface PadMap {
  light: number;
  heavy: number;
  jump: number;
  guard: number;
  special: number;
  super: number;
  dash: number;
  pause: number;
}
export const PADMAP_DEFAULT: PadMap = { light: 2, heavy: 3, jump: 0, guard: 1, special: 5, super: 7, dash: 4, pause: 9 };
export const PAD_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Select', 'Start', 'L3', 'R3', '↑', '↓', '←', '→', 'Home'];

export class GamepadDevice implements InputDevice {
  readonly kind = 'gamepad' as const;
  private prevBits = 0;
  private lastBits = 0;
  constructor(public readonly index: number, public map: PadMap = PADMAP_DEFAULT) {}
  get id(): string {
    return `pad${this.index}`;
  }
  get label(): string {
    const gp = navigator.getGamepads?.()[this.index];
    const name = gp?.id ?? 'Manette';
    return `Manette ${this.index + 1} · ${name.replace(/\(.*\)/, '').replace(/vendor.*$/i, '').trim().slice(0, 22)}`;
  }
  private gp(): Gamepad | null {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    return list[this.index] ?? null;
  }
  connected(): boolean {
    return !!this.gp();
  }
  poll(): number {
    const gp = this.gp();
    let b = 0;
    if (gp) {
      const btn = (i: number) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
      const ax = gp.axes[0] ?? 0;
      const ay = gp.axes[1] ?? 0;
      const dead = 0.3;
      if (ax < -dead || btn(14)) b |= IN.LEFT;
      if (ax > dead || btn(15)) b |= IN.RIGHT;
      if (ay < -dead || btn(12)) b |= IN.UP;
      if (ay > dead || btn(13)) b |= IN.DOWN;
      if (Math.abs(ax) > 0.9) b |= IN.DASH; // stick à fond = course
      const m = this.map;
      if (btn(m.light)) b |= IN.LIGHT;
      if (btn(m.heavy)) b |= IN.HEAVY;
      if (btn(m.jump)) b |= IN.JUMP;
      if (btn(m.guard)) b |= IN.GUARD;
      if (btn(m.special)) b |= IN.SPECIAL;
      if (btn(m.super)) b |= IN.SUPER;
      if (btn(m.dash) || btn(6)) b |= IN.DASH;
      if (btn(m.pause)) b |= IN.PAUSE;
      if (btn(0) || btn(9)) b |= IN.CONFIRM;
    }
    this.prevBits = this.lastBits;
    this.lastBits = b;
    return b;
  }
  justPressedAction(): boolean {
    const act = IN.LIGHT | IN.HEAVY | IN.JUMP | IN.CONFIRM;
    return (this.lastBits & act & ~this.prevBits) !== 0;
  }
  rumble(ms: number, strength: number): void {
    const gp = this.gp() as (Gamepad & { vibrationActuator?: { playEffect?: (type: string, p: Record<string, number>) => Promise<unknown> } }) | null;
    const act = gp?.vibrationActuator;
    if (act?.playEffect) act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  }
}

// ---- Tactile : joystick flottant + boutons ----
export class TouchDevice implements InputDevice {
  readonly kind = 'touch' as const;
  readonly id = 'touch';
  readonly label = 'Écran tactile';
  bits = 0; // mis à jour par l'overlay tactile (ui/touch.ts)
  private prevBits = 0;
  private lastBits = 0;
  active = false;
  poll(): number {
    this.prevBits = this.lastBits;
    this.lastBits = this.bits;
    return this.bits;
  }
  justPressedAction(): boolean {
    const act = IN.LIGHT | IN.HEAVY | IN.JUMP | IN.CONFIRM;
    return (this.lastBits & act & ~this.prevBits) !== 0;
  }
  rumble(ms: number, strength: number): void {
    try {
      if (navigator.vibrate && strength > 0.3) navigator.vibrate(Math.min(80, ms));
    } catch {
      /* ignore */
    }
  }
  connected(): boolean {
    return true;
  }
}
