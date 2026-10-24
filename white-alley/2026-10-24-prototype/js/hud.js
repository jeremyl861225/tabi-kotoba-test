// HUD：血量（含受傷殘影）、石頭、比分與倒數、右上小地圖、受擊方向、擊倒訊息、敵人名牌、陣亡倒數、KO 橫幅。
import { CFG, TEAMS } from './config.js';
import { WEAPONS } from './weapons.js';
import { animate, banner, bump, spring } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (id, cls = '') => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;

export class Hud {
  constructor(root, map, weapon = 'stone', myTeam = -1, mode = 'ffa') {
    this.root = root;
    this.map = map;
    this.W = WEAPONS[weapon] || WEAPONS.stone;
    this.team = myTeam;   // ≥ 0：分隊（上方改成兩隊的比分，自己的隊伍永遠在左邊）
    this.mode = mode;     // 'team' 水晶血條；'elim' 每個人一顆小人頭（倒下變空心）
    this.spec = null;     // 殲滅戰出局後觀戰的隊友（小地圖改以他為中心）
    const T = myTeam >= 0, mineC = T ? TEAMS[myTeam].color : '', foeC = T ? TEAMS[1 - myTeam].color : '';
    const E = mode === 'elim', bar = E ? '<div class="pp"></div>' : '<div class="cb"><i></i><em>100%</em></div>';
    root.innerHTML = `
      <button class="pause glass lens" aria-label="暫停" data-bezel="14" data-refract="6">${icon('i-pause')}</button>
      <div class="vitals glass lens" data-bezel="14" data-refract="7">
        <div class="hp"><div class="bar"><i class="ghost"></i><i class="fill"></i></div><em>100</em></div>
        <div class="ammo"></div><div class="rl" hidden><i></i><span>換彈</span></div>
      </div>
      ${T ? `<div class="score teams glass lens${E ? ' elim' : ''}" data-bezel="16" data-refract="7" style="--mine:${mineC};--foe:${foeC}">
        <div class="side mine"><b class="tk">0</b>${bar}</div>
        <div class="meta"><span class="clock">${E ? '4:00' : '6:00'}</span><span class="rank">你的 KO <u class="myko">0</u></span></div>
        <div class="side foe">${bar}<b class="tk">0</b></div>
      </div><div class="alert"></div>` : `<div class="score glass lens" data-bezel="16" data-refract="7">
        <div class="ko"><b>0</b><span>KO</span></div><i class="sep"></i>
        <div class="meta"><span class="rank"></span><span class="clock">5:00</span></div>
      </div>`}
      <div class="minimap glass lens" data-bezel="12" data-refract="10"><canvas></canvas></div>
      <div class="feed"></div>
      <div class="cross"><i></i><u></u><b></b><b></b><b></b><b></b><span>太遠</span></div>
      <div class="hitmark"><b></b><b></b><b></b><b></b><span></span></div>
      <canvas class="dmg"></canvas>
      <div class="vig"></div>
      <div class="labels"></div>
      <div class="banner"></div>
      <div class="toast glass" hidden></div>`;
    this.el = {
      fill: $('.hp .fill', root), ghost: $('.hp .ghost', root), hpNum: $('.hp em', root), vitals: $('.vitals', root),
      ammo: $('.ammo', root), ko: $('.ko b', root) || $('.myko', root), rank: $('.rank', root), clock: $('.clock', root),
      alert: $('.alert', root), sides: [...root.querySelectorAll('.score.teams .side')],
      feed: $('.feed', root), hit: $('.hitmark', root), vig: $('.vig', root), labels: $('.labels', root),
      toast: $('.toast', root), pause: $('.pause', root), cross: $('.cross', root), banner: $('.banner', root),
      rl: $('.rl', root), crossTxt: $('.cross span', root),
    };
    // 彈藥格：每種武器自己的圖示與數量（光劍只有一格，冷卻時變淡）
    this.el.ammo.classList.add(`w-${this.W.key}`);
    this.el.cross.classList.add(`w-${this.W.key}`);
    this.el.ammo.innerHTML = Array.from({ length: Math.max(1, this.W.ammo) }, () => icon(`i-w-${this.W.key}`)).join('') + (this.W.regen ? '<i class="nx"></i>' : '');
    this.nx = $('.nx', this.el.ammo);
    this.pips = [...this.el.ammo.querySelectorAll('.i')];
    this.mini = $('.minimap canvas', root);
    this.dmg = $('.dmg', root);
    this.dmgs = [];
    this.pings = [];
    this.labelEls = new Map();
    this._ammo = -1; this._ko = 0; this._hp = CFG.HP; this.ghostHp = CFG.HP; this.ghostHold = 0;
    this._toastKey = '';
    this._miniBase();
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const s = this.mini.getBoundingClientRect().width || 126;
    this.mini.width = this.mini.height = Math.round(s * dpr);
    this.miniDpr = dpr;
    this.dmg.width = Math.round(window.innerWidth * dpr);
    this.dmg.height = Math.round(window.innerHeight * dpr);
  }

  // 小地圖底圖：建物先畫一層往右下偏的影子再畫屋頂，像縮小的白模
  _miniBase() {
    const p = this.map.play, S = (this.miniS = 3), PAD = 24;
    this.miniO = { x: p.minX - PAD, z: p.minZ - PAD };
    const cv = (this.miniCv = document.createElement('canvas'));
    cv.width = Math.ceil((p.maxX - p.minX + 2 * PAD) * S);
    cv.height = Math.ceil((p.maxZ - p.minZ + 2 * PAD) * S);
    const c = cv.getContext('2d');
    c.fillStyle = '#e4e6ea'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#fbfbfa';
    c.fillRect((p.minX - this.miniO.x) * S, (p.minZ - this.miniO.z) * S, (p.maxX - p.minX) * S, (p.maxZ - p.minZ) * S);
    const path = (b, ox = 0, oz = 0) => {
      c.beginPath();
      b.pts.forEach(([x, z], i) => { const X = (x - this.miniO.x) * S + ox, Z = (z - this.miniO.z) * S + oz; i ? c.lineTo(X, Z) : c.moveTo(X, Z); });
      c.closePath();
    };
    c.fillStyle = 'rgba(60,66,90,0.16)';
    for (const b of this.map.buildings) { path(b, 2.2, 2.2); c.fill(); }
    c.fillStyle = '#c6cad1'; c.strokeStyle = '#aeb3bc'; c.lineWidth = 1;
    for (const b of this.map.buildings) { path(b); c.fill(); c.stroke(); }
  }

  drawMini(sim, me, view, visible) {
    const c = this.mini.getContext('2d');
    const W = this.mini.width, R = W / 2, dpr = this.miniDpr;
    const RANGE = 42;
    const k = R / RANGE;
    const S = this.miniS;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, W);
    c.save();
    c.beginPath(); c.arc(R, R, R, 0, Math.PI * 2); c.clip();
    c.fillStyle = '#e4e6ea'; c.fillRect(0, 0, W, W);
    c.translate(R, R);
    c.rotate(view.yaw);
    c.scale(k / S, k / S);
    c.translate(-(me.x - this.miniO.x) * S, -(me.z - this.miniO.z) * S);
    c.drawImage(this.miniCv, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const cs = Math.cos(view.yaw), sn = Math.sin(view.yaw);
    const to = (x, z) => {
      const dx = (x - me.x) * k, dz = (z - me.z) * k;
      return [R + dx * cs - dz * sn, R + dx * sn + dz * cs];
    };
    // 視野扇形
    const fov = 0.62;
    const g = c.createRadialGradient(R, R, 0, R, R, R);
    g.addColorStop(0, 'rgba(47,95,208,0.22)'); g.addColorStop(1, 'rgba(47,95,208,0)');
    c.fillStyle = g;
    c.beginPath(); c.moveTo(R, R); c.arc(R, R, R, -Math.PI / 2 - fov, -Math.PI / 2 + fov); c.closePath(); c.fill();
    // 水晶戰：兩顆水晶（菱形＋血量弧），超出範圍就在邊緣畫箭頭
    if (this.team >= 0) for (const cr of sim.crystals) {
      let [x, y] = to(cr.x, cr.z);
      const dx = x - R, dy = y - R, dd = Math.hypot(dx, dy), lim = R - 12 * dpr, col = TEAMS[cr.team].color;
      if (dd > lim) {
        x = R + (dx / dd) * lim; y = R + (dy / dd) * lim;
        const a = Math.atan2(dy, dx);
        c.fillStyle = col;
        c.beginPath(); c.moveTo(x + Math.cos(a) * 9 * dpr, y + Math.sin(a) * 9 * dpr);
        c.lineTo(x + Math.cos(a + 2.4) * 6 * dpr, y + Math.sin(a + 2.4) * 6 * dpr);
        c.lineTo(x + Math.cos(a - 2.4) * 6 * dpr, y + Math.sin(a - 2.4) * 6 * dpr); c.closePath(); c.fill();
      } else {
        const s = 6.5 * dpr, hit = sim.time - cr.lastHit < 0.6;
        c.fillStyle = '#fff';
        c.beginPath(); c.moveTo(x, y - s - 2 * dpr); c.lineTo(x + s * 0.8 + 2 * dpr, y); c.lineTo(x, y + s + 2 * dpr); c.lineTo(x - s * 0.8 - 2 * dpr, y); c.closePath(); c.fill();
        c.fillStyle = hit && Math.sin(sim.time * 30) > 0 ? '#fff' : col;
        c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s * 0.8, y); c.lineTo(x, y + s); c.lineTo(x - s * 0.8, y); c.closePath(); c.fill();
        c.strokeStyle = col; c.lineWidth = 2 * dpr; c.lineCap = 'round';
        c.beginPath(); c.arc(x, y, s + 4.5 * dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, cr.hp / cr.max)); c.stroke();
      }
    }
    // 剛出手的人：在小地圖擴散一圈
    for (const pg of this.pings) {
      const a = 1 - (sim.time - pg.t) / 1.6;
      if (a <= 0) continue;
      const [x, y] = to(pg.x, pg.z);
      c.strokeStyle = `rgba(224,62,48,${a})`; c.lineWidth = 1.6 * dpr;
      c.beginPath(); c.arc(x, y, (4 + (1 - a) * 11) * dpr, 0, Math.PI * 2); c.stroke();
    }
    this.pings = this.pings.filter((pg) => sim.time - pg.t < 1.6);
    // 看得到的人：大亂鬥都是紅點；水晶戰隊友用隊伍色箭頭（看得出面向）、敵人用敵隊色圓點
    for (const p of sim.players) {
      if (p === me || !p.alive || !visible.has(p.id)) continue;
      const [x, y] = to(p.x, p.z);
      const mate = this.team >= 0 && p.team === me.team;
      if (mate) {
        const a = -p.yaw + view.yaw - Math.PI / 2, s = 5.5 * dpr;   // 隊友面向（螢幕座標）
        c.fillStyle = '#fff';
        c.beginPath(); c.arc(x, y, s + 1.5 * dpr, 0, Math.PI * 2); c.fill();
        c.fillStyle = TEAMS[p.team].color;
        c.beginPath(); c.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s); c.lineTo(x + Math.cos(a + 2.5) * s, y + Math.sin(a + 2.5) * s); c.lineTo(x + Math.cos(a - 2.5) * s, y + Math.sin(a - 2.5) * s); c.closePath(); c.fill();
        continue;
      }
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x, y, 5.6 * dpr, 0, Math.PI * 2); c.fill();
      c.fillStyle = this.team >= 0 ? TEAMS[p.team].color : '#e03e30';
      c.beginPath(); c.arc(x, y, 4 * dpr, 0, Math.PI * 2); c.fill();
    }
    // 自己（永遠朝上）
    c.shadowColor = 'rgba(0,0,0,0.25)'; c.shadowBlur = 4 * dpr;
    c.fillStyle = '#1c1d22';
    c.beginPath(); c.moveTo(R, R - 8.5 * dpr); c.lineTo(R + 6 * dpr, R + 6.5 * dpr); c.lineTo(R, R + 3 * dpr); c.lineTo(R - 6 * dpr, R + 6.5 * dpr); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.restore();
    // 北方
    const nx = R + Math.sin(view.yaw) * (R - 11 * dpr), ny = R - Math.cos(view.yaw) * (R - 11 * dpr);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.beginPath(); c.arc(nx, ny, 7.5 * dpr, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#1c1d22'; c.font = `700 ${9.5 * dpr}px Geist, system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('N', nx, ny + 0.5 * dpr);
  }

  ping(x, z, t) { this.pings.push({ x, z, t }); }

  // 水晶戰上方：左邊自己隊、右邊敵隊；隊伍 KO、水晶血量（剛被打的那邊閃）
  _teamScore(sim) {
    if (this.mode === 'elim') { this._elimScore(sim); return; }
    [this.team, 1 - this.team].forEach((t, k) => {
      const side = this.el.sides[k], c = sim.crystals[t];
      if (!side || !c) return;
      const pct = Math.max(0, c.hp / c.max);
      side.querySelector('.cb i').style.transform = `scaleX(${pct.toFixed(3)})`;
      const em = side.querySelector('em'), txt = `${Math.ceil(pct * 100)}%`;
      if (em.textContent !== txt) em.textContent = txt;
      side.classList.toggle('hit', sim.time - c.lastHit < 0.6);
      side.classList.toggle('low', pct < 0.3);
      const tk = side.querySelector('.tk'), n = String(sim.teamKills[t]);
      if (tk.textContent !== n) { tk.textContent = n; bump(tk, 1.4); }
    });
  }

  // 殲滅戰上方：大字是還站著的人數，旁邊一排小人頭（倒下的變空心、剛倒下的抖一下）
  _elimScore(sim) {
    [this.team, 1 - this.team].forEach((t, k) => {
      const side = this.el.sides[k];
      if (!side) return;
      const ps = sim.players.filter((p) => p.team === t);
      const key = ps.map((p) => (p.alive ? 1 : 0)).join('');
      const pp = side.querySelector('.pp');
      if (pp.dataset.k === key) return;
      const was = pp.dataset.k || '';
      pp.dataset.k = key;
      const order = k === 0 ? ps : [...ps].reverse();   // 敵隊那排從右往左排，倒下的都靠中間
      pp.innerHTML = order.map((p) => `<i class="${p.alive ? 'on' : ''}" title="${p.name.replace(/"/g, '')}"></i>`).join('');
      const n = ps.filter((p) => p.alive).length, tk = side.querySelector('.tk');
      tk.textContent = n;
      if (was && was !== key) { bump(tk, 1.5); side.classList.add('hit'); setTimeout(() => side.classList.remove('hit'), 600); }
      side.classList.toggle('low', n === 1);
    });
  }

  // 畫面中上方的大字提示（我方水晶被打、勝負）
  alert(text, kind = 'warn') {
    const el = this.el.alert;
    if (!el) return;
    el.className = `alert ${kind}`;
    el.textContent = text;
    animate(el, { opacity: [0, 1, 1, 0], y: [-8, 0, 0, -4] }, { duration: kind === 'warn' ? 2.2 : 3, times: [0, 0.12, 0.8, 1] });
  }

  update(sim, me, view, visible, r, dt, aim = null, seen = visible) {
    const e = this.el;
    // 血量：受傷時紅色殘影停一下再縮
    const hp = Math.max(0, me.hp);
    if (hp < this._hp) this.ghostHold = 0.45;
    if (hp > this.ghostHp) this.ghostHp = hp;
    this.ghostHold -= dt;
    if (this.ghostHold <= 0) this.ghostHp = Math.max(hp, this.ghostHp - dt * 90);
    this._hp = hp;
    e.fill.style.transform = `scaleX(${hp / CFG.HP})`;
    e.ghost.style.transform = `scaleX(${this.ghostHp / CFG.HP})`;
    e.vitals.classList.toggle('low', me.alive && hp / CFG.HP < 0.35);
    e.hpNum.textContent = Math.ceil(hp);
    const W = this.W;
    const ammo = W.kind === 'melee' ? (me.cdUntil > sim.time ? 0 : 1) : me.stones;
    if (this._ammo !== ammo) {
      const gained = me.stones > this._ammo && this._ammo >= 0;
      this.pips.forEach((p, i) => {
        const on = i < ammo;
        p.classList.toggle('on', on);
        if (gained && on && i >= this._ammo) animate(p, { scale: [1.5, 1], y: [-4, 0] }, spring(520, 14, { delay: (i - this._ammo) * 0.04 }));
      });
      if (ammo < this._ammo && this.pips[ammo]) animate(this.pips[ammo], { scale: [0.6, 1] }, spring(500, 18));
      this._ammo = ammo;
    }
    // 下一發補回的進度：空著的第一格底下一條細線慢慢長滿
    if (this.nx) {
      const regenning = me.alive && me.stones < W.ammo && me.regenAt > 0;
      this.nx.style.opacity = regenning ? 1 : 0;
      if (regenning) {
        const k = Math.max(0, Math.min(1, 1 - (me.regenAt - sim.time) / W.regen));
        this.nx.style.left = `${me.stones * 22}px`;
        this.nx.style.transform = `scaleX(${k.toFixed(3)})`;
      }
    }
    // 步槍換彈進度
    const reloading = W.kind === 'hitscan' && me.alive && (me.reloadUntil || 0) > sim.time;
    if (reloading !== !e.rl.hidden) { e.rl.hidden = !reloading; e.ammo.hidden = reloading; }
    if (reloading) e.rl.style.setProperty('--p', Math.max(0, Math.min(1, 1 - (me.reloadUntil - sim.time) / W.reload)).toFixed(3));
    if (this._ko !== me.kills) { this._ko = me.kills; e.ko.textContent = me.kills; bump(e.ko, 1.6); }
    if (this.team >= 0) this._teamScore(sim);
    else {
      const rank = sim.ranking().indexOf(me) + 1;
      e.rank.textContent = `第 ${rank} / ${sim.players.length}`;
    }
    const left = Math.max(0, sim.matchTime - sim.time);
    e.clock.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    e.clock.classList.toggle('hurry', left < 30 && sim.state === 'play');
    // 準心＝落點：指到人變紅、太遠（丟不到）變灰並提示
    e.cross.classList.toggle('aim', me.aiming);
    const melee = W.kind === 'melee';
    e.cross.classList.toggle('lock', !!(aim && (melee ? aim.inReach : aim.hit && (aim.hit.player || aim.hit.foeCrystal))));
    const lunge = !!(melee && aim && aim.inLunge && !aim.inReach && me.aiming && me.charge * W.chargeT >= W.lungeT);
    const far = !!(!melee && aim && (me.aiming && aim.far || aim.boom && aim.far));
    e.cross.classList.toggle('far', far);
    e.cross.classList.toggle('lunge', lunge);
    const txt = lunge ? '放開衝刺' : far ? '太遠' : '';
    if (txt && e.crossTxt.textContent !== txt) e.crossTxt.textContent = txt;
    if (W.kind === 'hitscan') {
      // 散布圈：步槍目前的散布角換成螢幕上的像素
      const sp = (W.spreadMax - (W.spreadMax - W.spreadMin) * (me.aiming ? me.charge : 0) + W.moveSpread * Math.min(1, me.speed / CFG.SPEED)) * Math.PI / 180;
      const fov = (r.camera.fov * Math.PI) / 180;
      const g = Math.max(4, (Math.tan(sp) / Math.tan(fov / 2)) * (window.innerHeight / 2));
      e.cross.style.setProperty('--g', g.toFixed(1));
    }
    e.cross.style.opacity = me.alive && !reloading ? 1 : me.alive ? 0.35 : 0;

    this.lased = me.alive ? r.lasedFrom : null;
    // 小地圖每秒 20 次就夠（省電時 12 次）；受擊方向只有在有東西要畫時才重畫整張全螢幕畫布
    this.miniT = (this.miniT || 0) - dt;
    if (this.miniT <= 0 || dt === 0) {
      this.miniT = this.power ? 1 / 12 : 1 / 20;
      const c = !me.alive && this.spec && this.spec.alive ? this.spec : me;
      this.drawMini(sim, c, c === me ? view : { yaw: c.yaw, pitch: 0 }, visible);
    }
    this._labels(sim, me, seen, r);
    this._damage(view, me, dt);

    // 陣亡倒數（圓環＋擊倒者）；殲滅戰改成「出局」＋正在看哪位隊友
    if (!me.alive && this.mode === 'elim') {
      const k = sim.byId(me.killedBy), sp = this.spec;
      const key = `out${sp ? sp.id : -1}`;
      if (this._toastKey !== key) {
        const first = !this._toastKey;
        this._toastKey = key;
        e.toast.hidden = false;
        e.toast.classList.add('out');
        e.toast.innerHTML = `<span class="outx">${icon('i-x')}</span>
          <div class="tt"><b>被 <em style="color:${esc(k ? k.accent : '#000')}">${esc(k ? k.name : '?')}</em> 擊倒・出局</b><small>${sp ? `觀戰中：<em style="color:${esc(sp.accent)}">${esc(sp.name)}</em>・幫隊友看小地圖` : '等待這場結束'}</small></div>`;
        if (first) animate(e.toast, { opacity: [0, 1], scale: [0.85, 1], y: [10, 0] }, spring(300, 22));
      }
    } else if (!me.alive) {
      const k = sim.byId(me.killedBy);
      const left2 = Math.max(0, me.respawnAt - sim.time), total = this.mode === 'team' ? CFG.TEAM_RESPAWN_T : CFG.RESPAWN_T;
      const key = `dead${me.deaths}`;
      if (this._toastKey !== key) {
        this._toastKey = key;
        e.toast.hidden = false;
        e.toast.classList.remove('out');
        e.toast.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" stroke-dasharray="113.1"/><text x="22" y="22.5">3</text></svg>
          <div class="tt"><b>被 <em style="color:${esc(k ? k.accent : '#000')}">${esc(k ? k.name : '?')}</em> 擊倒</b><small>${this.mode === 'team' ? '等一下在自家水晶後面復活' : '馬上在別的巷子復活'}</small></div>`;
        animate(e.toast, { opacity: [0, 1], scale: [0.85, 1], y: [10, 0] }, spring(300, 22));
      }
      const fg = e.toast.querySelector('.fg');
      if (fg) fg.style.strokeDashoffset = `${113.1 * (left2 / total)}`;
      const tx = e.toast.querySelector('text');
      if (tx) tx.textContent = Math.ceil(left2);
    } else if (this._toastKey) {
      this._toastKey = '';
      const t = e.toast;
      const a = animate(t, { opacity: [1, 0], scale: [1, 0.92] }, { duration: 0.25 });
      Promise.resolve(a && a.finished).then(() => { if (!this._toastKey) t.hidden = true; });
    }
  }

  _labels(sim, me, visible, r) {
    const seen = new Set();
    for (const p of sim.players) {
      if (p === me || !p.alive || !visible.has(p.id)) continue;
      const d = Math.hypot(p.x - me.x, p.z - me.z), mate = this.team >= 0 && p.team === me.team;
      if (d > (mate ? 45 : 38)) continue;
      const s = r.toScreen(p.x, 2.08, p.z);
      if (!s.front) continue;
      seen.add(p.id);
      let el = this.labelEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tag';
        el.innerHTML = `<span><i></i><b></b></span><em><u></u></em>`;
        el.querySelector('b').textContent = p.name;
        el.querySelector('span i').style.background = p.accent;
        if (mate) { el.classList.add('mate'); el.style.setProperty('--tc', TEAMS[p.team].color); }
        this.el.labels.appendChild(el);
        this.labelEls.set(p.id, el);
      }
      el.querySelector('u').style.transform = `scaleX(${p.hp / CFG.HP})`;
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%) scale(${Math.max(0.68, 1 - d / 60)})`;
      el.style.opacity = mate ? (d > 37 ? (45 - d) / 8 : 1) : d > 30 ? (38 - d) / 8 : 1;
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) { el.remove(); this.labelEls.delete(id); }
  }

  // 受擊方向：螢幕中央周圍的紅色弧
  hurtFrom(x, z) {
    this.dmgs.push({ x, z, a: 1 });
    this.flashVig = 1;
  }

  _damage(view, me, dt) {
    const busy = this.dmgs.length || (this.lased && this.lased.length);
    if (!busy && !this.dmgDirty) { this._vig(me, dt); return; }
    this.dmgDirty = !!busy;   // 這一格有畫：下一格至少要再清一次
    const c = this.dmg.getContext('2d');
    const W = this.dmg.width, H = this.dmg.height, dpr = this.miniDpr;
    c.clearRect(0, 0, W, H);
    const R = Math.min(W, H) * 0.27;
    for (const d of this.dmgs) {
      d.a -= dt / 1.3;
      if (d.a <= 0) continue;
      const dx = d.x - me.x, dz = d.z - me.z;
      // 來源相對於視線的角度（0 = 正前方、順時針為正）
      const ang = Math.atan2(dx * Math.cos(view.yaw) - dz * Math.sin(view.yaw), -dx * Math.sin(view.yaw) - dz * Math.cos(view.yaw));
      const a0 = ang - Math.PI / 2;
      c.strokeStyle = `rgba(224,62,48,${0.9 * d.a})`;
      c.lineWidth = 9 * dpr; c.lineCap = 'round';
      c.beginPath(); c.arc(W / 2, H / 2, R, a0 - 0.3, a0 + 0.3); c.stroke();
      c.strokeStyle = `rgba(224,62,48,${0.35 * d.a})`;
      c.lineWidth = 3 * dpr;
      c.beginPath(); c.arc(W / 2, H / 2, R + 12 * dpr, a0 - 0.2, a0 + 0.2); c.stroke();
    }
    this.dmgs = this.dmgs.filter((d) => d.a > 0);
    if (this.dmgs.length) this.dmgDirty = true;
    // 被步槍雷射瞄著：那個方向一段一閃一閃的紅色虛線弧
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 70);
    for (const s of this.lased || []) {
      const dx = s.x - me.x, dz = s.z - me.z;
      const ang = Math.atan2(dx * Math.cos(view.yaw) - dz * Math.sin(view.yaw), -dx * Math.sin(view.yaw) - dz * Math.cos(view.yaw)) - Math.PI / 2;
      c.setLineDash([7 * dpr, 6 * dpr]);
      c.strokeStyle = `rgba(255,59,48,${0.45 + 0.5 * pulse})`; c.lineWidth = 5 * dpr; c.lineCap = 'round';
      c.beginPath(); c.arc(W / 2, H / 2, R * 1.12, ang - 0.38, ang + 0.38); c.stroke();
      c.setLineDash([]);
    }
    this._vig(me, dt);
  }

  _vig(me, dt) {
    const hp = me.hp / CFG.HP;
    this.flashVig = Math.max(0, (this.flashVig || 0) - dt * 2.2);
    const o = (me.alive ? Math.min(1, Math.max(0, 0.5 - hp) * 1.6 + this.flashVig) : 0).toFixed(2);
    if (this._vigO !== o) { this._vigO = o; this.el.vig.style.opacity = o; }
  }

  // 上方中央的一行通知（某人離開等）
  toast(text) {
    const el = document.createElement('div');
    el.className = 'chip glass';
    el.textContent = text;
    this.el.feed.prepend(el);
    animate(el, { opacity: [0, 1], y: [-12, 0] }, spring(380, 26));
    setTimeout(() => { const a = animate(el, { opacity: 0 }, { duration: 0.35 }); Promise.resolve(a && a.finished).then(() => el.remove()); }, 3500);
  }

  hitMarker(head) {
    const h = this.el.hit;
    h.classList.toggle('head', head);
    h.querySelector('span').textContent = head ? '爆頭' : '';
    animate(h, { opacity: [1, 1, 0], scale: [1.5, 1, 0.95] }, { duration: 0.42, times: [0, 0.35, 1], ease: 'easeOut' });
  }

  koBanner(name, head) {
    banner(this.el.banner, `<b>KO</b><span class="glass">${esc(name)}${head ? '・爆頭' : ''}</span>`, head);
  }

  feed(k, v, head, meId, w) {
    const who = (p) => (p.id === meId
      ? '<span class="who you"><i style="--c:var(--ink)"></i>你</span>'
      : `<span class="who"><i style="--c:${esc(p.accent)}"></i>${esc(p.name)}</span>`);
    const el = document.createElement('div');
    el.className = 'chip glass';
    const wi = w && WEAPONS[w] ? icon(`i-w-${w}`, 'wpn') : icon('i-burst');
    el.innerHTML = `${who(k)}${wi}${head ? icon('i-target', 'head') : ''}${who(v)}`;
    this.el.feed.prepend(el);
    animate(el, { opacity: [0, 1], y: [-12, 0], scale: [0.9, 1] }, spring(380, 26));
    setTimeout(() => {
      const a = animate(el, { opacity: 0, scale: 0.94 }, { duration: 0.35 });
      Promise.resolve(a && a.finished).then(() => el.remove());
    }, 4200);
    while (this.el.feed.children.length > 4) this.el.feed.lastChild.remove();
  }
}
