# 牛马上班 处处战场 MVP

Current scope: browser multiplayer, fictional company and characters, and an overhead office floor with zoomable navigation. The side-view cooperative dungeon still exists in the server and in the scene's render paths, but no UI reaches it — see 「界面收窄 — 2026-09-24」 below. Target architecture supports multiple office/dungeon rooms; 200 CCU is a later load-test target, not an MVP performance claim.

**接手这个项目，先读「现在到哪了，下一步做什么 — 2026-10-08」那一节**（就在 Bounds 下面）：
它列了能玩到什么、什么走不到、哪些坑会让你白花时间。

## Implementation
1. Phaser browser app and Colyseus authoritative room server.
2. Account/password login, durable PostgreSQL data (PGlite locally, DATABASE_URL in deployment), unique sessions.
3. Shared fixed-step movement; office (24 players) uses four-direction movement and wall/furniture collision, cooperative dungeon (8 players) retains side-view movement, three monsters and completion reward.
4. Three roles with fixed 100 HP, three weapons, server-side purchases/equipping, persisted progress.
5. Browser QA with two identities; integration tests for room isolation, unauthorized access, combat, persistence and duplicate rewards.

## Visual system
Reference: design/concept.png. Dark #11151c page, #1a212b surfaces, cream #f5eedc foreground, muted #8e9ca8, mint #a6e8c2 accent. The page is now the game picture and nothing else: a full-width 16:10 canvas whose width is capped so its height fits the viewport, with the identity chip, key hints, connection state and the closing line in one strip beneath it. Native DOM controls and accessible dialogs; generated office and atlas artwork. Main copy: 牛马上班 处处战场; 新阳光基金会; 装备商店; 邀请同事; 今天，去哪？; 生死看淡，不服就干. The company has exactly one name and one definition — `ORG_NAME` in shared/game.ts. index.html's `<title>` is the sole static copy, because it is read before any module runs; tests/copy.test.ts pins it to the constant and fails if the old name reappears anywhere under src/ or shared/.

## Bounds
No real-person targeting, office scans, PvP, trading, offline AI, or production deployment. Offline characters persist without participating. Browser reload restores account and progress; short disconnect offers reconnection. No claim of multi-process or 200-player readiness before dedicated load testing.

Chat exists as of 2026-09-30, in exactly one form: typed lines and six emotes become an overhead
bubble that expires. There is no log, no history and no persistence — a line that has faded is gone.

## 现在到哪了，下一步做什么 — 2026-10-08

接手时先读这一节。下面每条都核过代码，不是凭印象。

### 能玩到的

注册 / 登录 → 全国地图开场 → 走廊，加大会议室与储物间两个房间，走门转场、3/4 斜视、
相机缩放平移、小地图。按 `J` 打刘正超（他自己走动、回工位、玩手机、说废话、点名你）。
按 `Enter` 打字、`1`–`6` 或 `/挥手` 发表情，全楼层广播，隔壁的话落在小地图上。

80 条自动化测试，`npm run build` 通过。

### 走不到或坏掉的，按「用户多容易撞上」排序

1. **经济是个死循环，这条最容易撞上。** 初始 30 积分（`server/database.ts:42`），最便宜的
   付费武器 60，而唯一的收入是副本通关 `+80`（`database.ts:83`）——副本的入口在
   「界面收窄 — 2026-09-24」那次全部删掉了，`src/` 里没有任何代码会 join 它。所以
   **没有任何办法赚到第二把武器**，而商店的报错还写着「积分不足，先去副本完成挑战吧」，
   指向一个去不了的地方。要么给办公室一个积分来源，要么把副本入口加回来，要么改报错——
   但不能三样都不做。

2. **四个房间还锁着**：办公室 1/2、休息区、茶水间。机制已就位，开一间 = 在
   `shared/world/corridor.ts:61` 的 `OPEN` 里加一项 + 供一份 interior；现在踏门回
   「XX还在装修中，敬请期待」。主要成本是内容量（家具布局、出生点、小地图投影、每间的测试）。

3. **房间里看不到别处的话。** 全楼层广播在走廊上完整，进了房间只兑现一半。有意接受的
   取舍，理由见「办公室里说得上话了」那节。要补就得先回答「房间平面图上用什么代表别处」。

4. **刘正超不还手，打倒他不给积分。**

5. **玩家之间除了聊天零互动**：没有成员名单、没有 PvP、没有聊天记录面板。后两样在
   Bounds 里仍是明确排除的。

### 23 条浏览器验证一条都没验

`docs/qa/2026-09-30-office-chat.md`。不是走流程：中文输入法那条无法自动化（需要真实
输入法），而小地图那三条是某个修复**唯一的**凭据——已实测确认，把 `src/map-panel.ts`
的调用点改回出 bug 的写法，37 条单测照样全绿。

### 接手前要知道的四个坑

- **不要整文件跑 `tests/multiplayer.test.ts`。** 里面有条 210 秒超时的集成测试，跑起来
  约 60–85 秒且中途几乎无输出；本轮有两个 agent 因此被 watchdog 判成「无进展」杀掉。
  开发时用 `--test-name-pattern` 跑单条，全量只在最后跑一次。
- **`src/map-panel.ts` 是 DOM 代码**（`innerHTML` / `getElementById`），`node:test` 到不了。
  它里面的 bug 只有浏览器能抓。要让它可测，得把「快照 → 标记」这一步抽成纯函数。
- **测试替身要长成生产调用点真正会产生的形状。** 本轮最严重的那个 bug 躲过了九次 review，
  就是因为单测把 NPC 构造成了一个「披着玩家外壳」的对象，而真实调用点从不产生那种形状——
  单测绿着，给了一个没有测试的调用点以虚假的信心。
- **`server/database.ts:38` 的昵称校验只查非空和 ≤12 码点**，不拒绝内部的 `\n` 或控制字符。
  广播通道已经在 `say()` 里收窄净化，但原始字符串仍然存在 profile、`snapshot.players[].name`
  和 `ChatEvent.to` 里。根治是在注册处拒掉。

### 三条已知但判为不阻塞的小问题

- `tests/multiplayer.test.ts` 的 `assert.equal(va.hits.length, 1)` 隐含依赖「办公室同事不还手」
  这个 zone 门控。他哪天会还手了，这条会以一个和它的主张无关的理由变红。
- 同文件 `claim` 之后那处 `until(() => va.notices.length > 0)` 仍是裸长度判断，可能被走廊
  锁门的「装修中」提示满足；后续的 `coins === 30` 仍承载真正的主张。
- `src/minimap.ts` 的 `Located` 要求 `hp`，但 `minimapDots` 并不读它，参数类型过约束。

## 办公室里说得上话了 — 2026-09-30

按 `Enter` 打字，头顶冒气泡；`1`–`6` 或 `/挥手` 这类命令发六个表情。全楼层广播——
不在同一个房间的人说的话，落在小地图上他投影出的光点旁（截短到六个字），点名到你的
那条是薄荷绿。没有聊天记录：话淡出了就没了。

代价：在房间里（大会议室 / 储物间）时看不到别处的话。房间的小地图画的是那个房间自己的
平面图，上面没有任何位置能代表「别处」。所以全楼层广播在走廊上是完整的，进了房间就只
兑现一半——消息收得到，但没地方显示。这是一个有意接受的取舍（硬塞一个非空间的角落浮层
会违背「小地图气泡是为了保住空间感」这个设计决定），不是 bug。

**一句话是事件，不是状态。** 服务器 `broadcast('chat', …)` 一次，客户端自己维持一张
`id → { text, until }` 表并到点抹掉。刘正超原先的 `say` 字段从快照里删掉了，迁到同一条
通道——否则渲染层要认两套气泡。这么选不是为了省带宽（24 人远不到瓶颈），是因为快照每
2 tick 全量重发：把一句话放进快照，就等于每秒重复它 15 次。仓库里早有先例，`hit` 的伤害
数字走的就是这条路。

代价：中途加入或重连的人看不到正在飘的那句话。这对聊天是对的——走进会议室不该看到三秒前
的话还挂在别人头上。

四个踩过的坑：

- **中文输入法的 `Enter` 是确认候选词，不是发送。** 不放行 `event.isComposing`（以及老
  WebKit 的 `keyCode === 229`），每个用输入法的人第一次打字都会把半截拼音发出去——「nihao」
  直接飘在头顶。这条只有中文用户会遇到，而写代码的人如果用英文测，永远测不出来。
- **截断要按码点，不按 UTF-16 码元。** `'👍'.length === 2`，`slice(0, 40)` 会从代理对中间
  切开，屏幕上是一个乱码方块。`[...text].slice(0, 40).join('')`。
- **关闭输入框时必须重置按键状态。** 按 `Enter` 开聊天那一刻你可能正按着 `D`；焦点在输入框
  时画布收不到 `keyup`，Phaser 那边 `D` 会一直是按下状态。关掉聊天，人就自己往右走，而你没碰
  任何键。症状和原因隔着一次焦点切换，很难联想到一起。
- **`preventDefault()` 不阻止冒泡。** 输入框里按 `Enter` 发送后，同一个 keydown 会继续冒到
  window 上的监听器，而那时「聊天框开着」已经被置回 false，于是门控全部通过——框立刻重开。
  症状是「消息发出去了，但人再也走不动」，看起来跟聊天毫无关系。修法是两处：在输入框的
  处理器最开头 `stopPropagation()`，以及把「这个按键来自聊天框自身」做成门控函数里的一个
  显式条件——后者才是能被单元测试钉住的那一半。

另外，`escape()` 从 `src/main.ts` 抽成了 `src/escape.ts`。小地图是 `innerHTML` 拼 SVG
（`src/map-panel.ts`），此前流过那里的全是数字和服务器生成的 id，**聊天文本是第一个到达
那个 `innerHTML` 的用户可控字符串**。头顶气泡不需要转义（Phaser Text 画在 canvas 上），
小地图需要，而且有测试钉住。

## 办公室里的攻击目标 — 2026-09-24

攻击不再需要副本：每个角色默认能打，按 `J` 触发，目标就在办公室里。MVP 只放一个——
虚构同事「刘正超」（`NPC`，shared/game.ts）。

- **血量和出现位置每次重抽。** 血量在 60–180 之间按 10 取整；位置先随机挑一个开放区域，
  再用 `randomStandablePoint()` 在里面拒绝采样，直到落在站得住、且不压门口触发器的点上。
  被打倒 8 秒后重来一次，所以他换个工位继续上班。
- **俯视的近战范围是一个半径**（`inMelee`，64px），不是副本那套侧视规则。侧视规则横向够得远、
  纵向是一整条竖板，用在俯视会变成「站在同事正上方却打不着」。
- **`meleeHits()` 把判定抽成纯函数**：活着 + 同一个房间 + 在半径内，三个条件缺一不可。
  房间之间是各自独立的坐标系，(530,500) 在每个房间里都存在——少了 area 那一条，站在走廊上
  就能隔着墙打到会议室里坐标相同的人，而且屏幕上什么都看不见。
- **击退 6px，不是 12px。** 12px 时站着不动连打，大约四下就把他推出 64px 的攻击半径，
  之后每一下都落空而屏幕上毫无反馈——看起来像攻击坏了。这个是集成测试跑出来的，不是设计出来的。

还没有的：他不会还手，不会走动，打倒他也不给积分。玩家之间依然不会互相伤害。

## 刘正超会自己上班了 — 2026-09-24

**2026-09-30 改设定：他现在是领导。** 压着下属、毫无能力也毫无管理经验，台词分甩锅、画饼、
踢皮球三类，外加会点名——模板是「这个 {name} 处理一下」这一类，名字从全楼层在线玩家里
随机挑。名牌也加了职级，读作「刘正超 · 主管」，在工位时是「刘正超 · 主管 · 在工位」。

**职级是 `NPC` 上单独的 `title` 字段，没有并进 `name`。** 看起来可以偷懒直接把
`name` 改成 `'刘正超 · 主管'`，但 `name` 被服务器「XX 躺平了」一类的系统提示、
以及 `tests/multiplayer.test.ts` 里十几处断言和日志共用——并进去，职级会漏到
所有那些不该出现职级的地方。只有名牌渲染（`src/game.ts`）读 `title`，两处读者
分开，谁也不用为对方的格式操心。

**一个人都没在线时，点名那一类整个跳过。** 这不是新机制，是这一节下面已经记过的同一个套路：
走廊没有工位，`spotAtDesk(corridor)` 返回 undefined，抽到「回工位」就退化成「玩手机」，
而不是把人塞进墙里假装那是工位。同样地，没人可点就不点，而不是点一个叫 `undefined` 的同事。

台词锁在无能与甩锅上，不碰性别、地域、外貌——被点名的是真实用户自己起的昵称，玩笑和冒犯
之间就隔着这条线。

他的 `say` 字段已从快照中删除，说话走 `chat` 事件；`sayForMs` 也没了，气泡时长改由
`bubbleMs()` 按字数算。他仍然不还手，打倒他仍然不给积分。

他不再是个站着不动的沙包：会在房间里走动、走到桌边「回工位」、停下来「玩手机」，
时不时冒一句废话（`NPC_LINES`）。挨打时停 1.2 秒——边挨打边散步既看不出受伤，
也会把攻击者甩开。

- **走廊没有工位。** 走廊那 19 张桌子全画在六个封闭房间的方框内部，而那些方框在走廊平面上
  是实心障碍，四条边都站不住。所以 `spotAtDesk(corridor)` 返回 undefined，抽到「回工位」时
  退化成「玩手机」，而不是把人放进墙里假装那是工位。大会议室的长桌、储物间的装备台是真工位。
- **换房间只在没人看见时发生**（`relocateAfterMs`，45 秒）。否则就是当着玩家的面瞬移。
- **浮层从下往上是：名牌 y-26、血条 y-62、气泡 y-70**，三个数写在一起（`OFFICE_*_UP`）。
  血条最早和名牌深度相同又位置重叠，屏幕上完全看不见——是数截图里的紫色像素才发现的。

测试上的两个坑，都踩过：
- 「先对齐 x 再走 y」走不到他：目标位置是随机的，两点之间有没有货架完全不可控，而单轴推进
  被挡住时会原地顶满超时。两个轴一起推才能贴着障碍物滑过去（`moveIn` 是分轴判定的）；
  卡死时的侧移必须垂直于主要行进方向，第一版朝「远离目标」侧移，越卡越远。
- 观察窗口要够长。他每段活动之间歇 4–11 秒，下一段有一半概率不是走动，连着抽中两三次
  「玩手机」就是二三十秒不挪窝。窗口太短时断言是真的，只是没观察够。

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
  area the player spawned in. Any key or click skips the whole sequence at any stage. The
  `?zone=dungeon` deep link is gone along with the other dungeon entry points (see
  「界面收窄 — 2026-09-24」); the server still accepts `zone: 'dungeon'`, but nothing in the UI
  produces that link any more.
- In 储物间, press E to open the equipment shop — the shop is refused anywhere else. The far-right
  end of the corridor no longer has an E trigger; that was the dungeon entry point removed in
  「界面收窄 — 2026-09-24」.
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
