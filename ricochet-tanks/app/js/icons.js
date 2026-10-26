// 共用的小圖（SVG 字串）：彈種、迷你坦克。HUD、搖桿、選單都用這一份，風格才一致。
// 炮彈（v12）：尖頭彈體＋白色彈頭＋一圈金色彈帶（原本的膠囊像藥丸）
const SHELL = (x, y, a, w = 9, h = 5) => {
  const L = x - w / 2, R = x + w / 2, T = y - h / 2, B = y + h / 2, n = R - h * 0.95, c = h * 0.28;
  const body = `M${L + c} ${T}H${n}Q${R} ${y - h * 0.12} ${R} ${y}Q${R} ${y + h * 0.12} ${n} ${B}H${L + c}Q${L} ${B} ${L} ${B - c}V${T + c}Q${L} ${T} ${L + c} ${T}Z`;
  const tip = `M${n} ${T}Q${R} ${y - h * 0.12} ${R} ${y}Q${R} ${y + h * 0.12} ${n} ${B}Z`;
  return `<g transform="rotate(${a} ${x} ${y})"><path d="${body}" fill="#3F4660"/><path d="${tip}" fill="#fff"/><rect x="${L + w * 0.24}" y="${T}" width="${w * 0.09}" height="${h}" fill="#F2C94C"/></g>`;
};

// 彈種圖示（v14 重畫，48×48）：每種彈各有一個縮到 34 pt 也認得的主輪廓——
// 標準＝一顆大尖頭彈＋一道直線、火箭＝帶尾翼與火焰的細長彈、跳彈＝大「Z」折線＋牆（不畫彈身）、散彈＝一點發出三顆大彈、爆裂＝圓炸彈＋引信＋爆風圈
const WALL = (x1, x2, y) => `<path d="M${x1} ${y}H${x2}" stroke="#C3CAD8" stroke-width="3.2" stroke-linecap="round"/>`;
const TRACK = (d, c = '#8790AB') => `<path d="${d}" fill="none" stroke="${c}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="0.1 3.6"/>`;
const BOUNCE = (x, y) => `<circle cx="${x}" cy="${y}" r="2.6" fill="#fff" stroke="#2BB2CB" stroke-width="1.6"/>`;
export const BULLET_SVG = {
  standard: `${TRACK('M5 43L14 32')}${SHELL(27.5, 21, -38, 27, 14)}`,
  rocket: `<g transform="rotate(-38 24 24)">
    <path d="M9 24Q1 20.5 -3 24Q1 27.5 9 24Z" fill="#F0723C"/><path d="M8 24Q2 22.4 0 24Q2 25.6 8 24Z" fill="#FFE08A"/>
    <path d="M11 18.6L5.6 11.4H18L19 18.6Z" fill="#F8C21A"/><path d="M11 29.4L5.6 36.6H18L19 29.4Z" fill="#F8C21A"/>
    <rect x="9" y="18.4" width="25" height="11.2" rx="4.4" fill="#3F4660"/>
    <path d="M30 18.4Q45 24 30 29.6Z" fill="#fff" stroke="#3F4660" stroke-width="1.4" stroke-linejoin="round"/>
    <rect x="23" y="18.4" width="3.4" height="11.2" fill="#F2C94C"/><circle cx="16.5" cy="24" r="2.2" fill="#9ED6E4"/></g>
    <path d="M4 14H13M2 20H9M9 40H20M12 45H22" stroke="#C3CAD8" stroke-width="1.8" stroke-linecap="round"/>`,
  ricochet: `${WALL(8, 28, 6)}${WALL(18, 42, 42)}<path d="M7 40L17 10L31 38L40 14" fill="none" stroke="#2BB2CB" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><g transform="translate(40.5 12.5) rotate(-69)"><path d="M7 0L-3 -6L-3 6Z" fill="#2BB2CB"/></g>${BOUNCE(17, 10)}${BOUNCE(31, 38)}`,
  scatter: `<path d="M7 41L18 15M7 41L30 26M7 41L36 41" stroke="#C3CAD8" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="0.1 3.4"/><circle cx="7" cy="41" r="3" fill="#8790AB"/>${SHELL(18.5, 15.5, -66, 17, 8.6)}${SHELL(31, 26, -33, 17, 8.6)}${SHELL(37, 41, 0, 17, 8.6)}`,
  blast: `<circle cx="22" cy="29" r="17" fill="none" stroke="#F0723C" stroke-width="1.6" stroke-dasharray="2 3.2" opacity="0.6"/><circle cx="22" cy="29" r="11.4" fill="#3F4660"/><path d="M14 24Q16 18.6 22 18" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.7"/><rect x="19" y="15.4" width="6" height="4" rx="1.4" fill="#8790AB"/><path d="M24 15.4Q27 9 33 10" fill="none" stroke="#B9A18C" stroke-width="2" stroke-linecap="round"/><path d="M36 4l1.6 3.6 3.8-1.2-1.4 3.8 3.4 2-3.8 1.2.4 4-2.8-2.8-2.8 2.8.4-4-3.8-1.2 3.4-2-1.4-3.8 3.8 1.2z" fill="#F0723C"/><circle cx="36" cy="11" r="2.1" fill="#FFE08A"/>`,
};
export const bulletSvg = (key, cls = 'b') => `<svg class="${cls}" viewBox="0 0 48 48">${BULLET_SVG[key] || BULLET_SVG.standard}</svg>`;

// 迷你坦克（俯視、朝右）：HUD 的敵人清單
export const tankGlyph = (fill, line = '#3F4660') => `<svg viewBox="0 0 15 13"><rect x="1" y="1" width="12" height="2.6" rx="1.2" fill="${line}"/><rect x="1" y="9.4" width="12" height="2.6" rx="1.2" fill="${line}"/><rect x="2" y="2.6" width="10.4" height="7.8" rx="2.2" fill="${fill}" stroke="${line}" stroke-width="1"/><rect x="7" y="5.6" width="7.4" height="1.8" rx="0.9" fill="${line}"/><circle cx="7" cy="6.5" r="2.4" fill="${fill}" stroke="${line}" stroke-width="1"/></svg>`;
