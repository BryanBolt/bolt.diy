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
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
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
});
