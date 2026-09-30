import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { Database } from './database.js';
import { AREAS, corridor, exitAt, canStandAt, moveIn, randomStandablePoint, spotAtDesk, type Area, type AreaId } from '../shared/world/index.js';
import { WORLD, move, idleInput, damageFor, inRange, meleeHits, NPC, NPC_LINES, nextDoing, sanitizeChat, bubbleMs, EMOTES, CHAT, type NpcDoing, type Actor, type Enemy, type Input, type Profile, type Snapshot, type Zone, type ChatEvent } from '../shared/game.js';

export const database = new Database();
export const activeAccounts = new Map<string, string>();
interface Player extends Actor { input: Input; profile: Profile; lastInput: number; attackAt: number; hurtAt: number; actionUntil: number; respawnAt: number; dropped: boolean; exitCooldown: number; noticeAt: number; chatAt: number }
interface Monster extends Enemy { attackAt: number; actionUntil: number; respawnAt: number }
/** 办公室那位同事的私有状态：只有服务器看得见，快照里只出 action / say。 */
interface Colleague extends Monster { goal?: { x: number; y: number }; doing: NpcDoing; after?: NpcDoing; nextAt: number; walkUntil: number; sayAt: number; sayUntil: number; aloneSince: number; vy: number }

export class WorldRoom extends Room {
  private zone: Zone = 'office';
  private players = new Map<string, Player>();
  private enemies: Monster[] = [];
  /** 办公室那位同事。他也在 enemies 里，这个引用只是为了拿到他的私有状态。 */
  private colleague?: Colleague;
  private tickNumber = 0;
  private elapsed = 0;
  private accumulator = 0;
  private status: 'playing' | 'complete' = 'playing';
  private runId = randomUUID();
  private contributed = new Set<string>();
  private awarded = new Set<string>();
  private pending = new Set<string>();
  maxMessagesPerSecond = 80;
  onCreate(options: { zone?: string }) {
    if (options.zone !== 'office' && options.zone !== 'dungeon') throw new Error('未知房间');
    this.zone = options.zone;
    this.maxClients = this.zone === 'office' ? 24 : 8;
    this.setMetadata({ zone: this.zone });
    // 副本的怪活在副本自己的坐标系里，area 对它们没有意义，填 corridor 占位。
    const dungeon = (id: string, name: string, x: number, hp: number): Monster =>
      ({ id, name, x, y: WORLD.floor, hp, maxHp: hp, face: -1, action: 'idle', attackAt: 0, actionUntil: 0, respawnAt: 0, area: 'corridor' });
    if (this.zone === 'dungeon') this.enemies = [
      dungeon('scope', '临时需求怪', 740, 70), dungeon('meeting', '无效会议怪', 970, 90), dungeon('overtime', '加班大魔王', 1160, 140),
    ];
    // 办公室里放一个会自己上班的同事：血量、所在房间、具体位置每次都重新抽。
    else {
      this.colleague = this.placeColleague({
        id: NPC.id, name: NPC.name, x: 0, y: 0, vy: 0, hp: 0, maxHp: 0, face: -1, action: 'idle',
        attackAt: 0, actionUntil: 0, respawnAt: 0, area: 'corridor',
        doing: 'idle', nextAt: 0, walkUntil: 0, sayAt: 0, sayUntil: 0, aloneSince: 0,
      });
      this.enemies = [this.colleague];
    }
    this.onMessage('input', (client, data) => {
      const p = this.players.get(client.sessionId);
      if (!p || !data || !Number.isSafeInteger(data.seq) || data.seq < 0 || data.seq <= p.input.seq) return;
      p.input = { left: data.left === true, right: data.right === true, up: data.up === true, down: data.down === true, jump: data.jump === true, attack: data.attack === true, seq: data.seq };
      p.lastInput = this.elapsed;
    });
    this.onMessage('ping', (client, time) => { if (typeof time === 'number') client.send('pong', time); });
    this.onMessage('shop', (client, message) => this.shop(client, message));
    this.onMessage('claim', client => this.claim(client));
    this.onMessage('sync', client => client.send('snapshot', this.snapshot()));
    this.onMessage('chat', (client, data: unknown) => {
      const p = this.players.get(client.sessionId);
      if (!p || p.dropped) return;
      // 限流在最前：畸形消息也走这条路，否则刷畸形包能绕开冷却去压 CPU。
      // 回一条「说太快了」反而给刷屏者一个可以刷的东西，所以静默丢弃。
      if (this.elapsed - p.chatAt < CHAT.cooldownMs) return;
      const body = (data ?? {}) as { text?: unknown; emote?: unknown };
      // emote 优先：同时给 text 和 emote 时只认 emote，永远只广播一条。
      if (typeof body.emote === 'string') {
        const emote = EMOTES.find(e => e.id === body.emote);
        if (!emote) return;
        p.chatAt = this.elapsed;
        this.say(p.id, emote.text, 'emote');
        return;
      }
      const rawText = typeof body.text === 'string' ? body.text : undefined;
      const slash = rawText !== undefined ? EMOTES.find(e => e.slash === rawText.trim()) : undefined;
      if (slash) { p.chatAt = this.elapsed; this.say(p.id, slash.text, 'emote'); return; }
      // 斜杠命令在服务器解析，不在客户端拆——解析器因此只有一个。
      if (rawText !== undefined && rawText.trim().startsWith('/')) {
        p.chatAt = this.elapsed;
        this.clientOf(client.sessionId)?.send('notice', '没有这个表情。可用：' + EMOTES.map(e => e.slash).join(' '));
        return;
      }
      const text = sanitizeChat(body.text);
      if (!text) return;
      p.chatAt = this.elapsed;
      this.say(p.id, text, 'say');
    });
    this.setSimulationInterval(delta => {
      this.accumulator += Math.min(delta, 150);
      while (this.accumulator >= 1000 / 30) { this.step(); this.accumulator -= 1000 / 30; }
    }, 1000 / 30);
  }
  async onAuth(_client: Client, options: { token?: string }) {
    const profile = await database.authenticate(options.token || '');
    if (!profile) throw new Error('登录已过期，请重新登录');
    return profile;
  }
  /** New arrivals are scattered across every open area, so the floor never looks like a queue at
   *  reception. To spawn only inside rooms, clear corridor.spawnPoints — no code change needed.
   *  The anti-overlap rule (favour the candidate furthest from anyone already in that area) only
   *  narrows things down to the equally-good set — an empty floor makes every spawn point equally
   *  good (score Infinity), so pick uniformly at random among ties rather than always the first
   *  one in iteration order. Distances are floats, so "tied" is `within EPS`, not `===`. */
  private pickSpawn() {
    const candidates = Object.values(AREAS).flatMap(area => area.spawnPoints.map(point => ({ area: area.id, ...point })));
    const taken = [...this.players.values()];
    const scored = candidates.map(c => {
      const near = taken.filter(p => p.area === c.area);
      return { c, score: near.length ? Math.min(...near.map(p => Math.hypot(p.x - c.x, p.y - c.y))) : Infinity };
    });
    // Math.max of nothing is -Infinity and would crash the join below; the comment above invites
    // emptying spawnPoints, so fail into the corridor's origin rather than into onJoin.
    if (!scored.length) return { area: 'corridor' as const, x: corridor.bounds.x + corridor.radius, y: corridor.bounds.y + corridor.radius };
    const bestScore = Math.max(...scored.map(s => s.score));
    const EPS = 1; // px; guards against float noise without conflating genuinely different distances
    const tied = scored.filter(s => bestScore === Infinity ? s.score === Infinity : bestScore - s.score < EPS);
    return tied[Math.floor(Math.random() * tied.length)].c;
  }
  onJoin(client: Client, _options: unknown, profile: Profile) {
    if (activeAccounts.has(profile.id)) throw new Error('角色已在另一个窗口上线；断线后请稍等 12 秒');
    if (activeAccounts.size >= 200) throw new Error('当前世界已满，请稍后再试');
    activeAccounts.set(profile.id, client.sessionId);
    // Dungeon keeps its own fixed spawn (with the old stacking offset) unchanged; only office scatters arrivals.
    const spawn = this.zone === 'office' ? this.pickSpawn() : { area: 'corridor' as const, x: 160 + this.players.size * 45, y: WORLD.floor };
    this.players.set(client.sessionId, {
      id: profile.id, name: profile.name, role: profile.role, profile,
      x: spawn.x, y: spawn.y, vy: 0, face: 1, hp: 100,
      weapon: profile.weapon, action: 'idle', ack: 0, area: spawn.area, input: idleInput(), lastInput: 0,
      attackAt: -1000, hurtAt: -1000, actionUntil: 0, respawnAt: 0, dropped: false, exitCooldown: 0, noticeAt: -10000, chatAt: -10000,
    });
    client.send('profile', profile);
    this.broadcast('snapshot', this.snapshot());
  }
  async onDrop(client: Client) {
    const p = this.players.get(client.sessionId); if (!p) return;
    p.input = idleInput(); p.dropped = true;
    try { await this.allowReconnection(client, 12); } catch { /* onLeave releases the actor */ }
  }
  onReconnect(client: Client) {
    const p = this.players.get(client.sessionId); if (p) { p.dropped = false; client.send('profile', p.profile); }
    client.send('snapshot', this.snapshot());
  }
  onLeave(client: Client) {
    const p = this.players.get(client.sessionId);
    if (p && activeAccounts.get(p.id) === client.sessionId) activeAccounts.delete(p.id);
    this.players.delete(client.sessionId);
    this.broadcast('snapshot', this.snapshot());
  }
  onDispose() {
    for (const [sid, p] of this.players) if (activeAccounts.get(p.id) === sid) activeAccounts.delete(p.id);
  }
  private step() {
    this.tickNumber++; this.elapsed += 1000 / 30;
    for (const [sid, p] of this.players) {
      if (p.hp <= 0) {
        if (this.elapsed >= p.respawnAt) {
          const spawn = this.zone === 'office' ? AREAS[p.area].spawnPoints[0] : { x: 160, y: WORLD.floor };
          p.hp = 100; p.x = spawn.x; p.y = spawn.y; p.vy = 0; p.hurtAt = this.elapsed;
        }
        else continue;
      }
      const input = this.elapsed - p.lastInput > 350 || p.dropped ? idleInput() : p.input;
      const area = this.zone === 'office' ? AREAS[p.area] : undefined;
      if (area) moveIn(area, p, input); else move(p, input);
      if (area && this.elapsed >= p.exitCooldown) this.tryExit(sid, p, area);
      p.ack = p.input.seq;
      // Jump is an edge-triggered command; holding it cannot cause repeated jumps.
      p.input.jump = false;
      if (this.elapsed > p.actionUntil) p.action = input.left !== input.right || (this.zone === 'office' && input.up !== input.down) ? 'walk' : 'idle';
      if (this.zone === 'dungeon' && p.y < WORLD.floor - 4 && p.action !== 'attack') p.action = 'jump';
      if (input.attack && this.elapsed - p.attackAt >= 550) {
        p.attackAt = this.elapsed; p.action = 'attack'; p.actionUntil = this.elapsed + 230;
        // 办公室：只打得到同一个房间里的目标，范围是俯视的一个半径（见 meleeHits / inMelee）。
        if (area) for (const npc of meleeHits(p, this.enemies)) {
          const damage = damageFor(p.role, p.weapon);
          npc.hp = Math.max(0, npc.hp - damage);
          // 击退必须过碰撞：否则一路把人推进墙里或推出房间。
          // 6px 而不是 12：站着不动连打时，12px 大约四下就把他推出 64px 的攻击半径，
          // 于是后面每一下都落空而屏幕上毫无反馈——看起来像攻击坏了。6px 够看出他在踉跄，
          // 又不至于让「站着打完一管血」变成不可能。
          const knocked = npc.x + p.face * 6;
          if (canStandAt(area, knocked, npc.y)) npc.x = knocked;
          npc.action = npc.hp ? 'hurt' : 'dead'; npc.actionUntil = this.elapsed + (npc.hp ? NPC.hurtPauseMs : 180);
          this.broadcast('hit', { id: npc.id, x: npc.x, y: npc.y - 34, damage });
          if (!npc.hp) {
            npc.respawnAt = this.elapsed + NPC.respawnMs;
            this.broadcast('notice', `${npc.name} 躺平了。他会换个工位继续上班。`);
          }
        }
        if (this.zone === 'dungeon' && this.status === 'playing') {
          for (const enemy of this.enemies) if (enemy.hp > 0 && inRange(p, enemy)) {
            const damage = damageFor(p.role, p.weapon);
            enemy.hp = Math.max(0, enemy.hp - damage); enemy.x = Math.max(40, Math.min(WORLD.width - 40, enemy.x + p.face * 15));
            enemy.action = enemy.hp ? 'hurt' : 'dead'; enemy.actionUntil = this.elapsed + 180;
            this.contributed.add(p.id);
            this.broadcast('hit', { id: enemy.id, x: enemy.x, y: enemy.y - 65, damage });
          }
        }
      }
    }
    if (this.colleague) {
      const npc = this.colleague;
      if (npc.hp <= 0) { if (this.elapsed >= npc.respawnAt) this.placeColleague(npc); }
      else this.tickColleague(npc);
    }
    if (this.zone === 'dungeon' && this.status === 'playing') {
      for (const enemy of this.enemies) {
        if (enemy.hp <= 0) continue;
        const target = [...this.players.values()].filter(p => p.hp > 0 && !p.dropped).sort((a, b) => Math.abs(a.x - enemy.x) - Math.abs(b.x - enemy.x))[0];
        if (!target) continue;
        const dx = target.x - enemy.x; enemy.face = Math.sign(dx) || enemy.face;
        if (this.elapsed > enemy.actionUntil) {
          enemy.action = Math.abs(dx) > 45 ? 'walk' : 'idle';
          if (Math.abs(dx) > 45) enemy.x += enemy.face * (enemy.id === 'overtime' ? 44 : 58) * WORLD.tick;
        }
        if (Math.abs(dx) < 58 && Math.abs(target.y - enemy.y) < 60 && this.elapsed - enemy.attackAt > 1000 && this.elapsed - target.hurtAt > 650) {
          enemy.attackAt = this.elapsed; enemy.action = 'attack'; enemy.actionUntil = this.elapsed + 240;
          target.hp = Math.max(0, target.hp - 10); target.hurtAt = this.elapsed;
          target.action = 'hurt'; target.actionUntil = this.elapsed + 220;
          if (!target.hp) { target.action = 'dead'; target.respawnAt = this.elapsed + 3000; }
          this.broadcast('hit', { id: target.id, x: target.x, y: target.y - 70, damage: 10 });
        }
      }
      if (this.enemies.every(e => e.hp === 0)) { this.status = 'complete'; void this.lock(); this.broadcast('complete', { reward: 80 }); }
    }
    if (this.tickNumber % 2 === 0) this.broadcast('snapshot', this.snapshot());
  }
  private clientOf(sessionId: string) { return this.clients.find(c => c.sessionId === sessionId); }
  /** 一句话是事件不是状态：只过一次网，客户端自己管过期。快照里不留任何痕迹——
   *  快照每 2 tick 全量重发，把话放进去就等于每秒重复它 15 次。 */
  private say(id: string, text: string, kind: ChatEvent['kind']) {
    this.broadcast('chat', { id, text, kind, ms: bubbleMs(text) } satisfies ChatEvent);
  }
  /** The server switches area immediately; the client's fade is pure presentation. */
  private tryExit(sessionId: string, p: Player, area: Area) {
    const exit = exitAt(area, p.x, p.y);
    if (!exit) return;
    if (exit.locked) {
      // Rate-limited: standing on a locked threshold would otherwise fire ~30 notices/second.
      // The client lookup stays inside the throttle so camping a threshold costs one scan per
      // notice rather than one per tick.
      if (this.elapsed - p.noticeAt > 2500) { p.noticeAt = this.elapsed; this.clientOf(sessionId)?.send('notice', `${exit.label}还在装修中，敬请期待`); }
      return;
    }
    const client = this.clientOf(sessionId);
    p.area = exit.to; p.x = exit.at.x; p.y = exit.at.y; p.vy = 0;
    p.exitCooldown = this.elapsed + 400;
    client?.send('transition', { to: exit.to, name: AREAS[exit.to].name });
  }
  /** 重新抽一次：哪个房间、房间里哪个位置、多少血。开房、被打倒后、以及没人看见时换房间各调一次。 */
  private placeColleague(npc: Colleague, keepHp = false): Colleague {
    const ids = Object.keys(AREAS) as AreaId[];
    const area = AREAS[ids[Math.floor(Math.random() * ids.length)]];
    const spot = randomStandablePoint(area);
    npc.area = area.id; npc.x = spot.x; npc.y = spot.y; npc.face = Math.random() < .5 ? -1 : 1;
    if (!keepHp) {
      const steps = Math.floor((NPC.hpMax - NPC.hpMin) / NPC.hpStep) + 1;
      npc.maxHp = NPC.hpMin + Math.floor(Math.random() * steps) * NPC.hpStep;
      npc.hp = npc.maxHp;
    }
    npc.action = 'idle'; npc.doing = 'idle'; npc.goal = undefined; npc.after = undefined;
    npc.actionUntil = 0; npc.respawnAt = 0; npc.nextAt = 0; npc.walkUntil = 0;
    npc.say = undefined; npc.sayUntil = 0; npc.sayAt = 0; npc.aloneSince = this.elapsed;
    return npc;
  }

  /** 他自己上班的一拍：走动 / 回工位 / 玩手机，外加时不时说句废话。
   *  挨打时整段跳过——边挨打边散步看着像没受伤，而且会把攻击者甩开。 */
  private tickColleague(npc: Colleague) {
    const area = AREAS[npc.area];
    const watched = [...this.players.values()].some(p => !p.dropped && p.area === npc.area);
    if (watched) npc.aloneSince = this.elapsed;
    // 没人在场时才换房间：这样「他又跑到别的房间去了」永远不会被谁看成瞬移。
    else if (this.elapsed - npc.aloneSince > NPC.relocateAfterMs) { this.placeColleague(npc, true); return; }

    if (this.elapsed < npc.actionUntil) return;          // 受击僵直
    if (npc.action === 'hurt') npc.action = npc.doing === 'walk' ? 'idle' : npc.doing;

    if (this.elapsed >= npc.sayAt) {
      npc.say = NPC_LINES[Math.floor(Math.random() * NPC_LINES.length)];
      npc.sayUntil = this.elapsed + NPC.sayForMs;
      npc.sayAt = this.elapsed + NPC.sayEveryMinMs + Math.random() * (NPC.sayEveryMaxMs - NPC.sayEveryMinMs);
    }
    if (npc.say && this.elapsed >= npc.sayUntil) npc.say = undefined;

    if (npc.doing === 'walk' && npc.goal) {
      const dx = npc.goal.x - npc.x, dy = npc.goal.y - npc.y;
      const arrived = Math.hypot(dx, dy) < 12;
      if (!arrived && this.elapsed <= npc.walkUntil) {
        const before = { x: npc.x, y: npc.y };
        moveIn(area, npc, { left: dx < -4, right: dx > 4, up: dy < -4, down: dy > 4 }, 1 / 30, NPC.speed);
        npc.action = 'walk';
        // 目的地是随机抽的，两点之间有没有家具抽不到——顶住不动就立刻作废这一程，
        // 而不是贴着柜子边抖到超时。
        if (Math.hypot(npc.x - before.x, npc.y - before.y) < .4) npc.walkUntil = 0;
        return;
      }
      // 到了（或者走不动了）：摆出这一程本来要摆的姿势，走不到就随便站站。
      npc.goal = undefined;
      npc.doing = arrived && npc.after ? npc.after : 'idle';
      npc.after = undefined;
      npc.action = npc.doing;
      npc.nextAt = this.elapsed + NPC.restMinMs + Math.random() * (NPC.restMaxMs - NPC.restMinMs);
      return;
    }
    if (this.elapsed < npc.nextAt) return;

    const doing = nextDoing();
    // 回工位得真的有工位：走廊那 19 张桌子全画在封闭房间的方框里，一张都够不到（见 spotAtDesk），
    // 抽到「回工位」而没有工位时，改成玩手机，而不是把人放进墙里假装那是工位。
    const desk = doing === 'desk' ? spotAtDesk(area) : undefined;
    const goal = doing === 'walk' ? randomStandablePoint(area) : desk;
    if (goal) {
      npc.goal = goal; npc.doing = 'walk'; npc.action = 'walk';
      npc.after = doing === 'walk' ? 'idle' : 'desk';
      npc.face = goal.x < npc.x ? -1 : 1;
      npc.walkUntil = this.elapsed + NPC.walkTimeoutMs;
      return;
    }
    npc.doing = 'phone'; npc.action = 'phone';
    npc.nextAt = this.elapsed + NPC.restMinMs + Math.random() * (NPC.restMaxMs - NPC.restMinMs);
  }

  private snapshot(): Snapshot {
    return {
      roomId: this.roomId, zone: this.zone, tick: this.tickNumber, status: this.status, wave: 1,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, y: p.y, vy: p.vy, face: p.face, hp: p.hp, weapon: p.weapon, action: p.action, ack: p.ack, area: p.area })),
      enemies: this.enemies.map(e => ({ id: e.id, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, face: e.face, action: e.action, area: e.area, say: e.say })),
    };
  }
  private async shop(client: Client, message: { weapon?: string }) {
    const p = this.players.get(client.sessionId); if (!p || this.pending.has(p.id)) return;
    if (this.zone !== 'office') { client.send('notice', '请返回公共办公室购买装备'); return; }
    if (p.area !== 'storage') { client.send('notice', '请到储物间的装备台前购买'); return; }
    this.pending.add(p.id);
    try { const profile = await database.purchase(p.id, String(message?.weapon)); p.profile = profile; p.weapon = profile.weapon; client.send('profile', profile); client.send('notice', '装备已更新，准备出发！'); }
    catch (error) { client.send('notice', (error as Error).message); }
    finally { this.pending.delete(p.id); }
  }
  private async claim(client: Client) {
    const p = this.players.get(client.sessionId); if (!p || this.pending.has(p.id)) return;
    if (this.status !== 'complete' || !this.contributed.has(p.id)) { client.send('notice', '参与击败怪物并完成副本后，可以领取奖励'); return; }
    this.pending.add(p.id);
    try {
      const { profile, awarded } = await database.reward(p.id, this.runId);
      p.profile = profile; this.awarded.add(p.id); client.send('profile', profile);
      client.send('reward', { awarded, coins: 80 });
    } catch { client.send('notice', '保存奖励失败，请重试。不会重复发放。'); }
    finally { this.pending.delete(p.id); }
  }
}
