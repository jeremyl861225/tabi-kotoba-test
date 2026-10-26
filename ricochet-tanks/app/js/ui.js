// 選單畫面：標題、戰役、對戰電腦、連線、暫停、結算。
// 彈種卡與地圖縮圖用遊戲本身的畫法（Renderer 的方法）畫，風格一致。
import { BULLETS, BULLET_KEYS, SKILL, TYPES, TYPE_KEYS, COLS, ROWS } from './config.js';
import { ARENAS, CAMPAIGN, parseMap, TILE } from './maps.js';
import * as MAPS from './maps.js';
import { Renderer, TANK_COLORS, TEAM_COLORS, tankTones } from './render.js';
import { makeRng } from './util.js';
import { bulletSvg } from './icons.js';

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
    else if (v === TILE.HOLE) { g.fillStyle = '#3B4260'; g.fillRect(x + 0.06, y + 0.06, 0.88, 0.88); }
    else if (v === TILE.ICE) { g.fillStyle = '#DDEBF5'; g.fillRect(x, y, 1, 1); }
    else if (v === TILE.BUSH) { g.fillStyle = '#9ED39C'; g.beginPath(); g.arc(x + 0.5, y + 0.45, 0.56, 0, 6.28); g.fill(); }
    else if (v === TILE.BARREL) { g.fillStyle = '#F4A35E'; g.beginPath(); g.arc(x + 0.5, y + 0.4, 0.42, 0, 6.28); g.fill(); g.fillStyle = '#F6C64E'; g.fillRect(x + 0.2, y + 0.5, 0.6, 0.12); }
    else if (v === TILE.PORTAL) { g.fillStyle = '#FFFFFF'; g.beginPath(); g.arc(x + 0.5, y + 0.5, 0.42, 0, 6.28); g.fill(); g.strokeStyle = pairIndex(m.links, y * COLS + x) % 2 ? '#5E3A5E' : '#2BB2CB'; g.lineWidth = 0.16; g.stroke(); }
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

function pairIndex(L, i) { const a = Math.min(i, L[i]); let n = 0; for (let k = 0; k < a; k++) if (L[k] > k) n++; return n; }

// 章節（maps.js 沒有定義時，每 10 關一章）
export function chapterList() {
  if (MAPS.CHAPTERS && MAPS.CHAPTERS.length) return MAPS.CHAPTERS;
  const out = [];
  for (let i = 0; i < CAMPAIGN.length; i += 10) out.push({ name: `第 ${out.length + 1} 章`, short: `第 ${out.length + 1} 章`, desc: '', from: i, to: Math.min(CAMPAIGN.length, i + 10) });
  return out;
}
const isBoss = (def) => def.rows.some((r) => r.includes('m'));

// 一台坦克的卡片圖（圖鑑、結算、新發現）：地板底＋坦克；沒遇過的畫成剪影
export function drawTankCard(cv, key, { unseen = false, zoom = 1 } = {}) {
  const dpr = Math.max(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth || 80, h = cv.clientHeight || 70;
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
  const g = cv.getContext('2d');
  const S = (h / 1.9) * zoom;
  const Wt = w / S, Ht = h / S;
  const ty = TYPES[key] || {};
  const t = { x: Wt / 2 - 0.05, y: Ht / 2 + 0.12, body: -0.5, turret: -0.95, color: TYPES[key] ? key : 'p1', bullet: ty.bullet || 'standard', odo: 0.03, moving: 0, id: -1, shape: ty.shape || 'std', hp: ty.hp || 1, maxHp: ty.hp || 1, kind: 'cpu' };
  g.setTransform(dpr * S, 0, 0, dpr * S, 0, 0);
  if (unseen) {
    painter.drawTank(g, t, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#C3CAD8'; g.fillRect(0, 0, Wt, Ht);
    g.globalCompositeOperation = 'destination-over';
  } else {
    g.globalCompositeOperation = 'source-over';
    painter.drawTankShadow(g, t);
    painter.drawTank(g, t, 0);
    g.globalCompositeOperation = 'destination-over';
  }
  g.fillStyle = 'rgba(190, 180, 166, 0.5)';
  for (let x = 1; x < Wt; x += 1) g.fillRect(x - 0.008, 0, 0.016, Ht);
  for (let y = 1; y < Ht; y += 1) g.fillRect(0, y - 0.008, Wt, 0.016);
  g.fillStyle = '#E9E4DB'; g.fillRect(0, 0, Wt, Ht);
  g.globalCompositeOperation = 'source-over';
  if (unseen) { g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#8790AB'; g.font = `800 ${Math.round(h * 0.28)}px Geist, -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('?', w / 2, h / 2); }
}

// 圖鑑的稀有度
// v13：稀有度也用色票——稀有＝青、精英＝梅紫、頭目＝黃
const RARITY = { common: { name: '普通', c: '#C3CAD8' }, rare: { name: '稀有', c: '#2BB2CB' }, elite: { name: '精英', c: '#5E3A5E' }, boss: { name: '頭目', c: '#F8C21A' } };
const rarityOf = (k) => (k === 'commander' ? 'boss' : ['violet', 'white', 'black'].includes(k) ? 'elite' : ['pink', 'green', 'bomber', 'heavy'].includes(k) ? 'rare' : 'common');

// 圖鑑的數值條（0–1）
function dexStats(ty) {
  const c = (v) => Math.max(0.06, Math.min(1, v));
  return [
    ['速度', ty.speed ? c(ty.speed / 2.7) : 0.04],
    ['火力', c((ty.max / ty.reload) / 3.2)],
    ['準度', c(((0.1 - ty.err) / 0.09) * 0.7 + Math.min(1, ((ty.scan || 0) + (ty.aimB || 0) * 30) / 150) * 0.3)],
    ['閃躲', c(ty.dodge || 0.04)],
    ['裝甲', c((ty.hp || 1) / 3)],
  ];
}

export class UI {
  constructor(root, act) {
    this.root = root;
    this.act = act;
    this.state = {
      versus: { arena: 'cross', rule: 'ffa', cpu: 2, skill: 'normal', rounds: 3, bullet: 'standard' },
      campaign: { bullet: 'standard', from: 0, lives: 3, chapter: 0 },
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
          <button class="mbtn glass primary" data-go="campaign" data-in><span class="ic">${icon('flag')}</span><span><b>戰役</b><small>${best > 0 ? `${CAMPAIGN.length} 關・最高到第 ${best + 1} 關` : `${chapterList().length} 章 ${CAMPAIGN.length} 關・冰原、傳送門、草叢、炸藥桶`}</small></span></button>
          <button class="mbtn glass sheen" data-go="versus" data-in><span class="ic">${icon('cpu')}</span><span><b>對戰電腦</b><small>選地圖、規則、1–3 台電腦</small></span></button>
          <button class="mbtn glass sheen" data-go="online" data-in><span class="ic">${icon('wifi')}</span><span><b>連線對戰</b><small>開房間、用房號找朋友</small></span></button>
          <div class="small-row" data-in>
            <button class="mbtn glass" data-go="dex"><span class="ic">${icon('book')}</span><span><b>坦克圖鑑</b></span><span class="dexprog" style="margin-left:auto">${this.dexCount()}/${TYPE_KEYS.length}</span></button>
            <button class="mbtn glass" data-go="settings" style="flex:0 0 auto"><span class="ic">${icon('gear')}</span><span><b>設定</b></span></button>
          </div>
        </div>
      </div>`, 'title');
    el.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      const go = b.dataset.go;
      if (go === 'campaign') this.campaign({ best });
      else if (go === 'versus') this.versus();
      else if (go === 'online') this.act.openOnline();
      else if (go === 'settings') this.settings(() => this.title({ best }));
      else if (go === 'dex') this.dex(() => this.title({ best }));
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

  ammoCards(cur) {
    return `<div class="ammo" data-ammo="bullet">${BULLET_KEYS.map((k) => {
      const B = BULLETS[k];
      const bar = (lab, v, max) => `<em>${lab}</em><span><i style="width:${(v / max) * 100}%"></i></span>`;
      return `<button class="card glass ${k === cur ? 'on' : ''}" data-k="${k}" data-in><div class="aicon">${bulletSvg(k, 'big')}</div><b>${B.name}</b><small>${B.desc}</small>
        <div class="bars">${bar('速度', B.stats.speed, 3)}${bar('反彈', B.stats.bounce, 3)}${bar('彈數', B.stats.count, 3)}</div></button>`;
    }).join('')}</div>`;
  }
  wireAmmo(el, obj, key = 'bullet') {
    el.querySelectorAll('[data-ammo]').forEach((wrap) => {
      wrap.addEventListener('click', (e) => {
        const c = e.target.closest('.card'); if (!c) return;
        wrap.querySelectorAll('.card').forEach((x) => x.classList.toggle('on', x === c));
        obj[key] = c.dataset.k;
        this.act.select();
      });
    });
  }

  dexCount() { const d = this.act.dex ? this.act.dex() : { seen: {} }; return Object.keys(d.seen || {}).length; }

  // ---- 戰役：章節、關卡 → 起始彈種 ----
  campaign({ best = 0 } = {}, step = 1) {
    const s = this.state.campaign;
    const C = chapterList();
    s.from = Math.min(s.from, best);
    if (step === 1) {
      const chOf = (lv) => Math.max(0, C.findIndex((c) => lv >= c.from && lv < c.to));
      if (s.chapter == null || C[s.chapter].from > best) s.chapter = chOf(s.from);
      const el = this.mount(`<div class="panel glass">
        ${this.head('戰役')}
        <div class="chapters" data-in>${C.map((c, i) => {
          const locked = c.from > best, done = Math.max(0, Math.min(c.to, best) - c.from);
          return `<button class="chapcard glass ${i === s.chapter ? 'on' : ''} ${locked ? 'locked' : ''}" data-ch="${i}"><canvas data-chthumb="${c.from}"></canvas><span class="n">CHAPTER ${i + 1}</span><b>${esc(c.short || c.name)}</b><small>${esc(c.desc || '')}</small><span class="prog"><i style="width:${(done / (c.to - c.from)) * 100}%"></i></span></button>`;
        }).join('')}</div>
        <div class="label" data-in>從第幾關開始</div>
        <div class="levels" data-in data-levels></div>
        <div class="foot" data-in>${this.seg('lives', [[3, '3 條命'], [5, '5 條命'], [9, '9 條命']], s.lives)}<span class="note">每過五關多一條命；★ 是頭目關。</span><button class="go" data-next>下一步</button></div>
      </div>`, 'dim');
      const levels = () => {
        const c = C[s.chapter];
        if (s.from < c.from || s.from >= c.to) s.from = Math.min(best, c.from);
        el.querySelector('[data-levels]').innerHTML = CAMPAIGN.slice(c.from, c.to).map((def, k) => {
          const lv = c.from + k;
          return `<button class="lv glass ${lv === s.from ? 'on' : ''} ${lv > best ? 'locked' : ''} ${isBoss(def) ? 'boss' : ''}" data-lv="${lv}" title="${esc(def.name)}">${lv + 1}${isBoss(def) ? '★' : ''}</button>`;
        }).join('');
      };
      levels();
      this.wireBack(el, () => this.title({ best }));
      this.wireSegs(el, s);
      el.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => {
        s.chapter = +b.dataset.ch;
        el.querySelectorAll('[data-ch]').forEach((x) => x.classList.toggle('on', x === b));
        levels();
      }));
      el.querySelector('[data-levels]').addEventListener('click', (e) => {
        const b = e.target.closest('[data-lv]'); if (!b) return;
        s.from = +b.dataset.lv;
        el.querySelectorAll('[data-lv]').forEach((x) => x.classList.toggle('on', x === b));
      });
      requestAnimationFrame(() => el.querySelectorAll('[data-chthumb]').forEach((cv) => drawMapThumb(cv, CAMPAIGN[+cv.dataset.chthumb])));
      el.querySelector('[data-next]').addEventListener('click', () => this.campaign({ best }, 2));
      return;
    }
    const el = this.mount(`<div class="panel glass">
      ${this.head(`第 ${s.from + 1} 關：起始彈種`)}
      ${this.ammoCards(s.bullet)}
      <div class="foot" data-in><span class="note">彈種開局選好、遊戲中不能換。</span><button class="go" data-start>${icon('play')}出發</button></div>
    </div>`, 'dim');
    this.wireBack(el, () => this.campaign({ best }, 1));
    this.wireAmmo(el, s);
    el.querySelector('[data-start]').addEventListener('click', () => this.act.startCampaign({ bullet: s.bullet, level: s.from, lives: s.lives, players: 1 }));
  }

  // ---- 坦克圖鑑 ----
  // 卡框依稀有度（普通灰、稀有藍、精英紫、頭目金）；新收的有 NEW；卡面右下是擊毀數
  dex(back, sel = null) {
    const d = this.act.dex ? this.act.dex() : { seen: {}, kills: {}, viewed: {} };
    const seen = d.seen || {}, viewed = d.viewed || {}, kills = d.kills || {};
    if (sel) {
      const ty = TYPES[sel], known = seen[sel] != null, R = RARITY[rarityOf(sel)];
      if (known && this.act.markViewed) this.act.markViewed(sel);
      const el = this.mount(`<div class="panel glass" style="min-width:600px">
        <div class="head" data-in><button class="iconbtn glass press" data-back aria-label="返回">${icon('back')}</button><h3>坦克圖鑑</h3><span class="dexprog">No.${String(TYPE_KEYS.indexOf(sel) + 1).padStart(2, '0')}</span></div>
        <div class="dexinfo" data-in>
          <div class="dexleft">
            <canvas data-big style="--rc:${R.c}"></canvas>
            ${known ? `<div class="rar" style="--rc:${R.c}"><i></i>${R.name}</div>
            <div class="meta"><span><b>${kills[sel] || 0}</b>台已擊毀</span><span>首次遇到 第 <b>${seen[sel] + 1}</b> 關</span></div>` : '<div class="meta"><span>還沒遇到</span></div>'}
          </div>
          <div>
            <div class="role">${known ? esc(ty.role) : '尚未遇到'}</div>
            <h4>${known ? esc(ty.name) : '？？？'}</h4>
            <p>${known ? esc(ty.desc) : '在戰役中遇到這台坦克，就會記錄在圖鑑裡。'}</p>
            ${known ? `<div class="traits">${ty.traits.map((x) => `<span>${esc(x)}</span>`).join('')}</div>
            <div class="bars">${dexStats(ty).map(([k, v]) => `${k}<span><i style="width:${Math.round(v * 100)}%"></i></span>`).join('')}</div>` : ''}
          </div>
        </div>
      </div>`, 'dim');
      this.wireBack(el, () => this.dex(back));
      requestAnimationFrame(() => drawTankCard(el.querySelector('[data-big]'), sel, { unseen: !known, zoom: 0.95 }));
      return;
    }
    const n = Object.keys(seen).length, N = TYPE_KEYS.length;
    const el = this.mount(`<div class="panel glass">
      <div class="head" data-in><button class="iconbtn glass press" data-back aria-label="返回">${icon('back')}</button><h3>坦克圖鑑</h3><span class="dexprog">已收集 ${n} / ${N}</span></div>
      <div class="dexbar" data-in><i style="width:${(n / N) * 100}%"></i></div>
      <div class="dex" data-in>${TYPE_KEYS.map((k, i) => {
        const known = seen[k] != null, R = RARITY[rarityOf(k)];
        return `<button class="dexcard glass ${known ? '' : 'unseen'}" data-k="${k}" style="--rc:${known ? R.c : '#D5DAE5'}">${known && !viewed[k] ? '<span class="new">NEW</span>' : ''}<canvas data-tank="${k}"></canvas><span class="no">No.${String(i + 1).padStart(2, '0')}</span><b>${known ? esc(TYPES[k].name) : '？？？'}</b>${known && kills[k] ? `<span class="kc">×${kills[k]}</span>` : ''}</button>`;
      }).join('')}<div class="dexcard sum"><b class="num">${n}<small>/${N}</small></b><span>${n >= N ? '全部收集！' : `還有 ${N - n} 台沒遇過`}</span></div></div>
      <div class="foot" data-in><span class="note">在戰役中遇到新的坦克就會收進圖鑑；卡框顏色是稀有度：普通、<b style="color:#13849A">稀有</b>、<b style="color:#5E3A5E">精英</b>、<b style="color:#A87C00">頭目</b>。</span></div>
    </div>`, 'dim');
    this.wireBack(el, back);
    el.querySelectorAll('[data-k]').forEach((b) => b.addEventListener('click', () => this.dex(back, b.dataset.k)));
    requestAnimationFrame(() => el.querySelectorAll('[data-tank]').forEach((cv) => drawTankCard(cv, cv.dataset.tank, { unseen: seen[cv.dataset.tank] == null })));
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
        ${sw('aimGuide', '瞄準虛線（顯示整條反彈路徑）')}
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
    const tally = (kills) => Object.entries(kills || {}).filter(([, n]) => n > 0).map(([type, n]) => `<div class="glass"><canvas data-tank="${type}"></canvas><span>${TYPES[type] ? esc(TYPES[type].role) : type}</span><b style="margin-left:auto">${n}</b></div>`).join('');
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
    requestAnimationFrame(() => el.querySelectorAll('[data-tank]').forEach((cv) => drawTankCard(cv, cv.dataset.tank, { zoom: 1.1 })));
  }
}

export { CAMPAIGN };
