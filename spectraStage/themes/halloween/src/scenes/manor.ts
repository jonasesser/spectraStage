/**
 * Shared "haunted manor on the hill" composition used by hauntedHouse and neonManor.
 * The whole static illustration (hills, trees, mansion, fence, path, foreground) is painted once
 * per size/mood into a cached layer; per frame only lights, fog and creatures are drawn.
 */
import { createRng } from '@spectrastage/shared';
import { hash01, memo, noise1, smoothstep, type DrawState } from '@spectrastage/engine';
import { ghost, type GhostFace } from '../shapes.ts';
import {
  addGlow,
  buildManor,
  drawFogBand,
  lightPool,
  mixHex,
  offscreen,
  paintFence,
  paintGrass,
  paintHills,
  paintTree,
  winPath,
  type EnvPalette,
  type Manor,
} from './env.ts';
import { mod } from './common.ts';

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];

export interface ManorLayout {
  layer: HTMLCanvasElement;
  manor: Manor;
  /** Manor canvas offset in surface coordinates. */
  mx: number;
  my: number;
  groundY: number;
  frontY: number;
  W: number;
  doorX: number;
}

export const MOON_POS: [number, number] = [0.8, 0.2];

export function manorLayout(s: DrawState, env: EnvPalette): ManorLayout {
  return memo(s, 'manorLayout', () => {
    const { w, h } = s;
    const m = Math.min(w, h);
    const lightDir = MOON_POS[0] > 0.5 ? 1 : -1;
    const { c, g } = offscreen(w, h);
    const groundY = h * 0.8;
    const frontY = h * 0.9;
    const W = Math.min(w * 0.56, h * 0.66);
    const cx = w * 0.5;

    // far hills + distant tree line (atmospheric perspective)
    paintHills(g, w, h * 0.7, h * 0.05, h, mixHex(env.far, env.skyHorizon, 0.35), env.far, s.seed + 1, 2.2);
    const rng = createRng(s.seed ^ 0x7ee5);
    const nFar = Math.round(w / (m * 0.05));
    for (let i = 0; i < nFar; i++) {
      const x = rng() * w;
      if (Math.abs(x - cx) < W * 0.35) continue;
      paintTree(
        g,
        s.seed + 100 + i,
        x,
        h * (0.7 + rng() * 0.03),
        m * (0.06 + rng() * 0.07),
        env,
        lightDir,
        mixHex(env.far, env.near, 0.25),
        0,
      );
    }
    paintHills(g, w, h * 0.77, h * 0.035, h, env.mid, mixHex(env.mid, env.near, 0.6), s.seed + 2, 1.4);

    // mansion on its hill
    const manor = buildManor(W, env, s.seed, lightDir);
    const mx = cx - manor.ox;
    const my = groundY - manor.oy;
    // hill under the house
    g.fillStyle = env.mid;
    g.beginPath();
    g.ellipse(cx, groundY + h * 0.02, W * 0.75, h * 0.05, 0, Math.PI, 0);
    g.fill();
    g.drawImage(manor.canvas, mx, my);

    // side trees (mid-ground, big)
    if (w > W * 1.35) {
      const side = (w - W) / 2;
      paintTree(
        g,
        s.seed + 11,
        side * 0.38,
        groundY + h * 0.03,
        Math.min(h * 0.72, side * 2.2),
        env,
        lightDir,
      );
      paintTree(
        g,
        s.seed + 12,
        w - side * 0.32,
        groundY + h * 0.04,
        Math.min(h * 0.62, side * 1.9),
        env,
        lightDir,
      );
    }

    // front lawn
    const lawn = g.createLinearGradient(0, groundY, 0, h);
    lawn.addColorStop(0, mixHex(env.grass, env.mid, 0.3));
    lawn.addColorStop(1, env.near);
    g.fillStyle = lawn;
    g.beginPath();
    g.moveTo(0, groundY + h * 0.02);
    g.quadraticCurveTo(w * 0.5, groundY - h * 0.005, w, groundY + h * 0.02);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
    // stone path from the door to the viewer
    const doorX = mx + manor.door.x + manor.door.w / 2;
    const dw = manor.door.w;
    const pathG = g.createLinearGradient(0, groundY, 0, h);
    pathG.addColorStop(0, mixHex(env.stone, env.mid, 0.4));
    pathG.addColorStop(1, mixHex(env.stone, env.near, 0.5));
    g.fillStyle = pathG;
    g.beginPath();
    g.moveTo(doorX - dw * 0.7, groundY);
    g.lineTo(doorX + dw * 0.7, groundY);
    g.quadraticCurveTo(doorX + dw * 1.6, h * 0.92, doorX + dw * 3.2, h);
    g.lineTo(doorX - dw * 3.2, h);
    g.quadraticCurveTo(doorX - dw * 1.6, h * 0.92, doorX - dw * 0.7, groundY);
    g.closePath();
    g.fill();
    // flagstone joints
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 0; r < 7; r++) {
      const v = r / 7;
      const y = groundY + (h - groundY) * v * v + h * 0.008;
      const hw = dw * (0.7 + 2.5 * v * v);
      g.fillRect(doorX - hw, y, hw * 2, Math.max(1, h * 0.003 * (1 + v * 2)));
    }
    // fence with gate gap in front
    const fh = Math.min(h * 0.07, m * 0.08);
    paintFence(g, w * 0.02, doorX - dw * 2.4, frontY, fh, env, lightDir);
    paintFence(g, doorX + dw * 2.4, w * 0.98, frontY, fh, env, lightDir);
    // foreground grass
    paintGrass(g, w, h * 0.985, m * 0.035, env.near, mixHex(env.near, env.treeRim, 0.25), s.seed + 5, 1);
    // dark vignette at the bottom
    const vig = g.createLinearGradient(0, h * 0.9, 0, h);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vig;
    g.fillRect(0, h * 0.9, w, h * 0.1);
    return { layer: c, manor, mx, my, groundY, frontY, W, doorX };
  });
}

/** Draws the cached manor scene plus animated window light, window ghosts and ground fog. */
export function drawManor(
  g: CanvasRenderingContext2D,
  s: DrawState,
  env: EnvPalette,
  t: number,
  opts: { fog?: number; ghosts?: boolean } = {},
): ManorLayout {
  const L = manorLayout(s, env);
  const { w, h } = s;
  g.drawImage(L.layer, 0, 0);
  // window light: flicker and slow on/off, light spill
  L.manor.windows.forEach((win, i) => {
    if (!win.lit) return;
    const x = L.mx + win.x;
    const y = L.my + win.y;
    const flick = 0.7 + 0.3 * noise1(t * 2.2 + i * 7.3, s.seed);
    const breathe = 0.6 + 0.4 * smoothstep(0.2, 0.7, noise1(t * 0.12 + i * 3.1, s.seed + 9));
    addGlow(
      g,
      x + win.w / 2,
      y + win.h / 2,
      Math.max(win.w, win.h) * 1.4,
      env.winEdge,
      (env.neon ? 0.38 : 0.24) * flick * breathe,
    );
    addGlow(g, x + win.w / 2, y + win.h * 0.55, win.w * 0.7, env.winCore, 0.12 * flick * breathe);
    // ghost peeking from time to time
    if (opts.ghosts === false || win.shape === 'round') return;
    const period = 8 + hash01(s.seed + i * 31) * 10;
    const ph = mod(t / period + hash01(s.seed + i * 17), 1);
    const vis = smoothstep(0.1, 0.2, ph) * (1 - smoothstep(0.4, 0.5, ph));
    if (vis < 0.01 || hash01(i * 13 + s.seed) > 0.4) return;
    g.save();
    winPath(g, x, y, win.w, win.h, win.shape);
    g.clip();
    ghost(g, x + win.w / 2, y + win.h * (1.2 - 0.6 * vis), Math.min(win.w * 0.95, win.h * 1.2), {
      color: '#ffffff',
      t,
      face: FACES[i % FACES.length],
      wave: Math.sin(t * 6) * 0.6,
      glow: 0.3,
    });
    g.restore();
  });
  // porch lamps + door glow
  for (const l of L.manor.lamps) {
    const fl = 0.85 + 0.15 * noise1(t * 3 + l.x, s.seed);
    addGlow(g, L.mx + l.x, L.my + l.y, L.W * 0.07, env.winCore, 0.7 * fl);
    lightPool(g, L.mx + l.x, L.groundY, L.W * 0.08, L.W * 0.02, env.winEdge, 0.35 * fl);
  }
  const d = L.manor.door;
  lightPool(
    g,
    L.doorX,
    L.groundY + h * 0.02,
    d.w * 2.4,
    h * 0.03,
    env.winEdge,
    0.45 + 0.1 * Math.sin(t * 1.7),
  );
  // fog drifting in front of the house and across the lawn
  const fog = opts.fog ?? 1;
  if (fog > 0) {
    drawFogBand(g, w, L.groundY + h * 0.01, h * 0.12, env.fog, t, 0.45 * fog, s.seed + 3, 0.6);
    drawFogBand(g, w, h * 0.95, h * 0.12, env.fog, t + 40, 0.35 * fog, s.seed + 7, 1);
  }
  return L;
}

/** Glowing eyes blinking in the bushes along the ground. */
export function drawEyes(
  g: CanvasRenderingContext2D,
  s: DrawState,
  t: number,
  y0: number,
  y1: number,
  n: number,
  colors: string[],
): void {
  const m = Math.min(s.w, s.h);
  for (let i = 0; i < n; i++) {
    const ex = s.w * hash01(s.seed * 7 + i * 13);
    const ey = y0 + (y1 - y0) * hash01(s.seed + i * 5);
    const blinkPh = mod(t * (0.3 + 0.3 * hash01(i + 99)) + hash01(i), 1);
    const open = blinkPh < 0.8 ? 1 : Math.abs(Math.cos(((blinkPh - 0.8) / 0.2) * Math.PI));
    const er = m * 0.007;
    const col = colors[i % colors.length] as string;
    addGlow(g, ex, ey, er * 6, col, 0.25);
    g.fillStyle = col;
    for (const sd of [-1, 1]) {
      g.beginPath();
      g.ellipse(ex + sd * er * 2.2, ey, er, er * open, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export interface BackdropOpts {
  /** Horizon (top of far hills) as fraction of h. */
  horizon?: number;
  /** Ground line (fraction of h). */
  ground?: number;
  /** Small distant manor: x fraction and width fraction of min(w,h). */
  manor?: [number, number];
  /** Big framing trees at the edges. */
  trees?: boolean;
  /** Distant tree line. */
  farTrees?: boolean;
  lightDir?: number;
  fence?: boolean;
}

/** Generic cached night landscape (far hills, tree line, optional distant manor, framing trees, lawn). */
export function backdrop(s: DrawState, env: EnvPalette, o: BackdropOpts = {}): HTMLCanvasElement {
  return memo(s, `backdrop:${JSON.stringify(o)}`, () => {
    const { w, h } = s;
    const m = Math.min(w, h);
    const hz = h * (o.horizon ?? 0.68);
    const gy = h * (o.ground ?? 0.86);
    const ld = o.lightDir ?? 1;
    const { c, g } = offscreen(w, h);
    paintHills(g, w, hz, h * 0.05, h, mixHex(env.far, env.skyHorizon, 0.35), env.far, s.seed + 31, 2);
    const rng = createRng(s.seed ^ 0x51a7);
    if (o.farTrees !== false) {
      for (let i = 0; i < Math.round(w / (m * 0.05)); i++) {
        const x = rng() * w;
        paintTree(
          g,
          s.seed + 500 + i,
          x,
          hz + h * (0.01 + rng() * 0.04),
          m * (0.05 + rng() * 0.07),
          env,
          ld,
          mixHex(env.far, env.near, 0.25),
          0,
        );
      }
    }
    if (o.manor) {
      const W = m * o.manor[1];
      const man = buildManor(W, env, s.seed + 9, ld);
      const cx = w * o.manor[0];
      const by = hz + h * 0.04;
      g.fillStyle = env.mid;
      g.beginPath();
      g.ellipse(cx, by + h * 0.01, W * 0.9, h * 0.03, 0, Math.PI, 0);
      g.fill();
      g.drawImage(man.canvas, cx - man.ox, by - man.oy);
      for (const win of man.windows)
        if (win.lit)
          addGlow(
            g,
            cx - man.ox + win.x + win.w / 2,
            by - man.oy + win.y + win.h / 2,
            win.w * 1.5,
            env.winEdge,
            0.3,
          );
    }
    paintHills(g, w, (hz + gy) / 2, h * 0.025, h, env.mid, mixHex(env.mid, env.near, 0.5), s.seed + 32, 1.3);
    if (o.trees !== false) {
      paintTree(g, s.seed + 41, w * 0.06, gy + h * 0.02, Math.min(h * 0.75, w * 0.35), env, ld);
      paintTree(g, s.seed + 42, w * 0.95, gy + h * 0.03, Math.min(h * 0.65, w * 0.3), env, ld);
    }
    if (o.fence) paintFence(g, -m * 0.02, w * 1.02, gy, m * 0.08, env, ld);
    const lawn = g.createLinearGradient(0, gy, 0, h);
    lawn.addColorStop(0, mixHex(env.grass, env.mid, 0.3));
    lawn.addColorStop(1, env.near);
    g.fillStyle = lawn;
    g.beginPath();
    g.moveTo(0, gy + h * 0.015);
    g.quadraticCurveTo(w * 0.5, gy - h * 0.01, w, gy + h * 0.015);
    g.lineTo(w, h);
    g.lineTo(0, h);
    g.closePath();
    g.fill();
    paintGrass(g, w, h * 0.99, m * 0.03, env.near, mixHex(env.near, env.treeRim, 0.25), s.seed + 33, 0.8);
    return c;
  });
}
