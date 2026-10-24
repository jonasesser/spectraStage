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
import { hash01, hybridScene, memo, noise1, smoothstep, TAU } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { palette, type Palette } from '../palette.ts';
import { bat, dancePose, ghost, pumpkin, skeleton, type GhostFace } from '../shapes.ts';
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
      houseW: o.house ? Math.min(main.w * 0.56, U * 0.66) : 0,
      seed: (w?.seed ?? s.seed) & 0xffff,
    };
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
    const nearHouse = (X: number, k: number) => o.house && Math.abs(X - F.houseX) < F.houseW * k;

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
    lawn.addColorStop(1, env.near);
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

    // --- path from the door to the viewer
    if (manor) {
      const doorX = mx + manor.door.x + manor.door.w / 2;
      const dw = manor.door.w;
      const gy = py(F, F.groundY);
      const bottom = py(F, F.r.y + F.r.h);
      const pathG = g.createLinearGradient(0, gy, 0, bottom);
      pathG.addColorStop(0, mixHex(env.stone, env.mid, 0.4));
      pathG.addColorStop(1, mixHex(env.stone, env.near, 0.5));
      g.fillStyle = pathG;
      g.beginPath();
      g.moveTo(doorX - dw * 0.7, gy);
      g.lineTo(doorX + dw * 0.7, gy);
      g.quadraticCurveTo(doorX + dw * 1.6, gy + (bottom - gy) * 0.6, doorX + dw * 3.2, bottom);
      g.lineTo(doorX - dw * 3.2, bottom);
      g.quadraticCurveTo(doorX - dw * 1.6, gy + (bottom - gy) * 0.6, doorX - dw * 0.7, gy);
      g.closePath();
      g.fill();
    }

    // --- iron fence along the whole world (gate gap at the path)
    const fh = U * 0.07;
    const step = fh * 0.32;
    const bar = Math.max(1.5, fh * 0.06 * F.ppm);
    const fy = py(F, F.fenceY);
    const gate = manor ? (manor.door.w / F.ppm) * 2.4 : 0;
    const gateX = manor ? (mx + manor.door.x + manor.door.w / 2) / F.ppm + r.x : 0;
    const inGate = (X: number) => manor && Math.abs(X - gateX) < gate;
    g.fillStyle = env.iron;
    for (const yy of [0.82, 0.25]) {
      // rails, interrupted at the gate
      if (manor) {
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

    // --- foreground grass tufts along the bottom edge (world cells)
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
) {
  for (let k = 0; k < 2; k++) {
    const tex = fogTexture(env.fog, salt + k * 31);
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
        if (win.shape === 'round' || hash01(i * 13 + F.seed) > 0.4) return;
        const period = 8 + hash01(F.seed + i * 31) * 10;
        const ph = mod(t / period + hash01(F.seed + i * 17), 1);
        const vis = smoothstep(0.1, 0.2, ph) * (1 - smoothstep(0.4, 0.5, ph));
        if (vis < 0.01) return;
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
      // jack-o'-lanterns lining the path
      const nP = Math.max(2, Math.round(Math.min(8, d * 6)));
      const bottom = py(F, r.y + r.h);
      const gy = py(F, F.groundY);
      for (let i = 0; i < nP && o.pumpkins > 0; i++) {
        const side = i % 2 ? 1 : -1;
        const k = Math.floor(i / 2);
        const v = (k + 0.6) / Math.ceil(nP / 2);
        const y = gy + (bottom - gy) * v * 0.85;
        const x = doorX + side * M.door.w * (1.4 + 2.6 * v * v);
        pumpkin(g, x, y, U * 0.09 * F.ppm * (0.55 + 0.6 * v), {
          pal,
          face: (i * 3 + F.seed) % 6,
          t: t + i,
          glow: 0.9,
        });
      }
    }

    // pumpkins along the fence, eyes in the bushes (world cells)
    if (o.pumpkins > 0) {
      cells(F, U * 0.55, r.x - U, r.x + r.w + U, (idx, X) => {
        if (h01(F, idx, 21) > 0.35 * o.pumpkins) return;
        if (o.house && Math.abs(X - F.houseX) < F.houseW * 0.9) return;
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
        if (h01(F, idx, 41) > 0.5) return;
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
    worldFog(g, F, env, F.groundY + U * 0.01, 0.1, t, 0.28, F.seed + 3, 0.6);
    worldFog(g, F, env, r.y + U * 0.97, 0.08, t + 40, 0.15, F.seed + 7, 1);

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
      return skyUniforms(s, env, { moon: [0.8, 0.2], moonR: 0.075, horizonY: 0.25, clouds: 0.9 }, speedOf(s));
    },
    panoDraw(o),
    { ambientSound: (snd) => snd.ambience('wind', 0.035), shaderScale: 0.5 },
  );
}

export const panoramaScenes: SceneModule[] = [
  panoramaScene('spookPanorama', { house: true, graves: 1, ghosts: 1, bats: 1, pumpkins: 1, party: false }),
  panoramaScene('partyPanorama', {
    house: false,
    graves: 0,
    ghosts: 0.8,
    bats: 0.6,
    pumpkins: 1.2,
    party: true,
  }),
  panoramaScene('quietPanorama', {
    house: false,
    graves: 1.6,
    ghosts: 0.5,
    bats: 0.4,
    pumpkins: 0,
    party: false,
  }),
  panoramaScene('neonPanorama', {
    house: true,
    graves: 0.6,
    ghosts: 1.4,
    bats: 1,
    pumpkins: 1.8,
    party: false,
    neon: true,
  }),
];
