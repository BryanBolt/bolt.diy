import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { dailyOf, todayUtc, DAILY_MODS } from '../shared/daily';
import { createWorld } from '../src/sim/sim';
import type { SimConfig } from '../src/sim/types';

const PORT = 19200 + Math.floor(Math.random() * 80);
let server: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const base = `http://localhost:${PORT}`;

beforeAll(async () => {
  server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], { env: { ...process.env, PORT: String(PORT), DAILY_FILE: `/tmp/aif2-daily-test-${PORT}.jsonl` }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/health`); if (r.ok) return; } catch { /* pas prêt */ }
    await sleep(150);
  }
  throw new Error('serveur non démarré');
}, 20000);
afterAll(() => { server?.kill(); });

function cfg(modifier?: string): SimConfig {
  return { mode: 'survival', difficulty: 1, rounds: 1, teams: false, stageIndex: 0, modifier, players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }], bots: [] };
}

describe('défi du jour', () => {
  it('graine et modificateur stables pour une date', () => {
    expect(dailyOf('2026-10-24')).toEqual(dailyOf('2026-10-24'));
    expect(DAILY_MODS).toContain(dailyOf('2026-10-25').mod);
  });
  it('modificateur Verre : PV divisés, dégâts augmentés ; Sac à bonus : deux bonus', () => {
    const plain = createWorld(cfg(), 1).fighters[0];
    const glass = createWorld(cfg('glass'), 1).fighters[0];
    expect(glass.hpMax).toBe(Math.round(plain.hpMax / 2));
    expect(glass.stats.power).toBeGreaterThan(plain.stats.power * 1.6);
    expect(createWorld(cfg('boosted'), 1).fighters[0].bonuses.length).toBe(2);
  });
  it('classement : on garde le meilleur score, trié, refus des dates invalides', async () => {
    const date = todayUtc();
    const post = (b: object) => fetch(`${base}/api/daily`, { method: 'POST', body: JSON.stringify(b) });
    expect((await post({ date, name: 'Zoé', score: 500, wave: 3, charId: 'kai' })).status).toBe(200);
    await post({ date, name: 'Zoé', score: 300, wave: 2, charId: 'kai' });
    const r = await (await post({ date, name: 'Max', score: 900, wave: 5, charId: 'tora' })).json() as { rank: number };
    expect(r.rank).toBe(1);
    const top = (await (await fetch(`${base}/api/daily?date=${date}`)).json() as { top: { name: string; score: number }[] }).top;
    expect(top.map((t) => [t.name, t.score])).toEqual([['Max', 900], ['Zoé', 500]]);
    expect((await post({ date: '1999-01-01', name: 'X', score: 5, wave: 1 })).status).toBe(400);
    expect((await post({ date, name: 'X', score: -4, wave: 1 })).status).toBe(400);
  });
});
