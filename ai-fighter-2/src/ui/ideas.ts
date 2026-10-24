// « Proposer une idée » : formulaire (texte ou dictée vocale) envoyé au serveur, qui les garde pour la prochaine version.
import { loadSettings } from '../core/storage';

export interface IdeaPrefill { category?: string; text?: string }

const CATS = ['Gameplay', 'Personnages', 'Armes', 'Niveaux', 'Interface', 'Son / musique', 'En ligne', 'Bug', 'Autre'];
const PENDING_KEY = 'aif2.ideas.pending';
let ctxProvider: () => Record<string, unknown> = () => ({});
export function setIdeaContext(fn: () => Record<string, unknown>): void { ctxProvider = fn; }

export function httpBase(): string {
  const ws = loadSettings().serverUrl;
  if (ws) return ws.replace(/^ws(s?):\/\//, 'http$1://').replace(/\/ws\/?$/, '');
  return location.origin;
}

interface Payload { text: string; category: string; name: string; ctx: Record<string, unknown> }

function pending(): Payload[] {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]') as Payload[]; } catch { return []; }
}
function savePending(list: Payload[]): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20))); } catch { /* ignore */ }
}

async function post(p: Payload): Promise<boolean> {
  if ((window as unknown as { __AIF2_NO_NET?: boolean }).__AIF2_NO_NET) return false;
  try {
    const r = await fetch(`${httpBase()}/api/ideas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
    return r.ok;
  } catch { return false; }
}

/** Renvoie au serveur les idées qui n'ont pas pu partir (hors ligne). */
export async function flushPendingIdeas(): Promise<void> {
  const list = pending();
  if (!list.length) return;
  const left: Payload[] = [];
  for (const p of list) if (!(await post(p))) left.push(p);
  savePending(left);
}

export function openIdeaBox(pre: IdeaPrefill = {}): void {
  document.querySelector('.ideabox')?.remove();
  const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
  const box = document.createElement('div');
  box.className = 'diagbox ideabox';
  box.innerHTML = `<div class="diagcard">
    <h2>💡 Proposer une idée</h2>
    <p class="small muted" style="margin:0 0 8px">Une fonction, un perso, une arme, un bug… Écris ou dicte : on lit tout pour la prochaine version.</p>
    <div class="tabs" id="ideacats">${CATS.map((c) => `<button type="button" class="btn sm ${c === (pre.category ?? 'Gameplay') ? 'on' : ''}" data-cat="${c}">${c}</button>`).join('')}</div>
    <textarea id="ideatext" rows="6" maxlength="1200" placeholder="Décris ton idée…" style="width:100%;font:inherit;color:var(--text);background:rgba(2,12,26,0.7);border:1px solid var(--edge);padding:10px;resize:vertical"></textarea>
    <div class="small muted" id="ideastatus" style="min-height:18px;margin:6px 0"></div>
    <div class="row">
      <button type="button" class="btn sm" id="ideamic" ${SR ? '' : 'disabled title="La dictée vocale n\'est pas disponible sur ce navigateur"'}>🎙️ Dicter</button>
      <button type="button" class="btn sm primary" id="ideasend">Envoyer</button>
      <button type="button" class="btn sm ghost" id="ideaclose">Annuler</button>
    </div></div>`;
  const ta = box.querySelector('#ideatext') as HTMLTextAreaElement;
  const status = box.querySelector('#ideastatus') as HTMLDivElement;
  const mic = box.querySelector('#ideamic') as HTMLButtonElement;
  ta.value = pre.text ?? '';
  let category = pre.category ?? 'Gameplay';
  let rec: SpeechRec | null = null;
  let listening = false;
  const stop = () => { try { rec?.stop(); } catch { /* ignore */ } listening = false; mic.textContent = '🎙️ Dicter'; mic.classList.remove('primary'); };
  box.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const cat = t.closest('[data-cat]')?.getAttribute('data-cat');
    if (cat) {
      category = cat;
      box.querySelectorAll('#ideacats .btn').forEach((b) => b.classList.toggle('on', b.getAttribute('data-cat') === cat));
      return;
    }
    if (t === box || t.closest('#ideaclose')) { stop(); box.remove(); return; }
    if (t.closest('#ideamic') && SR) {
      if (listening) { stop(); return; }
      rec = new SR();
      rec.lang = 'fr-FR';
      rec.interimResults = true;
      rec.continuous = true;
      const base = ta.value.trim();
      rec.onresult = (ev) => {
        const said = Array.from(ev.results).map((r) => r[0].transcript).join(' ').trim();
        ta.value = (base ? base + ' ' : '') + said;
      };
      rec.onerror = (ev) => {
        status.textContent = ev.error === 'not-allowed' ? "Micro refusé : autorise-le dans le navigateur pour dicter." : ev.error === 'no-speech' ? "Je n'entends rien… parle plus près du micro." : `Dictée interrompue (${ev.error}).`;
        stop();
      };
      rec.onend = () => stop();
      try { rec.start(); listening = true; mic.textContent = '⏹ Arrêter la dictée'; mic.classList.add('primary'); status.textContent = 'Je t\'écoute… parle, puis appuie sur Arrêter.'; }
      catch { status.textContent = 'Impossible de démarrer la dictée.'; }
      return;
    }
    if (t.closest('#ideasend')) {
      stop();
      const text = ta.value.trim();
      if (text.length < 5) { status.textContent = 'Écris au moins une phrase.'; return; }
      const s = loadSettings();
      const p: Payload = { text, category, name: s.name || '', ctx: { v: (window as unknown as { __AIF2_VERSION?: string }).__AIF2_VERSION ?? '', lang: navigator.language, ua: navigator.userAgent.slice(0, 120), screen: `${innerWidth}x${innerHeight}`, ...ctxProvider() } };
      status.textContent = 'Envoi…';
      if (await post(p)) {
        status.textContent = 'Merci ! Idée enregistrée. 🙌';
        setTimeout(() => box.remove(), 1100);
      } else {
        savePending([...pending(), p]);
        try { await navigator.clipboard?.writeText(`[${category}] ${text}`); } catch { /* ignore */ }
        status.textContent = "Envoi impossible pour l'instant : l'idée est gardée sur ton appareil (et copiée) et partira dès que possible.";
      }
    }
  });
  document.body.appendChild(box);
  ta.focus();
}

interface SpeechRec {
  lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void; stop(): void;
}
