import { clamp01, ease, smoothstep, TAU } from '@spectrastage/engine';
import type { EffectDrawInfo, EffectModule } from '@spectrastage/engine';
import { BOOST_RIM, palette, PALETTES } from './palette.ts';
import {
  bat,
  dancePose,
  footprint,
  fuzzySpider,
  ghost,
  glowAt,
  leaf,
  pumpkin,
  skeleton,
  spider,
  star,
  withRim,
} from './shapes.ts';

type Info = EffectDrawInfo;

/** Physical size helper for overlays. */
function size(i: Info, meters: number, minFrac = 0.04, maxFrac = 0.7): number {
  const m = Math.min(i.w, i.h);
  return Math.max(m * minFrac, Math.min(m * maxFrac, meters * i.ppm));
}

/** Overall fade envelope from progress. */
function env(i: Info, fin = 0.08, fout = 0.15): number {
  return smoothstep(0, fin, i.progress) * (1 - smoothstep(1 - fout, 1, i.progress));
}

function effect(
  id: string,
  draw: (g: CanvasRenderingContext2D, i: Info) => void,
  sound?: EffectModule['sound'],
): EffectModule {
  return { id, draw, sound };
}

const boo = effect(
  'boo',
  (g, i) => {
    const pal = palette(i.params);
    const sz = Math.min(i.h * 0.75, size(i, 1.5, 0.2, 0.75));
    const x = i.w * (0.3 + i.rng() * 0.4);
    const rise = ease.outBack(clamp01(i.progress / 0.28));
    const leave = smoothstep(0.78, 1, i.progress);
    const y = i.h + sz * 0.6 - rise * (i.h * 0.45 + sz * 0.6) - leave * i.h * 0.3;
    const pop = 1 + 0.12 * Math.sin(clamp01((i.progress - 0.3) / 0.15) * Math.PI);
    ghost(g, x, y, sz * pop, {
      color: pal.ghost,
      t: i.t,
      face: 'wow',
      wave: Math.sin(i.t * 10) * 0.8,
      alpha: 1 - leave,
      blush: '#ff9ac8',
    });
    const txtA = smoothstep(0.28, 0.36, i.progress) * (1 - smoothstep(0.75, 0.85, i.progress));
    if (txtA > 0.01) {
      const fs = sz * 0.32;
      g.save();
      g.globalAlpha = txtA;
      g.translate(x + sz * 0.55, y - sz * 0.55);
      g.rotate(-0.12);
      g.scale(1 + 0.08 * Math.sin(i.t * 8), 1 + 0.08 * Math.sin(i.t * 8));
      g.font = `900 ${Math.round(fs)}px "Comic Sans MS", "Trebuchet MS", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      glowAt(g, 0, 0, fs * 2, pal.primary, 0.5);
      g.lineWidth = fs * 0.12;
      g.strokeStyle = '#1b1030';
      g.strokeText('BOO!', 0, 0);
      g.fillStyle = pal.secondary;
      g.fillText('BOO!', 0, 0);
      g.restore();
    }
  },
  (snd) => {
    snd.whoosh({ duration: 0.8, from: 200, to: 1200, gain: 0.18 });
    snd.ooh({ duration: 1.6, base: 240, gain: 0.12, delay: 0.25 });
  },
);

const batSwarm = effect(
  'batSwarm',
  (g, i) => {
    const pal = palette(i.params);
    const n = Math.round(14 + 10 * clamp01(i.w / 1500));
    const fromLeft = i.rng() > 0.5;
    const a = env(i, 0.05, 0.1);
    const bs = size(i, 0.35, 0.03, 0.09);
    for (let k = 0; k < n; k++) {
      const delay = i.rng() * 0.35;
      const speed = 0.8 + i.rng() * 0.5;
      const lane = 0.1 + i.rng() * 0.75;
      const amp = 0.03 + i.rng() * 0.08;
      const ph = i.rng() * TAU;
      const sc = 0.7 + i.rng() * 0.6;
      const p = (i.progress - delay) * speed * 1.6;
      if (p < 0 || p > 1.3) continue;
      const u = p * 1.25 - 0.12;
      const x = (fromLeft ? u : 1 - u) * i.w;
      const y = i.h * (lane + Math.sin(p * 9 + ph) * amp - p * 0.12);
      const boost = i.boost ?? 0;
      withRim(g, bs * sc, boost, BOOST_RIM, () => bat(g, x, y, bs * sc, Math.sin(i.t * 16 + ph), pal, a));
    }
  },
  (snd) => snd.flutter({ duration: 2.4, gain: 0.12, rate: 16 }),
);

const pumpkinBurst = effect(
  'pumpkinBurst',
  (g, i) => {
    const pal = palette(i.params);
    const cx = i.w * (0.3 + i.rng() * 0.4);
    const cy = i.h * (0.4 + i.rng() * 0.25);
    const ps = size(i, 0.6, 0.12, 0.4);
    const grow = ease.outBack(clamp01(i.t / 0.5));
    const popT = 0.75;
    if (i.t < popT) {
      const shake = i.t > 0.5 ? Math.sin(i.t * 60) * ps * 0.03 : 0;
      pumpkin(g, cx + shake, cy, ps * grow * (1 + (i.t > 0.5 ? (i.t - 0.5) * 0.4 : 0)), {
        pal,
        face: 5,
        t: i.t,
        glow: 1.3,
      });
      return;
    }
    const dt = i.t - popT;
    const fade = 1 - smoothstep(0.6, 1, i.progress);
    glowAt(g, cx, cy, ps * (1.2 + dt * 2), pal.secondary, Math.max(0, 0.7 - dt));
    const n = 14;
    const grav = i.h * 0.9;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + i.rng() * 0.3;
      const v = i.h * (0.45 + i.rng() * 0.45);
      const x = cx + Math.cos(a) * v * dt;
      const y = cy + Math.sin(a) * v * dt + 0.5 * grav * dt * dt;
      if (k % 2 === 0) pumpkin(g, x, y, ps * 0.28, { pal, face: k % 6, t: i.t, glow: 0.6, alpha: fade });
      else star(g, x, y, ps * 0.12, k % 4 === 1 ? pal.secondary : pal.accent, fade);
    }
    for (let k = 0; k < 24; k++) {
      const a = i.rng() * TAU;
      const v = i.h * (0.2 + i.rng() * 0.6);
      star(
        g,
        cx + Math.cos(a) * v * dt,
        cy + Math.sin(a) * v * dt + 0.3 * grav * dt * dt,
        ps * 0.05,
        '#ffffff',
        fade * (1 - dt / 3),
      );
    }
  },
  (snd) => {
    snd.pop({ freq: 300, gain: 0.25, delay: 0.75 });
    snd.chime({ notes: [523, 659, 784, 1047, 1319], gain: 0.06, spacing: 0.06, delay: 0.78 });
  },
);

const gentleLightning = effect(
  'gentleLightning',
  (g, i) => {
    const pal = palette(i.params);
    // Two slow, soft glows: ≥0.45 s rise, long decay. Never a hard flash (child-safe).
    const pulse = (t0: number, rise: number, decay: number, peak: number) => {
      const t = i.t - t0;
      if (t < 0) return 0;
      return t < rise ? peak * ease.inOutSine(t / rise) : peak * Math.exp(-(t - rise) / decay);
    };
    const a = pulse(0.1, 0.5, 0.45, 1) + pulse(1.3, 0.45, 0.4, 0.6);
    const fade = 1 - smoothstep(0.85, 1, i.progress);
    const lvl = a * fade;
    if (lvl < 0.005) return;
    g.save();
    g.globalCompositeOperation = 'lighter';
    const grad = g.createLinearGradient(0, 0, 0, i.h);
    grad.addColorStop(0, `rgba(190,210,255,${0.26 * lvl})`);
    grad.addColorStop(1, `rgba(190,210,255,${0.06 * lvl})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, i.w, i.h);
    // soft bolt
    const x0 = i.w * (0.25 + i.rng() * 0.5);
    const pts: [number, number][] = [[x0, 0]];
    let x = x0;
    const segs = 9;
    for (let k = 1; k <= segs; k++) {
      x += (i.rng() - 0.5) * i.w * 0.08;
      pts.push([x, (i.h * 0.7 * k) / segs]);
    }
    g.strokeStyle = pal.ghost;
    g.lineJoin = 'round';
    g.shadowColor = '#9fc0ff';
    g.shadowBlur = Math.min(i.w, i.h) * 0.05;
    for (const [lw, al] of [
      [Math.min(i.w, i.h) * 0.02, 0.25],
      [Math.min(i.w, i.h) * 0.006, 0.7],
    ] as const) {
      g.lineWidth = lw;
      g.globalAlpha = al * lvl;
      g.beginPath();
      pts.forEach(([px, py], k) => (k === 0 ? g.moveTo(px, py) : g.lineTo(px, py)));
      g.stroke();
    }
    g.restore();
  },
  (snd) => snd.rumble({ duration: 3, gain: 0.2, delay: 0.5 }),
);

const spiderRush = effect(
  'spiderRush',
  (g, i) => {
    const pal = palette(i.params);
    const n = 10;
    const ss = size(i, 0.35, 0.04, 0.12);
    const dirRight = i.rng() > 0.5;
    const a = env(i, 0.04, 0.08);
    for (let k = 0; k < n; k++) {
      const delay = i.rng() * 0.4;
      const speed = 0.9 + i.rng() * 0.6;
      const lane = 0.08 + i.rng() * 0.84;
      const wig = i.rng() * TAU;
      const p = (i.progress - delay) * speed * 1.7;
      if (p < 0 || p > 1.2) continue;
      const u = p * 1.2 - 0.1;
      const x = (dirRight ? u : 1 - u) * i.w;
      const y = i.h * lane + Math.sin(p * 20 + wig) * ss * 0.3;
      g.save();
      g.globalAlpha = a;
      g.translate(x, y);
      g.rotate((dirRight ? 0 : Math.PI) + Math.cos(p * 20 + wig) * 0.2);
      const sz = ss * (0.8 + (0.4 * ((k * 37) % 10)) / 10);
      const boost = i.boost ?? 0;
      if (boost > 0 || pal === PALETTES.neon)
        fuzzySpider(g, sz, i.t * 30 + k, Math.max(0.15, boost), BOOST_RIM, pal.secondary, k);
      else spider(g, sz, i.t * 30 + k, pal);
      g.restore();
    }
  },
  (snd) => snd.scuttle({ duration: 2.2, gain: 0.05 }),
);

const ghostWave = effect(
  'ghostWave',
  (g, i) => {
    const pal = palette(i.params);
    const gs = Math.min(i.h * 0.45, size(i, 0.7, 0.1, 0.45));
    const n = Math.max(3, Math.min(14, Math.round(i.w / (gs * 0.95))));
    for (let k = 0; k < n; k++) {
      const local = i.progress * 1.8 - (k / n) * 0.8;
      const rise = Math.sin(clamp01(local) * Math.PI);
      if (rise <= 0.01) continue;
      const x = ((k + 0.5) / n) * i.w;
      const y = i.h + gs * 0.6 - rise * (gs * 1.3 + i.h * 0.15);
      ghost(g, x, y, gs, {
        color: pal.ghost,
        t: i.t + k,
        face: k % 2 ? 'happy' : 'oo',
        wave: rise,
        alpha: Math.min(1, rise * 1.5),
      });
    }
  },
  (snd) => {
    snd.ooh({ duration: 1.2, base: 200, gain: 0.08 });
    snd.ooh({ duration: 1.2, base: 260, gain: 0.07, delay: 0.6 });
    snd.ooh({ duration: 1.4, base: 330, gain: 0.06, delay: 1.2 });
  },
);

const LEAF_COLORS = ['#ff8a1f', '#ffc23d', '#e2492f', '#c46a1b', '#a9c23f'];
const confettiLeaves = effect(
  'confettiLeaves',
  (g, i) => {
    const n = Math.round(30 + 30 * clamp01((i.w * i.h) / (1920 * 1080)));
    const fade = 1 - smoothstep(0.8, 1, i.progress);
    const ls = size(i, 0.12, 0.012, 0.05);
    for (let k = 0; k < n; k++) {
      const delay = i.rng() * 1.5;
      const v = 0.18 + i.rng() * 0.18;
      const x0 = i.rng();
      const sw = i.rng() * TAU;
      const spin = (i.rng() - 0.5) * 6;
      const col = LEAF_COLORS[k % LEAF_COLORS.length]!;
      const t = i.t - delay;
      if (t < 0) continue;
      const y = -ls + t * v * i.h;
      if (y > i.h + ls) continue;
      const x = x0 * i.w + Math.sin(t * 1.8 + sw) * i.w * 0.04;
      g.save();
      g.translate(x, y);
      g.rotate(t * spin + sw);
      g.scale(1, 0.5 + 0.5 * Math.cos(t * 3 + sw));
      leaf(g, 0, 0, ls * 1.9, 0, col, 0.9 * fade, 0);
      g.restore();
    }
  },
  (snd) => snd.whoosh({ duration: 2.5, from: 400, to: 900, gain: 0.12 }),
);

const sparkles = effect(
  'sparkles',
  (g, i) => {
    const pal = palette(i.params);
    const n = Math.round(40 + 40 * clamp01((i.w * i.h) / (1920 * 1080)));
    const m = Math.min(i.w, i.h);
    for (let k = 0; k < n; k++) {
      const x = i.rng() * i.w;
      const y = i.rng() * i.h;
      const at = i.rng() * (i.duration - 0.8);
      const life = 0.5 + i.rng() * 0.5;
      const t = (i.t - at) / life;
      if (t < 0 || t > 1) continue;
      const a = Math.sin(t * Math.PI);
      const c = k % 3 === 0 ? pal.secondary : k % 3 === 1 ? pal.ghost : pal.accent;
      glowAt(g, x, y, m * 0.05 * a, c, 0.55 * a);
      star(g, x, y, m * 0.026 * (0.5 + a), c, a);
    }
  },
  (snd) => snd.chime({ notes: [1319, 1568, 1760, 2093, 1568, 2349], gain: 0.05, spacing: 0.18 }),
);

const windowKnock = effect(
  'windowKnock',
  (g, i) => {
    const pal = palette(i.params);
    const ws = Math.min(i.h * 0.55, size(i, 1.0, 0.15, 0.55));
    const cx = i.w * (0.25 + i.rng() * 0.5);
    const cy = i.h * (0.35 + i.rng() * 0.25);
    const a = env(i, 0.12, 0.2);
    const knocks = [0.5, 0.75, 1.0, 1.7, 1.95];
    let shake = 0;
    let ring = -1;
    for (const k of knocks) {
      const d = i.t - k;
      if (d >= 0 && d < 0.18) shake = Math.sin(d * 80) * (1 - d / 0.18);
      if (d >= 0 && d < 0.4) ring = d / 0.4;
    }
    g.save();
    g.globalAlpha = a;
    g.translate(cx + shake * ws * 0.02, cy);
    glowAt(g, 0, 0, ws * 1.1, pal.secondary, 0.4);
    // warm window light, brightest in the middle
    const wg = g.createRadialGradient(0, -ws * 0.05, 0, 0, 0, ws * 0.62);
    wg.addColorStop(0, '#fff6d8');
    wg.addColorStop(0.45, pal.secondary);
    wg.addColorStop(1, pal.primary);
    g.fillStyle = wg;
    g.globalAlpha = a * 0.85;
    g.fillRect(-ws * 0.4, -ws * 0.5, ws * 0.8, ws);
    g.globalAlpha = a;
    // knocking fist + forearm silhouette with a warm rim from the window light
    const hx = ws * 0.05;
    const hy = -ws * 0.05;
    const k = 1 + shake * 0.05;
    const hand = new Path2D();
    hand.moveTo(hx - ws * 0.09, hy + ws * 0.06);
    hand.lineTo(hx - ws * 0.12, ws * 0.5);
    hand.lineTo(hx + ws * 0.12, ws * 0.5);
    hand.lineTo(hx + ws * 0.09, hy + ws * 0.06);
    hand.closePath();
    hand.roundRect(hx - ws * 0.13 * k, hy - ws * 0.11 * k, ws * 0.26 * k, ws * 0.2 * k, ws * 0.08 * k);
    for (let f = 0; f < 4; f++) {
      const fx = hx - ws * 0.095 + f * ws * 0.063;
      hand.moveTo(fx + ws * 0.04, hy - ws * 0.105);
      hand.arc(fx, hy - ws * 0.105, ws * 0.04, 0, TAU);
    }
    hand.ellipse(hx + ws * 0.115, hy + ws * 0.005, ws * 0.045, ws * 0.07, -0.4, 0, TAU);
    g.save();
    g.shadowColor = pal.secondary;
    g.shadowBlur = ws * 0.04;
    g.fillStyle = '#140a22';
    g.fill(hand);
    g.restore();
    g.strokeStyle = '#3b2547';
    g.lineWidth = ws * 0.05;
    g.strokeRect(-ws * 0.4, -ws * 0.5, ws * 0.8, ws);
    g.lineWidth = ws * 0.025;
    g.beginPath();
    g.moveTo(0, -ws * 0.5);
    g.lineTo(0, ws * 0.5);
    g.moveTo(-ws * 0.4, -ws * 0.05);
    g.lineTo(ws * 0.4, -ws * 0.05);
    g.stroke();
    if (ring >= 0) {
      g.strokeStyle = pal.secondary;
      g.lineWidth = ws * 0.02;
      g.globalAlpha = a * (1 - ring);
      for (let k = 0; k < 5; k++) {
        const ang = -Math.PI / 2 + (k - 2) * 0.45;
        const r0 = ws * (0.55 + ring * 0.1);
        const r1 = ws * (0.68 + ring * 0.2);
        g.beginPath();
        g.moveTo(Math.cos(ang) * r0, Math.sin(ang) * r0);
        g.lineTo(Math.cos(ang) * r1, Math.sin(ang) * r1);
        g.stroke();
      }
    }
    g.restore();
  },
  (snd) => {
    snd.knock({ count: 3, gain: 0.3, spacing: 0.25, delay: 0.5 });
    snd.knock({ count: 2, gain: 0.3, spacing: 0.25, delay: 1.7 });
  },
);

const skeletonDanceBreak = effect(
  'skeletonDanceBreak',
  (g, i) => {
    const pal = palette(i.params);
    const sz = Math.min(i.h * 0.7, size(i, 1.2, 0.2, 0.7));
    const n = Math.max(1, Math.min(4, Math.floor(i.w / (sz * 0.6))));
    const inT = ease.outCubic(clamp01(i.progress / 0.15));
    const outT = smoothstep(0.85, 1, i.progress);
    const beat = i.t * 1.9;
    for (let k = 0; k < n; k++) {
      const x = ((k + 0.5) / n) * i.w;
      const y = i.h - sz / 2 - i.h * 0.03 + (1 - inT + outT) * (sz + i.h * 0.05);
      skeleton(
        g,
        x,
        y,
        sz,
        dancePose(beat + k * 0.5, k + Math.floor(beat / 4)),
        pal.ghost,
        pal.party[k % pal.party.length],
      );
    }
  },
  (snd) => {
    for (let k = 0; k < 4; k++)
      snd.arpeggio({ notes: [262, 330, 392, 330], gain: 0.06, step: 0.13, wave: 'square', delay: k * 0.55 });
  },
);

const magicCircle = effect(
  'magicCircle',
  (g, i) => {
    const pal = palette(i.params);
    const m = Math.min(i.w, i.h);
    const cx = i.w * (0.35 + i.rng() * 0.3);
    const cy = i.h * (0.4 + i.rng() * 0.2);
    const R = Math.min(m * 0.42, size(i, 1.2, 0.15, 0.42));
    const draw = ease.outCubic(clamp01(i.progress / 0.4));
    const fade = 1 - smoothstep(0.8, 1, i.progress);
    const rot = i.t * 0.5;
    g.save();
    g.translate(cx, cy);
    g.globalAlpha = fade;
    glowAt(g, 0, 0, R * 1.6, pal.accent, 0.35 * draw);
    g.shadowColor = pal.accent;
    g.shadowBlur = R * 0.08;
    g.strokeStyle = pal.secondary;
    g.lineWidth = Math.max(1.5, R * 0.02);
    for (const rr of [1, 0.82]) {
      g.beginPath();
      g.arc(0, 0, R * rr, rot, rot + draw * TAU);
      g.stroke();
    }
    // star polygon
    g.strokeStyle = pal.accent;
    g.beginPath();
    const pts = 5;
    const sd = clamp01((i.progress - 0.15) / 0.35);
    for (let k = 0; k <= Math.floor(sd * pts * 2); k++) {
      const a = -rot + (k * 2 * TAU) / pts - Math.PI / 2;
      const x = Math.cos(a) * R * 0.8;
      const y = Math.sin(a) * R * 0.8;
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.shadowBlur = 0;
    // runes
    const runes = 12;
    g.fillStyle = pal.secondary;
    g.font = `${Math.round(R * 0.1)}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const glyphs = '✶✷☾✦☽✧★✹✺✵✸✴';
    for (let k = 0; k < runes; k++) {
      if (k / runes > draw) break;
      const a = rot + (k / runes) * TAU;
      g.fillText(glyphs[k % glyphs.length]!, Math.cos(a) * R * 0.91, Math.sin(a) * R * 0.91);
    }
    g.restore();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + i.t;
      const rr = R * (0.3 + 0.7 * ((i.t * 0.4 + k / 16) % 1));
      star(
        g,
        cx + Math.cos(a) * rr,
        cy + Math.sin(a) * rr - i.t * R * 0.05,
        R * 0.03,
        pal.ghost,
        fade * draw,
      );
    }
  },
  (snd) => snd.chime({ notes: [392, 523, 659, 784, 1047, 1319, 1568], gain: 0.05, spacing: 0.12 }),
);

const footprintChase = effect(
  'footprintChase',
  (g, i) => {
    const pal = palette(i.params);
    const fs = size(i, 0.26, 0.03, 0.12);
    const horizontal = i.w >= i.h;
    const L = horizontal ? i.w : i.h;
    const S = horizontal ? i.h : i.w;
    const lane = S * (0.3 + i.rng() * 0.4);
    const amp = S * (0.08 + i.rng() * 0.12);
    const dir = i.rng() > 0.5 ? 1 : -1;
    const steps = Math.ceil(L / (fs * 0.75)) + 2;
    const head = i.progress * 1.15 * steps;
    const fade = 1 - smoothstep(0.85, 1, i.progress);
    const posAt = (k: number) => {
      const u = k / steps;
      const a = dir > 0 ? u * L : L - u * L;
      const b = lane + Math.sin(u * TAU * 1.3) * amp;
      const du = 1 / steps;
      const a2 = dir > 0 ? (u + du) * L : L - (u + du) * L;
      const b2 = lane + Math.sin((u + du) * TAU * 1.3) * amp;
      const ang = Math.atan2(b2 - b, a2 - a);
      return horizontal ? { x: a, y: b, ang } : { x: b, y: a, ang: Math.PI / 2 - ang };
    };
    for (let k = 0; k < Math.min(steps, Math.floor(head)); k++) {
      const p = posAt(k);
      const age = head - k;
      const left = k % 2 === 0;
      const off = (left ? -1 : 1) * fs * 0.3;
      const x = p.x + Math.cos(p.ang + Math.PI / 2) * off;
      const y = p.y + Math.sin(p.ang + Math.PI / 2) * off;
      footprint(g, x, y, fs, p.ang + Math.PI / 2, left, pal.ghost, fade * clamp01(1.2 - age / 18));
    }
    if (head < steps) {
      const p = posAt(head);
      ghost(g, p.x, p.y - fs * 0.8, fs * 2.2, {
        color: pal.ghost,
        t: i.t,
        face: 'oo',
        wave: 0.6,
        mirror: Math.cos(p.ang) < 0,
        alpha: fade,
      });
    }
  },
  (snd) => {
    for (let k = 0; k < 8; k++) snd.pop({ freq: 220 + (k % 2) * 40, gain: 0.05, delay: k * 0.35 });
  },
);

export const effects: EffectModule[] = [
  boo,
  batSwarm,
  pumpkinBurst,
  gentleLightning,
  spiderRush,
  ghostWave,
  confettiLeaves,
  sparkles,
  windowKnock,
  skeletonDanceBreak,
  magicCircle,
  footprintChase,
];
