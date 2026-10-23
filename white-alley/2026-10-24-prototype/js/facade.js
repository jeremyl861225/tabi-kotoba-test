// 建築細節產生器：把每棟樓的輪廓長成有窗、有門、有女兒牆、有屋頂設備的白模。
// 純陣列輸出（不碰 Three），node 也能跑來量三角形數。
//   米克諾斯（cyclades）：圓角石灰牆、厚窗框＋窗台、百葉、木門＋門楣＋台階、煙囪、教堂圓頂與鐘牆、外樓梯、矮凳花台
//   台北（taipei）：樓層線、鋁窗＋鐵窗、冷氣、陽台、一樓鐵捲門＋招牌＋側招、頂樓加蓋、水塔、機車
// 依位置切成 32 m 的區塊，畫面可以逐塊剔除、遠處區塊只畫主體。
import { at, clearance, edgeFrame, openAt, ringOf, ringSign } from './arch.js';
import { mulberry32 } from './map.js';

export const CHUNK = 32;

// 顏色（乘在白色材質上）
const C = {
  wall: 1, roof: 0.965, trim: 1, under: 0.8,
  glass: [0.6, 0.65, 0.72], glassDeep: [0.5, 0.55, 0.62],
  door: [0.82, 0.79, 0.74], shutter: [0.9, 0.91, 0.93], rolling: [0.86, 0.87, 0.89],
  metal: [0.8, 0.82, 0.85], dark: [0.38, 0.4, 0.44], tank: [0.93, 0.94, 0.95],
};

class Buf {
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
function fbox(B, f, u0, u1, y0, y1, w0, w1, k, o = {}) {
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
function fpanel(B, f, u0, u1, y0, y1, w, k) {
  const P = (u, y) => { const [x, z] = at(f, u, w); return [x, y, z]; };
  B.quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1), [f.nx, 0, f.nz], k);
}

// 世界座標的軸對齊方塊／旋轉方塊（屋頂設備用）
function wbox(B, cx, cz, ux, uz, hu, hw, y0, y1, k, o = {}) {
  const f = { ax: cx - ux * hu + uz * hw, az: cz - uz * hu - ux * hw, ux, uz, nx: -uz, nz: ux, L: hu * 2 };
  // 上面這個 frame 的 w 方向是 (-uz, ux)；方塊從 w=0 到 2hw
  fbox(B, f, 0, hu * 2, y0, y1, 0, hw * 2, k, { back: true, ...o });
}

function cylinder(B, cx, cz, r, y0, y1, seg, k, caps = true) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r], p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
    const q0 = [p0[0], y1, p0[2]], q1 = [p1[0], y1, p1[2]];
    B.quad(p0, p1, q1, q0, [Math.cos(am), 0, Math.sin(am)], k);
    if (caps) B.tri([cx, y1, cz], q0, q1, [0, 1, 0], k, k, k);
  }
}

// 圓頂：經緯細分的半球（教堂）
function dome(B, cx, y0, cz, r, seg, rings, k) {
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
function flatPoly(list, ring, holes, y, k, up = true) { list.push({ ring, holes, y, k, up }); }

function centroid(pts) { let x = 0, z = 0; pts.forEach((p) => { x += p[0]; z += p[1]; }); return [x / pts.length, z / pts.length]; }
function distToRing(pts, x, z) {
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
    const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z));
  }
  return d;
}
function inRing(pts, x, z) {
  let ins = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i], [xj, zj] = pts[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}

export function buildCity(map) {
  const data = map.data;
  const style = data.style || 'cyclades';
  const heightAt = (x, z) => map.heightAt(x, z);
  const chunks = new Map();
  const chunk = (x, z) => {
    const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(key);
    if (!c) {
      c = { key, cx: (Math.floor(x / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(z / CHUNK) + 0.5) * CHUNK,
        body: new Buf(), cast: new Buf(), fine: new Buf(), grille: new Buf(true), polys: [] };
      chunks.set(key, c);
    }
    return c;
  };
  const lines = [];
  const wires = [];
  const tyo = style === 'taipei';
  const FH = tyo ? 3.2 : 3.1;
  const PH = tyo ? 1.1 : 0.34;   // 女兒牆高

  data.buildings.forEach((b, bi) => {
    const rng = mulberry32(bi * 7919 + 13);
    const ring = ringOf(b.r || b.p);
    const sg = ringSign(ring);
    const inset = b.i ? ringOf(b.i) : null;
    const [mx, mz] = centroid(ring);
    const ch = chunk(mx, mz);
    const H = b.h;
    const roofY = inset ? H - PH : H;
    const n = ring.length;
    const rows = H > 1.6 ? [0, 0.3, 1.4, H] : [0, H];
    const shade = H > 1.6 ? [0.74, 0.87, 0.975, 1] : [0.8, 1];

    // ---- 主體：牆（貼地漸暗＝接觸陰影）＋女兒牆頂＋屋頂 ----
    for (let i = 0; i < n; i++) {
      const f = edgeFrame(ring, i, sg);
      if (!(f.L > 1e-3)) continue;
      const P = (u, y) => { const [x, z] = at(f, u, 0); return [x, y, z]; };
      const N = [f.nx, 0, f.nz];
      for (let k = 0; k < rows.length - 1; k++) {
        ch.body.tri(P(0, rows[k]), P(f.L, rows[k]), P(f.L, rows[k + 1]), N, shade[k], shade[k], shade[k + 1]);
        ch.body.tri(P(0, rows[k]), P(f.L, rows[k + 1]), P(0, rows[k + 1]), N, shade[k], shade[k + 1], shade[k + 1]);
      }
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      lines.push(ax, H, az, bx, H, bz);
      if (tyo) {
        const [px, pz] = ring[(i - 1 + n) % n];
        const ex = ax - px, ez = az - pz, el = Math.hypot(ex, ez);
        if (el > 1e-3 && Math.abs((ex * (bx - ax) + ez * (bz - az)) / (el * f.L)) < 0.9) lines.push(ax, 0, az, ax, H, az);
      }
    }
    if (inset) {
      flatPoly(ch.polys, ring, [inset], H, C.roof);              // 女兒牆頂
      flatPoly(ch.polys, inset, [], roofY, C.roof * 0.97);       // 屋頂
      const isg = ringSign(inset);
      for (let i = 0; i < inset.length; i++) {                   // 女兒牆內側（面向屋頂）
        const f = edgeFrame(inset, i, -isg);
        if (!(f.L > 1e-3)) continue;
        const P = (u, y) => { const [x, z] = at(f, u, 0); return [x, y, z]; };
        ch.body.quad(P(0, roofY), P(f.L, roofY), P(f.L, H), P(0, H), [f.nx, 0, f.nz], 0.9);
      }
      if (!tyo) for (let i = 0; i < inset.length; i++) { const [ax, az] = inset[i], [bx, bz] = inset[(i + 1) % inset.length]; lines.push(ax, H, az, bx, H, bz); }
    } else flatPoly(ch.polys, ring, [], H, C.roof);

    // ---- 牆面細節（可玩範圍外的背景樓只留主體）----
    const pl = data.play, M = 10;
    if (mx < pl.minX - M || mx > pl.maxX + M || mz < pl.minZ - M || mz > pl.maxZ + M) return;
    const edges = [];
    for (let i = 0; i < n; i++) {
      const f = edgeFrame(ring, i, sg);
      if (f.L >= (tyo ? 2.2 : 1.5) && openAt(heightAt, f, f.L / 2, 0.7)) edges.push(f);
    }
    edges.sort((a, b2) => b2.L - a.L);
    if (tyo) { taipeiFacades(ch, b, edges, rng, heightAt, H, roofY, FH); overheadWires(wires, edges, rng, heightAt, H); }
    else cycladicFacades(ch, b, edges, rng, heightAt, H, FH);

    // ---- 屋頂設備 ----
    if (inset) {
      if (tyo) taipeiRoof(ch, b, inset, rng, roofY);
      else cycladicRoof(ch, b, inset, rng, roofY, H, edges);
    }
  });

  // ---- 會擋路的小物 ----
  for (const o of map.obstacles) {
    const [x, z] = at(o.f, (o.u0 + o.u1) / 2, 0.5);
    const ch = chunk(x, z);
    if (o.kind === 'stair') stair(ch.cast, o);
    else if (o.kind === 'bench' || o.kind === 'planter') bench(ch.cast, o);
    else if (o.kind === 'scooter') scooter(ch.cast, o);
  }

  return { chunks: [...chunks.values()], lines, wires };
}

// ======================= 米克諾斯 =======================
function cycladicFacades(ch, b, edges, rng, heightAt, H, FH) {
  const floors = Math.max(1, b.f);
  let doorPlaced = false;
  let balconyDone = false;
  for (const f of edges) {
    // 牆腳一圈刷白的矮邊（米克諾斯每面牆貼地都有）
    fbox(ch.fine, f, 0, f.L, 0, 0.16, 0, 0.07, 1, { ends: false });
    const used = [];   // 一樓已經佔掉的位置（門、窗）
    const fits = (u, w, list) => u - w / 2 > 0.45 && u + w / 2 < f.L - 0.45 && list.every(([a, c]) => u + w / 2 < a - 0.5 || u - w / 2 > c + 0.5)
      && openAt(heightAt, f, u, 0.7);
    // 門（每棟一扇主門，長牆再加一扇小門）
    if ((!doorPlaced && f.L >= 2.2) || (f.L > 6 && rng() < 0.3)) {
      const w = doorPlaced ? 0.85 : 1.0, u = w / 2 + 0.5 + rng() * (f.L - w - 1);
      if (fits(u, w, used)) { door(ch, f, u, w, 2.1 + (doorPlaced ? 0 : 0.1), rng); used.push([u - w / 2, u + w / 2]); doorPlaced = true; }
    }
    // 二樓的木陽台（一棟最多一個）
    if (!balconyDone && floors >= 2 && f.L >= 3.4 && rng() < 0.3 && clearance(heightAt, f, f.L / 2) > 3.2) {
      const w = Math.min(2.6, f.L - 1.2), u = f.L / 2 + (rng() - 0.5) * (f.L - w - 1);
      cycBalcony(ch, f, u, w, FH, rng);
      balconyDone = true;
    }
    for (let fl = 0; fl < floors; fl++) {
      const base = fl * FH;
      if (base + 2.2 > H - 0.4) break;
      const tries = Math.max(1, Math.floor(f.L / 2.4));
      const list = fl === 0 ? used : [];
      for (let t = 0; t < tries; t++) {
        if (rng() > 0.62) continue;
        const w = 0.68 + rng() * 0.32, h = 0.9 + rng() * 0.35;
        const u = w / 2 + 0.5 + rng() * Math.max(0, f.L - w - 1);
        const sill = base + (fl === 0 ? 1.05 : 0.95);
        if (sill + h > H - 0.45) continue;
        if (!fits(u, w, list)) continue;
        cycWindow(ch, f, u, w, sill, h, rng);
        list.push([u - w / 2, u + w / 2]);
      }
    }
  }
}

function cycWindow(ch, f, u, w, sill, h, rng) {
  const u0 = u - w / 2, u1 = u + w / 2, y0 = sill, y1 = sill + h, T = 0.09;
  const shut = rng() < 0.35;
  // 窗洞：往內退一點的深色玻璃＋四邊內側的窗框深度
  fpanel(ch.fine, f, u0, u1, y0, y1, 0.006, shut ? C.shutter : C.glass);
  if (shut) {   // 關上的百葉：幾條橫向陰影線
    for (let y = y0 + 0.08; y < y1 - 0.04; y += 0.11) fpanel(ch.fine, f, u0 + 0.03, u1 - 0.03, y, y + 0.025, 0.01, 0.8);
    fbox(ch.fine, f, u - 0.012, u + 0.012, y0, y1, 0.006, 0.03, 0.88, { top: false });
  } else {
    fbox(ch.fine, f, u - 0.02, u + 0.02, y0, y1, 0.006, 0.035, C.trim, { top: false });                     // 中間直框
    fbox(ch.fine, f, u0, u1, y0 + h * 0.58 - 0.02, y0 + h * 0.58 + 0.02, 0.006, 0.035, C.trim, { ends: false }); // 橫框
    if (rng() < 0.4) {   // 打開的木百葉貼在窗兩側
      fpanel(ch.fine, f, u0 - w / 2 - 0.02, u0 - 0.02, y0, y1, 0.03, C.shutter);
      fpanel(ch.fine, f, u1 + 0.02, u1 + w / 2 + 0.02, y0, y1, 0.03, C.shutter);
    }
  }
  // 厚實的石灰窗框（凸出）＋窗台
  fbox(ch.fine, f, u0 - T, u0, y0, y1, 0, 0.07, C.trim);
  fbox(ch.fine, f, u1, u1 + T, y0, y1, 0, 0.07, C.trim);
  fbox(ch.fine, f, u0 - T, u1 + T, y1, y1 + T, 0, 0.07, C.trim, { bottom: true });
  fbox(ch.cast, f, u0 - T - 0.05, u1 + T + 0.05, y0 - 0.09, y0, 0, 0.15, C.trim, { bottom: true });
}

function cycBalcony(ch, f, u, w, y0, rng) {
  const u0 = u - w / 2, u1 = u + w / 2, D = 0.85;
  // 落地門
  fpanel(ch.fine, f, u - 0.45, u + 0.45, y0 + 0.02, y0 + 2.15, 0.006, C.door);
  fbox(ch.fine, f, u - 0.55, u + 0.55, y0 + 2.15, y0 + 2.27, 0, 0.08, C.trim, { bottom: true });
  // 木樓板＋兩根斜撐
  fbox(ch.cast, f, u0, u1, y0 - 0.1, y0 + 0.02, 0, D, 0.97, { bottom: true });
  for (const uu of [u0 + 0.2, u1 - 0.2]) {
    const P = (ww, yy) => { const [x, z] = at(f, uu, ww); return [x, yy, z]; };
    const Q = (ww, yy) => { const [x, z] = at(f, uu + 0.06, ww); return [x, yy, z]; };
    ch.cast.quad(P(0, y0 - 0.75), P(D - 0.1, y0 - 0.1), Q(D - 0.1, y0 - 0.1), Q(0, y0 - 0.75), [f.nx, -0.7, f.nz], 0.85);
    ch.cast.quad(P(0, y0 - 0.65), P(D - 0.1, y0 - 0.02), Q(D - 0.1, y0 - 0.02), Q(0, y0 - 0.65), [-f.nx, 0.7, -f.nz], 0.95);
  }
  // 欄杆：扶手＋直條
  fbox(ch.fine, f, u0, u1, y0 + 0.95, y0 + 1.0, D - 0.06, D, 0.95, { bottom: true });
  fbox(ch.fine, f, u0, u0 + 0.05, y0 + 0.02, y0 + 1.0, 0, D, 0.95, {});
  fbox(ch.fine, f, u1 - 0.05, u1, y0 + 0.02, y0 + 1.0, 0, D, 0.95, {});
  for (let uu = u0 + 0.14; uu < u1 - 0.08; uu += 0.13) fbox(ch.fine, f, uu, uu + 0.035, y0 + 0.02, y0 + 0.95, D - 0.05, D - 0.015, 0.95, { top: false });
  if (rng() < 0.6) {   // 花盆
    const [x, z] = at(f, u0 + 0.35, D - 0.25);
    cylinder(ch.fine, x, z, 0.13, y0 + 0.02, y0 + 0.3, 8, 0.92);
    dome(ch.fine, x, y0 + 0.3, z, 0.2, 7, 2, 0.9);
  }
}

function door(ch, f, u, w, h, rng) {
  const u0 = u - w / 2, u1 = u + w / 2;
  fpanel(ch.fine, f, u0, u1, 0, h, 0.006, C.door);
  // 門板分格（凸起的板條）
  for (const [a, c] of [[0.12, 0.45], [0.55, 0.92]]) {
    fbox(ch.fine, f, u0 + 0.1, u - 0.04, h * a, h * c, 0.006, 0.025, C.door.map((v) => v * 1.04), { });
    fbox(ch.fine, f, u + 0.04, u1 - 0.1, h * a, h * c, 0.006, 0.025, C.door.map((v) => v * 1.04), { });
  }
  fbox(ch.fine, f, u + 0.18, u + 0.22, h * 0.48, h * 0.52, 0.025, 0.06, C.dark);   // 門把
  // 門框與門楣
  fbox(ch.fine, f, u0 - 0.12, u0, 0, h, 0, 0.08, C.trim);
  fbox(ch.fine, f, u1, u1 + 0.12, 0, h, 0, 0.08, C.trim);
  fbox(ch.cast, f, u0 - 0.25, u1 + 0.25, h, h + 0.14, 0, 0.2, C.trim, { bottom: true });
  // 台階
  fbox(ch.cast, f, u0 - 0.2, u1 + 0.2, 0, 0.16, 0, 0.38, C.trim);
  // 門邊的小燈
  if (rng() < 0.5) fbox(ch.fine, f, u1 + 0.3, u1 + 0.42, h - 0.35, h - 0.12, 0, 0.12, 0.95, { bottom: true });
}

function cycladicRoof(ch, b, inset, rng, roofY, H, edges) {
  const [cx, cz] = centroid(inset);
  const inr = inRing(inset, cx, cz) ? distToRing(inset, cx, cz) : 0;
  if (b.k === 'c' && inr > 1.1) {
    // 教堂：鼓座＋圓頂＋十字
    const r = Math.min(2.4, inr * 0.85);
    cylinder(ch.cast, cx, cz, r * 0.96, roofY, roofY + 0.55, 24, 1, false);
    cylinder(ch.cast, cx, cz, r + 0.09, roofY + 0.55, roofY + 0.63, 24, 1, true);   // 圓頂下的線腳
    dome(ch.cast, cx, roofY + 0.6, cz, r, 24, 7, 1);
    cylinder(ch.cast, cx, cz, 0.07, roofY + 0.6 + r, roofY + 0.6 + r + 0.7, 6, 0.95);
    wbox(ch.cast, cx, cz, 1, 0, 0.22, 0.04, roofY + 0.6 + r + 0.42, roofY + 0.6 + r + 0.5, 0.95);
  } else if (b.k === 'c' && edges.length) {
    bellGable(ch, edges[0], H);
  }
  // 煙囪（基克拉澤斯的小煙囪，上面一片蓋子）
  if (rng() < 0.3 && inr > 0.8) {
    const a = rng() * Math.PI * 2, d = inr * 0.5;
    const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
    if (inRing(inset, x, z)) {
      const ux = Math.cos(a * 0.3), uz = Math.sin(a * 0.3);
      wbox(ch.cast, x, z, ux, uz, 0.24, 0.24, roofY, roofY + 0.85, 1);
      wbox(ch.cast, x, z, ux, uz, 0.34, 0.34, roofY + 1.0, roofY + 1.08, 1, { bottom: true });
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) wbox(ch.fine, x + (ux * sx - uz * sz) * 0.19, z + (uz * sx + ux * sz) * 0.19, ux, uz, 0.04, 0.04, roofY + 0.85, roofY + 1.0, 1);
    }
  }
}

function bellGable(ch, f, H) {
  // 鐘牆：牆面往上長出一片牆，中間開一個拱洞掛鐘
  const u = f.L / 2, w = 1.6, t = 0.3, y0 = H, y1 = H + 1.7;
  fbox(ch.cast, f, u - w / 2, u - 0.3, y0, y1 - 0.35, -t, 0, 1, { back: true });
  fbox(ch.cast, f, u + 0.3, u + w / 2, y0, y1 - 0.35, -t, 0, 1, { back: true });
  fbox(ch.cast, f, u - w / 2, u + w / 2, y1 - 0.35, y1, -t, 0, 1, { back: true });
  cylinder(ch.fine, ...at(f, u, -t / 2), 0.16, y1 - 0.9, y1 - 0.5, 10, C.dark);
}

// ======================= 台北 =======================
function taipeiFacades(ch, b, edges, rng, heightAt, H, roofY, FH) {
  const floors = Math.max(1, Math.min(b.f, Math.floor((roofY + 0.2) / FH)));
  edges.forEach((f, ei) => {
    const front = ei === 0;
    const bays = Math.max(1, Math.round(f.L / (front ? 3.6 : 3.2)));
    const bw = f.L / bays;
    // 樓層線（每層樓板邊緣凸出一條）
    for (let k = 1; k < floors; k++) fbox(ch.fine, f, 0, f.L, k * FH - 0.08, k * FH + 0.08, 0, 0.06, C.trim, { bottom: true });
    // 外牆排水管（從屋頂一路到地面，轉角處加束環）
    if (floors >= 2 && rng() < 0.6) {
      const up = rng() < 0.5 ? 0.25 : f.L - 0.25;
      const [px, pz] = at(f, up, 0.12);
      cylinder(ch.fine, px, pz, 0.055, 0, roofY + 0.4, 6, 0.93, false);
      for (let y = 1.6; y < roofY; y += FH) cylinder(ch.fine, px, pz, 0.075, y, y + 0.06, 6, C.metal, true);
    }
    const balcony = front && floors >= 2 && rng() < 0.55;
    for (let bay = 0; bay < bays; bay++) {
      const ua = bay * bw, ub = ua + bw, uc = (ua + ub) / 2;
      if (!openAt(heightAt, f, uc, 0.7)) continue;
      // 一樓：臨巷的正面多半是店面（鐵捲門＋招牌），側面與住宅是大門加鐵窗
      const shop = front ? rng() < 0.75 : bw > 2.8 && rng() < 0.3;
      if (shop && bw > 2.2) {
        const u0 = ua + 0.28, u1 = ub - 0.28;
        for (let y = 0; y < 2.65; y += 0.19) {   // 鐵捲門：亮暗相間的橫條
          fpanel(ch.fine, f, u0, u1, y, Math.min(2.65, y + 0.155), 0.006, C.rolling);
          fpanel(ch.fine, f, u0, u1, y + 0.155, Math.min(2.65, y + 0.19), 0.006, C.rolling.map((v) => v * 0.86));
        }
        fbox(ch.cast, f, u0 - 0.05, u1 + 0.05, 2.65, 2.95, 0, 0.26, C.metal, { bottom: true });    // 捲門箱
        fbox(ch.cast, f, ua + 0.1, ub - 0.1, 3.0, 3.85, 0, 0.22, 0.97, { bottom: true });            // 招牌
        fpanel(ch.fine, f, ua + 0.22, ub - 0.22, 3.12, 3.73, 0.225, 0.9);                            // 招牌面板
        if (floors >= 2 && rng() < 0.4) {                                                             // 側招（垂直伸出）
          const us = rng() < 0.5 ? ua + 0.3 : ub - 0.3;
          const P = { ax: at(f, us, 0)[0], az: at(f, us, 0)[1], ux: f.nx, uz: f.nz, nx: -f.ux, nz: -f.uz, L: 1 };
          const top = Math.min(roofY - 0.3, 3.9 + 1.6 + rng() * 2);
          fbox(ch.cast, P, 0.25, 1.15, 4.0, top, -0.07, 0.07, 0.98, { bottom: true, back: true });
          fbox(ch.fine, P, 0.1, 0.25, 4.3, 4.45, -0.03, 0.03, C.metal, { bottom: true, back: true });
          fbox(ch.fine, P, 0.1, 0.25, top - 0.4, top - 0.25, -0.03, 0.03, C.metal, { bottom: true, back: true });
        }
      } else if (bw > 1.8) {
        const du = bw > 3 ? ua + 0.9 : uc;
        taipeiGate(ch, f, du, rng);
        if (bw > 3) taipeiWindow(ch, f, Math.min(ub - 1.0, du + 1.9), Math.min(1.5, ub - du - 1.6), 1.0, 1.3, rng);
      }
      // 樓上
      for (let k = 1; k < floors; k++) {
        const y0 = k * FH;
        if (balcony && rng() < 0.6) { taipeiBalcony(ch, f, ua, ub, y0, rng); continue; }
        const ww = Math.min(1.9, bw - 0.7), wh = 1.35, sill = y0 + 0.95;
        if (ww < 0.8) continue;
        taipeiWindow(ch, f, uc, ww, sill, wh, rng);
      }
    }
  });
}

// 公寓一樓大門：鐵門＋門楣雨遮＋門牌燈
function taipeiGate(ch, f, u, rng) {
  const u0 = u - 0.65, u1 = u + 0.65;
  fpanel(ch.fine, f, u0, u1, 0, 2.3, 0.006, C.metal);
  for (let y = 0.3; y < 2.2; y += 0.42) fpanel(ch.fine, f, u0 + 0.08, u1 - 0.08, y, y + 0.3, 0.012, C.metal.map((v) => v * 0.9));
  fbox(ch.fine, f, u - 0.03, u + 0.03, 0, 2.3, 0.006, 0.03, C.metal.map((v) => v * 0.85), { top: false });
  fbox(ch.fine, f, u0 - 0.08, u0, 0, 2.38, 0, 0.06, C.trim);
  fbox(ch.fine, f, u1, u1 + 0.08, 0, 2.38, 0, 0.06, C.trim);
  // 斜的雨遮
  const Q = (uu, yy, ww) => { const [x, z] = at(f, uu, ww); return [x, yy, z]; };
  ch.cast.quad(Q(u0 - 0.3, 2.75, 0), Q(u1 + 0.3, 2.75, 0), Q(u1 + 0.3, 2.55, 0.75), Q(u0 - 0.3, 2.55, 0.75), [f.nx * 0.26, 0.96, f.nz * 0.26], 0.96);
  ch.cast.quad(Q(u0 - 0.3, 2.73, 0), Q(u1 + 0.3, 2.73, 0), Q(u1 + 0.3, 2.53, 0.75), Q(u0 - 0.3, 2.53, 0.75), [-f.nx * 0.26, -0.96, -f.nz * 0.26], 0.8);
  fbox(ch.fine, f, u1 + 0.2, u1 + 0.5, 1.75, 1.97, 0, 0.04, 0.97, {});   // 門牌
  fbox(ch.fine, f, u0 - 0.35, u0 - 0.2, 2.1, 2.3, 0, 0.12, 0.95, { bottom: true });   // 燈
  void rng;
}

// 巷子上空的電線：牆面往外找對面的樓，兩端掛在 4–6 m 高、中間下垂
function overheadWires(wires, edges, rng, heightAt, H) {
  for (const f of edges) {
    if (H < 6 || rng() > 0.45) continue;
    const u = 0.5 + rng() * (f.L - 1);
    let D = 0;
    for (let w = 1; w < 14; w += 0.25) if (!openAt(heightAt, f, u, w)) { D = w; break; }
    if (D < 2.5) continue;
    const n = 1 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const y0 = 4.2 + rng() * 1.8, y1 = 4.2 + rng() * 1.8, sag = 0.25 + D * 0.04 + rng() * 0.2;
      const du = (rng() - 0.5) * 2.5;
      let prev = null;
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        const [x, z] = at(f, u + du * t, t * D);
        const y = y0 + (y1 - y0) * t - sag * 4 * t * (1 - t);
        if (prev) wires.push(prev[0], prev[1], prev[2], x, y, z);
        prev = [x, y, z];
      }
    }
  }
}

function taipeiWindow(ch, f, u, w, sill, h, rng) {
  const u0 = u - w / 2, u1 = u + w / 2, y0 = sill, y1 = sill + h;
  fpanel(ch.fine, f, u0, u1, y0, y1, 0.006, C.glass);
  // 鋁框：外框＋中間兩扇推拉窗的直框
  fbox(ch.fine, f, u0, u1, y0, y0 + 0.05, 0, 0.05, C.metal, { ends: false });
  fbox(ch.fine, f, u0, u1, y1 - 0.05, y1, 0, 0.05, C.metal, { ends: false, bottom: true });
  fbox(ch.fine, f, u0, u0 + 0.05, y0, y1, 0, 0.05, C.metal, { top: false });
  fbox(ch.fine, f, u1 - 0.05, u1, y0, y1, 0, 0.05, C.metal, { top: false });
  fbox(ch.fine, f, u - 0.03, u + 0.03, y0, y1, 0.006, 0.04, C.metal, { top: false });
  fbox(ch.fine, f, u0 - 0.06, u1 + 0.06, y0 - 0.07, y0, 0, 0.1, C.trim, { bottom: true });   // 窗台
  if (rng() < 0.7) {
    // 鐵窗：凸出牆面的籠子（柵欄用貼圖），頂上一片斜的遮雨板
    const g0 = u0 - 0.1, g1 = u1 + 0.1, gy0 = y0 - 0.12, gy1 = y1 + 0.12, D = 0.38;
    const G = ch.grille;
    const P = (uu, yy, ww) => { const [x, z] = at(f, uu, ww); return [x, yy, z]; };
    const S = 2.2;   // 每公尺幾格貼圖
    G.quad(P(g0, gy0, D), P(g1, gy0, D), P(g1, gy1, D), P(g0, gy1, D), [f.nx, 0, f.nz], 1, [[0, 0], [(g1 - g0) * S, 0], [(g1 - g0) * S, (gy1 - gy0) * S], [0, (gy1 - gy0) * S]]);
    G.quad(P(g0, gy0, 0), P(g0, gy0, D), P(g0, gy1, D), P(g0, gy1, 0), [-f.ux, 0, -f.uz], 0.97, [[0, 0], [D * S, 0], [D * S, (gy1 - gy0) * S], [0, (gy1 - gy0) * S]]);
    G.quad(P(g1, gy0, 0), P(g1, gy0, D), P(g1, gy1, D), P(g1, gy1, 0), [f.ux, 0, f.uz], 0.97, [[0, 0], [D * S, 0], [D * S, (gy1 - gy0) * S], [0, (gy1 - gy0) * S]]);
    G.quad(P(g0, gy0, 0), P(g1, gy0, 0), P(g1, gy0, D), P(g0, gy0, D), [0, -1, 0], 0.85, [[0, 0], [(g1 - g0) * S, 0], [(g1 - g0) * S, D * S], [0, D * S]]);
    // 框
    fbox(ch.fine, f, g0, g1, gy0, gy0 + 0.04, 0, D + 0.02, C.metal, { bottom: true });
    fbox(ch.fine, f, g0, g0 + 0.04, gy0, gy1, D - 0.02, D + 0.02, C.metal, {});
    fbox(ch.fine, f, g1 - 0.04, g1, gy0, gy1, D - 0.02, D + 0.02, C.metal, {});
    // 遮雨板（往外下斜）
    const Q = (uu, yy, ww) => { const [x, z] = at(f, uu, ww); return [x, yy, z]; };
    const ny = 0.92, nw = 0.38;
    ch.cast.quad(Q(g0 - 0.05, gy1 + 0.18, 0), Q(g1 + 0.05, gy1 + 0.18, 0), Q(g1 + 0.05, gy1 + 0.02, D + 0.12), Q(g0 - 0.05, gy1 + 0.02, D + 0.12), [f.nx * nw, ny, f.nz * nw], 0.95);
    ch.cast.quad(Q(g0 - 0.05, gy1 + 0.17, 0), Q(g1 + 0.05, gy1 + 0.17, 0), Q(g1 + 0.05, gy1 + 0.01, D + 0.12), Q(g0 - 0.05, gy1 + 0.01, D + 0.12), [-f.nx * nw, -ny, -f.nz * nw], 0.78);
  }
  if (rng() < 0.38) {
    // 窗型冷氣／分離式室外機
    const side = rng() < 0.5 ? -1 : 1, uc = u + side * (w / 2 + 0.55);
    fbox(ch.cast, f, uc - 0.4, uc + 0.4, y0 - 0.15, y0 + 0.42, 0, 0.3, C.tank, { bottom: true });
    fpanel(ch.fine, f, uc - 0.34, uc + 0.08, y0 - 0.08, y0 + 0.35, 0.305, 0.74);
    fbox(ch.fine, f, uc - 0.42, uc + 0.42, y0 - 0.2, y0 - 0.15, 0, 0.34, C.metal, { bottom: true });
  }
}

function taipeiBalcony(ch, f, ua, ub, y0, rng) {
  const u0 = ua + 0.15, u1 = ub - 0.15, D = 0.95;
  // 落地窗
  fpanel(ch.fine, f, u0 + 0.35, u1 - 0.35, y0 + 0.05, y0 + 2.3, 0.006, C.glassDeep);
  fbox(ch.fine, f, (u0 + u1) / 2 - 0.03, (u0 + u1) / 2 + 0.03, y0, y0 + 2.3, 0.006, 0.04, C.metal, { top: false });
  // 樓板＋前面與兩側的實心欄杆
  fbox(ch.cast, f, u0, u1, y0 - 0.14, y0 + 0.04, 0, D, C.trim, { bottom: true });
  fbox(ch.cast, f, u0, u1, y0 + 0.04, y0 + 1.05, D - 0.1, D, C.trim, { back: true });
  fbox(ch.cast, f, u0, u0 + 0.1, y0 + 0.04, y0 + 1.05, 0, D - 0.1, C.trim);
  fbox(ch.cast, f, u1 - 0.1, u1, y0 + 0.04, y0 + 1.05, 0, D - 0.1, C.trim);
  fbox(ch.fine, f, u0 - 0.02, u1 + 0.02, y0 + 1.05, y0 + 1.1, D - 0.12, D + 0.02, C.metal, { bottom: true });
  if (rng() < 0.5) {   // 晾衣桿（兩根細管橫在陽台上方）
    for (const w of [0.35, 0.7]) fbox(ch.fine, f, u0 + 0.1, u1 - 0.1, y0 + 2.05, y0 + 2.08, w, w + 0.03, C.metal, { bottom: true });
  }
}

function taipeiRoof(ch, b, inset, rng, roofY) {
  const [cx, cz] = centroid(inset);
  // 沿最長邊的方向擺頂樓加蓋與水塔
  let best = 0, ux = 1, uz = 0;
  for (let i = 0; i < inset.length; i++) {
    const [ax, az] = inset[i], [bx, bz] = inset[(i + 1) % inset.length], L = Math.hypot(bx - ax, bz - az);
    if (L > best) { best = L; ux = (bx - ax) / L; uz = (bz - az) / L; }
  }
  let hu = 0, hw = 0;
  for (const [x, z] of inset) {
    hu = Math.max(hu, Math.abs((x - cx) * ux + (z - cz) * uz));
    hw = Math.max(hw, Math.abs(-(x - cx) * uz + (z - cz) * ux));
  }
  const fitsBox = (x, z, a, c) => [[-a, -c], [a, -c], [a, c], [-a, c]].every(([s, t]) => inRing(inset, x + ux * s - uz * t, z + uz * s + ux * t));
  let tx = cx, tz = cz, th = roofY;
  if (rng() < 0.5 && hu > 2.2 && hw > 1.8) {
    // 頂樓加蓋：退縮一點的鐵皮屋，屋簷挑出
    const a = hu * 0.62, c = hw * 0.62;
    if (fitsBox(cx, cz, a, c)) {
      const h = 2.6;
      wbox(ch.cast, cx, cz, ux, uz, a, c, roofY, roofY + h, 0.97);
      wbox(ch.cast, cx, cz, ux, uz, a + 0.22, c + 0.22, roofY + h, roofY + h + 0.1, 0.95, { bottom: true });
      // 加蓋的窗
      const f = { ax: cx - ux * a + uz * c, az: cz - uz * a - ux * c, ux, uz, nx: uz, nz: -ux, L: 2 * a };
      for (let u = 0.9; u < 2 * a - 0.9; u += 2.2) { fpanel(ch.fine, f, u - 0.5, u + 0.5, roofY + 1.0, roofY + 2.0, -0.006, C.glass); }
      tx = cx + ux * a * 0.4; tz = cz + uz * a * 0.4; th = roofY + h + 0.1;
    }
  } else if (hu > 1.6 && hw > 1.4 && rng() < 0.7) {
    // 樓梯間
    const a = Math.min(1.4, hu * 0.5), c = Math.min(1.3, hw * 0.5);
    const x = cx - ux * (hu - a - 0.3), z = cz - uz * (hu - a - 0.3);
    if (fitsBox(x, z, a, c)) {
      wbox(ch.cast, x, z, ux, uz, a, c, roofY, roofY + 2.8, 1);
      wbox(ch.cast, x, z, ux, uz, a + 0.08, c + 0.08, roofY + 2.8, roofY + 3.2, 1);
      tx = x; tz = z; th = roofY + 3.2;
    }
  }
  // 水塔：圓桶＋鐵架
  const nT = 1 + (rng() < 0.4 ? 1 : 0);
  for (let k = 0; k < nT; k++) {
    const x = tx + ux * k * 1.2, z = tz + uz * k * 1.2;
    if (th === roofY && !inRing(inset, x, z)) continue;
    wbox(ch.cast, x, z, ux, uz, 0.55, 0.55, th, th + 0.42, C.metal);
    cylinder(ch.cast, x, z, 0.52, th + 0.42, th + 1.5, 16, C.tank);
    cylinder(ch.fine, x, z, 0.12, th + 1.5, th + 1.58, 8, C.metal);
  }
}

// ======================= 會擋路的小物 =======================
function stair(B, o) {
  for (let k = 0; k < o.n; k++) fbox(B, o.f, o.u0 + k * o.run, o.u0 + (k + 1) * o.run + (k === o.n - 1 ? 0.9 : 0), 0, (k + 1) * o.rise, 0, o.w1, 1, { ends: k === 0 });
  // 外側的矮扶牆（一路斜上去）
  const f = o.f, P = (u, y, w) => { const [x, z] = at(f, u, w); return [x, y, z]; };
  const u1 = o.u0 + o.n * o.run, top = o.h + 0.45;
  B.quad(P(o.u0, 0, o.w1 + 0.12), P(u1, o.h, o.w1 + 0.12), P(u1, top, o.w1 + 0.12), P(o.u0, 0.45, o.w1 + 0.12), [f.nx, 0, f.nz], 1);
  B.quad(P(o.u0, 0.45, o.w1), P(u1, top, o.w1), P(u1, top, o.w1 + 0.12), P(o.u0, 0.45, o.w1 + 0.12), [0, 1, 0], 0.98);
  fbox(B, f, u1, o.u1, o.h, top, o.w1, o.w1 + 0.12, 1);
}

function bench(B, o) {
  const y = o.h;
  fbox(B, o.f, o.u0, o.u1, 0, y - 0.06, 0, o.w1, 1);
  fbox(B, o.f, o.u0 - 0.03, o.u1 + 0.03, y - 0.06, y, 0, o.w1 + 0.04, 1, { bottom: true });   // 圓邊壓頂
  if (o.kind === 'planter') {
    // 花台裡的一叢灌木（低多邊形球）
    const [x, z] = at(o.f, (o.u0 + o.u1) / 2, o.w1 / 2);
    dome(B, x, y - 0.05, z, Math.min(0.45, (o.u1 - o.u0) / 2.5), 8, 3, 0.9);
  }
}

function scooter(B, o) {
  const f = o.f, uc = (o.u0 + o.u1) / 2;
  const body = 0.93, dark = C.dark;
  // 車身（踏板＋後座下殼）
  fbox(B, f, uc - 0.2, uc + 0.2, 0.28, 0.42, 0.55, 1.45, body, { bottom: true });
  fbox(B, f, uc - 0.24, uc + 0.24, 0.42, 0.78, 0.25, 0.95, body, { bottom: true });
  fbox(B, f, uc - 0.2, uc + 0.2, 0.78, 0.86, 0.22, 0.92, 0.6);                 // 座墊
  // 前擋＋把手
  fbox(B, f, uc - 0.22, uc + 0.22, 0.4, 1.05, 1.42, 1.55, body);
  fbox(B, f, uc - 0.36, uc + 0.36, 1.06, 1.11, 1.46, 1.52, dark, { bottom: true });
  fbox(B, f, uc - 0.09, uc + 0.09, 0.95, 1.14, 1.5, 1.62, body);               // 車頭燈罩
  // 輪子（沿 u 軸的扁圓柱）
  for (const w of [0.38, 1.62]) {
    const [x, z] = at(f, uc, w);
    wheel(B, x, z, f.ux, f.uz, 0.24, 0.1, dark);
  }
}

// 輪子：軸沿 (ax, az)，輪面在 (w, y) 平面上、w 方向是 (-az, ax)
function wheel(B, cx, cz, ax, az, r, t, k) {
  const seg = 8;
  const P = (a, s) => [cx + ax * s - az * Math.cos(a) * r, r + Math.sin(a) * r, cz + az * s + ax * Math.cos(a) * r];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    B.quad(P(a0, -t / 2), P(a1, -t / 2), P(a1, t / 2), P(a0, t / 2), [-az * Math.cos(am), Math.sin(am), ax * Math.cos(am)], k);
    B.tri([cx + ax * t / 2, r, cz + az * t / 2], P(a0, t / 2), P(a1, t / 2), [ax, 0, az], k, k, k);
    B.tri([cx - ax * t / 2, r, cz - az * t / 2], P(a0, -t / 2), P(a1, -t / 2), [-ax, 0, -az], k, k, k);
  }
}

export { clearance };
