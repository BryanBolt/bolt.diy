// Manette tactile : joystick flottant (moitié gauche) + boutons (moitié droite), multi-touch.
import { IN } from '../sim/types';
import type { TouchDevice } from '../input/devices';
import { loadSettings } from '../core/storage';

interface Gesture { x0: number; y0: number; x: number; y: number; t0: number; mode: 'wait' | 'stick' | 'charge' | 'done'; timer: number }

interface Btn {
  el: HTMLDivElement;
  bit: number;
  pointers: Set<number>;
}

export class TouchOverlay {
  root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private buttons: Btn[] = [];
  private stickPointer = -1;
  private stickOrigin = { x: 0, y: 0 };
  private dir = 0;
  private running = false;
  private visible = false;
  private pauseBtn: HTMLButtonElement;
  onPause: (() => void) | null = null;

  constructor(private device: TouchDevice) {
    this.root = document.createElement('div');
    this.root.id = 'touch';
    this.root.innerHTML = `
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-buttons">
        <div class="t-btn t-light" data-bit="${IN.LIGHT}"><span>A</span><small>Attaque</small></div>
        <div class="t-btn t-heavy" data-bit="${IN.HEAVY}"><span>B</span><small>Lourd</small></div>
        <div class="t-btn t-jump" data-bit="${IN.JUMP}"><span>X</span><small>Saut</small></div>
        <div class="t-btn t-guard" data-bit="${IN.GUARD}"><span>Y</span><small>Garde</small></div>
        <div class="t-btn t-special" data-bit="${IN.SPECIAL}"><span>Ki</span><small>Spécial</small></div>
        <div class="t-btn t-super" data-bit="${IN.SUPER}"><span>★</span><small>Super</small></div>
        <div class="t-btn t-grab" data-bit="${IN.LIGHT | IN.HEAVY}"><span>✋</span><small>Saisie</small></div>
      </div>
      <button class="t-pause" aria-label="Pause">❚❚</button>`;
    this.stick = this.root.querySelector('.t-stick') as HTMLDivElement;
    this.knob = this.root.querySelector('.t-knob') as HTMLDivElement;
    this.pauseBtn = this.root.querySelector('.t-pause') as HTMLButtonElement;
    for (const el of this.root.querySelectorAll<HTMLDivElement>('.t-btn')) {
      const bit = Number(el.dataset.bit);
      const b: Btn = { el, bit, pointers: new Set() };
      this.buttons.push(b);
    }
    document.body.appendChild(this.root);
    this.root.style.display = 'none';
    this.bind();
    this.applySettings();
  }

  applySettings(): void {
    const s = loadSettings();
    this.root.style.setProperty('--tsize', String(s.touchSize));
    this.root.style.setProperty('--topacity', String(s.touchOpacity));
    this.root.classList.toggle('lefty', !!s.touchLeft);
    this.root.classList.toggle('onehand', !!s.touchOneHand);
  }

  private buzz(ms: number): void {
    if (loadSettings().touchHaptics === false) return;
    try { navigator.vibrate?.(ms); } catch { /* ignore */ }
  }


  show(on: boolean): void {
    this.visible = on;
    this.root.style.display = on ? '' : 'none';
    if (!on) {
      this.device.bits = 0;
      for (const g of this.gestures.values()) if (g.timer) clearTimeout(g.timer);
      this.gestures.clear();
      this.pulses = [];
      this.charging = false;
      for (const b of this.buttons) b.pointers.clear();
      this.stickPointer = -1;
    }
  }

  // ---- gestes : toucher = attaque · glisser ↑ saut · ↓ garde · ↔ lourd · appui long = charge de Ki · 2 doigts = Super ----
  private gestures = new Map<number, Gesture>();
  private pulses: { bits: number; until: number }[] = [];
  private charging = false;

  private pulse(bits: number, ms: number): void {
    this.pulses.push({ bits, until: performance.now() + ms });
    this.sync();
    setTimeout(() => this.sync(), ms + 8);
  }

  private fxAt(x: number, y: number, icon: string): void {
    const d = document.createElement('div');
    d.className = 't-fx';
    d.textContent = icon;
    d.style.left = `${x}px`;
    d.style.top = `${y}px`;
    this.root.appendChild(d);
    setTimeout(() => d.remove(), 420);
  }

  private oneHand(): boolean { return !!loadSettings().touchOneHand; }
  private gesturesOn(): boolean { return loadSettings().touchGestures !== false; }

  private placeStick(x: number, y: number): void {
    this.stickOrigin = { x, y };
    this.stick.style.left = `${x}px`;
    this.stick.style.top = `${y}px`;
    this.stick.classList.add('on');
    this.knob.style.transform = 'translate(0,0)';
    this.dir = 0;
    this.running = false;
  }

  private updateStick(cx: number, cy: number): void {
    const dx = cx - this.stickOrigin.x;
    const dy = cy - this.stickOrigin.y;
    const size = 50 * Number(loadSettings().touchSize || 1);
    const len = Math.hypot(dx, dy);
    const k = Math.min(1, len / size);
    const nx = len ? (dx / len) * k : 0;
    const ny = len ? (dy / len) * k : 0;
    this.knob.style.transform = `translate(${nx * size}px, ${ny * size}px)`;
    let d = 0;
    const dead = 0.2;
    if (nx < -dead) d |= IN.LEFT;
    if (nx > dead) d |= IN.RIGHT;
    if (ny < -dead) d |= IN.UP;
    if (ny > dead) d |= IN.DOWN;
    this.running = k > 0.9 && Math.abs(nx) > 0.55;
    this.dir = d;
    this.sync();
  }

  private releaseStick(): void {
    this.stickPointer = -1;
    this.dir = 0;
    this.running = false;
    this.stick.classList.remove('on');
    this.stick.style.left = '';
    this.stick.style.top = '';
    this.knob.style.transform = 'translate(0,0)';
  }

  private becomeStick(id: number, g: Gesture): void {
    if (this.stickPointer >= 0 && this.stickPointer !== id) { g.mode = 'done'; return; }
    g.mode = 'stick';
    if (g.timer) clearTimeout(g.timer);
    this.charging = false;
    this.stickPointer = id;
    this.placeStick(g.x0, g.y0);
    this.updateStick(g.x, g.y);
  }

  private startGesture(e: PointerEvent): void {
    const now = performance.now();
    // deux doigts posés ensemble : Super
    for (const [oid, o] of this.gestures) {
      if (o.mode === 'wait' && now - o.t0 < 350) {
        this.pulse(IN.SUPER, 130);
        this.buzz(18);
        this.fxAt(e.clientX, e.clientY, '★');
        o.mode = 'done';
        this.gestures.set(e.pointerId, { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, mode: 'done', timer: 0 });
        void oid;
        return;
      }
    }
    const g: Gesture = { x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, mode: 'wait', timer: 0 };
    g.timer = window.setTimeout(() => {
      if (g.mode !== 'wait' || Math.hypot(g.x - g.x0, g.y - g.y0) > 14) return;
      g.mode = 'charge';
      this.charging = true;
      this.buzz(14);
      this.fxAt(g.x0, g.y0, '⚡');
      this.sync();
    }, 380);
    this.gestures.set(e.pointerId, g);
  }

  private moveGesture(e: PointerEvent, g: Gesture): void {
    g.x = e.clientX;
    g.y = e.clientY;
    const disp = Math.hypot(g.x - g.x0, g.y - g.y0);
    const age = performance.now() - g.t0;
    if (g.mode === 'stick') { this.updateStick(g.x, g.y); return; }
    if (this.oneHand()) {
      // un balayage rapide est un geste ; un doigt qui continue à bouger devient le joystick
      if ((g.mode === 'wait' && age >= 160 && disp > 10) || (g.mode === 'charge' && disp > 14)) { this.charging = false; this.becomeStick(e.pointerId, g); }
    } else if (g.mode === 'charge' && disp > 24) { this.charging = false; g.mode = 'done'; this.sync(); }
  }

  private endGesture(id: number): void {
    const g = this.gestures.get(id);
    if (!g) return;
    this.gestures.delete(id);
    if (g.timer) clearTimeout(g.timer);
    if (g.mode === 'stick') { this.releaseStick(); this.sync(); return; }
    if (g.mode === 'charge') { this.charging = false; this.sync(); return; }
    if (g.mode !== 'wait') return;
    const dx = g.x - g.x0, dy = g.y - g.y0;
    const disp = Math.hypot(dx, dy);
    const dt = performance.now() - g.t0;
    if (disp < 14 && dt < 300) { this.pulse(IN.LIGHT, 90); this.buzz(7); this.fxAt(g.x0, g.y0, '👊'); }
    else if (disp >= 32 && dt < 420) {
      if (Math.abs(dx) > Math.abs(dy)) { this.pulse(IN.HEAVY | (dx > 0 ? IN.RIGHT : IN.LEFT), 110); this.fxAt(g.x, g.y, dx > 0 ? '➡' : '⬅'); }
      else if (dy < 0) { this.pulse(IN.JUMP, 130); this.fxAt(g.x, g.y, '⬆'); }
      else { this.pulse(IN.GUARD, 380); this.fxAt(g.x, g.y, '🛡'); }
      this.buzz(9);
    }
  }

  private bind(): void {
    const root = this.root;
    root.addEventListener('pointerdown', (e) => {
      if (!this.visible) return;
      this.device.active = true;
      const target = e.target as HTMLElement;
      if (target.closest('.t-pause')) return;
      e.preventDefault();
      const oneHand = this.oneHand();
      let btn = this.buttons.find((b) => (!oneHand || b.el.classList.contains('t-super')) && (b.el === target || b.el.contains(target)));
      if (!btn && !this.onStickSide(e.clientX) && !oneHand) {
        // zone tolérante : le bouton le plus proche du doigt (dans 1,2 rayon)
        let best = 1e9;
        for (const b of this.buttons) {
          const r = b.el.getBoundingClientRect();
          const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
          if (d < best && d < r.width * 0.85) { best = d; btn = b; }
        }
      }
      if (btn) {
        this.buzz(7);
        btn.pointers.add(e.pointerId);
        btn.el.classList.add('on');
        this.sync();
        return;
      }
      if (oneHand && this.gesturesOn()) { this.startGesture(e); return; }
      if (this.onStickSide(e.clientX) && this.stickPointer < 0) {
        this.stickPointer = e.pointerId;
        this.placeStick(e.clientX, e.clientY);
        this.sync();
        return;
      }
      if (!this.onStickSide(e.clientX) && this.gesturesOn()) this.startGesture(e);
    });
    const move = (e: PointerEvent) => {
      const g = this.gestures.get(e.pointerId);
      if (g) { e.preventDefault(); this.moveGesture(e, g); return; }
      if (e.pointerId !== this.stickPointer) {
        // glisser d'un bouton à un autre
        for (const b of this.buttons) {
          if (!b.pointers.has(e.pointerId)) continue;
          const r = b.el.getBoundingClientRect();
          const inside = e.clientX >= r.left - 10 && e.clientX <= r.right + 10 && e.clientY >= r.top - 10 && e.clientY <= r.bottom + 10;
          if (!inside) { b.pointers.delete(e.pointerId); b.el.classList.remove('on'); this.sync(); }
        }
        return;
      }
      e.preventDefault();
      this.updateStick(e.clientX, e.clientY);
    };
    const up = (e: PointerEvent) => {
      if (this.gestures.has(e.pointerId)) this.endGesture(e.pointerId);
      else if (e.pointerId === this.stickPointer) this.releaseStick();
      for (const b of this.buttons) {
        if (b.pointers.delete(e.pointerId) && b.pointers.size === 0) b.el.classList.remove('on');
      }
      this.sync();
    };
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
    root.addEventListener('lostpointercapture', up);
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.pauseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      this.onPause?.();
    });
  }

  private onStickSide(x: number): boolean {
    const lefty = this.root.classList.contains('lefty');
    return lefty ? x >= window.innerWidth * 0.5 : x < window.innerWidth * 0.5;
  }

  private sync(): void {
    let bits = this.dir;
    if (this.running) bits |= IN.DASH;
    if (this.charging) bits |= IN.SPECIAL;
    const now = performance.now();
    this.pulses = this.pulses.filter((p) => p.until > now);
    for (const p of this.pulses) bits |= p.bits;
    for (const b of this.buttons) if (b.pointers.size) bits |= b.bit;
    this.device.bits = bits;
  }
}
