import { AREAS, CORRIDOR_ROOMS, corridor, projectTo, type Area } from '../shared/world';
import type { Actor } from '../shared/game';

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
