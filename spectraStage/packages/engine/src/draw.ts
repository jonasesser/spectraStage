/** Small deterministic drawing / math helpers for theme authors. */

export const TAU = Math.PI * 2;

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export const ease = {
  outCubic: (t: number) => 1 - (1 - clamp01(t)) ** 3,
  inOutSine: (t: number) => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2,
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    const x = clamp01(t);
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
  },
  /** 0→1→0 envelope with soft attack/release fractions. */
  envelope: (t: number, attack = 0.15, release = 0.25) =>
    smoothstep(0, attack, t) * (1 - smoothstep(1 - release, 1, t)),
};

/** Integer hash → [0,1). */
export function hash01(n: number): number {
  let x = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [0,1). */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i * 374761393 + seed * 668265263);
  const b = hash01((i + 1) * 374761393 + seed * 668265263);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Soft radial glow. */
export function glow(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
): void {
  if (r <= 0 || alpha <= 0) return;
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, rgba(color, alpha));
  grad.addColorStop(0.4, rgba(color, alpha * 0.35));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

export function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

/** Simple 5-point star path. */
export function starPath(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot = 0): void {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
}
