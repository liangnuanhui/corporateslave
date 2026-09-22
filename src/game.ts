import Phaser from 'phaser';
import { WORLD, type Actor, type Enemy, type Input } from '../shared/game';
import { Network } from './network';

interface Visual { sprite: Phaser.GameObjects.Sprite; label: Phaser.GameObjects.Text; health: Phaser.GameObjects.Graphics; shadow: Phaser.GameObjects.Ellipse }
export class OfficeScene extends Phaser.Scene {
  private visuals = new Map<string, Visual>();
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private background!: Phaser.GameObjects.Image;
  private seq = 0;
  private inputElapsed = 0;
  private isReady = false;
  private activeRoom = '';
  private jumpQueued = false;
  private lastJump = false;
  private touch = { left: false, right: false, jump: false, attack: false };
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
    this.add.rectangle(0, 0, WORLD.width, 110, 0x101820, 0.15).setOrigin(0);
    this.preview = this.add.sprite(420, WORLD.floor, 'atlas', 0).setOrigin(0.5, 1).setDisplaySize(85, 100);
    this.offline = this.add.text(WORLD.width / 2, WORLD.height - 58, '创建角色，开启你的下班冒险', { fontSize: '18px', fontFamily: 'sans-serif', color: '#fff4dd', backgroundColor: '#16202bd9', padding: { x: 20, y: 12 } }).setOrigin(0.5);
    this.keys = this.input.keyboard!.addKeys('A,D,W,SPACE,J,E,LEFT,RIGHT,UP') as Record<string, Phaser.Input.Keyboard.Key>;
    // Capture game keys only while the canvas has focus; dialogs keep normal typing.
    this.input.keyboard!.removeCapture(['A','D','W','SPACE','J','E','LEFT','RIGHT','UP']);
    this.network.addEventListener('hit', event => { if (this.isReady) this.hit((event as CustomEvent).detail); });
    this.network.addEventListener('snapshot', () => {
      if (this.network.snapshot?.roomId !== this.activeRoom) { this.activeRoom = this.network.snapshot?.roomId || ''; this.seq = 0; }
    });
    window.addEventListener('blur', () => this.resetInput());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.resetInput(); });
    this.isReady = true;
    this.game.canvas.setAttribute('aria-label', '办公室游戏场景，A D 移动，空格跳跃，J 攻击，E 互动');
  }
  touchInput(key: keyof typeof this.touch, value: boolean) { this.touch[key] = value; if (key === 'jump' && value) this.jumpQueued = true; }
  resetInput() {
    this.input.keyboard?.resetKeys(); this.touch = { left: false, right: false, jump: false, attack: false };
    this.network.input({ ...this.touch, seq: ++this.seq });
  }
  update(time: number, delta: number) {
    if (!this.isReady) return;
    const snap = this.network.snapshot;
    const blocked = this.blocked() || document.hidden || !document.hasFocus();
    const jump = !blocked && (this.keys.SPACE.isDown || this.keys.W.isDown || this.keys.UP.isDown || this.touch.jump);
    if (jump && !this.lastJump) this.jumpQueued = true; this.lastJump = jump;
    this.inputElapsed += Math.min(delta, 100);
    if (this.inputElapsed >= 1000 / 30) {
      this.inputElapsed %= 1000 / 30;
      const input: Input = {
        left: !blocked && (this.keys.A.isDown || this.keys.LEFT.isDown || this.touch.left),
        right: !blocked && (this.keys.D.isDown || this.keys.RIGHT.isDown || this.touch.right),
        jump: !blocked && this.jumpQueued, attack: !blocked && (this.keys.J.isDown || this.touch.attack), seq: ++this.seq,
      };
      this.network.input(input); this.jumpQueued = false;
    }
    if (!blocked && Phaser.Input.Keyboard.JustDown(this.keys.E)) this.interact();
    this.offline.setVisible(!this.network.connected);
    this.offline.setText(this.network.profile ? '连接中断 · 请点击右上角重新连接' : '创建角色，开启你的下班冒险');
    this.preview?.setVisible(!snap);
    if (!snap) return;
    this.background.setTint(snap.zone === 'dungeon' ? 0xb2a5d5 : 0xffffff);
    const ids = new Set([...snap.players.map(p=>p.id), ...snap.enemies.map(e=>e.id)]);
    for (const [id, v] of this.visuals) if (!ids.has(id)) { v.sprite.destroy(); v.label.destroy(); v.health.destroy(); v.shadow.destroy(); this.visuals.delete(id); }
    for (const player of snap.players) this.renderActor(player, false, time, delta);
    for (const enemy of snap.enemies) this.renderActor(enemy, true, time, delta);
  }
  private renderActor(actor: Actor | Enemy, enemy: boolean, time: number, delta: number) {
    let v = this.visuals.get(actor.id);
    const boss = enemy && actor.id === 'overtime';
    const width = enemy ? boss ? 100 : 77 : 81;
    const height = enemy ? boss ? 92 : 70 : 96;
    if (!v) {
      const shadow = this.add.ellipse(actor.x, WORLD.floor - 1, width * .64, 9, 0x10151b, .28);
      const sprite = this.add.sprite(actor.x, actor.y, 'atlas', enemy ? 8 : 0).setOrigin(.5, 1);
      const label = this.add.text(actor.x, actor.y - height - 18, '', { fontSize: '15px', fontFamily: 'system-ui, sans-serif', color: '#f5eedc', backgroundColor: '#111820dd', padding: {x: 7, y: 4} }).setOrigin(.5,1);
      const health = this.add.graphics(); v = { sprite, label, shadow, health }; this.visuals.set(actor.id, v);
    }
    const my = actor.id === this.network.profile?.id;
    const blend = 1 - Math.exp(-Math.min(delta, 100) / (my ? 28 : 55));
    v.sprite.x = Phaser.Math.Linear(v.sprite.x, actor.x, blend);
    v.sprite.y = Phaser.Math.Linear(v.sprite.y, actor.y, blend);
    let frame = 0;
    if (enemy) frame = actor.hp === 0 ? 11 : actor.action === 'attack' ? 10 : actor.action === 'walk' ? 8 + Math.floor(time / 160) % 2 : 8;
    else frame = actor.hp === 0 || actor.action === 'hurt' ? 5 : actor.action === 'attack' ? 4 : actor.action === 'jump' ? 3 : actor.action === 'walk' ? 1 + Math.floor(time / 120) % 2 : this.network.snapshot?.status === 'complete' ? 6 : 0;
    v.sprite.setFrame(frame).setDisplaySize(width, height).setFlipX(enemy ? actor.face > 0 : actor.face < 0).setAlpha(actor.hp === 0 ? .4 : 1);
    const role = 'role' in actor ? actor.role : '';
    v.sprite.setTint(actor.action === 'hurt' ? 0xffb2a2 : role === 'senior' ? 0xc8b8ff : role === 'lead' ? 0xffd5a5 : 0xffffff);
    v.sprite.setDepth(20); v.label.setDepth(30); v.health.setDepth(30);
    v.label.setText(actor.name + (my ? ' · 你' : '') + (!actor.hp && !enemy ? ' · 休息中' : '')).setPosition(v.sprite.x, v.sprite.y-height-10).setColor(my ? '#a6e8c2' : '#f5eedc');
    v.health.clear();
    if (enemy && actor.hp > 0) { v.health.fillStyle(0x17202a).fillRect(v.sprite.x-32,v.sprite.y-height-9,64,5); v.health.fillStyle(0xd4a2f5).fillRect(v.sprite.x-32,v.sprite.y-height-9,64*actor.hp/(actor as Enemy).maxHp,5); }
    v.shadow.setPosition(v.sprite.x,WORLD.floor).setVisible(actor.hp > 0);
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
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene, audio: { noAudio: true }, banner: false,
  });
  return { game, scene };
}
