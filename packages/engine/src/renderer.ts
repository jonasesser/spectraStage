/**
 * StageRenderer: renders what one projector output sees.
 *
 *   surfaces (scene + effects, surface-local)  ─┐
 *   actors (stage space, clipped to surfaces)  ─┼─► view RT (stage viewport) ─► warp mesh ─► × mask × gain ─► screen
 *   test pattern / identify overlay (view)     ─┘
 *
 * Everything is evaluated from the synchronized show clock, so several outputs agree and a
 * client that loses its connection keeps animating.
 */
import * as THREE from 'three';
import {
  activeProfile,
  activeScene,
  ambientActorCues,
  ambientSchedule,
  bboxIntersects,
  buildActorRoute,
  createRng,
  hashString,
  polygonBBox,
  polygonCentroid,
  primaryOutputAt,
  routePose,
  stageBounds,
  UNIT_QUAD,
  type ActiveScene,
  type ActorCue,
  type Output,
  type Profile,
  type Route,
  type SessionState,
  type Surface,
  type ThemeCatalog,
  type Viewport,
} from '@spectrastage/shared';
import type { SceneInstance, ThemeRuntime } from './sdk.ts';
import { canvasTexture } from './sceneKit.ts';
import { buildWarpMesh } from './warp.ts';
import { paintMask, paintMaskOverlay } from './masks.ts';
import type { SoundEngine } from './sound.ts';
import { drawRawPattern, drawStageGrid, drawIdentify } from './testPattern.ts';

export type RuntimeLoader = (themeId: string) => Promise<ThemeRuntime>;

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  catalog: ThemeCatalog;
  loadRuntime: RuntimeLoader;
  now: () => number;
  sound?: SoundEngine;
  /** Preview mode (controller): no warp, masks, limiter or sound; shows a fixed stage area. */
  preview?: boolean;
  maxPixelRatio?: number;
}

export interface RendererStats {
  fps: number;
  quality: number;
  calibrationOk: boolean;
  width: number;
  height: number;
  blackout: boolean;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const CLIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const LAYER_FRAG = /* glsl */ `
uniform sampler2D texA;
uniform sampler2D texB;
uniform sampler2D overlay;
uniform float mixB;     // 0 = only A (current), 1 = only B (previous)
uniform float fadeBlack; // 1 = fade through black mode
uniform float hasB;
uniform float hasOverlay;
varying vec2 vUv;
void main() {
  vec3 a = texture2D(texA, vUv).rgb;
  vec3 col = a;
  if (hasB > 0.5) {
    vec3 b = texture2D(texB, vUv).rgb;
    if (fadeBlack > 0.5) {
      // mixB goes 1 -> 0: first fade B out, then A in.
      col = mixB > 0.5 ? b * (mixB - 0.5) * 2.0 : a * (1.0 - mixB * 2.0);
    } else {
      col = mix(a, b, mixB);
    }
  }
  if (hasOverlay > 0.5) {
    vec4 o = texture2D(overlay, vUv);
    col = col * (1.0 - o.a) + o.rgb;
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const SURFACE_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float intensity;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(map, vUv).rgb * intensity, 1.0); }
`;

const ACTOR_FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec2 viewSize;
void main() {
  vec4 c = texture2D(map, gl_FragCoord.xy / viewSize);
  gl_FragColor = c;
}
`;

const FINAL_FRAG = /* glsl */ `
uniform sampler2D view;
uniform sampler2D mask;
uniform vec2 outSize;
uniform float gain;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(view, vUv).rgb;
  float m = texture2D(mask, gl_FragCoord.xy / outSize).r;
  gl_FragColor = vec4(c * m * gain, 1.0);
}
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D map;
uniform float gain;
uniform float useMask;
uniform sampler2D mask;
uniform vec2 outSize;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  float m = useMask > 0.5 ? texture2D(mask, gl_FragCoord.xy / outSize).r : 1.0;
  gl_FragColor = vec4(c.rgb * m * gain, c.a);
}
`;

const CLIP_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

function makeRT(w: number, h: number): THREE.WebGLRenderTarget {
  return new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
}

function fullscreenQuad(material: THREE.Material): THREE.Scene {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return scene;
}

class Overlay2D {
  canvas = document.createElement('canvas');
  g: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  dirty = false;
  constructor(w: number, h: number) {
    this.canvas.width = w;
    this.canvas.height = h;
    this.g = this.canvas.getContext('2d')!;
    this.texture = canvasTexture(this.canvas, true);
  }
  resize(w: number, h: number): void {
    if (this.canvas.width === w && this.canvas.height === h) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose();
    this.texture = canvasTexture(this.canvas, true);
  }
  clear(): void {
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
  upload(): void {
    this.texture.needsUpdate = true;
  }
  dispose(): void {
    this.texture.dispose();
  }
}

interface SceneSlot {
  key: string;
  inst: SceneInstance;
  rt: THREE.WebGLRenderTarget;
  active: ActiveScene;
  paramsJson: string;
  stopAmbient: (() => void) | null;
}

/** Per-surface renderer: scene (with transitions) + effect overlay. */
class SurfaceLayer {
  current: SceneSlot | null = null;
  previous: SceneSlot | null = null;
  layerRT: THREE.WebGLRenderTarget;
  overlay: Overlay2D;
  material: THREE.ShaderMaterial;
  quad: THREE.Scene;
  w = 2;
  h = 2;
  ppm = 1;
  startedEffects = new Set<string>();
  lastUsed = 0;

  constructor(readonly surfaceId: string) {
    this.layerRT = makeRT(2, 2);
    this.overlay = new Overlay2D(2, 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        texA: { value: null },
        texB: { value: null },
        overlay: { value: this.overlay.texture },
        mixB: { value: 0 },
        fadeBlack: { value: 0 },
        hasB: { value: 0 },
        hasOverlay: { value: 0 },
      },
      vertexShader: CLIP_VERT,
      fragmentShader: LAYER_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = fullscreenQuad(this.material);
  }

  resize(w: number, h: number, ppm: number): void {
    this.ppm = ppm;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.layerRT.setSize(w, h);
    this.overlay.resize(w, h);
    this.material.uniforms.overlay!.value = this.overlay.texture;
    for (const s of [this.current, this.previous]) {
      if (!s) continue;
      s.rt.setSize(w, h);
      s.inst.resize(w, h, ppm);
    }
  }

  disposeSlot(s: SceneSlot | null): void {
    if (!s) return;
    s.stopAmbient?.();
    s.inst.dispose();
    s.rt.dispose();
  }

  dispose(): void {
    this.disposeSlot(this.current);
    this.disposeSlot(this.previous);
    this.current = null;
    this.previous = null;
    this.layerRT.dispose();
    this.overlay.dispose();
    this.material.dispose();
    this.quad.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

interface SurfaceMesh {
  key: string;
  surface: THREE.Mesh;
  actors: THREE.Mesh;
  geometry: THREE.BufferGeometry;
}

export class StageRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private readonly opts: RendererOptions;
  private state: SessionState | null = null;
  private outputId: string | null = null;
  private previewProfile: Profile | null = null;
  private previewViewport: Viewport | null = null;
  private runtimes = new Map<string, ThemeRuntime>();
  private loading = new Set<string>();
  private layers = new Map<string, SurfaceLayer>();
  private meshes = new Map<string, SurfaceMesh>();
  private viewRT: THREE.WebGLRenderTarget;
  private viewScene = new THREE.Scene();
  private viewCamera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  private actorOverlay: Overlay2D;
  private actorMaterial: THREE.ShaderMaterial;
  private viewOverlay: Overlay2D;
  private viewOverlayScene: THREE.Scene;
  private viewOverlayMaterial: THREE.ShaderMaterial;
  private warpGeometry: THREE.BufferGeometry | null = null;
  private warpKey = '';
  private finalMaterial: THREE.ShaderMaterial;
  private finalScene = new THREE.Scene();
  private maskOverlay: Overlay2D;
  private maskCanvas = document.createElement('canvas');
  private maskTexture: THREE.CanvasTexture;
  private maskKey = '';
  private screenOverlayScene: THREE.Scene;
  private screenOverlayMaterial: THREE.ShaderMaterial;
  private rawScene: THREE.Scene;
  private rawMaterial: THREE.ShaderMaterial;
  private lumRT = makeRT(32, 18);
  private lumScene: THREE.Scene;
  private lumMaterial: THREE.ShaderMaterial;
  private lumBuf = new Uint8Array(32 * 18 * 4);
  private routes = new Map<string, Route | null>();
  private actorSoundAt = new Map<string, number>();
  private raf = 0;
  private running = false;
  private lastFrame = 0;
  private frameTimes: number[] = [];
  private quality = 1;
  private goodSince = 0;
  private gain = 0;
  private limiterDisplayed = 0;
  private limiterGain = 1;
  private frameNo = 0;
  private online = true;
  private offlineSince = 0;
  private localBlackout = false;
  private identify: { label: string; until: number } | null = null;
  private width = 0;
  private height = 0;
  private calibrationOk = true;
  private blackoutNow = false;
  private contextLost = false;

  constructor(opts: RendererOptions) {
    this.opts = opts;
    this.renderer = new THREE.WebGLRenderer({
      canvas: opts.canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    opts.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
    });
    opts.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.resetLayers();
    });

    this.viewRT = makeRT(2, 2);
    this.actorOverlay = new Overlay2D(2, 2);
    this.actorMaterial = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.actorOverlay.texture }, viewSize: { value: new THREE.Vector2(1, 1) } },
      vertexShader: VERT,
      fragmentShader: ACTOR_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.viewOverlay = new Overlay2D(2, 2);
    this.viewOverlayMaterial = this.copyMaterial(this.viewOverlay.texture, true);
    this.viewOverlayScene = fullscreenQuad(this.viewOverlayMaterial);

    this.maskCanvas.width = 2;
    this.maskCanvas.height = 2;
    this.maskTexture = canvasTexture(this.maskCanvas, false);
    this.maskTexture.minFilter = THREE.NearestFilter;
    this.maskTexture.magFilter = THREE.NearestFilter;
    this.finalMaterial = new THREE.ShaderMaterial({
      uniforms: {
        view: { value: this.viewRT.texture },
        mask: { value: this.maskTexture },
        outSize: { value: new THREE.Vector2(1, 1) },
        gain: { value: 0 },
      },
      vertexShader: CLIP_VERT,
      fragmentShader: FINAL_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.maskOverlay = new Overlay2D(2, 2);
    this.screenOverlayMaterial = this.copyMaterial(this.maskOverlay.texture, true);
    this.screenOverlayScene = fullscreenQuad(this.screenOverlayMaterial);
    this.rawMaterial = this.copyMaterial(this.maskOverlay.texture, false);
    this.rawMaterial.uniforms.useMask!.value = 1;
    this.rawScene = fullscreenQuad(this.rawMaterial);
    this.lumMaterial = this.copyMaterial(this.viewRT.texture, false);
    this.lumScene = fullscreenQuad(this.lumMaterial);
  }

  private copyMaterial(map: THREE.Texture, transparent: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        gain: { value: 1 },
        useMask: { value: 0 },
        mask: { value: this.maskTexture ?? null },
        outSize: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: CLIP_VERT,
      fragmentShader: COPY_FRAG,
      transparent,
      depthTest: false,
      depthWrite: false,
      blending: transparent ? THREE.CustomBlending : THREE.NoBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  setState(state: SessionState | null, outputId: string | null): void {
    this.state = state;
    this.outputId = outputId;
    if (state) {
      for (const s of state.surfaces) this.ensureRuntime(this.themeOf(s, state));
      for (const c of state.cues) this.ensureRuntime(c.themeId);
      for (const a of state.ambient.actors) this.ensureRuntime(a.themeId);
    }
  }

  /** Live (unsaved) calibration from the controller editor. */
  setPreviewProfile(profile: Profile | null): void {
    this.previewProfile = profile;
  }

  /** Preview mode: which stage area to show (null = all surfaces). */
  setPreviewViewport(vp: Viewport | null): void {
    this.previewViewport = vp;
  }

  setConnection(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    if (!online) this.offlineSince = this.opts.now();
  }

  setLocalBlackout(on: boolean): void {
    this.localBlackout = on;
  }

  get localBlackoutOn(): boolean {
    return this.localBlackout;
  }

  showIdentify(label: string, until: number): void {
    this.identify = { label, until };
  }

  stats(): RendererStats {
    const avg = this.frameTimes.length
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      : 16.7;
    return {
      fps: Math.round(1000 / Math.max(1, avg)),
      quality: this.quality,
      calibrationOk: this.calibrationOk,
      width: this.width,
      height: this.height,
      blackout: this.blackoutNow,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(t);
      } catch (e) {
        console.error('[SpectraStage] frame error', e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  dispose(): void {
    this.stop();
    this.resetLayers();
    this.viewRT.dispose();
    this.lumRT.dispose();
    this.actorOverlay.dispose();
    this.viewOverlay.dispose();
    this.maskOverlay.dispose();
    this.maskTexture.dispose();
    this.warpGeometry?.dispose();
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  private resetLayers(): void {
    for (const l of this.layers.values()) l.dispose();
    this.layers.clear();
    for (const m of this.meshes.values()) {
      m.geometry.dispose();
      (m.surface.material as THREE.Material).dispose();
      this.viewScene.remove(m.surface, m.actors);
    }
    this.meshes.clear();
    this.warpKey = '';
    this.maskKey = '';
  }

  private themeOf(s: Surface, state: SessionState): string {
    if (s.playback.mode === 'scene') return s.playback.scene.themeId;
    const pl = state.playlists.find((p) => p.id === (s.playback as { playlistId: string }).playlistId);
    for (const it of pl?.items ?? []) this.ensureRuntime(it.scene.themeId);
    return pl?.items[0]?.scene.themeId ?? state.defaultThemeId;
  }

  private ensureRuntime(themeId: string): void {
    if (this.runtimes.has(themeId) || this.loading.has(themeId)) return;
    this.loading.add(themeId);
    this.opts
      .loadRuntime(themeId)
      .then((rt) => this.runtimes.set(themeId, rt))
      .catch((e) => console.error('[SpectraStage] theme load failed', themeId, e))
      .finally(() => this.loading.delete(themeId));
  }

  private output(): Output | null {
    if (!this.state || !this.outputId) return null;
    return this.state.outputs.find((o) => o.id === this.outputId) ?? null;
  }

  private profile(): Profile | null {
    if (this.opts.preview) {
      const vp =
        this.previewViewport ??
        (this.state
          ? padViewport(stageBounds(this.state.surfaces), this.width / Math.max(1, this.height))
          : null);
      if (!vp) return null;
      return {
        id: 'preview',
        name: 'preview',
        referenceResolution: null,
        viewport: vp,
        corners: structuredClone(UNIT_QUAD) as Profile['corners'],
        mesh: null,
        rotation: 0,
        flipX: false,
        flipY: false,
        crop: [0, 0, 0, 0],
        masks: [],
        updatedAt: 0,
      };
    }
    const o = this.output();
    if (!o) return null;
    if (this.previewProfile) return this.previewProfile;
    return activeProfile(o);
  }

  private resize(): boolean {
    const canvas = this.opts.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, this.opts.maxPixelRatio ?? 2);
    const w = Math.max(2, Math.min(3840, Math.round(canvas.clientWidth * dpr)));
    const h = Math.max(2, Math.min(2400, Math.round(canvas.clientHeight * dpr)));
    if (w === this.width && h === this.height) return false;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.maskKey = '';
    return true;
  }

  private adaptQuality(dtMs: number, wall: number): void {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 60 || this.opts.preview) return;
    const fps = 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
    if (fps < 45 && this.quality > 0.36) {
      this.quality = Math.max(0.35, this.quality * 0.8);
      this.frameTimes = [];
      this.goodSince = wall;
    } else if (fps > 57) {
      if (!this.goodSince) this.goodSince = wall;
      if (wall - this.goodSince > 10_000 && this.quality < 1) {
        this.quality = Math.min(1, this.quality * 1.15);
        this.goodSince = wall;
        this.frameTimes = [];
      }
    } else this.goodSince = wall;
  }

  private frame(wall: number): void {
    if (this.contextLost) return;
    const dtMs = this.lastFrame ? Math.min(250, wall - this.lastFrame) : 16.7;
    this.lastFrame = wall;
    this.frameNo++;
    this.adaptQuality(dtMs, wall);
    this.resize();
    const r = this.renderer;
    const state = this.state;
    const output = this.opts.preview ? null : this.output();
    const profile = this.profile();
    let now = this.opts.now();

    // Failover (D19)
    let failoverBlack = false;
    if (output && !this.online) {
      const after = output.failover.afterSec * 1000;
      if (now - this.offlineSince > after) {
        if (output.failover.mode === 'freeze') now = this.offlineSince + after;
        if (output.failover.mode === 'blackout') failoverBlack = true;
      }
    }

    // Calibration validity (D22): missing profile or resolution mismatch → black.
    this.calibrationOk = this.opts.preview || (!!profile && !!output && !output.resolutionMismatch);
    const testMode =
      output && output.testPattern.mode !== 'off' && output.testPattern.until > now
        ? output.testPattern.mode
        : 'off';

    const blackout =
      !state ||
      !profile ||
      (!this.opts.preview &&
        (!output ||
          state.blackoutAll ||
          output.blackout ||
          this.localBlackout ||
          failoverBlack ||
          !this.calibrationOk));
    this.blackoutNow = blackout;
    const targetGain = blackout ? 0 : this.opts.preview ? 1 : output!.intensity;
    // Blackout is immediate; resume fades in.
    this.gain = targetGain < this.gain ? targetGain : Math.min(targetGain, this.gain + dtMs / 800);

    if (!state || !profile || (this.gain <= 0 && testMode === 'off' && !this.identifyActive(now))) {
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear();
      return;
    }

    const vp = profile.viewport;
    const vw = Math.max(2, Math.round(this.width * this.quality));
    const vh = Math.max(2, Math.round(this.height * this.quality));
    if (this.viewRT.width !== vw || this.viewRT.height !== vh) {
      this.viewRT.setSize(vw, vh);
      this.actorOverlay.resize(vw, vh);
      this.actorMaterial.uniforms.map!.value = this.actorOverlay.texture;
      this.viewOverlay.resize(vw, vh);
      this.viewOverlayMaterial.uniforms.map!.value = this.viewOverlay.texture;
    }
    const ppmView = vw / vp.w;

    // 1) Surface layers
    const visible = state.surfaces.filter((s) => bboxIntersects(polygonBBox(s.polygon), vp));
    const outputs = state.outputs;
    for (const s of visible) this.renderSurface(s, state, now, ppmView, dtMs, output, outputs);
    this.gcLayers(visible, wall);

    // 2) Actors (stage space)
    const actorsDrawn = this.renderActors(state, now, vp, ppmView, vw, vh, output, outputs);

    // 3) Compose the view
    this.syncMeshes(visible, actorsDrawn);
    this.viewCamera.left = vp.x;
    this.viewCamera.right = vp.x + vp.w;
    this.viewCamera.top = -vp.y;
    this.viewCamera.bottom = -(vp.y + vp.h);
    this.viewCamera.updateProjectionMatrix();
    r.setRenderTarget(this.viewRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    r.render(this.viewScene, this.viewCamera);

    const identify = this.identifyActive(now);
    if (testMode === 'grid' || identify) {
      this.viewOverlay.clear();
      const g = this.viewOverlay.g;
      if (testMode === 'grid') drawStageGrid(g, vw, vh, vp, state, output);
      if (identify && this.identify) drawIdentify(g, vw, vh, this.identify.label);
      this.viewOverlay.upload();
      const prev = r.autoClear;
      r.autoClear = false;
      r.render(this.viewOverlayScene, CLIP_CAMERA);
      r.autoClear = prev;
    }

    // 4) Safety limiter (child-safe): limit the rate of brightness increase.
    let limiter = 1;
    if (state.kidsSafe && !this.opts.preview) limiter = this.updateLimiter(dtMs);

    // 5) Final output pass
    this.updateMask(profile);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
    const showOverlay = !this.opts.preview && output && (output.showMasks || testMode !== 'off');
    const finalGain = this.opts.preview
      ? 1
      : Math.max(this.gain, testMode !== 'off' || identify ? 1 : 0) * limiter;
    if (testMode === 'raw') {
      this.maskOverlay.clear();
      drawRawPattern(this.maskOverlay.g, this.width, this.height, output?.name ?? '');
      this.maskOverlay.upload();
      this.rawMaterial.uniforms.map!.value = this.maskOverlay.texture;
      this.rawMaterial.uniforms.mask!.value = this.maskTexture;
      (this.rawMaterial.uniforms.outSize!.value as THREE.Vector2).set(this.width, this.height);
      r.render(this.rawScene, CLIP_CAMERA);
    } else {
      this.updateWarp(profile);
      this.finalMaterial.uniforms.view!.value = this.viewRT.texture;
      this.finalMaterial.uniforms.mask!.value = this.maskTexture;
      (this.finalMaterial.uniforms.outSize!.value as THREE.Vector2).set(this.width, this.height);
      this.finalMaterial.uniforms.gain!.value = finalGain;
      r.render(this.finalScene, CLIP_CAMERA);
    }
    if (showOverlay) {
      this.maskOverlay.clear();
      paintMaskOverlay(this.maskOverlay.g, this.width, this.height, profile);
      this.maskOverlay.upload();
      this.screenOverlayMaterial.uniforms.map!.value = this.maskOverlay.texture;
      const prev = r.autoClear;
      r.autoClear = false;
      r.render(this.screenOverlayScene, CLIP_CAMERA);
      r.autoClear = prev;
    }
  }

  private identifyActive(now: number): boolean {
    return !!this.identify && this.identify.until > Date.now() && now > 0;
  }

  private updateLimiter(dtMs: number): number {
    // Measure the composed view at low resolution every other frame (1 frame latency is fine).
    if (this.frameNo % 2 === 0) {
      const r = this.renderer;
      this.lumMaterial.uniforms.map!.value = this.viewRT.texture;
      r.setRenderTarget(this.lumRT);
      r.render(this.lumScene, CLIP_CAMERA);
      r.readRenderTargetPixels(this.lumRT, 0, 0, 32, 18, this.lumBuf);
      let sum = 0;
      for (let i = 0; i < this.lumBuf.length; i += 4) {
        sum += 0.2126 * this.lumBuf[i]! + 0.7152 * this.lumBuf[i + 1]! + 0.0722 * this.lumBuf[i + 2]!;
      }
      const raw = (sum / (this.lumBuf.length / 4) / 255) * this.gain;
      const maxRise = (dtMs / 1000) * 1.6 * 2; // measured every 2nd frame
      const allowed = this.limiterDisplayed + maxRise;
      this.limiterGain = raw > allowed && raw > 0.02 ? allowed / raw : 1;
      this.limiterDisplayed = Math.min(raw, allowed);
    }
    return this.limiterGain;
  }

  private updateMask(profile: Profile): void {
    const key = `${this.width}x${this.height}:${JSON.stringify(profile.masks)}:${profile.crop.join(',')}`;
    if (key === this.maskKey) return;
    this.maskKey = key;
    this.maskCanvas.width = this.width;
    this.maskCanvas.height = this.height;
    const g = this.maskCanvas.getContext('2d')!;
    paintMask(g, this.width, this.height, this.opts.preview ? { masks: [], crop: [0, 0, 0, 0] } : profile);
    this.maskTexture.dispose();
    this.maskTexture = canvasTexture(this.maskCanvas, false);
    this.maskTexture.minFilter = THREE.NearestFilter;
    this.maskTexture.magFilter = THREE.NearestFilter;
  }

  private updateWarp(profile: Profile): void {
    const key = JSON.stringify([
      profile.corners,
      profile.mesh,
      profile.rotation,
      profile.flipX,
      profile.flipY,
    ]);
    if (key === this.warpKey && this.warpGeometry) return;
    this.warpKey = key;
    const mesh = buildWarpMesh(profile, 32);
    this.warpGeometry?.dispose();
    this.finalScene.clear();
    if (!mesh) {
      this.warpGeometry = null;
      return;
    }
    const n = mesh.positions.length / 2;
    const pos = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = mesh.positions[i * 2]! * 2 - 1;
      pos[i * 3 + 1] = 1 - mesh.positions[i * 2 + 1]! * 2;
      uv[i * 2] = mesh.uvs[i * 2]!;
      uv[i * 2 + 1] = 1 - mesh.uvs[i * 2 + 1]!;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    this.warpGeometry = geo;
    const m = new THREE.Mesh(geo, this.finalMaterial);
    m.frustumCulled = false;
    this.finalScene.add(m);
  }

  private soundPrimaryFor(
    output: Output | null,
    outputs: readonly Output[],
    p: { x: number; y: number },
  ): boolean {
    if (!output || this.opts.preview || !this.opts.sound) return false;
    return primaryOutputAt(outputs, p)?.id === output.id;
  }

  private renderSurface(
    s: Surface,
    state: SessionState,
    now: number,
    ppmView: number,
    dtMs: number,
    output: Output | null,
    outputs: readonly Output[],
  ): void {
    let layer = this.layers.get(s.id);
    if (!layer) {
      layer = new SurfaceLayer(s.id);
      this.layers.set(s.id, layer);
    }
    layer.lastUsed = performance.now();
    const b = polygonBBox(s.polygon);
    const maxDim = 2048 * this.quality;
    let lw = Math.max(16, Math.round(b.w * ppmView));
    let lh = Math.max(16, Math.round(b.h * ppmView));
    const f = Math.min(1, maxDim / Math.max(lw, lh));
    lw = Math.round(lw * f);
    lh = Math.round(lh * f);
    layer.resize(lw, lh, lw / b.w);
    const r = this.renderer;
    const centroid = polygonCentroid(s.polygon);
    const primary = this.soundPrimaryFor(output, outputs, centroid);

    // Scene selection (deterministic from playback + clock)
    const active = activeScene(s.playback, state.playlists, now);
    if (active && now >= active.startedAt - 50) {
      const runtime = this.runtimes.get(active.scene.themeId);
      const mod = runtime?.scenes[active.scene.sceneId];
      if (mod && (!layer.current || layer.current.key !== active.key)) {
        const rt = makeRT(lw, lh);
        const inst = mod.create({
          renderer: r,
          width: lw,
          height: lh,
          ppm: layer.ppm,
          seed: active.seed,
          params: active.scene.params,
          kind: s.kind,
          quality: this.quality,
        });
        layer.disposeSlot(layer.previous);
        const elapsed = now - active.startedAt;
        // Only crossfade if we are inside the transition window (reconnect = no replay).
        layer.previous =
          layer.current && elapsed < active.transition.durationMs && active.transition.type !== 'cut'
            ? layer.current
            : null;
        if (!layer.previous) layer.disposeSlot(layer.current);
        const stopAmbient =
          primary && mod.ambientSound && this.opts.sound
            ? (mod.ambientSound(this.opts.sound, active.seed) ?? null)
            : null;
        layer.current = {
          key: active.key,
          inst,
          rt,
          active,
          paramsJson: JSON.stringify(active.scene.params),
          stopAmbient,
        };
      } else if (layer.current && layer.current.key === active.key) {
        const pj = JSON.stringify(active.scene.params);
        if (pj !== layer.current.paramsJson) {
          layer.current.inst.setParams(active.scene.params);
          layer.current.paramsJson = pj;
        }
      }
    }

    const frameFor = (slot: SceneSlot) => ({
      time: (now - slot.active.startedAt) / 1000,
      showTime: now,
      dt: dtMs / 1000,
    });
    const cur = layer.current;
    if (cur) cur.inst.render(cur.rt, frameFor(cur));
    let mixB = 0;
    if (layer.previous && cur) {
      const p = (now - cur.active.startedAt) / Math.max(1, cur.active.transition.durationMs);
      if (p >= 1) {
        layer.disposeSlot(layer.previous);
        layer.previous = null;
      } else {
        layer.previous.inst.render(layer.previous.rt, frameFor(layer.previous));
        mixB = 1 - Math.max(0, p);
      }
    }

    // Effects: cues + playlist ambient schedule
    const hasEffects = this.drawEffects(layer, s, state, now, active, primary);

    const u = layer.material.uniforms;
    u.texA!.value = cur?.rt.texture ?? null;
    u.texB!.value = layer.previous?.rt.texture ?? null;
    u.hasB!.value = layer.previous ? 1 : 0;
    u.mixB!.value = mixB;
    u.fadeBlack!.value = cur?.active.transition.type === 'fadeBlack' ? 1 : 0;
    u.hasOverlay!.value = hasEffects ? 1 : 0;
    u.overlay!.value = layer.overlay.texture;
    r.setRenderTarget(layer.layerRT);
    if (!cur) {
      r.setClearColor(0x000000, 1);
      r.clear();
      if (!hasEffects) return;
      u.texA!.value = null;
    }
    r.render(layer.quad, CLIP_CAMERA);
  }

  private drawEffects(
    layer: SurfaceLayer,
    s: Surface,
    state: SessionState,
    now: number,
    active: ActiveScene | null,
    primary: boolean,
  ): boolean {
    type Item = {
      key: string;
      themeId: string;
      effectId: string;
      startAt: number;
      duration: number;
      seed: number;
      params: Record<string, number | boolean | string>;
    };
    const items: Item[] = [];
    for (const c of state.cues) {
      if (c.kind !== 'effect' || !c.surfaceIds.includes(s.id)) continue;
      if (now < c.startAt || now >= c.endAt) continue;
      items.push({
        key: c.id,
        themeId: c.themeId,
        effectId: c.effectId,
        startAt: c.startAt,
        duration: c.endAt - c.startAt,
        seed: c.seed,
        params: c.params,
      });
    }
    if (active?.position?.item.ambient) {
      for (const sch of ambientSchedule(active)) {
        const eff = this.opts.catalog
          .get(sch.effect.themeId)
          ?.effects.find((e) => e.id === sch.effect.effectId);
        if (!eff || (state.kidsSafe && !eff.childSafe)) continue;
        if (now < sch.at || now >= sch.at + eff.durationMs) continue;
        this.ensureRuntime(sch.effect.themeId);
        items.push({
          key: sch.key,
          themeId: sch.effect.themeId,
          effectId: sch.effect.effectId,
          startAt: sch.at,
          duration: eff.durationMs,
          seed: sch.seed,
          params: {},
        });
      }
    }
    if (items.length === 0) {
      if (layer.overlay.dirty) {
        layer.overlay.clear();
        layer.overlay.upload();
        layer.overlay.dirty = false;
      }
      return false;
    }
    layer.overlay.clear();
    const g = layer.overlay.g;
    for (const it of items) {
      const mod = this.runtimes.get(it.themeId)?.effects[it.effectId];
      if (!mod) continue;
      const t = (now - it.startAt) / 1000;
      g.save();
      mod.draw(g, {
        w: layer.w,
        h: layer.h,
        ppm: layer.ppm,
        t,
        progress: Math.min(1, (now - it.startAt) / it.duration),
        duration: it.duration / 1000,
        seed: it.seed,
        params: it.params,
        rng: createRng(it.seed),
      });
      g.restore();
      if (primary && mod.sound && !layer.startedEffects.has(it.key) && now - it.startAt < 600) {
        layer.startedEffects.add(it.key);
        try {
          mod.sound(this.opts.sound!, it.seed);
        } catch {
          /* ignore audio errors */
        }
      }
    }
    if (layer.startedEffects.size > 200) layer.startedEffects.clear();
    layer.overlay.upload();
    layer.overlay.dirty = true;
    return true;
  }

  private renderActors(
    state: SessionState,
    now: number,
    vp: Viewport,
    ppm: number,
    vw: number,
    vh: number,
    output: Output | null,
    outputs: readonly Output[],
  ): boolean {
    const cues: ActorCue[] = state.cues.filter(
      (c): c is ActorCue => c.kind === 'actor' && now >= c.startAt && now < c.endAt,
    );
    const ambient = ambientActorCues(state.ambient, state.surfaces, this.opts.catalog, now).filter((c) => {
      const a = this.opts.catalog.get(c.themeId)?.actors.find((x) => x.id === c.actorId);
      return a && (!state.kidsSafe || a.childSafe) && now >= c.startAt && now < c.endAt;
    });
    const all = [...cues, ...ambient];
    const o = this.actorOverlay;
    if (all.length === 0) {
      if (o.dirty) {
        o.clear();
        o.upload();
        o.dirty = false;
      }
      return false;
    }
    o.clear();
    const g = o.g;
    g.setTransform(ppm, 0, 0, ppm, -vp.x * ppm, -vp.y * ppm);
    const layoutKey = hashString(
      state.surfaces.map((s) => `${s.id}:${JSON.stringify(s.polygon)}:${s.kind}`).join('|'),
    );
    let drew = false;
    for (const cue of all) {
      const manifest = this.opts.catalog.get(cue.themeId)?.actors.find((a) => a.id === cue.actorId);
      this.ensureRuntime(cue.themeId);
      const mod = this.runtimes.get(cue.themeId)?.actors[cue.actorId];
      if (!manifest || !mod) continue;
      for (let i = 0; i < cue.count; i++) {
        const rkey = `${cue.id}:${cue.seed}:${i}:${layoutKey}`;
        let route = this.routes.get(rkey);
        if (route === undefined) {
          route = buildActorRoute(state.surfaces, manifest, cue, i);
          this.routes.set(rkey, route);
          if (this.routes.size > 300) this.routes.delete(this.routes.keys().next().value as string);
        }
        if (!route) continue;
        const pose = routePose(route, now - cue.startAt);
        if (!pose.visible) continue;
        const half = manifest.sizeM;
        if (
          pose.x < vp.x - half ||
          pose.y < vp.y - half ||
          pose.x > vp.x + vp.w + half ||
          pose.y > vp.y + vp.h + half
        )
          continue;
        g.save();
        g.translate(pose.x, pose.y);
        if (!mod.upright) g.rotate(pose.angle);
        const sizePx = manifest.sizeM * ppm;
        g.scale(1 / ppm, 1 / ppm);
        mod.draw(g, pose, { ppm, t: (now - cue.startAt) / 1000, seed: cue.seed + i, sizePx });
        g.restore();
        drew = true;
        if (mod.sound && pose.moving && this.soundPrimaryFor(output, outputs, pose)) {
          const k = `${cue.id}:${i}`;
          const last = this.actorSoundAt.get(k) ?? 0;
          if (now - last > 2500) {
            this.actorSoundAt.set(k, now);
            try {
              mod.sound(this.opts.sound!, cue.seed + i);
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    if (this.actorSoundAt.size > 200) this.actorSoundAt.clear();
    o.upload();
    o.dirty = true;
    (this.actorMaterial.uniforms.viewSize!.value as THREE.Vector2).set(vw, vh);
    return drew;
  }

  private syncMeshes(visible: Surface[], actorsDrawn: boolean): void {
    const keep = new Set(visible.map((s) => s.id));
    for (const [id, m] of this.meshes) {
      if (!keep.has(id)) {
        this.viewScene.remove(m.surface, m.actors);
        m.geometry.dispose();
        (m.surface.material as THREE.Material).dispose();
        this.meshes.delete(id);
      }
    }
    visible.forEach((s, idx) => {
      const key = JSON.stringify(s.polygon);
      let m = this.meshes.get(s.id);
      if (!m || m.key !== key) {
        if (m) {
          this.viewScene.remove(m.surface, m.actors);
          m.geometry.dispose();
          (m.surface.material as THREE.Material).dispose();
        }
        const geometry = polygonGeometry(s.polygon);
        const mat = new THREE.ShaderMaterial({
          uniforms: { map: { value: null }, intensity: { value: 1 } },
          vertexShader: VERT,
          fragmentShader: SURFACE_FRAG,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        });
        const surface = new THREE.Mesh(geometry, mat);
        const actors = new THREE.Mesh(geometry, this.actorMaterial);
        surface.frustumCulled = false;
        actors.frustumCulled = false;
        m = { key, surface, actors, geometry };
        this.meshes.set(s.id, m);
        this.viewScene.add(surface, actors);
      }
      const layer = this.layers.get(s.id);
      const mat = m.surface.material as THREE.ShaderMaterial;
      mat.uniforms.map!.value = layer?.layerRT.texture ?? null;
      mat.uniforms.intensity!.value = s.intensity;
      m.surface.visible = !!layer;
      m.surface.renderOrder = idx;
      m.actors.renderOrder = 1000 + idx;
      m.actors.visible = actorsDrawn;
    });
  }

  private gcLayers(visible: Surface[], _wall: number): void {
    const keep = new Set(visible.map((s) => s.id));
    for (const [id, l] of this.layers) {
      if (!keep.has(id)) {
        l.dispose();
        this.layers.delete(id);
      }
    }
  }
}

function padViewport(b: { x: number; y: number; w: number; h: number }, aspect: number): Viewport {
  let w = b.w * 1.06;
  let h = b.h * 1.06;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
}

/** Triangulated polygon in view space (y negated) with UVs over its bbox (v up = top). */
function polygonGeometry(poly: readonly { x: number; y: number }[]): THREE.BufferGeometry {
  const b = polygonBBox(poly);
  const contour = poly.map((p) => new THREE.Vector2(p.x, p.y));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(poly.length * 3);
  const uv = new Float32Array(poly.length * 2);
  poly.forEach((p, i) => {
    pos[i * 3] = p.x;
    pos[i * 3 + 1] = -p.y;
    pos[i * 3 + 2] = 0;
    uv[i * 2] = (p.x - b.x) / b.w;
    uv[i * 2 + 1] = 1 - (p.y - b.y) / b.h;
  });
  const idx: number[] = [];
  for (const t of tris) idx.push(t[0]!, t[1]!, t[2]!);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}
