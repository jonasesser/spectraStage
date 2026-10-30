/**
 * "Breakout": a monster comes out of the (dark) wall – in real 3D, seen from where the audience
 * stands (Stage → room → audience standpoint), so from there it looks as if it really comes out.
 *
 *  1. calm, knocking from inside           4. the head comes out, looks around, stares at you
 *  2. a face presses the wall out (rubber)  5. hands grip the wall, it pulls itself out (roars)
 *  3. cracks, the wall bursts, debris       6. it pulls back into the dark, the glow dies down
 *
 * Rendering: one raymarched SDF scene in a full-screen shader. Every pixel of the wall is a ray
 * from the eye point through that spot of the real wall. Animation is computed here (TypeScript)
 * and passed as uniforms; the shader only draws. Two monsters: a mummy and a cute one for kids.
 */
import * as THREE from 'three';
import { shaderScene, type DrawState, type SceneModule, type ScenePhotos } from '@spectrastage/engine';
import type { SoundApi } from '@spectrastage/engine';

type V3 = [number, number, number];

export const LOOP = 44;
/** The dim lamp in the room (local units) – same as KEY in the shader. */
export const KEY_POS: V3 = [1.3, 1.7, 2.4];

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (a: number, t0: number, t1: number) => clamp01((a - t0) / (t1 - t0));
const sm = (v: number) => v * v * (3 - 2 * v);
const ease = (a: number, t0: number, t1: number) => sm(seg(a, t0, t1));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mixV = (a: V3, b: V3, t: number): V3 => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
/** Decaying pulses after the given times. */
const pulses = (a: number, times: number[], k: number) =>
  times.reduce((s, t) => s + (a >= t ? Math.exp(-(a - t) * k) : 0), 0);

type M3 = number[]; // row-major 3x3
const mul = (A: M3, B: M3): M3 => {
  const r: number[] = [];
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r.push(A[i * 3]! * B[j]! + A[i * 3 + 1]! * B[3 + j]! + A[i * 3 + 2]! * B[6 + j]!);
  return r;
};
const rotY = (a: number): M3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotX = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotZ = (a: number): M3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
/** Rotation (part → local) from yaw (turn), pitch (about x) and roll. */
const rot = (yaw: number, pitch: number, roll: number): M3 => mul(mul(rotY(yaw), rotX(pitch)), rotZ(roll));
const apply = (R: M3, v: V3): V3 => [
  R[0]! * v[0] + R[1]! * v[1] + R[2]! * v[2],
  R[3]! * v[0] + R[4]! * v[1] + R[5]! * v[2],
  R[6]! * v[0] + R[7]! * v[1] + R[8]! * v[2],
];
const applyT = (R: M3, v: V3): V3 => [
  R[0]! * v[0] + R[3]! * v[1] + R[6]! * v[2],
  R[1]! * v[0] + R[4]! * v[1] + R[7]! * v[2],
  R[2]! * v[0] + R[5]! * v[1] + R[8]! * v[2],
];

// ---------------------------------------------------------------------------
// Where things are: the wall frame
// ---------------------------------------------------------------------------
/**
 * Local frame of the monster (units: meters / size): x right along the wall, y up, z out of the
 * wall into the room; origin on the wall at the height of the head.
 */
export interface Frame {
  /** Eye point (local). */
  ro: V3;
  /** Pixel (u, v from top) → local point on the wall: p0 + pu·u + pv·v. */
  p0: V3;
  pu: V3;
  pv: V3;
  /** Floor height (local y). */
  floorY: number;
  /** Meters per local unit. */
  k: number;
}

export function frameOf(s: DrawState): Frame {
  const w = s.world;
  const face = w?.room.faces.find((f) => f.id === w.self.id);
  if (!w || !face) {
    // no room: a wall of the scene's size, viewer 3 m in front at eye height
    const W = s.w / s.ppm;
    const H = s.h / s.ppm;
    const k = Math.min(1.8, Math.max(0.7, (H / 2.25) * 1.25));
    const hy = Math.min(H - 0.55 * k, 1.42 * k);
    return {
      ro: [0, (1.6 - hy) / k, 3 / k],
      p0: [-W / 2 / k, (H - hy) / k, 0],
      pu: [W / k, 0, 0],
      pv: [0, -H / k, 0],
      floorY: -hy / k,
      k,
    };
  }
  const H = face.rect.h;
  const W = face.rect.w;
  const k = Math.min(1.8, Math.max(0.7, (H / 2.25) * 1.25));
  const hy = Math.min(H - 0.55 * k, 1.42 * k);
  const up: V3 = [-face.ay[0], -face.ay[1], -face.ay[2]];
  const n = face.n as V3;
  const ax = face.ax as V3;
  // anchor: middle of the side, head height above its bottom edge
  const A = add(add(face.o as V3, scale(ax, W / 2)), scale(face.ay as V3, H - hy));
  const loc = (p: V3): V3 => {
    const d = sub(p, A);
    return [dot(d, ax) / k, dot(d, up) / k, dot(d, n) / k];
  };
  const dirL = (v: V3): V3 => [dot(v, ax) / k, dot(v, up) / k, dot(v, n) / k];
  let eye: V3 = (w.viewer as V3 | undefined) ?? (w.room.center as V3);
  // the eye has to be in front of the wall (someone standing at this very wall sees nothing)
  const dz = dot(sub(eye, A), n);
  if (dz < 1.2) eye = add(eye, scale(n, 1.2 - dz));
  return {
    ro: loc(eye),
    p0: loc(face.o as V3),
    pu: dirL(scale(ax, W)),
    pv: dirL(scale(face.ay as V3, H)),
    floorY: -hy / k,
    k,
  };
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------
interface Hand {
  pos: V3;
  yaw: number;
  pitch: number;
  roll: number;
  curl: number;
  /** Where the elbow goes when waving (weight e), else a relaxed default. */
  elbow?: V3;
  /** Gripping the edge: the elbow from a real hinge (weight e). */
  ik?: boolean;
  e?: number;
}

interface Pose {
  bulge: number;
  crack: number;
  hole: number;
  debrisT: number;
  glow: number;
  fade: number;
  eyes: number;
  blink: number;
  jaw: number;
  head: V3;
  headR: M3;
  body: V3;
  handL: Hand;
  handR: Hand;
  /** 0..1: the right hand reaches for the audience. */
  reach: number;
}

const KNOCKS = [1.0, 1.45, 1.9, 3.7, 4.1];
const PUSHES = [9.4, 10.9, 12.3];

/** Radius of the broken hole at angle th (same as holeR in the shader, for uHole = 1). */
export const holeR = (th: number) =>
  0.62 + 0.06 * Math.sin(th * 3 + 1.3) + 0.04 * Math.sin(th * 7 + 0.4) + 0.025 * Math.sin(th * 13 + 2.1);
export const HOLE_C: [number, number] = [0, -0.08];
const norm = (v: V3): V3 => scale(v, 1 / (Math.hypot(...v) || 1));

/** Two-bone arm: elbow from shoulder S, wrist W, bone lengths and the direction the elbow points. */
export function elbowIK(S: V3, W: V3, l1: number, l2: number, pole: V3): V3 {
  let d = sub(W, S);
  let dist = Math.hypot(...d);
  d = scale(d, 1 / (dist || 1));
  dist = Math.min(dist, (l1 + l2) * 0.999);
  const a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const pp = norm(sub(pole, scale(d, dot(pole, d))));
  return add(add(S, scale(d, a)), scale(pp, h));
}

const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/**
 * The hand's rotation, made to fit the forearm: the fingers point where the pose wants them, but
 * the wrist bends at most `maxBend` away from the forearm, and the back of the hand stays as
 * wanted around that – so the hand always sits on the arm (no twisted-off wrists).
 */
function handFrame(E: V3, W: V3, want: Hand, maxBend = 0.6): M3 {
  const Rw = rot(want.yaw, want.pitch, want.roll);
  const g = norm(apply(Rw, [0, 1, 0]));
  const b = apply(Rw, [0, 0, 1]);
  const f = norm(sub(W, E));
  const ang = Math.acos(Math.max(-1, Math.min(1, dot(f, g))));
  let y = g;
  if (ang > maxBend && ang > 1e-4) {
    const t = maxBend / ang;
    y = norm(add(scale(f, Math.sin((1 - t) * ang)), scale(g, Math.sin(t * ang))));
  }
  let z = sub(b, scale(y, dot(b, y)));
  if (Math.hypot(...z) < 1e-4) z = cross([1, 0, 0], y);
  z = norm(z);
  const x = cross(y, z);
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** A hand gripping the broken edge: wrist on the rim, fingers outwards over the wall, claws in. */
function rimGrip(side: number, ang: number): Hand {
  const th = side < 0 ? Math.PI - ang : ang;
  const r = holeR(th) + 0.01;
  const dx = Math.cos(th);
  const dy = Math.sin(th);
  return {
    pos: [HOLE_C[0] + dx * r, HOLE_C[1] + dy * r, 0.035],
    yaw: 0,
    pitch: 0,
    // fingers (+y) point away from the hole
    roll: Math.atan2(-dx, dy),
    curl: 0.75,
  };
}

function lookAngles(from: V3, to: V3): [number, number] {
  const d = sub(to, from);
  return [Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
}

function pose(a: number, cute: boolean, ro: V3, rebuild = true): Pose {
  // --- the wall (and at the end: built up again – the bits fly back – or just faded out)
  const bulge = ease(a, 5, 8.5);
  const crack = ease(a, 10.4, 13.4) * (rebuild ? 1 - ease(a, 42, 43.6) : 1);
  const hole = ease(a, 13.5, 13.95) * (rebuild ? 1 - ease(a, 41, 42.4) : 1);
  let debrisT = a >= 13.5 && a < 18 ? a - 13.5 : -1;
  if (rebuild && a >= 39.6 && a < 42.2) debrisT = Math.max(0, 42.2 - a);
  const flash = a >= 13.5 ? Math.exp(-(a - 13.5) * 2.5) : 0;
  const glow =
    (0.18 * ease(a, 10.4, 13.4) + 0.82 * hole + 0.8 * flash) *
    (1 - ease(a, 38.5, 41.5)) *
    (0.9 + 0.1 * Math.sin(a * 13.1) * Math.sin(a * 7.3));
  const fade = ease(a, 0, 1.2) * (1 - ease(a, rebuild ? 43 : 41.5, 44));

  // --- head
  let head: V3;
  if (a < 13.5) {
    const push = pulses(a, PUSHES, 3) * 0.035;
    head = [0.03 * Math.sin(a * 0.6), 0.02, -0.38 + 0.31 * bulge + 0.03 * Math.sin(a * 2.1) * bulge + push];
  } else {
    const out = ease(a, 13.5, 15.2);
    const pull = ease(a, 26, 30);
    const back = ease(a, 35.5, 39.5);
    head = [
      0,
      0.02 + 0.03 * pull + 0.01 * Math.sin(a * 1.3),
      mix(mix(-0.1, 0.05, out), 0.21, pull) * (1 - back) + -0.85 * back,
    ];
  }
  // where it looks: around while pressing, then left / right, then at the audience
  const [vy, vp] = lookAngles(head, ro);
  const toViewer = ease(a, 20, 21.6) * (1 - ease(a, 35.5, 37));
  let yaw = a < 13.5 ? 0.3 * Math.sin(a * 0.7) : 0;
  yaw += -0.7 * ease(a, 16.3, 17.6) + 1.4 * ease(a, 18, 19.3) - 0.7 * ease(a, 19.6, 20.2);
  let pitch = a < 15 ? 0 : -0.08;
  yaw = mix(yaw, vy, toViewer);
  pitch = mix(pitch, vp, toViewer);
  let roll = 0;
  let jaw = 0;
  let eyes = a < 13.5 ? 0 : ease(a, 15, 16.2) * (1 - ease(a, 37, 39));
  let blink = 0;
  if (cute) {
    // head tilts, blinks, giggles
    roll = 0.25 * Math.sin((a - 22) * 1.6) * ease(a, 22, 23) * (1 - ease(a, 33, 34));
    for (const b of [17.2, 23.8, 30.4, 33.6]) blink = Math.max(blink, 1 - Math.abs(a - b) / 0.12);
    blink = clamp01(blink);
    jaw =
      0.35 * ease(a, 15.5, 16.5) +
      0.45 * ease(a, 27, 27.4) * (1 - ease(a, 30, 30.6)) * (0.6 + 0.4 * Math.sin(a * 18));
    jaw *= 1 - ease(a, 36, 37.5);
    eyes = a < 13.5 ? 0 : 1;
  } else {
    // the mummy: slow and stiff; a long groan with the jaw sagging open, head tilting
    const groan = ease(a, 28.2, 29.6) * (1 - ease(a, 32, 33.2));
    jaw = 0.8 * groan + 0.12 * ease(a, 16, 17.5) * (1 - ease(a, 35, 36));
    roll = 0.05 * Math.sin(a * 0.9) * ease(a, 15, 16) + 0.25 * ease(a, 32.5, 34) * (1 - ease(a, 35.5, 37));
    pitch += groan * 0.1;
    eyes *= 0.85 + 0.1 * Math.sin(a * 5.3) * Math.sin(a * 3.1) + 0.35 * groan;
  }
  const headR = rot(yaw, -pitch, roll);

  // --- body behind the head
  const body: V3 = [
    0,
    -0.47,
    a < 13.5
      ? -0.75
      : mix(mix(-0.55, -0.42, ease(a, 13.5, 15.5)), -0.12, ease(a, 26, 30)) * (1 - ease(a, 35.5, 39.5)) +
        -1.1 * ease(a, 35.5, 39.5),
  ];

  // --- hands
  const knock = pulses(a, KNOCKS, 14);
  const press = ease(a, 8, 9.2) * (1 - ease(a, 12.8, 13.5));
  const pushHand = (side: number): Hand => ({
    pos: [
      side * 0.4,
      0.0 + 0.02 * Math.sin(a * 1.7 + side),
      -0.25 + 0.2 * press + 0.04 * Math.sin(a * 2.3 + side) * press,
    ],
    yaw: Math.PI,
    pitch: 0,
    roll: side * 0.15,
    curl: 0.15,
  });
  const hidden = (side: number): Hand => ({
    pos: [side * 0.35, -1.0, -1.1],
    yaw: 0,
    pitch: 1.2,
    roll: -side * 0.3,
    curl: 0.5,
  });
  const scratch = 0.12 * Math.sin(a * 5.5) * ease(a, 26, 27) * (1 - ease(a, 33, 34));
  const handAt = (side: number, t0: number): Hand => {
    if (a < 13.5) {
      if (side > 0 && a < 6) {
        // knocking from inside with the fist
        return {
          pos: [0.34, 0.14, -0.14 + 0.1 * Math.min(1, knock)],
          yaw: Math.PI,
          pitch: 0,
          roll: 0.2,
          curl: 1.3,
        };
      }
      return press > 0 ? pushHand(side) : hidden(side);
    }
    const e = ease(a, t0, t0 + 2.5) * (1 - ease(a, 35.5, 38.5));
    // reaches out of the hole and grabs the broken edge: the forearm lies over the edge, the elbow
    // stays inside the opening in front of the wall, the fingers go on over the wall
    const g = rimGrip(side, cute ? (side < 0 ? 0.05 : -0.05) : side < 0 ? -0.1 : -0.2);
    const inside: V3 = [side * 0.25, -0.3, -0.45];
    const pos = mixV(inside, g.pos, e);
    pos[2] += 0.18 * Math.sin(Math.PI * Math.min(1, e * 1.15));
    return {
      pos,
      yaw: 0,
      pitch: mix(1.3, 0, e),
      roll: mix(-side * 0.3, g.roll, e),
      curl: mix(0.4, cute ? 0.35 : g.curl, e) + scratch * (cute ? 0.3 : 0.6),
      ik: true,
      e,
    };
  };
  const handL = handAt(-1, 21);
  let handR = handAt(1, 23);
  // the mummy lets go with one hand and reaches stiffly for the audience
  const reach = 0; // (reaching for the audience looked wrong from the front – left out)
  if (reach > 0) {
    const toward = norm(sub(ro, [0.35, -0.05, 0.4]));
    const target: V3 = add([0.35, -0.05, 0.4], scale(toward, 0.12 * Math.sin(a * 1.3) * 0.3));
    handR = {
      pos: mixV(handR.pos, target, reach),
      yaw: mix(handR.yaw, Math.atan2(toward[0], toward[2]) * 0.5, reach),
      pitch: mix(handR.pitch, -1.45, reach),
      roll: mix(handR.roll, 0, reach),
      curl: mix(handR.curl, 0.35 + 0.1 * Math.sin(a * 4), reach),
    };
  }
  if (cute) {
    // waves hello to the audience
    const wv = ease(a, 26, 27.2) * (1 - ease(a, 31.5, 32.8));
    if (wv > 0) {
      const wave: Hand = {
        pos: [0.4, 0.16, 0.3],
        yaw: Math.PI,
        pitch: 0.1,
        roll: 0.35 * Math.sin(a * 7.5),
        curl: 0.05,
      };
      handR = {
        pos: mixV(handR.pos, wave.pos, wv),
        yaw: mix(handR.yaw, wave.yaw, wv),
        pitch: mix(handR.pitch, wave.pitch, wv),
        roll: mix(handR.roll, wave.roll, wv),
        curl: mix(handR.curl, wave.curl, wv),
        elbow: mixV(handR.elbow ?? handR.pos, [0.46, -0.12, 0.2], wv),
        e: Math.max(handR.e ?? 0, wv),
      };
    }
  }
  return {
    bulge,
    crack,
    hole,
    debrisT,
    glow,
    fade,
    eyes,
    blink,
    jaw,
    head,
    headR,
    body,
    handL,
    handR,
    reach,
  };
}

// ---------------------------------------------------------------------------
// Shader
// ---------------------------------------------------------------------------
export const WALL_MONSTER_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform vec2 uRes;
uniform vec3 uRo, uP0, uPU, uPV;
uniform float uCute, uFloorY;
uniform float uBulge, uCrack, uHole, uDebrisT, uGlow, uFade, uEyes, uBlink, uJaw;
uniform vec3 uHead; uniform mat3 uHeadM; uniform vec3 uNeck;
uniform vec3 uBody;
uniform vec3 uHandL; uniform mat3 uHandLM; uniform float uCurlL; uniform vec3 uElbL;
uniform vec3 uHandR; uniform mat3 uHandRM; uniform float uCurlR; uniform vec3 uElbR;
uniform vec3 uLook;
uniform vec3 uRib1, uRib2;
uniform float uPhoto, uPhotoA, uPhotoTilt, uHide;
// holes: centre xy, size xy (1 = the standard hole); how far each is open; how many; bulge blobs
uniform vec4 uH0, uH1;
uniform vec2 uHO;
uniform float uHN, uBlob, uBlobY;
uniform vec3 uPhotoB;
uniform vec2 uPhotoSize;
uniform sampler2D uPhotoTex;
uniform vec3 uGlowCol;

#define HOLE_C vec2(0.0, -0.08)

vec4 hh(int i) { return i == 0 ? uH0 : uH1; }
float ho(int i) { return i == 0 ? uHO.x : uHO.y; }
float baseR(float th) {
  return 0.62 + 0.06 * sin(th * 3.0 + 1.3) + 0.04 * sin(th * 7.0 + 0.4) + 0.025 * sin(th * 13.0 + 2.1);
}
vec2 holeQ(vec2 xy, int i) { vec4 h = hh(i); return (xy - h.xy) / h.zw; }
/** > 0 inside hole i (about meters). */
float holeIn(vec2 xy, int i) {
  vec4 h = hh(i);
  vec2 q = holeQ(xy, i);
  return (ho(i) * baseR(atan(q.y, q.x)) - length(q)) * min(h.z, h.w);
}
float holeAll(vec2 xy) { float v = holeIn(xy, 0); if (uHN > 1.5) v = max(v, holeIn(xy, 1)); return v; }
/** Distance to the nearest hole centre, in hole sizes. */
float holeNear(vec2 xy) { float d = length(holeQ(xy, 0)); if (uHN > 1.5) d = min(d, length(holeQ(xy, 1))); return d; }
const vec3 KEY = vec3(1.3, 1.7, 2.4);

float hash1(float n) { return fract(sin(n) * 43758.5453123); }
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * noise3(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; }
  return s;
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdEll(vec3 p, vec3 r) { float k0 = length(p / r); float k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-5); }
float sdCap(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
float sdCapT(vec3 p, vec3 a, vec3 b, float ra, float rb) {
  vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - mix(ra, rb, h);
}
float sdRBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }
mat3 rotAxis(vec3 a, float g) {
  float s = sin(g), c = cos(g), oc = 1.0 - c;
  return mat3(oc*a.x*a.x + c, oc*a.x*a.y + a.z*s, oc*a.z*a.x - a.y*s,
              oc*a.x*a.y - a.z*s, oc*a.y*a.y + c, oc*a.y*a.z + a.x*s,
              oc*a.z*a.x + a.y*s, oc*a.y*a.z - a.x*s, oc*a.z*a.z + c);
}

// ---------------------------------------------------------------- heads (head space: z forward)
// bandage wraps: raised linen strips with frayed edges, a few gaps where dried skin shows.
// s: coordinate across the strips (m), np: stable noise position. x: height, y: gap, z: strip profile
vec3 wraps(float s, vec3 np, float w) {
  float u = s / w + 0.55 * noise3(np * 2.0) + 0.25 * noise3(np * 7.0);
  float id = floor(u);
  float v = fract(u);
  // strips of different width overlapping each other
  v = clamp((v - 0.5) * (0.8 + 0.5 * hash1(id * 3.3)) + 0.5, 0.0, 1.0);
  float prof = smoothstep(0.0, 0.22, v) * smoothstep(1.0, 0.72, v);
  float fray = noise3(np * 30.0 + id);
  float gap = step(0.66, hash1(id * 7.31 + 3.0)) * smoothstep(0.5, 0.6, noise3(np * 2.5 + id * 1.7));
  return vec3(mix(0.0045 * prof + 0.0012 * fray, -0.004, gap), gap, prof);
}

vec3 headWraps(vec3 q) {
  vec3 qa = vec3(abs(q.x), q.y, q.z);
  vec3 w = wraps(q.y + 0.045 * sin(atan(q.x, q.z) * 1.3 + 0.5), q * 4.0, 0.03);
  // a second, crossing layer in patches
  vec3 w2 = wraps(q.y * 0.55 + q.x * 0.85, q * 4.0 + 9.0, 0.032);
  float pch = smoothstep(0.58, 0.64, noise3(q * 5.0 + 2.0));
  w = mix(w, vec3(w2.x + 0.003, 0.0, w2.z), pch);
  // around the eyes and the mouth the wraps have slipped: dried skin
  float face = max(smoothstep(0.055, 0.04, length(qa.xy - vec2(0.048, 0.025))),
                   smoothstep(0.05, 0.035, length((q.xy - vec2(0.0, -0.1)) * vec2(0.8, 1.6))));
  face *= step(0.05, q.z);
  return mix(w, vec3(-0.003, 1.0, 0.0), face);
}

vec2 headMummy(vec3 q) {
  vec3 qa = vec3(abs(q.x), q.y, q.z);
  float d = sdEll(q - vec3(0.0, 0.05, -0.02), vec3(0.135, 0.16, 0.165));
  d = smin(d, sdEll(q - vec3(0.0, -0.06, 0.04), vec3(0.105, 0.115, 0.12)), 0.06);
  d = smin(d, length(qa - vec3(0.075, -0.012, 0.1)) - 0.034, 0.03);           // cheekbones
  d = smax(d, -(length(qa - vec3(0.085, -0.07, 0.11)) - 0.03), 0.035);        // sunken cheeks
  d = smin(d, sdCap(qa, vec3(0.0, 0.056, 0.138), vec3(0.085, 0.062, 0.112), 0.019), 0.03); // brow
  d = smin(d, sdCap(q, vec3(0.0, 0.03, 0.15), vec3(0.0, -0.028, 0.166), 0.013), 0.025);   // nose
  // jaw on its hinge (groan)
  float ja = uJaw * 0.45;
  vec3 jq = q - vec3(0.0, -0.035, -0.04);
  jq.yz = mat2(cos(ja), -sin(ja), sin(ja), cos(ja)) * jq.yz;
  jq += vec3(0.0, -0.035, -0.04);
  float mouth = sdEll(q - vec3(0.0, -0.098, 0.1), vec3(0.055, 0.012 + 0.05 * uJaw, 0.08));
  d = smax(d, -mouth, 0.01);
  float jaw = sdEll(jq - vec3(0.0, -0.14, 0.045), vec3(0.085, 0.045, 0.1));
  d = smin(d, jaw, 0.025);
  if (d < 0.03) d -= headWraps(q).x;
  // deep eye sockets, carved through the wraps
  d = smax(d, -(length(qa - vec3(0.048, 0.025, 0.152)) - 0.032), 0.012);
  float mat = 2.0;
  float eye = length(qa - vec3(0.048, 0.025, 0.128)) - 0.017;
  if (eye < d) { d = eye; mat = 3.0; }
  // a few yellowed teeth
  float teeth = 1e5;
  for (int i = 0; i < 4; i++) {
    float x = 0.008 + float(i) * 0.012;
    teeth = min(teeth, sdRBox(qa - vec3(x, -0.096, 0.15 - float(i * i) * 0.003), vec3(0.005, 0.009, 0.004), 0.002));
  }
  if (teeth < d) { d = teeth; mat = 4.0; }
  return vec2(d, mat);
}

/** Linen strips hanging loose, swaying (anchor point, phase). */
float ribbon(vec3 p, vec3 A, float ph) {
  vec3 q = p - A;
  float yy = clamp(-q.y, 0.0, 0.32);
  float k = yy / 0.32;
  q.x -= sin(uTime * 1.4 + ph + yy * 7.0) * 0.04 * k;
  q.z -= (0.02 + sin(uTime * 1.1 + ph * 2.0 + yy * 5.0) * 0.02) * k;
  return sdRBox(q - vec3(0.0, -0.16, 0.0), vec3(0.012 - 0.004 * k, 0.16, 0.0015), 0.001);
}

/** Wraps on the arms (spiralling round each bone) and the chest. */
vec3 bodyWraps(vec3 p) {
  vec3 sl = uBody + vec3(-0.27, 0.07, 0.0), sr = uBody + vec3(0.27, 0.07, 0.0);
  float best = 1e5;
  vec3 res = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    vec3 A = k == 0 ? sl : k == 1 ? sr : k == 2 ? uElbL : uElbR;
    vec3 B = k == 0 ? uElbL : k == 1 ? uElbR : k == 2 ? uHandL : uHandR;
    vec3 u = normalize(B - A);
    float h = clamp(dot(p - A, u), 0.0, length(B - A));
    vec3 perp = p - A - u * h;
    float dd = length(perp);
    if (dd < best) {
      best = dd;
      vec3 ref = normalize(cross(u, abs(u.z) > 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0)));
      float ang = atan(dot(perp, cross(u, ref)), dot(perp, ref));
      res = wraps(h + ang / 6.2831853 * 0.03, vec3(h * 3.0, ang * 0.4, float(k) * 5.0), 0.03);
    }
  }
  // chest and shoulders: horizontal wraps (body-relative, so they move with it)
  vec3 bq = p - uBody;
  float chest = sdEll(bq, vec3(0.3, 0.22, 0.17));
  if (chest < best - 0.06) res = wraps(bq.y + 0.03 * sin(bq.x * 9.0), bq * 4.0 + 20.0, 0.035);
  return res;
}

vec2 headCute(vec3 q) {
  vec3 qa = vec3(abs(q.x), q.y, q.z);
  float d = sdEll(q, vec3(0.23, 0.21, 0.2));
  d = smin(d, sdEll(q - vec3(0.0, -0.085, 0.06), vec3(0.17, 0.12, 0.15)), 0.07);
  d = smin(d, length(qa - vec3(0.205, 0.12, -0.03)) - 0.06, 0.04);           // round ears
  vec3 mq = q - vec3(0.0, -0.085, 0.2);
  mq.y -= 2.6 * mq.x * mq.x;                                                  // smile
  float mouth = sdEll(mq, vec3(0.095, 0.011 + 0.04 * uJaw, 0.06));
  d = smax(d, -mouth, 0.012);
  if (d < 0.03) d += (fbm3(q * 50.0) - 0.5) * 0.009;                          // fur
  float mat = 2.0;
  float eye = length(qa - vec3(0.078, 0.05, 0.15)) - 0.066;
  if (eye < d) { d = eye; mat = 3.0; }
  float horn = sdCapT(qa, vec3(0.09, 0.16, 0.0), vec3(0.125, 0.27, -0.03), 0.034, 0.012);
  float tooth = sdRBox(q - vec3(0.032, -0.083 + 2.6 * 0.032 * 0.032, 0.205), vec3(0.011, 0.012, 0.006), 0.004);
  float bone = min(horn, tooth);
  if (bone < d) { d = bone; mat = 4.0; }
  return vec2(d, mat);
}

// ---------------------------------------------------------------- hands (hand space: fingers +y, back +z)
vec2 hand(vec3 q, float curl) {
  float d = uCute > 0.5 ? sdRBox(q - vec3(0.0, 0.055, 0.0), vec3(0.046, 0.05, 0.01), 0.016)
                        : sdRBox(q - vec3(0.0, 0.058, 0.0), vec3(0.04, 0.05, 0.006), 0.012);
  float mat = 2.0;
  if (uCute < 0.5) {
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float x = -0.042 + fi * 0.028;
      float spread = (fi - 1.5) * 0.11;
      vec3 p0 = vec3(x, 0.11, 0.0);
      vec3 dir = vec3(sin(spread), cos(spread), 0.0);
      float L1 = 0.07 - abs(fi - 1.5) * 0.008;
      float a1 = curl * 0.6, a2 = curl * 1.6, a3 = curl * 2.4;
      vec3 p1 = p0 + (dir * cos(a1) - vec3(0, 0, 1) * sin(a1)) * L1;
      vec3 d2 = dir * cos(a2) - vec3(0, 0, 1) * sin(a2);
      vec3 p2 = p1 + d2 * L1 * 0.8;
      vec3 d3 = dir * cos(a3) - vec3(0, 0, 1) * sin(a3);
      vec3 p3 = p2 + d3 * L1 * 0.6;
      d = smin(d, sdCapT(q, p0, p1, 0.0125, 0.011), 0.01);
      d = smin(d, length(q - p1) - 0.0125, 0.005); // bony knuckles
      d = smin(d, sdCapT(q, p1, p2, 0.011, 0.0095), 0.004);
      // last bone: the wraps are gone, dried dark skin and a nail
      float tip = sdCapT(q, p2, p3, 0.0095, 0.0075);
      if (tip < d) { d = smin(d, tip, 0.003); mat = 6.0; }
      float nail = sdCapT(q, p3 - d3 * 0.006, p3 + d3 * 0.006, 0.0068, 0.004);
      if (nail < d) { d = nail; mat = 4.0; }
    }
    vec3 t0 = vec3(-0.05, 0.03, -0.006), t1 = vec3(-0.085, 0.072, -0.02), t2 = vec3(-0.1, 0.108, -0.03);
    d = smin(d, sdCapT(q, t0, t1, 0.016, 0.013), 0.012);
    d = smin(d, sdCapT(q, t1, t2, 0.013, 0.009), 0.005);
    // wraps across the hand
    if (d < 0.02) d -= wraps(q.y + q.x * 0.4, q * 6.0, 0.022).x * 0.7;
  } else {
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      vec3 p0 = vec3(-0.03 + fi * 0.03, 0.105, 0.0);
      vec3 dir = vec3((fi - 1.0) * 0.25, 1.0, 0.0);
      vec3 p1 = p0 + normalize(dir * cos(curl) - vec3(0, 0, 1) * sin(curl)) * 0.05;
      d = smin(d, sdCap(q, p0, p1, 0.022), 0.015);
    }
    d = smin(d, sdCap(q, vec3(-0.05, 0.03, -0.004), vec3(-0.085, 0.07, -0.015), 0.021), 0.015);
    if (d < 0.02) d += (fbm3(q * 50.0) - 0.5) * 0.007;
  }
  // wrist / forearm start
  if (uCute > 0.5) d = smin(d, sdCap(q, vec3(0.0, 0.0, 0.0), vec3(0.0, -0.1, 0.0), 0.037), 0.02);
  else d = smin(d, sdCap(q, vec3(0.0, 0.0, 0.0), vec3(0.0, -0.02, 0.0), 0.028), 0.02);
  return vec2(d, mat);
}

// ---------------------------------------------------------------- the monster
vec2 monster(vec3 p) {
  vec2 res = vec2(1e5, 2.0);
  // guest photo: only the bulge before the burst comes from a (cute) body, then the photo comes out
  if (uHide > 0.5 && uHole > 0.0) return res;
  // head
  vec3 hp = p - uHead;
  float bh = length(hp) - 0.5;
  if (bh > 0.15) res.x = bh;
  else {
    vec2 h = uCute > 0.5 ? headCute(uHeadM * hp) : headMummy(uHeadM * hp);
    res = h;
  }
  // neck, shoulders, chest, arms (cheap)
  vec3 sl = uBody + vec3(-0.27, 0.07, 0.0), sr = uBody + vec3(0.27, 0.07, 0.0);
  float b = sdEll(p - uBody, vec3(0.3, 0.22, 0.17));
  b = smin(b, sdCap(p, sl, sr, 0.09), 0.08);
  b = smin(b, sdCap(p, uNeck, uBody + vec3(0.0, 0.12, 0.02), 0.075), 0.06);
  if (uCute > 0.5) {
    float ak = 1.35;
    // round shoulders the arms grow out of
    b = smin(b, length(p - sl) - 0.1, 0.06);
    b = smin(b, length(p - sr) - 0.1, 0.06);
    b = smin(b, length(p - uElbL) - 0.06 * ak, 0.04);
    b = smin(b, length(p - uElbR) - 0.06 * ak, 0.04);
    b = smin(b, sdCapT(p, sl, uElbL, 0.075 * ak, 0.058 * ak), 0.05);
    b = smin(b, sdCapT(p, sr, uElbR, 0.075 * ak, 0.058 * ak), 0.05);
    // the forearm narrows to the wrist, as thick as the hand's wrist
    b = smin(b, sdCapT(p, uElbL, uHandL, 0.058 * ak, 0.036 * ak), 0.03);
    b = smin(b, sdCapT(p, uElbR, uHandR, 0.058 * ak, 0.036 * ak), 0.03);
  } else {
    // thin, dried-out arms: bony shoulder, elbow and wrist
    for (int k = 0; k < 2; k++) {
      vec3 S = k == 0 ? sl : sr;
      vec3 E = k == 0 ? uElbL : uElbR;
      vec3 W = k == 0 ? uHandL : uHandR;
      b = smin(b, length(p - S) - 0.085, 0.05);
      b = smin(b, sdCapT(p, S, E, 0.058, 0.044), 0.04);
      b = smin(b, length(p - E) - 0.047, 0.025);
      b = smin(b, sdCapT(p, E, W, 0.048, 0.032), 0.03);
    }
  }
  if (uCute < 0.5 && b < 0.03) b -= bodyWraps(p).x;
  if (uCute > 0.5 && b < 0.02) b += (fbm3(p * 50.0) - 0.5) * 0.009;
  if (b < res.x) res = vec2(b, 2.0);
  if (uCute < 0.5 && uHole > 0.0) {
    float rb = min(ribbon(p, uRib1, 0.0), ribbon(p, uRib2, 2.0));
    if (rb < res.x) res = vec2(rb, 7.0);
  }
  // hands
  const float HS = 1.3;
  vec3 lp = p - uHandL;
  float bl = length(lp) - 0.27 * HS;
  vec2 hl = vec2(bl, 2.0);
  // the monster faces us: its right hand is on our left (x < 0) – the hand on our right is its
  // left hand, the mirror image (thumb on the other side)
  if (bl < 0.15) { hl = hand(uHandLM * lp / HS, uCurlL); hl.x *= HS; }
  // the hand grows out of the forearm (blended, no seam at the wrist)
  if (hl.x < res.x + 0.04) res = vec2(smin(res.x, hl.x, 0.03), hl.x < res.x ? hl.y : res.y);
  vec3 rp = p - uHandR;
  float br = length(rp) - 0.27 * HS;
  vec2 hr = vec2(br, 2.0);
  if (br < 0.15) { vec3 q = uHandRM * rp; q.x = -q.x; hr = hand(q / HS, uCurlR); hr.x *= HS; }
  // the hand grows out of the forearm (blended, no seam at the wrist)
  if (hr.x < res.x + 0.04) res = vec2(smin(res.x, hr.x, 0.03), hr.x < res.x ? hr.y : res.y);
  return res;
}

// ---------------------------------------------------------------- the wall
/** Someone pressing against the wall from behind (head and shoulders) – for each hole. */
vec2 blobs(vec3 p) {
  float d = 1e5;
  if (uHole > 0.0) return vec2(d, 2.0);
  for (int i = 0; i < 2; i++) {
    if (float(i) >= uHN) break;
    vec3 c = vec3(hh(i).x, uBlobY, -0.36 + 0.3 * uBulge);
    float b = sdEll(p - c, vec3(0.12, 0.15, 0.13));
    b = smin(b, sdEll(p - c - vec3(0.0, -0.26, -0.06), vec3(0.25, 0.13, 0.12)), 0.08);
    d = min(d, b);
  }
  return vec2(d, 2.0);
}

vec2 debris(vec3 p) {
  float d = 1e5;
  if (uDebrisT < 0.0) return vec2(d, 5.0);
  float t = uDebrisT;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float a = fi * 2.399 + 0.3;
    float r0 = 0.12 + 0.45 * hash1(fi * 3.1);
    vec4 hq = hh(int(mod(fi, max(uHN, 1.0))));
    vec3 p0 = vec3(hq.xy + vec2(cos(a), sin(a)) * r0 * hq.zw, 0.02);
    vec3 v = vec3(cos(a) * (0.4 + 0.5 * hash1(fi * 7.7)), 0.5 + 0.9 * hash1(fi * 5.3), 0.9 + 1.4 * hash1(fi * 1.9));
    vec3 c = p0 + v * t + vec3(0.0, -4.9, 0.0) * t * t;
    // bounce on the floor and come to rest
    if (c.y < uFloorY + 0.03) c.y = uFloorY + 0.03;
    float sz = 0.025 + 0.045 * hash1(fi * 9.1);
    vec3 q = p - c;
    if (length(q) > sz * 2.5) { d = min(d, length(q) - sz * 2.0); continue; }
    q = rotAxis(normalize(vec3(hash1(fi), hash1(fi + 2.0), hash1(fi + 4.0)) - 0.5), t * (4.0 + 6.0 * hash1(fi * 2.0))) * q;
    d = min(d, sdRBox(q, vec3(sz, sz * 0.7, sz * 0.5), 0.004) + (noise3(q * 120.0) - 0.5) * 0.006);
  }
  return vec2(d, 5.0);
}

vec2 map(vec3 p) {
  vec2 m = uBlob > 0.5 ? blobs(p) : monster(p);
  if (uHole < 0.001) {
    // nothing broken yet: the wall is a membrane – whatever pushes against it bulges it out
    float w = smin(p.z, m.x + 0.012, 0.04 + 0.06 * uBulge);
    return vec2(w, 1.0);
  }
  float slab = max(p.z, -p.z - 0.09);
  vec2 res = vec2(max(slab, holeAll(p.xy) + (noise3(p * 40.0) - 0.5) * 0.03 * uHole), 1.0);
  if (m.x < res.x) res = m;
  vec2 db = debris(p);
  if (db.x < res.x) res = db;
  return res;
}

float mapM(vec3 p) {
  float d = (uBlob > 0.5 ? blobs(p) : monster(p)).x;
  if (uDebrisT >= 0.0) d = min(d, debris(p).x);
  return d;
}

vec3 normalAt(vec3 p) {
  const vec2 e = vec2(0.0012, -0.0012);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float shadow(vec3 ro, vec3 rd, float maxT) {
  float res = 1.0, t = 0.02 + 0.03 * hash1(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)));
  for (int i = 0; i < 40; i++) {
    float h = mapM(ro + rd * t);
    res = min(res, 8.0 * h / t);
    t += clamp(h, 0.02, 0.2);
    if (res < 0.02 || t > maxT) break;
  }
  return clamp(res, 0.0, 1.0);
}

float occlusion(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.015 * float(i * i);
    o += (h - map(p + n * h).x) * s;
    s *= 0.6;
  }
  return clamp(1.0 - 2.5 * o, 0.0, 1.0);
}

// cracks: jagged lines running out from the middle, with branches, plus a fine web near the hole
float lin1(float x) { float i = floor(x); return mix(hash1(i * 17.13), hash1((i + 1.0) * 17.13), fract(x)) - 0.5; }
float crackSet(vec2 hp, float r, float N, float reach, float seed, float w) {
  float th = atan(hp.y, hp.x) / 6.2831853 * N;
  float best = 1e5;
  for (int k = -1; k <= 1; k++) {
    float i = floor(th + 0.5) + float(k);
    float idx = mod(i, N);
    float len = reach * (0.55 + 0.45 * hash1(idx * 3.7 + seed));
    if (r > len) continue;
    float c = i + 0.35 * (hash1(idx * 1.3 + seed) - 0.5) + (lin1(r * 13.0 + idx * 5.0 + seed) * 0.9 + lin1(r * 41.0 + idx * 3.0) * 0.35) * N / 6.2831853 / max(r, 0.08) * 0.09;
    float dd = abs(th - c) * 6.2831853 / N * r;
    float width = w * (1.0 - 0.8 * r / len);
    best = min(best, dd - width);
  }
  return best;
}
float crackAt(vec2 hp, float open) {
  vec2 xy = hp;
  float r = length(hp);
  float reach = uCrack * 1.15 + open * 0.2;
  if (r > reach + 0.05 || reach < 0.01) return 0.0;
  float d = crackSet(hp, r, 9.0, reach, 0.0, 0.004);
  d = min(d, crackSet(hp, r, 23.0, reach * 0.65, 11.0, 0.0025));
  // fine web close to the middle
  vec2 g = xy * 14.0 + vec2(lin1(xy.y * 9.0 + 3.0), lin1(xy.x * 9.0 + 8.0)) * 0.8;
  vec2 ip = floor(g), fp = fract(g);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j));
    vec2 c = o + vec2(hash1(dot(ip + o, vec2(7.1, 157.3))), hash1(dot(ip + o, vec2(113.7, 41.9))));
    float dd = length(c - fp);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  float web = smoothstep(0.05, 0.0, d2 - d1) * smoothstep(reach * 0.45, reach * 0.15, r);
  float line = smoothstep(0.0015, -0.001, d);
  return max(line, web) * smoothstep(reach + 0.02, reach - 0.05, r);
}
float cracks(vec2 xy) {
  float c = crackAt(holeQ(xy, 0), uHO.x);
  if (uHN > 1.5) c = max(c, crackAt(holeQ(xy, 1) + 3.7, uHO.y) * step(0.0, 1.0));
  return c;
}

vec3 skinAlbedo(vec3 p) {
  if (uCute > 0.5) {
    float f = fbm3(p * 18.0);
    vec3 a = mix(vec3(0.05, 0.42, 0.42), vec3(0.32, 0.12, 0.55), smoothstep(0.35, 0.75, f));
    return a * (0.75 + 0.5 * fbm3(p * 90.0));
  }
  // dried, leathery skin of a mummy: dark brown, cracked
  float f = fbm3(p * 12.0);
  vec3 a = mix(vec3(0.06, 0.04, 0.025), vec3(0.2, 0.14, 0.08), f);
  a *= 0.7 + 0.5 * fbm3(p * 70.0);
  return a;
}

vec3 light(vec3 p, vec3 n, vec3 rd, vec3 alb, float spec, float gloss, float sss, float isWall) {
  vec3 col = vec3(0.0);
  // key light: a dim lamp up right in the room – casts the monster's shadow onto the wall
  vec3 lk = KEY - p;
  float dk = length(lk);
  lk /= dk;
  float sh = shadow(p + n * 0.004, lk, dk);
  float ndl = dot(n, lk);
  float diff = mix(max(ndl, 0.0), max((ndl + 0.45) / 1.45, 0.0), sss);
  vec3 kc = vec3(1.0, 0.9, 0.78) * (isWall > 0.5 ? 0.16 : 0.55);
  // the wall stays dark: only what differs from a flat wall (bulges, shadows) shows
  float base = isWall > 0.5 ? max(lk.z, 0.0) : 0.0;
  col += alb * kc * max(diff * sh - base, 0.0);
  vec3 hk = normalize(lk - rd);
  col += kc * spec * pow(max(dot(n, hk), 0.0), gloss) * sh * step(0.0, ndl);
  // glow from inside the wall (through the hole)
  for (int i = 0; i < 2; i++) {
    if (float(i) >= uHN) break;
    vec3 gp = vec3(hh(i).xy, -0.4) - p;
    float dg = length(gp);
    gp /= dg;
    float att = uGlow / (1.0 + 6.0 * dg * dg);
    float gd = max(dot(n, gp), 0.0);
    col += alb * uGlowCol * att * (gd + sss * 0.5 * max(-dot(n, gp) + 0.3, 0.0)) * (isWall > 0.5 ? 0.5 : 2.2);
    col += uGlowCol * att * spec * pow(max(dot(n, normalize(gp - rd)), 0.0), gloss) * 1.5;
  }
  // the eyes light the face a little
  if (uCute < 0.5) {
    vec3 ep = uHead + vec3(0.0, 0.025, 0.15) - p;
    float de = length(ep);
    col += alb * vec3(0.3, 1.0, 0.45) * uEyes * 0.006 / (de * de + 0.002) * max(dot(n, ep / de), 0.0) *
           (isWall > 0.5 ? smoothstep(1.7, 0.9, length(p.xy - HOLE_C)) : 1.0);
  }
  // cold fill from below
  col += alb * vec3(0.1, 0.13, 0.2) * 0.06 * (1.0 - 0.5 * n.y) * (1.0 - isWall);
  // rim from the room
  float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
  col += rim * (uCute > 0.5 ? vec3(0.3, 0.45, 0.6) : vec3(0.25, 0.18, 0.22)) * 0.08 * (1.0 - isWall);
  return col;
}

void main() {
  vec3 ro = uRo;
  vec3 P = uP0 + uPU * vUv.x + uPV * (1.0 - vUv.y);
  vec3 rd = normalize(P - ro);
  vec3 col = vec3(0.0);

  // flat wall far away from everything: no marching needed
  float twall = -ro.z / rd.z;
  vec3 hw = ro + rd * twall;
  float far = holeNear(hw.xy);
  bool debrisOn = uDebrisT >= 0.0;
  float tHit = 1e9;
  if (far > 1.75 && !(debrisOn && far < 2.8)) {
    // the plain wall stays black (the real wall)
    col = vec3(0.0);
    tHit = twall;
  } else {
    float t = max(0.0, (ro.z - 1.2) / -rd.z);
    float tEnd = (ro.z + 1.6) / -rd.z;
    float mat = -1.0;
    for (int i = 0; i < 140; i++) {
      vec3 p = ro + rd * t;
      vec2 h = map(p);
      if (h.x < 0.0006 * t) { mat = h.y; break; }
      t += h.x * 0.85;
      if (t > tEnd) break;
    }
    if (mat < 0.0) {
      // into the dark behind the wall: the glow in the depth
      float r = far;
      float fl = 0.75 + 0.25 * noise3(vec3(hw.xy * 4.0, uTime * 1.5));
      col = uGlowCol * uGlow * fl * (0.02 + 0.22 * exp(-r * r * 9.0)) * mix(0.4, 1.0, noise3(vec3(hw.xy * 6.0, 2.0)));
    } else {
      tHit = t;
      vec3 p = ro + rd * t;
      vec3 n = normalAt(p);
      float ao = occlusion(p, n);
      if (mat < 1.5) {
        // plaster
        float c = cracks(p.xy);
        float edge = smoothstep(-0.002, -0.02, p.z); // broken edge inside the hole
        vec3 alb = vec3(0.5) * (0.85 + 0.3 * noise3(p * 60.0));
        alb = mix(alb, vec3(0.42, 0.38, 0.34) * (0.6 + 0.6 * noise3(p * 140.0)), edge);
        alb *= 1.0 - 0.85 * c;
        col = light(p, n, rd, alb, 0.0, 8.0, 0.0, 1.0) * ao;
        // glowing cracks
        col += uGlowCol * c * uGlow * 0.3 * smoothstep(0.8, 0.0, holeNear(p.xy));
      } else if (mat < 2.5) {
        if (uCute > 0.5) {
          col = light(p, n, rd, skinAlbedo(p), 0.05, 6.0, 0.7, 0.0) * ao * ao;
        } else {
          // old linen: dirty, stained, darker between the strips; dried skin in the gaps
          vec3 w;
          vec3 hq = uHeadM * (p - uHead);
          if (length(p - uHead) < 0.3) w = headWraps(hq);
          else if (length(p - uHandL) < 0.2 || length(p - uHandR) < 0.2) w = vec3(0.0, 0.0, 0.7);
          else w = bodyWraps(p);
          vec3 lin = vec3(0.58, 0.5, 0.37) * (0.65 + 0.45 * fbm3(p * 22.0));
          lin = mix(lin, vec3(0.28, 0.2, 0.11), smoothstep(0.5, 0.8, fbm3(p * 5.0 + 3.0)) * 0.7);
          lin *= 0.55 + 0.45 * w.z;
          vec3 alb = mix(lin, skinAlbedo(p), w.y);
          col = light(p, n, rd, alb, 0.04, 8.0, 0.35, 0.0) * ao * ao;
        }
      } else if (mat < 3.5) {
        vec3 hq = uHeadM * (p - uHead);
        vec3 ec = vec3(sign(hq.x) * (uCute > 0.5 ? 0.078 : 0.048), uCute > 0.5 ? 0.05 : 0.025, uCute > 0.5 ? 0.15 : 0.128);
        vec3 v = normalize(hq - ec);
        float cosA = dot(v, uLook);
        if (uCute > 0.5) {
          // big friendly eyes: white, iris, pupil, highlight; the lid closes when blinking
          vec3 alb = vec3(0.92);
          alb = mix(alb, vec3(0.15, 0.55, 0.25), smoothstep(0.86, 0.9, cosA));
          alb = mix(alb, vec3(0.01), smoothstep(0.94, 0.955, cosA));
          float lid = step(mix(1.2, -1.0, uBlink), v.y);
          col = light(p, n, rd, alb, 0.9, 80.0, 0.0, 0.0) * ao;
          col += vec3(1.0) * smoothstep(0.985, 0.995, dot(v, normalize(vec3(0.4, 0.5, 0.75))));
          col = mix(col, light(p, n, rd, skinAlbedo(p), 0.05, 6.0, 0.7, 0.0), lid);
        } else {
          // dull dead eyes deep in the sockets with a green glow, the bright point looks at you
          vec3 em = mix(vec3(0.1, 0.6, 0.25), vec3(0.75, 1.0, 0.6), smoothstep(0.8, 0.97, cosA)) * (0.03 + uEyes * 1.6);
          col = em + light(p, n, rd, vec3(0.12, 0.13, 0.1), 0.8, 90.0, 0.0, 0.0);
        }
      } else if (mat < 4.5) {
        // horns, claws, teeth
        // horns of the cute one; yellowed teeth and nails of the mummy
        vec3 alb = uCute > 0.5 ? vec3(0.95, 0.82, 0.5) : vec3(0.45, 0.38, 0.22) * (0.7 + 0.5 * fbm3(p * 80.0));
        col = light(p, n, rd, alb, 0.4, 40.0, 0.1, 0.0) * ao;
      } else if (mat > 5.5 && mat < 6.5) {
        // bare dried skin (finger tips)
        col = light(p, n, rd, skinAlbedo(p), 0.15, 20.0, 0.2, 0.0) * ao;
      } else if (mat > 6.5) {
        // loose strips of linen
        vec3 lin = vec3(0.55, 0.47, 0.34) * (0.6 + 0.5 * fbm3(p * 30.0));
        col = light(p, n, rd, lin, 0.02, 8.0, 0.6, 0.0) * ao;
      } else {
        // falling bits of plaster
        col = light(p, n, rd, vec3(0.45) * (0.7 + 0.6 * noise3(p * 90.0)), 0.05, 8.0, 0.0, 0.0) * ao;
      }
      // a little depth haze behind the wall
      col *= mix(1.0, 0.25, smoothstep(0.0, -0.9, p.z));
    }
  }

  // a guest's photo coming out of the hole: a picture plane leaning out of the wall
  if (uPhoto > 0.5 && uPhotoA > 0.0) {
    vec3 up = vec3(0.0, cos(uPhotoTilt), sin(uPhotoTilt));
    vec3 nn = vec3(0.0, -sin(uPhotoTilt), cos(uPhotoTilt));
    float dn = dot(rd, nn);
    if (abs(dn) > 1e-4) {
      float tp = dot(uPhotoB - ro, nn) / dn;
      if (tp > 0.0 && tp < tHit) {
        vec3 Xw = ro + rd * tp;
        vec3 X = Xw - uPhotoB;
        vec2 uv = vec2(X.x / uPhotoSize.x + 0.5, dot(X, up) / uPhotoSize.y);
        if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
          vec4 c = texture2D(uPhotoTex, uv);
          // rim light from the glow behind: where the outline falls off
          float e = 0.01;
          float am = min(min(texture2D(uPhotoTex, uv + vec2(e, 0.0)).a, texture2D(uPhotoTex, uv - vec2(e, 0.0)).a),
                         min(texture2D(uPhotoTex, uv + vec2(0.0, e)).a, texture2D(uPhotoTex, uv - vec2(0.0, e)).a));
          float rim = clamp(c.a - am, 0.0, 1.0);
          vec3 pc = pow(c.rgb, vec3(2.2)) * 0.7;
          pc += uGlowCol * rim * uGlow * 1.5;
          // deeper in the wall: darker
          pc *= mix(1.0, 0.3, smoothstep(0.0, -0.5, Xw.z));
          col = mix(col, pc, c.a * uPhotoA * smoothstep(0.0, 0.25, uv.y));
        }
      }
    }
  }

  // dust cloud after the burst, embers / sparkles drifting out of the hole
  if (uDebrisT >= 0.0) {
    float dt = uDebrisT;
    float r = far;
    float dust = fbm3(vec3(hw.xy * 3.0 - vec2(0.0, -dt * 0.3), dt * 0.4)) * exp(-r * r * 1.2) * exp(-dt * 0.9) * smoothstep(0.0, 0.15, dt);
    col += (uCute > 0.5 ? vec3(0.5, 0.47, 0.44) : vec3(0.55, 0.48, 0.36)) * dust * (0.12 + 0.3 * uGlow * (uCute > 0.5 ? 0.6 : 1.0));
  }
  if (uGlow > 0.02) {
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float life = 3.0 + 2.0 * hash1(fi * 4.1);
      float age = mod(uTime + hash1(fi * 2.3) * life, life);
      float a = fi * 2.399;
      vec4 hq = hh(int(mod(fi, max(uHN, 1.0))));
      vec2 s = hq.xy + vec2(cos(a), sin(a)) * (0.15 + 0.4 * hash1(fi)) * (0.4 + age * 0.3) * hq.zw;
      s.y += uCute > 0.5 ? age * 0.08 * sin(fi) : -age * 0.18;
      s.x += sin(age * 2.0 + fi) * 0.04;
      float k = exp(-dot(hw.xy - s, hw.xy - s) / (uCute > 0.5 ? 0.00012 : 0.00005));
      float tw = 0.5 + 0.5 * sin(uTime * 9.0 + fi * 3.0);
      col += (uCute > 0.5 ? mix(vec3(0.6, 0.9, 1.0), vec3(1.0, 0.7, 1.0), hash1(fi)) : vec3(0.75, 0.68, 0.5) * 0.6) * k * uGlow * tw *
             smoothstep(life, life * 0.6, age) * 1.5;
    }
  }

  col *= uFade;
  // filmic tone map + gamma
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Scene modules
// ---------------------------------------------------------------------------
const v3 = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);
export const speedOf = (s: DrawState) => Math.max(0.2, Number(s.params.speed ?? 1));
export const pauseOf = (s: DrawState) => Math.max(0, Number(s.params.pause ?? 6));

/** The scene clock as last rendered (for the sound, which runs outside the render loop). */
export const clocks: Record<string, { time: number; at: number; speed: number; loop: number }> = {};

export function uniformsFor(id: string, cute: boolean, guest?: GuestPhoto, figure?: GlbFigure, glow?: V3) {
  return (s: DrawState, f: { time: number }) => {
    const F = (s.cache.wmFrame as Frame | undefined) ?? (s.cache.wmFrame = frameOf(s));
    const speed = speedOf(s);
    const loop = LOOP + pauseOf(s);
    clocks[id] = { time: f.time, at: performance.now(), speed, loop };
    const a = (f.time * speed) % loop;
    const P = pose(a, cute, F.ro, s.params.ending !== 'fade');
    // arms: shoulder → elbow → wrist; the elbow relaxed (down, out, back) unless gripping
    const sl: V3 = add(P.body, [-0.27, 0.07, 0]);
    const sr: V3 = add(P.body, [0.27, 0.07, 0]);
    const elbowOf = (sh: V3, h: Hand, side: number): V3 => {
      const relaxed = add(mixV(sh, h.pos, 0.5), [side * 0.14, -0.13, -0.16]);
      // gripping the edge like climbing out over a ledge: the elbow is a hinge – it bends
      // backwards and down (behind the wall, inside the opening), never outwards
      let E = h.ik
        ? mixV(relaxed, elbowIK(sh, h.pos, 0.38, 0.38, [side * 0.35, -0.6, -0.75]), h.e ?? 0)
        : relaxed;
      if (h.elbow) E = mixV(E, h.elbow, h.e ?? 0);
      return E;
    };
    const elbL = elbowOf(sl, P.handL, -1);
    const elbR = elbowOf(sr, P.handR, 1);
    const HL = handFrame(elbL, P.handL.pos, P.handL, 1.45);
    const HR = handFrame(elbR, P.handR.pos, P.handR, 1.45);
    const elbow = (_sh: V3, _w: V3, side: number): V3 => (side < 0 ? elbL : elbR);
    // direction to the audience in head space (for the pupils)
    const toEye = sub(F.ro, P.head);
    const look = applyT(P.headR, scale(toEye, 1 / (Math.hypot(...toEye) || 1)));
    return {
      uRo: v3(F.ro),
      uP0: v3(F.p0),
      uPU: v3(F.pu),
      uPV: v3(F.pv),
      uFloorY: F.floorY,
      uCute: cute ? 1 : 0,
      uBulge: P.bulge,
      uCrack: P.crack,
      uHole: P.hole,
      uDebrisT: P.debrisT,
      uGlow: P.glow,
      uFade: P.fade,
      uEyes: P.eyes,
      uBlink: P.blink,
      uJaw: P.jaw,
      uHead: v3(P.head),
      // row-major R = column-major Rᵀ: local → head space
      uHeadM: P.headR,
      uNeck: v3(add(P.head, apply(P.headR, [0, -0.15, -0.07]))),
      uBody: v3(P.body),
      uHandL: v3(P.handL.pos),
      uHandLM: HL,
      uCurlL: P.handL.curl,
      uElbL: v3(elbow(sl, P.handL.pos, -1)),
      uHandR: v3(P.handR.pos),
      uHandRM: HR,
      uCurlR: P.handR.curl,
      uElbR: v3(elbow(sr, P.handR.pos, 1)),
      uLook: v3(look),
      uRib1: v3(add(P.head, apply(P.headR, [0.11, -0.03, 0.03]))),
      uRib2: v3(add(mixV(elbow(sl, P.handL.pos, -1), P.handL.pos, 0.55), [0, -0.03, 0])),
      uGlowCol: glow
        ? v3(glow)
        : cute
          ? new THREE.Vector3(0.55, 0.35, 1.0)
          : new THREE.Vector3(0.3, 0.95, 0.45),
      ...(guest
        ? guest.uniforms(a, Math.floor((f.time * speed) / loop))
        : { uPhoto: 0, uPhotoA: 0, uPhotoTex: NO_TEX as unknown as number }),
      // a real 3D model takes over once the wall is open (the drawn one only makes the bulge)
      uH0: new THREE.Vector4(HOLE_C[0], HOLE_C[1], 1, 1),
      uH1: new THREE.Vector4(0, 0, 1, 1),
      uHO: new THREE.Vector2(P.hole, 0),
      uHN: 1,
      uBlob: 0,
      uBlobY: 0,
      uHide: figure?.update(P, F, a) || (guest?.has(Math.floor((f.time * speed) / loop)) ?? false) ? 1 : 0,
    };
  };
}

export interface Cue {
  at: number;
  play: (snd: SoundApi) => void;
}

const MUMMY_SOUND: Cue[] = [
  { at: 1.0, play: (s) => s.knock({ count: 3, gain: 0.55, spacing: 0.5 }) },
  { at: 3.7, play: (s) => s.knock({ count: 2, gain: 0.6, spacing: 0.45 }) },
  { at: 5.0, play: (s) => s.rumble({ duration: 3.5, gain: 0.3 }) },
  { at: 8.4, play: (s) => s.whoosh({ duration: 2.0, from: 200, to: 90, gain: 0.25 }) },
  ...PUSHES.map((at) => ({ at, play: (s: SoundApi) => s.knock({ count: 1, gain: 0.45 }) })),
  { at: 10.6, play: (s) => s.knock({ count: 4, gain: 0.25, spacing: 0.06 }) },
  { at: 11.5, play: (s) => s.scuttle({ duration: 0.8, gain: 0.25 }) },
  { at: 12.4, play: (s) => s.knock({ count: 5, gain: 0.3, spacing: 0.05 }) },
  {
    at: 13.5,
    play: (s) => {
      s.rumble({ duration: 2.2, gain: 0.55 });
      s.whoosh({ duration: 1.6, from: 500, to: 90, gain: 0.5 });
      s.knock({ count: 7, gain: 0.45, spacing: 0.05 });
      s.pop({ freq: 110, gain: 0.45 });
    },
  },
  { at: 14.4, play: (s) => s.knock({ count: 6, gain: 0.22, spacing: 0.09 }) },
  { at: 15.0, play: (s) => s.whoosh({ duration: 3.0, from: 1200, to: 600, gain: 0.12 }) },
  { at: 16.2, play: (s) => s.ooh({ duration: 2.4, base: 105, gain: 0.3 }) },
  { at: 21.2, play: (s) => s.scuttle({ duration: 0.7, gain: 0.25 }) },
  { at: 23.2, play: (s) => s.scuttle({ duration: 0.7, gain: 0.25 }) },
  {
    at: 28.2,
    play: (s) => {
      s.ooh({ duration: 4.0, base: 92, gain: 0.55 });
      s.ooh({ duration: 3.6, base: 124, gain: 0.25 });
      s.rumble({ duration: 3.5, gain: 0.3 });
      s.whoosh({ duration: 3.5, from: 900, to: 400, gain: 0.15 });
    },
  },
  { at: 35.5, play: (s) => s.ooh({ duration: 2.4, base: 98, gain: 0.3 }) },
  { at: 36.0, play: (s) => s.whoosh({ duration: 2.2, from: 300, to: 60, gain: 0.25 }) },
];

const CUTE_SOUND: Cue[] = [
  { at: 1.0, play: (s) => s.knock({ count: 3, gain: 0.35, spacing: 0.35 }) },
  { at: 3.7, play: (s) => s.knock({ count: 2, gain: 0.35, spacing: 0.3 }) },
  ...PUSHES.map((at) => ({ at, play: (s: SoundApi) => s.pop({ freq: 260, gain: 0.25 }) })),
  { at: 11.0, play: (s) => s.pop({ freq: 520, gain: 0.25 }) },
  { at: 12.6, play: (s) => s.pop({ freq: 620, gain: 0.25 }) },
  {
    at: 13.5,
    play: (s) => {
      s.pop({ freq: 300, gain: 0.5 });
      s.whoosh({ duration: 0.8, from: 600, to: 200, gain: 0.3 });
      s.chime({ gain: 0.3 });
      s.knock({ count: 5, gain: 0.2, spacing: 0.06 });
    },
  },
  { at: 16.0, play: (s) => s.ooh({ duration: 1.6, base: 330, gain: 0.25 }) },
  { at: 26.2, play: (s) => s.chime({ notes: [784, 988, 1175], gain: 0.25 }) },
  {
    at: 27.0,
    play: (s) =>
      s.arpeggio({ notes: [784, 880, 988, 1175, 988, 1175], gain: 0.22, step: 0.09, wave: 'triangle' }),
  },
  {
    at: 35.5,
    play: (s) => s.arpeggio({ notes: [1175, 988, 784, 587], gain: 0.2, step: 0.12, wave: 'sine' }),
  },
];

const GUEST_SOUND: Cue[] = [
  { at: 1.0, play: (s) => s.knock({ count: 3, gain: 0.45, spacing: 0.4 }) },
  { at: 3.7, play: (s) => s.knock({ count: 2, gain: 0.45, spacing: 0.35 }) },
  ...PUSHES.map((at) => ({ at, play: (s: SoundApi) => s.knock({ count: 1, gain: 0.35 }) })),
  { at: 11.0, play: (s) => s.pop({ freq: 300, gain: 0.25 }) },
  { at: 12.4, play: (s) => s.knock({ count: 4, gain: 0.25, spacing: 0.06 }) },
  {
    at: 13.5,
    play: (s) => {
      s.rumble({ duration: 1.8, gain: 0.45 });
      s.whoosh({ duration: 1.0, from: 500, to: 120, gain: 0.4 });
      s.knock({ count: 6, gain: 0.35, spacing: 0.05 });
      s.chime({ gain: 0.25 });
    },
  },
  { at: 16.0, play: (s) => s.ooh({ duration: 2.4, base: 220, gain: 0.3 }) },
  { at: 26.0, play: (s) => s.ooh({ duration: 2.0, base: 180, gain: 0.25 }) },
  { at: 35.5, play: (s) => s.whoosh({ duration: 2.0, from: 400, to: 80, gain: 0.3 }) },
];

export function soundFor(id: string, cues: Cue[]) {
  return (snd: SoundApi) => {
    let last = -1;
    const timer = window.setInterval(() => {
      const c = clocks[id];
      if (!c || performance.now() - c.at > 1500) return;
      const now = c.time + (performance.now() - c.at) / 1000;
      const a = (now * c.speed) % c.loop;
      if (last >= 0) {
        const wrapped = a < last;
        for (const cue of cues) {
          if ((!wrapped && cue.at > last && cue.at <= a) || (wrapped && (cue.at > last || cue.at <= a)))
            cue.play(snd);
        }
      }
      last = a;
    }, 80);
    return () => window.clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------
// Real 3D figures (rigged GLB, Mixamo skeleton)
// ---------------------------------------------------------------------------
const HOLE_GLSL = /* glsl */ `
uniform vec4 uH0, uH1;
uniform vec2 uHO;
uniform float uHN;
varying vec3 vWallPos;
`;

/** The holes in the wall, shared by the wall shader settings and the figures' materials. */
export interface HoleUniforms {
  uH0: { value: THREE.Vector4 };
  uH1: { value: THREE.Vector4 };
  uHO: { value: THREE.Vector2 };
  uHN: { value: number };
}
export function makeHoles(): HoleUniforms {
  return {
    uH0: { value: new THREE.Vector4(HOLE_C[0], HOLE_C[1], 1, 1) },
    uH1: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHO: { value: new THREE.Vector2(0, 0) },
    uHN: { value: 1 },
  };
}

/**
 * A figure's material: hidden behind the wall except through a hole, darker deeper inside.
 * `extra` may add uniforms / code (e.g. a guest's face).
 */
export function occludeMaterial(
  mat: THREE.MeshStandardMaterial,
  holes: HoleUniforms,
  extra?: (sh: THREE.WebGLProgramParametersWithUniforms) => void,
) {
  mat.side = THREE.FrontSide;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, holes);
    sh.vertexShader =
      HOLE_GLSL +
      sh.vertexShader.replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n  vWallPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    sh.fragmentShader =
      HOLE_GLSL +
      sh.fragmentShader
        .replace(
          '#include <clipping_planes_fragment>',
          `#include <clipping_planes_fragment>
  if (vWallPos.z < 0.0) {
    float inside = -1.0;
    for (int i = 0; i < 2; i++) {
      if (float(i) >= uHN) break;
      vec4 h = i == 0 ? uH0 : uH1;
      vec2 q = (vWallPos.xy - h.xy) / h.zw;
      float th = atan(q.y, q.x);
      float R = (i == 0 ? uHO.x : uHO.y) * (0.62 + 0.06 * sin(th * 3.0 + 1.3) + 0.04 * sin(th * 7.0 + 0.4) + 0.025 * sin(th * 13.0 + 2.1));
      inside = max(inside, (R - length(q)) * min(h.z, h.w) - 0.015);
    }
    if (inside < 0.0) discard;
  }`,
        )
        .replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n  gl_FragColor.rgb *= mix(1.0, 0.3, smoothstep(0.0, -0.6, vWallPos.z));',
        );
    extra?.(sh);
  };
  mat.needsUpdate = true;
}

/** Shared tone curve + gamma (as the wall shader) for drawing the figure over the wall. */
export const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float uFade;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a <= 0.001) discard;
  vec3 col = c.rgb / c.a * uFade;
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col, c.a);
}
`;

const loaders: Record<string, Promise<THREE.Group | null>> = {};
export function loadModel(url: string): Promise<THREE.Group | null> {
  return (loaders[url] ??= import('three/examples/jsm/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync(url))
    .then((g) => g.scene)
    .catch((e: unknown) => {
      console.warn('[wallMonster] model failed', url, e);
      return null;
    }));
}

const qv = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);
/** A 1×1 placeholder so no sampler is left unbound. */
export const NO_TEX = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
NO_TEX.needsUpdate = true;

interface ArmRig {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  l1: number;
  l2: number;
  /** In the hand bone's own space: where the fingers point and where the palm faces (bind pose). */
  finger: THREE.Vector3;
  palm: THREE.Vector3;
  /** Bind pose (T-pose, world): arm direction, the way the elbow flexes (forwards), bone rotations. */
  a0: THREE.Vector3;
  f0: THREE.Vector3;
  upperQ0: THREE.Quaternion;
  foreQ0: THREE.Quaternion;
}

/**
 * A rigged figure that comes out of the hole: placed with the chest where the pose wants the
 * body, the head turned towards the audience, the arms solved as real two-bone limbs (the elbow a
 * hinge, the hand following the forearm) – each hand is its own hand, so thumbs are where they
 * belong. Seen through the same off-axis camera as the wall (from the audience standpoint);
 * hidden behind the wall except through the hole.
 */
export class GlbFigure {
  private scene = new THREE.Scene();
  private root = new THREE.Group();
  private model: THREE.Group | null = null;
  private bind = new Map<THREE.Object3D, THREE.Quaternion>();
  private bones: Record<string, THREE.Bone> = {};
  private arms: { R: ArmRig; L: ArmRig } | null = null;
  private hipsBind = new THREE.Vector3();
  private headH = 1;
  private rootQ = new THREE.Quaternion();
  private size = 1;
  private camera = new THREE.PerspectiveCamera();
  private rt: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh | null = null;
  private quadScene = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private holes = makeHoles();
  private glowLight = new THREE.PointLight(0xffffff, 0, 0, 2);
  private key = new THREE.DirectionalLight(0xfff0dd, 1.6);
  private fill = new THREE.HemisphereLight(0x8899bb, 0x110808, 0.25);
  private visible = false;
  private fade = 1;
  private disposed = false;

  constructor(
    url: string,
    private readonly cute: boolean,
    private readonly glow: V3,
  ) {
    this.scene.add(this.root, this.glowLight, this.key, this.key.target, this.fill);
    this.key.position.set(KEY_POS[0], KEY_POS[1], KEY_POS[2]);
    this.glowLight.position.set(HOLE_C[0], HOLE_C[1], -0.45);
    void loadModel(url).then((g) => {
      if (!g || this.disposed) return;
      this.setup(g.clone(true));
    });
  }

  private setup(g: THREE.Group) {
    // clone of a skinned model: re-bind the skeleton to the cloned bones
    const byName: Record<string, THREE.Bone> = {};
    g.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName[o.name.replace(/^mixamorig:?/, '')] = o as THREE.Bone;
    });
    g.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        m.frustumCulled = false;
        m.skeleton = new THREE.Skeleton(
          m.skeleton.bones.map((b) => byName[b.name.replace(/^mixamorig:?/, '')] ?? b),
          m.skeleton.boneInverses,
        );
        m.bind(m.skeleton, m.bindMatrix);
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) occludeMaterial(mat as THREE.MeshStandardMaterial, this.holes);
      }
    });
    this.bones = byName;
    const need = [
      'Hips',
      'Spine2',
      'Neck',
      'Head',
      'LeftArm',
      'LeftForeArm',
      'LeftHand',
      'RightArm',
      'RightForeArm',
      'RightHand',
    ];
    if (need.some((n) => !byName[n])) {
      console.warn('[wallMonster] model has no Mixamo skeleton');
      return;
    }
    g.updateMatrixWorld(true);
    g.traverse((o) => this.bind.set(o, o.quaternion.clone()));
    const wp = (n: string) => byName[n]!.getWorldPosition(new THREE.Vector3());
    // size: shoulder width as wide as the drawn monster's (so it fits the hole)
    const shoulders = wp('LeftArm').distanceTo(wp('RightArm'));
    this.size = (this.cute ? 0.56 : 0.56) / Math.max(1e-3, shoulders);
    this.hipsBind = wp('Hips');
    this.headH = wp('Head').y - this.hipsBind.y;
    const arm = (side: 'Left' | 'Right'): ArmRig => {
      const up = byName[side + 'Arm']!;
      const fo = byName[side + 'ForeArm']!;
      const ha = byName[side + 'Hand']!;
      const a = wp(side + 'Arm');
      const b = wp(side + 'ForeArm');
      const c = wp(side + 'Hand');
      const hq = ha.getWorldQuaternion(new THREE.Quaternion()).invert();
      // T-pose: fingers continue the arm, palms face down
      const finger = c.clone().sub(b).normalize().applyQuaternion(hq);
      const palm = new THREE.Vector3(0, -1, 0).applyQuaternion(hq);
      const a0 = b.clone().sub(a).normalize();
      // an elbow flexes forwards (towards the front of the body) in the T-pose
      const f0 = new THREE.Vector3(0, 0, 1).sub(a0.clone().multiplyScalar(a0.z)).normalize();
      return {
        upper: up,
        fore: fo,
        hand: ha,
        l1: a.distanceTo(b),
        l2: b.distanceTo(c),
        finger,
        palm,
        a0,
        f0,
        upperQ0: up.getWorldQuaternion(new THREE.Quaternion()),
        foreQ0: fo.getWorldQuaternion(new THREE.Quaternion()),
      };
    };
    this.arms = { R: arm('Left'), L: arm('Right') }; // the figure faces us: its left hand is on our right
    this.model = g;
    this.root.add(g);
  }

  /** Puts the figure into the pose; true when it is shown (the wall is open and it has loaded). */
  update(P: Pose, F: Frame, a: number): boolean {
    this.visible = !!(this.model && this.arms && P.hole > 0.001 && a >= 13.5);
    this.fade = P.fade;
    this.holes.uHO.value.set(P.hole, 0);
    this.glowLight.color.setRGB(this.glow[0], this.glow[1], this.glow[2]);
    this.glowLight.intensity = P.glow * 1.2;
    // camera: from the eye point through the wall rectangle (off-axis)
    const ro = F.ro;
    const near = 0.05;
    const k = near / Math.max(0.1, ro[2]);
    const x0 = F.p0[0];
    const x1 = F.p0[0] + F.pu[0];
    const y0 = F.p0[1];
    const y1 = F.p0[1] + F.pv[1];
    this.camera.position.set(ro[0], ro[1], ro[2]);
    this.camera.quaternion.identity();
    this.camera.projectionMatrix.makePerspective(
      (x0 - ro[0]) * k,
      (x1 - ro[0]) * k,
      (y0 - ro[1]) * k,
      (y1 - ro[1]) * k,
      near,
      50,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
    if (!this.visible || !this.model || !this.arms) return this.visible;

    // back to the bind pose, then: place, turn the head, solve the arms
    for (const [o, q] of this.bind) o.quaternion.copy(q);
    // the hips stay behind the wall; the body leans forward out of the hole so the head gets
    // where the pose wants it (nothing below the hole can come through the wall)
    const s = this.size;
    const zh = this.cute ? -0.55 : -0.5;
    const hh = this.headH * s;
    const lean = Math.asin(Math.max(-0.2, Math.min(0.75, (P.head[2] - zh) / hh)));
    this.rootQ.setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
    const hips = new THREE.Vector3(
      P.head[0],
      P.head[1] - hh * Math.cos(lean) - (this.cute ? 0.05 : 0.08),
      zh,
    );
    this.root.scale.setScalar(s);
    this.root.quaternion.copy(this.rootQ);
    this.root.position.copy(hips).sub(this.hipsBind.clone().multiplyScalar(s).applyQuaternion(this.rootQ));
    this.root.updateMatrixWorld(true);
    // head: towards where the pose looks (neck takes a part)
    const look = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().set(
        P.headR[0]!,
        P.headR[1]!,
        P.headR[2]!,
        0,
        P.headR[3]!,
        P.headR[4]!,
        P.headR[5]!,
        0,
        P.headR[6]!,
        P.headR[7]!,
        P.headR[8]!,
        0,
        0,
        0,
        0,
        1,
      ),
    );
    // (the lean already tips the head forward – take it out again)
    look.multiply(this.rootQ.clone().invert());
    this.turn(this.bones.Neck!, new THREE.Quaternion().slerp(look, 0.4));
    this.turn(this.bones.Head!, new THREE.Quaternion().slerp(look, 0.6));
    this.solveArm(this.arms.L, P.handL, -1);
    this.solveArm(this.arms.R, P.handR, 1);
    return true;
  }

  /** Adds a world-space rotation to a bone. */
  private turn(b: THREE.Object3D, q: THREE.Quaternion) {
    const wq = b.getWorldQuaternion(new THREE.Quaternion());
    this.setWorldQ(b, q.clone().multiply(wq));
  }

  private setWorldQ(b: THREE.Object3D, wq: THREE.Quaternion) {
    const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    b.quaternion.copy(pq.invert().multiply(wq));
    b.updateMatrixWorld(true);
  }

  private solveArm(rig: ArmRig, h: Hand, side: number) {
    const s = this.size;
    const S = rig.upper.getWorldPosition(new THREE.Vector3());
    const Sv: V3 = [S.x, S.y, S.z];
    // where the hand goes: the pose's wrist, pulled in if the arm is too short
    let W = h.pos;
    const reach = (rig.l1 + rig.l2) * s * 0.98;
    const d = sub(W, Sv);
    const dist = Math.hypot(...d);
    if (dist > reach) W = add(Sv, scale(d, reach / dist));
    // the elbow: hanging relaxed, or a real hinge bending back and down when gripping
    const relaxed: V3 = add(mixV(Sv, W, 0.5), [side * 0.12, -0.14, -0.12]);
    // the elbow may not be inside the wall: try where it can point (back, down, out, forward) and
    // take the first that stays in the opening or in front of the wall
    const poles: V3[] = h.elbow
      ? [[side * 0.6, -1, 0]]
      : [
          [side * 0.35, -0.6, -0.75],
          [side * 0.4, -1, -0.2],
          [side * 1, -0.6, 0],
          [side * 0.8, -0.4, 0.5],
          [side * 0.3, -0.3, 1],
        ];
    const free = (e: V3) => {
      if (e[2] >= 0.02) return true;
      const dx = e[0] - HOLE_C[0];
      const dy = e[1] - HOLE_C[1];
      return Math.hypot(dx, dy) < holeR(Math.atan2(dy, dx)) - 0.09;
    };
    let ik = elbowIK(Sv, W, rig.l1 * s, rig.l2 * s, poles[0]!);
    for (const pole of poles) {
      const e = elbowIK(Sv, W, rig.l1 * s, rig.l2 * s, pole);
      if (free(e)) {
        ik = e;
        break;
      }
    }
    const E = h.ik || h.elbow ? mixV(relaxed, ik, h.e ?? 0) : relaxed;
    // the elbow is a hinge: the upper arm points at the elbow, turned so the forearm can only
    // fold forwards (the elbow tip points back), the forearm then turns about the hinge axis only
    const u = qv(E).sub(S).normalize();
    const fw = qv(W).sub(qv(E));
    let v = fw.clone().sub(u.clone().multiplyScalar(fw.dot(u)));
    if (v.length() < 1e-4) {
      // straight arm: the elbow tip points to the pole, so it folds the other way
      const pole = qv(h.elbow ? [side * 0.6, -1, 0] : [side * 0.35, -0.6, -0.75]);
      v = pole.sub(u.clone().multiplyScalar(pole.dot(u))).negate();
    }
    v.normalize();
    const rq = this.rootQ;
    const a0 = rig.a0.clone().applyQuaternion(rq);
    const f0 = rig.f0.clone().applyQuaternion(rq);
    const R = basisQ(u, v).multiply(basisQ(a0, f0).invert());
    this.setWorldQ(rig.upper, R.clone().multiply(rq.clone().multiply(rig.upperQ0)));
    const axis = new THREE.Vector3().crossVectors(u, v).normalize();
    const w = fw.normalize();
    const bend = Math.atan2(w.dot(v), w.dot(u));
    const R2 = new THREE.Quaternion().setFromAxisAngle(axis, bend).multiply(R);
    this.setWorldQ(rig.fore, R2.multiply(rq.clone().multiply(rig.foreQ0)));
    // the hand: fingers and palm as the pose wants, bent at the wrist as far as a wrist goes
    const M = handFrame(E, W, h, 1.45);
    const fingers = new THREE.Vector3(M[1], M[4], M[7]);
    const back = new THREE.Vector3(M[2], M[5], M[8]);
    const palm = back.clone().negate();
    const want = basisQ(fingers, palm);
    const have = basisQ(rig.finger, rig.palm);
    // world rotation that maps the hand's own finger/palm axes onto the wanted ones
    this.setWorldQ(rig.hand, want.multiply(have.invert()));
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    if (!this.visible || !this.model) return;
    const w = target.width;
    const h = target.height;
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
      if (!this.quad) {
        this.quad = new THREE.Mesh(
          new THREE.PlaneGeometry(2, 2),
          new THREE.ShaderMaterial({
            uniforms: { map: { value: null }, uFade: { value: 1 } },
            vertexShader:
              'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
            fragmentShader: COMPOSITE_FRAG,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          }),
        );
        this.quad.frustumCulled = false;
        this.quadScene.add(this.quad);
      }
    }
    const prevAuto = r.autoClear;
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    const qm = this.quad!.material as THREE.ShaderMaterial;
    qm.uniforms.map!.value = this.rt.texture;
    qm.uniforms.uFade!.value = this.fade;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.ortho);
    r.autoClear = prevAuto;
    r.setClearColor(prevColor, prevAlpha);
  }

  dispose() {
    this.disposed = true;
    this.rt?.dispose();
    this.quad?.geometry.dispose();
    (this.quad?.material as THREE.Material | undefined)?.dispose();
    // geometry / textures are shared through the loader cache (cloned scene) – kept for reuse
  }
}

/** Rotation whose x/y/z axes are (y × z, y, z) for the given y (fingers) and z (palm). */
export function basisQ(y: THREE.Vector3, z: THREE.Vector3): THREE.Quaternion {
  const Y = y.clone().normalize();
  const Z = z
    .clone()
    .sub(Y.clone().multiplyScalar(z.dot(Y)))
    .normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
}

/**
 * The guest whose photo comes out of the wall this round: the newest one not shown yet, else the
 * one shown longest ago. No photos (or not loaded yet) → the cute monster comes instead.
 */
export class GuestPhoto {
  private shown = new Map<string, number>();
  private round = -1;
  private id: string | null = null;
  private tex: THREE.Texture | null = null;
  private texId: string | null = null;
  private aspect = 0.66;
  constructor(private readonly photos: ScenePhotos | undefined) {}

  /** True when a photo is ready for this round (else the cute monster plays). */
  has(round: number): boolean {
    this.pick(round);
    return !!this.tex;
  }

  private pick(round: number) {
    if (!this.photos) return;
    if (round !== this.round) {
      this.round = round;
      // ghost pictures (filter / AI), not the plain photos
      const list = this.photos.list().filter((p) => p.kind !== 'original');
      const fresh = list.find((p) => !this.shown.has(p.id));
      const next =
        fresh ?? [...list].sort((a, b) => (this.shown.get(a.id) ?? 0) - (this.shown.get(b.id) ?? 0))[0];
      this.id = next?.id ?? null;
      if (this.id) this.shown.set(this.id, round + 1);
    }
    if (this.id && this.texId !== this.id) {
      const pic = this.photos.get(this.id);
      if (pic) {
        this.tex?.dispose();
        this.tex = new THREE.Texture(pic.img as TexImageSource as never);
        this.tex.colorSpace = THREE.NoColorSpace;
        this.tex.needsUpdate = true;
        this.texId = this.id;
        this.aspect = pic.img.width / Math.max(1, pic.img.height);
      }
    }
    if (!this.id && this.tex) {
      this.tex.dispose();
      this.tex = null;
      this.texId = null;
    }
  }

  uniforms(a: number, round: number): Record<string, number | THREE.Vector2 | THREE.Vector3> {
    if (!this.has(round) || !this.tex) return { uPhoto: 0, uPhotoA: 0 };
    // comes out leaning forward, stays, comes a little closer, sinks back
    const out = ease(a, 13.5, 15.8);
    const lean = ease(a, 15.5, 19);
    const close = ease(a, 25.5, 29) * (1 - ease(a, 33, 35));
    const back = ease(a, 35.5, 39.5);
    const H = 1.05 * (1 + 0.06 * close);
    const zb = mix(mix(-0.6, -0.12, out), -0.02, lean) + 0.12 * close - 0.8 * back;
    const sway = 0.02 * Math.sin(a * 0.9);
    return {
      uPhoto: 1,
      uPhotoA: ease(a, 13.5, 14.2) * (1 - ease(a, 39, 40.5)),
      uPhotoTilt: mix(0.05, 0.32, lean) * (1 - back) + 0.04 * Math.sin(a * 0.7),
      uPhotoB: new THREE.Vector3(sway, -0.78, zb),
      uPhotoSize: new THREE.Vector2(H * this.aspect, H),
      uPhotoTex: this.tex as unknown as number,
    };
  }

  dispose() {
    this.tex?.dispose();
  }
}

/** A guest's photo breaks out of the wall (no photos yet: the cute monster). */
function guestBreakout(id: string): SceneModule {
  const sound = soundFor(id, GUEST_SOUND);
  return {
    id,
    ambientSound: sound,
    create: (ctx) => {
      const guest = new GuestPhoto(ctx.photos);
      const base = uniformsFor(id, true, guest);
      const inst = shaderScene(id, WALL_MONSTER_FRAG, base, { shaderScale: 0.6 }).create(ctx);
      return {
        render: (t, f) => inst.render(t, f),
        resize: (w, h, ppm) => inst.resize(w, h, ppm),
        setParams: (p) => inst.setParams(p),
        dispose: () => {
          guest.dispose();
          inst.dispose();
        },
      };
    },
  };
}

function breakout(id: string, cute: boolean, model?: string, glow?: V3): SceneModule {
  const sound = soundFor(id, cute ? CUTE_SOUND : MUMMY_SOUND);
  if (!model)
    return shaderScene(id, WALL_MONSTER_FRAG, uniformsFor(id, cute), {
      shaderScale: 0.6,
      ambientSound: sound,
    });
  const glowCol: V3 = glow ?? (cute ? [0.55, 0.35, 1.0] : [0.3, 0.95, 0.45]);
  return {
    id,
    ambientSound: sound,
    create: (ctx) => {
      const figure = new GlbFigure(model, cute, glowCol);
      const wall = shaderScene(id, WALL_MONSTER_FRAG, uniformsFor(id, cute, undefined, figure, glowCol), {
        shaderScale: 0.6,
      }).create(ctx);
      return {
        render: (t, f) => {
          wall.render(t, f);
          figure.render(ctx.renderer, t);
        },
        resize: (w, h, ppm) => wall.resize(w, h, ppm),
        setParams: (p) => wall.setParams(p),
        dispose: () => {
          figure.dispose();
          wall.dispose();
        },
      };
    },
  };
}

export const wallMonsterScenes: SceneModule[] = [
  breakout('wallMummy', false, '/models/mummy.glb'),
  // old id (the demon was replaced by the mummy): shows the mummy
  breakout('wallDemon', false, '/models/mummy.glb'),
  breakout('wallBuddy', true, '/models/cute-monster.glb'),
  breakout('wallGroom', false, '/models/groom.glb', [1.0, 0.18, 0.1]),
  guestBreakout('wallGuest'),
];
