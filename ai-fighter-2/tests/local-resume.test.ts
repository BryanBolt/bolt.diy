import { describe, it, expect } from 'vitest';
import { Session } from '../src/net/session';
import { hashWorld } from '../src/sim/hash';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import { decodeRle } from '../shared/protocol';
import type { InputManager } from '../src/input/manager';

class FakeInput {
  tick = 0;
  bitsFor(slot: number): number {
    const t = this.tick;
    let b = 0;
    if ((t + slot * 11) % 50 < 20) b |= IN.RIGHT;
    if ((t * (slot + 2)) % 19 === 0) b |= IN.LIGHT;
    if ((t + slot) % 53 === 0) b |= IN.HEAVY | IN.RIGHT;
    if ((t + slot * 3) % 89 === 0) b |= IN.JUMP;
    if ((t + slot * 7) % 140 < 8) b |= IN.DOWN | (t % 3 === 0 ? IN.RIGHT : 0);
    return b;
  }
}

const config: SimConfig = { mode: 'campaign', difficulty: 1, rounds: 3, teams: false, stageIndex: 0,
  players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'zed', name: 'B', color: 1, team: 0 }], bots: [] };

describe('reprise d\'une partie locale', () => {
  it('rejouer le journal reconstruit exactement le même monde, puis la partie continue', () => {
    const input = new FakeInput();
    const s1 = new Session({ config, seed: 77, localSlots: [0, 1], allSlots: [0, 1], delay: 0, input: input as unknown as InputManager });
    let now = 0;
    for (let i = 0; i < 2500; i++) { now += 16.7; input.tick++; s1.update(now); }
    expect(s1.simFrame).toBeGreaterThan(2000);
    const h1 = hashWorld(s1.world);
    const frame = s1.simFrame;
    const lg = s1.exportLog();
    expect(lg.frames).toBe(frame);
    // le journal compressé est très petit par rapport à 2 × 2500 valeurs
    expect(JSON.stringify(lg.slots).length).toBeLessThan(40000);
    const log: Record<number, number[]> = {};
    for (const e of lg.slots) log[e.slot] = decodeRle(e.rle);
    const s2 = new Session({ config, seed: 77, localSlots: [0, 1], allSlots: [0, 1], delay: 0, input: input as unknown as InputManager, replay: { log, events: lg.events, pauseWhenDone: true } });
    expect(s2.catching).toBe(true);
    let guard = 0;
    while (s2.catching && guard++ < 1000) s2.update(now);
    expect(s2.simFrame).toBe(frame);
    expect(hashWorld(s2.world)).toBe(h1);
    expect(s2.world.paused).toBe(true);
    // la partie reprend normalement ensuite
    s2.world.paused = false;
    for (let i = 0; i < 300; i++) { now += 16.7; input.tick++; s2.update(now); }
    expect(s2.simFrame).toBeGreaterThan(frame + 200);
  });
});
