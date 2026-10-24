// Cosmétiques : chapeaux et auras/traînées débloqués par la progression. Purement visuels (hors simulation).

export interface Progress { stageReached: number; campaignWins: number; duelWins: number; bestSurvival: number; totalKo: number }

export interface Cosmetic {
  id: string;
  name: string;
  icon: string;
  hint: string; // comment le débloquer
  need?: (p: Progress) => boolean;
}

export const HATS: Cosmetic[] = [
  { id: '', name: 'Aucun', icon: '—', hint: '' },
  { id: 'cap', name: 'Casquette', icon: '🧢', hint: 'Toujours disponible' },
  { id: 'tophat', name: 'Haut-de-forme', icon: '🎩', hint: 'Gagne la campagne une fois', need: (p) => p.campaignWins >= 1 },
  { id: 'party', name: 'Chapeau de fête', icon: '🥳', hint: '50 K.O. au total', need: (p) => p.totalKo >= 50 },
  { id: 'halo', name: 'Auréole', icon: '😇', hint: '5 victoires en duel', need: (p) => p.duelWins >= 5 },
  { id: 'wizard', name: 'Chapeau de mage', icon: '🧙', hint: 'Survie : atteins la vague 8', need: (p) => p.bestSurvival >= 8 },
  { id: 'viking', name: 'Casque viking', icon: '🪓', hint: '200 K.O. au total', need: (p) => p.totalKo >= 200 },
  { id: 'crown', name: 'Couronne', icon: '👑', hint: 'Termine les 7 stages', need: (p) => p.stageReached >= 7 },
];

export const AURAS: Cosmetic[] = [
  { id: '', name: 'Aucune', icon: '—', hint: '' },
  { id: 'sparks', name: 'Étincelles', icon: '✨', hint: 'Termine le 1er stage', need: (p) => p.stageReached >= 1 },
  { id: 'fire', name: 'Flammes', icon: '🔥', hint: 'Gagne la campagne une fois', need: (p) => p.campaignWins >= 1 },
  { id: 'frost', name: 'Givre', icon: '❄️', hint: 'Termine 4 stages', need: (p) => p.stageReached >= 4 },
  { id: 'shadow', name: 'Ombre', icon: '🌑', hint: '3 victoires en duel', need: (p) => p.duelWins >= 3 },
  { id: 'rainbow', name: 'Arc-en-ciel', icon: '🌈', hint: 'Survie : atteins la vague 10', need: (p) => p.bestSurvival >= 10 },
  { id: 'gold', name: 'Or', icon: '🪙', hint: '300 K.O. au total', need: (p) => p.totalKo >= 300 },
];

export function unlocked(c: Cosmetic, p: Progress): boolean {
  return !c.need || c.need(p);
}

export function validHat(id: unknown): string {
  const s = String(id ?? '');
  return HATS.some((h) => h.id === s) ? s : '';
}
export function validAura(id: unknown): string {
  const s = String(id ?? '');
  return AURAS.some((h) => h.id === s) ? s : '';
}

/** Cosmétique suivant (dir = ±1) parmi ceux déjà débloqués. */
export function cycleCosmetic(list: Cosmetic[], cur: string, dir: number, p: Progress): string {
  const ok = list.filter((c) => unlocked(c, p));
  const i = Math.max(0, ok.findIndex((c) => c.id === cur));
  return ok[(i + dir + ok.length) % ok.length].id;
}
