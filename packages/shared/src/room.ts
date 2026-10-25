/**
 * The stage folded back into a 3D room ("cube map"): every surface becomes a face with an origin
 * and two axes in room space. Used for
 *  - the sky (computed from the viewing direction, so walls and ceiling meet seamlessly),
 *  - creatures that move around the viewer across walls, floor and ceiling,
 *  - the 3D room view in the controller.
 * Room space: x/z on the ground, y up, the viewer stands in `center`.
 */
import type { Pose, RoomObject, Surface } from './schema.ts';
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
): { name: string; faceId: string | null; pose: Pose; walls?: RoomWall[] }[] {
  const fold = roomFold(surfaces);
  const main = fold.faces.find((f) => f.role === 'main');
  if (!main) return [];
  if (boxFrame(fold)) {
    // a box room: every slot is a set of sides the projector covers completely
    const sets: RoomWall[][] =
      layout === 'mainOnly'
        ? [['vorne']]
        : layout === 'threeWalls'
          ? [['links', 'vorne', 'rechts']]
          : layout === 'threeWallsPlus'
            ? [['links', 'vorne', 'rechts'], ['boden'], ['decke']]
            : layout === 'wallFloor'
              ? [['vorne', 'boden']]
              : [['vorne'], ['rechts'], ['hinten'], ['links'], ['boden'], ['decke']];
    const out: { name: string; faceId: string | null; pose: Pose; walls: RoomWall[] }[] = [];
    for (const walls of sets) {
      const pose = poseForWalls(fold, walls);
      if (pose) out.push({ name: wallsName(walls), faceId: null, pose, walls });
    }
    if (out.length === sets.length) return out;
  }
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
  const sideNames = ['Rechts', 'Hinten', 'Links', 'Wand 5', 'Wand 6'];
  let side = 0;
  const names = new Map<string, string>();
  for (const f of fold.faces) {
    names.set(
      f.id,
      f.role === 'main'
        ? 'Vorne'
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
  const box = boxFrame(fold);
  return corners.map((c, i) => {
    const key = box ? boxKey(box, c.p) : null;
    return {
      // box rooms: a name that stays the same when the room size changes (vorne-links-unten …)
      id: key ?? c.p.map((v) => v.toFixed(2)).join(','),
      n: i + 1,
      p: c.p,
      label: key ? key.split('-').join(' ') : `${c.walls.join(' / ')} – ${c.low ? 'unten' : 'oben'}`,
    };
  });
}

/** The room as a box: floor corner at the left of the main wall, axes and size. */
export interface BoxFrame {
  /** Floor point below the left end of the main wall. */
  o: V3;
  /** Along the main wall (to the right), into the room, up. */
  ax: V3;
  n: V3;
  w: number;
  d: number;
  h: number;
}

/** Box frame of a room with 4 walls at right angles (null for other layouts). */
export function boxFrame(fold: RoomFold): BoxFrame | null {
  const walls = fold.faces.filter((f) => f.role === 'main' || f.role === 'side');
  const main = fold.faces.find((f) => f.role === 'main');
  if (!main || walls.length !== 4) return null;
  const side = walls.find((f) => f !== main && Math.abs(dot(f.n, main.ax)) > 0.99);
  if (!side) return null;
  return {
    o: [main.o[0], 0, main.o[2]],
    ax: main.ax,
    n: main.n,
    w: main.rect.w,
    d: side.rect.w,
    h: main.rect.h,
  };
}

function boxKey(b: BoxFrame, p: V3): string | null {
  const r = sub(p, b.o);
  const x = dot(r, b.ax) / b.w;
  const z = dot(r, b.n) / b.d;
  const y = p[1] / b.h;
  const near = (v: number) => Math.abs(v) < 0.02 || Math.abs(v - 1) < 0.02;
  if (!near(x) || !near(y) || !near(z)) return null;
  return `${z < 0.5 ? 'vorne' : 'hinten'}-${x < 0.5 ? 'links' : 'rechts'}-${y < 0.5 ? 'unten' : 'oben'}`;
}

/** Room point of a box corner key for a box of the given size (same frame as `b`). */
export function boxCorner(b: BoxFrame, key: string, w: number, d: number, h: number): V3 | null {
  const [zk, xk, yk] = key.split('-');
  if (!zk || !xk || !yk) return null;
  const x = xk === 'rechts' ? w : 0;
  const z = zk === 'hinten' ? d : 0;
  const y = yk === 'oben' ? h : 0;
  return [b.o[0] + b.ax[0] * x + b.n[0] * z, y, b.o[2] + b.ax[2] * x + b.n[2] * z];
}

type Measured = { p: V3; q?: V3 | undefined; u: number; v: number };

const poseFromX = (x: readonly number[], k = 0): Pose => ({
  pos: [x[k]!, x[k + 1]!, x[k + 2]!],
  yaw: x[k + 3]!,
  pitch: Math.max(-1.55, Math.min(1.55, x[k + 4]!)),
  roll: Math.atan2(Math.sin(x[k + 5]!), Math.cos(x[k + 5]!)),
  fov: Math.max(6, Math.min(149, (Math.atan(Math.exp(x[k + 6]!)) * 360) / Math.PI)),
  shiftX: Math.max(-2.9, Math.min(2.9, x[k + 7]!)),
  shiftY: Math.max(-2.9, Math.min(2.9, x[k + 8]!)),
});
const xFromPose = (p: Pose): number[] => [
  ...p.pos,
  p.yaw,
  p.pitch,
  p.roll,
  Math.log(Math.tan((p.fov * Math.PI) / 360)),
  p.shiftX ?? 0,
  p.shiftY ?? 0,
];

/** Residuals (NDC) of measured points for a pose; a corner gives 2, an edge point 1 (+ 0). */
function pushResiduals(r: number[], p: Pose, aspect: number, pts: readonly Measured[]): void {
  for (const m of pts) {
    const ox = m.u * 2 - 1;
    const oy = 1 - m.v * 2;
    if (m.q) {
      const d = edgeDistance(p, aspect, m.p, m.q, ox, oy);
      r.push(d ?? 10, 0);
      continue;
    }
    const q = projectPose(p, aspect, m.p);
    if (!q) r.push(10, 10);
    else r.push(q[0] - ox, q[1] - oy);
  }
}

/** Levenberg–Marquardt with a numeric Jacobian. */
function minimizeLM(resid: (x: number[]) => number[], x0: number[], maxIt = 200): { x: number[]; c: number } {
  const cost = (r: number[]) => r.reduce((a, b) => a + b * b, 0);
  let x = [...x0];
  let r = resid(x);
  let c = cost(r);
  let lambda = 1e-3;
  const n = x.length;
  for (let it = 0; it < maxIt && c > 1e-14; it++) {
    const J: number[][] = [];
    for (let k = 0; k < n; k++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[k]!));
      const xp = [...x];
      xp[k]! += h;
      const rp = resid(xp);
      J.push(rp.map((v, i) => (v - r[i]!) / h));
    }
    const A: number[][] = [];
    const g: number[] = [];
    for (let a = 0; a < n; a++) {
      A.push([]);
      let sg = 0;
      for (let i = 0; i < r.length; i++) sg += J[a]![i]! * r[i]!;
      g.push(-sg);
      for (let b = 0; b < n; b++) {
        let t = 0;
        if (b < a) t = A[b]![a]!;
        else for (let i = 0; i < r.length; i++) t += J[a]![i]! * J[b]![i]!;
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
        const rel = (c - cn) / Math.max(c, 1e-18);
        x = xn;
        r = rn;
        c = cn;
        lambda = Math.max(1e-9, lambda / 5);
        improved = true;
        if (rel < 1e-10) it = maxIt;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  return { x, c };
}

/** Remaining error in pixels (1920 px wide picture) of measured points for a pose. */
export function poseErrorPx(p: Pose, aspect: number, pts: readonly Measured[]): number | null {
  let e = 0;
  for (const m of pts) {
    const ox = m.u * 2 - 1;
    const oy = 1 - m.v * 2;
    if (m.q) {
      const d = edgeDistance(p, aspect, m.p, m.q, ox, oy);
      if (d === null) return null;
      e += (d * 960) ** 2;
      continue;
    }
    const q = projectPose(p, aspect, m.p);
    if (!q) return null;
    e += ((q[0] - ox) * 960) ** 2 + ((q[1] - oy) * (960 / aspect)) ** 2;
  }
  return pts.length ? Math.sqrt(e / pts.length) : 0;
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
  pts: readonly Measured[],
  fold?: RoomFold,
  quick = false,
): { pose: Pose; errPx: number } | null {
  // a corner gives 2 equations, a point on an edge 1; 7 unknowns (+ lens shift, kept small)
  if (measureCount(pts) < 7) return null;
  // keep the lens shift small only while few points are measured (a flat wall cannot tell it apart)
  const SHIFT_PRIOR = measureCount(pts) >= 10 ? 0.002 : 0.03;
  const resid = (x: number[]): number[] => {
    const r: number[] = [];
    pushResiduals(r, poseFromX(x), aspect, pts);
    r.push(SHIFT_PRIOR * x[7]!, SHIFT_PRIOR * x[8]!);
    return r;
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
  // quick (while a marker is dragged): refine the current pose only
  let best: { x: number[]; c: number } | null = minimizeLM(resid, xFromPose(start), quick ? 25 : 200);
  if (!quick && best.c > 1e-8) {
    const tries = [best, ...starts.slice(1).map((s0) => minimizeLM(resid, xFromPose(s0), 60))];
    tries.sort((a, b) => a.c - b.c);
    // finish the two most promising
    for (const t of tries.slice(0, 2)) {
      const res = minimizeLM(resid, t.x, 200);
      if (res.c < best.c) best = res;
    }
  }
  const pose = poseFromX(best.x);
  const errPx = poseErrorPx(pose, aspect, pts);
  return errPx === null ? null : { pose, errPx };
}

/** A measured point named by box corner keys (c|key or e|keyA|keyB|n) instead of coordinates. */
function boxPoints(b: BoxFrame, c: string, w: number, d: number, h: number): { p: V3; q?: V3 } | null {
  const parts = c.split('|');
  if (parts[0] === 'c' && parts[1]) {
    const p = boxCorner(b, parts[1], w, d, h);
    return p ? { p } : null;
  }
  if (parts[0] === 'e' && parts[1] && parts[2]) {
    const p = boxCorner(b, parts[1], w, d, h);
    const q = boxCorner(b, parts[2], w, d, h);
    return p && q ? { p, q } : null;
  }
  return null;
}

export interface RoomSolveInput {
  fold: RoomFold;
  /** Whether width/depth of the room may be adjusted (room built around one main wall). */
  sizeFree: boolean;
  projectors: { id: string; pose: Pose; aspect: number; anchors: readonly (Measured & { c: string })[] }[];
  /** Live dragging: only refine the poses, keep the room size. */
  quick?: boolean;
}

/**
 * Joint solve over all projectors: their poses and – when the points over-determine them – the
 * width and depth of the room (height fixed: the absolute scale cannot be seen). Nobody has to
 * measure the room: what fits the measured corners and edges is the room.
 */
export function solveRoom(input: RoomSolveInput): {
  poses: Record<string, { pose: Pose; errPx: number }>;
  size: { w: number; d: number } | null;
} {
  const out: Record<string, { pose: Pose; errPx: number }> = {};
  // 1) each projector on its own (also gives good start values)
  for (const pr of input.projectors) {
    const r = solvePose(pr.pose, pr.aspect, pr.anchors, input.fold, input.quick);
    if (r) out[pr.id] = r;
  }
  const box = input.sizeFree && !input.quick ? boxFrame(input.fold) : null;
  const solved = input.projectors.filter((pr) => out[pr.id]);
  const extra = solved.reduce((n, pr) => n + measureCount(pr.anchors) - 7, 0);
  if (!box || !solved.length || extra < 2) return { poses: out, size: null };
  const h = box.h;
  const usesBox = solved.some((pr) => pr.anchors.some((a) => boxPoints(box, a.c, box.w, box.d, h)));
  if (!usesBox) return { poses: out, size: null };
  // the room size only follows from points away from the front wall (a back corner, an edge running
  // into the room …) – the corners of one flat wall cannot tell its width from the projector's zoom
  const offFront = solved.some((pr) =>
    pr.anchors.some((a) => {
      const bp = boxPoints(box, a.c, box.w, box.d, h);
      if (!bp) return false;
      const depth = (P: V3) => dot(sub(P, box.o), box.n);
      return depth(bp.p) > 0.05 * box.d || (bp.q ? depth(bp.q) > 0.05 * box.d : false);
    }),
  );
  if (!offFront) return { poses: out, size: null };
  // 2) together with the room size
  const resid = (x: number[]): number[] => {
    // the front wall keeps its width (it was set up and looked right); only the depth follows
    const w = box.w;
    const d = Math.exp(x[1]!);
    const r: number[] = [];
    solved.forEach((pr, k) => {
      const pose = poseFromX(x, 2 + k * 9);
      const pts = pr.anchors.map((a) => {
        const bp = boxPoints(box, a.c, w, d, h);
        return bp ? { ...a, p: bp.p, q: bp.q } : a;
      });
      pushResiduals(r, pose, pr.aspect, pts);
      r.push(0.01 * x[2 + k * 9 + 7]!, 0.01 * x[2 + k * 9 + 8]!);
    });
    // a gentle pull towards the current size keeps an unseen direction where it is
    r.push(1 * (x[0]! - Math.log(box.w)), 0.003 * (x[1]! - Math.log(box.d)));
    return r;
  };
  // alternate: projectors alone (with several start poses) for the current size, then all
  // together with the size – a projector that started badly does not trap the joint solve
  let w = box.w;
  let d = box.d;
  let res: { x: number[]; c: number } | null = null;
  for (let round = 0; round < 2; round++) {
    for (const pr of solved) {
      const pts = pr.anchors.map((a) => {
        const bp = boxPoints(box, a.c, w, d, h);
        return bp ? { ...a, p: bp.p, q: bp.q } : a;
      });
      const r1 = solvePose(out[pr.id]!.pose, pr.aspect, pts, input.fold);
      if (r1) out[pr.id] = r1;
    }
    const x0 = [Math.log(w), Math.log(d), ...solved.flatMap((pr) => xFromPose(out[pr.id]!.pose))];
    res = minimizeLM(resid, x0, 120);
    w = box.w;
    d = Math.exp(res.x[1]!);
    solved.forEach((pr, k) => {
      out[pr.id] = { pose: poseFromX(res!.x, 2 + k * 9), errPx: out[pr.id]!.errPx };
    });
  }
  if (!res) return { poses: out, size: null };
  if (!(w > 0.3 && w < 60 && d > 0.3 && d < 60)) return { poses: out, size: null };
  solved.forEach((pr, k) => {
    const pose = poseFromX(res.x, 2 + k * 9);
    const pts = pr.anchors.map((a) => {
      const bp = boxPoints(box, a.c, w, d, h);
      return bp ? { ...a, p: bp.p, q: bp.q } : a;
    });
    const e = poseErrorPx(pose, pr.aspect, pts);
    if (e !== null) out[pr.id] = { pose, errPx: e };
  });
  return { poses: out, size: { w, d } };
}

/** Number of equations measured points give (corner 2, point on an edge 1). */
export function measureCount(pts: readonly { q?: V3 | undefined }[]): number {
  return pts.reduce((n, m) => n + (m.q ? 1 : 2), 0);
}

/**
 * Distance (NDC, x scaled like y by the aspect) of picture point (ox, oy) from the projected
 * room edge a–b (only the part in front of the projector counts).
 */
export function edgeDistance(p: Pose, aspect: number, a: V3, b: V3, ox: number, oy: number): number | null {
  let first: [number, number] | null = projectPose(p, aspect, a);
  let last: [number, number] | null = first ? projectPose(p, aspect, b) : null;
  // part of the edge behind the projector: use the part in front of it
  const sample = !first || !last;
  if (sample) {
    first = null;
    last = null;
  }
  for (let i = 0; i <= 24 && sample; i++) {
    const t = i / 24;
    const q = projectPose(p, aspect, [
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]);
    if (!q || Math.abs(q[0]) > 50 || Math.abs(q[1]) > 50) continue;
    if (!first) first = q;
    last = q;
  }
  if (!first || !last) return null;
  // work in a square space (x in units of the picture height) so distances are isotropic
  const ax = first[0] * aspect;
  const bx = last[0] * aspect;
  const dx = bx - ax;
  const dy = last[1] - first[1];
  const l = Math.hypot(dx, dy);
  if (l < 1e-6) return Math.hypot(ox * aspect - ax, oy - first[1]) / aspect;
  return ((ox * aspect - ax) * dy - (oy - first[1]) * dx) / l / aspect;
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

/** Room point of an object-local point (x right, y up from the bottom, z towards the front). */
export function objectPoint(o: RoomObject, x: number, y: number, z: number): V3 {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  return [o.pos[0] + c * x + s * z, o.pos[1] + y, o.pos[2] - s * x + c * z];
}

/** Outline of an object as line segments (for placing it with live feedback on the projectors). */
export function objectEdges(o: RoomObject): [V3, V3][] {
  const [w, h, d] = o.size;
  const segs: [V3, V3][] = [];
  if (o.shape === 'box') {
    const xs = [-w / 2, w / 2];
    const zs = [-d / 2, d / 2];
    for (const y of [0, h]) {
      segs.push([objectPoint(o, xs[0]!, y, zs[0]!), objectPoint(o, xs[1]!, y, zs[0]!)]);
      segs.push([objectPoint(o, xs[1]!, y, zs[0]!), objectPoint(o, xs[1]!, y, zs[1]!)]);
      segs.push([objectPoint(o, xs[1]!, y, zs[1]!), objectPoint(o, xs[0]!, y, zs[1]!)]);
      segs.push([objectPoint(o, xs[0]!, y, zs[1]!), objectPoint(o, xs[0]!, y, zs[0]!)]);
    }
    for (const x of xs) for (const z of zs) segs.push([objectPoint(o, x, 0, z), objectPoint(o, x, h, z)]);
  } else {
    const n = 32;
    for (const y of [0, h])
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        segs.push([
          objectPoint(o, (Math.cos(a0) * w) / 2, y, (Math.sin(a0) * d) / 2),
          objectPoint(o, (Math.cos(a1) * w) / 2, y, (Math.sin(a1) * d) / 2),
        ]);
      }
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      segs.push([
        objectPoint(o, (Math.cos(a) * w) / 2, 0, (Math.sin(a) * d) / 2),
        objectPoint(o, (Math.cos(a) * w) / 2, h, (Math.sin(a) * d) / 2),
      ]);
    }
  }
  return segs;
}

export interface RoomEdge {
  id: string;
  a: V3;
  b: V3;
  /** e.g. "Wand rechts / Decke". */
  label: string;
}

function faceNames(fold: RoomFold): Map<string, string> {
  const sideNames = ['Rechts', 'Hinten', 'Links', 'Wand 5', 'Wand 6'];
  let side = 0;
  const names = new Map<string, string>();
  for (const f of fold.faces)
    names.set(
      f.id,
      f.role === 'main'
        ? 'Vorne'
        : f.role === 'side'
          ? (sideNames[side++] ?? 'Wand')
          : f.role === 'ground'
            ? 'Boden'
            : 'Decke',
    );
  return names;
}

function onFace(f: RoomFace, p: V3, tol = 0.03): boolean {
  const r = sub(p, f.o);
  if (Math.abs(dot(r, f.n)) > tol) return false;
  const lx = dot(r, f.ax);
  const ly = dot(r, f.ay);
  return lx > -tol && ly > -tol && lx < f.rect.w + tol && ly < f.rect.h + tol;
}

/**
 * The real edges of the room (where two sides meet at an angle: wall/wall, wall/floor,
 * wall/ceiling). A projector that lights several sides sees these lines even where it does not
 * reach a corner – a point anywhere on such a line is a measurement too.
 */
export function roomEdges(fold: RoomFold): RoomEdge[] {
  const names = faceNames(fold);
  const corners = roomCorners(fold);
  // planes (normal + offset) with their faces
  const planes: { n: V3; d: number; faces: RoomFace[] }[] = [];
  for (const f of fold.faces) {
    const d = dot(f.n, f.o);
    let pl = planes.find((q) => dot(q.n, f.n) > 0.999 && Math.abs(q.d - d) < 0.03);
    if (!pl) planes.push((pl = { n: f.n, d, faces: [] }));
    pl.faces.push(f);
  }
  const on = (pl: (typeof planes)[number], p: V3) => pl.faces.some((f) => onFace(f, p));
  const edges: RoomEdge[] = [];
  for (let i = 0; i < corners.length; i++)
    for (let j = i + 1; j < corners.length; j++) {
      const a = corners[i]!.p;
      const b = corners[j]!.p;
      const mid: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const shared = planes.filter((pl) => on(pl, a) && on(pl, b) && on(pl, mid));
      if (shared.length < 2) continue;
      const label = shared
        .map((pl) => {
          const f = pl.faces.find((x) => onFace(x, mid)) ?? pl.faces[0]!;
          return names.get(f.id)!;
        })
        .sort((x, y) => (x === 'Vorne' ? -1 : y === 'Vorne' ? 1 : 0))
        .join(' / ');
      edges.push({ id: `${corners[i]!.id}|${corners[j]!.id}`, a, b, label });
    }
  return edges;
}

/** The six fixed sides of the room. */
export const ROOM_WALLS = ['vorne', 'rechts', 'hinten', 'links', 'boden', 'decke'] as const;
export type RoomWall = (typeof ROOM_WALLS)[number];
export const ROOM_WALL_LABEL: Record<RoomWall, string> = {
  vorne: 'Vorne',
  rechts: 'Rechts',
  hinten: 'Hinten',
  links: 'Links',
  boden: 'Boden',
  decke: 'Decke',
};

/** The sides a box corner key (vorne-links-unten) belongs to. */
export function cornerWalls(key: string): RoomWall[] {
  return key
    .split('-')
    .map((k) => (k === 'unten' ? 'boden' : k === 'oben' ? 'decke' : k))
    .filter((k): k is RoomWall => (ROOM_WALLS as readonly string[]).includes(k));
}

/** The sides a measured point touches (corner: 3, edge: 2), from its id (c|key or e|a|b|n). */
export function anchorWalls(id: string): RoomWall[] {
  const p = id.split('|');
  if (p[0] === 'c' && p[1]) return cornerWalls(p[1]);
  if (p[0] === 'e' && p[1] && p[2]) {
    const b = new Set(cornerWalls(p[2]));
    return cornerWalls(p[1]).filter((w) => b.has(w));
  }
  return [];
}

/**
 * A projector pose for the chosen sides of the room: the transitions between the chosen sides
 * (or all corners of a single side) must be in the picture; among the standing points all over
 * the room the one that shows most of the chosen sides wins (then the narrowest picture).
 * Returns null if the sides cannot be lit by one projector (e.g. front and back wall).
 */
export function poseForWalls(fold: RoomFold, walls: readonly RoomWall[], aspect = 16 / 9): Pose | null {
  const b = boxFrame(fold);
  if (!b || !walls.length) return null;
  const keys: string[] = [];
  for (const zk of ['vorne', 'hinten'])
    for (const xk of ['links', 'rechts']) for (const yk of ['unten', 'oben']) keys.push(`${zk}-${xk}-${yk}`);
  const sel = (k: string) => cornerWalls(k).filter((w) => walls.includes(w)).length;
  const required = keys.filter((k) => (walls.length === 1 ? sel(k) >= 1 : sel(k) >= 2));
  if (!required.length) return null;
  const P = (k: string) => boxCorner(b, k, b.w, b.d, b.h)!;
  const need = required.map(P);
  // sample points on every chosen side, to measure how much of it the picture shows
  const samples: { wall: RoomWall; p: V3 }[] = [];
  for (const w of walls) {
    const ks = keys.filter((k) => cornerWalls(k).includes(w)).map(P);
    // the 4 corners form a rectangle: a0 + s·(a1 − a0) + t·(a2 − a0)
    const [a0, ...rest] = ks;
    const far = rest.reduce((m, q) => (Math.hypot(...sub(q, a0!)) > Math.hypot(...sub(m, a0!)) ? q : m));
    const sides = rest.filter((q) => q !== far);
    for (let i = 0; i <= 5; i++)
      for (let j = 0; j <= 5; j++) {
        const s1 = i / 5;
        const t1 = j / 5;
        samples.push({
          wall: w,
          p: add(add(a0!, sub(sides[0]!, a0!), s1), sub(sides[1]!, a0!), t1),
        });
      }
  }
  const at = (fx: number, fy: number, fz: number): V3 => [
    b.o[0] + b.ax[0] * b.w * fx + b.n[0] * b.d * fz,
    b.h * fy,
    b.o[2] + b.ax[2] * b.w * fx + b.n[2] * b.d * fz,
  ];
  let best: { pose: Pose; cover: number; fov: number } | null = null;
  for (const fx of [0.1, 0.3, 0.5, 0.7, 0.9])
    for (const fz of [0.05, 0.25, 0.5, 0.75, 0.95])
      for (const fy of [0.2, 0.5, 0.85]) {
        const from = at(fx, fy, fz);
        const m: V3 = [0, 0, 0];
        for (const p of need) {
          const d = sub(p, from);
          const l = Math.hypot(...d) || 1;
          for (let k = 0; k < 3; k++) m[k]! += d[k]! / l;
        }
        if (Math.hypot(...m) < 0.2 * need.length) continue;
        const aim = aimPose(from, add(from, m), 90);
        let tx = 0;
        let ok = true;
        const R = poseDirFrame(aim);
        for (const p of need) {
          const d = sub(p, from);
          const z = -dot(d, R.f);
          if (z < 0.05) {
            ok = false;
            break;
          }
          tx = Math.max(tx, Math.abs(dot(d, R.r)) / z, (Math.abs(dot(d, R.u)) / z) * aspect);
        }
        if (!ok) continue;
        // open the picture a bit more (up to 150°) when that shows more of the chosen sides
        const fov0 = (2 * Math.atan(tx * 1.04) * 180) / Math.PI;
        if (fov0 > 150) continue;
        for (const fov of [fov0, Math.min(150, fov0 + 15), Math.min(150, fov0 + 30)]) {
          const pose = { ...aim, fov };
          const perWall = new Map<RoomWall, number>();
          for (const sm of samples) {
            const q = projectPose(pose, aspect, sm.p);
            if (q && Math.abs(q[0]) <= 1.001 && Math.abs(q[1]) <= 1.001)
              perWall.set(sm.wall, (perWall.get(sm.wall) ?? 0) + 1);
          }
          // every chosen side must show up; then: as much of them as possible
          const each = walls.map((w) => (perWall.get(w) ?? 0) / 36);
          if (Math.min(...each) < 0.15) continue;
          const cover = each.reduce((a, c) => a + c, 0) / walls.length;
          if (!best || cover > best.cover + 0.02 || (cover > best.cover - 0.02 && fov < best.fov - 0.5))
            best = { pose, cover, fov };
        }
      }
  return best?.pose ?? null;
}

/** Forward (into the picture, negated: points have −z), right and up vectors of a pose. */
function poseDirFrame(p: Pose): { f: V3; r: V3; u: V3 } {
  const c = poseRay(p, 1, 0, 0);
  const e = 1e-3;
  const rx = poseRay({ ...p, fov: 90 }, 1, e, 0);
  const uy = poseRay({ ...p, fov: 90 }, 1, 0, e);
  const r = sub(rx, c);
  const u = sub(uy, c);
  const nr = Math.hypot(...r) || 1;
  const nu = Math.hypot(...u) || 1;
  // f is the direction the picture goes; points in front have dot(d, f) > 0 → use −f as "z"
  return {
    f: [-c[0], -c[1], -c[2]],
    r: [r[0] / nr, r[1] / nr, r[2] / nr],
    u: [u[0] / nu, u[1] / nu, u[2] / nu],
  };
}

/** Projector name from the sides it covers, e.g. "Beamer Links + Vorne + Rechts". */
export function wallsName(walls: readonly RoomWall[]): string {
  return `Beamer ${walls.map((w) => ROOM_WALL_LABEL[w]).join(' + ')}`;
}

/** Which sides of the room a pose lights noticeably (for projectors set up before sides were chosen). */
export function wallsOfPose(fold: RoomFold, pose: Pose, aspect = 16 / 9): RoomWall[] {
  const b = boxFrame(fold);
  if (!b) return [];
  const out: RoomWall[] = [];
  const keys: string[] = [];
  for (const zk of ['vorne', 'hinten'])
    for (const xk of ['links', 'rechts']) for (const yk of ['unten', 'oben']) keys.push(`${zk}-${xk}-${yk}`);
  for (const w of ROOM_WALLS) {
    const ks = keys.filter((k) => cornerWalls(k).includes(w)).map((k) => boxCorner(b, k, b.w, b.d, b.h)!);
    const [a0, ...rest] = ks;
    const far = rest.reduce((m, q) => (Math.hypot(...sub(q, a0!)) > Math.hypot(...sub(m, a0!)) ? q : m));
    const sides = rest.filter((q) => q !== far);
    let n = 0;
    for (let i = 0; i <= 5; i++)
      for (let j = 0; j <= 5; j++) {
        const q = projectPose(
          pose,
          aspect,
          add(add(a0!, sub(sides[0]!, a0!), i / 5), sub(sides[1]!, a0!), j / 5),
        );
        if (q && Math.abs(q[0]) <= 1 && Math.abs(q[1]) <= 1) n++;
      }
    if (n / 36 >= 0.15) out.push(w);
  }
  return out;
}

/**
 * Measured points that do not fit the others (e.g. a corner hidden behind a couch and set on the
 * couch instead): each point is predicted from all the other points; if it lies far from that
 * prediction while the others agree, it is suspicious. Returns the suspects, worst first.
 */
export function findOutliers(
  pose: Pose,
  aspect: number,
  pts: readonly (Measured & { c: string })[],
): { c: string; errPx: number }[] {
  if (measureCount(pts) < 9) return [];
  const errs: { c: string; errPx: number }[] = [];
  for (let i = 0; i < pts.length; i++) {
    const others = pts.filter((_, k) => k !== i);
    if (measureCount(others) < 8) continue;
    const r = solvePose(pose, aspect, others, undefined, true);
    if (!r) continue;
    const e = poseErrorPx(r.pose, aspect, [pts[i]!]);
    if (e !== null) errs.push({ c: pts[i]!.c, errPx: e });
  }
  if (errs.length < 4) return [];
  const sorted = [...errs].map((e) => e.errPx).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  return errs.filter((e) => e.errPx > Math.max(12, median * 4)).sort((a, b) => b.errPx - a.errPx);
}

/** Which side of a box room a face is (null for other layouts). */
export function faceWall(fold: RoomFold, f: RoomFace): RoomWall | null {
  const b = boxFrame(fold);
  if (!b) return null;
  if (f.n[1] > 0.9) return 'boden';
  if (f.n[1] < -0.9) return 'decke';
  const z = dot(f.n, b.n);
  if (z > 0.9) return 'vorne';
  if (z < -0.9) return 'hinten';
  const x = dot(f.n, b.ax);
  if (x > 0.9) return 'links';
  if (x < -0.9) return 'rechts';
  return null;
}

/** A side of the room in the projector picture: its four corners (u, v 0..1; TL, TR, BR, BL of the face rect). */
export interface WallQuad {
  wall: RoomWall;
  face: RoomFace;
  /** Box corner keys of the four corners (vorne-links-oben …). */
  keys: string[];
  uv: [number, number][];
  /** Which corners were measured (the others come from the computed projector position). */
  measured: boolean[];
}

/**
 * The chosen sides of the room in the projector picture. A measured corner is the truth: the side
 * is pinned exactly onto its measured corners (like a 2D corner calibration); the computed
 * projector position only fills in corners that could not be measured. Sides with a corner
 * behind the projector are left out (they are drawn by the 3D view as before).
 */
export function wallQuads(
  fold: RoomFold,
  pose: Pose,
  aspect: number,
  anchors: readonly { c: string; u: number; v: number; q?: V3 | undefined }[],
  walls: readonly RoomWall[],
): WallQuad[] {
  const b = boxFrame(fold);
  if (!b) return [];
  const out: WallQuad[] = [];
  for (const f of fold.faces) {
    const wall = faceWall(fold, f);
    if (!wall || (walls.length && !walls.includes(wall))) continue;
    const r = f.rect;
    const pts = [
      facePoint(f, r.x, r.y),
      facePoint(f, r.x + r.w, r.y),
      facePoint(f, r.x + r.w, r.y + r.h),
      facePoint(f, r.x, r.y + r.h),
    ];
    const keys = pts.map((P) => boxKey(b, P));
    if (keys.some((k) => !k)) continue;
    const uv: [number, number][] = [];
    const measured: boolean[] = [];
    let ok = true;
    pts.forEach((P, i) => {
      const a = anchors.find((x) => x.c === `c|${keys[i]}` && !x.q);
      if (a) {
        uv.push([a.u, a.v]);
        measured.push(true);
        return;
      }
      const q = projectPose(pose, aspect, P);
      if (!q) ok = false;
      else uv.push([(q[0] + 1) / 2, (1 - q[1]) / 2]);
      measured.push(false);
    });
    if (ok) out.push({ wall, face: f, keys: keys as string[], uv, measured });
  }
  return out;
}
