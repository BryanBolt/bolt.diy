import { KeyboardDevice, GamepadDevice, TouchDevice, KEYMAP_P1, KEYMAP_P2, PADMAP_DEFAULT, flushKeyTaps } from './devices';
import type { InputDevice, KeyMap, PadMap } from './devices';
import { loadSettings } from '../core/storage';

/** Gère tous les périphériques et leur attribution aux slots joueurs. */
export class InputManager {
  keyboard1: KeyboardDevice;
  keyboard2: KeyboardDevice;
  touch: TouchDevice;
  pads: Map<number, GamepadDevice> = new Map();
  /** slot -> périphérique */
  assignments: Map<number, InputDevice> = new Map();

  constructor() {
    const s = loadSettings();
    this.keyboard1 = new KeyboardDevice('kb1', 'Clavier (ZQSD + J K L U I O)', s.keymap1 ?? KEYMAP_P1);
    this.keyboard2 = new KeyboardDevice('kb2', 'Clavier (pavé numérique)', s.keymap2 ?? KEYMAP_P2);
    this.touch = new TouchDevice();
    window.addEventListener('gamepadconnected', (e) => this.addPad(e.gamepad.index));
    window.addEventListener('gamepaddisconnected', (e) => {
      this.pads.delete(e.gamepad.index);
    });
    this.scanPads();
  }

  setKeymaps(k1: KeyMap, k2: KeyMap): void {
    this.keyboard1.map = k1;
    this.keyboard2.map = k2;
  }
  setPadMap(m: PadMap): void {
    for (const p of this.pads.values()) p.map = m;
  }

  private addPad(index: number): void {
    if (!this.pads.has(index)) this.pads.set(index, new GamepadDevice(index, loadSettings().padmap ?? PADMAP_DEFAULT));
  }

  scanPads(): void {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    for (let i = 0; i < list.length; i++) if (list[i]) this.addPad(i);
  }

  allDevices(): InputDevice[] {
    this.scanPads();
    return [this.keyboard1, this.keyboard2, ...this.pads.values(), this.touch];
  }

  /** Lit tous les périphériques (une fois par frame). */
  pollAll(): void {
    for (const d of this.allDevices()) d.poll();
    flushKeyTaps();
  }

  /** Périphérique dont on vient d'appuyer sur un bouton d'action et qui n'est pas encore attribué. */
  firstUnassignedPress(): InputDevice | null {
    const assigned = new Set([...this.assignments.values()].map((d) => d.id));
    for (const d of this.allDevices()) {
      if (assigned.has(d.id)) continue;
      if (d.kind === 'touch' && !this.touch.active) continue;
      if (d.justPressedAction()) return d;
    }
    return null;
  }

  assign(slot: number, device: InputDevice): void {
    this.assignments.set(slot, device);
  }
  unassign(slot: number): void {
    this.assignments.delete(slot);
  }
  clear(): void {
    this.assignments.clear();
  }
  deviceFor(slot: number): InputDevice | undefined {
    return this.assignments.get(slot);
  }
  /** Bits de la frame courante pour un slot (0 si aucun périphérique). */
  bitsFor(slot: number): number {
    const d = this.assignments.get(slot);
    if (!d) return 0;
    return (d as unknown as { lastBits?: number }).lastBits ?? d.poll();
  }
  /** Union des entrées de tous les périphériques (menus). */
  anyBits(): number {
    let b = 0;
    for (const d of this.allDevices()) b |= (d as unknown as { lastBits?: number }).lastBits ?? 0;
    return b;
  }
  rumble(slot: number, ms: number, strength: number): void {
    const d = this.assignments.get(slot);
    d?.rumble?.(ms, strength);
  }
}
