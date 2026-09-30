import { AREAS, CORRIDOR_ROOMS, corridor, projectTo, type Area } from '../shared/world';
import type { Actor } from '../shared/game';
import { escape } from './escape';

export interface MinimapDot { id: string; x: number; y: number; r: number; self: boolean }

/** Which players belong on the minimap for the area currently on screen, and where.
 *  Corridor: the whole floor's population, each projected onto their own area's footprint
 *  (identity for corridor players) — this is what keeps the overview informative about who
 *  is where. A room: only that room's own occupants, at their raw local coordinates —
 *  projecting everyone else's numbers onto one room's plan would be meaningless, and drawing
 *  the whole floor's population on a single room's footprint would misrepresent who's there.
 *  Pure and given its own tests: this branch is the entire point of the task. */
export function minimapDots(area: Area, players: Actor[], selfId?: string): MinimapDot[] {
  const located = area.id === 'corridor' ? players : players.filter(p => p.area === area.id);
  return located.map(p => {
    const pos = area.id === 'corridor' ? projectTo(AREAS[p.area], p.x, p.y) : { x: p.x, y: p.y };
    return { id: p.id, x: pos.x, y: pos.y, r: p.id === selfId ? 30 : 22, self: p.id === selfId };
  });
}

// The corridor plan mirrors the six-room floor art; a room plan is just its own footprint,
// walls, furniture and exit — there is no wider floor to show once you're inside one.
export function corridorMarkup() {
  return `<rect x="40" y="60" width="1840" height="1080" rx="12" fill="#263830"/>
    <path d="M80 600H1840" stroke="#566954" stroke-width="120"/>
    ${CORRIDOR_ROOMS.map(room => `<g data-map-room="${room.id}" tabindex="0" role="button" aria-label="查看${room.name}" class="map-room"><rect x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" fill="#42574a"/><text x="${room.x + room.width / 2}" y="${room.y + room.height / 2}" text-anchor="middle" dominant-baseline="central">${room.name}</text></g>`).join('')}
    <g fill="#85937b" pointer-events="none">${corridor.walls.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}"/>`).join('')}</g>
    <rect id="map-viewport" class="map-viewport" x="0" y="0" width="1920" height="1200"/>
    <g id="map-players" pointer-events="none"></g>`;
}

export function roomMarkup(area: Area) {
  return `<rect x="0" y="0" width="${area.width}" height="${area.height}" rx="12" fill="#263830"/>
    <rect x="${area.bounds.x}" y="${area.bounds.y}" width="${area.bounds.width}" height="${area.bounds.height}" fill="#42574a"/>
    <g fill="#85937b" pointer-events="none">${area.walls.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}"/>`).join('')}</g>
    <g fill="#6d7f6a" pointer-events="none">${area.furniture.map(f => `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="4"/>`).join('')}</g>
    ${area.exits.map(e => `<rect x="${e.rect.x}" y="${e.rect.y}" width="${e.rect.width}" height="${e.rect.height}" fill="#e6c984"/>`).join('')}
    <rect id="map-viewport" class="map-viewport" x="0" y="0" width="${area.width}" height="${area.height}"/>
    <g id="map-players" pointer-events="none"></g>`;
}

export interface MinimapBubble { id: string; x: number; y: number; text: string; mine: boolean }

/** 不在我这个 area 的人说的话，落在他投影出的光点旁。同 area 的不画——头顶已经有了，
 *  画两遍是噪音。最多两条：小地图就那么大，多了会糊成一片。
 *
 *  房间视图（area.id !== 'corridor'）里一条都不画：房间的小地图画的是那个房间自己的平面图
 *  （roomMarkup），上面没有任何位置能代表「别处」。后果是在大会议室里时，走廊上的话收得到
 *  却没地方显示——全楼层广播只兑现一半。这个缺口是有意接受的取舍，不是疏漏：加一个角落浮层
 *  来"补"它，会违背「小地图气泡是为了保住空间感」这个设计决定，所以这里不做。 */
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
