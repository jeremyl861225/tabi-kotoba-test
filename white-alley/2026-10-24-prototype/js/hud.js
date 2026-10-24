// HUD：血量（含受傷殘影）、石頭、比分與倒數、右上小地圖、受擊方向、擊倒訊息、敵人名牌、陣亡倒數、KO 橫幅。
import { CFG } from './config.js';
import { WEAPONS } from './weapons.js';
import { animate, banner, bump, spring } from './ui.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = (id, cls = '') => `<svg class="i ${cls}"><use href="#${id}"/></svg>`;

export class Hud {
  constructor(root, map, weapon = 'stone') {
    this.root = root;
    this.map = map;
    this.W = WEAPONS[weapon] || WEAPONS.stone;
    root.innerHTML = `
      <button class="pause glass lens" aria-label="暫停" data-bezel="14" data-refract="6">${icon('i-pause')}</button>
      <div class="vitals glass lens" data-bezel="14" data-refract="7">
        <div class="hp"><div class="bar"><i class="ghost"></i><i class="fill"></i></div><em>100</em></div>
        <div class="ammo"></div><div class="rl" hidden><i></i><span>換彈</span></div>
      </div>
      <div class="score glass lens" data-bezel="16" data-refract="7">
        <div class="ko"><b>0</b><span>KO</span></div><i class="sep"></i>
        <div class="meta"><span class="rank"></span><span class="clock">5:00</span></div>
      </div>
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
      ammo: $('.ammo', root), ko: $('.ko b', root), rank: $('.rank', root), clock: $('.clock', root),
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
    // 剛出手的人：在小地圖擴散一圈
    for (const pg of this.pings) {
      const a = 1 - (sim.time - pg.t) / 1.6;
      if (a <= 0) continue;
      const [x, y] = to(pg.x, pg.z);
      c.strokeStyle = `rgba(224,62,48,${a})`; c.lineWidth = 1.6 * dpr;
      c.beginPath(); c.arc(x, y, (4 + (1 - a) * 11) * dpr, 0, Math.PI * 2); c.stroke();
    }
    this.pings = this.pings.filter((pg) => sim.time - pg.t < 1.6);
    // 看得到的敵人
    for (const p of sim.players) {
      if (p === me || !p.alive || !visible.has(p.id)) continue;
      const [x, y] = to(p.x, p.z);
      c.fillStyle = '#fff';
      c.beginPath(); c.arc(x, y, 5.6 * dpr, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#e03e30';
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

  update(sim, me, view, visible, r, dt, aim = null) {
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
    const rank = sim.ranking().indexOf(me) + 1;
    e.rank.textContent = `第 ${rank} / ${sim.players.length}`;
    const left = Math.max(0, sim.matchTime - sim.time);
    e.clock.textContent = `${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
    e.clock.classList.toggle('hurry', left < 30 && sim.state === 'play');
    // 準心＝落點：指到人變紅、太遠（丟不到）變灰並提示
    e.cross.classList.toggle('aim', me.aiming);
    const melee = W.kind === 'melee';
    e.cross.classList.toggle('lock', !!(aim && (melee ? aim.inReach : aim.hit && aim.hit.player)));
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
    this.drawMini(sim, me, view, visible);
    this._labels(sim, me, visible, r);
    this._damage(view, me, dt);

    // 陣亡倒數（圓環＋擊倒者）
    if (!me.alive) {
      const k = sim.byId(me.killedBy);
      const left2 = Math.max(0, me.respawnAt - sim.time);
      const key = `dead${me.deaths}`;
      if (this._toastKey !== key) {
        this._toastKey = key;
        e.toast.hidden = false;
        e.toast.innerHTML = `<svg class="ring" viewBox="0 0 44 44"><circle class="bg" cx="22" cy="22" r="18"/><circle class="fg" cx="22" cy="22" r="18" stroke-dasharray="113.1"/><text x="22" y="22.5">3</text></svg>
          <div class="tt"><b>被 <em style="color:${esc(k ? k.accent : '#000')}">${esc(k ? k.name : '?')}</em> 擊倒</b><small>馬上在別的巷子復活</small></div>`;
        animate(e.toast, { opacity: [0, 1], scale: [0.85, 1], y: [10, 0] }, spring(300, 22));
      }
      const fg = e.toast.querySelector('.fg');
      if (fg) fg.style.strokeDashoffset = `${113.1 * (left2 / CFG.RESPAWN_T)}`;
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
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d > 38) continue;
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
        this.el.labels.appendChild(el);
        this.labelEls.set(p.id, el);
      }
      el.querySelector('u').style.transform = `scaleX(${p.hp / CFG.HP})`;
      el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%) scale(${Math.max(0.68, 1 - d / 60)})`;
      el.style.opacity = d > 30 ? (38 - d) / 8 : 1;
    }
    for (const [id, el] of this.labelEls) if (!seen.has(id)) { el.remove(); this.labelEls.delete(id); }
  }

  // 受擊方向：螢幕中央周圍的紅色弧
  hurtFrom(x, z) {
    this.dmgs.push({ x, z, a: 1 });
    this.flashVig = 1;
  }

  _damage(view, me, dt) {
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
    const hp = me.hp / CFG.HP;
    this.flashVig = Math.max(0, (this.flashVig || 0) - dt * 2.2);
    this.el.vig.style.opacity = me.alive ? Math.min(1, Math.max(0, 0.5 - hp) * 1.6 + this.flashVig) : 0;
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
