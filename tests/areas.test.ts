import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, HEAD_TOP, MAX_LIFT, corridor, meeting, storage, canStandAt, exitAt, moveIn, type AreaId } from '../shared/world/index.js';
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
  for (const area of Object.values(AREAS)) {
    for (const item of area.furniture) {
      assert.equal(typeof item.lift, 'number', `${area.id} 的 ${item.kind} 没有 lift`);
      // The hard invariant: nobody may be erased outright.
      assert.ok(HEAD_TOP - item.lift! > 0, `${area.id} 的 ${item.kind} lift=${item.lift}，会把北侧的人整个盖住`);
      // The cap: raising a value past it has to be a deliberate edit to MAX_LIFT, which is
      // where the rule — and what you give up by raising it — is written down.
      assert.ok(item.lift! <= MAX_LIFT, `${area.id} 的 ${item.kind} lift=${item.lift} 超过上限 ${MAX_LIFT}，北侧的人只剩 ${(HEAD_TOP - item.lift!).toFixed(1)}px`);
    }
  }
  // How legible the remaining band has to be is a judgement call, so pin every value instead:
  // a silent edit to the table is then caught whichever way it moves.
  const lifts = Object.fromEntries([...corridor.furniture, ...meeting.furniture, ...storage.furniture].map(f => [f.kind, f.lift]));
  assert.deepEqual(lifts, { desk: 22, table: MAX_LIFT, shelf: MAX_LIFT, counter: MAX_LIFT, sofa: MAX_LIFT, plant: MAX_LIFT });
  // MAX_LIFT moved three times (62 → 32 → 26) before landing here, each time because it was set
  // too high; the assertions above only check MAX_LIFT against itself, so they stay green no
  // matter what it's raised to. Pin it against a literal so raising it is a deliberate edit that
  // meets this history, not a free rebuild of every expectation from the same constant.
  assert.ok(MAX_LIFT <= 26, `MAX_LIFT=${MAX_LIFT} 会把北侧的人压到只剩 ${(HEAD_TOP - MAX_LIFT).toFixed(1)}px 的头，太矮了`);
});

test('every spawn point across open areas is standable and not on a trigger', () => {
  for (const area of Object.values(AREAS)) {
    for (const s of area.spawnPoints) {
      assert.ok(canStandAt(area, s.x, s.y), `${area.id} 出生点不可站立`);
      assert.equal(exitAt(area, s.x, s.y), undefined, `${area.id} 出生点压在出口触发器上`);
    }
  }
});
