// 電腦坦克：找角度（含反彈）、炮塔轉過去、對準了才開火；看到炮彈飛來會閃、會躲地雷、有的會布雷。
// 只透過 tank.input 控制坦克，跟真人一樣受模擬的限制（轉向速度、彈數、冷卻）。
import { COLS, ROWS, TANK, MINE, BULLETS, TYPES, SKILL } from './config.js';
import { TILE } from './maps.js';
import { traceShot, stepBall } from './sim.js';
import { TAU, angDiff } from './util.js';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// 戰役：車種表；對戰：難度表＋共同的走法
export function botProfile(tank) {
  if (tank.type) return { ...TYPES[tank.type] };
  const S = SKILL[tank.skill || 'normal'];
  return { ...S, move: 'hunt', keep: 4.5, mines: 2 };
}

export class Bot {
  constructor(sim, tank, profile = botProfile(tank)) {
    this.sim = sim;
    this.t = tank;
    this.P = profile;
    this.rng = sim.rng;
    this.aim = tank.turret;
    this.hasShot = false;
    this.nextThink = this.rng() * profile.think;
    this.checkIn = this.rng.int(4);
    this.goal = null;
    this.path = [];
    this.repath = 0;
    this.goalTimer = 0;
    this.stuck = 0;
    this.dodge = null;          // { x, y, until }
    this.seen = new Map();      // 炮彈 id → { at, react（要不要閃） }
    this.idle = 0;
    this.frozen = false;        // 測試用：電腦完全不動
  }

  enemies() { return this.sim.tanks.filter((o) => o.alive && !this.sim.ally(o, this.t)); }

  update(dt) {
    const t = this.t, sim = this.sim, I = t.input;
    if (!t.alive || this.frozen) { I.mx = I.my = 0; return; }
    const foes = this.enemies();
    if (!foes.length) { I.mx = I.my = 0; return; }

    // ---- 瞄準 ----
    this.nextThink -= dt;
    if (this.nextThink <= 0) { this.nextThink = this.P.think * (0.8 + this.rng() * 0.4); this.think(foes); }
    I.aim = this.aim;
    if (--this.checkIn <= 0) {
      this.checkIn = 4;
      if (this.hasShot && sim.canFire(t) && Math.abs(angDiff(this.aim, t.turret)) < 0.08 && this.good(traceShot(sim, t, t.turret, { bounces: this.aimB() }))) I.fire = true;
    }

    // ---- 布雷 ----
    if (this.P.mines && this.P.mineRate && this.rng() < this.P.mineRate * dt && sim.activeMines(t) < t.mineMax) {
      const near = foes.some((o) => Math.hypot(o.x - t.x, o.y - t.y) < 6);
      if (near || this.rng() < 0.4) { I.mine = true; this.goal = null; this.fleeFrom = { x: t.x, y: t.y, until: sim.t + 2.2 }; }
    }

    // ---- 移動 ----
    if (t.speed <= 0) { I.mx = I.my = 0; return; }
    let mx = 0, my = 0;
    const threat = this.threat(dt);
    if (threat) { mx = threat.x; my = threat.y; }
    else {
      const g = this.steer(dt, foes);
      mx = g.x; my = g.y;
    }
    // 躲地雷：離快爆的、或別人的雷遠一點
    for (const m of sim.mines) {
      const d = Math.hypot(t.x - m.x, t.y - m.y);
      // 地雷隨時可能被別人引爆：平常就離爆炸半徑外一點；已經在倒數就跑更遠
      const danger = m.fuse != null ? MINE.radius + 1.0 : MINE.radius + 0.35;
      if (d < danger && d > 1e-3) { const k = (danger - d) / danger * 2.2; mx += ((t.x - m.x) / d) * k; my += ((t.y - m.y) / d) * k; }
    }
    if (this.fleeFrom && sim.t < this.fleeFrom.until) {
      const d = Math.hypot(t.x - this.fleeFrom.x, t.y - this.fleeFrom.y);
      if (d < MINE.radius + 0.8 && d > 1e-3) { mx += (t.x - this.fleeFrom.x) / d * 1.5; my += (t.y - this.fleeFrom.y) / d * 1.5; }
    }
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    I.mx = mx; I.my = my;

    // 卡住：想走卻沒在動
    if (m > 0.3 && t.moving < 0.15) { this.stuck += dt; if (this.stuck > 0.8) { this.stuck = 0; this.goal = null; this.wiggle = { a: this.rng() * TAU, until: sim.t + 0.4 }; } }
    else this.stuck = 0;
    if (this.wiggle && sim.t < this.wiggle.until) { I.mx = Math.cos(this.wiggle.a); I.my = Math.sin(this.wiggle.a); }
  }

  aimB() { return Math.min(this.P.aimB ?? 1, BULLETS[this.t.bullet].bounce); }

  // 這一槍值不值得開：先打到敵人（爆裂彈：落點炸得到敵人、炸不到自己與隊友）
  good(r) {
    const t = this.t, sim = this.sim;
    if (r.hit) return !sim.ally(r.hit, t);
    const B = BULLETS[t.bullet];
    if (B.boom && r.wall) {
      let foe = false;
      for (const o of sim.tanks) {
        if (!o.alive) continue;
        const d = Math.hypot(o.x - r.x, o.y - r.y);
        if (d < B.boom + TANK.r * 0.4) { if (sim.ally(o, t)) return false; foe = true; }
      }
      return foe;
    }
    return false;
  }

  think(foes) {
    const t = this.t, sim = this.sim;
    const cand = [];
    for (const o of foes) cand.push(Math.atan2(o.y - t.y, o.x - t.x));
    const n = this.P.scan || 0;
    const off = this.rng() * TAU;
    for (let i = 0; i < n; i++) cand.push(off + (i * TAU) / n);
    let best = null, bestScore = -1e9;
    const aimB = this.aimB();
    for (const a of cand) {
      const r = traceShot(sim, t, a, { bounces: aimB });
      if (!this.good(r)) continue;
      // 偏好：反彈少、距離短、不用轉太多炮塔
      const s = 100 - r.len * 1.2 - r.bounces * 7 - Math.abs(angDiff(a, t.turret)) * 6;
      if (s > bestScore) { bestScore = s; best = a; }
    }
    if (best != null) {
      this.hasShot = true;
      this.aim = best + this.rng.gauss() * this.P.err;
    } else {
      // 沒有角度：炮塔跟著最近的敵人轉（下一次 think 可能就有了）
      this.hasShot = false;
      let near = foes[0], nd = 1e9;
      for (const o of foes) { const d = Math.hypot(o.x - t.x, o.y - t.y); if (d < nd) { nd = d; near = o; } }
      this.aim = Math.atan2(near.y - t.y, near.x - t.x) + this.rng.gauss() * 0.25;
    }
  }

  // 有炮彈會在 0.8 秒內打到我：往垂直方向閃（看反應時間與閃躲機率）
  threat(dt) {
    const t = this.t, sim = this.sim;
    if (!this.P.dodge) return null;
    if (this.dodge && sim.t < this.dodge.until) return this.dodge;
    const horizon = 0.8;
    for (const b of sim.bullets) {
      if (b.owner === t.id && !b.armed) continue;
      let s = this.seen.get(b.id);
      if (!s) { s = { at: sim.t, go: this.rng() < this.P.dodge }; this.seen.set(b.id, s); }
      if (!s.go || sim.t - s.at < this.P.react) continue;
      const p = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
      const stepD = 0.1, steps = Math.ceil((b.speed * horizon) / stepD);
      const rr = TANK.r + b.r + 0.3;
      let bounce = b.bounces, hitAt = null;
      for (let i = 0; i < steps; i++) {
        if (stepBall(sim.grid, p, stepD)) { bounce++; if (bounce > b.maxB) break; }
        if ((p.x - t.x) ** 2 + (p.y - t.y) ** 2 < rr * rr) { hitAt = p; break; }
      }
      if (!hitAt) continue;
      // 垂直於炮彈方向、遠離彈道的那一邊；那邊被擋住就換另一邊
      const cross = p.vx * (t.y - p.y) - p.vy * (t.x - p.x);
      let side = cross >= 0 ? 1 : -1;
      let dx = -p.vy * side, dy = p.vx * side;
      if (!this.free(t.x + dx * 0.9, t.y + dy * 0.9)) { dx = -dx; dy = -dy; }
      if (!this.free(t.x + dx * 0.9, t.y + dy * 0.9)) { dx = -p.vx; dy = -p.vy; }   // 兩邊都擋：往後退
      this.dodge = { x: dx, y: dy, until: sim.t + 0.38 };
      return this.dodge;
    }
    if (this.seen.size > 64) for (const id of this.seen.keys()) if (!sim.bullets.some((b) => b.id === id)) this.seen.delete(id);
    return null;
  }

  free(x, y) {
    if (x < 0.4 || y < 0.4 || x > COLS - 0.4 || y > ROWS - 0.4) return false;
    return this.sim.grid[(y | 0) * COLS + (x | 0)] === TILE.FLOOR;
  }

  // 依移動方式挑目的地，用格子 BFS 找路，往下一格的中心走
  steer(dt, foes) {
    const t = this.t, sim = this.sim, P = this.P;
    this.goalTimer -= dt; this.repath -= dt;
    if (this.idle > 0) { this.idle -= dt; return { x: 0, y: 0 }; }
    const here = { x: t.x | 0, y: t.y | 0 };
    if (!this.goal || this.goalTimer <= 0 || (here.x === this.goal.x && here.y === this.goal.y)) {
      if (this.goal && here.x === this.goal.x && here.y === this.goal.y && P.move === 'wander' && this.rng() < 0.35) this.idle = 0.4 + this.rng() * 0.8;
      this.goal = this.pickGoal(foes);
      this.goalTimer = 2 + this.rng() * 2;
      this.repath = 0;
    }
    if (this.repath <= 0) { this.path = this.bfs(here, this.goal); this.repath = 0.5; }
    while (this.path.length && this.path[0].x === here.x && this.path[0].y === here.y) this.path.shift();
    const nxt = this.path[0] || this.goal;
    if (!nxt) return { x: 0, y: 0 };
    const dx = nxt.x + 0.5 - t.x, dy = nxt.y + 0.5 - t.y, d = Math.hypot(dx, dy);
    if (d < 0.05) return { x: 0, y: 0 };
    return { x: dx / d, y: dy / d };
  }

  pickGoal(foes) {
    const t = this.t, P = this.P;
    let near = foes[0], nd = 1e9;
    for (const o of foes) { const d = Math.hypot(o.x - t.x, o.y - t.y); if (d < nd) { nd = d; near = o; } }
    let best = null, bs = -1e9;
    for (let i = 0; i < 16; i++) {
      const c = { x: this.rng.int(COLS), y: this.rng.int(ROWS) };
      if (!this.free(c.x + 0.5, c.y + 0.5)) continue;
      const dSelf = Math.hypot(c.x + 0.5 - t.x, c.y + 0.5 - t.y);
      const dFoe = Math.hypot(c.x + 0.5 - near.x, c.y + 0.5 - near.y);
      let s;
      if (P.move === 'wander') s = -Math.abs(dSelf - 4) + this.rng() * 3;
      else s = -Math.abs(dFoe - (P.keep || 4)) * 1.5 - dSelf * 0.25 + this.rng() * 1.5;
      for (const m of this.sim.mines) if (Math.hypot(c.x + 0.5 - m.x, c.y + 0.5 - m.y) < MINE.radius + 0.5) s -= 20;
      if (s > bs) { bs = s; best = c; }
    }
    return best || { x: t.x | 0, y: t.y | 0 };
  }

  bfs(from, to) {
    if (!to) return [];
    const W = COLS, grid = this.sim.grid;
    const prev = new Int16Array(W * ROWS).fill(-1);
    const s = from.y * W + from.x, g = to.y * W + to.x;
    const q = [s]; prev[s] = s;
    while (q.length) {
      const c = q.shift();
      if (c === g) break;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= ROWS) continue;
        const ni = ny * W + nx;
        if (prev[ni] !== -1 || grid[ni] !== TILE.FLOOR) continue;
        if (dx && dy && (grid[cy * W + nx] !== TILE.FLOOR || grid[ny * W + cx] !== TILE.FLOOR)) continue;   // 斜走不切牆角
        prev[ni] = c; q.push(ni);
      }
    }
    if (prev[g] === -1) return [];
    const path = [];
    for (let c = g; c !== s; c = prev[c]) path.push({ x: c % W, y: (c / W) | 0 });
    return path.reverse();
  }
}

