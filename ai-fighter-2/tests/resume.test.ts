// Test de bout en bout avec le vrai serveur : coupure, remplacement par une IA, retour avec rejeu du journal.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { NetClient } from '../src/net/client';
import { Session } from '../src/net/session';
import { hashWorld } from '../src/sim/hash';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { decodeRle } from '../shared/protocol';
import type { ServerMsg } from '../shared/protocol';
import type { InputManager } from '../src/input/manager';

const PORT = 18700 + Math.floor(Math.random() * 200);
let server: ChildProcess;

class FakeInput {
  tick = 0;
  bitsFor(slot: number): number {
    const t = this.tick;
    let b = 0;
    if ((t + slot * 7) % 40 < 18) b |= slot === 0 ? IN.RIGHT : IN.LEFT;
    if ((t * (slot + 3)) % 23 === 0) b |= IN.LIGHT;
    if ((t + slot) % 61 === 0) b |= IN.HEAVY;
    if ((t + slot * 5) % 97 === 0) b |= IN.JUMP;
    return b;
  }
}

function config(): SimConfig {
  return { mode: 'duel', difficulty: 1, rounds: 5, teams: false, stageIndex: 0,
    players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'tora', name: 'B', color: 1, team: 1 }], bots: [] };
}

function waitFor<T extends ServerMsg['t']>(net: NetClient, type: T, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
  return new Promise((resolve, reject) => {
    const off = net.on(type, (m) => { off(); clearTimeout(tm); resolve(m as Extract<ServerMsg, { t: T }>); });
    const tm = setTimeout(() => { off(); reject(new Error('timeout ' + type)); }, ms);
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, RATE_PER_S: '100000', PORT: String(PORT), AFK_MS: '2500', IDEAS_KEY: 'secret', IDEAS_FILE: '/tmp/aif2-test-ideas-' + PORT + '.jsonl' }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return; } catch { /* pas encore prêt */ }
    await sleep(150);
  }
  throw new Error('serveur non démarré');
}, 20000);
afterAll(() => { server?.kill(); });

describe('reprise de partie en ligne', () => {
  it('coupure, IA à la place du joueur, retour avec rejeu : partie identique pour tous', async () => {
    const url = `ws://localhost:${PORT}/ws`;
    const a = new NetClient();
    const b = new NetClient();
    await a.connect(url);
    await b.connect(url);
    const joinedA = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'A', charId: 'kai', color: 0 });
    const ja = await joinedA;
    const joinedB = waitFor(b, 'joined');
    b.send({ t: 'join', code: ja.code, name: 'B', charId: 'tora', color: 1 });
    const jb = await joinedB;
    expect(jb.token).toBeTruthy();
    expect(jb.token).not.toBe(ja.token);
    const startA = waitFor(a, 'start');
    const startB = waitFor(b, 'start');
    a.send({ t: 'start', seed: 4242 });
    const [sa, sb] = await Promise.all([startA, startB]);

    const inA = new FakeInput();
    const inB = new FakeInput();
    const mk = (net: NetClient, slot: number, inp: FakeInput, replay?: ConstructorParameters<typeof Session>[0]['replay']) =>
      new Session({ config: config(), seed: sa.seed, localSlots: [slot], allSlots: [0, 1], delay: sa.delay, input: inp as unknown as InputManager, net, replay });
    const A = mk(a, 0, inA);
    let B = mk(b, 1, inB);
    expect(sb.seed).toBe(sa.seed);

    let now = 0;
    const pump = async (ticks: number, sessions: Session[], inputs: FakeInput[]) => {
      for (let i = 0; i < ticks; i++) {
        now += 16.7;
        inputs.forEach((x) => x.tick++);
        for (const s of sessions) s.update(now);
        await sleep(2);
      }
    };
    await pump(300, [A, B], [inA, inB]);
    expect(A.simFrame).toBeGreaterThan(200);
    expect(B.simFrame).toBeGreaterThan(200);

    // B perd la connexion (fermeture brutale du côté client)
    const dropA = waitFor(a, 'drop');
    b.close();
    B.dispose();
    const drop = await dropA;
    expect(drop.slot).toBe(1);
    const frameAtDrop = A.simFrame;
    await pump(400, [A], [inA]);
    expect(A.simFrame).toBeGreaterThan(frameAtDrop + 200); // la partie continue sans B
    expect(A.world.fighters.find((f) => f.slot === 1)!.controller).toBe('ai');

    // B revient avec son jeton
    const b2 = new NetClient();
    await b2.connect(url);
    const resumeP = waitFor(b2, 'resume');
    b2.send({ t: 'rejoin', code: ja.code, token: jb.token });
    const rs = await resumeP;
    expect(rs.slot).toBe(1);
    expect(rs.from).toBeGreaterThan(A.simFrame); // reprise annoncée dans le futur
    const log: Record<number, number[]> = {};
    for (const e of rs.log) log[e.slot] = decodeRle(e.rle);
    B = mk(b2, 1, inB, { log, events: rs.events, resumeFrom: rs.from });
    expect(B.catching).toBe(true);

    await pump(900, [A, B], [inA, inB]);
    expect(B.catching).toBe(false);
    expect(B.world.fighters.find((f) => f.slot === 1)!.controller).toBe('player');
    expect(A.world.fighters.find((f) => f.slot === 1)!.controller).toBe('player');
    expect(A.desync).toBe(false);
    expect(B.desync).toBe(false);
    expect(B.simFrame).toBeGreaterThan(rs.from);

    // mêmes frames => mêmes états
    for (let i = 0; i < 600 && A.simFrame !== B.simFrame; i++) {
      now += 16.7;
      inA.tick++; inB.tick++;
      (A.simFrame < B.simFrame ? A : B).update(now);
      await sleep(1);
    }
    expect(A.simFrame).toBe(B.simFrame);
    expect(hashWorld(A.world)).toBe(hashWorld(B.world));
    a.close(); b2.close();
  }, 60000);

  it('un jeton invalide ou une partie terminée est refusé', async () => {
    const c = new NetClient();
    await c.connect(`ws://localhost:${PORT}/ws`);
    const err = waitFor(c, 'error');
    c.send({ t: 'rejoin', code: 'ZZZZZ', token: 'nimporte' });
    const e = await err;
    expect(e.code).toBe('gone');
    c.close();
  }, 15000);

  it('un joueur rejoint une partie solo en cours : nouveau combattant, partie identique pour tous', async () => {
    const url = `ws://localhost:${PORT}/ws`;
    const solo: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
    const a = new NetClient();
    await a.connect(url);
    const joinedA = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'A', charId: 'kai', color: 0 });
    const ja = await joinedA;
    const startA = waitFor(a, 'start');
    a.send({ t: 'start', seed: 777 });
    const sa = await startA;
    const inA = new FakeInput();
    const A = new Session({ config: solo, seed: sa.seed, localSlots: [0], allSlots: [0], delay: sa.delay, input: inA as unknown as InputManager, net: a });
    let now = 0;
    const inB = new FakeInput();
    const pump = async (ticks: number, sessions: Session[], inputs: FakeInput[]) => {
      for (let i = 0; i < ticks; i++) { now += 16.7; inputs.forEach((x) => x.tick++); for (const s of sessions) s.update(now); await sleep(2); }
    };
    await pump(240, [A], [inA]);
    expect(A.simFrame).toBeGreaterThan(150);

    // B rejoint via le code du salon alors que la partie tourne
    const b = new NetClient();
    await b.connect(url);
    const rejoinA = waitFor(a, 'rejoin');
    const resumeB = waitFor(b, 'resume');
    b.send({ t: 'join', code: ja.code, name: 'B', charId: 'tora', color: 1 });
    const rs = await resumeB;
    const rj = await rejoinA;
    expect(rs.slot).toBe(1);
    expect(rj.join?.name).toBe('B');
    expect(rs.from).toBeGreaterThan(A.simFrame);
    const log: Record<number, number[]> = {};
    for (const e of rs.log) log[e.slot] = decodeRle(e.rle);
    const B = new Session({ config: solo, seed: rs.seed, localSlots: [1], allSlots: [0], delay: rs.delay, input: inB as unknown as InputManager, net: b, replay: { log, events: rs.events, resumeFrom: rs.from } });
    await pump(900, [A, B], [inA, inB]);
    expect(B.catching).toBe(false);
    expect(A.world.fighters.filter((f) => f.slot >= 0).length).toBe(2);
    expect(B.world.fighters.filter((f) => f.slot >= 0).length).toBe(2);
    expect(A.desync).toBe(false);
    expect(B.desync).toBe(false);
    for (let i = 0; i < 600 && A.simFrame !== B.simFrame; i++) { now += 16.7; inA.tick++; inB.tick++; (A.simFrame < B.simFrame ? A : B).update(now); await sleep(1); }
    expect(A.simFrame).toBe(B.simFrame);
    expect(hashWorld(A.world)).toBe(hashWorld(B.world));
    a.close(); b.close();
  }, 60000);

  it('réseau lent chez un joueur : le délai d\'entrée s\'adapte et la partie avance sans désynchronisation', async () => {
    const url = `ws://localhost:${PORT}/ws`;
    const a = new NetClient(); const b = new NetClient();
    await a.connect(url); await b.connect(url);
    const jA = waitFor(a, 'joined'); a.send({ t: 'create', name: 'A', charId: 'kai', color: 0 });
    const ja = await jA;
    const jB = waitFor(b, 'joined'); b.send({ t: 'join', code: ja.code, name: 'B', charId: 'tora', color: 1 });
    await jB;
    const stA = waitFor(a, 'start'); const stB = waitFor(b, 'start');
    a.send({ t: 'start', seed: 99 });
    const [sa] = await Promise.all([stA, stB]);
    // B a ~150 ms de latence à l'envoi
    const realSend = b.send.bind(b);
    (b as unknown as { send: (m: unknown) => void }).send = (m: unknown) => { setTimeout(() => realSend(m as Parameters<typeof realSend>[0]), 150); };
    const inA = new FakeInput(); const inB = new FakeInput();
    const mk = (net: NetClient, slot: number, inp: FakeInput) => new Session({ config: config(), seed: sa.seed, localSlots: [slot], allSlots: [0, 1], delay: sa.delay, input: inp as unknown as InputManager, net });
    const A = mk(a, 0, inA); const B = mk(b, 1, inB);
    let now = 0;
    for (let i = 0; i < 900; i++) { now += 16.7; inA.tick++; inB.tick++; A.update(now); B.update(now); await sleep(3); }
    expect(A.delay).toBeGreaterThan(sa.delay);
    expect(B.delay).toBeGreaterThan(sa.delay);
    expect(A.simFrame).toBeGreaterThan(300);
    expect(A.desync).toBe(false);
    expect(B.desync).toBe(false);
    a.close(); b.close();
  }, 60000);

  it('un joueur inactif est remplacé par une IA puis reprend la main ; l\'hôte peut expulser', async () => {
    const url = `ws://localhost:${PORT}/ws`;
    const a = new NetClient(); const b = new NetClient();
    await a.connect(url); await b.connect(url);
    const jA = waitFor(a, 'joined'); a.send({ t: 'create', name: 'A', charId: 'kai', color: 0 });
    const ja = await jA;
    const jB = waitFor(b, 'joined'); b.send({ t: 'join', code: ja.code, name: 'B', charId: 'tora', color: 1 });
    await jB;
    const stA = waitFor(a, 'start');
    a.send({ t: 'start', seed: 5 });
    await stA;
    // A joue, B envoie des entrées vides : inactif
    let f = 0;
    const timer = setInterval(() => { a.send({ t: 'input', f, bits: [IN.RIGHT] }); b.send({ t: 'input', f, bits: [0] }); f++; }, 16);
    const afk = await waitFor(a, 'drop', 9000);
    expect(afk.slot).toBe(1);
    expect(afk.afk).toBe(true);
    // B appuie sur une touche : retour annoncé à tous
    const back = waitFor(a, 'rejoin', 4000);
    b.send({ t: 'input', f: f + 1, bits: [IN.LIGHT] });
    const rj = await back;
    expect(rj.slot).toBe(1);
    expect(rj.from).toBeGreaterThan(f);
    clearInterval(timer);
    // expulsion par l'hôte (B n'est pas l'hôte : sans effet ; A expulse B)
    const kickedB = waitFor(b, 'kicked', 4000);
    a.send({ t: 'kick', slot: 1 });
    await kickedB;
    a.close(); b.close();
  }, 40000);

  it('les idées des joueurs sont enregistrées, limitées en débit, et lisibles avec la clé', async () => {
    const base = `http://localhost:${PORT}`;
    const post = (body: unknown) => fetch(`${base}/api/ideas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const r1 = await post({ text: 'Ajouter un mode capture du drapeau', category: 'Gameplay', name: 'Bryan', ctx: { stage: 'Dojo' } });
    expect(r1.status).toBe(200);
    expect((await r1.json()).ok).toBe(true);
    expect((await post({ text: 'ok' })).status).toBe(400); // trop court
    const noKey = await fetch(`${base}/api/ideas`);
    expect(noKey.status).toBe(401);
    const list = await (await fetch(`${base}/api/ideas?key=secret`)).json() as { text: string; category: string }[];
    expect(list.some((i) => i.text.includes('capture du drapeau') && i.category === 'Gameplay')).toBe(true);
    const page = await (await fetch(`${base}/ideas?key=secret`)).text();
    expect(page).toContain('capture du drapeau');
    let limited = false;
    for (let i = 0; i < 8; i++) if ((await post({ text: `idée de test numéro ${i}`, category: 'Autre' })).status === 429) limited = true;
    expect(limited).toBe(true);
  }, 20000);
});
