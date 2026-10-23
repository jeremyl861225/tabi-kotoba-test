// 後製：移軸景深＋泛光＋調色＋顆粒
import * as THREE from 'three';
import { uTime } from './kit.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createPost(renderer) {
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fsScene = new THREE.Scene();
  const fsQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  fsScene.add(fsQuad);
  const canHalf = renderer.capabilities.isWebGL2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const type = canHalf ? THREE.HalfFloatType : THREE.UnsignedByteType;
  const mk = (samples = 0, depth = false) => new THREE.WebGLRenderTarget(1, 1, { type, samples, depthBuffer: depth });
  const rtMain = mk(4, true), rtH1 = mk(), rtH2 = mk(), rtQ1 = mk(), rtQ2 = mk();
  const matCopy = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t, vUv + px * vec2(-0.5,-0.5)).rgb + texture2D(t, vUv + px * vec2(0.5,-0.5)).rgb + texture2D(t, vUv + px * vec2(-0.5,0.5)).rgb + texture2D(t, vUv + px * vec2(0.5,0.5)).rgb; c *= 0.25; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); gl_FragColor = vec4(min(c, vec3(40.0)), 1.0); }` });
  const matBright = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, px: { value: new THREE.Vector2() }, th: { value: 1.0 }, knee: { value: 0.8 } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 px; uniform float th, knee; varying vec2 vUv;
      void main(){ vec3 c = vec3(0.0);
        for (int i = 0; i < 4; i++){ vec2 o = vec2(float(i - (i/2)*2) - 0.5, float(i/2) - 0.5) * px; c += texture2D(t, vUv + o).rgb; }
        c *= 0.25; if (any(isnan(c)) || any(isinf(c))) c = vec3(0.0); c = min(c, vec3(40.0)); float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        gl_FragColor = vec4(c * smoothstep(th, th + knee, l), 1.0); }` });
  const matBlur = new THREE.ShaderMaterial({ uniforms: { t: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: VS,
    fragmentShader: `uniform sampler2D t; uniform vec2 dir; varying vec2 vUv;
      void main(){ vec3 c = texture2D(t, vUv).rgb * 0.227027;
        c += (texture2D(t, vUv + dir * 1.3846).rgb + texture2D(t, vUv - dir * 1.3846).rgb) * 0.3162162;
        c += (texture2D(t, vUv + dir * 3.2308).rgb + texture2D(t, vUv - dir * 3.2308).rgb) * 0.0702703;
        gl_FragColor = vec4(c, 1.0); }` });
  const matFinal = new THREE.ShaderMaterial({
    uniforms: { tS: { value: null }, tB: { value: null }, tG: { value: null }, uFocus: { value: 0.5 }, uBand: { value: 0.1 }, uFeather: { value: 0.3 }, uDof: { value: 1 }, uBloom: { value: 1 }, uSat: { value: 1.04 }, uVig: { value: 1 }, uDebug: { value: 0 }, uTime },
    vertexShader: VS,
    fragmentShader: `uniform sampler2D tS, tB, tG; uniform float uFocus, uBand, uFeather, uDof, uBloom, uSat, uVig, uTime, uDebug; varying vec2 vUv;
      float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main(){
        vec3 s = texture2D(tS, vUv).rgb, b = texture2D(tB, vUv).rgb;
        bool bad = any(isnan(s)) || any(isinf(s));
        if (bad) s = b;
        float m = smoothstep(uBand, uBand + uFeather, abs(vUv.y - uFocus)) * uDof;
        vec3 c = mix(s, b, m) + texture2D(tG, vUv).rgb * uBloom;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l), c, uSat);
        c *= vec3(1.035, 1.0, 0.965);
        c += vec3(0.010, 0.006, 0.024) * (1.0 - smoothstep(0.0, 0.45, l));
        vec2 q = vUv - 0.5; c *= mix(1.0, 1.0 - dot(q, q) * 1.0, uVig);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        gl_FragColor.rgb += (h21(gl_FragCoord.xy + fract(uTime) * 91.0) - 0.5) * 0.016;
        if (uDebug > 0.5 && bad) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);
      }`,
  });
  const params = { focus: 0.5, band: 0.12, feather: 0.28, dof: 1, bloom: 1.0, sat: 1.04, vig: 1 };
  function pass(mat, target) { fsQuad.material = mat; renderer.setRenderTarget(target); renderer.render(fsScene, fsCam); }
  function setSize(pw, ph) {
    rtMain.setSize(pw, ph);
    rtH1.setSize(pw >> 1, ph >> 1); rtH2.setSize(pw >> 1, ph >> 1);
    rtQ1.setSize(pw >> 2, ph >> 2); rtQ2.setSize(pw >> 2, ph >> 2);
  }
  function render(scene, camera) {
    renderer.setRenderTarget(rtMain); renderer.render(scene, camera);
    const hw = rtH1.width, hh = rtH1.height, qw = rtQ1.width, qh = rtQ1.height;
    matCopy.uniforms.t.value = rtMain.texture; matCopy.uniforms.px.value.set(1 / rtMain.width, 1 / rtMain.height); pass(matCopy, rtH1);
    matBright.uniforms.t.value = rtH1.texture; matBright.uniforms.px.value.set(1 / hw, 1 / hh); pass(matBright, rtQ1);
    for (const sp of [1.0, 2.0, 3.0]) {
      matBlur.uniforms.t.value = rtQ1.texture; matBlur.uniforms.dir.value.set(sp / qw, 0); pass(matBlur, rtQ2);
      matBlur.uniforms.t.value = rtQ2.texture; matBlur.uniforms.dir.value.set(0, sp / qh); pass(matBlur, rtQ1);
    }
    if (params.dof) for (const sp of [1.0, 2.2]) {
      matBlur.uniforms.t.value = rtH1.texture; matBlur.uniforms.dir.value.set(sp / hw, 0); pass(matBlur, rtH2);
      matBlur.uniforms.t.value = rtH2.texture; matBlur.uniforms.dir.value.set(0, sp / hh); pass(matBlur, rtH1);
    }
    const u = matFinal.uniforms;
    u.tS.value = rtMain.texture; u.tB.value = rtH1.texture; u.tG.value = rtQ1.texture;
    u.uFocus.value = params.focus; u.uBand.value = params.band; u.uFeather.value = params.feather;
    u.uDebug.value = params.debug || 0; u.uDof.value = params.dof; u.uBloom.value = params.bloom; u.uSat.value = params.sat; u.uVig.value = params.vig;
    pass(matFinal, null);
  }
  return { params, setSize, render };
}
