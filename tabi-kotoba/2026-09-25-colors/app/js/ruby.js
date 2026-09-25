// 假名標音標記：{漢字|かんじ}。其餘文字原樣。
const RUBY_RE = /\{([^|{}]+)\|([^{}]+)\}/g;

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 轉成 <ruby>；segments 之外的文字要跳脫
export function rubyHTML(markup) {
  let out = '';
  let last = 0;
  markup.replace(RUBY_RE, (m, base, rt, idx) => {
    out += esc(markup.slice(last, idx));
    out += `<ruby>${esc(base)}<rt>${esc(rt)}</rt></ruby>`;
    last = idx + m.length;
    return m;
  });
  out += esc(markup.slice(last));
  return out;
}

// \u200b 是建置時插入的詞組換行點，比對與朗讀時要拿掉
export const plain = (markup) => markup.replace(RUBY_RE, '$1').replace(/\u200b/g, '');
export const reading = (markup) => markup.replace(RUBY_RE, '$2').replace(/\u200b/g, '');

export const hasKanji = (s) => /[㐀-鿿豈-﫿々〆ヶ]/.test(s);

export function toHira(s) {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 搜尋用正規化：全形半形統一、片假名轉平假名、去掉空白與標點
export function normQuery(s) {
  return toHira(s.normalize('NFKC').toLowerCase()).replace(/[\s、。，．・！？!?「」『』（）()〜~\-]/g, '');
}

// 羅馬拼音比對鍵：去長音符號、ou/uu/oo… 收成單一母音，讓 tokyo、toukyou、tōkyō 都能對上
export function romaKey(s) {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/ou/g, 'o')
    .replace(/([aeiou])\1+/g, '$1');
}

export const isAscii = (s) => /^[\x20-\x7eÀ-ſ]+$/.test(s);
