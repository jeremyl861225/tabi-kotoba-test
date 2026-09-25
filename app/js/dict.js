// 離線字典：JMdict 常用詞（約 2.2 萬詞，英文釋義），補字卡以外的字。第一次查詢時才載入。
import { toHira } from './ruby.js';

let DICT = null;
let loading = null;

// 長音寫法寬鬆比對：とうきょう、ときょ、トーキョー 視為同一個
export function collapse(h) {
  return h
    .replace(/ー/g, '')
    .replace(/([おこごそぞとどのほぼぽもよろょを])[うお]/g, '$1')
    .replace(/([うくぐすずつづぬふぶぷむゆるゅ])う/g, '$1')
    .replace(/([えけげせぜてでねへべぺめれ])い/g, '$1')
    .replace(/([あかがさざただなはばぱまやらわゃ])あ/g, '$1');
}

// 羅馬拼音 → 平假名（訓令式、黑本式都收）
const R = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ', ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ', za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と', da: 'だ', di: 'ぢ', du: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ', ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ', pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も', ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ', wa: 'わ', wo: 'を',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ', ja: 'じゃ', ju: 'じゅ', jo: 'じょ', zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', cho: 'ちょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ', bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', she: 'しぇ', je: 'じぇ', che: 'ちぇ', va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
};

export function romaToHira(input) {
  const s = input.toLowerCase()
    .normalize('NFD') // 長音符號拆成母音＋附加符號，下面換成兩個母音
    .replace(/a[̄̂]/g, 'aa').replace(/i[̄̂]/g, 'ii').replace(/u[̄̂]/g, 'uu')
    .replace(/e[̄̂]/g, 'ee').replace(/o[̄̂]/g, 'ou')
    .normalize('NFC')
    .replace(/[^a-z'-]/g, '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'" || c === '-') { if (c === '-') out += 'ー'; i++; continue; }
    // 促音：同一個子音連續兩次（n 除外）
    if (c === s[i + 1] && c !== 'n' && !'aeiou'.includes(c)) { out += 'っ'; i++; continue; }
    if (c === 't' && s[i + 1] === 'c' && s[i + 2] === 'h') { out += 'っ'; i++; continue; }
    if (c === 'n') {
      const nx = s[i + 1];
      if (nx === undefined || nx === "'" || (!'aeiouy'.includes(nx))) { out += 'ん'; i += nx === "'" ? 2 : 1; continue; }
    }
    let hit = false;
    for (const len of [3, 2, 1]) {
      const seg = s.slice(i, i + len);
      if (R[seg]) { out += R[seg]; i += len; hit = true; break; }
    }
    if (!hit) return null; // 不是羅馬拼音（多半是英文）
  }
  return out;
}

export function loadDict() {
  if (DICT) return Promise.resolve(DICT);
  if (!loading) {
    loading = fetch('data/dict.json')
      .then((r) => r.json())
      .then((d) => {
        DICT = d.entries.map((e) => {
          const rs = (e.r || []).map((x) => toHira(x));
          const g = (e.g || '').toLowerCase();
          return { ...e, _r: rs, _rc: rs.map(collapse), _g: ` ${g.replace(/[^a-z0-9 ]+/g, ' ')} `, _g1: g.split(/[;,]/)[0].replace(/\(.*?\)/g, '').trim() };
        });
        return DICT;
      })
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

export const dictReady = () => !!DICT;

// 回傳 [{e, score}]，score 越小越前面；exclude 是已經有字卡的寫法與讀音
export function searchDict(query, exclude, limit = 30) {
  if (!DICT) return [];
  const q = query.trim();
  if (!q) return [];
  const ascii = /^[\x20-\x7eÀ-ſ]+$/.test(q);
  const hira = ascii ? romaToHira(q.replace(/\s+/g, '')) : toHira(q.normalize('NFKC'));
  const hc = hira ? collapse(hira) : null;
  const eng = ascii ? q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim() : null;
  const out = [];
  for (const e of DICT) {
    if ((e.k && e.k.some((k) => exclude.has(k))) || e._r.some((r) => exclude.has(r))) continue;
    let score = 9;
    if (!ascii) {
      if (e.k && e.k.includes(q)) score = 0;
      else if (e._r.includes(hira)) score = 0;
      else if (e.k && e.k.some((k) => k.startsWith(q))) score = 1;
      else if (hira && e._r.some((r) => r.startsWith(hira))) score = 1;
      else if (e.k && q.length >= 2 && e.k.some((k) => k.includes(q))) score = 2;
    } else {
      if (hira && hira.length >= 2) {
        if (e._r.includes(hira) || e._rc.includes(hc)) score = 0;
        else if (e._rc.some((r) => r.startsWith(hc))) score = 1;
      }
      if (score > 3 && eng && eng.length >= 3) {
        if (e._g1 === eng || e._g1 === `to ${eng}`) score = 2;          // 第一個釋義就是它
        else if (e._g.includes(` ${eng} `)) score = 2.5;
        else if (e._g.includes(` ${eng}`)) score = 3;
      }
    }
    if (score < 9) out.push({ e, score });
  }
  out.sort((a, b) => a.score - b.score || (a.e.k ? a.e.k[0].length : a.e.r[0].length) - (b.e.k ? b.e.k[0].length : b.e.r[0].length));
  return out.slice(0, limit);
}
