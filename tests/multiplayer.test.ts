import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, type Room } from '@colyseus/sdk';
import type { Snapshot, Profile } from '../shared/game.js';
import { corridor, CORRIDOR_ROOMS, doorway, roomAt } from '../shared/world/index.js';

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
function watch(room:Room){const value:{snap?:Snapshot;profile?:Profile;reward?:any;notice?:string}={};room.onMessage('*',(type,data)=>{if(type==='snapshot')value.snap=data;else if(type==='profile')value.profile=data;else if(type==='reward')value.reward=data;else if(type==='notice')value.notice=data;});room.send('sync');return value;}

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
    assert.ok(va.snap!.players.find(p=>p.id===a.profile.id)!.x<1280);
    let officeSeq = 15;
    const myself = () => va.snap!.players.find(p => p.id === a.profile.id)!;
    const walkTo = async (axis: 'x' | 'y', target: number) => {
      await until(async () => {
        const distance = target - myself()[axis];
        if (Math.abs(distance) < 16) { ra.send('input', { seq: ++officeSeq }); return true; }
        ra.send('input', { left: axis === 'x' && distance < 0, right: axis === 'x' && distance > 0, up: axis === 'y' && distance < 0, down: axis === 'y' && distance > 0, seq: ++officeSeq });
        return false;
      }, 10000);
      await pause(100);
    };
    // Room interiors are now sealed area footprints (see shared/world/corridor.ts) rather than
    // open corridor floor, so this no longer walks players INTO each room. It asserts both
    // halves of the new behavior: the doorway is still reachable (this fails if the
    // ROOM_INTERIORS clearance regresses to WALL_SIZE — see the CLEARANCE comment in
    // corridor.ts, the player then halts short of the threshold) and entry is blocked, with a
    // discriminating cross-client sync check so a frozen/broken sync path can't pass silently.
    for (const room of [...CORRIDOR_ROOMS].sort((a, b) => a.x - b.x)) {
      const door = doorway(room), fromAbove = room.door === 'top';
      await walkTo('x', door.x);
      await walkTo('y', door.y + (fromAbove ? -60 : 60));
      for (let i = 0; i < 20; i++) { ra.send('input', { up: !fromAbove, down: fromAbove, seq: ++officeSeq }); await pause(34); }
      await until(() => {
        const observer = vb.snap!.players.find(p => p.id === a.profile.id)!;
        return Math.hypot(observer.x - myself().x, observer.y - myself().y) < 40;
      });
      const observer = vb.snap!.players.find(p => p.id === a.profile.id)!;
      // Measured empirically: halts ~1.7px from door.y with CLEARANCE=14, ~5.6px with the
      // brief's original WALL_SIZE=12 — tolerance 4 sits cleanly between the two.
      assert.ok(Math.abs(myself().y - door.y) < 4, `${room.name} 应该能走到门口 (y=${myself().y.toFixed(2)}, door.y=${door.y})`);
      assert.equal(roomAt(myself().x, myself().y), undefined, `${room.name} 不应该被走进去`);
      assert.ok(Math.hypot(observer.x - myself().x, observer.y - myself().y) < 40, `${room.name} 观察者同步的位置偏差过大`);
      await walkTo('y', corridor.spawnPoints[0].y);
      assert.equal(roomAt(myself().x, myself().y), undefined);
    }
    console.log('integration: six rooms entered/exited and synced to second player');
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
    office.send('shop',{weapon:'keyboard'});await until(()=>vo.profile?.weapon==='keyboard');
    assert.equal(vo.profile!.coins,50);
    await office.leave();await rb.leave();await stop(server);
    server=await start(data);
    const restored=await fetch(base+'/api/me',{headers:{Authorization:`Bearer ${a.token}`}}).then(r=>r.json());
    assert.equal(restored.weapon,'keyboard');assert.equal(restored.coins,50);assert.equal(restored.clears,1);
    const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'alpha',password:'mvp-test-password'})});assert.equal(login.status,200);
  } finally {for(const room of rooms){try{await leave(room);}catch{}}await stop(server);await rm(data,{recursive:true,force:true});}
});
