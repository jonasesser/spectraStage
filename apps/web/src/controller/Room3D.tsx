import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import {
  activeProfile,
  aimPose,
  completeRoom,
  poseDir,
  poseForSurface,
  poseRay,
  roomCorners,
  roomFold,
  roomRay,
  stageBounds,
  type Anchor,
  type Output,
  type Pose,
  type SessionState,
  type V3,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { roomGeometry } from './roomGeometry.ts';
import { Slider } from './ui.tsx';
import { CornerPad } from './CornerPad.tsx';

type Mode = 'look' | 'aim' | 'place' | 'align';

function outputAspect(o: Output): number {
  const r = activeProfile(o).referenceResolution;
  return r ? r.w / r.h : 16 / 9;
}

/** Room direction of image coordinate (u, v ∈ -1..1) of a projector (incl. lens shift). */
function imageRay(p: Pose, aspect: number, u: number, v: number): V3 {
  return poseRay(p, aspect, u, v);
}

/**
 * 3D room view: stand in the room like with VR glasses and look around (drag or move the
 * phone). Every projector is an object in the room: choose one, tap where it should point, set
 * its size and rotation, move its standing position – its light cone and the outline of its
 * picture on walls, floor and ceiling (also across corners) are shown live.
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
  const [mode, setMode] = useState<Mode>('aim');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const drafts = useRef<Record<string, Pose>>({});
  const [corner, setCorner] = useState<string | null>(null);
  const cornerRef = useRef(corner);
  cornerRef.current = corner;
  const anchorDrafts = useRef<Record<string, Anchor[]>>({});
  const anchorsOf = (o: Output): Anchor[] => anchorDrafts.current[o.id] ?? activeProfile(o).anchors ?? [];
  const [, force] = useState(0);
  const [gyro, setGyro] = useState(false);
  const gyroRef = useRef<{ on: boolean; a0: number | null; yaw0: number }>({ on: false, a0: null, yaw0: 0 });

  const layoutKey = JSON.stringify(state.surfaces.map((s) => [s.id, s.kind, s.role ?? 'auto', s.polygon]));
  const poseOf = (o: Output): Pose | null => drafts.current[o.id] ?? activeProfile(o).pose ?? null;
  const sendPose = (id: string) => {
    const p = drafts.current[id];
    if (p)
      void store.send({ t: 'output.setPose', outputId: id, pose: p }).finally(() => {
        delete drafts.current[id];
      });
  };

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const st = stateRef.current;
    if (!st.surfaces.length) return;
    const all = completeRoom(st.surfaces);
    const withRoom = (x: SessionState): SessionState => ({ ...x, surfaces: completeRoom(x.surfaces) });
    const b = stageBounds(all);
    const fold = roomFold(all, false);
    // --- live stage picture, rendered off-screen and wrapped onto the room
    const TW = 2048;
    const TH = Math.max(64, Math.min(2048, Math.round((TW * b.h) / b.w)));
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
    stage.setState(withRoom(st), null);
    stage.start();
    // copy the WebGL picture into a 2D canvas each frame (reliable texture source everywhere)
    const comp = document.createElement('canvas');
    comp.width = TW;
    comp.height = TH;
    const cg = comp.getContext('2d')!;
    const tex = new THREE.CanvasTexture(comp);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const canvas = document.createElement('canvas');
    Object.assign(canvas.style, { width: '100%', height: '100%', touchAction: 'none', display: 'block' });
    host.appendChild(canvas);
    const r3 = new THREE.WebGLRenderer({ canvas, antialias: true });
    r3.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05040c');
    const cam = new THREE.PerspectiveCamera(75, 1, 0.05, 200);
    const geo = roomGeometry(all);
    cam.position.set(...geo.camera);
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
    const meshes: THREE.Mesh[] = [];
    const N = 12;
    for (const s of all) {
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
      scene.add(m);
      meshes.push(m);
    }

    // --- projectors: body, light cone and the outline of their picture in the room
    const projGroup = new THREE.Group();
    scene.add(projGroup);
    const buildProjectors = () => {
      for (const c of [...projGroup.children]) {
        projGroup.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
      for (const o of stateRef.current.outputs) {
        const p = poseOf(o);
        if (!p) continue;
        const sel = o.id === selRef.current;
        const color = sel ? 0xffb347 : 0xffffff;
        const aspect = outputAspect(o);
        const pts: THREE.Vector3[] = [];
        const corners: THREE.Vector3[] = [];
        const n = 24;
        const border: [number, number][] = [];
        for (let i = 0; i < n; i++) border.push([-1 + (2 * i) / n, 1]);
        for (let i = 0; i < n; i++) border.push([1, 1 - (2 * i) / n]);
        for (let i = 0; i < n; i++) border.push([1 - (2 * i) / n, -1]);
        for (let i = 0; i < n; i++) border.push([-1, -1 + (2 * i) / n]);
        border.forEach(([u, v], i) => {
          const hit = roomRay(fold, p.pos, imageRay(p, aspect, u, v));
          if (!hit) return;
          const q = new THREE.Vector3(...hit.p).addScaledVector(new THREE.Vector3(...hit.face.n), 0.01);
          pts.push(q);
          if (i % n === 0) corners.push(q);
        });
        if (pts.length > 2) {
          pts.push(pts[0]!.clone());
          projGroup.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(pts),
              new THREE.LineBasicMaterial({ color }),
            ),
          );
        }
        const origin = new THREE.Vector3(...p.pos);
        for (const c of corners)
          projGroup.add(
            new THREE.Line(
              new THREE.BufferGeometry().setFromPoints([origin, c]),
              new THREE.LineBasicMaterial({ color, transparent: true, opacity: sel ? 0.7 : 0.3 }),
            ),
          );
        const body = new THREE.Mesh(
          new THREE.BoxGeometry(0.22, 0.11, 0.18),
          new THREE.MeshBasicMaterial({
            color: sel ? 0xffb347 : 0x9d93d9,
            transparent: true,
            opacity: sel ? 0.95 : 0.55,
          }),
        );
        body.position.copy(origin);
        body.rotation.set(p.pitch, -p.yaw, 0, 'YXZ');
        body.userData.outputId = o.id;
        projGroup.add(body);
      }
    };
    let lastKey = '';

    // --- room corners (numbered) for measuring
    const cornerGroup = new THREE.Group();
    scene.add(cornerGroup);
    const corners = roomCorners(roomFold(st.surfaces));
    const label = (text: string, color: string) => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      g.fillStyle = color;
      g.beginPath();
      g.arc(32, 32, 30, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#05040c';
      g.font = '700 34px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 32, 34);
      const t = new THREE.CanvasTexture(c);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
      sp.scale.set(0.22, 0.22, 1);
      return sp;
    };
    const buildCorners = () => {
      for (const c of [...cornerGroup.children]) {
        cornerGroup.remove(c);
        const m = (c as THREE.Sprite).material;
        m.map?.dispose();
        m.dispose();
      }
      if (modeRef.current !== 'align') return;
      const o = stateRef.current.outputs.find((x) => x.id === selRef.current);
      const done = new Set(o ? anchorsOf(o).map((a) => a.c) : []);
      for (const c of corners) {
        const sp = label(
          String(c.n),
          c.id === cornerRef.current ? '#ffb347' : done.has(c.id) ? '#7dff8a' : '#3ff2ff',
        );
        sp.position.set(...c.p);
        sp.userData.corner = c.id;
        cornerGroup.add(sp);
      }
    };

    // --- view direction and zoom
    const look = new THREE.Vector3(...geo.lookAt).sub(cam.position);
    let yaw = Math.atan2(look.x, -look.z);
    let pitch = Math.atan2(look.y, Math.hypot(look.x, look.z));
    const applyView = () => {
      pitch = Math.max(-1.5, Math.min(1.5, pitch));
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

    // --- interaction
    const ray = new THREE.Raycaster();
    const pick = (cx: number, cy: number, objs: THREE.Object3D[]) => {
      const rect = canvas.getBoundingClientRect();
      ray.setFromCamera(
        new THREE.Vector2(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1),
        cam,
      );
      return ray.intersectObjects(objs, false)[0] ?? null;
    };
    type Drag =
      { kind: 'look'; x: number; y: number; yaw: number; pitch: number } | { kind: 'edit'; id: string };
    let drag: Drag | null = null;
    const pts = new Map<number, { x: number; y: number }>();
    let pinch0: { d: number; fov: number } | null = null;
    const editAt = (id: string, cx: number, cy: number) => {
      const hit = pick(cx, cy, meshes);
      const o = stateRef.current.outputs.find((x) => x.id === id);
      if (!hit || !o) return;
      const p = poseOf(o) ?? poseForSurface(stateRef.current.surfaces, null, new Set());
      if (!p) return;
      const target: V3 = [hit.point.x, hit.point.y, hit.point.z];
      if (modeRef.current === 'aim') drafts.current[id] = aimPose(p.pos, target, p.fov, p.roll);
      else {
        // new standing position on the floor (height kept), still aiming at the same spot
        const cur = roomRay(fold, p.pos, poseDir(p));
        const pos: V3 = [hit.point.x, p.pos[1], hit.point.z];
        drafts.current[id] = cur ? aimPose(pos, cur.p, p.fov, p.roll) : { ...p, pos };
      }
      force((n) => n + 1);
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, c] = [...pts.values()];
        pinch0 = { d: Math.hypot(a!.x - c!.x, a!.y - c!.y), fov: cam.fov };
        drag = null;
        return;
      }
      const body = pick(
        e.clientX,
        e.clientY,
        projGroup.children.filter((c) => c.userData.outputId),
      );
      if (body) {
        onSelect(body.object.userData.outputId as string);
        drag = null;
        return;
      }
      if (modeRef.current === 'align') {
        // tap a numbered corner to measure it, otherwise look around
        const rect = canvas.getBoundingClientRect();
        let best: { id: string; d: number } | null = null;
        for (const sp of cornerGroup.children) {
          const v = sp.position.clone().project(cam);
          if (v.z > 1) continue;
          const x = rect.left + ((v.x + 1) / 2) * rect.width;
          const y = rect.top + ((1 - v.y) / 2) * rect.height;
          const d = Math.hypot(x - e.clientX, y - e.clientY);
          if (d < 36 && (!best || d < best.d)) best = { id: sp.userData.corner as string, d };
        }
        if (best) {
          onPickCorner.current(best.id);
          drag = null;
          return;
        }
      }
      const id = selRef.current;
      if (id && modeRef.current !== 'look' && modeRef.current !== 'align') {
        drag = { kind: 'edit', id };
        editAt(id, e.clientX, e.clientY);
        return;
      }
      drag = { kind: 'look', x: e.clientX, y: e.clientY, yaw, pitch };
    };
    const onMove = (e: PointerEvent) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch0 && pts.size === 2) {
        const [a, c] = [...pts.values()];
        cam.fov = Math.max(
          30,
          Math.min(100, (pinch0.fov * pinch0.d) / Math.max(1, Math.hypot(a!.x - c!.x, a!.y - c!.y))),
        );
        cam.updateProjectionMatrix();
        return;
      }
      if (!drag) return;
      if (drag.kind === 'look') {
        const k = (cam.fov / 75) * 0.005;
        yaw = drag.yaw - (e.clientX - drag.x) * k;
        pitch = drag.pitch + (e.clientY - drag.y) * k;
        applyView();
      } else editAt(drag.id, e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch0 = null;
      const d = drag;
      drag = null;
      if (d?.kind === 'edit') sendPose(d.id);
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
      const key = JSON.stringify([
        selRef.current,
        modeRef.current,
        cornerRef.current,
        stateRef.current.outputs.map((o) => [
          o.id,
          poseOf(o),
          activeProfile(o).referenceResolution,
          anchorsOf(o),
        ]),
      ]);
      if (key !== lastKey) {
        lastKey = key;
        buildProjectors();
        buildCorners();
      }
      cg.drawImage(src, 0, 0, TW, TH);
      tex.needsUpdate = true;
      r3.render(scene, cam);
    };
    loop();
    const updateState = setInterval(() => stage.setState(withRoom(stateRef.current), null), 250);
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
      r3.dispose();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey]);

  // corner measuring: the projector shows edges/corners/markers while this mode is open
  const alignOut = mode === 'align' ? selected : null;
  useEffect(() => {
    if (!alignOut) return;
    void store.send({ t: 'output.align', outputId: alignOut, on: true, sel: corner });
  }, [alignOut, corner, store]);
  useEffect(() => {
    if (!alignOut) return;
    return () => void store.send({ t: 'output.align', outputId: alignOut, on: false, sel: null });
  }, [alignOut, store]);
  const anchorTimer = useRef(0);
  const sendAnchors = (id: string, list: Anchor[], final: boolean) => {
    anchorDrafts.current[id] = list;
    force((n) => n + 1);
    const flush = () => {
      anchorTimer.current = 0;
      const l = anchorDrafts.current[id];
      if (!l) return;
      void store.send({ t: 'output.setAnchors', outputId: id, anchors: l }).finally(() => {
        if (anchorDrafts.current[id] === l) delete anchorDrafts.current[id];
      });
    };
    if (final) {
      window.clearTimeout(anchorTimer.current);
      flush();
    } else if (!anchorTimer.current) anchorTimer.current = window.setTimeout(flush, 90);
  };

  const onPickCorner = useRef<(id: string) => void>(() => {});
  onPickCorner.current = (id: string) => setCorner(id);

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

  const sel = state.outputs.find((o) => o.id === selected) ?? null;
  const selPose = sel ? poseOf(sel) : null;
  const update = (patch: Partial<Pose>) => {
    if (!sel || !selPose) return;
    drafts.current[sel.id] = { ...selPose, ...patch };
    force((n) => n + 1);
  };
  const commit = () => {
    if (sel) sendPose(sel.id);
  };

  if (!state.surfaces.length)
    return <p className="muted">{L('Add surfaces first.', 'Lege zuerst Flächen an.')}</p>;
  return (
    <div className="stack">
      <div className="row">
        {state.outputs.map((o) => (
          <button
            key={o.id}
            className={`chip${o.id === selected ? ' on' : ''}`}
            onClick={() => onSelect(o.id)}
          >
            📽 {o.name}
            {!state.devices.some((d) => d.outputId === o.id && d.status === 'approved') && (
              <span className="muted small"> · {L('planned', 'geplant')}</span>
            )}
          </button>
        ))}
        <button
          className="btn small"
          onClick={() =>
            store.send({
              t: 'output.create',
              name: `${L('Projector', 'Beamer')} ${state.outputs.length + 1}`,
            })
          }
        >
          ＋ {L('Plan projector', 'Beamer planen')}
        </button>
      </div>
      <div className="row">
        <span className="muted small">{L('Quick setup:', 'Schnell-Aufstellung:')}</span>
        {(
          [
            ['sides', '🧊 ' + L('6 projectors, one per side', '6 Beamer, je Seite einer')],
            ['threeWalls', '↔️ ' + L('1 projector, 3 walls', '1 Beamer für 3 Wände')],
            ['threeWallsPlus', '↔️ ' + L('3 walls + floor + ceiling', '3 Wände + Boden + Decke')],
            ['wallFloor', '📐 ' + L('1 projector, wall + floor', '1 Beamer Wand + Boden')],
            ['mainOnly', '🏠 ' + L('Main wall only', 'Nur Hauptwand')],
          ] as const
        ).map(([layout, label]) => (
          <button
            key={layout}
            className="btn small"
            onClick={() => {
              if (
                state.outputs.length &&
                !window.confirm(
                  L(
                    'Replace the planned projectors with this setup? Connected projectors are re-aimed.',
                    'Geplante Beamer durch diese Aufstellung ersetzen? Verbundene Beamer werden neu ausgerichtet.',
                  ),
                )
              )
                return;
              drafts.current = {};
              store.send({ t: 'output.arrange', layout });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="row" role="tablist">
        {(
          [
            ['look', '👀 ' + L('Look around', 'Umschauen')],
            ['aim', '🎯 ' + L('Aim', 'Ausrichten')],
            ['place', '📍 ' + L('Position', 'Standort')],
            ['align', '📐 ' + L('Measure corners', 'Ecken einmessen')],
          ] as [Mode, string][]
        ).map(([m, label]) => (
          <button key={m} className={`chip${mode === m ? ' on' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
        <button className={`btn small${gyro ? ' on' : ''}`} onClick={toggleGyro}>
          📱 {L('Move the phone', 'Handy bewegen')}
        </button>
      </div>
      <div ref={hostRef} className="room3d" />
      {sel && !selPose && (
        <button
          className="btn primary"
          onClick={() =>
            store.send({
              t: 'output.setPose',
              outputId: sel.id,
              pose: poseForSurface(state.surfaces, null, new Set()),
            })
          }
        >
          {L('Put this projector into the room', 'Diesen Beamer in den Raum stellen')}
        </button>
      )}
      {mode === 'align' && sel && selPose && (
        <CornerPad
          L={L}
          pose={selPose}
          aspect={outputAspect(sel)}
          corners={roomCorners(roomFold(state.surfaces))}
          corner={corner}
          onCorner={setCorner}
          anchors={anchorsOf(sel)}
          onAnchors={(list, final) => sendAnchors(sel.id, list, final)}
          onDone={() => setMode('aim')}
        />
      )}
      {sel && selPose && mode !== 'align' && (
        <div className="panel stack" onPointerUp={commit} onKeyUp={commit}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>📽 {sel.name}</strong>
            <button
              className="btn small danger"
              onClick={() => {
                if (!window.confirm(L(`Remove ${sel.name}?`, `${sel.name} entfernen?`))) return;
                delete drafts.current[sel.id];
                store.send({ t: 'output.delete', outputId: sel.id });
              }}
            >
              🗑 {L('Remove', 'Entfernen')}
            </button>
          </div>
          <Slider
            label={L('Picture size (zoom)', 'Bildgröße (Zoom)')}
            value={selPose.fov}
            min={10}
            max={120}
            step={0.5}
            onChange={(v) => update({ fov: v })}
            format={(v) => `${Math.round(v)}°`}
          />
          <Slider
            label={L('Rotate picture', 'Bild drehen')}
            value={(selPose.roll * 180) / Math.PI}
            min={-180}
            max={180}
            step={0.5}
            onChange={(v) => update({ roll: (v * Math.PI) / 180 })}
            format={(v) => `${Math.round(v)}°`}
          />
          <Slider
            label={L('Mounting height', 'Höhe des Beamers')}
            value={selPose.pos[1]}
            min={0}
            max={4}
            step={0.05}
            onChange={(v) => update({ pos: [selPose.pos[0], v, selPose.pos[2]] })}
            format={(v) => `${v.toFixed(2)} m`}
          />
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Choose a projector (button or tap its box). 🎯 Aim: tap or drag where its picture should be – walls, floor, ceiling, also across corners. 📍 Position: tap on the floor where it stands. 👀 Look around: drag to look, pinch to zoom. The outline shows exactly what it projects.',
          'Beamer wählen (Knopf oder auf seinen Kasten tippen). 🎯 Ausrichten: dorthin tippen oder ziehen, wo sein Bild sein soll – Wand, Boden, Decke, auch über Ecken. 📍 Standort: auf den Boden tippen, wo er steht. 👀 Umschauen: ziehen = schauen, zwei Finger = zoomen. Der Umriss zeigt genau, was er projiziert.',
        )}
      </p>
    </div>
  );
}
