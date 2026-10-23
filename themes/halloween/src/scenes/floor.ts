import * as THREE from 'three';
import { canvasScene, shaderScene, noise1, smoothstep, TAU, hash01, clamp01 } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { palette } from '../palette.ts';
import { footprint, ghost, glowAt, glowSprite, pumpkin, px, spider, star } from '../shapes.ts';
import { countOf, densityOf, mod, speedOf } from './common.ts';
import { FBM_GLSL } from './glsl.ts';

/** Smooth wandering point over the surface from noise (deterministic). */
function wander(s: DrawState, u: number, id: number, margin = 0.08): { x: number; y: number } {
  const nx = noise1(u, s.seed + id * 2) * 0.6 + noise1(u * 2.3, s.seed + id * 2 + 50) * 0.4;
  const ny = noise1(u + 31.7, s.seed + id * 2 + 1) * 0.6 + noise1(u * 2.1 + 9, s.seed + id * 2 + 77) * 0.4;
  const k = (v: number) => clamp01((v - 0.2) / 0.6);
  return { x: s.w * (margin + (1 - 2 * margin) * k(nx)), y: s.h * (margin + (1 - 2 * margin) * k(ny)) };
}

/** Stop-and-go progress: moves for ~70% of each unit, then rests. */
function stopGo(k: number): number {
  const i = Math.floor(k);
  return i + smoothstep(0, 0.7, k - i);
}

function fogBlobs(
  g: CanvasRenderingContext2D,
  s: DrawState,
  t: number,
  color: string,
  n: number,
  alpha: number,
): void {
  const m = Math.min(s.w, s.h);
  const sprite = glowSprite(color, 0.15);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const r = m * (0.25 + 0.3 * hash01(i * 7 + s.seed));
    const x = s.w * (-0.1 + 1.2 * mod(hash01(i * 3 + s.seed) + t * (0.006 + 0.01 * hash01(i)), 1));
    const y = s.h * (0.1 + 0.8 * noise1(t * 0.03 + i * 4, s.seed + 3));
    g.globalAlpha = alpha * (0.6 + 0.4 * Math.sin(t * 0.3 + i));
    g.drawImage(sprite, x - r * 1.4, y - r, r * 2.8, r * 2);
  }
  g.restore();
}

function web(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
  color: string,
): void {
  g.save();
  g.strokeStyle = color;
  g.globalAlpha = 0.5;
  g.lineWidth = Math.max(1, r * 0.008);
  const spokes = 7;
  for (let i = 0; i <= spokes; i++) {
    const a = a0 + ((a1 - a0) * i) / spokes;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.stroke();
  }
  for (let k = 1; k <= 6; k++) {
    const rr = (r * k) / 6.3;
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = a0 + ((a1 - a0) * i) / spokes;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) g.moveTo(x, y);
      else {
        const pa = a0 + ((a1 - a0) * (i - 0.5)) / spokes;
        g.quadraticCurveTo(cx + Math.cos(pa) * rr * 0.88, cy + Math.sin(pa) * rr * 0.88, x, y);
      }
    }
    g.stroke();
  }
  g.restore();
}

// ---------------------------------------------------------------------------
const spidersAndFog: SceneModule = canvasScene('spidersAndFog', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#020306';
  g.fillRect(0, 0, w, h);
  fogBlobs(g, s, t, pal.ghost, countOf(s, 9, 5, 16), 0.32);
  web(g, 0, 0, m * 0.45, 0, Math.PI / 2, pal.ghost);
  web(g, w, h, m * 0.4, Math.PI, Math.PI * 1.5, pal.ghost);
  const n = countOf(s, 7, 3, 18);
  const size = px(s, 0.45, 0.06, 0.16);
  for (let i = 0; i < n; i++) {
    const v = 0.25 + 0.2 * hash01(i + s.seed);
    const k = stopGo(t * v + hash01(i * 9) * 10);
    const u = k * 0.35;
    const p = wander(s, u, i);
    const q = wander(s, u + 0.01, i);
    const ang = Math.atan2(q.y - p.y, q.x - p.x);
    g.save();
    g.translate(p.x, p.y);
    g.rotate(ang);
    spider(g, size * (0.8 + 0.4 * hash01(i * 3)), k * 9, pal);
    g.restore();
  }
  // fog in front, softer
  fogBlobs(g, s, t + 100, pal.accent, countOf(s, 4, 2, 8), 0.14);
});

// ---------------------------------------------------------------------------
const ghostFootprints: SceneModule = canvasScene('ghostFootprints', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  g.fillStyle = '#020306';
  g.fillRect(0, 0, w, h);
  const size = px(s, 0.32, 0.045, 0.12);
  const walkers = countOf(s, 3, 2, 7);
  const stepRate = 1.6;
  const keep = 14;
  const colors = [pal.ghost, pal.secondary, pal.accent];
  for (let wk = 0; wk < walkers; wk++) {
    const color = colors[wk % colors.length]!;
    const latest = Math.floor(t * stepRate + hash01(wk + s.seed) * 50);
    const stepDist = (size * 1.4) / Math.max(w, h);
    for (let k = latest - keep; k <= latest; k++) {
      const age = (t * stepRate + hash01(wk + s.seed) * 50 - k) / stepRate;
      const alpha = smoothstep(0, 0.15, age) * (1 - smoothstep(keep / stepRate - 3, keep / stepRate, age));
      if (alpha <= 0.01) continue;
      const u = k * stepDist * 0.9;
      const p = wander(s, u, wk + 10, 0.06);
      const q = wander(s, u + 0.002, wk + 10, 0.06);
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const left = k % 2 === 0;
      const off = (left ? -1 : 1) * size * 0.28;
      const x = p.x + Math.cos(ang + Math.PI / 2) * off;
      const y = p.y + Math.sin(ang + Math.PI / 2) * off;
      footprint(g, x, y, size, ang + Math.PI / 2, left, color, alpha);
      if (age < 0.6) {
        for (let j = 0; j < 4; j++) {
          const a = (j / 4) * TAU + k;
          star(
            g,
            x + Math.cos(a) * size * (0.4 + age),
            y + Math.sin(a) * size * (0.4 + age),
            size * 0.12,
            color,
            1 - age / 0.6,
          );
        }
      }
    }
  }
  // sparse mist dust
  const dust = countOf(s, 40, 10, 120);
  for (let i = 0; i < dust; i++) {
    const x = w * hash01(i * 5 + s.seed);
    const y = h * hash01(i * 11 + s.seed);
    star(g, x, y, Math.min(w, h) * 0.004, pal.ghost, 0.25 + 0.25 * Math.sin(t + i));
  }
});

// ---------------------------------------------------------------------------
function pathPoint(s: DrawState, u: number): { x: number; y: number; ang: number } {
  const horizontal = s.w >= s.h;
  const L = horizontal ? s.w : s.h;
  const S = horizontal ? s.h : s.w;
  const a = u * L;
  const b = S / 2 + Math.sin(u * TAU * 0.8 + 0.6) * S * 0.18;
  const db = Math.cos(u * TAU * 0.8 + 0.6) * S * 0.18 * TAU * 0.8;
  const ang = Math.atan2(db, L);
  return horizontal ? { x: a, y: b, ang } : { x: b, y: a, ang: Math.PI / 2 - ang };
}

const magicPath: SceneModule = canvasScene('magicPath', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#030208';
  g.fillRect(0, 0, w, h);
  const width = m * 0.34;
  // path body
  g.save();
  g.lineCap = 'round';
  g.globalCompositeOperation = 'lighter';
  for (const [lw, a, c] of [
    [width * 1.1, 0.14, pal.accent],
    [width * 0.8, 0.2, pal.accent],
    [width * 0.5, 0.22, pal.primary],
    [width * 0.18, 0.3, pal.secondary],
  ] as const) {
    g.strokeStyle = c;
    g.globalAlpha = a;
    g.lineWidth = lw;
    g.beginPath();
    for (let i = 0; i <= 80; i++) {
      const p = pathPoint(s, -0.05 + (i / 80) * 1.1);
      if (i === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.stroke();
  }
  // flowing dashes along the center
  g.strokeStyle = pal.secondary;
  g.globalAlpha = 0.55;
  g.lineWidth = width * 0.06;
  g.setLineDash([width * 0.25, width * 0.35]);
  g.lineDashOffset = -t * width * 0.6;
  g.beginPath();
  for (let i = 0; i <= 80; i++) {
    const p = pathPoint(s, -0.05 + (i / 80) * 1.1);
    if (i === 0) g.moveTo(p.x, p.y);
    else g.lineTo(p.x, p.y);
  }
  g.stroke();
  g.setLineDash([]);
  g.restore();
  // edge lanterns with a travelling wave of light
  const markers = Math.max(6, Math.round((Math.max(w, h) / width) * 2.2));
  for (let i = 0; i < markers; i++) {
    const u = (i + 0.5) / markers;
    const p = pathPoint(s, u);
    const wave = Math.pow(0.5 + 0.5 * Math.cos((u * 3 - t * 0.6) * TAU), 4);
    for (const side of [-1, 1]) {
      const x = p.x + Math.cos(p.ang + Math.PI / 2) * side * width * 0.55;
      const y = p.y + Math.sin(p.ang + Math.PI / 2) * side * width * 0.55;
      glowAt(g, x, y, m * 0.05, pal.secondary, 0.25 + 0.75 * wave);
      star(g, x, y, m * 0.014 * (1 + wave * 0.6), '#ffffff', 0.6 + 0.4 * wave);
    }
  }
  // glitter flowing along the path
  const glitter = countOf(s, 70, 15, 200);
  for (let i = 0; i < glitter; i++) {
    const u = mod(hash01(i + s.seed) + t * (0.02 + 0.03 * hash01(i * 3)), 1);
    const p = pathPoint(s, u);
    const off = (hash01(i * 7) - 0.5) * width * 0.8;
    const x = p.x + Math.cos(p.ang + Math.PI / 2) * off;
    const y = p.y + Math.sin(p.ang + Math.PI / 2) * off;
    const tw = 0.5 + 0.5 * Math.sin(t * 6 + i * 1.7);
    star(g, x, y, m * 0.007 * (0.6 + tw), i % 3 === 0 ? pal.secondary : pal.ghost, 0.3 + 0.7 * tw);
  }
  // drifting leaves
  const leaves = countOf(s, 12, 3, 30);
  const lcol = ['#ff8a1f', '#ffc23d', '#e2492f', '#c46a1b'];
  for (let i = 0; i < leaves; i++) {
    const sp = 0.03 + 0.03 * hash01(i * 5 + s.seed);
    const x = w * mod(hash01(i) + t * sp, 1.2) - w * 0.1;
    const y = h * (hash01(i * 13) + 0.08 * Math.sin(t * 0.7 + i));
    const r = m * 0.02 * (0.7 + 0.6 * hash01(i * 3));
    g.save();
    g.translate(x, y);
    g.rotate(t * (0.5 + hash01(i)) + i);
    g.fillStyle = lcol[i % lcol.length]!;
    g.globalAlpha = 0.8;
    g.beginPath();
    g.moveTo(-r, 0);
    g.quadraticCurveTo(0, -r * 0.7, r, 0);
    g.quadraticCurveTo(0, r * 0.7, -r, 0);
    g.fill();
    g.restore();
  }
});

// ---------------------------------------------------------------------------
const pumpkinTrail: SceneModule = canvasScene('pumpkinTrail', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#030206';
  g.fillRect(0, 0, w, h);
  // fireflies
  const flies = countOf(s, 30, 8, 80);
  for (let i = 0; i < flies; i++) {
    const x = w * noise1(t * 0.04 + i * 3, s.seed + 11);
    const y = h * noise1(t * 0.05 + i * 7, s.seed + 12);
    glowAt(
      g,
      x * 1.4 - w * 0.2,
      y * 1.4 - h * 0.2,
      m * 0.018,
      pal.secondary,
      0.3 + 0.3 * Math.sin(t * 3 + i),
    );
  }
  const size = px(s, 0.5, 0.09, 0.25);
  const L = Math.max(w, h);
  const n = Math.max(3, Math.round((L / (size * 1.9)) * Math.min(1.5, densityOf(s))));
  for (let i = 0; i < n; i++) {
    const u = mod(i / n + t * 0.025, 1) * 1.15 - 0.075;
    const p = pathPoint(s, u);
    // star trail
    for (let k = 1; k <= 8; k++) {
      const pu = u - (k * size * 0.22) / L;
      const tp = pathPoint(s, pu);
      const sy = tp.y + Math.sin(k * 1.3 + t * 4 + i) * size * 0.18;
      glowAt(g, tp.x, sy, size * 0.25 * (1 - k / 9), k % 2 ? pal.secondary : pal.accent, 0.5 * (1 - k / 9));
      star(g, tp.x, sy, size * 0.14 * (1 - k / 9), k % 2 ? pal.secondary : '#ffffff', 1 - k / 9);
    }
    const hop = Math.abs(Math.sin(t * 3 + i * 0.9));
    pumpkin(g, p.x, p.y - hop * size * 0.35, size, {
      pal,
      face: (i + s.seed) % 6,
      t,
      squash: hop < 0.2 ? (0.2 - hop) * 3 : 0,
      glow: 0.9,
    });
  }
});

// ---------------------------------------------------------------------------
const MIST_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSpeed; uniform float uDensity;
varying vec2 vUv;
${FBM_GLSL}
void main() {
  vec2 p = vUv * vec2(uRes.x / uRes.y, 1.0) * 2.5;
  float t = uTime * uSpeed * 0.12;
  vec2 c = vec2(uRes.x / uRes.y, 1.0) * 1.25;
  vec2 d = p - c;
  float r = length(d);
  float ang = 0.35 * t / (0.6 + r);
  mat2 rot = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  vec2 q = c + rot * d;
  vec2 warp = vec2(fbm(q + vec2(t, 0.0) + uSeed), fbm(q + vec2(5.2, 1.3) - vec2(0.0, t) + uSeed));
  float n = fbm(q * 1.2 + warp * 2.2 + vec2(t * 0.5, -t * 0.3));
  float n2 = fbm(q * 2.4 - warp + 7.0);
  vec3 col = mix(uA, uB, smoothstep(0.3, 0.8, n2));
  col = mix(col, uC, smoothstep(0.65, 0.95, n) * 0.6);
  float amount = smoothstep(0.35 - 0.1 * uDensity, 0.85, n) * (0.45 + 0.2 * uDensity);
  col *= amount;
  // sparkles
  vec2 cell = floor(vUv * uRes / 18.0);
  float h = hash21(cell + floor(uSeed));
  float tw = pow(max(0.0, sin(uTime * (1.5 + h * 3.0) + h * 40.0)), 24.0);
  vec2 f = fract(vUv * uRes / 18.0) - 0.5;
  float sp = smoothstep(0.12, 0.0, length(f)) * tw * step(0.9, h) * amount * 3.0;
  col += vec3(sp);
  gl_FragColor = vec4(col, 1.0);
}
`;

const swirlingMist: SceneModule = shaderScene(
  'swirlingMist',
  MIST_FRAG,
  (s) => {
    const pal = palette(s.params);
    return {
      uA: new THREE.Vector3(...pal.rgb.accent),
      uB: new THREE.Vector3(...pal.rgb.primary),
      uC: new THREE.Vector3(...pal.rgb.ghost),
      uSpeed: speedOf(s),
      uDensity: densityOf(s),
    };
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.03) },
);

// ---------------------------------------------------------------------------
const tinyGhostParade: SceneModule = canvasScene('tinyGhostParade', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#020309';
  g.fillRect(0, 0, w, h);
  const size = px(s, 0.42, 0.06, 0.2);
  const horizontal = w >= h;
  const L = horizontal ? w : h;
  const S = horizontal ? h : w;
  const rows = Math.max(1, Math.min(3, Math.round(densityOf(s) * 1.5)));
  // confetti
  const conf = countOf(s, 50, 10, 140);
  for (let i = 0; i < conf; i++) {
    const x = w * hash01(i * 3 + s.seed);
    const y = h * hash01(i * 5 + s.seed);
    g.fillStyle = pal.party[i % pal.party.length]!;
    g.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i);
    g.save();
    g.translate(x, y);
    g.rotate(i + t * 0.5);
    g.fillRect(-m * 0.005, -m * 0.002, m * 0.01, m * 0.004);
    g.restore();
  }
  g.globalAlpha = 1;
  for (let r = 0; r < rows; r++) {
    const lane = S * ((r + 1) / (rows + 1));
    const dir = r % 2 === 0 ? 1 : -1;
    const spacing = size * 1.1;
    const count = Math.ceil(L / spacing) + 2;
    const shift = mod(t * size * 0.6 * (1 + r * 0.15), spacing * count);
    for (let i = 0; i < count; i++) {
      let a = i * spacing + shift;
      a = mod(a, spacing * count) - spacing;
      if (dir < 0) a = L - a;
      const bob = Math.sin(t * 4 + i * 0.8) * size * 0.08;
      const wobble = Math.sin((a / L) * TAU * 1.5 + r) * S * 0.04;
      const x = horizontal ? a : lane + wobble;
      const y = horizontal ? lane + wobble + bob : a;
      // shadow
      g.fillStyle = 'rgba(120,140,255,0.12)';
      g.beginPath();
      g.ellipse(x, y + size * 0.55, size * 0.3, size * 0.08, 0, 0, TAU);
      g.fill();
      const leader = i % 6 === 0;
      ghost(g, x, y, size, {
        color: pal.ghost,
        t: t + i,
        face: leader ? 'oo' : i % 3 === 0 ? 'happy' : 'sleepy',
        wave: Math.sin(t * 6 + i) * 0.5,
        mirror: horizontal ? dir < 0 : false,
        glow: 0.7,
      });
      if (leader) {
        const lx = x + (horizontal ? dir * size * 0.45 : size * 0.45);
        const ly = y - size * 0.1;
        glowAt(g, lx, ly, size * 0.5, pal.secondary, 0.7 + 0.2 * Math.sin(t * 7));
        g.fillStyle = pal.secondary;
        g.beginPath();
        g.arc(lx, ly, size * 0.08, 0, TAU);
        g.fill();
      }
    }
  }
});

export const floorScenes: SceneModule[] = [
  spidersAndFog,
  ghostFootprints,
  magicPath,
  pumpkinTrail,
  swirlingMist,
  tinyGhostParade,
];
