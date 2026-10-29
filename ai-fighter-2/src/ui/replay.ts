// Rediffusions : partage via le serveur + barre de lecture (pause, vitesse, saut, moments forts).
import type { ReplayFile } from '../../shared/replay';
import { validReplay } from '../../shared/replay';
import { httpBase } from './ideas';

const noNet = () => !!(window as unknown as { __AIF2_NO_NET?: boolean }).__AIF2_NO_NET;

export async function uploadReplay(r: ReplayFile): Promise<string | null> {
  if (noNet()) return null;
  try {
    const res = await fetch(`${httpBase()}/api/replay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(r) });
    if (!res.ok) return null;
    return ((await res.json()) as { id: string }).id;
  } catch { return null; }
}

export async function downloadReplay(id: string): Promise<ReplayFile | null> {
  if (noNet()) return null;
  try {
    const res = await fetch(`${httpBase()}/api/replay?id=${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const r = await res.json();
    return validReplay(r) ? r : null;
  } catch { return null; }
}

export function replayLink(id: string): string {
  return `${location.origin}${location.pathname}?replay=${id}`;
}

export const SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface ReplayBar {
  el: HTMLElement;
  update(frame: number, paused: boolean, speed: number, atEnd: boolean): void;
  remove(): void;
}

export function createReplayBar(file: ReplayFile, on: {
  toggle(): void; seek(frame: number): void; speed(): void; share(): void; quit(): void;
}): ReplayBar {
  const el = document.createElement('div');
  el.id = 'replaybar';
  const hl = file.hl.map((h, i) => `<button type="button" class="hl" data-i="${i}" title="${String(h.label).replace(/[<>&"']/g, '')}">⭐ ${(Number(h.f) / 60 | 0)} s</button>`).join('');
  el.innerHTML = `<div class="rrow"><button type="button" data-a="back5">⏪ 5 s</button><button type="button" data-a="toggle" class="main">⏸</button><button type="button" data-a="fwd5">5 s ⏩</button><button type="button" data-a="speed">×1</button><input type="range" min="0" max="${file.frames}" value="0" step="1"><span class="t">0:00</span><button type="button" data-a="share">🔗</button><button type="button" data-a="quit">✕</button></div>${hl ? `<div class="rrow hls">${hl}</div>` : ''}`;
  document.body.appendChild(el);
  const range = el.querySelector('input') as HTMLInputElement;
  let dragging = false;
  let cur = 0;
  range.addEventListener('input', () => { dragging = true; });
  range.addEventListener('change', () => { dragging = false; on.seek(Number(range.value)); });
  el.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const a = t.dataset.a;
    if (a === 'toggle') on.toggle();
    else if (a === 'back5') on.seek(Math.max(0, cur - 300));
    else if (a === 'fwd5') on.seek(Math.min(file.frames - 1, cur + 300));
    else if (a === 'speed') on.speed();
    else if (a === 'share') on.share();
    else if (a === 'quit') on.quit();
    else if (t.classList.contains('hl')) on.seek(Math.max(0, file.hl[Number(t.dataset.i)].f - 120));
  });
  const fmt = (f: number) => `${Math.floor(f / 3600)}:${String(Math.floor(f / 60) % 60).padStart(2, '0')}`;
  return {
    el,
    update(frame, paused, speed, atEnd) {
      cur = frame;
      if (!dragging) range.value = String(frame);
      (el.querySelector('.t') as HTMLElement).textContent = `${fmt(frame)} / ${fmt(file.frames)}`;
      (el.querySelector('[data-a="toggle"]') as HTMLElement).textContent = atEnd ? '↺' : paused ? '▶' : '⏸';
      (el.querySelector('[data-a="speed"]') as HTMLElement).textContent = `×${speed}`;
    },
    remove() { el.remove(); },
  };
}
