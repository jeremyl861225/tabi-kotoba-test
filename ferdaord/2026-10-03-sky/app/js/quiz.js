// 出題：九種題型（冰島文版）。選擇題的干擾選項優先從同主題、同等級挑；拼字題用字母方塊。
// 冰島文特有的兩種看字題：選性別（陽性／陰性／中性）、選帶定冠詞的形（bók → bókin）——只出名詞。
import { plain, isLetters } from './ruby.js';

export const TYPES = {
  k2z: '看冰島文選中文',
  z2k: '看中文選冰島文',
  gen: '選名詞的性別',
  art: '選帶定冠詞的形',
  aud: '聽發音選單字',
  audz: '聽發音選中文',
  exl: '聽例句選意思',
  spell: '拼出冰島文',
  dict: '聽寫',
};
export const TYPE_HINT = {
  k2z: '出現冰島文，選中文意思',
  z2k: '出現中文，選冰島文',
  gen: '只出名詞：選出它是陽性、陰性還是中性',
  art: '只出名詞：選出加上「the」的正確寫法（bók → bókin）',
  aud: '只播放發音，選聽到的單字',
  audz: '只播放發音，選中文意思',
  exl: '播放整句例句，選它的中文意思',
  spell: '看中文意思，用字母方塊拼出冰島文（含 á ð þ æ ö）',
  dict: '只播放發音，用字母方塊拼出聽到的字',
};
export const TYPE_GROUPS = [
  ['看字', ['k2z', 'z2k', 'gen', 'art']],
  ['聽力', ['aud', 'audz', 'exl', 'dict']],
  ['拼字', ['spell']],
];
export const GENDER_NAME = { kk: '陽性', kvk: '陰性', hk: '中性' };

function shuffle(a) {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

const zhKey = (c) => c.zh.split(/[、，,；;／/（(]/)[0].trim();
// 拼字題考寫法：單一個字、3–14 個字母（冰島文複合字很長）
export const spellable = (card) => {
  const w = plain(card.w);
  return card.k !== 'p' && isLetters(w) && w.length >= 3 && w.length <= 14;
};
// 名詞才有性別與定冠形：d 是 16 格變格表，d[8] 是主格單數帶冠詞
const isNoun = (card) => card.k !== 'p' && card.g && Array.isArray(card.d) && card.d[8] && isLetters(plain(card.w));

function eligible(card, type) {
  if (type === 'gen') return isNoun(card);
  if (type === 'art') return isNoun(card) && artOptions(card).length >= 3;
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

/* ---------- 選定冠形 ----------
   定冠詞接在字尾：陽性 -inn（flugvöllurinn）、陰性 -in（bókin）、中性 -ið（vatnið）。
   正解是變格表裡的主格單數定冠形；干擾項＝同一個字接上另外兩個性別的字尾，再加主格複數定冠形（真的存在的另一個形，但不是單數）。 */
const SUFFIX = ['inn', 'in', 'ið'];
function artOptions(card) {
  const right = card.d[8];
  const suf = SUFFIX.find((s) => right.endsWith(s) && (s !== 'in' || !right.endsWith('inn')));
  if (!suf) return [];
  const stem = right.slice(0, right.length - suf.length);
  const out = [right];
  const real = new Set(card.d.slice(8, 12));      // 單數的定冠形（賓格、與格、屬格）是真的寫法，不能當錯誤選項
  for (const s of SUFFIX) if (s !== suf && !real.has(stem + s)) out.push(stem + s);
  const pl = card.d[12];
  if (pl && !out.includes(pl)) out.push(pl);
  return out;
}

/* ---------- 字母方塊：每個字母一塊，再加幾塊容易拼錯的干擾字母 ---------- */
// 冰島文最容易混的：有無重音（a/á、e/é、i/í/y/ý、o/ó/ö、u/ú）、d/ð、þ/t、æ/ae、一般子音的相近
const NEAR = { a: 'áoe', 'á': 'aó', e: 'éia', 'é': 'eái', i: 'íyé', 'í': 'iýy', o: 'óöu', 'ó': 'oöú', u: 'úoy', 'ú': 'uóo', y: 'ýiu', 'ý': 'yií',
  'ö': 'oæó', 'æ': 'aöe', d: 'ðtb', 'ð': 'dþ', 'þ': 'ðt', t: 'dþ', c: 'ks', k: 'cg', s: 'cz', z: 's', f: 'v', v: 'fb',
  b: 'pd', p: 'bf', g: 'kj', j: 'gi', l: 'rn', r: 'lj', m: 'n', n: 'mr', h: 'kj', x: 'ks', w: 'v', q: 'k' };
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
    if (type === 'gen') {
      q.options = ['kk', 'kvk', 'hk'].map((g) => ({ g, right: g === card.g }));
    } else if (type === 'art') {
      q.options = shuffle(artOptions(card)).map((t) => ({ t, right: t === card.d[8] }));
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
