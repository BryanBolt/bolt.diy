// Manette tactile : joystick flottant (moitié gauche) + boutons (moitié droite), multi-touch.
import { IN } from '../sim/types';
import type { TouchDevice } from '../input/devices';
import { loadSettings } from '../core/storage';

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
      for (const b of this.buttons) b.pointers.clear();
      this.stickPointer = -1;
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
      let btn = this.buttons.find((b) => b.el === target || b.el.contains(target));
      if (!btn && !this.onStickSide(e.clientX)) {
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
      if (this.onStickSide(e.clientX) && this.stickPointer < 0) {
        this.stickPointer = e.pointerId;
        this.stickOrigin = { x: e.clientX, y: e.clientY };
        this.stick.style.left = `${e.clientX}px`;
        this.stick.style.top = `${e.clientY}px`;
        this.stick.classList.add('on');
        this.knob.style.transform = 'translate(0,0)';
        this.dir = 0;
        this.running = false;
        this.sync();
      }
    });
    const move = (e: PointerEvent) => {
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
      const dx = e.clientX - this.stickOrigin.x;
      const dy = e.clientY - this.stickOrigin.y;
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
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId === this.stickPointer) {
        this.stickPointer = -1;
        this.dir = 0;
        this.running = false;
        this.stick.classList.remove('on');
        this.stick.style.left = '';
        this.stick.style.top = '';
        this.knob.style.transform = 'translate(0,0)';
      }
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
    for (const b of this.buttons) if (b.pointers.size) bits |= b.bit;
    this.device.bits = bits;
  }
}
