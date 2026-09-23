import type { Input } from '../game.js';
import type { Area, AreaId, Exit } from './types.js';
import { corridor } from './corridor.js';

export * from './types.js';
export { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, WALL_SIZE, DOOR_WIDTH, doorway, roomAt } from './corridor.js';

export const AREAS: Record<AreaId, Area> = { corridor };

export function canStandAt(area: Area, x: number, y: number) {
  const r = area.radius, b = area.bounds;
  if (x < b.x + r || x > b.x + b.width - r || y < b.y + r || y > b.y + b.height - r) return false;
  return !area.obstacles.some(rect => {
    const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
    return (x - closestX) ** 2 + (y - closestY) ** 2 < r * r;
  });
}

export function moveIn(area: Area, actor: { x: number; y: number; vy: number; face: number }, input: Pick<Input, 'left' | 'right' | 'up' | 'down'>, dt = 1 / 30) {
  const dx = Number(input.right) - Number(input.left), dy = Number(!!input.down) - Number(!!input.up);
  const length = Math.hypot(dx, dy);
  actor.vy = 0;
  if (!length) return;
  if (dx) actor.face = dx;
  // Substeps prevent tunnelling even if callers use a larger frame interval.
  const distance = area.speed * Math.min(Math.max(dt, 0), .15);
  const steps = Math.ceil(distance / (area.radius / 2));
  for (let i = 0; i < steps; i++) {
    const x = actor.x + dx / length * distance / steps;
    if (canStandAt(area, x, actor.y)) actor.x = x;
    const y = actor.y + dy / length * distance / steps;
    if (canStandAt(area, actor.x, y)) actor.y = y;
  }
}
