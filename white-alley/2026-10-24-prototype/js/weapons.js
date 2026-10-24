// 武器：數值都在這裡（平衡就調這裡，tests/balance.mjs 會跑大量電腦對戰統計每種武器的 KO／死亡）。
// kind：arc＝拋物線（準心＝落點）、hitscan＝直線瞬間命中、melee＝近戰、boom＝回力鏢
// ammo：手上最多幾發；start：復活時帶幾發；regen：每幾秒自動補回一發（沒有石堆、不用撿）
export const WEAPONS = {
  stone: {
    key: 'stone', name: '石頭', short: '均衡・會被躲', kind: 'arc', proj: 'stone',
    ammo: 6, start: 6, regen: 1.4,
    dmg: 34, dmgHead: 60, cd: 0.36, vsCrystal: 1, vMin: 15, vMax: 27, chargeT: 0.9, speedMul: 1,
    stats: { power: 3, range: 4, ease: 4 },
    desc: '拋物線，準心就是落點。打頭兩倍。最多 6 顆，每 1.4 秒自動補回 1 顆。',
  },
  grenade: {
    key: 'grenade', name: '手榴彈', short: '範圍爆炸・難瞄', kind: 'arc', proj: 'grenade',
    ammo: 3, start: 3, regen: 5,
    vsCrystal: 1.3,
    dmg: 58, radius: 3.0, inner: 0.6, selfMul: 0.5, cd: 1.4, vMin: 9, vMax: 18, chargeT: 1.0, speedMul: 0.95,
    stats: { power: 5, range: 2, ease: 2 },
    desc: '碰到東西就爆炸，3 公尺內都受傷（牆擋得住）。只有 3 顆、每 5 秒補回 1 顆；丟得慢又近，炸到自己扣一半。',
  },
  rifle: {
    key: 'rifle', name: '步槍', short: '直線瞬中・傷害低', kind: 'hitscan',
    ammo: 5, start: 5, reload: 2.0,
    vsCrystal: 0.6,   // 不能站在遠處慢慢點水晶
    dmg: 30, dmgHead: 56, cd: 0.5, spreadMax: 2.1, spreadMin: 0.8, falloff: [18, 50, 0.55], steadyT: 0.75, moveSpread: 1.0, range: 70, chargeT: 0.75, speedMul: 0.94,
    stats: { power: 2, range: 5, ease: 3 },
    desc: '直線瞬間命中。站穩按住越久越準（走動時不會變準）；端槍時會射出看得到的瞄準雷射，被瞄到的人會閃。18 公尺外越遠傷害越低，5 發就要換彈。',
  },
  saber: {
    key: 'saber', name: '光劍', short: '近戰・能擋', kind: 'melee',
    ammo: 0, start: 0,
    vsCrystal: 1.1,
    dmg: 28, reach: 2.2, cone: 55, cd: 1.15, lungeT: 0.35, lungeDist: 3.8, lungeTime: 0.22, lungeCd: 1.6, guardCone: 60, chargeT: 0.6, speedMul: 1.05,
    stats: { power: 4, range: 1, ease: 3 },
    desc: '放開就揮砍前方。按住超過 0.35 秒放開會往前衝刺再砍。舉劍時正面飛來的石頭、手榴彈、子彈都擋得掉。走得比較快。',
  },
  cat: {
    key: 'cat', name: '馴獸師', short: '大橘貓會追人・貓不多', kind: 'arc', proj: 'catball',
    ammo: 2, start: 2, regen: 7.5,
    vsCrystal: 1.6,
    dmg: 33, cd: 0.8, vMin: 10, vMax: 20, chargeT: 0.9, speedMul: 1.06,
    catSpeed: 5.2, catLife: 6, catSight: 16,
    stats: { power: 3, range: 3, ease: 5 },
    desc: '丟出大橘貓，落地後自己追最近的敵人咬一口。最多帶 2 隻、每 7.5 秒回來 1 隻；貓被任何攻擊碰到就跑掉。',
  },
  boomerang: {
    key: 'boomerang', name: '回力鏢', short: '去回都打・要等回來', kind: 'boom', proj: 'boom',
    ammo: 1, start: 1,
    vsCrystal: 1,
    dmg: 26, range: 18, speed: 21, backSpeed: 22, cd: 0.25, chargeT: 0.9, speedMul: 1.02,
    stats: { power: 3, range: 3, ease: 3 },
    desc: '沿弧線飛出去再飛回來，去程回程都能打到人，一次可以打好幾個。只有一支，飛回手上才能再丟；撞牆會掉在地上一下。',
  },
};
export const WEAPON_KEYS = Object.keys(WEAPONS);
export const PROJ_CODE = { stone: 0, grenade: 1, catball: 2, boom: 3 };
export const PROJ_KIND = ['stone', 'grenade', 'catball', 'boom'];

export function chargeSpeedW(w, charge) {
  return w.vMin + (w.vMax - w.vMin) * Math.max(0, Math.min(1, charge));
}
