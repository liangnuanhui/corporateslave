import Phaser from 'phaser';
import { CHAIR_LIFT, CORRIDOR_ROOMS, FRONT_WALL_LIFT, WALL_LIFT, WALL_SIZE, doorway, type Area, type Furniture, type Rect } from '../../shared/world';
import { depthOf, faces, shade, signWall, wallRole, type Solid } from './oblique';
import { TEXT_RASTER } from './dpr';

/** Above every solid, below the name plates at 10000 — for labels a character can never reach. */
const SIGN_DEPTH = 9000;
const WALL_TOP = 0x7b9084;
const TOP: Record<Furniture['kind'], number> = { desk: 0x9d845f, table: 0x9d845f, shelf: 0xa8946c, counter: 0x9c9077, sofa: 0x6f8d7d, plant: 0x9a7455 };

/** Draw one area in 3/4 oblique. Collision never sees any of this — footprints stay flat. */
export function drawArea(scene: Phaser.Scene, area: Area, siteName: string) {
  const root = scene.add.container(0, 0);
  const floor = scene.add.graphics(); root.add(floor);
  // Phaser only depth-sorts siblings and the characters live on the scene list, so every raised
  // box does too. The container owns their lifetime, not their ordering.
  const raised: Phaser.GameObjects.GameObject[] = [];
  root.once('destroy', () => { for (const item of raised) item.destroy(); });

  const rect = (x: number, y: number, w: number, h: number, color: number) => { floor.fillStyle(color).fillRect(x, y, w, h); };
  const text = (x: number, y: number, value: string, size: number, color: string, bold = false, depth?: number) => {
    const label = scene.add.text(x, y, value, { fontFamily: 'system-ui, sans-serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal', resolution: TEXT_RASTER }).setOrigin(.5);
    label.texture.setFilter(Phaser.Textures.FilterMode.LINEAR);
    if (depth === undefined) root.add(label); else { label.setDepth(depth); raised.push(label); }
    return label;
  };

  type Detail = (g: Phaser.GameObjects.Graphics, top: Rect, side: Rect) => void;
  /** One Graphics per box, at its own footprint depth, so a character can sort between them. */
  function box(footprint: Rect, lift: number, color: number, detail?: Detail) {
    const g = scene.add.graphics().setDepth(depthOf(footprint));
    const solid: Solid = { ...footprint, lift, top: color, side: shade(color, .3) };
    const { shadow, side, top } = faces(solid);
    g.fillStyle(shade(color, .55), .25).fillRect(shadow.x + 7, shadow.y + 7, shadow.width, shadow.height);
    // The side runs 1px under the top face: exactly abutting fills tear at max zoom.
    g.fillStyle(solid.side).fillRect(side.x, side.y - 1, side.width, side.height + 1);
    g.fillStyle(color).fillRect(top.x, top.y, top.width, top.height);
    g.fillStyle(shade(color, .14)).fillRect(top.x, top.y + top.height - 2, top.width, 2);
    detail?.(g, top, side);
    raised.push(g);
    return g;
  }

  /** A wall on the north edge is seen from inside: its face falls into the room, where the
   *  camera can show it, instead of above the stage where the area frame would clip it away. */
  function backWall(wall: Rect) {
    const g = scene.add.graphics().setDepth(depthOf(wall));
    g.fillStyle(shade(WALL_TOP, .3)).fillRect(wall.x, wall.y + wall.height - 1, wall.width, WALL_LIFT + 1);
    g.fillStyle(WALL_TOP).fillRect(wall.x, wall.y, wall.width, wall.height);
    g.fillStyle(shade(WALL_TOP, .55), .25).fillRect(wall.x, wall.y + wall.height + WALL_LIFT, wall.width, 7);
    raised.push(g);
  }

  function drawWall(wall: Rect) {
    const role = wallRole(wall, area.height);
    if (role === 'back') return backWall(wall);
    box(wall, role === 'front' ? FRONT_WALL_LIFT : WALL_LIFT, WALL_TOP);
  }

  function chair(x: number, y: number, horizontal = false) {
    const w = horizontal ? 28 : 34, h = horizontal ? 34 : 28;
    box({ x, y, width: w, height: h }, CHAIR_LIFT, 0x5d7a70, (g, top) => { g.fillStyle(0x82a394).fillRect(top.x + 4, top.y + 4, w - 8, h - 8); });
  }

  function drawFurniture(item: Furniture) {
    const { x, y, width: w, height: h, kind } = item, lift = item.lift ?? 0, color = TOP[kind];
    if (kind === 'plant') return box(item, lift, color, (g, top) => {
      g.fillStyle(0x3d6049).fillCircle(top.x + w / 2, top.y + 2, 18);
      g.fillStyle(0x628d60).fillCircle(top.x + 4, top.y - 5, 11).fillCircle(top.x + w - 4, top.y + 5, 10);
      g.fillStyle(0x91ad73).fillCircle(top.x + 11, top.y - 8, 7);
    });
    if (kind === 'desk') {
      chair(x + w / 2 - 17, y + h + 8);
      return box(item, lift, color, (g, top) => {
        g.fillStyle(0xe5c798).fillRect(top.x + 4, top.y + 4, w - 8, h - 8);
        // The monitor stands on the desktop, so it rises above the top face rather than lying on it.
        g.fillStyle(0x273e42).fillRect(top.x + 24, top.y - 17, 48, 23);
        g.fillStyle(0x6ea0a0).fillRect(top.x + 27, top.y - 14, 42, 16);
        g.fillStyle(0xeee8d5).fillRect(top.x + 29, top.y + 31, 39, 13);
        g.fillStyle(0x91a198); for (let i = 0; i < 6; i++) g.fillRect(top.x + 32 + i * 6, top.y + 34, 3, 2);
        g.fillStyle(0xf8eed8).fillRect(top.x + 77, top.y + 30, 7, 11);
      });
    }
    if (kind === 'table') {
      for (let cy = y + 18; cy < y + h - 12; cy += 48) { chair(x - 36, cy, true); chair(x + w + 8, cy, true); }
      return box(item, lift, color, (g, top) => {
        g.fillStyle(0xe5c798).fillRect(top.x + 5, top.y + 5, w - 10, h - 10);
        g.fillStyle(0xf4f0d9).fillRect(top.x + w / 2 - 15, top.y + h / 2 - 18, 30, 35);
        g.fillStyle(0x688b65).fillCircle(top.x + w / 2 + 40, top.y + h / 2, 10);
      });
    }
    if (kind === 'shelf') return box(item, lift, color, (g, top, side) => {
      g.fillStyle(0x8b7a58).fillRect(top.x + 5, top.y + 5, w - 10, h - 10);
      // Boards seen from above, or the whole 190-deep footprint reads as a blank slab.
      g.fillStyle(0x9b8963); for (let ry = top.y + 9; ry < top.y + h - 20; ry += 44) g.fillRect(top.x + 9, ry, w - 18, 36);
      // Crates belong on the front face — that is the whole point of a shelf this tall.
      for (let row = 0; row < 2; row++) {
        const ry = side.y + 6 + row * 28;
        g.fillStyle(0xbaa47b).fillRect(side.x + 7, ry, w - 14, 22);
        g.fillStyle(0xdad6ba).fillRect(side.x + 13, ry + 3, 26, 16);
        g.fillStyle(0x879d8f).fillRect(side.x + 45, ry + 3, w - 60, 16);
      }
    });
    if (kind === 'sofa') return box(item, lift, color, (g, top) => {
      for (let sy = top.y + 10; sy < top.y + h - 18; sy += 50) g.fillStyle(0xa7bc9f).fillRect(top.x + 10, sy, w - 20, 40);
    });
    return box(item, lift, color, (g, top) => {
      g.fillStyle(0xe4dfcd).fillRect(top.x + 4, top.y + 4, w - 8, h - 8);
      if (h > w) { g.fillStyle(0x43595a).fillRect(top.x + 10, top.y + 20, 35, 45); g.fillStyle(0x182e34).fillRect(top.x + 16, top.y + 24, 22, 20); g.fillStyle(0x91a8a2).fillRect(top.x + 12, top.y + 100, 30, 50); }
      else { g.fillStyle(0xb3b9a7); for (let cx = top.x + 12; cx < top.x + w - 20; cx += 43) g.fillRect(cx, top.y + 9, 26, h - 18); }
    });
  }

  function drawCorridor() {
    rect(42, 58, area.width - 72, area.height - 104, 0x0f1e24);
    rect(48, 64, area.width - 96, area.height - 128, 0xeee4cc);
    for (let x = 48; x < area.width - 48; x += 48) rect(x, 64, 1, area.height - 128, 0xded4bf);
    for (let y = 64; y < area.height - 64; y += 48) rect(48, y, area.width - 96, 1, 0xded4bf);
    rect(80, 552, 1760, 96, 0xc6cbb8);
    rect(88, 560, 1744, 80, 0xd9dec9);
    for (let x = 570; x < 1600; x += 310) text(x, 600, '›  ›  ›', 28, '#9da88e');
    text(960, 35, `${[...siteName].join(' ')}   /   1 F`, 22, '#a6b8ae');
    for (const room of CORRIDOR_ROOMS) {
      rect(room.x, room.y, room.width, room.height, room.color);
      for (let y = room.y + 20; y < room.y + room.height; y += 28) rect(room.x + 12, y, room.width - 24, 1, room.color - 0x090909);
      // Room names are floor-plan signage: nothing may stand inside a room, so nothing may hide them.
      const titleY = room.y + (room.door === 'top' ? 76 : 55);
      text(room.x + room.width / 2, titleY, room.name, 28, '#334840', true, SIGN_DEPTH);
      text(room.x + room.width / 2, titleY + 29, room.subtitle, 11, '#63756a', false, SIGN_DEPTH);
      const door = doorway(room);
      rect(door.x - 56, door.y - 18, 112, 36, 0xe6c984);
      rect(door.x - 42, door.y - 2, 84, 4, 0xa78a51);
      text(door.x, door.y + (room.door === 'top' ? -32 : 35), room.door === 'top' ? '↓' : '↑', 21, '#6b805f');
    }
    text(170, 598, '接待区', 18, '#728164');
  }

  /** Windows are glass set into a raised wall, so they ride just above that wall's own depth. */
  function drawWindows() {
    for (const room of CORRIDOR_ROOMS.filter(r => r.door === 'bottom')) {
      const g = scene.add.graphics().setDepth(room.y + WALL_SIZE + .5); raised.push(g);
      for (const offset of [65, 345]) {
        g.fillStyle(0x91c9cb).fillRect(room.x + offset, room.y - 30, 130, 34);
        g.fillStyle(0xe0f3e9).fillRect(room.x + offset + 63, room.y - 30, 4, 34);
      }
    }
  }

  function drawRoom() {
    rect(0, 0, area.width, area.height, 0x0f1e24);
    rect(8, 8, area.width - 16, area.height - 16, 0xeee4cc);
    for (let x = 8; x < area.width - 8; x += 48) rect(x, 8, 1, area.height - 16, 0xded4bf);
    for (let y = 8; y < area.height - 8; y += 48) rect(8, y, area.width - 16, 1, 0xded4bf);
    for (const exit of area.exits) {
      const { x, y, width } = exit.rect, top = y < area.height / 2;
      rect(x - 6, y, width + 12, 12, 0xe6c984);
      text(x + width / 2, y + (top ? 34 : -26), `↤ ${exit.label}`, 17, '#6b805f');
    }
    // The name is painted on the back wall — the one surface in a room that nothing else uses.
    const back = signWall(area.walls, area.height);
    if (back) text(back.x + back.width / 2, 38, area.name, 26, '#e3ece4', true, depthOf(back) + .5);
  }

  if (area.id === 'corridor') drawCorridor(); else drawRoom();
  for (const wall of area.walls) drawWall(wall);
  for (const item of area.furniture) drawFurniture(item);
  if (area.id === 'corridor') drawWindows();
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
