// 浮空島 · 風格試作：一座會動、不能玩的小鎮，用來驗證美感與手機效能。
// 美術規格見 ART.md。座標：島頂 y = 0，一格 = 1。
import * as THREE from 'three';
import { RoundedBoxGeometry } from './vendor/RoundedBoxGeometry.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';

// ---------------------------------------------------------------- 小工具
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
function mulberry(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(20261023);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(hash2(xi, yi), hash2(xi + 1, yi), u), lerp(hash2(xi, yi + 1), hash2(xi + 1, yi + 1), u), v);
}
const fbm = (x, y) => 0.5 * vnoise(x, y) + 0.25 * vnoise(x * 2.03, y * 2.03) + 0.125 * vnoise(x * 4.1, y * 4.1) + 0.0625 * vnoise(x * 8.3, y * 8.3);
const C = (hex) => new THREE.Color(hex);
const easeOutBack = (t) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const easeInCubic = (t) => t * t * t;

// ---------------------------------------------------------------- 渲染器
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const uTime = { value: 0 };

// ---------------------------------------------------------------- 材質
const matStd = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 });
const matRock = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
const matWin = new THREE.MeshStandardMaterial({ color: 0x3b4a66, roughness: 0.3, emissive: 0xffb35c, emissiveIntensity: 0 });
const matFire = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff7a20, emissiveIntensity: 2.5 });
const matCrystal = new THREE.MeshStandardMaterial({ color: 0xaef6ff, emissive: 0x58dcff, emissiveIntensity: 1.2, roughness: 0.15, flatShading: true, transparent: true, opacity: 0.94 });
const matCloud = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
const matTree = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
matTree.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed.x += sin(uTime * 1.7 + position.x * 0.9 + position.z * 0.6) * 0.035 * sway;
      transformed.z += cos(uTime * 1.3 + position.z * 0.8) * 0.025 * sway;`);
};

// 把基本幾何變成「已上色、已定位」的零件。color 可以是單色或 [底色, 頂色] 漸層。
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
function P(geo, color, t = {}) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  _e.set(t.rx || 0, t.ry || 0, t.rz || 0, 'YXZ'); _q.setFromEuler(_e);
  _s.set(t.sx ?? 1, t.sy ?? 1, t.sz ?? 1); _p.set(t.x || 0, t.y || 0, t.z || 0);
  _m.compose(_p, _q, _s); g.applyMatrix4(_m);
  const pos = g.attributes.position, n = pos.count;
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const y = pos.getY(i); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  const c0 = C(Array.isArray(color) ? color[0] : color), c1 = C(Array.isArray(color) ? color[1] : color);
  const col = new Float32Array(n * 3), tmp = new THREE.Color();
  const base = t.base ?? 0;
  for (let i = 0; i < n; i++) {
    const y = pos.getY(i);
    tmp.copy(c0).lerp(c1, hi > lo ? (y - lo) / (hi - lo) : 0);
    const ao = t.noAO ? 1 : 0.6 + 0.4 * smooth(base, base + 0.32, y);
    col[i * 3] = tmp.r * ao; col[i * 3 + 1] = tmp.g * ao; col[i * 3 + 2] = tmp.b * ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (t.sway !== undefined) {
    const sw = new Float32Array(n);
    for (let i = 0; i < n; i++) sw[i] = t.sway * smooth(t.swayFrom ?? 0.15, (t.swayFrom ?? 0.15) + 0.5, pos.getY(i) - base);
    g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
  }
  return g;
}
const box = (w, h, d, r = 0.035, seg = 2) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
function meshOf(geos, mat, shadow = true) {
  const m = new THREE.Mesh(mergeGeometries(geos), mat);
  m.castShadow = shadow; m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------- 島嶼
function radiusFn(base) {
  const p = [rnd() * TAU, rnd() * TAU, rnd() * TAU, rnd() * TAU];
  return (a) => base * (1 + 0.07 * Math.sin(3 * a + p[0]) + 0.045 * Math.sin(5 * a + p[1]) + 0.025 * Math.sin(9 * a + p[2]) + 0.012 * Math.sin(17 * a + p[3]));
}

// 回傳 { top, rock } 兩個幾何：草皮（圓潤邊緣、平滑）與岩層（切面、越往下越冷）
function buildIsland(rf, depth, { seg = 160, rings = 26, lip = 0.22, tilt = [0.3, 0.2] } = {}) {
  const grassA = C('#8bbb5c'), grassB = C('#bdd47e'), grassC = C('#6f9e4e'), lipC = C('#76a252'), sideC = C('#5d8443');
  // 草皮剖面
  const prof = [];
  for (let k = 0; k <= rings; k++) prof.push({ f: (R) => (R - lip) * k / rings, y: 0, kind: 0 });
  for (let j = 1; j <= 5; j++) { const ph = j / 5 * Math.PI / 2; prof.push({ f: (R) => R - lip + lip * Math.sin(ph), y: -lip + lip * Math.cos(ph), kind: 1 }); }
  prof.push({ f: (R) => R, y: -0.36, kind: 2 });
  const pos = [], col = [], idx = [];
  const tmp = new THREE.Color();
  for (let i = 0; i < prof.length; i++) {
    for (let s = 0; s < seg; s++) {
      const a = s / seg * TAU, R = rf(a), r = prof[i].f(R);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      pos.push(x, prof[i].y, z);
      if (prof[i].kind === 0) {
        const n = fbm(x * 0.32 + 7, z * 0.32 + 3), n2 = fbm(x * 1.4, z * 1.4);
        tmp.copy(grassA).lerp(grassB, smooth(0.25, 0.75, n)).lerp(grassC, smooth(0.62, 0.8, n2) * 0.5);
      } else tmp.copy(prof[i].kind === 1 ? lipC : sideC);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < prof.length - 1; i++) for (let s = 0; s < seg; s++) {
    const a = i * seg + s, b = i * seg + (s + 1) % seg, c = (i + 1) * seg + s, d = (i + 1) * seg + (s + 1) % seg;
    idx.push(a, b, c, b, d, c);
  }
  const top = new THREE.BufferGeometry();
  top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  top.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  top.setIndex(idx); top.computeVertexNormals();

  // 岩層
  const J = 13, rp = [], rc = [], ri = [];
  const stops = [[0, '#a87b52'], [0.08, '#9b7760'], [0.35, '#8a7184'], [0.7, '#655a80'], [1, '#463f63']].map(([t, h]) => [t, C(h)]);
  const ramp = (t) => { for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) return tmp.copy(stops[i - 1][1]).lerp(stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0])); return tmp.copy(stops[stops.length - 1][1]); };
  for (let j = 0; j <= J; j++) {
    const t = j / J, y = -0.36 - t * depth;
    for (let s = 0; s < seg; s++) {
      const a = s / seg * TAU, R = rf(a);
      let r;
      if (j === 0) r = R;
      else if (j === J) r = 0;
      else {
        const shape = Math.pow(1 - t, 0.8) * (1 - 0.12 * t);
        const jag = (fbm(a * 4 + j * 0.9, j * 0.7) - 0.45) * 0.38 * (0.4 + t);
        r = R * shape * (1 + jag) * (j === 1 ? 0.97 : 1);
      }
      const ox = j === J ? tilt[0] * depth * 0.12 : tilt[0] * t * t * depth * 0.1;
      const oz = j === J ? tilt[1] * depth * 0.12 : tilt[1] * t * t * depth * 0.1;
      rp.push(Math.cos(a) * r + ox, y + (j > 0 && j < J ? (vnoise(a * 6, j) - 0.5) * 0.25 : 0), Math.sin(a) * r + oz);
      const c = ramp(t).clone();
      c.multiplyScalar(0.9 + 0.12 * Math.sin(y * 4.5 + a * 1.5) + (hash2(s, j) - 0.5) * 0.08);
      rc.push(c.r, c.g, c.b);
    }
  }
  for (let j = 0; j < J; j++) for (let s = 0; s < seg; s++) {
    const a = j * seg + s, b = j * seg + (s + 1) % seg, c = (j + 1) * seg + s, d = (j + 1) * seg + (s + 1) % seg;
    ri.push(a, b, c, b, d, c);
  }
  const rock = new THREE.BufferGeometry();
  rock.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rock.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
  rock.setIndex(ri); rock.computeVertexNormals();
  return { top, rock };
}

const world = new THREE.Group();
scene.add(world);
const rf = radiusFn(7.6);
{
  const { top, rock } = buildIsland(rf, 7.2);
  const mt = new THREE.Mesh(top, matStd); mt.receiveShadow = true; mt.castShadow = true;
  const mr = new THREE.Mesh(rock, matRock); mr.receiveShadow = true; mr.castShadow = true;
  world.add(mt, mr);
}
const inside = (i, j, margin = 0.85) => Math.hypot(i, j) + margin < rf(Math.atan2(j, i)) - 0.15;

// ---------------------------------------------------------------- 地圖：路、河、佔用
const occ = new Map();
const key = (i, j) => `${i},${j}`;
const roads = [];
for (let i = -6; i <= 6; i++) roads.push([i, 0]);
for (let j = -6; j <= 5; j++) if (j !== 0) roads.push([-2, j]);

const BRIDGE = [2, 0];
const pondC = new THREE.Vector2(3.15, -3.1), pondR = 1.2;
const aW = 1.22, RW = rf(aW);
const riverPts = [[3.0, -2.05], [2.7, -1.0], [2.0, 0.0], [1.55, 1.3], [1.75, 3.1], [2.15, 4.8], [Math.cos(aW) * (RW - 0.05), Math.sin(aW) * (RW - 0.05)]];
const riverCurve = new THREE.CatmullRomCurve3(riverPts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
const riverSamples = riverCurve.getSpacedPoints(240);
function riverDist(x, z) {
  let d = Infinity;
  for (const p of riverSamples) d = Math.min(d, Math.hypot(p.x - x, p.z - z));
  return Math.min(d, Math.hypot(x - pondC.x, z - pondC.y) - pondR + 0.3);
}

const S = [];   // 靜態零件（標準材質）
const SW = [];  // 靜態窗／燈
const ST = [];  // 樹（會擺）

// 路面：每格四塊圓角石板
const paveCols = ['#efe5cf', '#d9c8a2', '#cdb994', '#e4d6b6'];
for (const [i, j] of roads) {
  if (i === BRIDGE[0] && j === BRIDGE[1]) { occ.set(key(i, j), 'bridge'); continue; }
  if (!inside(i, j, 0.55)) continue;
  occ.set(key(i, j), 'road');
  S.push(P(box(1.04, 0.04, 1.04, 0.02, 1), pick(['#e6d6b2', '#e2d1ab', '#e8d9b6']), { x: i, y: 0.0, z: j, noAO: true }));
  for (let k = 0; k < 7; k++) {
    const w = 0.12 + rnd() * 0.1, d = 0.1 + rnd() * 0.08;
    S.push(P(box(w, 0.025, d, 0.012, 1), pick(paveCols), { x: i + (rnd() - 0.5) * 0.8, y: 0.025, z: j + (rnd() - 0.5) * 0.8, ry: rnd() * 3, noAO: true }));
  }
}

// 河與池：帶狀網格，頂點色中間深、兩岸淺
function ribbon(points, widthFn, { y = 0, side = null, alphaFn = null } = {}) {
  const n = points.length, pos = [], uv = [], col = [], idx = [];
  const shallow = C('#9be6e8'), deep = C('#35a9cb');
  let len = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[Math.min(n - 1, i + 1)], o = points[Math.max(0, i - 1)];
    if (i > 0) len += p.distanceTo(points[i - 1]);
    const tan = q.clone().sub(o).normalize();
    const sd = side ? side.clone() : new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const w = widthFn(i / (n - 1));
    const a = alphaFn ? alphaFn(i / (n - 1)) : 1;
    for (const k of [-1, -0.45, 0, 0.45, 1]) {
      pos.push(p.x + sd.x * w * k, p.y + y, p.z + sd.z * w * k);
      uv.push((k + 1) / 2, len);
      const c = shallow.clone().lerp(deep, 1 - Math.abs(k));
      col.push(c.r, c.g, c.b, a);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < 4; k++) {
    const a = i * 5 + k, b = a + 1, c = a + 5, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
function streakTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 256);
  const r = mulberry(7);
  for (let i = 0; i < 70; i++) {
    const x = r() * 64, y = r() * 256, h = 10 + r() * 40, w = 1 + r() * 2.5;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, `rgba(255,255,255,${0.35 + r() * 0.5})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    if (y + h > 256) g.fillRect(x, y - 256, w, h);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
const texRiver = streakTexture(); texRiver.repeat.set(1, 0.5);
const texFall = texRiver.clone(); texFall.repeat.set(1.5, 0.35);
const matWater = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.18, metalness: 0.05, emissive: 0xffffff, emissiveMap: texRiver, emissiveIntensity: 0.3, opacity: 0.92 });
const matFall = matWater.clone(); matFall.emissiveMap = texFall; matFall.depthWrite = false; matFall.side = THREE.DoubleSide;
const matPond = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.12, metalness: 0.05, opacity: 0.92 });
{
  const river = new THREE.Mesh(ribbon(riverSamples, (t) => 0.3 + 0.08 * t), matWater);
  river.position.y = 0.035; river.receiveShadow = true; world.add(river);
  // 河岸（濕沙）
  const bankPts = riverSamples;
  const bank = P(ribbon(bankPts, (t) => 0.44 + 0.1 * t), '#cdb98e', { y: 0.016, noAO: true });
  S.push(bank);
  // 池
  const pond = new THREE.Mesh(disc(pondR, 0.0, true), matPond);
  pond.position.set(pondC.x, 0.04, pondC.y); pond.receiveShadow = true; world.add(pond);
  S.push(P(new THREE.CylinderGeometry(pondR + 0.16, pondR + 0.2, 0.04, 48), '#cdb98e', { x: pondC.x, y: 0.012, z: pondC.y, noAO: true }));
  // 睡蓮
  for (let k = 0; k < 7; k++) {
    const a = rnd() * TAU, r = rnd() * pondR * 0.75;
    S.push(P(new THREE.CylinderGeometry(0.09 + rnd() * 0.05, 0.1, 0.012, 10), pick(['#5f9a4a', '#6fae55']), { x: pondC.x + Math.cos(a) * r, y: 0.055, z: pondC.y + Math.sin(a) * r, noAO: true }));
    if (rnd() < 0.4) S.push(P(new THREE.IcosahedronGeometry(0.035, 0), '#ffd6e6', { x: pondC.x + Math.cos(a) * r, y: 0.075, z: pondC.y + Math.sin(a) * r, noAO: true }));
  }
  // 瀑布：從島緣滾下，一路落進雲海
  const out = new THREE.Vector3(Math.cos(aW), 0, Math.sin(aW));
  const e = riverSamples[riverSamples.length - 1];
  const side = new THREE.Vector3(-out.z, 0, out.x);
  const fp = [];
  const lipPts = [[0, 0], [0.2, -0.02], [0.36, -0.14], [0.45, -0.42], [0.5, -0.9]];
  for (const [o, y] of lipPts) fp.push(new THREE.Vector3(e.x + out.x * o, y, e.z + out.z * o));
  for (let k = 1; k <= 22; k++) fp.push(new THREE.Vector3(e.x + out.x * (0.5 + k * 0.05), -0.9 - k * 0.55, e.z + out.z * (0.5 + k * 0.05)));
  const fall = new THREE.Mesh(ribbon(fp, (t) => 0.38 + 0.35 * t, { side, alphaFn: (t) => 1 - smooth(0.45, 1, t) }), matFall);
  fall.position.y = 0.035; fall.renderOrder = 2; world.add(fall);
  world.userData.fallTop = e.clone().add(out.clone().multiplyScalar(0.4));
  world.userData.fallOut = out;
}
function disc(r, y, rgba) {
  const rings = 6, seg = 40, pos = [], col = [], idx = [];
  const shallow = C('#9be6e8'), deep = C('#2f9fc4');
  for (let i = 0; i <= rings; i++) for (let s = 0; s < seg; s++) {
    const a = s / seg * TAU, rr = r * i / rings;
    pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
    const c = deep.clone().lerp(shallow, Math.pow(i / rings, 2));
    col.push(c.r, c.g, c.b); if (rgba) col.push(1);
  }
  for (let i = 0; i < rings; i++) for (let s = 0; s < seg; s++) {
    const a = i * seg + s, b = i * seg + (s + 1) % seg, c = a + seg, d = b + seg;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, rgba ? 4 : 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// 石拱橋（橫跨 BRIDGE 那一格）
const bridgeY = (x) => { const u = (x - BRIDGE[0]) / 0.62; return Math.abs(u) >= 1 ? 0.035 : 0.035 + 0.17 * Math.cos(u * Math.PI / 2); };
for (let k = -6; k <= 6; k++) {
  const x = BRIDGE[0] + k * 0.1, y = bridgeY(x);
  S.push(P(box(0.11, 0.07, 0.62, 0.02, 1), k % 2 ? '#dccfb6' : '#d2c3a6', { x, y: y - 0.02, z: 0, noAO: true }));
  for (const sz of [-1, 1]) S.push(P(box(0.11, 0.09, 0.07, 0.02, 1), '#c8b898', { x, y: y + 0.05, z: sz * 0.3, noAO: true }));
}
S.push(P(box(0.9, 0.12, 0.5, 0.05), '#bfae8e', { x: BRIDGE[0], y: 0.06, z: 0, noAO: true }));

// ---------------------------------------------------------------- 建築
// 每棟建築回傳 { body:[], glow:[], fire:[], chimneys:[Vector3], spin:[{obj,…}] }；前門朝 +z。
function newKit() { return { body: [], glow: [], fire: [], chimneys: [], spin: [], extra: [] }; }

// 人字屋頂：屋脊沿 x，坡面朝 ±z
function gable(K, { w, d, y0, h, roof, wall, ov = 0.08, cx = 0, cz = 0, ridge }) {
  const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, h)]);
  const tg = new THREE.ExtrudeGeometry(tri, { depth: w - 0.02, bevelEnabled: false });
  K.body.push(P(tg, wall, { ry: Math.PI / 2, x: cx - (w - 0.02) / 2, y: y0, z: cz, base: y0 - 1 }));
  const th = Math.atan2(h, d / 2);
  const ez = d / 2 + ov, ey = y0 - ov * Math.tan(th);
  const len = Math.hypot(ez, y0 + h - ey) + 0.03;
  for (const sgn of [1, -1]) {
    const nz = Math.sin(th) * sgn, ny = Math.cos(th);
    K.body.push(P(box(w + ov * 2, 0.055, len, 0.025), roof, {
      rx: th * sgn, x: cx, y: (ey + y0 + h) / 2 + ny * 0.028, z: cz + sgn * ez / 2 + nz * 0.028, noAO: true,
    }));
  }
  K.body.push(P(new THREE.CylinderGeometry(0.035, 0.035, w + ov * 2 + 0.02, 8), ridge || shade(roof, 0.8), { rz: Math.PI / 2, x: cx, y: y0 + h + 0.035, z: cz, noAO: true }));
}
function shade(hex, k) { const c = C(hex).multiplyScalar(k); return '#' + c.getHexString(THREE.SRGBColorSpace); }
function windowAt(K, x, y, z, face = 'z', w = 0.1, h = 0.13) {
  const t = { x, y, z, noAO: true };
  if (face === 'x') t.ry = Math.PI / 2;
  K.glow.push(P(box(w, h, 0.03, 0.012, 1), '#ffffff', t));
  K.body.push(P(box(w + 0.04, 0.022, 0.05, 0.008, 1), '#f8f1e2', { ...t, y: y - h / 2 - 0.012 }));
}
function door(K, x, y0, z, w = 0.14, h = 0.22, color = '#8a5a3c') {
  K.body.push(P(box(w, h, 0.035, 0.03, 2), color, { x, y: y0 + h / 2, z, noAO: true }));
  K.body.push(P(new THREE.SphereGeometry(0.012, 6, 4), '#f2c35b', { x: x + w * 0.3, y: y0 + h * 0.45, z: z + 0.02, noAO: true }));
}
function chimney(K, x, y0, z, h = 0.3) {
  K.body.push(P(box(0.1, h, 0.1, 0.02), '#b8aa98', { x, y: y0 + h / 2, z }));
  K.body.push(P(box(0.13, 0.04, 0.13, 0.015, 1), '#8f8274', { x, y: y0 + h, z, noAO: true }));
  K.chimneys.push(new THREE.Vector3(x, y0 + h + 0.04, z));
}
function flowerBox(K, x, y, z, w = 0.16) {
  K.body.push(P(box(w, 0.035, 0.05, 0.01, 1), '#8a6244', { x, y, z: z + 0.02, noAO: true }));
  for (let k = 0; k < 4; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.022, 0), pick(['#ff7f9e', '#ffd25e', '#ff9a5a', '#f5f0ff']), { x: x - w / 2 + 0.025 + k * (w - 0.05) / 3, y: y + 0.03, z: z + 0.03, noAO: true }));
}
function flag(K, x, y, z, color, h = 0.32) {
  K.body.push(P(new THREE.CylinderGeometry(0.008, 0.008, h, 5), '#6b5a48', { x, y: y + h / 2, z, noAO: true }));
  const pivot = new THREE.Group(); pivot.position.set(x, y + h - 0.06, z);
  const fg = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.09, 6, 1).translate(0.08, 0, 0), new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.9 }));
  fg.castShadow = true; pivot.add(fg);
  K.extra.push(pivot); K.spin.push({ obj: pivot, flag: true, ph: rnd() * 6 });
}

const HOUSES = {
  1(K) { // 帳篷＋營火
    K.body.push(P(new THREE.ConeGeometry(0.36, 0.6, 12), ['#e9dcc0', '#f6eedb'], { y: 0.3 }));
    K.body.push(P(new THREE.ConeGeometry(0.365, 0.16, 12, 1, true), '#d9734e', { y: 0.38, noAO: true }));
    K.body.push(P(new THREE.ConeGeometry(0.15, 0.3, 3), '#6e4c38', { y: 0.15, z: 0.19, rx: -0.5, sz: 0.25, noAO: true }));
    flag(K, 0, 0.55, 0, 0xe86a4a, 0.22);
    for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; K.body.push(P(new THREE.IcosahedronGeometry(0.035, 0), '#9a948c', { x: 0.3 + Math.cos(a) * 0.08, y: 0.02, z: 0.3 + Math.sin(a) * 0.08, noAO: true })); }
    K.fire.push(P(new THREE.ConeGeometry(0.045, 0.11, 6), '#ffffff', { x: 0.3, y: 0.06, z: 0.3, noAO: true }));
    K.body.push(P(box(0.18, 0.1, 0.1, 0.02), '#a77a52', { x: -0.28, y: 0.05, z: 0.22, ry: 0.4 }));
  },
  2(K) { // 茅草圓屋
    K.body.push(P(new THREE.CylinderGeometry(0.3, 0.32, 0.36, 16), '#dcbc8f', { y: 0.18 }));
    K.body.push(P(new THREE.ConeGeometry(0.45, 0.42, 16), ['#c99a48', '#e8c26a'], { y: 0.36 + 0.21, noAO: true }));
    K.body.push(P(new THREE.ConeGeometry(0.12, 0.12, 10), '#b98a42', { y: 0.82, noAO: true }));
    door(K, 0, 0, 0.3, 0.13, 0.21);
    windowAt(K, 0.29, 0.2, 0, 'x', 0.08, 0.1);
    for (let k = 0; k < 7; k++) { const x = -0.4 + k * 0.13; K.body.push(P(box(0.03, 0.12, 0.03, 0.01, 1), '#9a7650', { x, y: 0.06, z: 0.44 })); }
    K.body.push(P(box(0.82, 0.02, 0.02, 0.008, 1), '#9a7650', { x: -0.01, y: 0.1, z: 0.44, noAO: true }));
  },
  3(K) { // 紅瓦小屋
    K.body.push(P(box(0.68, 0.08, 0.56, 0.03), '#c9bba5', { y: 0.04 }));
    K.body.push(P(box(0.62, 0.4, 0.5, 0.04), '#fbeedb', { y: 0.27 }));
    gable(K, { w: 0.62, d: 0.5, y0: 0.47, h: 0.3, roof: '#d97a52', wall: '#fbeedb' });
    door(K, -0.12, 0.07, 0.255);
    windowAt(K, 0.14, 0.27, 0.255); flowerBox(K, 0.14, 0.18, 0.255);
    windowAt(K, 0.315, 0.29, 0, 'x');
    chimney(K, 0.2, 0.55, -0.1, 0.32);
  },
  4(K) { // 兩層木石屋
    K.body.push(P(box(0.76, 0.38, 0.62, 0.04), '#e2d3bb', { y: 0.19 }));
    K.body.push(P(box(0.8, 0.04, 0.66, 0.015, 1), '#8a6244', { y: 0.39, noAO: true }));
    K.body.push(P(box(0.78, 0.32, 0.64, 0.035), '#fbf3e4', { y: 0.57 }));
    for (const x of [-0.39, 0.39]) K.body.push(P(box(0.035, 0.32, 0.035, 0.01, 1), '#8a6244', { x, y: 0.57, z: 0.32, noAO: true }));
    gable(K, { w: 0.78, d: 0.64, y0: 0.73, h: 0.34, roof: '#5fa39a', wall: '#fbf3e4' });
    door(K, 0, 0, 0.315, 0.15, 0.25);
    windowAt(K, -0.24, 0.21, 0.315); windowAt(K, 0.24, 0.21, 0.315);
    for (const x of [-0.24, 0, 0.24]) { windowAt(K, x, 0.58, 0.325); flowerBox(K, x, 0.49, 0.325, 0.14); }
    windowAt(K, 0.395, 0.58, 0.05, 'x'); windowAt(K, -0.385, 0.21, 0.05, 'x');
    chimney(K, -0.24, 0.85, -0.12, 0.34);
  },
  5(K) { // 帶塔樓的宅邸
    K.body.push(P(box(0.94, 0.06, 0.9, 0.025), '#e3d7c2', { y: 0.03 }));
    K.body.push(P(box(0.56, 0.42, 0.56, 0.04), '#e2d3bb', { x: -0.1, y: 0.27, z: -0.08 }));
    K.body.push(P(box(0.6, 0.34, 0.6, 0.035), '#f7efe3', { x: -0.1, y: 0.65, z: -0.08 }));
    gable(K, { w: 0.6, d: 0.6, y0: 0.82, h: 0.3, roof: '#6b86bd', wall: '#f7efe3', cx: -0.1, cz: -0.08 });
    K.body.push(P(box(0.32, 0.3, 0.4, 0.035), '#fbeedb', { x: 0.3, y: 0.21, z: 0.05 }));
    gable(K, { w: 0.32, d: 0.4, y0: 0.36, h: 0.18, roof: '#6b86bd', wall: '#fbeedb', cx: 0.3, cz: 0.05, ov: 0.05 });
    K.body.push(P(new THREE.CylinderGeometry(0.13, 0.14, 1.08, 14), '#efe3cc', { x: -0.33, y: 0.6, z: -0.3 }));
    K.body.push(P(new THREE.ConeGeometry(0.19, 0.38, 14), '#5a73a8', { x: -0.33, y: 1.33, z: -0.3, noAO: true }));
    K.body.push(P(new THREE.SphereGeometry(0.03, 8, 6), '#f2c35b', { x: -0.33, y: 1.54, z: -0.3, noAO: true }));
    windowAt(K, -0.33, 0.92, -0.165, 'z', 0.07, 0.12);
    door(K, -0.1, 0.06, 0.205, 0.15, 0.26);
    windowAt(K, -0.28, 0.3, 0.205); windowAt(K, 0.08, 0.3, 0.205);
    windowAt(K, -0.22, 0.66, 0.225); windowAt(K, 0.02, 0.66, 0.225);
    flowerBox(K, -0.22, 0.57, 0.225, 0.13); flowerBox(K, 0.02, 0.57, 0.225, 0.13);
    windowAt(K, 0.3, 0.22, 0.255);
    chimney(K, 0.05, 0.92, -0.25, 0.28);
    for (const x of [-0.36, -0.16, 0.36]) K.body.push(P(new THREE.SphereGeometry(0.07, 10, 8), '#5f9e4c', { x, y: 0.1, z: 0.38, sy: 0.85 }));
  },
  6(K) { // 雙尖塔莊園＋漂浮水晶
    K.body.push(P(box(0.96, 0.08, 0.96, 0.03), '#e8decb', { y: 0.04 }));
    K.body.push(P(box(0.62, 0.66, 0.5, 0.04), '#f8f1e4', { y: 0.41, z: -0.12 }));
    K.body.push(P(box(0.66, 0.04, 0.54, 0.015, 1), '#d9c9a8', { y: 0.42, z: -0.12, noAO: true }));
    gable(K, { w: 0.62, d: 0.5, y0: 0.74, h: 0.36, roof: '#9b6aa3', wall: '#f8f1e4', cz: -0.12 });
    for (const x of [-0.33, 0.33]) {
      K.body.push(P(new THREE.CylinderGeometry(0.13, 0.145, 1.0, 16), '#f1e6d2', { x, y: 0.58, z: 0.2 }));
      K.body.push(P(new THREE.CylinderGeometry(0.155, 0.155, 0.05, 16), '#d9c9a8', { x, y: 1.09, z: 0.2, noAO: true }));
      K.body.push(P(new THREE.ConeGeometry(0.17, 0.52, 16), ['#84559a', '#a77bb4'], { x, y: 1.37, z: 0.2, noAO: true }));
      K.body.push(P(new THREE.SphereGeometry(0.03, 8, 6), '#f2c35b', { x, y: 1.65, z: 0.2, noAO: true }));
      windowAt(K, x, 0.4, 0.34, 'z', 0.07, 0.12); windowAt(K, x, 0.8, 0.335, 'z', 0.07, 0.12);
    }
    K.body.push(P(box(0.22, 0.3, 0.06, 0.06), '#7a4a32', { y: 0.23, z: 0.14 }));
    K.body.push(P(box(0.26, 0.03, 0.08, 0.01, 1), '#f2c35b', { y: 0.39, z: 0.14, noAO: true }));
    for (const x of [-0.12, 0.12]) windowAt(K, x, 0.62, 0.135);
    flag(K, 0.33, 1.63, 0.2, 0xf2c35b, 0.2);
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), matCrystal);
    cr.scale.set(1, 1.6, 1); cr.position.set(0, 1.55, -0.12);
    K.extra.push(cr); K.spin.push({ obj: cr, y0: 1.55, bob: 0.05, rot: 0.9 });
    for (const x of [-0.42, 0.42]) K.body.push(P(new THREE.SphereGeometry(0.06, 10, 8), '#5f9e4c', { x, y: 0.12, z: 0.42 }));
  },
};

const SERVICES = {
  well(K) {
    K.body.push(P(new THREE.CylinderGeometry(0.2, 0.22, 0.18, 16), '#c8bca8', { y: 0.09 }));
    K.body.push(P(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16), '#3a8fb0', { y: 0.17, noAO: true }));
    for (const x of [-0.17, 0.17]) K.body.push(P(box(0.035, 0.36, 0.035, 0.01, 1), '#8a6244', { x, y: 0.3 }));
    gable(K, { w: 0.46, d: 0.3, y0: 0.47, h: 0.14, roof: '#d9734e', wall: '#8a6244', ov: 0.04 });
    K.body.push(P(new THREE.CylinderGeometry(0.04, 0.035, 0.06, 8), '#9a7650', { y: 0.32, noAO: true }));
  },
  market(K) {
    K.body.push(P(box(0.84, 0.05, 0.6, 0.02), '#b98a5e', { y: 0.025 }));
    for (const [x, z] of [[-0.38, -0.25], [0.38, -0.25], [-0.38, 0.25], [0.38, 0.25]]) K.body.push(P(box(0.035, 0.46, 0.035, 0.01, 1), '#8a6244', { x, y: 0.25, z }));
    for (let k = 0; k < 7; k++) K.body.push(P(box(0.125, 0.025, 0.72, 0.01, 1), k % 2 ? '#fff3e0' : '#e0654f', { x: -0.375 + k * 0.125, y: 0.5, z: 0.02, rx: -0.22, noAO: true }));
    K.body.push(P(box(0.76, 0.16, 0.22, 0.02), '#a77a52', { y: 0.13, z: 0.12 }));
    for (let k = 0; k < 12; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.035, 1), pick(['#ff8a3d', '#e8443a', '#9ccc65', '#ffd54a']), { x: -0.32 + (k % 6) * 0.13, y: 0.23, z: 0.07 + Math.floor(k / 6) * 0.1, noAO: true }));
    for (const x of [-0.3, 0.3]) K.body.push(P(new THREE.CylinderGeometry(0.07, 0.07, 0.16, 10), '#9a7650', { x, y: 0.08, z: -0.2 }));
  },
  healer(K) {
    K.body.push(P(new THREE.CylinderGeometry(0.3, 0.31, 0.4, 18), '#f6f1e8', { y: 0.2 }));
    K.body.push(P(new THREE.SphereGeometry(0.33, 18, 10, 0, TAU, 0, Math.PI / 2), ['#3f9c8f', '#6cc8b6'], { y: 0.39, noAO: true }));
    K.body.push(P(new THREE.SphereGeometry(0.04, 8, 6), '#f2c35b', { y: 0.74, noAO: true }));
    door(K, 0, 0, 0.3, 0.14, 0.24, '#3f7f74');
    windowAt(K, 0.21, 0.24, 0.21, 'z', 0.08, 0.1); windowAt(K, -0.21, 0.24, 0.21, 'z', 0.08, 0.1);
    K.glow.push(P(box(0.1, 0.1, 0.02, 0.01, 1), '#ffffff', { y: 0.33, z: 0.32, noAO: true }));
    for (const [x, z] of [[0.36, 0.3], [-0.36, 0.32], [0.4, -0.05]]) {
      K.body.push(P(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 8), '#c4774f', { x, y: 0.035, z }));
      K.body.push(P(new THREE.IcosahedronGeometry(0.06, 1), '#6aaa50', { x, y: 0.1, z, noAO: true }));
    }
  },
  shrine(K) {
    K.body.push(P(new THREE.CylinderGeometry(0.46, 0.48, 0.07, 24), '#e6dccb', { y: 0.035 }));
    K.body.push(P(new THREE.CylinderGeometry(0.36, 0.38, 0.07, 24), '#efe7d8', { y: 0.1, noAO: true }));
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * TAU + 0.3;
      K.body.push(P(new THREE.CylinderGeometry(0.03, 0.035, 0.55, 8), '#f6f0e4', { x: Math.cos(a) * 0.3, y: 0.41, z: Math.sin(a) * 0.3 }));
    }
    K.body.push(P(new THREE.TorusGeometry(0.31, 0.03, 6, 32), '#d9c9a8', { y: 0.7, rx: Math.PI / 2, noAO: true }));
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(0.13, 0), matCrystal);
    cr.scale.set(1, 1.7, 1); cr.position.set(0, 0.45, 0);
    K.extra.push(cr); K.spin.push({ obj: cr, y0: 0.45, bob: 0.04, rot: 0.7 });
  },
  fountain(K) {
    K.body.push(P(new THREE.CylinderGeometry(0.38, 0.4, 0.12, 24), '#d9cdb8', { y: 0.06 }));
    K.body.push(P(new THREE.CylinderGeometry(0.07, 0.09, 0.32, 10), '#e6dccb', { y: 0.2 }));
    K.body.push(P(new THREE.CylinderGeometry(0.16, 0.06, 0.06, 16), '#e6dccb', { y: 0.37, noAO: true }));
    K.body.push(P(new THREE.SphereGeometry(0.045, 10, 8), '#f2c35b', { y: 0.43, noAO: true }));
    const w = new THREE.Mesh(disc(0.33, 0, true), matPond); w.position.y = 0.115; K.extra.push(w);
    for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; K.body.push(P(new THREE.SphereGeometry(0.075, 10, 8), '#5f9e4c', { x: Math.cos(a) * 0.46, y: 0.07, z: Math.sin(a) * 0.46, sy: 0.9 })); }
  },
  garden(K) {
    K.body.push(P(box(0.86, 0.05, 0.86, 0.04), '#7fb05d', { y: 0.02, noAO: true }));
    for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + 0.785; K.body.push(P(box(0.3, 0.12, 0.12, 0.05), '#5a9547', { x: Math.cos(a) * 0.3, y: 0.07, z: Math.sin(a) * 0.3, ry: -a })); }
    for (let k = 0; k < 18; k++) K.body.push(P(new THREE.IcosahedronGeometry(0.03, 0), pick(['#ff8fb0', '#ffe066', '#ffffff', '#c7a6ff', '#ff9a5a']), { x: (rnd() - 0.5) * 0.7, y: 0.07, z: (rnd() - 0.5) * 0.7, noAO: true }));
    K.body.push(P(new THREE.CylinderGeometry(0.05, 0.07, 0.1, 8), '#d9cdb8', { y: 0.07 }));
    K.body.push(P(new THREE.SphereGeometry(0.07, 10, 8), '#e6dccb', { y: 0.18, noAO: true }));
  },
  windmill(K) {
    K.body.push(P(new THREE.CylinderGeometry(0.17, 0.27, 0.9, 14), ['#e6d8bf', '#f6eedf'], { y: 0.45 }));
    K.body.push(P(new THREE.ConeGeometry(0.24, 0.3, 14), '#d9734e', { y: 1.05, noAO: true }));
    door(K, 0, 0, 0.255, 0.13, 0.22);
    windowAt(K, 0, 0.58, 0.215, 'z', 0.07, 0.1);
    const hub = new THREE.Group(); hub.position.set(0, 0.86, 0.24);
    const bl = [];
    bl.push(P(new THREE.CylinderGeometry(0.04, 0.04, 0.06, 8), '#8a6244', { rx: Math.PI / 2, noAO: true }));
    for (let k = 0; k < 4; k++) {
      const a = k / 4 * TAU;
      bl.push(P(box(0.035, 0.5, 0.015, 0.008, 1), '#8a6244', { x: Math.sin(a) * 0.27, y: Math.cos(a) * 0.27, rz: -a, z: 0.02, noAO: true }));
      bl.push(P(box(0.11, 0.38, 0.01, 0.006, 1), '#fbf3e4', { x: Math.sin(a) * 0.3 + Math.cos(a) * 0.06, y: Math.cos(a) * 0.3 - Math.sin(a) * 0.06, rz: -a, z: 0.03, noAO: true }));
    }
    const bm = meshOf(bl, matStd); hub.add(bm);
    K.extra.push(hub); K.spin.push({ obj: hub, spinZ: 0.8 });
  },
  field(K) {
    K.body.push(P(box(0.92, 0.05, 0.92, 0.03), '#8b6a4a', { y: 0.02, noAO: true }));
    const wheat = rnd() < 0.6;
    for (let r = 0; r < 5; r++) {
      if (wheat) K.body.push(P(box(0.13, 0.13, 0.84, 0.05), ['#d9a83f', '#f2d27a'], { x: -0.36 + r * 0.18, y: 0.1, noAO: true }));
      else for (let c = 0; c < 5; c++) K.body.push(P(new THREE.IcosahedronGeometry(0.065, 1), ['#6aa84f', '#a5d67a'], { x: -0.36 + r * 0.18, y: 0.09, z: -0.36 + c * 0.18, noAO: true }));
    }
  },
};

// 夜裡地上的燈光暈
function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
const texGlow = glowTexture();
const matPool = new THREE.MeshBasicMaterial({ map: texGlow, color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
const matPoolCyan = matPool.clone(); matPoolCyan.color.set(0x5fe0ff);
const POOL = { 1: 0.7, 2: 0.8, 3: 1.0, 4: 1.2, 5: 1.4, 6: 1.7, market: 1.0, healer: 1.0, shrine: 1.8 };

// 依樣板組成可放進場景的群組
function assemble(fn, type) {
  const K = newKit();
  fn(K);
  const g = new THREE.Group();
  if (K.body.length) g.add(meshOf(K.body, matStd));
  if (K.glow.length) { const m = meshOf(K.glow, matWin, false); g.add(m); }
  if (K.fire.length) { const m = meshOf(K.fire, matFire, false); g.add(m); }
  for (const e of K.extra) { e.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); g.add(e); }
  if (POOL[type]) {
    const sz = POOL[type], cyan = type === 'shrine';
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(sz, sz).rotateX(-PI / 2), cyan ? matPoolCyan : matPool);
    pool.position.set(0, 0.05, cyan ? 0 : 0.42); pool.renderOrder = 3; g.add(pool);
  }
  g.userData.kit = K;
  return g;
}

const PI = Math.PI;
const placements = [
  // [i, j, 類型, 朝向]   朝向：前門朝 +z 為 0
  [-1, -1, 6, 0], [0, -1, 5, 0], [-3, -1, 4, 0], [-4, -1, 3, 0], [-5, -1, 2, 0], [-6, -1, 1, 0],
  [-1, 1, 4, PI], [-4, 1, 2, PI], [-5, 1, 1, PI], [-6, 1, 1, PI],
  [-3, -3, 5, PI / 2], [-3, -4, 4, PI / 2], [-3, -5, 3, PI / 2], [-3, 2, 3, PI / 2], [-3, 3, 2, PI / 2], [-3, 4, 1, PI / 2],
  [-1, 2, 3, -PI / 2], [-1, 4, 2, -PI / 2], [-1, -5, 4, -PI / 2],
  [4, -1, 2, 0], [5, -1, 1, 0], [4, 1, 1, PI], [5, 1, 2, PI], [3, 1, 1, PI],
  [0, 1, 'well', PI], [-1, 3, 'market', -PI / 2], [1, -1, 'healer', 0], [0, -3, 'shrine', 0],
  [-1, -3, 'fountain', -PI / 2], [-1, -2, 'garden', 0], [0, -2, 'garden', 0],
  [-5, 3, 'windmill', PI / 4], [-5, 2, 'field', 0], [-4, 2, 'field', 0], [-4, 3, 'field', 0], [-4, 4, 'field', 0],
];

const slots = [];      // 會升級的房子
const animated = [];   // 會轉、會飄的東西
const chimneyList = [];
for (const [i, j, type, rot] of placements) {
  if (!inside(i, j, 0.6)) { console.warn('島外，略過', i, j, type); continue; }
  if (occ.has(key(i, j))) { console.warn('重疊，略過', i, j, type); continue; }
  if (riverDist(i, j) < 0.82) { console.warn('壓到河，略過', i, j, type); continue; }
  occ.set(key(i, j), type);
  const g = assemble(typeof type === 'number' ? HOUSES[type] : SERVICES[type], type);
  g.position.set(i, 0, j); g.rotation.y = rot;
  world.add(g);
  if (typeof type === 'number') slots.push({ i, j, rot, tier: type, group: g, anim: null });
  else registerKit(g);
}
function registerKit(g) {
  for (const s of g.userData.kit.spin) animated.push({ ...s, owner: g });
}
for (const s of slots) registerKit(s.group);

// 路燈
const lampPos = [];
for (const [i, j] of roads) {
  if (!occ.has(key(i, j)) || occ.get(key(i, j)) !== 'road') continue;
  if ((i * 7 + j * 3) % 3 !== 0) continue;
  const x = i + (j === 0 ? 0 : 0.43), z = j + (j === 0 ? 0.43 : 0);
  S.push(P(new THREE.CylinderGeometry(0.016, 0.022, 0.4, 6), '#4b4256', { x, y: 0.2, z, noAO: true }));
  S.push(P(new THREE.ConeGeometry(0.05, 0.04, 6), '#4b4256', { x, y: 0.465, z, noAO: true }));
  SW.push(P(box(0.055, 0.07, 0.055, 0.015, 1), '#ffffff', { x, y: 0.41, z, noAO: true }));
  lampPos.push(new THREE.Vector3(x, 0.04, z));
}

// ---------------------------------------------------------------- 植被
function tree(x, z, kind, s = 1) {
  const sway = { sway: 1, swayFrom: 0.12 * s };
  if (kind === 'pine') {
    ST.push(P(new THREE.CylinderGeometry(0.03 * s, 0.045 * s, 0.18 * s, 6), '#7a5236', { x, y: 0.09 * s, z, ...sway, sway: 0 }));
    for (let k = 0; k < 3; k++) ST.push(P(new THREE.ConeGeometry((0.28 - k * 0.07) * s, 0.3 * s, 9), ['#3f7d4a', '#5f9e5a'], { x, y: (0.28 + k * 0.17) * s, z, ...sway, noAO: true }));
    return;
  }
  const leaf = kind === 'blossom' ? ['#e98aa6', '#ffc6d6'] : kind === 'gold' ? ['#e09a3a', '#f7cf6a'] : pick([['#4f9a4f', '#8cc96a'], ['#5aa457', '#a3d47a'], ['#3f8a52', '#79bd6a']]);
  ST.push(P(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.26 * s, 6), '#7a5236', { x, y: 0.13 * s, z, ...sway, sway: 0 }));
  const blobs = 1 + Math.floor(rnd() * 3);
  for (let k = 0; k < blobs; k++) {
    const r = (0.2 - k * 0.03) * s, ox = (rnd() - 0.5) * 0.14 * s, oz = (rnd() - 0.5) * 0.14 * s;
    ST.push(P(new THREE.IcosahedronGeometry(r, 2), leaf, { x: x + ox, y: (0.38 + k * 0.1) * s, z: z + oz, sy: 0.9, ...sway, noAO: true }));
  }
}
const treeCells = [];
for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) {
  if (!inside(i, j, 0.25) || occ.has(key(i, j))) continue;
  if (riverDist(i, j) < 0.75) continue;
  const edge = 1 - smooth(0, 3, rf(Math.atan2(j, i)) - Math.hypot(i, j));
  const nearTown = Math.abs(j) <= 1 || Math.abs(i + 2) <= 1;
  const p = nearTown ? 0.35 : 0.55 + edge * 0.3;
  if (rnd() > p) continue;
  const n = 1 + Math.floor(rnd() * (nearTown ? 1.5 : 3));
  for (let k = 0; k < n; k++) {
    const x = i + (rnd() - 0.5) * 0.7, z = j + (rnd() - 0.5) * 0.7;
    if (riverDist(x, z) < 0.6) continue;
    const r = rnd();
    tree(x, z, r < 0.25 ? 'pine' : r < 0.36 ? 'blossom' : r < 0.42 ? 'gold' : 'round', 0.8 + rnd() * 0.45);
  }
  treeCells.push([i, j]);
}
// 河邊蘆葦、草叢與滿地小花
for (let k = 0; k < 520; k++) {
  const a = rnd() * TAU, r = Math.sqrt(rnd()) * (rf(a) - 0.4);
  const x = Math.cos(a) * r, z = Math.sin(a) * r;
  const ci = Math.round(x), cj = Math.round(z);
  const o = occ.get(key(ci, cj));
  if (o && Math.abs(x - ci) < 0.48 && Math.abs(z - cj) < 0.48) continue;
  const rd = riverDist(x, z);
  if (rd < 0.5) continue;
  if (rd < 0.75 && rnd() < 0.7) { S.push(P(new THREE.ConeGeometry(0.02, 0.18 + rnd() * 0.1, 4), '#6f9a46', { x, y: 0.1, z, noAO: true })); continue; }
  if (rnd() < 0.35) S.push(P(new THREE.IcosahedronGeometry(0.05 + rnd() * 0.04, 1), ['#4f8f45', '#7dbb5c'], { x, y: 0.03, z, sy: 0.7, noAO: true }));
  else S.push(P(new THREE.IcosahedronGeometry(0.026, 0), pick(['#ffffff', '#ffd6e0', '#ffe27a', '#f7a8c8', '#c9b6ff', '#ffffff']), { x, y: 0.035, z, noAO: true }));
}
// 島緣的石頭與垂下的根、藤
for (let k = 0; k < 26; k++) {
  const a = rnd() * TAU, r = rf(a) - 0.35 - rnd() * 0.4;
  S.push(P(new THREE.IcosahedronGeometry(0.06 + rnd() * 0.1, 1), ['#9a948c', '#c2bcb2'], { x: Math.cos(a) * r, y: 0.02, z: Math.sin(a) * r, sy: 0.6, ry: rnd() * 3 }));
}
for (let k = 0; k < 22; k++) {
  const a = rnd() * TAU, R = rf(a) - 0.04;
  const L = 0.6 + rnd() * 1.6, sx = Math.cos(a), sz = Math.sin(a);
  const vine = rnd() < 0.55;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(sx * R, -0.25, sz * R),
    new THREE.Vector3(sx * (R + 0.08), -0.25 - L * 0.4, sz * (R + 0.08)),
    new THREE.Vector3(sx * (R + 0.02), -0.25 - L, sz * (R + 0.02)),
  ]);
  S.push(P(new THREE.TubeGeometry(curve, 8, vine ? 0.018 : 0.026, 4), vine ? '#4f8a45' : '#6b4a35', { noAO: true }));
  if (vine) for (let t = 0.2; t < 1; t += 0.2) { const p = curve.getPoint(t); S.push(P(new THREE.IcosahedronGeometry(0.045, 0), '#5fa04f', { x: p.x, y: p.y, z: p.z, noAO: true })); }
}
// 島底垂下的岩柱
for (let k = 0; k < 9; k++) {
  const a = rnd() * TAU, t = 0.25 + rnd() * 0.35;
  const r = rf(a) * Math.pow(1 - t, 0.8) * 0.82, y = -0.36 - t * 7.2;
  const h = 0.8 + rnd() * 1.4;
  S.push(P(new THREE.ConeGeometry(0.25 + rnd() * 0.25, h, 6), ['#463f63', '#6a5d82'], { x: Math.cos(a) * r, y: y - h / 2 + 0.2, z: Math.sin(a) * r, rx: PI, noAO: true }));
}

world.add(meshOf(S, matStd));
if (SW.length) world.add(meshOf(SW, matWin, false));
{ const tm = meshOf(ST, matTree); world.add(tm); }

// 路燈在地上的光暈
{
  const geos = lampPos.map((p) => new THREE.PlaneGeometry(1.1, 1.1).rotateX(-PI / 2).translate(p.x, 0.05, p.z));
  const pools = new THREE.Mesh(mergeGeometries(geos), matPool); pools.renderOrder = 3; world.add(pools);
}

// ---------------------------------------------------------------- 小浮島
const islets = [];
for (const [x, y, z, base, depth] of [[-10.5, 1.2, -4.5, 1.5, 2.6], [8.5, -2.4, -8.5, 1.1, 2.0], [-7.5, -3.6, 8, 0.85, 1.6], [11, 2.8, 4.5, 0.7, 1.3]]) {
  const irf = radiusFn(base);
  const { top, rock } = buildIsland(irf, depth, { seg: 48, rings: 6, lip: 0.14 });
  const g = new THREE.Group();
  const a = new THREE.Mesh(top, matStd), b = new THREE.Mesh(rock, matRock);
  a.receiveShadow = b.receiveShadow = true; a.castShadow = b.castShadow = true;
  g.add(a, b);
  const tl = ST.length;
  const nT = base > 1 ? 3 : 1;
  for (let k = 0; k < nT; k++) { const aa = rnd() * TAU, rr = rnd() * base * 0.45; tree(Math.cos(aa) * rr, Math.sin(aa) * rr, rnd() < 0.4 ? 'pine' : 'round', 0.9); }
  const tg = ST.splice(tl);
  if (tg.length) g.add(meshOf(tg, matTree));
  g.position.set(x, y, z);
  g.userData.y0 = y; g.userData.ph = rnd() * TAU;
  scene.add(g); islets.push(g);
}

// ---------------------------------------------------------------- 雲
function cloudGeo(n, spread, r0) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const r = r0 * (0.6 + rnd() * 0.6);
    parts.push(P(new THREE.IcosahedronGeometry(r, 2), ['#b9c6e6', '#ffffff'], { x: (rnd() - 0.5) * spread, y: rnd() * r0 * 0.5, z: (rnd() - 0.5) * spread * 0.5, sy: 0.75, noAO: true }));
  }
  return mergeGeometries(parts);
}
const clouds = [];
for (let k = 0; k < 13; k++) {
  const high = k < 4;
  const m = new THREE.Mesh(cloudGeo(5 + Math.floor(rnd() * 5), high ? 2.4 : 4, high ? 0.55 : 1.0), matCloud.clone());
  m.material.transparent = true;
  const a = rnd() * TAU, r = (high ? 10 : 12) + rnd() * 9;
  m.position.set(Math.cos(a) * r, high ? 3.5 + rnd() * 2.5 : -6 - rnd() * 5, Math.sin(a) * r);
  m.userData.v = 0.15 + rnd() * 0.25;
  scene.add(m); clouds.push(m);
}
{ // 瀑布底下一團雲，讓水「落進雲裡」
  const ft = world.userData.fallTop;
  const m = new THREE.Mesh(cloudGeo(9, 4, 1.1), matCloud);
  m.position.set(ft.x + world.userData.fallOut.x * 1.4, -11.2, ft.z + world.userData.fallOut.z * 1.4);
  m.userData.v = 0; scene.add(m);
}

// 雲海（著色器平面）＋天空背景（螢幕空間漸層與星星）
const GLSL_NOISE = `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y); }
  float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vn(p); p = p * 2.03 + 17.1; a *= 0.5; } return s; }
`;
const seaU = { uTime, uLight: { value: C('#ffffff') }, uShadow: { value: C('#b8cbe8') }, uHorizon: { value: C('#cfeaff') }, uShadowC: { value: new THREE.Vector2() } };
const sea = new THREE.Mesh(new THREE.PlaneGeometry(220, 220).rotateX(-PI / 2), new THREE.ShaderMaterial({
  uniforms: seaU,
  vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `${GLSL_NOISE}
    uniform float uTime; uniform vec3 uLight, uShadow, uHorizon; uniform vec2 uShadowC; varying vec3 vW;
    void main(){
      vec2 p = vW.xz * 0.055 + vec2(uTime * 0.008, uTime * 0.003);
      float n = fbm(p) * 0.75 + fbm(p * 2.6 - vec2(uTime * 0.01, 0.0)) * 0.4;
      float c = smoothstep(0.38, 0.85, n);
      vec3 col = mix(uShadow, uLight, c);
      float sd = length(vW.xz - uShadowC);
      col *= mix(0.72, 1.0, smoothstep(3.5, 9.0, sd));
      float r = length(vW.xz);
      col = mix(col, uHorizon, smoothstep(18.0, 40.0, r));
      gl_FragColor = vec4(col, 1.0 - smoothstep(32.0, 46.0, r));
    }`,
}));
sea.material.transparent = true; sea.material.depthWrite = false; sea.renderOrder = -999;
sea.position.y = -13;
scene.add(sea);

const skyU = { uTop: { value: C('#4f98ea') }, uHor: { value: C('#cfeaff') }, uStars: { value: 0 }, uTime };
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: skyU, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHor; uniform float uStars, uTime; varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 col = mix(uHor, uTop, smoothstep(0.35, 1.0, vUv.y));
      vec2 g = floor(gl_FragCoord.xy / 5.0); float h = h21(g);
      vec2 f = fract(gl_FragCoord.xy / 5.0) - 0.5;
      float star = step(0.993, h) * (1.0 - smoothstep(0.0, 0.32, length(f))) * (0.55 + 0.45 * sin(uTime * 2.0 + h * 90.0));
      col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.45, 0.85, vUv.y) * 1.6;
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -1000;
scene.add(sky);

// ---------------------------------------------------------------- 光
const hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.6);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.025; sun.shadow.radius = 3;
scene.add(hemi, sun, sun.target);

// 一天的關鍵影格（t：0 = 午夜）
const KEYS = [
  { t: 0.00, top: '#0a1030', hor: '#26386e', sun: '#a9bcff', si: 1.6, hs: '#4d64a6', hg: '#2e3260', hi: 1.35, glow: 1.0, cl: '#7486c4', cs: '#26315e', ex: 1.0 },
  { t: 0.21, top: '#1d2a5e', hor: '#b97d9a', sun: '#ff9fa0', si: 0.9, hs: '#6b6fa8', hg: '#4a4260', hi: 1.0, glow: 0.8, cl: '#c7a6c4', cs: '#55507e', ex: 1.0 },
  { t: 0.27, top: '#4d78c2', hor: '#ffc29a', sun: '#ffb27a', si: 2.6, hs: '#a8b8e0', hg: '#a08aa0', hi: 1.3, glow: 0.25, cl: '#ffe2cf', cs: '#a497bf', ex: 1.0 },
  { t: 0.37, top: '#4f93e4', hor: '#cfe7ff', sun: '#ffeccc', si: 3.1, hs: '#cadff8', hg: '#b9b6d6', hi: 1.35, glow: 0.0, cl: '#ffffff', cs: '#b4c4e4', ex: 1.0 },
  { t: 0.50, top: '#3f8ae6', hor: '#c4e2ff', sun: '#fff1d8', si: 3.2, hs: '#d4e6fb', hg: '#bdb9da', hi: 1.35, glow: 0.0, cl: '#ffffff', cs: '#a9c3ea', ex: 1.0 },
  { t: 0.64, top: '#5a92e0', hor: '#ffe3c0', sun: '#ffe0aa', si: 3.1, hs: '#c8dcf8', hg: '#c2b3c8', hi: 1.3, glow: 0.0, cl: '#fff6ea', cs: '#b9c2e0', ex: 1.0 },
  { t: 0.73, top: '#4a5aa8', hor: '#ff9e6a', sun: '#ff8a48', si: 2.8, hs: '#b09ac8', hg: '#a07f9a', hi: 1.2, glow: 0.45, cl: '#ffc49e', cs: '#8f6fa6', ex: 1.0 },
  { t: 0.80, top: '#232a6a', hor: '#d0708a', sun: '#ff9a8a', si: 1.6, hs: '#6a5c98', hg: '#4e4068', hi: 1.25, glow: 0.9, cl: '#a586b4', cs: '#3e3870', ex: 1.0 },
  { t: 0.90, top: '#0c1234', hor: '#2a3a70', sun: '#a9bcff', si: 1.6, hs: '#4d64a6', hg: '#2e3260', hi: 1.35, glow: 1.0, cl: '#7486c4', cs: '#26315e', ex: 1.0 },
];
const COLOR_KEYS = ['top', 'hor', 'sun', 'hs', 'hg', 'cl', 'cs'];
for (const k of KEYS) for (const c of COLOR_KEYS) k[c] = C(k[c]);
const L = { glow: 0 };
for (const c of COLOR_KEYS) L[c] = new THREE.Color();
function sampleDay(t) {
  t = ((t % 1) + 1) % 1;
  let a = KEYS[KEYS.length - 1], b = KEYS[0], u;
  for (let i = 0; i < KEYS.length; i++) {
    const k0 = KEYS[i], k1 = KEYS[(i + 1) % KEYS.length];
    const t1 = i + 1 < KEYS.length ? k1.t : 1;
    if (t >= k0.t && t < t1) { a = k0; b = k1; u = (t - k0.t) / (t1 - k0.t); break; }
  }
  u = smooth(0, 1, u);
  for (const c of COLOR_KEYS) L[c].copy(a[c]).lerp(b[c], u);
  for (const n of ['si', 'hi', 'glow']) L[n] = lerp(a[n], b[n], u);
  return L;
}
const sunDir = new THREE.Vector3();
function applyDay(t) {
  const d = sampleDay(t);
  skyU.uTop.value.copy(d.top); skyU.uHor.value.copy(d.hor);
  skyU.uStars.value = smooth(0.3, 1, d.glow) * (1 - smooth(0.2, 0.3, t) * smooth(0.82, 0.72, t));
  seaU.uLight.value.copy(d.cl); seaU.uShadow.value.copy(d.cs); seaU.uHorizon.value.copy(d.hor);
  sun.color.copy(d.sun); sun.intensity = d.si;
  hemi.color.copy(d.hs); hemi.groundColor.copy(d.hg); hemi.intensity = d.hi;
  const e = Math.sin((t - 0.25) * TAU);
  const elev = 0.38 + 0.5 * Math.abs(e);
  const az = t * TAU + 0.6;
  sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
  sun.position.copy(sunDir).multiplyScalar(40); sun.target.position.set(0, -1, 0);
  seaU.uShadowC.value.set(-sunDir.x * 13 / sunDir.y, -sunDir.z * 13 / sunDir.y);
  matWin.emissiveIntensity = d.glow * 6;
  matPool.opacity = d.glow * 0.6; matPoolCyan.opacity = d.glow * 0.5;
  matCloud.emissive.copy(d.cl).multiplyScalar(0.12);
  matCrystal.emissiveIntensity = 0.9 + d.glow * 2.2;
  const day = 1 - d.glow;
  matWater.emissiveIntensity = 0.1 + 0.28 * day; matFall.emissiveIntensity = 0.15 + 0.4 * day;
  fireflies.material.opacity = smooth(0.4, 1, d.glow);
  return d;
}

// ---------------------------------------------------------------- 生活感：行人、鳥、煙、螢火蟲、霧
const walkers = [];
// 一條路從中心往兩端延伸到第一個缺口為止
function roadSpan(c, axis) {
  const on = (k) => { const o = occ.get(axis === 'x' ? key(k, 0) : key(-2, k)); return o === 'road' || o === 'bridge'; };
  const mid = axis === 'x' ? -2 : 0;
  let lo = mid, hi = mid;
  while (on(lo - 1)) lo--;
  while (on(hi + 1)) hi++;
  return { a: lo - 0.3, b: hi + 0.3 };
}
{
  const skin = ['#f2d0b0', '#e2b48c', '#c98f68', '#f6dcc4'];
  const cloth = ['#d9734e', '#4f9ea3', '#5b7bb5', '#8a5f9e', '#f2c35b', '#6aa84f', '#e8e0d0'];
  for (let k = 0; k < 16; k++) {
    const g = new THREE.Group();
    const body = meshOf([P(new THREE.CapsuleGeometry(0.035, 0.06, 3, 8), pick(cloth), { y: 0.07, noAO: true }), P(new THREE.SphereGeometry(0.032, 8, 6), pick(skin), { y: 0.155, noAO: true })], matStd);
    g.add(body); g.scale.setScalar(1.1);
    const lineA = k % 3 !== 0;
    const lane = (k % 2 ? 1 : -1) * 0.2;
    const w = lineA ? { axis: 'x', ...roadSpan(0, 'x'), fixed: lane } : { axis: 'z', ...roadSpan(-2, 'z'), fixed: -2 + lane };
    w.s = lerp(w.a, w.b, rnd()); w.dir = rnd() < 0.5 ? 1 : -1; w.v = 0.28 + rnd() * 0.22; w.ph = rnd() * 10; w.pause = 0;
    w.obj = g; world.add(g); walkers.push(w);
  }
}
const birds = [];
{
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.04, 0, 0, -0.04, 0.16, 0, -0.02], 3));
  wingGeo.computeVertexNormals();
  const wm = new THREE.MeshStandardMaterial({ color: 0xfaf7f0, side: THREE.DoubleSide, roughness: 0.9 });
  for (let k = 0; k < 7; k++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 3, 6).rotateX(PI / 2), wm);
    const l = new THREE.Mesh(wingGeo, wm), r = new THREE.Mesh(wingGeo, wm); r.scale.x = -1;
    g.add(body, l, r); g.userData = { l, r, ph: rnd() * TAU, rad: 6 + rnd() * 3.5, h: 2.6 + rnd() * 1.6, sp: 0.18 + rnd() * 0.08, off: k * 0.22 };
    scene.add(g); birds.push(g);
  }
}
const matSmoke = new THREE.MeshStandardMaterial({ color: 0xf2efea, roughness: 1, transparent: true, depthWrite: false });
const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
const puffs = [];
for (let k = 0; k < 60; k++) { const m = new THREE.Mesh(smokeGeo, matSmoke.clone()); m.visible = false; scene.add(m); puffs.push({ m, life: 0, src: null }); }
const fireflies = (() => {
  const n = 90, pos = new Float32Array(n * 3), base = [];
  for (let k = 0; k < n; k++) {
    const [i, j] = treeCells.length ? pick(treeCells) : [0, 0];
    base.push([i + (rnd() - 0.5), 0.25 + rnd() * 0.5, j + (rnd() - 0.5), rnd() * TAU]);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0xd8ff8a, size: 0.09, map: texGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const p = new THREE.Points(g, m); p.userData.base = base; p.frustumCulled = false;
  world.add(p);
  return p;
})();
const mist = [];
{
  const ft = world.userData.fallTop, out = world.userData.fallOut;
  for (let k = 0; k < 14; k++) {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false, opacity: 0 }));
    m.userData = { life: rnd(), ft, out };
    scene.add(m); mist.push(m);
  }
}

// ---------------------------------------------------------------- 升級動畫
const sparks = [];
const sparkGeo = new THREE.OctahedronGeometry(0.035, 0);
const matSpark = new THREE.MeshStandardMaterial({ color: 0xfff1b8, emissive: 0xffd36b, emissiveIntensity: 3, transparent: true, depthWrite: false });
function burst(at) {
  for (let k = 0; k < 26; k++) {
    const m = new THREE.Mesh(sparkGeo, matSpark.clone());
    const a = rnd() * TAU, sp = 0.6 + rnd() * 1.2;
    m.position.copy(at).add(new THREE.Vector3(0, 0.3, 0));
    m.userData = { v: new THREE.Vector3(Math.cos(a) * sp * 0.5, 1.4 + rnd() * 1.4, Math.sin(a) * sp * 0.5), life: 0, max: 0.9 + rnd() * 0.6 };
    scene.add(m); sparks.push(m);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 6, 40).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, depthWrite: false }));
  ring.position.copy(at).setY(0.06); ring.userData = { ring: true, life: 0, max: 0.7 };
  scene.add(ring); sparks.push(ring);
}
function upgrade(slot) {
  if (slot.anim) return;
  slot.anim = { phase: 'down', t: 0, next: slot.tier % 6 + 1 };
}
function stepSlot(slot, dt) {
  const A = slot.anim; if (!A) return;
  A.t += dt;
  if (A.phase === 'down') {
    const u = clamp(A.t / 0.2, 0, 1);
    slot.group.scale.set(1 + 0.12 * u, 1 - 0.9 * easeInCubic(u), 1 + 0.12 * u);
    if (u >= 1) {
      for (let k = animated.length - 1; k >= 0; k--) if (animated[k].owner === slot.group) animated.splice(k, 1);
      world.remove(slot.group);
      slot.tier = A.next;
      slot.group = assemble(HOUSES[slot.tier], slot.tier);
      slot.group.position.set(slot.i, 0, slot.j); slot.group.rotation.y = slot.rot;
      slot.group.scale.set(1, 0.01, 1);
      world.add(slot.group); registerKit(slot.group);
      burst(new THREE.Vector3(slot.i, 0, slot.j));
      A.phase = 'up'; A.t = 0;
    }
  } else {
    const u = clamp(A.t / 0.7, 0, 1);
    const y = easeOutBack(u);
    const wob = Math.sin(u * PI * 3) * (1 - u) * 0.08;
    slot.group.scale.set(1 - wob, y, 1 - wob);
    if (u >= 1) { slot.group.scale.set(1, 1, 1); slot.anim = null; }
  }
}

// ---------------------------------------------------------------- 後製：移軸景深＋泛光＋調色
const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const fsScene = new THREE.Scene();
const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
fsScene.add(fsQuad);
const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const canHalf = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
const rtType = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
const mkRT = (samples = 0, depth = false) => new THREE.WebGLRenderTarget(1, 1, { type: rtType, samples, depthBuffer: depth });
const rtMain = mkRT(4, true), rtH1 = mkRT(), rtH2 = mkRT(), rtQ1 = mkRT(), rtQ2 = mkRT();
const matCopy = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() } }, vertexShader: VS,
  fragmentShader: `uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
    void main(){ vec3 c = texture2D(t, vUv + px * vec2(-0.5,-0.5)).rgb + texture2D(t, vUv + px * vec2(0.5,-0.5)).rgb + texture2D(t, vUv + px * vec2(-0.5,0.5)).rgb + texture2D(t, vUv + px * vec2(0.5,0.5)).rgb; gl_FragColor = vec4(c * 0.25, 1.0); }` });
const matBright = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() }, th: { value: 1.0 }, knee: { value: 0.8 } }, vertexShader: VS,
  fragmentShader: `uniform sampler2D t; uniform vec2 px; uniform float th, knee; varying vec2 vUv;
    void main(){ vec3 c = vec3(0.0);
      for (int i = 0; i < 4; i++){ vec2 o = vec2(float(i - (i/2)*2) - 0.5, float(i/2) - 0.5) * px; c += texture2D(t, vUv + o).rgb; }
      c *= 0.25; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(c * smoothstep(th, th + knee, l), 1.0); }` });
const matBlur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS,
  fragmentShader: `uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
    void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227027;
      c += (texture2D(t, vUv + dir * 1.3846).rgb + texture2D(t, vUv - dir * 1.3846).rgb) * 0.3162162;
      c += (texture2D(t, vUv + dir * 3.2308).rgb + texture2D(t, vUv - dir * 3.2308).rgb) * 0.0702703;
      gl_FragColor = vec4(c, 1.0); }` });
const post = { focus: 0.5, band: 0.11, feather: 0.3, dof: 1, bloom: 1.0, sat: 1.04, vig: 1 };
const matFinal = new THREE.ShaderMaterial({
  uniforms: { tS: { value: null }, tB: { value: null }, tG: { value: null }, uFocus: { value: 0.5 }, uBand: { value: 0.1 }, uFeather: { value: 0.3 }, uDof: { value: 1 }, uBloom: { value: 0.8 }, uSat: { value: 1.1 }, uVig: { value: 1 }, uTime },
  vertexShader: VS,
  fragmentShader: `uniform sampler2D tS, tB, tG; uniform float uFocus, uBand, uFeather, uDof, uBloom, uSat, uVig, uTime; varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 s = texture2D(tS, vUv).rgb, b = texture2D(tB, vUv).rgb;
      float m = smoothstep(uBand, uBand + uFeather, abs(vUv.y - uFocus)) * uDof;
      vec3 c = mix(s, b, m) + texture2D(tG, vUv).rgb * uBloom;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
      c *= vec3(1.035, 1.0, 0.965);
      c += vec3(0.010, 0.006, 0.024) * (1.0 - smoothstep(0.0, 0.45, l));
      vec2 q = vUv - 0.5; c *= mix(1.0, 1.0 - dot(q, q) * 1.1, uVig);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      gl_FragColor.rgb += (h21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.018;
    }`,
});
function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
let W = 1, H = 1, dpr = Math.min(window.devicePixelRatio || 1, 2);
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  rtMain.setSize(pw, ph);
  rtH1.setSize(pw >> 1, ph >> 1); rtH2.setSize(pw >> 1, ph >> 1);
  rtQ1.setSize(pw >> 2, ph >> 2); rtQ2.setSize(pw >> 2, ph >> 2);
  updateCamera();
}
function renderFrame() {
  renderer.setRenderTarget(rtMain); renderer.render(scene, camera);
  const hw = rtH1.width, hh = rtH1.height, qw = rtQ1.width, qh = rtQ1.height;
  // 景深用的模糊版（半解析度，兩輪）
  matCopy.uniforms.t.value = rtMain.texture; matCopy.uniforms.px.value.set(1 / rtMain.width, 1 / rtMain.height); pass(matCopy, rtH1);
  // 泛光（四分之一解析度，從半解析度取亮部）
  matBright.uniforms.t.value = rtH1.texture; matBright.uniforms.px.value.set(1 / hw, 1 / hh); pass(matBright, rtQ1);
  for (const sp of [1.0, 2.0, 3.0]) {
    matBlur.uniforms.t.value = rtQ1.texture; matBlur.uniforms.dir.value.set(sp / qw, 0); pass(matBlur, rtQ2);
    matBlur.uniforms.t.value = rtQ2.texture; matBlur.uniforms.dir.value.set(0, sp / qh); pass(matBlur, rtQ1);
  }
  for (const sp of [1.0, 2.2]) {
    matBlur.uniforms.t.value = rtH1.texture; matBlur.uniforms.dir.value.set(sp / hw, 0); pass(matBlur, rtH2);
    matBlur.uniforms.t.value = rtH2.texture; matBlur.uniforms.dir.value.set(0, sp / hh); pass(matBlur, rtH1);
  }
  const u = matFinal.uniforms;
  u.tS.value = rtMain.texture; u.tB.value = rtH1.texture; u.tG.value = rtQ1.texture;
  u.uFocus.value = post.focus; u.uBand.value = post.band; u.uFeather.value = post.feather;
  u.uDof.value = post.dof; u.uBloom.value = post.bloom; u.uSat.value = post.sat; u.uVig.value = post.vig;
  pass(matFinal, null);
}

// ---------------------------------------------------------------- 鏡頭操作
const cam = { yaw: 0.62, pitch: 0.56, size: 7.4, target: new THREE.Vector3(0, -1.1, 0), vyaw: 0 };
function updateCamera() {
  const aspect = W / H;
  const s = cam.size;
  const hw = s * Math.max(1, aspect), hh = s * Math.max(1, 1 / aspect);
  // 直式畫面：島面放在略高於中心處，讓下方露出岩層與瀑布
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
  const d = 60;
  camera.position.set(
    cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * d,
    cam.target.y + Math.sin(cam.pitch) * d,
    cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * d);
  camera.lookAt(cam.target);
  // 景深焦帶跟著島面：把島中心投到螢幕上
  const v = new THREE.Vector3(0, 0, 0).project(camera);
  post.focus = clamp(v.y * 0.5 + 0.5, 0.2, 0.8);
  post.band = clamp(0.6 * 7.6 * Math.sin(cam.pitch) / (2 * hh), 0.04, 0.14);
  post.feather = post.band * 1.6 + 0.08;
}
const pointers = new Map();
let gesture = null, lastInteract = 0;
const raycaster = new THREE.Raycaster();
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  gesture = pointers.size === 2 ? { pinch: dist2(), size: cam.size } : gesture;
  lastInteract = performance.now(); cam.vyaw = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    cam.yaw -= dx * 0.0065; cam.vyaw = -dx * 0.0065;
    cam.pitch = clamp(cam.pitch + dy * 0.004, 0.38, 0.95);
  } else if (pointers.size === 2 && gesture) {
    cam.size = clamp(gesture.size * gesture.pinch / Math.max(20, dist2()), 2.2, 11);
  }
  lastInteract = performance.now();
  updateCamera();
});
function endPointer(e) {
  const p = pointers.get(e.pointerId); if (!p) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) gesture = null;
  const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
  if (moved < 8 && performance.now() - p.t0 < 400 && pointers.size === 0) tap(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.size = clamp(cam.size * Math.exp(e.deltaY * 0.0012), 2.2, 11); updateCamera(); lastInteract = performance.now(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
function dist2() { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); }
function tap(x, y) {
  raycaster.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
  const hits = raycaster.intersectObjects(slots.map((s) => s.group), true);
  if (!hits.length) return;
  let o = hits[0].object;
  const slot = slots.find((s) => { let q = o; while (q) { if (q === s.group) return true; q = q.parent; } return false; });
  if (slot) { upgrade(slot); hideHint(); }
}

// ---------------------------------------------------------------- 介面
const ui = { play: document.getElementById('play'), tod: document.getElementById('tod'), lbl: document.getElementById('lbl'), dof: document.getElementById('dof'), hint: document.getElementById('hint'), fps: document.getElementById('fps') };
let tod = 0.7, playing = true;
const DAY_SECONDS = 80;
ui.play.addEventListener('click', () => {
  playing = !playing; ui.play.classList.toggle('on', playing);
  document.getElementById('ic-pause').style.display = playing ? '' : 'none';
  document.getElementById('ic-play').style.display = playing ? 'none' : '';
});
ui.tod.addEventListener('input', () => { tod = ui.tod.value / 1000; });
ui.dof.addEventListener('click', () => { post.dof = post.dof ? 0 : 1; ui.dof.classList.toggle('on', !!post.dof); });
let hintTimer = setTimeout(hideHint, 6500);
function hideHint() { ui.hint.classList.add('hide'); clearTimeout(hintTimer); }
function timeLabel(t) {
  const h = t * 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
  const name = h < 4.5 ? '深夜' : h < 6.5 ? '破曉' : h < 10 ? '清晨' : h < 13.5 ? '正午' : h < 16.5 ? '午後' : h < 18.8 ? '黃昏' : h < 21 ? '入夜' : '夜晚';
  return `${name}　${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
if (new URLSearchParams(location.search).has('fps')) ui.fps.style.display = 'block';

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Timer();
const themeMeta = document.querySelector('meta[name=theme-color]');
let acc = 0, frames = 0, slowStreak = 0;
const tmpV = new THREE.Vector3();
let smokeTimer = 0;
function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  uTime.value += dt;
  const T = uTime.value;
  if (playing) { tod = (tod + dt / DAY_SECONDS) % 1; ui.tod.value = Math.round(tod * 1000); }
  const d = applyDay(tod);
  ui.lbl.textContent = timeLabel(tod);

  // 閒置時鏡頭緩緩自轉；放手後有一點慣性
  if (!pointers.size) {
    cam.yaw += cam.vyaw; cam.vyaw *= 0.92;
    if (performance.now() - lastInteract > 7000) cam.yaw += dt * 0.035;
    updateCamera();
  }
  world.position.y = Math.sin(T * 0.5) * 0.05;

  texRiver.offset.y -= dt * 0.35; texFall.offset.y += dt * 1.6;
  matFire.emissiveIntensity = 2.2 + Math.sin(T * 13) * 0.4 + Math.sin(T * 7.3) * 0.3;

  for (const a of animated) {
    if (a.spinZ) a.obj.rotation.z -= dt * a.spinZ;
    if (a.rot) { a.obj.rotation.y += dt * a.rot; a.obj.position.y = a.y0 + Math.sin(T * 1.6) * a.bob; }
    if (a.flag) a.obj.rotation.y = Math.sin(T * 2.4 + a.ph) * 0.35;
  }
  for (const s of slots) stepSlot(s, dt);

  for (const w of walkers) {
    if (w.pause > 0) { w.pause -= dt; continue; }
    w.s += w.dir * w.v * dt;
    if (w.s > w.b || w.s < w.a) { w.dir *= -1; w.s = clamp(w.s, w.a, w.b); w.pause = 0.5 + rnd() * 2; }
    if (rnd() < dt * 0.04) w.pause = 0.8 + rnd() * 2.5;
    const x = w.axis === 'x' ? w.s : w.fixed, z = w.axis === 'x' ? w.fixed : w.s;
    const by = w.axis === 'x' ? bridgeY(x) - 0.035 : 0;
    w.obj.position.set(x, 0.035 + by + Math.abs(Math.sin(T * 9 + w.ph)) * 0.015, z);
    w.obj.rotation.y = w.axis === 'x' ? (w.dir > 0 ? PI / 2 : -PI / 2) : (w.dir > 0 ? 0 : PI);
  }
  for (const b of birds) {
    const u = b.userData, a = T * u.sp + u.off;
    b.position.set(Math.cos(a) * u.rad, u.h + Math.sin(T * 0.7 + u.ph) * 0.3 + world.position.y, Math.sin(a) * u.rad);
    b.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
    const f = Math.sin(T * 9 + u.ph) * 0.6;
    u.l.rotation.z = f; u.r.rotation.z = -f;
  }
  // 雲在島前方（較靠近鏡頭）且畫面上疊到島時淡出
  const iv = tmpV.set(0, -1.5, 0).applyMatrix4(camera.matrixWorldInverse).clone();
  for (const c of clouds) {
    c.position.x += c.userData.v * dt; if (c.position.x > 24) c.position.x = -24;
    const cv = tmpV.copy(c.position).applyMatrix4(camera.matrixWorldInverse);
    const over = cv.z > iv.z ? (1 - smooth(8, 11, Math.abs(cv.x - iv.x))) * (1 - smooth(6.5, 9, Math.abs(cv.y - iv.y))) : 0;
    c.material.opacity = lerp(c.material.opacity, 1 - over * 0.92, 0.1);
    c.material.emissive.copy(matCloud.emissive);
  }
  for (const g of islets) g.position.y = g.userData.y0 + Math.sin(T * 0.4 + g.userData.ph) * 0.18;

  // 炊煙
  smokeTimer -= dt;
  if (smokeTimer <= 0) {
    smokeTimer = 0.28;
    const srcs = [];
    for (const s of slots) for (const c of s.group.userData.kit.chimneys) srcs.push(s.group.localToWorld(tmpV.copy(c)).clone());
    const free = puffs.find((p) => p.life <= 0);
    if (free && srcs.length) { free.life = 1; free.src = pick(srcs); free.m.visible = true; free.m.userData.dx = (rnd() - 0.5) * 0.2; }
  }
  for (const p of puffs) {
    if (p.life <= 0) continue;
    p.life -= dt / 3.2;
    if (p.life <= 0) { p.m.visible = false; continue; }
    const u = 1 - p.life;
    p.m.position.set(p.src.x + u * 0.35 + p.m.userData.dx * u, p.src.y + u * 0.9, p.src.z - u * 0.15);
    p.m.scale.setScalar(0.03 + u * 0.09);
    p.m.material.opacity = Math.sin(u * PI) * 0.55;
    p.m.material.color.copy(d.cl).lerp(new THREE.Color(1, 1, 1), 0.4);
  }
  // 瀑布底的水霧
  for (const m of mist) {
    const u = m.userData; u.life += dt / 3.5; if (u.life > 1) u.life -= 1;
    const t = u.life, top = (m.id % 3) === 0;
    if (top) { m.position.set(u.ft.x + u.out.x * (0.5 + t * 0.4), -0.6 - t * 0.6 + world.position.y, u.ft.z + u.out.z * (0.5 + t * 0.4)); m.scale.setScalar(0.08 + t * 0.2); m.material.opacity = Math.sin(t * PI) * 0.35; }
    else { m.position.set(u.ft.x + u.out.x * 1.3 + Math.sin(m.id) * 0.6, -9 - t * 1.5, u.ft.z + u.out.z * 1.3 + Math.cos(m.id) * 0.6); m.scale.setScalar(0.4 + t * 0.9); m.material.opacity = Math.sin(t * PI) * 0.5; }
    m.material.color.copy(d.cl);
  }
  // 螢火蟲
  {
    const arr = fireflies.geometry.attributes.position.array, base = fireflies.userData.base;
    for (let k = 0; k < base.length; k++) {
      const [x, y, z, ph] = base[k];
      arr[k * 3] = x + Math.sin(T * 0.6 + ph) * 0.3; arr[k * 3 + 1] = y + Math.sin(T * 1.1 + ph * 2) * 0.12; arr[k * 3 + 2] = z + Math.cos(T * 0.5 + ph) * 0.3;
    }
    fireflies.geometry.attributes.position.needsUpdate = true;
    fireflies.material.size = 0.09 * (0.7 + 0.3 * Math.sin(T * 3));
  }
  // 火花
  for (let k = sparks.length - 1; k >= 0; k--) {
    const m = sparks[k], u = m.userData; u.life += dt;
    const t = u.life / u.max;
    if (t >= 1) { scene.remove(m); m.geometry !== sparkGeo && m.geometry.dispose(); m.material.dispose(); sparks.splice(k, 1); continue; }
    if (u.ring) { m.scale.setScalar(1 + t * 1.6); m.material.opacity = (1 - t) * 0.8; continue; }
    u.v.y -= dt * 2.2; m.position.addScaledVector(u.v, dt); m.rotation.x += dt * 6; m.rotation.y += dt * 4;
    m.material.opacity = 1 - t;
  }

  renderFrame();

  // 效能：連續偏慢就降解析度
  acc += dt; frames++;
  if (acc >= 1.5) {
    const fps = frames / acc;
    ui.fps.textContent = `${fps.toFixed(0)} fps · dpr ${dpr.toFixed(2)}`;
    themeMeta.content = '#' + d.top.getHexString(THREE.SRGBColorSpace);
    if (fps < 42 && dpr > 1.01) { if (++slowStreak >= 2) { dpr = Math.max(1, dpr - 0.25); resize(); slowStreak = 0; } } else slowStreak = 0;
    acc = 0; frames = 0;
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', resize);
resize();
applyDay(tod);
requestAnimationFrame(frame);

// 測試用
window.__isle = { setTime: (t) => { tod = t; }, pause: () => { playing = false; }, slots, upgrade, cam, post, updateCamera, renderer, get dpr() { return dpr; } };
