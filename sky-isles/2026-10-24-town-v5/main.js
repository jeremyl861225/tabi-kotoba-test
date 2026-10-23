// 小鎮 · 風格試作 v3：有機網格（三角／四邊／五邊形）、自己鋪路、自然河流
import * as THREE from 'three';
import { makeRng, clamp, lerp, smooth, C, PI, TAU, easeOutBack, easeInCubic } from './util.js';
import { M, FX, uTime } from './kit.js';
import { makeGrid } from './grid.js';
import { makeLand, buildLand, setWaterSky } from './land.js';
import { classify, genTown, buildRoadCell, makeBridge, makePlinth, buildScenery, siteActive, pointInCell, U, KD } from './town.js';
import { makeSimWarp } from './warp.js';
import { assemble, SERVICE_INFO } from './buildings.js';
import { buildHouse as makeHouseGroup, TIER_NAME } from './house.js';
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
post.params.dof = 0; // 使用者 10-24：不要景深
FX.uFadeStart.value = 18; FX.uFadeEnd.value = 31;

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
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
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
let G, L, town, land, life;
const anims = [], blds = new Map(), roadMeshes = new Map(), sparks = [], transitions = [], plazaGroups = [];
const loading = document.getElementById('loading');
const texGlow = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(cv); })();
function addPools(grp, lamps) {
  if (!lamps.length || !life) return;
  for (const p of lamps) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1).rotateX(-PI / 2), life.pools.warm); m.position.set(p.x, p.y - 0.4, p.z); m.renderOrder = 3; grp.add(m); }
}

// 外牆邊：不屬於同一棟的邊；記下是否臨街、鄰棟有多高（被擋住的樓層就不開窗）
function outerEdges(b) {
  const set = new Set(b.cells), out = [];
  b.cells.forEach((id, i) => {
    for (const e of G.cells[id].edges) {
      if (e.nb >= 0 && set.has(e.nb)) continue;
      const o = e.nb >= 0 ? G.cells[e.nb] : null;
      const ob = o && town.bld[o.id] >= 0 ? town.buildings[town.bld[o.id]] : null;
      out.push({ a: [G.X[e.a], G.Z[e.a]], b: [G.X[e.b], G.Z[e.b]], street: !!(o && town.roadish(o)), nbH: ob && ob.top ? ob.top : 0, cell: i });
    }
  });
  return out;
}
function addBuildingGroup(b, grow = false, delay = 0) {
  let g;
  if (b.generic) {
    g = makeHouseGroup({ polys: b.cells.map((id) => G.cells[id].v.map((v) => [G.X[v], G.Z[v]])), outer: outerEdges(b), anchor: [b.x, b.z], baseY: b.y, hmin: b.hmin, tier: b.tier, seed: b.seed, kind: b.type });
    b.top = b.y + g.userData.H;
    addPools(g, g.userData.kit.lamps);
  } else {
    g = assemble(b.type, 0, b.seed, life.pools, b.W);
    const pl = makePlinth(town, b); if (pl) g.add(pl);
  }
  g.position.set(b.x, b.y, b.z);
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
function refreshRoad(c) {
  const old = roadMeshes.get(c.id);
  if (old) { scene.remove(old); old.traverse((o) => o.geometry && o.geometry.dispose()); roadMeshes.delete(c.id); }
  const u = town.use[c.id];
  if (u !== U.ROAD && u !== U.PLAZA) return;
  const g = buildRoadCell(town, c);
  addPools(g, g.userData.lamps);
  scene.add(g); roadMeshes.set(c.id, g);
}
function addBridge(s, grow) {
  const g = makeBridge(town, s);
  addPools(g, g.userData.lamps);
  scene.add(g); s.bridge = g;
  for (const id of s.water) { const old = roadMeshes.get(id); if (old) { scene.remove(old); roadMeshes.delete(id); } }
  if (grow) {
    const A = G.cells[s.a], B = G.cells[s.b];
    g.scale.set(1, 0.01, 1); transitions.push({ g, t: 0, kind: 'grow', slow: true });
    burst(new THREE.Vector3((A.x + B.x) / 2, Math.max(A.y, B.y) + 0.2, (A.z + B.z) / 2), 2);
  }
}

function generate() {
  G = makeGrid(seed);
  L = makeLand(seed);
  classify(G, L);
  town = genTown(G, L, seed);
  const pc = town.pc;
  land = buildLand(L, (x, z) => Math.hypot(x - pc.x, z - pc.z) < 10);
  scene.add(land.group);
  const scenery = buildScenery(town);
  scene.add(scenery.group);
  life = createLife(town, scene, { boats: scenery.boats });
  for (const c of G.cells) refreshRoad(c);
  for (const s of town.sites) if (s.active) addBridge(s, false);
  // 開局等級改用遊戲規則重算；少數房子先低一級，開場就能看到它們長大
  const gr = makeRng(seed + 11);
  for (const b of town.buildings) if (!b.dead && b.type === 'house' && b.cells.length === 1) { const t = targetTier(b); b.tier = gr() < 0.2 ? Math.max(1, t - 1) : t; }
  for (const b of town.buildings) if (!b.dead) addBuildingGroup(b);
  // 廣場：噴泉＋市集攤位
  const fg = assemble('fountain', 0, seed, null, makeSimWarp(pc.x, pc.z, 0, pc.rin * 1.6));
  fg.position.set(pc.x, L.h(pc.x, pc.z) + 0.04, pc.z); fg.userData.service = 'market';
  scene.add(fg); plazaGroups.push(fg);
  const sr = makeRng(seed + 3);
  for (const c of town.plaza.slice(1)) {
    if (sr() < 0.45) continue;
    const yaw = Math.atan2(pc.x - c.x, pc.z - c.z);
    const g = assemble('stall', 0, (sr() * 1e9) | 0, null, makeSimWarp(c.x, c.z, yaw, c.rin * 1.5));
    g.position.set(c.x, L.h(c.x, c.z) + 0.04, c.z); g.userData.service = 'market';
    scene.add(g); plazaGroups.push(g);
  }
  life.buildGraph();
  cam.target.set(pc.x, pc.y, pc.z);
  updateHud();
  document.getElementById('seed').textContent = `地圖 #${seed}`;
}

// ---------------------------------------------------------------- 玩法：金錢、建造、需求
const toastEl = document.getElementById('toast');
let toastTimer = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600); }

// 一句話規則：每滿足一種需求，房子自動升一級（最高 5 級）；相鄰的 5 級房子可以合併
const NEEDS = [
  { k: 'water', name: '水', color: '#4aa8e8', fix: '附近蓋水井' },
  { k: 'food', name: '食物', color: '#f0a63a', fix: '附近蓋麵包坊（廣場市集也算）' },
  { k: 'health', name: '醫療', color: '#4fbf86', fix: '附近蓋藥坊' },
  { k: 'faith', name: '信仰', color: '#b58ae0', fix: '附近蓋教堂或酒館' },
];
const SERV = {
  well: { name: '水井', cost: 80, need: 'water', r: 3.6 },
  bakery: { name: '麵包坊', cost: 150, need: 'food', r: 4.6 },
  apothecary: { name: '藥坊', cost: 200, need: 'health', r: 5.2 },
  tavern: { name: '酒館', cost: 180, need: 'faith', r: 4.2 },
  church: { name: '教堂', cost: 500, need: 'faith', r: 7 },
  garden: { name: '花園', cost: 60, need: 'beauty', r: 3.2 },
};
const MARKET_R = 5;
const COST = { road: 5, boardwalk: 15, house: 30 };
const MERGE_COST = { 2: 200, 3: 350, 4: 600 };
const TAX = [0, 1, 2, 3, 5, 8, 15, 22, 35];   // 每分鐘
const POP = [0, 2, 4, 7, 10, 14, 30, 45, 70];
const game = { coins: 400, mode: 'look', item: 'house', need: 'water', taxT: 0, evoT: 0, sel: null };

function covered(k, x, z) {
  if (k === 'food' && Math.hypot(x - town.pc.x, z - town.pc.z) < MARKET_R) return true;
  for (const b of town.buildings) { if (b.dead) continue; const s = SERV[b.type]; if (s && s.need === k && Math.hypot(b.x - x, b.z - z) < s.r) return true; }
  return false;
}
const needsOf = (b) => NEEDS.map((n) => covered(n.k, b.x, b.z));
const targetTier = (b) => 1 + needsOf(b).filter(Boolean).length;
const houses = () => town.buildings.filter((b) => !b.dead && b.type === 'house');
function stats() {
  let pop = 0, tax = 0; for (const b of houses()) { pop += POP[b.tier]; tax += TAX[b.tier]; }
  return { pop, tax };
}
function spend(n, what) {
  if (game.coins < n) { toast(`金幣不夠：${what}要 ${n}，現在只有 ${Math.floor(game.coins)}`); return false; }
  game.coins -= n; updateHud(); return true;
}
function updateHud() {
  const s = stats();
  document.getElementById('coins').textContent = Math.floor(game.coins).toLocaleString();
  document.getElementById('pop').textContent = s.pop.toLocaleString();
  document.getElementById('income').textContent = `+${s.tax}`;
  for (const el of document.querySelectorAll('[data-item]')) el.classList.toggle('poor', game.coins < (SERV[el.dataset.item]?.cost ?? COST[el.dataset.item] ?? 0));
}

// 飄字（+金幣、升級）
const floats = [];
function floatText(text, x, y, z, cls = '') {
  const el = document.createElement('div'); el.className = 'float ' + cls; el.textContent = text;
  document.getElementById('floats').appendChild(el);
  floats.push({ el, p: new THREE.Vector3(x, y, z), t: 0 });
}
function stepFloats(dt) {
  const v = new THREE.Vector3();
  for (let k = floats.length - 1; k >= 0; k--) {
    const f = floats[k]; f.t += dt;
    if (f.t > 1.6) { f.el.remove(); floats.splice(k, 1); continue; }
    v.copy(f.p); v.y += f.t * 0.35; v.project(camera);
    f.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * W}px, ${(-v.y * 0.5 + 0.5) * H}px) translate(-50%, -50%)`;
    f.el.style.opacity = String(Math.min(1, (1.6 - f.t) * 2));
  }
}

function swap(oldBs, type, tier, cellIds) {
  for (const b of oldBs) { removeBuildingGroup(b.id); town.unplace(b); }
  const nb = town.place(type, tier, cellIds);
  addBuildingGroup(nb, true, 0.2);
  checkBridges();
  return nb;
}
// 房子慢慢朝「需求滿足數」對應的等級長（一次一級），需求不見了也會慢慢降
function evolve() {
  const todo = houses().filter((b) => b.cells.length === 1 && targetTier(b) !== b.tier);
  for (let k = 0; k < 2 && todo.length; k++) {
    const b = todo.splice(Math.floor(Math.random() * todo.length), 1)[0];
    const up = targetTier(b) > b.tier;
    const nb = swap([b], 'house', b.tier + (up ? 1 : -1), b.cells);
    floatText(up ? `升級 ${TIER_NAME[nb.tier]}` : `降級 ${TIER_NAME[nb.tier]}`, nb.x, nb.y + 0.9, nb.z, up ? 'up' : 'down');
    if (game.sel === b) showInfo(nb);
  }
}
function collectTax() {
  let total = 0;
  const list = houses();
  for (const b of list) total += TAX[b.tier] / 4;
  game.coins += total;
  const show = list.sort(() => Math.random() - 0.5).slice(0, 10);
  for (const b of show) floatText(`+${Math.round(TAX[b.tier] / 4)}`, b.x, b.y + 0.7, b.z, 'coin');
  updateHud();
}
function mergeHouse(b) {
  const ts = town.mergeTargets(b);
  if (!ts.length) { toast('旁邊要有另一棟 5 級房子才能合併'); return; }
  const o = ts.sort((x, y) => y.cells.length - x.cells.length)[0];
  const n = b.cells.length + o.cells.length;
  if (!spend(MERGE_COST[n], `合併成${TIER_NAME[4 + n]}`)) return;
  const nb = swap([b, o], 'house', 4 + n, [...b.cells, ...o.cells]);
  toast(`合併成${TIER_NAME[4 + n]}（${n} 格）`);
  showInfo(nb);
}
// 建造
function canBuildOn(c, needRoad = true) {
  if (c.kind === KD.RIVER || c.kind === KD.SEA) { toast('水上不能蓋'); return false; }
  if (c.kind === KD.STEEP) { toast('這格太陡了'); return false; }
  if (town.use[c.id] !== U.EMPTY && town.use[c.id] !== U.YARD) { toast('這格已經有東西了'); return false; }
  if (needRoad) {
    const was = town.use[c.id]; town.use[c.id] = U.EMPTY;
    const k = town.lotFront(c); town.use[c.id] = was;
    if (k < 0) { toast('要蓋在路邊；先用「道路」把路接過來'); return false; }
  }
  return true;
}
function build(item, c) {
  if (item === 'road') { paintRoad(c, false); return; }
  if (item === 'house') { buildHouse(c); return; }
  const s = SERV[item];
  if (!canBuildOn(c, item !== 'garden')) return;
  if (!spend(s.cost, s.name)) return;
  life.clearCell(c.id);
  const generic = item === 'church' || item === 'tavern' || item === 'apothecary' || item === 'bakery';
  const b = town.place(item, generic ? (item === 'church' ? 5 : 3) : 0, [c]);
  addBuildingGroup(b, true);
  showRing(item, b.x, b.y, b.z);
  if (game.mode === 'needs') refreshOverlay();
}
function buildHouse(c) {
  if (!canBuildOn(c)) return;
  if (!spend(COST.house, '小屋')) return;
  life.clearCell(c.id);
  const b = town.place('house', 1, [c]);
  addBuildingGroup(b, true);
  toast('蓋了一間小屋，滿足越多需求它會自己升級');
  checkBridges(); updateHud();
}
function paintRoad(c, quiet) {
  const u = town.use[c.id];
  if (u === U.ROAD || u === U.PLAZA || u === U.SITE) return false;
  if (c.kind === KD.SEA || c.kind === KD.STEEP) { if (!quiet) toast(c.kind === KD.SEA ? '海上不能鋪路' : '這格太陡了'); return false; }
  if (u === U.BUILD || u === U.FIELD) { if (!quiet) toast('這格已經有東西了'); return false; }
  if (c.kind === KD.RIVER && !c.nb.some((n) => town.roadish(G.cells[n]))) { if (!quiet) toast('棧道要從岸邊的路接出去'); return false; }
  const price = c.kind === KD.RIVER ? COST.boardwalk : COST.road;
  if (game.coins < price) { if (!quiet || !game.warned) toast(`金幣不夠：道路每格 ${price}`); game.warned = true; return false; }
  game.coins -= price; updateHud();
  if (u === U.YARD) life.clearCell(c.id);
  life.clearCell(c.id);
  town.use[c.id] = U.ROAD; town.gen[c.id] = 3;
  refreshRoad(c); for (const n of c.nb) refreshRoad(G.cells[n]);
  if (c.kind === KD.RIVER) linkBoardwalk(c);
  else { const w = c.nb.map((n) => G.cells[n]).find((o) => o.kind === KD.RIVER && town.use[o.id] === U.ROAD); if (w) linkBoardwalk(w); }
  life.buildGraph();
  return true;
}
// 水上的棧道一旦把兩岸的路接通，就改成石拱橋
function linkBoardwalk(c) {
  const comp = [], seen = new Set([c.id]), q = [c];
  while (q.length) { const x = q.pop(); comp.push(x); for (const n of x.nb) { const o = G.cells[n]; if (!seen.has(o.id) && o.kind === KD.RIVER && town.use[o.id] === U.ROAD) { seen.add(o.id); q.push(o); } } }
  const banks = [];
  for (const x of comp) for (const n of x.nb) { const o = G.cells[n]; if (o.kind !== KD.RIVER && town.roadish(o) && !banks.includes(o)) banks.push(o); }
  let best = null, bd = 0;
  for (let i = 0; i < banks.length; i++) for (let j = i + 1; j < banks.length; j++) {
    const A = banks[i], B = banks[j], d = Math.hypot(A.x - B.x, A.z - B.z);
    let wet = false; for (let t = 0.2; t <= 0.8; t += 0.1) { const R = L.riverAt(lerp(A.x, B.x, t), lerp(A.z, B.z, t), 3); if (R && R.d < R.w * 0.8) wet = true; }
    if (wet && d > bd) { bd = d; best = [A, B]; }
  }
  if (!best) return;
  const s = { a: best[0].id, b: best[1].id, water: comp.map((x) => x.id), active: true, user: true };
  for (const x of comp) town.use[x.id] = U.SITE;
  town.sites.push(s);
  addBridge(s, true);
  setTimeout(() => toast('兩岸接通了，棧道改建成石拱橋！'), 500);
}
function erase(c) {
  const id = town.bld[c.id];
  if (id >= 0) {
    const b = town.buildings[id];
    removeBuildingGroup(b.id); town.unplace(b);
    toast(`拆掉了${b.type === 'house' ? TIER_NAME[b.tier] : SERV[b.type]?.name || SERVICE_INFO[b.type]?.name || '建築'}`);
    updateHud(); if (game.mode === 'needs') refreshOverlay();
    return;
  }
  const u = town.use[c.id];
  if (u === U.ROAD) {
    for (const s of town.sites) if (s.active && (s.a === c.id || s.b === c.id)) { s.active = false; if (s.bridge) { scene.remove(s.bridge); s.bridge = null; } if (s.user) for (const w of s.water) town.use[w] = U.EMPTY; }
    town.use[c.id] = U.EMPTY;
    refreshRoad(c); for (const n of c.nb) refreshRoad(G.cells[n]);
    life.buildGraph();
    toast('拆掉了一段路');
    return;
  }
  if (u === U.PLAZA) toast('廣場不能拆');
}
function checkBridges() {
  for (const s of town.sites) {
    if (s.active) continue;
    if (siteActive(town, s)) {
      s.active = true;
      addBridge(s, true);
      life.buildGraph();
      setTimeout(() => toast('兩岸都有人住了，自動搭起一座石橋！'), 700);
    }
  }
}
function showRing(type, x, y, z) {
  const s = type === 'market' ? { name: '市集', need: 'food', r: MARKET_R } : SERV[type];
  if (!s) { const info = SERVICE_INFO[type]; if (info) toast(info.name); return; }
  const nd = NEEDS.find((n) => n.k === s.need);
  const served = houses().filter((b) => Math.hypot(b.x - x, b.z - z) < s.r).length;
  toast(nd ? `${s.name}：供應「${nd.name}」給範圍內 ${served} 戶` : `${s.name}：讓附近更漂亮`);
  const rr = s.r;
  const ring = new THREE.Mesh(new THREE.RingGeometry(rr - 0.08, rr, 64).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(rr, 64).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3c4, transparent: true, opacity: 0, depthWrite: false }));
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
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.45 * Math.sqrt(size), 0.025, 6, 40).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0xfff3d0, transparent: true, depthWrite: false }));
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

// ---------------------------------------------------------------- 鏡頭與手勢
const cam = { yaw: 0.72, pitch: 0.62, size: 4.6, target: new THREE.Vector3(), vx: 0, vz: 0 };
let W = 1, H = 1, dpr = Math.min(window.devicePixelRatio || 1, 2);
function frustum() { const a = W / H; return [cam.size * Math.max(1, a), cam.size * Math.max(1, 1 / a)]; }
function updateCamera() {
  const [hw, hh] = frustum();
  Object.assign(camera, { left: -hw, right: hw, top: hh, bottom: -hh });
  camera.updateProjectionMatrix();
  const d = 60;
  camera.position.set(cam.target.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * d, cam.target.y + Math.sin(cam.pitch) * d, cam.target.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * d);
  camera.lookAt(cam.target);
  camera.updateMatrixWorld();
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
  const lim = 16, d = Math.hypot(cam.target.x, cam.target.z);
  if (d > lim) { cam.target.x *= lim / d; cam.target.z *= lim / d; }
  return [mx, mz];
}
const raycaster = new THREE.Raycaster();
function cellAt(x, y) {
  raycaster.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
  const hits = raycaster.intersectObject(land.group.getObjectByName('ground'), false);
  if (!hits.length) return null;
  const p = hits[0].point;
  let best = null, bd = Infinity;
  for (const c of G.cells) { const d = (c.x - p.x) ** 2 + (c.z - p.z) ** 2; if (d < bd) { bd = d; best = c; } }
  if (!best) return null;
  if (pointInCell(G, best, p.x, p.z)) return best;
  for (const n of best.nb) if (pointInCell(G, G.cells[n], p.x, p.z)) return G.cells[n];
  return bd < 1 ? best : null;
}
const pointers = new Map();
let gesture = null, lastInteract = 0, mouseRotate = false, painting = false, lastPaint = -1, paintFrom = null;
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: performance.now() });
  mouseRotate = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey);
  painting = pointers.size === 1 && game.mode === 'build' && game.item === 'road' && !mouseRotate;
  game.warned = false;
  lastPaint = -1; paintFrom = null;
  if (pointers.size === 2) { painting = false; const [a, b] = [...pointers.values()]; gesture = { dist: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), size: cam.size, yaw: cam.yaw, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  lastInteract = performance.now(); cam.vx = cam.vz = 0;
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId); if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (pointers.size === 1) {
    if (painting) {
      if (Math.hypot(e.clientX - p.x0, e.clientY - p.y0) > 6) {
        const from = paintFrom || [p.x0, p.y0], n = Math.max(1, Math.ceil(Math.hypot(e.clientX - from[0], e.clientY - from[1]) / 10));
        for (let q = 1; q <= n; q++) {
          const c = cellAt(lerp(from[0], e.clientX, q / n), lerp(from[1], e.clientY, q / n));
          if (c && c.id !== lastPaint) { lastPaint = c.id; paintRoad(c, true); }
        }
        paintFrom = [e.clientX, e.clientY];
      }
    } else if (mouseRotate) { cam.yaw -= dx * 0.006; cam.pitch = clamp(cam.pitch + dy * 0.003, 0.42, 1.0); }
    else { const [mx, mz] = pan(dx, dy); cam.vx = mx; cam.vz = mz; }
  } else if (pointers.size === 2 && gesture) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y), ang = Math.atan2(b.y - a.y, b.x - a.x);
    cam.size = clamp(gesture.size * gesture.dist / Math.max(20, dist), 1.6, 10);
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
  if (moved < 8 && performance.now() - p.t0 < 450 && pointers.size === 0) tap(e.clientX, e.clientY);
  if (!pointers.size) painting = false;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.size = clamp(cam.size * Math.exp(e.deltaY * 0.0012), 1.6, 10); updateCamera(); lastInteract = performance.now(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
function tap(x, y) {
  if (!town) return;
  hideHint();
  if (game.mode === 'look' || game.mode === 'needs') {
    raycaster.setFromCamera(new THREE.Vector2(x / W * 2 - 1, -(y / H) * 2 + 1), camera);
    const hits = raycaster.intersectObjects([...blds.values(), ...plazaGroups], true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.userData.bid === undefined && o.userData.service === undefined) o = o.parent;
      if (o && o.userData.service) { showRing(o.userData.service, o.position.x, o.position.y, o.position.z); return; }
      if (o) { const b = town.buildings[o.userData.bid]; if (b && !b.dead) { if (b.type === 'house') showInfo(b); else { hideInfo(); showRing(b.type, b.x, b.y, b.z); } } return; }
    }
    hideInfo();
    return;
  }
  const c = cellAt(x, y); if (!c) return;
  if (game.mode === 'build') build(game.item, c);
  else if (game.mode === 'erase') erase(c);
}

// ---------------------------------------------------------------- 面板：房子資訊、建造選單、需求檢視
const panel = document.getElementById('info');
function showInfo(b) {
  game.sel = b;
  const ns = needsOf(b), big = b.cells.length > 1;
  let next = '';
  if (!big && b.tier < 5) {
    const miss = NEEDS.filter((n, i) => !ns[i]);
    next = miss.length ? `下一級還缺「${miss[0].name}」：${miss[0].fix}` : '需求都滿足了，很快就會升級';
  }
  let act = '';
  if (b.tier >= 5 && b.cells.length < 4) {
    const ts = town.mergeTargets(b);
    if (ts.length) { const n = b.cells.length + Math.max(...ts.map((o) => o.cells.length)); act = `<button class="act" id="mergeBtn">合併成${TIER_NAME[4 + n]}・${MERGE_COST[n]} 金</button>`; }
    else next = next || '旁邊再有一棟 5 級房子，就能合併成更大的宅邸';
  }
  if (b.cells.length >= 4) next = '已經是最大的宮殿了';
  panel.innerHTML = `<div class="ph"><div><b>${TIER_NAME[b.tier]}</b><span>${b.tier} 級・${POP[b.tier]} 人・稅收 ${TAX[b.tier]}／分</span></div><button class="x" id="infoX" aria-label="關閉">×</button></div>
    <div class="needs">${NEEDS.map((n, i) => `<div class="need ${ns[i] ? 'ok' : 'no'}"><i style="background:${n.color}"></i>${n.name}<em>${ns[i] ? '有' : '缺'}</em></div>`).join('')}</div>
    ${next ? `<div class="next">${next}</div>` : ''}${act}`;
  panel.classList.add('show');
  document.getElementById('infoX').onclick = hideInfo;
  const mb = document.getElementById('mergeBtn'); if (mb) mb.onclick = () => mergeHouse(b);
}
function hideInfo() { game.sel = null; panel.classList.remove('show'); }

function setMode(m) {
  game.mode = m;
  for (const el of document.querySelectorAll('[data-mode]')) el.classList.toggle('on', el.dataset.mode === m);
  document.getElementById('buildSheet').classList.toggle('show', m === 'build');
  document.getElementById('needSheet').classList.toggle('show', m === 'needs');
  hideInfo();
  if (m === 'needs') refreshOverlay(); else clearOverlay();
  if (m === 'erase') toast('點房子或路把它拆掉（不退費）');
}
for (const el of document.querySelectorAll('[data-mode]')) el.addEventListener('click', () => setMode(game.mode === el.dataset.mode && el.dataset.mode !== 'look' ? 'look' : el.dataset.mode));
for (const el of document.querySelectorAll('[data-item]')) el.addEventListener('click', () => {
  game.item = el.dataset.item;
  for (const o of document.querySelectorAll('[data-item]')) o.classList.toggle('on', o === el);
  toast(game.item === 'road' ? '點或拖曳鋪路；鋪過河先搭棧道，接通兩岸變石橋' : `點路邊空地蓋${SERV[game.item]?.name || '小屋'}`);
});
for (const el of document.querySelectorAll('[data-need]')) el.addEventListener('click', () => {
  game.need = el.dataset.need;
  for (const o of document.querySelectorAll('[data-need]')) o.classList.toggle('on', o === el);
  refreshOverlay();
});

// 需求檢視：有供應的格子塗底色，缺這項的房子頭上冒提示
let overlay = null;
const markers = [];
const markerTex = {};
function markerTexture(n) {
  if (markerTex[n.k]) return markerTex[n.k];
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(48, 48, 44, 0, TAU); g.fill();
  g.fillStyle = n.color; g.beginPath(); g.arc(48, 48, 37, 0, TAU); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 40px "PingFang TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(n.name[0], 48, 51);
  g.strokeStyle = '#d64541'; g.lineWidth = 7; g.beginPath(); g.moveTo(20, 76); g.lineTo(76, 20); g.stroke();
  return (markerTex[n.k] = new THREE.CanvasTexture(cv));
}
function clearOverlay() {
  if (overlay) { scene.remove(overlay); overlay.geometry.dispose(); overlay.material.dispose(); overlay = null; }
  for (const m of markers) { scene.remove(m); m.material.dispose(); }
  markers.length = 0;
}
function refreshOverlay() {
  clearOverlay();
  const nd = NEEDS.find((n) => n.k === game.need);
  const pos = [], h = (x, z) => L.h(x, z) + 0.07;
  for (const c of G.cells) {
    if (c.kind !== KD.LAND || !covered(nd.k, c.x, c.z)) continue;
    const yc = h(c.x, c.z);
    for (let k = 0; k < c.n; k++) {
      const a = c.v[k], b = c.v[(k + 1) % c.n];
      const ax = lerp(G.X[a], c.x, 0.07), az = lerp(G.Z[a], c.z, 0.07), bx2 = lerp(G.X[b], c.x, 0.07), bz = lerp(G.Z[b], c.z, 0.07);
      pos.push(c.x, yc, c.z, bx2, h(bx2, bz), bz, ax, h(ax, az), az);
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  overlay = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: nd.color, transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide }));
  overlay.renderOrder = 4; scene.add(overlay);
  let ok = 0, all = 0;
  for (const b of houses()) {
    all++;
    if (covered(nd.k, b.x, b.z)) { ok++; continue; }
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: markerTexture(nd), depthTest: false, transparent: true }));
    sp.scale.setScalar(0.44); sp.position.set(b.x, (b.top || b.y + 1) + 0.25, b.z); sp.renderOrder = 10; sp.userData.y0 = sp.position.y; sp.userData.ph = Math.random() * 6;
    scene.add(sp); markers.push(sp);
  }
  document.getElementById('needSum').textContent = `${all} 戶中有 ${ok} 戶有「${nd.name}」（${all ? Math.round(ok / all * 100) : 0}%）${ok < all ? '・' + nd.fix : ''}`;
}
function stepMarkers() { for (const m of markers) m.position.y = m.userData.y0 + Math.sin(uTime.value * 3 + m.userData.ph) * 0.04; }

// ---------------------------------------------------------------- 介面
const ui = { play: document.getElementById('play'), tod: document.getElementById('tod'), lbl: document.getElementById('lbl'), hint: document.getElementById('hint'), fps: document.getElementById('fps') };
let playing = true;
const DAY_SECONDS = 90;
ui.play.addEventListener('click', () => {
  playing = !playing; ui.play.classList.toggle('on', playing);
  document.getElementById('ic-pause').style.display = playing ? '' : 'none';
  document.getElementById('ic-play').style.display = playing ? 'none' : '';
});
ui.tod.addEventListener('input', () => { tod = ui.tod.value / 1000; });
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
  setWaterSky(d.hor);
  sun.color.copy(d.sun); sun.intensity = d.si;
  hemi.color.copy(d.hs); hemi.groundColor.copy(d.hg); hemi.intensity = d.hi;
  const e = Math.sin((t - 0.25) * TAU), elev = 0.42 + 0.48 * Math.abs(e), az = t * TAU + 0.6;
  sunDir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev)).normalize();
  sun.target.position.copy(cam.target);
  sun.position.copy(cam.target).addScaledVector(sunDir, 50);
  M.win.emissiveIntensity = d.glow * 6;
  M.crystal.emissiveIntensity = 1 + d.glow * 2.4;
  M.fire.emissiveIntensity = 2.2 + Math.sin(uTime.value * 13) * 0.4;
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
    if (performance.now() - lastInteract > 14000) cam.yaw += dt * 0.022;
  }
  if (L) cam.target.y = lerp(cam.target.y, Math.max(0, L.h(cam.target.x, cam.target.z)), Math.min(1, dt * 4));
  updateCamera();
  const d = applyDay(tod);
  if (town) {
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
    game.taxT += dt; game.evoT += dt;
    if (game.taxT > 15) { game.taxT = 0; collectTax(); }
    if (game.evoT > 2.5) { game.evoT = 0; evolve(); if (game.mode === 'needs') refreshOverlay(); }
    stepFloats(dt);
    if (game.mode === 'needs') stepMarkers();
  }
  post.render(scene, camera);
  acc += dt; frames++;
  if (acc >= 1.5) {
    const fps = frames / acc;
    ui.fps.textContent = `${fps.toFixed(0)} fps · dpr ${dpr.toFixed(2)}`;
    themeMeta.content = '#' + d.top.getHexString(THREE.SRGBColorSpace);
    if (fps < 42 && dpr > 1.01) { if (++slow >= 2) { dpr = Math.max(1, dpr - 0.25); resize(); slow = 0; } } else slow = 0;
    acc = 0; frames = 0;
  }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', resize);
resize();
applyDay(tod);
const timing = {};
setTimeout(() => {
  const t0 = performance.now();
  try { generate(); } catch (err) { console.error(err); loading.textContent = '生成失敗：' + err.message; return; }
  timing.total = Math.round(performance.now() - t0);
  loading.classList.add('hide');
  requestAnimationFrame(frame);
}, 60);

window.__town = { timing, camera, cam, post: post.params, updateCamera, get G() { return G; }, get L() { return L; }, get town() { return town; }, setTime: (t) => { tod = t; }, pause: () => { playing = false; }, game, build, evolve, collectTax, showInfo, buildHouse, paintRoad, erase, setMode: (m) => setMode(m), renderer, scene };
