# 牛马上班 处处战场 MVP

Current scope: browser multiplayer, fictional company and characters, and an overhead office floor with zoomable navigation. The side-view cooperative dungeon still exists in the server and in the scene's render paths, but no UI reaches it — see 「界面收窄 — 2026-09-24」 below. Target architecture supports multiple office/dungeon rooms; 200 CCU is a later load-test target, not an MVP performance claim.

## Implementation
1. Phaser browser app and Colyseus authoritative room server.
2. Account/password login, durable PostgreSQL data (PGlite locally, DATABASE_URL in deployment), unique sessions.
3. Shared fixed-step movement; office (24 players) uses four-direction movement and wall/furniture collision, cooperative dungeon (8 players) retains side-view movement, three monsters and completion reward.
4. Three roles with fixed 100 HP, three weapons, server-side purchases/equipping, persisted progress.
5. Browser QA with two identities; integration tests for room isolation, unauthorized access, combat, persistence and duplicate rewards.

## Visual system
Reference: design/concept.png. Dark #11151c page, #1a212b surfaces, cream #f5eedc foreground, muted #8e9ca8, mint #a6e8c2 accent. The page is now the game picture and nothing else: a full-width 16:10 canvas whose width is capped so its height fits the viewport, with the identity chip, key hints, connection state and the closing line in one strip beneath it. Native DOM controls and accessible dialogs; generated office and atlas artwork. Main copy: 牛马上班 处处战场; 新阳光基金会; 装备商店; 邀请同事; 今天，去哪？; 摸鱼科技; 生死看淡，不服就干.

## Bounds
No real-person targeting, office scans, PvP, chat, trading, offline AI, or production deployment. Offline characters persist without participating. Browser reload restores account and progress; short disconnect offers reconnection. No claim of multi-process or 200-player readiness before dedicated load testing.

## 界面收窄 — 2026-09-24

右侧那条任务栏（品牌、公共办公室 / 装备商店 导航、下班计划三步、创建角色主按钮、房间成员名单、
房间号）整条移除，画面独占整行。保留下来的东西换了位置：

- **装备商店、邀请同事、音效** 移到画面底部那条提示栏的右端。商店本来就要求站在储物间的装备台前，
  按钮不在储物间时变灰，点了仍然会告诉你该去哪。
- **连接状态与延迟** 移到画面下方的键位说明那一行。
- **房间号不再显示。** 一个 Colyseus 房间就是一家公司，界面上显示的是这家公司的名字
  （`ORG_NAME`，见 shared/game.ts），MVP 只有一家：新阳光基金会。画面左上角的地点牌现在读作
  「新阳光基金会 · 1F · 公共走廊」。邀请链接仍然带房间号，只是玩家看不到它。
- **副本入口全部删除**：主按钮、走廊最右端按 E 的触发点、返回办公室按钮、`?zone=dungeon` 深链
  都没了，join() 只连办公室。server 仍然认 `zone: 'dungeon'`，场景里也还留着副本的绘制分支，
  但从界面走不到那里——要恢复，是加回入口，不是重写。
- **「创建角色」按钮没了，所以没有身份时直接弹工牌对话框。** 控制条上的工牌按钮仍是第二个入口。

代价（当时没有要求保留，记在这里以便回头改主意）：房间成员名单、下班计划三步进度、副本奖励提示
一并消失。小地图上仍能看到同房间其他人的光点。

## Office floor navigation — 2026-09-24

The floor is no longer one plane. It is a corridor plus independent room interiors, each with its
own coordinate space, and the authoritative server moves a player between them when they step on a
door trigger.

- **Six rooms, two open.** 大会议室 and 储物间 have real interiors (1100×760, larger than their
  footprint on the corridor plan). 办公室 1/2、休息区、茶水间 are sealed for now; stepping on their
  threshold replies 「XX还在装修中，敬请期待」. Opening one later means supplying an interior and
  clearing a `locked` flag — the mechanism is already there for all six.
- **Crossing a door is a teleport between coordinate spaces**, not a walk across a continuous plane.
  The client fades out, rebuilds the scene for the new area while the curtain is opaque, and fades
  back in. The snapshot is authoritative throughout: if the local scene ever disagrees with it, the
  scene is rebuilt immediately.
- **Players see each other only within the same area.** They remain in one Colyseus session and one
  24-player room the whole time, but the client renders only those in the area it is displaying.
  The minimap closes that gap: a player inside a room is projected onto that room's footprint on the
  floor plan, so the corridor overview still shows who is where.
- **New arrivals are scattered** at random across the open areas rather than queuing at reception.
- **Controls.** WASD *and* the arrow keys move the character, in both the office and the dungeon.
  The camera is panned with the mouse only — drag, or push the cursor against the edge of the view.
  The wheel zooms about the cursor, keeping the world point under the pointer pinned for the whole
  smooth zoom. − / ＋ zoom about the viewport centre; 全景 resets; 跟随我 toggles following and now
  survives crossing a door.
- **The opening.** A stylised map of the company's sites, then the floor, then a push into whichever
  area the player spawned in. Any key or click skips the whole sequence at any stage. A
  `?zone=dungeon` invite link goes straight to the dungeon without it.
- In 储物间, press E to open the equipment shop — the shop is refused anywhere else. At the
  far-right end of the corridor, press E to enter the dungeon.
- The dungeon keeps its original combat, controls and rewards; none of the area work touches it.

**PC only.** Existing touch controls and pinch zoom are left in the tree but are unsupported and
unmaintained.

`shared/world/` is the single floor-plan definition — `types.ts`, one file per area, and `index.ts`
as the barrel holding the area registry, collision (`canStandAt`, `moveIn`), exits (`exitAt`) and
the room-to-floor projection (`projectTo`). Render heights live there too, under one cap, so the
assertion that nothing is tall enough to hide a character can cover every lifted solid rather than
furniture alone. Only the server applies movement; the client camera never changes actor
coordinates. `src/render/` holds the 3/4 oblique drawing, `src/office-camera.ts` the camera,
`src/map-panel.ts` and `src/minimap.ts` the navigation UI.

Validation: `npm run build`, `npm test`. The suite covers area collision and diagonal normalisation,
every doorway in both directions against a live server, locked-door notices naming the room, the
`transition` message's payload, reconnect preserving both area and room-local position, exit-trigger
bounce protection, spawn-point reachability by flood fill, the render-height cap, the oblique face
geometry, the transition gate, and minimap dot projection — plus the existing combat, economy and
persistence tests. Browser QA covers the opening and its skip, room entry and exit, occlusion around
furniture, cursor-anchored zoom, edge-scroll panning, minimap switching and the dungeon round trip.
