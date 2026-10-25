// 連線對戰：開房／加入（房號）、大廳（選模式、地圖、彈種）、房主跑模擬、客人鏡像＋自己的坦克本機預測。
// 傳輸：P2P（WebRTC＋Supabase 配對，js/net.js）；網址加 ?net=bc 改用 BroadcastChannel（同一台電腦兩個分頁，測試用）。
// 訊息：rel＝lobby／start／begin／ev（事件）／result／bye；fast＝in（客人輸入）／snap（房主快照，30 Hz）。
import { P2P, LocalLink, genRoomCode, normCode, newId } from './net.js';
import { BULLETS, BULLET_KEYS, TICK, TANK } from './config.js';
import { ARENAS, CAMPAIGN, parseMap } from './maps.js';
import { driveTank } from './sim.js';
import { wrap, lerp, angDiff } from './util.js';
import { TANK_COLORS } from './render.js';

const COLORS = ['p1', 'p2', 'p3', 'p4'];
const SIM_EV = new Set(['fire', 'bounce', 'pop', 'clash', 'boom', 'die', 'mine', 'arm', 'cork']);
const SNAP_EVERY = 2;          // 每 2 tick 一張快照（30 Hz）
const INTERP = 0.1;            // 別人的坦克畫在 100 ms 前（兩張快照之間內插）
const BT = BULLET_KEYS;
const icon = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r3 = (v) => Math.round(v * 1000) / 1000;

function loadName() { try { return localStorage.getItem('rt.name') || ''; } catch { return ''; } }
function saveName(n) { try { localStorage.setItem('rt.name', n); } catch { /* 私密模式 */ } }

export class Online {
  constructor(ctx) {
    this.ctx = ctx;
    this.role = null;          // 'host' | 'guest' | null
    this.active = false;       // 正在連線比賽中
    this.link = null;
    this.myId = newId();
    this.cfg = { mode: 'ffa', arena: 'cross', cpu: 0, rounds: 3, skill: 'normal' };
    this.lobby = [];           // [{ id, name, slot, color, bullet }]
    this.myBullet = 'standard';
    this.mirror = null;
    this.view = null;
    const m = location.hash.match(/room=([A-Za-z0-9]{4})/);
    if (m) setTimeout(() => this.open(normCode(m[1])), 300);
  }

  get transport() { return new URLSearchParams(location.search).get('net') === 'bc' ? LocalLink : P2P; }

  // ================= 畫面 =================
  open(code = '') {
    const { ui } = this.ctx;
    const name = loadName() || `玩家${Math.floor(10 + Math.random() * 89)}`;
    const el = ui.mount(`<div class="panel glass" style="width:min(94vw,520px)">
      <div class="head" data-in><button class="iconbtn glass press" data-back aria-label="返回">${icon('back')}</button><h3>連線對戰</h3></div>
      <div class="label" data-in>你的名字</div>
      <input class="namein" data-name maxlength="8" value="${esc(name)}" data-in>
      <div class="row" style="margin-top:14px;align-items:stretch" data-in>
        <button class="go" data-create style="flex:1">${icon('wifi')}開房間</button>
      </div>
      <div class="label" data-in>或輸入朋友的房號</div>
      <div class="row" data-in><input class="codein" data-code maxlength="4" placeholder="ABCD" value="${esc(code)}" autocomplete="off" autocapitalize="characters" style="flex:1"><button class="go" data-join>加入</button></div>
      <div class="err" data-err data-in></div>
      <div class="foot" data-in><span class="note">房主的裝置負責跑遊戲；同一個 Wi-Fi 最穩。最多 4 人，不夠的可以用電腦補。</span></div>
    </div>`, 'dim');
    const nm = () => { const v = el.querySelector('[data-name]').value.trim().slice(0, 8) || name; saveName(v); return v; };
    ui.wireBack(el, () => this.ctx.toTitle());
    el.querySelector('[data-create]').addEventListener('click', () => this.host(nm()));
    el.querySelector('[data-join]').addEventListener('click', () => {
      const c = normCode(el.querySelector('[data-code]').value);
      if (c.length !== 4) { el.querySelector('[data-err]').textContent = '房號是 4 個字'; return; }
      this.join(c, nm());
    });
    el.querySelector('[data-code]').addEventListener('input', (e) => { e.target.value = normCode(e.target.value); });
  }

  status(text, err = false) {
    const el = this.ctx.ui.mount(`<div class="panel glass" style="min-width:320px;text-align:center">
      <div class="head" data-in><button class="iconbtn glass press" data-back aria-label="返回">${icon('back')}</button><h3>連線對戰</h3></div>
      <p data-in style="margin:6px 0 4px;${err ? 'color:#FFB4B0' : ''}">${esc(text)}</p></div>`, 'dim');
    this.ctx.ui.wireBack(el, () => { this.leave(); this.open(); });
  }

  async connect(role, room, name) {
    this.leave();
    this.role = role;
    this.room = room;
    this.name = name;
    const T = this.transport;
    const link = (this.link = new T({
      room, id: this.myId, name, role,
      onPeers: (list) => this.onPeers(list),
      onData: (pid, msg) => this.onData(pid, msg),
      onClose: (pid, why) => this.onClose(pid, why),
      onBusy: () => this.status('這個房間正在比賽，結束後會自動接上…'),
    }));
    try {
      await link.start();
    } catch (e) {
      if (this.link === link) { this.status(e.message || '連線失敗', true); this.link = null; this.role = null; }
      return false;
    }
    return this.link === link;
  }

  async host(name) {
    const room = genRoomCode();
    this.status('建立房間中…');
    if (!(await this.connect('host', room, name))) return;
    this.lobby = [{ id: this.myId, name, slot: 0, color: 'p1', bullet: this.myBullet }];
    try { history.replaceState(null, '', `#room=${room}`); } catch { /* file:// */ }
    this.showLobby();
  }

  async join(room, name) {
    this.status(`正在找房間 ${room}…`);
    if (!(await this.connect('guest', room, name))) return;
    this.joinTimer = setTimeout(() => { if (this.role === 'guest' && !this.link.hostId) this.status(`找不到房間 ${room}（房號對嗎？房主還開著嗎？行動網路連不上時改用同一個 Wi-Fi）`, true); }, 12000);
  }

  leave() {
    clearTimeout(this.joinTimer);
    if (this.link) { try { this.link.close(); } catch { /* 已關 */ } }
    this.link = null;
    this.role = null;
    this.active = false;
    this.mirror = null;
    this.view = null;
    this.remote = new Map();
    try { if (location.hash) history.replaceState(null, '', location.pathname + location.search); } catch { /* file:// */ }
  }

  showLobby() {
    const { ui } = this.ctx;
    const host = this.role === 'host';
    const c = this.cfg;
    const people = this.lobby.map((p) => `<div class="glass"><i class="tankdot" style="background:${TANK_COLORS[p.color]}"></i>${esc(p.name)}${p.slot === 0 ? `<svg class="i" style="color:var(--gold);width:16px;height:16px"><use href="#i-crown"/></svg>` : ''}${p.id === this.myId ? '<span class="dim" style="font-weight:500;font-size:12px">（你）</span>' : ''}<span class="tag">${BULLETS[p.bullet].name}</span></div>`).join('');
    const total = this.lobby.length + (c.mode === 'coop' ? 0 : c.cpu);
    const el = ui.mount(`<div class="panel glass" style="width:min(96vw,720px)">
      <div class="head" data-in><button class="iconbtn glass press" data-back aria-label="離開">${icon('back')}</button><h3>${host ? '你的房間' : '房間'}</h3>
        <span class="code" data-code>${esc(this.room)}</span>
        ${host ? `<button class="iconbtn glass press" data-copy aria-label="複製連結">${icon('copy')}</button>` : ''}</div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:16px">
        <div>
          <div class="label" data-in>玩家（${this.lobby.length}／4）</div>
          <div class="people" data-in>${people}</div>
          ${host && this.lobby.length < 2 ? '<p class="note" style="font-size:12px;opacity:.7;margin:8px 2px" data-in>把房號給朋友；他在「連線對戰」輸入就能進來。</p>' : ''}
        </div>
        <div>
          ${host ? `
          <div class="label" data-in>模式</div><div data-in>${ui.seg('mode', [['ffa', '大亂鬥'], ['team', '2 對 2'], ['coop', '合作戰役']], c.mode)}</div>
          <div data-vs>
            <div class="label" data-in>地圖</div><div data-in>${ui.seg('arena', ARENAS.map((a) => [a.id, a.name]), c.arena)}</div>
            <div class="row" style="margin-top:10px" data-in>${ui.seg('cpu', [[0, '不加電腦'], [1, '+1'], [2, '+2'], [3, '+3']], c.cpu)}${ui.seg('rounds', [[3, '先贏 3'], [5, '先贏 5']], c.rounds)}</div>
          </div>` : `<div class="label" data-in>房主設定</div><p data-in style="margin:0;font-size:14px">${c.mode === 'coop' ? '合作戰役' : `${c.mode === 'team' ? '2 對 2' : '大亂鬥'}・${(ARENAS.find((a) => a.id === c.arena) || ARENAS[0]).name}・先贏 ${c.rounds}${c.cpu ? `・電腦 ${c.cpu} 台` : ''}`}</p>`}
          <div class="label" data-in>你的彈種</div><div data-in>${ui.seg('bullet', BULLET_KEYS.map((k) => [k, BULLETS[k].name]), this.myBullet)}</div>
        </div>
      </div>
      <div class="foot" data-in><span class="note" data-note>${host ? (total > 4 ? '超過 4 台坦克：電腦會自動少放幾台' : '') : '等房主開始…'}</span>${host ? `<button class="go" data-start>${icon('play')}開始</button>` : ''}</div>
    </div>`, 'dim');
    ui.wireBack(el, () => { this.leave(); this.ctx.toTitle(); });
    const sync = () => { const vs = el.querySelector('[data-vs]'); if (vs) vs.hidden = c.mode === 'coop'; };
    sync();
    const segObj = {};
    ui.wireSegs(el, segObj, (k) => {
      if (k === 'bullet') {
        this.myBullet = segObj.bullet;
        if (host) { this.lobby[0].bullet = this.myBullet; this.pushLobby(); this.showLobby(); }
        else this.send({ t: 'pick', bullet: this.myBullet });
        return;
      }
      c[k] = segObj[k];
      sync();
      this.pushLobby();
    });
    const cp = el.querySelector('[data-copy]');
    if (cp) cp.addEventListener('click', async () => {
      const url = `${location.origin}${location.pathname}#room=${this.room}`;
      try { await navigator.clipboard.writeText(url); el.querySelector('[data-note]').textContent = '已複製邀請連結'; } catch { el.querySelector('[data-note]').textContent = url; }
    });
    const st = el.querySelector('[data-start]');
    if (st) st.addEventListener('click', () => this.startHost());
  }

  pushLobby() { if (this.role === 'host') this.link.broadcast({ t: 'lobby', players: this.lobby, cfg: this.cfg }); }
  send(msg, reliable = true) { if (this.link && this.link.hostId) this.link.send(this.link.hostId, msg, reliable); }

  // ================= 連線事件 =================
  onPeers(list) {
    if (this.role === 'host') {
      // 新人照加入順序拿空位；走掉的人拿掉（比賽中由 onClose 處理）
      const ids = new Set(list.map((p) => p.id));
      if (!this.active) this.lobby = this.lobby.filter((p) => p.slot === 0 || ids.has(p.id));
      for (const p of list) {
        if (this.lobby.some((x) => x.id === p.id)) continue;
        const used = new Set(this.lobby.map((x) => x.slot));
        let slot = 1; while (used.has(slot)) slot++;
        if (slot > 3) continue;
        this.lobby.push({ id: p.id, name: p.name || '玩家', slot, color: COLORS[slot], bullet: 'standard' });
      }
      this.lobby.sort((a, b) => a.slot - b.slot);
      this.pushLobby();
      if (!this.active && this.ctx.G.scene !== 'play') this.showLobby();
    } else if (this.role === 'guest' && list.length && !this.active) {
      clearTimeout(this.joinTimer);
      this.status('已連上，等房主…');
    }
  }

  onClose(pid, why) {
    if (this.role === 'host') {
      const p = this.lobby.find((x) => x.id === pid);
      if (!p) return;
      if (this.active && this.ctx.G.game) {
        this.ctx.G.game.takeover(p.slot);
        p.left = true;
        this.toast(`${p.name} 離開了，改由電腦代打`);
      } else {
        this.lobby = this.lobby.filter((x) => x.id !== pid);
        this.pushLobby();
        if (this.ctx.G.scene !== 'play') this.showLobby();
      }
    } else if (this.role === 'guest' && pid === (this.link && this.link.hostId)) {
      this.hostGone(why === 'left' ? '房主離開了' : '跟房主的連線斷了');
    }
  }

  hostGone(text) {
    this.leave();
    this.ctx.toTitle();
    this.toast(text);
  }

  toast(text) {
    const hud = document.getElementById('hud');
    const t = document.createElement('div');
    t.className = 'toast glass';
    t.textContent = text;
    hud.appendChild(t);
    setTimeout(() => t.remove(), 3200);
  }

  onData(pid, m) {
    if (this.role === 'host') {
      if (m.t === 'in') {
        const p = this.lobby.find((x) => x.id === pid);
        if (!p) return;
        const r = this.remote.get(p.slot) || { f: m.f, m: m.m, fUsed: m.f, mUsed: m.m };
        if (m.s > (r.s || 0)) { r.s = m.s; r.mx = m.mx; r.my = m.my; r.aim = m.aim; r.f = Math.max(r.f, m.f); r.m = Math.max(r.m, m.m); r.at = performance.now(); }
        this.remote.set(p.slot, r);
      } else if (m.t === 'pick') {
        const p = this.lobby.find((x) => x.id === pid);
        if (p && BULLETS[m.bullet]) { p.bullet = m.bullet; this.pushLobby(); if (!this.active && this.ctx.G.scene !== 'play') this.showLobby(); }
      }
      return;
    }
    // ---- 客人 ----
    if (m.t === 'lobby') {
      this.lobby = m.players; this.cfg = m.cfg;
      const me = this.lobby.find((p) => p.id === this.myId);
      if (me) this.myBullet = me.bullet;
      if (!this.active || this.ctx.G.scene !== 'play') { this.active = false; this.showLobby(); }
    } else if (m.t === 'start') this.startGuest(m);
    else if (m.t === 'begin') this.guestBegin(m);
    else if (m.t === 'snap') this.guestSnap(m);
    else if (m.t === 'ev') (this.evq ||= []).push(m);
    else if (m.t === 'result') this.guestResult(m.r);
    else if (m.t === 'bye') this.hostGone('房主離開了');
  }

  // ================= 房主 =================
  startHost() {
    const c = this.cfg;
    const players = this.lobby.map((p) => ({ slot: p.slot, name: p.name, color: p.color, bullet: p.bullet, cpu: !!p.left }));
    this.remote = new Map();
    let opts;
    if (c.mode === 'coop') opts = { mode: 'campaign', level: 0, players };
    else opts = { mode: 'versus', arena: c.arena, rule: c.mode === 'team' ? 'team' : 'ffa', cpu: Math.max(0, Math.min(c.cpu, 4 - players.length)), skill: c.skill, rounds: c.rounds, players };
    this.active = true;
    this.link.accepting = false;
    this.tick = 0;
    this.lastSim = null;
    this.ctx.startGame(opts, 'solo', [0]);
    for (const p of this.lobby) this.ctx.renderer.labels.set(`slot${p.slot}`, p.id === this.myId ? '你' : p.name);
    this.link.broadcast({ t: 'start', players: this.lobby, cfg: c });
  }

  // 模擬之前：客人的輸入放進 game.inputs
  applyRemote(game) {
    for (const [slot, r] of this.remote) {
      const I = game.inputs.get(slot);
      if (!I) continue;
      const stale = performance.now() - (r.at || 0) > 250;   // 斷流：停下來但不亂開火
      I.mx = stale ? 0 : r.mx || 0; I.my = stale ? 0 : r.my || 0;
      if (r.aim != null) I.aim = r.aim;
      if (r.f > r.fUsed) { I.fire = true; r.fUsed = r.f; }
      if (r.m > r.mUsed) { I.mine = true; r.mUsed = r.m; }
    }
  }

  // 模擬之後：事件立刻送（可靠通道），快照 30 Hz（不可靠通道）
  afterTick(game, simEv, gameEv) {
    if (!this.link) return;
    if (game.sim !== this.lastSim) { this.lastSim = game.sim; this.sendBegin(game); }
    const ev = simEv.filter((e) => SIM_EV.has(e.k)).map((e) => ({ ...e, x: e.x != null ? r3(e.x) : e.x, y: e.y != null ? r3(e.y) : e.y }));
    const gev = gameEv.filter((e) => e.k !== 'begin');
    if (ev.length || gev.length) this.link.broadcast({ t: 'ev', e: ev, g: gev });
    if (++this.tick % SNAP_EVERY === 0) this.sendSnap(game);
  }

  sendBegin(game) {
    const sim = game.sim;
    this.mapKeyHost = `${game.map.name}#${game.attempt}#${game.round}#${game.level}`;
    this.link.broadcast({
      t: 'begin', key: this.mapKeyHost, mode: game.mode, level: game.level, arena: game.o.arena,
      tanks: sim.tanks.map((t) => [t.id, t.slot, t.kind, t.team, t.color, t.name, t.bullet, t.maxShots, t.mineMax, t.ghost ? 1 : 0, t.type, r3(t.x), r3(t.y), r3(t.body), t.speed, t.bulletSpeed, t.teamColor || null]),
    });
  }

  sendSnap(game) {
    const sim = game.sim;
    const ack = {};
    for (const [slot, r] of this.remote) ack[slot] = r.s || 0;
    const cork = [];
    if (sim.gridVer) for (let i = 0; i < sim.grid.length; i++) if (sim.grid[i] !== game.map.grid[i]) cork.push(i);
    const v = game.view();
    this.link.broadcast({
      t: 'snap', key: this.mapKeyHost, ht: r3(sim.t), ack,
      tk: sim.tanks.map((t) => [t.id, r3(t.x), r3(t.y), r3(t.body), r3(t.turret), t.alive ? 1 : 0, r3(t.odo), r3(t.moving)]),
      bl: sim.bullets.map((b) => [b.id, r3(b.x), r3(b.y), r3(b.vx), r3(b.vy), BT.indexOf(b.type), b.owner, b.group, b.speed, b.r]),
      mn: sim.mines.map((m) => [m.id, r3(m.x), r3(m.y), m.owner, m.fuse == null ? -1 : r3(m.fuse)]),
      gv: sim.gridVer, cork,
      v: { mode: v.mode, phase: v.phase, level: v.level, lives: v.lives, round: v.round, banner: v.banner, score: v.score, rule: v.rule, rounds: v.rounds, over: v.over },
    }, false);
  }

  sendResult(r) { if (this.role === 'host' && this.link) this.link.broadcast({ t: 'result', r }); }

  // ================= 客人 =================
  startGuest(m) {
    const { G, input, hud, ui, renderer } = this.ctx;
    this.lobby = m.players;
    const me = this.lobby.find((p) => p.id === this.myId);
    if (!me) return;
    this.mySlot = me.slot;
    this.active = true;
    this.seq = 0; this.fireCum = 0; this.mineCum = 0; this.hist = []; this.corr = { x: 0, y: 0 };
    this.snaps = []; this.evq = [];
    G.scene = 'play';
    G.paused = false;
    G.local = [me.slot];
    G.auto.clear();
    G.game = this.facade();
    G.startOpts = null;
    input.setLayout('solo', [me.slot]);
    input.layout(renderer.field);
    input.setEnabled(false);
    ui.clear();
    hud.setLayout('solo');
    hud.show(true);
    renderer.labels.clear();
    for (const p of this.lobby) renderer.labels.set(`slot${p.slot}`, p.id === this.myId ? '你' : p.name);
  }

  facade() {
    const self = this;
    return {
      get sim() { return self.mirror; },
      get phase() { return self.view ? self.view.phase : 'intro'; },
      get over() { return !!(self.view && self.view.over); },
      playerTank(slot) { return self.mirror && self.mirror.tanks.find((t) => t.kind === 'player' && t.slot === slot); },
      view() { return self.view; },
    };
  }

  guestBegin(m) {
    const def = m.mode === 'campaign' ? CAMPAIGN[m.level] : (ARENAS.find((a) => a.id === m.arena) || ARENAS[0]);
    const map = parseMap(def);
    const tanks = m.tanks.map(([id, slot, kind, team, color, name, bullet, maxShots, mineMax, ghost, type, x, y, body, speed, bulletSpeed, teamColor]) => ({
      id, slot, kind, team, color, teamColor, name, bullet, maxShots, mineMax, ghost: !!ghost, type, x, y, body, turret: body, alive: true, odo: 0, moving: 0, speed, bulletSpeed, turn: TANK.turn,
    }));
    this.baseGrid = map.grid;
    this.mirror = {
      grid: new Uint8Array(map.grid), gridVer: 0, tanks, bullets: [], mines: [],
      tank(id) { return this.tanks.find((t) => t.id === id); },
      ally(a, b) { return a.team === b.team; },
    };
    this.mapKey = m.key;
    this.snaps = [];
    this.hist = []; this.corr = { x: 0, y: 0 };
    this.ctx.renderer.reset();
    this.ctx.input.setEnabled(false);
  }

  guestSnap(m) {
    if (!this.mirror || m.key !== this.mapKey) return;
    m.at = performance.now() / 1000;
    this.snaps.push(m);
    if (this.snaps.length > 12) this.snaps.shift();
    this.view = { ...m.v, mode: m.v.mode };
    // 軟木塊
    if (m.gv !== this.mirror.gridVer) {
      this.mirror.grid = new Uint8Array(this.baseGrid);
      for (const i of m.cork) this.mirror.grid[i] = 0;
      this.mirror.gridVer = m.gv;
    }
    // 地雷直接照快照
    this.mirror.mines = m.mn.map(([id, x, y, owner, fuse]) => ({ id, x, y, owner, fuse: fuse < 0 ? null : fuse }));
    // 自己的坦克：用 ack 對照本機紀錄，把誤差慢慢補回去
    const me = this.mirror.tanks.find((t) => t.kind === 'player' && t.slot === this.mySlot);
    const row = me && m.tk.find((r) => r[0] === me.id);
    if (me && row) {
      me.alive = !!row[5];
      const ack = m.ack[this.mySlot] || 0;
      while (this.hist.length && this.hist[0].s < ack) this.hist.shift();
      const h = this.hist[0] && this.hist[0].s === ack ? this.hist[0] : null;
      if (h) {
        const ex = row[1] - h.x, ey = row[2] - h.y;
        if (Math.hypot(ex, ey) > 1.2) { me.x = row[1]; me.y = row[2]; this.corr = { x: 0, y: 0 }; for (const k of this.hist) { k.x += ex; k.y += ey; } }
        else { this.corr.x += ex; this.corr.y += ey; for (const k of this.hist) { k.x += ex; k.y += ey; } }
      } else if (!this.hist.length || !me.alive) { me.x = row[1]; me.y = row[2]; me.body = row[3]; }
    }
  }

  // 每畫格：送輸入、本機預測自己、內插別人、推炮彈、處理事件
  guestFrame(dt, pending) {
    if (!this.mirror) { this.flushEvents(); return; }
    const now = performance.now() / 1000;
    const mir = this.mirror;
    const me = mir.tanks.find((t) => t.kind === 'player' && t.slot === this.mySlot);
    const p = pending.get(this.mySlot) || { mx: 0, my: 0, aim: null, fire: 0, mine: 0 };
    this.fireCum += p.fire || 0; this.mineCum += p.mine || 0;
    p.fire = 0; p.mine = 0; p.fireLeft = 0; p.mineLeft = 0;
    const playing = this.view && (this.view.phase === 'play');
    if (me && me.alive) {
      if (playing) driveTank(mir.grid, me, p.mx, p.my, dt);
      if (p.aim != null) { me.aimWant = p.aim; me.turret = me.turret + Math.max(-TANK.turretTurn * dt, Math.min(TANK.turretTurn * dt, angDiff(p.aim, me.turret))); me.turret = wrap(me.turret); }
      const k = Math.min(1, dt * 8);
      me.x += this.corr.x * k; me.y += this.corr.y * k;
      this.corr.x -= this.corr.x * k; this.corr.y -= this.corr.y * k;
    }
    this.seq++;
    this.send({ t: 'in', s: this.seq, mx: r3(p.mx), my: r3(p.my), aim: me && me.aimWant != null ? r3(me.aimWant) : null, f: this.fireCum, m: this.mineCum }, false);
    if (me) { this.hist.push({ s: this.seq, x: me.x, y: me.y }); if (this.hist.length > 240) this.hist.shift(); }

    // 別人：在 100 ms 前的兩張快照之間內插
    const S = this.snaps;
    if (S.length) {
      const rt = now - INTERP;
      let a = S[0], b = S[S.length - 1];
      for (let i = 0; i < S.length - 1; i++) if (S[i].at <= rt && S[i + 1].at >= rt) { a = S[i]; b = S[i + 1]; break; }
      const k = b.at > a.at ? Math.max(0, Math.min(1, (rt - a.at) / (b.at - a.at))) : 1;
      for (const t of mir.tanks) {
        const rb = b.tk.find((r) => r[0] === t.id);
        if (!rb) continue;
        if (t === me) { t.alive = !!rb[5]; continue; }
        const ra = a.tk.find((r) => r[0] === t.id) || rb;
        t.x = lerp(ra[1], rb[1], k); t.y = lerp(ra[2], rb[2], k);
        t.body = ra[3] + angDiff(rb[3], ra[3]) * k; t.turret = ra[4] + angDiff(rb[4], ra[4]) * k;
        t.alive = !!rb[5]; t.odo = lerp(ra[6], rb[6], k); t.moving = rb[7];
      }
      // 炮彈：最新快照往前推（同一顆沿用物件，畫面的煙尾才連續）
      const L = S[S.length - 1];
      const age = Math.min(0.2, now - L.at);
      const old = new Map(mir.bullets.map((x) => [x.id, x]));
      mir.bullets = L.bl.map(([id, x, y, vx, vy, ti, owner, group, speed, r]) => {
        const o = old.get(id) || { id };
        Object.assign(o, { x: x + vx * speed * age, y: y + vy * speed * age, vx, vy, type: BT[ti], owner, group, speed, r });
        return o;
      });
    }
    this.flushEvents();
  }

  flushEvents() {
    const q = this.evq || [];
    this.evq = [];
    for (const m of q) {
      this.ctx.handleEvents(m.e || [], m.g || []);
      for (const e of m.g || []) {
        if (e.k === 'go') this.ctx.input.setEnabled(true);
        if (e.k === 'outro') this.ctx.input.setEnabled(false);
      }
    }
  }

  guestResult(r) {
    const { G, hud, ui, input } = this.ctx;
    G.scene = 'result';
    input.setEnabled(false);
    hud.show(false);
    this.active = false;
    this.mirror = null;
    ui.result(r);
    // 客人的「再玩一次」＝回大廳等房主
    const again = ui.cur && ui.cur.querySelector('[data-a="again"]');
    if (again) { again.innerHTML = `${icon('users')}回大廳`; again.onclick = (e) => { e.stopImmediatePropagation(); this.showLobby(); }; }
    const quit = ui.cur && ui.cur.querySelector('[data-a="quit"]');
    if (quit) quit.onclick = (e) => { e.stopImmediatePropagation(); this.leave(); this.ctx.toTitle(); };
  }

  activeShots(t) {
    if (!this.mirror) return 0;
    const g = new Set();
    for (const b of this.mirror.bullets) if (b.owner === t.id) g.add(b.group);
    return g.size;
  }
  activeMines(t) { return this.mirror ? this.mirror.mines.filter((m) => m.owner === t.id).length : 0; }

  // 房主：比賽結束 → 回大廳（大家都還連著）
  backToLobby() {
    this.active = false;
    if (this.link) this.link.accepting = true;
    this.lobby = this.lobby.filter((p) => !p.left);
    this.pushLobby();
    this.showLobby();
  }
}

export { TICK };
