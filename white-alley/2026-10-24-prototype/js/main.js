// 主迴圈與選單。
import { ACCENTS, BOT_NAMES, CFG, DIFFICULTY, PLAYER_ACCENT, TEAMS } from './config.js';
import { GameMap, mulberry32 } from './map.js';
import { Sim, movePlayer } from './sim.js';
import { MirrorSim } from './mirror.js';
import { P2P, genRoomCode, newId, normCode } from './net.js';
import { RemoteInput } from './remote.js';
import { aimSolve, crystalRay, forward, raycast } from './physics.js';
import { WEAPONS, WEAPON_KEYS, chargeSpeedW } from './weapons.js';
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
const DEFAULTS = { sens: 1, arc: true, sound: true, assist: true, map: 'mykonos', bots: 5, diff: 'normal', coached: false, weapon: 'stone', mode: 'team', power: matchMedia('(pointer: coarse)').matches };
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
    renderer.setQuality(perf.q, settings.power);
  }
  return map;
}

// ---------- 選單 ----------
const ruleText = () => (settings.mode === 'team'
  ? `兩隊各守一顆水晶，<b>打破對方水晶</b>就贏；<b>6 分鐘</b>到比水晶剩多少・${(settings.bots + 1) / 2} 對 ${(settings.bots + 1) / 2}`
  : '先拿 <b>10 KO</b>，或 <b>5 分鐘</b>後 KO 最多的人獲勝');
function syncMenu(instant = false) {
  document.querySelectorAll('.seg').forEach((seg) => segSet(seg, settings[seg.dataset.k], instant));
  $('#menu .rule').innerHTML = ruleText();
  document.querySelectorAll('.mapcard').forEach((c) => c.classList.toggle('on', c.dataset.v === settings.map));
  $('#sens').value = settings.sens;
  sliderFill($('#sens'));
  $('#optArc').checked = settings.arc;
  $('#optSound').checked = settings.sound;
  $('#optPower').checked = settings.power;
  document.body.classList.toggle('power', !!settings.power);
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
    $('#menu .rule').innerHTML = ruleText();
    if (L && L.role === 'host') lobbyBroadcast();
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
$('#optPower').addEventListener('change', (e) => {
  settings.power = e.target.checked; save();
  document.body.classList.toggle('power', settings.power);
  if (renderer) renderer.setQuality(perf.q, settings.power);
  if (hud) hud.power = settings.power;
});

$('#go').addEventListener('click', () => openWeapons('solo'));
$('#wpGo').addEventListener('click', () => weaponConfirm());
$('#wpBack').addEventListener('click', () => show(weaponMode === 'lobby' ? '#lobbyPane' : '#menu'));
$('#lbWeapon').addEventListener('click', () => openWeapons('lobby'));
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
  const screens = ['#menu', '#pausePane', '#results', '#loading', '#howPane', '#lobbyPane', '#weaponPane'];
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
  const rng = mulberry32(seed * 7);
  const team = settings.mode === 'team';
  // 水晶戰：你在藍隊，電腦一半一半；每場隨機決定哪一隊在哪個基地（地形不對稱也不會一直吃虧）
  const sim = new Sim(map, { seed, mode: team ? 'team' : 'ffa', swap: rng() < 0.5 });
  const me = sim.addPlayer({ name: '你', accent: team ? TEAMS[0].color : PLAYER_ACCENT, weapon: settings.weapon, team: 0 });
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  const bag = botWeapons(rng, settings.bots);
  const bots = [];
  for (let i = 0; i < settings.bots; i++) {
    const t = team ? (i % 2 === 0 ? 1 : 0) : undefined;
    const p = sim.addPlayer({ name: names[i], accent: team ? TEAMS[t].color : ACCENTS[i % ACCENTS.length], isBot: true, weapon: bag[i], team: t });
    bots.push(new Bot(sim, p, settings.diff, rng));
  }
  setupGame(map, sim, me, bots, 'solo');
}

// 電腦的武器：六種輪流發（洗牌），一場裡盡量不重複
function botWeapons(rng, n) {
  const out = [];
  while (out.length < n) out.push(...[...WEAPON_KEYS].sort(() => rng() - 0.5));
  return out.slice(0, n);
}

// ---------- 選武器 ----------
let weaponMode = 'solo';
let weaponPick = null;
function wIcon(k, cls = '') { return `<svg class="i ${cls}"><use href="#i-w-${k}"/></svg>`; }
function openWeapons(mode) {
  weaponMode = mode;
  weaponPick = settings.weapon;
  const grid = $('#wpGrid');
  if (!grid.children.length) {
    grid.innerHTML = WEAPON_KEYS.map((k) => {
      const W = WEAPONS[k];
      return `<button class="wcard" data-w="${k}"><span class="wic">${wIcon(k)}</span><b>${W.name}</b><small>${W.short}</small></button>`;
    }).join('');
    grid.addEventListener('click', (e) => { const b = e.target.closest('.wcard'); if (b) pickWeapon(b.dataset.w); });
  }
  pickWeapon(weaponPick, true);
  $('#wpGo').innerHTML = mode === 'lobby' ? '<svg class="i"><use href="#i-check"/></svg>就用這把' : '<span class="lbl">出發</span><span class="ico"><svg class="i"><use href="#i-arrow"/></svg></span>';
  $('#wpGo').className = mode === 'lobby' ? 'btn-ink' : 'btn-go';
  show('#weaponPane');
}
function pickWeapon(k, instant = false) {
  weaponPick = k;
  const W = WEAPONS[k];
  document.querySelectorAll('.wcard').forEach((b) => b.classList.toggle('on', b.dataset.w === k));
  const bar = (n) => `<i style="--n:${n}"></i>`;
  $('#wpDetail').innerHTML = `<div class="wd-head"><span class="wic big">${wIcon(k)}</span><div><h3 class="serif">${W.name}</h3><p>${W.short}</p></div></div>
    <p class="wd-desc">${W.desc}</p>
    <div class="wd-stats"><span>威力</span>${bar(W.stats.power)}<span>距離</span>${bar(W.stats.range)}<span>上手</span>${bar(W.stats.ease)}</div>`;
  if (!instant) animate($('#wpDetail'), { opacity: [0.4, 1], x: [8, 0] }, { duration: 0.3 });
}
function weaponConfirm() {
  settings.weapon = weaponPick; save();
  if (weaponMode === 'lobby') {
    if (L && L.role === 'guest' && L.net.hostId) L.net.send(L.net.hostId, { t: 'pick', w: settings.weapon });
    if (L && L.role === 'host') lobbyBroadcast();
    show('#lobbyPane'); renderLobby();
  } else start();
}

function setupGame(map, sim, me, bots, mode, extra = {}) {
  if (hud) hud.root.innerHTML = '';
  hud = new Hud($('#hud'), map, me.weapon, sim.mode === 'team' ? me.team : -1);
  hud.power = settings.power;
  input.setWeapon(WEAPONS[me.weapon]);
  renderer.setMyBlade(me.accent);
  hud.el.pause.addEventListener('click', () => pause(true));
  for (const el of hud.root.querySelectorAll('.pause, .vitals, .score, .minimap')) el.style.opacity = 0;
  $('#touch .stick.right').style.opacity = 0;
  G = { map, sim, me, bots, mode, view: { yaw: me.yaw, pitch: 0 }, acc: 0, paused: false, visible: new Set(), seen: new Set(), visT: 0, stepD: 0, intro: 0, coach: false, alertT: -9, ...extra };
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
  const wOf = (p) => (p.me ? settings.weapon : p.w || (L.role === 'host' ? (L.picks || {})[p.id] : null) || 'stone');
  // 水晶戰：開局時真人照加入順序輪流分隊（房主藍隊），大廳先用隊伍色標出來
  const lbMode = L.role === 'host' ? settings.mode : (L.lobby || {}).mode;
  $('#lbPlayers').innerHTML = list.map((p, i) => `<li class="${p.me ? 'me' : ''}"${lbMode === 'team' ? ` style="box-shadow: inset 3px 0 0 ${TEAMS[i % 2].color}, inset 0 0 0 1px oklch(1 0 0 / 0.7)"` : ''}>${wIcon(wOf(p), 'wsm')}<span>${esc(p.name)}</span>${p.host ? '<em>房主</em>' : ''}${p.me ? '<em class="you">你</em>' : ''}</li>`).join('');
  $('#lbWeapon').innerHTML = `${wIcon(settings.weapon)}<span>武器：${WEAPONS[settings.weapon].name}</span><small>更換</small>`;
  const lb = L.role === 'host' ? settings : (L.lobby || {});
  const MAPN = { mykonos: '米克諾斯・迷城', yongkang: '台北・永康街' };
  const total = Math.min(8, list.length + (lb.bots || 0)), teamMode = lb.mode === 'team';
  $('#lbRule').textContent = lb.map ? `${teamMode ? '水晶戰' : '大亂鬥'}・${MAPN[lb.map] || lb.map}・${teamMode ? `${Math.ceil(total / 2)} 對 ${Math.ceil(total / 2)}` : `電腦補到 ${total} 人`}・${(DIFFICULTY[lb.diff] || {}).label || ''}` : '';
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
    onPeers: (ps) => { if (!L) return; L.connected = ps.length > 0; if (L.connected) net.send(net.hostId, { t: 'pick', w: settings.weapon }); renderLobby(); },
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
  const picks = L.picks || {};
  L.net.broadcast({ t: 'lobby', players: [{ id: 'host', name: L.name, host: true, w: settings.weapon }, ...L.peers.map((p) => ({ ...p, w: picks[p.id] || 'stone' }))], map: settings.map, bots: settings.bots, diff: settings.diff, mode: settings.mode });
}

// 房主開局：自己＋連上的人＋電腦補人數
async function hostStart() {
  if (!L || L.role !== 'host') return;
  sfx.unlock(); sfx.on = settings.sound;
  show('#loading');
  const map = await useMap(settings.map);
  renderer.reset();
  const seed = (Date.now() & 0xfffff) + 1;
  const rng = mulberry32(seed * 7);
  const team = settings.mode === 'team', swap = rng() < 0.5;
  const sim = new Sim(map, { seed, mode: team ? 'team' : 'ffa', swap });
  L.net.accepting = false;
  // 水晶戰：真人輪流分到兩隊（房主藍隊），電腦補到兩隊一樣多
  const tOf = (i) => (team ? i % 2 : undefined);
  const acc = (i, t) => (team ? TEAMS[t].color : ACCENTS[i % ACCENTS.length]);
  const me = sim.addPlayer({ name: L.name, accent: acc(0, 0), weapon: settings.weapon, team: tOf(0) });
  const remote = new Map();
  L.peers.forEach((p, i) => {
    const t = tOf(i + 1);
    const pl = sim.addPlayer({ name: p.name, accent: acc(i + 1, t), weapon: (L.picks || {})[p.id] || 'stone', team: t });
    remote.set(p.id, { pid: pl.id, input: new RemoteInput() });
  });
  const names = [...BOT_NAMES].sort(() => rng() - 0.5);
  const bots = [];
  let nb = Math.max(0, Math.min(settings.bots, 8 - sim.players.length));
  if (team) {   // 總人數湊成偶數，兩隊一樣多（最多 8 人）
    let total = Math.max(settings.bots + 1, sim.players.length);
    total = Math.min(8, total + (total % 2));
    nb = Math.max(0, total - sim.players.length);
  }
  const bag = botWeapons(rng, nb);
  for (let i = 0; i < nb; i++) {
    const n0 = sim.players.filter((q) => q.team === 0).length, n1 = sim.players.filter((q) => q.team === 1).length;
    const t = team ? (n0 <= n1 ? 0 : 1) : undefined;
    const p = sim.addPlayer({ name: names[i], accent: acc(sim.players.length, t), isBot: true, weapon: bag[i], team: t });
    bots.push(new Bot(sim, p, settings.diff, rng));
  }
  const roster = sim.players.map((p) => ({ id: p.id, name: p.name, accent: p.accent, isBot: p.isBot, weapon: p.weapon, team: p.team }));
  for (const [pid, r] of remote) L.net.send(pid, { t: 'start', map: settings.map, roster, you: r.pid, mt: sim.matchTime, mode: sim.mode, swap });
  sim.events.length = 0;
  setupGame(map, sim, me, bots, 'host', { remote, snapT: 0 });
  // 開局先送一張快照，客人才知道自己在哪
  L.net.broadcast({ t: 'snap', ...sim.snapshot({}) }, true);
}

function hostData(pid, m) {
  if (m.t === 'pick' && L && WEAPONS[m.w]) { (L.picks ||= {})[pid] = m.w; renderLobby(); lobbyBroadcast(); return; }
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
  const sim = new MirrorSim(map, m.roster, m.mt, m.mode, m.swap);
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
  const W = WEAPONS[me.weapon];
  const can = W.kind === 'melee' ? true : W.kind === 'hitscan' ? me.stones > 0 && (me.reloadUntil || 0) <= sim.time : me.stones > 0;
  if (me.alive && inp.aim && !me.aiming && G.cx !== G.pr && can && G.cdT <= 0) { me.aiming = true; me.charge = 0; }
  if (me.aiming) {
    if (W.kind !== 'hitscan' || me.speed < 1.2) me.charge = Math.min(1, me.charge + CFG.TICK / W.chargeT);
    if (!inp.aim && !inp.cancel) {
      G.ch = Math.round(me.charge * 1000) / 1000;
      const r4 = (v) => Math.round(v * 1e4) / 1e4;
      if (inp.tp != null) G.tsol = { ty: r4(inp.ty), tp: r4(inp.tp), tv: Math.round(inp.tv * 100) / 100 };
      else if (inp.ty != null) G.tsol = { ty: r4(inp.ty) };
      const lunge = W.kind === 'melee' && me.charge * W.chargeT >= W.lungeT;
      if (lunge) me.lungeAt = sim.time;
      me.aiming = false; me.charge = 0; me.throwAt = sim.time; G.cdT = Math.round((lunge ? W.lungeCd : W.cd) / CFG.TICK);
      renderer.kick = 1;
    }
  }
  me.px = me.x; me.pz = me.z;
  if (me.alive) {
    movePlayer(sim.map, me, inp, CFG.TICK);
    for (const c of sim.crystals) {   // 跟房主一樣被水晶擋住，預測才不會一直被拉回去
      const dx = me.x - c.x, dz = me.z - c.z, d = Math.hypot(dx, dz), r = CFG.CRYSTAL_R + CFG.R;
      if (d < r && d > 1e-6) { me.x = c.x + (dx / d) * r; me.z = c.z + (dz / d) * r; sim.map.collide(me); }
    }
    me.speed = Math.hypot(me.x - me.px, me.z - me.pz) / CFG.TICK;
  }
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
    ${G.sim.mode === 'team' ? `<div class="tip glass" style="left:0;right:0;margin:0 auto;width:max-content;top:64px"><b>打破<em style="font-style:normal;color:${TEAMS[1 - G.me.team].color}">${TEAMS[1 - G.me.team].name}</em>的水晶就贏</b><span>上方是兩隊水晶的血量；跟著天空的光柱走就找得到</span></div>` : ''}
    <div class="tip glass" style="right:${window.innerWidth - r.left + 18}px;top:${r.top - 6}px"><b>右邊：按住拖曳・放開出手</b><span>${{ rifle: '站穩按住越久越準；拖到 ✕ 再放開就不開槍', saber: '按住舉劍擋東西，放開揮砍；按久一點會衝刺' }[G.me.weapon] || '準心就是落點；拖到 ✕ 再放開就不丟'}</span></div>
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
  if (G.sim.mode === 'team') { teamResults(); return; }
  const { sim, me } = G;
  const rank = sim.ranking();
  const tie = rank.length > 1 && rank[0].kills === rank[1].kills && rank[0].deaths === rank[1].deaths && rank[0].heads === rank[1].heads;
  const win = rank[0] === me && !tie;
  const pos = rank.indexOf(me) + 1;
  $('#resRank').textContent = `第 ${pos} 名・共 ${rank.length} 人`;
  $('#resTitle').textContent = tie ? '平手' : win ? '你贏了！' : `${rank[0].name} 獲勝`;
  $('#resStats').innerHTML = [['KO', me.kills], ['倒下', me.deaths], ['爆頭', me.heads]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  $('#resTable').innerHTML = `<tr><th></th><th>玩家</th><th>KO</th><th>倒下</th><th>爆頭</th></tr>` + rank.map((p, i) =>
    `<tr class="${p === me ? 'me' : ''} ${i === 0 && !tie ? 'p1' : ''}"><td>${i + 1}</td><td><span class="nm"><i class="dot" style="background:${esc(p.accent)}"></i>${esc(p.name)}${p.weapon ? wIcon(p.weapon) : ''}</span></td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.heads}</td></tr>`).join('');
  sfx.play(win ? 'win' : 'ko');
  document.exitPointerLock?.();
  $('#again').hidden = G.mode === 'guest';
  if (L && L.role === 'host') L.net.accepting = true;   // 結算時可以讓新朋友進房，下一場一起玩
  $('#resWait').hidden = G.mode !== 'guest';
  show('#results');
  glass.add($('#results'));
}

// 水晶戰的結算：哪隊贏、怎麼贏的、兩隊名單（KO／倒下／打水晶）
function teamResults() {
  const { sim, me } = G;
  const wt = sim.winnerTeam, mine = me.team;
  const broke = sim.crystals.some((c) => c.hp <= 0);
  const pct = (t) => Math.round((sim.crystals[t].hp / sim.crystals[t].max) * 100);
  const win = wt === mine;
  $('#resRank').textContent = broke ? (win ? '敵方水晶被擊破' : wt < 0 ? '' : '我方水晶被擊破') : `時間到・水晶剩 ${pct(mine)}% 對 ${pct(1 - mine)}%`;
  $('#resTitle').textContent = wt < 0 ? '平手' : win ? '勝利！' : '落敗';
  $('#resStats').innerHTML = [['KO', me.kills], ['倒下', me.deaths], ['打水晶', me.crystalDmg || 0]].map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('');
  const row = (p) => `<tr class="${p === me ? 'me' : ''}"><td><i class="dot" style="background:${TEAMS[p.team].color}"></i></td><td><span class="nm">${esc(p.name)}${p.weapon ? wIcon(p.weapon) : ''}</span></td><td>${p.kills}</td><td>${p.deaths}</td><td>${p.crystalDmg || 0}</td></tr>`;
  const byTeam = (t) => sim.players.filter((p) => p.team === t).sort((a, b) => b.kills - a.kills || (b.crystalDmg || 0) - (a.crystalDmg || 0));
  $('#resTable').innerHTML = `<tr><th></th><th>玩家</th><th>KO</th><th>倒下</th><th>打水晶</th></tr>`
    + [mine, 1 - mine].map((t) => `<tr class="tsep"><td colspan="5" style="color:${TEAMS[t].color}">${TEAMS[t].name}${t === mine ? '（你）' : ''}・KO ${sim.teamKills[t]}・水晶 ${pct(t)}%</td></tr>` + byTeam(t).map(row).join('')).join('');
  sfx.play(win ? 'win' : 'ko');
  document.exitPointerLock?.();
  $('#again').hidden = G.mode === 'guest';
  if (L && L.role === 'host') L.net.accepting = true;
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
      case 'throw': {
        const W = WEAPONS[e.w] || WEAPONS.stone;
        if (W.kind === 'boom') sfx.play('whirr', e.x, e.z);
        else sfx.play('throw', e.x, e.z, e.v / (W.vMax || CFG.V_MAX));
        if (e.w === 'cat') sfx.play('meow', e.x, e.z, 0.8);
        if (e.w === 'grenade') sfx.play('pin', e.x, e.z);
        if (e.id === me.id && G.mode !== 'guest') renderer.kick = 1;
        if (e.id === me.id) haptic('throw');
        if (e.id !== me.id && Math.hypot(e.x - me.x, e.z - me.z) < 45) hud.ping(e.x, e.z, sim.time);
        break;
      }
      case 'shot': {
        renderer.tracer(e.x0, e.y0, e.z0, e.x1, e.y1, e.z1, e.id === me.id);
        sfx.play('shot', e.x0, e.z0);
        if (e.surf === 'wall' || e.surf === 'ground') { renderer.puff(e.x1, e.y1, e.z1, 0.14); renderer.chipBurst(e.x1, e.y1, e.z1, 0, 0.6, 0, 4); }
        if (e.surf === 'deflect' || e.surf === 'cat') renderer.sparks(e.x1, e.y1, e.z1, 8, 3);
        if (e.id === me.id) { if (G.mode !== 'guest') renderer.kick = 1.6; haptic('throw'); }
        else if (Math.hypot(e.x0 - me.x, e.z0 - me.z) < 60) hud.ping(e.x0, e.z0, sim.time);
        break;
      }
      case 'slash': {
        const p = sim.byId(e.id);
        renderer.slash(e.x, e.z, e.yaw, p ? p.accent : '#3a86ff');
        renderer.charSlash(e.id, sim.time);
        sfx.play('swing', e.x, e.z);
        break;
      }
      case 'lunge':
        renderer.charLunge(e.id, sim.time);
        renderer.puff(e.x, 0.15, e.z, 0.3, 0xd9dadc, 0.45, 0.4);
        sfx.play('lunge', e.x, e.z);
        if (e.id === me.id) haptic('throw');
        break;
      case 'clash': case 'deflect': {
        const y = e.y ?? 1.2;
        renderer.sparks(e.x, y, e.z, e.type === 'clash' ? 16 : 10, 4);
        renderer.flash(e.x, y, e.z, 0.18, 0xfff6d8, 0.08);
        sfx.play('clash', e.x, e.z, e.type === 'clash' ? 1 : 0.7);
        if (e.id === me.id) haptic('hit');
        break;
      }
      case 'explode': {
        renderer.explode(e.x, e.y, e.z, e.r);
        sfx.play('boom', e.x, e.z);
        const d = Math.hypot(e.x - me.x, e.z - me.z);
        if (d < e.r * 4) { renderer.shake = Math.max(renderer.shake, 1.8 * (1 - d / (e.r * 4))); haptic('hit'); }
        break;
      }
      case 'cat':
        renderer.puff(e.x, 0.2, e.z, 0.28);
        sfx.play('meow', e.x, e.z, 1);
        break;
      case 'catdown':
        renderer.puff(e.x, 0.25, e.z, 0.35, 0xeeeeee, 0.5, 0.5);
        if (e.by) sfx.play('meow', e.x, e.z, 0.6);
        break;
      case 'bite':
        sfx.play('bite', e.x, e.z);
        break;
      case 'crystal': {
        renderer.crystalHit(e.team, e.x, e.y, e.z);
        sfx.play('crystal', e.x, e.z);
        if (e.by === me.id) { hud.hitMarker(false); haptic('hit'); }
        // 自家水晶被打：提示（6 秒內只提示一次）
        if (e.team === me.team && sim.time - G.alertT > 6) { G.alertT = sim.time; hud.alert('我方水晶遭到攻擊！'); haptic('hurt'); }
        break;
      }
      case 'crystaldown':
        renderer.crystalBreak(e.team, e.x, e.z);
        sfx.play('shatter');
        renderer.shake = Math.max(renderer.shake, Math.hypot(e.x - me.x, e.z - me.z) < 30 ? 1.6 : 0.6);
        haptic('ko');
        break;
      case 'catch':
        if (e.id === me.id) { sfx.play('catch'); haptic('pickup'); }
        break;
      case 'reload':
        if (e.id === me.id) sfx.play('reload');
        break;
      case 'reloaded':
        if (e.id === me.id) { sfx.play('reloaded'); haptic('pickup'); }
        break;
      case 'regen':   // 彈藥補回一發：貓會叫一聲，其他武器補滿時輕輕提示
        if (e.id === me.id) {
          if (me.weapon === 'cat') sfx.play('meow', null, null, 0.5);
          else if (me.stones >= (WEAPONS[me.weapon] || WEAPONS.stone).ammo) sfx.play('pickup');
        }
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
        if (e.w !== 'saber' && e.w !== 'cat') renderer.chipBurst(e.x, e.y, e.z, 0, 0.6, 0, 5);
        if (e.w === 'saber') renderer.sparks(e.x, e.y, e.z, 6, 2.5);
        if (e.target === me.id) { sfx.play('hurt'); haptic('hurt'); hud.hurtFrom(e.fromX, e.fromZ); renderer.shake = e.head ? 1.4 : 0.9; } else renderer.flashChar(e.target);
        break;
      }
      case 'block':
        sfx.play('roof', e.x, e.z, 0.6);
        break;
      case 'ko': {
        const v = sim.byId(e.victim) || NOBODY, k = sim.byId(e.by) || NOBODY;   // 丟石頭的人可能已經離開
        hud.feed(k, v, e.head, me.id, e.w);
        if (e.by === me.id) { sfx.play('ko'); hud.koBanner(v.name, e.head); haptic('ko'); }
        if (e.victim === me.id) haptic('die');
        break;
      }
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
        input.setEnabled(false);   // 結算前這段時間的點按不要留到下一場
        input.reset();
        if (sim.mode === 'team' && e.team !== undefined) sim.winnerTeam = e.team;   // 客人的鏡像世界從事件得知
        const g = G, broke = sim.mode === 'team' && sim.crystals.some((c) => c.hp <= 0);
        if (sim.mode === 'team') hud.alert(sim.winnerTeam === me.team ? '勝利！' : sim.winnerTeam < 0 ? '平手' : '落敗', sim.winnerTeam === me.team ? 'win' : 'lose');
        setTimeout(() => { if (G === g) results(); }, broke ? 2400 : 1200);   // 水晶碎掉要讓人看一下
        break;
      }
      default:
    }
  }
}

// 小地圖要畫的人：看得到（視線＋大致在前方）或很近
// visible：小地圖上畫的人；seen：頭上有名牌的人。
// 大亂鬥兩者一樣（自己看得到的）。水晶戰：隊友永遠在小地圖上、有名牌；敵人只要有任何隊友看得到就上小地圖（共享視野），名牌還是要自己看得到
function updateVisible() {
  const { sim, me, view, visible, seen } = G;
  visible.clear(); seen.clear();
  const team = sim.mode === 'team';
  const sees = (a, p, cone) => {
    const dx = p.x - a.x, dz = p.z - a.z, d = Math.hypot(dx, dz);
    if (d > (cone ? 60 : 40)) return false;
    if (cone) {
      const fwd = (-dx * Math.sin(view.yaw) - dz * Math.cos(view.yaw)) / (d || 1);
      if (d > 8 && fwd < Math.cos(62 * Math.PI / 180)) return false;
    }
    return sim.map.los(a.x, CFG.EYE, a.z, p.x, CFG.HEAD_Y, p.z) || sim.map.los(a.x, CFG.EYE, a.z, p.x, 1.0, p.z);
  };
  const mates = team ? sim.players.filter((q) => q !== me && q.alive && q.team === me.team) : [];
  for (const p of sim.players) {
    if (p === me || !p.alive) continue;
    if (team && p.team === me.team) { visible.add(p.id); if (Math.hypot(p.x - me.x, p.z - me.z) < 45) seen.add(p.id); continue; }
    if (me.alive && sees(me, p, true)) { visible.add(p.id); seen.add(p.id); continue; }
    if (mates.some((m) => sees(m, p, false))) visible.add(p.id);
  }
}

// 準心就是落點：從眼睛沿視線找準心指著的東西，再算出往上拋的出手方向、仰角與初速（physics.aimSolve）
function computeAim() {
  const { sim, me, view } = G;
  if (!me.alive) { G.aimSol = null; return; }
  const W = WEAPONS[me.weapon];
  // 水晶戰：準心穿過隊友（不會鎖定、瞄準輔助也不會在隊友身上變慢）
  const foes = sim.mode === 'team' ? sim.players.filter((q) => q === me || q.team !== me.team) : sim.players;
  const dir = forward(view.yaw, view.pitch);
  let hit = raycast(sim.map, me.x, CFG.EYE, me.z, dir, foes, me.id, 70);
  // 準心指著水晶：落點就是水晶表面（敵方的才算鎖定）
  const cr = crystalRay(sim.crystals, me.x, CFG.EYE, me.z, dir, hit.t);
  if (cr) hit = { x: cr.x, y: cr.y, z: cr.z, t: cr.t, surf: 'crystal', crystal: cr.c, foeCrystal: cr.c.team !== me.team };
  if (W.kind === 'melee') {   // 光劍：準心指著的人在揮砍距離內就提示
    const tgt = hit.player || hit.foeCrystal;
    G.aimSol = { hit, inReach: !!(tgt && hit.t <= W.reach + 0.3), inLunge: !!(hit.player && hit.t <= W.lungeDist + W.reach * 0.6) };
    return;
  }
  if (W.kind === 'hitscan') { G.aimSol = { hit }; return; }
  if (W.kind === 'boom') {
    // 回力鏢會往右彎：出手方向往左補，讓去程剛好經過準心指的距離
    const raw = Math.hypot(hit.x - me.x, hit.z - me.z), d = Math.min(W.range, raw);
    const bend = Math.sin(Math.PI * Math.min(1, d / W.range)) * 2.4;
    G.aimSol = { hit, yaw: view.yaw + Math.atan2(bend, Math.max(2, d)), boom: true, far: raw > W.range + 1 && hit.surf !== 'air' };
    return;
  }
  if (!me.aiming) { G.aimSol = { hit }; return; }   // 沒在蓄力只要知道準心指著誰
  const sol = aimSolve(sim.map, me.x, me.z, hit, chargeSpeedW(W, me.charge), foes, hit.player ? hit.player.id : -1, me.id, W.vMax);
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
  if (sol && sol.boom) mine.ty = sol.yaw;
  else if (sol && sol.yaw != null && sol.pitch != null) { mine.ty = sol.yaw; mine.tp = sol.pitch; mine.tv = sol.v; }
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
  // 省電：遊戲中每秒最多 30 格；選單背景每秒 20 格就夠（這一格不處理，時間留到下一格一起算）
  const cap = !G || G.paused ? 48 : settings.power ? 30 : 0;
  if (cap && last && t - last < cap - 3) return;
  const dt = Math.min(0.1, last ? (t - last) / 1000 : 0);
  last = t;
  if (!renderer) return;
  if (!G) { idleT += dt; renderer.idle(idleT); return; }
  const { sim, me, view } = G;
  if (dt > 0) {
    perf.avg += (dt - perf.avg) * 0.05; perf.t += dt;
    // 自動畫質：平均每格比目標慢就降一級（省電模式目標是 30 fps）
    const slow = settings.power ? 1 / 24 : 1 / 42, fast = settings.power ? 1 / 29 : 1 / 58;
    if (perf.t > 2.5 && perf.avg > slow && perf.q < 3) { perf.q++; renderer.setQuality(perf.q, settings.power); perf.t = 0; }
    else if (perf.t > 8 && perf.avg < fast && perf.q > 0) { perf.q--; renderer.setQuality(perf.q, settings.power); perf.t = 0; }
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
  input.setStones(me.stones, (me.reloadUntil || 0) > sim.time);
  const still = frozen;
  renderer.frame(sim, me, view, still ? 1 : G.acc / CFG.TICK, still ? 0 : dt, { showArc: settings.arc, aim: G.aimSol });
  hud.update(sim, me, view, G.visible, renderer, still ? 0 : dt, G.aimSol, G.seen);
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
      hud.update(G.sim, G.me, G.view, G.visible, renderer, 1 / 60, G.aimSol, G.seen);
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
