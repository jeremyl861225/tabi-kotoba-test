// 學習紀錄：只存在這支手機（localStorage），可匯出／匯入備份。
const KEY = 'street-talk-test/v1';

const DEFAULT_SETTINGS = {
  pron: true,           // 在字下方標 KK 音標（2026-10-03 使用者選 KK）
  voice: 'alt',         // alt（女男交替）| f（女聲）| m（男聲）
  rate: 1,              // 1 | 0.8 | 0.6
  autoplay: true,
  veil: false,          // 學習時先遮住中文
  theme: 'auto',        // auto | light | dark
  quizTypes: ['k2z', 'z2k', 'pron', 'aud', 'audz', 'exl', 'spell', 'dict'],
  qv: 1,              // 題型清單版本：之後題型改版時升號，舊紀錄會自動全開新題型
  quizCount: 20,
};

function fresh() {
  return {
    v: 1,
    starred: {},        // id -> 加星時間
    seen: {},           // id -> 看過次數（學習模式）
    stats: {},          // id -> [答對, 答錯, 最後作答時間]
    units: {},          // unitId -> { best, total, pos, done }
    lastUnit: null,
    home: { fam: '', open: {} },  // 首頁：只看哪個主題家族、各條線展開與否
    settings: { ...DEFAULT_SETTINGS },
  };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const s = JSON.parse(raw);
    const f = fresh();
    const settings = { ...f.settings, ...(s.settings || {}) };
    if ((s.settings || {}).qv !== f.settings.qv) {
      settings.quizTypes = f.settings.quizTypes;
      settings.qv = f.settings.qv;
    }
    return { ...f, ...s, settings };
  } catch (e) {
    return fresh();
  }
}

export const store = load();

let saveTimer = null;
export function save(now = false) {
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* 空間不足時放棄這次寫入 */ }
  };
  clearTimeout(saveTimer);
  if (now) write(); else saveTimer = setTimeout(write, 150);
}
window.addEventListener('pagehide', () => save(true));

export const isStarred = (id) => !!store.starred[id];

export function toggleStar(id, on) {
  const want = on === undefined ? !store.starred[id] : on;
  if (want) store.starred[id] = Date.now(); else delete store.starred[id];
  save();
  return want;
}

export function markSeen(id) {
  store.seen[id] = (store.seen[id] || 0) + 1;
  save();
}

export function recordAnswer(id, ok) {
  const s = store.stats[id] || [0, 0, 0];
  if (ok) s[0]++; else s[1]++;
  s[2] = Date.now();
  store.stats[id] = s;
  save();
}

export function unitRec(uid) {
  return store.units[uid] || (store.units[uid] = { best: null, total: null, pos: 0, done: false });
}

export function exportBackup() {
  return JSON.stringify({ app: 'street-talk', exported: new Date().toISOString(), data: store }, null, 1);
}

export function importBackup(text) {
  const obj = JSON.parse(text);
  const d = obj && obj.app === 'street-talk' ? obj.data : null;
  if (!d || typeof d !== 'object' || !d.starred) throw new Error('這不是 Street Talk 的備份檔');
  const f = fresh();
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, f, d, { settings: { ...f.settings, ...(d.settings || {}) } });
  save(true);
}

export function resetAll() {
  const keep = store.settings;
  Object.keys(store).forEach((k) => delete store[k]);
  Object.assign(store, fresh(), { settings: keep });
  save(true);
}
