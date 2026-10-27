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
 * and passed as uniforms; the shader only draws. Two monsters: a demon and a cute one for kids.
 */
import * as THREE from 'three';
import { shaderScene, type DrawState, type SceneModule } from '@spectrastage/engine';
import type { SoundApi } from '@spectrastage/engine';

type V3 = [number, number, number];

const LOOP = 44;

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
interface Frame {
  /** Eye point (local). */
  ro: V3;
  /** Pixel (u, v from top) → local point on the wall: p0 + pu·u + pv·v. */
  p0: V3;
  pu: V3;
  pv: V3;
  /** Floor height (local y). */
  floorY: number;
}

function frameOf(s: DrawState): Frame {
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
}

const KNOCKS = [1.0, 1.45, 1.9, 3.7, 4.1];
const PUSHES = [9.4, 10.9, 12.3];

function lookAngles(from: V3, to: V3): [number, number] {
  const d = sub(to, from);
  return [Math.atan2(d[0], d[2]), Math.atan2(d[1], Math.hypot(d[0], d[2]))];
}

/** Hand coming out of the hole (e: 0 inside … 1 gripping the wall). side −1 = left. */
function emerge(side: number, e: number, grip: V3): Hand {
  const inside: V3 = [side * 0.22, -0.25, -0.38];
  const pos = mixV(inside, grip, e);
  pos[2] += 0.13 * Math.sin(Math.PI * e);
  return {
    pos,
    yaw: 0,
    pitch: mix(1.25, 0, e),
    roll: -side * mix(0.3, 1.1, e),
    curl: mix(0.5, 0.65, e),
  };
}

function pose(a: number, cute: boolean, ro: V3): Pose {
  // --- the wall
  const bulge = ease(a, 5, 8.5);
  const crack = ease(a, 10.4, 13.4);
  const hole = ease(a, 13.5, 13.95);
  const debrisT = a >= 13.5 && a < 18 ? a - 13.5 : -1;
  const flash = a >= 13.5 ? Math.exp(-(a - 13.5) * 2.5) : 0;
  const glow =
    (0.18 * ease(a, 10.4, 13.4) + 0.82 * hole + 0.8 * flash) *
    (1 - ease(a, 38.5, 41.5)) *
    (0.9 + 0.1 * Math.sin(a * 13.1) * Math.sin(a * 7.3));
  const fade = ease(a, 0, 1.2) * (1 - ease(a, 41.5, 44));

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
    // roar: jaw open, head shakes
    const roar = ease(a, 28.4, 28.9) * (1 - ease(a, 31.6, 32.3));
    jaw = roar + 0.15 * ease(a, 16, 17) * (1 - ease(a, 35, 36));
    yaw += roar * 0.05 * Math.sin(a * 31);
    roll = roar * 0.06 * Math.sin(a * 23) + 0.22 * ease(a, 32.3, 33.5) * (1 - ease(a, 35, 36));
    pitch += roar * 0.12;
    eyes *= 0.85 + 0.15 * Math.sin(a * 9) + 0.4 * roar;
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
    const grip: V3 = [side * 0.72, side < 0 ? 0.05 : -0.03, 0.028];
    const e = ease(a, t0, t0 + 2.5) * (1 - ease(a, 35.5, 38.5));
    const h = e > 0 ? emerge(side, e, grip) : hidden(side);
    h.curl += scratch * (side < 0 ? 1 : -1);
    return h;
  };
  const handL = handAt(-1, 21);
  let handR = handAt(1, 23);
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
      };
    }
  }
  return { bulge, crack, hole, debrisT, glow, fade, eyes, blink, jaw, head, headR, body, handL, handR };
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
uniform vec3 uGlowCol;

#define HOLE_C vec2(0.0, -0.08)
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
vec2 headDemon(vec3 q) {
  vec3 qa = vec3(abs(q.x), q.y, q.z);
  // skull: high cranium, narrow long face, strong chin
  float d = sdEll(q - vec3(0.0, 0.07, -0.035), vec3(0.155, 0.18, 0.185));
  d = smin(d, sdEll(q - vec3(0.0, -0.06, 0.045), vec3(0.12, 0.125, 0.14)), 0.07);
  d = smin(d, length(qa - vec3(0.092, -0.005, 0.098)) - 0.042, 0.035);        // cheekbones
  d = smax(d, -(length(qa - vec3(0.105, -0.075, 0.115)) - 0.035), 0.04);     // hollow cheeks
  // heavy brow ridge, low over the eyes
  d = smin(d, sdCap(qa, vec3(0.0, 0.058, 0.162), vec3(0.115, 0.075, 0.118), 0.03), 0.035);
  d = smin(d, sdCap(q, vec3(0.0, 0.07, 0.15), vec3(0.0, 0.17, 0.12), 0.018), 0.04); // ridge up the forehead
  d = smax(d, -(length(qa - vec3(0.056, 0.022, 0.17)) - 0.036), 0.02);       // deep eye sockets
  // flat nasal ridge with slits (no human nose)
  d = smin(d, sdCap(q, vec3(0.0, 0.03, 0.17), vec3(0.0, -0.035, 0.188), 0.015), 0.03);
  d = smax(d, -sdCap(qa, vec3(0.012, -0.022, 0.19), vec3(0.02, -0.045, 0.19), 0.005), 0.005);
  // pointed ears
  d = smin(d, sdCapT(qa, vec3(0.145, 0.02, -0.03), vec3(0.26, 0.12, -0.11), 0.03, 0.003), 0.025);
  // jaw on its hinge
  float ja = uJaw * 0.5;
  vec3 jq = q - vec3(0.0, -0.04, -0.05);
  jq.yz = mat2(cos(ja), -sin(ja), sin(ja), cos(ja)) * jq.yz;
  jq += vec3(0.0, -0.04, -0.05);
  float mouth = sdEll(q - vec3(0.0, -0.105, 0.115), vec3(0.085, 0.016 + 0.06 * uJaw, 0.09));
  d = smax(d, -mouth, 0.01);
  float jaw = sdEll(jq - vec3(0.0, -0.155, 0.05), vec3(0.1, 0.05, 0.125));
  jaw = smin(jaw, length(jq - vec3(0.0, -0.19, 0.12)) - 0.03, 0.04);           // chin
  d = smin(d, jaw, 0.025);
  // skin: wrinkles, folds, bumps
  if (d < 0.03) {
    d += (fbm3(q * 26.0) - 0.5) * 0.008;
    d += sin(q.y * 150.0 + fbm3(q * 8.0) * 7.0) * 0.0014 * smoothstep(0.06, 0.13, q.y);   // forehead
    d -= smoothstep(0.02, 0.0, abs(fbm3(q * 7.0 + 4.0) - 0.5)) * 0.0025;                 // creases
  }
  float mat = 2.0;
  float eye = length(qa - vec3(0.056, 0.022, 0.152)) - 0.025;
  if (eye < d) { d = eye; mat = 3.0; }
  // horns: bent, tapering, ridged
  vec3 h0 = vec3(0.09, 0.15, 0.0), h1 = vec3(0.135, 0.205, -0.03), h2 = vec3(0.17, 0.275, -0.085),
       h3 = vec3(0.175, 0.345, -0.165), h4 = vec3(0.15, 0.385, -0.245);
  float rg = 1.0 + 0.07 * sin(length(qa - h0) * 120.0);
  float horn = sdCapT(qa, h0, h1, 0.042 * rg, 0.032 * rg);
  horn = smin(horn, sdCapT(qa, h1, h2, 0.032 * rg, 0.022 * rg), 0.01);
  horn = smin(horn, sdCapT(qa, h2, h3, 0.022 * rg, 0.012), 0.008);
  horn = smin(horn, sdCapT(qa, h3, h4, 0.012, 0.002), 0.005);
  if (horn < d) { d = horn; mat = 4.0; }
  // rows of teeth: upper on the head, lower on the jaw, long fangs at the corners
  float teeth = 1e5;
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = 0.008 + fi * 0.014;
    float zf = 0.172 - fi * fi * 0.0035;
    float len = fi == 3.0 ? 0.05 : 0.022 + 0.004 * fi;
    teeth = min(teeth, sdCapT(qa, vec3(x, -0.097, zf), vec3(x * 0.95, -0.097 - len, zf + 0.004), 0.0065 + fi * 0.0008, 0.001));
  }
  vec3 jqa = vec3(abs(jq.x), jq.y, jq.z);
  for (int i = 0; i < 5; i++) {
    float fi = float(i);
    float x = 0.012 + fi * 0.014;
    float zf = 0.158 - fi * fi * 0.0035;
    float len = fi == 2.0 ? 0.04 : 0.018;
    teeth = min(teeth, sdCapT(jqa, vec3(x, -0.13, zf), vec3(x, -0.13 + len, zf + 0.004), 0.006, 0.001));
  }
  if (teeth < d) { d = teeth; mat = 4.0; }
  return vec2(d, mat);
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
      float L1 = 0.078 - abs(fi - 1.5) * 0.009;
      float a1 = curl * 0.6, a2 = curl * 1.6, a3 = curl * 2.4;
      vec3 p1 = p0 + (dir * cos(a1) - vec3(0, 0, 1) * sin(a1)) * L1;
      vec3 d2 = dir * cos(a2) - vec3(0, 0, 1) * sin(a2);
      vec3 p2 = p1 + d2 * L1 * 0.8;
      vec3 d3 = dir * cos(a3) - vec3(0, 0, 1) * sin(a3);
      vec3 p3 = p2 + d3 * L1 * 0.6;
      d = smin(d, sdCapT(q, p0, p1, 0.014, 0.0115), 0.012);
      d = smin(d, length(q - p1) - 0.0135, 0.006); // bony knuckles
      d = smin(d, sdCapT(q, p1, p2, 0.0115, 0.0105), 0.005);
      d = smin(d, length(q - p2) - 0.0118, 0.005);
      d = smin(d, sdCapT(q, p2, p3, 0.0105, 0.008), 0.004);
      float cl = sdCapT(q, p3 - d3 * 0.004, p3 + normalize(d3 + vec3(0, 0, 0.25)) * 0.055, 0.0085, 0.0008);
      if (cl < d) { d = cl; mat = 4.0; }
    }
    vec3 t0 = vec3(-0.05, 0.03, -0.006), t1 = vec3(-0.088, 0.075, -0.02), t2 = vec3(-0.104, 0.115, -0.03);
    d = smin(d, sdCapT(q, t0, t1, 0.018, 0.015), 0.012);
    d = smin(d, sdCapT(q, t1, t2, 0.015, 0.011), 0.005);
    float tc = sdCapT(q, t2, t2 + vec3(-0.012, 0.035, -0.012), 0.009, 0.0008);
    if (tc < d) { d = tc; mat = 4.0; }
    if (d < 0.02) d += (fbm3(q * 60.0) - 0.5) * 0.003;
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
  d = smin(d, sdCap(q, vec3(0.0, 0.0, 0.0), vec3(0.0, -0.1, 0.0), 0.037), 0.02);
  return vec2(d, mat);
}

// ---------------------------------------------------------------- the monster
vec2 monster(vec3 p) {
  vec2 res = vec2(1e5, 2.0);
  // head
  vec3 hp = p - uHead;
  float bh = length(hp) - 0.5;
  if (bh > 0.15) res.x = bh;
  else {
    vec2 h = uCute > 0.5 ? headCute(uHeadM * hp) : headDemon(uHeadM * hp);
    res = h;
  }
  // neck, shoulders, chest, arms (cheap)
  vec3 sl = uBody + vec3(-0.27, 0.07, 0.0), sr = uBody + vec3(0.27, 0.07, 0.0);
  float b = sdEll(p - uBody, vec3(0.3, 0.22, 0.17));
  b = smin(b, sdCap(p, sl, sr, 0.09), 0.08);
  b = smin(b, sdCap(p, uNeck, uBody + vec3(0.0, 0.12, 0.02), 0.075), 0.06);
  float ak = uCute > 0.5 ? 1.35 : 1.0;
  b = smin(b, sdCapT(p, sl, uElbL, 0.075 * ak, 0.058 * ak), 0.05);
  b = smin(b, sdCapT(p, sr, uElbR, 0.075 * ak, 0.058 * ak), 0.05);
  b = smin(b, sdCapT(p, uElbL, uHandL, 0.058 * ak, 0.045 * ak), 0.03);
  b = smin(b, sdCapT(p, uElbR, uHandR, 0.058 * ak, 0.045 * ak), 0.03);
  if (uCute < 0.5 && b < 0.02) b += (fbm3(p * 25.0) - 0.5) * 0.006;
  if (uCute > 0.5 && b < 0.02) b += (fbm3(p * 50.0) - 0.5) * 0.009;
  if (b < res.x) res = vec2(b, 2.0);
  // hands
  const float HS = 1.3;
  vec3 lp = p - uHandL;
  float bl = length(lp) - 0.27 * HS;
  vec2 hl = vec2(bl, 2.0);
  if (bl < 0.15) { vec3 q = uHandLM * lp; q.x = -q.x; hl = hand(q / HS, uCurlL); hl.x *= HS; }
  if (hl.x < res.x) res = hl;
  vec3 rp = p - uHandR;
  float br = length(rp) - 0.27 * HS;
  vec2 hr = vec2(br, 2.0);
  if (br < 0.15) { hr = hand(uHandRM * rp / HS, uCurlR); hr.x *= HS; }
  if (hr.x < res.x) res = hr;
  return res;
}

// ---------------------------------------------------------------- the wall
float holeR(float th) {
  return uHole * (0.62 + 0.06 * sin(th * 3.0 + 1.3) + 0.04 * sin(th * 7.0 + 0.4) + 0.025 * sin(th * 13.0 + 2.1));
}

vec2 debris(vec3 p) {
  float d = 1e5;
  if (uDebrisT < 0.0) return vec2(d, 5.0);
  float t = uDebrisT;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    float a = fi * 2.399 + 0.3;
    float r0 = 0.12 + 0.45 * hash1(fi * 3.1);
    vec3 p0 = vec3(HOLE_C + vec2(cos(a), sin(a)) * r0, 0.02);
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
  vec2 m = monster(p);
  if (uHole < 0.001) {
    // nothing broken yet: the wall is a membrane – whatever pushes against it bulges it out
    float w = smin(p.z, m.x + 0.012, 0.04 + 0.06 * uBulge);
    return vec2(w, 1.0);
  }
  float slab = max(p.z, -p.z - 0.09);
  vec2 hp = p.xy - HOLE_C;
  float r = length(hp);
  float R = holeR(atan(hp.y, hp.x)) + (noise3(p * 40.0) - 0.5) * 0.03 * uHole;
  vec2 res = vec2(max(slab, R - r), 1.0);
  if (m.x < res.x) res = m;
  vec2 db = debris(p);
  if (db.x < res.x) res = db;
  return res;
}

float mapM(vec3 p) {
  float d = monster(p).x;
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
float cracks(vec2 xy) {
  vec2 hp = xy - HOLE_C;
  float r = length(hp);
  float reach = uCrack * 1.15 + uHole * 0.2;
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

vec3 skinAlbedo(vec3 p) {
  if (uCute > 0.5) {
    float f = fbm3(p * 18.0);
    vec3 a = mix(vec3(0.05, 0.42, 0.42), vec3(0.32, 0.12, 0.55), smoothstep(0.35, 0.75, f));
    return a * (0.75 + 0.5 * fbm3(p * 90.0));
  }
  // dark, mottled, slightly translucent red skin with veins
  float f = fbm3(p * 9.0);
  vec3 a = mix(vec3(0.13, 0.03, 0.025), vec3(0.34, 0.1, 0.07), f);
  a *= 0.8 + 0.4 * fbm3(p * 55.0);
  float vein = smoothstep(0.025, 0.0, abs(fbm3(p * 16.0 + 7.0) - 0.5));
  a = mix(a, vec3(0.07, 0.01, 0.03), vein * 0.6);
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
  vec3 gp = vec3(HOLE_C, -0.4) - p;
  float dg = length(gp);
  gp /= dg;
  float att = uGlow / (1.0 + 6.0 * dg * dg);
  float gd = max(dot(n, gp), 0.0);
  col += alb * uGlowCol * att * (gd + sss * 0.5 * max(-dot(n, gp) + 0.3, 0.0)) * (isWall > 0.5 ? 0.5 : 2.2);
  col += uGlowCol * att * spec * pow(max(dot(n, normalize(gp - rd)), 0.0), gloss) * 1.5;
  // the eyes light the face a little
  if (uCute < 0.5) {
    vec3 ep = uHead + vec3(0.0, 0.03, 0.17) - p;
    float de = length(ep);
    col += alb * vec3(1.0, 0.35, 0.05) * uEyes * 0.012 / (de * de + 0.002) * max(dot(n, ep / de), 0.0) *
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
  float far = length(hw.xy - HOLE_C);
  bool debrisOn = uDebrisT >= 0.0;
  if (far > 1.75 && !(debrisOn && abs(hw.x) < 1.8)) {
    // the plain wall stays black (the real wall)
    col = vec3(0.0);
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
      float r = length(hw.xy - HOLE_C);
      float fl = 0.75 + 0.25 * noise3(vec3(hw.xy * 4.0, uTime * 1.5));
      col = uGlowCol * uGlow * fl * (0.02 + 0.22 * exp(-r * r * 9.0)) * mix(0.4, 1.0, noise3(vec3(hw.xy * 6.0, 2.0)));
    } else {
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
        col += uGlowCol * c * uGlow * 0.3 * smoothstep(0.8, 0.0, length(p.xy - HOLE_C));
      } else if (mat < 2.5) {
        vec3 alb = skinAlbedo(uCute > 0.5 ? p : p);
        col = light(p, n, rd, alb, uCute > 0.5 ? 0.05 : 0.25, uCute > 0.5 ? 6.0 : 30.0, uCute > 0.5 ? 0.7 : 0.55, 0.0) * ao * ao;
      } else if (mat < 3.5) {
        vec3 hq = uHeadM * (p - uHead);
        vec3 ec = vec3(sign(hq.x) * (uCute > 0.5 ? 0.078 : 0.058), uCute > 0.5 ? 0.05 : 0.032, uCute > 0.5 ? 0.15 : 0.148);
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
          // glowing eyes with a slit pupil looking at you
          vec3 ax = normalize(cross(uLook, vec3(0.0, 1.0, 0.0)));
          float slit = smoothstep(0.035, 0.015, abs(dot(v, ax))) * smoothstep(0.8, 0.9, cosA);
          vec3 em = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.3), smoothstep(0.6, 1.0, cosA)) * (0.04 + uEyes * 2.2);
          col = em * (1.0 - slit * 0.95) + light(p, n, rd, vec3(0.05), 1.0, 90.0, 0.0, 0.0);
        }
      } else if (mat < 4.5) {
        // horns, claws, teeth
        vec3 hq2 = uHeadM * (p - uHead);
        vec3 alb = uCute > 0.5 ? vec3(0.95, 0.82, 0.5) : mix(vec3(0.06, 0.045, 0.04), vec3(0.6, 0.55, 0.45), clamp((hq2.y - 0.15) * 4.0, 0.0, 1.0)) * (0.7 + 0.5 * fbm3(p * 40.0));
        if (uCute < 0.5 && hq2.y < 0.0) alb = vec3(0.55, 0.5, 0.38) * (0.8 + 0.3 * fbm3(p * 80.0));
        col = light(p, n, rd, alb, 0.6, 60.0, 0.1, 0.0) * ao;
      } else {
        // falling bits of plaster
        col = light(p, n, rd, vec3(0.45) * (0.7 + 0.6 * noise3(p * 90.0)), 0.05, 8.0, 0.0, 0.0) * ao;
      }
      // a little depth haze behind the wall
      col *= mix(1.0, 0.25, smoothstep(0.0, -0.9, p.z));
    }
  }

  // dust cloud after the burst, embers / sparkles drifting out of the hole
  if (uDebrisT >= 0.0) {
    float dt = uDebrisT;
    float r = length(hw.xy - HOLE_C);
    float dust = fbm3(vec3(hw.xy * 3.0 - vec2(0.0, -dt * 0.3), dt * 0.4)) * exp(-r * r * 1.2) * exp(-dt * 0.9) * smoothstep(0.0, 0.15, dt);
    col += vec3(0.5, 0.47, 0.44) * dust * (0.12 + 0.25 * uGlow * (uCute > 0.5 ? 0.6 : 1.0));
  }
  if (uGlow > 0.02) {
    for (int i = 0; i < 18; i++) {
      float fi = float(i);
      float life = 3.0 + 2.0 * hash1(fi * 4.1);
      float age = mod(uTime + hash1(fi * 2.3) * life, life);
      float a = fi * 2.399;
      vec2 s = HOLE_C + vec2(cos(a), sin(a)) * (0.15 + 0.4 * hash1(fi)) * (0.4 + age * 0.3);
      s.y += uCute > 0.5 ? age * 0.08 * sin(fi) : age * 0.22;
      s.x += sin(age * 2.0 + fi) * 0.04;
      float k = exp(-dot(hw.xy - s, hw.xy - s) / (uCute > 0.5 ? 0.00012 : 0.00005));
      float tw = 0.5 + 0.5 * sin(uTime * 9.0 + fi * 3.0);
      col += (uCute > 0.5 ? mix(vec3(0.6, 0.9, 1.0), vec3(1.0, 0.7, 1.0), hash1(fi)) : vec3(1.0, 0.5, 0.12)) * k * uGlow * tw *
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
const speedOf = (s: DrawState) => Math.max(0.2, Number(s.params.speed ?? 1));
const pauseOf = (s: DrawState) => Math.max(0, Number(s.params.pause ?? 6));

/** The scene clock as last rendered (for the sound, which runs outside the render loop). */
const clocks: Record<string, { time: number; at: number; speed: number; loop: number }> = {};

export function uniformsFor(id: string, cute: boolean) {
  return (s: DrawState, f: { time: number }) => {
    const F = (s.cache.wmFrame as Frame | undefined) ?? (s.cache.wmFrame = frameOf(s));
    const speed = speedOf(s);
    const loop = LOOP + pauseOf(s);
    clocks[id] = { time: f.time, at: performance.now(), speed, loop };
    const a = (f.time * speed) % loop;
    const P = pose(a, cute, F.ro);
    const handM = (h: Hand) => rot(h.yaw, h.pitch, h.roll);
    const HL = handM(P.handL);
    const HR = handM(P.handR);
    // elbows: half way, out to the side, down and back into the wall
    const sl: V3 = add(P.body, [-0.27, 0.07, 0]);
    const sr: V3 = add(P.body, [0.27, 0.07, 0]);
    const elbow = (sh: V3, w: V3, side: number): V3 => add(mixV(sh, w, 0.5), [side * 0.14, -0.13, -0.16]);
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
      uGlowCol: cute ? new THREE.Vector3(0.55, 0.35, 1.0) : new THREE.Vector3(1.0, 0.32, 0.06),
    };
  };
}

interface Cue {
  at: number;
  play: (snd: SoundApi) => void;
}

const DEMON_SOUND: Cue[] = [
  { at: 1.0, play: (s) => s.knock({ count: 3, gain: 0.55, spacing: 0.45 }) },
  { at: 3.7, play: (s) => s.knock({ count: 2, gain: 0.6, spacing: 0.4 }) },
  { at: 5.0, play: (s) => s.rumble({ duration: 3.5, gain: 0.35 }) },
  { at: 8.4, play: (s) => s.whoosh({ duration: 1.6, from: 160, to: 70, gain: 0.3 }) },
  ...PUSHES.map((at) => ({ at, play: (s: SoundApi) => s.knock({ count: 1, gain: 0.45 }) })),
  { at: 10.6, play: (s) => s.knock({ count: 4, gain: 0.25, spacing: 0.06 }) },
  { at: 11.5, play: (s) => s.pop({ freq: 170, gain: 0.3 }) },
  { at: 12.4, play: (s) => s.knock({ count: 5, gain: 0.3, spacing: 0.05 }) },
  {
    at: 13.5,
    play: (s) => {
      s.rumble({ duration: 2.2, gain: 0.6 });
      s.whoosh({ duration: 1.0, from: 400, to: 80, gain: 0.5 });
      s.knock({ count: 7, gain: 0.45, spacing: 0.05 });
      s.pop({ freq: 110, gain: 0.5 });
    },
  },
  { at: 14.4, play: (s) => s.knock({ count: 6, gain: 0.22, spacing: 0.09 }) },
  { at: 16.0, play: (s) => s.ooh({ duration: 2.6, base: 68, gain: 0.35 }) },
  { at: 21.2, play: (s) => s.scuttle({ duration: 0.6, gain: 0.3 }) },
  { at: 23.2, play: (s) => s.scuttle({ duration: 0.6, gain: 0.3 }) },
  {
    at: 28.4,
    play: (s) => {
      s.rumble({ duration: 3.4, gain: 0.7 });
      s.ooh({ duration: 3.2, base: 52, gain: 0.65 });
      s.ooh({ duration: 3.0, base: 78, gain: 0.35 });
      s.whoosh({ duration: 3.0, from: 900, to: 180, gain: 0.45 });
    },
  },
  { at: 35.5, play: (s) => s.ooh({ duration: 2.2, base: 75, gain: 0.3 }) },
  { at: 36.0, play: (s) => s.whoosh({ duration: 2.0, from: 300, to: 60, gain: 0.3 }) },
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

function soundFor(id: string, cues: Cue[]) {
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

function breakout(id: string, cute: boolean): SceneModule {
  return shaderScene(id, WALL_MONSTER_FRAG, uniformsFor(id, cute), {
    shaderScale: 0.6,
    ambientSound: soundFor(id, cute ? CUTE_SOUND : DEMON_SOUND),
  });
}

export const wallMonsterScenes: SceneModule[] = [breakout('wallDemon', false), breakout('wallBuddy', true)];
