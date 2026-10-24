// Transformations : ki à fond → le héros se transforme quelques secondes (stats, élément, aura).
export type Elem = 'none' | 'fire' | 'ice' | 'poison' | 'shock';
export interface FormDef { name: string; color: string; power: number; speed: number; defense: number; reach: number; elem: Elem }

export const FORM_FRAMES = 15 * 60;

export const FORMS: Record<string, FormDef> = {
  kai: { name: 'Éveil du dragon', color: '#ffd84a', power: 1.35, speed: 1.15, defense: 1, reach: 0, elem: 'none' },
  tora: { name: 'Mode Tigre', color: '#ff8a1c', power: 1.2, speed: 1, defense: 1.4, reach: 0, elem: 'none' },
  zed: { name: 'Ombre pure', color: '#7cff9a', power: 1.1, speed: 1.35, defense: 1, reach: 0, elem: 'poison' },
  vex: { name: 'Reine des tempêtes', color: '#ff6bd6', power: 1.2, speed: 1.1, defense: 1, reach: 24, elem: 'shock' },
  orion: { name: 'Astral', color: '#7da8ff', power: 1.25, speed: 1.1, defense: 1.1, reach: 10, elem: 'none' },
  blaze: { name: 'Phénix', color: '#ff5a2a', power: 1.25, speed: 1.1, defense: 1, reach: 0, elem: 'fire' },
  frost: { name: 'Zéro absolu', color: '#8fe8ff', power: 1.1, speed: 1.1, defense: 1.25, reach: 0, elem: 'ice' },
  shade: { name: 'Éclipse', color: '#b07cff', power: 1.15, speed: 1.25, defense: 1, reach: 0, elem: 'poison' },
  gorr: { name: 'Colosse', color: '#c98a4b', power: 1.5, speed: 0.92, defense: 1.3, reach: 0, elem: 'none' },
  nova: { name: 'Supernova', color: '#ffffff', power: 1.3, speed: 1.2, defense: 1, reach: 0, elem: 'shock' },
};

export function formOf(charId: string): FormDef | null {
  return FORMS[charId] ?? null;
}
