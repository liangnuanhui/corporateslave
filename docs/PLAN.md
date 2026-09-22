# 牛马上班 处处战场 MVP

Approved scope: browser multiplayer, fictional company and characters, side-view pixel adventure. Target architecture supports multiple office/dungeon rooms; 200 CCU is a later load-test target, not an MVP performance claim.

## Implementation
1. Phaser browser app and Colyseus authoritative room server.
2. Account/password login, durable PostgreSQL data (PGlite locally, DATABASE_URL in deployment), unique sessions.
3. Shared fixed-step movement; office (24 players), cooperative dungeon (8 players), three monsters, completion reward.
4. Three roles with fixed 100 HP, three weapons, server-side purchases/equipping, persisted progress.
5. Browser QA with two identities; integration tests for room isolation, unauthorized access, combat, persistence and duplicate rewards.

## Visual system
Reference: design/concept.png. Dark #11151c page, #1a212b surfaces, cream #f5eedc foreground, muted #8e9ca8, mint #a6e8c2 accent. Slim header, spacious title, 16:9 game canvas plus mission rail, keyboard control strip. Native DOM controls and accessible dialogs; generated office and atlas artwork. Main copy: 牛马上班 处处战场; 公共办公室; 装备商店; 今天，也要准时下班。; 摸鱼科技; 下班计划; 熟悉办公室; 清理加班怪; 领取下班奖励; 进入副本.

## Bounds
No real-person targeting, office scans, PvP, chat, trading, offline AI, or production deployment. Offline characters persist without participating. Browser reload restores account and progress; short disconnect offers reconnection. No claim of multi-process or 200-player readiness before dedicated load testing.
