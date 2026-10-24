import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Session } from '../src/net/session';
import { hashWorld } from '../src/sim/hash';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { decodeRle } from '../shared/protocol';
import { validReplay, type ReplayFile } from '../shared/replay';
import type { InputManager } from '../src/input/manager';

class FakeInput {
  tick = 0;
  bitsFor(slot: number): number {
    const t = this.tick;
    let b = 0;
    if ((t + slot * 11) % 50 < 20) b |= IN.RIGHT;
    if ((t * (slot + 2)) % 19 === 0) b |= IN.LIGHT;
    if ((t + slot) % 53 === 0) b |= IN.HEAVY | IN.RIGHT;
    return b;
  }
}
const config: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0,
  players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'zed', name: 'B', color: 1, team: 0 }], bots: [] };

function record(): { file: ReplayFile; hashAt: Map<number, number> } {
  const input = new FakeInput();
  const s = new Session({ config, seed: 5, localSlots: [0, 1], allSlots: [0, 1], delay: 0, input: input as unknown as InputManager });
  const hashAt = new Map<number, number>();
  let now = 0;
  for (let i = 0; i < 1500; i++) { now += 16.7; input.tick++; s.update(now); if (s.simFrame % 100 === 0) hashAt.set(s.simFrame, hashWorld(s.world)); }
  const lg = s.exportLog();
  return { file: { v: 1, title: 't', ts: 0, config, seed: 5, slots: lg.slots, events: lg.events, frames: lg.frames, hl: [{ f: 600, label: 'x' }] }, hashAt };
}

function viewer(file: ReplayFile, stopAt: number): Session {
  const log: Record<number, number[]> = {};
  for (const e of file.slots) log[e.slot] = decodeRle(e.rle);
  return new Session({ config, seed: 5, localSlots: [], allSlots: [0, 1], delay: 0, input: {} as InputManager, replay: { log, events: file.events, stopAt, viewOnly: true, frames: file.frames } });
}

describe('rediffusions', () => {
  it('la lecture reproduit la partie à l\'identique, le saut aussi, et la lecture s\'arrête à la fin', () => {
    const { file, hashAt } = record();
    expect(validReplay(file)).toBe(true);
    // saut direct à la frame 800 puis lecture jusqu'à 1000
    const v = viewer(file, 800);
    let now = 0, guard = 0;
    while (v.catching && guard++ < 500) v.update(now);
    expect(v.simFrame).toBe(800);
    expect(hashWorld(v.world)).toBe(hashAt.get(800));
    for (let i = 0; i < 400 && v.simFrame < 1000; i++) { now += 16.7; v.update(now); }
    expect(v.simFrame).toBe(1000);
    expect(hashWorld(v.world)).toBe(hashAt.get(1000));
    // depuis le début, la lecture va jusqu'à la dernière frame et s'arrête
    const w = viewer(file, 0);
    for (let i = 0; i < 3000; i++) { now += 16.7; w.update(now); }
    expect(w.simFrame).toBe(file.frames);
    expect(w.atEnd).toBe(true);
  });
});

describe('partage de rediffusion (serveur)', () => {
  const PORT = 19300 + Math.floor(Math.random() * 80);
  let server: ChildProcess;
  beforeAll(async () => {
    server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), REPLAYS_FILE: `/tmp/aif2-replays-test-${PORT}.jsonl` }, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) return; } catch { /* pas prêt */ } await new Promise((r) => setTimeout(r, 150)); }
    throw new Error('serveur non démarré');
  }, 20000);
  afterAll(() => { server?.kill(); });
  it('envoi puis relecture par identifiant, refus d\'un fichier invalide', async () => {
    const { file } = record();
    const r = await fetch(`http://localhost:${PORT}/api/replay`, { method: 'POST', body: JSON.stringify(file) });
    expect(r.status).toBe(200);
    const { id } = await r.json() as { id: string };
    const back = await (await fetch(`http://localhost:${PORT}/api/replay?id=${id}`)).json() as ReplayFile;
    expect(back.frames).toBe(file.frames);
    expect(back.seed).toBe(5);
    expect((await fetch(`http://localhost:${PORT}/api/replay`, { method: 'POST', body: '{"v":1}' })).status).toBe(400);
    expect((await fetch(`http://localhost:${PORT}/api/replay?id=NOPE`)).status).toBe(404);
  });
});
