import { describe, it, expect } from 'vitest';
import { Session } from '../src/net/session';
import { hashWorld } from '../src/sim/hash';
import { IN } from '../src/sim/types';
import type { SimConfig } from '../src/sim/types';
import type { ClientMsg, ServerMsg } from '../shared/protocol';
import type { NetClient } from '../src/net/client';
import type { InputManager } from '../src/input/manager';

// Faux réseau : deux clients reliés par un relais en mémoire avec latence simulée.
class FakeNet {
  handlers = new Map<string, ((m: ServerMsg) => void)[]>();
  outbox: ClientMsg[] = [];
  rtt = 0;
  connectedFlag = true;
  onClose = null;
  send(m: ClientMsg): void { this.outbox.push(m); }
  on(type: string, h: (m: ServerMsg) => void): () => void {
    const l = this.handlers.get(type) ?? [];
    l.push(h);
    this.handlers.set(type, l);
    return () => {};
  }
  deliver(m: ServerMsg): void { for (const h of this.handlers.get(m.t) ?? []) h(m); }
  ping(): void {}
  close(): void {}
}

class FakeInput {
  bits = new Map<number, number>();
  bitsFor(slot: number): number { return this.bits.get(slot) ?? 0; }
}

function cfg(): SimConfig {
  return { mode: 'duel', difficulty: 1, rounds: 1, teams: false, stageIndex: 0,
    players: [{ slot: 0, charId: 'kai', name: 'A', color: 0, team: 0 }, { slot: 1, charId: 'tora', name: 'B', color: 1, team: 1 }], bots: [] };
}

describe('lockstep', () => {
  it('deux clients restent synchronisés malgré la latence', () => {
    const netA = new FakeNet();
    const netB = new FakeNet();
    const inA = new FakeInput();
    const inB = new FakeInput();
    const delay = 3;
    const a = new Session({ config: cfg(), seed: 123, localSlots: [0], allSlots: [0, 1], delay, input: inA as unknown as InputManager, net: netA as unknown as NetClient });
    const b = new Session({ config: cfg(), seed: 123, localSlots: [1], allSlots: [0, 1], delay, input: inB as unknown as InputManager, net: netB as unknown as NetClient });
    // file de messages en transit : [frame de livraison, destinataire, message]
    const inflight: { at: number; to: FakeNet; msg: ServerMsg }[] = [];
    let t = 0;
    const latencyFrames = 2;
    for (let tick = 0; tick < 1200; tick++) {
      t += 1000 / 60;
      // entrées pseudo-aléatoires
      inA.bits.set(0, tick % 7 < 3 ? IN.RIGHT | (tick % 13 === 0 ? IN.LIGHT : 0) : tick % 29 === 0 ? IN.HEAVY : 0);
      inB.bits.set(1, tick % 5 < 2 ? IN.LEFT | (tick % 11 === 0 ? IN.LIGHT : 0) : tick % 31 === 0 ? IN.GUARD : 0);
      // B est en retard d'un tick de temps en temps (jitter)
      a.update(t);
      if (tick % 10 !== 0) b.update(t);
      // relais
      for (const m of netA.outbox.splice(0)) if (m.t === 'input') inflight.push({ at: tick + latencyFrames, to: netB, msg: { t: 'input', slot: 0, f: m.f, bits: m.bits } });
      for (const m of netB.outbox.splice(0)) if (m.t === 'input') inflight.push({ at: tick + latencyFrames, to: netA, msg: { t: 'input', slot: 1, f: m.f, bits: m.bits } });
      for (const p of inflight.filter((x) => x.at <= tick)) p.to.deliver(p.msg);
      for (let i = inflight.length - 1; i >= 0; i--) if (inflight[i].at <= tick) inflight.splice(i, 1);
    }
    // laisser B rattraper
    for (let k = 0; k < 60; k++) { t += 1000 / 60; b.update(t); a.update(t); for (const m of netA.outbox.splice(0)) if (m.t === 'input') netB.deliver({ t: 'input', slot: 0, f: m.f, bits: m.bits }); for (const m of netB.outbox.splice(0)) if (m.t === 'input') netA.deliver({ t: 'input', slot: 1, f: m.f, bits: m.bits }); }
    const common = Math.min(a.simFrame, b.simFrame);
    expect(common).toBeGreaterThan(900);
    // on rejoue les deux mondes jusqu'à la même frame : hash identique
    while (a.simFrame < b.simFrame) { t += 1000 / 60; a.update(t); }
    while (b.simFrame < a.simFrame) { t += 1000 / 60; b.update(t); }
    expect(a.simFrame).toBe(b.simFrame);
    expect(hashWorld(a.world)).toBe(hashWorld(b.world));
    expect(a.world.frame).toBeGreaterThan(300);
  });

  it('un joueur qui quitte passe sous contrôle IA au même moment pour tout le monde', () => {
    const netA = new FakeNet();
    const inA = new FakeInput();
    const a = new Session({ config: cfg(), seed: 9, localSlots: [0], allSlots: [0, 1], delay: 2, input: inA as unknown as InputManager, net: netA as unknown as NetClient });
    let t = 0;
    // le joueur 1 n'envoie rien : A doit bloquer après le délai
    for (let i = 0; i < 20; i++) { t += 1000 / 60; a.update(t); }
    expect(a.simFrame).toBe(2);
    expect(a.waitingSlots).toEqual([1]);
    netA.deliver({ t: 'drop', slot: 1, from: 2 });
    for (let i = 0; i < 20; i++) { t += 1000 / 60; a.update(t); }
    expect(a.simFrame).toBeGreaterThan(10);
    expect(a.world.fighters[1].controller).toBe('ai');
  });
});
