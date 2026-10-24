// 世界模擬：60 Hz 固定步長。每個玩家每 tick 的輸入都是
//   { mx, mz（世界座標的移動方向，長度 ≤ 1）, yaw, pitch, aim（按住）, cancel, ch?, ty?, tp?, tv? }
// aim 由 true 變 false 的那一 tick 出手（cancel 為 true 則不出手）。ty／tp／tv 是準心落點解（拋物線武器用）。
// 本機搖桿、電腦、連線玩家都送同一種輸入。武器數值在 weapons.js。
import { CFG } from './config.js';
import { SUB, advance, crystalRay, forward, hitPart, raycast, throwOrigin } from './physics.js';
import { mulberry32 } from './map.js';
import { PROJ_CODE, WEAPONS, chargeSpeedW } from './weapons.js';

const IDLE = { mx: 0, mz: 0, yaw: 0, pitch: 0, aim: false, cancel: false };
const DEG = Math.PI / 180;
const CAT_R = 0.24, CAT_HIT = 0.42, CAT_TOP = 0.65;

// 移動（房主模擬與客人的本機預測共用，兩邊才會算出一樣的位置）
export function movePlayer(map, p, inp, dt) {
  let mx = inp.mx || 0, mz = inp.mz || 0;
  const m = Math.hypot(mx, mz);
  if (m > 1) { mx /= m; mz /= m; }
  const sp = CFG.SPEED * (p.aiming ? (p.aimMul || CFG.AIM_SPEED_MUL) : 1) * (p.speedMul || 1);
  const k = Math.min(1, dt * 14);
  p.vx += (mx * sp - p.vx) * k;
  p.vz += (mz * sp - p.vz) * k;
  p.x += p.vx * dt; p.z += p.vz * dt;
  map.collide(p);
}

const facing = (yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });

export class Sim {
  // mode：'ffa' 大亂鬥（先到 10 KO）／'team' 水晶戰（兩隊各守一顆水晶，打破就贏，時間到比水晶剩多少）
  constructor(map, { seed = 1, mode = 'ffa', matchTime, koLimit, swap = false } = {}) {
    this.mode = mode;
    const team = mode === 'team';
    matchTime ??= team ? CFG.TEAM_T : CFG.MATCH_T;
    koLimit ??= team ? Infinity : CFG.KO_LIMIT;
    this.map = map;
    this.rng = mulberry32(seed);
    this.time = 0;
    this.tick = 0;
    this.players = [];
    this.stones = [];     // 所有飛行物：kind = stone／grenade／catball／boom
    this.cats = [];       // 落地後在追人的貓
    this.loose = [];      // 舊版地上可撿的石頭；彈藥改成自動回補後一直是空的（快照格式不變）
    this.piles = [];
    this.events = [];
    this.noise = [];      // 最近的出手聲（電腦用來「聽」）
    this.state = 'play';
    this.matchTime = matchTime;
    this.koLimit = koLimit;
    this.winner = null;
    this._id = 1;
    this.stats = { throws: 0, hits: 0, heads: 0, kos: 0 };
    this.wstats = {};     // 每種武器的 KO／死亡／造成傷害（平衡用）
    // swap：兩隊交換基地（每場隨機換邊，地形不對稱也不會永遠吃虧在同一隊）
    this.bases = team ? (swap ? [map.bases[1], map.bases[0]] : map.bases) : [];
    const hp = map.data.crystalHp || CFG.CRYSTAL_HP;   // 開闊、兩基地近的地圖水晶要硬一點（地圖檔可指定）
    this.crystals = this.bases.map((b, i) => ({ team: i, x: b.x, z: b.z, hp, max: hp, lastHit: -99 }));
    this.teamKills = [0, 0];
    this.winnerTeam = -1;
  }

  // 同一邊的（自己或同隊）：不會互相傷害、投射物直接穿過
  ally(aId, bId) {
    if (aId === bId) return true;
    if (this.mode !== 'team') return false;
    const a = this.byId(aId), b = this.byId(bId);
    return !!(a && b && a.team === b.team);
  }

  addPlayer({ name, accent, isBot = false, weapon = 'stone', team }) {
    const W = WEAPONS[weapon] || WEAPONS.stone;
    const p = {
      id: this._id++, name, accent, isBot, weapon: W.key,
      x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, speed: 0,
      yaw: 0, pitch: 0, hp: CFG.HP, stones: W.start,
      speedMul: W.speedMul, aimMul: W.key === 'saber' ? 0.6 : CFG.AIM_SPEED_MUL,   // 舉劍擋的時候走得慢
      alive: true, aiming: false, charge: 0, cdUntil: 0, aimLock: false,
      lastDmgAt: -99, lastAttacker: 0, kills: 0, deaths: 0, respawnAt: 0,
      shieldUntil: 0, killedBy: 0, throwAt: -99, heads: 0,
      reloadUntil: 0, regenAt: 0, dashUntil: 0, dashX: 0, dashZ: 0, pendingSlash: false, crystalDmg: 0,
    };
    if (this.mode === 'team') {   // 沒指定就補到人少的那隊
      const n0 = this.players.filter((q) => q.team === 0).length, n1 = this.players.filter((q) => q.team === 1).length;
      p.team = team === 0 || team === 1 ? team : n0 <= n1 ? 0 : 1;
    }
    this.wstats[W.key] ||= { players: 0, kills: 0, deaths: 0, dmg: 0, shots: 0 };
    this.wstats[W.key].players++;
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
        p.kills, p.deaths, p.heads, r2(p.respawnAt), r2(p.shieldUntil), p.killedBy || 0, r2(p.throwAt), r2(p.speed), acks[p.id] || 0, r2(p.spawnAt || 0), r2(p.reloadUntil || 0), r2(p.regenAt || 0), p.crystalDmg || 0]),
      sn: this.stones.map((s) => [s.id, s.owner, r3(s.x), r3(s.y), r3(s.z), r2(s.vx), r2(s.vy), r2(s.vz), s.rest ? 1 : 0, s.active ? 1 : 0, r3(s.age), PROJ_CODE[s.kind] || 0]),
      ct: this.cats.map((c) => [c.id, c.owner, r2(c.x), r2(c.z), r3(c.yaw), r2(c.speed || 0)]),
      lo: this.loose.map((l) => [l.id, r2(l.x), r2(l.z), l.count]),
      pi: this.piles.map((pl) => r2(pl.readyAt)),
      cr: this.crystals.map((c) => Math.round(c.hp)), tk: this.teamKills,
    };
  }

  respawn(p) {
    const W = WEAPONS[p.weapon];
    const team = this.mode === 'team';
    // 水晶戰：在自己隊的基地旁出生，離敵人越遠越好
    const others = this.players.filter((q) => q !== p && q.alive && !(team && q.team === p.team));
    const spots = team ? this.bases[p.team].spawns : this.map.spawns;
    const cand = spots.map((s) => {
      let d = 1e9;
      for (const q of others) d = Math.min(d, Math.hypot(q.x - s.x, q.z - s.z));
      return { s, d: d + this.rng() * 8 };
    }).sort((a, b) => b.d - a.d);
    const s = cand[Math.floor(this.rng() * Math.min(3, cand.length))].s;
    p.x = p.px = s.x; p.z = p.pz = s.z; p.vx = p.vz = 0;
    // 面向最開闊的方向（不要一復活就對著牆）；水晶戰偏向敵方基地那邊
    let best = 0, bestLen = -1;
    const eb = team ? this.bases[1 - p.team] : null;
    const ea = eb ? Math.atan2(-(eb.x - s.x), -(eb.z - s.z)) : 0;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, dx = -Math.sin(a), dz = -Math.cos(a);
      let len = 0;
      while (len < 45 && this.map.heightAt(s.x + dx * len, s.z + dz * len) <= 0 && this.map.isReach(s.x + dx * len, s.z + dz * len)) len += 0.5;
      if (eb) len += Math.cos(a - ea) * 12;
      if (len > bestLen) { bestLen = len; best = a; }
    }
    p.yaw = best;
    p.pitch = 0;
    p.hp = CFG.HP; p.stones = W.start; p.alive = true;
    p.aiming = false; p.charge = 0; p.aimLock = false;
    p.reloadUntil = 0; p.regenAt = this.time + (W.regen || 0); p.dashUntil = 0; p.pendingSlash = false;
    // 回力鏢還在外面飛就收掉，手上重新給一支
    this.stones = this.stones.filter((st) => !(st.kind === 'boom' && st.owner === p.id));
    p.shieldUntil = this.time + CFG.SPAWN_SHIELD;
    p.spawnAt = this.time;
    p.lastDmgAt = -99;
    this.events.push({ type: 'spawn', id: p.id, x: p.x, z: p.z, yaw: p.yaw });
  }

  canAim(p, W) {
    if (W.kind === 'melee') return p.dashUntil <= this.time;
    if (W.kind === 'hitscan') return p.stones > 0 && p.reloadUntil <= this.time;
    return p.stones > 0;
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
      const W = WEAPONS[p.weapon];
      const inp = inputs[p.id] || { ...IDLE, yaw: p.yaw, pitch: p.pitch };
      p.yaw = inp.yaw;
      p.pitch = Math.max(-1.25, Math.min(1.25, inp.pitch));

      // 光劍衝刺：這段時間不聽搖桿，往前衝；碰到敵人或時間到就揮砍
      if (p.dashUntil > this.time - 1e-9 && p.pendingSlash) {
        p.vx = p.dashX; p.vz = p.dashZ;
        p.x += p.vx * dt; p.z += p.vz * dt;
        map.collide(p);
        const near = this.players.some((q) => q !== p && q.alive && !this.ally(p.id, q.id) && Math.hypot(q.x - p.x, q.z - p.z) < W.reach * 0.7 && this._inCone(p, q, W.cone));
        if (near || this.time >= p.dashUntil) { p.dashUntil = 0; p.pendingSlash = false; this._slash(p, W); p.vx *= 0.3; p.vz *= 0.3; }
      } else {
        movePlayer(map, p, inp, dt);
      }

      // 按下開始蓄力（或舉劍、端槍），放開出手
      if (inp.cancel && p.aiming) { p.aiming = false; p.charge = 0; p.aimLock = true; this.events.push({ type: 'cancel', id: p.id }); }
      if (!inp.aim) p.aimLock = false;
      if (inp.aim && !p.aiming && !p.aimLock && this.canAim(p, W) && this.time >= p.cdUntil) {
        p.aiming = true; p.charge = 0;
        this.events.push({ type: 'aim', id: p.id });
      }
      if (p.aiming) {
        // 步槍：只有站穩（幾乎不動）時才會越瞄越準
        if (W.kind !== 'hitscan' || p.speed < 1.2) p.charge = Math.min(1, p.charge + dt / W.chargeT);
        if (!inp.aim && !inp.cancel) {
          // 連線玩家回報自己畫面上的蓄力（延遲會讓房主這邊少算一點），最多多給 0.3
          if (typeof inp.ch === 'number') p.charge = Math.max(0, Math.min(1, inp.ch, p.charge + 0.3));
          this.fire(p, W, inp);
        }
      }

      // 彈藥自己會回來：步槍打完自動換彈；石頭、手榴彈、貓每隔幾秒補一發（滿了計時停住）
      if (W.kind === 'hitscan' && p.stones === 0 && p.reloadUntil && this.time >= p.reloadUntil) {
        p.stones = W.ammo; p.reloadUntil = 0;
        this.events.push({ type: 'reloaded', id: p.id });
      }
      if (W.regen && p.stones < W.ammo && this.time >= p.regenAt) {
        p.stones++; p.regenAt = this.time + W.regen;
        this.events.push({ type: 'regen', id: p.id });
      }
      if (W.regen && p.stones >= W.ammo) p.regenAt = this.time + W.regen;

      // 回血：只有真人會（電腦不回血，打殘的電腦跑掉也不會滿血回來）
      if (!p.isBot && this.time - p.lastDmgAt > CFG.REGEN_DELAY && p.hp < CFG.HP) p.hp = Math.min(CFG.HP, p.hp + CFG.REGEN_RATE * dt);
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
    // 水晶（含底座）擋路：推到圓外
    for (const c of this.crystals) for (const p of ps) if (p.alive) this._pushOut(p, c, CFG.CRYSTAL_R + CFG.R);
    for (const p of ps) p.speed = Math.hypot(p.x - p.px, p.z - p.pz) / dt;

    this._stepStones(dt);
    this._stepCats(dt);

    if (this.time >= this.matchTime) this.end();
  }

  // ---------- 出手 ----------
  fire(p, W, inp) {
    const held = p.charge;
    p.aiming = false; p.charge = 0;
    p.cdUntil = this.time + W.cd;
    p.throwAt = this.time;
    this.stats.throws++;
    this.wstats[W.key].shots++;
    if (W.kind === 'arc') this._throw(p, W, inp, held);
    else if (W.kind === 'hitscan') this._shoot(p, W, held);
    else if (W.kind === 'melee') {
      if (held * W.chargeT >= W.lungeT) {
        const f = facing(p.yaw), sp = W.lungeDist / W.lungeTime;
        p.dashUntil = this.time + W.lungeTime; p.dashX = f.x * sp; p.dashZ = f.z * sp; p.pendingSlash = true;
        p.cdUntil = this.time + W.lungeCd;   // 衝刺之後要喘一下
        p.lungeAt = this.time;
        this.events.push({ type: 'lunge', id: p.id, x: p.x, z: p.z });
      } else this._slash(p, W);
    } else if (W.kind === 'boom') this._boomerang(p, W, inp);
    if (W.kind !== 'melee') {
      this.noise.push({ id: p.id, x: p.x, z: p.z, t: this.time });
      if (this.noise.length > 24) this.noise.splice(0, this.noise.length - 24);
    }
  }

  // 拋物線武器：輸入帶了準心落點解就照它丟，沒有（電腦）就照視線與蓄力
  _throw(p, W, inp, held) {
    const aimed = typeof inp.tp === 'number' && typeof inp.ty === 'number' && typeof inp.tv === 'number';
    const v = aimed ? Math.max(4, Math.min(W.vMax, inp.tv)) : chargeSpeedW(W, held);
    const ty = aimed ? inp.ty : p.yaw, tp = aimed ? Math.max(-1.4, Math.min(1.4, inp.tp)) : p.pitch;
    const o = throwOrigin(p.x, p.z, ty);
    const f = forward(ty, tp);
    this.stones.push({
      id: this._id++, kind: W.proj, owner: p.id, x: o.x, y: o.y, z: o.z,
      vx: f.x * v, vy: f.y * v, vz: f.z * v,
      ox: p.x, oz: p.z, active: true, alive: true, rest: false, age: 0, roof: false,
    });
    p.stones--;
    this.events.push({ type: 'throw', id: p.id, x: p.x, z: p.z, v, w: W.key });
  }

  // 步槍：直線瞬間命中，按住越久越準、移動會飄
  _shoot(p, W, held) {
    const spread = (W.spreadMax - (W.spreadMax - W.spreadMin) * held + W.moveSpread * Math.min(1, p.speed / CFG.SPEED)) * DEG;
    const a = this.rng() * Math.PI * 2, r = Math.sqrt(this.rng()) * spread;
    const dir = forward(p.yaw + Math.cos(a) * r, p.pitch + Math.sin(a) * r);
    const f = facing(p.yaw);
    const x0 = p.x + f.x * 0.4 + Math.cos(p.yaw) * 0.18, y0 = CFG.EYE - 0.12, z0 = p.z + f.z * 0.4 - Math.sin(p.yaw) * 0.18;
    const foes = this.mode === 'team' ? this.players.filter((q) => q === p || q.team !== p.team) : this.players;   // 子彈穿過隊友
    let hit = raycast(this.map, p.x, CFG.EYE, p.z, dir, foes, p.id, W.range);
    // 水晶或貓擋在線上就打到它們
    const cr = this._crystalOnRay(p.x, CFG.EYE, p.z, dir, hit.t, p.team);
    const cat = this._catOnRay(p.x, CFG.EYE, p.z, dir, cr ? cr.t : hit.t, p.id);
    if (cat) { this._catDown(cat, p.id); hit = { ...cat.hitPt, surf: 'cat' }; }
    else if (cr) { hit = { x: cr.x, y: cr.y, z: cr.z, t: cr.t, surf: 'crystal' }; this.hitCrystal(cr.c, W.dmg, p.id, { ...hit, w: W.key }); }
    else if (hit.player) {
      const q = hit.player;
      if (this._guards(q, p.x, p.z)) {
        this.events.push({ type: 'deflect', id: q.id, by: p.id, x: hit.x, y: hit.y, z: hit.z });
        hit = { ...hit, surf: 'deflect' };
      } else {
        const head = hit.part === 'head';
        // 遠距離衰減：[滿傷害距離, 最低點距離, 最低倍率]
        const [f0, f1, fm] = W.falloff || [999, 1000, 1];
        const fk = hit.t <= f0 ? 1 : hit.t >= f1 ? fm : 1 - (1 - fm) * (hit.t - f0) / (f1 - f0);
        this.damage(q, Math.round((head ? W.dmgHead : W.dmg) * fk), p.id, { head, x: hit.x, y: hit.y, z: hit.z, fromX: p.x, fromZ: p.z, w: W.key });
      }
    }
    p.stones--;
    if (p.stones <= 0) { p.reloadUntil = this.time + W.reload; this.events.push({ type: 'reload', id: p.id }); }
    this.events.push({ type: 'shot', id: p.id, x0, y0, z0, x1: hit.x, y1: hit.y, z1: hit.z, surf: hit.surf });
  }

  _inCone(p, q, coneDeg) {
    const f = facing(p.yaw), dx = q.x - p.x, dz = q.z - p.z, d = Math.hypot(dx, dz) || 1;
    return (dx * f.x + dz * f.z) / d >= Math.cos(coneDeg * DEG);
  }

  // 舉著光劍、而且來源在正面：擋得掉
  _guards(q, fromX, fromZ) {
    if (q.weapon !== 'saber' || !q.aiming || !q.alive) return false;
    return this._inCone(q, { x: fromX, z: fromZ }, WEAPONS.saber.guardCone);
  }

  _slash(p, W) {
    this.events.push({ type: 'slash', id: p.id, x: p.x, z: p.z, yaw: p.yaw });
    for (const q of this.players) {
      if (q === p || !q.alive || this.ally(p.id, q.id)) continue;
      if (Math.hypot(q.x - p.x, q.z - p.z) > W.reach || !this._inCone(p, q, W.cone)) continue;
      if (!this.map.los(p.x, 1.2, p.z, q.x, 1.2, q.z)) continue;
      if (this._guards(q, p.x, p.z)) { this.events.push({ type: 'clash', id: q.id, by: p.id, x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }); continue; }
      this.damage(q, W.dmg, p.id, { head: false, x: q.x, y: 1.2, z: q.z, fromX: p.x, fromZ: p.z, w: W.key });
    }
    for (const c of this.cats) {
      if (!c.alive || this.ally(c.owner, p.id)) continue;
      if (Math.hypot(c.x - p.x, c.z - p.z) <= W.reach && this._inCone(p, c, W.cone)) this._catDown(c, p.id);
    }
    for (const c of this.crystals) {   // 敵方水晶：碰得到邊就砍得到
      if (c.team === p.team) continue;
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d - CFG.CRYSTAL_R <= W.reach && (d < CFG.CRYSTAL_R + 0.4 || this._inCone(p, c, W.cone))) this.hitCrystal(c, W.dmg, p.id, { x: c.x, y: 1.4, z: c.z, w: W.key });
    }
  }

  _boomerang(p, W, inp) {
    const yaw = typeof inp.ty === 'number' ? inp.ty : p.yaw;
    const o = throwOrigin(p.x, p.z, yaw);
    this.stones.push({
      id: this._id++, kind: 'boom', owner: p.id, x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0,
      sx: o.x, sz: o.z, y0: o.y, yaw, s: 0, phase: 'out', hits: new Set(), active: true, alive: true, rest: false, age: 0, ox: p.x, oz: p.z,
    });
    p.stones = 0;
    this.events.push({ type: 'throw', id: p.id, x: p.x, z: p.z, v: W.speed, w: W.key });
  }

  // ---------- 飛行物 ----------
  _stepStones(dt) {
    const h = dt / SUB;
    for (const s of this.stones) {
      if (!s.alive) continue;
      s.lx = s.x; s.ly = s.y; s.lz = s.z;   // 給畫面插值
      s.age += dt;
      if (s.kind === 'boom') { this._stepBoom(s, dt); continue; }
      if (s.rest) {
        if (s.age > 4) s.alive = false;   // 落地的石頭躺一下就消失（不能撿）
        continue;
      }
      for (let k = 0; k < SUB && s.alive && !s.rest; k++) {
        const c = advance(this.map, s, h);
        if (s.active) {
          this._projVsCreatures(s);
          if (!s.alive) break;
        }
        if (!c) continue;
        const sp = Math.hypot(s.vx, s.vy, s.vz);
        if (c.type === 'out') { s.alive = false; break; }
        if (s.kind === 'grenade') {
          const at = c.type === 'wall' ? { x: c.px, y: c.py, z: c.pz } : c.type === 'roof' ? { x: s.x, y: c.h + 0.1, z: s.z } : { x: s.x, y: 0.1, z: s.z };
          this._explode(at.x, at.y, at.z, s.owner);
          s.alive = false;
          break;
        }
        if (s.kind === 'catball' && c.type !== 'wall') {
          this._spawnCat(s.x, s.z, s.owner);
          s.alive = false;
          break;
        }
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
          if (s.kind !== 'catball') s.active = false;
          continue;
        }
        // ground（石頭）
        if (s.active || sp > 3) this.events.push({ type: 'impact', surf: 'ground', x: s.x, y: 0, z: s.z, sp, active: s.active, owner: s.owner });
        s.active = false;
        s.y = CFG.STONE_R;
        s.vy = Math.abs(s.vy) * 0.28;
        s.vx *= 0.5; s.vz *= 0.5;
        if (Math.hypot(s.vx, s.vy, s.vz) < 1.4) {
          s.rest = true; s.age = 0; s.vx = s.vy = s.vz = 0;
          if (this.map.heightAt(s.x, s.z) > 0) s.alive = false;
        }
      }
    }
    this.stones = this.stones.filter((s) => s.alive);
  }

  // 飛行物碰到人或貓：光劍擋 → 彈回；石頭 → 傷害；手榴彈 → 爆；貓 → 咬
  _projVsCreatures(s) {
    // 水晶：敵方的扣血；自己隊的只擋住（回力鏢直接穿過自己隊的）
    for (const c of this.crystals) {
      if ((s.x - c.x) ** 2 + (s.z - c.z) ** 2 > (CFG.CRYSTAL_R + 0.08) ** 2 || s.y < 0.1 || s.y > CFG.CRYSTAL_TOP) continue;
      const own = this.byId(s.owner), enemy = !own || own.team !== c.team;
      if (s.kind === 'grenade') { this._explode(s.x, s.y, s.z, s.owner); s.alive = false; return; }
      const w = s.kind === 'catball' ? 'cat' : 'stone';
      if (enemy) this.hitCrystal(c, WEAPONS[w].dmg, s.owner, { x: s.x, y: s.y, z: s.z, w });
      else this.events.push({ type: 'impact', surf: 'wall', x: s.x, y: s.y, z: s.z, sp: 6, active: true, owner: s.owner });
      if (s.kind === 'catball' && !enemy) this._spawnCat(s.x, s.z, s.owner);   // 丟到自己的水晶：貓跳下來繼續追人
      s.alive = false;
      return;
    }
    for (const q of this.players) {
      if (!q.alive || q.id === s.owner || this.ally(s.owner, q.id)) continue;
      const dx = s.x - q.x, dz = s.z - q.z;
      if (dx * dx + dz * dz < 1.0 && s.y > 0.2 && s.y < 2.1 && this._guards(q, s.x - s.vx * 0.05, s.z - s.vz * 0.05)) {
        this._deflect(s, q);
        return;
      }
      const part = hitPart(s.x, s.y, s.z, q);
      if (!part) continue;
      if (s.kind === 'grenade') { this._explode(s.x, s.y, s.z, s.owner); s.alive = false; return; }
      if (s.kind === 'catball') {
        s.alive = false;
        this.damage(q, WEAPONS.cat.dmg, s.owner, { head: false, x: s.x, y: s.y, z: s.z, fromX: s.ox, fromZ: s.oz, w: 'cat' });
        this.events.push({ type: 'bite', target: q.id, by: s.owner, x: q.x, z: q.z });
        return;
      }
      this._hit(q, s, part);
      return;
    }
    for (const c of this.cats) {
      if (!c.alive || this.ally(c.owner, s.owner)) continue;
      if ((s.x - c.x) ** 2 + (s.z - c.z) ** 2 < CAT_HIT * CAT_HIT && s.y < CAT_TOP) {
        this._catDown(c, s.owner);
        if (s.kind === 'grenade') { this._explode(s.x, s.y, s.z, s.owner); s.alive = false; } else if (s.kind !== 'boom') s.active = false;
        return;
      }
    }
  }

  _deflect(s, q) {
    // 對著舉劍的人的正面反射，飛行物歸他所有
    const f = facing(q.yaw);
    const vn = s.vx * f.x + s.vz * f.z;
    if (s.kind === 'boom') { s.phase = 'back'; s.hits = new Set(); }
    else {
      s.vx = (s.vx - 2 * vn * f.x) * 0.85; s.vz = (s.vz - 2 * vn * f.z) * 0.85; s.vy = Math.abs(s.vy) * 0.5 + 1.5;
      s.owner = q.id; s.ox = q.x; s.oz = q.z;
    }
    this.events.push({ type: 'deflect', id: q.id, x: s.x, y: s.y, z: s.z });
  }

  // 手榴彈：範圍傷害，牆擋得住；炸到自己扣一半
  _explode(x, y, z, owner) {
    const W = WEAPONS.grenade;
    this.events.push({ type: 'explode', x, y, z, r: W.radius, owner });
    for (const q of this.players) {
      if (!q.alive) continue;
      const d = Math.hypot(q.x - x, 1.0 - y, q.z - z);
      if (d > W.radius) continue;
      if (!this.map.los(x, y + 0.25, z, q.x, 1.0, q.z) && !this.map.los(x, y + 0.25, z, q.x, 1.7, q.z)) continue;
      const k = d <= W.inner ? 1 : 1 - (d - W.inner) / (W.radius - W.inner);
      const dmg = Math.round(W.dmg * k * (q.id === owner ? W.selfMul : 1));
      if (dmg >= 3) this.damage(q, dmg, owner, { head: false, x: q.x, y: 1.1, z: q.z, fromX: x, fromZ: z, w: 'grenade', splash: true });
    }
    for (const c of this.cats) if (c.alive && !this.ally(c.owner, owner) && Math.hypot(c.x - x, c.z - z) < W.radius) this._catDown(c, owner);
    const o = this.byId(owner);
    for (const c of this.crystals) {
      if (o && o.team === c.team) continue;
      const d = Math.max(0, Math.hypot(c.x - x, c.z - z) - CFG.CRYSTAL_R);
      if (d > W.radius) continue;
      if (!this.map.los(x, y + 0.25, z, c.x, 1.4, c.z)) continue;
      const k = d <= W.inner ? 1 : 1 - (d - W.inner) / (W.radius - W.inner);
      this.hitCrystal(c, Math.round(W.dmg * k), owner, { x: c.x, y: 1.4, z: c.z, w: 'grenade' });
    }
  }

  _stepBoom(s, dt) {
    const W = WEAPONS.boomerang;
    const owner = this.byId(s.owner);
    const px = s.x, py = s.y, pz = s.z;
    if (!owner || !owner.alive) { s.alive = false; return; }
    if (s.phase === 'drop') {
      if (s.age - s.dropAt > 0.8) {   // 掉在地上一下，然後回到手上
        s.alive = false; owner.stones = 1;
        this.events.push({ type: 'catch', id: owner.id, x: owner.x, z: owner.z });
      }
      s.vx = s.vy = s.vz = 0;
      return;
    }
    if (s.phase === 'out') {
      s.s += W.speed * dt;
      const f = facing(s.yaw), rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      const bend = Math.sin(Math.PI * Math.min(1, s.s / W.range)) * 2.4;   // 往右彎出去
      s.x = s.sx + f.x * s.s + rx * bend; s.z = s.sz + f.z * s.s + rz * bend;
      s.y = s.y0 - 0.25 * (s.s / W.range);
      if (s.s >= W.range) { s.phase = 'back'; s.hits = new Set(); }
    } else {
      const dx = owner.x - s.x, dy = 1.25 - s.y, dz = owner.z - s.z, d = Math.hypot(dx, dy, dz);
      if (d < 0.9) {
        s.alive = false; owner.stones = 1;
        this.events.push({ type: 'catch', id: owner.id, x: owner.x, z: owner.z });
        return;
      }
      const st = Math.min(d, W.backSpeed * dt);
      s.x += (dx / d) * st; s.y += (dy / d) * st; s.z += (dz / d) * st;
    }
    s.vx = (s.x - px) / dt; s.vy = (s.y - py) / dt; s.vz = (s.z - pz) / dt;
    // 撞牆：掉在牆腳
    if (!this.map.inGrid(s.x, s.z) || this.map.heightAt(s.x, s.z) > s.y) {
      s.x = px; s.z = pz; s.y = 0.06; s.phase = 'drop'; s.dropAt = s.age; s.active = false;
      this.events.push({ type: 'impact', surf: 'wall', x: px, y: py, z: pz, sp: W.speed, active: true, owner: s.owner });
      return;
    }
    // 打人（每一趟每個人只算一次）
    for (const q of this.players) {
      if (!q.alive || q.id === s.owner || s.hits.has(q.id) || this.ally(s.owner, q.id)) continue;
      if (this._guards(q, s.x - s.vx * 0.05, s.z - s.vz * 0.05) && Math.hypot(q.x - s.x, q.z - s.z) < 1.0) { s.hits.add(q.id); this._deflect(s, q); continue; }
      const part = hitPart(s.x, s.y, s.z, q) || (Math.hypot(q.x - s.x, q.z - s.z) < 0.6 && s.y < 1.9 ? 'body' : null);
      if (!part) continue;
      s.hits.add(q.id);
      this.damage(q, W.dmg, s.owner, { head: part === 'head', x: s.x, y: s.y, z: s.z, fromX: s.ox, fromZ: s.oz, w: W.key });
    }
    // 敵方水晶：每一趟打一次，回力鏢繼續飛
    for (const c of this.crystals) {
      if (owner.team === c.team || s.hits.has(-1 - c.team)) continue;
      if (Math.hypot(c.x - s.x, c.z - s.z) < CFG.CRYSTAL_R + 0.15 && s.y < CFG.CRYSTAL_TOP) {
        s.hits.add(-1 - c.team);
        this.hitCrystal(c, W.dmg, s.owner, { x: s.x, y: s.y, z: s.z, w: W.key });
      }
    }
    for (const c of this.cats) {
      if (c.alive && !this.ally(c.owner, s.owner) && s.y < 1.0 && Math.hypot(c.x - s.x, c.z - s.z) < 0.5) this._catDown(c, s.owner);
    }
  }

  // ---------- 貓 ----------
  _spawnCat(x, z, owner) {
    let cx = x, cz = z;
    if (!this.map.isReach(x, z)) {
      const n = this.map.nearestReach(x, z, 10);
      if (n < 0) return;
      const c = this.map.navCenter(n); cx = c.x; cz = c.z;
    }
    const W = WEAPONS.cat;
    this.cats.push({ id: this._id++, owner, x: cx, z: cz, px: cx, pz: cz, vx: 0, vz: 0, yaw: 0, speed: 0, life: W.catLife, target: 0, retarget: 0, path: null, pi: 0, repathAt: 0, alive: true });
    this.events.push({ type: 'cat', id: owner, x: cx, z: cz, lx: x, lz: z });   // lx／lz：球真正落地的點（貓可能被挪到旁邊走得到的地方）
  }

  _catDown(c, by) {
    if (!c.alive) return;
    c.alive = false;
    this.events.push({ type: 'catdown', x: c.x, z: c.z, owner: c.owner, by });
  }

  _catOnRay(ox, oy, oz, d, maxT, shooter = 0) {
    let best = null, bt = maxT;
    for (const c of this.cats) {
      if (!c.alive || (shooter && this.ally(c.owner, shooter))) continue;
      // 射線和貓（中心 0.3 m 高的小圓柱）最近的點
      const t = ((c.x - ox) * d.x + (0.3 - oy) * d.y + (c.z - oz) * d.z);
      if (t < 0 || t > bt) continue;
      const x = ox + d.x * t, y = oy + d.y * t, z = oz + d.z * t;
      if (Math.hypot(x - c.x, z - c.z) < CAT_HIT && y < CAT_TOP + 0.1) { bt = t; best = c; c.hitPt = { x, y, z, t }; }
    }
    return best;
  }

  _stepCats(dt) {
    const W = WEAPONS.cat;
    for (const c of this.cats) {
      if (!c.alive) continue;
      c.px = c.x; c.pz = c.z;
      c.life -= dt;
      if (c.life <= 0) { c.alive = false; this.events.push({ type: 'catdown', x: c.x, z: c.z, owner: c.owner, by: 0 }); continue; }
      // 找目標：看得到的最近敵人（剛復活無敵的不咬）；水晶戰沒人可咬時去咬看得到的敵方水晶
      let t = c.target > 0 ? this.byId(c.target) : c.target < 0 ? this.crystals[-1 - c.target] : null;
      if (!t || t.alive === false || this.time >= c.retarget) {
        c.retarget = this.time + 0.3;
        let best = null, bd = W.catSight;
        for (const q of this.players) {
          if (!q.alive || this.ally(q.id, c.owner) || this.time < q.shieldUntil) continue;
          const d = Math.hypot(q.x - c.x, q.z - c.z);
          if (d < bd && (d < 5 || this.map.los(c.x, 0.5, c.z, q.x, 1.0, q.z))) { bd = d; best = q; }
        }
        let tid = best ? best.id : 0;
        if (!best) {
          const o = this.byId(c.owner);
          for (const cr of this.crystals) {
            if (!o || cr.team === o.team) continue;
            const d = Math.hypot(cr.x - c.x, cr.z - c.z);
            if (d < W.catSight && (d < 5 || this.map.los(c.x, 0.5, c.z, cr.x, 1.2, cr.z))) { best = cr; tid = -1 - cr.team; }
          }
        }
        if (tid !== c.target) c.path = null;
        t = best; c.target = tid;
      }
      let mx = 0, mz = 0, sp = W.catSpeed;
      if (t) {
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        const isCr = c.target < 0;
        if (d < (isCr ? CFG.CRYSTAL_R + CAT_R + 0.15 : 0.6)) {
          if (isCr) this.hitCrystal(t, W.dmg, c.owner, { x: c.x, y: 0.6, z: c.z, w: 'cat' });
          else this.damage(t, W.dmg, c.owner, { head: false, x: t.x, y: 0.6, z: t.z, fromX: c.x, fromZ: c.z, w: 'cat' });
          this.events.push({ type: 'bite', target: isCr ? 0 : t.id, by: c.owner, x: isCr ? c.x : t.x, z: isCr ? c.z : t.z });
          c.alive = false;
          continue;
        }
        if (this.map.walkLine(c.x, c.z, t.x, t.z)) { mx = (t.x - c.x) / d; mz = (t.z - c.z) / d; c.path = null; }
        else {
          if ((!c.path || this.time > c.repathAt) && this._pathTick !== this.tick) {
            this._pathTick = this.tick;
            c.path = this.map.findPath(c.x, c.z, t.x, t.z, 20000); c.pi = 1; c.repathAt = this.time + 0.8;
          }
          if (c.path) {
            while (c.pi < c.path.length && Math.hypot(c.path[c.pi].x - c.x, c.path[c.pi].z - c.z) < 0.5) c.pi++;
            const w = c.path[Math.min(c.pi, c.path.length - 1)];
            const dd = Math.hypot(w.x - c.x, w.z - c.z) || 1;
            mx = (w.x - c.x) / dd; mz = (w.z - c.z) / dd;
          }
        }
      } else {
        // 沒目標：原地踱步
        sp = 1.2;
        if (!c.wander || this.time > c.wander.until) { const a = this.rng() * Math.PI * 2; c.wander = { x: Math.cos(a), z: Math.sin(a), until: this.time + 1 + this.rng() * 1.5 }; }
        mx = c.wander.x; mz = c.wander.z;
      }
      const k = Math.min(1, dt * 10);
      c.vx += (mx * sp - c.vx) * k; c.vz += (mz * sp - c.vz) * k;
      c.x += c.vx * dt; c.z += c.vz * dt;
      this.map.collide(c, CAT_R);
      for (const cr of this.crystals) this._pushOut(c, cr, CFG.CRYSTAL_R + CAT_R);
      c.speed = Math.hypot(c.x - c.px, c.z - c.pz) / dt;
      if (c.speed > 0.2) c.yaw = Math.atan2(-(c.x - c.px), -(c.z - c.pz));
    }
    this.cats = this.cats.filter((c) => c.alive);
  }

  // ---------- 傷害 ----------
  _hit(q, s, part) {
    s.alive = false;
    const head = part === 'head';
    this.damage(q, head ? WEAPONS.stone.dmgHead : WEAPONS.stone.dmg, s.owner, { head, x: s.x, y: s.y, z: s.z, fromX: s.ox, fromZ: s.oz, w: 'stone' });
  }

  // 所有傷害都走這裡：無敵擋掉、扣血、事件、擊倒與計分
  damage(q, dmg, byId, info = {}) {
    if (!q.alive) return false;
    if (byId !== q.id && this.ally(byId, q.id)) return false;   // 隊友打不到隊友（手榴彈炸到自己還是會扣）
    if (this.time < q.shieldUntil) {
      this.events.push({ type: 'block', target: q.id, by: byId, x: info.x ?? q.x, y: info.y ?? 1, z: info.z ?? q.z });
      return false;
    }
    const shooter = this.byId(byId);
    q.hp -= dmg;
    q.lastDmgAt = this.time;
    q.lastAttacker = byId;
    this.stats.hits++;
    if (shooter && shooter !== q) { this.wstats[shooter.weapon].dmg += dmg; this.wstats[shooter.weapon].hits = (this.wstats[shooter.weapon].hits || 0) + 1; }
    if (info.head) { this.stats.heads++; if (shooter) shooter.heads++; }
    this.events.push({ type: 'hit', target: q.id, by: byId, head: !!info.head, dmg, x: info.x ?? q.x, y: info.y ?? 1, z: info.z ?? q.z, fromX: info.fromX ?? q.x, fromZ: info.fromZ ?? q.z, w: info.w });
    if (q.hp <= 0) {
      q.hp = 0; q.alive = false; q.deaths++;
      q.killedBy = byId; q.respawnAt = this.time + (this.mode === 'team' ? CFG.TEAM_RESPAWN_T : CFG.RESPAWN_T);
      q.aiming = false; q.charge = 0; q.dashUntil = 0; q.pendingSlash = false;
      q.stones = 0;
      this.wstats[q.weapon].deaths++;
      if (shooter && shooter !== q) { shooter.kills++; this.wstats[shooter.weapon].kills++; if (this.mode === 'team') this.teamKills[shooter.team]++; }
      this.stats.kos++;
      this.events.push({ type: 'ko', victim: q.id, by: byId, head: !!info.head, w: info.w });
      if (shooter && shooter !== q && shooter.kills >= this.koLimit) this.end();
    }
    return true;
  }

  // 水晶受傷：只會被敵隊打；各武器打水晶的倍率在 weapons.js（vsCrystal）
  hitCrystal(c, dmg, byId, info = {}) {
    if (this.state !== 'play' || c.hp <= 0) return;
    const by = this.byId(byId);
    if (by && by.team === c.team) return;
    const W = WEAPONS[info.w];
    const d = Math.max(1, Math.round(dmg * (W ? W.vsCrystal ?? 1 : 1)));
    c.hp = Math.max(0, c.hp - d);
    c.lastHit = this.time;
    if (by) by.crystalDmg += d;
    this.events.push({ type: 'crystal', team: c.team, hp: c.hp, dmg: d, by: byId, x: info.x ?? c.x, y: info.y ?? 1.4, z: info.z ?? c.z, w: info.w });
    if (c.hp <= 0) {
      this.events.push({ type: 'crystaldown', team: c.team, by: byId, x: c.x, z: c.z });
      this.end(1 - c.team);
    }
  }

  _pushOut(o, c, r) {
    const dx = o.x - c.x, dz = o.z - c.z, d = Math.hypot(dx, dz);
    if (d >= r) return;
    const k = d > 1e-6 ? r / d : 0;
    if (k) { o.x = c.x + dx * k; o.z = c.z + dz * k; } else o.x = c.x + r;
    this.map.collide(o);
  }

  // 射線打到水晶的位置；自己隊的水晶子彈直接穿過
  _crystalOnRay(ox, oy, oz, d, maxT, team) { return crystalRay(this.crystals, ox, oy, oz, d, maxT, team); }

  // 結束：大亂鬥看 KO；水晶戰看誰的水晶被打破，時間到比水晶剩多少（再平手比隊伍 KO）
  end(winnerTeam) {
    if (this.state === 'over') return;
    this.state = 'over';
    this.winner = this.ranking()[0];
    if (this.mode === 'team') {
      if (winnerTeam === undefined) {
        const [a, b] = this.crystals.map((c) => c.hp / c.max);
        winnerTeam = Math.abs(a - b) > 1e-6 ? (a > b ? 0 : 1) : this.teamKills[0] !== this.teamKills[1] ? (this.teamKills[0] > this.teamKills[1] ? 0 : 1) : -1;
      }
      this.winnerTeam = winnerTeam;
    }
    this.events.push({ type: 'over', winner: this.winner.id, team: this.winnerTeam });
  }

  ranking() {
    return [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.heads - a.heads);
  }
}
