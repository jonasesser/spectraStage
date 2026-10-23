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
  z.object({ t: z.literal('session.setDefaultTheme'), themeId: id }),
  z.object({ t: z.literal('session.setAmbient'), ambient: StageAmbientSchema.omit({ seed: true }) }),
  z.object({ t: z.literal('session.setBoost'), boost: unit }),
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
  }),
  z.object({ t: z.literal('surface.delete'), surfaceId: id }),
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
  z.object({ t: z.literal('output.delete'), outputId: id }),

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
  z.object({ type: z.literal('preview'), outputId: id, profile: ProfileSchema.nullable() }),
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
  | { type: 'preview'; outputId: string; profile: Profile | null }
  | { type: 'approved'; deviceToken: string; deviceId: string }
  | { type: 'rejected' }
  | {
      type: 'error';
      code: 'unauthorized' | 'revoked' | 'protocol' | 'rate_limited' | 'session_deleted';
      message: string;
    };
