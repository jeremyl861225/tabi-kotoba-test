// 會擋路的建築小物：米克諾斯的外樓梯、石灰矮凳／花台，台北巷子裡停的機車。
// 碰撞（map.js）與畫面（facade.js）共用同一份規劃，兩邊永遠一致。不碰 Three。
import { mulberry32 } from './map.js';

export function ringOf(flat) {
  const pts = [];
  for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
  return pts;
}

export function ringSign(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) { const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length]; A += x0 * z1 - x1 * z0; }
  return A > 0 ? 1 : -1;
}

// 一條牆面的局部座標：沿牆 u、往外 w、往上 y
export function edgeFrame(pts, i, sg) {
  const [ax, az] = pts[i], [bx, bz] = pts[(i + 1) % pts.length];
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  return { ax, az, ux: dx / L, uz: dz / L, nx: (sg * dz) / L, nz: (-sg * dx) / L, L };
}

export const at = (f, u, w) => [f.ax + f.ux * u + f.nx * w, f.az + f.uz * u + f.nz * w];

// 牆外 w 公尺處是不是空地（不是別棟樓）
export function openAt(heightAt, f, u, w = 0.6) {
  const [x, z] = at(f, u, w);
  return heightAt(x, z) <= 0.05;   // 水面（0.02）也算空地：面河的牆照樣開窗
}

// 從牆往外量，空地有多深（最多 maxD）
export function clearance(heightAt, f, u, maxD = 8) {
  for (let w = 0.3; w <= maxD; w += 0.25) if (!openAt(heightAt, f, u, w)) return w - 0.25;
  return maxD;
}

function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }

export function planObstacles(data, heightAt) {
  const style = data.style || 'cyclades';
  const rng = mulberry32(hashStr(data.id) ^ 0x5bd1e995);
  const p = data.play;
  const out = [];
  const taken = [];   // 已放的中心點，避免擠在一起
  const free = (x, z, r) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
  const inPlay = (x, z) => x > p.minX + 1 && x < p.maxX - 1 && z > p.minZ + 1 && z < p.maxZ - 1;

  data.buildings.forEach((b, bi) => {
    const pts = ringOf(b.p);
    const sg = ringSign(pts);
    for (let i = 0; i < pts.length; i++) {
      const f = edgeFrame(pts, i, sg);
      if (f.L < 2.4) continue;
      const roll = rng();
      if (style === 'cyclades') {
        // 外樓梯：兩層樓、夠長的牆、外面空間夠寬
        if (b.f >= 2 && f.L >= 4.6 && roll < 0.2) {
          const rise = 0.22, run = 0.27, n = Math.round(3.1 / rise), len = n * run + 0.9;
          const u0 = 0.4 + rng() * Math.max(0, f.L - len - 0.8);
          if (u0 + len > f.L - 0.3) continue;
          const ok = [u0 + 0.2, u0 + len / 2, u0 + len - 0.2].every((u) => clearance(heightAt, f, u) >= 3.4);
          const [cx, cz] = at(f, u0 + len / 2, 0.5);
          if (ok && inPlay(cx, cz) && free(cx, cz, len / 2 + 0.5)) {
            out.push({ kind: 'stair', bi, f, u0, u1: u0 + len, w0: 0, w1: 0.95, n, rise, run, h: n * rise });
            taken.push({ x: cx, z: cz, r: len / 2 + 0.5 });
            continue;
          }
        }
        // 石灰矮凳／花台
        if (roll > 0.82 && f.L >= 2.6) {
          const len = 1.1 + rng() * Math.min(1.6, f.L - 1.6), u0 = 0.5 + rng() * (f.L - len - 1);
          const ok = [u0 + 0.1, u0 + len - 0.1].every((u) => clearance(heightAt, f, u) >= 3.0);
          const [cx, cz] = at(f, u0 + len / 2, 0.3);
          if (ok && inPlay(cx, cz) && free(cx, cz, len / 2 + 0.4)) {
            const planter = rng() < 0.45;
            out.push({ kind: planter ? 'planter' : 'bench', bi, f, u0, u1: u0 + len, w0: 0, w1: planter ? 0.6 : 0.48, h: planter ? 0.75 : 0.48 });
            taken.push({ x: cx, z: cz, r: len / 2 + 0.4 });
          }
        }
      } else if (style === 'taipei' && f.L >= 4 && roll < 0.32) {
        // 台北：一排機車，車頭朝外、間距 0.72 m
        const n = Math.min(8, 2 + Math.floor(rng() * Math.min(7, (f.L - 1.2) / 0.72)));
        const len = n * 0.72, u0 = 0.4 + rng() * Math.max(0, f.L - len - 0.8);
        if (u0 + len > f.L - 0.2) continue;
        const ok = [u0 + 0.2, u0 + len / 2, u0 + len - 0.2].every((u) => clearance(heightAt, f, u) >= 4.4);
        const [cx, cz] = at(f, u0 + len / 2, 1);
        if (ok && inPlay(cx, cz) && free(cx, cz, len / 2 + 0.6)) {
          for (let k = 0; k < n; k++) {
            const uc = u0 + 0.36 + k * 0.72 + (rng() - 0.5) * 0.08;
            out.push({ kind: 'scooter', bi, f, u0: uc - 0.3, u1: uc + 0.3, w0: 0.2, w1: 2.0, h: 1.15, tilt: (rng() - 0.5) * 0.12 });
          }
          taken.push({ x: cx, z: cz, r: len / 2 + 0.6 });
        }
      }
    }
  });
  return out;
}

// 障礙物 → 碰撞用的方塊（底面多邊形＋高度）
export function obstacleBoxes(o) {
  const quad = (u0, u1, w0, w1) => [at(o.f, u0, w0), at(o.f, u1, w0), at(o.f, u1, w1), at(o.f, u0, w1)];
  if (o.kind === 'stair') {
    const boxes = [];
    for (let k = 0; k < o.n; k++) boxes.push({ pts: quad(o.u0 + k * o.run, o.u0 + (k + 1) * o.run, o.w0, o.w1), h: (k + 1) * o.rise });
    boxes.push({ pts: quad(o.u0 + o.n * o.run, o.u1, o.w0, o.w1), h: o.h });   // 頂端平台
    return boxes;
  }
  return [{ pts: quad(o.u0, o.u1, o.w0, o.w1), h: o.h }];
}
