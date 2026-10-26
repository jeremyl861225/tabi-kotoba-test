// 坦克造型（v11）：每一種車種一個輪廓——車身、炮塔、炮管、配件都不一樣，
// 但描邊、受光邊、厚度、深色履帶是同一套語彙（ART.md「形狀語彙」）。
// 畫的時候座標是場地格子；車身朝 +x（t.body 轉過去），炮塔朝 t.turret。
const TREAD = '#3F4660', CLEAT = '#5F6680';
const STEEL = '#EEF1F7', STEEL_D = '#8E97AB', STEEL_M = '#C9CFDC';
const GOLD = '#F8C21A', GOLD_D = '#A97A22';
const MINE_Y = '#F2C94C', MINE_D = '#6E5A2E', LED = '#E5484D';

// k：整台的大小（碰撞一樣，只是畫的大小）；pad：沒有履帶的固定砲台
export const SHAPES = {
  std: { k: 1 }, scout: { k: 0.84 }, heavy: { k: 1.12 }, bunker: { k: 1.04, pad: true },
  sniper: { k: 1 }, layer: { k: 1 }, rocket: { k: 1 }, gatling: { k: 1 }, raider: { k: 1 },
  stealth: { k: 1 }, ace: { k: 1.04 }, bomber: { k: 1.04 }, commander: { k: 1.42 },   // v12：頭目大 1.42 倍
};
export const shapeOf = (t) => (SHAPES[t.shape] ? t.shape : 'std');

function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}
const box = (g, x, y, w, h, r) => { g.beginPath(); rr(g, x, y, w, h, r); };
function poly(g, pts, s = 1) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s)));
  g.closePath();
}
const dot = (g, x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };

const RAIDER = [[0.44, 0], [0.2, -0.27], [-0.4, -0.27], [-0.31, 0], [-0.4, 0.27], [0.2, 0.27]];
const STEALTH = [[0.43, -0.1], [0.43, 0.1], [0.24, 0.28], [-0.36, 0.28], [-0.43, 0.12], [-0.43, -0.12], [-0.36, -0.28], [0.24, -0.28]];
const HEX = [[0.45, 0], [0.24, -0.3], [-0.3, -0.3], [-0.45, 0], [-0.3, 0.3], [0.24, 0.3]];
const OCT = Array.from({ length: 8 }, (_, i) => [Math.cos((i + 0.5) * Math.PI / 4) * 0.34, Math.sin((i + 0.5) * Math.PI / 4) * 0.34]);

// 車身頂面的輪廓（s：縮放，畫受光邊的裁切用）
function hull(g, shape, s = 1) {
  switch (shape) {
    case 'scout': box(g, -0.36 * s, -0.24 * s, 0.72 * s, 0.48 * s, 0.2 * s); break;
    case 'heavy': box(g, -0.44 * s, -0.3 * s, 0.88 * s, 0.6 * s, 0.08 * s); break;
    case 'sniper': box(g, -0.45 * s, -0.22 * s, 0.9 * s, 0.44 * s, 0.1 * s); break;
    case 'raider': poly(g, RAIDER, s); break;
    case 'stealth': poly(g, STEALTH, s); break;
    case 'commander': poly(g, HEX, s); break;
    case 'bomber': box(g, -0.4 * s, -0.31 * s, 0.8 * s, 0.62 * s, 0.14 * s); break;
    case 'bunker': poly(g, OCT, s); break;
    default: box(g, -0.41 * s, -0.28 * s, 0.82 * s, 0.56 * s, 0.12 * s);
  }
}

function tracks(g, t, T, shape) {
  const half = shape === 'scout' ? 0.38 : shape === 'sniper' ? 0.45 : 0.47;
  const w = shape === 'heavy' || shape === 'commander' ? 0.22 : 0.2;
  for (const side of [-1, 1]) {
    const y = side > 0 ? 0.18 : -0.18 - w;
    g.fillStyle = T.deep; box(g, -half, y, half * 2, w, 0.08); g.fill();
    g.fillStyle = TREAD; box(g, -half + 0.02, y + 0.01, half * 2 - 0.04, w - 0.02, 0.07); g.fill();
    g.strokeStyle = CLEAT; g.lineWidth = 0.028;
    const off = -((t.odo * 1.0) % 0.1);
    g.beginPath();
    for (let x = -half + 0.05 + off + 0.1; x < half - 0.05; x += 0.1) { g.moveTo(x, y + 0.025); g.lineTo(x, y + w - 0.025); }
    g.stroke();
  }
}

// 固定砲台的底座：八角座＋一圈沙包
function pad(g, T) {
  g.fillStyle = TREAD; poly(g, OCT, 1.32); g.fill();
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.2832;
    g.save(); g.rotate(a); g.translate(0.4, 0);
    g.fillStyle = '#E6DAC2'; box(g, -0.07, -0.11, 0.14, 0.22, 0.06); g.fill();
    g.strokeStyle = 'rgba(120, 100, 80, 0.55)'; g.lineWidth = 0.02; g.stroke();
    g.restore();
  }
  void T;
}

// 車身頂面上的細節（各車種的辨識點）
function details(g, t, T, shape) {
  const panel = (x, y, w, h, r) => { g.fillStyle = T.light; box(g, x, y, w, h, r); g.fill(); };
  const nose = () => {
    g.fillStyle = T.dark;
    g.beginPath(); g.moveTo(0.27, -0.2); g.lineTo(0.37, -0.15); g.lineTo(0.37, 0.15); g.lineTo(0.27, 0.2); g.closePath(); g.fill();
    dot(g, 0.35, -0.2, 0.03, 'rgba(255, 240, 200, 0.9)'); dot(g, 0.35, 0.2, 0.03, 'rgba(255, 240, 200, 0.9)');
  };
  const rivets = (pts) => { for (const [x, y] of pts) dot(g, x, y, 0.02, T.dark); };
  switch (shape) {
    case 'scout':
      panel(-0.26, -0.15, 0.46, 0.3, 0.12);
      g.fillStyle = T.dark; box(g, -0.3, -0.035, 0.6, 0.07, 0.035); g.fill();   // 中線
      g.strokeStyle = TREAD; g.lineWidth = 0.022; g.beginPath(); g.moveTo(-0.28, -0.16); g.lineTo(-0.44, -0.3); g.stroke();   // 天線
      dot(g, -0.44, -0.3, 0.03, LED);
      break;
    case 'heavy':
      panel(-0.32, -0.2, 0.6, 0.4, 0.06);
      for (const s of [-1, 1]) {   // 側裙
        g.fillStyle = STEEL_M; box(g, -0.4, s > 0 ? 0.2 : -0.28, 0.8, 0.08, 0.03); g.fill();
        g.strokeStyle = STEEL_D; g.lineWidth = 0.018; g.stroke();
        for (const x of [-0.3, -0.1, 0.1, 0.3]) dot(g, x, s > 0 ? 0.24 : -0.24, 0.014, STEEL_D);
      }
      g.fillStyle = T.dark; box(g, 0.32, -0.24, 0.1, 0.48, 0.04); g.fill();   // 前擋板
      break;
    case 'sniper':
      panel(-0.36, -0.13, 0.66, 0.26, 0.08);
      g.fillStyle = T.dark;   // 迷彩斜紋
      for (const x of [-0.28, -0.08, 0.12]) { g.beginPath(); g.moveTo(x, -0.13); g.lineTo(x + 0.1, -0.13); g.lineTo(x + 0.02, 0.13); g.lineTo(x - 0.08, 0.13); g.closePath(); g.globalAlpha *= 0.35; g.fill(); g.globalAlpha /= 0.35; }
      nose();
      break;
    case 'layer':
      panel(-0.18, -0.19, 0.43, 0.38, 0.08);
      nose();
      g.fillStyle = TREAD; box(g, -0.42, -0.25, 0.2, 0.5, 0.05); g.fill();   // 後面的地雷架
      for (const y of [-0.16, 0, 0.16]) { dot(g, -0.32, y, 0.072, MINE_D); dot(g, -0.32, y, 0.058, MINE_Y); dot(g, -0.32, y, 0.022, LED); }
      break;
    case 'rocket':
      panel(-0.31, -0.19, 0.56, 0.38, 0.08);
      nose();
      g.fillStyle = T.dark; for (const s of [-1, 1]) { box(g, -0.36, s * 0.22 - 0.03, 0.5, 0.06, 0.03); g.fill(); }   // 側面導軌
      break;
    case 'gatling':
      panel(-0.12, -0.19, 0.37, 0.38, 0.08);
      nose();
      g.fillStyle = TREAD; box(g, -0.39, -0.2, 0.22, 0.4, 0.05); g.fill();   // 彈鏈箱
      g.strokeStyle = MINE_Y; g.lineWidth = 0.025; g.beginPath();
      for (let y = -0.15; y <= 0.15; y += 0.075) { g.moveTo(-0.36, y); g.lineTo(-0.2, y); }
      g.stroke();
      break;
    case 'raider':
      g.fillStyle = T.light; poly(g, RAIDER, 0.7); g.fill();
      g.fillStyle = T.dark; poly(g, [[0.34, 0], [0.1, -0.05], [-0.3, -0.05], [-0.3, 0.05], [0.1, 0.05]]); g.fill();   // 中脊
      for (const s of [-1, 1]) { g.fillStyle = T.deep; poly(g, [[-0.3, s * 0.27], [-0.46, s * 0.36], [-0.42, s * 0.2]]); g.fill(); }   // 尾翼
      break;
    case 'stealth':
      g.fillStyle = T.lighter; poly(g, [[0.43, -0.1], [0.24, -0.28], [-0.05, 0]]); g.fill();
      g.fillStyle = T.light; poly(g, [[0.43, 0.1], [0.24, 0.28], [-0.05, 0]]); g.fill();
      g.strokeStyle = T.dark; g.lineWidth = 0.016; g.beginPath(); g.moveTo(-0.36, -0.28); g.lineTo(0, 0); g.lineTo(-0.36, 0.28); g.moveTo(0, 0); g.lineTo(0.43, 0); g.stroke();
      break;
    case 'ace':
      panel(-0.31, -0.19, 0.56, 0.38, 0.08);
      nose();
      g.fillStyle = T.deep; box(g, -0.5, -0.3, 0.1, 0.6, 0.04); g.fill();   // 尾翼
      g.fillStyle = TREAD; box(g, -0.44, -0.2, 0.1, 0.05, 0.02); g.fill(); box(g, -0.44, 0.15, 0.1, 0.05, 0.02); g.fill();
      g.fillStyle = 'rgba(255, 255, 255, 0.7)'; for (const s of [-1, 1]) { box(g, -0.3, s * 0.21 - 0.02, 0.6, 0.04, 0.02); g.fill(); }   // 賽車條
      break;
    case 'bomber':
      panel(-0.3, -0.18, 0.5, 0.36, 0.1);
      nose();
      for (const s of [-1, 1]) {   // 兩邊的彈藥箱
        g.fillStyle = '#C9B48A'; box(g, -0.36, s > 0 ? 0.16 : -0.28, 0.24, 0.12, 0.03); g.fill();
        g.strokeStyle = 'rgba(90, 70, 40, 0.6)'; g.lineWidth = 0.016; g.stroke();
      }
      break;
    case 'commander':
      g.fillStyle = T.light; poly(g, HEX, 0.72); g.fill();
      g.strokeStyle = GOLD; g.lineWidth = 0.03; poly(g, HEX, 0.86); g.stroke();   // 金色飾邊
      for (const s of [-1, 1]) {   // 兩支天線＋小旗
        g.strokeStyle = TREAD; g.lineWidth = 0.022; g.beginPath(); g.moveTo(-0.3, s * 0.2); g.lineTo(-0.48, s * 0.36); g.stroke();
        dot(g, -0.48, s * 0.36, 0.03, GOLD);
      }
      break;
    case 'bunker':
      break;
    default:
      panel(-0.31, -0.19, 0.56, 0.38, 0.08);
      nose();
      rivets([[-0.26, -0.14], [-0.26, 0.14], [0.2, -0.14], [0.2, 0.14]]);
  }
}

// 裝甲板：還剩幾層（hp − 1）就畫幾片鋼板，被打一下掉一片
function armor(g, t, shape) {
  const n = Math.max(0, (t.hp || 1) - 1);
  if (!n) return;
  const slots = shape === 'commander' ? [[0.04, -0.2, 0.22, 0.4], [-0.3, -0.2, 0.2, 0.4]] : [[0.06, -0.22, 0.22, 0.44], [-0.3, -0.22, 0.2, 0.44]];
  for (let i = 0; i < Math.min(n, slots.length); i++) {
    const [x, y, w, h] = slots[i];
    g.fillStyle = STEEL; box(g, x, y, w, h, 0.04); g.fill();
    g.strokeStyle = STEEL_D; g.lineWidth = 0.02; g.stroke();
    for (const [rx, ry] of [[x + 0.04, y + 0.05], [x + w - 0.04, y + 0.05], [x + 0.04, y + h - 0.05], [x + w - 0.04, y + h - 0.05]]) dot(g, rx, ry, 0.016, STEEL_D);
  }
}

// 炮管（在炮塔座標：+x 是炮口方向）
export function drawBarrelArt(g, t, T, rec, shape = shapeOf(t)) {
  const tube = (y, len, hw, x0 = 0.08) => {
    const a = x0 - rec, b = len - rec;
    g.fillStyle = T.line; box(g, a, y - hw - 0.014, b - a, (hw + 0.014) * 2, 0.03); g.fill();
    g.fillStyle = T.dark; box(g, a, y - hw, b - a, hw * 2, 0.025); g.fill();
    g.fillStyle = 'rgba(255, 248, 236, 0.25)'; g.fillRect(a + 0.05, y - hw + 0.012, b - a - 0.1, hw * 0.55);
    return b;
  };
  const ring = (x, y, hw, w = 0.08, c = T.deep) => { g.fillStyle = c; box(g, x, y - hw - 0.022, w, (hw + 0.022) * 2, 0.025); g.fill(); };
  switch (shape) {
    case 'gatling': {
      for (const y of [-0.065, 0, 0.065]) tube(y, 0.62, 0.026);
      ring(0.3 - rec, 0, 0.1, 0.06); ring(0.52 - rec, 0, 0.1, 0.05);
      return;
    }
    case 'sniper': {
      const e = tube(0, 0.86, 0.045);
      ring(e - 0.1, 0, 0.045, 0.1);
      ring(0.42 - rec, 0, 0.045, 0.04);
      return;
    }
    case 'heavy': {
      for (const y of [-0.075, 0.075]) { const e = tube(y, 0.5, 0.05); ring(e - 0.09, y, 0.05, 0.1); }
      return;
    }
    case 'rocket': {
      for (const y of [-0.085, 0.085]) {
        const a = 0.02 - rec, b = 0.46 - rec;
        g.fillStyle = T.line; box(g, a, y - 0.07, b - a, 0.14, 0.04); g.fill();
        g.fillStyle = T.base; box(g, a + 0.012, y - 0.058, b - a - 0.024, 0.116, 0.035); g.fill();
        dot(g, b - 0.03, y, 0.04, TREAD); dot(g, b - 0.03, y, 0.022, '#F0723C');   // 火箭頭
      }
      return;
    }
    default:
  }
  // 一般：依彈種（長火箭管、寬口散彈、粗短爆裂、細長跳彈）
  const k = t.bullet || 'standard';
  const [len, hw] = { standard: [0.6, 0.064], rocket: [0.68, 0.058], ricochet: [0.64, 0.052], scatter: [0.52, 0.066], blast: [0.5, 0.088] }[k] || [0.6, 0.064];
  const L = shape === 'commander' ? len + 0.08 : shape === 'scout' ? len - 0.06 : len;
  const x1 = tube(0, L, hw);
  g.fillStyle = T.deep;
  if (k === 'scatter') { g.beginPath(); g.moveTo(x1 - 0.1, -hw); g.lineTo(x1 + 0.02, -hw - 0.035); g.lineTo(x1 + 0.02, hw + 0.035); g.lineTo(x1 - 0.1, hw); g.closePath(); g.fill(); }
  else if (k === 'rocket') { box(g, x1 - 0.13, -hw - 0.03, 0.06, (hw + 0.03) * 2, 0.02); g.fill(); box(g, x1 - 0.05, -hw - 0.02, 0.06, (hw + 0.02) * 2, 0.02); g.fill(); }
  else if (k === 'ricochet') { for (const o of [0.2, 0.36]) ring(0.08 - rec + o, 0, hw, 0.045); ring(x1 - 0.07, 0, hw, 0.08); }
  else ring(x1 - 0.09, 0, hw, 0.1);
  if (shape === 'commander') ring(x1 - 0.09, 0, hw, 0.1, GOLD);
}

// 炮塔（場地座標的中心，已經往上抬）
function turret(g, t, T, shape) {
  const base = (r) => { dot(g, 0, 0, r + 0.015, T.deep); };
  const round = (r) => {
    base(r);
    g.translate(0, -0.06);
    g.fillStyle = T.base; g.beginPath(); g.arc(0, 0, r, 0, 6.2832); g.fill();
    g.strokeStyle = T.line; g.lineWidth = 0.032; g.stroke();
    const hl = g.createRadialGradient(-0.07, -0.08, 0.01, -0.03, -0.04, r);
    hl.addColorStop(0, 'rgba(255, 250, 240, 0.55)'); hl.addColorStop(1, 'rgba(255, 250, 240, 0)');
    g.fillStyle = hl; g.beginPath(); g.arc(0, 0, r - 0.01, 0, 6.2832); g.fill();
  };
  const hatch = () => { g.rotate(t.turret); dot(g, -0.06, 0.02, 0.075, T.dark); dot(g, -0.07, 0.01, 0.05, T.light); };
  switch (shape) {
    case 'scout': round(0.15); hatch(); break;
    case 'heavy': case 'rocket': {
      g.save(); g.rotate(t.turret); g.fillStyle = T.deep; box(g, -0.23, -0.21, 0.46, 0.44, 0.08); g.fill(); g.restore();
      g.translate(0, -0.06); g.rotate(t.turret);
      g.fillStyle = T.base; box(g, -0.22, -0.2, 0.42, 0.4, 0.08); g.fill();
      g.strokeStyle = T.line; g.lineWidth = 0.032; g.stroke();
      g.fillStyle = T.light; box(g, -0.16, -0.14, 0.2, 0.18, 0.05); g.fill();
      dot(g, -0.08, 0.08, 0.05, T.dark);
      break;
    }
    case 'sniper': round(0.17); g.rotate(t.turret); g.fillStyle = TREAD; box(g, -0.08, -0.17, 0.26, 0.07, 0.03); g.fill(); dot(g, 0.18, -0.135, 0.025, '#9FD3F5'); break;
    case 'stealth': {
      base(0.18); g.translate(0, -0.06); g.rotate(t.turret);
      g.fillStyle = T.base; poly(g, [[0.2, 0], [0, -0.17], [-0.18, 0], [0, 0.17]]); g.fill();
      g.strokeStyle = T.line; g.lineWidth = 0.03; g.stroke();
      g.fillStyle = T.lighter; poly(g, [[0.2, 0], [0, -0.17], [-0.02, 0]]); g.fill();
      break;
    }
    case 'bomber': {
      base(0.2); g.translate(0, -0.06); g.rotate(t.turret);
      g.fillStyle = T.base; g.beginPath(); g.ellipse(0, 0, 0.19, 0.23, 0, 0, 6.2832); g.fill();
      g.strokeStyle = T.line; g.lineWidth = 0.032; g.stroke();
      dot(g, -0.06, 0, 0.07, T.dark); dot(g, -0.07, -0.01, 0.045, T.light);
      break;
    }
    case 'commander': {
      round(0.24);
      g.strokeStyle = GOLD; g.lineWidth = 0.03; g.beginPath(); g.arc(0, 0, 0.18, 0, 6.2832); g.stroke();
      g.fillStyle = GOLD; g.strokeStyle = GOLD_D; g.lineWidth = 0.014;   // 皇冠
      g.beginPath(); g.moveTo(-0.09, 0.05); g.lineTo(-0.09, -0.04); g.lineTo(-0.045, 0); g.lineTo(0, -0.07); g.lineTo(0.045, 0); g.lineTo(0.09, -0.04); g.lineTo(0.09, 0.05); g.closePath(); g.fill(); g.stroke();
      break;
    }
    case 'ace': {
      round(0.2);
      g.fillStyle = '#FFFFFF'; g.beginPath();   // 星
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 0.045 : 0.1; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill();
      break;
    }
    case 'bunker': round(0.24); g.strokeStyle = T.dark; g.lineWidth = 0.025; g.beginPath(); g.arc(0, 0, 0.15, 0, 6.2832); g.stroke(); hatch(); break;
    case 'raider': round(0.17); hatch(); break;
    default: round(0.2); hatch();
  }
}

// 整台坦克。o：{ K（整體縮放）, lift（離地高度）, rec（後座） }
export function drawTankArt(g, t, T, o) {
  const shape = shapeOf(t), S = SHAPES[shape];
  const { lift, rec } = o;
  g.save();
  g.translate(t.x, t.y); g.scale(o.K * S.k, o.K * S.k); g.translate(-t.x, -t.y);
  // 底盤
  g.save(); g.translate(t.x, t.y - lift * 0.35); g.rotate(t.body);
  if (S.pad) pad(g, T); else tracks(g, t, T, shape);
  g.restore();
  // 車身側面（往下的厚度）＋頂面
  g.save(); g.translate(t.x, t.y - lift + 0.075); g.rotate(t.body);
  g.fillStyle = T.deep; hull(g, shape); g.fill();
  g.restore();
  g.save(); g.translate(t.x, t.y - lift); g.rotate(t.body);
  g.fillStyle = T.base; hull(g, shape); g.fill();
  g.strokeStyle = T.line; g.lineWidth = 0.036; hull(g, shape); g.stroke();
  details(g, t, T, shape);
  armor(g, t, shape);
  // 受光邊：頂面左上（畫面座標，不跟著車身轉）
  g.save(); hull(g, shape, 0.9); g.clip(); g.rotate(-t.body);
  g.strokeStyle = T.lighter; g.globalAlpha *= 0.8; g.lineWidth = 0.05;
  g.beginPath(); g.arc(0.06, 0.06, 0.4, Math.PI * 0.95, Math.PI * 1.55); g.stroke();
  g.restore();
  g.restore();
  // 炮管、炮塔
  g.save(); g.translate(t.x, t.y - lift - 0.06); g.rotate(t.turret); drawBarrelArt(g, t, T, rec, shape); g.restore();
  g.save(); g.translate(t.x, t.y - lift); turret(g, t, T, shape); g.restore();
  g.restore();
  // 裝甲還剩幾層：頭上一條分段血條（v12：原本 4 pt 的小點看不到）；頭目的框是金色
  if ((t.maxHp || 1) > 1) {
    const n = t.maxHp, boss = n >= 3, sw = 0.24, sh = 0.1, gap = 0.04;
    const W = n * sw + (n - 1) * gap, x0 = t.x - W / 2, y0 = t.y - lift - 0.66 * o.K * S.k - sh;
    g.fillStyle = boss ? GOLD_D : 'rgba(46, 38, 58, 0.85)'; box(g, x0 - 0.04, y0 - 0.04, W + 0.08, sh + 0.08, 0.06); g.fill();
    for (let i = 0; i < n; i++) {
      g.fillStyle = i < (t.hp || 1) ? (boss ? GOLD : '#FFFFFF') : 'rgba(255, 255, 255, 0.16)';
      box(g, x0 + i * (sw + gap), y0, sw, sh, 0.035); g.fill();
    }
  }
}
