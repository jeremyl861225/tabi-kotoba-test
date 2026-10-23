// 隨機地形：一邊是山、一邊是海的台地；河從山上往低處流進海，遇落差成小瀑布
import * as THREE from 'three';
import { makeRng, fbm, vnoise, clamp, lerp, smooth, C, LH, DIRS, hash2 } from './util.js';
import { P, bx, M, merge, enhance } from './kit.js';

export const LAND = 0, SEA = 1, RIVER = 2;

export function genTerrain(seed, N = 26, E = 12) {
  const r = makeRng(seed);
  const MM = N + 2 * E;
  const ox = r() * 200, oz = r() * 200;
  const side = r.int(0, 3);
  const lev = Array.from({ length: MM }, () => new Int16Array(MM));
  const kind = Array.from({ length: MM }, () => new Uint8Array(MM));
  const uOf = (i, j) => { const a = i / (MM - 1), b = j / (MM - 1); return [b, 1 - b, a, 1 - a][side]; };
  const acrossOf = (i, j) => (side < 2 ? i : j) / (MM - 1);
  const inb = (i, j) => i >= 0 && j >= 0 && i < MM && j < MM;

  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    const u = uOf(i, j), ac = acrossOf(i, j);
    const coast = 0.77 + (fbm(ac * 3.2 + ox, 1.7 + oz) - 0.47) * 0.3;
    if (u > coast) { kind[i][j] = SEA; lev[i][j] = -1; continue; }
    const dc = Math.hypot(i - MM / 2 + 0.5, j - MM / 2 + 0.5) / (N / 2);
    let h = (coast - u) * 5.0 + (fbm(i * 0.1 + ox, j * 0.1 + oz) - 0.47) * 5.4 + (fbm(i * 0.23 - oz, j * 0.23 + ox) - 0.47) * 1.6;
    h *= lerp(0.78, 1, smooth(0.45, 1.35, dc));
    h += Math.max(0, dc - 1.1) * 2.4 * (1 - u);
    lev[i][j] = clamp(Math.floor(h), 0, 9);
  }
  // 抹掉孤立的單格高低點
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    if (kind[i][j] !== LAND) continue;
    let mx = -9, mn = 99, cnt = 0;
    for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (!inb(a, b) || kind[a][b] !== LAND) continue; mx = Math.max(mx, lev[a][b]); mn = Math.min(mn, lev[a][b]); cnt++; }
    if (!cnt) continue;
    if (lev[i][j] > mx) lev[i][j] = mx; else if (lev[i][j] < mn) lev[i][j] = mn;
  }

  // 河：從遠端山區找一條「不往上走」最便宜的路到海
  const idx = (i, j) => i * MM + j;
  const srcs = [];
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    const u = uOf(i, j), ac = acrossOf(i, j);
    if (u < 0.03 && ac > 0.35 && ac < 0.65 && kind[i][j] === LAND) srcs.push([i, j]);
  }
  const river = [];
  if (srcs.length) {
    const [si, sj] = r.pick(srcs);
    const dist = new Float64Array(MM * MM).fill(Infinity), prev = new Int32Array(MM * MM).fill(-1);
    const heap = [];
    const push = (d, n) => { heap.push([d, n]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const a = 2 * k + 1, b = a + 1; let m = k; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    dist[idx(si, sj)] = 0; push(0, idx(si, sj));
    let end = -1;
    while (heap.length) {
      const [d, n] = pop();
      if (d > dist[n]) continue;
      const ci = Math.floor(n / MM), cj = n % MM;
      if (kind[ci][cj] === SEA) { end = n; break; }
      for (const [di, dj] of DIRS) {
        const a = ci + di, b = cj + dj; if (!inb(a, b)) continue;
        const across = acrossOf(a, b);
        let c = 1 + vnoise(a * 0.35 + ox, b * 0.35 + oz) * 2.4;
        if (kind[a][b] === LAND) { const up = lev[a][b] - lev[ci][cj]; if (up > 0) c += 60 * up; c += lev[a][b] * 0.06; }
        if (across < 0.12 || across > 0.88) c += 6;
        const nd = d + c, m = idx(a, b);
        if (nd < dist[m]) { dist[m] = nd; prev[m] = n; push(nd, m); }
      }
    }
    if (end >= 0) {
      for (let n = prev[end]; n >= 0; n = prev[n]) river.unshift([Math.floor(n / MM), n % MM]);
      let cur = 99;
      for (const [i, j] of river) { cur = Math.min(cur, lev[i][j]); lev[i][j] = cur; kind[i][j] = RIVER; }
      // 河岸不能比水面低
      for (const [i, j] of river) for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (inb(a, b) && kind[a][b] === LAND && lev[a][b] < lev[i][j]) lev[a][b] = lev[i][j]; }
    }
  }

  // 海的深度（離岸格數）
  const seaDist = Array.from({ length: MM }, () => new Int16Array(MM).fill(0));
  {
    const q = [];
    for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) if (kind[i][j] === SEA) {
      seaDist[i][j] = 99;
      for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (inb(a, b) && kind[a][b] !== SEA) { seaDist[i][j] = 1; q.push([i, j]); break; } }
    }
    while (q.length) {
      const [i, j] = q.shift();
      for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (inb(a, b) && kind[a][b] === SEA && seaDist[a][b] > seaDist[i][j] + 1) { seaDist[a][b] = seaDist[i][j] + 1; q.push([a, b]); } }
    }
  }

  const T = {
    N, E, MM, lev, kind, river, side, seaDist, ox, oz, inb,
    wx: (i) => i - MM / 2 + 0.5,
    wz: (j) => j - MM / 2 + 0.5,
    ci: (x) => Math.round(x + MM / 2 - 0.5),
    inPlay: (i, j, m = 0) => i >= E + m && j >= E + m && i < E + N - m && j < E + N - m,
    topY(i, j) {
      if (!inb(i, j)) return -3;
      const k = kind[i][j];
      if (k === SEA) return -0.26 - Math.min(seaDist[i][j], 6) * 0.1;
      if (k === RIVER) return lev[i][j] * LH - 0.2;
      return lev[i][j] * LH;
    },
    waterY: (i, j) => lev[i][j] * LH - 0.075,
    isBeach(i, j) {
      if (kind[i][j] !== LAND || lev[i][j] !== 0) return false;
      for (const [di, dj] of DIRS) { const a = i + di, b = j + dj; if (inb(a, b) && kind[a][b] === SEA) return true; }
      return false;
    },
  };
  return T;
}

// ---------------------------------------------------------------- 網格
function streakTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, 64, 256);
  const rr = makeRng(7);
  for (let i = 0; i < 80; i++) {
    const x = rr() * 64, y = rr() * 256, h = 10 + rr() * 40, w = 1 + rr() * 2.5;
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, `rgba(255,255,255,${0.35 + rr() * 0.5})`); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    if (y + h > 256) g.fillRect(x, y - 256, w, h);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function buildTerrain(T, isTown) {
  const { MM, lev, kind } = T;
  const pos = [], col = [], nor = [];
  const tmp = new THREE.Color();
  const grassA = C('#8bbb5c'), grassB = C('#bdd47e'), grassC = C('#6f9e4e'), moss = C('#93a86a');
  const sand = C('#e6d6ab'), bed = C('#8a8670'), seaShallow = C('#dccb9f'), seaDeep = C('#6f9c94');
  const rockC = C('#a89a86');
  function grassAt(x, z, l) {
    const n = fbm(x * 0.3 + 7, z * 0.3 + 3), n2 = fbm(x * 1.2, z * 1.2);
    tmp.copy(grassA).lerp(grassB, smooth(0.25, 0.75, n)).lerp(grassC, smooth(0.6, 0.78, n2) * 0.55);
    if (l >= 5) tmp.lerp(moss, smooth(4.5, 7, l) * 0.7);
    return tmp;
  }
  function quad(a, b, c, d, cl, n, cl2) { // a b c d 逆時針（外側看）
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) nor.push(...n);
    const c2 = cl2 || cl;
    col.push(cl.r, cl.g, cl.b, cl.r, cl.g, cl.b, c2.r, c2.g, c2.b, cl.r, cl.g, cl.b, c2.r, c2.g, c2.b, c2.r, c2.g, c2.b);
  }
  const lips = [];
  const stoneCols = ['#cfc3ad', '#c2b59d', '#d8cfbd', '#bfb29a', '#d2c6b0'].map(C), mortar = C('#988c78');
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    const x = T.wx(i), z = T.wz(j), t = T.topY(i, j), k = kind[i][j];
    // 頂面（四角各自取色，同類地面接起來是連續的）
    const corners = [[x - 0.5, z - 0.5], [x + 0.5, z - 0.5], [x + 0.5, z + 0.5], [x - 0.5, z + 0.5]];
    const cc = corners.map(([cx, cz]) => {
      if (k === SEA) return seaShallow.clone().lerp(seaDeep, smooth(1, 5, T.seaDist[i][j]));
      if (k === RIVER) return bed.clone().multiplyScalar(0.9 + hash2(cx, cz) * 0.15);
      if (T.isBeach(i, j)) return sand.clone().multiplyScalar(0.95 + fbm(cx, cz) * 0.1);
      return grassAt(cx, cz, lev[i][j]).clone();
    });
    pos.push(corners[0][0], t, corners[0][1], corners[3][0], t, corners[3][1], corners[2][0], t, corners[2][1], corners[0][0], t, corners[0][1], corners[2][0], t, corners[2][1], corners[1][0], t, corners[1][1]);
    for (let q = 0; q < 6; q++) nor.push(0, 1, 0);
    for (const q of [0, 3, 2, 0, 2, 1]) col.push(cc[q].r, cc[q].g, cc[q].b);
    // 側牆：鄰格較低就補牆
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (!T.inb(a, b)) continue;
      const nt = T.topY(a, b);
      if (nt >= t - 1e-4) continue;
      const n = [di, 0, dj];
      const e = [dj, 0, -di];
      const cx = x + di * 0.5, cz = z + dj * 0.5;
      const A = [cx - e[0] * 0.5, cz - e[2] * 0.5], B = [cx + e[0] * 0.5, cz + e[2] * 0.5];
      const nk = kind[a][b];
      let style;
      if (k === SEA) style = 'sand';
      else if (nk === SEA) style = lev[i][j] === 0 ? 'sand' : 'rock';
      else if (k === RIVER && nk === RIVER) style = 'stone';
      else if (isTown(i, j) || isTown(a, b)) style = 'stone';
      else style = (t - nt) > LH * 1.5 ? 'rock' : 'earth';
      if (style === 'stone') {
        quad([A[0], nt, A[1]], [B[0], nt, B[1]], [B[0], t, B[1]], [A[0], t, A[1]], mortar, n);
        const rows = Math.max(1, Math.round((t - nt) / 0.09));
        const rh = (t - nt) / rows;
        for (let rI = 0; rI < rows; rI++) {
          const y0 = nt + rI * rh + 0.008, y1 = nt + (rI + 1) * rh - 0.008;
          let u0 = 0;
          const off = (rI % 2) * 0.17;
          const cuts = [0, 0.17 + off, 0.5 + off * 0.5, 0.83, 1].filter((v, q, arr) => q === 0 || v > arr[q - 1] + 0.05);
          for (let q = 0; q < cuts.length - 1; q++) {
            const s0 = cuts[q] + 0.008, s1 = cuts[q + 1] - 0.008;
            const p0 = [lerp(A[0], B[0], s0) + n[0] * 0.006, lerp(A[1], B[1], s0) + n[2] * 0.006];
            const p1 = [lerp(A[0], B[0], s1) + n[0] * 0.006, lerp(A[1], B[1], s1) + n[2] * 0.006];
            const sc = stoneCols[Math.floor(hash2(i * 7 + q + di * 3, j * 5 + rI + dj * 11) * stoneCols.length)].clone().multiplyScalar(0.9 + hash2(i + q, j - rI) * 0.16);
            quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], sc, n);
            u0 = s1;
          }
        }
        if (k !== RIVER) lips.push(P(bx(1.02, 0.03, 0.09), '#e3d8c3', { x: cx - n[0] * 0.035, y: t + 0.008, z: cz - n[2] * 0.035, ry: dj !== 0 ? 0 : Math.PI / 2 }));
      } else {
        const top = style === 'sand' ? C('#d8c79a') : style === 'rock' ? rockC.clone().multiplyScalar(1.02) : C('#8f6e4c');
        const bot = style === 'sand' ? C('#c9b688') : style === 'rock' ? C('#867a6c') : C('#6b5440');
        const steps = Math.max(1, Math.round((t - nt) / 0.18));
        for (let s = 0; s < steps; s++) {
          const y0 = lerp(nt, t, s / steps), y1 = lerp(nt, t, (s + 1) / steps);
          const ca = bot.clone().lerp(top, s / steps).multiplyScalar(0.94 + hash2(i * 3 + s, j * 7 + di) * 0.1);
          const cb = bot.clone().lerp(top, (s + 1) / steps);
          quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], ca, n, cb);
        }
        if (k === LAND && style !== 'sand') lips.push(P(rbx2(1.04, 0.05, 0.08), ['#5d8a43', '#7aac55'], { x: cx - n[0] * 0.03, y: t - 0.012, z: cz - n[2] * 0.03, ry: dj !== 0 ? 0 : Math.PI / 2 }));
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const group = new THREE.Group();
  const ground = new THREE.Mesh(g, M.std); ground.receiveShadow = true; ground.castShadow = true; ground.name = 'ground';
  group.add(ground);
  if (lips.length) { const lm = new THREE.Mesh(merge(lips), M.std); lm.receiveShadow = true; lm.castShadow = true; group.add(lm); }

  // ---------------- 河
  const texRiver = streakTexture(); texRiver.repeat.set(1, 0.45);
  const matRiver = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, roughness: 0.16, metalness: 0.05, emissive: 0xffffff, emissiveMap: texRiver, emissiveIntensity: 0.3, opacity: 0.9, depthWrite: false }));
  const falls = [];
  if (T.river.length > 1) {
    const cells = T.river.slice();
    // 延伸半格進海
    const last = cells[cells.length - 1], pre = cells[cells.length - 2];
    const dirEnd = [last[0] - pre[0], last[1] - pre[1]];
    const pts = cells.map(([i, j]) => new THREE.Vector3(T.wx(i), 0, T.wz(j)));
    pts.push(new THREE.Vector3(T.wx(last[0]) + dirEnd[0] * 0.8, 0, T.wz(last[1]) + dirEnd[1] * 0.8));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const n = pts.length, per = 8, samples = [];
    const yOf = (ci) => ci >= cells.length ? -0.09 : T.waterY(cells[ci][0], cells[ci][1]);
    for (let s = 0; s <= (n - 1) * per; s++) {
      const u = s / ((n - 1) * per), p = curve.getPoint(u), tg = curve.getTangent(u);
      const ci = Math.min(n - 1, Math.round(u * (n - 1)));
      const y = yOf(ci);
      if (samples.length) {
        const prevS = samples[samples.length - 1];
        if (Math.abs(prevS.y - y) > 0.01) {
          const mid = prevS.p.clone().lerp(p, 0.5);
          samples.push({ p: mid.clone(), y: prevS.y, tg });
          samples.push({ p: mid.clone().addScaledVector(new THREE.Vector3(tg.x, 0, tg.z).normalize(), 0.03), y, tg, fall: true });
          falls.push({ x: mid.x, z: mid.z, top: prevS.y, bot: y, tg: tg.clone() });
        }
      }
      samples.push({ p, y, tg });
    }
    const P5 = [-1, -0.5, 0, 0.5, 1];
    const shallow = C('#a5e4e2'), deep = C('#3aa3c4');
    const rp = [], ru = [], rc = [], ri = [];
    let len = 0;
    samples.forEach((s, q) => {
      if (q > 0) len += Math.hypot(s.p.x - samples[q - 1].p.x, s.y - samples[q - 1].y, s.p.z - samples[q - 1].p.z);
      const side = new THREE.Vector3(-s.tg.z, 0, s.tg.x).normalize();
      const w = 0.36;
      for (const kk of P5) {
        rp.push(s.p.x + side.x * w * kk, s.y, s.p.z + side.z * w * kk);
        ru.push((kk + 1) / 2, len);
        const c = shallow.clone().lerp(deep, 1 - Math.abs(kk));
        rc.push(c.r, c.g, c.b, s.fall ? 0.95 : 1);
      }
    });
    for (let q = 0; q < samples.length - 1; q++) for (let kk = 0; kk < 4; kk++) { const a = q * 5 + kk, b = a + 1, c = a + 5, d = c + 1; ri.push(a, b, c, b, d, c); }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(ru, 2));
    rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 4));
    rg.setIndex(ri); rg.computeVertexNormals();
    const rm = new THREE.Mesh(rg, matRiver); rm.receiveShadow = true; rm.renderOrder = 1;
    group.add(rm);
  }

  // ---------------- 海
  const S = 72, segs = 144;
  const sg = new THREE.PlaneGeometry(S, S, segs, segs).rotateX(-Math.PI / 2);
  {
    const p = sg.attributes.position, c = new Float32Array(p.count * 3);
    const sh = C('#7fd6cf'), mid = C('#3fa6be'), dp = C('#2a6f9e');
    for (let q = 0; q < p.count; q++) {
      const i = T.ci(p.getX(q)), j = T.ci(p.getZ(q));
      let d = 6;
      if (T.inb(i, j)) d = kind[i][j] === SEA ? T.seaDist[i][j] : 0.5;
      const cl = sh.clone().lerp(mid, smooth(0.5, 3, d)).lerp(dp, smooth(3, 9, d));
      c[q * 3] = cl.r; c[q * 3 + 1] = cl.g; c[q * 3 + 2] = cl.b;
    }
    sg.setAttribute('color', new THREE.BufferAttribute(c, 3));
  }
  const matSea = enhance(new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.86, roughness: 0.14, metalness: 0.1, depthWrite: false }), { waves: true });
  const sea = new THREE.Mesh(sg, matSea); sea.position.y = -0.1; sea.receiveShadow = true; sea.renderOrder = 0;
  group.add(sea);
  // 岸邊浪花
  const foam = [];
  for (let i = 0; i < MM; i++) for (let j = 0; j < MM; j++) {
    if (kind[i][j] !== SEA) continue;
    for (const [di, dj] of DIRS) {
      const a = i + di, b = j + dj;
      if (!T.inb(a, b) || kind[a][b] === SEA) continue;
      const g2 = new THREE.PlaneGeometry(dj !== 0 ? 1.04 : 0.2, dj !== 0 ? 0.2 : 1.04).rotateX(-Math.PI / 2);
      g2.translate(T.wx(i) + di * 0.4, -0.085, T.wz(j) + dj * 0.4);
      foam.push(g2);
    }
  }
  const matFoam = enhance(new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false }), { cloud: false });
  if (foam.length) { const fm = new THREE.Mesh(merge(foam), matFoam); fm.renderOrder = 2; group.add(fm); }

  return { group, texRiver, matRiver, matSea, matFoam, falls };
}
function rbx2(w, h, d) { return new THREE.BoxGeometry(w, h, d, 1, 1, 1); }
