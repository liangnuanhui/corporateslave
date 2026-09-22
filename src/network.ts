import { Client, type Room } from '@colyseus/sdk';
import { type Profile, type Snapshot, type Zone, type Input } from '../shared/game';

export class Network extends EventTarget {
  profile: Profile | null = null;
  snapshot: Snapshot | null = null;
  room: Room | null = null;
  token = localStorage.getItem('niuma-token') || '';
  connected = false;
  busy = false;
  private client = new Client(window.location.origin, {
    urlBuilder: url => { if (import.meta.env.DEV && /^wss?:$/.test(url.protocol)) url.pathname = '/realtime' + url.pathname; return url.toString(); },
  });
  emit(type: string, detail?: unknown) { this.dispatchEvent(new CustomEvent(type, { detail })); }
  async restore() {
    if (!this.token) return false;
    const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) { this.token = ''; localStorage.removeItem('niuma-token'); return false; }
    this.profile = await res.json(); this.emit('profile'); return true;
  }
  async auth(action: string, data: Record<string, string>) {
    const res = await fetch(`/api/auth/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const result = await res.json(); if (!res.ok) throw new Error(result.error || '登录失败');
    this.profile = result.profile; this.token = result.token;
    localStorage.setItem('niuma-token', this.token); this.emit('profile');
  }
  async join(zone: Zone, roomId?: string) {
    if (this.busy) return;
    this.busy = true; this.emit('connection', '正在连接');
    try {
      const old = this.room; this.room = null; this.connected = false;
      if (old) await old.leave();
      this.snapshot = null;
      const reconnect = sessionStorage.getItem('niuma-reconnect');
      let room: Room | undefined;
      if (!old && reconnect && !roomId) { try { room = await this.client.reconnect(reconnect); } catch { sessionStorage.removeItem('niuma-reconnect'); } }
      room ??= roomId ? await this.client.joinById(roomId, { token: this.token, zone }) : await this.client.joinOrCreate('world', { token: this.token, zone });
      this.room = room;
      sessionStorage.setItem('niuma-reconnect', room.reconnectionToken);
      room.onMessage('snapshot', (snapshot: Snapshot) => { if (this.room !== room) return; this.snapshot = snapshot; this.emit('snapshot'); });
      room.onMessage('profile', (profile: Profile) => { this.profile = profile; this.emit('profile'); });
      room.onMessage('notice', (message: string) => this.emit('notice', message));
      room.onMessage('hit', data => this.emit('hit', data));
      room.onMessage('complete', data => this.emit('complete', data));
      room.onMessage('reward', data => this.emit('reward', data));
      room.onMessage('pong', time => this.emit('ping', Math.max(0, Date.now() - time)));
      room.onDrop(() => { if (this.room === room) { this.connected = false; this.emit('connection', '连接中断，正在重连'); } });
      room.onReconnect(() => { this.connected = true; sessionStorage.setItem('niuma-reconnect', room.reconnectionToken); this.emit('connection', '已连接'); });
      room.onLeave(() => { if (this.room === room) { this.connected = false; this.room = null; sessionStorage.removeItem('niuma-reconnect'); this.emit('connection', '连接已断开'); } });
      room.onError((_code, message) => this.emit('notice', message || '房间连接发生错误'));
      this.connected = true; this.emit('connection', '已连接'); room.send('sync');
    } finally { this.busy = false; }
  }
  input(input: Input) { if (this.connected) this.room?.send('input', input); }
  async logout() {
    const room = this.room; this.room = null;
    if (room) await room.leave();
    await fetch('/api/logout', { method: 'POST', headers: { Authorization: `Bearer ${this.token}` } });
    localStorage.removeItem('niuma-token'); sessionStorage.removeItem('niuma-reconnect');
    location.reload();
  }
}
