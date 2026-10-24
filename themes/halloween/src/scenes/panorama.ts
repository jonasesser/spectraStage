/**
 * Panorama worlds: ONE continuous landscape in stage meters. Every wall surface renders only its
 * own window of it, so hills, ground, fence, fog, trees and creatures line up across the seams and
 * a ghost that leaves one wall enters the next. The centerpiece (the house) stands once, centered
 * on the main wall. In room mode the world is periodic over the wall ring, so the last wall joins
 * the first seamlessly.
 *
 * Everything placed "by world x" uses either integer-frequency sines over the period or a cell
 * grid whose cell count divides the period – both are periodic by construction.
 */
import { canvasScene, hash01, hybridScene, memo, noise1, smoothstep, TAU } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { palette, type Palette } from '../palette.ts';
import {
  bat,
  dancePose,
  footprint,
  fuzzySpider,
  cat,
  glowAt,
  glowEllipse,
  leaf,
  pawPrint,
  ghost,
  pumpkin,
  skeleton,
  star,
  type GhostFace,
} from '../shapes.ts';
import { web } from './floor.ts';
import { monster } from './wall.ts';
import { drawPiece, paintPiece, PIECE_HALF, type PieceId } from './pieces.ts';
import { FOG_FRAG, LIME, neonUniforms } from './neon.ts';
import { densityOf, mod, speedOf } from './common.ts';
import {
  addGlow,
  buildManor,
  envPalette,
  fogTexture,
  lightPool,
  mixHex,
  offscreen,
  paintTombstone,
  paintTree,
  SKY_FRAG,
  skyUniforms,
  winPath,
  type EnvPalette,
  type Manor,
  type StoneKind,
} from './env.ts';

export interface PanoOpts {
  house: boolean;
  graves: number;
  ghosts: number;
  bats: number;
  pumpkins: number;
  party: boolean;
  /** Zauberwelt: a stone spirit portal on the lawn instead of the house, glowing path. */
  portal?: boolean;
  /** Monsterhaus: monsters peek out of the windows, glowing tracks lead out of the door. */
  monsters?: boolean;
  /** Centerpieces of the other walls, in order around the room (side 0, 1, 2 …). */
  sides?: PieceId[];
  /** Centerpiece of the main wall when there is no house/portal. */
  mainPiece?: PieceId;
  /** Big, bright, friendly cast (neon look): large ghosts, dancing skeletons, big pumpkins. */
  big?: boolean;
  /** Use the neon palette regardless of the mood param default. */
  neon?: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };

interface Frame {
  r: Rect;
  ppm: number;
  /** Period (meters) and origin of the world along x. */
  P: number;
  X0: number;
  wrap: boolean;
  /** Main wall height – the size unit of the world. */
  U: number;
  hzY: number;
  groundY: number;
  fenceY: number;
  houseX: number;
  houseW: number;
  seed: number;
  /** Bottom edge of the main wall = where the ground in front of the house begins. */
  mainBottom: number;
  /** Floor surface laid out directly below the main wall (the front yard / driveway). */
  frontGround: Rect | null;
  /** A floor continues directly below this surface (no vignette / edge grass needed). */
  groundBelowSelf: boolean;
  /** Centerpieces of all walls in world x. */
  pieces: { id: PieceId; X: number }[];
}

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];

function frame(s: DrawState, o: PanoOpts): Frame {
  return memo(s, 'panoFrame', () => {
    const w = s.world;
    const r: Rect = w ? w.self.rect : { x: 0, y: 0, w: s.w / s.ppm, h: s.h / s.ppm };
    const main = w?.surfaces.find((x) => x.role === 'main')?.rect ?? r;
    const walls = w?.surfaces.filter((x) => x.role === 'main' || x.role === 'side') ?? [];
    const ring = w?.wrap ?? null;
    const x0 = walls.length ? Math.min(...walls.map((x) => x.rect.x)) : r.x;
    const x1 = walls.length ? Math.max(...walls.map((x) => x.rect.x + x.rect.w)) : r.x + r.w;
    const U = Math.max(0.5, main.h);
    return {
      r,
      ppm: s.ppm,
      P: ring ? ring.w : Math.max(x1 - x0, U * 4),
      X0: ring ? ring.x : x0,
      wrap: !!ring,
      U,
      hzY: main.y + U * 0.68,
      groundY: main.y + U * 0.8,
      fenceY: main.y + U * 0.9,
      houseX: main.x + main.w / 2,
      houseW: o.house || o.portal ? Math.min(main.w * 0.56, U * 0.66) : 0,
      seed: (w?.seed ?? s.seed) & 0xffff,
      mainBottom: main.y + main.h,
      frontGround: below(w?.surfaces ?? [], main),
      groundBelowSelf: !!below(w?.surfaces ?? [], r),
      pieces: [
        ...(o.mainPiece ? [{ id: o.mainPiece, X: main.x + main.w / 2 }] : []),
        ...(o.sides?.length
          ? (w?.surfaces ?? [])
              .filter((x) => x.role === 'side')
              .map((x) => ({ id: o.sides![x.roleIndex % o.sides!.length]!, X: x.rect.x + x.rect.w / 2 }))
          : []),
      ],
    };
  });
}

/** The floor laid out directly below a wall in the unfolded stage (= the ground in front of it). */
function below(surfaces: readonly { role: string; rect: Rect }[], wall: Rect): Rect | null {
  const bottom = wall.y + wall.h;
  return (
    surfaces
      .filter((x) => x.role === 'ground')
      .map((x) => x.rect)
      .filter((g) => Math.abs(g.y - bottom) < 0.6 && g.x < wall.x + wall.w && g.x + g.w > wall.x)
      .sort((a, b) => Math.abs(a.y - bottom) - Math.abs(b.y - bottom))[0] ?? null
  );
}

/**
 * The garden path in stage meters: from the door down the wall (fake perspective: it widens
 * towards the viewer) and then straight on across the floor in front of the house at its real
 * width – the same function is used on the wall and on the floor, so both halves meet exactly.
 */
function pathHalf(F: Frame, Y: number): number {
  const dw = F.houseW * 0.09;
  if (Y <= F.mainBottom) {
    const v = Math.max(0, (Y - F.groundY) / Math.max(0.05, F.mainBottom - F.groundY));
    return dw * (0.7 + 2.5 * v * v);
  }
  return dw * 3.2 + (Y - F.mainBottom) * 0.04;
}

interface PathPumpkin {
  X: number;
  Y: number;
  size: number;
  face: number;
}

/** Jack-o'-lanterns lining the path – on the wall and continued on the floor. */
function pathPumpkins(F: Frame, d: number): PathPumpkin[] {
  const out: PathPumpkin[] = [];
  if (!F.houseW) return out;
  const dw = F.houseW * 0.09;
  const nW = Math.max(1, Math.round(Math.min(4, d * 3)));
  for (let k = 0; k < nW; k++) {
    const v = (k + 0.6) / nW;
    const Y = F.groundY + (F.mainBottom - F.groundY) * v * 0.85;
    for (const side of [-1, 1])
      out.push({
        X: F.houseX + side * (pathHalf(F, Y) + dw * 0.8),
        Y,
        size: F.U * 0.09 * (0.55 + 0.6 * v),
        face: (k * 2 + (side > 0 ? 1 : 0) + F.seed) % 6,
      });
  }
  const g = F.frontGround;
  if (g) {
    const step = Math.max(0.7, 0.95 / Math.max(0.5, d));
    let k = 0;
    for (let Y = F.mainBottom + step * 0.5; Y < g.y + g.h - 0.15; Y += step, k++)
      for (const side of [-1, 1])
        out.push({
          X: F.houseX + side * (pathHalf(F, Y) + F.U * 0.08),
          Y,
          size: F.U * 0.11,
          face: (k * 2 + (side > 0 ? 1 : 0) + F.seed + 3) % 6,
        });
  }
  return out;
}

/** Portal ring radius and center height (meters). */
const portalR = (F: Frame) => F.U * 0.2;
const portalY = (F: Frame) => F.groundY - portalR(F) * 1.32;

/**
 * Glowing monster tracks from the front door down the path and on across the floor. Steps
 * appear one after another and fade – the same list is drawn on the wall and on the floor.
 */
function drawTracks(g: CanvasRenderingContext2D, F: Frame, t: number, color: string) {
  if (!F.houseW) return;
  const end = F.frontGround ? F.frontGround.y + F.frontGround.h : F.mainBottom;
  const stride = 0.42;
  const cycle = 14;
  const ph = (t % cycle) / cycle;
  const pts: { X: number; Y: number; k: number; size: number }[] = [];
  let k = 0;
  // on the wall: fake perspective (small near the door, bigger towards the viewer)
  for (let v = 0.15; v <= 1; v += 0.28, k++) {
    const Y = F.groundY + (F.mainBottom - F.groundY) * v;
    pts.push({
      X: F.houseX + (k % 2 ? 1 : -1) * pathHalf(F, Y) * 0.35,
      Y,
      k,
      size: F.U * (0.025 + 0.03 * v),
    });
  }
  for (let Y = F.mainBottom + stride * 0.5; Y < end - 0.1; Y += stride, k++)
    pts.push({ X: F.houseX + (k % 2 ? 1 : -1) * 0.1, Y, k, size: 0.2 });
  const n = pts.length;
  for (const p of pts) {
    const at = (p.k / n) * 0.6;
    const a = smoothstep(at, at + 0.04, ph) * (1 - smoothstep(at + 0.3, at + 0.4, ph));
    if (a <= 0.01) continue;
    if (p.X < F.r.x - 0.3 || p.X > F.r.x + F.r.w + 0.3 || p.Y < F.r.y - 0.3 || p.Y > F.r.y + F.r.h + 0.3)
      continue;
    footprint(g, px(F, p.X), py(F, p.Y), p.size * F.ppm, Math.PI, p.k % 2 === 0, color, a);
  }
}

/** Sparkles drifting down the glowing magic path (wall and floor alike). */
function drawPathSparkles(g: CanvasRenderingContext2D, F: Frame, t: number, color: string) {
  if (!F.houseW) return;
  const end = F.frontGround ? F.frontGround.y + F.frontGround.h : F.mainBottom;
  const len = end - F.groundY;
  for (let i = 0; i < 18; i++) {
    const u = mod(t * 0.05 + hash01(i * 7 + F.seed), 1);
    const Y = F.groundY + u * len;
    const X = F.houseX + (hash01(i * 13 + F.seed) - 0.5) * 1.6 * pathHalf(F, Y);
    if (X < F.r.x || X > F.r.x + F.r.w || Y < F.r.y || Y > F.r.y + F.r.h) continue;
    const sz = (Y > F.mainBottom ? 0.05 : F.U * 0.012 * (0.5 + u)) * F.ppm;
    addGlow(g, px(F, X), py(F, Y), sz * 3, color, 0.4);
    star(g, px(F, X), py(F, Y), sz, '#ffffff', 0.5 + 0.5 * Math.sin(t * 4 + i));
  }
}

/** Like mixHex but returns '#rrggbb' so the result can be mixed again. */
function mixHexHex(a: string, b: string, t: number): string {
  const m = mixHex(a, b, t).match(/\d+/g)!.map(Number);
  return '#' + m.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Neon ghost like in the reference: half transparent, lavender, with a strong glow and a
 * glowing veil trailing behind it.
 */
function neonGhost(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  t: number,
  face: GhostFace,
  mirror: boolean,
) {
  const back = mirror ? 1 : -1;
  for (let k = 0; k < 3; k++) {
    const ox = x + back * size * (0.35 + k * 0.32);
    const oy = y + size * (0.15 + k * 0.06) + Math.sin(t * 2 + k) * size * 0.05;
    glowEllipse(
      g,
      ox,
      oy,
      size * (0.55 - k * 0.1),
      size * (0.28 - k * 0.05),
      k % 2 ? '#d04dff' : '#a9b8ff',
      0.45 - k * 0.1,
    );
  }
  glowAt(g, x, y, size * 1.2, '#b98cff', 0.35);
  ghost(g, x, y, size, {
    color: '#e6dcff',
    t,
    alpha: 0.72,
    face,
    wave: Math.sin(t * 2) * 0.6,
    glow: 2.4,
    mirror,
    blush: '#ff9ac8',
  });
}

/** Neon: purple glow at the bottom of the walls = where the glowing floor begins. */
const NEON_SEAM = '#3a1468';

/**
 * Neon look (reference picture): big friendly ghosts around the house, dancing skeletons and big
 * jack-o'-lanterns in front of it. Placed in world meters around the house.
 */
function drawBigCast(
  g: CanvasRenderingContext2D,
  F: Frame,
  pal: Palette,
  t: number,
  visible: (X: number, Y: number, r: number) => boolean,
) {
  const { U } = F;
  const top = F.groundY - U * 0.8;
  const spots: [number, number, number][] = [
    [-0.95, 0.42, 1],
    [0.95, 0.48, 1],
    [-0.45, 0.2, 0.6],
    [0.5, 0.16, 0.6],
  ];
  spots.forEach(([dx, dy, k], i) => {
    const X = F.houseX + dx * F.houseW + Math.sin(t * 0.35 + i * 1.7) * U * 0.06;
    const Y = top + dy * U + Math.sin(t * 0.8 + i) * U * 0.04;
    const size = U * 0.3 * k;
    if (!visible(X, Y, size)) return;
    neonGhost(g, px(F, X), py(F, Y), size * F.ppm, t + i, FACES[i % 4]!, dx > 0);
  });
  const beat = (t * 108) / 60;
  [-0.62, -0.32, 0.36, 0.66].forEach((dx, i) => {
    const size = U * 0.3;
    const X = F.houseX + dx * F.houseW * 1.3;
    const Y = F.groundY + U * 0.06 - size / 2;
    if (!visible(X, Y, size)) return;
    skeleton(
      g,
      px(F, X),
      py(F, Y),
      size * F.ppm,
      dancePose(beat + (i % 2) * 0.5, (i + Math.floor(beat / 8)) % 4),
      pal.ghost,
      pal.party[i % pal.party.length],
    );
  });
  [-1.05, -0.8, 0.82, 1.1].forEach((dx, i) => {
    const size = U * (0.12 + 0.03 * (i % 2));
    const X = F.houseX + dx * F.houseW;
    const Y = F.groundY + U * 0.1;
    if (!visible(X, Y, size)) return;
    pumpkin(g, px(F, X), py(F, Y), size * F.ppm, {
      pal,
      face: i % 6,
      glow: 1.2 + 0.2 * Math.sin(t * 1.5 + i),
      t: t + i,
    });
  });
}

const px = (F: Frame, X: number) => (X - F.r.x) * F.ppm;
const py = (F: Frame, Y: number) => (Y - F.r.y) * F.ppm;

/** Periodic sum of sines (integer cycles over the period). */
function ridge(F: Frame, X: number, salt: number, scale: number): number {
  const u = (X - F.X0) / F.P;
  let v = 0;
  let a = 0.55;
  for (const len of [scale * 9, scale * 3.5, scale * 1.3]) {
    const k = Math.max(1, Math.round(F.P / len));
    v += a * Math.sin(u * TAU * k + hash01(F.seed + salt * 31 + k) * TAU);
    a *= 0.55;
  }
  return v;
}

/** Iterates world cells of ~step meters overlapping [from, to]; idx is periodic in room mode. */
function cells(
  F: Frame,
  step: number,
  from: number,
  to: number,
  cb: (idx: number, X: number, st: number) => void,
) {
  const n = Math.max(1, Math.round(F.P / step));
  const st = F.wrap ? F.P / n : step;
  const i0 = Math.floor((from - F.X0) / st) - 1;
  const i1 = Math.ceil((to - F.X0) / st) + 1;
  for (let i = i0; i <= i1; i++) cb(F.wrap ? mod(i, n) : i + 100000, F.X0 + i * st, st);
}

const h01 = (F: Frame, idx: number, salt: number) => hash01(F.seed * 7919 + idx * 104729 + salt * 1299709);

/** Position of a moving thing along the world: periodic in room mode, otherwise across the walls. */
function travel(F: Frame, u: number): number {
  return F.wrap ? F.X0 + mod(u, 1) * F.P : F.X0 - F.U * 0.6 + mod(u, 1) * (F.P + F.U * 1.2);
}

interface Static {
  layer: HTMLCanvasElement;
  manor: Manor | null;
  mx: number;
  my: number;
}

function paintStatic(s: DrawState, F: Frame, env: EnvPalette, o: PanoOpts): Static {
  return memo(s, 'panoStatic', () => {
    const { w, h } = s;
    const { c, g } = offscreen(w, h);
    const { r, U } = F;
    const left = r.x - U * 0.5;
    const right = r.x + r.w + U * 0.5;
    const lightDir = 1;
    const nearHouse = (X: number, k: number) =>
      (F.houseW > 0 && Math.abs(X - F.houseX) < F.houseW * k) ||
      F.pieces.some((p) => Math.abs(X - p.X) < PIECE_HALF[p.id] * U * (0.6 + k * 0.5));
    const centerHere = F.houseW > 0 && F.houseX + F.houseW > left && F.houseX - F.houseW < right;

    // --- far hills
    const hill = (baseY: number, amp: number, salt: number, scale: number, top: string, bot: string) => {
      const grad = g.createLinearGradient(0, py(F, baseY - amp), 0, h);
      grad.addColorStop(0, top);
      grad.addColorStop(1, bot);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, h);
      const n = Math.max(32, Math.round(w / 6));
      for (let i = 0; i <= n; i++) {
        const X = r.x + (r.w * i) / n;
        g.lineTo((w * i) / n, py(F, baseY - amp * (0.5 + 0.5 * ridge(F, X, salt, scale))));
      }
      g.lineTo(w, h);
      g.closePath();
      g.fill();
    };
    hill(F.hzY, U * 0.06, 1, U, mixHex(env.far, env.skyHorizon, 0.35), env.far);
    // distant tree line
    cells(F, U * 0.17, left, right, (idx, X) => {
      if (h01(F, idx, 1) < 0.45 || nearHouse(X, 0.4)) return;
      const th = U * (0.06 + 0.08 * h01(F, idx, 2));
      const base = F.hzY - U * 0.03 * (0.5 + 0.5 * ridge(F, X, 1, U));
      paintTree(
        g,
        idx + 300,
        px(F, X),
        py(F, base + U * 0.02),
        th * F.ppm,
        env,
        lightDir,
        mixHex(env.far, env.near, 0.25),
        0,
      );
    });
    hill(F.hzY + U * 0.08, U * 0.035, 2, U * 0.7, env.mid, mixHex(env.mid, env.near, 0.6));

    // --- the house (once, centered on the main wall)
    let manor: Manor | null = null;
    let mx = 0;
    let my = 0;
    if (o.house && F.houseX + F.houseW > left && F.houseX - F.houseW < right) {
      manor = buildManor(F.houseW * F.ppm, env, F.seed, lightDir);
      mx = px(F, F.houseX) - manor.ox;
      my = py(F, F.groundY) - manor.oy;
      g.fillStyle = env.mid;
      g.beginPath();
      g.ellipse(
        px(F, F.houseX),
        py(F, F.groundY + U * 0.02),
        F.houseW * 0.75 * F.ppm,
        U * 0.05 * F.ppm,
        0,
        Math.PI,
        0,
      );
      g.fill();
      g.drawImage(manor.canvas, mx, my);
    }

    // --- the spirit portal (Zauberwelt): a ring of carved stones standing on the lawn
    if (o.portal && centerHere) {
      const R = portalR(F) * F.ppm;
      const cx = px(F, F.houseX);
      const cy = py(F, portalY(F));
      const r0 = R * 1.05;
      const r1 = R * 1.3;
      g.fillStyle = env.mid;
      g.beginPath();
      g.ellipse(cx, py(F, F.groundY + U * 0.02), R * 1.9, U * 0.05 * F.ppm, 0, Math.PI, 0);
      g.fill();
      for (let k = 0; k < 3; k++) {
        const sw = R * (1.5 + k * 0.35);
        const sy = py(F, F.groundY) - R * 0.12 + k * R * 0.08;
        g.fillStyle = mixHex(mixHexHex(env.stoneLit, env.stone, 0.5 + k * 0.15), '#000000', 0.15 * k);
        g.fillRect(cx - sw / 2, sy, sw, R * 0.09);
      }
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * TAU + 0.012;
        const a1 = ((i + 1) / n) * TAU - 0.012;
        const am = (a0 + a1) / 2;
        const lit = 0.5 + 0.5 * Math.cos(am + Math.PI * 0.75);
        const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
        gr.addColorStop(0, mixHex(env.moss, env.stoneLit, 0.5));
        gr.addColorStop(0.18, mixHex(env.stoneLit, env.stone, 1 - lit * 0.6));
        gr.addColorStop(1, mixHex(env.stone, '#000000', 0.55));
        g.fillStyle = gr;
        g.beginPath();
        g.arc(cx, cy, r1, a0, a1);
        g.arc(cx, cy, r0, a1, a0, true);
        g.closePath();
        g.fill();
      }
    }

    // --- big trees between the set pieces
    cells(F, U * 1.1, left, right, (idx, X, st) => {
      if (h01(F, idx, 3) < 0.5 || nearHouse(X, 0.85)) return;
      const tx = X + st * (h01(F, idx, 4) - 0.5) * 0.5;
      paintTree(
        g,
        idx + 900,
        px(F, tx),
        py(F, F.groundY + U * 0.03),
        U * (0.45 + 0.25 * h01(F, idx, 5)) * F.ppm,
        env,
        lightDir,
      );
    });

    // --- lawn (world-continuous ground line)
    const lawn = g.createLinearGradient(0, py(F, F.groundY), 0, h);
    lawn.addColorStop(0, mixHex(env.grass, env.mid, 0.3));
    lawn.addColorStop(1, env.neon ? NEON_SEAM : env.near);
    g.fillStyle = lawn;
    g.beginPath();
    g.moveTo(0, h);
    const n = Math.max(24, Math.round(w / 10));
    for (let i = 0; i <= n; i++) {
      const X = r.x + (r.w * i) / n;
      g.lineTo((w * i) / n, py(F, F.groundY + U * 0.015 * ridge(F, X, 7, U * 0.6)));
    }
    g.lineTo(w, h);
    g.closePath();
    g.fill();

    // --- neon: glowing green vines along the ground (world-continuous)
    if (env.neon) {
      for (const k of [0, 1]) {
        const vy = (X: number) =>
          F.groundY + U * (0.045 + k * 0.05) + U * 0.02 * ridge(F, X, 30 + k, U * 0.5);
        const n2 = Math.max(24, Math.round(w / 8));
        g.lineCap = 'round';
        for (const [lw, col] of [
          [0.022, 'rgba(125,255,77,0.25)'],
          [0.008, '#7dff4d'],
        ] as const) {
          g.strokeStyle = col;
          g.lineWidth = Math.max(1, U * lw * F.ppm);
          g.beginPath();
          for (let i = 0; i <= n2; i++) {
            const X = r.x + (r.w * i) / n2;
            if (i === 0) g.moveTo(px(F, X), py(F, vy(X)));
            else g.lineTo(px(F, X), py(F, vy(X)));
          }
          g.stroke();
        }
        // curls
        cells(F, U * 0.35, left, right, (idx, X) => {
          if (h01(F, idx, 90 + k) > 0.6) return;
          const cx = px(F, X);
          const cy = py(F, vy(X));
          const rr = U * 0.025 * F.ppm;
          g.strokeStyle = '#9dff6a';
          g.lineWidth = Math.max(1, U * 0.005 * F.ppm);
          g.beginPath();
          g.arc(cx, cy - rr, rr, Math.PI / 2, Math.PI / 2 + Math.PI * 1.6);
          g.stroke();
          addGlow(g, cx, cy - rr, rr * 3, '#7dff4d', 0.25);
        });
      }
    }

    // --- graves in the lawn
    if (o.graves > 0) {
      const kinds: StoneKind[] = ['round', 'cross', 'square', 'round', 'obelisk'];
      cells(F, U * 0.32, left, right, (idx, X, st) => {
        if (h01(F, idx, 6) > 0.45 * o.graves || nearHouse(X, 0.95)) return;
        const row = h01(F, idx, 7);
        const gx = X + st * (h01(F, idx, 8) - 0.5) * 0.6;
        const gy = F.groundY + U * (0.035 + 0.06 * row);
        const sw = U * (0.06 + 0.04 * row) * F.ppm;
        paintTombstone(
          g,
          px(F, gx),
          py(F, gy),
          sw,
          kinds[idx % kinds.length]!,
          env,
          lightDir,
          idx,
          (h01(F, idx, 9) - 0.5) * 0.15,
        );
      });
    }

    // --- the centerpieces of the other walls (crypt, forest, scarecrow, cauldron …)
    for (const p of F.pieces) {
      const hw = PIECE_HALF[p.id] * U * 1.2;
      if (p.X + hw < left || p.X - hw > right) continue;
      paintPiece(g, p.id, {
        x: px(F, p.X),
        y: py(F, F.groundY),
        u: U * F.ppm,
        env,
        pal: palette(s.params),
        seed: F.seed + Math.round(p.X * 10),
      });
    }

    // --- path from the door to the viewer (continues on the floor in front of the house)
    if (centerHere) {
      const pathPoly = (y0: number, y1: number) => {
        const n = 24;
        const pts: [number, number][] = [];
        for (let i = 0; i <= n; i++) {
          const Y = y0 + ((y1 - y0) * i) / n;
          pts.push([px(F, F.houseX + pathHalf(F, Y)), py(F, Y)]);
        }
        for (let i = n; i >= 0; i--) {
          const Y = y0 + ((y1 - y0) * i) / n;
          pts.push([px(F, F.houseX - pathHalf(F, Y)), py(F, Y)]);
        }
        return pts;
      };
      const gy = py(F, F.groundY);
      const bottom = py(F, F.mainBottom);
      const pathG = g.createLinearGradient(0, gy, 0, bottom);
      const glowTint = o.portal ? palette(s.params).accent : env.stone;
      pathG.addColorStop(0, mixHex(mixHexHex(env.stone, glowTint, o.portal ? 0.35 : 0), env.mid, 0.4));
      pathG.addColorStop(1, mixHex(mixHexHex(env.stone, glowTint, o.portal ? 0.25 : 0), env.near, 0.5));
      g.fillStyle = pathG;
      g.beginPath();
      pathPoly(F.groundY, F.mainBottom).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fill();
    }

    // --- iron fence along the whole world (gate gap at the path)
    const fh = U * 0.07;
    const step = fh * 0.32;
    const bar = Math.max(1.5, fh * 0.06 * F.ppm);
    const fy = py(F, F.fenceY);
    const gate = F.houseW > 0 ? pathHalf(F, F.fenceY) + U * 0.04 : 0;
    const gateX = F.houseX;
    const inGate = (X: number) => F.houseW > 0 && Math.abs(X - gateX) < gate;
    g.fillStyle = env.iron;
    for (const yy of [0.82, 0.25]) {
      // rails, interrupted at the gate
      if (F.houseW > 0) {
        g.fillRect(0, fy - fh * yy * F.ppm, Math.max(0, px(F, gateX - gate)), bar);
        g.fillRect(px(F, gateX + gate), fy - fh * yy * F.ppm, w, bar);
      } else g.fillRect(0, fy - fh * yy * F.ppm, w, bar);
    }
    cells(F, step, left, right, (_idx, X) => {
      if (inGate(X)) return;
      const x = px(F, X);
      g.fillStyle = env.iron;
      g.fillRect(x - bar / 2, fy - fh * F.ppm, bar, fh * F.ppm);
      g.beginPath();
      g.moveTo(x, fy - fh * 1.16 * F.ppm);
      g.lineTo(x + bar * 1.6, fy - fh * 0.98 * F.ppm);
      g.lineTo(x, fy - fh * 0.94 * F.ppm);
      g.lineTo(x - bar * 1.6, fy - fh * 0.98 * F.ppm);
      g.closePath();
      g.fill();
    });

    // --- foreground grass + vignette at the bottom edge – only if no floor continues below
    if (!F.groundBelowSelf) {
      const gb = py(F, r.y + r.h) - 1;
      g.fillStyle = env.near;
      cells(F, U * 0.05, left, right, (idx, X) => {
        const bh = U * (0.02 + 0.03 * h01(F, idx, 11)) * F.ppm;
        const x = px(F, X);
        g.beginPath();
        g.moveTo(x - bh * 0.3, gb);
        g.quadraticCurveTo(x, gb - bh * 0.6, x + bh * (h01(F, idx, 12) - 0.5), gb - bh);
        g.quadraticCurveTo(x + bh * 0.05, gb - bh * 0.5, x + bh * 0.3, gb);
        g.fill();
      });
      const vig = g.createLinearGradient(0, h * 0.9, 0, h);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.5)');
      g.fillStyle = vig;
      g.fillRect(0, h * 0.9, w, h * 0.1);
    }
    return { layer: c, manor, mx, my };
  });
}

/** Fog in world coordinates: tiles of a periodic texture, offset by time. */
function worldFog(
  g: CanvasRenderingContext2D,
  F: Frame,
  env: EnvPalette,
  Y: number,
  bandU: number,
  t: number,
  alpha: number,
  salt: number,
  speed: number,
  color = env.fog,
) {
  for (let k = 0; k < 2; k++) {
    const tex = fogTexture(color, salt + k * 31);
    const want = F.U * (3 + k * 2);
    const tw = F.wrap ? F.P / Math.max(1, Math.round(F.P / want)) : want;
    const off = mod(t * speed * F.U * (0.05 + k * 0.035), tw);
    const bandH = F.U * bandU * (1 + k * 0.3);
    g.globalAlpha = alpha * (k === 0 ? 0.85 : 0.6);
    const startX = F.X0 + off + Math.floor((F.r.x - F.X0 - off) / tw) * tw - tw;
    for (let X = startX; X < F.r.x + F.r.w + tw; X += tw) {
      g.drawImage(tex, px(F, X), py(F, Y - bandH * (0.5 + k * 0.15)), tw * F.ppm + 1, bandH * F.ppm);
    }
  }
  g.globalAlpha = 1;
}

function panoDraw(o: PanoOpts) {
  return (g: CanvasRenderingContext2D, s: DrawState, f: { time: number }) => {
    const env = o.neon ? envPalette({ ...s.params, mood: 'neon' }) : envPalette(s.params);
    const pal: Palette = o.neon ? palette({ ...s.params, mood: 'neon' }) : palette(s.params);
    const F = frame(s, o);
    const t = f.time * speedOf(s);
    const d = densityOf(s);
    const { r, U } = F;
    const visible = (X: number, Y: number, rad: number) =>
      X + rad > r.x && X - rad < r.x + r.w && Y + rad > r.y && Y - rad < r.y + r.h;
    // copies of a periodic position that may be visible on this surface
    const copies = (X: number) => (F.wrap ? [X - F.P, X, X + F.P] : [X]);

    // bats behind everything
    const nb = Math.round((F.P / U) * 0.8 * o.bats * d);
    for (let i = 0; i < nb; i++) {
      const v = (0.01 + 0.015 * hash01(F.seed + i * 3)) * (i % 2 ? 1 : -1);
      const X0 = travel(F, hash01(i * 11 + F.seed) + (t * v * (U * 4)) / F.P);
      const Y = r.y + U * (0.1 + 0.3 * hash01(i * 7 + 3)) + Math.sin(t * 2 + i) * U * 0.03;
      for (const X of copies(X0))
        if (visible(X, Y, U * 0.1))
          bat(g, px(F, X), py(F, Y), U * 0.05 * F.ppm * (i % 3 === 0 ? 0.6 : 1), Math.sin(t * 14 + i), pal);
    }

    const st = paintStatic(s, F, env, o);
    g.drawImage(st.layer, 0, 0);
    for (const p of F.pieces) {
      const hw = PIECE_HALF[p.id] * U * 1.3;
      if (p.X + hw < r.x || p.X - hw > r.x + r.w) continue;
      drawPiece(
        g,
        p.id,
        { x: px(F, p.X), y: py(F, F.groundY), u: U * F.ppm, env, pal, seed: F.seed + Math.round(p.X * 10) },
        t,
      );
    }
    if (o.big && F.houseW) drawBigCast(g, F, pal, t, visible);

    if (o.portal) {
      const R = portalR(F);
      const cX = F.houseX;
      const cY = portalY(F);
      if (visible(cX, cY, R * 2)) {
        const cx = px(F, cX);
        const cy = py(F, cY);
        const Rp = R * F.ppm;
        // swirling light inside the ring
        g.save();
        g.beginPath();
        g.arc(cx, cy, Rp * 1.05, 0, TAU);
        g.clip();
        addGlow(g, cx, cy, Rp * 1.4, pal.accent, 0.8);
        for (let k = 0; k < 5; k++) {
          g.strokeStyle = [pal.accent, pal.secondary, pal.primary][k % 3]!;
          g.globalAlpha = 0.5;
          g.lineWidth = Rp * 0.06;
          g.beginPath();
          for (let j = 0; j <= 30; j++) {
            const u = j / 30;
            const a = t * 1.2 + k * (TAU / 5) + u * 4;
            const rr = Rp * (1 - u) * 1.05;
            const x = cx + Math.cos(a) * rr;
            const y = cy + Math.sin(a) * rr;
            if (j === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
        }
        g.restore();
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * TAU + Math.PI / 16;
          const glowA = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.5 - i * 0.8));
          const rx = cx + Math.cos(a) * Rp * 1.17;
          const ry = cy + Math.sin(a) * Rp * 1.17;
          addGlow(g, rx, ry, Rp * 0.08, pal.secondary, 0.6 * glowA);
          star(g, rx, ry, Rp * 0.035, '#ffffff', glowA);
        }
      }
      // spirits from all over the world spiral into the portal – across the seams
      const ns = Math.round((F.P / U) * 0.5 * d);
      for (let i = 0; i < ns; i++) {
        const period = 12 + hash01(i + F.seed) * 6;
        const age = mod(t / period + i / ns, 1);
        const startX = travel(F, hash01(i * 3 + F.seed));
        const startY = F.hzY - U * (0.15 + 0.3 * hash01(i * 5));
        const e = age * age;
        const spin = (1 - e) * 1.2;
        const X = startX + (cX - startX) * e + Math.cos(age * TAU * 2 + i) * U * 0.15 * spin;
        const Y = startY + (cY - startY) * e + Math.sin(age * TAU * 2 + i) * U * 0.08 * spin;
        const size = U * 0.16 * (0.35 + 0.65 * (1 - e));
        const alpha = Math.min(1, age * 6) * Math.min(1, (1 - age) * 5);
        for (const XX of copies(X)) {
          if (!visible(XX, Y, size)) continue;
          ghost(g, px(F, XX), py(F, Y), size * F.ppm, {
            color: pal.ghost,
            t: t + i,
            alpha: alpha * 0.9,
            face: FACES[i % 4],
            wave: Math.sin(t * 6 + i) * 0.6,
            mirror: XX < cX,
          });
        }
      }
      drawPathSparkles(g, F, t, pal.accent);
    }
    if (o.monsters) drawTracks(g, F, t, '#b6ff4d');

    // house: window light, peeking ghosts, lamps, door glow
    if (st.manor) {
      const M = st.manor;
      M.windows.forEach((win, i) => {
        if (!win.lit) return;
        const x = st.mx + win.x;
        const y = st.my + win.y;
        const flick = 0.7 + 0.3 * noise1(t * 2.2 + i * 7.3, F.seed);
        const breathe = 0.6 + 0.4 * smoothstep(0.2, 0.7, noise1(t * 0.12 + i * 3.1, F.seed + 9));
        addGlow(
          g,
          x + win.w / 2,
          y + win.h / 2,
          Math.max(win.w, win.h) * 1.4,
          env.winEdge,
          (env.neon ? 0.38 : 0.24) * flick * breathe,
        );
        addGlow(g, x + win.w / 2, y + win.h * 0.55, win.w * 0.7, env.winCore, 0.12 * flick * breathe);
        if (o.big && win.shape !== 'round' && hash01(i * 29 + F.seed) < 0.35) {
          // black cat silhouette sitting in the lit window
          g.save();
          winPath(g, x, y, win.w, win.h, win.shape);
          g.clip();
          g.translate(x + win.w / 2, y + win.h * 0.82);
          cat(g, Math.min(win.w, win.h) * 0.8, 0, false, t + i, pal);
          g.restore();
          return;
        }
        if (win.shape === 'round' || hash01(i * 13 + F.seed) > (o.monsters ? 0.75 : 0.4)) return;
        const period = 8 + hash01(F.seed + i * 31) * 10;
        const ph = mod(t / period + hash01(F.seed + i * 17), 1);
        const vis = smoothstep(0.1, 0.2, ph) * (1 - smoothstep(0.4, 0.5, ph));
        if (vis < 0.01) return;
        g.save();
        winPath(g, x, y, win.w, win.h, win.shape);
        g.clip();
        if (o.monsters)
          monster(
            g,
            i + F.seed,
            x + win.w / 2,
            y + win.h * (1.25 - 0.65 * vis),
            Math.min(win.w * 0.95, win.h),
            t,
            Math.sin(t * 5 + i),
          );
        else
          ghost(g, x + win.w / 2, y + win.h * (1.2 - 0.6 * vis), Math.min(win.w * 0.95, win.h * 1.2), {
            color: '#ffffff',
            t,
            face: FACES[i % FACES.length],
            wave: Math.sin(t * 6) * 0.6,
            glow: 0.3,
          });
        g.restore();
      });
      for (const l of M.lamps) {
        const fl = 0.85 + 0.15 * noise1(t * 3 + l.x, F.seed);
        addGlow(g, st.mx + l.x, st.my + l.y, F.houseW * F.ppm * 0.07, env.winCore, 0.7 * fl);
      }
      const doorX = st.mx + M.door.x + M.door.w / 2;
      lightPool(
        g,
        doorX,
        py(F, F.groundY + U * 0.02),
        M.door.w * 2.4,
        U * 0.03 * F.ppm,
        env.winEdge,
        0.45 + 0.1 * Math.sin(t * 1.7),
      );
    }
    if (o.pumpkins > 0)
      for (const p of pathPumpkins(F, d)) {
        if (!visible(p.X, p.Y, p.size)) continue;
        pumpkin(g, px(F, p.X), py(F, p.Y), p.size * F.ppm, { pal, face: p.face, t: t + p.face, glow: 0.9 });
      }

    // pumpkins along the fence, eyes in the bushes (world cells)
    if (o.pumpkins > 0) {
      cells(F, U * 0.55, r.x - U, r.x + r.w + U, (idx, X) => {
        if (h01(F, idx, 21) > 0.35 * o.pumpkins) return;
        if (F.houseW > 0 && Math.abs(X - F.houseX) < F.houseW * 0.9) return;
        const Y = F.fenceY + U * 0.03;
        if (!visible(X, Y, U * 0.1)) return;
        pumpkin(g, px(F, X), py(F, Y), U * 0.08 * F.ppm, { pal, face: idx % 6, t: t + idx, glow: 0.85 });
      });
    }
    cells(F, U * 0.7, r.x - U, r.x + r.w + U, (idx, X) => {
      if (h01(F, idx, 31) > 0.35) return;
      const Y = F.groundY + U * (0.0 + 0.03 * h01(F, idx, 32));
      const blinkPh = mod(t * (0.3 + 0.3 * h01(F, idx, 33)) + h01(F, idx, 34), 1);
      const open = blinkPh < 0.8 ? 1 : Math.abs(Math.cos(((blinkPh - 0.8) / 0.2) * Math.PI));
      const er = U * 0.007 * F.ppm;
      const col = idx % 2 ? '#fff066' : pal.secondary;
      addGlow(g, px(F, X), py(F, Y), er * 6, col, 0.25);
      g.fillStyle = col;
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.ellipse(px(F, X) + sd * er * 2.2, py(F, Y), er, er * open, 0, 0, TAU);
        g.fill();
      }
    });

    // party: string lights hung across the whole world + dancing skeletons on the lawn
    if (o.party) {
      const span = U * 1.6;
      cells(F, span, r.x - span, r.x + r.w + span, (idx, X, stp) => {
        for (const k of [0, 1]) {
          const y0 = r.y + U * (0.12 + k * 0.06);
          const sag = U * (0.08 + k * 0.03);
          g.strokeStyle = 'rgba(80,70,90,0.8)';
          g.lineWidth = Math.max(1, U * 0.004 * F.ppm);
          g.beginPath();
          for (let j = 0; j <= 16; j++) {
            const u = j / 16;
            const x = px(F, X + u * stp);
            const y = py(F, y0 + Math.sin(u * Math.PI) * sag);
            if (j === 0) g.moveTo(x, y);
            else g.lineTo(x, y);
          }
          g.stroke();
          const nb2 = 7;
          for (let j = 0; j < nb2; j++) {
            const u = (j + 0.5) / nb2;
            const x = px(F, X + u * stp);
            const y = py(F, y0 + Math.sin(u * Math.PI) * sag + U * 0.012);
            const c = pal.party[(idx * 3 + j + k) % pal.party.length]!;
            const tw = 0.55 + 0.45 * Math.sin(t * 1.5 + j * 0.9 + k + idx);
            addGlow(g, x, y, U * 0.035 * F.ppm, c, 0.55 * tw);
            g.fillStyle = c;
            g.beginPath();
            g.ellipse(x, y, U * 0.006 * F.ppm, U * 0.009 * F.ppm, 0, 0, TAU);
            g.fill();
          }
        }
      });
      const beat = (t * 108) / 60;
      cells(F, U * 0.5, r.x - U, r.x + r.w + U, (idx, X) => {
        if (o.mainPiece || h01(F, idx, 41) > 0.5) return;
        const size = U * 0.42;
        const Y = F.groundY + U * 0.09;
        if (!visible(X, Y - size / 2, size)) return;
        const style = (idx + Math.floor(beat / 8)) % 4;
        skeleton(
          g,
          px(F, X),
          py(F, Y - size / 2),
          size * F.ppm,
          dancePose(beat + (idx % 2) * 0.5, style),
          pal.ghost,
          pal.party[idx % pal.party.length],
        );
      });
    }

    // fog drifting across all walls
    if (env.neon) {
      // glowing neon veils over the ground: green and magenta
      worldFog(g, F, env, F.groundY + U * 0.02, 0.16, t, 0.35, F.seed + 3, 0.6, '#7dff4d');
      worldFog(g, F, env, F.groundY - U * 0.04, 0.2, t + 20, 0.4, F.seed + 5, 0.4, '#d04dff');
      worldFog(g, F, env, r.y + U * 0.97, 0.1, t + 40, 0.35, F.seed + 7, 1, '#ff8a2e');
    } else {
      worldFog(g, F, env, F.groundY + U * 0.01, 0.1, t, 0.28, F.seed + 3, 0.6);
      worldFog(g, F, env, r.y + U * 0.97, 0.08, t + 40, 0.15, F.seed + 7, 1);
    }

    // free-flying ghosts – they cross from one wall onto the next
    const ng = Math.round((F.P / U) * 0.22 * o.ghosts * d);
    for (let i = 0; i < ng; i++) {
      const dir = hash01(i * 5 + F.seed) > 0.5 ? 1 : -1;
      const v = (dir * (0.012 + 0.012 * hash01(i * 9 + F.seed)) * (U * 4)) / F.P;
      const X0 = travel(F, hash01(i * 3 + F.seed) + t * v);
      const size = U * (0.16 + 0.12 * hash01(i * 13));
      const Y = F.hzY - U * (0.2 + 0.25 * hash01(i * 17)) + Math.sin(t * (0.8 + hash01(i)) + i) * U * 0.04;
      for (const X of copies(X0)) {
        if (!visible(X, Y, size)) continue;
        if (env.neon)
          neonGhost(
            g,
            px(F, X),
            py(F, Y),
            size * F.ppm,
            t + i,
            FACES[(i + Math.floor(t / 5)) % FACES.length]!,
            dir < 0,
          );
        else
          ghost(g, px(F, X), py(F, Y), size * F.ppm, {
            color: pal.ghost,
            t: t + i,
            alpha: 0.85,
            face: FACES[(i + Math.floor(t / 5)) % FACES.length],
            wave: Math.sin(t * 5 + i) * 0.7,
            mirror: dir < 0,
          });
      }
    }
  };
}

export function panoramaScene(id: string, o: PanoOpts): SceneModule {
  return hybridScene(
    id,
    SKY_FRAG,
    (s) => {
      const env = o.neon ? envPalette({ ...s.params, mood: 'neon' }) : envPalette(s.params);
      return skyUniforms(
        s,
        env,
        { moon: [0.8, 0.2], moonR: env.neon ? 0.12 : 0.075, horizonY: 0.25, clouds: 0.9 },
        speedOf(s),
      );
    },
    panoDraw(o),
    { ambientSound: (snd) => snd.ambience('wind', 0.035), shaderScale: 0.5 },
  );
}

export const panoramaScenes: SceneModule[] = [
  panoramaScene('magicPanorama', {
    sides: ['cauldron', 'forest', 'pumpkinPatch'],
    house: false,
    portal: true,
    graves: 0.5,
    ghosts: 0.3,
    bats: 0.6,
    pumpkins: 1,
    party: false,
  }),
  panoramaScene('monsterPanorama', {
    sides: ['monsterGraves', 'forest', 'cauldron'],
    house: true,
    monsters: true,
    graves: 0.9,
    ghosts: 0.4,
    bats: 1,
    pumpkins: 0.8,
    party: false,
  }),
  panoramaScene('spookPanorama', {
    sides: ['graveyard', 'forest', 'pumpkinPatch'],
    house: true,
    graves: 1,
    ghosts: 1,
    bats: 1,
    pumpkins: 1,
    party: false,
  }),
  panoramaScene('partyPanorama', {
    mainPiece: 'stage',
    sides: ['bonfire', 'pumpkinPatch', 'cauldron'],
    house: false,
    graves: 0,
    ghosts: 0.8,
    bats: 0.6,
    pumpkins: 1.2,
    party: true,
  }),
  panoramaScene('quietPanorama', {
    mainPiece: 'crypt',
    sides: ['forest', 'graveyard', 'forest'],
    house: false,
    graves: 1.6,
    ghosts: 0.5,
    bats: 0.4,
    pumpkins: 0,
    party: false,
  }),
  panoramaScene('neonPanorama', {
    big: true,
    sides: ['pumpkinPatch', 'stage', 'graveyard'],
    house: true,
    graves: 0.6,
    ghosts: 1.4,
    bats: 1,
    pumpkins: 1.8,
    party: false,
    neon: true,
  }),
];

/**
 * The ground of a panorama world: the floor in front of the walls, seen from above. It continues
 * what the wall shows at its bottom edge – the garden path with its jack-o'-lanterns, dark lawn,
 * a thin haze. Kept deliberately sparse: one web, a couple of spiders.
 */
export function groundScene(id: string, o: PanoOpts): SceneModule {
  return canvasScene(id, (g, s, f) => {
    const env = o.neon ? envPalette({ ...s.params, mood: 'neon' }) : envPalette(s.params);
    const pal: Palette = o.neon ? palette({ ...s.params, mood: 'neon' }) : palette(s.params);
    const F = frame(s, o);
    const t = f.time * speedOf(s);
    const d = densityOf(s);
    const { r, U } = F;
    const front =
      F.frontGround && Math.abs(F.frontGround.x - r.x) < 1e-6 && Math.abs(F.frontGround.y - r.y) < 1e-6;
    const st = memo(s, 'groundStatic', () => {
      const { c, g: q } = offscreen(s.w, s.h);
      // dark lawn continuing the wall's bottom color, fading into the night
      const base = q.createLinearGradient(0, 0, 0, s.h);
      base.addColorStop(0, env.near);
      base.addColorStop(1, mixHex(env.near, '#000000', 0.6));
      q.fillStyle = base;
      q.fillRect(0, 0, s.w, s.h);
      // the path, continued from the wall at exactly the same width
      if (front && F.houseW) {
        const y0 = r.y;
        const y1 = r.y + r.h;
        q.fillStyle = mixHex(
          mixHexHex(env.stone, o.portal ? pal.accent : env.stone, o.portal ? 0.25 : 0),
          env.near,
          0.5,
        );
        q.beginPath();
        const n = 16;
        for (let i = 0; i <= n; i++) {
          const Y = y0 + ((y1 - y0) * i) / n;
          q.lineTo(px(F, F.houseX + pathHalf(F, Y)), py(F, Y));
        }
        for (let i = n; i >= 0; i--) {
          const Y = y0 + ((y1 - y0) * i) / n;
          q.lineTo(px(F, F.houseX - pathHalf(F, Y)), py(F, Y));
        }
        q.closePath();
        q.fill();
        // flagstone joints
        q.fillStyle = 'rgba(0,0,0,0.35)';
        for (let Y = r.y + 0.35; Y < y1; Y += 0.35) {
          const hw = pathHalf(F, Y);
          q.fillRect(px(F, F.houseX - hw), py(F, Y), hw * 2 * F.ppm, Math.max(1, 0.015 * F.ppm));
          const off = (Math.round(Y / 0.35) % 2 ? 0.25 : -0.2) * hw;
          q.fillRect(px(F, F.houseX + off), py(F, Y), Math.max(1, 0.015 * F.ppm), 0.35 * F.ppm);
        }
      }
      // sparse grass tufts on the lawn
      q.fillStyle = mixHex(env.near, env.treeRim, 0.15);
      cells(F, 0.3, r.x - 0.3, r.x + r.w + 0.3, (idx, X) => {
        for (let k = 0; k < 3; k++) {
          if (h01(F, idx, 50 + k) > 0.35) continue;
          const Y = r.y + r.h * h01(F, idx, 60 + k);
          if (front && F.houseW && Math.abs(X - F.houseX) < pathHalf(F, Y) + 0.15) continue;
          const bh = (0.04 + 0.05 * h01(F, idx, 70 + k)) * F.ppm;
          const x = px(F, X);
          const y = py(F, Y);
          q.beginPath();
          q.moveTo(x - bh * 0.3, y);
          q.quadraticCurveTo(x, y - bh * 0.6, x + bh * (h01(F, idx, 80 + k) - 0.5), y - bh);
          q.quadraticCurveTo(x + bh * 0.05, y - bh * 0.5, x + bh * 0.3, y);
          q.fill();
        }
      });
      // one web in the corner away from the path
      const m = Math.min(s.w, s.h);
      const rightCorner = !front || F.houseX < r.x + r.w / 2;
      web(
        q,
        rightCorner ? s.w : 0,
        s.h,
        m * 0.3,
        rightCorner ? Math.PI : Math.PI * 1.5,
        rightCorner ? Math.PI * 1.5 : Math.PI * 2,
        pal.ghost,
      );
      return c;
    });
    g.drawImage(st, 0, 0);

    // jack-o'-lanterns continuing along the path + their light on the stones
    if (o.pumpkins > 0)
      for (const p of pathPumpkins(F, d)) {
        if (p.Y < r.y - p.size || p.Y > r.y + r.h + p.size) continue;
        if (p.X < r.x - p.size || p.X > r.x + r.w + p.size) continue;
        lightPool(g, px(F, p.X), py(F, p.Y), p.size * 2.2 * F.ppm, p.size * 1.6 * F.ppm, env.winEdge, 0.22);
        pumpkin(g, px(F, p.X), py(F, p.Y), p.size * F.ppm, { pal, face: p.face, t: t + p.face, glow: 0.9 });
      }

    if (o.party) {
      // disco reflections sweeping over the ground + confetti
      for (let i = 0; i < 9; i++) {
        const X = r.x + r.w * (0.5 + 0.42 * Math.sin(t * (0.3 + 0.07 * i) + i * 1.3));
        const Y = r.y + r.h * (0.5 + 0.42 * Math.cos(t * (0.25 + 0.05 * i) + i * 2.1));
        addGlow(g, px(F, X), py(F, Y), 0.35 * F.ppm, pal.party[i % pal.party.length]!, 0.45);
      }
      for (let i = 0; i < 24; i++) {
        const X = r.x + r.w * hash01(i * 7 + F.seed);
        const Y = r.y + r.h * hash01(i * 13 + F.seed);
        g.fillStyle = pal.party[i % pal.party.length]!;
        g.save();
        g.translate(px(F, X), py(F, Y));
        g.rotate(i + t * 0.2);
        g.fillRect(-0.02 * F.ppm, -0.01 * F.ppm, 0.04 * F.ppm, 0.02 * F.ppm);
        g.restore();
      }
    }
    if (o.portal) drawPathSparkles(g, F, t, pal.accent);
    if (o.monsters) drawTracks(g, F, t, '#b6ff4d');

    // thin haze drifting over the ground (world coordinates, very light)
    worldFog(g, F, env, r.y + r.h * 0.35, (r.h / U) * 0.5, t, 0.12, F.seed + 11, 0.4);

    // two spiders wandering slowly, never over the path
    for (let i = 0; i < 2; i++) {
      const u = t * 0.02 + i * 0.5;
      const X = r.x + r.w * (0.1 + 0.8 * noise1(u, F.seed + i * 7));
      const Y = r.y + r.h * (0.15 + 0.7 * noise1(u + 13, F.seed + i * 7 + 3));
      if (front && F.houseW && Math.abs(X - F.houseX) < pathHalf(F, Y) + 0.2) continue;
      const X2 = r.x + r.w * (0.1 + 0.8 * noise1(u + 0.01, F.seed + i * 7));
      const Y2 = r.y + r.h * (0.15 + 0.7 * noise1(u + 13.01, F.seed + i * 7 + 3));
      g.save();
      g.translate(px(F, X), py(F, Y));
      g.rotate(Math.atan2(Y2 - Y, X2 - X));
      fuzzySpider(g, U * 0.1 * F.ppm, t * 6 + i, 0.6, pal.rim, '#ffe14d', i);
      g.restore();
    }
  });
}

/**
 * Neon ground (reference picture): glowing purple/green billows, green paw-print trails coming
 * out of the house door and across the floor, leaves, little ghosts and fuzzy spiders. The top
 * edge continues the purple glow at the bottom of the wall.
 */
export const neonGround: SceneModule = hybridScene(
  'neonGround',
  FOG_FRAG,
  (s) => neonUniforms({ ...s, params: { ...s.params, mood: 'neon' } }),
  (g, s, f) => {
    const pal = palette({ ...s.params, mood: 'neon' });
    const F = frame(s, { house: true, graves: 0, ghosts: 0, bats: 0, pumpkins: 0, party: false, neon: true });
    const t = f.time * speedOf(s);
    const { r } = F;
    const top = g.createLinearGradient(0, 0, 0, s.h * 0.12);
    top.addColorStop(0, NEON_SEAM);
    top.addColorStop(1, 'rgba(58,20,104,0)');
    g.fillStyle = top;
    g.fillRect(0, 0, s.w, s.h * 0.12);
    // drifting neon veils over the floor: green and orange patches like in the reference
    for (let i = 0; i < 5; i++) {
      const X = r.x + r.w * (0.5 + 0.45 * Math.sin(t * (0.04 + 0.01 * i) + i * 2.3));
      const Y = r.y + r.h * (0.5 + 0.45 * Math.cos(t * (0.035 + 0.008 * i) + i * 1.7));
      glowEllipse(
        g,
        px(F, X),
        py(F, Y),
        r.w * 0.22 * F.ppm,
        r.h * 0.12 * F.ppm,
        i % 2 ? '#ff8a2e' : '#5dff6a',
        0.22,
      );
    }
    // paw-print trails from the door across the floor (world meters)
    const end = r.y + r.h;
    for (let k = 0; k < 2; k++) {
      const prog = mod(t / 14 + k * 0.5, 1) * 1.4;
      const steps = 16;
      for (let j = 0; j < steps; j++) {
        const u = j / steps;
        const age = prog - u;
        if (age < 0 || age > 0.6) continue;
        const a = Math.min(1, age * 8) * Math.min(1, (0.6 - age) * 4);
        const Y = F.mainBottom + u * (end - F.mainBottom);
        const X =
          F.houseX +
          Math.sin(u * 3 + k * 2) * Math.min(r.w * 0.3, 1.2) * (k ? 1 : -1) +
          (j % 2 ? 0.07 : -0.07);
        if (X < r.x || X > r.x + r.w) continue;
        pawPrint(g, px(F, X), py(F, Y), 0.16 * F.ppm, Math.PI, LIME, a);
      }
    }
    // drifting leaves
    for (let i = 0; i < 10; i++) {
      const X = r.x + mod(hash01(i * 7) + t * (0.01 + hash01(i * 5) * 0.015), 1) * r.w;
      const Y = r.y + (hash01(i * 9) + 0.04 * Math.sin(t * 0.5 + i)) * r.h;
      leaf(
        g,
        px(F, X),
        py(F, Y),
        0.18 * F.ppm,
        t * (0.4 + hash01(i) * 0.6) + i,
        i % 3 === 0 ? '#ffb13b' : pal.primary,
        0.9,
      );
    }
    // two little ghosts gliding, two fuzzy spiders wandering
    for (let i = 0; i < 2; i++) {
      const u = mod(t / (12 + i * 3) + i * 0.37, 1);
      const X = r.x + r.w * (0.2 + 0.6 * noise1(t * 0.05 + i * 9, F.seed));
      const Y = r.y + r.h * (0.25 + 0.5 * noise1(t * 0.05 + i * 9 + 40, F.seed)) - u * 0.2;
      g.save();
      g.globalAlpha = Math.sin(u * Math.PI);
      neonGhost(g, px(F, X), py(F, Y), 0.5 * F.ppm, t + i, FACES[i]!, i % 2 === 0);
      g.restore();
      const sx = r.x + r.w * (0.1 + 0.8 * noise1(t * 0.03 + i * 10, F.seed + 5));
      const sy = r.y + r.h * (0.15 + 0.75 * noise1(t * 0.03 + i * 10 + 50, F.seed + 6));
      const sx2 = r.x + r.w * (0.1 + 0.8 * noise1(t * 0.03 + i * 10 + 0.05, F.seed + 5));
      const sy2 = r.y + r.h * (0.15 + 0.75 * noise1(t * 0.03 + i * 10 + 50.05, F.seed + 6));
      g.save();
      g.translate(px(F, sx), py(F, sy));
      g.rotate(Math.atan2(sy2 - sy, sx2 - sx));
      fuzzySpider(g, 0.5 * F.ppm, t * 5 + i * 3, 0.25, pal.rim, '#ffe14d', i);
      g.restore();
    }
  },
  { shaderScale: 0.5 },
);

export const groundScenes: SceneModule[] = [
  neonGround,
  groundScene('magicGround', {
    house: false,
    portal: true,
    graves: 0,
    ghosts: 0,
    bats: 0,
    pumpkins: 1,
    party: false,
  }),
  groundScene('monsterGround', {
    house: true,
    monsters: true,
    graves: 0,
    ghosts: 0,
    bats: 0,
    pumpkins: 0.6,
    party: false,
  }),
  groundScene('spookGround', { house: true, graves: 0, ghosts: 0, bats: 0, pumpkins: 1, party: false }),
  groundScene('partyGround', { house: false, graves: 0, ghosts: 0, bats: 0, pumpkins: 0, party: true }),
  groundScene('quietGround', { house: false, graves: 0, ghosts: 0, bats: 0, pumpkins: 0, party: false }),
];
