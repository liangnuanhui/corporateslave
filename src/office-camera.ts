import Phaser from 'phaser';
import { corridor, type Area } from '../shared/world';
import { WORLD } from '../shared/game';

export interface CameraView { x: number; y: number; width: number; height: number; zoom: number; following: boolean; atMax: boolean }

/** Screen pixels from the viewport border that start an RTS-style edge scroll. */
const EDGE = 28;
/** Pan speed in screen pixels per second, so panning feels the same at every zoom. */
const EDGE_SPEED = 780;
const ZOOM_RESPONSE = 90;
/** The hint bar floats over the bottom of the stage (39-40px tall, measured). Framing an area into
 *  the band above it is the only way a room's south door stays visible. This was 86 while the zoom
 *  controls also floated there at bottom:45px; they now live in the map panel, and leaving the old
 *  value reserved a second toolbar's worth of empty floor that nothing draws in. */
const BOTTOM_UI = 44;

/**
 * Age-of-Empires style floor camera over one area: the wheel zooms about the cursor, the
 * screen edges and drags pan the view, and the arrow keys belong to the character alone.
 */
export class OfficeCamera {
  active = true;
  following = false;
  readonly maxZoom = 5;
  private area: Area = corridor;
  private center = { x: corridor.width / 2, y: corridor.height / 2 };
  private targetZoom = 1;
  /** World point held under the cursor for the whole smooth zoom, the way an RTS does it. */
  private anchor?: { world: { x: number; y: number }; screen: { x: number; y: number } };
  private glide?: { x: number; y: number };
  private dragging?: { x: number; y: number };
  private pinchDistance = 0;
  private pointer = { x: 0, y: 0, inside: false };
  constructor(private scene: Phaser.Scene, private blocked: () => boolean) {
    scene.input.addPointer(1);
    scene.input.mouse?.disableContextMenu();
    scene.input.on('wheel', (pointer: Phaser.Input.Pointer, _over: unknown, _dx: number, dy: number) => {
      if (!this.active || this.blocked()) return;
      this.zoomBy(Math.exp(-dy * .0016), pointer.x, pointer.y);
    });
    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (!this.active || this.blocked()) return;
      this.dragging = { x: pointer.x, y: pointer.y };
    });
    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      // Edge scrolling is a mouse gesture; a finger resting near a border must not scroll forever.
      this.pointer = { x: pointer.x, y: pointer.y, inside: !pointer.wasTouch };
      if (!this.active || this.blocked() || !pointer.isDown) return;
      const pointers = scene.input.manager.pointers.filter(p => p.isDown);
      if (pointers.length >= 2) {
        const distance = Phaser.Math.Distance.Between(pointers[0].x, pointers[0].y, pointers[1].x, pointers[1].y);
        if (this.pinchDistance) this.zoomBy(distance / this.pinchDistance, (pointers[0].x + pointers[1].x) / 2, (pointers[0].y + pointers[1].y) / 2);
        this.pinchDistance = distance; this.dragging = undefined; return;
      }
      if (this.dragging) this.panBy(-(pointer.x - this.dragging.x), -(pointer.y - this.dragging.y));
      this.dragging = { x: pointer.x, y: pointer.y };
    });
    const reset = () => { this.dragging = undefined; this.pinchDistance = 0; };
    const leave = () => { this.pointer.inside = false; reset(); };
    scene.input.on('pointerup', reset); scene.input.on('pointerupoutside', reset);
    scene.input.on('gameout', leave);
    window.addEventListener('blur', leave);
    const resize = () => this.resize();
    scene.scale.on('resize', resize);
    scene.events.once('shutdown', () => { window.removeEventListener('blur', leave); scene.scale.off('resize', resize); });
  }
  private get camera() { return this.scene.cameras.main; }
  /** Usable floor height: the bottom band belongs to the toolbar and the hint bar. */
  private get viewHeight() { return Math.max(100, this.camera.height - BOTTOM_UI); }
  get minZoom() { return Math.min(this.camera.width / this.area.width, this.viewHeight / this.area.height); }
  /** `null` means the dungeon. Switching area is a hard cut, so the overview lands at once. */
  configure(area: Area | null) {
    this.active = !!area;
    if (!area) { this.following = false; this.resize(); return; }
    this.area = area;
    // Changing area must not silently drop camera follow — the player never asked for that.
    const following = this.following;
    this.resize();
    this.overview();
    this.center = { x: this.area.width / 2, y: this.area.height / 2 };
    this.glide = undefined; this.following = following;
    this.camera.setZoom(this.targetZoom); this.apply();
  }
  private resize() {
    const relativeZoom = this.camera.zoom / this.minZoom;
    const { width, height } = this.scene.scale;
    if (this.active) {
      // The floor fills the whole stage; the minimap, HUD and toolbar float above it.
      this.camera.setViewport(0, 0, Math.max(100, width), Math.max(100, height));
      this.targetZoom = Phaser.Math.Clamp(this.minZoom * Math.max(1, relativeZoom), this.minZoom, this.maxZoom);
      this.camera.setZoom(this.targetZoom);
      this.anchor = undefined; this.apply();
    } else {
      this.camera.setViewport(0, 0, width, height).setZoom(Math.min(width / WORLD.width, height / WORLD.height));
      this.camera.centerOn(WORLD.width / 2, WORLD.height / 2);
    }
  }
  overview() {
    if (!this.active) return;
    this.following = false; this.anchor = undefined;
    this.targetZoom = this.minZoom;
    this.glide = { x: this.area.width / 2, y: this.area.height / 2 };
  }
  /** Zoom about a screen point, keeping the world under it pinned for the whole animation. */
  zoomBy(factor: number, screenX = this.camera.x + this.camera.width / 2, screenY = this.camera.y + this.camera.height / 2) {
    if (!this.active) return;
    const next = Phaser.Math.Clamp(this.targetZoom * factor, this.minZoom, this.maxZoom);
    if (Math.abs(next - this.targetZoom) < 1e-4) return;
    this.following = false; this.glide = undefined; this.targetZoom = next;
    const screen = { x: screenX - this.camera.x - this.camera.width / 2, y: screenY - this.camera.y - this.camera.height / 2 };
    this.anchor = { screen, world: { x: this.center.x + screen.x / this.camera.zoom, y: this.center.y + this.lookBelow + screen.y / this.camera.zoom } };
  }
  /** Move the view by a screen-space delta, so panning feels identical at every zoom. */
  private panBy(dx: number, dy: number) {
    this.following = false; this.anchor = undefined; this.glide = undefined;
    this.center.x += dx / this.camera.zoom;
    this.center.y += dy / this.camera.zoom;
    this.apply();
  }
  focus(x: number, y: number, following = false) {
    if (!this.active) return;
    this.following = following; this.anchor = undefined;
    this.targetZoom = Math.max(this.targetZoom, this.minZoom * 2.2);
    if (following) { this.center = { x, y }; this.glide = undefined; this.apply(); }
    else this.glide = { x, y };
  }
  /** Jump the view to a world point without changing the zoom — a minimap click. */
  look(x: number, y: number) {
    if (!this.active) return;
    this.following = false; this.anchor = undefined; this.glide = { x, y };
  }
  update(delta: number, actor?: { x: number; y: number }) {
    if (!this.active) return;
    const step = Math.min(delta, 100) / 1000;
    if (Math.abs(this.camera.zoom - this.targetZoom) > 1e-4) {
      this.camera.setZoom(Phaser.Math.Linear(this.camera.zoom, this.targetZoom, 1 - Math.exp(-Math.min(delta, 100) / ZOOM_RESPONSE)));
    }
    const pan = this.panInput(step);
    if (pan) this.panBy(pan.x, pan.y);
    else if (this.anchor) {
      this.center.x = this.anchor.world.x - this.anchor.screen.x / this.camera.zoom;
      // lookBelow shrinks as the zoom grows, so it has to be re-subtracted every frame.
      this.center.y = this.anchor.world.y - this.lookBelow - this.anchor.screen.y / this.camera.zoom;
      if (Math.abs(this.camera.zoom - this.targetZoom) <= 1e-4) this.anchor = undefined;
      this.apply();
    } else if (this.glide) {
      const blend = 1 - Math.exp(-Math.min(delta, 100) / ZOOM_RESPONSE);
      this.center.x = Phaser.Math.Linear(this.center.x, this.glide.x, blend);
      this.center.y = Phaser.Math.Linear(this.center.y, this.glide.y, blend);
      if (Phaser.Math.Distance.Between(this.center.x, this.center.y, this.glide.x, this.glide.y) < 1) this.glide = undefined;
      this.apply();
    } else if (this.following && actor) { this.center.x = actor.x; this.center.y = actor.y; this.apply(); }
    else this.apply();
  }
  /** Edge scroll while the cursor rests against the viewport border. The arrow keys belong
   *  to the character, so the mouse is the only keyboard-free way to move the view. */
  private panInput(step: number) {
    if (this.blocked() || document.hidden || !document.hasFocus()) return;
    let x = 0, y = 0;
    if (this.pointer.inside && !this.dragging) {
      const left = this.pointer.x - this.camera.x, right = this.camera.x + this.camera.width - this.pointer.x;
      const top = this.pointer.y - this.camera.y, bottom = this.camera.y + this.camera.height - this.pointer.y;
      if (left >= 0 && right >= 0 && top >= 0 && bottom >= 0) {
        if (left < EDGE) x -= EDGE_SPEED * step; else if (right < EDGE) x += EDGE_SPEED * step;
        if (top < EDGE) y -= EDGE_SPEED * step; else if (bottom < EDGE) y += EDGE_SPEED * step;
      }
    }
    return x || y ? { x, y } : undefined;
  }
  /** World distance the camera looks below the framed band's centre, to park it under the toolbar. */
  private get lookBelow() { return BOTTOM_UI / 2 / this.camera.zoom; }
  get view(): CameraView {
    const width = this.camera.width / this.camera.zoom, height = this.camera.height / this.camera.zoom;
    return { x: this.center.x - width / 2, y: this.center.y + this.lookBelow - height / 2, width, height, zoom: this.camera.zoom / this.minZoom, following: this.following, atMax: this.targetZoom >= this.maxZoom - .001 };
  }
  private apply() {
    const halfW = this.camera.width / this.camera.zoom / 2, halfH = this.viewHeight / this.camera.zoom / 2;
    this.center.x = halfW >= this.area.width / 2 ? this.area.width / 2 : Phaser.Math.Clamp(this.center.x, halfW, this.area.width - halfW);
    this.center.y = halfH >= this.area.height / 2 ? this.area.height / 2 : Phaser.Math.Clamp(this.center.y, halfH, this.area.height - halfH);
    this.camera.centerOn(this.center.x, this.center.y + this.lookBelow);
  }
}
