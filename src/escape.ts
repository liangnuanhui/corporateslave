/** SVG / HTML 字符串拼接的唯一出口。小地图用 innerHTML 拼 SVG（src/map-panel.ts），
 *  聊天文本是第一个流到那里的用户可控字符串——所以这个函数不能再私藏在 main.ts 里。 */
export const escape = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
