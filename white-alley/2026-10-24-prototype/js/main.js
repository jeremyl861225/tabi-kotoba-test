// 主迴圈與選單。
import { ACCENTS, BOT_NAMES, CFG, DIFFICULTY, PLAYER_ACCENT } from './config.js';
import { GameMap, mulberry32 } from './map.js';
import { Sim, movePlayer } from './sim.js';
import { MirrorSim } from './mirror.js';
import { P2P, genRoomCode, newId, normCode } from './net.js';
import { RemoteInput } from './remote.js';
import { aimSolve, chargeSpeed, forward, raycast } from './physics.js';
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
const COARSE = matchMedia('(pointer: coarse)').matches;   // 觸控裝置才開瞄準輔助
const haptic = (k) => { try { window.WA_NATIVE && window.WA_NATIVE.haptic(k); } catch { /* 網頁版沒有 */ } };   // 開場鏡頭從空中俯衝進巷子的秒數

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
    if (renderer) renderer.dispose();
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
  // 等待期間使用者可能已經離開或改建別的房，結果只套用在「還是目前這個房」的時候
  try { await net.start(); if (L && L.net === net) renderLobby(); } catch (e) { if (L && L.net === net) { leaveRoom(); renderLobby(e.message); } }
}

async function joinRoom() {
  sfx.unlock();
  const code = normCode($('#lbCode').value);
  if (code.length < 4) { animate($('#lbCode'), { x: [0, -8, 8, -5, 5, 0] }, { duration: 0.4 }); return; }
  if (L && L.role === 'guest' && L.code === code) return;   // Enter＋點按鈕連發
  const name = myName();
  leaveRoom();
  L = { role: 'guest', code, name, peers: [], connected: false };
  const net = new P2P({
    room: code, id: newId(), name, role: 'guest',
    onPeers: (ps) => { if (!L) return; L.connected = ps.length > 0; renderLobby(); },
    onData: (pid, m) => guestData(m),
    onClose: (pid, why) => hostGone(why),
    onBusy: () => { if (L && L.net === net && !L.connected) renderLobby('房間正在比賽，這場結束後會自動加入…'); },
  });
  L.net = net;
  renderLobby('連線中…');
  try {
    await net.start();
    if (!L || L.net !== net) return;
    renderLobby();
    setTimeout(() => {
      if (!L || L.net !== net || L.connected) return;
      if (net.busy) return;
      renderLobby(net.hostId
        ? '找到房主但連不上（行動網路有時擋點對點連線），兩邊改連同一個 Wi-Fi 再試'
        : '找不到這個房號的房主（確認房號，或請房主重新建立）');
    }, 12000);
  } catch (e) { if (L && L.net === net) { leaveRoom(); renderLobby(e.message); } }
}

function leaveRoom() {
  if (L && L.net) L.net.close();
  L = null;
}

async function shareRoom() {
  if (!L) return;
  // App 裡的網址是 whitealley://，分享出去沒用，只分享房號；網頁版附上直接進房的連結
  const url = window.WA_NATIVE ? null : `${location.origin}${location.pathname}#room=${L.code}`;
  try {
    if (navigator.share) await navigator.share(url ? { title: '白巷：一起來丟石頭', text: `房號 ${L.code}`, url } : { text: `來白巷丟石頭！房號 ${L.code}` });
    else { await navigator.clipboard.writeText(url || L.code); renderLobby(url ? '連結已複製' : '房號已複製'); }
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
    remote.set(p.id, { pid: pl.id, input: new RemoteInput() });
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
  if (r) r.input.push(m);
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
  const net = L && L.net;
  show('#loading');
  const map = await useMap(m.map);
  if (!L || L.net !== net) return;   // 載入期間房主走了
  renderer.reset();
  const sim = new MirrorSim(map, m.roster, m.mt);
  const me = sim.byId(m.you);
  setupGame(map, sim, me, [], 'guest', { seq: 0, hist: [], cdT: 0, pr: 0, cx: 0, ch: undefined, wasAim: false, needPos: true, ackFloor: 0, evq: [] });
}

function guestData(m) {
  if (!L) return;
  if (m.t === 'bye') { hostGone('left'); return; }
  if (m.t === 'lobby') { L.lobby = m; renderLobby(); return; }
  if (m.t === 'start') { guestStart(m); return; }
  if (!G || G.mode !== 'guest') return;
  if (m.t === 'snap') {
    const mine = G.sim.apply(m, G.me.id, performance.now());
    if (mine) reconcile(mine);
  } else if (m.t === 'ev') {
    // 事件延後 100 ms 再處理，跟畫面（其他人落後 100 ms 內插）對齊
    const at = performance.now() + 100;
    for (const e of m.e) G.evq.push({ at, e });
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
  if (m.ack <= G.ackFloor) return;   // 復活前送出的輸入，對照的是舊位置
  const i = G.hist.findIndex((h) => h.s === m.ack);
  if (i < 0) return;
  const h = G.hist[i];
  const ex = m.x - h.x, ez = m.z - h.z, e = Math.hypot(ex, ez);
  G.hist.splice(0, i);
  if (e < 0.03) return;
  // 平移誤差（不是直接跳到房主的位置），還沒被確認的移動才不會被吃掉
  me.x += ex; me.z += ez;
  for (const q of G.hist) { q.x += ex; q.z += ez; }
  G.map.collide(me);
}

function hostGone(why) {
  if (!L) return;
  leaveRoom();
  if (G) toMenu();
  openLobby();
  renderLobby(why === 'left' ? '房主離開了，房間已關閉' : '跟房主的連線斷了（網路不穩），可以再加入一次');
}

// 客人每個 tick：本機預測自己的移動與蓄力，輸入送給房主
function guestTick(inp) {
  const { sim, me } = G;
  // 每次按下給一個編號；取消與放手時的蓄力之後每包都帶，掉包也不會被房主誤判（js/remote.js）
  if (inp.aim && !G.wasAim) { G.pr++; G.ch = undefined; G.tsol = null; }
  G.wasAim = inp.aim;
  if (inp.cancel) G.cx = G.pr;
  if (inp.cancel && me.aiming) { me.aiming = false; me.charge = 0; }
  G.cdT--;   // 冷卻用自己的 tick 數算（房主也是每個 tick 消化一包輸入）
  if (me.alive && inp.aim && !me.aiming && G.cx !== G.pr && me.stones > 0 && G.cdT <= 0) { me.aiming = true; me.charge = 0; }
  if (me.aiming) {
    me.charge = Math.min(1, me.charge + CFG.TICK / CFG.CHARGE_T);
    if (!inp.aim && !inp.cancel) {
      G.ch = Math.round(me.charge * 1000) / 1000;
      if (inp.tp != null) G.tsol = { ty: Math.round(inp.ty * 1e4) / 1e4, tp: Math.round(inp.tp * 1e4) / 1e4, tv: Math.round(inp.tv * 100) / 100 };
      me.aiming = false; me.charge = 0; me.throwAt = sim.time; G.cdT = Math.round(CFG.THROW_CD / CFG.TICK);
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
  if (L) L.net.send(L.net.hostId, { t: 'in', s, mx: r3(inp.mx), mz: r3(inp.mz), yaw: r3(inp.yaw), pitch: r3(inp.pitch), aim: inp.aim, pr: G.pr, cx: G.cx, ch: G.ch, ...(G.tsol || {}) }, false);
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
    <div class="tip glass" style="right:${window.innerWidth - r.left + 18}px;top:${r.top - 6}px"><b>右邊：按住拖曳・放開丟</b><span>準心就是落點；拖到 ✕ 再放開就不丟</span></div>
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
// 先把事件陣列換掉再處理：處理途中就算有一筆出錯，同一批也不會每格重跑
const NOBODY = { id: -1, name: '？', accent: '#9aa0a8' };
function onEvents() {
  const { sim, me, view } = G;
  const evs = sim.events;
  sim.events = [];
  for (const e of evs) {
    switch (e.type) {
      case 'throw':
        sfx.play('throw', e.x, e.z, e.v / CFG.V_MAX);
        if (e.id === me.id && G.mode !== 'guest') renderer.kick = 1;
        if (e.id === me.id) haptic('throw');
        if (e.id !== me.id && Math.hypot(e.x - me.x, e.z - me.z) < 45) hud.ping(e.x, e.z, sim.time);
        break;
      case 'impact':
        sfx.play(e.surf, e.x, e.z, Math.min(1.2, e.sp / 18));
        renderer.puff(e.x, e.y, e.z, e.surf === 'ground' ? 0.22 : 0.16);
        if (e.sp > 6) renderer.chipBurst(e.x, e.y, e.z, e.nx || 0, e.surf === 'wall' ? 0.3 : 1, e.nz || 0, e.sp > 14 ? 7 : 4);
        break;
      case 'hit': {
        if (e.by === me.id) { hud.hitMarker(e.head); sfx.play('hitmark'); haptic(e.head ? 'head' : 'hit'); }
        sfx.play(e.head ? 'head' : 'hit', e.x, e.z);
        renderer.puff(e.x, e.y, e.z, 0.2, 0xe5b2ad);
        renderer.chipBurst(e.x, e.y, e.z, 0, 0.6, 0, 5);
        if (e.target === me.id) { sfx.play('hurt'); haptic('hurt'); hud.hurtFrom(e.fromX, e.fromZ); renderer.shake = e.head ? 1.4 : 0.9; } else renderer.flashChar(e.target);
        break;
      }
      case 'block':
        sfx.play('roof', e.x, e.z, 0.6);
        break;
      case 'ko': {
        const v = sim.byId(e.victim) || NOBODY, k = sim.byId(e.by) || NOBODY;   // 丟石頭的人可能已經離開
        hud.feed(k, v, e.head, me.id);
        if (e.by === me.id) { sfx.play('ko'); hud.koBanner(v.name, e.head); haptic('ko'); }
        if (e.victim === me.id) haptic('die');
        break;
      }
      case 'pickup':
        if (e.id === me.id) { sfx.play('pickup'); haptic('pickup'); }
        break;
      case 'spawn':
        if (e.id === me.id) {
          if (G.mode === 'guest') {
            // 用事件帶來的出生點，不等下一張快照；之前送出的輸入對照的是死前位置，修正時略過
            me.x = me.px = e.x; me.z = me.pz = e.z; me.vx = me.vz = 0; me.yaw = e.yaw;
            G.hist.length = 0; G.ackFloor = G.seq;
          }
          view.yaw = e.yaw ?? me.yaw; view.pitch = 0;
        }
        break;
      case 'leave':
        if (G.mode === 'guest') sim.removePlayer(e.id);
        break;
      case 'over': {
        input.setEnabled(false);   // 結算前這 0.9 秒的點按不要留到下一場
        input.reset();
        const g = G;
        setTimeout(() => { if (G === g) results(); }, 900);
        break;
      }
      default:
    }
  }
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

// 準心就是落點：從眼睛沿視線找準心指著的東西，再算出往上拋的出手方向、仰角與初速（physics.aimSolve）
function computeAim() {
  const { sim, me, view } = G;
  if (!me.alive) { G.aimSol = null; return; }
  const hit = raycast(sim.map, me.x, CFG.EYE, me.z, forward(view.yaw, view.pitch), sim.players, me.id, 70);
  if (!me.aiming) { G.aimSol = { hit }; return; }   // 沒在蓄力只要知道準心指著誰
  const sol = aimSolve(sim.map, me.x, me.z, hit, chargeSpeed(me.charge), sim.players, hit.player ? hit.player.id : -1, me.id);
  sol.hit = hit;
  G.aimSol = sol;
}

// 觸控瞄準輔助：準心壓在敵人身上時轉視角變慢（不會自動轉過去）；倍率慢慢變，不會一下快一下慢
function aimFriction() {
  const s = G.aimSol;
  if (s && s.hit && s.hit.player) return G.me.aiming ? 0.5 : 0.7;
  return 1;
}

function tickOnce(fr) {
  const { sim, me, view } = G;
  const sy = Math.sin(view.yaw), cy = Math.cos(view.yaw);
  const a = input.tickAim();
  let mine = { mx: cy * fr.mx - sy * fr.my, mz: -sy * fr.mx - cy * fr.my, yaw: view.yaw, pitch: view.pitch, aim: a.aim, cancel: a.cancel };
  const sol = G.aimSol;
  if (sol && sol.yaw != null) { mine.ty = sol.yaw; mine.tp = sol.pitch; mine.tv = sol.v; }
  if (window.__wa.autoplay && G.mode === 'solo') {   // 測試：我方也交給電腦，用來整場浸泡測試
    if (!G.autoBot) G.autoBot = new Bot(sim, me, 'normal', mulberry32(99));
    mine = G.autoBot.input(CFG.TICK);
    view.yaw = mine.yaw; view.pitch = mine.pitch;
  }
  if (G.mode === 'guest') { guestTick(mine); return; }
  const inputs = { [me.id]: mine };
  for (const b of G.bots) inputs[b.p.id] = b.input(CFG.TICK);
  if (G.mode === 'host') {
    for (const r of G.remote.values()) {
      const x = r.input.next();
      if (x) inputs[r.pid] = x;
    }
  }
  sim.step(inputs);
  if (G.mode === 'host' && L) {
    if (sim.events.length) L.net.broadcast({ t: 'ev', e: sim.events }, true);
    if (++G.snapT % 3 === 0 || sim.state !== 'play') {
      const acks = {};
      for (const r of G.remote.values()) acks[r.pid] = r.input.ack;
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
    const now = performance.now();
    sim.update(now, me.id);
    while (G.evq.length && G.evq[0].at <= now) sim.events.push(G.evq.shift().e);
    if (sim.events.length) onEvents();
  }
  const frozen = G.mode === 'solo' && (G.paused || G.coach);
  if (!frozen && sim.state === 'play') {
    if (me.alive) {
      const target = settings.assist && COARSE ? aimFriction() : 1;
      G.fk = (G.fk ?? 1) + (target - (G.fk ?? 1)) * Math.min(1, dt * 6);
      view.yaw += fr.dyaw * G.fk;
      view.pitch = Math.max(-1.2, Math.min(1.2, view.pitch + fr.dpitch * G.fk));
    }
    computeAim();
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
  renderer.frame(sim, me, view, still ? 1 : G.acc / CFG.TICK, still ? 0 : dt, { showArc: settings.arc, aim: G.aimSol });
  hud.update(sim, me, view, G.visible, renderer, still ? 0 : dt, G.aimSol);
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
    for (let i = 0; i < n && G && G.sim.state === 'play'; i++) { computeAim(); tickOnce({ mx, my }); }
    if (G) {
      updateVisible();
      computeAim();
      input.setCharge(G.me.charge, G.me.aiming && G.me.alive);
      renderer.frame(G.sim, G.me, G.view, 1, 1 / 60, { showArc: settings.arc, aim: G.aimSol });
      hud.update(G.sim, G.me, G.view, G.visible, renderer, 1 / 60, G.aimSol);
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
