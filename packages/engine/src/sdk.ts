/**
 * Theme runtime SDK. A theme package provides a ThemeRuntime with scene, effect and actor modules.
 * Rules for theme authors:
 *  - Rendering must be a deterministic function of (time, seed, params) so that several outputs
 *    showing the same surface (or a reconnecting client) agree.
 *  - Free every GPU resource in dispose().
 */
import type * as THREE from 'three';
import type {
  ActorPose,
  BBox,
  ParamValues,
  Rng,
  RoomFold,
  SurfaceKind,
  WorldSurface,
} from '@spectrastage/shared';
import type { SoundApi } from './sound.ts';
import type { DrawState } from './sceneKit.ts';

export interface FrameInfo {
  /** Seconds since the scene instance started (show-time based, may be negative before start). */
  time: number;
  /** Absolute synchronized show time in ms. */
  showTime: number;
  /** Seconds since the previous frame (clamped). */
  dt: number;
}

export interface SceneContext {
  renderer: THREE.WebGLRenderer;
  width: number;
  height: number;
  /** Pixels per meter on this surface (to size characters physically). */
  ppm: number;
  seed: number;
  params: ParamValues;
  kind: SurfaceKind;
  /** 0.35..1 – lower values ask scenes to reduce particle counts. */
  quality: number;
  /** Where this surface sits in the shared stage world (all surfaces). */
  world?: WorldContext;
  /**
   * Extra Canvas2D layer drawn on top of the scene (canvas-based scenes) – used by worlds for
   * events that cross surfaces, e.g. a cat jumping out of the house onto the driveway.
   */
  overlay?: (g: CanvasRenderingContext2D, s: DrawState, f: FrameInfo) => void;
  /**
   * The guests' photos of this show (ghost photos, cut out): `list()` newest first, `get(id)` the
   * picture once loaded (null while loading – call again later).
   */
  photos?: ScenePhotos;
  /** The show's uploaded videos: a playable (local) URL once loaded, null while loading. */
  videos?: SceneVideos;
}

export interface SceneVideos {
  url(id: string): string | null;
}

export interface ScenePhotos {
  list(): readonly { id: string; at: number; kind?: 'original' | 'filter' | 'ai' }[];
  get(id: string): {
    img: CanvasImageSource & { width: number; height: number };
    /** The photo in its own colours (for faces on figures). */
    raw?: CanvasImageSource & { width: number; height: number };
    /**
     * Where the face is in the photo (found by face landmarks, in 0..1 of the picture; roll in
     * radians, positive = turned clockwise). Undefined while still looking, null when none found.
     * Reading it starts the search.
     */
    readonly face?: FaceBox | null;
  } | null;
}

export interface FaceBox {
  /** Centre of the face (between the eyes and the mouth). */
  cx: number;
  cy: number;
  /** Width (cheek to cheek) and height (forehead to chin), 0..1 of the picture's width / height. */
  w: number;
  h: number;
  roll: number;
}

/**
 * A scene is a world spread over the whole stage; every surface renders only its part.
 * Coordinates are stage meters (y down). Use `seed` (identical on every surface) for anything
 * that has to continue across surfaces, e.g. clouds, the moon, scheduled events.
 */
export interface WorldContext {
  self: WorldSurface;
  surfaces: WorldSurface[];
  /** Bounding box of all surfaces. */
  bounds: BBox;
  /** Shared seed for this scene run (same on every surface and PC). */
  seed: number;
  /**
   * Room mode: walls go all the way around. `wrap.w` meters after `wrap.x` the world repeats,
   * so anything placed by world x must be periodic (use wrapX / tileable noise).
   */
  wrap: { x: number; w: number } | null;
  /** The whole stage folded into a 3D room (faces, viewer position) – for the sky and paths. */
  room: RoomFold;
  /**
   * A projector lights the floor of the room: what lies on the ground in front of the main wall
   * (a garden path, pumpkins …) can go onto the real floor instead of being painted on the wall.
   * Same on every projector PC (from the shared show state).
   */
  floorLit?: boolean;
  /**
   * Object size on this side (projector setting): pumpkins, graves, figures, animals bigger or
   * smaller – their places and spacing stay. 1 = normal.
   */
  objectScale?: number;
  /**
   * Eye point of the audience in room space (`room` coordinates): things standing on the floor
   * are painted stretched so they look upright from there.
   */
  viewer?: [number, number, number];
  /**
   * The picture of this side is shifted (projector setting): `self` is the shifted window for the
   * static picture, `events` the real one – things that cross over from other sides (overlay) are
   * drawn with it so they stay where they really are.
   */
  events?: WorldContext;
}

export interface SceneInstance {
  render(target: THREE.WebGLRenderTarget, frame: FrameInfo): void;
  resize(width: number, height: number, ppm: number): void;
  setParams(params: ParamValues): void;
  dispose(): void;
}

export interface SceneModule {
  id: string;
  create(ctx: SceneContext): SceneInstance;
  /** Optional ambient sound started when the scene becomes active on the primary sound output. */
  ambientSound?(sound: SoundApi, seed: number): (() => void) | void;
}

export interface EffectDrawInfo {
  w: number;
  h: number;
  ppm: number;
  /** Seconds since effect start. */
  t: number;
  /** 0..1 progress over the effect duration. */
  progress: number;
  duration: number;
  seed: number;
  params: ParamValues;
  rng: Rng;
  /** Dusk visibility boost 0..1. */
  boost?: number;
}

export interface EffectModule {
  id: string;
  /** Draw onto the surface overlay (transparent canvas, surface-local pixels). */
  draw(g: CanvasRenderingContext2D, info: EffectDrawInfo): void;
  sound?(sound: SoundApi, seed: number): void;
}

export interface ActorDrawInfo {
  /** Pixels per meter in the output view. */
  ppm: number;
  /** Seconds since the actor cue started. */
  t: number;
  seed: number;
  sizePx: number;
  /** Dusk visibility boost 0..1 – draw stronger outlines/rims when > 0. */
  boost?: number;
}

export interface ActorModule {
  id: string;
  /** Draw centered at (0,0) facing +x; the engine applies translation/rotation. */
  draw(g: CanvasRenderingContext2D, pose: ActorPose, info: ActorDrawInfo): void;
  /** If true, the engine keeps the sprite upright instead of rotating it with the heading. */
  upright?: boolean;
  sound?(sound: SoundApi, seed: number): void;
}

export interface ThemeRuntime {
  id: string;
  scenes: Record<string, SceneModule>;
  effects: Record<string, EffectModule>;
  actors: Record<string, ActorModule>;
}
