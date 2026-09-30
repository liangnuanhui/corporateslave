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
