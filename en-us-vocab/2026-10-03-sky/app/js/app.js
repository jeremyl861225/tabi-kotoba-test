// Street Talk — 主程式：路由與各畫面（旅ことば系列「暮色玻璃」外觀；英文版 2026-10-03 從韓文版 여행말 v8 搬過來）
import { store, save, isStarred, toggleStar, markSeen, recordAnswer, unitRec, exportBackup, importBackup, resetAll } from './store.js';
import { play, playFile, stop, nextVoice, voiceName, audioUrl, cachedSet, downloadAudio } from './audio.js';
import { rubyHTML, plain, esc, normQuery } from './ruby.js';
import { buildQuiz, TYPES, TYPE_HINT, TYPE_GROUPS } from './quiz.js';
import { loadDict, searchDict, dictReady } from './dict.js';
import { initTabbar, syncTabbar } from './tabbar.js';
import { setSkyMode } from './sky.js';
import { setupLetters, loadLetters, lettersProgress, lettersAudio, viewLetters, viewLetterChart, viewLesson, viewLetterPractice } from './letters.js';

const $app = document.getElementById('app');
const $meta = document.querySelector('meta[name="theme-color"]') || (() => {
  const m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); return m;
})();
let DATA, CARDS, BYID, THEME, UNITS, UNIT, TIER;
let ctxList = null;        // 從搜尋或不熟清單點進字卡時，上一張／下一張用這個清單
let quiz = null;           // 進行中的測驗
let lastDir = '';          // 換站方向（動畫用）
let lastStop = null;       // 上一次站點位置（跑燈用）

/* ---------- 圖示（同一筆畫：2.2px 圓頭） ---------- */
const svg = (d, cls = 'ico', extra = '') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
const I = {
  back: () => svg('<path d="M15 5l-7 7 7 7"/>'),
  close: () => svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  next: (c = 'ico-s') => svg('<path d="M9 5l7 7-7 7"/>', c),
  prev: (c = 'ico-s') => svg('<path d="M15 5l-7 7 7 7"/>', c),
  star: (c = 'ico') => svg('<path d="M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>', c),
  starFill: (c = 'ico-s') => `<svg class="${c}" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 3.4l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></svg>`,
  speaker: (c = 'ico') => svg('<path d="M4 9.5h3.5L12 5.6v12.8l-4.5-3.9H4z" fill="currentColor"/><path d="M15.6 9.2a4 4 0 010 5.6M18.2 6.6a7.6 7.6 0 010 10.8"/>', c),
  search: () => svg('<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>'),
  check: (c = 'ico-s') => svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>', c, 'stroke-width="3"'),
  cross: (c = 'ico-s') => svg('<path d="M7 7l10 10M17 7L7 17"/>', c, 'stroke-width="3"'),
  go: () => svg('<path d="M5 12h13M13 6l6 6-6 6"/>', 'ico-s'),
  chev: () => svg('<path d="M6 9l6 6 6-6"/>', 'chev'),
};
// 中文說明裡夾的英文（註記常引用 Check this out!）改用英文字型
const koIn = (text) => esc(text).replace(/[A-Za-z][A-Za-z0-9'’&;#$%., !?:\-]*[A-Za-z0-9.!?$%]|[A-Za-z]/g, (m) => `<span lang="en">${m}</span>`);
const stars = (t) => `<span class="stars" role="img" aria-label="${4 - t} 顆星">${I.starFill().repeat(4 - t)}</span>`;

/* ---------- 路線色（只當點綴：底色一律米色） ---------- */
function isDark() {
  const t = store.settings.theme;
  return t === 'dark' || (t === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
}
const strokeOf = (t) => (isDark() ? t.lD : t.lL) || t.field;
const fieldVars = (t) => `--line:${t.field};--on:${t.on};--stroke:${strokeOf(t)};--bgL:${t.bgL};--bgD:${t.bgD}`;
const strokeVars = (t) => `--lL:${t.lL};--lD:${t.lD};--tL:${t.tL};--tD:${t.tD};${fieldVars(t)}`;

// 進入某一課／某一題時，把該單元的點綴色設到 body；一般畫面還原
function setField(t) {
  const b = document.body;
  if (!t) {
    b.classList.remove('lesson');
    ['--line', '--on', '--stroke', '--bgL', '--bgD'].forEach((k) => b.style.removeProperty(k));
  } else {
    b.classList.add('lesson');
    b.style.setProperty('--line', t.field);
    b.style.setProperty('--on', t.on);
    b.style.setProperty('--stroke', strokeOf(t));
    b.style.setProperty('--bgL', t.bgL);
    b.style.setProperty('--bgD', t.bgD);
  }
  $meta.content = getComputedStyle(document.documentElement).getPropertyValue('--sky-base').trim() || '#e9cbbd';
}

function unitBadge(u, sm = false) {
  const t = THEME[u.th];
  return `<span class="badge${sm ? ' sm' : ''}" style="${strokeVars(t)}" aria-hidden="true"><span class="code">${TIER[u.t].name[0]}</span><span class="no">${stnNo(u)}</span></span>`;
}
// 單字編號（照學習順序）：0001、0002…
const no4 = (c) => String(c.sq || 0).padStart(4, '0');
// 首爾地鐵式站號：線號＋兩位數（必備線第 1 站＝101）
// 一行字盡量不換行（旅ことば 2026-10-02 使用者要求，韓文版同一套）：data-fit＝最小字級；放不下就等比縮小；縮到最小也放不下，就維持原字級平均換行。
// 先全部還原、再一次量、最後一次寫，只排版一次；畫面內容一換（MutationObserver）、字型載完、轉向、展開路線時重算。
function fitText() {
  const els = [...$app.querySelectorAll('[data-fit]')];
  if (!els.length) return;
  els.forEach((el) => { el.style.fontSize = ''; el.classList.remove('fit-wrap'); });
  const m = els.map((el) => [el.clientWidth, el.scrollWidth, parseFloat(getComputedStyle(el).fontSize)]);
  els.forEach((el, i) => {
    const [w, sw, fs] = m[i];
    if (!w || sw <= w + 0.5) return;
    const min = +el.dataset.fit || 12;
    const f = Math.floor((fs * w) / sw * 4) / 4;
    if (f >= min) el.style.fontSize = f + 'px';
    else el.classList.add('fit-wrap');   // 縮到最小也放不下：維持原字級、平均換成兩行
  });
}
let fitQueued = false;
const queueFit = () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fitText(); }); } };
new MutationObserver(fitText).observe($app, { childList: true, subtree: true });
addEventListener('resize', queueFit);
document.addEventListener('toggle', queueFit, true);
if (document.fonts) { document.fonts.ready.then(queueFit); document.fonts.addEventListener('loadingdone', queueFit); }
const stnNo = (u) => `${u.t}${String(u.sn).padStart(2, '0')}`;
const stationName = (u) => `${TIER[u.t].name}線第 ${u.sn} 站`;

function starBtn(id) {
  const on = isStarred(id);
  return `<button class="star-btn" data-star="${id}" aria-pressed="${on}" aria-label="${on ? '取消不熟標記' : '標記為不熟'}">${I.star()}</button>`;
}
function sayBtn(id, part, label) {
  return `<button class="say" data-say="${id}" data-part="${part}" aria-label="播放${label}發音">${I.speaker()}<span>${label}</span><span class="v">${voiceName(nextVoice())}</span></button>`;
}

// 單字字級：依字數縮放，並保證一行放得下（放不下才在詞組邊界換行）
function wordSize(text, max = 66) {
  const n = [...text.replace(/​/g, '')].length;
  const table = n <= 2 ? max : n <= 3 ? max - 4 : n <= 4 ? max - 10 : n <= 5 ? max - 16 : max - 22;
  const avail = Math.min(window.innerWidth, 560) - 76;   // 字卡玻璃的內距
  return Math.max(24, Math.min(table, Math.floor(avail / (n * 1.04))));
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), 2200);
}

// 站點線：已過的站填滿、現在的站是一個會滑過去的圈（跑燈）
// 課程內的進度：一格一個單字（站點留給「課」）
function segsHTML(total, current, state) {
  const segs = Array.from({ length: total }, (_, i) => {
    const st = state ? state(i) : (i < current ? 'done' : i === current ? 'cur' : '');
    return `<i class="${st}"></i>`;
  }).join('');
  return `<div class="segs" aria-hidden="true">${segs}</div>`;
}

/* ---------- 路由 ---------- */
const routes = [
  [/^$/, viewHome],
  [/^unit\/([\w-]+)$/, viewUnit],
  [/^learn\/([\w-]+)\/(\d+|done)$/, viewLearn],
  [/^card\/(\w+)$/, viewCard],
  [/^browse$/, viewBrowse],
  [/^quiz$/, viewQuizSetup],
  [/^quiz\/run$/, viewQuizRun],
  [/^letters$/, viewLetters],
  [/^letters\/chart$/, viewLetterChart],
  [/^letters\/(\w+)$/, viewLesson],
  [/^letters\/(\w+)\/practice$/, viewLetterPractice],
  [/^starred$/, viewStarred],
  [/^settings$/, viewSettings],
];
const TAB_OF = { '': 'home', unit: 'home', learn: 'home', card: 'browse', browse: 'browse', quiz: 'quiz', starred: 'starred', settings: 'settings',
  letters: 'home' };
const NO_TABBAR = new Set(['unit', 'learn', 'card', 'quiz/run', 'practice']);

function currentPath() { return location.hash.replace(/^#\/?/, ''); }

function render(opts = {}) {
  const path = currentPath();
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (m) {
      const root = path.split('/')[0];
      const key = path.startsWith('quiz/run') ? 'quiz/run' : /\/practice$/.test(path) ? 'practice' : root;
      document.body.classList.toggle('no-tabbar', NO_TABBAR.has(key));
      document.querySelectorAll('.tab').forEach((a) => a.setAttribute('aria-current', a.dataset.tab === TAB_OF[root] ? 'page' : 'false'));
      if (!NO_TABBAR.has(key)) setField(null);
      syncTabbar();
      fn(...m.slice(1), opts);
      updateBadge();
      return;
    }
  }
  location.replace('#/');
}

// 在點擊事件內同步切換畫面，讓 iOS 允許接著自動播放
let renderedHash = null;
function go(hash, opts = {}) {
  if (location.hash !== hash) history.pushState(null, '', hash);
  renderedHash = location.hash;
  render(opts);
  if (!opts.keepScroll) window.scrollTo(0, 0);
}
// 返回鍵與一般連結：popstate 與 hashchange 可能都會觸發，只畫一次
function onNav() {
  if (location.hash === renderedHash) return;
  renderedHash = location.hash;
  render();
  window.scrollTo(0, 0);
}
window.addEventListener('popstate', onNav);
// 首頁三條線的收合：只記使用者自己點的（畫面產生時的 open 不算）
document.addEventListener('click', (e) => {
  const sm = e.target.closest && e.target.closest('details.tier > summary');
  if (!sm) return;
  const el = sm.parentElement;
  setTimeout(() => {
    store.home = store.home || { fam: '', open: {} };
    store.home.open = store.home.open || {};
    store.home.open[el.dataset.tier] = el.open;
    save();
  }, 0);
});
window.addEventListener('hashchange', onNav);

function updateBadge() {
  const n = Object.keys(store.starred).length;
  const b = document.querySelector('.tab[data-tab="starred"] .badge-n');
  if (b) { b.textContent = n; b.hidden = n === 0; }
}

/* ---------- 首頁：路線圖 ---------- */
const famOf = (u) => THEME[u.th].family;
// 首頁目前看的範圍：全部，或某個主題家族
function homePool() {
  const f = store.home && store.home.fam;
  return f && (DATA.families || []).some((x) => x.id === f) ? UNITS.filter((u) => famOf(u) === f) : UNITS;
}

function nextUnit(list = UNITS) {
  return list.find((u) => !unitRec(u.id).done) || list[list.length - 1];
}

function stationRow(u, nu) {
  const r = unitRec(u.id);
  const seen = u.cards.filter((id) => store.seen[id]).length;
  const state = r.done ? 'done' : u.id === nu.id ? 'cur' : seen ? 'going' : '';
  const th = THEME[u.th].name;
  return `<li class="${state}" style="${strokeVars(THEME[u.th])}"><a class="stn" href="#/unit/${u.id}" aria-label="${stationName(u)}（${stnNo(u)}）：${esc(u.title)}${u.title === th ? '' : `（${esc(th)}）`}，已學 ${seen}／${u.cards.length}${r.done ? '，已到站' : ''}">
    <span class="stn-dot" aria-hidden="true">${r.done ? I.check('') : ''}</span>
    <span class="stn-main">
      <span class="stn-name" data-fit="14">${esc(u.title)}</span>
      <span class="stn-sub"><span class="stn-no">${stnNo(u)}</span>${u.title === th ? '' : `<span>${esc(th)}</span>`}<span>${u.cards.length} 字${seen && !r.done ? `，已學 ${seen}` : ''}</span></span>
      ${seen && !r.done ? `<span class="stn-bar"><i style="--p:${(seen / u.cards.length).toFixed(3)}"></i></span>` : ''}
    </span>
    <span class="stn-meta">${r.done ? '<b class="arrived">到站</b>' : ''}${r.best != null ? `<span>測驗 ${r.best}/${r.total}</span>` : ''}</span>
  </a></li>`;
}

function viewHome() {
  const fam = homePool() === UNITS ? '' : store.home.fam;
  const pool = homePool();
  const nu = nextUnit(pool);
  const rec = unitRec(nu.id);
  const seenCount = CARDS.filter((c) => store.seen[c.id]).length;
  const doneUnits = UNITS.filter((u) => unitRec(u.id).done).length;
  const starCount = Object.keys(store.starred).length;
  const pos = Math.min(rec.pos || 0, nu.cards.length - 1);
  const firstCard = BYID[nu.cards[pos]];
  const nuSeen = nu.cards.filter((id) => store.seen[id]).length;

  // 主題家族：全部＋八個家族，3×3；色點是該家族色票的主色
  const fams = [{ id: '', name: '全部', rep: null }, ...(DATA.families || [])].map((f) => {
    const us = f.id ? UNITS.filter((u) => famOf(u) === f.id) : UNITS;
    const d = us.filter((u) => unitRec(u.id).done).length;
    return `<button class="fam" data-fam="${f.id}" aria-pressed="${fam === f.id}"${f.rep ? ` style="${strokeVars(THEME[f.rep])}"` : ''}><b data-fit="12">${f.name}</b><span>${d}／${us.length} 站</span></button>`;
  }).join('');

  // 三條線可收合；沒動過的話只展開下一站所在的那條
  const open = (store.home && store.home.open) || {};
  const tiers = DATA.tiers.map((tier) => {
    const us = pool.filter((u) => u.t === tier.id);
    if (!us.length) return '';
    const done = us.filter((u) => unitRec(u.id).done).length;
    const isOpen = open[tier.id] !== undefined ? open[tier.id] : tier.id === nu.t;
    return `<details class="tier" data-tier="${tier.id}"${isOpen ? ' open' : ''}>
      <summary class="tier-head"><span class="line-no" aria-hidden="true">${tier.id}</span><h2 id="tier-${tier.id}">${tier.name}線</h2>${stars(tier.id)}<span class="tier-n">到站 ${done}／${us.length}</span>${I.chev()}</summary>
      <ol class="route">${us.map((u) => stationRow(u, nu)).join('')}</ol>
    </details>`;
  }).join('');

  $app.innerHTML = `
    <header class="home-top">
      <h1 class="brand" lang="en">Street Talk</h1>
      <p class="home-status" data-fit="12">已學 <b>${seenCount}</b>／${CARDS.length} 字，到站 <b>${doneUnits}</b>／${UNITS.length} 站${starCount ? `，<a href="#/starred">不熟 <b>${starCount}</b> 字</a>` : ''}</p>
    </header>
    <a class="next" href="#/learn/${nu.id}/${pos}" data-autoplay style="${fieldVars(THEME[nu.th])}">
      <div class="next-head">${unitBadge(nu)}<h2 data-fit="22">${esc(nu.title)}</h2></div>
      <p class="next-sub" data-fit="12">下一站：${stationName(nu)}${nu.title === THEME[nu.th].name ? '' : `，${esc(THEME[nu.th].name)}`}</p>
      ${segsHTML(nu.cards.length, pos, (i) => (store.seen[nu.cards[i]] ? 'done' : ''))}
      <div class="next-foot"><span class="n" data-fit="12">${nuSeen ? `已學 ${nuSeen}／${nu.cards.length} 字，從 <span lang="en">${esc(plain(firstCard.w))}</span> 繼續` : `${nu.cards.length} 個單字，第一個是 <span lang="en">${esc(plain(firstCard.w))}</span>`}</span><span class="next-go">${pos ? '繼續' : '出發'}${I.go()}</span></div>
    </a>
    ${extrasHTML()}
    <div class="fams" role="group" aria-label="依主題分類">${fams}</div>
    ${tiers}`;
}

// 課程入口（2026-10-02，旅ことば的五十音同一套）：四十音
function extrasHTML() {
  return '';   // 英文版：KK 音標課程還沒做（之後放在這裡，沿用 letters.js）
  const lp = lettersProgress();
  const ls = lp ? (lp.done ? `學完 ${lp.done}／${lp.total} 課` : lp.sub) : '母音・子音・收音';
  return `<div class="extras one" role="group" aria-label="課程">
    <a class="extra" href="#/letters"><b class="ex-glyph" lang="ko">가</b><span class="ex-t"><b data-fit="13">四十音</b><small data-fit="10">${esc(ls)}</small></span></a>
  </div>`;
}

/* ---------- 路線頁（單元） ---------- */
function viewUnit(uid) {
  const u = UNIT[uid];
  if (!u) return location.replace('#/');
  const t = THEME[u.th];
  setField(t);
  const rec = unitRec(uid);
  const seen = u.cards.filter((id) => store.seen[id]).length;
  // 目前這一個＝「繼續學習」會打開的那張（還沒開始學就不標）
  const cur = seen || rec.pos ? Math.min(rec.pos || 0, u.cards.length - 1) : -1;
  const list = u.cards.map((id, i) => {
    const c = BYID[id];
    const on = store.seen[id];
    return `<a class="row word-row${on ? ' seen' : ''}${i === cur ? ' cur' : ''}" href="#/learn/${uid}/${i}" data-autoplay${i === cur ? ' aria-current="step"' : ''}>
      <span class="mk" aria-hidden="true">${on && i !== cur ? I.check('') : ''}</span>
      <span class="idx">${no4(c)}${i === cur ? '<b class="cur-tag">目前</b>' : ''}${on ? '<span class="sr-only">已學</span>' : ''}</span>
      <span class="r-main"><span class="r-w" lang="en" data-fit="15">${rubyHTML(c.w)}</span><span class="r-zh" data-fit="12">${esc(c.zh)}</span></span>
      ${starBtn(id)}
    </a>`;
  }).join('');
  $app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/" aria-label="回路線圖">${I.back()}</a><span class="title">${TIER[u.t].name}線</span></div>
    <div class="unit-head">${unitBadge(u)}<div><h1 data-fit="20">${esc(u.title)}</h1><p data-fit="12">${u.title === t.name ? '' : `${esc(t.name)}，`}${stationName(u)}，${u.cards.length} 個單字${seen ? `，已學 ${seen}` : ''}${rec.best != null ? `，測驗最佳 ${rec.best}/${rec.total}` : ''}</p></div></div>
    ${segsHTML(u.cards.length, -1, (i) => (store.seen[u.cards[i]] ? 'done' : ''))}
    <div class="list">${list}</div>
    <div class="dock"><div class="dock-inner">
      <a class="pill" href="#/learn/${uid}/${Math.min(rec.pos || 0, u.cards.length - 1)}" data-autoplay>${rec.pos ? '繼續學習' : '開始學習'}</a>
      <button class="pill ghost" data-unit-quiz="${uid}">測驗這一站</button>
    </div></div>`;
  // 目前這一個在畫面下面時捲過去（go() 會先捲回頂端，所以等下一格畫面）
  if (cur > 2) requestAnimationFrame(() => { const el = $app.querySelector('.word-row.cur'); if (el) el.scrollIntoView({ block: 'center' }); });
}

/* ---------- 字卡（學習與查詢共用） ---------- */
function cardHTML(card, opts = {}) {
  const w = plain(card.w);
  const veil = store.settings.veil && opts.learn ? ' veiled' : '';
  // 店員與廣播對旅客說的句子：例句是「旅客可以這樣回答」；旅客自己說的句子，例句就是一般用法
  const reply = card.k === 'p' && card.th === 'LS';
  const ex = card.ex ? `<div class="panel ex">
      <div class="ex-ko" lang="en">${rubyHTML(card.ex)}</div>
      <div class="ex-zh">${reply ? '<span class="ex-reply">可以這樣回答</span>' : ''}${esc(card.exz)}</div>
      ${sayBtn(card.id, 'x', reply ? '回答' : '例句')}
      ${card.note ? `<div class="note">${koIn(card.note)}</div>` : ''}
    </div>` : (card.note ? `<div class="panel"><div class="note" style="border:0;margin:0;padding:0">${koIn(card.note)}</div></div>` : '');
  return `<article class="card stage${lastDir ? ' from-' + lastDir : ''}">
    <div class="face">
    <span class="card-no" aria-label="編號 ${no4(card)}">${no4(card)}</span>
    <div class="word" lang="en" style="--hw:${wordSize(w, 96)}px">${rubyHTML(card.w)}</div>
    ${readHTML(card)}
    <p class="meaning${veil}" data-veil tabindex="0">${esc(card.zh)}</p>
    <span class="pos">${esc(card.pos || '')}</span>
    </div>
    <div class="say-row">${sayBtn(card.id, 'w', card.k === 'p' ? '整句' : '單字')}</div>
    ${ex}
    <div class="facts">${stars(card.t)}<span>${TIER[card.t].name}</span><span>實用度第 ${card.rank} 名</span>${card.n ? `<span>${card.n} 個網站收錄</span>` : ''}<span>${UNIT[card.u] ? `${stationName(UNIT[card.u])}　${esc(UNIT[card.u].title)}` : ''}</span></div>
  </article>`;
}

// 字下方：KK 音標（句子卡不標）
function pronOf(card) {
  return card.k !== 'p' && card.r ? card.r : '';
}
function readHTML(card) {
  const pr = store.settings.pron && pronOf(card) ? `<span class="pr kk" lang="en-fonipa">[${esc(pronOf(card))}]</span>` : '';
  return pr ? `<div class="read">${pr}</div>` : '';
}

function neighborBtn(c, dir, label, primary = false) {
  const cls = primary ? 'pill' : 'pill ghost';
  if (!c) return `<button class="${cls}" disabled>${label}</button>`;
  return `<button class="${cls}" data-go="${dir}" aria-label="${label}：${esc(plain(c.w))}">${dir === 'prev' ? I.prev() : ''}<span class="sub" lang="en">${esc(plain(c.w))}</span>${dir === 'next' ? I.next() : ''}</button>`;
}

function viewLearn(uid, idx, opts = {}) {
  const u = UNIT[uid];
  if (!u) return location.replace('#/');
  store.lastUnit = uid;
  if (idx === 'done') return viewArrive(u);
  const i = Math.max(0, Math.min(+idx, u.cards.length - 1));
  const card = BYID[u.cards[i]];
  setField(THEME[card.th]);
  const prev = i > 0 ? BYID[u.cards[i - 1]] : null;
  const next = i < u.cards.length - 1 ? BYID[u.cards[i + 1]] : null;
  const rec = unitRec(uid);
  rec.pos = i;
  markSeen(card.id);
  save();
  $app.innerHTML = `
    <div class="topbar">
      <a class="icon-btn" href="#/unit/${uid}" aria-label="回路線">${I.back()}</a>
      <span class="title">${esc(u.title)}</span>
      <span class="count">${i + 1}/${u.cards.length}</span>
      ${starBtn(card.id)}
    </div>
    ${segsHTML(u.cards.length, i)}
    ${cardHTML(card, { learn: true })}
    <div class="dock"><div class="dock-inner">
      ${neighborBtn(prev, 'prev', '上一站')}
      ${next ? neighborBtn(next, 'next', '下一站', true) : `<a class="pill" href="#/learn/${uid}/done">到站</a>`}
    </div></div>`;
  lastDir = '';
  $app.dataset.nav = JSON.stringify({ prev: prev ? `#/learn/${uid}/${i - 1}` : null, next: next ? `#/learn/${uid}/${i + 1}` : null });
  if (opts.autoplay && store.settings.autoplay) play(card.id, 'w', $app.querySelector('.say-row .say'));
}

function viewArrive(u) {
  const rec = unitRec(u.id);
  rec.done = true;
  rec.pos = 0;
  save();
  setField(THEME[u.th]);
  const nu = nextUnit(homePool());
  lastStop = null;
  $app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/unit/${u.id}" aria-label="回路線">${I.back()}</a><span class="title">${esc(u.title)}</span></div>
    ${segsHTML(u.cards.length, u.cards.length - 1, () => 'done')}
    <section class="terminal">
      <div class="word" lang="en" style="--hw:52px">You made it!</div>
      <p>${stationName(u)}「${esc(u.title)}」的 ${u.cards.length} 個單字都看過了。</p>
      ${nu && nu.id !== u.id ? `<p>下一站：${stationName(nu)}「${esc(nu.title)}」。</p>` : ''}
    </section>
    <div class="dock"><div class="dock-inner">
      ${nu && nu.id !== u.id ? `<a class="pill ghost" href="#/unit/${nu.id}">下一站</a>` : `<a class="pill ghost" href="#/">回路線圖</a>`}
      <button class="pill" data-unit-quiz="${u.id}">測驗這一站</button>
    </div></div>`;
  $app.dataset.nav = '{}';
}

function viewCard(id, opts = {}) {
  const card = BYID[id];
  if (!card) return location.replace('#/browse');
  let list = ctxList && ctxList.ids.includes(id) ? ctxList : null;
  if (!list) { const u = UNIT[card.u]; list = { ids: u.cards, label: u.title }; }
  const i = list.ids.indexOf(id);
  const prev = i > 0 ? BYID[list.ids[i - 1]] : null;
  const next = i < list.ids.length - 1 ? BYID[list.ids[i + 1]] : null;
  setField(THEME[card.th]);
  markSeen(id);
  $app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-back aria-label="返回">${I.back()}</button>
      <span class="title">${esc(list.label)}</span>
      <span class="count">${i + 1}/${list.ids.length}</span>
      ${starBtn(card.id)}
    </div>
    ${cardHTML(card)}
    <div class="dock"><div class="dock-inner">
      ${neighborBtn(prev, 'prev', '上一張')}
      ${neighborBtn(next, 'next', '下一張', true)}
    </div></div>`;
  lastDir = '';
  $app.dataset.nav = JSON.stringify({ prev: prev ? `#/card/${prev.id}` : null, next: next ? `#/card/${next.id}` : null });
  if (opts.autoplay && store.settings.autoplay) play(card.id, 'w', $app.querySelector('.say-row .say'));
}

/* ---------- 字卡搜尋 ---------- */
const browse = JSON.parse(sessionStorage.getItem('st-browse-test') || 'null') || { q: '', tier: 0, th: '', star: false, sort: 'rank', shown: 80 };

// 英文：寫法比對（不分大小寫、空白連字號、重音符號：pickup＝pick up、entree＝entrée）；中文：比對意思
function filterCards() {
  const q = browse.q.trim();
  let list = CARDS;
  if (browse.tier) list = list.filter((c) => c.t === browse.tier);
  if (browse.th) list = list.filter((c) => c.th === browse.th);
  if (browse.star) list = list.filter((c) => isStarred(c.id));
  if (/^\d{1,4}$/.test(q)) return list.filter((c) => c.sq === Number(q)); // 輸入編號直接找那張卡
  if (q) {
    const nq = normQuery(q);
    let hit, starts;
    if (/[a-z]/i.test(q)) {
      hit = (c) => c._ns.includes(nq);
      starts = (c) => (c._ns === nq ? 0 : c._ns.startsWith(nq) ? 1 : 2);
    } else {
      hit = (c) => c.zh.includes(q) || (c.note && c.note.includes(q));
      starts = (c) => (c.zh.startsWith(q) ? 0 : c.zh.includes(q) ? 1 : 2);
    }
    list = list.filter(hit).sort((a, b) => starts(a) - starts(b) || a.rank - b.rank);
  } else if (browse.sort === 'abc') {
    list = list.slice().sort((a, b) => a._plain.localeCompare(b._plain, 'en', { sensitivity: 'base' }));
  }
  return list;
}

function rowHTML(c) {
  return `<a class="row" href="#/card/${c.id}" data-autoplay>
    ${UNIT[c.u] ? unitBadge(UNIT[c.u], true) : ''}
    <span class="r-main"><span class="r-w" lang="en" data-fit="15">${rubyHTML(c.w)}</span><span class="r-zh" data-fit="12"><span class="r-no">${no4(c)}</span>${esc(c.zh)}</span></span>
    ${starBtn(c.id)}
  </a>`;
}

function viewBrowse() {
  const tierChips = [0, 1, 2, 3].map((t) => `<button class="chip" data-f-tier="${t}" aria-pressed="${browse.tier === t}">${t ? TIER[t].name : '全部等級'}</button>`).join('');
  const themeChips = [`<button class="chip" data-f-th="" aria-pressed="${!browse.th}">全部主題</button>`]
    .concat(DATA.themes.map((t) => `<button class="chip" data-f-th="${t.id}" aria-pressed="${browse.th === t.id}" style="${strokeVars(t)}"><span class="dot"></span>${esc(t.name)}</button>`)).join('');
  $app.innerHTML = `
    <div class="search">
      <label class="search-box">${I.search()}<input id="q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="查單字：英文、中文、編號" value="${esc(browse.q)}" aria-label="搜尋單字"></label>
      <div class="chips" role="group" aria-label="依等級篩選">${tierChips}<button class="chip" data-f-star aria-pressed="${browse.star}">${I.star('ico-s')}只看不熟</button></div>
      <div class="chips" role="group" aria-label="依主題篩選">${themeChips}</div>
    </div>
    <div id="results"></div>`;
  renderResults();
  const q = document.getElementById('q');
  let t = null;
  q.addEventListener('input', () => {
    browse.q = q.value; browse.shown = 80;
    clearTimeout(t); t = setTimeout(renderResults, 90);
  });
  loadDict().then(() => { if (browse.q.trim()) renderResults(); }).catch(() => {});
}

// 點篩選標籤：只更新選取狀態與結果清單，不重畫整頁——橫向捲動的標籤列停在原位（2026-09-25 使用者要求）
function syncBrowseChips(tapped) {
  document.querySelectorAll('[data-f-tier]').forEach((b) => b.setAttribute('aria-pressed', String(browse.tier === +b.dataset.fTier)));
  document.querySelectorAll('[data-f-th]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fTh === '' ? !browse.th : browse.th === b.dataset.fTh)));
  const s = document.querySelector('[data-f-star]');
  if (s) s.setAttribute('aria-pressed', String(!!browse.star));
  // 點到只露出一半的標籤：把列表捲到剛好完整露出
  const row = tapped && tapped.closest('.chips');
  if (row) {
    const r = tapped.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    const pad = 12;
    if (r.right > box.right - pad) row.scrollBy({ left: r.right - box.right + pad, behavior: 'smooth' });
    else if (r.left < box.left + pad) row.scrollBy({ left: r.left - box.left - pad, behavior: 'smooth' });
  }
  renderResults();
}

// 字典（字卡以外的字）
let cardForms = null;
function dictHTML(q) {
  if (!q.trim()) return '';
  if (!dictReady()) return '<div class="dict-head"><span>字典</span><span>載入中…</span></div>';
  if (!cardForms) {
    cardForms = new Set();
    for (const c of CARDS) cardForms.add(c._ns);
  }
  const hits = searchDict(q, cardForms);
  if (!hits.length) return '<div class="dict-head"><span>字典</span><span>沒有找到</span></div>';
  const rows = hits.map(({ e }) => `<div class="drow">
      <div class="d-main"><span class="d-w" lang="en">${esc(e.w)}</span>${e.k ? `<span class="d-alt kk" lang="en-fonipa">[${esc(e.k)}]</span>` : ''}${e.p ? `<span class="d-p">${esc(e.p)}</span>` : ''}</div>
      ${e.z ? `<div class="d-z">${esc(e.z)}</div>` : ''}${e.g ? `<div class="d-g" lang="en">${esc(e.g)}</div>` : ''}
      <button class="d-say" data-tts="${esc(e.w)}" aria-label="用手機語音念 ${esc(e.w)}">${I.speaker('ico-s')}</button>
    </div>`).join('');
  return `<div class="dict-head"><span>字典（字卡以外的字）</span><span>${hits.length} 筆</span></div><div class="list dict">${rows}</div>`;
}

// 字典的字沒有預錄音檔，用手機內建語音念
function speakKo(text) {
  if (!('speechSynthesis' in window)) return toast('這支手機不支援語音朗讀');
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = store.settings.rate;
  const v = speechSynthesis.getVoices().find((x) => /^en-US/i.test(x.lang));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function renderResults() {
  sessionStorage.setItem('st-browse-test', JSON.stringify(browse));
  const list = filterCards();
  ctxList = { ids: list.map((c) => c.id), label: browse.q ? `搜尋「${browse.q}」` : '字卡' };
  const el = document.getElementById('results');
  if (!el) return;
  el.innerHTML = `
    <div class="meta-row"><span>${list.length} 張字卡</span>
      ${browse.q ? '' : `<select id="sort" aria-label="排序"><option value="rank"${browse.sort === 'rank' ? ' selected' : ''}>依實用度</option><option value="abc"${browse.sort === 'abc' ? ' selected' : ''}>依字母順</option></select>`}
    </div>
    ${list.length ? `<div class="list">${list.slice(0, browse.shown).map(rowHTML).join('')}</div>` : (browse.q.trim() ? '<p class="none">字卡裡沒有這個字，看看下面的字典。</p>' : `<div class="empty"><b>沒有符合的字卡</b>換個條件試試。</div>`)}
    ${list.length > browse.shown ? `<button class="pill ghost more" data-more>再顯示 ${Math.min(120, list.length - browse.shown)} 張</button>` : ''}
    ${browse.tier || browse.th || browse.star ? '' : dictHTML(browse.q)}`;
  const sort = document.getElementById('sort');
  if (sort) sort.addEventListener('change', () => { browse.sort = sort.value; renderResults(); });
}

/* ---------- 不熟單字 ---------- */
function viewStarred() {
  const list = CARDS.filter((c) => isStarred(c.id)).sort((a, b) => a.rank - b.rank);
  ctxList = { ids: list.map((c) => c.id), label: '不熟單字' };
  $app.innerHTML = `
    <h1 class="page-title">不熟單字</h1>
    ${list.length ? `<div class="list">${list.map(rowHTML).join('')}</div>
    <div class="dock"><div class="dock-inner">
      <a class="pill ghost" href="#/card/${list[0].id}" data-autoplay>逐張複習</a>
      <button class="pill" data-star-quiz>測驗這 ${list.length} 字</button>
    </div></div>` : `<div class="empty"><b>還沒有不熟的單字</b>在字卡右上角點星號，或測驗答錯時點「不熟」，單字就會收進這裡。</div>`}`;
}

/* ---------- 測驗設定 ---------- */
const quizSetup = { scope: 'tier', tier: 1, th: '', unit: '' };

function scopeCards() {
  switch (quizSetup.scope) {
    case 'unit': return (UNIT[quizSetup.unit] || UNITS[0]).cards.map((id) => BYID[id]);
    case 'tier': return CARDS.filter((c) => c.t === quizSetup.tier);
    case 'theme': return CARDS.filter((c) => c.th === (quizSetup.th || DATA.themes[0].id));
    case 'star': return CARDS.filter((c) => isStarred(c.id));
    case 'wrong': return CARDS.filter((c) => store.stats[c.id] && store.stats[c.id][1] > 0);
    default: return CARDS;
  }
}

function viewQuizSetup() {
  if (!quizSetup.unit) quizSetup.unit = store.lastUnit && UNIT[store.lastUnit] ? store.lastUnit : UNITS[0].id;
  const S = store.settings;
  const scopes = [['tier', '依等級'], ['theme', '依主題'], ['unit', '依單元'], ['star', '不熟單字'], ['wrong', '曾答錯'], ['all', '全部']];
  let sub = '';
  if (quizSetup.scope === 'tier') sub = `<div class="wrap">${DATA.tiers.map((t) => `<button class="chip" data-qs-tier="${t.id}" aria-pressed="${quizSetup.tier === t.id}">${t.name}</button>`).join('')}</div>`;
  if (quizSetup.scope === 'theme') sub = `<div class="wrap">${DATA.themes.map((t) => `<button class="chip" data-qs-th="${t.id}" aria-pressed="${(quizSetup.th || DATA.themes[0].id) === t.id}" style="${strokeVars(t)}"><span class="dot"></span>${esc(t.name)}</button>`).join('')}</div>`;
  if (quizSetup.scope === 'unit') sub = `<div class="wrap"><select id="qs-unit" class="chip" style="width:100%;height:46px" aria-label="選擇單元">${DATA.tiers.map((t) => `<optgroup label="${t.name}">${UNITS.filter((u) => u.t === t.id).map((u) => `<option value="${u.id}"${quizSetup.unit === u.id ? ' selected' : ''}>${esc(u.title)}（${esc(THEME[u.th].name)}）</option>`).join('')}</optgroup>`).join('')}</select></div>`;
  const n = scopeCards().length;
  const counts = [10, 20, 30, 0];
  $app.innerHTML = `
    <h1 class="page-title">測驗</h1>
    <h2 class="group-title">範圍</h2>
    <div class="group">
      <div class="wrap">${scopes.map(([k, l]) => `<button class="chip" data-qs-scope="${k}" aria-pressed="${quizSetup.scope === k}">${l}</button>`).join('')}</div>
      ${sub}
      <p class="hint">這個範圍有 ${n} 個單字。</p>
    </div>
    ${TYPE_GROUPS.map(([g, ks]) => `<h2 class="group-title">題型・${g}</h2>
    <div class="group checks">
      ${ks.map((k) => `<label class="check"><input type="checkbox" data-qt="${k}" ${S.quizTypes.includes(k) ? 'checked' : ''}><span>${TYPES[k]}<span class="c-sub">${TYPE_HINT[k]}</span></span></label>`).join('')}
    </div>`).join('')}
    <h2 class="group-title">題數</h2>
    <div class="group"><div class="set"><span class="s-label">每次出幾題</span><div class="seg" role="group" aria-label="題數">${counts.map((c) => `<button data-qc="${c}" aria-pressed="${S.quizCount === c}">${c || '全部'}</button>`).join('')}</div></div></div>
    <div class="dock"><div class="dock-inner"><button class="pill" data-quiz-start ${n && S.quizTypes.length ? '' : 'disabled'}>開始測驗</button></div></div>`;
  const sel = document.getElementById('qs-unit');
  if (sel) sel.addEventListener('change', () => { quizSetup.unit = sel.value; viewQuizSetup(); });
}

function startQuiz(cards, label, meta = {}) {
  const S = store.settings;
  const count = meta.all ? cards.length : (S.quizCount || cards.length);
  quiz = { list: buildQuiz(cards, CARDS, S.quizTypes, count), i: 0, label, unit: meta.unit || null };
  if (!quiz.list.length) return toast('這個範圍沒有單字');
  lastStop = null;
  go('#/quiz/run');
}

/* ---------- 測驗進行 ---------- */
const LISTEN = new Set(['aud', 'audz', 'exl', 'dict']);

function spellHTML(q) {
  const target = q.target;
  const n = target.length;
  const avail = Math.min(window.innerWidth, 560) - 36;
  const size = Math.max(30, Math.min(50, Math.floor((avail - (n - 1) * 6) / n)));
  const answered = q.answer != null;
  const slots = target.map((want, k) => {
    const ti = q.filled[k];
    const ch = ti != null ? q.tiles[ti].ch : '';
    let cls = 'slot' + (ch ? ' filled' : '');
    if (answered) cls += ch === want ? ' ok' : ' ng';
    return `<button class="${cls}" data-slot="${k}" ${answered || !ch ? 'disabled' : ''} style="--s:${size}px" lang="en" aria-label="${ch ? `第 ${k + 1} 格 ${ch}，點一下拿回` : `第 ${k + 1} 格`}">${esc(ch)}</button>`;
  }).join('');
  const bank = q.tiles.map((t) => {
    const used = q.filled.includes(t.i);
    return `<button class="kana-tile${used ? ' used' : ''}" data-tile="${t.i}" ${used ? 'disabled aria-hidden="true"' : ''} lang="en">${esc(t.ch)}</button>`;
  }).join('');
  return `<div class="spell">
    <div class="slots" role="group" aria-label="拼出的英文">${slots}</div>
    ${answered ? '' : `<div class="bank" role="group" aria-label="字母方塊">${bank}</div>`}
  </div>`;
}

function viewQuizRun() {
  if (!quiz) return location.replace('#/quiz');
  if (quiz.i >= quiz.list.length) return viewTerminal();
  const q = quiz.list[quiz.i];
  const c = q.card;
  setField(THEME[c.th]);
  const w = plain(c.w);
  const answered = q.answer != null;
  const listenBtn = (part, label) => `<button class="listen" data-say="${c.id}" data-part="${part}" aria-label="${label}">${I.speaker()}</button>`;
  let prompt = '';
  switch (q.type) {
    case 'k2z': prompt = `<div class="word" lang="en" style="--hw:${wordSize(w, 58)}px">${esc(w)}</div><div class="ask">選出中文意思</div>`; break;
    case 'z2k': prompt = `<div class="zh">${esc(c.zh)}</div><div class="ask">選出英文</div>`; break;
    case 'pron': prompt = `<div class="word" lang="en" style="--hw:${wordSize(w, 58)}px">${esc(w)}</div><div class="ask">選出重音位置正確的 KK</div>`; break;
    case 'aud': prompt = `${listenBtn('w', '再聽一次')}<div class="ask">聽發音，選出這個字</div>`; break;
    case 'audz': prompt = `${listenBtn('w', '再聽一次')}<div class="ask">聽發音，選出中文意思</div>`; break;
    case 'exl': prompt = `${listenBtn('x', '再聽一次例句')}<div class="ask">聽例句，選出它的意思</div>`; break;
    case 'dict': prompt = `${listenBtn('w', '再聽一次')}<div class="ask">聽發音，用字母方塊拼出來</div>`; break;
    case 'spell': prompt = `<div class="zh">${esc(c.zh)}</div><div class="ask">用字母方塊拼出英文</div>`; break;
  }
  let answerArea;
  if (q.type === 'spell' || q.type === 'dict') {
    answerArea = spellHTML(q);
  } else {
    const textOf = (o) => (q.type === 'pron' ? `[${o.r}]` : (q.type === 'k2z' || q.type === 'audz') ? o.c.zh : q.type === 'exl' ? o.c.exz : null);
    // KK 選項 9 個符號以內才用兩欄
    const grid = q.type === 'pron' ? q.options.every((o) => [...o.r].length <= 9) : (q.type !== 'exl' && q.options.every((o) => (o.c ? plain(o.c.w).length <= 6 && o.c.zh.length <= 8 : true)));
    const tiles = q.options.map((o, k) => {
      const t = textOf(o);
      const text = t != null ? `<span>${esc(t)}</span>` : `<span class="ko" lang="en">${esc(plain(o.c.w))}</span>`;
      let cls = q.type === 'pron' ? 'tile pr' : q.type === 'exl' ? 'tile long' : 'tile';
      let mark = '';
      if (answered) {
        if (o.right) { cls += ' right'; mark = `<span class="mark">${I.check('')}</span>`; }
        else if (q.picked === k) { cls += ' wrong'; mark = `<span class="mark">${I.cross('')}</span>`; }
        else cls += ' dim';
      }
      return `<button class="${cls}" data-choice="${k}" ${answered ? 'disabled' : ''} ${q.type === 'pron' ? 'lang="en-fonipa"' : ''}>${text}${mark}</button>`;
    }).join('');
    answerArea = `<div class="tiles${grid ? ' grid' : ''}" role="group" aria-label="${TYPES[q.type]}">${tiles}</div>`;
  }
  let sheet = '';
  if (answered) {
    const extra = q.type === 'exl' && c.ex ? `<div class="sheet-ex" lang="en">${esc(c.ex)}</div>` : '';
    const verdict = q.answer ? '答對了' : q.picked === -1 ? '正確答案是' : '答錯了';
    sheet = `<div class="sheet ${q.answer ? 'ok' : 'ng'}" role="status"><div class="sheet-inner">
      <div class="sheet-head"><span class="verdict">${q.answer ? I.check('ico') : I.cross('ico')}${verdict}</span>
        <button class="star-inline" data-star="${c.id}" aria-pressed="${isStarred(c.id)}">${I.star('ico-s')}不熟</button></div>
      <div class="sheet-card"><span class="ko" lang="en">${rubyHTML(c.w)}</span>${pronOf(c) ? `<span class="pr kk" lang="en-fonipa">[${esc(pronOf(c))}]</span>` : ''}${esc(c.zh)}</div>
      ${extra}
      <button class="pill" data-quiz-next>${quiz.i === quiz.list.length - 1 ? '看結果' : '下一題'}</button>
    </div></div>`;
  }
  $app.innerHTML = `
    <div class="topbar">
      <button class="icon-btn" data-quiz-quit aria-label="結束測驗">${I.close()}</button>
      <span class="title">${esc(quiz.label)}</span>
      <span class="count">${quiz.i + 1}/${quiz.list.length}</span>
    </div>
    ${segsHTML(quiz.list.length, quiz.i, (k) => { const a = quiz.list[k]; return a.answer == null ? '' : a.answer ? 'ok' : 'ng'; })}
    <div class="stage${lastDir ? ' from-' + lastDir : ''}" data-qtype="${q.type}" aria-label="${LISTEN.has(q.type) ? '聽力' : q.type === 'spell' ? '拼字' : '看字'}：${TYPES[q.type]}">
      <div class="prompt">${prompt}</div>
      ${answerArea}
    </div>
    ${sheet}
    ${answered ? '' : '<div class="dock"><div class="dock-inner"><button class="pill ghost" data-quiz-skip>不知道</button></div></div>'}`;
  lastDir = '';
  if (LISTEN.has(q.type) && !answered && !q.autoplayed) {
    q.autoplayed = true;
    play(c.id, q.type === 'exl' ? 'x' : 'w', $app.querySelector('.listen'));
  }
}

function finishAnswer(q, ok) {
  q.answer = ok;
  recordAnswer(q.card.id, ok);
  viewQuizRun();
  play(q.card.id, q.type === 'exl' ? 'x' : 'w'); // 答完念一次，把字音和字連起來
}

function answerQuiz(k) {
  const q = quiz.list[quiz.i];
  if (q.answer != null) return;
  q.picked = k;
  if (q.type === 'spell' || q.type === 'dict') {
    q.filled = [];
    return finishAnswer(q, false);
  }
  finishAnswer(q, k >= 0 && q.options[k].right);
}

function spellTap(tileIdx, slotIdx) {
  const q = quiz.list[quiz.i];
  if (q.answer != null) return;
  if (slotIdx != null) {
    q.filled.splice(slotIdx, 1);
  } else if (!q.filled.includes(tileIdx) && q.filled.length < q.target.length) {
    q.filled.push(tileIdx);
  }
  if (q.filled.length === q.target.length) {
    const built = q.filled.map((i) => q.tiles[i].ch).join('');
    q.picked = built;
    return finishAnswer(q, built === q.target.join(''));
  }
  viewQuizRun();
}

function viewTerminal() {
  const right = quiz.list.filter((q) => q.answer).length;
  const total = quiz.list.length;
  if (quiz.unit) {
    const rec = unitRec(quiz.unit);
    if (rec.best == null || right / total > rec.best / rec.total) { rec.best = right; rec.total = total; }
    save();
  }
  setField(THEME.GR || DATA.themes[0]);
  const wrong = quiz.list.filter((q) => !q.answer).map((q) => q.card);
  ctxList = { ids: wrong.map((c) => c.id), label: '答錯的單字' };
  $app.innerHTML = `
    <div class="topbar"><button class="icon-btn" data-quiz-quit aria-label="離開">${I.close()}</button><span class="title">${esc(quiz.label)}</span></div>
    ${segsHTML(total, total - 1, (k) => (quiz.list[k].answer ? 'ok' : 'ng'))}
    <section class="terminal">
      <div class="word" lang="en">End of the line</div>
      <div class="score">${right}<small>/${total}</small></div>
      <p>${right === total ? '全部答對，這段路線很熟了。' : `答錯 ${wrong.length} 題，可以加星收進不熟單字。`}</p>
    </section>
    ${wrong.length ? `<div class="meta-row"><span>答錯的單字</span><button class="pill ghost small" data-star-all>全部加星</button></div>
      <div class="list">${wrong.map(rowHTML).join('')}</div>` : ''}
    <div class="dock"><div class="dock-inner">
      ${wrong.length ? '<button class="pill ghost" data-quiz-retry>重考答錯的</button>' : ''}
      <button class="pill" data-quiz-again>再考一次</button>
    </div></div>`;
}

/* ---------- 設定 ---------- */
function audioUrlsForTier(t) {
  const out = [];
  CARDS.filter((c) => !t || c.t === t).forEach((c) => {
    for (const v of ['f', 'm']) {
      out.push(audioUrl(c.id, 'w', v));
      if (c.ex) out.push(audioUrl(c.id, 'x', v));
    }
  });
  return out;
}

async function viewSettings() {
  const S = store.settings;
  const seg = (key, opts) => `<div class="seg" role="group">${opts.map(([v, l]) => `<button data-set="${key}" data-val="${v}" aria-pressed="${String(S[key]) === String(v)}">${l}</button>`).join('')}</div>`;
  const sw = (key, label) => `<label class="switch"><input type="checkbox" data-set-bool="${key}" ${S[key] ? 'checked' : ''} aria-label="${label}"><span></span></label>`;
  const mb = (bytes) => (bytes / 1048576).toFixed(bytes > 10485760 ? 0 : 1);
  const dl = DATA.tiers.map((t) => `<div class="dl" data-dl-row="${t.id}">
      <div><span class="s-label">${t.name}</span><span class="s-sub" data-dl-status="${t.id}">約 ${mb(DATA.meta.audioBytes[t.id] || 0)} MB</span></div>
      <button class="pill ghost small" data-dl="${t.id}">下載</button>
      <div class="bar" hidden><i></i></div>
    </div>`).join('');
  $app.innerHTML = `
    <h1 class="page-title">設定</h1>
    <h2 class="group-title">字卡</h2>
    <div class="group">
      <div class="set"><span class="s-label">KK 音標<span class="s-sub">在單字下方標美式發音（receipt [rɪˋsit]）</span></span>${sw('pron', 'KK 音標')}</div>
      <div class="set"><span class="s-label">先遮住中文<span class="s-sub">學習時點一下才顯示意思</span></span>${sw('veil', '先遮住中文')}</div>
    </div>
    <h2 class="group-title">發音</h2>
    <div class="group">
      <div class="set"><span class="s-label">聲音<span class="s-sub">交替：女聲、男聲輪流</span></span>${seg('voice', [['alt', '交替'], ['f', '女聲'], ['m', '男聲']])}</div>
      <div class="set"><span class="s-label">速度</span>${seg('rate', [[1, '正常'], [0.8, '稍慢'], [0.6, '慢']])}</div>
      <div class="set"><span class="s-label">換字卡時自動發音</span>${sw('autoplay', '換字卡時自動發音')}</div>
    </div>
    <h2 class="group-title">外觀</h2>
    <div class="group"><div class="set"><span class="s-label">深淺色</span>${seg('theme', [['auto', '跟隨手機'], ['light', '淺色'], ['dark', '深色']])}</div></div>
    <h2 class="group-title">離線使用</h2>
    <div class="group">
      <p class="hint">文字與字卡已存在手機裡。發音平常是聽到才下載；出國前先整批下載，沒網路也能聽。</p>
      ${dl}
    </div>
    <h2 class="group-title">學習紀錄</h2>
    <div class="group">
      <p class="hint">星號與進度只存在這支手機，換手機前先匯出備份。</p>
      <div class="wrap">
        <button class="pill ghost small" data-export>匯出備份</button>
        <label class="pill ghost small">匯入備份<input type="file" accept="application/json,.json" data-import hidden></label>
        <button class="pill ghost small" data-reset>清除紀錄</button>
      </div>
    </div>
    <h2 class="group-title">關於</h2>
    <div class="group">
      <p class="fine">共 ${CARDS.length} 張字卡，分 ${UNITS.length} 課。「實用度」是把 ${DATA.meta.sources.length} 份台灣的美式英文文章、英語學習網站的主題單字表、美國政府與業界寫給民眾的詞彙表合併，看每個字被幾個網站收錄來排名；收錄數相同時，再依一般英語語料（wordfreq）的使用頻率排序。台灣國中課本就教過的字不收，只留美國用法不同的。</p>
      <p class="fine">${esc(DATA.meta.credits || '')}</p>
      <details><summary>詞頻來源（${DATA.meta.sources.length} 份）</summary><ol class="src-list">${DATA.meta.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a></li>`).join('')}</ol></details>
      <p class="fine">資料版本 ${esc(DATA.meta.version)}</p>
    </div>`;
  try {
    const have = await cachedSet();
    const extra = await extraAudioUrls();
    [...DATA.tiers, { id: 'x' }].forEach((t) => {
      const urls = t.id === 'x' ? extra : audioUrlsForTier(t.id);
      const got = urls.filter((u) => have.has(u.replace(/^audio\//, ''))).length;
      const st = document.querySelector(`[data-dl-status="${t.id}"]`);
      if (st && got) st.textContent = got === urls.length ? `已全部下載（${urls.length} 個音檔）` : `已下載 ${got}／${urls.length}`;
      const b = document.querySelector(`[data-dl="${t.id}"]`);
      if (b && got === urls.length) { b.textContent = '已下載'; b.disabled = true; }
    });
  } catch (e) { /* 不支援快取的瀏覽器 */ }
}

function applyTheme() {
  const t = store.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  setSkyMode(isDark());   // 天空跟著深淺色：Halo（淺色）／Universe（深色）
  if (!document.body.classList.contains('lesson')) setField(null);
}

/* ---------- 事件 ---------- */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-tts],[data-tile],[data-slot],[data-star],[data-say],[data-go],[data-back],[data-veil],[data-more],[data-jump],[data-fam],[data-f-tier],[data-f-th],[data-f-star],[data-unit-quiz],[data-star-quiz],[data-qs-scope],[data-qs-tier],[data-qs-th],[data-qc],[data-quiz-start],[data-choice],[data-quiz-next],[data-quiz-skip],[data-quiz-quit],[data-quiz-retry],[data-quiz-again],[data-star-all],[data-set],[data-dl],[data-export],[data-reset],a[data-autoplay]');
  if (!el) return;
  const d = el.dataset;

  if (d.tts !== undefined) { speakKo(d.tts); return; }
  if (d.tile !== undefined) { spellTap(+d.tile, null); return; }
  if (d.slot !== undefined) { spellTap(null, +d.slot); return; }
  if (d.star !== undefined) {
    e.preventDefault(); e.stopPropagation();
    const on = toggleStar(d.star);
    document.querySelectorAll(`[data-star="${d.star}"]`).forEach((b) => { b.setAttribute('aria-pressed', on); if (b.classList.contains('star-btn')) b.setAttribute('aria-label', on ? '取消不熟標記' : '標記為不熟'); });
    updateBadge();
    toast(on ? '已加入不熟單字' : '已從不熟單字移除');
    return;
  }
  if (d.say !== undefined) {
    e.preventDefault();
    const v = play(d.say, d.part, el);
    document.querySelectorAll('.say .v').forEach((s) => { s.textContent = voiceName(nextVoice()); });
    const own = el.querySelector('.v');
    if (own && store.settings.voice === 'alt') own.textContent = voiceName(v);
    return;
  }
  if (d.go !== undefined) {
    const nav = JSON.parse($app.dataset.nav || '{}');
    if (nav[d.go]) { lastDir = d.go; go(nav[d.go], { autoplay: true }); }
    return;
  }
  if (d.back !== undefined) { if (history.length > 1) history.back(); else go('#/browse'); return; }
  if (d.veil !== undefined) { el.classList.remove('veiled'); return; }
  if (d.more !== undefined) { browse.shown += 120; renderResults(); return; }
  if (d.fam !== undefined) { store.home = store.home || { fam: '', open: {} }; store.home.fam = d.fam; save(); const y = window.scrollY; viewHome(); window.scrollTo(0, y); return; }
  if (d.jump !== undefined) { e.preventDefault(); document.getElementById(`tier-${d.jump}`).scrollIntoView({ block: 'start' }); return; }
  if (d.fTier !== undefined) { browse.tier = +d.fTier; browse.shown = 80; syncBrowseChips(el); return; }
  if (d.fTh !== undefined) { browse.th = d.fTh; browse.shown = 80; syncBrowseChips(el); return; }
  if (d.fStar !== undefined) { browse.star = !browse.star; browse.shown = 80; syncBrowseChips(el); return; }
  if (d.unitQuiz) { const u = UNIT[d.unitQuiz]; startQuiz(u.cards.map((id) => BYID[id]), u.title, { unit: u.id, all: true }); return; }
  if (d.starQuiz !== undefined) { startQuiz(CARDS.filter((c) => isStarred(c.id)), '不熟單字'); return; }
  const redrawSetup = () => { const y = window.scrollY; viewQuizSetup(); window.scrollTo(0, y); };
  if (d.qsScope) { quizSetup.scope = d.qsScope; redrawSetup(); return; }
  if (d.qsTier) { quizSetup.tier = +d.qsTier; redrawSetup(); return; }
  if (d.qsTh) { quizSetup.th = d.qsTh; redrawSetup(); return; }
  if (d.qc !== undefined) { store.settings.quizCount = +d.qc; save(); redrawSetup(); return; }
  if (d.quizStart !== undefined) {
    const labels = { tier: TIER[quizSetup.tier].name, theme: THEME[quizSetup.th || DATA.themes[0].id].name, unit: (UNIT[quizSetup.unit] || UNITS[0]).title, star: '不熟單字', wrong: '曾答錯的單字', all: '全部單字' };
    startQuiz(scopeCards(), labels[quizSetup.scope], quizSetup.scope === 'unit' ? { unit: quizSetup.unit } : {});
    return;
  }
  if (d.choice !== undefined) { answerQuiz(+d.choice); return; }
  if (d.quizSkip !== undefined) { answerQuiz(-1); return; }
  if (d.quizNext !== undefined) { quiz.i++; stop(); lastDir = 'next'; viewQuizRun(); window.scrollTo(0, 0); return; }
  if (d.quizQuit !== undefined) {
    const inProgress = quiz && quiz.i < quiz.list.length && quiz.list.some((q) => q.answer != null);
    if (inProgress && !confirm('結束這次測驗？作答紀錄會保留。')) return;
    stop();
    const back = quiz && quiz.unit ? `#/unit/${quiz.unit}` : '#/quiz';
    quiz = null; go(back); return;
  }
  if (d.quizRetry !== undefined) { const w = quiz.list.filter((q) => !q.answer).map((q) => q.card); startQuiz(w, `${quiz.label}（錯題）`, { all: true }); return; }
  if (d.quizAgain !== undefined) { const all = quiz.list.map((q) => q.card); startQuiz(all, quiz.label, { unit: quiz.unit, all: true }); return; }
  if (d.starAll !== undefined) { quiz.list.filter((q) => !q.answer).forEach((q) => toggleStar(q.card.id, true)); viewTerminal(); updateBadge(); toast('答錯的單字都加入不熟了'); return; }
  if (d.set) {
    store.settings[d.set] = d.set === 'rate' ? +d.val : d.val;
    save(); applyTheme(); viewSettings(); return;
  }
  if (d.dl) { runDownload(d.dl === 'x' ? 'x' : +d.dl, el); return; }
  if (d.export !== undefined) {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `street-talk-備份-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return;
  }
  if (d.reset !== undefined) {
    if (confirm('清除所有星號與學習進度？設定會保留。')) { resetAll(); toast('學習紀錄已清除'); viewSettings(); }
    return;
  }
  if (el.matches('a[data-autoplay]')) {
    e.preventDefault();
    go(el.getAttribute('href'), { autoplay: true });
  }
});

document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.setBool) { store.settings[el.dataset.setBool] = el.checked; save(); applyTheme(); return; }
  if (el.dataset.qt) {
    const set = new Set(store.settings.quizTypes);
    if (el.checked) set.add(el.dataset.qt); else set.delete(el.dataset.qt);
    store.settings.quizTypes = Object.keys(TYPES).filter((k) => set.has(k));
    save(); viewQuizSetup(); return;
  }
  if (el.dataset.import !== undefined && el.files && el.files[0]) {
    el.files[0].text().then((txt) => {
      if (!confirm('用這個備份取代目前的學習紀錄？')) return;
      try { importBackup(txt); applyTheme(); toast('備份已匯入'); viewSettings(); } catch (err) { toast(err.message || '檔案格式不對'); }
    });
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  const nav = $app.dataset.nav ? JSON.parse($app.dataset.nav) : {};
  if (e.key === 'ArrowRight' && nav.next) { lastDir = 'next'; go(nav.next, { autoplay: true }); }
  if (e.key === 'ArrowLeft' && nav.prev) { lastDir = 'prev'; go(nav.prev, { autoplay: true }); }
  if (quiz && currentPath() === 'quiz/run') {
    const k = '1234'.indexOf(e.key);
    if (k >= 0) answerQuiz(k);
    if (e.key === 'Enter') { const b = document.querySelector('[data-quiz-next]'); if (b) b.click(); }
  }
});

// 左右滑動換站：玻璃字卡跟著手指走，放手時超過門檻就甩出去換卡，否則彈回（旅ことば v21 同一套）
let touch = null;
document.addEventListener('touchstart', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  const t = e.touches[0];
  touch = { x: t.clientX, y: t.clientY, at: Date.now(), face: card.querySelector('.face'), lock: null };
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!touch || !touch.face) return;
  const t = e.touches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  if (touch.lock == null && Math.hypot(dx, dy) > 8) touch.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
  if (touch.lock !== 'x') return;
  touch.face.classList.remove('settle');
  touch.face.classList.add('dragging');
  touch.face.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch) return;
  const { face, lock } = touch;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  const quick = Date.now() - touch.at < 600;
  touch = null;
  const nav = $app.dataset.nav ? JSON.parse($app.dataset.nav) : {};
  const dir = dx < 0 ? 'next' : 'prev';
  const swipe = (lock === 'x' && Math.abs(dx) > 90) || (quick && Math.abs(dx) >= 60 && Math.abs(dy) <= Math.abs(dx) * 0.6);
  if (face) { face.classList.remove('dragging'); face.classList.add('settle'); }
  if (swipe && nav[dir]) {
    if (face && lock === 'x' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      face.style.transform = `translateX(${dx < 0 ? -110 : 110}vw) rotate(${dx < 0 ? -10 : 10}deg)`;
      setTimeout(() => { lastDir = dir; go(nav[dir], { autoplay: true }); }, 170);
    } else { lastDir = dir; go(nav[dir], { autoplay: true }); }
  } else if (face) face.style.transform = '';
}, { passive: true });

document.addEventListener('audio-error', () => toast('這個音檔還沒下載，連上網路後再試一次'));
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setSkyMode(isDark()); render(); });

// 課程與專欄的音檔（2026-10-02）：四十音
async function extraAudioUrls() {
  return lettersAudio();
}

async function runDownload(tier, btn) {
  const row = document.querySelector(`[data-dl-row="${tier}"]`);
  const bar = row.querySelector('.bar');
  const st = row.querySelector('[data-dl-status]');
  btn.disabled = true; btn.textContent = '下載中';
  bar.hidden = false;
  const urls = tier === 'x' ? await extraAudioUrls() : audioUrlsForTier(tier);
  const res = await downloadAudio(urls, (done, total, failed) => {
    bar.firstElementChild.style.setProperty('--p', (done / total).toFixed(4));
    st.textContent = `${done}／${total}${failed ? `（${failed} 個失敗）` : ''}`;
  });
  btn.textContent = res.failed ? '重試' : '已下載';
  btn.disabled = !res.failed;
  toast(res.failed ? `有 ${res.failed} 個音檔沒下載成功，再按一次重試` : `${tier === 'x' ? '四十音' : TIER[tier].name}的發音都存到手機了`);
}

/* ---------- 啟動 ---------- */
// 開場畫面：開場動畫（js/splash.js）跑完、資料載好才淡出；點一下立刻跳過
const splash = document.getElementById('splash');
const SPLASH_MIN = 900;
function hideSplash(now = false) {
  if (!splash || splash.classList.contains('out')) return;
  const wait = now ? 0 : Math.max(0, Math.max(SPLASH_MIN, window.__tkSplashEnd || 0) - performance.now());
  setTimeout(() => {
    splash.classList.add('out');
    document.documentElement.classList.remove('splashing');   // App 本體淡入，天空不換
    setTimeout(() => splash.remove(), 500);
  }, wait);
}
if (splash) splash.addEventListener('pointerdown', () => hideSplash(true), { once: true });

async function boot() {
  applyTheme();
  const res = await fetch('data/cards.json');
  DATA = await res.json();
  CARDS = DATA.cards;
  BYID = Object.fromEntries(CARDS.map((c) => [c.id, c]));
  THEME = Object.fromEntries(DATA.themes.map((t) => [t.id, t]));
  UNITS = DATA.units;
  UNIT = Object.fromEntries(UNITS.map((u) => [u.id, u]));
  TIER = Object.fromEntries(DATA.tiers.map((t) => [t.id, t]));
  for (const u of UNITS) for (const id of u.cards) BYID[id].u = u.id;
  for (const t of DATA.tiers) UNITS.filter((u) => u.t === t.id).forEach((u, i) => { u.sn = i + 1; });
  // 搜尋鍵：寫法、正規化後的寫法（小寫、去空白連字號與重音）
  for (const c of CARDS) {
    c._plain = plain(c.w);
    c._ns = normQuery(c._plain);
  }
  setupLetters({ $app, I, esc, rubyHTML, toast, go, segsHTML, play, playFile, store, save, card: (id) => BYID[id] });
  renderedHash = location.hash;
  initTabbar();
  render();
  hideSplash();
}

boot().catch((err) => {
  $app.innerHTML = `<div class="empty"><b>字卡資料載入失敗</b>請連上網路後重新開啟。（${esc(err.message)}）</div>`;
  hideSplash(true);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => Promise.resolve().catch(() => {}));
}
