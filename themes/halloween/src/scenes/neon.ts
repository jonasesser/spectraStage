/**
 * Neon / high-contrast scenes: large bright saturated areas and dark silhouettes, so the show
 * stays readable at dusk when it is not fully dark yet. Slow color motion only – no flashing.
 */
import * as THREE from 'three';
import { createRng } from '@spectrastage/shared';
import { clamp01, hash01, hybridScene, memo, noise1, TAU } from '@spectrastage/engine';
import type { DrawState, SceneModule } from '@spectrastage/engine';
import { num, palette } from '../palette.ts';
import {
  bat,
  dancePose,
  fuzzySpider,
  ghost,
  leaf,
  pawPrint,
  pumpkin,
  px,
  skeleton,
  star,
  type GhostFace,
} from '../shapes.ts';
import { countOf, densityOf, isSidePart, mod, speedOf } from './common.ts';
import { FBM_GLSL } from './glsl.ts';
import { addGlow, envPalette, lightPool, offscreen, paintLeaf, SKY_FRAG, skyUniforms } from './env.ts';
import { backdrop, drawManor, MOON_POS } from './manor.ts';

const FACES: GhostFace[] = ['happy', 'oo', 'wow', 'sleepy'];
export const LIME = '#7dff4d';

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Shader colors: A = purple base, B = warm glow, C = green accent. */
export function neonUniforms(s: DrawState) {
  const pal = palette(s.params);
  const green = pal.party[1] ?? LIME;
  return {
    uA: new THREE.Vector3(...pal.rgb.accent),
    uB: new THREE.Vector3(...pal.rgb.primary),
    uC: new THREE.Vector3(...hexRgb(green)),
    uSpeed: speedOf(s),
    uDensity: densityOf(s),
  };
}

const HEADER = /* glsl */ `
uniform float uTime; uniform vec2 uRes; uniform float uSeed;
uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uSpeed; uniform float uDensity;
varying vec2 vUv;
${FBM_GLSL}
`;

// ---------------------------------------------------------------------------
// Neon Manor (wall)
// ---------------------------------------------------------------------------
/** Neon scenes default to the neon environment unless another (non-classic) mood is chosen. */
function neonEnv(s: DrawState) {
  const mood = String(s.params.mood ?? 'neon');
  return envPalette({ mood: mood === 'classic' ? 'neon' : mood });
}

const neonManor: SceneModule = hybridScene(
  'neonManor',
  SKY_FRAG,
  (s) => skyUniforms(s, neonEnv(s), { moon: MOON_POS, moonR: 0.1, horizonY: 0.25, clouds: 1.1 }, speedOf(s)),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = neonEnv(s);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    // bats
    const nb = countOf(s, 4, 2, 8);
    for (let i = 0; i < nb; i++) {
      const period = 14 + hash01(i * 7 + 1) * 8;
      const u = mod(t / period + hash01(i * 3), 1);
      const x = -0.1 * w + u * 1.2 * w;
      const y = h * (0.1 + 0.22 * hash01(i * 5)) + Math.sin(u * TAU * 3 + i) * h * 0.04;
      bat(g, x, y, px(s, 0.5, 0.04, 0.1), Math.sin(t * 8 + i * 2), pal);
    }
    const L = drawManor(g, s, env, t, { fog: 1.2 });
    // big friendly ghosts floating around the house
    const ng = countOf(s, 4, 2, 6);
    const spots = [
      [0.12, 0.42],
      [0.88, 0.5],
      [0.22, 0.2],
      [0.66, 0.14],
      [0.36, 0.34],
      [0.8, 0.3],
    ] as const;
    for (let i = 0; i < Math.min(ng, spots.length); i++) {
      const side = spots[i]![0] < 0.5 ? -1 : 1;
      const x = w * spots[i]![0] + Math.sin(t * 0.35 + i * 1.7) * w * 0.04;
      const y = h * spots[i]![1] + Math.sin(t * 0.8 + i) * h * 0.04;
      const size = Math.min(h * 0.26, px(s, 1.0, 0.1, 0.3)) * (i < 2 ? 1 : 0.65);
      ghost(g, x, y, size, {
        color: pal.ghost,
        t: t + i,
        face: FACES[i % 4],
        wave: Math.sin(t * 2 + i) * 0.6,
        glow: 1.4,
        mirror: side > 0,
        blush: '#ff9ac8',
      });
    }
    // pumpkins along the front
    const np = countOf(s, 6, 3, 10);
    for (let i = 0; i < np; i++) {
      const x = w * ((i + 0.5) / np);
      if (Math.abs(x - L.doorX) < L.manor.door.w * 2.5) continue;
      const size = Math.min(h * 0.14, px(s, 0.45, 0.05, 0.16)) * (0.8 + 0.4 * hash01(i * 17));
      pumpkin(g, x, h * 0.955 - size * 0.2, size, {
        pal,
        face: i % 6,
        glow: 1.2 + 0.2 * Math.sin(t * 1.5 + i),
        t: t + i,
      });
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.03), shaderScale: 0.5 },
);

// ---------------------------------------------------------------------------
// Neon Party (wall)
// ---------------------------------------------------------------------------
/** Cached wooden party stage with front fascia and bunting. */
function partyStage(s: DrawState, floorY: number, party: string[]) {
  return memo(s, 'stage', () => {
    const { w, h } = s;
    const { c, g } = offscreen(w, h);
    const sh = h - floorY;
    // plank deck
    const deck = g.createLinearGradient(0, floorY, 0, floorY + sh * 0.45);
    deck.addColorStop(0, '#5a2e7a');
    deck.addColorStop(1, '#2a0f45');
    g.fillStyle = deck;
    g.fillRect(0, floorY, w, sh * 0.45);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 1; k < 4; k++) g.fillRect(0, floorY + (sh * 0.45 * k) / 4, w, Math.max(1, sh * 0.012));
    const pw = Math.max(20, h * 0.12);
    for (let x = 0, r = 0; x < w; x += pw, r++) {
      for (let k = 0; k < 4; k++) {
        const xx = x + ((k % 2) * pw) / 2;
        g.fillRect(xx, floorY + (sh * 0.45 * k) / 4, Math.max(1, sh * 0.01), (sh * 0.45) / 4);
      }
    }
    // stage lip highlight
    g.fillStyle = '#c77dff';
    g.fillRect(0, floorY + sh * 0.45, w, Math.max(2, sh * 0.04));
    // fascia
    const fas = g.createLinearGradient(0, floorY + sh * 0.49, 0, h);
    fas.addColorStop(0, '#22093f');
    fas.addColorStop(1, '#0c0218');
    g.fillStyle = fas;
    g.fillRect(0, floorY + sh * 0.49, w, h);
    // bunting
    const n = Math.max(8, Math.round(w / (sh * 0.5)));
    for (let i = 0; i < n; i++) {
      const x0 = (i / n) * w;
      const x1 = ((i + 1) / n) * w;
      g.fillStyle = party[i % party.length]!;
      g.beginPath();
      g.moveTo(x0 + 2, floorY + sh * 0.5);
      g.lineTo(x1 - 2, floorY + sh * 0.5);
      g.lineTo((x0 + x1) / 2, floorY + sh * 0.92);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.25)';
      g.beginPath();
      g.moveTo(x0 + 2, floorY + sh * 0.5);
      g.lineTo((x0 + x1) / 2, floorY + sh * 0.5);
      g.lineTo((x0 + x1) / 2, floorY + sh * 0.92);
      g.closePath();
      g.fill();
    }
    return c;
  });
}

const neonParty: SceneModule = hybridScene(
  'neonParty',
  SKY_FRAG,
  (s) =>
    skyUniforms(s, neonEnv(s), { moon: [0.85, 0.14], moonR: 0.07, horizonY: 0.4, clouds: 1 }, speedOf(s)),
  (g, s, f) => {
    const pal = palette(s.params);
    const env = neonEnv(s);
    const t = f.time;
    const beat = (t * num(s.params, 'bpm', 108) * speedOf(s)) / 60;
    const { w, h } = s;
    const floorY = h * 0.84;
    g.drawImage(
      backdrop(s, env, {
        manor: isSidePart(s) ? undefined : [0.18, 0.22],
        horizon: 0.62,
        ground: 0.8,
        trees: true,
      }),
      0,
      0,
    );
    // string lights between the trees
    for (let row = 0; row < 2; row++) {
      const y0 = h * (0.12 + row * 0.08);
      const sag = h * (0.08 + row * 0.03);
      g.strokeStyle = '#12051f';
      g.lineWidth = Math.max(1.5, h * 0.004);
      g.beginPath();
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const y = y0 + Math.sin(u * Math.PI * 2) ** 2 * sag;
        if (i === 0) g.moveTo(u * w, y);
        else g.lineTo(u * w, y);
      }
      g.stroke();
      const nbulbs = Math.max(10, Math.round(w / Math.max(18, h * 0.06)));
      for (let i = 0; i < nbulbs; i++) {
        const u = (i + 0.5) / nbulbs;
        const y = y0 + Math.sin(u * Math.PI * 2) ** 2 * sag + h * 0.012;
        const col = pal.party[(i + row) % pal.party.length]!;
        const a = 0.75 + 0.25 * Math.sin(t * 1.5 + i * 0.9 + row);
        addGlow(g, u * w, y, h * 0.04, col, a * 0.8);
        g.fillStyle = col;
        g.beginPath();
        g.ellipse(u * w, y, h * 0.008, h * 0.013, 0, 0, TAU);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.7)';
        g.beginPath();
        g.ellipse(u * w - h * 0.002, y - h * 0.004, h * 0.003, h * 0.005, 0, 0, TAU);
        g.fill();
      }
    }
    g.drawImage(partyStage(s, floorY, pal.party), 0, 0);
    // colored spotlight pools on the stage, swaying slowly with the beat
    for (let i = 0; i < 4; i++) {
      const x = w * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(t * 0.35 + i * 1.7)));
      const col = pal.party[i % pal.party.length]!;
      lightPool(
        g,
        x,
        floorY + (h - floorY) * 0.22,
        h * 0.22,
        h * 0.05,
        col,
        0.55 + 0.15 * Math.sin(beat * Math.PI + i),
      );
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = 0.07;
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(w * (0.2 + i * 0.2), 0);
      g.lineTo(x - h * 0.2, floorY + (h - floorY) * 0.22);
      g.lineTo(x + h * 0.2, floorY + (h - floorY) * 0.22);
      g.closePath();
      g.fill();
      g.restore();
    }
    // ghosts in the air
    const ng = countOf(s, 3, 2, 5);
    for (let i = 0; i < ng; i++) {
      const x = w * ((i + 0.5) / ng) + Math.sin(t * 0.4 + i * 2) * w * 0.06;
      const y = h * 0.27 + Math.sin(t * 0.9 + i * 1.3) * h * 0.05;
      ghost(g, x, y, Math.min(h * 0.24, px(s, 0.9, 0.1, 0.26)), {
        color: pal.ghost,
        t: t + i,
        face: FACES[(i + 1) % 4],
        wave: Math.sin(beat * Math.PI + i) * 0.9,
        glow: 1.4,
        mirror: i % 2 === 1,
        blush: '#ff9ac8',
      });
    }
    // skeletons + pumpkins
    const ns = countOf(s, 4, 2, 6);
    const size = Math.min(h * 0.44, px(s, 1.3, 0.15, 0.48));
    for (let i = 0; i < ns; i++) {
      const x = w * ((i + 0.5) / ns);
      skeleton(
        g,
        x,
        floorY - size / 2,
        size,
        dancePose(beat / 2 + i * 0.25, i),
        '#ffffff',
        pal.party[i % pal.party.length],
      );
      if (i < ns - 1) {
        const pxs = w * ((i + 1) / ns);
        const ps = size * 0.3;
        pumpkin(g, pxs, floorY - ps * 0.42, ps, {
          pal,
          face: (i * 2) % 6,
          glow: 1.3,
          t: t + i,
          squash: Math.max(0, Math.sin(beat * Math.PI * 2)) * 0.4,
        });
      }
    }
  },
);

// ---------------------------------------------------------------------------
// Neon Fog (floor)
// ---------------------------------------------------------------------------
export const FOG_FRAG = /* glsl */ `
${HEADER}
float fbm3(vec2 p) {
  float v = 0.5 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.25 * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2);
  v += 0.125 * vnoise(p);
  return v / 0.875;
}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed * 0.035;
  vec2 p = vec2(uv.x * aspect, uv.y) * 2.0;
  float dens = clamp(uDensity, 0.3, 1.6);
  // domain-warped billows (4 x 3 octaves)
  vec2 q = vec2(fbm3(p + t + uSeed), fbm3(p + vec2(5.2, 1.3) - t));
  float f = fbm3(p + 2.4 * q + vec2(1.7, 9.2) + t * 1.5);
  float f2 = fbm3(p * 2.1 - q * 1.3 + vec2(t * 2.0, 0.0) + 4.0);
  vec3 col = mix(uA * 0.32, uA * 1.1, smoothstep(0.2, 0.85, f));
  // billow tops catch light, valleys stay deep
  col += vec3(0.95, 0.8, 1.0) * pow(smoothstep(0.55, 0.9, f), 2.0) * 0.5;
  col = mix(col, uC * 0.9, smoothstep(0.6, 0.92, q.x) * 0.55 * dens);
  col = mix(col, uB, smoothstep(0.66, 1.0, q.y) * 0.35 * dens);
  // near layer: brighter wisps drifting faster
  col += mix(uA, vec3(1.0), 0.45) * smoothstep(0.6, 0.92, f2) * 0.22 * dens;
  vec2 v = uv - 0.5;
  col *= 1.0 - dot(v, v) * 0.5;
  col = max(col, uA * 0.3);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const neonFog: SceneModule = hybridScene(
  'neonFog',
  FOG_FRAG,
  neonUniforms,
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const { w, h } = s;
    const paw = px(s, 0.18, 0.025, 0.06);
    // paw print trails
    const trails = countOf(s, 3, 2, 5);
    for (let k = 0; k < trails; k++) {
      const period = 16;
      const prog = mod(t / period + k / trails, 1) * 1.5;
      const steps = 18;
      const x0 = hash01(k * 31 + 1);
      const y0 = hash01(k * 31 + 2);
      for (let j = 0; j < steps; j++) {
        const u = j / steps;
        const age = prog - u;
        if (age < 0 || age > 0.6) continue;
        const a = clamp01(age * 8) * clamp01((0.6 - age) * 4);
        const cx = (x0 * 0.6 + 0.2 + Math.sin(u * 3 + k) * 0.25) * w;
        const cy = (y0 * 0.2 + u * 0.75 + 0.02) * h;
        const ang = Math.atan2(h * 0.75, Math.cos(u * 3 + k) * 0.75 * w) - Math.PI / 2 + Math.PI;
        const side = j % 2 === 0 ? -1 : 1;
        const ox = Math.cos(ang) * paw * 0.45 * side;
        const oy = Math.sin(ang) * paw * 0.45 * side;
        pawPrint(g, cx + ox, cy + oy, paw, ang + Math.PI, LIME, a);
      }
    }
    // drifting leaves
    const nl = countOf(s, 14, 5, 30);
    for (let i = 0; i < nl; i++) {
      const vx = 0.012 + hash01(i * 5) * 0.02;
      const x = (mod(hash01(i * 7) + t * vx, 1.2) - 0.1) * w;
      const y = (hash01(i * 9) + 0.04 * Math.sin(t * 0.5 + i)) * h;
      const col = i % 3 === 0 ? '#ffb13b' : pal.primary;
      leaf(g, x, y, px(s, 0.2, 0.03, 0.07), t * (0.4 + hash01(i) * 0.6) + i, col, 0.9);
    }
    // little ghosts
    const ng = countOf(s, 2, 1, 4);
    for (let i = 0; i < ng; i++) {
      const cyc = 12 + i * 3;
      const u = mod(t / cyc + i * 0.37, 1);
      const a = Math.sin(u * Math.PI);
      const x = w * (0.15 + 0.7 * hash01(i * 3 + Math.floor(t / cyc + i * 0.37)));
      const y = h * (0.2 + 0.6 * hash01(i * 5 + Math.floor(t / cyc + i * 0.37))) - u * h * 0.08;
      ghost(g, x, y, px(s, 0.55, 0.08, 0.2), {
        color: pal.ghost,
        t: t + i,
        alpha: a,
        face: FACES[i % 4],
        wave: Math.sin(t * 3 + i) * 0.5,
        glow: 1.5,
        blush: '#ff9ac8',
      });
    }
    // black fuzzy spiders (wandering)
    const nsp = countOf(s, 4, 2, 7);
    const ssz = px(s, 0.55, 0.07, 0.2);
    for (let i = 0; i < nsp; i++) {
      const tt = t * 0.06 + i * 10;
      const x = w * (0.1 + 0.8 * noise1(tt, i * 2 + 1));
      const y = h * (0.1 + 0.8 * noise1(tt + 50, i * 2 + 2));
      const x2 = w * (0.1 + 0.8 * noise1(tt + 0.05, i * 2 + 1));
      const y2 = h * (0.1 + 0.8 * noise1(tt + 50.05, i * 2 + 2));
      const ang = Math.atan2(y2 - y, x2 - x);
      const dist = (noise1(tt, i * 2 + 1) + noise1(tt + 50, i * 2 + 2)) * 60;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      fuzzySpider(g, ssz * (0.85 + 0.3 * hash01(i)), dist, 0.25, pal.rim, '#ffe14d', i);
      g.restore();
    }
  },
  { ambientSound: (snd) => snd.ambience('wind', 0.025) },
);

// ---------------------------------------------------------------------------
// Neon Pumpkin Patch (floor / wall)
// ---------------------------------------------------------------------------
const PATCH_FRAG = /* glsl */ `
${HEADER}
void main() {
  vec2 uv = vUv;
  float aspect = uRes.x / uRes.y;
  float t = uTime * uSpeed * 0.04;
  vec3 col = mix(uB * 0.8 + uA * 0.15, uA * 0.75, smoothstep(0.0, 0.95, uv.y));
  float n = fbm(vec2(uv.x * aspect * 2.0 + t, uv.y * 3.0 - t * 0.5) + uSeed);
  col += uC * 0.35 * smoothstep(0.55, 0.85, n) * (1.0 - uv.y * 0.6);
  col += uB * 0.25 * exp(-pow((uv.y - 0.2) * 4.0, 2.0));
  col *= 0.85 + 0.3 * n;
  col = max(col, uA * 0.3);
  gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
}
`;

const neonPumpkinPatch: SceneModule = hybridScene('neonPumpkinPatch', PATCH_FRAG, neonUniforms, (g, s, f) => {
  const pal = palette(s.params);
  const t = f.time * speedOf(s);
  const { w, h } = s;
  const base = px(s, 0.5, 0.08, 0.22);
  const layout = memo(s, 'patch', () => {
    const rng = createRng(s.seed ^ 0x9e37);
    const cols = Math.max(2, Math.round(w / (base * 1.7)));
    const rows = Math.max(2, Math.round(h / (base * 1.6)));
    const keep = clamp01(0.45 + densityOf(s) * 0.3);
    const out: { x: number; y: number; s: number; face: number; ph: number }[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rng() > keep) continue;
        out.push({
          x: ((c + 0.5 + (rng() - 0.5) * 0.5) / cols) * w,
          y: ((r + 0.6 + (rng() - 0.5) * 0.4) / rows) * h,
          s: base * (0.75 + rng() * 0.5),
          face: Math.floor(rng() * 6),
          ph: rng() * TAU,
        });
      }
    }
    return out.sort((a, b) => a.y - b.y);
  });
  // vines and leaves (cached, filled ribbons)
  g.drawImage(
    memo(s, 'vines', () => {
      const { c, g: vg } = offscreen(w, h);
      vg.lineCap = 'round';
      for (let i = 0; i < layout.length - 1; i++) {
        const a = layout[i]!;
        const b = layout[i + 1]!;
        if (Math.hypot(b.x - a.x, b.y - a.y) > base * 3) continue;
        const mx = (a.x + b.x) / 2 + Math.sin(i * 1.7) * base * 0.3;
        const my = (a.y + b.y) / 2 - base * 0.5;
        for (const [lw, col] of [
          [base * 0.11, '#1d5a12'],
          [base * 0.07, '#3fa52a'],
          [base * 0.025, '#9dff6b'],
        ] as const) {
          vg.strokeStyle = col;
          vg.lineWidth = Math.max(1.5, lw);
          vg.beginPath();
          vg.moveTo(a.x, a.y);
          vg.quadraticCurveTo(mx, my, b.x, b.y);
          vg.stroke();
        }
        paintLeaf(vg, mx, my, base * 0.28, i % 2 ? 0.6 : -0.6, '#3fbf2a', 0);
        paintLeaf(vg, (a.x + mx) / 2, (a.y + my) / 2, base * 0.2, i, '#2f9a22', 0);
      }
      return c;
    }),
    0,
    0,
  );
  // pumpkins
  for (const p of layout) {
    const bob = Math.sin(t * 1.1 + p.ph) * p.s * 0.03;
    pumpkin(g, p.x, p.y + bob, p.s, {
      pal,
      face: p.face,
      glow: 1.3 + 0.2 * Math.sin(t * 0.9 + p.ph),
      t: t + p.ph,
    });
  }
  // sparkles
  const nsp = countOf(s, 30, 8, 80);
  for (let i = 0; i < nsp; i++) {
    const x = hash01(i * 3 + 1) * w;
    const y = mod(hash01(i * 3 + 2) - t * 0.02 * (0.5 + hash01(i)), 1) * h;
    const a = 0.5 + 0.5 * Math.sin(t * 2 + i);
    star(g, x, y, base * 0.08 * (0.6 + hash01(i * 7)), i % 2 ? pal.secondary : '#ffffff', a);
  }
});

export const neonScenes: SceneModule[] = [neonManor, neonParty, neonFog, neonPumpkinPatch];
