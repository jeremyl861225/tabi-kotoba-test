// 歐式建築：八級房屋＋公共建築。所有建築前門朝 +z，地面 y = 0。
// 1–5 級佔一格；6 級（雙併）佔 2×1；7、8 級（莊園、宮邸）佔 2×2。
import * as THREE from 'three';
import { P, bx, rbx, M, newKit, grp, onFace, merge, meshOf, applyAO } from './kit.js';
import { makeRng, PI, TAU } from './util.js';
import { warpGeometry, warpObject, warpPoint } from './warp.js';

let R = makeRng(1);
const pick = (a) => a[Math.floor(R() * a.length)];
function shade(hex, k) { const c = new THREE.Color(hex).multiplyScalar(k); return '#' + c.getHexString(THREE.SRGBColorSpace); }

const PAL = {
  plaster: ['#e8644f', '#f09a4a', '#f3cd58', '#7cc4a3', '#5ea8d4', '#f1a2b4', '#f4f0e7', '#a98fd6', '#e9dab9', '#4fa0a0', '#f6e3a1'],
  stone: ['#d3c7b1', '#c8bba3', '#dcd2c0'],
  timber: ['#5b3e2c', '#4b3428', '#664632'],
  tile: ['#b9503a', '#a9483a', '#c8603f', '#8e3f33', '#56606e', '#4a5462'],
  slate: ['#5d6b7d', '#525e6e', '#66718a'],
  thatch: ['#c99f55', '#d4ae66', '#bf9550'],
  shutter: ['#5f8f6a', '#4f7fa3', '#a8483a', '#3f6b5a', '#7a5a8a', '#2f5d7c', '#c08a3a'],
  door: ['#6e4630', '#5a3a28', '#3f5a6e', '#6b2f2a', '#3d5a40'],
  facade: ['#d9614a', '#f09a4a', '#f3cd58', '#6fbf9c', '#5ea8d4', '#f1a2b4', '#f4f0e7', '#a98fd6', '#3f8f9a'],
  copper: ['#5f9a8c', '#6aa596'],
};
function variant() {
  return {
    plaster: pick(PAL.plaster), plaster2: pick(PAL.plaster), stone: pick(PAL.stone), timber: pick(PAL.timber),
    roof: pick(PAL.tile), slate: pick(PAL.slate), thatch: pick(PAL.thatch), shutter: pick(PAL.shutter),
    door: pick(PAL.door), facade: pick(PAL.facade), copper: pick(PAL.copper),
    stoneWall: pick(['#d8ccb4', '#cdbfa6', '#e0d5c0']), quoin: '#efe7d6',
  };
}

const FRAME = '#f3ece0';
const IRON = '#3b3944';
const GOLD = '#e8c065';
const BRICK = '#a8644a';

// ---------------------------------------------------------------- 立面零件（牆面座標：x 沿牆、z 朝外、牆面在 z = 0）
function win(K, x, y, { w = 0.1, h = 0.14, sh = null, arch = false, fb = false, frame = FRAME, cap = false } = {}) {
  K.body.push(P(bx(w + 0.028, h + 0.028, 0.02), frame, { x, y, z: 0.004 }));
  K.glow.push(P(bx(w, h, 0.02), '#fff', { x, y, z: 0.011 }));
  K.body.push(P(bx(0.01, h, 0.012), frame, { x, y, z: 0.022 }));
  K.body.push(P(bx(w, 0.01, 0.012), frame, { x, y: y + h * 0.12, z: 0.022 }));
  if (arch) {
    K.body.push(P(new THREE.CylinderGeometry(w / 2 + 0.014, w / 2 + 0.014, 0.02, 10, 1, false, -PI / 2, PI), frame, { x, y: y + h / 2, z: 0.004, rx: -PI / 2 }));
    K.glow.push(P(new THREE.CylinderGeometry(w / 2, w / 2, 0.02, 10, 1, false, -PI / 2, PI), '#fff', { x, y: y + h / 2, z: 0.011, rx: -PI / 2 }));
  }
  K.body.push(P(bx(w + 0.05, 0.018, 0.045), frame, { x, y: y - h / 2 - 0.012, z: 0.02 }));
  if (cap) {
    const ty = y + h / 2 + (arch ? w / 2 : 0) + 0.02;
    K.body.push(P(bx(w + 0.06, 0.018, 0.035), frame, { x, y: ty, z: 0.016 }));
    const tri = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.03, 0), new THREE.Vector2(w / 2 + 0.03, 0), new THREE.Vector2(0, 0.045)]);
    K.body.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.03, bevelEnabled: false }), frame, { x, y: ty + 0.009, z: 0.002 }));
  }
  if (sh) for (const s of [-1, 1]) K.body.push(P(bx(w * 0.5, h + (arch ? w * 0.4 : 0), 0.014), sh, { x: x + s * (w * 0.75 + 0.016), y: y + (arch ? w * 0.2 : 0), z: 0.012 }));
  if (fb) flowerBox(K, x, y - h / 2 - 0.042, w + 0.05);
}
function flowerBox(K, x, y, w) {
  K.body.push(P(bx(w, 0.034, 0.05), '#7a5236', { x, y, z: 0.03 }));
  K.body.push(P(bx(w - 0.01, 0.02, 0.04), '#5f8f45', { x, y: y + 0.024, z: 0.03 }));
  const n = Math.max(3, Math.round(w / 0.032));
  for (let k = 0; k < n; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.016, 0), pick(['#e8556d', '#ffd25e', '#ff8a5c', '#f4f0ff', '#d36fb0', '#ff6f91']), { x: x - w / 2 + 0.014 + k * (w - 0.028) / (n - 1), y: y + 0.038, z: 0.036 + (k % 2) * 0.012 }));
}
function door(K, x, y0, { w = 0.13, h = 0.22, color = '#6e4630', frame = FRAME, arch = true, step = true, fan = false } = {}) {
  const hh = arch ? h - w / 2 : h;
  K.body.push(P(bx(w + 0.034, hh + 0.017, 0.02), frame, { x, y: y0 + hh / 2, z: 0.004 }));
  K.body.push(P(bx(w, hh, 0.026), color, { x, y: y0 + hh / 2, z: 0.012 }));
  for (const s of [-1, 1]) K.body.push(P(bx(0.006, hh * 0.9, 0.006), shade(color, 0.7), { x: x + s * w * 0.2, y: y0 + hh / 2, z: 0.027 }));
  if (arch) {
    K.body.push(P(new THREE.CylinderGeometry(w / 2 + 0.017, w / 2 + 0.017, 0.02, 12, 1, false, -PI / 2, PI), frame, { x, y: y0 + hh, z: 0.004, rx: -PI / 2 }));
    if (fan) K.glow.push(P(new THREE.CylinderGeometry(w / 2, w / 2, 0.026, 12, 1, false, -PI / 2, PI), '#fff', { x, y: y0 + hh, z: 0.012, rx: -PI / 2 }));
    else K.body.push(P(new THREE.CylinderGeometry(w / 2, w / 2, 0.026, 12, 1, false, -PI / 2, PI), color, { x, y: y0 + hh, z: 0.012, rx: -PI / 2 }));
  }
  K.body.push(P(new THREE.SphereGeometry(0.01, 6, 4), GOLD, { x: x + w * 0.32, y: y0 + hh * 0.5, z: 0.03 }));
  if (step) K.body.push(P(bx(w + 0.08, 0.028, 0.07), '#bfb39d', { x, y: y0 + 0.014, z: 0.035 }));
}
function lantern(K, x, y, z = 0) {
  K.body.push(P(bx(0.01, 0.01, 0.05), IRON, { x, y: y + 0.01, z: z + 0.02 }));
  K.body.push(P(bx(0.04, 0.008, 0.04), IRON, { x, y: y + 0.004, z: z + 0.045 }));
  K.glow.push(P(bx(0.03, 0.045, 0.03), '#fff', { x, y: y - 0.022, z: z + 0.045 }));
  K.body.push(P(new THREE.ConeGeometry(0.028, 0.025, 4), IRON, { x, y: y + 0.018, z: z + 0.045, ry: PI / 4 }));
  K.lamps.push(new THREE.Vector3(x, y - 0.02, z + 0.06));
}
// 木骨架：n 個開間，回傳各開間中心 x
function timber(K, fw, y0, h, { color = '#5b3e2c', bays = 3, brace = true, mid = true } = {}) {
  const t = 0.022, z = 0.006, xs = [];
  K.body.push(P(bx(fw, t, 0.012), color, { y: y0 + t / 2, z }));
  K.body.push(P(bx(fw, t, 0.012), color, { y: y0 + h - t / 2, z }));
  if (mid) K.body.push(P(bx(fw, t * 0.8, 0.012), color, { y: y0 + h * 0.36, z }));
  const step = (fw - t) / bays;
  for (let k = 0; k <= bays; k++) K.body.push(P(bx(t, h, 0.012), color, { x: -fw / 2 + t / 2 + k * step, y: y0 + h / 2, z }));
  for (let k = 0; k < bays; k++) xs.push(-fw / 2 + t / 2 + (k + 0.5) * step);
  if (brace) {
    for (const k of [0, bays - 1]) {
      const x0 = -fw / 2 + t / 2 + k * step, dx = step, dy = h * 0.36;
      const len = Math.hypot(dx, dy), ang = Math.atan2(dy, dx) * (k === 0 ? 1 : -1);
      K.body.push(P(bx(len, t * 0.8, 0.012), color, { x: x0 + dx / 2, y: y0 + dy / 2, z: z + 0.001, rz: ang }));
    }
  }
  return xs;
}
function balcony(K, w, y, { depth = 0.1, color = '#d9cdb5' } = {}) {
  K.body.push(P(bx(w, 0.024, depth), color, { y, z: depth / 2 }));
  K.body.push(P(bx(w, 0.012, 0.012), IRON, { y: y + 0.075, z: depth - 0.006 }));
  for (const s of [-1, 1]) K.body.push(P(bx(0.012, 0.012, depth), IRON, { x: s * (w / 2 - 0.006), y: y + 0.075, z: depth / 2 }));
  const n = Math.round(w / 0.035);
  for (let k = 0; k <= n; k++) K.body.push(P(bx(0.006, 0.07, 0.006), IRON, { x: -w / 2 + k * w / n, y: y + 0.045, z: depth - 0.006 }));
}
function hangingSign(K, x, y, color, emblem) {
  K.body.push(P(bx(0.012, 0.012, 0.12), IRON, { x, y, z: 0.06 }));
  K.body.push(P(bx(0.11, 0.08, 0.012), color, { x, y: y - 0.05, z: 0.1, ry: PI / 2 }));
  K.body.push(P(bx(0.06, 0.04, 0.016), emblem, { x, y: y - 0.05, z: 0.1, ry: PI / 2 }));
}
function urn(K, x, y, z) {
  K.body.push(P(new THREE.CylinderGeometry(0.03, 0.02, 0.05, 8), '#d9cdb5', { x, y: y + 0.025, z }));
  K.body.push(P(new THREE.IcosahedronGeometry(0.035, 1), '#5f9a4c', { x, y: y + 0.065, z }));
}

// ---------------------------------------------------------------- 量體
function block(K, cx, cz, w, d, y0, h, color, r = 0.012) {
  K.body.push(P(rbx(w, h, d, r, 1), color, { x: cx, y: y0 + h / 2, z: cz }));
  return { cx, cz, w, d, y0, h };
}
function band(K, b, y, color = '#e6dcc8', out = 0.022, t = 0.026) {
  K.body.push(P(bx(b.w + out * 2, t, b.d + out * 2), color, { x: b.cx, y, z: b.cz }));
}
function quoins(K, b, color = '#efe7d6', y0 = b.y0, h = b.h) {
  const n = Math.max(2, Math.round(h / 0.065));
  const ch = h / n;
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    for (let k = 0; k < n; k++) {
      const big = k % 2 === 0;
      K.body.push(P(bx(big ? 0.075 : 0.05, ch * 0.86, big ? 0.05 : 0.075), color, { x: b.cx + sx * (b.w / 2 - (big ? 0.03 : 0.018)), y: y0 + (k + 0.5) * ch, z: b.cz + sz * (b.d / 2 - (big ? 0.018 : 0.03)), sx: 1.0, sz: 1.0 }));
    }
  }
}
function rustic(K, fw, y0, h, color) { // 底層石材的水平溝縫
  const n = Math.floor(h / 0.06);
  for (let k = 1; k < n; k++) K.body.push(P(bx(fw - 0.01, 0.006, 0.006), shade(color, 0.82), { y: y0 + k * h / n, z: 0.002 }));
}
function chimney(K, x, y0, z, h = 0.3, color = BRICK) {
  K.body.push(P(bx(0.09, h, 0.09), color, { x, y: y0 + h / 2, z, j: 0.1 }));
  K.body.push(P(bx(0.12, 0.028, 0.12), shade(color, 0.75), { x, y: y0 + h, z }));
  K.body.push(P(new THREE.CylinderGeometry(0.018, 0.022, 0.04, 6), '#9a5a40', { x: x - 0.02, y: y0 + h + 0.03, z }));
  K.chimneys.push(new THREE.Vector3(x - 0.02, y0 + h + 0.05, z));
}

// ---------------------------------------------------------------- 屋頂
// 人字屋頂：w 沿屋脊、d 橫跨屋脊；預設屋脊沿 x，ridgeZ 則沿 z
function gable(K, o) {
  const { cx = 0, cz = 0, w, d, y0, h, ov = 0.06, color, wall, rows = 5, thatch = false, ridgeZ = false, ends = true } = o;
  if (ridgeZ) { grp(K, cx, 0, cz, PI / 2, () => gable(K, { ...o, cx: 0, cz: 0, ridgeZ: false })); return; }
  if (ends && wall) {
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
    K.body.push(P(new THREE.ExtrudeGeometry(tri, { depth: w - 0.004, bevelEnabled: false }), wall, { ry: PI / 2, x: cx - (w - 0.004) / 2, y: y0, z: cz }));
  }
  const th = Math.atan2(h, d / 2), ez = d / 2 + ov, ey = y0 - ov * Math.tan(th);
  const L = Math.hypot(ez, y0 + h - ey);
  for (const sg of [1, -1]) {
    const dz = -sg * ez / L, dy = (y0 + h - ey) / L;
    const nz = sg * Math.sin(th), ny = Math.cos(th);
    if (thatch) {
      K.body.push(P(rbx(w + ov * 2 + 0.04, 0.085, L + 0.05, 0.04, 2), [shade(color, 0.8), color], { rx: th * sg, x: cx, y: (ey + y0 + h) / 2 + ny * 0.04, z: cz + sg * ez / 2 + nz * 0.04 }));
    } else {
      const rl = L / rows;
      for (let k = 0; k < rows; k++) {
        const s = (k + 0.5) * rl, off = 0.016 + (k % 2) * 0.006;
        K.body.push(P(bx(w + ov * 2, 0.024, rl * 1.14), color, { rx: th * sg, x: cx, y: ey + dy * s + ny * off, z: cz + sg * ez + dz * s + nz * off, j: 0.14 }));
      }
      // 屋簷封板
      K.body.push(P(bx(w + ov * 2 + 0.01, 0.03, 0.02), shade(color, 0.7), { x: cx, y: ey + 0.005, z: cz + sg * (ez + 0.005) }));
    }
  }
  if (thatch) K.body.push(P(new THREE.CylinderGeometry(0.05, 0.05, w + ov * 2 + 0.05, 8), shade(color, 0.85), { rz: PI / 2, x: cx, y: y0 + h + 0.03, z: cz }));
  else K.body.push(P(new THREE.CylinderGeometry(0.026, 0.026, w + ov * 2 + 0.01, 6), shade(color, 0.72), { rz: PI / 2, x: cx, y: y0 + h + 0.024, z: cz }));
}
function hipGeo(a, b, h) {
  const r = Math.max(0, a - b);
  const V = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b], [-r, h, 0], [r, h, 0]];
  const F = [[3, 2, 5], [3, 5, 4], [1, 0, 4], [1, 4, 5], [2, 1, 5], [0, 3, 4]];
  const pos = [];
  for (const f of F) for (const k of f) pos.push(...V[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function frustumGeo(a, b, a2, b2, h) {
  const V = [[-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b], [-a2, h, -b2], [a2, h, -b2], [a2, h, b2], [-a2, h, b2]];
  const F = [[3, 2, 6], [3, 6, 7], [2, 1, 5], [2, 5, 6], [1, 0, 4], [1, 4, 5], [0, 3, 7], [0, 7, 4], [7, 6, 5], [7, 5, 4]];
  const pos = [];
  for (const f of F) for (const k of f) pos.push(...V[k]);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}
function hipRoof(K, { cx = 0, cz = 0, w, d, y0, h, ov = 0.06, color }) {
  const a = w / 2 + ov, b = d / 2 + ov;
  const g = a >= b ? hipGeo(a, b, h) : hipGeo(b, a, h).rotateY(PI / 2);
  K.body.push(P(g, [shade(color, 0.86), color], { x: cx, y: y0 + 0.012, z: cz }));
  K.body.push(P(bx(a * 2 + 0.01, 0.026, b * 2 + 0.01), shade(color, 0.7), { x: cx, y: y0, z: cz }));
}
function mansard(K, { cx = 0, cz = 0, w, d, y0, h1, h2, color, top }) {
  const a = w / 2 + 0.03, b = d / 2 + 0.03, a2 = w / 2 - 0.09, b2 = d / 2 - 0.09;
  K.body.push(P(frustumGeo(a, b, a2, b2, h1), [shade(color, 0.85), color], { x: cx, y: y0, z: cz }));
  const g = a2 >= b2 ? hipGeo(a2 + 0.01, b2 + 0.01, h2) : hipGeo(b2 + 0.01, a2 + 0.01, h2).rotateY(PI / 2);
  K.body.push(P(g, top || shade(color, 0.9), { x: cx, y: y0 + h1, z: cz }));
  K.body.push(P(bx(a2 * 2 + 0.04, 0.02, b2 * 2 + 0.04), GOLD, { x: cx, y: y0 + h1, z: cz }));
}
// 前坡上的老虎窗（屋脊沿 x 的人字屋頂）
function dormer(K, { x, d, y0, h, color, wall }) {
  const zf = d / 2 - 0.03;
  const ys = y0 + h * (0.03 / (d / 2));
  const dw = 0.16, dh = 0.15, dd = 0.26;
  K.body.push(P(bx(dw, dh, dd), wall, { x, y: ys + dh / 2 - 0.02, z: zf - dd / 2 }));
  grp(K, x, 0, zf, 0, () => win(K, 0, ys + dh / 2 - 0.025, { w: 0.08, h: 0.08 }));
  gable(K, { cx: x, cz: zf - dd / 2 + 0.03, w: dd + 0.04, d: dw + 0.02, y0: ys + dh - 0.02, h: 0.09, ov: 0.025, color, wall, rows: 2, ridgeZ: true });
}
function spire(K, x, y0, z, r, h, color, sides = 4) {
  K.body.push(P(new THREE.ConeGeometry(r, h, sides), [shade(color, 0.85), color], { x, y: y0 + h / 2, z, ry: sides === 4 ? PI / 4 : PI / 8, flat: true }));
  K.body.push(P(new THREE.SphereGeometry(0.026, 8, 6), GOLD, { x, y: y0 + h + 0.02, z }));
  K.body.push(P(bx(0.008, 0.08, 0.008), GOLD, { x, y: y0 + h + 0.07, z }));
}
function tower(K, { x, z, s, y0, h, color, roof, spireH, floors = 3, sides = 4, bandColor = '#e6dcc8', belfry = false }) {
  const b = block(K, x, z, s, s, y0, h, color);
  const fh = h / floors;
  for (let f = 1; f < floors; f++) band(K, b, y0 + f * fh, bandColor, 0.014, 0.02);
  band(K, b, y0 + h, bandColor, 0.03, 0.035);
  quoins(K, b, '#efe7d6');
  for (const side of ['front', 'back', 'left', 'right']) onFace(K, b, side, () => {
    for (let f = 0; f < floors; f++) {
      if (belfry && f === floors - 1) {
        K.body.push(P(bx(0.09, fh * 0.42, 0.02), '#2b2730', { y: y0 + f * fh + fh * 0.45, z: 0.006 }));
        K.body.push(P(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 10, 1, false, -PI / 2, PI), '#2b2730', { y: y0 + f * fh + fh * 0.66, z: 0.006, rx: -PI / 2 }));
      } else if (f > 0 || side !== 'front') win(K, 0, y0 + f * fh + fh * 0.48, { w: 0.06, h: 0.1, arch: true });
    }
  });
  spire(K, x, y0 + h + 0.017, z, s * 0.78, spireH, roof, sides);
  return b;
}
function flag(K, x, y, z, color, h = 0.3) {
  K.body.push(P(new THREE.CylinderGeometry(0.007, 0.007, h, 5), IRON, { x, y: y + h / 2, z }));
  const pivot = new THREE.Group(); pivot.position.set(x, y + h - 0.05, z);
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.08, 6, 1).translate(0.075, 0, 0), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
  pivot.add(fg);
  K.extra.push(pivot); K.spin.push({ obj: pivot, flag: true, ph: R() * 6 });
}
function hedge(K, x, z, w, d, h = 0.07) { K.body.push(P(rbx(w, h, d, 0.03, 1), ['#4f8a42', '#6aa552'], { x, y: h / 2, z })); }
function topiary(K, x, z, s = 1) {
  K.body.push(P(new THREE.CylinderGeometry(0.035 * s, 0.03 * s, 0.05 * s, 6), '#a9764f', { x, y: 0.025 * s, z }));
  K.body.push(P(new THREE.ConeGeometry(0.06 * s, 0.2 * s, 8), ['#3f7a3e', '#5f9a4c'], { x, y: 0.15 * s, z }));
}
function statue(K, x, z, y0 = 0) {
  K.body.push(P(bx(0.08, 0.1, 0.08), '#e3d9c6', { x, y: y0 + 0.05, z }));
  K.body.push(P(new THREE.CapsuleGeometry(0.022, 0.06, 2, 6), '#eae4d8', { x, y: y0 + 0.16, z }));
  K.body.push(P(new THREE.SphereGeometry(0.02, 8, 6), '#eae4d8', { x, y: y0 + 0.215, z }));
}
function bench(K, x, z, ry = 0) {
  grp(K, x, 0, z, ry, () => {
    K.body.push(P(bx(0.16, 0.014, 0.05), '#8a6244', { y: 0.05 }));
    K.body.push(P(bx(0.16, 0.05, 0.012), '#8a6244', { y: 0.08, z: -0.022 }));
    for (const s of [-1, 1]) K.body.push(P(bx(0.012, 0.05, 0.04), IRON, { x: s * 0.07, y: 0.025 }));
  });
}
function barrel(K, x, z, y0 = 0) {
  K.body.push(P(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), '#8a6040', { x, y: y0 + 0.04, z }));
  for (const yy of [0.015, 0.065]) K.body.push(P(new THREE.CylinderGeometry(0.037, 0.037, 0.008, 10), IRON, { x, y: y0 + yy, z }));
}
function fence(K, x0, x1, z, color = '#9a7650') {
  const n = Math.round(Math.abs(x1 - x0) / 0.07);
  for (let k = 0; k <= n; k++) K.body.push(P(bx(0.016, 0.09, 0.016), color, { x: x0 + (x1 - x0) * k / n, y: 0.045, z }));
  for (const y of [0.035, 0.07]) K.body.push(P(bx(Math.abs(x1 - x0), 0.012, 0.01), color, { x: (x0 + x1) / 2, y, z }));
}
function fountain(K, x, z, r = 0.3, tiers = 2) {
  K.body.push(P(new THREE.CylinderGeometry(r, r + 0.02, 0.09, 24), '#ddd2bd', { x, y: 0.045, z }));
  K.body.push(P(new THREE.CylinderGeometry(r - 0.035, r - 0.035, 0.012, 24), '#5fb7c9', { x, y: 0.085, z }));
  K.body.push(P(new THREE.CylinderGeometry(0.045, 0.06, 0.24, 10), '#e6dccb', { x, y: 0.16, z }));
  K.body.push(P(new THREE.CylinderGeometry(r * 0.45, 0.05, 0.05, 16), '#e6dccb', { x, y: 0.28, z }));
  K.body.push(P(new THREE.CylinderGeometry(r * 0.4, r * 0.4, 0.01, 16), '#6cc3d2', { x, y: 0.302, z }));
  if (tiers > 1) {
    K.body.push(P(new THREE.CylinderGeometry(0.03, 0.04, 0.12, 8), '#e6dccb', { x, y: 0.36, z }));
    K.body.push(P(new THREE.CylinderGeometry(r * 0.22, 0.03, 0.035, 12), '#e6dccb', { x, y: 0.43, z }));
  }
  K.body.push(P(new THREE.SphereGeometry(0.025, 8, 6), GOLD, { x, y: tiers > 1 ? 0.47 : 0.33, z }));
}

// ---------------------------------------------------------------- 八級房屋
const HOUSES = {
  1(K, v) { // 茅草小屋
    const W = 0.56, D = 0.44;
    K.body.push(P(rbx(W + 0.06, 0.06, D + 0.06, 0.02), v.stone, { y: 0.03 }));
    const b = block(K, 0, 0, W, D, 0.06, 0.27, v.plaster);
    onFace(K, b, 'front', (fw) => {
      timber(K, fw, 0.06, 0.27, { color: v.timber, bays: 2, brace: false, mid: false });
      door(K, -0.13, 0.06, { w: 0.11, h: 0.19, color: v.door, arch: false });
      win(K, 0.13, 0.2, { w: 0.09, h: 0.09, sh: v.shutter, fb: true });
    });
    onFace(K, b, 'right', () => win(K, 0, 0.2, { w: 0.08, h: 0.08 }));
    onFace(K, b, 'left', () => win(K, 0, 0.2, { w: 0.08, h: 0.08 }));
    gable(K, { w: W, d: D, y0: 0.33, h: 0.27, ov: 0.08, color: v.thatch, wall: v.plaster, thatch: true });
    chimney(K, 0.18, 0.33, -0.08, 0.3, v.stone);
    for (let k = 0; k < 5; k++) K.body.push(P(new THREE.CylinderGeometry(0.017, 0.017, 0.13, 6), '#8a6040', { rx: PI / 2, x: -0.35, y: 0.02 + (k > 2 ? 0.032 : 0), z: -0.05 + (k % 3) * 0.035 - (k > 2 ? 0.017 : 0) }));
    fence(K, 0.05, 0.42, 0.4);
    bench(K, -0.3, 0.33, 0);
  },
  2(K, v) { // 石砌農舍
    const W = 0.7, D = 0.52;
    K.body.push(P(rbx(W + 0.06, 0.05, D + 0.06, 0.02), v.stone, { y: 0.025 }));
    const b = block(K, 0, 0, W, D, 0.05, 0.3, v.stoneWall);
    quoins(K, b, v.quoin);
    onFace(K, b, 'front', () => {
      door(K, -0.14, 0.05, { w: 0.12, h: 0.22, color: v.door });
      win(K, 0.07, 0.21, { w: 0.09, h: 0.11, sh: v.shutter });
      win(K, 0.23, 0.21, { w: 0.09, h: 0.11, sh: v.shutter, fb: true });
      lantern(K, -0.26, 0.29);
    });
    for (const s of ['left', 'right']) onFace(K, b, s, () => win(K, 0, 0.21, { w: 0.08, h: 0.1, sh: v.shutter }));
    gable(K, { w: W, d: D, y0: 0.35, h: 0.3, ov: 0.07, color: v.roof, wall: v.plaster, rows: 5 });
    for (const s of ['left', 'right']) onFace(K, b, s, () => {
      K.body.push(P(bx(D, 0.02, 0.012), v.timber, { y: 0.36, z: 0.006 }));
      for (const x of [-0.12, 0, 0.12]) { const hh = 0.3 * (1 - Math.abs(x) / (D / 2)) - 0.02; K.body.push(P(bx(0.02, hh, 0.012), v.timber, { x, y: 0.36 + hh / 2, z: 0.006 })); }
    });
    chimney(K, -0.2, 0.42, -0.1, 0.32);
    barrel(K, 0.38, 0.3); barrel(K, 0.42, 0.21);
    for (const x of [-0.38, 0.1]) K.body.push(P(new THREE.IcosahedronGeometry(0.05, 1), ['#4f8a42', '#7ab35a'], { x, y: 0.035, z: 0.36, sy: 0.8 }));
  },
  3(K, v) { // 一層半木骨架屋
    const W = 0.72, D = 0.6;
    K.body.push(P(rbx(W + 0.06, 0.05, D + 0.06, 0.02), v.stone, { y: 0.025 }));
    const g = block(K, 0, 0, W, D, 0.05, 0.28, v.plaster);
    K.body.push(P(bx(W + 0.06, 0.03, D + 0.06), v.timber, { y: 0.345 }));
    const u = block(K, 0, 0.012, W + 0.04, D + 0.03, 0.36, 0.22, v.plaster2);
    onFace(K, g, 'front', () => {
      door(K, -0.2, 0.05, { w: 0.12, h: 0.23, color: v.door });
      win(K, 0.05, 0.2, { w: 0.1, h: 0.12, sh: v.shutter });
      win(K, 0.22, 0.2, { w: 0.1, h: 0.12, sh: v.shutter });
      lantern(K, -0.31, 0.28);
    });
    onFace(K, u, 'front', (fw) => { for (const x of timber(K, fw, 0.36, 0.22, { color: v.timber, bays: 3 })) win(K, x, 0.47, { w: 0.09, h: 0.1, fb: true }); });
    for (const s of ['left', 'right']) {
      onFace(K, g, s, () => win(K, 0, 0.2, { w: 0.09, h: 0.11, sh: v.shutter }));
      onFace(K, u, s, (fw) => { const xs = timber(K, fw, 0.36, 0.22, { color: v.timber, bays: 2 }); win(K, xs[0], 0.47, { w: 0.08, h: 0.09 }); });
    }
    gable(K, { w: W + 0.04, d: D + 0.03, cz: 0.012, y0: 0.58, h: 0.36, ov: 0.06, color: v.roof, wall: v.plaster2, rows: 6 });
    dormer(K, { x: 0, d: D + 0.03 + 0.024, y0: 0.58, h: 0.36, color: v.roof, wall: v.plaster2 });
    chimney(K, 0.24, 0.72, -0.12, 0.3);
  },
  4(K, v) { // 兩層半聯排屋
    const W = 0.78, D = 0.68;
    K.body.push(P(rbx(W + 0.06, 0.05, D + 0.06, 0.02), v.stone, { y: 0.025 }));
    const g = block(K, 0, 0, W, D, 0.05, 0.32, v.stoneWall);
    quoins(K, g, v.quoin);
    onFace(K, g, 'front', (fw) => {
      rustic(K, fw, 0.05, 0.32, v.stoneWall);
      door(K, 0, 0.05, { w: 0.14, h: 0.26, color: v.door, fan: true });
      win(K, -0.24, 0.19, { w: 0.11, h: 0.12, arch: true });
      win(K, 0.24, 0.19, { w: 0.11, h: 0.12, arch: true });
      lantern(K, -0.12, 0.3); lantern(K, 0.12, 0.3);
    });
    band(K, g, 0.375, '#e6dcc8', 0.02, 0.03);
    const u = block(K, 0, 0.015, W + 0.04, D + 0.03, 0.39, 0.3, v.plaster);
    onFace(K, u, 'front', (fw) => { for (const x of timber(K, fw, 0.39, 0.3, { color: v.timber, bays: 3 })) win(K, x, 0.55, { w: 0.1, h: 0.13, sh: v.shutter, fb: true }); });
    for (const s of ['left', 'right']) {
      onFace(K, g, s, () => win(K, 0, 0.2, { w: 0.09, h: 0.12, arch: true }));
      onFace(K, u, s, (fw) => { for (const x of timber(K, fw, 0.39, 0.3, { color: v.timber, bays: 2 })) win(K, x, 0.55, { w: 0.09, h: 0.12 }); });
    }
    onFace(K, u, 'back', (fw) => { for (const x of timber(K, fw, 0.39, 0.3, { color: v.timber, bays: 3, brace: false })) win(K, x, 0.55, { w: 0.09, h: 0.12 }); });
    gable(K, { w: W + 0.04, d: D + 0.03, cz: 0.015, y0: 0.69, h: 0.42, ov: 0.06, color: v.roof, wall: v.plaster, rows: 7 });
    for (const x of [-0.2, 0.2]) dormer(K, { x, d: D + 0.03 + 0.03, y0: 0.69, h: 0.42, color: v.roof, wall: v.plaster });
    chimney(K, -0.3, 0.86, -0.16, 0.34); chimney(K, 0.3, 0.86, -0.16, 0.34);
    onFace(K, g, 'front', () => hangingSign(K, 0.36, 0.36, pick(['#7a2f2a', '#2f4f6e', '#3d5a40']), GOLD));
  },
  5(K, v) { // 三層石砌階梯山牆屋
    const W = 0.78, D = 0.74;
    const fac = v.facade;
    K.body.push(P(rbx(W + 0.06, 0.05, D + 0.06, 0.02), v.stone, { y: 0.025 }));
    const g = block(K, 0, 0, W, D, 0.05, 0.34, v.stoneWall);
    onFace(K, g, 'front', (fw) => {
      rustic(K, fw, 0.05, 0.34, v.stoneWall);
      door(K, 0, 0.05, { w: 0.15, h: 0.28, color: v.door, fan: true });
      for (const x of [-0.25, 0.25]) win(K, x, 0.2, { w: 0.11, h: 0.13, arch: true });
    });
    band(K, g, 0.395, '#e9e0cc', 0.022, 0.032);
    const u = block(K, 0, 0, W, D, 0.41, 0.54, fac);
    quoins(K, u, v.quoin);
    band(K, u, 0.68, '#e9e0cc', 0.014, 0.02);
    onFace(K, u, 'front', () => {
      for (const x of [-0.24, 0, 0.24]) win(K, x, 0.54, { w: 0.1, h: 0.17, arch: true, cap: x === 0 });
      balcony(K, 0.62, 0.43);
      for (const x of [-0.24, 0, 0.24]) win(K, x, 0.83, { w: 0.09, h: 0.14, sh: v.shutter, fb: true });
    });
    for (const s of ['left', 'right']) onFace(K, u, s, () => { for (const x of [-0.16, 0.16]) { win(K, x, 0.54, { w: 0.09, h: 0.15 }); win(K, x, 0.83, { w: 0.08, h: 0.13 }); } });
    onFace(K, g, 'left', () => win(K, 0, 0.21, { w: 0.09, h: 0.12, arch: true }));
    band(K, u, 0.955, '#efe7d6', 0.03, 0.04);
    gable(K, { w: D + 0.02, d: W, y0: 0.975, h: 0.42, ov: 0.04, color: v.slate, wall: fac, rows: 7, ridgeZ: true });
    // 臨街階梯山牆
    for (let k = 0; k < 5; k++) {
      const sw = W - k * 0.14;
      K.body.push(P(bx(sw, 0.085, 0.06), fac, { y: 0.975 + k * 0.085 + 0.0425, z: D / 2 - 0.03 }));
      K.body.push(P(bx(sw + 0.02, 0.016, 0.075), '#efe7d6', { y: 0.975 + (k + 1) * 0.085, z: D / 2 - 0.03 }));
    }
    K.body.push(P(new THREE.ConeGeometry(0.05, 0.1, 4), '#efe7d6', { y: 0.975 + 5 * 0.085 + 0.05, z: D / 2 - 0.03, ry: PI / 4 }));
    K.glow.push(P(new THREE.CylinderGeometry(0.045, 0.045, 0.02, 14), '#fff', { y: 1.13, z: D / 2 + 0.002, rx: PI / 2 }));
    K.body.push(P(new THREE.TorusGeometry(0.05, 0.01, 4, 16), FRAME, { y: 1.13, z: D / 2 + 0.008 }));
    chimney(K, 0.3, 1.1, -0.2, 0.3);
  },
  6(K, v) { // 雙併宅邸（2×1）
    const W = 1.84, D = 0.78;
    K.body.push(P(rbx(W + 0.06, 0.06, D + 0.06, 0.02), v.stone, { y: 0.03 }));
    const g = block(K, 0, 0, W, D, 0.06, 0.32, v.stoneWall);
    onFace(K, g, 'front', (fw) => {
      rustic(K, fw, 0.06, 0.32, v.stoneWall);
      door(K, 0, 0.06, { w: 0.16, h: 0.28, color: v.door, fan: true });
      for (const x of [-0.72, -0.42, 0.42, 0.72]) win(K, x, 0.2, { w: 0.11, h: 0.13, arch: true });
      for (const x of [-0.15, 0.15]) {
        K.body.push(P(new THREE.CylinderGeometry(0.024, 0.028, 0.3, 10), '#f1ebdf', { x, y: 0.21, z: 0.11 }));
        K.body.push(P(bx(0.06, 0.02, 0.06), '#f1ebdf', { x, y: 0.37, z: 0.11 }));
        K.body.push(P(bx(0.06, 0.02, 0.06), '#f1ebdf', { x, y: 0.07, z: 0.11 }));
      }
      K.body.push(P(bx(0.42, 0.04, 0.17), '#efe7d6', { y: 0.4, z: 0.08 }));
      const tri = new THREE.Shape([new THREE.Vector2(-0.23, 0), new THREE.Vector2(0.23, 0), new THREE.Vector2(0, 0.11)]);
      K.body.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false }), '#efe7d6', { y: 0.42, z: 0.0 }));
      for (let k = 0; k < 3; k++) K.body.push(P(bx(0.5 - k * 0.04, 0.022, 0.06), '#d6cab3', { y: 0.011 + k * 0.022 + 0.04, z: 0.2 - k * 0.04 }));
      lantern(K, -0.28, 0.3); lantern(K, 0.28, 0.3);
    });
    band(K, g, 0.39, '#e9e0cc', 0.022, 0.032);
    const u = block(K, 0, 0, W, D, 0.405, 0.6, v.plaster);
    quoins(K, u, v.quoin);
    band(K, u, 0.71, '#e9e0cc', 0.012, 0.018);
    onFace(K, u, 'front', () => {
      for (const x of [-0.72, -0.36, 0, 0.36, 0.72]) win(K, x, 0.56, { w: 0.11, h: 0.19, cap: true, sh: x === 0 ? null : v.shutter });
      balcony(K, 0.5, 0.445);
      for (const x of [-0.72, 0.72]) grp(K, x, 0, 0, 0, () => balcony(K, 0.2, 0.445, { depth: 0.07 }));
      for (const x of [-0.72, -0.36, 0, 0.36, 0.72]) win(K, x, 0.86, { w: 0.1, h: 0.15, sh: v.shutter, fb: true });
    });
    for (const s of ['left', 'right']) onFace(K, u, s, () => { for (const x of [-0.18, 0.18]) { win(K, x, 0.56, { w: 0.1, h: 0.17 }); win(K, x, 0.86, { w: 0.09, h: 0.14 }); } });
    onFace(K, u, 'back', () => { for (const x of [-0.6, -0.2, 0.2, 0.6]) { win(K, x, 0.56, { w: 0.1, h: 0.17 }); win(K, x, 0.86, { w: 0.09, h: 0.14 }); } });
    band(K, u, 1.0, '#efe7d6', 0.035, 0.045);
    mansard(K, { w: W, d: D, y0: 1.02, h1: 0.26, h2: 0.1, color: v.slate });
    for (const x of [-0.6, 0, 0.6]) {
      K.body.push(P(bx(0.14, 0.14, 0.14), '#efe7d6', { x, y: 1.1, z: D / 2 - 0.04 }));
      grp(K, x, 0, D / 2 + 0.03, 0, () => win(K, 0, 1.1, { w: 0.07, h: 0.08 }));
      const tri = new THREE.Shape([new THREE.Vector2(-0.085, 0), new THREE.Vector2(0.085, 0), new THREE.Vector2(0, 0.06)]);
      K.body.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.16, bevelEnabled: false }), v.slate, { x, y: 1.17, z: D / 2 - 0.12 }));
    }
    chimney(K, -0.55, 1.2, -0.15, 0.3); chimney(K, 0.55, 1.2, -0.15, 0.3);
    for (const x of [-0.42, 0.42]) urn(K, x, 0.06, 0.45);
  },
  7(K, v) { // 莊園（2×2）
    K.body.push(P(bx(1.92, 0.03, 1.92), '#e6dccb', { y: 0.015 }));
    const main = block(K, 0, -0.48, 1.7, 0.72, 0.03, 0.9, v.plaster);
    quoins(K, main, v.quoin);
    for (const y of [0.33, 0.63]) band(K, main, y, '#e9e0cc', 0.014, 0.02);
    band(K, main, 0.93, '#efe7d6', 0.035, 0.045);
    onFace(K, main, 'front', () => {
      for (const x of [-0.62, -0.32, 0.32, 0.62]) win(K, x, 0.18, { w: 0.1, h: 0.15, arch: true });
      door(K, 0, 0.03, { w: 0.16, h: 0.28, color: v.door, fan: true });
      for (const x of [-0.62, -0.32, 0, 0.32, 0.62]) { win(K, x, 0.48, { w: 0.1, h: 0.17, sh: v.shutter, cap: true }); win(K, x, 0.78, { w: 0.09, h: 0.14, sh: v.shutter, fb: true }); }
      balcony(K, 0.36, 0.34);
      lantern(K, -0.14, 0.27); lantern(K, 0.14, 0.27);
    });
    onFace(K, main, 'back', () => { for (const x of [-0.6, -0.2, 0.2, 0.6]) for (const y of [0.18, 0.48, 0.78]) win(K, x, y, { w: 0.09, h: 0.14 }); });
    hipRoof(K, { cz: -0.48, w: 1.7, d: 0.72, y0: 0.955, h: 0.36, ov: 0.05, color: v.slate });
    chimney(K, -0.5, 1.05, -0.6, 0.32); chimney(K, 0.2, 1.05, -0.6, 0.32);
    for (const sx of [-1, 1]) {
      const wg = block(K, sx * 0.62, 0.32, 0.46, 0.9, 0.03, 0.6, v.plaster2);
      quoins(K, wg, v.quoin);
      band(K, wg, 0.33, '#e9e0cc', 0.012, 0.02);
      band(K, wg, 0.63, '#efe7d6', 0.025, 0.035);
      onFace(K, wg, 'front', () => { win(K, 0, 0.18, { w: 0.1, h: 0.15, arch: true }); win(K, 0, 0.48, { w: 0.1, h: 0.16, sh: v.shutter, fb: true }); });
      onFace(K, wg, sx < 0 ? 'right' : 'left', () => { for (const x of [-0.24, 0.12]) { win(K, x, 0.18, { w: 0.09, h: 0.14 }); win(K, x, 0.48, { w: 0.09, h: 0.14, sh: v.shutter }); } });
      onFace(K, wg, sx < 0 ? 'left' : 'right', () => { for (const x of [-0.24, 0.12]) win(K, x, 0.48, { w: 0.09, h: 0.14 }); });
      gable(K, { cx: sx * 0.62, cz: 0.32, w: 0.9, d: 0.46, y0: 0.655, h: 0.3, ov: 0.05, color: v.roof, wall: v.plaster2, rows: 5, ridgeZ: true });
      K.glow.push(P(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), '#fff', { x: sx * 0.62, y: 0.78, z: 0.775, rx: PI / 2 }));
    }
    tower(K, { x: 0.72, z: -0.66, s: 0.34, y0: 0.03, h: 1.22, color: v.plaster, roof: v.copper, spireH: 0.7, floors: 4 });
    flag(K, 0.72, 2.0, -0.66, pick([0xc0392b, 0x2e5c8a, 0xe8c065]), 0.24);
    fountain(K, 0, 0.32, 0.17, 1);
    for (const [x, z] of [[-0.25, 0.1], [0.25, 0.1], [-0.25, 0.56], [0.25, 0.56]]) hedge(K, x, z, 0.16, 0.16, 0.06);
    for (const x of [-0.3, 0.3]) topiary(K, x, 0.85);
    for (const sx of [-1, 1]) {
      K.body.push(P(bx(0.6, 0.08, 0.05), '#d8cdb8', { x: sx * 0.55, y: 0.04, z: 0.93 }));
      K.body.push(P(bx(0.6, 0.012, 0.012), IRON, { x: sx * 0.55, y: 0.15, z: 0.93 }));
      for (let k = 0; k <= 10; k++) K.body.push(P(bx(0.007, 0.07, 0.007), IRON, { x: sx * (0.25 + k * 0.06), y: 0.115, z: 0.93 }));
      K.body.push(P(bx(0.07, 0.2, 0.07), '#e6dccb', { x: sx * 0.2, y: 0.1, z: 0.93 }));
      K.body.push(P(new THREE.SphereGeometry(0.03, 8, 6), GOLD, { x: sx * 0.2, y: 0.23, z: 0.93 }));
    }
  },
  8(K, v) { // 宮邸（2×2）
    const cream = '#f4ead6', trim = '#efe5d2';
    K.body.push(P(rbx(1.96, 0.08, 1.96, 0.03), '#e3d8c4', { y: 0.04 }));
    const pav = block(K, 0, -0.32, 0.8, 0.86, 0.08, 1.02, cream);
    quoins(K, pav, trim);
    for (const y of [0.42, 0.76]) band(K, pav, y, trim, 0.016, 0.024);
    band(K, pav, 1.1, trim, 0.04, 0.05);
    onFace(K, pav, 'front', () => {
      door(K, 0, 0.08, { w: 0.16, h: 0.3, color: '#5a3a28', fan: true });
      for (const x of [-0.27, 0.27]) { win(K, x, 0.24, { w: 0.1, h: 0.17, arch: true }); win(K, x, 0.58, { w: 0.1, h: 0.19, cap: true }); }
      for (const x of [-0.27, 0, 0.27]) win(K, x, 0.92, { w: 0.09, h: 0.15 });
    });
    for (const s of ['left', 'right', 'back']) onFace(K, pav, s, () => { for (const x of [-0.22, 0.22]) for (const y of [0.24, 0.58, 0.92]) win(K, x, y, { w: 0.09, h: 0.15, arch: y < 0.3 }); });
    // 巨柱門廊
    for (const x of [-0.27, -0.09, 0.09, 0.27]) {
      K.body.push(P(new THREE.CylinderGeometry(0.028, 0.032, 0.62, 12), '#f6f1e6', { x, y: 0.39, z: 0.24 }));
      K.body.push(P(bx(0.07, 0.025, 0.07), trim, { x, y: 0.71, z: 0.24 }));
      K.body.push(P(bx(0.07, 0.025, 0.07), trim, { x, y: 0.09, z: 0.24 }));
    }
    K.body.push(P(bx(0.72, 0.05, 0.22), trim, { y: 0.745, z: 0.2 }));
    const ped = new THREE.Shape([new THREE.Vector2(-0.38, 0), new THREE.Vector2(0.38, 0), new THREE.Vector2(0, 0.17)]);
    K.body.push(P(new THREE.ExtrudeGeometry(ped, { depth: 0.2, bevelEnabled: false }), trim, { y: 0.77, z: 0.1 }));
    K.body.push(P(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 12), GOLD, { y: 0.84, z: 0.305, rx: PI / 2 }));
    for (let k = 0; k < 5; k++) K.body.push(P(bx(0.66 - k * 0.03, 0.02, 0.05), '#e3d8c4', { y: 0.09 + k * 0.02, z: 0.42 - k * 0.035 }));
    mansard(K, { cz: -0.32, w: 0.8, d: 0.86, y0: 1.125, h1: 0.24, h2: 0.08, color: '#4f5b6b' });
    // 中央鐘樓
    K.body.push(P(new THREE.CylinderGeometry(0.13, 0.15, 0.32, 8), cream, { y: 1.6, z: -0.32, flat: true }));
    K.glow.push(P(new THREE.CylinderGeometry(0.132, 0.132, 0.1, 8, 1, true), '#fff', { y: 1.62, z: -0.32, flat: true }));
    K.body.push(P(new THREE.CylinderGeometry(0.17, 0.17, 0.03, 8), GOLD, { y: 1.77, z: -0.32, flat: true }));
    spire(K, 0, 1.785, -0.32, 0.16, 0.42, '#5f9a8c', 8);
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), M.crystal);
    cr.scale.set(1, 1.6, 1); cr.position.set(0, 2.5, -0.32);
    K.extra.push(cr); K.spin.push({ obj: cr, y0: 2.5, bob: 0.05, rot: 0.9 });
    // 兩翼：平屋頂＋欄杆
    for (const sx of [-1, 1]) {
      const wg = block(K, sx * 0.66, -0.4, 0.54, 0.66, 0.08, 0.68, cream);
      quoins(K, wg, trim);
      band(K, wg, 0.42, trim, 0.014, 0.022);
      band(K, wg, 0.76, trim, 0.035, 0.045);
      onFace(K, wg, 'front', () => { for (const x of [-0.15, 0.15]) { win(K, x, 0.24, { w: 0.1, h: 0.17, arch: true }); win(K, x, 0.58, { w: 0.1, h: 0.18, cap: true }); } });
      onFace(K, wg, sx < 0 ? 'left' : 'right', () => { for (const x of [-0.17, 0.17]) for (const y of [0.24, 0.58]) win(K, x, y, { w: 0.09, h: 0.15 }); });
      const yt = 0.785;
      for (const [len, along, off] of [[0.6, 'x', 0.35], [0.72, 'z', 0.3]]) {
        for (const s2 of [-1, 1]) {
          const px = along === 'x' ? sx * 0.66 : sx * 0.66 + s2 * 0.3, pz = along === 'x' ? -0.4 + s2 * 0.35 : -0.4;
          K.body.push(P(bx(along === 'x' ? len : 0.03, 0.022, along === 'x' ? 0.03 : len), trim, { x: px, y: yt + 0.09, z: pz }));
          const n = 9;
          for (let k = 0; k <= n; k++) {
            const t = -len / 2 + k * len / n;
            K.body.push(P(new THREE.CylinderGeometry(0.008, 0.011, 0.07, 6), trim, { x: along === 'x' ? px + t : px, y: yt + 0.045, z: along === 'x' ? pz : pz + t }));
          }
        }
      }
      for (const [ux, uz] of [[-0.3, -0.35], [0.3, -0.35], [-0.3, -0.05], [0.3, -0.05]]) urn(K, sx * 0.66 + ux, yt + 0.1, uz);
      flag(K, sx * 0.66, yt + 0.02, -0.4, sx < 0 ? 0x2e5c8a : 0xc0392b, 0.4);
    }
    // 正式花園
    K.body.push(P(bx(1.9, 0.012, 0.86), '#e9dfcc', { y: 0.086, z: 0.53 }));
    for (const sx of [-1, 1]) for (const sz of [0.36, 0.72]) {
      hedge(K, sx * 0.55, sz, 0.5, 0.05, 0.05); hedge(K, sx * 0.3, sz, 0.05, 0.2, 0.05);
      K.body.push(P(bx(0.4, 0.02, 0.14), '#7fb05d', { x: sx * 0.55, y: 0.1, z: sz }));
      for (let k = 0; k < 7; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.018, 0), pick(['#ff7f9e', '#ffd25e', '#ffffff', '#c7a6ff']), { x: sx * 0.55 - 0.15 + k * 0.05, y: 0.12, z: sz }));
      topiary(K, sx * 0.85, sz, 0.9);
    }
    grp(K, 0, 0.086, 0.62, 0, () => fountain(K, 0, 0, 0.2, 2));
    for (const sx of [-1, 1]) statue(K, sx * 0.22, 0.88, 0.086);
    for (const sx of [-1, 1]) {
      K.body.push(P(bx(0.7, 0.012, 0.012), IRON, { x: sx * 0.6, y: 0.2, z: 0.96 }));
      for (let k = 0; k <= 12; k++) { K.body.push(P(bx(0.007, 0.12, 0.007), IRON, { x: sx * (0.25 + k * 0.058), y: 0.14, z: 0.96 })); K.body.push(P(new THREE.ConeGeometry(0.008, 0.02, 4), GOLD, { x: sx * (0.25 + k * 0.058), y: 0.215, z: 0.96 })); }
      K.body.push(P(bx(0.08, 0.26, 0.08), '#e6dccb', { x: sx * 0.2, y: 0.13, z: 0.96 }));
      K.body.push(P(new THREE.SphereGeometry(0.035, 8, 6), GOLD, { x: sx * 0.2, y: 0.29, z: 0.96 }));
    }
  },
};

// ---------------------------------------------------------------- 公共建築
const SERVICES = {
  church(K, v) { // 1×2，縱深兩格
    const st = '#ddd3c1';
    K.body.push(P(rbx(0.84, 0.05, 1.86, 0.02), '#cfc4ae', { y: 0.025, z: -0.04 }));
    const nave = block(K, 0, -0.18, 0.62, 1.3, 0.05, 0.62, st);
    for (const sx of [-1, 1]) for (let k = 0; k < 4; k++) {
      const z = -0.7 + k * 0.32;
      K.body.push(P(bx(0.06, 0.44, 0.07), shade(st, 0.95), { x: sx * 0.33, y: 0.27, z }));
      K.body.push(P(bx(0.06, 0.06, 0.07), shade(st, 0.9), { x: sx * 0.33, y: 0.5, z, rz: sx * 0.6 }));
    }
    for (const s of ['left', 'right']) onFace(K, nave, s, () => { for (const x of [-0.48, -0.16, 0.16, 0.48]) win(K, x, 0.33, { w: 0.08, h: 0.24, arch: true, frame: '#e9e0cc' }); });
    onFace(K, nave, 'back', () => { K.glow.push(P(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 16), '#fff', { y: 0.45, z: 0.01, rx: PI / 2 })); K.body.push(P(new THREE.TorusGeometry(0.1, 0.016, 4, 20), '#e9e0cc', { y: 0.45, z: 0.012 })); });
    gable(K, { cz: -0.18, w: 1.3, d: 0.62, y0: 0.67, h: 0.5, ov: 0.05, color: v.slate, wall: st, rows: 8, ridgeZ: true });
    const tw = tower(K, { x: 0, z: 0.6, s: 0.42, y0: 0.05, h: 1.2, color: st, roof: '#556274', spireH: 0.95, floors: 4, sides: 8, belfry: true });
    onFace(K, tw, 'front', () => {
      door(K, 0, 0.05, { w: 0.16, h: 0.32, color: '#5a3a28' });
      K.glow.push(P(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 16), '#fff', { y: 0.72, z: 0.01, rx: PI / 2 }));
      K.body.push(P(bx(0.008, 0.05, 0.008), '#2b2730', { y: 0.735, z: 0.026 }));
      K.body.push(P(bx(0.04, 0.008, 0.008), '#2b2730', { x: 0.015, y: 0.72, z: 0.026 }));
      lantern(K, -0.14, 0.32); lantern(K, 0.14, 0.32);
    });
  },
  well(K, v) {
    K.body.push(P(rbx(0.62, 0.03, 0.62, 0.02), '#d6c9ae', { y: 0.015 }));
    K.body.push(P(rbx(0.32, 0.2, 0.32, 0.03), v.stoneWall, { y: 0.13 }));
    K.body.push(P(bx(0.25, 0.01, 0.25), '#2f6f86', { y: 0.225 }));
    K.body.push(P(bx(0.36, 0.03, 0.36), '#e6dccb', { y: 0.24 }));
    for (const x of [-0.15, 0.15]) K.body.push(P(bx(0.03, 0.34, 0.03), '#7a5236', { x, y: 0.4 }));
    K.body.push(P(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6), '#7a5236', { rz: PI / 2, y: 0.47 }));
    gable(K, { w: 0.42, d: 0.3, y0: 0.57, h: 0.14, ov: 0.04, color: v.roof, wall: '#7a5236', rows: 3 });
    K.body.push(P(new THREE.CylinderGeometry(0.03, 0.025, 0.05, 8), '#8a6040', { y: 0.36 }));
    for (const [x, z] of [[0.24, 0.2], [-0.24, 0.22]]) K.body.push(P(new THREE.IcosahedronGeometry(0.05, 1), ['#4f8a42', '#7ab35a'], { x, y: 0.05, z, sy: 0.8 }));
  },
  apothecary(K, v) {
    HOUSES[3](K, v);
    onFace(K, { cx: 0, cz: 0, w: 0.72, d: 0.6 }, 'front', () => hangingSign(K, 0.36, 0.33, '#2f6b4f', '#f4f0e0'));
    for (const [x, z] of [[0.32, 0.38], [0.2, 0.4]]) { K.body.push(P(new THREE.CylinderGeometry(0.04, 0.03, 0.06, 8), '#c4774f', { x, y: 0.03, z })); K.body.push(P(new THREE.IcosahedronGeometry(0.045, 1), ['#4e8f62', '#8cc77e'], { x, y: 0.08, z })); }
  },
  bakery(K, v) {
    HOUSES[2](K, v);
    K.body.push(P(rbx(0.2, 0.12, 0.2, 0.04), '#c9a27a', { x: 0.36, y: 0.06, z: -0.28 }));
    K.body.push(P(new THREE.SphereGeometry(0.1, 10, 6, 0, TAU, 0, PI / 2), '#b9825a', { x: 0.36, y: 0.12, z: -0.28 }));
    K.fire.push(P(bx(0.06, 0.04, 0.01), '#fff', { x: 0.36, y: 0.1, z: -0.175 }));
    onFace(K, { cx: 0, cz: 0, w: 0.7, d: 0.52 }, 'front', () => hangingSign(K, 0.35, 0.32, '#8a5a2c', '#f2d27a'));
  },
  tavern(K, v) {
    HOUSES[4](K, v);
    for (const x of [-0.42, 0.42]) {
      K.body.push(P(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), '#8a6244', { x, y: 0.09, z: 0.3 }));
      K.body.push(P(new THREE.CylinderGeometry(0.01, 0.01, 0.09, 6), IRON, { x, y: 0.045, z: 0.3 }));
      K.body.push(P(new THREE.CylinderGeometry(0.006, 0.006, 0.26, 5), IRON, { x, y: 0.2, z: 0.3 }));
      K.body.push(P(new THREE.ConeGeometry(0.13, 0.07, 8), pick(['#c0392b', '#2e5c8a', '#e8c065', '#3d6b4a']), { x, y: 0.34, z: 0.3 }));
    }
  },
  garden(K, v) {
    K.body.push(P(bx(0.94, 0.03, 0.94), '#7fb05d', { y: 0.015 }));
    K.body.push(P(bx(0.16, 0.034, 0.94), '#e3d6b8', { y: 0.017 }));
    K.body.push(P(bx(0.94, 0.034, 0.16), '#e3d6b8', { y: 0.017 }));
    for (const [x, z] of [[-0.28, -0.28], [0.28, -0.28], [-0.28, 0.28], [0.28, 0.28]]) {
      hedge(K, x, z, 0.3, 0.3, 0.06);
      for (let k = 0; k < 6; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.022, 0), pick(['#ff8fb0', '#ffe066', '#ffffff', '#c7a6ff', '#ff9a5a']), { x: x + (R() - 0.5) * 0.2, y: 0.075, z: z + (R() - 0.5) * 0.2 }));
    }
    statue(K, 0, 0, 0.03);
    bench(K, 0.42, 0, -PI / 2); bench(K, -0.42, 0, PI / 2);
  },
  watermill(K, v) { // 正面朝河，水車在 +z 側伸進河道
    K.body.push(P(rbx(0.76, 0.06, 0.62, 0.02), v.stone, { y: 0.03, z: -0.05 }));
    const g = block(K, 0, -0.05, 0.7, 0.56, 0.06, 0.3, v.stoneWall);
    quoins(K, g, v.quoin);
    const u = block(K, 0, -0.05, 0.72, 0.58, 0.36, 0.2, v.plaster);
    onFace(K, u, 'front', (fw) => { for (const x of timber(K, fw, 0.36, 0.2, { color: v.timber, bays: 3 })) win(K, x, 0.46, { w: 0.08, h: 0.09, fb: true }); });
    onFace(K, g, 'left', () => { door(K, 0, 0.06, { w: 0.12, h: 0.22, color: v.door }); lantern(K, 0.12, 0.28); });
    onFace(K, g, 'right', () => win(K, 0, 0.2, { w: 0.09, h: 0.11, sh: v.shutter }));
    gable(K, { cz: -0.05, w: 0.72, d: 0.58, y0: 0.56, h: 0.32, ov: 0.06, color: v.roof, wall: v.plaster, rows: 5 });
    chimney(K, -0.22, 0.7, -0.2, 0.28);
    const hub = new THREE.Group(); hub.position.set(0.05, 0.08, 0.36);
    const wl = [];
    wl.push(P(new THREE.CylinderGeometry(0.03, 0.03, 0.14, 8), '#5a3f2e', { rx: PI / 2 }));
    for (const zz of [-0.05, 0.05]) wl.push(P(new THREE.TorusGeometry(0.27, 0.015, 4, 24), '#6e4c36', { z: zz }));
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * TAU;
      wl.push(P(bx(0.02, 0.27, 0.012), '#6e4c36', { x: Math.sin(a) * 0.135, y: Math.cos(a) * 0.135, rz: -a, z: 0.05 }));
      wl.push(P(bx(0.02, 0.27, 0.012), '#6e4c36', { x: Math.sin(a) * 0.135, y: Math.cos(a) * 0.135, rz: -a, z: -0.05 }));
      wl.push(P(bx(0.07, 0.012, 0.12), '#8a6244', { x: Math.sin(a) * 0.27, y: Math.cos(a) * 0.27, rz: -a }));
    }
    hub.add(meshOf(wl, M.std));
    K.extra.push(hub); K.spin.push({ obj: hub, spinZ: 0.9 });
  },
  windmill(K, v) {
    K.body.push(P(new THREE.CylinderGeometry(0.34, 0.36, 0.08, 8), v.stone, { y: 0.04, flat: true }));
    K.body.push(P(new THREE.CylinderGeometry(0.19, 0.28, 0.86, 8), ['#ece2d0', '#f7f1e6'], { y: 0.51, flat: true }));
    K.body.push(P(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8), '#8a6244', { y: 0.5, flat: true }));
    K.body.push(P(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 8), '#8a6244', { y: 0.95, flat: true }));
    K.body.push(P(new THREE.ConeGeometry(0.24, 0.32, 8), v.thatch, { y: 1.12, flat: true }));
    grp(K, 0, 0, 0.255, 0, () => { door(K, 0, 0.08, { w: 0.12, h: 0.2, color: v.door }); });
    grp(K, 0, 0, 0.21, 0, () => win(K, 0, 0.66, { w: 0.07, h: 0.09 }));
    const hub = new THREE.Group(); hub.position.set(0, 0.9, 0.26);
    const bl = [P(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), '#5a3f2e', { rx: PI / 2 })];
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU + 0.3;
      bl.push(P(bx(0.03, 0.56, 0.014), '#6e4c36', { x: Math.sin(a) * 0.28, y: Math.cos(a) * 0.28, rz: -a, z: 0.03 }));
      for (let s = 0; s < 4; s++) bl.push(P(bx(0.12, 0.008, 0.008), '#6e4c36', { x: Math.sin(a) * (0.16 + s * 0.11) + Math.cos(a) * 0.06, y: Math.cos(a) * (0.16 + s * 0.11) - Math.sin(a) * 0.06, rz: -a, z: 0.04 }));
      bl.push(P(bx(0.1, 0.42, 0.006), '#f6efe0', { x: Math.sin(a) * 0.34 + Math.cos(a) * 0.065, y: Math.cos(a) * 0.34 - Math.sin(a) * 0.065, rz: -a, z: 0.045 }));
    }
    hub.add(meshOf(bl, M.std));
    K.extra.push(hub); K.spin.push({ obj: hub, spinZ: 0.7 });
    K.body.push(P(bx(0.5, 0.012, 0.012), '#9a7650', { x: -0.05, y: 0.1, z: 0.44, rz: 0 }));
  },
  lighthouse(K, v) {
    K.body.push(P(rbx(0.8, 0.06, 0.8, 0.03), '#bdb3a2', { y: 0.03 }));
    const segs = 6, H = 1.5;
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      K.body.push(P(new THREE.CylinderGeometry(0.24 - 0.09 * t1, 0.24 - 0.09 * t0, H / segs, 8), k % 2 ? '#c0392b' : '#f6f1e6', { y: 0.06 + (k + 0.5) * H / segs, flat: true }));
    }
    K.body.push(P(new THREE.CylinderGeometry(0.22, 0.2, 0.04, 8), '#3b3944', { y: 1.58, flat: true }));
    for (let k = 0; k < 16; k++) { const a = k / 16 * TAU; K.body.push(P(bx(0.008, 0.06, 0.008), IRON, { x: Math.cos(a) * 0.2, y: 1.63, z: Math.sin(a) * 0.2 })); }
    K.glow.push(P(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 8), '#fff', { y: 1.68, flat: true }));
    K.body.push(P(new THREE.ConeGeometry(0.15, 0.16, 8), '#c0392b', { y: 1.84, flat: true }));
    K.body.push(P(new THREE.SphereGeometry(0.03, 8, 6), GOLD, { y: 1.94 }));
    const kb = block(K, 0.28, 0.2, 0.3, 0.26, 0.06, 0.22, '#f6f1e6');
    gable(K, { cx: 0.28, cz: 0.2, w: 0.3, d: 0.26, y0: 0.28, h: 0.14, ov: 0.04, color: '#c0392b', wall: '#f6f1e6', rows: 3 });
    onFace(K, kb, 'front', () => door(K, 0, 0.06, { w: 0.09, h: 0.16, color: '#3f5a6e', arch: false }));
    const beam = new THREE.Group(); beam.position.set(0, 1.68, 0);
    const bm = new THREE.Mesh(new THREE.ConeGeometry(0.5, 4, 16, 1, true).translate(0, -2, 0).rotateZ(PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff1c4, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    bm.userData.beam = true; beam.add(bm);
    K.extra.push(beam); K.spin.push({ obj: beam, beam: bm, rot: 0.8 });
  },
  magetower(K, v) {
    const st = '#a79fb8';
    K.body.push(P(rbx(0.7, 0.08, 0.7, 0.03), '#8f88a3', { y: 0.04 }));
    const b = block(K, 0, 0, 0.42, 0.42, 0.08, 1.5, st);
    quoins(K, b, '#c9c2d8');
    for (let f = 1; f < 5; f++) band(K, b, 0.08 + f * 0.3, '#c9c2d8', 0.014, 0.02);
    for (const s of ['front', 'back', 'left', 'right']) onFace(K, b, s, () => { for (let f = 0; f < 5; f++) if (f > 0 || s !== 'front') win(K, 0, 0.08 + f * 0.3 + 0.15, { w: 0.06, h: 0.11, arch: true }); });
    onFace(K, b, 'front', () => door(K, 0, 0.08, { w: 0.12, h: 0.22, color: '#3a2f4a' }));
    for (const [x, z] of [[0.21, 0.21], [-0.21, 0.21], [0.21, -0.21], [-0.21, -0.21]]) K.body.push(P(new THREE.ConeGeometry(0.05, 0.16, 4), '#5b4a7a', { x, y: 1.66, z, ry: PI / 4, flat: true }));
    spire(K, 0, 1.6, 0, 0.3, 0.8, '#5b4a7a', 4);
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.12, 0), M.crystal);
    cr.scale.set(1, 1.7, 1); cr.position.set(0, 2.85, 0);
    K.extra.push(cr); K.spin.push({ obj: cr, y0: 2.85, bob: 0.07, rot: 0.7 });
    const orb = new THREE.Group(); orb.position.set(0, 2.2, 0);
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU; const s = new THREE.Mesh(new THREE.DodecahedronGeometry(0.05 + R() * 0.03, 0), M.rock); s.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(s.geometry.attributes.position.count * 3).fill(0.55), 3)); s.position.set(Math.cos(a) * 0.5, Math.sin(a * 2) * 0.1, Math.sin(a) * 0.5); orb.add(s); }
    K.extra.push(orb); K.spin.push({ obj: orb, orbit: 0.4 });
  },
};

SERVICES.fountain = (K) => fountain(K, 0, 0, 0.46, 2);
SERVICES.stall = (K) => {
  const awn = pick([['#c0392b', '#fff3e0'], ['#2e5c8a', '#fff3e0'], ['#3d6b4a', '#f5ecd6'], ['#d9822b', '#fff3e0']]);
  for (const [x, z] of [[-0.2, -0.13], [0.2, -0.13], [-0.2, 0.13], [0.2, 0.13]]) K.body.push(P(bx(0.022, 0.3, 0.022), '#7a5236', { x, y: 0.15, z }));
  for (let k = 0; k < 6; k++) K.body.push(P(bx(0.08, 0.016, 0.38), awn[k % 2], { x: -0.2 + k * 0.08, y: 0.31, rx: 0.18 }));
  K.body.push(P(bx(0.46, 0.1, 0.22), '#9a7048', { y: 0.09, z: 0.05 }));
  for (let k = 0; k < 10; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.03, 1), pick(['#ff8a3d', '#e8443a', '#9ccc65', '#ffd54a', '#a55ad6']), { x: -0.18 + (k % 5) * 0.09, y: 0.16, z: 0.0 + Math.floor(k / 5) * 0.09 }));
  barrel(K, 0.26, -0.18); K.body.push(P(bx(0.09, 0.07, 0.09), '#b08a5e', { x: -0.27, y: 0.035, z: -0.2 }));
};
export const SERVICE_INFO = {
  church: { name: '教堂', need: '信仰', r: 6 },
  well: { name: '水井', need: '水', r: 4 },
  apothecary: { name: '藥坊', need: '醫療', r: 5 },
  bakery: { name: '麵包坊', need: '食物', r: 5 },
  tavern: { name: '酒館', need: '娛樂', r: 4 },
  garden: { name: '花園', need: '美景', r: 3 },
  market: { name: '市集', need: '食物', r: 7 },
  watermill: { name: '水車磨坊', need: '食物', r: 0 },
  windmill: { name: '風車', need: '食物', r: 0 },
  lighthouse: { name: '燈塔', need: '', r: 0 },
  magetower: { name: '法師塔', need: '', r: 0 },
};
export const TIER_NAME = ['', '茅草小屋', '石砌農舍', '木骨架屋', '聯排屋', '階梯山牆屋', '雙併宅邸', '莊園', '宮邸'];

// 夜裡門前地上的光暈大小
const POOL = { 1: 0.7, 2: 0.85, 3: 1.0, 4: 1.15, 5: 1.25, 6: 1.9, 7: 2.2, 8: 2.6, church: 1.6, tavern: 1.3, apothecary: 1.0, bakery: 1.0, watermill: 0.9, magetower: 1.4 };

export function assemble(type, tier, seed, pools, W) {
  R = makeRng(seed);
  const v = variant();
  const K = newKit();
  if (type === 'house') HOUSES[tier](K, v); else SERVICES[type](K, v);
  const g = new THREE.Group();
  const fin = (m) => { if (W) warpGeometry(m.geometry, W); return m; };
  if (K.body.length) { const geo = merge(K.body); applyAO(geo, 0); const m = fin(new THREE.Mesh(geo, M.std)); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  if (K.glow.length) g.add(fin(meshOf(K.glow, M.win, { cast: false })));
  if (K.fire.length) g.add(fin(meshOf(K.fire, M.fire, { cast: false })));
  for (const e of K.extra) { e.traverse((o) => { if (o.isMesh && !o.userData.beam) { o.castShadow = true; o.receiveShadow = true; } }); g.add(W ? warpObject(e, W) : e); }
  if (W) { K.chimneys = K.chimneys.map((v) => warpPoint(v, W)); K.lamps = K.lamps.map((v) => warpPoint(v, W)); }
  const pk = type === 'house' ? tier : type;
  if (POOL[pk] && pools) {
    const sz = POOL[pk];
    const depth = tier >= 7 ? 1 : (type === 'church' ? 1 : 0.5);
    const pg = new THREE.PlaneGeometry(sz, sz * 0.8).rotateX(-PI / 2).translate(0, 0.06, depth - 0.05);
    const pl = new THREE.Mesh(W ? warpGeometry(pg, W) : pg, pools.warm); pl.renderOrder = 3; g.add(pl);
  }
  if (type === 'magetower' && pools) { const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6).rotateX(-PI / 2), pools.violet); pl.position.y = 0.09; pl.renderOrder = 3; g.add(pl); }
  g.userData.kit = K;
  return g;
}

// 給「任意形狀房子」共用的立面零件
export function setBuildRng(r) { R = r; }
export { win, door, lantern, timber, balcony, flowerBox, hangingSign, urn, flag, chimney, spire, shade, fountain, statue, topiary, barrel, bench };
