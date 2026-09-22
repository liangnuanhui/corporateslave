import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { ROLES, WEAPONS, type Profile, type RoleId, type WeaponId } from '../shared/game.js';

const scrypt = promisify(scryptCallback);
type Queryable = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> };
export class Database {
  private db!: Queryable;
  private closeDb!: () => Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  async init(path = process.env.DATA_DIR || '.data/postgres') {
    if (process.env.DATABASE_URL) {
      const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
      this.db = pool; this.closeDb = () => pool.end();
    } else {
      if (path !== 'memory://') await mkdir(path, { recursive: true });
      const db = new PGlite(path); await db.waitReady;
      this.db = db; this.closeDb = () => db.close();
    }
    await this.db.query(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password TEXT NOT NULL, salt TEXT NOT NULL,
      profile JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at TIMESTAMPTZ NOT NULL)`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS rewards (
      account_id TEXT NOT NULL REFERENCES accounts(id), run_id TEXT NOT NULL, PRIMARY KEY(account_id, run_id))`);
  }
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn); this.queue = next.catch(() => {}); return next;
  }
  async register(username: string, password: string, name: string, role: string): Promise<{ token: string; profile: Profile }> {
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) throw new Error('账号需为 3—24 位字母、数字或下划线');
    if (password.length < 8 || password.length > 128) throw new Error('密码需为 8—128 位');
    if (!ROLES.some(r => r.id === role)) throw new Error('请选择一个职级');
    if (!name.trim() || [...name.trim()].length > 12) throw new Error('游戏昵称需为 1—12 个字');
    const salt = randomBytes(16).toString('hex');
    const hash = (await scrypt(password, salt, 64) as Buffer).toString('hex');
    return this.exclusive(async () => {
      const profile: Profile = { id: randomUUID(), username: username.toLowerCase(), name: name.trim(), role: role as RoleId, coins: 30, weapon: 'foam', owned: ['foam'], clears: 0 };
      try { await this.db.query('INSERT INTO accounts (id, username, password, salt, profile) VALUES ($1,$2,$3,$4,$5)', [profile.id, profile.username, hash, salt, JSON.stringify(profile)]); }
      catch (error: any) { if (error.code === '23505') throw new Error('这个账号已存在，请直接登录'); throw error; }
      return { token: await this.issue(profile.id), profile };
    });
  }
  async login(username: string, password: string) {
    const account = await this.exclusive(async () => (await this.db.query('SELECT * FROM accounts WHERE username=$1', [username.toLowerCase()])).rows[0]);
    const hash = await scrypt(password, account?.salt || 'missing-account-salt', 64) as Buffer;
    if (!account || !timingSafeEqual(Buffer.from(account.password, 'hex'), hash)) throw new Error('账号或密码不正确');
    return this.exclusive(async () => ({ token: await this.issue(account.id), profile: account.profile as Profile }));
  }
  private async issue(id: string) {
    const token = randomBytes(32).toString('hex');
    await this.db.query('DELETE FROM sessions WHERE expires_at < now()');
    await this.db.query(`INSERT INTO sessions VALUES ($1,$2,now()+interval '30 days')`, [this.hashToken(token), id]);
    return token;
  }
  private hashToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
  async authenticate(token: string): Promise<Profile | null> {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    return this.exclusive(async () => (await this.db.query(`SELECT a.profile FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now()`, [this.hashToken(token)])).rows[0]?.profile ?? null);
  }
  async logout(token: string) { await this.exclusive(() => this.db.query('DELETE FROM sessions WHERE token_hash=$1', [this.hashToken(token)])); }
  async profile(id: string): Promise<Profile> { return this.exclusive(async () => (await this.db.query('SELECT profile FROM accounts WHERE id=$1', [id])).rows[0].profile); }
  async purchase(id: string, weaponId: string): Promise<Profile> {
    const weapon = WEAPONS.find(w => w.id === weaponId); if (!weapon) throw new Error('装备不存在');
    return this.transaction(async () => {
      const p = (await this.db.query('SELECT profile FROM accounts WHERE id=$1 FOR UPDATE', [id])).rows[0].profile as Profile;
      if (!p.owned.includes(weapon.id)) {
        if (p.coins < weapon.price) throw new Error('积分不足，先去副本完成挑战吧');
        p.coins -= weapon.price; p.owned.push(weapon.id);
      }
      p.weapon = weapon.id; await this.save(p); return p;
    });
  }
  async reward(id: string, runId: string): Promise<{ profile: Profile; awarded: boolean }> {
    return this.transaction(async () => {
      const result = await this.db.query('INSERT INTO rewards VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING run_id', [id, runId]);
      const p = (await this.db.query('SELECT profile FROM accounts WHERE id=$1 FOR UPDATE', [id])).rows[0].profile as Profile;
      const awarded = result.rows.length > 0;
      if (awarded) { p.coins += 80; p.clears += 1; await this.save(p); }
      return { profile: p, awarded };
    });
  }
  private save(p: Profile) { return this.db.query('UPDATE accounts SET profile=$1 WHERE id=$2', [JSON.stringify(p), p.id]); }
  private transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => { await this.db.query('BEGIN'); try { const result = await fn(); await this.db.query('COMMIT'); return result; } catch (error) { await this.db.query('ROLLBACK'); throw error; } });
  }
  async close() { await this.queue; await this.closeDb(); }
}
