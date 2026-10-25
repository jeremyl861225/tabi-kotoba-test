// 模擬（60 Hz、純邏輯，node 也能跑）：坦克移動與碰撞、炮彈反彈、炮彈互撞、地雷、爆炸。
// 畫面、音效、連線都只讀這裡的狀態與 events，不改它。
import { COLS, ROWS, TICK, TANK, MINE, BULLETS, TYPES } from './config.js';
import { TILE } from './maps.js';
import { clamp, angDiff, turnToward, wrap, makeRng } from './util.js';

const STEP = 0.04;        // 炮彈每小步最多走多遠（反彈判定的精度；瞄準預測也用同一個值，路徑才一樣）
const WALL_R = 0.07;      // 炮彈撞牆用的半徑（比畫出來的小一點，擦過牆角比較不會亂彈）
const HIT_K = 0.92;       // 炮彈打坦克：坦克半徑打個折，擦邊不算

export const solidForBullet = (v) => v === TILE.WALL || v === TILE.TALL || v === TILE.CORK;
export const solidForTank = (v) => v !== TILE.FLOOR;

export function tileAt(grid, x, y) {
  if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return TILE.WALL;
  return grid[(y | 0) * COLS + (x | 0)];
}

// 炮彈（小圓）在 (x, y) 有沒有碰到牆
function bulletBlocked(grid, x, y) {
  const r = WALL_R;
  if (x - r < 0 || y - r < 0 || x + r > COLS || y + r > ROWS) return true;
  const x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidForBullet(grid[ty * COLS + tx])) return true;
  return false;
}

// 炮彈走一小步：x、y 分開走，哪一軸撞牆就把那一軸速度反向。回傳這一步有沒有反彈。
// b 需要 x, y, vx, vy（vx、vy 是單位向量 × 1，實際距離由 d 決定）
export function stepBall(grid, b, d) {
  let bounced = false;
  const nx = b.x + b.vx * d;
  if (bulletBlocked(grid, nx, b.y)) { b.vx = -b.vx; bounced = true; } else b.x = nx;
  const ny = b.y + b.vy * d;
  if (bulletBlocked(grid, b.x, ny)) { b.vy = -b.vy; bounced = true; } else b.y = ny;
  return bounced;
}

// 坦克（圓）推出牆、坑洞、場地邊緣
export function collideTank(grid, t) {
  const r = TANK.r;
  for (let pass = 0; pass < 2; pass++) {
    t.x = clamp(t.x, r, COLS - r);
    t.y = clamp(t.y, r, ROWS - r);
    const x0 = Math.floor(t.x - r), x1 = Math.floor(t.x + r), y0 = Math.floor(t.y - r), y1 = Math.floor(t.y + r);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) continue;
        if (!solidForTank(grid[ty * COLS + tx])) continue;
        const cx = clamp(t.x, tx, tx + 1), cy = clamp(t.y, ty, ty + 1);
        const dx = t.x - cx, dy = t.y - cy, d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = r - d;
          t.x += (dx / d) * push; t.y += (dy / d) * push;
        } else {
          // 中心掉進方塊裡（不該發生）：往最近的邊推出去
          const l = t.x - tx, rr = tx + 1 - t.x, u = t.y - ty, dn = ty + 1 - t.y, m = Math.min(l, rr, u, dn);
          if (m === l) t.x = tx - r; else if (m === rr) t.x = tx + 1 + r; else if (m === u) t.y = ty - r; else t.y = ty + 1 + r;
        }
      }
    }
  }
}

// 開車：搖桿方向（場地座標）→ 車身轉向那個方向（前進或倒車取比較近的），轉到差不多才開始走
// 真人、電腦、客人本機預測都走這一支，手感才一致
export function driveTank(grid, t, mx, my, dt) {
  const mag = Math.min(1, Math.hypot(mx, my));
  if (mag < 0.16) { t.moving = 0; return; }
  const want = Math.atan2(my, mx);
  let target = want, back = false;
  if (Math.abs(angDiff(want, t.body)) > Math.PI / 2) { target = wrap(want + Math.PI); back = true; }
  t.body = turnToward(t.body, target, (t.turn || TANK.turn) * dt);
  const rem = Math.abs(angDiff(target, t.body));
  const k = clamp(1 - rem / 0.65, 0, 1);
  const s = t.speed * mag * k;
  const dir = back ? t.body + Math.PI : t.body;
  const ox = t.x, oy = t.y;
  t.x += Math.cos(dir) * s * dt;
  t.y += Math.sin(dir) * s * dt;
  collideTank(grid, t);
  const moved = Math.hypot(t.x - ox, t.y - oy);
  t.odo += moved;
  t.moving = moved / dt;
}

let nextId = 1;

export class Sim {
  // map：parseMap() 的結果；teams：是否開友軍傷害（預設開，跟原作一樣）
  constructor({ map, seed = 1 }) {
    this.map = map;
    this.grid = new Uint8Array(map.grid);
    this.rng = makeRng(seed);
    this.t = 0;
    this.tanks = [];
    this.bullets = [];
    this.mines = [];
    this.events = [];
    this.lock = { move: false, fire: false };
    this.gridVer = 0;          // 軟木塊被炸掉時 +1（畫面要重畫靜態層）
  }

  // spec：{ x, y, team, kind: 'player'|'cpu', slot, type（戰役車種）, bullet, color, name, skill }
  addTank(spec) {
    const ty = spec.type ? TYPES[spec.type] : null;
    const bullet = spec.bullet || (ty ? ty.bullet : 'standard');
    const B = BULLETS[bullet];
    const t = {
      id: nextId++, slot: spec.slot ?? null, team: spec.team ?? 0, kind: spec.kind || 'player',
      type: spec.type || null, color: spec.color || 'p1', name: spec.name || '',
      x: spec.x, y: spec.y, body: spec.body ?? 0, turret: spec.turret ?? spec.body ?? 0,
      alive: true, bullet, maxShots: ty ? ty.max : B.max, cd: ty ? Math.max(ty.cd, B.cd) : B.cd,
      bulletSpeed: (ty && ty.bulletSpeed) || B.speed,
      speed: ty ? ty.speed : TANK.speed, tTurn: ty ? ty.tTurn : TANK.turretTurn,
      mineMax: ty ? ty.mines : TANK.mineMax,
      ghost: !!(ty && ty.ghost),
      cdLeft: 0, mineCdLeft: 0, odo: 0, moving: 0, firedAt: -9,
      input: { mx: 0, my: 0, aim: null, fire: false, mine: false },
      kills: 0, deaths: 0, shots: 0,
    };
    if (spec.speed != null) t.speed = spec.speed;
    if (spec.tTurn != null) t.tTurn = spec.tTurn;
    if (spec.cd != null) t.cd = spec.cd;
    if (spec.mineMax != null) t.mineMax = spec.mineMax;
    t.turret = t.body;
    this.tanks.push(t);
    return t;
  }

  tank(id) { return this.tanks.find((t) => t.id === id); }
  ally(a, b) { return a.team === b.team; }

  emit(k, o = {}) { this.events.push({ k, ...o }); }
  drain() { const e = this.events; this.events = []; return e; }

  activeShots(t) {
    const groups = new Set();
    for (const b of this.bullets) if (b.owner === t.id) groups.add(b.group);
    return groups.size;
  }
  activeMines(t) { let n = 0; for (const m of this.mines) if (m.owner === t.id) n++; return n; }
  canFire(t) { return t.alive && !this.lock.fire && t.cdLeft <= 0 && this.activeShots(t) < t.maxShots; }

  fire(t) {
    if (!this.canFire(t)) return false;
    const B = BULLETS[t.bullet];
    const group = nextId++;
    const n = B.pellets || 1;
    for (let i = 0; i < n; i++) {
      const a = t.turret + (n > 1 ? (i - (n - 1) / 2) * B.spread : 0);
      const b = {
        id: nextId++, group, owner: t.id, team: t.team, type: B.key,
        x: t.x, y: t.y, vx: Math.cos(a), vy: Math.sin(a), speed: t.bulletSpeed, r: B.r,
        bounces: 0, maxB: B.bounce, armed: false, age: 0, life: B.life || 30,
      };
      // 從車身中心沿炮管掃到炮口：貼著牆開火時，炮彈會在炮口前先反彈
      let left = TANK.muzzle, dead = false;
      while (left > 1e-6) {
        const d = Math.min(STEP, left);
        if (stepBall(this.grid, b, d)) { b.bounces++; if (b.bounces > b.maxB) { dead = true; break; } }
        left -= d;
      }
      if (dead) { this.emit('pop', { x: b.x, y: b.y, type: b.type, wall: true }); if (B.boom) this.explode(b.x, b.y, B.boom, t.id); continue; }
      this.bullets.push(b);
    }
    t.cdLeft = t.cd;
    t.shots++;
    t.firedAt = this.t;
    this.emit('fire', { id: t.id, x: t.x + Math.cos(t.turret) * TANK.muzzle, y: t.y + Math.sin(t.turret) * TANK.muzzle, a: t.turret, type: B.key });
    return true;
  }

  layMine(t) {
    if (!t.alive || this.lock.fire || t.mineCdLeft > 0 || this.activeMines(t) >= t.mineMax) return false;
    for (const m of this.mines) if (Math.hypot(m.x - t.x, m.y - t.y) < 0.6) return false;   // 不疊在同一個位置
    this.mines.push({ id: nextId++, owner: t.id, team: t.team, x: t.x, y: t.y, age: 0, fuse: null });
    t.mineCdLeft = TANK.mineCd;
    this.emit('mine', { id: t.id, x: t.x, y: t.y });
    return true;
  }

  kill(t, killerId, how) {
    if (!t.alive) return;
    t.alive = false;
    t.deaths++;
    const k = this.tank(killerId);
    if (k && k !== t && !this.ally(k, t)) k.kills++;
    this.emit('die', { id: t.id, x: t.x, y: t.y, body: t.body, turret: t.turret, killer: killerId, how, color: t.color });
  }

  // 爆炸：坦克、軟木塊、炮彈、其他地雷都會被波及
  explode(x, y, R, ownerId) {
    this.emit('boom', { x, y, r: R });
    for (const t of this.tanks) if (t.alive && Math.hypot(t.x - x, t.y - y) < R + TANK.r * 0.4) this.kill(t, ownerId, 'boom');
    const x0 = Math.floor(x - R), x1 = Math.floor(x + R), y0 = Math.floor(y - R), y1 = Math.floor(y + R);
    for (let ty = Math.max(0, y0); ty <= Math.min(ROWS - 1, y1); ty++) {
      for (let tx = Math.max(0, x0); tx <= Math.min(COLS - 1, x1); tx++) {
        const i = ty * COLS + tx;
        if (this.grid[i] === TILE.CORK && Math.hypot(tx + 0.5 - x, ty + 0.5 - y) < R + 0.3) {
          this.grid[i] = TILE.FLOOR;
          this.gridVer++;
          this.emit('cork', { tx, ty });
        }
      }
    }
    for (const b of this.bullets) if (!b.dead && Math.hypot(b.x - x, b.y - y) < R) { b.dead = true; this.emit('pop', { x: b.x, y: b.y, type: b.type }); }
    for (const m of this.mines) if (m.fuse == null || m.fuse > 0.12) { if (Math.hypot(m.x - x, m.y - y) < R + 0.2) m.fuse = 0.12; }
  }

  // ---- 一個 tick ----
  step() {
    const dt = TICK;
    this.t += dt;
    const live = this.tanks.filter((t) => t.alive);

    for (const t of live) {
      const I = t.input;
      if (!this.lock.move && t.speed > 0) driveTank(this.grid, t, I.mx, I.my, dt);
      else t.moving = 0;
      if (I.aim != null) t.turret = turnToward(t.turret, I.aim, t.tTurn * dt);
      t.cdLeft -= dt; t.mineCdLeft -= dt;
      if (I.fire) this.fire(t);
      if (I.mine) this.layMine(t);
      I.fire = false; I.mine = false;
    }

    // 坦克互推（不會動的砲台推不動）
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), min = TANK.r * 2;
        if (d >= min || d < 1e-6) continue;
        const push = min - d, nx = dx / d, ny = dy / d;
        const wa = a.speed > 0 ? 1 : 0, wb = b.speed > 0 ? 1 : 0;
        if (wa + wb === 0) continue;
        const ka = wa / (wa + wb), kb = wb / (wa + wb);
        a.x -= nx * push * ka; a.y -= ny * push * ka;
        b.x += nx * push * kb; b.y += ny * push * kb;
        collideTank(this.grid, a); collideTank(this.grid, b);
      }
    }

    this.stepBullets(dt, live);
    this.stepMines(dt, live);
    this.bullets = this.bullets.filter((b) => !b.dead);
  }

  stepBullets(dt, live) {
    if (!this.bullets.length) return;
    let vmax = 0;
    for (const b of this.bullets) vmax = Math.max(vmax, b.speed);
    const n = Math.max(1, Math.ceil((vmax * dt) / STEP));
    for (let s = 0; s < n; s++) {
      for (const b of this.bullets) {
        if (b.dead) continue;
        const B = BULLETS[b.type];
        if (stepBall(this.grid, b, (b.speed * dt) / n)) {
          b.bounces++;
          if (b.bounces > b.maxB) {
            b.dead = true;
            this.emit('pop', { x: b.x, y: b.y, type: b.type, wall: true });
            if (B.boom) this.explode(b.x, b.y, B.boom, b.owner);
            continue;
          }
          this.emit('bounce', { x: b.x, y: b.y, type: b.type });
        }
        if (!b.armed) {
          const o = this.tank(b.owner);
          if (!o || !o.alive || Math.hypot(o.x - b.x, o.y - b.y) > TANK.r + b.r + 0.02) b.armed = true;
        }
        for (const t of live) {
          if (!t.alive || (t.id === b.owner && !b.armed)) continue;
          const rr = TANK.r * HIT_K + b.r;
          if ((t.x - b.x) ** 2 + (t.y - b.y) ** 2 < rr * rr) {
            b.dead = true;
            if (B.boom) this.explode(b.x, b.y, B.boom, b.owner);
            else this.kill(t, b.owner, 'shell');
            break;
          }
        }
        if (b.dead) continue;
        for (const m of this.mines) {
          if ((m.x - b.x) ** 2 + (m.y - b.y) ** 2 < (0.28 + b.r) ** 2) { b.dead = true; m.fuse = 0; m.shotBy = b.owner; break; }
        }
      }
      // 炮彈互撞：兩顆一起消失（同一發散彈的彈丸彼此不算）
      const L = this.bullets;
      for (let i = 0; i < L.length; i++) {
        const a = L[i];
        if (a.dead) continue;
        for (let j = i + 1; j < L.length; j++) {
          const c = L[j];
          if (c.dead || c.group === a.group) continue;
          const rr = a.r + c.r;
          if ((a.x - c.x) ** 2 + (a.y - c.y) ** 2 < rr * rr) {
            a.dead = c.dead = true;
            const x = (a.x + c.x) / 2, y = (a.y + c.y) / 2;
            this.emit('clash', { x, y });
            const ba = BULLETS[a.type], bc = BULLETS[c.type];
            if (ba.boom) this.explode(x, y, ba.boom, a.owner);
            else if (bc.boom) this.explode(x, y, bc.boom, c.owner);
            break;
          }
        }
      }
    }
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.age += dt;
      if (b.age > b.life) { b.dead = true; this.emit('pop', { x: b.x, y: b.y, type: b.type, fade: true }); }
    }
  }

  stepMines(dt, live) {
    if (!this.mines.length) return;
    for (const m of this.mines) {
      m.age += dt;
      if (m.fuse == null) {
        if (m.age > MINE.fuse) m.fuse = 0;
        else if (m.age > MINE.arm) {
          for (const t of live) {
            if (t.alive && t.team !== m.team && Math.hypot(t.x - m.x, t.y - m.y) < MINE.near) { m.fuse = MINE.short; this.emit('arm', { x: m.x, y: m.y }); break; }
          }
        }
      }
      if (m.fuse != null) m.fuse -= dt;
    }
    // 爆炸可能引爆別顆：一直處理到沒有該爆的為止
    for (let guard = 0; guard < 8; guard++) {
      const go = this.mines.filter((m) => m.fuse != null && m.fuse <= 0 && !m.done);
      if (!go.length) break;
      for (const m of go) { m.done = true; this.explode(m.x, m.y, MINE.radius, m.shotBy ?? m.owner); }
    }
    this.mines = this.mines.filter((m) => !m.done);
  }
}

// 瞄準預測：用跟真的炮彈一模一樣的走法，算這個角度打出去第一個碰到的是誰
// opts：{ owner, bounces, maxLen, path（要不要記反彈點）, boom（爆裂彈半徑） }
export function traceShot(sim, t, ang, opts = {}) {
  const grid = sim.grid;
  const B = BULLETS[t.bullet];
  const maxB = opts.bounces ?? B.bounce;
  const maxLen = opts.maxLen ?? (B.life ? B.life * t.bulletSpeed : 46);
  const b = { x: t.x, y: t.y, vx: Math.cos(ang), vy: Math.sin(ang) };
  const pts = opts.path ? [{ x: t.x, y: t.y }] : null;
  const rr = TANK.r * HIT_K + B.r;
  const tanks = sim.tanks.filter((o) => o.alive);
  let len = 0, bounces = 0, armed = false, muzzle = 0;
  while (len < maxLen) {
    if (stepBall(grid, b, STEP)) {
      bounces++;
      if (pts) pts.push({ x: b.x, y: b.y });
      if (bounces > maxB) {
        if (pts) pts.push({ x: b.x, y: b.y });
        return { hit: null, wall: true, x: b.x, y: b.y, bounces, len, path: pts };
      }
    }
    len += STEP; muzzle += STEP;
    if (!armed && Math.hypot(t.x - b.x, t.y - b.y) > TANK.r + B.r + 0.02) armed = true;
    if (muzzle < TANK.muzzle) continue;   // 炮管裡還不會打到人（跟 fire() 一樣）
    for (const o of tanks) {
      if (o === t && !armed) continue;
      if ((o.x - b.x) ** 2 + (o.y - b.y) ** 2 < rr * rr) {
        if (pts) pts.push({ x: b.x, y: b.y });
        return { hit: o, x: b.x, y: b.y, bounces, len, path: pts };
      }
    }
  }
  if (pts) pts.push({ x: b.x, y: b.y });
  return { hit: null, x: b.x, y: b.y, bounces, len, path: pts };
}
