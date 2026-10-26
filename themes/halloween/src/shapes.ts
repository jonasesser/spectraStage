/**
 * Character and prop drawing for the Halloween theme.
 *
 * API (sizes in pixels; every function is deterministic in its inputs – no Math.random):
 *  - ghost(g, x, y, size, { color, t, alpha?, face?: 'happy'|'oo'|'wow'|'sleepy', wave?, glow?, mirror?, blush? })
 *      Total height `size`, centred on (x, y). Tail ripple and squash/stretch come from `t`.
 *  - pumpkin(g, x, y, size, { pal, face? (0..5, -1 = uncarved), glow?, t?, squash? (-1..1), alpha? })
 *      Height `size`, centred. Candle flicker from `t`, warm light spill below.
 *  - skeleton(g, x, y, size, pose: SkeletonPose, color?, glowColor?)   feet at y + size/2.
 *      dancePose(beat, style 0..3) → SkeletonPose.
 *  - bat(g, x, y, size, flap -1..1, pal, alpha?)   wingspan `size`, facing the viewer.
 *  - spider(g, size, phase, pal, color?)   top-down, facing +x, drawn at the origin.
 *  - fuzzySpider(g, size, phase, rim 0..1, rimColor, eyeColor?, seed?)   black high-contrast spider.
 *  - cat(g, size, walk, moving, t, pal)   side view facing +x at the origin, feet at y = size*0.32.
 *  - tombstone(g, x, y, w, h, pal, tilt?, style 0..2)   base centre at (x, y).
 *  - leaf(g, x, y, size, angle, color, alpha?, glow?), footprint(...), pawPrint(...), star(...).
 *  - Object size: withObjectScale(v, fn) scales all sizes above inside fn (positions stay).
 *  - Helpers: px, sky, glowSprite, glowAt, glowEllipse, withRim, fadeInOut, sizeBucket,
 *    mixColor, clearSpriteCache.
 *
 * Rendering model: the static look of each character (gradients, inner shading, rim light,
 * specular, soft halo) is painted once into an offscreen sprite keyed by a size bucket
 * (~19 % steps, ≤ 512 px) and its colors, then placed with drawImage under transforms.
 * Animation uses transforms plus a few quantised states (ghost tail phase, bat flap, blink).
 * Sprites live in an LRU cache with a pixel budget.
 */
import { clamp01, TAU } from '@spectrastage/engine';
import type { DrawState } from '@spectrastage/engine';
import type { Palette } from './palette.ts';

// ---------------------------------------------------------------------------
// Sizing & glow sprites
// ---------------------------------------------------------------------------

// Object size of the side being drawn (projector setting): characters and props get bigger or
// smaller around their anchor; where they are placed does not change. Set per render call.
let OBJ = 1;
export function objScale(): number {
  return OBJ;
}
/** Run `fn` with the object size `v` (restored afterwards). */
export function withObjectScale<T>(v: number, fn: () => T): T {
  const prev = OBJ;
  OBJ = v > 0 && Number.isFinite(v) ? v : 1;
  try {
    return fn();
  } finally {
    OBJ = prev;
  }
}

/** Physical size in meters → pixels, clamped to stay sensible on tiny previews and huge surfaces. */
export function px(
  s: Pick<DrawState, 'ppm' | 'w' | 'h'>,
  meters: number,
  minFrac = 0.035,
  maxFrac = 0.6,
): number {
  const m = Math.min(s.w, s.h);
  return Math.max(m * minFrac, Math.min(m * maxFrac, meters * s.ppm));
}

const spriteCache = new Map<string, HTMLCanvasElement>();

/** Cached radial glow sprite (fast drawImage instead of per-frame gradients). */
export function glowSprite(color: string, hard = 0.35): HTMLCanvasElement {
  const key = `${color}:${hard}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  const [r, gg, b] = rgbC(color);
  grad.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grad.addColorStop(hard, `rgba(${r},${gg},${b},0.45)`);
  grad.addColorStop(0.7, `rgba(${r},${gg},${b},0.1)`);
  grad.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  spriteCache.set(key, c);
  return c;
}

/** Additive soft glow. */
export function glowAt(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha = 1,
  hard = 0.35,
): void {
  if (radius <= 0.5 || alpha <= 0.003) return;
  const prevA = g.globalAlpha;
  const prevC = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = prevA * Math.min(1, alpha);
  g.drawImage(glowSprite(color, hard), x - radius, y - radius, radius * 2, radius * 2);
  g.globalAlpha = prevA;
  g.globalCompositeOperation = prevC;
}

/** Additive elliptical glow (light pools, spill on the ground). */
export function glowEllipse(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  alpha = 1,
  hard = 0.35,
): void {
  if (rx <= 0.5 || ry <= 0.5 || alpha <= 0.003) return;
  const prevA = g.globalAlpha;
  const prevC = g.globalCompositeOperation;
  g.globalCompositeOperation = 'lighter';
  g.globalAlpha = prevA * Math.min(1, alpha);
  g.drawImage(glowSprite(color, hard), x - rx, y - ry, rx * 2, ry * 2);
  g.globalAlpha = prevA;
  g.globalCompositeOperation = prevC;
}

export function sky(g: CanvasRenderingContext2D, w: number, h: number, pal: Palette): void {
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, pal.sky[0]);
  grad.addColorStop(1, pal.sky[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
}

export function star(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
): void {
  if (alpha <= 0.01) return;
  g.save();
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + r, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------
type RGB = [number, number, number];
const rgbMemo = new Map<string, RGB>();

function rgbC(c: string): RGB {
  let v = rgbMemo.get(c);
  if (v) return v;
  if (c.charCodeAt(0) === 35) {
    let h = c.slice(1);
    if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
    const n = parseInt(h.slice(0, 6), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  } else {
    const m = c.match(/[\d.]+/g);
    v = m && m.length >= 3 ? [Number(m[0]), Number(m[1]), Number(m[2])] : [255, 255, 255];
  }
  rgbMemo.set(c, v);
  return v;
}

/** Linear mix of two colors (hex or rgb()) → 'rgb(r,g,b)'. */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgbC(a);
  const y = rgbC(b);
  const k = clamp01(t);
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * k)},${Math.round(x[1] + (y[1] - x[1]) * k)},${Math.round(x[2] + (y[2] - x[2]) * k)})`;
}

function rgba(c: string, a: number): string {
  const [r, g, b] = rgbC(c);
  return `rgba(${r},${g},${b},${a})`;
}

const lighten = (c: string, t: number): string => mixColor(c, '#ffffff', t);
const darken = (c: string, t: number): string => mixColor(c, '#000000', t);

/** Deterministic hash → 0..1. */
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// ---------------------------------------------------------------------------
// Sprite cache
// ---------------------------------------------------------------------------
interface Spr {
  c: HTMLCanvasElement;
  ax: number;
  ay: number;
  unit: number;
}

const SPR = new Map<string, Spr>();
let sprPixels = 0;
const SPR_BUDGET = 24_000_000;

/** Quantise a pixel size to a cache bucket (~19 % steps, never below the request, capped). */
export function sizeBucket(v: number, max = 512): number {
  const b = Math.pow(2, Math.ceil(Math.log2(Math.max(8, v)) * 4) / 4);
  return Math.min(max, Math.ceil(b));
}

/** Drop all cached character sprites (e.g. after a long show to release memory). */
export function clearSpriteCache(): void {
  SPR.clear();
  sprPixels = 0;
}

/**
 * Get or paint a sprite. `unit` px per unit; the canvas spans wU × hU units with the origin at
 * (axU, ayU) units. The painter receives a context translated to the origin and the unit size.
 */
function sprite(
  key: string,
  unit: number,
  wU: number,
  hU: number,
  axU: number,
  ayU: number,
  paint: (g: CanvasRenderingContext2D, u: number) => void,
): Spr {
  const k = `${key}|${unit}`;
  const hit = SPR.get(k);
  if (hit) {
    SPR.delete(k);
    SPR.set(k, hit);
    return hit;
  }
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(wU * unit));
  c.height = Math.max(1, Math.ceil(hU * unit));
  const g = c.getContext('2d')!;
  g.translate(axU * unit, ayU * unit);
  paint(g, unit);
  const s: Spr = { c, ax: axU * unit, ay: ayU * unit, unit };
  SPR.set(k, s);
  sprPixels += c.width * c.height;
  while (sprPixels > SPR_BUDGET && SPR.size > 1) {
    const first = SPR.keys().next().value as string;
    const old = SPR.get(first)!;
    sprPixels -= old.c.width * old.c.height;
    SPR.delete(first);
  }
  return s;
}

/** Draw a sprite with its origin at (x, y), scaled so one sprite unit = `unit` px. */
function blit(g: CanvasRenderingContext2D, s: Spr, unit: number, x = 0, y = 0): void {
  const k = unit / s.unit;
  g.drawImage(s.c, x - s.ax * k, y - s.ay * k, s.c.width * k, s.c.height * k);
}

// ---------------------------------------------------------------------------
// Painting helpers (used only while building sprites)
// ---------------------------------------------------------------------------
let scratchC: HTMLCanvasElement | null = null;

function scratch(w: number, h: number): HTMLCanvasElement {
  if (!scratchC) scratchC = document.createElement('canvas');
  if (scratchC.width < w) scratchC.width = w;
  if (scratchC.height < h) scratchC.height = h;
  return scratchC;
}

/**
 * Light or shade along one side of a shape: the part of `path` NOT covered by the path shifted
 * by (dx, dy) gets `color` (soft-edged by `blur`). Shift down-right → lit top-left edge.
 */
function crescent(
  g: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  dx: number,
  dy: number,
  blur: number,
  alpha = 1,
  op: GlobalCompositeOperation = 'source-over',
): void {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const tc = scratch(W, H);
  const t = tc.getContext('2d')!;
  t.setTransform(1, 0, 0, 1, 0, 0);
  t.globalCompositeOperation = 'source-over';
  t.clearRect(0, 0, tc.width, tc.height);
  t.fillStyle = color;
  t.fillRect(0, 0, W, H);
  t.setTransform(g.getTransform());
  t.translate(dx, dy);
  t.globalCompositeOperation = 'destination-out';
  t.fill(path);
  g.save();
  g.clip(path);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha *= alpha;
  g.globalCompositeOperation = op;
  if (blur > 0.3) g.filter = `blur(${blur.toFixed(2)}px)`;
  g.drawImage(tc, 0, 0, W, H, 0, 0, W, H);
  g.restore();
}

/** Blurred fill of a path (soft halo behind a silhouette). */
function haloFill(
  g: CanvasRenderingContext2D,
  path: Path2D,
  color: string,
  blur: number,
  alpha: number,
): void {
  g.save();
  if (blur > 0.3) g.filter = `blur(${blur.toFixed(2)}px)`;
  g.globalAlpha *= alpha;
  g.fillStyle = color;
  g.fill(path);
  g.restore();
}

function softEllipse(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rot: number,
  color: string,
  alpha: number,
  blur: number,
  clip?: Path2D,
  op?: GlobalCompositeOperation,
): void {
  g.save();
  if (clip) g.clip(clip);
  if (op) g.globalCompositeOperation = op;
  g.globalAlpha *= alpha;
  if (blur > 0.3) g.filter = `blur(${blur.toFixed(2)}px)`;
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  g.fill();
  g.restore();
}

function addEllipse(p: Path2D, x: number, y: number, rx: number, ry: number, rot = 0): void {
  const e = new Path2D();
  e.ellipse(x, y, Math.max(0.05, rx), Math.max(0.05, ry), rot, 0, TAU);
  p.addPath(e);
}

/** Closed polygon from flat [x0, y0, x1, y1, ...], always wound like arc() so unions stay solid. */
function poly(p: Path2D, pts: number[]): void {
  const n = pts.length / 2;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i * 2]! * pts[j * 2 + 1]! - pts[j * 2]! * pts[i * 2 + 1]!;
  }
  const idx = (i: number) => (a < 0 ? n - 1 - i : i);
  p.moveTo(pts[idx(0) * 2]!, pts[idx(0) * 2 + 1]!);
  for (let i = 1; i < n; i++) p.lineTo(pts[idx(i) * 2]!, pts[idx(i) * 2 + 1]!);
  p.closePath();
}

function circle(p: Path2D, x: number, y: number, r: number): void {
  if (r <= 0.05) return;
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, TAU);
}

/** Tapered segment with round caps (filled, not stroked). */
function taper(
  p: Path2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  w1: number,
  w2: number,
  caps = 3,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  poly(p, [
    x1 - (nx * w1) / 2,
    y1 - (ny * w1) / 2,
    x2 - (nx * w2) / 2,
    y2 - (ny * w2) / 2,
    x2 + (nx * w2) / 2,
    y2 + (ny * w2) / 2,
    x1 + (nx * w1) / 2,
    y1 + (ny * w1) / 2,
  ]);
  if (caps & 1) circle(p, x1, y1, w1 / 2);
  if (caps & 2) circle(p, x2, y2, w2 / 2);
}

/** Tapered ribbon along a polyline (tails, tendrils). */
function ribbon(p: Path2D, pts: [number, number][], w0: number, w1: number): void {
  const n = pts.length;
  if (n < 2) return;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)]!;
    const b = pts[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const w = (w0 + (w1 - w0) * (i / (n - 1))) / 2;
    const [x, y] = pts[i]!;
    left.push(x - (dy / L) * w, y + (dx / L) * w);
    right.push(x + (dy / L) * w, y - (dx / L) * w);
  }
  const ring = [...left];
  for (let i = n - 1; i >= 0; i--) ring.push(right[i * 2]!, right[i * 2 + 1]!);
  poly(p, ring);
  circle(p, pts[0]![0], pts[0]![1], w0 / 2);
  circle(p, pts[n - 1]![0], pts[n - 1]![1], w1 / 2);
}

// ---------------------------------------------------------------------------
// Ghost
// ---------------------------------------------------------------------------
export type GhostFace = 'happy' | 'oo' | 'wow' | 'sleepy';

export interface GhostOpts {
  color: string;
  t: number;
  alpha?: number;
  face?: GhostFace;
  wave?: number;
  glow?: number;
  mirror?: boolean;
  blush?: string;
}

const GHOST_PHASES = 12;

function ghostPath(S: number, ph: number): Path2D {
  const r = 0.37 * S;
  const top = -0.5 * S;
  const sway = Math.sin(ph) * 0.025 * S;
  const p = new Path2D();
  p.moveTo(-r, top + r);
  p.arc(0, top + r, r, Math.PI, 0);
  const x0 = r * 1.1 + sway;
  const x1 = -r * 1.1 + sway;
  const gy = 0.4 * S;
  p.bezierCurveTo(r, top + r + 0.24 * S, r * 1.05 + sway * 0.5, 0.26 * S, x0, gy);
  const n = 4;
  for (let i = 0; i < n; i++) {
    const xa = x0 + ((x1 - x0) * i) / n;
    const xb = x0 + ((x1 - x0) * (i + 1)) / n;
    const by = 0.585 * S + Math.sin(ph + i * 1.7) * 0.035 * S;
    const yb = i === n - 1 ? gy : 0.44 * S;
    p.bezierCurveTo(xa + 0.012 * S, by, xb - 0.012 * S, by, xb, yb);
  }
  p.bezierCurveTo(-r * 1.05 + sway * 0.5, 0.26 * S, -r, top + r + 0.24 * S, -r, top + r);
  p.closePath();
  return p;
}

function ghostBody(color: string, ph: number, U: number): Spr {
  return sprite(`gb:${color}:${ph}`, U, 1.1, 1.28, 0.55, 0.6, (g, S) => {
    const path = ghostPath(S, (ph / GHOST_PHASES) * TAU);
    const cool = mixColor(color, '#6b78f0', 0.5);
    haloFill(g, path, mixColor(color, '#b9c6ff', 0.5), S * 0.04, 0.55);
    const gr = g.createRadialGradient(-0.12 * S, -0.3 * S, 0, -0.04 * S, -0.08 * S, 0.8 * S);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.38, color);
    gr.addColorStop(1, cool);
    g.fillStyle = gr;
    g.fill(path);
    // luminous core: the body reads as layered, glowing from inside
    softEllipse(g, -0.03 * S, -0.1 * S, 0.2 * S, 0.28 * S, 0, '#ffffff', 0.5, 0.07 * S, path);
    crescent(g, path, '#4a52c8', -0.07 * S, -0.05 * S, 0.04 * S, 0.35);
    crescent(g, path, mixColor(color, '#a070ff', 0.7), -0.028 * S, 0.006 * S, 0.01 * S, 0.8);
    crescent(g, path, '#ffffff', 0.03 * S, 0.035 * S, 0.012 * S, 0.95);
    softEllipse(g, -0.17 * S, -0.37 * S, 0.06 * S, 0.035 * S, -0.7, '#ffffff', 0.95, 0.008 * S);
    softEllipse(g, -0.1 * S, -0.425 * S, 0.016 * S, 0.012 * S, 0, '#ffffff', 0.9, 0);
    // translucent, fading tail
    g.save();
    g.globalCompositeOperation = 'destination-out';
    const lg = g.createLinearGradient(0, 0.1 * S, 0, 0.62 * S);
    lg.addColorStop(0, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = lg;
    g.fillRect(-S, 0.1 * S, 2 * S, 0.6 * S);
    g.restore();
  });
}

function ghostArm(color: string, U: number): Spr {
  return sprite(`ga:${color}`, U, 0.42, 0.26, 0.21, 0.13, (g, S) => {
    const p = new Path2D();
    addEllipse(p, 0, 0, 0.15 * S, 0.066 * S);
    haloFill(g, p, mixColor(color, '#b9c6ff', 0.5), S * 0.03, 0.5);
    const gr = g.createRadialGradient(-0.04 * S, -0.03 * S, 0, 0, 0, 0.17 * S);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, color);
    gr.addColorStop(1, mixColor(color, '#6b78f0', 0.5));
    g.fillStyle = gr;
    g.fill(p);
    crescent(g, p, '#4a52c8', -0.02 * S, -0.025 * S, 0.015 * S, 0.3);
    crescent(g, p, '#ffffff', 0.012 * S, 0.016 * S, 0.005 * S, 0.9);
  });
}

function ghostFace(face: GhostFace, blink: boolean, blush: string, U: number): Spr {
  return sprite(`gf:${face}:${blink ? 1 : 0}:${blush}`, U, 0.8, 0.62, 0.4, 0.34, (g, S) => {
    const r = 0.37 * S;
    const ey = -0.148 * S;
    const ex = r * 0.38;
    const my = ey + r * 0.58;
    const ink = '#160b2b';
    if (blush) {
      for (const s of [-1, 1])
        softEllipse(g, s * r * 0.68, my - 0.012 * S, 0.055 * S, 0.03 * S, 0, blush, 0.6, 0.014 * S);
    }
    // eyes
    for (const s of [-1, 1]) {
      const cx = s * ex;
      if (face === 'sleepy' || blink) {
        const R = 0.052 * S;
        const p = new Path2D();
        p.arc(cx, ey - R * 0.5, R, 0.12 * Math.PI, 0.88 * Math.PI);
        p.arc(cx, ey - R * 0.95, R * 0.9, 0.85 * Math.PI, 0.15 * Math.PI, true);
        p.closePath();
        g.fillStyle = ink;
        g.fill(p);
        continue;
      }
      const er = face === 'wow' ? 0.085 * S : 0.072 * S;
      const rx = er * 0.78;
      const ry = er * 1.05;
      const eg = g.createRadialGradient(cx, ey + ry * 0.55, 0, cx, ey + ry * 0.2, ry * 1.1);
      eg.addColorStop(0, '#6a58d0');
      eg.addColorStop(0.45, '#22144a');
      eg.addColorStop(1, '#0c0618');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(cx, ey, rx, ry, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(cx + rx * 0.28, ey - ry * 0.38, rx * 0.42, 0, TAU);
      g.fill();
      g.globalAlpha = 0.85;
      g.beginPath();
      g.arc(cx - rx * 0.32, ey + ry * 0.42, rx * 0.17, 0, TAU);
      g.fill();
      g.globalAlpha = 1;
    }
    // mouth
    const mouth = new Path2D();
    if (face === 'happy') {
      mouth.moveTo(-0.065 * S, my - 0.02 * S);
      mouth.quadraticCurveTo(0, my - 0.006 * S, 0.065 * S, my - 0.02 * S);
      mouth.quadraticCurveTo(0.062 * S, my + 0.062 * S, 0, my + 0.064 * S);
      mouth.quadraticCurveTo(-0.062 * S, my + 0.062 * S, -0.065 * S, my - 0.02 * S);
      mouth.closePath();
    } else if (face === 'oo') addEllipse(mouth, 0, my + 0.008 * S, 0.034 * S, 0.044 * S);
    else if (face === 'wow') addEllipse(mouth, 0, my + 0.012 * S, 0.046 * S, 0.068 * S);
    else addEllipse(mouth, 0, my + 0.01 * S, 0.024 * S, 0.018 * S);
    const mg = g.createLinearGradient(0, my - 0.03 * S, 0, my + 0.08 * S);
    mg.addColorStop(0, '#0c0618');
    mg.addColorStop(1, '#3a1840');
    g.fillStyle = mg;
    g.fill(mouth);
    if (face !== 'sleepy') {
      g.save();
      g.clip(mouth);
      g.fillStyle = '#ff7aa8';
      g.beginPath();
      g.ellipse(
        0,
        my + (face === 'happy' ? 0.064 : face === 'wow' ? 0.075 : 0.05) * S,
        0.042 * S,
        0.03 * S,
        0,
        0,
        TAU,
      );
      g.fill();
      g.restore();
    }
  });
}

/** Ghost of total height `size`, centered at (x, y). */
export function ghost(g: CanvasRenderingContext2D, x: number, y: number, size: number, o: GhostOpts): void {
  size *= OBJ;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01 || size < 2) return;
  const U = sizeBucket(size);
  const r = size * 0.37;
  const top = -size / 2;
  const squ = Math.sin(o.t * 2.6 + x * 0.013) * 0.035;
  g.save();
  g.translate(x, y);
  if (o.mirror) g.scale(-1, 1);
  g.globalAlpha *= alpha;
  glowAt(g, 0, size * 0.04, size * 0.95, o.color, 0.35 * (o.glow ?? 1));
  g.translate(0, size * 0.5);
  g.scale(1 - squ * 0.7, 1 + squ);
  g.translate(0, -size * 0.5);
  const wave = o.wave ?? 0;
  const arm = ghostArm(o.color, U);
  for (const side of [-1, 1]) {
    g.save();
    g.translate(side * r * 0.92, top + r * 1.5);
    g.rotate(side * (0.5 + (side > 0 ? wave : -wave * 0.4)));
    blit(g, arm, size, side * r * 0.25, 0);
    g.restore();
  }
  const ph = Math.floor(((((o.t * 5) % TAU) + TAU) % TAU) / (TAU / GHOST_PHASES)) % GHOST_PHASES;
  blit(g, ghostBody(o.color, ph, U), size);
  const blink = Math.sin(o.t * 0.9 + x * 0.01) > 0.985;
  blit(g, ghostFace(o.face ?? 'happy', blink, o.blush ?? '', U), size);
  g.restore();
}

// ---------------------------------------------------------------------------
// Pumpkin
// ---------------------------------------------------------------------------
export interface PumpkinOpts {
  pal: Palette;
  face?: number;
  glow?: number;
  t?: number;
  squash?: number;
  alpha?: number;
}

const LOBES = [
  { cx: -0.3, rx: 0.27, tone: 1 },
  { cx: 0.3, rx: 0.27, tone: 1 },
  { cx: -0.155, rx: 0.28, tone: 0.5 },
  { cx: 0.155, rx: 0.28, tone: 0.5 },
  { cx: 0, rx: 0.27, tone: 0 },
];

function pumpkinBody(face: number, rim: string, U: number): Spr {
  return sprite(`pb:${face}:${rim}`, U, 1.56, 1.3, 0.78, 0.76, (g, S) => {
    const W = 1.18 * S;
    const H = 0.86 * S;
    const union = new Path2D();
    for (const lb of LOBES) addEllipse(union, lb.cx * W, 0, lb.rx * W, (H / 2) * (1 - lb.tone * 0.05));
    haloFill(g, union, '#ff7a1a', 0.035 * S, 0.45);
    for (const lb of LOBES) {
      const cx = lb.cx * W;
      const rx = lb.rx * W;
      const ry = (H / 2) * (1 - lb.tone * 0.05);
      const k = lb.tone;
      const gr = g.createRadialGradient(cx - rx * 0.35, -ry * 0.35, 0, cx, 0, Math.max(rx, ry) * 1.12);
      gr.addColorStop(0, mixColor('#ffc061', '#f2902e', k));
      gr.addColorStop(0.45, mixColor('#f7861c', '#dc650f', k));
      gr.addColorStop(0.82, mixColor('#d55b0b', '#a8400a', k));
      gr.addColorStop(1, mixColor('#8f3206', '#6a2203', k));
      const lp = new Path2D();
      addEllipse(lp, cx, 0, rx, ry);
      g.fillStyle = gr;
      g.fill(lp);
      softEllipse(g, cx - rx * 0.32, -ry * 0.22, rx * 0.16, ry * 0.5, 0, '#ffd590', 0.3, rx * 0.09, lp);
    }
    crescent(g, union, '#3a0c00', -0.05 * S, -0.06 * S, 0.045 * S, 0.55);
    crescent(g, union, rim, -0.022 * S, -0.014 * S, 0.01 * S, 0.7);
    crescent(g, union, '#ffe0a0', 0.025 * S, 0.03 * S, 0.016 * S, 0.45);
    softEllipse(g, -0.2 * W, -0.27 * H, 0.07 * W, 0.045 * H, -0.5, '#fff4dd', 0.85, 0.012 * S);
    softEllipse(g, -0.15 * W, -0.32 * H, 0.012 * W, 0.012 * W, 0, '#ffffff', 0.9, 0);
    // stem socket
    softEllipse(g, 0.01 * S, -H * 0.44, 0.11 * S, 0.04 * S, 0, '#4a1500', 0.7, 0.016 * S, union);
    // curly tendril
    const tp = new Path2D();
    const pts: [number, number][] = [];
    for (let k = 0; k <= 16; k++) {
      const t = k / 16;
      const a = -0.3 + t * 4.4 + Math.PI;
      const rad = 0.075 * S * (1 - 0.55 * t);
      pts.push([0.165 * S + Math.cos(a) * rad, -0.47 * H + Math.sin(a) * rad]);
    }
    ribbon(tp, pts, 0.022 * S, 0.008 * S);
    g.fillStyle = '#4f7a26';
    g.fill(tp);
    crescent(g, tp, '#b7dc78', 0.006 * S, 0.008 * S, 0.002 * S, 0.7);
    // stem
    const st = new Path2D();
    st.moveTo(-0.06 * S, -0.4 * H);
    st.bezierCurveTo(-0.05 * S, -0.55 * H, 0, -0.66 * H, 0.04 * S, -0.74 * H);
    st.lineTo(0.125 * S, -0.7 * H);
    st.bezierCurveTo(0.08 * S, -0.62 * H, 0.068 * S, -0.52 * H, 0.075 * S, -0.4 * H);
    st.quadraticCurveTo(0.01 * S, -0.37 * H, -0.06 * S, -0.4 * H);
    st.closePath();
    const sg = g.createLinearGradient(-0.06 * S, 0, 0.12 * S, 0);
    sg.addColorStop(0, '#34501a');
    sg.addColorStop(0.35, '#7fae3e');
    sg.addColorStop(0.7, '#4f7a26');
    sg.addColorStop(1, '#22360e');
    g.fillStyle = sg;
    g.fill(st);
    g.save();
    g.clip(st);
    const stripes = new Path2D();
    for (let k = 0; k < 3; k++) {
      const bx = (-0.035 + k * 0.04) * S;
      taper(stripes, bx, -0.4 * H, bx + 0.05 * S + k * 0.012 * S, -0.72 * H, 0.012 * S, 0.006 * S);
    }
    g.fillStyle = 'rgba(30,50,10,0.55)';
    g.fill(stripes);
    g.restore();
    crescent(g, st, '#d6f09a', 0.012 * S, 0.004 * S, 0.004 * S, 0.6);
    const cap = new Path2D();
    addEllipse(cap, 0.083 * S, -0.72 * H, 0.045 * S, 0.02 * S, -0.45);
    g.fillStyle = '#b8c27a';
    g.fill(cap);
    softEllipse(g, 0.083 * S, -0.72 * H, 0.025 * S, 0.01 * S, -0.45, '#6f6a30', 0.9, 0.003 * S);
    // carved face: cut wall, glowing core, shadowed upper rim
    if (face >= 0) {
      const fp = pumpkinFacePath(face, W, H);
      g.fillStyle = '#e8761a';
      g.fill(fp);
      g.save();
      g.clip(fp);
      g.translate(0.008 * S, 0.018 * S);
      const ig = g.createRadialGradient(0, 0.02 * H, 0, 0, 0.02 * H, 0.42 * W);
      ig.addColorStop(0, '#fffbe3');
      ig.addColorStop(0.3, '#ffe066');
      ig.addColorStop(0.7, '#ffab2e');
      ig.addColorStop(1, '#ff8a10');
      g.fillStyle = ig;
      g.fill(fp);
      g.restore();
      crescent(g, fp, '#8a2a00', 0, 0.016 * S, 0.006 * S, 0.55);
    }
  });
}

function pumpkinLight(face: number, U: number): Spr {
  return sprite(`pl:${face}`, U, 1.56, 1.3, 0.78, 0.76, (g, S) => {
    const fp = pumpkinFacePath(face, 1.18 * S, 0.86 * S);
    g.save();
    g.filter = `blur(${(0.12 * S).toFixed(2)}px)`;
    g.globalAlpha = 0.55;
    g.fillStyle = '#ff9a20';
    g.fill(fp);
    g.filter = `blur(${(0.035 * S).toFixed(2)}px)`;
    g.globalAlpha = 0.9;
    g.fillStyle = '#ffd04a';
    g.fill(fp);
    g.restore();
  });
}

/** Jack-o'-lantern of height `size` centered at (x, y). Faces 0..5, -1 = uncarved. */
export function pumpkin(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  o: PumpkinOpts,
): void {
  size *= OBJ;
  if (size < 2) return;
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01) return;
  const glowAmt = o.glow ?? 1;
  const sq = o.squash ?? 0;
  const face = (o.face ?? 0) < 0 ? -1 : (o.face ?? 0) % 6;
  const t = o.t ?? 0;
  const U = sizeBucket(size);
  const w = size * 1.18;
  const h = size * 0.86;
  const flicker =
    face >= 0
      ? 0.8 + 0.12 * Math.sin(t * 13 + x * 0.1) * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 23.7 + x)
      : 0;
  g.save();
  g.translate(x, y);
  g.globalAlpha *= alpha;
  glowAt(g, 0, 0, size * 1.1, o.pal.primary, 0.28 * glowAmt * (face >= 0 ? 0.7 + 0.35 * flicker : 0.6));
  if (face >= 0) glowEllipse(g, 0, h * 0.5, w * 0.8, h * 0.22, '#ffb43a', 0.4 * glowAmt * flicker);
  g.scale(1 + sq * 0.12, 1 - sq * 0.12);
  blit(g, pumpkinBody(face, o.pal.rim, U), size);
  if (face >= 0) {
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha *= clamp01((0.25 + 0.6 * flicker) * Math.min(1.4, glowAmt));
    blit(g, pumpkinLight(face, U), size);
  }
  g.restore();
}

function tri(p: Path2D, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): void {
  poly(p, [ax, ay, bx, by, cx, cy]);
}

function pumpkinFacePath(face: number, w: number, h: number): Path2D {
  const p = new Path2D();
  const ex = w * 0.18;
  const ey = -h * 0.12;
  const es = w * 0.1;
  switch (face % 6) {
    case 0: // classic happy
      tri(p, -ex - es, ey + es * 0.6, -ex + es, ey + es * 0.6, -ex, ey - es * 0.8);
      tri(p, ex - es, ey + es * 0.6, ex + es, ey + es * 0.6, ex, ey - es * 0.8);
      tri(p, -es * 0.5, h * 0.04, es * 0.5, h * 0.04, 0, -h * 0.03);
      p.moveTo(-w * 0.3, h * 0.1);
      p.quadraticCurveTo(0, h * 0.42, w * 0.3, h * 0.1);
      p.quadraticCurveTo(w * 0.12, h * 0.2, w * 0.06, h * 0.16);
      p.lineTo(w * 0.03, h * 0.22);
      p.lineTo(-w * 0.03, h * 0.16);
      p.quadraticCurveTo(-w * 0.15, h * 0.22, -w * 0.3, h * 0.1);
      p.closePath();
      break;
    case 1: // surprised
      for (const s of [-1, 1]) addEllipse(p, s * ex, ey, es * 0.9, es * 0.9);
      addEllipse(p, 0, h * 0.2, w * 0.08, h * 0.12);
      break;
    case 2: // wink
      tri(p, -ex - es, ey + es * 0.6, -ex + es, ey + es * 0.6, -ex, ey - es * 0.8);
      addEllipse(p, ex, ey + es * 0.2, es, es * 0.3);
      p.moveTo(-w * 0.25, h * 0.12);
      p.quadraticCurveTo(0, h * 0.36, w * 0.25, h * 0.12);
      p.quadraticCurveTo(0, h * 0.22, -w * 0.25, h * 0.12);
      p.closePath();
      break;
    case 3: // silly
      for (const s of [-1, 1]) addEllipse(p, s * ex, ey, es * 0.7, es, s * 0.3);
      poly(p, [
        -w * 0.28,
        h * 0.08,
        -w * 0.14,
        h * 0.18,
        0,
        h * 0.1,
        w * 0.14,
        h * 0.2,
        w * 0.28,
        h * 0.08,
        w * 0.22,
        h * 0.28,
        -w * 0.22,
        h * 0.28,
      ]);
      break;
    case 4: // sleepy
      for (const s of [-1, 1]) {
        const e = new Path2D();
        e.ellipse(s * ex, ey + es * 0.3, es, es * 0.35, 0, 0, Math.PI);
        e.closePath();
        p.addPath(e);
      }
      addEllipse(p, 0, h * 0.2, w * 0.12, h * 0.05);
      break;
    default: // big grin
      for (const s of [-1, 1]) tri(p, s * ex - es, ey, s * ex + es, ey, s * ex + s * es * 0.3, ey - es * 1.1);
      p.moveTo(-w * 0.34, h * 0.04);
      p.quadraticCurveTo(0, h * 0.5, w * 0.34, h * 0.04);
      p.quadraticCurveTo(0, h * 0.18, -w * 0.34, h * 0.04);
      p.closePath();
  }
  return p;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------
export interface SkeletonPose {
  armL: number;
  armR: number;
  foreL: number;
  foreR: number;
  legL: number;
  legR: number;
  hip: number;
  head: number;
  bounce: number;
}

const SHADE = '#7d6ca8';

/** Volumetric bone shading for a path (cache-time only). */
function boneShade(
  g: CanvasRenderingContext2D,
  p: Path2D,
  color: string,
  glow: string,
  u: number,
  cx: number,
  cy: number,
  R: number,
): void {
  haloFill(g, p, glow, u * 0.2, 0.5);
  const gr = g.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx, cy, R * 1.2);
  gr.addColorStop(0, '#ffffff');
  gr.addColorStop(0.45, color);
  gr.addColorStop(1, mixColor(color, SHADE, 0.55));
  g.fillStyle = gr;
  g.fill(p);
  crescent(g, p, '#4a3a7a', -u * 0.12, -u * 0.12, u * 0.08, 0.35);
  crescent(g, p, glow, -u * 0.06, -u * 0.05, u * 0.02, 0.85);
  crescent(g, p, '#ffffff', u * 0.05, u * 0.06, u * 0.02, 0.8);
}

function boneSpr(color: string, glow: string, Lq: number, Wq: number, U10: number): Spr {
  return sprite(`sb:${color}:${glow}:${Lq}:${Wq}`, U10 / 10, Lq + Wq * 2, Wq * 2.6, Wq, Wq * 1.3, (g, u) => {
    const L = Lq * u;
    const W = Wq * u;
    const p = new Path2D();
    p.rect(0, -W * 0.3, L, W * 0.6);
    for (const ex of [0, L]) for (const s of [-1, 1]) circle(p, ex, s * W * 0.17, W * 0.3);
    haloFill(g, p, glow, W * 0.3, 0.45);
    const lg = g.createLinearGradient(0, -W * 0.5, 0, W * 0.5);
    lg.addColorStop(0, '#ffffff');
    lg.addColorStop(0.4, color);
    lg.addColorStop(1, mixColor(color, SHADE, 0.55));
    g.fillStyle = lg;
    g.fill(p);
    crescent(g, p, glow, 0, -W * 0.14, W * 0.05, 0.85);
    softEllipse(g, L / 2, -W * 0.13, L * 0.38, W * 0.07, 0, '#ffffff', 0.75, W * 0.05, p);
  });
}

function skullSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sk:${color}:${glow}`, U10 / 10, 3.8, 3.8, 1.9, 1.9, (g, u) => {
    const p = new Path2D();
    addEllipse(p, 0, -0.1 * u, 1.42 * u, 1.3 * u);
    p.roundRect(-0.82 * u, 0.45 * u, 1.64 * u, 0.98 * u, 0.42 * u);
    boneShade(g, p, color, glow, u, 0, 0, 1.8 * u);
    for (const s of [-1, 1]) {
      softEllipse(g, s * 1.15 * u, 0.15 * u, 0.25 * u, 0.45 * u, 0, SHADE, 0.3, 0.12 * u, p);
      softEllipse(g, s * 0.55 * u, 0.55 * u, 0.35 * u, 0.12 * u, 0, SHADE, 0.35, 0.06 * u, p);
    }
    softEllipse(g, -0.55 * u, -0.85 * u, 0.38 * u, 0.2 * u, -0.6, '#ffffff', 0.9, 0.05 * u);
    // eye sockets with glowing pupils
    for (const s of [-1, 1]) {
      const cx = s * 0.5 * u;
      softEllipse(g, cx, -0.05 * u, 0.52 * u, 0.58 * u, s * 0.1, '#5a4a8a', 0.45, 0.1 * u);
      const sg = g.createRadialGradient(cx, 0.05 * u, 0, cx, 0, 0.5 * u);
      sg.addColorStop(0, '#0a0512');
      sg.addColorStop(0.7, '#1c0f30');
      sg.addColorStop(1, '#3a2560');
      g.fillStyle = sg;
      g.beginPath();
      g.ellipse(cx, -0.05 * u, 0.42 * u, 0.48 * u, s * 0.1, 0, TAU);
      g.fill();
      softEllipse(g, cx + 0.04 * u, 0, 0.17 * u, 0.17 * u, 0, glow, 0.9, 0.07 * u, undefined, 'lighter');
      softEllipse(g, cx + 0.04 * u, 0, 0.075 * u, 0.075 * u, 0, '#ffffff', 0.95, 0);
      softEllipse(g, cx + 0.16 * u, -0.22 * u, 0.06 * u, 0.06 * u, 0, '#ffffff', 0.8, 0);
    }
    // nose
    const n = new Path2D();
    n.moveTo(0, 0.3 * u);
    n.quadraticCurveTo(0.05 * u, 0.3 * u, 0.18 * u, 0.56 * u);
    n.quadraticCurveTo(0, 0.68 * u, -0.18 * u, 0.56 * u);
    n.quadraticCurveTo(-0.05 * u, 0.3 * u, 0, 0.3 * u);
    g.fillStyle = '#1c0f30';
    g.fill(n);
    // mouth + teeth
    g.fillStyle = '#1c0f30';
    g.beginPath();
    g.roundRect(-0.6 * u, 0.82 * u, 1.2 * u, 0.44 * u, 0.18 * u);
    g.fill();
    for (let k = 0; k < 4; k++) {
      const tx = -0.55 * u + k * 0.28 * u;
      const tg = g.createLinearGradient(0, 0.85 * u, 0, 1.22 * u);
      tg.addColorStop(0, '#ffffff');
      tg.addColorStop(1, mixColor(color, SHADE, 0.4));
      g.fillStyle = tg;
      g.beginPath();
      g.roundRect(tx, 0.86 * u, 0.24 * u, 0.36 * u, 0.08 * u);
      g.fill();
    }
  });
}

function ribsSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sr:${color}:${glow}`, U10 / 10, 3.8, 3.3, 1.9, 0.85, (g, u) => {
    const p = new Path2D();
    taper(p, -1.3 * u, -0.1 * u, 1.3 * u, -0.1 * u, 0.4 * u, 0.4 * u);
    circle(p, -1.3 * u, -0.1 * u, 0.3 * u);
    circle(p, 1.3 * u, -0.1 * u, 0.3 * u);
    taper(p, 0, 0, 0, 1.9 * u, 0.4 * u, 0.28 * u);
    for (let i = 0; i < 4; i++) {
      const ry = 0.45 * u + i * 0.48 * u;
      const rw = (1.25 - i * 0.14) * u;
      const r = new Path2D();
      r.moveTo(rw, ry);
      r.ellipse(0, ry, rw, 0.36 * u, 0, 0, Math.PI);
      r.ellipse(0, ry - 0.03 * u, rw - 0.2 * u, 0.2 * u, 0, Math.PI, 0, true);
      r.closePath();
      p.addPath(r);
    }
    boneShade(g, p, color, glow, u, 0, 0.8 * u, 1.8 * u);
  });
}

function pelvisSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sp:${color}:${glow}`, U10 / 10, 3, 2.2, 1.5, 1.1, (g, u) => {
    const p = new Path2D();
    addEllipse(p, -0.5 * u, -0.05 * u, 0.62 * u, 0.45 * u, 0.35);
    addEllipse(p, 0.5 * u, -0.05 * u, 0.62 * u, 0.45 * u, -0.35);
    p.roundRect(-0.3 * u, -0.4 * u, 0.6 * u, 0.9 * u, 0.22 * u);
    boneShade(g, p, color, glow, u, 0, 0, 1.2 * u);
    for (const s of [-1, 1]) {
      g.fillStyle = '#1c0f30';
      g.beginPath();
      g.ellipse(s * 0.45 * u, 0.12 * u, 0.15 * u, 0.12 * u, 0, 0, TAU);
      g.fill();
    }
  });
}

function vertSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sv:${color}:${glow}`, U10 / 10, 1.1, 0.8, 0.55, 0.4, (g, u) => {
    const p = new Path2D();
    p.roundRect(-0.27 * u, -0.16 * u, 0.54 * u, 0.32 * u, 0.13 * u);
    boneShade(g, p, color, glow, u, 0, 0, 0.35 * u);
  });
}

function handSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sh:${color}:${glow}`, U10 / 10, 1.5, 1.3, 0.5, 0.65, (g, u) => {
    const p = new Path2D();
    circle(p, 0.22 * u, 0, 0.3 * u);
    for (const k of [-1, 0, 1]) taper(p, 0.35 * u, k * 0.15 * u, 0.74 * u, k * 0.2 * u, 0.16 * u, 0.12 * u);
    taper(p, 0.18 * u, -0.22 * u, 0.36 * u, -0.44 * u, 0.15 * u, 0.11 * u);
    boneShade(g, p, color, glow, u, 0.3 * u, 0, 0.6 * u);
  });
}

function footSpr(color: string, glow: string, U10: number): Spr {
  return sprite(`sf:${color}:${glow}`, U10 / 10, 1.9, 1.1, 0.55, 0.55, (g, u) => {
    const p = new Path2D();
    addEllipse(p, 0.28 * u, 0.06 * u, 0.58 * u, 0.25 * u);
    circle(p, -0.05 * u, 0.04 * u, 0.22 * u);
    boneShade(g, p, color, glow, u, 0.25 * u, 0, 0.7 * u);
  });
}

/** Cute skeleton of height `size`, feet at y + size/2. */
export function skeleton(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  pose: SkeletonPose,
  color = '#f4f1ea',
  glowColor = '#c9a6ff',
): void {
  size *= OBJ;
  if (size < 4) return;
  const u = size / 10;
  const U10 = sizeBucket(size);
  g.save();
  g.translate(x, y + size / 2 - pose.bounce * u);
  glowAt(g, 0, -size * 0.5, size * 0.75, glowColor, 0.25);
  const bone = (x1: number, y1: number, x2: number, y2: number, wU: number) => {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const L = Math.hypot(dx, dy) / u;
    if (L < 0.05) return;
    const Lq = Math.max(0.5, Math.round(L * 4) / 4);
    g.save();
    g.translate(x1, y1);
    g.rotate(Math.atan2(dy, dx));
    g.scale(L / Lq, 1);
    blit(g, boneSpr(color, glowColor, Lq, wU, U10), u);
    g.restore();
  };
  const part = (s: Spr, px2: number, py2: number, rot = 0, sx = 1) => {
    g.save();
    g.translate(px2, py2);
    if (rot) g.rotate(rot);
    if (sx !== 1) g.scale(sx, 1);
    blit(g, s, u);
    g.restore();
  };
  const hipY = -u * 3.8;
  const hx = Math.sin(pose.hip) * u * 0.6;
  const foot = footSpr(color, glowColor, U10);
  for (const [side, ang] of [
    [-1, pose.legL],
    [1, pose.legR],
  ] as const) {
    const kx = hx + side * u * 0.6 + Math.sin(ang) * u * 1.9;
    const ky = hipY + Math.cos(ang) * u * 1.9;
    const fx = kx + side * u * 0.1;
    bone(hx + side * u * 0.5, hipY, kx, ky, 0.55);
    bone(kx, ky, fx, -u * 0.3, 0.5);
    part(foot, fx + side * u * 0.05, -u * 0.22, 0, side);
  }
  part(pelvisSpr(color, glowColor, U10), hx, hipY);
  const chestY = -u * 6.6;
  const vert = vertSpr(color, glowColor, U10);
  const vRot = Math.atan2(chestY - hipY, -hx) + Math.PI / 2;
  for (let k = 0; k < 4; k++) {
    const t = 0.12 + k * 0.17;
    const qx = (1 - t) * (1 - t) * hx + 2 * (1 - t) * t * hx * 0.5;
    const qy = hipY + (chestY - hipY) * t;
    part(vert, qx, qy, vRot);
  }
  part(ribsSpr(color, glowColor, U10), 0, chestY);
  const shY = chestY - u * 0.1;
  const hand = handSpr(color, glowColor, U10);
  for (const [side, a, f] of [
    [-1, pose.armL, pose.foreL],
    [1, pose.armR, pose.foreR],
  ] as const) {
    const sx = side * u * 1.3;
    const ex = sx + side * Math.cos(a) * u * 1.7;
    const ey = shY - Math.sin(a) * u * 1.7;
    bone(sx, shY, ex, ey, 0.46);
    const hx2 = ex + side * Math.cos(a + f) * u * 1.5;
    const hy2 = ey - Math.sin(a + f) * u * 1.5;
    bone(ex, ey, hx2, hy2, 0.42);
    part(hand, hx2, hy2, Math.atan2(hy2 - ey, hx2 - ex));
  }
  g.save();
  g.translate(0, shY - u * 1.6);
  g.rotate(pose.head);
  blit(g, skullSpr(color, glowColor, U10), u);
  g.restore();
  g.restore();
}

export function dancePose(beat: number, style: number): SkeletonPose {
  const b = beat * TAU;
  const s = style % 4;
  const half = Math.sin(b / 2);
  switch (s) {
    case 0: // arms up wave
      return {
        armL: 1.2 + 0.4 * Math.sin(b),
        armR: 1.2 - 0.4 * Math.sin(b),
        foreL: 0.6,
        foreR: -0.6 + 0.2 * Math.sin(b),
        legL: -0.15 + 0.2 * Math.max(0, Math.sin(b)),
        legR: 0.15 - 0.2 * Math.max(0, -Math.sin(b)),
        hip: 0.5 * Math.sin(b),
        head: 0.15 * Math.sin(b),
        bounce: Math.abs(Math.sin(b)) * 0.6,
      };
    case 1: // disco point
      return {
        armL: half > 0 ? 1.3 : -0.6,
        armR: half > 0 ? -0.6 : 1.3,
        foreL: 0.2,
        foreR: 0.2,
        legL: -0.2,
        legR: 0.25,
        hip: 0.6 * Math.sin(b),
        head: 0.2 * half,
        bounce: Math.abs(Math.sin(b)) * 0.5,
      };
    case 2: // chicken
      return {
        armL: 0.2 + 0.3 * Math.sin(b * 2),
        armR: 0.2 + 0.3 * Math.sin(b * 2),
        foreL: -1.8,
        foreR: -1.8,
        legL: -0.3 * Math.sin(b),
        legR: 0.3 * Math.sin(b),
        hip: 0.3 * Math.sin(b),
        head: 0.25 * Math.sin(b * 2),
        bounce: Math.abs(Math.sin(b)) * 0.8,
      };
    default: // twist
      return {
        armL: 0.5 + 0.5 * Math.sin(b),
        armR: 0.5 - 0.5 * Math.sin(b),
        foreL: 1.2,
        foreR: 1.2,
        legL: -0.25 + 0.25 * Math.sin(b),
        legR: 0.25 + 0.25 * Math.sin(b),
        hip: 0.9 * Math.sin(b),
        head: -0.2 * Math.sin(b),
        bounce: Math.abs(Math.cos(b)) * 0.4,
      };
  }
}

// ---------------------------------------------------------------------------
// Bat
// ---------------------------------------------------------------------------
function batSpr(fq: number, rim: string, U: number): Spr {
  return sprite(`bt:${fq}:${rim}`, U, 1.18, 0.9, 0.59, 0.5, (g, S) => {
    const s = S / 2;
    const flap = fq / 4 - 1;
    const tipY = -0.55 * flap;
    for (const side of [-1, 1]) {
      const P = (x: number, y: number): [number, number] => [x * s * side, y * s];
      const sh = P(0.1, -0.12);
      const wr = P(0.5, -0.3 + tipY * 0.55);
      const f1 = P(1.0, tipY - 0.15);
      const f2 = P(0.88, 0.06 + tipY * 0.35);
      const f3 = P(0.64, 0.2 + tipY * 0.15);
      const b = P(0.14, 0.16);
      const wing = new Path2D();
      wing.moveTo(sh[0], sh[1]);
      wing.quadraticCurveTo((sh[0] + wr[0]) / 2, (sh[1] + wr[1]) / 2 - 0.1 * s, wr[0], wr[1]);
      wing.quadraticCurveTo((wr[0] + f1[0]) / 2, (wr[1] + f1[1]) / 2 - 0.05 * s, f1[0], f1[1]);
      const sc = (a: [number, number], c: [number, number], k: number) => {
        const mx = (a[0] + c[0]) / 2;
        const my = (a[1] + c[1]) / 2;
        wing.quadraticCurveTo(mx + (wr[0] - mx) * k, my + (wr[1] - my) * k, c[0], c[1]);
      };
      sc(f1, f2, 0.32);
      sc(f2, f3, 0.32);
      sc(f3, b, 0.25);
      wing.closePath();
      haloFill(g, wing, rim, 0.05 * s, 0.45);
      const gr = g.createRadialGradient(b[0], b[1] * 0.2, 0, b[0], b[1] * 0.2, 0.95 * s);
      gr.addColorStop(0, '#1d0e33');
      gr.addColorStop(0.55, '#3c2170');
      gr.addColorStop(1, '#7b4fc6');
      g.fillStyle = gr;
      g.fill(wing);
      const fb = new Path2D();
      taper(fb, sh[0], sh[1], wr[0], wr[1], 0.07 * s, 0.05 * s);
      taper(fb, wr[0], wr[1], f1[0], f1[1], 0.042 * s, 0.012 * s);
      taper(fb, wr[0], wr[1], f2[0], f2[1], 0.036 * s, 0.012 * s);
      taper(fb, wr[0], wr[1], f3[0], f3[1], 0.032 * s, 0.01 * s);
      g.fillStyle = '#170b28';
      g.fill(fb);
      crescent(g, fb, mixColor(rim, '#ffffff', 0.2), 0, 0.012 * s, 0.004 * s, 0.6);
      crescent(g, wing, rim, 0, 0.03 * s, 0.012 * s, 0.95);
      crescent(g, wing, mixColor(rim, '#ffffff', 0.35), 0, -0.02 * s, 0.01 * s, 0.4);
    }
    // furry body + head
    const body = new Path2D();
    addEllipse(body, 0, 0.04 * s, 0.17 * s, 0.24 * s);
    addEllipse(body, 0, -0.15 * s, 0.135 * s, 0.125 * s);
    poly(body, [-0.13 * s, -0.17 * s, -0.12 * s, -0.38 * s, -0.03 * s, -0.22 * s]);
    poly(body, [0.03 * s, -0.22 * s, 0.12 * s, -0.38 * s, 0.13 * s, -0.17 * s]);
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU + 0.1;
      if (Math.sin(a) < -0.55) continue;
      const bx = Math.cos(a) * 0.15 * s;
      const by = 0.04 * s + Math.sin(a) * 0.22 * s;
      const ta = a + (hash(k) - 0.5) * 0.6;
      const tl = (0.05 + 0.03 * hash(k + 9)) * s;
      const px2 = -Math.sin(a) * 0.025 * s;
      const py2 = Math.cos(a) * 0.025 * s;
      poly(body, [bx - px2, by - py2, bx + px2, by + py2, bx + Math.cos(ta) * tl, by + Math.sin(ta) * tl]);
    }
    haloFill(g, body, rim, 0.04 * s, 0.5);
    const bg = g.createRadialGradient(-0.05 * s, -0.15 * s, 0, 0, 0, 0.4 * s);
    bg.addColorStop(0, '#5d3d86');
    bg.addColorStop(0.5, '#2a1846');
    bg.addColorStop(1, '#100818');
    g.fillStyle = bg;
    g.fill(body);
    softEllipse(g, 0, 0.08 * s, 0.08 * s, 0.13 * s, 0, '#7a5aa8', 0.45, 0.03 * s, body);
    crescent(g, body, rim, 0, 0.022 * s, 0.008 * s, 0.9);
    const ears = new Path2D();
    poly(ears, [-0.115 * s, -0.2 * s, -0.11 * s, -0.33 * s, -0.05 * s, -0.22 * s]);
    poly(ears, [0.05 * s, -0.22 * s, 0.11 * s, -0.33 * s, 0.115 * s, -0.2 * s]);
    g.fillStyle = 'rgba(192,96,154,0.85)';
    g.fill(ears);
    for (const side of [-1, 1]) {
      const ex = side * 0.06 * s;
      const ey = -0.15 * s;
      softEllipse(g, ex, ey, 0.075 * s, 0.075 * s, 0, '#ffb020', 0.85, 0.03 * s, undefined, 'lighter');
      const eg = g.createRadialGradient(ex - 0.01 * s, ey - 0.012 * s, 0, ex, ey, 0.05 * s);
      eg.addColorStop(0, '#fffbe0');
      eg.addColorStop(0.5, '#ffd23a');
      eg.addColorStop(1, '#ff8a00');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(ex, ey, 0.042 * s, 0.048 * s, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#1a0a10';
      g.beginPath();
      g.ellipse(ex + side * 0.005 * s, ey + 0.004 * s, 0.016 * s, 0.03 * s, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex - 0.012 * s, ey - 0.018 * s, 0.013 * s, 0, TAU);
      g.fill();
    }
    const fangs = new Path2D();
    poly(fangs, [-0.035 * s, -0.085 * s, -0.015 * s, -0.085 * s, -0.025 * s, -0.05 * s]);
    poly(fangs, [0.015 * s, -0.085 * s, 0.035 * s, -0.085 * s, 0.025 * s, -0.05 * s]);
    g.fillStyle = '#ffffff';
    g.fill(fangs);
  });
}

/** Bat of wingspan `size` facing the viewer; flap in -1..1. */
export function bat(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  flap: number,
  pal: Palette,
  alpha = 1,
): void {
  size *= OBJ;
  if (size < 2 || alpha <= 0.01) return;
  const fq = Math.round((Math.max(-1, Math.min(1, flap)) + 1) * 4);
  g.save();
  g.translate(x, y);
  g.globalAlpha *= alpha;
  blit(g, batSpr(fq, pal.rim, sizeBucket(size, 384)), size);
  g.restore();
}

// ---------------------------------------------------------------------------
// Spiders
// ---------------------------------------------------------------------------
type Leg = [number, number, number, number, number, number];
const LEG_BASE = [0.75, 1.25, 1.85, 2.35];

function spiderLegs(s: number, phase: number, fuzzy: boolean): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const alt = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? 0 : Math.PI;
      const swing = Math.sin(phase + alt) * 0.22;
      const a = side * (LEG_BASE[i]! + swing);
      const ax = s * ((fuzzy ? 0.12 : 0.16) - i * 0.05);
      const ay = side * s * 0.05;
      const kl = fuzzy ? 0.36 : 0.34;
      const kx = ax + Math.cos(a) * s * kl;
      const ky = ay + Math.sin(a) * s * kl - (fuzzy ? side * s * 0.04 : 0);
      const a2 = a + side * (i < 2 ? 0.5 : -0.5);
      const fl = fuzzy ? 0.34 : 0.3;
      legs.push([ax, ay, kx, ky, kx + Math.cos(a2) * s * fl, ky + Math.sin(a2) * s * fl]);
    }
  }
  return legs;
}

function legPath(legs: Leg[], w0: number, w1: number, w2: number, dx = 0, dy = 0): Path2D {
  const p = new Path2D();
  for (const [ax, ay, kx, ky, fx, fy] of legs) {
    taper(p, ax + dx, ay + dy, kx + dx, ky + dy, w0, w1, 2);
    taper(p, kx + dx, ky + dy, fx + dx, fy + dy, w1 * 0.9, w2, 2);
  }
  return p;
}

function drawLegs(
  g: CanvasRenderingContext2D,
  legs: Leg[],
  s: number,
  thick: number,
  rimW: number,
  rimColor: string,
  body: string,
  sheen: string,
): void {
  const w0 = Math.max(1.6, s * 0.075 * thick);
  const w1 = Math.max(1.3, s * 0.055 * thick);
  const w2 = Math.max(0.8, s * 0.02 * thick);
  if (rimW > 0) {
    // Rim light: wider silhouette nudged toward the light (upper left) so the lit edge dominates.
    g.fillStyle = rimColor;
    g.fill(legPath(legs, w0 + rimW * 1.4, w1 + rimW * 1.4, w2 + rimW * 1.4, -rimW * 0.35, -rimW * 0.45));
  }
  g.fillStyle = body;
  g.fill(legPath(legs, w0, w1, w2));
  if (s > 40) {
    g.fillStyle = sheen;
    g.fill(legPath(legs, w0 * 0.32, w1 * 0.32, w2 * 0.3, -s * 0.008, -s * 0.01));
  }
}

function spiderBody(color: string, rim: string, mark: string, U: number): Spr {
  return sprite(`sd:${color}:${rim}:${mark}`, U, 1.1, 0.76, 0.68, 0.38, (g, s) => {
    const abd = new Path2D();
    addEllipse(abd, -0.28 * s, 0, 0.32 * s, 0.26 * s);
    const ceph = new Path2D();
    addEllipse(ceph, 0.12 * s, 0, 0.17 * s, 0.15 * s);
    const union = new Path2D(abd);
    union.addPath(ceph);
    haloFill(g, union, rim, 0.045 * s, 0.6);
    // fuzz around the abdomen
    const fz = new Path2D();
    for (let k = 0; k < 44; k++) {
      const a = (k / 44) * TAU;
      const bx = -0.28 * s + Math.cos(a) * 0.3 * s;
      const by = Math.sin(a) * 0.24 * s;
      const tl = (0.04 + 0.03 * hash(k * 3.3)) * s;
      const ta = a + (hash(k) - 0.5) * 0.7;
      poly(fz, [
        bx - Math.sin(a) * 0.012 * s,
        by + Math.cos(a) * 0.012 * s,
        bx + Math.sin(a) * 0.012 * s,
        by - Math.cos(a) * 0.012 * s,
        bx + Math.cos(ta) * tl,
        by + Math.sin(ta) * tl,
      ]);
    }
    g.fillStyle = lighten(color, 0.25);
    g.fill(fz);
    for (const [p, cx, R] of [
      [abd, -0.28, 0.4],
      [ceph, 0.12, 0.22],
    ] as const) {
      const gr = g.createRadialGradient((cx - 0.1) * s, -0.1 * s, 0, cx * s, 0, R * s);
      gr.addColorStop(0, lighten(color, 0.35));
      gr.addColorStop(0.5, color);
      gr.addColorStop(1, darken(color, 0.55));
      g.fillStyle = gr;
      g.fill(p);
      crescent(g, p, rim, 0.03 * s, 0.035 * s, 0.01 * s, 0.9);
      crescent(g, p, rim, -0.025 * s, -0.02 * s, 0.01 * s, 0.45);
    }
    // glowing marking
    const mk = new Path2D();
    for (const [mx, ms] of [
      [-0.16, 0.055],
      [-0.29, 0.07],
      [-0.42, 0.045],
    ] as const) {
      poly(mk, [(mx - ms) * s, 0, mx * s, -ms * 0.75 * s, (mx + ms) * s, 0, mx * s, ms * 0.75 * s]);
    }
    haloFill(g, mk, mark, 0.025 * s, 0.9);
    const mg = g.createRadialGradient(-0.29 * s, 0, 0, -0.29 * s, 0, 0.18 * s);
    mg.addColorStop(0, lighten(mark, 0.6));
    mg.addColorStop(1, mark);
    g.fillStyle = mg;
    g.fill(mk);
    softEllipse(g, -0.38 * s, -0.11 * s, 0.08 * s, 0.04 * s, -0.4, '#ffffff', 0.5, 0.012 * s);
    softEllipse(g, 0.08 * s, -0.07 * s, 0.05 * s, 0.025 * s, -0.3, '#ffffff', 0.45, 0.008 * s);
    // chelicerae
    for (const side of [-1, 1]) {
      g.fillStyle = darken(color, 0.3);
      g.beginPath();
      g.ellipse(0.29 * s, side * 0.035 * s, 0.035 * s, 0.022 * s, 0, 0, TAU);
      g.fill();
    }
    // eyes with shine
    for (const side of [-1, 1]) {
      const ex = 0.2 * s;
      const ey = side * 0.062 * s;
      const sg = g.createRadialGradient(ex - 0.01 * s, ey - 0.01 * s, 0, ex, ey, 0.05 * s);
      sg.addColorStop(0, '#ffffff');
      sg.addColorStop(1, '#d9ccff');
      g.fillStyle = sg;
      g.beginPath();
      g.arc(ex, ey, 0.05 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#1b1030';
      g.beginPath();
      g.arc(ex + 0.016 * s, ey, 0.029 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex + 0.01 * s, ey - 0.012 * s, 0.011 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#120818';
      g.beginPath();
      g.arc(0.15 * s, side * 0.105 * s, 0.02 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(0.146 * s, side * 0.105 * s - 0.007 * s, 0.006 * s, 0, TAU);
      g.fill();
    }
  });
}

/** Top-down spider facing +x with body length `size`. */
export function spider(
  g: CanvasRenderingContext2D,
  size: number,
  phase: number,
  pal: Palette,
  color = '#2a1840',
): void {
  size *= OBJ;
  const s = size;
  if (s < 2) return;
  g.save();
  glowAt(g, -s * 0.15, 0, s * 0.9, pal.rim, 0.3);
  drawLegs(
    g,
    spiderLegs(s, phase, false),
    s,
    1,
    Math.max(1, s * 0.016),
    pal.rim,
    mixColor(color, pal.rim, 0.3),
    lighten(mixColor(color, pal.rim, 0.3), 0.4),
  );
  blit(g, spiderBody(color, pal.rim, pal.primary, sizeBucket(s, 384)), s);
  g.restore();
}

function fuzzyBody(rimColor: string, rq: number, eye: string, seed: number, U: number): Spr {
  return sprite(`fz:${rimColor}:${rq}:${eye}:${seed}`, U, 1.16, 0.84, 0.7, 0.42, (g, s) => {
    const abd = new Path2D();
    addEllipse(abd, -0.26 * s, 0, 0.3 * s, 0.25 * s);
    const ceph = new Path2D();
    addEllipse(ceph, 0.12 * s, 0, 0.15 * s, 0.14 * s);
    const union = new Path2D(abd);
    union.addPath(ceph);
    haloFill(g, union, rimColor, 0.05 * s, 0.3 + 0.45 * rq);
    const hairs = (outer: boolean): Path2D => {
      const p = new Path2D();
      const blobs = [
        [-0.26, 0.29, 0.24, 64],
        [0.12, 0.145, 0.135, 26],
      ] as const;
      for (const [cx, rx, ry, n] of blobs) {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + seed * 0.37;
          const bx = cx * s + Math.cos(a) * rx * s;
          const by = Math.sin(a) * ry * s;
          const tl = (0.045 + 0.035 * hash(k * 1.7 + seed + cx)) * s * (outer ? 1.25 : 1);
          const ta = a + (hash(k * 2.9 + seed) - 0.5) * 0.8;
          const bw = (outer ? 0.016 : 0.012) * s;
          poly(p, [
            bx - Math.sin(a) * bw,
            by + Math.cos(a) * bw,
            bx + Math.sin(a) * bw,
            by - Math.cos(a) * bw,
            bx + Math.cos(ta) * tl,
            by + Math.sin(ta) * tl,
          ]);
        }
      }
      return p;
    };
    g.save();
    g.globalAlpha = 0.45 + 0.5 * rq;
    g.fillStyle = rimColor;
    g.fill(hairs(true));
    g.restore();
    g.fillStyle = '#1e1230';
    g.fill(hairs(false));
    for (const [p, cx, R] of [
      [abd, -0.26, 0.38],
      [ceph, 0.12, 0.2],
    ] as const) {
      const gr = g.createRadialGradient((cx - 0.1) * s, -0.1 * s, 0, cx * s, 0, R * s);
      gr.addColorStop(0, '#2e1c44');
      gr.addColorStop(0.55, '#120a1c');
      gr.addColorStop(1, '#07030b');
      g.fillStyle = gr;
      g.fill(p);
      crescent(g, p, rimColor, 0.025 * s, 0.03 * s, 0.012 * s, 0.5 + 0.45 * rq);
    }
    // inner fur texture
    const tex = new Path2D();
    for (let k = 0; k < 40; k++) {
      const a = hash(k * 4.1 + seed) * TAU;
      const r = Math.sqrt(hash(k * 6.7 + seed)) * 0.85;
      const bx = -0.26 * s + Math.cos(a) * r * 0.28 * s;
      const by = Math.sin(a) * r * 0.23 * s;
      const ta = a + 0.5;
      poly(tex, [
        bx - 0.006 * s,
        by,
        bx + 0.006 * s,
        by,
        bx + Math.cos(ta) * 0.04 * s,
        by + Math.sin(ta) * 0.04 * s,
      ]);
    }
    g.save();
    g.clip(abd);
    g.fillStyle = 'rgba(70,48,100,0.45)';
    g.fill(tex);
    g.restore();
    softEllipse(g, -0.36 * s, -0.11 * s, 0.09 * s, 0.04 * s, -0.4, '#8a70b0', 0.35, 0.015 * s);
    // big glowing eyes
    softEllipse(g, 0.2 * s, 0, 0.13 * s, 0.13 * s, 0, eye, 0.55, 0.04 * s, undefined, 'lighter');
    for (const side of [-1, 1]) {
      const ex = 0.19 * s;
      const ey = side * 0.065 * s;
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex, ey, 0.06 * s, 0, TAU);
      g.fill();
      const ig = g.createRadialGradient(ex + 0.01 * s, ey, 0, ex + 0.01 * s, ey, 0.042 * s);
      ig.addColorStop(0, lighten(eye, 0.6));
      ig.addColorStop(0.6, eye);
      ig.addColorStop(1, darken(eye, 0.3));
      g.fillStyle = ig;
      g.beginPath();
      g.arc(ex + 0.01 * s, ey, 0.042 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#120818';
      g.beginPath();
      g.arc(ex + 0.025 * s, ey, 0.02 * s, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(ex + 0.012 * s, ey - 0.018 * s, 0.012 * s, 0, TAU);
      g.fill();
    }
  });
}

/**
 * Black fuzzy spider (top-down, facing +x, body length `size`). Dark silhouette with glowing
 * eyes; `rim` (0..1) adds a bright outline so it reads on dark AND bright backgrounds.
 */
export function fuzzySpider(
  g: CanvasRenderingContext2D,
  size: number,
  phase: number,
  rim: number,
  rimColor: string,
  eyeColor = '#ffe14d',
  seed = 0,
): void {
  size *= OBJ;
  const s = size;
  if (s < 2) return;
  const rimC = rim > 0 ? rimColor : '#7a4dbf';
  const rq = Math.round(clamp01(rim) * 4) / 4;
  g.save();
  if (rim > 0) glowAt(g, -s * 0.1, 0, s * 1.1, rimColor, 0.25 * rim);
  const rimW = s * (0.018 + 0.03 * rim);
  drawLegs(g, spiderLegs(s, phase, true), s, 1.12, rimW, rimC, '#0d0714', '#3a2a55');
  blit(g, fuzzyBody(rimC, rq, eyeColor, Math.abs(Math.round(seed)) % 3, sizeBucket(s, 384)), s);
  glowAt(g, s * 0.2, 0, s * 0.28, eyeColor, 0.35 + 0.35 * rim);
  g.restore();
}

// ---------------------------------------------------------------------------
// Cat
// ---------------------------------------------------------------------------
function catSpr(rim: string, blink: boolean, U: number): Spr {
  return sprite(`ct:${rim}:${blink ? 1 : 0}`, U, 1.04, 0.66, 0.46, 0.45, (g, s) => {
    const hx = 0.38 * s;
    const hy = -0.16 * s;
    const p = new Path2D();
    addEllipse(p, 0, -0.02 * s, 0.36 * s, 0.15 * s);
    addEllipse(p, -0.22 * s, 0, 0.16 * s, 0.14 * s);
    addEllipse(p, 0.25 * s, -0.07 * s, 0.13 * s, 0.12 * s, -0.5);
    addEllipse(p, hx, hy, 0.125 * s, 0.11 * s);
    addEllipse(p, hx + 0.02 * s, hy + 0.05 * s, 0.09 * s, 0.06 * s);
    poly(p, [hx - 0.105 * s, hy - 0.05 * s, hx - 0.085 * s, hy - 0.225 * s, hx - 0.005 * s, hy - 0.1 * s]);
    poly(p, [hx + 0.0 * s, hy - 0.1 * s, hx + 0.055 * s, hy - 0.225 * s, hx + 0.105 * s, hy - 0.045 * s]);
    haloFill(g, p, rim, 0.035 * s, 0.55);
    const lg = g.createLinearGradient(0, -0.38 * s, 0, 0.14 * s);
    lg.addColorStop(0, '#3a2f5a');
    lg.addColorStop(0.5, '#1c1630');
    lg.addColorStop(1, '#0e0a18');
    g.fillStyle = lg;
    g.fill(p);
    crescent(g, p, '#6a5a9e', 0, 0.045 * s, 0.03 * s, 0.55);
    crescent(g, p, rim, 0, 0.012 * s, 0.005 * s, 0.95);
    crescent(g, p, rim, -0.012 * s, 0, 0.005 * s, 0.6);
    crescent(g, p, rim, 0.012 * s, 0, 0.005 * s, 0.4);
    crescent(g, p, rim, 0, -0.01 * s, 0.006 * s, 0.3);
    softEllipse(g, -0.05 * s, -0.125 * s, 0.17 * s, 0.022 * s, 0.05, '#a99ae0', 0.35, 0.02 * s, p);
    softEllipse(g, -0.24 * s, -0.08 * s, 0.07 * s, 0.03 * s, -0.4, '#a99ae0', 0.3, 0.015 * s, p);
    softEllipse(g, hx - 0.03 * s, hy - 0.075 * s, 0.05 * s, 0.018 * s, -0.2, '#a99ae0', 0.35, 0.01 * s, p);
    const inner = new Path2D();
    poly(inner, [hx - 0.09 * s, hy - 0.07 * s, hx - 0.08 * s, hy - 0.19 * s, hx - 0.03 * s, hy - 0.1 * s]);
    poly(inner, [hx + 0.02 * s, hy - 0.1 * s, hx + 0.055 * s, hy - 0.19 * s, hx + 0.085 * s, hy - 0.07 * s]);
    g.fillStyle = 'rgba(150,70,130,0.7)';
    g.fill(inner);
    // eyes
    softEllipse(
      g,
      hx + 0.008 * s,
      hy - 0.01 * s,
      0.1 * s,
      0.07 * s,
      0,
      '#ffd23a',
      0.5,
      0.03 * s,
      undefined,
      'lighter',
    );
    for (const ex of [-0.035, 0.05]) {
      const cx = hx + ex * s;
      const cy = hy - 0.01 * s;
      const eg = g.createRadialGradient(cx - 0.006 * s, cy - 0.008 * s, 0, cx, cy, 0.036 * s);
      eg.addColorStop(0, '#fffbd6');
      eg.addColorStop(0.45, '#ffe14d');
      eg.addColorStop(1, '#ff9a1a');
      g.fillStyle = eg;
      g.beginPath();
      g.ellipse(cx, cy, 0.03 * s, 0.036 * s * (blink ? 0.2 : 1), 0, 0, TAU);
      g.fill();
      if (!blink) {
        g.fillStyle = '#120818';
        g.beginPath();
        g.ellipse(cx + 0.003 * s, cy, 0.008 * s, 0.028 * s, 0, 0, TAU);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(cx + 0.011 * s, cy - 0.013 * s, 0.009 * s, 0, TAU);
        g.fill();
      }
    }
    const nose = new Path2D();
    poly(nose, [hx + 0.1 * s, hy + 0.02 * s, hx + 0.125 * s, hy + 0.02 * s, hx + 0.115 * s, hy + 0.04 * s]);
    g.fillStyle = '#e07aa0';
    g.fill(nose);
    const wh = new Path2D();
    for (let k = 0; k < 3; k++)
      taper(
        wh,
        hx + 0.09 * s,
        hy + 0.045 * s,
        hx + 0.24 * s,
        hy + (0.0 + k * 0.03) * s,
        0.007 * s,
        0.0015 * s,
      );
    g.fillStyle = rgba('#ffffff', 0.45);
    g.fill(wh);
  });
}

/** Side-view black cat facing +x, body length `size`, feet at y = size*0.32. */
export function cat(
  g: CanvasRenderingContext2D,
  size: number,
  walk: number,
  moving: boolean,
  t: number,
  pal: Palette,
): void {
  size *= OBJ;
  const s = size;
  if (s < 2) return;
  g.save();
  glowAt(g, 0, 0, s * 0.9, pal.rim, 0.2);
  const sway = Math.sin(t * 2.2) * 0.25;
  const step = moving ? Math.sin(walk) : 0;
  // tail: rises from the rump in a gentle S curve
  const P0: [number, number] = [-0.32 * s, -0.06 * s];
  const C1: [number, number] = [-0.48 * s, -0.12 * s];
  const C2: [number, number] = [(-0.46 + sway * 0.1) * s, -0.3 * s];
  const P3: [number, number] = [(-0.42 + sway * 0.25) * s, -0.42 * s];
  const pts: [number, number][] = [];
  for (let k = 0; k <= 10; k++) {
    const u = k / 10;
    const a = (1 - u) ** 3;
    const b = 3 * (1 - u) ** 2 * u;
    const c = 3 * (1 - u) * u * u;
    const d = u ** 3;
    pts.push([a * P0[0] + b * C1[0] + c * C2[0] + d * P3[0], a * P0[1] + b * C1[1] + c * C2[1] + d * P3[1]]);
  }
  const legs: [number, number, boolean][] = [
    [-0.22, step, false],
    [-0.12, -step, true],
    [0.18, -step, false],
    [0.28, step, true],
  ];
  const limbs = (grow: number, onlyFar?: boolean): Path2D => {
    const p = new Path2D();
    if (onlyFar !== true) ribbon(p, pts, 0.075 * s + grow * 2, 0.04 * s + grow * 2);
    for (const [lx, ph, far] of legs) {
      if (onlyFar !== undefined && far !== onlyFar) continue;
      const x0 = lx * s;
      const x1 = x0 + ph * s * 0.08;
      taper(p, x0, 0.04 * s, x1, 0.285 * s, 0.085 * s + grow * 2, 0.06 * s + grow * 2);
      addEllipse(p, x1 + 0.015 * s, 0.298 * s, 0.045 * s + grow, 0.022 * s + grow);
    }
    return p;
  };
  const rimW = Math.max(1.2, s * 0.016);
  g.save();
  g.translate(-rimW * 0.35, -rimW * 0.45);
  g.fillStyle = pal.rim;
  g.fill(limbs(rimW * 0.7));
  g.restore();
  g.fillStyle = '#1a1428';
  g.fill(limbs(0, true));
  g.fillStyle = '#2c2346';
  g.fill(limbs(0, false));
  if (s > 24) {
    const ls = new Path2D();
    for (const [lx, ph, far] of legs) {
      if (far) continue;
      const x0 = lx * s + 0.022 * s;
      taper(ls, x0, 0.06 * s, x0 + ph * s * 0.08, 0.27 * s, 0.018 * s, 0.01 * s);
    }
    g.fillStyle = rgba('#8a7ac0', 0.45);
    g.fill(ls);
    const sheen = new Path2D();
    ribbon(
      sheen,
      pts.map(([x, y]) => [x + 0.01 * s, y - 0.004 * s] as [number, number]),
      0.022 * s,
      0.01 * s,
    );
    g.fillStyle = rgba('#7a6ab0', 0.55);
    g.fill(sheen);
  }
  const blink = Math.sin(t * 1.3) > 0.97;
  const bob = moving ? Math.abs(step) * s * 0.008 : 0;
  blit(g, catSpr(pal.rim, blink, sizeBucket(s, 384)), s, 0, -bob);
  g.restore();
}

// ---------------------------------------------------------------------------
// Tombstone
// ---------------------------------------------------------------------------
function tombSpr(style: number, rim: string, q: number, U: number): Spr {
  return sprite(`tb:${style}:${rim}:${q}`, U, 1.5, q + 0.34, 0.75, q + 0.17, (g, W) => {
    const H = q * W;
    const p = new Path2D();
    if (style === 0) {
      p.moveTo(-W / 2, 0);
      p.lineTo(-W / 2, -H + W / 2);
      p.arc(0, -H + W / 2, W / 2, Math.PI, 0);
      p.lineTo(W / 2, 0);
      p.closePath();
    } else if (style === 1) {
      p.roundRect(-W / 2, -H, W, H, W * 0.12);
    } else {
      p.rect(-W * 0.15, -H, W * 0.3, H);
      p.rect(-W * 0.45, -H * 0.75, W * 0.9, W * 0.28);
    }
    haloFill(g, p, rim, W * 0.05, 0.35);
    const lg = g.createLinearGradient(0, -H, 0, 0);
    lg.addColorStop(0, '#62628a');
    lg.addColorStop(0.5, '#3a3a56');
    lg.addColorStop(1, '#1e1e30');
    g.fillStyle = lg;
    g.fill(p);
    g.save();
    g.clip(p);
    for (let k = 0; k < 80; k++) {
      const x = (hash(k * 3.1 + style) - 0.5) * W;
      const y = -hash(k * 7.7 + 1.3) * H;
      const r = (0.004 + 0.012 * hash(k * 1.9)) * W;
      g.fillStyle = k % 2 ? 'rgba(150,150,190,0.22)' : 'rgba(8,8,16,0.35)';
      g.beginPath();
      g.arc(x, y, r, 0, TAU);
      g.fill();
    }
    for (let k = 0; k < 6; k++)
      softEllipse(
        g,
        (-0.4 + k * 0.08) * W,
        (-0.015 - hash(k + style) * 0.06) * W,
        0.075 * W,
        0.04 * W,
        0,
        k % 2 ? '#3f7a2c' : '#2b5a1e',
        0.9,
        0.006 * W,
      );
    g.restore();
    if (style !== 2) {
      const y0 = -H + (style === 0 ? 0.09 : 0.04) * W;
      const cp = new Path2D();
      ribbon(
        cp,
        [
          [0.22 * W, y0],
          [0.14 * W, y0 + 0.1 * W],
          [0.19 * W, y0 + 0.2 * W],
          [0.11 * W, y0 + 0.32 * W],
        ],
        0.03 * W,
        0.005 * W,
      );
      g.fillStyle = 'rgba(8,8,14,0.9)';
      g.fill(cp);
    }
    crescent(g, p, '#a4a4d0', 0.04 * W, 0.045 * W, 0.02 * W, 0.55);
    crescent(g, p, '#06060c', -0.05 * W, -0.04 * W, 0.03 * W, 0.6);
    crescent(g, p, rim, -0.025 * W, 0.012 * W, 0.006 * W, 0.85);
    crescent(g, p, rim, 0, 0.02 * W, 0.006 * W, 0.45);
    if (style !== 2) {
      const ty = -H * 0.55;
      const engrave = (dx: number, dy: number) => {
        g.fillText('RIP', dx, ty + dy);
        g.beginPath();
        g.roundRect(-W * 0.25 + dx, -H * 0.32 + dy, W * 0.5, Math.max(1, W * 0.035), W * 0.017);
        g.roundRect(-W * 0.18 + dx, -H * 0.22 + dy, W * 0.36, Math.max(1, W * 0.035), W * 0.017);
        g.fill();
      };
      g.font = `bold ${Math.max(1, Math.round(W * 0.28))}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = mixColor(rim, '#ffffff', 0.25);
      g.globalAlpha = 0.85;
      engrave(0, 0);
      g.globalAlpha = 1;
      g.fillStyle = '#0c0c16';
      engrave(-0.009 * W, -0.011 * W);
    }
    const gp = new Path2D();
    for (let k = 0; k < 16; k++) {
      const bx = (-0.64 + k * 0.085 + hash(k + style * 5) * 0.03) * W;
      const hgt = (0.05 + 0.09 * hash(k * 2.3 + style)) * W;
      const lean = (hash(k * 5.1) - 0.5) * 0.07 * W;
      poly(gp, [bx - 0.026 * W, 0.03 * W, bx + 0.026 * W, 0.03 * W, bx + lean, -hgt]);
    }
    g.fillStyle = '#17261a';
    g.fill(gp);
    crescent(g, gp, rim, 0, 0.012 * W, 0.003 * W, 0.6);
  });
}

export function tombstone(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  pal: Palette,
  tilt = 0,
  style = 0,
): void {
  w *= OBJ;
  h *= OBJ;
  if (w < 2 || h < 2) return;
  const q = Math.max(0.5, Math.round((h / w) * 4) / 4);
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.scale(1, h / w / q);
  blit(g, tombSpr(((style % 3) + 3) % 3, pal.rim, q, sizeBucket(w, 384)), w);
  g.restore();
}

// ---------------------------------------------------------------------------
// Prints, leaves, misc
// ---------------------------------------------------------------------------

/** Top-down bare footprint (pointing up = -y). */
export function footprint(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  left: boolean,
  color: string,
  alpha: number,
): void {
  size *= OBJ;
  if (alpha <= 0.01) return;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  if (left) g.scale(-1, 1);
  g.globalAlpha *= alpha;
  glowAt(g, 0, 0, size * 0.9, color, 0.35);
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(0, size * 0.1, size * 0.2, size * 0.36, 0.1, 0, TAU);
  g.fill();
  const toes = [
    [-0.13, -0.38, 0.09],
    [-0.01, -0.44, 0.075],
    [0.09, -0.41, 0.065],
    [0.17, -0.34, 0.056],
    [0.23, -0.25, 0.05],
  ];
  for (const [tx, ty, tr] of toes) {
    g.beginPath();
    g.arc(tx! * size, ty! * size, tr! * size, 0, TAU);
    g.fill();
  }
  g.restore();
}

export function fadeInOut(t: number, dur: number, fin = 0.15, fout = 0.2): number {
  const p = t / dur;
  return clamp01(p / fin) * clamp01((1 - p) / fout);
}

/** Glowing paw print (pointing -y). */
export function pawPrint(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  alpha: number,
): void {
  size *= OBJ;
  if (alpha <= 0.01) return;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.globalAlpha *= alpha;
  glowAt(g, 0, 0, size * 1.1, color, 0.5);
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(0, size * 0.12, size * 0.26, size * 0.22, 0, 0, TAU);
  g.fill();
  for (const [tx, ty] of [
    [-0.28, -0.18],
    [-0.1, -0.32],
    [0.1, -0.32],
    [0.28, -0.18],
  ]) {
    g.beginPath();
    g.ellipse(tx! * size, ty! * size, size * 0.1, size * 0.13, tx! * 0.8, 0, TAU);
    g.fill();
  }
  g.restore();
}

function leafSpr(color: string, U: number): Spr {
  return sprite(`lf:${color}`, U, 1.24, 1.4, 0.62, 0.62, (g, S) => {
    const p = new Path2D();
    const lobes = 5;
    const tipR = [0.36, 0.47, 0.53, 0.47, 0.36];
    const ang = (k: number) => -Math.PI / 2 + (k - 2) * 0.72;
    const at = (a: number, r: number): [number, number] => [Math.cos(a) * r * S, Math.sin(a) * r * S];
    const start = at(ang(0) - 0.4, 0.2);
    p.moveTo(0, 0.1 * S);
    p.lineTo(start[0], start[1]);
    for (let k = 0; k < lobes; k++) {
      const a = ang(k);
      const R = tipR[k]!;
      const t1 = at(a - 0.2, R * 0.72);
      const tip = at(a, R);
      const t2 = at(a + 0.2, R * 0.72);
      p.lineTo(t1[0], t1[1]);
      p.lineTo(tip[0], tip[1]);
      p.lineTo(t2[0], t2[1]);
      const n = at(a + 0.36, 0.2);
      const ctrl = at(a + 0.36, 0.3);
      p.quadraticCurveTo(ctrl[0], ctrl[1], n[0], n[1]);
    }
    p.closePath();
    const gr = g.createRadialGradient(-0.05 * S, -0.08 * S, 0, 0, 0, 0.55 * S);
    gr.addColorStop(0, lighten(color, 0.35));
    gr.addColorStop(0.5, color);
    gr.addColorStop(1, darken(color, 0.35));
    g.fillStyle = gr;
    g.fill(p);
    const veins = new Path2D();
    for (let k = 0; k < lobes; k++) {
      const tip = at(ang(k), tipR[k]! * 0.85);
      taper(veins, 0, 0.08 * S, tip[0], tip[1], 0.035 * S, 0.006 * S);
    }
    taper(veins, 0, 0.08 * S, 0.02 * S, 0.62 * S, 0.045 * S, 0.025 * S);
    g.fillStyle = rgba(darken(color, 0.5), 0.55);
    g.fill(veins);
    crescent(g, p, '#ffffff', 0.03 * S, 0.035 * S, 0.012 * S, 0.35);
    crescent(g, p, darken(color, 0.6), -0.03 * S, -0.03 * S, 0.015 * S, 0.4);
  });
}

/** Maple-ish autumn leaf of height ~`size`; `glow` 0 disables the halo (cheap confetti). */
export function leaf(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  angle: number,
  color: string,
  alpha = 1,
  glow = 1,
): void {
  if (alpha <= 0.01 || size < 1) return;
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.globalAlpha *= alpha;
  if (glow > 0) glowAt(g, 0, 0, size * 0.9, color, 0.35 * glow);
  blit(g, leafSpr(color, sizeBucket(size, 256)), size);
  g.restore();
}

/** Run a draw callback with a soft colored glow around everything it fills (dusk boost). */
export function withRim(
  g: CanvasRenderingContext2D,
  size: number,
  boost: number,
  color: string,
  fn: () => void,
): void {
  if (boost <= 0) {
    fn();
    return;
  }
  g.save();
  g.shadowColor = color;
  g.shadowBlur = Math.max(2, size * 0.1 * boost);
  fn();
  // A second pass strengthens the halo so dark bodies read on bright backgrounds too.
  if (boost > 0.4) fn();
  g.restore();
}
