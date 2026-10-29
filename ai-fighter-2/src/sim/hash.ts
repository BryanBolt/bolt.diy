import { hashNumbers } from '../core/math';
import type { World } from './types';

const STATE_CODE: Record<string, number> = {};
let codeCounter = 1;
function stateCode(s: string): number {
  if (!STATE_CODE[s]) STATE_CODE[s] = codeCounter++;
  return STATE_CODE[s];
}

/** Empreinte 32 bits de l'état simulé : identique sur toutes les machines si aucune désynchronisation. */
export function hashWorld(w: World): number {
  const nums: number[] = [w.frame, w.rng, w.phase.length, w.waveIndex, w.score, w.coins, w.arenaL, w.round, w.roundTimer];
  for (const f of w.fighters) {
    nums.push(f.id, f.x, f.y, f.z, f.vx, f.vy, f.hp, f.ki, f.superMeter, stateCode(f.state), f.controller === 'player' ? 1 : 0, f.weapon, f.stateFrame, f.facing, f.comboHits, f.team, f.freeze, f.invuln, f.form, f.kiCharge, f.holding, f.heldBy, f.holdMode, f.carry.length, f.affix.length, f.perfect);
  }
  for (const p of w.projectiles) nums.push(p.id, p.x, p.y, p.z, p.vx, p.life);
  for (const it of w.items) nums.push(it.id, it.x, it.y, it.life);
  for (const h of w.hazards) nums.push(h.id, h.x, h.timer, h.state.length);
  nums.push(w.reinforced ? 1 : 0, w.bossCd, w.bossWeak, w.chestBonus, w.challenge ? 1 : 0);
  if (w.chest) nums.push(w.chest.x, w.chest.tier, w.chest.opening, w.chest.wait);
  if (w.rooms) for (const c of w.rooms.cursors) nums.push(c.slot, c.cursor);
  if (w.mini) for (const m of w.mini.players) nums.push(m.n, m.round, m.results.length);
  for (const zn of w.zones) nums.push(zn.id, zn.x, zn.z, zn.t);
  for (const x of w.fixtures) nums.push(x.id, x.used ? 1 : 0, x.cd);
  return hashNumbers(nums);
}
