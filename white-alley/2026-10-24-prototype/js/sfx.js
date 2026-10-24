// 合成音效（不用音檔）：依距離衰減、依方位左右聲道。
export class Sfx {
  constructor() { this.ctx = null; this.on = true; this.listener = { x: 0, z: 0, yaw: 0 }; }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  // 世界座標的音源 → 音量與左右
  _out(x, z, vol = 1, range = 45) {
    const c = this.ctx;
    const L = this.listener;
    let g = vol, pan = 0;
    if (x != null) {
      const dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz);
      g *= Math.max(0, 1 - d / range) ** 1.6;
      // 聽者右方 = (cos yaw, -sin yaw)
      if (d > 0.5) pan = Math.max(-1, Math.min(1, (dx * Math.cos(L.yaw) - dz * Math.sin(L.yaw)) / d)) * 0.8;
    }
    const gain = c.createGain(); gain.gain.value = g;
    const p = c.createStereoPanner ? c.createStereoPanner() : null;
    if (p) { p.pan.value = pan; gain.connect(p); p.connect(this.master); } else gain.connect(this.master);
    return { node: gain, g };
  }

  _noise(out, t0, dur, type, f0, f1, q = 1, a = 0.6) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(a, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.02);
  }

  _tone(out, t0, dur, type, f0, f1, a = 0.5) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(a, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  play(kind, x = null, z = null, k = 1) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = (v, r) => this._out(x, z, v, r);
    switch (kind) {
      case 'throw': { const { node, g } = o(0.5 * k, 35); if (g > 0.01) this._noise(node, t, 0.22, 'bandpass', 500, 2600, 1.4, 0.7); break; }
      case 'wall': { const { node, g } = o(0.9 * k, 50); if (g > 0.01) { this._noise(node, t, 0.07, 'lowpass', 2600, 700, 0.8, 0.8); this._tone(node, t, 0.09, 'sine', 210, 90, 0.5); } break; }
      case 'ground': { const { node, g } = o(0.5 * k, 35); if (g > 0.01) this._noise(node, t, 0.09, 'lowpass', 900, 300, 0.7, 0.6); break; }
      case 'roof': { const { node, g } = o(0.6 * k, 45); if (g > 0.01) { this._noise(node, t, 0.05, 'highpass', 1800, 900, 0.7, 0.4); this._tone(node, t, 0.05, 'triangle', 700, 400, 0.25); } break; }
      case 'hit': { const { node } = o(1, 60); this._tone(node, t, 0.16, 'sine', 120, 55, 0.9); this._noise(node, t, 0.08, 'lowpass', 1400, 300, 0.7, 0.6); break; }
      case 'head': { const { node } = o(1, 70); this._tone(node, t, 0.12, 'triangle', 1100, 700, 0.5); this._tone(node, t, 0.18, 'sine', 140, 60, 0.8); break; }
      case 'hitmark': { const { node } = o(0.5); this._tone(node, t, 0.06, 'square', 1500, 1300, 0.15); break; }
      case 'hurt': { const { node } = o(1); this._tone(node, t, 0.25, 'sine', 90, 40, 1); this._noise(node, t, 0.15, 'lowpass', 600, 120, 0.7, 0.7); break; }
      case 'ko': { const { node } = o(0.8); this._tone(node, t, 0.5, 'triangle', 520, 130, 0.4); break; }
      case 'win': { const { node } = o(0.7); [523, 659, 784].forEach((f, i) => this._tone(node, t + i * 0.09, 0.3, 'triangle', f, f, 0.35)); break; }
      case 'pickup': { const { node, g } = o(0.6, 25); if (g > 0.01) { this._tone(node, t, 0.05, 'triangle', 2400, 2300, 0.25); this._tone(node, t + 0.06, 0.06, 'triangle', 3100, 3000, 0.25); } break; }
      case 'step': { const { node } = o(0.12 * k); this._noise(node, t, 0.05, 'lowpass', 700, 250, 0.7, 0.5); break; }
      case 'empty': { const { node } = o(0.4); this._tone(node, t, 0.05, 'square', 220, 200, 0.1); break; }
      // ---- 武器 ----
      case 'boom': {   // 爆炸：低頻悶響＋寬頻碎裂，遠處只剩悶響
        const { node, g } = o(1.2, 90);
        if (g > 0.01) { this._tone(node, t, 0.55, 'sine', 95, 32, 1); this._noise(node, t, 0.7, 'lowpass', 3200, 160, 0.6, 0.9); this._noise(node, t + 0.02, 0.25, 'bandpass', 900, 300, 0.8, 0.5); }
        break;
      }
      case 'shot': {   // 槍聲：清脆的爆裂＋尾音
        const { node, g } = o(1, 80);
        if (g > 0.01) { this._noise(node, t, 0.05, 'highpass', 3500, 1800, 0.7, 0.9); this._noise(node, t, 0.32, 'lowpass', 2400, 220, 0.6, 0.55); this._tone(node, t, 0.08, 'square', 180, 60, 0.25); }
        break;
      }
      case 'swing': {  // 光劍揮砍：嗡聲往下滑＋風切
        const { node, g } = o(0.7, 40);
        if (g > 0.01) { this._tone(node, t, 0.24, 'sawtooth', 180, 95, 0.18); this._tone(node, t, 0.24, 'sine', 360, 190, 0.3); this._noise(node, t, 0.2, 'bandpass', 2600, 700, 1.6, 0.5); }
        break;
      }
      case 'clash': {  // 擋下：金屬撞擊的幾個不和諧泛音
        const { node, g } = o(0.8 * k, 55);
        if (g > 0.01) { [1180, 1730, 2390].forEach((f) => this._tone(node, t, 0.35, 'triangle', f, f * 0.97, 0.18)); this._noise(node, t, 0.06, 'highpass', 5000, 3000, 0.7, 0.6); }
        break;
      }
      case 'lunge': { const { node, g } = o(0.6, 35); if (g > 0.01) this._noise(node, t, 0.28, 'bandpass', 400, 2400, 1.2, 0.6); break; }
      case 'meow': {   // 貓叫：鋸齒波經過兩個共振峰，音高先升後降
        const { node, g } = o(0.45 * k, 30);
        if (g > 0.01) {
          const c = this.ctx, osc = c.createOscillator(), f1 = c.createBiquadFilter(), f2 = c.createBiquadFilter(), gg = c.createGain();
          const base = 520 + Math.random() * 160;
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(base * 0.8, t); osc.frequency.linearRampToValueAtTime(base * 1.25, t + 0.12); osc.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.42);
          f1.type = 'bandpass'; f1.Q.value = 6; f1.frequency.setValueAtTime(900, t); f1.frequency.linearRampToValueAtTime(1600, t + 0.15); f1.frequency.linearRampToValueAtTime(800, t + 0.42);
          f2.type = 'bandpass'; f2.Q.value = 8; f2.frequency.value = 2900;
          gg.gain.setValueAtTime(0.0001, t); gg.gain.exponentialRampToValueAtTime(0.9, t + 0.04); gg.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
          osc.connect(f1); osc.connect(f2); f1.connect(gg); f2.connect(gg); gg.connect(node);
          osc.start(t); osc.stop(t + 0.5);
        }
        break;
      }
      case 'bite': { const { node, g } = o(0.8, 40); if (g > 0.01) { this._noise(node, t, 0.06, 'bandpass', 1800, 900, 2, 0.7); this._noise(node, t + 0.08, 0.06, 'bandpass', 1500, 700, 2, 0.6); } break; }
      case 'whirr': {  // 回力鏢：一陣一陣的風切
        const { node, g } = o(0.5, 35);
        if (g > 0.01) for (let i = 0; i < 4; i++) this._noise(node, t + i * 0.07, 0.07, 'bandpass', 1300 - i * 120, 900, 2.5, 0.45 - i * 0.07);
        break;
      }
      case 'catch': { const { node } = o(0.5); this._noise(node, t, 0.05, 'lowpass', 1200, 400, 0.8, 0.5); this._tone(node, t, 0.06, 'triangle', 600, 500, 0.15); break; }
      case 'reload': { const { node } = o(0.5); this._tone(node, t, 0.04, 'square', 900, 700, 0.12); this._noise(node, t + 0.05, 0.05, 'highpass', 2500, 1500, 0.8, 0.3); break; }
      case 'reloaded': { const { node } = o(0.6); this._tone(node, t, 0.04, 'square', 700, 650, 0.14); this._tone(node, t + 0.09, 0.05, 'square', 1100, 1000, 0.14); break; }
      case 'pin': { const { node, g } = o(0.4, 20); if (g > 0.01) this._tone(node, t, 0.05, 'triangle', 2600, 2000, 0.15); break; }
      default:
    }
  }
}
