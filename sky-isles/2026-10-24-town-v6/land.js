// 連續地形＋自然河流＋海：河道刻進高度場，水位沿途只降不升，岸線由地形與水面相交自然切出
import * as THREE from 'three';
import { makeRng, fbm, vnoise, clamp, lerp, smooth, C, TAU } from './util.js';
import { P, M, merge, FX, NOISE, uTime } from './kit.js';

export const SEA_Y = 0;

export function makeLand(seed) {
  const r = makeRng(seed ^ 0x1b873593);
  const ox = r() * 200, oz = r() * 200;
  const ang = r() * TAU, sx = Math.cos(ang), sz = Math.sin(ang); // 往海的方向
  const ax = -sz, az = sx;                                     // 沿海岸方向
  const coastAt = (al) => 11 + (fbm(al * 0.05 + ox, 3.3) - 0.47) * 7;
  function base(x, z) {
    const u = x * sx + z * sz, al = x * ax + z * az;
    let h = (coastAt(al) - u) * 0.09 + (fbm(x * 0.06 + ox, z * 0.06 + oz) - 0.47) * 2.6 + (fbm(x * 0.17 - oz, z * 0.17 + ox) - 0.47) * 0.75;
    const back = -u - 15; if (back > 0) h += back * 0.3;
    const dc = Math.hypot(x, z);
    h = lerp(h * 0.55 + 0.42, h, smooth(3, 11, dc));
    if (h < 0) h *= 0.85;
    return h;
  }

  // ---------------- 河道：從內陸山區蜿蜒到海口
  const side = r() < 0.5 ? -1 : 1;
  const srcAl = side * (2 + r() * 4), mouthAl = -side * (1 + r() * 4);
  const pts = [];
  const NP = 9;
  for (let k = 0; k < NP; k++) {
    const t = k / (NP - 1);
    const u = lerp(-30, coastAt(lerp(srcAl, mouthAl, t)) + 5, t);
    const al = lerp(srcAl, mouthAl, t) + Math.sin(t * 7.5 + ox) * 2.6 * Math.sin(t * Math.PI) + (vnoise(k * 1.7, oz) - 0.5) * 1.6;
    pts.push(new THREE.Vector3(u * sx + al * ax, 0, u * sz + al * az));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  const NS = 700;
  const RP = curve.getSpacedPoints(NS).map((p) => ({ x: p.x, z: p.z }));
  // 水位：沿途只降不升，入海處為 0
  let s = 99;
  for (let k = 0; k <= NS; k++) {
    const b = base(RP[k].x, RP[k].z) - 0.14;
    s = Math.min(s, b);
    RP[k].s = Math.max(SEA_Y + 0.015, s);
    RP[k].w = 0.42 + 0.62 * (k / NS) + (vnoise(k * 0.03 + ox, 1) - 0.5) * 0.3;
  }
  for (let pass = 0; pass < 3; pass++) for (let k = 1; k < NS; k++) RP[k].s = Math.min(RP[k - 1].s, (RP[k - 1].s + RP[k].s + RP[k + 1].s) / 3);
  // 分格加速最近點查詢
  const BS = 2, buckets = new Map();
  const bk = (x, z) => `${Math.floor(x / BS)},${Math.floor(z / BS)}`;
  for (let k = 0; k < NS; k++) { const kk = bk(RP[k].x, RP[k].z); if (!buckets.has(kk)) buckets.set(kk, []); buckets.get(kk).push(k); }
  function riverAt(x, z, reach = 10) {
    let best = Infinity, bkk = -1, bt = 0;
    const gx = Math.floor(x / BS), gz = Math.floor(z / BS), R = Math.ceil(reach / BS);
    for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
      const list = buckets.get(`${gx + a},${gz + b}`); if (!list) continue;
      for (const k of list) {
        const p = RP[k], q = RP[k + 1];
        const dx = q.x - p.x, dz = q.z - p.z, L2 = dx * dx + dz * dz || 1;
        const t = clamp(((x - p.x) * dx + (z - p.z) * dz) / L2, 0, 1);
        const d = Math.hypot(x - p.x - dx * t, z - p.z - dz * t);
        if (d < best) { best = d; bkk = k; bt = t; }
      }
    }
    if (bkk < 0) return null;
    const p = RP[bkk], q = RP[bkk + 1];
    return { d: best, k: bkk + bt, s: lerp(p.s, q.s, bt), w: lerp(p.w, q.w, bt), dir: [q.x - p.x, q.z - p.z] };
  }
  const DEPTH = 0.24;
  function h(x, z) {
    let y = base(x, z);
    if (y < -0.08) return y;
    const R = riverAt(x, z);
    if (!R) return y;
    const onLand = y > 0.06;
    const { d, s: ws, w } = R;
    if (d < w) y = Math.min(y, ws - DEPTH + (DEPTH + 0.07) * (d / w) ** 2);
    else {
      y = Math.min(y, ws + 0.07 + (d - w) * 0.32);
      if (onLand && d < w + 0.9) y = Math.max(y, ws + 0.05 + (d - w) * 0.04);
    }
    return y;
  }
  const isSea = (x, z) => base(x, z) < 0.02 && !(riverAt(x, z, 2)?.d < 0.5);
  return { h, base, riverAt, RP, NS, sx, sz, ox, oz, coastAt, isSea };
}

// ---------------------------------------------------------------- 網格
const SIZE = 66, SEG = 210;
export function buildLand(L, isTown) {
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, L.h(pos.getX(i), pos.getZ(i)));
  g.computeVertexNormals();
  const nor = g.attributes.normal, col = new Float32Array(pos.count * 3), tmp = new THREE.Color();
  const grassA = C('#8bbb5c'), grassB = C('#bdd47e'), grassC = C('#6f9e4e'), sand = C('#e6d6ab'), wetSand = C('#c9b98f');
  const pebble = C('#b7ad97'), bed = C('#8f8a70'), rock = C('#9d9384'), sea1 = C('#d9cba1'), sea2 = C('#6e9b92'), dirt = C('#9b7b56');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nor.getY(i);
    const R = L.riverAt(x, z, 3);
    if (y < -0.02 && !(R && R.d < R.w)) tmp.copy(sea1).lerp(sea2, smooth(0, 1.4, -y));
    else if (R && R.d < R.w * 1.05) tmp.copy(bed).lerp(pebble, smooth(R.w * 0.55, R.w, R.d));
    else if (R && R.d < R.w + 0.45 && y < R.s + 0.22) tmp.copy(pebble).lerp(grassA, smooth(R.w + 0.15, R.w + 0.45, R.d)).multiplyScalar(0.96 + fbm(x * 3, z * 3) * 0.08);
    else if (y < 0.2) tmp.copy(wetSand).lerp(sand, smooth(0.0, 0.12, y));
    else if (y < 0.34 && L.base(x, z) < 0.4) tmp.copy(sand).lerp(grassA, smooth(0.22, 0.34, y));
    else {
      const n = fbm(x * 0.3 + 7, z * 0.3 + 3), n2 = fbm(x * 1.2, z * 1.2);
      tmp.copy(grassA).lerp(grassB, smooth(0.25, 0.75, n)).lerp(grassC, smooth(0.6, 0.78, n2) * 0.55);
      if (y > 3) tmp.lerp(C('#93a86a'), smooth(3, 5, y) * 0.6);
    }
    const steep = 1 - ny;
    if (steep > 0.25 && y > 0.1) tmp.lerp(steep > 0.45 ? rock : dirt, smooth(0.25, 0.5, steep));
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const ground = new THREE.Mesh(g, M.std); ground.receiveShadow = true; ground.castShadow = true; ground.name = 'ground';
  const group = new THREE.Group(); group.add(ground);

  // ---------------- 河面
  const matRiver = waterMaterial('river');
  {
    const ACROSS = 9, rp = [], fu = [], cl = [], fo = [], idx = [];
    const shallow = C('#9fdcd6'), deep = C('#2f8fb3');
    let len = 0;
    let N = L.NS;
    while (N > 10 && L.base(L.RP[N].x, L.RP[N].z) < -0.35) N--;
    for (let k = 0; k <= N; k++) {
      const p = L.RP[k], q = L.RP[Math.min(N, k + 1)], o = L.RP[Math.max(0, k - 1)];
      if (k > 0) len += Math.hypot(p.x - o.x, p.z - o.z);
      let tx = q.x - o.x, tz = q.z - o.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const w = p.w * 1.3;
      const a = L.RP[Math.max(0, k - 10)], b = L.RP[Math.min(N, k + 10)];
      const drop = clamp((a.s - b.s) / (Math.hypot(a.x - b.x, a.z - b.z) + 0.01) * 6, 0, 1);
      for (let q2 = 0; q2 < ACROSS; q2++) {
        const t = q2 / (ACROSS - 1), o2 = (t - 0.5) * 2;
        rp.push(p.x - tz * w * o2, p.s, p.z + tx * w * o2);
        fu.push(t, len);
        const c = shallow.clone().lerp(deep, Math.pow(1 - Math.abs(o2), 1.4));
        cl.push(c.r, c.g, c.b, 1 - smooth(N - 45, N, k));
        fo.push(drop);
      }
    }
    for (let k = 0; k < N; k++) for (let q2 = 0; q2 < ACROSS - 1; q2++) { const a = k * ACROSS + q2, b = a + 1, c = a + ACROSS, d = c + 1; idx.push(a, b, c, b, d, c); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('flowUv', new THREE.Float32BufferAttribute(fu, 2));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(cl, 4));
    rg.setAttribute('foam', new THREE.Float32BufferAttribute(fo, 1));
    rg.setIndex(idx); rg.computeVertexNormals();
    // 法線朝上
    const n = rg.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
    const rm = new THREE.Mesh(rg, matRiver); rm.receiveShadow = true; rm.renderOrder = 1;
    group.add(rm);
  }
  // ---------------- 海
  const matSea = waterMaterial('sea');
  {
    const sg = new THREE.PlaneGeometry(SIZE + 30, SIZE + 30, 220, 220).rotateX(-Math.PI / 2);
    const p = sg.attributes.position, c = new Float32Array(p.count * 3), fo = new Float32Array(p.count), fu = new Float32Array(p.count * 2);
    const sh = C('#86d9d0'), mid = C('#3aa3bd'), dp = C('#246a9a');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      let hh = L.base(x, z);
      if (hh > -0.7 && hh < 0.7) { const R = L.riverAt(x, z, 2.5); if (R && R.d < R.w + 1.5) hh = L.h(x, z); }
      const d = -hh;
      const cl = sh.clone().lerp(mid, smooth(0.05, 0.6, d)).lerp(dp, smooth(0.6, 2.2, d));
      c[i * 3] = cl.r; c[i * 3 + 1] = cl.g; c[i * 3 + 2] = cl.b;
      fo[i] = 1 - smooth(0.0, 0.35, d);
      fu[i * 2] = x; fu[i * 2 + 1] = z;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    sg.setAttribute('foam', new THREE.BufferAttribute(fo, 1));
    sg.setAttribute('flowUv', new THREE.BufferAttribute(fu, 2));
    const sm = new THREE.Mesh(sg, matSea); sm.position.y = SEA_Y; sm.receiveShadow = true; sm.renderOrder = 0;
    group.add(sm);
  }
  // ---------------- 河邊蘆葦與石頭
  const rr = makeRng(77), reeds = [], stones = [];
  for (let k = 20; k < L.NS - 10; k += 2) {
    const p = L.RP[k], q = L.RP[k + 1];
    let tx = q.x - p.x, tz = q.z - p.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    for (const sd of [-1, 1]) {
      if (rr() > 0.55) continue;
      const off = p.w * (0.82 + rr() * 0.3);
      const x = p.x - tz * off * sd + (rr() - 0.5) * 0.2, z = p.z + tx * off * sd + (rr() - 0.5) * 0.2;
      if (isTown(x, z)) continue;
      const y = L.h(x, z);
      if (y < p.s - 0.1 || y > p.s + 0.3) continue;
      if (rr() < 0.8) for (let q2 = 0; q2 < 4; q2++) reeds.push(P(new THREE.ConeGeometry(0.014, 0.2 + rr() * 0.16, 4), ['#5f7f3a', '#9cbc62'], { x: x + (rr() - 0.5) * 0.12, y: y + 0.1, z: z + (rr() - 0.5) * 0.12, rz: (rr() - 0.5) * 0.3, sway: 0.6 }));
      else stones.push(P(new THREE.DodecahedronGeometry(0.06 + rr() * 0.08, 0), ['#8d877c', '#b9b2a6'], { x, y: y + 0.02, z, sy: 0.6, ry: rr() * 3, flat: true }));
    }
  }
  if (reeds.length) { const m = new THREE.Mesh(merge(reeds), M.tree); m.castShadow = true; group.add(m); }
  if (stones.length) { const m = new THREE.Mesh(merge(stones), M.std); m.castShadow = true; m.receiveShadow = true; group.add(m); }
  return { group, matRiver, matSea };
}

// 水面：流動的法線擾動（陽光反光會順著流向跑）、岸邊與急流的白浪、天空反射
const skyU = { value: new THREE.Color('#cfe6ff') };
export function setWaterSky(c) { skyU.value.copy(c); }
function waterMaterial(kind) {
  const river = kind === 'river';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: river ? 0.9 : 0.88, roughness: river ? 0.1 : 0.2, metalness: 0.05, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FX, { uSky: skyU });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 flowUv; attribute float foam; varying vec2 vFU; varying float vFoam; varying vec3 vFW; uniform float uTime;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${river ? '' : 'transformed.y += (sin(uTime * 1.1 + position.x * 1.7 + position.z * 0.6) + sin(uTime * 0.8 - position.z * 1.3 + position.x * 0.4)) * 0.012;'}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vFU = flowUv; vFoam = foam; vFW = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vFU; varying float vFoam; varying vec3 vFW;
        uniform vec3 uFadeColor, uSky; uniform float uFadeStart, uFadeEnd, uCloud, uTime;
        ${NOISE}
        vec2 wgrad(vec2 q){ float e = 0.05; float n0 = ffbm(q); return vec2(ffbm(q + vec2(e, 0.0)) - n0, ffbm(q + vec2(0.0, e)) - n0) / e; }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        ${river
          ? 'vec2 q1 = vec2(vFU.x * 2.6, vFU.y * 1.3 - uTime * (0.9 + vFoam * 1.6)); vec2 q2 = vec2(vFU.x * 5.0 + 3.1, vFU.y * 2.4 - uTime * 1.4);'
          : 'vec2 q1 = vFW.xz * 0.55 + vec2(uTime * 0.05, uTime * 0.03); vec2 q2 = vFW.xz * 1.3 - vec2(uTime * 0.07, -uTime * 0.04);'}
        vec2 gw = wgrad(q1) * 0.6 + wgrad(q2) * 0.4;
        normal = normalize(normal + (viewMatrix * vec4(gw.x, 0.0, gw.y, 0.0)).xyz * ${river ? '0.3' : '0.14'});`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fo = 0.0;
        ${river
          ? `float aa = abs(vFU.x - 0.5) * 2.0;
             float nn = ffbm(vec2(vFU.x * 9.0, vFU.y * 3.0 - uTime * 1.2));
             fo = smoothstep(0.6, 0.72, aa + nn * 0.14) * (1.0 - smoothstep(0.76, 0.88, aa)) * (0.35 + nn * 0.6);
             fo += vFoam * smoothstep(0.45, 0.75, ffbm(vec2(vFU.x * 7.0, vFU.y * 2.2 - uTime * 2.4)));`
          : `float nn = ffbm(vFW.xz * 2.2 + vec2(uTime * 0.2, 0.0));
             fo = vFoam * smoothstep(0.35, 0.75, 0.5 + 0.5 * sin(vFoam * 14.0 - uTime * 1.6 + nn * 3.0)) + smoothstep(0.85, 1.0, vFoam) * 0.6;`}
        fo = clamp(fo, 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 0.98, 1.0), fo * 0.85);
        diffuseColor.a = mix(diffuseColor.a, 1.0, fo);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += uSky * 0.16;`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float cshade = smoothstep(0.44, 0.7, ffbm(vFW.xz * 0.065 + vec2(uTime * 0.022, uTime * 0.011))); gl_FragColor.rgb *= 1.0 - cshade * uCloud * 0.6;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, smoothstep(uFadeStart, uFadeEnd, length(vFW.xz)));`);
  };
  mat.customProgramCacheKey = () => 'water' + kind;
  return mat;
}
