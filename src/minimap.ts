import { AREAS, CORRIDOR_ROOMS, corridor, projectTo, type Area, type AreaId } from '../shared/world';
import { escape } from './escape';

/** 小地图只关心「谁、在哪个房间的哪个点、还站不站得起来」。玩家（Actor）和这层楼的
 *  常住 NPC（快照里的 Enemy）都满足这个形状，而它们是两个不同的类型——把入参收窄到
 *  这几个字段，两边就能同时喂进来，不必假装 NPC 是个玩家。 */
export interface Located { id: string; x: number; y: number; area: AreaId; hp: number }

export interface MinimapDot { id: string; x: number; y: number; r: number; self: boolean; npc: boolean }

/** Which people belong on the minimap for the area currently on screen, and where.
 *  Corridor: the whole floor's population, each projected onto their own area's footprint
 *  (identity for corridor players) — this is what keeps the overview informative about who
 *  is where. A room: only that room's own occupants, at their raw local coordinates —
 *  projecting everyone else's numbers onto one room's plan would be meaningless, and drawing
 *  the whole floor's population on a single room's footprint would misrepresent who's there.
 *  Pure and given its own tests: this branch is the entire point of the task.
 *
 *  `npcs` 是同一层楼的常住人口（刘正超），和玩家一起画：小地图的职责就是「谁在哪」，
 *  而他正是你满楼找的那个目标，跨区时精灵被过滤掉，不画就等于看不见。标成 npc 交给
 *  调用方上色——他不是自己人，一眼要能分出来。 */
export function minimapDots(area: Area, players: readonly Located[], selfId?: string, npcs: readonly Located[] = []): MinimapDot[] {
  const everyone = [...players.map(p => ({ p, npc: false })), ...npcs.map(p => ({ p, npc: true }))];
  const located = area.id === 'corridor' ? everyone : everyone.filter(e => e.p.area === area.id);
  return located.map(({ p, npc }) => {
    const pos = area.id === 'corridor' ? projectTo(AREAS[p.area], p.x, p.y) : { x: p.x, y: p.y };
    return { id: p.id, x: pos.x, y: pos.y, r: p.id === selfId ? 30 : 22, self: p.id === selfId, npc };
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
  area: Area, people: readonly Located[], live: readonly { id: string; text: string; to?: string }[], selfName?: string,
): MinimapBubble[] {
  if (area.id !== 'corridor') return [];           // 房间平面上没有别处可画，一条都不会画
  const byId = new Map(people.map(p => [p.id, p]));
  const out: MinimapBubble[] = [];
  for (const said of live) {                       // live 已按最新在前排好
    const p = byId.get(said.id);
    if (!p || p.area === area.id) continue;        // 同 area 的归头顶管
    if (p.hp <= 0) continue;                       // 躺平的人不说话——和头顶气泡同一条不变量
    const pos = projectTo(AREAS[p.area], p.x, p.y);
    const chars = [...said.text];
    out.push({
      id: said.id, x: pos.x, y: pos.y,
      text: chars.length > 6 ? chars.slice(0, 6).join('') + '…' : said.text,
      // 点名以服务器随事件带来的 to 为准，不拿昵称去匹配句子：中文没有词边界，
      // 「小王」会被「小王八」这句话认成点自己，真人随口提到你昵称也会被认成点名。
      mine: !!selfName && said.to === selfName,
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
