// Écrans DOM : menus, options, aide, lobby. Le rendu du jeu lui-même reste sur le canvas.
import { ROSTER, getChar, PALETTE, COMMANDS } from '../sim/chars';
import { STAGES } from '../sim/stages';
import { poseFor, drawStickman } from '../render/stickman';
import type { Fighter } from '../sim/types';
import { WEAPONS } from '../sim/types';
import type { LobbyOptions, GameMode, PublicRoom } from '../../shared/protocol';
import { HATS, AURAS, unlocked as cosmUnlocked } from '../../shared/cosmetics';
import { drawAura } from '../render/cosmetics';
import type { Profile, Settings } from '../core/storage';
import { KEYMAP_P1, KEYMAP_P2, keyLabel, PAD_BUTTON_NAMES, PADMAP_DEFAULT, type KeyMap, type PadMap } from '../input/devices';

export const ui = document.getElementById('ui') as HTMLDivElement;

export function show(html: string, cls = ''): HTMLElement {
  ui.innerHTML = `<div class="screen ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.classList.add('ui-open');
  return ui.firstElementChild as HTMLElement;
}
export function hide(): void {
  ui.innerHTML = '';
  document.body.classList.remove('ui-open');
}
export function toast(msg: string, ms = 2200): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout((t as unknown as { _tm?: number })._tm);
  (t as unknown as { _tm?: number })._tm = window.setTimeout(() => t.classList.remove('on'), ms);
}
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

export const MODE_LABEL: Record<GameMode, string> = { campaign: 'Campagne', duel: 'Duel', survival: 'Survie', training: 'Entraînement' };
export const MODE_DESC: Record<GameMode, string> = {
  campaign: '7 stages, vagues d\'ennemis, boss, bonus à choisir. Coop jusqu\'à 4.',
  duel: 'Versus : 1 contre 1, chacun pour soi ou par équipes, jusqu\'à 4 combattants (bots possibles).',
  survival: 'Vagues infinies de plus en plus dures. Jusqu\'où irez-vous ?',
  training: 'Mannequin, affichage des boîtes de collision, liste des coups.',
};
export const DIFF_LABEL = ['Facile', 'Normal', 'Difficile', 'Cauchemar'];

export function isUnlocked(charId: string, profile: Profile): boolean {
  const c = getChar(charId);
  if (!c.unlock) return true;
  if (profile.unlockedChars.includes(charId)) return true;
  return c.unlock.kind === 'stage' ? profile.stageReached >= c.unlock.value : false;
}

export function unlockHint(charId: string): string {
  const c = getChar(charId);
  if (!c.unlock) return '';
  return c.unlock.kind === 'stage' ? `Termine le stage ${c.unlock.value}` : '';
}

// ---- Portraits (stickman statique) ----
const portraitFighter = (charId: string, color: number, hat = ''): Fighter =>
  ({ id: 0, charId, name: '', team: 0, slot: 0, controller: 'player', ai: null, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, hp: 1, hpMax: 1, ki: 0, superMeter: 0, guardMeter: 0, state: 'idle', stateFrame: 0, moveId: null, moveHits: [], multiLeft: 0, chainIndex: 0, freeze: 0, invuln: 0, armor: false, comboHits: 0, comboTimer: 0, comboDamage: 0, guardFrames: 0, lowGuard: false, prevInput: 0, bufferedInput: 0, bufferTimer: 0, tapTimer: 0, tapDir: 0, runFrames: 0, airJumps: 0, heavyCharge: 0, chargeBonus: 0, hitFrames: 0, lastHitBy: 0, koTimer: 0, revive: 0, lives: 0, stats: getChar(charId).stats, bonuses: [], hat, aura: '', status: { burn: 0, burnDps: 0, frozen: 0, poison: 0, slow: 0, wet: 0 }, color, level: 0, kills: 0, phoenixUsed: false, nextMoveFrame: 0, wantsLeave: false, weapon: 0, weaponKind: '', rage: false, boss: false, hist: [], gunCd: 0, lastCmd: '', lastCmdFrame: -999, backHold: 0, cmb: '', cmbFrame: -999, phase2: false, form: 0, kiCharge: 0, carry: '', holding: -1, heldBy: -1, holdFrames: 0, holdMode: 0 }) as Fighter;

export function drawPortrait(canvas: HTMLCanvasElement, charId: string, color: number, time: number, locked = false, hat = '', aura = ''): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 160;
  const h = canvas.clientHeight || 110;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const f = portraitFighter(charId, color, hat);
  const pose = poseFor(f, time);
  const scale = h / 125;
  ctx.globalAlpha = locked ? 0.35 : 1;
  if (aura) drawAura(ctx, aura, w / 2, h - 6, scale, time, 0, 0);
  drawStickman(ctx, f, pose, { x: w / 2, y: h - 6, scale, facing: 1, time });
  if (locked) {
    ctx.globalAlpha = 1;
    ctx.font = '900 26px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.fillText('🔒', w / 2, h / 2 + 10);
  }
}

// ---- Lobby ----
export interface LobbyCard {
  slot: number;
  name: string;
  charId: string;
  color: number;
  team?: number;
  hat?: string;
  aura?: string;
  ready: boolean;
  isHost: boolean;
  local: boolean;
  deviceLabel?: string;
}

export interface LobbyView {
  online: boolean;
  code?: string;
  joinUrl?: string;
  cards: LobbyCard[];
  options: LobbyOptions;
  isHost: boolean;
  profile: Profile;
  ping?: number;
  chat?: { name: string; text: string }[];
}

function cosmRow(kind: 'hat' | 'aura', label: string, list: typeof HATS, cur: string, slot: number, profile: Profile): string {
  const c = list.find((x) => x.id === cur) ?? list[0];
  const n = list.filter((x) => cosmUnlocked(x, profile)).length;
  return `<div class="cosm"><button class="btn sm" data-action="${kind}" data-dir="-1" data-slot="${slot}">◀</button><span title="${esc(label)} · ${n}/${list.length} débloqués">${c.icon} ${esc(c.name)}</span><button class="btn sm" data-action="${kind}" data-dir="1" data-slot="${slot}">▶</button></div>`;
}

export function lobbyHtml(v: LobbyView): string {
  const slots = [0, 1, 2, 3];
  const cards = slots.map((s) => {
    const c = v.cards.find((x) => x.slot === s);
    if (!c) {
      return `<div class="pcard empty" data-slot="${s}">${v.online ? `<div>Place libre<br><span class="small">Partage le code <b>${esc(v.code ?? '')}</b></span></div>` : `<div>Appuie sur <kbd>Attaque</kbd> / <kbd>A</kbd> / <kbd>Entrée</kbd><br>sur un clavier, une manette<br>ou <button class="btn sm" data-action="join-touch" data-slot="${s}">Rejoindre au tactile</button></div>`}</div>`;
    }
    const ch = getChar(c.charId);
    const locked = !isUnlocked(c.charId, v.profile);
    const canEdit = c.local;
    const pal = PALETTE[c.color % PALETTE.length];
    return `<div class="pcard ${c.ready ? 'ready' : ''}" data-slot="${s}" style="--pc:${pal.main}">
      <div class="tag" style="color:${pal.main}">P${s + 1} · ${esc(c.name)}</div>
      ${c.isHost ? '<div class="host">★ hôte</div>' : v.online && v.isHost && !c.local ? `<button class="btn sm danger" style="position:absolute;top:4px;right:6px;min-height:26px;padding:2px 8px" data-action="kick" data-slot="${s}" title="Expulser ce joueur">✖ Expulser</button>` : ''}
      <div class="portrait"><canvas data-portrait data-char="${ch.id}" data-color="${c.color}" data-hat="${esc(c.hat ?? '')}" data-aura="${esc(c.aura ?? '')}" data-locked="${locked ? 1 : 0}"></canvas></div>
      <div class="cname">${esc(ch.name)}</div>
      <div class="ctitle">${esc(ch.title)}</div>
      ${locked ? `<div class="lock">🔒 ${esc(unlockHint(ch.id))}</div>` : ''}
      ${canEdit ? `<div class="nav"><button class="btn sm" data-action="prev-char" data-slot="${s}">◀</button><button class="btn sm ${c.ready ? '' : 'primary'}" data-action="ready" data-slot="${s}" ${locked ? 'disabled' : ''}>${c.ready ? 'Prêt ✔' : 'Prêt ?'}</button><button class="btn sm" data-action="next-char" data-slot="${s}">▶</button></div>
      ${v.options.mode === 'duel' && v.options.teams ? `<div class="teamsel">${[0, 1].map((t) => `<button class="btn sm ${(c.team ?? s % 2) === t ? 'primary' : ''}" ${canEdit ? `data-action="team" data-slot="${s}" data-team="${t}"` : 'disabled'} style="${(c.team ?? s % 2) === t ? `background:${t ? '#c0392b' : '#2471c8'}` : ''}">${t ? '🔴 Rouge' : '🔵 Bleue'}</button>`).join('')}</div>` : ''}
      ${canEdit ? cosmRow('hat', '🎩 Chapeau', HATS, c.hat ?? '', s, v.profile) + cosmRow('aura', '✨ Aura', AURAS, c.aura ?? '', s, v.profile) : `<div class="small muted" style="text-align:center">${esc((HATS.find((h) => h.id === (c.hat ?? '')) ?? HATS[0]).icon)} ${esc((AURAS.find((h) => h.id === (c.aura ?? '')) ?? AURAS[0]).icon)}</div>`}
      <div class="colors">${PALETTE.slice(0, 12).map((p, i) => `<span class="dot ${i === c.color ? 'sel' : ''}" style="background:${p.main}" data-action="color" data-slot="${s}" data-color="${i}" title="${p.name}"></span>`).join('')}</div>
      <div class="dev">${esc(c.deviceLabel ?? '')}${c.local && !v.online ? ' · <a href="#" data-action="leave" data-slot="' + s + '" style="color:var(--danger)">quitter</a>' : ''}</div>`
      : `<div class="dev">${c.ready ? '✔ prêt' : 'choisit son combattant…'}</div>`}
    </div>`;
  });
  const o = v.options;
  const optBtn = (key: string, label: string, val: string, enabled = v.isHost) => `<div class="opt"><div class="lbl">${label}</div><div class="val">${enabled ? `<button class="btn sm" data-action="opt" data-key="${key}" data-dir="-1">◀</button>` : ''}<span>${val}</span>${enabled ? `<button class="btn sm" data-action="opt" data-key="${key}" data-dir="1">▶</button>` : ''}</div></div>`;
  const stageName = o.mode === 'duel' ? (STAGES[o.stage]?.name ?? 'Arène') : (STAGES[Math.min(o.stage, Math.max(0, Math.min(STAGES.length - 1, v.profile.stageReached)))]?.name ?? STAGES[0].name);
  const options = [
    o.daily ? '<div class="opt"><div class="lbl">📅 Défi du jour</div><div class="val"><span>Survie · même partie pour tous</span></div></div>' : optBtn('mode', 'Mode', MODE_LABEL[o.mode]),
    !o.daily && (o.mode === 'campaign' || o.mode === 'survival') ? optBtn('difficulty', 'Difficulté', DIFF_LABEL[o.difficulty]) : '',
    o.mode === 'duel' ? optBtn('rounds', 'Manches', `Meilleur des ${o.rounds}`) : '',
    o.mode === 'duel' ? optBtn('bots', 'Bots', String(o.bots)) : '',
    o.mode === 'duel' ? optBtn('teams', 'Équipes', o.teams ? '2 équipes' : 'Chacun pour soi') : '',
    o.daily ? '' : optBtn('gravity', 'Gravité', ['Normale', '🌙 Lunaire', '🚀 Apesanteur'][o.gravity ?? 0]),
    v.online ? optBtn('isPublic', 'Visibilité', o.isPublic ? '🌐 Public' : '🔒 Privé') : '',
    o.mode === 'campaign' || o.mode === 'duel' ? optBtn('stage', o.mode === 'duel' ? 'Arène' : 'Départ', `${o.stage + 1}. ${stageName}`) : '',
  ].join('');
  const allReady = v.cards.length > 0 && v.cards.every((c) => c.ready || !c.local && v.online && c.ready);
  const canStart = v.isHost && v.cards.length > 0 && v.cards.every((c) => c.ready);
  const header = v.online
    ? `<div class="row between"><div><h2 style="margin:0">Salon en ligne</h2><div class="small muted">${v.options.isPublic ? '🌐 Salon public : visible dans la liste · ' : '🔒 Salon privé · '}Code à partager · ${v.ping !== undefined ? `ping ${Math.round(v.ping)} ms` : ''}</div></div><div class="row" style="align-items:center;gap:14px"><canvas data-qr title="Scanne pour rejoindre" style="border-radius:8px"></canvas><div class="col" style="align-items:flex-end;gap:4px"><div class="code-big">${esc(v.code ?? '')}</div><div class="row"><button class="btn sm" data-action="copy-link">📋 Copier le lien</button><button class="btn sm" data-action="share-link">📤 Partager</button></div><div class="small muted">ou scanne le QR code</div></div></div></div>`
    : `<div class="row between"><h2 style="margin:0">Jouer en local</h2><div class="small muted">Jusqu'à 4 joueurs : claviers, manettes, tactile</div></div>`;
  return `${header}
    <div class="players" style="margin:12px 0">${cards.join('')}</div>
    <div class="desc">${esc(MODE_DESC[o.mode])}</div>
    <div class="options">${options}</div>
    ${v.online && v.chat ? `<div class="chat" id="chat">${v.chat.map((m) => `<div><b>${esc(m.name)}</b> ${esc(m.text)}</div>`).join('')}</div><form class="row" id="chatform" style="margin-top:6px"><input type="text" id="chatinput" placeholder="Message…" maxlength="120" style="flex:1;min-height:40px" autocomplete="off"><button class="btn sm" type="submit">Envoyer</button></form>` : ''}
    <div class="row between" style="margin-top:12px">
      <button class="btn ghost" data-action="back">← Retour</button>
      <div class="row">
        ${v.isHost ? `<button class="btn primary big" data-action="start" ${canStart ? '' : 'disabled'}>${canStart ? '⚔ LANCER LA PARTIE' : allReady && !v.cards.length ? 'En attente de joueurs' : 'En attente que tout le monde soit prêt'}</button>` : `<span class="muted">L'hôte lance la partie quand tout le monde est prêt.</span>`}
      </div>
    </div>`;
}

// ---- Aide / liste des coups ----
export function howToHtml(charId: string): string {
  const c = getChar(charId);
  const tabs = ROSTER.map((r) => `<button class="btn sm ${r.id === charId ? 'on' : ''}" data-action="howto-char" data-char="${r.id}">${esc(r.name)}</button>`).join('');
  const m = c.moves;
  const row = (cmd: string, id: string, note = '') => `<tr><td>${cmd}</td><td><b>${esc(m[id]?.name ?? '')}</b>${note ? `<br><span class="small muted">${note}</span>` : ''}</td><td class="small muted">${m[id] ? `${m[id].damage} dég. · ${m[id].startup}f` : ''}</td></tr>`;
  return `<h2>Comment jouer</h2>
  <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
    <div>
      <h3>Clavier (J1)</h3>
      <p class="small"><kbd>Z Q S D</kbd> ou <kbd>W A S D</kbd> bouger · <kbd>Maj G</kbd> ou double appui = courir · <kbd>J</kbd> attaque · <kbd>K</kbd> lourd (maintenir : charger) · <kbd>Espace</kbd>/<kbd>L</kbd> saut · <kbd>U</kbd> garde (+ direction : roulade) · <kbd>I</kbd> spécial (Ki) · <kbd>O</kbd> super · <kbd>Échap</kbd> pause</p>
      <h3>Clavier (J2) : pavé numérique</h3>
      <p class="small"><kbd>4 6 8 5</kbd> bouger · <kbd>1</kbd> attaque · <kbd>3</kbd> lourd · <kbd>0</kbd> saut · <kbd>7</kbd> garde · <kbd>9</kbd> spécial · <kbd>+</kbd> super</p>
      <h3>Manette</h3>
      <p class="small"><kbd>Stick</kbd> bouger (à fond : courir) · <kbd>X</kbd> attaque · <kbd>Y</kbd> lourd · <kbd>A</kbd> saut · <kbd>B</kbd> garde · <kbd>RB</kbd> spécial · <kbd>RT</kbd> super · <kbd>LB/LT</kbd> courir · <kbd>Start</kbd> pause</p>
      <h3>Tactile</h3>
      <p class="small">Pose le pouce gauche n'importe où à gauche : un joystick apparaît (à fond = courir). Boutons à droite : <kbd>A</kbd> attaque, <kbd>B</kbd> lourd, <kbd>X</kbd> saut, <kbd>Y</kbd> garde, <kbd>Ki</kbd>, <kbd>★</kbd> super. Tu peux glisser d'un bouton à l'autre.</p>
      <h3>Système</h3>
      <p class="small">
        <b>Enchaînements</b> : attaque ×3, puis lourd = finisseur, ou attaque ×4 = rafale du dragon. <b>Avant + lourd</b> = lanceur, puis saut + attaques aériennes pour jongler.<br>
        <b>Arrière/Bas + lourd</b> = coup bas (passe sous la garde haute). <b>Course + attaque</b> = attaque de course.<br>
        <b>Garde</b> : bloque de face. <b>Bas + garde</b> = garde basse (bloque les coups bas, pas les plongeons).<br>
        <b>Parade parfaite</b> : garde juste avant l'impact (7 frames) → l'ennemi est déséquilibré, +20 Ki, les projectiles sont renvoyés.<br>
        <b>Roulade</b> : garde + direction (invincible au milieu). Après un coup qui touche, garde + direction annule la récupération.<br>
        <b>Ki</b> : se remplit en frappant, 25 par spécial. <b>Super</b> : jauge pleine = super dévastateur et imparable.<br>
        <b>Coop</b> : un allié KO ? Maintiens Attaque à côté de lui pour le réanimer. Les caisses contiennent soins, Ki et pièces.
      </p>
    </div>
    <div>
      <h3>Liste des coups</h3>
      <div class="tabs">${tabs}</div>
      <p class="small muted" style="margin:0 0 6px">${esc(c.title)} — ${esc(c.desc)}</p>
      ${c.passiveText ? `<p class="small" style="margin:0 0 6px;color:var(--accent)">✦ ${esc(c.passiveText)}</p>` : ''}
      <table class="moves">
        <tr><th>Commande</th><th>Coup</th><th></th></tr>
        ${row('Attaque', 'l1')}${row('Attaque, Attaque', 'l2')}${row('Attaque ×3', 'l3')}
        ${row('Lourd', 'heavy', 'maintenir pour charger : armure + brise-garde')}
        ${row('Avant + Lourd', 'launcher', 'lanceur → saut-annulation')}
        ${row('Arrière/Bas + Lourd', 'low', 'coup bas')}
        ${row('Course + Attaque', 'run')}
        ${row('En l\'air : Attaque', 'air')}${row('En l\'air : Lourd', 'airHeavy', 'plongeon (passe la garde basse)')}
        ${row('Spécial', 'special', `${m.special.kiCost ?? 25} Ki`)}${row('Bas + Spécial', 'special2', `${m.special2.kiCost ?? 25} Ki`)}
        ${row('Super (jauge pleine)', 'super', 'imparable, invincible au départ')}
      </table>
    </div>
  </div>
  <h3 style="margin-top:18px">Commandes de combat de ${esc(c.name)}</h3>
  <p class="small muted">Directions relatives à ton regard : → avant, ← arrière, ↓ vers l'écran, ↑ vers le fond. Les diagonales sont tolérées et tu peux finir la saisie jusqu'à ~9 images après avoir appuyé sur le bouton. Sur manette ou tactile, le raccourci <b>Spécial + direction</b> fait la même chose. Le mode Entraînement affiche tes entrées et le nom de la commande réussie.</p>
  <table class="moves">
    <tr><th>Coup</th><th>Saisie</th><th>Raccourci</th><th>Effet</th><th>Coût</th></tr>
    ${COMMANDS.filter((c) => !!m[c.id]).map((c) => `<tr><td><b>${esc(m[c.id].name.replace(/ \(.*\)$/, '') || c.name)}</b></td><td><kbd>${esc(c.input)}</kbd></td><td class="small muted">${esc(c.assist)}</td><td class="small muted">${esc(c.note)}</td><td class="small">${esc(c.cost)}</td></tr>`).join('')}
  </table>
  <h3>Armes</h3>
  <p class="small muted">Ramasse-les au sol (halo doré) ou dans les caisses. Armes blanches : plus d'allonge, plus de dégâts et un effet propre, mais elles s'usent. Armes à feu : Attaque tire (maintenir pour la rafale). <b>Lourd</b> lance l'arme (sans direction) quand elle est lançable ; elle retombe au sol avec sa durabilité restante.</p>
  <table class="moves">
    <tr><th>Arme</th><th>Effet</th><th>Utilisations</th><th>Lançable</th></tr>
    ${Object.values(WEAPONS).map((w) => `<tr><td><b>${w.icon} ${esc(w.name)}</b></td><td class="small muted">${esc(w.desc)}</td><td class="small">${w.uses}</td><td class="small">${w.throwable ? 'oui' : 'non'}</td></tr>`).join('')}
  </table>
  <h3>Réanimation</h3>
  <p class="small muted">Un allié KO se réanime en maintenant <b>Attaque</b> à côté de lui. KO toi-même ? Appuie sur <b>Attaque</b> pour te réanimer contre 40 pièces communes, ou attends : tu reviens avec une vie.</p>
  <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="back">← Retour</button></div>`;
}

// ---- Options ----
export function optionsHtml(s: Settings, profile: Profile, pads: string[]): string {
  const km = (map: KeyMap, who: 'keymap1' | 'keymap2') =>
    (Object.keys(map) as (keyof KeyMap)[])
      .map((k) => `<div class="opt"><div class="lbl">${labelFor(k)}</div><div class="val"><span>${map[k].map((c) => `<kbd>${esc(keyLabel(c))}</kbd>`).join(' ')}</span><button class="btn sm" data-action="rebind" data-map="${who}" data-key="${k}">Changer</button></div></div>`)
      .join('');
  const pm = (map: PadMap) =>
    (Object.keys(map) as (keyof PadMap)[])
      .map((k) => `<div class="opt"><div class="lbl">${labelFor(k)}</div><div class="val"><span><kbd>${PAD_BUTTON_NAMES[map[k]] ?? map[k]}</kbd></span><button class="btn sm" data-action="rebind-pad" data-key="${k}">Changer</button></div></div>`)
      .join('');
  return `<h2>Options</h2>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
    <div class="col">
      <h3>Audio</h3>
      <label class="field">Effets sonores <input type="range" min="0" max="1" step="0.05" value="${s.volume}" data-set="volume"></label>
      <label class="field">Musique <input type="range" min="0" max="1" step="0.05" value="${s.music}" data-set="music"></label>
      <h3>Affichage</h3>
      <label class="toggle"><input type="checkbox" data-set="shake" ${s.shake ? 'checked' : ''}> Secousses d'écran</label>
      <label class="toggle"><input type="checkbox" data-set="reduceFx" ${s.reduceFx ? 'checked' : ''}> Réduire les effets (téléphones modestes)</label>
      <label class="toggle"><input type="checkbox" data-set="showHitboxes" ${s.showHitboxes ? 'checked' : ''}> Afficher les boîtes de collision</label>
      <h3>Tactile</h3>
      <label class="field">Taille des boutons <input type="range" min="0.75" max="1.5" step="0.05" value="${s.touchSize}" data-set="touchSize"></label>
      <label class="field">Opacité <input type="range" min="0.2" max="1" step="0.05" value="${s.touchOpacity}" data-set="touchOpacity"></label>
      <label class="toggle"><input type="checkbox" data-set="touchHaptics" ${s.touchHaptics ? 'checked' : ''}> Vibrations</label>
      <label class="toggle"><input type="checkbox" data-set="touchGestures" ${s.touchGestures ? 'checked' : ''}> Gestes (toucher = attaque · glisser ↑ saut, ↓ garde, ↔ lourd · appui long = Ki · 2 doigts = Super)</label>
      <label class="toggle"><input type="checkbox" data-set="touchOneHand" ${s.touchOneHand ? 'checked' : ''}> Mode une main (un doigt : glisser = bouger, tap = attaque, flick = saut / garde / lourd, rester appuyé = Ki)</label>
      <label class="toggle"><input type="checkbox" data-set="touchLeft" ${s.touchLeft ? 'checked' : ''}> Mode gaucher (boutons à gauche)</label>
      <h3>Profil</h3>
      <label class="field">Ton pseudo <input type="text" maxlength="14" value="${esc(s.name)}" data-set="name" placeholder="Joueur"></label>
      <p class="small muted">Stages terminés : ${profile.stageReached}/${STAGES.length} · Duels gagnés : ${profile.duelWins} · Meilleure survie : vague ${profile.bestSurvival} · Record : ${profile.bestScore} pts · KO : ${profile.totalKo}</p>
      <button class="btn danger sm" data-action="reset-profile">Effacer la progression</button>
    </div>
    <div class="col">
      <h3>Clavier joueur 1</h3>
      <div class="options">${km(s.keymap1 ?? KEYMAP_P1, 'keymap1')}</div>
      <h3>Clavier joueur 2</h3>
      <div class="options">${km(s.keymap2 ?? KEYMAP_P2, 'keymap2')}</div>
      <h3>Manette ${pads.length ? `(${pads.length} détectée${pads.length > 1 ? 's' : ''})` : '(aucune détectée : appuie sur un bouton)'}</h3>
      <div class="options">${pm(s.padmap ?? PADMAP_DEFAULT)}</div>
      <div class="row"><button class="btn sm" data-action="reset-controls">Commandes par défaut</button></div>
    </div>
  </div>
  <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="back">← Retour</button></div>`;
}

function labelFor(k: string): string {
  const L: Record<string, string> = { left: 'Gauche', right: 'Droite', up: 'Haut (fond)', down: 'Bas (avant)', light: 'Attaque', heavy: 'Lourd', jump: 'Saut', guard: 'Garde', special: 'Spécial', super: 'Super', dash: 'Courir', pause: 'Pause', confirm: 'Valider' };
  return L[k] ?? k;
}

export function menuHtml(profile: Profile, hasTouch: boolean, version: string, noNet = false, resume: { online?: string; local?: string } = {}, pwa: { install?: 'prompt' | 'ios' | ''; offline?: boolean; standalone?: boolean } = {}): string {
  return `<div class="row between" style="align-items:flex-end">
      <h1 class="logo">AI <span>FIGHTER</span> 2<small>BEAT'EM UP · 1 À 4 JOUEURS</small></h1>
      <div class="small muted" style="text-align:right">${pwa.offline ? '<b style="color:#ffb84d">⚡ Hors ligne</b> · solo et local seulement<br>' : ''}Stages : ${profile.stageReached}/${STAGES.length}<br>Record : ${profile.bestScore} pts</div>
    </div>
    ${resume.online || resume.local ? `<div class="resume">${resume.online ? `<button class="btn primary big" data-action="resume-online">↩ Reprendre la partie en ligne <span class="sub">salon ${esc(resume.online)} · tes coéquipiers t'attendent, une IA joue à ta place</span></button>` : ''}${resume.local ? `<button class="btn primary big" data-action="resume-local">↩ Reprendre la partie locale <span class="sub">${esc(resume.local)} · reprise là où tu t'étais arrêté</span></button>` : ''}</div>` : ''}
    <div class="grid menu" style="margin-top:18px">
      <button class="btn menu-item big ${noNet ? '' : ''}" data-action="solo-open"><span class="ico">🔗</span>Partie solo ouverte<span class="sub">${noNet ? 'Nécessite la version avec serveur' : 'Joue seul tout de suite : tes amis te rejoignent en cours de route avec un lien'}</span></button>
      <button class="btn menu-item big primary" data-action="local"><span class="ico">🎮</span>Jouer en local<span class="sub">Solo ou jusqu'à 4 sur cet écran : claviers, manettes${hasTouch ? ', tactile' : ''}</span></button>
      <button class="btn menu-item big ${noNet ? '' : 'primary'}" data-action="online"><span class="ico">📡</span>Jouer en ligne<span class="sub">${noNet ? 'Indisponible sur cette page hébergée : il faut la version avec serveur' : 'Chacun sur son téléphone / PC, avec un code de salon'}</span></button>
      <button class="btn menu-item" data-action="daily"><span class="ico">📅</span>Défi du jour<span class="sub">Même partie pour tous, un modificateur par jour, classement en ligne</span></button>
      <button class="btn menu-item" data-action="howto"><span class="ico">📖</span>Comment jouer<span class="sub">Commandes, système de combat, liste des coups</span></button>
      <button class="btn menu-item" data-action="idea"><span class="ico">💡</span>Proposer une idée<span class="sub">Écris ou dicte une amélioration : elle sera lue pour la prochaine version</span></button>
      ${pwa.install ? `<button class="btn menu-item" data-action="install"><span class="ico">📲</span>Installer l'application<span class="sub">${pwa.install === 'ios' ? 'Sur iPhone / iPad : Partager ⎋ puis « Sur l\'écran d\'accueil »' : 'Icône sur ton écran d\'accueil, plein écran, et jeu hors ligne'}</span></button>` : ''}
      <button class="btn menu-item" data-action="options"><span class="ico">⚙️</span>Options<span class="sub">Son, commandes, tactile, profil</span></button>
    </div>
    <p class="small muted" style="margin:14px 0 0">v${version} · <a href="./legal.html" target="_blank" rel="noopener" style="color:inherit">Légal, confidentialité et crédits</a> · Âge conseillé : 12+ (chat 13+)</p>`;
}

export function roomsHtml(rooms: PublicRoom[] | null, error = ''): string {
  if (error) return `<div class="small muted" style="padding:10px">${esc(error)}</div>`;
  if (rooms === null) return '<div class="small muted" style="padding:10px">Recherche des salons…</div>';
  if (!rooms.length) return '<div class="small muted" style="padding:10px">Aucun salon public pour l\'instant. Lance une <b>partie rapide</b> : ton salon apparaîtra ici et les autres pourront te rejoindre.</div>';
  return rooms.map((r) => `<div class="roomrow">
      <div class="rinfo"><b>${esc(r.host)}</b> <span class="small muted">${r.inGame ? '· ⚔ en cours ' : ''}· ${esc(MODE_LABEL[r.mode])}${r.mode === 'campaign' || r.mode === 'survival' ? ' · ' + esc(DIFF_LABEL[r.difficulty] ?? '') : ''}${r.teams ? ' · équipes' : ''}</span>
        <div class="small muted">${r.names.map(esc).join(', ')}</div></div>
      <div class="rcount">${r.players}/${r.max}</div>
      <button class="btn sm primary" data-action="join-room" data-code="${esc(r.code)}">Rejoindre</button>
    </div>`).join('');
}

export function onlineHtml(s: Settings, prefillCode: string, serverUrl: string): string {
  return `<h2>Jouer en ligne</h2>
  <label class="field">Ton pseudo <input type="text" id="name" maxlength="14" value="${esc(s.name)}" placeholder="Joueur"></label>
  <button class="btn primary big" data-action="quick" style="margin-top:12px;width:100%"><span>⚡ Partie rapide<span class="sub">Rejoint un salon public libre, ou en ouvre un : pas de code à saisir</span></span></button>
  <div class="row between" style="margin-top:14px"><h3 style="margin:0">Salons publics</h3><button class="btn sm" data-action="refresh">↻ Actualiser</button></div>
  <div id="rooms" class="rooms">${roomsHtml(null)}</div>
  <h3>Avec tes amis</h3>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">
    <div class="col" style="background:var(--panel2);padding:14px;border-radius:12px">
      <b>Créer un salon</b>
      <label class="toggle"><input type="checkbox" id="pub"> Public (visible dans la liste)</label>
      <button class="btn primary" data-action="create">➕ Créer</button>
    </div>
    <div class="col" style="background:var(--panel2);padding:14px;border-radius:12px">
      <b>Rejoindre avec un code</b>
      <input type="text" id="code" class="code" maxlength="5" placeholder="CODE" value="${esc(prefillCode)}" autocomplete="off" autocapitalize="characters">
      <button class="btn" data-action="join">🔗 Rejoindre</button>
    </div>
  </div>
  <details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">Serveur avancé</summary>
    <label class="field" style="margin-top:8px">Adresse du serveur WebSocket (vide = même adresse que la page) <input type="text" id="server" value="${esc(serverUrl)}" placeholder="wss://mon-serveur.exemple/ws"></label>
  </details>
  <div id="online-status" class="small muted" style="margin-top:10px;min-height:18px"></div>
  <div class="row" style="margin-top:14px"><button class="btn ghost" data-action="back">← Retour</button></div>`;
}

export function pauseHtml(canQuit: boolean, isHost: boolean, online: boolean, others: { slot: number; name: string }[] = []): string {
  return `<h2>Pause</h2>
  <div class="col">
    <button class="btn primary" data-action="resume">▶ Reprendre</button>
    ${online ? '<button class="btn" data-action="invite">🔗 Inviter des amis (partager le lien)</button>' : ''}
    ${online && isHost && others.length ? `<h3>Joueurs</h3>${others.map((o) => `<div class="row between"><span>P${o.slot + 1} · ${esc(o.name)}</span><button class="btn sm danger" data-action="kick" data-slot="${o.slot}">✖ Expulser</button></div>`).join('')}` : ''}
    <button class="btn" data-action="idea">💡 Proposer une idée</button>
    <button class="btn" data-action="controls">📖 Commandes</button>
    ${canQuit ? `<button class="btn danger" data-action="quit">${online ? (isHost ? '✖ Terminer la partie pour tout le monde' : '✖ Quitter la partie') : '✖ Quitter la partie'}</button>` : ''}
  </div>`;
}

export function endHtml(title: string, lines: string[], opts: { canReplay: boolean; canLobby: boolean; isHost: boolean; online: boolean; nextStage?: boolean; canWatch?: boolean; canShare?: boolean }): string {
  return `<h2>${esc(title)}</h2>
  <div class="col small muted">${lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>
  <div class="col" style="margin-top:12px">
    ${opts.canReplay ? `<button class="btn primary" data-action="replay">🔁 Rejouer</button>` : ''}
    ${opts.canWatch ? `<button class="btn" data-action="watch">🎬 Revoir la partie</button>` : ''}${opts.canShare ? `<button class="btn" data-action="share-replay">🔗 Partager la rediffusion</button>` : ''}
    ${opts.canLobby ? `<button class="btn" data-action="lobby">${opts.online ? '🏠 Retour au salon' : '🏠 Retour au salon'}</button>` : opts.online ? `<span class="small muted">L'hôte décide de la suite…</span>` : ''}
    <button class="btn" data-action="idea">💡 Proposer une idée / une amélioration</button>
    <button class="btn ghost" data-action="menu">Menu principal</button>
  </div>`;
}
