import type { Rect } from '../../shared/world/types';

export interface Solid extends Rect { lift: number; top: number; side: number }

/** Split one footprint into the three faces a 3/4 view needs. Collision never sees these. */
export function faces(solid: Solid) {
  const { x, y, width, height, lift } = solid;
  return {
    shadow: { x, y, width, height },
    side: { x, y: y + height - lift, width, height: lift },
    top: { x, y: y - lift, width, height },
  };
}

export function shade(color: number, amount: number) {
  const k = 1 - Math.min(Math.max(amount, 0), 1);
  const r = Math.round(((color >> 16) & 0xff) * k), g = Math.round(((color >> 8) & 0xff) * k), b = Math.round((color & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/** Painter's order: whatever sits lower on the floor is drawn in front. */
export const depthOf = (footprint: Rect) => footprint.y + footprint.height;
