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
  DMG_BODY: 25, DMG_HEAD: 50,
  REGEN_DELAY: 6, REGEN_RATE: 8,
  SPAWN_SHIELD: 1.5,
  RESPAWN_T: 3.5,

  // 石頭
  MAX_STONES: 6, START_STONES: 4,
  V_MIN: 13, V_MAX: 25, CHARGE_T: 0.9,
  THROW_CD: 0.45,
  STONE_R: 0.07, STONE_HIT_R: 0.1,
  HAND_OFS: [0.22, -0.12, 0.35],   // 出手點相對眼睛：右、上、前
  LOOSE_LIFE: 25,
  PILE_CD: 12,

  // 比賽
  MATCH_T: 300, KO_LIMIT: 10,
};

export const DIFFICULTY = {
  easy:   { label: '簡單', reaction: 0.65, aimErr: 4.5, lead: 0.3, dodge: 0.12, turn: 170, pause: 1.1, sight: 45 },
  normal: { label: '普通', reaction: 0.4,  aimErr: 2.6, lead: 0.65, dodge: 0.35, turn: 260, pause: 0.55, sight: 55 },
  hard:   { label: '困難', reaction: 0.22, aimErr: 1.3, lead: 0.9, dodge: 0.6, turn: 380, pause: 0.2, sight: 65 },
};

export const BOT_NAMES = ['阿石', '小礫', '卵哥', '砂姐', '碎碎', '岩仔', '圓圓', '鵝卵', '石頭公', '粗礪', '小沙', '磐'];
export const ACCENTS = ['#e4572e', '#3a86ff', '#ffbe0b', '#8ac926', '#ff006e', '#06d6a0', '#8338ec', '#fb5607', '#00b4d8', '#c9184a', '#4361ee', '#f4a261'];
export const PLAYER_ACCENT = '#1d1d1f';
