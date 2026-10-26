// 合成音效（不用音檔）：玩具感的短促聲音；依 x 位置左右聲道。
export class Sfx {
  constructor() { this.ctx = null; this.on = true; this.last = new Map(); }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  out(x, vol = 1) {
    const c = this.ctx;
    const g = c.createGain(); g.gain.value = vol;
    if (x != null && c.createStereoPanner) {
      const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, (x / 20) * 2 - 1)) * 0.6;
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  noiseHit(out, t0, dur, type, f0, f1, q = 1, a = 0.6) {
    const c = this.ctx;
    const src = c.createBufferSource(); src.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t0); f.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(a, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.02);
  }

  tone(out, t0, dur, type, f0, f1, a = 0.5) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(a, t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(out);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  play(kind, x = null, k = 1) {
    if (!this.on || !this.ctx || this.ctx.state !== 'running') return;
    // 同一種聲音太密就略過（爆炸連鎖、一堆炮彈同時反彈）
    const now = this.ctx.currentTime, gap = { bounce: 0.03, pop: 0.03, tread: 0.08 }[kind] || 0.01;
    if (now - (this.last.get(kind) || 0) < gap) return;
    this.last.set(kind, now);
    const t = now;
    switch (kind) {
      case 'fire': { const o = this.out(x, 0.8 * k); this.tone(o, t, 0.09, 'square', 320, 90, 0.18); this.noiseHit(o, t, 0.12, 'lowpass', 2800, 500, 0.8, 0.55); this.tone(o, t, 0.14, 'sine', 140, 55, 0.6); break; }
      case 'rocket': { const o = this.out(x, 0.8); this.noiseHit(o, t, 0.35, 'bandpass', 900, 3200, 1.2, 0.5); this.tone(o, t, 0.12, 'sine', 160, 60, 0.6); break; }
      case 'scatter': { const o = this.out(x, 0.8); for (let i = 0; i < 3; i++) this.noiseHit(o, t + i * 0.018, 0.08, 'lowpass', 3200, 700, 0.8, 0.45); this.tone(o, t, 0.12, 'sine', 150, 60, 0.5); break; }
      case 'blast': { const o = this.out(x, 0.8); this.tone(o, t, 0.18, 'sine', 110, 45, 0.8); this.noiseHit(o, t, 0.15, 'lowpass', 1200, 300, 0.7, 0.5); break; }
      case 'bounce': { const o = this.out(x, 0.5); this.tone(o, t, 0.06, 'triangle', 1500, 900, 0.22); this.noiseHit(o, t, 0.03, 'highpass', 4000, 2500, 0.7, 0.2); break; }
      case 'pop': { const o = this.out(x, 0.5); this.noiseHit(o, t, 0.08, 'bandpass', 1800, 600, 1.4, 0.4); break; }
      case 'clash': { const o = this.out(x, 0.7); this.tone(o, t, 0.12, 'triangle', 1900, 1200, 0.25); this.noiseHit(o, t, 0.1, 'highpass', 3000, 1500, 0.8, 0.4); break; }
      case 'boom': { const o = this.out(x, 1.1); this.tone(o, t, 0.6, 'sine', 90, 30, 1); this.noiseHit(o, t, 0.7, 'lowpass', 2600, 140, 0.6, 0.9); break; }
      case 'die': { const o = this.out(x, 1.1); this.tone(o, t, 0.5, 'sine', 110, 36, 1); this.noiseHit(o, t, 0.55, 'lowpass', 3200, 160, 0.6, 0.85); this.tone(o, t + 0.02, 0.3, 'square', 260, 70, 0.12); break; }
      case 'mine': { const o = this.out(x, 0.5); this.tone(o, t, 0.07, 'square', 880, 860, 0.12); this.tone(o, t + 0.09, 0.07, 'square', 660, 650, 0.12); break; }
      case 'arm': { const o = this.out(x, 0.6); for (let i = 0; i < 3; i++) this.tone(o, t + i * 0.1, 0.05, 'square', 1320, 1300, 0.12); break; }
      case 'armor': { const o = this.out(x, 0.8); this.tone(o, t, 0.22, 'triangle', 1700, 1500, 0.3); this.tone(o, t, 0.25, 'square', 420, 380, 0.08); this.noiseHit(o, t, 0.08, 'highpass', 5000, 3000, 0.8, 0.35); break; }
      case 'warp': { const o = this.out(x, 0.5); this.tone(o, t, 0.22, 'sine', 300, 1400, 0.22); this.tone(o, t + 0.05, 0.2, 'triangle', 600, 1800, 0.08); break; }
      case 'found': { const o = this.out(null, 0.5); [784, 988, 1319].forEach((f, i) => this.tone(o, t + i * 0.08, 0.2, 'triangle', f, f, 0.24)); break; }
      case 'empty': { const o = this.out(x, 0.4); this.tone(o, t, 0.05, 'square', 200, 180, 0.1); break; }
      case 'go': { const o = this.out(null, 0.6); this.tone(o, t, 0.12, 'triangle', 660, 660, 0.3); this.tone(o, t + 0.13, 0.22, 'triangle', 990, 990, 0.32); break; }
      case 'clear': { const o = this.out(null, 0.6); [523, 659, 784, 1047].forEach((f, i) => this.tone(o, t + i * 0.1, 0.32, 'triangle', f, f, 0.3)); break; }
      case 'fail': { const o = this.out(null, 0.6); [392, 330, 262].forEach((f, i) => this.tone(o, t + i * 0.16, 0.34, 'triangle', f, f * 0.97, 0.3)); break; }
      case 'win': { const o = this.out(null, 0.7); [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(o, t + i * 0.09, 0.4, 'triangle', f, f, 0.3)); break; }
      case 'tap': { const o = this.out(null, 0.35); this.tone(o, t, 0.04, 'triangle', 1200, 1000, 0.18); break; }
      case 'select': { const o = this.out(null, 0.35); this.tone(o, t, 0.05, 'triangle', 900, 900, 0.16); this.tone(o, t + 0.05, 0.06, 'triangle', 1350, 1350, 0.16); break; }
      default:
    }
  }
}
