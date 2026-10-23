// 變形：把在「單位正方形」裡設計好的建築，貼進任意四邊形格子（雙線性內插）
// squares：[{ x0, z0, q: { fl, fr, br, bl } }]，每個正方形涵蓋局部 [x0, x0+1] × [z0, z0+1]，前方 = +z
import * as THREE from 'three';

export function makeWarp(G, squares) {
  const pts = squares.map((sq) => {
    const g = (v) => (Array.isArray(v) ? v : [G.X[v], G.Z[v]]);
    return { x0: sq.x0, z0: sq.z0, BL: g(sq.q.bl), BR: g(sq.q.br), FR: g(sq.q.fr), FL: g(sq.q.fl) };
  });
  function pick(x, z) {
    let best = pts[0], bd = Infinity;
    for (const p of pts) {
      const dx = Math.max(p.x0 - x, 0, x - (p.x0 + 1)), dz = Math.max(p.z0 - z, 0, z - (p.z0 + 1));
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  const out = [0, 0, 0, 0, 0, 0];
  function map(x, z) {
    const p = pick(x, z), u = x - p.x0, v = z - p.z0;
    const a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, d = (1 - u) * v;
    out[0] = p.BL[0] * a + p.BR[0] * b + p.FR[0] * c + p.FL[0] * d;
    out[1] = p.BL[1] * a + p.BR[1] * b + p.FR[1] * c + p.FL[1] * d;
    out[2] = (p.BR[0] - p.BL[0]) * (1 - v) + (p.FR[0] - p.FL[0]) * v; // dX/du
    out[3] = (p.BR[1] - p.BL[1]) * (1 - v) + (p.FR[1] - p.FL[1]) * v; // dZ/du
    out[4] = (p.FL[0] - p.BL[0]) * (1 - u) + (p.FR[0] - p.BR[0]) * u; // dX/dv
    out[5] = (p.FL[1] - p.BL[1]) * (1 - u) + (p.FR[1] - p.BR[1]) * u; // dZ/dv
    return out;
  }
  let cx = 0, cz = 0;
  for (const p of pts) { map(p.x0 + 0.5, p.z0 + 0.5); cx += out[0]; cz += out[1]; }
  return { map, ax: cx / pts.length, az: cz / pts.length };
}

// 相似變換（給三角形、五邊形這類不能變形的格子放小東西用）
export function makeSimWarp(x, z, yaw, scale) {
  const c = Math.cos(yaw), s = Math.sin(yaw), out = [0, 0, 0, 0, 0, 0];
  return {
    ax: x, az: z,
    map(lx, lz) {
      out[0] = x + (c * lx + s * lz) * scale; out[1] = z + (-s * lx + c * lz) * scale;
      out[2] = c * scale; out[3] = -s * scale; out[4] = s * scale; out[5] = c * scale;
      return out;
    },
  };
}

export function warpGeometry(geo, W) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const [X, Z, Xu, Zu, Xv, Zv] = W.map(p.getX(i), p.getZ(i));
    p.setXYZ(i, X - W.ax, p.getY(i), Z - W.az);
    if (n) {
      const det = Xu * Zv - Xv * Zu || 1e-6;
      const nx = n.getX(i), nz = n.getZ(i);
      const mx = (Zv * nx - Zu * nz) / det, mz = (-Xv * nx + Xu * nz) / det, my = n.getY(i);
      const l = Math.hypot(mx, my, mz) || 1;
      n.setXYZ(i, mx / l, my / l, mz / l);
    }
  }
  p.needsUpdate = true; if (n) n.needsUpdate = true;
  geo.computeBoundingSphere(); geo.computeBoundingBox();
  return geo;
}
export function warpPoint(v, W) {
  const [X, Z] = W.map(v.x, v.z);
  return new THREE.Vector3(X - W.ax, v.y, Z - W.az);
}
// 物件（旗子、水晶、水車）：外面包一層群組，放到變形後的位置並轉向
export function warpObject(obj, W) {
  const [X, Z, , , Xv, Zv] = W.map(obj.position.x, obj.position.z);
  const wrap = new THREE.Group();
  wrap.position.set(X - W.ax, 0, Z - W.az);
  wrap.rotation.y = Math.atan2(Xv, Zv);
  obj.position.x = 0; obj.position.z = 0;
  wrap.add(obj);
  return wrap;
}
