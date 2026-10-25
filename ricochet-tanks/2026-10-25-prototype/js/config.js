// 跳彈坦克 — 數值設定（模擬、電腦、彈種都從這裡讀）
// 單位：1 格 = 1。場地 20 × 14 格，x 向右、y 向下。時間單位秒，模擬固定 60 Hz。

export const COLS = 20;
export const ROWS = 14;
export const TICK = 1 / 60;

export const TANK = {
  r: 0.4,            // 碰撞半徑
  speed: 2.2,        // 真人坦克最高速（格／秒）
  turn: 10,          // 車身轉向（弧度／秒）
  turretTurn: 18,    // 炮塔轉向（真人：跟手，但不是瞬移）
  muzzle: 0.62,      // 炮口離車身中心
  mineMax: 2,
  mineCd: 0.6,
};

export const MINE = {
  arm: 0.5,          // 放下後多久才會被觸發
  fuse: 10,          // 沒人碰也會在這之後爆
  near: 1.05,        // 有敵人靠這麼近就進入倒數
  short: 0.42,       // 被觸發後的倒數
  radius: 1.55,      // 爆炸半徑（坦克、軟木塊、炮彈都會被炸掉）
};

// 彈種（開局選一種；電腦依車種固定）
// speed 格／秒、bounce 可反彈次數、max 場上同時幾發（散彈算「幾組」）、cd 兩發最短間隔
export const BULLETS = {
  standard: {
    key: 'standard', name: '標準彈', en: 'Standard',
    speed: 4.6, bounce: 1, max: 5, cd: 0.16, r: 0.1,
    desc: '反彈 1 次・最多 5 發',
    stats: { speed: 2, bounce: 2, count: 3 },
  },
  rocket: {
    key: 'rocket', name: '火箭彈', en: 'Rocket',
    speed: 8.6, bounce: 0, max: 3, cd: 0.28, r: 0.1,
    desc: '飛得最快・不會反彈',
    stats: { speed: 3, bounce: 0, count: 2 },
  },
  ricochet: {
    key: 'ricochet', name: '跳彈', en: 'Ricochet',
    speed: 4.1, bounce: 3, max: 4, cd: 0.2, r: 0.1,
    desc: '反彈 3 次・繞牆打人',
    stats: { speed: 1, bounce: 3, count: 2 },
  },
  scatter: {
    key: 'scatter', name: '散彈', en: 'Scatter',
    speed: 5.4, bounce: 1, max: 2, cd: 0.5, r: 0.085, pellets: 3, spread: 0.2, life: 1.25,
    desc: '一次三發扇形・射程短',
    stats: { speed: 2, bounce: 2, count: 1 },
  },
  blast: {
    key: 'blast', name: '爆裂彈', en: 'Blast',
    speed: 3.4, bounce: 0, max: 2, cd: 0.6, r: 0.14, boom: 1.25,
    desc: '碰到東西就爆・炸得開軟木塊',
    stats: { speed: 1, bounce: 0, count: 1 },
  },
};
export const BULLET_KEYS = Object.keys(BULLETS);

// 電腦車種（戰役的敵人；顏色在 ART.md 的調色盤）
// move：still 不動／wander 亂走／hunt 逼近／keep 保持距離
// scan：找反彈角度時掃幾個方向（0＝只會直射）；aimB：最多算幾次反彈；err：瞄準誤差（弧度）
// think：多久重新找一次角度；dodge：看到炮彈來時閃躲的機率；react：反應時間
export const TYPES = {
  brown:  { name: '棕色砲台', speed: 0,   tTurn: 1.3, bullet: 'standard', max: 1, cd: 3.2, scan: 0,  aimB: 0, err: 0.07, think: 0.6, dodge: 0,    react: 9,   mines: 0, move: 'still' },
  ash:    { name: '灰色步兵', speed: 1.0, tTurn: 1.8, bullet: 'standard', max: 1, cd: 2.0, scan: 24, aimB: 1, err: 0.05, think: 0.5, dodge: 0.25, react: 0.7, mines: 0, move: 'wander' },
  teal:   { name: '青色火箭', speed: 0.8, tTurn: 1.4, bullet: 'rocket',   max: 1, cd: 3.0, scan: 0,  aimB: 0, err: 0.05, think: 0.45, dodge: 0.2, react: 0.7, mines: 0, move: 'keep', keep: 6 },
  yellow: { name: '黃色布雷', speed: 1.9, tTurn: 2.2, bullet: 'standard', max: 1, cd: 2.4, scan: 24, aimB: 1, err: 0.06, think: 0.5, dodge: 0.5,  react: 0.5, mines: 4, mineRate: 0.25, move: 'wander' },
  pink:   { name: '粉紅連射', speed: 1.1, tTurn: 2.4, bullet: 'standard', max: 3, cd: 0.22, scan: 36, aimB: 1, err: 0.05, think: 0.35, dodge: 0.35, react: 0.6, mines: 0, move: 'hunt', keep: 4 },
  green:  { name: '綠色神射', speed: 0,   tTurn: 2.6, bullet: 'ricochet', max: 2, cd: 1.3, scan: 90, aimB: 2, err: 0.012, think: 0.3, dodge: 0,   react: 9,   mines: 0, move: 'still', bulletSpeed: 5.4 },
  violet: { name: '紫色精英', speed: 2.0, tTurn: 3.0, bullet: 'standard', max: 5, cd: 0.5, scan: 48, aimB: 1, err: 0.035, think: 0.3, dodge: 0.75, react: 0.35, mines: 2, mineRate: 0.12, move: 'hunt', keep: 3.5 },
  white:  { name: '白色幽靈', speed: 1.5, tTurn: 2.6, bullet: 'standard', max: 4, cd: 0.6, scan: 48, aimB: 1, err: 0.04, think: 0.35, dodge: 0.6, react: 0.4, mines: 2, mineRate: 0.1, move: 'wander', ghost: true },
  black:  { name: '黑色王牌', speed: 2.4, tTurn: 3.6, bullet: 'rocket',   max: 2, cd: 0.8, scan: 0,  aimB: 0, err: 0.02, think: 0.25, dodge: 0.95, react: 0.2, mines: 2, mineRate: 0.1, move: 'hunt', keep: 5 },
};
export const TYPE_KEYS = Object.keys(TYPES);

// 對戰模式的電腦（用跟玩家一樣的坦克與彈種，只差腦袋）
export const SKILL = {
  easy:   { label: '簡單', tTurn: 2.0, cd: 1.2,  scan: 24, aimB: 1, err: 0.08, think: 0.6,  dodge: 0.25, react: 0.65, mineRate: 0.03, speedK: 0.7 },
  normal: { label: '普通', tTurn: 3.0, cd: 0.6,  scan: 48, aimB: 2, err: 0.045, think: 0.4, dodge: 0.55, react: 0.4,  mineRate: 0.05, speedK: 0.85 },
  hard:   { label: '困難', tTurn: 4.2, cd: 0.32, scan: 90, aimB: 3, err: 0.018, think: 0.25, dodge: 0.85, react: 0.22, mineRate: 0.07, speedK: 1 },
};

// 玩家顏色（1P 藍、2P 紅、3P 綠、4P 金）；電腦對戰時借用其餘顏色
export const PLAYER_KEYS = ['p1', 'p2', 'p3', 'p4'];

export const ROUND = {
  intro: 2.4,        // 關卡標題顯示時間（坦克不能動）
  ready: 0.9,        // 標題收起後再等一下才能開火
  outro: 2.2,        // 分出勝負後停多久才進下一關
};

export const CAMPAIGN = { lives: 3, bonusEvery: 5 };
