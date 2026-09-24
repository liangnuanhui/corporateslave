import type { Input } from '../game.js';
import type { Area, AreaId, Exit, Furniture } from './types.js';
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

/** How far above their own centre a character's head reaches: their 36px texture is drawn 40px
 *  tall (x1.111) and its first opaque row is texture y=1, so 20 - 1.111 = 18.9, and a character
 *  stopped one radius (14) north of a solid tops out 32.9px above that solid's edge. */
export const HEAD_TOP = 32.9;
/** A character standing due north of a solid shows `HEAD_TOP - lift` pixels of head, so no solid
 *  may lift more than this without erasing them — past 33 they vanish outright. Restoring taller
 *  furniture needs the solid to fade or outline when it occludes the local player: a feature,
 *  not a constant. Raise this only along with that feature. */
export const MAX_LIFT = 26;

/** Render heights live here so the three area files stay pure footprints. Nothing exceeds the
 *  cap; a desk is the only thing low enough to sit under it. */
const LIFT: Record<Furniture['kind'], number> = { desk: 22, table: MAX_LIFT, shelf: MAX_LIFT, counter: MAX_LIFT, sofa: MAX_LIFT, plant: MAX_LIFT };
for (const area of Object.values(AREAS)) for (const item of area.furniture) item.lift ??= LIFT[item.kind];

/** Walls and chairs are drawn from the renderer rather than carried on the area data, so their
 *  heights live here too. The cap has to cover everything that is lifted, not just furniture:
 *  walls sat at 46 for four fix rounds and escaped the check entirely, because the assertion
 *  iterated `area.furniture` and a wall is not a Furniture. A character walking the north strip
 *  was drawn completely behind them across 98% of the floor's width. */
export const WALL_LIFT = MAX_LIFT;
/** The whole south edge of a room is walkable, so a full-height south wall would draw over any
 *  character walking along it. It stays a low ledge that only clips their feet. */
export const FRONT_WALL_LIFT = 12;
export const CHAIR_LIFT = 18;
/** Every height the renderer lifts something by, so one assertion can cover all of them. */
export const ALL_LIFTS: Record<string, number> = { ...LIFT, wall: WALL_LIFT, frontWall: FRONT_WALL_LIFT, chair: CHAIR_LIFT };

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

/** A standable spot right beside a desk-like piece of furniture — where someone at work stands.
 *  Returns undefined when the area has no such furniture (储物间 is all shelves), so the caller
 *  can fall back rather than pretending there is a 工位 in a store room. */
export function spotAtDesk(area: Area, random: () => number = Math.random) {
  const desks = area.furniture.filter(f => f.kind === 'desk' || f.kind === 'table' || f.kind === 'counter');
  if (!desks.length) return undefined;
  const gap = area.radius + 8;
  // 从随机一张桌子开始，绕一圈全试过再放弃。走廊里有些桌子四面都靠着封闭房间的外框，
  // 一张都够不到；只看随机挑中的那一张，就会在「明明有工位」的房间里返回 undefined。
  const start = Math.floor(random() * desks.length);
  for (let i = 0; i < desks.length; i++) {
    const d = desks[(start + i) % desks.length];
    const sides = [
      { x: d.x + d.width / 2, y: d.y + d.height + gap },
      { x: d.x + d.width / 2, y: d.y - gap },
      { x: d.x - gap, y: d.y + d.height / 2 },
      { x: d.x + d.width + gap, y: d.y + d.height / 2 },
    ];
    const spot = sides.find(c => canStandAt(area, c.x, c.y) && !exitAt(area, c.x, c.y));
    if (spot) return spot;
  }
  return undefined;
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

/** A random standable spot in an area, clear of the door triggers.
 *
 *  Rejection sampling rather than a hand-picked list: the point is that the target turns up
 *  somewhere different every time, and a list would quietly stop covering the floor the moment
 *  someone moves a desk. The spawn points are the fallback so that a furniture edit which fills
 *  a room can never hand a caller nothing — it just makes the placement less varied, loudly
 *  enough to notice in play, instead of throwing in the middle of a tick.
 */
export function randomStandablePoint(area: Area, random: () => number = Math.random) {
  const b = area.bounds, r = area.radius;
  for (let i = 0; i < 200; i++) {
    const x = b.x + r + random() * (b.width - r * 2);
    const y = b.y + r + random() * (b.height - r * 2);
    if (canStandAt(area, x, y) && !exitAt(area, x, y)) return { x, y };
  }
  const fallback = area.spawnPoints[Math.min(area.spawnPoints.length - 1, Math.floor(random() * area.spawnPoints.length))];
  return { x: fallback.x, y: fallback.y };
}

export function moveIn(area: Area, actor: { x: number; y: number; vy: number; face: number }, input: Pick<Input, 'left' | 'right' | 'up' | 'down'>, dt = 1 / 30, speed = area.speed) {
  const dx = Number(input.right) - Number(input.left), dy = Number(!!input.down) - Number(!!input.up);
  const length = Math.hypot(dx, dy);
  actor.vy = 0;
  if (!length) return;
  if (dx) actor.face = dx;
  // Substeps prevent tunnelling even if callers use a larger frame interval.
  const distance = speed * Math.min(Math.max(dt, 0), .15);
  const steps = Math.ceil(distance / (area.radius / 2));
  for (let i = 0; i < steps; i++) {
    const x = actor.x + dx / length * distance / steps;
    if (canStandAt(area, x, actor.y)) actor.x = x;
    const y = actor.y + dy / length * distance / steps;
    if (canStandAt(area, actor.x, y)) actor.y = y;
  }
}
