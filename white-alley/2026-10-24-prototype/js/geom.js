// 白模的幾何小工具：facade.js（米克諾斯、台北、競技場）與 styles.js（羅馬、京都、巴黎、地標）共用。
// 純陣列輸出（不碰 Three）。
import { at } from './arch.js';

// 顏色（乘在白色材質上）
export const C = {
  wall: 1, roof: 0.965, trim: 1, under: 0.8,
  glass: [0.6, 0.65, 0.72], glassDeep: [0.5, 0.55, 0.62],
  door: [0.82, 0.79, 0.74], shutter: [0.9, 0.91, 0.93], rolling: [0.86, 0.87, 0.89],
  metal: [0.8, 0.82, 0.85], dark: [0.38, 0.4, 0.44], tank: [0.93, 0.94, 0.95],
};

export class Buf {
  constructor(uv = false) { this.p = []; this.n = []; this.c = []; this.uv = uv ? [] : null; }
  get tris() { return this.p.length / 9; }
  // 依法線決定繞行方向，三角形永遠朝外
  tri(a, b, c, n, ca, cb, cc, ta, tb, tc) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { [b, c] = [c, b]; [cb, cc] = [cc, cb]; [tb, tc] = [tc, tb]; }
    for (const [p, k, t] of [[a, ca, ta], [b, cb, tb], [c, cc, tc]]) {
      this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]);
      if (Array.isArray(k)) this.c.push(k[0], k[1], k[2]); else this.c.push(k, k, k * 0.988);
      if (this.uv) this.uv.push(t ? t[0] : 0, t ? t[1] : 0);
    }
  }
  quad(a, b, c, d, n, k, uvs) {
    this.tri(a, b, c, n, k, k, k, uvs && uvs[0], uvs && uvs[1], uvs && uvs[2]);
    this.tri(a, c, d, n, k, k, k, uvs && uvs[0], uvs && uvs[2], uvs && uvs[3]);
  }
}

// 牆面局部座標的方塊：u 沿牆、y 往上、w 往外（w=0 是牆面）
export function fbox(B, f, u0, u1, y0, y1, w0, w1, k, o = {}) {
  const P = (u, y, w) => { const [x, z] = at(f, u, w); return [x, y, z]; };
  const U = [f.ux, 0, f.uz], N = [f.nx, 0, f.nz];
  const kk = (s) => (Array.isArray(k) ? k.map((v) => v * s) : k * s);
  B.quad(P(u0, y0, w1), P(u1, y0, w1), P(u1, y1, w1), P(u0, y1, w1), N, k);                                         // 正面
  if (o.top !== false) B.quad(P(u0, y1, w0), P(u1, y1, w0), P(u1, y1, w1), P(u0, y1, w1), [0, 1, 0], kk(0.98));      // 頂
  if (o.bottom) B.quad(P(u0, y0, w0), P(u1, y0, w0), P(u1, y0, w1), P(u0, y0, w1), [0, -1, 0], kk(0.82));            // 底
  if (o.ends !== false) {
    B.quad(P(u0, y0, w0), P(u0, y0, w1), P(u0, y1, w1), P(u0, y1, w0), [-U[0], 0, -U[2]], kk(0.97));
    B.quad(P(u1, y0, w0), P(u1, y0, w1), P(u1, y1, w1), P(u1, y1, w0), U, kk(0.97));
  }
  if (o.back) B.quad(P(u0, y0, w0), P(u1, y0, w0), P(u1, y1, w0), P(u0, y1, w0), [-N[0], 0, -N[2]], k);
}

// 貼在牆上的平面（窗玻璃、門板）
export function fpanel(B, f, u0, u1, y0, y1, w, k) {
  const P = (u, y) => { const [x, z] = at(f, u, w); return [x, y, z]; };
  B.quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1), [f.nx, 0, f.nz], k);
}

// 世界座標的軸對齊方塊／旋轉方塊（屋頂設備用）
export function wbox(B, cx, cz, ux, uz, hu, hw, y0, y1, k, o = {}) {
  const f = { ax: cx - ux * hu + uz * hw, az: cz - uz * hu - ux * hw, ux, uz, nx: -uz, nz: ux, L: hu * 2 };
  // 上面這個 frame 的 w 方向是 (-uz, ux)；方塊從 w=0 到 2hw
  fbox(B, f, 0, hu * 2, y0, y1, 0, hw * 2, k, { back: true, ...o });
}

export function cylinder(B, cx, cz, r, y0, y1, seg, k, caps = true) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
    const q0 = [p0[0], y1, p0[2]], q1 = [p1[0], y1, p1[2]];
    B.quad(p0, p1, q1, q0, [Math.cos(am), 0, Math.sin(am)], k);
    if (caps) B.tri([cx, y1, cz], q0, q1, [0, 1, 0], k, k, k);
  }
}

// 圓頂：經緯細分的半球（教堂）
export function dome(B, cx, y0, cz, r, seg, rings, k) {
  const pt = (i, j) => {
    const a = (i / seg) * Math.PI * 2, t = (j / rings) * Math.PI / 2;
    return [cx + Math.cos(a) * Math.cos(t) * r, y0 + Math.sin(t) * r, cz + Math.sin(a) * Math.cos(t) * r];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const a = pt(i, j), b = pt(i + 1, j), c = pt(i + 1, j + 1), d = pt(i, j + 1);
      const m = [(a[0] + c[0]) / 2 - cx, (a[1] + c[1]) / 2 - y0, (a[2] + c[2]) / 2 - cz], l = Math.hypot(...m);
      const n = [m[0] / l, m[1] / l, m[2] / l];
      if (j === rings - 1) B.tri(a, b, c, n, k, k, k); else B.quad(a, b, c, d, n, k);
    }
  }
}

// 多邊形（含洞）三角化交給呼叫端（render 用 THREE.ShapeUtils），這裡只記下來
export function flatPoly(list, ring, holes, y, k, up = true) { list.push({ ring, holes, y, k, up }); }

export function centroid(pts) { let x = 0, z = 0; pts.forEach((p) => { x += p[0]; z += p[1]; }); return [x / pts.length, z / pts.length]; }
export function distToRing(pts, x, z) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return d;
}
export function inRing(pts, x, z) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}


// 拱形的暗色凹面：矩形＋半圓頂（貼在牆上，w 是離牆多遠）
export function archPanel(B, f, uc, w, y0, y1, k, wOff = 0.01) {
  const r = w / 2, P = (u, y) => { const [x, z] = at(f, u, wOff); return [x, y, z]; }, N = [f.nx, 0, f.nz];
  B.quad(P(uc - r, y0), P(uc + r, y0), P(uc + r, y1), P(uc - r, y1), N, k);
  const seg = 8;
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI, a1 = ((i + 1) / seg) * Math.PI;
    B.tri(P(uc, y1), P(uc + Math.cos(a0) * r, y1 + Math.sin(a0) * r), P(uc + Math.cos(a1) * r, y1 + Math.sin(a1) * r), N, k, k, k);
  }
}

