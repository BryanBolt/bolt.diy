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
    nums.push(f.id, f.x, f.y, f.z, f.vx, f.vy, f.hp, f.ki, f.superMeter, stateCode(f.state), f.controller === 'player' ? 1 : 0, f.weapon, f.stateFrame, f.facing, f.comboHits, f.team, f.freeze, f.invuln, f.form, f.kiCharge, f.holding, f.heldBy, f.carry.length);
  }
  for (const p of w.projectiles) nums.push(p.id, p.x, p.y, p.z, p.vx, p.life);
  for (const it of w.items) nums.push(it.id, it.x, it.y, it.life);
  for (const h of w.hazards) nums.push(h.id, h.x, h.timer, h.state.length);
  return hashNumbers(nums);
}
