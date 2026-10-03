// 開場（2026-10-02 照搬旅ことば的「暮色玻璃」）：天空從夜色轉成 Halo（深色模式轉成 Universe），一團暖光從畫面下方升起、在中央散開；
// 一塊液態玻璃磚在光裡凝結，「旅」浮現在玻璃上、下面是「Street Talk」，接著玻璃磚淡出，App 直接接在同一片天空上（天空不換、不閃）。
// 約 1.7 秒，點一下跳過（app.js 的 hideSplash）；減少動態效果時不顯示。天空本身在 js/sky.js；這裡只負責把它點起來並驅動開場。
// （之前是太極的紅藍圓＋白色「旅」，2026-09-25 定案；改外觀後換成同系列的玻璃開場）
import { initSky, sunrise } from './sky.js';

const T = { sun: 1500, end: 1700 };
const root = document.documentElement;
const dark = root.dataset.theme === 'dark' || (root.dataset.theme !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
const canvas = document.getElementById('sky');
const ok = canvas ? initSky(canvas, dark) : false;
const splash = document.getElementById('splash');

if (splash && root.classList.contains('splashing')) {
  const t0 = performance.now();
  window.__tkSplashEnd = t0 + T.end;
  if (ok) {
    sunrise(0);
    const step = (ms) => {
      if (!splash.isConnected || splash.classList.contains('out')) { sunrise(1); return; }
      const hook = typeof window.__tkSplashT === 'number';   // 截圖測試用：停在某個時間點
      const p = (hook ? window.__tkSplashT : ms - t0) / T.sun;
      sunrise(p);
      if (p < 1 || hook) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
