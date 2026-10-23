// 開發用：自動試玩機器人，快轉遊戲時間量節奏（不在遊戲裡載入，主控台用 import('./dev-sim.js') 叫）
// 策略近似一般玩家：缺水／食物／醫療／信仰的房子夠多就蓋對應設施，否則在路邊蓋房，沒地就在廣場附近開一段新路
export function runSim(T, minutes, { every = 8, label = '' } = {}) {
  const town = T.town, game = T.game, cells = T.G.cells;
  const log = [], milestones = [], builds = {};
  let lvl = game.level;
  const houses = () => town.buildings.filter((b) => !b.dead && b.type === 'house');
  const lotsFor = (item) => cells.filter((c) => T.canPlace(item, c));
  const distPl = (c) => Math.hypot(c.x - town.pc.x, c.z - town.pc.z);
  const NEED_OF = { well: 'water', bakery: 'food', apothecary: 'health', tavern: 'faith', church: 'faith' };
  const emptyLand = (c) => c && c.kind === 0 && (town.use[c.id] === 0 || town.use[c.id] === 5);
  function newStreet() {
    const cand = cells.filter((c) => emptyLand(c) && c.nb.filter((n) => emptyLand(cells[n])).length >= 3).sort((a, b) => distPl(a) - distPl(b));
    if (!cand.length) return false;
    let cur = cand[0], prev = null, n = 0;
    while (cur && n < 4 && game.coins >= T.COST.road) {
      if (!T.paintRoad(cur, true)) break; n++;
      const dx = prev ? cur.x - prev.x : cur.x - town.pc.x, dz = prev ? cur.z - prev.z : cur.z - town.pc.z;
      let best = null, bs = -9;
      for (const id of cur.nb) { const o = cells[id]; if (!emptyLand(o)) continue; const s = ((o.x - cur.x) * dx + (o.z - cur.z) * dz) / ((Math.hypot(o.x - cur.x, o.z - cur.z) * Math.hypot(dx, dz)) || 1); if (s > bs) { bs = s; best = o; } }
      prev = cur; cur = best;
    }
    return n > 0;
  }
  function act() {
    T.setMode('build');
    for (const item of ['well', 'bakery', 'apothecary', 'tavern', 'church']) {
      const gi = T.GOALS.findIndex((g) => g.unlock === item); if (gi >= 0 && gi >= game.level) continue;
      if (game.coins < T.SERV[item].cost + 10) continue;
      const lack = houses().filter((b) => b.cells.length === 1 && !T.covered(NEED_OF[item], b.x, b.z));
      if (lack.length < 3) continue;
      let best = null, bs = 0;
      for (const c of lotsFor(item)) { const n = lack.filter((b) => Math.hypot(b.x - c.x, b.z - c.z) < 4).length; if (n > bs) { bs = n; best = c; } }
      if (best && bs >= 3) { T.build(item, best); return item; }
    }
    if (game.coins >= T.COST.house) {
      const lots = lotsFor('house').sort((a, b) => distPl(a) - distPl(b));
      if (lots.length) { T.build('house', lots[0]); return 'house'; }
      if (game.coins >= T.COST.house + T.COST.road * 4 && newStreet()) return 'street';
    }
    return null;
  }
  for (let sec = 1; sec <= minutes * 60; sec++) {
    T.evolve(1);
    if (sec % 20 === 0) T.collectTax();
    if (sec % every === 0) { const a = act(); if (a) builds[a] = (builds[a] || 0) + 1; }
    T.checkGoals();
    if (game.level > lvl) { milestones.push([T.GOALS[game.level - 1].pop, +(sec / 60).toFixed(1)]); lvl = game.level; }
    if (sec % 300 === 0) { const st = T.stats(); log.push([sec / 60, st.pop, Math.round(game.coins), st.tax]); }
  }
  document.querySelectorAll('.float').forEach((e) => e.remove());
  return { label, milestones, log, builds, houses: houses().length };
}
