// 文字工具（英文版 Street Talk）：英文沒有上方標注，rubyHTML 只做跳脫；保留同樣的函式名，app.js 與日韓文版共用同一套呼叫。
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const rubyHTML = (s) => esc(s);
export const plain = (s) => String(s);
export const upper = () => '';
export const hasHanja = () => false;

// 搜尋用正規化：全形轉半形、去重音（entrée＝entree）、撇號統一、小寫、去掉空白連字號與標點（pick up＝pickup、check-in＝checkin）
export function normQuery(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase()
    .replace(/[\s.,?!~'"“”·、。，．！？「」『』（）()〜…\-/;:]/g, '');
}
export const isAscii = (s) => /^[\x20-\x7eÀ-ſ’‘…]+$/.test(s);
// 英文字母：只有 a–z（拼字題、聽寫題用）
export const isLetters = (s) => /^[A-Za-z]+$/.test(s);
