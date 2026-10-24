// 畫面：白模城市、人物、石頭、拋物線預覽、第一人稱的手。只讀模擬狀態，不改它。
import * as THREE from 'three';
import { CFG, TEAMS } from './config.js';
import { forward, raycast, simulateArc, throwOrigin } from './physics.js';
import { buildCity } from './facade.js';
import { WEAPONS, chargeSpeedW } from './weapons.js';
import { CAT_COLS, RIFLE_MUZZLE, armGroup, crystalModel, bladeMeshes, boomGeo, catModel, catballGeo, grenadeGeo, hiltGeo, magGeo, merge as mergeColored, rifleGeo, scorchTexture, slashTexture, vcMat } from './arms.js';

const SKY = 0xeef0f2;
const INK = 0x2d2f34;

export class Renderer {
  constructor(parent, map) {
    this.map = map;
    // 手機不要求高效能 GPU 模式（省電、比較不燙）
    const r = (this.gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: matchMedia('(pointer: coarse)').matches ? 'default' : 'high-performance' }));
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;   // 陰影不每格重算（見 frame 末尾），省下一整趟城市的繪製
    this.shadowF = 0; this.shadowAt = { x: 1e9, z: 1e9 };
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.autoClear = false;
    parent.appendChild(r.domElement);
    this.canvas = r.domElement;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    // 米克諾斯看得到海，霧放遠一點；台北巷子窄，近一點比較有空氣感
    this.scene.fog = map.data.style === 'taipei' ? new THREE.Fog(SKY, 22, 150) : new THREE.Fog(SKY, 30, 200);
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.05, 500);
    this.camera.rotation.order = 'YXZ';

    this._lights();
    this._sky();
    this._city();
    this._ground();
    this._landmarks();
    this._sea();
    this._weaponsInit();
    this._handInit();
    this._fxInit();

    this.chars = new Map();     // 玩家 id → 人物
    this.trails = new Map();     // 飛行中石頭 id → 最近幾個位置
    this.stoneGeo = new THREE.IcosahedronGeometry(CFG.STONE_R, 0);
    this.stoneMat = new THREE.MeshLambertMaterial({ color: 0x86898f, flatShading: true });
    this._rocks();
    this._arcInit();
    this.shake = 0;
    this.bob = 0;
    this.resize();
  }

  // 畫質等級：0 最好。掉幀時由 main.js 往下調。省電模式再壓：解析度最多 1.25 倍、陰影貼圖 1024、近處細節範圍縮小
  setQuality(q, power = this.power) {
    const Q = [[2, 2048, 66], [1.6, 2048, 60], [1.3, 1024, 50], [1, 1024, 40]][Math.max(0, Math.min(3, q))];
    this.quality = q; this.power = !!power;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q[0], power ? 1.25 : 2));
    const ms = power ? Math.min(1024, Q[1]) : Q[1];
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      this.gl.shadowMap.needsUpdate = true;
    }
    this.fineDist = power ? Q[2] - 14 : Q[2];
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.gl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCam.aspect = w / h;
    this.handCam.updateProjectionMatrix();
  }

  // ---------- 場景 ----------
  _lights() {
    this.scene.add(new THREE.HemisphereLight(0xf7f9ff, 0xcdc8c0, 2.7));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff2df, 1.5));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const c = sun.shadow.camera;
    c.left = -42; c.right = 42; c.top = 42; c.bottom = -42; c.near = 1; c.far = 170;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.035;
    this.sunOfs = new THREE.Vector3(-34, 62, 26);
    this.scene.add(sun, sun.target);
  }

  _sky() {
    const g = new THREE.SphereGeometry(400, 24, 12);
    const m = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color(0xdfe5ec) }, mid: { value: new THREE.Color(SKY) } },
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; varying vec3 vP; void main(){ float h = clamp(normalize(vP).y, 0.0, 1.0); gl_FragColor = vec4(mix(mid, top, pow(h, 0.6)), 1.0); }',
    });
    this.skyMesh = new THREE.Mesh(g, m);
    this.skyMesh.renderOrder = -1;
    this.scene.add(this.skyMesh);
  }

  // 建物：facade.js 產生的白模（主體、會投影的細節、不投影的小細節、鐵窗），依 32 m 分塊
  _city() {
    const { chunks, lines, wires } = buildCity(this.map);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const gMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: grilleTexture(), alphaTest: 0.5, side: THREE.DoubleSide });
    this.chunks = [];
    this.tris = 0;
    for (const c of chunks) {
      for (const pg of c.polys) {   // 屋頂與女兒牆頂（有洞的多邊形）
        const contour = pg.ring.map(([x, z]) => new THREE.Vector2(x, z));
        const holes = pg.holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
        const all = [...pg.ring, ...pg.holes.flat()];
        let faces = [];
        try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { faces = []; }
        for (const [i, j, k] of faces) c.body.tri([all[i][0], pg.y, all[i][1]], [all[j][0], pg.y, all[j][1]], [all[k][0], pg.y, all[k][1]], [0, 1, 0], pg.k, pg.k, pg.k);
      }
      const mk = (buf, m, cast) => {
        if (!buf.tris) return null;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(buf.p, 3));
        g.setAttribute('normal', new THREE.Float32BufferAttribute(buf.n, 3));
        g.setAttribute('color', new THREE.Float32BufferAttribute(buf.c, 3));
        if (buf.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, m);
        mesh.castShadow = cast; mesh.receiveShadow = true;
        this.scene.add(mesh);
        this.tris += buf.tris;
        return mesh;
      };
      for (const k of ['p', 'n', 'c']) for (const v of c.cast[k]) c.body[k].push(v);   // 主體與大件同材質、都投影：併成一個網格
      this.chunks.push({ cx: c.cx, cz: c.cz, body: mk(c.body, mat, true), fine: mk(c.fine, mat, false), grille: mk(c.grille, gMat, false) });
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
    this.scene.add(new THREE.LineSegments(eg, new THREE.LineBasicMaterial({ color: 0x9aa0a8, transparent: true, opacity: 0.6 })));
    if (wires.length) {   // 台北巷子上空的電線
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
      this.scene.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0x4a4e56, transparent: true, opacity: 0.75 })));
    }
  }

  // 遠方地標（不吃霧、用自發光混一半天空色假裝空氣透視）：米克諾斯的風車、台北的 101
  _landmarks() {
    const data = this.map.data, W = new THREE.Color(0xffffff);
    const parts = [];
    if (data.style === 'taipei') {
      const o = data.origin, k = Math.cos((o.lat * Math.PI) / 180);
      const dx = (121.56447 - o.lon) * 111320 * k, dz = -(25.03396 - o.lat) * 110540, D = Math.hypot(dx, dz);
      const R = 430, s = R / D, x = (dx / D) * R, z = (dz / D) * R;
      const seg = (rb, rt, h, y) => parts.push([new THREE.CylinderGeometry(rt * s, rb * s, h * s, 4).rotateY(Math.PI / 4), [x, (y + h / 2) * s, z], W]);
      seg(80, 74, 30, 0);           // 裙樓
      seg(40, 33, 200, 0);          // 主塔下段（往上收）
      for (let i = 0; i < 8; i++) seg(31, 38, 32, 200 + i * 32);   // 八節「花瓣」（往上張開）
      seg(26, 22, 30, 456);         // 頂部
      parts.push([new THREE.CylinderGeometry(1.5 * s, 4 * s, 60 * s, 8), [x, (486 + 30) * s, z], W]);   // 塔尖
    } else {
      for (const m of data.landmarks || []) {
        if (m.type !== 'windmill') continue;
        const base = m.z > 100 ? 9 : 4;     // Kato Mili 在海邊的小坡上
        const face = Math.atan2(-(m.x + 40), -(m.z - 60));   // 帆朝向城裡
        parts.push([new THREE.CylinderGeometry(2.5, 2.9, 7.2, 20), [m.x, base + 3.6, m.z], W]);
        parts.push([new THREE.ConeGeometry(2.75, 2.4, 20), [m.x, base + 7.2 + 1.2, m.z], W]);
        const hx = m.x + Math.sin(face) * 3.1, hz = m.z + Math.cos(face) * 3.1;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          const spoke = new THREE.BoxGeometry(0.16, 6.2, 0.16).translate(0, 3.1, 0).rotateZ(a).rotateY(face);
          parts.push([spoke, [hx, base + 6.6, hz], W]);
          const sail = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.6, 0), new THREE.Vector3(0, 6, 0), new THREE.Vector3(1.6, 4.2, 0)]);
          sail.setIndex([0, 1, 2, 0, 2, 1]); sail.computeVertexNormals();
          parts.push([sail.rotateZ(a).rotateY(face), [hx, base + 6.6, hz], new THREE.Color(0xe8e8e6)]);
        }
      }
      const km = (data.landmarks || []).filter((m) => m.z > 100);
      if (km.length) {
        const cx = km.reduce((a, m) => a + m.x, 0) / km.length, cz = km.reduce((a, m) => a + m.z, 0) / km.length;
        parts.push([new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2).scale(70, 11, 24), [cx, -1.5, cz], new THREE.Color(0xf0eee9)]);
      }
    }
    if (!parts.length) return;
    // 霧中剪影：本身打光只佔一小部分、其餘是天空色，比天空略暗一點才看得出輪廓
    const haze = new THREE.Color(SKY).multiplyScalar(0.62);
    const m = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ color: 0x5c6068, vertexColors: true, emissive: haze, fog: false }));
    this.scene.add(m);
  }

  // 海：OSM 海岸線切出來的海面，淡淡的愛琴藍＋慢慢流動的波紋
  _sea() {
    const seas = this.map.data.sea || [];
    if (!seas.length) return;
    const pos = [];
    for (const flat of seas) {
      const ring = [];
      for (let i = 0; i < flat.length; i += 2) ring.push(new THREE.Vector2(flat[i], flat[i + 1]));
      const faces = THREE.ShapeUtils.triangulateShape(ring, []);
      for (let [i, j, k] of faces) {
        // 從上往下看要逆時針（法線朝上），否則會被背面剔除
        const ax = ring[j].x - ring[i].x, az = ring[j].y - ring[i].y, bx = ring[k].x - ring[i].x, bz = ring[k].y - ring[i].y;
        if (az * bx - ax * bz < 0) [j, k] = [k, j];
        for (const n of [i, j, k]) pos.push(ring[n].x, 0.04, ring[n].y);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const uv = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / 9, pos[i + 2] / 9);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.computeVertexNormals();
    // 波紋貼圖：幾道斷斷續續的亮線
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#b3c9da'; c.fillRect(0, 0, 256, 256);
    let sd = 3; const rnd = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 256, y = rnd() * 256, w = 12 + rnd() * 40;
      c.strokeStyle = `rgba(255,255,255,${0.25 + rnd() * 0.35})`; c.lineWidth = 1 + rnd() * 1.5;
      c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + w / 2, y - 2, x + w, y); c.stroke();
      c.beginPath(); c.moveTo(x - 256, y); c.quadraticCurveTo(x - 256 + w / 2, y - 2, x - 256 + w, y); c.stroke();
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    this.seaTex = t;
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, color: 0xffffff }));
    m.receiveShadow = true;
    this.scene.add(m);
  }

  // 遠處區塊只畫主體與大件，近處才畫窗框、鐵窗這些小細節
  _lod(x, z) {
    for (const c of this.chunks) {
      const d = Math.hypot(c.cx - x, c.cz - z);
      const fd = this.fineDist || 66;
      if (c.fine) c.fine.visible = d < fd;
      if (c.grille) c.grille.visible = d < fd - 14;
    }
  }

  // 地面：把建物輪廓畫進貼圖再模糊，得到牆腳的接觸陰影
  _ground() {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const b of this.map.buildings) for (const [x, z] of b.pts) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    minX -= 10; minZ -= 10; maxX += 10; maxZ += 10;
    const S = 2; // px / m
    const W = Math.ceil((maxX - minX) * S), H = Math.ceil((maxZ - minZ) * S);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    for (const b of this.map.buildings) {
      ctx.beginPath();
      b.pts.forEach(([x, z], i) => { const px = (x - minX) * S, pz = (z - minZ) * S; i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz); });
      ctx.closePath(); ctx.fill();
    }
    const img = ctx.getImageData(0, 0, W, H);
    const occ = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) occ[i] = img.data[i * 4] / 255;
    const blur = boxBlur(boxBlur(boxBlur(occ, W, H, 2), W, H, 2), W, H, 2);
    // 可玩範圍邊界：地上一條淡淡的線
    const p = this.map.play;
    for (let i = 0; i < W * H; i++) {
      const x = (i % W) / S + minX, z = Math.floor(i / W) / S + minZ;
      let v = 1 - 0.36 * Math.min(1, blur[i] * 1.6);
      if (occ[i] > 0.5) v = 0.9;
      const out = x < p.minX || x > p.maxX || z < p.minZ || z > p.maxZ;
      const edge = Math.min(Math.abs(x - p.minX), Math.abs(x - p.maxX), Math.abs(z - p.minZ), Math.abs(z - p.maxZ));
      if (out) v *= 0.93;
      if (edge < 0.35 && !occ[i]) v *= 0.82;
      const c = Math.round(v * 255);
      img.data[i * 4] = c; img.data[i * 4 + 1] = c; img.data[i * 4 + 2] = c; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const ao = new THREE.CanvasTexture(cv);
    ao.anisotropy = 4;
    // 鋪面：米克諾斯是石灰勾白縫的石板、台北是柏油加伸縮縫；用重複貼圖，牆腳陰影走 aoMap
    const pave = paveTexture(this.map.data.style);
    pave.repeat.set((maxX - minX) / 4, (maxZ - minZ) / 4);
    pave.anisotropy = 8;
    const gm = new THREE.Mesh(new THREE.PlaneGeometry(maxX - minX, maxZ - minZ), new THREE.MeshLambertMaterial({ map: pave, aoMap: ao, aoMapIntensity: 1.25 }));
    gm.rotation.x = -Math.PI / 2;
    gm.position.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    gm.receiveShadow = true;
    this.scene.add(gm);
    const far = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshLambertMaterial({ color: 0xe9e8e4 }));
    far.rotation.x = -Math.PI / 2; far.position.y = -0.02;
    this.scene.add(far);
    // 範圍邊界的矮欄（看得出走不出去）
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const mk = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), wallMat); m.position.set(x, 0.225, z); m.castShadow = true; m.receiveShadow = true; this.scene.add(m); };
    const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2, w = p.maxX - p.minX, d = p.maxZ - p.minZ;
    mk(w, 0.2, cx, p.minZ - 0.1); mk(w, 0.2, cx, p.maxZ + 0.1); mk(0.2, d, p.minX - 0.1, cz); mk(0.2, d, p.maxX + 0.1, cz);
  }

  // 石頭全部用同一個 InstancedMesh（飛行中的、剛落地的），一次畫完
  _rocks() {
    this.rocks = new THREE.InstancedMesh(this.stoneGeo, this.stoneMat, 400);
    this.rocks.castShadow = true;
    this.rocks.frustumCulled = false;
    this.rocks.count = 0;
    this.scene.add(this.rocks);
    this._m4 = new THREE.Matrix4(); this._v3 = new THREE.Vector3(); this._s3 = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    // 石頭飛行的殘影線（一條 LineSegments，越舊越淡）
    const TN = 64 * 7;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 6), 3));
    tg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TN * 8), 4));
    this.trailLine = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
    this.trailLine.frustumCulled = false;
    this.scene.add(this.trailLine);
  }

  _rock(i, x, y, z, s, q) {
    this._v3.set(x, y, z); this._s3.set(s, s, s);
    this.rocks.setMatrixAt(i, this._m4.compose(this._v3, q, this._s3));
  }

  // ---------- 人物 ----------
  // 人物：軀幹、頭、頭巾、圍巾、頭髮併成一個網格（頂點色分深色／隊伍色），四肢各自一個關節
  _char(accent, weapon = 'stone') {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, transparent: true });
    const mats = [mat];
    const D = new THREE.Color(INK), A = new THREE.Color(accent), H = new THREE.Color(0x1d1e22), S = new THREE.Color(0xc9ad92);
    const torso = new THREE.CapsuleGeometry(0.23, 0.36, 6, 16).scale(1.08, 1, 0.78);
    const parts = [
      [torso, [0, 1.06, 0], D],
      [new THREE.CylinderGeometry(0.2, 0.22, 0.22, 16), [0, 0.74, 0], D.clone().multiplyScalar(0.8)],       // 褲頭
      [new THREE.CylinderGeometry(0.075, 0.09, 0.12, 12), [0, 1.43, 0], S],                                  // 脖子
      [new THREE.SphereGeometry(0.155, 20, 14), [0, CFG.HEAD_Y, 0], S],                                      // 臉
      [new THREE.SphereGeometry(0.162, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), [0, CFG.HEAD_Y + 0.01, 0.006], H], // 頭髮
      [new THREE.TorusGeometry(0.158, 0.03, 8, 28).rotateX(Math.PI / 2), [0, CFG.HEAD_Y + 0.045, 0], A],       // 頭巾
      [new THREE.CylinderGeometry(0.16, 0.2, 0.1, 16), [0, 1.38, 0], A],                                      // 圍巾
      [new THREE.BoxGeometry(0.05, 0.16, 0.03), [0.08, 1.24, 0.17], A],                                      // 圍巾垂下的一角
    ];
    // 一眼看出拿什麼：馴獸師戴貓耳、手榴彈兵腰上掛兩顆、步槍兵背帶
    if (weapon === 'cat') for (const x of [-0.085, 0.085]) parts.push([new THREE.ConeGeometry(0.05, 0.11, 4).rotateY(Math.PI / 4).rotateZ(x > 0 ? -0.35 : 0.35), [x, CFG.HEAD_Y + 0.15, 0.01], A]);
    if (weapon === 'grenade') for (const x of [-0.19, 0.19]) parts.push([new THREE.SphereGeometry(0.05, 10, 8).scale(1, 1.16, 1), [x, 0.8, 0.06], new THREE.Color(0x5f6a58)]);
    if (weapon === 'rifle') parts.push([new THREE.BoxGeometry(0.05, 0.62, 0.02).rotateZ(0.72), [0, 1.1, -0.185], D.clone().multiplyScalar(0.6)]);
    const body = new THREE.Mesh(mergeColored(parts), mat);
    body.castShadow = true;
    g.add(body);
    const limb = (r, len, x, y, col, shoe) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      const ps = [[new THREE.CapsuleGeometry(r, len - 2 * r, 4, 10), [0, -len / 2, 0], col]];
      if (shoe) ps.push([new THREE.BoxGeometry(0.13, 0.08, 0.24), [0, -len - 0.01, -0.04], shoe]);
      else ps.push([new THREE.SphereGeometry(r * 1.15, 10, 8), [0, -len - 0.02, 0], S]);   // 手
      const m = new THREE.Mesh(mergeColored(ps), mat);
      m.castShadow = true;
      pivot.add(m);
      g.add(pivot);
      return pivot;
    };
    const armL = limb(0.055, 0.56, -0.3, 1.36, D), armR = limb(0.055, 0.56, 0.3, 1.36, D);
    armR.rotation.order = 'YXZ';   // 先舉（x）再水平揮（y）：光劍橫掃用
    const legL = limb(0.075, 0.64, -0.11, 0.66, D.clone().multiplyScalar(0.85), H), legR = limb(0.075, 0.64, 0.11, 0.66, D.clone().multiplyScalar(0.85), H);
    // 手上的東西：石頭／手榴彈／貓球只在蓄力時拿出來；回力鏢在手上就看得到
    let held = null, rifle = null, saber = null;
    if (weapon === 'stone') { held = new THREE.Mesh(this.stoneGeo, this.stoneMat); held.scale.setScalar(1.2); }
    else if (weapon === 'grenade') { held = new THREE.Mesh(this.geo.grenade, this.vc); held.scale.setScalar(1.1); }
    else if (weapon === 'cat') { held = new THREE.Mesh(this.geo.cat[0], this.vc); held.scale.setScalar(0.75); }
    else if (weapon === 'boomerang') { held = new THREE.Mesh(this.geo.boom, this.vc); held.rotation.set(0.2, 0.5, 1.4); held.scale.setScalar(1.25); }
    if (held) { held.position.set(0, -0.62, 0); held.castShadow = true; armR.add(held); }
    if (weapon === 'rifle') {
      rifle = new THREE.Mesh(this.geo.rifle, this.vc);
      rifle.castShadow = true; rifle.scale.setScalar(1.15);
      g.add(rifle);
    }
    if (weapon === 'saber') {
      saber = new THREE.Group();
      const hilt = new THREE.Mesh(this.geo.hilt, this.vc);
      const { core, glow } = bladeMeshes(bladeColor(accent), 0.92);
      saber.add(hilt, core, glow);
      saber.position.set(0, -0.6, 0); saber.rotation.x = (-3 * Math.PI) / 4;   // 劍刃沿手臂往前下 45°
      armR.add(saber);
      saber.userData.glow = glow;
    }
    this.scene.add(g);
    return { g, mats, armL, armR, legL, legR, held, rifle, saber, weapon, phase: 0, flash: 0, fall: 0 };
  }

  // ---------- 第一人稱的手 ----------
  _handInit() {
    this.handScene = new THREE.Scene();
    this.handCam = new THREE.PerspectiveCamera(60, 1, 0.01, 10);
    this.handScene.add(new THREE.HemisphereLight(0xffffff, 0xbdb8b0, 2.2));
    const d = new THREE.DirectionalLight(0xffffff, 0.9); d.position.set(-1, 2, 1);
    this.handScene.add(d);
    const hand = (this.hand = new THREE.Group());
    const skin = new THREE.MeshLambertMaterial({ color: 0xd9bea2 });
    const cloth = new THREE.MeshLambertMaterial({ color: 0x34373d });
    // 前臂：圓柱袖子往右下方延伸出畫面，袖口一圈反摺
    const arm = new THREE.Group();
    arm.position.set(0.03, -0.045, 0.03);
    arm.rotation.set(0.42, -0.62, 0);
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.5, 4, 14), cloth);
    sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.3;
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.012, 8, 18), new THREE.MeshLambertMaterial({ color: 0x4a4e56 }));
    cuff.position.z = 0.05;
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 12), skin);
    wrist.rotation.x = Math.PI / 2; wrist.position.z = 0.015;
    arm.add(sleeve, cuff, wrist);
    // 手掌（壓扁的球）＋四根彎起來扣住石頭的手指＋拇指
    const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin);
    palm.scale.set(0.048, 0.026, 0.052);
    palm.position.set(0, -0.005, -0.03);
    // 石頭：不規則的低多邊形
    const rg = new THREE.DodecahedronGeometry(0.048, 0);
    const pa = rg.attributes.position;
    for (let i = 0; i < pa.count; i++) { const k = 0.85 + ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1 * 0.3; pa.setXYZ(i, pa.getX(i) * k, pa.getY(i) * k * 0.82, pa.getZ(i) * k); }
    rg.computeVertexNormals();
    this.handRock = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0x8b8e94, flatShading: true }));
    this.handRock.position.set(0.004, 0.036, -0.058);
    const fingers = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const fg = new THREE.Group();
      fg.position.set(-0.03 + i * 0.019, 0.01, -0.075);
      fg.rotation.x = -0.35;
      const p1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.03, 3, 8), skin);
      p1.rotation.x = -1.0; p1.position.set(0, 0.018, -0.012);
      const p2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0098, 0.022, 3, 8), skin);
      p2.rotation.x = 0.4; p2.position.set(0, 0.046, -0.006);
      fg.add(p1, p2);
      fg.scale.setScalar(i === 0 || i === 3 ? 0.92 : 1);
      fingers.add(fg);
    }
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 3, 8), skin);
    thumb.position.set(-0.05, 0.02, -0.035); thumb.rotation.set(0.2, 0.3, 0.9);
    this.handFingers = fingers;
    hand.add(arm, palm, this.handRock, fingers, thumb);
    // 其他拿在手掌上的東西（同一隻手、換掉石頭）
    this.handHeld = { stone: this.handRock };
    const vc = this.vc;
    const hg = new THREE.Mesh(this.geo.grenade, vc); hg.position.set(0.004, 0.05, -0.06); hg.rotation.set(0.2, 0.4, -0.25);
    const hc = new THREE.Mesh(this.geo.cat[0], vc); hc.scale.setScalar(0.62); hc.position.set(0.004, 0.062, -0.064); hc.rotation.set(0.15, 2.6, 0);
    const hb = new THREE.Mesh(this.geo.boom, vc); hb.scale.setScalar(0.62); hb.position.set(0.02, 0.03, -0.06); hb.rotation.set(0.5, 0.9, 1.2);
    this.handHeld.grenade = hg; this.handHeld.cat = hc; this.handHeld.boomerang = hb;
    hand.add(hg, hc, hb);
    hand.scale.setScalar(0.7);
    hand.position.set(0.27, -0.27, -0.55);
    this.handScene.add(hand);
    this.handT = { throwAt: -9 };
    const cuffMat = new THREE.MeshLambertMaterial({ color: 0x4a4e56 });

    // 步槍：右手握把、左手托護木；端槍時槍身移到畫面中下方
    const rifleG = (this.vmRifle = new THREE.Group());
    const rbody = new THREE.Mesh(this.geo.rifleNoMag, vc);
    this.vmMag = new THREE.Mesh(this.geo.mag, vc);
    // 袖子沿手臂局部 +z：右手往右下後方、左手從護木下方往左下後方
    const rh = armGroup(skin, cloth, cuffMat); rh.position.set(0, -0.03, 0.035); rh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0.55, -0.62, 0.56).normalize());
    const lh = armGroup(skin, cloth, cuffMat); lh.position.set(0, -0.012, -0.33); lh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(-0.5, -0.75, 0.45).normalize());
    this.vmFlash = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe7a8, transparent: true, depthWrite: false }));
    this.vmFlash.position.copy(RIFLE_MUZZLE); this.vmFlash.visible = false;
    rifleG.add(rbody, this.vmMag, rh, lh, this.vmFlash);
    rifleG.scale.setScalar(0.7);
    rifleG.position.set(0.17, -0.2, -0.36);
    rifleG.visible = false;
    this.handScene.add(rifleG);

    // 光劍：握在右手，劍刃發光
    const sg = (this.vmSaber = new THREE.Group());
    const hilt = new THREE.Mesh(this.geo.hilt, vc);
    sg.add(hilt);
    // 握劍的手臂不跟著劍轉：手腕跟著劍柄走，袖子永遠從畫面右下伸進來
    this.vmSaberArm = armGroup(skin, cloth, cuffMat);
    this.vmSaberArm.visible = false;
    this.handScene.add(this.vmSaberArm);
    this.vmBlade = null;
    sg.position.set(0.24, -0.26, -0.5);
    sg.visible = false;
    this.handScene.add(sg);
  }

  // 自己的光劍顏色（要先知道自己的顏色）
  setMyBlade(accent) {
    if (this.vmBlade) { for (const m of [this.vmBlade.core, this.vmBlade.glow]) { this.vmSaber.remove(m); m.geometry.dispose(); m.material.dispose(); } }
    this.vmBlade = bladeMeshes(bladeColor(accent), 0.62);
    this.vmSaber.add(this.vmBlade.core, this.vmBlade.glow);
  }

  _weaponsInit() {
    this.vc = vcMat();
    this.geo = { grenade: grenadeGeo(), boom: boomGeo(), cat: CAT_COLS.map((c) => catballGeo(c)), rifle: rifleGeo(), rifleNoMag: rifleGeo(false), mag: magGeo(), hilt: hiltGeo() };
    const pool = (n, mk, shadow = true) => Array.from({ length: n }, () => { const m = mk(); m.visible = false; m.castShadow = shadow; m.userData.t = 9; this.scene.add(m); return m; });
    // 飛行中的投射物（石頭以外）
    this.projPool = {
      grenade: pool(12, () => new THREE.Mesh(this.geo.grenade, this.vc)),
      boom: pool(8, () => new THREE.Mesh(this.geo.boom, this.vc)),
      catball: pool(10, () => new THREE.Mesh(this.geo.cat[0], this.vc)),
    };
    const led = new THREE.SphereGeometry(0.013, 6, 4), ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b30, fog: false });
    for (const m of this.projPool.grenade) { const l = new THREE.Mesh(led, ledMat); l.position.set(0, 0.1, 0); m.add(l); m.userData.led = l; }
    this.catModels = new Map();
    // 瞄準雷射：一條 LineSegments（每支端著的步槍一段）＋末端紅點與光暈
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 6), 3));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(16 * 8), 4));
    this.laser = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.laser.frustumCulled = false;
    this.scene.add(this.laser);
    const dotG = new THREE.SphereGeometry(1, 10, 8);
    this.laserDot = new THREE.InstancedMesh(dotG, new THREE.MeshBasicMaterial({ color: 0xff2d20, fog: false }), 16);
    this.laserHalo = new THREE.InstancedMesh(dotG, new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.28, depthWrite: false, fog: false }), 16);
    for (const m of [this.laserDot, this.laserHalo]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    // 特效池：曳光、閃光、衝擊波、焦痕、刀光、火花
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5);
    this.tracers = pool(12, () => new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xffa23a, transparent: true, depthWrite: false, fog: false })), false);
    const ball = new THREE.SphereGeometry(1, 16, 12);
    this.flashes = pool(10, () => new THREE.Mesh(ball, new THREE.MeshBasicMaterial({ color: 0xfff2c4, transparent: true, depthWrite: false, fog: false })), false);
    const ringG = new THREE.RingGeometry(0.86, 1, 56).rotateX(-Math.PI / 2);
    this.shocks = pool(4, () => new THREE.Mesh(ringG, new THREE.MeshBasicMaterial({ color: 0x7c828c, transparent: true, depthWrite: false, side: THREE.DoubleSide })), false);
    const sc = scorchTexture(), plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.scorches = pool(6, () => new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map: sc, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })), false);
    const half = (55 * Math.PI) / 180, slashG = new THREE.RingGeometry(0.45, 1.75, 30, 1, Math.PI / 2 - half, half * 2).rotateX(-Math.PI / 2), st = slashTexture();
    this.slashes = pool(6, () => new THREE.Mesh(slashG, new THREE.MeshBasicMaterial({ map: st, color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })), false);
    this.sparkP = [];
    this.sparkMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.028, 0), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), 140);
    this.sparkMesh.count = 0; this.sparkMesh.frustumCulled = false;
    this._sparkCol = new THREE.Color();
    for (let i = 0; i < 140; i++) this.sparkMesh.setColorAt(i, this._sparkCol.setHex(0xffc94a));
    this.scene.add(this.sparkMesh);
    // 手榴彈落點的爆炸範圍圈
    this.blastMark = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64), new THREE.MeshBasicMaterial({ color: 0xe0352b, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.blastFill = new THREE.Mesh(new THREE.CircleGeometry(0.95, 48), new THREE.MeshBasicMaterial({ color: 0xe0352b, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthTest: false, depthWrite: false, fog: false }));
    this.blastFill.renderOrder = 4; this.blastMark.renderOrder = 5;
    this.blastMark.visible = this.blastFill.visible = false;
    this.scene.add(this.blastMark, this.blastFill);
  }

  _next(pool) {
    let best = pool[0];
    for (const m of pool) { if (m.userData.t >= (m.userData.life || 0)) { best = m; break; } if (m.userData.t > best.userData.t) best = m; }
    best.userData.t = 0; best.visible = true;
    return best;
  }

  // ---------- 武器特效（main.js 依事件呼叫） ----------
  flash(x, y, z, size, color = 0xfff2c4, life = 0.12) {
    const m = this._next(this.flashes);
    m.position.set(x, y, z); m.material.color.setHex(color);
    Object.assign(m.userData, { life, size });
  }

  explode(x, y, z, r) {
    // 火球（橘→黃白兩層）＋往上翻的灰煙；白色世界裡要有顏色才看得出來
    this.flash(x, y + 0.25, z, r * 0.55, 0xffb14a, 0.26);
    this.flash(x, y + 0.3, z, r * 0.32, 0xfff1c9, 0.12);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.4, d = 0.2 + Math.random() * r * 0.35;
      this.puff(x + Math.cos(a) * d, y + 0.2 + Math.random() * 0.8, z + Math.sin(a) * d, 0.55 + Math.random() * 0.6, i % 3 === 0 ? 0x8f949c : i % 3 === 1 ? 0xa9adb4 : 0xc6c9ce, 1.0 + Math.random() * 0.8, 0.7 + Math.random() * 1.0);
    }
    this.chipBurst(x, y + 0.1, z, 0, 1, 0, 16);
    this.sparks(x, y + 0.3, z, 22, 7);
    const h = this.map.heightAt(x, z);
    if (y <= h + 0.4) {   // 地面或屋頂上才有衝擊波與焦痕（炸在牆上就沒有）
      const sk = this._next(this.shocks);
      sk.position.set(x, h + 0.03, z); Object.assign(sk.userData, { life: 0.5, r });
      const sc = this._next(this.scorches);
      sc.position.set(x, h + 0.012, z); sc.rotation.y = Math.random() * 6; sc.scale.setScalar(r * 1.25); Object.assign(sc.userData, { life: 10 });
    }
  }

  // 曳光：一段 5 m 長的亮橘色光條從槍口飛到命中點（自己開槍的槍口火光由手上的槍畫）
  tracer(x0, y0, z0, x1, y1, z1, own = false) {
    const m = this._next(this.tracers);
    m.position.set(x0, y0, z0);
    m.lookAt(x1, y1, z1);
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    Object.assign(m.userData, { life: Math.min(0.14, 0.05 + len / 400), len, x0, y0, z0, dx: (x1 - x0) / (len || 1), dy: (y1 - y0) / (len || 1), dz: (z1 - z0) / (len || 1) });
    if (!own) this.flash(x0, y0, z0, 0.09, 0xffc25a, 0.06);
  }

  slash(x, z, yaw, accent) {
    const m = this._next(this.slashes);
    m.position.set(x, 1.3, z);
    m.material.color.set(bladeColor(accent));
    Object.assign(m.userData, { life: 0.22, yaw });
  }

  sparks(x, y, z, n = 10, sp = 4, color = 0xffc94a, life = 0.22, size = 1) {
    for (let i = 0; i < n; i++) {
      if (this.sparkP.length >= 140) this.sparkP.shift();
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, v = sp * (0.4 + Math.random() * 0.8), r = Math.sqrt(1 - u * u);
      this.sparkP.push({ x, y, z, vx: Math.cos(a) * r * v, vy: u * v + 1.5, vz: Math.sin(a) * r * v, t: 0, life: life + Math.random() * 0.25, color, size });
    }
  }

  // ---------- 水晶戰 ----------
  _crystals(sim, now, dt) {
    const list = sim.crystals || [];
    if (!list.length) return;
    if (!this.crystalObjs) {
      this.crystalObjs = list.map((c) => {
        const m = crystalModel(TEAMS[c.team].hex);
        m.g.position.set(c.x, 0, c.z);
        this.scene.add(m.g);
        return m;
      });
    }
    list.forEach((c, i) => {
      const m = this.crystalObjs[i], k = Math.max(0, c.hp / c.max), alive = c.hp > 0;
      m.gem.visible = m.core.visible = alive;
      m.shards.forEach((s) => (s.visible = alive));
      if (!alive) { m.beam.material.opacity *= 0.9; m.ring.material.opacity = 0.2; return; }
      const low = k < 0.3;
      m.flash = Math.max(0, m.flash - dt * 6);
      const bob = Math.sin(now * 1.6 + i) * 0.07;
      m.gem.position.y = m.core.position.y = 1.75 + bob;
      m.gem.rotation.y += dt * (0.5 + (1 - k) * 1.5);
      m.core.rotation.y -= dt * 0.8;
      // 越殘越暗、越抖；被打到時整顆閃白
      const pulse = low ? 0.5 + 0.5 * Math.sin(now * 12) : 1;
      m.gem.material.emissive.copy(m.col).multiplyScalar(0.18 + 0.22 * k * pulse).lerp(this._white ||= new THREE.Color(0xffffff), m.flash * 0.8);
      m.gem.material.opacity = 0.62 + 0.3 * k;
      m.gem.scale.setScalar(0.88 + 0.12 * k);
      m.beam.material.opacity = (0.05 + 0.13 * k) * (low ? 0.6 + 0.4 * Math.sin(now * 9) : 1);
      m.ring.material.opacity = now - c.lastHit < 1 ? 0.5 + 0.4 * Math.sin(now * 20) : 0.45;
      m.shards.forEach((s, j) => {
        const a = now * (0.9 + (1 - k) * 2) + (j * Math.PI * 2) / 3;
        s.position.set(Math.cos(a) * 0.95, 1.6 + Math.sin(now * 2 + j) * 0.25 + bob, Math.sin(a) * 0.95);
        s.rotation.set(a, a * 1.3, 0);
      });
    });
  }

  crystalHit(team, x, y, z) {
    const m = this.crystalObjs && this.crystalObjs[team];
    if (m) m.flash = 1;
    this.sparks(x, y, z, 7, 3.5, TEAMS[team].hex, 0.35, 1.6);
    this.flash(x, y, z, 0.25, 0xffffff, 0.08);
  }

  crystalBreak(team, x, z) {
    const hex = TEAMS[team].hex;
    this.flash(x, 1.8, z, 2.6, hex, 0.35);
    this.flash(x, 1.8, z, 1.4, 0xffffff, 0.18);
    this.sparks(x, 1.8, z, 60, 9, hex, 0.8, 2.6);
    for (let i = 0; i < 8; i++) this.puff(x + (Math.random() - 0.5) * 2, 1 + Math.random() * 1.5, z + (Math.random() - 0.5) * 2, 0.7 + Math.random() * 0.5, 0xe9edf5, 1.2, 1.2);
    const sk = this._next(this.shocks);
    sk.position.set(x, 0.03, z); Object.assign(sk.userData, { life: 0.8, r: 7 });
  }

  _fxInit() {
    this.puffs = [];
    const geo = new THREE.SphereGeometry(1, 8, 6);
    for (let i = 0; i < 36; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xd9dadc, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      this.scene.add(m);
      this.puffs.push({ m, t: 1, life: 0.3, size: 0.3, rise: 0 });
    }
    this.puffI = 0;
    // 碎石：撞到牆或地面時噴出的小碎片（一個 InstancedMesh）
    this.chips = [];
    this.chipMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.03, 0), new THREE.MeshLambertMaterial({ color: 0x9a9da3, flatShading: true }), 160);
    this.chipMesh.count = 0;
    this.chipMesh.frustumCulled = false;
    this.scene.add(this.chipMesh);
    this.kick = 0;
    this.fovNow = 60;
  }

  // 碎片：從撞擊點往法線那一側噴
  chipBurst(x, y, z, nx = 0, ny = 1, nz = 0, n = 6, light = false) {
    for (let i = 0; i < n; i++) {
      if (this.chips.length >= 160) this.chips.shift();
      const sp = 1.5 + Math.random() * 2.5;
      this.chips.push({
        x, y, z, t: 0, life: 0.5 + Math.random() * 0.4, s: 0.6 + Math.random() * 0.9, light,
        vx: (nx + (Math.random() - 0.5) * 1.4) * sp, vy: (ny * 0.8 + Math.random() * 0.9) * sp, vz: (nz + (Math.random() - 0.5) * 1.4) * sp,
        rx: Math.random() * 6, ry: Math.random() * 6,
      });
    }
  }

  puff(x, y, z, size = 0.3, color = 0xd9dadc, life = 0.3, rise = 0) {
    const p = this.puffs[this.puffI++ % this.puffs.length];
    p.m.position.set(x, y, z); p.t = 0; p.size = size; p.life = life; p.rise = rise; p.m.visible = true;
    p.m.material.color.setHex(color);
  }

  _arcInit() {
    const N = 400;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    g.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(N), 1));
    this.arcLine = new THREE.Line(g, new THREE.LineDashedMaterial({ color: 0x2d2f34, dashSize: 0.32, gapSize: 0.22, transparent: true, opacity: 0.6, fog: false }));
    this.arcLine.frustumCulled = false;
    this.arcLine.visible = false;
    this.scene.add(this.arcLine);
    this.arcMark = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), new THREE.MeshBasicMaterial({ color: 0x2d2f34, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthTest: false, fog: false }));
    this.arcMark.renderOrder = 5;
    this.arcMark.visible = false;
    this.scene.add(this.arcMark);
  }

  // ---------- 每格 ----------
  // view = { yaw, pitch }；alpha 是兩個 tick 之間的插值比例
  frame(sim, me, view, alpha, dt, opts = {}) {
    const now = sim.time;
    // 人物
    const seen = new Set();
    for (const p of sim.players) {
      seen.add(p.id);
      if (p === me) continue;
      let c = this.chars.get(p.id);
      if (!c) { c = this._char(p.accent, p.weapon); this.chars.set(p.id, c); }
      this._animChar(c, p, alpha, dt, now);
    }
    for (const [id, c] of this.chars) if (!seen.has(id)) { this.scene.remove(c.g); this.chars.delete(id); }

    // 石頭（飛行中的、剛落地的）全部填進同一個 InstancedMesh
    let ri = 0;
    const live = new Set();
    const tp = this.trailLine.geometry.attributes.position, tc = this.trailLine.geometry.attributes.color;
    let ti = 0;
    const used = { grenade: 0, boom: 0, catball: 0 };
    for (const s of sim.stones) {
      const a = s.rest ? 1 : alpha;
      const lx = s.lx ?? s.x, ly = s.ly ?? s.y, lz = s.lz ?? s.z;
      const x = lx + (s.x - lx) * a, y = ly + (s.y - ly) * a, z = lz + (s.z - lz) * a;
      const kind = s.kind || 'stone';
      if (kind === 'stone') {
        this._q.setFromEuler(this._e.set(now * 14 + s.id, now * 9, 0));
        if (ri < this.rocks.instanceMatrix.count) this._rock(ri++, x, y, z, 1.15, this._q);
      } else {
        const m = this.projPool[kind] && this.projPool[kind][used[kind]++];
        if (m) {
          m.visible = true; m.position.set(x, y, z);
          if (kind === 'boom') m.rotation.set(0, s.active ? now * 24 + s.id : s.id, 0);
          else if (kind === 'grenade') { m.rotation.set(now * 8 + s.id, now * 5, 0); m.userData.led.visible = (now * 5) % 1 < 0.5; }
          else { m.geometry = this.geo.cat[s.owner % CAT_COLS.length]; m.rotation.set(now * 10 + s.id, now * 3, 0); }
        }
      }
      if (s.rest || !s.active) { this.trails.delete(s.id); continue; }
      live.add(s.id);
      let tr = this.trails.get(s.id);
      if (!tr) { tr = []; this.trails.set(s.id, tr); }
      tr.unshift([x, y, z]);
      if (tr.length > 8) tr.length = 8;
      for (let k = 0; k + 1 < tr.length && ti < tp.count / 2; k++, ti++) {
        tp.setXYZ(ti * 2, ...tr[k]); tp.setXYZ(ti * 2 + 1, ...tr[k + 1]);
        const al = 0.55 * (1 - k / 7), al2 = 0.55 * (1 - (k + 1) / 7);
        tc.setXYZW(ti * 2, 0.25, 0.27, 0.3, al); tc.setXYZW(ti * 2 + 1, 0.25, 0.27, 0.3, al2);
      }
    }
    for (const k in this.projPool) for (let i = used[k]; i < this.projPool[k].length; i++) this.projPool[k][i].visible = false;
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
    this._cats(sim, alpha, dt, now);
    this.trailLine.geometry.setDrawRange(0, ti * 2);
    tp.needsUpdate = true; tc.needsUpdate = true;
    this.rocks.count = ri;
    this.rocks.instanceMatrix.needsUpdate = true;

    // 碎片
    let ci = 0;
    for (const c of this.chips) {
      c.t += dt;
      if (c.t > c.life) continue;
      c.vy -= 9.8 * dt;
      c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
      if (c.y < 0.015) { c.y = 0.015; c.vy *= -0.3; c.vx *= 0.6; c.vz *= 0.6; }
      c.rx += dt * 9; c.ry += dt * 7;
      const k = c.s * (c.t > c.life - 0.15 ? (c.life - c.t) / 0.15 : 1);
      this._q.setFromEuler(this._e.set(c.rx, c.ry, 0));
      this._v3.set(c.x, c.y, c.z); this._s3.set(k, k, k);
      this.chipMesh.setMatrixAt(ci++, this._m4.compose(this._v3, this._q, this._s3));
    }
    this.chips = this.chips.filter((c) => c.t <= c.life);
    this.chipMesh.count = ci;
    this.chipMesh.instanceMatrix.needsUpdate = true;

    // 煙塵
    for (const p of this.puffs) {
      if (p.t >= 1) continue;
      p.t += dt / p.life;
      const s = p.size * (0.4 + p.t);
      p.m.scale.setScalar(s);
      p.m.position.y += p.rise * dt * (1 - p.t);
      p.m.material.opacity = 0.55 * (1 - p.t) ** (p.life > 0.5 ? 1.6 : 1);
      if (p.t >= 1) p.m.visible = false;
    }
    this._stepFx(dt);

    // 相機
    const cam = this.camera;
    let ex, ez;
    if (me.alive) {
      ex = me.px + (me.x - me.px) * alpha; ez = me.pz + (me.z - me.pz) * alpha;
      this.bob += Math.min(me.speed, 6) * dt * 2.1;
      const bobA = Math.min(1, me.speed / CFG.SPEED) * 0.035;
      cam.position.set(ex, CFG.EYE + Math.sin(this.bob * 2) * bobA, ez);
      cam.rotation.set(view.pitch + this.kick * 0.035, view.yaw, 0);
      this.kick = Math.max(0, this.kick - dt * 6);
      // 蓄力時鏡頭慢慢拉近（看遠一點比較好瞄）；步槍端得越穩拉越近；光劍衝刺時往外推
      const MW = WEAPONS[me.weapon] || WEAPONS.stone;
      const zoom = { rifle: 18, saber: 0, boomerang: 4 }[MW.key] ?? 7;
      let fov = me.aiming ? 60 - zoom * me.charge ** 1.4 : 60;
      if (MW.kind === 'melee' && now - (me.lungeAt ?? -9) < MW.lungeTime + 0.05) fov = 70;
      this.fovNow += (fov - this.fovNow) * Math.min(1, dt * 8);
      if (Math.abs(cam.fov - this.fovNow) > 0.01) { cam.fov = this.fovNow; cam.updateProjectionMatrix(); }
      this.deathCam = null;
    } else {
      // 陣亡：從上方看著擊倒你的人
      const k = sim.byId(me.killedBy);
      if (!this.deathCam) this.deathCam = { t: 0, x: me.x, z: me.z };
      this.deathCam.t += dt;
      const t = Math.min(1, this.deathCam.t / 1.2), e = 1 - (1 - t) ** 3;
      ex = me.x; ez = me.z;
      cam.position.set(me.x, CFG.EYE + e * 4.5, me.z);
      if (k && k.alive) {
        const tgt = new THREE.Vector3(k.x, 1.2, k.z);
        const m = new THREE.Matrix4().lookAt(cam.position, tgt, new THREE.Vector3(0, 1, 0));
        const q = new THREE.Quaternion().setFromRotationMatrix(m);
        cam.quaternion.slerp(q, Math.min(1, dt * 4));
      }
    }
    // 開場：從選單的空中視角，先平移到出生點正上方再垂直降進巷子
    if (opts.intro != null && opts.intro < 1 && this.introStart) {
      const k = opts.intro, s = this.introStart;
      const e = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
      const kx = e(Math.min(1, k / 0.62)), ky = e(Math.max(0, (k - 0.3) / 0.7));
      const tx = cam.position.x, ty = cam.position.y, tz = cam.position.z;
      const high = Math.max(s.pos.y, 26);
      cam.position.set(s.pos.x + (tx - s.pos.x) * kx, high + (ty - high) * ky, s.pos.z + (tz - s.pos.z) * kx);
      if (k < 0.3) cam.position.y = s.pos.y + (high - s.pos.y) * e(k / 0.3);
      const q = cam.quaternion.clone();
      cam.quaternion.copy(s.quat).slerp(q, e(Math.min(1, k * 1.15)));
    }
    if (this.shake > 0) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.08;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.08;
      this.shake = Math.max(0, this.shake - dt * 3);
    }
    this.sun.target.position.set(ex, 0, ez);
    this.sun.position.copy(this.sun.target.position).add(this.sunOfs);
    this.skyMesh.position.copy(cam.position);
    this._lod(cam.position.x, cam.position.z);
    if (this.seaTex) this.seaTex.offset.set(now * 0.004, now * 0.011);

    this._lasers(sim, me, cam, now, opts.aim);
    this._crystals(sim, now, dt);

    // 拋物線預覽（回力鏢畫去程的彎）
    this.arcHit = null;
    const AW = WEAPONS[me.weapon] || WEAPONS.stone;
    this.blastMark.visible = this.blastFill.visible = false;
    if (me.alive && me.aiming && opts.showArc !== false && (AW.kind === 'arc' || AW.kind === 'boom')) {
      // 有準心落點解就照它畫（石頭真正會走的路）；沒有才照視線與蓄力
      const A = opts.aim && opts.aim.yaw != null ? opts.aim : null;
      let arc;
      if (AW.kind === 'boom') arc = this._boomPath(sim, me, ex, ez, A ? A.yaw : view.yaw, AW);
      else {
        const v = A && A.v ? A.v : chargeSpeedW(AW, me.charge);
        const o = throwOrigin(ex, ez, A ? A.yaw : view.yaw);
        const f = A && A.pitch != null ? forward(A.yaw, A.pitch) : forward(view.yaw, view.pitch);
        const foes = sim.mode === 'team' ? sim.players.filter((q) => q === me || q.team !== me.team) : sim.players;
        arc = simulateArc(this.map, o, { x: f.x * v, y: f.y * v, z: f.z * v }, { players: foes, ignoreId: me.id, every: 1 });
        // 預覽線碰到水晶就停在水晶上（模擬裡投射物也會撞到水晶）
        for (let i = 1; i < arc.pts.length; i++) {
          const q = arc.pts[i];
          const c = (sim.crystals || []).find((k) => k.hp > 0 && Math.hypot(q.x - k.x, q.z - k.z) < CFG.CRYSTAL_R && q.y < CFG.CRYSTAL_TOP);
          if (c) { arc.pts.length = i + 1; arc.hit = { type: c.team === me.team ? 'wall' : 'player', x: q.x, y: q.y, z: q.z, nx: 0, nz: 0 }; break; }
        }
      }
      const pa = this.arcLine.geometry.attributes.position, la = this.arcLine.geometry.attributes.lineDistance;
      const n = Math.min(arc.pts.length, pa.count);
      let dist = 0;
      for (let i = 0; i < n; i++) {
        const q = arc.pts[i];
        pa.setXYZ(i, q.x, q.y, q.z);
        if (i) { const r = arc.pts[i - 1]; dist += Math.hypot(q.x - r.x, q.y - r.y, q.z - r.z); }
        la.setX(i, dist);
      }
      pa.needsUpdate = true; la.needsUpdate = true;
      this.arcLine.geometry.setDrawRange(0, n);
      this.arcLine.visible = true;
      const hit = (this.arcHit = arc.hit);
      if (hit) {
        this.arcMark.visible = true;
        this.arcMark.position.set(hit.x, hit.y + 0.01, hit.z);
        const red = hit.type === 'player';
        this.arcMark.material.color.setHex(red ? 0xe0352b : 0x2d2f34);
        const md = Math.hypot(hit.x - cam.position.x, hit.y - cam.position.y, hit.z - cam.position.z);
        this.arcMark.scale.setScalar((red ? 1.4 : 1) * Math.max(0.35, Math.min(1, md / 7)));
        if (hit.type === 'wall' && (hit.nx || hit.nz)) {
          this.arcMark.rotation.set(0, Math.atan2(hit.nx, hit.nz), 0);
          this.arcMark.lookAt(hit.x + hit.nx, hit.y, hit.z + hit.nz);
        } else if (red || hit.type === 'wall' || hit.type === 'turn') {
          this.arcMark.lookAt(cam.position);
        } else {
          this.arcMark.rotation.set(-Math.PI / 2, 0, 0);
        }
        // 手榴彈：畫出爆炸範圍（落在人身上就畫在他腳下）
        if (AW.key === 'grenade') {
          const gy = hit.type === 'player' ? 0.03 : hit.type === 'wall' ? Math.max(0.03, this.map.heightAt(hit.x, hit.z) > hit.y ? 0.03 : hit.y) : hit.y + 0.02;
          for (const m of [this.blastMark, this.blastFill]) {
            m.visible = true; m.position.set(hit.x, gy, hit.z); m.rotation.set(-Math.PI / 2, 0, 0); m.scale.setScalar(AW.radius);
          }
        }
      } else this.arcMark.visible = false;
    } else {
      this.arcLine.visible = false;
      this.arcMark.visible = false;
    }

    // 手
    this._animHand(me, now, dt, opts.intro ?? 1);

    const gl = this.gl;
    // 陰影：一般每 2 格、省電每 3 格才重算一次；鏡頭（太陽跟著走）移動超過 1.5 m 也重算
    const st = this.sun.target.position;
    if (++this.shadowF % (this.power ? 3 : 2) === 0 || Math.hypot(st.x - this.shadowAt.x, st.z - this.shadowAt.z) > 1.5) {
      gl.shadowMap.needsUpdate = true; this.shadowAt.x = st.x; this.shadowAt.z = st.z;
    }
    gl.clear();
    gl.render(this.scene, cam);
    if (me.alive) {
      gl.clearDepth();
      gl.render(this.handScene, this.handCam);
    }
  }

  // 端著的步槍：雷射線＋紅點（被瞄的人看得到，是閃躲的提示）
  _lasers(sim, me, cam, now, aim) {
    let li = 0, di = 0;
    this.lasedFrom = [];
    const lp = this.laser.geometry.attributes.position, lc = this.laser.geometry.attributes.color;
    for (const p of sim.players) {
      if (li >= 16) break;
      if (!p.alive || !p.aiming || p.weapon !== 'rifle') continue;
      let o, hit;
      if (p === me) {
        if (!aim || !aim.hit) continue;
        hit = aim.hit;
        this._v3.set(0.05, -0.085, -0.55).applyQuaternion(cam.quaternion).add(cam.position);
        o = { x: this._v3.x, y: this._v3.y, z: this._v3.z };
      } else {
        const c = this.chars.get(p.id);
        const d = forward(p.yaw, p.pitch);
        const foes = sim.mode === 'team' ? sim.players.filter((q) => q === p || q.team !== p.team) : sim.players;   // 隊友的雷射穿過自己人
        hit = raycast(this.map, p.x, CFG.EYE, p.z, d, foes, p.id, 70);
        const gx = c ? c.g.position.x : p.x, gz = c ? c.g.position.z : p.z;
        o = { x: gx + d.x * 0.95 + Math.cos(p.yaw) * 0.15, y: 1.48 + d.y * 0.95, z: gz + d.z * 0.95 - Math.sin(p.yaw) * 0.15 };
      }
      const k = 0.4 + 0.5 * p.charge;
      lp.setXYZ(li * 2, o.x, o.y, o.z); lp.setXYZ(li * 2 + 1, hit.x, hit.y, hit.z);
      lc.setXYZW(li * 2, 1, 0.24, 0.2, k * 0.25); lc.setXYZW(li * 2 + 1, 1, 0.24, 0.2, k);
      li++;
      // 紅點打在自己身上：不畫（會蓋滿畫面），改成 HUD 在畫面邊緣提示方向
      if (hit.player && hit.player === me) { this.lasedFrom.push({ x: p.x, z: p.z }); continue; }
      const md = Math.hypot(hit.x - cam.position.x, hit.y - cam.position.y, hit.z - cam.position.z);
      const ds = Math.max(0.018, md * 0.0035);
      this._q.identity(); this._v3.set(hit.x, hit.y, hit.z);
      this._s3.setScalar(ds); this.laserDot.setMatrixAt(di, this._m4.compose(this._v3, this._q, this._s3));
      this._s3.setScalar(ds * (2.4 + 0.5 * Math.sin(now * 28 + li))); this.laserHalo.setMatrixAt(di, this._m4.compose(this._v3, this._q, this._s3));
      di++;
    }
    this.laser.geometry.setDrawRange(0, li * 2);
    lp.needsUpdate = lc.needsUpdate = true;
    this.laserDot.count = this.laserHalo.count = di;
    this.laserDot.instanceMatrix.needsUpdate = this.laserHalo.instanceMatrix.needsUpdate = true;
  }

  // 回力鏢去程（跟 sim._stepBoom 同一條曲線），撞牆就停在那裡
  _boomPath(sim, me, ex, ez, yaw, W) {
    const o = throwOrigin(ex, ez, yaw);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const pts = [{ x: o.x, y: o.y, z: o.z }];
    let hit = null, prev = pts[0];
    for (let d = 0.3; d <= W.range + 1e-6; d += 0.3) {
      const bend = Math.sin(Math.PI * Math.min(1, d / W.range)) * 2.4;
      const q = { x: o.x + fx * d + rx * bend, y: o.y - 0.25 * (d / W.range), z: o.z + fz * d + rz * bend };
      if (!this.map.inGrid(q.x, q.z) || this.map.heightAt(q.x, q.z) > q.y) { hit = { type: 'wall', x: prev.x, y: prev.y, z: prev.z, nx: 0, nz: 0 }; break; }
      if (!hit) for (const p of sim.players) {
        if (!p.alive || p.id === me.id) continue;
        if (Math.hypot(p.x - q.x, p.z - q.z) < 0.45 && q.y < 1.9) { hit = { type: 'player', x: q.x, y: q.y, z: q.z }; break; }
      }
      pts.push(q); prev = q;
      if (hit && hit.type === 'player') { /* 會穿過去：線繼續畫，記號標在第一個人 */ }
    }
    if (!hit) hit = { type: 'turn', x: prev.x, y: prev.y, z: prev.z };
    return { pts, hit };
  }

  _cats(sim, alpha, dt, now) {
    const seen = new Set();
    for (const c of sim.cats || []) {
      seen.add(c.id);
      let m = this.catModels.get(c.id);
      if (!m) {
        const o = sim.byId(c.owner);
        m = catModel(CAT_COLS[c.owner % CAT_COLS.length], o ? o.accent : '#9aa0a8', this.vc);
        m.born = now; m.yaw = c.yaw || 0;
        this.scene.add(m.g); this.catModels.set(c.id, m);
      }
      const px = c.px ?? c.x, pz = c.pz ?? c.z;
      m.g.position.set(px + (c.x - px) * alpha, 0, pz + (c.z - pz) * alpha);
      let d = (c.yaw || 0) - m.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      m.yaw += d * Math.min(1, dt * 14);
      m.g.rotation.y = m.yaw;
      const sp = Math.min(6, c.speed || 0), run = Math.min(1, sp / 2.5);
      m.phase += (sp * 3.4 + 0.6) * dt;
      const sw = Math.sin(m.phase) * 0.8 * run;
      m.legs[0].rotation.x = sw; m.legs[3].rotation.x = sw; m.legs[1].rotation.x = -sw; m.legs[2].rotation.x = -sw;
      m.body.position.y = Math.abs(Math.cos(m.phase)) * 0.03 * run;
      m.tail.rotation.x = -0.25 + run * 0.35; m.tail.rotation.z = Math.sin(now * 5 + m.phase * 0.2) * 0.35;
      const k = Math.min(1, (now - m.born) / 0.3);
      m.g.scale.setScalar(0.4 + 0.6 * (1 + 2.70158 * (k - 1) ** 3 + 1.70158 * (k - 1) ** 2));
    }
    for (const [id, m] of this.catModels) if (!seen.has(id)) { this.scene.remove(m.g); m.g.traverse((o) => o.geometry && o.geometry.dispose()); this.catModels.delete(id); }
  }

  _stepFx(dt) {
    const fade = (pool, fn) => { for (const m of pool) { if (!m.visible) continue; const u = m.userData; u.t += dt; const k = u.t / u.life; if (k >= 1) { m.visible = false; continue; } fn(m, u, k); } };
    fade(this.flashes, (m, u, k) => { m.scale.setScalar(u.size * (0.45 + 0.75 * Math.sqrt(k))); m.material.opacity = 0.95 * (1 - k); });
    fade(this.tracers, (m, u, k) => {
      const head = u.len * Math.min(1, k * 1.7), tail = Math.max(0, head - 5);
      m.position.set(u.x0 + u.dx * tail, u.y0 + u.dy * tail, u.z0 + u.dz * tail);
      m.scale.set(0.03, 0.03, Math.max(0.01, head - tail));
      m.material.opacity = 0.95 * (1 - k * 0.6);
    });
    fade(this.shocks, (m, u, k) => { m.scale.setScalar(u.r * (0.15 + 0.85 * (1 - (1 - k) ** 3))); m.material.opacity = 0.55 * (1 - k); });
    fade(this.scorches, (m, u, k) => { m.material.opacity = Math.min(1, (1 - k) * 3.5); });
    fade(this.slashes, (m, u, k) => {
      const e = 1 - (1 - k) ** 3;
      m.rotation.set(0, u.yaw - 0.55 + 1.1 * e, 0);
      m.scale.setScalar(0.88 + 0.16 * e);
      m.material.opacity = 0.75 * (1 - k) ** 1.4;
    });
    let si = 0;
    for (const p of this.sparkP) {
      p.t += dt;
      if (p.t > p.life) continue;
      p.vy -= 9.8 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.02) { p.y = 0.02; p.vy *= -0.3; }
      const sz = (1 - p.t / p.life) * (p.size || 1);
      this._q.setFromEuler(this._e.set(p.t * 20, p.t * 13, 0)); this._v3.set(p.x, p.y, p.z); this._s3.set(sz, sz, sz * 2.2);
      this.sparkMesh.setColorAt(si, this._sparkCol.setHex(p.color || 0xffc94a));
      this.sparkMesh.setMatrixAt(si++, this._m4.compose(this._v3, this._q, this._s3));
    }
    this.sparkP = this.sparkP.filter((p) => p.t <= p.life);
    this.sparkMesh.count = si;
    this.sparkMesh.instanceMatrix.needsUpdate = true;
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true;
  }

  // 步槍：腰際 → 端槍移到畫面中下方；後座力、換彈（彈匣掉出來再插回去）、槍口火光
  _animRifle(me, now, dt, W) {
    const g = this.vmRifle;
    const bob = Math.sin(this.bob * 2) * Math.min(1, me.speed / CFG.SPEED);
    const reloading = (me.reloadUntil || 0) > now;
    // 端槍時往中間靠，但瞄準鏡停在準心下方，不擋住要打的人
    let x = 0.2, y = -0.215 + bob * 0.01, z = -0.34, rx = 0.03, ry = 0.09, rz = 0;
    if (me.aiming) { const c = Math.min(1, me.charge * 1.8); x -= 0.125 * c; y += 0.05 * c; z += 0.01 * c; ry *= 1 - c; rx *= 1 - c; }
    let mag = 0;
    if (reloading) {
      const k = Math.max(0, Math.min(1, 1 - (me.reloadUntil - now) / W.reload)), s = Math.sin(k * Math.PI);
      y -= 0.08 * s; rz = 0.6 * s; rx = 0.2 * s; x -= 0.03 * s;
      const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
      mag = sm(0.08, 0.3, k) * (1 - sm(0.6, 0.85, k));
    }
    this.vmMag.position.set(0, -0.26 * mag, 0.05 * mag);
    this.vmMag.visible = mag < 0.98;
    const b = (this.rifleB ||= { x, y, z, rx, ry, rz });
    const a = Math.min(1, dt * 16);
    for (const [k, v] of Object.entries({ x, y, z, rx, ry, rz })) b[k] += (v - b[k]) * a;
    const tt = now - me.throwAt, r = tt < 0.16 ? (1 - tt / 0.16) ** 2 : 0;
    g.position.set(b.x, b.y + 0.01 * r, b.z + 0.075 * r);
    g.rotation.set(b.rx + 0.14 * r, b.ry, b.rz);
    this.vmFlash.visible = tt < 0.05;
    if (this.vmFlash.visible) this.vmFlash.scale.setScalar(0.025 + Math.random() * 0.02);
  }

  // 光劍：平常斜握在右下；舉劍時橫在面前（會抖）；放開從右往左橫掃；衝刺時往前刺
  _animSaber(me, now, dt, W) {
    if (!this.vmBlade) this.setMyBlade('#3a86ff');
    const g = this.vmSaber;
    const bob = Math.sin(this.bob * 2) * Math.min(1, me.speed / CFG.SPEED);
    let x = 0.25, y = -0.27 + bob * 0.012, z = -0.5, rx = -0.35, ry = 0, rz = -0.3, rate = 14;
    const ready = me.aiming && me.charge * W.chargeT >= W.lungeT;
    if (me.aiming) {
      x = 0.07; y = -0.2; z = -0.46; rx = -0.15; rz = 1.05;
      x += (Math.random() - 0.5) * 0.003; y += (Math.random() - 0.5) * 0.003;
    }
    const lunged = (me.lungeAt ?? -9) >= me.throwAt - 1e-6;
    const lt = now - (me.lungeAt ?? -9);
    if (lunged && lt < W.lungeTime) { x = 0.12; y = -0.22; z = -0.62; rx = -0.95; rz = 0.1; rate = 24; }
    const st = now - (lunged ? me.lungeAt + W.lungeTime * 0.6 : me.throwAt);
    if (st >= 0 && st < 0.24) {
      const e = 1 - (1 - st / 0.24) ** 2.4;
      x = 0.34 - 0.62 * e; y = -0.08 - 0.2 * e; z = -0.48; rx = -0.55; rz = -0.95 + 2.7 * e; rate = 45;
    }
    const a = Math.min(1, dt * rate);
    g.position.x += (x - g.position.x) * a; g.position.y += (y - g.position.y) * a; g.position.z += (z - g.position.z) * a;
    g.rotation.x += (rx - g.rotation.x) * a; g.rotation.y += (ry - g.rotation.y) * a; g.rotation.z += (rz - g.rotation.z) * a;
    // 手臂：手腕在劍柄下端，袖子指向右下後方
    const arm = this.vmSaberArm;
    this._v3.set(0, -0.06, 0).applyEuler(g.rotation).add(g.position);
    arm.position.copy(this._v3);
    this._v3.set(0.6 + (0.25 - g.position.x) * 0.8, -0.7, 0.5).normalize();
    arm.quaternion.setFromUnitVectors(this._up ||= new THREE.Vector3(0, 0, 1), this._v3);
    const glow = this.vmBlade.glow;
    glow.material.opacity = ready ? 0.62 + 0.18 * Math.sin(now * 18) : me.aiming ? 0.6 : 0.48;
    glow.scale.set(ready ? 1.35 : 1, 1, ready ? 1.35 : 1);
  }

  _animHand(me, now, dt, intro = 1) {
    const h = this.hand;
    const W = WEAPONS[me.weapon] || WEAPONS.stone;
    const show = me.alive && intro > 0.92;
    h.visible = show && (W.kind === 'arc' || W.kind === 'boom');
    this.vmRifle.visible = show && W.kind === 'hitscan';
    this.vmSaber.visible = this.vmSaberArm.visible = show && W.kind === 'melee';
    if (!show) return;
    if (W.kind === 'hitscan') { this._animRifle(me, now, dt, W); return; }
    if (W.kind === 'melee') { this._animSaber(me, now, dt, W); return; }
    for (const k in this.handHeld) this.handHeld[k].visible = false;
    const held = this.handHeld[W.key] || this.handRock;
    if (W.key === 'cat') held.geometry = this.geo.cat[me.id % CAT_COLS.length];   // 跟丟出去、落地的貓同一個花色
    held.visible = me.stones > 0 && now - me.throwAt > 0.22;
    // 手裡沒東西時手指張開一點
    const curl = held.visible ? -0.35 : 0.25;
    for (const fg of this.handFingers.children) fg.rotation.x += (curl - fg.rotation.x) * Math.min(1, dt * 14);
    const bob = Math.sin(this.bob * 2) * Math.min(1, me.speed / CFG.SPEED);
    const P = this._handPose || {};   // 測試調姿勢用
    let x = P.x ?? 0.27, y = (P.y ?? -0.27) + bob * 0.012, z = P.z ?? -0.55, rx = P.rx ?? -0.5, rz = P.rz ?? 0.6;
    const ry = P.ry ?? 0;
    if (me.aiming) {
      const c = me.charge;
      x = 0.31; y = -0.19 + c * 0.02; z = -0.52 + c * 0.07; rx = -0.55 - c * 0.35; rz = 0.45;
      x += (Math.random() - 0.5) * 0.004 * c; y += (Math.random() - 0.5) * 0.004 * c;
    }
    const tt = now - me.throwAt;
    if (tt < 0.3) {
      const k = tt / 0.3, s = Math.sin(k * Math.PI);
      z -= s * 0.32; y += s * 0.05 - k * 0.05; rx += s * 0.9; x -= s * 0.06;
    }
    const a = Math.min(1, dt * 18);
    h.position.x += (x - h.position.x) * a;
    h.position.y += (y - h.position.y) * a;
    h.position.z += (z - h.position.z) * a;
    h.rotation.x += (rx - h.rotation.x) * a;
    h.rotation.z += (rz - h.rotation.z) * a;
    h.rotation.y += (ry - h.rotation.y) * a;
  }

  _animChar(c, p, alpha, dt, now) {
    const g = c.g;
    if (!p.alive) {
      c.fall = Math.min(1, c.fall + dt / 0.45);
      g.rotation.x = -c.fall * Math.PI / 2;
      g.position.y = -c.fall * 0.15;
      const fade = Math.max(0, 1 - Math.max(0, now - (p.respawnAt - CFG.RESPAWN_T) - 1.6) / 0.8);
      g.visible = fade > 0.02;
      for (const m of c.mats) m.opacity = fade;
      return;
    }
    if (c.fall) { c.fall = 0; g.rotation.x = 0; g.position.y = 0; }
    g.visible = true;
    g.position.set(p.px + (p.x - p.px) * alpha, 0, p.pz + (p.z - p.pz) * alpha);
    g.rotation.y = p.yaw;
    const shield = now < p.shieldUntil;
    for (const m of c.mats) m.opacity = shield ? 0.45 + 0.2 * Math.sin(now * 20) : 1;
    // 走路
    const sp = Math.min(p.speed, 6);
    c.phase += sp * dt * 2.3;
    const sw = Math.sin(c.phase) * Math.min(1, sp / 3) * 0.6;
    c.legL.rotation.x = sw; c.legR.rotation.x = -sw;
    c.armL.rotation.x = -sw * 0.8;
    const tt = now - p.throwAt;
    let ar = sw * 0.8, ary = 0, arz = 0, al = -sw * 0.8, alz = 0, snap = false;
    if (c.weapon === 'rifle') {
      // 雙手持槍：平常槍口朝前下，端槍時舉到肩上跟著仰角
      const reloading = (p.reloadUntil || 0) > now;
      const aimK = p.aiming ? 1 : 0;
      c.rk = (c.rk ?? 0) + (aimK - (c.rk ?? 0)) * Math.min(1, dt * 10);
      const k = c.rk, rec = tt < 0.15 ? 1 - tt / 0.15 : 0;
      c.rifle.position.set(0.11 + 0.02 * k, 1.17 + 0.25 * k - (reloading ? 0.08 : 0), -0.27 + 0.07 * k + 0.07 * rec);
      c.rifle.rotation.set(-0.32 * (1 - k) + (p.pitch || 0) * k + 0.1 * rec, 0, reloading ? 0.6 : 0);
      ar = 1.05 + 0.4 * k; arz = -0.15; al = 1.2 + 0.3 * k; alz = 0.55;
    } else if (c.weapon === 'saber') {
      // 光劍：平常低舉在前；舉劍擋時高舉在面前；揮砍從右往左橫掃；衝刺時往前刺
      // 劍刃相對手臂的角度也跟著姿勢換：平常往前上 30°、擋的時候直立、橫掃時接近水平
      ar = 0.6; ary = -0.2; let ba = -1.65;
      if (p.aiming) { ar = 1.9; ary = 0.45; ba = -1.95; }
      if (now - (c.lungeAt ?? -9) < 0.25) { ar = 1.5; ary = 0; ba = -2.9; }
      const st = now - (c.slashAt ?? -9);
      if (st < 0.24) { const e = 1 - (1 - st / 0.24) ** 3; ar = 1.45; ary = -1.2 + 2.5 * e; ba = -2.6; }
      c.saber.rotation.x += (ba - c.saber.rotation.x) * Math.min(1, dt * 20);
      c.saber.userData.glow.material.opacity = p.aiming ? 0.66 : 0.48;
    } else {
      // 投擲手：蓄力往後舉到頭後、出手從頭上往前甩
      if (p.aiming) ar = -2.3 - p.charge * 0.5;
      else if (tt < 0.3) ar = -2.6 - (tt / 0.3) * 2.3;
      else snap = true;
      if (c.held) c.held.visible = c.weapon === 'boomerang' ? p.stones > 0 && tt > 0.22 : p.aiming;
    }
    // 甩完回到走路姿勢時不要瞬間跳回去（角度先換成離目標最近的等價角再慢慢轉）
    const cur = c.armR.rotation.x;
    if (snap || c.weapon === 'saber') {
      const near = ar + Math.atan2(Math.sin(cur - ar), Math.cos(cur - ar));
      ar = near + (ar - near) * Math.min(1, dt * (c.weapon === 'saber' ? 22 : 12));
    }
    c.armR.rotation.x = ar; c.armR.rotation.y = ary; c.armR.rotation.z = arz;
    c.armL.rotation.x = al; c.armL.rotation.z = alz;
    // 受擊閃紅
    if (c.flash > 0) {
      c.flash = Math.max(0, c.flash - dt * 6);
      for (const m of c.mats) m.emissive.setRGB(c.flash * 0.9, c.flash * 0.1, c.flash * 0.05);
    }
  }

  // 換地圖：把 GPU 資源全部釋放並主動丟掉 WebGL context（iOS 同時開的 context 有上限）
  dispose() {
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of ms) { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }
    });
    this.handScene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.gl.dispose();
    this.gl.forceContextLoss();
    this.canvas.remove();
  }

  flashChar(id) { const c = this.chars.get(id); if (c) c.flash = 1; }
  charSlash(id, t) { const c = this.chars.get(id); if (c) c.slashAt = t; }
  charLunge(id, t) { const c = this.chars.get(id); if (c) c.lungeAt = t; }

  reset() {
    for (const c of this.chars.values()) this.scene.remove(c.g);
    this.chars.clear(); this.trails.clear();
    this.rocks.count = 0;
    for (const p of this.puffs) { p.t = 1; p.m.visible = false; }
    this.arcLine.visible = false; this.arcMark.visible = false;
    this.blastMark.visible = this.blastFill.visible = false;
    for (const m of this.catModels.values()) { this.scene.remove(m.g); m.g.traverse((o) => o.geometry && o.geometry.dispose()); }
    this.catModels.clear();
    for (const pool of [...Object.values(this.projPool), this.tracers, this.flashes, this.shocks, this.scorches, this.slashes]) for (const m of pool) { m.visible = false; m.userData.t = 9; }
    this.sparkP = []; this.sparkMesh.count = 0; this.laserDot.count = this.laserHalo.count = 0; this.laser.geometry.setDrawRange(0, 0);
    this.rifleB = null;
    if (this.crystalObjs) for (const m of this.crystalObjs) { this.scene.remove(m.g); m.g.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    this.crystalObjs = null;
    this.deathCam = null; this.shake = 0;
  }

  // 開場俯衝的起點＝選單背景此刻的鏡頭
  introFrom(t) {
    this.idle(t, false);
    this.introStart = { pos: this.camera.position.clone(), quat: this.camera.quaternion.clone() };
  }

  // 選單背景：繞著城市慢慢轉
  idle(t, draw = true) {
    const p = this.map.play;
    const cx = (p.minX + p.maxX) / 2, cz = (p.minZ + p.maxZ) / 2;
    const a = t * 0.045 + 0.6;
    const cam = this.camera;
    cam.position.set(cx + Math.cos(a) * 62, 30, cz + Math.sin(a) * 62);
    cam.lookAt(cx, 0, cz);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.copy(this.sun.target.position).add(this.sunOfs);
    this.skyMesh.position.copy(cam.position);
    this._lod(cam.position.x, cam.position.z);
    if (this.seaTex) this.seaTex.offset.set(t * 0.004, t * 0.011);
    if (!draw) return;
    this.gl.shadowMap.needsUpdate = true;
    this.gl.clear();
    this.gl.render(this.scene, cam);
  }

  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-v.y * 0.5 + 0.5) * window.innerHeight, front: v.z < 1 };
  }
}

function boxBlur(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H), k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc * k;
      acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * k;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

// 鐵窗柵欄：直條為主、上下各一條橫條，透明處用 alphaTest 挖掉
function grilleTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 64, 64);
  c.fillStyle = '#d9dce1';
  for (let x = 0; x < 64; x += 16) c.fillRect(x + 6, 0, 4, 64);
  c.fillRect(0, 28, 64, 4);
  c.fillStyle = '#c6cad0';
  for (let x = 0; x < 64; x += 16) c.fillRect(x + 9, 0, 1, 64);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 4 m 見方的重複鋪面貼圖
function paveTexture(style) {
  const N = 512, M = N / 4;   // 128 px / m
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const c = cv.getContext('2d');
  const img = c.createImageData(N, N);
  const d = img.data;
  let seed = 9;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  if (style === 'taipei') {
    // 柏油：細顆粒＋偶爾的補丁，每 2 m 一道伸縮縫
    const patch = [];
    for (let k = 0; k < 3; k++) patch.push([rnd() * N, rnd() * N, 40 + rnd() * 90, 30 + rnd() * 60]);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0.875 + (rnd() - 0.5) * 0.07;
      if (rnd() < 0.02) v -= 0.06;
      for (const [px, py, pw, ph] of patch) if (x > px && x < px + pw && y > py && y < py + ph) v += 0.025;
      const i = (y * N + x) * 4;
      d[i] = d[i + 1] = v * 255; d[i + 2] = v * 252; d[i + 3] = 255;
    }
  } else {
    // 米克諾斯：不規則石板＋石灰白縫（每格 0.8 m 一顆石頭，用 Voronoi 找縫）
    const G = 5, cell = N / G;
    const pts = [], tone = [];
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) { pts.push([(i + 0.15 + rnd() * 0.7) * cell, (j + 0.15 + rnd() * 0.7) * cell]); tone.push(0.85 + rnd() * 0.07); }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const gi = Math.floor(x / cell), gj = Math.floor(y / cell);
      let d1 = 1e9, d2 = 1e9, k1 = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = (gi + di + G) % G, jj = (gj + dj + G) % G;
        const [sx, sy] = pts[jj * G + ii];
        const ox = sx + (gi + di - ii) * cell, oy = sy + (gj + dj - jj) * cell;
        const dd = Math.hypot(x - ox, y - oy);
        if (dd < d1) { d2 = d1; d1 = dd; k1 = jj * G + ii; } else if (dd < d2) d2 = dd;
      }
      const edge = d2 - d1;   // 離縫的距離（px）
      const grout = Math.max(0, Math.min(1, (7 - edge) / 3));
      let v = tone[k1] + (rnd() - 0.5) * 0.035 - Math.max(0, 1 - edge / 14) * 0.03;
      v = v * (1 - grout) + 0.99 * grout;
      const i = (y * N + x) * 4;
      d[i] = v * 255; d[i + 1] = v * 253; d[i + 2] = v * 249; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 光劍刃的顏色：太暗的隊伍色（例如單機時你的墨色）改成亮藍，不然在白色世界裡看不出是光
function bladeColor(accent) {
  const c = new THREE.Color(accent);
  const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return l < 0.12 ? 0x3a86ff : accent;
}
