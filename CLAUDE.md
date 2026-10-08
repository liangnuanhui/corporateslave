# 牛马上班 处处战场

浏览器多人游戏。Phaser 4 客户端 + Colyseus 权威服务器，TypeScript，数据落 PGlite（本地）/
PostgreSQL（部署）。公司和角色全部虚构。**只做 PC**，触屏代码还在树里但不受支持、不维护。

## 先读这个

**`docs/PLAN.md` 的「现在到哪了，下一步做什么」一节**——能玩到什么、什么走不到、
哪些坑会让你白花时间。不读它你很可能在修一个已知且有意接受的缺口。

## 命令

```
npm run dev        # 服务器 + vite，两个一起起
npm test           # node:test，全量约 85 秒
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit && vite build
```

**不要整文件跑 `tests/multiplayer.test.ts`。** 里面有条 210 秒超时的集成测试，跑起来
60–85 秒且中途几乎无输出——agent 的 watchdog 会把你判成「无进展」杀掉（已经发生过两次）。
开发时用 `npx tsx --test --test-name-pattern='<标题片段>' tests/multiplayer.test.ts`，
全量只在最后跑一次。`tests/chat.test.ts`、`tests/minimap.test.ts` 等几个是秒级的。

## 几条很容易破、破了不一定报错的规矩

- **服务器权威。** 客户端只发意图（`{ text }`、`{ emote }`、`input`）。净化、截断、限流、
  查表、伤害判定全在 `server/`。客户端算出来的东西永远不是真相。
- **一句话是事件，不是状态。** 聊天走 `broadcast('chat', …)` 一次，客户端自己管过期。
  **不要把转瞬即逝的东西塞进快照**——快照每 2 tick 全量重发，塞进去就等于每秒重复 15 次。
  伤害数字（`hit`）走的也是这条路。
- **文案只有一处定义。** `ORG_NAME`、`EMOTES`、`NPC_LINES` 都在 `shared/game.ts`，客户端
  不许重写一份。`tests/copy.test.ts` 钉着这条，旧公司名在 `src/` 或 `shared/` 里复现就红。
- **`shared/world/` 是楼层平面图的唯一定义**——碰撞、出口、房间到楼层的投影都在那。
  只有服务器施加移动；客户端相机从不改角色坐标。
- **渲染高度有统一上限**（`MAX_LIFT`）。抬高任何实体之前先看那条断言——它存在的理由是
  「没有东西高到能把人完全挡住」。

## 测试上的两条经验，都是踩出来的

- **测试替身要长成生产调用点真正会产生的形状。** 本轮最严重的 bug 躲过了九次 review，
  就因为单测把一个 NPC 构造成了「披着玩家外壳」的对象，而真实调用点从不产生那种形状。
  单测绿着，却给了一个没有测试的调用点以虚假的信心。
- **`src/map-panel.ts` 这类 DOM 代码（`innerHTML` / `getElementById`）`node:test` 到不了。**
  它里面的 bug 只有浏览器能抓。待验的人工项在 `docs/qa/`。

## 文档怎么写

`docs/PLAN.md` 的中文章节记录的是**踩过的坑和为什么这么选**，不是功能清单。读两节体会语气：
「画面尺寸不再做任何算术」、「删掉的面板留下的列」——都是先讲错在哪、再提炼成一条规则。
数值背后的理由比数值本身重要。**不要往里写发布说明。**

代码注释和 commit message 用中文，注释记录规则而不是数值。
