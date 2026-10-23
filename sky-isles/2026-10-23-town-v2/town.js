// 小鎮生成：廣場、街道、橋址、公共建築、房屋分級與合併、農田、樹
import * as THREE from 'three';
import { makeRng, fbm, hash2, clamp, lerp, smooth, LH, DIRS, PI } from './util.js';
import { P, bx, rbx, M, merge } from './kit.js';
import { LAND, SEA, RIVER } from './terrain.js';

export const U = { EMPTY: 0, ROAD: 1, PLAZA: 2, BUILD: 3, FIELD: 4, PIER: 5, SITE: 6 };

export function genTown(T, seed) {
  const r = makeRng(seed ^ 0x5bd1e995);
  const { MM, lev, kind } = T;
  const use = Array.from({ length: MM }, () => new Uint8Array(MM));
  const bld = Array.from({ length: MM }, () => new Int32Array(MM).fill(-1));
  const gen = new Map();
  const K = (i, j) => i * 1000 + j;

  // 離河距離
  const rd = Array.from({ length: MM }, () => new Int16Array(MM).fill(99));
  { const q = []; for (const [i, j] of T.river) { rd[i][j] = 0; q.push([i, j]); }
    while (q.length) { const [i, j] = q.shift(); for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (T.inb(a, b) && rd[a][b] > rd[i][j] + 1) { rd[a][b] = rd[i][j] + 1; q.push([a, b]); } } } }

  // ---------------- 廣場：找一塊 3×3 平地，離河不遠、靠近地圖中心
  let plaza = null, best = -1e9;
  const c0 = MM / 2 - 0.5;
  for (let i = T.E + 5; i < T.E + T.N - 5; i++) for (let j = T.E + 5; j < T.E + T.N - 5; j++) {
    let ok = true; const L = lev[i][j];
    for (let a = -1; a <= 1 && ok; a++) for (let b = -1; b <= 1; b++) if (kind[i + a][j + b] !== LAND || lev[i + a][j + b] !== L) { ok = false; break; }
    if (!ok || rd[i][j] < 3) continue;
    const s = -Math.hypot(i - c0, j - c0) * 0.55 - Math.abs(rd[i][j] - 4) * 0.8 - L * 0.25 + r() * 1.2;
    if (s > best) { best = s; plaza = [i, j]; }
  }
  if (!plaza) { // 找不到就把中心附近整平
    let pi = Math.round(c0), pj = Math.round(c0);
    for (let k = 0; k < 40 && rd[pi][pj] < 2; k++) { pi += r.int(-1, 1); pj += r.int(-1, 1); }
    const L = lev[pi][pj] < 0 ? 0 : lev[pi][pj];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (kind[pi + a][pj + b] === LAND) lev[pi + a][pj + b] = L;
    plaza = [pi, pj];
  }
  const [pi, pj] = plaza;
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { use[pi + a][pj + b] = U.PLAZA; gen.set(K(pi + a, pj + b), -1); }
  const dPl = (i, j) => Math.hypot(i - pi, j - pj);

  // ---------------- 街道
  const roadish = (i, j) => T.inb(i, j) && (use[i][j] === U.ROAD || use[i][j] === U.PLAZA);
  function makes2x2(i, j) {
    for (const [dx, dz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
      let all = true;
      for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const x = i + dx + a, y = j + dz + b; if (x === i && y === j) continue; if (!roadish(x, y)) { all = false; break; } }
      if (all) return true;
    }
    return false;
  }
  const sites = [];
  function setRoad(i, j, g) { use[i][j] = U.ROAD; if (!gen.has(K(i, j))) gen.set(K(i, j), g); }
  function step(a) {
    const ni = a.i + a.di, nj = a.j + a.dj;
    if (!T.inPlay(ni, nj, 1) || kind[ni][nj] === SEA) return false;
    if (roadish(ni, nj)) return false;
    if (kind[ni][nj] === RIVER) {
      const bi = ni + a.di, bj = nj + a.dj;
      if (!T.inPlay(bi, bj, 1) || kind[bi][bj] !== LAND || Math.abs(lev[bi][bj] - lev[a.i][a.j]) > 1) return false;
      if (use[ni][nj] === U.SITE) return false;
      use[ni][nj] = U.SITE;
      sites.push({ a: [a.i, a.j], r: [ni, nj], b: [bi, bj], di: a.di, dj: a.dj, active: false });
      if (roadish(bi, bj)) return false;
      if (makes2x2(bi, bj)) return false;
      setRoad(bi, bj, a.gen); a.i = bi; a.j = bj; return true;
    }
    if (kind[ni][nj] !== LAND || use[ni][nj] !== U.EMPTY) return false;
    if (Math.abs(lev[ni][nj] - lev[a.i][a.j]) > 1) return false;
    if (makes2x2(ni, nj)) return false;
    setRoad(ni, nj, a.gen); a.i = ni; a.j = nj; return true;
  }
  const agents = DIRS.map(([di, dj]) => ({ i: pi + di, j: pj + dj, di, dj, gen: 0, left: r.int(9, 14), since: 0 }));
  while (agents.length) {
    const a = agents.shift();
    while (a.left-- > 0) {
      if (!step(a)) break;
      if (a.gen < 2 && a.since >= 2 && r() < 0.45) {
        for (const s of [1, -1]) if (r() < 0.75) agents.push({ i: a.i, j: a.j, di: a.dj * s, dj: a.di * s, gen: a.gen + 1, left: a.gen === 0 ? r.int(4, 9) : r.int(3, 6), since: 0 });
        a.since = 0;
      } else a.since++;
      if (a.gen === 0 && r() < 0.06) { const s = r() < 0.5 ? 1 : -1; [a.di, a.dj] = [a.dj * s, a.di * s]; }
    }
  }

  // ---------------- 建地：緊鄰同高度道路的空地，正面朝路
  function lotFacing(i, j) {
    if (!T.inPlay(i, j) || kind[i][j] !== LAND || use[i][j] !== U.EMPTY) return null;
    let bestF = null, bg = 99;
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (!roadish(a, b) || lev[a][b] !== lev[i][j]) continue;
      const g = gen.get(K(a, b)) ?? 9;
      if (g < bg) { bg = g; bestF = [di, dj]; }
    }
    return bestF;
  }
  const buildings = [];
  function place(type, tier, cells, f) {
    const id = buildings.length;
    let cx = 0, cz = 0;
    for (const [i, j] of cells) { cx += T.wx(i); cz += T.wz(j); use[i][j] = U.BUILD; bld[i][j] = id; }
    cx /= cells.length; cz /= cells.length;
    const b = { id, type, tier, cells, f, ry: Math.atan2(f[0], f[1]), x: cx, z: cz, y: lev[cells[0][0]][cells[0][1]] * LH, seed: (r() * 1e9) | 0 };
    buildings.push(b);
    return b;
  }
  const lots = [];
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) { const f = lotFacing(i, j); if (f) lots.push({ i, j, f, d: dPl(i, j) }); }
  const free = (l) => use[l.i][l.j] === U.EMPTY;
  function takeLot(filter, score) {
    let bl = null, bs = -1e9;
    for (const l of lots) { if (!free(l) || !filter(l)) continue; const s = score(l) + r() * 0.6; if (s > bs) { bs = s; bl = l; } }
    return bl;
  }
  const services = [];
  // 教堂：面向廣場，往後佔兩格
  {
    const l = takeLot((l) => use[l.i + l.f[0]][l.j + l.f[1]] === U.PLAZA && (() => { const bi = l.i - l.f[0], bj = l.j - l.f[1]; return T.inPlay(bi, bj) && kind[bi][bj] === LAND && use[bi][bj] === U.EMPTY && lev[bi][bj] === lev[l.i][l.j]; })(), () => 0);
    if (l) services.push(place('church', 0, [[l.i, l.j], [l.i - l.f[0], l.j - l.f[1]]], l.f));
  }
  const near = (b, l, d) => Math.hypot(b.cells[0][0] - l.i, b.cells[0][1] - l.j) < d;
  const sv = (type, filter, score) => { const l = takeLot(filter, score); if (l) services.push(place(type, 0, [[l.i, l.j]], l.f)); };
  sv('tavern', (l) => l.d < 4.5, (l) => -l.d);
  sv('apothecary', (l) => l.d > 2 && l.d < 6.5, (l) => -Math.abs(l.d - 4));
  sv('bakery', (l) => l.d > 2 && l.d < 6.5 && !services.some((b) => near(b, l, 3)), (l) => -Math.abs(l.d - 4));
  for (let k = 0; k < 3; k++) sv('well', (l) => l.d > 3 && l.d < 9 && !services.some((b) => b.type === 'well' && near(b, l, 5)), (l) => -Math.abs(l.d - 5.5));
  for (let k = 0; k < 2; k++) sv('garden', (l) => l.d > 2 && l.d < 6.5 && !services.some((b) => b.type === 'garden' && near(b, l, 3)), (l) => -l.d);
  // 水車磨坊：河岸、面向河
  {
    let bm = null, bs = -1e9;
    for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
      if (!T.inPlay(i, j, 1) || kind[i][j] !== LAND || use[i][j] !== U.EMPTY) continue;
      for (const [di, dj] of DIRS) {
        const a = i + di, b = j + dj;
        if (kind[a][b] !== RIVER || use[a][b] === U.SITE || lev[a][b] !== lev[i][j]) continue;
        const d = dPl(i, j); if (d < 3 || d > 12) continue;
        let nr = 0; for (const [x, y] of DIRS) if (roadish(i + x, j + y)) nr++;
        const s = -Math.abs(d - 6) + nr * 2 + r();
        if (s > bs) { bs = s; bm = [i, j, di, dj]; }
      }
    }
    if (bm) services.push(place('watermill', 0, [[bm[0], bm[1]]], [bm[2], bm[3]]));
  }
  // 風車、法師塔：郊外高處
  const freeCell = (i, j, m = 1) => T.inPlay(i, j, m) && kind[i][j] === LAND && use[i][j] === U.EMPTY && rd[i][j] > 1;
  function highSpot(minD, avoid) {
    let bp = null, bs = -1e9;
    for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
      if (!freeCell(i, j) || dPl(i, j) < minD) continue;
      if (avoid && Math.hypot(i - avoid[0], j - avoid[1]) < 6) continue;
      let flat = 0; for (const [di, dj] of DIRS) if (lev[i + di][j + dj] === lev[i][j]) flat++;
      const s = lev[i][j] * 1.2 + flat * 0.5 - dPl(i, j) * 0.15 + r();
      if (s > bs) { bs = s; bp = [i, j]; }
    }
    return bp;
  }
  const wm = highSpot(7);
  if (wm) services.push(place('windmill', 0, [wm], [0, 1]));
  const mt = highSpot(8, wm);
  if (mt) services.push(place('magetower', 0, [mt], [pi - mt[0] >= 0 ? 0 : 0, 1]));
  // 碼頭與燈塔
  let dock = null;
  {
    let bs = -1e9;
    for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
      if (!T.inPlay(i, j) || !T.isBeach(i, j) || use[i][j] !== U.EMPTY) continue;
      for (const [di, dj] of DIRS) {
        const a = i + di, b = j + dj;
        if (kind[a][b] !== SEA || kind[a + di]?.[b + dj] !== SEA) continue;
        const s = -dPl(i, j) + r();
        if (s > bs) { bs = s; dock = { i, j, di, dj }; }
      }
    }
    if (dock) { use[dock.i][dock.j] = U.PIER; use[dock.i + dock.di][dock.j + dock.dj] = U.PIER; use[dock.i + 2 * dock.di][dock.j + 2 * dock.dj] = U.PIER; }
  }
  {
    let bp = null, bs = -1e9;
    for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
      if (!T.inPlay(i, j, -4) || kind[i][j] !== LAND || use[i][j] !== U.EMPTY) continue;
      let ns = 0; for (const [di, dj] of DIRS) if (T.inb(i + di, j + dj) && kind[i + di][j + dj] === SEA) ns++;
      if (ns < 1) continue;
      const dd = dock ? Math.hypot(i - dock.i, j - dock.j) : 10;
      const s = ns * 2 + Math.min(dd, 10) * 0.4 - Math.max(0, dPl(i, j) - 13) * 1.5 + r();
      if (s > bs) { bs = s; bp = [i, j]; }
    }
    if (bp) services.push(place('lighthouse', 0, [bp], [0, 1]));
  }

  // ---------------- 房屋
  for (const l of lots) {
    if (!free(l)) continue;
    const p = clamp(1.12 - l.d / 11.5, 0.05, 1);
    if (r() < p) place('house', 1, [[l.i, l.j]], l.f);
  }
  // 分級：看服務覆蓋
  const svc = (type) => services.filter((b) => b.type === type);
  const within = (list, x, z, d) => list.some((b) => Math.hypot(b.x - x, b.z - z) < d);
  const wells = svc('well'), bake = svc('bakery'), apo = svc('apothecary'), church = svc('church'), tav = svc('tavern'), gard = svc('garden');
  const px = T.wx(pi), pz = T.wz(pj);
  function needsAt(x, z) {
    return {
      water: within(wells, x, z, 4.6),
      food: Math.hypot(x - px, z - pz) < 7 || within(bake, x, z, 5),
      health: within(apo, x, z, 5.6),
      faith: within(church, x, z, 6.6) || within(tav, x, z, 4.6),
      beauty: within(gard, x, z, 3.6) || Math.hypot(x - px, z - pz) < 3.2,
    };
  }
  for (const b of buildings) if (b.type === 'house') {
    const n = needsAt(b.x, b.z);
    let t = 1 + n.water + n.food + n.health + n.faith;
    if (r() < 0.2) t -= r.int(1, 2);
    b.tier = clamp(t, 1, 5);
  }
  // 合併：2×2 → 宮邸／莊園，2×1 → 雙併
  const houseAt = (i, j) => { const id = T.inb(i, j) ? bld[i][j] : -1; return id >= 0 && buildings[id].type === 'house' && buildings[id].cells.length === 1 ? buildings[id] : null; };
  function unplace(b) { b.dead = true; for (const [i, j] of b.cells) { use[i][j] = U.EMPTY; bld[i][j] = -1; } }
  const quads = [];
  for (let i = 0; i < MM - 1; i++) for (let j = 0; j < MM - 1; j++) {
    const hs = [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]].map(([a, b]) => houseAt(a, b));
    if (hs.some((h) => !h)) continue;
    if (new Set(hs.map((h) => h.y)).size > 1) continue;
    let face = null;
    for (const [di, dj] of DIRS) {
      const front = hs.filter((h) => { const [a, b] = h.cells[0]; const ii = di ? (di > 0 ? i + 1 : i) : a, jj = dj ? (dj > 0 ? j + 1 : j) : b; return a === ii && b === jj; });
      if (front.length === 2 && front.every((h) => h.f[0] === di && h.f[1] === dj)) { face = [di, dj]; break; }
    }
    if (!face) continue;
    quads.push({ hs, face, d: dPl(i + 0.5, j + 0.5) });
  }
  quads.sort((a, b) => a.d - b.d);
  let made = 0;
  for (const q of quads) {
    if (made >= 2 || q.d > 9) break;
    if (q.hs.some((h) => h.dead)) continue;
    const cells = q.hs.map((h) => h.cells[0]);
    q.hs.forEach(unplace);
    place('house', made === 0 ? 8 : 7, cells, q.face);
    made++;
  }
  // 不夠的話，讓臨街兩棟往後方空地擴建
  if (made < 2) {
    const cands = [];
    for (const b of buildings) {
      if (b.dead || b.type !== 'house' || b.cells.length !== 1) continue;
      const [i, j] = b.cells[0], lat = [b.f[1], b.f[0]];
      const o = houseAt(i + lat[0], j + lat[1]);
      if (!o || o.dead || o.f[0] !== b.f[0] || o.f[1] !== b.f[1] || o.y !== b.y) continue;
      const back = [[i - b.f[0], j - b.f[1]], [i + lat[0] - b.f[0], j + lat[1] - b.f[1]]];
      if (!back.every(([a, c]) => T.inPlay(a, c) && kind[a][c] === LAND && use[a][c] === U.EMPTY && lev[a][c] === lev[i][j])) continue;
      cands.push({ b, o, back, d: dPl(i, j) });
    }
    cands.sort((x, y) => x.d - y.d);
    for (const c of cands) {
      if (made >= 2 || c.d > 9) break;
      if (c.b.dead || c.o.dead || !c.back.every(([a, cc]) => use[a][cc] === U.EMPTY)) continue;
      const cells = [c.b.cells[0], c.o.cells[0], ...c.back], f = c.b.f;
      unplace(c.b); unplace(c.o);
      place('house', made === 0 ? 8 : 7, cells, f); made++;
    }
  }
  const pairs = [];
  for (const b of buildings) {
    if (b.dead || b.type !== 'house' || b.cells.length !== 1) continue;
    const [i, j] = b.cells[0], lat = [b.f[1], b.f[0]];
    const o = houseAt(i + lat[0], j + lat[1]);
    if (!o || o.dead || o.f[0] !== b.f[0] || o.f[1] !== b.f[1] || o.y !== b.y) continue;
    pairs.push({ a: b, b: o, d: dPl(i, j) });
  }
  pairs.sort((a, b) => a.d - b.d);
  let duo = 0;
  for (const p of pairs) {
    if (duo >= 4 || p.d > 10) break;
    if (p.a.dead || p.b.dead) continue;
    const cells = [p.a.cells[0], p.b.cells[0]], f = p.a.f;
    unplace(p.a); unplace(p.b);
    place('house', 6, cells, f); duo++;
  }

  // ---------------- 留一座橋給玩家觸發：最遠那座橋的對岸先清空
  const reserved = new Set();
  {
    const cand = sites.map((s) => ({ s, d: dPl(s.r[0], s.r[1]) })).sort((a, b) => b.d - a.d);
    for (const { s } of cand) {
      const far = dPl(s.a[0], s.a[1]) > dPl(s.b[0], s.b[1]) ? s.a : s.b, nr = far === s.a ? s.b : s.a;
      const victims = buildings.filter((b) => !b.dead && b.cells.some(([i, j]) => { const df = Math.hypot(i - far[0], j - far[1]), dn = Math.hypot(i - nr[0], j - nr[1]); return df <= 2.9 && df < dn; }));
      if (!victims.every((b) => b.type === 'house' && b.cells.length === 1 && b.tier <= 4)) continue;
      for (const b of victims) { for (const [i, j] of b.cells) reserved.add(K(i, j)); unplace(b); }
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) reserved.add(K(far[0] + a, far[1] + b));
      s.reserved = true;
      break;
    }
  }
  // ---------------- 農田與牧場
  const fields = [];
  const fieldTypes = ['wheat', 'wheat', 'veg', 'lavender', 'vine', 'pasture', 'pasture', 'wheat'];
  for (let tries = 0; tries < 400 && fields.reduce((a, f) => a + f.cells.length, 0) < 48; tries++) {
    const i = r.int(T.E + 1, T.E + T.N - 2), j = r.int(T.E + 1, T.E + T.N - 2);
    if (kind[i][j] !== LAND || use[i][j] !== U.EMPTY || dPl(i, j) < 6.5 || T.isBeach(i, j) || lev[i][j] > 5 || rd[i][j] < 1 || reserved.has(K(i, j))) continue;
    let nearRoad = false; for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) if (roadish(i + a, j + b)) nearRoad = true;
    if (!nearRoad && r() < 0.7) continue;
    const type = r.pick(fieldTypes), size = r.int(2, 6), cl = [[i, j]], L = lev[i][j];
    use[i][j] = U.FIELD;
    for (let k = 0; k < 30 && cl.length < size; k++) {
      const [a, b] = r.pick(cl), [di, dj] = r.pick(DIRS), x = a + di, y = b + dj;
      if (T.inPlay(x, y) && kind[x][y] === LAND && use[x][y] === U.EMPTY && lev[x][y] === L && dPl(x, y) >= 6 && !reserved.has(K(x, y))) { use[x][y] = U.FIELD; cl.push([x, y]); }
    }
    const fid = fields.length;
    fields.push({ type, cells: cl, id: fid });
  }
  const fieldOf = new Map();
  for (const f of fields) for (const [i, j] of f.cells) fieldOf.set(K(i, j), f);

  // ---------------- 鎮內空地：後院、菜園、曬衣場、小草坪
  const yards = [];
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    if (!T.inPlay(i, j) || kind[i][j] !== LAND || use[i][j] !== U.EMPTY || T.isBeach(i, j) || dPl(i, j) > 10 || reserved.has(K(i, j))) continue;
    let nearB = false; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (T.inb(i + a, j + b) && use[i + a][j + b] === U.BUILD) nearB = true;
    if (!nearB || lotFacing(i, j)) continue;
    const t = r.pick(['orchard', 'orchard', 'veg', 'laundry', 'meadow', 'meadow', 'shed']);
    yards.push({ i, j, type: t });
    use[i][j] = U.FIELD;
  }
  // ---------------- 樹
  const trees = [];
  for (const y of yards) if (y.type === 'orchard' || y.type === 'meadow') {
    const n = y.type === 'orchard' ? r.int(2, 3) : r.int(0, 1);
    for (let k = 0; k < n; k++) trees.push({ x: T.wx(y.i) + (r() - 0.5) * 0.6, y: lev[y.i][y.j] * LH, z: T.wz(y.j) + (r() - 0.5) * 0.6, kind: r() < 0.25 ? 'blossom' : r() < 0.2 ? 'poplar' : 'round', s: 0.6 + r() * 0.3, rot: r() * PI * 2 });
  }
  const ox = T.ox, oz = T.oz;
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    if (kind[i][j] !== LAND || use[i][j] !== U.EMPTY || T.isBeach(i, j) || reserved.has(K(i, j)) || lotFacing(i, j)) continue;
    const d = dPl(i, j);
    const forest = fbm(i * 0.14 + ox + 9, j * 0.14 + oz - 4);
    let p = smooth(0.42, 0.62, forest) * 0.9 + 0.12;
    if (d < 6) p *= 0.35;
    if (!T.inPlay(i, j)) p = Math.min(1, p + 0.25);
    if (r() > p) continue;
    const n = 1 + Math.floor(r() * (d < 6 ? 1.5 : 3.2));
    const y = lev[i][j] * LH;
    for (let k = 0; k < n; k++) {
      const x = T.wx(i) + (r() - 0.5) * 0.72, z = T.wz(j) + (r() - 0.5) * 0.72;
      const hi = lev[i][j] >= 4 || forest > 0.6;
      const rr = r();
      const kindT = hi ? (rr < 0.65 ? 'pine' : 'round') : rr < 0.18 ? 'pine' : rr < 0.32 ? 'poplar' : rr < 0.4 ? 'blossom' : rr < 0.47 ? 'autumn' : 'round';
      trees.push({ x, y, z, kind: kindT, s: 0.75 + r() * 0.5, rot: r() * PI * 2 });
    }
  }

  // 河邊、田邊的燈與裝飾用資料
  const town = { use, bld, gen, buildings, sites, plaza, fields, fieldOf, trees, dock, yards, rd, dPl, roadish, lotFacing, place, unplace, houseAt, needsAt, services: () => buildings.filter((b) => !b.dead && b.type !== 'house'), r };
  for (const s of sites) s.active = siteActive(T, town, s);
  return town;
}

// 兩岸各有一棟建築靠近橋址，橋才會蓋
export function siteActive(T, town, s) {
  let A = false, B = false;
  for (const b of town.buildings) {
    if (b.dead) continue;
    for (const [i, j] of b.cells) {
      const da = Math.hypot(i - s.a[0], j - s.a[1]), db = Math.hypot(i - s.b[0], j - s.b[1]);
      if (da <= 2.9 && da < db) A = true;
      if (db <= 2.9 && db < da) B = true;
    }
  }
  return A && B;
}

// ---------------------------------------------------------------- 網格：路、廣場、階梯、田、碼頭
export function buildTownMeshes(T, town) {
  const { MM, lev } = T;
  const { use } = town;
  const S = [], W = [], lamps = [];
  const pave = ['#e8dcc0', '#dccfae', '#d2c3a0', '#e2d5b6', '#cdbd99'];
  const rs = makeRng(91);
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    const u = use[i][j];
    if (u !== U.ROAD) continue;
    const x = T.wx(i), z = T.wz(j), t = lev[i][j] * LH;
    S.push(P(bx(1.0, 0.03, 1.0), '#cbbd9e', { x, y: t + 0.015, z }));
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
      if (rs() < 0.25) continue;
      S.push(P(bx(0.2 + rs() * 0.03, 0.02, 0.2 + rs() * 0.03), pave[Math.floor(rs() * pave.length)], { x: x - 0.375 + a * 0.25 + (rs() - 0.5) * 0.03, y: t + 0.035, z: z - 0.375 + b * 0.25 + (rs() - 0.5) * 0.03, ry: (rs() - 0.5) * 0.15, j: 0.08 }));
    }
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      const nb = T.inb(a, b) ? use[a][b] : 0;
      const connected = nb === U.ROAD || nb === U.PLAZA || (nb === U.SITE);
      if (connected && lev[a][b] === lev[i][j]) continue;
      if (connected && lev[a][b] === lev[i][j] + 1) { // 往上一層：在這格靠那邊蓋階梯
        const steps = 6;
        for (let k = 0; k < steps; k++) {
          const h = LH * (k + 1) / steps, dd = 0.075;
          const off = 0.5 - (steps - k - 0.5) * dd;
          S.push(P(bx(dj ? 0.72 : dd, h, dj ? dd : 0.72), k % 2 ? '#d9cdb5' : '#cfc2a8', { x: x + di * off, y: t + h / 2 + 0.03, z: z + dj * off }));
        }
        continue;
      }
      if (connected && lev[a][b] === lev[i][j] - 1) continue;
      S.push(P(bx(dj ? 1.0 : 0.06, 0.05, dj ? 0.06 : 1.0), '#e9e1cf', { x: x + di * 0.47, y: t + 0.04, z: z + dj * 0.47 }));
    }
    if (hash2(i * 1.7, j * 2.3) < 0.3) {
      // 路燈放在不靠路的那一角
      let lx = 0.4, lz = 0.4;
      if (T.inb(i + 1, j) && (use[i + 1][j] === U.ROAD || use[i + 1][j] === U.PLAZA)) lx = -0.4;
      if (T.inb(i, j + 1) && (use[i][j + 1] === U.ROAD || use[i][j + 1] === U.PLAZA)) lz = -0.4;
      S.push(P(new THREE.CylinderGeometry(0.014, 0.02, 0.42, 6), '#3b3944', { x: x + lx, y: t + 0.24, z: z + lz }));
      S.push(P(new THREE.ConeGeometry(0.04, 0.035, 4), '#3b3944', { x: x + lx, y: t + 0.5, z: z + lz, ry: PI / 4 }));
      W.push(P(bx(0.05, 0.065, 0.05), '#fff', { x: x + lx, y: t + 0.455, z: z + lz }));
      lamps.push(new THREE.Vector3(x + lx, t + 0.44, z + lz));
    }
  }
  // 廣場：同心圓鋪石
  {
    const [pi, pj] = town.plaza, x0 = T.wx(pi), z0 = T.wz(pj), t = lev[pi][pj] * LH;
    S.push(P(bx(3.0, 0.03, 3.0), '#c9bb9b', { x: x0, y: t + 0.015, z: z0 }));
    const ring = ['#ece3cf', '#d9caa8', '#e4d7bb', '#c9b993'];
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) {
      const x = x0 - 1.375 + a * 0.25, z = z0 - 1.375 + b * 0.25;
      const rr = Math.hypot(x - x0, z - z0);
      S.push(P(bx(0.235, 0.02, 0.235), ring[Math.floor(rr / 0.36) % ring.length], { x, y: t + 0.035, z, j: 0.06 }));
    }
    for (const [dx, dz] of [[-1.35, -1.35], [1.35, -1.35], [-1.35, 1.35], [1.35, 1.35]]) {
      S.push(P(new THREE.CylinderGeometry(0.014, 0.02, 0.46, 6), '#3b3944', { x: x0 + dx, y: t + 0.26, z: z0 + dz }));
      S.push(P(new THREE.ConeGeometry(0.045, 0.04, 4), '#3b3944', { x: x0 + dx, y: t + 0.54, z: z0 + dz, ry: PI / 4 }));
      W.push(P(bx(0.055, 0.07, 0.055), '#fff', { x: x0 + dx, y: t + 0.49, z: z0 + dz }));
      lamps.push(new THREE.Vector3(x0 + dx, t + 0.48, z0 + dz));
    }
  }
  // 田與牧場
  const fr = makeRng(17);
  for (const f of town.fields) {
    for (const [i, j] of f.cells) {
      const x = T.wx(i), z = T.wz(j), t = lev[i][j] * LH;
      const same = (a, b) => town.fieldOf.get(a * 1000 + b) === f;
      if (f.type !== 'pasture') S.push(P(bx(0.96, 0.03, 0.96), '#8b6a4a', { x, y: t + 0.015, z }));
      const alongX = (i + j) % 2 === 0 ? false : (f.id % 2 === 0);
      for (let k = 0; k < 6; k++) {
        const o = -0.4 + k * 0.16;
        const px = alongX ? x : x + o, pz = alongX ? z + o : z;
        const w = alongX ? 0.88 : 0.11, d = alongX ? 0.11 : 0.88;
        if (f.type === 'wheat') S.push(P(bx(w, 0.13, d), ['#c9962f', '#f0cf6e'], { x: px, y: t + 0.09, z: pz, j: 0.06 }));
        else if (f.type === 'lavender') S.push(P(rbx(w, 0.1, d, 0.04, 1), ['#6a5a98', '#a991d6'], { x: px, y: t + 0.08, z: pz }));
        else if (f.type === 'vine') {
          S.push(P(bx(alongX ? 0.86 : 0.07, 0.13, alongX ? 0.07 : 0.86), ['#3f7a3a', '#6ea552'], { x: px, y: t + 0.1, z: pz }));
          for (const s of [-0.4, 0, 0.4]) S.push(P(bx(0.015, 0.17, 0.015), '#7a5a3c', { x: px + (alongX ? s : 0), y: t + 0.1, z: pz + (alongX ? 0 : s) }));
        } else if (f.type === 'veg') for (let q = 0; q < 6; q++) S.push(P(new THREE.IcosahedronGeometry(0.055, 1), ['#4f8f3f', '#9fd27a'], { x: alongX ? x - 0.4 + q * 0.16 : px, y: t + 0.07, z: alongX ? pz : z - 0.4 + q * 0.16 }));
      }
      // 邊界：田用樹籬，牧場用木圍欄
      for (const [di, dj] of DIRS) {
        if (same(i + di, j + dj)) continue;
        const ex = x + di * 0.47, ez = z + dj * 0.47;
        if (f.type === 'pasture') {
          for (let q = 0; q <= 6; q++) { const o = -0.48 + q * 0.16; S.push(P(bx(0.025, 0.12, 0.025), '#9a7650', { x: ex + (dj ? o : 0), y: t + 0.06, z: ez + (di ? o : 0) })); }
          for (const yy of [0.05, 0.1]) S.push(P(bx(dj ? 0.98 : 0.014, 0.014, dj ? 0.014 : 0.98), '#9a7650', { x: ex, y: t + yy, z: ez }));
        } else S.push(P(rbx(dj ? 1.0 : 0.09, 0.1, dj ? 0.09 : 1.0, 0.04, 1), ['#4f8a42', '#6aa552'], { x: ex, y: t + 0.05, z: ez }));
      }
      if (f.type === 'wheat' && fr() < 0.25) {
        const hx = x + (fr() - 0.5) * 0.5, hz = z + (fr() - 0.5) * 0.5;
        S.push(P(new THREE.CylinderGeometry(0.07, 0.07, 0.1, 10), ['#d9b25a', '#f0d27a'], { x: hx, y: t + 0.2, z: hz, rx: PI / 2 }));
      }
      if (f.type !== 'pasture' && fr() < 0.12) {
        const sx = x + 0.3, sz = z - 0.3;
        S.push(P(bx(0.015, 0.26, 0.015), '#7a5a3c', { x: sx, y: t + 0.13, z: sz }));
        S.push(P(bx(0.16, 0.015, 0.015), '#7a5a3c', { x: sx, y: t + 0.2, z: sz }));
        S.push(P(bx(0.06, 0.08, 0.04), '#b35a3c', { x: sx, y: t + 0.19, z: sz }));
        S.push(P(new THREE.ConeGeometry(0.06, 0.04, 8), '#d9b25a', { x: sx, y: t + 0.28, z: sz }));
      }
    }
  }
  // 鎮內空地的小景
  const yr = makeRng(23);
  const FLW = ['#ff8fb0', '#ffe066', '#ffffff', '#c7a6ff', '#ff9a5a'];
  const yardMeshes = new Map();
  for (const y of town.yards) {
    const x = T.wx(y.i), z = T.wz(y.j), t = lev[y.i][y.j] * LH;
    const S0 = S.length;
    if (y.type === 'veg') {
      S.push(P(bx(0.7, 0.03, 0.62), '#8b6a4a', { x, y: t + 0.015, z }));
      for (let k = 0; k < 4; k++) for (let q = 0; q < 4; q++) S.push(P(new THREE.IcosahedronGeometry(0.05, 1), ['#4f8f3f', '#9fd27a'], { x: x - 0.26 + k * 0.17, y: t + 0.06, z: z - 0.22 + q * 0.15 }));
      for (const sd of [-1, 1]) S.push(P(bx(0.8, 0.07, 0.015), '#9a7650', { x, y: t + 0.035, z: z + sd * 0.36 }));
    } else if (y.type === 'laundry') {
      for (const sd of [-1, 1]) S.push(P(bx(0.02, 0.26, 0.02), '#7a5a3c', { x: x + sd * 0.32, y: t + 0.13, z }));
      S.push(P(bx(0.64, 0.006, 0.006), '#e6e0d4', { x, y: t + 0.25, z }));
      for (let k = 0; k < 5; k++) S.push(P(bx(0.08, 0.1 + yr() * 0.05, 0.008), yr.pick(['#fdfbf6', '#a8c6e0', '#e8b4b8', '#f6e3a6', '#c6dbb4']), { x: x - 0.24 + k * 0.12, y: t + 0.19, z }));
      for (let k = 0; k < 6; k++) S.push(P(new THREE.IcosahedronGeometry(0.02, 0), yr.pick(FLW), { x: x + (yr() - 0.5) * 0.8, y: t + 0.02, z: z + (yr() - 0.5) * 0.8 }));
    } else if (y.type === 'shed') {
      S.push(P(bx(0.34, 0.2, 0.26), '#8a6244', { x: x - 0.15, y: t + 0.1, z: z - 0.15 }));
      const tri = new THREE.Shape([new THREE.Vector2(-0.17, 0), new THREE.Vector2(0.17, 0), new THREE.Vector2(0, 0.1)]);
      S.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.3, bevelEnabled: false }), '#a9553d', { x: x - 0.15, y: t + 0.2, z: z - 0.3, sx: 1.15 }));
      for (let k = 0; k < 3; k++) S.push(P(new THREE.CylinderGeometry(0.05, 0.05, 0.08, 8), '#d9b25a', { x: x + 0.2, y: t + 0.06 + k * 0.03, z: z + 0.15 - k * 0.05, rx: PI / 2 }));
      S.push(P(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 10), '#8a6040', { x: x + 0.25, y: t + 0.04, z: z - 0.25 }));
    } else {
      for (let k = 0; k < 14; k++) S.push(P(new THREE.IcosahedronGeometry(0.022, 0), yr.pick(FLW), { x: x + (yr() - 0.5) * 0.85, y: t + 0.02, z: z + (yr() - 0.5) * 0.85 }));
      for (let k = 0; k < 3; k++) S.push(P(new THREE.IcosahedronGeometry(0.06 + yr() * 0.04, 1), ['#4f8a42', '#7ab35a'], { x: x + (yr() - 0.5) * 0.7, y: t + 0.04, z: z + (yr() - 0.5) * 0.7, sy: 0.8 }));
    }
    const ym = new THREE.Mesh(merge(S.splice(S0)), M.std); ym.castShadow = true; ym.receiveShadow = true;
    yardMeshes.set(y.i * 1000 + y.j, ym);
  }
  town.yardMeshes = yardMeshes;
  // 碼頭棧橋
  const boats = [];
  if (town.dock) {
    const { i, j, di, dj } = town.dock;
    const x0 = T.wx(i) + di * 0.2, z0 = T.wz(j) + dj * 0.2;
    for (let k = 0; k < 13; k++) {
      const s = k * 0.18;
      S.push(P(bx(dj ? 0.42 : 0.16, 0.025, dj ? 0.16 : 0.42), k % 2 ? '#a07a54' : '#8f6b48', { x: x0 + di * s, y: 0.04, z: z0 + dj * s, j: 0.1 }));
    }
    for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
      const s = k * 0.55;
      S.push(P(new THREE.CylinderGeometry(0.022, 0.022, 0.32, 6), '#6e4c36', { x: x0 + di * s + dj * sd * 0.22, y: -0.08, z: z0 + dj * s + di * sd * 0.22 }));
    }
    for (let k = 0; k < 3; k++) boats.push({ x: x0 + di * (0.6 + k * 0.7) + dj * (k % 2 ? 0.45 : -0.45), z: z0 + dj * (0.6 + k * 0.7) + di * (k % 2 ? 0.45 : -0.45), ry: Math.atan2(di, dj), sail: k === 2 });
  }
  const g = new THREE.Group();
  for (const ym of yardMeshes.values()) g.add(ym);
  if (S.length) { const m = new THREE.Mesh(merge(S), M.std); m.castShadow = true; m.receiveShadow = true; g.add(m); }
  if (W.length) g.add(new THREE.Mesh(merge(W), M.win));
  return { group: g, lamps, boats };
}

// 石拱橋（跨過一格河道）
export function makeBridge(T, s) {
  const { lev } = T;
  const ya = lev[s.a[0]][s.a[1]] * LH + 0.03, yb = lev[s.b[0]][s.b[1]] * LH + 0.03;
  const wy = T.waterY(s.r[0], s.r[1]), bedY = T.topY(s.r[0], s.r[1]);
  const parts = [], glow = [], lamps = [];
  const n = 16, L = 1.5;
  const st = ['#d9cdb5', '#cfc2a8', '#e0d5bf'];
  for (let k = 0; k < n; k++) {
    const u = (k + 0.5) / n, x = -L / 2 + u * L;
    const base = lerp(ya, yb, u), deck = base + 0.17 * Math.sin(u * PI);
    const half = 0.42, inArch = Math.abs(x) < half;
    const yIn = inArch ? wy + 0.22 * Math.sqrt(1 - (x / half) ** 2) : bedY;
    const h = deck - 0.03 - yIn;
    if (h > 0.01) parts.push(P(bx(L / n + 0.002, h, 0.62), st[k % 3], { x, y: yIn + h / 2, z: 0 }));
    parts.push(P(bx(L / n + 0.004, 0.035, 0.66), '#e6dccb', { x, y: deck - 0.012, z: 0 }));
    for (const sd of [-1, 1]) parts.push(P(bx(L / n + 0.004, 0.09, 0.06), st[(k + 1) % 3], { x, y: deck + 0.04, z: sd * 0.31 }));
  }
  for (const sd of [-1, 1]) {
    parts.push(P(bx(0.035, 0.42, 0.035), '#3b3944', { x: sd * 0.68, y: (sd < 0 ? ya : yb) + 0.21, z: 0.3 }));
    glow.push(P(bx(0.055, 0.065, 0.055), '#fff', { x: sd * 0.68, y: (sd < 0 ? ya : yb) + 0.45, z: 0.3 }));
    lamps.push(new THREE.Vector3(sd * 0.68, (sd < 0 ? ya : yb) + 0.44, 0.3));
  }
  const g = new THREE.Group();
  const m = new THREE.Mesh(merge(parts), M.std); m.castShadow = true; m.receiveShadow = true;
  g.add(m, new THREE.Mesh(merge(glow), M.win));
  g.position.set(T.wx(s.r[0]), 0, T.wz(s.r[1]));
  g.rotation.y = Math.atan2(s.dj, s.di) * -1;
  g.userData.lampsLocal = lamps;
  return g;
}
