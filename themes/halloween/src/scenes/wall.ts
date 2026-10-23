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
import type { SceneModule } from '@spectrastage/engine';
import { num, palette } from '../palette.ts';
import {
  bat,
  dancePose,
  ghost,
  glowAt,
  pumpkin,
  px,
  skeleton,
  sky,
  star,
  tombstone,
  type GhostFace,
} from '../shapes.ts';
import { countOf, densityOf, drawStars, drawTree, mod, speedOf, starField, treeSegments } from './common.ts';
import { FBM_GLSL } from './glsl.ts';

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];

function moon(g: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, face = false): void {
  glowAt(g, x, y, r * 3.2, '#fff2c4', 0.35);
  g.fillStyle = '#fff6d8';
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(210,190,140,0.35)';
  for (const [dx, dy, rr] of [
    [-0.35, -0.2, 0.18],
    [0.3, 0.3, 0.13],
    [0.25, -0.35, 0.09],
  ] as const) {
    g.beginPath();
    g.arc(x + dx * r, y + dy * r, rr * r, 0, TAU);
    g.fill();
  }
  if (face) {
    g.strokeStyle = 'rgba(120,90,60,0.8)';
    g.lineWidth = Math.max(1, r * 0.05);
    g.lineCap = 'round';
    const open = Math.sin(t * 0.4) > 0.8;
    for (const s of [-1, 1]) {
      g.beginPath();
      if (open) g.arc(x + s * r * 0.32, y - r * 0.05, r * 0.08, 0, TAU);
      else g.arc(x + s * r * 0.32, y - r * 0.1, r * 0.12, 0.3, Math.PI - 0.3);
      g.stroke();
    }
    g.beginPath();
    g.arc(x, y + r * 0.2, r * 0.18, 0.3, Math.PI - 0.3);
    g.stroke();
  }
}

// ---------------------------------------------------------------------------
// Haunted House
// ---------------------------------------------------------------------------
const hauntedHouse: SceneModule = canvasScene(
  'hauntedHouse',
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    sky(g, w, h, pal);
    drawStars(g, starField(s, countOf(s, 90, 10, 220), 0.55), t);
    const m = Math.min(w, h);
    moon(g, w * 0.84, h * 0.2, m * 0.1, t);

    const groundY = h * 0.93;
    const H = Math.min(h * 0.74, w * 0.9);
    const W = Math.min(w * 0.62, H * 1.05);
    const x0 = w / 2 - W / 2;

    // trees on the sides if there is room
    if (w - W > m * 0.5) {
      const trees = memo(s, 'trees', () => [
        treeSegments(s.seed + 1, x0 * 0.45, groundY, H * 0.95),
        treeSegments(s.seed + 2, w - x0 * 0.45, groundY, H * 0.85),
      ]);
      for (const tr of trees) drawTree(g, tr, pal.rim, pal.shadow, Math.sin(t * 0.7));
    }
    // hill
    g.fillStyle = '#0d0818';
    g.beginPath();
    g.ellipse(w / 2, groundY + H * 0.15, W * 0.9, H * 0.2, 0, Math.PI, 0);
    g.fill();

    // house geometry (relative to W/H)
    const mainX = x0;
    const mainW = W * 0.66;
    const mainTop = groundY - H * 0.52;
    const towerX = x0 + W * 0.6;
    const towerW = W * 0.34;
    const towerTop = groundY - H * 0.78;
    g.save();
    g.lineJoin = 'round';
    g.beginPath();
    g.rect(mainX, mainTop, mainW, groundY - mainTop);
    g.moveTo(mainX - W * 0.05, mainTop);
    g.lineTo(mainX + mainW * 0.5, mainTop - H * 0.24);
    g.lineTo(mainX + mainW + W * 0.03, mainTop);
    g.closePath();
    g.rect(towerX, towerTop, towerW, groundY - towerTop);
    g.moveTo(towerX - W * 0.03, towerTop);
    g.lineTo(towerX + towerW / 2, groundY - H);
    g.lineTo(towerX + towerW + W * 0.03, towerTop);
    g.closePath();
    g.fillStyle = pal.shadow;
    g.shadowColor = pal.rim;
    g.shadowBlur = m * 0.03;
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = pal.rim;
    g.lineWidth = Math.max(1.5, m * 0.004);
    g.globalAlpha = 0.8;
    g.stroke();
    g.globalAlpha = 1;
    // chimney
    g.fillStyle = pal.shadow;
    g.fillRect(mainX + mainW * 0.15, mainTop - H * 0.2, mainW * 0.08, H * 0.12);
    g.restore();

    // windows
    const wins = [
      { x: mainX + mainW * 0.12, y: mainTop + H * 0.08, w: mainW * 0.22, h: H * 0.14 },
      { x: mainX + mainW * 0.62, y: mainTop + H * 0.08, w: mainW * 0.22, h: H * 0.14 },
      { x: mainX + mainW * 0.12, y: mainTop + H * 0.3, w: mainW * 0.22, h: H * 0.13 },
      { x: towerX + towerW * 0.25, y: towerTop + H * 0.06, w: towerW * 0.5, h: H * 0.13 },
      { x: towerX + towerW * 0.25, y: towerTop + H * 0.3, w: towerW * 0.5, h: H * 0.13 },
      { x: mainX + mainW * 0.42, y: mainTop - H * 0.12, w: mainW * 0.16, h: H * 0.08 },
    ];
    wins.forEach((wn, i) => {
      const flick = 0.75 + 0.25 * noise1(t * 2 + i * 7, s.seed);
      const lit = 0.45 + 0.55 * smoothstep(0.25, 0.6, noise1(t * 0.15 + i * 3.1, s.seed + 9));
      glowAt(g, wn.x + wn.w / 2, wn.y + wn.h / 2, Math.max(wn.w, wn.h) * 1.3, pal.secondary, 0.35 * lit);
      g.fillStyle = pal.secondary;
      g.globalAlpha = (0.55 + 0.45 * flick) * lit;
      g.fillRect(wn.x, wn.y, wn.w, wn.h);
      g.globalAlpha = 1;
      // occasional ghost in the window
      const period = 7 + hash01(s.seed + i * 31) * 8;
      const ph = mod(t / period + hash01(s.seed + i * 17), 1);
      const vis = smoothstep(0.1, 0.2, ph) * (1 - smoothstep(0.4, 0.5, ph));
      if (vis > 0.01) {
        g.save();
        g.beginPath();
        g.rect(wn.x, wn.y, wn.w, wn.h);
        g.clip();
        ghost(g, wn.x + wn.w / 2, wn.y + wn.h * (1.15 - 0.55 * vis), Math.min(wn.w, wn.h * 1.4) * 0.9, {
          color: '#ffffff',
          t,
          face: FACES[i % FACES.length],
          wave: Math.sin(t * 6) * 0.6,
          glow: 0.4,
        });
        g.restore();
      }
      // frame
      g.strokeStyle = pal.shadow;
      g.lineWidth = Math.max(1.5, wn.w * 0.07);
      g.strokeRect(wn.x, wn.y, wn.w, wn.h);
      g.beginPath();
      g.moveTo(wn.x + wn.w / 2, wn.y);
      g.lineTo(wn.x + wn.w / 2, wn.y + wn.h);
      g.moveTo(wn.x, wn.y + wn.h / 2);
      g.lineTo(wn.x + wn.w, wn.y + wn.h / 2);
      g.stroke();
    });
    // door
    const dw = mainW * 0.2;
    const dh = H * 0.2;
    const dx = mainX + mainW * 0.58;
    g.fillStyle = '#3a1d0e';
    g.beginPath();
    g.moveTo(dx, groundY);
    g.lineTo(dx, groundY - dh + dw / 2);
    g.arc(dx + dw / 2, groundY - dh + dw / 2, dw / 2, Math.PI, 0);
    g.lineTo(dx + dw, groundY);
    g.fill();
    glowAt(g, dx + dw / 2, groundY - dh * 0.4, dw * 1.1, pal.primary, 0.3 + 0.1 * Math.sin(t * 2));
    g.fillStyle = pal.secondary;
    g.beginPath();
    g.arc(dx + dw * 0.8, groundY - dh * 0.45, Math.max(1, dw * 0.05), 0, TAU);
    g.fill();

    // pumpkins in front
    const psz = px(s, 0.32, 0.05, 0.14);
    const nP = Math.max(2, Math.round(Math.min(10, (w / (psz * 2.4)) * 0.55 * densityOf(s))));
    for (let i = 0; i < nP; i++) {
      const u = (i + 0.5) / nP;
      const xx = w * (0.05 + 0.9 * u);
      if (xx > dx - psz && xx < dx + dw + psz) continue;
      pumpkin(g, xx, groundY - psz * 0.4 + Math.sin(t * 2 + i) * psz * 0.03, psz, {
        pal,
        face: (i * 3 + s.seed) % 6,
        t,
        glow: 0.9,
      });
    }
    // eyes in the dark
    const eyes = countOf(s, 6, 2, 14);
    for (let i = 0; i < eyes; i++) {
      const ex = w * hash01(s.seed * 7 + i * 13);
      const ey = groundY - h * (0.02 + 0.12 * hash01(s.seed + i * 5));
      const blinkPh = mod(t * (0.3 + 0.3 * hash01(i + 99)) + hash01(i), 1);
      const open = blinkPh < 0.8 ? 1 : Math.abs(Math.cos(((blinkPh - 0.8) / 0.2) * Math.PI));
      const er = m * 0.008;
      g.fillStyle = i % 2 ? '#fff066' : pal.secondary;
      for (const sd of [-1, 1]) {
        g.beginPath();
        g.ellipse(ex + sd * er * 2.2, ey, er, er * open, 0, 0, TAU);
        g.fill();
      }
    }
    // bats crossing the sky
    const nb = countOf(s, 5, 1, 14);
    for (let i = 0; i < nb; i++) {
      const v = 0.04 + hash01(s.seed + i * 3) * 0.05;
      const dir = i % 2 ? 1 : -1;
      const u = mod(t * v + hash01(i * 11 + s.seed), 1) * 1.4 - 0.2;
      const bx = (dir > 0 ? u : 1 - u) * w;
      const by = h * (0.12 + 0.3 * hash01(i * 7 + 3)) + Math.sin(t * 2 + i) * h * 0.03;
      bat(g, bx, by, px(s, 0.35, 0.03, 0.08), Math.sin(t * 14 + i), pal);
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.035) },
);

// ---------------------------------------------------------------------------
// Skeleton Disco
// ---------------------------------------------------------------------------
const skeletonDisco: SceneModule = canvasScene('skeletonDisco', (g, s, f) => {
  const pal = palette(s.params);
  const bpm = num(s.params, 'bpm', 108);
  const t = f.time;
  const beat = (t * bpm * speedOf(s)) / 60;
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#05030b';
  g.fillRect(0, 0, w, h);
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
  // disco floor (perspective tiles)
  const floorTop = h * 0.74;
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const y0 = floorTop + ((h - floorTop) * r) / rows;
    const y1 = floorTop + ((h - floorTop) * (r + 1)) / rows;
    const cols = Math.max(4, Math.round((w / m) * 5)) + r * 2;
    for (let c = 0; c < cols; c++) {
      const idx = (c + r + Math.floor(beat)) % pal.party.length;
      const on = (c + r) % 2 === Math.floor(beat) % 2;
      g.fillStyle = pal.party[idx]!;
      g.globalAlpha = (on ? 0.22 + 0.2 * pulse : 0.07) * (0.6 + r * 0.15);
      g.fillRect((c * w) / cols + 1, y0 + 1, w / cols - 2, y1 - y0 - 2);
    }
  }
  g.globalAlpha = 1;
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
  g.restore();
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
const ghostParty: SceneModule = canvasScene(
  'ghostParty',
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    sky(g, w, h, pal);
    // string lights
    for (const k of [0, 1]) {
      const sag = h * (0.08 + k * 0.05);
      const y0 = h * (0.04 + k * 0.06);
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
        glowAt(g, u * w, yy, m * 0.03, c, 0.6 * tw);
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
  { ambientSound: (snd) => snd.ambience('drone', 0.025) },
);

// ---------------------------------------------------------------------------
// Pumpkin Magic
// ---------------------------------------------------------------------------
const pumpkinMagic: SceneModule = canvasScene('pumpkinMagic', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#05020a';
  g.fillRect(0, 0, w, h);
  glowAt(g, w / 2, h * 0.6, Math.max(w, h) * 0.6, pal.accent, 0.12);
  drawStars(g, starField(s, countOf(s, 40, 6, 100), 0.5), t, pal.secondary);
  // pumpkins
  const size = Math.min(h * 0.42, px(s, 0.55, 0.12, 0.45));
  const n = Math.max(1, Math.min(7, Math.floor(w / (size * 1.5))));
  const groundY = h * 0.84;
  // vines
  g.strokeStyle = '#2f6b2a';
  g.lineWidth = Math.max(2, m * 0.008);
  g.beginPath();
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    const yy = groundY + size * 0.36 + Math.sin(u * 18 + 1) * m * 0.015;
    if (i === 0) g.moveTo(u * w, yy);
    else g.lineTo(u * w, yy);
  }
  g.stroke();
  g.fillStyle = '#3f8a35';
  for (let i = 0; i < 14; i++) {
    const u = (i + 0.5) / 14;
    const yy = groundY + size * 0.36 + Math.sin(u * 18 + 1) * m * 0.015;
    g.beginPath();
    g.ellipse(
      u * w,
      yy - m * 0.012,
      m * 0.025,
      m * 0.012,
      (i % 2 ? 0.6 : -0.6) + Math.sin(t + i) * 0.1,
      0,
      TAU,
    );
    g.fill();
  }
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
});

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

const monsterWindows: SceneModule = canvasScene('monsterWindows', (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const m = Math.min(w, h);
  g.fillStyle = '#0a0612';
  g.fillRect(0, 0, w, h);
  // brick hints
  const brick = memo(s, 'bricks', () => {
    const rng = createRng(s.seed + 5);
    return Array.from({ length: 70 }, () => [rng() * w, rng() * h, (0.04 + rng() * 0.05) * m] as const);
  });
  g.strokeStyle = 'rgba(120,90,160,0.14)';
  g.lineWidth = Math.max(1, m * 0.003);
  for (const [bx, by, bw] of brick) g.strokeRect(bx, by, bw, bw * 0.45);

  const cols = Math.max(
    2,
    Math.min(6, Math.round(num(s.params, 'columns', 4) * Math.min(1.5, Math.max(0.5, w / h / 1.6)))),
  );
  const rows = Math.max(1, Math.min(4, Math.round(((cols * h) / w) * 1.1)));
  const cw = w / cols;
  const ch = h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = r * cols + c;
      const ww = cw * 0.62;
      const wh = ch * 0.66;
      const wx = c * cw + (cw - ww) / 2;
      const wy = r * ch + (ch - wh) / 2;
      const period = 6 + hash01(id * 13 + s.seed) * 6;
      const ph = mod(t / period + hash01(id * 7 + s.seed), 1);
      const rise = smoothstep(0.05, 0.18, ph) * (1 - smoothstep(0.62, 0.76, ph));
      const knock = ph > 0.35 && ph < 0.5 ? Math.sin(((ph - 0.35) / 0.15) * Math.PI * 6) : 0;
      const shake = knock * ww * 0.012;
      g.save();
      g.translate(shake, 0);
      // light
      const lit = 0.55 + 0.45 * noise1(t * 0.6 + id, s.seed);
      glowAt(g, wx + ww / 2, wy + wh / 2, Math.max(ww, wh) * 0.95, pal.secondary, 0.22 * lit);
      const grad = g.createLinearGradient(0, wy, 0, wy + wh);
      grad.addColorStop(0, pal.secondary);
      grad.addColorStop(1, pal.primary);
      g.fillStyle = grad;
      g.globalAlpha = 0.5 + 0.4 * lit;
      g.fillRect(wx, wy, ww, wh);
      g.globalAlpha = 1;
      // monster
      if (rise > 0.01) {
        g.save();
        g.beginPath();
        g.rect(wx, wy, ww, wh);
        g.clip();
        const ms = Math.min(ww, wh) * 0.75;
        monster(
          g,
          Math.floor(hashInts(s.seed + id, Math.floor(t / period)) % 5),
          wx + ww / 2,
          wy + wh + ms * 0.5 - rise * ms * 0.95,
          ms,
          t + id,
          ph > 0.5 && ph < 0.65 ? 1 : 0,
        );
        g.restore();
      }
      // curtains
      const open = 0.25 + 0.15 * Math.sin(t * 0.5 + id);
      g.fillStyle = pal.accent;
      g.globalAlpha = 0.55;
      for (const sd of [0, 1]) {
        const cwid = ww * open * 0.5;
        const cx = sd === 0 ? wx : wx + ww - cwid;
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
      g.globalAlpha = 1;
      // frame & crossbars
      g.strokeStyle = '#3b2547';
      g.lineWidth = Math.max(2, ww * 0.05);
      g.strokeRect(wx, wy, ww, wh);
      g.lineWidth = Math.max(1.5, ww * 0.03);
      g.beginPath();
      g.moveTo(wx + ww / 2, wy);
      g.lineTo(wx + ww / 2, wy + wh);
      g.moveTo(wx, wy + wh * 0.45);
      g.lineTo(wx + ww, wy + wh * 0.45);
      g.stroke();
      g.strokeStyle = pal.rim;
      g.globalAlpha = 0.6;
      g.lineWidth = Math.max(1, ww * 0.012);
      g.strokeRect(wx - ww * 0.04, wy - wh * 0.04, ww * 1.08, wh * 1.08);
      g.globalAlpha = 1;
      // sill
      g.fillStyle = '#3b2547';
      g.fillRect(wx - ww * 0.08, wy + wh, ww * 1.16, wh * 0.06);
      // knock lines
      if (Math.abs(knock) > 0.2) {
        g.strokeStyle = pal.secondary;
        g.lineWidth = Math.max(1.5, ww * 0.02);
        for (let k = 0; k < 3; k++) {
          const a = -0.6 + k * 0.6;
          g.beginPath();
          g.moveTo(wx + ww + Math.cos(a) * ww * 0.12, wy + wh * 0.3 + Math.sin(a) * ww * 0.12);
          g.lineTo(wx + ww + Math.cos(a) * ww * 0.25, wy + wh * 0.3 + Math.sin(a) * ww * 0.25);
          g.stroke();
        }
      }
      g.restore();
    }
  }
});

// ---------------------------------------------------------------------------
// Moonlit Graveyard (shader fog + canvas foreground)
// ---------------------------------------------------------------------------
const GRAVEYARD_FRAG = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uFog; uniform vec2 uMoon; uniform float uSpeed; uniform float uDensity;
varying vec2 vUv;
${FBM_GLSL}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  vec3 col = mix(vec3(0.03, 0.025, 0.07), vec3(0.008, 0.006, 0.02), uv.y);
  float d = length((uv - uMoon) * vec2(aspect, 1.0));
  col += vec3(1.0, 0.95, 0.8) * 0.18 * exp(-d * 5.0);
  float t = uTime * uSpeed * 0.06;
  vec2 p = vec2(uv.x * aspect * 2.2, uv.y * 5.0);
  float n = fbm(p + vec2(t, -t * 0.3) + uSeed);
  float n2 = fbm(p * 1.7 - vec2(t * 1.4, 0.0) + 3.1 + uSeed);
  float band = smoothstep(0.62, 0.0, uv.y);
  float fog = band * (0.55 * n + 0.45 * n2);
  col += uFog * fog * 0.42 * uDensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

const moonlitGraveyard: SceneModule = hybridScene(
  'moonlitGraveyard',
  GRAVEYARD_FRAG,
  (s) => {
    const pal = palette(s.params);
    return {
      uFog: new THREE.Vector3(...mixRgb(pal.rgb.ghost, pal.rgb.accent, 0.35)),
      uMoon: new THREE.Vector2(0.22, 0.78),
      uSpeed: speedOf(s),
      uDensity: Math.min(1.6, 0.6 + densityOf(s) * 0.5),
    };
  },
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const m = Math.min(w, h);
    drawStars(g, starField(s, countOf(s, 60, 8, 160), 0.45), t);
    moon(g, w * 0.22, h * 0.22, m * 0.13, t, true);
    const groundY = h * 0.86;
    // tree
    const tree = memo(s, 'tree', () =>
      treeSegments(s.seed + 3, w * 0.86, groundY, Math.min(h * 0.8, w * 0.5)),
    );
    drawTree(g, tree, pal.rim, '#0c0716', Math.sin(t * 0.6));
    // ground
    g.fillStyle = '#070410';
    g.beginPath();
    g.moveTo(0, h);
    for (let i = 0; i <= 30; i++) g.lineTo((i / 30) * w, groundY + Math.sin(i * 0.7 + s.seed) * h * 0.012);
    g.lineTo(w, h);
    g.closePath();
    g.fill();
    // fence
    const fenceH = h * 0.12;
    g.strokeStyle = '#3a3150';
    g.lineWidth = Math.max(1.5, m * 0.006);
    const posts = Math.round(w / (m * 0.05));
    g.beginPath();
    for (let i = 0; i <= posts; i++) {
      const xx = (i / posts) * w;
      g.moveTo(xx, groundY);
      g.lineTo(xx, groundY - fenceH);
    }
    g.moveTo(0, groundY - fenceH * 0.8);
    g.lineTo(w, groundY - fenceH * 0.8);
    g.moveTo(0, groundY - fenceH * 0.3);
    g.lineTo(w, groundY - fenceH * 0.3);
    g.stroke();
    // tombstones
    const ts = Math.min(h * 0.28, px(s, 0.6, 0.1, 0.28));
    const n = Math.max(2, Math.min(9, Math.floor(w / (ts * 1.6))));
    for (let i = 0; i < n; i++) {
      const x = (w * (i + 0.5)) / n + (hash01(i + s.seed) - 0.5) * ts * 0.4;
      const tw = ts * (0.55 + 0.25 * hash01(i * 3));
      const th = ts * (0.8 + 0.4 * hash01(i * 5));
      tombstone(g, x, groundY + h * 0.02, tw, th, pal, (hash01(i * 9) - 0.5) * 0.15, i + s.seed);
      // peeking ghost
      const period = 9 + hash01(i * 17 + s.seed) * 8;
      const ph = mod(t / period + hash01(i * 23), 1);
      const peek = smoothstep(0.05, 0.15, ph) * (1 - smoothstep(0.32, 0.42, ph));
      if (peek > 0.01 && i % 2 === 0) {
        g.save();
        g.beginPath();
        g.rect(x - tw, 0, tw * 2, groundY - th * 0.15);
        g.clip();
        ghost(g, x + tw * 0.35 * peek, groundY - th * 0.6 - peek * th * 0.55, tw * 0.9, {
          color: pal.ghost,
          t,
          face: 'happy',
          wave: Math.sin(t * 7) * 0.8,
          glow: 0.6,
        });
        g.restore();
        tombstone(g, x, groundY + h * 0.02, tw, th, pal, (hash01(i * 9) - 0.5) * 0.15, i + s.seed);
      }
    }
    // will-o'-wisps
    const wisps = countOf(s, 8, 2, 20);
    for (let i = 0; i < wisps; i++) {
      const x = w * (0.1 + 0.8 * noise1(t * 0.05 + i * 10, s.seed));
      const y = h * (0.5 + 0.35 * noise1(t * 0.07 + i * 5, s.seed + 1));
      const a = 0.5 + 0.5 * Math.sin(t * 2 + i);
      glowAt(g, x, y, m * 0.04, pal.secondary, 0.5 * a + 0.2);
      glowAt(g, x, y, m * 0.012, '#ffffff', 0.6 * a + 0.2);
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.04) },
);

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  k: number,
): [number, number, number] {
  return [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];
}

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
  gl_FragColor = vec4(col, 1.0);
}
`;

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
    // rune stars around the rim
    const runes = 16;
    for (let i = 0; i < runes; i++) {
      const a = (i / runes) * TAU + t * 0.25;
      star(
        g,
        cx + Math.cos(a) * R * 1.18,
        cy + Math.sin(a) * R * 1.18,
        R * 0.04,
        pal.secondary,
        0.5 + 0.5 * Math.sin(t * 2 + i),
      );
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
