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

// 彈種（開局選一種、遊戲中可以換；電腦依車種固定）
// speed 格／秒、bounce 可反彈次數、max 彈匣幾發（散彈一發＝一組三顆）、cd 兩發最短間隔
// reload 每補一發要幾秒（v11：彈藥照時間回復，跟場上還在飛的炮彈無關）
export const BULLETS = {
  standard: {
    key: 'standard', name: '標準彈', en: 'Standard',
    speed: 4.6, bounce: 1, max: 5, cd: 0.16, r: 0.1, reload: 1.0,
    desc: '反彈 1 次・最多 5 發',
    stats: { speed: 2, bounce: 2, count: 3 },
  },
  rocket: {
    key: 'rocket', name: '火箭彈', en: 'Rocket',
    speed: 8.6, bounce: 0, max: 3, cd: 0.28, r: 0.1, reload: 1.5,
    desc: '飛得最快・不會反彈',
    stats: { speed: 3, bounce: 0, count: 2 },
  },
  ricochet: {
    key: 'ricochet', name: '跳彈', en: 'Ricochet',
    speed: 4.1, bounce: 3, max: 4, cd: 0.2, r: 0.1, reload: 1.25,
    desc: '反彈 3 次・繞牆打人',
    stats: { speed: 1, bounce: 3, count: 2 },
  },
  scatter: {
    key: 'scatter', name: '散彈', en: 'Scatter',
    speed: 5.4, bounce: 1, max: 2, cd: 0.5, r: 0.085, pellets: 3, spread: 0.2, life: 1.25, reload: 1.9,
    desc: '一次三發扇形・射程短',
    stats: { speed: 2, bounce: 2, count: 1 },
  },
  blast: {
    key: 'blast', name: '爆裂彈', en: 'Blast',
    speed: 3.4, bounce: 0, max: 2, cd: 0.6, r: 0.14, boom: 1.25, reload: 2.3,
    desc: '碰到東西就爆・炸得開軟木塊',
    stats: { speed: 1, bounce: 0, count: 1 },
  },
};
export const BULLET_KEYS = Object.keys(BULLETS);

// 電腦車種（戰役的敵人；顏色在 ART.md 的調色盤；造型 shape 在 tankart.js）
// move：still 不動／wander 亂走／hunt 逼近／keep 保持距離
// max 彈匣、reload 每補一發幾秒、cd 兩發最短間隔；hp 要打幾下（裝甲）
// scan：找反彈角度時掃幾個方向（0＝只會直射）；aimB：最多算幾次反彈；err：瞄準誤差（弧度）
// think：多久重新找一次角度；dodge：看到炮彈來時閃躲的機率；react：反應時間
// 圖鑑：name、role（一句定位）、desc（介紹）、traits（特點）
export const TYPES = {
  brown:  { name: '棕色砲台', role: '固定砲台', shape: 'bunker', speed: 0,   tTurn: 1.3, bullet: 'standard', max: 1, reload: 3.2, cd: 3.2, scan: 0,  aimB: 0, err: 0.07, think: 0.6, dodge: 0,    react: 9,   mines: 0, move: 'still',
    desc: '釘在原地的砲台，只會直直開火，炮塔也轉得很慢。', traits: ['不會移動', '只會直射', '炮塔轉得慢'] },
  ash:    { name: '灰色步兵', role: '巡邏步兵', shape: 'std', speed: 1.0, tTurn: 1.8, bullet: 'standard', max: 1, reload: 2.0, cd: 2.0, scan: 24, aimB: 1, err: 0.05, think: 0.5, dodge: 0.25, react: 0.7, mines: 0, move: 'wander',
    desc: '慢慢巡邏的步兵，懂得算一次反彈，偶爾會閃。', traits: ['會算 1 次反彈', '偶爾閃躲'] },
  teal:   { name: '青色火箭', role: '遠程火箭', shape: 'rocket', speed: 0.8, tTurn: 1.4, bullet: 'rocket',   max: 1, reload: 2.8, cd: 2.8, scan: 0,  aimB: 0, err: 0.05, think: 0.45, dodge: 0.2, react: 0.7, mines: 0, move: 'keep', keep: 6,
    desc: '保持距離、用飛得很快的火箭直射。火箭不會反彈，躲到牆後面就打不到你。', traits: ['火箭很快', '不會反彈', '保持距離'] },
  yellow: { name: '黃色布雷', role: '布雷兵', shape: 'layer', speed: 1.9, tTurn: 2.2, bullet: 'standard', max: 1, reload: 2.2, cd: 2.2, scan: 24, aimB: 1, err: 0.06, think: 0.5, dodge: 0.5,  react: 0.5, mines: 4, mineRate: 0.25, move: 'wander',
    desc: '跑得快、到處亂竄，邊走邊放地雷（最多 4 顆）。牠走過的路要小心。', traits: ['一直放地雷', '跑得快'] },
  pink:   { name: '粉紅連射', role: '連射手', shape: 'gatling', speed: 1.1, tTurn: 2.4, bullet: 'standard', max: 3, reload: 1.1, cd: 0.22, scan: 36, aimB: 1, err: 0.05, think: 0.35, dodge: 0.35, react: 0.6, mines: 0, move: 'hunt', keep: 4,
    desc: '會逼近你，一口氣連射 3 發。打完要等裝填，那是反擊的時機。', traits: ['3 連發', '會逼近', '打完要裝填'] },
  green:  { name: '綠色神射', role: '狙擊手', shape: 'sniper', speed: 0,   tTurn: 2.6, bullet: 'ricochet', max: 2, reload: 1.4, cd: 1.3, scan: 90, aimB: 2, err: 0.012, think: 0.3, dodge: 0,   react: 9,   mines: 0, move: 'still', bulletSpeed: 5.4,
    desc: '不會動的狙擊手，用跳彈算到 2 次反彈，非常準。別停在牠的射線上。', traits: ['算 2 次反彈', '非常準', '不會移動'] },
  violet: { name: '紫色精英', role: '突擊精英', shape: 'raider', speed: 2.0, tTurn: 3.0, bullet: 'standard', max: 5, reload: 0.8, cd: 0.5, scan: 48, aimB: 1, err: 0.035, think: 0.3, dodge: 0.75, react: 0.35, mines: 2, mineRate: 0.12, move: 'hunt', keep: 3.5,
    desc: '快、會閃、會布雷，彈匣 5 發。正面交火很難贏，用反彈繞過去打。', traits: ['很會閃', '彈匣 5 發', '會布雷'] },
  white:  { name: '白色幽靈', role: '隱形刺客', shape: 'stealth', speed: 1.5, tTurn: 2.6, bullet: 'standard', max: 4, reload: 0.9, cd: 0.6, scan: 48, aimB: 1, err: 0.04, think: 0.35, dodge: 0.6, react: 0.4, mines: 2, mineRate: 0.1, move: 'wander', ghost: true,
    desc: '平常是隱形的，開火的瞬間才現身。看炮彈從哪裡飛來，就知道牠在哪。', traits: ['隱形', '開火才現身'] },
  black:  { name: '黑色王牌', role: '王牌', shape: 'ace', speed: 2.4, tTurn: 3.6, bullet: 'rocket',   max: 2, reload: 0.9, cd: 0.8, scan: 0,  aimB: 0, err: 0.02, think: 0.25, dodge: 0.95, react: 0.2, mines: 2, mineRate: 0.1, move: 'hunt', keep: 5,
    desc: '最快、反應最快，火箭直射、幾乎每發都閃得掉。', traits: ['反應最快', '火箭直射', '幾乎都閃得掉'] },
  scout:  { name: '薄荷斥候', role: '斥候', shape: 'scout', speed: 2.7, tTurn: 3.2, bullet: 'standard', max: 2, reload: 1.5, cd: 0.5, scan: 16, aimB: 1, err: 0.09, think: 0.4, dodge: 0.55, react: 0.45, mines: 0, move: 'wander',
    desc: '車身小、跑最快、到處亂竄。打得不準，但很難瞄到牠。', traits: ['跑最快', '車身小', '打不太準'] },
  heavy:  { name: '鐵灰重甲', role: '重裝坦克', shape: 'heavy', speed: 0.7, tTurn: 1.6, bullet: 'blast', max: 1, reload: 3.0, cd: 3.0, scan: 0, aimB: 0, err: 0.05, think: 0.5, dodge: 0, react: 9, mines: 0, move: 'hunt', keep: 4, hp: 2,
    desc: '兩層裝甲，要打中兩次。開的是爆裂彈，碰到東西就炸，別靠牠的落點太近。', traits: ['2 層裝甲', '爆裂彈', '很慢'] },
  bomber: { name: '蘭紫散射', role: '散射手', shape: 'bomber', speed: 1.3, tTurn: 2.2, bullet: 'scatter', max: 2, reload: 1.9, cd: 0.7, scan: 24, aimB: 1, err: 0.05, think: 0.4, dodge: 0.4, react: 0.5, mines: 0, move: 'keep', keep: 3.5,
    desc: '保持中距離，一次打出三發扇形散彈。散彈射程短，拉開距離就安全。', traits: ['三發扇形', '射程短', '保持中距離'] },
  commander: { name: '星夜指揮官', role: '頭目', shape: 'commander', speed: 1.4, tTurn: 2.6, bullet: 'ricochet', max: 3, reload: 1.2, cd: 0.55, scan: 72, aimB: 2, err: 0.03, think: 0.34, dodge: 0.55, react: 0.4, mines: 2, mineRate: 0.08, move: 'hunt', keep: 5, hp: 3, bulletSpeed: 4.8,
    desc: '每一章最後的頭目：三層裝甲、跳彈算到 2 次反彈，還會布雷。', traits: ['3 層裝甲', '算 2 次反彈', '會布雷'] },
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

// 地形（v11）
export const TERRAIN = {
  iceGrip: 2.0,       // 冰上速度追上搖桿的快慢（每秒；越小越滑）
  barrelBoom: 1.35,   // 炸藥桶爆炸半徑
  barrelDelay: 0.14,  // 連鎖引爆的間隔
  bushSee: 1.8,       // 敵人靠這麼近才看得到草叢裡的坦克
  bushReveal: 0.9,    // 在草叢裡開火後現身多久
};
