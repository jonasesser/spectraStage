/**
 * Environment kit for the Halloween scenes: painted skies, clouds and moon (GLSL), cached
 * illustration layers (mansion, trees, hills, fences, tombstones) and cheap animated fog.
 *
 * Static artwork is painted once per size/mood into offscreen canvases and only composited per
 * frame. Everything is seeded and deterministic.
 */
import * as THREE from 'three';
import { createRng, type ParamValues, type Rng } from '@spectrastage/shared';
import { TAU, type DrawState } from '@spectrastage/engine';
import { glowSprite } from '../shapes.ts';
import { FBM_GLSL } from './glsl.ts';

// ---------------------------------------------------------------------------
// Environment palettes (per mood)
// ---------------------------------------------------------------------------
export interface EnvPalette {
  skyTop: string;
  skyMid: string;
  skyHorizon: string;
  cloudDark: string;
  cloudLit: string;
  moon: string;
  moonGlow: string;
  stars: number;
  /** Building colors */
  wallTop: string;
  wallBottom: string;
  roof: string;
  roofLit: string;
  trim: string;
  rim: string;
  /** Warm window light: core → edge */
  winCore: string;
  winEdge: string;
  winDark: string;
  /** Silhouette layers: far → near */
  far: string;
  mid: string;
  near: string;
  tree: string;
  treeRim: string;
  grass: string;
  fog: string;
  stone: string;
  stoneLit: string;
  moss: string;
  iron: string;
  /** Neon mode: brighter, more saturated everything. */
  neon: boolean;
}

const ENV: Record<string, EnvPalette> = {
  classic: {
    skyTop: '#05040e',
    skyMid: '#120c2a',
    skyHorizon: '#2a1a3e',
    cloudDark: '#120f22',
    cloudLit: '#5a5478',
    moon: '#fff1c9',
    moonGlow: '#ffe2a0',
    stars: 1,
    wallTop: '#2b2140',
    wallBottom: '#120c1f',
    roof: '#160f26',
    roofLit: '#4a3d6e',
    trim: '#3b2f57',
    rim: '#b9a8e8',
    winCore: '#fff3b0',
    winEdge: '#ff8a1f',
    winDark: '#1c2440',
    far: '#2a2446',
    mid: '#171230',
    near: '#08060f',
    tree: '#0b0814',
    treeRim: '#8a7cc0',
    grass: '#0e0b1a',
    fog: '#8d86b8',
    stone: '#4a4660',
    stoneLit: '#a29fc0',
    moss: '#3f6b3a',
    iron: '#0c0a14',
    neon: false,
  },
  violet: {
    skyTop: '#07031a',
    skyMid: '#1d0c3c',
    skyHorizon: '#4a1d6a',
    cloudDark: '#1a0c33',
    cloudLit: '#9a6ad0',
    moon: '#ffe9ff',
    moonGlow: '#ffb3f0',
    stars: 1,
    wallTop: '#3a1d5c',
    wallBottom: '#170a2c',
    roof: '#1e0c38',
    roofLit: '#7a4ab8',
    trim: '#4f2a7a',
    rim: '#ffb3f0',
    winCore: '#fff0ff',
    winEdge: '#ff5fd0',
    winDark: '#24164a',
    far: '#3d2266',
    mid: '#22103f',
    near: '#0b0518',
    tree: '#0e0620',
    treeRim: '#e08aff',
    grass: '#130826',
    fog: '#c89ae8',
    stone: '#5a4a7a',
    stoneLit: '#c8b0f0',
    moss: '#4a7a5a',
    iron: '#0e0718',
    neon: false,
  },
  green: {
    skyTop: '#020a07',
    skyMid: '#082218',
    skyHorizon: '#1c4a2c',
    cloudDark: '#0a1a12',
    cloudLit: '#5a9a6e',
    moon: '#f2ffe0',
    moonGlow: '#c8ff9a',
    stars: 1,
    wallTop: '#1d3a2c',
    wallBottom: '#0a1a12',
    roof: '#0c2018',
    roofLit: '#3e7a52',
    trim: '#244a36',
    rim: '#a8ffb8',
    winCore: '#f6ffb0',
    winEdge: '#7dff4d',
    winDark: '#10302a',
    far: '#1a3a2c',
    mid: '#0e2419',
    near: '#03100a',
    tree: '#04100a',
    treeRim: '#7dff9e',
    grass: '#06150d',
    fog: '#8ad8a4',
    stone: '#3e5a4c',
    stoneLit: '#9ad0b0',
    moss: '#5aa04a',
    iron: '#04100a',
    neon: false,
  },
  blue: {
    skyTop: '#02040e',
    skyMid: '#081a36',
    skyHorizon: '#1c3a66',
    cloudDark: '#0a1426',
    cloudLit: '#6a8ac0',
    moon: '#f0f8ff',
    moonGlow: '#b8dcff',
    stars: 1,
    wallTop: '#1e2c4a',
    wallBottom: '#0a1224',
    roof: '#0c1630',
    roofLit: '#4a6aa0',
    trim: '#26385e',
    rim: '#bfe4ff',
    winCore: '#fff6c8',
    winEdge: '#ffb84d',
    winDark: '#14244a',
    far: '#1c3058',
    mid: '#0e1a36',
    near: '#030812',
    tree: '#040a16',
    treeRim: '#9ccfff',
    grass: '#050c18',
    fog: '#9ab8e0',
    stone: '#46566e',
    stoneLit: '#b0c4e0',
    moss: '#3e6a5a',
    iron: '#040a14',
    neon: false,
  },
  neon: {
    skyTop: '#2a0a5c',
    skyMid: '#5b1a9a',
    skyHorizon: '#a03ad0',
    cloudDark: '#3b1080',
    cloudLit: '#9dff8a',
    moon: '#ffc94a',
    moonGlow: '#ff8a2e',
    stars: 1,
    wallTop: '#4a2088',
    wallBottom: '#220a44',
    roof: '#22093f',
    roofLit: '#9a4dff',
    trim: '#5a2a9a',
    rim: '#e7a3ff',
    winCore: '#fff2a0',
    winEdge: '#ff8a1a',
    winDark: '#3a1a70',
    far: '#6a2ab0',
    mid: '#3a1270',
    near: '#160530',
    tree: '#14052c',
    treeRim: '#c77dff',
    grass: '#1c0838',
    fog: '#c58aff',
    stone: '#5a3a90',
    stoneLit: '#d0a8ff',
    moss: '#7dff4d',
    iron: '#12042a',
    neon: true,
  },
};

export function envPalette(params: ParamValues): EnvPalette {
  return ENV[String(params.mood ?? 'classic')] ?? (ENV.classic as EnvPalette);
}

export function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function v3(hex: string): THREE.Vector3 {
  return new THREE.Vector3(...hexRgb(hex));
}

/** Linear mix of two hex colors → css rgb(). */
export function mixHex(a: string, b: string, t: number): string {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const c = A.map((v, i) => Math.round((v + ((B[i] as number) - v) * t) * 255));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function rgbaHex(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex).map((v) => Math.round(v * 255));
  return `rgba(${r},${g},${b},${a})`;
}

// ---------------------------------------------------------------------------
// Sky shader: gradient, stars, detailed moon with halo and rays, lit volumetric clouds,
// optional ground fog band. Cheap enough at half resolution (≈ 12 noise octaves / pixel).
// ---------------------------------------------------------------------------
export const SKY_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHor;
uniform vec3 uCloudD; uniform vec3 uCloudL; uniform vec3 uMoonCol; uniform vec3 uGlow; uniform vec3 uFogCol;
uniform vec2 uMoon; uniform float uMoonR; uniform float uClouds; uniform float uStars; uniform float uFog;
uniform float uHorizonY; uniform float uSpeed; uniform float uCloudBand; uniform float uNeon;
varying vec2 vUv;
${FBM_GLSL}
float fbm3(vec2 p) {
  float v = 0.5 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.25 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.125 * vnoise(p);
  return v / 0.875;
}
float fbm4(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.07 + vec2(11.3, 4.7); a *= 0.5; }
  return v / 0.9375;
}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);
  float t = uTime * uSpeed;
  // --- sky gradient
  vec3 col = mix(uHor, uMid, smoothstep(uHorizonY - 0.05, uHorizonY + 0.4, uv.y));
  col = mix(col, uTop, smoothstep(uHorizonY + 0.35, 1.0, uv.y));
  // --- moon geometry
  vec2 mc = vec2(uMoon.x * aspect, uMoon.y);
  vec2 mp = p - mc;
  float md = length(mp) / max(uMoonR, 1e-3);
  // halo (behind clouds)
  col += uGlow * (0.42 * exp(-md * 0.9) + 0.22 * exp(-md * 0.28)) * (0.75 + 0.25 * uNeon);
  // soft light rays
  float ang = atan(mp.y, mp.x);
  float rays = vnoise(vec2(ang * 7.0 + uSeed, t * 0.03)) * vnoise(vec2(ang * 13.0 - 3.0, t * 0.02));
  col += uGlow * rays * 0.35 * exp(-md * 0.22) * smoothstep(1.0, 1.6, md);
  // --- stars (grid hashed, twinkling), only in the sky part
  vec2 sp = p * 70.0;
  vec2 cell = floor(sp);
  float h = hash21(cell + uSeed);
  if (h > 0.9) {
    vec2 off = vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5;
    float d = length(fract(sp) - 0.5 - off * 0.6);
    float tw = 0.55 + 0.45 * sin(t * (0.8 + h * 2.5) + h * 40.0);
    float s = smoothstep(0.09, 0.0, d) * tw * (h - 0.9) * 10.0;
    col += vec3(1.0, 0.97, 0.9) * s * uStars * smoothstep(uHorizonY + 0.1, uHorizonY + 0.45, uv.y) * smoothstep(1.4, 3.0, md);
  }
  // --- moon disc with maria, craters and limb darkening
  if (md < 1.15) {
    vec2 q = mp / uMoonR;
    float maria = fbm3(q * 1.8 + 4.0 + uSeed);
    float crater = smoothstep(0.5, 0.9, fbm3(q * 4.0 + 9.0)) * 0.3;
    vec3 surf = uMoonCol * (0.8 + 0.26 * smoothstep(0.3, 0.8, maria) - crater * 0.5);
    surf *= 1.0 - 0.28 * md * md;
    surf += uMoonCol * 0.15 * smoothstep(0.7, 1.0, md) * step(0.0, -q.x - q.y);
    col = mix(col, surf, smoothstep(1.0, 0.96, md));
  }
  // --- clouds: two layers, lit from the moon (silver lining), with density shadow
  vec2 L = normalize(mc - p + 1e-4);
  float prox = exp(-md * 0.18);
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 sc = vec2(1.1 + fk * 0.9, 2.6 + fk * 1.6);
    vec2 q = p * sc + vec2(t * (0.018 + fk * 0.012), fk * 3.7) + uSeed * (1.0 + fk);
    float d = fbm4(q);
    float band = smoothstep(uHorizonY + 0.05, uHorizonY + 0.3, uv.y) * (1.0 - smoothstep(uCloudBand, uCloudBand + 0.45, uv.y) * 0.65);
    float c = smoothstep(0.58 - uClouds * 0.2, 0.8 - uClouds * 0.12, d) * band;
    if (c > 0.002) {
      float dl = fbm3(q + L * sc * 0.06);
      float lit = clamp((d - dl) * 5.0 + 0.45, 0.0, 1.0);
      vec3 cc = mix(uCloudD, uCloudL, lit * (0.35 + 0.65 * prox));
      // silver lining at thin edges close to the moon
      float edge = smoothstep(0.0, 0.25, c) * (1.0 - smoothstep(0.25, 0.75, c));
      cc += uMoonCol * edge * prox * 0.9;
      col = mix(col, cc, c * (0.82 - fk * 0.12) * mix(0.15, 1.0, smoothstep(0.95, 1.8, md)));
    }
  }
  // --- ground fog band
  if (uFog > 0.0) {
    vec2 fq = vec2(p.x * 1.6 + t * 0.03, uv.y * 7.0 - t * 0.01) + uSeed;
    float fd = fbm3(fq);
    float fb = smoothstep(uHorizonY + 0.12, uHorizonY - 0.08, uv.y);
    col = mix(col, uFogCol, smoothstep(0.35, 0.8, fd) * fb * uFog);
  }
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

export interface SkyOpts {
  moon: [number, number];
  /** Moon radius as fraction of the surface height. */
  moonR: number;
  clouds?: number;
  fog?: number;
  horizonY?: number;
  cloudBand?: number;
  stars?: number;
}

export function skyUniforms(s: DrawState, env: EnvPalette, o: SkyOpts, speed = 1) {
  return {
    uTop: v3(env.skyTop),
    uMid: v3(env.skyMid),
    uHor: v3(env.skyHorizon),
    uCloudD: v3(env.cloudDark),
    uCloudL: v3(env.cloudLit),
    uMoonCol: v3(env.moon),
    uGlow: v3(env.moonGlow),
    uFogCol: v3(env.fog),
    uMoon: new THREE.Vector2(o.moon[0], 1 - o.moon[1]),
    uMoonR: o.moonR,
    uClouds: o.clouds ?? 1,
    uStars: (o.stars ?? 1) * env.stars,
    uFog: o.fog ?? 0,
    uHorizonY: o.horizonY ?? 0.15,
    uCloudBand: o.cloudBand ?? 0.55,
    uSpeed: speed,
    uNeon: env.neon ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------
export function offscreen(w: number, h: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = Math.max(2, Math.ceil(w));
  c.height = Math.max(2, Math.ceil(h));
  const g = c.getContext('2d')!;
  return { c, g };
}

function vgrad(
  g: CanvasRenderingContext2D,
  y0: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function hgrad(
  g: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  stops: [number, string][],
): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

/** Additive glow sprite (uses the shared cached sprite). */
export function addGlow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  a: number,
): void {
  if (r <= 0 || a <= 0) return;
  const prev = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = Math.min(1, a);
  g.drawImage(glowSprite(color), x - r, y - r, r * 2, r * 2);
  g.globalAlpha = 1;
  g.globalCompositeOperation = prev;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------
export type WinShape = 'rect' | 'arch' | 'gothic' | 'round';
export interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
  shape: WinShape;
  lit: boolean;
  seed: number;
}

export function winPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  shape: WinShape,
): void {
  g.beginPath();
  if (shape === 'round') {
    g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, TAU);
    return;
  }
  if (shape === 'rect') {
    g.rect(x, y, w, h);
    return;
  }
  if (shape === 'arch') {
    g.moveTo(x, y + h);
    g.lineTo(x, y + w / 2);
    g.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
    g.lineTo(x + w, y + h);
    g.closePath();
    return;
  }
  // gothic pointed arch
  g.moveTo(x, y + h);
  g.lineTo(x, y + w * 0.6);
  g.quadraticCurveTo(x, y + w * 0.1, x + w / 2, y);
  g.quadraticCurveTo(x + w, y + w * 0.1, x + w, y + w * 0.6);
  g.lineTo(x + w, y + h);
  g.closePath();
}

/** Paints a detailed window (frame, sill, glass with warm interior or cold reflection, mullions). */
export function paintWindow(
  g: CanvasRenderingContext2D,
  win: Win,
  env: EnvPalette,
  rng: Rng,
  lightDir: number,
): void {
  const { x, y, w, h, shape, lit } = win;
  const f = Math.max(1, w * 0.12);
  // outer frame / casing
  g.fillStyle = env.trim;
  winPath(g, x - f, y - f, w + f * 2, h + f * 1.5, shape);
  g.fill();
  // highlight on moon side of the casing
  g.fillStyle = rgbaHex(env.rim, 0.28);
  g.fillRect(lightDir < 0 ? x - f : x + w, y + (shape === 'rect' ? -f : w * 0.5), f, h * 0.9);
  // sill
  g.fillStyle = mixHex(env.trim, env.rim, 0.35);
  g.fillRect(x - f * 1.6, y + h + f * 0.2, w + f * 3.2, f * 0.9);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(x - f * 1.4, y + h + f * 1.1, w + f * 2.8, f * 0.5);
  // glass
  g.save();
  winPath(g, x, y, w, h, shape);
  g.clip();
  if (lit) {
    const gr = g.createRadialGradient(
      x + w / 2,
      y + h * 0.62,
      0,
      x + w / 2,
      y + h * 0.55,
      Math.max(w, h) * 0.75,
    );
    gr.addColorStop(0, env.winCore);
    gr.addColorStop(0.45, mixHex(env.winCore, env.winEdge, 0.5));
    gr.addColorStop(1, mixHex(env.winEdge, '#3a0a00', 0.45));
    g.fillStyle = gr;
    g.fillRect(x, y, w, h);
    // interior: curtains, occasional silhouette
    const curtain = mixHex(env.winEdge, '#2a0500', 0.55);
    g.fillStyle = curtain;
    g.globalAlpha = 0.85;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + w * 0.32, y + h * 0.45, x + w * 0.12, y + h);
    g.lineTo(x, y + h);
    g.closePath();
    g.moveTo(x + w, y);
    g.quadraticCurveTo(x + w * 0.68, y + h * 0.45, x + w * 0.88, y + h);
    g.lineTo(x + w, y + h);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
    const sil = rng();
    if (sil < 0.18) {
      // candle
      g.fillStyle = '#2a0e04';
      g.fillRect(x + w * 0.46, y + h * 0.72, w * 0.08, h * 0.22);
      g.fillStyle = '#fffbe0';
      g.beginPath();
      g.ellipse(x + w * 0.5, y + h * 0.68, w * 0.04, h * 0.05, 0, 0, TAU);
      g.fill();
    } else if (sil < 0.32) {
      // cat silhouette on the sill
      const cx = x + w * (0.35 + rng() * 0.3);
      const by = y + h;
      const s = Math.min(w, h) * 0.55;
      g.fillStyle = '#12040a';
      g.beginPath();
      g.ellipse(cx, by - s * 0.28, s * 0.26, s * 0.3, 0, 0, TAU);
      g.arc(cx + s * 0.02, by - s * 0.66, s * 0.18, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(cx - s * 0.16, by - s * 0.72);
      g.lineTo(cx - s * 0.12, by - s * 0.92);
      g.lineTo(cx - s * 0.02, by - s * 0.8);
      g.lineTo(cx + s * 0.08, by - s * 0.92);
      g.lineTo(cx + s * 0.18, by - s * 0.72);
      g.fill();
      g.fillStyle = '#d6ff6b';
      g.beginPath();
      g.arc(cx - s * 0.05, by - s * 0.67, s * 0.025, 0, TAU);
      g.arc(cx + s * 0.08, by - s * 0.67, s * 0.025, 0, TAU);
      g.fill();
    }
  } else {
    g.fillStyle = vgrad(g, y, y + h, [
      [0, mixHex(env.winDark, env.rim, 0.25)],
      [0.5, env.winDark],
      [1, '#05060c'],
    ]);
    g.fillRect(x, y, w, h);
    // moon reflection streak
    g.fillStyle = rgbaHex(env.rim, 0.22);
    g.beginPath();
    g.moveTo(x + w * 0.15, y + h);
    g.lineTo(x + w * 0.45, y);
    g.lineTo(x + w * 0.6, y);
    g.lineTo(x + w * 0.3, y + h);
    g.fill();
  }
  // mullions (filled bars)
  const mb = Math.max(1, w * 0.07);
  g.fillStyle = mixHex(env.trim, '#000000', 0.35);
  g.fillRect(x + w / 2 - mb / 2, y, mb, h);
  g.fillRect(x, y + h * (shape === 'rect' ? 0.5 : 0.58) - mb / 2, w, mb);
  // inner shadow
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(x, y, w, mb * 0.8);
  g.restore();
}

// ---------------------------------------------------------------------------
// Haunted mansion (Victorian). Painted once into an offscreen canvas.
// ---------------------------------------------------------------------------
export interface Manor {
  canvas: HTMLCanvasElement;
  /** Canvas placement: draw at (cx - ox, groundY - oy). */
  ox: number;
  oy: number;
  /** Lit windows in canvas coordinates (for per-frame flicker / ghosts). */
  windows: Win[];
  door: { x: number; y: number; w: number; h: number };
  lamps: { x: number; y: number }[];
  height: number;
}

interface Block {
  x: number;
  w: number;
  h: number;
  roof: 'gable' | 'hip' | 'cone' | 'mansard' | 'spire';
  roofH: number;
  depth: number;
}

/**
 * @param W total width in px. Height ≈ 0.95 W.
 * @param lightDir -1 = moon on the left, +1 = moon on the right.
 */
export function buildManor(W: number, env: EnvPalette, seed: number, lightDir: number): Manor {
  const H = W * 1.0;
  const pad = W * 0.06;
  const { c, g } = offscreen(W + pad * 2, H + pad * 2);
  const rng = createRng(seed ^ 0x6d616e6f);
  const ox = W / 2 + pad;
  const gy = H + pad; // ground line in canvas
  const X = (u: number) => ox + u * W;
  const Y = (v: number) => gy - v * W;
  const windows: Win[] = [];
  const lamps: { x: number; y: number }[] = [];

  // Blocks back-to-front (depth 0 = back)
  const blocks: Block[] = [
    { x: -0.47, w: 0.27, h: 0.36, roof: 'hip', roofH: 0.13, depth: 0 }, // left wing
    { x: 0.2, w: 0.25, h: 0.4, roof: 'gable', roofH: 0.16, depth: 0 }, // right wing
    { x: -0.24, w: 0.48, h: 0.5, roof: 'mansard', roofH: 0.15, depth: 1 }, // main block
    { x: -0.085, w: 0.17, h: 0.74, roof: 'spire', roofH: 0.26, depth: 2 }, // central tower
    { x: 0.37, w: 0.13, h: 0.58, roof: 'cone', roofH: 0.22, depth: 2 }, // right turret
    { x: -0.4, w: 0.12, h: 0.5, roof: 'cone', roofH: 0.18, depth: 1 }, // left turret
  ];

  // Soft backlight halo from the moon side
  addGlow(g, X(lightDir * 0.1), Y(0.45), W * 0.5, env.rim, env.neon ? 0.3 : 0.14);

  // chimneys (behind roofs)
  for (const [u, hh] of [
    [-0.36, 0.56],
    [0.3, 0.62],
    [-0.16, 0.72],
  ] as const) {
    const cw = W * 0.045;
    g.fillStyle = vgrad(g, Y(hh), Y(0.3), [
      [0, env.trim],
      [1, env.wallBottom],
    ]);
    g.fillRect(X(u), Y(hh), cw, Y(0.3) - Y(hh));
    g.fillStyle = mixHex(env.trim, env.rim, 0.3);
    g.fillRect(X(u) - cw * 0.15, Y(hh), cw * 1.3, cw * 0.35);
    g.fillStyle = rgbaHex(env.rim, 0.25);
    g.fillRect(lightDir < 0 ? X(u) : X(u) + cw * 0.8, Y(hh) + cw * 0.35, cw * 0.2, Y(0.3) - Y(hh));
  }

  for (const b of blocks) {
    const x0 = X(b.x);
    const x1 = X(b.x + b.w);
    const top = Y(b.h);
    const bw = x1 - x0;
    const depthShade = 0.25 - b.depth * 0.1;
    // ---- wall
    g.fillStyle = vgrad(g, top, gy, [
      [0, mixHex(env.wallTop, env.near, depthShade)],
      [1, mixHex(env.wallBottom, env.near, depthShade)],
    ]);
    g.fillRect(x0, top, bw, gy - top);
    // clapboard siding texture
    const step = Math.max(3, W * 0.012);
    g.fillStyle = 'rgba(0,0,0,0.18)';
    for (let yy = top + step; yy < gy; yy += step) g.fillRect(x0, yy, bw, Math.max(1, step * 0.18));
    g.fillStyle = rgbaHex(env.rim, 0.05);
    for (let yy = top + step * 1.2; yy < gy; yy += step) g.fillRect(x0, yy, bw, Math.max(1, step * 0.12));
    // side shading (cylindrical feel for towers) + moon-side rim
    g.fillStyle = hgrad(g, x0, x1, [
      [0, lightDir < 0 ? rgbaHex(env.rim, 0.14) : 'rgba(0,0,0,0.35)'],
      [0.25, 'rgba(0,0,0,0)'],
      [0.75, 'rgba(0,0,0,0)'],
      [1, lightDir > 0 ? rgbaHex(env.rim, 0.14) : 'rgba(0,0,0,0.35)'],
    ]);
    g.fillRect(x0, top, bw, gy - top);
    g.fillStyle = rgbaHex(env.rim, env.neon ? 0.7 : 0.45);
    g.fillRect(lightDir < 0 ? x0 : x1 - Math.max(1, W * 0.004), top, Math.max(1, W * 0.004), gy - top);
    // ambient occlusion under the eaves
    g.fillStyle = vgrad(g, top, top + W * 0.06, [
      [0, 'rgba(0,0,0,0.55)'],
      [1, 'rgba(0,0,0,0)'],
    ]);
    g.fillRect(x0, top, bw, W * 0.06);
    // corner boards & band between floors
    g.fillStyle = env.trim;
    const cb = Math.max(2, W * 0.008);
    g.fillRect(x0, top, cb, gy - top);
    g.fillRect(x1 - cb, top, cb, gy - top);
    for (let fl = 1; fl < 4; fl++) {
      const fy = gy - fl * W * 0.2;
      if (fy <= top + W * 0.05) break;
      g.fillRect(x0, fy, bw, cb * 1.2);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x0, fy + cb * 1.2, bw, cb * 0.8);
      g.fillStyle = env.trim;
    }

    // ---- roof
    const ov = W * 0.018;
    const rTop = Y(b.h + b.roofH);
    g.beginPath();
    if (b.roof === 'gable' || b.roof === 'spire' || b.roof === 'cone') {
      g.moveTo(x0 - ov, top);
      if (b.roof === 'cone') {
        g.quadraticCurveTo(x0 + bw * 0.3, top - (top - rTop) * 0.35, x0 + bw / 2, rTop);
        g.quadraticCurveTo(x1 - bw * 0.3, top - (top - rTop) * 0.35, x1 + ov, top);
      } else {
        g.lineTo(x0 + bw / 2, rTop);
        g.lineTo(x1 + ov, top);
      }
    } else if (b.roof === 'hip') {
      g.moveTo(x0 - ov, top);
      g.lineTo(x0 + bw * 0.25, rTop);
      g.lineTo(x1 - bw * 0.25, rTop);
      g.lineTo(x1 + ov, top);
    } else {
      // mansard: steep lower slope + flat top with cresting
      g.moveTo(x0 - ov, top);
      g.lineTo(x0 + bw * 0.08, rTop);
      g.lineTo(x1 - bw * 0.08, rTop);
      g.lineTo(x1 + ov, top);
    }
    g.closePath();
    g.save();
    g.fillStyle = vgrad(g, rTop, top, [
      [0, env.roofLit],
      [0.35, env.roof],
      [1, mixHex(env.roof, '#000000', 0.4)],
    ]);
    g.fill();
    g.clip();
    // scalloped shingles
    const sh = Math.max(3, W * 0.016);
    for (let yy = rTop + sh, row = 0; yy < top + sh; yy += sh * 0.8, row++) {
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let xx = x0 - ov + (row % 2) * sh * 0.5; xx < x1 + ov; xx += sh) {
        g.beginPath();
        g.arc(xx, yy, sh * 0.5, 0, Math.PI);
        g.fill();
      }
      g.fillStyle = rgbaHex(env.roofLit, 0.12);
      g.fillRect(x0 - ov, yy - sh * 0.5, x1 - x0 + ov * 2, Math.max(1, sh * 0.12));
    }
    // moon-side light on the roof
    g.fillStyle = hgrad(g, x0, x1, [
      [0, lightDir < 0 ? rgbaHex(env.rim, 0.28) : 'rgba(0,0,0,0.25)'],
      [0.5, 'rgba(0,0,0,0)'],
      [1, lightDir > 0 ? rgbaHex(env.rim, 0.28) : 'rgba(0,0,0,0.25)'],
    ]);
    g.fillRect(x0 - ov, rTop, bw + ov * 2, top - rTop);
    g.restore();
    // eave fascia
    g.fillStyle = mixHex(env.trim, env.rim, 0.2);
    g.fillRect(x0 - ov, top - cb * 0.5, bw + ov * 2, cb * 1.4);
    // finial / spire tip / cresting
    if (b.roof === 'spire' || b.roof === 'cone') {
      const tx = x0 + bw / 2;
      g.fillStyle = env.iron;
      g.fillRect(tx - cb * 0.4, rTop - W * 0.07, cb * 0.8, W * 0.07);
      g.beginPath();
      g.arc(tx, rTop - W * 0.035, cb * 1.3, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(tx, rTop - W * 0.09);
      g.lineTo(tx + cb * 1.2, rTop - W * 0.07);
      g.lineTo(tx, rTop - W * 0.065);
      g.lineTo(tx - cb * 1.2, rTop - W * 0.07);
      g.fill();
    }
    if (b.roof === 'mansard' || b.roof === 'hip') {
      g.fillStyle = env.iron;
      const x2 = b.roof === 'mansard' ? x0 + bw * 0.08 : x0 + bw * 0.25;
      const x3 = b.roof === 'mansard' ? x1 - bw * 0.08 : x1 - bw * 0.25;
      g.fillRect(x2, rTop - cb, x3 - x2, cb);
      for (let xx = x2; xx <= x3; xx += W * 0.015) {
        g.fillRect(xx - cb * 0.25, rTop - W * 0.02, cb * 0.5, W * 0.02);
        g.beginPath();
        g.moveTo(xx, rTop - W * 0.03);
        g.lineTo(xx + cb * 0.7, rTop - W * 0.018);
        g.lineTo(xx - cb * 0.7, rTop - W * 0.018);
        g.fill();
      }
    }
    // gable decoration: round window / dormer
    if (b.roof === 'gable') {
      const rw = bw * 0.22;
      windows.push({
        x: x0 + bw / 2 - rw / 2,
        y: top - (top - rTop) * 0.62,
        w: rw,
        h: rw,
        shape: 'round',
        lit: true,
        seed: windows.length,
      });
    }
    if (b.roof === 'mansard') {
      for (const u of [0.2, 0.8]) {
        const dw = bw * 0.12;
        const dx = x0 + bw * u - dw / 2;
        const dy = rTop + (top - rTop) * 0.2;
        // dormer
        g.fillStyle = env.wallTop;
        g.fillRect(dx - dw * 0.25, dy, dw * 1.5, top - dy);
        g.fillStyle = env.roof;
        g.beginPath();
        g.moveTo(dx - dw * 0.4, dy);
        g.lineTo(dx + dw / 2, dy - dw * 0.6);
        g.lineTo(dx + dw * 1.4, dy);
        g.closePath();
        g.fill();
        g.fillStyle = rgbaHex(env.rim, 0.35);
        g.fillRect(lightDir < 0 ? dx - dw * 0.25 : dx + dw * 1.2, dy, Math.max(1, W * 0.003), top - dy);
        windows.push({
          x: dx,
          y: dy + dw * 0.1,
          w: dw,
          h: (top - dy) * 0.7,
          shape: 'arch',
          lit: rng() < 0.7,
          seed: windows.length,
        });
      }
    }

    // ---- windows per block
    const floors = Math.max(1, Math.floor((b.h - 0.08) / 0.2));
    const cols = b.w > 0.3 ? 4 : b.w > 0.2 ? 2 : 1;
    for (let fl = 0; fl < floors; fl++) {
      for (let ci = 0; ci < cols; ci++) {
        const ww = (bw / cols) * (cols === 1 ? 0.42 : 0.42);
        const wh = W * 0.1;
        const wx = x0 + (bw / cols) * (ci + 0.5) - ww / 2;
        const wy = gy - (fl + 1) * W * 0.2 + W * 0.05;
        if (wy < top + W * 0.03) continue;
        // keep room for the porch door in the main block ground floor
        if (b.depth === 1 && b.w > 0.4 && fl === 0 && (ci === 1 || ci === 2)) continue;
        const shape: WinShape =
          b.roof === 'spire' ? 'gothic' : b.roof === 'cone' ? 'arch' : fl === 0 ? 'rect' : 'arch';
        windows.push({ x: wx, y: wy, w: ww, h: wh, shape, lit: rng() < 0.72, seed: windows.length });
      }
    }
    // tower clock / rose window
    if (b.roof === 'spire') {
      const rr = bw * 0.28;
      windows.push({
        x: x0 + bw / 2 - rr,
        y: top + W * 0.03,
        w: rr * 2,
        h: rr * 2,
        shape: 'round',
        lit: true,
        seed: windows.length,
      });
    }
  }

  // paint windows (after all walls so later blocks don't overpaint)
  for (const win of windows) paintWindow(g, win, env, rng, lightDir);
  // light spill on the façade below lit windows
  for (const win of windows)
    if (win.lit)
      addGlow(g, win.x + win.w / 2, win.y + win.h * 0.6, win.w * 1.6, env.winEdge, env.neon ? 0.35 : 0.22);

  // ---- porch with columns, roof, steps and door
  const px0 = X(-0.16);
  const px1 = X(0.16);
  const pTop = Y(0.17);
  const door = { x: X(-0.045), y: Y(0.135), w: W * 0.09, h: Y(0) - Y(0.135) };
  // door light
  g.fillStyle = vgrad(g, door.y, door.y + door.h, [
    [0, env.winCore],
    [1, env.winEdge],
  ]);
  winPath(g, door.x, door.y, door.w, door.h, 'arch');
  g.fill();
  // double doors, slightly ajar
  g.fillStyle = vgrad(g, door.y, door.y + door.h, [
    [0, '#4a2412'],
    [1, '#240e06'],
  ]);
  g.save();
  winPath(g, door.x, door.y, door.w, door.h, 'arch');
  g.clip();
  g.fillRect(door.x, door.y, door.w * 0.42, door.h);
  g.fillRect(door.x + door.w * 0.62, door.y, door.w * 0.38, door.h);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (const dx of [0.08, 0.7])
    for (const dy of [0.25, 0.6])
      g.fillRect(door.x + door.w * dx, door.y + door.h * dy, door.w * 0.22, door.h * 0.25);
  g.restore();
  addGlow(g, door.x + door.w / 2, door.y + door.h * 0.7, door.w * 1.5, env.winEdge, 0.4);
  // porch roof
  g.fillStyle = vgrad(g, pTop - W * 0.05, pTop, [
    [0, env.roofLit],
    [1, env.roof],
  ]);
  g.beginPath();
  g.moveTo(px0 - W * 0.02, pTop);
  g.lineTo(px0 + W * 0.02, pTop - W * 0.05);
  g.lineTo(px1 - W * 0.02, pTop - W * 0.05);
  g.lineTo(px1 + W * 0.02, pTop);
  g.closePath();
  g.fill();
  g.fillStyle = mixHex(env.trim, env.rim, 0.25);
  g.fillRect(px0 - W * 0.02, pTop, px1 - px0 + W * 0.04, W * 0.012);
  // columns
  for (const u of [-0.15, -0.075, 0.075, 0.15]) {
    const cx = X(u);
    const cw = W * 0.014;
    g.fillStyle = hgrad(g, cx - cw / 2, cx + cw / 2, [
      [0, lightDir < 0 ? env.rim : env.trim],
      [0.5, mixHex(env.trim, env.rim, 0.4)],
      [1, lightDir > 0 ? env.rim : env.wallBottom],
    ]);
    g.fillRect(cx - cw / 2, pTop + W * 0.012, cw, gy - pTop - W * 0.012);
  }
  // porch railing
  g.fillStyle = mixHex(env.trim, env.rim, 0.2);
  g.fillRect(px0, gy - W * 0.045, X(-0.06) - px0, W * 0.008);
  g.fillRect(X(0.06), gy - W * 0.045, px1 - X(0.06), W * 0.008);
  for (let xx = px0; xx < px1; xx += W * 0.012) {
    if (xx > X(-0.06) && xx < X(0.06)) continue;
    g.fillRect(xx, gy - W * 0.045, Math.max(1, W * 0.004), W * 0.045);
  }
  // steps
  for (let i = 0; i < 3; i++) {
    g.fillStyle = mixHex(env.stone, '#000000', 0.3 + i * 0.1);
    g.fillRect(X(-0.07) - i * W * 0.012, gy - W * 0.012 * (3 - i), W * 0.14 + i * W * 0.024, W * 0.012);
  }
  // porch lamps
  for (const u of [-0.11, 0.11]) {
    const lx = X(u);
    const ly = Y(0.11);
    lamps.push({ x: lx, y: ly });
    g.fillStyle = env.iron;
    g.fillRect(lx - W * 0.008, ly - W * 0.018, W * 0.016, W * 0.03);
    g.fillStyle = env.winCore;
    g.fillRect(lx - W * 0.005, ly - W * 0.012, W * 0.01, W * 0.018);
  }

  // foundation stones
  g.fillStyle = vgrad(g, gy - W * 0.03, gy, [
    [0, mixHex(env.stone, env.near, 0.4)],
    [1, env.near],
  ]);
  g.fillRect(X(-0.48), gy - W * 0.025, W * 0.98, W * 0.025);
  return { canvas: c, ox, oy: gy, windows, door, lamps, height: H };
}

// ---------------------------------------------------------------------------
// Trees: recursive tapered branches, filled with a moon-side rim light.
// ---------------------------------------------------------------------------
interface Branch {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  cx: number;
  cy: number;
  w1: number;
  w2: number;
}

function growTree(seed: number, x: number, y: number, h: number): Branch[] {
  const rng = createRng(seed);
  const out: Branch[] = [];
  const grow = (x1: number, y1: number, len: number, ang: number, w: number, depth: number) => {
    const bend = (rng() - 0.5) * 0.6;
    const x2 = x1 + Math.cos(ang) * len;
    const y2 = y1 + Math.sin(ang) * len;
    const mx = (x1 + x2) / 2 + Math.cos(ang + Math.PI / 2) * len * bend * 0.25;
    const my = (y1 + y2) / 2 + Math.sin(ang + Math.PI / 2) * len * bend * 0.25;
    const w2 = w * (depth > 0 ? 0.68 : 0.15);
    out.push({ x1, y1, x2, y2, cx: mx, cy: my, w1: w, w2 });
    if (depth <= 0) return;
    const n = depth >= 5 ? 2 : 2 + (rng() < 0.45 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const spread = 0.42 + rng() * 0.45;
      const a = ang + (i - (n - 1) / 2) * spread + (rng() - 0.5) * 0.4 + bend * 0.5;
      grow(x2, y2, len * (0.66 + rng() * 0.16), a, w2 * (0.8 + rng() * 0.25), depth - 1);
    }
  };
  grow(x, y, h * 0.34, -Math.PI / 2 + (rng() - 0.5) * 0.18, h * 0.075, 5);
  return out;
}

function branchPath(g: CanvasRenderingContext2D, b: Branch, dx = 0, dy = 0): void {
  const ang = Math.atan2(b.y2 - b.y1, b.x2 - b.x1);
  const nx = Math.cos(ang + Math.PI / 2);
  const ny = Math.sin(ang + Math.PI / 2);
  const wm = (b.w1 + b.w2) / 2;
  g.moveTo(b.x1 + nx * b.w1 * 0.5 + dx, b.y1 + ny * b.w1 * 0.5 + dy);
  g.quadraticCurveTo(
    b.cx + nx * wm * 0.5 + dx,
    b.cy + ny * wm * 0.5 + dy,
    b.x2 + nx * b.w2 * 0.5 + dx,
    b.y2 + ny * b.w2 * 0.5 + dy,
  );
  g.lineTo(b.x2 - nx * b.w2 * 0.5 + dx, b.y2 - ny * b.w2 * 0.5 + dy);
  g.quadraticCurveTo(
    b.cx - nx * wm * 0.5 + dx,
    b.cy - ny * wm * 0.5 + dy,
    b.x1 - nx * b.w1 * 0.5 + dx,
    b.y1 - ny * b.w1 * 0.5 + dy,
  );
  g.closePath();
  g.moveTo(b.x1 + b.w1 * 0.5 + dx, b.y1 + dy);
  g.arc(b.x1 + dx, b.y1 + dy, b.w1 * 0.5, 0, TAU);
}

/** Paints a gnarled bare tree (base at x,y, height h) with rim light from `lightDir`. */
export function paintTree(
  g: CanvasRenderingContext2D,
  seed: number,
  x: number,
  y: number,
  h: number,
  env: EnvPalette,
  lightDir: number,
  fill = env.tree,
  rimAlpha = 0.9,
): void {
  const br = growTree(seed, x, y, h);
  // roots flare
  g.fillStyle = fill;
  g.beginPath();
  g.moveTo(x - h * 0.12, y);
  g.quadraticCurveTo(x - h * 0.03, y - h * 0.02, x - h * 0.03, y - h * 0.12);
  g.lineTo(x + h * 0.03, y - h * 0.12);
  g.quadraticCurveTo(x + h * 0.03, y - h * 0.02, x + h * 0.13, y);
  g.closePath();
  g.fill();
  // body, then a moon-side rim on the thicker limbs only (thin twigs stay pure silhouette)
  g.fillStyle = fill;
  g.beginPath();
  for (const b of br) branchPath(g, b);
  g.fill();
  if (rimAlpha > 0) {
    const off = Math.max(1, h * 0.004);
    g.save();
    g.beginPath();
    for (const b of br) if (b.w1 > off * 2.5) branchPath(g, b);
    g.clip();
    g.fillStyle = rgbaHex(env.treeRim, rimAlpha * 0.55);
    g.beginPath();
    for (const b of br) if (b.w1 > off * 2.5) branchPath(g, b);
    g.fill();
    g.fillStyle = fill;
    g.beginPath();
    for (const b of br) if (b.w1 > off * 2.5) branchPath(g, b, -lightDir * off * 1.6, off);
    g.fill();
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// Hills / ground silhouettes (atmospheric perspective via colors passed in).
// ---------------------------------------------------------------------------
export function paintHills(
  g: CanvasRenderingContext2D,
  w: number,
  baseY: number,
  amp: number,
  bottom: number,
  top: string,
  bot: string,
  seed: number,
  freq = 2,
): void {
  const rng = createRng(seed);
  const ph = [rng() * TAU, rng() * TAU, rng() * TAU];
  g.fillStyle = vgrad(g, baseY - amp, bottom, [
    [0, top],
    [1, bot],
  ]);
  g.beginPath();
  g.moveTo(0, bottom);
  const n = 64;
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const y =
      baseY -
      amp *
        (0.55 * Math.sin(u * TAU * freq * 0.5 + ph[0]!) +
          0.3 * Math.sin(u * TAU * freq * 1.3 + ph[1]!) +
          0.15 * Math.sin(u * TAU * freq * 3.1 + ph[2]!));
    g.lineTo(u * w, y);
  }
  g.lineTo(w, bottom);
  g.closePath();
  g.fill();
}

/** Grass tufts along a ground line (filled blades). */
export function paintGrass(
  g: CanvasRenderingContext2D,
  w: number,
  y: number,
  size: number,
  color: string,
  rim: string,
  seed: number,
  density = 1,
): void {
  const rng = createRng(seed);
  const n = Math.round((w / size) * 3 * density);
  for (let i = 0; i < n; i++) {
    const x = rng() * w;
    const blades = 3 + Math.floor(rng() * 3);
    for (let b = 0; b < blades; b++) {
      const bh = size * (0.4 + rng() * 0.8);
      const lean = (rng() - 0.5) * size * 0.6;
      const bw = size * 0.06;
      g.fillStyle = rng() < 0.25 ? rim : color;
      g.beginPath();
      g.moveTo(x + b * bw * 1.5 - bw, y + size * 0.1);
      g.quadraticCurveTo(x + b * bw * 1.5 + lean * 0.3, y - bh * 0.5, x + b * bw * 1.5 + lean, y - bh);
      g.quadraticCurveTo(
        x + b * bw * 1.5 + lean * 0.3 + bw,
        y - bh * 0.5,
        x + b * bw * 1.5 + bw,
        y + size * 0.1,
      );
      g.closePath();
      g.fill();
    }
  }
}

/** Wrought-iron fence with spear tips. */
export function paintFence(
  g: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  h: number,
  env: EnvPalette,
  lightDir: number,
): void {
  const bar = Math.max(1.5, h * 0.06);
  const step = h * 0.32;
  g.fillStyle = env.iron;
  g.fillRect(x0, y - h * 0.82, x1 - x0, bar);
  g.fillRect(x0, y - h * 0.25, x1 - x0, bar);
  for (let x = x0; x <= x1; x += step) {
    g.fillStyle = env.iron;
    g.fillRect(x - bar / 2, y - h, bar, h);
    g.beginPath();
    g.moveTo(x, y - h * 1.16);
    g.lineTo(x + bar * 1.6, y - h * 0.98);
    g.lineTo(x, y - h * 0.94);
    g.lineTo(x - bar * 1.6, y - h * 0.98);
    g.closePath();
    g.fill();
    g.fillStyle = rgbaHex(env.rim, 0.45);
    g.fillRect(lightDir < 0 ? x - bar / 2 : x + bar * 0.2, y - h, Math.max(1, bar * 0.3), h);
  }
  // posts
  for (const x of [x0, x1]) {
    g.fillStyle = mixHex(env.stone, env.near, 0.35);
    g.fillRect(x - h * 0.09, y - h * 1.1, h * 0.18, h * 1.1);
    g.fillStyle = mixHex(env.stoneLit, env.stone, 0.5);
    g.fillRect(x - h * 0.12, y - h * 1.18, h * 0.24, h * 0.1);
  }
}

// ---------------------------------------------------------------------------
// Tombstones: shaded stone with bevel, engraving and moss.
// ---------------------------------------------------------------------------
export type StoneKind = 'round' | 'cross' | 'obelisk' | 'square';

export function paintTombstone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  kind: StoneKind,
  env: EnvPalette,
  lightDir: number,
  seed: number,
  tilt = 0,
): void {
  const h = kind === 'obelisk' ? w * 2.2 : kind === 'cross' ? w * 1.7 : w * 1.3;
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  const path = (ins: number) => {
    g.beginPath();
    if (kind === 'round') {
      g.moveTo(-w / 2 + ins, 0);
      g.lineTo(-w / 2 + ins, -h + w / 2);
      g.arc(0, -h + w / 2, w / 2 - ins, Math.PI, 0);
      g.lineTo(w / 2 - ins, 0);
      g.closePath();
    } else if (kind === 'square') {
      const r = w * 0.12;
      g.moveTo(-w / 2 + ins, 0);
      g.lineTo(-w / 2 + ins, -h + r + ins);
      g.quadraticCurveTo(-w / 2 + ins, -h + ins, -w / 2 + r + ins, -h + ins);
      g.lineTo(w / 2 - r - ins, -h + ins);
      g.quadraticCurveTo(w / 2 - ins, -h + ins, w / 2 - ins, -h + r + ins);
      g.lineTo(w / 2 - ins, 0);
      g.closePath();
    } else if (kind === 'obelisk') {
      g.moveTo(-w * 0.32 + ins, 0);
      g.lineTo(-w * 0.22 + ins, -h * 0.88);
      g.lineTo(0, -h + ins);
      g.lineTo(w * 0.22 - ins, -h * 0.88);
      g.lineTo(w * 0.32 - ins, 0);
      g.closePath();
    } else {
      const a = w * 0.18;
      g.moveTo(-a + ins, 0);
      g.lineTo(-a + ins, -h * 0.62 + ins);
      g.lineTo(-w / 2 + ins, -h * 0.62 + ins);
      g.lineTo(-w / 2 + ins, -h * 0.8 - ins);
      g.lineTo(-a + ins, -h * 0.8 - ins);
      g.lineTo(-a + ins, -h + ins);
      g.lineTo(a - ins, -h + ins);
      g.lineTo(a - ins, -h * 0.8 - ins);
      g.lineTo(w / 2 - ins, -h * 0.8 - ins);
      g.lineTo(w / 2 - ins, -h * 0.62 + ins);
      g.lineTo(a - ins, -h * 0.62 + ins);
      g.lineTo(a - ins, 0);
      g.closePath();
    }
  };
  // shadow / dark side
  path(0);
  g.fillStyle = mixHex(env.stone, '#000000', 0.45);
  g.fill();
  // lit face (shifted toward the light, clipped)
  g.save();
  path(0);
  g.clip();
  g.fillStyle = hgrad(g, -w / 2, w / 2, [
    [0, lightDir < 0 ? env.stoneLit : mixHex(env.stone, '#000000', 0.3)],
    [0.55, env.stone],
    [1, lightDir > 0 ? env.stoneLit : mixHex(env.stone, '#000000', 0.35)],
  ]);
  const bev = Math.max(1, w * 0.07);
  g.translate(lightDir * -bev * 0.5, bev * 0.5);
  path(bev);
  g.fill();
  g.restore();
  // vertical gradient: darker at the base
  g.save();
  path(0);
  g.clip();
  g.fillStyle = vgrad(g, -h, 0, [
    [0, 'rgba(255,255,255,0.06)'],
    [1, 'rgba(0,0,0,0.45)'],
  ]);
  g.fillRect(-w, -h, w * 2, h);
  // cracks
  const rng = createRng(seed);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  if (rng() < 0.5) {
    g.beginPath();
    const cx = (rng() - 0.5) * w * 0.4;
    g.moveTo(cx, -h * 0.9);
    g.lineTo(cx + w * 0.06, -h * 0.7);
    g.lineTo(cx - w * 0.02, -h * 0.55);
    g.lineTo(cx + w * 0.015, -h * 0.55);
    g.lineTo(cx + w * 0.09, -h * 0.7);
    g.lineTo(cx + w * 0.02, -h * 0.9);
    g.fill();
  }
  // moss at the base
  g.fillStyle = rgbaHex(env.moss, 0.75);
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.ellipse(
      (rng() - 0.5) * w * 0.9,
      -rng() * h * 0.18,
      w * (0.08 + rng() * 0.1),
      w * (0.04 + rng() * 0.05),
      0,
      0,
      TAU,
    );
    g.fill();
  }
  g.restore();
  // engraving (embossed RIP or cross)
  if (kind === 'round' || kind === 'square') {
    g.font = `bold ${Math.round(w * 0.26)}px Georgia, serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = rgbaHex(env.stoneLit, 0.45);
    g.fillText('RIP', w * 0.015, -h * 0.58 + w * 0.015);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    g.fillText('RIP', 0, -h * 0.58);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    for (let i = 0; i < 2; i++)
      g.fillRect(-w * 0.25, -h * 0.36 + i * w * 0.12, w * 0.5, Math.max(1, w * 0.03));
  }
  g.restore();
}

// ---------------------------------------------------------------------------
// Fog: pre-rendered soft noise texture, scrolled with parallax per frame.
// ---------------------------------------------------------------------------
const fogTexCache = new Map<string, HTMLCanvasElement>();

/** A tileable (horizontally) soft fog band texture. */
export function fogTexture(color: string, seed: number, tw = 512, th = 128): HTMLCanvasElement {
  const key = `${color}:${seed}:${tw}x${th}`;
  const cached = fogTexCache.get(key);
  if (cached) return cached;
  const { c, g } = offscreen(tw, th);
  const img = g.createImageData(tw, th);
  const rng = createRng(seed);
  // periodic value noise
  const P = 8;
  const grid: number[][] = [];
  const oct = 4;
  for (let o = 0; o < oct; o++) {
    const n = P << o;
    const rows = Math.max(2, Math.round(n / 4));
    grid.push(Array.from({ length: n * (rows + 1) }, () => rng()));
  }
  const [cr, cg, cb] = hexRgb(color).map((v) => Math.round(v * 255));
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      let v = 0;
      let amp = 0.5;
      for (let o = 0; o < oct; o++) {
        const n = P << o;
        const rows = Math.max(2, Math.round(n / 4));
        const gx = (x / tw) * n;
        const gy = (y / th) * rows;
        const ix = Math.floor(gx);
        const iy = Math.floor(gy);
        const fx = gx - ix;
        const fy = gy - iy;
        const arr = grid[o]!;
        const at = (i: number, j: number) => arr[(j % (rows + 1)) * n + (((i % n) + n) % n)]!;
        const sx = fx * fx * (3 - 2 * fx);
        const sy = fy * fy * (3 - 2 * fy);
        const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
        const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
        v += amp * (a + (b - a) * sy);
        amp *= 0.5;
      }
      const vy = y / th;
      const env = Math.sin(vy * Math.PI) ** 1.5;
      const d = Math.max(0, Math.min(1, (v - 0.42) * 2.6)) * env;
      const i = (y * tw + x) * 4;
      img.data[i] = cr!;
      img.data[i + 1] = cg!;
      img.data[i + 2] = cb!;
      img.data[i + 3] = Math.round(d * 255);
    }
  }
  g.putImageData(img, 0, 0);
  fogTexCache.set(key, c);
  return c;
}

/** Draws a drifting fog band (two parallax layers). */
export function drawFogBand(
  g: CanvasRenderingContext2D,
  w: number,
  y: number,
  bandH: number,
  color: string,
  t: number,
  alpha: number,
  seed: number,
  speed = 1,
): void {
  for (let k = 0; k < 2; k++) {
    const tex = fogTexture(color, seed + k * 31);
    const tw = w * (1.2 + k * 0.5);
    const off = -(((t * speed * (12 + k * 9)) / 100) * w) % tw;
    g.globalAlpha = alpha * (k === 0 ? 0.85 : 0.6);
    for (let x = off - tw; x < w; x += tw) {
      g.drawImage(tex, x, y - bandH * (0.5 + k * 0.15), tw, bandH * (1 + k * 0.3));
    }
  }
  g.globalAlpha = 1;
}

/** Moonlit light pools on the ground / soft colored radial spots (cached sprites). */
export function lightPool(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  a: number,
): void {
  g.save();
  g.translate(x, y);
  g.scale(1, ry / rx);
  addGlow(g, 0, 0, rx, color, a);
  g.restore();
}

/** Pumpkin vine with lobed shaded leaves and curly tendrils along y (cached layers only). */
export function paintVine(
  g: CanvasRenderingContext2D,
  w: number,
  y: number,
  size: number,
  seed: number,
  green = '#2f7a2a',
  light = '#7fd45a',
): void {
  const rng = createRng(seed);
  const at = (x: number) => y + Math.sin((x / size) * 2.2 + seed) * size * 0.18;
  // vine body (tapered filled ribbon)
  g.fillStyle = mixHex(green, '#000000', 0.25);
  g.beginPath();
  for (let x = 0; x <= w; x += size * 0.1) g.lineTo(x, at(x) - size * 0.045);
  for (let x = w; x >= 0; x -= size * 0.1) g.lineTo(x, at(x) + size * 0.045);
  g.closePath();
  g.fill();
  // tendrils
  g.strokeStyle = mixHex(green, light, 0.3);
  g.lineWidth = Math.max(1, size * 0.02);
  g.lineCap = 'round';
  for (let x = size * 0.5; x < w; x += size * (0.8 + rng() * 0.6)) {
    const yy = at(x);
    g.beginPath();
    for (let a = 0; a < TAU * 1.6; a += 0.25) {
      const r = size * 0.12 * (1 - a / (TAU * 1.8));
      g.lineTo(x + Math.cos(a) * r + a * size * 0.02, yy - size * 0.1 - Math.sin(a) * r - a * size * 0.03);
    }
    g.stroke();
  }
  // leaves
  for (let x = size * 0.2; x < w; x += size * (0.45 + rng() * 0.4)) {
    const yy = at(x);
    const s = size * (0.22 + rng() * 0.14);
    const ang = (rng() - 0.5) * 1.2 - Math.PI / 2;
    g.save();
    g.translate(x, yy);
    g.rotate(ang + Math.PI / 2);
    const gr = g.createLinearGradient(-s, -s, s, s);
    gr.addColorStop(0, light);
    gr.addColorStop(0.5, green);
    gr.addColorStop(1, mixHex(green, '#000000', 0.5));
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, 0);
    for (let k = 0; k <= 5; k++) {
      const a = Math.PI + (k / 5) * Math.PI;
      const r = s * (k % 2 ? 0.75 : 1);
      g.quadraticCurveTo(
        Math.cos(a - 0.3) * r * 1.1,
        Math.sin(a - 0.3) * r * 1.1 - s * 0.2,
        Math.cos(a) * r,
        Math.sin(a) * r - s * 0.2,
      );
    }
    g.closePath();
    g.fill();
    g.strokeStyle = rgbaHex(light, 0.6);
    g.lineWidth = Math.max(1, s * 0.05);
    g.beginPath();
    for (const a of [-2.4, -1.57, -0.7]) {
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * s * 0.75, Math.sin(a) * s * 0.75 - s * 0.15);
    }
    g.stroke();
    g.restore();
  }
}

// ---------------------------------------------------------------------------
// Floor fog shader: near-black ground (so the real surface stays dark), drifting layered fog with
// depth and slowly wandering colored light pools.
// ---------------------------------------------------------------------------
export const FLOOR_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uFogA; uniform vec3 uFogB; uniform vec3 uPoolA; uniform vec3 uPoolB;
uniform float uFog; uniform float uPools; uniform float uSpeed;
varying vec2 vUv;
${FBM_GLSL}
float fbm3(vec2 p) {
  float v = 0.5 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.25 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.125 * vnoise(p);
  return v / 0.875;
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y) * 2.2;
  float t = uTime * uSpeed;
  vec3 col = vec3(0.008, 0.008, 0.016);
  // light pools
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    vec2 c = vec2(
      (0.5 + 0.42 * sin(t * (0.031 + fi * 0.013) + fi * 2.1 + uSeed)) * aspect,
      0.5 + 0.38 * cos(t * (0.027 + fi * 0.011) + fi * 1.3 + uSeed * 0.7));
    float d = length((vec2(vUv.x * aspect, vUv.y) - c) / vec2(1.0, 0.8));
    vec3 pc = i == 1 ? uPoolB : uPoolA;
    col += pc * exp(-d * d * 9.0) * 0.16 * uPools;
  }
  // two fog layers with parallax; the far one is darker and slower
  vec2 q1 = p * 0.9 + vec2(t * 0.025, t * 0.01) + uSeed;
  vec2 w = vec2(fbm3(q1), fbm3(q1 + 5.2));
  float f1 = fbm3(q1 + w * 1.6);
  vec2 q2 = p * 1.7 - vec2(t * 0.05, -t * 0.02) + 3.0 + uSeed;
  float f2 = fbm3(q2 + w * 0.8);
  float a1 = smoothstep(0.42, 0.85, f1);
  float a2 = smoothstep(0.5, 0.9, f2);
  vec3 fogc = mix(uFogA, uFogB, smoothstep(0.3, 0.8, w.x));
  col += fogc * a1 * 0.22 * uFog;
  col += mix(fogc, vec3(1.0), 0.25) * a2 * 0.16 * uFog;
  // fog catches the light pools
  col += (uPoolA + uPoolB) * 0.05 * a2 * uPools;
  // vignette
  vec2 v = vUv - 0.5;
  col *= 1.0 - dot(v, v) * 0.9;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function floorUniforms(
  fogA: string,
  fogB: string,
  poolA: string,
  poolB: string,
  fog: number,
  pools: number,
  speed: number,
) {
  return {
    uFogA: v3(fogA),
    uFogB: v3(fogB),
    uPoolA: v3(poolA),
    uPoolB: v3(poolB),
    uFog: fog,
    uPools: pools,
    uSpeed: speed,
  };
}

/** Autumn leaf (filled, shaded, with veins). Cheap enough to draw per frame in small numbers. */
export function paintLeaf(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  rot: number,
  color: string,
  kind = 0,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  const gr = g.createLinearGradient(-r, -r, r, r);
  gr.addColorStop(0, mixHex(color, '#ffffff', 0.3));
  gr.addColorStop(0.6, color);
  gr.addColorStop(1, mixHex(color, '#000000', 0.45));
  g.fillStyle = gr;
  g.beginPath();
  if (kind % 2 === 0) {
    // maple: 5 pointed lobes
    for (let k = 0; k <= 10; k++) {
      const a = -Math.PI / 2 + (k / 10) * TAU;
      const rr = k % 2 ? r * 0.45 : r * (k === 0 || k === 10 ? 1 : k === 4 || k === 6 ? 0.7 : 0.9);
      if (k === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
  } else {
    // oval leaf
    g.moveTo(0, -r);
    g.quadraticCurveTo(r * 0.75, -r * 0.2, 0, r);
    g.quadraticCurveTo(-r * 0.75, -r * 0.2, 0, -r);
  }
  g.closePath();
  g.fill();
  g.strokeStyle = mixHex(color, '#3a1000', 0.5);
  g.lineWidth = Math.max(0.8, r * 0.06);
  g.beginPath();
  g.moveTo(0, r * 1.15);
  g.lineTo(0, -r * 0.8);
  for (const a of [-0.6, 0.6]) {
    g.moveTo(0, r * 0.1);
    g.lineTo(Math.sin(a) * r * 0.6, -r * 0.35);
  }
  g.stroke();
  g.restore();
}
