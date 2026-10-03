// 出題：八種題型（英文版）。選擇題的干擾選項優先從同主題、同等級挑；拼字題用字母方塊。
import { plain, isLetters } from './ruby.js';

export const TYPES = {
  k2z: '看英文選中文',
  z2k: '看中文選英文',
  pron: '看英文選正確發音（KK）',
  aud: '聽發音選單字',
  audz: '聽發音選中文',
  exl: '聽例句選意思',
  spell: '拼出英文',
  dict: '聽寫',
};
export const TYPE_HINT = {
  k2z: '出現英文，選中文意思',
  z2k: '出現中文，選英文',
  pron: '兩個音節以上的字，選出重音位置正確的 KK 音標',
  aud: '只播放發音，選聽到的單字',
  audz: '只播放發音，選中文意思',
  exl: '播放整句例句，選它的中文意思',
  spell: '看中文意思，用字母方塊拼出英文',
  dict: '只播放發音，用字母方塊拼出聽到的字',
};
export const TYPE_GROUPS = [
  ['看字', ['k2z', 'z2k', 'pron']],
  ['聽力', ['aud', 'audz', 'exl', 'dict']],
  ['拼字', ['spell']],
];

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const zhKey = (c) => c.zh.split(/[、，,；;／/（(]/)[0].trim();
// 拼字題考寫法：單一個字、3–12 個字母
export const spellable = (card) => {
  const w = plain(card.w);
  return card.k !== 'p' && isLetters(w) && w.length >= 3 && w.length <= 12;
};
// 重音題：單一個字、KK 有主重音（兩個音節以上）
const STRESS = /[ˋˏ]/g;
const stressable = (card) => card.k !== 'p' && card.r && !/\s/.test(card.r) && card.r.includes('ˋ') && isLetters(plain(card.w));

function eligible(card, type) {
  if (type === 'pron') return stressable(card);
  if (type === 'spell' || type === 'dict') return spellable(card);
  if (type === 'exl') return !!(card.ex && card.exz);
  return true;
}

function pickDistractors(card, pool, n, conflict) {
  const tiers = [
    pool.filter((c) => c.th === card.th && c.t === card.t),
    pool.filter((c) => c.th === card.th),
    pool.filter((c) => c.t === card.t),
    pool,
  ];
  const chosen = [];
  for (const group of tiers) {
    for (const c of shuffle(group)) {
      if (chosen.length >= n) break;
      if (c.id === card.id || chosen.includes(c)) continue;
      if (conflict(c, card) || chosen.some((x) => conflict(c, x))) continue;
      chosen.push(c);
    }
    if (chosen.length >= n) break;
  }
  return chosen;
}

const sameMeaning = (a, b) => zhKey(a) === zhKey(b) || a.zh === b.zh;
const sameWord = (a, b) => plain(a.w).toLowerCase() === plain(b.w).toLowerCase() || a.r === b.r;
const sameEx = (a, b) => !a.exz || !b.exz || a.exz === b.exz;

/* ---------- 重音放錯的 KK ----------
   KK 的重音記號放在音節前；把記號拿掉後，母音前的子音群切出音節，主重音 ˋ 移到別的音節就是最常見的錯（台灣人念 hoTEL、deSSERT 那種錯） */
const V = 'aeiouæɑɔəɚɝʌɪʊɛ';
const ONSET2 = ['tr', 'dr', 'pr', 'br', 'kr', 'gr', 'pl', 'bl', 'kl', 'gl', 'fl', 'fr', 'st', 'sp', 'sk', 'sl', 'sm', 'sn', 'sw', 'tw', 'kw', 'θr', 'ʃr', 'pj', 'kj', 'fj', 'mj', 'bj', 'hj'];
function syllableStarts(bare) {
  // 每個母音群一個音節；起點＝母音群前面的子音（合法的兩個子音連綴 tr、st… 一起帶走；tʃ、dʒ 算一個）
  const starts = [];
  for (let i = 0; i < bare.length; i++) {
    if (!V.includes(bare[i]) || (i > 0 && V.includes(bare[i - 1]))) continue;
    let s = i;
    const prev = starts.length ? starts[starts.length - 1] + 1 : 0;
    if (s - 2 >= prev && ['tʃ', 'dʒ'].includes(bare.slice(s - 2, s))) s -= 2;
    else if (s - 2 >= prev && ONSET2.includes(bare.slice(s - 2, s)) && !V.includes(bare[s - 3] || '')) s -= 2;
    else if (s - 1 >= prev && !V.includes(bare[s - 1])) s -= 1;
    starts.push(s);
  }
  if (starts.length) starts[0] = 0;
  return starts;
}
export function stressVariants(kk) {
  const bare = kk.replace(STRESS, '');
  const right = kk.replace(/ˏ/g, '').indexOf('ˋ');      // 正解主重音在去掉記號的字串裡的位置
  const out = new Set();
  for (const s of syllableStarts(bare)) if (s !== right) out.add(bare.slice(0, s) + 'ˋ' + bare.slice(s));
  return [...out];
}
function pronOptions(card, pool) {
  const right = card.r;
  const opts = new Set([right]);
  for (const v of shuffle(stressVariants(right))) {
    if (opts.size >= 3) break;
    opts.add(v);
  }
  for (const c of shuffle(pool.filter((c) => c.th === card.th).concat(shuffle(pool)))) {
    if (opts.size >= 4) break;
    if (c.id !== card.id && stressable(c)) opts.add(c.r);
  }
  return shuffle([...opts]).map((r) => ({ r, right: r === right }));
}

/* ---------- 字母方塊：每個字母一塊，再加幾塊容易拼錯的干擾字母 ---------- */
const NEAR = { a: 'eo', e: 'ai', i: 'ey', o: 'ua', u: 'oa', y: 'ie', c: 'ks', k: 'c', s: 'cz', z: 's', f: 'v', v: 'f',
  b: 'p', p: 'b', d: 't', t: 'd', g: 'j', j: 'g', l: 'r', r: 'l', m: 'n', n: 'm', w: 'v', h: 'w', q: 'k', x: 'k' };
export function letterTiles(word) {
  const chars = [...word.toLowerCase()];
  const extra = chars.length <= 5 ? 2 : 3;
  const pool = [];
  for (const ch of shuffle(chars)) {
    for (const m of shuffle([...(NEAR[ch] || '')])) if (!pool.includes(m)) pool.push(m);
    if (pool.length >= extra * 2) break;
  }
  const decoys = shuffle(pool).slice(0, extra);
  return shuffle([...chars, ...decoys]).map((ch, i) => ({ ch, i }));
}
// 舊名稱（app.js 沿用韓文版的呼叫）
export const syllableTiles = letterTiles;

export function buildQuiz(scope, pool, types, count) {
  const cards = shuffle(scope).slice(0, Math.min(count, scope.length));
  const useTypes = types.length ? types : Object.keys(TYPES);
  let cycle = [];
  return cards.map((card) => {
    if (!cycle.length) cycle = shuffle(useTypes);
    const fits = (t) => eligible(card, t);
    const type = cycle.find(fits) || useTypes.find(fits) || 'k2z';
    if (cycle.includes(type)) cycle.splice(cycle.indexOf(type), 1);
    const q = { card, type, answer: null };
    if (type === 'pron') {
      q.options = pronOptions(card, pool);
    } else if (type === 'spell' || type === 'dict') {
      q.target = [...plain(card.w).toLowerCase()];
      q.tiles = letterTiles(plain(card.w));
      q.filled = [];
    } else {
      const conflict = type === 'exl' ? sameEx : (type === 'k2z' || type === 'audz') ? sameMeaning : sameWord;
      const ds = pickDistractors(card, pool, 3, (a, b) => sameMeaning(a, b) || sameWord(a, b) || conflict(a, b));
      q.options = shuffle([card, ...ds]).map((c) => ({ c, right: c.id === card.id }));
    }
    return q;
  });
}
