import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeChat, bubbleMs, EMOTES, CHAT, NPC_LINES, NPC_MENTION_LINES, pickLine } from '../shared/game.js';

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
  // seq(0,0,0)：第一掷 0 < .3 走点名分支，第二掷选中模板 0，第三掷选中名字 0。
  const line = pickLine(['$&'], seq(0, 0, 0));
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
