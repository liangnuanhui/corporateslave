import Phaser from 'phaser';
import { WORLD, type Actor, type Enemy, type Input } from '../shared/game';
import { Network } from './network';
import { AREAS, corridor, CORRIDOR_ROOMS, type AreaId } from '../shared/world';
import { drawArea, createOfficeAvatar } from './render/area-renderer';
import { currentSite } from './site-map';
import { OfficeCamera } from './office-camera';
import { TRANSITION_TIMEOUT_MS, gateTransition, shouldStartFadeOut } from './office-transition';

interface Visual { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; health: Phaser.GameObjects.Graphics; shadow: Phaser.GameObjects.Ellipse }
export class OfficeScene extends Phaser.Scene {
  private visuals = new Map<string, Visual>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private background!: Phaser.GameObjects.Image;
  private floorPlan?: Phaser.GameObjects.Container;
  private officeCamera!: OfficeCamera;
  private officeMode = true;
  private currentArea: AreaId = 'corridor';
  /** Set while a door's `transition` message is in flight, so the authority rule in update() holds
   *  the hard cut until the curtain camera-fade is actually dark instead of cutting through it. */
  private transitionPending = false;
  private transitionDeadline = 0;
  /** True while `transitionPending` was raised by `playOpening()` rather than a door crossing —
   *  same gate, same wait/cut timing, but no fade cosmetic (nothing was ever faded out) and the
   *  camera pushes in on the player once the cut lands, instead of just clearing the curtain. */
  private openingHold = false;
  private openingResolve?: () => void;
  private openingSkip?: () => void;
  private cameraElapsed = 0;
  private seq = 0;
  private inputElapsed = 0;
  private isReady = false;
  private activeRoom = '';
  private jumpQueued = false;
  private lastJump = false;
  private touch = { left: false, right: false, up: false, down: false, jump: false, attack: false };
  private preview?: Phaser.GameObjects.Sprite;
  private offline!: Phaser.GameObjects.Text;
  constructor(private network: Network, private blocked: () => boolean, private interact: () => void) { super('office'); }
  preload() {
    this.load.image('office', '/assets/office.png');
    this.load.image('atlas', '/assets/atlas.png');
    this.load.on('loaderror', () => this.network.emit('notice', '场景素材加载失败，请刷新重试'));
  }
  create() {
    const rects = [
      [28, 35, 265, 310], [340, 35, 275, 310], [660, 35, 275, 310], [970, 20, 275, 310],
      [8, 350, 320, 310], [330, 350, 300, 310], [635, 350, 305, 310], [970, 345, 280, 310],
      [20, 695, 285, 245], [335, 695, 285, 245], [635, 690, 305, 250], [950, 690, 300, 250],
      [70, 1000, 190, 180], [325, 940, 285, 305], [650, 955, 285, 290], [960, 940, 290, 305],
    ];
    rects.forEach(([x,y,w,h], i) => this.textures.get('atlas').add(i, 0, x,y,w,h));
    this.background = this.add.image(0, 0, 'office').setOrigin(0).setDisplaySize(WORLD.width, WORLD.height);
    this.background.setVisible(false);
    this.floorPlan = drawArea(this, corridor, currentSite().name);
    createOfficeAvatar(this);
    this.officeCamera = new OfficeCamera(this, this.blocked);
    this.officeCamera.configure(corridor);
    this.preview = this.add.sprite(corridor.spawnPoints[0].x, corridor.spawnPoints[0].y, 'office-avatar').setOrigin(.5).setDisplaySize(38, 40).setDepth(corridor.spawnPoints[0].y + 12);
    this.offline = this.add.text(WORLD.width / 2, WORLD.height - 58, '创建角色，开启你的下班冒险', { fontSize: '16px', fontFamily: 'sans-serif', color: '#fff4dd', backgroundColor: '#16202bd9', padding: { x: 20, y: 12 } }).setOrigin(0.5).setScrollFactor(0).setDepth(100).setVisible(false);
    this.keys = this.input.keyboard!.addKeys('A,D,W,S,SPACE,J,E,LEFT,RIGHT,UP,DOWN') as Record<string, Phaser.Input.Keyboard.Key>;
    // Capture game keys only while the canvas has focus; dialogs keep normal typing.
    this.input.keyboard!.removeCapture(['A','D','W','S','SPACE','J','E','LEFT','RIGHT','UP','DOWN']);
    this.network.addEventListener('hit', event => { if (this.isReady) this.hit((event as CustomEvent).detail); });
    this.network.addEventListener('transition', event => this.playTransition((event as CustomEvent).detail.name));
    this.network.addEventListener('snapshot', () => {
      if (this.network.snapshot?.roomId !== this.activeRoom) { this.activeRoom = this.network.snapshot?.roomId || ''; this.seq = 0; }
    });
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetInput(); });
    this.isReady = true;
    this.game.canvas.setAttribute('aria-label', '俯瞰办公室，W A S D 或方向键移动人物，滚轮以光标为中心缩放，拖拽或把鼠标推到画面边缘移动视角，E 互动');
  }
  touchInput(key: keyof typeof this.touch, value: boolean) { this.touch[key] = value; if (key === 'jump' && value) this.jumpQueued = true; }
  resetInput() {
    // Callable before the scene has booted: window blur, visibilitychange and (now) the very first
    // 工牌 dialog can all fire while `this.input` is still undefined. Throwing there used to surface
    // as "服务器暂时无法连接" from main.ts's catch-all, which points at entirely the wrong thing.
    this.input?.keyboard?.resetKeys(); this.touch = { left: false, right: false, up: false, down: false, jump: false, attack: false };
    this.jumpQueued = false; this.lastJump = false;
    this.network.input({ ...this.touch, seq: ++this.seq });
  }
  update(time: number, delta: number) {
    if (!this.isReady) return;
    const snap = this.network.snapshot;
    const blocked = this.blocked() || document.hidden || !document.hasFocus();
    const office = snap?.zone !== 'dungeon';
    const area = office ? (snap?.players.find(p => p.id === this.network.profile?.id)?.area ?? this.currentArea) : null;
    // The snapshot is the authority: the moment the drawn area disagrees with it, cut to the new one —
    // immediately if no transition is pending (reconnect, a missed message), otherwise once the
    // curtain is actually dark, so the cut never shows through a half-transparent fade. gateTransition
    // is the pure, unit-tested state machine behind this decision — see office-transition.ts.
    const mismatched = Boolean(office !== this.officeMode || (area && area !== this.currentArea));
    const action = gateTransition(mismatched, this.transitionPending, this.cameras.main.fadeEffect.progress, time, this.transitionDeadline);
    if (action === 'clear') {
      this.transitionPending = false;
      // The opening's hold never darkened the curtain (there's nothing to reveal), so it resolves
      // quietly instead of playing the door's fade-back-in. 'clear' (rather than 'cut') means the
      // area never actually mismatched — we spawned in the corridor itself, the one already drawn —
      // so there's no rebuild to hang the push-in on; do it here instead.
      if (this.openingHold) {
        this.openingHold = false;
        const actor = snap?.players.find(p => p.id === this.network.profile?.id);
        if (actor) this.officeCamera.focus(actor.x, actor.y);
        this.endOpening();
      }
      else this.cameras.main.fadeIn(220, 0x0b, 0x11, 0x16);
    }
    else if (action === 'cut') {
      const pending = this.transitionPending, opening = this.openingHold;
      this.transitionPending = false; this.openingHold = false;
      this.officeMode = office; this.currentArea = area ?? this.currentArea;
      this.floorPlan?.destroy();
      this.floorPlan = office ? drawArea(this, AREAS[this.currentArea], currentSite().name) : undefined;
      this.background.setVisible(!office);
      this.officeCamera.configure(office ? AREAS[this.currentArea] : null);
      // The minimap must switch in lockstep with the camera, not with the snapshot: the snapshot's
      // player.area flips the instant the server moves you, but this cut (and the camera's own area)
      // is deliberately delayed behind the fade curtain. Emitting here — exactly when the camera
      // actually re-configures — is the one moment the two are guaranteed to agree.
      if (office) this.network.emit('area', this.currentArea);
      for (const v of this.visuals.values()) { v.sprite.destroy(); v.label.destroy(); v.health.destroy(); v.shadow.destroy(); }
      this.visuals.clear(); this.resetInput();
      if (opening) {
        // The opening's whole point: land the push on wherever the server actually spawned us.
        const actor = snap?.players.find(p => p.id === this.network.profile?.id);
        if (actor) this.officeCamera.focus(actor.x, actor.y);
        this.endOpening();
      }
      // Only a curtain we actually darkened needs clearing back — a bare authority hard cut stays
      // an instant cut, exactly as it was before this feature existed.
      else if (pending) this.cameras.main.fadeIn(220, 0x0b, 0x11, 0x16);
    }
    const jump = !office && !blocked && (this.keys.SPACE.isDown || this.keys.W.isDown || this.keys.UP.isDown || this.touch.jump);
    if (jump && !this.lastJump) this.jumpQueued = true; this.lastJump = jump;
    this.inputElapsed += Math.min(delta, 100);
    if (this.inputElapsed >= 1000 / 30) {
      this.inputElapsed %= 1000 / 30;
      const input: Input = {
        left: !blocked && (this.keys.A.isDown || this.keys.LEFT.isDown || this.touch.left),
        right: !blocked && (this.keys.D.isDown || this.keys.RIGHT.isDown || this.touch.right),
        up: office && !blocked && (this.keys.W.isDown || this.keys.UP.isDown || this.touch.up),
        down: office && !blocked && (this.keys.S.isDown || this.keys.DOWN.isDown || this.touch.down),
        jump: !blocked && this.jumpQueued, attack: !blocked && (this.keys.J.isDown || this.touch.attack), seq: ++this.seq,
      };
      this.network.input(input); this.jumpQueued = false;
    }
    if (!blocked && Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interact();
    this.offline.setVisible(!office && !this.network.connected);
    this.offline.setText(this.network.profile ? '连接中断 · 请点击右上角重新连接' : '创建角色，开启你的下班冒险');
    this.preview?.setVisible(!snap);
    this.officeCamera.update(delta, snap?.players.find(p => p.id === this.network.profile?.id));
    this.cameraElapsed += delta;
    if (this.cameraElapsed >= 70) { this.cameraElapsed = 0; this.network.emit('camera', this.officeCamera.view); }
    if (!snap) return;
    this.background.setTint(snap.zone === 'dungeon' ? 0xb2a5d5 : 0xffffff);
    // Another area is another room: its players are not drawn at all, and their visuals go away.
    const visible = office ? snap.players.filter(p => p.area === this.currentArea) : snap.players;
    const ids = new Set([...visible.map(p=>p.id), ...snap.enemies.map(e=>e.id)]);
    for (const [id, v] of this.visuals) if (!ids.has(id)) { v.sprite.destroy(); v.label.destroy(); v.health.destroy(); v.shadow.destroy(); this.visuals.delete(id); }
    for (const player of visible) this.renderActor(player, false, time, delta);
    for (const enemy of snap.enemies) this.renderActor(enemy, true, time, delta);
  }
  private renderActor(actor: Actor | Enemy, enemy: boolean, time: number, delta: number) {
    let v = this.visuals.get(actor.id);
    const boss = enemy && actor.id === 'overtime';
    const office = this.officeMode;
    const width = office ? 38 : enemy ? boss ? 100 : 77 : 81;
    const height = office ? 40 : enemy ? boss ? 92 : 70 : 96;
    if (!v) {
      const shadow = this.add.ellipse(actor.x, WORLD.floor - 1, width * .64, 9, 0x10151b, .28);
      const sprite = this.add.sprite(actor.x, actor.y, office ? 'office-avatar' : 'atlas', office ? undefined : enemy ? 8 : 0).setOrigin(.5, office ? .5 : 1);
      const label = this.add.text(actor.x, actor.y - height - 18, '', { fontSize: office ? '16px' : '15px', fontFamily: 'system-ui, sans-serif', color: '#f5eedc', backgroundColor: '#111820dd', padding: {x: 7, y: 4} }).setOrigin(.5,1);
      const health = this.add.graphics(); v = { sprite, label, shadow, health }; this.visuals.set(actor.id, v);
    }
    const my = actor.id === this.network.profile?.id;
    const blend = 1 - Math.exp(-Math.min(delta, 100) / (my ? 28 : 55));
    v.sprite.x = Phaser.Math.Linear(v.sprite.x, actor.x, blend);
    v.sprite.y = Phaser.Math.Linear(v.sprite.y, actor.y, blend);
    let frame = 0;
    if (enemy) frame = actor.hp === 0 ? 11 : actor.action === 'attack' ? 10 : actor.action === 'walk' ? 8 + Math.floor(time / 160) % 2 : 8;
    else frame = actor.hp === 0 || actor.action === 'hurt' ? 5 : actor.action === 'attack' ? 4 : actor.action === 'jump' ? 3 : actor.action === 'walk' ? 1 + Math.floor(time / 120) % 2 : this.network.snapshot?.status === 'complete' ? 6 : 0;
    if (!office) v.sprite.setFrame(frame);
    v.sprite.setDisplaySize(width, height).setFlipX(enemy ? actor.face > 0 : actor.face < 0).setAlpha(actor.hp === 0 ? .4 : 1);
    const role = 'role' in actor ? actor.role : '';
    v.sprite.setTint(actor.action === 'hurt' ? 0xffb2a2 : role === 'senior' ? 0xc8b8ff : role === 'lead' ? 0xffd5a5 : 0xffffff);
    // Oblique depth: whoever stands lower on the floor is in front. Labels never take part.
    const depth = office ? v.sprite.y + 12 : 20;
    v.sprite.setDepth(depth); v.shadow.setDepth(depth - 1); v.label.setDepth(10000); v.health.setDepth(10000);
    v.label.setText(actor.name + (my ? ' · 你' : '') + (!actor.hp && !enemy ? ' · 休息中' : '')).setPosition(v.sprite.x, v.sprite.y - (office ? 26 : height + 10)).setColor(my ? '#a6e8c2' : '#f5eedc');
    v.health.clear();
    if (enemy && actor.hp > 0) { v.health.fillStyle(0x17202a).fillRect(v.sprite.x-32,v.sprite.y-height-9,64,5); v.health.fillStyle(0xd4a2f5).fillRect(v.sprite.x-32,v.sprite.y-height-9,64*actor.hp/(actor as Enemy).maxHp,5); }
    v.shadow.setPosition(v.sprite.x, office ? v.sprite.y + 12 : WORLD.floor).setVisible(actor.hp > 0);
  }
  /** Opening: hold the whole floor for a beat, then push into wherever the server spawned us.
   *  The first snapshot can arrive saying we're already in a room, and update()'s authority rule
   *  would otherwise cut there before the overview is even seen — so this holds it back through
   *  the very same gate a door crossing uses (`transitionPending` / `transitionDeadline` /
   *  `gateTransition`), just tagged `openingHold` so the cut branch pushes the camera in on us
   *  instead of playing the door's fade cosmetic. No second decision path, no second write to
   *  `currentArea`. Any key or click fast-forwards the deadline, which the gate already treats
   *  as "overdue" — the same code that ends the hold on time ends it on skip.
   *  `skipped` covers a press that landed *before* this call — during the map, or during the
   *  initialJoin() network round trip main.ts awaits before calling this — since neither of those
   *  stages has this method's own listeners yet. Checked once, at entry, is enough: a press during
   *  the hold itself is still caught live by the listeners registered below. */
  playOpening(skipped?: () => boolean) {
    if (this.transitionPending) return Promise.resolve(); // a real door transition is already in flight
    this.officeCamera.configure(AREAS.corridor);
    this.openingHold = true;
    this.transitionPending = true;
    this.transitionDeadline = skipped?.() ? this.time.now : this.time.now + 1500;
    return new Promise<void>(resolve => {
      this.openingResolve = resolve;
      this.openingSkip = () => { this.transitionDeadline = this.time.now; };
      window.addEventListener('keydown', this.openingSkip); window.addEventListener('pointerdown', this.openingSkip);
    });
  }
  /** Tears down the opening's skip listeners and resolves its promise — called from update() the
   *  moment the held cut/clear actually lands, whether that was by timeout or by skip. */
  private endOpening() {
    if (this.openingSkip) { window.removeEventListener('keydown', this.openingSkip); window.removeEventListener('pointerdown', this.openingSkip); this.openingSkip = undefined; }
    this.openingResolve?.(); this.openingResolve = undefined;
  }
  zoomBy(factor: number) { this.officeCamera?.zoomBy(factor); }
  overview() { this.officeCamera?.overview(); }
  focusRoom(id: string) { const room = CORRIDOR_ROOMS.find(r => r.id === id); if (room) this.officeCamera?.focus(room.x + room.width / 2, room.y + room.height / 2); }
  lookAt(x: number, y: number) { this.officeCamera?.look(x, y); }
  locatePlayer() {
    if (this.officeCamera?.following) { this.officeCamera.following = false; return; }
    const actor = this.network.snapshot?.players.find(p => p.id === this.network.profile?.id);
    if (actor) this.officeCamera?.focus(actor.x, actor.y, true);
    else this.network.emit('notice', '创建角色后，即可定位并跟随人物');
  }
  /** Presentation only — the server already moved us; update()'s authority rule does the actual
   *  rebuild. This just earns it a dark screen to cut behind, and announces the room once it's dark. */
  private playTransition(name: string) {
    // Input isn't blocked during the opening, so a player can walk through a door mid-hold. Its
    // own (longer) deadline already governs when the cut lands — on whatever area they're in by
    // then, door crossing included — so a door's short timeout must not overwrite and truncate it.
    if (!this.openingHold) {
      // A second `transition` while one is already pending (quick in-and-out through a door) must not
      // restart the fade — Fade.start() would reset it to transparent and flash the stale scene.
      if (shouldStartFadeOut(this.transitionPending)) this.cameras.main.fadeOut(180, 0x0b, 0x11, 0x16);
      this.transitionPending = true;
      this.transitionDeadline = this.time.now + TRANSITION_TIMEOUT_MS;
    }
    this.network.emit('notice', `进入${name}`);
  }
  private hit(data: { x: number; y: number; damage: number; id: string }) {
    const text = this.add.text(data.x,data.y, `−${data.damage}`, {fontSize:'24px',fontStyle:'bold',fontFamily:'monospace',color:data.id===this.network.profile?.id?'#ff9a8d':'#f8e1a1',stroke:'#161a22',strokeThickness:4}).setDepth(50);
    this.tweens.add({targets:text,y:data.y-40,alpha:0,duration:600,onComplete:()=>text.destroy()});
    window.dispatchEvent(new CustomEvent('game-sound', { detail: data.id === this.network.profile?.id ? 'hurt' : 'hit' }));
  }
}
export function createGame(network: Network, blocked: () => boolean, interact: () => void) {
  const scene = new OfficeScene(network, blocked, interact);
  const game = new Phaser.Game({ type: Phaser.AUTO, parent: 'game', width: WORLD.width, height: WORLD.height,
    backgroundColor:'#1a212b', pixelArt: true, roundPixels: true,
    input: { mouse: { preventDefaultWheel: true }, touch: true },
    scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
    scene, audio: { noAudio: true }, banner: false,
  });
  return { game, scene };
}
