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
      default:
    }
  }
}
