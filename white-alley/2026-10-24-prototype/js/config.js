// 遊戲數值。改手感就改這裡。
export const CFG = {
  TICK: 1 / 60,
  G: 9.8,

  // 人物
  EYE: 1.6,
  R: 0.35,              // 碰撞半徑
  SPEED: 5.0,           // m/s
  AIM_SPEED_MUL: 0.7,   // 蓄力時移動變慢
  HEAD_Y: 1.62, HEAD_R: 0.17,
  BODY_TOP: 1.45, BODY_R: 0.3,

  // 血量
  HP: 100,
  REGEN_DELAY: 4.5, REGEN_RATE: 12,   // 只有真人會回血（電腦不會）
  SPAWN_SHIELD: 1.5,
  RESPAWN_T: 3.5,

  // 投擲（各武器的彈藥、初速、冷卻在 weapons.js）
  V_MIN: 13, V_MAX: 25,            // 只給沒指定武器時的預設值用
  STONE_R: 0.07, STONE_HIT_R: 0.1,
  HAND_OFS: [0.22, -0.12, 0.35],   // 出手點相對眼睛：右、上、前

  // 比賽
  MATCH_T: 300, KO_LIMIT: 10,

  // 水晶戰：兩隊各守一顆水晶，被打破就輸；時間到比水晶剩多少
  TEAM_T: 360,
  TEAM_RESPAWN_T: 5,    // 水晶戰復活比較久：擊倒對手後才有推進的空檔
  CRYSTAL_HP: 900,
  CRYSTAL_R: 0.75,      // 水晶（含底座）的碰撞半徑
  CRYSTAL_TOP: 2.6,     // 打得到的高度上限
};

export const TEAMS = [
  { name: '藍隊', color: '#2f6fe8', hex: 0x2f6fe8 },
  { name: '紅隊', color: '#e8452f', hex: 0xe8452f },
];

// 電腦的能力值。humanBias：挑目標時真人要多「遠」幾公尺才算（附近有別的電腦就先打電腦，不會全場圍攻你）。
// 用 node tests/difficulty.mjs 量（手機玩家替身對各難度的 KO／倒下）。
export const DIFFICULTY = {
  easy:   { label: '簡單', reaction: 1.0,  aimErr: 7.5, lead: 0.1,  dodge: 0.04, turn: 130, pause: 1.7, sight: 38, humanBias: 10 },
  normal: { label: '普通', reaction: 0.6,  aimErr: 4.2, lead: 0.4,  dodge: 0.15, turn: 200, pause: 0.9, sight: 50, humanBias: 4 },
  hard:   { label: '困難', reaction: 0.25, aimErr: 1.8, lead: 0.85, dodge: 0.55, turn: 340, pause: 0.3, sight: 62, humanBias: 0 },
};

export const BOT_NAMES = ['阿石', '小礫', '卵哥', '砂姐', '碎碎', '岩仔', '圓圓', '鵝卵', '石頭公', '粗礪', '小沙', '磐'];
export const ACCENTS = ['#e4572e', '#3a86ff', '#ffbe0b', '#8ac926', '#ff006e', '#06d6a0', '#8338ec', '#fb5607', '#00b4d8', '#c9184a', '#4361ee', '#f4a261'];
export const PLAYER_ACCENT = '#1d1d1f';
