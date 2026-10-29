// Filtre de base pour les pseudos et le chat (français + anglais). Volontairement simple : normalise accents, chiffres-lettres, séparateurs.
const BAD = ['con', 'connard', 'connasse', 'salope', 'pute', 'putain', 'merde', 'encule', 'enculer', 'batard', 'nique', 'niquer', 'ntm', 'fdp', 'pd', 'tg', 'nazi', 'hitler', 'viol', 'violer', 'fuck', 'fucker', 'shit', 'bitch', 'cunt', 'dick', 'asshole', 'nigger', 'nigga', 'fag', 'faggot', 'retard', 'rape', 'rapist', 'whore', 'slut'];
const LONG = BAD.filter((w) => w.length >= 4);
const SHORT = new Set(BAD.filter((w) => w.length < 4));

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!|]/g, 'i').replace(/[0]/g, 'o').replace(/[5$]/g, 's').replace(/[^a-z ]/g, '');
}

/** Vrai si le texte contient un mot interdit (mots entiers courts, sous-chaînes longues). */
export function isProfane(text: string): boolean {
  const n = norm(text);
  const compact = n.replace(/ /g, '');
  if (LONG.some((w) => compact.includes(w))) return true;
  return n.split(' ').some((w) => SHORT.has(w));
}

/** Remplace le texte par des étoiles s'il est interdit. */
export function cleanText(text: string, fallback = '***'): string {
  return isProfane(text) ? fallback : text;
}
