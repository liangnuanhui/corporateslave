import type { Area, AreaId, Exit, Furniture, Rect } from './types.js';

export interface OfficeRoom extends Rect { id: string; name: string; subtitle: string; color: number; door: 'top' | 'bottom' }
export const CORRIDOR_ROOMS: OfficeRoom[] = [
  { id: 'office-1', name: '办公室 1', subtitle: 'PRODUCT & DESIGN', x: 80, y: 100, width: 540, height: 420, color: 0xced8c0, door: 'bottom' },
  { id: 'meeting', name: '大会议室', subtitle: 'MEETING ROOM', x: 690, y: 100, width: 540, height: 420, color: 0xc8d8da, door: 'bottom' },
  { id: 'office-2', name: '办公室 2', subtitle: 'ENGINEERING', x: 1300, y: 100, width: 540, height: 420, color: 0xd8d0be, door: 'bottom' },
  { id: 'storage', name: '储物间', subtitle: 'STORAGE', x: 80, y: 680, width: 540, height: 420, color: 0xcac6b9, door: 'top' },
  { id: 'lounge', name: '休息区', subtitle: 'TAKE A BREAK', x: 690, y: 680, width: 540, height: 420, color: 0xd9c8b9, door: 'top' },
  { id: 'pantry', name: '茶水间', subtitle: 'COFFEE & TEA', x: 1300, y: 680, width: 540, height: 420, color: 0xc3d3c2, door: 'top' },
];
export const WALL_SIZE = 12;
export const DOOR_WIDTH = 112;
export function doorway(room: OfficeRoom) {
  return { x: room.x + room.width / 2, y: room.door === 'top' ? room.y : room.y + room.height };
}
export const CORRIDOR_WALLS: Rect[] = CORRIDOR_ROOMS.flatMap(room => {
  const { x, y, width, height } = room, t = WALL_SIZE;
  const doorY = room.door === 'top' ? y : y + height - t;
  const closedY = room.door === 'top' ? y + height - t : y;
  const segment = (width - DOOR_WIDTH) / 2;
  return [
    { x, y, width: t, height }, { x: x + width - t, y, width: t, height },
    { x, y: closedY, width, height: t },
    { x, y: doorY, width: segment, height: t },
    { x: x + width - segment, y: doorY, width: segment, height: t },
  ];
});
export const CORRIDOR_FURNITURE: Furniture[] = CORRIDOR_ROOMS.flatMap(room => {
  const items: Furniture[] = [];
  const add = (kind: Furniture['kind'], x: number, y: number, width: number, height: number) => items.push({ kind, x: room.x + x, y: room.y + y, width, height });
  if (room.id.startsWith('office')) {
    for (const x of [58, 222, 386]) for (const y of [120, 260]) add('desk', x, y, 96, 56);
  } else if (room.id === 'meeting') {
    add('table', 155, 150, 230, 140);
    add('counter', 165, 105, 210, 28);
  } else if (room.id === 'storage') {
    for (const x of [50, 220, 390]) add('shelf', x, 140, 90, 150);
    add('counter', 45, 345, 170, 35);
  } else if (room.id === 'lounge') {
    add('sofa', 65, 145, 60, 170); add('sofa', 415, 145, 60, 170);
    add('table', 205, 210, 130, 85);
  } else {
    add('counter', 48, 125, 55, 235); add('counter', 145, 330, 270, 45);
    add('table', 245, 145, 110, 90);
  }
  add('plant', 455, 48, 32, 32);
  return items;
});
export function roomAt(x: number, y: number): OfficeRoom | undefined {
  return CORRIDOR_ROOMS.find(room => x > room.x && x < room.x + room.width && y > room.y && y < room.y + room.height);
}
/** Room interiors live in their own areas now, so the corridor footprint is unreachable.
 *  The four walls already seal it; this is a guard against the door gap (only WALL_SIZE
 *  deep, not the wider CLEARANCE below) letting a player's disc nose into the old floor. */
const CLEARANCE = 14;   // matches corridor.radius — a disc this size must clear the interior everywhere the door gap has no wall
const ROOM_INTERIORS: Rect[] = CORRIDOR_ROOMS.map(room => ({
  x: room.x + CLEARANCE, y: room.y + CLEARANCE,
  width: room.width - CLEARANCE * 2, height: room.height - CLEARANCE * 2,
}));
const OPEN: Record<string, AreaId> = { meeting: 'meeting', storage: 'storage' };
export const CORRIDOR_EXITS: Exit[] = CORRIDOR_ROOMS.map(room => {
  const door = doorway(room), open = OPEN[room.id];
  // Trigger sits on the corridor side of the wall line, where the player is stopped.
  const y = room.door === 'top' ? door.y - 26 : door.y;
  return {
    rect: { x: door.x - 40, y, width: 80, height: 26 },
    to: (open ?? 'corridor') as AreaId,
    at: { x: 0, y: 0 },          // index.ts 回填
    label: room.name,
    locked: open ? undefined : true,
  };
});
export const corridor: Area = {
  id: 'corridor', name: '公共走廊', width: 1920, height: 1200,
  bounds: { x: 48, y: 64, width: 1824, height: 1072 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 260, y: 600 }, { x: 420, y: 600 }, { x: 1560, y: 600 }],
  walls: CORRIDOR_WALLS, furniture: CORRIDOR_FURNITURE,
  obstacles: [...CORRIDOR_WALLS, ...CORRIDOR_FURNITURE, ...ROOM_INTERIORS],
  exits: CORRIDOR_EXITS,
};
