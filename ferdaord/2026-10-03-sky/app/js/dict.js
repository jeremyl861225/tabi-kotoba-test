// 離線字典（冰島文版）：字卡以外的常用冰島文字，中文釋義（沒有就英文）＋ IPA，第一次查詢時才載入。
// 條目：{w 冰島文原形, k IPA, p 詞性, z 中文, g 英文釋義, fm 變化形（折疊後、空白分隔，查到變化形時指回原形）}
import { normQuery, isLatin } from './ruby.js';

let DICT = null;
let loading = null;

export function loadDict() {
  if (DICT) return Promise.resolve(DICT);
  if (!loading) {
    loading = fetch('data/dict.json')
      .then((r) => r.json())
      .then((d) => {
        DICT = d.entries.map((e) => ({ ...e, _w: normQuery(e.w), _fm: e.fm ? new Set(e.fm.split(' ')) : null }));
        return DICT;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

export const dictReady = () => !!DICT;

const glossScore = (g, q) => {
  if (!g) return 9;
  const parts = g.toLowerCase().split(/[;,]/).map((x) => x.trim());
  if (parts[0] === q) return 2;
  if (parts.includes(q)) return 2.4;
  if (parts.some((x) => x.split(/\s+/).includes(q))) return 2.8;
  if (q.length >= 3 && parts.some((x) => x.startsWith(q))) return 3;
  return 9;
};

// 回傳 [{e, score}]，score 越小越前面；exclude 是已經有字卡的寫法（折疊後）
export function searchDict(query, exclude, limit = 30) {
  if (!DICT) return [];
  const q = query.trim();
  if (!q) return [];
  const latin = isLatin(q);
  const qn = normQuery(q);
  const ql = q.toLowerCase();
  const out = [];
  for (const e of DICT) {
    if (exclude.has(e._w)) continue;
    let score = 9;
    if (latin) {
      if (e._w === qn) score = 0;
      else if (e._fm && e._fm.has(qn)) score = 0.6;          // 輸入的是變化形（flugvellinum）→ 指回原形
      else if (e._w.startsWith(qn)) score = 1;
      else if (qn.length >= 3 && e._w.includes(qn)) score = 2;
      if (/^[a-z' -]+$/i.test(q)) score = Math.min(score, glossScore(e.g, ql) + 0.3);   // 英文查詢也比對英文釋義（airport → flugvöllur）
    } else if (e.z) {
      if (e.z.split(/[；;，,、]/).some((x) => x.trim() === q)) score = 0.5;
      else if (e.z.startsWith(q)) score = 1;
      else if (e.z.includes(q)) score = 1.5;
    }
    if (score < 9) out.push({ e, score });
  }
  out.sort((a, b) => a.score - b.score || a.e.w.length - b.e.w.length);
  return out.slice(0, limit);
}
