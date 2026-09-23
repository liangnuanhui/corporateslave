import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, corridor, meeting, storage, canStandAt, exitAt, moveIn, type AreaId } from '../shared/world/index.js';
import { idleInput, type Input } from '../shared/game.js';

interface TickState { area: AreaId; x: number; y: number; vy: number; face: number; cooldown: number }

/** Reproduces the server's per-tick exit handling, so bounce protection can be tested without a server. */
function tick(state: TickState, input: Input, now: number) {
  moveIn(AREAS[state.area], state, input);
  if (now < state.cooldown) return undefined;
  const exit = exitAt(AREAS[state.area], state.x, state.y);
  if (!exit || exit.locked) return exit;
  state.area = exit.to; state.x = exit.at.x; state.y = exit.at.y; state.cooldown = now + 400;
  return exit;
}

test('walking through the meeting door switches area and does not bounce back', () => {
  const door = corridor.exits.find(e => e.to === 'meeting')!;
  const state: TickState = { area: 'corridor', x: door.rect.x + door.rect.width / 2, y: door.rect.y + door.rect.height + 30, vy: 0, face: 1, cooldown: 0 };
  let now = 0, entered = false;
  for (let i = 0; i < 20 && !entered; i++) { now += 1000 / 30; tick(state, { ...idleInput(), up: true }, now); entered = state.area === 'meeting'; }
  assert.equal(state.area, 'meeting', '应该进入大会议室');
  // Hold the same key for another 30 ticks: the player must stay inside.
  for (let i = 0; i < 30; i++) { now += 1000 / 30; tick(state, { ...idleInput(), up: true }, now); }
  assert.equal(state.area, 'meeting', '进门后被弹回了走廊');
});

test('locked doors never switch area', () => {
  for (const exit of corridor.exits.filter(e => e.locked)) {
    const state: TickState = { area: 'corridor', x: exit.rect.x + exit.rect.width / 2, y: exit.rect.y + exit.rect.height + 30, vy: 0, face: 1, cooldown: 0 };
    let now = 0;
    for (let i = 0; i < 40; i++) { now += 1000 / 30; tick(state, { ...idleInput(), up: exit.rect.y < 600, down: exit.rect.y >= 600 }, now); }
    assert.equal(state.area, 'corridor', `${exit.label} 不应该能进入`);
  }
});

test('leaving a room lands back in the corridor outside the trigger', () => {
  for (const room of [meeting, storage]) {
    const exit = room.exits[0];
    // NOTE: exit.at is the CORRIDOR-space landing point used once this exit fires (see
    // shared/world/index.ts) — not a room-local position. Starting the walk there would place
    // the state far outside the room's own door trigger (which sits at exit.rect, in this room's
    // own coordinates), so the exit would never be found. Start from just inside the room's own
    // door instead, mirroring how the corridor tests approach a trigger from outside it.
    const toward = room.id === 'meeting' ? { down: true } : { up: true };
    const state: TickState = {
      area: room.id,
      x: exit.rect.x + exit.rect.width / 2,
      y: room.id === 'meeting' ? exit.rect.y - 30 : exit.rect.y + exit.rect.height + 30,
      vy: 0, face: 1, cooldown: 0,
    };
    assert.ok(canStandAt(room, state.x, state.y));
    let now = 0;
    for (let i = 0; i < 40 && state.area === room.id; i++) { now += 1000 / 30; tick(state, { ...idleInput(), ...toward }, now); }
    assert.equal(state.area, 'corridor', `${room.name} 出不去`);
    assert.equal(exitAt(corridor, state.x, state.y), undefined, `${room.name} 的出口落点落在走廊触发器里`);
  }
});

test('every furniture item gets a render height, and none is tall enough to swallow a character', () => {
  // A character standing due north of a solid is stopped one radius away, at `y - 14`. Their
  // avatar's topmost opaque pixel is 18.9px above that: the 36px-tall texture is drawn 40px
  // tall (x1.111) and its first opaque row is texture y=1. So the head tops out at `y - 32.9`
  // and the band still visible over the solid is `32.9 - lift` pixels.
  const HEAD_TOP = 32.9;
  for (const area of Object.values(AREAS)) {
    for (const item of area.furniture) {
      assert.equal(typeof item.lift, 'number', `${area.id} 的 ${item.kind} 没有 lift`);
      const visible = HEAD_TOP - item.lift!;
      assert.ok(visible > 0, `${area.id} 的 ${item.kind} lift=${item.lift}，会把北侧的人整个盖住`);
    }
  }
  // How legible `visible` has to be is a judgement call, so pin every value instead: a silent
  // edit to the table is then caught whichever way it moves.
  const lifts = Object.fromEntries([...corridor.furniture, ...meeting.furniture, ...storage.furniture].map(f => [f.kind, f.lift]));
  assert.deepEqual(lifts, { desk: 22, table: 26, shelf: 26, counter: 26, sofa: 30, plant: 26 });
});
