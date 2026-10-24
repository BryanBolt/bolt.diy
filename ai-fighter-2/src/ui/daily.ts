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
