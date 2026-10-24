// Défi du jour : même graine et même modificateur pour tout le monde, selon la date UTC.

export interface DailyMod { id: string; name: string; icon: string; desc: string }

export const DAILY_MODS: DailyMod[] = [
  { id: 'moon', name: 'Lune', icon: '🌙', desc: 'Gravité lunaire : sauts immenses, chutes lentes.' },
  { id: 'glass', name: 'Verre', icon: '🔮', desc: 'Moitié moins de PV, mais +70 % de dégâts.' },
  { id: 'swarm', name: 'Nuée', icon: '🐝', desc: 'Trois ennemis de plus à chaque vague.' },
  { id: 'boosted', name: 'Sac à bonus', icon: '🎁', desc: 'Tu démarres avec deux bonus tirés au sort.' },
];

export function todayUtc(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isDateString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function dailyOf(date: string): { date: string; seed: number; mod: DailyMod } {
  const seed = hashStr('aif2-' + date) || 1;
  return { date, seed, mod: DAILY_MODS[seed % DAILY_MODS.length] };
}

export interface DailyEntry { name: string; score: number; wave: number; charId: string; ts: number }
