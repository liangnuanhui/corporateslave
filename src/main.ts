import './style.css';
import { Network } from './network';
import { createGame } from './game';
import { roomAt, AREAS } from '../shared/world';
import { mapPanelMarkup, bindMapPanel } from './map-panel';
import { showSiteMap } from './site-map';
import { ROLES, WEAPONS, damageFor, ORG_NAME } from '../shared/game';

const paths: Record<string,string> = {
  coffee:'M4 8h13v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8Zm13 1h2a3 3 0 1 1 0 6h-2M7 2v3m5-3v3M2 22h18',
  office:'M3 21V7h18v14M8 7V3h8v4M8 11v2m8-2v2M8 17v4m8-4v4M1 21h22',
  bag:'M4 8h16l1 13H3L4 8Zm4 0V6a4 4 0 0 1 8 0v2',
  arrow:'m9 5 7 7-7 7',
  check:'m5 12 4 4L19 6',
  sound:'M4 9h4l5-4v14l-5-4H4V9Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
  share:'M9 15 15 9M8 17l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
  close:'m6 6 12 12M6 18 18 6',
};
const icon = (name: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.arrow}"/></svg>`;
const escape = (s: string) => s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <main>
    <div class="game-layout"><section class="stage" aria-label="像素办公室">
      <div id="game"></div>
      ${mapPanelMarkup}
      <div class="hud"><div class="portrait"></div><div class="hud-details"><div class="health-row"><span class="heart">♥</span><div class="health-track"><div id="health-fill"></div><strong id="health-label">100 / 100</strong></div></div><div class="coins"><span class="coin-icon">₵</span><strong id="coins">—</strong><span>下班积分</span></div></div></div>
      <div class="zone-label" id="zone-label">${ORG_NAME} · 1F · 办公室全景</div>
      <div class="stage-message" id="stage-message" hidden></div>
      <div class="stage-bottom"><span id="stage-hint">WASD 或方向键移动 · 走门进出 · 滚轮以光标为中心缩放 · 拖拽 / 鼠标推到边缘移动视角</span><div class="stage-actions"><button id="nav-shop" aria-label="装备商店">${icon('bag')}<span>装备商店</span></button><button id="invite" aria-label="复制邀请链接">${icon('share')}<span>邀请同事</span></button><button id="sound" aria-label="开启音效">${icon('sound')}<span>音效关</span></button></div></div>
    </section></div>
    <section class="control-strip" aria-label="操作说明"><button id="profile-button" class="identity"><div class="portrait small"></div><span><strong id="player-name">你的工位，已预留</strong><small id="player-role">创建一个虚构角色，开始冒险</small></span></button><div class="keyboard-controls"><span><kbd class="wide">WASD</kbd>/<kbd>方向键</kbd>移动</span><span>滚轮缩放 · 拖拽移视角</span><span><kbd>E</kbd>互动</span></div><button id="connection" class="connection"><i></i><span>尚未连接</span><small id="ping">—</small></button><span class="control-note">生死看淡，不服就干</span></section>
    <div class="touch-controls" aria-label="触屏操作"><button data-touch="left" aria-label="向左移动">←</button><button data-touch="right" aria-label="向右移动">→</button><button data-touch="up" aria-label="向上移动">↑</button><button data-touch="down" aria-label="向下移动">↓</button><button data-touch="jump" id="touch-jump" hidden>跳跃</button><button data-touch="attack">攻击</button><button id="touch-interact">互动</button></div>
    <footer><span>本故事纯属虚构，如有雷同，应该是人生。</span><span>多人体验版 <span class="footer-dot">·</span> MVP 0.1</span></footer>
  </main>
  <dialog id="auth-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('coffee')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2 id="auth-title">欢迎加入摸鱼科技</h2><p class="dialog-subtitle">名字可以随意，下班必须准时。</p><form id="auth-form"><div id="register-fields"><label>游戏昵称<input name="name" placeholder="例如：咖啡不加班" maxlength="12" value="摸鱼小王" autocomplete="nickname"/></label><fieldset><legend>选择你的职级</legend><div class="role-options">${ROLES.map((r,i)=>`<label class="role-option"><input type="radio" name="role" value="${r.id}" ${i===0?'checked':''}/><span><strong>${r.name}</strong><small>攻击 ${r.attack} · 生命 100</small></span></label>`).join('')}</div></fieldset></div><label>账号<input name="username" placeholder="3—24 位字母、数字或下划线" pattern="[a-zA-Z0-9_]{3,24}" required autocomplete="username"/></label><label>密码<input name="password" type="password" placeholder="至少 8 位" minlength="8" maxlength="128" required autocomplete="new-password"/></label><p id="auth-error" class="error" role="alert"></p><button type="submit" id="auth-submit" class="button primary full">领取工牌，开始冒险${icon('arrow')}</button></form><div class="auth-bottom"><button id="auth-toggle" class="text-button">已有账号？直接登录</button><button id="guest" class="text-button">快速试玩</button></div><p class="fine-print">账号支持跨设备恢复。快速试玩身份仅保留在此浏览器。</p></dialog>
  <dialog id="shop-dialog" class="shop-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('bag')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2>好装备，早下班。</h2><p class="dialog-subtitle">积分换装备，给下一次挑战加点底气。</p><div class="shop-balance">可用积分 <strong id="shop-coins">0</strong><span>₵</span></div><div id="shop-items"></div><p class="fine-print">装备购买与切换会立即保存。请到储物间的装备台前购买。</p></dialog>
  <dialog id="profile-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('office')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2>我的工牌</h2><div id="profile-details"></div><button id="logout" class="button secondary full">退出登录</button></dialog>
  <div id="toast" role="status" aria-live="polite"></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const network = new Network();
const authDialog = $<HTMLDialogElement>('auth-dialog');
const shopDialog = $<HTMLDialogElement>('shop-dialog');
const profileDialog = $<HTMLDialogElement>('profile-dialog');
let loginMode = false, toastTimer = 0;
let soundEnabled = false; let audio: AudioContext | undefined;
const { scene } = createGame(network, () => !!document.querySelector('dialog[open]'), interact);
bindMapPanel(scene, network);
$('touch-interact').onclick = interact;
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = window.setTimeout(()=>$('toast').classList.remove('visible'),4000); }
function show(dialog: HTMLDialogElement) { scene.resetInput(); dialog.showModal(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '连接失败，请稍后重试'; }
// 副本已下线，办公室是唯一的去处；server 仍支持 zone，但界面不再提供入口，
// ?zone=dungeon 这类旧链接会被当成普通的办公室邀请链接处理。
async function join(roomId?: string) {
  try { await network.join('office', roomId); }
  catch (error) { toast(errorMessage(error)); $('connection').querySelector('span')!.textContent = '点击重试'; }
}
function initialJoin() {
  return join(new URLSearchParams(location.search).get('room') || undefined);
}
// The very first thing anyone sees, on every path in: a returning session, a fresh register, and
// 快速试玩 all look identical — the national map, then the floor overview, then the push into
// wherever the server actually spawned us. showSiteMap() only shows once per page load on its own.
// One skip flag spans the whole sequence (map -> the initialJoin() network round trip -> the
// floor hold): a press during the map still ends the map via its own listener, but it also marks
// `skipped` so playOpening() — entered only after the join round trip — knows to end immediately
// instead of waiting out its own 1.5s, rather than requiring a second press to get past the join gap.
async function openingSequence() {
  let skipped = false;
  const skip = () => { skipped = true; };
  window.addEventListener('keydown', skip); window.addEventListener('pointerdown', skip);
  try { await showSiteMap(); await initialJoin(); await scene.playOpening(() => skipped); }
  finally { window.removeEventListener('keydown', skip); window.removeEventListener('pointerdown', skip); }
}
function interact() {
  if (!network.profile) { show(authDialog); return; }
  const actor = network.snapshot?.players.find(p=>p.id===network.profile!.id);
  if (actor && actor.area === 'storage') openShop();
  else toast('沿走廊从门口进出房间；走到储物间的装备台前按 E，可以挑装备。');
}
function openShop() {
  if (!network.profile) { show(authDialog); return; }
  const actor = network.snapshot?.players.find(p=>p.id===network.profile!.id);
  if (!actor || actor.area !== 'storage') { toast('请先前往储物间的装备台前，再打开商店'); return; }
  renderShop(); show(shopDialog);
}
function renderShop() {
  const p = network.profile; if (!p) return;
  $('shop-coins').textContent = String(p.coins);
  $('shop-items').innerHTML = WEAPONS.map(w=>{
    const owned = p.owned.includes(w.id), equipped=p.weapon===w.id, afford=owned||p.coins>=w.price;
    return `<article class="shop-item"><div class="weapon-art weapon-${w.id}"></div><div class="weapon-info"><h3>${w.name}</h3><p>${w.description}</p><span>攻击 +${w.damage} <span class="muted">/ 总攻击 ${damageFor(p.role,w.id)}</span></span></div><button class="button ${equipped?'equipped':'secondary'}" data-weapon="${w.id}" ${equipped||!afford?'disabled':''}>${equipped?'已装备':owned?'装备':`${w.price} 积分`}</button></article>`;
  }).join('');
  $('shop-items').querySelectorAll<HTMLButtonElement>('[data-weapon]').forEach(button=>button.onclick=()=>{ button.disabled=true; network.room?.send('shop',{weapon:button.dataset.weapon}); });
}
function renderProfile() {
  const p = network.profile; if (!p) return;
  $('coins').textContent = String(p.coins).padStart(3,'0'); $('player-name').textContent = p.name;
  $('player-role').textContent = `${ROLES.find(r=>r.id===p.role)?.name} · ${WEAPONS.find(w=>w.id===p.weapon)?.name}`;
  $('profile-details').innerHTML = `<div class="profile-card"><div class="portrait"></div><div><strong>${escape(p.name)}</strong><p>${ROLES.find(r=>r.id===p.role)?.name}</p></div></div><dl><div><dt>账号</dt><dd>${escape(p.username)}</dd></div><div><dt>下班积分</dt><dd>${p.coins}</dd></div><div><dt>完成挑战</dt><dd>${p.clears} 次</dd></div><div><dt>当前攻击</dt><dd>${damageFor(p.role,p.weapon)}</dd></div></dl>`;
  if (shopDialog.open) renderShop(); renderSnapshot();
}
function renderSnapshot() {
  const snap = network.snapshot, p = network.profile;
  const actor = snap?.players.find(a => a.id === p?.id);
  // 房间号对玩家没有意义，这里显示的是这家公司的名字 + 你此刻所在的房间。
  const place = actor ? (actor.area === 'corridor' ? roomAt(actor.x, actor.y)?.name || '公共走廊' : AREAS[actor.area].name) : '办公室全景';
  $('zone-label').textContent = `${ORG_NAME} · 1F · ${place}`;
  $('nav-shop').classList.toggle('muted', !(actor && actor.area === 'storage')); // purely visual — click still works and explains where to go
  const hp = actor?.hp ?? 100;
  $('health-label').textContent = `${hp} / 100`; $('health-fill').style.width=`${hp}%`;
  $('stage-message').hidden = hp > 0;
  $('stage-message').textContent = '咖啡时间 · 3 秒后恢复';
}

$('nav-shop').onclick = openShop;
$('profile-button').onclick = ()=>network.profile?show(profileDialog):show(authDialog);
$('connection').onclick = ()=> { if (!network.profile) show(authDialog); else if (!network.connected) void join(); };
$('invite').onclick = async ()=>{
  if (!network.snapshot) { toast('先加入房间，再邀请伙伴吧'); return; }
  const url = new URL(location.origin); url.searchParams.set('room',network.snapshot.roomId);
  try { await navigator.clipboard.writeText(url.toString()); toast(`链接已复制。同事打开它，就和你在同一间${ORG_NAME}。`); }
  catch { toast(`房间号：${network.snapshot.roomId}。浏览器暂不支持复制。`); }
};
$('logout').onclick = ()=>void network.logout().catch(e=>toast(errorMessage(e)));
document.querySelectorAll<HTMLButtonElement>('.close-dialog').forEach(button=>button.onclick=()=>button.closest('dialog')!.close());
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{ if(event.target===dialog) {const r=dialog.getBoundingClientRect(); if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();} }));
$('auth-toggle').onclick=()=>{
  loginMode=!loginMode; $('register-fields').hidden=loginMode;
  $('auth-title').textContent=loginMode?'欢迎回来，准备下班。':'欢迎加入摸鱼科技';
  $('auth-submit').innerHTML=(loginMode?'登录，回到办公室':'领取工牌，开始冒险')+icon('arrow');
  $('auth-toggle').textContent=loginMode?'还没有账号？领取工牌':'已有账号？直接登录';
  ($('auth-form') as HTMLFormElement).querySelector<HTMLInputElement>('[name=password]')!.autocomplete=loginMode?'current-password':'new-password';
  $('auth-error').textContent='';
};
$('auth-form').onsubmit=async event=>{
  event.preventDefault(); const button=$<HTMLButtonElement>('auth-submit'); button.disabled=true; $('auth-error').textContent='';
  try { await network.auth(loginMode?'login':'register',Object.fromEntries(new FormData(event.target as HTMLFormElement)) as Record<string,string>); authDialog.close(); await openingSequence(); }
  catch(error) { $('auth-error').textContent=errorMessage(error); }
  finally {button.disabled=false;}
};
$('guest').onclick=async ()=>{
  const button=$<HTMLButtonElement>('guest'); button.disabled=true;
  try { await network.auth('guest',{}); authDialog.close(); await openingSequence(); }
  catch(error){$('auth-error').textContent=errorMessage(error);}
  finally{button.disabled=false;}
};
network.addEventListener('profile',renderProfile);
network.addEventListener('snapshot',renderSnapshot);
network.addEventListener('notice',event=>{toast((event as CustomEvent).detail); if(shopDialog.open)renderShop();});
network.addEventListener('connection',event=>{ $('connection').querySelector('span')!.textContent=(event as CustomEvent).detail; $('connection').classList.toggle('online',network.connected); renderSnapshot(); });
network.addEventListener('ping',event=>$('ping').textContent=`${(event as CustomEvent).detail} ms`);
function playSound(kind:string) {
  if(!soundEnabled)return;
  try { audio??=new AudioContext(); void audio.resume(); const osc=audio.createOscillator(),gain=audio.createGain(); osc.type='square'; osc.frequency.setValueAtTime(kind==='hurt'?140:kind==='complete'?660:400,audio.currentTime); osc.frequency.exponentialRampToValueAtTime(kind==='complete'?990:100,audio.currentTime+.12); gain.gain.setValueAtTime(.025,audio.currentTime); gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+.16); osc.connect(gain).connect(audio.destination); osc.start(); osc.stop(audio.currentTime+.17); } catch { /* audio is optional */ }
}
$('sound').onclick=()=>{soundEnabled=!soundEnabled; $('sound').querySelector('span')!.textContent=soundEnabled?'音效开':'音效关'; $('sound').setAttribute('aria-label',soundEnabled?'关闭音效':'开启音效');playSound('hit');};
window.addEventListener('game-sound',event=>playSound((event as CustomEvent).detail));
document.querySelectorAll<HTMLButtonElement>('[data-touch]').forEach(button=>{
  const key=button.dataset.touch as 'left'|'right'|'up'|'down'|'jump'|'attack';
  button.onpointerdown=event=>{event.preventDefault();button.setPointerCapture(event.pointerId);scene.touchInput(key,true);};
  button.onpointerup=button.onpointercancel=()=>scene.touchInput(key,false);
});
window.addEventListener('keydown',event=>{if(!document.querySelector('dialog[open]')&&['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.code))event.preventDefault();});
setInterval(()=>{if(network.connected)network.room?.send('ping',Date.now());},3000);
// 右侧任务栏里的「创建角色」没了，所以没有身份时直接把工牌弹出来——它现在是唯一的入口。
// catch 只包住 restore()：以前它也包着后面的分支，于是任何一个界面 bug 都会谎报成「服务器连不上」。
void (async () => {
  let restored = false;
  try { restored = await network.restore(); }
  catch { toast('服务器暂时无法连接。请确认服务已启动后重试。'); return; }
  if (restored) await openingSequence(); else show(authDialog);
})();
