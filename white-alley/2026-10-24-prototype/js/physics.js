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
  if (s.y <= CFG.STONE_R) return { type: 'ground', px, py, pz };
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
