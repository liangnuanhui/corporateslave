import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, canStandAt, doorway, moveIn, roomAt } from '../shared/world/index.js';
import { idleInput } from '../shared/game.js';

const spawn = corridor.spawnPoints[0];
const actor = (x = spawn.x, y = spawn.y) => ({ x, y, face: 1, vy: 0 });

test('corridor movement supports both axes and normalizes diagonal speed', () => {
  const straight = actor(), diagonal = actor(), start = actor();
  moveIn(corridor, straight, { ...idleInput(), up: true });
  moveIn(corridor, diagonal, { ...idleInput(), up: true, right: true });
  assert.ok(straight.y < start.y);
  assert.equal(straight.x, start.x);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - (start.y - straight.y)) < .0001);
  moveIn(corridor, straight, { ...idleInput(), down: true });
  assert.ok(Math.abs(straight.y - start.y) < .0001);
});

test('all six rooms can be entered and exited through their doors', () => {
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room), fromAbove = room.door === 'top';
    const p = actor(door.x, door.y + (fromAbove ? -48 : 48));
    assert.ok(canStandAt(corridor, p.x, p.y));
    assert.equal(roomAt(p.x, p.y), undefined);
    for (let i = 0; i < 12; i++) moveIn(corridor, p, { ...idleInput(), up: !fromAbove, down: fromAbove });
    assert.equal(roomAt(p.x, p.y)?.id, room.id, `enter ${room.name}`);
    for (let i = 0; i < 12; i++) moveIn(corridor, p, { ...idleInput(), up: fromAbove, down: !fromAbove });
    assert.equal(roomAt(p.x, p.y), undefined, `exit ${room.name}`);
  }
});

test('walls block entry away from doors, including large movement steps', () => {
  const room = CORRIDOR_ROOMS[0];
  const p = actor(room.x + 100, room.y + room.height + 48);
  for (let i = 0; i < 100; i++) moveIn(corridor, p, { ...idleInput(), up: true }, .15);
  assert.ok(p.y >= room.y + room.height + corridor.radius);
  assert.equal(roomAt(p.x, p.y), undefined);
});

test('furniture blocks movement and every doorway is reachable from the corridor', () => {
  const desk = CORRIDOR_FURNITURE.find(f => f.kind === 'desk')!;
  const p = actor(desk.x - 30, desk.y + desk.height / 2);
  for (let i = 0; i < 30; i++) moveIn(corridor, p, { ...idleInput(), right: true });
  assert.ok(p.x <= desk.x - corridor.radius);
  for (let x = spawn.x; x < 1800; x += 5) assert.ok(canStandAt(corridor, x, spawn.y));
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room);
    for (let y = Math.min(600, door.y); y <= Math.max(600, door.y); y += 5) assert.ok(canStandAt(corridor, door.x, y), room.name);
  }
});

test('corridor perimeter blocks escape and idle input does not apply gravity', () => {
  const p = actor(corridor.width - 64, 600);
  for (let i = 0; i < 300; i++) moveIn(corridor, p, { ...idleInput(), right: true });
  assert.ok(p.x <= corridor.bounds.x + corridor.bounds.width - corridor.radius);
  moveIn(corridor, p, idleInput()); assert.equal(p.y, 600); assert.equal(p.vy, 0);
});
