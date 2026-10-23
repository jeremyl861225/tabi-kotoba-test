// 介面動態與元件：Motion（motion.dev，vendor/motion.js 掛在 window.Motion）的彈簧、
// 分段選擇器的滑動膠囊、地圖等角縮圖、各畫面的進場。
const M = window.Motion;
const EASE = [0.22, 1, 0.36, 1];
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animate(el, kf, opts) {
  if (!M || !el || (el.length === 0)) return null;
  if (reduced) opts = { duration: 0 };
  return M.animate(el, kf, opts);
}
// 進場動畫結束後把 Motion 寫上的 inline transform 拿掉，CSS 的 :active 縮放才會回來
function settle(anim, els) {
  if (!anim) return;
  const list = els instanceof Element ? [els] : [...els];
  Promise.resolve(anim.finished || anim).then(() => list.forEach((e) => { e.style.transform = ''; e.style.filter = ''; }), () => {});
}

export const spring = (stiffness = 380, damping = 30, extra = {}) => ({ type: 'spring', stiffness, damping, ...extra });
export const stagger = (t, o) => (M ? M.stagger(t, o) : 0);

// ---------- 分段選擇 ----------
export function segSet(seg, value, instant = false) {
  const btns = [...seg.querySelectorAll('button')];
  const b = btns.find((x) => x.dataset.v === String(value));
  btns.forEach((x) => x.classList.toggle('on', x === b));
  const pill = seg.querySelector('.pill');
  if (!b || !pill || !b.offsetWidth) return;
  const x = b.offsetLeft, w = b.offsetWidth;
  if (instant || !M) { pill.style.transform = `translateX(${x}px)`; pill.style.width = `${w}px`; return; }
  animate(pill, { x, width: w }, spring(460, 34));
}

// ---------- 地圖縮圖：白模等角圖 ----------
export function drawMapThumb(cv, data) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.round((cv.clientWidth || 300) * dpr), H = Math.round((cv.clientHeight || 170) * dpr);
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#e9ecf1'); g.addColorStop(1, '#f6f5f2');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const p = data.play, cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
  const A = 0.62, cs = Math.cos(A), sn = Math.sin(A), TILT = 0.56, HK = 0.62;
  const proj = (x, z, h = 0) => {
    const rx = (x - cx) * cs - (z - cz) * sn, rz = (x - cx) * sn + (z - cz) * cs;
    return [rx, rz * TILT - h * HK];
  };
  const span = Math.max(p.maxX - p.minX, p.maxZ - p.minZ) * 0.42;
  const S = Math.min(W, H * 1.75) / (span * 2);
  const ox = W / 2, oy = H * 0.5;
  const P = (x, z, h) => { const [a, b] = proj(x, z, h); return [ox + a * S, oy + b * S]; };
  const sun = [-0.55, -0.35];   // 影子往右下拉
  const bs = data.buildings.map((b) => {
    const pts = []; for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
    let mx = 0, mz = 0; pts.forEach(([x, z]) => { mx += x; mz += z; });
    mx /= pts.length; mz /= pts.length;
    return { pts, h: b.h, depth: proj(mx, mz)[1], mx, mz };
  }).filter((b) => Math.abs(b.mx - cx) < span * 1.6 && Math.abs(b.mz - cz) < span * 1.6);
  // 影子
  c.fillStyle = 'rgba(52,58,78,0.13)';
  for (const b of bs) {
    c.beginPath();
    b.pts.forEach(([x, z], i) => { const [X, Y] = P(x - sun[0] * b.h * 0.9, z - sun[1] * b.h * 0.9, 0); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    c.closePath(); c.fill();
  }
  bs.sort((a, b) => a.depth - b.depth);
  c.lineJoin = 'round';
  for (const b of bs) {
    const n = b.pts.length;
    let ar = 0;
    for (let i = 0; i < n; i++) { const [x0, z0] = b.pts[i], [x1, z1] = b.pts[(i + 1) % n]; ar += x0 * z1 - x1 * z0; }
    const sg = ar > 0 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const [ax, az] = b.pts[i], [bx, bz] = b.pts[(i + 1) % n];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1;
      const nx = (sg * dz) / L, nz = (-sg * dx) / L;
      const ny = nx * sn + nz * cs;            // 法線轉到畫面深度方向，>0 朝向觀者
      if (ny <= 0) continue;
      const lit = Math.max(0, nx * 0.7 + nz * 0.7);
      const v = Math.round(218 + lit * 30);
      c.fillStyle = `rgb(${v},${v},${v + 3})`;
      c.beginPath();
      const p0 = P(ax, az, 0), p1 = P(bx, bz, 0), p2 = P(bx, bz, b.h), p3 = P(ax, az, b.h);
      c.moveTo(...p0); c.lineTo(...p1); c.lineTo(...p2); c.lineTo(...p3); c.closePath(); c.fill();
    }
    c.beginPath();
    b.pts.forEach(([x, z], i) => { const [X, Y] = P(x, z, b.h); i ? c.lineTo(X, Y) : c.moveTo(X, Y); });
    c.closePath();
    c.fillStyle = '#fdfdfb'; c.fill();
    c.strokeStyle = 'rgba(60,66,84,0.16)'; c.lineWidth = 0.8 * dpr; c.stroke();
  }
  // 一道拋物線
  const a0 = P(cx - span * 0.55, cz + span * 0.25, 1.6), a1 = P(cx + span * 0.35, cz - span * 0.1, 1.2);
  const mid = [(a0[0] + a1[0]) / 2, Math.min(a0[1], a1[1]) - H * 0.38];
  c.setLineDash([4 * dpr, 4 * dpr]); c.lineWidth = 1.6 * dpr; c.strokeStyle = 'rgba(47,95,208,0.85)';
  c.beginPath(); c.moveTo(...a0); c.quadraticCurveTo(...mid, ...a1); c.stroke(); c.setLineDash([]);
  c.fillStyle = '#2f3138'; c.beginPath(); c.arc(a1[0], a1[1], 3.2 * dpr, 0, Math.PI * 2); c.fill();
}

// ---------- 進場 ----------
export function menuIn(root) {
  const t = root.querySelectorAll('.title span');
  settle(animate(t, { opacity: [0, 1], y: [28, 0], filter: ['blur(10px)', 'blur(0px)'] }, { delay: stagger(0.09), duration: 1, ease: EASE }), t);
  const b = root.querySelectorAll('.brand .en, .brand .tagline, .cta > *');
  settle(animate(b, { opacity: [0, 1], y: [12, 0] }, { delay: stagger(0.06, { startDelay: 0.25 }), duration: 0.8, ease: EASE }), b);
  const o = root.querySelector('.opts');
  settle(animate(o, { opacity: [0, 1], x: [30, 0], scale: [0.96, 1] }, spring(200, 24, { delay: 0.12 })), o);
  const oc = root.querySelectorAll('.opts > *');
  settle(animate(oc, { opacity: [0, 1], y: [10, 0] }, { delay: stagger(0.05, { startDelay: 0.28 }), duration: 0.6, ease: EASE }), oc);
}

export function popIn(panel) {
  settle(animate(panel, { opacity: [0, 1], filter: ['blur(8px)', 'blur(0px)'] }, { duration: 0.35, ease: EASE }), panel);
  settle(animate(panel, { scale: [0.92, 1], y: [16, 0] }, spring(320, 24)), panel);
}

export function hudIn(root) {
  const els = root.querySelectorAll('.pause, .vitals, .score, .minimap');
  settle(animate(els, { opacity: [0, 1], y: [-18, 0], scale: [0.9, 1] }, spring(260, 22, { delay: stagger(0.06) })), els);
  // 搖桿自己有 transform（推動、按下放大），這裡只動透明度
  animate(document.querySelectorAll('#touch .stick.right'), { opacity: [0, 1] }, { duration: 0.6, delay: 0.25 });
}

export function bump(el, s = 1.3) {
  animate(el, { scale: [s, 1] }, spring(500, 15));
}

export function banner(el, html, head) {
  el.innerHTML = html;
  el.querySelector('b')?.classList.toggle('head', !!head);
  animate(el, { opacity: [0, 1, 1, 0], scale: [0.55, 1.08, 1, 0.96] }, { duration: 1.5, times: [0, 0.18, 0.75, 1], ease: 'easeOut' });
}

export function flash() {
  animate(document.getElementById('flash'), { opacity: [0, 0.85, 0] }, { duration: 0.9, times: [0, 0.25, 1], ease: 'easeInOut' });
}
