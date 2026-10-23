// 生活感：樹、行人、羊、船、鳥、雲、熱氣球、炊煙、瀑布水花、螢火蟲、路燈光暈
import * as THREE from 'three';
import { makeRng, clamp, lerp, smooth, LH, DIRS, PI, TAU, C } from './util.js';
import { P, bx, rbx, M, merge, meshOf } from './kit.js';
import { U, KD } from './town.js';

const _m = new THREE.Matrix4(), _p = new THREE.Matrix4(), _t = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export function glowTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

function treeProtos() {
  const trunk = (h = 0.26, r = 0.045) => P(new THREE.CylinderGeometry(r * 0.7, r, h, 6), '#7a5236', { y: h / 2, sway: 0 });
  const blob = (r, x, y, z, cols, sy = 0.92) => P(new THREE.IcosahedronGeometry(r, 1), cols, { x, y, z, sy, sway: 1 });
  const round = (cols) => merge([trunk(), blob(0.2, 0, 0.38, 0, cols), blob(0.15, 0.1, 0.48, 0.05, cols), blob(0.14, -0.09, 0.45, -0.06, cols)]);
  return {
    round: round(['#4f944a', '#93c96c']),
    blossom: round(['#df86a2', '#ffcfdc']),
    autumn: round(['#cf7a2c', '#f2c35b']),
    pine: merge([trunk(0.2, 0.04), ...[[0.26, 0.32, 0.27], [0.2, 0.28, 0.43], [0.13, 0.24, 0.57]].map(([r, h, y]) => P(new THREE.ConeGeometry(r, h, 8), ['#2f5a38', '#5a8c4f'], { y, sway: 1 }))]),
    poplar: merge([trunk(0.18, 0.03), P(new THREE.IcosahedronGeometry(0.13, 1), ['#3f7f45', '#7cb85c'], { y: 0.48, sy: 2.6, sway: 1 })]),
  };
}

export function createLife(town, scene, { boats = [], falls = [], lamps = [] }) {
  const r = makeRng(4242);
  const root = new THREE.Group(); scene.add(root);
  const texGlow = glowTexture();
  const pools = {
    warm: new THREE.MeshBasicMaterial({ map: texGlow, color: 0xffb35c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
    violet: new THREE.MeshBasicMaterial({ map: texGlow, color: 0xa680ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
  };

  // ---------------- 樹（實例化）
  const protos = treeProtos();
  const byKind = {};
  for (const t of town.trees) (byKind[t.kind] ||= []).push(t);
  const tint = new THREE.Color();
  for (const [kindT, list] of Object.entries(byKind)) {
    const im = new THREE.InstancedMesh(protos[kindT], M.tree, list.length);
    list.forEach((t, k) => {
      _q.setFromEuler(_e.set(0, t.rot, 0)); _s.setScalar(t.s); _v.set(t.x, t.y, t.z);
      _m.compose(_v, _q, _s); im.setMatrixAt(k, _m);
      t.im = im; t.idx = k;
      tint.setRGB(0.88 + r() * 0.2, 0.9 + r() * 0.18, 0.86 + r() * 0.16); im.setColorAt(k, tint);
    });
    im.castShadow = true; im.receiveShadow = true;
    root.add(im);
  }

  // ---------------- 路網與行人（格子圖：路、廣場、水上木棧道；石橋直接連兩岸）
  const G = town.G, L = town.L;
  const nodes = new Map(), bridgeEdge = new Map();
  function buildGraph() {
    nodes.clear(); bridgeEdge.clear();
    const { use } = town;
    for (const c of G.cells) if (use[c.id] === U.ROAD || use[c.id] === U.PLAZA) nodes.set(c.id, { c, nb: [] });
    for (const n of nodes.values()) for (const id of n.c.nb) {
      const o = nodes.get(id); if (!o) continue;
      if (n.c.kind !== KD.RIVER && o.c.kind !== KD.RIVER && Math.abs(n.c.y - o.c.y) > 0.65) continue;
      n.nb.push(o);
    }
    for (const s of town.sites) if (s.active && s.bridge) {
      const a = nodes.get(s.a), b = nodes.get(s.b); if (!a || !b) continue;
      a.nb.push(b); b.nb.push(a);
      bridgeEdge.set(s.a * 100000 + s.b, { ud: s.bridge.userData, rev: false });
      bridgeEdge.set(s.b * 100000 + s.a, { ud: s.bridge.userData, rev: true });
    }
  }
  buildGraph();
  const groundY = (c, x, z) => (c.kind === KD.RIVER ? c.ws + 0.17 : L.h(x, z) + 0.045);
  function edgeMid(a, b) { for (const e of a.edges) if (e.nb === b.id) return [(G.X[e.a] + G.X[e.b]) / 2, (G.Z[e.a] + G.Z[e.b]) / 2]; return [(a.x + b.x) / 2, (a.z + b.z) / 2]; }
  const fig = {
    legL: P(bx(0.024, 0.088, 0.028).translate(0, -0.044, 0), '#fff'),
    torso: P(new THREE.CylinderGeometry(0.03, 0.037, 0.082, 8).translate(0, 0.041, 0), '#fff'),
    skirt: P(new THREE.CylinderGeometry(0.033, 0.058, 0.09, 10).translate(0, -0.045, 0), '#fff'),
    arm: P(bx(0.018, 0.074, 0.02).translate(0, -0.037, 0), '#fff'),
    head: P(new THREE.SphereGeometry(0.031, 10, 8), '#fff'),
    hair: P(new THREE.SphereGeometry(0.034, 10, 6, 0, TAU, 0, PI * 0.55), '#fff'),
    hat: merge([P(new THREE.CylinderGeometry(0.056, 0.056, 0.007, 14), '#fff'), P(new THREE.CylinderGeometry(0.028, 0.032, 0.032, 12), '#fff', { y: 0.018 })]),
  };
  const nodeList = [...nodes.values()];
  const NW = Math.min(70, Math.max(12, Math.round(nodeList.length * 0.45)));
  const plazaCells = nodeList.filter((n) => town.use[n.c.id] === U.PLAZA);
  const NI = 12;
  const NP = NW + NI;
  const IM = {};
  for (const k of ['legL', 'legR', 'torso', 'skirt', 'armL', 'armR', 'head', 'hair', 'hat']) {
    const geo = k === 'legR' ? fig.legL : k === 'armL' || k === 'armR' ? fig.arm : fig[k];
    IM[k] = new THREE.InstancedMesh(geo, M.figure, NP);
    IM[k].castShadow = true; IM[k].receiveShadow = false; IM[k].frustumCulled = false;
    root.add(IM[k]);
  }
  const SKIN = ['#f2d0b0', '#e2b48c', '#c98f68', '#f6dcc4', '#a8714f'].map(C);
  const CLOTH = ['#8c3b3b', '#3e5c76', '#6b7f3a', '#c49a45', '#7a4f7f', '#e8dcc4', '#5a6e6a', '#b5523f', '#2f4f6e', '#d6c7a6'].map(C);
  const PANTS = ['#4a3f35', '#5b5048', '#3d4552', '#6b5a44'].map(C);
  const HAIR = ['#2b211b', '#5a3a24', '#c79a52', '#8a4a2a', '#d8d2c8'].map(C);
  const HAT = ['#d9b25a', '#6b4a35', '#3b3944', '#b35a3c'].map(C);
  const people = [];
  for (let k = 0; k < NP; k++) {
    const idle = k >= NW;
    const n = idle ? (plazaCells.length ? r.pick(plazaCells) : r.pick(nodeList)) : r.pick(nodeList);
    if (!n) break;
    const p = { idle, from: n, to: n, s: 1, v: 0.3 + r() * 0.22, lane: r() < 0.5 ? -1 : 1, ph: r() * 10, dress: r() < 0.42, hat: r() < 0.35, pause: 0, yaw: r() * TAU, x: n.c.x, z: n.c.z };
    if (idle) { const a = r() * TAU, rr = 0.4 + r() * 1.1; p.x = town.pc.x + Math.cos(a) * rr; p.z = town.pc.z + Math.sin(a) * rr; }
    const cl = r.pick(CLOTH), sk = r.pick(SKIN);
    IM.torso.setColorAt(k, cl); IM.armL.setColorAt(k, cl); IM.armR.setColorAt(k, cl);
    const pc = p.dress ? r.pick(CLOTH) : r.pick(PANTS);
    IM.legL.setColorAt(k, p.dress ? sk : pc); IM.legR.setColorAt(k, p.dress ? sk : pc); IM.skirt.setColorAt(k, pc);
    IM.head.setColorAt(k, sk); IM.hair.setColorAt(k, r.pick(HAIR)); IM.hat.setColorAt(k, r.pick(HAT));
    people.push(p);
  }
  function placePerson(k, p, x, y, z, yaw, swing) {
    _m.makeRotationY(yaw); _m.setPosition(x, y, z);
    const part = (im, ox, oy, oz, rx, sc = 1) => { _p.makeRotationX(rx); _p.setPosition(ox, oy, oz); _t.multiplyMatrices(_m, _p); if (sc !== 1) _t.scale(_v.setScalar(sc)); im.setMatrixAt(k, _t); };
    part(IM.legL, -0.015, 0.088, 0, swing * 0.6);
    part(IM.legR, 0.015, 0.088, 0, -swing * 0.6);
    part(IM.skirt, 0, 0.09, 0, 0, p.dress ? 1 : 0);
    part(IM.torso, 0, 0.086, 0, 0);
    part(IM.armL, -0.043, 0.162, 0, -swing * 0.5);
    part(IM.armR, 0.043, 0.162, 0, swing * 0.5);
    part(IM.head, 0, 0.2, 0, 0);
    part(IM.hair, 0, 0.204, -0.004, -0.15);
    part(IM.hat, 0, 0.226, 0, 0, p.hat ? 1 : 0);
  }
  function nextNode(p) {
    const opts = p.to.nb.filter((o) => o !== p.from);
    return opts.length ? r.pick(opts) : (p.to.nb[0] || p.to);
  }
  function updatePeople(dt, T0) {
    people.forEach((p, k) => {
      let x, z, y, yaw = p.yaw, swing = 0;
      if (p.idle) {
        x = p.x; z = p.z; y = L.h(x, z) + 0.045; yaw = p.yaw + Math.sin(T0 * 0.3 + p.ph) * 0.6; swing = Math.sin(T0 * 1.2 + p.ph) * 0.1;
      } else {
        if (p.pause > 0) p.pause -= dt;
        else {
          if (p.s >= 1) {
            const nn = nextNode(p); p.from = p.to; p.to = nn; p.s = 0;
            p.br = bridgeEdge.get(p.from.c.id * 100000 + p.to.c.id) || null;
            p.mid = p.br ? null : edgeMid(p.from.c, p.to.c);
            p.len = p.from === p.to ? 1 : p.br ? Math.hypot(p.to.c.x - p.from.c.x, p.to.c.z - p.from.c.z) : Math.hypot(p.mid[0] - p.from.c.x, p.mid[1] - p.from.c.z) + Math.hypot(p.to.c.x - p.mid[0], p.to.c.z - p.mid[1]);
            if (r() < 0.06) p.pause = 1 + r() * 2.5;
          }
          p.s = Math.min(1, p.s + p.v * dt / (p.len || 1));
          p.ph += dt * p.v * 26;
        }
        const A = p.from.c, B = p.to.c, t = p.s;
        let tx, tz;
        if (p.br || A === B) {
          x = lerp(A.x, B.x, t); z = lerp(A.z, B.z, t); tx = B.x - A.x; tz = B.z - A.z;
        } else {
          const [mx, mz] = p.mid, u = 1 - t;
          x = u * u * A.x + 2 * u * t * mx + t * t * B.x; z = u * u * A.z + 2 * u * t * mz + t * t * B.z;
          tx = 2 * u * (mx - A.x) + 2 * t * (B.x - mx); tz = 2 * u * (mz - A.z) + 2 * t * (B.z - mz);
        }
        const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        x -= tz * 0.13 * p.lane; z += tx * 0.13 * p.lane;
        if (p.br) { const ud = p.br.ud; y = ud.deck(p.br.rev ? 1 - t : t) + 0.006; }
        else y = groundY(t < 0.5 ? A : B, x, z);
        if (A !== B) { const target = Math.atan2(tx, tz); p.yaw += Math.atan2(Math.sin(target - p.yaw), Math.cos(target - p.yaw)) * Math.min(1, dt * 10); }
        yaw = p.yaw;
        swing = p.pause > 0 ? 0 : Math.sin(p.ph);
        y += Math.abs(Math.sin(p.ph)) * 0.006;
      }
      placePerson(k, p, x, y, z, yaw, swing);
    });
    for (const im of Object.values(IM)) { im.instanceMatrix.needsUpdate = true; }
  }
  for (const im of Object.values(IM)) if (im.instanceColor) im.instanceColor.needsUpdate = true;

  // ---------------- 羊
  const sheep = [];
  for (const f of town.fields) if (f.type === 'pasture') for (const id of f.cells) for (let k = 0; k < 2; k++) { const c = G.cells[id]; sheep.push({ cx: c.x, cz: c.z, rr: c.rin * 0.7, x: c.x + (r() - 0.5) * c.rin, z: c.z + (r() - 0.5) * c.rin, tx: c.x, tz: c.z, t: 0, yaw: r() * TAU, ph: r() * 10 }); }
  const sheepBody = new THREE.InstancedMesh(P(new THREE.IcosahedronGeometry(0.07, 1), '#fff', { sy: 0.78, sz: 1.3 }), M.figure, Math.max(1, sheep.length));
  const sheepHead = new THREE.InstancedMesh(P(bx(0.045, 0.05, 0.06), '#fff'), M.figure, Math.max(1, sheep.length));
  sheepBody.count = sheepHead.count = sheep.length;
  sheep.forEach((s, k) => { sheepBody.setColorAt(k, C(r() < 0.12 ? '#4a4038' : '#f4efe4')); sheepHead.setColorAt(k, C('#3b3530')); });
  for (const im of [sheepBody, sheepHead]) { im.castShadow = true; im.frustumCulled = false; root.add(im); }
  function updateSheep(dt, T0) {
    sheep.forEach((s, k) => {
      s.t -= dt;
      if (s.t <= 0) { s.tx = s.cx + (r() - 0.5) * s.rr * 2; s.tz = s.cz + (r() - 0.5) * s.rr * 2; s.t = 3 + r() * 5; }
      const dx = s.tx - s.x, dz = s.tz - s.z, d = Math.hypot(dx, dz);
      const moving = d > 0.03;
      if (moving) { s.x += dx / d * dt * 0.06; s.z += dz / d * dt * 0.06; s.yaw += Math.atan2(Math.sin(Math.atan2(dx, dz) - s.yaw), Math.cos(Math.atan2(dx, dz) - s.yaw)) * Math.min(1, dt * 3); }
      const graze = moving ? 0 : (Math.sin(T0 * 0.8 + s.ph) * 0.5 + 0.5);
      _m.compose(_v.set(s.x, L.h(s.x, s.z) + 0.075, s.z), _q.setFromEuler(_e.set(0, s.yaw, 0)), _s.set(1, 1, 1));
      sheepBody.setMatrixAt(k, _m);
      _p.makeRotationX(graze * 0.6); _p.setPosition(0, 0.02 - graze * 0.03, 0.1); _t.multiplyMatrices(_m, _p);
      sheepHead.setMatrixAt(k, _t);
    });
    sheepBody.instanceMatrix.needsUpdate = sheepHead.instanceMatrix.needsUpdate = true;
  }

  // ---------------- 船
  const boatObjs = [];
  function makeBoat(sail) {
    const parts = [];
    if (sail) {
      parts.push(P(rbx(0.2, 0.08, 0.52, 0.04, 2), ['#6e4c36', '#f1e9da'], {}));
      parts.push(P(bx(0.16, 0.02, 0.42), '#a07a54', { y: 0.035 }));
      parts.push(P(new THREE.CylinderGeometry(0.008, 0.008, 0.6, 5), '#6e4c36', { y: 0.32 }));
      const tri = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.3, 0), new THREE.Vector2(0, 0.48)]);
      parts.push(P(new THREE.ExtrudeGeometry(tri, { depth: 0.006, bevelEnabled: false }), '#fbf3e4', { ry: -PI / 2, y: 0.08, z: -0.02 }));
    } else {
      parts.push(P(rbx(0.13, 0.05, 0.32, 0.025, 2), ['#5a3f2e', '#8a5a3a'], {}));
      parts.push(P(bx(0.1, 0.012, 0.25), '#6e4630', { y: 0.015 }));
      parts.push(P(bx(0.11, 0.012, 0.03), '#a07a54', { y: 0.03 }));
    }
    const m = new THREE.Mesh(merge(parts), M.std); m.castShadow = true;
    const g = new THREE.Group(); g.add(m); root.add(g);
    return g;
  }
  for (const b of boats) { const g = makeBoat(b.sail); g.position.set(b.x, -0.08, b.z); g.rotation.y = b.ry + (r() - 0.5) * 0.4; g.userData = { ph: r() * 10, y0: -0.08, ry: g.rotation.y }; boatObjs.push(g); }
  // 一艘在外海來回航行的帆船（沿海岸方向）
  let sailer = null;
  {
    const d = L.coastAt(0) + 4.5;
    sailer = { g: makeBoat(true), cx: L.sx * d, cz: L.sz * d, ax: -L.sz, az: L.sx, t: r() * 10 };
    sailer.g.scale.setScalar(1.3);
  }
  function updateBoats(dt, T0) {
    for (const g of boatObjs) { const u = g.userData; g.position.y = u.y0 + Math.sin(T0 * 1.3 + u.ph) * 0.012; g.rotation.z = Math.sin(T0 * 1.1 + u.ph) * 0.06; g.rotation.y = u.ry + Math.sin(T0 * 0.3 + u.ph) * 0.08; }
    if (sailer) {
      sailer.t += dt * 0.035;
      const s = Math.sin(sailer.t), v = Math.cos(sailer.t);
      sailer.g.position.set(sailer.cx + sailer.ax * s * 7, -0.07 + Math.sin(T0 * 1.2) * 0.012, sailer.cz + sailer.az * s * 7);
      sailer.g.rotation.y = Math.atan2(sailer.ax * v, sailer.az * v);
      sailer.g.rotation.z = Math.sin(T0 * 0.9) * 0.05;
    }
  }

  // ---------------- 鳥、雲、熱氣球
  const birds = [];
  {
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.04, 0, 0, -0.04, 0.16, 0, -0.02], 3)); wingGeo.computeVertexNormals();
    const wm = new THREE.MeshStandardMaterial({ color: 0xfaf7f0, side: THREE.DoubleSide, roughness: 0.9 });
    for (let k = 0; k < 9; k++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.025, 0.08, 3, 6).rotateX(PI / 2), wm);
      const l = new THREE.Mesh(wingGeo, wm), rr = new THREE.Mesh(wingGeo, wm); rr.scale.x = -1;
      g.add(body, l, rr); g.userData = { l, r: rr, ph: r() * TAU, rad: 5 + r() * 4, h: 3.2 + r() * 1.4, sp: 0.16 + r() * 0.07, off: k * 0.2 };
      root.add(g); birds.push(g);
    }
  }
  let balloon;
  {
    const g = new THREE.Group();
    const env = new THREE.SphereGeometry(0.34, 16, 12);
    const p = env.attributes.position, c = new Float32Array(p.count * 3);
    const cA = C('#d9534f'), cB = C('#f6e7c8'), cG = C('#e8c065');
    for (let q = 0; q < p.count; q++) { const a = Math.atan2(p.getZ(q), p.getX(q)); const band = Math.floor((a + PI) / TAU * 12) % 2; const cl = p.getY(q) < -0.2 ? cG : band ? cA : cB; c[q * 3] = cl.r; c[q * 3 + 1] = cl.g; c[q * 3 + 2] = cl.b; }
    env.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const em = new THREE.Mesh(env, M.std); em.scale.set(1, 1.15, 1); em.castShadow = true;
    const parts = [P(bx(0.12, 0.08, 0.12), '#8a6040', { y: -0.62 })];
    for (const [x, z] of [[0.05, 0.05], [-0.05, 0.05], [0.05, -0.05], [-0.05, -0.05]]) parts.push(P(bx(0.004, 0.26, 0.004), '#5a3f2e', { x, y: -0.46, z }));
    g.add(em, meshOf(parts, M.std));
    g.userData = { t: r() * 100 };
    root.add(g); balloon = g;
  }

  // ---------------- 炊煙、水花、螢火蟲、路燈光暈
  const smokeGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffs = [];
  for (let k = 0; k < 70; k++) { const m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0xf2efea, roughness: 1, transparent: true, depthWrite: false })); m.visible = false; root.add(m); puffs.push({ m, life: 0, src: null, dx: 0 }); }
  const foams = [];
  for (const f of falls) for (let k = 0; k < 4; k++) {
    const m = new THREE.Mesh(smokeGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, depthWrite: false, opacity: 0 }));
    m.userData = { f, life: k / 4, ox: (r() - 0.5) * 0.4, oz: (r() - 0.5) * 0.4 }; root.add(m); foams.push(m);
  }
  const ff = (() => {
    const n = 140, pos = new Float32Array(n * 3), base = [];
    const tl = town.trees.length ? town.trees : [{ x: 0, y: 0, z: 0 }];
    for (let k = 0; k < n; k++) { const t = tl[Math.floor(r() * tl.length)]; base.push([t.x + (r() - 0.5), t.y + 0.25 + r() * 0.5, t.z + (r() - 0.5), r() * TAU]); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xd8ff8a, size: 0.09, map: texGlow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const pts = new THREE.Points(g, m); pts.userData.base = base; pts.frustumCulled = false; root.add(pts);
    return pts;
  })();
  const poolMeshes = [];
  function addLampPools(list) {
    if (!list.length) return;
    const geos = list.map((p) => new THREE.PlaneGeometry(1.1, 1.1).rotateX(-PI / 2).translate(p.x, p.y - 0.38, p.z));
    const m = new THREE.Mesh(merge(geos), pools.warm); m.renderOrder = 3; root.add(m); poolMeshes.push(m);
  }
  addLampPools(lamps);

  let smokeTimer = 0;
  const WHITE = new THREE.Color(1, 1, 1);
  function update(dt, T0, d, chimneys) {
    updatePeople(dt, T0);
    updateSheep(dt, T0);
    updateBoats(dt, T0);
    for (const b of birds) {
      const u = b.userData, a = T0 * u.sp + u.off;
      b.position.set(Math.cos(a) * u.rad, u.h + Math.sin(T0 * 0.7 + u.ph) * 0.3, Math.sin(a) * u.rad);
      b.rotation.y = Math.atan2(-Math.sin(a), Math.cos(a));
      const f = Math.sin(T0 * 9 + u.ph) * 0.6; u.l.rotation.z = f; u.r.rotation.z = -f;
    }
    { const u = balloon.userData; u.t += dt * 0.025; balloon.position.set(Math.sin(u.t) * 15, 5.5 + Math.sin(T0 * 0.4) * 0.15, Math.cos(u.t * 0.7) * 13); balloon.rotation.y = T0 * 0.05; }
    smokeTimer -= dt;
    if (smokeTimer <= 0 && chimneys.length) {
      smokeTimer = Math.max(0.05, 3.2 / chimneys.length);
      const fr = puffs.find((p) => p.life <= 0);
      if (fr) { fr.life = 1; fr.src = chimneys[Math.floor(r() * chimneys.length)]; fr.m.visible = true; fr.dx = (r() - 0.5) * 0.2; }
    }
    for (const p of puffs) {
      if (p.life <= 0) continue;
      p.life -= dt / 3.4;
      if (p.life <= 0) { p.m.visible = false; continue; }
      const u = 1 - p.life;
      p.m.position.set(p.src.x + u * 0.35 + p.dx * u, p.src.y + u * 0.9, p.src.z - u * 0.12);
      p.m.scale.setScalar(0.025 + u * 0.085);
      p.m.material.opacity = Math.sin(u * PI) * 0.5;
      p.m.material.color.copy(d.cl).lerp(WHITE, 0.4);
    }
    for (const m of foams) {
      const u = m.userData; u.life += dt / 1.6; if (u.life > 1) u.life -= 1;
      const t = u.life;
      m.position.set(u.f.x + u.ox + u.f.tg.x * 0.12, u.f.bot + 0.02 + t * 0.12, u.f.z + u.oz + u.f.tg.z * 0.12);
      m.scale.setScalar(0.05 + t * 0.09);
      m.material.opacity = Math.sin(t * PI) * 0.6;
    }
    {
      const arr = ff.geometry.attributes.position.array, base = ff.userData.base;
      for (let k = 0; k < base.length; k++) { const [x, y, z, ph] = base[k]; arr[k * 3] = x + Math.sin(T0 * 0.6 + ph) * 0.3; arr[k * 3 + 1] = y + Math.sin(T0 * 1.1 + ph * 2) * 0.12; arr[k * 3 + 2] = z + Math.cos(T0 * 0.5 + ph) * 0.3; }
      ff.geometry.attributes.position.needsUpdate = true;
      ff.material.opacity = smooth(0.4, 1, d.glow);
    }
    pools.warm.opacity = d.glow * 0.6; pools.violet.opacity = 0.25 + d.glow * 0.5;
  }
  function clearCell(id) {
    for (const t of town.trees) if (t.im && t.cell === id) { t.im.setMatrixAt(t.idx, _m.makeScale(0, 0, 0)); t.im.instanceMatrix.needsUpdate = true; t.im = null; }
    const ym = town.yardMeshes && town.yardMeshes.get(id);
    if (ym) { ym.parent.remove(ym); town.yardMeshes.delete(id); }
    if (town.use[id] === U.YARD) town.use[id] = U.EMPTY;
  }
  return { update, buildGraph, addLampPools, clearCell, pools, root };
}
