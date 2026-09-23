import './style.css';
import { Network } from './network';
import { createGame } from './game';
import { roomAt } from '../shared/world';
import { mapPanelMarkup, bindMapPanel } from './map-panel';
import { ROLES, WEAPONS, damageFor, type Zone } from '../shared/game';

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
      <div class="zone-label" id="zone-label">1F · 办公室全景</div>
      <div class="stage-message" id="stage-message" hidden></div>
      <div class="stage-bottom"><span id="stage-hint">WASD 移动人物 · 走门进出 · 滚轮以光标为中心缩放 · 方向键 / 鼠标推到边缘移动视角</span><button id="sound" aria-label="开启音效">${icon('sound')}<span>音效关</span></button></div>
    </section>
    <aside class="mission">
      <div class="mission-top"><a class="brand mini" href="/">${icon('coffee')}<span>牛马上班</span></a><button id="connection" class="connection"><i></i><span>尚未连接</span><small id="ping">—</small></button></div>
      <div class="mission-nav"><button id="nav-office" class="nav active">${icon('office')}公共办公室</button><button id="nav-shop" class="nav">${icon('bag')}装备商店</button></div>
      <div class="mission-title">${icon('check')}<h2>下班计划</h2><span id="mission-count">0/3</span></div>
      <ol class="steps"><li id="step-one" class="current"><span class="step-number">1</span><div><h3>熟悉办公室</h3><p>领取工牌，认识你的新工位</p></div></li><li id="step-two"><span class="step-number">2</span><div><h3>清理加班怪</h3><p id="enemy-progress">和伙伴一起，解决临时需求</p></div></li><li id="step-three"><span class="step-number">3</span><div><h3>领取下班奖励</h3><p>完成挑战，领取 80 积分</p></div></li></ol>
      <button id="primary" class="button primary">创建角色${icon('arrow')}</button>
      <button id="return-office" class="text-button" hidden>返回公共办公室</button>
      <div class="roster-heading"><h3>当前房间成员 <span id="member-count">0/24</span></h3><span class="live-dot"></span></div><div id="roster" class="roster"><p class="empty-roster">登录后，看看谁还没下班。</p></div>
      <div class="room-bottom"><span id="room-label">等待加入办公室</span><button id="invite" class="icon-button" aria-label="复制房间邀请链接" title="邀请伙伴">${icon('share')}</button></div>
    </aside></div>
    <section class="control-strip" aria-label="操作说明"><button id="profile-button" class="identity"><div class="portrait small"></div><span><strong id="player-name">你的工位，已预留</strong><small id="player-role">创建一个虚构角色，开始冒险</small></span></button><div class="keyboard-controls"><span><kbd class="wide">WASD</kbd>移动</span><span id="secondary-control">滚轮缩放 · 方向键移视角</span><span><kbd>J</kbd>攻击</span><span><kbd>E</kbd>互动</span></div><span class="control-note">收工，才是正经事。</span></section>
    <div class="touch-controls" aria-label="触屏操作"><button data-touch="left" aria-label="向左移动">←</button><button data-touch="right" aria-label="向右移动">→</button><button data-touch="up" aria-label="向上移动">↑</button><button data-touch="down" aria-label="向下移动">↓</button><button data-touch="jump" id="touch-jump" hidden>跳跃</button><button data-touch="attack">攻击</button><button id="touch-interact">互动</button></div>
    <footer><span>本故事纯属虚构，如有雷同，应该是人生。</span><span>多人体验版 <span class="footer-dot">·</span> MVP 0.1</span></footer>
  </main>
  <dialog id="auth-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('coffee')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2 id="auth-title">欢迎加入摸鱼科技</h2><p class="dialog-subtitle">名字可以随意，下班必须准时。</p><form id="auth-form"><div id="register-fields"><label>游戏昵称<input name="name" placeholder="例如：咖啡不加班" maxlength="12" value="摸鱼小王" autocomplete="nickname"/></label><fieldset><legend>选择你的职级</legend><div class="role-options">${ROLES.map((r,i)=>`<label class="role-option"><input type="radio" name="role" value="${r.id}" ${i===0?'checked':''}/><span><strong>${r.name}</strong><small>攻击 ${r.attack} · 生命 100</small></span></label>`).join('')}</div></fieldset></div><label>账号<input name="username" placeholder="3—24 位字母、数字或下划线" pattern="[a-zA-Z0-9_]{3,24}" required autocomplete="username"/></label><label>密码<input name="password" type="password" placeholder="至少 8 位" minlength="8" maxlength="128" required autocomplete="new-password"/></label><p id="auth-error" class="error" role="alert"></p><button type="submit" id="auth-submit" class="button primary full">领取工牌，开始冒险${icon('arrow')}</button></form><div class="auth-bottom"><button id="auth-toggle" class="text-button">已有账号？直接登录</button><button id="guest" class="text-button">快速试玩</button></div><p class="fine-print">账号支持跨设备恢复。快速试玩身份仅保留在此浏览器。</p></dialog>
  <dialog id="shop-dialog" class="shop-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('bag')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2>好装备，早下班。</h2><p class="dialog-subtitle">积分换装备，给下一次挑战加点底气。</p><div class="shop-balance">可用积分 <strong id="shop-coins">0</strong><span>₵</span></div><div id="shop-items"></div><p class="fine-print">装备购买与切换会立即保存。公共办公室内可使用商店。</p></dialog>
  <dialog id="profile-dialog"><div class="dialog-top"><span class="dialog-mark">${icon('office')}</span><button class="icon-button close-dialog" aria-label="关闭">${icon('close')}</button></div><h2>我的工牌</h2><div id="profile-details"></div><button id="logout" class="button secondary full">退出登录</button></dialog>
  <div id="toast" role="status" aria-live="polite"></div>`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const network = new Network();
const authDialog = $<HTMLDialogElement>('auth-dialog');
const shopDialog = $<HTMLDialogElement>('shop-dialog');
const profileDialog = $<HTMLDialogElement>('profile-dialog');
let loginMode = false, rewardClaimed = false, currentRoom = '', toastTimer = 0;
let soundEnabled = false; let audio: AudioContext | undefined;
const { scene } = createGame(network, () => !!document.querySelector('dialog[open]'), interact);
bindMapPanel(scene, network);
$('touch-interact').onclick = interact;
function toast(message: string) { $('toast').textContent = message; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = window.setTimeout(()=>$('toast').classList.remove('visible'),4000); }
function show(dialog: HTMLDialogElement) { scene.resetInput(); dialog.showModal(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : '连接失败，请稍后重试'; }
async function join(zone: Zone, roomId?: string) {
  $('primary').setAttribute('disabled','');
  try { await network.join(zone, roomId); }
  catch (error) { toast(errorMessage(error)); $('connection').querySelector('span')!.textContent = '点击重试'; }
  finally { $('primary').removeAttribute('disabled'); }
}
function initialJoin() {
  const params = new URLSearchParams(location.search);
  return join(params.get('zone') === 'dungeon' ? 'dungeon' : 'office', params.get('room') || undefined);
}
function interact() {
  if (!network.profile) { show(authDialog); return; }
  const actor = network.snapshot?.players.find(p=>p.id===network.profile!.id);
  if (network.snapshot?.zone === 'office' && actor && actor.x > 1620 && Math.abs(actor.y - 600) < 65) void join('dungeon');
  else if (network.snapshot?.zone === 'office' && actor && roomAt(actor.x, actor.y)?.id === 'storage') openShop();
  else if (network.snapshot?.status === 'complete') network.room?.send('claim');
  else toast(network.snapshot?.zone==='dungeon'?'按 J 攻击加班怪，空格跳跃躲避。':'沿走廊从门口进出房间；储物间按 E 选装备，走廊最右侧按 E 进入副本。');
}
function openShop() {
  if (!network.profile) { show(authDialog); return; }
  if (network.snapshot?.zone !== 'office') { toast('请先返回公共办公室，再购买装备'); return; }
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
  if (snap?.roomId !== currentRoom) { currentRoom = snap?.roomId || ''; rewardClaimed=false; }
  const dungeon = snap?.zone === 'dungeon', complete=snap?.status==='complete';
  const actor = snap?.players.find(a => a.id === p?.id);
  const place = actor ? roomAt(actor.x, actor.y)?.name || '公共走廊' : '办公室全景';
  $('zone-label').textContent = dungeon ? 'B1 · 加班清理副本' : `1F · ${place}`;
  $('secondary-control').textContent = dungeon ? 'SPACE 跳跃' : '滚轮缩放 · 方向键移视角';
  $('touch-jump').hidden = !dungeon;
  document.querySelectorAll<HTMLElement>('[data-touch=up], [data-touch=down]').forEach(button => button.hidden = dungeon);
  $('member-count').textContent = `${snap?.players.length||0}/${dungeon?8:24}`;
  $('room-label').textContent = snap?`房间 ${snap.roomId.slice(0,8)}`:'等待加入办公室';
  $('nav-office').classList.toggle('active',!dungeon);
  const hp = snap?.players.find(a=>a.id===p?.id)?.hp ?? 100;
  $('health-label').textContent = `${hp} / 100`; $('health-fill').style.width=`${hp}%`;
  const killed = snap?.enemies.filter(e=>e.hp===0).length||0;
  $('enemy-progress').textContent = dungeon?`已清理 ${killed} / ${snap?.enemies.length||3} 只加班怪`:'和伙伴一起，解决临时需求';
  $('step-one').className = p?'done':'current'; $('step-two').className=complete?'done':p?'current':''; $('step-three').className=rewardClaimed?'done':complete?'current':'';
  $('mission-count').textContent = `${Number(!!p)+Number(complete)+Number(rewardClaimed)}/3`;
  $('primary').innerHTML = !p?`创建角色${icon('arrow')}`:!network.connected?`重新连接${icon('arrow')}`:!dungeon?`进入副本${icon('arrow')}`:complete?(rewardClaimed?`收工，返回办公室${icon('arrow')}`:`领取 80 积分${icon('arrow')}`):`挑战进行中 <span>${killed}/3</span>`;
  ($('primary') as HTMLButtonElement).disabled = !!(dungeon&&!complete&&network.connected) || network.busy;
  $('return-office').hidden = !dungeon || rewardClaimed;
  $('stage-hint').textContent = dungeon?(complete?'挑战完成！别忘了领取你的下班奖励。':'J 攻击 · SPACE 跳跃躲避 · 体力耗尽后 3 秒恢复'): 'WASD 移动人物 · 走门进出 · 滚轮以光标为中心缩放 · 方向键 / 鼠标推到边缘移动视角';
  $('stage-message').hidden = hp>0 && !complete;
  $('stage-message').textContent = hp<=0?'咖啡时间 · 3 秒后恢复':rewardClaimed?'下班积分 +80 · 今天辛苦了！':'加班怪已清空 · 准时下班！';
  const rosterHtml = snap?.players.map(actor=>`<div class="roster-row ${actor.id===p?.id?'self':''}"><div class="mini-avatar"></div><span>${escape(actor.name)}</span><small>${actor.id===p?.id?'我':ROLES.find(r=>r.id===actor.role)?.name||'同伴'}</small></div>`).join('')||'<p class="empty-roster">登录后，看看谁还没下班。</p>';
  if ($('roster').innerHTML !== rosterHtml) $('roster').innerHTML = rosterHtml;
}

$('primary').onclick = ()=>{
  if (!network.profile) show(authDialog);
  else if (!network.connected) void join('office');
  else if (network.snapshot?.status==='complete'&&!rewardClaimed) network.room?.send('claim');
  else void join(network.snapshot?.zone==='dungeon'?'office':'dungeon');
};
$('nav-office').onclick = () => { if (!network.profile) show(authDialog); else if (network.snapshot?.zone!=='office'||!network.connected) void join('office'); };
$('nav-shop').onclick = openShop;
$('return-office').onclick = ()=>void join('office');
$('profile-button').onclick = ()=>network.profile?show(profileDialog):show(authDialog);
$('connection').onclick = ()=> { if (!network.profile) show(authDialog); else if (!network.connected) void join('office'); };
$('invite').onclick = async ()=>{
  if (!network.snapshot) { toast('先加入房间，再邀请伙伴吧'); return; }
  const url = new URL(location.origin); url.searchParams.set('room',network.snapshot.roomId); url.searchParams.set('zone',network.snapshot.zone);
  try { await navigator.clipboard.writeText(url.toString()); toast('房间链接已复制。在同一网络的另一浏览器中打开即可加入。'); }
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
  try { await network.auth(loginMode?'login':'register',Object.fromEntries(new FormData(event.target as HTMLFormElement)) as Record<string,string>); authDialog.close(); await initialJoin(); }
  catch(error) { $('auth-error').textContent=errorMessage(error); }
  finally {button.disabled=false;}
};
$('guest').onclick=async ()=>{
  const button=$<HTMLButtonElement>('guest'); button.disabled=true;
  try { await network.auth('guest',{}); authDialog.close(); await initialJoin(); }
  catch(error){$('auth-error').textContent=errorMessage(error);}
  finally{button.disabled=false;}
};
network.addEventListener('profile',renderProfile);
network.addEventListener('snapshot',renderSnapshot);
network.addEventListener('notice',event=>{toast((event as CustomEvent).detail); if(shopDialog.open)renderShop();});
network.addEventListener('connection',event=>{ $('connection').querySelector('span')!.textContent=(event as CustomEvent).detail; $('connection').classList.toggle('online',network.connected); renderSnapshot(); });
network.addEventListener('ping',event=>$('ping').textContent=`${(event as CustomEvent).detail} ms`);
network.addEventListener('complete',()=>{toast('挑战完成！领取奖励，准备下班。');playSound('complete');});
network.addEventListener('reward',event=>{rewardClaimed=true;toast((event as CustomEvent).detail.awarded?'80 积分已入账，奖励已保存。':'本次奖励已领取，无需重复领取。');renderSnapshot();playSound('complete');});
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
void network.restore().then(restored=>{if(restored)return initialJoin();}).catch(()=>toast('服务器暂时无法连接。请确认服务已启动后重试。'));
