import type { Area, Furniture, Rect } from './types.js';

const W = 1100, H = 760, T = 16, DOOR = 140;
const walls: Rect[] = [
  { x: 0, y: 0, width: T, height: H },
  { x: W - T, y: 0, width: T, height: H },
  { x: 0, y: H - T, width: W, height: T },
  { x: 0, y: 0, width: (W - DOOR) / 2, height: T },
  { x: (W + DOOR) / 2, y: 0, width: (W - DOOR) / 2, height: T },
];
const furniture: Furniture[] = [
  ...[120, 300, 480, 660].map((x): Furniture => ({ kind: 'shelf', x, y: 180, width: 110, height: 190 })),
  ...[120, 300, 480, 660].map((x): Furniture => ({ kind: 'shelf', x, y: 470, width: 110, height: 190 })),
  { kind: 'counter', x: 860, y: 200, width: 180, height: 60 },   // 装备商店台
  { kind: 'plant', x: 990, y: 640, width: 32, height: 32 },
];
export const storage: Area = {
  id: 'storage', name: '储物间', width: W, height: H,
  bounds: { x: T, y: T, width: W - T * 2, height: H - T * 2 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 550, y: 120 }, { x: 900, y: 400 }, { x: 550, y: 410 }],
  walls, furniture, obstacles: [...walls, ...furniture],
  exits: [{ rect: { x: W / 2 - 50, y: T, width: 100, height: 26 }, to: 'corridor', at: { x: 0, y: 0 }, label: '公共走廊' }],
};
