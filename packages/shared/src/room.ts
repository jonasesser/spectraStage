/**
 * The stage folded back into a 3D room ("cube map"): every surface becomes a face with an origin
 * and two axes in room space. Used for
 *  - the sky (computed from the viewing direction, so walls and ceiling meet seamlessly),
 *  - creatures that move around the viewer across walls, floor and ceiling,
 *  - the 3D room view in the controller.
 * Room space: x/z on the ground, y up, the viewer stands in `center`.
 */
import type { Pose, Surface } from './schema.ts';
import { completeRoom, worldLayout, type BBox } from './stage.ts';

export type V3 = [number, number, number];

export interface RoomFace {
  id: string;
  role: 'main' | 'side' | 'ground' | 'ceiling';
  /** Rect in stage meters. */
  rect: BBox;
  /** Room position of the rect's top-left stage corner (x = rect.x, y = rect.y). */
  o: V3;
  /** Unit vector in room space for +1 m of stage x. */
  ax: V3;
  /** Unit vector in room space for +1 m of stage y (stage y grows downwards). */
  ay: V3;
  /** Unit normal pointing into the room. */
  n: V3;
}

export interface RoomFold {
  faces: RoomFace[];
  center: V3;
  /** Height of the main wall (size unit). */
  unit: number;
}

const rot = (d: [number, number], a: number): [number, number] => [
  d[0] * Math.cos(a) - d[1] * Math.sin(a),
  d[0] * Math.sin(a) + d[1] * Math.cos(a),
];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Folds the complete room. Walls (main + side, in stage-x order) go around the floor plan;
 * walls that touch in the unfolded layout meet at a corner of 360°/n (n ≥ 3, else 90°). Floors
 * laid out below a wall lie in front of it, ceilings laid out above a wall lie over the room.
 */
export function roomFold(surfaces: readonly Surface[], complete = true): RoomFold {
  const all = complete ? completeRoom(surfaces) : [...surfaces];
  const lay = worldLayout(all);
  const walls = lay.filter((w) => w.role === 'main' || w.role === 'side').sort((a, b) => a.rect.x - b.rect.x);
  const turn = walls.length >= 3 ? (Math.PI * 2) / walls.length : Math.PI / 2;
  const faces: RoomFace[] = [];
  let p: [number, number] = [0, 0];
  let d: [number, number] = [1, 0];
  const placed: { rect: BBox; start: [number, number]; dir: [number, number]; normal: [number, number] }[] =
    [];
  walls.forEach((w, i) => {
    if (i > 0) {
      const prev = walls[i - 1]!.rect;
      const gap = w.rect.x - (prev.x + prev.w);
      if (Math.abs(gap) < 0.3) d = rot(d, turn);
      else p = [p[0] + d[0] * gap, p[1] + d[1] * gap];
    }
    const normal = rot(d, Math.PI / 2);
    placed.push({ rect: w.rect, start: p, dir: d, normal });
    faces.push({
      id: w.id,
      role: w.role as 'main' | 'side',
      rect: w.rect,
      o: [p[0], w.rect.h, p[1]],
      ax: [d[0], 0, d[1]],
      ay: [0, -1, 0],
      n: [normal[0], 0, normal[1]],
    });
    p = [p[0] + d[0] * w.rect.w, p[1] + d[1] * w.rect.w];
  });
  for (const s of lay) {
    if (s.role !== 'ground' && s.role !== 'ceiling') continue;
    const overlap = (w: (typeof placed)[number]) =>
      s.rect.x < w.rect.x + w.rect.w && s.rect.x + s.rect.w > w.rect.x;
    const pw =
      s.role === 'ground'
        ? placed.find((w) => overlap(w) && s.rect.y >= w.rect.y + w.rect.h - 0.6)
        : placed.find((w) => overlap(w) && s.rect.y + s.rect.h <= w.rect.y + 0.6);
    if (!pw) continue;
    const a = s.rect.x - pw.rect.x;
    const base: V3 = [pw.start[0] + pw.dir[0] * a, 0, pw.start[1] + pw.dir[1] * a];
    if (s.role === 'ground') {
      const depth = s.rect.y - (pw.rect.y + pw.rect.h);
      faces.push({
        id: s.id,
        role: 'ground',
        rect: s.rect,
        o: [base[0] + pw.normal[0] * depth, 0, base[2] + pw.normal[1] * depth],
        ax: [pw.dir[0], 0, pw.dir[1]],
        ay: [pw.normal[0], 0, pw.normal[1]],
        n: [0, 1, 0],
      });
    } else {
      const depth = pw.rect.y - s.rect.y;
      faces.push({
        id: s.id,
        role: 'ceiling',
        rect: s.rect,
        o: [base[0] + pw.normal[0] * depth, pw.rect.h, base[2] + pw.normal[1] * depth],
        ax: [pw.dir[0], 0, pw.dir[1]],
        ay: [-pw.normal[0], 0, -pw.normal[1]],
        n: [0, -1, 0],
      });
    }
  }
  const main = faces.find((f) => f.role === 'main') ?? faces[0];
  const unit = main?.rect.h ?? 2.5;
  let center: V3 = [0, unit * 0.6, 3];
  const wallFaces = faces.filter((f) => f.role === 'main' || f.role === 'side');
  if (wallFaces.length) {
    let cx = 0;
    let cz = 0;
    for (const f of wallFaces) {
      const m = add(f.o, f.ax, f.rect.w / 2);
      cx += m[0];
      cz += m[2];
    }
    center = [cx / wallFaces.length, Math.min(1.6, unit * 0.6), cz / wallFaces.length];
  }
  return { faces, center, unit };
}

/** Room position of a stage point on a face. */
export function facePoint(f: RoomFace, x: number, y: number): V3 {
  return add(add(f.o, f.ax, x - f.rect.x), f.ay, y - f.rect.y);
}

/**
 * Stage coordinates of a room point in the frame of face f. Points on a neighbouring face are
 * unfolded across the shared edge (as if the room were opened up flat around f), so a creature
 * sitting on a corner is drawn by both faces exactly where they meet.
 */
export function faceLocal(f: RoomFace, p: V3): { x: number; y: number } | null {
  const r = sub(p, f.o);
  let lx = dot(r, f.ax);
  let ly = dot(r, f.ay);
  const off = dot(r, f.n);
  if (off > 1e-4) {
    const dl = Math.max(0, -lx);
    const dr = Math.max(0, lx - f.rect.w);
    const dt = Math.max(0, -ly);
    const db = Math.max(0, ly - f.rect.h);
    const m = Math.max(dl, dr, dt, db);
    if (m === 0) {
      // projects onto the face itself: only points on a neighbouring face (projection on the
      // shared edge) unfold – anything further inside the room is not on this face's side
      const e = Math.min(lx, f.rect.w - lx, ly, f.rect.h - ly);
      if (e > 0.05) return null;
      if (e === lx) lx -= off;
      else if (e === f.rect.w - lx) lx += off;
      else if (e === ly) ly -= off;
      else ly += off;
    } else if (m === dl) lx -= off;
    else if (m === dr) lx += off;
    else if (m === dt) ly -= off;
    else ly += off;
  }
  return { x: f.rect.x + lx, y: f.rect.y + ly };
}

/** Where a ray from the room center in direction d hits the room (face, room point, stage point). */
export function roomHit(fold: RoomFold, d: V3): { face: RoomFace; p: V3; x: number; y: number } | null {
  return roomRay(fold, fold.center, d);
}

/** Where a ray from `origin` (inside the room) in direction d hits the room. */
export function roomRay(
  fold: RoomFold,
  origin: V3,
  d: V3,
): { face: RoomFace; p: V3; x: number; y: number } | null {
  let best: { face: RoomFace; p: V3; x: number; y: number; s: number } | null = null;
  for (const f of fold.faces) {
    const den = dot(d, f.n);
    if (den >= -1e-6) continue; // must hit the face from inside
    const s = dot(sub(f.o, origin), f.n) / den;
    if (s <= 0 || (best && s >= best.s)) continue;
    const p = add(origin, d, s);
    const r = sub(p, f.o);
    const lx = dot(r, f.ax);
    const ly = dot(r, f.ay);
    if (lx < -1e-3 || ly < -1e-3 || lx > f.rect.w + 1e-3 || ly > f.rect.h + 1e-3) continue;
    best = { face: f, p, x: f.rect.x + lx, y: f.rect.y + ly, s };
  }
  return best;
}

/** Unit direction from elevation (radians, up positive) and azimuth (radians, around y). */
export function dirFromAngles(azimuth: number, elevation: number): V3 {
  const c = Math.cos(elevation);
  return [Math.sin(azimuth) * c, Math.sin(elevation), -Math.cos(azimuth) * c];
}

/** Azimuth of the main wall's center as seen from the room center (for orienting paths). */
export function mainAzimuth(fold: RoomFold): number {
  const main = fold.faces.find((f) => f.role === 'main');
  if (!main) return 0;
  const m = sub(add(main.o, main.ax, main.rect.w / 2), fold.center);
  return Math.atan2(m[0], -m[2]);
}

/** Projector pose standing at `from`, pointing at `target`, horizontal opening `fov` degrees. */
export function aimPose(from: V3, target: V3, fov: number, roll = 0): Pose {
  const d = sub(target, from);
  return {
    pos: [...from] as V3,
    yaw: Math.atan2(d[0], -d[2]),
    pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])),
    roll,
    fov,
  };
}

/** Unit view direction of a pose. */
export function poseDir(p: Pose): V3 {
  return dirFromAngles(p.yaw, p.pitch);
}

/**
 * Default projector pose for a room side: standing in the middle of the room (slightly behind
 * the viewer for walls, at ceiling/floor for the others), aimed at the center of the face so the
 * picture just fits its width. Without a surface id, picks the first face not yet in `taken`
 * (compared by yaw) in the order main wall, floor, side walls, ceiling.
 */
export function poseForSurface(
  surfaces: readonly Surface[],
  surfaceId: string | null,
  takenFaces: Set<string>,
): Pose | null {
  const fold = roomFold(surfaces);
  const order = ['main', 'ground', 'side', 'ceiling'];
  const faces = [...fold.faces].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  const pick = (f: RoomFace) => {
    const c = facePoint(f, f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
    let from: V3;
    if (f.role === 'ground' || f.role === 'ceiling') {
      from = [c[0], f.role === 'ground' ? fold.unit * 0.95 : 0.3, c[2]];
    } else {
      // stand on the far side of the room so the throw is long enough
      const depth = Math.max(2, dot(sub(fold.center, c), f.n) * 1.8);
      const b = add(c, f.n, depth);
      from = [b[0], fold.center[1], b[2]];
    }
    const dist = Math.hypot(...sub(c, from));
    const fov = (2 * Math.atan(f.rect.w / 2 / Math.max(0.1, dist)) * 180) / Math.PI;
    return aimPose(from, c, Math.min(120, Math.max(10, fov)));
  };
  if (surfaceId) {
    const f = fold.faces.find((x) => x.id === surfaceId);
    return f ? pick(f) : null;
  }
  const free = faces.find((f) => !takenFaces.has(f.id)) ?? faces[0];
  return free ? pick(free) : null;
}

/** The room face a projector's center ray hits (or null). */
export function poseTarget(fold: RoomFold, p: Pose): string | null {
  return roomRay(fold, p.pos, poseDir(p))?.face.id ?? null;
}

export type RoomArrangement = 'sides' | 'threeWalls' | 'threeWallsPlus' | 'wallFloor' | 'mainOnly';

/**
 * Ready-made projector setups for the room (names in German, the show language): one per room
 * side, a single wide projector that covers the main wall and both side walls, the same plus
 * floor and ceiling, one projector for main wall + floor across the bottom corner, or just the
 * main wall.
 */
export function arrangementPoses(
  surfaces: readonly Surface[],
  layout: RoomArrangement,
): { name: string; faceId: string | null; pose: Pose }[] {
  const fold = roomFold(surfaces);
  const main = fold.faces.find((f) => f.role === 'main');
  if (!main) return [];
  const h = main.rect.h;
  const c = facePoint(main, main.rect.x + main.rect.w / 2, main.rect.y + h / 2);
  const back = roomRay(fold, add(c, main.n, 0.01), main.n);
  const depth = back ? Math.hypot(...sub(back.p, c)) : 4;
  const one = (role: RoomFace['role']) =>
    fold.faces.find((f) => f.role === role && f.id !== 'virtual:floorRest');
  const forFace = (f: RoomFace | undefined, name: string) => {
    const pose = f ? poseForSurface(surfaces, f.id, new Set()) : null;
    return pose ? [{ name, faceId: f!.id, pose }] : [];
  };
  // stands just in front of the back wall, slightly below the ceiling, looking at the main wall
  const rear = (k: number): V3 => {
    const p = add(c, main.n, Math.max(1, depth - 0.3) * k);
    return [p[0], Math.min(h - 0.3, Math.max(1.2, h * 0.75)), p[2]];
  };
  const threeWalls = () => {
    const from = rear(1);
    return { name: 'Beamer 3 Wände', faceId: null, pose: aimPose(from, c, 112) };
  };
  switch (layout) {
    case 'mainOnly':
      return forFace(main, 'Beamer Hauptwand');
    case 'threeWalls':
      return [threeWalls()];
    case 'threeWallsPlus':
      return [
        threeWalls(),
        ...forFace(one('ground'), 'Beamer Boden'),
        ...forFace(one('ceiling'), 'Beamer Decke'),
      ];
    case 'wallFloor': {
      // aim at the bottom edge of the main wall from high up in the middle of the room
      const from = rear(0.6);
      from[1] = Math.max(from[1], h - 0.2);
      const edge = facePoint(main, main.rect.x + main.rect.w / 2, main.rect.y + h * 0.85);
      return [{ name: 'Beamer Wand + Boden', faceId: null, pose: aimPose(from, edge, 95) }];
    }
    case 'sides':
    default: {
      const sideNames = ['Wand rechts', 'Rückwand', 'Wand links'];
      const out: { name: string; faceId: string | null; pose: Pose }[] = [];
      out.push(...forFace(main, 'Beamer Hauptwand'));
      fold.faces
        .filter((f) => f.role === 'side')
        .forEach((f, i) => out.push(...forFace(f, `Beamer ${sideNames[i % 3]}`)));
      out.push(...forFace(one('ground'), 'Beamer Boden'), ...forFace(one('ceiling'), 'Beamer Decke'));
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Projector model: pinhole camera at pose.pos, rotation (pitch, -yaw, roll) in Euler order YXZ
// (same as the renderer's three.js camera), horizontal opening pose.fov, optional lens shift.
// ---------------------------------------------------------------------------

/** Rotation matrix (row-major 3×3) of a pose: camera space (x right, y up, -z forward) → room. */
function poseRot(p: Pose): number[] {
  const [a, b, c] = [p.pitch, -p.yaw, p.roll];
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const cb = Math.cos(b);
  const sb = Math.sin(b);
  const cc = Math.cos(c);
  const sc = Math.sin(c);
  // R = Ry(b) · Rx(a) · Rz(c)
  return [
    cb * cc + sb * sa * sc,
    -cb * sc + sb * sa * cc,
    sb * ca,
    ca * sc,
    ca * cc,
    -sa,
    -sb * cc + cb * sa * sc,
    sb * sc + cb * sa * cc,
    cb * ca,
  ];
}

/**
 * Where a room point lands in the projector picture, in normalized device coordinates
 * (x right, y up, −1..1 across the picture), or null if it is behind the projector.
 */
export function projectPose(p: Pose, aspect: number, P: V3): [number, number] | null {
  const R = poseRot(p);
  const d: V3 = [P[0] - p.pos[0], P[1] - p.pos[1], P[2] - p.pos[2]];
  // camera = Rᵀ · d
  const x = R[0]! * d[0] + R[3]! * d[1] + R[6]! * d[2];
  const y = R[1]! * d[0] + R[4]! * d[1] + R[7]! * d[2];
  const z = R[2]! * d[0] + R[5]! * d[1] + R[8]! * d[2];
  if (z > -1e-3) return null;
  const tx = Math.tan((p.fov * Math.PI) / 360);
  const ty = tx / aspect;
  return [x / -z / tx + (p.shiftX ?? 0), y / -z / ty + (p.shiftY ?? 0)];
}

/** Room direction through a picture point (NDC, x right, y up). */
export function poseRay(p: Pose, aspect: number, nx: number, ny: number): V3 {
  const R = poseRot(p);
  const tx = Math.tan((p.fov * Math.PI) / 360);
  const ty = tx / aspect;
  const c: V3 = [(nx - (p.shiftX ?? 0)) * tx, (ny - (p.shiftY ?? 0)) * ty, -1];
  const d: V3 = [
    R[0]! * c[0] + R[1]! * c[1] + R[2]! * c[2],
    R[3]! * c[0] + R[4]! * c[1] + R[5]! * c[2],
    R[6]! * c[0] + R[7]! * c[1] + R[8]! * c[2],
  ];
  const l = Math.hypot(...d);
  return [d[0] / l, d[1] / l, d[2] / l];
}

export interface RoomCorner {
  id: string;
  /** 1-based number shown on the phone and on the projector. */
  n: number;
  p: V3;
  /** e.g. "Hauptwand / Wand rechts – unten". */
  label: string;
}

/**
 * The real corners of the room (where three sides meet): fixed points everybody can see, used
 * to measure where a projector really stands. Sorted: main wall first, bottom before top.
 */
export function roomCorners(fold: RoomFold): RoomCorner[] {
  const sideNames = ['Wand rechts', 'Rückwand', 'Wand links', 'Wand 5', 'Wand 6'];
  let side = 0;
  const names = new Map<string, string>();
  for (const f of fold.faces) {
    names.set(
      f.id,
      f.role === 'main'
        ? 'Hauptwand'
        : f.role === 'side'
          ? (sideNames[side++] ?? 'Wand')
          : f.role === 'ground'
            ? 'Boden'
            : 'Decke',
    );
  }
  const pts: { p: V3; faces: Set<RoomFace> }[] = [];
  for (const f of fold.faces) {
    for (const [x, y] of [
      [f.rect.x, f.rect.y],
      [f.rect.x + f.rect.w, f.rect.y],
      [f.rect.x, f.rect.y + f.rect.h],
      [f.rect.x + f.rect.w, f.rect.y + f.rect.h],
    ] as const) {
      const p = facePoint(f, x, y);
      let e = pts.find((q) => Math.hypot(...sub(q.p, p)) < 0.05);
      if (!e) pts.push((e = { p, faces: new Set() }));
    }
  }
  // which faces touch each point
  for (const e of pts)
    for (const f of fold.faces) {
      const r = sub(e.p, f.o);
      if (Math.abs(dot(r, f.n)) > 0.03) continue;
      const lx = dot(r, f.ax);
      const ly = dot(r, f.ay);
      if (lx > -0.03 && ly > -0.03 && lx < f.rect.w + 0.03 && ly < f.rect.h + 0.03) e.faces.add(f);
    }
  const main = fold.faces.find((f) => f.role === 'main');
  const ang = (p: V3) => {
    const m = sub(p, fold.center);
    return Math.atan2(m[0], -m[2]);
  };
  // clockwise around the room, starting at the left edge of the main wall
  const start = main ? ang(main.o) - 1e-3 : 0;
  const az = (p: V3) => (((ang(p) - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const corners = pts
    .filter((e) => {
      const normals: V3[] = [];
      for (const f of e.faces) if (!normals.some((n) => dot(n, f.n) > 0.99)) normals.push(f.n);
      return normals.length >= 3;
    })
    .map((e) => {
      const walls = [...e.faces]
        .filter((f) => f.role === 'main' || f.role === 'side')
        .map((f) => names.get(f.id)!);
      const low = e.p[1] < fold.unit / 2;
      return { p: e.p, walls, low };
    })
    .sort((a, b) => az(a.p) - az(b.p) || Number(b.low) - Number(a.low));
  return corners.map((c, i) => ({
    id: c.p.map((v) => v.toFixed(2)).join(','),
    n: i + 1,
    p: c.p,
    label: `${c.walls.join(' / ')} – ${c.low ? 'unten' : 'oben'}`,
  }));
}

/**
 * Projector pose from measured points (room point ↔ where it lands in the picture), by
 * Levenberg–Marquardt over position, yaw, pitch, roll, opening and lens shift (shift is kept
 * small unless the points demand it). Several start poses guard against local minima.
 * Returns the pose and the remaining error in pixels of a 1920 px wide picture.
 */
export function solvePose(
  start: Pose,
  aspect: number,
  pts: readonly { p: V3; u: number; v: number }[],
  fold?: RoomFold,
): { pose: Pose; errPx: number } | null {
  if (pts.length < 4) return null;
  const obs = pts.map((q) => [q.u * 2 - 1, 1 - q.v * 2] as const);
  const toPose = (x: number[]): Pose => ({
    pos: [x[0]!, x[1]!, x[2]!],
    yaw: x[3]!,
    pitch: Math.max(-1.55, Math.min(1.55, x[4]!)),
    roll: Math.atan2(Math.sin(x[5]!), Math.cos(x[5]!)),
    fov: Math.max(6, Math.min(149, (Math.atan(Math.exp(x[6]!)) * 360) / Math.PI)),
    shiftX: Math.max(-2.9, Math.min(2.9, x[7]!)),
    shiftY: Math.max(-2.9, Math.min(2.9, x[8]!)),
  });
  const fromPose = (p: Pose): number[] => [
    ...p.pos,
    p.yaw,
    p.pitch,
    p.roll,
    Math.log(Math.tan((p.fov * Math.PI) / 360)),
    p.shiftX ?? 0,
    p.shiftY ?? 0,
  ];
  const SHIFT_PRIOR = 0.03;
  const resid = (x: number[]): number[] => {
    const p = toPose(x);
    const r: number[] = [];
    obs.forEach(([ox, oy], i) => {
      const q = projectPose(p, aspect, pts[i]!.p);
      if (!q) r.push(10, 10);
      else r.push(q[0] - ox, q[1] - oy);
    });
    r.push(SHIFT_PRIOR * x[7]!, SHIFT_PRIOR * x[8]!);
    return r;
  };
  const cost = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  const lm = (x0: number[]): { x: number[]; c: number } => {
    let x = [...x0];
    let r = resid(x);
    let c = cost(r);
    let lambda = 1e-3;
    const n = x.length;
    for (let it = 0; it < 200 && c > 1e-14; it++) {
      const J: number[][] = [];
      for (let k = 0; k < n; k++) {
        const h = 1e-6 * Math.max(1, Math.abs(x[k]!));
        const xp = [...x];
        xp[k]! += h;
        const rp = resid(xp);
        J.push(rp.map((v, i) => (v - r[i]!) / h));
      }
      // normal equations (JᵀJ + λ diag) δ = −Jᵀr
      const A: number[][] = [];
      const g: number[] = [];
      for (let a = 0; a < n; a++) {
        A.push([]);
        let s = 0;
        for (let i = 0; i < r.length; i++) s += J[a]![i]! * r[i]!;
        g.push(-s);
        for (let b = 0; b < n; b++) {
          let t = 0;
          for (let i = 0; i < r.length; i++) t += J[a]![i]! * J[b]![i]!;
          A[a]!.push(t);
        }
      }
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
        const d = solveLinear(M, [...g]);
        if (!d) {
          lambda *= 10;
          continue;
        }
        const xn = x.map((v, k) => v + d[k]!);
        const rn = resid(xn);
        const cn = cost(rn);
        if (cn < c) {
          x = xn;
          r = rn;
          const rel = (c - cn) / Math.max(c, 1e-18);
          c = cn;
          lambda = Math.max(1e-9, lambda / 5);
          improved = true;
          if (rel < 1e-10) it = 1e9;
          break;
        }
        lambda *= 10;
      }
      if (!improved) break;
    }
    return { x, c };
  };
  // start poses: the current one, plus a few standing points aimed at the measured points
  const starts: Pose[] = [start];
  const cen: V3 = [0, 0, 0];
  for (const q of pts) for (let k = 0; k < 3; k++) cen[k]! += q.p[k]! / pts.length;
  if (fold) {
    const c = fold.center;
    const dirs: V3[] = [sub(c, cen), [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];
    for (const d of dirs) {
      const l = Math.hypot(d[0], d[2]) || 1;
      for (const dist of [1.5, 3, 4.5]) {
        const from: V3 = [cen[0] + (d[0] / l) * dist, c[1], cen[2] + (d[2] / l) * dist];
        starts.push(aimPose(from, cen, start.fov, 0));
      }
    }
  }
  let best: { x: number[]; c: number } | null = null;
  for (const s of starts) {
    const res = lm(fromPose(s));
    if (!best || res.c < best.c) best = res;
  }
  if (!best) return null;
  const pose = toPose(best.x);
  let e = 0;
  for (let i = 0; i < pts.length; i++) {
    const q = projectPose(pose, aspect, pts[i]!.p);
    if (!q) return null;
    e += ((q[0] - obs[i]![0]) * 960) ** 2 + ((q[1] - obs[i]![1]) * (960 / aspect)) ** 2;
  }
  return { pose, errPx: Math.sqrt(e / pts.length) };
}

function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    if (Math.abs(A[piv]![c]!) < 1e-18) return null;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    [b[c], b[piv]] = [b[piv]!, b[c]!];
    for (let r = c + 1; r < n; r++) {
      const k = A[r]![c]! / A[c]![c]!;
      for (let j = c; j < n; j++) A[r]![j]! -= k * A[c]![j]!;
      b[r]! -= k * b[c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let j = r + 1; j < n; j++) s -= A[r]![j]! * x[j]!;
    x[r] = s / A[r]![r]!;
  }
  return x;
}
