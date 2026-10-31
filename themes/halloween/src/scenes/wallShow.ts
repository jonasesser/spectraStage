/**
 * Full-body wall shows: real rigged figures (GLB, Mixamo skeleton) break out of the wall through
 * door-high holes, step out into the room, do their thing in front of the wall (the bloody couple
 * waltzes, the mummy staggers at you and screams, the cute monster waves and dances), walk back
 * in – and the wall builds itself up again.
 *
 * Everything moves procedurally on the skeleton: feet step and stay planted (leg IK with real
 * knee hinges), hands reach their targets (arm IK with real elbow hinges, each hand its own),
 * the partners really hold each other. Seen from the audience standpoint (off-axis camera through
 * the wall), so in the room they look as if they stood in front of the wall.
 */
import * as THREE from 'three';
import {
  shaderScene,
  type DrawState,
  type FaceBox,
  type SceneModule,
  type SoundApi,
} from '@spectrastage/engine';
import {
  basisQ,
  clocks,
  COMPOSITE_FRAG,
  elbowIK,
  frameOf,
  KEY_POS,
  loadGltf,
  makeHoles,
  NO_TEX,
  occludeMaterial,
  pauseOf,
  speedOf,
  WALL_FRAG_LEAN,
  type Frame,
  type HoleUniforms,
} from './wallMonster.ts';

type V3 = [number, number, number];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const seg = (a: number, t0: number, t1: number) => clamp01((a - t0) / (t1 - t0));
const sm = (v: number) => v * v * (3 - 2 * v);
const ease = (a: number, t0: number, t1: number) => sm(seg(a, t0, t1));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const vec = (v: V3) => new THREE.Vector3(v[0], v[1], v[2]);
const UP = new THREE.Vector3(0, 1, 0);

/** The figure's own directions for a turn `yaw` (it faces +z at yaw 0; its left is +x). */
const fwdOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const leftOf = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
/** Shortest turn from a to b. */
const turnTo = (a: number, b: number, t: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

// ---------------------------------------------------------------------------
// Body over time
// ---------------------------------------------------------------------------
/** Where a figure stands (floor point x/z), which way it faces, and how it holds its body. */
export interface Body {
  x: number;
  z: number;
  yaw: number;
  /** Hips lower (bent knees), local units. */
  drop: number;
  /** Lift off the floor (jumps), local units. */
  hop: number;
  /** Upper body leaning forward (+) / back (−), radians; and sideways. */
  lean: number;
  sway: number;
  /** Step rhythm (s per step) and how high the feet lift. */
  beat: number;
  lift: number;
  /** Shoulders turned against the hips (walking), radians. */
  twist?: number;
}

/** Keyframes [t, x, z, yaw] → position and facing; walking straight between them. */
function path(keys: [number, number, number, number][], t: number): { x: number; z: number; yaw: number } {
  if (t <= keys[0]![0]) return { x: keys[0]![1], z: keys[0]![2], yaw: keys[0]![3] };
  for (let i = 1; i < keys.length; i++) {
    const k1 = keys[i]!;
    if (t <= k1[0]) {
      const k0 = keys[i - 1]!;
      const u = (t - k0[0]) / Math.max(1e-3, k1[0] - k0[0]);
      // walking: steady in the middle, speeding up / slowing down at the ends
      const r = 0.15;
      const e =
        u < r ? (u * u) / (2 * r) : u > 1 - r ? 1 - r - ((1 - u) * (1 - u)) / (2 * r) : r / 2 + (u - r);
      const ee = e / (1 - r);
      return {
        x: mix(k0[1], k1[1], ee),
        z: mix(k0[2], k1[2], ee),
        yaw: turnTo(k0[3], k1[3], sm(clamp01(u * 3))),
      };
    }
  }
  const k = keys[keys.length - 1]!;
  return { x: k[1], z: k[2], yaw: k[3] };
}

/**
 * Where the feet are: they step one after the other (one per beat) towards where the body will
 * be, and stand still in between – so they never slide. Pure function of time.
 */
export function feetAt(bodyAt: (t: number) => Body, t: number, width: number, floorY: number): [V3, V3] {
  const b = bodyAt(t);
  const B = Math.max(0.15, b.beat);
  const nom = (tt: number, side: number): V3 => {
    const bb = bodyAt(tt);
    const l = leftOf(bb.yaw);
    return [bb.x + l.x * side * width, floorY + bb.hop, bb.z + l.z * side * width];
  };
  const out: V3[] = [];
  for (const side of [1, -1]) {
    const j = side > 0 ? 0 : 1;
    const n = Math.floor(t / B);
    if (((n % 2) + 2) % 2 === j) {
      const e = (t - n * B) / B;
      const p0 = nom((n - 0.5) * B, side);
      const p1 = nom((n + 1.5) * B, side);
      const d = Math.hypot(p1[0] - p0[0], p1[2] - p0[2]);
      const lift = Math.min(0.09, d * 0.6 + b.lift) * Math.sin(Math.PI * e);
      const ee = sm(e);
      out.push([mix(p0[0], p1[0], ee), mix(p0[1], p1[1], ee) + lift, mix(p0[2], p1[2], ee)]);
    } else out.push(nom((n + 0.5) * B, side));
  }
  return [out[0]!, out[1]!];
}

/**
 * The wall alone can't show the floor in front of it: feet standing out there would be seen below
 * the wall's bottom edge – cut off. So the floor rises a little towards the viewer, just so much
 * that every foot is seen on the wall (and a bit above its edge): at the wall it is the real floor.
 */
export function standLift(F: Frame, z: number): number {
  if (z <= 0) return 0;
  const eyeH = F.ro[1] - F.floorY;
  return (eyeH * z) / Math.max(0.5, F.ro[2]) + Math.min(1, z / 0.15) * (0.05 / F.k);
}

/** Turning about the vertical of a rotation (where +z ends up). */
function yawOfQ(q: THREE.Quaternion): number {
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  return Math.atan2(f.x, f.z);
}

// ---------------------------------------------------------------------------
// The rig: a loaded figure and its limbs
// ---------------------------------------------------------------------------
interface Limb {
  upper: THREE.Bone;
  lower: THREE.Bone;
  end: THREE.Bone;
  l1: number;
  l2: number;
  /** Bind pose (world, figure facing +z): limb direction, the way the joint folds, rotations. */
  a0: THREE.Vector3;
  f0: THREE.Vector3;
  q0: [THREE.Quaternion, THREE.Quaternion, THREE.Quaternion];
  /** Hands: finger and palm direction in the hand bone's own space. */
  finger: THREE.Vector3;
  palm: THREE.Vector3;
}

/** A hand target: wrist position, where the fingers point and the palm faces, elbow hints. */
export interface Reach {
  at: THREE.Vector3;
  fingers: THREE.Vector3;
  palm: THREE.Vector3;
  /** Where the elbow may point, tried in order (figure-relative is up to the caller). */
  poles: THREE.Vector3[];
}

// ---------------------------------------------------------------------------
// A guest's face on a figure
// ---------------------------------------------------------------------------
/** A guest photo as it comes from the show (face box found by face landmarks, if any). */
export interface FacePhoto {
  img: CanvasImageSource & { width: number; height: number };
  raw?: CanvasImageSource & { width: number; height: number };
  readonly face?: FaceBox | null;
}

/**
 * The face of a guest photo for a figure's face: square, upright, the face (forehead to chin,
 * cheek to cheek) filling FACE_FILL of it, fully opaque, only the very edge soft. With a face box
 * from face landmarks; without one (none found) guessed from the cut-out silhouette.
 */
export const FACE_FILL = 0.84;
export function faceCrop(
  img: CanvasImageSource & { width: number; height: number },
  face?: FaceBox | null,
): HTMLCanvasElement | null {
  const box = face ?? guessFace(img);
  if (!box) return null;
  const S = 256;
  const out = document.createElement('canvas');
  out.width = out.height = S;
  const o = out.getContext('2d');
  if (!o) return null;
  // face box → texture: centre in the middle, upright, face width/height → FACE_FILL of the square
  const fw = box.w * img.width;
  const fh = box.h * img.height;
  o.save();
  o.translate(S / 2, S / 2);
  o.scale((S * FACE_FILL) / fw, (S * FACE_FILL) / fh);
  o.rotate(-box.roll);
  o.translate(-box.cx * img.width, -box.cy * img.height);
  o.drawImage(img, 0, 0);
  o.restore();
  // an oval just around the face: opaque inside, soft only at the edge
  o.globalCompositeOperation = 'destination-in';
  // eyes, nose and mouth fully the guest's; from the cheeks out it melts into the figure's face
  const gr = o.createRadialGradient(S / 2, S / 2, S * 0.28, S / 2, S / 2, S * 0.5);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(0.35, 'rgba(0,0,0,0.85)');
  gr.addColorStop(0.7, 'rgba(0,0,0,0.35)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = gr;
  o.fillRect(0, 0, S, S);
  return out;
}

/** No landmarks: the head from the cut-out silhouette (widest row near the top, down to the neck). */
function guessFace(img: CanvasImageSource & { width: number; height: number }): FaceBox | null {
  const w = Math.min(256, img.width);
  const h = Math.round((img.height * w) / img.width);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const rows: [number, number][] = [];
  let top = -1;
  for (let y = 0; y < h; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3]! > 100) {
        if (x0 < 0) x0 = x;
        x1 = x;
      }
    rows.push([x0, x1]);
    if (top < 0 && x0 >= 0) top = y;
  }
  if (top < 0) return null;
  // the head grows from the top; it ends where the silhouette suddenly widens (shoulders)
  let headW = 0;
  let headRow = top;
  for (let y = top; y < h; y++) {
    const [x0, x1] = rows[y]!;
    const ww = x0 >= 0 ? x1 - x0 : 0;
    if (y > top + 4 && headW > 0 && ww > headW * 1.45) break;
    if (ww > headW) {
      headW = ww;
      headRow = y;
    }
  }
  const [hx0, hx1] = rows[headRow]!;
  const fh = headW * 1.3;
  return {
    cx: (hx0 + hx1) / 2 / w,
    cy: (top + fh * 0.58) / h,
    w: (headW * 0.86) / w,
    h: (fh * 0.82) / h,
    roll: 0,
  };
}

const FACE_GLSL = /* glsl */ `
uniform float uFaceOn;
uniform sampler2D uFaceTex;
uniform mat4 uFaceM;
`;

export class Rig {
  ready = false;
  root = new THREE.Group();
  private bind = new Map<THREE.Object3D, THREE.Quaternion>();
  private b: Record<string, THREE.Bone> = {};
  private arms!: { L: Limb; R: Limb };
  private legs!: { L: Limb; R: Limb };
  private height = 1;
  size = 1;
  private yaw = 0;
  private headQ0 = new THREE.Quaternion();
  private headH = 0.2;
  private disposed = false;
  /** A guest's face painted onto the figure's face (projected from the front of the head). */
  private face = {
    uFaceOn: { value: 0 },
    uFaceTex: { value: NO_TEX as THREE.Texture },
    uFaceM: { value: new THREE.Matrix4() },
  };
  private faceId: string | null = null;
  /** Feet in front of the wall stay visible (see standLift); off where the scene lifts its own floor. */
  liftFloor = true;
  /** Recorded motions (motion capture, from the model file). */
  private clips = new Map<string, THREE.AnimationClip>();
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private hips0 = new THREE.Vector3();
  private hipsScale = 1;
  private mats: THREE.Material[] = [];

  constructor(
    url: string,
    private readonly heightM: number,
    holes: HoleUniforms,
  ) {
    void loadGltf(url).then((g) => {
      if (!g || this.disposed) return;
      const model = g.scene.clone(true);
      for (const c of g.animations) this.clips.set(c.name, c);
      if (this.clips.size) this.mixer = new THREE.AnimationMixer(model);
      this.setup(model, holes);
    });
  }

  private setup(model: THREE.Group, holes: HoleUniforms) {
    let g = model;
    const by: Record<string, THREE.Bone> = {};
    g.traverse((o) => {
      if ((o as THREE.Bone).isBone) by[o.name.replace(/^mixamorig:?/, '')] = o as THREE.Bone;
    });
    const need = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
    for (const s of ['Left', 'Right'])
      need.push(s + 'Arm', s + 'ForeArm', s + 'Hand', s + 'UpLeg', s + 'Leg', s + 'Foot');
    if (need.some((n) => !by[n])) {
      console.warn('[wallShow] model has no Mixamo skeleton');
      return;
    }
    g.traverse((o) => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      m.frustumCulled = false;
      m.skeleton = new THREE.Skeleton(
        m.skeleton.bones.map((bn) => by[bn.name.replace(/^mixamorig:?/, '')] ?? bn),
        m.skeleton.boneInverses,
      );
      m.bind(m.skeleton, m.bindMatrix);
      // own materials: the loaded model is shared by every play of the show, and a material's
      // shader keeps the uniforms (holes, face) of whoever compiled it first – a second play would
      // show the first one's long-closed holes and no face
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) this.mats.push(mat);
      for (const mat of mats)
        occludeMaterial(mat as THREE.MeshStandardMaterial, holes, (sh) => {
          Object.assign(sh.uniforms, this.face);
          sh.fragmentShader = sh.fragmentShader
            .replace('void main() {', FACE_GLSL + 'void main() {')
            .replace(
              '#include <map_fragment>',
              `#include <map_fragment>
  // the guest's face: projected from the front of the head, covering the figure's own face fully
  float faceK = 0.0;
  vec3 faceC = vec3(0.0);
  if (uFaceOn > 0.5) {
    vec3 fq = (uFaceM * vec4(vWallPos, 1.0)).xyz;
    if (fq.z > -0.5 && fq.z < 1.0 && abs(fq.x) < 1.0 && abs(fq.y) < 1.0) {
      vec4 fc = texture2D(uFaceTex, fq.xy * 0.5 + 0.5);
      faceK = fc.a * smoothstep(-0.5, -0.2, fq.z) * (1.0 - smoothstep(0.85, 1.0, max(abs(fq.x), abs(fq.y))));
      // towards the edge the photo takes on the brightness of the figure's skin (no hard step)
      float lb = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      float lf = max(0.04, dot(fc.rgb, vec3(0.299, 0.587, 0.114)));
      faceC = mix(fc.rgb, fc.rgb * clamp(lb / lf, 0.6, 1.6), (1.0 - fc.a) * 0.8);
      diffuseColor.rgb = mix(diffuseColor.rgb, faceC, faceK);
    }
  }`,
            )
            .replace(
              '#include <opaque_fragment>',
              // lit like the figure, but never darker than the photo itself (people must recognise it)
              `outgoingLight = mix(outgoingLight, max(outgoingLight, faceC * 0.85), faceK);
  #include <opaque_fragment>`,
            );
        });
    });
    g.updateMatrixWorld(true);
    // some models face −z: turn them round so all face +z (toes point forwards)
    const toe = by.LeftToeBase ?? by.LeftFoot!;
    const heel = by.LeftFoot!;
    const toeZ = toe.getWorldPosition(new THREE.Vector3()).z - heel.getWorldPosition(new THREE.Vector3()).z;
    const fwdZ = by.LeftToeBase ? toeZ : 1;
    if (fwdZ < 0) {
      const holder = new THREE.Group();
      holder.add(g);
      holder.rotation.y = Math.PI;
      holder.updateMatrixWorld(true);
      g = holder;
    }
    g.traverse((o) => this.bind.set(o, o.quaternion.clone()));
    const box = new THREE.Box3().setFromObject(g);
    this.height = Math.max(0.1, box.max.y - box.min.y);
    const wp = (n: string) => by[n]!.getWorldPosition(new THREE.Vector3());
    const wq = (n: string) => by[n]!.getWorldQuaternion(new THREE.Quaternion());
    const limb = (u: string, l: string, e: string, fold: THREE.Vector3): Limb => {
      const a = wp(u);
      const bb = wp(l);
      const c = wp(e);
      const a0 = bb.clone().sub(a).normalize();
      const f0 = fold
        .clone()
        .sub(a0.clone().multiplyScalar(fold.dot(a0)))
        .normalize();
      const hq = wq(e).invert();
      return {
        upper: by[u]!,
        lower: by[l]!,
        end: by[e]!,
        l1: a.distanceTo(bb),
        l2: bb.distanceTo(c),
        a0,
        f0,
        q0: [wq(u), wq(l), wq(e)],
        finger: c.clone().sub(bb).normalize().applyQuaternion(hq),
        palm: new THREE.Vector3(0, -1, 0).applyQuaternion(hq),
      };
    };
    // elbows fold forwards (T-pose, palms down), knees fold backwards
    const fwd = new THREE.Vector3(0, 0, 1);
    const back = new THREE.Vector3(0, 0, -1);
    this.arms = {
      L: limb('LeftArm', 'LeftForeArm', 'LeftHand', fwd),
      R: limb('RightArm', 'RightForeArm', 'RightHand', fwd),
    };
    this.legs = {
      L: limb('LeftUpLeg', 'LeftLeg', 'LeftFoot', back),
      R: limb('RightUpLeg', 'RightLeg', 'RightFoot', back),
    };
    this.headQ0 = wq('Head');
    this.headH = wp('Head').distanceTo(
      by.HeadTop_End ? wp('HeadTop_End') : wp('Head').add(new THREE.Vector3(0, 0.2, 0)),
    );
    this.b = by;
    this.hips0.copy(by.Hips!.position);
    // hips units → the figure's units (the model's own scale, e.g. centimetres)
    this.hipsScale = by.Hips!.parent ? by.Hips!.parent.getWorldScale(new THREE.Vector3()).x : 1;
    this.root.add(g);
    this.ready = true;
  }

  /** Arm length (local units). */
  get arm() {
    return this.ready ? (this.arms.L.l1 + this.arms.L.l2) * this.size : 0.5;
  }

  pos(name: string): THREE.Vector3 {
    return this.b[name]!.getWorldPosition(new THREE.Vector3());
  }

  /** Places the figure and sets up its body; legs step to the given feet. */
  pose(body: Body, feet: [V3, V3], F: Frame) {
    if (!this.ready) return;
    for (const [o, q] of this.bind) o.quaternion.copy(q);
    this.b.Hips!.position.copy(this.hips0);
    this.size = this.heightM / F.k / this.height;
    this.yaw = body.yaw;
    const yq = new THREE.Quaternion().setFromAxisAngle(UP, body.yaw);
    this.root.scale.setScalar(this.size);
    this.root.quaternion.copy(yq);
    const up = (z: number) => (this.liftFloor ? standLift(F, z) : 0);
    this.root.position.set(body.x, F.floorY + up(body.z) + body.hop - body.drop, body.z);
    const lifted = feet.map((f) => [f[0], f[1] + up(f[2]), f[2]] as V3);
    this.root.updateMatrixWorld(true);
    // upper body: lean and sway, spread over the spine
    const left = leftOf(body.yaw);
    const fw = fwdOf(body.yaw);
    const lean = new THREE.Quaternion()
      .setFromAxisAngle(left, body.lean / 3)
      .multiply(new THREE.Quaternion().setFromAxisAngle(fw, body.sway / 3))
      .multiply(new THREE.Quaternion().setFromAxisAngle(UP, (body.twist ?? 0) / 3));
    for (const n of ['Spine', 'Spine1', 'Spine2']) this.turn(this.b[n]!, lean);
    // legs to the feet (knees point forwards)
    this.limb(this.legs.L, vec(lifted[0]!), [fw.clone().add(left.clone().multiplyScalar(0.15))]);
    this.limb(this.legs.R, vec(lifted[1]!), [fw.clone().add(left.clone().multiplyScalar(-0.15))]);
    for (const leg of [this.legs.L, this.legs.R]) this.setWorldQ(leg.end, yq.clone().multiply(leg.q0[2]));
  }

  /** The pose as it is now (for blending into another one). */
  capture(): {
    root: [THREE.Vector3, THREE.Quaternion, number];
    hips: THREE.Vector3;
    q: Map<THREE.Object3D, THREE.Quaternion>;
  } {
    const q = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const o of this.bind.keys()) q.set(o, o.quaternion.clone());
    return {
      root: [this.root.position.clone(), this.root.quaternion.clone(), this.root.scale.x],
      hips: this.ready ? this.b.Hips!.position.clone() : new THREE.Vector3(),
      q,
    };
  }

  /** Blends from a captured pose (w = 0) to the pose now (w = 1). */
  blendFrom(snap: ReturnType<Rig['capture']>, w: number) {
    if (!this.ready) return;
    const k = clamp01(w);
    for (const [o, q0] of snap.q) o.quaternion.copy(q0.clone().slerp(o.quaternion, k));
    this.b.Hips!.position.lerpVectors(snap.hips, this.b.Hips!.position, k);
    this.root.position.lerpVectors(snap.root[0], this.root.position, k);
    this.root.quaternion.copy(snap.root[1].clone().slerp(this.root.quaternion, k));
    this.root.scale.setScalar(mix(snap.root[2], this.root.scale.x, k));
    this.root.updateMatrixWorld(true);
  }

  /** The figure's scale in this frame (local units per model unit). */
  scaleFor(F: Frame): number {
    return this.heightM / F.k / this.height;
  }

  /** Has this recorded motion. */
  has(clip: string): boolean {
    return this.clips.has(clip);
  }

  /** Length of a recorded motion (s). */
  dur(clip: string): number {
    return this.clips.get(clip)?.duration ?? 1;
  }

  /**
   * Places the figure and plays recorded motion: clips blended by weight, each at its own time
   * (looped). The clips' own travel is always taken out – the body moves the figure (see
   * travel()); with `ownYaw` off also their turning (the body's yaw is the facing).
   */
  play(body: Body, F: Frame, layers: { clip: string; t: number; w: number }[], ownYaw: boolean) {
    if (!this.ready || !this.mixer) return;
    this.size = this.heightM / F.k / this.height;
    this.yaw = body.yaw;
    this.root.scale.setScalar(this.size);
    this.root.quaternion.setFromAxisAngle(UP, body.yaw);
    const up = this.liftFloor ? standLift(F, body.z) : 0;
    this.root.position.set(body.x, F.floorY + up + body.hop - body.drop, body.z);
    let sum = 0;
    for (const l of layers) sum += Math.max(0, l.w);
    const used = new Set<string>();
    for (const l of layers) {
      const clip = this.clips.get(l.clip);
      if (!clip || l.w <= 0 || used.has(l.clip)) continue;
      let act = this.actions.get(l.clip);
      if (!act) {
        act = this.mixer.clipAction(clip);
        this.actions.set(l.clip, act);
      }
      act.enabled = true;
      act.setEffectiveWeight(l.w / Math.max(1e-6, sum));
      act.play();
      act.time = ((l.t % clip.duration) + clip.duration) % clip.duration;
      used.add(l.clip);
    }
    for (const [n, act] of this.actions) if (!used.has(n)) act.enabled = false;
    this.mixer.update(0);
    const h = this.b.Hips!;
    h.position.x = this.hips0.x;
    h.position.z = this.hips0.z;
    if (!ownYaw) h.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -yawOfQ(h.quaternion)));
    this.root.updateMatrixWorld(true);
  }

  /**
   * Where a clip carries the figure (its recorded travel and turning) at time t, relative to the
   * start of the clip – in the figure's local units (×size = scene units).
   */
  travel(clip: string, t: number): { x: number; z: number; yaw: number } {
    const c = this.clips.get(clip);
    if (!c) return { x: 0, z: 0, yaw: 0 };
    const pos = c.tracks.find((k) => k.name.endsWith('Hips.position'));
    const rot = c.tracks.find((k) => k.name.endsWith('Hips.quaternion'));
    const tt = Math.max(0, Math.min(c.duration, t));
    const v = (tr: THREE.KeyframeTrack | undefined, n: number, at: number) =>
      tr ? Array.from(tr.createInterpolant(new Float32Array(n)).evaluate(at)) : new Array<number>(n).fill(0);
    const p0 = v(pos, 3, 0);
    const p1 = v(pos, 3, tt);
    const q = v(rot, 4, tt);
    return {
      x: (p1[0]! - p0[0]!) * this.hipsScale,
      z: (p1[2]! - p0[2]!) * this.hipsScale,
      yaw: rot ? yawOfQ(new THREE.Quaternion(q[0], q[1], q[2], q[3])) : 0,
    };
  }

  /** Arms: a reach per hand (null = hanging relaxed at the side). L = the figure's left hand. */
  hands(L: Reach | null, R: Reach | null) {
    if (!this.ready) return;
    const fw = fwdOf(this.yaw);
    const left = leftOf(this.yaw);
    for (const [limb, reach, side] of [
      [this.arms.L, L, 1],
      [this.arms.R, R, -1],
    ] as const) {
      const r =
        reach ??
        ({
          at: limb.upper
            .getWorldPosition(new THREE.Vector3())
            .add(left.clone().multiplyScalar(side * 0.05))
            .add(new THREE.Vector3(0, -this.arm * 0.93, 0))
            .add(fw.clone().multiplyScalar(0.04)),
          fingers: new THREE.Vector3(0, -1, 0),
          palm: left.clone().multiplyScalar(-side),
          poles: [
            left
              .clone()
              .multiplyScalar(side * 0.3)
              .add(fw.clone().multiplyScalar(-1)),
          ],
        } satisfies Reach);
      this.limb(limb, r.at, r.poles);
      this.hand(limb, r);
    }
  }

  /** Puts a guest's face (cut-out photo) onto the figure – or none. */
  private faceWait = 0;
  setFace(id: string | null, pic: FacePhoto | null) {
    if (id === this.faceId && (pic || !id)) return;
    if (id && !pic) return; // still loading – try again next frame
    // the face search runs once per photo; wait for it (a few seconds at most)
    if (id && pic && pic.face === undefined) {
      if (this.faceWait === 0) this.faceWait = performance.now();
      if (performance.now() - this.faceWait < 6000) return;
    }
    this.faceWait = 0;
    this.faceId = id;
    if (this.face.uFaceTex.value !== NO_TEX) this.face.uFaceTex.value.dispose();
    this.face.uFaceTex.value = NO_TEX;
    this.face.uFaceOn.value = 0;
    if (!id || !pic) return;
    const crop = faceCrop(pic.raw ?? pic.img, pic.face);
    if (!crop) return;
    const t = new THREE.CanvasTexture(crop);
    t.colorSpace = THREE.SRGBColorSpace;
    this.face.uFaceTex.value = t;
    this.face.uFaceOn.value = 1;
  }

  /** Where the face is now: a box in front of the head, turning with it. */
  private updateFace() {
    if (!this.ready || this.face.uFaceOn.value < 0.5) return;
    const head = this.b.Head!;
    const q = head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headQ0.clone().invert());
    const H = this.headH * this.size;
    // image right = the figure's left (seen from the front it is on your right)
    const X = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const Y = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    const Z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const O = head
      .getWorldPosition(new THREE.Vector3())
      .add(Y.clone().multiplyScalar(H * 0.42))
      .add(Z.clone().multiplyScalar(H * 0.3));
    const m = new THREE.Matrix4().makeBasis(
      X.multiplyScalar(H * 0.5),
      Y.multiplyScalar(H * 0.62),
      Z.multiplyScalar(H * 0.4),
    );
    m.setPosition(O);
    this.face.uFaceM.value.copy(m).invert();
  }

  /** Turns the head (and a little the neck) to look at a point. */
  look(target: THREE.Vector3, amount = 1) {
    if (!this.ready || amount <= 0) return;
    const head = this.b.Head!;
    const p = head.getWorldPosition(new THREE.Vector3());
    const want = target.clone().sub(p).normalize();
    // the head's forward: the figure's forward (bind pose) turned as the head is turned now
    const have = new THREE.Vector3(0, 0, 1).applyQuaternion(
      head.getWorldQuaternion(new THREE.Quaternion()).multiply(this.headQ0.clone().invert()),
    );
    // limit: a head turns about 70°
    let q = new THREE.Quaternion().setFromUnitVectors(have.normalize(), want);
    const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w)));
    if (ang > 1.2) q = new THREE.Quaternion().slerp(q, 1.2 / ang);
    q = new THREE.Quaternion().slerp(q, amount);
    this.turn(this.b.Neck!, new THREE.Quaternion().slerp(q, 0.4));
    this.turn(head, new THREE.Quaternion().slerp(q, 0.6));
  }

  /** After posing: the face follows the head. */
  finish() {
    this.updateFace();
  }

  private turn(b: THREE.Object3D, q: THREE.Quaternion) {
    this.setWorldQ(b, q.clone().multiply(b.getWorldQuaternion(new THREE.Quaternion())));
  }

  private setWorldQ(b: THREE.Object3D, wq: THREE.Quaternion) {
    const pq = b.parent ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    b.quaternion.copy(pq.invert().multiply(wq));
    b.updateMatrixWorld(true);
  }

  /**
   * Two-bone limb with a real hinge: the upper bone points at the joint, turned so the lower bone
   * can only fold the natural way, the lower bone turns about the hinge axis only.
   */
  private limb(L: Limb, target: THREE.Vector3, poles: THREE.Vector3[]) {
    const s = this.size;
    const S = L.upper.getWorldPosition(new THREE.Vector3());
    let W = target.clone();
    const reach = (L.l1 + L.l2) * s * 0.995;
    if (W.distanceTo(S) > reach) W = S.clone().add(W.sub(S).normalize().multiplyScalar(reach));
    const pole = poles[0] ?? new THREE.Vector3(0, 0, 1);
    const Ev = elbowIK([S.x, S.y, S.z], [W.x, W.y, W.z], L.l1 * s, L.l2 * s, [pole.x, pole.y, pole.z]);
    const E = vec(Ev);
    const u = E.clone().sub(S).normalize();
    const fw = W.clone().sub(E);
    let v = fw.clone().sub(u.clone().multiplyScalar(fw.dot(u)));
    if (v.length() < 1e-4)
      v = pole
        .clone()
        .sub(u.clone().multiplyScalar(pole.dot(u)))
        .negate();
    v.normalize();
    const yq = new THREE.Quaternion().setFromAxisAngle(UP, this.yaw);
    const a0 = L.a0.clone().applyQuaternion(yq);
    const f0 = L.f0.clone().applyQuaternion(yq);
    const R = basisQ(u, v).multiply(basisQ(a0, f0).invert());
    this.setWorldQ(L.upper, R.clone().multiply(yq.clone().multiply(L.q0[0])));
    const axis = new THREE.Vector3().crossVectors(u, v).normalize();
    const w = fw.normalize();
    const bend = Math.atan2(w.dot(v), w.dot(u));
    const R2 = new THREE.Quaternion().setFromAxisAngle(axis, bend).multiply(R);
    this.setWorldQ(L.lower, R2.multiply(yq.clone().multiply(L.q0[1])));
  }

  /** Hand orientation: fingers / palm as wanted, the wrist bending at most ~80° off the forearm. */
  private hand(L: Limb, r: Reach) {
    const fore = L.end
      .getWorldPosition(new THREE.Vector3())
      .sub(L.lower.getWorldPosition(new THREE.Vector3()))
      .normalize();
    let g = r.fingers.clone().normalize();
    const ang = g.angleTo(fore);
    if (ang > 1.4)
      g = fore
        .clone()
        .lerp(g, 1.4 / ang)
        .normalize();
    const palm = r.palm.clone().sub(g.clone().multiplyScalar(r.palm.dot(g)));
    if (palm.length() < 1e-3) palm.copy(new THREE.Vector3(0, -1, 0));
    const want = basisQ(g, palm.normalize());
    const have = basisQ(L.finger, L.palm);
    this.setWorldQ(L.end, want.multiply(have.invert()));
  }

  dispose() {
    this.disposed = true;
    if (this.face.uFaceTex.value !== NO_TEX) this.face.uFaceTex.value.dispose();
    for (const m of this.mats) m.dispose();
  }
}

// ---------------------------------------------------------------------------
// Drawing the figures over the wall
// ---------------------------------------------------------------------------
export class FigureLayer {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera();
  private rt: THREE.WebGLRenderTarget | null = null;
  private quad: THREE.Mesh | null = null;
  private quadScene = new THREE.Scene();
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  glow: THREE.PointLight[] = [
    new THREE.PointLight(0xffffff, 0, 0, 2),
    new THREE.PointLight(0xffffff, 0, 0, 2),
  ];
  private key = new THREE.DirectionalLight(0xfff0dd, 1.7);
  private front = new THREE.DirectionalLight(0xc8d4ff, 0.35);
  private fill = new THREE.HemisphereLight(0x8899bb, 0x110808, 0.3);
  fade = 1;

  constructor() {
    this.key.position.set(KEY_POS[0], KEY_POS[1], KEY_POS[2]);
    this.front.position.set(-1, 0.6, 3);
    this.scene.add(this.key, this.key.target, this.front, this.front.target, this.fill, ...this.glow);
  }

  private warmed = false;
  /**
   * Prepares every shader and texture of the figures and props once, while the show is still
   * dark – otherwise the graphics card does it in the moment a figure first appears, and the
   * picture stutters for a moment.
   */
  warm(r: THREE.WebGLRenderer) {
    if (this.warmed) return;
    this.warmed = true;
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    try {
      r.compile(this.scene, this.camera);
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        for (const mat of m ? (Array.isArray(m) ? m : [m]) : [])
          for (const v of Object.values(mat))
            if (v instanceof THREE.Texture && !(v as THREE.VideoTexture).isVideoTexture) r.initTexture(v);
      });
    } catch {
      /* nothing – it then happens on the first frame as before */
    } finally {
      for (const o of hidden) o.visible = false;
    }
  }

  /** The off-axis camera: from the eye point through the wall rectangle. */
  view(F: Frame) {
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
      60,
    );
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();
    this.camera.updateMatrixWorld(true);
  }

  render(r: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
    // at most ~1920 px: a 4K multisampled half-float target eats hundreds of MB of GPU memory
    const k = Math.min(1, 1920 / Math.max(target.width, target.height));
    const w = Math.max(2, Math.round(target.width * k));
    const h = Math.max(2, Math.round(target.height * k));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.dispose();
      this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType });
    }
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
    const prevAuto = r.autoClear;
    const prevColor = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    const qm = this.quad.material as THREE.ShaderMaterial;
    qm.uniforms.map!.value = this.rt.texture;
    qm.uniforms.uFade!.value = this.fade;
    r.autoClear = false;
    r.setRenderTarget(target);
    r.render(this.quadScene, this.ortho);
    r.autoClear = prevAuto;
    r.setClearColor(prevColor, prevAlpha);
  }

  dispose() {
    this.rt?.dispose();
    this.quad?.geometry.dispose();
    (this.quad?.material as THREE.Material | undefined)?.dispose();
  }
}

// ---------------------------------------------------------------------------
// The wall over time (shared by all shows)
// ---------------------------------------------------------------------------
const SHOW = 50;
const BURST = 10;
const REBUILD = 41;

interface WallState {
  bulge: number;
  crack: number;
  open: number;
  debrisT: number;
  glow: number;
  fade: number;
}

function wallAt(a: number, rebuild: boolean): WallState {
  // it takes its time: bulging and cracking for seconds, then a first break, the hole grows piece
  // by piece; at the end the pieces fly back one by one and the cracks heal slowly
  const bulge = ease(a, 3.5, 8.5) * (1 - ease(a, 9.8, 10.4));
  const close = rebuild ? ease(a, 41.2, 46.6) : 0;
  const open = (0.5 * ease(a, BURST, BURST + 0.7) + 0.5 * ease(a, BURST + 0.5, BURST + 3)) * (1 - close);
  const crack = ease(a, 5.5, 9.9) * (rebuild ? 1 - ease(a, 45.5, 48.5) : 1);
  // debris flies out at the burst – and (building up again) back into the wall
  let debrisT = -1;
  if (a >= BURST && a < BURST + 3.2) debrisT = a - BURST;
  if (rebuild && a >= REBUILD + 0.8 && a < 46.6) debrisT = Math.max(0, (46.6 - a) * 0.66);
  const flash = a >= BURST ? Math.exp(-(a - BURST) * 2.5) : 0;
  const glow =
    (0.18 * crack + 0.82 * open + 0.8 * flash) *
    (1 - ease(a, 42, 46.5)) *
    (0.9 + 0.1 * Math.sin(a * 13.1) * Math.sin(a * 7.3));
  const fade = ease(a, 0, 1.2) * (1 - ease(a, rebuild ? 48.5 : 41.5, rebuild ? 50 : 44));
  return { bulge, crack, open, debrisT, glow, fade };
}

/** Door-high hole (bottom below the floor), centre x; s: hole size. */
function doorHole(x: number, F: Frame, tall: number): THREE.Vector4 {
  // top at `tall` above the floor, bottom a bit below it, about shoulder-wide and a half
  return new THREE.Vector4(x, F.floorY + tall * 0.45, ((0.42 / 0.62) * tall) / 1.55, (tall * 0.55) / 0.62);
}

// ---------------------------------------------------------------------------
// The shows
// ---------------------------------------------------------------------------
interface Actor {
  rig: Rig;
  /** Body over time (local units, floor point). */
  body: (a: number) => Body;
  width: number;
}

interface ShowDef {
  id: string;
  cute: boolean;
  glow: V3;
  actors: { url: string; height: number }[];
  /** Hole centres x (one per actor or shared), and how tall the holes are (local units). */
  holes: (F: Frame) => number[];
  tall: number;
  /** Bodies over time for each actor (needs the frame for hole places). */
  bodies: (F: Frame) => ((a: number) => Body)[];
  /** Scene params with a guest photo for each actor (face), if any. */
  faces?: string[];
  /** Hands and looks once the bodies stand (other actors' bones available). */
  arms: (a: number, rigs: Rig[], F: Frame, eye: THREE.Vector3) => void;
  /**
   * Recorded motion (motion capture clips in the model files) instead of the computed one: what
   * each actor does at show time a. Used when all figures have their clips (`clips`).
   */
  motion?: (F: Frame, rigs: Rig[], seed: number, params: Record<string, unknown>) => (a: number) => Move[];
  /** A piece of music from show time `at` (once per round), replaceable in the sound list (slot). */
  music?: { url: string; at: number; slot: string; gain: number };
  clips?: string[][];
}

interface Layer {
  clip: string;
  t: number;
  w: number;
}
/** What a figure does now: where it is, which recorded motions play, where it looks. */
interface Move {
  body: Body;
  layers: Layer[];
  /** The clips turn the figure themselves (spins in a dance). */
  ownYaw?: boolean;
  /** Look at the audience (0…1) or at the other figure (lookAt). */
  look?: number;
  lookAt?: number;
  /**
   * A dance of our own instead of recorded motion (weight w, blended with the clips): the body
   * over time and – shared by both – the arms (holding each other).
   */
  proc?: { w: number; body: (a: number) => Body };
  procArms?: (a: number, rigs: Rig[], eye: THREE.Vector3) => void;
}

/** A row of steps over time; each blends into the next over `fade` seconds. */
type Step = [a0: number, act: (a: number) => Move];
function steps(list: Step[], a: number, fade = 0.5): Move {
  let i = 0;
  while (i + 1 < list.length && a >= list[i + 1]![0]) i++;
  const cur = list[i]![1](a);
  const k = i > 0 ? ease(a, list[i]![0], list[i]![0] + fade) : 1;
  if (k >= 1) return cur;
  const prev = list[i - 1]![1](a);
  const yaw = prev.body.yaw + wrapAng(cur.body.yaw - prev.body.yaw) * k;
  return {
    body: {
      ...cur.body,
      x: mix(prev.body.x, cur.body.x, k),
      z: mix(prev.body.z, cur.body.z, k),
      yaw,
      drop: mix(prev.body.drop, cur.body.drop, k),
    },
    layers: [
      ...prev.layers.map((l) => ({ ...l, w: l.w * (1 - k) })),
      ...cur.layers.map((l) => ({ ...l, w: l.w * k })),
    ],
    ownYaw: k < 0.5 ? prev.ownYaw : cur.ownYaw,
    look: mix(prev.look ?? 0, cur.look ?? 0, k),
    lookAt: k < 0.5 ? prev.lookAt : cur.lookAt,
    proc:
      cur.proc && prev.proc
        ? cur.proc
        : cur.proc
          ? { ...cur.proc, w: cur.proc.w * k }
          : prev.proc
            ? { ...prev.proc, w: prev.proc.w * (1 - k) }
            : undefined,
    procArms: cur.procArms ?? prev.procArms,
  };
}
const wrapAng = (d: number) => Math.atan2(Math.sin(d), Math.cos(d));
const stand = (x: number, z: number, yaw: number): Body => ({ ...still(x, z, yaw), drop: 0 });

/** Walking from p0 to p1 between a0 and a1 with a clip played in place at the matching pace. */
function walkMove(
  a: number,
  a0: number,
  a1: number,
  p0: [number, number],
  p1: [number, number],
  clip: string,
  /** The clip's natural pace: metres per second of clip. */
  pace: number,
  F: Frame,
  yawFix = 0,
  look = 0,
): Move {
  const u = clamp01((a - a0) / Math.max(0.01, a1 - a0));
  const dx = p1[0] - p0[0];
  const dz = p1[1] - p0[1];
  const dist = Math.hypot(dx, dz) * F.k; // metres
  const speed = dist / Math.max(0.01, a1 - a0);
  const heading = Math.atan2(dx, dz);
  return {
    body: stand(mix(p0[0], p1[0], u), mix(p0[1], p1[1], u), heading + yawFix),
    layers: [{ clip, t: ((a - a0) * speed) / pace, w: 1 }],
    look,
  };
}

const still = (x: number, z: number, yaw: number, beat = 0.55): Body => ({
  x,
  z,
  yaw,
  drop: 0.02,
  hop: 0,
  lean: 0,
  sway: 0,
  beat,
  lift: 0,
});

/** Walk out of the hole to (x1, z1), facing the audience. */
const comeOut = (x: number, x1: number, z1: number, t0: number): [number, number, number, number][] => [
  [t0, x, -0.9, 0],
  [t0 + 3.4, x1, z1, 0],
];

/** Arms swinging while walking (opposite to the legs). */
function walkArms(
  rig: Rig,
  a: number,
  beat: number,
  yaw: number,
  amount: number,
): [Reach | null, Reach | null] {
  if (amount <= 0.01) return [null, null];
  const fw = fwdOf(yaw);
  const left = leftOf(yaw);
  const out: (Reach | null)[] = [];
  for (const [side, bone] of [
    [1, 'LeftArm'],
    [-1, 'RightArm'],
  ] as const) {
    const sh = rig.pos(bone);
    const sw = Math.sin((Math.PI * a) / beat + (side > 0 ? 0 : Math.PI));
    const swing = sw * 0.42 * amount;
    // forward the elbow bends more (the hand comes up), back the arm is nearly straight
    const bend = amount * (0.03 + 0.1 * Math.max(0, sw));
    out.push({
      at: sh
        .clone()
        .add(new THREE.Vector3(0, -rig.arm * (0.9 - bend), 0))
        .add(fw.clone().multiplyScalar(swing * rig.arm * 0.85))
        .add(left.clone().multiplyScalar(side * 0.07)),
      fingers: new THREE.Vector3(0, -1, 0).add(fw.clone().multiplyScalar(swing + bend * 1.5)),
      palm: left.clone().multiplyScalar(-side),
      poles: [
        fw
          .clone()
          .multiplyScalar(-1)
          .add(left.clone().multiplyScalar(side * 0.3)),
      ],
    });
  }
  return [out[0]!, out[1]!];
}

// ---- the bloody couple: two holes, they come out, waltz, she twirls, they go back in
/** Where the couple's holes are: well to the right and left (local units from the middle). */
function coupleHoleX(F: Frame): number {
  const half = Math.abs(F.pu[0]) / 2;
  return Math.max(0.7, Math.min(half * 0.68, half - 0.55));
}

/** Holding each other in the waltz (hold 0…1), the twirl under his arm (0…1), looking at you (0…1). */
function coupleHold(rigs: Rig[], eye: THREE.Vector3, hold: number, twirl: number, atYou: number) {
  const [groom, bride] = rigs as [Rig, Rig];
  if (hold < 0.01 || !groom.ready || !bride.ready) return;
  const gC = groom.pos('Spine2');
  const bC = bride.pos('Spine2');
  const toB = bC.clone().sub(gC).setY(0).normalize();
  const gLeft = new THREE.Vector3(toB.z, 0, -toB.x); // his left (facing her)
  // joined hands: his left, her right – out to his left side at shoulder height (raised over
  // her head while she twirls)
  const sh = groom.pos('LeftArm').add(bride.pos('RightArm')).multiplyScalar(0.5);
  const joinLow = sh
    .clone()
    .add(gLeft.clone().multiplyScalar(0.2))
    .add(new THREE.Vector3(0, 0.04, 0));
  const joinHigh = bride
    .pos('Head')
    .add(new THREE.Vector3(0, 0.22, 0))
    .add(gLeft.clone().multiplyScalar(0.03));
  const join = joinLow.clone().lerp(joinHigh, twirl);
  const blend = (rest: THREE.Vector3, t: THREE.Vector3) => rest.clone().lerp(t, hold);
  const restG = (side: number) =>
    groom.pos(side > 0 ? 'LeftArm' : 'RightArm').add(new THREE.Vector3(0, -groom.arm * 0.92, 0));
  const restB = (side: number) =>
    bride.pos(side > 0 ? 'LeftArm' : 'RightArm').add(new THREE.Vector3(0, -bride.arm * 0.92, 0));
  // his right hand on her back (her left shoulder blade), her left hand on his right shoulder
  const back = bC
    .clone()
    .add(toB.clone().multiplyScalar(0.11))
    .add(gLeft.clone().multiplyScalar(-0.07))
    .add(new THREE.Vector3(0, 0.03, 0));
  const shoulder = groom
    .pos('RightArm')
    .add(new THREE.Vector3(0, 0.04, 0))
    .add(toB.clone().multiplyScalar(-0.02));
  const down = new THREE.Vector3(0, -1, 0);
  groom.hands(
    {
      at: blend(restG(1), join),
      fingers: UP.clone(),
      palm: toB.clone(),
      poles: [down.clone().add(gLeft.clone().multiplyScalar(0.6))],
    },
    {
      at: blend(restG(-1), twirl > 0.5 ? restG(-1).add(gLeft.clone().multiplyScalar(-0.15)) : back),
      fingers: gLeft.clone().multiplyScalar(-1).add(toB.clone().multiplyScalar(0.3)),
      palm: toB.clone(),
      poles: [down.clone().add(gLeft.clone().multiplyScalar(-0.8))],
    },
  );
  bride.hands(
    {
      at: blend(
        restB(1),
        twirl > 0.5
          ? restB(1)
              .add(gLeft.clone().multiplyScalar(-0.25))
              .add(new THREE.Vector3(0, 0.2, 0))
          : shoulder,
      ),
      fingers: toB
        .clone()
        .negate()
        .add(new THREE.Vector3(0, -0.3, 0)),
      palm: down.clone(),
      poles: [down.clone().add(gLeft.clone().multiplyScalar(-0.6))],
    },
    {
      at: blend(restB(-1), join),
      fingers: UP.clone(),
      palm: toB.clone().negate(),
      poles: [down.clone().add(gLeft.clone().multiplyScalar(0.6))],
    },
  );
  // they look at each other (now and then at you)
  groom.look(bride.pos('Head').lerp(eye, atYou), 0.8);
  bride.look(groom.pos('Head').lerp(eye, atYou), 0.8);
}

/** Our own waltz: the couple turns slowly around its centre, rise and fall in three, she twirls once. */
function ownWaltz(C: [number, number], W0: number, W1: number, twirlAt: number) {
  const D = 0.23; // half the distance between them (bodies must not go into each other)
  const omega = 0.55; // how fast the couple turns
  return (a: number, who: number): Body => {
    const phi = clamp01((a - W0) / Math.max(0.01, W1 - W0)) * (W1 - W0) * omega;
    const ang = phi + (who === 0 ? 0 : Math.PI);
    const x = C[0] + Math.cos(ang) * D;
    const z = C[1] + Math.sin(ang) * D;
    let yaw = Math.atan2(C[0] - x, C[1] - z);
    const bar = (Math.max(0, a - W0) / 0.55) % 3;
    const drop = 0.035 - 0.03 * Math.sin((Math.PI * Math.min(bar, 3)) / 3);
    if (who === 1) yaw += Math.PI * 2 * ease(a, twirlAt, twirlAt + 1.8);
    return { x, z, yaw, drop, hop: 0, lean: 0, sway: 0.05 * Math.sin(phi * 2), beat: 0.55, lift: 0.015 };
  };
}

const COUPLE: ShowDef = {
  id: 'wallCouple',
  cute: false,
  glow: [1.0, 0.18, 0.1],
  actors: [
    { url: '/models/groom.glb', height: 1.84 },
    { url: '/models/bride.glb', height: 1.68 },
  ],
  // the holes far to the right and left: the couple dances in the middle, not in front of them
  holes: (F) => {
    const x = coupleHoleX(F);
    return [x, -x];
  },
  tall: 1.55,
  bodies: (F) => {
    const hx = coupleHoleX(F);
    // (feet in front of the wall show below its bottom edge – so they stay close to it)
    const C: [number, number] = [0, 0.32];
    const D = 0.17; // half the distance between them
    const W0 = 17.5;
    const W1 = 33;
    const omega = 0.55; // how fast the couple turns while waltzing
    const waltz = (a: number, who: number): Body => {
      // they turn around their centre; she faces him, he faces her
      const phi = (Math.min(a, W1) - W0) * omega;
      const ang = phi + (who === 0 ? 0 : Math.PI);
      const x = C[0] + Math.cos(ang) * D;
      const z = C[1] + Math.sin(ang) * D * 0.8;
      let yaw = Math.atan2(C[0] - x, C[1] - z);
      // rise and fall in three: down on one, up on two and three
      const bar = ((a - W0) / 0.55) % 3;
      const drop = 0.035 - 0.03 * Math.sin((Math.PI * Math.min(bar, 3)) / 3);
      // the twirl: she turns once under his arm
      if (who === 1) yaw += Math.PI * 2 * ease(a, 25.6, 27.4);
      return { x, z, yaw, drop, hop: 0, lean: 0, sway: 0.05 * Math.sin(phi * 2), beat: 0.55, lift: 0.015 };
    };
    const make =
      (who: number) =>
      (a: number): Body => {
        const hole = who === 0 ? hx : -hx;
        if (a < W0) {
          // out of the hole, then towards each other
          const start = waltz(W0, who);
          // straight out through the middle of the hole, then across to the middle
          const p = path(
            [
              [BURST + 0.9, hole, -0.9, 0],
              [BURST + 3.6, hole, 0.3, 0],
              [16.4, start.x, start.z, Math.atan2(start.x - hole, 0.0001)],
              [W0, start.x, start.z, start.yaw],
            ],
            a,
          );
          return { ...still(p.x, p.z, p.yaw), beat: 0.5 };
        }
        if (a < W1) return waltz(a, who);
        // a bow to the audience, then back into the holes
        const end = waltz(W1, who);
        const p = path(
          [
            [W1, end.x, end.z, end.yaw],
            [34, end.x, end.z, 0],
            [35.6, end.x, end.z, 0],
            // across to the front of the own hole, turn, straight back in through its middle
            [37.8, hole, 0.3, Math.atan2(hole - end.x, 0.0001)],
            [38.3, hole, 0.3, Math.PI],
            [40.6, hole, -0.95, Math.PI],
          ],
          a,
        );
        return {
          ...still(p.x, p.z, p.yaw),
          beat: 0.5,
          lean: 0.45 * ease(a, 34.2, 34.8) * (1 - ease(a, 35.3, 35.9)),
        };
      };
    return [make(0), make(1)];
  },
  faces: ['groomPhoto', 'bridePhoto'],
  clips: [
    ['ZombieWalk', 'ZombieIdle', 'Walk', 'Waltz', 'Gesture'],
    ['StumbleWalk', 'Scream', 'Walk', 'Waltz', 'DanceShake', 'DanceJazz'],
  ],
  music: { url: '/sounds/couple-waltz.mp3', at: 18.5, slot: 'm:halloween/wallCouple', gain: 0.9 },
  motion: (F, rigs, seed, params) => {
    const [groom, bride] = rigs as [Rig, Rig];
    const hx = coupleHoleX(F);
    const rnd = (n: number) => {
      const v = Math.sin(seed * 127.1 + n * 311.7) * 43758.5453;
      return v - Math.floor(v);
    };
    // the dance: chosen – or by chance (the couple dance alone, or her solo first)
    const pick = String(params.dance ?? 'random');
    const r4 = rnd(4);
    const kind =
      pick === 'classic' || pick === 'waltz' || pick === 'shake' || pick === 'jazz'
        ? pick
        : r4 < 0.4
          ? 'classic'
          : r4 < 0.6
            ? 'waltz'
            : r4 < 0.8
              ? 'shake'
              : 'jazz';
    const solo = kind === 'jazz' ? 'DanceJazz' : 'DanceShake';
    const heClaps = rnd(2) < 0.5;
    const screamEnd = rnd(3) < 0.6;
    // the waltz: a recorded couple dance (both clips share one origin) – turned so they stand side
    // by side for the audience (she on the left facing right, he on the right facing her)
    // (far enough from the wall that no arm reaches into it)
    const C: [number, number] = [0, 0.55];
    const R = Math.PI / 2;
    const WT0 = 2.5; // (before, both start on the same spot)
    const waltzBody = (rig: Rig, t: number): Body => {
      const tr = rig.travel('Waltz', t);
      const k = rig.scaleFor(F);
      const x = (tr.x * Math.cos(R) + tr.z * Math.sin(R)) * k;
      const z = (-tr.x * Math.sin(R) + tr.z * Math.cos(R)) * k;
      // depth squeezed: far in front of the wall they would tower over the audience (and their
      // feet would need the floor to rise a lot)
      return stand(C[0] + x, C[1] + z * 0.3, R + tr.yaw);
    };
    const g0 = waltzBody(groom, WT0);
    const b0 = waltzBody(bride, WT0);
    const A1 = BURST + 3.8; // out of the hole
    const A2 = A1 + 2.6; // after the scream: to the middle
    const A3 = A2 + 2.8; // solo
    const A4 = A3 + 6; // waltz
    const A5 = A4 + (10 - WT0); // to the audience
    const A6 = A5 + 1.8; // back to the holes
    const A7 = A6 + 3; // turn
    const A8 = A7 + 0.6; // into the hole
    const A9 = A8 + 2.6;
    // our own waltz: holding each other, turning slowly, she twirls under his arm
    const own = ownWaltz(C, A3, A5 - 0.4, A3 + 6.5);
    const tw = A3 + 6.5;
    const ownArms = (a: number, rs: Rig[], eye: THREE.Vector3) =>
      coupleHold(
        rs,
        eye,
        ease(a, A3 - 0.3, A3 + 0.6) * (1 - ease(a, A5 - 0.6, A5)),
        ease(a, tw - 0.4, tw + 0.1) * (1 - ease(a, tw + 1.8, tw + 2.4)),
        ease(a, A3 + 9.5, A3 + 10.5) * (1 - ease(a, A3 + 12, A3 + 12.8)),
      );
    const ownMove =
      (who: 0 | 1) =>
      (a: number): Move => ({
        body: own(a, who),
        layers: [],
        proc: { w: 1, body: (t: number) => own(t, who) },
        procArms: ownArms,
      });
    const plan = (who: 0 | 1): Step[] => {
      const rig = who === 0 ? groom : bride;
      const hole = who === 0 ? hx : -hx;
      const zw = who === 0 ? 'ZombieWalk' : 'StumbleWalk';
      const zpace = who === 0 ? 1.03 : 1.12;
      // the groom's zombie walk drifts to the side: turned back so he walks straight
      const zfix = who === 0 ? -0.43 : 0;
      const at = kind === 'classic' ? own(A3, who) : who === 0 ? g0 : b0;
      // where the dance ends
      const end = () => (kind === 'classic' ? own(A5, who) : waltzBody(rig, 10));
      const idle = (x: number, z: number, yaw: number, t0: number, look = 0): Move =>
        who === 0
          ? { body: stand(x, z, yaw), layers: [{ clip: 'ZombieIdle', t: t0, w: 1 }], look }
          : { body: stand(x, z, yaw), layers: [{ clip: 'Walk', t: 0.25, w: 1 }], look };
      return [
        [0, (a) => walkMove(a, BURST + 1.2, A1, [hole, -0.7], [hole, 0.35], zw, zpace, F, zfix)],
        [
          A1,
          (a) =>
            who === 1
              ? { body: stand(hole, 0.35, 0), layers: [{ clip: 'Scream', t: a - A1, w: 1 }], look: 0.8 }
              : idle(hole, 0.35, 0, a - A1, 0.8),
        ],
        [A2, (a) => walkMove(a, A2, A3, [hole, 0.35], [at.x, at.z], 'Walk', 1.25, F)],
        [
          A3,
          (a) =>
            kind === 'classic'
              ? ownMove(who)(a)
              : kind === 'waltz'
                ? {
                    body: waltzBody(rig, WT0 + (a - A3)),
                    layers: [{ clip: 'Waltz', t: WT0 + (a - A3), w: 1 }],
                    lookAt: 1 - who,
                  }
                : who === 1
                  ? {
                      body: stand(at.x, at.z, 0),
                      layers: [{ clip: solo, t: a - A3, w: 1 }],
                      ownYaw: true,
                      look: 0.3,
                    }
                  : heClaps
                    ? {
                        body: stand(at.x, at.z, at.yaw),
                        layers: [{ clip: 'Gesture', t: a - A3, w: 1 }],
                        lookAt: 1,
                      }
                    : { ...idle(at.x, at.z, at.yaw, a - A3), lookAt: 1 },
        ],
        [
          A4,
          (a) =>
            kind === 'classic'
              ? ownMove(who)(a)
              : {
                  body: waltzBody(rig, WT0 + (a - A4)),
                  layers: [{ clip: 'Waltz', t: WT0 + (a - A4), w: 1 }],
                  lookAt: 1 - who,
                },
        ],
        [
          A5,
          (a) => {
            const e = end();
            return who === 1 && screamEnd
              ? { body: stand(e.x, e.z, 0), layers: [{ clip: 'Scream', t: a - A5, w: 1 }], look: 0.8 }
              : who === 0
                ? { body: stand(e.x, e.z, 0), layers: [{ clip: 'Gesture', t: 6 + a - A5, w: 1 }], look: 0.8 }
                : idle(e.x, e.z, 0, a - A5, 0.8);
          },
        ],
        [
          A6,
          (a) => {
            const e = end();
            return walkMove(a, A6, A7, [e.x, e.z], [hole, 0.35], 'Walk', 1.25, F);
          },
        ],
        [A7, (a) => ({ ...idle(hole, 0.35, Math.PI, a - A7) })],
        [A8, (a) => walkMove(a, A8, A9, [hole, 0.35], [hole, -0.8], zw, zpace, F, zfix)],
      ];
    };
    const plans = [plan(0), plan(1)];
    return (a) => plans.map((p) => steps(p, a, 0.55));
  },
  arms: (a, rigs, F, eye) => {
    const hold = ease(a, 16.8, 17.6) * (1 - ease(a, 33, 33.8));
    const twirl = ease(a, 25.2, 25.7) * (1 - ease(a, 27.4, 28));
    if (hold < 0.01) {
      // (walking arms stay) – they look at you when they come out and when they bow
      for (const r of rigs) r.look(eye, a < 16.3 || (a > 33.5 && a < 36) ? 0.8 : 0);
      return;
    }
    coupleHold(rigs, eye, hold, twirl, ease(a, 29, 30) * (1 - ease(a, 31.5, 32.5)));
  },
};

// ---- the mummy: comes out, staggers at you with its arms out, screams, back in
const MUMMY: ShowDef = {
  id: 'wallMummyWalk',
  cute: false,
  glow: [0.3, 0.95, 0.45],
  actors: [{ url: '/models/mummy.glb', height: 1.85 }],
  holes: () => [0],
  tall: 1.6,
  bodies: () => [
    (a: number): Body => {
      const p = path(
        [
          ...comeOut(0, 0, 0.2, BURST + 0.9),
          [23, 0.25, 0.42, 0],
          [26.5, 0.25, 0.42, 0],
          [33.5, -0.2, 0.3, 0],
          [35, -0.2, 0.3, 0],
          [36, -0.2, 0.3, Math.PI],
          [40.5, 0, -0.95, Math.PI],
        ],
        a,
      );
      const scream = ease(a, 23.6, 24.4) * (1 - ease(a, 26.2, 27));
      // stiff, slow, lurching steps
      return {
        x: p.x,
        z: p.z,
        yaw: p.yaw + 0.08 * Math.sin(a * 0.9),
        drop: 0.03,
        hop: 0,
        lean: 0.12 - 0.35 * scream,
        sway: 0.09 * Math.sin((Math.PI * a) / 0.85),
        beat: 0.85,
        lift: 0,
      };
    },
  ],
  arms: (a, rigs, _F, eye) => {
    const m = rigs[0]!;
    if (!m.ready) return;
    const yaw = Math.atan2(eye.x - m.pos('Hips').x, eye.z - m.pos('Hips').z);
    const facing = a < 35.6;
    const fw = facing ? fwdOf(yaw) : new THREE.Vector3(0, 0, -1);
    const left = facing ? leftOf(yaw) : new THREE.Vector3(-1, 0, 0);
    const reachOut = ease(a, 13.5, 15) * (1 - ease(a, 35.2, 36));
    const scream = ease(a, 23.6, 24.4) * (1 - ease(a, 26.2, 27));
    const hands: (Reach | null)[] = [];
    for (const [side, bone] of [
      [1, 'LeftArm'],
      [-1, 'RightArm'],
    ] as const) {
      const sh = m.pos(bone);
      const L = m.arm;
      const rest = sh.clone().add(new THREE.Vector3(0, -L * 0.92, 0));
      // the classic mummy: both arms stiffly forward, hands drooping
      const fwdT = sh
        .clone()
        .add(fw.clone().multiplyScalar(L * 0.88))
        .add(new THREE.Vector3(0, -0.06 + 0.03 * Math.sin(a * 1.7 + side), 0))
        .add(left.clone().multiplyScalar(side * 0.04));
      // screaming: arms up and out
      const upT = sh
        .clone()
        .add(left.clone().multiplyScalar(side * L * 0.55))
        .add(new THREE.Vector3(0, L * 0.6, 0))
        .add(fw.clone().multiplyScalar(0.1));
      const at = rest.lerp(fwdT, reachOut).lerp(upT, scream);
      hands.push({
        at,
        fingers: fw
          .clone()
          .add(new THREE.Vector3(0, -0.7, 0))
          .lerp(UP.clone().add(left.clone().multiplyScalar(side * 0.5)), scream),
        palm: new THREE.Vector3(0, -1, 0).lerp(fw.clone(), scream),
        poles: [new THREE.Vector3(0, -1, 0).add(left.clone().multiplyScalar(side * 0.4))],
      });
    }
    m.hands(hands[0]!, hands[1]!);
    // looks at you; screaming: head back
    m.look(eye.clone().add(new THREE.Vector3(0, 1.5 * scream, 0)), facing ? 0.9 : 0);
  },
};

// ---- the cute monster: comes out, waves, dances, jumps, waves goodbye, back in
const BUDDY: ShowDef = {
  id: 'wallBuddyDance',
  cute: true,
  glow: [0.55, 0.35, 1.0],
  actors: [{ url: '/models/cute-monster.glb', height: 1.25 }],
  holes: () => [0],
  tall: 1.45,
  bodies: () => [
    (a: number): Body => {
      const p = path(
        [
          ...comeOut(0, 0, 0.3, BURST + 0.9),
          [35.5, 0, 0.3, 0],
          [36.3, 0, 0.3, Math.PI],
          [40.3, 0, -0.9, Math.PI],
        ],
        a,
      );
      const dance = ease(a, 18, 18.6) * (1 - ease(a, 29.6, 30));
      const beat = 0.42;
      // side steps and bouncing to the beat, a wiggle of the hips
      const side = Math.sin((Math.PI * (a - 18)) / (beat * 4)) * 0.22 * dance;
      const bounce = Math.abs(Math.sin((Math.PI * (a - 18)) / beat)) * 0.035 * dance;
      // two big jumps
      const jump = (t0: number) => {
        const u = (a - t0) / 0.7;
        return u > 0 && u < 1 ? 4 * u * (1 - u) * 0.28 : 0;
      };
      const hop = jump(30.4) + jump(31.4);
      const crouch = (t0: number) => Math.exp(-(((a - t0) / 0.12) ** 2)) * 0.08;
      return {
        x: p.x + side,
        z: p.z,
        yaw: p.yaw + 0.35 * Math.sin((Math.PI * (a - 18)) / (beat * 2)) * dance,
        drop: 0.02 + bounce + crouch(30.35) + crouch(31.35) + crouch(31.1) + crouch(32.1),
        hop,
        lean: 0.05,
        sway: 0.18 * Math.sin((Math.PI * (a - 18)) / beat) * dance,
        beat: dance > 0.5 ? beat : 0.42,
        lift: 0.03 * dance,
      };
    },
  ],
  arms: (a, rigs, _F, eye) => {
    const m = rigs[0]!;
    if (!m.ready) return;
    const facing = a < 35.8;
    const yaw = facing ? 0 : Math.PI;
    const fw = fwdOf(yaw);
    const left = leftOf(yaw);
    const L = m.arm;
    const wave = Math.max(
      ease(a, 14, 14.6) * (1 - ease(a, 17.4, 18)),
      ease(a, 33, 33.6) * (1 - ease(a, 35.2, 35.7)),
    );
    const dance = ease(a, 18, 18.6) * (1 - ease(a, 29.6, 30));
    const jumpArms = ease(a, 30.2, 30.5) * (1 - ease(a, 32, 32.4));
    const hands: (Reach | null)[] = [];
    for (const [side, bone] of [
      [1, 'LeftArm'],
      [-1, 'RightArm'],
    ] as const) {
      const sh = m.pos(bone);
      const rest = sh
        .clone()
        .add(new THREE.Vector3(0, -L * 0.9, 0))
        .add(left.clone().multiplyScalar(side * 0.08));
      let at = rest.clone();
      let fingers = new THREE.Vector3(0, -1, 0);
      let palm = left.clone().multiplyScalar(-side);
      // waving with its left hand (on your right), palm to you
      if (side > 0 && wave > 0) {
        const wv = sh
          .clone()
          .add(left.clone().multiplyScalar(L * (0.35 + 0.12 * Math.sin(a * 9))))
          .add(new THREE.Vector3(0, L * 0.75, 0))
          .add(fw.clone().multiplyScalar(0.1));
        at = at.lerp(wv, wave);
        fingers = fingers.lerp(UP.clone().add(left.clone().multiplyScalar(0.3 * Math.sin(a * 9))), wave);
        palm = palm.lerp(fw.clone(), wave);
      }
      // dancing: arms pumping up in turn
      if (dance > 0) {
        const up = 0.5 + 0.5 * Math.sin((Math.PI * (a - 18)) / 0.42 + (side > 0 ? 0 : Math.PI));
        const pump = sh
          .clone()
          .add(left.clone().multiplyScalar(side * L * 0.45))
          .add(new THREE.Vector3(0, L * (0.2 + 0.6 * up), 0))
          .add(fw.clone().multiplyScalar(0.12));
        at = at.lerp(pump, dance);
        fingers = fingers.lerp(UP.clone(), dance);
        palm = palm.lerp(fw.clone(), dance);
      }
      // jumping: both arms up
      if (jumpArms > 0) {
        const upT = sh
          .clone()
          .add(left.clone().multiplyScalar(side * L * 0.3))
          .add(new THREE.Vector3(0, L * 0.9, 0));
        at = at.lerp(upT, jumpArms);
        fingers = fingers.lerp(UP.clone(), jumpArms);
      }
      hands.push({
        at,
        fingers,
        palm,
        poles: [new THREE.Vector3(0, -1, -0.3).add(left.clone().multiplyScalar(side * 0.6))],
      });
    }
    m.hands(hands[0]!, hands[1]!);
    m.look(eye, facing ? 0.9 : 0);
  },
};

// ---------------------------------------------------------------------------
// Scene modules
// ---------------------------------------------------------------------------
/** Where a show's music plays: the sound output handed to the scene (per play, by its seed). */
const musicOut = new Map<number, SoundApi>();

function showScene(def: ShowDef): SceneModule {
  const music = def.music;
  return {
    id: def.id,
    // the show's music: the sound output is handed over here; the scene itself starts the piece
    // at its moment (its own show time – every play, every round)
    ...(music
      ? {
          ambientSound: (snd: SoundApi, seed: number) => {
            snd.preload?.(music.url);
            musicOut.set(seed, snd);
            return () => {
              if (musicOut.get(seed) === snd) musicOut.delete(seed);
            };
          },
        }
      : {}),
    create: (ctx) => {
      const holes = makeHoles();
      const layer = new FigureLayer();
      const rigs = def.actors.map((a) => new Rig(a.url, a.height, holes));
      for (const r of rigs) layer.scene.add(r.root);
      let actors: Actor[] | null = null;
      let visible = false;
      let motion: ((a: number) => Move[]) | null = null;
      let motionKey = -1;
      let musicLast = -1;
      let musicStop: (() => void) | null = null;
      const uniforms = (s: DrawState, f: { time: number }) => {
        const F = (s.cache.wsFrame as Frame | undefined) ?? (s.cache.wsFrame = frameOf(s));
        const speed = speedOf(s);
        const loop = SHOW + pauseOf(s);
        clocks[def.id] = { time: f.time, at: performance.now(), speed, loop };
        const a = (f.time * speed) % loop;
        // the music: just passed its moment (not when joining long after); on / off and volume
        if (music) {
          const snd = musicOut.get(ctx.seed);
          const on = s.params.music !== false;
          if (snd && on && musicLast >= 0 && musicLast < music.at && a >= music.at && a - music.at < 1) {
            musicStop?.();
            const vol = typeof s.params.musicVolume === 'number' ? s.params.musicVolume : 0.8;
            musicStop = snd.replaced?.(music.slot)
              ? null
              : (snd.playUrl?.(music.url, 0, music.gain * vol) ?? null);
          }
          if (!on && musicStop) {
            musicStop();
            musicStop = null;
          }
          musicLast = a;
        }
        const rebuild = s.params.ending !== 'fade';
        const W = wallAt(a, rebuild);
        const xs = def.holes(F);
        const h0 = doorHole(xs[0]!, F, def.tall);
        const h1 = doorHole(xs[1] ?? 0, F, def.tall);
        holes.uH0.value.copy(h0);
        holes.uH1.value.copy(h1);
        holes.uHO.value.set(W.open, xs.length > 1 ? W.open : 0);
        holes.uHN.value = xs.length;
        holes.uEye.value.set(F.ro[0], F.ro[1], F.ro[2]);
        // the figures
        actors ??= def.bodies(F).map((body, i) => ({ rig: rigs[i]!, body, width: 0.075 }));
        visible = a >= BURST && a < (rebuild ? 46 : 43) && W.fade > 0;
        layer.view(F);
        layer.fade = W.fade;
        for (let i = 0; i < 2; i++) {
          const g = layer.glow[i]!;
          const h = i === 0 ? h0 : h1;
          g.visible = i < xs.length;
          g.position.set(h.x, F.floorY + def.tall * 0.55, -0.5);
          g.color.setRGB(def.glow[0], def.glow[1], def.glow[2]);
          g.intensity = W.glow * 1.4;
        }
        const eye = new THREE.Vector3(F.ro[0], F.ro[1], F.ro[2]);
        // recorded motion when every figure brings its clips
        const recorded =
          !!def.motion && rigs.every((r, i) => r.ready && (def.clips?.[i] ?? []).every((c) => r.has(c)));
        const round = Math.floor((f.time * speed) / loop);
        if (recorded && (!motion || motionKey !== round)) {
          motion = def.motion!(F, rigs, (s.seed ?? 0) + round * 7.31, s.params);
          motionKey = round;
        }
        if (visible && recorded && motion) {
          const moves = motion(a);
          // recorded motion first; where our own dance takes over, that pose is blended in
          const snaps = moves.map((m, i) => {
            const r = rigs[i]!;
            r.root.visible = true;
            if (m.layers.length) r.play(m.body, F, m.layers, !!m.ownYaw);
            return m.proc && m.proc.w > 0.001 && m.proc.w < 0.999 ? r.capture() : null;
          });
          if (moves.some((m) => m.proc && m.proc.w > 0.001)) {
            moves.forEach((m, i) => {
              if (!m.proc || m.proc.w <= 0.001) return;
              const r = rigs[i]!;
              r.pose(m.proc.body(a), feetAt(m.proc.body, a, 0.075, F.floorY), F);
              r.hands(null, null);
            });
            moves.find((m) => m.procArms)?.procArms!(a, rigs, eye);
            moves.forEach((m, i) => {
              const sn = snaps[i];
              if (sn && m.proc) rigs[i]!.blendFrom(sn, m.proc.w);
            });
          }
          moves.forEach((m, i) => {
            const r = rigs[i]!;
            if (m.lookAt !== undefined && rigs[m.lookAt]) r.look(rigs[m.lookAt]!.pos('Head'), 0.6);
            else if ((m.look ?? 0) > 0.01) r.look(eye, m.look);
            r.finish();
          });
        } else if (visible) {
          // how much each one is walking right now (0 standing … 1 walking)
          const walkOf = (act: Actor) => {
            const b0 = act.body(a - 0.15);
            const b1 = act.body(a + 0.15);
            return clamp01(Math.hypot(b1.x - b0.x, b1.z - b0.z) / 0.08);
          };
          for (const act of actors) {
            if (!act.rig.ready) continue;
            const b = { ...act.body(a) };
            const w = walkOf(act);
            if (w > 0) {
              // a real walk, not a robot: knees bent, the body goes up and down with every step
              // (lowest when both feet are down), leans into the walk, the hips sway and the
              // shoulders turn against them
              const ph = (Math.PI * a) / Math.max(0.15, b.beat);
              b.drop += w * (0.025 + 0.022 * (1 - Math.abs(Math.sin(ph))));
              b.lean += w * 0.08;
              b.sway += w * 0.06 * Math.sin(ph);
              b.twist = (b.twist ?? 0) + w * 0.22 * Math.sin(ph);
            }
            act.rig.root.visible = true;
            act.rig.pose(b, feetAt(act.body, a, act.width, F.floorY), F);
          }
          // arms and looks (partners need each other's bones); walking arms by default
          for (const act of actors) {
            if (!act.rig.ready) continue;
            const b = act.body(a);
            const [L, R] = walkArms(act.rig, a, b.beat, b.yaw, walkOf(act));
            act.rig.hands(L, R);
          }
          def.arms(a, rigs, F, eye);
          for (const r of rigs) r.finish();
        }
        // guests' faces on the figures (chosen photos)
        def.faces?.forEach((key, i) => {
          const id = String(s.params[key] ?? '') || null;
          rigs[i]?.setFace(id, id ? (ctx.photos?.get(id) ?? null) : null);
        });
        for (const r of rigs) r.root.visible = visible && r.ready;
        // all figures loaded: shaders and textures ready before the first one shows up
        if (rigs.every((x) => x.ready)) layer.warm(ctx.renderer);
        return {
          uRo: new THREE.Vector3(...F.ro),
          uP0: new THREE.Vector3(...F.p0),
          uPU: new THREE.Vector3(...F.pu),
          uPV: new THREE.Vector3(...F.pv),
          uFloorY: F.floorY,
          uCute: def.cute ? 1 : 0,
          uBulge: W.bulge,
          uCrack: W.crack,
          uHole: W.open,
          uDebrisT: W.debrisT,
          uGlow: W.glow,
          uFade: W.fade,
          uEyes: 0,
          uBlink: 0,
          uJaw: 0,
          uHide: 1,
          uBlob: 1,
          uBlobY: F.floorY + def.tall * 0.82,
          uH0: h0,
          uH1: h1,
          uHO: new THREE.Vector2(W.open, xs.length > 1 ? W.open : 0),
          uHN: xs.length,
          uGlowCol: new THREE.Vector3(...def.glow),
          uPhoto: 0,
          uPhotoA: 0,
          uPhotoTex: NO_TEX as unknown as number,
        };
      };
      const wall = shaderScene(def.id, WALL_FRAG_LEAN, uniforms, {
        shaderScale: 0.6,
        shaderMaxPx: 1280,
      }).create(ctx);
      return {
        render: (t, f) => {
          wall.render(t, f);
          if (visible) layer.render(ctx.renderer, t);
        },
        resize: (w, h, ppm) => wall.resize(w, h, ppm),
        setParams: (p) => wall.setParams(p),
        dispose: () => {
          musicStop?.();
          for (const r of rigs) r.dispose();
          layer.dispose();
          wall.dispose();
        },
      };
    },
  };
}

export const wallShowScenes: SceneModule[] = [showScene(COUPLE), showScene(MUMMY), showScene(BUDDY)];
