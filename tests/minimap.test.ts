import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, meeting, storage, CORRIDOR_ROOMS, projectTo } from '../shared/world/index.js';
import type { Actor } from '../shared/game.js';
import { minimapDots, corridorMarkup, roomMarkup, minimapBubbles, bubbleMarkup } from '../src/minimap.js';

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

test('小地图只画跨 area 的气泡，同 area 的话已经在头顶了', () => {
  const here = actor({ id: 'here', area: 'corridor', x: 500, y: 300 });
  const there = actor({ id: 'there', area: 'meeting', x: 150, y: 84 });
  const live = [{ id: 'here', text: '我在走廊' }, { id: 'there', text: '我在会议室' }];
  const out = minimapBubbles(corridor, [here, there], live);
  assert.deepEqual(out.map(b => b.id), ['there']);
  const projected = projectTo(meeting, 150, 84);
  assert.deepEqual({ x: out[0].x, y: out[0].y }, projected);
});

test('小地图气泡截短，最多两条', () => {
  const players = ['a', 'b', 'c'].map((id, i) => actor({ id, area: 'meeting', x: 100 + i * 10, y: 84 }));
  const live = [{ id: 'a', text: '这是一句很长很长很长的话' }, { id: 'b', text: '第二句' }, { id: 'c', text: '第三句' }];
  const out = minimapBubbles(corridor, players, live);
  assert.equal(out.length, 2, '跨 area 气泡最多两条');
  assert.equal(out[0].text, '这是一句很长…');   // 这是一句很长 = 6 个字，再加省略号
});

test('点名到自己的那句被标成 mine', () => {
  const boss = actor({ id: 'colleague', area: 'meeting', x: 150, y: 84 });
  const out = minimapBubbles(corridor, [boss], [{ id: 'colleague', text: '这个 摸鱼小王 处理一下。' }], '摸鱼小王');
  assert.equal(out[0].mine, true);
  const other = minimapBubbles(corridor, [boss], [{ id: 'colleague', text: '这个 别人 处理一下。' }], '摸鱼小王');
  assert.equal(other[0].mine, false);
});

test('小地图气泡的标记把文本转义了', () => {
  // src/map-panel.ts 是 innerHTML 拼接 SVG。聊天文本是第一个流到那里的用户可控字符串，
  // 所以这条钉住转义——没有它，一个把自己起名叫 <img onerror=...> 的玩家就能在
  // 别人的小地图上执行脚本。
  const markup = bubbleMarkup({ x: 0, y: 0, text: '<img onerror="alert(1)">', mine: false });
  assert.ok(!markup.includes('<img'), `原样的标签进了标记：${markup}`);
  assert.ok(markup.includes('&lt;img'), '没有转义成实体');
  assert.ok(!markup.includes('onerror="alert(1)"'), '属性没被转义');
});

test('被点名的昵称带引号也不会撑破标记', () => {
  const markup = bubbleMarkup({ x: 0, y: 0, text: '这个 "><script> 处理一下', mine: true });
  assert.ok(!markup.includes('<script'), `脚本标签进了标记：${markup}`);
  assert.ok(markup.includes('&quot;') || markup.includes('&#39;') || markup.includes('&gt;'), '引号/尖括号没被转义');
});
