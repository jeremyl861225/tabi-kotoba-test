// 操作：左搖桿開車、右搖桿轉炮塔（放開後炮塔停在原本的方向）、發射鈕、地雷鈕。
// 輕點右搖桿也會發射。電腦：WASD 開車、滑鼠指哪炮塔轉哪、左鍵／空白鍵發射、右鍵／E 放地雷。
// 手把（Gamepad API）：左類比開車、右類比轉炮塔、RT／RB／A 發射、LT／LB／B 地雷、Start 暫停。
// 同機雙人：1P 用左側、2P 用右側（各自一組搖桿與按鈕）。
const KNOB = 44;          // 搖桿可推的距離（CSS px）
const DEAD = 0.16;
const AIM_DEAD = 12;      // 右搖桿推超過這麼多才轉炮塔（px）
const TAP_MS = 230, TAP_PX = 14;

// 圖示（同一套 1.8 線寬、圓端點）
const ICON = {
  // 發射：往右上飛的炮彈剖面＋兩條速度線
  fire: '<svg class="i" viewBox="0 0 24 24"><g transform="rotate(-45 12 12)"><path d="M9 9.2h6.2a2.8 2.8 0 0 1 0 5.6H9z" class="f"/><path d="M3.5 10.2h3.2M4.8 13.8h2"/></g></svg>',
  // 地雷：俯視的黃色圓殼＋深色外環＋紅燈（v5：圓頂像服務鈴）
  mine: '<svg class="i mine" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.2" fill="#6E5A2E" stroke="none"/><circle cx="12" cy="12" r="6.6" fill="#F2C94C" stroke="none"/><circle cx="10.2" cy="10" r="2" fill="#FFF0B8" stroke="none" opacity="0.6"/><circle cx="12" cy="12" r="2.2" fill="#E5484D" stroke="none"/></svg>',
  aim: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/></svg>',
  move: '<svg class="i" viewBox="0 0 24 24"><path d="M12 4.5l-2 2.2h4zM12 19.5l-2-2.2h4zM4.5 12l2.2-2v4zM19.5 12l-2.2-2v4z" class="f"/></svg>',
};

export class Input {
  constructor(root, { onPause, haptic, aimAngleAt } = {}) {
    this.root = root;
    this.onPause = onPause || (() => {});
    this.haptic = haptic || (() => {});
    this.aimAngleAt = aimAngleAt || (() => null);   // (slot, clientX, clientY) → 場地上的角度（滑鼠瞄準用）
    this.pads = new Map();    // slot → { el, move, aim, fire, mine, state }
    this.keys = new Set();
    this.enabled = false;
    this.kind = 'none';
    this.mouse = null;        // 最後一次滑鼠位置
    this.mouseFire = 0;
    this.gpPrev = new Map();
    this.releaseFire = false;
    const opt = { passive: false };
    root.addEventListener('pointerdown', (e) => this.down(e), opt);
    window.addEventListener('pointermove', (e) => this.move(e), opt);
    window.addEventListener('pointerup', (e) => this.up(e), opt);
    window.addEventListener('pointercancel', (e) => this.up(e, true), opt);
    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); for (const p of this.pads.values()) this.releaseAll(p); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // kind：'solo'（1 人）／'duo'（同機 2 人）／'none'（只看，例如客人在大廳）
  setLayout(kind, slots = [0]) {
    this.kind = kind;
    this.mouse = null;   // 換局時忘掉上一局滑鼠停的位置（不然新的一局炮塔會自己轉過去）
    this.root.innerHTML = '';
    this.pads.clear();
    if (kind === 'none') return;
    for (const slot of slots) {
      const el = document.createElement('div');
      el.className = `pad pad-${slot}`;
      el.dataset.slot = slot;
      el.innerHTML = `
        <div class="stick move"><div class="base glass"></div><div class="knob">${ICON.move}</div></div>
        <div class="stick aim"><div class="base glass"></div><div class="knob">${ICON.aim}</div></div>
        <button class="btn-fire glass" aria-label="發射">${ICON.fire}<span class="pips"></span></button>
        <button class="btn-mine glass" aria-label="地雷">${ICON.mine}<span class="badge"></span></button>`;
      this.root.appendChild(el);
      const p = {
        slot, el,
        move: { el: el.querySelector('.move'), id: null, ox: 0, oy: 0, home: { x: 0, y: 0 } },
        aim: { el: el.querySelector('.aim'), id: null, c: { x: 0, y: 0 }, t0: 0, far: 0 },
        fireEl: el.querySelector('.btn-fire'), mineEl: el.querySelector('.btn-mine'),
        state: { mx: 0, my: 0, aim: null, fire: 0, mine: 0 },
      };
      this.pads.set(slot, p);
    }
    if (this.rect) this.layout(this.rect);
  }

  setEnabled(on) {
    this.enabled = on;
    this.root.classList.toggle('off', !on);
    if (!on) for (const p of this.pads.values()) this.releaseAll(p);
  }

  // field：畫面上的場地範圍 { x, y, w, h }（CSS px）。控制鈕放在場地兩側的空白
  layout(field) {
    this.rect = field;
    const W = window.innerWidth, H = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    const sl = inset('--sl'), sr = inset('--sr'), sb = Math.max(inset('--sb'), 6);
    const big = Math.min(W, H) > 600 ? 1.2 : 1;
    document.documentElement.style.setProperty('--pad-k', big);
    const Lw = field.x, Rw = W - field.x - field.w;
    const put = (el, x, y) => { el.style.left = `${x}px`; el.style.top = `${y}px`; };
    for (const p of this.pads.values()) {
      let mv, am, fi, mi;
      if (this.kind === 'solo') {
        const lx = Math.max(sl + 74 * big, Lw / 2), rx = W - Math.max(sr + 74 * big, Rw / 2);
        mv = { x: lx, y: H - sb - 84 * big };
        am = { x: rx, y: H - sb - 84 * big };
        // 發射鈕對齊瞄準搖桿、地雷鈕對齊開車搖桿（同一條垂直軸）
        fi = { x: rx, y: am.y - 122 * big };
        mi = { x: lx, y: mv.y - 118 * big };
      } else {
        // 雙人：各自一側，上面瞄準、下面開車
        const left = p.slot === 0;
        const cx = left ? Math.max(sl + 70 * big, Lw / 2) : W - Math.max(sr + 70 * big, Rw / 2);
        const dir = left ? 1 : -1;
        am = { x: cx, y: Math.max(98 * big, H * 0.27) };
        mv = { x: cx, y: H - sb - 82 * big };
        fi = { x: cx + dir * 30 * big, y: am.y + 104 * big };
        mi = { x: cx - dir * 26 * big, y: fi.y + 64 * big };
      }
      p.move.home = mv;
      put(p.move.el, mv.x, mv.y);
      put(p.aim.el, am.x, am.y);
      p.aim.c = am;
      put(p.fireEl, fi.x, fi.y);
      put(p.mineEl, mi.x, mi.y);
      p.zone = this.kind === 'solo'
        ? { x0: 0, x1: W * 0.42, y0: H * 0.3, y1: H }
        : (p.slot === 0 ? { x0: 0, x1: W * 0.3, y0: H * 0.55, y1: H } : { x0: W * 0.7, x1: W, y0: H * 0.55, y1: H });
    }
  }

  padAt(x, y, test) {
    for (const p of this.pads.values()) if (test(p, x, y)) return p;
    return null;
  }

  down(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (e.target.closest && e.target.closest('button')) return;
      e.preventDefault();
      if (e.button === 0) this.mouseFire++;
      if (e.button === 2) { const p = this.primary(); if (p) p.state.mine++; }
      return;
    }
    const x = e.clientX, y = e.clientY;
    const hit = (el, r) => { const b = el.getBoundingClientRect(); return Math.hypot(x - (b.left + b.width / 2), y - (b.top + b.height / 2)) < r; };
    const k = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad-k')) || 1;
    // 按鈕
    for (const p of this.pads.values()) {
      if (hit(p.fireEl, 46 * k)) { e.preventDefault(); this.press(p, 'fire'); return; }
      if (hit(p.mineEl, 34 * k)) { e.preventDefault(); this.press(p, 'mine'); return; }
    }
    // 右搖桿（固定位置）
    for (const p of this.pads.values()) {
      if (p.aim.id == null && Math.hypot(x - p.aim.c.x, y - p.aim.c.y) < 78 * k) {
        e.preventDefault();
        p.aim.id = e.pointerId; p.aim.t0 = performance.now(); p.aim.far = 0;
        p.aim.el.classList.add('on');
        this.aimMove(p, x, y);
        return;
      }
    }
    // 左搖桿（在左下區域哪裡按就從哪裡出現）
    for (const p of this.pads.values()) {
      const z = p.zone;
      if (p.move.id == null && x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) {
        e.preventDefault();
        const H = window.innerHeight;
        p.move.id = e.pointerId;
        p.move.ox = Math.max(z.x0 + 60, Math.min(z.x1 - 20, x));
        p.move.oy = Math.max(z.y0 + 40, Math.min(H - 60, y));
        p.move.el.style.left = `${p.move.ox}px`; p.move.el.style.top = `${p.move.oy}px`;
        p.move.el.classList.add('on');
        this.knob(p.move.el, 0, 0);
        return;
      }
    }
  }

  press(p, what) {
    p.state[what]++;
    const el = what === 'fire' ? p.fireEl : p.mineEl;
    el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit');
    this.haptic(what === 'fire' ? 'tap' : 'mine');
  }

  move(e) {
    if (e.pointerType === 'mouse') { this.mouse = { x: e.clientX, y: e.clientY }; return; }
    if (!this.enabled) return;
    for (const p of this.pads.values()) {
      if (p.move.id === e.pointerId) {
        let dx = e.clientX - p.move.ox, dy = e.clientY - p.move.oy;
        const d = Math.hypot(dx, dy);
        if (d > KNOB) { dx *= KNOB / d; dy *= KNOB / d; }
        this.knob(p.move.el, dx, dy);
        p.state.mx = dx / KNOB; p.state.my = dy / KNOB;
        e.preventDefault();
        return;
      }
      if (p.aim.id === e.pointerId) { this.aimMove(p, e.clientX, e.clientY); e.preventDefault(); return; }
    }
  }

  aimMove(p, x, y) {
    let dx = x - p.aim.c.x, dy = y - p.aim.c.y;
    const d = Math.hypot(dx, dy);
    p.aim.far = Math.max(p.aim.far, d);
    if (d > AIM_DEAD) p.state.aim = Math.atan2(dy, dx);
    if (d > KNOB) { dx *= KNOB / d; dy *= KNOB / d; }
    this.knob(p.aim.el, dx, dy);
  }

  up(e, cancelled = false) {
    if (e.pointerType === 'mouse') return;
    for (const p of this.pads.values()) {
      if (p.move.id === e.pointerId) {
        p.move.id = null; p.state.mx = p.state.my = 0;
        p.move.el.classList.remove('on');
        this.knob(p.move.el, 0, 0, true);
        const h = p.move.home; p.move.el.style.left = `${h.x}px`; p.move.el.style.top = `${h.y}px`;
        return;
      }
      if (p.aim.id === e.pointerId) {
        p.aim.id = null;
        p.aim.el.classList.remove('on');
        this.knob(p.aim.el, 0, 0, true);
        const quick = performance.now() - p.aim.t0 < TAP_MS && p.aim.far < TAP_PX;
        if (!cancelled && (quick || (this.releaseFire && p.aim.far > AIM_DEAD))) this.press(p, 'fire');
        return;
      }
    }
  }

  releaseAll(p) {
    p.move.id = null; p.aim.id = null;
    p.state.mx = p.state.my = 0;
    p.move.el.classList.remove('on'); p.aim.el.classList.remove('on');
    this.knob(p.move.el, 0, 0, true); this.knob(p.aim.el, 0, 0, true);
  }

  knob(el, dx, dy, ret = false) {
    const k = el.querySelector('.knob');
    k.classList.toggle('ret', ret);
    k.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  key(e, down) {
    if (down) {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (!this.enabled) return;
      const p = this.primary();
      if (e.code === 'Space' || e.code === 'KeyJ') { if (p) p.state.fire++; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'ShiftLeft' || e.code === 'KeyK') { if (p) p.state.mine++; }
      if (e.code === 'Escape' || e.code === 'KeyP') this.onPause();
    } else this.keys.delete(e.code);
  }

  // 鍵盤滑鼠控制的是第一位本機玩家（連線的客人是 2P～4P，也是他）
  primary() { return this.pads.values().next().value || null; }

  // 每畫格呼叫：回傳每位本機玩家這段時間的輸入（fire、mine 是按了幾下）
  poll() {
    const out = new Map();
    const k = this.keys;
    const first = this.primary();
    let idx = 0;
    for (const p of this.pads.values()) {
      const s = p.state;
      let mx = s.mx, my = s.my;
      const second = idx++ === 1;
      if (p === first) {
        if (k.has('KeyW') || (this.kind === 'solo' && k.has('ArrowUp'))) my -= 1;
        if (k.has('KeyS') || (this.kind === 'solo' && k.has('ArrowDown'))) my += 1;
        if (k.has('KeyA') || (this.kind === 'solo' && k.has('ArrowLeft'))) mx -= 1;
        if (k.has('KeyD') || (this.kind === 'solo' && k.has('ArrowRight'))) mx += 1;
        if (this.mouse && this.enabled) { const a = this.aimAngleAt(p.slot, this.mouse.x, this.mouse.y); if (a != null) s.aim = a; }
        s.fire += this.mouseFire; this.mouseFire = 0;
      } else if (second && this.kind === 'duo') {
        if (k.has('ArrowUp')) my -= 1;
        if (k.has('ArrowDown')) my += 1;
        if (k.has('ArrowLeft')) mx -= 1;
        if (k.has('ArrowRight')) mx += 1;
      }
      const m = Math.hypot(mx, my);
      if (m > 1) { mx /= m; my /= m; }
      if (m < DEAD) { mx = 0; my = 0; }
      out.set(p.slot, { mx, my, aim: s.aim, fire: s.fire, mine: s.mine });
      s.fire = 0; s.mine = 0;
    }
    this.pollGamepads(out);
    return out;
  }

  pollGamepads(out) {
    if (!navigator.getGamepads) return;
    const pads = [...navigator.getGamepads()].filter(Boolean);
    const slots = [...this.pads.keys()];
    pads.forEach((g, i) => {
      const slot = slots[i];
      if (slot == null) return;
      const o = out.get(slot);
      const prev = this.gpPrev.get(g.index) || {};
      const b = (n) => !!(g.buttons[n] && (g.buttons[n].pressed || g.buttons[n].value > 0.5));
      const ax = (n) => g.axes[n] || 0;
      const lx = ax(0), ly = ax(1);
      if (Math.hypot(lx, ly) > 0.2) { o.mx = lx; o.my = ly; }
      const rx = ax(2), ry = ax(3);
      if (Math.hypot(rx, ry) > 0.35) { o.aim = Math.atan2(ry, rx); this.pads.get(slot).state.aim = o.aim; }
      const fire = b(7) || b(5) || b(0), mine = b(6) || b(4) || b(1), start = b(9);
      if (fire && !prev.fire) o.fire++;
      if (mine && !prev.mine) o.mine++;
      if (start && !prev.start) this.onPause();
      this.gpPrev.set(g.index, { fire, mine, start });
    });
  }

  // 發射鈕下方的小點：還能再打幾發
  setAmmo(slot, n, max) {
    const p = this.pads.get(slot);
    if (!p) return;
    const key = `${n}/${max}`;
    if (p.ammoKey === key) return;
    p.ammoKey = key;
    const pips = p.fireEl.querySelector('.pips');
    pips.innerHTML = Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
    p.fireEl.classList.toggle('empty', n <= 0);
  }

  setMines(slot, n) {
    const p = this.pads.get(slot);
    if (!p || p.mineN === n) return;
    p.mineN = n;
    p.mineEl.classList.toggle('empty', n <= 0);
    p.mineEl.querySelector('.badge').textContent = Math.max(0, n);
  }
}
