import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_NAME } from '../shared/game.js';

const root = new URL('..', import.meta.url).pathname;
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

// 公司名这一路改了两次（先是房间号换成公司名，再是整体改名），每次都散落在好几个文件里：
// 站点地图的眉标、注册框标题、上海办的副标题、页面 <title>。这条测试把它们收成一个事实。
test('the organisation is named in exactly one place', () => {
  // 只有 index.html 是静态的、读不到常量，所以它是唯一允许写死名字的地方——由这里钉住。
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
  assert.ok(title.includes(ORG_NAME), `index.html 的 <title>「${title}」没跟上 ORG_NAME=${ORG_NAME}`);

  // 其余任何地方再出现旧名字，都说明有人又把同一个事实抄了一份。
  const OLD = ['摸鱼科技']; // 旧公司名，留在这里做反向哨兵
  for (const dir of ['src', 'shared']) {
    for (const path of walk(join(root, dir))) {
      if (!/\.(ts|css|html)$/.test(path)) continue;
      const text = readFileSync(path, 'utf8');
      for (const old of OLD) assert.ok(!text.includes(old), `${path.slice(root.length)} 里还写着旧公司名「${old}」`);
    }
  }
});
