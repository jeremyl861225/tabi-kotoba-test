// 連線客人這邊的「鏡像世界」：不自己判定，只把房主的快照變成畫面與 HUD 要的形狀（跟 Sim 一樣的欄位）。
// 其他玩家：快照存成時間軸，畫面落後 100 ms 內插；石頭：從最新快照用同一套彈道往前推；自己：本機預測（main.js）。
import { CFG } from './config.js';
import { SUB, advance } from './physics.js';
import { PROJ_KIND, WEAPONS } from './weapons.js';

const DELAY = 0.1;

export class MirrorSim {
  constructor(map, roster, matchTime, mode = 'ffa', swap = false) {
    this.map = map;
    this.mode = mode;
    this.teams = mode === 'team' || mode === 'elim';
    // 水晶戰：基地位置跟房主一樣從地圖算（swap 也一樣），血量看快照
    this.bases = this.teams ? (swap ? [map.bases[1], map.bases[0]] : map.bases) : [];
    const hp = map.data.crystalHp || CFG.CRYSTAL_HP;
    this.crystals = (mode === 'team' ? this.bases : []).map((b, i) => ({ team: i, x: b.x, z: b.z, hp, max: hp, lastHit: -99 }));
    this.teamKills = [0, 0];
    this.winnerTeam = -1;
    this.players = roster.map((r) => {
      const W = WEAPONS[r.weapon] || WEAPONS.stone;
      return {
        id: r.id, name: r.name, accent: r.accent, isBot: r.isBot, weapon: W.key, team: r.team, crystalDmg: 0,
        x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, speed: 0, yaw: 0, pitch: 0, hp: CFG.HP, stones: W.start,
        speedMul: W.speedMul, aimMul: W.key === 'saber' ? 0.6 : CFG.AIM_SPEED_MUL,   // 本機預測移動要跟房主一樣快
        alive: true, aiming: false, charge: 0, kills: 0, deaths: 0, heads: 0, respawnAt: 0, shieldUntil: 0, killedBy: 0, throwAt: -99, spawnAt: 0, reloadUntil: 0,
      };
    });
    this.stones = [];
    this.cats = [];
    this.catBase = [];
    this.loose = [];
    this.piles = [];
    this.events = [];
    this.time = 0;
    this.matchTime = matchTime;
    this.state = 'play';
    this.snaps = [];
    this.stoneBase = [];
    this.lastSnap = null;
  }

  byId(id) { return this.players.find((p) => p.id === id); }
  ally(a, b) { if (a === b) return true; if (!this.teams) return false; const p = this.byId(a), q = this.byId(b); return !!(p && q && p.team === q.team); }
  ranking() { return [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.heads - a.heads); }
  removePlayer(id) { this.players = this.players.filter((p) => p.id !== id); }

  // 收到快照：非位置的狀態直接套用；位置進時間軸
  apply(s, meId, recvAt) {
    if (this.lastSnap && s.ht <= this.lastSnap.t) return null;   // 亂序的舊快照
    const pos = new Map();
    let mine = null;
    // 快照就是名單的權威：快照裡沒有的人（中途離開、離開事件掉了）直接拿掉
    const ids = new Set(s.pl.map((a) => a[0]));
    this.players = this.players.filter((p) => ids.has(p.id));
    for (const a of s.pl) {
      const [id, x, z, yaw, pitch, hp, stones, alive, aiming, charge, kills, deaths, heads, respawnAt, shieldUntil, killedBy, throwAt, speed, ack, spawnAt, reloadUntil, regenAt, crystalDmg, dmgDealt] = a;
      const p = this.byId(id);
      if (!p) continue;
      // 位置與「看得到的動作」（生死、舉手、出手）放進時間軸，跟著延遲 100 ms 的畫面一起播
      pos.set(id, { x, z, yaw, pitch, speed, alive: !!alive, aiming: !!aiming, charge, throwAt, spawnAt });
      Object.assign(p, { hp, stones, kills, deaths, heads, respawnAt, shieldUntil, killedBy, spawnAt, reloadUntil: reloadUntil || 0, regenAt: regenAt || 0, crystalDmg: crystalDmg || 0, dmgDealt: dmgDealt || 0 });
      if (id === meId) { mine = { x, z, yaw, alive: !!alive, ack, hp }; p.alive = !!alive; }
    }
    this.snaps.push({ t: s.ht, pos });
    if (this.snaps.length > 6) this.snaps.shift();
    this.stoneBase = s.sn.map(([id, owner, x, y, z, vx, vy, vz, rest, active, age, kind]) => ({ id, owner, x, y, z, vx, vy, vz, rest: !!rest, active: !!active, age: age || 0, kind: PROJ_KIND[kind || 0] }));
    if (s.cr) s.cr.forEach((hp, i) => { const c = this.crystals[i]; if (c) { if (hp < c.hp) c.lastHit = s.ht; c.hp = hp; } });
    if (s.tk) this.teamKills = s.tk;
    this.catBase = (s.ct || []).map(([id, owner, x, z, yaw, speed]) => ({ id, owner, x, z, yaw, speed }));
    this.stoneT = s.ht;
    this.matchTime = s.mt;
    if (s.st) this.state = 'over';
    this.lastSnap = { t: s.ht, recvAt };
    return mine;
  }

  // 每畫格：推算房主現在的時間，內插其他人、往前推石頭
  update(nowMs, meId) {
    if (!this.lastSnap) return;
    const hostNow = this.lastSnap.t + Math.min(0.5, (nowMs - this.lastSnap.recvAt) / 1000);
    this.time = Math.max(this.time, hostNow);
    const rt = hostNow - DELAY;
    let a = null, b = null;
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].t <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || null; break; }
    }
    if (!a) { a = this.snaps[0]; b = null; }
    const k = b ? Math.max(0, Math.min(1, (rt - a.t) / (b.t - a.t || 1))) : 0;
    const lerpA = (u, v) => { let d = v - u; d = Math.atan2(Math.sin(d), Math.cos(d)); return u + d * k; };
    for (const p of this.players) {
      if (p.id === meId) continue;
      const pa = a.pos.get(p.id), pb = b ? b.pos.get(p.id) : null;
      if (!pa) continue;
      // 兩張快照之間剛好復活：不要從屍體位置滑到出生點，直接用舊的那張，時間到了再跳過去
      const q = pb && pb.spawnAt === pa.spawnAt ? pb : pa;
      p.x = p.px = pa.x + (q.x - pa.x) * k;
      p.z = p.pz = pa.z + (q.z - pa.z) * k;
      p.yaw = lerpA(pa.yaw, q.yaw);
      p.pitch = pa.pitch + (q.pitch - pa.pitch) * k;
      p.speed = q.speed;
      p.alive = pa.alive; p.aiming = pa.aiming; p.charge = pa.charge; p.throwAt = pa.throwAt;
    }
    // 石頭：推到跟其他人同一個時間（房主現在 − 100 ms），石頭才不會比被打的人早到。
    // 比快照新就往前模擬（撞到東西停住等下一張），比快照舊就照拋物線往回算；那時還沒丟出去的先不畫
    const dt = Math.max(-0.3, Math.min(0.3, rt - this.stoneT));
    const h = CFG.TICK / SUB, n = Math.floor(Math.max(0, dt) / h);
    this.stones = this.stoneBase.filter((s0) => s0.age + dt >= 0).map((s0) => {
      const s = { ...s0 };
      if (s.kind === 'boom') {   // 回力鏢不吃重力、自己會轉彎：照快照的速度直線推一小段就好
        if (s.active) { s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; }
      } else if (!s.rest && dt < 0) {
        s.x += s.vx * dt; s.y += s.vy * dt - 0.5 * CFG.G * dt * dt; s.z += s.vz * dt;
      } else if (!s.rest) {
        for (let i = 0; i < n; i++) {
          const c = advance(this.map, s, h);
          if (c) { if (c.type !== 'out') { s.x = c.px; s.y = c.py; s.z = c.pz; } s.vx = s.vy = s.vz = 0; s.rest = true; break; }
        }
      }
      s.lx = s.x; s.ly = s.y; s.lz = s.z;
      return s;
    });
    // 貓：照快照的速度與朝向推到同一個時間
    this.cats = this.catBase.map((c0) => {
      const vx = -Math.sin(c0.yaw) * c0.speed, vz = -Math.cos(c0.yaw) * c0.speed;
      const x = c0.x + vx * dt, z = c0.z + vz * dt;
      return { ...c0, x, z, px: x, pz: z };
    });
  }
}
