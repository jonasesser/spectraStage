import type {
  ActorCue,
  Command,
  EffectCue,
  Output,
  Playback,
  Playlist,
  PlaylistItem,
  Profile,
  SessionState,
  Surface,
  Transition,
} from './schema.ts';
import { OWNER_ONLY } from './schema.ts';
import type { PlaylistTemplate, SurfaceKind, ThemeCatalog, ThemeManifest } from './theme.ts';
import { sanitizeParams } from './theme.ts';
import { isConvexQuad, UNIT_QUAD } from './homography.ts';
import { playlistPosition } from './playback.ts';
import {
  activeProfile,
  actorCueDuration,
  fitViewport,
  placeNewSurface,
  polygonBBox,
  worldLayout,
} from './stage.ts';
import {
  anchorWalls,
  arrangementPoses,
  boxCorner,
  boxFrame,
  poseForSurface,
  poseForWalls,
  poseTarget,
  roomFold,
  solveRoom,
  wallsName,
  type RoomWall,
} from './room.ts';

export class CommandError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Actor {
  id: string;
  name: string;
  role: 'owner' | 'controller';
}

export interface ReducerContext {
  now: number;
  actor: Actor;
  catalog: ThemeCatalog;
  newId: () => string;
  newSeed: () => number;
  /** Scheduling lead for cues (ms). */
  leadMs?: number;
}

export interface ReducerResult {
  state: SessionState;
  /** false when nothing persistent changed. */
  changed: boolean;
  identify?: { deviceId: string };
  revokeDevice?: string;
  revokeController?: string;
  approvedDevice?: string;
  summary: string;
}

export const LIMITS = {
  surfaces: 32,
  outputs: 16,
  playlists: 100,
  devices: 64,
  pendingDevices: 10,
  controllers: 16,
  cues: 40,
};

export const DEFAULT_TRANSITION: Transition = { type: 'crossfade', durationMs: 1500 };
export const DEFAULT_ASPECT = 16 / 9;

function fail(code: string, message: string): never {
  throw new CommandError(code, message);
}

function requireTheme(catalog: ThemeCatalog, themeId: string): ThemeManifest {
  return catalog.get(themeId) ?? fail('unknown_theme', `Unknown theme ${themeId}`);
}

function requireSurface(state: SessionState, surfaceId: string): Surface {
  return state.surfaces.find((s) => s.id === surfaceId) ?? fail('unknown_surface', 'Unknown surface');
}

function requireOutput(state: SessionState, outputId: string): Output {
  return state.outputs.find((o) => o.id === outputId) ?? fail('unknown_output', 'Unknown output');
}

function sceneOf(theme: ThemeManifest, sceneId: string) {
  return theme.scenes.find((s) => s.id === sceneId) ?? fail('unknown_scene', `Unknown scene ${sceneId}`);
}

export function templatePlaylistId(themeId: string, templateId: string): string {
  return `tpl-${themeId}-${templateId}`;
}

export function playlistFromTemplate(
  theme: ThemeManifest,
  template: PlaylistTemplate,
  id: string,
  newId: () => string,
  locale: 'en' | 'de' = 'de',
): Playlist {
  return {
    id,
    name: template.name[locale].slice(0, 60),
    kind: template.kind,
    loop: template.loop,
    items: template.items.map((it) => {
      const scene = sceneOf(theme, it.sceneId);
      return {
        id: newId(),
        scene: { themeId: theme.id, sceneId: it.sceneId, params: sanitizeParams(scene.params, it.params) },
        durationSec: it.durationSec,
        transition: it.transition,
        ambient: it.ambient
          ? {
              effects: it.ambient.effectIds.map((effectId) => ({ themeId: theme.id, effectId })),
              minGapSec: it.ambient.minGapSec,
              maxGapSec: it.ambient.maxGapSec,
            }
          : null,
      };
    }),
  };
}

function ensureTemplatePlaylist(
  state: SessionState,
  theme: ThemeManifest,
  templateId: string,
  ctx: ReducerContext,
): string {
  const id = templatePlaylistId(theme.id, templateId);
  if (!state.playlists.some((p) => p.id === id)) {
    const tpl =
      theme.playlistTemplates.find((t) => t.id === templateId) ??
      fail('unknown_template', 'Unknown template');
    if (state.playlists.length >= LIMITS.playlists) fail('limit', 'Too many playlists');
    state.playlists.push(playlistFromTemplate(theme, tpl, id, ctx.newId));
  }
  return id;
}

function scenePlayback(
  themeId: string,
  sceneId: string,
  params: Record<string, number | boolean | string>,
  ctx: ReducerContext,
  transition: Transition = DEFAULT_TRANSITION,
): Playback {
  return {
    mode: 'scene',
    scene: { themeId, sceneId, params },
    seed: ctx.newSeed(),
    startedAt: ctx.now,
    transition,
  };
}

/** How long a ghost needs to fly off and fade out (matches the renderer's exit). */
export const GHOST_EXIT_MS = 2500;

function playlistPlayback(playlistId: string, ctx: ReducerContext, startIndex = 0): Playback {
  return {
    mode: 'playlist',
    playlistId,
    anchorIndex: startIndex,
    anchorTime: ctx.now,
    pausedAt: null,
    seed: ctx.newSeed(),
  };
}

export function defaultPlayback(state: SessionState, kind: SurfaceKind, ctx: ReducerContext): Playback {
  const theme = ctx.catalog.get(state.defaultThemeId) ?? ctx.catalog.themes[0];
  if (!theme) fail('no_theme', 'No themes installed');
  const tplId = theme.autoPlaylists?.[kind];
  if (tplId) {
    const id = ensureTemplatePlaylist(state, theme, tplId, ctx);
    // Join the running playlist in lockstep so the whole stage stays one world.
    const running = state.surfaces.find(
      (x) => x.playback.mode === 'playlist' && x.playback.playlistId === id,
    );
    if (running) return structuredClone(running.playback);
    return playlistPlayback(id, ctx, 0);
  }
  const sceneId = theme.defaults[kind];
  return scenePlayback(theme.id, sceneId, sanitizeParams(sceneOf(theme, sceneId).params, undefined), ctx);
}

export function createSurface(
  state: SessionState,
  name: string,
  kind: SurfaceKind,
  ctx: ReducerContext,
  polygon?: { x: number; y: number }[],
): Surface {
  if (state.surfaces.length >= LIMITS.surfaces) fail('limit', 'Too many surfaces');
  const surface: Surface = {
    id: ctx.newId(),
    name,
    kind,
    polygon: polygon ?? placeNewSurface(state.surfaces, kind),
    playback: defaultPlayback(state, kind, ctx),
    intensity: 1,
  };
  state.surfaces.push(surface);
  return surface;
}

export function createProfile(ctx: ReducerContext, name: string, viewport: Profile['viewport']): Profile {
  return {
    id: ctx.newId(),
    name,
    referenceResolution: null,
    viewport,
    corners: structuredClone(UNIT_QUAD) as Profile['corners'],
    mesh: null,
    rotation: 0,
    flipX: false,
    flipY: false,
    crop: [0, 0, 0, 0],
    masks: [],
    updatedAt: ctx.now,
  };
}

export function createOutput(
  state: SessionState,
  name: string,
  viewport: Profile['viewport'],
  ctx: ReducerContext,
): Output {
  if (state.outputs.length >= LIMITS.outputs) fail('limit', 'Too many outputs');
  const profile = createProfile(ctx, 'Standard', viewport);
  const output: Output = {
    id: ctx.newId(),
    name,
    profiles: [profile],
    activeProfileId: profile.id,
    blackout: false,
    intensity: 1,
    volume: 0.8,
    failover: { mode: 'continue', afterSec: 120 },
    testPattern: { mode: 'grid', until: ctx.now + 10 * 60_000 },
    showMasks: false,
    resolutionMismatch: null,
  };
  state.outputs.push(output);
  return output;
}

/**
 * One planned projector per side of the room (main wall, the three other walls, floor, ceiling)
 * for every side that no projector points at yet. Returns how many were created.
 */
/**
 * After a measurement: solve all projectors with measured points together, and – when the room
 * is built around a single main wall – also its width and depth, which are then written to the
 * main wall (the walls the app adds around it follow).
 */
const dot3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/**
 * Sets the depth of the room: virtual side walls follow main.roomDepth, own side walls get the
 * width, own floors / ceilings the depth (from their edge at the front wall). The projectors stay
 * pinned to their corners – only the proportions of the pictures change, they still fill the sides.
 */
export function setRoomDepth(state: SessionState, depth: number): void {
  const lay = worldLayout(state.surfaces);
  const mainId = lay.find((w) => w.role === 'main')?.id;
  const main = state.surfaces.find((s) => s.id === mainId);
  if (!main) return;
  const fold = roomFold(state.surfaces);
  const mainFace = fold.faces.find((f) => f.id === main.id);
  const mb = polygonBBox(main.polygon);
  main.roomDepth = depth;
  for (const sf of state.surfaces) {
    if (sf === main) continue;
    const role = lay.find((x) => x.id === sf.id)?.role;
    const bb = polygonBBox(sf.polygon);
    const f = fold.faces.find((x) => x.id === sf.id);
    if (role === 'side' && f && mainFace && Math.abs(dot3(f.n, mainFace.ax)) > 0.9) {
      // a side wall: its width along the stage x is the depth (from its end at the front wall)
      const atFront = Math.abs(bb.x + bb.w - mb.x) < Math.abs(bb.x - (mb.x + mb.w));
      const k = depth / bb.w;
      const x0 = atFront ? bb.x + bb.w : bb.x;
      sf.polygon = sf.polygon.map((p) => ({ x: x0 + (p.x - x0) * k, y: p.y }));
    } else if (role === 'ground' || role === 'ceiling') {
      const k = depth / bb.h;
      const y0 = role === 'ground' ? bb.y : bb.y + bb.h;
      sf.polygon = sf.polygon.map((p) => ({ x: p.x, y: y0 + (p.y - y0) * k }));
    }
  }
}

/** Sets the width of the front wall; floors / ceilings along it follow, surfaces right of it move. */
export function setFrontWidth(state: SessionState, width: number): void {
  const lay = worldLayout(state.surfaces);
  const mainId = lay.find((w) => w.role === 'main')?.id;
  const main = state.surfaces.find((s) => s.id === mainId);
  if (!main) return;
  const mb = polygonBBox(main.polygon);
  const k = width / mb.w;
  const x0 = mb.x;
  const right = mb.x + mb.w;
  const delta = width - mb.w;
  for (const sf of state.surfaces) {
    const role = lay.find((x) => x.id === sf.id)?.role;
    const bb = polygonBBox(sf.polygon);
    if (sf === main || ((role === 'ground' || role === 'ceiling') && bb.x < right && bb.x + bb.w > x0))
      sf.polygon = sf.polygon.map((p) => ({ x: x0 + (p.x - x0) * k, y: p.y }));
    else if (bb.x >= right - 1e-6) sf.polygon = sf.polygon.map((p) => ({ x: p.x + delta, y: p.y }));
  }
}

export function solveMeasuredRoom(state: SessionState, quickFor: string | null = null): void {
  const fold = roomFold(state.surfaces);
  const lay = worldLayout(state.surfaces);
  const walls = lay.filter((w) => w.role === 'main' || w.role === 'side');
  const mainId = walls.find((w) => w.role === 'main')?.id;
  const main = state.surfaces.find((s) => s.id === mainId);
  const projectors = state.outputs
    .filter((o) => !quickFor || o.id === quickFor)
    .map((o) => {
      const prof = activeProfile(o);
      const ref = prof.referenceResolution;
      const start = prof.pose ?? poseForSurface(state.surfaces, null, new Set());
      return start && prof.anchors?.length
        ? { id: o.id, pose: start, aspect: ref ? ref.w / ref.h : 16 / 9, anchors: prof.anchors }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!projectors.length) return;
  // measuring only finds where the projectors stand – it never changes the size of the room or its
  // surfaces (that is set by the user: wall width / room depth)
  const r = solveRoom({ fold, sizeFree: false, projectors, quick: !!quickFor });
  for (const o of state.outputs) {
    const sol = r.poses[o.id];
    if (sol) activeProfile(o).pose = sol.pose;
  }
  if (r.size && main) {
    const b = polygonBBox(main.polygon);
    const k = r.size.w / b.w;
    const mainFace = fold.faces.find((f) => f.id === main.id);
    // own surfaces follow the measured room: side walls get its depth, a back wall its width,
    // floors/ceilings along the main wall its width; walls stay lined up as before
    const scaleX = (sf: Surface, nw: number, x0: number) => {
      const bb = polygonBBox(sf.polygon);
      const kk = nw / bb.w;
      sf.polygon = sf.polygon.map((pt) => ({ x: x0 + (pt.x - bb.x) * kk, y: pt.y }));
    };
    const ordered = walls
      .map((w) => ({ w, s: state.surfaces.find((x) => x.id === w.id)! }))
      .sort((a, c) => a.w.rect.x - c.w.rect.x);
    let prevEnd: number | null = null;
    let prevOldEnd = 0;
    for (const { w, s: sf } of ordered) {
      const f = fold.faces.find((x) => x.id === w.id);
      let nw = w.rect.w;
      if (sf === main) nw = r.size.w;
      else if (f && mainFace) {
        if (Math.abs(dot3(f.n, mainFace.ax)) > 0.9) nw = r.size.d;
        else if (dot3(f.n, mainFace.n) < -0.9) nw = r.size.w;
      }
      const x0: number = prevEnd === null ? w.rect.x : prevEnd + (w.rect.x - prevOldEnd);
      prevOldEnd = w.rect.x + w.rect.w;
      scaleX(sf, nw, x0);
      prevEnd = x0 + nw;
    }
    for (const sf of state.surfaces) {
      const role = lay.find((x) => x.id === sf.id)?.role;
      if (role !== 'ground' && role !== 'ceiling') continue;
      const bb = polygonBBox(sf.polygon);
      if (bb.x + bb.w <= b.x || bb.x >= b.x + b.w) continue;
      sf.polygon = sf.polygon.map((pt) => ({ x: b.x + (pt.x - b.x) * k, y: pt.y }));
    }
    main.roomDepth = r.size.d;
    // keep the stored room points of all measurements in step with the new size
    const box = boxFrame(roomFold(state.surfaces));
    if (box)
      for (const o of state.outputs) {
        const prof = activeProfile(o);
        prof.anchors = prof.anchors?.map((a) => {
          const parts = a.c.split('|');
          const p = parts[1] ? boxCorner(box, parts[1], box.w, box.d, box.h) : null;
          const q = parts[0] === 'e' && parts[2] ? boxCorner(box, parts[2], box.w, box.d, box.h) : null;
          return p ? { ...a, p, ...(q ? { q } : {}) } : a;
        });
      }
  }
}

export function planRoomOutputs(state: SessionState, ctx: ReducerContext): number {
  const fold = roomFold(state.surfaces);
  const covered = new Set<string>();
  for (const x of state.outputs) {
    const p = activeProfile(x).pose;
    const f = p ? poseTarget(fold, p) : null;
    if (f) covered.add(f);
  }
  const sideNames = [
    { en: 'right', de: 'Rechts' },
    { en: 'back', de: 'Hinten' },
    { en: 'left', de: 'Links' },
  ];
  let n = 0;
  const order = ['main', 'side', 'ground', 'ceiling'];
  const faces = [...fold.faces].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role));
  let side = 0;
  for (const f of faces) {
    const label =
      f.role === 'main'
        ? 'Vorne'
        : f.role === 'ground'
          ? 'Boden'
          : f.role === 'ceiling'
            ? 'Decke'
            : sideNames[side++ % 3]!.de;
    if (covered.has(f.id) || state.outputs.length >= LIMITS.outputs) continue;
    if (f.id === 'virtual:floorRest') continue;
    const o = createOutput(
      state,
      `Beamer ${label}`,
      { x: f.rect.x, y: f.rect.y, w: f.rect.w, h: f.rect.h },
      ctx,
    );
    activeProfile(o).pose = poseForSurface(state.surfaces, f.id, new Set());
    const wall: RoomWall | null =
      f.role === 'main'
        ? 'vorne'
        : f.role === 'ground'
          ? 'boden'
          : f.role === 'ceiling'
            ? 'decke'
            : ((['rechts', 'hinten', 'links'] as const)[(side - 1) % 3] ?? null);
    if (wall) activeProfile(o).walls = [wall];
    o.testPattern = { mode: 'off', until: 0 };
    covered.add(f.id);
    n++;
  }
  return n;
}

export function createInitialState(
  id: string,
  name: string,
  now: number,
  defaultThemeId: string,
  seed: number,
): SessionState {
  return {
    id,
    name,
    revision: 0,
    createdAt: now,
    kidsSafe: true,
    masterVolume: 0.8,
    muted: false,
    blackoutAll: false,
    defaultThemeId,
    surfaces: [],
    outputs: [],
    playlists: [],
    cues: [],
    ambient: { enabled: false, actors: [], minGapSec: 25, maxGapSec: 60, seed },
    devices: [],
    controllers: [],
    lastChange: null,
  };
}

function validatePlaylist(playlist: Playlist, catalog: ThemeCatalog): Playlist {
  return {
    ...playlist,
    items: playlist.items.map((item): PlaylistItem => {
      const theme = requireTheme(catalog, item.scene.themeId);
      const scene = sceneOf(theme, item.scene.sceneId);
      const ambient = item.ambient
        ? {
            ...item.ambient,
            effects: item.ambient.effects.filter(
              (e) => !!catalog.get(e.themeId)?.effects.some((x) => x.id === e.effectId),
            ),
          }
        : null;
      return {
        ...item,
        scene: { ...item.scene, params: sanitizeParams(scene.params, item.scene.params) },
        ambient,
        ...(item.cues
          ? {
              cues: item.cues
                .filter((c) => !!catalog.get(c.themeId)?.effects.some((x) => x.id === c.effectId))
                .filter((c) => c.atSec < item.durationSec)
                .sort((x, y) => x.atSec - y.atSec),
            }
          : {}),
      };
    }),
  };
}

function validateProfile(p: Profile): void {
  if (!isConvexQuad(p.corners)) fail('invalid_calibration', 'Corners must form a convex shape');
  if (p.mesh && p.mesh.offsets.length !== p.mesh.cols * p.mesh.rows)
    fail('invalid_calibration', 'Mesh size mismatch');
  for (const m of p.masks) {
    if (m.shape === 'polygon' && m.points.length < 3)
      fail('invalid_mask', 'Polygon masks need at least 3 points');
  }
  if (p.crop[0] + p.crop[2] >= 0.95 || p.crop[1] + p.crop[3] >= 0.95)
    fail('invalid_calibration', 'Crop too large');
}

/** Removes cues that ended (pure). */
export function pruneCues(state: SessionState, now: number): boolean {
  const before = state.cues.length;
  state.cues = state.cues.filter((c) => c.endAt > now);
  return state.cues.length !== before;
}

function names(list: readonly { id: string; name: string }[], ids: readonly string[]): string {
  return ids.map((id) => list.find((s) => s.id === id)?.name ?? '?').join(', ');
}

/**
 * Pure state transition. Never mutates the input. Revision handling is done by the caller.
 */
export function applyCommand(input: SessionState, cmd: Command, ctx: ReducerContext): ReducerResult {
  if (OWNER_ONLY.has(cmd.t) && ctx.actor.role !== 'owner')
    fail('forbidden', 'Only the show owner can do this');
  const state = structuredClone(input);
  pruneCues(state, ctx.now);
  const res = (summary: string, extra: Partial<ReducerResult> = {}): ReducerResult => {
    const changed = extra.changed ?? true;
    if (changed) state.lastChange = { actor: ctx.actor.name, at: ctx.now, summary };
    return { state: changed ? state : input, changed, summary, ...extra };
  };
  const surfaces = (ids: readonly string[]) => ids.map((id) => requireSurface(state, id));
  const outputs = (ids: readonly string[]) => ids.map((id) => requireOutput(state, id));
  const lead = ctx.leadMs ?? 200;

  switch (cmd.t) {
    case 'session.rename':
      state.name = cmd.name;
      return res('rename');
    case 'session.setKidsSafe':
      state.kidsSafe = cmd.on;
      return res(cmd.on ? 'child-safe on' : 'child-safe off');
    case 'session.setAudio':
      if (cmd.masterVolume !== undefined) state.masterVolume = cmd.masterVolume;
      if (cmd.muted !== undefined) state.muted = cmd.muted;
      return res('audio');
    case 'session.blackoutAll':
      state.blackoutAll = cmd.on;
      if (!cmd.on) for (const o of state.outputs) o.blackout = false;
      return res(cmd.on ? 'BLACKOUT all' : 'resume all');
    case 'session.setDefaultTheme':
      requireTheme(ctx.catalog, cmd.themeId);
      state.defaultThemeId = cmd.themeId;
      return res('default theme');
    case 'session.setRoom':
      state.room = cmd.room;
      return res(cmd.room ? 'room mode on' : 'room mode off');
    case 'room.resetSize': {
      setFrontWidth(state, 4);
      setRoomDepth(state, 4);
      return res('room back to standard size');
    }
    case 'facade.set': {
      const f = (state.facade ??= {});
      Object.assign(f, cmd.facade);
      if (f.door === null) delete f.door;
      return res('house front');
    }
    case 'facade.setFrame': {
      const f = (state.facade ??= {});
      (f.frame ??= {})[cmd.scene] = cmd.level;
      return res(`frame ${Math.round(cmd.level * 100)}% for ${cmd.scene}`);
    }
    case 'facade.edit':
      state.facadeEdit = cmd.on ? ctx.now + 30 * 60_000 : null;
      return res(cmd.on ? 'setting up the front' : 'front set');
    case 'room.setViewer': {
      if (cmd.viewer) state.viewer = cmd.viewer;
      else delete state.viewer;
      return res('audience standpoint');
    }
    case 'room.setWidth': {
      setFrontWidth(state, cmd.width);
      return res(`front wall ${cmd.width.toFixed(2)} m wide`);
    }
    case 'room.setDepth': {
      setRoomDepth(state, cmd.depth);
      return res(`room depth ${cmd.depth.toFixed(2)} m`);
    }
    case 'ghost.release': {
      // (plain photos never fly as ghosts)
      const have = new Set((state.ghosts ?? []).filter((g) => g.kind !== 'original').map((g) => g.id));
      // where each one rises (a group photo: everybody from their own place)
      const pick = cmd.ghostIds.map((g, i) => ({ g, u: cmd.u?.[i] })).filter((x) => have.has(x.g));
      if (!pick.length) fail('not_found', 'Unknown ghost');
      releaseGhosts(
        state,
        pick.map((x) => x.g),
        ctx,
        cmd.seconds ?? 35,
        cmd.u ? pick.map((x) => x.u) : undefined,
      );
      return res(`${pick.length} ghost(s) released`);
    }
    case 'ghost.delete':
      state.ghosts = (state.ghosts ?? []).filter((g) => g.id !== cmd.ghostId);
      state.ghostFlights = (state.ghostFlights ?? []).filter((f) => f.ghostId !== cmd.ghostId);
      return res('ghost deleted');
    case 'sound.choose': {
      const next = { ...(state.soundChoices ?? {}) };
      if (cmd.choice === null) delete next[cmd.slot];
      else next[cmd.slot] = cmd.choice;
      if (Object.keys(next).length > 200) fail('limit', 'Too many sound choices');
      state.soundChoices = next;
      return res(`sound ${cmd.slot} → ${cmd.choice ?? 'default'}`);
    }
    case 'sound.delete': {
      state.sounds = (state.sounds ?? []).filter((x) => x.id !== cmd.id);
      // where it was chosen: back to the default
      const next = { ...(state.soundChoices ?? {}) };
      for (const [k, v] of Object.entries(next)) if (v === `up:${cmd.id}`) delete next[k];
      state.soundChoices = next;
      return res('sound deleted');
    }
    case 'video.delete':
      state.videos = (state.videos ?? []).filter((v) => v.id !== cmd.id);
      return res('video deleted');
    case 'ghost.deleteAll':
      state.ghosts = [];
      state.ghostFlights = [];
      return res('all ghosts deleted');
    case 'ghost.stopFlights': {
      // they do not vanish: each one flies off upwards and fades out (the normal 2.5 s exit)
      const endAt = ctx.now + lead + GHOST_EXIT_MS;
      const hit = (f: { ghostId: string }) => !cmd.ghostIds || cmd.ghostIds.includes(f.ghostId);
      state.ghostFlights = (state.ghostFlights ?? [])
        .filter((f) => !hit(f) || f.startAt < ctx.now + lead)
        .map((f) => (hit(f) && f.endAt > endAt ? { ...f, endAt } : f));
      return res('ghosts back');
    }
    case 'object.create': {
      const list = (state.objects ??= []);
      if (list.length >= 24) fail('limit', 'Too many objects');
      const fold = roomFold(state.surfaces);
      const main = fold.faces.find((f) => f.role === 'main');
      // in front of the main wall, on the floor
      const pos: [number, number, number] = main
        ? [
            main.o[0] + main.ax[0] * (main.rect.w / 2) + main.n[0] * 1,
            0,
            main.o[2] + main.ax[2] * (main.rect.w / 2) + main.n[2] * 1,
          ]
        : [0, 0, 1];
      const o = {
        id: ctx.newId(),
        name: cmd.name,
        shape: cmd.shape,
        pos,
        size:
          cmd.size ??
          ((cmd.shape === 'box'
            ? [0.6, 0.6, 0.6]
            : cmd.shape === 'pumpkin'
              ? [0.35, 0.28, 0.35]
              : [0.4, 1.2, 0.4]) as [number, number, number]),
        yaw: main ? Math.atan2(main.ax[2], main.ax[0]) * -1 : 0,
        look: cmd.look ?? ('glow' as const),
        color: '#ff8a2e',
      };
      list.push(o);
      state.objectEdit = { id: o.id, until: ctx.now + 30 * 60_000 };
      return res(`object ${o.name} added`);
    }
    case 'object.update': {
      const o = state.objects?.find((x) => x.id === cmd.id) ?? fail('not_found', 'Unknown object');
      Object.assign(o, cmd.patch);
      return res(`object ${o.name} changed`);
    }
    case 'object.delete': {
      state.objects = (state.objects ?? []).filter((x) => x.id !== cmd.id);
      if (state.objectEdit?.id === cmd.id) state.objectEdit = null;
      return res('object removed');
    }
    case 'object.edit':
      state.objectEdit = cmd.id ? { id: cmd.id, until: ctx.now + 30 * 60_000 } : null;
      return res(cmd.id ? 'placing object' : 'object placed');
    case 'session.setBoost':
      state.boost = cmd.boost;
      return res(`dusk boost ${Math.round(cmd.boost * 100)}%`);
    case 'session.setSchedule': {
      for (const e of cmd.schedule.entries) {
        if (e.themeId && e.presetId) {
          const t = requireTheme(ctx.catalog, e.themeId);
          if (!t.presets.some((p) => p.id === e.presetId)) fail('unknown_preset', 'Unknown preset');
        }
        if (e.playlistId && !state.playlists.some((p) => p.id === e.playlistId))
          fail('unknown_playlist', 'Unknown playlist');
        if (e.insert) sceneOf(requireTheme(ctx.catalog, e.insert.themeId), e.insert.sceneId);
      }
      // The running entry keeps running when other entries are edited (no restart); an edited or
      // removed running entry is re-evaluated at once. A play-in already done is not repeated.
      const prev = state.schedule;
      const runId = prev?.lastApplied?.split('|')[1];
      const before = prev?.entries.find((e) => e.id === runId);
      const after = cmd.schedule.entries.find((e) => e.id === runId);
      const keep = !!before && !!after && JSON.stringify(before) === JSON.stringify(after);
      state.schedule = {
        ...cmd.schedule,
        lastApplied: keep ? (prev?.lastApplied ?? null) : null,
        lastInserted: prev?.lastInserted ?? null,
      };
      return res(cmd.schedule.enabled ? 'schedule on' : 'schedule off');
    }
    case 'session.setAmbient': {
      for (const a of cmd.ambient.actors) {
        const t = requireTheme(ctx.catalog, a.themeId);
        const am = t.actors.find((x) => x.id === a.actorId) ?? fail('unknown_actor', 'Unknown actor');
        if (state.kidsSafe && !am.childSafe) fail('child_safe', 'Actor blocked by child-safe mode');
      }
      state.ambient = { ...cmd.ambient, seed: state.ambient.seed };
      return res(cmd.ambient.enabled ? 'ambient actors on' : 'ambient actors off');
    }

    case 'surface.create': {
      const s = createSurface(state, cmd.name, cmd.kind, ctx, cmd.polygon);
      return res(`surface ${s.name} created`);
    }
    case 'surface.update': {
      const s = requireSurface(state, cmd.surfaceId);
      if (cmd.name !== undefined) s.name = cmd.name;
      if (cmd.kind !== undefined) s.kind = cmd.kind;
      if (cmd.intensity !== undefined) s.intensity = cmd.intensity;
      if (cmd.polygon !== undefined) s.polygon = cmd.polygon;
      if (cmd.role !== undefined) s.role = cmd.role;
      return res(`${s.name} updated`);
    }
    case 'surface.delete': {
      requireSurface(state, cmd.surfaceId);
      state.surfaces = state.surfaces.filter((s) => s.id !== cmd.surfaceId);
      return res('surface deleted');
    }
    case 'surface.insert': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const scene = sceneOf(theme, cmd.sceneId);
      const params = sanitizeParams(scene.params, cmd.params);
      const speed = typeof params.speed === 'number' && params.speed > 0 ? params.speed : 1;
      const seed = ctx.newSeed();
      const startedAt = ctx.now + lead;
      const endAt = startedAt + ((cmd.sec ?? scene.oneShotSec ?? 60) * 1000) / speed;
      for (const s of surfaces(cmd.surfaceIds))
        s.insert = {
          id: `${seed.toString(36)}${state.surfaces.indexOf(s)}`,
          scene: { themeId: theme.id, sceneId: scene.id, params },
          seed: seed + state.surfaces.indexOf(s),
          startedAt,
          endAt,
        };
      return res(`${scene.name.en} played in → ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'surface.setScene': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const scene = sceneOf(theme, cmd.sceneId);
      const seed = ctx.newSeed();
      for (const s of surfaces(cmd.surfaceIds)) {
        s.playback = {
          mode: 'scene',
          scene: { themeId: theme.id, sceneId: scene.id, params: sanitizeParams(scene.params, cmd.params) },
          seed: seed + state.surfaces.indexOf(s),
          startedAt: ctx.now + lead,
          transition: cmd.transition ?? DEFAULT_TRANSITION,
        };
      }
      return res(`${scene.name.en} → ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'scene.setParamsEverywhere': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const scene = sceneOf(theme, cmd.sceneId);
      const same = (r: { themeId: string; sceneId: string }) =>
        r.themeId === theme.id && r.sceneId === scene.id;
      for (const pl of state.playlists)
        for (const it of pl.items)
          if (same(it.scene))
            it.scene.params = sanitizeParams(scene.params, { ...it.scene.params, ...cmd.params });
      for (const s of state.surfaces)
        if (s.playback.mode === 'scene' && same(s.playback.scene))
          s.playback.scene.params = sanitizeParams(scene.params, {
            ...s.playback.scene.params,
            ...cmd.params,
          });
      return res(`${scene.name.en} settings (everywhere)`);
    }
    case 'surface.resetProgram': {
      for (const s of surfaces(cmd.surfaceIds)) {
        // join whatever playlist the other sides run (lockstep) – else the theme's default
        const running = state.surfaces.find((x) => x !== s && x.playback.mode === 'playlist');
        s.playback = running ? structuredClone(running.playback) : defaultPlayback(state, s.kind, ctx);
        delete s.insert;
      }
      return res(`back to the programme → ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'surface.setParams': {
      const s = requireSurface(state, cmd.surfaceId);
      let ref = s.playback.mode === 'scene' ? s.playback.scene : null;
      if (s.playback.mode === 'playlist') {
        const pb = s.playback;
        const pl = state.playlists.find((p) => p.id === pb.playlistId);
        ref = (pl ? playlistPosition(pl, pb, ctx.now) : null)?.item.scene ?? null;
      }
      if (!ref) fail('no_scene', 'No active scene');
      const theme = requireTheme(ctx.catalog, ref.themeId);
      const scene = sceneOf(theme, ref.sceneId);
      const params = sanitizeParams(scene.params, { ...ref.params, ...cmd.params });
      if (s.playback.mode === 'scene') s.playback.scene.params = params;
      else s.playback = scenePlayback(theme.id, scene.id, params, ctx, { type: 'cut', durationMs: 0 });
      return res(`${s.name} params`);
    }
    case 'surface.playPlaylist': {
      const pl =
        state.playlists.find((p) => p.id === cmd.playlistId) ?? fail('unknown_playlist', 'Unknown playlist');
      if (pl.items.length === 0) fail('empty_playlist', 'Playlist is empty');
      const start = Math.min(cmd.startIndex ?? 0, pl.items.length - 1);
      for (const s of surfaces(cmd.surfaceIds))
        s.playback = playlistPlayback(pl.id, { ...ctx, now: ctx.now + lead }, start);
      return res(`playlist ${pl.name} → ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'surface.skip': {
      const at = ctx.now + lead;
      for (const s of surfaces(cmd.surfaceIds)) {
        const pb = s.playback;
        if (pb.mode === 'playlist') {
          const pl = state.playlists.find((p) => p.id === pb.playlistId);
          if (!pl || pl.items.length === 0) continue;
          const pos = playlistPosition(pl, pb, ctx.now);
          const len = pl.items.length;
          let next = (pos?.index ?? 0) + cmd.direction;
          next = pl.loop ? (next + len) % len : Math.max(0, Math.min(len - 1, next));
          s.playback = {
            ...pb,
            anchorIndex: next,
            anchorTime: at,
            pausedAt: pb.pausedAt === null ? null : at,
          };
        } else {
          const theme = ctx.catalog.get(pb.scene.themeId);
          if (!theme) continue;
          const list = theme.scenes.filter((sc) => sc.kinds.includes(s.kind));
          const pool = list.length > 0 ? list : theme.scenes;
          const idx = pool.findIndex((sc) => sc.id === pb.scene.sceneId);
          const next = pool[(idx + cmd.direction + pool.length) % pool.length]!;
          s.playback = scenePlayback(theme.id, next.id, sanitizeParams(next.params, undefined), {
            ...ctx,
            now: at,
          });
        }
      }
      return res(`skip ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'surface.pause': {
      for (const s of surfaces(cmd.surfaceIds)) {
        const pb = s.playback;
        if (pb.mode !== 'playlist') continue;
        if (cmd.paused && pb.pausedAt === null) s.playback = { ...pb, pausedAt: ctx.now };
        if (!cmd.paused && pb.pausedAt !== null)
          s.playback = { ...pb, anchorTime: pb.anchorTime + (ctx.now - pb.pausedAt), pausedAt: null };
      }
      return res(`${cmd.paused ? 'pause' : 'play'} ${names(state.surfaces, cmd.surfaceIds)}`);
    }

    case 'output.update': {
      const o = requireOutput(state, cmd.outputId);
      if (cmd.name !== undefined) o.name = cmd.name;
      if (cmd.intensity !== undefined) o.intensity = cmd.intensity;
      if (cmd.volume !== undefined) o.volume = cmd.volume;
      if (cmd.failover !== undefined) o.failover = cmd.failover;
      if (cmd.showMasks !== undefined) o.showMasks = cmd.showMasks;
      if (cmd.performance !== undefined) o.performance = cmd.performance;
      if (cmd.renderMode !== undefined) o.renderMode = cmd.renderMode;
      if (cmd.diag !== undefined) o.diagUntil = cmd.diag ? ctx.now + 5 * 60_000 : 0;
      return res(`${o.name} updated`);
    }
    case 'output.blackout': {
      for (const o of outputs(cmd.outputIds)) o.blackout = cmd.on;
      return res(`${cmd.on ? 'blackout' : 'resume'} ${names(state.outputs, cmd.outputIds)}`);
    }
    case 'output.testPattern': {
      const o = requireOutput(state, cmd.outputId);
      o.testPattern = {
        mode: cmd.mode,
        until: cmd.mode === 'off' ? 0 : ctx.now + (cmd.minutes ?? 10) * 60_000,
      };
      return res(`${o.name} test pattern ${cmd.mode}`);
    }
    case 'output.saveProfile': {
      const o = requireOutput(state, cmd.outputId);
      validateProfile(cmd.profile);
      const p = { ...cmd.profile, updatedAt: ctx.now };
      const idx = o.profiles.findIndex((x) => x.id === p.id);
      if (idx >= 0) o.profiles[idx] = p;
      else {
        if (o.profiles.length >= 10) fail('limit', 'Too many profiles');
        o.profiles.push(p);
      }
      if (cmd.activate) o.activeProfileId = p.id;
      if (o.activeProfileId === p.id && p.referenceResolution) o.resolutionMismatch = null;
      return res(`${o.name} calibration saved`);
    }
    case 'output.activateProfile': {
      const o = requireOutput(state, cmd.outputId);
      if (!o.profiles.some((p) => p.id === cmd.profileId)) fail('unknown_profile', 'Unknown profile');
      o.activeProfileId = cmd.profileId;
      o.resolutionMismatch = null;
      return res(`${o.name} profile switched`);
    }
    case 'output.duplicateProfile': {
      const o = requireOutput(state, cmd.outputId);
      const p = o.profiles.find((x) => x.id === cmd.profileId) ?? fail('unknown_profile', 'Unknown profile');
      if (o.profiles.length >= 10) fail('limit', 'Too many profiles');
      o.profiles.push({
        ...structuredClone(p),
        id: ctx.newId(),
        name: `${p.name} (2)`.slice(0, 60),
        updatedAt: ctx.now,
      });
      return res(`${o.name} profile duplicated`);
    }
    case 'output.deleteProfile': {
      const o = requireOutput(state, cmd.outputId);
      if (o.profiles.length <= 1) fail('last_profile', 'An output needs at least one profile');
      o.profiles = o.profiles.filter((p) => p.id !== cmd.profileId);
      if (o.activeProfileId === cmd.profileId) o.activeProfileId = o.profiles[0]!.id;
      return res(`${o.name} profile deleted`);
    }
    case 'output.acceptResolution': {
      const o = requireOutput(state, cmd.outputId);
      if (!o.resolutionMismatch) return res('noop', { changed: false });
      const p = activeProfile(o);
      p.referenceResolution = { w: o.resolutionMismatch.w, h: o.resolutionMismatch.h };
      o.resolutionMismatch = null;
      return res(`${o.name} resolution accepted`);
    }
    case 'output.setPose': {
      const o = requireOutput(state, cmd.outputId);
      activeProfile(o).pose = cmd.pose;
      return res(`${o.name} aimed`);
    }
    case 'output.setAnchors': {
      const o = requireOutput(state, cmd.outputId);
      const pr = activeProfile(o);
      pr.anchors = cmd.anchors;
      // measuring in the room replaces an earlier flat 2D corner correction (it would distort twice)
      if (cmd.anchors.length) {
        pr.corners = structuredClone(UNIT_QUAD) as Profile['corners'];
        pr.fold = null;
        pr.mesh = null;
      }
      solveMeasuredRoom(state, cmd.quick ? o.id : null);
      return res(`${o.name}: ${cmd.anchors.length} points measured`);
    }
    case 'output.setWalls': {
      const o = requireOutput(state, cmd.outputId);
      const prof = activeProfile(o);
      const order = ['links', 'vorne', 'rechts', 'hinten', 'boden', 'decke'];
      const walls = [...new Set(cmd.walls)].sort((a, b) => order.indexOf(a) - order.indexOf(b));
      prof.walls = walls;
      if (!walls.length) return res(`${o.name}: no sides`);
      const ref = prof.referenceResolution;
      const pose = poseForWalls(roomFold(state.surfaces), walls, ref ? ref.w / ref.h : 16 / 9);
      if (!pose) return res(`${o.name}: these sides cannot be covered by one projector`);
      prof.pose = pose;
      // corners already measured on sides that stay chosen are kept (adding the left wall to the
      // front wall only adds the left wall's corners); "from scratch" drops everything
      const keep = cmd.reset
        ? []
        : (prof.anchors ?? []).filter((a) => anchorWalls(a.c).some((w) => walls.includes(w)));
      prof.anchors = keep;
      if (cmd.reset) {
        prof.corners = structuredClone(UNIT_QUAD) as Profile['corners'];
        prof.fold = null;
        prof.mesh = null;
      }
      if (keep.length) solveMeasuredRoom(state, o.id);
      if (/^Beamer( |$)/.test(o.name) || /^Projector/.test(o.name)) o.name = wallsName(walls);
      return res(`${o.name}: covers ${walls.join(', ')}`);
    }
    case 'output.setMount': {
      const o = requireOutput(state, cmd.outputId);
      const prof = activeProfile(o);
      prof.rotation = cmd.mount === 'ceiling' ? 180 : 0;
      prof.flipX = cmd.mount === 'rear';
      prof.flipY = cmd.mount === 'ceilingRear';
      return res(`${o.name} mounted ${cmd.mount}`);
    }
    case 'output.setProportions': {
      const o = requireOutput(state, cmd.outputId);
      activeProfile(o).proportions = cmd.proportions;
      return res(`${o.name}: proportions`);
    }
    case 'output.setZoom': {
      const o = requireOutput(state, cmd.outputId);
      activeProfile(o).zoom = cmd.zoom;
      return res(`${o.name}: picture squeezed/stretched`);
    }
    case 'output.align': {
      const o = requireOutput(state, cmd.outputId);
      o.align = cmd.on ? { until: ctx.now + 30 * 60_000, sel: cmd.sel, mark: cmd.mark ?? null } : undefined;
      return res(`${o.name} ${cmd.on ? 'measuring corners' : 'measuring done'}`);
    }
    case 'output.create': {
      // aim at the first room side that no projector covers yet (main wall, floor, sides, ceiling)
      const fold = roomFold(state.surfaces);
      const covered = new Set<string>();
      for (const x of state.outputs) {
        const p = activeProfile(x).pose;
        const f = p ? poseTarget(fold, p) : null;
        if (f) covered.add(f);
      }
      const o = createOutput(state, cmd.name, { x: 0, y: 0, w: 4, h: 2.25 }, ctx);
      const pose = poseForSurface(state.surfaces, null, covered);
      if (pose) activeProfile(o).pose = pose;
      return res(`${o.name} planned`);
    }
    case 'output.planRoom': {
      const n = planRoomOutputs(state, ctx);
      return res(`${n} projectors planned`);
    }
    case 'output.setViewport': {
      const o = requireOutput(state, cmd.outputId);
      activeProfile(o).viewport = cmd.viewport;
      return res(`${o.name} placed`);
    }
    case 'output.arrange': {
      const slots = arrangementPoses(state.surfaces, cmd.layout);
      const live = (o: Output) => state.devices.some((d) => d.outputId === o.id && d.status === 'approved');
      // connected projectors take the first slots, then planned ones; the rest of the planned go
      const ordered = [...state.outputs.filter(live), ...state.outputs.filter((o) => !live(o))];
      const fold = roomFold(state.surfaces);
      ordered.forEach((o, i) => {
        const slot = slots[i];
        if (slot) {
          o.name = slot.name;
          activeProfile(o).pose = slot.pose;
          if (slot.walls) activeProfile(o).walls = slot.walls;
          activeProfile(o).anchors = [];
        } else if (!live(o)) {
          state.outputs = state.outputs.filter((x) => x.id !== o.id);
        }
      });
      for (const slot of slots.slice(ordered.length)) {
        if (state.outputs.length >= LIMITS.outputs) break;
        const f = fold.faces.find((x) => x.id === slot.faceId);
        const o = createOutput(state, slot.name, f ? { ...f.rect } : { x: 0, y: 0, w: 4, h: 2.25 }, ctx);
        activeProfile(o).pose = slot.pose;
        if (slot.walls) activeProfile(o).walls = slot.walls;
        o.testPattern = { mode: 'off', until: 0 };
      }
      return res(`${slots.length} projectors arranged`);
    }
    case 'output.delete': {
      requireOutput(state, cmd.outputId);
      state.outputs = state.outputs.filter((o) => o.id !== cmd.outputId);
      for (const d of state.devices) if (d.outputId === cmd.outputId) d.outputId = null;
      return res('output deleted');
    }

    case 'preset.apply': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const preset =
        theme.presets.find((p) => p.id === cmd.presetId) ?? fail('unknown_preset', 'Unknown preset');
      const targets = cmd.surfaceIds ? surfaces(cmd.surfaceIds) : state.surfaces;
      const at = { ...ctx, now: ctx.now + lead };
      for (const s of targets) {
        const a = preset.assignments[s.kind] ?? preset.assignments.other ?? preset.assignments.wall;
        if (!a) continue;
        if (a.playlistTemplateId) {
          const id = ensureTemplatePlaylist(state, theme, a.playlistTemplateId, ctx);
          // All surfaces run in lockstep: scene changes and dark phases happen everywhere at once.
          s.playback = playlistPlayback(id, at, 0);
        } else if (a.sceneId) {
          const scene = sceneOf(theme, a.sceneId);
          s.playback = scenePlayback(theme.id, scene.id, sanitizeParams(scene.params, a.params), at, {
            type: 'crossfade',
            durationMs: 2500,
          });
        }
      }
      if (preset.ambientActors && !cmd.surfaceIds) {
        const actors = preset.ambientActors
          .filter((id) => theme.actors.some((a) => a.id === id && (a.childSafe || !state.kidsSafe)))
          .map((actorId) => ({ themeId: theme.id, actorId }));
        state.ambient = { ...state.ambient, enabled: actors.length > 0, actors };
      }
      return res(`preset ${preset.name.en}`);
    }
    case 'playlist.save': {
      const pl = validatePlaylist(cmd.playlist, ctx.catalog);
      const idx = state.playlists.findIndex((p) => p.id === pl.id);
      if (idx >= 0) state.playlists[idx] = pl;
      else {
        if (state.playlists.length >= LIMITS.playlists) fail('limit', 'Too many playlists');
        state.playlists.push(pl);
      }
      return res(`playlist ${pl.name} saved`);
    }
    case 'playlist.delete': {
      state.playlists = state.playlists.filter((p) => p.id !== cmd.playlistId);
      for (const s of state.surfaces) {
        if (s.playback.mode === 'playlist' && s.playback.playlistId === cmd.playlistId) {
          const theme = ctx.catalog.get(state.defaultThemeId) ?? ctx.catalog.themes[0];
          if (theme) {
            const sceneId = theme.defaults[s.kind];
            s.playback = scenePlayback(
              theme.id,
              sceneId,
              sanitizeParams(sceneOf(theme, sceneId).params, undefined),
              ctx,
            );
          }
        }
      }
      return res('playlist deleted');
    }
    case 'playlist.duplicate': {
      const pl =
        state.playlists.find((p) => p.id === cmd.playlistId) ?? fail('unknown_playlist', 'Unknown playlist');
      if (state.playlists.length >= LIMITS.playlists) fail('limit', 'Too many playlists');
      const copy: Playlist = {
        ...structuredClone(pl),
        id: ctx.newId(),
        name: `${pl.name} (2)`.slice(0, 60),
        items: pl.items.map((it) => ({ ...structuredClone(it), id: ctx.newId() })),
      };
      state.playlists.push(copy);
      return res(`playlist ${copy.name} created`);
    }
    case 'playlist.fromTemplate': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const tpl =
        theme.playlistTemplates.find((t) => t.id === cmd.templateId) ??
        fail('unknown_template', 'Unknown template');
      if (state.playlists.length >= LIMITS.playlists) fail('limit', 'Too many playlists');
      const stable = templatePlaylistId(theme.id, tpl.id);
      const id = state.playlists.some((p) => p.id === stable) ? ctx.newId() : stable;
      state.playlists.push(playlistFromTemplate(theme, tpl, id, ctx.newId));
      return res('playlist from template');
    }

    case 'effect.fire': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const eff =
        theme.effects.find((e) => e.id === cmd.effectId) ?? fail('unknown_effect', 'Unknown effect');
      if (state.kidsSafe && !eff.childSafe) fail('child_safe', 'Effect blocked by child-safe mode');
      surfaces(cmd.surfaceIds);
      if (state.cues.length >= LIMITS.cues) fail('limit', 'Too many active effects');
      const startAt = ctx.now + lead;
      const cue: EffectCue = {
        kind: 'effect',
        id: ctx.newId(),
        themeId: theme.id,
        effectId: eff.id,
        surfaceIds: [...cmd.surfaceIds],
        startAt,
        endAt: startAt + eff.durationMs,
        seed: ctx.newSeed(),
        params: cmd.params ?? {},
      };
      state.cues.push(cue);
      return res(`effect ${eff.name.en} → ${names(state.surfaces, cmd.surfaceIds)}`);
    }
    case 'actor.spawn': {
      const theme = requireTheme(ctx.catalog, cmd.themeId);
      const actor = theme.actors.find((a) => a.id === cmd.actorId) ?? fail('unknown_actor', 'Unknown actor');
      if (state.kidsSafe && !actor.childSafe) fail('child_safe', 'Actor blocked by child-safe mode');
      if (state.surfaces.length === 0) fail('no_surfaces', 'Create a surface first');
      if (cmd.fromSurfaceId) requireSurface(state, cmd.fromSurfaceId);
      if (cmd.toSurfaceId) requireSurface(state, cmd.toSurfaceId);
      if (state.cues.length >= LIMITS.cues) fail('limit', 'Too many active cues');
      const startAt = ctx.now + lead;
      const cue: ActorCue = {
        kind: 'actor',
        id: ctx.newId(),
        themeId: theme.id,
        actorId: actor.id,
        count: cmd.count,
        speed: cmd.speed,
        fromSurfaceId: cmd.fromSurfaceId,
        toSurfaceId: cmd.toSurfaceId,
        startAt,
        endAt: startAt,
        seed: ctx.newSeed(),
      };
      cue.endAt = startAt + Math.max(1000, actorCueDuration(state.surfaces, actor, cue));
      state.cues.push(cue);
      return res(`${actor.name.en} ×${cmd.count}`);
    }
    case 'cue.stop': {
      state.cues = cmd.cueId ? state.cues.filter((c) => c.id !== cmd.cueId) : [];
      return res('cues stopped');
    }

    case 'device.approve': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      if (d.status !== 'pending') fail('not_pending', 'Device is not pending');
      let outputId = cmd.outputId ?? null;
      if (outputId) requireOutput(state, outputId);
      else {
        const spec = cmd.newOutput ?? { name: d.name };
        let surface: Surface | undefined;
        if (spec.surfaceId) surface = requireSurface(state, spec.surfaceId);
        else
          surface = createSurface(
            state,
            spec.newSurface?.name ?? spec.name,
            spec.newSurface?.kind ?? 'wall',
            ctx,
          );
        const vp = fitViewport(polygonBBox(surface.polygon), DEFAULT_ASPECT);
        const out = createOutput(state, spec.name, vp, ctx);
        // the projector in the room points at its surface
        activeProfile(out).pose = poseForSurface(state.surfaces, surface.id, new Set());
        outputId = out.id;
      }
      for (const other of state.devices) if (other.outputId === outputId) other.outputId = null;
      d.status = 'approved';
      d.outputId = outputId;
      return res(`device ${d.name} approved`, { approvedDevice: d.id });
    }
    case 'device.reject': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      state.devices = state.devices.filter((x) => x.id !== d.id);
      return res(`device ${d.name} rejected`, { revokeDevice: d.id });
    }
    case 'device.remove': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      state.devices = state.devices.filter((x) => x.id !== d.id);
      return res(`device ${d.name} removed`, { revokeDevice: d.id });
    }
    case 'device.rename': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      d.name = cmd.name;
      return res('device renamed');
    }
    case 'device.assign': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      if (d.status !== 'approved') fail('not_approved', 'Device not approved');
      if (cmd.outputId) {
        requireOutput(state, cmd.outputId);
        for (const other of state.devices) if (other.outputId === cmd.outputId) other.outputId = null;
      }
      d.outputId = cmd.outputId;
      return res(`device ${d.name} assigned`);
    }
    case 'device.identify': {
      const d = state.devices.find((x) => x.id === cmd.deviceId) ?? fail('unknown_device', 'Unknown device');
      return res('identify', { changed: false, identify: { deviceId: d.id } });
    }
    case 'controller.remove': {
      const c =
        state.controllers.find((x) => x.id === cmd.controllerId) ??
        fail('unknown_controller', 'Unknown controller');
      if (c.role === 'owner') fail('forbidden', 'The owner cannot be removed');
      state.controllers = state.controllers.filter((x) => x.id !== c.id);
      return res(`controller ${c.name} removed`, { revokeController: c.id });
    }
  }
}

/**
 * Server-side reaction to a device's reported resolution (not a user command).
 * Returns true if the state changed.
 */
export function applyReportedResolution(
  state: SessionState,
  outputId: string,
  w: number,
  h: number,
): boolean {
  const o = state.outputs.find((x) => x.id === outputId);
  if (!o || w <= 0 || h <= 0) return false;
  const p = activeProfile(o);
  if (!p.referenceResolution) {
    p.referenceResolution = { w, h };
    // Adapt the viewport aspect to the projector, keeping its center and width.
    const cy = p.viewport.y + p.viewport.h / 2;
    const vh = p.viewport.w * (h / w);
    p.viewport = { x: p.viewport.x, y: cy - vh / 2, w: p.viewport.w, h: vh };
    return true;
  }
  // Calibration is stored in normalized coordinates, so only a changed aspect ratio invalidates it
  // (e.g. 16:9 → 16:10 or 4:3). Small differences (rounding, scaling) are tolerated.
  const refAspect = p.referenceResolution.w / p.referenceResolution.h;
  const mismatch = Math.abs(w / h - refAspect) / refAspect > 0.03;
  // Nothing calibrated yet (corners untouched): just take the new format instead of going black.
  const untouched =
    JSON.stringify(p.corners) === JSON.stringify(UNIT_QUAD) &&
    !p.mesh &&
    !p.fold &&
    p.crop.every((c) => c === 0);
  if (mismatch && untouched) {
    p.referenceResolution = { w, h };
    o.resolutionMismatch = null;
    return true;
  }
  if (mismatch && (o.resolutionMismatch?.w !== w || o.resolutionMismatch?.h !== h)) {
    o.resolutionMismatch = { w, h };
    return true;
  }
  if (!mismatch && o.resolutionMismatch) {
    o.resolutionMismatch = null;
    return true;
  }
  return false;
}

/** Mount of a projector from its picture orientation (see output.setMount). */
export function mountOf(
  p: Pick<Profile, 'rotation' | 'flipX' | 'flipY'>,
): 'front' | 'ceiling' | 'rear' | 'ceilingRear' | 'other' {
  if (p.rotation === 0 && !p.flipX && !p.flipY) return 'front';
  if (p.rotation === 180 && !p.flipX && !p.flipY) return 'ceiling';
  if (p.rotation === 0 && p.flipX && !p.flipY) return 'rear';
  if (p.rotation === 0 && !p.flipX && p.flipY) return 'ceilingRear';
  return 'other';
}

/** Ghost photos fly around (staggered by 1.2 s); finished and too many flights are dropped. */
export function releaseGhosts(
  state: SessionState,
  ghostIds: readonly string[],
  ctx: ReducerContext,
  seconds = 35,
  u?: number | readonly (number | undefined)[],
): void {
  const flights = (state.ghostFlights ?? []).filter((f) => f.endAt > ctx.now);
  ghostIds.forEach((ghostId, i) => {
    const startAt = ctx.now + i * 350;
    flights.push({
      id: ctx.newId(),
      ghostId,
      startAt,
      endAt: startAt + seconds * 1000,
      seed: ctx.newSeed() % 100000,
      ...((typeof u === 'number' ? u : u?.[i]) !== undefined
        ? { u: typeof u === 'number' ? u : u![i]! }
        : {}),
    });
  });
  state.ghostFlights = flights.slice(-16);
}
