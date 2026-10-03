// 離線字典（英文版）：字卡以外的常用英文字，中文釋義＋KK，第一次查詢時才載入。
// 條目：{w 英文, k KK 音標, p 詞性, z 中文}
import { normQuery } from './ruby.js';

let DICT = null;
let loading = null;

export function loadDict() {
  if (DICT) return Promise.resolve(DICT);
  if (!loading) {
    loading = fetch('data/dict.json')
      .then((r) => r.json())
      .then((d) => {
        DICT = d.entries.map((e) => ({ ...e, _w: normQuery(e.w) }));
        return DICT;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

export const dictReady = () => !!DICT;

// 回傳 [{e, score}]，score 越小越前面；exclude 是已經有字卡的寫法（正規化後）
export function searchDict(query, exclude, limit = 30) {
  if (!DICT) return [];
  const q = query.trim();
  if (!q) return [];
  const en = /[a-z]/i.test(q);
  const qn = normQuery(q);
  const out = [];
  for (const e of DICT) {
    if (exclude.has(e._w)) continue;
    let score = 9;
    if (en) {
      if (e._w === qn) score = 0;
      else if (e._w.startsWith(qn)) score = 1;
      else if (qn.length >= 3 && e._w.includes(qn)) score = 2;
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
