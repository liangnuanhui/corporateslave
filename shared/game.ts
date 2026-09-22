export const WORLD = { width: 1280, height: 720, floor: 552, tick: 1 / 30, speed: 235, gravity: 1450, jump: -565 };
export const ROLES = [
  { id: 'rookie', name: '职场新人', detail: '轻装上阵，认真下班', attack: 18, color: '#a6e8c2' },
  { id: 'senior', name: '资深摸鱼员', detail: '经验丰富，出手稳健', attack: 22, color: '#b8b1ee' },
  { id: 'lead', name: '下班组长', detail: '带好团队，准点收工', attack: 20, color: '#f1c48b' },
] as const;
export const WEAPONS = [
  { id: 'foam', name: '泡沫小剑', price: 0, damage: 0, frame: 13, description: '第一把装备，轻巧又顺手。' },
  { id: 'keyboard', name: '机械键盘锤', price: 60, damage: 10, frame: 14, description: '把敲键盘的力气，用在下班路上。' },
  { id: 'light', name: '准点光剑', price: 140, damage: 22, frame: 15, description: '最后一道需求，也能一剑收工。' },
] as const;
export type RoleId = typeof ROLES[number]['id'];
export type WeaponId = typeof WEAPONS[number]['id'];
export type Zone = 'office' | 'dungeon';
export interface Profile { id: string; username: string; name: string; role: RoleId; coins: number; weapon: WeaponId; owned: WeaponId[]; clears: number }
export interface Input { left: boolean; right: boolean; jump: boolean; attack: boolean; seq: number }
export interface Actor { id: string; name: string; role: string; x: number; y: number; vy: number; face: number; hp: number; weapon: string; action: string; ack: number }
export interface Enemy { id: string; name: string; x: number; y: number; hp: number; maxHp: number; face: number; action: string }
export interface Snapshot { roomId: string; zone: Zone; tick: number; players: Actor[]; enemies: Enemy[]; status: 'playing' | 'complete'; wave: number }
export const idleInput = (): Input => ({ left: false, right: false, jump: false, attack: false, seq: 0 });
export function move(actor: Pick<Actor, 'x' | 'y' | 'vy' | 'face'>, input: Input, dt = WORLD.tick) {
  const direction = Number(input.right) - Number(input.left);
  if (direction) actor.face = direction;
  actor.x = Math.max(36, Math.min(WORLD.width - 36, actor.x + direction * WORLD.speed * dt));
  if (input.jump && actor.y >= WORLD.floor) actor.vy = WORLD.jump;
  actor.vy += WORLD.gravity * dt;
  actor.y += actor.vy * dt;
  if (actor.y >= WORLD.floor) { actor.y = WORLD.floor; actor.vy = 0; }
}
export function damageFor(role: string, weapon: string) {
  return (ROLES.find(r => r.id === role)?.attack ?? 18) + (WEAPONS.find(w => w.id === weapon)?.damage ?? 0);
}
export function inRange(attacker: Pick<Actor, 'x' | 'y' | 'face'>, target: { x: number; y: number }, reach = 100) {
  const dx = target.x - attacker.x;
  return Math.abs(dx) < reach && Math.abs(target.y - attacker.y) < 85 && (Math.abs(dx) < 22 || Math.sign(dx) === attacker.face);
}
