// Défi du jour : écran d'accueil + classement du serveur.
import { dailyOf, todayUtc, type DailyEntry } from '../../shared/daily';
import { httpBase } from './ideas';
import { esc } from './screens';
import { getChar } from '../sim/chars';

const noNet = () => !!(window as unknown as { __AIF2_NO_NET?: boolean }).__AIF2_NO_NET;

export async function fetchDaily(date: string): Promise<DailyEntry[] | null> {
  if (noNet()) return null;
  try {
    const r = await fetch(`${httpBase()}/api/daily?date=${date}`);
    if (!r.ok) return null;
    return ((await r.json()) as { top: DailyEntry[] }).top;
  } catch { return null; }
}

export async function submitDaily(date: string, name: string, score: number, wave: number, charId: string): Promise<{ rank: number; top: DailyEntry[] } | null> {
  if (noNet()) return null;
  try {
    const r = await fetch(`${httpBase()}/api/daily`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ date, name, score, wave, charId }) });
    if (!r.ok) return null;
    return (await r.json()) as { rank: number; top: DailyEntry[] };
  } catch { return null; }
}

export function dailyTableHtml(top: DailyEntry[] | null, me = ''): string {
  if (top === null) return '<div class="small muted">Classement indisponible (hors ligne).</div>';
  if (!top.length) return '<div class="small muted">Personne n\'a encore relevé le défi aujourd\'hui : sois le premier !</div>';
  return `<table style="width:100%;border-collapse:collapse">${top.slice(0, 10).map((e, i) => `<tr style="${e.name === me ? 'color:#ffd166' : ''}"><td style="padding:3px 6px">${i + 1}.</td><td>${esc(e.name)}</td><td class="small muted">${esc(getChar(e.charId)?.name ?? '')}</td><td>vague ${e.wave}</td><td style="text-align:right"><b>${e.score}</b></td></tr>`).join('')}</table>`;
}

export function dailyHtml(top: DailyEntry[] | null, myBest: number): string {
  const d = dailyOf(todayUtc());
  return `<h2 style="margin:0">📅 Défi du jour <span class="small muted">${d.date}</span></h2>
  <div class="card" style="margin:12px 0;padding:12px;border:1px solid var(--line,#26405e);border-radius:10px">
    <div style="font-size:20px"><b>${d.mod.icon} ${esc(d.mod.name)}</b></div>
    <div class="muted">${esc(d.mod.desc)}</div>
    <div class="small muted" style="margin-top:6px">Survie en solo avec les mêmes vagues pour tout le monde. Ton meilleur score aujourd'hui : <b>${myBest || '—'}</b></div>
  </div>
  <div id="daily-board"><h3 style="margin:8px 0">🏆 Classement</h3>${dailyTableHtml(top)}</div>
  <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="back">← Retour</button><button class="btn primary big" data-action="daily-go">⚔ Relever le défi</button></div>`;
}

import { HATS, AURAS } from '../../shared/cosmetics';
import { ACHIEVEMENTS } from '../../shared/achievements';
import type { Profile } from '../core/storage';

/** Boutique de cosmétiques (pièces gagnées en jouant) + liste des succès. */
export function shopHtml(p: Profile): string {
  const item = (kind: 'hat' | 'aura', c: { id: string; name: string; icon: string; price?: number }) => {
    const owned = p.owned.includes(c.id);
    return `<div class="opt"><div class="lbl">${c.icon} ${esc(c.name)} <span class="small muted">${kind === 'hat' ? 'chapeau' : 'aura'}</span></div><div class="val">${owned ? '<span class="small muted">✔ acheté</span>' : `<button class="btn sm ${p.coins >= (c.price ?? 0) ? 'primary' : ''}" data-action="buy" data-id="${c.id}" ${p.coins >= (c.price ?? 0) ? '' : 'disabled'}>${c.price} 🪙</button>`}</div></div>`;
  };
  const prem = [...HATS.filter((h) => h.price).map((h) => item('hat', h)), ...AURAS.filter((a) => a.price).map((a) => item('aura', a))].join('');
  const ach = ACHIEVEMENTS.map((a) => `<div class="opt" style="opacity:${p.achv.includes(a.id) ? 1 : 0.5}"><div class="lbl">${a.icon} ${esc(a.name)} <span class="small muted">${esc(a.desc)}</span></div><div class="val"><span class="small">${p.achv.includes(a.id) ? '✔' : `+${a.reward} 🪙`}</span></div></div>`).join('');
  return `<h2 style="margin:0">🛍️ Boutique et succès</h2>
  <div class="small muted" style="margin:6px 0 10px">Tu as <b style="color:#ffe14d">${p.coins} 🪙</b> · les pièces se gagnent à chaque partie et avec les succès. Série du défi du jour : <b>${p.streak}</b> 🔥</div>
  <h3 style="margin:8px 0">Cosmétiques</h3>${prem}
  <h3 style="margin:14px 0 8px">Succès (${p.achv.length}/${ACHIEVEMENTS.length})</h3>${ach}
  <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="back">← Retour</button></div>`;
}
