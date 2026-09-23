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

## Office floor navigation — 2026-09-23

The office starts with an overhead view of the whole floor. Six physical spaces share a central corridor: office 1, large meeting room, office 2, storage, lounge and pantry. Walk through the highlighted door openings to enter or leave; no room reload or teleport is required. All players remain in the same multiplayer session and see each other throughout the floor.

The camera is a real-time-strategy camera, in the Age of Empires / Red Alert sense: it belongs to the player's view, never to the character.

- Move the character with WASD or the mobile direction buttons. Diagonal movement has the same speed as movement along one axis. Arrow keys no longer move the character on the office floor — they pan the camera.
- The wheel zooms about the cursor: the world point under the pointer stays under the pointer for the whole smooth zoom, from the floor overview (fit to the stage) down to a single desk at 5x. − / ＋ zoom about the viewport centre; mobile pinch zooms about the pinch centre.
- Pan by dragging, with the arrow keys, or by pushing the cursor against the edge of the view. Pan speed is expressed in screen pixels, so it feels the same at every zoom.
- The minimap floats over the floor, which fills the whole stage. It marks players, the current space and the camera viewport; click or drag anywhere on it to send the camera there, or click a room to frame that room. The map can be collapsed.
- “全景” resets the camera; “跟随我” toggles following the character. Zooming, panning or choosing another room stops following.
- In storage, press E to open the equipment shop. At the far-right end of the corridor, press E to enter the dungeon. The existing navigation buttons remain available.
- The dungeon keeps its original combat controls and rewards; returning to the office resets to the overhead overview.

`shared/office.ts` is the single floor-plan definition for rendered rooms, furniture, wall collisions, minimap layout and location names. Only the server applies movement. The client camera never changes actor coordinates. `src/office-map.ts`, `src/office-camera.ts` and `src/map-panel.ts` separate drawing, camera control and fixed navigation UI.

Validation: `npm run build`, `npm test` (including every doorway, wall/furniture collision, normalized diagonal movement, two-player room transitions, and the existing combat/economy/persistence tests). Browser QA covers full-floor and desk views, room entry/exit, cursor-anchored wheel zoom from the overview into a corner room, arrow-key and edge-scroll panning, drag, minimap focus and drag, following, dungeon return, responsive layout, pinch zoom and mobile movement.
