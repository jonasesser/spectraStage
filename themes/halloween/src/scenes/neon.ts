/**
 * Neon / high-contrast scenes: large bright saturated areas and dark silhouettes, so the show
 * stays readable at dusk when it is not fully dark yet. Slow color motion only – no flashing.
 */
import * as THREE from 'three';
import { createRng } from '@spectrastage/shared';
import { clamp01, hash01, hybridScene, memo, noise1, TAU } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { num, palette, type Palette } from '../palette.ts';
import {
  bat,
  dancePose,
  fuzzySpider,
  ghost,
  glowAt,
  leaf,
  pawPrint,
  pumpkin,
  px,
  skeleton,
  star,
  type GhostFace,
} from '../shapes.ts';
import { countOf, densityOf, mod, speedOf } from './common.ts';
import { FBM_GLSL } from './glsl.ts';

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];
const LIME = '#7dff4d';

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Shader colors: A = purple base, B = warm glow, C = green accent. */
function neonUniforms(s: DrawState) {
  const pal = palette(s.params);
  const green = pal.party[1] ?? LIME;
  return {
    uA: new THREE.Vector3(...pal.rgb.accent),
    uB: new THREE.Vector3(...pal.rgb.primary),
    uC: new THREE.Vector3(...hexRgb(green)),
    uSpeed: speedOf(s),
    uDensity: densityOf(s),
  };
}

const HEADER = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSpeed; uniform float uDensity;
varying vec2 vUv;
${FBM_GLSL}
`;

// ---------------------------------------------------------------------------
// Neon Manor (wall)
// ---------------------------------------------------------------------------
const MANOR_FRAG = /* glsl */ `
${HEADER}
uniform vec2 uMoon;
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed * 0.05;
  vec3 top = uA * 0.42 + vec3(0.03, 0.0, 0.08);
  vec3 low = mix(uA, uC, 0.18) * 0.85;
  vec3 col = mix(low, top, smoothstep(0.25, 1.0, uv.y));
  vec2 p = vec2(uv.x * aspect * 1.5, uv.y * 2.4);
  float n = fbm(p + vec2(t, -t * 0.35) + uSeed);
  float n2 = fbm(p * 1.7 - vec2(t * 1.3, t * 0.15) + 7.0 + uSeed);
  float lowBand = 1.0 - smoothstep(0.2, 0.75, uv.y);
  col = mix(col, uC * 0.9, smoothstep(0.45, 0.78, n) * (0.45 + 0.45 * lowBand) * clamp(uDensity, 0.3, 1.5));
  col = mix(col, uA * 1.1, smoothstep(0.5, 0.85, n2) * 0.4);
  float d = length((uv - uMoon) * vec2(aspect, 1.0));
  col += uB * (0.6 * exp(-d * 4.0) + 0.1 * exp(-d * 1.4));
  col = max(col, uA * 0.3);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

function mansion(
  g: CanvasRenderingContext2D,
  cx: number,
  baseY: number,
  W: number,
  pal: Palette,
  t: number,
): void {
  const H = W * 0.62;
  const body = '#1d0a36';
  const rim = pal.rim;
  const lw = Math.max(2, W * 0.006);
  const win = pal.primary === '#ff7a1a' ? '#ffb13b' : pal.secondary;
  g.save();
  g.lineJoin = 'round';
  // silhouette parts: [x, y, w, h, roofH]
  const parts: [number, number, number, number, number][] = [
    [-0.5, -0.42, 0.26, 0.42, 0.2], // left wing
    [0.24, -0.42, 0.26, 0.42, 0.2], // right wing
    [-0.26, -0.58, 0.52, 0.58, 0.22], // center block
    [-0.1, -0.86, 0.2, 0.86, 0.28], // tower
    [-0.43, -0.6, 0.1, 0.2, 0.16], // left turret
    [0.33, -0.6, 0.1, 0.2, 0.16], // right turret
  ];
  const shape = (x: number, y: number, w: number, h: number, roof: number) => {
    const X = cx + x * W;
    const Y = baseY + y * H;
    g.beginPath();
    g.moveTo(X - w * W * 0.08, Y);
    g.lineTo(X + w * W * 0.5, Y - roof * H);
    g.lineTo(X + w * W * 1.08, Y);
    g.lineTo(X + w * W, Y);
    g.lineTo(X + w * W, Y + h * H);
    g.lineTo(X, Y + h * H);
    g.lineTo(X, Y);
    g.closePath();
  };
  glowAt(g, cx, baseY - H * 0.4, W * 0.75, rim, 0.35);
  for (const [x, y, w, h, roof] of parts) {
    shape(x, y, w, h, roof);
    g.fillStyle = body;
    g.fill();
    g.strokeStyle = rim;
    g.lineWidth = lw;
    g.stroke();
  }
  // spires
  for (const [x, y, w, roof] of [
    [-0.1, -0.86, 0.2, 0.28],
    [-0.43, -0.6, 0.1, 0.16],
    [0.33, -0.6, 0.1, 0.16],
  ] as const) {
    const X = cx + (x + w / 2) * W;
    const Y = baseY + (y - roof) * H;
    g.strokeStyle = rim;
    g.lineWidth = lw;
    g.beginPath();
    g.moveTo(X, Y);
    g.lineTo(X, Y - H * 0.09);
    g.moveTo(X - H * 0.025, Y - H * 0.06);
    g.lineTo(X + H * 0.025, Y - H * 0.06);
    g.stroke();
  }
  // windows
  const winRect = (x: number, y: number, w: number, h: number, seed: number) => {
    const X = cx + x * W;
    const Y = baseY + y * H;
    const ww = w * W;
    const hh = h * H;
    const flick = 0.85 + 0.15 * noise1(t * 0.8 + seed * 3.1, seed);
    glowAt(g, X + ww / 2, Y + hh / 2, Math.max(ww, hh) * 1.3, win, 0.5 * flick);
    g.fillStyle = win;
    g.globalAlpha = 0.75 + 0.25 * flick;
    g.beginPath();
    g.moveTo(X, Y + hh);
    g.lineTo(X, Y + ww / 2);
    g.arc(X + ww / 2, Y + ww / 2, ww / 2, Math.PI, 0);
    g.lineTo(X + ww, Y + hh);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = body;
    g.lineWidth = Math.max(1.5, ww * 0.12);
    g.beginPath();
    g.moveTo(X + ww / 2, Y + ww * 0.2);
    g.lineTo(X + ww / 2, Y + hh);
    g.moveTo(X, Y + hh * 0.6);
    g.lineTo(X + ww, Y + hh * 0.6);
    g.stroke();
    // a cat in some windows
    if (seed % 4 === 1) {
      g.fillStyle = body;
      const cxw = X + ww * 0.3;
      const by = Y + hh * 0.98;
      g.beginPath();
      g.ellipse(cxw, by - hh * 0.14, ww * 0.16, hh * 0.15, 0, 0, TAU);
      g.arc(cxw, by - hh * 0.36, ww * 0.12, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(cxw - ww * 0.12, by - hh * 0.4);
      g.lineTo(cxw - ww * 0.1, by - hh * 0.52);
      g.lineTo(cxw - ww * 0.02, by - hh * 0.44);
      g.lineTo(cxw + ww * 0.06, by - hh * 0.52);
      g.lineTo(cxw + ww * 0.12, by - hh * 0.4);
      g.fill();
    }
  };
  let k = 0;
  for (const x of [-0.45, -0.36]) winRect(x, -0.32, 0.06, 0.2, k++);
  for (const x of [0.3, 0.39]) winRect(x, -0.32, 0.06, 0.2, k++);
  for (const x of [-0.2, -0.06, 0.08]) winRect(x, -0.5, 0.08, 0.2, k++);
  for (const x of [-0.2, 0.12]) winRect(x, -0.22, 0.08, 0.2, k++);
  winRect(-0.05, -0.75, 0.1, 0.2, k++);
  winRect(-0.41, -0.55, 0.06, 0.1, k++);
  winRect(0.35, -0.55, 0.06, 0.1, k++);
  // door
  const dX = cx - W * 0.05;
  const dW = W * 0.1;
  const dH = H * 0.24;
  glowAt(g, dX + dW / 2, baseY - dH / 2, dW * 1.4, pal.primary, 0.45);
  g.fillStyle = '#b8571a';
  g.beginPath();
  g.moveTo(dX, baseY);
  g.lineTo(dX, baseY - dH + dW / 2);
  g.arc(dX + dW / 2, baseY - dH + dW / 2, dW / 2, Math.PI, 0);
  g.lineTo(dX + dW, baseY);
  g.closePath();
  g.fill();
  g.strokeStyle = rim;
  g.lineWidth = lw;
  g.stroke();
  // wreath
  g.strokeStyle = LIME;
  g.lineWidth = Math.max(2, dW * 0.12);
  g.beginPath();
  g.arc(dX + dW / 2, baseY - dH * 0.62, dW * 0.2, 0, TAU);
  g.stroke();
  // lanterns
  for (const side of [-1, 1]) {
    const lx = dX + dW / 2 + side * dW * 0.95;
    const ly = baseY - dH * 0.7;
    glowAt(g, lx, ly, dW * 0.9, pal.secondary, 0.7);
    g.fillStyle = pal.secondary;
    g.fillRect(lx - dW * 0.08, ly - dW * 0.12, dW * 0.16, dW * 0.24);
  }
  g.restore();
}

const neonManor: SceneModule = hybridScene(
  'neonManor',
  MANOR_FRAG,
  (s) => ({ ...neonUniforms(s), uMoon: new THREE.Vector2(0.74, 0.74) }),
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    // stars
    const stars = memo(s, 'nstars', () => {
      const rng = createRng(s.seed ^ 77);
      return Array.from({ length: countOf(s, 40, 8, 100) }, () => ({
        x: rng() * w,
        y: rng() * h * 0.45,
        r: m * (0.004 + rng() * 0.006),
        p: rng() * TAU,
      }));
    });
    for (const st of stars) star(g, st.x, st.y, st.r * 2, '#ffffff', 0.5 + 0.5 * Math.sin(t * 1.2 + st.p));
    // moon
    const mx = w * 0.74;
    const my = h * 0.26;
    const mr = m * 0.15;
    glowAt(g, mx, my, mr * 2.6, '#ffc24d', 0.6);
    g.fillStyle = '#ffd36b';
    g.beginPath();
    g.arc(mx, my, mr, 0, TAU);
    g.fill();
    g.fillStyle = 'rgba(230,150,40,0.45)';
    for (const [dx, dy, rr] of [
      [-0.3, -0.2, 0.18],
      [0.25, 0.15, 0.22],
      [-0.1, 0.4, 0.12],
    ] as const) {
      g.beginPath();
      g.arc(mx + dx * mr, my + dy * mr, rr * mr, 0, TAU);
      g.fill();
    }
    // ground
    const groundY = h * 0.88;
    g.fillStyle = '#1a0830';
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i <= 24; i++) g.lineTo((i / 24) * w, groundY + Math.sin(i * 0.9 + s.seed) * h * 0.012);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    g.strokeStyle = LIME;
    g.globalAlpha = 0.7;
    g.lineWidth = Math.max(2, h * 0.006);
    g.stroke();
    g.globalAlpha = 1;
    // mansion
    const W = Math.min(w * 0.62, h * 1.25);
    mansion(g, w * 0.5, groundY, W, pal, t);
    // bats
    const nb = countOf(s, 4, 2, 8);
    for (let i = 0; i < nb; i++) {
      const period = 14 + hash01(i * 7 + 1) * 8;
      const u = mod(t / period + hash01(i * 3), 1);
      const x = -0.1 * w + u * 1.2 * w;
      const y = h * (0.12 + 0.25 * hash01(i * 5)) + Math.sin(u * TAU * 3 + i) * h * 0.05;
      bat(g, x, y, px(s, 0.6, 0.06, 0.16), Math.sin(t * 8 + i * 2), pal);
    }
    // big ghosts
    const ng = countOf(s, 4, 2, 6);
    const spots = [
      [0.1, 0.36],
      [0.9, 0.4],
      [0.25, 0.16],
      [0.62, 0.12],
      [0.4, 0.3],
      [0.82, 0.16],
    ] as const;
    for (let i = 0; i < Math.min(ng, spots.length); i++) {
      const side = spots[i]![0] < 0.5 ? -1 : 1;
      const x = w * spots[i]![0] + Math.sin(t * 0.35 + i * 1.7) * w * 0.04;
      const y = h * spots[i]![1] + Math.sin(t * 0.8 + i) * h * 0.04;
      const size = Math.min(h * 0.3, px(s, 1.0, 0.12, 0.34)) * (i < 2 ? 1 : 0.7);
      ghost(g, x, y, size, {
        color: pal.ghost,
        t: t + i,
        face: FACES[i % 4],
        wave: Math.sin(t * 2 + i) * 0.6,
        glow: 1.4,
        mirror: side > 0,
        blush: '#ff9ac8',
      });
    }
    // pumpkins
    const np = countOf(s, 6, 3, 10);
    for (let i = 0; i < np; i++) {
      const x = w * ((i + 0.5) / np);
      if (Math.abs(x - w * 0.5) < W * 0.08) continue;
      const size = Math.min(h * 0.16, px(s, 0.5, 0.06, 0.2)) * (0.8 + 0.4 * hash01(i * 17));
      pumpkin(g, x, groundY + size * 0.05, size, {
        pal,
        face: i % 6,
        glow: 1.2 + 0.2 * Math.sin(t * 1.5 + i),
        t: t + i,
      });
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.03) },
);

// ---------------------------------------------------------------------------
// Neon Party (wall)
// ---------------------------------------------------------------------------
const PARTY_FRAG = /* glsl */ `
${HEADER}
uniform float uBeat;
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed;
  vec3 col = mix(uA * 0.42, uA * 0.62 + uB * 0.06, uv.y);
  vec3 cs[4];
  cs[0] = uA; cs[1] = uB; cs[2] = uC; cs[3] = vec3(1.0, 0.3, 0.8);
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 c = vec2(0.5 + 0.38 * sin(t * 0.13 + fi * 1.9), 0.55 + 0.3 * cos(t * 0.11 + fi * 2.4));
    float d = length((uv - c) * vec2(aspect, 1.0));
    col += cs[i] * 0.3 * exp(-d * d * 6.0);
  }
  float n = fbm(vec2(uv.x * aspect * 2.0, uv.y * 2.0) + vec2(t * 0.04, 0.0) + uSeed);
  col *= 0.85 + 0.3 * n;
  col *= 1.0 + 0.05 * sin(uTime * uBeat * 6.2831);
  col = max(col, uA * 0.3);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const neonParty: SceneModule = hybridScene(
  'neonParty',
  PARTY_FRAG,
  (s) => ({ ...neonUniforms(s), uBeat: (num(s.params, 'bpm', 108) / 60) * speedOf(s) }),
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time;
    const beat = (t * num(s.params, 'bpm', 108) * speedOf(s)) / 60;
    const { w, h } = s;
    // string lights
    for (let row = 0; row < 2; row++) {
      const y0 = h * (0.06 + row * 0.08);
      const sag = h * (0.07 + row * 0.03);
      g.strokeStyle = '#1a0a2a';
      g.lineWidth = Math.max(1.5, h * 0.004);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const y = y0 + Math.sin(u * Math.PI * 2) ** 2 * sag;
        if (i === 0) g.moveTo(u * w, y);
        else g.lineTo(u * w, y);
      }
      g.stroke();
      const nbulbs = Math.max(10, Math.round(w / Math.max(18, h * 0.06)));
      for (let i = 0; i < nbulbs; i++) {
        const u = (i + 0.5) / nbulbs;
        const y = y0 + Math.sin(u * Math.PI * 2) ** 2 * sag + h * 0.012;
        const col = pal.party[(i + row) % pal.party.length]!;
        const a = 0.75 + 0.25 * Math.sin(t * 1.5 + i * 0.9 + row);
        glowAt(g, u * w, y, h * 0.035, col, a);
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(u * w, y, h * 0.008, h * 0.013, 0, 0, TAU);
        g.fill();
      }
    }
    // stage floor
    const floorY = h * 0.9;
    g.fillStyle = '#1a0830';
    g.fillRect(0, floorY, w, h - floorY);
    const tiles = 12;
    for (let i = 0; i < tiles; i++) {
      const col = pal.party[i % pal.party.length]!;
      g.globalAlpha = 0.6 + 0.25 * Math.sin(beat * Math.PI + i);
      g.fillStyle = col;
      g.fillRect((i / tiles) * w + 2, floorY + 3, w / tiles - 4, h - floorY - 4);
    }
    g.globalAlpha = 1;
    // ghosts in the air
    const ng = countOf(s, 3, 2, 5);
    for (let i = 0; i < ng; i++) {
      const x = w * ((i + 0.5) / ng) + Math.sin(t * 0.4 + i * 2) * w * 0.06;
      const y = h * 0.27 + Math.sin(t * 0.9 + i * 1.3) * h * 0.05;
      ghost(g, x, y, Math.min(h * 0.24, px(s, 0.9, 0.1, 0.26)), {
        color: pal.ghost,
        t: t + i,
        face: FACES[(i + 1) % 4],
        wave: Math.sin(beat * Math.PI + i) * 0.9,
        glow: 1.4,
        mirror: i % 2 === 1,
        blush: '#ff9ac8',
      });
    }
    // skeletons + pumpkins
    const ns = countOf(s, 4, 2, 6);
    const size = Math.min(h * 0.44, px(s, 1.3, 0.15, 0.48));
    for (let i = 0; i < ns; i++) {
      const x = w * ((i + 0.5) / ns);
      skeleton(
        g,
        x,
        floorY - size / 2,
        size,
        dancePose(beat / 2 + i * 0.25, i),
        '#ffffff',
        pal.party[i % pal.party.length],
      );
      if (i < ns - 1) {
        const pxs = w * ((i + 1) / ns);
        const ps = size * 0.3;
        pumpkin(g, pxs, floorY - ps * 0.42, ps, {
          pal,
          face: (i * 2) % 6,
          glow: 1.3,
          t: t + i,
          squash: Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.4,
        });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Neon Fog (floor)
// ---------------------------------------------------------------------------
const FOG_FRAG = /* glsl */ `
${HEADER}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed * 0.035;
  vec2 p = vec2(uv.x * aspect, uv.y) * 2.0;
  vec2 q = vec2(fbm(p + t + uSeed), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + t * 1.5), fbm(p + 3.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p + 3.0 * r);
  float dens = clamp(uDensity, 0.3, 1.6);
  vec3 col = mix(uA * 0.5, uA * 1.05, smoothstep(0.2, 0.8, f));
  col = mix(col, uC * 0.85, smoothstep(0.55, 0.95, r.x) * 0.5 * dens);
  col = mix(col, uB, smoothstep(0.62, 1.0, r.y) * 0.45 * dens);
  col += vec3(0.95, 0.75, 1.0) * pow(smoothstep(0.5, 0.9, f), 3.0) * 0.4;
  col = max(col, uA * 0.32);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const neonFog: SceneModule = hybridScene(
  'neonFog',
  FOG_FRAG,
  neonUniforms,
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const paw = px(s, 0.18, 0.025, 0.06);
    // paw print trails
    const trails = countOf(s, 3, 2, 5);
    for (let k = 0; k < trails; k++) {
      const period = 16;
      const prog = mod(t / period + k / trails, 1) * 1.5;
      const steps = 18;
      const x0 = hash01(k * 31 + 1);
      const y0 = hash01(k * 31 + 2);
      for (let j = 0; j < steps; j++) {
        const u = j / steps;
        const age = prog - u;
        if (age < 0 || age > 0.6) continue;
        const a = clamp01(age * 8) * clamp01((0.6 - age) * 4);
        const cx = (x0 * 0.6 + 0.2 + Math.sin(u * 3 + k) * 0.25) * w;
        const cy = (y0 * 0.2 + u * 0.75 + 0.02) * h;
        const ang = Math.atan2(h * 0.75, Math.cos(u * 3 + k) * 0.75 * w) - Math.PI / 2 + Math.PI;
        const side = j % 2 === 0 ? -1 : 1;
        const ox = Math.cos(ang) * paw * 0.45 * side;
        const oy = Math.sin(ang) * paw * 0.45 * side;
        pawPrint(g, cx + ox, cy + oy, paw, ang + Math.PI, LIME, a);
      }
    }
    // drifting leaves
    const nl = countOf(s, 14, 5, 30);
    for (let i = 0; i < nl; i++) {
      const vx = 0.012 + hash01(i * 5) * 0.02;
      const x = (mod(hash01(i * 7) + t * vx, 1.2) - 0.1) * w;
      const y = (hash01(i * 9) + 0.04 * Math.sin(t * 0.5 + i)) * h;
      const col = i % 3 === 0 ? '#ffb13b' : pal.primary;
      leaf(g, x, y, px(s, 0.2, 0.03, 0.07), t * (0.4 + hash01(i) * 0.6) + i, col, 0.9);
    }
    // little ghosts
    const ng = countOf(s, 2, 1, 4);
    for (let i = 0; i < ng; i++) {
      const cyc = 12 + i * 3;
      const u = mod(t / cyc + i * 0.37, 1);
      const a = Math.sin(u * Math.PI);
      const x = w * (0.15 + 0.7 * hash01(i * 3 + Math.floor(t / cyc + i * 0.37)));
      const y = h * (0.2 + 0.6 * hash01(i * 5 + Math.floor(t / cyc + i * 0.37))) - u * h * 0.08;
      ghost(g, x, y, px(s, 0.55, 0.08, 0.2), {
        color: pal.ghost,
        t: t + i,
        alpha: a,
        face: FACES[i % 4],
        wave: Math.sin(t * 3 + i) * 0.5,
        glow: 1.5,
        blush: '#ff9ac8',
      });
    }
    // black fuzzy spiders (wandering)
    const nsp = countOf(s, 4, 2, 7);
    const ssz = px(s, 0.55, 0.07, 0.2);
    for (let i = 0; i < nsp; i++) {
      const tt = t * 0.06 + i * 10;
      const x = w * (0.1 + 0.8 * noise1(tt, i * 2 + 1));
      const y = h * (0.1 + 0.8 * noise1(tt + 50, i * 2 + 2));
      const x2 = w * (0.1 + 0.8 * noise1(tt + 0.05, i * 2 + 1));
      const y2 = h * (0.1 + 0.8 * noise1(tt + 50.05, i * 2 + 2));
      const ang = Math.atan2(y2 - y, x2 - x);
      const dist = (noise1(tt, i * 2 + 1) + noise1(tt + 50, i * 2 + 2)) * 60;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      fuzzySpider(g, ssz * (0.85 + 0.3 * hash01(i)), dist, 0.25, pal.rim, '#ffe14d', i);
      g.restore();
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.025) },
);

// ---------------------------------------------------------------------------
// Neon Pumpkin Patch (floor / wall)
// ---------------------------------------------------------------------------
const PATCH_FRAG = /* glsl */ `
${HEADER}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed * 0.04;
  vec3 col = mix(uB * 0.8 + uA * 0.15, uA * 0.75, smoothstep(0.0, 0.95, uv.y));
  float n = fbm(vec2(uv.x * aspect * 2.0 + t, uv.y * 3.0 - t * 0.5) + uSeed);
  col += uC * 0.35 * smoothstep(0.55, 0.85, n) * (1.0 - uv.y * 0.6);
  col += uB * 0.25 * exp(-pow((uv.y - 0.2) * 4.0, 2.0));
  col *= 0.85 + 0.3 * n;
  col = max(col, uA * 0.3);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const neonPumpkinPatch: SceneModule = hybridScene('neonPumpkinPatch', PATCH_FRAG, neonUniforms, (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const base = px(s, 0.5, 0.08, 0.22);
  const layout = memo(s, 'patch', () => {
    const rng = createRng(s.seed ^ 0x9e37);
    const cols = Math.max(2, Math.round(w / (base * 1.7)));
    const rows = Math.max(2, Math.round(h / (base * 1.6)));
    const keep = clamp01(0.45 + densityOf(s) * 0.3);
    const out: { x: number; y: number; s: number; face: number; ph: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng() > keep) continue;
        out.push({
          x: ((c + 0.5 + (rng() - 0.5) * 0.5) / cols) * w,
          y: ((r + 0.6 + (rng() - 0.5) * 0.4) / rows) * h,
          s: base * (0.75 + rng() * 0.5),
          face: Math.floor(rng() * 6),
          ph: rng() * TAU,
        });
      }
    }
    return out.sort((a, b) => a.y - b.y);
  });
  // vines
  g.strokeStyle = LIME;
  g.lineWidth = Math.max(2, base * 0.06);
  g.lineCap = 'round';
  g.globalAlpha = 0.85;
  for (let i = 0; i < layout.length - 1; i++) {
    const a = layout[i]!;
    const b = layout[i + 1]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) > base * 3) continue;
    const mx = (a.x + b.x) / 2 + Math.sin(t * 0.5 + i) * base * 0.3;
    const my = (a.y + b.y) / 2 - base * 0.5;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.quadraticCurveTo(mx, my, b.x, b.y);
    g.stroke();
    // curl
    g.beginPath();
    g.arc(mx, my + base * 0.1, base * 0.12, 0, TAU * 0.75);
    g.stroke();
  }
  g.globalAlpha = 1;
  // pumpkins
  for (const p of layout) {
    const bob = Math.sin(t * 1.1 + p.ph) * p.s * 0.03;
    pumpkin(g, p.x, p.y + bob, p.s, {
      pal,
      face: p.face,
      glow: 1.3 + 0.2 * Math.sin(t * 0.9 + p.ph),
      t: t + p.ph,
    });
  }
  // sparkles
  const nsp = countOf(s, 30, 8, 80);
  for (let i = 0; i < nsp; i++) {
    const x = hash01(i * 3 + 1) * w;
    const y = mod(hash01(i * 3 + 2) - t * 0.02 * (0.5 + hash01(i)), 1) * h;
    const a = 0.5 + 0.5 * Math.sin(t * 2 + i);
    star(g, x, y, base * 0.08 * (0.6 + hash01(i * 7)), i % 2 ? pal.secondary : '#ffffff', a);
  }
});

export const neonScenes: SceneModule[] = [neonManor, neonParty, neonFog, neonPumpkinPatch];
