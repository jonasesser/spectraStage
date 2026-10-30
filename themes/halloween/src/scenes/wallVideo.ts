/**
 * An uploaded video (e.g. made with Kling: a creature breaking out of a plaster wall) played once
 * on the main wall, in step with the show clock – every projector PC has it loaded ahead.
 */
import * as THREE from 'three';
import type { SceneModule } from '@spectrastage/engine';

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec4 uFit; // scale xy, offset xy (picture uv -> video uv)
uniform float uA;
varying vec2 vUv;
void main() {
  vec2 uv = vUv * uFit.xy + uFit.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  gl_FragColor = vec4(texture2D(map, uv).rgb * uA, 1.0);
}
`;

export const wallVideoScene: SceneModule = {
  id: 'wallVideo',
  create: (ctx) => {
    let params = ctx.params;
    let w = ctx.width;
    let h = ctx.height;
    const video = document.createElement('video');
    video.playsInline = true;
    video.preload = 'auto';
    video.muted = true;
    let src: string | null = null;
    let wantSound = false;
    const tex = new THREE.VideoTexture(video);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uFit: { value: new THREE.Vector4(1, 1, 0, 0) }, uA: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    quad.frustumCulled = false;
    const scene = new THREE.Scene();
    scene.add(quad);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    let playing: Promise<void> | null = null;
    return {
      render: (target, f) => {
        const r = ctx.renderer;
        const id = String(params.video ?? '');
        const url = id ? (ctx.videos?.url(id) ?? null) : null;
        if (url && url !== src) {
          src = url;
          video.src = url;
          video.load();
        }
        wantSound = params.sound !== false;
        const t = f.time;
        const ready = video.readyState >= 2 && Number.isFinite(video.duration);
        const dur = ready ? video.duration : 0;
        if (ready) {
          if (t < 0 || t >= dur) {
            if (!video.paused) video.pause();
            if (t < 0 && video.currentTime !== 0) video.currentTime = 0;
          } else {
            if (Math.abs(video.currentTime - t) > 0.3) video.currentTime = t;
            if (video.paused && !playing) {
              video.muted = !wantSound;
              playing = video
                .play()
                .catch(() => {
                  // sound not allowed here (no click on this PC yet): play silently
                  video.muted = true;
                  return video.play().catch(() => undefined);
                })
                .finally(() => (playing = null));
            }
          }
        }
        // fit the video into the wall picture
        const va = ready && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9;
        const ta = w / h;
        const fit = String(params.fit ?? 'cover');
        const u = mat.uniforms.uFit!.value as THREE.Vector4;
        if (fit === 'stretch') u.set(1, 1, 0, 0);
        else if ((fit === 'cover') === ta > va) {
          // video taller than needed (cover) / narrower (contain): scale v
          const k = va / ta;
          u.set(1, k, 0, (1 - k) / 2);
        } else {
          const k = ta / va;
          u.set(k, 1, (1 - k) / 2, 0);
        }
        // read-only diagnostics (end-to-end test / support)
        (globalThis as Record<string, unknown>).__ssVideo = { id, ready: video.readyState, t, dur };
        const fadeIn = Math.min(1, Math.max(0, t / 0.6));
        const fadeOut = dur ? Math.min(1, Math.max(0, (dur - t) / 0.8)) : 1;
        mat.uniforms.uA!.value = ready ? fadeIn * fadeOut : 0;
        r.setRenderTarget(target);
        r.setClearColor(0x000000, 1);
        r.clear(true, true, false);
        if (ready) r.render(scene, cam);
      },
      resize: (nw, nh) => {
        w = nw;
        h = nh;
      },
      setParams: (p) => {
        params = p;
      },
      dispose: () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
        tex.dispose();
        mat.dispose();
        quad.geometry.dispose();
      },
    };
  },
};
