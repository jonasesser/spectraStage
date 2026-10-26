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
  itemCueSchedule,
  bboxIntersects,
  buildActorRoute,
  createRng,
  hashString,
  polygonBBox,
  worldLayout,
  completeRoom,
  roomFold,
  viewerPoint,
  roomHit,
  faceLocal,
  dirFromAngles,
  facePoint,
  roomRay,
  boxFrame,
  faceWall,
  wallQuads,
  stageBounds,
  mainAzimuth,
  type RoomFold,
  wallRing,
  hashInts,
  type WorldSurface,
  polygonCentroid,
  primaryOutputAt,
  UNIT_QUAD,
  type ActiveScene,
  type ActorCue,
  type Output,
  type Profile,
  type RoomObject,
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
import {
  drawAlignOverlay,
  drawCornerMarkers,
  drawObjectOutline,
  drawRawPattern,
  drawStageGrid,
  drawIdentify,
} from './testPattern.ts';

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
  /** Keep the drawing buffer so the canvas can be copied (e.g. as a texture for the 3D room view). */
  readable?: boolean;
  /** Upper bound for the internal render resolution (default: native up to 4K). */
  maxRenderPixels?: number;
  /** GPU choice on PCs with two graphics chips (default high-performance). */
  powerPreference?: 'high-performance' | 'low-power';
}

/** A ghost photo prepared for drawing (ghostly look + glow). */
export interface GhostPicture {
  img: CanvasImageSource & { width: number; height: number };
  glow: CanvasImageSource & { width: number; height: number };
}

export interface LiveSprite {
  canvas: HTMLCanvasElement;
  /** 0..1 – fade in/out. */
  alpha: number;
  /** Horizontal place in the camera picture (0 left … 1 right), kept on the wall. */
  u: number;
  /** Stable id (own drift and bobbing per person). */
  id: number;
}

export interface RendererStats {
  fps: number;
  quality: number;
  calibrationOk: boolean;
  width: number;
  height: number;
  blackout: boolean;
  /** GPU context lost (picture black until restored). */
  contextLost: boolean;
  /** Last frame error (rendering problem), if any in the last minute. */
  lastError: string | null;
  /** Graphics card as reported by the browser (diagnostics). */
  gpu: string;
  /** Internal render size (before upscaling to the canvas). */
  renderW: number;
  renderH: number;
  /** Why black is drawn on purpose, or null. */
  blackReason: string | null;
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const CLIP_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

/** Proportions of a side: virtual size factors, anchor, and the easing warp for the layer shader. */
interface Proportion {
  fx: number;
  fy: number;
  ax: number;
  ay: number;
  warp: [number, number, number, number];
  /** Shift of the picture in fractions of the (virtual) side, and the object size factor. */
  dx: number;
  dy: number;
  obj: number;
  key: string;
}

const NO_PROP: Proportion = {
  fx: 1,
  fy: 1,
  ax: 0.5,
  ay: 0.5,
  warp: [0, 0, 1, 1],
  dx: 0,
  dy: 0,
  obj: 1,
  key: '',
};

const LAYER_FRAG = /* glsl */ `
uniform sampler2D texA;
uniform sampler2D texB;
uniform sampler2D overlay;
uniform float mixB;     // 0 = only A (current), 1 = only B (previous)
uniform float fadeBlack; // 1 = fade through black mode
uniform float hasB;
uniform float hasOverlay;
// proportions that ease in from the edge towards the front wall: x = mode (0 none, 1 the edge is
// vertical / depth runs along x, 2 the edge is horizontal / depth runs along y), y = where the
// edge is (0 or 1), z = proportion along the depth, w = proportion along the edge
uniform vec4 uWarp;
varying vec2 vUv;
vec2 warpUv(vec2 uv) {
  if (uWarp.x < 0.5) return uv;
  float X = uv.x;
  float Yd = 1.0 - uv.y;
  bool alongX = uWarp.x < 1.5;
  float d = abs((alongX ? X : Yd) - uWarp.y);
  float pd = uWarp.z;
  float pa = uWarp.w;
  // depth: the scale grows from 100 % at the edge to the set value at the far end
  float ld = (1.0 + 1.0 / pd) * 0.5;
  float cd = (d + (1.0 / pd - 1.0) * d * d * 0.5) / ld;
  float depthC = uWarp.y > 0.5 ? 1.0 - cd : cd;
  // along the edge: the same, around the middle
  float la = max(1.0, 1.0 / pa);
  float s = 1.0 + (1.0 / pa - 1.0) * d;
  if (alongX) return vec2(depthC, 1.0 - (0.5 + (Yd - 0.5) * s / la));
  return vec2(0.5 + (X - 0.5) * s / la, 1.0 - depthC);
}
void main() {
  vec3 a = texture2D(texA, warpUv(vUv)).rgb;
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
uniform float boost;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(view, vUv).rgb;
  if (boost > 0.0) {
    // Dusk boost: lift mid-tones and saturation so content survives ambient light. Black stays black.
    c = pow(max(c, vec3(0.0)), vec3(1.0 / (1.0 + boost * 0.9)));
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = clamp(mix(vec3(l), c, 1.0 + boost * 0.6), 0.0, 1.0);
  }
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

/** Light on real objects: dark (masked), glow, flicker (fire), spooky (colour drift), edges. */
const OBJECT_FRAG = `
uniform vec3 uColor;
uniform float uTime;
uniform float uMode;
varying vec2 vUv;
float h1(float n){ return fract(sin(n) * 43758.5453); }
float n1(float x){ float i = floor(x); float f = fract(x); return mix(h1(i), h1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
void main() {
  float e = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float line = smoothstep(0.035, 0.0, e);
  vec3 c = vec3(0.0);
  if (uMode < 0.5) c = vec3(0.0);
  else if (uMode < 1.5) c = uColor * (0.7 + 0.3 * sin(uTime * 1.5)) + uColor * line * 0.5;
  else if (uMode < 2.5) c = uColor * (0.45 + 0.55 * n1(uTime * 9.0) * n1(uTime * 3.1 + 7.0)) * (0.8 + 0.4 * (1.0 - vUv.y));
  else if (uMode < 3.5) c = mix(uColor, vec3(0.55, 0.2, 1.0), 0.5 + 0.5 * sin(uTime * 0.9 + vUv.y * 3.0)) * (0.65 + 0.35 * sin(uTime * 2.3));
  else c = uColor * line * 1.3 + uColor * 0.04;
  gl_FragColor = vec4(c, 1.0);
}
`;

const CLIP_CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
/** Creature/effect overlays are uploaded at this fraction of the view resolution. */
const OVERLAY_SCALE = 0.75;
/** Upper bound for the internal render resolution (native 4K); adaptive quality scales down. */
const MAX_RENDER_PIXELS = 3840 * 2400;
/** Pixel budget for 2D overlays (creatures, test grid) – they are uploaded to the GPU per frame. */
const OVERLAY_MAX_PIXELS = 4_200_000;
/** Pixel budget for the room atlas of a projector in the room (≈ 1.5 × 4K). */
const ATLAS_MAX_PIXELS = 12_500_000;

/** Lens shift: moves the picture center off the optical axis (same model as projectPose). */
export function applyLensShift(
  cam: THREE.PerspectiveCamera,
  pose: { shiftX?: number; shiftY?: number },
): void {
  cam.projectionMatrix.elements[8] = -(pose.shiftX ?? 0);
  cam.projectionMatrix.elements[9] = -(pose.shiftY ?? 0);
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
}

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

interface WorldInfo {
  key: string;
  floorLit: boolean;
  fold: RoomFold;
  viewer: [number, number, number];
  wrap: { x: number; w: number } | null;
  surfaces: WorldSurface[];
  bounds: { x: number; y: number; w: number; h: number };
}

interface SceneSlot {
  key: string;
  inst: SceneInstance;
  rt: THREE.WebGLRenderTarget;
  active: ActiveScene;
  paramsJson: string;
  stopAmbient: (() => void) | null;
  worldKey: string;
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
        uWarp: { value: new THREE.Vector4(0, 0, 1, 1) },
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
    this.overlay.resize(
      Math.max(2, Math.round(w * OVERLAY_SCALE)),
      Math.max(2, Math.round(h * OVERLAY_SCALE)),
    );
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
  private previewFocus: number | null = null;
  private previewViewport: Viewport | null = null;
  private runtimes = new Map<string, ThemeRuntime>();
  private loading = new Set<string>();
  private layers = new Map<string, SurfaceLayer>();
  private meshes = new Map<string, SurfaceMesh>();
  private viewRT: THREE.WebGLRenderTarget;
  private viewScene = new THREE.Scene();
  private viewCamera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  /** Projector-in-room rendering: the stage atlas (viewRT) is wrapped onto the folded room and
   *  seen from the projector's pose. */
  private poseRT: THREE.WebGLRenderTarget | null = null;
  private poseScene = new THREE.Scene();
  private poseCamera = new THREE.PerspectiveCamera(50, 16 / 9, 0.05, 200);
  private poseKey = '';
  private poseRoom = new THREE.Group();
  private poseObjects = new THREE.Group();
  private poseObjectsKey = '';
  private poseMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader: VERT,
    fragmentShader:
      'uniform sampler2D map; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(map, vUv).rgb, 1.0); }',
    side: THREE.DoubleSide,
  });
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
  private qualityInit = false;
  private frameErrors = 0;
  private renderW = 0;
  private renderH = 0;
  private blackReason: string | null = null;
  private captureReq: {
    maxW: number;
    image: boolean;
    done: (r: { lum: number; image?: string }) => void;
  } | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private lastError: { msg: string; at: number } | null = null;
  /** GPU limit for texture / render target sides. */
  private maxTex = 4096;
  private autoCap = false;
  private lumPending = false;
  private lumAt = 0;
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
      powerPreference: opts.powerPreference ?? 'high-performance',
      preserveDrawingBuffer: !!opts.readable,
    });
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    this.renderer.setClearColor(0x000000, 1);
    this.maxTex = this.renderer.capabilities.maxTextureSize || 4096;
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
        boost: { value: 0 },
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
  setPreviewProfile(profile: Profile | null, focus?: number): void {
    this.previewProfile = profile;
    // focus is set while the controller's calibration editor is open: grid on, corner highlighted.
    this.previewFocus = profile && focus !== undefined ? focus : null;
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
      contextLost: this.contextLost,
      gpu: this.gpuName(),
      renderW: this.renderW,
      renderH: this.renderH,
      blackReason: this.blackReason,
      lastError: this.lastError && Date.now() - this.lastError.at < 60_000 ? this.lastError.msg : null,
    };
  }

  private ghostImages: ((id: string) => GhostPicture | null) | null = null;
  /** Ghost photos (zombie camera) for the flying ghosts of the show. */
  setGhostImages(fn: ((id: string) => GhostPicture | null) | null): void {
    this.ghostImages = fn;
  }

  /**
   * A ghost photo flying around: it rises from where the person stood, then drifts along the
   * walls (around the room), waving like cloth, with a fading tail, a glow and a faint trail.
   */
  private drawGhostFlight(
    g: CanvasRenderingContext2D,
    state: SessionState,
    f: NonNullable<SessionState['ghostFlights']>[number],
    gi: GhostPicture,
    now: number,
  ): boolean {
    const world = this.worldFor(state);
    const main = world.surfaces.find((w) => w.role === 'main');
    if (!main) return false;
    const r = main.rect;
    const rng = createRng(f.seed);
    const t = (now - f.startAt) / 1000;
    const T = (f.endAt - f.startAt) / 1000;
    const h = r.h * (0.42 + 0.14 * rng());
    const w = (h * gi.img.width) / gi.img.height;
    const dir = rng() < 0.5 ? -1 : 1;
    const speed = r.w * (0.05 + 0.06 * rng());
    const s1 = rng() * 6.28;
    const s2 = rng() * 6.28;
    const s3 = rng() * 6.28;
    const x0 = r.x + r.w * (0.14 + 0.72 * (f.u ?? rng()));
    const ring = world.wrap;
    const posAt = (tt: number): [number, number] => {
      // detach: rise from the person's place, then wander
      const k = Math.min(1, Math.max(0, tt / 2.8));
      const e = k * k * (3 - 2 * k);
      const wanderT = Math.max(0, tt - 1.5);
      // swings around the front wall (where most projectors are), now and then reaching the
      // side walls, and slowly drifts on around the room
      const cxw = r.x + r.w * 0.5;
      let x =
        x0 +
        (cxw - x0) * e * 0.6 +
        r.w * 0.55 * Math.sin(wanderT * 0.23 + s1) * e +
        r.w * 0.12 * Math.sin(wanderT * 0.71 + s2) * e +
        dir * speed * 0.15 * wanderT;
      const yRise = r.y + r.h * 0.98 - h * 0.5;
      const yFly = r.y + r.h * (0.36 + 0.13 * Math.sin(tt * 0.6 + s2) + 0.05 * Math.sin(tt * 1.9 + s3));
      let y = yRise + (yFly - yRise) * e;
      // fly away upwards at the end
      const out = Math.max(0, tt - (T - 2.5)) / 2.5;
      y -= out * out * r.h * 0.5;
      if (ring) x = ring.x + ((((x - ring.x) % ring.w) + ring.w) % ring.w);
      else x = r.x + r.w * 0.5 + r.w * 0.45 * Math.sin((x - r.x) / (r.w * 0.45));
      return [x, y];
    };
    const fadeIn = Math.min(1, t / 1.6);
    const fadeOut = Math.min(1, Math.max(0, (T - t) / 2.5));
    const alpha = 0.78 * fadeIn * fadeOut * (0.9 + 0.1 * Math.sin(t * 7.3 + s1));
    if (alpha <= 0.01) return false;
    const [cx, cy] = posAt(t);
    const [px] = posAt(t - 0.2);
    const vx = (cx - px) / 0.2;
    const tilt = Math.max(-0.35, Math.min(0.35, (vx / Math.max(0.01, r.w)) * 1.2));
    const scale = (0.85 + 0.15 * Math.min(1, t / 2.8)) * (1 + 0.03 * Math.sin(t * 2.1 + s2));
    const drawAt = (x: number, y: number, a: number, slices: boolean) => {
      g.save();
      g.translate(x, y);
      g.rotate(tilt);
      g.scale(scale, scale);
      // glow
      g.globalAlpha = a * 0.55;
      g.globalCompositeOperation = 'lighter';
      const gw = (w * gi.glow.width) / gi.img.width;
      const gh = (h * gi.glow.height) / gi.img.height;
      g.drawImage(gi.glow, -gw / 2, -gh / 2, gw, gh);
      g.globalCompositeOperation = 'source-over';
      if (!slices) {
        g.globalAlpha = a;
        g.drawImage(gi.img, -w / 2, -h / 2, w, h);
      } else {
        // waving like cloth, stronger towards the tail, which fades out
        const N = 22;
        const ih = gi.img.height;
        for (let i = 0; i < N; i++) {
          const sy = i / N;
          const tail = sy < 0.55 ? 1 : Math.max(0, 1 - (sy - 0.55) / 0.45);
          if (tail <= 0) continue;
          const dx = Math.sin(sy * 5.5 - t * 2.6 + s3) * w * 0.035 * (0.25 + sy * 1.4);
          const spread = 1 + Math.max(0, sy - 0.6) * 0.25;
          g.globalAlpha = a * tail;
          g.drawImage(
            gi.img,
            0,
            (ih * i) / N,
            gi.img.width,
            ih / N + 1,
            -(w * spread) / 2 + dx,
            -h / 2 + (h * i) / N,
            w * spread,
            h / N + h * 0.003,
          );
        }
      }
      g.restore();
    };
    // faint trail behind, then the ghost (also across the seam of the room's wall ring)
    const shifts = ring ? [0, -ring.w, ring.w] : [0];
    for (const sh of shifts) {
      const [tx1, ty1] = posAt(t - 0.18);
      const [tx2, ty2] = posAt(t - 0.36);
      if (!ring || Math.abs(tx1 - cx) < ring.w / 2) drawAt(tx1 + sh, ty1, alpha * 0.16, false);
      if (!ring || Math.abs(tx2 - cx) < ring.w / 2) drawAt(tx2 + sh, ty2, alpha * 0.08, false);
      drawAt(cx + sh, cy, alpha, true);
    }
    return true;
  }

  private liveSprite: (() => LiveSprite[]) | null = null;
  /** Live pictures (e.g. people from the zombie camera) drawn into the world on the main wall. */
  setLiveSprite(fn: (() => LiveSprite[]) | null): void {
    this.liveSprite = fn;
  }

  private gpu: string | null = null;
  private gpuName(): string {
    if (this.gpu === null) {
      try {
        const gl = this.renderer.getContext();
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        this.gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
      } catch {
        this.gpu = '?';
      }
    }
    return this.gpu;
  }

  /**
   * What the app actually puts on the canvas (read right after drawing, so no preserved buffer
   * is needed): average brightness and optionally a small JPEG for the admin.
   */
  capture(maxW: number, image: boolean): Promise<{ lum: number; image?: string }> {
    return new Promise((done) => {
      this.captureReq?.done({ lum: 0 });
      this.captureReq = { maxW, image, done };
    });
  }

  private doCapture(): void {
    const req = this.captureReq!;
    this.captureReq = null;
    try {
      const src = this.opts.canvas;
      const w = Math.max(16, Math.min(req.maxW, src.width));
      const h = Math.max(9, Math.round((w * src.height) / Math.max(1, src.width)));
      const c = (this.captureCanvas ??= document.createElement('canvas'));
      c.width = w;
      c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(src, 0, 0, w, h);
      const px = g.getImageData(0, 0, w, h).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 16)
        sum += 0.2126 * px[i]! + 0.7152 * px[i + 1]! + 0.0722 * px[i + 2]!;
      const lum = sum / (px.length / 16) / 255;
      req.done({ lum, image: req.image ? c.toDataURL('image/jpeg', 0.6) : undefined });
    } catch {
      req.done({ lum: 0 });
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      try {
        this.frame(t);
        this.frameErrors = 0;
        if (this.captureReq) this.doCapture();
      } catch (e) {
        console.error('[SpectraStage] frame error', e);
        this.lastError = { msg: String((e as Error)?.message ?? e).slice(0, 160), at: Date.now() };
        // Persistent errors (e.g. out of GPU memory at a very high resolution): step down.
        if (++this.frameErrors >= 10) {
          this.frameErrors = 0;
          this.quality = Math.max(0.35, this.quality * 0.7);
          this.resetLayers();
        }
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
          ? padViewport(stageBounds(completeRoom(this.state.surfaces)), this.width / Math.max(1, this.height))
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
    if (!this.qualityInit && !this.opts.preview) {
      // Start large outputs (4K) at ~QHD and let the adaptive quality climb to native when the
      // GPU keeps up – a weak GPU then never gets overloaded on the first frames.
      this.qualityInit = true;
      this.quality = Math.min(1, Math.max(0.5, Math.sqrt(3_700_000 / (w * h))));
    }
    return true;
  }

  private adaptQuality(dtMs: number, wall: number): void {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 60 || this.opts.preview) return;
    const fps = 1000 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
    const perf = this.output()?.performance ?? 'auto';
    const capped = perf === 'eco' || (perf === 'auto' && this.autoCap);
    if (capped) {
      // Running at 30 fps: only lower the resolution if even that is not reached.
      if (fps < 26 && this.quality > 0.36) {
        this.quality = Math.max(0.35, this.quality * 0.85);
        this.frameTimes = [];
      }
      return;
    }
    if (fps < 45 && perf === 'auto' && this.quality <= 0.6) {
      // Resolution already reduced and still slow: switch to a smooth 30 fps instead of stuttering.
      this.autoCap = true;
      this.frameTimes = [];
      return;
    }
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
    // Frame-rate cap (eco or automatic 30 fps fallback on weak hardware).
    const perfMode = this.opts.preview ? 'auto' : (this.output()?.performance ?? 'auto');
    const interval = perfMode === 'eco' || (perfMode === 'auto' && this.autoCap) ? 1000 / 30 : 0;
    if (interval > 0 && this.lastFrame && wall - this.lastFrame < interval - 4) return;
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
        : this.previewFocus !== null
          ? 'grid'
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
    this.blackReason = !blackout
      ? null
      : !state
        ? 'no-show'
        : !profile || (!this.opts.preview && !output)
          ? 'no-output'
          : state.blackoutAll || output?.blackout
            ? 'blackout'
            : this.localBlackout
              ? 'local-blackout'
              : failoverBlack
                ? 'offline'
                : 'format';
    const targetGain = blackout ? 0 : this.opts.preview ? 1 : output!.intensity;
    // Blackout is immediate; resume fades in.
    this.gain = targetGain < this.gain ? targetGain : Math.min(targetGain, this.gain + dtMs / 800);

    const aligning = !!output?.align && output.align.until > now && !!profile?.pose;
    if (
      !state ||
      !profile ||
      (this.gain <= 0 && testMode === 'off' && !aligning && !this.identifyActive(now))
    ) {
      r.setRenderTarget(null);
      r.setClearColor(0x000000, 1);
      r.clear();
      return;
    }

    // Projector in the room (pose): the room sides this projector reaches are rendered as an
    // atlas (in stage coordinates) and then seen from the projector; otherwise the classic flat
    // viewport of the unfolded stage.
    const pose = this.opts.preview ? null : (profile.pose ?? null);
    // Internal resolution: native up to 4K × adaptive quality (weak GPUs scale down).
    const perf = output?.performance ?? 'auto';
    const cap = Math.min(
      1,
      Math.sqrt((this.opts.maxRenderPixels ?? MAX_RENDER_PIXELS) / Math.max(1, this.width * this.height)),
    );
    const q = this.quality * cap * (perf === 'eco' ? 0.7 : 1);
    const ow = Math.max(2, Math.round(this.width * q));
    const oh = Math.max(2, Math.round(this.height * q));
    this.renderW = ow;
    this.renderH = oh;
    let vp: Viewport = profile.viewport;
    let vw = ow;
    let vh = oh;
    let seen: Set<string> | null = null;
    if (pose) {
      const atlas = this.poseAtlas(state, pose, ow, oh, profile?.walls ?? []);
      vp = atlas.vp;
      vw = atlas.w;
      vh = atlas.h;
      seen = atlas.seen;
    }
    if (this.viewRT.width !== vw || this.viewRT.height !== vh) {
      this.viewRT.setSize(vw, vh);
      // 2D overlays are uploaded every frame they change: keep them within a pixel budget
      const os = Math.min(OVERLAY_SCALE, Math.sqrt(OVERLAY_MAX_PIXELS / (vw * vh)));
      this.actorOverlay.resize(Math.max(2, Math.round(vw * os)), Math.max(2, Math.round(vh * os)));
      this.actorMaterial.uniforms.map!.value = this.actorOverlay.texture;
      const vs = Math.min(1, Math.sqrt(OVERLAY_MAX_PIXELS / (vw * vh)));
      this.viewOverlay.resize(Math.max(2, Math.round(vw * vs)), Math.max(2, Math.round(vh * vs)));
      this.viewOverlayMaterial.uniforms.map!.value = this.viewOverlay.texture;
    }
    const ppmView = vw / vp.w;

    // 1) Surface layers
    // the room always has its 6 sides: in the room view and in the stage preview the ones the app
    // adds itself are drawn too
    let visible = (pose || this.opts.preview ? completeRoom(state.surfaces) : state.surfaces).filter((s) =>
      bboxIntersects(polygonBBox(s.polygon), vp),
    );
    if (seen) visible = visible.filter((s) => seen.has(s.id));
    const outputs = state.outputs;
    const world = this.worldFor(state);
    for (const s of visible)
      this.renderSurface(
        s,
        state,
        now,
        ppmView,
        dtMs,
        output,
        outputs,
        world,
        this.proportionFor(s, profile, world, !!pose),
      );
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
      if (testMode === 'grid')
        drawStageGrid(
          g,
          this.viewOverlay.canvas.width,
          this.viewOverlay.canvas.height,
          vp,
          state,
          pose ? null : output,
          pose ? null : this.previewFocus,
          now,
          !pose,
        );
      if (identify && this.identify)
        drawIdentify(g, this.viewOverlay.canvas.width, this.viewOverlay.canvas.height, this.identify.label);
      this.viewOverlay.upload();
      const prev = r.autoClear;
      r.autoClear = false;
      r.render(this.viewOverlayScene, CLIP_CAMERA);
      r.autoClear = prev;
    }

    // 3b) Projector in the room: wrap the atlas onto the folded room, look through the projector
    let viewTex: THREE.Texture = this.viewRT.texture;
    if (pose) {
      viewTex = this.renderPose(state, pose, vp, ow, oh, testMode === 'grid', now, profile, output);
    }

    // 4) Safety limiter (child-safe): limit the rate of brightness increase.
    let limiter = 1;
    this.limiterTex = viewTex;
    if (state.kidsSafe && !this.opts.preview) limiter = this.updateLimiter(dtMs);

    // 5) Final output pass
    this.updateMask(profile);
    r.setRenderTarget(null);
    r.setClearColor(0x000000, 1);
    r.clear();
    const showOverlay = !this.opts.preview && output && (output.showMasks || testMode !== 'off');
    const finalGain = this.opts.preview
      ? 1
      : Math.max(this.gain, testMode !== 'off' || identify || aligning ? 1 : 0) * limiter;
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
      this.finalMaterial.uniforms.view!.value = viewTex;
      this.finalMaterial.uniforms.mask!.value = this.maskTexture;
      (this.finalMaterial.uniforms.outSize!.value as THREE.Vector2).set(this.width, this.height);
      this.finalMaterial.uniforms.gain!.value = finalGain;
      this.finalMaterial.uniforms.boost!.value = state.boost ?? 0;
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

  private limiterTex: THREE.Texture | null = null;

  private updateLimiter(dtMs: number): number {
    // Measure the composed view at low resolution every other frame (1 frame latency is fine).
    // Asynchronous readback (no GPU pipeline stall); at most one measurement in flight.
    void dtMs;
    if (!this.lumPending) {
      const r = this.renderer;
      this.lumMaterial.uniforms.map!.value = this.limiterTex;
      r.setRenderTarget(this.lumRT);
      r.render(this.lumScene, CLIP_CAMERA);
      this.lumPending = true;
      const gain = this.gain;
      r.readRenderTargetPixelsAsync(this.lumRT, 0, 0, 32, 18, this.lumBuf)
        .then(() => {
          let sum = 0;
          for (let i = 0; i < this.lumBuf.length; i += 4) {
            sum += 0.2126 * this.lumBuf[i]! + 0.7152 * this.lumBuf[i + 1]! + 0.0722 * this.lumBuf[i + 2]!;
          }
          const now = performance.now();
          const elapsed = this.lumAt ? Math.min(250, now - this.lumAt) : 16.7;
          this.lumAt = now;
          const raw = (sum / (this.lumBuf.length / 4) / 255) * gain;
          const allowed = this.limiterDisplayed + (elapsed / 1000) * 1.6;
          this.limiterGain = raw > allowed && raw > 0.02 ? allowed / raw : 1;
          this.limiterDisplayed = Math.min(raw, allowed);
        })
        .catch(() => {
          /* context lost etc. */
        })
        .finally(() => (this.lumPending = false));
    }
    return this.limiterGain;
  }

  private updateMask(profile: Profile): void {
    const key = `${this.width}x${this.height}:${JSON.stringify(profile.masks)}:${profile.crop.join(',')}:${(profile.blend ?? []).join(',')}`;
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
      profile.fold ?? null,
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

  /**
   * Atlas for a projector in the room: only the room sides inside its frustum, at the pixel
   * density the projector actually puts on them (sharp at 4K), within a pixel budget.
   */
  private atlasCache: { key: string; vp: Viewport; ppm: number; seen: Set<string> } | null = null;
  private poseAtlas(
    state: SessionState,
    pose: NonNullable<Profile['pose']>,
    ow: number,
    oh: number,
    walls: readonly string[] = [],
  ): { vp: Viewport; w: number; h: number; seen: Set<string> } {
    const world = this.worldFor(state);
    const fold = world.fold;
    const key = `${world.key}|${JSON.stringify(pose)}|${ow}x${oh}|${walls.join(',')}`;
    if (this.atlasCache?.key !== key) {
      this.setPoseCamera(pose, ow / oh);
      const cam = this.poseCamera;
      const v = new THREE.Vector3();
      const toPx = (p: [number, number, number]): [number, number] | null => {
        v.set(...p).applyMatrix4(cam.matrixWorldInverse);
        if (v.z > -0.05) return null; // behind the projector
        v.applyMatrix4(cam.projectionMatrix);
        return [((v.x + 1) / 2) * ow, ((1 - v.y) / 2) * oh];
      };
      // Which room sides the picture lands on: cast a grid of rays through the projector image.
      const seen = new Set<string>();
      const dens: number[] = [];
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      const NX = 40;
      const NY = 24;
      for (let j = 0; j <= NY; j++) {
        for (let i = 0; i <= NX; i++) {
          v.set((i / NX) * 2 - 1, 1 - (j / NY) * 2, 0.5)
            .unproject(cam)
            .sub(cam.position)
            .normalize();
          const hit = roomRay(fold, pose.pos, [v.x, v.y, v.z]);
          if (!hit) continue;
          const f = hit.face;
          if (!seen.has(f.id)) {
            seen.add(f.id);
            x0 = Math.min(x0, f.rect.x);
            y0 = Math.min(y0, f.rect.y);
            x1 = Math.max(x1, f.rect.x + f.rect.w);
            y1 = Math.max(y1, f.rect.y + f.rect.h);
          }
          // local pixel density (projector px per meter) on the wall at this point
          const a = toPx(hit.p);
          const d = 0.05;
          const bx = toPx(facePoint(f, hit.x + d, hit.y));
          const by = toPx(facePoint(f, hit.x, hit.y + d));
          if (a && bx && by)
            dens.push(
              Math.max(Math.hypot(bx[0] - a[0], bx[1] - a[1]), Math.hypot(by[0] - a[0], by[1] - a[1])) / d,
            );
        }
      }
      // the chosen sides always belong to the picture (they are pinned onto measured corners,
      // even where the computed projector position would miss them)
      for (const f of fold.faces) {
        const wl = faceWall(fold, f);
        if (!wl || !walls.includes(wl) || seen.has(f.id)) continue;
        seen.add(f.id);
        x0 = Math.min(x0, f.rect.x);
        y0 = Math.min(y0, f.rect.y);
        x1 = Math.max(x1, f.rect.x + f.rect.w);
        y1 = Math.max(y1, f.rect.y + f.rect.h);
      }
      dens.sort((a, b) => a - b);
      const ppm = dens.length ? dens[Math.floor(dens.length * 0.9)]! : ow / 4;
      const vp = seen.size ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : world.bounds;
      this.atlasCache = { key, vp, ppm, seen };
    }
    const { vp, seen } = this.atlasCache;
    const maxSide = Math.min(this.maxTex, 8192);
    const ppm = Math.min(
      this.atlasCache.ppm,
      ow / 0.25,
      Math.sqrt(ATLAS_MAX_PIXELS / (vp.w * vp.h)),
      maxSide / vp.w,
      maxSide / vp.h,
    );
    // quantised so small aiming moves do not reallocate the atlas every frame
    const w = Math.max(64, Math.min(maxSide, Math.ceil((vp.w * ppm) / 64) * 64));
    const h = Math.max(64, Math.min(maxSide, Math.ceil((vp.h * ppm) / 64) * 64));
    return { vp, w, h, seen };
  }

  /** Real objects in the room as 3D bodies in the projector view, with their own light. */
  private syncPoseObjects(objects: readonly RoomObject[], now: number): void {
    const key = JSON.stringify(objects.map((o) => [o.id, o.shape, o.pos, o.size, o.yaw]));
    if (key !== this.poseObjectsKey) {
      this.poseObjectsKey = key;
      for (const c of [...this.poseObjects.children]) {
        this.poseObjects.remove(c);
        const m = c as THREE.Mesh;
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      for (const o of objects) {
        const g =
          o.shape === 'box'
            ? new THREE.BoxGeometry(o.size[0], o.size[1], o.size[2])
            : new THREE.CylinderGeometry(0.5, 0.5, 1, 48).scale(o.size[0], o.size[1], o.size[2]);
        g.translate(0, o.size[1] / 2, 0);
        const m = new THREE.Mesh(
          g,
          new THREE.ShaderMaterial({
            uniforms: { uColor: { value: new THREE.Color() }, uTime: { value: 0 }, uMode: { value: 1 } },
            vertexShader: VERT,
            fragmentShader: OBJECT_FRAG,
            side: THREE.FrontSide,
          }),
        );
        m.position.set(...o.pos);
        m.rotation.set(0, o.yaw, 0);
        m.userData.id = o.id;
        m.frustumCulled = false;
        this.poseObjects.add(m);
      }
    }
    const looks = ['dark', 'glow', 'flicker', 'spooky', 'edges'];
    for (const c of this.poseObjects.children) {
      const o = objects.find((x) => x.id === c.userData.id);
      if (!o) continue;
      const u = ((c as THREE.Mesh).material as THREE.ShaderMaterial).uniforms;
      (u.uColor!.value as THREE.Color).set(o.color);
      u.uTime!.value = (now / 1000) % 10000;
      u.uMode!.value = Math.max(0, looks.indexOf(o.look));
    }
  }

  /**
   * One side as a flat quad in the projector picture, mapped projectively (exactly like a 2D
   * corner calibration): picture corners TL, TR, BR, BL (0..1, y down) and the atlas uv there.
   */
  private flatScene = new THREE.Scene();
  private flatMaterial = new THREE.ShaderMaterial({
    uniforms: { map: { value: null } },
    vertexShader:
      'attribute vec3 uvq; varying vec3 vUvq; void main(){ vUvq = uvq; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader:
      'uniform sampler2D map; varying vec3 vUvq; void main(){ gl_FragColor = vec4(texture2D(map, vUvq.xy / vUvq.z).rgb, 1.0); }',
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  private flatQuad(i: number, uv: [number, number][], tex: readonly number[]): void {
    let m = this.flatScene.children[i] as THREE.Mesh | undefined;
    if (!m) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
      g.setAttribute('uvq', new THREE.Float32BufferAttribute(new Float32Array(12), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      m = new THREE.Mesh(g, this.flatMaterial);
      m.frustumCulled = false;
      this.flatScene.add(m);
    }
    m.visible = true;
    const pos = m.geometry.attributes.position as THREE.BufferAttribute;
    const uvq = m.geometry.attributes.uvq as THREE.BufferAttribute;
    const P = uv.map(([u, v]) => [u * 2 - 1, 1 - v * 2] as [number, number]);
    // projective interpolation: weights from where the diagonals cross
    const [a, b, c, d] = P as [[number, number], [number, number], [number, number], [number, number]];
    const den = (c[0] - a[0]) * (d[1] - b[1]) - (c[1] - a[1]) * (d[0] - b[0]);
    const t =
      Math.abs(den) < 1e-9 ? 0.5 : ((b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0])) / den;
    const X: [number, number] = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t];
    const dist = P.map((p) => Math.hypot(p[0] - X[0], p[1] - X[1]));
    for (let k = 0; k < 4; k++) {
      const q = dist[(k + 2) % 4]! > 1e-9 ? (dist[k]! + dist[(k + 2) % 4]!) / dist[(k + 2) % 4]! : 1;
      pos.setXYZ(k, P[k]![0], P[k]![1], 0);
      uvq.setXYZ(k, tex[k * 2]! * q, tex[k * 2 + 1]! * q, q);
    }
    pos.needsUpdate = true;
    uvq.needsUpdate = true;
  }

  private setPoseCamera(pose: NonNullable<Profile['pose']>, aspect: number): void {
    const cam = this.poseCamera;
    cam.aspect = aspect;
    cam.fov = (2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    cam.position.set(...pose.pos);
    cam.rotation.set(pose.pitch, -pose.yaw, pose.roll, 'YXZ');
    cam.updateProjectionMatrix();
    applyLensShift(cam, pose);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  }

  private renderPose(
    state: SessionState,
    pose: NonNullable<Profile['pose']>,
    vp: Viewport,
    ow: number,
    oh: number,
    markers: boolean,
    now: number,
    profile: Profile,
    output: Output | null,
  ): THREE.Texture {
    const r = this.renderer;
    if (!this.poseRT) {
      // with depth: real objects in the room hide the walls behind them
      this.poseRT = new THREE.WebGLRenderTarget(ow, oh, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        generateMipmaps: false,
      });
      this.poseScene.add(this.poseRoom, this.poseObjects);
    } else if (this.poseRT.width !== ow || this.poseRT.height !== oh) this.poseRT.setSize(ow, oh);
    const fold = this.worldFor(state).fold;
    // (the old squeeze/stretch per side is replaced by the room depth: pictures always fill the sides)
    const zoom: Partial<Record<string, number>> = {};
    const key = JSON.stringify([vp, zoom, fold.faces.map((f) => [f.id, f.o, f.ax, f.ay, f.rect])]);
    if (key !== this.poseKey) {
      // squeeze/stretch per side along the room depth, from the transition to the front wall
      const box = boxFrame(fold);
      const sideOf = (n: readonly number[]): 'links' | 'rechts' | 'boden' | 'decke' | null => {
        if (!box) return null;
        const ax = n[0]! * box.ax[0] + n[1]! * box.ax[1] + n[2]! * box.ax[2];
        if (ax > 0.9) return 'links';
        if (ax < -0.9) return 'rechts';
        if (n[1]! > 0.9) return 'boden';
        if (n[1]! < -0.9) return 'decke';
        return null;
      };
      this.poseKey = key;
      for (const c of [...this.poseRoom.children]) {
        this.poseRoom.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
      for (const f of fold.faces) {
        const pts: [number, number][] = [
          [f.rect.x, f.rect.y],
          [f.rect.x + f.rect.w, f.rect.y],
          [f.rect.x + f.rect.w, f.rect.y + f.rect.h],
          [f.rect.x, f.rect.y + f.rect.h],
        ];
        const pos: number[] = [];
        const uv: number[] = [];
        const sd = sideOf(f.n);
        const z = sd ? (zoom[sd] ?? 1) : 1;
        const gx = box ? f.ax[0] * box.n[0] + f.ax[1] * box.n[1] + f.ax[2] * box.n[2] : 0;
        const gy = box ? f.ay[0] * box.n[0] + f.ay[1] * box.n[1] + f.ay[2] * box.n[2] : 0;
        for (const [x, y] of pts) {
          const P = facePoint(f, x, y);
          pos.push(...P);
          let cx = x;
          let cy = y;
          if (box && z !== 1) {
            // depth from the front wall; the picture shows the content at depth d / z
            const d = (P[0] - box.o[0]) * box.n[0] + (P[2] - box.o[2]) * box.n[2];
            const dd = d / z - d;
            if (Math.abs(gx) > 0.5) cx = x + dd / gx;
            else if (Math.abs(gy) > 0.5) cy = y + dd / gy;
          }
          uv.push((cx - vp.x) / vp.w, 1 - (cy - vp.y) / vp.h);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex([0, 3, 1, 1, 3, 2]);
        const m = new THREE.Mesh(g, this.poseMaterial);
        m.frustumCulled = false;
        m.userData.face = f.id;
        m.userData.uv = uv;
        this.poseRoom.add(m);
      }
    }
    this.syncPoseObjects(state.objects ?? [], now);
    this.poseMaterial.uniforms.map!.value = this.viewRT.texture;
    this.flatMaterial.uniforms.map!.value = this.viewRT.texture;
    const cam = this.poseCamera;
    this.setPoseCamera(pose, ow / oh);
    // The chosen sides are pinned exactly onto their measured corners (a measured corner is the
    // truth; the computed projector position only fills in corners that were not measured and
    // keeps the proportions on walls lit at an angle). Sides not chosen stay dark.
    const walls = profile.walls ?? [];
    const quads = wallQuads(fold, pose, ow / oh, profile.anchors ?? [], walls);
    const flat = new Set(quads.map((q) => q.face.id));
    for (const c of this.poseRoom.children) {
      const id = c.userData.face as string;
      const face = fold.faces.find((f) => f.id === id);
      const wall = face ? faceWall(fold, face) : null;
      c.visible = !flat.has(id) && !(walls.length && wall && !walls.includes(wall));
    }
    quads.forEach((q, i) => {
      const mesh = this.poseRoom.children.find((c) => c.userData.face === q.face.id);
      this.flatQuad(i, q.uv, (mesh?.userData.uv as number[] | undefined) ?? [0, 1, 1, 1, 1, 0, 0, 0]);
    });
    for (let i = quads.length; i < this.flatScene.children.length; i++)
      this.flatScene.children[i]!.visible = false;
    r.setRenderTarget(this.poseRT);
    r.setClearColor(0x000000, 1);
    r.clear();
    if (quads.length) r.render(this.flatScene, CLIP_CAMERA);
    const prevClear = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    r.render(this.poseScene, cam);
    r.autoClear = prevClear;
    const align = output?.align && output.align.until > now ? output.align : null;
    const editObj =
      state.objectEdit && state.objectEdit.until > now
        ? (state.objects ?? []).find((o) => o.id === state.objectEdit!.id)
        : undefined;
    if (markers || align || editObj) {
      // numbered image corners for the fine adjustment, in the projector's own image
      this.viewOverlay.resize(ow, oh);
      this.viewOverlayMaterial.uniforms.map!.value = this.viewOverlay.texture;
      this.viewOverlay.clear();
      if (align)
        drawAlignOverlay(
          this.viewOverlay.g,
          ow,
          oh,
          pose,
          fold,
          profile.anchors ?? [],
          align.sel,
          Date.now(),
          profile.walls ?? [],
        );
      else if (markers) drawCornerMarkers(this.viewOverlay.g, ow, oh, this.previewFocus, now);
      if (editObj) drawObjectOutline(this.viewOverlay.g, ow, oh, pose, editObj, Date.now());
      this.viewOverlay.upload();
      const prev = r.autoClear;
      r.autoClear = false;
      r.render(this.viewOverlayScene, CLIP_CAMERA);
      r.autoClear = prev;
    }
    return this.poseRT.texture;
  }

  private worldCache: WorldInfo | null = null;
  /** Shared world layout (roles + rects of all surfaces), cached while the stage is unchanged. */
  private worldFor(state: SessionState): WorldInfo {
    // does any projector in the room light the floor?
    // (only projectors with a projector PC assigned count – planned ones do not light anything)
    const floorLit = state.outputs.some((o) => {
      const pr = activeProfile(o);
      return (
        !!pr.pose &&
        !!pr.walls?.includes('boden') &&
        state.devices.some((d) => d.outputId === o.id && d.status === 'approved')
      );
    });
    const key = JSON.stringify([
      state.room ?? false,
      state.surfaces.map((s) => [s.id, s.kind, s.role ?? 'auto', s.polygon]),
      floorLit,
      state.viewer ?? null,
    ]);
    if (this.worldCache?.key !== key) {
      // The world always spans the complete room (virtual faces fill sides without a projector).
      const surfaces = worldLayout(completeRoom(state.surfaces));
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const w of surfaces) {
        x0 = Math.min(x0, w.rect.x);
        y0 = Math.min(y0, w.rect.y);
        x1 = Math.max(x1, w.rect.x + w.rect.w);
        y1 = Math.max(y1, w.rect.y + w.rect.h);
      }
      const bounds = surfaces.length ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
      const fold = roomFold(state.surfaces);
      this.worldCache = {
        key,
        floorLit,
        surfaces,
        bounds,
        wrap: wallRing(surfaces),
        fold,
        viewer: viewerPoint(fold, state.viewer),
      };
    }
    return this.worldCache;
  }

  /**
   * Proportions of a side for this projector: the scene is laid out for a bigger / smaller area
   * and then put onto the real side – things get narrower (more of them) or wider, the side stays
   * filled completely. The anchor is the edge towards the front wall.
   */
  private proportionFor(s: Surface, profile: Profile, world: WorldInfo, room: boolean): Proportion {
    if (!room || !profile.proportions) return NO_PROP;
    const face = world.fold.faces.find((f) => f.id === s.id);
    const wall = face ? faceWall(world.fold, face) : null;
    const p = wall ? profile.proportions[wall] : undefined;
    if (!p) return NO_PROP;
    const size = p.size ?? 1;
    const dx = p.dx ?? 0;
    const dy = p.dy ?? 0;
    const same = (a: number, b: number) => Math.abs(a - b) < 1e-3;
    const plain = same(p.x, 1) && same(p.y, 1);
    if (plain && same(size, 1) && same(dx, 0) && same(dy, 0)) return NO_PROP;
    const key = [p.x, p.y, size, dx, dy].map((v) => v.toFixed(3)).join(',');
    const extra = { dx, dy, obj: size, key };
    if (plain) return { ...NO_PROP, ...extra };
    // front / back wall: the whole wall evenly
    if (wall === 'vorne' || wall === 'hinten') return { ...NO_PROP, fx: 1 / p.x, fy: 1 / p.y, ...extra };
    // the other sides: 100 % at the edge to the front wall (things go round the corner seamlessly),
    // easing to the set proportion at the far end. Where the edge lies in the unfolded stage:
    // left wall – its right end, right wall – its left end, floor – top, ceiling – bottom.
    const ld = (pd: number) => (1 + 1 / pd) / 2;
    const la = (pa: number) => Math.max(1, 1 / pa);
    if (wall === 'links' || wall === 'rechts') {
      const seam = wall === 'links' ? 1 : 0;
      return { fx: ld(p.x), fy: la(p.y), ax: seam, ay: 0.5, warp: [1, seam, p.x, p.y], ...extra };
    }
    const seam = wall === 'boden' ? 0 : 1;
    return { fx: la(p.x), fy: ld(p.y), ax: 0.5, ay: seam, warp: [2, seam, p.y, p.x], ...extra };
  }

  private renderSurface(
    s: Surface,
    state: SessionState,
    now: number,
    ppmView: number,
    dtMs: number,
    output: Output | null,
    outputs: readonly Output[],
    world: WorldInfo,
    prop: Proportion = NO_PROP,
  ): void {
    let layer = this.layers.get(s.id);
    if (!layer) {
      layer = new SurfaceLayer(s.id);
      this.layers.set(s.id, layer);
    }
    layer.lastUsed = performance.now();
    const b = polygonBBox(s.polygon);
    const maxDim = Math.min(this.maxTex, 4096) * this.quality;
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
    // the scene's own size: bigger / smaller than the side for other proportions
    let sw = lw;
    let sh = lh;
    if (prop.key) {
      sw = Math.max(16, Math.round(lw * prop.fx));
      sh = Math.max(16, Math.round(lh * prop.fy));
      const fs = Math.min(1, maxDim / Math.max(sw, sh));
      sw = Math.round(sw * fs);
      sh = Math.round(sh * fs);
    }
    const worldKey = `${world.key}|${prop.key}`;
    if (active && now >= active.startedAt - 50) {
      const runtime = this.runtimes.get(active.scene.themeId);
      const mod = runtime?.scenes[active.scene.sceneId];
      const self0 = world.surfaces.find((w) => w.id === s.id);
      // in the shared world the side covers a bigger / smaller area, from its edge at the front wall
      const vr = self0
        ? {
            x: self0.rect.x + self0.rect.w * prop.ax * (1 - prop.fx),
            y: self0.rect.y + self0.rect.h * prop.ay * (1 - prop.fy),
            w: self0.rect.w * prop.fx,
            h: self0.rect.h * prop.fy,
          }
        : null;
      // shifted picture: the window into the world moves the other way
      const shift = vr ? { x: prop.dx * vr.w, y: prop.dy * vr.h } : { x: 0, y: 0 };
      const ctxFor = (rect: typeof vr) => {
        if (!self0 || !rect) return undefined;
        const self = prop.key ? { ...self0, rect } : self0;
        return {
          self,
          surfaces: world.surfaces.map((w) => (w.id === s.id ? self : w)),
          bounds: world.bounds,
          wrap: world.wrap,
          floorLit: world.floorLit,
          objectScale: prop.obj,
          viewer: world.viewer,
          room:
            self !== self0
              ? {
                  ...world.fold,
                  // the side in the folded room: the same plane, the bigger / smaller area
                  faces: world.fold.faces.map((f) =>
                    f.id === s.id ? { ...f, rect, o: facePoint(f, rect.x, rect.y) } : f,
                  ),
                }
              : world.fold,
          seed: hashInts(Math.floor(active.startedAt / 1000) % 2147483647, 0x3077),
        };
      };
      const shifted = vr && (shift.x || shift.y) ? { ...vr, x: vr.x - shift.x, y: vr.y - shift.y } : vr;
      const events = ctxFor(vr);
      const worldCtx = ctxFor(shifted);
      if (
        mod &&
        (!layer.current || layer.current.key !== active.key || layer.current.worldKey !== worldKey)
      ) {
        const rt = makeRT(sw, sh);
        const inst = mod.create({
          // things crossing over from the other sides are drawn where they really are (no shift)
          world: worldCtx && events && shifted !== vr ? { ...worldCtx, events } : worldCtx,
          renderer: r,
          width: sw,
          height: sh,
          ppm: sw / Math.max(1e-3, (self0?.rect.w ?? b.w) * prop.fx) || layer.ppm,
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
          worldKey,
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
    (u.uWarp!.value as THREE.Vector4).set(...prop.warp);
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
    if (active?.position) {
      for (const sch of [...ambientSchedule(active), ...itemCueSchedule(active)]) {
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
    // Overlays are uploaded at reduced resolution; effects still draw in layer pixels.
    g.setTransform(layer.overlay.canvas.width / layer.w, 0, 0, layer.overlay.canvas.height / layer.h, 0, 0);
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
        // Effects follow the color mood of the scene they play over unless the cue says otherwise.
        params: {
          ...(active?.scene.params.mood !== undefined ? { mood: active.scene.params.mood } : {}),
          ...it.params,
        },
        rng: createRng(it.seed),
        boost: state.boost ?? 0,
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
    const live = this.liveSprite?.() ?? [];
    const flights = (state.ghostFlights ?? []).filter((f) => now >= f.startAt && now < f.endAt);
    if (all.length === 0 && !live.length && !(flights.length && this.ghostImages)) {
      if (o.dirty) {
        o.clear();
        o.upload();
        o.dirty = false;
      }
      return false;
    }
    o.clear();
    const g = o.g;
    const os = o.canvas.width / vw;
    g.setTransform(ppm * os, 0, 0, ppm * os, -vp.x * ppm * os, -vp.y * ppm * os);
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
        // Creatures move around the viewer in the folded 3D room: their path is a direction
        // from the room center over time; each face draws the part that lies on it (a creature
        // on a corner is drawn by both faces, unfolded across the shared edge).
        const fold = this.worldFor(state).fold;
        const tMs = now - cue.startAt - route.delayMs;
        const u = tMs / Math.max(1, route.totalMs);
        if (u < 0 || u > 1) continue;
        const flyer = !manifest.kinds.includes('floor');
        const climber = manifest.kinds.includes('floor') && manifest.kinds.includes('wall');
        const rr = createRng(hashInts(cue.seed, i + 77));
        const az0 = mainAzimuth(fold) + (rr() - 0.5) * Math.PI * 1.2;
        const sweep =
          (rr() < 0.5 ? -1 : 1) * (flyer ? Math.PI * (0.6 + rr() * 1.2) : Math.PI * (0.3 + rr() * 0.5));
        const ph = rr() * 10;
        const path = (q: number) => {
          const wob = 0.5 + 0.5 * Math.sin(q * (3 + rr2) + ph) * 0.6 + 0.2 * Math.sin(q * 7.3 + ph * 2);
          const el = flyer
            ? manifest.sizeM > 0.6
              ? 0.05 + 0.4 * wob
              : 0.1 + 1.1 * wob
            : climber
              ? -0.9 + 2.0 * wob
              : -1.0 + 0.45 * wob;
          const az = az0 + sweep * q + 0.25 * Math.sin(q * 5 + ph);
          return roomHit(fold, dirFromAngles(az, el));
        };
        const rr2 = rr() * 2;
        const hit = path(u);
        const hit2 = path(Math.min(1, u + 0.004));
        if (!hit) continue;
        const fade = Math.min(1, u / 0.06, (1 - u) / 0.06);
        const half = manifest.sizeM;
        for (const face of fold.faces) {
          const loc = faceLocal(face, hit.p);
          if (!loc) continue;
          const fr = face.rect;
          if (
            loc.x < fr.x - half ||
            loc.y < fr.y - half ||
            loc.x > fr.x + fr.w + half ||
            loc.y > fr.y + fr.h + half
          )
            continue;
          if (
            loc.x < vp.x - half ||
            loc.y < vp.y - half ||
            loc.x > vp.x + vp.w + half ||
            loc.y > vp.y + vp.h + half
          )
            continue;
          const loc2 = hit2 ? faceLocal(face, hit2.p) : null;
          const angle = loc2 ? Math.atan2(loc2.y - loc.y, loc2.x - loc.x) : 0;
          const pose = {
            x: loc.x,
            y: loc.y,
            angle,
            moving: true,
            distance: (tMs / 1000) * manifest.speedMps,
            visible: true,
          };
          g.save();
          g.beginPath();
          g.rect(fr.x, fr.y, fr.w, fr.h);
          g.clip();
          g.globalAlpha = Math.max(0, fade);
          g.translate(pose.x, pose.y);
          if (!mod.upright) g.rotate(pose.angle);
          const sizePx = manifest.sizeM * ppm;
          g.scale(1 / ppm, 1 / ppm);
          mod.draw(g, pose, {
            ppm,
            t: (now - cue.startAt) / 1000,
            seed: cue.seed + i,
            sizePx,
            boost: state.boost ?? 0,
          });
          g.restore();
          drew = true;
        }
        const pose = { x: hit.x, y: hit.y, angle: 0, moving: true, distance: 0, visible: true };
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
    if (flights.length && this.ghostImages) {
      for (const f of flights) {
        const gi = this.ghostImages(f.ghostId);
        if (gi && this.drawGhostFlight(g, state, f, gi, now)) drew = true;
      }
    }
    if (live.length) {
      // people from the live camera as ghosts drifting along the main wall, each on their own,
      // in the order they stand in the camera picture, standing on the wall's ground line
      const main = this.worldFor(state).surfaces.find((w) => w.role === 'main');
      if (main) {
        const r = main.rect;
        const t = now / 1000;
        for (const sp of live) {
          if (!sp.canvas.width || !sp.canvas.height) continue;
          const h = Math.min(r.h * 0.78, (r.w * 0.32 * sp.canvas.height) / sp.canvas.width);
          const w = (h * sp.canvas.width) / sp.canvas.height;
          const cx = r.x + r.w * (0.14 + 0.72 * sp.u + 0.06 * Math.sin(t / 9 + sp.id * 1.9));
          const bottom = r.y + r.h * 0.98 - h * 0.04 * (1 + Math.sin(t * 1.3 + sp.id * 2.3));
          g.save();
          g.globalAlpha = Math.max(0, Math.min(1, sp.alpha));
          g.drawImage(sp.canvas, cx - w / 2, bottom - h, w, h);
          g.restore();
          drew = true;
        }
      }
    }
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
