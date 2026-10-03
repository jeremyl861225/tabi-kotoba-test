// 分頁列：選到的分頁浮成一顆玻璃珠，換分頁時球滑過去，玻璃底板上的凹口跟著移動。
// 旅ことば 2026-09-29 的做法（使用者參考圖：選到的按鈕漂浮成球、選別的球會移過去），2026-10-02 韓文版照搬（暮色玻璃）。
// 底板形狀每一格重算：凹口＝圓弧＋兩個圓角接上邊；毛玻璃用 clip-path 裁、細框與高光用同一條路徑畫。
// 換頁不等動畫：畫面立刻換，球自己滑過去；減少動態效果時直接跳到位。

const BALL = 48;     // 球的直徑
const LIFT = -5;     // 球心在底板上緣之上幾 px（負的＝沉進底板；2026-09-29 使用者：球再陷深一點、縫再小）
const GAP = 3;       // 球與凹口的間隙
const FILLET = 9;    // 凹口與上緣接合處的圓角
const CORNER = 32;   // 底板四角（暮色玻璃：接近膠囊）
const DUR = 380;     // 球滑動的時間（ms）

let inner, glass, paths, ball, W = 0, H = 0, corner = CORNER, x = null, raf = 0;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

const RN = BALL / 2 + GAP;
const CY = -LIFT;
const HALF = Math.sqrt((RN + FILLET) ** 2 - (FILLET - CY) ** 2);   // 凹口在上緣的半寬

function shape(cx) {
  const k = RN / (RN + FILLET);
  const px = HALF * k, py = CY - (CY - FILLET) * k;
  const r = corner, f = FILLET;
  const n = (v) => Math.round(v * 100) / 100;
  return `M${r} 0L${n(cx - HALF)} 0A${f} ${f} 0 0 1 ${n(cx - px)} ${n(py)}A${RN} ${RN} 0 0 0 ${n(cx + px)} ${n(py)}A${f} ${f} 0 0 1 ${n(cx + HALF)} 0`
    + `L${W - r} 0A${r} ${r} 0 0 1 ${W} ${r}L${W} ${H - r}A${r} ${r} 0 0 1 ${W - r} ${H}L${r} ${H}A${r} ${r} 0 0 1 0 ${H - r}L0 ${r}A${r} ${r} 0 0 1 ${r} 0Z`;
}

function draw(cx, stretch = 0) {
  const d = shape(cx);
  glass.style.clipPath = `path("${d}")`;
  paths.forEach((p) => p.setAttribute('d', d));
  const sx = 1 + stretch * 0.14, sy = 1 - stretch * 0.08;   // 滑動時略微拉長，像一滴水
  ball.style.transform = `translate3d(${cx - BALL / 2}px,0,0) scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
}

function centerOf(tab) {
  return tab.offsetLeft + tab.offsetWidth / 2;
}

function layout() {
  W = inner.clientWidth;
  H = inner.clientHeight;
  inner.querySelectorAll('svg.tb-line').forEach((s) => s.setAttribute('viewBox', `0 0 ${W} ${H}`));
  const tabs = inner.querySelectorAll('.tab');
  const edge = tabs.length ? Math.min(centerOf(tabs[0]), W - centerOf(tabs[tabs.length - 1])) : W / 2;
  corner = Math.max(6, Math.min(CORNER, edge - HALF));   // 很窄的螢幕：縮小四角，讓凹口不壓到圓角
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

export function syncTabbar() {
  if (!inner) return;
  const cur = inner.querySelector('.tab[aria-current="page"]');
  if (!cur || !inner.offsetParent) { x = null; return; }   // 分頁列藏起來（學習、測驗中）：回來時直接定位
  if (!W) layout();
  const to = centerOf(cur);
  cancelAnimationFrame(raf);
  if (x == null || reduce.matches || Math.abs(to - x) < 1) {
    x = to;
    inner.style.setProperty('--rise-delay', '0ms');
    draw(x);
    return;
  }
  const from = x, t0 = performance.now();
  inner.style.setProperty('--rise-delay', `${Math.round(DUR * 0.4)}ms`);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / DUR);
    x = from + (to - from) * ease(t);
    const v = 3 * Math.pow(1 - t, 2);          // ease 的斜率：中段最快
    draw(x, Math.min(1, v * Math.abs(to - from) / 240) * (t < 1 ? 1 : 0));
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
}

export function initTabbar() {
  inner = document.querySelector('.tabbar-inner');
  if (!inner) return;
  glass = inner.querySelector('.tb-glass');
  ball = inner.querySelector('.tb-ball');
  paths = [...inner.querySelectorAll('.tb-line path')];
  new ResizeObserver(() => {
    if (!inner.offsetParent) return;
    layout();
    if (x != null) { cancelAnimationFrame(raf); x = centerOf(inner.querySelector('.tab[aria-current="page"]') || inner.querySelector('.tab')); draw(x); }
  }).observe(inner);
}
