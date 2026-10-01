// 四個設計方向共用的真實內容（取自旅ことば v20 的 data/cards.json）與畫面切換。
// 網址參數：?s=home|card 切換畫面、?dark=1 深色；嵌在索引頁的小手機裡時不顯示切換鈕。
window.TK = {
  learned: 84, total: 5074, arrived: 6, stations: 354,
  line: { id: 1, name: '必備', count: 70 },
  next: { no: 7, title: '東西南北', theme: '問路與方向', fam: 'move', n: 9, seen: 2, prev: '居酒屋入門', after: '程度與頻率' },
  route: [
    { no: 1, title: '打招呼與道謝', theme: '寒暄與應答', fam: 'basic', n: 15, done: true, quiz: '15/15' },
    { no: 2, title: '做與變成', theme: '常用動詞', fam: 'basic', n: 11, done: true, quiz: '11/11' },
    { no: 3, title: '請求與婉拒', theme: '寒暄與應答', fam: 'basic', n: 14, done: true },
    { no: 4, title: '好壞與難易', theme: '形容詞', fam: 'basic', n: 13, done: true, quiz: '12/13' },
    { no: 5, title: '列舉時間與範圍', theme: '連接詞與句型', fam: 'basic', n: 12, done: true },
    { no: 6, title: '居酒屋入門', theme: '居酒屋', fam: 'food', n: 16, done: true },
    { no: 7, title: '東西南北', theme: '問路與方向', fam: 'move', n: 9, cur: true, seen: 2 },
    { no: 8, title: '程度與頻率', theme: '副詞', fam: 'basic', n: 18 },
    { no: 9, title: '出入口與廁所', theme: '招牌與標示', fam: 'city', n: 14 },
    { no: 10, title: '數量與計算單位', theme: '數字・時間・價錢', fam: 'basic', n: 13 },
    { no: 11, title: '這個那個與哪個', theme: '寒暄與應答', fam: 'basic', n: 11 },
    { no: 12, title: '壽司店基本', theme: '壽司與海鮮', fam: 'food', n: 16 },
  ],
  families: [
    { id: 'basic', name: '基本', st: 114 }, { id: 'move', name: '交通', st: 31 }, { id: 'stay', name: '住宿', st: 7 },
    { id: 'food', name: '飲食', st: 58 }, { id: 'shop', name: '購物', st: 18 }, { id: 'care', name: '醫療緊急', st: 16 },
    { id: 'city', name: '觀光生活', st: 97 }, { id: 'listen', name: '店員廣播', st: 13 },
  ],
  card: {
    no: '0084', word: '南', kana: 'みなみ', roma: 'minami', zh: '南；南邊', pos: '名詞',
    ex: [['南口', 'みなみぐち'], ['から'], ['出', 'で'], ['てください。']], exz: '請從南出口出去。',
    unit: '東西南北', at: 3, of: 9, station: 7,
    prev: { w: '北', r: 'きた' }, next: { w: '西', r: 'にし' },
    facts: ['必備', '旅遊頻率第 45 名', '日檢 N5', '3 份資料收錄'],
  },
};

TK.params = new URLSearchParams(location.search);
TK.screen = TK.params.get('s') || 'home';
if (TK.params.get('dark') === '1') document.documentElement.classList.add('dark');
document.documentElement.dataset.screen = TK.screen;

// 例句：[[漢字, 讀音], [假名]] → ruby HTML
TK.ruby = (parts) => parts.map(([b, r]) => (r ? `<ruby>${b}<rt>${r}</rt></ruby>` : b)).join('');

// 全螢幕打開時：右上角的小切換鈕（不屬於設計本身）
TK.switcher = () => {
  if (window.self !== window.top || TK.params.get('shot')) return;
  const u = (s, d) => `?s=${s}${d ? '&dark=1' : ''}`;
  const dark = TK.params.get('dark') === '1';
  const el = document.createElement('div');
  el.className = 'tk-switch';
  el.innerHTML = `<a href="./">← 回比較頁</a><a href="${u('home', dark)}" ${TK.screen === 'home' ? 'aria-current="page"' : ''}>主畫面</a><a href="${u('card', dark)}" ${TK.screen === 'card' ? 'aria-current="page"' : ''}>字卡</a><a href="${u(TK.screen, !dark)}">${dark ? '淺色' : '深色'}</a>`;
  document.body.appendChild(el);
  const st = document.createElement('style');
  st.textContent = `.tk-switch{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 104px);transform:translateX(-50%);z-index:999;display:flex;gap:2px;padding:4px;border-radius:999px;background:rgb(20 20 20/.78);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);font:600 12px/1 -apple-system,"PingFang TC",sans-serif}
  .tk-switch a{color:#fff;text-decoration:none;padding:8px 10px;border-radius:999px;white-space:nowrap}.tk-switch a[aria-current]{background:#fff;color:#111}`;
  document.head.appendChild(st);
};
