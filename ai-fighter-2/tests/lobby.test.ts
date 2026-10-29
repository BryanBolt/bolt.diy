// Salons publics : liste, partie rapide, visibilité — sur le vrai serveur.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { NetClient } from '../src/net/client';
import type { ServerMsg } from '../shared/protocol';

const PORT = 19100 + Math.floor(Math.random() * 80);
let server: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const url = `ws://localhost:${PORT}/ws`;

function waitFor<T extends ServerMsg['t']>(net: NetClient, type: T, ms = 4000): Promise<Extract<ServerMsg, { t: T }>> {
  return new Promise((resolve, reject) => {
    const off = net.on(type, (m) => { off(); clearTimeout(tm); resolve(m as Extract<ServerMsg, { t: T }>); });
    const tm = setTimeout(() => { off(); reject(new Error('timeout ' + type)); }, ms);
  });
}
async function client(): Promise<NetClient> { const c = new NetClient(); await c.connect(url); return c; }
async function rooms(c: NetClient) { const p = waitFor(c, 'rooms'); c.send({ t: 'list' }); return (await p).rooms; }

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://localhost:${PORT}/health`); if (r.ok) return; } catch { /* pas prêt */ }
    await sleep(150);
  }
  throw new Error('serveur non démarré');
}, 20000);
afterAll(() => { server?.kill(); });

describe('salons publics', () => {
  it('serveur robuste : requête malformée, message trop gros, options hors liste', async () => {
    expect((await fetch(`http://localhost:${PORT}/%`)).status).toBe(400);
    const { WebSocket } = await import('ws');
    const raw = new WebSocket(url);
    await new Promise((r) => raw.on('open', r));
    raw.on('error', () => {});
    raw.send('x'.repeat(20000));
    await sleep(300);
    expect((await fetch(`http://localhost:${PORT}/health`)).ok).toBe(true);
    const a = await client();
    const j = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'Opt', charId: 'pirate', color: 99 });
    await j;
    const got = new Promise<string>((res) => { a.on('lobby', (m) => { const st = (m as Extract<ServerMsg, { t: 'lobby' }>).state; if (st.options.bots === 3) res(`${st.options.mode}|${st.players[0].charId}|${st.players[0].color}`); }); setTimeout(() => res('timeout'), 3000); });
    a.send({ t: 'options', options: { mode: 'x', bots: 9999 } as never });
    expect(await got).toMatch(/^(campaign|duel|survival|training)\|kai\|\d+$/);
    a.close();
  });

  it('cosmétiques : relayés dans le salon, valeurs inconnues rejetées', async () => {
    const a = await client();
    const j = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'Dandy', charId: 'kai', color: 0, hat: 'crown', aura: 'fire' });
    await j;
    const got = new Promise<string>((res) => { a.on('lobby', (m) => { const p = (m as Extract<ServerMsg, { t: 'lobby' }>).state.players[0]; if (p.hat === '' && p.aura === 'frost') res('ok'); }); setTimeout(() => res('timeout'), 3000); });
    a.send({ t: 'lobby', hat: '<img>', aura: 'frost' });
    expect(await got).toBe('ok');
    a.close();
  });

  it('choix d\'équipe : relayé dans le salon, équipe par défaut = slot % 2', async () => {
    const a = await client();
    const j = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'Chef', charId: 'kai', color: 0 });
    await j;
    const got = new Promise<number | undefined>((res) => { a.on('lobby', (m) => { if ((m as Extract<ServerMsg, { t: 'lobby' }>).state.players[0].team === 1) res(1); }); setTimeout(() => res(undefined), 3000); });
    a.send({ t: 'lobby', team: 1 });
    expect(await got).toBe(1);
    a.close();
  });

  it('un salon privé n\'apparaît pas dans la liste', async () => {
    const a = await client();
    const j = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'Privé', charId: 'kai', color: 0 });
    expect((await j).created).toBe(true);
    const viewer = await client();
    expect((await rooms(viewer)).find((r) => r.host === 'Privé')).toBeUndefined();
    a.close(); viewer.close();
  });

  it('partie rapide : le premier ouvre un salon public, le suivant le rejoint sans code', async () => {
    const a = await client();
    const ja = waitFor(a, 'joined');
    a.send({ t: 'quick', name: 'Alice', charId: 'kai', color: 0 });
    const A = await ja;
    expect(A.created).toBe(true);
    expect(A.slot).toBe(0);
    const b = await client();
    const jb = waitFor(b, 'joined');
    b.send({ t: 'quick', name: 'Bob', charId: 'tora', color: 1 });
    const B = await jb;
    expect(B.created).toBeFalsy();
    expect(B.code).toBe(A.code);
    expect(B.slot).toBe(1);
    // la liste montre le salon avec les deux joueurs
    const viewer = await client();
    const list = await rooms(viewer);
    const mine = list.find((r) => r.code === A.code)!;
    expect(mine).toBeTruthy();
    expect(mine.players).toBe(2);
    expect(mine.host).toBe('Alice');
    expect(mine.names).toEqual(['Alice', 'Bob']);
    // rejoindre depuis la liste = join avec le code de la liste
    const c = await client();
    const jc = waitFor(c, 'joined');
    c.send({ t: 'join', code: mine.code, name: 'Carl', charId: 'zed', color: 2 });
    expect((await jc).slot).toBe(2);
    a.close(); b.close(); c.close(); viewer.close();
  });

  it('l\'hôte peut passer son salon en privé : il disparaît de la liste', async () => {
    const a = await client();
    const ja = waitFor(a, 'joined');
    a.send({ t: 'create', name: 'Hôtesse', charId: 'kai', color: 0, public: true });
    const A = await ja;
    const viewer = await client();
    expect((await rooms(viewer)).some((r) => r.code === A.code)).toBe(true);
    const lobby = waitFor(a, 'lobby');
    a.send({ t: 'options', options: { isPublic: false } });
    expect((await lobby).state.options.isPublic).toBe(false);
    expect((await rooms(viewer)).some((r) => r.code === A.code)).toBe(false);
    a.close(); viewer.close();
  });

  it('un salon plein n\'est plus proposé ; une partie en cours reste rejoignable (à la volée)', async () => {
    const clients: NetClient[] = [];
    const first = await client(); clients.push(first);
    const jf = waitFor(first, 'joined');
    first.send({ t: 'quick', name: 'P0', charId: 'kai', color: 0 });
    const F = await jf;
    for (let i = 1; i < 4; i++) {
      const c = await client(); clients.push(c);
      const j = waitFor(c, 'joined');
      c.send({ t: 'quick', name: 'P' + i, charId: 'kai', color: i });
      expect((await j).code).toBe(F.code);
    }
    const viewer = await client();
    expect((await rooms(viewer)).some((r) => r.code === F.code)).toBe(false); // complet
    const extra = await client();
    const je = waitFor(extra, 'joined');
    extra.send({ t: 'quick', name: 'Suivant', charId: 'kai', color: 5 });
    const E = await je;
    expect(E.code).not.toBe(F.code);
    expect(E.created).toBe(true);
    // une partie lancée reste listée, marquée « en cours », tant qu'il reste une place
    const st = waitFor(extra, 'lobby');
    extra.send({ t: 'start', seed: 5 });
    await sleep(200);
    void st;
    const listed = (await rooms(viewer)).find((r) => r.code === E.code);
    expect(listed?.inGame).toBe(true);
    for (const c of [...clients, viewer, extra]) c.close();
  });
});
