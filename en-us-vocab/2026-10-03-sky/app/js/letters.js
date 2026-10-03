// 字母課程（2026-10-02）：日文版是五十音（平假名 9 課、片假名 6 課），韓文版是四十音——同一支程式，內容在 data/letters.json。
// 畫面：課程表（#/letters）、全表（#/letters/chart）、一課（#/letters/<id>：字母格點一下聽、看例字與說明）、練習（#/letters/<id>/practice）。
// 練習兩三種題型：聽音選字、看字選拼音、（片假名課）看平假名選片假名；成績存在 store.letters，八成以上算學完。
// app.js 用 setupLetters(ctx) 把共用的東西（畫面根節點、圖示、播音、字卡…）傳進來。

let C = null;          // app.js 傳進來的共用工具
let L = null;          // data/letters.json
let loading = null;
let chartTab = 0;
let prac = null;       // 進行中的練習

export function setupLetters(ctx) { C = ctx; }

export function loadLetters() {
  if (L) return Promise.resolve(L);
  if (!loading) loading = fetch('data/letters.json').then((r) => r.json()).then((d) => { L = d; return d; });
  return loading;
}

const lessons = () => L.groups.flatMap((g) => g.lessons);
const cellsOf = (l) => l.rows.flat().filter(Boolean);
const rec = (id) => (C.store.letters || {})[id] || {};
const url = (key) => `audio/${key}.mp3`;
const langAttr = () => `lang="${L.lang}"`;

// 設定頁「離線使用」整批下載用：課程與全表用到的音檔（例字是字卡本來的音檔，跟著字卡那幾列下載）
export function lettersAudio() {
  if (!L) return [];
  const keys = new Set();
  lessons().forEach((l) => cellsOf(l).forEach((c) => keys.add(c.a)));
  L.chart.tabs.forEach((t) => t.sections.forEach((s) => s.rows.flat().forEach((c) => c && keys.add(c.a))));
  return [...keys].map(url);
}

// 首頁的入口格用：學完幾課／共幾課
export function lettersProgress() {
  if (!L) return null;
  const all = lessons();
  return { done: all.filter((l) => rec(l.id).done).length, total: all.length, title: L.title, sub: L.sub,
    next: all.find((l) => !rec(l.id).done) || null };
}

function whenReady(fn) {
  if (L) return fn();
  C.$app.innerHTML = `<p class="none">載入中…</p>`;
  loadLetters().then(fn).catch(() => C.toast('課程資料載入失敗，連上網路後再試一次'));
}

/* ---------- 課程表 ---------- */
export function viewLetters() {
  whenReady(() => {
    const all = lessons();
    const next = all.find((l) => !rec(l.id).done);
    let n = 0;
    const groups = L.groups.map((g) => `
      <h2 class="group-title">${C.esc(g.title)}</h2>
      <div class="list lt-list">${g.lessons.map((l) => {
        n += 1;
        const r = rec(l.id);
        const cs = cellsOf(l);
        const preview = l.sub.includes(cs[0].ch) ? '' : cs.slice(0, 5).map((c) => C.esc(c.ch)).join(' ');   // 副標題已經列出字母時不重複
        const state = r.done ? `<span class="lt-done">${C.I.check('ico-s')}學完</span>` : l === next ? '<span class="lt-next">下一課</span>' : '';
        return `<a class="row lt-row${l === next ? ' cur' : ''}" href="#/letters/${l.id}">
          <span class="lt-n">${n}</span>
          <span class="r-main"><span class="lt-title" data-fit="14">${C.esc(l.title)}</span><span class="lt-sub" data-fit="11">${preview ? `<span ${langAttr()}>${preview}</span>　` : ''}<span ${langAttr()}>${C.esc(l.sub)}</span>${r.best != null ? `　練習 ${r.best}/${r.total}` : ''}</span></span>
          ${state}
        </a>`;
      }).join('')}</div>`).join('');
    C.$app.innerHTML = `
      <div class="topbar"><a class="icon-btn" href="#/" aria-label="回路線圖">${C.I.back()}</a><span class="title">${C.esc(L.title)}</span></div>
      <header class="lt-head"><h1 data-fit="22">${C.esc(L.title)}</h1><p>${C.esc(L.intro)}</p></header>
      <div class="lt-actions">
        ${next ? `<a class="pill" href="#/letters/${next.id}">${rec(all[0].id).best != null ? '繼續' : '開始'}：${C.esc(next.title)}</a>` : ''}
        <a class="pill ghost" href="#/letters/chart">${C.esc(L.chartTitle || '全表')}</a>
      </div>
      ${groups}`;
  });
}

/* ---------- 全表 ---------- */
export function viewLetterChart() {
  whenReady(() => {
    const tabs = L.chart.tabs;
    const t = tabs[Math.min(chartTab, tabs.length - 1)];
    const seg = tabs.length > 1 ? `<div class="seg lt-seg" role="tablist">${tabs.map((x, i) => `<button role="tab" data-lt-tab="${i}" aria-selected="${x === t}">${C.esc(x.title)}</button>`).join('')}</div>` : '';
    const sections = t.sections.map((s) => `
      <h2 class="group-title">${C.esc(s.title)}</h2>
      <div class="panel lt-chart" style="--cols:${Math.max(...s.rows.map((r) => r.length))}">${s.rows.map((row) => row.map((c) => (c
        ? `<button class="lt-cell" data-lt-say="${c.a}"><b ${langAttr()}>${C.esc(c.ch)}</b><small>${C.esc(c.roma)}</small></button>`
        : '<span class="lt-cell blank" aria-hidden="true"></span>')).join('')).join('')}</div>`).join('');
    C.$app.innerHTML = `
      <div class="topbar"><a class="icon-btn" href="#/letters" aria-label="回課程表">${C.I.back()}</a><span class="title">${C.esc(L.chartTitle || '全表')}</span></div>
      ${seg}
      <p class="lt-tip">點一下聽發音。</p>
      ${sections}`;
  });
}

/* ---------- 一課 ---------- */
export function viewLesson(id) {
  whenReady(() => {
    const all = lessons();
    const i = all.findIndex((l) => l.id === id);
    if (i < 0) return location.replace('#/letters');
    const l = all[i];
    const r = rec(id);
    const pairs = l.kind === 'pairs';
    const cols = Math.max(...l.rows.map((row) => row.length));
    let k = -1;
    const grid = l.rows.map((row) => row.map((c) => {
      if (!c) return '<span class="lt-cell blank" aria-hidden="true"></span>';
      k += 1;
      return `<button class="lt-cell${pairs ? ' word' : ''}" data-lt-say="${c.a}" data-lt-i="${k}" aria-label="${C.esc(c.ch)}（${C.esc(c.roma)}）">
        <b ${langAttr()}>${C.esc(c.ch)}</b><small>${C.esc(c.roma)}</small>${c.name ? `<small class="nm" ${langAttr()}>${C.esc(c.name)}</small>` : ''}${pairs ? `<small class="zh">${C.esc(c.zh)}</small>` : ''}
      </button>`;
    }).join('')).join('');
    const next = all[i + 1];
    C.$app.innerHTML = `
      <div class="topbar"><a class="icon-btn" href="#/letters" aria-label="回課程表">${C.I.back()}</a><span class="title">${C.esc(L.title)}・第 ${i + 1} 課</span></div>
      <header class="lt-head"><h1 data-fit="22">${C.esc(l.title)}</h1><p data-fit="12">${C.esc(l.sub)}${r.best != null ? `，練習最佳 ${r.best}/${r.total}` : ''}</p></header>
      <p class="lt-tip">${C.esc(l.tip || (pairs ? '點一下聽，比較每一組的不同。' : '點一下聽發音，下面會出現例字。'))}</p>
      <div class="panel lt-grid${pairs ? ' pairs' : ''}" style="--cols:${cols}">${grid}</div>
      <div class="lt-detail" id="lt-detail" aria-live="polite"></div>
      ${l.notes && l.notes.length ? `<div class="panel lt-notes"><h2>重點</h2><ul>${l.notes.map((x) => `<li>${C.esc(x)}</li>`).join('')}</ul></div>` : ''}
      <div class="dock"><div class="dock-inner">
        <a class="pill" href="#/letters/${l.id}/practice">練習這一課</a>
        ${next ? `<a class="pill ghost" href="#/letters/${next.id}">下一課</a>` : '<a class="pill ghost" href="#/letters">課程表</a>'}
      </div></div>`;
  });
}

function showDetail(l, idx) {
  const box = document.getElementById('lt-detail');
  const c = cellsOf(l)[idx];
  if (!box || !c) return;
  const card = c.ex ? C.card(c.ex) : null;
  const bits = [];
  if (c.syl) bits.push(`<span class="lt-syl" ${langAttr()}>${C.esc(c.syl)}</span>`);
  if (c.hint) bits.push(`<span class="lt-hint">${C.esc(c.hint)}</span>`);
  box.innerHTML = `<div class="panel lt-ex">
    <div class="lt-ex-head"><b ${langAttr()}>${C.esc(c.ch)}</b><span>${C.esc(c.roma)}${c.name ? `・<span ${langAttr()}>${C.esc(c.name)}</span>` : ''}</span>
      <button class="d-say" data-lt-say="${c.a}" aria-label="再聽一次">${C.I.speaker('ico-s')}</button></div>
    ${bits.length ? `<p class="lt-bits">${bits.join('')}</p>` : ''}
    ${card ? `<a class="lt-card" href="#/card/${card.id}"><span class="ja" ${langAttr()}>${C.rubyHTML(card.w)}</span><span class="zh">${C.esc(card.zh)}</span></a>
      <button class="say" data-say="${card.id}" data-part="w" aria-label="播放例字">${C.I.speaker()}<span>例字</span></button>` : ''}
  </div>`;
}

/* ---------- 練習 ---------- */
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function buildPractice(l) {
  const cells = cellsOf(l);
  const kata = cells.some((c) => c.hira);
  const types = l.kind === 'pairs' ? ['listen'] : kata ? ['listen', 'read', 'pair'] : ['listen', 'read'];
  const n = Math.max(8, Math.min(12, cells.length * 2));
  const order = [];
  while (order.length < n) order.push(...shuffle(cells.slice()));
  const qs = [];
  for (let i = 0; i < n; i++) {
    const c = order[i];
    const type = types[i % types.length];
    // 同音的（じ／ぢ、ず／づ）不當干擾選項；看字選拼音時拼音也不能重複。
    // 對照課（長短音、가／카／까）：同一列的對照字優先當選項，才是在考聽辨
    const row = l.kind === 'pairs' ? l.rows.find((r) => r.includes(c)) || [] : [];
    const others = shuffle(cells.filter((o) => o !== c && o.roma !== c.roma && (type !== 'pair' || o.hira !== c.hira)));
    const pool = [...row.filter((o) => o && o !== c), ...others.filter((o) => !row.includes(o))];
    const opts = shuffle([c, ...pool.slice(0, 3)]);
    qs.push({ c, type, opts, picked: null });
  }
  return { id: l.id, title: l.title, qs: shuffle(qs), i: 0, right: 0 };
}

export function viewLetterPractice(id) {
  whenReady(() => {
    const l = lessons().find((x) => x.id === id);
    if (!l) return location.replace('#/letters');
    if (!prac || prac.id !== id || prac.fresh) { prac = buildPractice(l); }
    renderPractice(l);
  });
}

function renderPractice(l) {
  if (prac.i >= prac.qs.length) return renderPracticeEnd(l);
  const q = prac.qs[prac.i];
  const answered = q.picked != null;
  const say = `<button class="listen" data-lt-say="${q.c.a}" aria-label="再聽一次">${C.I.speaker()}</button>`;
  let prompt = '';
  if (q.type === 'listen') prompt = `${say}<div class="ask">聽發音，選出${l.kind === 'pairs' ? '聽到的詞' : '這個字'}</div>`;
  else if (q.type === 'read') prompt = `<div class="lt-big" ${langAttr()}>${C.esc(q.c.ch)}</div><div class="ask">這個字怎麼念？</div>`;
  else prompt = `<div class="lt-big" ${langAttr()}>${C.esc(q.c.hira)}</div><div class="ask">選出同一個音的片假名</div>`;
  const label = (o) => (q.type === 'read' ? `<span>${C.esc(o.roma)}</span>` : `<span class="lt-opt" ${langAttr()}>${C.esc(o.ch)}</span>`);
  const tiles = q.opts.map((o, k) => {
    let cls = 'tile';
    let mark = '';
    if (answered) {
      if (o === q.c) { cls += ' right'; mark = `<span class="mark">${C.I.check('')}</span>`; }
      else if (q.picked === k) { cls += ' wrong'; mark = `<span class="mark">${C.I.cross('')}</span>`; }
      else cls += ' dim';
    }
    return `<button class="${cls}" data-lt-pick="${k}" ${answered ? 'disabled' : ''}>${label(o)}${mark}</button>`;
  }).join('');
  let sheet = '';
  if (answered && q.opts[q.picked] !== q.c) {
    sheet = `<div class="sheet ng" role="status"><div class="sheet-inner">
      <div class="sheet-head"><span class="verdict">${C.I.cross('ico')}答錯了</span></div>
      <div class="sheet-card"><span class="ja" ${langAttr()}>${C.esc(q.c.ch)}</span>${C.esc(q.c.roma)}${q.c.zh ? `　${C.esc(q.c.zh)}` : ''}</div>
      <button class="pill" data-lt-next>${prac.i === prac.qs.length - 1 ? '看結果' : '下一題'}</button>
    </div></div>`;
  }
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/letters/${l.id}" aria-label="結束練習">${C.I.close()}</a><span class="title">${C.esc(l.title)}・練習</span><span class="count">${prac.i + 1}/${prac.qs.length}</span></div>
    ${C.segsHTML(prac.qs.length, prac.i, (k) => { const a = prac.qs[k]; return a.picked == null ? '' : a.opts[a.picked] === a.c ? 'ok' : 'ng'; })}
    <div class="stage" data-lt-type="${q.type}">
      <div class="prompt">${prompt}</div>
      <div class="tiles grid" role="group" aria-label="選項">${tiles}</div>
    </div>
    ${sheet}`;
  if (!answered && q.type === 'listen') C.playFile(url(q.c.a));
}

function renderPracticeEnd(l) {
  const total = prac.qs.length, right = prac.right;
  const store = C.store;
  store.letters = store.letters || {};
  const r = store.letters[l.id] || {};
  const done = r.done || right / total >= 0.8;
  store.letters[l.id] = { best: Math.max(r.best || 0, right), total, done, at: Date.now() };
  C.save();
  prac.fresh = true;
  const all = lessons();
  const next = all[all.indexOf(l) + 1];
  const wrong = [...new Set(prac.qs.filter((q) => q.opts[q.picked] !== q.c).map((q) => q.c))];
  C.$app.innerHTML = `
    <div class="topbar"><a class="icon-btn" href="#/letters" aria-label="回課程表">${C.I.close()}</a><span class="title">${C.esc(l.title)}・練習</span></div>
    <section class="terminal">
      <div class="score">${right}<small>/${total}</small></div>
      <p>${right === total ? '全部答對！' : done ? '這一課學完了，答錯的再聽幾次。' : '答對八成就算學完，再練一次吧。'}</p>
    </section>
    ${wrong.length ? `<h2 class="group-title">答錯的字</h2><div class="panel lt-grid" style="--cols:5">${wrong.map((c) => `<button class="lt-cell" data-lt-say="${c.a}"><b ${langAttr()}>${C.esc(c.ch)}</b><small>${C.esc(c.roma)}</small></button>`).join('')}</div>` : ''}
    <div class="dock"><div class="dock-inner">
      <button class="pill ghost" data-lt-again>再練一次</button>
      ${done && next ? `<a class="pill" href="#/letters/${next.id}">下一課</a>` : `<a class="pill" href="#/letters/${l.id}">回到這一課</a>`}
    </div></div>`;
}

function pick(k) {
  const q = prac && prac.qs[prac.i];
  if (!q || q.picked != null) return;
  q.picked = k;
  const ok = q.opts[k] === q.c;
  if (ok) prac.right += 1;
  const l = lessons().find((x) => x.id === prac.id);
  renderPractice(l);
  if (q.type !== 'listen') C.playFile(url(q.c.a));   // 看字的題目：作答後念一次加深印象
  const here = location.hash;
  if (ok) setTimeout(() => { if (prac.qs[prac.i] === q && location.hash === here) { prac.i += 1; renderPractice(l); } }, 750);
}

/* ---------- 事件 ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-lt-say],[data-lt-tab],[data-lt-pick],[data-lt-next],[data-lt-again]');
  if (!el || !C) return;
  const d = el.dataset;
  if (d.ltAgain !== undefined) {   // 同一個網址，不會觸發換頁：直接重出題
    const l = lessons().find((x) => x.id === prac.id);
    prac = buildPractice(l); renderPractice(l); window.scrollTo(0, 0);
    return;
  }
  if (d.ltSay !== undefined) {
    C.playFile(url(d.ltSay), el.classList.contains('d-say') || el.classList.contains('listen') ? el : null);
    if (d.ltI !== undefined) {
      const id = (location.hash.match(/^#\/letters\/(\w+)$/) || [])[1];
      const l = id && lessons().find((x) => x.id === id);
      document.querySelectorAll('.lt-cell.on').forEach((x) => x.classList.remove('on'));
      el.classList.add('on');
      if (l) showDetail(l, +d.ltI);
    }
    return;
  }
  if (d.ltTab !== undefined) { chartTab = +d.ltTab; viewLetterChart(); return; }
  if (d.ltPick !== undefined) { pick(+d.ltPick); return; }
  if (d.ltNext !== undefined) { prac.i += 1; renderPractice(lessons().find((x) => x.id === prac.id)); }
});
document.addEventListener('keydown', (e) => {
  if (!prac || !/\/practice$/.test(location.hash)) return;
  const k = '1234'.indexOf(e.key);
  if (k >= 0) pick(k);
  if (e.key === 'Enter') { const b = document.querySelector('[data-lt-next]'); if (b) b.click(); }
});
