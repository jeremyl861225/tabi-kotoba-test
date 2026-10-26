// 共用的小圖（SVG 字串）：彈種、迷你坦克。HUD、搖桿、選單都用這一份，風格才一致。
// 炮彈（v12）：尖頭彈體＋白色彈頭＋一圈金色彈帶（原本的膠囊像藥丸）
const SHELL = (x, y, a, w = 9, h = 5) => {
  const L = x - w / 2, R = x + w / 2, T = y - h / 2, B = y + h / 2, n = R - h * 0.95, c = h * 0.28;
  const body = `M${L + c} ${T}H${n}Q${R} ${y - h * 0.12} ${R} ${y}Q${R} ${y + h * 0.12} ${n} ${B}H${L + c}Q${L} ${B} ${L} ${B - c}V${T + c}Q${L} ${T} ${L + c} ${T}Z`;
  const tip = `M${n} ${T}Q${R} ${y - h * 0.12} ${R} ${y}Q${R} ${y + h * 0.12} ${n} ${B}Z`;
  return `<g transform="rotate(${a} ${x} ${y})"><path d="${body}" fill="#3F4660"/><path d="${tip}" fill="#fff"/><rect x="${L + w * 0.24}" y="${T}" width="${w * 0.09}" height="${h}" fill="#F2C94C"/></g>`;
};

// 遊戲裡的深色炮彈；火箭有尾焰、跳彈有折線、散彈三顆、爆裂是圓彈
export const BULLET_SVG = {
  standard: SHELL(12, 12, -40, 14, 7),
  rocket: `<path d="M7 16.6l-4.4 3 1.6-5z" fill="#F0723C"/>${SHELL(13, 11, -40, 14, 6.4)}`,
  ricochet: `<path d="M3.5 18.5l4-6 3 5" fill="none" stroke="#8790AB" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1.6 1.8"/>${SHELL(15, 9.5, -40, 11, 6)}`,
  scatter: `${SHELL(7.5, 15.5, -60, 8, 4.4)}${SHELL(12, 10.5, -40, 8, 4.4)}${SHELL(16.5, 15.5, -20, 8, 4.4)}`,
  blast: `<circle cx="11" cy="13" r="5.6" fill="#3F4660"/><circle cx="9.4" cy="11.4" r="1.6" fill="#fff" opacity="0.5"/><path d="M15 9l2.2-2.2" stroke="#3F4660" stroke-width="1.6" stroke-linecap="round"/><circle cx="18" cy="6" r="1.7" fill="#F0723C"/>`,
};
export const bulletSvg = (key, cls = 'b') => `<svg class="${cls}" viewBox="0 0 24 24">${BULLET_SVG[key] || BULLET_SVG.standard}</svg>`;

// 迷你坦克（俯視、朝右）：HUD 的敵人清單
export const tankGlyph = (fill, line = '#3F4660') => `<svg viewBox="0 0 15 13"><rect x="1" y="1" width="12" height="2.6" rx="1.2" fill="${line}"/><rect x="1" y="9.4" width="12" height="2.6" rx="1.2" fill="${line}"/><rect x="2" y="2.6" width="10.4" height="7.8" rx="2.2" fill="${fill}" stroke="${line}" stroke-width="1"/><rect x="7" y="5.6" width="7.4" height="1.8" rx="0.9" fill="${line}"/><circle cx="7" cy="6.5" r="2.4" fill="${fill}" stroke="${line}" stroke-width="1"/></svg>`;
