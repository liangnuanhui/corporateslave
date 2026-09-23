import test from 'node:test';
import assert from 'node:assert/strict';
import { faces, shade, depthOf, signWall, wallRole } from '../src/render/oblique.js';
import { corridor, meeting, storage } from '../shared/world/index.js';

test('a lifted solid draws shadow at the footprint, side below the top, top raised by lift', () => {
  const f = faces({ x: 100, y: 200, width: 60, height: 40, lift: 24, top: 0x808080, side: 0 });
  assert.deepEqual(f.shadow, { x: 100, y: 200, width: 60, height: 40 });
  assert.deepEqual(f.top, { x: 100, y: 200 - 24, width: 60, height: 40 });
  // The side face fills the gap between the raised top's bottom edge and the footprint's bottom edge.
  assert.deepEqual(f.side, { x: 100, y: 200 + 40 - 24, width: 60, height: 24 });
});

test('a flat solid has no side face', () => {
  const f = faces({ x: 0, y: 0, width: 10, height: 10, lift: 0, top: 0xffffff, side: 0 });
  assert.equal(f.side.height, 0);
  assert.deepEqual(f.top, { x: 0, y: 0, width: 10, height: 10 });
});

test('shade darkens toward black and never leaves the byte range', () => {
  assert.equal(shade(0xffffff, 0), 0xffffff);
  assert.equal(shade(0xffffff, 1), 0x000000);
  assert.equal(shade(0x8040c0, .5), 0x402060);
  const c = shade(0x010101, .99);
  assert.ok(c >= 0 && c <= 0xffffff);
});

test('depth sorts by the footprint bottom edge, so nearer objects win', () => {
  assert.ok(depthOf({ x: 0, y: 100, width: 10, height: 40 }) > depthOf({ x: 0, y: 100, width: 10, height: 10 }));
  assert.equal(depthOf({ x: 0, y: 100, width: 10, height: 40 }), 140);
});

test('a wall is classified by which edge of its area it sits on', () => {
  // meeting: north wall is full width, south wall is the two segments flanking the door.
  const north = meeting.walls.find(w => w.y === 0 && w.width > w.height)!;
  const south = meeting.walls.filter(w => w.y + w.height >= meeting.height && w.width > w.height);
  assert.equal(wallRole(north, meeting.height), 'back');
  assert.equal(south.length, 2);
  for (const wall of south) assert.equal(wallRole(wall, meeting.height), 'front');
  // A vertical wall touching y = 0 is NOT a back wall: it is seen end-on, not face-on.
  const left = meeting.walls.find(w => w.x === 0 && w.height > w.width)!;
  assert.equal(wallRole(left, meeting.height), 'side');
  // storage is the mirror image: the door gap is in the north wall.
  assert.equal(storage.walls.filter(w => wallRole(w, storage.height) === 'back').length, 2);
  assert.equal(storage.walls.filter(w => wallRole(w, storage.height) === 'front').length, 1);
  // Corridor walls enclose rooms in the middle of the floor: none touches an edge.
  for (const wall of corridor.walls) assert.equal(wallRole(wall, corridor.height), 'side');
});

test('the room sign lands on the widest back wall, and on the right one when widths tie', () => {
  assert.deepEqual(signWall(meeting.walls, meeting.height), { x: 0, y: 0, width: meeting.width, height: 16 });
  // storage has two equal halves; the later one keeps the sign clear of the top-left HUD.
  const sign = signWall(storage.walls, storage.height)!;
  assert.ok(sign.x > storage.width / 2, `sign should sit right of centre, got x=${sign.x}`);
  assert.equal(signWall(corridor.walls, corridor.height), undefined);
});
