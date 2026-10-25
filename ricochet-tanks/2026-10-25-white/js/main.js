// 跳彈坦克：主程式。場景（標題／遊戲／結算）、固定 60 Hz 模擬、輸入、畫面、音效、HUD、選單。
// 定格截圖（ios-game-art）：?shot=title|play|select|result、?seed=、?t=（先跑幾秒）、?mode=、?map=、?level=；
// 除錯物件 window.__game：ready、advance(秒)、pause(開關)、cam(倍率, x, y)。
import { TICK, BULLETS, BULLET_KEYS, TANK } from './config.js';
import { CAMPAIGN, ARENAS } from './maps.js';
import { Renderer, TANK_COLORS, TEAM_COLORS } from './render.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { UI } from './ui.js';
import { Sfx } from './sfx.js';
import { Game } from './game.js';
import { Bot } from './bot.js';
import { traceShot } from './sim.js';
import { Online } from './online.js';

const Q = new URLSearchParams(location.search);
const SHOT = Q.get('shot');
const store = {
  get(k, d) { if (Q.has('fresh') || SHOT) return d; try { const v = localStorage.getItem(`rt.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { if (SHOT) return; try { localStorage.setItem(`rt.${k}`, JSON.stringify(v)); } catch { /* 私密模式 */ } },
};
const settings = { sound: true, haptics: true, aimGuide: true, ...store.get('settings', {}) };
delete settings.releaseFire;   // v8 起放開右搖桿一律發射（舊存檔的開關不用了）
const native = window.RT_NATIVE || null;
const haptic = (k) => { if (settings.haptics && native) native.haptic(k); };

// 玩家替身（示範對打、定格截圖用）
const STAND_IN = { tTurn: 6, cd: 0.16, scan: 36, aimB: 1, err: 0.05, think: 0.3, dodge: 0.55, react: 0.45, mineRate: 0.03, move: 'hunt', keep: 5, mines: 2 };

const canvas = document.getElementById('stage');
const renderer = new Renderer(canvas, { maxDpr: +(Q.get('dpr') || 3) });
renderer.aimGuide = settings.aimGuide;
const sfx = new Sfx();
sfx.on = settings.sound;

const G = {
  scene: 'boot', game: null, paused: false, frozen: false, acc: 0, last: performance.now(),
  local: [], layout: 'none', auto: new Map(), simRef: null, mapKey: '', pending: new Map(), startOpts: null,
  overAt: 0, net: null,
};

const input = new Input(document.getElementById('touch'), {
  onPause: () => togglePause(),
  haptic,
  aimAngleAt: (slot, cx, cy) => {
    const t = G.game && G.game.playerTank(slot);
    if (!t || !t.alive) return null;
    const f = renderer.toField(cx, cy);
    return Math.atan2(f.y - (t.y - 0.2), f.x - t.x);
  },
});
const hud = new Hud(document.getElementById('hud'), { onPause: () => togglePause() });

const best = () => store.get('best', 0);
const act = {
  tap: () => { sfx.unlock(); sfx.play('tap'); },
  select: () => sfx.play('select'),
  best,
  settings: () => settings,
  setSetting(k, v) {
    settings[k] = v; store.set('settings', settings);
    if (k === 'sound') sfx.on = v;
    if (k === 'aimGuide') renderer.aimGuide = v;
  },
  startCampaign: (o) => startGame({ mode: 'campaign', level: o.level || 0, lives: o.lives || 3, players: [{ slot: 0, name: '1P', color: 'p1', bullet: o.bullet }] }, 'solo'),
  startVersus: (o) => startGame({ mode: 'versus', arena: o.arena, rule: o.rule, cpu: o.cpu, skill: o.skill, rounds: o.rounds, players: [{ slot: 0, name: '你', color: 'p1', bullet: o.bullet }] }, 'solo'),
  startDuo: (o) => {
    const players = [{ slot: 0, name: '1P', color: 'p1', bullet: o.bullets[0] }, { slot: 1, name: '2P', color: 'p2', bullet: o.bullets[1] }];
    if (o.mode === 'coop') startGame({ mode: 'campaign', level: 0, players }, 'duo');
    else startGame({ mode: 'versus', arena: o.arena, rule: 'ffa', cpu: o.cpu, skill: o.skill, rounds: o.rounds, players }, 'duo');
  },
  openOnline: () => G.net.open(),
  resume: () => togglePause(false),
  restart: () => { if (G.startOpts) startGame(G.startOpts.opts, G.startOpts.layout); },
  quit: () => toTitle(),
  again: () => { if (G.net && G.net.role === 'host') G.net.backToLobby(); else act.restart(); },
  online: () => !!(G.net && G.net.active),
};
const ui = new UI(document.getElementById('ui'), act);

// ---- 場景 ----
function setGame(game) {
  G.game = game;
  G.simRef = null;
  G.acc = 0;
  G.auto.clear();
}

function toTitle() {
  if (G.net) G.net.leave();
  G.scene = 'title';
  G.paused = false;
  const seed = +(Q.get('seed') || ((Math.random() * 1e6) | 0));
  const arenas = ARENAS.map((a) => a.id);
  setGame(new Game({ mode: 'demo', cpu: 4, players: [], arena: Q.get('map') || arenas[seed % arenas.length], skill: 'normal', seed }));
  G.local = [];
  input.setLayout('none');
  input.setEnabled(false);
  hud.show(false);
  renderer.labels.clear();
  ui.title({ best: best() });
}

// local：這台裝置上的玩家（連線時房主只有 0 號，其他人的輸入從網路來）
function startGame(opts, layout = 'solo', local = opts.players.map((p) => p.slot)) {
  sfx.unlock();
  G.startOpts = { opts, layout };
  G.scene = 'play';
  G.paused = false;
  G.overAt = 0;
  const seed = +(Q.get('seed') || ((Math.random() * 1e6) | 0));
  setGame(new Game({ ...opts, seed }));
  G.local = local;
  G.layout = layout;
  input.setLayout(layout, G.local);
  input.layout(renderer.field);
  input.setEnabled(false);
  // 前 3 局在瞄準搖桿下方提示「拖曳瞄準・放開發射」（沒有發射鈕，第一次玩要知道）
  const hints = store.get('aimHints', 3);
  if (hints > 0) { input.setHint(true); store.set('aimHints', hints - 1); }
  ui.clear();
  hud.setLayout(layout);
  hud.show(true);
  renderer.labels.clear();
  if (layout === 'duo') { renderer.labels.set('slot0', '1P'); renderer.labels.set('slot1', '2P'); }
  if ((Q.has('auto') || SHOT === 'play') && !Q.has('manual')) for (const s of G.local) G.auto.set(s, null);
}

function togglePause(on = !G.paused) {
  if (G.scene !== 'play' || (G.game && G.game.over)) return;
  if (G.net && G.net.active) {   // 連線時不停模擬，只開關選單
    if (on && !G.pausedUi) { ui.pause({ online: true }); G.pausedUi = true; }
    else if (!on || G.pausedUi) { ui.clear(); G.pausedUi = false; }
    return;
  }
  G.paused = on;
  if (on) { input.setEnabled(false); ui.pause(); }
  else { ui.clear(); G.pausedUi = false; input.setEnabled(G.game && G.game.phase !== 'intro'); }
}

// ---- 模擬 ----
function applyInputs(first) {
  const game = G.game;
  for (const slot of G.local) {
    const I = game.inputs.get(slot);
    if (!I) continue;
    if (G.auto.has(slot)) continue;
    const p = G.pending.get(slot);
    if (!p) continue;
    I.mx = p.mx; I.my = p.my;
    if (p.aim != null) I.aim = p.aim;
    if (first && p.fire) I.fire = true;
    if (first && p.mine) I.mine = true;
  }
}

function autopilot() {
  const game = G.game;
  for (const slot of G.auto.keys()) {
    let b = G.auto.get(slot);
    const t = game.playerTank(slot);
    if (!t) continue;
    if (!b || b.t !== t) { b = new Bot(game.sim, t, STAND_IN); G.auto.set(slot, b); }
    b.update(TICK);
    const I = game.inputs.get(slot);
    I.mx = t.input.mx; I.my = t.input.my; I.aim = t.input.aim; I.fire = t.input.fire; I.mine = t.input.mine;
    t.input.fire = t.input.mine = false;
  }
}

function tickOnce(first = true) {
  const game = G.game;
  if (!game) return;
  if (game.sim !== G.simRef) { G.simRef = game.sim; G.mapKey = `${game.map.name}#${game.attempt}#${game.round}#${game.level}`; renderer.reset(); }
  if (G.net && G.net.role === 'host') G.net.applyRemote(game);
  applyInputs(first);
  autopilot();
  game.tick();
  const se = game.takeSimEvents(), ge = game.drain();
  handleEvents(se, ge);
  if (G.net && G.net.role === 'host') G.net.afterTick(game, se, ge);
}

function handleEvents(simEv, gameEv) {
  const sim = G.game.sim;
  renderer.onEvents(simEv, sim);
  const mine = (id) => { const t = sim.tank(id); return t && t.kind === 'player' && G.local.includes(t.slot) && !G.auto.has(t.slot); };
  for (const e of simEv) {
    if (G.scene === 'title') continue;   // 標題畫面背後的示範對打不出聲
    switch (e.k) {
      case 'fire': sfx.play(e.type === 'rocket' ? 'rocket' : e.type === 'scatter' ? 'scatter' : e.type === 'blast' ? 'blast' : 'fire', e.x); if (mine(e.id)) haptic('fire'); break;
      case 'bounce': sfx.play('bounce', e.x); break;
      case 'pop': sfx.play('pop', e.x); break;
      case 'clash': sfx.play('clash', e.x); break;
      case 'boom': sfx.play('boom', e.x); haptic('boom'); break;
      case 'die': sfx.play('die', e.x); if (mine(e.id)) haptic('die'); else if (mine(e.killer)) haptic('ko'); break;
      case 'mine': sfx.play('mine', e.x); break;
      case 'arm': sfx.play('arm', e.x); break;
      default:
    }
  }
  for (const e of gameEv) {
    if (G.scene !== 'play') continue;
    if (e.k === 'go') { sfx.play('go'); input.setEnabled(!G.paused); }
    if (e.k === 'begin') input.setEnabled(false);
    if (e.k === 'outro') {
      sfx.play(e.result === 'fail' ? 'fail' : 'clear');
      const g = G.game;
      if (!guest() && g.mode === 'campaign' && e.result === 'clear' && G.local.length && !(G.net && G.net.active)) store.set('best', Math.max(best(), Math.min(g.level + 1, CAMPAIGN.length - 1)));
    }
    if (e.k === 'over' && !guest()) { G.overAt = performance.now(); input.setEnabled(false); setTimeout(showResult, 900); }
  }
}

function buildResult(g) {
  if (g.mode === 'campaign') {
    const kills = {};
    for (const s of Object.values(g.stats.kills)) for (const [k, n] of Object.entries(s)) kills[k] = (kills[k] || 0) + n;
    return { mode: 'campaign', won: g.won, cleared: g.stats.levelsCleared, kills, best: G.net && G.net.active ? null : best() };
  }
  const teams = new Map();
  for (const t of g.sim.tanks) if (!teams.has(t.team)) teams.set(t.team, t);
  const score = new Map(g.score);
  const rows = [...teams.entries()].map(([team, t]) => ({ name: g.o.rule === 'team' ? (team === 0 ? '藍隊' : '紅隊') : t.name, color: t.color, hex: TEAM_COLORS[t.teamColor] || TANK_COLORS[t.color], score: score.get(team) || 0, win: team === g.winner }));
  rows.sort((a, b) => b.score - a.score);
  return { mode: 'versus', title: `${rows[0].name} 獲勝！`, rows };
}

function showResult() {
  const g = G.game;
  if (!g || G.scene !== 'play') return;
  G.scene = 'result';
  hud.show(false);
  sfx.play(g.won ? 'win' : 'fail');
  const r = buildResult(g);
  if (G.net && G.net.role === 'host') G.net.sendResult(r);
  ui.result(r);
}

// ---- 每畫格 ----
function renderState() {
  const g = G.net && G.net.role === 'guest' ? G.net.mirror : G.game && G.game.sim;
  if (!g) return null;
  return { grid: g.grid, gridVer: g.gridVer, tanks: g.tanks, bullets: g.bullets, mines: g.mines, mapKey: G.net && G.net.role === 'guest' ? G.net.mapKey : G.mapKey };
}

function aims(state) {
  if (G.scene !== 'play' || !G.game) return [];
  const sim = G.game.sim;
  const out = [];
  for (const slot of G.local) {
    const t = state.tanks.find((x) => x.slot === slot && x.kind === 'player');
    if (!t || !t.alive || G.auto.has(slot)) continue;
    const r = traceShot(G.net && G.net.role === 'guest' ? G.net.mirror : sim, t, t.turret, { path: true });
    out.push({ path: r.path, color: t.color, team: t.teamColor, hit: !!r.hit, hitFoe: r.hit && r.hit.team !== t.team });
  }
  return out;
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - G.last) / 1000);
  G.last = now;
  if (G.frozen) dt = 0;
  const polled = input.poll();
  // 按鍵次數先累積，等真的跑到 tick 才用掉（畫面比 60 Hz 快時，有的畫格不會跑 tick）
  for (const [slot, p] of polled) {
    const old = G.pending.get(slot);
    G.pending.set(slot, { ...p, fire: p.fire + (old ? old.fireLeft || 0 : 0), mine: p.mine + (old ? old.mineLeft || 0 : 0) });
  }
  const guest = G.net && G.net.role === 'guest';
  if (guest) G.net.guestFrame(dt, G.pending);
  else if (G.game && !G.paused && !G.frozen) {
    G.acc += dt;
    let first = true;
    while (G.acc >= TICK) { G.acc -= TICK; tickOnce(first); first = false; }
    // 這一格沒有跑到 tick（畫面比 60 Hz 快）：按鍵留給下一格
    if (first) for (const p of G.pending.values()) { p.fireLeft = p.fire; p.mineLeft = p.mine; }
    else for (const p of G.pending.values()) { p.fireLeft = 0; p.mineLeft = 0; p.fire = 0; p.mine = 0; }
  }
  draw(dt);
}

function draw(dt) {
  const state = renderState();
  if (!state) return;
  renderer.frame(state, dt, { aims: aims(state) });
  const view = G.net && G.net.role === 'guest' ? G.net.view : G.game && G.game.view();
  if (G.scene === 'play' && view) {
    const slot = G.local[0];
    const me = state.tanks.find((t) => t.kind === 'player' && t.slot === slot);
    let ammo = '';
    if (me) {
      const sim = guest() ? null : G.game.sim;
      const active = sim ? sim.activeShots(me) : (G.net.activeShots(me));
      const max = me.maxShots;
      ammo = '';   // 剩幾發只顯示在瞄準搖桿上方的點（v6：右上角跟搖桿重複顯示）
      for (const s of G.local) {
        const t = state.tanks.find((x) => x.kind === 'player' && x.slot === s);
        if (!t) continue;
        const a = sim ? sim.activeShots(t) : G.net.activeShots(t);
        input.setTeam(s, TEAM_COLORS[t.teamColor] || TANK_COLORS[t.color]);
        input.setAmmo(s, Math.max(0, t.maxShots - a), t.maxShots);
        input.setMines(s, t.mineMax - (sim ? sim.activeMines(t) : G.net.activeMines(t)));
      }
    }
    hud.update(view, me, state.tanks, { ammo });
  }
}
const guest = () => G.net && G.net.role === 'guest';

// ---- 版面 ----
function relayout() {
  renderer.resize({ maxDpr: +(Q.get('dpr') || 3) });
  input.layout(renderer.field);
  document.documentElement.style.setProperty('--side-w', `${renderer.field.x}px`);   // HUD 狀態卡的寬度上限（場地左邊的暗區）
}
window.addEventListener('resize', relayout);
window.addEventListener('orientationchange', () => setTimeout(relayout, 250));
document.addEventListener('visibilitychange', () => { if (document.hidden && G.scene === 'play' && !G.paused && !(G.net && G.net.active)) togglePause(true); });
window.addEventListener('pointerdown', () => sfx.unlock(), { capture: true });

// ---- 連線 ----
G.net = new Online({ G, ui, input, hud, renderer, sfx, act, startGame, toTitle, handleEvents, setGame, haptic, settings });

// ---- 除錯／定格 ----
window.__game = {
  ready: false, G, renderer, input, ui, settings, act,
  sim: () => G.game && G.game.sim,
  advance(sec, renderEvery = 2) {
    const n = Math.round(sec / TICK);
    for (let i = 0; i < n; i++) { tickOnce(true); if (i % renderEvery === renderEvery - 1) draw(TICK * renderEvery); }
    draw(0);
  },
  pause(on = true) { G.frozen = on; },
  cam(zoom, cx = 10, cy = 7) { renderer.cam = zoom ? { zoom, cx, cy } : null; renderer.staticKey = null; draw(0); },
  tank: (slot = 0) => G.game && G.game.playerTank(slot),
};

function boot() {
  relayout();
  if (SHOT === 'play') {
    const mode = Q.get('mode') || 'versus';
    const bullet = Q.get('bullet') || 'standard';
    if (mode === 'campaign') act.startCampaign({ bullet, level: +(Q.get('level') || 0) });
    else act.startVersus({ arena: Q.get('map') || 'cross', rule: Q.get('rule') || 'ffa', cpu: +(Q.get('cpu') || 3), skill: Q.get('skill') || 'normal', rounds: 5, bullet });
  } else {
    toTitle();
    if (SHOT === 'select') ui.versus(2);
    else if (SHOT === 'campaign') ui.campaign({ best: 7 });
    else if (SHOT === 'maps') ui.versus(1);
    else if (SHOT === 'result') ui.result({ mode: 'campaign', won: false, cleared: 7, best: 9, kills: { brown: 2, ash: 5, teal: 4, yellow: 2, pink: 2, green: 1, violet: 1 } });
    else if (SHOT === 'pause') { act.startVersus({ arena: 'cross', rule: 'ffa', cpu: 3, skill: 'normal', rounds: 5, bullet: 'standard' }); }
  }
  const t = +(Q.get('t') || 0);
  if (t > 0) window.__game.advance(t);
  if (SHOT === 'pause') { window.__game.advance(3); togglePause(true); }
  requestAnimationFrame((now) => { G.last = now; frame(now); window.__game.ready = true; });
}
boot();

export { G, BULLETS, BULLET_KEYS, TANK };
