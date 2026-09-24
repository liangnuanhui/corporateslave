import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, canStandAt, exitAt, randomStandablePoint, spotAtDesk, corridor, meeting, storage, type Area } from '../shared/world/index.js';
import { inMelee, meleeHits, nextDoing, NPC, NPC_LINES } from '../shared/game.js';

test('a random target spot is always standable and never on a door trigger', () => {
  for (const area of Object.values(AREAS)) {
    for (let i = 0; i < 300; i++) {
      const spot = randomStandablePoint(area);
      assert.ok(canStandAt(area, spot.x, spot.y), `${area.name} 抽到了站不住的位置 ${spot.x},${spot.y}`);
      assert.equal(exitAt(area, spot.x, spot.y), undefined, `${area.name} 抽到的位置压在门口触发器上`);
    }
  }
});

test('the spots actually move around rather than clustering', () => {
  // 只验证「站得住」会放过一个永远落在同一个角落的实现——那样「出现地点随机」就是假的。
  // 所以这里量分布，而不是相信采样器。
  const xs: number[] = [], ys: number[] = [];
  for (let i = 0; i < 200; i++) { const s = randomStandablePoint(corridor); xs.push(s.x); ys.push(s.y); }
  assert.ok(Math.max(...xs) - Math.min(...xs) > corridor.width * .6, '横向分布太窄');
  assert.ok(Math.max(...ys) - Math.min(...ys) > corridor.height * .6, '纵向分布太窄');
});

test('the fallback returns a spawn point when nothing sampled is standable', () => {
  // Forcing the real rooms to reject everything is not possible from the outside — their corners
  // happen to be standable — so the fallback gets its own area: one obstacle over the whole floor.
  // Without this the 200-try loop would fall off the end and return undefined mid-tick.
  const sealed: Area = {
    id: 'meeting', name: '封死的房间', width: 200, height: 200,
    bounds: { x: 0, y: 0, width: 200, height: 200 }, radius: 14, speed: 200,
    spawnPoints: [{ x: 111, y: 77 }],
    walls: [], furniture: [], obstacles: [{ x: -50, y: -50, width: 300, height: 300 }], exits: [],
  };
  assert.deepEqual(randomStandablePoint(sealed), { x: 111, y: 77 });
  assert.deepEqual(randomStandablePoint(sealed, () => 0), { x: 111, y: 77 });
  assert.deepEqual(randomStandablePoint(sealed, () => 0.999999), { x: 111, y: 77 });
});

test('melee reaches in front, above and below, but not behind or far away', () => {
  const me = { x: 500, y: 500, face: 1 };
  assert.ok(inMelee(me, { x: 540, y: 500 }), '正前方 40px 应该打得到');
  assert.ok(inMelee(me, { x: 500, y: 455 }), '正上方应该打得到——俯视时 face 只有左右');
  assert.ok(inMelee(me, { x: 500, y: 545 }), '正下方应该打得到');
  assert.ok(!inMelee(me, { x: 440, y: 500 }), '背后不该打得到');
  assert.ok(!inMelee(me, { x: 580, y: 500 }), '超出射程不该打得到');
  assert.ok(inMelee({ ...me, face: -1 }, { x: 460, y: 500 }), '转身后背后变正前方');
  // The reach is a disc, not a square: a corner at (45,45) is 63.6 away and inside, but the
  // square that contains it would also admit (64,64) at 90.5, which is nearly half a room further.
  assert.ok(inMelee(me, { x: 545, y: 545 }), '斜前方 63.6px 在半径内');
  assert.ok(!inMelee(me, { x: 564, y: 564 }), '斜前方 90.5px 已在半径外');
});

test('the target rolls a real range of hit points', () => {
  assert.ok(NPC.hpMin > 0 && NPC.hpMax > NPC.hpMin, '血量区间要有宽度');
  assert.equal((NPC.hpMax - NPC.hpMin) % NPC.hpStep, 0, '区间必须被步长整除，否则抽不到上限');
});

test('a swing only reaches live targets standing in the same room', () => {
  const me = { x: 500, y: 500, face: 1, area: 'corridor' as const };
  const at = (over: Partial<{ hp: number; area: 'corridor' | 'meeting'; x: number; y: number }>) =>
    ({ hp: 100, area: 'corridor' as 'corridor' | 'meeting', x: 530, y: 500, ...over });
  assert.equal(meleeHits(me, [at({})]).length, 1, '同房间、活着、在范围内——应该打中');
  assert.equal(meleeHits(me, [at({ hp: 0 })]).length, 0, '已经躺平的不该再被打中');
  // 房间之间是各自独立的坐标系，(530,500) 在每个房间里都存在。少了 area 这一条，
  // 站在走廊上就能隔着墙打到会议室里坐标相同的人，而且屏幕上什么都看不见。
  assert.equal(meleeHits(me, [at({ area: 'meeting' })]).length, 0, '不同房间不该打得到');
  assert.equal(meleeHits(me, [at({ x: 700 })]).length, 0, '超出半径不该打得到');
  assert.equal(meleeHits(me, [at({ x: 300 })]).length, 0, '背后不该打得到');
  assert.equal(meleeHits(me, [at({}), at({ x: 470, y: 470 }), at({ area: 'meeting' })]).length, 1, '只返回真正打中的那些');
});

test('a desk spot is beside real furniture, and the corridor honestly has none', () => {
  const deskLike = (area: Area) => area.furniture.filter(f => f.kind === 'desk' || f.kind === 'table' || f.kind === 'counter');
  for (const area of Object.values(AREAS)) {
    for (let i = 0; i < 300; i++) {
      const spot = spotAtDesk(area);
      if (!spot) continue;
      assert.ok(canStandAt(area, spot.x, spot.y), `${area.name} 的工位站不住`);
      assert.equal(exitAt(area, spot.x, spot.y), undefined, `${area.name} 的工位压在门口触发器上`);
      // 「桌边」必须真的贴着某张桌子，否则这个函数只是另一个随机点生成器。
      assert.ok(deskLike(area).some(d => Math.abs(spot.x - (d.x + d.width / 2)) <= d.width / 2 + area.radius + 10
        && Math.abs(spot.y - (d.y + d.height / 2)) <= d.height / 2 + area.radius + 10), `${area.name} 的工位离所有桌子都太远`);
    }
  }
  // 房间里有真的工位：大会议室的长桌、储物间的装备台。
  for (const area of [meeting, storage]) assert.ok(spotAtDesk(area), `${area.name} 应该找得到工位`);
  // 走廊有 19 件桌类家具，却一个工位都没有——它们全是画在六个房间方框内部的装饰，
  // 而那些方框在走廊平面上是实心障碍，四条边都站不住。所以这里必须返回 undefined，
  // 让调用方改成「玩手机」，而不是把人放进墙里假装那是工位。
  assert.ok(deskLike(corridor).length > 10, '走廊本来就有很多桌子，否则下面验的不是这件事');
  assert.equal(spotAtDesk(corridor), undefined);
});

test('the colleague picks all three activities, walking most often', () => {
  const counts: Record<string, number> = { walk: 0, desk: 0, phone: 0 };
  for (let i = 0; i < 3000; i++) counts[nextDoing()]++;
  for (const key of ['walk', 'desk', 'phone']) assert.ok(counts[key] > 100, `${key} 几乎抽不到 (${counts[key]}/3000)`);
  assert.ok(counts.walk > counts.desk && counts.walk > counts.phone, '静止的同事看着像雕像，走动应该最常见');
  // 边界：random() 的两个端点都要落在合法值上，不能返回 undefined。
  assert.equal(nextDoing(() => 0), 'walk');
  assert.equal(nextDoing(() => 0.999999), 'phone');
});

test('the boring lines are real, distinct sentences', () => {
  assert.ok(NPC_LINES.length >= 6, '台词太少，几句话就开始重复');
  assert.equal(new Set(NPC_LINES).size, NPC_LINES.length, '台词有重复');
  for (const line of NPC_LINES) assert.ok(line.length >= 4 && line.length <= 16, `「${line}」长度不适合气泡`);
});
