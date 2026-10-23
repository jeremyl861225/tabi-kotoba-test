// Liquid Glass 折射（從 rx1r3-explode 移植；白巷用亮玻璃，所以亮度改成 1.05）
// 做法：為每個 .lens 元素依實際尺寸與圓角，現場畫一張「凸面斜角」位移貼圖（RGB 128 = 不位移），
// 再用 SVG feDisplacementMap 套在 backdrop-filter 上，讓玻璃邊緣把後面的 3D 畫面真的折彎。
// 只有 Chromium 支援 backdrop-filter: url()；Safari／Firefox 保留 CSS 裡的磨砂模糊，不受影響。
const NS = 'http://www.w3.org/2000/svg';
const N_GLASS = 1.5; // 玻璃折射率

function chromiumLike() {
  if (typeof CSS === 'undefined' || !CSS.supports) return false;
  if (!CSS.supports('backdrop-filter', 'url(#x)')) return false;
  const ua = navigator.userAgent;
  return /Chrome\//.test(ua) && !/Firefox\//.test(ua);
}

/** 凸面方圓（squircle）高度曲線的斜率；u=0 在邊緣、u=1 在斜角內緣 */
function slope(u) {
  const a = 1 - u;
  return Math.pow(a, 3) * Math.pow(Math.max(1 - Math.pow(a, 4), 1e-6), -0.75);
}
/** 依 Snell 定律把斜率換成橫向偏移量（未正規化） */
function lateral(u, k) {
  const th = Math.atan(slope(Math.max(u, 0.04)) * k);
  return Math.tan(th - Math.asin(Math.sin(th) / N_GLASS));
}

/** 產生位移貼圖（PNG dataURL）。往內取樣，永遠不會抓到元素外面的像素。 */
function makeMap(w, h, r, bezel, k) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  const hx = w / 2, hy = h / 2;
  r = Math.min(r, hx, hy);
  const norm = lateral(0, k);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5 - hx, py = y + 0.5 - hy;
      const qx = Math.abs(px) - (hx - r), qy = Math.abs(py) - (hy - r);
      const out = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const din = -out; // 離邊緣的距離（內側為正）
      let vx = 0, vy = 0;
      if (din < bezel) {
        const u = Math.max(din, 0) / bezel;
        const m = Math.min(1, lateral(u, k) / norm);
        // 外向法線
        let nx, ny;
        if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
        else if (qx > qy) { nx = Math.sign(px); ny = 0; }
        else { nx = 0; ny = Math.sign(py); }
        vx = -nx * m; vy = -ny * m; // 往內取樣
      }
      const i = (y * w + x) * 4;
      d[i] = 128 + 127 * vx; d[i + 1] = 128 + 127 * vy; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function initGlass() {
  const on = chromiumLike();
  document.documentElement.classList.toggle('lg-refract', on);
  if (!on) return { add() {} };

  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'position:absolute;pointer-events:none';
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);
  document.body.appendChild(svg);

  let seq = 0;
  const state = new WeakMap();

  function build(el) {
    if (!el.isConnected) return;
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width), h = Math.round(rect.height);
    if (w < 8 || h < 8) return;
    const st = state.get(el) || { id: 'lg' + (++seq), w: 0, h: 0 };
    if (st.w === w && st.h === h) return;
    st.w = w; st.h = h;
    const cs = getComputedStyle(el);
    const r = parseFloat(cs.borderTopLeftRadius) || 0;
    const bezel = Math.min(parseFloat(el.dataset.bezel) || 18, Math.min(w, h) / 2);
    const maxOff = parseFloat(el.dataset.refract) || 10;
    const url = makeMap(w, h, r, bezel, 1.0);
    let f = defs.querySelector('#' + st.id);
    if (!f) { f = document.createElementNS(NS, 'filter'); f.setAttribute('id', st.id); defs.appendChild(f); }
    f.setAttribute('filterUnits', 'userSpaceOnUse');
    f.setAttribute('primitiveUnits', 'userSpaceOnUse');
    f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0');
    f.setAttribute('width', String(w)); f.setAttribute('height', String(h));
    f.innerHTML =
      `<feImage href="${url}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" result="map"/>` +
      `<feDisplacementMap in="SourceGraphic" in2="map" scale="${maxOff * 2}" xChannelSelector="R" yChannelSelector="G"/>`;
    const blur = el.dataset.blur || '6';
    const bf = `url(#${st.id}) blur(${blur}px) saturate(1.9) brightness(1.05)`;
    el.style.backdropFilter = bf;
    el.style.webkitBackdropFilter = bf;
    state.set(el, st);
  }

  const pending = new Set();
  let raf = 0;
  const flush = () => { raf = 0; pending.forEach(build); pending.clear(); };
  const ro = new ResizeObserver((es) => {
    es.forEach((e) => pending.add(e.target));
    if (!raf) raf = requestAnimationFrame(flush);
  });
  const add = (root = document) => {
    root.querySelectorAll('.lens').forEach((el) => { ro.observe(el); pending.add(el); });
    if (!raf) raf = requestAnimationFrame(flush);
  };
  add();
  return { add };
}
