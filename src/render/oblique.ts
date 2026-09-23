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

/**
 * Where a wall sits in its area decides how it is drawn.
 * `back` — a horizontal wall on the north edge. Lifting it upward puts its face outside the
 *   framed area, so it is drawn as seen from inside, its face falling into the room.
 * `front` — a horizontal wall on the south edge. The whole south edge is walkable, so a full
 *   lift would draw over any character walking along it; it stays a low ledge.
 * `side` — everything else, including a vertical wall that happens to touch y = 0.
 */
export function wallRole(wall: Rect, areaHeight: number): 'back' | 'front' | 'side' {
  if (wall.width <= wall.height) return 'side';
  if (wall.y <= 0) return 'back';
  return wall.y + wall.height >= areaHeight ? 'front' : 'side';
}

/** The widest stretch of back wall — where a room's name is painted. Equal widths take the last,
 *  which keeps the sign away from the HUD in the top-left corner. */
export function signWall(walls: Rect[], areaHeight: number) {
  return walls.filter(w => wallRole(w, areaHeight) === 'back')
    .reduce<Rect | undefined>((best, w) => !best || w.width >= best.width ? w : best, undefined);
}
