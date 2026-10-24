/**
 * Helpers that make writing theme scenes easy:
 *  - canvasScene: draw with Canvas2D (uploaded as texture)
 *  - shaderScene: full-screen fragment shader (WebGL)
 *  - hybrid: shader background + Canvas2D foreground
 */
import * as THREE from 'three';
import type { ParamValues } from '@spectrastage/shared';
import type { FrameInfo, SceneContext, SceneInstance, SceneModule } from './sdk.ts';

export interface DrawState {
  w: number;
  h: number;
  ppm: number;
  seed: number;
  params: ParamValues;
  quality: number;
  kind: SceneContext['kind'];
  world?: SceneContext['world'];
  /** Free per-instance cache for precomputed (seeded) data. Reset on resize. */
  cache: Record<string, unknown>;
}

export type DrawFn = (g: CanvasRenderingContext2D, s: DrawState, f: FrameInfo) => void;

export type UniformFn = (
  s: DrawState,
  f: FrameInfo,
) => Record<string, number | number[] | THREE.Color | THREE.Vector2 | THREE.Vector3 | THREE.Vector4>;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const COPY_FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() { gl_FragColor = texture2D(map, vUv); }
`;

function quadScene(material: THREE.Material): { scene: THREE.Scene; mesh: THREE.Mesh } {
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { scene, mesh };
}

const CAMERA = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Canvas texture without color management; premultiplied when transparent. */
export function canvasTexture(canvas: HTMLCanvasElement, transparent: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.premultiplyAlpha = transparent;
  return t;
}

class CanvasLayer {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  texture: THREE.CanvasTexture;
  material: THREE.ShaderMaterial;
  scene: THREE.Scene;

  constructor(
    w: number,
    h: number,
    private readonly transparent: boolean,
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const g = this.canvas.getContext('2d', { alpha: transparent });
    if (!g) throw new Error('Canvas2D unavailable');
    this.g = g;
    this.texture = canvasTexture(this.canvas, transparent);
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.texture } },
      vertexShader: VERT,
      fragmentShader: COPY_FRAG,
      transparent,
      depthTest: false,
      depthWrite: false,
      blending: transparent ? THREE.CustomBlending : THREE.NoBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      premultipliedAlpha: true,
    });
    this.scene = quadScene(this.material).scene;
  }

  resize(w: number, h: number): void {
    this.canvas.width = w;
    this.canvas.height = h;
    this.texture.dispose();
    this.texture = canvasTexture(this.canvas, this.transparent);
    this.material.uniforms.map!.value = this.texture;
  }

  dispose(): void {
    this.texture.dispose();
    this.material.dispose();
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

class ShaderLayer {
  material: THREE.ShaderMaterial;
  scene: THREE.Scene;
  constructor(fragment: string) {
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) }, uSeed: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: fragment,
      depthTest: false,
      depthWrite: false,
    });
    this.scene = quadScene(this.material).scene;
  }
  setUniforms(values: ReturnType<UniformFn>): void {
    for (const [k, v] of Object.entries(values)) {
      const u = this.material.uniforms[k];
      if (u) u.value = v;
      else this.material.uniforms[k] = { value: v };
    }
  }
  dispose(): void {
    this.material.dispose();
    this.scene.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

interface KitOptions {
  fragment?: string;
  uniforms?: UniformFn;
  draw?: DrawFn;
  /** Draw at a fraction of the target resolution (soft content). */
  canvasScale?: number;
  /** Render the shader layer at a fraction of the resolution and upscale (default 0.5 – backgrounds are soft). */
  shaderScale?: number;
}

class KitScene implements SceneInstance {
  private state: DrawState;
  private canvas: CanvasLayer | null = null;
  private shader: ShaderLayer | null = null;
  private lowRT: THREE.WebGLRenderTarget | null = null;
  private upscale: THREE.ShaderMaterial | null = null;
  private upscaleScene: THREE.Scene | null = null;

  constructor(
    private readonly ctx: SceneContext,
    private readonly opts: KitOptions,
  ) {
    this.state = {
      w: ctx.width,
      h: ctx.height,
      ppm: ctx.ppm,
      seed: ctx.seed,
      params: ctx.params,
      quality: ctx.quality,
      kind: ctx.kind,
      world: ctx.world,
      cache: {},
    };
    if (opts.fragment) this.shader = new ShaderLayer(opts.fragment);
    if (opts.draw) {
      const s = opts.canvasScale ?? 1;
      this.canvas = new CanvasLayer(
        Math.max(2, Math.round(ctx.width * s)),
        Math.max(2, Math.round(ctx.height * s)),
        !!opts.fragment,
      );
    }
  }

  render(target: THREE.WebGLRenderTarget, frame: FrameInfo): void {
    const r = this.ctx.renderer;
    r.setRenderTarget(target);
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    if (this.shader) {
      this.shader.setUniforms({
        uTime: frame.time,
        uRes: new THREE.Vector2(this.state.w, this.state.h),
        uSeed: (this.state.seed % 1000) / 10,
      });
      if (this.opts.uniforms) this.shader.setUniforms(this.opts.uniforms(this.state, frame));
      const scale = Math.max(0.25, Math.min(1, this.opts.shaderScale ?? 0.5));
      if (scale < 1) {
        const lw = Math.max(2, Math.round(this.state.w * scale));
        const lh = Math.max(2, Math.round(this.state.h * scale));
        if (!this.lowRT) {
          this.lowRT = new THREE.WebGLRenderTarget(lw, lh, {
            depthBuffer: false,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
          });
          this.upscale = new THREE.ShaderMaterial({
            uniforms: { map: { value: this.lowRT.texture } },
            vertexShader: VERT,
            fragmentShader: COPY_FRAG,
            depthTest: false,
            depthWrite: false,
          });
          this.upscaleScene = quadScene(this.upscale).scene;
        } else if (this.lowRT.width !== lw || this.lowRT.height !== lh) this.lowRT.setSize(lw, lh);
        r.setRenderTarget(this.lowRT);
        r.render(this.shader.scene, CAMERA);
        r.setRenderTarget(target);
        r.render(this.upscaleScene!, CAMERA);
      } else r.render(this.shader.scene, CAMERA);
    }
    if (this.canvas && this.opts.draw) {
      const g = this.canvas.g;
      const s = this.opts.canvasScale ?? 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      if (this.shader) g.clearRect(0, 0, this.canvas.canvas.width, this.canvas.canvas.height);
      else {
        g.fillStyle = '#000';
        g.fillRect(0, 0, this.canvas.canvas.width, this.canvas.canvas.height);
      }
      g.setTransform(s, 0, 0, s, 0, 0);
      g.save();
      this.opts.draw(g, this.state, frame);
      if (this.ctx.overlay) {
        g.save();
        this.ctx.overlay(g, this.state, frame);
        g.restore();
      }
      g.restore();
      this.canvas.texture.needsUpdate = true;
      r.render(this.canvas.scene, CAMERA);
    }
    r.autoClear = prevAuto;
  }

  resize(width: number, height: number, ppm: number): void {
    if (width === this.state.w && height === this.state.h && ppm === this.state.ppm) return;
    this.state.w = width;
    this.state.h = height;
    this.state.ppm = ppm;
    this.state.cache = {};
    if (this.canvas) {
      const s = this.opts.canvasScale ?? 1;
      this.canvas.resize(Math.max(2, Math.round(width * s)), Math.max(2, Math.round(height * s)));
    }
  }

  setParams(params: ParamValues): void {
    this.state.params = params;
    this.state.cache = {};
  }

  dispose(): void {
    this.canvas?.dispose();
    this.shader?.dispose();
    this.lowRT?.dispose();
    this.upscale?.dispose();
    this.upscaleScene?.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

export function canvasScene(
  id: string,
  draw: DrawFn,
  extra: Partial<SceneModule> & { canvasScale?: number } = {},
): SceneModule {
  return {
    id,
    create: (ctx) => new KitScene(ctx, { draw, canvasScale: extra.canvasScale }),
    ambientSound: extra.ambientSound,
  };
}

export function shaderScene(
  id: string,
  fragment: string,
  uniforms?: UniformFn,
  extra: Partial<SceneModule> & { shaderScale?: number } = {},
): SceneModule {
  return {
    id,
    create: (ctx) => new KitScene(ctx, { fragment, uniforms, shaderScale: extra.shaderScale }),
    ambientSound: extra.ambientSound,
  };
}

export function hybridScene(
  id: string,
  fragment: string,
  uniforms: UniformFn | undefined,
  draw: DrawFn,
  extra: Partial<SceneModule> & { shaderScale?: number } = {},
): SceneModule {
  return {
    id,
    create: (ctx) => new KitScene(ctx, { fragment, uniforms, draw, shaderScale: extra.shaderScale }),
    ambientSound: extra.ambientSound,
  };
}

/** Cached seeded data per scene instance (recomputed after resize/param change). */
export function memo<T>(s: DrawState, key: string, make: () => T): T {
  if (!(key in s.cache)) s.cache[key] = make();
  return s.cache[key] as T;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
