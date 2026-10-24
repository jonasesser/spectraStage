import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import {
  activeProfile,
  stageBounds,
  type Output,
  type SessionState,
  type Viewport,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { roomGeometry } from './roomGeometry.ts';

/**
 * 3D room view: stand in the middle of the stage world like with VR glasses, look around by
 * dragging (or by moving the phone), and place the projector frames directly on the walls.
 * Internally it is the same unfolded stage – a frame that spans two touching walls simply wraps
 * around the corner.
 */
export function Room3D({
  state,
  L,
  selected,
  onSelect,
}: {
  state: SessionState;
  L: Tr;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const store = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const selRef = useRef(selected);
  selRef.current = selected;
  const draftRef = useRef<Record<string, Viewport>>({});
  const [gyro, setGyro] = useState(false);
  const gyroRef = useRef<{ on: boolean; a0: number | null; yaw0: number }>({ on: false, a0: null, yaw0: 0 });

  const layoutKey = JSON.stringify([
    state.room ?? false,
    state.surfaces.map((s) => [s.id, s.kind, s.role ?? 'auto', s.polygon]),
  ]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const st = stateRef.current;
    if (!st.surfaces.length) return;
    const b = stageBounds(st.surfaces);
    // --- live stage picture (same engine as the projectors), rendered off-screen
    const TW = 1536;
    const TH = Math.max(64, Math.min(1536, Math.round((TW * b.h) / b.w)));
    const src = document.createElement('canvas');
    Object.assign(src.style, {
      position: 'fixed',
      left: '-20000px',
      top: '0',
      width: `${TW}px`,
      height: `${TH}px`,
    });
    document.body.appendChild(src);
    const stage = new StageRenderer({
      canvas: src,
      catalog,
      loadRuntime: loadThemeRuntime,
      now: () => store.conn.clock.now(),
      preview: true,
      maxPixelRatio: 1,
      readable: true,
    });
    stage.setPreviewViewport({ x: b.x, y: b.y, w: b.w, h: b.h });
    stage.setState(st, null);
    stage.start();
    const comp = document.createElement('canvas');
    comp.width = TW;
    comp.height = TH;
    const cg = comp.getContext('2d')!;
    const tex = new THREE.CanvasTexture(comp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    // --- 3D room
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    canvas.style.display = 'block';
    host.appendChild(canvas);
    const r3 = new THREE.WebGLRenderer({ canvas, antialias: true });
    r3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05040c');
    const cam = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    const geo = roomGeometry(st.surfaces, !!st.room);
    cam.position.set(...geo.camera);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const meshes: THREE.Mesh[] = [];
    const N = 12;
    for (const s of st.surfaces) {
      if (!geo.placed.has(s.id)) continue;
      const sb = stageBounds([s]);
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let j = 0; j <= N; j++)
        for (let i = 0; i <= N; i++) {
          const x = sb.x + (sb.w * i) / N;
          const y = sb.y + (sb.h * j) / N;
          pos.push(...geo.map(s.id, x, y)!);
          uv.push((x - b.x) / b.w, 1 - (y - b.y) / b.h);
        }
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const a = j * (N + 1) + i;
          idx.push(a, a + N + 1, a + 1, a + 1, a + N + 1, a + N + 2);
        }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.userData.surfaceId = s.id;
      scene.add(m);
      meshes.push(m);
    }
    // faint floor grid so the viewer has orientation where nothing is projected
    const grid = new THREE.GridHelper(40, 40, 0x2a2550, 0x15122c);
    grid.position.y = -0.001;
    scene.add(grid);

    // --- view direction (yaw/pitch) and zoom
    const look = new THREE.Vector3(...geo.lookAt).sub(cam.position);
    let yaw = Math.atan2(look.x, -look.z);
    let pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
    const applyView = () => {
      pitch = Math.max(-1.45, Math.min(1.45, pitch));
      const dir = new THREE.Vector3(
        Math.sin(yaw) * Math.cos(pitch),
        Math.sin(pitch),
        -Math.cos(yaw) * Math.cos(pitch),
      );
      cam.lookAt(cam.position.clone().add(dir));
    };
    applyView();

    const resize = () => {
      const w = host.clientWidth || 300;
      const h = host.clientHeight || 300;
      r3.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // --- frames of the projectors, drawn into the stage picture
    const vpOf = (o: Output) => draftRef.current[o.id] ?? activeProfile(o).viewport;
    const toC = (x: number, y: number): [number, number] => [((x - b.x) / b.w) * TW, ((y - b.y) / b.h) * TH];
    const ppm = TW / b.w;
    const drawFrames = () => {
      for (const o of stateRef.current.outputs) {
        const vp = vpOf(o);
        const [x, y] = toC(vp.x, vp.y);
        const sel = o.id === selRef.current;
        cg.strokeStyle = sel ? '#ffb347' : 'rgba(255,255,255,0.85)';
        cg.lineWidth = Math.max(2, ppm * (sel ? 0.05 : 0.03));
        cg.setLineDash(sel ? [] : [ppm * 0.15, ppm * 0.1]);
        cg.strokeRect(x, y, vp.w * ppm, vp.h * ppm);
        cg.setLineDash([]);
        cg.fillStyle = sel ? '#ffb347' : '#ffffff';
        cg.font = `bold ${Math.round(ppm * 0.22)}px sans-serif`;
        cg.fillText(`📽 ${o.name}`, x + ppm * 0.1, y + ppm * 0.3);
        // resize handle bottom-right
        cg.beginPath();
        cg.arc(x + vp.w * ppm, y + vp.h * ppm, ppm * (sel ? 0.16 : 0.1), 0, Math.PI * 2);
        cg.fill();
      }
    };

    // --- interaction: drag frames, look around, pinch / wheel zoom
    const ray = new THREE.Raycaster();
    const hitStage = (cx: number, cy: number): { x: number; y: number } | null => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((cx - rect.left) / rect.width) * 2 - 1,
        -((cy - rect.top) / rect.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, cam);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (!hit?.uv) return null;
      return { x: b.x + hit.uv.x * b.w, y: b.y + (1 - hit.uv.y) * b.h };
    };
    type Drag =
      | { kind: 'look'; x: number; y: number; yaw: number; pitch: number }
      | { kind: 'move'; id: string; start: { x: number; y: number }; orig: Viewport }
      | { kind: 'resize'; id: string; orig: Viewport; aspect: number };
    let drag: Drag | null = null;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch0: { d: number; fov: number } | null = null;
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        pinch0 = { d: Math.hypot(a!.x - c!.x, a!.y - c!.y), fov: cam.fov };
        drag = null;
        return;
      }
      const p = hitStage(e.clientX, e.clientY);
      if (p) {
        const outs = stateRef.current.outputs;
        // resize handle first, then frames (selected one wins)
        const order = [...outs].sort((a) => (a.id === selRef.current ? -1 : 1));
        for (const o of order) {
          const vp = vpOf(o);
          if (Math.hypot(p.x - (vp.x + vp.w), p.y - (vp.y + vp.h)) < 0.35) {
            onSelect(o.id);
            drag = { kind: 'resize', id: o.id, orig: vp, aspect: vp.w / vp.h };
            return;
          }
        }
        for (const o of order) {
          const vp = vpOf(o);
          if (p.x >= vp.x && p.x <= vp.x + vp.w && p.y >= vp.y && p.y <= vp.y + vp.h) {
            onSelect(o.id);
            drag = { kind: 'move', id: o.id, start: p, orig: vp };
            return;
          }
        }
      }
      drag = { kind: 'look', x: e.clientX, y: e.clientY, yaw, pitch };
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch0 && pts.size === 2) {
        const [a, c] = [...pts.values()];
        const d = Math.hypot(a!.x - c!.x, a!.y - c!.y);
        cam.fov = Math.max(30, Math.min(100, (pinch0.fov * pinch0.d) / Math.max(1, d)));
        cam.updateProjectionMatrix();
        return;
      }
      if (!drag) return;
      if (drag.kind === 'look') {
        const k = (cam.fov / 75) * 0.005;
        yaw = drag.yaw - (e.clientX - drag.x) * k;
        pitch = drag.pitch + (e.clientY - drag.y) * k;
        applyView();
        return;
      }
      const p = hitStage(e.clientX, e.clientY);
      if (!p) return;
      if (drag.kind === 'move') {
        draftRef.current[drag.id] = {
          ...drag.orig,
          x: drag.orig.x + (p.x - drag.start.x),
          y: drag.orig.y + (p.y - drag.start.y),
        };
      } else {
        const w = Math.max(0.3, p.x - drag.orig.x);
        draftRef.current[drag.id] = { ...drag.orig, w, h: w / drag.aspect };
      }
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = null;
      const d = drag;
      drag = null;
      if (!d || d.kind === 'look') return;
      const vp = draftRef.current[d.id];
      if (vp) {
        void store.send({ t: 'output.setViewport', outputId: d.id, viewport: vp }).finally(() => {
          delete draftRef.current[d.id];
        });
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      cam.fov = Math.max(30, Math.min(100, cam.fov * (e.deltaY > 0 ? 1.08 : 0.92)));
      cam.updateProjectionMatrix();
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // --- look around by moving the phone
    const onOrient = (e: DeviceOrientationEvent) => {
      const gr = gyroRef.current;
      if (!gr.on || e.alpha === null || e.beta === null) return;
      if (gr.a0 === null) {
        gr.a0 = e.alpha;
        gr.yaw0 = yaw;
      }
      yaw = gr.yaw0 - ((e.alpha - gr.a0) * Math.PI) / 180;
      pitch = ((e.beta - 90) * Math.PI) / 180;
      applyView();
    };
    window.addEventListener('deviceorientation', onOrient);

    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      cg.drawImage(src, 0, 0, TW, TH);
      drawFrames();
      tex.needsUpdate = true;
      r3.render(scene, cam);
    };
    loop();
    const updateState = setInterval(() => stage.setState(stateRef.current, null), 250);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(updateState);
      window.removeEventListener('deviceorientation', onOrient);
      ro.disconnect();
      stage.dispose();
      src.remove();
      tex.dispose();
      mat.dispose();
      meshes.forEach((m) => m.geometry.dispose());
      grid.geometry.dispose();
      r3.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  const toggleGyro = async () => {
    const next = !gyro;
    if (next) {
      const DO = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
      if (DO?.requestPermission) {
        try {
          if ((await DO.requestPermission()) !== 'granted') return;
        } catch {
          return;
        }
      }
    }
    gyroRef.current = { on: next, a0: null, yaw0: 0 };
    setGyro(next);
  };

  if (!state.surfaces.length)
    return <p className="muted">{L('Add surfaces first.', 'Lege zuerst Flächen an.')}</p>;
  return (
    <div className="stack">
      <div ref={hostRef} className="room3d" />
      <div className="row">
        <button className={`btn small${gyro ? ' on' : ''}`} onClick={toggleGyro}>
          📱 {L('Look around by moving the phone', 'Umschauen durch Handy-Bewegen')}
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Drag to look around, pinch to zoom. Drag a projector frame to move it onto the wall it hits – across corners too; the dot at its corner changes the size.',
          'Ziehen = umschauen, zwei Finger = zoomen. Einen Beamer-Rahmen ziehen, um ihn auf die Wand zu setzen, die er trifft – auch über Ecken; der Punkt an seiner Ecke ändert die Größe.',
        )}
      </p>
    </div>
  );
}
