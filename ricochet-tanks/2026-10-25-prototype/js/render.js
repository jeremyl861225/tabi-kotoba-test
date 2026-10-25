// 畫面（Canvas 2D 向量）：玩具木盒裡的桌上戰場。規範在 ART.md。
// 座標：1 格＝1；斜俯視＝物體的頂面往上抬（木塊 0.42 格），看得到朝鏡頭的南面；投影往右下 45°。
// 靜態層（地板、投影、木框）與每一列木塊各畫成一張離屏畫布，換關或軟木塊被炸開才重畫。
import { COLS, ROWS, TANK, BULLETS, MINE } from './config.js';
import { TILE } from './maps.js';
import { hash32, makeRng, clamp, easeOutCubic } from './util.js';

const BLOCK_H = 0.42, TALL_H = 0.84, TANK_LIFT = 0.14, SHELL_LIFT = 0.16, RIM = 0.32, TRAY_H = 0.26;   // v5：木框變薄、比木塊矮，場地放大
const TANK_K = 1.1;   // 坦克畫大一點（碰撞半徑不變）：v3 審查「坦克只有 22 pt、不是焦點」
// 投影用 multiply 疊：保留底下的彩度、略帶紫（v3：一般疊色會變成灰褐、看起來髒）
const SHADOW = 'rgba(140, 120, 200, 0.5)';   // v5：再往紫偏一點（審查：投影色相比地板還暖）

// ---- 調色盤（ART.md）----
const P = {
  floor: '#E4CB97', floorA: '#E8D09D', floorB: '#DFC590', grain: '#CDAE78', seam: 'rgba(176, 140, 88, 0.35)',
  top: '#E0A862', topHi: '#F2C886', topGrain: 'rgba(181, 116, 56, 0.45)', side: '#94602F', sideLo: '#7E4F25',
  corkTop: '#B88E68', corkPit: '#8A6447', corkHi: '#DDBB95', corkSide: '#7A5940',
  holeRim: '#C9AC74', holeWall: '#6B5240', holeDeep: '#3E2F26',
  rimTop: '#B87C44', rimHi: '#D0965A', rimIn: '#7C4F2B', rimOut: '#5E3B22',
  table: '#2B2230', hatch: '#342A3A',
  tread: '#3E3530', cleat: '#5A4E46',
  shell: '#FFF4DF', shellLine: '#3B2A22', smoke: '#F4ECE2',
  flame0: '#FF9F43', flame1: '#FFE08A', flash: '#FFE48A', fire0: '#FFB347', fire1: '#F0723C', soot: '#E9E0D6', scorch: 'rgba(74, 58, 48, 0.25)',
  mine: '#F2C94C', mineBase: '#6E5A2E', mineLed: '#E5484D',
};
export const TANK_COLORS = {
  p1: '#3C7BE0', p2: '#E2504A', p3: '#3DAA62', p4: '#E9A93A',
  brown: '#9C6B3F', ash: '#8F8A84', teal: '#2E9C9A', yellow: '#E8C440', pink: '#E77FAE', green: '#4FA83D', violet: '#8A5CC7', white: '#EFEBE4', black: '#3D3842',
  cpuA: '#8A63D2', cpuB: '#2AA3A0', cpuC: '#6E7A8C',
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0}, ${c[1] | 0}, ${c[2] | 0}, ${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (h, k) => { const c = hex(h); return rgb([c[0] * k, c[1] * k, c[2] * k]); };
const WARM_WHITE = [255, 248, 236];
const tones = new Map();
export function tankTones(key) {
  if (tones.has(key)) return tones.get(key);
  const base = hex(TANK_COLORS[key] || TANK_COLORS.p1);
  const grayish = key === 'ash' || key === 'cpuC' || key === 'white';
  const t = {
    base: rgb(base), light: rgb(mix(base, WARM_WHITE, 0.32)), lighter: rgb(mix(base, WARM_WHITE, 0.55)),
    dark: rgb(mix(base, [40, 28, 36], 0.38)), deep: rgb(mix(base, [36, 24, 30], 0.6)), line: grayish ? '#3D4250' : rgb(mix(base, [30, 20, 26], 0.72)), raw: base,
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
      // 木紋（沿著四邊的框）
      g.strokeStyle = 'rgba(156, 106, 58, 0.55)'; g.lineWidth = 0.022;
      const r = makeRng(11);
      for (let i = 0; i < 2; i++) {
        const yy = yT + 0.09 + i * 0.13;
        g.beginPath(); g.moveTo(x0 + 0.3, yy); for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.5) g.lineTo(x, yy + (r() - 0.5) * 0.03); g.stroke();
        for (const xs of [x0 + 0.09 + i * 0.13, x1 - 0.22 + i * 0.13]) {
          g.beginPath(); g.moveTo(xs, yT + 0.6); for (let y = yT + 0.6; y < yB - 0.4; y += 0.5) g.lineTo(xs + (r() - 0.5) * 0.03, y); g.stroke();
        }
      }
      // 開口：內側看得到北內壁
      g.fillStyle = P.rimIn;
      g.fillRect(0, -TRAY_H, COLS, TRAY_H);
      const gr = g.createLinearGradient(0, -TRAY_H, 0, 0);
      gr.addColorStop(0, 'rgba(255, 220, 170, 0.10)'); gr.addColorStop(1, 'rgba(40, 20, 10, 0.28)');
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
      g.strokeStyle = 'rgba(140, 88, 40, 0.35)'; g.lineWidth = 0.02;
      const r = makeRng(12);
      for (let i = 0; i < 2; i++) {
        const yy = ROWS - TRAY_H + 0.1 + i * 0.1;
        g.beginPath(); g.moveTo(x0 + 0.3, yy); for (let x = x0 + 0.3; x < x1 - 0.3; x += 0.5) g.lineTo(x, yy + (r() - 0.5) * 0.03); g.stroke();
      }
    }
  }

  drawFloor(g, grid, mapKey) {
    // 木地板：長短不一的長木板、每列接縫錯開；明度差 ±3%（v1：原本等長交錯像磚牆）
    g.save();
    g.beginPath(); g.rect(0, 0, COLS, ROWS); g.clip();   // 地板的東西一律不出場地
    g.fillStyle = P.floor;
    g.fillRect(0, 0, COLS, ROWS);
    const r = makeRng(hash32(mapKey.length, 99));
    for (let y = 0; y < ROWS; y++) {
      let x = -r() * 4;
      while (x < COLS) {
        const len = 3.2 + r() * 2.6;
        const k = r();
        const x0 = Math.max(0, x), x1 = Math.min(COLS, x + len);
        if (x1 - x0 < 0.05) { x += len; continue; }   // 整片在場地外（寬度變負會往左畫到木框上）
        g.fillStyle = k < 0.33 ? P.floorA : k < 0.66 ? P.floorB : P.floor;
        g.fillRect(x0, y, x1 - x0, 1);
        g.strokeStyle = 'rgba(190, 154, 100, 0.2)'; g.lineWidth = 0.016;
        for (let i = 0; i < 2; i++) {
          const yy = y + 0.27 + i * 0.42 + (r() - 0.5) * 0.14;
          g.beginPath();
          g.moveTo(x0 + 0.12, yy);
          g.bezierCurveTo(x0 + (x1 - x0) * 0.35, yy + (r() - 0.5) * 0.1, x0 + (x1 - x0) * 0.7, yy + (r() - 0.5) * 0.1, x1 - 0.12, yy + (r() - 0.5) * 0.05);
          g.stroke();
        }
        if (x > 0) { g.fillStyle = 'rgba(176, 140, 88, 0.22)'; g.fillRect(x - 0.01, y, 0.02, 1); }
        x += len;
      }
      g.fillStyle = 'rgba(176, 140, 88, 0.2)'; g.fillRect(0, y - 0.008, COLS, 0.016);
    }
    // 牆腳的接觸陰影：貼著木塊底邊（南、東、西）0.06 格深色（v6：原本一圈圓角暈開，像光暈不像陰影）
    // v7：只畫背光那兩邊（南緣下方、東緣外側各 0.06 格），旁邊也是木塊就不畫（v6 每格各畫一個外擴矩形，凸出成「耳朵」）
    const solid = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && blockH(grid[y * COLS + x]) > 0;
    g.fillStyle = 'rgba(62, 44, 84, 0.35)';
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!solid(x, y)) continue;
      if (!solid(x, y + 1)) g.rect(x, y + 1, 1, 0.06);
      if (!solid(x + 1, y)) g.rect(x + 1, y + 0.55, 0.06, 0.45 + (solid(x, y + 1) ? 0 : 0.06));
    }
    g.fill();
    // 北內壁的陰影落在第一排地板
    const gr = g.createLinearGradient(0, 0, 0, 0.5);
    gr.addColorStop(0, 'rgba(70, 45, 30, 0.22)'); gr.addColorStop(1, 'rgba(70, 45, 30, 0)');
    g.fillStyle = gr; g.fillRect(0, 0, COLS, 0.5);
    const gl = g.createLinearGradient(0, 0, 0.35, 0);
    gl.addColorStop(0, 'rgba(70, 45, 30, 0.16)'); gl.addColorStop(1, 'rgba(70, 45, 30, 0)');
    g.fillStyle = gl; g.fillRect(0, 0, 0.35, ROWS);
    g.restore();
  }

  // 坑洞：看得到北內壁（地板木頭切面、往下變暗）、外緣一圈斜面、南緣受光亮線；相鄰的連成一片（v3）
  drawHoles(g, grid) {
    const isHole = (x, y) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid[y * COLS + x] === TILE.HOLE;
    const WALL = 0.42, B = 0.06;
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
    g.fillStyle = '#5C4636';
    g.beginPath();
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      if (!isHole(x, y)) continue;
      const l = isHole(x - 1, y) ? 0 : B, r = isHole(x + 1, y) ? 0 : B, t = isHole(x, y - 1) ? 0 : B, b = isHole(x, y + 1) ? 0 : B;
      rrc(g, x + l, y + t, 1 - l - r, 1 - t - b, corners(x, y, 0.07));
    }
    g.fill();
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
        wg.addColorStop(0, '#9A7652'); wg.addColorStop(0.12, '#7A5E46'); wg.addColorStop(1, '#4E3B2E');
        g.fillStyle = wg; g.fillRect(x0, y0, x1 - x0, WALL);
        g.fillStyle = 'rgba(60, 40, 24, 0.3)';
        g.fillRect(x0, y0 + 0.07, x1 - x0, 0.016); g.fillRect(x0, y0 + 0.17, x1 - x0, 0.012);
        g.fillStyle = '#9C7F52'; g.fillRect(x0 - (l ? B : 0), y0 - B, x1 - x0 + (l ? B : 0) + (r ? B : 0), 0.025);   // 北緣暗線
      }
      if (l) { g.fillStyle = 'rgba(255, 220, 170, 0.07)'; g.fillRect(x0, y0, 0.05, y1 - y0); }
      if (r) { g.fillStyle = 'rgba(20, 10, 5, 0.18)'; g.fillRect(x1 - 0.05, y0, 0.05, y1 - y0); }
      if (b) { g.fillStyle = '#D9BD86'; g.fillRect(x0 - (l ? B : 0), y1 + B - 0.05, x1 - x0 + (l ? B : 0) + (r ? B : 0), 0.05); }   // 南緣亮唇
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
    const h = blockH(t), cork = t === TILE.CORK, tall = t === TILE.TALL;
    const R = cork ? 0.14 : 0.07;   // 軟木塊比較圓（一顆一顆、打得壞的感覺）
    const rng = makeRng(hash32(x, y, t));
    const vary = (rng() - 0.5) * 0.06;   // 每塊明度差 ±3%
    const topC = cork ? P.corkTop : P.top, sideC = cork ? P.corkSide : P.side;
    // 南面（朝鏡頭）
    g.fillStyle = sideC;
    rr(g, x + 0.01, y - h + 0.5, 0.98, h + 0.49, R); g.fill();
    if (!cork) {
      const gr = g.createLinearGradient(0, y + 1 - h, 0, y + 1);
      gr.addColorStop(0, 'rgba(255, 210, 150, 0.10)'); gr.addColorStop(1, 'rgba(60, 30, 10, 0.28)');
      g.fillStyle = gr; g.fillRect(x + 0.02, y + 1 - h, 0.96, h - 0.02);
      // 側面木紋
      g.strokeStyle = 'rgba(70, 40, 15, 0.28)'; g.lineWidth = 0.016;
      for (let i = 0; i < (tall ? 4 : 2); i++) {
        const yy = y + 1 - h + 0.12 + i * 0.17 + rng() * 0.04;
        g.beginPath(); g.moveTo(x + 0.06, yy); g.quadraticCurveTo(x + 0.5, yy + (rng() - 0.5) * 0.05, x + 0.94, yy); g.stroke();
      }
      if (tall) { g.fillStyle = 'rgba(60, 30, 10, 0.35)'; g.fillRect(x + 0.02, y + 1 - BLOCK_H - 0.01, 0.96, 0.025); }
    } else {
      g.fillStyle = 'rgba(70, 45, 25, 0.25)';
      for (let i = 0; i < 7; i++) { g.beginPath(); g.arc(x + 0.08 + rng() * 0.84, y + 1 - h + 0.06 + rng() * (h - 0.12), 0.018 + rng() * 0.02, 0, 6.28); g.fill(); }
    }
    // 頂面
    const ty = y - h;
    g.fillStyle = topC;
    rr(g, x + 0.01, ty + 0.01, 0.98, 0.98, R); g.fill();
    g.fillStyle = vary > 0 ? `rgba(255, 240, 210, ${vary})` : `rgba(80, 40, 10, ${-vary})`;
    rr(g, x + 0.01, ty + 0.01, 0.98, 0.98, R); g.fill();
    if (!cork) {
      // 年輪木紋
      g.strokeStyle = P.topGrain; g.lineWidth = 0.018;
      const vert = rng() < 0.5;
      for (let i = 0; i < 4; i++) {
        const o = 0.16 + i * 0.22 + (rng() - 0.5) * 0.06;
        g.beginPath();
        if (vert) { g.moveTo(x + o, ty + 0.08); g.bezierCurveTo(x + o + (rng() - 0.5) * 0.12, ty + 0.4, x + o + (rng() - 0.5) * 0.12, ty + 0.6, x + o, ty + 0.92); }
        else { g.moveTo(x + 0.08, ty + o); g.bezierCurveTo(x + 0.4, ty + o + (rng() - 0.5) * 0.12, x + 0.6, ty + o + (rng() - 0.5) * 0.12, x + 0.92, ty + o); }
        g.stroke();
      }
    } else {
      for (let i = 0; i < 22; i++) {
        g.fillStyle = i % 3 ? P.corkPit : P.corkHi;
        g.beginPath(); g.ellipse(x + 0.1 + rng() * 0.8, ty + 0.1 + rng() * 0.8, 0.02 + rng() * 0.03, 0.016 + rng() * 0.022, rng() * 3, 0, 6.28); g.fill();
      }
    }
    // 倒角：左上亮邊、右下暗邊
    g.lineWidth = 0.035;
    g.strokeStyle = cork ? 'rgba(245, 222, 190, 0.8)' : P.topHi;
    g.beginPath(); g.moveTo(x + 0.04, ty + 0.9); g.lineTo(x + 0.04, ty + 0.1); g.quadraticCurveTo(x + 0.04, ty + 0.04, x + 0.1, ty + 0.04); g.lineTo(x + 0.9, ty + 0.04); g.stroke();
    g.strokeStyle = 'rgba(90, 50, 20, 0.35)';
    g.beginPath(); g.moveTo(x + 0.96, ty + 0.1); g.lineTo(x + 0.96, ty + 0.9); g.quadraticCurveTo(x + 0.96, ty + 0.96, x + 0.9, ty + 0.96); g.lineTo(x + 0.1, ty + 0.96); g.stroke();
    void grid;
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
      tg.fillStyle = 'rgba(0, 0, 0, 0.08)';   // 約 6 秒淡掉
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
        tg.strokeStyle = 'rgba(205, 174, 120, 0.3)'; tg.lineWidth = 0.06;   // v7：細、淡、沒有橫齒（原本像鉛筆亂畫）
        tg.beginPath(); tg.moveTo(a.x, a.y); tg.lineTo(b.x, b.y); tg.stroke();
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
    // 腳下的圈（v5：敵我一眼分得出）：玩家＝亮盤＋本色粗圈＋暖白內圈；電腦＝只有一道細細的本色圈
    const T = tankTones(t.color);
    const R = 0.6 * TANK_K;
    if (t.kind === 'player') {
      g.fillStyle = 'rgba(255, 246, 228, 0.24)';
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R, R * 0.93, 0, 0, 6.28); g.fill();
      g.strokeStyle = T.base; g.lineWidth = 0.075;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R, R * 0.93, 0, 0, 6.28); g.stroke();
      g.strokeStyle = 'rgba(255, 244, 223, 0.95)'; g.lineWidth = 0.035;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R - 0.055, (R - 0.055) * 0.93, 0, 0, 6.28); g.stroke();
    } else {
      g.globalAlpha = 0.14; g.fillStyle = T.base;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R * 0.95, R * 0.88, 0, 0, 6.28); g.fill();
      g.globalAlpha = 0.85; g.strokeStyle = T.base; g.lineWidth = 0.05;
      g.beginPath(); g.ellipse(t.x, t.y + 0.02, R * 0.95, R * 0.88, 0, 0, 6.28); g.stroke();
      g.globalAlpha = 1;
    }
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
    g.fillStyle = 'rgba(156, 123, 168, 0.22)';
    g.beginPath(); g.ellipse(b.x + SHELL_LIFT, b.y + SHELL_LIFT, 0.1, 0.07, Math.atan2(b.vy, b.vx), 0, 6.28); g.fill();   // 45° 往右下
    g.restore();
  }

  // 煙尾：每顆炮彈記住走過的點，畫成一條由粗變細、由濃變淡的帶子（v3：原本一顆顆圓疊成珍珠串）
  trail(b) {
    let tr = this.trails.get(b.id);
    if (!tr) { tr = { pts: [], rocket: b.type === 'rocket', last: null }; this.trails.set(b.id, tr); }
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
      for (const [w, al, c, dy] of [[W * 1.05, 0.22, '205, 184, 154', 0.03], [W, 0.36, '248, 242, 233', 0], [W * 0.5, 0.5, '255, 250, 242', 0]]) {
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
    const oc = owner ? tankTones(owner).raw : [59, 42, 34];
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
      g.fillStyle = P.shell;
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
      g.fillStyle = 'rgba(255, 255, 250, 0.9)';
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
    const T = tankTones(aim.color || 'p1');
    let seg = 0, along = 0.0;
    const spacing = 0.26;
    let carry = TANK.muzzle;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-4) continue;
      const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
      let s = carry;
      while (s < L) {
        // 亮木地板上要看得清楚：用玩家本色，第一段實、反彈後淡（v2：原本的淺色點幾乎看不見）
        const px = a.x + ux * s, py = a.y + uy * s;
        g.globalAlpha = seg === 0 ? 0.9 : 0.45;
        g.fillStyle = T.base;
        g.beginPath(); g.arc(px, py, seg === 0 ? 0.058 : 0.045, 0, 6.28); g.fill();
        if (seg === 0) { g.fillStyle = 'rgba(255, 250, 240, 0.85)'; g.beginPath(); g.arc(px - 0.012, py - 0.012, 0.02, 0, 6.28); g.fill(); }
        s += spacing; along += spacing;
      }
      carry = s - L;
      seg++;
      // 反彈點：本色外圈＋暖白內圈的空心圈
      if (i < pts.length - 2 && seg <= 2) {
        g.globalAlpha = seg === 1 ? 0.95 : 0.5;
        g.strokeStyle = T.base; g.lineWidth = 0.05;
        g.beginPath(); g.arc(b.x, b.y, 0.14, 0, 6.28); g.stroke();
        g.strokeStyle = 'rgba(255, 244, 223, 0.95)'; g.lineWidth = 0.025;
        g.beginPath(); g.arc(b.x, b.y, 0.1, 0, 6.28); g.stroke();
      }
      if (seg > 1) break;
    }
    g.globalAlpha = 1;
    // 會打到人：終點一個準心圈
    if (aim.hit) {
      const e = pts[pts.length - 1];
      g.strokeStyle = aim.hitFoe ? 'rgba(229, 72, 77, 0.85)' : 'rgba(255, 248, 236, 0.8)'; g.lineWidth = 0.045;
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
        g.globalAlpha = (1 - k) * 0.9;
        g.strokeStyle = f.c || 'rgba(255, 244, 223, 1)'; g.lineWidth = (f.w || 0.05) * (1 - k);
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
        g.fillStyle = '#FFF4DF';
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
          lobes(1.05, 0.05, '#B8AC9F', 0.75 * toSmoke * (1 - toSmoke * 0.6));
          lobes(1, 0, P.soot, 0.8 * toSmoke * (1 - toSmoke * 0.6));
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
      g.fillStyle = `rgba(255, 246, 225, ${a})`;
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
      g.fillStyle = tankTones(t.color).deep; g.globalAlpha = 0.85;
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
        for (let i = 0; i < 3; i++) this.parts.push({ x: e.x + Math.cos(e.a) * 0.05, y: e.y - TANK_LIFT - 0.06, vx: Math.cos(e.a) * (0.5 + i * 0.3) + (this.rng() - 0.5) * 0.25, vy: Math.sin(e.a) * (0.5 + i * 0.3) + (this.rng() - 0.5) * 0.25, r0: 0.04, r1: 0.11 - i * 0.015, life: 0.4, age: 0, c: '#F4ECE2', a0: 0.85, edge: '#D9CBB8' });
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
        this.fx.push({ kind: 'cloud', x: e.x, y: y0, r: 0.62, lobes, age: 0, life: 0.6 });
        this.fx.push({ kind: 'ring', x: e.x, y: e.y, r0: 0.3, r: 1.6, w: 0.075, age: 0, life: 0.25, c: 'rgba(255, 244, 223, 1)' });
        const T = tankTones(e.color || 'p1');
        for (let i = 0; i < 9; i++) { const a = this.rng() * 6.28, s = 1.6 + this.rng() * 1.6; this.parts.push({ kind: 'chip', x: e.x, y: y0, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 1.0, g: 3.4, r0: 0.05 + this.rng() * 0.04, life: 0.8, age: 0, c: i % 3 === 2 ? P.tread : i % 3 ? T.base : T.line, rot: this.rng() * 6, spin: (this.rng() - 0.5) * 18 }); }
        for (let i = 0; i < 6; i++) { const a = this.rng() * 6.28; this.parts.push({ x: e.x + Math.cos(a) * 0.3, y: y0 + Math.sin(a) * 0.25, vx: Math.cos(a) * 0.25, vy: Math.sin(a) * 0.2 - 0.45, r0: 0.25, r1: 0.65, life: 0.9, age: -0.25, c: i % 3 ? P.soot : '#CFC6BC', a0: 0.65, edge: '#B8AC9F' }); }
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
