import { corridor, roomAt, AREAS, type Area, type AreaId } from '../shared/world';
import { corridorMarkup, roomMarkup, minimapDots, minimapBubbles, bubbleMarkup, type MinimapDot } from './minimap';
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
    <div class="camera-toolbar" id="camera-toolbar" aria-label="地图视角控制">
      <div class="camera-zoom"><button id="zoom-out" aria-label="缩小视野" title="缩小">−</button><output id="zoom-level" aria-live="off">100%</output><button id="zoom-in" aria-label="放大视野" title="放大">＋</button></div>
      <div class="camera-modes"><button id="zoom-fit">全景</button><button id="locate-player" aria-pressed="false">跟随我</button></div>
    </div>
  </div>`;

const get = (id: string) => document.getElementById(id)!;

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
  // Driven by the scene's own 'area' event (see game.ts), not by the snapshot's player.area:
  // the snapshot flips the instant the server moves you, but the camera's cut is deliberately
  // delayed behind the fade curtain, so the two disagree for up to ~260ms on every transition.
  // The minimap must track what the camera is actually showing, not what the server just decided.
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
  // Fired by the scene the instant it actually cuts to a new area (see game.ts) — the single
  // source of truth for what the camera is showing right now.
  network.addEventListener('area', event => showArea(AREAS[(event as CustomEvent<AreaId>).detail]));
  network.addEventListener('camera', event => {
    const view = (event as CustomEvent<CameraView>).detail;
    get('zoom-level').textContent = `${Math.round(view.zoom * 100)}%`;
    get('locate-player').setAttribute('aria-pressed', String(view.following));
    (get('zoom-out') as HTMLButtonElement).disabled = view.zoom <= 1.001;
    (get('zoom-in') as HTMLButtonElement).disabled = view.atMax;
    // view is expressed in whatever area the camera itself is currently configured for. Because
    // shownArea now only ever changes on the scene's own 'area' event (fired at the same instant
    // officeCamera.configure() runs), the two are updated atomically — there is no frame where
    // this clamps view against the wrong area's dimensions.
    const area = AREAS[shownArea];
    const x = Math.max(0, view.x), y = Math.max(0, view.y);
    const viewport = get('map-viewport');
    for (const [key, value] of Object.entries({ x, y, width: Math.max(0, Math.min(area.width, view.x + view.width) - x), height: Math.max(0, Math.min(area.height, view.y + view.height) - y) })) viewport.setAttribute(key, String(value));
  });
  network.addEventListener('snapshot', () => {
    const snapshot = network.snapshot, office = snapshot?.zone !== 'dungeon';
    get('map-panel').hidden = !office; // 视角工具条是它的子元素，跟着一起藏
    document.querySelector('.stage')!.classList.toggle('is-dungeon', !office);
    const player = snapshot?.players.find(p => p.id === network.profile?.id);
    const area = AREAS[shownArea];
    const dot = (d: MinimapDot) => `<circle cx="${d.x}" cy="${d.y}" r="${d.r}" fill="${d.self ? '#c0f3c8' : '#e4c88d'}" stroke="#172b24" stroke-width="12"/>`;
    const players = snapshot?.players ?? [];
    const dots = office ? minimapDots(area, players, player?.id).map(dot).join('') : '';
    const bubbles = office
      ? minimapBubbles(area, players, scene.bubbles.live(), network.profile?.name).map(bubbleMarkup).join('')
      : '';
    get('map-players').innerHTML = dots + bubbles;
    const room = player && player.area === 'corridor' ? roomAt(player.x, player.y) : undefined;
    document.querySelectorAll<SVGElement>('[data-map-room]').forEach(button => {
      const active = button.dataset.mapRoom === room?.id;
      button.classList.toggle('current', active);
      if (active) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
    });
  });
}
