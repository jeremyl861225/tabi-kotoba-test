// 世界模擬：60 Hz 固定步長。每個玩家每 tick 的輸入都是
//   { mx, mz（世界座標的移動方向，長度 ≤ 1）, yaw, pitch, aim（按住蓄力）, cancel }
// aim 由 true 變 false 的那一 tick 出手（cancel 為 true 則不丟）。
// 本機搖桿、電腦、之後的連線玩家都送同一種輸入。
import { CFG } from './config.js';
import { SUB, advance, chargeSpeed, forward, hitPart, throwOrigin } from './physics.js';
import { mulberry32 } from './map.js';

const IDLE = { mx: 0, mz: 0, yaw: 0, pitch: 0, aim: false, cancel: false };

// 移動（房主模擬與客人的本機預測共用，兩邊才會算出一樣的位置）
export function movePlayer(map, p, inp, dt) {
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const sp = CFG.SPEED * (p.aiming ? CFG.AIM_SPEED_MUL : 1) * (p.speedMul || 1);
  const k = Math.min(1, dt * 14);
  p.vx += (mx * sp - p.vx) * k;
  p.vz += (mz * sp - p.vz) * k;
  p.x += p.vx * dt; p.z += p.vz * dt;
  map.collide(p);
}

export class Sim {
  constructor(map, { seed = 1, matchTime = CFG.MATCH_T, koLimit = CFG.KO_LIMIT } = {}) {
    this.map = map;
    this.rng = mulberry32(seed);
    this.time = 0;
    this.tick = 0;
    this.players = [];
    this.stones = [];
    this.loose = [];
    this.piles = map.piles.map((p, i) => ({ id: i, x: p.x, z: p.z, readyAt: 0 }));
    this.events = [];
    this.noise = [];   // 最近的出手聲（電腦用來「聽」）
    this.state = 'play';
    this.matchTime = matchTime;
    this.koLimit = koLimit;
    this.winner = null;
    this._id = 1;
    this.stats = { throws: 0, hits: 0, heads: 0, kos: 0 };
  }

  addPlayer({ name, accent, isBot = false }) {
    const p = {
      id: this._id++, name, accent, isBot,
      x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, speed: 0,
      yaw: 0, pitch: 0, hp: CFG.HP, stones: CFG.START_STONES,
      alive: true, aiming: false, charge: 0, cdUntil: 0, aimLock: false,
      lastDmgAt: -99, lastAttacker: 0, kills: 0, deaths: 0, respawnAt: 0,
      shieldUntil: 0, killedBy: 0, throwAt: -99, heads: 0,
    };
    this.players.push(p);
    this.respawn(p);
    return p;
  }

  byId(id) { return this.players.find((p) => p.id === id); }

  removePlayer(id) {
    this.players = this.players.filter((p) => p.id !== id);
    this.events.push({ type: 'leave', id });
  }

  // 給連線客人的快照（數字壓短、陣列化）
  snapshot(acks = {}) {
    const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      ht: r3(this.time), st: this.state === 'play' ? 0 : 1, mt: this.matchTime,   // ht：房主時間（t 留給訊息種類）
      pl: this.players.map((p) => [p.id, r2(p.x), r2(p.z), r3(p.yaw), r3(p.pitch), Math.round(p.hp * 10) / 10, p.stones, p.alive ? 1 : 0, p.aiming ? 1 : 0, r2(p.charge),
        p.kills, p.deaths, p.heads, r2(p.respawnAt), r2(p.shieldUntil), p.killedBy || 0, r2(p.throwAt), r2(p.speed), acks[p.id] || 0, r2(p.spawnAt || 0)]),
      sn: this.stones.map((s) => [s.id, s.owner, r3(s.x), r3(s.y), r3(s.z), r2(s.vx), r2(s.vy), r2(s.vz), s.rest ? 1 : 0, s.active ? 1 : 0]),
      lo: this.loose.map((l) => [l.id, r2(l.x), r2(l.z), l.count]),
      pi: this.piles.map((pl) => r2(pl.readyAt)),
    };
  }

  respawn(p) {
    const others = this.players.filter((q) => q !== p && q.alive);
    const cand = this.map.spawns.map((s) => {
      let d = 1e9;
      for (const q of others) d = Math.min(d, Math.hypot(q.x - s.x, q.z - s.z));
      return { s, d: d + this.rng() * 8 };
    }).sort((a, b) => b.d - a.d);
    const s = cand[Math.floor(this.rng() * Math.min(3, cand.length))].s;
    p.x = p.px = s.x; p.z = p.pz = s.z; p.vx = p.vz = 0;
    // 面向最開闊的方向（不要一復活就對著牆）
    let best = 0, bestLen = -1;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, dx = -Math.sin(a), dz = -Math.cos(a);
      let len = 0;
      while (len < 45 && this.map.heightAt(s.x + dx * len, s.z + dz * len) <= 0 && this.map.isReach(s.x + dx * len, s.z + dz * len)) len += 0.5;
      if (len > bestLen) { bestLen = len; best = a; }
    }
    p.yaw = best;
    p.pitch = 0;
    p.hp = CFG.HP; p.stones = CFG.START_STONES; p.alive = true;
    p.aiming = false; p.charge = 0; p.aimLock = false;
    p.shieldUntil = this.time + CFG.SPAWN_SHIELD;
    p.spawnAt = this.time;
    p.lastDmgAt = -99;
    this.events.push({ type: 'spawn', id: p.id, x: p.x, z: p.z, yaw: p.yaw });
  }

  step(inputs) {
    if (this.state !== 'play') return;
    const dt = CFG.TICK;
    this.time += dt;
    this.tick++;
    const map = this.map;

    for (const p of this.players) {
      p.px = p.x; p.pz = p.z;
      if (!p.alive) {
        if (this.time >= p.respawnAt) this.respawn(p);
        continue;
      }
      const inp = inputs[p.id] || { ...IDLE, yaw: p.yaw, pitch: p.pitch };
      p.yaw = inp.yaw;
      p.pitch = Math.max(-1.25, Math.min(1.25, inp.pitch));

      movePlayer(map, p, inp, dt);

      // 投擲：按下開始蓄力、放開出手
      if (inp.cancel && p.aiming) { p.aiming = false; p.charge = 0; p.aimLock = true; this.events.push({ type: 'cancel', id: p.id }); }
      if (!inp.aim) p.aimLock = false;
      if (inp.aim && !p.aiming && !p.aimLock && p.stones > 0 && this.time >= p.cdUntil) {
        p.aiming = true; p.charge = 0;
        this.events.push({ type: 'aim', id: p.id });
      }
      if (p.aiming) {
        p.charge = Math.min(1, p.charge + dt / CFG.CHARGE_T);
        if (!inp.aim && !inp.cancel) {
          // 連線玩家回報自己畫面上的蓄力（延遲會讓房主這邊少算一點），最多多給 0.3
          if (typeof inp.ch === 'number') p.charge = Math.max(0, Math.min(1, inp.ch, p.charge + 0.3));
          this.throwStone(p);
        }
      }

      // 回血
      if (this.time - p.lastDmgAt > CFG.REGEN_DELAY && p.hp < CFG.HP) p.hp = Math.min(CFG.HP, p.hp + CFG.REGEN_RATE * dt);

      // 撿石頭
      if (p.stones < CFG.MAX_STONES) {
        for (const pile of this.piles) {
          if (pile.readyAt > this.time) continue;
          if ((pile.x - p.x) ** 2 + (pile.z - p.z) ** 2 < 1.3 * 1.3) {
            p.stones = CFG.MAX_STONES; pile.readyAt = this.time + CFG.PILE_CD;
            this.events.push({ type: 'pickup', id: p.id, pile: pile.id, x: pile.x, z: pile.z });
            break;
          }
        }
      }
      if (p.stones < CFG.MAX_STONES) {
        for (const l of this.loose) {
          if (l.count <= 0) continue;
          if ((l.x - p.x) ** 2 + (l.z - p.z) ** 2 < 1.0) {
            const take = Math.min(l.count, CFG.MAX_STONES - p.stones);
            p.stones += take; l.count -= take;
            this.events.push({ type: 'pickup', id: p.id, x: l.x, z: l.z, n: take });
            if (p.stones >= CFG.MAX_STONES) break;
          }
        }
      }
    }

    // 人與人推開
    const ps = this.players;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < ps.length; j++) {
        const b = ps[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = CFG.R * 2;
        if (d < min && d > 1e-6) {
          const push = (min - d) / 2;
          a.x -= (dx / d) * push; a.z -= (dz / d) * push;
          b.x += (dx / d) * push; b.z += (dz / d) * push;
          map.collide(a); map.collide(b);
        }
      }
    }
    for (const p of ps) p.speed = Math.hypot(p.x - p.px, p.z - p.pz) / dt;

    this._stepStones(dt);
    this.loose = this.loose.filter((l) => l.count > 0 && l.until > this.time);

    if (this.time >= this.matchTime) this.end();
  }

  throwStone(p) {
    const v = chargeSpeed(p.charge);
    const o = throwOrigin(p.x, p.z, p.yaw);
    const f = forward(p.yaw, p.pitch);
    const s = {
      id: this._id++, owner: p.id, x: o.x, y: o.y, z: o.z,
      vx: f.x * v, vy: f.y * v, vz: f.z * v,
      ox: p.x, oz: p.z, active: true, alive: true, rest: false, age: 0, roof: false,
    };
    this.stones.push(s);
    p.stones--; p.aiming = false; p.charge = 0;
    p.cdUntil = this.time + CFG.THROW_CD;
    p.throwAt = this.time;
    this.stats.throws++;
    this.events.push({ type: 'throw', id: p.id, x: p.x, z: p.z, v });
    this.noise.push({ id: p.id, x: p.x, z: p.z, t: this.time });
    if (this.noise.length > 24) this.noise.splice(0, this.noise.length - 24);
  }

  _stepStones(dt) {
    const h = dt / SUB;
    for (const s of this.stones) {
      if (!s.alive) continue;
      s.lx = s.x; s.ly = s.y; s.lz = s.z;   // 給畫面插值
      s.age += dt;
      if (s.rest) {
        if (s.age > 8) s.alive = false;
        continue;
      }
      for (let k = 0; k < SUB && s.alive && !s.rest; k++) {
        const c = advance(this.map, s, h);
        if (s.active) {
          for (const q of this.players) {
            if (!q.alive || q.id === s.owner) continue;
            const part = hitPart(s.x, s.y, s.z, q);
            if (part) { this._hit(q, s, part); break; }
          }
          if (!s.alive) break;
        }
        if (!c) continue;
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        if (c.type === 'out') { s.alive = false; break; }
        if (c.type === 'roof') {
          s.y = c.h + CFG.STONE_R; s.rest = true; s.roof = true; s.age = 0;
          this.events.push({ type: 'impact', surf: 'roof', x: s.x, y: s.y, z: s.z, sp, active: s.active, owner: s.owner });
          s.active = false;
          break;
        }
        if (c.type === 'wall') {
          s.x = c.px; s.y = c.py; s.z = c.pz;
          if (c.nx) s.vx = -s.vx * 0.35;
          if (c.nz) s.vz = -s.vz * 0.35;
          s.vy *= 0.6;
          this.events.push({ type: 'impact', surf: 'wall', x: s.x, y: s.y, z: s.z, sp, active: s.active, owner: s.owner, nx: c.nx, nz: c.nz });
          s.active = false;
          continue;
        }
        // ground
        if (s.active || sp > 3) this.events.push({ type: 'impact', surf: 'ground', x: s.x, y: 0, z: s.z, sp, active: s.active, owner: s.owner });
        s.active = false;
        s.y = CFG.STONE_R;
        s.vy = Math.abs(s.vy) * 0.28;
        s.vx *= 0.5; s.vz *= 0.5;
        if (Math.hypot(s.vx, s.vy, s.vz) < 1.4) {
          s.alive = false;
          this._drop(s.x, s.z, 1);
        }
      }
    }
    this.stones = this.stones.filter((s) => s.alive);
  }

  _drop(x, z, n) {
    if (this.map.heightAt(x, z) > 0) return;
    for (const l of this.loose) {
      if ((l.x - x) ** 2 + (l.z - z) ** 2 < 0.36) { l.count += n; l.until = this.time + CFG.LOOSE_LIFE; return; }
    }
    this.loose.push({ id: this._id++, x, z, count: n, until: this.time + CFG.LOOSE_LIFE });
  }

  _hit(q, s, part) {
    s.alive = false;
    this._drop(q.x + (this.rng() - 0.5) * 0.6, q.z + (this.rng() - 0.5) * 0.6, 1);
    const shooter = this.byId(s.owner);
    if (this.time < q.shieldUntil) {
      this.events.push({ type: 'block', target: q.id, by: s.owner, x: s.x, y: s.y, z: s.z });
      return;
    }
    const head = part === 'head';
    const dmg = head ? CFG.DMG_HEAD : CFG.DMG_BODY;
    q.hp -= dmg;
    q.lastDmgAt = this.time;
    q.lastAttacker = s.owner;
    this.stats.hits++;
    if (head) { this.stats.heads++; if (shooter) shooter.heads++; }
    this.events.push({ type: 'hit', target: q.id, by: s.owner, head, dmg, x: s.x, y: s.y, z: s.z, fromX: s.ox, fromZ: s.oz });
    if (q.hp <= 0) {
      q.hp = 0; q.alive = false; q.deaths++;
      q.killedBy = s.owner; q.respawnAt = this.time + CFG.RESPAWN_T;
      q.aiming = false; q.charge = 0;
      if (q.stones > 0) this._drop(q.x, q.z, q.stones);
      q.stones = 0;
      if (shooter) shooter.kills++;
      this.stats.kos++;
      this.events.push({ type: 'ko', victim: q.id, by: s.owner, head });
      if (shooter && shooter.kills >= this.koLimit) this.end();
    }
  }

  end() {
    if (this.state === 'over') return;
    this.state = 'over';
    this.winner = this.ranking()[0];
    this.events.push({ type: 'over', winner: this.winner.id });
  }

  ranking() {
    return [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.heads - a.heads);
  }
}
