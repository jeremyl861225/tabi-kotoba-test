// 文字工具（冰島文版 Ferðaorð）：冰島文沒有上方標注，rubyHTML 只做跳脫；保留同樣的函式名，app.js 與日韓英文版共用同一套呼叫。
export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const rubyHTML = (s) => esc(s);
export const plain = (s) => String(s);
export const upper = () => '';
export const hasHanja = () => false;

// 搜尋用折疊：旅客手機多半沒有冰島文鍵盤，所以 þ→th、ð→d、æ→ae、ö→o，重音母音去重音（á→a、é→e、í→i、ó→o、ú→u、ý→y），
// 小寫，去掉空白連字號與標點（索引與查詢兩邊都用同一個函式）
const FOLD = { 'þ': 'th', 'ð': 'd', 'æ': 'ae', 'ö': 'o', 'ø': 'o' };
export function normQuery(s) {
  return String(s).toLowerCase()
    .replace(/[þðæöø]/g, (c) => FOLD[c])
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘`´]/g, "'")
    .replace(/[\s.,?!~'"“”·、。，．！？「」『』（）()〜…\-/;:]/g, '');
}
// 有拉丁字母（含冰島文字母）才當冰島文查詢，否則當中文意思查
export const isLatin = (s) => /[a-zþðæöáéíóúý]/i.test(s);
export const isAscii = (s) => /^[\x20-\x7eÀ-ſ’‘…]+$/.test(s);
// 冰島文字母（拼字題、聽寫題用）：a–z 加上 á é í ó ú ý þ ð æ ö
export const isLetters = (s) => /^[A-Za-zÁÉÍÓÚÝÞÆÖáéíóúýþæöð]+$/.test(s);
