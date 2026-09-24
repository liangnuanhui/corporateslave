# 牛马上班 处处战场 MVP

Current scope: browser multiplayer, fictional company and characters, and an overhead office floor with zoomable navigation. The side-view cooperative dungeon still exists in the server and in the scene's render paths, but no UI reaches it — see 「界面收窄 — 2026-09-24」 below. Target architecture supports multiple office/dungeon rooms; 200 CCU is a later load-test target, not an MVP performance claim.

## Implementation
1. Phaser browser app and Colyseus authoritative room server.
2. Account/password login, durable PostgreSQL data (PGlite locally, DATABASE_URL in deployment), unique sessions.
3. Shared fixed-step movement; office (24 players) uses four-direction movement and wall/furniture collision, cooperative dungeon (8 players) retains side-view movement, three monsters and completion reward.
4. Three roles with fixed 100 HP, three weapons, server-side purchases/equipping, persisted progress.
5. Browser QA with two identities; integration tests for room isolation, unauthorized access, combat, persistence and duplicate rewards.

## Visual system
Reference: design/concept.png. Dark #11151c page, #1a212b surfaces, cream #f5eedc foreground, muted #8e9ca8, mint #a6e8c2 accent. The page is now the game picture and nothing else: a full-width 16:10 canvas whose width is capped so its height fits the viewport, with the identity chip, key hints, connection state and the closing line in one strip beneath it. Native DOM controls and accessible dialogs; generated office and atlas artwork. Main copy: 牛马上班 处处战场; 新阳光基金会; 装备商店; 邀请同事; 今天，去哪？; 生死看淡，不服就干. The company has exactly one name and one definition — `ORG_NAME` in shared/game.ts. index.html's `<title>` is the sole static copy, because it is read before any module runs; tests/copy.test.ts pins it to the constant and fails if the old name reappears anywhere under src/ or shared/.

## Bounds
No real-person targeting, office scans, PvP, chat, trading, offline AI, or production deployment. Offline characters persist without participating. Browser reload restores account and progress; short disconnect offers reconnection. No claim of multi-process or 200-player readiness before dedicated load testing.

## 画面尺寸不再做任何算术 — 2026-09-24

同一个问题错了三次，每次换一种算法，每次都还是错：

1. `calc(100dvh - 148px)`——148 是量出来的「页面其余部分有多高」，换台机器就不一定对；
2. `min(100%, 100cqh * 1.6)`——要浏览器支持容器查询单位，不支持则整条声明作废；
3. `display:grid` 让早该删除的两栏 template 复活，替一个不存在的面板留出一整列。

共同点不是这三个写法各自有 bug，而是**画面的尺寸依赖了「别处有多高/多宽」这个信息**，
而那个信息可能取不到、可能过期、可能被另一条规则改掉。

现在不依赖任何东西：`main` 撑满一屏，操作条和页脚各占自己那点，**剩下的整块都是画面**
（宽 100%、高 100%）。既不会溢出，也不会偏，因为它就是「剩下的那块」。

代价：画面不再固定 16:10，形状随窗口变。相机本来就按区域自适应，任何形状都能框。
要找回固定比例，先回答一个问题：比例算错时页脚会不会被顶出屏幕——前三次都栽在这里。

实测 168 组（12 种宽 × 7 种高 × dpr 1/2）：画面中心与窗口中心偏差 0，左右留白相等，
纵向溢出 0，操作条与页脚始终完整在屏内。

## 删掉的面板留下的列 — 2026-09-24

画面整体偏左、右侧空一大条，原因是 `.game-layout` 上那条两栏规则还活着：

    .game-layout{display:grid;grid-template-columns:minmax(0,1fr) 284px;gap:18px}

284px 是右侧任务栏的宽度，面板三个提交前就删了，这条规则没人动。中间我把 `.game-layout`
改成 `display:block`，正好把它压住了；再后来为了做垂直布局又改回 `display:grid`——那条
template 就复活了，替一个不存在的面板留出一整列（1450 以上还是 310px，1150 以下 245px）。

已删除这四条死规则，`.game-layout` 现在只有一条定义。

规则：**删掉一个元素时，把只为它存在的样式一起删掉。** 留着不会立刻出事，它会等到某次
无关的改动把它重新激活——那时候症状和原因之间已经隔了好几个提交，很难联想到一起。
另外：`display:block` 这类「顺手压住」不算删除，它只是让死规则暂时不生效。

实测 72 组窗口尺寸（含 1150 / 1450 两个断点两侧）：画面中心与窗口中心偏差 0，比例 1.600，
纵向溢出 0。

## 页面高度不再靠算 — 2026-09-24

画面独占整行之后，它的高度一度写成 `calc(100dvh - 148px)`，148 是量出来的「页面其余部分」
的高度。这个数只要有一点对不上，页脚和操作条就被顶到折叠线以下，而页面本身看不出任何异常。
对不上的方式很多：字体不同导致行高变化、浏览器设了最小字号、或者浏览器不认 `dvh` ——
后者最狠，整条声明作废，画面直接按整行宽度算高度，页面能长到视口的 1.5 倍。

现在 `main` 是一列 flex、高一屏，操作条与页脚各占自己那点，剩下多少给画面就是多少。
16:10 用容器查询单位表达（`width: min(100%, 100cqh * 1.6)`），同样不需要知道别人有多高。
两层退化都是安全的：不认 `cqh` 就退回「撑满可用空间、比例随之变化」，不认 `dvh` 就退回
`100vh`，两种情况下页脚都仍在屏幕内。

规则：**布局里不要出现「我量出来别人有多高」的常数。** 这种数在写下的那一刻是对的，
在别人的机器上不一定对，而且错了的样子是「看起来很正常，只是底下没了」。

实测 90 组窗口尺寸（宽 560–2560 × 高 480–1200）：纵向溢出 0，页脚底边始终 ≤ 视口高度。

## 画面按设备分辨率渲染 — 2026-09-24

Phaser 的 RESIZE 缩放模式按 CSS 像素给画布分配绘制缓冲，并且在这个模式下直接忽略 `zoom`
（实测：2 倍屏上 1332px 宽的画布，缓冲还是 1332px）。于是视网膜屏把整张游戏画面放大一倍显示
——这才是「字为什么那么模糊」的主因，跟字号和文字光栅都没关系。

改法：`Scale.NONE` + 一个 ResizeObserver，自己把缓冲设成 CSS 尺寸的 `RENDER_SCALE` 倍
（见 src/render/dpr.ts，上限 2 倍）。样式表本来就把画布强制显示成容器大小，所以显示尺寸不变。

**代价是相机从此按缓冲像素度量自己。** src/office-camera.ts 是唯一还用屏幕坐标思考的地方，
里面每一个「人眼感知的距离或速度」都要乘 RENDER_SCALE：EDGE、EDGE_SPEED、BOTTOM_UI、maxZoom。
比值不用乘——minZoom 和那个 100% 读数都是两个缓冲量相除，focus() 也按 minZoom 的倍数工作。
改这个文件时，先分清手上的量是「比值」还是「距离」。

实测（1440×900，dpr 1 与 dpr 2 各跑一遍）：光标锚点缩放漂移 0.28 / 0.24 CSS 像素，
拖拽 200 CSS 像素视野正好走 200，缓冲比 1.00 → 2.00，连续五次改窗口尺寸后仍是 2.00。

## 界面收窄 — 2026-09-24

右侧那条任务栏（品牌、公共办公室 / 装备商店 导航、下班计划三步、创建角色主按钮、房间成员名单、
房间号）整条移除，画面独占整行。保留下来的东西换了位置：

- **装备商店、邀请同事、音效** 移到画面底部那条提示栏的右端。商店本来就要求站在储物间的装备台前，
  按钮不在储物间时变灰，点了仍然会告诉你该去哪。
- **连接状态与延迟** 移到画面下方的键位说明那一行。
- **房间号不再显示。** 一个 Colyseus 房间就是一家公司，界面上显示的是这家公司的名字
  （`ORG_NAME`，见 shared/game.ts），MVP 只有一家：新阳光基金会——全站唯一的公司名，注册框、
  全国网点地图、上海办副标题、页面标题都读它。画面左上角的地点牌现在读作
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
