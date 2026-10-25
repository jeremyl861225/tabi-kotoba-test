// 畫面（Canvas 2D 向量）：玩具木盒裡的桌上戰場。規範在 ART.md。
// 座標：1 格＝1；斜俯視＝物體的頂面往上抬（木塊 0.42 格），看得到朝鏡頭的南面；投影往右下 45°。
// 靜態層（地板、投影、木框）與每一列木塊各畫成一張離屏畫布，換關或軟木塊被炸開才重畫。
import { COLS, ROWS, TANK, BULLETS, MINE } from './config.js';
import { TILE } from './maps.js';
import { hash32, makeRng, clamp, easeOutCubic } from './util.js';

const BLOCK_H = 0.42, TALL_H = 0.84, TANK_LIFT = 0.14, SHELL_LIFT = 0.16, RIM = 0.32, TRAY_H = 0.26;   // v5：木框變薄、比木塊矮，場地放大
const TANK_K = 1.1;   // 坦克畫大一點（碰撞半徑不變）：v3 審查「坦克只有 22 pt、不是焦點」
// 投影用 multiply 疊：保留底下的彩度、略帶紫（v3：一般疊色會變成灰褐、看起來髒）
const SHADOW = 'rgba(150, 138, 205, 0.5)';   // v5：再往紫偏一點（審查：投影色相比地板還暖）

// ---- 調色盤（ART.md）----
const P = {
  // v8：白色場地（使用者指定）
  // v9（審查：牆頂和地板只差 ΔL* 2，牆讀不出來）：地板降一階到暖淺灰，方塊頂面維持最亮的白
  floor: '#E9E4DB', seam: 'rgba(190, 180, 166, 0.6)', edge: 'rgba(110, 100, 150, 0.3)',
  top: '#FBF8F3', topHi: '#FFFEFB', side: '#D5CDC2', sideLo: '#C9C1B6',
  corkTop: '#EED8C4', corkPit: '#D9C0A8', corkHi: '#F9ECDF', corkSide: '#D6BCA4',
  // v10：坑洞＝把板子挖穿、看得到底下的桌面（淡紫洞底跟投影同色，被讀成「沒有主人的影子」）
  holeRim: '#DCD6E0', holeWall: '#D5CDC2', holeDeep: '#4A3F56',
  rimTop: '#F7F4EE', rimHi: '#FFFEFB', rimIn: '#CEC7BE', rimOut: '#B8AFA5',
  table: '#2B2230', hatch: '#342A3A',
  tread: '#4A4458', cleat: '#6A6378',
  shell: '#4A4458', shellLine: '#2E2838', smoke: '#CFC7DA',   // v9：煙比地板暗一階（白地上白煙看不到）
  flame0: '#FF9F43', flame1: '#FFE08A', flash: '#FFE48A', fire0: '#FFB347', fire1: '#F0723C', soot: '#C9C1D6', scorch: 'rgba(110, 100, 140, 0.18)',
  mine: '#F2C94C', mineBase: '#6E5A2E', mineLed: '#E5484D',
};
// 坦克車身：粉色系（v8）。玩家 p1–p4、對戰電腦 cpuA–C、隊伍配色用 aqua／peach／mint／lav、戰役車種用車種名
export const TANK_COLORS = {
  p1: '#8DBEF2', p2: '#F4A6BF', p3: '#8FD6AE', p4: '#F2D27E',
  aqua: '#86D3D3', peach: '#F6B892', mint: '#8FD6AE', lav: '#B8A2EC', peri: '#A9B2F4', ice: '#B9D7F7',
  brown: '#D6B59A', ash: '#BDB7C9', teal: '#86D3D3', yellow: '#F2D27E', pink: '#F4A6BF', green: '#B9D46E', violet: '#B8A2EC', white: '#F2EFF7', black: '#5E5574',
  cpuA: '#B8A2EC', cpuB: '#86D3D3', cpuC: '#F6B892',
};
// 隊伍色：只用在腳下的圈、小旗、名牌、瞄準虛線（畫面上最飽和的就是這兩個）
// v10：藍隊壓深到 #2F6BE0（L* 48），跟珊瑚紅（L* 60）在灰階下也分得開
export const TEAM_COLORS = { A: '#2F6BE0', B: '#F0607A', C: '#2FAE72', D: '#E39B1E' };
export const TEAM_NAMES = { A: '藍隊', B: '紅隊', C: '綠隊', D: '金隊' };

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (h, k) => { const c = hex(h); return rgb([c[0] * k, c[1] * k, c[2] * k]); };
const WARM_WHITE = [255, 250, 244];
const PLUM = [46, 38, 58];
const tones = new Map();
export function tankTones(key) {
  if (tones.has(key)) return tones.get(key);
  const base = hex(TANK_COLORS[key] || TANK_COLORS.p1);
  // 粉彩車身在白地上：描邊用同色相的深色（明度約 40%），剪影才撐得住
  const t = {
    base: rgb(base), light: rgb(mix(base, WARM_WHITE, 0.38)), lighter: rgb(mix(base, WARM_WHITE, 0.62)),
    dark: rgb(mix(base, PLUM, 0.22)), deep: rgb(mix(base, PLUM, 0.42)), line: rgb(mix(base, PLUM, key === 'black' ? 0.55 : 0.66)), raw: base,
  };
  tones.set(key, t);
  return t;
}

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
function rrPath(g, x, y, w, h, r) {   // 只加子路徑（不 beginPath），給合併投影用
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

// 四個角各自的圓角（[左上, 右上, 右下, 左下]），只加子路徑
function rrc(g, x, y, w, h, [a, b, c, d]) {
  g.moveTo(x + a, y); g.lineTo(x + w - b, y); if (b) g.quadraticCurveTo(x + w, y, x + w, y + b);
  g.lineTo(x + w, y + h - c); if (c) g.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  g.lineTo(x + d, y + h); if (d) g.quadraticCurveTo(x, y + h, x, y + h - d);
  g.lineTo(x, y + a); if (a) g.quadraticCurveTo(x, y, x + a, y);
  g.closePath();
}

// 這台坦克的隊伍色：有分隊用藍／珊瑚紅；大亂鬥用自己車身色的深色版
export const teamColorOf = (t) => (t.teamColor ? TEAM_COLORS[t.teamColor] : tankTones(t.color).line);

const blockH = (v) => (v === TILE.TALL ? TALL_H : v === TILE.WALL ? BLOCK_H : v === TILE.CORK ? 0.32 : 0);   // 軟木塊矮一點

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.cam = null;              // 定格用：{ zoom, cx, cy }
    this.parts = [];              // 煙、火花、碎片
    this.pendingMarks = [];       // 延後畫的 X 記號
    this.trails = new Map();      // 炮彈 id → 煙尾
    this.fx = [];                 // 爆炸、閃光、波紋
    this.recoil = new Map();      // 坦克 id → 開火時間
    this.trackOdo = new Map();
    this.motes = [];
    this.time = 0;
    this.aimGuide = true;
    this.showRings = true;
    this.labels = new Map();      // 'slot0' → 名牌文字（多人時）
    this.rng = makeRng(7);
    this.resize();
    for (let i = 0; i < 22; i++) this.motes.push({ x: this.rng() * COLS, y: this.rng() * ROWS, h: 0.6 + this.rng() * 1.4, r: 0.03 + this.rng() * 0.05, ph: this.rng() * 6.28, sp: 0.05 + this.rng() * 0.08 });
  }

  // ---- 版面 ----
  resize(opts = {}) {
    const W = window.innerWidth, H = window.innerHeight;
    this.W = W; this.H = H;
    this.dpr = clamp(window.devicePixelRatio || 1, 2, opts.maxDpr || 3);
    this.cv.width = Math.round(W * this.dpr); this.cv.height = Math.round(H * this.dpr);
    const cs = getComputedStyle(document.documentElement);
    const inset = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
    const side = Math.max(inset('--sl'), inset('--sr'));
    const sideMin = (Math.min(W, H) > 600 ? 150 : 118) + side;
    const padT = 5 + inset('--st'), padB = 4 + Math.max(inset('--sb'), 0);
    const S = Math.min((H - padT - padB) / (ROWS + RIM * 2 + TRAY_H), (W - 2 * sideMin) / (COLS + RIM * 2));
    this.S = Math.max(8, S);
    const fw = COLS * this.S, fh = ROWS * this.S;
    this.ox = Math.round((W - fw) / 2);
    this.oy = Math.round(padT + (RIM + TRAY_H) * this.S + (H - padT - padB - (ROWS + RIM * 2 + TRAY_H) * this.S) / 2);
    this.field = { x: this.ox, y: this.oy, w: fw, h: fh, S: this.S };
    this.staticKey = null;
  }

  view() {
    if (!this.cam) return { S: this.S, ox: this.ox, oy: this.oy };
    const S = this.S * this.cam.zoom;
    return { S, ox: this.W / 2 - this.cam.cx * S, oy: this.H / 2 - this.cam.cy * S };
  }

  toField(clientX, clientY) {
    const v = this.view();
    return { x: (clientX - v.ox) / v.S, y: (clientY - v.oy) / v.S };
  }

  // ---- 靜態層 ----
  layer(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

  buildStatic(state) {
    const v = this.view(), d = this.dpr;
    const key = `${state.mapKey}|${state.gridVer}|${v.S}|${v.ox}|${v.oy}|${this.cv.width}x${this.cv.height}`;
    if (key === this.staticKey) return;
    const sameMap = this.staticKey && this.staticKey.split('|')[0] === state.mapKey && this.staticKey.split('|').slice(2).join('|') === key.split('|').slice(2).join('|');
    this.staticKey = key;
    if (!sameMap) { this.decal = this.layer(this.cv.width, this.cv.height); this.tracks = this.layer(this.cv.width, this.cv.height); this.trackOdo.clear(); }
    const grid = state.grid;
    // 地板層
    const fl = (this.floorCv = this.floorCv && this.floorCv.width === this.cv.width && this.floorCv.height === this.cv.height ? this.floorCv : this.layer(this.cv.width, this.cv.height));
    const g = fl.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, fl.width, fl.height);
    this.drawTable(g, v);
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);
    this.drawRim(g, 'back');
    this.drawFloor(g, grid, state.mapKey);
    this.drawHoles(g, grid);
    this.drawBlockShadows(g, grid);
    // 每列木塊
    this.rows = [];
    for (let r = 0; r < ROWS; r++) {
      let any = false;
      for (let x = 0; x < COLS; x++) if (blockH(grid[r * COLS + x])) { any = true; break; }
      if (!any) { this.rows.push(null); continue; }
      const top = r - TALL_H - 0.05, bot = r + 1.05;
      const y0 = Math.floor(d * (v.oy + top * v.S)), y1 = Math.ceil(d * (v.oy + bot * v.S));
      const c = this.layer(this.cv.width, y1 - y0);
      const rg = c.getContext('2d');
      rg.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy - y0);
      for (let x = 0; x < COLS; x++) {
        const t = grid[r * COLS + x];
        if (blockH(t)) this.drawBlock(rg, x, r, t, grid);
      }
      this.rows.push({ c, y0 });
    }
    // 木框南緣（在所有東西前面）：只畫那一條，省一次全螢幕合成
    const fy0 = Math.max(0, Math.floor(d * (v.oy + (ROWS - TRAY_H - 0.05) * v.S)));
    const fy1 = Math.min(this.cv.height, Math.ceil(d * (v.oy + (ROWS + RIM + 0.05) * v.S)));
    const fr = (this.frontCv = this.layer(this.cv.width, Math.max(1, fy1 - fy0)));
    this.frontY = fy0;
    const fg = fr.getContext('2d');
    fg.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy - fy0);
    this.drawRim(fg, 'front');
  }

  drawTable(g, v) {
    const d = this.dpr;
    g.fillStyle = P.table;
    g.fillRect(0, 0, this.cv.width, this.cv.height);
    // 界外斜紋（Mini Motorways 的界外）
    g.save();
    g.strokeStyle = P.hatch;
    g.lineWidth = 7 * d;
    const step = 22 * d;
    g.beginPath();
    for (let x = -this.cv.height; x < this.cv.width; x += step) { g.moveTo(x, 0); g.lineTo(x + this.cv.height, this.cv.height); }
    g.stroke();
    g.restore();
    // 木盒落在桌上的投影
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);
    g.fillStyle = 'rgba(14, 8, 20, 0.35)';
    g.beginPath();
    const x0 = -RIM, y0 = -RIM - TRAY_H, x1 = COLS + RIM, y1 = ROWS + RIM, k = 0.45;
    g.moveTo(x0 + 0.3, y0); g.lineTo(x1, y0); g.lineTo(x1 + k, y0 + k); g.lineTo(x1 + k, y1 + k); g.lineTo(x0 + k, y1 + k); g.lineTo(x0, y1); g.closePath();
    g.fill();
  }

  // 木盒外框：back＝北、東、西邊與北內壁（在坦克後面）；front＝南邊（會擋住最下面一排的一點點）
  drawRim(g, part) {
    const x0 = -RIM, x1 = COLS + RIM, yT = -RIM - TRAY_H, yB = ROWS + RIM - TRAY_H;
    const ROUND = 0.16;
    if (part === 'back') {
      // 外框頂面（整圈）＋外側面
      g.fillStyle = P.rimOut;
      rr(g, x0, yT, x1 - x0, yB - yT + TRAY_H, ROUND); g.fill();
      g.fillStyle = P.rimTop;
      rr(g, x0, yT, x1 - x0, yB - yT, ROUND); g.fill();
      // 頂面受光邊
      g.strokeStyle = P.rimHi; g.lineWidth = 0.045;
      g.beginPath(); g.moveTo(x0 + ROUND, yT + 0.03); g.lineTo(x1 - ROUND, yT + 0.03); g.moveTo(x0 + 0.03, yT + ROUND); g.lineTo(x0 + 0.03, yB - ROUND); g.stroke();
      // 開口：內側看得到北內壁
      g.fillStyle = P.rimIn;
      g.fillRect(0, -TRAY_H, COLS, TRAY_H);
      const gr = g.createLinearGradient(0, -TRAY_H, 0, 0);
      gr.addColorStop(0, 'rgba(255, 252, 246, 0.2)'); gr.addColorStop(1, 'rgba(110, 100, 150, 0.25)');
      g.fillStyle = gr; g.fillRect(0, -TRAY_H, COLS, TRAY_H);
    } else {
      // 南邊頂面＋外側面（蓋住地板最南 0.42 格）
      g.fillStyle = P.rimOut;
      rr(g, x0, ROWS - TRAY_H, x1 - x0, RIM + TRAY_H, ROUND); g.fill();
      g.fillStyle = P.rimTop;
      g.beginPath();
      g.moveTo(x0, ROWS - TRAY_H); g.lineTo(x1, ROWS - TRAY_H); g.lineTo(x1, yB - ROUND); g.quadraticCurveTo(x1, yB, x1 - ROUND, yB);
      g.lineTo(x0 + ROUND, yB); g.quadraticCurveTo(x0, yB, x0, yB - ROUND); g.closePath(); g.fill();
      // 內緣的亮邊（南框頂面朝北的邊受光）
      g.strokeStyle = P.rimHi; g.lineWidth = 0.04;
      g.beginPath(); g.moveTo(0, ROWS - TRAY_H + 0.02); g.lineTo(COLS, ROWS - TRAY_H + 0.02); g.stroke();
    }
  }

  drawFloor(g, grid, mapKey) {
    // v8：白色石板地（2×2 格一塊、每塊明度 ±1.5%、細縫），乾淨不搶戲
    g.save();
    g.beginPath(); g.rect(0, 0, COLS, ROWS); g.clip();   // 地板的東西一律不出場地
    g.fillStyle = P.floor;
    g.fillRect(0, 0, COLS, ROWS);
    const r = makeRng(hash32(mapKey.length, 99));
    for (let y = 0; y < ROWS; y += 2) for (let x = 0; x < COLS; x += 2) {
      const k = (r() - 0.5) * 0.03;
      g.fillStyle = k > 0 ? `rgba(255, 255, 252, ${k * 2.2})` : `rgba(150, 140, 175, ${-k * 1.2})`;
      g.fillRect(x, y, 2, 2);
    }
    g.fillStyle = P.seam;
    for (let y = 2; y < ROWS; y += 2) g.fillRect(0, y - 0.012, COLS, 0.024);
    for (let x = 2; x < COLS; x += 2) g.fillRect(x - 0.012, 0, 0.024, ROWS);
    // 牆腳的接觸陰影：貼著木塊底邊（南、東、西）0.06 格深色（v6：原本一圈圓角暈開，像光暈不像陰影）
    // v7：只畫背光那兩邊（南緣下方、東緣外側各 0.06 格），旁邊也是木塊就不畫（v6 每格各畫一個外擴矩形，凸出成「耳朵」）
    const solid = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && blockH(grid[y * COLS + x]) > 0;
    g.fillStyle = 'rgba(110, 100, 160, 0.3)';
    g.beginPath();
    // v9：東側只畫在「南面露出來」的那格旁邊、高度＝南面高度（旁邊是上一格頂面時不畫，不然像浮在頂面上）
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!solid(x, y) || solid(x, y + 1)) continue;
      const h = blockH(grid[y * COLS + x]);
      g.rect(x, y + 1, 1, 0.06);
      if (!solid(x + 1, y)) g.rect(x + 1, y + 1 - h, 0.06, h + 0.06);
    }
    g.fill();
    // 北內壁的陰影落在第一排地板
    const gr = g.createLinearGradient(0, 0, 0, 0.5);
    gr.addColorStop(0, 'rgba(110, 100, 160, 0.2)'); gr.addColorStop(1, 'rgba(110, 100, 160, 0)');
    g.fillStyle = gr; g.fillRect(0, 0, COLS, 0.5);
    const gl = g.createLinearGradient(0, 0, 0.35, 0);
    gl.addColorStop(0, 'rgba(110, 100, 160, 0.14)'); gl.addColorStop(1, 'rgba(110, 100, 160, 0)');
    g.fillStyle = gl; g.fillRect(0, 0, 0.35, ROWS);
    g.restore();
  }

  // 坑洞：看得到北內壁（地板木頭切面、往下變暗）、外緣一圈斜面、南緣受光亮線；相鄰的連成一片（v3）
  drawHoles(g, grid) {
    const isHole = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y * COLS + x] === TILE.HOLE;
    const WALL = 0.3, B = 0.06;   // 內壁＝板子厚度
    // 外緣斜面（整片一次畫，不會有接縫）
    // 外側的角（兩邊都不是洞）才圓（v5：跟木塊一樣的圓角語彙）
    const corners = (x, y, R) => {
      const L = !isHole(x - 1, y), Rt = !isHole(x + 1, y), T = !isHole(x, y - 1), Bm = !isHole(x, y + 1);
      return [L && T ? R : 0, Rt && T ? R : 0, Rt && Bm ? R : 0, L && Bm ? R : 0];
    };
    g.fillStyle = P.holeRim;
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!isHole(x, y)) continue;
      const e = (dx, dy) => (isHole(x + dx, y + dy) ? 0 : 0.02);
      rrc(g, x - e(-1, 0), y - e(0, -1), 1 + e(-1, 0) + e(1, 0), 1 + e(0, -1) + e(0, 1), corners(x, y, 0.1));
    }
    g.fill();
    // 洞底
    g.fillStyle = P.holeDeep;
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!isHole(x, y)) continue;
      const l = isHole(x - 1, y) ? 0 : B, r = isHole(x + 1, y) ? 0 : B, t = isHole(x, y - 1) ? 0 : B, b = isHole(x, y + 1) ? 0 : B;
      rrc(g, x + l, y + t, 1 - l - r, 1 - t - b, corners(x, y, 0.07));
    }
    g.fill();
    // 洞底看到的桌面斜紋（跟場地外同一套）：只畫在洞底裡
    g.save(); g.clip();
    g.strokeStyle = P.hatch; g.lineWidth = 0.15;
    g.beginPath();
    for (let k = -ROWS; k < COLS; k += 0.47) { g.moveTo(k, 0); g.lineTo(k + ROWS, ROWS); }
    g.stroke();
    g.restore();
    g.save();   // 內壁、亮線都只畫在洞口裡面（圓角外不畫）
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!isHole(x, y)) continue;
      const e = (dx, dy) => (isHole(x + dx, y + dy) ? 0 : 0.02);
      rrc(g, x - e(-1, 0), y - e(0, -1), 1 + e(-1, 0) + e(1, 0), 1 + e(0, -1) + e(0, 1), corners(x, y, 0.1));
    }
    g.clip();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!isHole(x, y)) continue;
      const l = isHole(x - 1, y) ? 0 : B, r = isHole(x + 1, y) ? 0 : B, t = isHole(x, y - 1) ? 0 : B, b = isHole(x, y + 1) ? 0 : B;
      const x0 = x + l, x1 = x + 1 - r, y0 = y + t, y1 = y + 1 - b;
      if (t) {   // 北內壁：每一個北邊不是洞的格子都要有
        const wg = g.createLinearGradient(0, y0, 0, y0 + WALL);
        wg.addColorStop(0, '#E8E2D9'); wg.addColorStop(0.1, P.holeWall); wg.addColorStop(1, '#B8AFA5');   // 板材切面（跟外框側面同一套）
        g.fillStyle = wg; g.fillRect(x0, y0, x1 - x0, WALL);
        g.fillStyle = 'rgba(110, 100, 150, 0.25)';
        g.fillRect(x0, y0 + 0.07, x1 - x0, 0.016);
        g.fillStyle = '#BDB5CA'; g.fillRect(x0 - (l ? B : 0), y0 - B, x1 - x0 + (l ? B : 0) + (r ? B : 0), 0.025);   // 北緣暗線
      }
      if (l) { g.fillStyle = 'rgba(255, 252, 255, 0.12)'; g.fillRect(x0, y0, 0.05, y1 - y0); }
      if (r) { g.fillStyle = 'rgba(60, 50, 90, 0.18)'; g.fillRect(x1 - 0.05, y0, 0.05, y1 - y0); }
      if (b) { g.fillStyle = '#FBF9FF'; g.fillRect(x0 - (l ? B : 0), y1 + B - 0.05, x1 - x0 + (l ? B : 0) + (r ? B : 0), 0.05); }   // 南緣亮唇
    }
    g.restore();
  }

  drawBlockShadows(g, grid) {
    // 合併成一條路徑一次填：重疊的投影不會更黑（Mini Motorways 的清楚半透明投影）
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = SHADOW;
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const h = blockH(grid[y * COLS + x]);
      if (!h) continue;
      const k = h * 0.95;
      g.moveTo(x, y + 1 - 0.02); g.lineTo(x + 1, y + 1 - 0.02); g.lineTo(x + 1, y);
      g.lineTo(x + 1 + k, y + k); g.lineTo(x + 1 + k, y + 1 + k); g.lineTo(x + k, y + 1 + k); g.closePath();
    }
    // 木盒北框、西框也有投影落在地板
    // 繞行方向要跟木塊投影一樣（nonzero：方向相反的重疊處會變成洞）
    g.moveTo(0, 0); g.lineTo(COLS, 0); g.lineTo(COLS, TRAY_H * 0.9); g.lineTo(TRAY_H * 0.9, TRAY_H * 0.9); g.lineTo(TRAY_H * 0.9, ROWS); g.lineTo(0, ROWS); g.closePath();
    g.fill();
    g.restore();
  }

  drawBlock(g, x, y, t, grid) {
    // v8：白色方塊（石膏感：沒有木紋，靠受光邊、南面與投影讀體積）；軟方塊是粉杏色＋斑點
    const h = blockH(t), cork = t === TILE.CORK, tall = t === TILE.TALL;
    const R = cork ? 0.14 : 0.07;
    const rng = makeRng(hash32(x, y, t));
    const vary = (rng() - 0.5) * 0.04;
    const topC = cork ? P.corkTop : P.top, sideC = cork ? P.corkSide : P.side;
    // 南面（朝鏡頭）
    g.fillStyle = sideC;
    rr(g, x + 0.01, y - h + 0.5, 0.98, h + 0.49, R); g.fill();
    const gr = g.createLinearGradient(0, y + 1 - h, 0, y + 1);
    gr.addColorStop(0, 'rgba(255, 252, 246, 0.25)'); gr.addColorStop(1, cork ? 'rgba(150, 110, 80, 0.2)' : 'rgba(150, 140, 175, 0.22)');
    g.fillStyle = gr; g.fillRect(x + 0.02, y + 1 - h, 0.96, h - 0.02);
    if (tall) { g.fillStyle = 'rgba(150, 140, 175, 0.35)'; g.fillRect(x + 0.02, y + 1 - BLOCK_H - 0.01, 0.96, 0.022); }
    if (cork) {
      g.fillStyle = 'rgba(160, 120, 90, 0.3)';
      for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x + 0.1 + rng() * 0.8, y + 1 - h + 0.06 + rng() * (h - 0.12), 0.02 + rng() * 0.02, 0, 6.28); g.fill(); }
    }
    // 頂面
    const ty = y - h;
    g.fillStyle = topC;
    rr(g, x + 0.01, ty + 0.01, 0.98, 0.98, R); g.fill();
    g.fillStyle = vary > 0 ? `rgba(255, 255, 252, ${vary * 2})` : `rgba(150, 140, 175, ${-vary})`;
    rr(g, x + 0.01, ty + 0.01, 0.98, 0.98, R); g.fill();
    if (cork) {
      for (let i = 0; i < 12; i++) {   // v9：斑點減半（1x 下像砂紙）
        g.fillStyle = i % 3 ? P.corkPit : P.corkHi;
        g.beginPath(); g.ellipse(x + 0.1 + rng() * 0.8, ty + 0.1 + rng() * 0.8, 0.02 + rng() * 0.03, 0.016 + rng() * 0.022, rng() * 3, 0, 6.28); g.fill();
      }
    }
    // v9：頂面外輪廓（北、西、東三邊，旁邊也是方塊就不畫）——白頂面在淺地板上要有邊才讀得出牆
    const solid = (cx, cy) => cx >= 0 && cy >= 0 && cx < COLS && cy < ROWS && blockH(grid[cy * COLS + cx]) > 0;
    g.strokeStyle = P.edge; g.lineWidth = 0.03; g.lineCap = 'round';
    g.beginPath();
    if (!solid(x, y - 1)) { g.moveTo(x + 0.01 + R, ty + 0.01); g.lineTo(x + 0.99 - R, ty + 0.01); }
    if (!solid(x - 1, y)) { g.moveTo(x + 0.01, ty + 0.01 + R); g.lineTo(x + 0.01, ty + 0.99); }
    if (!solid(x + 1, y)) { g.moveTo(x + 0.99, ty + 0.01 + R); g.lineTo(x + 0.99, ty + 0.99); }
    g.stroke();
    // 倒角：左上亮邊、右下收邊
    g.lineWidth = 0.04;
    g.strokeStyle = cork ? 'rgba(255, 246, 236, 0.9)' : P.topHi;
    g.beginPath(); g.moveTo(x + 0.04, ty + 0.9); g.lineTo(x + 0.04, ty + 0.1); g.quadraticCurveTo(x + 0.04, ty + 0.04, x + 0.1, ty + 0.04); g.lineTo(x + 0.9, ty + 0.04); g.stroke();
    g.strokeStyle = cork ? 'rgba(170, 120, 85, 0.3)' : 'rgba(110, 100, 150, 0.18)';
    g.beginPath(); g.moveTo(x + 0.96, ty + 0.1); g.lineTo(x + 0.96, ty + 0.9); g.quadraticCurveTo(x + 0.96, ty + 0.96, x + 0.9, ty + 0.96); g.lineTo(x + 0.1, ty + 0.96); g.stroke();
  }

  // ---- 每格 ----
  // state：sim 或客人的鏡像（grid、gridVer、tanks、bullets、mines、mapKey）
  // opts：{ aims: [{ path, color, hit, hitFoe }] }
  frame(state, dt, opts = {}) {
    this.time += dt;
    if (this.shake) {
      const k = 1 - (this.time - this.shake.t) / (this.shake.dur || 0.15);
      if (k <= 0) { this.shake = null; this.cv.style.transform = ''; }
      else this.cv.style.transform = `translate(${(this.rng() - 0.5) * 2 * this.shake.amp * k}px, ${(this.rng() - 0.5) * 2 * this.shake.amp * k}px)`;
    }
    const g = this.g, d = this.dpr;
    this.buildStatic(state);
    this.lastGrid = state.grid;
    if (this.pendingMarks.length) {
      const due = this.pendingMarks.filter((m) => m.at <= this.time);
      if (due.length) { this.pendingMarks = this.pendingMarks.filter((m) => m.at > this.time); for (const m of due) this.markDeath(m.e); }
    }
    const v = this.view();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.floorCv, 0, 0);
    this.stampTracks(state, v);
    if ((this.fadeT = (this.fadeT || 0) + dt) > 0.5) {
      this.fadeT = 0;
      const tg = this.tracks.getContext('2d');
      tg.setTransform(1, 0, 0, 1, 0, 0);
      tg.globalCompositeOperation = 'destination-out';
      tg.fillStyle = 'rgba(0, 0, 0, 0.17)';   // 約 3 秒淡掉（只留車後一小段）
      tg.fillRect(0, 0, this.tracks.width, this.tracks.height);
      tg.globalCompositeOperation = 'source-over';
    }
    g.drawImage(this.tracks, 0, 0);
    g.drawImage(this.decal, 0, 0);
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);

    // 地上的東西與投影
    for (const m of state.mines) this.drawMine(g, m, state);
    for (const t of state.tanks) if (t.alive) this.drawTankShadow(g, t);
    for (const b of state.bullets) this.drawShellShadow(g, b);
    this.drawTrails(g);

    this.ownerColor = new Map(state.tanks.map((t) => [t.id, t.color]));
    // 依 y 排序：坦克、炮彈 和 每一列木塊交錯畫
    const ents = [];
    for (const t of state.tanks) if (t.alive) ents.push({ y: t.y, t });
    for (const b of state.bullets) ents.push({ y: b.y, b });
    ents.sort((a, b) => a.y - b.y);
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      while (i < ents.length && ents[i].y < r + 0.5) this.drawEnt(g, ents[i++], state, dt);
      const row = this.rows[r];
      if (row) { g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(row.c, 0, row.y0); g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy); }
    }
    while (i < ents.length) this.drawEnt(g, ents[i++], state, dt);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.frontCv, 0, this.frontY);
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);

    // 瞄準虛線（v7：最後才畫，木塊擋不住；原本反彈點常被木塊頂面蓋掉）
    if (opts.aims && this.aimGuide) for (const a of opts.aims) this.drawAim(g, a);
    // 空中的：煙、火、碎片、爆炸
    this.stepParts(g, dt);
    this.drawFx(g, dt);
    this.drawMotes(g, dt);
    this.drawLabels(g, state);
  }

  drawEnt(g, e, state, dt) {
    if (e.t) this.drawTank(g, e.t, dt);
    else this.drawShell(g, e.b, dt);
    void state;
  }

  // ---- 履帶痕、X 記號 ----
  stampTracks(state, v) {
    // v6：兩條連續的履帶帶子（0.10 格寬）＋每 0.12 格一道橫紋；原本一節一節的方塊像虛線、跟瞄準虛線混在一起
    const tg = this.tracks.getContext('2d'), d = this.dpr;
    tg.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);
    for (const t of state.tanks) {
      if (!t.alive) continue;
      const last = this.trackOdo.get(t.id);
      const c = Math.cos(t.body), s = Math.sin(t.body);
      const sides = [-0.285, 0.285].map((k) => ({ x: t.x - s * k * TANK_K, y: t.y + c * k * TANK_K }));
      if (last == null || typeof last !== 'object') { this.trackOdo.set(t.id, { odo: t.odo, sides }); continue; }
      if (t.odo - last.odo < 0.12) continue;
      this.trackOdo.set(t.id, { odo: t.odo, sides });
      if (t.ghost) continue;
      tg.lineCap = 'butt';
      for (let i = 0; i < 2; i++) {
        const a = last.sides[i], b = sides[i];
        if (Math.hypot(b.x - a.x, b.y - a.y) > 0.6) continue;   // 轉向太大或瞬移：不連
        // v10：履帶齒印——垂直行進方向的短橫條（點線跟瞄準虛線撞語言、連續線轉彎像鉛筆塗鴉）
        tg.strokeStyle = 'rgba(110, 100, 150, 0.09)'; tg.lineWidth = 0.04;
        tg.beginPath(); tg.moveTo(b.x + s * 0.09, b.y - c * 0.09); tg.lineTo(b.x - s * 0.09, b.y + c * 0.09); tg.stroke();
      }
    }
  }

  markDeath(e, v = this.view()) {
    const g = this.decal.getContext('2d'), d = this.dpr;
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);
    g.fillStyle = P.scorch;
    g.beginPath(); g.ellipse(e.x + 0.05, e.y + 0.05, 0.62, 0.5, 0.3, 0, 6.28); g.fill();
    const T = tankTones(e.color || 'p1');
    g.save(); g.translate(e.x, e.y);
    g.lineCap = 'round';
    g.strokeStyle = T.deep; g.lineWidth = 0.17;
    g.beginPath(); g.moveTo(-0.3, -0.3); g.lineTo(0.3, 0.3); g.moveTo(0.3, -0.3); g.lineTo(-0.3, 0.3); g.stroke();
    g.strokeStyle = T.base; g.lineWidth = 0.1;
    g.beginPath(); g.moveTo(-0.3, -0.3); g.lineTo(0.3, 0.3); g.moveTo(0.3, -0.3); g.lineTo(-0.3, 0.3); g.stroke();
    g.restore();
  }

  markScorch(x, y, r) {
    const v = this.view(), g = this.decal.getContext('2d'), d = this.dpr;
    g.setTransform(d * v.S, 0, 0, d * v.S, d * v.ox, d * v.oy);
    g.fillStyle = 'rgba(74, 58, 48, 0.16)';
    g.beginPath(); g.arc(x, y, r * 0.75, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(74, 58, 48, 0.14)';
    for (let i = 0; i < 7; i++) { const a = i * 0.9 + this.rng(), rr2 = r * (0.6 + this.rng() * 0.5); g.beginPath(); g.arc(x + Math.cos(a) * rr2 * 0.7, y + Math.sin(a) * rr2 * 0.7, r * 0.2, 0, 6.28); g.fill(); }
  }

  // ---- 坦克 ----
  drawTankShadow(g, t) {
    if (t.ghost && !this.ghostVis(t)) return;
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.translate(t.x + 0.17, t.y + 0.17);
    g.rotate(t.body);
    g.scale(TANK_K, TANK_K);
    g.fillStyle = SHADOW;
    rr(g, -0.47, -0.38, 0.94, 0.76, 0.16); g.fill();
    g.restore();
    if (!this.showRings || t.ghost) return;
    // 腳下的隊伍色圈（v8：分隊要一眼看出來）：隊伍色粗圈＋淡底盤；真人玩家多一道暖白內圈
    const C = teamColorOf(t);
    const R = 0.6 * TANK_K;
    g.globalAlpha = 0.22; g.fillStyle = C;
    g.beginPath(); g.ellipse(t.x, t.y + 0.02, R, R * 0.93, 0, 0, 6.28); g.fill();
    // v10：圈加粗到 0.11 格；紅隊是 6 段虛線圈（灰階、色盲也分得出兩隊）
    g.globalAlpha = 0.95; g.strokeStyle = C; g.lineWidth = 0.11;
    if (t.teamColor === 'B') { const c = 6.28 * R * 0.965; g.setLineDash([c / 6 * 0.78, c / 6 * 0.22]); g.lineCap = 'butt'; }
    g.beginPath(); g.ellipse(t.x, t.y + 0.02, R, R * 0.93, -1.2, 0, 6.28); g.stroke();
    g.setLineDash([]);
    if (t.kind === 'player') {
      // v9：真人玩家＝隊色圈外再一圈白＋細深邊（原本的暖白內圈在白地上看不到）
      const R2 = R + 0.09;
      g.strokeStyle = '#FFFFFF'; g.lineWidth = 0.055;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R2, R2 * 0.93, 0, 0, 6.28); g.stroke();
      g.strokeStyle = 'rgba(74, 68, 88, 0.85)'; g.lineWidth = 0.022;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R2 + 0.035, (R2 + 0.035) * 0.93, 0, 0, 6.28); g.stroke();
    }
    g.globalAlpha = 1;
  }

  // 隊旗：插在腳下圈的 11 點鐘位置、旗面朝外（v9：原本插在車尾，車頭朝北時會蓋住炮塔）
  // 形狀也分隊：藍隊三角旗、紅隊燕尾旗、綠隊方旗、金隊三角旗——灰階下也分得出藍紅兩隊
  drawPennant(g, t) {
    const R = 0.6 * TANK_K;
    const px = t.x - R * 0.87, py = t.y + 0.02 - R * 0.93 * 0.5;
    const top = py - 0.7;
    const k = t.teamColor || 'A';
    const fw = 0.4, fh = 0.27;   // v10：旗面放大（原本 0.3×0.2，手機上看不出旗形）
    g.strokeStyle = P.tread; g.lineWidth = 0.04; g.lineCap = 'round';
    g.beginPath(); g.moveTo(px, py); g.lineTo(px, top); g.stroke();
    g.beginPath();
    if (k === 'B') { g.moveTo(px, top); g.lineTo(px - fw, top); g.lineTo(px - fw * 0.66, top + fh / 2); g.lineTo(px - fw, top + fh); g.lineTo(px, top + fh); }
    else if (k === 'C') { g.rect(px - fw * 0.9, top, fw * 0.9, fh * 0.95); }
    else { g.moveTo(px, top); g.lineTo(px - fw, top + fh / 2); g.lineTo(px, top + fh); }
    g.closePath();
    g.fillStyle = teamColorOf(t); g.fill();
    g.strokeStyle = k === 'B' ? '#8A2E44' : 'rgba(46, 38, 58, 0.75)'; g.lineWidth = 0.024; g.lineJoin = 'round'; g.stroke();
    g.fillStyle = 'rgba(255, 255, 255, 0.35)';   // 旗面上緣受光
    g.fillRect(px - (k === 'B' || k === 'C' ? fw * 0.86 : fw * 0.5), top + 0.03, k === 'B' || k === 'C' ? fw * 0.8 : fw * 0.45, 0.035);
  }

  ghostVis(t) {
    const since = this.time - (this.recoil.get(t.id) ?? -9);
    return since < 0.6 ? 0.42 * (1 - since / 0.6) : 0;
  }

  drawTank(g, t, dt) {
    const T = tankTones(t.color);
    let alpha = 1;
    if (t.ghost) { alpha = this.ghostVis(t); if (alpha <= 0.01) return; }
    const fired = this.recoil.get(t.id);
    const since = fired == null ? 9 : this.time - fired;
    const rec = since < 0.14 ? 0.09 * (1 - easeOutCubic(since / 0.14)) : 0;
    const bob = t.moving > 0.2 ? Math.sin(t.odo * 22) * 0.008 : 0;
    const lift = TANK_LIFT + bob;
    g.save();
    g.globalAlpha = alpha;
    g.translate(t.x, t.y); g.scale(TANK_K, TANK_K); g.translate(-t.x, -t.y);
    // 履帶（車身高度的下半）
    g.save();
    g.translate(t.x, t.y - lift * 0.35);
    g.rotate(t.body);
    for (const side of [-1, 1]) {
      g.fillStyle = T.deep;
      rr(g, -0.47, side > 0 ? 0.18 : -0.38, 0.94, 0.2, 0.08); g.fill();
      g.fillStyle = P.tread;
      rr(g, -0.45, side > 0 ? 0.19 : -0.37, 0.9, 0.18, 0.07); g.fill();
      g.strokeStyle = P.cleat; g.lineWidth = 0.028;
      const off = -((t.odo * 1.0) % 0.1);
      g.beginPath();
      for (let x = -0.42 + off + 0.1; x < 0.42; x += 0.1) { g.moveTo(x, side > 0 ? 0.205 : -0.355); g.lineTo(x, side > 0 ? 0.355 : -0.205); }
      g.stroke();
    }
    g.restore();
    // 車身側面（往下的厚度）
    g.save();
    g.translate(t.x, t.y - lift + 0.075);
    g.rotate(t.body);
    g.fillStyle = T.deep;
    rr(g, -0.41, -0.28, 0.82, 0.56, 0.12); g.fill();
    g.restore();
    // 車身頂面
    g.save();
    g.translate(t.x, t.y - lift);
    g.rotate(t.body);
    g.fillStyle = T.base;
    rr(g, -0.41, -0.28, 0.82, 0.56, 0.12); g.fill();
    g.strokeStyle = T.line; g.lineWidth = 0.036;
    rr(g, -0.41, -0.28, 0.82, 0.56, 0.12); g.stroke();
    g.fillStyle = T.light;
    rr(g, -0.31, -0.19, 0.56, 0.38, 0.08); g.fill();
    // 車頭（前方的斜板與兩顆頭燈，看得出朝哪）
    g.fillStyle = T.dark;
    g.beginPath(); g.moveTo(0.27, -0.2); g.lineTo(0.37, -0.15); g.lineTo(0.37, 0.15); g.lineTo(0.27, 0.2); g.closePath(); g.fill();
    g.fillStyle = 'rgba(255, 240, 200, 0.9)';
    g.beginPath(); g.arc(0.35, -0.2, 0.03, 0, 6.28); g.arc(0.35, 0.2, 0.03, 0, 6.28); g.fill();
    // 鉚釘
    g.fillStyle = T.dark;
    for (const [rx, ry] of [[-0.26, -0.14], [-0.26, 0.14], [0.2, -0.14], [0.2, 0.14]]) { g.beginPath(); g.arc(rx, ry, 0.02, 0, 6.28); g.fill(); }
    g.restore();
    // 受光邊：車身頂面左上（畫面座標，不跟著車身轉）
    g.save();
    g.translate(t.x, t.y - lift);
    g.rotate(t.body);
    g.beginPath(); rrPath(g, -0.375, -0.245, 0.75, 0.49, 0.1); g.clip();
    g.rotate(-t.body);
    g.strokeStyle = T.lighter; g.globalAlpha = alpha * 0.8; g.lineWidth = 0.05;
    g.beginPath(); g.arc(0.06, 0.06, 0.4, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
    g.restore();
    // 炮塔與炮管
    g.save();
    g.translate(t.x, t.y - lift - 0.06);
    g.rotate(t.turret);
    this.drawBarrel(g, t, T, rec);
    g.restore();
    g.save();
    g.translate(t.x, t.y - lift + 0.0);
    g.fillStyle = T.deep;
    g.beginPath(); g.arc(0, 0, 0.215, 0, 6.28); g.fill();
    g.translate(0, -0.06);
    g.fillStyle = T.base;
    g.beginPath(); g.arc(0, 0, 0.2, 0, 6.28); g.fill();
    g.strokeStyle = T.line; g.lineWidth = 0.032; g.stroke();
    // 球面亮部
    const hl = g.createRadialGradient(-0.07, -0.08, 0.01, -0.03, -0.04, 0.2);
    hl.addColorStop(0, 'rgba(255, 250, 240, 0.55)'); hl.addColorStop(1, 'rgba(255, 250, 240, 0)');
    g.fillStyle = hl; g.beginPath(); g.arc(0, 0, 0.19, 0, 6.28); g.fill();
    // 艙蓋
    g.rotate(t.turret);
    g.fillStyle = T.dark; g.beginPath(); g.arc(-0.06, 0.02, 0.075, 0, 6.28); g.fill();
    g.fillStyle = T.light; g.beginPath(); g.arc(-0.07, 0.01, 0.05, 0, 6.28); g.fill();
    g.restore();
    g.restore();
    if (this.showRings) { g.save(); g.globalAlpha = alpha; this.drawPennant(g, t); g.restore(); }
    void dt;
  }

  drawBarrel(g, t, T, rec) {
    const k = t.bullet || 'standard';
    const shape = { standard: [0.6, 0.064], rocket: [0.68, 0.058], ricochet: [0.64, 0.052], scatter: [0.52, 0.066], blast: [0.5, 0.088] }[k] || [0.6, 0.064];
    const [len, hw] = shape;
    const x0 = 0.08 - rec, x1 = len - rec;
    g.fillStyle = T.line;
    rr(g, x0, -hw - 0.014, x1 - x0, (hw + 0.014) * 2, 0.03); g.fill();
    g.fillStyle = T.dark;
    rr(g, x0, -hw, x1 - x0, hw * 2, 0.025); g.fill();
    g.fillStyle = 'rgba(255, 248, 236, 0.25)';
    g.fillRect(x0 + 0.05, -hw + 0.012, x1 - x0 - 0.1, hw * 0.55);
    g.fillStyle = T.deep;
    if (k === 'scatter') { g.beginPath(); g.moveTo(x1 - 0.1, -hw); g.lineTo(x1 + 0.02, -hw - 0.035); g.lineTo(x1 + 0.02, hw + 0.035); g.lineTo(x1 - 0.1, hw); g.closePath(); g.fill(); }
    else if (k === 'rocket') { rr(g, x1 - 0.13, -hw - 0.03, 0.06, (hw + 0.03) * 2, 0.02); g.fill(); rr(g, x1 - 0.05, -hw - 0.02, 0.06, (hw + 0.02) * 2, 0.02); g.fill(); }
    else if (k === 'ricochet') { for (const o of [0.2, 0.36]) { rr(g, x0 + o, -hw - 0.022, 0.045, (hw + 0.022) * 2, 0.015); g.fill(); } rr(g, x1 - 0.07, -hw - 0.02, 0.08, (hw + 0.02) * 2, 0.02); g.fill(); }
    else { rr(g, x1 - 0.09, -hw - 0.022, 0.1, (hw + 0.022) * 2, 0.025); g.fill(); }
  }

  // ---- 炮彈 ----
  drawShellShadow(g, b) {
    g.save();
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = 'rgba(150, 138, 205, 0.32)';   // v9：跟其他投影同一種淡紫
    g.beginPath(); g.ellipse(b.x + SHELL_LIFT, b.y + SHELL_LIFT, 0.1, 0.07, Math.atan2(b.vy, b.vx), 0, 6.28); g.fill();   // 45° 往右下
    g.restore();
  }

  // 煙尾：每顆炮彈記住走過的點，畫成一條由粗變細、由濃變淡的帶子（v3：原本一顆顆圓疊成珍珠串）
  trail(b) {
    let tr = this.trails.get(b.id);
    if (!tr) { tr = { pts: [], rocket: b.type === 'rocket', last: null, rgb: tankTones(this.ownerColor && this.ownerColor.get(b.owner) || 'ash').raw.map((c, i) => Math.round(c + (PLUM[i] - c) * 0.18)) }; this.trails.set(b.id, tr); }   // v9：煙尾深一階，黃車的在淺地板上才看得到
    const y = b.y - SHELL_LIFT;
    const L = tr.pts[tr.pts.length - 1];
    if (!L || Math.hypot(b.x - L.x, y - L.y) > 0.05) tr.pts.push({ x: b.x, y, t: this.time });
    tr.seen = this.time;
    tr.head = { x: b.x, y };
  }

  drawTrails(g) {
    // v5：整條煙尾一條路徑一次畫（逐段畫在接頭會有接縫或珠子），濃淡用沿線的漸層，粗細畫兩層
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const [id, tr] of this.trails) {
      const life = tr.rocket ? 0.75 : 0.5;
      while (tr.pts.length && this.time - tr.pts[0].t > life) tr.pts.shift();
      if (!tr.pts.length) { if (this.time - tr.seen > 0.05) this.trails.delete(id); continue; }
      const pts = tr.seen >= this.time - 1e-6 && tr.head ? [...tr.pts, { ...tr.head, t: this.time }] : tr.pts;
      if (pts.length < 2) continue;
      const a = pts[0], b = pts[pts.length - 1];
      const fresh = 1 - (this.time - b.t) / life;          // 炮彈不見之後整條一起淡掉
      const tail = Math.max(0, 1 - (this.time - a.t) / life);
      const W = tr.rocket ? 0.17 : 0.12;
      // v8：煙尾是發射者的車身色（白地上白煙看不到，也一眼看出是誰的彈）
      const oc = tr.rgb.join(', ');
      for (const [w, al, c, dy] of [[W * 1.05, 0.28, '190, 182, 206', 0.03], [W, 0.5, oc, 0], [W * 0.45, 0.45, '255, 252, 248', 0]]) {
        const gr = g.createLinearGradient(a.x, a.y, b.x, b.y);
        gr.addColorStop(0, `rgba(${c}, ${al * tail * 0.2 * fresh})`);
        gr.addColorStop(1, `rgba(${c}, ${al * fresh})`);
        g.strokeStyle = gr; g.lineWidth = w;
        g.beginPath(); g.moveTo(pts[0].x, pts[0].y + dy);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y + dy);
        g.stroke();
      }
    }
  }

  drawShell(g, b, dt) {
    const a = Math.atan2(b.vy, b.vx);
    const y = b.y - SHELL_LIFT;
    if (b.id != null && this.trails) this.trail(b);
    const rocket = b.type === 'rocket';
    // v6：奶油色地板上白色光暈反而降低對比 → 一圈深色柔光
    const owner = this.ownerColor && this.ownerColor.get(b.owner);
    // v7：發射者顏色的光暈（深色柔光讓它不至於糊在地板上，色光讓它成為場上最醒目、一眼知道是誰的）
    const oc = owner ? hex(TANK_COLORS[owner] || '#8DBEF2').map((v) => v * 0.85) : [74, 68, 88];
    const halo = g.createRadialGradient(b.x, y, 0.04, b.x, y, 0.32);
    halo.addColorStop(0, `rgba(${oc[0]}, ${oc[1]}, ${oc[2]}, 0.38)`); halo.addColorStop(1, `rgba(${oc[0]}, ${oc[1]}, ${oc[2]}, 0)`);
    g.fillStyle = halo; g.beginPath(); g.arc(b.x, y, 0.32, 0, 6.28); g.fill();
    g.save();
    g.translate(b.x, y);
    g.rotate(a);
    if (rocket) {
      const fl = 0.3 + Math.sin(this.time * 60) * 0.06;
      const gr = g.createLinearGradient(-0.1 - fl, 0, -0.07, 0);
      gr.addColorStop(0, 'rgba(255, 159, 67, 0)'); gr.addColorStop(0.5, P.flame0); gr.addColorStop(1, P.flame1);
      g.fillStyle = gr;
      g.beginPath(); g.moveTo(-0.09, -0.04); g.quadraticCurveTo(-0.1 - fl, 0, -0.09, 0.04); g.closePath(); g.fill();
      g.fillStyle = P.shellLine;
      rr(g, -0.12, -0.055, 0.29, 0.11, 0.055); g.fill();
      g.fillStyle = owner ? tankTones(owner).base : '#E6E1EC';
      rr(g, -0.1, -0.037, 0.25, 0.074, 0.037); g.fill();
      g.fillStyle = '#E5484D';
      g.beginPath(); g.moveTo(-0.1, -0.037); g.lineTo(-0.135, -0.075); g.lineTo(-0.05, -0.037); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-0.1, 0.037); g.lineTo(-0.135, 0.075); g.lineTo(-0.05, 0.037); g.closePath(); g.fill();
    } else if (b.type === 'blast') {
      const blink = Math.sin(this.time * 18) > 0;
      const R = 0.1;
      g.fillStyle = P.shellLine; g.beginPath(); g.arc(0, 0, R + 0.022, 0, 6.28); g.fill();
      g.fillStyle = '#4A4048'; g.beginPath(); g.arc(0, 0, R, 0, 6.28); g.fill();
      g.fillStyle = blink ? '#FF8A5C' : '#E5484D'; g.beginPath(); g.arc(R * 0.35, 0, R * 0.4, 0, 6.28); g.fill();
      g.fillStyle = 'rgba(255, 248, 236, 0.4)'; g.beginPath(); g.arc(-R * 0.3, -R * 0.35, R * 0.3, 0, 6.28); g.fill();
    } else {
      const L = b.type === 'scatter' ? 0.2 : 0.33, W = b.type === 'scatter' ? 0.13 : 0.18;
      g.fillStyle = P.shellLine;
      rr(g, -L / 2 - 0.025, -W / 2 - 0.025, L + 0.05, W + 0.05, W / 2 + 0.025); g.fill();
      g.fillStyle = P.shell;
      rr(g, -L / 2, -W / 2, L, W, W / 2); g.fill();
      if (owner) {   // 彈頭＝發射者的顏色：一眼看出是誰的彈
        g.save(); g.beginPath(); rrPath(g, -L / 2, -W / 2, L, W, W / 2); g.clip();
        g.fillStyle = tankTones(owner).base; g.fillRect(L * 0.12, -W, L, W * 2);
        g.restore();
      }
      g.fillStyle = 'rgba(255, 250, 244, 0.55)';
      rr(g, -L / 2 + 0.025, -W / 2 + 0.018, L * 0.55, W * 0.3, W * 0.15); g.fill();
      if (b.type === 'ricochet') { g.fillStyle = '#2E9C9A'; g.fillRect(-0.018, -W / 2, 0.032, W); }
    }
    g.restore();
    void dt;
  }

  // ---- 地雷 ----
  drawMine(g, m, state) {
    void state;
    g.save(); g.globalCompositeOperation = 'multiply';
    g.fillStyle = SHADOW;
    g.beginPath(); g.ellipse(m.x + 0.07, m.y + 0.07, 0.3, 0.26, 0, 0, 6.28); g.fill();
    g.restore();
    g.fillStyle = P.mineBase;
    g.beginPath(); g.ellipse(m.x, m.y, 0.3, 0.27, 0, 0, 6.28); g.fill();
    g.fillStyle = P.mine;
    g.beginPath(); g.ellipse(m.x, m.y - 0.05, 0.25, 0.22, 0, 0, 6.28); g.fill();
    g.fillStyle = 'rgba(255, 250, 230, 0.55)';
    g.beginPath(); g.ellipse(m.x - 0.08, m.y - 0.12, 0.08, 0.05, -0.5, 0, 6.28); g.fill();
    const fusing = m.fuse != null;
    const rate = fusing ? 14 : 1.4;
    const on = Math.sin((this.time + m.id) * rate * Math.PI) > (fusing ? -0.3 : 0.6);
    g.fillStyle = on ? P.mineLed : '#7A2E30';
    g.beginPath(); g.arc(m.x, m.y - 0.06, 0.06, 0, 6.28); g.fill();
    if (on) { g.fillStyle = 'rgba(229, 72, 77, 0.25)'; g.beginPath(); g.arc(m.x, m.y - 0.06, fusing ? 0.2 : 0.12, 0, 6.28); g.fill(); }
    if (fusing) {
      g.strokeStyle = 'rgba(229, 72, 77, 0.55)'; g.lineWidth = 0.03;
      g.setLineDash([0.12, 0.1]);
      g.beginPath(); g.arc(m.x, m.y, MINE.radius, 0, 6.28); g.stroke();
      g.setLineDash([]);
    }
  }

  // ---- 瞄準線 ----
  drawAim(g, aim) {
    const pts = aim.path;
    if (!pts || pts.length < 2) return;
    // v8：瞄準線用隊色（藍隊／紅隊），大亂鬥用自己車身的深色線
    const C = aim.team ? TEAM_COLORS[aim.team] : tankTones(aim.color || 'p1').line;
    let seg = 0, along = 0.0;
    const spacing = 0.24;
    let carry = TANK.muzzle;
    // v9：方塊頂面是抬高畫的，走在方塊北側那一段（在牆後面）的點只畫很淡——不然看起來像穿進牆裡
    const grid = this.lastGrid;
    const wallH = (cx, r) => (r >= ROWS ? TRAY_H : cx < 0 || cx >= COLS || r < 0 || !grid ? 0 : blockH(grid[r * COLS + cx]));
    const behind = (px, py) => { const r = Math.floor(py) + 1, h = wallH(Math.floor(px), r); return h > 0 && py >= r - h; };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-4) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      let s = carry;
      while (s < L) {
        // 白地板上要看得清楚：用隊色，第一段實、反彈後淡
        const px = a.x + ux * s, py = a.y + uy * s;
        // v10：被方塊擋住的那段不畫（點停在牆面）；點加大＋白描邊（白地上 2 pt 太細）
        if (behind(px, py)) { s += spacing; along += spacing; continue; }
        g.globalAlpha = seg === 0 ? 0.95 : 0.5;
        g.fillStyle = C; g.strokeStyle = '#FFFFFF'; g.lineWidth = 0.02;
        g.beginPath(); g.arc(px, py, seg === 0 ? 0.072 : 0.055, 0, 6.28); g.fill(); g.stroke();
        if (seg === 0) { g.fillStyle = 'rgba(255, 255, 255, 0.85)'; g.beginPath(); g.arc(px - 0.012, py - 0.012, 0.02, 0, 6.28); g.fill(); }
        s += spacing; along += spacing;
      }
      carry = s - L;
      seg++;
      // 反彈點：本色外圈＋暖白內圈的空心圈
      if (i < pts.length - 2 && seg <= 2) {
        // 打在方塊北面（往南撞、往北彈）：記號畫在頂面北緣上，沿邊一條撞擊亮線
        const c = pts[i + 2];
        let mx = b.x, my = b.y, edge = false;
        if (uy > 0 && c.y < b.y) {
          const r = Math.round(b.y), h = wallH(Math.floor(b.x), r);
          if (h > 0) { my = r - h; edge = true; }
        }
        g.globalAlpha = seg === 1 ? 0.95 : 0.5;
        if (edge) {
          g.globalAlpha *= 0.6; g.strokeStyle = C; g.lineWidth = 0.05; g.lineCap = 'round';
          g.beginPath(); g.moveTo(mx - 0.25, my); g.lineTo(mx + 0.25, my); g.stroke();
          g.globalAlpha = seg === 1 ? 0.95 : 0.5;
        }
        g.strokeStyle = C; g.lineWidth = 0.06;
        g.beginPath(); g.arc(mx, my, 0.17, 0, 6.28); g.stroke();
        g.strokeStyle = 'rgba(255, 255, 255, 0.95)'; g.lineWidth = 0.03;
        g.beginPath(); g.arc(mx, my, 0.125, 0, 6.28); g.stroke();
      }
      if (seg > 1) break;
    }
    g.globalAlpha = 1;
    // 會打到人：終點一個準心圈
    if (aim.hit) {
      const e = pts[pts.length - 1];
      g.strokeStyle = aim.hitFoe ? 'rgba(232, 84, 60, 0.9)' : 'rgba(120, 110, 140, 0.6)'; g.lineWidth = 0.045;
      g.beginPath(); g.arc(e.x, e.y, 0.2, 0, 6.28); g.stroke();
    }
    void along;
  }

  // ---- 粒子與特效 ----
  stepParts(g, dt) {
    const keep = [];
    for (const p of this.parts) {
      p.age += dt;
      if (p.age >= p.life) continue;
      keep.push(p);
      if (p.age < 0) continue;
      const k = p.age / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.g) { p.vy += p.g * dt; }
      if (p.kind === 'spark') {
        const sp = Math.hypot(p.vx, p.vy) || 1, L = p.len * (1 - k);
        g.globalAlpha = 1 - k * k; g.strokeStyle = p.c; g.lineWidth = p.w; g.lineCap = 'round';
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx / sp * L, p.y - p.vy / sp * L); g.stroke();
        continue;
      }
      if (p.kind === 'chip') {
        g.save(); g.globalAlpha = 1 - k * k; g.translate(p.x, p.y); g.rotate(p.rot + p.age * p.spin);
        g.fillStyle = 'rgba(40, 28, 40, 0.25)'; g.fillRect(-p.r0 + 0.03, -p.r0 * 0.6 + 0.03, p.r0 * 2, p.r0 * 1.2);
        g.fillStyle = p.c; g.fillRect(-p.r0, -p.r0 * 0.6, p.r0 * 2, p.r0 * 1.2); g.restore();
        continue;
      }
      const r = p.r0 + (p.r1 - p.r0) * easeOutCubic(k);
      g.globalAlpha = (p.a0 ?? 0.6) * (1 - k);
      g.fillStyle = p.c;
      g.beginPath(); g.arc(p.x, p.y, r, 0, 6.28); g.fill();
      if (p.edge) { g.strokeStyle = p.edge; g.lineWidth = 0.014; g.stroke(); }
    }
    g.globalAlpha = 1;
    this.parts = keep.length > 900 ? keep.slice(-900) : keep;
  }

  drawFx(g, dt) {
    const keep = [];
    for (const f of this.fx) {
      f.age += dt;
      if (f.age >= f.life) continue;
      keep.push(f);
      const k = f.age / f.life;
      if (f.kind === 'flash') {
        g.globalAlpha = 1 - k;
        g.fillStyle = f.c || P.flash;
        g.beginPath(); g.arc(f.x, f.y, f.r * (0.6 + 0.6 * k), 0, 6.28); g.fill();
        g.globalAlpha = 1;
      } else if (f.kind === 'ring') {
        g.globalAlpha = (1 - k * k) * 0.95;   // v10：衝擊波前半段維持粗、亮
        g.strokeStyle = f.c || 'rgba(255, 244, 223, 1)'; g.lineWidth = (f.w || 0.05) * (1 - 0.6 * k);
        g.beginPath(); g.arc(f.x, f.y, (f.r0 || 0) + (f.r - (f.r0 || 0)) * easeOutCubic(k), 0, 6.28); g.stroke();
        g.globalAlpha = 1;
      } else if (f.kind === 'boom') {
        const e = easeOutCubic(Math.min(1, k * 2.2));
        g.globalAlpha = Math.max(0, 1 - k * 1.6);
        g.fillStyle = P.fire1; g.beginPath(); g.arc(f.x, f.y, f.r * e, 0, 6.28); g.fill();
        g.fillStyle = P.fire0; g.beginPath(); g.arc(f.x - f.r * 0.08, f.y - f.r * 0.1, f.r * e * 0.72, 0, 6.28); g.fill();
        g.fillStyle = P.flash; g.beginPath(); g.arc(f.x - f.r * 0.12, f.y - f.r * 0.16, f.r * e * 0.42 * (1 - k), 0, 6.28); g.fill();
        g.globalAlpha = 1;
      } else if (f.kind === 'whiteTank') {
        // 被擊中那一格：整台坦克變成暖白剪影，下一格才炸開
        g.save(); g.globalAlpha = 0.92 * (1 - k);
        g.translate(f.x, f.y - TANK_LIFT); g.scale(TANK_K, TANK_K);
        g.fillStyle = '#FFF0A8';   // 白地上用暖黃白，白色剪影會看不見
        g.rotate(f.body); rr(g, -0.47, -0.38, 0.94, 0.76, 0.14); g.fill();
        g.rotate(f.turret - f.body); rr(g, 0.05, -0.08, 0.6, 0.16, 0.05); g.fill();
        g.beginPath(); g.arc(0, -0.06, 0.24, 0, 6.28); g.fill();
        g.restore();
      } else if (f.kind === 'cloud') {
        // 火球：7–9 瓣不規則雲（不畫高光）。150 ms 從 0.3 長到 1.2 格，之後 300 ms 變成煙往上飄
        const grow = Math.min(1, f.age / 0.15), R = f.r * (0.25 + 0.75 * easeOutCubic(grow));
        const toSmoke = Math.max(0, (f.age - 0.15) / (f.life - 0.15));
        const lift = toSmoke * 0.4;
        const lobes = (rad, dy, color, alpha) => {
          g.globalAlpha = alpha; g.fillStyle = color; g.beginPath();
          for (const l of f.lobes) g.moveTo(f.x + l.dx * R + l.r * rad * R, f.y - lift + dy + l.dy * R), g.arc(f.x + l.dx * R, f.y - lift + dy + l.dy * R, l.r * rad * R, 0, 6.28);
          g.fill();
        };
        const a = 1 - toSmoke;
        if (toSmoke < 0.6) {
          lobes(1.05, 0.06, '#C9502E', a);
          lobes(1, 0, P.fire1, a);
          lobes(0.72, -0.03, P.fire0, a);
          lobes(0.4, -0.05, '#FFF3C4', a * (1 - toSmoke));   // 白熱核心
        }
        if (toSmoke > 0) {
          lobes(1.05, 0.05, '#968CAA', 0.75 * toSmoke * (1 - toSmoke * 0.6));
          lobes(1, 0, '#BDB4CC', 0.8 * toSmoke * (1 - toSmoke * 0.6));
        }
        g.globalAlpha = 1;
      } else if (f.kind === 'ball') {
        const kk = (f.age - (f.delay || 0)) / (f.life - (f.delay || 0));
        if (kk < 0) continue;
        const e = easeOutCubic(Math.min(1, kk * 2.4)), a = Math.max(0, 1 - kk * kk);
        g.globalAlpha = a;
        g.fillStyle = P.fire1; g.beginPath(); g.arc(f.x, f.y, f.r * e, 0, 6.28); g.fill();
        g.fillStyle = P.fire0; g.beginPath(); g.arc(f.x - f.r * 0.14 * e, f.y - f.r * 0.16 * e, f.r * e * 0.8, 0, 6.28); g.fill();
        g.fillStyle = 'rgba(255, 238, 170, 0.85)'; g.beginPath(); g.arc(f.x - f.r * 0.28 * e, f.y - f.r * 0.3 * e, f.r * e * 0.32, 0, 6.28); g.fill();
        g.globalAlpha = 1;
      } else if (f.kind === 'muzzle') {
        g.save(); g.translate(f.x, f.y); g.rotate(f.a);
        g.globalAlpha = 1 - k;
        g.fillStyle = P.flash;
        g.beginPath(); g.moveTo(-0.02, -0.11); g.lineTo(0.36, 0); g.lineTo(-0.02, 0.11); g.closePath(); g.fill();
        g.beginPath(); g.moveTo(0.06, -0.2); g.lineTo(0.12, 0); g.lineTo(0.06, 0.2); g.lineTo(0, 0); g.closePath(); g.fill();
        g.fillStyle = '#FFF4DF'; g.beginPath(); g.arc(0.03, 0, 0.08, 0, 6.28); g.fill();
        g.restore(); g.globalAlpha = 1;
      }
    }
    this.fx = keep;
  }

  drawMotes(g, dt) {
    for (const m of this.motes) {
      m.x += Math.cos(m.ph + this.time * 0.2) * m.sp * dt;
      m.y += Math.sin(m.ph * 1.3 + this.time * 0.17) * m.sp * dt - 0.02 * dt;
      if (m.y < -0.5) m.y = ROWS; if (m.x < 0) m.x = COLS; if (m.x > COLS) m.x = 0;
      const gx = m.x | 0, gy = (m.y - m.h) | 0;
      if (this.lastGrid && gy >= 0 && gy < ROWS && this.lastGrid[gy * COLS + gx] === TILE.HOLE) continue;
      const a = 0.1 + 0.08 * Math.sin(this.time * 0.8 + m.ph);
      g.fillStyle = `rgba(255, 255, 255, ${a * 2.2})`;   // v9：白色光點（淡紫點在淺地板上像污漬）
      g.beginPath(); g.arc(m.x, m.y - m.h, m.r, 0, 6.28); g.fill();
    }
  }

  drawLabels(g, state) {
    if (!this.labels.size) return;
    const v = this.view();
    g.save();
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.font = `600 ${Math.round(Math.max(10, v.S * 0.42))}px Geist, -apple-system, "PingFang TC", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const t of state.tanks) {
      if (!t.alive) continue;
      const txt = t.kind === 'player' ? this.labels.get(`slot${t.slot}`) : null;
      if (!txt) continue;
      const x = v.ox + t.x * v.S, y = v.oy + (t.y - 0.95) * v.S;
      const w = g.measureText(txt).width + v.S * 0.5, h = v.S * 0.62;
      g.fillStyle = teamColorOf(t); g.globalAlpha = 0.92;
      rr(g, x - w / 2, y - h / 2, w, h, h / 2); g.fill();
      g.globalAlpha = 1; g.fillStyle = '#FFF8EC';
      g.fillText(txt, x, y + 0.5);
    }
    g.restore();
  }

  // 模擬事件 → 特效
  onEvents(events, state) {
    for (const e of events) {
      if (e.k === 'fire') {
        this.recoil.set(e.id, this.time);
        this.fx.push({ kind: 'muzzle', x: e.x, y: e.y - TANK_LIFT - 0.06, a: e.a, age: 0, life: 0.1 });
        for (let i = 0; i < 3; i++) this.parts.push({ x: e.x + Math.cos(e.a) * 0.05, y: e.y - TANK_LIFT - 0.06, vx: Math.cos(e.a) * (0.5 + i * 0.3) + (this.rng() - 0.5) * 0.25, vy: Math.sin(e.a) * (0.5 + i * 0.3) + (this.rng() - 0.5) * 0.25, r0: 0.04, r1: 0.11 - i * 0.015, life: 0.4, age: 0, c: '#ECE8F1', a0: 0.9, edge: '#BFB7CF' });
      } else if (e.k === 'bounce') {
        // 反彈：一圈 0.1→0.5 格的波紋＋6 條放射火花（v3：原本只有 1 px 細圈看不到）
        // v5：白色在奶油地板上看不到 → 暖黃核心＋橘色外圈，半徑到 0.6 格
        this.fx.push({ kind: 'ring', x: e.x, y: e.y - SHELL_LIFT, r0: 0.12, r: 0.6, w: 0.07, age: 0, life: 0.18, c: 'rgba(240, 114, 60, 1)' });
        this.fx.push({ kind: 'flash', x: e.x, y: e.y - SHELL_LIFT, r: 0.16, age: 0, life: 0.1 });
        for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + this.rng() * 0.5; this.parts.push({ kind: 'spark', x: e.x, y: e.y - SHELL_LIFT, vx: Math.cos(a) * 2.6, vy: Math.sin(a) * 2.6, len: 0.18, w: 0.05, life: 0.18, age: 0, c: i % 2 ? '#FFB347' : '#F0723C' }); }
      } else if (e.k === 'pop' || e.k === 'clash') {
        this.fx.push({ kind: 'flash', x: e.x, y: e.y - SHELL_LIFT, r: 0.16, age: 0, life: 0.12 });
        for (let i = 0; i < 6; i++) { const a = this.rng() * 6.28; this.parts.push({ x: e.x, y: e.y - SHELL_LIFT, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6 - 0.1, r0: 0.05, r1: 0.15, life: 0.5, age: 0, c: P.soot, a0: 0.6 }); }
      } else if (e.k === 'boom') {
        this.fx.push({ kind: 'boom', x: e.x, y: e.y - 0.1, r: e.r * 0.85, age: 0, life: 0.5 });
        this.fx.push({ kind: 'ring', x: e.x, y: e.y, r: e.r * 1.05, age: 0, life: 0.45, c: 'rgba(255, 228, 138, 1)' });
        for (let i = 0; i < 14; i++) { const a = this.rng() * 6.28, s = this.rng(); this.parts.push({ x: e.x + Math.cos(a) * e.r * 0.3 * s, y: e.y - 0.1 + Math.sin(a) * e.r * 0.3 * s, vx: Math.cos(a) * (0.5 + s), vy: Math.sin(a) * (0.5 + s) - 0.35, r0: 0.12, r1: 0.42, life: 0.9 + this.rng() * 0.5, age: 0, c: P.soot, a0: 0.7 }); }
        this.markScorch(e.x, e.y, e.r);
      } else if (e.k === 'die') {
        // 擊毀（v3）：0–80 ms 大閃光 → 5 顆錯位火球（80–400 ms）→ 本色碎片飛出 → 煙往上飄；鏡頭震一下
        // v6：被擊中那一格整台變白 → 中心閃光 → 雲狀火球長大再變成煙往上飄 → 暖白衝擊波 → 車身色與履帶色碎片
        const y0 = e.y - 0.16;
        this.fx.push({ kind: 'whiteTank', x: e.x, y: e.y, body: e.body ?? 0, turret: e.turret ?? e.body ?? 0, age: 0, life: 0.07 });
        this.fx.push({ kind: 'flash', x: e.x, y: y0, r: 0.9, age: 0, life: 0.08 });
        const lobes = [];
        const n = 7 + this.rng.int(3);
        for (let i = 0; i < n; i++) { const a = (i / n) * 6.28 + this.rng() * 0.5, d = 0.25 + this.rng() * 0.2; lobes.push({ dx: Math.cos(a) * d, dy: Math.sin(a) * d * 0.85, r: 0.38 + this.rng() * 0.18 }); }
        lobes.push({ dx: 0, dy: 0, r: 0.55 });
        this.fx.push({ kind: 'cloud', x: e.x, y: y0, r: 0.78, lobes, age: 0, life: 0.65 });   // v10：火球大一點（約 1.5 格）
        this.fx.push({ kind: 'ring', x: e.x, y: e.y, r0: 0.3, r: 1.7, w: 0.13, age: 0, life: 0.32, c: 'rgba(240, 114, 60, 1)' });   // v9：粗一點（白地上 2 px 太弱）
        const T = tankTones(e.color || 'p1');
        for (let i = 0; i < 12; i++) { const a = this.rng() * 6.28, s = 1.6 + this.rng() * 1.8; this.parts.push({ kind: 'chip', x: e.x, y: y0, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.0, g: 3.4, r0: 0.07 + this.rng() * 0.06, life: 0.8, age: 0, c: i % 3 === 2 ? P.tread : i % 3 ? T.base : T.line, rot: this.rng() * 6, spin: (this.rng() - 0.5) * 18 }); }
        for (let i = 0; i < 6; i++) { const a = this.rng() * 6.28; this.parts.push({ x: e.x + Math.cos(a) * 0.3, y: y0 + Math.sin(a) * 0.25, vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.2 - 0.6, r0: 0.25, r1: 0.6, life: 0.9, age: -0.25, c: i % 3 ? '#B9B0C9' : '#A69CB8', a0: 0.75, edge: '#8E84A0' }); }   // v10：煙深一階（淺地上要看得到）
        this.shake = { t: this.time, amp: 3, dur: 0.22 };
        this.pendingMarks.push({ e, at: this.time + 0.15 });   // X 等火球蓋住之後才出現
      } else if (e.k === 'cork') {
        for (let i = 0; i < 10; i++) { const a = this.rng() * 6.28, s = 0.6 + this.rng() * 1.4; this.parts.push({ kind: 'chip', x: e.tx + 0.5, y: e.ty + 0.5 - BLOCK_H, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1, g: 3, r0: 0.05 + this.rng() * 0.05, life: 0.8, age: 0, c: i % 2 ? P.corkTop : P.corkSide, rot: this.rng() * 6, spin: (this.rng() - 0.5) * 14 }); }
      } else if (e.k === 'mine') {
        this.fx.push({ kind: 'ring', x: e.x, y: e.y, r: 0.5, age: 0, life: 0.35, c: 'rgba(242, 201, 76, 1)' });
      }
    }
    void state;
  }

  // 換地圖或新回合：清掉痕跡與特效
  reset() {
    this.parts = []; this.fx = []; this.recoil.clear(); this.trackOdo.clear(); this.trails.clear(); this.pendingMarks = [];
    if (this.decal) { const g = this.decal.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.decal.width, this.decal.height); }
    if (this.tracks) { const g = this.tracks.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.tracks.width, this.tracks.height); }
  }
}

export { BULLETS };
