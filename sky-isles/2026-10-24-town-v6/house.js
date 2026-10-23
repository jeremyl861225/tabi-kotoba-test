// 任意形狀的房子：照格子外形（三角、四邊、五邊形，或幾格合併）長出牆面；
// 每面外牆依長度排窗、門、店面；屋頂依形狀與風格選人字、四坡、孟莎或尖頂；風格隨機組合
import * as THREE from 'three';
import { P, bx, M, merge, newKit, grp, applyAO, meshOf } from './kit.js';
import { makeRng, lerp, clamp, PI, TAU } from './util.js';
import { win, door, lantern, timber, balcony, flowerBox, hangingSign, flag, chimney, spire, setBuildRng, shade } from './buildings.js';

const WALL = ['#e8644f', '#f09a4a', '#f3cd58', '#7cc4a3', '#5ea8d4', '#f1a2b4', '#f4f0e7', '#a98fd6', '#e9dab9', '#4fa0a0', '#f6e3a1', '#d97b5f', '#88b9d9', '#f6efe2', '#c7d97c'];
const TRIM = ['#f7f2e8', '#efe6d2', '#fbf6ec'];
const TILE = ['#b9503a', '#a9483a', '#c8603f', '#9a4433', '#c46a46'];
const SLATE = ['#5f6b7c', '#56606e', '#6b7a8f', '#4f5a6a'];
const SHUT = ['#5f8f6a', '#4f7fa3', '#a8483a', '#3f6b5a', '#7a5a8a', '#2f5d7c', '#c08a3a', '#e8e2d4'];
const DOORC = ['#6e4630', '#5a3a28', '#3f5a6e', '#6b2f2a', '#3d5a40', '#7a5a8a'];
const STONE = ['#cfc3ad', '#c2b59d', '#d8cfbd'];
const BRICK = ['#b5604a', '#a65542', '#c06e52'];
export const TIER_NAME = ['', '小屋', '農舍', '民宅', '聯排樓', '宅邸', '大宅', '莊園', '宮殿'];

// ---------------------------------------------------------------- 多邊形小工具（數學座標：逆時針為正）
const outN = (a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l]; };
export function offsetPoly(p, d) {
  const n = p.length, out = [];
  for (let k = 0; k < n; k++) {
    const a = p[(k + n - 1) % n], b = p[k], c = p[(k + 1) % n];
    const n1 = outN(a, b), n2 = outN(b, c), dd = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const sc = d / Math.max(0.35, dd);
    out.push([b[0] + (n1[0] + n2[0]) * sc, b[1] + (n1[1] + n2[1]) * sc]);
  }
  return out;
}
const centroid = (p) => { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; };
function inradius(p) {
  const c = centroid(p); let m = Infinity;
  for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length], dx = b[0] - a[0], dz = b[1] - a[1]; m = Math.min(m, Math.abs((c[0] - a[0]) * dz - (c[1] - a[1]) * dx) / Math.hypot(dx, dz)); }
  return m;
}
function prism(K, p, y0, y1, color, surf = 0, glow = false) {
  if (y1 - y0 < 0.002) return;
  const shape = new THREE.Shape(p.map((q) => new THREE.Vector2(q[0], -q[1])));
  const g = new THREE.ExtrudeGeometry(shape, { depth: y1 - y0, bevelEnabled: false }).rotateX(-PI / 2).translate(0, y0, 0);
  (glow ? K.glow : K.body).push(P(g, color, { surf }));
}
function tris(pts, color, surf = 0) { // 多個三角形 → 一個零件
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.computeVertexNormals();
  return P(g, color, { surf });
}
function beam(K, a, b, t, color) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length();
  const g = new THREE.BoxGeometry(t, t, len);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  K.body.push(P(g, color));
}

// ---------------------------------------------------------------- 風格
function makeStyle(r, tier, ncell, kind) {
  const s = { kind };
  s.wall = r.pick(WALL); s.trim = r.pick(TRIM); s.door = r.pick(DOORC);
  s.mat = r.pick(tier <= 2 ? ['stucco', 'stucco', 'stucco', 'timber'] : ['stucco', 'stucco', 'stucco', 'stucco', 'timber', 'timber', 'brick', 'stone']);
  s.ground = s.mat === 'timber' ? r.pick(['stone', 'stucco']) : (tier >= 4 && r() < 0.3 ? 'stone' : s.mat);
  s.floors = [1, 1, 2, 2, 3, 3, 3, 4, 4][tier] + (tier >= 3 && tier <= 5 && r() < 0.3 ? 1 : 0);
  s.g = 0.32; s.fh = 0.27;
  const thatch = tier <= 2 && r() < 0.55;
  const slate = !thatch && r() < 0.28;
  s.roofColor = thatch ? r.pick(['#c99f55', '#d4ae66']) : slate ? r.pick(SLATE) : r.pick(TILE);
  s.roofSurf = thatch ? 2 : slate ? 5 : 1;
  s.roof = r.pick(tier >= 4 ? ['gable', 'gable', 'hip', 'mansard'] : ['gable', 'gable', 'hip']);
  s.steep = 0.8 + r() * 0.5;
  s.shutter = r() < 0.65 ? r.pick(SHUT) : null;
  s.boxes = r() < 0.55; s.balcony = tier >= 4 && r() < 0.55; s.dormer = tier >= 2 && r() < 0.7;
  s.shop = tier >= 3 && r() < 0.28; s.ivy = r() < 0.22; s.arch = s.ground === 'stone' && r() < 0.6;
  s.tower = (tier === 5 && r() < 0.3) || ncell >= 3; s.chimneys = tier <= 1 ? 1 : 1 + (r() < 0.5 ? 1 : 0);
  s.timberC = r.pick(['#5b3e2c', '#4b3428', '#664632']);
  s.stone = r.pick(STONE); s.brick = r.pick(BRICK);
  if (tier >= 6) { s.trim = '#f7f1e3'; s.gold = true; s.balcony = true; s.roof = r.pick(['mansard', 'hip', 'gable']); s.roofColor = r.pick(['#6b7a8f', '#5f9a8c', '#b9503a', '#7a8796']); s.roofSurf = s.roofColor === '#b9503a' ? 1 : 5; s.mat = r.pick(['stucco', 'stucco', 'stone']); s.wall = r.pick(['#f4f0e7', '#f3cd58', '#f1a2b4', '#88b9d9', '#e9dab9', '#7cc4a3']); s.ground = 'stone'; s.arch = true; s.dormer = true; }
  if (kind === 'church') Object.assign(s, { mat: 'stone', ground: 'stone', floors: 3, roof: 'gable', roofColor: r.pick(SLATE), roofSurf: 5, steep: 1.5, shutter: null, boxes: false, balcony: false, dormer: false, shop: false, arch: true, tower: true, chimneys: 0, wall: '#ddd3c1' });
  if (kind === 'tavern' || kind === 'apothecary' || kind === 'bakery') { s.shop = true; s.floors = Math.max(s.floors, 2); }
  return s;
}

// ---------------------------------------------------------------- 主體
// polys：每格的多邊形（世界座標 [x,z]，逆時針）；outer：外牆邊 {a,b,street,nbH}；anchor：群組原點
export function buildHouse({ polys, outer, anchor, baseY, hmin, tier, seed, kind = 'house' }) {
  const r = makeRng(seed); setBuildRng(r);
  const st = makeStyle(r, tier, polys.length, kind);
  const K = newKit();
  const L = (q) => [q[0] - anchor[0], q[1] - anchor[1]];
  const lp = polys.map((p) => p.map(L));
  const H = st.floors === 1 ? st.g + 0.04 : st.g + (st.floors - 1) * st.fh;
  const foot = -(baseY - hmin) - 0.14;
  const wallC = st.mat === 'brick' ? st.brick : st.mat === 'stone' ? st.stone : st.wall;
  const wallS = st.mat === 'brick' ? 3 : st.mat === 'stone' ? 4 : 2;
  const gC = st.ground === 'stone' ? st.stone : st.ground === 'brick' ? st.brick : wallC;
  const gS = st.ground === 'stone' ? 4 : st.ground === 'brick' ? 3 : wallS;
  for (const p of lp) {
    prism(K, p, foot, 0.05, shade(st.stone, 0.85), 4);
    prism(K, p, 0.05, st.floors === 1 ? H : st.g, gC, gS);
    if (st.floors > 1) prism(K, p, st.g, H, wallC, wallS);
    prism(K, offsetPoly(p, 0.022), st.g - 0.014, st.g + 0.014, st.trim);
    for (let f = 2; f < st.floors; f++) prism(K, offsetPoly(p, 0.012), st.g + (f - 1) * st.fh - 0.008, st.g + (f - 1) * st.fh + 0.008, st.trim);
    prism(K, offsetPoly(p, 0.04), H - 0.03, H + 0.012, st.trim);
    if (st.gold) prism(K, offsetPoly(p, 0.042), H + 0.012, H + 0.02, '#e8c065');
  }
  // 轉角壁柱
  if (tier >= 3 || st.mat === 'stone') for (const e of outer) {
    const a = L(e.a);
    K.body.push(P(bx(0.05, H - 0.05, 0.05), st.mat === 'brick' ? '#efe7d6' : shade(st.trim, 0.97), { x: a[0], y: (H + 0.05) / 2, z: a[1] }));
  }
  // 立面
  const streets = outer.filter((e) => e.street);
  const lenOf = (e) => Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
  const main = (streets.length ? streets : outer).slice().sort((a, b) => lenOf(b) - lenOf(a))[0];
  for (const e of outer) facade(e, e === main);
  function facade(e, isMain) {
    const a = L(e.a), b = L(e.b), dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 0.2) return;
    const nx = dz / len, nz = -dx / len, ry = Math.atan2(nx, nz);
    const covered = e.nbH ? e.nbH - baseY : -9;
    grp(K, (a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, ry, () => {
      const usable = len - 0.1, bays = Math.max(1, Math.floor(usable / 0.27)), bw = usable / bays;
      const xs = []; for (let k = 0; k < bays; k++) xs.push(-usable / 2 + (k + 0.5) * bw);
      const wW = Math.min(0.11, bw * 0.48);
      if (covered < st.g - 0.05) {
        if (isMain) {
          const dk = Math.floor(bays / 2);
          xs.forEach((x, k) => {
            if (k === dk) {
              door(K, x, 0.05, { w: Math.min(0.14, bw * 0.62), h: kind === 'church' ? 0.3 : 0.23, color: st.door, arch: st.arch || kind === 'church', fan: tier >= 4 });
              if (r() < 0.8 && bays > 1) lantern(K, x + Math.min(0.14, bw * 0.62) / 2 + 0.05, 0.28);
              if (r() < 0.5) for (const sd of [-1, 1]) { K.body.push(P(new THREE.CylinderGeometry(0.03, 0.022, 0.05, 8), '#b8673f', { x: x + sd * 0.12, y: 0.075, z: 0.05 })); K.body.push(P(new THREE.IcosahedronGeometry(0.04, 1), ['#4e8f45', '#86c46a'], { x: x + sd * 0.12, y: 0.12, z: 0.05 })); }
            } else if (st.shop) {
              K.body.push(P(bx(bw * 0.84, 0.17, 0.02), '#f1ece0', { x, y: 0.18, z: 0.006 }));
              K.glow.push(P(bx(bw * 0.76, 0.15, 0.02), '#fff', { x, y: 0.18, z: 0.012 }));
              K.body.push(P(bx(0.01, 0.15, 0.024), '#f1ece0', { x, y: 0.18, z: 0.016 }));
            } else win(K, x, 0.19, { w: wW, h: 0.12, arch: st.arch, sh: st.arch ? null : st.shutter });
          });
          if (st.shop) {
            const aw = r.pick([['#c0392b', '#fff3e0'], ['#2e5c8a', '#fff3e0'], ['#3d6b4a', '#f5ecd6'], ['#d9822b', '#fff3e0']]);
            const n = Math.max(4, Math.round(usable / 0.06));
            for (let k = 0; k < n; k++) K.body.push(P(bx(usable / n, 0.012, 0.13), aw[k % 2], { x: -usable / 2 + (k + 0.5) * usable / n, y: 0.3, z: 0.06, rx: 0.42 }));
            hangingSign(K, usable / 2 - 0.02, 0.36, r.pick(['#7a2f2a', '#2f4f6e', '#3d5a40', '#8a5a2c']), '#e8c065');
          }
        } else xs.forEach((x) => win(K, x, 0.19, { w: wW * 0.9, h: 0.11, arch: st.arch }));
      }
      for (let f = 1; f < st.floors; f++) {
        const y0 = st.g + (f - 1) * st.fh;
        if (y0 + st.fh <= covered + 0.03) continue;
        let wx = xs;
        if (st.mat === 'timber') wx = timber(K, len - 0.03, y0 + 0.012, st.fh - 0.024, { color: st.timberC, bays, brace: true, mid: false });
        const big = kind === 'church';
        wx.forEach((x) => win(K, x, y0 + st.fh * 0.52, { w: big ? wW * 0.8 : wW, h: big ? st.fh * 0.7 : st.fh * 0.46, sh: st.shutter, fb: f === 1 && st.boxes && !big, cap: tier >= 4 && f === 1, arch: big || (st.gold && f === 1) }));
        if (f === 1 && st.balcony && isMain && len > 0.45) balcony(K, Math.min(usable * 0.7, 0.6), y0 + 0.012);
      }
      if (st.ivy && !isMain) for (let k = 0; k < 7; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.05 + r() * 0.04, 1), ['#3f7a3e', '#6aa552'], { x: (r() - 0.5) * len * 0.8, y: r() * H * 0.85, z: 0.015, sz: 0.35 }));
    });
  }
  // 屋頂（每格一個）
  lp.forEach((p, i) => roof(p, H, i === 0));
  function roof(p, y, first) {
    const n = p.length, ov = 0.07, E = offsetPoly(p, ov), c = centroid(p);
    const rh = clamp(inradius(p) * 0.95 * st.steep, 0.18, kind === 'church' ? 0.7 : 0.52);
    const ye = y + 0.008;
    const pts = [], under = [];
    let dormerSpots = [];
    const yE = ye - ov * (rh / Math.max(0.2, inradius(p))) * 0.5;
    if (st.roof === 'gable' && n === 4) {
      const len = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
      const sh = len(p[0], p[1]) + len(p[2], p[3]) <= len(p[1], p[2]) + len(p[3], p[0]) ? 0 : 1;
      const v = (k) => (k + sh) % 4;
      const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const R0 = mid(E[v(0)], E[v(1)]), R1 = mid(E[v(2)], E[v(3)]);
      const yr = ye + rh;
      // 兩個坡面
      const quad = (A, B, C, D) => { pts.push(B[0], yE, B[1], A[0], yE, A[1], D[0], yr, D[1], B[0], yE, B[1], D[0], yr, D[1], C[0], yr, C[1]); };
      quad(E[v(1)], E[v(2)], R1, R0);
      quad(E[v(3)], E[v(0)], R0, R1);
      dormerSpots = [[E[v(1)], E[v(2)], R0, R1], [E[v(3)], E[v(0)], R1, R0]];
      // 山牆（在牆面上）
      for (const [a, b] of [[p[v(0)], p[v(1)]], [p[v(2)], p[v(3)]]]) {
        const m = mid(a, b);
        K.body.push(tris([b[0], y, b[1], a[0], y, a[1], m[0], yr - 0.02, m[1]], st.mat === 'timber' || st.floors === 1 ? st.wall : wallC, st.mat === 'timber' || st.floors === 1 ? 2 : wallS));
        if (tier >= 3 && rh > 0.22) { const on = outN(a, b); grp(K, m[0] + on[0] * 0.001, 0, m[1] + on[1] * 0.001, Math.atan2(on[0], on[1]), () => win(K, 0, y + rh * 0.38, { w: 0.07, h: 0.08, arch: true })); }
      }
      beam(K, [R0[0], yr + 0.02, R0[1]], [R1[0], yr + 0.02, R1[1]], 0.045, shade(st.roofColor, 0.72));
    } else if (st.roof === 'mansard' && n >= 4) {
      const I = offsetPoly(p, -Math.min(0.1, inradius(p) * 0.35)), y1 = ye + rh * 0.72, yt = ye + rh * 0.95;
      for (let k = 0; k < n; k++) {
        const a = E[k], b = E[(k + 1) % n], ia = I[k], ib = I[(k + 1) % n];
        pts.push(b[0], yE, b[1], a[0], yE, a[1], ia[0], y1, ia[1], b[0], yE, b[1], ia[0], y1, ia[1], ib[0], y1, ib[1]);
        const ci = centroid(I);
        pts.push(ib[0], y1, ib[1], ia[0], y1, ia[1], ci[0], yt, ci[1]);
        dormerSpots.push([a, b, ia, ib]);
      }
      prism(K, offsetPoly(I, 0.012), y1 - 0.012, y1 + 0.006, st.gold ? '#e8c065' : st.trim);
    } else {
      const yr = ye + rh;
      for (let k = 0; k < n; k++) {
        const a = E[k], b = E[(k + 1) % n];
        pts.push(b[0], yE, b[1], a[0], yE, a[1], c[0], yr, c[1]);
        beam(K, [a[0], yE + 0.02, a[1]], [c[0], yr + 0.02, c[1]], 0.035, shade(st.roofColor, 0.72));
        dormerSpots.push([a, b, c, c]);
      }
    }
    K.body.push(tris(pts, [shade(st.roofColor, 0.88), st.roofColor], st.roofSurf));
    // 屋簷底與封簷板
    for (let k = 0; k < n; k++) { const a = E[k], b = E[(k + 1) % n]; under.push(a[0], yE - 0.025, a[1], b[0], yE - 0.025, b[1], c[0], y - 0.01, c[1]); beam(K, [a[0], yE - 0.012, a[1]], [b[0], yE - 0.012, b[1]], 0.03, shade(st.roofColor, 0.62)); }
    K.body.push(tris(under, shade(st.trim, 0.7)));
    // 老虎窗：面向主街的坡面
    if (st.dormer && dormerSpots.length && rh > 0.2) {
      let best = null, bd = -Infinity;
      const mOut = main ? (() => { const a = L(main.a), b = L(main.b); return outN(a, b); })() : [0, 1];
      for (const sp of dormerSpots) { const on = outN(sp[0], sp[1]); const d = on[0] * mOut[0] + on[1] * mOut[1] + Math.hypot(sp[1][0] - sp[0][0], sp[1][1] - sp[0][1]) * 0.3; if (d > bd) { bd = d; best = sp; } }
      const [a, b, ra, rb] = best, on = outN(a, b);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.42) {
        const em = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], rm = [(ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2], t = 0.36;
        const px = lerp(em[0], rm[0], t), pz = lerp(em[1], rm[1], t), py = lerp(yE, ye + rh * (st.roof === 'mansard' ? 0.72 : 1), t);
        grp(K, px, 0, pz, Math.atan2(on[0], on[1]), () => {
          K.body.push(P(bx(0.17, 0.16, 0.24), st.mat === 'brick' ? st.brick : st.wall, { y: py + 0.06, z: -0.1, surf: st.mat === 'brick' ? 3 : 2 }));
          win(K, 0, py + 0.07, { w: 0.08, h: 0.08 });
          for (const sd of [-1, 1]) K.body.push(P(bx(0.13, 0.02, 0.28), st.roofColor, { x: sd * 0.05, y: py + 0.17, z: -0.1, rz: sd * -0.6, surf: st.roofSurf }));
        });
      }
    }
    // 煙囪
    if (first) for (let k = 0; k < st.chimneys; k++) {
      const q = p[Math.floor(r() * n)], cx = lerp(c[0], q[0], 0.45), cz = lerp(c[1], q[1], 0.45);
      chimney(K, cx, y + rh * 0.3, cz, rh * 0.55 + 0.18, st.mat === 'stone' ? '#9c917f' : '#a8644a');
    }
  }
  // 塔樓
  if (st.tower) {
    const order = lp.map((p, i) => [i, outer.filter((e) => e.cell === i && e.street).length]).sort((a, b) => b[1] - a[1]);
    const towers = kind === 'church' || tier >= 8 ? Math.min(2, lp.length) : 1;
    for (let t = 0; t < towers; t++) {
      const p = lp[order[t][0]], I = offsetPoly(p, -Math.min(0.13, inradius(p) * 0.3)), c = centroid(I);
      const th = kind === 'church' ? 0.95 : 0.5 + (tier >= 7 ? 0.25 : 0);
      prism(K, I, H - 0.02, H + th, wallC, wallS);
      prism(K, offsetPoly(I, 0.02), H + th - 0.02, H + th + 0.02, st.trim);
      for (let k = 0; k < I.length; k++) {
        const a = I[k], b = I[(k + 1) % I.length], on = outN(a, b);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.16) continue;
        grp(K, (a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, Math.atan2(on[0], on[1]), () => {
          if (kind === 'church') { K.body.push(P(bx(0.08, 0.16, 0.02), '#2b2730', { y: H + th - 0.14, z: 0.006 })); }
          else win(K, 0, H + th * 0.5, { w: 0.07, h: 0.11, arch: true });
        });
      }
      if (kind === 'church') { const a = I[0], b = I[1], on = outN(a, b); grp(K, (a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2, Math.atan2(on[0], on[1]), () => { K.glow.push(P(new THREE.CylinderGeometry(0.06, 0.06, 0.02, 16), '#fff', { y: H + th * 0.45, z: 0.01, rx: PI / 2 })); }); }
      const sr = inradius(I) * 1.25, sh = kind === 'church' ? 1.0 : 0.55 + (tier >= 7 ? 0.2 : 0);
      const pts = [];
      const E2 = offsetPoly(I, 0.05);
      for (let k = 0; k < E2.length; k++) { const a = E2[k], b = E2[(k + 1) % E2.length]; pts.push(b[0], H + th + 0.02, b[1], a[0], H + th + 0.02, a[1], c[0], H + th + sh, c[1]); }
      const spC = kind === 'church' ? '#556274' : r.pick(['#5f9a8c', '#4a5462', '#9a4433']);
      K.body.push(tris(pts, [shade(spC, 0.85), spC], 5));
      K.body.push(P(new THREE.SphereGeometry(0.025, 8, 6), '#e8c065', { x: c[0], y: H + th + sh + 0.02, z: c[1] }));
      if (kind === 'church') { K.body.push(P(bx(0.012, 0.12, 0.012), '#e8c065', { x: c[0], y: H + th + sh + 0.08, z: c[1] })); K.body.push(P(bx(0.06, 0.012, 0.012), '#e8c065', { x: c[0], y: H + th + sh + 0.1, z: c[1] })); }
      else if (r() < 0.6) flag(K, c[0], H + th + sh - 0.02, c[1], r.pick([0xc0392b, 0x2e5c8a, 0xe8c065, 0x3d6b4a]), 0.22);
      if (tier >= 8 && t === 0) {
        const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.08, 0), M.crystal);
        cr.scale.set(1, 1.6, 1); cr.position.set(c[0], H + th + sh + 0.45, c[1]);
        K.extra.push(cr); K.spin.push({ obj: cr, y0: cr.position.y, bob: 0.05, rot: 0.9 });
      }
    }
  }
  if (kind === 'bakery') chimney(K, lp[0][0][0] * 0.4, H, lp[0][0][1] * 0.4, 0.5, '#a8644a');

  const g = new THREE.Group();
  const geo = merge(K.body); applyAO(geo, 0);
  const m = new THREE.Mesh(geo, M.std); m.castShadow = true; m.receiveShadow = true; g.add(m);
  if (K.glow.length) g.add(meshOf(K.glow, M.win, { cast: false }));
  for (const e of K.extra) { e.traverse((o) => { if (o.isMesh) { o.castShadow = true; } }); g.add(e); }
  g.userData.kit = K;
  g.userData.H = H + (st.tower ? 0.6 : 0.3);
  return g;
}
