// 操作：左下浮動搖桿（移動）、右中搖桿（按住蓄力＋轉視角、放開投擲、拖到 ✕ 取消）、
// 右半邊空白處拖曳（純轉視角）、電腦 WASD＋滑鼠。
const DEG = Math.PI / 180;
const KNOB = 52;          // 搖桿可推的半徑（CSS px）

export class Input {
  constructor(root, settings) {
    this.root = root;
    this.settings = settings;
    this.move = { x: 0, y: 0 };
    this.lookRate = { x: 0, y: 0 };    // 右搖桿（-1..1）
    this.lookAcc = { x: 0, y: 0 };     // 觸控板／滑鼠累積（弧度）
    this.aimHeld = false; this.aimLatch = false; this.cancelLatch = false;
    this.keys = new Set();
    this.touch = { left: null, right: null, pads: new Map() };
    this.overCancel = false;
    this.enabled = false;

    root.innerHTML = `
      <div class="stick left" hidden><div class="base glass"></div><div class="knob"></div></div>
      <div class="stick right"><div class="base glass lens" data-bezel="18" data-refract="9"></div>
        <svg class="ring" viewBox="0 0 138 138"><circle class="pw" cx="69" cy="69" r="66"/></svg>
        <div class="knob"><svg class="i"><use href="#i-pebble"/></svg></div><span class="need">沒石頭・去石堆補</span></div>
      <div class="cancel glass" hidden><svg class="i"><use href="#i-x"/></svg></div>`;
    this.elL = root.querySelector('.stick.left');
    this.elR = root.querySelector('.stick.right');
    this.elC = root.querySelector('.cancel');
    this.pw = root.querySelector('.pw');

    const opt = { passive: false };
    root.addEventListener('pointerdown', (e) => this.down(e), opt);
    window.addEventListener('pointermove', (e) => this.moveEv(e), opt);
    window.addEventListener('pointerup', (e) => this.up(e), opt);
    window.addEventListener('pointercancel', (e) => this.up(e, true), opt);
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); });
    window.addEventListener('keyup', (e) => { this.keys.delete(e.code); });
    window.addEventListener('blur', () => { this.keys.clear(); if (this.aimHeld) this.release(); });
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== this.root || !this.enabled) return;
      const k = 0.0022 * this.settings.sens;
      this.lookAcc.x -= e.movementX * k;
      this.lookAcc.y -= e.movementY * k;
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  layout() {
    const r = this.elR.getBoundingClientRect();
    this.rc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    this.cc = { x: this.rc.x - 96, y: this.rc.y - 86 };   // 左上斜方：避開右上角的小地圖
    this.elC.style.left = `${this.cc.x}px`; this.elC.style.top = `${this.cc.y}px`;
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) this.reset();
  }

  reset() {
    this.aimLatch = false; this.cancelLatch = false;
    this.move.x = this.move.y = 0;
    this.lookRate.x = this.lookRate.y = 0;
    this.aimHeld = false;
    this.touch.left = this.touch.right = null;
    this.touch.pads.clear();
    this.elL.hidden = true;
    this.elC.hidden = true;
    this.elR.classList.remove('on');
    this.setKnob(this.elR, 0, 0);
  }

  // 放開時 knob 帶彈簧回中心（.ret 的 CSS 過渡），拖曳中直接跟手
  setKnob(el, dx, dy, ret = false) {
    const k = el.querySelector('.knob');
    k.classList.toggle('ret', ret);
    k.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  down(e) {
    if (!this.enabled) return;
    e.preventDefault();
    if (e.pointerType === 'mouse') {
      if (document.pointerLockElement !== this.root) { this.root.requestPointerLock?.(); return; }
      if (e.button === 0) this.press();
      if (e.button === 2 && this.aimHeld) { this.aimHeld = false; this.cancelLatch = true; }
      return;
    }
    this.root.setPointerCapture?.(e.pointerId);
    const W = window.innerWidth, H = window.innerHeight;
    const dR = Math.hypot(e.clientX - this.rc.x, e.clientY - this.rc.y);
    if (dR < 88 && this.touch.right == null) {
      this.touch.right = e.pointerId;
      this.elR.classList.add('on');
      this.press();
      this.elC.hidden = false;
      this.moveRight(e.clientX, e.clientY);
    } else if (e.clientX < W * 0.45 && e.clientY > H * 0.3 && this.touch.left == null) {
      this.touch.left = { id: e.pointerId, x: Math.max(70, e.clientX), y: Math.min(H - 70, e.clientY) };
      this.elL.hidden = false;
      this.elL.style.left = `${this.touch.left.x}px`; this.elL.style.top = `${this.touch.left.y}px`;
      this.setKnob(this.elL, 0, 0);
    } else if (e.clientX >= W * 0.45) {
      this.touch.pads.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
  }

  moveEv(e) {
    if (!this.enabled || e.pointerType === 'mouse') return;
    const L = this.touch.left;
    if (L && L.id === e.pointerId) {
      let dx = e.clientX - L.x, dy = e.clientY - L.y;
      const d = Math.hypot(dx, dy);
      if (d > KNOB) { dx *= KNOB / d; dy *= KNOB / d; }
      this.setKnob(this.elL, dx, dy);
      this.move.x = dx / KNOB; this.move.y = -dy / KNOB;
      e.preventDefault();
    } else if (this.touch.right === e.pointerId) {
      this.moveRight(e.clientX, e.clientY);
      e.preventDefault();
    } else if (this.touch.pads.has(e.pointerId)) {
      const p = this.touch.pads.get(e.pointerId);
      const k = 0.0045 * this.settings.sens;
      this.lookAcc.x -= (e.clientX - p.x) * k;
      this.lookAcc.y -= (e.clientY - p.y) * k;
      p.x = e.clientX; p.y = e.clientY;
      e.preventDefault();
    }
  }

  moveRight(x, y) {
    let dx = x - this.rc.x, dy = y - this.rc.y;
    const d = Math.hypot(dx, dy);
    // 拖到搖桿上方的 ✕：放開就取消；在那一區不轉視角
    this.overCancel = Math.hypot(x - this.cc.x, y - this.cc.y) < 46;
    this.elC.classList.toggle('hot', this.overCancel);
    // 正往 ✕ 拖過去的時候也停止轉視角，取消後畫面不會歪掉
    const cx = this.cc.x - this.rc.x, cy = this.cc.y - this.rc.y;
    const toward = d > KNOB * 0.85 && (dx * cx + dy * cy) / (d * Math.hypot(cx, cy)) > Math.cos(32 * DEG);
    if (d > KNOB) { dx *= KNOB / d; dy *= KNOB / d; }
    this.setKnob(this.elR, dx, dy);
    if (this.overCancel || toward) { this.lookRate.x = this.lookRate.y = 0; return; }
    const curve = (v) => Math.sign(v) * Math.abs(v) ** 1.7;
    this.lookRate.x = curve(dx / KNOB);
    this.lookRate.y = curve(dy / KNOB);
  }

  up(e, cancelled = false) {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 && this.aimHeld) this.release();
      return;
    }
    if (this.touch.left && this.touch.left.id === e.pointerId) {
      this.touch.left = null; this.move.x = this.move.y = 0; this.elL.hidden = true;
    } else if (this.touch.right === e.pointerId) {
      this.touch.right = null;
      this.lookRate.x = this.lookRate.y = 0;
      this.setKnob(this.elR, 0, 0, true);
      this.elR.classList.remove('on');
      this.elC.hidden = true; this.elC.classList.remove('hot');
      if (this.overCancel || cancelled) { this.aimHeld = false; this.cancelLatch = true; } else this.release();
      this.overCancel = false;
    } else this.touch.pads.delete(e.pointerId);
  }

  press() { this.aimHeld = true; this.aimLatch = true; }
  release() { this.aimHeld = false; }

  // 每畫格呼叫：回傳移動（本地座標：x 右、y 前）與這格的視角變化（弧度）
  frame(dt) {
    let mx = this.move.x, my = this.move.y;
    const k = this.keys;
    if (k.has('KeyW') || k.has('ArrowUp')) my += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) my -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) mx += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) mx -= 1;
    const s = this.settings.sens;
    const dyaw = -this.lookRate.x * 190 * DEG * s * dt + this.lookAcc.x;
    const dpitch = -this.lookRate.y * 105 * DEG * s * dt + this.lookAcc.y;
    this.lookAcc.x = this.lookAcc.y = 0;
    return { mx, my, dyaw, dpitch };
  }

  // 每個模擬 tick 取一次：按下至少讓模擬看到一個 tick 的 aim=true
  tickAim() {
    const aim = this.aimHeld || this.aimLatch;
    this.aimLatch = false;
    const cancel = this.cancelLatch && !aim;
    if (cancel) this.cancelLatch = false;
    return { aim, cancel };
  }

  setCharge(c, active) {
    const L = 2 * Math.PI * 66;
    this.pw.style.strokeDasharray = `${L}`;
    this.pw.style.strokeDashoffset = `${L * (1 - (active ? c : 0))}`;
    this.elR.classList.toggle('full', active && c >= 1);
  }

  setStones(n) { this.elR.classList.toggle('empty', n <= 0); }
}
