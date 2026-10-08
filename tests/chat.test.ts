import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChat, bubbleMs, EMOTES, CHAT, NPC, NPC_LINES, NPC_MENTION_LINES, pickLine, PHASER_DIGIT, type ChatEvent } from '../shared/game.js';
import { WorldRoom } from '../server/world.js';

/** 按顺序吐出预定值的 random，用完后一直返回最后一个。用来把「抽到哪一条」变成确定的。 */
const seq = (...values: number[]) => { let i = 0; return () => values[Math.min(i++, values.length - 1)]; };

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

test('每个表情的数字键都能在 Phaser 键名映射表里查到', () => {
  // 查不到时 this.keys[undefined] 是 undefined，那个表情永远发不出去，而且不抛异常——
  // 这是本任务唯一一处「写错了不报错、只静默失效」的地方。
  for (const e of EMOTES) {
    assert.ok(PHASER_DIGIT[e.key], `表情 ${e.id} 的按键「${e.key}」不在映射表里`);
  }
  // 反向也要：映射表里不该有 EMOTES 用不到的键，否则 addKeys 的名单会和实际需要漂移。
  const used = new Set<string>(EMOTES.map(e => e.key));
  for (const key of Object.keys(PHASER_DIGIT)) {
    assert.ok(used.has(key), `映射表里的「${key}」没有对应的表情`);
  }
});

test('没有人在线时，抽不到点名句', () => {
  // random 固定为 0.99，让实现里「先决定要不要点名」那一掷必定倾向点名；
  // 名单为空时仍然必须退回普通台词，而不是点一个叫 undefined 的同事。
  for (const r of [0, .25, .5, .75, .99]) {
    const { text: line, to } = pickLine([], () => r);
    assert.ok(NPC_LINES.includes(line), `名单为空却抽到了 ${line}`);
    assert.ok(!line.includes('{name}'), '模板没有被替换就发出去了');
    assert.equal(to, undefined, '没点名却报了一个被点名的人');
  }
});

test('有人在线时，点名句里的 {name} 被换成在线昵称之一', () => {
  const names = ['摸鱼小王', '咖啡不加班'];
  const seen = new Set<string>();
  for (let i = 0; i < 400; i++) seen.add(pickLine(names).text);
  const mentions = [...seen].filter(l => names.some(n => l.includes(n)));
  assert.ok(mentions.length > 0, '四百次一次都没点名');
  for (const line of seen) assert.ok(!line.includes('{name}'), `${line} 里的模板没被替换`);
});

test('点到谁由 pickLine 一起报出来，客户端不用回头猜', () => {
  // 小地图的薄荷绿高亮判的是 to === 我的昵称。没有这个字段就只能拿昵称去 includes()
  // 匹配句子，而中文没有词边界：「小王」会被一句点名「小王八」的话认成点自己。
  const names = ['摸鱼小王', '咖啡不加班'];
  let mentioned = 0;
  for (let i = 0; i < 400; i++) {
    const { text, to } = pickLine(names);
    if (to === undefined) { assert.ok(NPC_LINES.includes(text), `没报点名对象却抽到了点名句：${text}`); continue; }
    mentioned++;
    assert.ok(names.includes(to), `点了一个不在线的人：${to}`);
    assert.ok(text.includes(to), `报的是 ${to}，句子里却没有他：${text}`);
  }
  assert.ok(mentioned > 0, '四百次一次都没点名');
});

test('净化收在 say() 这一个点上：NPC 的点名句也过得去', () => {
  // say() 只用 this.broadcast + sanitizeChat + bubbleMs，不碰房间的其他状态，所以直接
  // 拿原型调用就够了——为这条不变量起一个真的 Colyseus 房间要连数据库，而数据库和
  // 「广播出去的文本是不是单行」毫无关系。
  // 这一条钉住的是**收窄点本身**：把 say() 里的净化去掉，它会红，上面那条组合测试不会。
  const sent: ChatEvent[] = [];
  const fake = Object.create(WorldRoom.prototype) as any;
  fake.broadcast = (_type: string, payload: ChatEvent) => sent.push(payload);
  const line = pickLine(['摸鱼\n小王'], seq(0, 0, 0));
  fake.say(NPC.id, line.text, 'say', line.to);
  assert.equal(sent.length, 1, 'say() 应该广播一条');
  assert.ok(!/[\r\n\t]/.test(sent[0].text), `广播出去的文本带换行：${JSON.stringify(sent[0].text)}`);
  assert.equal(sent[0].ms, bubbleMs(sent[0].text), '停留时长要按净化后的文本算，不是按原文');
  // to 不净化，而且必须不净化：客户端拿它和 network.profile.name 逐字比较，而
  // profile.name 存的就是原样的昵称。顺带说明 to 为什么必要——净化把换行换成空格后，
  // 句子里已经不含原样的昵称了，旧的子串匹配在这种昵称上永远不可能成立。
  assert.equal(sent[0].to, '摸鱼\n小王');
  assert.ok(!sent[0].text.includes('摸鱼\n小王'));
});

test('昵称里夹带换行时，点名句广播出去仍然是一行', () => {
  // 昵称是用户输入：server/database.ts 只校验 trim() 非空且 ≤12 码点，句中的 \n 不拒，
  // 而注册表单的 maxlength 是前端属性，直接 POST 就绕过了。pickLine 本身不净化——
  // 净化收在 say() 这一个点上，所以这里测的是「sanitizeChat(pickLine(...).text)」这个组合。
  // 没有这一道，头顶的 Phaser Text 会对房间里所有人渲染成畸形的两行气泡。
  const nasty = '摸鱼\n小王';
  for (let i = 0; i < 200; i++) {
    const clean = sanitizeChat(pickLine([nasty]).text);
    assert.ok(clean, '净化后不该为空');
    assert.ok(!/[\r\n\t]/.test(clean!), `广播文本里还有换行：${JSON.stringify(clean)}`);
    assert.ok([...clean!].length <= CHAT.maxChars, `超过了 ${CHAT.maxChars} 码点上限：${clean}`);
  }
});

test('昵称里的 $& 原样出现，不被 replace 当成匹配内容展开', () => {
  // String.prototype.replace 的字符串替换参数里，$& 表示「匹配到的内容」。
  // 一个把自己起名叫 $& 的玩家，会让点名句里冒出字面量 {name}。必须用替换函数。
  // seq(0,0,0)：第一掷 0 < .3 走点名分支，第二掷选中模板 0，第三掷选中名字 0。
  const line = pickLine(['$&'], seq(0, 0, 0)).text;
  assert.equal(line, NPC_MENTION_LINES[0].replace('{name}', () => '$&'));
  assert.ok(line.includes('$&'), `昵称被展开了：${line}`);
  assert.ok(!line.includes('{name}'), `模板残留：${line}`);
});

test('点名模板都含 {name}，普通台词都不含', () => {
  for (const t of NPC_MENTION_LINES) assert.ok(t.includes('{name}'), `${t} 不是模板`);
  for (const l of NPC_LINES) assert.ok(!l.includes('{name}'), `${l} 不该含模板`);
});

import { ChatBubbles } from '../src/chat-bubbles.js';
import { shouldOpenChat } from '../src/chat-input.js';

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

test('Enter 开聊天框的五个门控，每个都单独拦得住', () => {
  const ok = { alreadyOpen: false, key: 'Enter', composing: false, dialogOpen: false, canChat: true, fromChatBox: false };
  assert.equal(shouldOpenChat(ok), true, '五个条件都满足时应该打开');
  assert.equal(shouldOpenChat({ ...ok, alreadyOpen: true }), false, '已经开着就不该再开');
  assert.equal(shouldOpenChat({ ...ok, key: 'a' }), false, '别的键不该开');
  assert.equal(shouldOpenChat({ ...ok, dialogOpen: true }), false, '对话框开着时 Enter 归对话框');
  assert.equal(shouldOpenChat({ ...ok, composing: true }), false, '输入法组字中的 Enter 是确认候选词，不是开聊天');
  assert.equal(shouldOpenChat({ ...ok, canChat: false }), false, '开场没放完或没工牌时不该开');
  assert.equal(shouldOpenChat({ ...ok, fromChatBox: true }), false, '来自聊天框自身的按键不该重新打开它');
});

test('职级是单独字段，没有混进名字里', () => {
  // name 被服务器的「XX 躺平了」提示和集成测试的十几处断言共用，职级一旦并进去就会漏到那些地方。
  assert.equal(NPC.name, '刘正超');
  assert.ok(NPC.title && !NPC.name.includes(NPC.title), '职级不该出现在 name 里');
});
