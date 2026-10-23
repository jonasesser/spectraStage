import * as THREE from 'three';
import { createRng } from '@spectrastage/shared';
import {
  canvasScene,
  ease,
  glow,
  hexToRgb,
  memo,
  shaderScene,
  smoothstep,
  starPath,
  TAU,
  clamp01,
} from '@spectrastage/engine';
import type { ActorModule, EffectModule, SceneModule, ThemeRuntime } from '@spectrastage/engine';

const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const c = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d);

const NOISE = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = hash21(i); float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0)); float d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * vnoise(p); p = p * 2.02 + 11.3; a *= 0.5; } return v; }
`;

const aurora: SceneModule = shaderScene(
  'aurora',
  /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed; uniform vec3 uColor; uniform float uSpeed;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0);
  float t = uTime * uSpeed * 0.15;
  vec3 col = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = 0.55 + 0.18 * sin(p.x * (1.2 + fi * 0.4) + t * (1.0 + fi * 0.3) + uSeed + fi * 2.0) + 0.1 * fbm(vec2(p.x * 2.0 + t, fi));
    float band = exp(-pow((vUv.y - y) * (7.0 + fi * 3.0), 2.0));
    float rays = 0.6 + 0.4 * fbm(vec2(p.x * 14.0 + t * 2.0, fi * 3.1));
    vec3 tint = mix(uColor, uColor.bgr, fi * 0.35);
    col += tint * band * rays * (0.65 - fi * 0.15);
  }
  vec2 cell = floor(vUv * uRes / 6.0);
  float hs = hash21(cell);
  float dotm = smoothstep(0.22, 0.0, length(fract(vUv * uRes / 6.0) - 0.5));
  float stars = step(0.993, hs) * dotm * (0.5 + 0.5 * sin(uTime * 1.5 + hs * 40.0));
  col += vec3(stars) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}
`,
  (s) => ({
    uColor: new THREE.Vector3(...hexToRgb(c(s.params.color, '#4dffb5'))),
    uSpeed: n(s.params.speed, 1),
  }),
);

const colorWaves: SceneModule = shaderScene(
  'colorWaves',
  /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed; uniform vec3 uA; uniform vec3 uB; uniform float uSpeed;
varying vec2 vUv;
${NOISE}
void main() {
  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0) * 1.5;
  float t = uTime * uSpeed * 0.1;
  float n = fbm(p + vec2(fbm(p + t + uSeed), fbm(p - t + 3.0)) * 1.5);
  vec3 col = mix(uA, uB, smoothstep(0.25, 0.75, n));
  col *= 0.55 + 0.45 * sin(n * 6.2831 + t * 3.0);
  gl_FragColor = vec4(col * 0.8, 1.0);
}
`,
  (s) => ({
    uA: new THREE.Vector3(...hexToRgb(c(s.params.colorA, '#3a1c71'))),
    uB: new THREE.Vector3(...hexToRgb(c(s.params.colorB, '#ffaf7b'))),
    uSpeed: n(s.params.speed, 0.6),
  }),
);

const starfield: SceneModule = canvasScene('starfield', (g, s, f) => {
  const count = Math.round(
    260 * n(s.params.density, 1) * (0.4 + 0.6 * s.quality) * Math.sqrt((s.w * s.h) / (1920 * 1080)),
  );
  const stars = memo(s, `st${count}`, () => {
    const rng = createRng(s.seed);
    return Array.from({ length: count }, () => ({
      x: rng() * s.w,
      y: rng() * s.h,
      r: 0.5 + rng() * 1.8,
      ph: rng() * TAU,
      sp: 0.5 + rng() * 2,
    }));
  });
  const k = Math.max(1, Math.min(s.w, s.h) / 600);
  for (const st of stars) {
    const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(f.time * st.sp + st.ph));
    g.globalAlpha = a;
    g.fillStyle = '#e6ecff';
    g.beginPath();
    g.arc(st.x, st.y, st.r * k, 0, TAU);
    g.fill();
  }
  g.globalAlpha = 1;
  // a shooting star every ~7 s
  const period = 7;
  const slot = Math.floor(f.time / period);
  const p = (f.time - slot * period) / 1.2;
  if (p >= 0 && p <= 1) {
    const rng = createRng(s.seed + slot * 7919);
    const x0 = rng() * s.w;
    const y0 = rng() * s.h * 0.5;
    const len = Math.min(s.w, s.h) * 0.4;
    const x = x0 + p * len;
    const y = y0 + p * len * 0.4;
    const grad = g.createLinearGradient(x - len * 0.3, y - len * 0.12, x, y);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(1, `rgba(255,255,255,${Math.sin(p * Math.PI)})`);
    g.strokeStyle = grad;
    g.lineWidth = 2 * k;
    g.beginPath();
    g.moveTo(x - len * 0.3, y - len * 0.12);
    g.lineTo(x, y);
    g.stroke();
  }
});

const solidColor: SceneModule = canvasScene(
  'solidColor',
  (g, s) => {
    g.fillStyle = c(s.params.color, '#202040');
    g.fillRect(0, 0, s.w, s.h);
  },
  { canvasScale: 0.1 },
);

const pulse: EffectModule = {
  id: 'pulse',
  draw(g, i) {
    const m = Math.min(i.w, i.h);
    for (let k = 0; k < 3; k++) {
      const p = clamp01(i.progress * 1.3 - k * 0.15);
      if (p <= 0 || p >= 1) continue;
      g.strokeStyle = `rgba(200,230,255,${(1 - p) * 0.8})`;
      g.lineWidth = m * 0.02 * (1 - p);
      g.beginPath();
      g.arc(i.w / 2, i.h / 2, ease.outCubic(p) * m * 0.6, 0, TAU);
      g.stroke();
    }
  },
  sound(snd) {
    snd.chime({ notes: [523, 784], gain: 0.05, spacing: 0.2 });
  },
};

const shootingStars: EffectModule = {
  id: 'shootingStars',
  draw(g, i) {
    const m = Math.min(i.w, i.h);
    for (let k = 0; k < 6; k++) {
      const delay = i.rng() * 2.2;
      const x0 = i.rng() * i.w;
      const y0 = i.rng() * i.h * 0.6;
      const p = (i.t - delay) / 1.1;
      if (p < 0 || p > 1) continue;
      const len = m * 0.5;
      const x = x0 + p * len;
      const y = y0 + p * len * 0.45;
      g.strokeStyle = `rgba(255,255,255,${Math.sin(p * Math.PI)})`;
      g.lineWidth = Math.max(1.5, m * 0.004);
      g.beginPath();
      g.moveTo(x - len * 0.25, y - len * 0.11);
      g.lineTo(x, y);
      g.stroke();
      g.fillStyle = '#ffffff';
      starPath(g, x, y, m * 0.012, p * 4);
      g.fill();
    }
  },
  sound(snd) {
    snd.chime({ notes: [1568, 2093, 2637], gain: 0.04, spacing: 0.3 });
  },
};

const firefly: ActorModule = {
  id: 'firefly',
  upright: true,
  draw(g, _pose, info) {
    const a = 0.5 + 0.5 * smoothstep(-0.3, 1, Math.sin(info.t * 3 + info.seed));
    glow(g, 0, 0, info.sizePx * 1.6, '#e8ff7a', a * 0.8);
    g.fillStyle = `rgba(255,255,200,${a})`;
    g.beginPath();
    g.arc(0, 0, info.sizePx * 0.25, 0, TAU);
    g.fill();
  },
};

export const basicRuntime: ThemeRuntime = {
  id: 'basic',
  scenes: { aurora, starfield, colorWaves, solidColor },
  effects: { pulse, shootingStars },
  actors: { firefly },
};

export default basicRuntime;
