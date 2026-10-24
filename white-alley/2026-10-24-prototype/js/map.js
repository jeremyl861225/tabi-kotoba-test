// 地圖：建物輪廓 → 高度格（碰撞、彈道、視線）＋導航格（A*）＋出生點（石堆位置仍會算，但遊戲已不用）。
// 不碰 Three 與 DOM，node 也能跑。座標：x 向東、z 向南、y 向上，單位公尺。
import { CFG } from './config.js';
import { obstacleBoxes, planObstacles } from './arch.js';

export const CS = 0.25;   // 高度格
export const NS = 0.5;    // 導航格
const PAD = 8;            // 高度格在可玩範圍外多留的邊（石頭飛出去還能撞牆）
export const WATER = 0.02; // 水面（河、噴水池）在高度格裡的值：走不過去、擋不住石頭與視線

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GameMap {
  constructor(data, seed = 7) {
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    const p = (this.play = data.play);
    this.buildings = data.buildings.map((b) => {
      const pts = [];
      for (let i = 0; i < b.p.length; i += 2) pts.push([b.p[i], b.p[i + 1]]);
      return { h: b.h, pts };
    });

    this.gx0 = p.minX - PAD;
    this.gz0 = p.minZ - PAD;
    this.gw = Math.ceil((p.maxX - p.minX + 2 * PAD) / CS);
    this.gh = Math.ceil((p.maxZ - p.minZ + 2 * PAD) / CS);
    this.hgt = new Float32Array(this.gw * this.gh);
    for (const b of this.buildings) this._raster(b);
    // 河、池、噴水池：只寫進還是空地的格子（不蓋掉建物）
    for (const flat of data.sea || []) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      this._raster({ pts, h: WATER });
    }
    // 外樓梯、矮凳、機車：先有建物才知道哪面牆外面是巷子
    this.obstacles = planObstacles(data, (x, z) => this.heightAt(x, z));
    for (const o of this.obstacles) for (const box of obstacleBoxes(o)) this._raster(box);

    this._buildNav();
    this._place(mulberry32(seed));
    this._bases(mulberry32(seed + 1));
  }

  // 掃描線填多邊形，每格取最高的建物
  _raster(b) {
    const { pts, h } = b;
    let minZ = Infinity, maxZ = -Infinity;
    for (const [, z] of pts) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
    const iz0 = Math.max(0, Math.floor((minZ - this.gz0) / CS));
    const iz1 = Math.min(this.gh - 1, Math.floor((maxZ - this.gz0) / CS));
    const xs = [];
    for (let iz = iz0; iz <= iz1; iz++) {
      const z = this.gz0 + (iz + 0.5) * CS;
      xs.length = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, zi] = pts[i], [xj, zj] = pts[j];
        if ((zi > z) !== (zj > z)) xs.push(xi + ((z - zi) / (zj - zi)) * (xj - xi));
      }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const ix0 = Math.max(0, Math.ceil((xs[k] - this.gx0) / CS - 0.5));
        const ix1 = Math.min(this.gw - 1, Math.floor((xs[k + 1] - this.gx0) / CS - 0.5));
        const row = iz * this.gw;
        for (let ix = ix0; ix <= ix1; ix++) if (this.hgt[row + ix] < h) this.hgt[row + ix] = h;
      }
    }
  }

  isWater(x, z) { const h = this.heightAt(x, z); return h > 0 && h <= WATER + 1e-6; }

  heightAt(x, z) {
    const ix = Math.floor((x - this.gx0) / CS), iz = Math.floor((z - this.gz0) / CS);
    if (ix < 0 || iz < 0 || ix >= this.gw || iz >= this.gh) return 0;
    return this.hgt[iz * this.gw + ix];
  }

  inGrid(x, z) {
    return x >= this.gx0 && z >= this.gz0 && x < this.gx0 + this.gw * CS && z < this.gz0 + this.gh * CS;
  }

  // 圓形人物推出建物＋限制在可玩範圍
  collide(o, r = CFG.R) {
    const { gx0, gz0, gw, gh, hgt } = this;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const ix0 = Math.max(0, Math.floor((o.x - r - gx0) / CS)), ix1 = Math.min(gw - 1, Math.floor((o.x + r - gx0) / CS));
      const iz0 = Math.max(0, Math.floor((o.z - r - gz0) / CS)), iz1 = Math.min(gh - 1, Math.floor((o.z + r - gz0) / CS));
      for (let iz = iz0; iz <= iz1; iz++) {
        for (let ix = ix0; ix <= ix1; ix++) {
          if (hgt[iz * gw + ix] <= 0) continue;
          const bx0 = gx0 + ix * CS, bz0 = gz0 + iz * CS;
          const qx = Math.max(bx0, Math.min(o.x, bx0 + CS)), qz = Math.max(bz0, Math.min(o.z, bz0 + CS));
          const dx = o.x - qx, dz = o.z - qz, d2 = dx * dx + dz * dz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-10) {
            const d = Math.sqrt(d2), push = r - d;
            o.x += (dx / d) * push; o.z += (dz / d) * push;
          } else {
            // 中心已在格子裡：往最近的格邊推
            const l = o.x - bx0, rr = bx0 + CS - o.x, t = o.z - bz0, b = bz0 + CS - o.z;
            const m = Math.min(l, rr, t, b);
            if (m === l) o.x = bx0 - r; else if (m === rr) o.x = bx0 + CS + r; else if (m === t) o.z = bz0 - r; else o.z = bz0 + CS + r;
          }
          moved = true;
        }
      }
      if (!moved) break;
    }
    const p = this.play;
    o.x = Math.max(p.minX + r, Math.min(p.maxX - r, o.x));
    o.z = Math.max(p.minZ + r, Math.min(p.maxZ - r, o.z));
  }

  // 兩點之間有沒有被建物擋住（直線、含高度）
  los(ax, ay, az, bx, by, bz) {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const n = Math.max(1, Math.ceil(len / 0.2));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      if (this.heightAt(ax + dx * t, az + dz * t) > ay + dy * t) return false;
    }
    return true;
  }

  // ---------- 導航 ----------
  _buildNav() {
    const p = this.play;
    this.nw = Math.floor((p.maxX - p.minX) / NS);
    this.nh = Math.floor((p.maxZ - p.minZ) / NS);
    const N = this.nw * this.nh;
    const walk = new Uint8Array(N);
    const CL = CFG.R + 0.05;
    for (let j = 0; j < this.nh; j++) {
      for (let i = 0; i < this.nw; i++) {
        const cx = p.minX + (i + 0.5) * NS, cz = p.minZ + (j + 0.5) * NS;
        if (cx < p.minX + CFG.R || cx > p.maxX - CFG.R || cz < p.minZ + CFG.R || cz > p.maxZ - CFG.R) continue;
        let ok = true;
        const ix0 = Math.floor((cx - CL - this.gx0) / CS), ix1 = Math.floor((cx + CL - this.gx0) / CS);
        const iz0 = Math.floor((cz - CL - this.gz0) / CS), iz1 = Math.floor((cz + CL - this.gz0) / CS);
        for (let iz = iz0; iz <= iz1 && ok; iz++) {
          for (let ix = ix0; ix <= ix1; ix++) {
            if (this.hgt[iz * this.gw + ix] <= 0) continue;
            const bx0 = this.gx0 + ix * CS, bz0 = this.gz0 + iz * CS;
            const qx = Math.max(bx0, Math.min(cx, bx0 + CS)), qz = Math.max(bz0, Math.min(cz, bz0 + CS));
            if ((cx - qx) ** 2 + (cz - qz) ** 2 < CL * CL) { ok = false; break; }
          }
        }
        if (ok) walk[j * this.nw + i] = 1;
      }
    }
    // 只留最大的連通區（圍起來的中庭走不進去）
    const comp = new Int32Array(N).fill(-1);
    let best = -1, bestSize = 0, cid = 0;
    const q = new Int32Array(N);
    for (let s = 0; s < N; s++) {
      if (!walk[s] || comp[s] >= 0) continue;
      let qh = 0, qt = 0;
      q[qt++] = s; comp[s] = cid;
      while (qh < qt) {
        const c = q[qh++], ci = c % this.nw, cj = (c / this.nw) | 0;
        for (const [di, dj] of DIR4) {
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= this.nw || nj >= this.nh) continue;
          const n = nj * this.nw + ni;
          if (walk[n] && comp[n] < 0) { comp[n] = cid; q[qt++] = n; }
        }
      }
      if (qt > bestSize) { bestSize = qt; best = cid; }
      cid++;
    }
    this.reach = new Uint8Array(N);
    this.reachList = [];
    for (let s = 0; s < N; s++) if (comp[s] === best) { this.reach[s] = 1; this.reachList.push(s); }
    this.walkArea = this.reachList.length * NS * NS;
    // A* 用的暫存
    this._g = new Float32Array(N);
    this._from = new Int32Array(N);
    this._stamp = new Uint32Array(N);
    this._closed = new Uint32Array(N);
    this._gen = 0;
  }

  navIndex(x, z) {
    const i = Math.floor((x - this.play.minX) / NS), j = Math.floor((z - this.play.minZ) / NS);
    if (i < 0 || j < 0 || i >= this.nw || j >= this.nh) return -1;
    return j * this.nw + i;
  }
  navCenter(n) {
    return { x: this.play.minX + ((n % this.nw) + 0.5) * NS, z: this.play.minZ + (((n / this.nw) | 0) + 0.5) * NS };
  }
  isReach(x, z) {
    const n = this.navIndex(x, z);
    return n >= 0 && this.reach[n] === 1;
  }
  nearestReach(x, z, maxR = 14) {
    const ci = Math.floor((x - this.play.minX) / NS), cj = Math.floor((z - this.play.minZ) / NS);
    for (let r = 0; r <= maxR; r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= this.nw || j >= this.nh) continue;
          const n = j * this.nw + i;
          if (!this.reach[n]) continue;
          const d = di * di + dj * dj;
          if (d < bd) { bd = d; best = n; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
  randomReach(rng) {
    return this.navCenter(this.reachList[Math.floor(rng() * this.reachList.length)]);
  }

  // 直線上每 0.25 m 都可走
  walkLine(ax, az, bx, bz) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (!this.isReach(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(sx, sz, tx, tz, maxExpand = 60000) {
    const s = this.nearestReach(sx, sz), t = this.nearestReach(tx, tz);
    if (s < 0 || t < 0) return null;
    if (s === t) return [this.navCenter(t)];
    const { nw, nh, reach, _g: g, _from: from, _stamp: stamp, _closed: closed } = this;
    const gen = ++this._gen;
    const ti = t % nw, tj = (t / nw) | 0;
    const hfun = (n) => {
      const dx = Math.abs((n % nw) - ti), dz = Math.abs(((n / nw) | 0) - tj);
      return (Math.max(dx, dz) + 0.41421356 * Math.min(dx, dz)) * 1.6;   // 加權 A*：路線稍繞但快很多
    };
    const heap = new MinHeap();
    stamp[s] = gen; g[s] = 0; from[s] = -1;
    heap.push(s, hfun(s));
    let found = false, expand = 0;
    while (heap.size) {
      const c = heap.pop();
      if (closed[c] === gen) continue;
      closed[c] = gen;
      if (c === t) { found = true; break; }
      if (++expand > maxExpand) break;
      const ci = c % nw, cj = (c / nw) | 0;
      for (let k = 0; k < 8; k++) {
        const [di, dj] = DIR8[k];
        const ni = ci + di, nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nw || nj >= nh) continue;
        const n = nj * nw + ni;
        if (!reach[n] || closed[n] === gen) continue;
        if (di && dj && (!reach[cj * nw + ni] || !reach[nj * nw + ci])) continue;   // 不切牆角
        const ng = g[c] + (di && dj ? 1.41421356 : 1);
        if (stamp[n] !== gen || ng < g[n]) {
          stamp[n] = gen; g[n] = ng; from[n] = c;
          heap.push(n, ng + hfun(n));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = t; c !== -1; c = from[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.navCenter(c));
    // 拉直：能直走就跳過中間點
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = Math.min(pts.length - 1, i + 48);
      while (j > i + 1 && !this.walkLine(pts[i].x, pts[i].z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]);
      i = j;
    }
    return out;
  }

  // ---------- 出生點、石堆 ----------
  _place(rng) {
    const pick = (k, avoid = [], minD = 0) => {
      const L = this.reachList;
      const cx = new Float32Array(L.length), cz = new Float32Array(L.length), d = new Float32Array(L.length).fill(1e9);
      for (let i = 0; i < L.length; i++) { const c = this.navCenter(L[i]); cx[i] = c.x; cz[i] = c.z; }
      // 偏好空間寬一點的格子：周圍 1 m 內都可走
      const open = (i) => {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.isReach(cx[i] + dx, cz[i] + dz)) return false;
        return true;
      };
      for (const a of avoid) for (let i = 0; i < L.length; i++) d[i] = Math.min(d[i], (cx[i] - a.x) ** 2 + (cz[i] - a.z) ** 2);
      const out = [];
      let first = Math.floor(rng() * L.length);
      for (let tries = 0; tries < 200 && !open(first); tries++) first = Math.floor(rng() * L.length);
      if (!avoid.length) out.push({ x: cx[first], z: cz[first] });
      const upd = (p) => { for (let i = 0; i < L.length; i++) d[i] = Math.min(d[i], (cx[i] - p.x) ** 2 + (cz[i] - p.z) ** 2); };
      out.forEach(upd);
      while (out.length < k) {
        let bi = -1, bd = -1;
        for (let i = 0; i < L.length; i++) if (d[i] > bd && open(i)) { bd = d[i]; bi = i; }
        if (bi < 0 || bd < minD * minD) break;
        const p = { x: cx[bi], z: cz[bi] };
        out.push(p); upd(p);
      }
      return out;
    };
    this.spawns = pick(16);
    const nPiles = Math.max(8, Math.min(18, Math.round(this.walkArea / 900)));
    this.piles = pick(nPiles, this.spawns, 4);
  }
}

// ---------- 水晶戰的兩個基地 ----------
// 沿可玩範圍的長邊，兩端附近各找一塊夠開闊的空地（四周 2 m 內都能走）放水晶，旁邊再挑 6 個出生點。
// 純看地圖資料、固定亂數，房主與客人算出來的一樣。
GameMap.prototype._bases = function (rng) {
  const { nw, nh, reach, reachList } = this;
  // 每格離最近的「走不到」有幾格（4 鄰距離轉換）
  const dist = new Int16Array(nw * nh).fill(-1);
  const q = new Int32Array(nw * nh);
  let qh = 0, qt = 0;
  for (let n = 0; n < nw * nh; n++) if (!reach[n]) { dist[n] = 0; q[qt++] = n; }
  while (qh < qt) {
    const c = q[qh++], ci = c % nw, cj = (c / nw) | 0;
    for (const [di, dj] of DIR4) {
      const ni = ci + di, nj = cj + dj;
      if (ni < 0 || nj < 0 || ni >= nw || nj >= nh) continue;
      const m = nj * nw + ni;
      if (dist[m] < 0) { dist[m] = dist[c] + 1; q[qt++] = m; }
    }
  }
  this.clear = dist;
  const p = this.play, long = p.maxX - p.minX >= p.maxZ - p.minZ;
  const along = (c) => (long ? c.x : c.z), across = (c) => (long ? c.z : c.x);
  const mid = long ? (p.minZ + p.maxZ) / 2 : (p.minX + p.maxX) / 2;
  // 不放在最邊緣：離長邊兩端各 14% 處（走路距離太長的話，進攻的人永遠走不到）
  const lo = long ? p.minX : p.minZ, hi = long ? p.maxX : p.maxZ, aim = (sign) => (sign > 0 ? lo + (hi - lo) * 0.14 : hi - (hi - lo) * 0.14);
  const pickEnd = (sign) => {
    for (const need of [5, 4, 3]) {
      let best = null, bs = Infinity;
      for (const n of reachList) {
        if (dist[n] < need) continue;
        const c = this.navCenter(n);
        const s = Math.abs(along(c) - aim(sign)) + 0.35 * Math.abs(across(c) - mid);
        if (s < bs) { bs = s; best = c; }
      }
      if (best) return best;
    }
    return this.navCenter(reachList[0]);
  };
  // 地圖檔有預先挑好的位置（tools/pick_bases.mjs 用大量電腦對戰挑出兩邊勝率接近的一組）就用那組
  const fixed = this.data.bases;
  const A = fixed ? { x: fixed[0][0], z: fixed[0][1] } : pickEnd(1), B = fixed ? { x: fixed[1][0], z: fixed[1][1] } : pickEnd(-1);
  this.setBases(A, B, rng);
};

GameMap.prototype.setBases = function (A, B, rng = mulberry32(8)) {
  const { reachList } = this, dist = this.clear;
  // 出生點在自家水晶「後面」10–24 m（比水晶離敵方更遠）：復活要跑一段才能回防，進攻方打到水晶時才有空檔
  const spawnsNear = (b, foe) => {
    const dFoe = (c) => Math.hypot(c.x - foe.x, c.z - foe.z), bF = dFoe(b);
    let cand = [];
    for (const [r0, r1, behind] of [[10, 24, true], [8, 26, false], [5, 30, false]]) {
      cand = [];
      for (const n of reachList) {
        if (dist[n] < 2) continue;
        const c = this.navCenter(n), d = Math.hypot(c.x - b.x, c.z - b.z);
        if (d > r0 && d < r1 && (!behind || dFoe(c) > bF + 2)) cand.push(c);
      }
      if (cand.length >= 12) break;
    }
    const out = [];
    while (out.length < 5 && cand.length) {
      let bi = 0, bd = -1;
      for (let i = 0; i < cand.length; i++) {
        let d = 1e9;
        for (const o of out) d = Math.min(d, (cand[i].x - o.x) ** 2 + (cand[i].z - o.z) ** 2);
        if (!out.length) d = dFoe(cand[i]) + rng() * 0.01;
        if (d > bd) { bd = d; bi = i; }
      }
      out.push(cand.splice(bi, 1)[0]);
    }
    return out.length ? out : [b];
  };
  this.bases = [[A, B], [B, A]].map(([b, foe]) => ({ x: b.x, z: b.z, spawns: spawnsNear(b, foe) }));
};

const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (v[p] <= val) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const top = k[0];
    const lk = k.pop(), lv = v.pop();
    const n = k.length;
    if (n) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && v[c + 1] < v[c]) c++;
        if (v[c] >= lv) break;
        k[i] = k[c]; v[i] = v[c]; i = c;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}
