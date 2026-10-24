// 有機網格（Townscaper 作法）：六角範圍的大三角網 → 隨機兩兩合成四邊形 → 每塊細分成小四邊形 → 鬆弛 → 再對半細分幾次
// 全部都是四邊形；不規則的地方只在「3 格或 5 格交會的點」，細分越多層，這種點越稀疏，大片區域排得整整齊齊
import { makeRng } from './util.js';

const ek = (a, b) => (a < b ? a * 100000 + b : b * 100000 + a);

export function makeGrid(seed, { H = 3, s = 7.6, levels = 3, pQuad = 0.97, keep = 14 } = {}) {
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

  // 1) 三角兩兩合成四邊形
  {
    const owner = new Map(), alive = polys.map(() => true);
    polys.forEach((p, pi) => { for (let k = 0; k < 3; k++) { const e = ek(p[k], p[(k + 1) % 3]); if (!owner.has(e)) owner.set(e, []); owner.get(e).push(pi); } });
    for (const t of shuffle(polys.map((_, i) => i))) {
      if (!alive[t] || polys[t].length !== 3 || r() > pQuad) continue;
      const p = polys[t], ns = [];
      for (let k = 0; k < 3; k++) { const a = p[k], b = p[(k + 1) % 3]; for (const o of owner.get(ek(a, b))) if (o !== t && alive[o] && polys[o].length === 3) ns.push([o, a, b]); }
      if (!ns.length) continue;
      const [o, a, b] = ns[Math.floor(r() * ns.length)];
      const ib = p.indexOf(b), op = polys[o], ia = op.indexOf(a);
      const p1 = [0, 1, 2].map((k) => p[(ib + k) % 3]), p2 = [0, 1, 2].map((k) => op[(ia + k) % 3]);
      polys[t] = p1.concat(p2.slice(1, -1)); alive[o] = false;
    }
    polys = polys.filter((_, i) => alive[i]);
  }
  // 細分：n 邊形 → n 個小四邊形（角點、兩條邊的中點、中心）；邊界上的中點固定不動
  function subdivide() {
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
  // 鬆弛：每格往「同樣大小的正方形」靠（Townscaper 的格子大小幾乎一致）
  const relax = (iters, w, size) => {
    const fx = new Float64Array(X.length), fz = new Float64Array(X.length), cnt = new Float64Array(X.length);
    const R = size / Math.SQRT2;
    for (let it = 0; it < iters; it++) {
      fx.fill(0); fz.fill(0); cnt.fill(0);
      for (const p of polys) {
        const n = p.length; let cx = 0, cz = 0;
        for (const v of p) { cx += X[v]; cz += Z[v]; }
        cx /= n; cz /= n;
        let dx = 0, dz = 0;
        for (let k = 0; k < n; k++) { const a = -k * 2 * Math.PI / n, vx = X[p[k]] - cx, vz = Z[p[k]] - cz; dx += vx * Math.cos(a) - vz * Math.sin(a); dz += vx * Math.sin(a) + vz * Math.cos(a); }
        dx /= n; dz /= n;
        const L = Math.hypot(dx, dz) || 1, f = 1 + ((R / L) - 1) * 0.5; dx *= f; dz *= f;
        for (let k = 0; k < n; k++) { const a = k * 2 * Math.PI / n; fx[p[k]] += cx + dx * Math.cos(a) - dz * Math.sin(a) - X[p[k]]; fz[p[k]] += cz + dx * Math.sin(a) + dz * Math.cos(a) - Z[p[k]]; cnt[p[k]]++; }
      }
      for (let i = 0; i < X.length; i++) if (!fixed[i] && cnt[i]) { X[i] += fx[i] / cnt[i] * w; Z[i] += fz[i] / cnt[i] * w; }
    }
  };
  subdivide();
  relax(60, 0.6, s / 2);
  for (let l = 1; l < levels; l++) { subdivide(); relax(40, 0.6, s / 2 ** (l + 1)); }

  // 只留中央一圈（外緣像 Townscaper 一樣是鋸齒邊，外面由地形與森林接手）
  polys = polys.filter((p) => { let cx = 0, cz = 0; for (const v of p) { cx += X[v]; cz += Z[v]; } return Math.hypot(cx / p.length, cz / p.length) < keep; });
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
  const cs = s / 2 ** levels;
  return { X, Z, cells, around, s: cs, H: Math.round(keep / cs) };
}

export function quadFrame(G, c, k) {
  const v = c.v, n = v.length;
  return { fl: v[(k + 1) % n], fr: v[k], br: v[(k + n - 1) % n], bl: v[(k + 2) % n] };
}
