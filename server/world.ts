import { Room, type Client } from '@colyseus/core';
import { randomUUID } from 'node:crypto';
import { Database } from './database.js';
import { AREAS, corridor, exitAt, moveIn, type Area } from '../shared/world/index.js';
import { WORLD, move, idleInput, damageFor, inRange, type Actor, type Enemy, type Input, type Profile, type Snapshot, type Zone } from '../shared/game.js';

export const database = new Database();
export const activeAccounts = new Map<string, string>();
interface Player extends Actor { input: Input; profile: Profile; lastInput: number; attackAt: number; hurtAt: number; actionUntil: number; respawnAt: number; dropped: boolean; exitCooldown: number; noticeAt: number }
interface Monster extends Enemy { attackAt: number; actionUntil: number }

export class WorldRoom extends Room {
  private zone: Zone = 'office';
  private players = new Map<string, Player>();
  private enemies: Monster[] = [];
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
    if (this.zone === 'dungeon') this.enemies = [
      { id: 'scope', name: '临时需求怪', x: 740, y: WORLD.floor, hp: 70, maxHp: 70, face: -1, action: 'idle', attackAt: 0, actionUntil: 0 },
      { id: 'meeting', name: '无效会议怪', x: 970, y: WORLD.floor, hp: 90, maxHp: 90, face: -1, action: 'idle', attackAt: 0, actionUntil: 0 },
      { id: 'overtime', name: '加班大魔王', x: 1160, y: WORLD.floor, hp: 140, maxHp: 140, face: -1, action: 'idle', attackAt: 0, actionUntil: 0 },
    ];
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
      attackAt: -1000, hurtAt: -1000, actionUntil: 0, respawnAt: 0, dropped: false, exitCooldown: 0, noticeAt: -10000,
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
  private snapshot(): Snapshot {
    return {
      roomId: this.roomId, zone: this.zone, tick: this.tickNumber, status: this.status, wave: 1,
      players: [...this.players.values()].map(p => ({ id: p.id, name: p.name, role: p.role, x: p.x, y: p.y, vy: p.vy, face: p.face, hp: p.hp, weapon: p.weapon, action: p.action, ack: p.ack, area: p.area })),
      enemies: this.enemies.map(e => ({ id: e.id, name: e.name, x: e.x, y: e.y, hp: e.hp, maxHp: e.maxHp, face: e.face, action: e.action })),
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
