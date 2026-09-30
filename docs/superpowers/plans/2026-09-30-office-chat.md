# 办公室聊天、表情与刘正超改任领导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 玩家能在办公室里打字说话、用六个表情打招呼，头顶冒气泡、隔壁的话落在小地图上；刘正超从沙包同事改成会点名 PUA 的无能领导。

**Architecture:** 一句话是**事件**不是状态——服务器 `broadcast('chat', …)` 一次，客户端维持一张 `id → { text, kind, until }` 表并自行过期。刘正超现有的 `say` 字段从快照中删除，迁到同一条通道，于是渲染层只认一张表。气泡画在头顶还是画在小地图，按快照里说话者**当前**的 area 每帧重算。

**Tech Stack:** TypeScript · Colyseus 0.18（服务器权威） · Phaser 4.2（canvas 渲染） · `node:test`（`npm test`） · Vite

**Spec:** `docs/superpowers/specs/2026-09-30-office-chat-design.md`

## Global Constraints

- **文案单一定义**：表情文案与 NPC 台词只在 `shared/game.ts` 定义一份，客户端不得重写。规矩同 `ORG_NAME`（`shared/game.ts:15`）。
- **服务器权威**：客户端只发意图（`{ text }` 或 `{ emote }`），净化、截断、限流、查表、点名填充全部在服务器。
- **消息长度上限 40 码点**，按码点切（`[...text].slice(0, 40).join('')`），不得用 `String.slice`。
- **限流 1200 ms**，超出静默丢弃，不回 notice。
- **气泡时长** `bubbleMs`：`2500 + 150 × 字数`，夹在 `[3000, 9000]`。
- **PC only**：不新增任何移动端代码路径（沿用 `2026-09-23` spec 的范围变更）。
- **中文注释**记录规则而非数值——沿用仓库既有风格（见 `shared/game.ts:42-44`）。
- 每个任务结束时 `npm test` 必须全绿（当前基线 38 条）。
- Commit message 用中文，结尾附 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`。

## Review Focus

spec 蕴含但没有任何任务自然会去测的五类输入，按「最可能咬到真实用户」排序。每条都已把测试挂进拥有那段代码的任务：

1. **昵称里带 `<` 或 `"` 被点名后进 SVG `innerHTML`** —— 小地图气泡是 `innerHTML` 拼接（`src/map-panel.ts:112`），聊天文本是第一个流到那里的用户可控字符串。期望：标记里出现的是转义后的实体，不是可执行标签。→ Task 8
2. **昵称里带 `$&` 或 `$'`** —— `String.prototype.replace` 的字符串替换参数会把 `$&` 当成「匹配到的内容」展开。一个把自己起名叫 `$&` 的玩家会让点名句出现字面量 `{name}`。期望：昵称原样出现。→ Task 2
3. **说话者在气泡存活期间穿过一道门** —— 气泡活 3–9 秒，足够跨 area。期望：气泡跟着他走，从头顶转到小地图或反过来，不残留在旧位置。→ Task 5
4. **玩家在自己气泡还活着时离开房间** —— 表里留下指向已销毁精灵的悬挂条目。期望：不抛异常，条目随快照里人消失而被忽略并最终过期。→ Task 5
5. **畸形聊天消息**：`{}`、`{ text: '   ' }`、`{ emote: '不存在' }`、`{ text: 'hi', emote: 'wave' }` 同时给。期望：服务器一条都不广播，也不抛错。→ Task 3

---

## Task 1: 共享层纯函数 —— 净化、时长、表情表

**Files:**
- Modify: `shared/game.ts`（在 `nextDoing()` 之后追加）
- Test: `tests/chat.test.ts`（新建）

**Interfaces:**
- Consumes: 无（纯函数，不依赖任何既有代码）
- Produces:
  - `type EmoteId = 'wave' | 'clap' | 'sigh' | 'nod' | 'shrug' | 'busy'`
  - `const EMOTES: readonly { id: EmoteId; key: string; slash: string; text: string }[]`
  - `const CHAT: { maxChars: 40; minMs: 3000; maxMs: 9000; baseMs: 2500; perCharMs: 150; cooldownMs: 1200 }`
  - `function sanitizeChat(raw: unknown): string | undefined`
  - `function bubbleMs(text: string): number`
  - `interface ChatEvent { id: string; text: string; kind: 'say' | 'emote'; ms: number }`

- [ ] **Step 1: 写失败的测试**

新建 `tests/chat.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChat, bubbleMs, EMOTES, CHAT } from '../shared/game.js';

test('sanitizeChat 去掉换行与控制字符', () => {
  assert.equal(sanitizeChat('上\n下'), '上 下');
  assert.equal(sanitizeChat('前\u0007后'), '前后');
});

test('sanitizeChat 折叠连续空白并去掉首尾', () => {
  assert.equal(sanitizeChat('  你好    世界  '), '你好 世界');
});

test('sanitizeChat 对空白与非字符串返回 undefined', () => {
  assert.equal(sanitizeChat('     '), undefined);
  assert.equal(sanitizeChat(''), undefined);
  assert.equal(sanitizeChat(undefined), undefined);
  assert.equal(sanitizeChat(42), undefined);
});

test('sanitizeChat 按码点截断，不切开代理对', () => {
  // '👍'.length === 2。用 String.slice 实现会在这里切出半个代理对，
  // 屏幕上是一个乱码方块——所以断言的是码点数，以及末位仍是完整的那个字符。
  const long = '👍'.repeat(60);
  const out = sanitizeChat(long)!;
  assert.equal([...out].length, CHAT.maxChars);
  assert.equal(out, '👍'.repeat(CHAT.maxChars));
  assert.ok(!/[\uD800-\uDFFF]$/.test(out) || out.endsWith('👍'), '末尾不能是孤立代理项');
});

test('bubbleMs 随字数增长，并被上下界夹住', () => {
  assert.equal(bubbleMs('短'), CHAT.minMs);
  assert.equal(bubbleMs('长'.repeat(200)), CHAT.maxMs);
  const ten = bubbleMs('字'.repeat(10)), twenty = bubbleMs('字'.repeat(20));
  assert.ok(twenty > ten, '更长的句子应该挂更久');
  assert.equal(ten, CHAT.baseMs + 10 * CHAT.perCharMs);
});

test('bubbleMs 按码点数算，一个 emoji 是一个字', () => {
  assert.equal(bubbleMs('👍'.repeat(10)), bubbleMs('字'.repeat(10)));
});

test('EMOTES 的键、命令、id 三者都不重复', () => {
  for (const field of ['id', 'key', 'slash'] as const) {
    const values = EMOTES.map(e => e[field]);
    assert.equal(new Set(values).size, EMOTES.length, `${field} 有重复`);
  }
});

test('EMOTES 的命令都以斜杠开头，文案都用全角括号包住', () => {
  for (const e of EMOTES) {
    assert.ok(e.slash.startsWith('/'), `${e.id} 的命令没有斜杠`);
    assert.match(e.text, /^（.+）$/, `${e.id} 的文案不是动作描述`);
  }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/chat.test.ts`
Expected: FAIL —— `sanitizeChat is not a function`（或 TS 报找不到导出）

- [ ] **Step 3: 实现**

在 `shared/game.ts` 末尾追加：

```ts
/** 一句话的规矩。全部在服务器执行——客户端也挡一道，但那只是少发一个包，不是信任边界。 */
export const CHAT = {
  maxChars: 40,      // 气泡限宽 240px、40 字正好三行
  baseMs: 2500, perCharMs: 150,  // 中文阅读约每秒 5–8 字，斜率照此
  minMs: 3000, maxMs: 9000,
  cooldownMs: 1200,
} as const;

export interface ChatEvent { id: string; text: string; kind: 'say' | 'emote'; ms: number }

export type EmoteId = 'wave' | 'clap' | 'sigh' | 'nod' | 'shrug' | 'busy';
/** 数字键和斜杠命令读同一张表，所以「双入口」不会漂成两份文案。 */
export const EMOTES = [
  { id: 'wave',  key: '1', slash: '/挥手', text: '（挥了挥手）' },
  { id: 'clap',  key: '2', slash: '/鼓掌', text: '（鼓了鼓掌）' },
  { id: 'sigh',  key: '3', slash: '/叹气', text: '（叹了口气）' },
  { id: 'nod',   key: '4', slash: '/点头', text: '（点了点头）' },
  { id: 'shrug', key: '5', slash: '/摊手', text: '（摊开双手）' },
  { id: 'busy',  key: '6', slash: '/忙',   text: '（疯狂敲键盘，假装很忙）' },
] as const satisfies readonly { id: EmoteId; key: string; slash: string; text: string }[];

/** 截断必须按码点：'👍'.length === 2，用 slice 会从代理对中间切开，屏幕上是一个乱码方块。 */
export function sanitizeChat(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // 换行会把气泡撑成怪形状；其余控制字符直接丢掉，不留空格。
  const flat = raw.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  const text = flat.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return [...text].slice(0, CHAT.maxChars).join('');
}

export function bubbleMs(text: string): number {
  const chars = [...text].length;
  return Math.min(CHAT.maxMs, Math.max(CHAT.minMs, CHAT.baseMs + chars * CHAT.perCharMs));
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test tests/chat.test.ts`
Expected: PASS，8 条全绿

- [ ] **Step 5: 反向验证码点截断那条**

临时把 `sanitizeChat` 最后一行改成 `return text.slice(0, CHAT.maxChars);`，重跑。
Expected: 「按码点截断」那条 FAIL（`[...out].length` 是 20 而不是 40）。确认后改回。

这一步不能省：这条测试是本任务唯一一条「实现换个写法就会静默变错」的断言，不反向验一次就不知道它真的在盯着。

- [ ] **Step 6: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 38 + 8 = 46 条全绿，tsc 无输出

- [ ] **Step 7: Commit**

```bash
git add shared/game.ts tests/chat.test.ts
git commit -m "feat: 聊天的共享规矩——净化、气泡时长、六个表情

截断按码点切，不按 UTF-16 码元：'👍'.length 是 2，slice 会切出半个字符。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: 刘正超的台词与点名模板

**Files:**
- Modify: `shared/game.ts`（替换 `NPC_LINES`，追加 `pickLine()`）
- Test: `tests/chat.test.ts`（追加）
- Test: `tests/npc.test.ts:4`（改 import —— 该文件已 import `NPC_LINES`）

**Interfaces:**
- Consumes: Task 1 的 `sanitizeChat`（不直接调用，但同文件）
- Produces:
  - `const NPC_LINES: readonly string[]` —— 不含 `{name}` 的三类台词
  - `const NPC_MENTION_LINES: readonly string[]` —— 含 `{name}` 的点名台词
  - `function pickLine(names: readonly string[], random?: () => number): string`

- [ ] **Step 1: 写失败的测试**

追加到 `tests/chat.test.ts`：

```ts
import { NPC_LINES, NPC_MENTION_LINES, pickLine } from '../shared/game.js';

test('没有人在线时，抽不到点名句', () => {
  // random 固定为 0.99，让实现里「先决定要不要点名」那一掷必定倾向点名；
  // 名单为空时仍然必须退回普通台词，而不是点一个叫 undefined 的同事。
  for (const r of [0, .25, .5, .75, .99]) {
    const line = pickLine([], () => r);
    assert.ok(NPC_LINES.includes(line), `名单为空却抽到了 ${line}`);
    assert.ok(!line.includes('{name}'), '模板没有被替换就发出去了');
  }
});

test('有人在线时，点名句里的 {name} 被换成在线昵称之一', () => {
  const names = ['摸鱼小王', '咖啡不加班'];
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(pickLine(names));
  const mentions = [...seen].filter(l => names.some(n => l.includes(n)));
  assert.ok(mentions.length > 0, '四百次一次都没点名');
  for (const line of seen) assert.ok(!line.includes('{name}'), `${line} 里的模板没被替换`);
});

test('昵称里的 $& 原样出现，不被 replace 当成匹配内容展开', () => {
  // String.prototype.replace 的字符串替换参数里，$& 表示「匹配到的内容」。
  // 一个把自己起名叫 $& 的玩家，会让点名句里冒出字面量 {name}。必须用替换函数。
  const line = pickLine(['$&'], () => .99);
  if (NPC_MENTION_LINES.some(t => t.replace('{name}', 'X') === line.replace('$&', 'X'))) {
    assert.ok(line.includes('$&'), `昵称被展开了：${line}`);
    assert.ok(!line.includes('{name}'), `模板残留：${line}`);
  }
});

test('点名模板都含 {name}，普通台词都不含', () => {
  for (const t of NPC_MENTION_LINES) assert.ok(t.includes('{name}'), `${t} 不是模板`);
  for (const l of NPC_LINES) assert.ok(!l.includes('{name}'), `${l} 不该含模板`);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/chat.test.ts`
Expected: FAIL —— `NPC_MENTION_LINES` / `pickLine` 未导出

- [ ] **Step 3: 实现**

把 `shared/game.ts:76-88` 的 `NPC_LINES` 整块替换为：

```ts
/** 他是个压着下属、毫无能力也毫无管理经验的领导。台词锁在「无能 / 甩锅 / 踢皮球」上——
 *  不碰性别、地域、外貌。被点名的是真实用户自己起的昵称，玩笑和冒犯之间就隔着这条线。
 *  句子本身是这个游戏的笑点，所以放在共享层，客户端不重写一份。 */
export const NPC_LINES = [
  // 甩锅
  '我不干事情的，我就是个传话的。',
  '这个我不会啊，你们谁懂谁来。',
  '出了问题别找我，我当时就提过风险。',
  // 画饼
  '这些都在我脑子里，我理一理再跟你们说。',
  '今年把这块做起来，明年就好办了。',
  // 踢皮球
  '大家想想怎么做啊，我听听。',
  '这个得拉个群对齐一下。',
  '你们先做吧，我下午还有事。',
  '先按你的想法来，出了事我们再说。',
] as const;

/** 点名句。{name} 由服务器用全楼层在线玩家的昵称填充。 */
export const NPC_MENTION_LINES = [
  '这个 {name} 处理一下。',
  '{name} 你说说，这个怎么弄。',
  '{name} 辛苦一下，今天之内。',
  '{name} 你年轻，多担待点。',
] as const;

/** 他这次说什么。三成概率点名，但**名单为空时整类跳过**——这不是新发明：走廊没有工位，
 *  spotAtDesk(corridor) 返回 undefined，抽到「回工位」就退化成「玩手机」。同样地，
 *  没人可点就不点，而不是点一个叫 undefined 的同事。 */
export function pickLine(names: readonly string[], random: () => number = Math.random): string {
  if (names.length && random() < .3) {
    const template = NPC_MENTION_LINES[Math.floor(random() * NPC_MENTION_LINES.length)];
    const name = names[Math.floor(random() * names.length)];
    // 替换函数，不是字符串：字符串参数里的 $& 会被当成「匹配到的内容」展开，
    // 于是一个叫 $& 的玩家能让点名句里冒出字面量 {name}。
    return template.replace('{name}', () => name);
  }
  return NPC_LINES[Math.floor(random() * NPC_LINES.length)];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test tests/chat.test.ts`
Expected: PASS

- [ ] **Step 5: 修既有测试与调用点**

`tests/npc.test.ts` 与 `tests/multiplayer.test.ts` 都 import 了 `NPC_LINES`。

Run: `npx tsx --test tests/npc.test.ts tests/multiplayer.test.ts 2>&1 | head -40`

若有断言依赖旧句子（例如硬编码「这个需求我下周再看。」），改为断言 `NPC_LINES.includes(...)` 这类不钉死具体文案的形式。**不要**为了让旧断言通过而保留旧句子。

- [ ] **Step 6: 反向验证 `$&` 那条**

临时把 `template.replace('{name}', () => name)` 改回 `template.replace('{name}', name)`，重跑 `tests/chat.test.ts`。
Expected: 「昵称里的 $& 原样出现」FAIL。确认后改回。

- [ ] **Step 7: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 8: Commit**

```bash
git add shared/game.ts tests/chat.test.ts tests/npc.test.ts tests/multiplayer.test.ts
git commit -m "feat: 刘正超改任领导——甩锅、画饼、踢皮球，外加点名

没人在线就不点名，而不是点一个叫 undefined 的同事——和走廊没工位时
退化成「玩手机」是同一个套路。替换用函数不用字符串，否则叫 \$& 的玩家
能让模板漏出来。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: 服务器聊天通道

**Files:**
- Modify: `server/world.ts:9`（`Player` 接口加 `chatAt`）
- Modify: `server/world.ts:45`（`onJoin` 初始化 `chatAt`——实际在建 Player 的那处）
- Modify: `server/world.ts:49-58`（`onCreate` 里注册 `onMessage('chat')`）
- Test: `tests/multiplayer.test.ts`（追加一个独立 test 块）

**Interfaces:**
- Consumes: Task 1 的 `sanitizeChat`、`bubbleMs`、`EMOTES`、`CHAT`、`ChatEvent`
- Produces: 房间广播 `chat` 事件，载荷即 `ChatEvent`；私有方法 `private say(id: string, text: string, kind: 'say' | 'emote')`

- [ ] **Step 1: 写失败的测试**

先改两处基础设施。

`tests/multiplayer.test.ts:8` 的 import 改为：

```ts
import { NPC, NPC_LINES, NPC_MENTION_LINES, CHAT, EMOTES, damageFor, type ChatEvent, type Snapshot, type Profile } from '../shared/game.js';
```

`tests/multiplayer.test.ts:25` 的 `watch()` 改为（加 `chats` 收集器）：

```ts
function watch(room:Room){const value:{snap?:Snapshot;profile?:Profile;reward?:any;notice?:string;transition?:{to:string;name:string};hits:{id:string;damage:number}[];chats:ChatEvent[]}={hits:[],chats:[]};room.onMessage('*',(type,data)=>{if(type==='snapshot')value.snap=data;else if(type==='profile')value.profile=data;else if(type==='reward')value.reward=data;else if(type==='notice')value.notice=data;else if(type==='transition')value.transition=data;else if(type==='hit')value.hits.push(data);else if(type==='chat')value.chats.push(data);});room.send('sync');return value;}
```

然后追加到 `tests/multiplayer.test.ts` 末尾：

```ts
test('chat: 全楼层广播、限流、表情查表、超长截断', {timeout:120000}, async()=>{
  const data=await mkdtemp(join(tmpdir(),'niuma-chat-'));const server=await start(data);const rooms:Room[]=[];
  try {
    const a=await register('chatty'),b=await register('listener');
    const sdk=new Client(base);
    const ra=await sdk.joinOrCreate('world',{zone:'office',token:a.token});rooms.push(ra);const va=watch(ra);
    const rb=await new Client(base).joinOrCreate('world',{zone:'office',token:b.token});rooms.push(rb);const vb=watch(rb);
    await until(()=>va.snap?.players.length===2&&vb.snap?.players.length===2,8000,'两人进同一个房间');

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
    await until(()=>vb.chats.some(c=>c.text==='今天几点下班'),5000,'隔着房间也收得到');
    const got=vb.chats.find(c=>c.text==='今天几点下班')!;
    assert.equal(got.id,a.profile.id);
    assert.equal(got.kind,'say');
    assert.ok(got.ms>=CHAT.minMs&&got.ms<=CHAT.maxMs,`气泡时长越界：${got.ms}`);

    // 限流：紧接着再发一条，不产生第二个事件
    vb.chats.length=0;
    ra.send('chat',{text:'第一条'});ra.send('chat',{text:'第二条'});
    await until(()=>vb.chats.some(c=>c.text==='第一条'),5000,'第一条要到');
    await pause(400);
    assert.equal(vb.chats.filter(c=>c.text==='第二条').length,0,'限流没拦住连发');

    // 表情：客户端只发 id，文案由服务器查表
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{emote:'wave'});
    await until(()=>vb.chats.length>0,5000,'表情要到');
    assert.equal(vb.chats[0].text,EMOTES.find(e=>e.id==='wave')!.text);
    assert.equal(vb.chats[0].kind,'emote');

    // 超长：服务器截断到 40 码点
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{text:'超'.repeat(200)});
    await until(()=>vb.chats.length>0,5000,'超长消息要到');
    assert.equal([...vb.chats[0].text].length,CHAT.maxChars);

    // 畸形消息：一条都不该广播，服务器也不该崩
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    for(const bad of [{},{text:'   '},{text:''},{emote:'不存在'},{emote:42},{text:null},'裸字符串',null]) ra.send('chat',bad as any);
    await pause(900);
    assert.equal(vb.chats.length,0,`畸形消息被广播了：${JSON.stringify(vb.chats)}`);
    assert.ok((await fetch(base+'/api/health')).ok,'服务器被畸形消息打挂了');

    // text 与 emote 同时给：只认 emote，且只广播一条
    await pause(CHAT.cooldownMs);
    vb.chats.length=0;
    ra.send('chat',{text:'偷渡的文本',emote:'clap'});
    await until(()=>vb.chats.length>0,5000,'混合消息要有一条');
    await pause(400);
    assert.equal(vb.chats.length,1,'混合消息广播了不止一条');
    assert.equal(vb.chats[0].text,EMOTES.find(e=>e.id==='clap')!.text);
  } finally { for(const r of rooms)await leave(r); await stop(server); await rm(data,{recursive:true,force:true}); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/multiplayer.test.ts 2>&1 | tail -30`
Expected: FAIL —— 「隔着房间也收得到」超时（服务器还没有 `chat` 处理器）

- [ ] **Step 3: 实现**

`server/world.ts:5` 的 import 补上 `sanitizeChat, bubbleMs, EMOTES, CHAT, type ChatEvent`。

`server/world.ts:9` 的 `Player` 接口末尾加 `; chatAt: number`，并在构造 Player 的地方（约 `server/world.ts:45` 一带，与 `noticeAt` 同处）初始化 `chatAt: 0`。

在 `onCreate` 的 `onMessage('sync', …)`（`server/world.ts:58`）之后追加：

```ts
    this.onMessage('chat', (client, data: unknown) => {
      const p = this.players.get(client.sessionId);
      if (!p || p.dropped) return;
      // 限流在最前：畸形消息也走这条路，否则刷畸形包能绕开冷却去压 CPU。
      // 回一条「说太快了」反而给刷屏者一个可以刷的东西，所以静默丢弃。
      if (this.elapsed - p.chatAt < CHAT.cooldownMs) return;
      const body = (data ?? {}) as { text?: unknown; emote?: unknown };
      // emote 优先：同时给 text 和 emote 时只认 emote，永远只广播一条。
      if (typeof body.emote === 'string') {
        const emote = EMOTES.find(e => e.id === body.emote);
        if (!emote) return;
        p.chatAt = this.elapsed;
        this.say(p.id, emote.text, 'emote');
        return;
      }
      const slash = typeof body.text === 'string' ? EMOTES.find(e => e.slash === body.text.trim()) : undefined;
      if (slash) { p.chatAt = this.elapsed; this.say(p.id, slash.text, 'emote'); return; }
      // 斜杠命令在服务器解析，不在客户端拆——解析器因此只有一个。
      if (typeof body.text === 'string' && body.text.trim().startsWith('/')) {
        p.chatAt = this.elapsed;
        this.clientOf(client.sessionId)?.send('notice', '没有这个表情。可用：' + EMOTES.map(e => e.slash).join(' '));
        return;
      }
      const text = sanitizeChat(body.text);
      if (!text) return;
      p.chatAt = this.elapsed;
      this.say(p.id, text, 'say');
    });
```

并在 `clientOf`（`server/world.ts:199`）旁加：

```ts
  /** 一句话是事件不是状态：只过一次网，客户端自己管过期。快照里不留任何痕迹——
   *  快照每 2 tick 全量重发，把话放进去就等于每秒重复它 15 次。 */
  private say(id: string, text: string, kind: ChatEvent['kind']) {
    this.broadcast('chat', { id, text, kind, ms: bubbleMs(text) } satisfies ChatEvent);
  }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test tests/multiplayer.test.ts 2>&1 | tail -30`
Expected: PASS

- [ ] **Step 5: 反向验证「全楼层」那条**

临时把 `say()` 改成只发给同 area 的人（遍历 `this.clients` 过滤），重跑。
Expected: 「隔着房间也收得到」FAIL。确认后改回 `broadcast`。

这条必须验：`broadcast` 天然就是全楼层，测试可能在「什么都没做对」的情况下也通过。

- [ ] **Step 6: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add server/world.ts tests/multiplayer.test.ts
git commit -m "feat: 服务器的聊天通道，全楼层广播

净化、限流、表情查表、斜杠命令解析全在服务器，客户端只发意图。
限流放在最前面，否则刷畸形包能绕开冷却。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: 刘正超迁到同一条通道

**Files:**
- Modify: `shared/game.ts:22`（`Enemy` 删掉 `say?: string`）
- Modify: `server/world.ts:12`（`Colleague` 删掉 `sayUntil`；`say` 由 `Enemy` 继承而来，一并消失）
- Modify: `server/world.ts:229`（`placeColleague` 里清 say 的那行）
- Modify: `server/world.ts:245-250`（`tickColleague` 的说话段）
- Modify: `server/world.ts:294`（`snapshot()` 里 enemies 的 `say` 字段）
- Test: `tests/multiplayer.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `pickLine`；Task 3 的 `this.say(id, text, kind)`
- Produces: 刘正超的发言走 `chat` 事件，`id` 为 `NPC.id`（`'colleague'`）

- [ ] **Step 1: 写失败的测试**

追加到 `tests/multiplayer.test.ts`：

```ts
test('刘正超的话走 chat 事件，快照里不再有 say', {timeout:120000}, async()=>{
  const data=await mkdtemp(join(tmpdir(),'niuma-npc-chat-'));const server=await start(data);const rooms:Room[]=[];
  try {
    const a=await register('audience');
    const ra=await new Client(base).joinOrCreate('world',{zone:'office',token:a.token});rooms.push(ra);const va=watch(ra);
    await until(()=>!!va.snap,8000,'拿到第一份快照');
    // 他每 7–16 秒说一句，等两轮足够。观察窗口短了断言是真的，只是没观察够
    // ——这个坑 PLAN.md 里已经记过一次。
    await until(()=>va.chats.some(c=>c.id===NPC.id),40000,'刘正超一句话都没说');
    const line=va.chats.find(c=>c.id===NPC.id)!;
    assert.equal(line.kind,'say');
    assert.ok(line.ms>=CHAT.minMs&&line.ms<=CHAT.maxMs);
    // 台词要么是普通句原文，要么能匹配上某条点名模板（{name} 处换成任意昵称）。
    const mentionRe=NPC_MENTION_LINES.map(t=>new RegExp('^'+t.split('{name}').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('(.+)')+'$'));
    assert.ok(
      (NPC_LINES as readonly string[]).includes(line.text)||mentionRe.some(re=>re.test(line.text)),
      `陌生台词：${line.text}`,
    );
    assert.ok(!line.text.includes('{name}'),'模板漏出来了');
    // 快照里彻底没有 say 了——留着就是两套机制并存
    for(const e of va.snap!.enemies) assert.equal((e as any).say,undefined,'快照里还带着 say');
  } finally { for(const r of rooms)await leave(r); await stop(server); await rm(data,{recursive:true,force:true}); }
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/multiplayer.test.ts 2>&1 | tail -20`
Expected: FAIL —— 「刘正超一句话都没说」超时（他还在往 `say` 字段里写）

- [ ] **Step 3: 实现**

1. `shared/game.ts:22`：`Enemy` 接口删掉 `; say?: string`。
2. `server/world.ts:12`：`Colleague` 删掉 `sayUntil: number`（`say` 随 `Enemy` 一起没了）。
3. `server/world.ts:11` 的注释改为：`/** 办公室那位同事的私有状态：只有服务器看得见，快照里只出 action。说的话走 chat 事件。 */`
4. `server/world.ts:229`：`npc.say = undefined; npc.sayUntil = 0; npc.sayAt = 0;` → `npc.sayAt = 0;`
5. `server/world.ts:245-250` 整段替换：

```ts
    if (this.elapsed >= npc.sayAt) {
      // 全楼层在线玩家的昵称——他点名只点得到还在公司里的人。
      const names = [...this.players.values()].filter(p => !p.dropped).map(p => p.name);
      this.say(npc.id, pickLine(names), 'say');
      npc.sayAt = this.elapsed + NPC.sayEveryMinMs + Math.random() * (NPC.sayEveryMaxMs - NPC.sayEveryMinMs);
    }
```

（原先的 `if (npc.say && this.elapsed >= npc.sayUntil) npc.say = undefined;` 整行删除——过期改由客户端负责。）

6. `server/world.ts:294`：enemies 的 map 里去掉 `, say: e.say`。
7. `server/world.ts:5` 的 import：`NPC_LINES` 换成 `pickLine`（若 `NPC_LINES` 已无其他用处）。
8. `shared/game.ts` 的 `NPC` 常量里删掉 `sayForMs: 4200`（时长改由 `bubbleMs` 算），`sayEveryMinMs` / `sayEveryMaxMs` 保留。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test tests/multiplayer.test.ts 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: 确认没有遗留引用**

Run: `grep -rn "sayUntil\|sayForMs\|\.say\b" shared/ server/ src/ tests/`
Expected: 只剩 `this.say(` 的调用；任何 `npc.say` / `e.say` / `sayForMs` 残留都要清掉。

- [ ] **Step 6: 全量测试 + 类型检查**

Run: `npm test && npx tsc --noEmit`
Expected: 全绿。**`tsc` 会替你找出所有还在读 `Enemy.say` 的地方**——`src/game.ts:221` 必然报错，但那属于 Task 5；若 Task 5 尚未做，此处临时把 `src/game.ts:221-223` 三行改为 `v.bubble.setVisible(false);` 并在 Task 5 里替换掉。

- [ ] **Step 7: Commit**

```bash
git add shared/game.ts server/world.ts src/game.ts tests/multiplayer.test.ts
git commit -m "refactor: 刘正超的话也走 chat 事件，快照里不再带 say

两套气泡机制并存迟早会漂。时长改由 bubbleMs 按字数算，
服务器端的 sayUntil 随之删除——过期归客户端管。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: 客户端气泡表与头顶渲染

**Files:**
- Create: `src/chat-bubbles.ts`
- Modify: `src/network.ts:44`（转发 `chat` 事件）
- Modify: `src/game.ts:20-22`、`:210`、`:221-223`
- Test: `tests/chat.test.ts`（追加纯函数部分）

**Interfaces:**
- Consumes: Task 1 的 `ChatEvent`、`bubbleMs`
- Produces:
  - `class ChatBubbles { put(e: ChatEvent, now: number): void; get(id: string, now: number): { text: string; kind: 'say' | 'emote' } | undefined; live(now: number): { id: string; text: string; kind: 'say' | 'emote' }[] }`

- [ ] **Step 1: 写失败的测试**

追加到 `tests/chat.test.ts`：

```ts
import { ChatBubbles } from '../src/chat-bubbles.js';

test('气泡到点消失', () => {
  const b = new ChatBubbles();
  b.put({ id: 'p1', text: '在的', kind: 'say', ms: 3000 }, 1000);
  assert.equal(b.get('p1', 3999)?.text, '在的');
  assert.equal(b.get('p1', 4001), undefined);
});

test('同一个人连说两句，后一句顶掉前一句', () => {
  const b = new ChatBubbles();
  b.put({ id: 'p1', text: '第一句', kind: 'say', ms: 9000 }, 0);
  b.put({ id: 'p1', text: '第二句', kind: 'say', ms: 3000 }, 100);
  assert.equal(b.get('p1', 200)?.text, '第二句');
  assert.equal(b.live(200).length, 1, '一个人同时只该有一个气泡');
});

test('live() 只返回没过期的，且按最新在前', () => {
  const b = new ChatBubbles();
  b.put({ id: 'old', text: '旧', kind: 'say', ms: 3000 }, 0);
  b.put({ id: 'mid', text: '中', kind: 'say', ms: 9000 }, 100);
  b.put({ id: 'new', text: '新', kind: 'emote', ms: 9000 }, 200);
  assert.deepEqual(b.live(4000).map(x => x.id), ['new', 'mid']);
});

test('已经离开的人留下的气泡不会让 get 抛错，并最终过期', () => {
  // 玩家在自己气泡还活着时离开房间，表里就留下一条指向已销毁精灵的条目。
  // 渲染层按快照里的人来遍历，所以只要 get/live 不抛错、到点会消失，就没有泄漏。
  const b = new ChatBubbles();
  b.put({ id: 'gone', text: '我先下了', kind: 'say', ms: 3000 }, 0);
  assert.doesNotThrow(() => b.get('gone', 5000));
  assert.equal(b.get('gone', 5000), undefined);
  assert.equal(b.live(5000).length, 0);
  assert.equal(b.size, 0, '过期条目应该被清掉，而不是永远堆着');
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/chat.test.ts`
Expected: FAIL —— 找不到 `src/chat-bubbles.js`

- [ ] **Step 3: 实现 `src/chat-bubbles.ts`**

```ts
import type { ChatEvent } from '../shared/game';

interface Bubble { text: string; kind: ChatEvent['kind']; until: number; at: number }

/** 客户端这边的气泡表。一句话是事件，只过一次网，所以过期由这里负责。
 *  按 id 索引，于是「同一个人连说两句，后一句顶掉前一句」是天然行为，不用写代码。 */
export class ChatBubbles {
  private map = new Map<string, Bubble>();
  get size() { return this.map.size; }

  put(event: ChatEvent, now = performance.now()) {
    this.map.set(event.id, { text: event.text, kind: event.kind, until: now + event.ms, at: now });
  }

  /** 过期的顺手删掉：离开房间的人会留下指向已销毁精灵的条目，不清就一直堆着。 */
  private sweep(now: number) {
    for (const [id, b] of this.map) if (now >= b.until) this.map.delete(id);
  }

  get(id: string, now = performance.now()) {
    this.sweep(now);
    const b = this.map.get(id);
    return b ? { text: b.text, kind: b.kind } : undefined;
  }

  /** 还活着的全部，最新在前——小地图只画得下两条，得先知道哪两条最新。 */
  live(now = performance.now()) {
    this.sweep(now);
    return [...this.map.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id, b]) => ({ id, text: b.text, kind: b.kind }));
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx tsx --test tests/chat.test.ts`
Expected: PASS

- [ ] **Step 5: 接上网络层**

`src/network.ts:44` 之后加一行：

```ts
      room.onMessage('chat', data => this.emit('chat', data));
```

- [ ] **Step 6: 接上头顶渲染**

`src/game.ts` 顶部 import 补 `ChatBubbles`，类里加字段 `readonly bubbles = new ChatBubbles();`，并在构造后订阅：在 `createGame()`（`src/game.ts:287`）里，或场景 `create()` 中加

```ts
    this.network.addEventListener('chat', e => this.bubbles.put((e as CustomEvent).detail));
```

`src/game.ts:221-223` 三行替换为：

```ts
    // 气泡按 id 从表里取，不再从快照的字段读——一句话是事件，快照里没有它。
    // hp<=0 时不显示：躺平的刘正超不说话。
    // **不要把 Phaser 的 time 传进去。** put() 用的是 performance.now()，而 Phaser 的 time
    // 是「游戏启动以来的毫秒数」，两个时钟原点不同——混用会让气泡要么瞬间消失、要么永不消失。
    // 表自己拿 performance.now()，调用方不传，就没有混用的机会。
    const bubble = actor.hp > 0 ? this.bubbles.get(actor.id) : undefined;
    v.bubble.setVisible(!!bubble);
    if (bubble) v.bubble
      .setText(bubble.text)
      .setColor(bubble.kind === 'emote' ? '#6b7d68' : '#2c3b30')  // 表情是动作不是话语，用偏灰的字
      .setWordWrapWidth(240)
      .setPosition(v.sprite.x, v.sprite.y - (office ? OFFICE_BUBBLE_UP : height + 44));
```

`src/game.ts:210` 的深度那行，把气泡从固定 `10001` 改为跟随人物：

```ts
    // 气泡跟着人物深度走：前面的人的气泡盖住后面的人的。名牌与血条小，维持平的 10000。
    v.sprite.setDepth(depth); v.shadow.setDepth(depth - 1); v.label.setDepth(10000); v.health.setDepth(10000); v.bubble.setDepth(10001 + depth);
```

- [ ] **Step 7: 浏览器里确认气泡会跟着人穿门**

Run: `npm run dev`，开两个身份。
- A 说一句话，A 立刻走进大会议室：**A 的气泡跟着 A 消失在 B 的画面上**（因为 B 不再渲染 A），而不是留在走廊原地。
- A 在会议室说话，A 走出来到走廊：**气泡出现在走廊的 A 头顶**。

这条验的是「按快照里当前 area 实时判断」这个决定——`src/game.ts` 遍历的就是当前渲染的 actor 列表，所以只要气泡是按 id 查表、位置跟着 `v.sprite` 走，它就自动正确。看一眼确认没有别的地方把 area 缓存下来了。

- [ ] **Step 8: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全绿，构建通过

- [ ] **Step 9: Commit**

```bash
git add src/chat-bubbles.ts src/network.ts src/game.ts tests/chat.test.ts
git commit -m "feat: 客户端气泡表，过期归客户端管

按 id 索引，所以「后一句顶掉前一句」不用写代码。气泡深度改为跟随人物，
前面的人的气泡盖住后面的人的。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: 输入框与键盘交接

**Files:**
- Create: `src/chat-input.ts`
- Modify: `src/main.ts:27`（`stage-bottom` 加输入框）、`:45`（`blocked`）、`:71`（`openingDone`）、`:162`（preventDefault 名单）
- Modify: `src/style.css`（追加）
- Modify: `src/game.ts:93` 一带（暴露 `resetKeys` 给外部调用）

**Interfaces:**
- Consumes: Task 1 的 `CHAT`；Task 5 的 `network` 事件通道
- Produces:
  - `function createChatInput(opts: { send: (payload: { text: string }) => void; canChat: () => boolean; onClose: () => void }): { isOpen(): boolean; open(): void; close(): void }`

- [ ] **Step 1: 加输入框的 DOM 与样式**

`src/main.ts:27` 的 `stage-bottom` 里，在 `<div class="stage-actions">` **之前**插入：

```html
<input id="chat-input" class="chat-input" hidden maxlength="40" autocomplete="off"
       placeholder="说点什么…（Enter 发送，Esc 取消，/挥手 等命令可用）" aria-label="发言"/>
```

`src/style.css` 追加：

```css
.chat-input{flex:1;min-width:0;background:#11151c;border:1px solid #33414f;border-radius:8px;
  color:#f5eedc;font:inherit;font-size:14px;padding:6px 10px}
.chat-input:focus{outline:none;border-color:#a6e8c2}
.chat-input[hidden]{display:none}
```

- [ ] **Step 2: 写 `src/chat-input.ts`**

```ts
import { CHAT } from '../shared/game';

/** 输入框与键盘的交接。开着的时候它拥有键盘，`blocked()` 据此让游戏这边全部失效。 */
export function createChatInput(opts: {
  send: (payload: { text: string }) => void;
  canChat: () => boolean;          // 纯判断，不许有副作用——它每次按 Enter 都被调用
  onRefused: () => void;           // 被拒时做什么（弹工牌对话框），副作用放这里
  onClose: () => void;
}) {
  const box = document.getElementById('chat-input') as HTMLInputElement;
  let open = false;
  let sentAt = 0;

  const close = () => {
    if (!open) return;
    open = false; box.value = ''; box.hidden = true; box.blur();
    // 关掉时必须让游戏那边重置按键状态：按 Enter 开聊天那一刻你可能正按着 D，
    // 而焦点在输入框时画布收不到 keyup，Phaser 那边 D 会一直是按下状态——
    // 关掉聊天，人就自己往右走，而你没碰任何键。
    opts.onClose();
  };

  const openBox = () => {
    if (open) return;
    open = true; box.hidden = false; box.value = ''; box.focus();
  };

  box.addEventListener('keydown', event => {
    // 中文输入法：打「你好」时按 Enter 是在确认候选词，不是发送。不放行的话，
    // 每个用输入法的人第一次打字都会把半截拼音发出去。229 是老 WebKit 不设
    // isComposing 时的兜底。这条不能删。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = box.value.trim();
    if (!text) { close(); return; }
    // 客户端也挡一道冷却：少发一个必被服务器丢弃的包。服务器那边才是权威。
    if (performance.now() - sentAt >= CHAT.cooldownMs) { sentAt = performance.now(); opts.send({ text }); }
    close();
  });
  box.addEventListener('blur', close);

  window.addEventListener('keydown', event => {
    if (open || event.key !== 'Enter') return;
    if (document.querySelector('dialog[open]')) return;       // 对话框里的 Enter 归对话框
    if (event.isComposing || event.keyCode === 229) return;
    // 门控只在这一处。canChat() 保持纯净，副作用（弹工牌）交给 onRefused——
    // 否则一次按键会两次调用它，工牌对话框会被 show() 两遍。
    if (!opts.canChat()) { opts.onRefused(); return; }
    event.preventDefault();
    openBox();
  });

  return { isOpen: () => open, open: openBox, close };
}
```

- [ ] **Step 3: 在 `src/main.ts` 里接上**

`src/main.ts:45` 一带改为：

```ts
let openingDone = false;
// 必须带 | undefined：blocked 的闭包在 chat 被赋值之前就交给了 createGame，
// 类型上不承认这一点的话 tsc 会拦下 `chat?.`。
let chat: ReturnType<typeof createChatInput> | undefined;
const { scene } = createGame(
  network,
  () => !!document.querySelector('dialog[open]') || !!chat?.isOpen(),
  interact,
);
chat = createChatInput({
  send: payload => network.room?.send('chat', payload),
  canChat: () => openingDone && !!network.profile,
  // 开场还没放完时按 Enter 什么都不做（那时 Enter 归「跳过」）；
  // 放完了但没工牌，就和按 J / 按 E / 点商店一样弹工牌对话框。
  onRefused: () => { if (openingDone && !network.profile) show(authDialog); },
  onClose: () => scene.resetInputKeys(),
});
```

`src/main.ts:71` 的 `finally` 里追加 `openingDone = true;`：

```ts
  finally { window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); openingDone = true; }
```

`src/main.ts:162` 那行改为（**名单里有 `Space`，聊天开着时不能拦，否则打不出空格**）：

```ts
window.addEventListener('keydown',event=>{if(!document.querySelector('dialog[open]')&&!chat?.isOpen()&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();});
```

- [ ] **Step 4: 在 `src/game.ts` 暴露 `resetInputKeys`**

`OfficeScene` 类里加一个公开方法（放在 `src/game.ts:93` 那个已有 `resetKeys()` 调用的附近）：

```ts
  /** 聊天框关闭时由外部调用：焦点在输入框期间画布收不到 keyup，不重置就会「人自己走」。 */
  resetInputKeys() { this.input?.keyboard?.resetKeys(); }
```

确认 `createGame()`（`src/game.ts:287-289`）返回的 `scene` 上能拿到它；若返回类型是收窄过的接口，把这个方法加进去。

- [ ] **Step 5: 浏览器 QA —— 五条，逐条看**

Run: `npm run dev`

- [ ] 打「你好」：组字中按 `Enter` **只确认候选词**，输入框里出现「你好」；再按 `Enter` 才发送
- [ ] 聊天框开着时按 `W`/`A`/`S`/`D` 人不动，按 `J` 不挥拳，**空格能正常打出**
- [ ] 开聊天**前按住 `D` 不放**，按 `Enter` 开聊天，松开 `D`，发一条消息关闭聊天 → **人不会自己往右走**
- [ ] 开场动画期间按 `Enter`：只跳过，不弹输入框
- [ ] 退出登录后（无 `network.profile`）按 `Enter`：弹工牌对话框，不弹输入框

第三条是这一轮最容易漏的：它只在「开聊天时手还按着方向键」这个时序下出现，随手点开输入框是测不出来的。

- [ ] **Step 6: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全绿

- [ ] **Step 7: Commit**

```bash
git add src/chat-input.ts src/main.ts src/game.ts src/style.css
git commit -m "feat: 聊天输入框，以及键盘的交接

中文输入法组字期间的 Enter 必须放行，否则第一次打字就把半截拼音发出去。
关闭时重置按键状态，否则开聊天时按着的方向键会让人自己走。
preventDefault 名单里有 Space，聊天开着时不能拦。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: 数字键表情

**Files:**
- Modify: `src/game.ts:75-77`（`addKeys` 与 `removeCapture` 两份名单）、`:162` 一带（`E` 的 JustDown 旁边）
- Modify: `src/main.ts:29`（键位说明加一行）

**Interfaces:**
- Consumes: Task 1 的 `EMOTES`；Task 6 的 `blocked()`
- Produces: 无（终端行为）

- [ ] **Step 1: 改两份键名单**

`src/game.ts:75`：

```ts
    this.keys = this.input.keyboard!.addKeys('A,D,W,S,SPACE,J,E,LEFT,RIGHT,UP,DOWN,ONE,TWO,THREE,FOUR,FIVE,SIX') as Record<string, Phaser.Input.Keyboard.Key>;
```

`src/game.ts:77`：

```ts
    this.input.keyboard!.removeCapture(['A','D','W','S','SPACE','J','E','LEFT','RIGHT','UP','DOWN','ONE','TWO','THREE','FOUR','FIVE','SIX']);
```

**两份都要改。** 只改 `addKeys` 的话键能读到，但浏览器默认行为没让开；只改 `removeCapture` 的话 `this.keys.ONE` 是 undefined，下一步会在运行时抛错。

- [ ] **Step 2: 接上发送**

`src/game.ts:162`（`E` 的那行）之后追加：

```ts
    // 数字键表情。和 E 一样受 blocked 管：在聊天框里打「1」不能触发挥手。
    // 显式映射表，不靠 EMOTES 的顺序推算键名——顺序是排版决定的，改一下就静默错位。
    if (!blocked) for (const emote of EMOTES) {
      const key = this.keys[PHASER_DIGIT[emote.key]];
      if (key && Phaser.Input.Keyboard.JustDown(key)) { this.network.room?.send('chat', { emote: emote.id }); break; }
    }
```

并在 `src/game.ts` 文件顶部的常量区（`OFFICE_BUBBLE_UP` 那一带）加：

```ts
const PHASER_DIGIT: Record<string, string> = { '1': 'ONE', '2': 'TWO', '3': 'THREE', '4': 'FOUR', '5': 'FIVE', '6': 'SIX' };
```

`src/game.ts` 顶部 import 补 `EMOTES`。

- [ ] **Step 3: 键位说明加一行**

`src/main.ts:29` 的 `.keyboard-controls` 里，在 `<span><kbd>E</kbd>互动</span>` 之后插入：

```html
<span><kbd>Enter</kbd>说话</span><span><kbd>1</kbd>–<kbd>6</kbd>表情</span>
```

- [ ] **Step 4: 浏览器 QA**

Run: `npm run dev`
- [ ] 按 `1` 头顶出现「（挥了挥手）」，颜色比说话偏灰
- [ ] 连按 `1` `2` `3`：受 1.2 秒冷却，只有第一个出得来
- [ ] **开着聊天框打「123」：输入框里出现 123，头顶什么都不出**
- [ ] 输入框里打 `/鼓掌` 回车：出现「（鼓了鼓掌）」
- [ ] 输入框里打 `/不存在` 回车：底部出现提示，列出可用命令

- [ ] **Step 5: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全绿

- [ ] **Step 6: Commit**

```bash
git add src/game.ts src/main.ts
git commit -m "feat: 数字键 1-6 发表情，和斜杠命令读同一张表

addKeys 与 removeCapture 两份名单都要加，漏一份是两种不同的坏法。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 8: 小地图上的隔壁气泡（含转义）

**Files:**
- Create: `src/escape.ts`
- Modify: `src/main.ts:19`（改为 import）
- Modify: `src/minimap.ts`（追加 `minimapBubbles()`）
- Modify: `src/map-panel.ts:2`、`:111-112`
- Test: `tests/minimap.test.ts`（追加）

**Interfaces:**
- Consumes: Task 5 的 `ChatBubbles.live()`；`shared/world` 的 `projectTo`、`AREAS`
- Produces:
  - `src/escape.ts`: `export const escape: (s: string) => string`
  - `src/minimap.ts`: `export function minimapBubbles(area: Area, players: Actor[], live: { id: string; text: string }[], selfName?: string): { id: string; x: number; y: number; text: string; mine: boolean }[]`
  - `src/minimap.ts`: `export function bubbleMarkup(b: { x: number; y: number; text: string; mine: boolean }): string`

- [ ] **Step 1: 写失败的测试**

追加到 `tests/minimap.test.ts`：

```ts
import { minimapBubbles, bubbleMarkup } from '../src/minimap.js';

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
  assert.equal(out[0].text, '这是一句很…');   // 前 6 字 + 省略号
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx tsx --test tests/minimap.test.ts`
Expected: FAIL —— `minimapBubbles` / `bubbleMarkup` 未导出

- [ ] **Step 3: 抽出 `src/escape.ts`**

```ts
/** SVG / HTML 字符串拼接的唯一出口。小地图用 innerHTML 拼 SVG（src/map-panel.ts），
 *  聊天文本是第一个流到那里的用户可控字符串——所以这个函数不能再私藏在 main.ts 里。 */
export const escape = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
```

`src/main.ts:19` 删掉本地定义，改为顶部 `import { escape } from './escape';`。

- [ ] **Step 4: 实现 `minimapBubbles` 与 `bubbleMarkup`**

`src/minimap.ts` 顶部 import 补 `import { escape } from './escape';`，末尾追加：

```ts
export interface MinimapBubble { id: string; x: number; y: number; text: string; mine: boolean }

/** 不在我这个 area 的人说的话，落在他投影出的光点旁。同 area 的不画——头顶已经有了，
 *  画两遍是噪音。最多两条：小地图就那么大，多了会糊成一片。 */
export function minimapBubbles(
  area: Area, players: Actor[], live: readonly { id: string; text: string }[], selfName?: string,
): MinimapBubble[] {
  const byId = new Map(players.map(p => [p.id, p]));
  const out: MinimapBubble[] = [];
  for (const said of live) {                       // live 已按最新在前排好
    const p = byId.get(said.id);
    if (!p || p.area === area.id) continue;        // 同 area 的归头顶管
    if (area.id !== 'corridor') continue;          // 房间平面上没有别处可画
    const pos = projectTo(AREAS[p.area], p.x, p.y);
    const chars = [...said.text];
    out.push({
      id: said.id, x: pos.x, y: pos.y,
      text: chars.length > 6 ? chars.slice(0, 6).join('') + '…' : said.text,
      mine: !!selfName && said.text.includes(selfName),
    });
    if (out.length === 2) break;
  }
  return out;
}

/** 这段字符串进的是 innerHTML，所以文本必须转义。测试钉住了这一点。 */
export function bubbleMarkup(b: Pick<MinimapBubble, 'x' | 'y' | 'text' | 'mine'>) {
  return `<text x="${b.x}" y="${b.y - 44}" text-anchor="middle" font-size="34" `
    + `fill="${b.mine ? '#a6e8c2' : '#e8e2cf'}" stroke="#172b24" stroke-width="8" `
    + `paint-order="stroke">${escape(b.text)}</text>`;
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx tsx --test tests/minimap.test.ts`
Expected: PASS

- [ ] **Step 6: 反向验证转义那两条**

临时把 `bubbleMarkup` 里的 `escape(b.text)` 改成 `b.text`，重跑。
Expected: 两条转义测试都 FAIL。确认后改回。

- [ ] **Step 7: 接进 `src/map-panel.ts`**

`src/map-panel.ts:2` 的 import 补 `minimapBubbles, bubbleMarkup`。`createMapPanel` 需要拿到 `ChatBubbles` 实例——从调用处（`src/main.ts`）把 `scene.bubbles` 传进来。

`src/map-panel.ts:112` 那行改为：

```ts
    const players = snapshot?.players ?? [];
    const dots = office ? minimapDots(area, players, player?.id).map(dot).join('') : '';
    const bubbles = office
      ? minimapBubbles(area, players, bubbleTable.live(), network.profile?.name).map(bubbleMarkup).join('')
      : '';
    get('map-players').innerHTML = dots + bubbles;
```

- [ ] **Step 8: 浏览器 QA**

Run: `npm run dev`，两个身份。
- [ ] A 进大会议室说话，B 在走廊：小地图的会议室位置上出现截短气泡
- [ ] B 也进会议室：气泡改到头顶，小地图上不再画
- [ ] 等刘正超点名 B：B 的小地图上那条是薄荷绿；点别人时是米白
- [ ] 昵称注册成 `<b>粗</b>`：小地图上原样显示这几个字符，页面不出现粗体

- [ ] **Step 9: 全量测试 + 构建**

Run: `npm test && npm run build`
Expected: 全绿

- [ ] **Step 10: Commit**

```bash
git add src/escape.ts src/minimap.ts src/map-panel.ts src/main.ts tests/minimap.test.ts
git commit -m "feat: 隔壁的话落在小地图上，点名到自己的高亮

小地图是 innerHTML 拼 SVG，聊天文本是第一个流到那里的用户可控字符串，
所以 escape 从 main.ts 抽出来共用，并有测试钉住。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 9: 文档

**Files:**
- Modify: `docs/PLAN.md`（Bounds 一段、新增一节、刘正超那一节）

**Interfaces:**
- Consumes: 前八个任务的实际交付
- Produces: 无

- [ ] **Step 1: 改 Bounds**

`docs/PLAN.md` 的 `## Bounds` 段里，把 `chat` 从禁止清单中删除，并在该段末尾补一句：

```
Chat exists as of 2026-09-30, in exactly one form: typed lines and six emotes become an overhead
bubble that expires. There is no log, no history and no persistence — a line that has faded is gone.
```

- [ ] **Step 2: 新增一节**

在「办公室里的攻击目标 — 2026-09-24」之前插入：

```markdown
## 办公室里说得上话了 — 2026-09-30

按 `Enter` 打字，头顶冒气泡；`1`–`6` 或 `/挥手` 这类命令发六个表情。全楼层广播——
不在同一个房间的人说的话，落在小地图上他投影出的光点旁（截短到六个字），点名到你的
那条是薄荷绿。没有聊天记录：话淡出了就没了。

**一句话是事件，不是状态。** 服务器 `broadcast('chat', …)` 一次，客户端自己维持一张
`id → { text, until }` 表并到点抹掉。刘正超原先的 `say` 字段从快照里删掉了，迁到同一条
通道——否则渲染层要认两套气泡。这么选不是为了省带宽（24 人远不到瓶颈），是因为快照每
2 tick 全量重发：把一句话放进快照，就等于每秒重复它 15 次。仓库里早有先例，`hit` 的伤害
数字走的就是这条路。

代价：中途加入或重连的人看不到正在飘的那句话。这对聊天是对的——走进会议室不该看到三秒前
的话还挂在别人头上。

三个踩过的坑：

- **中文输入法的 `Enter` 是确认候选词，不是发送。** 不放行 `event.isComposing`（以及老
  WebKit 的 `keyCode === 229`），每个用输入法的人第一次打字都会把半截拼音发出去——「nihao」
  直接飘在头顶。这条只有中文用户会遇到，而写代码的人如果用英文测，永远测不出来。
- **截断要按码点，不按 UTF-16 码元。** `'👍'.length === 2`，`slice(0, 40)` 会从代理对中间
  切开，屏幕上是一个乱码方块。`[...text].slice(0, 40).join('')`。
- **关闭输入框时必须重置按键状态。** 按 `Enter` 开聊天那一刻你可能正按着 `D`；焦点在输入框
  时画布收不到 `keyup`，Phaser 那边 `D` 会一直是按下状态。关掉聊天，人就自己往右走，而你没碰
  任何键。症状和原因隔着一次焦点切换，很难联想到一起。

另外，`escape()` 从 `src/main.ts` 抽成了 `src/escape.ts`。小地图是 `innerHTML` 拼 SVG
（`src/map-panel.ts`），此前流过那里的全是数字和服务器生成的 id，**聊天文本是第一个到达
那个 `innerHTML` 的用户可控字符串**。头顶气泡不需要转义（Phaser Text 画在 canvas 上），
小地图需要，而且有测试钉住。
```

- [ ] **Step 3: 改刘正超那一节**

「刘正超会自己上班了 — 2026-09-24」一节，标题下方补一段人设改动：

```markdown
**2026-09-30 改设定：他现在是领导。** 压着下属、毫无能力也毫无管理经验，台词分甩锅、画饼、
踢皮球三类，外加会点名——「这个 @某某 处理一下」，名字从全楼层在线玩家里随机挑。名牌读作
「刘正超 · 主管」。

**一个人都没在线时，点名那一类整个跳过。** 这不是新机制，是这一节下面已经记过的同一个套路：
走廊没有工位，`spotAtDesk(corridor)` 返回 undefined，抽到「回工位」就退化成「玩手机」，
而不是把人塞进墙里假装那是工位。同样地，没人可点就不点，而不是点一个叫 `undefined` 的同事。

台词锁在无能与甩锅上，不碰性别、地域、外貌——被点名的是真实用户自己起的昵称，玩笑和冒犯
之间就隔着这条线。

他的 `say` 字段已从快照中删除，说话走 `chat` 事件；`sayForMs` 也没了，气泡时长改由
`bubbleMs()` 按字数算。他仍然不还手，打倒他仍然不给积分。
```

同时把该节里「浮层从下往上是：名牌 y-26、血条 y-62、气泡 y-70」那条保留不动——它仍然成立。

- [ ] **Step 4: 核对文档与代码一致**

Run: `grep -n "chat\|聊天" docs/PLAN.md`
逐条核对：Bounds 里不再禁止、新增节的描述与实际交付一致、没有写出未实现的东西（例如聊天记录面板）。

- [ ] **Step 5: 全量验收**

Run: `npm run build && npm test`
Expected: 全绿。记下最终测试条数。

- [ ] **Step 6: Commit**

```bash
git add docs/PLAN.md
git commit -m "docs: PLAN 记下聊天、表情与刘正超的新设定

Bounds 里的 chat 禁令解除。三个坑写进去了：输入法的 Enter、码点截断、
关输入框时的按键重置。

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## 自查记录

写完后对照 spec 逐节核对的结果：

- **spec 覆盖**：事件通道 → T3/T5；全楼层广播 → T3（含反向验证）；只要气泡 → 无面板，T5；小地图隔壁气泡 → T8；表情双入口 → T1 表 + T3 斜杠 + T7 数字键；点名 → T2/T4；键盘归属三处 → T6；IME → T6；限流与净化 → T1/T3；转义 → T8；文档 → T9。无缺口。
- **类型一致**：`ChatEvent` 在 T1 定义，T3 广播、T5 消费，字段名一致（`id`/`text`/`kind`/`ms`）。`ChatBubbles.live()` 返回 `{ id, text, kind }`，T8 的 `minimapBubbles` 只取 `{ id, text }`（形参类型写成 `readonly { id: string; text: string }[]`，兼容）。`escape` 在 T8 建立，T6 不使用。
- **Review Focus 五条**：分别落在 T8（转义 ×2 条测试）、T2（`$&`）、T5（穿门为浏览器 QA，悬挂条目为单测）、T3（畸形消息）。第 3 条的「穿门」只有浏览器 QA 覆盖，因为它取决于 Phaser 渲染循环遍历的是哪份列表，node 侧没有可断言的接缝——这一点在 T5 Step 7 明写了要确认「没有别的地方把 area 缓存下来」。

自查中改掉的五处：

1. **时钟不匹配（会让功能完全失灵）**：T5 原先写 `this.bubbles.get(actor.id, time)`，但 `time` 是 Phaser 的「游戏启动以来毫秒数」，而 `put()` 用的是 `performance.now()`，两个时钟原点不同——气泡要么瞬间消失要么永不消失。改为不传参，由表自己取 `performance.now()`，调用方就没有混用的机会。
2. **T3 测试里有占位符**：「按既有写法把 b 走到 storage」不是代码。已按本仓库 `tests/multiplayer.test.ts:342-360` 的真实走法展开，并补了一条断言确认 a 还在走廊——否则这条测的可能根本不是跨房间。
3. **`canChat()` 有副作用且被调用两次**：原设计让它兼任「弹工牌对话框」，而 `openBox()` 也会调它，一次按键会 `show()` 两遍。拆成纯判断 `canChat()` + 副作用 `onRefused()`，门控只留在 window 监听器一处。
4. **T4 的点名断言写得不可读且脆**（靠 `split('{name}')[1].slice(0,4)` 凑）。改为把模板转成正则（`{name}` → `(.+)`，其余部分做正则转义）。
5. **T7 靠 `EMOTES` 的顺序推 Phaser 键名**（`['ONE',…][Number(key)-1]`）。顺序是排版决定的，重排一次就静默错位。改为显式映射表 `PHASER_DIGIT`。

另外 T3 的 import 与 `watch()` 扩展从「注释里交代」改成了给出整行替换代码——`watch()` 是一行长声明，靠描述改容易漏掉 `chats:[]` 的初始化。
