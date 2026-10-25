// 選單畫面：標題、戰役、對戰電腦、同機雙人、連線、暫停、結算。
// 彈種卡與地圖縮圖用遊戲本身的畫法（Renderer 的方法）畫，風格一致。
import { BULLETS, BULLET_KEYS, SKILL, TYPES, COLS, ROWS } from './config.js';
import { ARENAS, CAMPAIGN, parseMap, TILE } from './maps.js';
import { Renderer, TANK_COLORS, TEAM_COLORS, tankTones } from './render.js';
import { makeRng } from './util.js';

const M = () => window.Motion;
const icon = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 進場：子元素錯開 40 ms 依序彈出
function enter(root) {
  const m = M();
  if (!m) return;
  const items = root.querySelectorAll('[data-in]');
  items.forEach((el, i) => {
    m.animate(el, { opacity: [0, 1], transform: ['translateY(14px) scale(0.97)', 'translateY(0) scale(1)'] }, { type: 'spring', stiffness: 420, damping: 30, delay: i * 0.04 })
      .then(() => { el.style.transform = ''; });
  });
}

// 小畫家：借 Renderer 的方法畫坦克與炮彈
const painter = Object.assign(Object.create(Renderer.prototype), { time: 0, recoil: new Map(), rng: makeRng(3), parts: [], fx: [] });

function drawAmmoCard(cv, key, color = 'p1') {
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 120, h = cv.clientHeight || 92;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  const S = h / 4.2;
  g.setTransform(dpr * S, 0, 0, dpr * S, 0, 0);
  const Wt = w / S, Ht = 4.2;
  // v8 白色場地：白地板＋淡接縫，上方一道白色牆（側面淺灰）
  g.fillStyle = '#E9E4DB'; g.fillRect(0, 0, Wt, Ht);
  g.fillStyle = 'rgba(190, 180, 166, 0.6)';
  for (let x = 2; x < Wt; x += 2) g.fillRect(x - 0.01, 0, 0.02, Ht);
  for (let y = 2; y < Ht; y += 2) g.fillRect(0, y - 0.01, Wt, 0.02);
  g.fillStyle = '#D9D2C8'; g.fillRect(0, 0, Wt, 0.32);
  g.fillStyle = '#FBF8F3'; g.fillRect(0, 0, Wt, 0.22);
  const B = BULLETS[key];
  const t = { x: 0.9, y: 2.6, body: 0, turret: -0.55, color, bullet: key, odo: 0, moving: 0, id: -1 };
  // 瞄準點線跟遊戲裡一樣用隊色（1P 藍、2P 紅）
  const dotC = color === 'p1' ? TEAM_COLORS.A : color === 'p2' ? TEAM_COLORS.B : tankTones(color).line;
  // 路徑（點線）
  const pts = [];
  const ang = { standard: -0.55, rocket: -0.08, ricochet: -0.62, scatter: -0.2, blast: -0.3 }[key];
  t.turret = ang;
  if (key === 'scatter') {
    for (const da of [-B.spread, 0, B.spread]) pts.push([{ x: 1.4, y: 2.6 + Math.tan(ang) * 0.5 }, { x: 1.4 + Math.cos(ang + da) * 2.2, y: 2.6 + Math.sin(ang + da) * 2.2 }]);
  } else {
    // 在上下牆（y=0.32、y=4.2）之間反彈
    let x = 0.9 + Math.cos(ang) * 0.6, y = 2.6 + Math.sin(ang) * 0.6, vx = Math.cos(ang), vy = Math.sin(ang);
    const line = [{ x, y }];
    let bounces = 0;
    for (let i = 0; i < 600; i++) {
      x += vx * 0.02; y += vy * 0.02;
      if (y < 0.45 || y > Ht - 0.12) { vy = -vy; bounces++; line.push({ x, y }); if (bounces > B.bounce) break; }
      if (x > Wt - (key === 'blast' ? 0.75 : 0.2)) { line.push({ x, y }); break; }   // 爆裂彈的爆炸不要被卡片邊緣切掉
    }
    if (line.length === 1 || line[line.length - 1].x !== x) line.push({ x, y });
    pts.push(line);
  }
  for (const line of pts) {
    g.fillStyle = dotC; g.globalAlpha = 0.7;
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1], L = Math.hypot(b.x - a.x, b.y - a.y);
      for (let s = 0; s < L; s += 0.24) { g.beginPath(); g.arc(a.x + (b.x - a.x) * s / L, a.y + (b.y - a.y) * s / L, 0.05, 0, 6.28); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  if (key === 'blast') {
    const e = pts[0][pts[0].length - 1];
    g.fillStyle = 'rgba(240, 114, 60, 0.85)'; g.beginPath(); g.arc(e.x, e.y + 0.1, 0.55, 0, 6.28); g.fill();
    g.fillStyle = '#FFB347'; g.beginPath(); g.arc(e.x - 0.06, e.y + 0.04, 0.38, 0, 6.28); g.fill();
    g.fillStyle = '#FFE48A'; g.beginPath(); g.arc(e.x - 0.1, e.y, 0.18, 0, 6.28); g.fill();
  }
  painter.drawTankShadow.call({ ...painter, showRings: false, ghostVis: () => 1 }, g, t);
  painter.drawTank(g, t, 0);
  // 炮彈示意
  const line = pts[0];
  const mid = line[Math.min(1, line.length - 1)];
  const a0 = line[0];
  const b = { x: (a0.x + mid.x) / 2 + 0.3, y: (a0.y + mid.y) / 2 + 0.22, vx: mid.x - a0.x, vy: mid.y - a0.y, r: B.r, type: key };
  const L = Math.hypot(b.vx, b.vy) || 1; b.vx /= L; b.vy /= L;
  if (key !== 'blast') painter.drawShell(g, b, 0);
}

export function drawMapThumb(cv, def) {
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 120, h = cv.clientHeight || 88;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  const m = parseMap(def);
  const S = Math.min(w / (COLS + 1), h / (ROWS + 1));
  g.setTransform(dpr * S, 0, 0, dpr * S, dpr * (w - COLS * S) / 2, dpr * (h - ROWS * S) / 2);
  // v8 白色場地縮圖
  g.fillStyle = '#CEC7BE'; g.fillRect(-0.5, -0.5, COLS + 1, ROWS + 1);
  g.fillStyle = '#E9E4DB'; g.fillRect(0, 0, COLS, ROWS);
  g.fillStyle = 'rgba(110, 100, 160, 0.22)';
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) { const v = m.grid[y * COLS + x]; if (v === TILE.WALL || v === TILE.TALL || v === TILE.CORK) g.fillRect(x + 0.35, y + 0.35, 1, 1); }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const v = m.grid[y * COLS + x];
    if (v === TILE.WALL || v === TILE.TALL) { g.fillStyle = v === TILE.TALL ? '#C9C1B6' : '#D9D2C8'; g.fillRect(x, y, 1, 1); g.fillStyle = v === TILE.TALL ? '#FFFEFB' : '#FBF8F3'; g.fillRect(x, y - 0.15, 1, 0.9); }
    else if (v === TILE.CORK) { g.fillStyle = '#D6BCA4'; g.fillRect(x, y, 1, 1); g.fillStyle = '#EED8C4'; g.fillRect(x, y - 0.15, 1, 0.9); }
    else if (v === TILE.HOLE) { g.fillStyle = '#857D9A'; g.fillRect(x + 0.06, y + 0.06, 0.88, 0.88); }
  }
  // 出生點：隊色實心圓（戰役玩家藍、敵人＝種類色＋紅圈）
  const cols = ['A', 'B', 'C', 'D'];
  const isCamp = m.enemies.length > 0;
  m.players.forEach((p, i) => { if (isCamp && i > 0) return; g.fillStyle = TEAM_COLORS[cols[i]]; g.beginPath(); g.arc(p.x, p.y, 0.55, 0, 6.28); g.fill(); });
  for (const e of m.enemies) {
    g.fillStyle = TANK_COLORS[e.type]; g.beginPath(); g.arc(e.x, e.y, 0.5, 0, 6.28); g.fill();
    g.strokeStyle = TEAM_COLORS.B; g.lineWidth = 0.18; g.stroke();
  }
}

export class UI {
  constructor(root, act) {
    this.root = root;
    this.act = act;
    this.state = {
      versus: { arena: 'cross', rule: 'ffa', cpu: 2, skill: 'normal', rounds: 3, bullet: 'standard' },
      duo: { mode: 'versus', arena: 'cross', cpu: 0, skill: 'normal', rounds: 3, bullets: ['standard', 'ricochet'] },
      campaign: { bullet: 'standard', from: 0, lives: 3 },
    };
  }

  clear() { this.root.innerHTML = ''; this.cur = null; }

  mount(html, cls = '') {
    this.root.innerHTML = `<div class="screen ${cls}">${html}</div>`;
    const el = this.root.firstElementChild;
    this.cur = el;
    el.addEventListener('click', (e) => { if (e.target.closest('button')) this.act.tap(); });
    enter(el);
    return el;
  }

  // ---- 標題 ----
  title({ best = 0 } = {}) {
    const el = this.mount(`
      <div class="title-wrap">
        <div class="logo" data-in>
          <h1>跳彈坦克</h1>
          <div class="en">RICOCHET TANKS</div>
          <div class="tag">炮彈會反彈。算好角度，繞過牆打中對手。</div>
        </div>
        <div class="menu">
          <button class="mbtn glass primary" data-go="campaign" data-in><span class="ic">${icon('flag')}</span><span><b>戰役</b><small>${best > 0 ? `20 關・最高到第 ${best + 1} 關` : '20 關・一關比一關聰明'}</small></span></button>
          <button class="mbtn glass sheen" data-go="versus" data-in><span class="ic">${icon('cpu')}</span><span><b>對戰電腦</b><small>選地圖、規則、1–3 台電腦</small></span></button>
          <button class="mbtn glass sheen" data-go="duo" data-in><span class="ic">${icon('users')}</span><span><b>同機雙人</b><small>一台裝置、左右各一人（也可接手把）</small></span></button>
          <button class="mbtn glass sheen" data-go="online" data-in><span class="ic">${icon('wifi')}</span><span><b>連線對戰</b><small>開房間、用房號找朋友</small></span></button>
          <button class="mbtn glass" data-go="settings" data-in style="padding:8px 14px 8px 10px;align-self:flex-start"><span class="ic" style="width:30px;height:30px">${icon('gear')}</span><span><b style="font-size:14px">設定</b></span></button>
        </div>
      </div>`, 'title');
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const go = b.dataset.go;
      if (go === 'campaign') this.campaign({ best });
      else if (go === 'versus') this.versus();
      else if (go === 'duo') this.duo();
      else if (go === 'online') this.act.openOnline();
      else if (go === 'settings') this.settings(() => this.title({ best }));
    }));
  }

  head(title, back) {
    return `<div class="head" data-in><button class="iconbtn glass press" data-back aria-label="返回">${icon('back')}</button><h3>${title}</h3></div>`;
  }
  wireBack(el, fn) { const b = el.querySelector('[data-back]'); if (b) b.addEventListener('click', fn); }

  seg(name, opts, cur) {
    return `<div class="seg glass" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  }
  wireSegs(el, obj, onChange) {
    el.querySelectorAll('[data-seg]').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const v = b.dataset.v;
      obj[s.dataset.seg] = isNaN(+v) ? v : +v;
      onChange && onChange(s.dataset.seg);
    }));
  }

  ammoCards(cur, color = 'p1', name = 'bullet') {
    return `<div class="ammo" data-ammo="${name}">${BULLET_KEYS.map((k) => {
      const B = BULLETS[k];
      const bar = (lab, v, max) => `<em>${lab}</em><span><i style="width:${(v / max) * 100}%"></i></span>`;
      return `<button class="card glass ${k === cur ? 'on' : ''}" data-k="${k}" data-in><canvas data-ammo-cv="${k}" data-color="${color}"></canvas><b>${B.name}</b><small>${B.desc}</small>
        <div class="bars">${bar('速度', B.stats.speed, 3)}${bar('反彈', B.stats.bounce, 3)}${bar('彈數', B.stats.count, 3)}</div></button>`;
    }).join('')}</div>`;
  }
  wireAmmo(el, obj, key = 'bullet') {
    el.querySelectorAll('[data-ammo]').forEach((wrap) => {
      wrap.addEventListener('click', (e) => {
        const c = e.target.closest('.card'); if (!c) return;
        wrap.querySelectorAll('.card').forEach((x) => x.classList.toggle('on', x === c));
        const name = wrap.dataset.ammo;
        if (/^b\d$/.test(name)) obj.bullets[+name.slice(1)] = c.dataset.k;   // 同機雙人：b0、b1
        else obj[key] = c.dataset.k;
        this.act.select();
      });
    });
    requestAnimationFrame(() => el.querySelectorAll('[data-ammo-cv]').forEach((cv) => drawAmmoCard(cv, cv.dataset.ammoCv, cv.dataset.color)));
  }

  // ---- 戰役 ----
  campaign({ best = 0 } = {}) {
    const s = this.state.campaign;
    s.from = Math.min(s.from, best);
    const fromOpts = [[0, '第 1 關']];
    for (let i = 5; i <= best; i += 5) fromOpts.push([i, `第 ${i + 1} 關`]);
    if (best > 0 && !fromOpts.some(([v]) => v === best)) fromOpts.push([best, `第 ${best + 1} 關`]);
    const el = this.mount(`<div class="panel glass">
      ${this.head('戰役：選彈種')}
      ${this.ammoCards(s.bullet)}
      <div class="row" style="margin-top:12px" data-in>
        ${this.seg('lives', [[3, '3 條命'], [5, '5 條命'], [9, '9 條命']], s.lives)}
        ${fromOpts.length > 1 ? this.seg('from', fromOpts, s.from) : ''}
      </div>
      <div class="foot" data-in><span class="note">每過五關多一條命；死掉重來時，打掉的敵人不會回來。</span><button class="go" data-start>${icon('play')}出發</button></div>
    </div>`, 'dim');
    this.wireBack(el, () => this.title({ best }));
    this.wireSegs(el, s);
    this.wireAmmo(el, s);
    el.querySelector('[data-start]').addEventListener('click', () => this.act.startCampaign({ bullet: s.bullet, level: s.from, lives: s.lives, players: 1 }));
  }

  // ---- 對戰電腦 ----
  versus(step = 1) {
    const s = this.state.versus;
    if (step === 1) {
      const el = this.mount(`<div class="panel glass">
        ${this.head('對戰電腦：場地與規則')}
        <div class="maps" data-in>${ARENAS.map((a) => `<button class="mapcard glass ${a.id === s.arena ? 'on' : ''}" data-map="${a.id}"><canvas data-thumb="${a.id}"></canvas><b>${a.name}</b></button>`).join('')}</div>
        <div class="row" style="margin-top:12px" data-in>
          ${this.seg('rule', [['ffa', '大亂鬥'], ['team', '2 對 2']], s.rule)}
          ${this.seg('cpu', [[1, '1 台'], [2, '2 台'], [3, '3 台']], s.cpu)}
          ${this.seg('skill', Object.entries(SKILL).map(([k, v]) => [k, v.label]), s.skill)}
          ${this.seg('rounds', [[3, '先贏 3'], [5, '先贏 5'], [7, '先贏 7']], s.rounds)}
        </div>
        <div class="foot" data-in><span class="note" data-note></span><button class="go" data-next>下一步</button></div>
      </div>`, 'dim');
      const note = () => { el.querySelector('[data-note]').textContent = s.rule === 'team' ? '你和 1 台電腦一隊，對上 2 台電腦（隊友也打得到，小心）' : `你對上 ${s.cpu} 台電腦，最後還活著的贏這回合`; };
      note();
      this.wireBack(el, () => this.title({ best: this.act.best() }));
      this.wireSegs(el, s, (k) => {
        if (k === 'rule' && s.rule === 'team') { s.cpu = 3; el.querySelector('[data-seg="cpu"]').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === '3')); }
        note();
      });
      el.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => { s.arena = b.dataset.map; el.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('on', x === b)); }));
      requestAnimationFrame(() => el.querySelectorAll('[data-thumb]').forEach((cv) => drawMapThumb(cv, ARENAS.find((a) => a.id === cv.dataset.thumb))));
      el.querySelector('[data-next]').addEventListener('click', () => this.versus(2));
      return;
    }
    const el = this.mount(`<div class="panel glass">
      ${this.head('對戰電腦：選彈種')}
      ${this.ammoCards(s.bullet)}
      <div class="foot" data-in><span class="note">電腦各自隨機拿一種彈。</span><button class="go" data-start>${icon('play')}開戰</button></div>
    </div>`, 'dim');
    this.wireBack(el, () => this.versus(1));
    this.wireAmmo(el, s);
    el.querySelector('[data-start]').addEventListener('click', () => this.act.startVersus({ ...s, cpu: s.rule === 'team' ? 3 : s.cpu }));
  }

  // ---- 同機雙人 ----
  duo(step = 1) {
    const s = this.state.duo;
    if (step === 1) {
      const el = this.mount(`<div class="panel glass">
        ${this.head('同機雙人')}
        <div data-in>${this.seg('mode', [['versus', '互相對戰'], ['coop', '合作戰役']], s.mode)}</div>
        <div data-vs>
          <div class="maps" style="margin-top:12px" data-in>${ARENAS.map((a) => `<button class="mapcard glass ${a.id === s.arena ? 'on' : ''}" data-map="${a.id}"><canvas data-thumb="${a.id}"></canvas><b>${a.name}</b></button>`).join('')}</div>
          <div class="row" style="margin-top:12px" data-in>
            ${this.seg('cpu', [[0, '不加電腦'], [1, '+1 台'], [2, '+2 台']], s.cpu)}
            ${this.seg('rounds', [[3, '先贏 3'], [5, '先贏 5'], [7, '先贏 7']], s.rounds)}
          </div>
        </div>
        <div class="foot" data-in><span class="note">1P 用左邊、2P 用右邊；接上手把會自動對應。</span><button class="go" data-next>下一步</button></div>
      </div>`, 'dim');
      const sync = () => { el.querySelector('[data-vs]').hidden = s.mode !== 'versus'; };
      sync();
      this.wireBack(el, () => this.title({ best: this.act.best() }));
      this.wireSegs(el, s, sync);
      el.querySelectorAll('[data-map]').forEach((b) => b.addEventListener('click', () => { s.arena = b.dataset.map; el.querySelectorAll('[data-map]').forEach((x) => x.classList.toggle('on', x === b)); }));
      requestAnimationFrame(() => el.querySelectorAll('[data-thumb]').forEach((cv) => drawMapThumb(cv, ARENAS.find((a) => a.id === cv.dataset.thumb))));
      el.querySelector('[data-next]').addEventListener('click', () => this.duo(2));
      return;
    }
    const el = this.mount(`<div class="panel glass duo-pick">
      ${this.head('各自選彈種')}
      <div class="who" data-in><i class="tankdot" style="background:${TANK_COLORS.p1}"></i>1P</div>
      ${this.ammoCards(s.bullets[0], 'p1', 'b0')}
      <div class="who" style="margin-top:12px" data-in><i class="tankdot" style="background:${TANK_COLORS.p2}"></i>2P</div>
      ${this.ammoCards(s.bullets[1], 'p2', 'b1')}
      <div class="foot" data-in><button class="go" data-start>${icon('play')}開始</button></div>
    </div>`, 'dim');
    this.wireBack(el, () => this.duo(1));
    this.wireAmmo(el, s);
    el.querySelector('[data-start]').addEventListener('click', () => this.act.startDuo({ ...s }));
  }

  // ---- 設定 ----
  settings(back) {
    const st = this.act.settings();
    // 不能用 <label> 包：點「關」時瀏覽器會再幫忙點一次第一個按鈕（開）
    const sw = (k, label) => `<div class="switch"><span>${label}</span>${this.seg(k, [[1, '開'], [0, '關']], st[k] ? 1 : 0)}</div>`;
    const el = this.mount(`<div class="panel glass" style="min-width:340px">
      ${this.head('設定')}
      <div data-in>
        ${sw('sound', '音效')}
        ${sw('haptics', '震動回饋（iPhone App）')}
        ${sw('aimGuide', '瞄準虛線（顯示第一次反彈）')}
      </div>
    </div>`, 'dim');
    this.wireBack(el, back);
    const obj = {};
    this.wireSegs(el, obj, (k) => this.act.setSetting(k, !!obj[k]));
  }

  // ---- 暫停 ----
  pause({ online = false } = {}) {
    const el = this.mount(`<div class="panel glass" style="min-width:300px">
      <div class="head" data-in><h3>${online ? '選單（比賽沒有暫停）' : '暫停'}</h3></div>
      <div class="menu">
        <button class="mbtn glass primary" data-a="resume" data-in><span class="ic">${icon('play')}</span><span><b>繼續</b></span></button>
        ${online ? '' : `<button class="mbtn glass" data-a="restart" data-in><span class="ic">${icon('retry')}</span><span><b>重新開始</b></span></button>`}
        <button class="mbtn glass" data-a="settings" data-in><span class="ic">${icon('gear')}</span><span><b>設定</b></span></button>
        <button class="mbtn glass" data-a="quit" data-in><span class="ic">${icon('home')}</span><span><b>回主選單</b></span></button>
      </div>
    </div>`, 'dim');
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'settings') this.settings(() => this.pause({ online }));
      else this.act[a]();
    }));
  }

  // ---- 結算 ----
  result(r) {
    const tally = (kills) => Object.entries(kills || {}).filter(([, n]) => n > 0).map(([type, n]) => `<div class="glass"><i class="tankdot" style="background:${TANK_COLORS[type]}"></i><span>${TYPES[type] ? TYPES[type].name.slice(0, 2) : type}</span><b style="margin-left:auto">${n}</b></div>`).join('');
    let body = '';
    if (r.mode === 'campaign') {
      const total = Object.values(r.kills || {}).reduce((a, b) => a + b, 0);
      body = `<div class="head" data-in><h3>${r.won ? '全部破關！' : '遊戲結束'}</h3></div>
        <div class="stat-row" data-in>
          <div><div class="big">${r.cleared}</div><small>過了幾關</small></div>
          <div><div class="big">${total}</div><small>擊毀敵方坦克</small></div>
          ${r.best != null ? `<div><div class="big">${r.best + 1}</div><small>最高到第幾關</small></div>` : ''}
        </div>
        ${total ? `<div class="label" data-in>擊毀紀錄</div><div class="tally" data-in>${tally(r.kills)}</div>` : ''}`;
    } else {
      body = `<div class="head" data-in><h3>${esc(r.title)}</h3></div>
        <div class="people" data-in>${r.rows.map((x) => `<div class="glass"><i class="tankdot" style="background:${x.hex || TANK_COLORS[x.color]}"></i>${esc(x.name)}${x.win ? `<svg class="i" style="color:var(--gold)"><use href="#i-crown"/></svg>` : ''}<span class="tag num">贏 ${x.score} 回合</span></div>`).join('')}</div>`;
    }
    const el = this.mount(`<div class="panel glass result" style="min-width:340px">
      ${body}
      <div class="foot" data-in>
        <button class="go ghost" data-a="quit">${icon('home')}主選單</button>
        <button class="go" data-a="again">${icon('retry')}${r.mode === 'campaign' && !r.won ? '再挑戰' : '再玩一次'}</button>
      </div>
    </div>`, 'dim');
    el.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => this.act[b.dataset.a === 'again' ? 'again' : 'quit']()));
  }
}

export { CAMPAIGN };
