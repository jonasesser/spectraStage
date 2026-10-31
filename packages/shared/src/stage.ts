/**
 * Stage geometry and deterministic actor routing. Everything here is a pure function of
 * (state, seed, time) so that every output computes identical positions without messages.
 */
import type { ActorCue, Output, Profile, SessionState, StageAmbient, Surface, Viewport } from './schema.ts';
import type { ActorManifest, SurfaceKind, ThemeCatalog } from './theme.ts';
import { createRng, hashInts, hashString } from './random.ts';
import type { Rng } from './random.ts';
import { pointInPolygon } from './homography.ts';

export type V2 = { x: number; y: number };
export type BBox = { x: number; y: number; w: number; h: number };

export function polygonBBox(poly: readonly V2[]): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { x: minX, y: minY, w: Math.max(1e-6, maxX - minX), h: Math.max(1e-6, maxY - minY) };
}

export function rectPolygon(x: number, y: number, w: number, h: number): V2[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function stageBounds(surfaces: readonly Surface[], outputs: readonly Output[] = []): BBox {
  const pts: V2[] = [];
  for (const s of surfaces) pts.push(...s.polygon);
  for (const o of outputs) {
    const vp = activeProfile(o).viewport;
    pts.push({ x: vp.x, y: vp.y }, { x: vp.x + vp.w, y: vp.y + vp.h });
  }
  if (pts.length === 0) return { x: 0, y: 0, w: 10, h: 6 };
  return polygonBBox(pts);
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function viewportBBox(vp: Viewport): BBox {
  return { x: vp.x, y: vp.y, w: vp.w, h: vp.h };
}

export function activeProfile(output: Output): Profile {
  return output.profiles.find((p) => p.id === output.activeProfileId) ?? (output.profiles[0] as Profile);
}

/**
 * Default size for a new surface (meters). Every face gets the projector format (16:9) and the
 * same size – a projector shows the same picture shape on a wall, the floor or the ceiling.
 */
export function defaultSurfaceSize(_kind: SurfaceKind): { w: number; h: number } {
  return { w: 4, h: 2.25 };
}

/**
 * Finds a spot for a new surface in the unfolded room, at the size of the main wall: walls to
 * the right of the wall row, a floor below the main wall (else below the next free wall), other
 * surfaces (e.g. a ceiling) above the main wall.
 */
export function placeNewSurface(surfaces: readonly Surface[], kind: SurfaceKind): V2[] {
  if (surfaces.length === 0) {
    const d = defaultSurfaceSize(kind);
    return rectPolygon(0, 0, d.w, d.h);
  }
  const lay = worldLayout(surfaces);
  const main = lay.find((x) => x.role === 'main')?.rect;
  const walls = lay.filter((x) => x.role === 'main' || x.role === 'side').map((x) => x.rect);
  const size = main ? { w: main.w, h: main.h } : defaultSurfaceSize(kind);
  const free = (r: BBox) =>
    !surfaces.some((s) =>
      bboxIntersects(polygonBBox(s.polygon), { x: r.x + 0.01, y: r.y + 0.01, w: r.w - 0.02, h: r.h - 0.02 }),
    );
  if (main && kind === 'floor') {
    for (const w of [main, ...walls]) {
      const r = { x: w.x, y: w.y + w.h, w: w.w, h: size.h };
      if (free(r)) return rectPolygon(r.x, r.y, r.w, r.h);
    }
  }
  if (main && kind === 'other') {
    const r = { x: main.x, y: main.y - size.h, w: size.w, h: size.h };
    if (free(r)) return rectPolygon(r.x, r.y, r.w, r.h);
  }
  if (main && walls.length) {
    const right = Math.max(...walls.map((w) => w.x + w.w));
    return rectPolygon(right, main.y, size.w, size.h);
  }
  const b = stageBounds(surfaces);
  return rectPolygon(b.x + b.w, b.y, size.w, size.h);
}

/**
 * The full room around the viewer: the real surfaces plus virtual ones for the sides that have
 * no projector yet (walls up to four, the floor in front of the main wall, the ceiling above it),
 * all at the size of the main wall. Worlds are computed over this complete room, so every real
 * surface shows its part of the same closed world, and the 3D view is never missing a side.
 * Virtual surfaces have ids starting with "virtual:" and play the main wall's playback.
 */
export function completeRoom(surfaces: readonly Surface[]): Surface[] {
  const lay = worldLayout(surfaces);
  const mainW = lay.find((x) => x.role === 'main');
  if (!mainW) return [...surfaces];
  const mainS = surfaces.find((s) => s.id === mainW.id)!;
  const m = mainW.rect;
  const out: Surface[] = [...surfaces];
  // a scene played in on the main wall: the added sides join in where it is made for them (the
  // witch on the right wall), otherwise they go dark with it – never the old picture
  const ins = mainS.insert;
  const insertFor = (side: string, i: number): Surface['insert'] => {
    if (!ins) return undefined;
    if (!ins.id.startsWith('dark-') && ins.sides?.includes(side)) return { ...ins, id: `${ins.id}v${i}` };
    // over the running scene: the other sides simply go on
    if (ins.keep) return undefined;
    return {
      id: `dark-v${i}-${ins.id}`.slice(0, 40),
      scene: { themeId: 'basic', sceneId: 'solidColor', params: { color: '#000000' } },
      seed: ins.seed + 50 + i,
      startedAt: ins.startedAt,
      endAt: ins.endAt,
    };
  };
  const add = (id: string, kind: SurfaceKind, role: Surface['role'], r: BBox, side = '') => {
    const insert = insertFor(side, out.length);
    out.push({
      id: `virtual:${id}`,
      name: id,
      kind,
      role,
      intensity: 1,
      polygon: rectPolygon(r.x, r.y, r.w, r.h),
      playback: structuredClone(mainS.playback),
      ...(insert ? { insert } : {}),
    } as Surface);
  };
  const walls = lay.filter((x) => x.role === 'main' || x.role === 'side');
  // room depth = width of the walls next to the main wall (measured depth for added walls)
  const depth = walls.find((w) => w.role === 'side')?.rect.w ?? mainS.roomDepth ?? m.w;
  let right = Math.max(...walls.map((w) => w.rect.x + w.rect.w));
  const mi = [...walls].sort((a, b) => a.rect.x - b.rect.x).findIndex((w) => w.role === 'main');
  for (let i = walls.length; i < 4; i++) {
    // right and left walls are as wide as the room is deep, the back wall like the main wall
    const w = i % 2 === 1 ? depth : m.w;
    // (the walls go round the room to the right: next to the main wall right, the last one left)
    const side = i === mi + 1 ? 'right' : (i + 1) % 4 === mi ? 'left' : 'back';
    add(`wall${i + 1}`, 'wall', 'side', { x: right, y: m.y, w, h: m.h }, side);
    right += w;
  }
  const bottom = m.y + m.h;
  const hasFloor = lay.some(
    (x) =>
      x.role === 'ground' &&
      x.rect.x < m.x + m.w &&
      x.rect.x + x.rect.w > m.x &&
      Math.abs(x.rect.y - bottom) < 0.6,
  );
  if (!hasFloor) add('floor', 'floor', 'ground', { x: m.x, y: bottom, w: m.w, h: depth }, 'floorFront');
  else {
    // the projected floor is shallower than the room: fill the rest of the floor virtually
    const reach = Math.max(
      ...lay
        .filter((x) => x.role === 'ground' && x.rect.x < m.x + m.w && x.rect.x + x.rect.w > m.x)
        .map((x) => x.rect.y + x.rect.h),
    );
    if (reach < bottom + depth - 0.05)
      add(
        'floorRest',
        'floor',
        'ground',
        { x: m.x, y: reach, w: m.w, h: bottom + depth - reach },
        'floorFront',
      );
  }
  const hasCeiling = lay.some((x) => x.role === 'ceiling');
  if (!hasCeiling) add('ceiling', 'other', 'ceiling', { x: m.x, y: m.y - depth, w: m.w, h: depth });
  return out;
}

/** Viewport covering a bbox with the given aspect ratio (w/h), centered, with a small margin. */
export function fitViewport(b: BBox, aspect: number, margin = 0.05): Viewport {
  let w = b.w * (1 + margin * 2);
  let h = b.h * (1 + margin * 2);
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

/** Output whose viewport covers the given stage point best (deterministic tie-break by id). */
export function primaryOutputAt(outputs: readonly Output[], p: V2): Output | null {
  let best: Output | null = null;
  let bestScore = -Infinity;
  for (const o of [...outputs].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const vp = activeProfile(o).viewport;
    if (p.x < vp.x || p.y < vp.y || p.x > vp.x + vp.w || p.y > vp.y + vp.h) continue;
    // Prefer the output where the point is most central.
    const dx = Math.abs(p.x - (vp.x + vp.w / 2)) / vp.w;
    const dy = Math.abs(p.y - (vp.y + vp.h / 2)) / vp.h;
    const score = 1 - Math.max(dx, dy);
    if (score > bestScore + 1e-9) {
      best = o;
      bestScore = score;
    }
  }
  return best;
}

export function polygonCentroid(poly: readonly V2[]): V2 {
  const b = polygonBBox(poly);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

// ---------------------------------------------------------------------------
// Actor routes
// ---------------------------------------------------------------------------
export interface RouteSegment {
  /** Start time offset (ms) relative to the route start. */
  t0: number;
  t1: number;
  /** Cubic Bézier control points. */
  p0: V2;
  c0: V2;
  c1: V2;
  p1: V2;
}

export interface Route {
  delayMs: number;
  segments: RouteSegment[];
  pauses: { t0: number; t1: number; p: V2; angle: number }[];
  totalMs: number;
  sizeM: number;
}

export interface ActorPose {
  x: number;
  y: number;
  /** Heading in radians (0 = +x / right, y grows downwards). */
  angle: number;
  moving: boolean;
  /** Distance travelled in meters (for gait phase). */
  distance: number;
  visible: boolean;
}

function randomPointIn(poly: readonly V2[], rng: Rng, inset = 0.1): V2 {
  const b = polygonBBox(poly);
  for (let i = 0; i < 40; i++) {
    const p = {
      x: b.x + b.w * (inset + (1 - inset * 2) * rng()),
      y: b.y + b.h * (inset + (1 - inset * 2) * rng()),
    };
    if (pointInPolygon(p, poly)) return p;
  }
  return polygonCentroid(poly);
}

/** A point just outside the polygon's bbox on a random edge (actor enters/leaves the scene). */
function pointOutside(poly: readonly V2[], rng: Rng, distance: number): V2 {
  const b = polygonBBox(poly);
  const side = Math.floor(rng() * 4);
  const u = 0.15 + rng() * 0.7;
  switch (side) {
    case 0:
      return { x: b.x + b.w * u, y: b.y - distance };
    case 1:
      return { x: b.x + b.w + distance, y: b.y + b.h * u };
    case 2:
      return { x: b.x + b.w * u, y: b.y + b.h + distance };
    default:
      return { x: b.x - distance, y: b.y + b.h * u };
  }
}

function dist(a: V2, b: V2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function bezier(s: RouteSegment, u: number): V2 {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return {
    x: a * s.p0.x + b * s.c0.x + c * s.c1.x + d * s.p1.x,
    y: a * s.p0.y + b * s.c0.y + c * s.c1.y + d * s.p1.y,
  };
}

function bezierTangent(s: RouteSegment, u: number): V2 {
  const v = 1 - u;
  return {
    x: 3 * v * v * (s.c0.x - s.p0.x) + 6 * v * u * (s.c1.x - s.c0.x) + 3 * u * u * (s.p1.x - s.c1.x),
    y: 3 * v * v * (s.c0.y - s.p0.y) + 6 * v * u * (s.c1.y - s.c0.y) + 3 * u * u * (s.p1.y - s.c1.y),
  };
}

function segmentLength(s: RouteSegment): number {
  let len = 0;
  let prev = s.p0;
  for (let i = 1; i <= 16; i++) {
    const p = bezier(s, i / 16);
    len += dist(prev, p);
    prev = p;
  }
  return len;
}

function surfacesForActor(surfaces: readonly Surface[], actor: ActorManifest): Surface[] {
  const pref = surfaces.filter((s) => actor.kinds.includes(s.kind));
  return pref.length > 0 ? pref : [...surfaces];
}

/** Picks the next surface: nearby ones are more likely, but any surface is possible. */
function nextSurface(pool: readonly Surface[], from: V2, rng: Rng): Surface {
  const weights = pool.map((s) => {
    const c = polygonCentroid(s.polygon);
    return 1 / (0.5 + dist(c, from));
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  let r = rng() * sum;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i] as number;
    if (r <= 0) return pool[i] as Surface;
  }
  return pool[pool.length - 1] as Surface;
}

/**
 * Builds the deterministic route of one actor instance of a cue.
 * Routes start and end just outside the projected surfaces so creatures walk in and out.
 */
export function buildActorRoute(
  surfaces: readonly Surface[],
  actor: ActorManifest,
  cue: Pick<ActorCue, 'seed' | 'speed' | 'fromSurfaceId' | 'toSurfaceId'>,
  index: number,
): Route | null {
  const pool = surfacesForActor(surfaces, actor);
  if (pool.length === 0) return null;
  const rng = createRng(hashInts(cue.seed, index + 1));
  const speed = Math.max(0.05, actor.speedMps * cue.speed * (0.8 + rng() * 0.4));
  const delayMs = index === 0 ? 0 : Math.round((0.4 + rng() * 1.6) * 1000 * index);
  const from =
    (cue.fromSurfaceId && surfaces.find((s) => s.id === cue.fromSurfaceId)) ||
    nextSurface(pool, { x: 0, y: 0 }, rng);
  const to = cue.toSurfaceId ? surfaces.find((s) => s.id === cue.toSurfaceId) : undefined;

  const pts: V2[] = [pointOutside(from.polygon, rng, actor.sizeM * 1.5)];
  pts.push(randomPointIn(from.polygon, rng));
  const [minW, maxW] = actor.waypoints;
  const n = Math.max(1, Math.round(minW + rng() * (maxW - minW)));
  let current: Surface = from;
  if (to) {
    // Wander a little on the start surface, then cross to the target.
    if (rng() < 0.6) pts.push(randomPointIn(from.polygon, rng));
    pts.push(randomPointIn(to.polygon, rng));
    if (rng() < 0.6) pts.push(randomPointIn(to.polygon, rng));
    current = to;
  } else {
    for (let i = 0; i < n; i++) {
      current = rng() < 0.55 ? current : nextSurface(pool, pts[pts.length - 1] as V2, rng);
      pts.push(randomPointIn(current.polygon, rng));
    }
  }
  pts.push(pointOutside(current.polygon, rng, actor.sizeM * 1.5));

  // Smooth cubic segments (Catmull-Rom → Bézier) with time from arc length.
  const segments: RouteSegment[] = [];
  const pauses: Route['pauses'] = [];
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i] as V2;
    const p1 = pts[i + 1] as V2;
    const pm = pts[i - 1] ?? p0;
    const pp = pts[i + 2] ?? p1;
    const k = 0.35;
    const c0 = { x: p0.x + ((p1.x - pm.x) * k) / 2, y: p0.y + ((p1.y - pm.y) * k) / 2 };
    const c1 = { x: p1.x - ((pp.x - p0.x) * k) / 2, y: p1.y - ((pp.y - p0.y) * k) / 2 };
    const seg: RouteSegment = { t0: t, t1: t, p0, c0, c1, p1 };
    const len = segmentLength(seg);
    seg.t1 = t + (len / speed) * 1000;
    segments.push(seg);
    t = seg.t1;
    const [pmin, pmax] = actor.pauseSec;
    if (i < pts.length - 2 && pmax > 0) {
      const pause = (pmin + rng() * (pmax - pmin)) * 1000;
      const tan = bezierTangent(seg, 1);
      pauses.push({ t0: t, t1: t + pause, p: p1, angle: Math.atan2(tan.y, tan.x) });
      t += pause;
    }
  }
  return { delayMs, segments, pauses, totalMs: t, sizeM: actor.sizeM };
}

/** Pose of an actor at `elapsedMs` since the cue start. */
export function routePose(route: Route, elapsedMs: number): ActorPose {
  const t = elapsedMs - route.delayMs;
  const hidden: ActorPose = { x: 0, y: 0, angle: 0, moving: false, distance: 0, visible: false };
  if (t < 0 || t > route.totalMs || route.segments.length === 0) return hidden;
  let distance = 0;
  for (const seg of route.segments) {
    const segDur = seg.t1 - seg.t0;
    if (t <= seg.t1) {
      if (t < seg.t0) break;
      const u = segDur > 0 ? (t - seg.t0) / segDur : 1;
      // Approximate arc length progress (good enough for gait phase).
      const p = bezier(seg, u);
      const tan = bezierTangent(seg, u);
      distance += segmentLength(seg) * u;
      return { x: p.x, y: p.y, angle: Math.atan2(tan.y, tan.x), moving: true, distance, visible: true };
    }
    distance += segmentLength(seg);
    const pause = route.pauses.find((pp) => t >= pp.t0 && t <= pp.t1 && Math.abs(pp.t0 - seg.t1) < 1);
    if (pause)
      return { x: pause.p.x, y: pause.p.y, angle: pause.angle, moving: false, distance, visible: true };
  }
  return hidden;
}

export function actorCueDuration(surfaces: readonly Surface[], actor: ActorManifest, cue: ActorCue): number {
  let max = 0;
  for (let i = 0; i < cue.count; i++) {
    const r = buildActorRoute(surfaces, actor, cue, i);
    if (r) max = Math.max(max, r.delayMs + r.totalMs);
  }
  return max;
}

// ---------------------------------------------------------------------------
// Stage ambient: deterministic random actor runs without any messages
// ---------------------------------------------------------------------------
export function ambientActorCues(
  ambient: StageAmbient,
  surfaces: readonly Surface[],
  catalog: ThemeCatalog,
  now: number,
  lookBackMs = 180_000,
): ActorCue[] {
  if (!ambient.enabled || ambient.actors.length === 0 || surfaces.length === 0) return [];
  const gap =
    ((Math.min(ambient.minGapSec, ambient.maxGapSec) + Math.max(ambient.minGapSec, ambient.maxGapSec)) / 2) *
    1000;
  const spread = Math.abs(ambient.maxGapSec - ambient.minGapSec) * 1000;
  const out: ActorCue[] = [];
  const kNow = Math.floor(now / gap);
  const kMin = Math.floor((now - lookBackMs) / gap);
  // Surface layout hash keeps routes stable unless the layout changes.
  const layout = hashString(surfaces.map((s) => s.id).join(','));
  for (let k = kMin; k <= kNow + 1; k++) {
    const rng = createRng(hashInts(hashInts(ambient.seed, k), layout));
    const ref = ambient.actors[Math.floor(rng() * ambient.actors.length)];
    if (!ref) continue;
    const actor = catalog.get(ref.themeId)?.actors.find((a) => a.id === ref.actorId);
    if (!actor) continue;
    const startAt = k * gap + (rng() - 0.5) * spread * 0.5;
    const cue: ActorCue = {
      kind: 'actor',
      id: `amb-${k}`,
      themeId: ref.themeId,
      actorId: ref.actorId,
      count: rng() < 0.25 ? 2 : 1,
      speed: 0.8 + rng() * 0.5,
      fromSurfaceId: null,
      toSurfaceId: null,
      startAt,
      endAt: startAt,
      seed: Math.floor(rng() * 2 ** 31),
    };
    cue.endAt = startAt + actorCueDuration(surfaces, actor, cue);
    if (cue.endAt >= now - 1000 && startAt <= now + gap) out.push(cue);
  }
  return out;
}

/** Scheduling lead for cues from the measured RTTs of the outputs (D18: 150–400 ms). */
export function cueLeadMs(rtts: readonly number[]): number {
  if (rtts.length === 0) return 150;
  const worst = Math.max(...rtts);
  return Math.round(Math.min(400, Math.max(150, worst * 0.75 + 80)));
}

export function surfacesInViewport(state: Pick<SessionState, 'surfaces'>, vp: Viewport): Surface[] {
  const b = viewportBBox(vp);
  return state.surfaces.filter((s) => bboxIntersects(polygonBBox(s.polygon), b));
}

// ---------------------------------------------------------------------------
// World layout: one scene is a world spread over all surfaces; each surface shows its part.
// ---------------------------------------------------------------------------
export type WorldRole = 'main' | 'side' | 'ground' | 'ceiling';

/**
 * The surfaces that make up the given sides: the main wall, the walls right / left of it (they
 * join it in the unfolded layout) and the floor in front of it (laid out below it).
 */
export function surfacesForSides(surfaces: readonly Surface[], sides: readonly string[]): Surface[] {
  const lay = worldLayout(surfaces);
  const main = lay.find((w) => w.role === 'main');
  if (!main) return [];
  const m = main.rect;
  const ids = new Set<string>();
  // the side wall right (left) of the main wall: the nearest one on that side (laid out next to it,
  // gaps in the layout don't matter)
  const nearest = (right: boolean) =>
    lay
      .filter(
        (w) => w.role === 'side' && (right ? w.rect.x >= m.x + m.w - 0.3 : w.rect.x + w.rect.w <= m.x + 0.3),
      )
      .sort((a, b) => (right ? a.rect.x - b.rect.x : b.rect.x + b.rect.w - (a.rect.x + a.rect.w)))[0];
  for (const side of sides) {
    if (side === 'main') ids.add(main.id);
    if (side === 'right') {
      const w = nearest(true);
      if (w) ids.add(w.id);
    }
    if (side === 'left') {
      const w = nearest(false);
      if (w) ids.add(w.id);
    }
    for (const w of lay) {
      if (
        w.role === 'ground' &&
        side === 'floorFront' &&
        w.rect.x < m.x + m.w &&
        w.rect.x + w.rect.w > m.x &&
        w.rect.y >= m.y + m.h - 0.6
      )
        ids.add(w.id);
    }
  }
  return surfaces.filter((s) => ids.has(s.id));
}

export interface WorldSurface {
  id: string;
  kind: SurfaceKind;
  role: WorldRole;
  /** 0, 1, 2 … among surfaces with the same role (left to right). */
  roleIndex: number;
  rect: BBox;
}

/**
 * Deterministic role assignment: floors are ground; an explicit "main" wins; otherwise the first
 * wall (in stage order) is the main surface – it gets the centerpiece (the house) – and every
 * other wall is a side part. Same result on every client.
 */
export function worldLayout(surfaces: readonly Surface[]): WorldSurface[] {
  const explicitMain = surfaces.find((s) => s.role === 'main');
  let mainId = explicitMain?.id;
  if (!mainId) {
    const auto = surfaces.find((s) => (s.role ?? 'auto') === 'auto' && s.kind !== 'floor');
    mainId = auto?.id;
  }
  const out: WorldSurface[] = surfaces.map((s) => {
    const r = s.role ?? 'auto';
    const role: WorldRole =
      s.id === mainId
        ? 'main'
        : r === 'ceiling'
          ? 'ceiling'
          : r === 'ground' || (r === 'auto' && s.kind === 'floor')
            ? 'ground'
            : 'side';
    return { id: s.id, kind: s.kind, role, roleIndex: 0, rect: polygonBBox(s.polygon) };
  });
  for (const role of ['side', 'ground', 'ceiling'] as const) {
    out
      .filter((w) => w.role === role)
      .sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y)
      .forEach((w, i) => (w.roleIndex = i));
  }
  return out;
}

/** Horizontal extent of the wall ring (main + side) – the wrap period in room mode. */
export function wallRing(world: readonly WorldSurface[]): { x: number; w: number } | null {
  const walls = world.filter((w) => w.role === 'main' || w.role === 'side');
  if (!walls.length) return null;
  const x0 = Math.min(...walls.map((w) => w.rect.x));
  const x1 = Math.max(...walls.map((w) => w.rect.x + w.rect.w));
  return { x: x0, w: x1 - x0 };
}

/**
 * Tidy room layout: every surface gets the size of the main wall; walls in a row to the right of
 * the main wall (in their current order), floors below the main wall (one after another),
 * ceilings above it. Returns the new polygon per surface id.
 */
export function tidyRoom(surfaces: readonly Surface[]): Record<string, V2[]> {
  const lay = worldLayout(surfaces);
  const main = lay.find((x) => x.role === 'main');
  if (!main) return {};
  const { x: mx, y: my, w: W, h: H } = main.rect;
  const out: Record<string, V2[]> = {};
  const walls = lay.filter((x) => x.role === 'main' || x.role === 'side').sort((a, b) => a.rect.x - b.rect.x);
  const mi = walls.findIndex((w) => w.id === main.id);
  walls.forEach((w, i) => (out[w.id] = rectPolygon(mx + (i - mi) * W, my, W, H)));
  lay
    .filter((x) => x.role === 'ground')
    .forEach((g, i) => (out[g.id] = rectPolygon(mx, my + H * (1 + i), W, H)));
  lay
    .filter((x) => x.role === 'ceiling')
    .forEach((c, i) => (out[c.id] = rectPolygon(mx, my - H * (1 + i), W, H)));
  return out;
}
