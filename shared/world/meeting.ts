import type { Area, Furniture, Rect } from './types.js';

const W = 1100, H = 760, T = 16, DOOR = 140;
const walls: Rect[] = [
  { x: 0, y: 0, width: T, height: H },
  { x: W - T, y: 0, width: T, height: H },
  { x: 0, y: 0, width: W, height: T },
  { x: 0, y: H - T, width: (W - DOOR) / 2, height: T },
  { x: (W + DOOR) / 2, y: H - T, width: (W - DOOR) / 2, height: T },
];
const furniture: Furniture[] = [
  { kind: 'table', x: 330, y: 250, width: 440, height: 260 },   // 长桌
  { kind: 'counter', x: 340, y: 90, width: 420, height: 40 },   // 投影幕下的台面
  { kind: 'plant', x: 990, y: 60, width: 32, height: 32 },
  { kind: 'plant', x: 60, y: 60, width: 32, height: 32 },
  { kind: 'sofa', x: 60, y: 300, width: 60, height: 200 },
];
export const meeting: Area = {
  id: 'meeting', name: '大会议室', width: W, height: H,
  bounds: { x: T, y: T, width: W - T * 2, height: H - T * 2 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 250, y: 620 }, { x: 850, y: 620 }, { x: 550, y: 640 }],
  walls, furniture, obstacles: [...walls, ...furniture],
  exits: [{ rect: { x: W / 2 - 50, y: H - T - 26, width: 100, height: 26 }, to: 'corridor', at: { x: 0, y: 0 }, label: '公共走廊' }],
};
