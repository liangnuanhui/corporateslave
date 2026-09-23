# 办公室分区、转场与 3/4 斜视视角 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把办公室从一张 1920×1200 连续平面改成"走廊 + 独立房间 area"，加入踏门转场、随机出生、全国地图开场与固定 3/4 斜视渲染。

**Architecture:** 单个 Colyseus room 内部按 area 分区，玩家带 `area` 字段；碰撞数据按 area 参数化；房间内玩家通过归一化投影显示在走廊全景与小地图上；转场是纯客户端动画，`snapshot` 始终是权威。

**Tech Stack:** TypeScript 5.9 · Phaser 4.2.1 · Colyseus 0.18 · Vite 7 · node:test

**Spec:** `docs/superpowers/specs/2026-09-23-office-areas-design.md`

## Global Constraints

- 现有 9 项测试必须始终保持绿：`npm test`
- 类型检查必须通过：`npx tsc --noEmit`
- 构建必须通过：`npm run build`
- **服务端与 `tests/` 的 import 必须带 `.js` 后缀**（`../shared/world/index.js`）；`src/` 下的客户端 import **不带后缀**（`../shared/world`）。这是现有代码的既定约定，混用会导致 tsx 运行失败。
- 碰撞永远使用地面投影足迹；3/4 斜视只影响渲染，不得改动 `canStandAt` / `moveIn` / `server/world.ts` 的任何坐标逻辑。
- 不引入任何贴图资源，所有绘制继续使用 `Phaser.Graphics`。
- `dungeon` zone 的移动、战斗、奖励逻辑一行不动。
- 代码风格沿用现有仓库：紧凑单行、注释只写"为什么"、中文面向玩家文案。
- **方向键属于人物**：WASD 与方向键都移动人物（办公室与副本一致）。相机平移只用鼠标——边缘滚屏、拖拽、小地图。任何任务都不得把方向键重新绑定到视角。
- **只做 PC 端**：不新增移动端代码路径，不写移动端样式，不做移动端 QA。既有触屏代码保留不动，不要删除也不要维护。

---

### Task 1: Area 类型与走廊数据（纯重构，行为必须完全不变）

把 `shared/office.ts` 拆成 `shared/world/`，并把 `canStandAt` / `moveOffice` 从"读模块全局"改成"收 area 参数"。此时只有 `corridor` 一个 area，**游戏行为必须与改动前逐像素一致**。

**Files:**
- Create: `shared/world/types.ts`
- Create: `shared/world/corridor.ts`
- Create: `shared/world/index.ts`
- Delete: `shared/office.ts`
- Rename + rewrite: `tests/office.test.ts` → `tests/world.test.ts`
- Modify: `server/world.ts`（import 与 `moveOffice` 调用）
- Modify: `src/game.ts`, `src/map-panel.ts`, `src/main.ts`, `src/office-camera.ts`（import）
- Modify: `tests/multiplayer.test.ts`（import）

**Interfaces:**
- Consumes: 无（首个任务）
- Produces:
  - `types.ts`: `Rect`, `Furniture`, `AreaId = 'corridor' | 'meeting' | 'storage'`, `Exit`, `Area`
  - `corridor.ts`: `corridor: Area`, `CORRIDOR_ROOMS: OfficeRoom[]`, `WALL_SIZE`, `DOOR_WIDTH`, `doorway(room)`, `roomAt(x, y)`
  - `index.ts`: `AREAS: Record<AreaId, Area>`, `canStandAt(area, x, y): boolean`, `moveIn(area, actor, input, dt?): void`

- [ ] **Step 1: 写类型定义**

创建 `shared/world/types.ts`：

```ts
/** One area is a self-contained walkable space with its own coordinate system. */
export interface Rect { x: number; y: number; width: number; height: number }
export interface Furniture extends Rect { kind: 'desk' | 'table' | 'shelf' | 'counter' | 'sofa' | 'plant' }
export type AreaId = 'corridor' | 'meeting' | 'storage';
export interface Exit {
  rect: Rect;                      // 触发器，玩家中心落入即触发
  to: AreaId;
  at: { x: number; y: number };    // 目标 area 内的落点
  label: string;                   // 玩家可见名字，用于封闭提示
  locked?: boolean;
}
export interface Area {
  id: AreaId;
  name: string;
  width: number; height: number;
  bounds: Rect;                    // 可行走的外框（外墙内侧）
  radius: number;                  // 角色碰撞半径
  speed: number;                   // 世界像素 / 秒
  spawnPoints: { x: number; y: number }[];
  walls: Rect[];
  furniture: Furniture[];
  obstacles: Rect[];               // walls + furniture + 不可达区域
  exits: Exit[];
}
```

- [ ] **Step 2: 把走廊数据搬进 corridor.ts**

创建 `shared/world/corridor.ts`。把现有 `shared/office.ts` 第 1–54 行的内容整体搬过来，**布局数值一个都不要改**，只做三处调整：`OFFICE_ROOMS` 改名 `CORRIDOR_ROOMS`、`OFFICE_FURNITURE` 改名 `CORRIDOR_FURNITURE`、末尾导出一个 `corridor: Area`。

```ts
import type { Area, Furniture, Rect } from './types.js';

export interface OfficeRoom extends Rect { id: string; name: string; subtitle: string; color: number; door: 'top' | 'bottom' }
export const CORRIDOR_ROOMS: OfficeRoom[] = [
  { id: 'office-1', name: '办公室 1', subtitle: 'PRODUCT & DESIGN', x: 80, y: 100, width: 540, height: 420, color: 0xced8c0, door: 'bottom' },
  { id: 'meeting', name: '大会议室', subtitle: 'MEETING ROOM', x: 690, y: 100, width: 540, height: 420, color: 0xc8d8da, door: 'bottom' },
  { id: 'office-2', name: '办公室 2', subtitle: 'ENGINEERING', x: 1300, y: 100, width: 540, height: 420, color: 0xd8d0be, door: 'bottom' },
  { id: 'storage', name: '储物间', subtitle: 'STORAGE', x: 80, y: 680, width: 540, height: 420, color: 0xcac6b9, door: 'top' },
  { id: 'lounge', name: '休息区', subtitle: 'TAKE A BREAK', x: 690, y: 680, width: 540, height: 420, color: 0xd9c8b9, door: 'top' },
  { id: 'pantry', name: '茶水间', subtitle: 'COFFEE & TEA', x: 1300, y: 680, width: 540, height: 420, color: 0xc3d3c2, door: 'top' },
];
export const WALL_SIZE = 12;
export const DOOR_WIDTH = 112;
export function doorway(room: OfficeRoom) {
  return { x: room.x + room.width / 2, y: room.door === 'top' ? room.y : room.y + room.height };
}
export const CORRIDOR_WALLS: Rect[] = CORRIDOR_ROOMS.flatMap(room => {
  const { x, y, width, height } = room, t = WALL_SIZE;
  const doorY = room.door === 'top' ? y : y + height - t;
  const closedY = room.door === 'top' ? y + height - t : y;
  const segment = (width - DOOR_WIDTH) / 2;
  return [
    { x, y, width: t, height }, { x: x + width - t, y, width: t, height },
    { x, y: closedY, width, height: t },
    { x, y: doorY, width: segment, height: t },
    { x: x + width - segment, y: doorY, width: segment, height: t },
  ];
});
export const CORRIDOR_FURNITURE: Furniture[] = CORRIDOR_ROOMS.flatMap(room => {
  const items: Furniture[] = [];
  const add = (kind: Furniture['kind'], x: number, y: number, width: number, height: number) => items.push({ kind, x: room.x + x, y: room.y + y, width, height });
  if (room.id.startsWith('office')) {
    for (const x of [58, 222, 386]) for (const y of [120, 260]) add('desk', x, y, 96, 56);
  } else if (room.id === 'meeting') {
    add('table', 155, 150, 230, 140);
    add('counter', 165, 105, 210, 28);
  } else if (room.id === 'storage') {
    for (const x of [50, 220, 390]) add('shelf', x, 140, 90, 150);
    add('counter', 45, 345, 170, 35);
  } else if (room.id === 'lounge') {
    add('sofa', 65, 145, 60, 170); add('sofa', 415, 145, 60, 170);
    add('table', 205, 210, 130, 85);
  } else {
    add('counter', 48, 125, 55, 235); add('counter', 145, 330, 270, 45);
    add('table', 245, 145, 110, 90);
  }
  add('plant', 455, 48, 32, 32);
  return items;
});
export function roomAt(x: number, y: number): OfficeRoom | undefined {
  return CORRIDOR_ROOMS.find(room => x > room.x && x < room.x + room.width && y > room.y && y < room.y + room.height);
}
export const corridor: Area = {
  id: 'corridor', name: '公共走廊', width: 1920, height: 1200,
  bounds: { x: 48, y: 64, width: 1824, height: 1072 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 260, y: 600 }, { x: 420, y: 600 }, { x: 1560, y: 600 }],
  walls: CORRIDOR_WALLS, furniture: CORRIDOR_FURNITURE,
  obstacles: [...CORRIDOR_WALLS, ...CORRIDOR_FURNITURE],
  exits: [],   // Task 2 填充
};
```

- [ ] **Step 3: 写 area 化的移动与碰撞**

创建 `shared/world/index.ts`：

```ts
import type { Input } from '../game.js';
import type { Area, AreaId, Exit } from './types.js';
import { corridor } from './corridor.js';

export * from './types.js';
export { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, WALL_SIZE, DOOR_WIDTH, doorway, roomAt } from './corridor.js';

export const AREAS: Record<AreaId, Area> = { corridor } as Record<AreaId, Area>;  // Task 2 补齐 meeting / storage

export function canStandAt(area: Area, x: number, y: number) {
  const r = area.radius, b = area.bounds;
  if (x < b.x + r || x > b.x + b.width - r || y < b.y + r || y > b.y + b.height - r) return false;
  return !area.obstacles.some(rect => {
    const closestX = Math.max(rect.x, Math.min(x, rect.x + rect.width));
    const closestY = Math.max(rect.y, Math.min(y, rect.y + rect.height));
    return (x - closestX) ** 2 + (y - closestY) ** 2 < r * r;
  });
}

export function moveIn(area: Area, actor: { x: number; y: number; vy: number; face: number }, input: Pick<Input, 'left' | 'right' | 'up' | 'down'>, dt = 1 / 30) {
  const dx = Number(input.right) - Number(input.left), dy = Number(!!input.down) - Number(!!input.up);
  const length = Math.hypot(dx, dy);
  actor.vy = 0;
  if (!length) return;
  if (dx) actor.face = dx;
  // Substeps prevent tunnelling even if callers use a larger frame interval.
  const distance = area.speed * Math.min(Math.max(dt, 0), .15);
  const steps = Math.ceil(distance / (area.radius / 2));
  for (let i = 0; i < steps; i++) {
    const x = actor.x + dx / length * distance / steps;
    if (canStandAt(area, x, actor.y)) actor.x = x;
    const y = actor.y + dy / length * distance / steps;
    if (canStandAt(area, actor.x, y)) actor.y = y;
  }
}
```

- [ ] **Step 4: 把现有测试改写成 area 版本**

`git mv tests/office.test.ts tests/world.test.ts`，然后整体替换为下面内容。每一条断言都对应原来那条，数值不变——**这是证明重构无回归的唯一凭据**。

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, canStandAt, doorway, moveIn, roomAt } from '../shared/world/index.js';
import { idleInput } from '../shared/game.js';

const spawn = corridor.spawnPoints[0];
const actor = (x = spawn.x, y = spawn.y) => ({ x, y, face: 1, vy: 0 });

test('corridor movement supports both axes and normalizes diagonal speed', () => {
  const straight = actor(), diagonal = actor(), start = actor();
  moveIn(corridor, straight, { ...idleInput(), up: true });
  moveIn(corridor, diagonal, { ...idleInput(), up: true, right: true });
  assert.ok(straight.y < start.y);
  assert.equal(straight.x, start.x);
  assert.ok(Math.abs(Math.hypot(diagonal.x - start.x, diagonal.y - start.y) - (start.y - straight.y)) < .0001);
  moveIn(corridor, straight, { ...idleInput(), down: true });
  assert.ok(Math.abs(straight.y - start.y) < .0001);
});

test('all six rooms can be entered and exited through their doors', () => {
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room), fromAbove = room.door === 'top';
    const p = actor(door.x, door.y + (fromAbove ? -48 : 48));
    assert.ok(canStandAt(corridor, p.x, p.y));
    assert.equal(roomAt(p.x, p.y), undefined);
    for (let i = 0; i < 12; i++) moveIn(corridor, p, { ...idleInput(), up: !fromAbove, down: fromAbove });
    assert.equal(roomAt(p.x, p.y)?.id, room.id, `enter ${room.name}`);
    for (let i = 0; i < 12; i++) moveIn(corridor, p, { ...idleInput(), up: fromAbove, down: !fromAbove });
    assert.equal(roomAt(p.x, p.y), undefined, `exit ${room.name}`);
  }
});

test('walls block entry away from doors, including large movement steps', () => {
  const room = CORRIDOR_ROOMS[0];
  const p = actor(room.x + 100, room.y + room.height + 48);
  for (let i = 0; i < 100; i++) moveIn(corridor, p, { ...idleInput(), up: true }, .15);
  assert.ok(p.y >= room.y + room.height + corridor.radius);
  assert.equal(roomAt(p.x, p.y), undefined);
});

test('furniture blocks movement and every doorway is reachable from the corridor', () => {
  const desk = CORRIDOR_FURNITURE.find(f => f.kind === 'desk')!;
  const p = actor(desk.x - 30, desk.y + desk.height / 2);
  for (let i = 0; i < 30; i++) moveIn(corridor, p, { ...idleInput(), right: true });
  assert.ok(p.x <= desk.x - corridor.radius);
  for (let x = spawn.x; x < 1800; x += 5) assert.ok(canStandAt(corridor, x, spawn.y));
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room);
    for (let y = Math.min(600, door.y); y <= Math.max(600, door.y); y += 5) assert.ok(canStandAt(corridor, door.x, y), room.name);
  }
});

test('corridor perimeter blocks escape and idle input does not apply gravity', () => {
  const p = actor(corridor.width - 64, 600);
  for (let i = 0; i < 300; i++) moveIn(corridor, p, { ...idleInput(), right: true });
  assert.ok(p.x <= corridor.bounds.x + corridor.bounds.width - corridor.radius);
  moveIn(corridor, p, idleInput()); assert.equal(p.y, 600); assert.equal(p.vy, 0);
});
```

- [ ] **Step 5: 运行测试，确认因为 `shared/office.ts` 还在被引用而失败**

Run: `npx tsc --noEmit`
Expected: FAIL，`server/world.ts`、`src/game.ts` 等仍在 import `shared/office`，同时 `shared/world/index.ts` 里 `AREAS` 的类型断言会报缺 `meeting`/`storage`（这是预期的，Task 2 补齐）。

- [ ] **Step 6: 更新所有调用方的 import**

逐个文件替换（注意后缀约定）：

| 文件 | 原 | 新 |
|---|---|---|
| `server/world.ts` | `import { OFFICE, moveOffice } from '../shared/office.js'` | `import { AREAS, corridor, moveIn } from '../shared/world/index.js'` |
| `src/game.ts` | `import { OFFICE, OFFICE_ROOMS } from '../shared/office'` | `import { corridor, CORRIDOR_ROOMS } from '../shared/world'` |
| `src/office-camera.ts` | `import { OFFICE } from '../shared/office'` | `import { corridor } from '../shared/world'` |
| `src/map-panel.ts` | `import { OFFICE, OFFICE_ROOMS, OFFICE_WALLS, roomAt } from '../shared/office'` | `import { corridor, CORRIDOR_ROOMS, roomAt } from '../shared/world'` |
| `src/main.ts` | `import { roomAt } from '../shared/office'` | `import { roomAt } from '../shared/world'` |
| `src/office-map.ts` | `import { OFFICE, OFFICE_ROOMS, OFFICE_WALLS, OFFICE_FURNITURE, doorway, type Furniture } from '../shared/office'` | `import { corridor, CORRIDOR_ROOMS, CORRIDOR_FURNITURE, doorway, type Furniture } from '../shared/world'` |
| `tests/multiplayer.test.ts` | `import { OFFICE, OFFICE_ROOMS, doorway, roomAt } from '../shared/office.js'` | `import { corridor, CORRIDOR_ROOMS, doorway, roomAt } from '../shared/world/index.js'` |

机械替换规则：`OFFICE.width` → `corridor.width`，`OFFICE.height` → `corridor.height`，`OFFICE.radius` → `corridor.radius`，`OFFICE.spawn` → `corridor.spawnPoints[0]`，`OFFICE_ROOMS` → `CORRIDOR_ROOMS`，`OFFICE_WALLS` → `corridor.walls`，`OFFICE_FURNITURE` → `CORRIDOR_FURNITURE`，`moveOffice(p, input)` → `moveIn(corridor, p, input)`。

`server/world.ts:94` 那行改成：
```ts
if (this.zone === 'office') moveIn(corridor, p, input); else move(p, input);
```

`server/world.ts:61` 出生点那行改成：
```ts
x: (this.zone === 'office' ? corridor.spawnPoints[0].x : 160) + this.players.size * 45, y: this.zone === 'office' ? corridor.spawnPoints[0].y : WORLD.floor,
```

- [ ] **Step 7: 让 AREAS 暂时只含 corridor 且类型通过**

把 `index.ts` 里的 `AREAS` 暂时写成：
```ts
export const AREAS = { corridor } as unknown as Record<AreaId, Area>;
```
并加注释 `// Task 2 补齐 meeting / storage`。Task 2 会换成真实的完整对象并去掉断言。

- [ ] **Step 8: 删除旧文件并全量验证**

```bash
rm shared/office.ts
npx tsc --noEmit
npm test
npm run build
```
Expected: 类型检查通过；`npm test` 9 项全绿（测试名有一条从 `office movement...` 变成 `corridor movement...`）；构建通过。

- [ ] **Step 9: 浏览器人工确认行为未变**

```bash
npm run dev
```
打开 http://localhost:5173 ，确认：全景铺满舞台、滚轮以光标为锚点缩放、六个房间都能从门口走进走出、小地图正常。**任何一点与改动前不同都说明重构引入了回归，必须修掉再提交。**

- [ ] **Step 10: 提交**

```bash
git add -A
git commit -m "refactor: 把办公室平面拆成 area 数据结构

canStandAt 与 moveIn 改为接收 area 参数，行为与改动前一致。
此时只有 corridor 一个 area。"
```

---

### Task 2: 会议室与储物间内部地图 + 出口定义

**Files:**
- Create: `shared/world/meeting.ts`
- Create: `shared/world/storage.ts`
- Modify: `shared/world/corridor.ts`（填 `exits`、把房间内部加进 `obstacles`）
- Modify: `shared/world/index.ts`（补齐 `AREAS`、加 `exitAt` / `projectTo`）
- Modify: `tests/world.test.ts`（改写六门测试，新增注册表与投影测试）

**Interfaces:**
- Consumes: Task 1 的 `Area`, `Exit`, `AreaId`, `canStandAt`, `corridor`, `CORRIDOR_ROOMS`, `doorway`, `WALL_SIZE`, `DOOR_WIDTH`
- Produces:
  - `meeting.ts`: `meeting: Area`
  - `storage.ts`: `storage: Area`
  - `index.ts`: `AREAS: Record<AreaId, Area>`（完整）, `exitAt(area, x, y): Exit | undefined`, `projectTo(area, x, y): { x: number; y: number }`

- [ ] **Step 1: 写房间内部地图**

创建 `shared/world/meeting.ts`。房间内部 1100×760，四周 16px 墙，底边中央开 140px 门。

```ts
import type { Area, Furniture, Rect } from './types.js';

const W = 1100, H = 760, T = 16, DOOR = 140;
const walls: Rect[] = [
  { x: 0, y: 0, width: T, height: H },
  { x: W - T, y: 0, width: T, height: H },
  { x: 0, y: 0, width: W, height: T },
  { x: 0, y: H - T, width: (W - DOOR) / 2, height: T },
  { x: (W + DOOR) / 2, y: H - T, width: (W - DOOR) / 2, height: T },
];
const furniture: Furniture[] = [
  { kind: 'table', x: 330, y: 250, width: 440, height: 260 },   // 长桌
  { kind: 'counter', x: 340, y: 90, width: 420, height: 40 },   // 投影幕下的台面
  { kind: 'plant', x: 990, y: 60, width: 32, height: 32 },
  { kind: 'plant', x: 60, y: 60, width: 32, height: 32 },
  { kind: 'sofa', x: 60, y: 300, width: 60, height: 200 },
];
export const meeting: Area = {
  id: 'meeting', name: '大会议室', width: W, height: H,
  bounds: { x: T, y: T, width: W - T * 2, height: H - T * 2 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 250, y: 620 }, { x: 850, y: 620 }, { x: 550, y: 640 }],
  walls, furniture, obstacles: [...walls, ...furniture],
  exits: [{ rect: { x: W / 2 - 50, y: H - T - 26, width: 100, height: 26 }, to: 'corridor', at: { x: 0, y: 0 }, label: '公共走廊' }],
};
```

`at` 先填 `{ x: 0, y: 0 }` 占位，Step 3 会用走廊里的真实落点回填——因为它依赖 `CORRIDOR_ROOMS`，而 `corridor.ts` 又要引用 `meeting`，直接写会形成循环 import。回填放在 `index.ts`。

创建 `shared/world/storage.ts`，结构相同，家具换成货架与商店台：

```ts
import type { Area, Furniture, Rect } from './types.js';

const W = 1100, H = 760, T = 16, DOOR = 140;
const walls: Rect[] = [
  { x: 0, y: 0, width: T, height: H },
  { x: W - T, y: 0, width: T, height: H },
  { x: 0, y: H - T, width: W, height: T },
  { x: 0, y: 0, width: (W - DOOR) / 2, height: T },
  { x: (W + DOOR) / 2, y: 0, width: (W - DOOR) / 2, height: T },
];
const furniture: Furniture[] = [
  ...[120, 300, 480, 660].map((x): Furniture => ({ kind: 'shelf', x, y: 180, width: 110, height: 190 })),
  ...[120, 300, 480, 660].map((x): Furniture => ({ kind: 'shelf', x, y: 470, width: 110, height: 190 })),
  { kind: 'counter', x: 860, y: 200, width: 180, height: 60 },   // 装备商店台
  { kind: 'plant', x: 990, y: 640, width: 32, height: 32 },
];
export const storage: Area = {
  id: 'storage', name: '储物间', width: W, height: H,
  bounds: { x: T, y: T, width: W - T * 2, height: H - T * 2 },
  radius: 14, speed: 235,
  spawnPoints: [{ x: 550, y: 120 }, { x: 900, y: 400 }, { x: 550, y: 410 }],
  walls, furniture, obstacles: [...walls, ...furniture],
  exits: [{ rect: { x: W / 2 - 50, y: T, width: 100, height: 26 }, to: 'corridor', at: { x: 0, y: 0 }, label: '公共走廊' }],
};
```

- [ ] **Step 2: 走廊侧：房间内部变障碍、门口变触发器**

修改 `shared/world/corridor.ts`。在 `corridor` 定义之前加入房间内部填充，并把 `obstacles` 换成包含它的版本：

```ts
/** Room interiors live in their own areas now, so the corridor footprint is unreachable.
 *  The four walls already seal it; this is a guard against a future second door. */
const ROOM_INTERIORS: Rect[] = CORRIDOR_ROOMS.map(room => ({
  x: room.x + WALL_SIZE, y: room.y + WALL_SIZE,
  width: room.width - WALL_SIZE * 2, height: room.height - WALL_SIZE * 2,
}));
```

`corridor.obstacles` 改成 `[...CORRIDOR_WALLS, ...CORRIDOR_FURNITURE, ...ROOM_INTERIORS]`。

`corridor.exits` 填成六个门口触发器——两个开放、四个封闭：

```ts
const OPEN: Record<string, AreaId> = { meeting: 'meeting', storage: 'storage' };
export const CORRIDOR_EXITS: Exit[] = CORRIDOR_ROOMS.map(room => {
  const door = doorway(room), open = OPEN[room.id];
  // Trigger sits on the corridor side of the wall line, where the player is stopped.
  const y = room.door === 'top' ? door.y - 26 : door.y;
  return {
    rect: { x: door.x - 40, y, width: 80, height: 26 },
    to: (open ?? 'corridor') as AreaId,
    at: { x: 0, y: 0 },          // index.ts 回填
    label: room.name,
    locked: !open,
  };
});
```

`corridor.exits` 设为 `CORRIDOR_EXITS`。`Exit` 与 `AreaId` 需要从 `./types.js` 导入。

- [ ] **Step 3: 在 index.ts 回填落点、补齐 AREAS、加 exitAt 与 projectTo**

修改 `shared/world/index.ts`：

```ts
import { meeting } from './meeting.js';
import { storage } from './storage.js';
import { corridor, CORRIDOR_ROOMS, doorway, WALL_SIZE } from './corridor.js';

export { meeting } from './meeting.js';
export { storage } from './storage.js';

/** Landing spots are resolved here to keep corridor.ts and the room files free of cycles.
 *  Each landing point sits 60px inside the door, clear of the opposite trigger. */
for (const exit of corridor.exits) {
  if (exit.locked) continue;
  const room = AREAS_ROOM_BY_ID[exit.to];
  exit.at = { x: room.width / 2, y: exit.to === 'meeting' ? room.height - WALL_SIZE - 60 : WALL_SIZE + 60 };
}
for (const room of [meeting, storage]) {
  const slot = CORRIDOR_ROOMS.find(r => r.id === room.id)!;
  const door = doorway(slot);
  room.exits[0].at = { x: door.x, y: door.y + (slot.door === 'top' ? -60 : 60) };
}

export const AREAS: Record<AreaId, Area> = { corridor, meeting, storage };

export function exitAt(area: Area, x: number, y: number): Exit | undefined {
  return area.exits.find(e => x >= e.rect.x && x <= e.rect.x + e.rect.width && y >= e.rect.y && y <= e.rect.y + e.rect.height);
}

/** Map a room-local position onto the room's footprint in the corridor, for the overview and minimap. */
export function projectTo(area: Area, x: number, y: number) {
  if (area.id === 'corridor') return { x, y };
  const slot = CORRIDOR_ROOMS.find(r => r.id === area.id)!;
  return {
    x: slot.x + Math.min(Math.max(x, 0), area.width) / area.width * slot.width,
    y: slot.y + Math.min(Math.max(y, 0), area.height) / area.height * slot.height,
  };
}
```

其中 `AREAS_ROOM_BY_ID` 写成 `const AREAS_ROOM_BY_ID: Record<string, Area> = { meeting, storage };`，放在回填循环之前。去掉 Task 1 Step 7 留下的 `as unknown as` 断言。

- [ ] **Step 4: 写失败的测试**

在 `tests/world.test.ts` 末尾追加，并**删除**原来那条 `all six rooms can be entered and exited through their doors`（它断言的行为已被设计取代），换成下面第一条：

```ts
test('two rooms open through their doorway, four report 装修中', () => {
  for (const room of CORRIDOR_ROOMS) {
    const door = doorway(room), fromAbove = room.door === 'top';
    const p = actor(door.x, door.y + (fromAbove ? -48 : 48));
    assert.ok(canStandAt(corridor, p.x, p.y), room.name);
    let hit;
    for (let i = 0; i < 12 && !hit; i++) {
      moveIn(corridor, p, { ...idleInput(), up: !fromAbove, down: fromAbove });
      hit = exitAt(corridor, p.x, p.y);
    }
    assert.ok(hit, `${room.name} 的门口应该有触发器`);
    if (room.id === 'meeting' || room.id === 'storage') {
      assert.equal(hit!.locked, undefined, `${room.name} 应该开放`);
      assert.equal(hit!.to, room.id);
    } else {
      assert.equal(hit!.locked, true, `${room.name} 应该封闭`);
    }
  }
});

test('area registry is self-consistent', () => {
  for (const area of Object.values(AREAS)) {
    for (const exit of area.exits) {
      if (exit.locked) continue;
      const target = AREAS[exit.to];
      assert.ok(target, `${area.id} 的出口指向不存在的 ${exit.to}`);
      assert.ok(canStandAt(target, exit.at.x, exit.at.y), `${area.id} → ${exit.to} 的落点不可站立`);
      // The landing spot must not sit inside the opposite trigger, or the player bounces back.
      assert.equal(exitAt(target, exit.at.x, exit.at.y), undefined, `${area.id} → ${exit.to} 的落点落在反向触发器里`);
    }
    assert.ok(area.spawnPoints.length > 0, `${area.id} 没有出生点`);
    for (const s of area.spawnPoints) assert.ok(canStandAt(area, s.x, s.y), `${area.id} 的出生点 ${s.x},${s.y} 不可站立`);
  }
});

test('room positions project inside their corridor footprint', () => {
  for (const room of [meeting, storage]) {
    const slot = CORRIDOR_ROOMS.find(r => r.id === room.id)!;
    for (const [x, y] of [[0, 0], [room.width, room.height], [room.width / 2, room.height / 2], [-50, -50], [room.width + 99, room.height + 99]]) {
      const p = projectTo(room, x, y);
      assert.ok(p.x >= slot.x && p.x <= slot.x + slot.width, `${room.id} x 越界: ${p.x}`);
      assert.ok(p.y >= slot.y && p.y <= slot.y + slot.height, `${room.id} y 越界: ${p.y}`);
    }
    assert.deepEqual(projectTo(corridor, 500, 500), { x: 500, y: 500 });
  }
});

test('rooms are walkable from their spawn to their exit', () => {
  for (const room of [meeting, storage]) {
    const p = { ...room.spawnPoints[0], face: 1, vy: 0 };
    const target = room.exits[0].rect;
    const goalY = target.y + target.height / 2;
    for (let i = 0; i < 200 && !exitAt(room, p.x, p.y); i++) {
      moveIn(room, p, { ...idleInput(), left: p.x > room.width / 2 + 4, right: p.x < room.width / 2 - 4, up: p.y > goalY, down: p.y < goalY });
    }
    assert.ok(exitAt(room, p.x, p.y), `${room.name} 从出生点走不到门口`);
  }
});
```

测试头部 import 需补上 `AREAS, exitAt, projectTo, meeting, storage`。

- [ ] **Step 5: 运行测试确认失败**

Run: `npm test 2>&1 | tail -30`
Expected: FAIL —— `exitAt is not a function` 或 `Cannot find module './meeting.js'`，取决于实现进度。

- [ ] **Step 6: 实现到测试通过**

按 Step 1–3 补齐所有文件。特别注意 `rooms are walkable from their spawn to their exit` 这条——它会真实地检验你摆的家具有没有把门堵死。如果失败，**调整家具坐标**，不要调整测试。

Run: `npm test 2>&1 | tail -20`
Expected: 全部通过。

- [ ] **Step 7: 修掉走廊全景里被封住的四个房间的可达性回归**

`tests/world.test.ts` 里 `furniture blocks movement and every doorway is reachable from the corridor` 那条会因为房间内部变成障碍而**仍然通过**（它只检查走廊到门口的路径）。运行 `npm test` 确认。若失败，说明门口触发器的 y 范围侵入了走廊通道，把 `height: 26` 调小。

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat: 加入大会议室与储物间的独立内部地图和门口触发器

走廊侧六个门口都成为出口触发器，其中两个开放、四个标记 locked。
房间内部在走廊平面上成为障碍。"
```

---

### Task 3: 服务端 area 切换与出口触发

**Files:**
- Modify: `shared/game.ts`（`Actor` 加 `area`）
- Modify: `server/world.ts`（`Player` 加 `area`/`exitCooldown`/`noticeAt`，step 触发出口，商店与副本入口判定，复活坐标修复）
- Modify: `tests/multiplayer.test.ts`（六门集成测试改写）
- Create: `tests/areas.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `AREAS`, `exitAt`, `moveIn`, `canStandAt`, `corridor`, `meeting`, `storage`
- Produces:
  - `shared/game.ts`: `Actor.area: AreaId`
  - 服务端新消息：`transition` → `{ to: AreaId; name: string }`（单发给触发的 client）

- [ ] **Step 1: 写失败的测试**

创建 `tests/areas.test.ts`。这些是**纯函数级**测试，不启服务器，跑得快：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AREAS, corridor, meeting, storage, canStandAt, exitAt, moveIn } from '../shared/world/index.js';
import { idleInput } from '../shared/game.js';

/** Reproduces the server's per-tick exit handling, so bounce protection can be tested without a server. */
function tick(state: { area: keyof typeof AREAS; x: number; y: number; vy: number; face: number; cooldown: number }, input: ReturnType<typeof idleInput>, now: number) {
  moveIn(AREAS[state.area], state, input);
  if (now < state.cooldown) return undefined;
  const exit = exitAt(AREAS[state.area], state.x, state.y);
  if (!exit || exit.locked) return exit;
  state.area = exit.to; state.x = exit.at.x; state.y = exit.at.y; state.cooldown = now + 400;
  return exit;
}

test('walking through the meeting door switches area and does not bounce back', () => {
  const door = corridor.exits.find(e => e.to === 'meeting')!;
  const state = { area: 'corridor' as const, x: door.rect.x + door.rect.width / 2, y: door.rect.y + door.rect.height + 30, vy: 0, face: 1, cooldown: 0 };
  let now = 0, entered = false;
  for (let i = 0; i < 20 && !entered; i++) { now += 1000 / 30; tick(state as any, { ...idleInput(), up: true }, now); entered = state.area === 'meeting'; }
  assert.equal(state.area, 'meeting', '应该进入大会议室');
  // Hold the same key for another 30 ticks: the player must stay inside.
  for (let i = 0; i < 30; i++) { now += 1000 / 30; tick(state as any, { ...idleInput(), up: true }, now); }
  assert.equal(state.area, 'meeting', '进门后被弹回了走廊');
});

test('locked doors never switch area', () => {
  for (const exit of corridor.exits.filter(e => e.locked)) {
    const state = { area: 'corridor' as const, x: exit.rect.x + exit.rect.width / 2, y: exit.rect.y + exit.rect.height + 30, vy: 0, face: 1, cooldown: 0 };
    let now = 0;
    for (let i = 0; i < 40; i++) { now += 1000 / 30; tick(state as any, { ...idleInput(), up: exit.rect.y < 600, down: exit.rect.y >= 600 }, now); }
    assert.equal(state.area, 'corridor', `${exit.label} 不应该能进入`);
  }
});

test('leaving a room lands back in the corridor outside the trigger', () => {
  for (const room of [meeting, storage]) {
    const exit = room.exits[0];
    const state = { area: room.id, x: exit.at.x, y: exit.at.y, vy: 0, face: 1, cooldown: 0 };
    assert.ok(canStandAt(room, state.x, state.y));
    let now = 0;
    const toward = room.id === 'meeting' ? { down: true } : { up: true };
    for (let i = 0; i < 40 && state.area === room.id; i++) { now += 1000 / 30; tick(state as any, { ...idleInput(), ...toward }, now); }
    assert.equal(state.area, 'corridor', `${room.name} 出不去`);
    assert.equal(exitAt(corridor, state.x, state.y), undefined, `${room.name} 的出口落点落在走廊触发器里`);
  }
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx --test tests/areas.test.ts 2>&1 | tail -20`
Expected: 测试本身可能已经通过（因为它们只依赖 Task 2 的数据）。**如果通过，那正是想要的**——它们是防止 Task 3 服务端实现写错的护栏。如果失败，说明 Task 2 的落点或触发器几何有问题，先修 Task 2 的数据。

- [ ] **Step 3: 给 Actor 加 area 字段**

`shared/game.ts`：

```ts
import type { AreaId } from './world/types.js';
export interface Actor { id: string; name: string; role: string; x: number; y: number; vy: number; face: number; hp: number; weapon: string; action: string; ack: number; area: AreaId }
```

注意 `src/game.ts` 里的 client import 不带 `.js`，但 `shared/game.ts` 是被服务端加载的，所以这里**必须带 `.js`**。

- [ ] **Step 4: 服务端实现**

`server/world.ts`：

`Player` 接口加三个字段：
```ts
interface Player extends Actor { input: Input; profile: Profile; lastInput: number; attackAt: number; hurtAt: number; actionUntil: number; respawnAt: number; dropped: boolean; exitCooldown: number; noticeAt: number }
```

`onJoin` 里新增（出生点逻辑 Task 4 再改，这里先固定走廊）：
```ts
area: 'corridor', exitCooldown: 0, noticeAt: -10000,
```

`step()` 里替换移动与出口处理：
```ts
const area = this.zone === 'office' ? AREAS[p.area] : undefined;
if (area) moveIn(area, p, input); else move(p, input);
if (area && this.elapsed >= p.exitCooldown) this.tryExit(sid, p, area);
```
（`for (const p of this.players.values())` 需改成 `for (const [sid, p] of this.players)` 才能拿到 sessionId。）

新增私有方法：
```ts
/** The server switches area immediately; the client's fade is pure presentation. */
private tryExit(sessionId: string, p: Player, area: Area) {
  const exit = exitAt(area, p.x, p.y);
  if (!exit) return;
  const client = this.clients.find(c => c.sessionId === sessionId);
  if (exit.locked) {
    if (this.elapsed - p.noticeAt > 2500) { p.noticeAt = this.elapsed; client?.send('notice', `${exit.label}还在装修中，敬请期待`); }
    return;
  }
  p.area = exit.to; p.x = exit.at.x; p.y = exit.at.y; p.vy = 0;
  p.exitCooldown = this.elapsed + 400;
  client?.send('transition', { to: exit.to, name: AREAS[exit.to].name });
}
```

复活坐标修复（`step()` 第 90 行附近）：
```ts
if (this.elapsed >= p.respawnAt) {
  const spawn = this.zone === 'office' ? AREAS[p.area].spawnPoints[0] : { x: 160, y: WORLD.floor };
  p.hp = 100; p.x = spawn.x; p.y = spawn.y; p.vy = 0; p.hurtAt = this.elapsed;
}
```

`snapshot()` 的 players 映射加 `area: p.area`。

商店判定（`shop()` 方法）：`if (this.zone !== 'office')` 之后加一行
```ts
if (p.area !== 'storage') { client.send('notice', '请到储物间的装备台前购买'); return; }
```

- [ ] **Step 5: 客户端副本入口判定跟着改**

`src/main.ts` 的 `interact()`：
```ts
if (network.snapshot?.zone === 'office' && actor && actor.area === 'corridor' && actor.x > 1620 && Math.abs(actor.y - 600) < 65) void join('dungeon');
else if (network.snapshot?.zone === 'office' && actor && actor.area === 'storage') openShop();
```
`roomAt(actor.x, actor.y)?.id === 'storage'` 那一段删掉。

`renderSnapshot()` 里的地名：
```ts
const place = actor ? (actor.area === 'corridor' ? roomAt(actor.x, actor.y)?.name || '公共走廊' : AREAS[actor.area].name) : '办公室全景';
```

- [ ] **Step 6: 改写六门集成测试**

`tests/multiplayer.test.ts` 第 56 行起那个 `for (const room of [...OFFICE_ROOMS]...)` 循环，改成只走两个开放房间并断言 `area` 变化：

```ts
for (const room of CORRIDOR_ROOMS.filter(r => r.id === 'meeting' || r.id === 'storage')) {
  const door = doorway(room);
  await walkTo('x', door.x);
  await walkTo('y', door.y + (room.door === 'top' ? 48 : -48));
  await until(() => myself().area === room.id, 10000);
  console.log(`integration: entered ${room.name}`);
  // 走回走廊
  await walkTo('y', room.door === 'top' ? 200 : 600);
  await until(() => myself().area === 'corridor', 10000);
}
```

`walkTo` 内部用的 `myself()[axis]` 在房间内是房间坐标，所以走回走廊那一步的目标 y 要用**房间内**的坐标：`room.door === 'top'` 的房间（储物间）门在上方，房间内 y 要往小走；反之往大走。把上面那两行写成：

```ts
await walkTo('y', room.id === 'storage' ? 40 : 740);
```

- [ ] **Step 7: 补重连保留 area 的集成测试**

在 `tests/multiplayer.test.ts` 的走门循环之后追加。它验证 spec 里"断线 12 秒内重连回到原 area 原位置"这一条：

```ts
// 走进会议室，断线再重连，必须回到会议室原位
{
  const meetingDoor = doorway(CORRIDOR_ROOMS.find(r => r.id === 'meeting')!);
  await walkTo('x', meetingDoor.x);
  await walkTo('y', meetingDoor.y - 48);
  await until(() => myself().area === 'meeting', 10000);
  const before = { x: myself().x, y: myself().y };
  const token = ra.reconnectionToken;
  await ra.leave(false);                       // false = 不主动离开，走 onDrop 分支
  await pause(400);
  const again = await sdk.reconnect(token); rooms.push(again); const vr = watch(again);
  await until(() => !!vr.snap?.players.find(p => p.id === a.profile.id), 10000);
  const after = vr.snap!.players.find(p => p.id === a.profile.id)!;
  assert.equal(after.area, 'meeting', '重连后不在原 area');
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 40, '重连后位置漂移过大');
  console.log('integration: reconnect kept the area');
}
```

若 `ra.leave(false)` 在当前 SDK 版本上不触发 `onDrop`，改用 `ra.connection.transport.close()` 强制断开底层连接。

- [ ] **Step 8: 全量验证**

```bash
npx tsc --noEmit
npm test
```
Expected: 现有 9 项 + 新增 4 项（`tests/areas.test.ts` 3 条 + Task 2 的 4 条）全绿。集成测试会实际走进会议室、走出来、再断线重连一次。

- [ ] **Step 9: 提交**

```bash
git add -A
git commit -m "feat: 服务端按 area 分区移动并在门口切换

加入 exitCooldown 防止反向弹跳，封闭的门回 notice。
修正复活坐标写死副本地面的问题。"
```

---

### Task 4: 随机出生点

**Files:**
- Modify: `server/world.ts`（`onJoin` 落点）
- Modify: `tests/areas.test.ts`（新增出生点测试）

**Interfaces:**
- Consumes: Task 3 的 `Player.area`、Task 2 的 `AREAS`
- Produces: `server/world.ts` 私有方法 `pickSpawn(): { area: AreaId; x: number; y: number }`

- [ ] **Step 1: 写失败的测试**

追加到 `tests/areas.test.ts`：

```ts
test('every spawn point across open areas is standable and not on a trigger', () => {
  for (const area of Object.values(AREAS)) {
    for (const s of area.spawnPoints) {
      assert.ok(canStandAt(area, s.x, s.y), `${area.id} 出生点不可站立`);
      assert.equal(exitAt(area, s.x, s.y), undefined, `${area.id} 出生点压在出口触发器上`);
    }
  }
});
```

- [ ] **Step 2: 运行确认**

Run: `npx tsx --test tests/areas.test.ts 2>&1 | tail -10`
Expected: 通过。若失败，调整 Task 2 里的 `spawnPoints` 坐标。

- [ ] **Step 3: 实现随机出生**

`server/world.ts` 新增：

```ts
/** New arrivals are scattered across every open area, so the floor never looks empty.
 *  To spawn only inside rooms, clear corridor.spawnPoints — no code change needed. */
private pickSpawn() {
  const candidates = Object.values(AREAS).flatMap(area => area.spawnPoints.map(point => ({ area: area.id, ...point })));
  const taken = [...this.players.values()];
  let best = candidates[0], bestScore = -1;
  for (const c of candidates) {
    const near = taken.filter(p => p.area === c.area);
    const score = near.length ? Math.min(...near.map(p => Math.hypot(p.x - c.x, p.y - c.y))) : Infinity;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best;
}
```

`onJoin` 里替换落点：
```ts
const spawn = this.zone === 'office' ? this.pickSpawn() : { area: 'corridor' as const, x: 160 + this.players.size * 45, y: WORLD.floor };
...
area: spawn.area, x: spawn.x, y: spawn.y, ...
```
删掉原来的 `x: (this.zone === 'office' ? ... ) + this.players.size * 45` 那两行。

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit && npm test
```
Expected: 全绿。集成测试里玩家可能出生在任意 area，所以 Task 3 Step 6 改写的走门循环需要**先回到走廊**再开始。在循环之前加：

```ts
await until(() => myself().area !== undefined);
if (myself().area !== 'corridor') {
  const room = myself().area;
  await walkTo('y', room === 'storage' ? 40 : 740);
  await until(() => myself().area === 'corridor', 10000);
}
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: 上线随机分配到已开放 area 的出生点"
```

---

### Task 5: 客户端按 area 重建场景（硬切，无动画）

**Files:**
- Modify: `src/game.ts`（场景按 area 重建、权威规则）
- Modify: `src/office-camera.ts`（读当前 area 尺寸）
- Modify: `src/office-map.ts`（`drawOffice` 改成 `drawArea(scene, area)`）

**Interfaces:**
- Consumes: Task 3 的 `Actor.area`、Task 2 的 `AREAS` / `projectTo`
- Produces:
  - `src/office-camera.ts`: `configure(area: Area | null)`（`null` = dungeon）
  - `src/game.ts`: `OfficeScene.currentArea: AreaId`
  - `src/office-map.ts`: `drawArea(scene: Phaser.Scene, area: Area): Phaser.GameObjects.Container`

- [ ] **Step 1: 相机读 area 尺寸**

`src/office-camera.ts` 现在硬读 `corridor.width / corridor.height`（Task 1 机械替换后的结果）。改成持有一个 area：

```ts
private area: Area = corridor;
get minZoom() { return Math.min(this.camera.width / this.area.width, this.camera.height / this.area.height); }
configure(area: Area | null) {
  this.active = !!area; this.following = false;
  if (area) this.area = area;
  this.resize();
  if (area) this.overview();
}
```
`overview()` 里的 `OFFICE.width / 2` → `this.area.width / 2`；`apply()` 里的两处 `OFFICE.width` / `OFFICE.height` → `this.area.width` / `this.area.height`。`view` getter 不变。

- [ ] **Step 2: 绘制函数按 area 参数化**

`src/office-map.ts` 的 `drawOffice(scene)` 改签名为 `drawArea(scene, area)`，按 area 分两条绘制路径：

```ts
export function drawArea(scene: Phaser.Scene, area: Area) {
  const root = scene.add.container(0, 0);
  const g = scene.add.graphics(); root.add(g);
  const rect = (x: number, y: number, w: number, h: number, color: number) => { g.fillStyle(color).fillRect(x, y, w, h); };
  const text = (x: number, y: number, value: string, size: number, color: string, bold = false) => {
    const label = scene.add.text(x, y, value, { fontFamily: 'system-ui, sans-serif', fontSize: `${size}px`, color, fontStyle: bold ? 'bold' : 'normal' }).setOrigin(.5);
    root.add(label); return label;
  };
  if (area.id === 'corridor') drawCorridor(); else drawRoom();
  for (const item of area.furniture) drawFurniture(item);
  return root;

  function drawCorridor() {
    // 现有 drawOffice 的函数体原样搬入：外框、地板网格、走廊带、六个房间的底色与门、
    // 墙体、窗户、电梯与接待区文字。把其中的 OFFICE_ROOMS 换成 CORRIDOR_ROOMS，
    // OFFICE_WALLS 换成 area.walls，OFFICE.width/height 换成 area.width/height。
  }
  function drawRoom() {
    rect(0, 0, area.width, area.height, 0x0f1e24);
    rect(8, 8, area.width - 16, area.height - 16, 0xeee4cc);
    for (let x = 8; x < area.width - 8; x += 48) rect(x, 8, 1, area.height - 16, 0xded4bf);
    for (let y = 8; y < area.height - 8; y += 48) rect(8, y, area.width - 16, 1, 0xded4bf);
    for (const wall of area.walls) {
      rect(wall.x + 4, wall.y + 5, wall.width, wall.height, 0x8a998c);
      rect(wall.x, wall.y, wall.width, wall.height, 0x4f665d);
      rect(wall.x, wall.y, wall.width, Math.min(4, wall.height), 0x91a598);
    }
    for (const exit of area.exits) {
      rect(exit.rect.x - 6, exit.rect.y, exit.rect.width + 12, 12, 0xe6c984);
      text(exit.rect.x + exit.rect.width / 2, exit.rect.y + (exit.rect.y < area.height / 2 ? 34 : -26), `↤ ${exit.label}`, 17, '#6b805f');
    }
    text(area.width / 2, 52, area.name, 34, '#334840', true);
  }
  function drawFurniture(item: Furniture) { /* 现有 drawFurniture 原样搬入，不改 */ }
  function chair(x: number, y: number, horizontal = false) { /* 现有 chair 原样搬入，不改 */ }
}
```

- [ ] **Step 3: 场景按 area 重建**

`src/game.ts` 的 `update()`：

```ts
const me = snap?.players.find(p => p.id === this.network.profile?.id);
const area = office ? (me?.area ?? 'corridor') : null;
// snapshot is authoritative: whenever the local scene disagrees, cut immediately.
if (office !== this.officeMode || (area && area !== this.currentArea)) {
  this.officeMode = office; this.currentArea = area ?? 'corridor';
  this.floorPlan?.destroy();
  this.floorPlan = office ? drawArea(this, AREAS[this.currentArea]) : undefined;
  this.background.setVisible(!office);
  this.officeCamera.configure(office ? AREAS[this.currentArea] : null);
  for (const v of this.visuals.values()) { v.sprite.destroy(); v.label.destroy(); v.health.destroy(); v.shadow.destroy(); }
  this.visuals.clear(); this.resetInput();
}
```

渲染玩家时只画同 area 的：
```ts
for (const player of snap.players) if (!office || player.area === this.currentArea) this.renderActor(player, false, time, delta);
```
不同 area 的玩家要销毁其 visual——把 `ids` 集合改成只收同 area 的玩家 id：
```ts
const visible = snap.players.filter(p => !office || p.area === this.currentArea);
const ids = new Set([...visible.map(p => p.id), ...snap.enemies.map(e => e.id)]);
```

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit && npm test && npm run build
npm run dev
```
浏览器确认：走进会议室门口，画面**瞬间**切到会议室内部（此时没有动画，是预期的）；相机全景变成会议室铺满舞台；走到门口再出来回到走廊。开两个浏览器，一个进会议室、一个留走廊，确认互相看不见对方的角色。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: 客户端按 area 重建场景与相机，snapshot 为权威"
```

---

### Task 6: 转场动画

**Files:**
- Modify: `src/network.ts`（转发 `transition` 消息）
- Modify: `src/game.ts`（淡入淡出）

**Interfaces:**
- Consumes: Task 3 的 `transition` 消息、Task 5 的场景重建
- Produces: `src/game.ts` 私有方法 `playTransition(name: string)`

- [ ] **Step 1: 转发消息**

`src/network.ts` 的 `join()` 里，在 `room.onMessage('notice', ...)` 旁边加一行：
```ts
room.onMessage('transition', data => this.emit('transition', data));
```

- [ ] **Step 2: 实现淡入淡出**

`src/game.ts` 的 `create()` 里加一个覆盖全屏的黑色矩形：
```ts
this.curtain = this.add.rectangle(0, 0, 4000, 4000, 0x0b1116).setOrigin(.5).setScrollFactor(0).setDepth(200).setAlpha(0);
this.network.addEventListener('transition', event => this.playTransition((event as CustomEvent).detail.name));
```

```ts
/** Presentation only — the server already moved us. A hard cut in update() can overtake this. */
private playTransition(name: string) {
  this.tweens.killTweensOf(this.curtain);
  this.curtain.setAlpha(0);
  this.tweens.add({ targets: this.curtain, alpha: 1, duration: 180, onComplete: () => {
    this.network.emit('notice', `进入${name}`);
    this.tweens.add({ targets: this.curtain, alpha: 0, duration: 220, delay: 60 });
  } });
}
```

场景重建仍然由 `update()` 的权威规则驱动——它会在幕布最黑的时刻前后发生。切后台导致 tween 挂起时，`update()` 的硬切照常生效，只是幕布可能停在某个透明度；因此在场景重建那段末尾补一行：
```ts
this.tweens.killTweensOf(this.curtain); this.curtain.setAlpha(this.curtain.alpha > .5 ? this.curtain.alpha : 0);
```
并让淡出在下一帧继续——简单起见，重建后直接 `this.tweens.add({ targets: this.curtain, alpha: 0, duration: 220 })`。

- [ ] **Step 3: 验证**

```bash
npx tsc --noEmit && npm run build && npm run dev
```
浏览器确认：进门时有一次约 400ms 的黑场淡入淡出，出来时同样；转场期间按住移动键，出来后人物仍在正确位置（服务端没停过）。切到别的标签页再切回来，画面不应卡在黑幕上。

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat: 踏门转场的淡入淡出动画"
```

---

### Task 7: 小地图按 area 切换

**Files:**
- Modify: `src/map-panel.ts`

**Interfaces:**
- Consumes: Task 2 的 `projectTo` / `AREAS`、Task 3 的 `Actor.area`
- Produces: 无新对外接口

- [ ] **Step 1: 走廊小地图显示房间内玩家的投影**

`src/map-panel.ts` 的 `snapshot` 监听里，玩家圆点的坐标改成投影后的：
```ts
const dot = (p: Actor) => { const q = projectTo(AREAS[p.area], p.x, p.y); return `<circle cx="${q.x}" cy="${q.y}" r="${p.id === player?.id ? 30 : 22}" fill="${p.id === player?.id ? '#c0f3c8' : '#e4c88d'}" stroke="#172b24" stroke-width="12"/>`; };
```

- [ ] **Step 2: 房间内切换成房间平面图**

把小地图的内容生成抽成一个按 area 重建的函数。`mapPanelMarkup` 里的 `<svg id="minimap">` 改为空壳（只保留 id 与 class），内容由 JS 填：

```ts
function renderMinimap(area: Area) {
  const svg = get('minimap') as unknown as SVGSVGElement;
  svg.setAttribute('viewBox', `0 0 ${area.width} ${area.height}`);
  svg.innerHTML = area.id === 'corridor' ? corridorMarkup() : roomMarkup(area);
  get('map-title').textContent = area.id === 'corridor' ? '1F · 楼层导览' : `${area.name} · 室内`;
  get('leave-area').hidden = area.id === 'corridor';
  bindRooms();   // 只有走廊有房间按钮
}

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
```

`mapPanelMarkup` 的面板标题改成带 id 的 `<span id="map-title">1F · 楼层导览</span>`，并在小地图下方加一个默认隐藏的按钮：

```html
<button id="leave-area" class="map-leave" hidden>← 返回走廊</button>
```

在 `snapshot` 监听里，当 `player.area` 与上次不同时调用 `renderMinimap(AREAS[player.area])`。

按钮点击把相机对准出口：
```ts
get('leave-area').onclick = () => {
  const area = AREAS[network.snapshot?.players.find(p => p.id === network.profile?.id)?.area ?? 'corridor'];
  const exit = area.exits[0]; if (!exit) return;
  scene.lookAt(exit.rect.x + exit.rect.width / 2, exit.rect.y + exit.rect.height / 2);
};
```

样式追加到 `src/style.css`：
```css
.map-leave{width:100%;margin-top:7px;padding:7px;background:#243a2d;border:1px solid #5d7a62;border-radius:4px;color:#d6ecd0;font-size:10px}
.map-leave:hover{background:#2f4b39}
```

**注意**：spec 原文写的是"给人物一个寻路目标走到门口"。自动寻路需要在有家具的房间里做避障，是一个独立子系统。本计划改为**只把相机对准出口**，人物仍由玩家自己走。这是对 spec 的一处有意偏离，已在交付说明中标出，需确认。

- [ ] **Step 3: 房间内隐藏走廊专属控件**

`camera-toolbar` 的「全景」在房间内含义变成"这间屋子铺满"——保持即可，无需改动。房间内隐藏六个房间按钮（它们属于走廊小地图）。

- [ ] **Step 4: 验证**

```bash
npx tsc --noEmit && npm run build && npm run dev
```
浏览器确认：在走廊时小地图显示整层楼、会议室里的人显示为投影点；走进会议室后小地图变成会议室平面图并出现「返回走廊」；点它相机对准门口。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: 小地图按 area 切换，房间内玩家投影到走廊全景"
```

---

### Task 8: 全国地图层与开场序列

**Files:**
- Create: `shared/sites.ts`
- Create: `src/site-map.ts`
- Modify: `src/main.ts`（开场序列接入）
- Modify: `src/style.css`（地图层样式）

**Interfaces:**
- Consumes: Task 5 的相机 `configure` / `overview`、Task 4 的随机出生
- Produces:
  - `shared/sites.ts`: `SITES: Site[]`, `interface Site { id: string; name: string; x: number; y: number; open: boolean }`
  - `src/site-map.ts`: `showSiteMap(): Promise<string>`（resolve 选中的 site id）, `siteMapMarkup: string`

- [ ] **Step 1: 站点数据**

创建 `shared/sites.ts`：
```ts
export interface Site { id: string; name: string; detail: string; x: number; y: number; open: boolean }
/** x / y are percentages on the map panel, so the layout is resolution independent. */
export const SITES: Site[] = [
  { id: 'hangzhou', name: '杭州总部', detail: '摸鱼科技 · 1F', x: 62, y: 52, open: true },
  { id: 'beijing', name: '北京分部', detail: '筹备中', x: 55, y: 24, open: false },
  { id: 'shenzhen', name: '深圳分部', detail: '筹备中', x: 57, y: 79, open: false },
];
```

- [ ] **Step 2: 地图覆盖层**

创建 `src/site-map.ts`。一个全屏 HTML 覆盖层，SVG 画一个抽象的中国轮廓（用一条 `<path>` 的粗略多边形即可，不需要精确地理数据），三个点位按 `SITES` 的百分比定位。只有 `open` 的可点。返回一个在点击后 resolve 的 Promise。样式复用现有的 `--mint` / `--surface` / `--line` 变量。

- [ ] **Step 3: 开场序列**

`src/main.ts` 底部，把现有的
```ts
void network.restore().then(restored => { if (restored) return initialJoin(); })
```
改成：
```ts
void network.restore().then(async restored => {
  if (!restored) return;
  await showSiteMap();          // 全国地图，点击杭州总部
  await initialJoin();
  await scene.playOpening();    // 楼层全景停留 1.5s 后推镜到出生 area
}).catch(() => toast('服务器暂时无法连接。请确认服务已启动后重试。'));
```
`auth` 与 `guest` 的成功分支同样在 `initialJoin()` 后接 `scene.playOpening()`。

`src/game.ts` 新增：
```ts
/** Opening: hold the whole floor for a beat, then push into wherever the server spawned us. */
async playOpening() {
  const me = () => this.network.snapshot?.players.find(p => p.id === this.network.profile?.id);
  this.officeCamera.configure(AREAS.corridor);
  await new Promise(r => setTimeout(r, 1500));
  const actor = me();
  if (actor) this.officeCamera.focus(actor.x, actor.y);
}
```
若玩家出生在房间里，Task 5 的权威规则会在第一个 snapshot 到达时就把场景切到该 area；`playOpening` 的全景停留因此要在切换**之前**完成——实现时用一个 `this.openingUntil = performance.now() + 1500` 时间戳，在 `update()` 的权威规则分支里跳过切换直到该时刻，避免竞态。

- [ ] **Step 4: 跳过**

覆盖层与开场期间，任意 `keydown` / `pointerdown` 立即结束当前阶段。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit && npm run build && npm run dev
```
浏览器确认：登录后先看到全国地图，只有杭州总部可点；点击后看到楼层全景约 1.5 秒；镜头推进到你出生的位置。按任意键可跳过。刷新页面重复一次。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: 全国地图层与登录开场序列"
```

---

### Task 9: 斜视绘制的纯函数与测试

**Files:**
- Create: `src/render/oblique.ts`
- Create: `tests/oblique.test.ts`

（本任务不改 `shared/`。`Furniture.lift` 字段由 Task 10 加。）

**Interfaces:**
- Consumes: Task 1 的 `Rect`（type-only import）
- Produces:
  - `oblique.ts`: `interface Solid extends Rect { lift: number; top: number; side: number }`（`top` / `side` 是 0xRRGGBB 颜色）, `faces(solid: Solid): { shadow: Rect; side: Rect; top: Rect }`, `shade(color: number, amount: number): number`, `depthOf(footprint: Rect): number`

- [ ] **Step 1: 写失败的测试**

创建 `tests/oblique.test.ts`：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { faces, shade, depthOf } from '../src/render/oblique.js';

test('a lifted solid draws shadow at the footprint, side below the top, top raised by lift', () => {
  const f = faces({ x: 100, y: 200, width: 60, height: 40, lift: 24, top: 0x808080, side: 0 });
  assert.deepEqual(f.shadow, { x: 100, y: 200, width: 60, height: 40 });
  assert.deepEqual(f.top, { x: 100, y: 200 - 24, width: 60, height: 40 });
  // The side face fills the gap between the raised top's bottom edge and the footprint's bottom edge.
  assert.deepEqual(f.side, { x: 100, y: 200 + 40 - 24, width: 60, height: 24 });
});

test('a flat solid has no side face', () => {
  const f = faces({ x: 0, y: 0, width: 10, height: 10, lift: 0, top: 0xffffff, side: 0 });
  assert.equal(f.side.height, 0);
  assert.deepEqual(f.top, { x: 0, y: 0, width: 10, height: 10 });
});

test('shade darkens toward black and never leaves the byte range', () => {
  assert.equal(shade(0xffffff, 0), 0xffffff);
  assert.equal(shade(0xffffff, 1), 0x000000);
  assert.equal(shade(0x8040c0, .5), 0x402060);
  const c = shade(0x010101, .99);
  assert.ok(c >= 0 && c <= 0xffffff);
});

test('depth sorts by the footprint bottom edge, so nearer objects win', () => {
  assert.ok(depthOf({ x: 0, y: 100, width: 10, height: 40 }) > depthOf({ x: 0, y: 100, width: 10, height: 10 }));
  assert.equal(depthOf({ x: 0, y: 100, width: 10, height: 40 }), 140);
});
```

- [ ] **Step 2: 运行确认失败**

Run: `npx tsx --test tests/oblique.test.ts 2>&1 | tail -10`
Expected: FAIL，`Cannot find module '../src/render/oblique.js'`

- [ ] **Step 3: 实现**

创建 `src/render/oblique.ts`：

```ts
import type { Rect } from '../../shared/world/types';

export interface Solid extends Rect { lift: number; top: number; side: number }

/** Split one footprint into the three faces a 3/4 view needs. Collision never sees these. */
export function faces(solid: Solid) {
  const { x, y, width, height, lift } = solid;
  return {
    shadow: { x, y, width, height },
    side: { x, y: y + height - lift, width, height: lift },
    top: { x, y: y - lift, width, height },
  };
}

export function shade(color: number, amount: number) {
  const k = 1 - Math.min(Math.max(amount, 0), 1);
  const r = Math.round(((color >> 16) & 0xff) * k), g = Math.round(((color >> 8) & 0xff) * k), b = Math.round((color & 0xff) * k);
  return (r << 16) | (g << 8) | b;
}

/** Painter's order: whatever sits lower on the floor is drawn in front. */
export const depthOf = (footprint: Rect) => footprint.y + footprint.height;
```

- [ ] **Step 4: 验证**

Run: `npx tsx --test tests/oblique.test.ts 2>&1 | tail -10`
Expected: 4 条全部通过。

注意 `tests/` 用 `.js` 后缀 import `src/` 下的文件，而 `src/render/oblique.ts` 内部 import `shared` 不带后缀——因为它同时被 Vite 和 tsx 加载。若 tsx 报错，把 oblique.ts 的 import 改成 `type` only import（`import type { Rect }`），类型导入在运行时被擦除，不产生解析问题。上面的写法已经是 type-only。

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat: 3/4 斜视的三面拆分与深度排序纯函数"
```

---

### Task 10: area 渲染器与斜视接入

**Files:**
- Create: `src/render/area-renderer.ts`
- Delete: `src/office-map.ts`
- Modify: `src/game.ts`（改用新渲染器、角色深度）
- Modify: `shared/world/corridor.ts` / `meeting.ts` / `storage.ts`（给家具与墙补 `lift` 高度）

**Interfaces:**
- Consumes: Task 9 的 `faces` / `shade` / `depthOf`、Task 2 的 `Area`
- Produces: `src/render/area-renderer.ts`: `drawArea(scene: Phaser.Scene, area: Area): Phaser.GameObjects.Container`, `createOfficeAvatar(scene): void`

- [ ] **Step 1: 给数据补高度**

`shared/world/types.ts` 的 `Furniture` 加 `lift?: number`。在三个 area 文件里给每类家具一个高度：`desk` 22、`table` 26、`shelf` 62、`counter` 34、`sofa` 30、`plant` 26；墙统一 46。不写 `lift` 的按 0 处理（平的，例如地毯）。

实现方式：在 `index.ts` 里集中给默认值，避免三个文件各写一遍：
```ts
const LIFT: Record<Furniture['kind'], number> = { desk: 22, table: 26, shelf: 62, counter: 34, sofa: 30, plant: 26 };
for (const area of Object.values(AREAS)) for (const f of area.furniture) f.lift ??= LIFT[f.kind];
```

- [ ] **Step 2: 写渲染器**

创建 `src/render/area-renderer.ts`。把 `src/office-map.ts` 的绘制逻辑搬过来，改成：

- 地板与网格仍画进一个底层 `Graphics`（`setDepth(0)`）
- **每件墙和家具各建一个 `Graphics`**，用 `faces()` 画三面：`shadow` 用 `shade(top, .55)` 且 alpha .25、`side` 用 `shade(top, .2)`、`top` 用原色，然后 `setDepth(depthOf(footprint))`
- 房间标题文字画在地板层
- `createOfficeAvatar` 原样保留

- [ ] **Step 3: 角色深度**

`src/game.ts` 的 `renderActor()` 里，办公室模式下把
```ts
v.sprite.setDepth(20); v.label.setDepth(30); v.health.setDepth(30);
```
改成
```ts
const depth = office ? v.sprite.y + 12 : 20;
v.sprite.setDepth(depth); v.shadow.setDepth(depth - 1); v.label.setDepth(10000); v.health.setDepth(10000);
```
名牌和血条始终在最上层，角色本体参与遮挡排序。

- [ ] **Step 4: 删除旧文件并接线**

```bash
git rm src/office-map.ts
```
`src/game.ts` 的 import 改成 `from './render/area-renderer'`。

- [ ] **Step 5: 验证**

```bash
npx tsc --noEmit && npm test && npm run build && npm run dev
```
浏览器确认：
- 墙体和家具有厚度，看得到立面
- 人物走到桌子/货架**上方**时被遮挡，走到**下方**时遮住它们
- 名牌和血条永远不被遮挡
- 缩放到最大时立面不撕裂
- 会议室与储物间内部同样是斜视

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "feat: 3/4 斜视渲染器，墙与家具分对象按 y 排深度"
```

---

## 验收清单

全部任务完成后逐条确认：

- [ ] `npm test` 全绿（9 项原有 + Task 2 的 4 项 + Task 3 的 3 项 + Task 4 的 1 项 + Task 9 的 4 项）
- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过
- [ ] 登录 → 全国地图 → 楼层全景 → 推镜到出生点，可跳过
- [ ] 六个门口：会议室与储物间可进出，其余四间回「装修中」
- [ ] 两个浏览器同处会议室互相可见；一个走廊一个会议室互相不可见，但走廊侧小地图能看到对方的投影点
- [ ] 储物间内按 E 打开商店，走廊内按 E 不打开
- [ ] 走廊最右侧按 E 进入副本，副本内战斗与奖励不受影响
- [ ] 断线 12 秒内重连，回到原 area 原位置
- [ ] 人物被家具遮挡关系正确，名牌不被遮挡
