/** One floor plan shared by rendering, collision and the minimap. Units are world pixels. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface OfficeRoom extends Rect {
  id: string; name: string; subtitle: string; color: number; door: 'top' | 'bottom';
}
export interface Furniture extends Rect { kind: 'desk' | 'table' | 'shelf' | 'counter' | 'sofa' | 'plant' }
export const OFFICE = { width: 1920, height: 1200, radius: 14, speed: 235, spawn: { x: 260, y: 600 } };
export const OFFICE_ROOMS: OfficeRoom[] = [
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
export const OFFICE_WALLS: Rect[] = OFFICE_ROOMS.flatMap(room => {
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
export const OFFICE_FURNITURE: Furniture[] = OFFICE_ROOMS.flatMap(room => {
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
export const OFFICE_OBSTACLES: Rect[] = [...OFFICE_WALLS, ...OFFICE_FURNITURE];
export function roomAt(x: number, y: number): OfficeRoom | undefined {
  return OFFICE_ROOMS.find(room => x > room.x && x < room.x + room.width && y > room.y && y < room.y + room.height);
}
export function canStandAt(x: number, y: number) {
  const r = OFFICE.radius;
  if (x < 48 + r || x > OFFICE.width - 48 - r || y < 64 + r || y > OFFICE.height - 64 - r) return false;
  return !OFFICE_OBSTACLES.some(rect => {
    const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
    return (x - closestX) ** 2 + (y - closestY) ** 2 < r * r;
  });
}
export function moveOffice(actor: { x: number; y: number; vy: number; face: number }, input: { left: boolean; right: boolean; up?: boolean; down?: boolean }, dt = 1 / 30) {
  const dx = Number(input.right) - Number(input.left), dy = Number(!!input.down) - Number(!!input.up);
  const length = Math.hypot(dx, dy);
  actor.vy = 0;
  if (!length) return;
  if (dx) actor.face = dx;
  // Substeps prevent tunnelling even if callers use a larger frame interval.
  const distance = OFFICE.speed * Math.min(Math.max(dt, 0), .15);
  const steps = Math.ceil(distance / (OFFICE.radius / 2));
  for (let i = 0; i < steps; i++) {
    const x = actor.x + dx / length * distance / steps;
    if (canStandAt(x, actor.y)) actor.x = x;
    const y = actor.y + dy / length * distance / steps;
    if (canStandAt(actor.x, y)) actor.y = y;
  }
}
