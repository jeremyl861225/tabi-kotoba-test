// 一場遊戲的流程（在房主或單機跑）：戰役一關一關、對戰一回合一回合；開場標題 → 開打 → 分出勝負 → 下一關。
// 畫面與連線只讀 game.view()（給 HUD 的摘要）和 sim 的狀態。
import { TICK, ROUND, CAMPAIGN as CAMP, TANK, SKILL, BULLET_KEYS, TYPES } from './config.js';
import { CAMPAIGN, ARENAS, parseMap, walkable } from './maps.js';
import * as MAPS from './maps.js';
import { Sim } from './sim.js';
import { Bot } from './bot.js';
import { makeRng } from './util.js';

// v8 分隊配色：隊色（v13 色票：A 青、B 黃、C 梅紫、D 薄荷）只畫在腳下圈、旗子、名牌、瞄準線；車身是同色系的粉彩
// 戰役：玩家全是藍隊、敵人全是黃隊（敵人車身仍用種類色，一看就知道是哪一種）
// 玩家車身都在藍色系（v9：2P 原本粉綠，跟綠色敵人撞色）
const COOP_BODY = ['p1', 'peri', 'ice'];
// 2 對 2：藍隊粉藍＋粉青、黃隊粉黃＋粉橘
const TEAM_BODY = [['p1', 'aqua'], ['p2', 'peach']];
// 大亂鬥：每台一個隊色
const FFA_BODY = ['p1', 'p2', 'p3', 'p4'];
const FFA_TEAM = ['A', 'B', 'C', 'D'];

// players：[{ slot, name, color, bullet }]（slot 0 起算；本機或遠端都一樣，輸入由外面塞進 game.inputs）
// opts.mode：'campaign' | 'versus' | 'demo'
export class Game {
  constructor(opts) {
    this.o = { level: 0, rule: 'ffa', rounds: 3, cpu: 1, skill: 'normal', arena: 'cross', seed: 1, ...opts };
    this.mode = this.o.mode;
    this.rng = makeRng(this.o.seed);
    this.players = this.o.players || [];
    this.inputs = new Map();     // slot → { mx, my, aim, fire, mine }
    this.events = [];            // 給畫面的流程事件：phase、clear、over…
    this.level = this.o.level;
    this.lives = this.o.lives || CAMP.lives;
    this.killedEnemies = new Set();
    this.round = 0;
    this.score = new Map();      // 對戰：隊伍 → 贏幾回合
    this.stats = { kills: {}, levelsCleared: 0, rounds: [] };
    this.winner = null;
    this.over = false;
    this.attempt = 0;            // 同一關第幾次（亂數種子要跟著變，不然重來會一模一樣）
    this.simEvents = [];         // 這段時間模擬發生的事（畫面、音效、連線來拿）
    for (const p of this.players) this.inputs.set(p.slot, { mx: 0, my: 0, aim: null, fire: false, mine: false, swap: null });
    this.begin();
  }

  emit(k, o = {}) { this.events.push({ k, ...o }); }
  drain() { const e = this.events; this.events = []; return e; }

  // 建一張新的模擬：戰役＝這一關；對戰＝新的一回合
  begin() {
    this.attempt++;
    if (this.lastLevel !== this.level) { this.tries = 0; this.lastLevel = this.level; }
    this.tries++;   // 同一關第幾次（提示只在第一次顯示）
    const seed = (this.o.seed * 7919 + (this.mode === 'campaign' ? this.level : this.round) * 104729 + this.attempt * 15485863) >>> 0;
    if (this.mode === 'campaign') {
      const def = CAMPAIGN[this.level];
      this.map = parseMap(def);
      this.sim = new Sim({ map: this.map, seed });
      const spawns = this.coopSpawns(this.map.players[0], this.players.length);
      this.players.forEach((p, i) => this.addPlayer(p, spawns[i], 0, 0, COOP_BODY[i % COOP_BODY.length], 'A'));
      this.map.enemies.forEach((e, i) => {
        if (this.killedEnemies.has(i)) return;
        const t = this.sim.addTank({ x: e.x, y: e.y, team: 1, kind: 'cpu', type: e.type, color: e.type, body: Math.PI, name: TYPES[e.type].name });
        t.enemyIndex = i;
        t.teamColor = 'B';
      });
      const ch = (MAPS.CHAPTERS || []).find((c) => this.level >= c.from && this.level < c.to);
      const boss = this.map.enemies.some((e) => TYPES[e.type].hp >= 3);
      this.banner = { title: `第 ${this.level + 1} 關`, sub: `${def.name}・敵方坦克 ${this.sim.tanks.filter((t) => t.team === 1).length} 輛${boss ? '・頭目戰' : ''}`, kicker: ch ? ch.name : '', tip: this.tries === 1 ? def.tip || '' : '' };
    } else {
      const def = ARENAS.find((a) => a.id === this.o.arena) || ARENAS[0];
      this.map = parseMap(def);
      this.sim = new Sim({ map: this.map, seed });
      const n = Math.min(4, this.players.length + this.o.cpu);
      const isTeam = this.o.rule === 'team';
      const team = (i) => (isTeam ? i % 2 : i);
      const body = (i) => (isTeam ? TEAM_BODY[i % 2][(i >> 1) % 2] : FFA_BODY[i % 4]);
      const tc = (i) => (isTeam ? FFA_TEAM[i % 2] : FFA_TEAM[i % 4]);
      this.players.forEach((p, i) => this.addPlayer(p, this.map.players[i], team(i), i, body(i), tc(i)));
      for (let i = this.players.length; i < n; i++) {
        const sp = this.map.players[i];
        const bullet = this.cpuBullets ? this.cpuBullets[i] : (this.cpuBullets = this.pickCpuBullets(n))[i];
        const t = this.sim.addTank({
          x: sp.x, y: sp.y, team: team(i), kind: 'cpu', color: body(i),
          bullet, name: `電腦 ${i - this.players.length + 1}`, body: sp.x < 10 ? 0 : Math.PI,
          speed: TANK.speed * SKILL[this.o.skill].speedK, tTurn: SKILL[this.o.skill].tTurn,
          cd: Math.max(SKILL[this.o.skill].cd, 0.16),
        });
        t.skill = this.o.skill;
        t.cpuIndex = i;
        t.teamColor = tc(i);
      }
      this.round++;
      const need = this.o.rounds;
      this.banner = this.mode === 'demo' ? null : { title: `第 ${this.round} 回合`, sub: `${def.name}・先贏 ${need} 回合` };
    }
    // 電腦＋斷線後交給電腦代打的玩家
    this.bots = this.sim.tanks.filter((t) => t.kind === 'cpu' || (t.kind === 'player' && this.players.some((p) => p.slot === t.slot && p.cpu))).map((t) => new Bot(this.sim, t));
    this.phase = 'intro';
    this.phaseT = 0;
    this.sim.lock = { move: true, fire: true };
    this.emit('begin', { mode: this.mode, level: this.level, round: this.round });
  }

  pickCpuBullets(n) {
    const arr = [];
    for (let i = 0; i < n; i++) arr.push(this.rng.pick(BULLET_KEYS));
    return arr;
  }

  addPlayer(p, sp, team, i, color, teamColor) {
    const t = this.sim.addTank({ x: sp.x, y: sp.y, team, kind: 'player', slot: p.slot, color: color || p.color, bullet: p.bullet, name: p.name, body: sp.x < 10 ? 0 : Math.PI });
    t.playerIndex = i;
    t.teamColor = teamColor || null;
    return t;
  }

  // 戰役多人：第二台起排在 1 號出生點附近的空地
  coopSpawns(s, n) {
    const out = [s];
    const tries = [[0, -1.6], [0, 1.6], [1.6, 0], [0, -3.2], [0, 3.2], [1.6, 1.6]];
    for (const [dx, dy] of tries) {
      if (out.length >= n) break;
      const x = s.x + dx, y = s.y + dy;
      if (x < 0.5 || y < 0.5 || x > 19.5 || y > 13.5) continue;
      if (!walkable(this.map.grid[(y | 0) * 20 + (x | 0)])) continue;
      out.push({ x, y });
    }
    while (out.length < n) out.push(s);
    return out;
  }

  playerTank(slot) { return this.sim.tanks.find((t) => t.slot === slot); }

  // 連線玩家斷線：這一位改由電腦代打（這一回合起）
  takeover(slot) {
    const p = this.players.find((x) => x.slot === slot);
    if (!p || p.cpu) return;
    p.cpu = true;
    const t = this.playerTank(slot);
    if (t) this.bots.push(new Bot(this.sim, t));
  }

  // ---- 每個 tick ----
  tick() {
    if (this.over) return;
    const sim = this.sim;
    this.phaseT += TICK;
    if (this.phase === 'intro' && this.phaseT >= (this.mode === 'demo' ? 0.8 : ROUND.intro)) {
      this.phase = 'play'; this.phaseT = 0;
      sim.lock = { move: false, fire: false };
      this.emit('go');
    }
    // 輸入
    for (const t of sim.tanks) {
      if (t.kind !== 'player' || !t.alive) continue;
      const I = this.inputs.get(t.slot);
      if (!I) continue;
      t.input.mx = I.mx; t.input.my = I.my;
      if (I.aim != null) t.input.aim = I.aim;
      if (I.fire) t.input.fire = true;
      if (I.mine) t.input.mine = true;
      if (I.swap) t.input.swap = I.swap;
      I.fire = false; I.mine = false; I.swap = null;
    }
    if (this.phase !== 'intro') for (const b of this.bots) b.update(TICK);
    sim.step();
    const ev = sim.drain();
    for (const e of ev) if (e.k === 'die') this.onDie(e);
    this.simEvents.push(...ev);
    if (this.simEvents.length > 2000) this.simEvents.splice(0, this.simEvents.length - 2000);   // 沒人來拿（測試）時不要無限長
    if (this.phase === 'play') this.checkEnd();
    else if (this.phase === 'outro' && this.phaseT >= (this.mode === 'demo' ? 1.6 : ROUND.outro)) this.next();
  }

  takeSimEvents() { const e = this.simEvents; this.simEvents = []; return e; }

  onDie(e) {
    const t = this.sim.tank(e.id);
    if (!t) return;
    // 分出勝負之後才打掉的也算（自己死了、炮彈還在飛把敵人打掉：重來時那台不會回來）
    if (this.mode === 'campaign' && t.team === 1) {
      this.killedEnemies.add(t.enemyIndex);
      const k = this.sim.tank(e.killer);
      if (k && k.kind === 'player') {
        const s = (this.stats.kills[k.slot] ||= {});
        s[t.type] = (s[t.type] || 0) + 1;
      }
    }
  }

  checkEnd() {
    const sim = this.sim;
    if (this.mode === 'campaign') {
      const foes = sim.tanks.filter((t) => t.team === 1 && t.alive).length;
      const mine = sim.tanks.filter((t) => t.kind === 'player' && t.alive).length;
      if (foes === 0) return this.toOutro('clear');
      if (mine === 0) return this.toOutro('fail');
    } else {
      const alive = new Set(sim.tanks.filter((t) => t.alive).map((t) => t.team));
      if (alive.size <= 1) this.toOutro(alive.size ? 'round' : 'draw', [...alive][0]);
    }
  }

  toOutro(result, team) {
    this.phase = 'outro'; this.phaseT = 0;
    this.result = result;
    this.sim.lock = { move: true, fire: true };
    if (this.mode === 'campaign') {
      if (result === 'clear') {
        this.stats.levelsCleared++;
        const bonus = (this.level + 1) % CAMP.bonusEvery === 0 && this.level + 1 < CAMPAIGN.length;
        if (bonus) this.lives++;
        this.banner = { title: '任務完成！', sub: bonus ? '獎勵：多一條命' : '', tone: 'good' };
      } else {
        this.lives--;
        this.banner = { title: this.lives > 0 ? '被擊毀了' : '遊戲結束', sub: this.lives > 0 ? `剩下 ${this.lives} 條命` : '', tone: 'bad' };
      }
    } else {
      if (result === 'round') this.score.set(team, (this.score.get(team) || 0) + 1);
      this.roundWinner = result === 'round' ? team : null;
      this.stats.rounds.push(this.roundWinner);
      const w = this.teamLabel(team);
      this.banner = this.mode === 'demo' ? null : { title: result === 'draw' ? '同歸於盡' : `${w} 拿下這回合`, sub: '', tone: 'good' };
    }
    this.emit('outro', { result, team });
  }

  teamLabel(team) {
    const ts = this.sim.tanks.filter((t) => t.team === team);
    if (this.o.rule === 'team') return team === 0 ? '藍隊' : '黃隊';
    return ts[0] ? ts[0].name : '';
  }

  next() {
    if (this.mode === 'campaign') {
      if (this.result === 'clear') {
        if (this.level + 1 >= CAMPAIGN.length) return this.finish(true);
        this.level++;
        this.killedEnemies.clear();
      } else if (this.lives <= 0) return this.finish(false);
      this.begin();
    } else {
      const need = this.o.rounds;
      if (this.mode !== 'demo') for (const [team, s] of this.score) if (s >= need) return this.finish(true, team);
      this.begin();
    }
  }

  finish(won, team) {
    this.over = true;
    this.winner = team ?? null;
    this.won = won;
    this.phase = 'over';
    this.emit('over', { won, team });
  }

  // 給 HUD／客人的摘要（不含 sim 本體）
  view() {
    const s = this.sim;
    return {
      mode: this.mode, phase: this.phase, level: this.level, lives: this.lives, round: this.round,
      banner: this.banner, result: this.result, over: this.over, won: this.won, winner: this.winner,
      foes: this.mode === 'campaign' ? s.tanks.filter((t) => t.team === 1 && t.alive).length : 0,
      foesTotal: this.mode === 'campaign' ? this.map.enemies.length : 0,
      score: [...this.score.entries()], rule: this.o.rule, rounds: this.o.rounds,
    };
  }
}
