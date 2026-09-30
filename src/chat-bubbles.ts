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
