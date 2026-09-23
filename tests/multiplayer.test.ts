import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import type { Snapshot, Profile } from '../shared/game.js';
import { AREAS, corridor, CORRIDOR_ROOMS, doorway, roomAt } from '../shared/world/index.js';

const base='http://127.0.0.1:2568';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function until(fn:()=>boolean|Promise<boolean>, ms=8000) { const deadline=Date.now()+ms; while(Date.now()<deadline){if(await fn())return;await pause(40);} throw new Error('Condition timed out'); }
async function start(data:string) {
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,PORT:'2568',DATA_DIR:data,DATABASE_URL:''},stdio:['ignore','pipe','pipe']});
  let logs=''; child.stdout?.on('data',d=>logs+=d);child.stderr?.on('data',d=>logs+=d);
  await until(async()=>{if(child.exitCode!==null)throw new Error(logs);try{return (await fetch(base+'/api/health')).ok;}catch{return false;}},15000);
  return child;
}
async function stop(child:ChildProcess){if(child.exitCode!==null)return; const closed=new Promise<void>(r=>child.once('exit',()=>r())); child.kill('SIGTERM');await closed;}
async function leave(room:Room){if(room.connection.isOpen)await room.leave();}
async function register(username:string){ const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'mvp-test-password',name:username,role:'rookie'})});assert.equal(r.status,200);return r.json() as Promise<{token:string;profile:Profile}>; }
function watch(room:Room){const value:{snap?:Snapshot;profile?:Profile;reward?:any;notice?:string;transition?:{to:string;name:string}}={};room.onMessage('*',(type,data)=>{if(type==='snapshot')value.snap=data;else if(type==='profile')value.profile=data;else if(type==='reward')value.reward=data;else if(type==='notice')value.notice=data;else if(type==='transition')value.transition=data;});room.send('sync');return value;}

test('two-player rooms, server combat, unique session, reward replay and disk recovery', {timeout:90000}, async()=>{
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
      }, 10000);
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
        await until(() => myself().area === room.id, 10000);
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
        await until(() => myself().area === 'corridor', 10000);
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
        }, 10000);
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
        await until(() => oMe().area === 'storage', 10000);
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
