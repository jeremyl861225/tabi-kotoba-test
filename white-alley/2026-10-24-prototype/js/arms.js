// 武器與貓的模型：第一人稱手持、第三人稱拿在手上、飛行中的投射物都從這裡長出來。
// 全部是幾何體拼起來再併成一個有頂點色的網格（一件東西一次繪製）。
import * as THREE from 'three';

const C = (h) => new THREE.Color(h);
const INK = C(0x2d2f34), METAL = C(0xb9bdc4), LIGHT = C(0xe9eaec), MID = C(0x8c9098);
export const CAT_COLS = [0xe2985a, 0x8e9299, 0x34353a, 0xb07a4f];   // 橘、灰、黑、咖啡（一個馴獸師一種顏色）

// 幾個幾何體（各自的位置與顏色）併成一個有頂點色的 BufferGeometry
export function merge(parts) {
  const pos = [], nor = [], col = [];
  const m = new THREE.Matrix4();
  for (const [geo, at, color] of parts) {
    const g = (geo.index ? geo.toNonIndexed() : geo).applyMatrix4(m.makeTranslation(at[0], at[1], at[2]));
    const p = g.attributes.position, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      col.push(color.r, color.g, color.b);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

export const vcMat = () => new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });

// 手榴彈：卵形彈體＋兩道溝＋引信、握片、拉環（原點在彈體中心）
export function grenadeGeo() {
  const body = C(0x5f6a58);
  return merge([
    [new THREE.SphereGeometry(0.06, 14, 10).scale(1, 1.16, 1), [0, 0, 0], body],
    [new THREE.TorusGeometry(0.0605, 0.0045, 5, 22).rotateX(Math.PI / 2), [0, 0.022, 0], INK],
    [new THREE.TorusGeometry(0.0585, 0.0045, 5, 22).rotateX(Math.PI / 2), [0, -0.026, 0], INK],
    [new THREE.CylinderGeometry(0.021, 0.025, 0.03, 10), [0, 0.078, 0], METAL],
    [new THREE.BoxGeometry(0.013, 0.08, 0.022).rotateZ(-0.22), [0.032, 0.045, 0], METAL],
    [new THREE.TorusGeometry(0.015, 0.0032, 5, 12).rotateY(Math.PI / 2), [-0.03, 0.094, 0], METAL],
  ]);
}

// 蜷成一球的貓（被丟出去的樣子）
export function catballGeo(col) {
  const fur = C(col), dark = fur.clone().multiplyScalar(0.62), pink = C(0xe9a8a1);
  const ear = (x) => [new THREE.ConeGeometry(0.028, 0.05, 4).rotateZ(x > 0 ? -0.4 : 0.4).rotateY(Math.PI / 4), [x, 0.11, -0.05], fur];
  return merge([
    [new THREE.SphereGeometry(0.105, 14, 10).scale(1, 0.86, 1.06), [0, 0, 0], fur],
    [new THREE.SphereGeometry(0.06, 12, 9), [0, 0.05, -0.075], fur],
    ear(0.034), ear(-0.034),
    [new THREE.TorusGeometry(0.098, 0.02, 6, 18, Math.PI * 1.25).rotateX(Math.PI / 2).rotateY(0.6), [0, -0.035, 0], dark],
    [new THREE.SphereGeometry(0.012, 6, 4), [0, 0.04, -0.134], pink],
    [new THREE.BoxGeometry(0.02, 0.004, 0.004), [0.022, 0.062, -0.128], INK],
    [new THREE.BoxGeometry(0.02, 0.004, 0.004), [-0.022, 0.062, -0.128], INK],
  ]);
}

// 回力鏢：兩翼夾 105°，翼尖漆深色（原點在轉角）
export function boomGeo() {
  const wood = C(0xc99b63), dark = C(0x6c4a2c);
  const wing = (a, len, w, x0, col) => { const g = new THREE.BoxGeometry(len, 0.014, w); g.translate(x0 + len / 2, 0, 0); g.rotateY(a); return [g, [0, 0, 0], col]; };
  return merge([
    wing(0.92, 0.27, 0.058, 0, wood), wing(-0.92, 0.27, 0.058, 0, wood),
    wing(0.92, 0.05, 0.06, 0.235, dark), wing(-0.92, 0.05, 0.06, 0.235, dark),
    [new THREE.CylinderGeometry(0.036, 0.036, 0.0142, 14), [0, 0, 0], wood],
  ]);
}

// 步槍：白色槍身＋墨色護木、槍管、瞄準鏡；槍口朝 −z，原點在握把（彈匣另外給，換彈時要掉下來）
export function rifleGeo(withMag = true) {
  const parts = [
    [new THREE.BoxGeometry(0.05, 0.072, 0.34), [0, 0.058, -0.08], LIGHT],
    [new THREE.BoxGeometry(0.052, 0.012, 0.3), [0, 0.098, -0.08], MID],
    [new THREE.BoxGeometry(0.044, 0.058, 0.2), [0, 0.052, -0.34], INK],
    [new THREE.CylinderGeometry(0.011, 0.011, 0.26, 10).rotateX(Math.PI / 2), [0, 0.064, -0.57], INK],
    [new THREE.CylinderGeometry(0.017, 0.016, 0.055, 10).rotateX(Math.PI / 2), [0, 0.064, -0.72], INK],
    [new THREE.BoxGeometry(0.04, 0.095, 0.17), [0, 0.04, 0.17], LIGHT],
    [new THREE.BoxGeometry(0.044, 0.11, 0.025), [0, 0.03, 0.265], INK],
    [new THREE.BoxGeometry(0.032, 0.1, 0.044).rotateX(0.32), [0, -0.025, 0.02], INK],
    [new THREE.CylinderGeometry(0.019, 0.019, 0.16, 12).rotateX(Math.PI / 2), [0, 0.128, -0.1], INK],
    [new THREE.CylinderGeometry(0.026, 0.021, 0.036, 12).rotateX(Math.PI / 2), [0, 0.128, -0.196], INK],
    [new THREE.CylinderGeometry(0.023, 0.02, 0.03, 12).rotateX(Math.PI / 2), [0, 0.128, -0.006], INK],
    [new THREE.BoxGeometry(0.014, 0.028, 0.018), [0, 0.104, -0.15], MID],
    [new THREE.BoxGeometry(0.014, 0.028, 0.018), [0, 0.104, -0.04], MID],
    [new THREE.BoxGeometry(0.02, 0.022, 0.055), [0.032, 0.05, -0.36], MID],
    [new THREE.SphereGeometry(0.0075, 6, 4), [0.032, 0.05, -0.39], C(0xff3b30)],
  ];
  if (withMag) parts.push(magPart());
  return merge(parts);
}
const magPart = () => [new THREE.BoxGeometry(0.028, 0.11, 0.058).rotateX(-0.22), [0, -0.035, -0.125], INK];
export const magGeo = () => merge([magPart()]);
export const RIFLE_MUZZLE = new THREE.Vector3(0, 0.064, -0.75);

// 光劍：金屬劍柄（劍刃往 +y），刃另外做（要發光、會變色）
export function hiltGeo() {
  const parts = [
    [new THREE.CylinderGeometry(0.017, 0.019, 0.17, 14), [0, 0, 0], METAL],
    [new THREE.CylinderGeometry(0.024, 0.018, 0.035, 14), [0, 0.1, 0], METAL],
    [new THREE.CylinderGeometry(0.02, 0.02, 0.02, 14), [0, -0.093, 0], INK],
    [new THREE.BoxGeometry(0.012, 0.03, 0.03), [0.02, 0.05, 0], INK],
  ];
  for (let i = 0; i < 4; i++) parts.push([new THREE.TorusGeometry(0.0185, 0.0035, 5, 14).rotateX(Math.PI / 2), [0, -0.06 + i * 0.022, 0], INK]);
  return merge(parts);
}

// 劍刃：亮芯＋外面一層同色的光暈（不吃光、不寫深度）
export function bladeMeshes(color, len = 0.78) {
  const col = C(color);
  const core = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, len, 10).translate(0, len / 2 + 0.115, 0),
    new THREE.MeshBasicMaterial({ color: col.clone().lerp(C(0xffffff), 0.55), fog: false }));
  const glow = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, len, 4, 12).translate(0, len / 2 + 0.115, 0),
    new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
  glow.renderOrder = 3;
  return { core, glow };
}

// 第一人稱的一隻手臂：手腕在原點、袖子往 +z 延伸（拿東西的手指另外加）
export function armGroup(skin, cloth, cuffMat) {
  const g = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, 0.5, 4, 14), cloth);
  sleeve.rotation.x = Math.PI / 2; sleeve.position.z = 0.33;
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.012, 8, 18), cuffMat);
  cuff.position.z = 0.08;
  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.07, 12), skin);
  wrist.rotation.x = Math.PI / 2; wrist.position.z = 0.045;
  const palm = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), skin);
  palm.scale.set(0.046, 0.028, 0.05);
  g.add(sleeve, cuff, wrist, palm);
  // 握拳：四指一排扣起來＋拇指
  const fist = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.06, 3, 8), skin);
  fist.rotation.z = Math.PI / 2; fist.position.set(0, 0.012, -0.045);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.035, 3, 8), skin);
  thumb.position.set(-0.04, 0.022, -0.03); thumb.rotation.set(0.3, 0.4, 1.1);
  g.add(fist, thumb);
  return g;
}

// 地上跑的貓：身體併成一塊，四條腿與尾巴各自一個關節；項圈是主人的顏色
export function catModel(col, accent, mat) {
  const fur = C(col), dark = fur.clone().multiplyScalar(0.6), light = fur.clone().lerp(C(0xffffff), 0.45), pink = C(0xe9a8a1);
  const g = new THREE.Group();
  const ear = (x) => [new THREE.ConeGeometry(0.03, 0.06, 4).rotateY(Math.PI / 4).rotateZ(x > 0 ? -0.3 : 0.3), [x, 0.375, -0.2], fur];
  const body = new THREE.Mesh(merge([
    [new THREE.CapsuleGeometry(0.082, 0.22, 4, 12).rotateX(Math.PI / 2).scale(0.92, 1, 1), [0, 0.21, 0.01], fur],
    [new THREE.SphereGeometry(0.08, 14, 10), [0, 0.3, -0.2], fur],
    [new THREE.SphereGeometry(0.042, 10, 8).scale(1.1, 0.8, 1), [0, 0.275, -0.265], light],
    [new THREE.SphereGeometry(0.011, 6, 4), [0, 0.29, -0.302], pink],
    [new THREE.SphereGeometry(0.012, 6, 4), [0.032, 0.315, -0.265], INK],
    [new THREE.SphereGeometry(0.012, 6, 4), [-0.032, 0.315, -0.265], INK],
    ear(0.046), ear(-0.046),
    [new THREE.TorusGeometry(0.06, 0.012, 6, 16).rotateX(Math.PI / 2 + 0.7), [0, 0.265, -0.145], C(accent)],
    [new THREE.SphereGeometry(0.014, 6, 4), [0, 0.215, -0.175], C(0xf2c94c)],
    // 背上兩道虎斑（貼著身體的細環）
    [new THREE.TorusGeometry(0.079, 0.007, 4, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), [0, 0.21, 0.02], dark],
    [new THREE.TorusGeometry(0.077, 0.007, 4, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), [0, 0.21, 0.09], dark],
  ]), mat);
  body.castShadow = true;
  g.add(body);
  const legs = [];
  for (const [x, z] of [[0.048, -0.12], [-0.048, -0.12], [0.048, 0.13], [-0.048, 0.13]]) {
    const pv = new THREE.Group();
    pv.position.set(x, 0.17, z);
    const m = new THREE.Mesh(merge([[new THREE.CapsuleGeometry(0.024, 0.1, 3, 8), [0, -0.075, 0], fur], [new THREE.SphereGeometry(0.027, 8, 6), [0, -0.145, -0.008], light]]), mat);
    m.castShadow = true;
    pv.add(m); g.add(pv); legs.push(pv);
  }
  // 尾巴：一串小膠囊沿著往上彎的圓弧接起來，尾端深色
  const tail = new THREE.Group();
  tail.position.set(0, 0.25, 0.17);
  const R = 0.12, tp = [];
  for (let i = 0; i <= 5; i++) { const th = (i / 5) * 2.0; tp.push(new THREE.Vector3(0, R * (1 - Math.cos(th)), R * Math.sin(th))); }
  const seg = [];
  for (let i = 0; i < 5; i++) {
    const a = tp[i], b = tp[i + 1], d = b.clone().sub(a), len = d.length();
    const g = new THREE.CapsuleGeometry(0.017 - i * 0.0012, len, 3, 8).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    seg.push([g, [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2], i === 4 ? dark : fur]);
  }
  const tm = new THREE.Mesh(merge(seg), mat);
  tm.castShadow = true;
  tail.add(tm); tail.rotation.x = -0.2;
  g.add(tail);
  return { g, body, legs, tail, phase: Math.random() * 6, born: -1 };
}

// 圓弧刀光的貼圖：外緣最亮、往內淡掉（RingGeometry 的 uv 是位置換算的，中心在 0.5,0.5）
export function slashTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.6, 'rgba(255,255,255,0)');
  g.addColorStop(0.9, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// 爆炸焦痕：中間深、邊緣不規則地淡掉
export function scorchTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  for (let i = 0; i < 9; i++) {
    const a = i * 0.7, r = 18 + (i % 3) * 7;
    const x = 64 + Math.cos(a) * (i ? 14 : 0), y = 64 + Math.sin(a) * (i ? 14 : 0);
    const g = c.createRadialGradient(x, y, 0, x, y, r + 30);
    g.addColorStop(0, 'rgba(40,42,46,0.32)'); g.addColorStop(1, 'rgba(40,42,46,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
