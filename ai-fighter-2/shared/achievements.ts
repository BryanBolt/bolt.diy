// Succès : débloqués automatiquement d'après les compteurs du profil.
export interface AchProfile { stageReached: number; campaignWins: number; duelWins: number; bestSurvival: number; bestScore: number; totalKo: number; streak: number; owned: string[] }
export interface Achievement { id: string; name: string; icon: string; desc: string; reward: number; test: (p: AchProfile) => boolean }

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'ko10', name: 'Premier sang', icon: '👊', desc: '10 K.O.', reward: 10, test: (p) => p.totalKo >= 10 },
  { id: 'ko100', name: 'Casseur', icon: '💥', desc: '100 K.O.', reward: 30, test: (p) => p.totalKo >= 100 },
  { id: 'ko500', name: 'Légende de la rue', icon: '🏆', desc: '500 K.O.', reward: 80, test: (p) => p.totalKo >= 500 },
  { id: 'st1', name: 'Dojo conquis', icon: '🥋', desc: 'Termine le 1er stage', reward: 15, test: (p) => p.stageReached >= 1 },
  { id: 'st4', name: 'À mi-chemin', icon: '🚇', desc: 'Termine 4 stages', reward: 40, test: (p) => p.stageReached >= 4 },
  { id: 'st7', name: 'Singularité vaincue', icon: '🤖', desc: 'Termine les 7 stages', reward: 120, test: (p) => p.stageReached >= 7 },
  { id: 'win1', name: 'Campagne gagnée', icon: '🎖️', desc: 'Gagne la campagne', reward: 60, test: (p) => p.campaignWins >= 1 },
  { id: 'duel1', name: 'Premier duel', icon: '⚔️', desc: 'Gagne un duel', reward: 10, test: (p) => p.duelWins >= 1 },
  { id: 'duel10', name: 'Champion d\'arène', icon: '🥇', desc: '10 victoires en duel', reward: 60, test: (p) => p.duelWins >= 10 },
  { id: 'surv5', name: 'Survivant', icon: '🧟', desc: 'Atteins la vague 5 en survie', reward: 20, test: (p) => p.bestSurvival >= 5 },
  { id: 'surv10', name: 'Increvable', icon: '☠️', desc: 'Atteins la vague 10 en survie', reward: 70, test: (p) => p.bestSurvival >= 10 },
  { id: 'score5k', name: 'Chasseur de score', icon: '⭐', desc: '5 000 points en une partie', reward: 25, test: (p) => p.bestScore >= 5000 },
  { id: 'streak3', name: 'Habitué', icon: '📅', desc: 'Défi du jour 3 jours de suite', reward: 40, test: (p) => p.streak >= 3 },
  { id: 'streak7', name: 'Assidu', icon: '🔥', desc: 'Défi du jour 7 jours de suite', reward: 120, test: (p) => p.streak >= 7 },
  { id: 'shop1', name: 'Dandy', icon: '🎩', desc: 'Achète un cosmétique', reward: 10, test: (p) => p.owned.length >= 1 },
];

export function newlyUnlocked(p: AchProfile, have: string[]): Achievement[] {
  return ACHIEVEMENTS.filter((a) => !have.includes(a.id) && a.test(p));
}
