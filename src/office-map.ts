import Phaser from 'phaser';
import { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, doorway, type Furniture } from '../shared/world';

/** Draw genuine overhead geometry, so zooming never stretches a side-view background. */
export function drawOffice(scene: Phaser.Scene) {
  const root = scene.add.container(0, 0);
  const g = scene.add.graphics(); root.add(g);
  const rect = (x: number, y: number, w: number, h: number, color: number) => { g.fillStyle(color).fillRect(x, y, w, h); };
  const text = (x: number, y: number, value: string, size: number, color: string, bold = false) => {
    const label = scene.add.text(x, y, value, { fontFamily: 'system-ui, sans-serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' }).setOrigin(.5);
    root.add(label); return label;
  };
  rect(42, 58, corridor.width - 72, corridor.height - 104, 0x0f1e24);
  rect(48, 64, corridor.width - 96, corridor.height - 128, 0xeee4cc);
  for (let x = 48; x < 1872; x += 48) rect(x, 64, 1, 1072, 0xded4bf);
  for (let y = 64; y < 1136; y += 48) rect(48, y, 1824, 1, 0xded4bf);
  rect(80, 552, 1760, 96, 0xc6cbb8);
  rect(88, 560, 1744, 80, 0xd9dec9);
  for (let x = 570; x < 1600; x += 310) text(x, 600, '›  ›  ›', 28, '#9da88e');
  text(960, 35, '摸 鱼 科 技   /   1 F', 22, '#a6b8ae');
  text(960, 1167, '一 层 平 面 图     ·     每 个 工 位，都 有 一 个 下 班 的 梦', 17, '#8a9c97');
  for (const room of CORRIDOR_ROOMS) {
    rect(room.x, room.y, room.width, room.height, room.color);
    for (let y = room.y + 20; y < room.y + room.height; y += 28) rect(room.x + 12, y, room.width - 24, 1, room.color - 0x090909);
    const titleY = room.y + (room.door === 'top' ? 76 : 55);
    text(room.x + room.width / 2, titleY, room.name, 28, '#334840', true);
    text(room.x + room.width / 2, titleY + 29, room.subtitle, 11, '#63756a');
    const door = doorway(room);
    rect(door.x - 56, door.y - 18, 112, 36, 0xe6c984);
    rect(door.x - 42, door.y - 2, 84, 4, 0xa78a51);
    text(door.x, door.y + (room.door === 'top' ? -32 : 35), room.door === 'top' ? '↓' : '↑', 21, '#6b805f');
  }
  for (const wall of corridor.walls) {
    rect(wall.x + 4, wall.y + 5, wall.width, wall.height, 0x8a998c);
    rect(wall.x, wall.y, wall.width, wall.height, 0x4f665d);
    rect(wall.x, wall.y, wall.width, Math.min(4, wall.height), 0x91a598);
  }
  for (const item of CORRIDOR_FURNITURE) drawFurniture(item);
  // Windows sit inside the outer walls; doors remain visibly open.
  for (const room of CORRIDOR_ROOMS.filter(r => r.door === 'bottom')) {
    for (const offset of [65, 345]) { rect(room.x + offset, room.y, 130, 12, 0x91c9cb); rect(room.x + offset + 63, room.y, 4, 12, 0xe0f3e9); }
  }
  text(1730, 598, '电梯  E →', 21, '#526747', true);
  text(170, 598, '接待区', 18, '#728164');

  function chair(x: number, y: number, horizontal = false) {
    rect(x - 3, y + 3, horizontal ? 28 : 34, horizontal ? 34 : 28, 0x8a998d);
    rect(x, y, horizontal ? 22 : 28, horizontal ? 28 : 22, 0x526d65);
    rect(x + 3, y + 3, horizontal ? 16 : 22, horizontal ? 22 : 16, 0x6e8d7f);
  }
  function drawFurniture({ x, y, width: w, height: h, kind }: Furniture) {
    if (kind === 'plant') {
      rect(x + 6, y + 6, w - 4, h - 4, 0x987354);
      g.fillStyle(0x436751).fillCircle(x + 14, y + 14, 19);
      g.fillStyle(0x628d60).fillCircle(x + 6, y + 8, 11).fillCircle(x + 22, y + 14, 10);
      g.fillStyle(0x91ad73).fillCircle(x + 12, y + 7, 7); return;
    }
    rect(x + 4, y + 5, w, h, 0x9da18c);
    rect(x, y, w, h, kind === 'sofa' ? 0x688576 : 0x977f61);
    rect(x + 4, y + 4, w - 8, h - 8, kind === 'sofa' ? 0x91ac96 : kind === 'counter' ? 0xe4dfcd : 0xe5c798);
    if (kind === 'desk') {
      chair(x + w / 2 - 14, y + h + 10);
      rect(x + 24, y + 7, 48, 8, 0x273e42); rect(x + 27, y + 8, 42, 3, 0x6ea0a0);
      rect(x + 44, y + 15, 8, 8, 0x506366);
      rect(x + 29, y + 31, 39, 13, 0xeee8d5);
      for (let i = 0; i < 6; i++) rect(x + 32 + i * 6, y + 34, 3, 2, 0x91a198);
      rect(x + 77, y + 30, 7, 11, 0xf8eed8);
      g.fillStyle(0x6f8a64).fillCircle(x + 12, y + 12, 6);
    } else if (kind === 'table') {
      for (let cy = y + 18; cy < y + h - 12; cy += 48) { chair(x - 36, cy, true); chair(x + w + 12, cy, true); }
      rect(x + w / 2 - 15, y + h / 2 - 18, 30, 35, 0xf4f0d9);
      rect(x + w / 2 - 10, y + h / 2 - 10, 19, 2, 0x94a4a0);
      g.fillStyle(0x688b65).fillCircle(x + w / 2 + 40, y + h / 2, 10);
    } else if (kind === 'shelf') {
      for (let row = 0; row < 3; row++) {
        rect(x + 8, y + 8 + row * 48, w - 16, 38, 0xbaa47b);
        rect(x + 14, y + 14 + row * 48, 25, 25, 0xdad6ba);
        rect(x + 44, y + 14 + row * 48, 29, 25, 0x879d8f);
        rect(x + 24, y + 20 + row * 48, 8, 4, 0x8c927e);
      }
    } else if (kind === 'sofa') {
      for (let sy = y + 12; sy < y + h - 20; sy += 50) rect(x + 12, sy, w - 24, 41, 0xa7bc9f);
    } else if (kind === 'counter' && h > w) {
      rect(x + 10, y + 20, 35, 45, 0x43595a); rect(x + 16, y + 24, 22, 20, 0x182e34);
      rect(x + 12, y + 100, 30, 50, 0x91a8a2); rect(x + 16, y + 104, 22, 40, 0xb6cbc2);
    } else if (kind === 'counter') {
      for (let cx = x + 12; cx < x + w - 20; cx += 43) rect(cx, y + 9, 26, h - 18, 0xb3b9a7);
    }
  }
  return root;
}

export function createOfficeAvatar(scene: Phaser.Scene) {
  const g = scene.make.graphics({ x: 0, y: 0 });
  g.fillStyle(0x263f3c).fillRect(8, 26, 6, 8).fillRect(19, 26, 6, 8);
  g.fillStyle(0xbce6cb).fillRoundedRect(3, 11, 28, 18, 7);
  g.fillStyle(0xe9bd8c).fillRect(1, 17, 5, 9).fillRect(28, 17, 5, 9);
  g.fillStyle(0x4b493e).fillCircle(17, 12, 11);
  g.fillStyle(0x68614b).fillCircle(15, 9, 8);
  g.fillStyle(0xdcb585).fillRect(24, 10, 4, 7);
  g.generateTexture('office-avatar', 34, 36); g.destroy();
}
