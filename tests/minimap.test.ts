import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, meeting, storage, CORRIDOR_ROOMS, projectTo } from '../shared/world/index.js';
import type { Actor } from '../shared/game.js';
import { minimapDots, corridorMarkup, roomMarkup } from '../src/minimap.js';

const actor = (overrides: Partial<Actor>): Actor => ({
  id: 'a', name: '摸鱼员', role: 'junior', x: 0, y: 0, vy: 0, face: 1,
  hp: 100, weapon: 'foam', action: 'idle', ack: 0, area: 'corridor', ...overrides,
});

test('corridor view leaves a corridor-local player at their raw coordinates', () => {
  const p = actor({ id: 'p1', area: 'corridor', x: 500, y: 300 });
  const [dot] = minimapDots(corridor, [p]);
  assert.deepEqual({ x: dot.x, y: dot.y }, { x: 500, y: 300 });
});

test('corridor view projects a room-local player into that room\'s corridor footprint', () => {
  const p = actor({ id: 'p2', area: 'meeting', x: 150, y: 84 });
  const [dot] = minimapDots(corridor, [p]);
  const expected = projectTo(meeting, 150, 84);
  assert.deepEqual({ x: dot.x, y: dot.y }, expected);
  const slot = CORRIDOR_ROOMS.find(r => r.id === 'meeting')!;
  assert.ok(dot.x >= slot.x && dot.x <= slot.x + slot.width, 'x lands inside the meeting room slot');
  assert.ok(dot.y >= slot.y && dot.y <= slot.y + slot.height, 'y lands inside the meeting room slot');
});

test('room view includes only players standing in that room', () => {
  const inMeeting = actor({ id: 'm', area: 'meeting', x: 200, y: 200 });
  const inStorage = actor({ id: 's', area: 'storage', x: 200, y: 200 });
  const inCorridor = actor({ id: 'c', area: 'corridor', x: 200, y: 200 });
  const dots = minimapDots(meeting, [inMeeting, inStorage, inCorridor]);
  assert.deepEqual(dots.map(d => d.id), ['m']);
});

test('room view draws raw local coordinates, never projected', () => {
  const p = actor({ id: 'm', area: 'meeting', x: 150, y: 84 });
  const [dot] = minimapDots(meeting, [p]);
  assert.deepEqual({ x: dot.x, y: dot.y }, { x: 150, y: 84 });
});

test('the local player is distinguishable from everyone else', () => {
  const me = actor({ id: 'me', area: 'corridor', x: 10, y: 10 });
  const other = actor({ id: 'other', area: 'corridor', x: 20, y: 20 });
  const dots = minimapDots(corridor, [me, other], 'me');
  const mine = dots.find(d => d.id === 'me')!, theirs = dots.find(d => d.id === 'other')!;
  assert.equal(mine.self, true); assert.equal(theirs.self, false);
  assert.notEqual(mine.r, theirs.r);
});

test('corridor markup lists all six rooms as clickable buttons', () => {
  const markup = corridorMarkup();
  for (const room of CORRIDOR_ROOMS) assert.ok(markup.includes(`data-map-room="${room.id}"`), `missing button for ${room.id}`);
});

test('room markup sizes itself to the room, not the floor, and draws its own walls and exit', () => {
  const markup = roomMarkup(meeting);
  // roomMarkup doesn't set the <svg> viewBox itself (renderMinimap does that) — but its own
  // background rect is sized to the area, which is the same information.
  assert.ok(markup.includes(`width="${meeting.width}" height="${meeting.height}"`));
  assert.ok(markup.includes('#e6c984'), 'exit tile drawn');
  assert.equal((markup.match(/#85937b/g) ?? []).length, 1, 'one wall group');
  // Sanity: this is the meeting room's plan, not the corridor's — no room-select buttons here.
  assert.ok(!markup.includes('data-map-room'));
  const storageMarkup = roomMarkup(storage);
  assert.notEqual(markup, storageMarkup);
});
