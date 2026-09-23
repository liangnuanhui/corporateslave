import type { Input } from '../game.js';
import type { Area, AreaId, Exit } from './types.js';
import { corridor, CORRIDOR_ROOMS, doorway } from './corridor.js';
import { meeting } from './meeting.js';
import { storage } from './storage.js';

export * from './types.js';
export { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, WALL_SIZE, DOOR_WIDTH, doorway, roomAt } from './corridor.js';
export { meeting } from './meeting.js';
export { storage } from './storage.js';

/** Landing spots are resolved here to keep corridor.ts and the room files free of cycles.
 *  Each landing point sits 60px inside the door, clear of the opposite trigger. Uses each
 *  room's own bounds (T=16), not the corridor's WALL_SIZE (12) — the two are unrelated units. */
const ROOM_AREAS: Record<'meeting' | 'storage', Area> = { meeting, storage };
for (const exit of corridor.exits) {
  if (exit.locked) continue;
  const room = ROOM_AREAS[exit.to as 'meeting' | 'storage'];
  const b = room.bounds;
  exit.at = exit.to === 'meeting' ? { x: room.width / 2, y: b.y + b.height - 60 } : { x: room.width / 2, y: b.y + 60 };
}
for (const room of [meeting, storage]) {
  const slot = CORRIDOR_ROOMS.find(r => r.id === room.id)!;
  const door = doorway(slot);
  room.exits[0].at = { x: door.x, y: door.y + (slot.door === 'top' ? -60 : 60) };
}

export const AREAS: Record<AreaId, Area> = { corridor, meeting, storage };

export function exitAt(area: Area, x: number, y: number): Exit | undefined {
  return area.exits.find(e => x >= e.rect.x && x <= e.rect.x + e.rect.width && y >= e.rect.y && y <= e.rect.y + e.rect.height);
}

/** Map a room-local position onto the room's footprint in the corridor, for the overview and minimap. */
export function projectTo(area: Area, x: number, y: number) {
  if (area.id === 'corridor') return { x, y };
  const slot = CORRIDOR_ROOMS.find(r => r.id === area.id)!;
  return {
    x: slot.x + Math.min(Math.max(x, 0), area.width) / area.width * slot.width,
    y: slot.y + Math.min(Math.max(y, 0), area.height) / area.height * slot.height,
  };
}

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
