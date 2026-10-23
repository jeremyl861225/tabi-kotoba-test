// 零件庫：材質、零件上色與定位、合併、假 AO、建築用的局部座標群組
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { C, smooth, lerp, hash2 } from './util.js';

export const uTime = { value: 0 };
// 所有材質共用：遠處漸隱成地平線色、雲影
export const FX = {
  uFadeColor: { value: new THREE.Color('#cfe6ff') },
  uFadeStart: { value: 16.5 },
  uFadeEnd: { value: 25 },
  uCloud: { value: 0 },
  uTime,
};

export const NOISE = `
  float fh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float fvn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(fh21(i), fh21(i+vec2(1,0)), u.x), mix(fh21(i+vec2(0,1)), fh21(i+vec2(1,1)), u.x), u.y); }
  float ffbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a * fvn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;

// 牆面與屋頂紋理（依頂點屬性 surf）：1 屋瓦、2 灰泥、3 紅磚、4 石砌、5 石板瓦
const SURF = `
  if (vSurf > 0.5) {
    #ifndef FLAT_SHADED
      vec3 wn = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
    #else
      vec3 wn = vec3(0.0, 1.0, 0.0);
    #endif
    vec2 th = length(wn.xz) > 0.05 ? normalize(vec2(-wn.z, wn.x)) : vec2(1.0, 0.0);
    float along = dot(vFW.xz, th);
    if (vSurf < 1.5 || vSurf > 4.5) {
      bool slate = vSurf > 4.5;
      float cy = vFW.y * (slate ? 20.0 : 15.0); float row = floor(cy); float fy = fract(cy);
      float ax = along * (slate ? 12.0 : 9.0) + row * 0.5; float fx = fract(ax);
      float t = mix(0.72, 1.0, smoothstep(0.0, 0.45, fy)) * (0.9 + 0.16 * fh21(vec2(row, floor(ax))));
      t *= mix(0.82, 1.0, smoothstep(0.0, 0.1, fx) * smoothstep(1.0, 0.9, fx));
      diffuseColor.rgb *= t;
    } else if (vSurf < 2.5) {
      float n = ffbm(vec2(along * 5.0, vFW.y * 5.0));
      diffuseColor.rgb *= 0.92 + n * 0.14;
    } else if (vSurf < 3.5) {
      float cy = vFW.y * 26.0; float row = floor(cy); float fy = fract(cy);
      float ax = along * 13.0 + mod(row, 2.0) * 0.5; float fx = fract(ax);
      float m = smoothstep(0.0, 0.14, fy) * smoothstep(0.0, 0.1, fx);
      diffuseColor.rgb *= mix(vec3(1.32, 1.3, 1.25), vec3(0.86 + 0.24 * fh21(vec2(row, floor(ax)))), m);
    } else {
      float cy = vFW.y * 10.0; float row = floor(cy); float fy = fract(cy);
      float ax = along * 5.0 + fh21(vec2(row, 3.0)); float fx = fract(ax);
      float m = smoothstep(0.0, 0.09, fy) * smoothstep(0.0, 0.07, fx) * smoothstep(1.0, 0.95, fx);
      diffuseColor.rgb *= mix(0.7, 0.88 + 0.22 * fh21(vec2(row, floor(ax))), m);
    }
  }
`;

export function enhance(mat, { sway = false, waves = false, fade = true, cloud = true, cobble = 0, surf = false } = {}) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, FX);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFW; uniform float uTime;
        ${sway ? 'attribute float sway;' : ''}
        ${surf ? 'attribute float surf; varying float vSurf;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 swPh = position.xz;
        #ifdef USE_INSTANCING
          swPh += instanceMatrix[3].xz;
        #endif
        ${sway ? 'transformed.x += sin(uTime * 1.7 + swPh.x * 0.9 + swPh.y * 0.6) * 0.028 * sway; transformed.z += cos(uTime * 1.3 + swPh.y * 0.8 + swPh.x * 0.3) * 0.02 * sway;' : ''}
        ${waves ? 'transformed.y += (sin(uTime * 1.1 + swPh.x * 1.7 + swPh.y * 0.6) + sin(uTime * 0.8 - swPh.y * 1.3 + swPh.x * 0.4)) * 0.01;' : ''}`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          fwp = instanceMatrix * fwp;
        #endif
        vFW = (modelMatrix * fwp).xyz;
        ${surf ? 'vSurf = surf;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vFW; uniform vec3 uFadeColor; uniform float uFadeStart, uFadeEnd, uCloud, uTime;
        ${surf ? 'varying float vSurf;' : ''}
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${surf ? SURF : ''}
        ${cobble ? `{
          vec2 cp = vFW.xz * ${cobble.toFixed(1)}; vec2 ci = floor(cp), cf = fract(cp);
          float md = 8.0, md2 = 8.0; vec2 mid = vec2(0.0);
          for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
            vec2 g = vec2(float(x), float(y)); vec2 o = vec2(fh21(ci + g), fh21(ci + g + 17.3)) * 0.8 + 0.1;
            vec2 d = g + o - cf; float dd = dot(d, d);
            if (dd < md) { md2 = md; md = dd; mid = ci + g; } else if (dd < md2) md2 = dd;
          }
          float edge = sqrt(md2) - sqrt(md);
          float stone = smoothstep(0.03, 0.14, edge);
          diffuseColor.rgb *= mix(0.62, 0.84 + fh21(mid) * 0.3, stone);
        }` : ''}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        ${cloud ? 'float cshade = smoothstep(0.44, 0.7, ffbm(vFW.xz * 0.065 + vec2(uTime * 0.022, uTime * 0.011))); gl_FragColor.rgb *= 1.0 - cshade * uCloud;' : ''}
        ${fade ? 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uFadeColor, smoothstep(uFadeStart, uFadeEnd, length(vFW.xz)));' : ''}`);
  };
  mat.customProgramCacheKey = () => `enh${+sway}${+waves}${+fade}${+cloud}${cobble}${+surf}`;
  return mat;
}

export const M = {
  std: enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.84, metalness: 0 }), { surf: true }),
  road: enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }), { cobble: 5.5 }),
  plaza: enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), { cobble: 3.6 }),
  rock: enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true })),
  tree: enhance(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86 }), { sway: true }),
  win: enhance(new THREE.MeshStandardMaterial({ color: 0x3a4660, roughness: 0.22, metalness: 0.15, emissive: 0xffae4c, emissiveIntensity: 0 }), { cloud: false }),
  fire: new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 2.5 }),
  crystal: enhance(new THREE.MeshStandardMaterial({ color: 0xc7a6ff, emissive: 0x9a6bff, emissiveIntensity: 1.2, roughness: 0.15, flatShading: true }), { cloud: false }),
  figure: enhance(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 })),
  cloud: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, transparent: true }),
};

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

// 把一個基本幾何變成「已上色、已定位」的零件。color 可給 [下色, 上色] 做垂直漸層。
export function P(geo, color, t = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ'); _q.setFromEuler(_e);
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1); _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s); g.applyMatrix4(_m);
  if (t.flat) g.computeVertexNormals();
  const pos = g.attributes.position, n = pos.count;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < lo) lo = y; if (y > hi) hi = y; }
  const c0 = C(Array.isArray(color) ? color[0] : color), c1 = Array.isArray(color) ? C(color[1]) : c0;
  const col = new Float32Array(n * 3), tmp = new THREE.Color();
  const jit = t.j ? 1 + (hash2(_p.x * 3.1 + _p.y, _p.z * 2.7 - _p.y) - 0.5) * t.j : 1;
  for (let i = 0; i < n; i++) {
    tmp.copy(c0).lerp(c1, hi > lo ? (pos.getY(i) - lo) / (hi - lo) : 0).multiplyScalar(jit);
    col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('surf', new THREE.BufferAttribute(new Float32Array(n).fill(t.surf || 0), 1));
  if (t.sway !== undefined) {
    const sw = new Float32Array(n);
    for (let i = 0; i < n; i++) sw[i] = t.sway * (0.35 + 0.65 * (hi > lo ? (pos.getY(i) - lo) / (hi - lo) : 1));
    g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  }
  return g;
}
export const bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const rbx = (w, h, d, r = 0.03, seg = 1) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
export const merge = (geos) => mergeGeometries(geos);
export function meshOf(geos, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(merge(geos), mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

// 假 AO：牆腳壓暗、屋簷底壓暗、朝上的面不動
export function applyAO(g, base = 0, strength = 1) {
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - base, ny = nor.getY(i);
    let f = 0.62 + 0.38 * smooth(0, 0.24, y);
    f = lerp(f, 1, smooth(0.4, 0.9, ny));
    if (ny < -0.5) f *= 0.8;
    f = lerp(1, f, strength);
    col.setXYZ(i, col.getX(i) * f, col.getY(i) * f, col.getZ(i) * f);
  }
  return g;
}

// 建築零件包：body 用標準材質、glow 是會亮的窗、fire 是火
export function newKit() { return { body: [], glow: [], fire: [], chimneys: [], spin: [], extra: [], lamps: [] }; }

// 在局部座標系裡蓋一組零件，然後整組旋轉平移到位
export function grp(K, x, y, z, ry, fn) {
  const n = { body: K.body.length, glow: K.glow.length, fire: K.fire.length, chimneys: K.chimneys.length, lamps: K.lamps.length, extra: K.extra.length };
  fn();
  const m = new THREE.Matrix4().makeRotationY(ry); m.setPosition(x, y, z);
  for (const k of ['body', 'glow', 'fire']) for (let i = n[k]; i < K[k].length; i++) K[k][i].applyMatrix4(m);
  for (const k of ['chimneys', 'lamps']) for (let i = n[k]; i < K[k].length; i++) K[k][i].applyMatrix4(m);
  for (let i = n.extra; i < K.extra.length; i++) K.extra[i].applyMatrix4(m);
}
// 在方塊的某一面上蓋東西：面的局部 x 沿牆面、z 朝外，fn 收到牆面寬度
export function onFace(K, b, side, fn) {
  const s = {
    front: [b.cx, b.cz + b.d / 2, 0, b.w],
    back: [b.cx, b.cz - b.d / 2, Math.PI, b.w],
    right: [b.cx + b.w / 2, b.cz, Math.PI / 2, b.d],
    left: [b.cx - b.w / 2, b.cz, -Math.PI / 2, b.d],
  }[side];
  grp(K, s[0], 0, s[1], s[2], () => fn(s[3]));
}
