// 天空背景（旅ことば系列的「暮色玻璃」，英文版 Street Talk 換一套顏色，2026-10-03 使用者在 A–D 四組裡選 A「夕陽公路」）：
// 淺色＝ShaderGradient 的 Sunset（#ff7a33 橘、#33a0ff 天藍、#ffc53d 金：加州夕陽、66 號公路）、深色＝Nighty night（#606080 灰藍、#8d7dca 薰衣草、#212121 炭黑）。
// 畫法仿 ShaderGradient 的 plane：一片被雜訊推起波浪的面，顏色沿斜向漸層、跟著波浪起伏，再加一點受光的明暗與顆粒。
// 自己寫的著色器（ShaderGradient 本身要 React＋three.js，離線 App 不帶），省電做法同旅ことば：
// 半解析度算圖、每秒 10 格、捲動或拖字卡時先不重畫、App 在背景時停、減少動態效果時只畫一格。
// API 與旅ことば相同：initSky、setSkyMode、sunrise（開場）、sunriseDone。

export const PALETTES = {
  day: { c: ['#ff7a33', '#33a0ff', '#ffc53d'], b: 1.0 },
  dusk: { c: ['#606080', '#8d7dca', '#212121'], b: 0.8 },
  night: { c: ['#1b1b2e', '#2a2440', '#000000'], b: 0.6 },
};

export const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_t;
uniform vec3 u_c[3];
uniform float u_b;        // 亮度（ShaderGradient 的 brightness）
uniform float u_sun;      // 開場的暖光 0..1
uniform float u_sunY;     // 暖光高度（0＝畫面底，1＝頂）
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
float height(vec2 p, float t) {
  float n = fbm(p * 1.15 + vec2(t, -0.7 * t));
  return n * 0.7 + fbm(p * 2.1 - vec2(0.5 * t, 0.3 * t) + n) * 0.3;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float asp = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * asp, uv.y);
  float t = u_t * 0.05;
  float h = height(p, t);
  // 顏色沿斜向漸層（左下→右上），被波浪推著起伏
  float g = clamp(0.08 + uv.y * 0.8 + (uv.x - 0.5) * 0.28 + (h - 0.5) * 1.1, 0.0, 1.0);
  vec3 col = mix(u_c[0], u_c[1], smoothstep(0.0, 0.52, g));
  col = mix(col, u_c[2], smoothstep(0.42, 1.0, g));
  // 受光：波浪朝左上的那一面亮、背面暗（ShaderGradient 的稜線感）
  float hx = height(p + vec2(0.012, 0.0), t) - h, hy = height(p + vec2(0.0, 0.012), t) - h;
  float lit = clamp(0.5 - (hx - hy) * 14.0, 0.0, 1.0);
  col *= mix(0.9, 1.1, lit) * u_b;
  // 開場的暖光從畫面下方升起
  vec2 sd = (uv - vec2(0.5, u_sunY)) * vec2(asp, 1.0);
  col = mix(col, vec3(1.0, 0.72, 0.5), exp(-dot(sd, sd) * 7.0) * u_sun * 0.8) + vec3(1.0, 0.45, 0.2) * exp(-dot(sd, sd) * 60.0) * u_sun * 0.45;
  col += (hash(gl_FragCoord.xy) - 0.5) * 0.045;   // 顆粒（ShaderGradient 的 grain），靜態
  gl_FragColor = vec4(col, 1.0);
}`;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toHex = (c) => '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
const mixP = (a, b, k) => ({ c: a.c.map((c, i) => hex(c).map((v, j) => v + (hex(b.c[i])[j] - v) * k)), b: a.b + (b.b - a.b) * k });

let gl, prog, U, canvas, raf = 0, last = 0, t0 = 0;
let target = PALETTES.day, from = PALETTES.night, blend = 1, sun = 0, sunY = -0.2;
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const SCALE = 0.5;     // 算圖解析度（相對於螢幕的 CSS 像素）

function resize() {
  const w = Math.max(2, Math.round(innerWidth * SCALE)), h = Math.max(2, Math.round(innerHeight * SCALE));
  canvas.width = w; canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.uniform2f(U.res, w, h);
}

function draw(ms) {
  const p = mixP(from, target, blend);
  gl.uniform1f(U.t, reduce.matches ? 40 : (ms - t0) / 1000 + 40);
  gl.uniform3fv(U.c, new Float32Array(p.c.flat()));
  gl.uniform1f(U.b, p.b);
  gl.uniform1f(U.sun, sun);
  gl.uniform1f(U.sunY, sunY);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// 波浪流動得很慢，每秒 10 格就看不出差別；捲動或拖曳字卡時先不重畫（玻璃面板的背景模糊才不用每格重算）
let quietUntil = 0;
const hush = () => { quietUntil = performance.now() + 300; };
addEventListener('scroll', hush, { passive: true, capture: true });
addEventListener('touchmove', hush, { passive: true });
function loop(ms) {
  raf = 0;
  if (document.hidden) return;
  if (ms - last >= 100 && ms > quietUntil) { last = ms; draw(ms); }
  if (!reduce.matches) raf = requestAnimationFrame(loop);
}
const kick = () => { if (!raf && gl) raf = requestAnimationFrame(loop); };

export function initSky(el, dark) {
  canvas = el;
  target = dark ? PALETTES.dusk : PALETTES.day;
  gl = canvas.getContext('webgl', { antialias: false, depth: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return fallback(dark);
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
  } catch (e) { gl = null; return fallback(dark); }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  U = { res: gl.getUniformLocation(prog, 'u_res'), t: gl.getUniformLocation(prog, 'u_t'), c: gl.getUniformLocation(prog, 'u_c'),
    b: gl.getUniformLocation(prog, 'u_b'), sun: gl.getUniformLocation(prog, 'u_sun'), sunY: gl.getUniformLocation(prog, 'u_sunY') };
  t0 = performance.now();
  resize();
  addEventListener('resize', () => { resize(); draw(performance.now()); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
  draw(t0);
  kick();
  return true;
}

// 不支援 WebGL：用 CSS 漸層代替（不會動）
function fallback(dark) {
  const [a, b, c] = (dark ? PALETTES.dusk : PALETTES.day).c;
  canvas.style.background = dark
    ? `radial-gradient(120% 70% at 20% 100%, ${a}, transparent 65%), radial-gradient(110% 60% at 80% 55%, ${b}99, transparent 60%), ${c}`
    : `radial-gradient(120% 70% at 15% 100%, ${a}, transparent 60%), radial-gradient(120% 80% at 70% 50%, ${b}, transparent 65%), ${c}`;
  return false;
}

// 深淺色切換：天空在 0.8 秒內轉過去
export function setSkyMode(dark) {
  const next = dark ? PALETTES.dusk : PALETTES.day;
  if (next === target) return;
  if (!gl) return fallback(dark);
  const cur = mixP(from, target, blend);
  from = { c: cur.c.map(toHex), b: cur.b };
  target = next; blend = 0;
  const start = performance.now();
  const step = (ms) => { blend = Math.min(1, (ms - start) / 800); draw(ms); if (blend < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}

// 開場：p＝0 夜色、暖光在畫面下；p＝1 Sunset（或 Nighty night），暖光升到中間後散開
export function sunrise(p) {
  if (!gl) return;
  from = PALETTES.night;
  const e = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  blend = e;
  sunY = -0.25 + 0.75 * e;
  sun = Math.sin(Math.min(1, p) * Math.PI) * 0.9;
  draw(performance.now());
}
export function sunriseDone() { sun = 0; blend = 1; if (gl) draw(performance.now()); }
export const skyReady = () => !!gl;
