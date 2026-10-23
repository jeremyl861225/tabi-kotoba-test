// 共用小工具：數學、亂數、雜訊
import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const PI = Math.PI;
export const LH = 0.36; // 一層台地的高度
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const C = (hex) => new THREE.Color(hex);
export const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
export const easeInCubic = (t) => t * t * t;

function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function makeRng(seed) {
  const r = mulberry(seed);
  r.pick = (a) => a[Math.floor(r() * a.length)];
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.chance = (p) => r() < p;
  return r;
}

export function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
export function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
export const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.25 * vnoise(x * 2.03 + 5.1, y * 2.03) + 0.125 * vnoise(x * 4.1, y * 4.1 + 2.7) + 0.0625 * vnoise(x * 8.3, y * 8.3);

// 四方向：+x、-x、+z、-z
export const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export const key = (i, j) => i * 1000 + j;
