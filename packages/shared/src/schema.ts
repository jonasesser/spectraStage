import { z } from 'zod';

export const PROTOCOL_VERSION = 2;

const id = z.string().min(1).max(64);
const name = z.string().trim().min(1).max(60);
const unit = z.number().finite().min(0).max(1);
const kind = z.enum(['wall', 'floor', 'other']);

/** Normalized point (output space 0..1, may slightly exceed for keystone). */
export const PointSchema = z.object({
  x: z.number().finite().min(-2).max(3),
  y: z.number().finite().min(-2).max(3),
});
export type Pt = z.infer<typeof PointSchema>;
/** Point in stage meters. */
export const StagePointSchema = z.object({
  x: z.number().finite().min(-500).max(500),
  y: z.number().finite().min(-500).max(500),
});
export const QuadSchema = z.tuple([PointSchema, PointSchema, PointSchema, PointSchema]);

// ---------------------------------------------------------------------------
// Output calibration
// ---------------------------------------------------------------------------
export const MaskSchema = z.object({
  id,
  name: z.string().max(40),
  mode: z.enum(['exclude', 'include', 'dim']),
  /** Brightness kept inside a 'dim' mask (0 = black, 1 = unchanged). */
  level: z.number().min(0).max(1).optional(),
  shape: z.enum(['polygon', 'rect', 'ellipse']),
  /** polygon: vertices; rect/ellipse: two opposite bbox corners. Output-normalized coordinates. */
  points: z.array(PointSchema).min(2).max(64),
  /** Extra margin around exclusions (fraction of output width). */
  margin: z.number().min(0).max(0.2),
  /** Cosmetic soft edge (fraction of output width). Ignored for safety masks. */
  feather: z.number().min(0).max(0.1),
  /** Safety masks always use hard edges. */
  safety: z.boolean(),
  enabled: z.boolean(),
});
export type Mask = z.infer<typeof MaskSchema>;

export const MeshSchema = z.object({
  cols: z.number().int().min(2).max(5),
  rows: z.number().int().min(2).max(5),
  /** Offsets of the control points in output-normalized units, row-major (rows*cols entries). */
  offsets: z.array(PointSchema).max(25),
});
export type Mesh = z.infer<typeof MeshSchema>;

export const ViewportSchema = z.object({
  x: z.number().finite().min(-500).max(500),
  y: z.number().finite().min(-500).max(500),
  w: z.number().finite().min(0.1).max(500),
  h: z.number().finite().min(0.1).max(500),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/**
 * Projector in the 3D room: where it stands and where it points. When set, the output renders
 * what this projector throws onto walls, floor and ceiling (also across corners).
 * yaw: around the vertical axis (0 = room -z), pitch: up positive, roll: image rotation;
 * fov: horizontal opening angle in degrees.
 */
export const PoseSchema = z.object({
  pos: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  yaw: z.number().finite(),
  pitch: z.number().min(-1.6).max(1.6),
  roll: z.number().min(-3.2).max(3.2),
  fov: z.number().min(5).max(150),
  /** Lens shift (image center off the optical axis), in half image widths / heights. */
  shiftX: z.number().min(-3).max(3).optional(),
  shiftY: z.number().min(-3).max(3).optional(),
});
export type Pose = z.infer<typeof PoseSchema>;

/**
 * A measured point: a known room point (corner of the room or of an object) and where it
 * really lands in the projector picture (u, v ∈ 0..1, top left), set by moving a marker from
 * the phone until it sits on the real corner.
 */
export const AnchorSchema = z.object({
  /** Corner id (see roomCorners). */
  c: z.string().max(80),
  p: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  /** Set for a point on a room edge: the edge runs from p to q (the point may lie anywhere on it). */
  q: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).optional(),
  u: z.number().min(-0.5).max(1.5),
  v: z.number().min(-0.5).max(1.5),
});
export type Anchor = z.infer<typeof AnchorSchema>;

/**
 * How a side looks on one projector: proportions (x, y), object size (size: pumpkins, graves,
 * figures, animals bigger / smaller, their spacing stays) and shift (dx, dy: the picture moves by
 * this fraction of the side; things crossing over from other sides stay where they really are).
 */
export const SideLookSchema = z.object({
  x: z.number().min(0.05).max(20),
  y: z.number().min(0.05).max(20),
  size: z.number().min(0.1).max(10).optional(),
  dx: z.number().min(-2).max(2).optional(),
  dy: z.number().min(-2).max(2).optional(),
});
export type SideLook = z.infer<typeof SideLookSchema>;

export const ProfileSchema = z.object({
  id,
  name,
  /** Output resolution the profile was calibrated for; null until first reported. */
  referenceResolution: z.object({ w: z.number().int().min(1), h: z.number().int().min(1) }).nullable(),
  /** Stage area (meters) shown by this output. */
  viewport: ViewportSchema,
  /** Where the viewport corners (TL, TR, BR, BL) land in output-normalized space. */
  corners: QuadSchema,
  mesh: MeshSchema.nullable(),
  /**
   * Room corner: one projector covering two surfaces at an angle (wall|wall or wall|floor).
   * The crease sits at `at` (fraction of the viewport along `axis`); a/b are its two ends in
   * output space (x: top, bottom – y: left, right). Each side gets its own perspective.
   */
  fold: z
    .object({
      axis: z.enum(['x', 'y']),
      at: z.number().min(0.02).max(0.98),
      a: PointSchema,
      b: PointSchema,
    })
    .nullable()
    .optional(),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipX: z.boolean(),
  flipY: z.boolean(),
  /** Crop margins in output-normalized units: top, right, bottom, left. */
  crop: z.tuple([unit, unit, unit, unit]),
  /** Edge blend widths (top, right, bottom, left) for overlapping projectors, fraction of output. */
  blend: z
    .tuple([
      z.number().min(0).max(0.5),
      z.number().min(0).max(0.5),
      z.number().min(0).max(0.5),
      z.number().min(0).max(0.5),
    ])
    .optional(),
  masks: z.array(MaskSchema).max(24),
  pose: PoseSchema.nullable().optional(),
  /** Sides of the room this projector covers (chosen by the user; the pose is set to cover them). */
  walls: z
    .array(z.enum(['vorne', 'rechts', 'hinten', 'links', 'boden', 'decke']))
    .max(6)
    .optional(),
  /**
   * Squeeze (< 1) or stretch (> 1) the picture of a side along the room depth, from the
   * transition to the front wall – fits the whole side into the part a slanted projector lights.
   */
  zoom: z
    .object({
      links: z.number().min(0.2).max(5),
      rechts: z.number().min(0.2).max(5),
      boden: z.number().min(0.2).max(5),
      decke: z.number().min(0.2).max(5),
    })
    .partial()
    .optional(),
  /**
   * Proportions per side for this projector (x: horizontal, y: vertical in the side's own picture):
   * below 1 the things on the side get narrower and more of them fit, above 1 wider – the side is
   * always filled completely. Does not change the sizes of the room.
   */
  proportions: z
    .record(z.enum(['vorne', 'rechts', 'hinten', 'links', 'boden', 'decke']), SideLookSchema)
    .optional(),
  /** Measured room corners and edge points → the pose is computed from them. */
  anchors: z.array(AnchorSchema).max(40).optional(),
  updatedAt: z.number(),
});
export type Profile = z.infer<typeof ProfileSchema>;

export const OutputSchema = z.object({
  id,
  name,
  profiles: z.array(ProfileSchema).min(1).max(10),
  activeProfileId: id,
  blackout: z.boolean(),
  intensity: unit,
  volume: unit,
  failover: z.object({
    mode: z.enum(['continue', 'freeze', 'blackout']),
    afterSec: z.number().int().min(5).max(3600),
  }),
  testPattern: z.object({ mode: z.enum(['off', 'grid', 'raw']), until: z.number() }),
  showMasks: z.boolean(),
  /** Rendering budget: auto (adaptive, may drop to 30 fps), high (always 60 fps target), eco (30 fps, lower internal resolution). */
  performance: z.enum(['auto', 'high', 'eco']).optional(),
  /**
   * How the projector PC draws (switchable live to find what works with its GPU/driver):
   * standard (GPU, native up to 4K), compat (no hardware overlay), fullhd (internal Full HD),
   * lowpower (power-saving GPU, Full HD).
   */
  renderMode: z.enum(['standard', 'compat', 'fullhd', 'lowpower']).optional(),
  /** Until when the projector sends a live picture to the admin (ms epoch). */
  diagUntil: z.number().optional(),
  /** Corner measuring in progress: the projector shows room edges, corners and markers. */
  align: z.object({ until: z.number(), sel: z.string().max(80).nullable() }).optional(),
  /** Set when the client reported a resolution different from the active profile. */
  resolutionMismatch: z.object({ w: z.number().int(), h: z.number().int() }).nullable(),
});
export type Output = z.infer<typeof OutputSchema>;

// ---------------------------------------------------------------------------
// Scenes, playlists
// ---------------------------------------------------------------------------
export const ParamValuesSchema = z.record(
  z.string().max(40),
  z.union([z.number().finite(), z.boolean(), z.string().max(64)]),
);

export const TransitionSchema = z.object({
  type: z.enum(['cut', 'crossfade', 'fadeBlack']),
  durationMs: z.number().int().min(0).max(10000),
});
export type Transition = z.infer<typeof TransitionSchema>;

export const SceneRefSchema = z.object({ themeId: id, sceneId: id, params: ParamValuesSchema });
export type SceneRef = z.infer<typeof SceneRefSchema>;

export const EffectRefSchema = z.object({ themeId: id, effectId: id });
export type EffectRef = z.infer<typeof EffectRefSchema>;

export const AmbientSchema = z.object({
  effects: z.array(EffectRefSchema).max(16),
  minGapSec: z.number().min(3).max(600),
  maxGapSec: z.number().min(3).max(600),
});
export type Ambient = z.infer<typeof AmbientSchema>;

export const PlaylistItemSchema = z.object({
  id,
  scene: SceneRefSchema,
  durationSec: z
    .number()
    .min(5)
    .max(24 * 3600),
  transition: TransitionSchema,
  ambient: AmbientSchema.nullable(),
  /** Effects at fixed times within this item (seconds from item start). */
  cues: z
    .array(z.object({ atSec: z.number().min(0).max(86400), themeId: id, effectId: id }))
    .max(50)
    .optional(),
});
export type PlaylistItem = z.infer<typeof PlaylistItemSchema>;

export const PlaylistSchema = z.object({
  id,
  name,
  kind,
  loop: z.boolean(),
  items: z.array(PlaylistItemSchema).max(100),
});
export type Playlist = z.infer<typeof PlaylistSchema>;

export const PlaybackSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('scene'),
    scene: SceneRefSchema,
    seed: z.number().int(),
    startedAt: z.number(),
    transition: TransitionSchema,
  }),
  z.object({
    mode: z.literal('playlist'),
    playlistId: id,
    anchorIndex: z.number().int().min(0),
    anchorTime: z.number(),
    pausedAt: z.number().nullable(),
    seed: z.number().int(),
  }),
]);
export type Playback = z.infer<typeof PlaybackSchema>;

export const SurfaceSchema = z.object({
  id,
  name,
  kind,
  /** Polygon in stage meters (clockwise or counter-clockwise). */
  polygon: z.array(StagePointSchema).min(3).max(32),
  playback: PlaybackSchema,
  intensity: unit,
  /** Which part of a world scene this surface shows (auto = by stage position). */
  role: z.enum(['auto', 'main', 'side', 'ground', 'ceiling']).optional(),
  /** Main wall only: depth of the room (m) for the walls the app adds around it (from measuring). */
  roomDepth: z.number().min(0.3).max(60).optional(),
  /**
   * A scene played in between once (triggered by hand): fades in over the playback, plays once,
   * then the playback underneath goes on.
   */
  insert: z
    .object({
      id: z.string().max(40),
      scene: SceneRefSchema,
      seed: z.number().int(),
      startedAt: z.number(),
      endAt: z.number(),
    })
    .optional(),
});
export type Surface = z.infer<typeof SurfaceSchema>;

// ---------------------------------------------------------------------------
// Cues & stage ambient
// ---------------------------------------------------------------------------
export const CueSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('effect'),
    id,
    themeId: id,
    effectId: id,
    surfaceIds: z.array(id).min(1),
    startAt: z.number(),
    endAt: z.number(),
    seed: z.number().int(),
    params: ParamValuesSchema,
  }),
  z.object({
    kind: z.literal('actor'),
    id,
    themeId: id,
    actorId: id,
    count: z.number().int().min(1).max(12),
    speed: z.number().min(0.2).max(3),
    fromSurfaceId: id.nullable(),
    toSurfaceId: id.nullable(),
    startAt: z.number(),
    endAt: z.number(),
    seed: z.number().int(),
  }),
]);
export type Cue = z.infer<typeof CueSchema>;
export type EffectCue = Extract<Cue, { kind: 'effect' }>;
export type ActorCue = Extract<Cue, { kind: 'actor' }>;

export const StageAmbientSchema = z.object({
  enabled: z.boolean(),
  actors: z.array(z.object({ themeId: id, actorId: id })).max(12),
  minGapSec: z.number().min(5).max(900),
  maxGapSec: z.number().min(5).max(900),
  seed: z.number().int(),
});
export type StageAmbient = z.infer<typeof StageAmbientSchema>;

// ---------------------------------------------------------------------------
// Time schedule (auto mode): presets / boost applied at local clock times
// ---------------------------------------------------------------------------
export const ScheduleEntrySchema = z.object({
  id,
  /** Local time HH:MM */
  at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  themeId: id.nullable(),
  presetId: id.nullable(),
  boost: unit.nullable(),
  /** true = all black (e.g. end of the show), false = resume, null = unchanged */
  blackout: z.boolean().nullable(),
});
export type ScheduleEntry = z.infer<typeof ScheduleEntrySchema>;

export const ScheduleSchema = z.object({
  enabled: z.boolean(),
  /** IANA time zone of the show location, e.g. Europe/Berlin */
  timezone: z.string().min(1).max(64),
  entries: z.array(ScheduleEntrySchema).max(24),
  /** `${date}|${entryId}` of the last applied entry (set by the server). */
  lastApplied: z.string().max(100).nullable(),
});
export type Schedule = z.infer<typeof ScheduleSchema>;

// ---------------------------------------------------------------------------
// Devices, controllers, session
// ---------------------------------------------------------------------------
export const TelemetrySchema = z.object({
  fps: z.number().min(0).max(1000),
  quality: z.number().min(0).max(1),
  width: z.number().int().min(0).max(20000),
  height: z.number().int().min(0).max(20000),
  version: z.string().max(40),
  localBlackout: z.boolean(),
  audioUnlocked: z.boolean(),
  fullscreen: z.boolean(),
  rttMs: z.number().min(0).max(60000),
  jitterMs: z.number().min(0).max(60000),
  clockOffsetMs: z.number().min(-1e12).max(1e12),
  calibrationOk: z.boolean(),
  // --- diagnostics (all optional, older displays omit them)
  gpu: z.string().max(200).optional(),
  dpr: z.number().min(0).max(16).optional(),
  winW: z.number().int().min(0).max(20000).optional(),
  winH: z.number().int().min(0).max(20000).optional(),
  renderW: z.number().int().min(0).max(20000).optional(),
  renderH: z.number().int().min(0).max(20000).optional(),
  contextLost: z.boolean().optional(),
  lastError: z.string().max(200).nullable().optional(),
  renderMode: z.string().max(20).optional(),
  /** Average brightness of the picture the app draws (0..1). */
  lum: z.number().min(0).max(1).optional(),
  /** Why the app draws black on purpose (blackout, format, …), null when it draws the show. */
  blackReason: z.string().max(40).nullable().optional(),
  /** Small JPEG of the projector picture (only while the admin watches it). */
  thumb: z.string().max(150_000).optional(),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;

export const DeviceSchema = z.object({
  id,
  name,
  status: z.enum(['pending', 'approved']),
  outputId: id.nullable(),
  joinedAt: z.number(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const ControllerSchema = z.object({
  id,
  name,
  role: z.enum(['owner', 'controller']),
  joinedAt: z.number(),
});
export type ControllerInfo = z.infer<typeof ControllerSchema>;

export const RoomObjectSchema = z.object({
  id: z.string().max(40),
  name: z.string().min(1).max(40),
  shape: z.enum(['box', 'cylinder']),
  /** Room position of the bottom center (m, y up). */
  pos: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]),
  /** Width (x), height (y), depth (z) in m. */
  size: z.tuple([z.number().min(0.05).max(20), z.number().min(0.05).max(20), z.number().min(0.05).max(20)]),
  /** Rotation around the vertical axis (radians). */
  yaw: z.number().finite(),
  /** What the projectors put on it. */
  look: z.enum(['dark', 'glow', 'flicker', 'spooky', 'edges']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
export type RoomObject = z.infer<typeof RoomObjectSchema>;

/**
 * Where the audience stands (for things painted onto the floor so they look upright from there):
 * x across the front wall (0 = left, 1 = right), z from the front wall to the back wall (0 … 1),
 * eye height in meters.
 */
export const ViewerSchema = z.object({
  x: z.number().min(0).max(1),
  z: z.number().min(0).max(1),
  eye: z.number().min(0.3).max(3),
});
export type Viewer = z.infer<typeof ViewerSchema>;

export const SessionStateSchema = z.object({
  id,
  name,
  revision: z.number().int().min(0),
  createdAt: z.number(),
  kidsSafe: z.boolean(),
  masterVolume: unit,
  muted: z.boolean(),
  blackoutAll: z.boolean(),
  defaultThemeId: id,
  surfaces: z.array(SurfaceSchema),
  outputs: z.array(OutputSchema),
  playlists: z.array(PlaylistSchema),
  cues: z.array(CueSchema),
  ambient: StageAmbientSchema,
  /** Dusk visibility boost 0..1 (brightness + saturation lift on all outputs; black stays black). */
  boost: unit.optional(),
  /** Room mode: the walls go all the way around – the world wraps from the last wall to the first. */
  room: z.boolean().optional(),
  /** Standpoint of the audience (default: middle of the back wall, eyes at 1.6 m). */
  viewer: ViewerSchema.optional(),
  /** Real things in the room (box, pillar, …) that projectors light directly. */
  objects: z
    .array(z.lazy(() => RoomObjectSchema))
    .max(24)
    .optional(),
  /** Saved ghost photos (zombie camera); the pictures themselves live on the server. */
  ghosts: z
    .array(
      z.object({
        id: z.string().max(40),
        at: z.number(),
        /**
         * Which picture of a guest: the plain photo (cut out, no filter – for faces on figures,
         * never flies as a ghost), the face filter one, or the AI one. Pictures of one shot share
         * the group.
         */
        kind: z.enum(['original', 'filter', 'ai']).optional(),
        group: z.string().max(40).optional(),
      }),
    )
    .max(160)
    .optional(),
  /** Ghosts flying around right now. `u`: where in the camera picture the person stood. */
  ghostFlights: z
    .array(
      z.object({
        id: z.string().max(40),
        ghostId: z.string().max(40),
        startAt: z.number(),
        endAt: z.number(),
        seed: z.number().int(),
        u: z.number().min(0).max(1).optional(),
      }),
    )
    .max(16)
    .optional(),
  /** Object being placed: every projector shows its outline so it can be lined up. */
  objectEdit: z
    .object({ id: z.string().max(40), until: z.number() })
    .nullable()
    .optional(),
  schedule: ScheduleSchema.optional(),
  devices: z.array(DeviceSchema),
  controllers: z.array(ControllerSchema),
  lastChange: z.object({ actor: z.string(), at: z.number(), summary: z.string() }).nullable(),
});
export type SessionState = z.infer<typeof SessionStateSchema>;

// ---------------------------------------------------------------------------
// Commands (controller -> server). Applied by the shared reducer.
// ---------------------------------------------------------------------------
const surfaceIds = z.array(id).min(1).max(32);
const outputIds = z.array(id).min(1).max(32);

export const CommandSchema = z.discriminatedUnion('t', [
  z.object({ t: z.literal('session.rename'), name }),
  z.object({ t: z.literal('session.setKidsSafe'), on: z.boolean() }),
  z.object({
    t: z.literal('session.setAudio'),
    masterVolume: unit.optional(),
    muted: z.boolean().optional(),
  }),
  z.object({ t: z.literal('session.blackoutAll'), on: z.boolean() }),
  z.object({
    t: z.literal('object.create'),
    shape: z.enum(['box', 'cylinder']),
    name,
    size: RoomObjectSchema.shape.size.optional(),
    look: RoomObjectSchema.shape.look.optional(),
  }),
  z.object({
    t: z.literal('object.update'),
    id: z.string().max(40),
    patch: RoomObjectSchema.omit({ id: true }).partial(),
  }),
  z.object({ t: z.literal('object.delete'), id: z.string().max(40) }),
  /** Let saved ghost photos fly around again (several at once, staggered). */
  z.object({
    t: z.literal('ghost.release'),
    ghostIds: z.array(z.string().max(40)).min(1).max(12),
    seconds: z.number().min(5).max(300).optional(),
    /** Where each ghost rises (0..1 across the wall), same order as ghostIds. */
    u: z.array(z.number().min(0).max(1)).max(12).optional(),
  }),
  z.object({ t: z.literal('ghost.delete'), ghostId: z.string().max(40) }),
  z.object({ t: z.literal('ghost.deleteAll') }),
  /** Call ghosts back (all, or only these pictures). */
  z.object({ t: z.literal('ghost.stopFlights'), ghostIds: z.array(z.string().max(40)).max(24).optional() }),
  /** Show the outline of an object on all projectors while it is placed (null = done). */
  z.object({ t: z.literal('object.edit'), id: z.string().max(40).nullable() }),
  z.object({ t: z.literal('session.setDefaultTheme'), themeId: id }),
  z.object({ t: z.literal('session.setAmbient'), ambient: StageAmbientSchema.omit({ seed: true }) }),
  z.object({ t: z.literal('session.setBoost'), boost: unit }),
  z.object({ t: z.literal('session.setRoom'), room: z.boolean() }),
  z.object({ t: z.literal('session.setSchedule'), schedule: ScheduleSchema.omit({ lastApplied: true }) }),

  z.object({
    t: z.literal('surface.create'),
    name,
    kind,
    polygon: z.array(StagePointSchema).min(3).max(32).optional(),
  }),
  z.object({
    t: z.literal('surface.update'),
    surfaceId: id,
    name: name.optional(),
    kind: kind.optional(),
    intensity: unit.optional(),
    polygon: z.array(StagePointSchema).min(3).max(32).optional(),
    role: z.enum(['auto', 'main', 'side', 'ground', 'ceiling']).optional(),
  }),
  z.object({ t: z.literal('surface.delete'), surfaceId: id }),
  /** Play a scene in between once (then the playback goes on). */
  z.object({
    t: z.literal('surface.insert'),
    surfaceIds,
    themeId: id,
    sceneId: id,
    params: ParamValuesSchema.optional(),
  }),
  z.object({
    t: z.literal('surface.setScene'),
    surfaceIds,
    themeId: id,
    sceneId: id,
    params: ParamValuesSchema.optional(),
    transition: TransitionSchema.optional(),
  }),
  z.object({ t: z.literal('surface.setParams'), surfaceId: id, params: ParamValuesSchema }),
  z.object({
    t: z.literal('surface.playPlaylist'),
    surfaceIds,
    playlistId: id,
    startIndex: z.number().int().min(0).optional(),
  }),
  z.object({ t: z.literal('surface.skip'), surfaceIds, direction: z.union([z.literal(1), z.literal(-1)]) }),
  z.object({ t: z.literal('surface.pause'), surfaceIds, paused: z.boolean() }),

  z.object({
    t: z.literal('output.update'),
    outputId: id,
    name: name.optional(),
    intensity: unit.optional(),
    volume: unit.optional(),
    failover: OutputSchema.shape.failover.optional(),
    showMasks: z.boolean().optional(),
    performance: z.enum(['auto', 'high', 'eco']).optional(),
    renderMode: z.enum(['standard', 'compat', 'fullhd', 'lowpower']).optional(),
    /** Live picture of the projector in the admin app for 5 minutes (or off). */
    diag: z.boolean().optional(),
  }),
  z.object({ t: z.literal('output.blackout'), outputIds, on: z.boolean() }),
  z.object({
    t: z.literal('output.testPattern'),
    outputId: id,
    mode: z.enum(['off', 'grid', 'raw']),
    minutes: z.number().min(1).max(60).optional(),
  }),
  z.object({
    t: z.literal('output.saveProfile'),
    outputId: id,
    profile: ProfileSchema,
    activate: z.boolean(),
  }),
  z.object({ t: z.literal('output.activateProfile'), outputId: id, profileId: id }),
  z.object({ t: z.literal('output.duplicateProfile'), outputId: id, profileId: id }),
  z.object({ t: z.literal('output.deleteProfile'), outputId: id, profileId: id }),
  z.object({ t: z.literal('output.acceptResolution'), outputId: id }),
  z.object({ t: z.literal('output.setViewport'), outputId: id, viewport: ViewportSchema }),
  z.object({ t: z.literal('output.setPose'), outputId: id, pose: PoseSchema.nullable() }),
  /** Measured corners; with ≥ 4 the pose is solved from them. */
  z.object({
    t: z.literal('output.setAnchors'),
    outputId: id,
    anchors: z.array(AnchorSchema).max(40),
    /** While a marker is dragged: only refine the pose (fast), the full solve follows on release. */
    quick: z.boolean().optional(),
  }),
  /** Choose which sides of the room a projector covers; it is set up to cover them. */
  z.object({
    t: z.literal('output.setWalls'),
    outputId: id,
    walls: z.array(z.enum(['vorne', 'rechts', 'hinten', 'links', 'boden', 'decke'])).max(6),
    /** Start measuring from scratch (else corners of sides that stay chosen are kept). */
    reset: z.boolean().optional(),
  }),
  /** Depth of the room (side walls, floor, ceiling): squeezes / stretches their pictures, which still fill them. */
  z.object({ t: z.literal('room.setDepth'), depth: z.number().min(0.3).max(60) }),
  /** Width of the front wall (its proportions); floors / ceilings along it follow. */
  z.object({ t: z.literal('room.setWidth'), width: z.number().min(0.3).max(60) }),
  /** Back to standard proportions: front wall 4 m wide, room 4 m deep (fine-tune with the sliders). */
  z.object({ t: z.literal('room.resetSize') }),
  /** Standpoint of the audience (null = default: middle of the back wall). */
  z.object({ t: z.literal('room.setViewer'), viewer: ViewerSchema.nullable() }),
  /**
   * How the projector is mounted (instead of setting it on the projector): front (table),
   * ceiling (upside down = turned 180°), rear (behind a screen = mirrored left/right),
   * ceiling + rear (= mirrored top/bottom).
   */
  z.object({
    t: z.literal('output.setMount'),
    outputId: id,
    mount: z.enum(['front', 'ceiling', 'rear', 'ceilingRear']),
  }),
  z.object({
    t: z.literal('output.setZoom'),
    outputId: id,
    zoom: z
      .object({
        links: z.number().min(0.2).max(5),
        rechts: z.number().min(0.2).max(5),
        boden: z.number().min(0.2).max(5),
        decke: z.number().min(0.2).max(5),
      })
      .partial(),
  }),
  z.object({
    t: z.literal('output.setProportions'),
    outputId: id,
    proportions: z.record(z.enum(['vorne', 'rechts', 'hinten', 'links', 'boden', 'decke']), SideLookSchema),
  }),
  /** Start/stop corner measuring on the projector (sel = highlighted corner). */
  z.object({
    t: z.literal('output.align'),
    outputId: id,
    on: z.boolean(),
    sel: z.string().max(80).nullable(),
  }),
  /** Plan a projector before any PC is connected (a device can be approved onto it later). */
  z.object({ t: z.literal('output.create'), name }),
  /** Plan one projector per room side (main wall, 3 walls, floor, ceiling) for sides without one. */
  z.object({ t: z.literal('output.planRoom') }),
  z.object({ t: z.literal('output.delete'), outputId: id }),
  /** Switch to a ready-made projector setup; planned projectors are replaced, connected ones re-aimed. */
  z.object({
    t: z.literal('output.arrange'),
    layout: z.enum(['sides', 'threeWalls', 'threeWallsPlus', 'wallFloor', 'mainOnly']),
  }),

  z.object({ t: z.literal('preset.apply'), themeId: id, presetId: id, surfaceIds: surfaceIds.optional() }),
  z.object({ t: z.literal('playlist.save'), playlist: PlaylistSchema }),
  z.object({ t: z.literal('playlist.delete'), playlistId: id }),
  z.object({ t: z.literal('playlist.duplicate'), playlistId: id }),
  z.object({ t: z.literal('playlist.fromTemplate'), themeId: id, templateId: id }),

  z.object({
    t: z.literal('effect.fire'),
    surfaceIds,
    themeId: id,
    effectId: id,
    params: ParamValuesSchema.optional(),
  }),
  z.object({
    t: z.literal('actor.spawn'),
    themeId: id,
    actorId: id,
    count: z.number().int().min(1).max(12),
    speed: z.number().min(0.2).max(3),
    fromSurfaceId: id.nullable(),
    toSurfaceId: id.nullable(),
  }),
  z.object({ t: z.literal('cue.stop'), cueId: id.optional() }),

  z.object({
    t: z.literal('device.approve'),
    deviceId: id,
    outputId: id.optional(),
    newOutput: z
      .object({ name, surfaceId: id.optional(), newSurface: z.object({ name, kind }).optional() })
      .optional(),
  }),
  z.object({ t: z.literal('device.reject'), deviceId: id }),
  z.object({ t: z.literal('device.remove'), deviceId: id }),
  z.object({ t: z.literal('device.rename'), deviceId: id, name }),
  z.object({ t: z.literal('device.assign'), deviceId: id, outputId: id.nullable() }),
  z.object({ t: z.literal('device.identify'), deviceId: id }),
  z.object({ t: z.literal('controller.remove'), controllerId: id }),
]);
export type Command = z.infer<typeof CommandSchema>;
export type CommandType = Command['t'];

/** Commands restricted to the session owner. */
export const OWNER_ONLY: ReadonlySet<CommandType> = new Set<CommandType>([
  'session.setKidsSafe',
  'device.approve',
  'device.reject',
  'device.remove',
  'controller.remove',
]);

// ---------------------------------------------------------------------------
// WebSocket messages
// ---------------------------------------------------------------------------
export const RtcDataSchema = z.object({
  kind: z.enum(['offer', 'answer', 'ice', 'bye']),
  sdp: z.string().max(20_000).optional(),
  candidate: z
    .object({
      candidate: z.string().max(1000),
      sdpMid: z.string().max(64).nullable().optional(),
      sdpMLineIndex: z.number().int().min(0).max(64).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type RtcData = z.infer<typeof RtcDataSchema>;

export const ClientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocol: z.number().int(),
    token: z.string().min(10).max(200),
    clientId: id,
    lastRevision: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('cmd'), id: z.string().min(8).max(64), cmd: CommandSchema }),
  z.object({ type: z.literal('ping'), t: z.number() }),
  z.object({ type: z.literal('telemetry'), telemetry: TelemetrySchema }),
  /** Transient calibration preview relayed to the output's device (not persisted). */
  z.object({
    type: z.literal('preview'),
    outputId: id,
    profile: ProfileSchema.nullable(),
    /** Selected corner (0–3) to highlight on the projector while calibrating. */
    focus: z.number().int().min(-1).max(3).optional(),
  }),
  /**
   * WebRTC signalling for the live camera (phone → projector PCs), relayed by the server within
   * the show only: controller ↔ device. `to` is a device id, or the `from` of a received message.
   */
  z.object({ type: z.literal('rtc'), to: z.string().min(1).max(200), data: RtcDataSchema }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type Role = 'owner' | 'controller' | 'device' | 'pending';

export type ControllerSecrets = {
  pairingCode: string | null;
  pairingExpiresAt: number | null;
  invites: { code: string; expiresAt: number }[];
};

export type DevicePresence = { online: boolean; lastSeen: number; telemetry: Telemetry | null };
export type Presence = {
  devices: Record<string, DevicePresence>;
  controllers: Record<string, { online: boolean; lastSeen: number }>;
};

export type ServerMessage =
  | {
      type: 'welcome';
      role: Role;
      subjectId: string;
      sessionId: string;
      serverTime: number;
      protocol: number;
    }
  | { type: 'snapshot'; state: SessionState; secrets?: ControllerSecrets }
  | { type: 'presence'; presence: Presence }
  | { type: 'ack'; id: string; revision: number }
  | { type: 'nack'; id: string; code: string; message: string }
  | { type: 'pong'; t: number; serverTime: number }
  | { type: 'identify'; deviceId: string; label: string; until: number }
  | { type: 'preview'; outputId: string; profile: Profile | null; focus?: number }
  | { type: 'rtc'; from: string; data: RtcData }
  | { type: 'approved'; deviceToken: string; deviceId: string }
  | { type: 'rejected' }
  | {
      type: 'error';
      code: 'unauthorized' | 'revoked' | 'protocol' | 'rate_limited' | 'session_deleted';
      message: string;
    };
