import { corridor, CORRIDOR_ROOMS, roomAt, AREAS, projectTo, type Area, type AreaId } from '../shared/world';
import type { Actor } from '../shared/game';
import type { OfficeScene } from './game';
import type { CameraView } from './office-camera';
import type { Network } from './network';

export const mapPanelMarkup = `
  <div class="map-panel" id="map-panel">
    <button class="map-heading" id="map-toggle" aria-expanded="true" aria-controls="minimap-body"><span><i></i><span id="map-title">1F · 楼层导览</span></span><span id="map-toggle-label">收起 −</span></button>
    <div id="minimap-body">
      <svg id="minimap" viewBox="0 0 ${corridor.width} ${corridor.height}" aria-label="办公室小地图，点击或拖拽移动视角" role="group"></svg>
      <div class="map-caption"><span><i></i>你的位置</span><span>点击 / 拖拽移视角</span></div>
      <button id="focus-exit" class="map-leave" hidden>看向出口 →</button>
    </div>
  </div>
  <div class="camera-toolbar" id="camera-toolbar" aria-label="地图视角控制">
    <button id="zoom-out" aria-label="缩小视野" title="缩小">−</button><output id="zoom-level" aria-live="off">100%</output><button id="zoom-in" aria-label="放大视野" title="放大">＋</button>
    <span class="camera-divider"></span><button id="zoom-fit">全景</button><button id="locate-player" aria-pressed="false">跟随我</button>
  </div>`;

const get = (id: string) => document.getElementById(id)!;

// The corridor plan mirrors the six-room floor art; a room plan is just its own footprint,
// walls, furniture and exit — there is no wider floor to show once you're inside one.
function corridorMarkup() {
  return `<rect x="40" y="60" width="1840" height="1080" rx="12" fill="#263830"/>
    <path d="M80 600H1840" stroke="#566954" stroke-width="120"/>
    ${CORRIDOR_ROOMS.map(room => `<g data-map-room="${room.id}" tabindex="0" role="button" aria-label="查看${room.name}" class="map-room"><rect x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" fill="#42574a"/><text x="${room.x + room.width / 2}" y="${room.y + room.height / 2}" text-anchor="middle" dominant-baseline="central">${room.name}</text></g>`).join('')}
    <g fill="#85937b" pointer-events="none">${corridor.walls.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}"/>`).join('')}</g>
    <rect id="map-viewport" class="map-viewport" x="0" y="0" width="1920" height="1200"/>
    <g id="map-players" pointer-events="none"></g>`;
}

function roomMarkup(area: Area) {
  return `<rect x="0" y="0" width="${area.width}" height="${area.height}" rx="12" fill="#263830"/>
    <rect x="${area.bounds.x}" y="${area.bounds.y}" width="${area.bounds.width}" height="${area.bounds.height}" fill="#42574a"/>
    <g fill="#85937b" pointer-events="none">${area.walls.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}"/>`).join('')}</g>
    <g fill="#6d7f6a" pointer-events="none">${area.furniture.map(f => `<rect x="${f.x}" y="${f.y}" width="${f.width}" height="${f.height}" rx="4"/>`).join('')}</g>
    ${area.exits.map(e => `<rect x="${e.rect.x}" y="${e.rect.y}" width="${e.rect.width}" height="${e.rect.height}" fill="#e6c984"/>`).join('')}
    <rect id="map-viewport" class="map-viewport" x="0" y="0" width="${area.width}" height="${area.height}"/>
    <g id="map-players" pointer-events="none"></g>`;
}

// Room buttons only exist in the corridor markup, and a full-SVG rebuild throws them away —
// this re-attaches the keyboard handler every time the corridor plan is (re)painted. Pointer
// clicks don't need this: they're delegated off the <svg> itself, which survives the rebuild.
function bindRooms(scene: OfficeScene) {
  document.querySelectorAll<SVGElement>('[data-map-room]').forEach(button => {
    button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); scene.focusRoom(button.dataset.mapRoom!); } };
  });
}

function renderMinimap(area: Area, scene: OfficeScene) {
  const svg = get('minimap') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${area.width} ${area.height}`);
  svg.innerHTML = area.id === 'corridor' ? corridorMarkup() : roomMarkup(area);
  get('map-title').textContent = area.id === 'corridor' ? '1F · 楼层导览' : `${area.name} · 室内`;
  get('focus-exit').hidden = area.id === 'corridor';
  if (area.id === 'corridor') bindRooms(scene);
}

export function bindMapPanel(scene: OfficeScene, network: Network) {
  // Tracks which plan is currently painted so a rebuild only happens on an actual area change —
  // the snapshot arrives ~15/s and re-painting the SVG every tick would flicker for nothing.
  let shownArea: AreaId = 'corridor';
  const showArea = (area: Area) => { if (area.id === shownArea) return; shownArea = area.id; renderMinimap(area, scene); };
  renderMinimap(AREAS[shownArea], scene); // paint the corridor plan before the first snapshot lands

  get('zoom-out').onclick = () => scene.zoomBy(1 / 1.3);
  get('zoom-in').onclick = () => scene.zoomBy(1.3);
  get('zoom-fit').onclick = () => scene.overview();
  get('locate-player').onclick = () => scene.locatePlayer();
  get('map-toggle').onclick = () => {
    const collapsed = !get('minimap-body').hidden;
    get('minimap-body').hidden = collapsed;
    get('map-toggle').setAttribute('aria-expanded', String(!collapsed));
    get('map-toggle-label').textContent = collapsed ? '展开 ＋' : '收起 −';
  };
  // Spec called for a pathfinding walk to the door; that needs obstacle avoidance inside a
  // furnished room, a subsystem of its own. This only points the camera at the exit — the
  // player still walks there — hence the "看向" wording rather than anything that says "leave".
  get('focus-exit').onclick = () => {
    const exit = AREAS[shownArea].exits[0]; if (!exit) return;
    scene.lookAt(exit.rect.x + exit.rect.width / 2, exit.rect.y + exit.rect.height / 2);
  };
  // RTS minimap: press or drag anywhere to send the camera there; a room still frames the room.
  const minimap = get('minimap') as unknown as SVGSVGElement;
  const worldAt = (event: PointerEvent) => {
    const area = AREAS[shownArea];
    const box = minimap.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * area.width, y: (event.clientY - box.top) / box.height * area.height };
  };
  minimap.onpointerdown = event => {
    event.preventDefault();
    minimap.setPointerCapture(event.pointerId);
    const room = (event.target as Element).closest<SVGElement>('[data-map-room]');
    if (room) scene.focusRoom(room.dataset.mapRoom!);
    else { const { x, y } = worldAt(event); scene.lookAt(x, y); }
  };
  minimap.onpointermove = event => {
    if (!minimap.hasPointerCapture(event.pointerId)) return;
    const { x, y } = worldAt(event); scene.lookAt(x, y);
  };
  network.addEventListener('camera', event => {
    const view = (event as CustomEvent<CameraView>).detail;
    get('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`;
    get('locate-player').setAttribute('aria-pressed', String(view.following));
    (get('zoom-out') as HTMLButtonElement).disabled = view.zoom <= 1.001;
    (get('zoom-in') as HTMLButtonElement).disabled = view.atMax;
    // view is already expressed in the currently-drawn area's coordinate space (OfficeCamera
    // tracks the same area the scene just cut to), so no projection is needed here.
    const area = AREAS[shownArea];
    const x = Math.max(0, view.x), y = Math.max(0, view.y);
    const viewport = get('map-viewport');
    for (const [key, value] of Object.entries({ x, y, width: Math.max(0, Math.min(area.width, view.x + view.width) - x), height: Math.max(0, Math.min(area.height, view.y + view.height) - y) })) viewport.setAttribute(key, String(value));
  });
  network.addEventListener('snapshot', () => {
    const snapshot = network.snapshot, office = snapshot?.zone !== 'dungeon';
    get('map-panel').hidden = !office; get('camera-toolbar').hidden = !office;
    document.querySelector('.stage')!.classList.toggle('is-dungeon', !office);
    const player = snapshot?.players.find(p => p.id === network.profile?.id);
    if (office && player) showArea(AREAS[player.area]);
    const area = AREAS[shownArea];
    const dot = (p: Actor, pos: { x: number; y: number }) => `<circle cx="${pos.x}" cy="${pos.y}" r="${p.id === player?.id ? 30 : 22}" fill="${p.id === player?.id ? '#c0f3c8' : '#e4c88d'}" stroke="#172b24" stroke-width="12"/>`;
    // Corridor view: the whole floor's population, each projected onto their own area's footprint
    // (identity for corridor players) so the overview stays informative about who is where.
    // Room view: only that room's own occupants, drawn at their raw local coordinates — projecting
    // everyone else's numbers onto this one room's plan would be meaningless, and drawing the whole
    // floor's dots on a single room's footprint would misrepresent who's actually in the room.
    const dots = area.id === 'corridor'
      ? (snapshot?.players ?? []).map(p => dot(p, projectTo(AREAS[p.area], p.x, p.y)))
      : (snapshot?.players ?? []).filter(p => p.area === area.id).map(p => dot(p, p));
    get('map-players').innerHTML = office ? dots.join('') : '';
    const room = player && player.area === 'corridor' ? roomAt(player.x, player.y) : undefined;
    document.querySelectorAll<SVGElement>('[data-map-room]').forEach(button => {
      const active = button.dataset.mapRoom === room?.id;
      button.classList.toggle('current', active);
      if (active) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
    });
  });
}
