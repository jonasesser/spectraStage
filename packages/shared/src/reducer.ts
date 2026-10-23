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
import { activeProfile, actorCueDuration, fitViewport, placeNewSurface, polygonBBox } from './stage.ts';

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
    // Stagger surfaces that run the same playlist so they don't all show the same scene.
    const sameKind = state.surfaces.filter(
      (x) => x.playback.mode === 'playlist' && x.playback.playlistId === id,
    ).length;
    const len = state.playlists.find((p) => p.id === id)?.items.length ?? 1;
    return playlistPlayback(id, ctx, sameKind % Math.max(1, len));
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
    case 'session.setBoost':
      state.boost = cmd.boost;
      return res(`dusk boost ${Math.round(cmd.boost * 100)}%`);
    case 'session.setSchedule': {
      for (const e of cmd.schedule.entries) {
        if (e.themeId && e.presetId) {
          const t = requireTheme(ctx.catalog, e.themeId);
          if (!t.presets.some((p) => p.id === e.presetId)) fail('unknown_preset', 'Unknown preset');
        }
      }
      // Re-evaluate on change so an edited schedule takes effect immediately.
      state.schedule = { ...cmd.schedule, lastApplied: null };
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
      return res(`${s.name} updated`);
    }
    case 'surface.delete': {
      requireSurface(state, cmd.surfaceId);
      state.surfaces = state.surfaces.filter((s) => s.id !== cmd.surfaceId);
      return res('surface deleted');
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
    case 'output.setViewport': {
      const o = requireOutput(state, cmd.outputId);
      activeProfile(o).viewport = cmd.viewport;
      return res(`${o.name} placed`);
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
      const stagger = new Map<string, number>();
      for (const s of targets) {
        const a = preset.assignments[s.kind] ?? preset.assignments.other ?? preset.assignments.wall;
        if (!a) continue;
        if (a.playlistTemplateId) {
          const id = ensureTemplatePlaylist(state, theme, a.playlistTemplateId, ctx);
          const n = stagger.get(id) ?? 0;
          stagger.set(id, n + 1);
          const len = state.playlists.find((p) => p.id === id)?.items.length ?? 1;
          s.playback = playlistPlayback(id, at, n % Math.max(1, len));
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
        outputId = createOutput(state, spec.name, vp, ctx).id;
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
  const mismatch = p.referenceResolution.w !== w || p.referenceResolution.h !== h;
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
