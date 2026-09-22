import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { resolve } from 'node:path';
import express from 'express';
import { randomBytes } from 'node:crypto';
import { WorldRoom, database, activeAccounts } from './world.js';

await database.init();
const transport = new WebSocketTransport();
const app = transport.getExpressApp();
app.disable('x-powered-by');
app.use(express.json({ limit: '8kb' }));
app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); next(); });
const attempts = new Map<string, { count: number; reset: number }>();
const cleanup = setInterval(() => { for (const [key, entry] of attempts) if (entry.reset < Date.now()) attempts.delete(key); }, 60_000); cleanup.unref();
app.use('/api/auth', (req, res, next) => {
  const key = req.ip || 'unknown'; const now = Date.now(); let entry = attempts.get(key);
  if (!entry || entry.reset < now) { entry = { count: 0, reset: now + 60_000 }; attempts.set(key, entry); }
  if (++entry.count > 15) { res.status(429).json({ error: '操作太快了，请一分钟后再试' }); return; }
  next();
});
app.post('/api/auth/:action', async (req, res) => {
  try {
    if (req.params.action === 'guest') {
      const suffix = randomBytes(4).toString('hex');
      res.json(await database.register(`guest_${suffix}`, randomBytes(24).toString('hex'), `摸鱼员${suffix.slice(0, 3)}`, 'rookie')); return;
    }
    const { username, password, name, role } = req.body ?? {};
    if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128 || username.length > 24) throw new Error('请填写有效账号和密码');
    if (req.params.action === 'register') {
      if (typeof name !== 'string' || typeof role !== 'string') throw new Error('请填写昵称并选择职级');
      res.json(await database.register(username, password, name, role));
    } else if (req.params.action === 'login') res.json(await database.login(username, password));
    else res.status(404).json({ error: '接口不存在' });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
app.get('/api/me', async (req, res) => {
  const profile = await database.authenticate((req.headers.authorization || '').replace(/^Bearer /, ''));
  if (!profile) { res.status(401).json({ error: '请重新登录' }); return; } res.json(profile);
});
app.post('/api/logout', async (req, res) => { await database.logout((req.headers.authorization || '').replace(/^Bearer /, '')); res.json({ ok: true }); });
app.get('/api/health', (_req, res) => res.json({ ok: true, online: activeAccounts.size }));
const server = new Server({ transport, greet: false });
server.define('world', WorldRoom).filterBy(['zone']);
if (process.env.NODE_ENV === 'production') app.use(express.static(resolve('dist')));
const port = Number(process.env.PORT || 2567);
await server.listen(port, '0.0.0.0');
console.log(`牛马上班 处处战场服务已启动 http://localhost:${port} · ${process.env.DATABASE_URL ? 'PostgreSQL' : 'PGlite 本地持久化'}`);
let shuttingDown = false;
async function shutdown() { if (shuttingDown) return; shuttingDown = true; await server.gracefullyShutdown(false); await database.close(); process.exit(0); }
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
