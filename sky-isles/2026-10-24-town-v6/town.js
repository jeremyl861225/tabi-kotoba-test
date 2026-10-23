// 小鎮（有機網格版）：分類格子、廣場、街道、橋址、公共建築、房屋分級與合併、農田、後院、樹；以及路面、橋、地基等網格
import * as THREE from 'three';
import { makeRng, clamp, lerp, smooth, PI, TAU, fbm, hash2 } from './util.js';
import { P, bx, rbx, M, merge } from './kit.js';
import { quadFrame } from './grid.js';
import { makeWarp, makeSimWarp, warpGeometry } from './warp.js';

export const U = { EMPTY: 0, ROAD: 1, PLAZA: 2, BUILD: 3, FIELD: 4, YARD: 5, SITE: 6 };
export const KD = { LAND: 0, RIVER: 1, SEA: 2, STEEP: 3 };

export function classify(G, L) {
  for (const c of G.cells) {
    const hs = c.v.map((v) => L.h(G.X[v], G.Z[v])), hc = L.h(c.x, c.z);
    c.hmin = Math.min(hc, ...hs); c.hmax = Math.max(hc, ...hs);
    const R = L.riverAt(c.x, c.z, 3);
    const wet = c.v.filter((v) => { const q = L.riverAt(G.X[v], G.Z[v], 3); return q && q.d < q.w * 0.8; }).length;
    if (R && (R.d < R.w || wet >= 2)) { c.kind = KD.RIVER; c.ws = R.s; }
    else if (hc < 0.05 || c.hmin < -0.04) c.kind = KD.SEA;
    else if (c.hmax - c.hmin > 0.75) c.kind = KD.STEEP;
    else c.kind = KD.LAND;
    c.y = c.hmax + 0.03;
    let rin = Infinity;
    for (const e of c.edges) {
      const ax = G.X[e.a], az = G.Z[e.a], bx2 = G.X[e.b], bz = G.Z[e.b];
      const dx = bx2 - ax, dz = bz - az, l = Math.hypot(dx, dz);
      rin = Math.min(rin, Math.abs((c.x - ax) * dz - (c.z - az) * dx) / l);
    }
    c.rin = rin;
  }
}

export function makeTopo(G) {
  const cells = G.cells;
  function across(c, a, b) { for (const e of c.edges) if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.nb >= 0 ? cells[e.nb] : null; return null; }
  function findEdge(c, a, b) { for (let k = 0; k < c.n; k++) if (c.v[k] === a && c.v[(k + 1) % c.n] === b) return k; return -1; }
  const F = (c, k) => ({ c, k, f: quadFrame(G, c, k) });
  const rightOf = (A) => { const c = across(A.c, A.f.br, A.f.fr); if (!c || c.n !== 4) return null; const e = findEdge(c, A.f.fr, A.f.br); return e < 0 ? null : F(c, (e + 3) % 4); };
  const leftOf = (A) => { const c = across(A.c, A.f.fl, A.f.bl); if (!c || c.n !== 4) return null; const e = findEdge(c, A.f.bl, A.f.fl); return e < 0 ? null : F(c, (e + 1) % 4); };
  const backOf = (A) => { const c = across(A.c, A.f.bl, A.f.br); if (!c || c.n !== 4) return null; const e = findEdge(c, A.f.br, A.f.bl); return e < 0 ? null : F(c, e); };
  return { across, findEdge, F, rightOf, leftOf, backOf };
}
export function pointInCell(G, c, x, z) {
  let inside = false;
  for (let k = 0, j = c.n - 1; k < c.n; j = k++) {
    const xi = G.X[c.v[k]], zi = G.Z[c.v[k]], xj = G.X[c.v[j]], zj = G.Z[c.v[j]];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function genTown(G, L, seed) {
  const r = makeRng(seed ^ 0x5bd1e995);
  const cells = G.cells, N = cells.length, T = makeTopo(G);
  const use = new Uint8Array(N), bld = new Int32Array(N).fill(-1), gen = new Int16Array(N).fill(99);
  const roadish = (c) => c && (use[c.id] === U.ROAD || use[c.id] === U.PLAZA);
  const dirTo = (a, b) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };

  // ---------------- 廣場：中心附近一格平地＋周圍一圈
  let pc = null, best = -1e9;
  for (const c of cells) {
    if (c.kind !== KD.LAND || c.border || c.nb.some((n) => cells[n].kind !== KD.LAND)) continue;
    const s = -Math.hypot(c.x, c.z) * 0.6 - (c.hmax - c.hmin) * 4 - c.nb.reduce((a, n) => a + Math.abs(cells[n].y - c.y), 0) * 1.5 + r();
    if (s > best) { best = s; pc = c; }
  }
  if (!pc) pc = cells.reduce((a, c) => (Math.hypot(c.x, c.z) < Math.hypot(a.x, a.z) ? c : a));
  const plaza = cells.filter((c) => c === pc || (c.kind === KD.LAND && Math.hypot(c.x - pc.x, c.z - pc.z) < 1.55 && Math.abs(c.y - pc.y) < 0.3));
  for (const c of plaza) { use[c.id] = U.PLAZA; gen[c.id] = -1; }
  const px = pc.x, pz = pc.z;
  const dPl = (c) => Math.hypot(c.x - px, c.z - pz);

  // ---------------- 街道（沿方向在格子間蜿蜒前進）
  const sites = [];
  const setRoad = (c, g) => { use[c.id] = U.ROAD; gen[c.id] = Math.min(gen[c.id], g); };
  function step(a) {
    const cur = cells[a.c];
    let nxt = null, bs = 0.25;
    for (const nid of cur.nb) {
      const nc = cells[nid], d = dirTo(cur, nc);
      const s = d[0] * a.dir[0] + d[1] * a.dir[1] + (r() - 0.5) * 0.35;
      if (s > bs) { bs = s; nxt = nc; }
    }
    if (!nxt || roadish(nxt) || use[nxt.id] === U.SITE) return false;
    if (Math.hypot(nxt.x, nxt.z) > G.s * G.H * 0.86) return false;
    if (nxt.kind === KD.RIVER) {
      const chain = [nxt]; let prev = cur, w = nxt, land = null;
      for (let t = 0; t < 4 && !land; t++) {
        const d0 = dirTo(prev, w); let nx = null, ns = 0.15;
        for (const nid of w.nb) { const n2 = cells[nid]; if (chain.includes(n2) || n2 === cur) continue; const d = dirTo(w, n2), sc = d[0] * d0[0] + d[1] * d0[1]; if (sc > ns) { ns = sc; nx = n2; } }
        if (!nx) break;
        if (nx.kind === KD.RIVER) { chain.push(nx); prev = w; w = nx; continue; }
        if (nx.kind === KD.LAND && use[nx.id] === U.EMPTY && Math.abs(nx.y - cur.y) < 0.7) land = nx;
        break;
      }
      if (!land || chain.length > 3) return false;
      for (const w2 of chain) use[w2.id] = U.SITE;
      sites.push({ a: cur.id, b: land.id, water: chain.map((c) => c.id), active: false });
      setRoad(land, a.gen); a.dir = dirTo(cur, land); a.c = land.id;
      return true;
    }
    if (nxt.kind !== KD.LAND || use[nxt.id] !== U.EMPTY || Math.abs(nxt.y - cur.y) > 0.5) return false;
    const others = nxt.nb.filter((n) => n !== cur.id && roadish(cells[n]));
    if (others.length) { if (others.length === 1 && r() < 0.5) setRoad(nxt, a.gen); return false; }
    setRoad(nxt, a.gen);
    const nd = dirTo(cur, nxt); a.dir = [lerp(a.dir[0], nd[0], 0.45), lerp(a.dir[1], nd[1], 0.45)];
    const l = Math.hypot(...a.dir); a.dir = [a.dir[0] / l, a.dir[1] / l];
    a.c = nxt.id;
    return true;
  }
  const agents = [];
  const ring = plaza.filter((c) => c.nb.some((n) => use[n] !== U.PLAZA)).sort(() => r() - 0.5);
  for (const c of ring.slice(0, 4)) agents.push({ c: c.id, dir: dirTo(pc, c), gen: 0, left: r.int(4, 7), since: 0 });
  while (agents.length) {
    const a = agents.shift();
    while (a.left-- > 0) {
      if (!step(a)) break;
      if (a.gen < 1 && a.since >= 2 && r() < 0.5) {
        for (const sg of [1, -1]) if (r() < 0.6) agents.push({ c: a.c, dir: [-a.dir[1] * sg, a.dir[0] * sg], gen: a.gen + 1, left: r.int(2, 4), since: 0 });
        a.since = 0;
      } else a.since++;
    }
  }

  // ---------------- 建地與建築（任何形狀的格子都能蓋）
  function lotFront(c) {
    if (!c || c.kind !== KD.LAND || use[c.id] !== U.EMPTY) return -1;
    let bk = -1, bg = 999;
    c.edges.forEach((e, k) => {
      if (e.nb < 0) return;
      const o = cells[e.nb];
      if (!roadish(o) || Math.abs(o.y - c.y) > 0.45) return;
      if (gen[o.id] < bg) { bg = gen[o.id]; bk = k; }
    });
    return bk;
  }
  const buildings = [];
  // 一般建築：type＝house/church/tavern/apothecary/bakery 用「照形狀長」的房子；其他用小型設計擺在格子中央
  const GENERIC = new Set(['house', 'church', 'tavern', 'apothecary', 'bakery']);
  function place(type, tier, cellList, face) {
    const id = buildings.length, cs = cellList.map((c) => (typeof c === 'number' ? cells[c] : c));
    for (const c of cs) { use[c.id] = U.BUILD; bld[c.id] = id; }
    let x = 0, z = 0; for (const c of cs) { x += c.x; z += c.z; }
    const b = { id, type, tier, cells: cs.map((c) => c.id), x: x / cs.length, z: z / cs.length, y: Math.max(...cs.map((c) => c.hmax)) + 0.02, hmin: Math.min(...cs.map((c) => c.hmin)), seed: (r() * 1e9) | 0, generic: GENERIC.has(type) };
    if (!b.generic) {
      const c = cs[0];
      const yaw = face !== undefined ? face : (() => { const k = lotFront(c) >= 0 ? lotFront(c) : 0; const o = c.edges[k].nb >= 0 ? cells[c.edges[k].nb] : null; return o ? Math.atan2(o.x - c.x, o.z - c.z) : 0; })();
      b.W = makeSimWarp(c.x, c.z, yaw, c.rin * 1.85); b.x = c.x; b.z = c.z;
    }
    buildings.push(b);
    return b;
  }
  function unplace(b) { b.dead = true; for (const id of b.cells) { use[id] = U.EMPTY; bld[id] = -1; } }
  const lots = [];
  for (const c of cells) { const k = lotFront(c); if (k >= 0) lots.push({ c, k, d: dPl(c) }); }
  const free = (l) => use[l.c.id] === U.EMPTY;
  function takeLot(filter, score) {
    let bl = null, bs = -1e9;
    for (const l of lots) { if (!free(l) || !filter(l)) continue; const s = score(l) + r() * 0.6; if (s > bs) { bs = s; bl = l; } }
    return bl;
  }
  const services = [];
  const yawTo = (c, o) => Math.atan2(o.x - c.x, o.z - c.z);
  const near = (b, l, d) => Math.hypot(b.x - l.c.x, b.z - l.c.z) < d;
  const sv = (type, tier, filter, score) => { const l = takeLot(filter, score); if (l) services.push(place(type, tier, [l.c])); };
  sv('well', 0, (l) => l.d > 2 && l.d < 6, (l) => -Math.abs(l.d - 3.5));
  // 水車磨坊：面向河
  {
    let bm = null, bs = -1e9;
    for (const c of cells) {
      if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY) continue;
      const d = dPl(c); if (d < 3.5 || d > 13) continue;
      for (const e of c.edges) {
        if (e.nb < 0 || cells[e.nb].kind !== KD.RIVER || use[e.nb] === U.SITE) continue;
        const sc = -Math.abs(d - 6.5) + (c.nb.some((n) => roadish(cells[n])) ? 2 : 0) + r();
        if (sc > bs) { bs = sc; bm = [c, cells[e.nb]]; }
      }
    }
    if (bm) services.push(place('watermill', 0, [bm[0]], yawTo(bm[0], bm[1])));
  }
  function highCell(minD, avoid) {
    let bp = null, bs = -1e9;
    for (const c of cells) {
      if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY || c.border) continue;
      const d = dPl(c); if (d < minD) continue;
      if (avoid && Math.hypot(c.x - avoid.x, c.z - avoid.z) < 6) continue;
      const sc = c.y * 1.4 - (c.hmax - c.hmin) * 2 - d * 0.12 + r();
      if (sc > bs) { bs = sc; bp = c; }
    }
    return bp;
  }
  const wm = highCell(7.5);
  if (wm) services.push(place('windmill', 0, [wm], 0));
  const mt = highCell(8.5, wm);
  if (mt) services.push(place('magetower', 0, [mt], 0));
  // 碼頭與燈塔
  let dock = null;
  {
    let bs = -1e9;
    for (const c of cells) {
      if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY) continue;
      c.edges.forEach((e, k) => { if (e.nb < 0 || cells[e.nb].kind !== KD.SEA) return; const sc = -dPl(c) + r(); if (sc > bs) { bs = sc; dock = { c, k }; } });
    }
    if (dock) use[dock.c.id] = U.FIELD;
  }
  {
    let bp = null, bs = -1e9;
    for (const c of cells) {
      if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY) continue;
      const ns = c.nb.filter((n) => cells[n].kind === KD.SEA).length; if (!ns) continue;
      const dd = dock ? Math.hypot(c.x - dock.c.x, c.z - dock.c.z) : 10;
      const sc = ns * 2 + Math.min(dd, 10) * 0.4 + r();
      if (sc > bs) { bs = sc; bp = c; }
    }
    if (bp) services.push(place('lighthouse', 0, [bp], 0));
  }
  // 房屋
  let nHouse = 0;
  for (const l of lots.slice().sort((a, b) => a.d - b.d)) {
    if (!free(l) || nHouse >= 10 || l.d > 5) continue;
    if (r() < 0.8) { place('house', 1, [l.c]); nHouse++; }
  }
  // 分級：看服務覆蓋
  const live = () => buildings.filter((b) => !b.dead);
  const within = (type, x, z, d) => live().some((b) => b.type === type && Math.hypot(b.x - x, b.z - z) < d);
  function needsAt(x, z) {
    return {
      water: within('well', x, z, 5.4),
      food: Math.hypot(x - px, z - pz) < 8 || within('bakery', x, z, 5.8),
      health: within('apothecary', x, z, 6.4),
      faith: within('church', x, z, 7.6) || within('tavern', x, z, 5.4),
      beauty: within('garden', x, z, 4.2) || Math.hypot(x - px, z - pz) < 3.8,
    };
  }
  for (const b of buildings) if (b.type === 'house') {
    const n = needsAt(b.x, b.z);
    let t = 1 + n.water + n.food + n.health + n.faith;
    if (r() < 0.2) t -= r.int(1, 2);
    b.tier = clamp(t, 1, 5);
  }
  // 合併：相鄰的 5 級房子 → 大宅（2 格）→ 莊園（3 格）→ 宮殿（4 格）
  const houseIn = (c) => { const id = bld[c.id]; const b = id >= 0 ? buildings[id] : null; return b && !b.dead && b.type === 'house' ? b : null; };
  function mergeTargets(b) {
    const out = new Set();
    for (const id of b.cells) for (const n of cells[id].nb) { const o = houseIn(cells[n]); if (o && o !== b && o.tier >= 5 && b.cells.length + o.cells.length <= 4 && Math.abs(o.y - b.y) < 0.45) out.add(o); }
    return [...out];
  }
  function mergeHouses(a, o) {
    const cs = [...a.cells, ...o.cells];
    unplace(a); unplace(o);
    return place('house', 4 + cs.length, cs);
  }
  // ---------------- 留一座橋給玩家觸發
  const reserved = new Set();
  {
    const cc = sites.map((s) => ({ s, d: dPl(cells[s.water[0]]) })).sort((a, b) => b.d - a.d);
    for (const { s } of cc) {
      const A = cells[s.a], B = cells[s.b], far = dPl(A) > dPl(B) ? A : B, nr = far === A ? B : A;
      const victims = live().filter((b) => b.cells.some((id) => { const c = cells[id]; const df = Math.hypot(c.x - far.x, c.z - far.z), dn = Math.hypot(c.x - nr.x, c.z - nr.z); return df <= 3.4 && df < dn; }));
      if (!victims.every((b) => b.type === 'house' && b.cells.length === 1)) continue;
      for (const b of victims) unplace(b);
      for (const c of cells) if (Math.hypot(c.x - far.x, c.z - far.z) < 3.6) reserved.add(c.id);
      s.reserved = true;
      break;
    }
  }
  const town = { G, L, T, use, bld, gen, buildings, sites, plaza, pc, fields: [], yards: [], trees: [], dock, reserved, dPl, roadish, lotFront, place, unplace, houseIn, mergeTargets, mergeHouses, needsAt, r };
  for (const s of sites) s.active = siteActive(town, s);

  // ---------------- 農田
  const fieldTypes = ['wheat', 'wheat', 'lavender', 'vine', 'veg', 'pasture', 'pasture'];
  for (let tries = 0; tries < 300 && town.fields.reduce((a, f) => a + f.cells.length, 0) < 40; tries++) {
    const c = cells[Math.floor(r() * N)];
    if (c.n !== 4 || c.kind !== KD.LAND || use[c.id] !== U.EMPTY || dPl(c) < 8 || reserved.has(c.id) || lotFront(c) >= 0) continue;
    const type = r.pick(fieldTypes), size = r.int(2, 6), cl = [c];
    use[c.id] = U.FIELD;
    for (let k = 0; k < 24 && cl.length < size; k++) {
      const o = cells[r.pick(r.pick(cl).nb)];
      if (o && o.n === 4 && o.kind === KD.LAND && use[o.id] === U.EMPTY && Math.abs(o.y - c.y) < 0.4 && !reserved.has(o.id) && lotFront(o) < 0) { use[o.id] = U.FIELD; cl.push(o); }
    }
    town.fields.push({ type, cells: cl.map((x) => x.id), id: town.fields.length });
  }
  // ---------------- 後院（鎮內非臨街的空地）
  for (const c of cells) {
    if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY || dPl(c) > 11 || reserved.has(c.id) || lotFront(c) >= 0) continue;
    if (!c.nb.some((n) => use[n] === U.BUILD)) continue;
    town.yards.push({ c: c.id, type: r.pick(['orchard', 'orchard', 'veg', 'laundry', 'meadow', 'meadow', 'shed']) });
    use[c.id] = U.YARD;
  }
  // ---------------- 樹
  const trees = town.trees;
  const kindAt = (hi) => { const rr = r(); return hi ? (rr < 0.65 ? 'pine' : 'round') : rr < 0.18 ? 'pine' : rr < 0.32 ? 'poplar' : rr < 0.4 ? 'blossom' : rr < 0.47 ? 'autumn' : 'round'; };
  for (const y of town.yards) if (y.type === 'orchard' || y.type === 'meadow') {
    const c = cells[y.c], n = y.type === 'orchard' ? r.int(2, 3) : r.int(0, 1);
    for (let k = 0; k < n; k++) { const a = r() * TAU, rr = r() * c.rin * 0.6, x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr; trees.push({ x, z, y: L.h(x, z), kind: r() < 0.25 ? 'blossom' : 'round', s: 0.6 + r() * 0.3, rot: r() * TAU, cell: c.id }); }
  }
  for (const c of cells) {
    if (c.kind !== KD.LAND || use[c.id] !== U.EMPTY || reserved.has(c.id) || lotFront(c) >= 0) continue;
    const f = fbm(c.x * 0.13 + L.ox + 9, c.z * 0.13 + L.oz - 4), d = dPl(c);
    let p = smooth(0.4, 0.6, f) * 0.85 + 0.15; if (d < 6) p *= 0.35;
    if (r() > p) continue;
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) { const a = r() * TAU, rr = r() * c.rin * 0.75, x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr; trees.push({ x, z, y: L.h(x, z), kind: kindAt(c.y > 2 || f > 0.6), s: 0.75 + r() * 0.5, rot: r() * TAU, cell: c.id }); }
  }
  const R0 = G.s * G.H * 0.93;
  for (let k = 0; k < 2600; k++) {
    const a = r() * TAU, rr = R0 + Math.sqrt(r()) * 20, x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const y = L.h(x, z); if (y < 0.3) continue;
    const R = L.riverAt(x, z, 3); if (R && R.d < R.w + 0.5) continue;
    const f = fbm(x * 0.12 + L.ox + 9, z * 0.12 + L.oz - 4);
    if (r() > smooth(0.38, 0.58, f) * 0.9 + 0.1) continue;
    trees.push({ x, z, y, kind: kindAt(y > 2 || f > 0.6), s: 0.8 + r() * 0.55, rot: r() * TAU });
  }
  return town;
}

// 兩岸各有一棟建築靠近橋址，橋才會蓋
export function siteActive(town, s) {
  const cells = town.G.cells, A = cells[s.a], B = cells[s.b];
  let a = false, b = false;
  for (const bd of town.buildings) {
    if (bd.dead) continue;
    for (const id of bd.cells) {
      const c = cells[id], da = Math.hypot(c.x - A.x, c.z - A.z), db = Math.hypot(c.x - B.x, c.z - B.z);
      if (da <= 3.4 && da < db) a = true;
      if (db <= 3.4 && db < da) b = true;
    }
  }
  return a && b;
}

// ---------------------------------------------------------------- 網格
const PAVE = ['#e8dcc0', '#dccfae', '#d2c3a0', '#e2d5b6', '#cdbd99'];
// 路面：沿地形鋪的多邊形＋卵石＋路緣；水上的路是木棧道
export function buildRoadCell(town, c) {
  const { G, L, use } = town;
  const isPlaza = use[c.id] === U.PLAZA;
  const S = [], W = [], lamps = [], extra = [];
  const rs = makeRng(c.id * 7919 + 13);
  const ring = [];
  for (let k = 0; k < c.n; k++) {
    const a = c.v[k], b = c.v[(k + 1) % c.n];
    const ax = G.X[a], az = G.Z[a], bx2 = G.X[b], bz = G.Z[b];
    const m = Math.max(1, Math.ceil(Math.hypot(bx2 - ax, bz - az) / 0.22));
    for (let q = 0; q < m; q++) ring.push([lerp(ax, bx2, q / m), lerp(az, bz, q / m)]);
  }
  if (c.kind === KD.RIVER) {
    const wy = c.ws + 0.17;
    const shape = new THREE.Shape(c.v.map((v) => new THREE.Vector2(lerp(G.X[v], c.x, 0.06), -lerp(G.Z[v], c.z, 0.06))));
    S.push(P(new THREE.ExtrudeGeometry(shape, { depth: 0.04, bevelEnabled: false }).rotateX(-PI / 2), '#a07a54', { y: wy - 0.04 }));
    for (let k = 0; k < 6; k++) S.push(P(bx(0.012, 0.005, c.rin * 1.8), '#7a5a3c', { x: c.x + (k - 2.5) * c.rin * 0.3, y: wy + 0.002, z: c.z }));
    for (const v of c.v) { const x = lerp(G.X[v], c.x, 0.12), z = lerp(G.Z[v], c.z, 0.12); S.push(P(new THREE.CylinderGeometry(0.025, 0.025, wy - c.ws + 0.35, 6), '#6e4c36', { x, y: (wy + c.ws - 0.35) / 2, z })); }
  } else {
    const pos = [], col = [];
    const base = new THREE.Color(isPlaza ? '#ead9b4' : '#cdb894');
    const yc = L.h(c.x, c.z) + 0.03;
    for (let q = 0; q < ring.length; q++) {
      const p0 = ring[q], p1 = ring[(q + 1) % ring.length];
      const y0 = L.h(p0[0], p0[1]) + 0.03, y1 = L.h(p1[0], p1[1]) + 0.03;
      pos.push(c.x, yc, c.z, p1[0], y1, p1[1], p0[0], y0, p0[1]);
      for (let t = 0; t < 3; t++) col.push(base.r, base.g, base.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const surf = new THREE.Mesh(g, isPlaza ? M.plaza : M.road); surf.receiveShadow = true;
    extra.push(surf);
    // 路緣
    for (const e of c.edges) {
      const o = e.nb >= 0 ? G.cells[e.nb] : null;
      if (o && (use[o.id] === U.ROAD || use[o.id] === U.PLAZA || use[o.id] === U.SITE)) continue;
      const ax = lerp(G.X[e.a], c.x, 0.04), az = lerp(G.Z[e.a], c.z, 0.04), bx2 = lerp(G.X[e.b], c.x, 0.04), bz = lerp(G.Z[e.b], c.z, 0.04);
      const len = Math.hypot(bx2 - ax, bz - az), m = Math.max(1, Math.round(len / 0.25)), ang = Math.atan2(bx2 - ax, bz - az);
      for (let q = 0; q < m; q++) {
        const t = (q + 0.5) / m, x = lerp(ax, bx2, t), z = lerp(az, bz, t);
        S.push(P(bx(0.05, 0.05, len / m + 0.01), '#e9e1cf', { x, y: L.h(x, z) + 0.045, z, ry: ang }));
      }
    }
    if (!isPlaza && hash2(c.x * 1.7, c.z * 2.3) < 0.4) {
      const v = c.v[Math.floor(rs() * c.n)];
      const x = lerp(G.X[v], c.x, 0.12), z = lerp(G.Z[v], c.z, 0.12), y = L.h(x, z);
      S.push(P(new THREE.CylinderGeometry(0.014, 0.02, 0.42, 6), '#3b3944', { x, y: y + 0.24, z }));
      S.push(P(new THREE.ConeGeometry(0.04, 0.035, 4), '#3b3944', { x, y: y + 0.5, z, ry: PI / 4 }));
      W.push(P(bx(0.05, 0.065, 0.05), '#fff', { x, y: y + 0.455, z }));
      lamps.push(new THREE.Vector3(x, y + 0.44, z));
    }
  }
  const grp = new THREE.Group();
  for (const e of extra) grp.add(e);
  if (S.length) { const m = new THREE.Mesh(merge(S), M.std); m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  if (W.length) grp.add(new THREE.Mesh(merge(W), M.win));
  grp.userData.lamps = lamps;
  return grp;
}

// 石拱橋：從岸 A 的格子中心到岸 B
export function makeBridge(town, s) {
  const { G, L } = town, A = G.cells[s.a], B = G.cells[s.b];
  const ya = L.h(A.x, A.z) + 0.03, yb = L.h(B.x, B.z) + 0.03;
  const dx = B.x - A.x, dz = B.z - A.z, len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
  const n = Math.max(16, Math.round(len / 0.09));
  const samples = [];
  let t0 = 1, t1 = 0, wy = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n, x = A.x + dx * t, z = A.z + dz * t, g = L.h(x, z), R = L.riverAt(x, z, 3);
    const wet = R && g < R.s + 0.02;
    if (wet) { t0 = Math.min(t0, t); t1 = Math.max(t1, t); wy = Math.max(wy, R.s); }
    samples.push({ t, x, z, g });
  }
  const tc = (t0 + t1) / 2, hw = Math.max(0.05, (t1 - t0) / 2 + 0.6 / len);
  const rise = Math.max(0.16, wy + 0.42 - (ya + yb) / 2);
  const parts = [], glow = [], lamps = [];
  const st = ['#d9cdb5', '#cfc2a8', '#e0d5bf'];
  const ang = Math.atan2(ux, uz);
  samples.forEach(({ t, x, z, g }, k) => {
    const deck = lerp(ya, yb, t) + rise * Math.pow(Math.sin(Math.min(1, Math.max(0, (t - tc) / (hw * 2.4) + 0.5)) * PI), 0.7);
    const over = Math.abs(t - tc) < hw;
    const yIn = over ? wy + 0.24 * Math.sqrt(Math.max(0, 1 - ((t - tc) / hw) ** 2)) : g - 0.05;
    const h = deck - 0.03 - yIn;
    if (h > 0.01) parts.push(P(bx(0.62, h, len / n + 0.003), st[k % 3], { x, y: yIn + h / 2, z, ry: ang }));
    parts.push(P(bx(0.66, 0.035, len / n + 0.005), '#e6dccb', { x, y: deck - 0.012, z, ry: ang }));
    for (const sd of [-1, 1]) parts.push(P(bx(0.06, 0.09, len / n + 0.005), st[(k + 1) % 3], { x: x + uz * 0.31 * sd, y: deck + 0.04, z: z - ux * 0.31 * sd, ry: ang }));
  });
  for (const [t, y0] of [[0.06, ya], [0.94, yb]]) for (const sd of [-1, 1]) {
    const x = A.x + dx * t + uz * 0.33 * sd, z = A.z + dz * t - ux * 0.33 * sd;
    parts.push(P(bx(0.035, 0.42, 0.035), '#3b3944', { x, y: y0 + 0.21, z }));
    glow.push(P(bx(0.055, 0.065, 0.055), '#fff', { x, y: y0 + 0.45, z }));
    lamps.push(new THREE.Vector3(x, y0 + 0.44, z));
  }
  const g = new THREE.Group();
  const m = new THREE.Mesh(merge(parts), M.std); m.castShadow = true; m.receiveShadow = true;
  g.add(m, new THREE.Mesh(merge(glow), M.win));
  g.userData = { lamps, A: [A.x, ya, A.z], B: [B.x, yb, B.z], deck: (t) => lerp(ya, yb, t) + rise * Math.pow(Math.sin(Math.min(1, Math.max(0, (t - tc) / (hw * 2.4) + 0.5)) * PI), 0.7) };
  return g;
}

// 地基：房子蓋在斜坡上時，露出的石砌台座
export function makePlinth(town, b) {
  const { G } = town, parts = [];
  for (const id of b.cells) {
    const c = G.cells[id];
    if (b.y - c.hmin < 0.05) continue;
    const shape = new THREE.Shape(c.v.map((v) => new THREE.Vector2(lerp(G.X[v], c.x, 0.03) - b.x, -(lerp(G.Z[v], c.z, 0.03) - b.z))));
    const h = b.y - c.hmin + 0.12;
    parts.push(P(new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }).rotateX(-PI / 2), ['#a99c86', '#d3c7b1'], { y: -h }));
    const top = new THREE.Shape(c.v.map((v) => new THREE.Vector2(lerp(G.X[v], c.x, -0.01) - b.x, -(lerp(G.Z[v], c.z, -0.01) - b.z))));
    parts.push(P(new THREE.ExtrudeGeometry(top, { depth: 0.03, bevelEnabled: false }).rotateX(-PI / 2), '#e3d8c3', { y: -0.03 }));
  }
  if (!parts.length) return null;
  const m = new THREE.Mesh(merge(parts), M.std); m.castShadow = true; m.receiveShadow = true;
  return m;
}

// 田、後院、碼頭
export function buildScenery(town) {
  const { G, L } = town, S = [], boats = [];
  const fr = makeRng(17), T = town.T;
  const FLW = ['#ff8fb0', '#ffe066', '#ffffff', '#c7a6ff', '#ff9a5a'];
  const fieldOf = new Map(); for (const f of town.fields) for (const id of f.cells) fieldOf.set(id, f);
  for (const f of town.fields) for (const id of f.cells) {
    const c = G.cells[id], W = makeWarp(G, [{ x0: -0.5, z0: -0.5, q: quadFrame(G, c, f.id % 4) }]);
    const y = c.hmax + 0.0;
    const loc = [];
    if (f.type !== 'pasture') loc.push(P(bx(0.98, 0.03, 0.98), '#8b6a4a', { y: 0.015 }));
    for (let k = 0; k < 6; k++) {
      const o = -0.41 + k * 0.164;
      if (f.type === 'wheat') loc.push(P(bx(0.12, 0.13, 0.9), ['#c9962f', '#f0cf6e'], { x: o, y: 0.09, j: 0.06 }));
      else if (f.type === 'lavender') loc.push(P(rbx(0.1, 0.1, 0.9, 0.04, 1), ['#6a5a98', '#a991d6'], { x: o, y: 0.08 }));
      else if (f.type === 'vine') { loc.push(P(bx(0.07, 0.13, 0.88), ['#3f7a3a', '#6ea552'], { x: o, y: 0.1 })); for (const sz of [-0.4, 0, 0.4]) loc.push(P(bx(0.015, 0.17, 0.015), '#7a5a3c', { x: o, y: 0.1, z: sz })); }
      else if (f.type === 'veg') for (let q = 0; q < 6; q++) loc.push(P(new THREE.IcosahedronGeometry(0.055, 1), ['#4f8f3f', '#9fd27a'], { x: o, y: 0.07, z: -0.41 + q * 0.164 }));
    }
    if (f.type === 'wheat' && fr() < 0.3) loc.push(P(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), ['#d9b25a', '#f0d27a'], { x: (fr() - 0.5) * 0.5, y: 0.2, z: (fr() - 0.5) * 0.5, rx: PI / 2 }));
    if (loc.length) { const geo = merge(loc); warpGeometry(geo, W); geo.translate(W.ax, y, W.az); S.push(geo); }
    for (const e of c.edges) {
      if (e.nb >= 0 && fieldOf.get(e.nb) === f) continue;
      const ax = lerp(G.X[e.a], c.x, 0.04), az = lerp(G.Z[e.a], c.z, 0.04), bx2 = lerp(G.X[e.b], c.x, 0.04), bz = lerp(G.Z[e.b], c.z, 0.04);
      const len = Math.hypot(bx2 - ax, bz - az), ang = Math.atan2(bx2 - ax, bz - az), mx = (ax + bx2) / 2, mz = (az + bz) / 2;
      if (f.type === 'pasture') {
        const m = Math.round(len / 0.16);
        for (let q = 0; q <= m; q++) { const x = lerp(ax, bx2, q / m), z = lerp(az, bz, q / m); S.push(P(bx(0.025, 0.12, 0.025), '#9a7650', { x, y: L.h(x, z) + 0.06, z })); }
        for (const yy of [0.05, 0.1]) S.push(P(bx(0.014, 0.014, len), '#9a7650', { x: mx, y: L.h(mx, mz) + yy, z: mz, ry: ang }));
      } else S.push(P(rbx(0.09, 0.1, len, 0.04, 1), ['#4f8a42', '#6aa552'], { x: mx, y: L.h(mx, mz) + 0.05, z: mz, ry: ang }));
    }
  }
  // 後院小景（每格一個 mesh，擴建時能拿掉）
  const yardMeshes = new Map();
  for (const yd of town.yards) {
    const c = G.cells[yd.c], sc = c.rin * 1.9, W = makeSimWarp(c.x, c.z, fr() * TAU, sc);
    const loc = [];
    if (yd.type === 'veg') {
      loc.push(P(bx(0.7, 0.03, 0.62), '#8b6a4a', { y: 0.015 }));
      for (let k = 0; k < 4; k++) for (let q = 0; q < 4; q++) loc.push(P(new THREE.IcosahedronGeometry(0.05, 1), ['#4f8f3f', '#9fd27a'], { x: -0.26 + k * 0.17, y: 0.06, z: -0.22 + q * 0.15 }));
      for (const sd of [-1, 1]) loc.push(P(bx(0.8, 0.07, 0.015), '#9a7650', { y: 0.035, z: sd * 0.36 }));
    } else if (yd.type === 'laundry') {
      for (const sd of [-1, 1]) loc.push(P(bx(0.02, 0.26, 0.02), '#7a5a3c', { x: sd * 0.32, y: 0.13 }));
      loc.push(P(bx(0.64, 0.006, 0.006), '#e6e0d4', { y: 0.25 }));
      for (let k = 0; k < 5; k++) loc.push(P(bx(0.08, 0.1 + fr() * 0.05, 0.008), fr.pick(['#fdfbf6', '#a8c6e0', '#e8b4b8', '#f6e3a6', '#c6dbb4']), { x: -0.24 + k * 0.12, y: 0.19 }));
    } else if (yd.type === 'shed') {
      loc.push(P(bx(0.34, 0.2, 0.26), '#8a6244', { x: -0.12, y: 0.1, z: -0.12 }));
      const tri = new THREE.Shape([new THREE.Vector2(-0.17, 0), new THREE.Vector2(0.17, 0), new THREE.Vector2(0, 0.1)]);
      loc.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.3, bevelEnabled: false }), '#a9553d', { x: -0.12, y: 0.2, z: -0.27, sx: 1.15 }));
      for (let k = 0; k < 3; k++) loc.push(P(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), '#d9b25a', { x: 0.2, y: 0.06 + k * 0.03, z: 0.15 - k * 0.05, rx: PI / 2 }));
    }
    for (let k = 0; k < (yd.type === 'meadow' ? 14 : 5); k++) loc.push(P(new THREE.IcosahedronGeometry(0.022, 0), fr.pick(FLW), { x: (fr() - 0.5) * 0.8, y: 0.02, z: (fr() - 0.5) * 0.8 }));
    if (yd.type === 'meadow') for (let k = 0; k < 3; k++) loc.push(P(new THREE.IcosahedronGeometry(0.06 + fr() * 0.04, 1), ['#4f8a42', '#7ab35a'], { x: (fr() - 0.5) * 0.7, y: 0.04, z: (fr() - 0.5) * 0.7, sy: 0.8 }));
    const geo = merge(loc); warpGeometry(geo, W); geo.translate(W.ax, L.h(c.x, c.z), W.az);
    const m = new THREE.Mesh(geo, M.std); m.castShadow = true; m.receiveShadow = true;
    yardMeshes.set(yd.c, m);
  }
  town.yardMeshes = yardMeshes;
  // 碼頭
  if (town.dock) {
    const { c, k } = town.dock, e = c.edges[k];
    const mx = (G.X[e.a] + G.X[e.b]) / 2, mz = (G.Z[e.a] + G.Z[e.b]) / 2;
    let ux = mx - c.x, uz = mz - c.z; const l = Math.hypot(ux, uz); ux /= l; uz /= l;
    const ang = Math.atan2(ux, uz);
    for (let q = 0; q < 14; q++) { const s = q * 0.18 - 0.3; S.push(P(bx(0.42, 0.025, 0.16), q % 2 ? '#a07a54' : '#8f6b48', { x: mx + ux * s, y: 0.12, z: mz + uz * s, ry: ang, j: 0.1 })); }
    for (let q = 0; q < 5; q++) for (const sd of [-1, 1]) { const s = q * 0.55; S.push(P(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 6), '#6e4c36', { x: mx + ux * s + uz * sd * 0.22, y: -0.08, z: mz + uz * s - ux * sd * 0.22 })); }
    for (let q = 0; q < 3; q++) boats.push({ x: mx + ux * (0.7 + q * 0.7) + uz * (q % 2 ? 0.45 : -0.45), z: mz + uz * (0.7 + q * 0.7) - ux * (q % 2 ? 0.45 : -0.45), ry: ang, sail: q === 2 });
  }
  const g = new THREE.Group();
  for (const m of yardMeshes.values()) g.add(m);
  if (S.length) { const m = new THREE.Mesh(merge(S), M.std); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  return { group: g, boats };
}
