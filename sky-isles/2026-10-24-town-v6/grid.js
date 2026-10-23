// 有機網格（Townscaper 作法）：六角範圍的三角網 → 隨機兩兩合成四邊形 → 每塊細分成小四邊形 → 鬆弛
// 細分後大部分格子排成順暢的長列（路可以拉直）；再零星切出三角形、併成五邊形，保留不規則的趣味
import { makeRng } from './util.js';

const ek = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

export function makeGrid(seed, { H = 7, s = 1.95, pQuad = 0.92, pSplit = 0.06, pPent = 0.75 } = {}) {
  const r = makeRng(seed ^ 0x2545f491);
  const X = [], Z = [], fixed = [];
  const addV = (x, z, f) => { X.push(x); Z.push(z); fixed.push(f); return X.length - 1; };
  const id = new Map(), key = (q, w) => q * 1000 + w;
  for (let q = -H; q <= H; q++) for (let w = -H; w <= H; w++) {
    if (Math.abs(q + w) > H) continue;
    id.set(key(q, w), addV(s * (q + w / 2), s * (w * Math.sqrt(3) / 2), Math.max(Math.abs(q), Math.abs(w), Math.abs(q + w)) === H));
  }
  const area = (p) => { let a = 0; for (let k = 0; k < p.length; k++) { const i = p[k], j = p[(k + 1) % p.length]; a += X[i] * Z[j] - X[j] * Z[i]; } return a / 2; };
  let polys = [];
  for (let q = -H; q <= H; q++) for (let w = -H; w <= H; w++) {
    const a = id.get(key(q, w)), b = id.get(key(q + 1, w)), c = id.get(key(q, w + 1)), d = id.get(key(q + 1, w + 1));
    for (const t of [[a, b, c], [b, d, c]]) { if (t.some((v) => v === undefined)) continue; polys.push(area(t) > 0 ? t : t.reverse()); }
  }
  const shuffle = (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; };

  // 多邊形集合的合併工具
  function mesh(list) {
    const owner = new Map(), alive = list.map(() => true);
    const addE = (pi) => { const p = list[pi]; for (let k = 0; k < p.length; k++) { const e = ek(p[k], p[(k + 1) % p.length]); if (!owner.has(e)) owner.set(e, new Set()); owner.get(e).add(pi); } };
    const delE = (pi) => { const p = list[pi]; for (let k = 0; k < p.length; k++) owner.get(ek(p[k], p[(k + 1) % p.length]))?.delete(pi); };
    list.forEach((_, i) => addE(i));
    const nbs = (pi) => { const out = []; const p = list[pi]; for (let k = 0; k < p.length; k++) { const a = p[k], b = p[(k + 1) % p.length]; for (const o of owner.get(ek(a, b))) if (o !== pi) out.push([o, a, b]); } return out; };
    function merge(pi, oi, a, b) {
      const p = list[pi], o = list[oi];
      const ib = p.indexOf(b), p1 = []; for (let k = 0; k < p.length; k++) p1.push(p[(ib + k) % p.length]);
      const ia = o.indexOf(a), p2 = []; for (let k = 0; k < o.length; k++) p2.push(o[(ia + k) % o.length]);
      delE(pi); delE(oi); list[pi] = p1.concat(p2.slice(1, -1)); alive[oi] = false; addE(pi);
    }
    const isBorder = (pi) => { const p = list[pi]; for (let k = 0; k < p.length; k++) if (owner.get(ek(p[k], p[(k + 1) % p.length])).size < 2) return true; return false; };
    return { nbs, merge, alive, isBorder, done: () => list.filter((_, i) => alive[i]) };
  }
  // 1) 三角兩兩合成四邊形
  {
    const m = mesh(polys);
    for (const t of shuffle(polys.map((_, i) => i))) {
      if (!m.alive[t] || polys[t].length !== 3 || r() > pQuad) continue;
      const ns = m.nbs(t).filter(([o]) => m.alive[o] && polys[o].length === 3);
      if (!ns.length) continue;
      const [o, a, b] = ns[Math.floor(r() * ns.length)];
      m.merge(t, o, a, b);
    }
    polys = m.done();
  }
  // 2) 細分：每個 n 邊形 → n 個小四邊形（角點、兩條邊的中點、中心）
  {
    const mid = new Map(), owners = new Map();
    for (const p of polys) for (let k = 0; k < p.length; k++) { const e = ek(p[k], p[(k + 1) % p.length]); owners.set(e, (owners.get(e) || 0) + 1); }
    const midOf = (a, b) => { const e = ek(a, b); if (!mid.has(e)) mid.set(e, addV((X[a] + X[b]) / 2, (Z[a] + Z[b]) / 2, owners.get(e) < 2)); return mid.get(e); };
    const out = [];
    for (const p of polys) {
      const n = p.length; let cx = 0, cz = 0; for (const v of p) { cx += X[v]; cz += Z[v]; }
      const c = addV(cx / n, cz / n, false);
      for (let k = 0; k < n; k++) out.push([p[k], midOf(p[k], p[(k + 1) % n]), c, midOf(p[(k + n - 1) % n], p[k])]);
    }
    polys = out;
  }
  const relax = (iters, w) => {
    const fx = new Float64Array(X.length), fz = new Float64Array(X.length), cnt = new Float64Array(X.length);
    for (let it = 0; it < iters; it++) {
      fx.fill(0); fz.fill(0); cnt.fill(0);
      for (const p of polys) {
        const n = p.length; let cx = 0, cz = 0;
        for (const v of p) { cx += X[v]; cz += Z[v]; }
        cx /= n; cz /= n;
        let dx = 0, dz = 0;
        for (let k = 0; k < n; k++) { const a = -k * 2 * Math.PI / n, vx = X[p[k]] - cx, vz = Z[p[k]] - cz; dx += vx * Math.cos(a) - vz * Math.sin(a); dz += vx * Math.sin(a) + vz * Math.cos(a); }
        dx /= n; dz /= n;
        for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n; fx[p[k]] += cx + dx * Math.cos(a) - dz * Math.sin(a) - X[p[k]]; fz[p[k]] += cz + dx * Math.sin(a) + dz * Math.cos(a) - Z[p[k]]; cnt[p[k]]++; }
      }
      for (let i = 0; i < X.length; i++) if (!fixed[i] && cnt[i]) { X[i] += fx[i] / cnt[i] * w; Z[i] += fz[i] / cnt[i] * w; }
    }
  };
  relax(70, 0.6);
  // 3) 零星切出三角形、再併進鄰格成五邊形
  {
    const m = mesh(polys);
    for (const t of shuffle(polys.map((_, i) => i))) {
      if (!m.alive[t] || polys[t].length !== 4 || m.isBorder(t) || r() > pSplit) continue;
      const [a, b, c, d] = polys[t];
      polys[t] = [a, b, c]; polys.push([a, c, d]);
    }
    const m2 = mesh(polys);
    const tris = polys.map((_, i) => i).filter((i) => polys[i].length === 3);
    for (const t of shuffle(tris)) {
      if (!m2.alive[t] || polys[t].length !== 3 || r() > pPent) continue;
      const ns = m2.nbs(t).filter(([o]) => m2.alive[o] && polys[o].length === 4);
      if (!ns.length) continue;
      const [o, a, b] = ns[Math.floor(r() * ns.length)];
      m2.merge(t, o, a, b);
    }
    polys = m2.done();
  }
  relax(40, 0.5);

  // 整理成格子
  const edgeCells = new Map();
  polys.forEach((p, ci) => { for (let k = 0; k < p.length; k++) { const e = ek(p[k], p[(k + 1) % p.length]); if (!edgeCells.has(e)) edgeCells.set(e, []); edgeCells.get(e).push(ci); } });
  const cells = polys.map((p, ci) => {
    let cx = 0, cz = 0; for (const v of p) { cx += X[v]; cz += Z[v]; }
    cx /= p.length; cz /= p.length;
    const edges = p.map((a, k) => { const b = p[(k + 1) % p.length]; const o = edgeCells.get(ek(a, b)).find((c) => c !== ci); return { a, b, nb: o === undefined ? -1 : o }; });
    return { id: ci, v: p, n: p.length, x: cx, z: cz, edges, nb: edges.filter((e) => e.nb >= 0).map((e) => e.nb), border: edges.some((e) => e.nb < 0) };
  });
  const around = Array.from({ length: X.length }, () => []);
  cells.forEach((c) => c.v.forEach((v) => around[v].push(c.id)));
  return { X, Z, cells, around, s: s / 2, H: H * 2 };
}

export function quadFrame(G, c, k) {
  const v = c.v, n = v.length;
  return { fl: v[(k + 1) % n], fr: v[k], br: v[(k + n - 1) % n], bl: v[(k + 2) % n] };
}
