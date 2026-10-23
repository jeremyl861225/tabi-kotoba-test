// 連線客人這邊的「鏡像世界」：不自己判定，只把房主的快照變成畫面與 HUD 要的形狀（跟 Sim 一樣的欄位）。
// 其他玩家：快照存成時間軸，畫面落後 100 ms 內插；石頭：從最新快照用同一套彈道往前推；自己：本機預測（main.js）。
import { CFG } from './config.js';
import { SUB, advance } from './physics.js';

const DELAY = 0.1;

export class MirrorSim {
  constructor(map, roster, matchTime) {
    this.map = map;
    this.players = roster.map((r) => ({
      id: r.id, name: r.name, accent: r.accent, isBot: r.isBot,
      x: 0, z: 0, px: 0, pz: 0, vx: 0, vz: 0, speed: 0, yaw: 0, pitch: 0, hp: CFG.HP, stones: CFG.START_STONES,
      alive: true, aiming: false, charge: 0, kills: 0, deaths: 0, heads: 0, respawnAt: 0, shieldUntil: 0, killedBy: 0, throwAt: -99, spawnAt: 0,
    }));
    this.stones = [];
    this.loose = [];
    this.piles = map.piles.map((p, i) => ({ id: i, x: p.x, z: p.z, readyAt: 0 }));
    this.events = [];
    this.time = 0;
    this.matchTime = matchTime;
    this.state = 'play';
    this.snaps = [];
    this.stoneBase = [];
    this.lastSnap = null;
  }

  byId(id) { return this.players.find((p) => p.id === id); }
  ranking() { return [...this.players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.heads - a.heads); }
  removePlayer(id) { this.players = this.players.filter((p) => p.id !== id); }

  // 收到快照：非位置的狀態直接套用；位置進時間軸
  apply(s, meId, recvAt) {
    if (this.lastSnap && s.ht <= this.lastSnap.t) return null;   // 亂序的舊快照
    const pos = new Map();
    let mine = null;
    for (const a of s.pl) {
      const [id, x, z, yaw, pitch, hp, stones, alive, aiming, charge, kills, deaths, heads, respawnAt, shieldUntil, killedBy, throwAt, speed, ack, spawnAt] = a;
      const p = this.byId(id);
      if (!p) continue;
      pos.set(id, { x, z, yaw, pitch, speed });
      Object.assign(p, { hp, stones, kills, deaths, heads, respawnAt, shieldUntil, killedBy, spawnAt });
      if (id === meId) { mine = { x, z, yaw, alive: !!alive, ack, hp }; p.alive = !!alive; continue; }
      Object.assign(p, { alive: !!alive, aiming: !!aiming, charge, throwAt });
    }
    this.snaps.push({ t: s.ht, pos });
    if (this.snaps.length > 6) this.snaps.shift();
    this.stoneBase = s.sn.map(([id, owner, x, y, z, vx, vy, vz, rest, active]) => ({ id, owner, x, y, z, vx, vy, vz, rest: !!rest, active: !!active }));
    this.loose = s.lo.map(([id, x, z, count]) => ({ id, x, z, count }));
    s.pi.forEach((r, i) => { if (this.piles[i]) this.piles[i].readyAt = r; });
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
      const q = pb || pa;
      p.x = p.px = pa.x + (q.x - pa.x) * k;
      p.z = p.pz = pa.z + (q.z - pa.z) * k;
      p.yaw = lerpA(pa.yaw, q.yaw);
      p.pitch = pa.pitch + (q.pitch - pa.pitch) * k;
      p.speed = q.speed;
    }
    // 石頭：從快照往前推（最多 0.3 秒），撞到東西就停在那裡等下一張快照
    const dt = Math.min(0.3, (nowMs - this.lastSnap.recvAt) / 1000);
    const h = CFG.TICK / SUB, n = Math.floor(dt / h);
    this.stones = this.stoneBase.map((s0) => {
      const s = { ...s0 };
      if (!s.rest) {
        for (let i = 0; i < n; i++) {
          const c = advance(this.map, s, h);
          if (c) { if (c.type !== 'out') { s.x = c.px; s.y = c.py; s.z = c.pz; } s.vx = s.vy = s.vz = 0; s.rest = true; break; }
        }
      }
      s.lx = s.x; s.ly = s.y; s.lz = s.z;
      return s;
    });
  }
}
