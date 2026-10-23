// 電腦對手：看（視野＋視線）、聽（附近有人出手）→ 戰鬥／追擊／補石／撤退／遊蕩。
// 瞄準用跟石頭一樣的彈道算仰角、預判對方走位，再依難度加誤差。輸出跟搖桿一樣的輸入。
import { CFG, DIFFICULTY } from './config.js';
import { chargeSpeed, simulateArc, solvePitch, throwOrigin } from './physics.js';

const DEG = Math.PI / 180;
const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

export class Bot {
  constructor(sim, p, diffKey, rng) {
    this.sim = sim; this.p = p; this.d = DIFFICULTY[diffKey]; this.rng = rng;
    this.yaw = p.yaw; this.pitch = 0;
    this.mem = new Map();          // id → { x, z, t, since }
    this.state = 'wander';
    this.path = null; this.pi = 0; this.goal = null; this.repathAt = 0;
    this.nextThink = rng() * 0.15;
    this.target = 0;
    this.hold = false; this.holdSince = 0; this.plan = null;
    this.lastThrow = -9;
    this.strafe = rng() < 0.5 ? 1 : -1; this.strafeUntil = 0;
    this.dodge = null; this.dodged = new Set();
    this.stuckT = 0;
    this.retreatUntil = 0; this.cover = null;
    this.heard = null;
    this.wanderGoal = null;
    this.alivePrev = true;
  }

  gauss() {
    const u = Math.max(1e-9, this.rng()), v = this.rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  input(dt) {
    const { sim, p } = this;
    const now = sim.time;
    if (!p.alive || this.frozen) {   // frozen：測試用，讓電腦站著不動
      this.alivePrev = p.alive;
      return { mx: 0, mz: 0, yaw: p.yaw, pitch: 0, aim: false, cancel: false };
    }
    if (!this.alivePrev) {      // 剛復活：重置
      this.alivePrev = true; this.yaw = p.yaw; this.pitch = 0;
      this.mem.clear(); this.path = null; this.hold = false; this.state = 'wander'; this.wanderGoal = null;
    }

    if (now >= this.nextThink) { this.nextThink = now + 0.15; this.think(); }

    // ---- 移動 ----
    let mx = 0, mz = 0;
    const tgt = this.target ? sim.byId(this.target) : null;
    if (this.dodge && now < this.dodge.until) {
      mx = this.dodge.x; mz = this.dodge.z;
    } else if (this.state === 'fight' && tgt) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz);
      const ux = dx / dist, uz = dz / dist;
      if (this.noShot || dist > 34) {
        [mx, mz] = this.follow(tgt.x, tgt.z);
      } else {
        if (now > this.strafeUntil) { this.strafe = this.rng() < 0.5 ? 1 : -1; this.strafeUntil = now + 0.6 + this.rng() * 1.0; }
        const back = dist < 7 ? -0.8 : dist > 24 ? 0.5 : 0;
        mx = -uz * this.strafe * 0.85 + ux * back;
        mz = ux * this.strafe * 0.85 + uz * back;
        if (p.speed < 0.6 && (mx || mz) && this.rng() < 0.1) this.strafe *= -1;
      }
    } else if (this.state === 'retreat' && this.cover) {
      [mx, mz] = this.follow(this.cover.x, this.cover.z);
    } else if (this.goal) {
      [mx, mz] = this.follow(this.goal.x, this.goal.z);
    }
    // 卡住就換路
    if ((mx || mz) && p.speed < 0.4) {
      this.stuckT += dt;
      if (this.stuckT > 0.9) { this.path = null; this.stuckT = 0; this.dodge = { x: -mz, z: mx, until: now + 0.3 }; }
    } else this.stuckT = 0;

    // ---- 視角與投擲 ----
    let wantYaw = this.yaw, wantPitch = 0;
    if (this.state === 'fight' && tgt && this.plan) {
      wantYaw = this.plan.yaw; wantPitch = this.plan.pitch;
    } else if (this.state === 'fight' && tgt) {
      wantYaw = yawTo(tgt.x - p.x, tgt.z - p.z);
    } else if (this.lookAt) {
      wantYaw = yawTo(this.lookAt.x - p.x, this.lookAt.z - p.z);
    } else if (Math.hypot(mx, mz) > 0.2) {
      wantYaw = yawTo(mx, mz);
    }
    const turn = this.d.turn * DEG * dt;
    const dy = wrap(wantYaw - this.yaw);
    this.yaw = wrap(this.yaw + Math.max(-turn, Math.min(turn, dy)));
    const dp = wantPitch - this.pitch;
    this.pitch += Math.max(-turn, Math.min(turn, dp));

    let aim = this.hold;
    if (this.hold) {
      if (!p.aiming && now - this.holdSince > 0.25) { this.hold = false; aim = false; }   // 冷卻或沒石頭
      else if (p.aiming && this.plan && this.state === 'fight') {
        const ready = p.charge >= this.plan.charge - 0.01;
        const err = Math.abs(wrap(this.plan.yaw - this.yaw)) + Math.abs(this.plan.pitch - this.pitch);
        if (ready && err < 2.5 * DEG) {
          this.release(tgt);
          aim = false;
        } else if (now - this.holdSince > 2.4) { this.hold = false; aim = false; }
      } else if (p.aiming && this.state !== 'fight') {
        this.hold = false;
        return { mx, mz, yaw: this.yaw, pitch: this.pitch, aim: false, cancel: true };
      }
    }
    return { mx, mz, yaw: this.yaw, pitch: this.pitch, aim, cancel: false };
  }

  // 放手那一刻用實際蓄力重算仰角，誤差在計畫時就抽好
  release(tgt) {
    const { p } = this;
    if (tgt && this.plan) {
      const sol = this.solve(tgt, chargeSpeed(p.charge), this.plan.low, this.plan.ty);
      if (sol) { this.yaw = sol.yaw + this.plan.ey; this.pitch = sol.pitch + this.plan.ep; }
    }
    this.hold = false;
    this.lastThrow = this.sim.time;
    this.plan = null;
  }

  follow(gx, gz) {
    const { p, sim } = this;
    const now = sim.time;
    const far = !this.pathGoal || Math.hypot(this.pathGoal.x - gx, this.pathGoal.z - gz) > 3;
    // 每 tick 全場最多算一條路，避免多個電腦同時尋路卡畫面
    if ((!this.path || far || now > this.repathAt) && sim._pathTick !== sim.tick) {
      sim._pathTick = sim.tick;
      this.path = sim.map.findPath(p.x, p.z, gx, gz, 40000);
      this.pi = 1; this.pathGoal = { x: gx, z: gz };
      this.repathAt = now + 2.5 + this.rng();
      if (!this.path) { const dx = gx - p.x, dz = gz - p.z, d = Math.hypot(dx, dz) || 1; return [dx / d, dz / d]; }
    }
    if (!this.path) { const dx = gx - p.x, dz = gz - p.z, d = Math.hypot(dx, dz) || 1; return [dx / d, dz / d]; }
    while (this.pi < this.path.length) {
      const w = this.path[this.pi];
      if (Math.hypot(w.x - p.x, w.z - p.z) < 0.55) this.pi++; else break;
    }
    if (this.pi >= this.path.length) return [0, 0];
    const w = this.path[this.pi];
    const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz) || 1;
    return [dx / d, dz / d];
  }

  // 對 tgt 用初速 v 的瞄準解（含預判）
  solve(tgt, v, low, ty) {
    const { p } = this;
    let tx = tgt.x, tz = tgt.z;
    for (let it = 0; it < 2; it++) {
      const yaw = yawTo(tx - p.x, tz - p.z);
      const o = throwOrigin(p.x, p.z, yaw);
      const d = Math.hypot(tx - o.x, tz - o.z);
      const pitch = solvePitch(d, ty - o.y, v, low);
      if (pitch == null) return null;
      const t = d / (v * Math.cos(pitch));
      tx = tgt.x + tgt.vx * t * this.d.lead;
      tz = tgt.z + tgt.vz * t * this.d.lead;
      if (it === 1) return { yaw, pitch, o, t };
    }
    return null;
  }

  think() {
    const { sim, p, d } = this;
    const now = sim.time;
    const map = sim.map;

    // ---- 看 ----
    let best = null, bestScore = Infinity;
    for (const q of sim.players) {
      if (q === p || !q.alive) continue;
      const dx = q.x - p.x, dz = q.z - p.z, dist = Math.hypot(dx, dz);
      if (dist > d.sight) continue;
      const hitMe = p.lastAttacker === q.id && now - p.lastDmgAt < 2;
      const off = Math.abs(wrap(yawTo(dx, dz) - this.yaw));
      if (off > 75 * DEG && !hitMe && dist > 4) continue;
      if (!map.los(p.x, CFG.EYE, p.z, q.x, CFG.EYE, q.z)) continue;
      const m = this.mem.get(q.id);
      this.mem.set(q.id, { x: q.x, z: q.z, t: now, since: m && now - m.t < 0.5 ? m.since : now });
      const score = dist - (hitMe ? 15 : 0) - (q.hp < 50 ? 4 : 0) - (q.id === this.target ? 6 : 0);
      if (score < bestScore) { bestScore = score; best = q; }
    }
    // 被看不見的人打到：轉過去
    if (!best && now - p.lastDmgAt < 0.3 && p.lastAttacker) {
      const a = sim.byId(p.lastAttacker);
      if (a) this.lookAt = { x: a.x, z: a.z };
    }
    // ---- 聽 ----
    for (const n of sim.noise) {
      if (n.id === p.id || now - n.t > 0.3) continue;
      if (Math.hypot(n.x - p.x, n.z - p.z) < 28) this.heard = { x: n.x, z: n.z, t: now };
    }

    // ---- 決定狀態 ----
    const prevTarget = this.target;
    this.target = best ? best.id : 0;
    if (this.target !== prevTarget) { this.plan = null; if (this.hold) this.hold = false; }
    const recent = [...this.mem.entries()].filter(([, m]) => now - m.t < 7).sort((a, b) => b[1].t - a[1].t)[0];

    if (best && p.hp < 35 && d.dodge > 0.3 && best.hp > p.hp && this.state !== 'retreat' && now > (this.retreatCd || 0)) {
      this.cover = this.findCover(best);
      if (this.cover) { this.state = 'retreat'; this.retreatUntil = now + 6; this.retreatCd = now + 14; }
    }
    if (this.state === 'retreat' && (now > this.retreatUntil || p.hp > 75 || !this.cover)) this.state = '';

    if (this.state === 'retreat' && this.cover) {
      // 繼續躲
    } else if (best && (p.stones > 0 || p.aiming)) {
      this.state = 'fight';
    } else if (p.stones === 0 || (p.stones < 3 && !best)) {
      this.state = 'resupply';
      this.goal = this.nearestStones();
    } else if (recent) {
      this.state = 'seek';
      this.goal = { x: recent[1].x, z: recent[1].z };
      this.lookAt = this.goal;
      if (Math.hypot(this.goal.x - p.x, this.goal.z - p.z) < 1.5) this.mem.delete(recent[0]);
    } else if (this.heard && now - this.heard.t < 4) {
      this.state = 'seek';
      this.goal = this.heard; this.lookAt = this.heard;
      if (Math.hypot(this.heard.x - p.x, this.heard.z - p.z) < 2) this.heard = null;
    } else {
      this.state = 'wander';
      this.lookAt = null;
      if (!this.wanderGoal || Math.hypot(this.wanderGoal.x - p.x, this.wanderGoal.z - p.z) < 2) {
        this.wanderGoal = this.rng() < 0.4 ? sim.piles[Math.floor(this.rng() * sim.piles.length)] : map.randomReach(this.rng);
      }
      this.goal = this.wanderGoal;
    }
    if (this.state === 'fight') this.lookAt = null;

    // ---- 躲石頭 ----
    this.checkDodge();

    // ---- 瞄準計畫 ----
    if (this.state === 'fight' && best) {
      const m = this.mem.get(best.id);
      const seenFor = now - m.since;
      const dist = Math.hypot(best.x - p.x, best.z - p.z);
      const v = Math.max(CFG.V_MIN, Math.min(CFG.V_MAX, Math.sqrt(CFG.G * dist) * 1.05 + 2.5 + this.rng() * 2));
      const charge = (v - CFG.V_MIN) / (CFG.V_MAX - CFG.V_MIN);
      let plan = null;
      const keepTy = this.plan && this.plan.ty;
      const ty = keepTy || (d.aimErr < 2 && this.rng() < 0.3 ? CFG.HEAD_Y : 1.15);
      for (const low of [true, false]) {
        const sol = this.solve(best, v, low, ty);
        if (!sol) continue;
        const c = Math.cos(sol.pitch);
        const vel = { x: -Math.sin(sol.yaw) * c * v, y: Math.sin(sol.pitch) * v, z: -Math.cos(sol.yaw) * c * v };
        const arc = simulateArc(map, sol.o, vel, { players: [best], maxT: sol.t + 0.6, every: 4 });
        const ok = arc.hit && (arc.hit.type === 'player' ||
          Math.hypot(arc.hit.x - best.x, arc.hit.z - best.z) < 1.6);
        if (ok) { plan = { yaw: sol.yaw, pitch: sol.pitch, charge, low, ty }; break; }
      }
      this.noShot = !plan;
      if (plan) {
        const keep = this.plan && this.plan.low === plan.low;
        plan.ey = keep ? this.plan.ey : this.gauss() * d.aimErr * DEG;
        plan.ep = keep ? this.plan.ep : this.gauss() * d.aimErr * 0.7 * DEG;
        plan.yaw += plan.ey; plan.pitch += plan.ep;
        if (keep) plan.charge = this.plan.charge;
        this.plan = plan;
        if (!this.hold && !p.aiming && p.stones > 0 && seenFor >= d.reaction && now - this.lastThrow > CFG.THROW_CD + d.pause * (0.6 + this.rng() * 0.8) && now >= p.cdUntil) {
          this.hold = true; this.holdSince = now;
        }
      } else if (this.hold && p.aiming) {
        this.hold = false;   // 沒有可行彈道：放棄這一投（會丟出去，但很少發生）
      }
    } else {
      this.plan = null;
    }
  }

  checkDodge() {
    const { sim, p, d } = this;
    if (this.dodge && sim.time < this.dodge.until) return;
    for (const s of sim.stones) {
      if (!s.active || s.owner === p.id || this.dodged.has(s.id)) continue;
      let best = Infinity, bx = 0, bz = 0;
      for (let t = 0; t <= 0.8; t += 0.05) {
        const x = s.x + s.vx * t, y = s.y + s.vy * t - 0.5 * CFG.G * t * t, z = s.z + s.vz * t;
        const dd = Math.hypot(x - p.x, y - 1.1, z - p.z);
        if (dd < best) { best = dd; bx = x; bz = z; }
      }
      if (best > 1.1) continue;
      this.dodged.add(s.id);
      if (this.dodged.size > 40) this.dodged = new Set([...this.dodged].slice(-20));
      if (this.rng() > d.dodge) continue;
      const h = Math.hypot(s.vx, s.vz) || 1;
      let px = -s.vz / h, pz = s.vx / h;
      if ((p.x - bx) * px + (p.z - bz) * pz < 0) { px = -px; pz = -pz; }
      this.dodge = { x: px, z: pz, until: sim.time + 0.38 };
      return;
    }
  }

  nearestStones() {
    const { sim, p } = this;
    let best = null, bd = Infinity;
    for (const l of sim.loose) { const dd = Math.hypot(l.x - p.x, l.z - p.z) + 2; if (dd < bd) { bd = dd; best = l; } }
    for (const pl of sim.piles) {
      if (pl.readyAt > sim.time + 3) continue;
      const dd = Math.hypot(pl.x - p.x, pl.z - p.z);
      if (dd < bd) { bd = dd; best = pl; }
    }
    return best ? { x: best.x, z: best.z } : sim.map.randomReach(this.rng);
  }

  findCover(enemy) {
    const { sim, p } = this;
    let best = null, bd = Infinity;
    for (let i = 0; i < 14; i++) {
      const a = this.rng() * Math.PI * 2, r = 6 + this.rng() * 12;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (!sim.map.isReach(x, z)) continue;
      if (sim.map.los(enemy.x, CFG.EYE, enemy.z, x, CFG.EYE, z)) continue;
      const away = -Math.hypot(x - enemy.x, z - enemy.z) * 0.5 + r;
      if (away < bd) { bd = away; best = { x, z }; }
    }
    return best;
  }
}
