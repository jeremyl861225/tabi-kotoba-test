// 主迴圈與選單。
import { ACCENTS, BOT_NAMES, CFG, DIFFICULTY, PLAYER_ACCENT } from './config.js';
import { GameMap, mulberry32 } from './map.js';
import { Sim, movePlayer } from './sim.js';
import { MirrorSim } from './mirror.js';
import { P2P, genRoomCode, newId, normCode } from './net.js';
import { Bot } from './bot.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { Sfx } from './sfx.js';
import { initGlass } from './glass.js';
import { animate, drawMapThumb, hudIn, menuIn, popIn, segSet, spring, stagger } from './ui.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'white-alley:settings';
const DEFAULTS = { sens: 1, arc: true, sound: true, assist: true, map: 'mykonos', bots: 5, diff: 'normal', coached: false };
const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
})();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* 私密模式 */ } };
const INTRO = 1.6;
const COARSE = matchMedia('(pointer: coarse)').matches;   // 觸控裝置才開瞄準輔助   // 開場鏡頭從空中俯衝進巷子的秒數

const stage = $('#stage');
const sfx = new Sfx();
const input = new Input($('#touch'), settings);
const glass = initGlass();
const mapData = {};
const maps = {};
let renderer = null;
let hud = null;
let G = null;   // 進行中的一場（mode：solo／host／guest）
let L = null;   // 連線房間（role：host／guest）
let last = 0;
let idleT = 0;
const perf = { avg: 1 / 60, t: 0, q: 0 };   // 自動畫質：平均每格時間太長就降一級

async function getData(id) {
  if (!mapData[id]) mapData[id] = await (await fetch(`data/maps/${id}.json`)).json();
  return mapData[id];
}
async function getMap(id) {
  if (!maps[id]) maps[id] = new GameMap(await getData(id));
  return maps[id];
}
async function useMap(id) {
  const map = await getMap(id);
  if (!renderer || renderer.map !== map) {
    if (renderer) { renderer.gl.dispose(); renderer.canvas.remove(); }
    renderer = new Renderer(stage, map);
    renderer.setQuality(perf.q);
  }
  return map;
}

// ---------- 選單 ----------
function syncMenu(instant = false) {
  document.querySelectorAll('.seg').forEach((seg) => segSet(seg, settings[seg.dataset.k], instant));
  document.querySelectorAll('.mapcard').forEach((c) => c.classList.toggle('on', c.dataset.v === settings.map));
  $('#sens').value = settings.sens;
  sliderFill($('#sens'));
  $('#optArc').checked = settings.arc;
  $('#optSound').checked = settings.sound;
  $('#optAssist').checked = settings.assist;
}
function sliderFill(el) { el.style.setProperty('--p', `${((el.value - el.min) / (el.max - el.min)) * 100}%`); }

document.querySelectorAll('.seg').forEach((seg) => {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const k = seg.dataset.k;
    settings[k] = k === 'bots' ? +b.dataset.v : b.dataset.v;
    save(); segSet(seg, settings[k]);
  });
});
document.querySelectorAll('.mapcard').forEach((card) => {
  card.addEventListener('click', async () => {
    settings.map = card.dataset.v; save(); syncMenu();
    if (!G) await useMap(settings.map);
  });
});
$('#sens').addEventListener('input', (e) => { settings.sens = +e.target.value; sliderFill(e.target); save(); });
$('#optArc').addEventListener('change', (e) => { settings.arc = e.target.checked; save(); });
$('#optAssist').addEventListener('change', (e) => { settings.assist = e.target.checked; save(); });
$('#optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; sfx.on = settings.sound; save(); });

$('#go').addEventListener('click', () => start());
$('#again').addEventListener('click', () => start());
$('#restart').addEventListener('click', () => start());
$('#netBtn').addEventListener('click', () => openLobby());
$('#lbCreate').addEventListener('click', () => createRoom());
$('#lbJoin').addEventListener('click', () => joinRoom());
$('#lbCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom(); });
$('#lbStart').addEventListener('click', () => hostStart());
$('#lbLeave').addEventListener('click', () => { leaveRoom(); renderLobby(); });
$('#lbBack').addEventListener('click', () => { leaveRoom(); show('#menu'); });
$('#lbShare').addEventListener('click', () => shareRoom());
$('#lbName').addEventListener('change', (e) => { settings.name = e.target.value.trim().slice(0, 8); save(); });
$('#resume').addEventListener('click', () => pause(false));
$('#howBtn').addEventListener('click', () => show('#howPane'));
$('.closeHow').addEventListener('click', () => show(G ? '#pausePane' : '#menu'));
document.querySelectorAll('.toMenu').forEach((b) => b.addEventListener('click', () => toMenu()));

function show(id) {
  const screens = ['#menu', '#pausePane', '#results', '#loading', '#howPane', '#lobbyPane'];
  for (const s of screens) $(s).hidden = s !== id;
  const inGame = id === null;
  $('#hud').hidden = !G;
  $('#touch').hidden = !inGame;
  input.setEnabled(inGame && !(G && G.intro < INTRO));
  if (id === '#menu') {
    requestAnimationFrame(() => {
      syncMenu(true);
      document.querySelectorAll('.mapcard').forEach(async (c) => drawMapThumb(c.querySelector('canvas'), await getData(c.dataset.v)));
      menuIn($('#menu'));
      glass.add($('#menu'));
    });
  } else if (id && id !== '#loading') {
    const panel = $(id).querySelector('.panel');
    popIn(panel);
    if (id === '#results') {
      animate($('#resTable').querySelectorAll('tr'), { opacity: [0, 1], x: [16, 0] }, { delay: stagger(0.05, { startDelay: 0.2 }), duration: 0.5, ease: [0.22, 1, 0.36, 1] });
    }
  }
  if (inGame) requestAnimationFrame(() => { input.layout(); hud && hud.resize(); });
}

async function start() {
  if (L && L.role === 'host') return hostStart();
  if (L && L.role === 'guest') return;
  sfx.unlock();
  sfx.on = settings.sound;
  show('#loading');
  const map = await useMap(settings.map);
  renderer.reset();
  const seed = (Date.now() & 0xfffff) + 1;
  const sim = new Sim(map, { seed });
  const me = sim.addPlayer({ name: '你', accent: PLAYER_ACCENT });
  const rng = mulberry32(seed * 7);
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  const bots = [];
  for (let i = 0; i < settings.bots; i++) {
    const p = sim.addPlayer({ name: names[i], accent: ACCENTS[i % ACCENTS.length], isBot: true });
    bots.push(new Bot(sim, p, settings.diff, rng));
  }
  setupGame(map, sim, me, bots, 'solo');
}

function setupGame(map, sim, me, bots, mode, extra = {}) {
  if (hud) hud.root.innerHTML = '';
  hud = new Hud($('#hud'), map);
  hud.el.pause.addEventListener('click', () => pause(true));
  for (const el of hud.root.querySelectorAll('.pause, .vitals, .score, .minimap')) el.style.opacity = 0;
  $('#touch .stick.right').style.opacity = 0;
  G = { map, sim, me, bots, mode, view: { yaw: me.yaw, pitch: 0 }, acc: 0, paused: false, visible: new Set(), visT: 0, stepD: 0, intro: 0, coach: false, ...extra };
  $('#restart').hidden = mode !== 'solo';
  renderer.introFrom(idleT);
  show(null);
}

// ---------- 連線 ----------
function openLobby(code = '') {
  $('#lbName').value = settings.name || '';
  if (code) $('#lbCode').value = code;
  renderLobby();
  show('#lobbyPane');
}

function myName() {
  let n = ($('#lbName').value || settings.name || '').trim().slice(0, 8);
  if (!n) n = `玩家${Math.floor(10 + Math.random() * 89)}`;
  settings.name = n; save();
  $('#lbName').value = n;
  return n;
}

function renderLobby(status) {
  const inRoom = !!L;
  $('#lobbyPane .lb-choose').hidden = inRoom;
  $('#lobbyPane .lb-room').hidden = !inRoom;
  if (status != null) $('#lbStatus').textContent = status;
  if (!inRoom) return;
  $('#lbCodeBig').textContent = L.code;
  const list = L.role === 'host'
    ? [{ name: L.name, host: true, me: true }, ...L.peers]
    : (L.lobby ? L.lobby.players.map((p) => ({ ...p, me: p.id === L.net.id })) : [{ name: L.name, me: true }]);
  $('#lbPlayers').innerHTML = list.map((p) => `<li class="${p.me ? 'me' : ''}"><i></i><span>${esc(p.name)}</span>${p.host ? '<em>房主</em>' : ''}${p.me ? '<em class="you">你</em>' : ''}</li>`).join('');
  const lb = L.role === 'host' ? settings : (L.lobby || {});
  const MAPN = { mykonos: '米克諾斯・迷城', yongkang: '台北・永康街' };
  $('#lbRule').textContent = lb.map ? `${MAPN[lb.map] || lb.map}・電腦補到 ${Math.min(8, list.length + (lb.bots || 0))} 人・${(DIFFICULTY[lb.diff] || {}).label || ''}` : '';
  $('#lbStart').hidden = L.role !== 'host';
  if (status == null) {
    $('#lbStatus').textContent = L.role === 'host'
      ? (L.peers.length ? '人到齊就按開始；中途加入要等下一場' : '把房號告訴朋友，或按分享')
      : (L.connected ? '已連上房主，等房主開始…' : '找房主中…');
  }
}

async function createRoom() {
  sfx.unlock();
  const name = myName();
  leaveRoom();
  L = { role: 'host', code: genRoomCode(), name, peers: [] };
  const net = new P2P({
    room: L.code, id: newId(), name, role: 'host',
    onPeers: (ps) => { if (!L) return; L.peers = ps; renderLobby(); lobbyBroadcast(); },
    onData: (pid, m) => hostData(pid, m),
    onClose: (pid) => hostPeerGone(pid),
  });
  L.net = net;
  renderLobby('建立房間中…');
  try { await net.start(); renderLobby(); } catch (e) { leaveRoom(); renderLobby(e.message); }
}

async function joinRoom() {
  sfx.unlock();
  const code = normCode($('#lbCode').value);
  if (code.length < 4) { animate($('#lbCode'), { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.4 }); return; }
  const name = myName();
  leaveRoom();
  L = { role: 'guest', code, name, peers: [], connected: false };
  const net = new P2P({
    room: code, id: newId(), name, role: 'guest',
    onPeers: (ps) => { if (!L) return; L.connected = ps.length > 0; renderLobby(); },
    onData: (pid, m) => guestData(m),
    onClose: () => hostGone(),
  });
  L.net = net;
  renderLobby('連線中…');
  try {
    await net.start();
    renderLobby();
    setTimeout(() => {
      if (!L || L.net !== net || L.connected) return;
      renderLobby(net.hostId
        ? '找到房主但連不上（行動網路有時擋點對點連線），兩邊改連同一個 Wi-Fi 再試'
        : '找不到這個房號的房主（確認房號，或請房主重新建立）');
    }, 12000);
  } catch (e) { leaveRoom(); renderLobby(e.message); }
}

function leaveRoom() {
  if (L && L.net) L.net.close();
  L = null;
}

async function shareRoom() {
  if (!L) return;
  const url = `${location.origin}${location.pathname}#room=${L.code}`;
  try {
    if (navigator.share) await navigator.share({ title: '白巷：一起來丟石頭', text: `房號 ${L.code}`, url });
    else { await navigator.clipboard.writeText(url); renderLobby('連結已複製'); }
  } catch { /* 使用者取消 */ }
}

function lobbyBroadcast() {
  if (!L || L.role !== 'host') return;
  L.net.broadcast({ t: 'lobby', players: [{ id: 'host', name: L.name, host: true }, ...L.peers], map: settings.map, bots: settings.bots, diff: settings.diff });
}

// 房主開局：自己＋連上的人＋電腦補人數
async function hostStart() {
  if (!L || L.role !== 'host') return;
  sfx.unlock(); sfx.on = settings.sound;
  show('#loading');
  const map = await useMap(settings.map);
  renderer.reset();
  const seed = (Date.now() & 0xfffff) + 1;
  const sim = new Sim(map, { seed });
  L.net.accepting = false;
  const me = sim.addPlayer({ name: L.name, accent: ACCENTS[0] });
  const remote = new Map();
  L.peers.forEach((p, i) => {
    const pl = sim.addPlayer({ name: p.name, accent: ACCENTS[(i + 1) % ACCENTS.length] });
    remote.set(p.id, { pid: pl.id, q: [], last: null, ack: 0 });
  });
  const rng = mulberry32(seed * 7);
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  const bots = [];
  const nb = Math.max(0, Math.min(settings.bots, 8 - sim.players.length));
  for (let i = 0; i < nb; i++) {
    const p = sim.addPlayer({ name: names[i], accent: ACCENTS[(sim.players.length) % ACCENTS.length], isBot: true });
    bots.push(new Bot(sim, p, settings.diff, rng));
  }
  const roster = sim.players.map((p) => ({ id: p.id, name: p.name, accent: p.accent, isBot: p.isBot }));
  for (const [pid, r] of remote) L.net.send(pid, { t: 'start', map: settings.map, roster, you: r.pid, mt: sim.matchTime });
  sim.events.length = 0;
  setupGame(map, sim, me, bots, 'host', { remote, snapT: 0 });
  // 開局先送一張快照，客人才知道自己在哪
  L.net.broadcast({ t: 'snap', ...sim.snapshot({}) }, true);
}

function hostData(pid, m) {
  if (m.t !== 'in' || !G || G.mode !== 'host') return;
  const r = G.remote.get(pid);
  if (!r) return;
  r.q.push(m);
  if (r.q.length > 8) r.q.splice(0, r.q.length - 3);   // 堆太多就丟舊的，別讓延遲越積越大
}

function hostPeerGone(pid) {
  if (!L) return;
  L.peers = L.peers.filter((p) => p.id !== pid);
  renderLobby();
  lobbyBroadcast();
  if (G && G.mode === 'host' && G.remote.has(pid)) {
    const r = G.remote.get(pid);
    const p = G.sim.byId(r.pid);
    G.remote.delete(pid);
    G.sim.removePlayer(r.pid);
    if (p) hud && hud.toast(`${p.name} 離開了`);
  }
}

async function guestStart(m) {
  sfx.on = settings.sound;
  show('#loading');
  const map = await useMap(m.map);
  renderer.reset();
  const sim = new MirrorSim(map, m.roster, m.mt);
  const me = sim.byId(m.you);
  setupGame(map, sim, me, [], 'guest', { seq: 0, hist: [], cdUntil: 0, aimLock: false, needPos: true });
}

function guestData(m) {
  if (!L) return;
  if (m.t === 'lobby') { L.lobby = m; renderLobby(); return; }
  if (m.t === 'start') { guestStart(m); return; }
  if (!G || G.mode !== 'guest') return;
  if (m.t === 'snap') {
    const mine = G.sim.apply(m, G.me.id, performance.now());
    if (mine) reconcile(mine);
  } else if (m.t === 'ev') {
    for (const e of m.e) {
      if (e.type === 'leave') G.sim.removePlayer(e.id);
      G.sim.events.push(e);
    }
  }
}

// 客人：用房主回報「處理到第幾個輸入」對照本機紀錄，修正預測誤差
function reconcile(m) {
  const me = G.me;
  if (!m.alive) { me.aiming = false; me.charge = 0; return; }
  if (G.needPos) {
    me.x = me.px = m.x; me.z = me.pz = m.z; me.vx = me.vz = 0;
    me.yaw = G.view.yaw = m.yaw; G.view.pitch = 0;
    G.needPos = false; G.hist.length = 0;
    return;
  }
  const i = G.hist.findIndex((h) => h.s === m.ack);
  if (i < 0) return;
  const h = G.hist[i];
  const ex = m.x - h.x, ez = m.z - h.z, e = Math.hypot(ex, ez);
  G.hist.splice(0, i);
  if (e < 0.03) return;
  if (e > 3) { me.x = m.x; me.z = m.z; G.hist.length = 0; return; }
  me.x += ex; me.z += ez;
  for (const q of G.hist) { q.x += ex; q.z += ez; }
  G.map.collide(me);
}

function hostGone() {
  if (!L) return;
  leaveRoom();
  const inGame = !!G;
  if (inGame) toMenu();
  openLobby();
  renderLobby('房主離開了，房間已關閉');
}

// 客人每個 tick：本機預測自己的移動與蓄力，輸入送給房主
function guestTick(inp) {
  const { sim, me } = G;
  if (inp.cancel && me.aiming) { me.aiming = false; me.charge = 0; G.aimLock = true; }
  if (!inp.aim) G.aimLock = false;
  if (me.alive && inp.aim && !me.aiming && !G.aimLock && me.stones > 0 && sim.time >= G.cdUntil) { me.aiming = true; me.charge = 0; }
  let ch;
  if (me.aiming) {
    me.charge = Math.min(1, me.charge + CFG.TICK / CFG.CHARGE_T);
    if (!inp.aim && !inp.cancel) {
      ch = Math.round(me.charge * 1000) / 1000;
      me.aiming = false; me.charge = 0; me.throwAt = sim.time; G.cdUntil = sim.time + CFG.THROW_CD;
      renderer.kick = 1;
    }
  }
  me.px = me.x; me.pz = me.z;
  if (me.alive) { movePlayer(sim.map, me, inp, CFG.TICK); me.speed = Math.hypot(me.x - me.px, me.z - me.pz) / CFG.TICK; }
  me.yaw = inp.yaw; me.pitch = inp.pitch;
  const s = ++G.seq;
  G.hist.push({ s, x: me.x, z: me.z });
  if (G.hist.length > 240) G.hist.shift();
  const r3 = (v) => Math.round(v * 1000) / 1000;
  L.net.send(L.net.hostId, { t: 'in', s, mx: r3(inp.mx), mz: r3(inp.mz), yaw: r3(inp.yaw), pitch: r3(inp.pitch), aim: inp.aim, cancel: inp.cancel, ch }, false);
}

function endIntro() {
  input.setEnabled(true);
  input.layout();
  hud.resize();
  hudIn(hud.root);
  glass.add(hud.root);
  glass.add($('#touch'));
  if (!settings.coached && matchMedia('(pointer: coarse)').matches) coach();
}

// 第一次玩：指出兩支搖桿怎麼用
function coach() {
  G.coach = true;
  const r = $('#touch .stick.right').getBoundingClientRect();
  const H = window.innerHeight;
  const el = document.createElement('div');
  el.className = 'coach';
  el.innerHTML = `
    <i class="ghostring" style="left:120px;top:${H - 110}px"></i>
    <div class="tip glass" style="left:186px;top:${H - 150}px"><b>左下：拖曳移動</b><span>手指放哪，搖桿就出現在哪</span></div>
    <div class="tip glass" style="right:${window.innerWidth - r.left + 18}px;top:${r.top - 6}px"><b>右邊：按住蓄力・放開丟</b><span>推動轉視角；拖到 ✕ 再放開就不丟</span></div>
    <p class="go">點一下開始</p>`;
  hud.root.appendChild(el);
  glass.add(el);
  animate(el.querySelectorAll('.tip, .ghostring'), { opacity: [0, 1], scale: [0.9, 1] }, spring(260, 22, { delay: stagger(0.12) }));
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    settings.coached = true; save();
    const a = animate(el, { opacity: 0 }, { duration: 0.3 });
    Promise.resolve(a && a.finished).then(() => el.remove());
    G.coach = false;
  }, { once: true });
}

function pause(on) {
  if (!G || G.sim.state !== 'play' || G.intro < INTRO) return;   // 連線時暫停只是打開選單，世界照跑
  G.paused = on;
  if (on) { input.reset(); document.exitPointerLock?.(); show('#pausePane'); } else show(null);
}

function toMenu() {
  if (G && G.mode !== 'solo') leaveRoom();
  G = null;
  if (hud) { hud.root.innerHTML = ''; hud = null; }
  renderer && renderer.reset();
  show('#menu');
}

function results() {
  const { sim, me } = G;
  const rank = sim.ranking();
  const tie = rank.length > 1 && rank[0].kills === rank[1].kills && rank[0].deaths === rank[1].deaths && rank[0].heads === rank[1].heads;
  const win = rank[0] === me && !tie;
  const pos = rank.indexOf(me) + 1;
  $('#resRank').textContent = `第 ${pos} 名・共 ${rank.length} 人`;
  $('#resTitle').textContent = tie ? '平手' : win ? '你贏了！' : `${rank[0].name} 獲勝`;
  $('#resStats').innerHTML = [['KO', me.kills], ['倒下', me.deaths], ['爆頭', me.heads]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('#resTable').innerHTML = `<tr><th></th><th>玩家</th><th>KO</th><th>倒下</th><th>爆頭</th></tr>` + rank.map((p, i) =>
    `<tr class="${p === me ? 'me' : ''} ${i === 0 && !tie ? 'p1' : ''}"><td>${i + 1}</td><td><span class="nm"><i class="dot" style="background:${esc(p.accent)}"></i>${esc(p.name)}</span></td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.heads}</td></tr>`).join('');
  sfx.play(win ? 'win' : 'ko');
  document.exitPointerLock?.();
  $('#again').hidden = G.mode === 'guest';
  if (L && L.role === 'host') L.net.accepting = true;   // 結算時可以讓新朋友進房，下一場一起玩
  $('#resWait').hidden = G.mode !== 'guest';
  show('#results');
  glass.add($('#results'));
}

// ---------- 事件 → 音效、HUD、特效 ----------
function onEvents() {
  const { sim, me, view } = G;
  for (const e of sim.events) {
    switch (e.type) {
      case 'throw':
        sfx.play('throw', e.x, e.z, e.v / CFG.V_MAX);
        if (e.id === me.id && G.mode !== 'guest') renderer.kick = 1;
        if (e.id !== me.id && Math.hypot(e.x - me.x, e.z - me.z) < 45) hud.ping(e.x, e.z, sim.time);
        break;
      case 'impact':
        sfx.play(e.surf, e.x, e.z, Math.min(1.2, e.sp / 18));
        renderer.puff(e.x, e.y, e.z, e.surf === 'ground' ? 0.22 : 0.16);
        if (e.sp > 6) renderer.chipBurst(e.x, e.y, e.z, e.nx || 0, e.surf === 'wall' ? 0.3 : 1, e.nz || 0, e.sp > 14 ? 7 : 4);
        break;
      case 'hit': {
        const t = sim.byId(e.target);
        if (e.by === me.id) { hud.hitMarker(e.head); sfx.play('hitmark'); }
        sfx.play(e.head ? 'head' : 'hit', t.x, t.z);
        renderer.puff(e.x, e.y, e.z, 0.2, 0xe5b2ad);
        renderer.chipBurst(e.x, e.y, e.z, 0, 0.6, 0, 5);
        if (e.target === me.id) { sfx.play('hurt'); hud.hurtFrom(e.fromX, e.fromZ); renderer.shake = e.head ? 1.4 : 0.9; } else renderer.flashChar(e.target);
        break;
      }
      case 'block':
        sfx.play('roof', e.x, e.z, 0.6);
        break;
      case 'ko': {
        const v = sim.byId(e.victim), k = sim.byId(e.by);
        hud.feed(k, v, e.head, me.id);
        if (e.by === me.id) { sfx.play('ko'); hud.koBanner(v.name, e.head); }
        break;
      }
      case 'pickup':
        if (e.id === me.id) sfx.play('pickup');
        break;
      case 'spawn':
        if (e.id === me.id) {
          if (G.mode === 'guest') G.needPos = true;
          else { view.yaw = me.yaw; view.pitch = 0; }
        }
        break;
      case 'over':
        setTimeout(results, 900);
        break;
      default:
    }
  }
  sim.events.length = 0;
}

// 小地圖要畫的人：看得到（視線＋大致在前方）或很近
function updateVisible() {
  const { sim, me, view, visible } = G;
  visible.clear();
  if (!me.alive) return;
  for (const p of sim.players) {
    if (p === me || !p.alive) continue;
    const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
    if (d > 60) continue;
    const fwd = (-dx * Math.sin(view.yaw) - dz * Math.cos(view.yaw)) / (d || 1);
    if (d > 8 && fwd < Math.cos(62 * Math.PI / 180)) continue;
    if (!sim.map.los(me.x, CFG.EYE, me.z, p.x, CFG.HEAD_Y, p.z) && !sim.map.los(me.x, CFG.EYE, me.z, p.x, 1.0, p.z)) continue;
    visible.add(p.id);
  }
}

// 觸控瞄準輔助：拋物線預覽打得到人、或準星壓在看得到的敵人身上時，轉視角變慢（不會自動轉過去）
function aimFriction() {
  const { me, view, sim, visible } = G;
  if (me.aiming && renderer.arcHit && renderer.arcHit.type === 'player') return 0.42;
  for (const p of sim.players) {
    if (p === me || !p.alive || !visible.has(p.id)) continue;
    const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
    const dyaw = Math.atan2(-dx, -dz) - view.yaw;
    const ay = Math.abs(Math.atan2(Math.sin(dyaw), Math.cos(dyaw)));
    const ap = Math.abs(Math.atan2(1.15 - CFG.EYE, d) - view.pitch);
    const tol = Math.atan2(0.45, d) + 0.03;
    if (ay < tol && ap < tol * 2.2) return 0.62;
  }
  return 1;
}

function tickOnce(fr) {
  const { sim, me, view } = G;
  const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
  const a = input.tickAim();
  const mine = { mx: cy * fr.mx - sy * fr.my, mz: -sy * fr.mx - cy * fr.my, yaw: view.yaw, pitch: view.pitch, aim: a.aim, cancel: a.cancel };
  if (G.mode === 'guest') { guestTick(mine); return; }
  const inputs = { [me.id]: mine };
  for (const b of G.bots) inputs[b.p.id] = b.input(CFG.TICK);
  if (G.mode === 'host') {
    for (const r of G.remote.values()) {
      const x = r.q.shift();
      if (x) { r.last = x; r.ack = x.s; inputs[r.pid] = x; }
      else if (r.last) inputs[r.pid] = { ...r.last, cancel: false, ch: undefined };
    }
  }
  sim.step(inputs);
  if (G.mode === 'host' && L) {
    if (sim.events.length) L.net.broadcast({ t: 'ev', e: sim.events }, true);
    if (++G.snapT % 3 === 0 || sim.state !== 'play') {
      const acks = {};
      for (const r of G.remote.values()) acks[r.pid] = r.ack;
      L.net.broadcast({ t: 'snap', ...sim.snapshot(acks) }, sim.state !== 'play');
    }
  }
  onEvents();
}

function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, last ? (t - last) / 1000 : 0);
  last = t;
  if (!renderer) return;
  if (!G) { idleT += dt; renderer.idle(idleT); return; }
  const { sim, me, view } = G;
  if (dt > 0) {
    perf.avg += (dt - perf.avg) * 0.05; perf.t += dt;
    if (perf.t > 2.5 && perf.avg > 1 / 42 && perf.q < 3) { perf.q++; renderer.setQuality(perf.q); perf.t = 0; }
    else if (perf.t > 8 && perf.avg < 1 / 58 && perf.q > 0) { perf.q--; renderer.setQuality(perf.q); perf.t = 0; }
  }
  // 開場：鏡頭從空中俯衝到眼睛高度，這段時間世界不動
  if (G.intro < INTRO) {
    G.intro = Math.min(INTRO, G.intro + dt);
    renderer.frame(sim, me, view, 1, dt, { showArc: false, intro: G.intro / INTRO });
    if (G.intro >= INTRO) endIntro();
    return;
  }
  const fr = input.frame(dt);
  if (G.mode === 'guest') {
    sim.update(performance.now(), me.id);
    if (sim.events.length) onEvents();
  }
  const frozen = G.mode === 'solo' && (G.paused || G.coach);
  if (!frozen && sim.state === 'play') {
    if (me.alive) {
      const k = settings.assist && COARSE ? aimFriction() : 1;
      view.yaw += fr.dyaw * k;
      view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + fr.dpitch * k));
    }
    G.acc += dt;
    let n = 0;
    while (G.acc >= CFG.TICK && n < 6) {
      tickOnce(fr);
      G.acc -= CFG.TICK;
      n++;
    }
    if (n === 6) G.acc = 0;
    // 腳步聲
    G.stepD += me.alive ? me.speed * dt : 0;
    if (G.stepD > 2.1) { G.stepD = 0; sfx.play('step', null, null, 1); }
  }
  G.visT -= dt;
  if (G.visT <= 0) { G.visT = 0.1; updateVisible(); }
  sfx.listener = { x: me.x, z: me.z, yaw: view.yaw };
  input.setCharge(me.charge, me.aiming && me.alive);
  input.setStones(me.stones);
  const still = frozen;
  renderer.frame(sim, me, view, still ? 1 : G.acc / CFG.TICK, still ? 0 : dt, { showArc: settings.arc });
  hud.update(sim, me, view, G.visible, renderer, still ? 0 : dt);
}

window.addEventListener('resize', () => { renderer && renderer.resize(); hud && hud.resize(); input.layout(); if (!G) syncMenu(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && G && G.mode === 'solo' && !G.paused && window.__wa.autoPause) pause(true); });
document.addEventListener('pointerlockchange', () => {
  if (!document.pointerLockElement && G && !G.paused && G.sim.state === 'play' && !input.touch.right && matchMedia('(pointer: fine)').matches) pause(true);
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

// 測試用
window.__wa = {
  // 同步跑 n 個 tick（Browser pane 隱藏時 rAF 幾乎不跑），再畫一格
  advance(n, mx = 0, my = 0) {
    if (G && G.intro < INTRO) { G.intro = INTRO; endIntro(); }
    for (let i = 0; i < n && G && G.sim.state === 'play'; i++) tickOnce({ mx, my });
    if (G) {
      updateVisible();
      input.setCharge(G.me.charge, G.me.aiming && G.me.alive);
      renderer.frame(G.sim, G.me, G.view, 1, 1 / 60, { showArc: settings.arc });
      hud.update(G.sim, G.me, G.view, G.visible, renderer, 1 / 60);
    }
  },
  skipIntro() { if (G && G.intro < INTRO) { G.intro = INTRO; endIntro(); } },
  autoPause: true, get G() { return G; }, get L() { return L; }, createRoom, joinRoom, hostStart, get renderer() { return renderer; }, input, settings, start, pause, toMenu, show, DIFFICULTY,
};

(async () => {
  await useMap(settings.map);
  const m = /room=([A-Za-z0-9]{4})/.exec(location.hash);
  if (m) openLobby(normCode(m[1])); else show('#menu');
  requestAnimationFrame(loop);
})();
