// 各國地標地圖的建築風格與地標模型（白模）：
//   羅馬（roma）：四、五層宅邸，粗石砌一樓＋拱門店面、百葉窗、主樓層三角／弧形窗楣、大屋簷（cornicione）、屋頂陽台
//   京都（kyoto）：兩層町家，一樓格子門（千本格子）＋暖簾、兩層之間的瓦簷、二樓蟲籠窗、四坡瓦頂
//   巴黎（paris）：奧斯曼式公寓，一樓大櫥窗、法式落地窗＋鑄鐵小陽台、二樓與頂樓整排陽台、斜屋頂（mansard）＋老虎窗＋煙囪
//   地標：萬神殿、八坂塔、聖母院、方尖碑
// 純陣列輸出（不碰 Three），跟 facade.js 一樣依 32 m 分塊。
import { at, edgeFrame } from './arch.js';
import { C, archPanel, centroid, cylinder, fbox, fpanel, wbox } from './geom.js';

const GLASS = [0.52, 0.56, 0.62], DARK = [0.42, 0.44, 0.48], SHUTTER = [0.88, 0.9, 0.86], TILE = [0.6, 0.62, 0.66];
const WOOD = [0.7, 0.66, 0.6], ZINC = [0.74, 0.77, 0.82], IRON = [0.36, 0.38, 0.42];

export const STYLES = {
  roma: { minEdge: 2.4, PH: 0.45 },
  kyoto: { minEdge: 1.8, PH: 0, noParapet: true },
  paris: { minEdge: 2.4, PH: 0, noParapet: true },
};

const P3 = (f, u, y, w) => { const [x, z] = at(f, u, w); return [x, y, z]; };

// 牆面上一根細欄杆（陽台）：上下橫桿＋每 0.12 m 一根直桿
function railing(B, f, u0, u1, y0, w, h = 0.95, k = IRON) {
  fbox(B, f, u0, u1, y0 + h - 0.05, y0 + h, w - 0.03, w + 0.03, k);
  fbox(B, f, u0, u1, y0 + 0.06, y0 + 0.1, w - 0.02, w + 0.02, k, { top: false });
  for (let u = u0 + 0.06; u < u1 - 0.03; u += 0.14) fbox(B, f, u, u + 0.025, y0 + 0.08, y0 + h - 0.04, w - 0.012, w + 0.012, k, { top: false });
}

// 三角形窗楣（兩片斜面＋正面三角）
function pediment(B, f, u0, u1, y, h, d, k) {
  const um = (u0 + u1) / 2, N = [f.nx, 0, f.nz];
  B.tri(P3(f, u0, y, d), P3(f, u1, y, d), P3(f, um, y + h, d), N, k, k, k);
  const L = Math.hypot((u1 - u0) / 2, h);
  B.quad(P3(f, u0, y, 0), P3(f, um, y + h, 0), P3(f, um, y + h, d), P3(f, u0, y, d), [-f.ux * (h / L), ((u1 - u0) / 2) / L, -f.uz * (h / L)], k);
  B.quad(P3(f, um, y + h, 0), P3(f, u1, y, 0), P3(f, u1, y, d), P3(f, um, y + h, d), [f.ux * (h / L), ((u1 - u0) / 2) / L, f.uz * (h / L)], k);
}

// 牆上的圓（玫瑰窗、圓窗）：一片扇形貼片，外加一圈框
function discPanel(B, f, u, y, r, w, k, rim = true) {
  const seg = 20, N = [f.nx, 0, f.nz];
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * 6.283, a1 = ((i + 1) / seg) * 6.283;
    B.tri(P3(f, u, y, w), P3(f, u + Math.cos(a0) * r, y + Math.sin(a0) * r, w), P3(f, u + Math.cos(a1) * r, y + Math.sin(a1) * r, w), N, k, k, k);
    if (rim) {
      const R2 = r * 1.12;
      B.quad(P3(f, u + Math.cos(a0) * r, y + Math.sin(a0) * r, w + 0.08), P3(f, u + Math.cos(a1) * r, y + Math.sin(a1) * r, w + 0.08),
        P3(f, u + Math.cos(a1) * R2, y + Math.sin(a1) * R2, w + 0.08), P3(f, u + Math.cos(a0) * R2, y + Math.sin(a0) * R2, w + 0.08), N, 0.97);
    }
  }
  if (rim) for (let i = 0; i < 6; i++) {   // 放射狀的窗櫺
    const a = (i / 6) * Math.PI;
    const p = (s) => P3(f, u + Math.cos(a) * r * s, y + Math.sin(a) * r * s, w + 0.04);
    const q = (s) => P3(f, u + Math.cos(a) * r * s - Math.sin(a) * 0.06, y + Math.sin(a) * r * s + Math.cos(a) * 0.06, w + 0.04);
    B.quad(p(-1), p(1), q(1), q(-1), N, 0.92);
  }
}

// 一排等距的開口位置
function bays(L, step, margin = 0.9) {
  const n = Math.max(1, Math.floor((L - 2 * margin) / step));
  const s = (L - 2 * margin) / n;
  return Array.from({ length: n }, (_, i) => margin + s * (i + 0.5));
}

// ======================= 羅馬 =======================
export function romaFacades(ch, b, edges, rng, H) {
  const GF = 4.4, FH = 3.6, floors = Math.max(1, Math.round((H - 1 - GF) / FH));
  const church = b.k === 'c';
  let portone = false;
  for (const [ei, f] of edges.entries()) {
    if (church) { romaChurch(ch, f, H, ei === 0); continue; }
    // 一樓：粗石砌的橫縫、拱門店面、一扇大門
    for (let y = 0.55; y < GF - 0.3; y += 0.55) fbox(ch.fine, f, 0, f.L, y - 0.04, y, 0, 0.04, 0.9, { ends: false });
    fbox(ch.cast, f, 0, f.L, GF - 0.25, GF, 0, 0.14, 1);                       // 一樓頂的腰線
    const us = bays(f.L, 4.2, 1.2);
    us.forEach((u, i) => {
      if (!portone && ei === 0 && i === Math.floor(us.length / 2)) {
        portone = true;
        archPanel(ch.fine, f, u, 2.3, 0, 2.9, DARK);
        fbox(ch.fine, f, u - 1.45, u - 1.15, 0, 2.9, 0, 0.12, 0.97); fbox(ch.fine, f, u + 1.15, u + 1.45, 0, 2.9, 0, 0.12, 0.97);
        fbox(ch.fine, f, u - 0.18, u + 0.18, 3.95, 4.15, 0, 0.16, 1);          // 拱心石
        return;
      }
      if (rng() < 0.75) {
        archPanel(ch.fine, f, u, 1.9, 0, 2.4, rng() < 0.5 ? GLASS : DARK);
        fbox(ch.fine, f, u - 1.05, u + 1.05, 0, 0.12, 0, 0.06, 0.9);
      } else {
        fpanel(ch.fine, f, u - 0.5, u + 0.5, 2.0, 3.0, 0.01, GLASS);           // 一樓的鐵窗小窗
        fbox(ch.fine, f, u - 0.6, u + 0.6, 1.92, 2.0, 0, 0.1, 1, { bottom: true });
      }
    });
    // 樓上：百葉窗＋窗框；主樓層（二樓）加窗楣，偶爾一個小陽台
    const ws = bays(f.L, 2.9, 1.1);
    for (let k = 0; k < floors; k++) {
      const y0 = GF + k * FH + 0.75, wh = k === 0 ? 2.25 : 1.95;
      if (y0 + wh > H - 0.8) break;
      fbox(ch.fine, f, 0, f.L, y0 - 0.78, y0 - 0.7, 0, 0.06, 0.97, { ends: false });   // 每層的細腰線
      for (const u of ws) {
        const u0 = u - 0.55, u1 = u + 0.55;
        fpanel(ch.fine, f, u0, u1, y0, y0 + wh, 0.01, GLASS);
        fbox(ch.fine, f, u0 - 0.14, u0, y0, y0 + wh, 0, 0.1, 1); fbox(ch.fine, f, u1, u1 + 0.14, y0, y0 + wh, 0, 0.1, 1);
        fbox(ch.fine, f, u0 - 0.2, u1 + 0.2, y0 - 0.1, y0, 0, 0.14, 1, { bottom: true });   // 窗台
        const sh = rng();
        if (sh < 0.45) fpanel(ch.fine, f, u0 + 0.02, u1 - 0.02, y0 + 0.02, y0 + wh - 0.02, 0.05, SHUTTER);   // 關著的百葉
        else if (sh < 0.85) { fbox(ch.fine, f, u0 - 0.62, u0 - 0.1, y0, y0 + wh, 0.02, 0.06, SHUTTER); fbox(ch.fine, f, u1 + 0.1, u1 + 0.62, y0, y0 + wh, 0.02, 0.06, SHUTTER); }
        if (k === 0) {
          if (rng() < 0.5) pediment(ch.fine, f, u0 - 0.25, u1 + 0.25, y0 + wh + 0.12, 0.42, 0.16, 1);
          else fbox(ch.fine, f, u0 - 0.25, u1 + 0.25, y0 + wh + 0.08, y0 + wh + 0.28, 0, 0.18, 1, { bottom: true });
          if (rng() < 0.22) { fbox(ch.cast, f, u0 - 0.4, u1 + 0.4, y0 - 0.12, y0, 0, 0.7, 0.97, { bottom: true }); railing(ch.fine, f, u0 - 0.35, u1 + 0.35, y0, 0.66); }
        } else fbox(ch.fine, f, u0 - 0.14, u1 + 0.14, y0 + wh, y0 + wh + 0.14, 0, 0.1, 1, { bottom: true });
      }
    }
    // 大屋簷：深出挑＋下面一排齒飾
    fbox(ch.cast, f, -0.1, f.L + 0.1, H - 0.55, H, 0, 0.62, 1, { bottom: true });
    fbox(ch.fine, f, 0, f.L, H - 0.82, H - 0.55, 0, 0.3, 0.96, { bottom: true });
    for (let u = 0.2; u < f.L - 0.1; u += 0.42) fbox(ch.fine, f, u, u + 0.2, H - 0.95, H - 0.82, 0, 0.22, 0.92, { bottom: true });
  }
}

function romaChurch(ch, f, H, front) {
  // 教堂立面：壁柱、門、圓窗、上方三角山牆
  for (const u of bays(f.L, 3.4, 0.6)) fbox(ch.cast, f, u - 0.3, u + 0.3, 0, H - 1.2, 0, 0.3, 1);
  fbox(ch.cast, f, 0, f.L, H - 1.2, H - 0.6, 0, 0.45, 1, { bottom: true });
  if (front) {
    archPanel(ch.fine, f, f.L / 2, 2.6, 0, 3.8, DARK);
    pediment(ch.fine, f, f.L / 2 - 1.8, f.L / 2 + 1.8, 5.4, 1.1, 0.25, 1);
    discPanel(ch.fine, f, f.L / 2, H * 0.62, 1.1, 0.02, DARK);
    pediment(ch.cast, f, 0.4, f.L - 0.4, H - 0.6, Math.min(4, f.L * 0.22), 0.5, 1);
  }
}

export function romaRoof(ch, b, inset, rng, roofY) {
  // 屋頂陽台：盆栽、遮陽棚架、小煙囪
  const [cx, cz] = centroid(inset);
  if (rng() < 0.45) for (let k = 0; k < 3; k++) {
    const a = rng() * 6.28, d = rng() * 2;
    cylinder(ch.fine, cx + Math.cos(a) * d, cz + Math.sin(a) * d, 0.28, roofY, roofY + 0.5, 8, 0.9);
  }
  if (rng() < 0.35) {
    const a = rng() * 3.14, ux = Math.cos(a), uz = Math.sin(a);
    for (const s of [-1, 1]) for (const t of [-1, 1]) wbox(ch.fine, cx + ux * 1.3 * s - uz * 1 * t, cz + uz * 1.3 * s + ux * 1 * t, ux, uz, 0.05, 0.05, roofY, roofY + 2.2, 0.9);
    wbox(ch.cast, cx, cz, ux, uz, 1.5, 1.2, roofY + 2.2, roofY + 2.3, 0.95);
  }
  if (rng() < 0.6) wbox(ch.cast, cx + (rng() - 0.5) * 3, cz + (rng() - 0.5) * 3, 1, 0, 0.3, 0.3, roofY, roofY + 1.3, 0.93);
}

// ======================= 京都 =======================
export function kyotoFacades(ch, b, edges, rng, H) {
  const temple = b.k === 't';
  const F1 = temple ? H : Math.min(3.3, H - 0.4);
  let door = false;
  for (const [ei, f] of edges.entries()) {
    if (temple) {
      for (const u of bays(f.L, 2.4, 0.4)) fbox(ch.cast, f, u - 0.14, u + 0.14, 0, H, 0, 0.16, WOOD);   // 柱
      fbox(ch.fine, f, 0, f.L, 0, 0.5, 0, 0.25, 0.9);                                                 // 基壇
      fbox(ch.fine, f, 0, f.L, H - 0.6, H - 0.35, 0, 0.12, WOOD);
      continue;
    }
    fbox(ch.fine, f, 0, f.L, 0, 0.32, 0, 0.06, 0.82);                                                   // 腰石
    // 一樓：整面千本格子（格柵貼圖），一扇門口掛暖簾
    const du = !door && ei === 0 ? Math.min(f.L - 1, 1.2 + rng() * Math.max(0.1, f.L - 2.6)) : -9;
    if (du > 0) door = true;
    const G = ch.grille, S = 7, gy0 = 0.32, gy1 = F1 - 0.45;
    const segs = du > 0 ? [[0.25, du - 0.75], [du + 0.75, f.L - 0.25]] : [[0.25, f.L - 0.25]];
    for (const [g0, g1] of segs) {
      if (g1 - g0 < 0.4) continue;
      fpanel(ch.fine, f, g0, g1, gy0, gy1, 0.01, DARK);
      G.quad(P3(f, g0, gy0, 0.08), P3(f, g1, gy0, 0.08), P3(f, g1, gy1, 0.08), P3(f, g0, gy1, 0.08), [f.nx, 0, f.nz], 0.62,
        [[0, 0], [(g1 - g0) * S, 0], [(g1 - g0) * S, (gy1 - gy0) * S * 0.25], [0, (gy1 - gy0) * S * 0.25]]);
      fbox(ch.fine, f, g0 - 0.06, g1 + 0.06, gy1, gy1 + 0.08, 0, 0.12, WOOD, { bottom: true });
    }
    if (du > 0) {
      fpanel(ch.fine, f, du - 0.7, du + 0.7, 0, 2.1, 0.01, DARK);                                      // 門
      const nc = [[0.3, 0.34, 0.5], [0.5, 0.32, 0.3], [0.85, 0.85, 0.8]][Math.floor(rng() * 3)];
      fbox(ch.fine, f, du - 0.75, du + 0.75, 1.35, 2.1, 0.12, 0.14, nc, { ends: false });             // 暖簾
      fbox(ch.fine, f, du - 0.85, du + 0.85, 2.1, 2.18, 0, 0.2, WOOD);
    }
    for (const u of bays(f.L, 1.8, 0.1)) fbox(ch.fine, f, u - 0.06, u + 0.06, 0.32, F1, 0, 0.1, WOOD, { top: false });   // 柱
    // 兩層之間的瓦簷（往外下斜）
    const ey = F1 + 0.15, D = 0.95;
    ch.cast.quad(P3(f, -0.2, ey + 0.32, 0), P3(f, f.L + 0.2, ey + 0.32, 0), P3(f, f.L + 0.2, ey, D), P3(f, -0.2, ey, D), [f.nx * 0.32, 0.95, f.nz * 0.32], TILE);
    ch.cast.quad(P3(f, -0.2, ey + 0.24, 0), P3(f, f.L + 0.2, ey + 0.24, 0), P3(f, f.L + 0.2, ey - 0.08, D), P3(f, -0.2, ey - 0.08, D), [-f.nx * 0.32, -0.95, -f.nz * 0.32], 0.7);
    fbox(ch.fine, f, -0.2, f.L + 0.2, ey - 0.1, ey + 0.02, D - 0.04, D + 0.02, [0.5, 0.52, 0.56]);
    // 二樓：蟲籠窗（白牆上的直條小窗）或格子窗
    if (H - F1 > 1.6) for (const u of bays(f.L, 2.6, 0.6)) {
      const y0 = F1 + 0.95, y1 = Math.min(H - 0.35, y0 + 1.0);
      if (rng() < 0.6) {
        fpanel(ch.fine, f, u - 0.6, u + 0.6, y0, y1, 0.01, DARK);
        for (let x = u - 0.52; x < u + 0.55; x += 0.16) fbox(ch.fine, f, x, x + 0.07, y0, y1, 0, 0.05, 0.98, { top: false });
      } else {
        fpanel(ch.fine, f, u - 0.7, u + 0.7, y0, y1, 0.01, GLASS);
        G.quad(P3(f, u - 0.7, y0, 0.04), P3(f, u + 0.7, y0, 0.04), P3(f, u + 0.7, y1, 0.04), P3(f, u - 0.7, y1, 0.04), [f.nx, 0, f.nz], 0.68,
          [[0, 0], [1.4 * S, 0], [1.4 * S, (y1 - y0) * S * 0.5], [0, (y1 - y0) * S * 0.5]]);
      }
    }
  }
}

// 四坡瓦頂：照最小外接矩形，四周出挑；寺社的屋頂比較陡、出挑比較大
export function kyotoRoof(ch, b, H) {
  if (!b.ob) return;
  const [cx, cz, ux, uz, L0, W0] = b.ob;
  const temple = b.k === 't';
  const ov = temple ? 1.3 : 0.55, L = L0 + 2 * ov, W = W0 + 2 * ov;
  const rise = (W / 2) * (temple ? 0.75 : 0.55), y0 = H - 0.05, y1 = y0 + rise;
  const vx = -uz, vz = ux;   // 橫向
  const Pt = (a, c, y) => [cx + ux * a + vx * c, y, cz + uz * a + vz * c];
  const ridge = Math.max(0, L / 2 - W / 2);
  const c0 = Pt(-L / 2, -W / 2, y0), c1 = Pt(L / 2, -W / 2, y0), c2 = Pt(L / 2, W / 2, y0), c3 = Pt(-L / 2, W / 2, y0);
  const r0 = Pt(-ridge, 0, y1), r1 = Pt(ridge, 0, y1);
  const nrm = (a, bb, c) => { const ax = bb[0] - a[0], ay = bb[1] - a[1], az = bb[2] - a[2], bx = c[0] - a[0], by = c[1] - a[1], bz = c[2] - a[2]; let n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]; const l = Math.hypot(...n) || 1; n = n.map((v) => v / l); return n[1] < 0 ? n.map((v) => -v) : n; };
  const B = ch.cast;
  B.quad(c0, c1, r1, r0, nrm(c0, c1, r1), TILE);                 // 長邊兩面
  B.quad(c2, c3, r0, r1, nrm(c2, c3, r0), TILE);
  B.tri(c1, c2, r1, nrm(c1, c2, r1), TILE, TILE, TILE);          // 兩端斜面
  B.tri(c3, c0, r0, nrm(c3, c0, r0), TILE, TILE, TILE);
  // 屋簷下緣（看得到的一圈底面）與屋脊
  const d0 = Pt(-L / 2, -W / 2, y0 - 0.12), d1 = Pt(L / 2, -W / 2, y0 - 0.12), d2 = Pt(L / 2, W / 2, y0 - 0.12), d3 = Pt(-L / 2, W / 2, y0 - 0.12);
  for (const [a, bb, c, d] of [[c0, c1, d1, d0], [c1, c2, d2, d1], [c2, c3, d3, d2], [c3, c0, d0, d3]]) {
    const n = [(a[0] + bb[0]) / 2 - cx, 0, (a[2] + bb[2]) / 2 - cz], l = Math.hypot(n[0], n[2]) || 1;
    B.quad(a, bb, c, d, [n[0] / l, 0, n[2] / l], [0.5, 0.52, 0.56]);
  }
  if (ridge > 0.2) wbox(ch.fine, cx, cz, ux, uz, ridge + 0.3, 0.16, y1 - 0.05, y1 + 0.22, [0.5, 0.52, 0.56]);
}

// ======================= 巴黎 =======================
export function parisFacades(ch, b, edges, rng, H) {
  const GF = 4.2, FH = 3.0, floors = Math.max(1, Math.round((H - 0.6 - GF) / FH));
  let door = false;
  for (const [ei, f] of edges.entries()) {
    // 一樓：大櫥窗＋招牌帶，一扇公寓大門
    fbox(ch.cast, f, 0, f.L, GF - 0.35, GF, 0, 0.16, 1, { bottom: true });
    const us = bays(f.L, 3.0, 0.9);
    us.forEach((u, i) => {
      if (!door && ei === 0 && i === us.length - 1) {
        door = true;
        archPanel(ch.fine, f, u, 1.6, 0, 2.6, DARK);
        fbox(ch.fine, f, u - 0.95, u + 0.95, 0, 0.15, 0, 0.1, 0.9);
        return;
      }
      fpanel(ch.fine, f, u - 1.15, u + 1.15, 0.35, 3.05, 0.01, GLASS);
      fbox(ch.fine, f, u - 1.25, u + 1.25, 0, 0.35, 0, 0.08, 0.86);
      fbox(ch.fine, f, u - 1.25, u + 1.25, 3.05, 3.55, 0, 0.12, [0.32, 0.34, 0.4]);   // 招牌
      fbox(ch.fine, f, u - 1.25, u - 1.15, 0.35, 3.05, 0, 0.08, IRON); fbox(ch.fine, f, u + 1.15, u + 1.25, 0.35, 3.05, 0, 0.08, IRON);
    });
    for (let u = 0.6; u < f.L; u += 0.5) fbox(ch.fine, f, u, u + 0.03, GF + 0.1, GF + FH - 0.2, 0, 0.02, 0.94, { top: false });   // 石材縫（細）
    // 樓上：落地窗＋鑄鐵小陽台；第二層與最上層整排陽台
    const ws = bays(f.L, 2.4, 0.8);
    for (let k = 0; k < floors; k++) {
      const y0 = GF + k * FH + 0.25, wh = k === floors - 1 ? 2.0 : 2.35;
      if (y0 + wh > H - 0.55) break;
      const continuous = k === 1 || k === floors - 1;
      if (continuous) {
        fbox(ch.cast, f, 0, f.L, y0 - 0.14, y0, 0, 0.75, 0.97, { bottom: true });
        railing(ch.fine, f, 0.05, f.L - 0.05, y0, 0.7, 0.95);
      }
      for (const u of ws) {
        const u0 = u - 0.55, u1 = u + 0.55;
        fpanel(ch.fine, f, u0, u1, y0, y0 + wh, 0.01, GLASS);
        fbox(ch.fine, f, u - 0.03, u + 0.03, y0, y0 + wh, 0.01, 0.04, 0.95, { top: false });
        fbox(ch.fine, f, u0 - 0.12, u0, y0, y0 + wh, 0, 0.08, 1); fbox(ch.fine, f, u1, u1 + 0.12, y0, y0 + wh, 0, 0.08, 1);
        fbox(ch.fine, f, u0 - 0.2, u1 + 0.2, y0 + wh, y0 + wh + 0.16, 0, 0.14, 1, { bottom: true });   // 窗楣
        if (!continuous) railing(ch.fine, f, u0 - 0.06, u1 + 0.06, y0, 0.22, 0.8);
      }
    }
    fbox(ch.cast, f, -0.08, f.L + 0.08, H - 0.55, H, 0, 0.4, 1, { bottom: true });           // 屋簷
  }
}

// 斜屋頂（mansard）：牆頂往內 1.1 m、升高 2.6 m；斜面上有老虎窗，頂上幾座煙囪
export function parisRoof(ch, b, ring, sg, rng, H) {
  const D = 1.1, R = 2.6, n = ring.length, top = H + R;
  const B = ch.cast;
  const off = (f, u) => P3(f, u, top, -D);
  for (let i = 0; i < n; i++) {
    const f = edgeFrame(ring, i, sg);
    if (!(f.L > 0.05)) continue;
    const nl = Math.hypot(R, D), N = [f.nx * R / nl, D / nl, f.nz * R / nl];
    B.quad(P3(f, 0, H, 0), P3(f, f.L, H, 0), off(f, f.L), off(f, 0), N, ZINC);
    // 轉角補縫（只有凸角會留縫；凹角兩片斜面本來就交疊，補了會長出尖刺）
    const g = edgeFrame(ring, (i + 1) % n, sg);
    const convex = (f.ux * g.uz - f.uz * g.ux) * sg > 0;
    if (g.L > 0.05 && convex) B.tri(P3(f, f.L, H, 0), off(f, f.L), P3(g, 0, top, -D), [f.nx + g.nx, 1, f.nz + g.nz], ZINC, ZINC, ZINC);
    // 老虎窗
    if (f.L > 3) for (const u of bays(f.L, 2.4, 1.0)) {
      if (rng() < 0.25) continue;
      const w0 = -0.55, y0 = H + 0.35;
      fbox(ch.fine, f, u - 0.42, u + 0.42, y0, y0 + 1.25, w0 - 0.45, w0 + 0.1, 0.98);
      fpanel(ch.fine, f, u - 0.28, u + 0.28, y0 + 0.12, y0 + 1.05, w0 + 0.11, GLASS);
      pediment(ch.fine, f, u - 0.5, u + 0.5, y0 + 1.25, 0.35, w0 + 0.12, 0.98);
    }
  }
  if (b.mi) {
    const mi = [];
    for (let i = 0; i < b.mi.length; i += 2) mi.push([b.mi[i], b.mi[i + 1]]);
    ch.polys.push({ ring: mi, holes: [], y: top, k: ZINC[0], up: true });
    const [cx, cz] = centroid(mi);
    for (let k = 0; k < 2; k++) if (rng() < 0.7) {
      const x = cx + (rng() - 0.5) * 3, z = cz + (rng() - 0.5) * 3;
      wbox(B, x, z, 1, 0, 0.7, 0.3, top - 0.1, top + 1.4, 0.95);
      for (let j = 0; j < 4; j++) cylinder(ch.fine, x - 0.45 + j * 0.3, z, 0.07, top + 1.4, top + 1.75, 6, [0.7, 0.55, 0.5]);
    }
  }
}

// ======================= 地標 =======================
export function landmark(ch, b, ring) {
  if (b.lm === 'obelisk') return obelisk(ch, ring);
  if (!b.ob) return;
  if (b.lm === 'pantheon') return pantheon(ch, b);
  if (b.lm === 'pagoda') return pagoda(ch, b);
  if (b.lm === 'notredame') return notreDame(ch, b);
}

// 地標的局部座標：a 沿長軸、c 橫向
function frame(b) {
  const [cx, cz, ux, uz, L, W] = b.ob;
  const vx = -uz, vz = ux;
  return { cx, cz, ux, uz, vx, vz, L, W, P: (a, c) => [cx + ux * a + vx * c, cz + uz * a + vz * c] };
}
// 局部座標的方塊：a 從 a0 到 a1、c 從 c0 到 c1
function lbox(B, F, a0, a1, c0, c1, y0, y1, k) {
  const [x, z] = F.P((a0 + a1) / 2, (c0 + c1) / 2);
  wbox(B, x, z, F.ux, F.uz, Math.abs(a1 - a0) / 2, Math.abs(c1 - c0) / 2, y0, y1, k);
}
// 局部座標的直牆面（給 fbox／archPanel 用）：在 a=aw 的面上、朝 +a（dir=1）或 −a
function lface(F, aw, c0, c1, dir) {
  const [x0, z0] = F.P(aw, dir > 0 ? c1 : c0), [x1, z1] = F.P(aw, dir > 0 ? c0 : c1);
  const L = Math.hypot(x1 - x0, z1 - z0);
  return { ax: x0, az: z0, ux: (x1 - x0) / L, uz: (z1 - z0) / L, nx: F.ux * dir, nz: F.uz * dir, L };
}
function sideFace(F, cw, a0, a1, dir) {   // 在 c=cw 的面上、朝 +c 或 −c
  const [x0, z0] = F.P(dir > 0 ? a0 : a1, cw), [x1, z1] = F.P(dir > 0 ? a1 : a0, cw);
  const L = Math.hypot(x1 - x0, z1 - z0);
  return { ax: x0, az: z0, ux: (x1 - x0) / L, uz: (z1 - z0) / L, nx: F.vx * dir, nz: F.vz * dir, L };
}
// 三角山牆（在 a=aw 的面上，c0..c1、底 y、高 h），帶厚度 d（往 −dir 方向）
function gable(B, F, aw, c0, c1, y, h, d, dir, k) {
  const cm = (c0 + c1) / 2, Q = (a, c, yy) => { const [x, z] = F.P(a, c); return [x, yy, z]; };
  const N = [F.ux * dir, 0, F.uz * dir];
  B.tri(Q(aw, c0, y), Q(aw, c1, y), Q(aw, cm, y + h), N, k, k, k);
  B.tri(Q(aw - d * dir, c0, y), Q(aw - d * dir, cm, y + h), Q(aw - d * dir, c1, y), [-N[0], 0, -N[2]], k, k, k);
}
// 兩坡屋頂（沿 a，屋脊在 c=cm）
function gableRoof(B, F, a0, a1, c0, c1, y, h, k) {
  const cm = (c0 + c1) / 2, Q = (a, c, yy) => { const [x, z] = F.P(a, c); return [x, yy, z]; };
  const w = (c1 - c0) / 2, l = Math.hypot(w, h);
  B.quad(Q(a0, c0, y), Q(a1, c0, y), Q(a1, cm, y + h), Q(a0, cm, y + h), [-F.vx * h / l, w / l, -F.vz * h / l], k);
  B.quad(Q(a1, c1, y), Q(a0, c1, y), Q(a0, cm, y + h), Q(a1, cm, y + h), [F.vx * h / l, w / l, F.vz * h / l], k);
}

// 萬神殿：南邊圓殿＋淺圓頂（頂上圓孔）、中間過渡塊、北邊 16 根柱子的門廊＋山牆
function pantheon(ch, b) {
  const F = frame(b), B = ch.cast;
  const R = F.W / 2 - 0.5, ac = -F.L / 2 + R + 0.5;   // 圓殿中心（長軸往南那端）
  const [rx, rz] = F.P(ac, 0);
  // 圓殿：三段牆＋兩道腰線
  cylinder(B, rx, rz, R, 0, 30, 40, 1, false);
  for (const y of [12.4, 22]) cylinder(ch.fine, rx, rz, R + 0.25, y, y + 0.5, 40, 1, false);
  // 圓頂：底下兩圈階梯，再一個壓扁的半球；頂上圓孔
  cylinder(B, rx, rz, R - 1.2, 30, 31.4, 40, 0.97); cylinder(B, rx, rz, R - 3, 31.4, 32.6, 40, 0.96);
  const seg = 40, rings = 7, Rd = R - 3.3, hd = 10.5;
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) {
    const t0 = j / rings, t1 = (j + 1) / rings, rr0 = Math.cos(t0 * Math.PI / 2) * Rd, rr1 = Math.cos(t1 * Math.PI / 2) * Rd;
    if (rr1 < 4.5) continue;   // 圓孔（直徑 9 m）
    const a0 = (i / seg) * 6.283, a1 = ((i + 1) / seg) * 6.283;
    const pt = (rr, t, a) => [rx + Math.cos(a) * rr, 32.6 + Math.sin(t * Math.PI / 2) * hd, rz + Math.sin(a) * rr];
    const m = (a0 + a1) / 2, n = [Math.cos(m) * Math.cos(t0), Math.sin(t0 * 1.2) + 0.3, Math.sin(m) * Math.cos(t0)];
    B.quad(pt(rr0, t0, a0), pt(rr0, t0, a1), pt(rr1, t1, a1), pt(rr1, t1, a0), n, 0.97);
  }
  cylinder(ch.fine, rx, rz, 4.6, 32.6 + hd * 0.97, 32.6 + hd * 0.97 + 0.4, 24, 0.95, false);
  // 過渡塊（比門廊高的那塊）＋門廊
  const aBlock0 = ac + R - 2, aBlock1 = aBlock0 + 8, aPort = F.L / 2 - 0.3, half = 16.5;
  lbox(B, F, aBlock0, aBlock1, -17, 17, 0, 24, 1);
  gable(B, F, aBlock1, -17, 17, 24, 6.5, 2, 1, 1);
  gableRoof(B, F, aBlock0, aBlock1, -17.2, 17.2, 24, 6.5, 0.94);
  lbox(B, F, aBlock1, aPort, -half - 0.3, half + 0.3, 0, 1.2, 0.95);           // 台階／基座
  for (const a of [aPort - 1.4, aPort - 6.2, aPort - 10.8]) {
    const cs = a === aPort - 1.4 ? [-14.4, -10.3, -6.2, -2.06, 2.06, 6.2, 10.3, 14.4] : [-14.4, -6.2, 6.2, 14.4];
    for (const c of cs) {
      const [x, z] = F.P(a, c);
      cylinder(B, x, z, 0.75, 1.2, 13.4, 14, 0.98);
      cylinder(ch.fine, x, z, 0.95, 1.2, 1.6, 14, 0.95);
      wbox(ch.fine, x, z, F.ux, F.uz, 0.95, 0.95, 13.4, 14.1, 1);              // 柱頭
    }
  }
  lbox(B, F, aBlock1, aPort, -half, half, 14.1, 16.8, 1);                       // 簷部（寫著 M·AGRIPPA 的那條）
  const fr = lface(F, aPort, -half, half, 1);
  fpanel(ch.fine, fr, half - 6, half + 6, 15.0, 15.9, 0.01, [0.78, 0.8, 0.84]);
  gable(B, F, aPort, -half, half, 16.8, 6.8, 1.2, 1, 1);
  gableRoof(B, F, aBlock1, aPort, -half - 0.2, half + 0.2, 16.8, 6.8, 0.93);
  const fd = lface(F, aBlock1 + 0.02, -6, 6, 1);   // 門（門廊深處）
  archPanel(ch.fine, fd, fd.L / 2, 5.2, 1.2, 9, DARK);
}

// 八坂塔：石基壇＋五層塔身（每層往上縮），每層一圈出挑很大的瓦頂，頂上相輪
function pagoda(ch, b) {
  const F = frame(b), B = ch.cast;
  const [cx, cz] = F.P(0, 0);
  const base = Math.min(F.L, F.W) * 0.86;
  lbox(B, F, -base / 2, base / 2, -base / 2, base / 2, 0, 1.1, 0.9);
  let y = 1.1;
  for (let i = 0; i < 5; i++) {
    const s = 6.6 - i * 0.62, h = i === 0 ? 4.9 : 4.1, ov = 2.5 - i * 0.12;
    lbox(B, F, -s / 2, s / 2, -s / 2, s / 2, y, y + h, 0.97);                     // 塔身
    for (const k of [-1, 1]) for (const kk of [-1, 1]) {                           // 四角柱
      const [x, z] = F.P(k * (s / 2 - 0.15), kk * (s / 2 - 0.15));
      cylinder(ch.fine, x, z, 0.16, y, y + h, 6, WOOD);
    }
    if (i > 0) {   // 欄杆
      for (const [aw, dir] of [[s / 2 + 0.35, 1], [-s / 2 - 0.35, -1]]) fbox(ch.fine, lface(F, aw, -s / 2 - 0.35, s / 2 + 0.35, dir), 0, s + 0.7, y, y + 0.7, -0.05, 0.03, IRON);
      for (const [cw, dir] of [[s / 2 + 0.35, 1], [-s / 2 - 0.35, -1]]) fbox(ch.fine, sideFace(F, cw, -s / 2 - 0.35, s / 2 + 0.35, dir), 0, s + 0.7, y, y + 0.7, -0.05, 0.03, IRON);
    }
    for (const [aw, dir] of [[s / 2, 1], [-s / 2, -1]]) archPanel(ch.fine, lface(F, aw, -1.1, 1.1, dir), 1.1, 1.5, y + 0.4, y + 2.2, DARK);
    // 屋頂：四角上翹的寬簷（四坡、坡很緩，下面一圈屋簷底）
    const e = s / 2 + ov, yt = y + h, ry = yt + 1.5, ri = s / 2 * 0.55;
    const Q = (a, c, yy) => { const [x, z] = F.P(a, c); return [x, yy, z]; };
    const lift = 0.45;
    const corner = (sa, sc) => Q(sa * e, sc * e, yt + lift);
    const mid = (sa, sc) => Q(sa * e * (sc === 0 ? 1 : 0), sc * e * (sa === 0 ? 1 : 0), yt);
    for (const [sa, sc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      // 每一面：兩個角（上翹）＋中間點（較低）連到上面的小方框
      const ca = sa !== 0 ? [corner(sa, -1), corner(sa, 1)] : [corner(1, sc), corner(-1, sc)];
      const ia = sa !== 0 ? [Q(sa * ri, -ri, ry), Q(sa * ri, ri, ry)] : [Q(ri, sc * ri, ry), Q(-ri, sc * ri, ry)];
      const m = mid(sa, sc);
      const n = [F.ux * sa + F.vx * sc, 1.2, F.uz * sa + F.vz * sc];
      B.tri(ca[0], m, ia[0], n, TILE, TILE, TILE); B.tri(m, ca[1], ia[1], n, TILE, TILE, TILE); B.tri(m, ia[1], ia[0], n, TILE, TILE, TILE);
      // 屋簷底面（從下面看得到的那片）：上翹的角、中點連回塔身
      const bc = sa !== 0 ? [Q(sa * s / 2, -s / 2, yt - 0.05), Q(sa * s / 2, s / 2, yt - 0.05)] : [Q(s / 2, sc * s / 2, yt - 0.05), Q(-s / 2, sc * s / 2, yt - 0.05)];
      const mm = [m[0], m[1] - 0.12, m[2]], c0 = [ca[0][0], ca[0][1] - 0.12, ca[0][2]], c1 = [ca[1][0], ca[1][1] - 0.12, ca[1][2]];
      B.tri(c0, bc[0], mm, [0, -1, 0], 0.62, 0.62, 0.62); B.tri(mm, bc[1], c1, [0, -1, 0], 0.62, 0.62, 0.62); B.tri(mm, bc[0], bc[1], [0, -1, 0], 0.62, 0.62, 0.62);
      // 簷口：角到中點兩段薄板（看得出瓦簷的厚度）
      B.quad(ca[0], m, mm, c0, [n[0], 0, n[2]], 0.5); B.quad(m, ca[1], c1, mm, [n[0], 0, n[2]], 0.5);
    }
    lbox(B, F, -ri, ri, -ri, ri, ry - 0.2, ry + 0.25, 0.6);
    y = ry;
  }
  // 相輪：細柱＋九個圓輪＋寶珠
  cylinder(B, cx, cz, 0.35, y, y + 1.2, 10, 0.6);
  cylinder(ch.fine, cx, cz, 0.12, y + 1.2, 46, 8, 0.5);
  for (let k = 0; k < 9; k++) cylinder(ch.fine, cx, cz, 0.42 - k * 0.015, y + 2 + k * 0.72, y + 2.12 + k * 0.72, 12, 0.55);
  cylinder(ch.fine, cx, cz, 0.3, 45.4, 46, 10, 0.6);
}

// 聖母院：西立面雙塔＋三座尖拱門＋玫瑰窗、高中殿＋陡屋頂、兩側低側廊＋飛扶壁、十字翼、東端半圓殿、交叉處尖塔
function notreDame(ch, b) {
  const F = frame(b), B = ch.cast;
  const aW = F.L / 2 - 2, aE = -F.L / 2 + 12;      // a＋＝西
  const tw = 11, fw = 20.5;                        // 鐘樓寬、立面半寬
  const Q = (a, c, yy) => { const [x, z] = F.P(a, c); return [x, yy, z]; };
  // 中殿＋詩班席（高 33，屋脊 43）
  lbox(B, F, aE, aW - 10, -6.5, 6.5, 0, 33, 1);
  gableRoof(B, F, aE, aW - 10, -7, 7, 33, 10, ZINC[0] * 0.95);
  // 側廊（兩側各兩條，高 14 / 10）
  for (const s of [-1, 1]) {
    lbox(B, F, aE, aW - 10, s * 6.5, s * 13, 0, 14, 0.98);
    lbox(B, F, aE, aW - 10, s * 13, s * 19, 0, 10, 0.97);
    // 側廊上的高窗（中殿牆）與尖拱窗
    const sf = sideFace(F, s * 6.5, aE, aW - 10, s);
    for (let u = 2; u < sf.L - 2; u += 6.6) archPanel(ch.fine, sf, u, 2.2, 18, 25, DARK);
    const sf2 = sideFace(F, s * 19, aE, aW - 10, s);
    for (let u = 2; u < sf2.L - 2; u += 6.6) {
      archPanel(ch.fine, sf2, u, 1.8, 2.5, 6.8, DARK);
      // 飛扶壁：外牆的扶壁墩往上斜撐到中殿牆
      const a = aE + u * (sf2.L ? (aW - 10 - aE) / sf2.L : 1);
      lbox(B, F, a - 0.7, a + 0.7, s * 19, s * 20.6, 0, 17, 0.97);
      const p0 = Q(a, s * 20.2, 17), p1 = Q(a, s * 6.7, 27.5), p2 = Q(a, s * 6.7, 26.2), p3 = Q(a, s * 20.2, 15.6);
      for (const da of [-0.35, 0.35]) {
        const off = (p) => [p[0] + F.ux * da, p[1], p[2] + F.uz * da];
        B.quad(off(p0), off(p1), off(p2), off(p3), [F.ux * Math.sign(da), 0, F.uz * Math.sign(da)], 0.96);
      }
      B.quad(Q(a - 0.35, s * 20.2, 17), Q(a + 0.35, s * 20.2, 17), Q(a + 0.35, s * 6.7, 27.5), Q(a - 0.35, s * 6.7, 27.5), [F.vx * s * 0.6, 0.8, F.vz * s * 0.6], 0.98);
      cylinder(ch.fine, ...F.P(a, s * 19.8), 0.35, 17, 20, 6, 0.95);   // 小尖塔
    }
    gableRoof(B, F, aE, aW - 10, s > 0 ? 6.5 : -19, s > 0 ? 19 : -6.5, 14 - 0.01, 0.01, 0.9);
  }
  // 十字翼（橫跨，兩端山牆＋玫瑰窗）
  const aT = aE + (aW - 10 - aE) * 0.55;
  lbox(B, F, aT - 7, aT + 7, -24, 24, 0, 33, 1);
  for (const s of [-1, 1]) {
    const st = sideFace(F, s * 24, aT - 7, aT + 7, s);
    archPanel(ch.fine, st, 7, 3.2, 1, 7, DARK);
    discPanel(ch.fine, st, 7, 21.5, 4.4, 0.03, DARK);
  }
  // 十字翼屋頂（橫向兩坡）
  const Qc = (a, c, y) => Q(a, c, y);
  for (const s of [-1, 1]) {
    const n = [F.ux * s, 0.7, F.uz * s];
    B.quad(Qc(aT + 7 * s, -24, 33), Qc(aT + 7 * s, 24, 33), Qc(aT, 24, 43), Qc(aT, -24, 43), n, ZINC[0] * 0.95);
  }
  // 東端半圓殿
  const [ax, az] = F.P(aE, 0);
  cylinder(B, ax, az, 6.5, 0, 33, 16, 1, false);
  cylinder(B, ax, az, 13, 0, 14, 20, 0.98, true);
  for (let i = 0; i < 10; i++) {   // 半圓殿的錐形屋頂（只做朝東那半）
    const a0 = Math.PI / 2 + (i / 10) * Math.PI, a1 = Math.PI / 2 + ((i + 1) / 10) * Math.PI;
    const pt = (r, a, y) => { const lc = Math.cos(a) * r, la = Math.sin(a) * r; return [ax - F.ux * la + F.vx * lc, y, az - F.uz * la + F.vz * lc]; };
    const m = (a0 + a1) / 2;
    B.tri(pt(6.6, a0, 33), pt(6.6, a1, 33), [ax, 41, az], [-F.ux * Math.sin(m) + F.vx * Math.cos(m), 0.8, -F.uz * Math.sin(m) + F.vz * Math.cos(m)], ZINC[0] * 0.95, ZINC[0] * 0.95, ZINC[0] * 0.95);
  }
  // 交叉處尖塔（八角錐，到 96 m）
  const [sx, sz] = F.P(aT, 0);
  cylinder(B, sx, sz, 2.4, 43, 52, 8, 0.9);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * 6.283, a1 = ((i + 1) / 8) * 6.283;
    B.tri([sx + Math.cos(a0) * 2.4, 52, sz + Math.sin(a0) * 2.4], [sx + Math.cos(a1) * 2.4, 52, sz + Math.sin(a1) * 2.4], [sx, 96, sz], [Math.cos((a0 + a1) / 2), 0.15, Math.sin((a0 + a1) / 2)], 0.88, 0.88, 0.88);
  }
  // 西立面：整面高到 43，兩座方塔到 69；三座尖拱門、玫瑰窗、國王廊、塔上的長窗
  lbox(B, F, aW - 10, aW, -fw, fw, 0, 43, 1);
  for (const s of [-1, 1]) {
    lbox(B, F, aW - 10.5, aW + 0.3, s * (fw - tw / 2) - tw / 2, s * (fw - tw / 2) + tw / 2, 43, 63, 1);
    lbox(B, F, aW - 10.8, aW + 0.6, s * (fw - tw / 2) - tw / 2 - 0.3, s * (fw - tw / 2) + tw / 2 + 0.3, 63, 64.2, 0.96);
    for (const [aw, dir] of [[aW + 0.3, 1], [aW - 10.5, -1]]) {
      const tf = lface(F, aw, s * (fw - tw / 2) - tw / 2, s * (fw - tw / 2) + tw / 2, dir);
      archPanel(ch.fine, tf, tw * 0.32, 1.7, 46, 58, DARK); archPanel(ch.fine, tf, tw * 0.68, 1.7, 46, 58, DARK);
    }
    for (const dir of [1, -1]) {
      const tc = s * (fw - tw / 2) + dir * tw / 2;
      const tf = sideFace(F, tc, aW - 10.5, aW + 0.3, dir);
      archPanel(ch.fine, tf, tf.L * 0.32, 1.7, 46, 58, DARK); archPanel(ch.fine, tf, tf.L * 0.68, 1.7, 46, 58, DARK);
    }
  }
  const wf = lface(F, aW, -fw, fw, 1);
  for (const [u, w, h] of [[fw, 5.2, 7.5], [fw - 13, 4.2, 6.5], [fw + 13, 4.2, 6.5]]) {
    archPanel(ch.fine, wf, u, w, 0, h, DARK);
    for (let k = 0; k < 3; k++) fbox(ch.fine, wf, u - w / 2 - 0.9 + k * 0.05, u + w / 2 + 0.9 - k * 0.05, h + w / 2 + 0.4 + k * 0.5, h + w / 2 + 0.6 + k * 0.5, 0, 0.3 - k * 0.08, 0.95);
  }
  fbox(B, wf, 0, wf.L, 13.5, 16, 0, 0.6, 0.97, { bottom: true });                // 國王廊
  for (let u = 1; u < wf.L - 0.5; u += 1.45) fbox(ch.fine, wf, u, u + 0.5, 13.6, 15.8, 0.5, 0.62, DARK);
  discPanel(ch.fine, wf, fw, 25, 4.8, 0.03, DARK);                                 // 玫瑰窗
  fbox(B, wf, 0, wf.L, 36, 37, 0, 0.5, 0.97, { bottom: true });                   // 上層迴廊
  for (let u = 1; u < wf.L - 0.5; u += 1.2) fbox(ch.fine, wf, u, u + 0.25, 37, 43, 0.3, 0.45, 0.96);
}

// 方尖碑（羅馬萬神殿前噴水池中央）：台座＋往上收的碑身＋金字塔尖
function obelisk(ch, ring) {
  const [cx, cz] = centroid(ring), B = ch.cast;
  wbox(B, cx, cz, 1, 0, 1.3, 1.3, 0, 2.2, 0.95);
  wbox(ch.fine, cx, cz, 1, 0, 1.45, 1.45, 2.2, 2.45, 1);
  const h0 = 2.45, h1 = 13.6, r0 = 0.62, r1 = 0.42;
  const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < 4; i++) {
    const [a, c] = cs[i], [a2, c2] = cs[(i + 1) % 4];
    const n = [(a + a2) / 2, 0.05, (c + c2) / 2];
    B.quad([cx + a * r0, h0, cz + c * r0], [cx + a2 * r0, h0, cz + c2 * r0], [cx + a2 * r1, h1, cz + c2 * r1], [cx + a * r1, h1, cz + c * r1], n, 0.92);
    B.tri([cx + a * r1, h1, cz + c * r1], [cx + a2 * r1, h1, cz + c2 * r1], [cx, h1 + 0.9, cz], [(a + a2) / 2, 0.5, (c + c2) / 2], 0.92, 0.92, 0.95);
  }
  cylinder(ch.fine, cx, cz, 0.08, h1 + 0.9, h1 + 1.3, 6, 0.6);
}

