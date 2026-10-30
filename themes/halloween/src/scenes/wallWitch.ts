/**
 * The little witch (for kids): she arrives – on her broom out of the distance behind the right
 * wall, in a puff of magic, or tumbling off her broom – waves hello, pulls her wand and does a
 * little magic show on the right wall (three of: a pumpkin that grows and laughs, bats bursting
 * out of a full moon, a bubbling cauldron, fireworks with falling stars, a spell that goes wrong
 * and leaves a frog), then she vanishes in a spiral of sparks or flies away on her broom.
 *
 * Unlike the other wall shows nothing breaks open: she stands in front of the main wall. The
 * whole show lives in one 3D space (the main wall's frame) and every side looks into it from
 * the audience standpoint – so she, the broom and the magic move seamlessly from the main wall
 * to the right wall (and the floor, if lit). Everything is a pure function of time and the
 * shared seed, so all projector PCs agree.
 */
import * as THREE from 'three';
import {
  pumpkinGeometry,
  PUMPKIN_FRAG,
  PUMPKIN_VERT,
  type DrawState,
  type SceneModule,
  type SoundApi,
} from '@spectrastage/engine';
import { clocks, frameOf, makeHoles, soundFor, speedOf, type Cue, type Frame } from './wallMonster.ts';
import { feetAt, FigureLayer, Rig, type Body, type Reach } from './wallShow.ts';

type V3 = [number, number, number];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (a: number, t0: number, t1: number) => clamp01((a - t0) / (t1 - t0));
const sm = (v: number) => v * v * (3 - 2 * v);
const ease = (a: number, t0: number, t1: number) => sm(seg(a, t0, t1));
/** 0 → 1 → 0: up between t0..t1, down between t2..t3. */
const win = (a: number, t0: number, t1: number, t2: number, t3: number) =>
  ease(a, t0, t1) * (1 - ease(a, t2, t3));
const hash = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const UP = new THREE.Vector3(0, 1, 0);
const fwdOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const leftOf = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const turnTo = (a: number, b: number, t: number) => a + angDiff(a, b) * t;
/** Overshooting grow 0 → 1. */
const elastic = (u: number) =>
  u <= 0 ? 0 : u >= 1 ? 1 : 1 - Math.cos(u * Math.PI * 2.5) * Math.exp(-u * 5) * (1 - u);

export const WITCH_SHOW = 60;
/** The cauldron hangs this high over its fire (m). */
const RAISE = 0.24;
const HEIGHT = 1.15;
const SLOT0 = 12;
const SLOT = 12;
const TRICKS = ['pumpkin', 'bats', 'cauldron', 'fireworks', 'frog'] as const;
type Trick = (typeof TRICKS)[number];
type Entry = 'broom' | 'poof' | 'plop';
interface Variant {
  entry: Entry;
  exit: 'poof' | 'fly';
  tricks: Trick[];
}

/** Which entrance, tricks and exit this run gets (shared seed + the how-many-th run). */
function variantOf(seed: number): Variant {
  const entry = (['broom', 'poof', 'plop'] as const)[Math.floor(hash(seed) * 3) % 3]!;
  const pool = [...TRICKS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(hash(seed * 3.1 + i) * (i + 1)) % (i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  const tricks = pool.slice(0, 3);
  // the spell that goes wrong is funniest in the middle
  const f = tricks.indexOf('frog');
  if (f >= 0 && f !== 1) [tricks[f], tricks[1]] = [tricks[1]!, tricks[f]!];
  return { entry, exit: entry === 'broom' ? 'poof' : 'fly', tricks };
}

/** Shared by the sound (which runs where the main wall is drawn). */
let soundVariant: Variant = variantOf(1);

// ---------------------------------------------------------------------------
// The show space: the main wall's frame (x right, y up, z out of the wall, units m/k)
// ---------------------------------------------------------------------------
interface Face {
  /** Top-left corner, right (stage x), down (stage y), normal into the room; size (show units). */
  o: THREE.Vector3;
  x: THREE.Vector3;
  down: THREE.Vector3;
  n: THREE.Vector3;
  w: number;
  h: number;
}
interface Space {
  F: Frame;
  /** 1 m in show units. */
  m: number;
  eye: THREE.Vector3;
  self: Face;
  /** Where the magic goes: the right wall (floor point at its start, along it, its normal). */
  T0: THREE.Vector3;
  Tx: THREE.Vector3;
  Tn: THREE.Vector3;
  Tlen: number;
  right: boolean;
  /** Where she stands. */
  stand: THREE.Vector3;
}

function spaceOf(s: DrawState): Space {
  const w = s.world;
  const room = w?.room;
  const main = room?.faces.find((f) => f.role === 'main');
  const selfFace = room?.faces.find((f) => f.id === w?.self.id);
  let F: Frame;
  let self: Face;
  let right: { T0: THREE.Vector3; Tx: THREE.Vector3; Tn: THREE.Vector3; len: number } | null = null;
  if (!w || !room || !main || !selfFace) {
    F = frameOf(s);
    self = {
      o: V(...F.p0),
      x: V(...F.pu).normalize(),
      down: V(...F.pv).normalize(),
      n: V(0, 0, 1),
      w: Math.hypot(...F.pu),
      h: Math.hypot(...F.pv),
    };
  } else {
    const H = main.rect.h;
    const W = main.rect.w;
    const k = Math.min(1.8, Math.max(0.7, (H / 2.25) * 1.25));
    const hy = Math.min(H - 0.55 * k, 1.42 * k);
    const ax = V(...main.ax);
    const up = V(...main.ay).negate();
    const n = V(...main.n);
    const A = V(...main.o)
      .addScaledVector(ax, W / 2)
      .addScaledVector(V(...main.ay), H - hy);
    const toP = (p: V3) => {
      const d = V(...p).sub(A);
      return V(d.dot(ax) / k, d.dot(up) / k, d.dot(n) / k);
    };
    const toD = (v: V3) => {
      const d = V(...v);
      return V(d.dot(ax), d.dot(up), d.dot(n));
    };
    let eye = V(...((w.viewer as V3 | undefined) ?? room.center));
    const dz = eye.clone().sub(A).dot(n);
    if (dz < 1.2) eye = eye.addScaledVector(n, 1.2 - dz);
    const e = toP([eye.x, eye.y, eye.z]);
    F = {
      ro: [e.x, e.y, e.z],
      p0: toP(main.o).toArray() as V3,
      pu: toD(main.ax)
        .multiplyScalar(W / k)
        .toArray() as V3,
      pv: toD(main.ay)
        .multiplyScalar(H / k)
        .toArray() as V3,
      floorY: -hy / k,
      k,
    };
    self = {
      o: toP(selfFace.o),
      x: toD(selfFace.ax),
      down: toD(selfFace.ay),
      n: toD(selfFace.n),
      w: selfFace.rect.w / k,
      h: selfFace.rect.h / k,
    };
    // the right wall: the side wall that goes on right where the main wall ends (and is projected)
    const r = room.faces
      .filter((f) => f.role === 'side' && w.surfaces.some((x) => x.id === f.id))
      .filter((f) => Math.abs(f.rect.x - (main.rect.x + main.rect.w)) < 0.3)[0];
    if (r)
      right = {
        T0: toP([r.o[0], 0, r.o[2]]),
        Tx: toD(r.ax),
        Tn: toD(r.n),
        len: r.rect.w / k,
      };
  }
  const m = 1 / F.k;
  const hw = Math.abs(F.pu[0]) / 2;
  const T = right ?? { T0: V(hw * 0.12, F.floorY, 0), Tx: V(1, 0, 0), Tn: V(0, 0, 1), len: hw * 0.88 };
  if (right) T.T0.y = F.floorY;
  return {
    F,
    m,
    eye: V(...F.ro),
    self,
    T0: T.T0,
    Tx: T.Tx,
    Tn: T.Tn,
    Tlen: T.len,
    right: !!right,
    stand: V(right ? hw * 0.32 : -hw * 0.4, F.floorY, 0.3),
  };
}

/** Points on the magic wall: `u` along it (0..1), height and distance from it in metres. */
function onWall(S: Space, u: number, hM: number, outM: number): THREE.Vector3 {
  return S.T0.clone()
    .addScaledVector(S.Tx, S.Tlen * u)
    .addScaledVector(UP, hM * S.m)
    .addScaledVector(S.Tn, outM * S.m);
}

// ---------------------------------------------------------------------------
// Sparks and smoke: points recomputed every frame from time (deterministic)
// ---------------------------------------------------------------------------
const SPARK_VERT = /* glsl */ `
attribute vec4 aCol;
attribute float aSize;
attribute float aKind;
uniform float uScale;
varying vec4 vCol;
varying float vKind;
#include <clipping_planes_pars_vertex>
void main() {
  vCol = aCol;
  vKind = aKind;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = clamp(aSize * uScale / max(0.05, -mvPosition.z), 1.0, 96.0);
  #include <clipping_planes_vertex>
}
`;
const SPARK_FRAG = /* glsl */ `
varying vec4 vCol;
varying float vKind;
#include <clipping_planes_pars_fragment>
void main() {
  #include <clipping_planes_fragment>
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a;
  if (vKind < 0.5) {
    // a glowing spark: hot core, soft halo
    a = exp(-r * r * 9.0) + 0.35 * exp(-r * r * 2.5);
  } else if (vKind < 1.5) {
    // a twinkling star: four thin rays
    a = exp(-r * r * 14.0) + 0.9 * exp(-abs(p.x) * 22.0) * (1.0 - r) + 0.9 * exp(-abs(p.y) * 22.0) * (1.0 - r);
  } else if (vKind < 2.5) {
    // a soap bubble: a thin bright rim and a highlight
    a = smoothstep(0.7, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r)) * 0.9 + 0.08 * (1.0 - r)
      + 0.8 * exp(-dot(p - vec2(-0.35, 0.4), p - vec2(-0.35, 0.4)) * 40.0);
  } else {
    // smoke: a soft puff
    a = (1.0 - smoothstep(0.2, 1.0, r)) * 0.8;
  }
  a = clamp(a, 0.0, 1.5);
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol.rgb * a, vCol.a * min(a, 1.0));
}
`;

class Points {
  readonly obj: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private kind: Float32Array;
  n = 0;
  readonly mat: THREE.ShaderMaterial;
  constructor(
    private readonly max: number,
    additive: boolean,
    clip: THREE.Plane[],
  ) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.kind = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aCol', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aKind', new THREE.BufferAttribute(this.kind, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 300 } },
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      clipping: true,
      clippingPlanes: clip,
      // premultiplied: sparks add light, smoke covers
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.obj = new THREE.Points(g, this.mat);
    this.obj.frustumCulled = false;
  }
  /** A point: colour (0..1, may be > 1 for hot), opacity, size (show units), kind. */
  add(p: THREE.Vector3, r: number, g: number, b: number, a: number, size: number, kind = 0) {
    if (this.n >= this.max || a <= 0.004) return;
    const i = this.n++;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.col[i * 4] = r * a;
    this.col[i * 4 + 1] = g * a;
    this.col[i * 4 + 2] = b * a;
    this.col[i * 4 + 3] = Math.min(1, a);
    this.size[i] = size;
    this.kind[i] = kind;
  }
  commit() {
    const g = this.obj.geometry;
    for (const k of ['position', 'aCol', 'aSize', 'aKind'])
      (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
    g.setDrawRange(0, this.n);
  }
}

/**
 * Particles born at a steady rate between t0 and t1, each living `life` seconds:
 * fn(age, 0..1 of its life, its own random numbers, index).
 */
function emit(
  a: number,
  t0: number,
  t1: number,
  rate: number,
  life: number,
  seed: number,
  fn: (age: number, f: number, R: (k: number) => number, i: number) => void,
) {
  if (a < t0) return;
  const first = Math.max(0, Math.ceil((a - life - t0) * rate));
  const last = Math.floor((Math.min(t1, a) - t0) * rate);
  for (let i = first; i <= last; i++) {
    const age = a - (t0 + i / rate);
    if (age < 0 || age > life) continue;
    fn(age, age / life, (k) => hash(seed * 0.731 + i * 17.13 + k * 3.71), i);
  }
}
/** `count` particles all born at t. */
function burst(
  a: number,
  t: number,
  count: number,
  life: number,
  seed: number,
  fn: (age: number, f: number, R: (k: number) => number, i: number) => void,
) {
  const age = a - t;
  if (age < 0 || age > life) return;
  for (let i = 0; i < count; i++) fn(age, age / life, (k) => hash(seed * 0.917 + i * 13.37 + k * 5.13), i);
}
const hsl = (h: number, s = 1, l = 0.6): [number, number, number] => {
  const c = new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
  return [c.r, c.g, c.b];
};
/** A random direction (sphere). */
const dirOf = (R: (k: number) => number, k: number) => {
  const z = R(k) * 2 - 1;
  const t = R(k + 1) * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return V(r * Math.cos(t), z, r * Math.sin(t));
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
function broomMesh(m: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.8 });
  const straw = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.9 });
  const band = new THREE.MeshStandardMaterial({ color: 0x7a2a8a, roughness: 0.5, emissive: 0x200020 });
  // along +z (forwards), the seat at the origin
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.018 * m, 0.022 * m, 1.15 * m, 10), wood);
  stick.rotation.x = Math.PI / 2;
  stick.position.z = 0.08 * m;
  const bristles = new THREE.Mesh(new THREE.ConeGeometry(0.13 * m, 0.45 * m, 16, 1, true), straw);
  bristles.rotation.x = Math.PI / 2;
  bristles.position.z = -0.62 * m;
  const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * m, 0.045 * m, 0.05 * m, 12), band);
  tie.rotation.x = Math.PI / 2;
  tie.position.z = -0.4 * m;
  g.add(stick, bristles, tie);
  return g;
}

function wandMesh(m: number): THREE.Group {
  const g = new THREE.Group();
  const stick = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009 * m, 0.014 * m, 0.3 * m, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a5a3a, roughness: 0.4, emissive: 0x3a2010 }),
  );
  stick.position.y = 0.15 * m;
  const tip = new THREE.Mesh(
    new THREE.SphereGeometry(0.02 * m, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xfff4c0 }),
  );
  tip.position.y = 0.3 * m;
  g.add(stick, tip);
  return g;
}

/** A bat: body and two scalloped wings (wings hinge at the body, span along ±x). */
function batParts(m: number) {
  const s = 0.17 * m;
  const wing = new THREE.BufferGeometry();
  // fan from the shoulder: leading edge, then scallops
  const pts: number[] = [];
  const outline: [number, number][] = [
    [0.05, 0.04],
    [0.55, 0.22],
    [1.0, 0.05],
    [0.8, -0.12],
    [0.62, -0.03],
    [0.45, -0.18],
    [0.27, -0.06],
    [0.08, -0.14],
  ];
  for (let i = 0; i < outline.length - 1; i++) {
    const a = outline[i]!;
    const b = outline[i + 1]!;
    pts.push(0, 0, 0, a[0] * s, 0, -a[1] * s, b[0] * s, 0, -b[1] * s);
  }
  wing.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  wing.computeVertexNormals();
  const body = new THREE.SphereGeometry(0.05 * s * 2.2, 10, 8).scale(0.8, 0.7, 1.4);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x2a1838,
    emissive: 0x241030,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  return { wing, body, mat };
}

function cauldronMesh(m: number) {
  const g = new THREE.Group();
  const prof: THREE.Vector2[] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const ang = -Math.PI / 2 + t * Math.PI * 0.86;
    prof.push(new THREE.Vector2(Math.max(0.02, Math.cos(ang) * 0.27 * m), (0.17 + Math.sin(ang) * 0.17) * m));
  }
  prof.push(new THREE.Vector2(0.24 * m, 0.33 * m), new THREE.Vector2(0.27 * m, 0.345 * m));
  const iron = new THREE.MeshStandardMaterial({
    color: 0x2b2b30,
    roughness: 0.55,
    metalness: 0.5,
    side: THREE.DoubleSide,
  });
  const pot = new THREE.Mesh(new THREE.LatheGeometry(prof, 32), iron);
  pot.position.y = RAISE * m;
  // a tripod of sticks over the fire, logs under it
  const wood = new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.9, emissive: 0x1a0800 });
  const legs = [0, 1, 2].map((i) => {
    const ang = (i * Math.PI * 2) / 3 + 0.5;
    const foot = V(Math.cos(ang) * 0.36 * m, 0, Math.sin(ang) * 0.36 * m);
    const top = V(0, (RAISE + 0.5) * m, 0);
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.014 * m, 0.018 * m, 1, 6), wood);
    l.position.copy(foot).lerp(top, 0.5);
    l.scale.y = foot.distanceTo(top);
    l.quaternion.setFromUnitVectors(V(0, 1, 0), top.clone().sub(foot).normalize());
    return l;
  });
  const logs = [0, 1].map((i) => {
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * m, 0.03 * m, 0.34 * m, 8), wood);
    l.rotation.set(Math.PI / 2, 0, i * 1.2 + 0.4);
    l.position.y = 0.03 * m;
    return l;
  });
  legs.push(...logs);
  const liquidMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv;
#include <clipping_planes_pars_vertex>
void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`,
    fragmentShader: `uniform float uTime; varying vec2 vUv;
#include <clipping_planes_pars_fragment>
void main(){
#include <clipping_planes_fragment>
  vec2 p = vUv * 2.0 - 1.0; float r = length(p); float a = atan(p.y, p.x);
  float sw = sin(a * 3.0 + r * 9.0 - uTime * 2.5) * 0.5 + 0.5;
  vec3 c = mix(vec3(0.15, 0.9, 0.25), vec3(0.75, 1.0, 0.3), sw * (1.0 - r));
  c *= 1.4 - r * 0.6;
  gl_FragColor = vec4(c, 1.0);
}`,
    clipping: true,
  });
  const liquid = new THREE.Mesh(new THREE.CircleGeometry(0.235 * m, 32), liquidMat);
  liquid.rotation.x = -Math.PI / 2;
  liquid.position.y = (RAISE + 0.3) * m;
  g.add(pot, liquid, ...legs);
  return { g, liquidMat };
}

function frogMesh(m: number) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x3fae3a, roughness: 0.45, emissive: 0x0c2a0a });
  const white = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040 });
  const black = new THREE.MeshBasicMaterial({ color: 0x050505 });
  const s = 0.11 * m;
  const body = new THREE.Mesh(new THREE.SphereGeometry(s, 20, 14).scale(1, 0.7, 1.15), skin);
  body.position.y = s * 0.7;
  const head = new THREE.Mesh(new THREE.SphereGeometry(s * 0.75, 18, 12).scale(1.2, 0.75, 1), skin);
  head.position.set(0, s * 1.15, s * 0.65);
  const eyes = [-1, 1].map((x) => {
    const e = new THREE.Mesh(new THREE.SphereGeometry(s * 0.3, 12, 10), white);
    e.position.set(x * s * 0.42, s * 1.6, s * 0.8);
    const p = new THREE.Mesh(new THREE.SphereGeometry(s * 0.15, 10, 8), black);
    p.position.set(0, 0, s * 0.22);
    e.add(p);
    return e;
  });
  const sac = new THREE.Mesh(
    new THREE.SphereGeometry(s * 0.4, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xc8e86a, emissive: 0x2a3a10 }),
  );
  sac.position.set(0, s * 0.7, s * 1.05);
  const legs = [-1, 1].map((x) => {
    const l = new THREE.Mesh(new THREE.SphereGeometry(s * 0.38, 12, 8).scale(0.8, 0.5, 1.4), skin);
    l.position.set(x * s * 0.85, s * 0.3, -s * 0.2);
    return l;
  });
  g.add(body, head, ...eyes, sac, ...legs);
  return { g, sac };
}

const MOON_FRAG = /* glsl */ `
uniform float uA;
varying vec2 vUv;
#include <clipping_planes_pars_fragment>
float h(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
void main() {
  #include <clipping_planes_fragment>
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float disc = 1.0 - smoothstep(0.48, 0.5, r);
  // craters
  float cr = 0.0;
  for (int i = 0; i < 6; i++) {
    vec2 c = vec2(h(vec2(float(i), 1.0)), h(vec2(float(i), 2.0))) * 0.6 - 0.3;
    float s = 0.05 + 0.07 * h(vec2(float(i), 3.0));
    cr += (1.0 - smoothstep(s * 0.6, s, length(p - c))) * 0.25;
  }
  vec3 moon = vec3(1.0, 0.9, 0.62) * (1.05 - cr) * (1.0 - 0.25 * r);
  float halo = exp(-max(0.0, r - 0.5) * 9.0) * 0.55 * (1.0 - disc);
  vec3 col = moon * disc + vec3(1.0, 0.8, 0.45) * halo;
  float a = (disc + halo) * uA;
  gl_FragColor = vec4(col * uA, a);
}
`;

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------
function witchScene(): SceneModule {
  const id = 'wallWitch';
  return {
    id,
    ambientSound: (snd) => soundFor(id, witchCues())(snd),
    create: (ctx) => {
      const r = ctx.renderer;
      const clip = [new THREE.Plane(V(0, 1, 0), 1e6)];
      const holes = makeHoles();
      holes.uHN.value = 0;
      const layer = new FigureLayer();
      layer.fade = 1;
      const rig = new Rig('/models/witch.glb', HEIGHT, holes);
      layer.scene.add(rig.root);
      let rigClipped = false;
      let m = 1;
      let built = false;
      // props are made once the scale (m) is known
      let broom!: THREE.Group;
      let broom2!: THREE.Group;
      let wand!: THREE.Group;
      let pumpkin!: THREE.Group;
      let pumpkinFace!: THREE.ShaderMaterial;
      let cauldron!: ReturnType<typeof cauldronMesh>;
      let frog!: ReturnType<typeof frogMesh>;
      let moon!: THREE.Mesh;
      let bats!: { L: THREE.InstancedMesh; R: THREE.InstancedMesh; B: THREE.InstancedMesh };
      const NB = 16;
      const sparks = new Points(Math.round(5000 * Math.max(0.5, ctx.quality)), true, clip);
      const smoke = new Points(900, false, clip);
      layer.scene.add(smoke.obj, sparks.obj);
      const clipAll = (o: THREE.Object3D) =>
        o.traverse((x) => {
          const mm = (x as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
          if (!mm) return;
          for (const mat of Array.isArray(mm) ? mm : [mm]) {
            mat.clippingPlanes = clip;
            if ((mat as THREE.ShaderMaterial).isShaderMaterial) (mat as THREE.ShaderMaterial).clipping = true;
          }
        });
      const build = (mm: number) => {
        m = mm;
        built = true;
        broom = broomMesh(m);
        broom2 = broomMesh(m);
        wand = wandMesh(m);
        const pg = pumpkinGeometry(0.78 * m, 0.6 * m, 0.62 * m);
        pumpkinFace = new THREE.ShaderMaterial({
          uniforms: {
            uColor: { value: new THREE.Color(1, 0.62, 0.15) },
            uTime: { value: 0 },
            uLook: { value: 0 },
            uSeed: { value: 0.37 },
            uSize: { value: V(0.78 * m, 0.6 * m, 0.62 * m) },
          },
          vertexShader: PUMPKIN_VERT,
          fragmentShader: PUMPKIN_FRAG,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
        });
        pumpkin = new THREE.Group();
        const skin = new THREE.Mesh(
          pg,
          new THREE.MeshStandardMaterial({ color: 0xe0701a, roughness: 0.6, emissive: 0x3a1500 }),
        );
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025 * m, 0.04 * m, 0.1 * m, 8),
          new THREE.MeshStandardMaterial({ color: 0x4a6a20 }),
        );
        stem.position.y = 0.61 * m;
        stem.rotation.z = 0.2;
        pumpkin.add(skin, new THREE.Mesh(pg, pumpkinFace), stem);
        cauldron = cauldronMesh(m);
        frog = frogMesh(m);
        moon = new THREE.Mesh(
          new THREE.PlaneGeometry(1.4 * m, 1.4 * m),
          new THREE.ShaderMaterial({
            uniforms: { uA: { value: 0 } },
            vertexShader: `varying vec2 vUv;
#include <clipping_planes_pars_vertex>
void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * mvPosition;
#include <clipping_planes_vertex>
}`,
            fragmentShader: MOON_FRAG,
            transparent: true,
            depthWrite: false,
            clipping: true,
            blending: THREE.CustomBlending,
            blendSrc: THREE.OneFactor,
            blendDst: THREE.OneMinusSrcAlphaFactor,
          }),
        );
        const bp = batParts(m);
        bats = {
          L: new THREE.InstancedMesh(bp.wing, bp.mat, NB),
          R: new THREE.InstancedMesh(bp.wing, bp.mat, NB),
          B: new THREE.InstancedMesh(bp.body, bp.mat, NB),
        };
        for (const b of [bats.L, bats.R, bats.B]) b.frustumCulled = false;
        for (const o of [broom, broom2, wand, pumpkin, cauldron.g, frog.g, moon, bats.L, bats.R, bats.B]) {
          o.visible = false;
          clipAll(o);
          layer.scene.add(o);
        }
      };

      let S: Space | null = null;
      let hipsH = 0;
      let lastSeed = NaN;
      let Vr: Variant = variantOf(1);

      const render = (target: THREE.WebGLRenderTarget, f: { time: number }) => {
        const s: DrawState = {
          w: ctx.width,
          h: ctx.height,
          ppm: ctx.ppm,
          seed: ctx.seed,
          params: params,
          quality: ctx.quality,
          kind: ctx.kind,
          world: ctx.world,
          cache: {},
        };
        S ??= spaceOf(s);
        const Sp = S;
        if (!built) build(Sp.m);
        const speed = speedOf(s);
        const loop = WITCH_SHOW;
        clocks[id] = { time: f.time, at: performance.now(), speed, loop };
        const a = (f.time * speed) % loop;
        const run = Math.floor((f.time * speed) / loop);
        const seed = (ctx.world?.seed ?? ctx.seed) + run * 7919;
        if (seed !== lastSeed) {
          lastSeed = seed;
          Vr = variantOf(seed);
        }
        soundVariant = Vr;
        // background: dark wall
        r.setRenderTarget(target);
        r.setClearColor(0x000000, 1);
        r.clear(true, true, false);
        const fade = ease(a, 0, 1) * (1 - ease(a, WITCH_SHOW - 2.5, WITCH_SHOW - 0.3));
        if (fade <= 0) return;
        const ok = view(layer.camera, Sp.self, Sp.eye);
        if (!ok) return;
        // this side clips at the right wall: what is behind it shows only there (in the distance)
        const isRight =
          Sp.right &&
          Sp.self.n.distanceTo(Sp.Tn) < 0.05 &&
          Math.abs(Sp.self.o.clone().sub(Sp.T0).dot(Sp.Tn)) < 0.05;
        if (Sp.right && !isRight)
          clip[0]!.setFromNormalAndCoplanarPoint(Sp.Tn, Sp.T0).translate(Sp.Tn.clone().multiplyScalar(-0.02));
        else clip[0]!.set(V(0, 1, 0), 1e6);
        if (rig.ready && !rigClipped) {
          clipAll(rig.root);
          rigClipped = true;
        }
        // everything prepared once (shaders, textures) – no stutter when the props first appear
        if (rig.ready && rigClipped) layer.warm(r);
        sparks.n = 0;
        smoke.n = 0;
        const sc = (target.height * layer.camera.projectionMatrix.elements[5]!) / 2;
        sparks.mat.uniforms.uScale!.value = sc;
        smoke.mat.uniforms.uScale!.value = sc;
        const st = animate(a, Sp, Vr, seed);
        sparks.commit();
        smoke.commit();
        layer.fade = fade;
        // guest photo on her face
        const pid = String(params.witchPhoto ?? '') || null;
        rig.setFace(pid, pid ? (ctx.photos?.get(pid)?.img ?? null) : null);
        rig.root.visible = st.witch && rig.ready;
        const prevLocal = r.localClippingEnabled;
        r.localClippingEnabled = true;
        layer.render(r, target);
        r.localClippingEnabled = prevLocal;
      };

      /** Poses everything for show time a; returns what is shown. */
      const animate = (a: number, Sp: Space, v: Variant, seed: number): { witch: boolean } => {
        const F = Sp.F;
        const h = HEIGHT * Sp.m; // her height in show units
        const eye = Sp.eye;
        const stand = Sp.stand;
        const yawEye = Math.atan2(eye.x - stand.x, eye.z - stand.z);
        if (rig.ready && !hipsH) {
          rig.pose(
            still(stand.x, stand.z, 0),
            [
              [stand.x + 0.05, F.floorY, stand.z],
              [stand.x - 0.05, F.floorY, stand.z],
            ],
            F,
          );
          hipsH = rig.pos('Hips').y - F.floorY;
        }
        const hip = hipsH || h * 0.45;
        for (const o of [broom, broom2, wand, pumpkin, cauldron.g, frog.g, moon, bats.L, bats.R, bats.B])
          o.visible = false;
        layer.glow[0]!.intensity = 0;
        layer.glow[1]!.intensity = 0;

        // ---- where the tricks happen
        const slot = Math.floor((a - SLOT0) / SLOT);
        const trick = slot >= 0 && slot < 3 ? v.tricks[slot]! : null;
        const u = a - SLOT0 - slot * SLOT;
        const tgt = (t: Trick) =>
          t === 'bats'
            ? onWall(Sp, 0.45, 1.45, 0.03)
            : t === 'fireworks'
              ? onWall(Sp, 0.5, 1.3, 0.05)
              : onWall(Sp, 0.45, 0.25, t === 'frog' ? 0.15 : 0.3);
        const target = trick ? tgt(trick) : onWall(Sp, 0.45, 1.0, 0.3);

        // ---- her body over time
        const flightIn = flyInPath(Sp, stand, hip);
        const flightOut = flyOutPath(Sp, stand, hip);
        const passPath = plopPath(Sp, stand, hip);
        type Pose = {
          mode: 'hidden' | 'stand' | 'ride';
          seat?: THREE.Vector3;
          heading?: THREE.Vector3;
          fallY?: number;
        };
        const poseAt = (t: number): Pose => {
          if (v.entry === 'broom' && t < 6.4) return t < 1 ? { mode: 'hidden' } : rideOn(flightIn, t, 1, 6.4);
          if (v.entry === 'poof' && t < 3.05) return { mode: 'hidden' };
          if (v.entry === 'plop' && t < 3.4)
            return t < 1.2 ? { mode: 'hidden' } : rideOn(passPath, t, 1.2, 4.6);
          if (v.entry === 'plop' && t < 3.95) {
            const r0 = rideOn(passPath, 3.4, 1.2, 4.6);
            const dt = t - 3.4;
            const y0 = r0.seat!.y - hip;
            const g = 9.81 * Sp.m;
            return { mode: 'stand', fallY: Math.max(F.floorY, y0 - 0.5 * g * dt * dt) };
          }
          if (v.exit === 'poof' && t > 51.25) return { mode: 'hidden' };
          if (v.exit === 'fly' && t > 50.3)
            return t > 56.6 ? { mode: 'hidden' } : rideOn(flightOut, t, 50.3, 56.6);
          return { mode: 'stand' };
        };
        const ps = poseAt(a);
        const show = ps.mode !== 'hidden';

        // yaw while standing
        const yawAt = (t: number) => {
          let y = yawEye;
          const sl = Math.floor((t - SLOT0) / SLOT);
          if (sl >= 0 && sl < 3) {
            const uu = t - SLOT0 - sl * SLOT;
            const tt = tgt(v.tricks[sl]!);
            const yc = turnTo(yawEye, Math.atan2(tt.x - stand.x, tt.z - stand.z), 0.75);
            y = turnTo(yawEye, yc, ease(uu, 0.1, 1.0) * (1 - ease(uu, 9.0, 9.9)));
          }
          // the spin before she vanishes
          if (v.exit === 'poof' && t > 49.2) {
            const q = seg(t, 49.2, 51.2);
            y += q * q * Math.PI * 2 * 4;
          }
          return y;
        };
        const standBody = (t: number): Body => {
          const sp = poseAt(t);
          const land = v.entry === 'plop' ? Math.exp(-(((t - 4.05) / 0.2) ** 2)) * 0.22 * h : 0;
          const stumble = v.entry === 'broom' ? Math.sin(Math.PI * seg(t, 6.4, 7.2)) : 0;
          const sl = Math.floor((t - SLOT0) / SLOT);
          const uu = t - SLOT0 - sl * SLOT;
          const tk = sl >= 0 && sl < 3 ? v.tricks[sl]! : null;
          // reactions: bow, little hops of joy
          const bow =
            (tk && tk !== 'frog' && sl === 2 ? win(uu, 9.6, 10.1, 10.8, 11.3) : 0) +
            (v.exit === 'poof' ? win(t, 47.9, 48.4, 48.8, 49.2) : 0);
          const joy = tk && tk !== 'frog' && sl === 0 ? win(uu, 9.4, 9.6, 10.6, 10.9) : 0;
          const hop = joy * Math.abs(Math.sin((uu - 9.4) * Math.PI * 2.5)) * 0.06 * h;
          const startle = tk === 'frog' ? Math.sin(Math.PI * seg(uu, 2.8, 3.5)) : 0;
          return {
            x: stand.x,
            z: stand.z,
            yaw: yawAt(t),
            drop: 0.02 * h + land + stumble * 0.04 * h + bow * 0.03 * h,
            hop: (sp.fallY !== undefined ? sp.fallY - F.floorY : 0) + hop,
            lean: stumble * 0.35 + bow * 0.55 - startle * 0.25,
            sway: v.entry === 'plop' ? 0.12 * Math.sin(t * 9) * win(t, 4.1, 4.3, 5.8, 6.3) : 0,
            beat: 0.32,
            lift: 0,
          };
        };

        const L = rig.arm;
        let hands: [Reach | null, Reach | null] = [null, null];
        const wandOn =
          show && a > 10.8 && !(v.exit === 'fly' && a > 49.4) && !(v.exit === 'poof' && a > 51.2);
        let wandDir = V(0, 1, 0);
        let wandFlick = 0;

        if (rig.ready && show) {
          if (ps.mode === 'ride') {
            const seat = ps.seat!;
            const hd = ps.heading!;
            const yaw = Math.atan2(hd.x, hd.z);
            const fw = fwdOf(yaw);
            const lf = leftOf(yaw);
            // landing / taking off: feet go to the floor
            const ground =
              v.entry === 'broom' && a < 6.4
                ? ease(a, 6.0, 6.4)
                : v.exit === 'fly' && a > 50
                  ? 1 - ease(a, 50.3, 50.7)
                  : 0;
            const b: Body = {
              x: seat.x,
              z: seat.z,
              yaw,
              drop: 0,
              hop: seat.y - hip - F.floorY,
              lean: 0.22 * (1 - ground),
              sway: bankOf(ps, a),
              beat: 1,
              lift: 0,
            };
            const dangle = (side: number): [number, number, number] => {
              const p = seat
                .clone()
                .addScaledVector(fw, hip * 0.42)
                .addScaledVector(UP, -hip * 0.62)
                .addScaledVector(lf, side * hip * 0.17);
              const gnd = V(stand.x, F.floorY, stand.z).addScaledVector(lf, side * 0.06 * h);
              p.lerp(gnd, ground);
              return [p.x, p.y, p.z];
            };
            rig.pose(b, [dangle(1), dangle(-1)], F);
            const grip = (side: number): Reach => ({
              at: seat
                .clone()
                .addScaledVector(fw, (side > 0 ? 0.3 : 0.22) * h)
                .addScaledVector(UP, 0.03 * h)
                .addScaledVector(lf, side * 0.03 * h),
              fingers: fw.clone().multiplyScalar(0.3).add(lf.clone().multiplyScalar(-side)),
              palm: V(0, -1, 0),
              poles: [V(0, -1, 0).addScaledVector(lf, side * 0.6)],
            });
            hands = [grip(1), grip(-1)];
            // the broom under her
            broom.visible = true;
            broom.position.copy(seat).addScaledVector(UP, -0.03 * h);
            broom.quaternion.setFromUnitVectors(V(0, 0, 1), hd.clone().normalize());
            rig.hands(hands[0], hands[1]);
            rig.look(
              seat
                .clone()
                .addScaledVector(hd, 3)
                .lerp(eye, 0.3 + 0.4 * Math.max(0, Math.sin(a * 0.9))),
              0.8,
            );
            rig.finish();
            // sparkle trail behind the broom
            trail(a, ps, seat, hd);
          } else {
            const bAt = standBody;
            const b = bAt(a);
            const feet = feetAt(bAt, a, 0.055 * Sp.m * 1.0, F.floorY);
            if (v.exit === 'poof' && a > 49.2) {
              // spinning: the feet turn with her
              const lf = leftOf(b.yaw);
              feet[0] = [b.x + lf.x * 0.05 * h, F.floorY + b.hop, b.z + lf.z * 0.05 * h];
              feet[1] = [b.x - lf.x * 0.05 * h, F.floorY + b.hop, b.z - lf.z * 0.05 * h];
            }
            rig.pose(b, feet, F);
            const yaw = b.yaw;
            const fw = fwdOf(yaw);
            const lf = leftOf(yaw);
            const shL = rig.pos('LeftArm');
            const shR = rig.pos('RightArm');
            const head = rig.pos('Head');
            const rest = (side: number, sh: THREE.Vector3): Reach => ({
              at: sh
                .clone()
                .add(V(0, -L * 0.88, 0))
                .addScaledVector(lf, side * 0.06 * L)
                .addScaledVector(fw, 0.08 * L),
              fingers: V(0, -1, 0),
              palm: lf.clone().multiplyScalar(-side),
              poles: [
                lf
                  .clone()
                  .multiplyScalar(side * 0.4)
                  .addScaledVector(fw, -1),
              ],
            });
            // the wand hand (her left – on your right): holding the wand in front
            const holdWand = (sh: THREE.Vector3): Reach => ({
              at: sh
                .clone()
                .add(V(0, -L * 0.55, 0))
                .addScaledVector(fw, 0.55 * L)
                .addScaledVector(lf, 0.1 * L),
              fingers: fw
                .clone()
                .add(V(0, 0.5, 0))
                .normalize(),
              palm: lf.clone().multiplyScalar(-1),
              poles: [V(0, -1, 0).addScaledVector(lf, 0.7)],
            });
            let Lh: Reach = rest(1, shL);
            let Rh: Reach = rest(-1, shR);
            const blend = (r0: Reach, r1: Reach, t: number): Reach =>
              t <= 0
                ? r0
                : t >= 1
                  ? r1
                  : {
                      at: r0.at.clone().lerp(r1.at, t),
                      fingers: r0.fingers.clone().lerp(r1.fingers, t).normalize(),
                      palm: r0.palm.clone().lerp(r1.palm, t).normalize(),
                      poles: t < 0.5 ? r0.poles : r1.poles,
                    };
            // falling: arms up
            if (v.entry === 'plop' && a < 4.1) {
              const flail = (side: number, sh: THREE.Vector3): Reach => ({
                at: sh
                  .clone()
                  .add(V(0, L * 0.7, 0))
                  .addScaledVector(lf, side * L * (0.45 + 0.15 * Math.sin(a * 20 + side))),
                fingers: UP.clone(),
                palm: fw.clone(),
                poles: [V(0, -1, -0.3).addScaledVector(lf, side * 0.6)],
              });
              Lh = flail(1, shL);
              Rh = flail(-1, shR);
            }
            // fixing the hat (after a landing)
            const hat =
              v.entry === 'broom'
                ? win(a, 7.0, 7.3, 8.0, 8.4)
                : v.entry === 'plop'
                  ? win(a, 6.5, 6.8, 7.5, 7.9)
                  : 0;
            if (hat > 0) {
              const hp: Reach = {
                at: head
                  .clone()
                  .add(V(0, 0.16 * h, 0))
                  .addScaledVector(lf, -0.1 * h)
                  .addScaledVector(fw, 0.02 * h + 0.015 * h * Math.sin(a * 14)),
                fingers: UP.clone().addScaledVector(lf, 0.6).normalize(),
                palm: lf.clone(),
                poles: [
                  lf
                    .clone()
                    .multiplyScalar(-1)
                    .add(V(0, -0.5, 0)),
                ],
              };
              Rh = blend(Rh, hp, hat);
            }
            // waving hello (her right hand) – and goodbye before she flies off
            const wave =
              win(a, 8.4, 8.8, 10.4, 10.8) + (v.exit === 'fly' ? win(a, 47.9, 48.3, 48.9, 49.2) : 0);
            if (wave > 0) {
              const wv: Reach = {
                at: shR
                  .clone()
                  .addScaledVector(lf, -L * (0.35 + 0.12 * Math.sin(a * 9)))
                  .add(V(0, L * 0.75, 0))
                  .addScaledVector(fw, 0.12 * L),
                fingers: UP.clone()
                  .addScaledVector(lf, -0.3 * Math.sin(a * 9))
                  .normalize(),
                palm: fw.clone(),
                poles: [V(0, -1, 0).addScaledVector(lf, -0.6)],
              };
              Rh = blend(Rh, wv, wave);
            }
            if (wandOn) Lh = blend(Lh, holdWand(shL), ease(a, 10.8, 11.4));
            // the spell: wind up, flick towards the target, hold, lower
            if (trick) {
              const dirT = target.clone().sub(shL).normalize();
              const up: Reach = {
                at: shL
                  .clone()
                  .add(V(0, L * 0.72, 0))
                  .addScaledVector(fw, -0.05 * L)
                  .addScaledVector(lf, 0.25 * L),
                fingers: UP.clone().addScaledVector(fw, -0.3).normalize(),
                palm: fw.clone(),
                poles: [V(0, -1, 0).addScaledVector(lf, 0.7)],
              };
              const point: Reach = {
                at: shL.clone().addScaledVector(dirT, 0.92 * L),
                fingers: dirT.clone(),
                palm: V(0, -1, 0),
                poles: [V(0, -1, 0).addScaledVector(lf, 0.6)],
              };
              const wind = ease(u, 0.9, 1.25);
              const flick = ease(u, 1.25, 1.5);
              const lower = ease(u, 2.4, 3.1);
              let w = blend(Lh, up, wind);
              w = blend(w, point, flick);
              w = blend(w, Lh, lower);
              Lh = w;
              wandFlick = flick * (1 - lower);
              // the other arm out a little for balance while casting
              const bal: Reach = {
                at: shR
                  .clone()
                  .add(V(0, -L * 0.6, 0))
                  .addScaledVector(lf, -0.5 * L)
                  .addScaledVector(fw, -0.1 * L),
                fingers: V(0, -1, 0).addScaledVector(lf, -0.6).normalize(),
                palm: fw.clone(),
                poles: [fw.clone().multiplyScalar(-1)],
              };
              Rh = blend(Rh, bal, win(u, 1.0, 1.3, 2.2, 2.8));
              // reactions
              if (trick === 'frog') {
                // oops: hand behind the head, then a shrug
                const oops: Reach = {
                  at: head
                    .clone()
                    .addScaledVector(fw, -0.07 * h)
                    .add(V(0, 0.02 * h, 0))
                    .addScaledVector(lf, -0.07 * h),
                  fingers: UP.clone().addScaledVector(lf, 0.5).normalize(),
                  palm: fw.clone(),
                  poles: [
                    lf
                      .clone()
                      .multiplyScalar(-1)
                      .add(V(0, -0.3, 0)),
                  ],
                };
                Rh = blend(Rh, oops, win(u, 4.4, 4.9, 8.4, 8.9));
                const shrug = win(u, 9.3, 9.7, 10.8, 11.3);
                if (shrug > 0) {
                  for (const side of [1, -1]) {
                    const sh = side > 0 ? shL : shR;
                    const p: Reach = {
                      at: sh
                        .clone()
                        .add(V(0, -L * 0.55, 0))
                        .addScaledVector(lf, side * 0.45 * L)
                        .addScaledVector(fw, 0.35 * L),
                      fingers: fw
                        .clone()
                        .addScaledVector(lf, side * 0.5)
                        .normalize(),
                      palm: UP.clone(),
                      poles: [V(0, -1, 0).addScaledVector(lf, side * 0.6)],
                    };
                    if (side > 0) Lh = blend(Lh, p, shrug);
                    else Rh = blend(Rh, p, shrug);
                  }
                }
              } else if (slot === 0) {
                // ta-da: both arms up
                const tada = win(u, 9.3, 9.6, 10.8, 11.3);
                for (const side of [1, -1]) {
                  const sh = side > 0 ? shL : shR;
                  const p: Reach = {
                    at: sh
                      .clone()
                      .add(V(0, L * 0.72, 0))
                      .addScaledVector(lf, side * 0.5 * L)
                      .addScaledVector(fw, 0.1 * L),
                    fingers: UP.clone()
                      .addScaledVector(lf, side * 0.5)
                      .normalize(),
                    palm: fw.clone(),
                    poles: [V(0, -1, -0.3).addScaledVector(lf, side * 0.7)],
                  };
                  if (side > 0) Lh = blend(Lh, p, tada);
                  else Rh = blend(Rh, p, tada);
                }
              } else if (slot === 1) {
                // clapping
                const clap = win(u, 9.3, 9.6, 10.9, 11.3);
                const open = 0.5 + 0.5 * Math.sin((u - 9.3) * Math.PI * 2 * 2.6);
                for (const side of [1, -1]) {
                  const sh = side > 0 ? shL : shR;
                  const mid = shL.clone().add(shR).multiplyScalar(0.5);
                  const p: Reach = {
                    at: mid
                      .clone()
                      .add(V(0, -L * 0.3, 0))
                      .addScaledVector(fw, 0.55 * L)
                      .addScaledVector(lf, side * (0.03 + 0.14 * open) * L),
                    fingers: UP.clone().addScaledVector(fw, 0.6).normalize(),
                    palm: lf.clone().multiplyScalar(-side),
                    poles: [V(0, -1, 0).addScaledVector(lf, side * 0.8)],
                  };
                  void sh;
                  if (side > 0) Lh = blend(Lh, p, clap);
                  else Rh = blend(Rh, p, clap);
                }
              } else {
                // a bow with the hand on the heart
                const heart: Reach = {
                  at: rig
                    .pos('Spine2')
                    .addScaledVector(fw, 0.1 * h)
                    .addScaledVector(lf, 0.03 * h),
                  fingers: lf.clone(),
                  palm: fw.clone().multiplyScalar(-1),
                  poles: [V(0, -1, 0).addScaledVector(lf, -0.7)],
                };
                Rh = blend(Rh, heart, win(u, 9.4, 9.7, 10.9, 11.3));
              }
            }
            // goodbye bow (poof exit) and the spin: arms out
            if (v.exit === 'poof') {
              const heart: Reach = {
                at: rig
                  .pos('Spine2')
                  .addScaledVector(fw, 0.1 * h)
                  .addScaledVector(lf, 0.03 * h),
                fingers: lf.clone(),
                palm: fw.clone().multiplyScalar(-1),
                poles: [V(0, -1, 0).addScaledVector(lf, -0.7)],
              };
              Rh = blend(Rh, heart, win(a, 47.8, 48.2, 48.8, 49.2));
              const spin = ease(a, 49.2, 49.8);
              if (spin > 0)
                for (const side of [1, -1]) {
                  const sh = side > 0 ? shL : shR;
                  const p: Reach = {
                    at: sh
                      .clone()
                      .add(V(0, L * (0.2 + 0.5 * seg(a, 49.2, 51.2)), 0))
                      .addScaledVector(lf, side * 0.85 * L),
                    fingers: lf
                      .clone()
                      .multiplyScalar(side)
                      .add(V(0, 0.3, 0))
                      .normalize(),
                    palm: V(0, -1, 0),
                    poles: [
                      fw
                        .clone()
                        .multiplyScalar(-1)
                        .add(V(0, -0.5, 0)),
                    ],
                  };
                  if (side > 0) Lh = blend(Lh, p, spin);
                  else Rh = blend(Rh, p, spin);
                }
            }
            // getting onto the broom: hands to the stick
            if (v.exit === 'fly' && a > 49.4) {
              const seat = V(stand.x, F.floorY + hip, stand.z);
              const fo = flyOutHeading(Sp, stand);
              const fy = Math.atan2(fo.x, fo.z);
              const ffw = fwdOf(fy);
              const flf = leftOf(fy);
              for (const side of [1, -1]) {
                const p: Reach = {
                  at: seat
                    .clone()
                    .addScaledVector(ffw, (side > 0 ? 0.3 : 0.22) * h)
                    .addScaledVector(UP, 0.03 * h)
                    .addScaledVector(flf, side * 0.03 * h),
                  fingers: ffw.clone().multiplyScalar(0.3).add(flf.clone().multiplyScalar(-side)),
                  palm: V(0, -1, 0),
                  poles: [V(0, -1, 0).addScaledVector(flf, side * 0.6)],
                };
                if (side > 0) Lh = blend(Lh, p, ease(a, 49.6, 50.1));
                else Rh = blend(Rh, p, ease(a, 49.6, 50.1));
              }
            }
            rig.hands(Lh, Rh);
            // where she looks
            let look = eye.clone();
            let la = 0.85;
            if (trick && u > 0.8 && u < 9.2)
              look = trick === 'frog' && u > 3 ? frogPos(Sp, u).add(V(0, 0.1 * h, 0)) : target.clone();
            if (trick === 'frog' && u > 4.6 && u < 8.4)
              look = eye.clone().lerp(frogPos(Sp, u), 0.5 + 0.5 * Math.sin(u * 1.3));
            if (v.entry === 'plop' && a > 4.3 && a < 6.3) {
              // shaking her head (dizzy)
              look = eye.clone().addScaledVector(lf, Math.sin(a * 10) * 0.8 * h * 3);
            }
            if (v.entry === 'poof' && a > 3.4 && a < 5.6) {
              // looking around: where am I?
              look = eye.clone().addScaledVector(lf, Math.sin((a - 3.4) * 2.2) * h * 4);
            }
            if (v.exit === 'poof' && a > 49.2) la = 0;
            rig.look(look, la);
            rig.finish();
            hands = [Lh, Rh];
          }
        }

        // ---- the wand in her left hand
        if (wandOn && rig.ready && ps.mode === 'stand') {
          wand.visible = true;
          const hp = rig.pos('LeftHand');
          wandDir = (hands[0]?.fingers ?? V(0, 1, 0)).clone().normalize();
          wand.position.copy(hp).addScaledVector(wandDir, 0.04 * h);
          wand.quaternion.setFromUnitVectors(V(0, 1, 0), wandDir);
          const grow = ease(a, 10.8, 11.3);
          wand.scale.setScalar(Math.max(0.001, grow));
          const tip = wand.position.clone().addScaledVector(wandDir, 0.3 * m * grow);
          // the tip twinkles
          emit(a, 10.8, 60, 8 + wandFlick * 40, 0.6, seed + 11, (age, fr, R) => {
            const p = tip
              .clone()
              .add(dirOf(R, 1).multiplyScalar(0.03 * m + age * 0.12 * m))
              .add(V(0, -age * 0.1 * m, 0));
            sparks.add(p, 1, 0.85, 0.5, (1 - fr) * 0.9, (0.02 + 0.02 * R(5)) * m, R(6) > 0.7 ? 1 : 0);
          });
          burst(a, 10.85, 30, 0.9, seed + 12, (age, fr, R) => {
            const p = tip.clone().add(dirOf(R, 1).multiplyScalar(age * 0.5 * m));
            sparks.add(p, ...hsl(0.75 + 0.2 * R(4), 1, 0.7), (1 - fr) * 1.2, 0.035 * m, 1);
          });
          layer.glow[1]!.position.copy(tip);
          layer.glow[1]!.color.setRGB(1, 0.8, 0.5);
          layer.glow[1]!.intensity = 0.05 + wandFlick * 0.4;
        }

        // ---- entrances and exits (sparks, smoke, the other broom)
        const at = V(stand.x, F.floorY, stand.z);
        if (v.entry === 'poof' || v.exit === 'poof') {
          const tIn = v.entry === 'poof' ? 1.5 : -99;
          const tOut = v.exit === 'poof' ? 49.2 : -99;
          for (const [t0, t1, rising] of [
            [tIn, tIn + 1.6, false],
            [tOut, tOut + 2.05, true],
          ] as const) {
            emit(a, t0, t1, 160, 1.1, seed + (rising ? 21 : 22), (age, fr, R, i) => {
              const ts = t0 + i / 160;
              const k = seg(ts, t0, t1);
              const ang = ts * 9 + R(1) * 0.4 + (i % 2) * Math.PI;
              const rad = (0.35 - 0.15 * k) * m + age * 0.15 * m;
              const y = (rising ? k * 1.4 : 1.4 - k * 1.3) * m + age * 0.25 * m;
              const p = at.clone().add(V(Math.cos(ang + age * 3) * rad, y, Math.sin(ang + age * 3) * rad));
              sparks.add(
                p,
                ...hsl(0.78 + 0.12 * R(3), 1, 0.65),
                (1 - fr) * 1.1,
                (0.03 + 0.03 * R(4)) * m,
                R(5) > 0.6 ? 1 : 0,
              );
            });
            const tp = rising ? t1 : t1 - 0.1;
            puff(a, tp, at.clone().add(V(0, 0.6 * m, 0)), 1.0 * m, seed + (rising ? 23 : 24), 0.62);
            burst(a, tp, 80, 1.4, seed + (rising ? 25 : 26), (age, fr, R) => {
              const d = dirOf(R, 1);
              const p = at
                .clone()
                .add(V(0, 0.6 * m, 0))
                .addScaledVector(d, (1 - Math.exp(-age * 3)) * 0.9 * m)
                .add(V(0, -age * age * 0.2 * m, 0));
              sparks.add(p, ...hsl(0.8 + 0.15 * R(3), 1, 0.7), (1 - fr) * 1.3, 0.04 * m, 1);
            });
          }
        }
        // the broom leaves after landing (poofs away) / flies on without her (plop)
        if (v.entry === 'broom' && a > 6.4 && a < 7.3) {
          broom2.visible = true;
          broom2.position
            .copy(at)
            .add(V(0, 0.45 * m, 0))
            .addScaledVector(leftOf(yawEye), -0.35 * m);
          broom2.quaternion.setFromAxisAngle(V(1, 0, 0), -1.2 + (a - 6.4) * 0.5);
          if (a > 7.2) broom2.visible = false;
        }
        if (v.entry === 'broom')
          puff(
            a,
            7.2,
            at
              .clone()
              .add(V(0, 0.45 * m, 0))
              .addScaledVector(leftOf(yawEye), -0.35 * m),
            0.5 * m,
            seed + 27,
            0.6,
          );
        if (v.entry === 'plop' && a > 3.4 && a < 4.6) {
          const p = rideOn(passPath, a, 1.2, 4.6);
          broom2.visible = true;
          broom2.position.copy(p.seat!);
          broom2.quaternion.setFromUnitVectors(V(0, 0, 1), p.heading!.clone().normalize());
          trail(a, p, p.seat!, p.heading!);
        }
        // stars round her head after the tumble
        if (v.entry === 'plop' && rig.ready && a > 4.0 && a < 6.8) {
          const hd = rig.pos('Head').add(V(0, 0.13 * h, 0));
          const f = win(a, 4.0, 4.3, 6.2, 6.8);
          for (let i = 0; i < 5; i++) {
            const ang = a * 4.5 + (i * Math.PI * 2) / 5;
            const p = hd
              .clone()
              .add(V(Math.cos(ang) * 0.14 * h, Math.sin(ang * 2) * 0.015 * h, Math.sin(ang) * 0.14 * h));
            sparks.add(p, 1, 0.9, 0.3, f * 1.2, 0.07 * m, 1);
          }
        }
        // the broom for flying off appears in a puff
        if (v.exit === 'fly' && a > 49.2 && a < 50.3) {
          const fo = flyOutHeading(Sp, stand);
          broom.visible = true;
          const lift = ease(a, 49.9, 50.3) * 0.0;
          broom.position.set(stand.x, F.floorY + hip - 0.03 * h + lift, stand.z);
          broom.quaternion.setFromUnitVectors(V(0, 0, 1), fo.clone().normalize());
          broom.scale.setScalar(ease(a, 49.2, 49.4));
        } else broom.scale.setScalar(1);
        if (v.exit === 'fly') puff(a, 49.2, V(stand.x, F.floorY + hip, stand.z), 0.6 * m, seed + 28, 0.6);

        // ---- the tricks
        for (let k = 0; k < 3; k++) {
          const tk = v.tricks[k]!;
          const uu = a - SLOT0 - k * SLOT;
          if (uu < 0 || uu > SLOT + 2) continue;
          doTrick(tk, uu, Sp, seed + k * 101, tgt(tk));
        }
        return { witch: show };
      };

      /** The magic beam from the wand to the target, and what it does there. */
      const doTrick = (tk: Trick, u: number, Sp: Space, seed: number, T: THREE.Vector3) => {
        const F = Sp.F;
        const tipAt = () => {
          if (!rig.ready) return Sp.stand.clone().add(V(0, 1 * m, 0));
          const hp = rig.pos('LeftHand');
          return hp;
        };
        const tip = tipAt();
        // beam: a sparkling comet on an arc
        const fail = tk === 'frog';
        const b0 = fail ? 1.9 : 1.5;
        const b1 = fail ? 2.8 : 2.2;
        const mid = tip
          .clone()
          .lerp(T, 0.5)
          .add(V(0, 0.5 * m, 0));
        const bez = (q: number) => {
          const a1 = tip.clone().lerp(mid, q);
          const a2 = mid.clone().lerp(T, q);
          const p = a1.lerp(a2, q);
          if (fail) p.add(V(0, Math.sin(q * 30) * 0.06 * m, 0));
          return p;
        };
        emit(u, b0, b1, 220, 0.5, seed + 1, (age, fr, R, i) => {
          const q = clamp01(i / 220 / (b1 - b0));
          const p = bez(q)
            .add(dirOf(R, 1).multiplyScalar(age * 0.25 * m))
            .add(V(0, -age * age * 0.4 * m, 0));
          const c = fail ? ([0.6, 0.8, 0.5] as const) : hsl(0.12 + 0.75 * R(3), 1, 0.7);
          sparks.add(p, c[0], c[1], c[2], (1 - fr) * 1.2, (0.025 + 0.02 * R(4)) * m, R(5) > 0.75 ? 1 : 0);
        });
        if (u > b0 && u < b1) {
          const p = bez(seg(u, b0, b1));
          sparks.add(p, 1.4, 1.2, 1, 1, 0.12 * m, 0);
          layer.glow[0]!.position.copy(p);
          layer.glow[0]!.color.setRGB(1, 0.8, 1);
          layer.glow[0]!.intensity = 0.6;
        }
        // fizzling wand at a failed spell
        if (fail) {
          emit(u, 1.3, 1.9, 40, 0.5, seed + 2, (age, fr, R) => {
            const p = tip
              .clone()
              .add(dirOf(R, 1).multiplyScalar(age * 0.4 * m))
              .add(V(0, -age * age * m, 0));
            sparks.add(p, 0.7, 0.7, 0.7, 1 - fr, 0.02 * m);
          });
        }
        // the hit
        if (!fail) {
          burst(u, b1, 70, 1.0, seed + 3, (age, fr, R) => {
            const p = T.clone().add(dirOf(R, 1).multiplyScalar((1 - Math.exp(-age * 4)) * 0.6 * m));
            sparks.add(p, ...hsl(0.1 + 0.7 * R(3), 1, 0.7), (1 - fr) * 1.3, 0.04 * m, 1);
          });
          const fl = Math.exp(-Math.max(0, u - b1) * 4) * (u > b1 ? 1 : 0);
          if (fl > 0.01) {
            layer.glow[0]!.position.copy(T).addScaledVector(Sp.Tn, 0.3 * m);
            layer.glow[0]!.color.setRGB(1, 0.85, 1);
            layer.glow[0]!.intensity = fl * 1.5;
          }
        }
        if (tk === 'pumpkin') {
          const P = onWall(Sp, 0.45, 0, 0.36);
          const g = elastic(seg(u, 2.2, 3.3)) * (1 - ease(u, 8.6, 8.9));
          if (g > 0.001) {
            pumpkin.visible = true;
            pumpkin.position.copy(P).add(V(0, (0.26 + 0.03 * Math.sin(u * 2.2)) * m * Math.min(1, g), 0));
            const laugh = win(u, 4.4, 4.6, 7.4, 7.8);
            const bob = 1 + laugh * 0.06 * Math.abs(Math.sin(u * 16));
            pumpkin.scale.set(g, g * bob, g);
            pumpkin.rotation.set(
              0,
              Math.atan2(Sp.eye.x - P.x, Sp.eye.z - P.z) + 0.2 * Math.sin(u * 2) * laugh,
              0,
            );
            pumpkinFace.uniforms.uTime!.value = u + 2;
            layer.glow[0]!.position.copy(P)
              .add(V(0, 0.25 * m, 0))
              .addScaledVector(Sp.Tn, 0.4 * m);
            layer.glow[0]!.color.setRGB(1, 0.55, 0.15);
            layer.glow[0]!.intensity = Math.max(layer.glow[0]!.intensity, 0.5 * g);
          }
          puff(u, 8.75, P.clone().add(V(0, 0.2 * m, 0)), 0.6 * m, seed + 4, 0.65);
          burst(u, 8.75, 60, 1.2, seed + 5, (age, fr, R) => {
            const p = P.clone()
              .add(V(0, 0.2 * m, 0))
              .add(dirOf(R, 1).multiplyScalar((1 - Math.exp(-age * 3)) * 0.7 * m));
            sparks.add(p, 1, 0.6 + 0.3 * R(3), 0.15, (1 - fr) * 1.2, 0.04 * m, 1);
          });
        }
        if (tk === 'bats') {
          const M = onWall(Sp, 0.45, 1.45, 0.02);
          const ma = win(u, 2.1, 2.7, 8.4, 9.4);
          if (ma > 0.001) {
            moon.visible = true;
            moon.position.copy(M);
            moon.lookAt(M.clone().add(Sp.Tn));
            (moon.material as THREE.ShaderMaterial).uniforms.uA!.value = ma;
          }
          const mt = new THREE.Matrix4();
          const q = new THREE.Quaternion();
          let n = 0;
          for (let i = 0; i < NB; i++) {
            const R = (k: number) => hash(seed * 0.37 + i * 9.1 + k * 3.3);
            const te = 2.9 + i * 0.17;
            const tau = u - te;
            if (tau < 0 || tau > 5.2) continue;
            const q01 = tau / 5.2;
            const side = R(1) * 2 - 1;
            const P0 = M.clone()
              .addScaledVector(Sp.Tx, side * 0.25 * m)
              .addScaledVector(UP, (R(2) - 0.5) * 0.4 * m)
              .addScaledVector(Sp.Tn, -0.1 * m);
            const P1 = P0.clone()
              .addScaledVector(Sp.Tn, (0.9 + R(3) * 0.6) * m)
              .addScaledVector(Sp.Tx, side * 0.7 * m);
            const toMain = Sp.right ? Sp.Tx.clone().multiplyScalar(-1) : V(-1, 0, 0);
            const P2 = P1.clone()
              .addScaledVector(toMain, (0.8 + R(4) * 1.4) * m)
              .add(V(0, (0.3 + R(5) * 0.8) * m, 0));
            const P3 = P2.clone()
              .add(V(0, 2.5 * m, 0))
              .addScaledVector(Sp.Tn, (1 + R(6) * 2) * m)
              .addScaledVector(toMain, R(7) * 2 * m);
            const cub = (t: number) => {
              const it = 1 - t;
              return P0.clone()
                .multiplyScalar(it * it * it)
                .addScaledVector(P1, 3 * it * it * t)
                .addScaledVector(P2, 3 * it * t * t)
                .addScaledVector(P3, t * t * t);
            };
            const pos = cub(q01).add(V(0, Math.sin(tau * 6 + i) * 0.05 * m, 0));
            const ahead = cub(Math.min(1, q01 + 0.02))
              .sub(cub(q01))
              .normalize();
            q.setFromUnitVectors(V(0, 0, 1), ahead.lengthSq() > 0 ? ahead : V(0, 0, 1));
            const sc = 0.8 + 0.5 * R(8);
            const flap = Math.sin(tau * 17 + i * 2) * 0.9;
            mt.compose(pos, q, V(sc, sc, sc));
            bats.B.setMatrixAt(n, mt);
            const wl = new THREE.Matrix4().makeRotationZ(flap);
            const wr = new THREE.Matrix4()
              .makeRotationZ(-flap)
              .multiply(new THREE.Matrix4().makeScale(-1, 1, 1));
            bats.L.setMatrixAt(n, mt.clone().multiply(wl));
            bats.R.setMatrixAt(n, mt.clone().multiply(wr));
            // red eyes
            const e = pos.clone().addScaledVector(ahead, 0.02 * m * sc);
            sparks.add(e, 1.5, 0.15, 0.1, 0.9, 0.025 * m * sc);
            n++;
          }
          for (const b of [bats.L, bats.R, bats.B]) {
            b.count = n;
            b.instanceMatrix.needsUpdate = true;
            b.visible = n > 0;
          }
          layer.glow[1]!.position.copy(M).addScaledVector(Sp.Tn, 0.5 * m);
          layer.glow[1]!.color.setRGB(1, 0.9, 0.6);
          layer.glow[1]!.intensity = Math.max(layer.glow[1]!.intensity, ma * 0.6);
        }
        if (tk === 'cauldron') {
          const C = onWall(Sp, 0.45, 0, 0.4);
          const g = elastic(seg(u, 2.25, 2.7)) * (1 - ease(u, 9.2, 9.4));
          puff(u, 2.25, C.clone().add(V(0, 0.2 * m, 0)), 0.6 * m, seed + 6, 0.6);
          puff(u, 9.3, C.clone().add(V(0, 0.2 * m, 0)), 0.6 * m, seed + 7, 0.6);
          if (g > 0.001) {
            cauldron.g.visible = true;
            cauldron.g.position.copy(C);
            cauldron.g.scale.setScalar(g);
            cauldron.liquidMat.uniforms.uTime!.value = u;
            layer.glow[0]!.position.copy(C)
              .add(V(0, 0.6 * m, 0))
              .addScaledVector(Sp.Tn, 0.2 * m);
            layer.glow[0]!.color.setRGB(0.3, 1, 0.35);
            layer.glow[0]!.intensity = Math.max(layer.glow[0]!.intensity, 0.9 * g);
            const surf = C.clone().add(V(0, (RAISE + 0.3) * m * g, 0));
            // the fire under the pot
            emit(u, 2.4, 9.3, 50, 0.7, seed + 11, (age, fr, R) => {
              const p = C.clone().add(
                V(
                  (R(1) - 0.5) * 0.22 * m,
                  0.04 * m + age * (0.35 + R(2) * 0.25) * m,
                  (R(3) - 0.5) * 0.22 * m,
                ),
              );
              sparks.add(p, 1.3, 0.55 + 0.35 * (1 - fr), 0.12, (1 - fr) * 1.2 * g, (0.07 - 0.04 * fr) * m, 0);
            });
            // steam
            emit(u, 2.6, 9.2, 14, 2.2, seed + 8, (age, fr, R) => {
              const p = surf
                .clone()
                .add(V((R(1) - 0.5) * 0.3 * m, age * 0.35 * m, (R(2) - 0.5) * 0.3 * m))
                .add(V(Math.sin(age * 2 + R(3) * 6) * 0.05 * m, 0, 0));
              smoke.add(
                p,
                0.35,
                0.8,
                0.4,
                (1 - fr) * 0.35 * Math.min(1, age * 3),
                (0.12 + age * 0.12) * m,
                3,
              );
            });
            // bubbles: up, wobbling, colourful – and pop
            emit(u, 3.0, 8.0, 5, 3.0, seed + 9, (age, fr, R) => {
              const life = 1.8 + R(1) * 1.2;
              if (age > life) return;
              const size = (0.06 + R(2) * 0.1) * m * Math.min(1, age * 4);
              const p = surf
                .clone()
                .add(V((R(3) - 0.5) * 0.25 * m, age * (0.35 + R(4) * 0.3) * m, (R(5) - 0.5) * 0.25 * m))
                .addScaledVector(Sp.Tx, Math.sin(age * 3 + R(6) * 6) * 0.08 * m);
              sparks.add(p, ...hsl(R(7), 1, 0.7), 0.95, size * 2, 2);
              void fr;
            });
            emit(u, 3.0, 8.0, 5, 3.6, seed + 9, (age, _fr, R) => {
              const life = 1.8 + R(1) * 1.2;
              const ap = age - life;
              if (ap < 0 || ap > 0.5) return;
              const p0 = surf
                .clone()
                .add(V((R(3) - 0.5) * 0.25 * m, life * (0.35 + R(4) * 0.3) * m, (R(5) - 0.5) * 0.25 * m))
                .addScaledVector(Sp.Tx, Math.sin(life * 3 + R(6) * 6) * 0.08 * m);
              for (let j = 0; j < 8; j++) {
                const d = V(Math.cos(j * 0.785), Math.sin(j * 0.785), 0.3 * Math.sin(j * 2.1));
                sparks.add(
                  p0.clone().addScaledVector(d, ap * 0.4 * m),
                  ...hsl(R(7), 1, 0.75),
                  (1 - ap / 0.5) * 1.2,
                  0.025 * m,
                  0,
                );
              }
            });
            // the big bubble at the end
            const bb = seg(u, 7.6, 8.6);
            if (u > 7.6 && u < 8.6) {
              const p = surf.clone().add(V(0, (0.15 + bb * 0.7) * m, 0));
              sparks.add(p, ...hsl(u * 0.3, 1, 0.7), 1, (0.1 + bb * 0.45) * m * 2, 2);
            }
            burst(u, 8.6, 120, 1.5, seed + 10, (age, fr, R) => {
              const p = surf
                .clone()
                .add(V(0, 0.85 * m, 0))
                .addScaledVector(dirOf(R, 1), (1 - Math.exp(-age * 3)) * 0.9 * m)
                .add(V(0, -age * age * 0.25 * m, 0));
              sparks.add(p, ...hsl(R(3), 1, 0.65), (1 - fr) * 1.3, 0.04 * m, R(4) > 0.6 ? 1 : 0);
            });
          }
        }
        if (tk === 'fireworks') {
          for (let i = 0; i < 6; i++) {
            const R0 = (k: number) => hash(seed * 0.21 + i * 7.7 + k * 1.9);
            const tl = 2.3 + i * 0.95;
            const base = onWall(Sp, 0.12 + 0.76 * R0(1), 0, 0.06);
            const hgt = (1.0 + R0(2) * 0.6) * m;
            const col = hsl(R0(3), 1, 0.6);
            const top = base
              .clone()
              .add(V(0, hgt, 0))
              .addScaledVector(Sp.Tx, (R0(4) - 0.5) * 0.3 * m);
            const rise = (t: number) => base.clone().lerp(top, 1 - (1 - clamp01(t / 0.9)) ** 2);
            if (u > tl && u < tl + 0.9) sparks.add(rise(u - tl), 1.4, 1.1, 0.8, 1, 0.06 * m);
            emit(u, tl, tl + 0.9, 70, 0.4, seed + 20 + i, (age, fr, R, j) => {
              const p = rise(j / 70)
                .add(dirOf(R, 1).multiplyScalar(age * 0.1 * m))
                .add(V(0, -age * age * 0.5 * m, 0));
              sparks.add(p, 1, 0.75, 0.4, (1 - fr) * 0.9, 0.025 * m);
            });
            burst(u, tl + 0.9, 110, 1.8, seed + 40 + i, (age, fr, R) => {
              const d = dirOf(R, 1);
              d.addScaledVector(Sp.Tn, -d.dot(Sp.Tn) * 0.7);
              const sp = (0.65 + R(3) * 0.3) * m;
              const p = top
                .clone()
                .addScaledVector(d, (sp * (1 - Math.exp(-age * 2.2))) / 1.1)
                .add(V(0, -age * age * 0.35 * m, 0));
              const tw = 0.6 + 0.4 * Math.sin(age * 30 + R(5) * 20);
              sparks.add(
                p,
                col[0] * 1.6,
                col[1] * 1.6,
                col[2] * 1.6,
                (1 - fr) * 1.4 * tw,
                0.065 * m,
                R(4) > 0.8 ? 1 : 0,
              );
            });
          }
          // falling stars over the right wall and the right part of the main wall
          emit(u, 2.8, 9.0, 26, 3.5, seed + 60, (age, fr, R) => {
            const onRight = R(1) > 0.35;
            const p = onRight
              ? onWall(Sp, R(2), 2.6, 0.08 + R(3) * 0.2)
              : V((R(2) * 0.6 + 0.2) * Math.abs(Sp.F.pu[0]) * 0.5, Sp.F.p0[1], 0.08 + R(3) * 0.2);
            p.add(V(Math.sin(age * 2 + R(4) * 6) * 0.05 * m, -age * (0.45 + R(5) * 0.3) * m, 0));
            const tw = 0.55 + 0.45 * Math.sin(age * 12 + R(6) * 9);
            sparks.add(
              p,
              ...hsl(0.12 + 0.05 * R(7), 1, 0.75),
              (1 - fr) * tw * 1.1,
              (0.04 + R(8) * 0.04) * m,
              1,
            );
          });
        }
        if (tk === 'frog') {
          const Fp = onWall(Sp, 0.45, 0, 0.15);
          puff(u, 2.8, Fp.clone().add(V(0, 0.25 * m, 0)), 0.65 * m, seed + 70, 0.5);
          burst(u, 2.8, 25, 0.8, seed + 71, (age, fr, R) => {
            const p = Fp.clone()
              .add(V(0, 0.25 * m, 0))
              .addScaledVector(dirOf(R, 1), age * 0.6 * m);
            sparks.add(p, 0.6, 0.9, 0.4, 1 - fr, 0.03 * m);
          });
          const vis = u > 3.2 && u < 8.65;
          if (vis) {
            frog.g.visible = true;
            const p = frogPos(Sp, u);
            frog.g.position.copy(p);
            const away = Sp.Tx.clone();
            const yawF = u < 6.3 ? Math.atan2(Sp.eye.x - p.x, Sp.eye.z - p.z) : Math.atan2(away.x, away.z);
            frog.g.rotation.set(0, yawF, 0);
            const croak = Math.max(win(u, 4.5, 4.65, 4.85, 5.0), win(u, 5.5, 5.65, 5.85, 6.0));
            frog.sac.scale.setScalar(0.4 + croak * 1.1);
            const sq = 1 - 0.15 * Math.max(0, Math.sin(u * 2.2)) * (u < 6.3 ? 1 : 0);
            frog.g.scale.set(1, sq, 1);
          }
          puff(u, 8.6, frogPos(Sp, 8.6).add(V(0, 0.1 * m, 0)), 0.35 * m, seed + 72, 0.55);
        }
        void F;
      };

      /** A puff of smoke at t (seconds of the same clock as a). */
      const puff = (a: number, t: number, p: THREE.Vector3, size: number, seed: number, grey: number) => {
        burst(a, t, 44, 2.2, seed, (age, fr, R) => {
          const d = dirOf(R, 1);
          d.y = Math.abs(d.y) * 0.6 + 0.2;
          const q = p
            .clone()
            .addScaledVector(d, (1 - Math.exp(-age * 3.5)) * size * 0.55)
            .add(V(0, age * 0.1 * size, 0));
          const g = grey * (0.85 + 0.3 * R(3));
          smoke.add(
            q,
            g,
            g * 0.95,
            g * 1.05,
            (1 - fr) ** 1.5 * 0.5,
            size * (0.22 + 0.22 * R(4) + age * 0.25),
            3,
          );
        });
      };

      /** Sparkle trail behind the flying broom. */
      const trail = (a: number, _ps: { seat?: THREE.Vector3 }, seat: THREE.Vector3, hd: THREE.Vector3) => {
        const back = seat.clone().addScaledVector(hd.clone().normalize(), -0.62 * m);
        // positions of the past are not known here: let them drift down and away from where she is now
        for (let i = 0; i < 40; i++) {
          const age = i * 0.03;
          const R = (k: number) => hash(Math.floor(a * 33 - i) * 1.37 + k * 7.1);
          const p = back
            .clone()
            .addScaledVector(hd.clone().normalize(), -age * 1.6 * m)
            .add(dirOf(R, 1).multiplyScalar(age * 0.4 * m))
            .add(V(0, -age * age * 0.6 * m, 0));
          sparks.add(
            p,
            ...hsl(0.75 + 0.25 * R(3), 1, 0.7),
            (1 - age / 1.2) * 1.1,
            (0.03 + 0.02 * R(4)) * m,
            R(5) > 0.7 ? 1 : 0,
          );
        }
      };

      /** Where the frog is (hopping away at the end). */
      const frogPos = (Sp: Space, u: number) => {
        const base = onWall(Sp, 0.45, 0, 0.15);
        const away = Sp.Tx.clone();
        let d = 0;
        let y = 0;
        for (const t0 of [6.4, 7.1, 7.8]) {
          const q = seg(u, t0, t0 + 0.45);
          d += q * 0.35 * m;
          y += Math.sin(Math.PI * q) * 0.22 * m;
        }
        return base.addScaledVector(away, d).add(V(0, y, 0));
      };

      let params = ctx.params;
      return {
        render,
        resize: () => {
          S = null;
        },
        setParams: (p) => {
          params = p;
        },
        dispose: () => {
          rig.dispose();
          layer.dispose();
        },
      };
    },
  };
}

const still = (x: number, z: number, yaw: number): Body => ({
  x,
  z,
  yaw,
  drop: 0,
  hop: 0,
  lean: 0,
  sway: 0,
  beat: 0.5,
  lift: 0,
});

/** The off-axis camera from the eye through this side's rectangle (all in show space). */
function view(cam: THREE.PerspectiveCamera, f: Face, eye: THREE.Vector3): boolean {
  const n = f.n.clone().normalize();
  const x = f.x.clone().normalize();
  const y = f.down.clone().normalize().negate();
  const d = eye.clone().sub(f.o);
  const dist = d.dot(n);
  if (dist < 0.05) return false;
  const near = 0.05;
  const c = f.o.clone().sub(eye);
  const x0 = c.dot(x);
  const x1 = x0 + f.w;
  const yTop = c.dot(y);
  const yBot = yTop - f.h;
  const s = near / dist;
  cam.position.copy(eye);
  cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, n));
  cam.projectionMatrix.makePerspective(x0 * s, x1 * s, yTop * s, yBot * s, near, 200);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
  cam.updateMatrixWorld(true);
  return true;
}

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------
interface Flight {
  curve: THREE.CatmullRomCurve3;
}
/** In: from far behind the right wall (or high on the right), over to where she lands. */
function flyInPath(S: Space, stand: THREE.Vector3, hip: number): Flight {
  const m = S.m;
  const land = stand.clone().add(V(0, hip, 0));
  const pts = S.right
    ? [
        onWall(S, 0.7, 2.6, -7),
        onWall(S, 0.55, 2.2, -2.5),
        onWall(S, 0.45, 1.9, 0.6),
        land.clone().add(V(0.9 * m, 1.1 * m, 0.9 * m)),
        land.clone().add(V(0.3 * m, 0.25 * m, 0.25 * m)),
        land,
      ]
    : [
        V(Math.abs(S.F.pu[0]) * 0.75, S.F.p0[1] + 0.6 * m, 2 * m),
        V(Math.abs(S.F.pu[0]) * 0.3, S.F.p0[1] - 0.2 * m, 1.2 * m),
        land.clone().add(V(0.9 * m, 1.1 * m, 0.9 * m)),
        land.clone().add(V(0.3 * m, 0.25 * m, 0.25 * m)),
        land,
      ];
  return { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal') };
}
/** Out: up, a curve over the main wall, then off into the distance behind the right wall. */
function flyOutPath(S: Space, stand: THREE.Vector3, hip: number): Flight {
  const m = S.m;
  const start = stand.clone().add(V(0, hip, 0));
  const fo = flyOutHeading(S, stand);
  const pts = S.right
    ? [
        start,
        start
          .clone()
          .addScaledVector(fo, 0.4 * m)
          .add(V(0, 0.3 * m, 0)),
        start.clone().add(V(-0.8 * m, 1.3 * m, 0.7 * m)),
        start.clone().add(V(0.2 * m, 1.9 * m, 1.2 * m)),
        onWall(S, 0.4, 2.0, 0.8),
        onWall(S, 0.55, 2.3, -2.5),
        onWall(S, 0.7, 2.8, -9),
      ]
    : [
        start,
        start
          .clone()
          .addScaledVector(fo, 0.4 * m)
          .add(V(0, 0.3 * m, 0)),
        start.clone().add(V(-0.8 * m, 1.3 * m, 0.7 * m)),
        start.clone().add(V(0.6 * m, 1.9 * m, 1.0 * m)),
        V(Math.abs(S.F.pu[0]) * 0.8, S.F.p0[1] + 0.5 * m, 1.5 * m),
        V(Math.abs(S.F.pu[0]) * 1.4, S.F.p0[1] + 1.2 * m, 2.5 * m),
      ];
  return { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal') };
}
function flyOutHeading(S: Space, stand: THREE.Vector3): THREE.Vector3 {
  const d = V(-0.6, 0, 0.8);
  void S;
  void stand;
  return d.normalize();
}
/** The broom that drops her: across high above her place, on and away. */
function plopPath(S: Space, stand: THREE.Vector3, hip: number): Flight {
  const m = S.m;
  const over = stand.clone().add(V(0, hip + 0.9 * m, 0.05 * m));
  const pts = [
    over.clone().add(V(2.4 * m, 0.7 * m, 0.6 * m)),
    over.clone().add(V(1.0 * m, 0.15 * m, 0.2 * m)),
    over,
    over.clone().add(V(-1.2 * m, 0.4 * m, 0.1 * m)),
    over.clone().add(V(-3.2 * m, 1.6 * m, 0.8 * m)),
  ];
  return { curve: new THREE.CatmullRomCurve3(pts, false, 'centripetal') };
}
function rideOn(fl: Flight, t: number, t0: number, t1: number) {
  const q = seg(t, t0, t1);
  // a little slower at the start and end
  const e = q * q * (3 - 2 * q) * 0.4 + q * 0.6;
  const seat = fl.curve.getPointAt(e);
  const hd = fl.curve.getTangentAt(Math.min(0.999, e));
  // the broom stays level-ish, nose a little up/down with the path
  const heading = V(hd.x, hd.y * 0.5, hd.z).normalize();
  if (Math.hypot(heading.x, heading.z) < 0.2) heading.set(0, 0, 1);
  return { mode: 'ride' as const, seat, heading };
}
function bankOf(ps: { heading?: THREE.Vector3 }, a: number): number {
  void ps;
  return 0.1 * Math.sin(a * 1.7);
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------
function witchCues(): Cue[] {
  const v = () => soundVariant;
  const out: Cue[] = [];
  const when = (at: number, cond: () => boolean, play: (s: SoundApi) => void) =>
    out.push({ at, play: (s) => cond() && play(s) });
  const sparkle = (s: SoundApi, g = 0.18) =>
    s.chime({ notes: [1568, 1976, 2349, 2637], gain: g, spacing: 0.05 });
  const poofS = (s: SoundApi) => {
    s.whoosh({ duration: 0.5, from: 1200, to: 200, gain: 0.3 });
    s.pop({ freq: 160, gain: 0.4 });
  };
  // entrances
  when(
    1.2,
    () => v().entry === 'broom',
    (s) => s.whoosh({ duration: 4.8, from: 200, to: 900, gain: 0.25 }),
  );
  when(
    6.4,
    () => v().entry === 'broom',
    (s) => s.knock({ count: 2, gain: 0.25, spacing: 0.12 }),
  );
  when(7.2, () => v().entry === 'broom', poofS);
  when(
    1.5,
    () => v().entry === 'poof',
    (s) => sparkle(s, 0.2),
  );
  when(
    2.4,
    () => v().entry === 'poof',
    (s) => sparkle(s, 0.2),
  );
  when(3.0, () => v().entry === 'poof', poofS);
  when(
    1.3,
    () => v().entry === 'plop',
    (s) => s.whoosh({ duration: 2.4, from: 300, to: 1100, gain: 0.3 }),
  );
  when(
    3.4,
    () => v().entry === 'plop',
    (s) => s.whoosh({ duration: 0.55, from: 900, to: 150, gain: 0.3 }),
  );
  when(
    3.95,
    () => v().entry === 'plop',
    (s) => {
      s.knock({ count: 1, gain: 0.6 });
      s.rumble({ duration: 0.4, gain: 0.3 });
    },
  );
  when(
    4.2,
    () => v().entry === 'plop',
    (s) => s.chime({ notes: [2093, 1760, 2093, 1760, 2093], gain: 0.12, spacing: 0.18 }),
  );
  // hello
  when(
    8.5,
    () => true,
    (s) => s.chime({ notes: [784, 988, 1175], gain: 0.22 }),
  );
  when(
    10.85,
    () => true,
    (s) => sparkle(s, 0.25),
  );
  // the tricks
  for (let k = 0; k < 3; k++) {
    const t0 = SLOT0 + k * SLOT;
    const is = (t: Trick) => () => v().tricks[k] === t;
    // the spell (all but the failed one)
    when(
      t0 + 1.3,
      () => v().tricks[k] !== 'frog',
      (s) => {
        s.whoosh({ duration: 0.8, from: 400, to: 2400, gain: 0.2 });
        sparkle(s, 0.2);
      },
    );
    when(
      t0 + 2.2,
      () => v().tricks[k] !== 'frog',
      (s) => s.chime({ notes: [1047, 1319, 1568, 2093], gain: 0.22 }),
    );
    // pumpkin: grows, laughs
    when(t0 + 2.3, is('pumpkin'), (s) => s.whoosh({ duration: 0.9, from: 120, to: 500, gain: 0.3 }));
    when(t0 + 4.5, is('pumpkin'), (s) => s.ooh({ duration: 0.5, base: 150, gain: 0.35 }));
    when(t0 + 5.1, is('pumpkin'), (s) => s.ooh({ duration: 0.5, base: 140, gain: 0.35 }));
    when(t0 + 5.7, is('pumpkin'), (s) => s.ooh({ duration: 0.7, base: 128, gain: 0.35 }));
    when(t0 + 8.75, is('pumpkin'), poofS);
    // bats
    when(t0 + 2.2, is('bats'), (s) => s.ooh({ duration: 2.2, base: 260, gain: 0.12 }));
    for (const dt of [3.0, 3.6, 4.2, 4.9, 5.6])
      when(t0 + dt, is('bats'), (s) => {
        s.whoosh({ duration: 0.7, from: 600, to: 1600, gain: 0.18 });
        s.chime({ notes: [3520, 3951], gain: 0.05, spacing: 0.04 });
      });
    // cauldron
    when(t0 + 2.25, is('cauldron'), poofS);
    for (let i = 0; i < 14; i++)
      when(t0 + 3 + i * 0.36, is('cauldron'), (s) => s.pop({ freq: 300 + ((i * 137) % 500), gain: 0.18 }));
    when(t0 + 8.6, is('cauldron'), (s) => {
      s.pop({ freq: 200, gain: 0.5 });
      sparkle(s, 0.25);
    });
    when(t0 + 9.3, is('cauldron'), poofS);
    // fireworks
    for (let i = 0; i < 6; i++) {
      when(t0 + 2.3 + i * 0.95, is('fireworks'), (s) =>
        s.whoosh({ duration: 0.85, from: 500, to: 2600, gain: 0.18 }),
      );
      when(t0 + 3.2 + i * 0.95, is('fireworks'), (s) => {
        s.pop({ freq: 110, gain: 0.55 });
        s.knock({ count: 6, gain: 0.12, spacing: 0.05, delay: 0.25 });
      });
    }
    // the spell that goes wrong: fizzle, puff, a frog
    when(t0 + 1.3, is('frog'), (s) => s.whoosh({ duration: 0.6, from: 900, to: 300, gain: 0.15 }));
    when(t0 + 2.8, is('frog'), (s) => {
      s.rumble({ duration: 0.6, gain: 0.35 });
      s.pop({ freq: 120, gain: 0.5 });
    });
    for (const dt of [4.5, 5.5])
      when(t0 + dt, is('frog'), (s) =>
        s.arpeggio({ notes: [98, 87, 98], gain: 0.4, step: 0.08, wave: 'square' }),
      );
    for (const dt of [6.4, 7.1, 7.8]) when(t0 + dt, is('frog'), (s) => s.pop({ freq: 520, gain: 0.25 }));
    when(t0 + 8.6, is('frog'), poofS);
    // applause / ta-da
    when(
      t0 + 9.3,
      () => v().tricks[k] !== 'frog',
      (s) => s.arpeggio({ notes: [523, 659, 784, 1047], gain: 0.2, step: 0.09, wave: 'triangle' }),
    );
    when(t0 + 9.4, is('frog'), (s) =>
      s.arpeggio({ notes: [392, 370, 349, 330], gain: 0.18, step: 0.18, wave: 'triangle' }),
    );
  }
  // exits
  when(
    48.0,
    () => v().exit === 'poof',
    (s) => s.chime({ notes: [1175, 988, 784], gain: 0.22 }),
  );
  when(
    49.3,
    () => v().exit === 'poof',
    (s) => s.whoosh({ duration: 2, from: 300, to: 2600, gain: 0.25 }),
  );
  when(
    51.2,
    () => v().exit === 'poof',
    (s) => {
      poofS(s);
      sparkle(s, 0.3);
    },
  );
  when(
    48.0,
    () => v().exit === 'fly',
    (s) => s.chime({ notes: [1175, 988, 784], gain: 0.22 }),
  );
  when(49.2, () => v().exit === 'fly', poofS);
  when(
    50.3,
    () => v().exit === 'fly',
    (s) => s.whoosh({ duration: 5.5, from: 900, to: 200, gain: 0.28 }),
  );
  return out;
}

export const wallWitchScene: SceneModule = witchScene();
