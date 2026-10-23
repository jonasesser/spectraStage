/**
 * "Dark" scenes: the projection stays black – the real house is the set. Every few seconds one
 * small event happens in a soft pool of light: a spider drops on its thread, eyes open in the
 * dark, a ghost peeks in from the edge, a cat strolls by, a pumpkin lights up, a bat flits past.
 * Fully deterministic from (time, seed, params).
 */
import { canvasScene, hash01, noise1, smoothstep, TAU } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { palette, type Palette } from '../palette.ts';
import { bat, cat, footprint, fuzzySpider, ghost, glowAt, glowEllipse, pumpkin, px } from '../shapes.ts';
import { speedOf } from './common.ts';

type Ev = 'spider' | 'eyes' | 'ghost' | 'cat' | 'pumpkin' | 'bat' | 'steps';

const WALL_EVENTS: Ev[] = ['spider', 'eyes', 'ghost', 'cat', 'pumpkin', 'bat'];
const FLOOR_EVENTS: Ev[] = ['spider', 'eyes', 'ghost', 'cat', 'pumpkin', 'bat', 'steps'];
const DURATION: Record<Ev, number> = {
  spider: 11,
  eyes: 9,
  ghost: 9,
  cat: 11,
  pumpkin: 8,
  bat: 6,
  steps: 10,
};

interface Ctx {
  g: CanvasRenderingContext2D;
  s: DrawState;
  pal: Palette;
  /** seconds since event start */
  t: number;
  dur: number;
  /** per-event random 0..1 */
  r: (k: number) => number;
  floor: boolean;
}

/** Soft "flashlight" pool so dark creatures are readable on a black projection. */
function spot(c: Ctx, x: number, y: number, radius: number, alpha: number): void {
  glowAt(c.g, x, y, radius, c.pal.ghost, 0.16 * alpha, 0.15);
}

function spiderDrop(c: Ctx): void {
  const { g, s, t, dur } = c;
  const size = px(s, 0.42, 0.07, 0.15);
  if (c.floor) {
    // Walks across with stop-and-go pauses
    const dir = c.r(1) < 0.5 ? 1 : -1;
    const y0 = s.h * (0.2 + 0.6 * c.r(2));
    const y1 = s.h * (0.2 + 0.6 * c.r(3));
    const k = t / dur;
    const step = Math.floor(k * 5);
    const prog = (step + smoothstep(0, 0.65, k * 5 - step)) / 5;
    const u = -0.08 + prog * 1.16;
    const x = (dir > 0 ? u : 1 - u) * s.w;
    const y = y0 + (y1 - y0) * prog;
    spot(c, x, y, size * 2.6, 1);
    g.save();
    g.translate(x, y);
    g.rotate(Math.atan2(y1 - y0, dir * s.w * 1.16));
    fuzzySpider(g, size, prog * 40, 1, c.pal.rim, '#ffe14d', 7);
    g.restore();
    return;
  }
  const x = s.w * (0.15 + 0.7 * c.r(1));
  const yEnd = s.h * (0.35 + 0.3 * c.r(2));
  const down = smoothstep(0, 0.32, t / dur);
  const up = smoothstep(0.72, 1, t / dur);
  const bob = Math.sin(t * 2.4) * size * 0.25 * (down - up);
  const y = -size + (yEnd + size) * (down - up) + bob;
  const sway = Math.sin(t * 1.3) * size * 0.15;
  // Thread
  g.save();
  g.strokeStyle = c.pal.ghost;
  g.globalAlpha = 0.55;
  g.lineWidth = Math.max(1, size * 0.03);
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x + sway, y - size * 0.4);
  g.stroke();
  g.restore();
  spot(c, x + sway, y, size * 2.4, down - up * 0.5);
  g.save();
  g.translate(x + sway, y);
  g.rotate(Math.PI / 2 + Math.sin(t * 1.3) * 0.08);
  // legs twitch a little while hanging
  fuzzySpider(g, size, Math.sin(t * 3) * 2 + (down < 1 || up > 0 ? t * 8 : 0), 1, c.pal.rim, '#ffe14d', 3);
  g.restore();
}

function eyes(c: Ctx): void {
  const { g, s, t, dur } = c;
  const n = 3 + Math.floor(c.r(1) * 4);
  const m = Math.min(s.w, s.h);
  for (let i = 0; i < n; i++) {
    const open0 = 0.5 + i * 0.6 + c.r(10 + i) * 0.8;
    const close0 = dur - 1.8 - (n - i) * 0.25;
    const a = smoothstep(open0, open0 + 0.35, t) * (1 - smoothstep(close0, close0 + 0.3, t));
    if (a <= 0.01) continue;
    const blinkP = 2.5 + c.r(20 + i) * 2;
    const bt = (t + c.r(30 + i) * blinkP) % blinkP;
    const blink = bt < 0.18 ? Math.abs(bt - 0.09) / 0.09 : 1;
    const open = a * blink;
    const x = s.w * (0.1 + 0.8 * c.r(40 + i));
    const y = s.h * (c.floor ? 0.15 + 0.7 * c.r(50 + i) : 0.25 + 0.6 * c.r(50 + i));
    const sz = m * (0.018 + 0.02 * c.r(60 + i));
    const col = [c.pal.secondary, '#b6ff4d', c.pal.primary, '#ff4d6a'][Math.floor(c.r(70 + i) * 4)]!;
    const look = noise1(t * 0.4, i * 13) * sz * 0.35;
    for (const side of [-1, 1]) {
      const ex = x + side * sz * 1.5;
      glowEllipse(g, ex, y, sz * 2.4, sz * 1.6 * Math.max(0.15, open), col, 0.45 * a);
      g.save();
      g.translate(ex, y);
      g.scale(1, Math.max(0.04, open));
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(0, 0, sz, sz * 0.62, side * 0.18, 0, TAU);
      g.fill();
      g.fillStyle = '#000';
      g.beginPath();
      g.ellipse(look, 0, sz * 0.18, sz * 0.5, 0, 0, TAU);
      g.fill();
      g.restore();
    }
  }
}

function ghostPeek(c: Ctx): void {
  const { s, t, dur } = c;
  const size = px(s, 1.1, 0.18, 0.45);
  const fromLeft = c.r(1) < 0.5;
  const a = smoothstep(0, 1, t) * (1 - smoothstep(dur - 1, dur, t));
  if (c.floor) {
    const u = t / dur;
    const x = (fromLeft ? -0.15 + u * 1.3 : 1.15 - u * 1.3) * s.w;
    const y = s.h * (0.3 + 0.4 * c.r(2)) + Math.sin(t * 1.4) * size * 0.15;
    ghost(c.g, x, y, size * 0.8, { color: c.pal.ghost, t, alpha: a, face: 'happy', mirror: !fromLeft });
    return;
  }
  // slide in halfway, look around, wave, slip away
  const inK = smoothstep(0, 0.25, t / dur) - smoothstep(0.75, 1, t / dur);
  const edge = fromLeft ? 0 : s.w;
  const x = edge + (fromLeft ? 1 : -1) * (-size * 0.6 + inK * size * 0.95);
  const y = s.h * (0.3 + 0.35 * c.r(2)) + Math.sin(t * 1.6) * size * 0.06;
  const face = t / dur > 0.45 && t / dur < 0.6 ? 'wow' : 'oo';
  ghost(c.g, x, y, size, {
    color: c.pal.ghost,
    t,
    alpha: Math.max(a, inK),
    face,
    wave: inK,
    mirror: !fromLeft,
  });
}

function catWalk(c: Ctx): void {
  const { g, s, t, dur } = c;
  const size = px(s, 0.7, 0.12, 0.3);
  const dir = c.r(1) < 0.5 ? 1 : -1;
  // walk – stop and look – walk on
  const k = t / dur;
  const prog = smoothstep(0, 0.42, k) * 0.5 + smoothstep(0.58, 1, k) * 0.5;
  const moving = !(k > 0.42 && k < 0.58);
  const u = -0.12 + prog * 1.24;
  const x = (dir > 0 ? u : 1 - u) * s.w;
  const y = c.floor ? s.h * (0.3 + 0.4 * c.r(2)) : s.h - size * 0.55;
  spot(c, x, y, size * 1.8, 1);
  g.save();
  g.translate(x, y);
  if (dir < 0) g.scale(-1, 1);
  cat(g, size, prog * 30, moving, t, c.pal);
  g.restore();
}

function pumpkinWake(c: Ctx): void {
  const { s, t, dur } = c;
  const size = px(s, 0.7, 0.12, 0.3);
  const x = s.w * (0.15 + 0.7 * c.r(1));
  const y = c.floor ? s.h * (0.25 + 0.5 * c.r(2)) : s.h - size * 0.6;
  const vis = smoothstep(0, 1.2, t) * (1 - smoothstep(dur - 1.2, dur, t));
  // candle catches: flicker before it burns steadily
  const flick = t < 2 ? 0.4 + 0.6 * (noise1(t * 12, 5) > 0.45 ? 1 : 0.2) : 0.85 + 0.15 * noise1(t * 6, 9);
  pumpkin(c.g, x, y, size, {
    pal: c.pal,
    face: Math.floor(c.r(3) * 6),
    glow: vis * flick,
    t,
    alpha: vis,
    squash: Math.sin(t * 3) * 0.03,
  });
}

function batFlit(c: Ctx): void {
  const { s, t, dur } = c;
  const size = px(s, 0.6, 0.09, 0.2);
  const dir = c.r(1) < 0.5 ? 1 : -1;
  const u = -0.1 + (t / dur) * 1.2;
  const x = (dir > 0 ? u : 1 - u) * s.w;
  const yb = s.h * (c.floor ? 0.2 + 0.6 * c.r(2) : 0.15 + 0.4 * c.r(2));
  const y = yb + noise1(t * 1.5, 3) * s.h * 0.15 + Math.sin(t * 5) * size * 0.2;
  spot(c, x, y, size * 2, 0.8);
  bat(c.g, x, y, size, Math.sin(t * 16), c.pal);
}

function steps(c: Ctx): void {
  const { s, t, dur } = c;
  const size = px(s, 0.28, 0.04, 0.1);
  const dir = c.r(1) < 0.5 ? 1 : -1;
  const y0 = s.h * (0.25 + 0.5 * c.r(2));
  const n = 16;
  for (let i = 0; i < n; i++) {
    const at = (i / n) * (dur - 3);
    const a = smoothstep(at, at + 0.2, t) * (1 - smoothstep(at + 2.2, at + 3, t));
    if (a <= 0.01) continue;
    const u = 0.05 + (i / (n - 1)) * 0.9;
    const x = (dir > 0 ? u : 1 - u) * s.w;
    const y = y0 + Math.sin(i * 0.5) * s.h * 0.06 + (i % 2 ? 1 : -1) * size * 0.45;
    footprint(c.g, x, y, size, dir > 0 ? Math.PI / 2 : -Math.PI / 2, i % 2 === 0, c.pal.primary, a);
  }
}

const DRAW: Record<Ev, (c: Ctx) => void> = {
  spider: spiderDrop,
  eyes,
  ghost: ghostPeek,
  cat: catWalk,
  pumpkin: pumpkinWake,
  bat: batFlit,
  steps,
};

function allowed(s: DrawState, def: string): Ev[] {
  const floor = s.kind === 'floor';
  const pool = floor ? FLOOR_EVENTS : WALL_EVENTS;
  const pick = String(s.params.events ?? def);
  if (pick === 'mix') return pool;
  if (pick === 'creatures') return pool.filter((e) => e !== 'eyes' && e !== 'pumpkin');
  return pool.includes(pick as Ev) ? [pick as Ev] : pool;
}

function darkScene(id: string, def: string): SceneModule {
  return canvasScene(id, (g, s, f) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, s.w, s.h);
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const pause = Math.max(1, Number(s.params.pause ?? 8));
    const evs = allowed(s, def);
    const longest = Math.max(...evs.map((e) => DURATION[e]));
    const period = longest + pause;
    const slot = Math.floor(t / period);
    // check this slot and the previous one (an event can never be longer than one period)
    for (const k of [slot - 1, slot]) {
      if (k < 0) continue;
      const h = (n: number) => hash01(s.seed * 0.0001 + k * 97.13 + n * 13.7);
      let idx = Math.floor(h(0) * evs.length);
      // avoid the same event twice in a row
      const prevIdx = Math.floor(hash01(s.seed * 0.0001 + (k - 1) * 97.13) * evs.length);
      if (evs.length > 1 && k > 0 && idx === prevIdx) idx = (idx + 1) % evs.length;
      const ev = evs[idx]!;
      const dur = DURATION[ev];
      const start = k * period + h(1) * (period - dur) * 0.6;
      const lt = t - start;
      if (lt < 0 || lt > dur) continue;
      DRAW[ev]({ g, s, pal, t: lt, dur, r: (n) => h(n + 2), floor: s.kind === 'floor' });
    }
  });
}

export const darkScenes: SceneModule[] = [
  darkScene('darkSurprises', 'mix'),
  darkScene('darkSpider', 'spider'),
  darkScene('darkEyes', 'eyes'),
];
