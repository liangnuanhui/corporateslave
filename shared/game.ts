import type { AreaId } from './world/types.js';
export const WORLD = { width: 1280, height: 720, floor: 552, tick: 1 / 30, speed: 235, gravity: 1450, jump: -565 };
export const ROLES = [
  { id: 'rookie', name: '出生牛犊', detail: '还能忍', attack: 18, color: '#a6e8c2' },
  { id: 'senior', name: '眼神涣散', detail: '不忍了', attack: 22, color: '#b8b1ee' },
  { id: 'lead', name: '精神失常', detail: '毁灭吧', attack: 20, color: '#f1c48b' },
] as const;
export const WEAPONS = [
  { id: 'foam', name: '泡沫小剑', price: 0, damage: 0, frame: 13, description: '第一把装备，轻巧顺手。' },
  { id: 'keyboard', name: '机械键盘锤', price: 60, damage: 10, frame: 14, description: '把敲字的力气全部用上。' },
  { id: 'light', name: '准点光剑', price: 140, damage: 22, frame: 15, description: '一剑收工。' },
] as const;
/** 一个房间就是一家公司，房间里显示的就是这家公司的名字。MVP 只有一家，所以它是个常量；
 *  真要开第二家时，这里换成随房间下发的字段，界面无需再改。 */
export const ORG_NAME = '新阳光基金会';
export type RoleId = typeof ROLES[number]['id'];
export type WeaponId = typeof WEAPONS[number]['id'];
export type Zone = 'office' | 'dungeon';
export interface Profile { id: string; username: string; name: string; role: RoleId; coins: number; weapon: WeaponId; owned: WeaponId[]; clears: number }
export interface Input { left: boolean; right: boolean; up: boolean; down: boolean; jump: boolean; attack: boolean; seq: number }
export interface Actor { id: string; name: string; role: string; x: number; y: number; vy: number; face: number; hp: number; weapon: string; action: string; ack: number; area: AreaId }
export interface Enemy { id: string; name: string; x: number; y: number; hp: number; maxHp: number; face: number; action: string; area: AreaId }
export interface Snapshot { roomId: string; zone: Zone; tick: number; players: Actor[]; enemies: Enemy[]; status: 'playing' | 'complete'; wave: number }
export const idleInput = (): Input => ({ left: false, right: false, up: false, down: false, jump: false, attack: false, seq: 0 });
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

/** 办公室是俯视的，两个轴都是地面，所以近战范围就是一个半径——不能用 inRange()，那是侧视规则
 *  （横向够得很远、纵向是一整条竖板）。正上方和正下方的人打得到：俯视时 face 只有左右两个值，
 *  拿它去挡住上下方向，会变成「站在同事头顶上却打不着」。 */
export function inMelee(attacker: Pick<Actor, 'x' | 'y' | 'face'>, target: { x: number; y: number }, reach = 64) {
  const dx = target.x - attacker.x, dy = target.y - attacker.y;
  if (dx * dx + dy * dy > reach * reach) return false;
  return Math.abs(dx) < 20 || Math.sign(dx) === attacker.face;
}

/** 一次挥击打中的目标。抽成函数是为了能单测：判定藏在服务器 tick 里的时候，要验证「隔着一堵墙
 *  在另一个房间打不到人」就得先把角色走到那个房间门口，于是没人会去验。三个条件缺一不可——
 *  活着、同一个房间、在半径内。 */
export function meleeHits<T extends { hp: number; area: AreaId; x: number; y: number }>(
  attacker: Pick<Actor, 'x' | 'y' | 'face' | 'area'>, targets: readonly T[],
): T[] {
  return targets.filter(t => t.hp > 0 && t.area === attacker.area && inMelee(attacker, t));
}

/** MVP 只有一个可打的目标：一位血量和工位都随机的同事。名字是虚构的。 */
export const NPC = { id: 'colleague', name: '刘正超', hpMin: 60, hpMax: 180, hpStep: 10, respawnMs: 8000 };
