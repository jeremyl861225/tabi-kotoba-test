// 小鎮 · 風格試作 v2：隨機地形＋歐式小鎮，點房子升級、點空地蓋房子、兩岸有人住自動搭橋
import * as THREE from 'three';
import { makeRng, clamp, lerp, smooth, C, LH, DIRS, PI, TAU, easeOutBack, easeInCubic } from './util.js';
import { M, FX, uTime } from './kit.js';
import { genTerrain, buildTerrain } from './terrain.js';
import { genTown, buildTownMeshes, makeBridge, siteActive, U } from './town.js';
import { assemble, SERVICE_INFO, TIER_NAME } from './buildings.js';
import { createLife } from './life.js';
import { createPost } from './post.js';

const qs = new URLSearchParams(location.search);
const seed = parseInt(qs.get('seed'), 10) || (10000 + Math.floor(Math.random() * 89999));
let tod = qs.has('t') ? clamp(parseFloat(qs.get('t')), 0, 1) : 0.69;

// ---------------------------------------------------------------- 渲染器與場景
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
const post = createPost(renderer);

const skyU = { uTop: { value: C('#4f98ea') }, uHor: { value: C('#cfeaff') }, uStars: { value: 0 }, uTime };
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  uniforms: skyU, depthTest: false, depthWrite: false,
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHor; uniform float uStars, uTime; varying vec2 vUv;
    float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      vec3 col = mix(uHor, uTop, smoothstep(0.3, 1.0, vUv.y));
      vec2 g = floor(gl_FragCoord.xy / 5.0); float h = h21(g);
      vec2 f = fract(gl_FragCoord.xy / 5.0) - 0.5;
      float star = step(0.993, h) * (1.0 - smoothstep(0.0, 0.32, length(f))) * (0.55 + 0.45 * sin(uTime * 2.0 + h * 90.0));
      col += vec3(0.9, 0.95, 1.0) * star * uStars * smoothstep(0.45, 0.85, vUv.y) * 1.6;
      gl_FragColor = vec4(col, 1.0);
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -1000;
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1.4);
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
scene.add(hemi, sun, sun.target);

// ---------------------------------------------------------------- 一天
const KEYS = [
  { t: 0.00, top: '#0a1030', hor: '#26386e', sun: '#a9bcff', si: 1.6, hs: '#4d64a6', hg: '#2a2840', hi: 1.3, glow: 1.0, cl: '#7486c4' },
  { t: 0.21, top: '#1d2a5e', hor: '#b97d9a', sun: '#ff9fa0', si: 1.0, hs: '#6b6fa8', hg: '#3e3448', hi: 1.0, glow: 0.8, cl: '#c7a6c4' },
  { t: 0.27, top: '#4d78c2', hor: '#ffc29a', sun: '#ffb27a', si: 2.6, hs: '#a8b8e0', hg: '#7a6050', hi: 1.25, glow: 0.25, cl: '#ffe2cf' },
  { t: 0.37, top: '#4f93e4', hor: '#cfe7ff', sun: '#ffeccc', si: 3.1, hs: '#cadff8', hg: '#9a8a62', hi: 1.3, glow: 0.0, cl: '#ffffff' },
  { t: 0.50, top: '#3f8ae6', hor: '#c4e2ff', sun: '#fff1d8', si: 3.2, hs: '#d4e6fb', hg: '#a0906a', hi: 1.3, glow: 0.0, cl: '#ffffff' },
  { t: 0.64, top: '#5a92e0', hor: '#ffe3c0', sun: '#ffe0aa', si: 3.1, hs: '#c8dcf8', hg: '#9a7a54', hi: 1.25, glow: 0.0, cl: '#fff6ea' },
  { t: 0.73, top: '#4a5aa8', hor: '#ff9e6a', sun: '#ff8a48', si: 2.8, hs: '#b09ac8', hg: '#6a4a40', hi: 1.15, glow: 0.45, cl: '#ffc49e' },
  { t: 0.80, top: '#232a6a', hor: '#d0708a', sun: '#ff9a8a', si: 1.6, hs: '#6a5c98', hg: '#2e2440', hi: 1.15, glow: 0.9, cl: '#a586b4' },
  { t: 0.90, top: '#0c1234', hor: '#2a3a70', sun: '#a9bcff', si: 1.6, hs: '#4d64a6', hg: '#2a2840', hi: 1.3, glow: 1.0, cl: '#7486c4' },
];
const CK = ['top', 'hor', 'sun', 'hs', 'hg', 'cl'];
for (const k of KEYS) for (const c of CK) k[c] = C(k[c]);
const D = { glow: 0 }; for (const c of CK) D[c] = new THREE.Color();
function sampleDay(t) {
  t = ((t % 1) + 1) % 1;
  let a = KEYS[KEYS.length - 1], b = KEYS[0], u = 0;
  for (let i = 0; i < KEYS.length; i++) {
    const k0 = KEYS[i], k1 = KEYS[(i + 1) % KEYS.length], t1 = i + 1 < KEYS.length ? k1.t : 1;
    if (t >= k0.t && t < t1) { a = k0; b = k1; u = (t - k0.t) / (t1 - k0.t); break; }
  }
  u = smooth(0, 1, u);
  for (const c of CK) D[c].copy(a[c]).lerp(b[c], u);
  for (const n of ['si', 'hi', 'glow']) D[n] = lerp(a[n], b[n], u);
  return D;
}
const sunDir = new THREE.Vector3();

// ---------------------------------------------------------------- 世界
let T, town, terr, life;
const anims = [];        // 會轉、會飄的東西
const blds = new Map();  // building id → group
const bridges = new Map();
const sparks = [];
const transitions = [];
const loading = document.getElementById('loading');

function addBuildingGroup(b, grow = false, delay = 0) {
  const g = assemble(b.type, b.tier, b.seed, life ? life.pools : null);
  g.position.set(b.x, b.y, b.z); g.rotation.y = b.ry;
  g.userData.bid = b.id;
  scene.add(g); blds.set(b.id, g);
  g.updateMatrixWorld(true);
  b.chim = g.userData.kit.chimneys.map((v) => g.localToWorld(v.clone()));
  for (const s of g.userData.kit.spin) anims.push({ ...s, owner: g });
  if (grow) { g.scale.set(1, 0.01, 1); transitions.push({ g, t: -delay, kind: 'grow', at: new THREE.Vector3(b.x, b.y, b.z), size: b.cells.length }); }
  return g;
}
function removeBuildingGroup(id, shrink = true) {
  const g = blds.get(id); if (!g) return;
  blds.delete(id);
  for (let k = anims.length - 1; k >= 0; k--) if (anims[k].owner === g) anims.splice(k, 1);
  for (let k = transitions.length - 1; k >= 0; k--) if (transitions[k].g === g) transitions.splice(k, 1);
  if (shrink) transitions.push({ g, t: 0, kind: 'shrink' }); else scene.remove(g);
}
function addBridge(s, grow) {
  const g = makeBridge(T, s);
  scene.add(g); bridges.set(s, g);
  g.updateMatrixWorld(true);
  const lamps = g.userData.lampsLocal.map((v) => g.localToWorld(v.clone()));
  if (life) life.addLampPools(lamps);
  if (grow) { g.scale.set(1, 0.01, 1); transitions.push({ g, t: 0, kind: 'grow', slow: true }); burst(new THREE.Vector3(T.wx(s.r[0]), T.waterY(s.r[0], s.r[1]) + 0.2, T.wz(s.r[1])), 2); }
}

const timing = {};
function lap(name, t0) { timing[name] = Math.round(performance.now() - t0); return performance.now(); }
function generate() {
  let t0 = performance.now();
  T = genTerrain(seed); t0 = lap('terrain', t0);
  town = genTown(T, seed); t0 = lap('town', t0);
  const isTown = (i, j) => T.inb(i, j) && (town.dPl(i, j) < 8.5 || town.use[i][j] === U.ROAD);
  terr = buildTerrain(T, isTown); t0 = lap('terrainMesh', t0);
  scene.add(terr.group);
  const tm = buildTownMeshes(T, town); t0 = lap('townMesh', t0);
  scene.add(tm.group);
  life = createLife(T, town, scene, { boats: tm.boats, falls: terr.falls, lamps: tm.lamps }); t0 = lap('life', t0);
  for (const b of town.buildings) if (!b.dead) addBuildingGroup(b);
  t0 = lap('buildings', t0);
  for (const s of town.sites) if (s.active) addBridge(s, false);
  // 廣場：噴泉＋市集攤位
  const [pi, pj] = town.plaza, px = T.wx(pi), pz = T.wz(pj), py = T.lev[pi][pj] * LH + 0.04;
  const fg = assemble('fountain', 0, seed, null); fg.position.set(px, py, pz); scene.add(fg);
  fg.userData.service = 'market';
  const sr = makeRng(seed + 3);
  for (const [dx, dz] of [[-0.95, -0.95], [0.95, -0.95], [-0.95, 0.95], [0.95, 0.95]]) {
    if (sr() < 0.2) continue;
    const g = assemble('stall', 0, (sr() * 1e9) | 0, null);
    g.position.set(px + dx, py, pz + dz); g.rotation.y = Math.atan2(-dx, -dz);
    g.userData.service = 'market';
    scene.add(g);
    plazaGroups.push(g);
  }
  plazaGroups.push(fg);
  cam.target.set(px, py, pz);
  cam.ty = py;
  document.getElementById('seed').textContent = `地圖 #${seed}`;
}
const plazaGroups = [];

// ---------------------------------------------------------------- 升級、合併、蓋房子、搭橋
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600); }

function swap(oldBs, type, tier, cells, f) {
  for (const b of oldBs) { removeBuildingGroup(b.id); town.unplace(b); }
  const nb = town.place(type, tier, cells, f);
  addBuildingGroup(nb, true, 0.2);
  checkBridges();
  return nb;
}
function upgrade(b) {
  const [i, j] = b.cells[0];
  if (b.tier < 5) { swap([b], 'house', b.tier + 1, b.cells, b.f); toast(`升級：${b.tier + 1} 級・${TIER_NAME[b.tier + 1]}`); return; }
  if (b.tier === 5) {
    const lat = [b.f[1], b.f[0]];
    let partner = null, lower = null;
    for (const s of [1, -1]) {
      const o = town.houseAt(i + lat[0] * s, j + lat[1] * s);
      if (!o || o.f[0] !== b.f[0] || o.f[1] !== b.f[1] || o.y !== b.y) continue;
      if (o.tier === 5) { partner = o; break; } else lower = o;
    }
    if (partner) { swap([b, partner], 'house', 6, [b.cells[0], partner.cells[0]], b.f); toast('兩棟 5 級合併：雙併宅邸（6 級）'); }
    else if (lower) toast(`隔壁那棟也升到 5 級，兩棟就能合併成雙併宅邸`);
    else toast('左右沒有同排的房子可以合併');
    return;
  }
  if (b.tier === 6) {
    // 往後擴建：後面兩格要是 5 級以上的房子，或沒有東西的空地／後院
    const back = b.cells.map(([a, c]) => [a - b.f[0], c - b.f[1]]);
    const absorb = [];
    let ok = true;
    for (const [a, c] of back) {
      if (!T.inb(a, c) || T.kind[a][c] !== 0 || T.lev[a][c] * LH !== b.y) { ok = false; break; }
      const id = town.bld[a][c];
      if (id >= 0) { const h = town.buildings[id]; if (h.type !== 'house' || h.tier < 5 || h.cells.some(([x, y]) => !back.some(([p, q]) => p === x && q === y))) { ok = false; break; } absorb.push(h); }
      else if (town.use[a][c] !== U.EMPTY && !(town.yardMeshes && town.yardMeshes.has(a * 1000 + c))) { ok = false; break; }
    }
    if (ok) {
      for (const [a, c] of back) if (town.bld[a][c] < 0) life.clearCell(a, c);
      swap([b, ...new Set(absorb)], 'house', 7, [...b.cells, ...back], b.f);
      toast('往後擴建：莊園（7 級）');
    } else toast('後面兩格是空地、後院或 5 級以上的房子時，才能擴建成莊園');
    return;
  }
  if (b.tier === 7) { swap([b], 'house', 8, b.cells, b.f); toast('升級：8 級・宮邸'); return; }
  toast('已經是最高等級的宮邸了');
}
function buildAt(i, j) {
  const f = town.lotFacing(i, j);
  if (!f) { if (town.use[i]?.[j] === U.EMPTY && T.kind[i][j] === 0) toast('房子要蓋在路邊、和路同高的空地上'); return; }
  life.clearCell(i, j);
  const b = town.place('house', 1, [[i, j]], f);
  addBuildingGroup(b, true);
  toast('蓋了一間茅草小屋');
  checkBridges();
}
function checkBridges() {
  for (const s of town.sites) {
    if (s.active) continue;
    if (siteActive(T, town, s)) {
      s.active = true;
      addBridge(s, true);
      life.buildGraph();
      setTimeout(() => toast('兩岸都有人住了，自動搭起一座石橋！'), 700);
    }
  }
}
function showRing(type, x, y, z) {
  const info = SERVICE_INFO[type]; if (!info) return;
  toast(info.r ? `${info.name}：提供「${info.need}」，範圍 ${info.r} 格` : info.name);
  if (!info.r) return;
  const ring = new THREE.Mesh(new THREE.RingGeometry(info.r - 0.08, info.r, 64).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(info.r, 64).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false }));
  for (const m of [ring, disc]) { m.position.set(x, y + 0.6, z); m.renderOrder = 5; scene.add(m); }
  transitions.push({ ring, disc, t: 0, kind: 'ring' });
}
const sparkGeo = new THREE.OctahedronGeometry(0.035, 0);
function burst(at, size = 1) {
  for (let k = 0; k < 18 + size * 8; k++) {
    const m = new THREE.Mesh(sparkGeo, new THREE.MeshStandardMaterial({ color: 0xfff1b8, emissive: 0xffd36b, emissiveIntensity: 3, transparent: true, depthWrite: false }));
    const a = Math.random() * TAU, sp = 0.5 + Math.random() * 1.1;
    m.position.copy(at).add(new THREE.Vector3((Math.random() - 0.5) * size * 0.5, 0.3, (Math.random() - 0.5) * size * 0.5));
    m.userData = { v: new THREE.Vector3(Math.cos(a) * sp * 0.5, 1.3 + Math.random() * 1.3, Math.sin(a) * sp * 0.5), life: 0, max: 0.9 + Math.random() * 0.6 };
    scene.add(m); sparks.push(m);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4 * Math.sqrt(size), 0.025, 6, 40).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, depthWrite: false }));
  ring.position.copy(at).setY(at.y + 0.06); ring.userData = { ring: true, life: 0, max: 0.7 };
  scene.add(ring); sparks.push(ring);
}
function stepTransitions(dt) {
  for (let k = transitions.length - 1; k >= 0; k--) {
    const tr = transitions[k]; tr.t += dt;
    if (tr.kind === 'shrink') {
      const u = clamp(tr.t / 0.2, 0, 1);
      tr.g.scale.set(1 + 0.1 * u, 1 - 0.95 * easeInCubic(u), 1 + 0.1 * u);
      if (u >= 1) { scene.remove(tr.g); transitions.splice(k, 1); }
    } else if (tr.kind === 'grow') {
      if (tr.at && tr.t >= 0) { burst(tr.at, tr.size); tr.at = null; }
      const dur = tr.slow ? 1.0 : 0.7, u = clamp(tr.t / dur, 0, 1);
      const wob = Math.sin(u * PI * 3) * (1 - u) * 0.07;
      tr.g.scale.set(1 - wob, Math.max(0.01, easeOutBack(u)), 1 - wob);
      if (u >= 1) { tr.g.scale.set(1, 1, 1); transitions.splice(k, 1); }
    } else if (tr.kind === 'ring') {
      const u = clamp(tr.t / 2.6, 0, 1);
      const a = Math.sin(Math.min(1, u * 4) * PI / 2) * (1 - smooth(0.6, 1, u));
      tr.ring.material.opacity = a * 0.9; tr.disc.material.opacity = a * 0.16;
      const s = 0.85 + 0.15 * easeOutBack(Math.min(1, u * 3));
      tr.ring.scale.setScalar(s); tr.disc.scale.setScalar(s);
      if (u >= 1) { scene.remove(tr.ring, tr.disc); transitions.splice(k, 1); }
    }
  }
  for (let k = sparks.length - 1; k >= 0; k--) {
    const m = sparks[k], u = m.userData; u.life += dt;
    const t = u.life / u.max;
    if (t >= 1) { scene.remove(m); if (m.geometry !== sparkGeo) m.geometry.dispose(); m.material.dispose(); sparks.splice(k, 1); continue; }
    if (u.ring) { m.scale.setScalar(1 + t * 1.6); m.material.opacity = (1 - t) * 0.8; continue; }
    u.v.y -= dt * 2.2; m.position.addScaledVector(u.v, dt); m.rotation.x += dt * 6; m.rotation.y += dt * 4;
    m.material.opacity = 1 - t;
  }
}

// ---------------------------------------------------------------- 鏡頭
const cam = { yaw: 0.72, pitch: 0.62, size: 4.4, target: new THREE.Vector3(), ty: 0, vx: 0, vz: 0 };
let W = 1, H = 1, dpr = Math.min(window.devicePixelRatio || 1, 2);
function frustum() { const a = W / H; return [cam.size * Math.max(1, a), cam.size * Math.max(1, 1 / a)]; }
function updateCamera() {
  const [hw, hh] = frustum();
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
  const d = 60;
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * d, cam.target.y + Math.sin(cam.pitch) * d, cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * d);
  camera.lookAt(cam.target);
  const ext = Math.max(hw, hh) * 1.25 + 2;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 120 });
  sun.shadow.camera.updateProjectionMatrix();
  post.params.focus = 0.5;
  post.params.band = clamp(0.5 * 3.2 / (2 * hh), 0.05, 0.16);
  post.params.feather = 0.22 + post.params.band;
}
function resize() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(dpr); renderer.setSize(W, H, false);
  post.setSize(Math.round(W * dpr), Math.round(H * dpr));
  updateCamera();
}
function pan(dx, dy) {
  const [hw] = frustum(), k = (2 * hw) / W;
  const rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw), fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw);
  const mx = -rx * dx * k + fx * dy * k / Math.sin(cam.pitch), mz = -rz * dx * k + fz * dy * k / Math.sin(cam.pitch);
  cam.target.x += mx; cam.target.z += mz;
  const lim = T ? T.N / 2 + 1 : 14;
  cam.target.x = clamp(cam.target.x, -lim, lim); cam.target.z = clamp(cam.target.z, -lim, lim);
  return [mx, mz];
}
const pointers = new Map();
let gesture = null, lastInteract = 0, mouseRotate = false;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  mouseRotate = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey);
  if (pointers.size === 2) { const [a, b] = [...pointers.values()]; gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), size: cam.size, yaw: cam.yaw, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  lastInteract = performance.now(); cam.vx = cam.vz = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (mouseRotate) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.003, 0.42, 1.0); }
    else { const [mx, mz] = pan(dx, dy); cam.vx = mx; cam.vz = mz; }
  } else if (pointers.size === 2 && gesture) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    cam.size = clamp(gesture.size * gesture.dist / Math.max(20, dist), 1.6, 9);
    cam.yaw = gesture.yaw - (ang - gesture.ang);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    pan(mx - gesture.mx, my - gesture.my); gesture.mx = mx; gesture.my = my;
  }
  lastInteract = performance.now();
  updateCamera();
});
function endPointer(e) {
  const p = pointers.get(e.pointerId); if (!p) return;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) gesture = null;
  if (pointers.size === 1) { const q = [...pointers.values()][0]; q.x0 = q.x; q.y0 = q.y; }
  const moved = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
  if (moved < 8 && performance.now() - p.t0 < 400 && pointers.size === 0) tap(e.clientX, e.clientY);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.size = clamp(cam.size * Math.exp(e.deltaY * 0.0012), 1.6, 9); updateCamera(); lastInteract = performance.now(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
const raycaster = new THREE.Raycaster();
function tap(x, y) {
  if (!T) return;
  hideHint();
  raycaster.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
  const targets = [...blds.values(), ...plazaGroups, terr.group.getObjectByName('ground')];
  const hits = raycaster.intersectObjects(targets, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && o.userData.bid === undefined && o.userData.service === undefined && o.name !== 'ground') o = o.parent;
  if (!o) return;
  if (o.userData.service) { showRing(o.userData.service, o.position.x, o.position.y, o.position.z); return; }
  if (o.userData.bid !== undefined) {
    const b = town.buildings[o.userData.bid];
    if (!b || b.dead) return;
    if (b.type === 'house') upgrade(b); else showRing(b.type, b.x, b.y, b.z);
    return;
  }
  const p = hits[0].point;
  buildAt(T.ci(p.x), T.ci(p.z));
}

// ---------------------------------------------------------------- 介面
const ui = { play: document.getElementById('play'), tod: document.getElementById('tod'), lbl: document.getElementById('lbl'), dof: document.getElementById('dof'), hint: document.getElementById('hint'), fps: document.getElementById('fps') };
let playing = true;
const DAY_SECONDS = 90;
ui.play.addEventListener('click', () => {
  playing = !playing; ui.play.classList.toggle('on', playing);
  document.getElementById('ic-pause').style.display = playing ? '' : 'none';
  document.getElementById('ic-play').style.display = playing ? 'none' : '';
});
ui.tod.addEventListener('input', () => { tod = ui.tod.value / 1000; });
ui.dof.addEventListener('click', () => { post.params.dof = post.params.dof ? 0 : 1; ui.dof.classList.toggle('on', !!post.params.dof); });
document.getElementById('newmap').addEventListener('click', () => {
  const n = 10000 + Math.floor(Math.random() * 89999);
  location.replace(`?seed=${n}&t=${tod.toFixed(3)}${qs.has('fps') ? '&fps' : ''}`);
});
let hintTimer = setTimeout(hideHint, 9000);
function hideHint() { ui.hint.classList.add('hide'); clearTimeout(hintTimer); }
function timeLabel(t) {
  const h = t * 24, hh = Math.floor(h), mm = Math.floor((h - hh) * 6) * 10;
  const name = h < 4.5 ? '深夜' : h < 6.5 ? '破曉' : h < 10 ? '清晨' : h < 13.5 ? '正午' : h < 16.5 ? '午後' : h < 18.8 ? '黃昏' : h < 21 ? '入夜' : '夜晚';
  return `${name}　${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
if (qs.has('fps')) ui.fps.style.display = 'block';

// ---------------------------------------------------------------- 主迴圈
const clock = new THREE.Timer();
const themeMeta = document.querySelector('meta[name=theme-color]');
let acc = 0, frames = 0, slow = 0;
function applyDay(t) {
  const d = sampleDay(t);
  skyU.uTop.value.copy(d.top); skyU.uHor.value.copy(d.hor);
  skyU.uStars.value = smooth(0.3, 1, d.glow) * (1 - smooth(0.2, 0.3, t) * smooth(0.82, 0.72, t));
  FX.uFadeColor.value.copy(d.hor);
  FX.uCloud.value = (1 - d.glow) * 0.22;
  sun.color.copy(d.sun); sun.intensity = d.si;
  hemi.color.copy(d.hs); hemi.groundColor.copy(d.hg); hemi.intensity = d.hi;
  const e = Math.sin((t - 0.25) * TAU), elev = 0.42 + 0.48 * Math.abs(e), az = t * TAU + 0.6;
  sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
  sun.target.position.copy(cam.target);
  sun.position.copy(cam.target).addScaledVector(sunDir, 50);
  M.win.emissiveIntensity = d.glow * 6;
  M.crystal.emissiveIntensity = 1 + d.glow * 2.4;
  M.fire.emissiveIntensity = 2.2 + Math.sin(uTime.value * 13) * 0.4;
  M.cloud.color.copy(d.cl);
  if (terr) {
    const day = 1 - d.glow;
    terr.matRiver.emissiveIntensity = 0.1 + 0.26 * day;
    terr.matFoam.opacity = (0.35 + 0.25 * Math.sin(uTime.value * 1.6)) * (0.4 + 0.6 * day);
  }
  return d;
}
function frame() {
  clock.update();
  const dt = Math.min(clock.getDelta(), 0.05);
  uTime.value += dt;
  const T0 = uTime.value;
  if (playing) { tod = (tod + dt / DAY_SECONDS) % 1; ui.tod.value = Math.round(tod * 1000); }
  ui.lbl.textContent = timeLabel(tod);
  if (!pointers.size) {
    if (Math.abs(cam.vx) + Math.abs(cam.vz) > 1e-4) { cam.target.x += cam.vx; cam.target.z += cam.vz; cam.vx *= 0.9; cam.vz *= 0.9; }
    if (performance.now() - lastInteract > 12000) cam.yaw += dt * 0.025;
  }
  if (T) { // 鏡頭焦點跟著地面高度
    const i = T.ci(cam.target.x), j = T.ci(cam.target.z);
    const gy = T.inb(i, j) ? Math.max(0, T.lev[i][j]) * LH : 0;
    cam.target.y = lerp(cam.target.y, gy, Math.min(1, dt * 4));
  }
  updateCamera();
  const d = applyDay(tod);
  if (terr) {
    terr.texRiver.offset.y -= dt * 0.42;
    for (const a of anims) {
      if (a.spinZ) a.obj.rotation.z -= dt * a.spinZ;
      if (a.rot) { a.obj.rotation.y += dt * a.rot; if (a.y0 !== undefined) a.obj.position.y = a.y0 + Math.sin(T0 * 1.6) * a.bob; }
      if (a.flag) a.obj.rotation.y = Math.sin(T0 * 2.4 + a.ph) * 0.35;
      if (a.orbit) a.obj.rotation.y += dt * a.orbit;
      if (a.beam) a.beam.material.opacity = d.glow * 0.18;
    }
    const chim = [];
    for (const b of town.buildings) if (!b.dead && b.chim) for (const c of b.chim) chim.push(c);
    life.update(dt, T0, d, chim);
    stepTransitions(dt);
  }
  post.render(scene, camera);
  acc += dt; frames++;
  if (acc >= 1.5) {
    const fps = frames / acc;
    ui.fps.textContent = `${fps.toFixed(0)} fps · dpr ${dpr.toFixed(2)} · ${renderer.info.render.triangles} tri`;
    themeMeta.content = '#' + d.top.getHexString(THREE.SRGBColorSpace);
    if (fps < 42 && dpr > 1.01) { if (++slow >= 2) { dpr = Math.max(1, dpr - 0.25); resize(); slow = 0; } } else slow = 0;
    acc = 0; frames = 0;
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', resize);
resize();
applyDay(tod);
setTimeout(() => {
  try { generate(); } catch (err) { console.error(err); loading.textContent = '生成失敗：' + err.message; return; }
  loading.classList.add('hide');
  requestAnimationFrame(frame);
}, 60);

window.__town = { timing, camera, get T() { return T; }, get town() { return town; }, cam, post: post.params, updateCamera, setTime: (t) => { tod = t; }, pause: () => { playing = false; }, upgrade, buildAt, renderer, scene };
