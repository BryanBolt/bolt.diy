import { describe, it, expect } from 'vitest';
import { createWorld, step, setSlotAi } from '../src/sim/sim';
import { motions, dirMaskOf, pushHistory, readCommand, D } from '../src/sim/commands';
import { IN } from '../src/sim/types';
import type { SimConfig, Fighter } from '../src/sim/types';
import { COMMANDS, ROSTER } from '../src/sim/chars';

function world(mode: SimConfig['mode'] = 'training', charId = 'kai') {
  const cfg: SimConfig = { mode, difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId, name: 'A', color: 0, team: 0 }], bots: [] };
  return createWorld(cfg, 7);
}

/** Joue une suite d'entrées (une entrée par frame) et retourne le monde. */
function play(w: ReturnType<typeof world>, frames: number[]) {
  for (const f of frames) step(w, [f]);
}
const R = IN.RIGHT, Dn = IN.DOWN, Lf = IN.LEFT, A = IN.LIGHT, K = IN.HEAVY;
const hold = (bits: number, n: number) => Array(n).fill(bits);

describe('détection des mouvements', () => {
  function fighter(frames: number[], facing: 1 | -1 = 1): { f: Fighter; now: number } {
    const f = { hist: [], facing } as unknown as Fighter;
    let now = 0;
    for (const bits of frames) { pushHistory(f, dirMaskOf(bits, facing), now); now++; }
    return { f, now };
  }
  it('quart de cercle avant (↓ ↘ →)', () => {
    const { f, now } = fighter([...hold(Dn, 3), ...hold(Dn | R, 3), ...hold(R, 2)]);
    expect(motions.qcf(f, now)).toBe(true);
    expect(motions.qcb(f, now)).toBe(false);
  });
  it('quart de cercle arrière avec un personnage tourné à gauche', () => {
    const { f, now } = fighter([...hold(Dn, 3), ...hold(Dn | R, 3), ...hold(R, 2)], -1);
    expect(motions.qcb(f, now)).toBe(true);
    expect(motions.qcf(f, now)).toBe(false);
  });
  it('dragon montant (→ ↓ ↘)', () => {
    const { f, now } = fighter([...hold(R, 3), ...hold(Dn, 3), ...hold(Dn | R, 3)]);
    expect(motions.dp(f, now)).toBe(true);
  });
  it('un mouvement trop ancien ne compte plus', () => {
    const { f, now } = fighter([...hold(Dn, 2), ...hold(R, 2), ...hold(0, 40)]);
    expect(motions.qcf(f, now)).toBe(false);
  });
  it('double quart de cercle', () => {
    const { f, now } = fighter([...hold(Dn, 2), ...hold(R, 2), ...hold(Dn, 2), ...hold(R, 2)]);
    expect(motions.dqcf(f, now)).toBe(true);
  });
  it('tour complet (360°)', () => {
    const { f, now } = fighter([...hold(R, 3), ...hold(Dn, 3), ...hold(Lf, 3), ...hold(IN.UP, 3), ...hold(R, 2)]);
    expect(motions.circle(f, now)).toBe(true);
  });
  it('poing éclair (→ N ↓ ↘)', () => {
    const { f, now } = fighter([...hold(R, 3), ...hold(0, 2), ...hold(Dn, 2), ...hold(Dn | R, 2)]);
    expect(motions.ewgf(f, now)).toBe(true);
  });
  it('readCommand : coûts respectés et priorités', () => {
    const { f, now } = fighter([...hold(Dn, 3), ...hold(Dn | R, 3), ...hold(R, 2)]);
    const base = { buf: A, inp: R, now, onGround: true, ki: 50, superMeter: 0, chainIndex: 0, running: false };
    expect(readCommand(f, base)).toBe('c_fire');
    expect(readCommand(f, { ...base, ki: 5 })).not.toBe('c_fire');
    expect(readCommand(f, { ...base, buf: A | K })).toBe('c_grab');
    expect(readCommand(f, { ...base, buf: K })).toBe('c_hundred');
    expect(D.FWD).toBe(1);
  });
});

describe('commandes en jeu', () => {
  it('↓ ↘ → + Attaque lance une boule de Ki', () => {
    const w = world();
    w.fighters[0].ki = 60;
    play(w, [...hold(Dn, 3), ...hold(Dn | R, 3), ...hold(R, 2), R | A, ...hold(0, 20)]);
    expect(w.fighters[0].lastCmd).toBe('Onde Ki');
    expect(w.fighters[0].ki).toBeLessThan(60);
  });
  it('→ ↓ ↘ + Attaque : dragon montant, le combattant décolle', () => {
    const w = world();
    w.fighters[0].ki = 60;
    let maxY = 0;
    for (const bits of [...hold(R, 3), ...hold(Dn, 3), ...hold(Dn | R, 2), Dn | R | A, ...hold(0, 20)]) { step(w, [bits]); maxY = Math.max(maxY, w.fighters[0].y); }
    expect(w.fighters[0].lastCmd).toBe('Lune montante');
    expect(maxY).toBeGreaterThan(40);
  });
  it('Attaque + Lourd simultanés : saisie, puis projection', () => {
    const w = world();
    const dummy = w.fighters[1];
    dummy.x = w.fighters[0].x + 40;
    dummy.z = w.fighters[0].z;
    const hp = dummy.hp;
    play(w, [A | K, ...hold(0, 14)]);
    expect(w.fighters[0].lastCmd).toBe('Saisie');
    expect(dummy.state).toBe('held'); // la cible est tenue
    play(w, [K | R, ...hold(0, 6)]); // projection devant
    expect(dummy.hp).toBeLessThan(hp);
  });
  it('Spécial + avant (raccourci manette) = boule de Ki', () => {
    const w = world();
    w.fighters[0].ki = 60;
    play(w, [R | IN.SPECIAL, ...hold(0, 20)]);
    expect(w.fighters[0].lastCmd).toBe('Onde Ki');
  });
  it('le pas arrière ne retourne pas le personnage quand un ennemi est devant', () => {
    const w = world();
    const p = w.fighters[0];
    w.fighters[1].x = p.x + 100;
    w.fighters[1].z = p.z;
    p.facing = 1;
    play(w, hold(Lf, 8));
    expect(p.facing).toBe(1);
    play(w, hold(Lf, 20));
    expect(p.facing).toBe(-1);
  });
  it('tous les héros ont toutes les commandes', () => {
    for (const c of ROSTER) for (const id of ['c_fire', 'c_dp', 'c_tatsu', 'c_superfire', 'c_grab', 'c_piledriver', 'c_side', 'c_airflying', 'c_flurry']) expect(c.moves[id], `${c.id}:${id}`).toBeTruthy();
    expect(COMMANDS.length).toBeGreaterThan(10);
  });
});

describe('armes à feu', () => {
  it('la kalachnikov tire en rafale, consomme les munitions et blesse', () => {
    const w = world();
    const p = w.fighters[0];
    const dummy = w.fighters[1];
    dummy.z = p.z;
    dummy.x = p.x + 250;
    p.weaponKind = 'ak';
    p.weapon = 30;
    const hp = dummy.hp;
    play(w, hold(A, 40));
    expect(p.weapon).toBeLessThan(26);
    expect(dummy.hp).toBeLessThan(hp);
  });
  it('à court de balles, l\'arme disparaît', () => {
    const w = world();
    const p = w.fighters[0];
    p.weaponKind = 'pistol';
    p.weapon = 1;
    play(w, [A, ...hold(0, 10)]);
    expect(p.weapon).toBe(0);
    expect(p.weaponKind).toBe('');
  });
});

describe('non-régression', () => {
  it('toucher un ennemi qui tire ne plante pas (contre-coup, rendu)', () => {
    const w = world();
    const p = w.fighters[0];
    const dummy = w.fighters[1];
    dummy.x = p.x + 50; dummy.z = p.z;
    dummy.weaponKind = 'ak'; dummy.weapon = 30; dummy.facing = -1;
    // le mannequin tire pendant que le joueur le frappe
    dummy.state = 'attack'; dummy.moveId = 'shoot'; dummy.stateFrame = 1; dummy.moveHits = [-1];
    play(w, [A, ...hold(0, 20)]);
    expect(Number.isFinite(dummy.hp)).toBe(true);
  });
  it('un boss en coop ne se dédouble pas', () => {
    const w = createWorld({ mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'tora', name: 'B', color: 1, team: 0 }], bots: [] }, 5);
    w.waveIndex = 2; w.locked = false;
    for (const f of w.fighters) f.x = 1500;
    for (let i = 0; i < 400; i++) step(w, [0, 0]);
    expect(w.fighters.filter((f) => f.boss).length).toBe(1);
  });
});

describe('réanimation payante', () => {
  it('un joueur KO se réanime avec des pièces en appuyant sur Attaque', () => {
    const w = createWorld({ mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'tora', name: 'B', color: 1, team: 0 }], bots: [] }, 3);
    setSlotAi(w, 1);
    for (let i = 0; i < 200; i++) step(w, [0, 0]);
    const p = w.fighters.find((f) => f.slot === 0)!;
    w.coins = 100;
    p.hp = 0;
    p.state = 'ko';
    p.koTimer = 0;
    for (let i = 0; i < 50; i++) step(w, [0, 0]);
    step(w, [A, 0]);
    step(w, [0, 0]);
    expect(p.state).not.toBe('ko');
    expect(w.coins).toBe(60);
  });
});

describe('techniques cultes', () => {
  const ctx = (f: Fighter, buf: number, now: number, over: object = {}) => ({ buf, inp: 0, now, onGround: true, ki: 100, superMeter: 100, chainIndex: 0, running: false, ...over });
  function fighter(frames: number[]) {
    const f = { hist: [], facing: 1 } as unknown as Fighter;
    let now = 0;
    for (const bits of frames) { pushHistory(f, dirMaskOf(bits, 1), now); now++; }
    return { f, now };
  }
  it('rayon (↓ ↙ ← + Attaque) et Falcon (→ ↓ ↘ + Lourd)', () => {
    let s = fighter([...hold(Dn, 3), ...hold(Dn | Lf, 3), ...hold(Lf, 2)]);
    expect(readCommand(s.f, ctx(s.f, A, s.now, { inp: Lf }))).toBe('c_wave');
    s = fighter([...hold(R, 3), ...hold(Dn, 3), ...hold(Dn | R, 3)]);
    expect(readCommand(s.f, ctx(s.f, K, s.now, { inp: Dn | R }))).toBe('c_falcon');
  });
  it('Pourpre vide demande 60 Super, Omnislash 50', () => {
    const s = fighter([...hold(Dn, 2), ...hold(Lf, 2), ...hold(Dn, 2), ...hold(Lf, 2)]);
    expect(readCommand(s.f, ctx(s.f, K, s.now, { inp: Lf }))).toBe('c_purple');
    expect(readCommand(s.f, ctx(s.f, K, s.now, { inp: Lf, superMeter: 30 }))).not.toBe('c_purple');
  });
  it('Rider Kick en l\'air', () => {
    const s = fighter([...hold(R, 2)]);
    expect(readCommand(s.f, ctx(s.f, K, s.now, { inp: R, onGround: false }))).toBe('c_rider');
  });
  it('tous les héros possèdent les nouveaux coups et ils se lancent', () => {
    // chaque héros a ses 3 signatures + ses 4 commandes perso ; les commandes redondantes ont disparu
    for (const ch of ROSTER) {
      for (const id of ['c_fire', 'c_dp', 'c_tatsu', 'c_superfire', 'c_grab', 'transform']) expect(ch.moves[id], `${ch.id}.${id}`).toBeDefined();
      const sigs = ['c_wave', 'c_rocket', 'c_falcon', 'c_meteor', 'c_purple', 'c_omni', 'c_serious', 'c_step', 'c_rasen', 'c_rider'].filter((id) => ch.moves[id]);
      expect(sigs.length, ch.id).toBe(3);
      expect(ch.moves.c_hundred, ch.id).toBeUndefined();
    }
    expect(new Set(ROSTER.map((ch) => ch.moves.c_fire.name)).size).toBe(ROSTER.length);
    for (const id of ['c_wave', 'c_rocket', 'c_falcon', 'c_meteor', 'c_purple', 'c_omni', 'c_serious', 'c_step', 'c_rasen', 'c_rider']) expect(COMMANDS.find((c) => c.id === id), id).toBeDefined();
  });
});

describe('techniques cultes en simulation', () => {
  it('chaque technique se déclenche et la simulation reste stable', () => {
    const seqs: Record<string, number[]> = {
      c_wave: [...hold(Dn, 3), ...hold(Dn | Lf, 3), ...hold(Lf, 2), Lf | A],
      c_falcon: [...hold(R, 3), ...hold(Dn, 3), ...hold(Dn | R, 3), Dn | R | K],
      c_rocket: [...hold(Lf, 3), ...hold(R, 2), R | K],
      c_step: [...hold(Dn, 2), 0, ...hold(Dn, 2), Dn | K],
      c_rasen: [...hold(Dn, 3), ...hold(IN.UP, 2), IN.UP | A],
    };
    const owner: Record<string, string> = { c_wave: 'kai', c_falcon: 'tora', c_rocket: 'tora', c_step: 'zed', c_rasen: 'orion' };
    for (const [id, inputs] of Object.entries(seqs)) {
      const w = world('training', owner[id]);
      const p = w.fighters.find((f) => f.slot === 0)!;
      p.ki = 100; p.superMeter = 100;
      let seen = false;
      for (const i of [...inputs, ...hold(0, 90)]) { step(w, [i]); if (p.moveId === id) seen = true; }
      expect(seen, id).toBe(true);
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('finisseurs façon Budokai', () => {
  it('P P P puis E lance la Rafale, K K K puis E la Tempête', () => {
    for (const [seq, id] of [[[A, A, A], 'c_cmb_rafale'], [[K, K, K], 'c_cmb_tempete'], [[A, K, A], 'c_cmb_briseur']] as [number[], string][]) {
      const w = world();
      const p = w.fighters.find((f) => f.slot === 0)!;
      p.ki = 100;
      let seen = false;
      const frames: number[] = [];
      for (const b of seq) { frames.push(b, b, 0, 0, 0, 0, 0); }
      frames.push(IN.SPECIAL, IN.SPECIAL, ...hold(0, 80));
      for (const i of frames) { step(w, [i]); if (p.moveId === id) seen = true; }
      expect(seen, id).toBe(true);
    }
  });
  it('sans assez de Ki, le finisseur ne part pas', () => {
    const w = world();
    const p = w.fighters.find((f) => f.slot === 0)!;
    p.ki = 0;
    let seen = false;
    for (const i of [A, 0, 0, 0, 0, 0, 0, A, 0, 0, 0, 0, 0, 0, A, 0, 0, IN.SPECIAL, 0, 0, 0, 0, 0, 0, 0, 0]) { step(w, [i]); if (p.moveId === 'c_cmb_rafale') seen = true; }
    expect(seen).toBe(false);
  });
});
