// 配色試看（測試 repo 專用）：網址 ?v=1～6 決定一開始的版本，下方切換鈕可以換。
// 只在淺色模式比較（這 6 種是淺色的設計；深色模式看到的是目前上線版）。
const T = '!important';
const DARK_NEXT = `
.next { background:#1c1814${T}; color:#f3ecdd${T}; box-shadow:none${T}; }
.next p, .next-foot .n { color: rgba(243,236,221,.72)${T}; }
.next-foot .n [lang="ja"] { color:#f3ecdd${T}; }
.next .segs i { background: rgba(255,255,255,.16)${T}; }
.next .segs i.done { background:#f3ecdd${T}; }
.next .next-go { background:#f3ecdd${T}; color:#1c1814${T}; }`;
const WHITE_FAMS = `
.fam:not([aria-pressed="true"]) { background:#fff${T}; box-shadow: inset 0 0 0 1px #e6e1d8${T}; }`;

const LOOKS = [
  ['1', '白色塊細框', `
.next { background:#fff${T}; box-shadow: 0 0 0 1px #e6e1d8, 0 8px 22px rgba(40,30,20,.06)${T}; }` + WHITE_FAMS],
  ['2', '淺灰色塊', `
.next { background:#f5f3ef${T}; }
.fam:not([aria-pressed="true"]) { background:#f5f3ef${T}; }`],
  ['3', '淡彩色塊（目前）', ''],
  ['4', '家族實色', DARK_NEXT + `
.fam { background: var(--line)${T}; color: var(--on)${T}; }
.fam span { color: var(--on)${T}; opacity:.85; }
.fam b::before { background: var(--on)${T}; }
.fam[data-fam=""] { background:#3e362d${T}; color:#fff${T}; }
.fam[aria-pressed="true"] { box-shadow: 0 0 0 3px #fff, 0 0 0 5px #1c1814${T}; }`],
  ['5', '下一站深色', DARK_NEXT + WHITE_FAMS],
  ['6', '下一站淡彩', WHITE_FAMS],
];

const UI = `
.look-bar { position: fixed; z-index: 900; left: 8px; right: 8px; bottom: calc(var(--tabbar-h) + var(--safe-b) + 8px);
  display: flex; gap: 6px; align-items: center; overflow-x: auto; scrollbar-width: none; padding: 8px;
  background: rgba(255,255,255,.97); border-radius: 18px;
  box-shadow: 0 0 0 1px rgba(60,45,25,.14), 0 10px 30px rgba(0,0,0,.14); font-family: var(--ui); }
.look-bar::-webkit-scrollbar { display: none; }
.look-bar b { flex: none; font-size: 13px; color: #5d5345; padding: 0 4px 0 6px; }
.look-bar button { flex: none; min-height: 40px; padding: 0 13px; border: 0; border-radius: 999px;
  background: #f2efe9; color: #1c1814; font: 600 14px/1 var(--ui); cursor: pointer; }
.look-bar button[aria-pressed="true"] { background: #1c1814; color: #fff; }
.look-bar .look-x { background: transparent; color: #786b59; font-weight: 500; }
.look-bar .look-note { flex: none; font-size: 13px; color: #9a3b33; padding: 0 6px; }
body.no-tabbar .look-bar { display: none; }
body.look-on #app { padding-bottom: calc(var(--tabbar-h) + var(--safe-b) + 84px); }`;

const isDark = () => {
  const t = document.documentElement.getAttribute('data-theme');
  return t === 'dark' || (t !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
};

let css = null;
let bar = null;

function apply(k) {
  sessionStorage.setItem('tk-lab-look', k);
  const dark = isDark();
  css.textContent = dark ? '' : (LOOKS.find((l) => l[0] === k) || LOOKS[2])[2];
  bar.querySelectorAll('[data-look]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.look === k)));
  bar.querySelector('.look-note').hidden = !dark;
}

export function startLooks() {
  if (bar) return;
  const ui = document.createElement('style');
  ui.textContent = UI;
  css = document.createElement('style');
  document.head.append(ui, css);
  bar = document.createElement('div');
  bar.className = 'look-bar';
  bar.innerHTML = `<b>配色試看</b>${LOOKS.map(([k, name]) => `<button data-look="${k}" aria-pressed="false">${k} ${name}</button>`).join('')}`
    + '<span class="look-note" hidden>深色模式看的是目前版本，請到設定切成淺色</span><button class="look-x" data-look-close>關閉</button>';
  document.body.append(bar);
  document.body.classList.add('look-on');
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-look-close')) {
      sessionStorage.removeItem('tk-lab-look');
      bar.remove(); ui.remove(); css.remove(); bar = null;
      document.body.classList.remove('look-on');
      return;
    }
    apply(b.dataset.look);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => bar && apply(sessionStorage.getItem('tk-lab-look') || '3'));
  apply(sessionStorage.getItem('tk-lab-look') || '3');
}
