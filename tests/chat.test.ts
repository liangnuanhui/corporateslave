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
