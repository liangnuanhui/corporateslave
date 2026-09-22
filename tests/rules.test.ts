import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD, move, inRange, damageFor, idleInput } from '../shared/game.js';
import { Database } from '../server/database.js';

test('shared movement clamps world bounds and lands on the office floor', () => {
  const actor = { x: 40, y: WORLD.floor, vy: 0, face: 1 };
  move(actor, { ...idleInput(), left: true }); assert.equal(actor.x, 36);
  move(actor, { ...idleInput(), jump: true }); assert.ok(actor.y < WORLD.floor);
  for (let i=0;i<100;i++) move(actor,idleInput());
  assert.equal(actor.y,WORLD.floor); assert.equal(actor.vy,0);
});
test('damage depends on server role/equipment and requires facing/range', () => {
  assert.equal(damageFor('rookie','foam'),18); assert.equal(damageFor('rookie','keyboard'),28);
  assert.ok(inRange({x:100,y:500,face:1},{x:180,y:500}));
  assert.ok(!inRange({x:100,y:500,face:1},{x:20,y:500}));
  assert.ok(!inRange({x:100,y:500,face:1},{x:180,y:350}));
});
test('persistent economy: authenticated accounts, atomic purchases, idempotent rewards', async () => {
  const db = new Database(); await db.init('memory://');
  try {
    const account = await db.register('tester','test-password-123','测试摸鱼员','rookie');
    assert.equal((await db.authenticate(account.token))?.id,account.profile.id);
    assert.equal(await db.authenticate('forged'),null);
    await assert.rejects(db.login('tester','wrong-password'),/账号或密码/);
    await assert.rejects(db.register('tester','test-password-123','重复角色','rookie'),/已存在/);
    await assert.rejects(db.purchase(account.profile.id,'keyboard'),/积分不足/);
    const rewards = await Promise.all([db.reward(account.profile.id,'run-a'),db.reward(account.profile.id,'run-a')]);
    assert.equal(rewards.filter(r=>r.awarded).length,1);
    assert.equal((await db.profile(account.profile.id)).coins,110);
    await Promise.all([db.purchase(account.profile.id,'keyboard'),db.purchase(account.profile.id,'keyboard')]);
    const result = await db.profile(account.profile.id);
    assert.equal(result.coins,50); assert.equal(result.weapon,'keyboard'); assert.deepEqual(result.owned,['foam','keyboard']); assert.equal(result.clears,1);
    await assert.rejects(db.purchase(account.profile.id,'invented'),/不存在/);
    await db.logout(account.token); assert.equal(await db.authenticate(account.token),null);
  } finally { await db.close(); }
});
