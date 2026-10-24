import { VIEW_W, VIEW_H, Z_MIN, Z_MAX } from '../sim/constants';

export const FLOOR_TOP = 318; // y écran de la ligne du fond
export const FLOOR_BOTTOM = 528; // y écran du bord avant

/** Projection monde -> écran (coordonnées virtuelles 960x540). */
export interface Camera {
  x: number; // scroll
  zoom: number;
  cx: number; // centre de zoom (écran)
  cy: number;
  shakeX: number;
  shakeY: number;
}

export function groundY(z: number): number {
  return FLOOR_TOP + ((z - Z_MIN) / (Z_MAX - Z_MIN)) * (FLOOR_BOTTOM - FLOOR_TOP);
}

export function depthScale(z: number): number {
  return 0.86 + ((z - Z_MIN) / (Z_MAX - Z_MIN)) * 0.26;
}

export function project(cam: Camera, x: number, y: number, z: number): { sx: number; sy: number; s: number } {
  const s = depthScale(z);
  const sx = x - cam.x + cam.shakeX;
  const sy = groundY(z) - y * s + cam.shakeY;
  return { sx, sy, s };
}

export function applyCamera(ctx: CanvasRenderingContext2D, cam: Camera): void {
  ctx.translate(cam.cx, cam.cy);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-cam.cx, -cam.cy);
}

/** Taille visible en coordonnées virtuelles (≥ 960×540 : l'écran est rempli, le décor s'étend). */
export const view = { w: VIEW_W, h: VIEW_H };

export { VIEW_W, VIEW_H };
