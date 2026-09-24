import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, canStandAt, doorway, moveIn, roomAt, AREAS, exitAt, projectTo, meeting, storage } from '../shared/world/index.js';
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

test('two rooms open through their doorway, four report 装修中', () => {
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room), fromAbove = room.door === 'top';
    const p = actor(door.x, door.y + (fromAbove ? -48 : 48));
    assert.ok(canStandAt(corridor, p.x, p.y), room.name);
    let hit;
    for (let i = 0; i < 12 && !hit; i++) {
      moveIn(corridor, p, { ...idleInput(), up: !fromAbove, down: fromAbove });
      hit = exitAt(corridor, p.x, p.y);
    }
    assert.ok(hit, `${room.name} 的门口应该有触发器`);
    if (room.id === 'meeting' || room.id === 'storage') {
      assert.equal(hit!.locked, undefined, `${room.name} 应该开放`);
      assert.equal(hit!.to, room.id);
    } else {
      assert.equal(hit!.locked, true, `${room.name} 应该封闭`);
    }
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

test('area registry is self-consistent', () => {
  for (const area of Object.values(AREAS)) {
    for (const exit of area.exits) {
      if (exit.locked) continue;
      const target = AREAS[exit.to];
      assert.ok(target, `${area.id} 的出口指向不存在的 ${exit.to}`);
      assert.ok(canStandAt(target, exit.at.x, exit.at.y), `${area.id} → ${exit.to} 的落点不可站立`);
      // The landing spot must not sit inside the opposite trigger, or the player bounces back.
      assert.equal(exitAt(target, exit.at.x, exit.at.y), undefined, `${area.id} → ${exit.to} 的落点落在反向触发器里`);
    }
    assert.ok(area.spawnPoints.length > 0, `${area.id} 没有出生点`);
    for (const s of area.spawnPoints) assert.ok(canStandAt(area, s.x, s.y), `${area.id} 的出生点 ${s.x},${s.y} 不可站立`);
  }
});

test('room positions project inside their corridor footprint', () => {
  for (const room of [meeting, storage]) {
    const slot = CORRIDOR_ROOMS.find(r => r.id === room.id)!;
    for (const [x, y] of [[0, 0], [room.width, room.height], [room.width / 2, room.height / 2], [-50, -50], [room.width + 99, room.height + 99]]) {
      const p = projectTo(room, x, y);
      assert.ok(p.x >= slot.x && p.x <= slot.x + slot.width, `${room.id} x 越界: ${p.x}`);
      assert.ok(p.y >= slot.y && p.y <= slot.y + slot.height, `${room.id} y 越界: ${p.y}`);
    }
    assert.deepEqual(projectTo(corridor, 500, 500), { x: 500, y: 500 });
  }
});

test('every spawn point in every room can reach that room\'s exit', () => {
  // pickSpawn returns any spawn point and systematically favours the ones furthest from other
  // players, so checking only index 0 would let a furniture edit strand a real player with the
  // suite still green. Asking whether the exit is *reachable* — a flood fill over standable
  // positions — is also the honest question: a greedy walk failing only means the walk was naive,
  // not that the player is stuck. storage's centre spawn is exactly that case.
  const STEP = 7; // half the collision radius, so no obstacle thinner than the character is jumped
  for (const room of [meeting, storage]) {
    for (const spawn of room.spawnPoints) {
      const seen = new Set<string>();
      const queue = [spawn];
      let reached = false;
      for (let i = 0; i < queue.length && !reached; i++) {
        const { x, y } = queue[i];
        for (const [dx, dy] of [[STEP, 0], [-STEP, 0], [0, STEP], [0, -STEP]]) {
          const nx = x + dx, ny = y + dy, key = `${Math.round(nx)},${Math.round(ny)}`;
          if (seen.has(key) || !canStandAt(room, nx, ny)) continue;
          seen.add(key); queue.push({ x: nx, y: ny });
          if (exitAt(room, nx, ny)) { reached = true; break; }
        }
      }
      assert.ok(reached, `${room.name} 的出生点 (${spawn.x},${spawn.y}) 到不了出口`);
    }
  }
});
