import { OFFICE, OFFICE_ROOMS, OFFICE_WALLS, roomAt } from '../shared/office';
import type { OfficeScene } from './game';
import type { CameraView } from './office-camera';
import type { Network } from './network';

export const mapPanelMarkup = `
  <div class="map-panel" id="map-panel">
    <button class="map-heading" id="map-toggle" aria-expanded="true" aria-controls="minimap-body"><span><i></i>1F · 楼层导览</span><span id="map-toggle-label">收起 −</span></button>
    <div id="minimap-body">
      <svg id="minimap" viewBox="0 0 ${OFFICE.width} ${OFFICE.height}" aria-label="办公室小地图，点击或拖拽移动视角" role="group">
        <rect x="40" y="60" width="1840" height="1080" rx="12" fill="#263830"/>
        <path d="M80 600H1840" stroke="#566954" stroke-width="120"/>
        ${OFFICE_ROOMS.map(room => `<g data-map-room="${room.id}" tabindex="0" role="button" aria-label="查看${room.name}" class="map-room"><rect x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" fill="#42574a"/><text x="${room.x + room.width / 2}" y="${room.y + room.height / 2}" text-anchor="middle" dominant-baseline="central">${room.name}</text></g>`).join('')}
        <g fill="#85937b" pointer-events="none">${OFFICE_WALLS.map(w => `<rect x="${w.x}" y="${w.y}" width="${w.width}" height="${w.height}"/>`).join('')}</g>
        <rect id="map-viewport" class="map-viewport" x="0" y="0" width="1920" height="1200"/>
        <g id="map-players" pointer-events="none"></g>
      </svg>
      <div class="map-caption"><span><i></i>你的位置</span><span>点击 / 拖拽移视角</span></div>
    </div>
  </div>
  <div class="camera-toolbar" id="camera-toolbar" aria-label="地图视角控制">
    <button id="zoom-out" aria-label="缩小视野" title="缩小">−</button><output id="zoom-level" aria-live="off">100%</output><button id="zoom-in" aria-label="放大视野" title="放大">＋</button>
    <span class="camera-divider"></span><button id="zoom-fit">全景</button><button id="locate-player" aria-pressed="false">跟随我</button>
  </div>`;

export function bindMapPanel(scene: OfficeScene, network: Network) {
  const get = (id: string) => document.getElementById(id)!;
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
  document.querySelectorAll<SVGElement>('[data-map-room]').forEach(button => {
    button.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); scene.focusRoom(button.dataset.mapRoom!); } };
  });
  // RTS minimap: press or drag anywhere to send the camera there; a room still frames the room.
  const minimap = get('minimap') as unknown as SVGSVGElement;
  const worldAt = (event: PointerEvent) => {
    const box = minimap.getBoundingClientRect();
    return { x: (event.clientX - box.left) / box.width * OFFICE.width, y: (event.clientY - box.top) / box.height * OFFICE.height };
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
    const x = Math.max(0, view.x), y = Math.max(0, view.y);
    const viewport = get('map-viewport');
    for (const [key, value] of Object.entries({ x, y, width: Math.max(0, Math.min(OFFICE.width, view.x + view.width) - x), height: Math.max(0, Math.min(OFFICE.height, view.y + view.height) - y) })) viewport.setAttribute(key, String(value));
  });
  network.addEventListener('snapshot', () => {
    const snapshot = network.snapshot, office = snapshot?.zone !== 'dungeon';
    get('map-panel').hidden = !office; get('camera-toolbar').hidden = !office;
    document.querySelector('.stage')!.classList.toggle('is-dungeon', !office);
    const player = snapshot?.players.find(p => p.id === network.profile?.id);
    const room = player && roomAt(player.x, player.y);
    get('map-players').innerHTML = office ? (snapshot?.players ?? []).map(p => `<circle cx="${p.x}" cy="${p.y}" r="${p.id === player?.id ? 30 : 22}" fill="${p.id === player?.id ? '#c0f3c8' : '#e4c88d'}" stroke="#172b24" stroke-width="12"/>`).join('') : '';
    document.querySelectorAll<SVGElement>('[data-map-room]').forEach(button => {
      const active = button.dataset.mapRoom === room?.id;
      button.classList.toggle('current', active);
      if (active) button.setAttribute('aria-current', 'location'); else button.removeAttribute('aria-current');
    });
  });
}
