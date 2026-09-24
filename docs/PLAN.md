# 牛马上班 处处战场 MVP

Current scope: browser multiplayer, fictional company and characters, an overhead office floor with zoomable navigation, and a side-view cooperative dungeon. Target architecture supports multiple office/dungeon rooms; 200 CCU is a later load-test target, not an MVP performance claim.

## Implementation
1. Phaser browser app and Colyseus authoritative room server.
2. Account/password login, durable PostgreSQL data (PGlite locally, DATABASE_URL in deployment), unique sessions.
3. Shared fixed-step movement; office (24 players) uses four-direction movement and wall/furniture collision, cooperative dungeon (8 players) retains side-view movement, three monsters and completion reward.
4. Three roles with fixed 100 HP, three weapons, server-side purchases/equipping, persisted progress.
5. Browser QA with two identities; integration tests for room isolation, unauthorized access, combat, persistence and duplicate rewards.

## Visual system
Reference: design/concept.png. Dark #11151c page, #1a212b surfaces, cream #f5eedc foreground, muted #8e9ca8, mint #a6e8c2 accent. Slim header, spacious title, 16:9 game canvas plus mission rail, keyboard control strip. Native DOM controls and accessible dialogs; generated office and atlas artwork. Main copy: 牛马上班 处处战场; 公共办公室; 装备商店; 今天，也要准时下班。; 摸鱼科技; 下班计划; 熟悉办公室; 清理加班怪; 领取下班奖励; 进入副本.

## Bounds
No real-person targeting, office scans, PvP, chat, trading, offline AI, or production deployment. Offline characters persist without participating. Browser reload restores account and progress; short disconnect offers reconnection. No claim of multi-process or 200-player readiness before dedicated load testing.

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
