import test from 'node:test';
import assert from 'node:assert/strict';
import { OFFICE, OFFICE_ROOMS, OFFICE_FURNITURE, canStandAt, doorway, moveOffice, roomAt } from '../shared/office.js';
import { idleInput } from '../shared/game.js';

const actor = (x = OFFICE.spawn.x, y = OFFICE.spawn.y) => ({ x, y, face: 1, vy: 0 });

test('office movement supports both axes and normalizes diagonal speed', () => {
  const straight = actor(), diagonal = actor(), start = actor();
  moveOffice(straight, { ...idleInput(), up: true });
  moveOffice(diagonal, { ...idleInput(), up: true, right: true });
  assert.ok(straight.y < start.y);
  assert.equal(straight.x, start.x);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - (start.y - straight.y)) < .0001);
  moveOffice(straight, { ...idleInput(), down: true });
  assert.ok(Math.abs(straight.y - start.y) < .0001);
});

test('all six rooms can be entered and exited through their doors', () => {
  for (const room of OFFICE_ROOMS) {
    const door = doorway(room), fromAbove = room.door === 'top';
    const p = actor(door.x, door.y + (fromAbove ? -48 : 48));
    assert.ok(canStandAt(p.x, p.y));
    assert.equal(roomAt(p.x, p.y), undefined);
    for (let i = 0; i < 12; i++) moveOffice(p, { ...idleInput(), up: !fromAbove, down: fromAbove });
    assert.equal(roomAt(p.x, p.y)?.id, room.id, `enter ${room.name}`);
    for (let i = 0; i < 12; i++) moveOffice(p, { ...idleInput(), up: fromAbove, down: !fromAbove });
    assert.equal(roomAt(p.x, p.y), undefined, `exit ${room.name}`);
  }
});

test('walls block entry away from doors, including large movement steps', () => {
  const room = OFFICE_ROOMS[0];
  const p = actor(room.x + 100, room.y + room.height + 48);
  for (let i = 0; i < 100; i++) moveOffice(p, { ...idleInput(), up: true }, .15);
  assert.ok(p.y >= room.y + room.height + OFFICE.radius);
  assert.equal(roomAt(p.x, p.y), undefined);
});

test('furniture blocks movement and every doorway is reachable from the corridor', () => {
  const desk = OFFICE_FURNITURE.find(f => f.kind === 'desk')!;
  const p = actor(desk.x - 30, desk.y + desk.height / 2);
  for (let i = 0; i < 30; i++) moveOffice(p, { ...idleInput(), right: true });
  assert.ok(p.x <= desk.x - OFFICE.radius);
  for (let x = OFFICE.spawn.x; x < 1800; x += 5) assert.ok(canStandAt(x, OFFICE.spawn.y));
  for (const room of OFFICE_ROOMS) {
    const door = doorway(room);
    for (let y = Math.min(600, door.y); y <= Math.max(600, door.y); y += 5) assert.ok(canStandAt(door.x, y), room.name);
  }
});

test('office perimeter blocks escape and idle input does not apply gravity', () => {
  const p = actor(OFFICE.width - 64, 600);
  for (let i = 0; i < 300; i++) moveOffice(p, { ...idleInput(), right: true });
  assert.ok(p.x <= OFFICE.width - 48 - OFFICE.radius);
  moveOffice(p, idleInput()); assert.equal(p.y, 600); assert.equal(p.vy, 0);
});
