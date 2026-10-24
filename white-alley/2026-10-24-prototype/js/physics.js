// 彈道：模擬、預覽、機器人瞄準共用同一套積分，預覽畫的線就是石頭真正會走的路。
import { CFG } from './config.js';

export const SUB = 4;   // 每 tick 分幾步積分

export function forward(yaw, pitch) {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

export function throwOrigin(x, z, yaw) {
  const [r, u, f] = CFG.HAND_OFS;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);   // 水平前方
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);    // 右方
  return { x: x + rx * r + fx * f, y: CFG.EYE + u, z: z + rz * r + fz * f };
}

export function chargeSpeed(charge) {
  return CFG.V_MIN + (CFG.V_MAX - CFG.V_MIN) * Math.max(0, Math.min(1, charge));
}

// 前進一小步並檢查有沒有撞到地面／屋頂／牆。s = {x,y,z,vx,vy,vz}
export function advance(map, s, h) {
  const px = s.x, py = s.y, pz = s.z;
  s.vy -= CFG.G * h;
  s.x += s.vx * h; s.y += s.vy * h; s.z += s.vz * h;
  if (!map.inGrid(s.x, s.z) || s.y < -2) return { type: 'out', px, py, pz };
  // 先看建物再看地面：貼地滾進牆腳的石頭要算撞牆（反彈回巷子），不能算落地落在建物裡
  const hh = map.heightAt(s.x, s.z);
  if (s.y < hh) {
    if (py >= hh - 0.02) return { type: 'roof', px, py, pz, h: hh };
    const hx = map.heightAt(s.x, pz) > s.y, hz = map.heightAt(px, s.z) > s.y;
    let nx = 0, nz = 0;
    if (hx) nx = -Math.sign(s.vx);
    if (hz) nz = -Math.sign(s.vz);
    if (!hx && !hz) { nx = -Math.sign(s.vx); nz = -Math.sign(s.vz); }
    return { type: 'wall', px, py, pz, nx, nz };
  }
  if (s.y <= CFG.STONE_R) return { type: 'ground', px, py, pz };
  return null;
}

// 打到誰：'head' | 'body' | null
export function hitPart(sx, sy, sz, q) {
  const dx = sx - q.x, dz = sz - q.z, hy = sy - CFG.HEAD_Y;
  const rr = CFG.HEAD_R + CFG.STONE_HIT_R;
  if (dx * dx + hy * hy + dz * dz < rr * rr) return 'head';
  const br = CFG.BODY_R + CFG.STONE_HIT_R;
  if (sy > 0 && sy < CFG.BODY_TOP + 0.03 && dx * dx + dz * dz < br * br) return 'body';
  return null;
}

// 預覽／機器人檢查：跑到第一個碰撞為止。players 給了就順便檢查會不會打到人。
export function simulateArc(map, o, v, { maxT = 3.2, players = null, ignoreId = -1, every = 2 } = {}) {
  const s = { x: o.x, y: o.y, z: o.z, vx: v.x, vy: v.y, vz: v.z };
  const h = CFG.TICK / SUB;
  const pts = [{ x: s.x, y: s.y, z: s.z }];
  const n = Math.ceil(maxT / h);
  for (let k = 1; k <= n; k++) {
    const c = advance(map, s, h);
    if (players) {
      for (const q of players) {
        if (!q.alive || q.id === ignoreId) continue;
        const part = hitPart(s.x, s.y, s.z, q);
        if (part) { pts.push({ x: s.x, y: s.y, z: s.z }); return { pts, hit: { type: 'player', part, id: q.id, x: s.x, y: s.y, z: s.z, t: k * h } }; }
      }
    }
    if (c) {
      const end = { x: s.x, y: c.type === 'ground' ? 0.01 : s.y, z: s.z };
      if (c.type === 'wall') { end.x = c.px; end.y = c.py; end.z = c.pz; }
      if (c.type === 'roof') end.y = c.h + 0.01;
      pts.push(end);
      return { pts, hit: { type: c.type, x: end.x, y: end.y, z: end.z, nx: c.nx || 0, nz: c.nz || 0, t: k * h } };
    }
    if (k % (SUB * every) === 0) pts.push({ x: s.x, y: s.y, z: s.z });
  }
  return { pts, hit: null };
}

// 要用初速 v 打到水平距離 d、高差 dh 的點，仰角是多少（low=true 取低弧）
export function solvePitch(d, dh, v, low = true) {
  const g = CFG.G, v2 = v * v;
  const disc = v2 * v2 - g * (g * d * d + 2 * dh * v2);
  if (disc < 0 || d < 0.01) return null;
  const r = Math.sqrt(disc);
  return Math.atan((v2 + (low ? -r : r)) / (g * d));
}

// 準心射線：從眼睛沿視線找第一個碰到的東西（其他人、地面、建物），最遠 maxD 公尺
export function raycast(map, ox, oy, oz, d, players = null, ignoreId = -1, maxD = 70) {
  const step = 0.1;
  for (let t = step; t <= maxD; t += step) {
    const x = ox + d.x * t, y = oy + d.y * t, z = oz + d.z * t;
    if (players) {
      for (const q of players) {
        if (!q.alive || q.id === ignoreId) continue;
        const part = hitPart(x, y, z, q);
        if (part) return { x, y, z, t, surf: 'player', player: q, part };
      }
    }
    if (y <= 0) return { x, y: 0, z, t, surf: 'ground' };
    if (!map.inGrid(x, z)) return { x, y, z, t, surf: 'air' };
    if (map.heightAt(x, z) > y) return { x, y, z, t, surf: 'wall' };
  }
  return { x: ox + d.x * maxD, y: oy + d.y * maxD, z: oz + d.z * maxD, t: maxD, surf: 'air' };
}

// 準心就是落點：要讓石頭從手上出發、落在 P，該往哪個方向、多少仰角、多快丟。
// 初速 = 蓄力給的速度與「剛好丟得到」的速度取大的（輕點也丟得到，蓄滿就丟得又平又快）；
// 低弧被牆擋住就改高弧；超出最遠射程就用最遠的角度丟（far = true，會落在準心前面）。
export function aimSolve(map, x, z, P, vBase, players = null, targetId = -1, meId = -1) {
  const g = CFG.G;
  let yaw = Math.atan2(-(P.x - x), -(P.z - z));
  let o = throwOrigin(x, z, yaw);
  yaw = Math.atan2(-(P.x - o.x), -(P.z - o.z));   // 出手點在右手邊，方向從手算回準心，修正視差
  o = throwOrigin(x, z, yaw);
  const d = Math.hypot(P.x - o.x, P.z - o.z), dh = P.y - o.y;
  const vNeed = Math.sqrt(g * (dh + Math.hypot(d, dh)));
  if (vNeed > CFG.V_MAX * 0.995) {
    const v = CFG.V_MAX, q = v * v - 2 * g * dh;
    return { yaw, pitch: q > 0 ? Math.atan(v / Math.sqrt(q)) : Math.PI / 4, v, far: true, o };
  }
  const v = Math.min(CFG.V_MAX, Math.max(vBase, vNeed * 1.03));
  const reaches = (pitch) => {
    const c = Math.cos(pitch);
    const arc = simulateArc(map, o, { x: -Math.sin(yaw) * c * v, y: Math.sin(pitch) * v, z: -Math.cos(yaw) * c * v }, { players, ignoreId: meId, maxT: 4, every: 8 });
    const h = arc.hit;
    if (!h) return false;
    if (h.type === 'player') return targetId < 0 || h.id === targetId;
    return Math.hypot(h.x - P.x, h.y - P.y, h.z - P.z) < 1.2;
  };
  const low = solvePitch(d, dh, v, true) ?? Math.PI / 4;
  if (reaches(low)) return { yaw, pitch: low, v, far: false, o };
  const high = solvePitch(d, dh, v, false);
  if (high != null && reaches(high)) return { yaw, pitch: high, v, far: false, o, lob: true };
  return { yaw, pitch: low, v, far: false, o, blocked: true };
}
