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
export interface Enemy { id: string; name: string; x: number; y: number; hp: number; maxHp: number; face: number; action: string; area: AreaId; say?: string }
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
export const NPC = {
  id: 'colleague', name: '刘正超',
  hpMin: 60, hpMax: 180, hpStep: 10, respawnMs: 8000,
  speed: 96,          // 比玩家(235)慢得多：他在上班，不是在赶路
  restMinMs: 4000, restMaxMs: 11000,
  walkTimeoutMs: 9000, // 走不到就换个目的地——路上有没有家具是抽不到的
  hurtPauseMs: 1200,   // 挨打时停下来，不是边挨打边散步
  sayEveryMinMs: 7000, sayEveryMaxMs: 16000, sayForMs: 4200,
  /** 没有任何玩家在他那个区域时，隔这么久换一个房间——没人看见，所以不会出现“瞬移”。 */
  relocateAfterMs: 45000,
};

/** 他在干什么。渲染层只认这几个值，服务器之外没人构造它们。 */
export type NpcDoing = 'walk' | 'desk' | 'phone' | 'idle';

/** 他是个压着下属、毫无能力也毫无管理经验的领导。台词锁在「无能 / 甩锅 / 踢皮球」上——
 *  不碰性别、地域、外貌。被点名的是真实用户自己起的昵称，玩笑和冒犯之间就隔着这条线。
 *  句子本身是这个游戏的笑点，所以放在共享层，客户端不重写一份。 */
export const NPC_LINES = [
  // 甩锅
  '我不干事情的，我就是个传话的。',
  '这个我不会啊，你们谁懂谁来。',
  '出了问题别找我，我当时就提过风险。',
  // 画饼
  '这些都在我脑子里，我理一理再跟你们说。',
  '今年把这块做起来，明年就好办了。',
  // 踢皮球
  '大家想想怎么做啊，我听听。',
  '这个得拉个群对齐一下。',
  '你们先做吧，我下午还有事。',
  '先按你的想法来，出了事我们再说。',
];

/** 点名句。{name} 由服务器用全楼层在线玩家的昵称填充。 */
export const NPC_MENTION_LINES = [
  '这个 {name} 处理一下。',
  '{name} 你说说，这个怎么弄。',
  '{name} 辛苦一下，今天之内。',
  '{name} 你年轻，多担待点。',
];

/** 他这次说什么。三成概率点名，但**名单为空时整类跳过**——这不是新发明：走廊没有工位，
 *  spotAtDesk(corridor) 返回 undefined，抽到「回工位」就退化成「玩手机」。同样地，
 *  没人可点就不点，而不是点一个叫 undefined 的同事。 */
export function pickLine(names: readonly string[], random: () => number = Math.random): string {
  if (names.length && random() < .3) {
    const template = NPC_MENTION_LINES[Math.floor(random() * NPC_MENTION_LINES.length)];
    const name = names[Math.floor(random() * names.length)];
    // 替换函数，不是字符串：字符串参数里的 $& 会被当成「匹配到的内容」展开，
    // 于是一个叫 $& 的玩家能让点名句里冒出字面量 {name}。
    return template.replace('{name}', () => name);
  }
  return NPC_LINES[Math.floor(random() * NPC_LINES.length)];
}

/** 下一段要做什么：走动、回工位、或者掏出手机。走动占一半，因为静止的同事看着像雕像。 */
export function nextDoing(random: () => number = Math.random): Exclude<NpcDoing, 'idle'> {
  const roll = random();
  return roll < .5 ? 'walk' : roll < .78 ? 'desk' : 'phone';
}

/** 一句话的规矩。全部在服务器执行——客户端也挡一道，但那只是少发一个包，不是信任边界。 */
export const CHAT = {
  maxChars: 40,      // 气泡限宽 240px、40 字正好三行
  baseMs: 2500, perCharMs: 150,  // 中文阅读约每秒 5–8 字，斜率照此
  minMs: 3000, maxMs: 9000,
  cooldownMs: 1200,
} as const;

export interface ChatEvent { id: string; text: string; kind: 'say' | 'emote'; ms: number }

export type EmoteId = 'wave' | 'clap' | 'sigh' | 'nod' | 'shrug' | 'busy';
/** 数字键和斜杠命令读同一张表，所以「双入口」不会漂成两份文案。 */
export const EMOTES = [
  { id: 'wave',  key: '1', slash: '/挥手', text: '（挥了挥手）' },
  { id: 'clap',  key: '2', slash: '/鼓掌', text: '（鼓了鼓掌）' },
  { id: 'sigh',  key: '3', slash: '/叹气', text: '（叹了口气）' },
  { id: 'nod',   key: '4', slash: '/点头', text: '（点了点头）' },
  { id: 'shrug', key: '5', slash: '/摊手', text: '（摊开双手）' },
  { id: 'busy',  key: '6', slash: '/忙',   text: '（疯狂敲键盘，假装很忙）' },
] as const satisfies readonly { id: EmoteId; key: string; slash: string; text: string }[];

/** 截断必须按码点：'👍'.length === 2，用 slice 会从代理对中间切开，屏幕上是一个乱码方块。 */
export function sanitizeChat(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  // 换行会把气泡撑成怪形状；其余控制字符直接丢掉，不留空格。
  const flat = raw.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  const text = flat.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return [...text].slice(0, CHAT.maxChars).join('');
}

export function bubbleMs(text: string): number {
  const chars = [...text].length;
  return Math.min(CHAT.maxMs, Math.max(CHAT.minMs, CHAT.baseMs + chars * CHAT.perCharMs));
}
