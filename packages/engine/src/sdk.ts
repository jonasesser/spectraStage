/**
 * Theme runtime SDK. A theme package provides a ThemeRuntime with scene, effect and actor modules.
 * Rules for theme authors:
 *  - Rendering must be a deterministic function of (time, seed, params) so that several outputs
 *    showing the same surface (or a reconnecting client) agree.
 *  - Free every GPU resource in dispose().
 */
import type * as THREE from 'three';
import type { ActorPose, ParamValues, Rng, SurfaceKind } from '@spectrastage/shared';
import type { SoundApi } from './sound.ts';

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
