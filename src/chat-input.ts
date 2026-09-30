import { CHAT } from '../shared/game';

/** 这次 Enter 该不该打开聊天框。抽成纯函数是因为这个任务其余部分全靠浏览器人工验，
 *  而门控的条件最多——四个来源任意一个判错都是一个真 bug，且症状各不相同。 */
export function shouldOpenChat(state: {
  alreadyOpen: boolean; key: string; composing: boolean; dialogOpen: boolean; canChat: boolean; fromChatBox: boolean;
}): boolean {
  // 来自聊天框自身的按键永远不该「打开聊天框」。少了这一条，Enter 发送后
  // 同一个事件冒泡到 window 时 alreadyOpen 已经是 false，于是框会立刻重开。
  if (state.fromChatBox) return false;
  if (state.alreadyOpen || state.key !== 'Enter') return false;
  if (state.dialogOpen) return false;       // 对话框里的 Enter 归对话框
  if (state.composing) return false;        // 输入法组字中的 Enter 是确认候选词
  return state.canChat;
}

/** 输入框与键盘的交接。开着的时候它拥有键盘，`blocked()` 据此让游戏这边全部失效。 */
export function createChatInput(opts: {
  send: (payload: { text: string }) => void;
  canChat: () => boolean;          // 纯判断，不许有副作用——它每次按 Enter 都被调用
  onRefused: () => void;           // 被拒时做什么（弹工牌对话框），副作用放这里
  onClose: () => void;
}) {
  const box = document.getElementById('chat-input') as HTMLInputElement;
  let open = false;
  let sentAt = 0;

  const close = () => {
    if (!open) return;
    open = false; box.value = ''; box.hidden = true; box.blur();
    // 关掉时必须让游戏那边重置按键状态：按 Enter 开聊天那一刻你可能正按着 D，
    // 而焦点在输入框时画布收不到 keyup，Phaser 那边 D 会一直是按下状态——
    // 关掉聊天，人就自己往右走，而你没碰任何键。
    opts.onClose();
  };

  const openBox = () => {
    if (open) return;
    open = true; box.hidden = false; box.value = ''; box.focus();
  };

  box.addEventListener('keydown', event => {
    // 任何 window 级监听器都不该看见聊天框里的打字——包括将来新加的。放在最顶上：
    // preventDefault() 不阻止冒泡，Enter 发送后同一个事件会冒到 window，那时 open
    // 已经被 close() 置为 false，不拦住冒泡的话聊天框会被同一次按键立刻重新打开。
    event.stopPropagation();
    // 中文输入法：打「你好」时按 Enter 是在确认候选词，不是发送。不放行的话，
    // 每个用输入法的人第一次打字都会把半截拼音发出去。229 是老 WebKit 不设
    // isComposing 时的兜底。这条不能删。
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const text = box.value.trim();
    if (!text) { close(); return; }
    // 客户端也挡一道冷却：少发一个必被服务器丢弃的包。服务器那边才是权威。
    if (performance.now() - sentAt >= CHAT.cooldownMs) { sentAt = performance.now(); opts.send({ text }); }
    close();
  });
  box.addEventListener('blur', close);

  window.addEventListener('keydown', event => {
    const state = {
      alreadyOpen: open, key: event.key,
      composing: event.isComposing || event.keyCode === 229,
      dialogOpen: !!document.querySelector('dialog[open]'),       // 对话框里的 Enter 归对话框
      canChat: opts.canChat(),
      fromChatBox: event.target === box,
    };
    // 门控只在这一处，且只写一遍：shouldOpenChat 判断「现在该不该开」；
    // 拿 canChat 强制为 true 再判一次，就知道「要不是没工牌/开场没放完，本来该开」——
    // 只有这种情况才弹工牌对话框，其余被拦下的原因（已经开着、对话框优先、正在组字）都不弹。
    if (shouldOpenChat(state)) { event.preventDefault(); openBox(); return; }
    if (!state.canChat && shouldOpenChat({ ...state, canChat: true })) opts.onRefused();
  });

  return { isOpen: () => open, open: openBox, close };
}
