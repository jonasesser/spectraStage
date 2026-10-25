import { createRng } from '@spectrastage/shared';
import type { DrawState } from '@spectrastage/engine';
import { memo, TAU } from '@spectrastage/engine';
import { num } from '../palette.ts';
import { star } from '../shapes.ts';

export function speedOf(s: DrawState): number {
  return num(s.params, 'speed', 1);
}

export function densityOf(s: DrawState): number {
  return num(s.params, 'density', 1);
}

/** Particle count scaled by density, quality and surface area (relative to a 1080p frame). */
export function countOf(s: DrawState, base: number, min = 1, max = 400): number {
  const area = Math.sqrt((s.w * s.h) / (1920 * 1080));
  return Math.max(
    min,
    Math.min(max, Math.round(base * densityOf(s) * (0.4 + 0.6 * s.quality) * Math.max(0.7, area))),
  );
}

export interface StarField {
  x: number;
  y: number;
  r: number;
  rate: number;
  phase: number;
}

export function starField(s: DrawState, n: number, maxY = 0.6): StarField[] {
  return memo(s, `stars:${n}:${maxY}`, () => {
    const rng = createRng(s.seed ^ 0x5f3759df);
    return Array.from({ length: n }, () => ({
      x: rng() * s.w,
      y: rng() * s.h * maxY,
      r: (0.6 + rng() * 1.8) * Math.max(1, Math.min(s.w, s.h) / 500),
      rate: 0.5 + rng() * 2,
      phase: rng() * TAU,
    }));
  });
}

export function drawStars(
  g: CanvasRenderingContext2D,
  stars: StarField[],
  t: number,
  color = '#ffffff',
): void {
  for (const st of stars) {
    const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.rate + st.phase));
    star(g, st.x, st.y, st.r * 2.2, color, a);
  }
}

export interface TreeSeg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
}

/** Spooky bare tree as line segments (seeded). */
export function treeSegments(seed: number, x: number, y: number, height: number): TreeSeg[] {
  const rng = createRng(seed);
  const segs: TreeSeg[] = [];
  const grow = (x1: number, y1: number, len: number, ang: number, width: number, depth: number) => {
    const x2 = x1 + Math.cos(ang) * len;
    const y2 = y1 + Math.sin(ang) * len;
    segs.push({ x1, y1, x2, y2, w: width });
    if (depth <= 0) return;
    const n = depth > 3 ? 2 : 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const spread = 0.35 + rng() * 0.5;
      const a = ang + (i - (n - 1) / 2) * spread + (rng() - 0.5) * 0.3;
      grow(x2, y2, len * (0.62 + rng() * 0.18), a, width * 0.65, depth - 1);
    }
  };
  grow(x, y, height * 0.38, -Math.PI / 2 + (rng() - 0.5) * 0.1, height * 0.07, 5);
  return segs;
}

export function drawTree(
  g: CanvasRenderingContext2D,
  segs: TreeSeg[],
  rim: string,
  fill: string,
  sway = 0,
): void {
  g.save();
  g.lineCap = 'round';
  for (const pass of [0, 1]) {
    g.strokeStyle = pass === 0 ? rim : fill;
    g.globalAlpha = pass === 0 ? 0.55 : 1;
    for (const sgm of segs) {
      const k = sway * Math.max(0, segs[0]!.y1 - sgm.y2) * 0.002;
      g.lineWidth = Math.max(1, sgm.w + (pass === 0 ? 3 : 0));
      g.beginPath();
      g.moveTo(sgm.x1 + k * 0.6, sgm.y1);
      g.lineTo(sgm.x2 + k, sgm.y2);
      g.stroke();
    }
  }
  g.restore();
}

/** Positive modulo. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}

/** True when this surface shows a side/ground/ceiling part of a world – no second house there. */
export function isSidePart(s: DrawState): boolean {
  return !!s.world && s.world.self.role !== 'main';
}
