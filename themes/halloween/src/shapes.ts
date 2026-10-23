/**
 * Character and prop drawing for the Halloween theme. All functions are pure (no state),
 * draw around (x, y) and are sized in pixels. Projection-friendly: bright shapes or dark
 * shapes with a glowing rim (black = no light).
 */
import { clamp01, TAU } from '@spectrastage/engine';
import type { DrawState } from '@spectrastage/engine';
import type { Palette } from './palette.ts';

// ---------------------------------------------------------------------------
// Sizing & sprites
// ---------------------------------------------------------------------------

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
  const n = parseInt(color.slice(1), 16);
  const r = (n >> 16) & 255;
  const gg = (n >> 8) & 255;
  const b = n & 255;
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

/** Ghost of total height `size`, centered at (x, y). */
export function ghost(g: CanvasRenderingContext2D, x: number, y: number, size: number, o: GhostOpts): void {
  const alpha = o.alpha ?? 1;
  if (alpha <= 0.01 || size < 2) return;
  const w = size * 0.74;
  const r = w / 2;
  const top = -size / 2;
  const bottom = size / 2;
  g.save();
  g.translate(x, y);
  if (o.mirror) g.scale(-1, 1);
  g.globalAlpha *= alpha;
  glowAt(g, 0, 0, size * 0.95, o.color, 0.35 * (o.glow ?? 1));
  // arms
  const wave = o.wave ?? 0;
  g.fillStyle = o.color;
  for (const side of [-1, 1]) {
    g.save();
    g.translate(side * r * 0.92, top + r * 1.5);
    g.rotate(side * (0.5 + (side > 0 ? wave : -wave * 0.4)));
    g.beginPath();
    g.ellipse(side * r * 0.25, 0, r * 0.38, r * 0.17, 0, 0, TAU);
    g.fill();
    g.restore();
  }
  // body
  g.beginPath();
  g.arc(0, top + r, r, Math.PI, 0);
  g.lineTo(r, bottom - size * 0.08);
  const bumps = 4;
  for (let i = 0; i < bumps; i++) {
    const x0 = r - (i * w) / bumps;
    const x1 = r - ((i + 1) * w) / bumps;
    const wob = Math.sin(o.t * 5 + i * 1.7) * size * 0.035;
    g.quadraticCurveTo((x0 + x1) / 2, bottom + wob + size * 0.06, x1, bottom - size * 0.08);
  }
  g.closePath();
  g.fillStyle = o.color;
  g.fill();
  // subtle shading
  g.globalAlpha *= 0.18;
  g.fillStyle = '#7a8cff';
  g.beginPath();
  g.ellipse(r * 0.35, size * 0.05, r * 0.45, size * 0.38, 0, 0, TAU);
  g.fill();
  g.globalAlpha /= 0.18;
  // face
  const face = o.face ?? 'happy';
  const ey = top + r * 0.95;
  const blink = Math.sin(o.t * 0.9 + x * 0.01) > 0.985 ? 0.15 : 1;
  g.fillStyle = '#1b1030';
  if (face === 'sleepy') {
    g.strokeStyle = '#1b1030';
    g.lineWidth = Math.max(1, size * 0.03);
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(s * r * 0.36, ey, r * 0.16, 0.2, Math.PI - 0.2);
      g.stroke();
    }
  } else {
    const er = face === 'wow' ? r * 0.2 : r * 0.17;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(s * r * 0.36, ey, er * 0.8, er * 1.15 * blink, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(s * r * 0.36 + er * 0.25, ey - er * 0.4 * blink, er * 0.3, 0, TAU);
      g.fill();
      g.fillStyle = '#1b1030';
    }
  }
  const my = ey + r * 0.55;
  if (face === 'oo' || face === 'wow') {
    g.beginPath();
    g.ellipse(0, my, r * 0.14, r * (face === 'wow' ? 0.24 : 0.18), 0, 0, TAU);
    g.fill();
  } else {
    g.strokeStyle = '#1b1030';
    g.lineWidth = Math.max(1, size * 0.028);
    g.lineCap = 'round';
    g.beginPath();
    g.arc(0, my - r * 0.12, r * 0.22, 0.25, Math.PI - 0.25);
    g.stroke();
  }
  if (o.blush) {
    g.fillStyle = o.blush;
    g.globalAlpha *= 0.5;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(s * r * 0.62, my - r * 0.05, r * 0.13, r * 0.08, 0, 0, TAU);
      g.fill();
    }
  }
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

/** Jack-o'-lantern of height `size` centered at (x, y). Faces 0..5, -1 = uncarved. */
export function pumpkin(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  o: PumpkinOpts,
): void {
  if (size < 2) return;
  const alpha = o.alpha ?? 1;
  const glowAmt = o.glow ?? 1;
  const sq = o.squash ?? 0;
  const w = size * 1.18 * (1 + sq * 0.12);
  const h = size * 0.86 * (1 - sq * 0.12);
  g.save();
  g.translate(x, y);
  g.globalAlpha *= alpha;
  glowAt(g, 0, 0, size * 1.1, o.pal.primary, 0.28 * glowAmt);
  // stem
  g.fillStyle = '#5b8f3a';
  g.beginPath();
  g.moveTo(-size * 0.05, -h * 0.42);
  g.quadraticCurveTo(-size * 0.02, -h * 0.72, size * 0.12, -h * 0.68);
  g.lineTo(size * 0.08, -h * 0.4);
  g.closePath();
  g.fill();
  // ribs
  const ribs = [
    { dx: -0.3, rx: 0.26, c: '#c95a0c' },
    { dx: 0.3, rx: 0.26, c: '#c95a0c' },
    { dx: -0.15, rx: 0.28, c: '#e36f12' },
    { dx: 0.15, rx: 0.28, c: '#e36f12' },
    { dx: 0, rx: 0.27, c: '#f5851f' },
  ];
  for (const rb of ribs) {
    g.fillStyle = rb.c;
    g.beginPath();
    g.ellipse(rb.dx * w, 0, rb.rx * w, h / 2, 0, 0, TAU);
    g.fill();
  }
  g.strokeStyle = 'rgba(120,40,0,0.5)';
  g.lineWidth = Math.max(1, size * 0.012);
  for (const dx of [-0.15, 0.15]) {
    g.beginPath();
    g.ellipse(dx * w, 0, 0.16 * w, h * 0.47, 0, -1.2, 1.2);
    g.stroke();
  }
  // highlight
  g.fillStyle = 'rgba(255,220,150,0.25)';
  g.beginPath();
  g.ellipse(-w * 0.18, -h * 0.22, w * 0.08, h * 0.12, -0.4, 0, TAU);
  g.fill();
  const face = o.face ?? 0;
  if (face >= 0) {
    const flicker = 0.85 + 0.15 * Math.sin((o.t ?? 0) * 13 + x * 0.1) * Math.sin((o.t ?? 0) * 7.3);
    const light = '#ffe27a';
    g.fillStyle = light;
    g.shadowColor = '#ffb020';
    g.shadowBlur = size * 0.12 * glowAmt;
    g.globalAlpha *= 0.75 + 0.25 * flicker * glowAmt;
    pumpkinFace(g, face, w, h);
    g.shadowBlur = 0;
  }
  g.restore();
}

function tri(
  g: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): void {
  g.beginPath();
  g.moveTo(ax, ay);
  g.lineTo(bx, by);
  g.lineTo(cx, cy);
  g.closePath();
  g.fill();
}

function pumpkinFace(g: CanvasRenderingContext2D, face: number, w: number, h: number): void {
  const ex = w * 0.18;
  const ey = -h * 0.12;
  const es = w * 0.1;
  switch (face % 6) {
    case 0: // classic happy
      tri(g, -ex - es, ey + es * 0.6, -ex + es, ey + es * 0.6, -ex, ey - es * 0.8);
      tri(g, ex - es, ey + es * 0.6, ex + es, ey + es * 0.6, ex, ey - es * 0.8);
      tri(g, -es * 0.5, h * 0.04, es * 0.5, h * 0.04, 0, -h * 0.03);
      g.beginPath();
      g.moveTo(-w * 0.3, h * 0.1);
      g.quadraticCurveTo(0, h * 0.42, w * 0.3, h * 0.1);
      g.quadraticCurveTo(w * 0.12, h * 0.2, w * 0.06, h * 0.16);
      g.lineTo(w * 0.03, h * 0.22);
      g.lineTo(-w * 0.03, h * 0.16);
      g.quadraticCurveTo(-w * 0.15, h * 0.22, -w * 0.3, h * 0.1);
      g.fill();
      break;
    case 1: // surprised
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(s * ex, ey, es * 0.9, 0, TAU);
        g.fill();
      }
      g.beginPath();
      g.ellipse(0, h * 0.2, w * 0.08, h * 0.12, 0, 0, TAU);
      g.fill();
      break;
    case 2: // wink
      tri(g, -ex - es, ey + es * 0.6, -ex + es, ey + es * 0.6, -ex, ey - es * 0.8);
      g.beginPath();
      g.ellipse(ex, ey + es * 0.2, es, es * 0.3, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.moveTo(-w * 0.25, h * 0.12);
      g.quadraticCurveTo(0, h * 0.36, w * 0.25, h * 0.12);
      g.quadraticCurveTo(0, h * 0.22, -w * 0.25, h * 0.12);
      g.fill();
      break;
    case 3: // silly
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(s * ex, ey, es * 0.7, es, s * 0.3, 0, TAU);
        g.fill();
      }
      g.beginPath();
      g.moveTo(-w * 0.28, h * 0.08);
      g.lineTo(-w * 0.14, h * 0.18);
      g.lineTo(0, h * 0.1);
      g.lineTo(w * 0.14, h * 0.2);
      g.lineTo(w * 0.28, h * 0.08);
      g.lineTo(w * 0.22, h * 0.28);
      g.lineTo(-w * 0.22, h * 0.28);
      g.closePath();
      g.fill();
      break;
    case 4: // sleepy
      for (const s of [-1, 1]) {
        g.beginPath();
        g.ellipse(s * ex, ey + es * 0.3, es, es * 0.35, 0, 0, Math.PI);
        g.fill();
      }
      g.beginPath();
      g.ellipse(0, h * 0.2, w * 0.12, h * 0.05, 0, 0, TAU);
      g.fill();
      break;
    default: // big grin
      for (const s of [-1, 1]) tri(g, s * ex - es, ey, s * ex + es, ey, s * ex + s * es * 0.3, ey - es * 1.1);
      g.beginPath();
      g.moveTo(-w * 0.34, h * 0.04);
      g.quadraticCurveTo(0, h * 0.5, w * 0.34, h * 0.04);
      g.quadraticCurveTo(0, h * 0.18, -w * 0.34, h * 0.04);
      g.fill();
  }
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
  if (size < 4) return;
  const u = size / 10;
  g.save();
  g.translate(x, y + size / 2 - pose.bounce * u);
  glowAt(g, 0, -size * 0.5, size * 0.75, glowColor, 0.25);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const bone = (x1: number, y1: number, x2: number, y2: number, wdt: number) => {
    g.lineWidth = wdt;
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
    g.beginPath();
    g.arc(x2, y2, wdt * 0.6, 0, TAU);
    g.fill();
  };
  const hipY = -u * 3.8;
  const hx = Math.sin(pose.hip) * u * 0.6;
  // legs
  for (const [side, ang] of [
    [-1, pose.legL],
    [1, pose.legR],
  ] as const) {
    const kx = hx + side * u * 0.6 + Math.sin(ang) * u * 1.9;
    const ky = hipY + Math.cos(ang) * u * 1.9;
    bone(hx + side * u * 0.5, hipY, kx, ky, u * 0.42);
    bone(kx, ky, kx + side * u * 0.1, 0, u * 0.38);
    g.beginPath();
    g.ellipse(kx + side * u * 0.45, -u * 0.1, u * 0.55, u * 0.25, 0, 0, TAU);
    g.fill();
  }
  // pelvis
  g.beginPath();
  g.ellipse(hx, hipY, u * 1.0, u * 0.45, 0, 0, TAU);
  g.fill();
  // spine
  const chestY = -u * 6.6;
  g.lineWidth = u * 0.35;
  g.beginPath();
  g.moveTo(hx, hipY);
  g.quadraticCurveTo(hx * 0.5, (hipY + chestY) / 2, 0, chestY);
  g.stroke();
  // ribs
  g.lineWidth = u * 0.28;
  for (let i = 0; i < 3; i++) {
    const ry = chestY + u * 0.5 + i * u * 0.6;
    const rw = u * (1.2 - i * 0.15);
    g.beginPath();
    g.ellipse(0, ry, rw, u * 0.32, 0, 0, Math.PI);
    g.stroke();
  }
  // shoulders + arms
  const shY = chestY - u * 0.1;
  g.lineWidth = u * 0.4;
  g.beginPath();
  g.moveTo(-u * 1.3, shY);
  g.lineTo(u * 1.3, shY);
  g.stroke();
  for (const [side, a, f] of [
    [-1, pose.armL, pose.foreL],
    [1, pose.armR, pose.foreR],
  ] as const) {
    const sx = side * u * 1.3;
    const ex = sx + side * Math.cos(a) * u * 1.7;
    const ey = shY - Math.sin(a) * u * 1.7;
    bone(sx, shY, ex, ey, u * 0.36);
    const hx2 = ex + side * Math.cos(a + f) * u * 1.5;
    const hy2 = ey - Math.sin(a + f) * u * 1.5;
    bone(ex, ey, hx2, hy2, u * 0.32);
    g.beginPath();
    g.arc(hx2, hy2, u * 0.35, 0, TAU);
    g.fill();
  }
  // skull
  g.save();
  g.translate(0, shY - u * 1.6);
  g.rotate(pose.head);
  g.beginPath();
  g.arc(0, 0, u * 1.35, 0, TAU);
  g.fill();
  g.beginPath();
  g.roundRect(-u * 0.75, u * 0.6, u * 1.5, u * 0.8, u * 0.3);
  g.fill();
  g.fillStyle = '#1b1030';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.ellipse(s * u * 0.5, -u * 0.05, u * 0.38, u * 0.45, 0, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.moveTo(0, u * 0.35);
  g.lineTo(-u * 0.15, u * 0.6);
  g.lineTo(u * 0.15, u * 0.6);
  g.closePath();
  g.fill();
  g.lineWidth = u * 0.12;
  g.strokeStyle = '#1b1030';
  for (let i = -2; i <= 2; i++) {
    g.beginPath();
    g.moveTo(i * u * 0.25, u * 0.85);
    g.lineTo(i * u * 0.25, u * 1.25);
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.arc(s * u * 0.5 + u * 0.1, -u * 0.15, u * 0.11, 0, TAU);
    g.fill();
  }
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
// Bat, spider, cat, tombstone
// ---------------------------------------------------------------------------
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
  if (size < 2 || alpha <= 0.01) return;
  const s = size / 2;
  g.save();
  g.translate(x, y);
  g.globalAlpha *= alpha;
  const body = '#2b1846';
  g.fillStyle = body;
  g.strokeStyle = pal.rim;
  g.lineWidth = Math.max(1, size * 0.03);
  g.lineJoin = 'round';
  for (const side of [-1, 1]) {
    const tipY = -s * 0.55 * flap;
    g.beginPath();
    g.moveTo(side * s * 0.12, -s * 0.12);
    g.quadraticCurveTo(side * s * 0.55, -s * 0.35 + tipY * 0.6, side * s, tipY - s * 0.15);
    g.quadraticCurveTo(side * s * 0.85, s * 0.05 + tipY * 0.3, side * s * 0.72, s * 0.12 + tipY * 0.2);
    g.quadraticCurveTo(side * s * 0.6, s * 0.0 + tipY * 0.2, side * s * 0.48, s * 0.18 + tipY * 0.1);
    g.quadraticCurveTo(side * s * 0.36, s * 0.05, side * s * 0.25, s * 0.2);
    g.quadraticCurveTo(side * s * 0.18, s * 0.08, side * s * 0.1, s * 0.12);
    g.closePath();
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.ellipse(0, 0, s * 0.17, s * 0.24, 0, 0, TAU);
  g.fill();
  g.stroke();
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * s * 0.05, -s * 0.18);
    g.lineTo(side * s * 0.13, -s * 0.36);
    g.lineTo(side * s * 0.16, -s * 0.14);
    g.fill();
  }
  g.fillStyle = '#ffe066';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * s * 0.065, -s * 0.06, s * 0.045, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** Top-down spider facing +x with body length `size`. */
export function spider(
  g: CanvasRenderingContext2D,
  size: number,
  phase: number,
  pal: Palette,
  color = '#2a1840',
): void {
  const s = size;
  g.save();
  g.lineCap = 'round';
  g.strokeStyle = pal.rim;
  g.lineWidth = Math.max(1.2, s * 0.05);
  // Legs radiate from the cephalothorax: front pair forward, back pair backward.
  const baseAngles = [0.75, 1.25, 1.85, 2.35];
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const alt = (i + (side > 0 ? 0 : 1)) % 2 === 0 ? 0 : Math.PI;
      const swing = Math.sin(phase + alt) * 0.22;
      const a = side * (baseAngles[i]! + swing);
      const ax = s * (0.16 - i * 0.05);
      const ay = side * s * 0.05;
      const kx = ax + Math.cos(a) * s * 0.34;
      const ky = ay + Math.sin(a) * s * 0.34;
      const a2 = a + side * (i < 2 ? -0.5 : 0.5) * -1;
      const fx = kx + Math.cos(a2) * s * 0.3;
      const fy = ky + Math.sin(a2) * s * 0.3;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(kx, ky - side * s * 0.0);
      g.lineTo(fx, fy);
      g.stroke();
    }
  }
  glowAt(g, -s * 0.15, 0, s * 0.9, pal.rim, 0.3);
  g.fillStyle = color;
  g.lineWidth = Math.max(1, s * 0.035);
  g.beginPath();
  g.ellipse(-s * 0.28, 0, s * 0.32, s * 0.26, 0, 0, TAU);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(s * 0.12, 0, s * 0.17, s * 0.15, 0, 0, TAU);
  g.fill();
  g.stroke();
  // markings
  g.fillStyle = pal.primary;
  g.beginPath();
  g.ellipse(-s * 0.3, 0, s * 0.12, s * 0.06, 0, 0, TAU);
  g.fill();
  // eyes
  g.fillStyle = '#ffffff';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(s * 0.2, side * s * 0.065, s * 0.055, 0, TAU);
    g.fill();
  }
  g.fillStyle = '#1b1030';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(s * 0.22, side * s * 0.065, s * 0.028, 0, TAU);
    g.fill();
  }
  g.restore();
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
  const s = size;
  g.save();
  glowAt(g, 0, 0, s * 0.9, pal.rim, 0.2);
  const body = '#2c2346';
  g.fillStyle = body;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // tail: rises from the rump in a gentle S curve
  const sway = Math.sin(t * 2.2) * 0.25;
  const tail = () => {
    g.beginPath();
    g.moveTo(-s * 0.32, -s * 0.06);
    g.bezierCurveTo(
      -s * 0.48,
      -s * 0.12,
      -s * 0.46 + sway * s * 0.1,
      -s * 0.3,
      -s * 0.42 + sway * s * 0.25,
      -s * 0.42,
    );
    g.stroke();
  };
  g.strokeStyle = pal.rim;
  g.lineWidth = s * 0.07 + Math.max(2, s * 0.03);
  tail();
  g.strokeStyle = body;
  g.lineWidth = s * 0.07;
  tail();
  // legs
  const step = moving ? Math.sin(walk) : 0;
  const legs: [number, number][] = [
    [-0.22, step],
    [-0.12, -step],
    [0.18, -step],
    [0.28, step],
  ];
  for (const pass of [0, 1]) {
    g.strokeStyle = pass === 0 ? pal.rim : body;
    g.lineWidth = s * 0.06 + (pass === 0 ? Math.max(2, s * 0.03) : 0);
    for (const [lx, ph] of legs) {
      g.beginPath();
      g.moveTo(lx * s, s * 0.05);
      g.lineTo(lx * s + ph * s * 0.08, s * 0.3);
      g.stroke();
    }
  }
  // body
  g.fillStyle = body;
  g.strokeStyle = pal.rim;
  g.lineWidth = Math.max(1, s * 0.022);
  g.beginPath();
  g.ellipse(0, -s * 0.02, s * 0.36, s * 0.15, 0, 0, TAU);
  g.fill();
  g.stroke();
  // head
  const hx = s * 0.38;
  const hy = -s * 0.16 + (moving ? Math.abs(step) * s * 0.01 : 0);
  g.beginPath();
  g.moveTo(hx - s * 0.1, hy - s * 0.08);
  g.lineTo(hx - s * 0.08, hy - s * 0.22);
  g.lineTo(hx - s * 0.01, hy - s * 0.11);
  g.lineTo(hx + s * 0.05, hy - s * 0.22);
  g.lineTo(hx + s * 0.1, hy - s * 0.07);
  g.arc(hx, hy, s * 0.12, -0.3, Math.PI + 0.3, false);
  g.closePath();
  g.fill();
  g.stroke();
  const blink = Math.sin(t * 1.3) > 0.97 ? 0.2 : 1;
  g.fillStyle = '#ffe14d';
  for (const ex of [-0.035, 0.05]) {
    g.beginPath();
    g.ellipse(hx + ex * s, hy - s * 0.01, s * 0.028, s * 0.034 * blink, 0, 0, TAU);
    g.fill();
  }
  glowAt(g, hx + s * 0.01, hy, s * 0.12, '#ffe14d', 0.35);
  g.restore();
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
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  g.fillStyle = '#2a2a3e';
  g.strokeStyle = pal.rim;
  g.lineWidth = Math.max(1, w * 0.04);
  g.beginPath();
  if (style % 3 === 0) {
    g.moveTo(-w / 2, 0);
    g.lineTo(-w / 2, -h + w / 2);
    g.arc(0, -h + w / 2, w / 2, Math.PI, 0);
    g.lineTo(w / 2, 0);
  } else if (style % 3 === 1) {
    g.roundRect(-w / 2, -h, w, h, w * 0.12);
  } else {
    // cross
    g.rect(-w * 0.15, -h, w * 0.3, h);
    g.rect(-w * 0.45, -h * 0.75, w * 0.9, w * 0.28);
  }
  g.closePath();
  g.fill();
  g.stroke();
  if (style % 3 !== 2) {
    g.fillStyle = pal.rim;
    g.globalAlpha *= 0.65;
    g.font = `bold ${Math.round(w * 0.28)}px sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('RIP', 0, -h * 0.55);
    g.fillRect(-w * 0.25, -h * 0.32, w * 0.5, Math.max(1, w * 0.03));
    g.fillRect(-w * 0.18, -h * 0.22, w * 0.36, Math.max(1, w * 0.03));
  }
  g.restore();
}

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
