// 真人連線：房主手機跑模擬，其他人用 WebRTC 資料通道點對點連到房主（星狀）。
// Supabase Realtime 只在開始時交換連線資訊（房號 → offer／answer／ICE），遊戲中的資料不經過伺服器。
// 每條連線兩個通道：rel（可靠、有序：開局、事件）、fast（不重送、不排序：輸入、快照）。
import { ICE, SUPABASE } from './netconfig.js';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const genRoomCode = () => Array.from({ length: 4 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
export const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export const newId = () => Math.random().toString(36).slice(2, 10);

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.supabase) return res();
    const s = document.createElement('script');
    s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('無法載入連線元件'));
    document.head.appendChild(s);
  });
}

export class P2P {
  // role: 'host' | 'guest'；onPeers(list)、onData(peerId, msg)、onClose(peerId)
  constructor({ room, id, name, role, onPeers, onData, onClose, onStatus }) {
    Object.assign(this, { room, id, name, role, onPeers, onData, onClose, onStatus });
    this.peers = new Map();   // peerId → { pc, rel, fast, name, open }
    this.closed = false;
    this.accepting = true;    // 房主開局後不再收新人
  }

  async start(timeoutMs = 10000) {
    await loadScript('vendor/supabase.js');
    this.client = window.supabase.createClient(SUPABASE.url, SUPABASE.key, {
      realtime: { params: { eventsPerSecond: 20 } },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const ch = (this.ch = this.client.channel(`wa-${this.room}`, { config: { broadcast: { self: false, ack: false }, presence: { key: this.id } } }));
    ch.on('broadcast', { event: 's' }, ({ payload }) => this._signal(payload).catch((e) => console.warn('signal', e)));
    ch.on('presence', { event: 'sync' }, () => {
      const st = ch.presenceState();
      this.presence = Object.entries(st).map(([id, arr]) => ({ id, ...(arr[arr.length - 1] || {}) }));
      // 客人：房主不在了就結束
      if (this.role === 'guest' && this.hostId && !this.presence.some((p) => p.id === this.hostId) && this._sawHost) this.onClose && this.onClose(this.hostId);
      if (this.role === 'guest' && this.presence.some((p) => p.role === 'host')) this._sawHost = true;
    });
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('連線逾時，請確認網路後再試一次')), timeoutMs);
      ch.subscribe(async (status) => {
        this.onStatus && this.onStatus(status);
        if (status === 'SUBSCRIBED') {
          clearTimeout(to);
          try { await ch.track({ name: this.name, role: this.role }); } catch { /* 重連時再試 */ }
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(to); reject(new Error(`連線失敗（${status}）`)); }
      });
    });
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
    pc.onicecandidate = (e) => { if (e.candidate) this._send({ t: 'ice', from: this.id, to: pid, c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) {
        // disconnected 有時會自己恢復，等 4 秒再判定
        const st = pc.connectionState;
        setTimeout(() => { if (pc.connectionState === st && this.peers.get(pid) === p) this._drop(pid); }, st === 'disconnected' ? 4000 : 0);
      }
    };
    const wire = (dc) => {
      dc.onmessage = (e) => { try { this.onData(pid, JSON.parse(e.data)); } catch (err) { console.warn(err); } };
      dc.onopen = () => { p.open = !!(p.rel && p.rel.readyState === 'open' && p.fast && p.fast.readyState === 'open'); if (p.open) this._peersChanged(); };
      dc.onclose = () => this._drop(pid);
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
      if (!this.accepting || this.peers.has(m.from) || this.peers.size >= 7) return;
      const p = this._peer(m.from, m.name);
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      this._send({ t: 'offer', from: this.id, to: m.from, sdp: p.pc.localDescription.toJSON(), name: this.name });
    } else if (m.t === 'offer' && this.role === 'guest') {
      if (this.hostId && this.hostId !== m.from) return;
      this.hostId = m.from;
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

  _drop(pid) {
    const p = this.peers.get(pid);
    if (!p) return;
    this.peers.delete(pid);
    try { p.pc.close(); } catch { /* 已關 */ }
    this.onClose && this.onClose(pid);
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
    for (const pid of [...this.peers.keys()]) { const p = this.peers.get(pid); try { p.pc.close(); } catch { /* 已關 */ } }
    this.peers.clear();
    try { this.ch && this.ch.unsubscribe(); } catch { /* 已關 */ }
    try { this.client && this.client.removeAllChannels(); } catch { /* 已關 */ }
  }
}
