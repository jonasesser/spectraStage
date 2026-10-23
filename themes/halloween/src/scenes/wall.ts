import * as THREE from 'three';
import { createRng, hashInts } from '@spectrastage/shared';
import {
  canvasScene,
  hybridScene,
  memo,
  noise1,
  smoothstep,
  TAU,
  hash01,
  clamp01,
} from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { num, palette } from '../palette.ts';
import { bat, dancePose, ghost, glowAt, pumpkin, px, skeleton, star, type GhostFace } from '../shapes.ts';
import { countOf, densityOf, mod, speedOf } from './common.ts';
import { FBM_GLSL } from './glsl.ts';
import {
  addGlow,
  drawFogBand,
  envPalette,
  mixHex,
  offscreen,
  paintFence,
  paintVine,
  rgbaHex,
  paintGrass,
  paintHills,
  paintTombstone,
  paintTree,
  SKY_FRAG,
  skyUniforms,
  winPath,
  type EnvPalette,
  type StoneKind,
} from './env.ts';
import { backdrop, drawEyes, drawManor, MOON_POS } from './manor.ts';

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];

// ---------------------------------------------------------------------------
// Haunted House
// ---------------------------------------------------------------------------
const hauntedHouse: SceneModule = hybridScene(
  'hauntedHouse',
  SKY_FRAG,
  (s) =>
    skyUniforms(
      s,
      envPalette(s.params),
      { moon: MOON_POS, moonR: 0.075, horizonY: 0.25, clouds: 0.9 },
      speedOf(s),
    ),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = envPalette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    // bats behind the house
    const nb = countOf(s, 5, 1, 14);
    for (let i = 0; i < nb; i++) {
      const v = 0.03 + hash01(s.seed + i * 3) * 0.04;
      const dir = i % 2 ? 1 : -1;
      const u = mod(t * v + hash01(i * 11 + s.seed), 1) * 1.4 - 0.2;
      const bx = (dir > 0 ? u : 1 - u) * w;
      const by = h * (0.1 + 0.28 * hash01(i * 7 + 3)) + Math.sin(t * 2 + i) * h * 0.03;
      bat(g, bx, by, px(s, 0.3, 0.025, 0.06) * (i % 3 === 0 ? 0.6 : 1), Math.sin(t * 14 + i), pal);
    }
    const L = drawManor(g, s, env, t);
    // jack-o'-lanterns lining the path
    const psz = px(s, 0.3, 0.04, 0.1);
    const nP = Math.max(2, Math.round(Math.min(8, densityOf(s) * 6)));
    for (let i = 0; i < nP; i++) {
      const side = i % 2 ? 1 : -1;
      const k = Math.floor(i / 2);
      const v = (k + 0.6) / Math.ceil(nP / 2);
      const y = L.groundY + (h - L.groundY) * v * 0.85;
      const x = L.doorX + side * L.manor.door.w * (1.4 + 2.6 * v * v);
      const sz = psz * (0.55 + 0.6 * v);
      pumpkin(g, x, y, sz, { pal, face: (i * 3 + s.seed) % 6, t: t + i, glow: 0.9 });
    }
    drawEyes(g, s, t, L.groundY - h * 0.02, L.groundY + h * 0.05, countOf(s, 5, 2, 12), [
      '#fff066',
      pal.secondary,
    ]);
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.035), shaderScale: 0.5 },
);

// ---------------------------------------------------------------------------
// Skeleton Disco
// ---------------------------------------------------------------------------
/** Cached gothic ballroom: stone wall, moonlit arched windows, pillars, drapes. */
function ballroom(s: DrawState, env: EnvPalette, accent: string) {
  return memo(s, 'ballroom', () => {
    const { w, h } = s;
    const m = Math.min(w, h);
    const { c, g } = offscreen(w, h);
    const floorTop = h * 0.74;
    g.fillStyle = vgrad2(
      g,
      0,
      floorTop,
      mixHex(env.wallBottom, '#000000', 0.7),
      mixHex(env.wallTop, '#000000', 0.5),
    );
    g.fillRect(0, 0, w, floorTop);
    // stone blocks
    const bh = m * 0.05;
    for (let y = 0, r = 0; y < floorTop; y += bh, r++) {
      for (let x = (r % 2) * bh, k = 0; x < w; x += bh * 2, k++) {
        g.fillStyle = `rgba(255,255,255,${0.015 + hash01(r * 97 + k) * 0.03})`;
        g.fillRect(x + 1, y + 1, bh * 2 - 2, bh - 2);
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(x, y + bh - 1.5, bh * 2, 1.5);
      }
    }
    // arched windows with night sky
    const n = Math.max(2, Math.round(w / (m * 0.42)));
    const ww = (w / n) * 0.42;
    const wh = floorTop * 0.6;
    for (let i = 0; i < n; i++) {
      const x = (w * (i + 0.5)) / n - ww / 2;
      const y = floorTop * 0.18;
      g.fillStyle = mixHex(env.trim, '#000000', 0.2);
      winPath(g, x - ww * 0.1, y - ww * 0.1, ww * 1.2, wh + ww * 0.12, 'gothic');
      g.fill();
      g.save();
      winPath(g, x, y, ww, wh, 'gothic');
      g.clip();
      g.fillStyle = vgrad2(g, y, y + wh, env.skyTop, env.skyHorizon);
      g.fillRect(x, y, ww, wh);
      if (i === Math.floor(n / 2) - (n % 2 ? 0 : 1)) {
        addGlow(g, x + ww * 0.6, y + wh * 0.3, ww * 0.9, env.moonGlow, 0.5);
        g.fillStyle = env.moon;
        g.beginPath();
        g.arc(x + ww * 0.6, y + wh * 0.3, ww * 0.22, 0, TAU);
        g.fill();
      }
      const rng = createRng(s.seed + i);
      g.fillStyle = '#ffffff';
      for (let k = 0; k < 6; k++) g.fillRect(x + rng() * ww, y + rng() * wh * 0.6, 1.5, 1.5);
      // leaded glass grid
      g.fillStyle = mixHex(env.trim, '#000000', 0.4);
      const lb = Math.max(1, ww * 0.03);
      for (let k = 1; k < 3; k++) g.fillRect(x + (ww * k) / 3 - lb / 2, y, lb, wh);
      for (let k = 1; k < 5; k++) g.fillRect(x, y + (wh * k) / 5, ww, lb);
      g.restore();
      // moonlight falling in
      g.fillStyle = rgbaHex(env.moonGlow, 0.05);
      g.beginPath();
      g.moveTo(x, y + wh * 0.3);
      g.lineTo(x + ww, y + wh * 0.3);
      g.lineTo(x + ww * 2.2, floorTop + h * 0.2);
      g.lineTo(x + ww * 0.6, floorTop + h * 0.2);
      g.fill();
    }
    // pillars between windows
    for (let i = 0; i <= n; i++) {
      const x = (w * i) / n;
      const pw = m * 0.05;
      g.fillStyle = hgrad2(
        g,
        x - pw / 2,
        x + pw / 2,
        mixHex(env.stoneLit, env.stone, 0.6),
        mixHex(env.stone, '#000000', 0.6),
      );
      g.fillRect(x - pw / 2, 0, pw, floorTop);
      g.fillStyle = mixHex(env.stone, '#000000', 0.3);
      g.fillRect(x - pw * 0.7, floorTop - pw * 0.5, pw * 1.4, pw * 0.5);
      g.fillRect(x - pw * 0.7, floorTop * 0.12, pw * 1.4, pw * 0.4);
    }
    // swag drapes along the top
    const sw = w / Math.max(3, n * 2);
    for (let x = 0; x < w; x += sw) {
      const gr = g.createLinearGradient(0, 0, 0, h * 0.12);
      gr.addColorStop(0, mixHex(accent, '#000000', 0.2));
      gr.addColorStop(1, mixHex(accent, '#000000', 0.65));
      g.fillStyle = gr;
      g.beginPath();
      g.moveTo(x, 0);
      g.quadraticCurveTo(x + sw / 2, h * 0.2, x + sw, 0);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.moveTo(x + sw * 0.1, 0);
      g.quadraticCurveTo(x + sw / 2, h * 0.14, x + sw * 0.9, 0);
      g.quadraticCurveTo(x + sw / 2, h * 0.1, x + sw * 0.1, 0);
      g.fill();
    }
    // floor base
    g.fillStyle = vgrad2(g, floorTop, h, '#0a0612', '#020104');
    g.fillRect(0, floorTop, w, h - floorTop);
    return c;
  });
}

function vgrad2(g: CanvasRenderingContext2D, y0: number, y1: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

function hgrad2(g: CanvasRenderingContext2D, x0: number, x1: number, a: string, b: string): CanvasGradient {
  const gr = g.createLinearGradient(x0, 0, x1, 0);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  return gr;
}

const skeletonDisco: SceneModule = canvasScene('skeletonDisco', (g, s, f) => {
  const pal = palette(s.params);
  const env = envPalette(s.params);
  const bpm = num(s.params, 'bpm', 108);
  const t = f.time;
  const beat = (t * bpm * speedOf(s)) / 60;
  const { w, h } = s;
  const m = Math.min(w, h);
  g.drawImage(ballroom(s, env, pal.accent), 0, 0);
  const pulse = 0.5 + 0.5 * Math.cos(beat * TAU); // soft, no strobe

  // light beams from disco ball
  const bx = w / 2;
  const by = h * 0.1;
  g.save();
  g.globalCompositeOperation = 'lighter';
  const beams = 7;
  for (let i = 0; i < beams; i++) {
    const a = Math.PI / 2 + Math.sin(t * 0.4 * speedOf(s) + i * 1.3) * 1.1;
    const len = Math.hypot(w, h);
    const spread = 0.07;
    g.fillStyle = pal.party[i % pal.party.length]!;
    g.globalAlpha = 0.07 + 0.04 * pulse;
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx + Math.cos(a - spread) * len, by + Math.sin(a - spread) * len);
    g.lineTo(bx + Math.cos(a + spread) * len, by + Math.sin(a + spread) * len);
    g.closePath();
    g.fill();
  }
  g.restore();
  // dancing light spots
  const spots = countOf(s, 26, 8, 60);
  for (let i = 0; i < spots; i++) {
    const a = hash01(i * 3 + s.seed) * TAU + t * 0.3 * speedOf(s);
    const r = (0.2 + 0.8 * hash01(i * 7)) * Math.max(w, h) * 0.6;
    const sx = bx + Math.cos(a) * r;
    const sy = by + Math.abs(Math.sin(a)) * r * 0.8 + h * 0.1;
    glowAt(g, sx, sy, m * 0.025, pal.party[i % pal.party.length]!, 0.5);
  }
  // disco floor (true perspective tiles)
  const floorTop = h * 0.74;
  const vy = floorTop - h * 0.9;
  const rows = 5;
  const cols = Math.max(6, Math.round((w / m) * 6));
  const xAt = (u: number, y: number) => w / 2 + (u - 0.5) * w * 2.2 * ((y - vy) / (h - vy));
  for (let r = 0; r < rows; r++) {
    const v0 = r / rows;
    const v1 = (r + 1) / rows;
    const y0 = floorTop + (h - floorTop) * v0 * v0;
    const y1 = floorTop + (h - floorTop) * v1 * v1;
    for (let c = 0; c < cols; c++) {
      const idx = (c + r + Math.floor(beat)) % pal.party.length;
      const on = (c + r) % 2 === Math.floor(beat) % 2;
      const u0 = c / cols;
      const u1 = (c + 1) / cols;
      g.fillStyle = pal.party[idx]!;
      g.globalAlpha = on ? 0.3 + 0.25 * pulse : 0.08;
      g.beginPath();
      g.moveTo(xAt(u0, y0) + 1, y0 + 1);
      g.lineTo(xAt(u1, y0) - 1, y0 + 1);
      g.lineTo(xAt(u1, y1) - 1, y1 - 1);
      g.lineTo(xAt(u0, y1) + 1, y1 - 1);
      g.closePath();
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const floorShade = g.createLinearGradient(0, floorTop, 0, h);
  floorShade.addColorStop(0, 'rgba(0,0,0,0.55)');
  floorShade.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = floorShade;
  g.fillRect(0, floorTop, w, h - floorTop);
  drawFogBand(g, w, floorTop, h * 0.18, env.fog, t, 0.25, s.seed + 9, 0.4);
  // disco ball
  const br = m * 0.07;
  glowAt(g, bx, by, br * 3, '#ffffff', 0.25 + 0.15 * pulse);
  g.fillStyle = '#c9c9d9';
  g.beginPath();
  g.arc(bx, by, br, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(bx, by, br, 0, TAU);
  g.clip();
  const facets = 8;
  for (let i = -facets; i <= facets; i++) {
    for (let j = -facets; j <= facets; j++) {
      const fx = bx + ((i + mod(t * 2 * speedOf(s), 1)) * br) / facets;
      const fy = by + (j * br) / facets;
      const lum = hash01(i * 31 + j * 17 + Math.floor(t * 4 * speedOf(s)));
      g.fillStyle = lum > 0.8 ? '#ffffff' : lum > 0.5 ? '#9da3c9' : '#6b6f8c';
      g.fillRect(fx, fy, br / facets - 1, br / facets - 1);
    }
  }
  const shadeBall = g.createRadialGradient(bx - br * 0.35, by - br * 0.35, br * 0.1, bx, by, br);
  shadeBall.addColorStop(0, 'rgba(255,255,255,0.35)');
  shadeBall.addColorStop(0.6, 'rgba(0,0,0,0)');
  shadeBall.addColorStop(1, 'rgba(0,0,30,0.6)');
  g.fillStyle = shadeBall;
  g.fillRect(bx - br, by - br, br * 2, br * 2);
  g.restore();
  star(g, bx - br * 0.4, by - br * 0.4, br * 0.35, '#ffffff', 0.6 + 0.4 * pulse);
  g.strokeStyle = '#aaaaaa';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(bx, 0);
  g.lineTo(bx, by - br);
  g.stroke();

  // skeletons
  const size = Math.min(h * 0.62, px(s, 1.2, 0.2, 0.62));
  const maxN = Math.max(1, Math.floor(w / (size * 0.7)));
  const n = Math.max(1, Math.min(maxN, Math.round(Math.min(7, maxN) * Math.min(1, densityOf(s)))));
  const footY = h * 0.92;
  for (let i = 0; i < n; i++) {
    const x = (w * (i + 0.5)) / n;
    const style = (i + Math.floor(beat / 8)) % 4;
    const pose = dancePose(beat + (i % 2) * 0.5, style);
    skeleton(g, x, footY - size / 2, size, pose, pal.ghost, pal.party[i % pal.party.length]);
  }
});

// ---------------------------------------------------------------------------
// Ghost Party
// ---------------------------------------------------------------------------
const ghostParty: SceneModule = hybridScene(
  'ghostParty',
  SKY_FRAG,
  (s) =>
    skyUniforms(
      s,
      envPalette(s.params),
      { moon: [0.82, 0.16], moonR: 0.06, horizonY: 0.32, clouds: 1 },
      speedOf(s),
    ),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = envPalette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    g.drawImage(backdrop(s, env, { manor: [0.7, 0.26], horizon: 0.7, ground: 0.88 }), 0, 0);
    drawFogBand(g, w, h * 0.86, h * 0.14, env.fog, t, 0.35, s.seed + 2, 0.6);
    // string lights
    for (const k of [0, 1]) {
      const sag = h * (0.1 + k * 0.05);
      const y0 = h * (0.2 + k * 0.06);
      const bulbs = Math.max(8, Math.round(w / (m * 0.06)));
      g.strokeStyle = 'rgba(80,70,90,0.8)';
      g.lineWidth = Math.max(1, m * 0.003);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const yy = y0 + Math.sin(u * Math.PI) * sag;
        if (i === 0) g.moveTo(u * w, yy);
        else g.lineTo(u * w, yy);
      }
      g.stroke();
      for (let i = 0; i < bulbs; i++) {
        const u = (i + 0.5 + k * 0.5) / bulbs;
        const yy = y0 + Math.sin(u * Math.PI) * sag + m * 0.012;
        const c = pal.party[(i + k) % pal.party.length]!;
        const tw = 0.55 + 0.45 * Math.sin(t * 1.5 + i * 0.9 + k);
        addGlow(g, u * w, yy, m * 0.035, c, 0.55 * tw);
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(u * w, yy, m * 0.006, m * 0.009, 0, 0, TAU);
        g.fill();
      }
    }
    // floating orbs
    const orbs = countOf(s, 20, 4, 50);
    for (let i = 0; i < orbs; i++) {
      const sp = 0.03 + hash01(i + s.seed) * 0.05;
      const y = h * (1.1 - mod(t * sp + hash01(i * 3), 1) * 1.2);
      const x = w * hash01(i * 7 + 1) + Math.sin(t * 0.8 + i) * m * 0.03;
      glowAt(g, x, y, m * 0.02, pal.party[i % pal.party.length]!, 0.45);
    }
    // three layers of ghosts
    const layers = [
      { size: 0.45, alpha: 0.45, n: 6, speed: 0.025, yb: 0.35 },
      { size: 0.7, alpha: 0.75, n: 4, speed: 0.04, yb: 0.55 },
      { size: 1.0, alpha: 1, n: 3, speed: 0.055, yb: 0.68 },
    ];
    layers.forEach((L, li) => {
      const size = px(s, L.size, 0.08, 0.45);
      const n = Math.max(1, Math.round(L.n * densityOf(s) * Math.max(0.6, w / h / 1.6)));
      for (let i = 0; i < n; i++) {
        const id = li * 100 + i;
        const dir = hash01(id + s.seed) > 0.5 ? 1 : -1;
        const v = L.speed * (0.7 + 0.6 * hash01(id * 5));
        const u = mod(t * v + i / n + hash01(id * 3), 1) * 1.3 - 0.15;
        const x = (dir > 0 ? u : 1 - u) * w;
        const loop =
          smoothstep(0.0, 0.1, mod(t * 0.08 + hash01(id), 1)) *
          (1 - smoothstep(0.1, 0.2, mod(t * 0.08 + hash01(id), 1)));
        const la = t * 3 + id;
        const y =
          h * L.yb + Math.sin(t * (0.8 + hash01(id * 9)) + id) * h * 0.08 + Math.sin(la) * loop * size * 0.6;
        ghost(g, x + Math.cos(la) * loop * size * 0.6, y, size, {
          color: pal.ghost,
          t: t + id,
          alpha: L.alpha,
          face: FACES[(id + Math.floor(t / 5)) % FACES.length],
          wave: Math.sin(t * 5 + id) * 0.7,
          mirror: dir < 0,
          blush: li === 2 ? '#ff9ac8' : undefined,
        });
      }
    });
  },
  { ambientSound: (snd) => snd.ambience('drone', 0.025), shaderScale: 0.5 },
);

// ---------------------------------------------------------------------------
// Pumpkin Magic
// ---------------------------------------------------------------------------
const pumpkinMagic: SceneModule = hybridScene(
  'pumpkinMagic',
  SKY_FRAG,
  (s) =>
    skyUniforms(
      s,
      envPalette(s.params),
      { moon: [0.15, 0.18], moonR: 0.07, horizonY: 0.35, clouds: 0.7 },
      speedOf(s),
    ),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = envPalette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    const size = Math.min(h * 0.42, px(s, 0.55, 0.12, 0.45));
    const n = Math.max(1, Math.min(7, Math.floor(w / (size * 1.5))));
    const groundY = h * 0.84;
    g.drawImage(
      memo(s, 'patch', () => {
        const { c, g: pg } = offscreen(w, h);
        pg.drawImage(backdrop(s, env, { horizon: 0.66, ground: 0.8, lightDir: -1 }), 0, 0);
        paintVine(pg, w, groundY + size * 0.36, size * 0.9, s.seed + 4);
        return c;
      }),
      0,
      0,
    );
    addGlow(g, w / 2, groundY, Math.max(w, h) * 0.45, pal.accent, 0.1);
    drawFogBand(g, w, h * 0.82, h * 0.1, env.fog, t, 0.25, s.seed + 5, 0.4);
    for (let i = 0; i < n; i++) {
      const x = (w * (i + 0.5)) / n;
      const period = 3.2 + hash01(i + s.seed) * 2;
      const k = (t + hash01(i * 13) * period) / period;
      const slot = Math.floor(k);
      const since = (k - slot) * period;
      const face = Math.floor(hashInts(s.seed + i, slot) % 6);
      const squash = since < 0.45 ? Math.sin((since / 0.45) * Math.PI * 2) * (1 - since / 0.45) : 0;
      const hop = since < 0.45 ? Math.sin((since / 0.45) * Math.PI) * size * 0.12 : 0;
      const y = groundY - hop + Math.sin(t * 1.5 + i) * size * 0.015;
      // magic sparks spiralling up
      const sparks = Math.round(14 * densityOf(s) * (0.5 + s.quality * 0.5));
      for (let j = 0; j < sparks; j++) {
        const age = mod(t * 0.35 + j / sparks + hash01(i * 7), 1);
        const a = age * TAU * 2 + j;
        const rr = size * (0.25 + age * 0.4);
        const sx = x + Math.cos(a) * rr;
        const sy = y - size * 0.4 - age * h * 0.5;
        glowAt(g, sx, sy, m * 0.03 * (1 - age * 0.5), j % 3 ? pal.secondary : pal.accent, (1 - age) * 0.5);
        star(g, sx, sy, m * 0.016 * (1 - age * 0.5), j % 3 ? '#ffffff' : pal.accent, (1 - age) * 0.95);
      }
      // burst on face change
      if (since < 0.8) {
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * TAU;
          const d = size * (0.55 + since * 0.9);
          star(g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.7, m * 0.012, pal.secondary, 1 - since / 0.8);
        }
      }
      pumpkin(g, x, y, size, { pal, face, t, squash, glow: 1 });
    }
  },
  { shaderScale: 0.5 },
);

// ---------------------------------------------------------------------------
// Monster Windows
// ---------------------------------------------------------------------------
function monster(
  g: CanvasRenderingContext2D,
  type: number,
  x: number,
  y: number,
  size: number,
  t: number,
  wave: number,
): void {
  const dark = '#120a1c';
  g.save();
  g.translate(x, y);
  g.fillStyle = dark;
  const r = size / 2;
  switch (type % 5) {
    case 0: // one-eyed blob
      g.beginPath();
      g.moveTo(-r, r);
      g.bezierCurveTo(-r * 1.1, -r * 0.6, -r * 0.4, -r * 1.1, 0, -r * 1.05);
      g.bezierCurveTo(r * 0.4, -r * 1.1, r * 1.1, -r * 0.6, r, r);
      g.fill();
      break;
    case 1: // horned
      g.beginPath();
      g.arc(0, 0, r * 0.85, 0, TAU);
      g.rect(-r * 0.85, 0, r * 1.7, r);
      g.fill();
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * r * 0.5, -r * 0.6);
        g.quadraticCurveTo(s * r * 1.0, -r * 1.0, s * r * 0.9, -r * 1.5);
        g.quadraticCurveTo(s * r * 0.6, -r * 1.0, s * r * 0.2, -r * 0.75);
        g.fill();
      }
      break;
    case 2: // antenna alien
      g.beginPath();
      g.ellipse(0, r * 0.2, r * 0.7, r * 0.95, 0, 0, TAU);
      g.fill();
      g.strokeStyle = dark;
      g.lineWidth = r * 0.08;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(s * r * 0.2, -r * 0.6);
        g.quadraticCurveTo(s * r * 0.5, -r * 1.2 + Math.sin(t * 4 + s) * r * 0.1, s * r * 0.6, -r * 1.3);
        g.stroke();
        g.beginPath();
        g.arc(s * r * 0.6, -r * 1.35, r * 0.13, 0, TAU);
        g.fill();
      }
      break;
    case 3: // furry ball
      g.beginPath();
      for (let i = 0; i <= 28; i++) {
        const a = (i / 28) * TAU;
        const rr = r * (0.9 + (i % 2) * 0.12);
        g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr + r * 0.2);
      }
      g.fill();
      break;
    default: // tentacle
      g.beginPath();
      g.arc(0, -r * 0.2, r * 0.8, Math.PI, 0);
      g.lineTo(r * 0.8, r);
      g.lineTo(-r * 0.8, r);
      g.fill();
      g.lineCap = 'round';
      g.strokeStyle = dark;
      g.lineWidth = r * 0.22;
      g.beginPath();
      g.moveTo(r * 0.7, 0);
      g.quadraticCurveTo(r * 1.2, -r * 0.4 - wave * r * 0.5, r * 1.0 + wave * r * 0.3, -r * 1.0);
      g.stroke();
  }
  // eyes
  const eyeC = '#fff36b';
  g.fillStyle = eyeC;
  const blink = Math.sin(t * 1.7 + type) > 0.94 ? 0.15 : 1;
  const eyes =
    type % 5 === 0
      ? [[0, -r * 0.35, r * 0.32]]
      : [
          [-r * 0.3, -r * 0.1, r * 0.17],
          [r * 0.3, -r * 0.1, r * 0.17],
        ];
  for (const [ex, ey, er] of eyes) {
    g.beginPath();
    g.ellipse(ex!, ey!, er!, er! * blink, 0, 0, TAU);
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.arc(ex! + Math.sin(t * 0.9) * er! * 0.35, ey!, er! * 0.45 * blink, 0, TAU);
    g.fill();
    g.fillStyle = eyeC;
  }
  // smile
  g.strokeStyle = eyeC;
  g.lineWidth = Math.max(1, r * 0.06);
  g.beginPath();
  g.arc(0, r * 0.3, r * 0.3, 0.3, Math.PI - 0.3);
  g.stroke();
  // waving hand
  if (wave > 0) {
    g.fillStyle = dark;
    g.save();
    g.translate(-r * 0.95, -r * 0.1);
    g.rotate(-0.6 + Math.sin(t * 9) * 0.35);
    g.fillRect(-r * 0.09, -r * 0.7, r * 0.18, r * 0.7);
    g.beginPath();
    g.arc(0, -r * 0.75, r * 0.18, 0, TAU);
    g.fill();
    g.restore();
  }
  g.restore();
}

interface MWin {
  x: number;
  y: number;
  w: number;
  h: number;
  id: number;
}

function monsterWindowLayout(s: DrawState) {
  const { w, h } = s;
  const cols = Math.max(
    2,
    Math.min(6, Math.round(num(s.params, 'columns', 4) * Math.min(1.5, Math.max(0.5, w / h / 1.6)))),
  );
  const rows = Math.max(1, Math.min(4, Math.round(((cols * h) / w) * 1.1)));
  const cw = w / cols;
  const ch = h / rows;
  const wins: MWin[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const ww = cw * 0.56;
      const wh = ch * 0.62;
      wins.push({
        x: c * cw + (cw - ww) / 2,
        y: r * ch + (ch - wh) / 2 - ch * 0.02,
        w: ww,
        h: wh,
        id: r * cols + c,
      });
    }
  return { wins, rows, ch };
}

/** Cached façade: back = wall + lit rooms, front = casings, shutters, mullions, sills. */
function monsterFacade(s: DrawState, env: EnvPalette) {
  return memo(s, 'facade', () => {
    const { w, h } = s;
    const m = Math.min(w, h);
    const { wins, rows, ch } = monsterWindowLayout(s);
    const back = offscreen(w, h);
    const front = offscreen(w, h);
    const g = back.g;
    // clapboard wall with moonlight from the upper left
    g.fillStyle = mixHex(env.wallTop, env.wallBottom, 0.3);
    g.fillRect(0, 0, w, h);
    const step = Math.max(4, m * 0.03);
    for (let y = 0; y < h; y += step) {
      const gr = g.createLinearGradient(0, y, 0, y + step);
      gr.addColorStop(0, rgbaHex(env.rim, 0.1));
      gr.addColorStop(0.15, 'rgba(0,0,0,0)');
      gr.addColorStop(0.85, 'rgba(0,0,0,0.12)');
      gr.addColorStop(1, 'rgba(0,0,0,0.45)');
      g.fillStyle = gr;
      g.fillRect(0, y, w, step);
    }
    const shade = g.createRadialGradient(w * 0.2, -h * 0.2, 0, w * 0.2, -h * 0.2, Math.max(w, h) * 1.3);
    shade.addColorStop(0, rgbaHex(env.rim, 0.22));
    shade.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = shade;
    g.fillRect(0, 0, w, h);
    // floor bands
    for (let r = 1; r < rows; r++) {
      g.fillStyle = env.trim;
      g.fillRect(0, r * ch - m * 0.012, w, m * 0.02);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fillRect(0, r * ch + m * 0.008, w, m * 0.012);
    }
    for (const win of wins) {
      // room interior: warm wallpaper + floor
      const room = g.createLinearGradient(0, win.y, 0, win.y + win.h);
      room.addColorStop(0, mixHex(env.winEdge, '#2a0a00', 0.55));
      room.addColorStop(0.6, mixHex(env.winCore, env.winEdge, 0.55));
      room.addColorStop(1, mixHex(env.winEdge, '#2a0a00', 0.3));
      g.fillStyle = room;
      g.fillRect(win.x, win.y, win.w, win.h);
      g.fillStyle = 'rgba(120,40,0,0.18)';
      for (let x = win.x + win.w * 0.06; x < win.x + win.w; x += win.w * 0.12)
        g.fillRect(x, win.y, win.w * 0.04, win.h * 0.75);
      // picture frame on the back wall
      g.fillStyle = 'rgba(60,20,0,0.55)';
      g.fillRect(win.x + win.w * 0.62, win.y + win.h * 0.12, win.w * 0.2, win.h * 0.22);
      g.fillStyle = 'rgba(255,220,150,0.35)';
      g.fillRect(win.x + win.w * 0.64, win.y + win.h * 0.14, win.w * 0.16, win.h * 0.18);
      // inner reveal shadow
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(win.x, win.y, win.w, win.h * 0.05);
      g.fillRect(win.x, win.y, win.w * 0.04, win.h);
    }
    const fg = front.g;
    for (const win of wins) {
      const f = win.w * 0.07;
      // shutters
      for (const sd of [-1, 1]) {
        const sx = sd < 0 ? win.x - f - win.w * 0.32 : win.x + win.w + f;
        const sw = win.w * 0.32;
        const sg = fg.createLinearGradient(sx, 0, sx + sw, 0);
        sg.addColorStop(0, mixHex(env.roof, env.rim, sd < 0 ? 0.3 : 0.1));
        sg.addColorStop(1, mixHex(env.roof, '#000000', 0.3));
        fg.fillStyle = sg;
        fg.fillRect(sx, win.y - f * 0.5, sw, win.h + f);
        fg.fillStyle = 'rgba(0,0,0,0.35)';
        for (let y = win.y + f; y < win.y + win.h; y += f * 0.9)
          fg.fillRect(sx + sw * 0.12, y, sw * 0.76, f * 0.3);
        fg.fillStyle = rgbaHex(env.rim, 0.15);
        for (let y = win.y + f * 0.7; y < win.y + win.h; y += f * 0.9)
          fg.fillRect(sx + sw * 0.12, y, sw * 0.76, f * 0.15);
      }
      // casing with bevel
      fg.fillStyle = mixHex(env.trim, env.rim, 0.15);
      fg.beginPath();
      fg.rect(win.x - f, win.y - f, win.w + f * 2, win.h + f * 2);
      fg.rect(win.x + win.w, win.y, -win.w, win.h);
      fg.fill('evenodd');
      fg.fillStyle = rgbaHex(env.rim, 0.3);
      fg.fillRect(win.x - f, win.y - f, win.w + f * 2, f * 0.3);
      fg.fillRect(win.x - f, win.y - f, f * 0.3, win.h + f * 2);
      // pediment
      fg.fillStyle = env.trim;
      fg.beginPath();
      fg.moveTo(win.x - f * 2, win.y - f);
      fg.lineTo(win.x + win.w / 2, win.y - f - win.h * 0.12);
      fg.lineTo(win.x + win.w + f * 2, win.y - f);
      fg.closePath();
      fg.fill();
      fg.fillStyle = rgbaHex(env.rim, 0.25);
      fg.fillRect(win.x - f * 2, win.y - f * 1.3, win.w + f * 4, f * 0.3);
      // mullions
      fg.fillStyle = mixHex(env.trim, '#000000', 0.25);
      fg.fillRect(win.x + win.w / 2 - f * 0.35, win.y, f * 0.7, win.h);
      fg.fillRect(win.x, win.y + win.h * 0.45 - f * 0.3, win.w, f * 0.6);
      // sill with shadow
      fg.fillStyle = mixHex(env.trim, env.rim, 0.3);
      fg.fillRect(win.x - f * 1.8, win.y + win.h + f * 0.6, win.w + f * 3.6, f * 0.9);
      fg.fillStyle = 'rgba(0,0,0,0.45)';
      fg.fillRect(win.x - f * 1.6, win.y + win.h + f * 1.5, win.w + f * 3.2, f * 0.6);
      // glass reflection
      fg.fillStyle = 'rgba(255,255,255,0.06)';
      fg.beginPath();
      fg.moveTo(win.x + win.w * 0.1, win.y + win.h);
      fg.lineTo(win.x + win.w * 0.35, win.y);
      fg.lineTo(win.x + win.w * 0.45, win.y);
      fg.lineTo(win.x + win.w * 0.2, win.y + win.h);
      fg.fill();
    }
    return { back: back.c, front: front.c, wins };
  });
}

const monsterWindows: SceneModule = canvasScene('monsterWindows', (g, s, f) => {
  const pal = palette(s.params);
  const env = envPalette(s.params);
  const t = f.time * speedOf(s);
  const F = monsterFacade(s, env);
  g.drawImage(F.back, 0, 0);
  for (const win of F.wins) {
    const { x: wx, y: wy, w: ww, h: wh, id } = win;
    const period = 6 + hash01(id * 13 + s.seed) * 6;
    const ph = mod(t / period + hash01(id * 7 + s.seed), 1);
    const rise = smoothstep(0.05, 0.18, ph) * (1 - smoothstep(0.62, 0.76, ph));
    const knock = ph > 0.35 && ph < 0.5 ? Math.sin(((ph - 0.35) / 0.15) * Math.PI * 6) : 0;
    const shake = knock * ww * 0.012;
    const lit = 0.55 + 0.45 * noise1(t * 0.6 + id, s.seed);
    g.save();
    g.beginPath();
    g.rect(wx, wy, ww, wh);
    g.clip();
    // flickering lamp light inside
    addGlow(g, wx + ww * 0.5, wy + wh * 0.4, Math.max(ww, wh) * 0.7, env.winCore, 0.25 * lit);
    if (rise > 0.01) {
      const ms = Math.min(ww, wh) * 0.75;
      monster(
        g,
        Math.floor(hashInts(s.seed + id, Math.floor(t / period)) % 5),
        wx + ww / 2 + shake,
        wy + wh + ms * 0.5 - rise * ms * 0.95,
        ms,
        t + id,
        ph > 0.5 && ph < 0.65 ? 1 : 0,
      );
    }
    // draped curtains with folds
    const open = 0.3 + 0.12 * Math.sin(t * 0.5 + id);
    for (const sd of [0, 1]) {
      const cwid = ww * open * 0.5;
      const cx = sd === 0 ? wx : wx + ww - cwid;
      const cg = g.createLinearGradient(cx, 0, cx + cwid, 0);
      const base = mixHex(pal.accent, '#000000', 0.35);
      for (let k = 0; k <= 4; k++) cg.addColorStop(k / 4, k % 2 ? base : mixHex(pal.accent, '#ffffff', 0.1));
      g.fillStyle = cg;
      g.beginPath();
      g.moveTo(cx, wy);
      g.lineTo(cx + cwid, wy);
      g.quadraticCurveTo(
        cx + cwid * (sd === 0 ? 0.6 : 0.4),
        wy + wh * 0.6,
        sd === 0 ? cx + cwid * 0.3 : cx + cwid * 0.7,
        wy + wh,
      );
      g.lineTo(sd === 0 ? cx : cx + cwid, wy + wh);
      g.closePath();
      g.fill();
    }
    g.fillStyle = mixHex(pal.accent, '#000000', 0.5);
    g.fillRect(wx, wy, ww, wh * 0.08);
    g.restore();
    // light spill on the wall below
    addGlow(g, wx + ww / 2, wy + wh * 1.05, ww * 0.8, env.winEdge, 0.18 * lit);
    // knock marks
    if (Math.abs(knock) > 0.2) {
      g.fillStyle = pal.secondary;
      for (let k = 0; k < 3; k++) {
        const a = -0.6 + k * 0.6;
        g.save();
        g.translate(wx + ww + Math.cos(a) * ww * 0.3, wy + wh * 0.3 + Math.sin(a) * ww * 0.3);
        g.rotate(a);
        g.beginPath();
        g.ellipse(0, 0, ww * 0.07, ww * 0.015, 0, 0, TAU);
        g.fill();
        g.restore();
      }
    }
  }
  g.drawImage(F.front, 0, 0);
});

// ---------------------------------------------------------------------------
// Moonlit Graveyard (shader fog + canvas foreground)
// ---------------------------------------------------------------------------
interface Grave {
  x: number;
  y: number;
  w: number;
  kind: StoneKind;
  tilt: number;
  seed: number;
}

/** Cached graveyard layers: back (hills, chapel, tree, fence, back rows) and front row stones. */
function graveyardLayers(s: DrawState, env: EnvPalette) {
  return memo(s, 'graveLayers', () => {
    const { w, h } = s;
    const m = Math.min(w, h);
    const lightDir = -1; // moon on the left
    const back = offscreen(w, h);
    const front = offscreen(w, h);
    const g = back.g;
    const groundY = h * 0.84;
    paintHills(g, w, h * 0.66, h * 0.04, h, mixHex(env.far, env.skyHorizon, 0.4), env.far, s.seed + 21, 1.6);
    // distant chapel
    const cx = w * 0.62;
    const cy = h * 0.655;
    const cs = m * 0.16;
    g.fillStyle = mixHex(env.far, env.near, 0.45);
    g.fillRect(cx - cs * 0.5, cy - cs * 0.45, cs, cs * 0.45);
    g.beginPath();
    g.moveTo(cx - cs * 0.58, cy - cs * 0.45);
    g.lineTo(cx - cs * 0.1, cy - cs * 0.8);
    g.lineTo(cx + cs * 0.4, cy - cs * 0.45);
    g.fill();
    g.fillRect(cx + cs * 0.22, cy - cs * 0.95, cs * 0.24, cs * 0.95);
    g.beginPath();
    g.moveTo(cx + cs * 0.18, cy - cs * 0.95);
    g.lineTo(cx + cs * 0.34, cy - cs * 1.35);
    g.lineTo(cx + cs * 0.5, cy - cs * 0.95);
    g.fill();
    g.fillRect(cx + cs * 0.33, cy - cs * 1.5, cs * 0.02, cs * 0.18);
    g.fillRect(cx + cs * 0.29, cy - cs * 1.45, cs * 0.1, cs * 0.02);
    g.fillStyle = env.winCore;
    winPath(g, cx - cs * 0.2, cy - cs * 0.36, cs * 0.1, cs * 0.18, 'gothic');
    g.fill();
    winPath(g, cx + cs * 0.3, cy - cs * 0.75, cs * 0.08, cs * 0.14, 'gothic');
    g.fill();
    addGlow(g, cx - cs * 0.15, cy - cs * 0.28, cs * 0.25, env.winEdge, 0.5);
    const rng = createRng(s.seed ^ 0x9a4e);
    for (let i = 0; i < Math.round(w / (m * 0.06)); i++) {
      const x = rng() * w;
      if (Math.abs(x - cx) < cs) continue;
      paintTree(
        g,
        s.seed + 300 + i,
        x,
        h * (0.66 + rng() * 0.03),
        m * (0.05 + rng() * 0.06),
        env,
        lightDir,
        mixHex(env.far, env.near, 0.3),
        0,
      );
    }
    paintHills(g, w, h * 0.74, h * 0.03, h, env.mid, mixHex(env.mid, env.near, 0.5), s.seed + 22, 1.2);
    // back row of small stones
    const bw = m * 0.045;
    for (let i = 0; i < Math.round(w / (bw * 2.2)); i++) {
      const x = (i + 0.3 + rng() * 0.4) * bw * 2.2;
      paintTombstone(
        g,
        x,
        h * (0.75 + rng() * 0.02),
        bw * (0.8 + rng() * 0.4),
        (['round', 'cross', 'square', 'round'] as const)[i % 4]!,
        { ...env, stone: mixHex(env.stone, env.mid, 0.5), stoneLit: mixHex(env.stoneLit, env.mid, 0.5) },
        lightDir,
        i,
        (rng() - 0.5) * 0.2,
      );
    }
    // gnarled tree on the right
    paintTree(g, s.seed + 3, w * 0.86, groundY + h * 0.02, Math.min(h * 0.82, w * 0.5), env, lightDir);
    // iron fence along the middle
    paintFence(g, -m * 0.02, w * 1.02, h * 0.8, m * 0.09, env, lightDir);
    // ground
    const gr = g.createLinearGradient(0, groundY - h * 0.03, 0, h);
    gr.addColorStop(0, mixHex(env.grass, env.mid, 0.35));
    gr.addColorStop(1, env.near);
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i <= 40; i++) g.lineTo((i / 40) * w, groundY + Math.sin(i * 0.7 + s.seed) * h * 0.01);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // grave mounds
    for (let i = 0; i < 5; i++) {
      const x = w * (0.1 + 0.2 * i + rng() * 0.05);
      g.fillStyle = mixHex(env.grass, env.mid, 0.5);
      g.beginPath();
      g.ellipse(x, groundY + h * 0.05, m * 0.07, m * 0.02, 0, Math.PI, 0);
      g.fill();
    }
    // front row (drawn above peeking ghosts)
    const ts = Math.min(h * 0.3, px(s, 0.75, 0.12, 0.3));
    const n = Math.max(2, Math.min(7, Math.floor(w / (ts * 1.5))));
    const graves: Grave[] = [];
    const kinds: StoneKind[] = ['round', 'cross', 'square', 'obelisk', 'round', 'square'];
    for (let i = 0; i < n; i++) {
      const x = (w * (i + 0.5)) / n + (hash01(i + s.seed) - 0.5) * ts * 0.4;
      const kind = kinds[(i + s.seed) % kinds.length]!;
      const gw = ts * (kind === 'obelisk' ? 0.5 : 0.7) * (0.85 + 0.3 * hash01(i * 3));
      graves.push({
        x,
        y: groundY + h * 0.06 + hash01(i * 7) * h * 0.03,
        w: gw,
        kind,
        tilt: (hash01(i * 9) - 0.5) * 0.14,
        seed: i + s.seed,
      });
    }
    for (const gv of graves) {
      front.g.fillStyle = 'rgba(0,0,0,0.45)';
      front.g.beginPath();
      front.g.ellipse(gv.x + gv.w * 0.5, gv.y, gv.w * 0.9, gv.w * 0.12, 0, 0, TAU);
      front.g.fill();
      paintTombstone(front.g, gv.x, gv.y, gv.w, gv.kind, env, lightDir, gv.seed, gv.tilt);
    }
    paintGrass(front.g, w, h * 0.995, m * 0.035, env.near, mixHex(env.near, env.treeRim, 0.3), s.seed + 8, 1);
    return { back: back.c, front: front.c, graves, groundY };
  });
}

const moonlitGraveyard: SceneModule = hybridScene(
  'moonlitGraveyard',
  SKY_FRAG,
  (s) =>
    skyUniforms(
      s,
      envPalette(s.params),
      { moon: [0.2, 0.2], moonR: 0.11, horizonY: 0.3, clouds: 0.8, fog: 0.5 },
      speedOf(s),
    ),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = envPalette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    const L = graveyardLayers(s, env);
    g.drawImage(L.back, 0, 0);
    drawFogBand(g, w, h * 0.8, h * 0.18, env.fog, t, 0.55 * densityOf(s), s.seed + 1, 0.5);
    // ghosts peeking out from behind the front stones
    L.graves.forEach((gv, i) => {
      if (i % 2) return;
      const th = gv.w * 1.3;
      const period = 9 + hash01(i * 17 + s.seed) * 8;
      const ph = mod(t / period + hash01(i * 23), 1);
      const peek = smoothstep(0.05, 0.15, ph) * (1 - smoothstep(0.32, 0.42, ph));
      if (peek < 0.01) return;
      g.save();
      g.beginPath();
      g.rect(gv.x - gv.w * 2, 0, gv.w * 4, gv.y - th * 0.1);
      g.clip();
      ghost(g, gv.x + gv.w * 0.35 * peek, gv.y - th * 0.5 - peek * th * 0.6, gv.w * 1.1, {
        color: pal.ghost,
        t,
        face: 'happy',
        wave: Math.sin(t * 7) * 0.8,
        glow: 0.6,
      });
      g.restore();
    });
    g.drawImage(L.front, 0, 0);
    drawFogBand(g, w, h * 0.96, h * 0.2, env.fog, t + 50, 0.55 * densityOf(s), s.seed + 4, 0.8);
    // will-o'-wisps
    const wisps = countOf(s, 8, 2, 20);
    for (let i = 0; i < wisps; i++) {
      const x = w * (0.1 + 0.8 * noise1(t * 0.05 + i * 10, s.seed));
      const y = h * (0.55 + 0.35 * noise1(t * 0.07 + i * 5, s.seed + 1));
      const a = 0.5 + 0.5 * Math.sin(t * 2 + i);
      addGlow(g, x, y, m * 0.05, pal.secondary, 0.35 * a + 0.15);
      addGlow(g, x, y, m * 0.012, '#ffffff', 0.6 * a + 0.2);
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.04), shaderScale: 0.5 },
);

// ---------------------------------------------------------------------------
// Spirit Portal (shader + canvas spirits)
// ---------------------------------------------------------------------------
const PORTAL_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSpeed; uniform float uDensity;
varying vec2 vUv;
${FBM_GLSL}
void main() {
  vec2 p = (vUv - 0.5) * uRes / min(uRes.x, uRes.y);
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = uTime * uSpeed;
  float R = 0.36;
  float swirl = a + log(r + 0.02) * 2.2 - t * 0.6;
  float arms = 0.5 + 0.5 * sin(swirl * 5.0 + fbm(p * 3.0 + t * 0.2 + uSeed) * 3.0);
  float n = fbm(vec2(swirl * 1.2, r * 6.0 - t * 0.8) + uSeed);
  float ring = exp(-pow((r - R) * 9.0, 2.0));
  float inner = smoothstep(R + 0.05, 0.0, r);
  vec3 col = mix(uA, uB, arms) * inner * (0.3 + 0.6 * n) * 0.75;
  col += uC * ring * (0.75 + 0.25 * sin(a * 7.0 + t * 2.0 + fbm(vec2(a * 3.0, t)) * 4.0));
  col += vec3(1.0) * exp(-r * 14.0) * 0.5;
  col += uB * exp(-pow((r - R) * 3.0, 2.0)) * 0.18 * uDensity;
  float sparkle = pow(max(0.0, fbm(p * 30.0 + t)), 6.0) * 2.0 * inner;
  col += vec3(sparkle);
  col *= smoothstep(R * 2.2, R * 1.1, r) * 0.8 + 0.2 * smoothstep(R * 2.8, R, r);
  vec3 bg = mix(vec3(0.01, 0.005, 0.03), uA * 0.16, smoothstep(0.0, 1.0, vUv.y));
  bg += uA * 0.15 * smoothstep(0.55, 0.85, fbm(p * 1.5 + vec2(t * 0.02, 0.0) + uSeed)) * smoothstep(R * 1.2, R * 2.5, r);
  vec2 sp = p * 60.0; vec2 cell = floor(sp); float hs = hash21(cell + uSeed);
  if (hs > 0.93) bg += vec3(smoothstep(0.12, 0.0, length(fract(sp) - 0.5)) * (0.5 + 0.5 * sin(t * 2.0 + hs * 50.0)));
  col += bg * smoothstep(R * 1.05, R * 1.6, r);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

/** Cached stone ring (voussoirs) around the portal with inner glow edge and a stepped base. */
function portalRing(s: DrawState, env: EnvPalette, glowCol: string) {
  return memo(s, 'portalRing', () => {
    const { w, h } = s;
    const { c, g } = offscreen(w, h);
    const R = Math.min(w, h) * 0.36;
    const cx = w / 2;
    const cy = h / 2;
    const r0 = R * 1.05;
    const r1 = R * 1.3;
    // base steps
    for (let k = 0; k < 3; k++) {
      const sw = R * (1.3 + k * 0.35);
      const sy = cy + R * 1.2 + k * R * 0.1;
      g.fillStyle = vgrad2(
        g,
        sy,
        sy + R * 0.1,
        mixHex(env.stoneLit, env.stone, 0.5 + k * 0.15),
        mixHex(env.stone, '#000000', 0.6),
      );
      g.fillRect(cx - sw / 2, sy, sw, R * 0.1);
    }
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU + 0.012;
      const a1 = ((i + 1) / n) * TAU - 0.012;
      const am = (a0 + a1) / 2;
      const lit = 0.5 + 0.5 * Math.cos(am + Math.PI * 0.75);
      const gr = g.createRadialGradient(cx, cy, r0, cx, cy, r1);
      gr.addColorStop(0, mixHex(glowCol, env.stoneLit, 0.4));
      gr.addColorStop(0.18, mixHex(env.stoneLit, env.stone, 1 - lit * 0.6));
      gr.addColorStop(1, mixHex(env.stone, '#000000', 0.55));
      g.fillStyle = gr;
      g.beginPath();
      g.arc(cx, cy, r1, a0, a1);
      g.arc(cx, cy, r0, a1, a0, true);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.beginPath();
      g.arc(cx, cy, r1, a0, a1);
      g.arc(cx, cy, r1 - R * 0.03, a1, a0, true);
      g.closePath();
      g.fill();
      // moss
      if (hash01(i * 7 + s.seed) > 0.6) {
        g.fillStyle = rgbaHex(env.moss, 0.7);
        g.beginPath();
        g.ellipse(
          cx + Math.cos(am) * r1 * 0.98,
          cy + Math.sin(am) * r1 * 0.98,
          R * 0.06,
          R * 0.025,
          am,
          0,
          TAU,
        );
        g.fill();
      }
    }
    // keystone
    g.fillStyle = mixHex(env.stoneLit, env.stone, 0.4);
    g.beginPath();
    g.moveTo(cx - R * 0.1, cy - r0 + R * 0.02);
    g.lineTo(cx + R * 0.1, cy - r0 + R * 0.02);
    g.lineTo(cx + R * 0.15, cy - r1 - R * 0.06);
    g.lineTo(cx - R * 0.15, cy - r1 - R * 0.06);
    g.closePath();
    g.fill();
    return c;
  });
}

const spiritPortal: SceneModule = hybridScene(
  'spiritPortal',
  PORTAL_FRAG,
  (s) => {
    const pal = palette(s.params);
    return {
      uA: new THREE.Vector3(...pal.rgb.accent),
      uB: new THREE.Vector3(...pal.rgb.primary),
      uC: new THREE.Vector3(...pal.rgb.secondary),
      uSpeed: speedOf(s),
      uDensity: densityOf(s),
    };
  },
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const R = Math.min(w, h) * 0.36;
    const cx = w / 2;
    const cy = h / 2;
    const env = envPalette(s.params);
    g.drawImage(portalRing(s, env, pal.secondary), 0, 0);
    // glowing runes carved into the stones
    const runes = 16;
    for (let i = 0; i < runes; i++) {
      const a = (i / runes) * TAU + Math.PI / runes;
      const glowA = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.5 - i * 0.8));
      const rx = cx + Math.cos(a) * R * 1.17;
      const ry = cy + Math.sin(a) * R * 1.17;
      addGlow(g, rx, ry, R * 0.08, pal.secondary, 0.6 * glowA);
      star(g, rx, ry, R * 0.035, '#ffffff', glowA);
    }
    // spirits spiralling in
    const n = countOf(s, 9, 3, 18);
    for (let i = 0; i < n; i++) {
      const period = 7 + hash01(i + s.seed) * 4;
      const age = mod(t / period + i / n, 1);
      const rr = R * 2.2 * (1 - age) + R * 0.05;
      const a = hash01(i * 3) * TAU + age * TAU * 1.5;
      const x = cx + Math.cos(a) * rr * Math.max(1, w / h) * 0.75;
      const y = cy + Math.sin(a) * rr * Math.max(1, h / w) * 0.75;
      const size = Math.min(px(s, 0.45, 0.05, 0.2), R * 0.45) * (0.4 + 0.6 * (1 - age));
      const alpha = clamp01(age * 6) * clamp01((1 - age) * 4);
      ghost(g, x, y, size, {
        color: pal.ghost,
        t: t + i,
        alpha: alpha * 0.9,
        face: FACES[i % 4],
        wave: Math.sin(t * 6 + i) * 0.6,
        mirror: Math.cos(a) > 0,
      });
    }
  },
  { ambientSound: (snd) => snd.ambience('drone', 0.03) },
);

export const wallScenes: SceneModule[] = [
  hauntedHouse,
  skeletonDisco,
  ghostParty,
  pumpkinMagic,
  monsterWindows,
  moonlitGraveyard,
  spiritPortal,
];
