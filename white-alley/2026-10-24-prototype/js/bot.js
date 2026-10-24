// 電腦對手：看（視野＋視線）、聽（附近有人出手）→ 戰鬥／追擊／等彈藥／撤退／遊蕩。
// 每種武器有自己的交戰距離與出手方式；瞄準照武器算（拋物線預判走位、步槍直線、光劍貼近揮砍或衝刺、回力鏢補彎度），
// 再依難度加誤差。輸出跟搖桿一樣的輸入。
import { CFG, DIFFICULTY } from './config.js';
import { simulateArc, solvePitch, throwOrigin } from './physics.js';
import { WEAPONS, chargeSpeedW } from './weapons.js';

const DEG = Math.PI / 180;
const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const yawTo = (dx, dz) => Math.atan2(-dx, -dz);

// 每種武器想保持的距離 [太近就退, 太遠就追]
const BAND = { stone: [7, 24], grenade: [8, 20], cat: [6, 16], rifle: [9, 30], boomerang: [5, 14], saber: [0, 1.8] };

export class Bot {
  constructor(sim, p, diffKey, rng) {
    this.sim = sim; this.p = p; this.rng = rng;
    this.d = typeof diffKey === 'object' ? diffKey : DIFFICULTY[diffKey];   // 也可以直接給一組能力值（測試用的「手機玩家」）
    this.W = WEAPONS[p.weapon] || WEAPONS.stone;
    this.yaw = p.yaw; this.pitch = 0;
    this.mem = new Map();          // id → { x, z, t, since }
    this.state = 'wander';
    this.path = null; this.pi = 0; this.goal = null; this.repathAt = 0;
    this.nextThink = rng() * 0.15;
    this.target = 0; this.catTarget = null;
    this.hold = false; this.holdSince = 0; this.plan = null;
    this.guardUntil = 0;
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

  // 現在的攻擊對象：人或追著我的貓
  tgtNow() {
    if (this.catTarget) { const c = this.sim.cats.find((k) => k.id === this.catTarget && k.alive); if (c) return c; }
    return this.target ? this.sim.byId(this.target) : null;
  }

  input(dt) {
    const { sim, p, W } = this;
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
    const tgt = this.tgtNow();
    if (this.dodge && now < this.dodge.until) {
      mx = this.dodge.x; mz = this.dodge.z;
    } else if (this.state === 'fight' && tgt) {
      const dx = tgt.x - p.x, dz = tgt.z - p.z, dist = Math.hypot(dx, dz) || 1;
      const ux = dx / dist, uz = dz / dist;
      const [near, far] = BAND[W.key];
      if (this.noShot || dist > far) {
        [mx, mz] = this.follow(tgt.x, tgt.z);
      } else {
        if (now > this.strafeUntil) { this.strafe = this.rng() < 0.5 ? 1 : -1; this.strafeUntil = now + 0.6 + this.rng() * 1.0; }
        const back = dist < near ? -0.8 : dist > far * 0.85 ? 0.5 : 0;
        const side = W.key === 'saber' ? 0.4 : 0.85;
        mx = -uz * this.strafe * side + ux * back;
        mz = ux * this.strafe * side + uz * back;
        if (p.speed < 0.6 && (mx || mz) && this.rng() < 0.1) this.strafe *= -1;
      }
    } else if (this.state === 'reload' && tgt) {
      // 步槍換彈、回力鏢還沒回來：拉開距離
      const dx = p.x - tgt.x, dz = p.z - tgt.z, dist = Math.hypot(dx, dz) || 1;
      mx = dx / dist * 0.7 - dz / dist * this.strafe * 0.6; mz = dz / dist * 0.7 + dx / dist * this.strafe * 0.6;
    } else if (this.state === 'retreat' && this.cover) {
      [mx, mz] = this.follow(this.cover.x, this.cover.z);
    } else if (this.goal) {
      [mx, mz] = this.follow(this.goal.x, this.goal.z);
    }
    // 步槍端槍：站定才會變準（不在閃躲時）
    if (W.kind === 'hitscan' && p.aiming && !(this.dodge && now < this.dodge.until)) { mx = 0; mz = 0; }
    // 卡住就換路
    if ((mx || mz) && p.speed < 0.4 && !(W.kind === 'hitscan' && p.aiming)) {
      this.stuckT += dt;
      if (this.stuckT > 0.9) { this.path = null; this.stuckT = 0; this.dodge = { x: -mz, z: mx, until: now + 0.3 }; }
    } else this.stuckT = 0;

    // ---- 視角 ----
    let wantYaw = this.yaw, wantPitch = 0;
    if (now < this.guardUntil && this.guardFrom) {
      wantYaw = yawTo(this.guardFrom.x - p.x, this.guardFrom.z - p.z);
    } else if ((this.state === 'fight' || this.state === 'reload') && tgt && this.plan) {
      wantYaw = this.plan.yaw; wantPitch = this.plan.pitch;
    } else if ((this.state === 'fight' || this.state === 'reload') && tgt) {
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

    // ---- 光劍舉劍擋：時間到就收（取消，不揮空） ----
    if (W.key === 'saber' && this.guarding) {
      if (now >= this.guardUntil) { this.guarding = false; this.hold = false; return { mx, mz, yaw: this.yaw, pitch: this.pitch, aim: false, cancel: true }; }
      return { mx, mz, yaw: this.yaw, pitch: this.pitch, aim: true, cancel: false };
    }

    // ---- 出手 ----
    let aim = this.hold;
    if (this.hold) {
      if (!p.aiming && now - this.holdSince > 0.25) { this.hold = false; aim = false; }   // 冷卻或沒彈藥
      else if (p.aiming && this.plan && this.state === 'fight') {
        const ready = p.charge >= this.plan.charge - 0.01;
        const err = Math.abs(wrap(this.plan.yaw - this.yaw)) + Math.abs(this.plan.pitch - this.pitch);
        if (ready && err < (W.key === 'saber' ? 15 : 2.5) * DEG) {
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

  // 放手那一刻用實際蓄力重算（拋物線武器），誤差在計畫時就抽好
  release(tgt) {
    const { p, W } = this;
    if (tgt && this.plan && W.kind === 'arc') {
      const sol = this.solve(tgt, chargeSpeedW(W, p.charge), this.plan.low, this.plan.ty);
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

  // 拋物線：對 tgt 用初速 v 的瞄準解（含預判）
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
      tx = tgt.x + (tgt.vx || 0) * t * this.d.lead;
      tz = tgt.z + (tgt.vz || 0) * t * this.d.lead;
      if (it === 1) return { yaw, pitch, o, t };
    }
    return null;
  }

  canAttack() {
    const { p, W, sim } = this;
    if (W.kind === 'melee') return true;
    if (W.kind === 'hitscan') return p.stones > 0 && p.reloadUntil <= sim.time;
    return p.stones > 0 || p.aiming;
  }

  think() {
    const { sim, p, d, W } = this;
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
      const score = dist - (hitMe ? 15 : 0) - (q.hp < 50 ? 4 : 0) - (q.id === this.target ? 6 : 0) + (q.isBot ? 0 : d.humanBias || 0);
      if (score < bestScore) { bestScore = score; best = q; }
    }
    // 追著我的貓：近了就先處理牠（光劍砍、其他武器打）
    this.catTarget = null;
    for (const c of sim.cats) {
      if (c.owner === p.id || c.target !== p.id) continue;
      const dist = Math.hypot(c.x - p.x, c.z - p.z);
      if (dist < 9 && map.los(p.x, CFG.EYE, p.z, c.x, 0.4, c.z) && this.rng() < Math.min(0.6, d.dodge + 0.3)) { this.catTarget = c.id; break; }
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
    if (this.target !== prevTarget) { this.plan = null; if (this.hold && !this.guarding) this.hold = false; }
    const recent = [...this.mem.entries()].filter(([, m]) => now - m.t < 7).sort((a, b) => b[1].t - a[1].t)[0];

    if (best && p.hp < 35 && d.dodge > 0.3 && best.hp > p.hp && this.state !== 'retreat' && now > (this.retreatCd || 0)) {
      this.cover = this.findCover(best);
      if (this.cover) { this.state = 'retreat'; this.retreatUntil = now + 6; this.retreatCd = now + 14; }
    }
    if (this.state === 'retreat' && (now > this.retreatUntil || p.hp > 75 || !this.cover)) this.state = '';

    if (this.state === 'retreat' && this.cover) {
      // 繼續躲
    } else if ((best || this.catTarget) && this.canAttack()) {
      this.state = 'fight';
    } else if (best || this.catTarget) {
      this.state = 'reload';   // 彈藥還在回補、步槍換彈、回力鏢在外面：先拉開距離
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
        // 沒有線索時多半往某個人大概的方向找（差個十公尺），不然地圖再小也常常繞半天碰不到人
        const others = sim.players.filter((q) => q !== p && q.alive);
        let g = null;
        if (others.length && this.rng() < 0.7) {
          const q = others[Math.floor(this.rng() * others.length)];
          const n = map.nearestReach(q.x + (this.rng() - 0.5) * 20, q.z + (this.rng() - 0.5) * 20, 12);
          if (n >= 0) g = map.navCenter(n);
        }
        this.wanderGoal = g || map.randomReach(this.rng);
      }
      this.goal = this.wanderGoal;
    }
    if (this.state === 'fight') this.lookAt = null;

    // ---- 躲（光劍則舉劍擋） ----
    this.checkDodge();

    // ---- 出手計畫 ----
    const tgt = this.tgtNow();
    if (this.state === 'fight' && tgt && !this.guarding) {
      const isCat = !!this.catTarget;
      const m = isCat ? null : this.mem.get(tgt.id);
      const seenFor = isCat ? 9 : now - m.since;
      const plan = this.planFor(tgt, isCat);
      this.noShot = !plan;
      if (plan) {
        const keep = this.plan && this.plan.low === plan.low && this.plan.kind === plan.kind;
        const errMul = { rifle: 0.75, boomerang: 1.4, saber: 0 }[W.key] ?? 1;   // 步槍端著不動，手比較穩
        plan.ey = keep ? this.plan.ey : this.gauss() * d.aimErr * errMul * DEG;
        plan.ep = keep ? this.plan.ep : this.gauss() * d.aimErr * 0.7 * errMul * DEG;
        plan.yaw += plan.ey; plan.pitch += plan.ep;
        if (keep && plan.kind === 'arc') plan.charge = this.plan.charge;
        this.plan = plan;
        const pause = W.cd + d.pause * (0.6 + this.rng() * 0.8) * (W.key === 'saber' ? 0.3 : 1);
        if (!this.hold && !p.aiming && this.canAttack() && seenFor >= d.reaction && now - this.lastThrow > pause && now >= p.cdUntil) {
          this.hold = true; this.holdSince = now;
        }
      } else if (this.hold && p.aiming && W.key !== 'saber') {
        this.hold = false;   // 沒有可行的出手：放棄這一次
      }
    } else if (!this.guarding) {
      this.plan = null;
    }
  }

  // 依武器算出手計畫 { yaw, pitch, charge, kind, low?, ty? }；null＝現在打不到
  planFor(tgt, isCat) {
    const { p, W, d, sim } = this;
    const dist = Math.hypot(tgt.x - p.x, tgt.z - p.z);
    if (W.kind === 'arc') {
      const v = Math.max(W.vMin, Math.min(W.vMax, Math.sqrt(CFG.G * dist) * 1.05 + 2.5 + this.rng() * 2));
      const charge = (v - W.vMin) / (W.vMax - W.vMin);
      const keepTy = this.plan && this.plan.ty;
      const ty = isCat ? 0.3 : keepTy || (W.key === 'grenade' ? 0.35 : W.key === 'cat' ? 0.5 : d.aimErr < 2 && this.rng() < 0.3 ? CFG.HEAD_Y : 1.15);
      for (const low of [true, false]) {
        const sol = this.solve(tgt, v, low, ty);
        if (!sol) continue;
        const c = Math.cos(sol.pitch);
        const vel = { x: -Math.sin(sol.yaw) * c * v, y: Math.sin(sol.pitch) * v, z: -Math.cos(sol.yaw) * c * v };
        const arc = simulateArc(sim.map, sol.o, vel, { players: isCat ? null : [tgt], maxT: sol.t + 0.6, every: 4 });
        const ok = arc.hit && (arc.hit.type === 'player' || Math.hypot(arc.hit.x - tgt.x, arc.hit.z - tgt.z) < (W.key === 'grenade' ? 2.4 : 1.6));
        if (ok) return { yaw: sol.yaw, pitch: sol.pitch, charge, low, ty, kind: 'arc' };
      }
      return null;
    }
    if (W.kind === 'hitscan') {
      if (dist > W.range) return null;
      const ty = isCat ? 0.3 : d.aimErr < 2 && this.rng() < 0.25 ? CFG.HEAD_Y : 1.15;
      const steady = { easy: 0.35, normal: 0.65, hard: 0.9 }[this.diffKey()] ?? 0.65;
      return { yaw: yawTo(tgt.x - p.x, tgt.z - p.z), pitch: Math.atan2(ty - CFG.EYE, dist), charge: steady, kind: 'hit' };
    }
    if (W.kind === 'melee') {
      const yaw = yawTo(tgt.x - p.x, tgt.z - p.z);
      if (dist <= W.reach * 0.85) return { yaw, pitch: 0, charge: 0, kind: 'slash' };
      if (!isCat && dist >= 2.8 && dist <= W.lungeDist + W.reach * 0.5) return { yaw, pitch: 0, charge: W.lungeT / W.chargeT + 0.08, kind: 'lunge' };
      return null;
    }
    if (W.kind === 'boom') {
      if (dist > W.range - 0.5 || p.stones < 1) return null;
      const bend = Math.sin(Math.PI * Math.min(1, dist / W.range)) * 2.4;
      return { yaw: yawTo(tgt.x - p.x, tgt.z - p.z) + Math.atan2(bend, dist), pitch: 0, charge: 0.1, kind: 'boom' };
    }
    return null;
  }

  diffKey() { return Object.keys(DIFFICULTY).find((k) => DIFFICULTY[k] === this.d); }

  checkDodge() {
    const { sim, p, d, W } = this;
    if ((this.dodge && sim.time < this.dodge.until) || this.guarding) return;
    // 被步槍的瞄準雷射照到：左右閃（光劍則轉過去舉劍擋）
    for (const q of sim.players) {
      if (q === p || !q.alive || q.weapon !== 'rifle' || !q.aiming || q.charge < 0.15) continue;
      const dx = p.x - q.x, dz = p.z - q.z, dist = Math.hypot(dx, dz);
      const off = Math.abs(wrap(yawTo(dx, dz) - q.yaw));
      if (off > Math.atan2(0.9, dist) + 0.02 || dist > 60) continue;
      if (!sim.map.los(q.x, CFG.EYE, q.z, p.x, 1.2, p.z)) continue;
      const key = `r${q.id}:${Math.floor(sim.time * 2)}`;   // 每半秒最多反應一次
      if (this.dodged.has(key)) continue;
      this.dodged.add(key);
      if (this.rng() > d.dodge) continue;
      if (W.key === 'saber') {
        this.guarding = true; this.guardUntil = sim.time + 0.7; this.guardFrom = { x: q.x, z: q.z };
        this.hold = true; this.holdSince = sim.time;
        return;
      }
      const s = this.rng() < 0.5 ? 1 : -1;
      this.dodge = { x: (-dz / dist) * s, z: (dx / dist) * s, until: sim.time + 0.45 };
      return;
    }
    for (const s of sim.stones) {
      if (!s.active || s.owner === p.id || this.dodged.has(s.id)) continue;
      const boom = s.kind === 'boom', g = boom ? 0 : CFG.G;
      const danger = s.kind === 'grenade' ? 2.6 : 1.1;
      let best = Infinity, bx = 0, bz = 0;
      for (let t = 0; t <= 0.8; t += 0.05) {
        const x = s.x + s.vx * t, y = s.y + s.vy * t - 0.5 * g * t * t, z = s.z + s.vz * t;
        const dd = Math.hypot(x - p.x, y - 1.1, z - p.z);
        if (dd < best) { best = dd; bx = x; bz = z; }
      }
      if (best > danger) continue;
      this.dodged.add(s.id);
      if (this.dodged.size > 40) this.dodged = new Set([...this.dodged].slice(-20));
      if (this.rng() > d.dodge) continue;
      if (W.key === 'saber' && s.kind !== 'grenade') {
        // 光劍：轉向來的方向舉劍擋
        this.guarding = true; this.guardUntil = sim.time + 0.55; this.guardFrom = { x: s.x, z: s.z };
        this.hold = true; this.holdSince = sim.time;
        return;
      }
      const h = Math.hypot(s.vx, s.vz) || 1;
      let px = -s.vz / h, pz = s.vx / h;
      if ((p.x - bx) * px + (p.z - bz) * pz < 0) { px = -px; pz = -pz; }
      this.dodge = { x: px, z: pz, until: sim.time + (s.kind === 'grenade' ? 0.6 : 0.38) };
      return;
    }
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
