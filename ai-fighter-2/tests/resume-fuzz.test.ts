// Robustesse : scénarios aléatoires de coupure / retour sur le vrai serveur ; les deux clients doivent finir identiques.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { NetClient } from '../src/net/client';
import { Session } from '../src/net/session';
import { hashWorld } from '../src/sim/hash';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { decodeRle, type ServerMsg } from '../shared/protocol';
import type { InputManager } from '../src/input/manager';
import { Rng } from '../src/core/math';

const PORT = 18900 + Math.floor(Math.random() * 90);
let server: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class FakeInput {
  tick = 0;
  constructor(private seed: number) {}
  bitsFor(slot: number): number {
    const r = new Rng(this.seed * 7919 + slot * 104729 + Math.floor(this.tick / 4));
    let b = 0;
    if (r.chance(0.5)) b |= r.chance(0.5) ? IN.LEFT : IN.RIGHT;
    if (r.chance(0.25)) b |= r.chance(0.5) ? IN.UP : IN.DOWN;
    if (r.chance(0.3)) b |= IN.LIGHT;
    if (r.chance(0.12)) b |= IN.HEAVY;
    if (r.chance(0.08)) b |= IN.JUMP;
    if (r.chance(0.1)) b |= IN.GUARD;
    if (r.chance(0.06)) b |= IN.SPECIAL;
    if (r.chance(0.04)) b |= IN.SUPER;
    return b;
  }
}

function waitFor<T extends ServerMsg['t']>(net: NetClient, type: T, ms = 5000): Promise<Extract<ServerMsg, { t: T }>> {
  return new Promise((resolve, reject) => {
    const off = net.on(type, (m) => { off(); clearTimeout(tm); resolve(m as Extract<ServerMsg, { t: T }>); });
    const tm = setTimeout(() => { off(); reject(new Error('timeout ' + type)); }, ms);
  });
}

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return; } catch { /* pas prêt */ }
    await sleep(150);
  }
  throw new Error('serveur non démarré');
}, 20000);
afterAll(() => { server?.kill(); });

async function scenario(n: number): Promise<string | null> {
  const r = new Rng(1000 + n * 31);
  const mode: SimConfig['mode'] = r.chance(0.5) ? 'duel' : 'campaign';
  const config: SimConfig = mode === 'duel'
    ? { mode, difficulty: 1, rounds: 5, teams: false, stageIndex: r.int(0, 6), players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'zed', name: 'B', color: 1, team: 1 }], bots: r.chance(0.5) ? [{ charId: 'tora', name: 'C', color: 2, team: 2, level: 3 }] : [] }
    : { mode, difficulty: 1, rounds: 3, teams: false, stageIndex: r.int(0, 3), players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'vex', name: 'B', color: 1, team: 0 }], bots: [] };
  const killAt = r.int(100, 450);
  const absence = r.int(40, 600);
  const skipB = r.range(0, 0.35);
  const url = `ws://localhost:${PORT}/ws`;
  const a = new NetClient(); const b = new NetClient();
  await a.connect(url); await b.connect(url);
  const ja = waitFor(a, 'joined'); a.send({ t: 'create', name: 'A', charId: 'kai', color: 0 }); const jA = await ja;
  const jb = waitFor(b, 'joined'); b.send({ t: 'join', code: jA.code, name: 'B', charId: 'zed', color: 1 }); const jB = await jb;
  const sa = waitFor(a, 'start'); const sb = waitFor(b, 'start');
  a.send({ t: 'start', seed: 500 + n }); const [st] = await Promise.all([sa, sb]);
  const inA = new FakeInput(n); const inB = new FakeInput(n + 99);
  const mk = (net: NetClient, slot: number, inp: FakeInput, replay?: ConstructorParameters<typeof Session>[0]['replay']) =>
    new Session({ config, seed: st.seed, localSlots: [slot], allSlots: [0, 1], delay: st.delay, input: inp as unknown as InputManager, net, replay });
  const A = mk(a, 0, inA);
  let B = mk(b, 1, inB);
  let now = 0;
  let bAlive = true;
  const pump = async (ticks: number) => {
    for (let i = 0; i < ticks; i++) {
      now += 16.7; inA.tick++; inB.tick++;
      A.update(now);
      if (bAlive && r.next() >= skipB) B.update(now);
      await sleep(1);
    }
  };
  await pump(killAt);
  const dropped = waitFor(a, 'drop');
  bAlive = false; b.close(); B.dispose();
  await dropped;
  await pump(absence);
  const b2 = new NetClient(); await b2.connect(url);
  const rp = waitFor(b2, 'resume'); b2.send({ t: 'rejoin', code: jA.code, token: jB.token }); const rs = await rp;
  const log: Record<number, number[]> = {};
  for (const e of rs.log) log[e.slot] = decodeRle(e.rle);
  B = mk(b2, 1, inB, { log, events: rs.events, resumeFrom: rs.from });
  bAlive = true;
  await pump(rs.from - A.simFrame + 500);
  // aligne les deux sessions sur la même frame
  for (let i = 0; i < 800 && A.simFrame !== B.simFrame; i++) {
    now += 16.7; inA.tick++; inB.tick++;
    (A.simFrame < B.simFrame ? A : B).update(now);
    await sleep(1);
  }
  const res = A.simFrame === B.simFrame && hashWorld(A.world) === hashWorld(B.world) && !A.desync && !B.desync && !B.catching
    ? null
    : `scénario ${n} (${mode}, coupure ${killAt}, absence ${absence}, saut ${skipB.toFixed(2)}) : A=${A.simFrame} B=${B.simFrame} hashA=${hashWorld(A.world)} hashB=${hashWorld(B.world)} desync=${A.desync}/${B.desync} catching=${B.catching}`;
  a.close(); b2.close();
  return res;
}

describe('reprise : robustesse', () => {
  it('20 scénarios aléatoires de coupure et de retour restent synchronisés', async () => {
    const failures: string[] = [];
    for (let n = 1; n <= 20; n++) {
      const f = await scenario(n);
      if (f) failures.push(f);
    }
    expect(failures).toEqual([]);
  }, 240000);
});
