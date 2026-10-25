// 真人連線（沿用白巷的做法）：房主跑模擬，其他人用 WebRTC 資料通道點對點連到房主（星狀）。
// Supabase Realtime 只在開始時交換連線資訊（房號 → offer／answer／ICE），遊戲中的資料不經過伺服器。
// 每條連線兩個通道：rel（可靠、有序：開局、事件）、fast（不重送、不排序：輸入、快照）。
import { ICE, SUPABASE } from './netconfig.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const genRoomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export const newId = () => Math.random().toString(36).slice(2, 10);

// 整個 App 共用一個 Supabase client（每次 createClient 都會多掛一個監聽、還會警告重複）
let client = null;
async function getClient() {
  await loadScript('vendor/supabase.js');
  if (!client) {
    client = window.supabase.createClient(SUPABASE.url, SUPABASE.key, {
      realtime: { params: { eventsPerSecond: 20 } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.supabase) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('無法載入連線元件'));
    document.head.appendChild(s);
  });
}

export class P2P {
  // role: 'host' | 'guest'；onPeers(list)、onData(peerId, msg)、onClose(peerId, why：'left' 離開房間／'link' 連線斷了)、onBusy()（房間正在比賽）
  constructor({ room, id, name, role, onPeers, onData, onClose, onStatus, onBusy }) {
    Object.assign(this, { room, id, name, role, onPeers, onData, onClose, onStatus, onBusy });
    this.peers = new Map();   // peerId → { pc, rel, fast, name, open }
    this.closed = false;
    this.accepting = true;    // 房主開局後不再收新人
  }

  async start(timeoutMs = 10000) {
    this.client = await getClient();
    if (this.closed) throw new Error('已離開');   // 等待期間被關掉：不要再訂閱
    const ch = (this.ch = this.client.channel(`rt-${this.room}`, { config: { broadcast: { self: false, ack: false }, presence: { key: this.id } } }));
    ch.on('broadcast', { event: 's' }, ({ payload }) => this._signal(payload).catch((e) => console.warn('signal', e)));
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState();
      this.presence = Object.entries(st).map(([id, arr]) => ({ id, ...(arr[arr.length - 1] || {}) }));
      // 客人：房主從房間消失、而且點對點連線也不在了，才算房主離開
      // （房主的訊號連線偶爾會重連，那時 presence 會短暫看不到他，但遊戲連線還好好的）
      if (this.role === 'guest' && this.hostId && this._sawHost && !this.presence.some((p) => p.id === this.hostId)) {
        const hp = this.peers.get(this.hostId);
        if (!hp || !hp.open) { this.closed || this.onClose && this.onClose(this.hostId, 'left'); }
      }
      if (this.role === 'guest' && this.presence.some((p) => p.role === 'host')) this._sawHost = true;
    });
    await new Promise((resolve, reject) => {
      this._rejectStart = reject;
      this._to = setTimeout(() => reject(new Error('連線逾時，請確認網路後再試一次')), timeoutMs);
      ch.subscribe(async (status) => {
        this.onStatus && this.onStatus(status);
        if (status === 'SUBSCRIBED') {
          clearTimeout(this._to);
          if (this.closed) return reject(new Error('已離開'));
          try { await ch.track({ name: this.name, role: this.role }); } catch { /* 重連時再試 */ }
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(this._to); reject(new Error(status === 'CLOSED' ? '已離開' : `連線失敗（${status}）`));
        }
      });
    });
    this._rejectStart = null;
    if (this.closed) throw new Error('已離開');
    if (this.role === 'guest') {
      // 每秒喊一次，直到房主回應 offer
      const hello = () => { if (!this.hostId && !this.closed) this._send({ t: 'hello', from: this.id, name: this.name }); };
      hello();
      this._helloTimer = setInterval(hello, 1200);
    }
  }

  _send(payload) { try { this.ch.send({ type: 'broadcast', event: 's', payload }); } catch (e) { console.warn(e); } }

  _peer(pid, name) {
    let p = this.peers.get(pid);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    p = { pc, name, rel: null, fast: null, open: false };
    this.peers.set(pid, p);
    // 握手 15 秒還沒通就回收（客人中途離開、answer 掉了），不然會一直佔著名額
    p.timer = setTimeout(() => { if (!p.open && this.peers.get(pid) === p) this._drop(pid, 'link'); }, 15000);
    pc.onicecandidate = (e) => { if (e.candidate) this._send({ t: 'ice', from: this.id, to: pid, c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // disconnected 有時會自己恢復，等 4 秒再判定
        const st = pc.connectionState;
        setTimeout(() => { if (pc.connectionState === st && this.peers.get(pid) === p) this._drop(pid, 'link'); }, st === 'disconnected' ? 4000 : 0);
      }
    };
    const wire = (dc) => {
      dc.onmessage = (e) => { try { this.onData(pid, JSON.parse(e.data)); } catch (err) { console.warn(err); } };
      dc.onopen = () => { p.open = !!(p.rel && p.rel.readyState === 'open' && p.fast && p.fast.readyState === 'open'); if (p.open) this._peersChanged(); };
      dc.onclose = () => { if (this.peers.get(pid) === p) this._drop(pid, 'link'); };
    };
    if (this.role === 'host') {
      p.rel = pc.createDataChannel('rel', { ordered: true });
      p.fast = pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 });
      wire(p.rel); wire(p.fast);
    } else {
      pc.ondatachannel = (e) => { p[e.channel.label] = e.channel; wire(e.channel); };
    }
    p.pending = [];
    return p;
  }

  async _signal(m) {
    if (this.closed || (m.to && m.to !== this.id)) return;
    if (m.t === 'hello' && this.role === 'host') {
      if (!this.accepting) { this._send({ t: 'busy', from: this.id, to: m.from }); return; }
      const old = this.peers.get(m.from);
      if (old && old.open) return;
      if (old) this._drop(m.from, 'link', true);   // 上次握手沒成功（offer 掉了）：重來一次
      if (this.peers.size >= 3) return;   // 最多 4 人
      const p = this._peer(m.from, m.name);
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      this._send({ t: 'offer', from: this.id, to: m.from, sdp: p.pc.localDescription.toJSON(), name: this.name });
    } else if (m.t === 'busy' && this.role === 'guest') {
      this.busy = true;
      this.onBusy && this.onBusy();
    } else if (m.t === 'offer' && this.role === 'guest') {
      if (this.hostId && this.hostId !== m.from) return;
      this.hostId = m.from;
      this.busy = false;
      clearInterval(this._helloTimer);
      const p = this._peer(m.from, m.name);
      await p.pc.setRemoteDescription(m.sdp);
      for (const c of p.pending) await p.pc.addIceCandidate(c).catch(() => {});
      p.pending = [];
      const ans = await p.pc.createAnswer();
      await p.pc.setLocalDescription(ans);
      this._send({ t: 'answer', from: this.id, to: m.from, sdp: p.pc.localDescription.toJSON() });
    } else if (m.t === 'answer' && this.role === 'host') {
      const p = this.peers.get(m.from);
      if (!p) return;
      await p.pc.setRemoteDescription(m.sdp);
      for (const c of p.pending) await p.pc.addIceCandidate(c).catch(() => {});
      p.pending = [];
    } else if (m.t === 'ice') {
      const p = this.peers.get(m.from);
      if (!p) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.c).catch(() => {});
      else p.pending.push(m.c);
    }
  }

  _drop(pid, why = 'link', quiet = false) {
    const p = this.peers.get(pid);
    if (!p) return;
    this.peers.delete(pid);
    clearTimeout(p.timer);
    try { p.pc.close(); } catch { /* 已關 */ }
    if (!quiet && !this.closed) this.onClose && this.onClose(pid, why);
    this._peersChanged();
  }

  _peersChanged() {
    this.onPeers && this.onPeers([...this.peers.entries()].filter(([, p]) => p.open).map(([id, p]) => ({ id, name: p.name })));
  }

  send(pid, msg, reliable = true) {
    const p = this.peers.get(pid);
    const dc = p && (reliable ? p.rel : p.fast);
    if (!dc || dc.readyState !== 'open') return;
    if (!reliable && dc.bufferedAmount > 64 * 1024) return;   // 塞車就丟這一包快照
    try { dc.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) { console.warn(e); }
  }

  broadcast(msg, reliable = true) {
    const s = JSON.stringify(msg);
    for (const pid of this.peers.keys()) this.send(pid, s, reliable);
  }

  close() {
    this.closed = true;
    clearInterval(this._helloTimer);
    clearTimeout(this._to);
    if (this._rejectStart) { this._rejectStart(new Error('已離開')); this._rejectStart = null; }
    // 房主正常離開：先跟每個人說再見（客人才分得出是「房主走了」還是「網路斷了」），稍等再關連線讓這包送得出去
    const peers = [...this.peers.values()];
    if (this.role === 'host') for (const p of peers) { try { if (p.rel && p.rel.readyState === 'open') p.rel.send('{"t":"bye"}'); } catch { /* 已關 */ } }
    for (const p of peers) clearTimeout(p.timer);
    setTimeout(() => { for (const p of peers) { try { p.pc.close(); } catch { /* 已關 */ } } }, this.role === 'host' ? 300 : 0);
    this.peers.clear();
    try { if (this.ch && this.client) this.client.removeChannel(this.ch); } catch { /* 已關 */ }
    this.ch = null;
  }
}

// 同一台電腦、同一個瀏覽器的兩個分頁（測試用，網址加 ?net=bc）：用 BroadcastChannel 模擬同樣的介面
export class LocalLink {
  constructor({ room, id, name, role, onPeers, onData, onClose, onStatus, onBusy }) {
    Object.assign(this, { room, id, name, role, onPeers, onData, onClose, onStatus, onBusy });
    this.peers = new Map();
    this.closed = false;
    this.accepting = true;
  }

  async start() {
    this.bc = new BroadcastChannel(`rt-${this.room}`);
    this.bc.onmessage = (e) => this._msg(e.data);
    this.onStatus && this.onStatus('SUBSCRIBED');
    if (this.role === 'guest') {
      const hello = () => { if (!this.hostId && !this.closed) this.bc.postMessage({ t: 'hello', from: this.id, name: this.name }); };
      hello();
      this._helloTimer = setInterval(hello, 400);
    }
  }

  _msg(m) {
    if (this.closed || (m.to && m.to !== this.id)) return;
    if (m.t === 'hello' && this.role === 'host') {
      if (!this.accepting) { this.bc.postMessage({ t: 'busy', from: this.id, to: m.from }); return; }
      if (this.peers.has(m.from) || this.peers.size >= 3) return;
      this.peers.set(m.from, { name: m.name, open: true });
      this.bc.postMessage({ t: 'welcome', from: this.id, to: m.from, name: this.name });
      this._peersChanged();
    } else if (m.t === 'welcome' && this.role === 'guest') {
      if (this.hostId) return;
      this.hostId = m.from;
      clearInterval(this._helloTimer);
      this.peers.set(m.from, { name: m.name, open: true });
      this._peersChanged();
    } else if (m.t === 'busy' && this.role === 'guest') {
      this.busy = true; this.onBusy && this.onBusy();
    } else if (m.t === 'data') {
      if (!this.peers.has(m.from)) return;
      try { this.onData(m.from, JSON.parse(m.d)); } catch (err) { console.warn(err); }
    } else if (m.t === 'leave') {
      if (this.peers.delete(m.from)) { this.onClose && this.onClose(m.from, 'left'); this._peersChanged(); }
    }
  }

  _peersChanged() { this.onPeers && this.onPeers([...this.peers.entries()].map(([id, p]) => ({ id, name: p.name }))); }
  send(pid, msg) { if (!this.closed && this.peers.has(pid)) this.bc.postMessage({ t: 'data', from: this.id, to: pid, d: typeof msg === 'string' ? msg : JSON.stringify(msg) }); }
  broadcast(msg) { const s = JSON.stringify(msg); for (const pid of this.peers.keys()) this.send(pid, s); }
  close() {
    if (this.closed) return;
    try { this.bc.postMessage({ t: 'leave', from: this.id }); } catch { /* 已關 */ }
    this.closed = true;
    clearInterval(this._helloTimer);
    setTimeout(() => { try { this.bc.close(); } catch { /* 已關 */ } }, 50);
  }
}
