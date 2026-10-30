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
import { shaderScene, type DrawState, type SceneModule, type SoundApi } from '@spectrastage/engine';
import {
  basisQ,
  clocks,
  COMPOSITE_FRAG,
  elbowIK,
  frameOf,
  KEY_POS,
  loadModel,
  makeHoles,
  NO_TEX,
  occludeMaterial,
  pauseOf,
  soundFor,
  speedOf,
  WALL_MONSTER_FRAG,
  type Cue,
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
function feetAt(bodyAt: (t: number) => Body, t: number, width: number, floorY: number): [V3, V3] {
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
/**
 * Finds the face in a cut-out guest photo (transparent background): the head is the top of the
 * silhouette down to the neck (the narrowest row before the shoulders widen). Returns a square
 * crop of the face with soft edges.
 */
export function faceCrop(
  img: CanvasImageSource & { width: number; height: number },
): HTMLCanvasElement | null {
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
  // head: widest row in the upper part, then the neck: narrowest below it before it widens a lot
  let headW = 0;
  let headRow = top;
  for (let y = top; y < Math.min(h, top + h * 0.35); y++) {
    const [x0, x1] = rows[y]!;
    if (x0 >= 0 && x1 - x0 > headW) {
      headW = x1 - x0;
      headRow = y;
    }
  }
  let neck = Math.min(h - 1, Math.round(top + headW * 1.35));
  let minW = Infinity;
  for (let y = headRow; y < Math.min(h, headRow + headW * 1.2); y++) {
    const [x0, x1] = rows[y]!;
    const ww = x0 >= 0 ? x1 - x0 : 0;
    if (ww > 0 && ww < minW) {
      minW = ww;
      neck = y;
    }
    if (ww > headW * 1.5) break;
  }
  const [hx0, hx1] = rows[headRow]!;
  const cx = (hx0 + hx1) / 2;
  // the face: from a bit below the hair line to the chin
  const fh = Math.max(8, neck - top);
  const fy0 = top + fh * 0.12;
  const side = Math.max(fh * 0.95, headW * 1.0);
  const out = document.createElement('canvas');
  out.width = out.height = 256;
  const o = out.getContext('2d');
  if (!o) return null;
  o.drawImage(c, cx - side / 2, fy0 - side * 0.04, side, side, 0, 0, 256, 256);
  // soft oval edge
  o.globalCompositeOperation = 'destination-in';
  const gr = o.createRadialGradient(128, 128, 70, 128, 128, 128);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = gr;
  o.save();
  o.translate(128, 128);
  o.scale(0.82, 1);
  o.translate(-128, -128);
  o.fillRect(0, 0, 256, 256);
  o.restore();
  return out;
}

const FACE_GLSL = /* glsl */ `
uniform float uFaceOn;
uniform sampler2D uFaceTex;
uniform mat4 uFaceM;
`;

class Rig {
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

  constructor(
    url: string,
    private readonly heightM: number,
    holes: HoleUniforms,
  ) {
    void loadModel(url).then((g) => {
      if (!g || this.disposed) return;
      this.setup(g.clone(true), holes);
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
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats)
        occludeMaterial(mat as THREE.MeshStandardMaterial, holes, (sh) => {
          Object.assign(sh.uniforms, this.face);
          sh.fragmentShader = sh.fragmentShader.replace('void main() {', FACE_GLSL + 'void main() {').replace(
            '#include <map_fragment>',
            `#include <map_fragment>
  if (uFaceOn > 0.5) {
    vec3 fq = (uFaceM * vec4(vWallPos, 1.0)).xyz;
    if (fq.z > -0.3 && abs(fq.x) < 1.0 && abs(fq.y) < 1.0) {
      vec4 fc = texture2D(uFaceTex, fq.xy * 0.5 + 0.5);
      float k = fc.a * smoothstep(-0.3, 0.25, fq.z);
      diffuseColor.rgb = mix(diffuseColor.rgb, fc.rgb, k * 0.95);
    }
  }`,
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
    this.size = this.heightM / F.k / this.height;
    this.yaw = body.yaw;
    const yq = new THREE.Quaternion().setFromAxisAngle(UP, body.yaw);
    this.root.scale.setScalar(this.size);
    this.root.quaternion.copy(yq);
    this.root.position.set(body.x, F.floorY + body.hop - body.drop, body.z);
    this.root.updateMatrixWorld(true);
    // upper body: lean and sway, spread over the spine
    const left = leftOf(body.yaw);
    const fw = fwdOf(body.yaw);
    const lean = new THREE.Quaternion()
      .setFromAxisAngle(left, body.lean / 3)
      .multiply(new THREE.Quaternion().setFromAxisAngle(fw, body.sway / 3));
    for (const n of ['Spine', 'Spine1', 'Spine2']) this.turn(this.b[n]!, lean);
    // legs to the feet (knees point forwards)
    this.limb(this.legs.L, vec(feet[0]), [fw.clone().add(left.clone().multiplyScalar(0.15))]);
    this.limb(this.legs.R, vec(feet[1]), [fw.clone().add(left.clone().multiplyScalar(-0.15))]);
    for (const leg of [this.legs.L, this.legs.R]) this.setWorldQ(leg.end, yq.clone().multiply(leg.q0[2]));
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
  setFace(id: string | null, img: (CanvasImageSource & { width: number; height: number }) | null) {
    if (id === this.faceId && (img || !id)) return;
    if (id && !img) return; // still loading – try again next frame
    this.faceId = id;
    if (this.face.uFaceTex.value !== NO_TEX) this.face.uFaceTex.value.dispose();
    this.face.uFaceTex.value = NO_TEX;
    this.face.uFaceOn.value = 0;
    if (!id || !img) return;
    const crop = faceCrop(img);
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
  }
}

// ---------------------------------------------------------------------------
// Drawing the figures over the wall
// ---------------------------------------------------------------------------
class FigureLayer {
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
    const w = target.width;
    const h = target.height;
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
const SHOW = 48;
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
  const bulge = ease(a, 4.5, 8) * (1 - ease(a, 9.7, 10));
  const close = rebuild ? ease(a, 43.2, 44.6) : 0;
  const open = ease(a, BURST, BURST + 0.45) * (1 - close);
  const crack = ease(a, 7, 9.9) * (rebuild ? 1 - ease(a, 44.4, 46.2) : 1);
  // debris flies out at the burst – and (building up again) back into the wall
  let debrisT = -1;
  if (a >= BURST && a < BURST + 3.2) debrisT = a - BURST;
  if (rebuild && a >= REBUILD + 0.5 && a < 44.3) debrisT = Math.max(0, 44.3 - a);
  const flash = a >= BURST ? Math.exp(-(a - BURST) * 2.5) : 0;
  const glow =
    (0.18 * crack + 0.82 * open + 0.8 * flash) *
    (1 - ease(a, 41.5, 44)) *
    (0.9 + 0.1 * Math.sin(a * 13.1) * Math.sin(a * 7.3));
  const fade = ease(a, 0, 1.2) * (1 - ease(a, rebuild ? 46.5 : 41.5, rebuild ? 48 : 44));
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
  cues: Cue[];
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
    const swing = Math.sin((Math.PI * a) / beat + (side > 0 ? 0 : Math.PI)) * 0.28 * amount;
    out.push({
      at: sh
        .clone()
        .add(new THREE.Vector3(0, -rig.arm * 0.9, 0))
        .add(fw.clone().multiplyScalar(swing * rig.arm))
        .add(left.clone().multiplyScalar(side * 0.04)),
      fingers: new THREE.Vector3(0, -1, 0).add(fw.clone().multiplyScalar(swing)),
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
const COUPLE: ShowDef = {
  id: 'wallCouple',
  cute: false,
  glow: [1.0, 0.18, 0.1],
  actors: [
    { url: '/models/groom.glb', height: 1.84 },
    { url: '/models/bride.glb', height: 1.68 },
  ],
  holes: (F) => {
    const half = F.pu[0] / 2;
    const x = Math.min(0.95, half * 0.55);
    return [x, -x];
  },
  tall: 1.55,
  bodies: (F) => {
    const half = F.pu[0] / 2;
    const hx = Math.min(0.95, half * 0.55);
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
          const p = path(
            [
              ...comeOut(hole, hole * 0.8, 0.25, BURST + 0.9),
              [16.6, start.x, start.z, Math.atan2(C[0] - start.x, 0)],
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
            [35.8, end.x, end.z, 0],
            [36.6, end.x, end.z, Math.PI],
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
  arms: (a, rigs, F, eye) => {
    const [groom, bride] = rigs as [Rig, Rig];
    const hold = ease(a, 16.8, 17.6) * (1 - ease(a, 33, 33.8));
    const twirl = ease(a, 25.2, 25.7) * (1 - ease(a, 27.4, 28));
    if (hold < 0.01 || !groom.ready || !bride.ready) {
      // (walking arms stay) – they look at you when they come out and when they bow
      for (const r of rigs) r.look(eye, a < 16.3 || (a > 33.5 && a < 36) ? 0.8 : 0);
      return;
    }
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
    const atYou = ease(a, 29, 30) * (1 - ease(a, 31.5, 32.5));
    groom.look(bride.pos('Head').lerp(eye, atYou), 0.8);
    bride.look(groom.pos('Head').lerp(eye, atYou), 0.8);
  },
  cues: [],
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
  cues: [],
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
  cues: [],
};

// ---- sounds
const knocks = (gain: number): Cue[] => [
  { at: 1.0, play: (s) => s.knock({ count: 3, gain, spacing: 0.45 }) },
  { at: 3.7, play: (s) => s.knock({ count: 2, gain, spacing: 0.4 }) },
  { at: 7.4, play: (s) => s.knock({ count: 4, gain: gain * 0.5, spacing: 0.06 }) },
  { at: 8.6, play: (s) => s.pop({ freq: 180, gain: gain * 0.5 }) },
  { at: 9.4, play: (s) => s.knock({ count: 5, gain: gain * 0.55, spacing: 0.05 }) },
  {
    at: BURST,
    play: (s) => {
      s.rumble({ duration: 2.2, gain: 0.55 });
      s.whoosh({ duration: 1.2, from: 500, to: 90, gain: 0.5 });
      s.knock({ count: 7, gain: 0.45, spacing: 0.05 });
    },
  },
  { at: BURST + 0.9, play: (s) => s.knock({ count: 6, gain: 0.2, spacing: 0.09 }) },
  // the wall builds itself up again
  { at: REBUILD + 0.5, play: (s) => s.whoosh({ duration: 2.5, from: 90, to: 600, gain: 0.35 }) },
  { at: 44.2, play: (s) => s.knock({ count: 6, gain: 0.35, spacing: 0.05 }) },
];
const steps = (from: number, to: number, beat: number, gain: number): Cue[] => {
  const out: Cue[] = [];
  for (let t = from; t < to; t += beat) out.push({ at: t, play: (s) => s.knock({ count: 1, gain }) });
  return out;
};
// a slow, eerie waltz in three: one low note, then two chords
const waltzMusic = (): Cue[] => {
  const out: Cue[] = [];
  const bars = [
    [110, 220, 261.6, 329.6],
    [98, 196, 246.9, 293.7],
    [87.3, 174.6, 220, 261.6],
    [82.4, 164.8, 207.7, 246.9],
  ];
  let i = 0;
  for (let t = 16.4; t < 33; t += 1.65, i++) {
    const b = bars[i % bars.length]!;
    out.push({ at: t, play: (s) => s.arpeggio({ notes: [b[0]!], gain: 0.22, step: 0.1, wave: 'sine' }) });
    out.push({
      at: t + 0.55,
      play: (s) => s.arpeggio({ notes: b.slice(1), gain: 0.1, step: 0.02, wave: 'triangle' }),
    });
    out.push({
      at: t + 1.1,
      play: (s) => s.arpeggio({ notes: b.slice(1), gain: 0.1, step: 0.02, wave: 'triangle' }),
    });
  }
  return out;
};
COUPLE.cues = [
  ...knocks(0.5),
  ...steps(11, 16.5, 0.5, 0.12),
  ...waltzMusic(),
  ...steps(36.6, 40.6, 0.5, 0.12),
];
MUMMY.cues = [
  ...knocks(0.55),
  ...steps(11, 23, 0.85, 0.18),
  { at: 15, play: (s) => s.ooh({ duration: 2.6, base: 100, gain: 0.3 }) },
  {
    at: 23.6,
    play: (s) => {
      s.ooh({ duration: 3.2, base: 92, gain: 0.6 });
      s.ooh({ duration: 3.0, base: 128, gain: 0.3 });
      s.rumble({ duration: 3, gain: 0.35 });
      s.whoosh({ duration: 3, from: 1100, to: 400, gain: 0.15 });
    },
  },
  ...steps(27, 33.5, 0.85, 0.18),
  { at: 36, play: (s) => s.ooh({ duration: 2.4, base: 98, gain: 0.3 }) },
];
BUDDY.cues = [
  ...knocks(0.35),
  { at: 14, play: (s) => s.chime({ notes: [784, 988, 1175], gain: 0.25 }) },
  ...[18, 19.68, 21.36, 23.04, 24.72, 26.4, 28.08].map((at) => ({
    at,
    play: (s: SoundApi) =>
      s.arpeggio({
        notes: [523, 659, 784, 659, 523, 659, 784, 1047],
        gain: 0.15,
        step: 0.21,
        wave: 'triangle',
      }),
  })),
  { at: 30.4, play: (s) => s.pop({ freq: 420, gain: 0.35 }) },
  { at: 31.4, play: (s) => s.pop({ freq: 520, gain: 0.35 }) },
  { at: 33, play: (s) => s.chime({ notes: [1175, 988, 784], gain: 0.22 }) },
];

// ---------------------------------------------------------------------------
// Scene modules
// ---------------------------------------------------------------------------
function showScene(def: ShowDef): SceneModule {
  return {
    id: def.id,
    ambientSound: (snd) => soundFor(def.id, def.cues)(snd),
    create: (ctx) => {
      const holes = makeHoles();
      const layer = new FigureLayer();
      const rigs = def.actors.map((a) => new Rig(a.url, a.height, holes));
      for (const r of rigs) layer.scene.add(r.root);
      let actors: Actor[] | null = null;
      let visible = false;
      const uniforms = (s: DrawState, f: { time: number }) => {
        const F = (s.cache.wsFrame as Frame | undefined) ?? (s.cache.wsFrame = frameOf(s));
        const speed = speedOf(s);
        const loop = SHOW + pauseOf(s);
        clocks[def.id] = { time: f.time, at: performance.now(), speed, loop };
        const a = (f.time * speed) % loop;
        const rebuild = s.params.ending !== 'fade';
        const W = wallAt(a, rebuild);
        const xs = def.holes(F);
        const h0 = doorHole(xs[0]!, F, def.tall);
        const h1 = doorHole(xs[1] ?? 0, F, def.tall);
        holes.uH0.value.copy(h0);
        holes.uH1.value.copy(h1);
        holes.uHO.value.set(W.open, xs.length > 1 ? W.open : 0);
        holes.uHN.value = xs.length;
        // the figures
        actors ??= def.bodies(F).map((body, i) => ({ rig: rigs[i]!, body, width: 0.075 }));
        visible = a >= BURST && a < (rebuild ? 44 : 43) && W.fade > 0;
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
        if (visible) {
          for (const act of actors) {
            if (!act.rig.ready) continue;
            const b = act.body(a);
            act.rig.root.visible = true;
            act.rig.pose(b, feetAt(act.body, a, act.width, F.floorY), F);
          }
          // arms and looks (partners need each other's bones); walking arms by default
          for (const act of actors) {
            if (!act.rig.ready) continue;
            const b = act.body(a);
            const walking = Math.hypot(act.body(a + 0.2).x - b.x, act.body(a + 0.2).z - b.z) > 0.01;
            const [L, R] = walkArms(act.rig, a, b.beat, b.yaw, walking ? 1 : 0);
            act.rig.hands(L, R);
          }
          def.arms(a, rigs, F, eye);
          for (const r of rigs) r.finish();
        }
        // guests' faces on the figures (chosen photos)
        def.faces?.forEach((key, i) => {
          const id = String(s.params[key] ?? '') || null;
          rigs[i]?.setFace(id, id ? (ctx.photos?.get(id)?.img ?? null) : null);
        });
        for (const r of rigs) r.root.visible = visible && r.ready;
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
      const wall = shaderScene(def.id, WALL_MONSTER_FRAG, uniforms, { shaderScale: 0.6 }).create(ctx);
      return {
        render: (t, f) => {
          wall.render(t, f);
          if (visible) layer.render(ctx.renderer, t);
        },
        resize: (w, h, ppm) => wall.resize(w, h, ppm),
        setParams: (p) => wall.setParams(p),
        dispose: () => {
          for (const r of rigs) r.dispose();
          layer.dispose();
          wall.dispose();
        },
      };
    },
  };
}

export const wallShowScenes: SceneModule[] = [showScene(COUPLE), showScene(MUMMY), showScene(BUDDY)];
