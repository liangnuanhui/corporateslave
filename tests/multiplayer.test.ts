import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import { NPC, NPC_LINES, NPC_MENTION_LINES, CHAT, EMOTES, damageFor, type ChatEvent, type Snapshot, type Profile } from '../shared/game.js';
import { AREAS, corridor, CORRIDOR_ROOMS, canStandAt, doorway, exitAt, roomAt } from '../shared/world/index.js';

const base='http://127.0.0.1:2568';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
// `what` is not decoration: this file has ~30 until() calls and a bare "Condition timed out"
// names none of them, so a flaky run tells you nothing about which step gave up.
async function until(fn:()=>boolean|Promise<boolean>, ms=8000, what='') { const deadline=Date.now()+ms; while(Date.now()<deadline){if(await fn())return;await pause(40);} throw new Error(`Condition timed out after ${ms}ms${what?`: ${what}`:''}`); }
async function start(data:string) {
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:'2568',DATA_DIR:data,DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout?.on('data',d=>logs+=d);child.stderr?.on('data',d=>logs+=d);
  await until(async()=>{if(child.exitCode!==null)throw new Error(logs);try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},15000);
  return child;
}
async function stop(child:ChildProcess){if(child.exitCode!==null)return; const closed=new Promise<void>(r=>child.once('exit',()=>r())); child.kill('SIGTERM');await closed;}
async function leave(room:Room){if(room.connection.isOpen)await room.leave();}
async function register(username:string){ const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'mvp-test-password',name:username,role:'rookie'})});assert.equal(r.status,200);return r.json() as Promise<{token:string;profile:Profile}>; }
function watch(room:Room){const value:{snap?:Snapshot;profile?:Profile;reward?:any;notice?:string;transition?:{to:string;name:string};hits:{id:string;damage:number}[];chats:ChatEvent[]}={hits:[],chats:[]};room.onMessage('*',(type,data)=>{if(type==='snapshot')value.snap=data;else if(type==='profile')value.profile=data;else if(type==='reward')value.reward=data;else if(type==='notice')value.notice=data;else if(type==='transition')value.transition=data;else if(type==='hit')value.hits.push(data);else if(type==='chat')value.chats.push(data);});room.send('sync');return value;}

test('two-player rooms, server combat, unique session, reward replay and disk recovery', {timeout:210000}, async()=>{
  const data=await mkdtemp(join(tmpdir(),'niuma-test-'));let server=await start(data);const rooms:Room[]=[];
  try {
    console.log('integration: server started');
    const a=await register('alpha'),b=await register('bravo');
    const sdk=new Client(base);
    await assert.rejects(sdk.joinOrCreate('world',{zone:'office',token:'fake'}));
    console.log('integration: unauthorized join rejected');
    const ra=await sdk.joinOrCreate('world',{zone:'office',token:a.token}); rooms.push(ra); const va=watch(ra);
    const rb=await new Client(base).joinOrCreate('world',{zone:'office',token:b.token});rooms.push(rb);const vb=watch(rb);
    await until(()=>va.snap?.players.length===2&&vb.snap?.players.length===2);
    assert.equal(ra.roomId,rb.roomId);
    console.log('integration: two players share room');
    await assert.rejects(new Client(base).joinOrCreate('world',{zone:'office',token:a.token}));
    console.log('integration: duplicate rejected');
    const x0=va.snap!.players.find(p=>p.id===a.profile.id)!.x;
    for(let seq=1;seq<15;seq++){ra.send('input',{right:true,seq});await pause(34);}
    await until(()=>vb.snap!.players.find(p=>p.id===a.profile.id)!.x>x0+40);
    ra.send('input',{x:99999,hp:99999,seq:15});await pause(90);
    // Random spawn (Task 4) means player A's area here is not necessarily the corridor, so the
    // bound has to be the current area's own width rather than a corridor-shaped constant.
    const cheated = va.snap!.players.find(p=>p.id===a.profile.id)!;
    assert.ok(cheated.x<AREAS[cheated.area].width);
    console.log(`integration: player A spawned in ${cheated.area}`); // random spawn (Task 4) — visible proof this varies run to run
    // 办公室里那位可打的同事：这段验的是服务器真的把他放进了房间，而且放的位置合法。
    // placeColleague() 每次重抽，单测只能证明抽点函数本身对，证明不了服务器用对了它。
    const npc = va.snap!.enemies.find(e => e.id === NPC.id);
    assert.ok(npc, `办公室里应该有 ${NPC.name}`);
    assert.equal(npc!.name, NPC.name);
    assert.ok(AREAS[npc!.area], `${NPC.name} 的 area「${npc!.area}」不是真实存在的区域`);
    assert.ok(canStandAt(AREAS[npc!.area], npc!.x, npc!.y), `${NPC.name} 被放在了站不住的位置`);
    assert.equal(exitAt(AREAS[npc!.area], npc!.x, npc!.y), undefined, `${NPC.name} 被放在门口触发器上`);
    assert.ok(npc!.hp === npc!.maxHp && npc!.hp >= NPC.hpMin && npc!.hp <= NPC.hpMax, `${NPC.name} 的血量 ${npc!.hp} 不在 ${NPC.hpMin}-${NPC.hpMax} 之间`);
    assert.equal(npc!.hp % NPC.hpStep, 0);
    // 两个客户端看到的必须是同一个他——他是房间的状态，不是各自本地生成的。
    await until(() => vb.snap!.enemies.some(e => e.id === NPC.id && e.hp === npc!.hp && e.area === npc!.area));
    console.log(`integration: ${NPC.name} 出现在 ${AREAS[npc!.area].name}，${npc!.hp} 血`);
    let officeSeq = 15;
    const myself = () => va.snap!.players.find(p => p.id === a.profile.id)!;
    // Read through a function (not `va.transition` directly) — TS narrows a property right after
    // `va.transition = undefined` to the literal `undefined` type and that narrowing survives the
    // intervening `await`s below, which turns a later `va.transition?.to` into a `never` access.
    const transitionOf = () => va.transition;
    const walkTo = async (axis: 'x' | 'y', target: number) => {
      await until(async () => {
        const distance = target - myself()[axis];
        if (Math.abs(distance) < 16) { ra.send('input', { seq: ++officeSeq }); return true; }
        ra.send('input', { left: axis === 'x' && distance < 0, right: axis === 'x' && distance > 0, up: axis === 'y' && distance < 0, down: axis === 'y' && distance > 0, seq: ++officeSeq });
        return false;
      }, 10000, `走到 ${axis}=${target}`);
      await pause(100);
    };
    // The server now actually switches `area` at the door (Task 3), so a player walking into
    // 大会议室/储物间 lands inside that room's own coordinate space rather than resting at the
    // corridor threshold. Cross-client agreement therefore can't be a raw distance check once
    // the two clients are in different areas — a naive `hypot` across coordinate spaces would be
    // meaningless. Instead we assert both clients' own snapshots agree on player A's `area` and
    // (within that area's own space) position.
    const assertAgree = () => {
      const observer = vb.snap!.players.find(p => p.id === a.profile.id)!;
      assert.equal(observer.area, myself().area, '两个客户端看到的 area 不一致');
      assert.ok(Math.hypot(observer.x - myself().x, observer.y - myself().y) < 40, '两个客户端看到的位置偏差过大');
    };
    // Random spawn (Task 4) can land player A inside a room, but the door-by-door loop below
    // navigates in corridor-space coordinates and assumes it starts there. A naive "converge x,
    // then walk y" doesn't generalise: one of 储物间's own spawn points sits exactly centred
    // under a shelf, so aiming straight at the door only oscillates in place (verified by
    // simulation — a single-tick re-decision undoes its own tiny step every other frame). Move
    // both axes at once, like a real player would, and re-decide the horizontal direction only
    // every 15 ticks so a step toward the door can't be cancelled out the very next tick — enough
    // hysteresis to slide around the shelf instead of stalling on its edge.
    const returnToCorridor = async () => {
      await until(() => myself().area !== undefined);
      if (myself().area === 'corridor') return;
      const area = AREAS[myself().area], midX = area.width / 2, exit = area.exits[0], goalY = exit.rect.y + exit.rect.height / 2;
      let decision = { left: false, right: false };
      for (let tick = 0; myself().area !== 'corridor'; tick++) {
        if (tick >= 300) throw new Error(`${area.name} 走不出去`);
        if (tick % 15 === 0) decision = { left: myself().x > midX, right: myself().x <= midX };
        ra.send('input', { ...decision, up: myself().y > goalY, down: myself().y <= goalY, seq: ++officeSeq });
        await pause(34);
      }
    };
    await returnToCorridor();
    for (const room of [...CORRIDOR_ROOMS].sort((a, b) => a.x - b.x)) {
      const door = doorway(room), fromAbove = room.door === 'top';
      const open = room.id === 'meeting' || room.id === 'storage';
      va.notice = undefined; va.transition = undefined;
      await walkTo('x', door.x);
      await walkTo('y', door.y + (fromAbove ? -60 : 60));
      for (let i = 0; i < 20; i++) { ra.send('input', { up: !fromAbove, down: fromAbove, seq: ++officeSeq }); await pause(34); }
      if (open) {
        // Falsifiable by: tryExit never firing (area stays 'corridor'), or firing into the wrong
        // area (exit.to / AREAS lookup wrong), or the exit.at landing point being unreachable.
        await until(() => myself().area === room.id, 10000, `进入${room.name}`);
        assertAgree();
        // Falsifiable by: a renamed field, an id sent in place of the display name (both would
        // desync `to`/`name` from the room's actual id/name), or the message going to the wrong
        // client (va.transition would stay undefined and the `until` above would time out first).
        assert.equal(transitionOf()?.to, room.id, `${room.name} 的 transition.to 应该指向 ${room.id}`);
        assert.equal(transitionOf()?.name, room.name, `${room.name} 的 transition.name 应该是显示名而不是 id`);
        console.log(`integration: entered ${room.name}`);
        // Push through the room's own door for a fixed duration, same technique as the corridor
        // approach above. A coarse walkTo() convergence (16px tolerance) can halt just short of
        // the room's own 26px-tall trigger band without ever actually entering it.
        const outward = room.id === 'storage' ? { up: true } : { down: true };
        for (let i = 0; i < 30; i++) { ra.send('input', { ...outward, seq: ++officeSeq }); await pause(34); }
        await until(() => myself().area === 'corridor', 10000, `离开${room.name}`);
        assertAgree();
        console.log(`integration: left ${room.name} back to corridor`);
      } else {
        // Falsifiable by: area actually changing (tryExit not respecting `locked`), or no notice
        // arriving (tryExit never being called at all — asserting area-stayed-corridor alone
        // would pass even with tryExit fully disabled, since a locked room's walls already block
        // entry geometrically).
        assert.equal(myself().area, 'corridor', `${room.name} 不应该能进入`);
        assert.equal(roomAt(myself().x, myself().y), undefined, `${room.name} 不应该被走进去`);
        await until(() => !!va.notice, 10000);
        assert.ok(va.notice!.includes(room.name), `${room.name} 的提示应该点名房间 (got: ${va.notice})`);
        assertAgree();
      }
      await walkTo('y', corridor.spawnPoints[0].y);
    }
    console.log('integration: six rooms entered/exited and synced to second player');
    // 打人这条链路的端到端验证：客户端发 attack → 服务器扣血 → 广播 hit → 两个客户端都看到。
    // 单测只证明了 meleeHits/inMelee 本身对，证明不了这条链路接上了。
    {
      const target = () => va.snap!.enemies.find(e => e.id === NPC.id)!;
      const home = target().area;
      await returnToCorridor();
      if (home !== 'corridor') {
        const slot = CORRIDOR_ROOMS.find(r => r.id === home)!;
        const door = doorway(slot), fromAbove = slot.door === 'top';
        await walkTo('x', door.x);
        await walkTo('y', door.y + (fromAbove ? -60 : 60));
        for (let i = 0; i < 20; i++) { ra.send('input', { up: !fromAbove, down: fromAbove, seq: ++officeSeq }); await pause(34); }
        await until(() => myself().area === home, 10000);
      }
      // 「先对齐 x，再走 y」走不到他：他的落点是随机的，两点之间有没有货架完全不可控，而
      // walkTo 只推一个轴——纵向被货架挡住时它会原地顶 10 秒然后超时。（全量跑三次里中过一次，
      // 报的就是 `走到 y=581.39`：一个算出来的坐标，不是常量。）
      // 两个轴一起推才能贴着障碍物滑过去，因为 moveIn 是分轴判定的：y 被挡住时 x 照样能走。
      // 外加一个卡死检测：人正好在他正上方、中间隔着一个货架时，dx≈0 没有横向分量，
      // 只有强行侧移才出得去。成功条件是「进入半径」而不是「走到某个精确坐标」。
      // 观察到的行为，边走边记——单独等一遍会再花十几秒，而走过去本来就要那么久。
      const seen = { say: new Set<string>(), doing: new Set<string>(), moved: 0 };
      let mark = { x: target().x, y: target().y };
      const observe = () => {
        const t = target();
        if (t.say) seen.say.add(t.say);
        seen.doing.add(t.action);
        const step = Math.hypot(t.x - mark.x, t.y - mark.y);
        if (step > 2) { seen.moved += step; mark = { x: t.x, y: t.y }; }
      };
      // 他现在会自己走动，所以目标每一拍都要重读。「先对齐 x 再走 y」更是走不到：他的落点
      // 随机，两点之间有没有货架完全不可控，而 walkTo 只推一个轴——纵向被挡住时它会原地顶
      // 满 10 秒然后超时（全量跑三次中过一次，报的就是 `走到 y=581.39`，一个算出来的坐标）。
      // 两个轴一起推才能贴着障碍物滑过去，因为 moveIn 是分轴判定的：y 被挡住时 x 照样能走。
      // 卡死时的侧移必须垂直于主要行进方向：人在他正上方、中间隔着一个货架时，dx≈0，
      // 沿 x 让开才出得去；反过来被一排桌子挡住时要沿 y 让开。第一版我朝「远离目标」的方向
      // 侧移，结果是每次卡住就往后退一点，三百拍后离他 395px——比出发时还远。
      const approach = async (within = 26) => {
        let decision = { left: false, right: false }, sidestep = 0, flip = 1;
        let last = { x: myself().x, y: myself().y }, still = 0;
        for (let tick = 0; ; tick++) {
          observe();
          const dx = target().x - myself().x, dy = target().y - myself().y;
          if (Math.hypot(dx, dy) <= within) { ra.send('input', { seq: ++officeSeq }); await pause(60); return; }
          if (tick >= 500) throw new Error(`走不到 ${NPC.name} 身边，还差 (${dx.toFixed(0)},${dy.toFixed(0)})`);
          if (tick % 10 === 0) {
            const moved = Math.hypot(myself().x - last.x, myself().y - last.y);
            still = moved < 4 ? still + 1 : 0;
            last = { x: myself().x, y: myself().y };
            if (still >= 2) { sidestep = 22; flip = -flip; still = 0; }
          }
          if (sidestep > 0) {
            sidestep--;
            const acrossX = Math.abs(dx) <= Math.abs(dy); // 主要在纵向走，就沿横向让开
            ra.send('input', {
              left: acrossX && flip < 0, right: acrossX && flip > 0,
              up: !acrossX && flip < 0, down: !acrossX && flip > 0, seq: ++officeSeq,
            });
            await pause(34); continue;
          }
          if (tick % 15 === 0) decision = { left: dx < -8, right: dx > 8 };
          ra.send('input', { ...decision, up: dy < -8, down: dy > 8, seq: ++officeSeq });
          await pause(34);
        }
      };
      await approach();
      // 把 face 定向到他身上。俯视的 face 只有左右两个值，最后一步往往是纵向的，
      // face 还停在上一次横向的方向上；|dx| < 20 时朝向不影响判定，所以只在他明显偏一侧时推。
      const side = target().x - myself().x;
      if (Math.abs(side) >= 8) for (let i = 0; i < 2; i++) { ra.send('input', { right: side > 0, left: side < 0, seq: ++officeSeq }); await pause(34); }
      const expected = damageFor(a.profile.role, a.profile.weapon);
      const startHp = target().hp;
      va.hits.length = 0; vb.hits.length = 0; va.notice = undefined;
      // 每次挥击前先补上距离——击退会把他推开，真人也是边打边跟上去的。
      const swing = async () => {
        if (Math.hypot(target().x - myself().x, target().y - myself().y) > 26) await approach();
        ra.send('input', { attack: true, seq: ++officeSeq }); await pause(60);
        ra.send('input', { seq: ++officeSeq }); await pause(560);
      };
      await swing();
      assert.equal(target().hp, startHp - expected, `一击应该扣 ${expected} 点血`);
      assert.ok(va.hits.some(h => h.id === NPC.id && h.damage === expected), '攻击者应该收到 hit 广播');
      await until(() => vb.snap!.enemies.find(e => e.id === NPC.id)!.hp === startHp - expected);
      assert.ok(vb.hits.some(h => h.id === NPC.id), '同房间的另一个客户端也要收到 hit 广播');
      console.log(`integration: 一击 ${expected} 点，${NPC.name} 剩 ${target().hp}/${target().maxHp}`);
      // 打到躺平，验证死亡提示与重新出现时的重新抽取。
      for (let i = 0; i < 40 && target().hp > 0; i++) await swing();
      assert.equal(target().hp, 0, `${NPC.name} 应该被打倒`);
      await until(() => !!va.notice && va.notice.includes(NPC.name), 4000);
      assert.ok(va.notice!.includes('躺平'), `倒下时应该有提示 (got: ${va.notice})`);
      const downed = { area: target().area, x: target().x, y: target().y };
      await until(() => target().hp > 0, NPC.respawnMs + 6000);
      const back = target();
      assert.ok(back.hp === back.maxHp && back.hp >= NPC.hpMin && back.hp <= NPC.hpMax, `重新出现时血量 ${back.hp} 越界`);
      assert.ok(canStandAt(AREAS[back.area], back.x, back.y), '重新出现的位置站不住');
      assert.equal(exitAt(AREAS[back.area], back.x, back.y), undefined, '重新出现的位置压在门口触发器上');
      assert.ok(back.area !== downed.area || back.x !== downed.x || back.y !== downed.y, '重新出现时位置没有重新抽过');
      console.log(`integration: ${NPC.name} 在 ${AREAS[back.area].name} 重新上班，${back.hp} 血`);
      // 他自己上班的那部分：会走动、会摆姿势、会说废话。上面走过去、打、等重生的过程里
      // 已经连续采样了十几秒，这里只是把观察结果断言出来，不再另外空等。
      // 采样窗口踩过三次，每次都是同一个形状：**循环的退出条件和后面的断言是两份清单，会漂**。
      //   1) 只等「说过话 + 两种姿势」，他刚出现就说一句、姿势 idle→walk，一拍满足，
      //      循环在他真正迈开腿之前退出，seen.moved 只有 24px；
      //   2) 补上 moved 之后，又漏了「停下来做点什么」——满足前三条时他正在走，
      //      从没观察到 desk/phone/idle，断言挂在 (walk/hurt) 上；
      //   3) 窗口本身也要长过他 4–11 秒的发呆间隔，否则断言是真的、只是没看够。
      // 所以清单只写一份：循环等它全绿，断言逐条报哪一条没绿。两者不可能再对不上。
      const checks: [string, () => boolean][] = [
        ['自己走动过', () => seen.moved > 60],
        ['出现过走动姿势', () => seen.doing.has('walk')],
        ['停下来做过点什么', () => [...seen.doing].some(d => d === 'desk' || d === 'phone' || d === 'idle')],
        ['说过话', () => seen.say.size > 0],
      ];
      const detail = () => `移动 ${seen.moved.toFixed(0)}px，姿势 ${[...seen.doing].join('/')}，说过 ${seen.say.size} 句`;
      for (let i = 0; i < 400 && !checks.every(([, ok]) => ok()); i++) { observe(); await pause(120); }
      for (const [what, ok] of checks) assert.ok(ok(), `${NPC.name} 没有${what}（${detail()}）`);
      // 说的必须是台词表里的句子：服务器要是把别的字段（名字、房间名）当台词发出去，上面
      // 「说过话」那条照样绿。
      for (const line of seen.say) assert.ok(NPC_LINES.includes(line), `说了一句台词表里没有的话：${line}`);
      console.log(`integration: ${NPC.name} 移动 ${seen.moved.toFixed(0)}px，姿势 ${[...seen.doing].join('/')}，说过 ${seen.say.size} 句`);
      // 这一段打完人可能停在任意一个房间里，而后面每一段都假设「人在走廊、用走廊坐标」。
      // 不还原这个前提，后面的 walkTo 会拿走廊坐标去房间的坐标系里走，看起来还一路“成功”。
      await returnToCorridor();
      await walkTo('y', corridor.spawnPoints[0].y);
    }
    // spec: 断线 12 秒内重连回到原 area 原位置. Walk into 大会议室, force a drop, reconnect, and
    // confirm the player is still in area 'meeting' at (nearly) the same room-local position —
    // this has no other coverage (the disk-recovery check further below only reads back profile
    // fields over HTTP and never touches position/area).
    {
      const meetingRoom = CORRIDOR_ROOMS.find(r => r.id === 'meeting')!;
      const meetingDoor = doorway(meetingRoom);
      await walkTo('x', meetingDoor.x);
      await walkTo('y', meetingDoor.y + 60);
      for (let i = 0; i < 20; i++) { ra.send('input', { up: true, seq: ++officeSeq }); await pause(34); }
      await until(() => myself().area === 'meeting', 10000);
      const before = { x: myself().x, y: myself().y };
      // `ra.leave(false)` (consented=false) closes the socket with an abnormal code, and the SDK's
      // Room itself reacts by auto-reconnecting in place (see @colyseus/sdk Room.ts
      // handleReconnection/retryReconnection) — there's no need to call sdk.reconnect() ourselves,
      // and doing so raced the built-in retry for the same reconnectionToken and hung forever.
      // `leave()`'s own returned promise resolves via the room's `onLeave` signal, which this SDK
      // only invokes on final failure/consented-leave, never on a *successful* auto-reconnect — so
      // awaiting it here would hang too. Fire the drop without awaiting it and watch `onReconnect`.
      const reconnected = new Promise<void>(resolve => ra.onReconnect.once(resolve));
      void ra.leave(false).catch(() => {});
      await reconnected;
      va.notice = undefined; va.snap = undefined; // clear pre-drop snapshot so the check below can't pass on stale data
      ra.send('sync');
      await until(() => !!va.snap?.players.find(p => p.id === a.profile.id), 10000);
      const after = va.snap!.players.find(p => p.id === a.profile.id)!;
      assert.equal(after.area, 'meeting', '重连后不在原 area');
      assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 40, '重连后位置漂移过大');
      console.log('integration: reconnect kept the area');
      for (let i = 0; i < 30; i++) { ra.send('input', { down: true, seq: ++officeSeq }); await pause(34); }
      await until(() => myself().area === 'corridor', 10000);
      await walkTo('y', corridor.spawnPoints[0].y);
    }
    ra.send('claim');await until(()=>!!va.notice);
    assert.equal((await fetch(base+'/api/me',{headers:{Authorization:`Bearer ${a.token}`}}).then(r=>r.json())).coins,30);
    await ra.leave();
    const dungeon=await sdk.joinOrCreate('world',{zone:'dungeon',token:a.token});rooms.push(dungeon);const vd=watch(dungeon);
    await until(()=>!!vd.snap&&vb.snap?.players.length===1);
    assert.notEqual(dungeon.roomId,rb.roomId);assert.equal(vd.snap!.enemies.length,3);
    console.log('integration: room isolation confirmed');
    let seq=0;
    const bot=setInterval(()=>{
      const me=vd.snap?.players.find(p=>p.id===a.profile.id), enemy=vd.snap?.enemies.filter(e=>e.hp>0).sort((x,y)=>Math.abs(x.x-(me?.x||0))-Math.abs(y.x-(me?.x||0)))[0];
      if(me&&enemy){const dx=enemy.x-me.x;dungeon.send('input',{left:dx< -65||(dx<0&&me.face>0),right:dx>65||(dx>0&&me.face<0),attack:true,seq:++seq});}
    },34);
    try{await until(()=>vd.snap?.status==='complete',40000);}finally{clearInterval(bot);}
    console.log('integration: combat complete');
    dungeon.send('claim');await until(()=>!!vd.reward);assert.equal(vd.reward.awarded,true);
    vd.reward=undefined;dungeon.send('claim');await until(()=>!!vd.reward);assert.equal(vd.reward.awarded,false);
    await dungeon.leave();const office=await sdk.joinOrCreate('world',{zone:'office',token:a.token});rooms.push(office);const vo=watch(office);
    // The equipment counter lives inside 储物间 (Task 3's shop-area gate). A fresh join now (Task
    // 4) can land in any open area — including already inside 储物间 — so this walks from
    // wherever it actually spawned rather than assuming the corridor.
    {
      await until(() => !!vo.snap);
      const oMe = () => vo.snap!.players.find(p => p.id === a.profile.id)!;
      let oSeq = 0;
      const oWalkTo = async (axis: 'x' | 'y', target: number) => {
        await until(async () => {
          const distance = target - oMe()[axis];
          if (Math.abs(distance) < 16) { office.send('input', { seq: ++oSeq }); return true; }
          office.send('input', { left: axis === 'x' && distance < 0, right: axis === 'x' && distance > 0, up: axis === 'y' && distance < 0, down: axis === 'y' && distance > 0, seq: ++oSeq });
          return false;
        }, 10000, `重新加入后走到 ${axis}=${target}`);
        await pause(100);
      };
      if (oMe().area !== 'storage') {
        if (oMe().area !== 'corridor') {
          // Same reasoning as returnToCorridor() above: move both axes at once with hysteresis
          // on the horizontal decision, since a spawn point can sit dead-centred under a shelf.
          const area = AREAS[oMe().area], midX = area.width / 2, exit = area.exits[0], goalY = exit.rect.y + exit.rect.height / 2;
          let decision = { left: false, right: false };
          for (let tick = 0; oMe().area !== 'corridor'; tick++) {
            if (tick >= 300) throw new Error(`${area.name} 走不出去`);
            if (tick % 15 === 0) decision = { left: oMe().x > midX, right: oMe().x <= midX };
            office.send('input', { ...decision, up: oMe().y > goalY, down: oMe().y <= goalY, seq: ++oSeq });
            await pause(34);
          }
        }
        const storageDoor = doorway(CORRIDOR_ROOMS.find(r => r.id === 'storage')!); // door: 'top' — corridor is above, so entry means increasing y
        await oWalkTo('x', storageDoor.x);
        await oWalkTo('y', storageDoor.y - 60);
        for (let i = 0; i < 20; i++) { office.send('input', { down: true, seq: ++oSeq }); await pause(34); }
        await until(() => oMe().area === 'storage', 10000, '重新加入后进入储物间');
      }
    }
    office.send('shop',{weapon:'keyboard'});await until(()=>vo.profile?.weapon==='keyboard');
    assert.equal(vo.profile!.coins,50);
    await office.leave();await rb.leave();await stop(server);
    server=await start(data);
    const restored=await fetch(base+'/api/me',{headers:{Authorization:`Bearer ${a.token}`}}).then(r=>r.json());
    assert.equal(restored.weapon,'keyboard');assert.equal(restored.coins,50);assert.equal(restored.clears,1);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alpha',password:'mvp-test-password'})});assert.equal(login.status,200);
  } finally {for(const room of rooms){try{await leave(room);}catch{}}await stop(server);await rm(data,{recursive:true,force:true});}
});

test('chat: 全楼层广播、限流、表情查表、超长截断', {timeout:120000}, async()=>{
  const data=await mkdtemp(join(tmpdir(),'niuma-chat-'));const server=await start(data);const rooms:Room[]=[];
  try {
    const a=await register('chatty'),b=await register('listener');
    const sdk=new Client(base);
    const ra=await sdk.joinOrCreate('world',{zone:'office',token:a.token});rooms.push(ra);const va=watch(ra);
    const rb=await new Client(base).joinOrCreate('world',{zone:'office',token:b.token});rooms.push(rb);const vb=watch(rb);
    await until(()=>va.snap?.players.length===2&&vb.snap?.players.length===2,8000,'两人进同一个房间');

    // 只看 a 说的话。下一个任务会让刘正超也往这条通道广播，按总数/下标写的断言
    // 到那时会被他的台词随机打红。
    const mine = () => vb.chats.filter(c => c.id === a.profile.id);

    // 办公室的出生点是随机撒在corridor/meeting/storage三个区域的（server/world.ts 的
    // pickSpawn），下面「a 必须还在走廊」的断言需要 a 先站在一个已知区域，否则本测试本身
    // 就有约 2/3 概率在开局刷假红。先把 a 走回走廊，走法与本文件 :342-360 处理「重新加入
    // 可能落在任意区域」是同一个问题、同一种修法。
    const aMe=()=>va.snap!.players.find(p=>p.id===a.profile.id)!;
    let aSeq=0;
    if(aMe().area!=='corridor'){
      const area=AREAS[aMe().area],midX=area.width/2,exit=area.exits[0],goalY=exit.rect.y+exit.rect.height/2;
      let decision={left:false,right:false};
      for(let tick=0;aMe().area!=='corridor';tick++){
        if(tick>=300)throw new Error(`${area.name} 走不出去（a）`);
        if(tick%15===0)decision={left:aMe().x>midX,right:aMe().x<=midX};
        ra.send('input',{...decision,up:aMe().y>goalY,down:aMe().y<=goalY,seq:++aSeq});
        await pause(34);
      }
      await until(()=>aMe().area==='corridor',5000,'a 走不回走廊');
    }

    // 把 b 挪进储物间，验证「全楼层」而不是「同房间」——这是本轮的核心决定，
    // 两个人恰好同区时测出来的「收到了」证明不了任何事。
    // 走法照抄本文件 :342-360 已有的那段：两个轴一起推，横向决策带迟滞——
    // 单轴推进被家具挡住时会原地顶满超时，这个坑 PLAN.md 记过。
    const bMe=()=>vb.snap!.players.find(p=>p.id===b.profile.id)!;
    let bSeq=0;
    if(bMe().area!=='corridor'){
      const area=AREAS[bMe().area],midX=area.width/2,exit=area.exits[0],goalY=exit.rect.y+exit.rect.height/2;
      let decision={left:false,right:false};
      for(let tick=0;bMe().area!=='corridor';tick++){
        if(tick>=300)throw new Error(`${area.name} 走不出去`);
        if(tick%15===0)decision={left:bMe().x>midX,right:bMe().x<=midX};
        rb.send('input',{...decision,up:bMe().y>goalY,down:bMe().y<=goalY,seq:++bSeq});
        await pause(34);
      }
    }
    const storageDoor=doorway(CORRIDOR_ROOMS.find(r=>r.id==='storage')!); // door:'top' —— 走廊在上方，进门是 y 变大
    for(let tick=0;Math.abs(bMe().x-storageDoor.x)>8;tick++){
      if(tick>=400)throw new Error('走不到储物间门口的 x');
      rb.send('input',{left:bMe().x>storageDoor.x,right:bMe().x<storageDoor.x,seq:++bSeq});
      await pause(34);
    }
    for(let tick=0;Math.abs(bMe().y-(storageDoor.y-60))>8;tick++){
      if(tick>=400)throw new Error('走不到储物间门口的 y');
      rb.send('input',{up:bMe().y>storageDoor.y-60,down:bMe().y<storageDoor.y-60,seq:++bSeq});
      await pause(34);
    }
    for(let i=0;i<20;i++){rb.send('input',{down:true,seq:++bSeq});await pause(34);}
    await until(()=>bMe().area==='storage',10000,'b 进不了储物间');
    assert.equal(va.snap!.players.find(p=>p.id===a.profile.id)!.area,'corridor','a 必须还在走廊，否则这条测的不是跨房间');

    vb.chats.length=0;
    ra.send('chat',{text:'今天几点下班'});
    await until(()=>mine().some(c=>c.text==='今天几点下班'),5000,'隔着房间也收得到');
    const got=mine().find(c=>c.text==='今天几点下班')!;
    assert.equal(got.id,a.profile.id);
    assert.equal(got.kind,'say');
    assert.ok(got.ms>=CHAT.minMs&&got.ms<=CHAT.maxMs,`气泡时长越界：${got.ms}`);

    // 限流：紧接着再发一条，不产生第二个事件
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{text:'第一条'});ra.send('chat',{text:'第二条'});
    await until(()=>mine().some(c=>c.text==='第一条'),5000,'第一条要到');
    await pause(400);
    assert.equal(mine().filter(c=>c.text==='第二条').length,0,'限流没拦住连发');

    // 表情：客户端只发 id，文案由服务器查表
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{emote:'wave'});
    await until(()=>mine().length>0,5000,'表情要到');
    assert.equal(mine()[0].text,EMOTES.find(e=>e.id==='wave')!.text);
    assert.equal(mine()[0].kind,'emote');

    // 超长：服务器截断到 40 码点
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{text:'超'.repeat(200)});
    await until(()=>mine().length>0,5000,'超长消息要到');
    assert.equal([...mine()[0].text].length,CHAT.maxChars);

    // 畸形消息：一条都不该广播，服务器也不该崩
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    for(const bad of [{},{text:'   '},{text:''},{emote:'不存在'},{emote:42},{text:null},'裸字符串',null]) ra.send('chat',bad as any);
    await pause(900);
    assert.equal(mine().length,0,`畸形消息被广播了：${JSON.stringify(vb.chats)}`);
    assert.ok((await fetch(base+'/api/health')).ok,'服务器被畸形消息打挂了');

    // text 与 emote 同时给：只认 emote，且只广播一条
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{text:'偷渡的文本',emote:'clap'});
    await until(()=>mine().length>0,5000,'混合消息要有一条');
    await pause(400);
    assert.equal(mine().length,1,'混合消息广播了不止一条');
    assert.equal(mine()[0].text,EMOTES.find(e=>e.id==='clap')!.text);
  } finally { for(const r of rooms)await leave(r); await stop(server); await rm(data,{recursive:true,force:true}); }
});
