import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { baseWarp, warpPoint } from '@spectrastage/engine';
import {
  activeProfile,
  isConvexQuad,
  ProfileSchema,
  UNIT_QUAD,
  type Mask,
  type Output,
  type Profile,
  type Pt,
} from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { uuid } from '../lib/storage.ts';
import { useShow, useStore } from './store.ts';
import { download, pickJsonFile, Slider } from './ui.tsx';
import { StagePreview } from './Preview.tsx';

type Mode = 'corners' | 'mesh' | 'masks' | 'image';
type Handle =
  | { kind: 'corner'; i: number }
  | { kind: 'mesh'; i: number }
  | { kind: 'mask'; maskId: string; i: number }
  | null;

/** 1–4 image corners, 5/6 the two ends of a room-corner crease. */
const CORNER_COLORS = ['#ff4d4d', '#4dff88', '#4da6ff', '#ffe14d', '#ff8a1f', '#c39bff'];

function cornerAt(p: Profile, i: number): Pt | undefined {
  return i < 4 ? p.corners[i] : i === 4 ? p.fold?.a : p.fold?.b;
}

export function CalibrationEditor({ output, onClose }: { output: Output; onClose: () => void }) {
  const L = useT();
  const store = useStore();
  const { state } = useShow();
  const saved = activeProfile(output);
  const [draft, setDraftRaw] = useState<Profile>(() => structuredClone(saved));
  const [history, setHistory] = useState<Profile[]>([]);
  const [future, setFuture] = useState<Profile[]>([]);
  const [mode, setMode] = useState<Mode>('corners');
  const [handle, setHandle] = useState<Handle>({ kind: 'corner', i: 0 });
  const [maskId, setMaskId] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Pt[] | null>(null);
  const [fine, setFine] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  /** Full-screen touchpad for adjusting while looking at the wall (phones). */
  const [justify, setJustify] = useState(false);
  const jpadRef = useRef<{ x: number; y: number; start: Pt; before: Profile; w: number } | null>(null);
  const [zoom, setZoom] = useState({ s: 1, cx: 0.5, cy: 0.5 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ handle: NonNullable<Handle>; before: Profile } | null>(null);
  const panRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  /** Touchpad mode: drag anywhere to move the selected point relatively (finger never covers it). */
  const padRef = useRef<{ x: number; y: number; start: Pt; before: Profile } | null>(null);
  const [svgW, setSvgW] = useState(600);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const previewTimer = useRef(0);

  const res = saved.referenceResolution ?? output.resolutionMismatch ?? { w: 1920, h: 1080 };
  const aspect = res.w / res.h;
  const W = 1000;
  const H = W / aspect;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const testOn = output.testPattern.mode !== 'off' && output.testPattern.until > Date.now();

  // Live preview on the projector (transient, not persisted)
  useEffect(() => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(
      () =>
        store.conn.sendPreview(
          output.id,
          draft,
          mode === 'corners' && handle?.kind === 'corner' ? handle.i : -1,
        ),
      60,
    );
  }, [draft, output.id, store, mode, handle]);
  useEffect(() => () => store.conn.sendPreview(output.id, null), [output.id, store]);

  // Pick up server-side changes (other controller / profile switch) when not editing
  useEffect(() => {
    if (!dirty) setDraftRaw(structuredClone(saved));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(saved)]);

  const commit = useCallback((next: Profile, before?: Profile) => {
    setHistory((h) => [...h.slice(-49), before ?? next]);
    setFuture([]);
    setDraftRaw(next);
  }, []);
  const setDraft = (fn: (p: Profile) => Profile) => commit(fn(structuredClone(draft)), draft);
  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setFuture((f) => [draft, ...f]);
    setHistory((h) => h.slice(0, -1));
    setDraftRaw(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setHistory((h) => [...h, draft]);
    setFuture((f) => f.slice(1));
    setDraftRaw(next);
  };

  const toNorm = (e: { clientX: number; clientY: number }): Pt => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x / W, y: p.y / H };
  };

  const warp = useMemo(() => baseWarp(draft), [draft]);
  const cornerIds = draft.fold ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3];
  const handlePts = cornerIds.map((i) => ({ i, c: cornerAt(draft, i)! }));
  const meshPos = (i: number): Pt => {
    const m = draft.mesh!;
    const u = (i % m.cols) / (m.cols - 1);
    const v = Math.floor(i / m.cols) / (m.rows - 1);
    const base = warp ? warp(u, v) : { x: u, y: v };
    const o = m.offsets[i] ?? { x: 0, y: 0 };
    return { x: base.x + o.x, y: base.y + o.y };
  };

  const moveHandle = (h: NonNullable<Handle>, p: Pt, base: Profile): Profile => {
    const next = structuredClone(base);
    const clampP = (q: Pt) => ({
      x: Math.max(-0.5, Math.min(1.5, q.x)),
      y: Math.max(-0.5, Math.min(1.5, q.y)),
    });
    if (h.kind === 'corner' && h.i >= 4) {
      if (next.fold) next.fold = { ...next.fold, [h.i === 4 ? 'a' : 'b']: clampP(p) };
    } else if (h.kind === 'corner') {
      const c = [...next.corners] as Profile['corners'];
      c[h.i] = clampP(p);
      if (isConvexQuad(c)) next.corners = c;
    } else if (h.kind === 'mesh' && next.mesh && warp) {
      const m = next.mesh;
      const u = (h.i % m.cols) / (m.cols - 1);
      const v = Math.floor(h.i / m.cols) / (m.rows - 1);
      const b = warp(u, v);
      m.offsets[h.i] = {
        x: Math.max(-0.2, Math.min(0.2, p.x - b.x)),
        y: Math.max(-0.2, Math.min(0.2, p.y - b.y)),
      };
    } else if (h.kind === 'mask') {
      const m = next.masks.find((x) => x.id === h.maskId);
      if (m) m.points[h.i] = { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) };
    }
    return next;
  };

  const onHandleDown = (e: RPointerEvent, h: NonNullable<Handle>) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setHandle(h);
    dragRef.current = { handle: h, before: draft };
  };
  const handlePos = (h: NonNullable<Handle>, p: Profile): Pt | undefined =>
    h.kind === 'corner'
      ? cornerAt(p, h.i)
      : h.kind === 'mesh'
        ? meshPos(h.i)
        : p.masks.find((m) => m.id === h.maskId)?.points[h.i];
  const onMove = (e: RPointerEvent) => {
    if (padRef.current && handle) {
      const rect = svgRef.current!.getBoundingClientRect();
      const k = (vbW / W / rect.width) * (fine ? 0.2 : 1);
      const pr = padRef.current;
      const p = {
        x: pr.start.x + (e.clientX - pr.x) * k,
        y: pr.start.y + (e.clientY - pr.y) * k * aspect * (H / W) * (W / H),
      };
      setDraftRaw(moveHandle(handle, p, pr.before));
      return;
    }
    if (dragRef.current) {
      setDraftRaw(moveHandle(dragRef.current.handle, toNorm(e), draft));
      return;
    }
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const k = 1 / zoom.s / rect.width;
      setZoom((z) => ({
        ...z,
        cx: panRef.current!.cx - (e.clientX - panRef.current!.x) * k,
        cy: panRef.current!.cy - ((e.clientY - panRef.current!.y) * k * aspect) / 1,
      }));
    }
  };
  const onUp = () => {
    if (padRef.current) {
      const before = padRef.current.before;
      padRef.current = null;
      if (JSON.stringify(before) !== JSON.stringify(draft)) {
        setHistory((h) => [...h.slice(-49), before]);
        setFuture([]);
      }
    }
    if (dragRef.current) {
      const before = dragRef.current.before;
      dragRef.current = null;
      if (JSON.stringify(before) !== JSON.stringify(draft)) {
        setHistory((h) => [...h.slice(-49), before]);
        setFuture([]);
      }
    }
    panRef.current = null;
  };
  const onBgDown = (e: RPointerEvent) => {
    if (drawing) {
      const p = toNorm(e);
      setDrawing([...drawing, { x: Math.max(0, Math.min(1, p.x)), y: Math.max(0, Math.min(1, p.y)) }]);
      return;
    }
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const start = handle && mode !== 'image' ? handlePos(handle, draft) : undefined;
    if (handle && start) {
      padRef.current = { x: e.clientX, y: e.clientY, start, before: draft };
      return;
    }
    panRef.current = { x: e.clientX, y: e.clientY, cx: zoom.cx, cy: zoom.cy };
  };

  const nudge = (dx: number, dy: number) => {
    if (!handle) return;
    const step = fine ? 0.0005 : 0.004;
    const cur =
      handle.kind === 'corner'
        ? cornerAt(draft, handle.i)!
        : handle.kind === 'mesh'
          ? meshPos(handle.i)
          : draft.masks.find((m) => m.id === handle.maskId)?.points[handle.i];
    if (!cur) return;
    commit(moveHandle(handle, { x: cur.x + dx * step, y: cur.y + dy * step }, draft), draft);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        nudge(d[0]!, d[1]!);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  /** Crease where two surfaces meet inside this projector's stage area (closest to the middle). */
  const autoFoldAt = (axis: 'x' | 'y'): number => {
    const vp = draft.viewport;
    const lo = axis === 'x' ? vp.x : vp.y;
    const len = axis === 'x' ? vp.w : vp.h;
    let best = 0.5;
    for (const s of state.surfaces) {
      const xs = s.polygon.map((q) => (axis === 'x' ? q.x : q.y));
      for (const e of [Math.min(...xs), Math.max(...xs)]) {
        const f = (e - lo) / len;
        if (f > 0.05 && f < 0.95 && Math.abs(f - 0.5) < Math.abs(best - 0.5) + (best === 0.5 ? 1 : 0))
          best = f;
      }
    }
    return best;
  };
  const setFold = (axis: 'x' | 'y' | null) => {
    if (!axis) {
      commit({ ...draft, fold: null }, draft);
      setHandle({ kind: 'corner', i: 0 });
      return;
    }
    const at = autoFoldAt(axis);
    const w0 = baseWarp({ ...draft, fold: null });
    if (!w0) return;
    const a = axis === 'x' ? w0(at, 0) : w0(0, at);
    const b = axis === 'x' ? w0(at, 1) : w0(1, at);
    commit({ ...draft, fold: { axis, at, a, b } }, draft);
    setHandle({ kind: 'corner', i: 4 });
  };

  const apply = async () => {
    if (!isConvexQuad(draft.corners)) return;
    if (
      !testOn &&
      !window.confirm(
        L(
          'The show is live on this projector. Apply the changes now?',
          'Die Show läuft live auf diesem Beamer. Änderungen jetzt übernehmen?',
        ),
      )
    )
      return;
    const ok = await store.send({
      t: 'output.saveProfile',
      outputId: output.id,
      profile: draft,
      activate: true,
    });
    if (ok) store.toast(L('Calibration saved', 'Kalibrierung gespeichert'));
  };
  const close = () => {
    if (dirty && !window.confirm(L('Discard unsaved changes?', 'Ungespeicherte Änderungen verwerfen?')))
      return;
    store.conn.sendPreview(output.id, null);
    onClose();
  };

  // Warped stage grid and surfaces for orientation
  const gridPaths = useMemo(() => {
    const paths: string[] = [];
    const N = 8;
    const line = (pts: (Pt | null)[]) =>
      pts
        .filter((p): p is Pt => !!p)
        .map((p, i) => `${i ? 'L' : 'M'}${p.x * W},${p.y * H}`)
        .join(' ');
    for (let i = 0; i <= N; i++) {
      const a: (Pt | null)[] = [];
      const b: (Pt | null)[] = [];
      for (let j = 0; j <= 24; j++) {
        a.push(warpPoint(draft, i / N, j / 24));
        b.push(warpPoint(draft, j / 24, i / N));
      }
      paths.push(line(a), line(b));
    }
    return paths;
  }, [draft, W, H]);
  const surfacePaths = useMemo(() => {
    const vp = draft.viewport;
    return state.surfaces.map((s) => {
      const pts: Pt[] = [];
      s.polygon.forEach((p, i) => {
        const n = s.polygon[(i + 1) % s.polygon.length]!;
        for (let k = 0; k < 12; k++) {
          const x = p.x + ((n.x - p.x) * k) / 12;
          const y = p.y + ((n.y - p.y) * k) / 12;
          const w = warpPoint(draft, (x - vp.x) / vp.w, (y - vp.y) / vp.h);
          if (w) pts.push(w);
        }
      });
      return {
        id: s.id,
        name: s.name,
        d: pts.map((p, i) => `${i ? 'L' : 'M'}${p.x * W},${p.y * H}`).join(' ') + 'Z',
      };
    });
  }, [draft, state.surfaces, W, H]);

  // Margin around the projector image so points on the edge stay grabbable.
  const PAD = 0.08;
  const vbW = (W * (1 + 2 * PAD)) / zoom.s;
  const vbH = (H * (1 + 2 * PAD)) / zoom.s;
  const vbX = zoom.cx * W - vbW / 2;
  const vbY = zoom.cy * H - vbH / 2;
  const hs = (15 * vbW) / Math.max(200, svgW); // ~15 px handle radius on screen

  const selMask = draft.masks.find((m) => m.id === maskId) ?? null;

  const jDown = (e: RPointerEvent) => {
    if (!handle) return;
    const start = handlePos(handle, draft);
    if (!start) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const w = (e.currentTarget as Element).getBoundingClientRect().width;
    jpadRef.current = { x: e.clientX, y: e.clientY, start, before: draft, w };
  };
  const jMove = (e: RPointerEvent) => {
    const pr = jpadRef.current;
    if (!pr || !handle) return;
    // A swipe across the whole pad moves the point by 40 % of the image (fine: 8 %).
    const k = (fine ? 0.08 : 0.4) / Math.max(200, pr.w);
    const p = { x: pr.start.x + (e.clientX - pr.x) * k, y: pr.start.y + (e.clientY - pr.y) * k * aspect };
    setDraftRaw(moveHandle(handle, p, pr.before));
  };
  const jUp = () => {
    const pr = jpadRef.current;
    jpadRef.current = null;
    if (pr && JSON.stringify(pr.before) !== JSON.stringify(draft)) {
      setHistory((h) => [...h.slice(-49), pr.before]);
      setFuture([]);
    }
  };
  const meshCount = draft.mesh?.offsets.length ?? 0;
  const stepHandle = (d: number) => {
    if (mode === 'corners') {
      const i = handle?.kind === 'corner' ? handle.i : 0;
      setHandle({ kind: 'corner', i: (i + d + cornerIds.length) % cornerIds.length });
    } else if (mode === 'mesh' && meshCount) {
      const i = handle?.kind === 'mesh' ? handle.i : 0;
      setHandle({ kind: 'mesh', i: (i + d + meshCount) % meshCount });
    } else if (mode === 'masks' && selMask) {
      const n = selMask.points.length;
      const i = handle?.kind === 'mask' ? handle.i : 0;
      setHandle({ kind: 'mask', maskId: selMask.id, i: (i + d + n) % n });
    }
  };
  const handleLabel =
    handle?.kind === 'corner'
      ? L(`Corner ${handle.i + 1}`, `Ecke ${handle.i + 1}`)
      : handle?.kind === 'mesh'
        ? L(`Grid point ${handle.i + 1}/${meshCount}`, `Gitterpunkt ${handle.i + 1}/${meshCount}`)
        : handle?.kind === 'mask'
          ? L(`Mask point ${handle.i + 1}`, `Maskenpunkt ${handle.i + 1}`)
          : L('No point selected', 'Kein Punkt gewählt');

  if (justify) {
    return (
      <div className="justify" role="dialog" aria-label={L('Adjust', 'Justieren')}>
        <div className="justify-top">
          <button className="btn" onClick={() => setJustify(false)}>
            ‹ {L('Editor', 'Editor')}
          </button>
          <button
            className="btn icon"
            onClick={undo}
            disabled={history.length === 0}
            aria-label={L('Undo', 'Rückgängig')}
          >
            ↶
          </button>
          <button className="btn primary grow" disabled={!dirty} onClick={apply}>
            {dirty ? L('Apply', 'Übernehmen') : L('Saved', 'Gespeichert')}
          </button>
        </div>
        {mode === 'corners' ? (
          <div className="justify-pick" role="group" aria-label={L('Select corner', 'Ecke wählen')}>
            {cornerIds.map((i) => (
              <button
                key={i}
                className={`btn corner-pick${handle?.kind === 'corner' && handle.i === i ? ' on' : ''}`}
                style={{ ['--c' as string]: CORNER_COLORS[i] }}
                onClick={() => setHandle({ kind: 'corner', i })}
              >
                {i + 1}
              </button>
            ))}
          </div>
        ) : (
          <div className="justify-pick">
            <button className="btn" onClick={() => stepHandle(-1)} aria-label={L('Previous', 'Vorheriger')}>
              ◀
            </button>
            <strong className="grow" style={{ textAlign: 'center' }}>
              {handleLabel}
            </strong>
            <button className="btn" onClick={() => stepHandle(1)} aria-label={L('Next', 'Nächster')}>
              ▶
            </button>
          </div>
        )}
        <div
          className="justify-pad"
          onPointerDown={jDown}
          onPointerMove={jMove}
          onPointerUp={jUp}
          onPointerCancel={jUp}
        >
          <svg
            viewBox={`${-W * 0.05} ${-H * 0.05} ${W * 1.1} ${H * 1.1}`}
            className="justify-mini"
            aria-hidden
          >
            <rect x={0} y={0} width={W} height={H} fill="none" stroke="#39336b" strokeWidth={4} />
            <polygon
              points={draft.corners.map((c) => `${c.x * W},${c.y * H}`).join(' ')}
              fill="rgba(255,255,255,0.06)"
              stroke="#fff"
              strokeWidth={5}
            />
            {handlePts.map(({ c, i }) => (
              <circle
                key={i}
                cx={c.x * W}
                cy={c.y * H}
                r={handle?.kind === 'corner' && handle.i === i ? 34 : 18}
                fill={CORNER_COLORS[i]}
                stroke="#fff"
                strokeWidth={handle?.kind === 'corner' && handle.i === i ? 6 : 0}
              />
            ))}
            {handle &&
              handle.kind !== 'corner' &&
              (() => {
                const p = handlePos(handle, draft);
                return p ? (
                  <circle cx={p.x * W} cy={p.y * H} r={26} fill="#ffb347" stroke="#fff" strokeWidth={5} />
                ) : null;
              })()}
          </svg>
          <div className="justify-hint">
            <strong>{handleLabel}</strong>
            <span>
              {L(
                'Look at the wall and swipe here – the point moves on the projector.',
                'Auf die Wand schauen und hier wischen – der Punkt bewegt sich am Beamer.',
              )}
            </span>
          </div>
        </div>
        <div className="justify-bottom">
          <button className="btn" onClick={() => nudge(-1, 0)} aria-label="left">
            ◀
          </button>
          <button className="btn" onClick={() => nudge(0, -1)} aria-label="up">
            ▲
          </button>
          <button className="btn" onClick={() => nudge(0, 1)} aria-label="down">
            ▼
          </button>
          <button className="btn" onClick={() => nudge(1, 0)} aria-label="right">
            ▶
          </button>
          <button
            className={`btn grow${fine ? ' on' : ''}`}
            onClick={() => setFine((f) => !f)}
            aria-pressed={fine}
          >
            {fine ? L('Fine', 'Fein') : L('Coarse', 'Grob')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn" onClick={close}>
          ‹ {L('Back', 'Zurück')}
        </button>
        <h2 style={{ margin: 0 }}>
          {L('Calibrate', 'Kalibrieren')}: {output.name}
        </h2>
        <div className="row">
          <button
            className="btn icon"
            onClick={undo}
            disabled={history.length === 0}
            aria-label={L('Undo', 'Rückgängig')}
          >
            ↶
          </button>
          <button
            className="btn icon"
            onClick={redo}
            disabled={future.length === 0}
            aria-label={L('Redo', 'Wiederholen')}
          >
            ↷
          </button>
        </div>
      </div>

      {!testOn && (
        <div className="safety-note row between">
          <span>
            {L(
              'Tip: switch on the test pattern to see the grid on the wall.',
              'Tipp: Schalte das Testbild ein, um das Gitter an der Wand zu sehen.',
            )}
          </span>
          <button
            className="btn small"
            onClick={() =>
              store.send({ t: 'output.testPattern', outputId: output.id, mode: 'grid', minutes: 10 })
            }
          >
            {L('Test pattern on (10 min)', 'Testbild an (10 Min.)')}
          </button>
        </div>
      )}

      {mode !== 'image' && (
        <button className="btn primary big" onClick={() => setJustify(true)}>
          ✋ {L('Adjust on the wall (full screen touchpad)', 'An der Wand justieren (Vollbild-Touchpad)')}
        </button>
      )}

      <div className="split">
        <div>
          <div className="row" role="tablist">
            {(
              [
                ['corners', L('Corners', 'Ecken')],
                ['mesh', L('Fine grid', 'Feingitter')],
                ['masks', L('Masks', 'Masken')],
                ['image', L('Image', 'Bild')],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <button
                key={m}
                className={`chip${mode === m ? ' on' : ''}`}
                onClick={() => (setMode(m), setHandle(null), setDrawing(null))}
                role="tab"
                aria-selected={mode === m}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="editor" style={{ aspectRatio: `${aspect}`, marginTop: '0.6rem' }}>
            <svg
              ref={svgRef}
              viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
              onPointerDown={onBgDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <rect x={-W} y={-H} width={W * 3} height={H * 3} fill="#05040c" />
              <rect
                x={0}
                y={0}
                width={W}
                height={H}
                fill="#000"
                stroke="#39336b"
                strokeWidth={(2 * vbW) / Math.max(200, svgW)}
              />
              {gridPaths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke="rgba(255,255,255,0.25)"
                  strokeWidth={1.2 / zoom.s}
                  pointerEvents="none"
                />
              ))}
              {surfacePaths.map((s) => (
                <path
                  key={s.id}
                  d={s.d}
                  fill="rgba(255,179,71,0.08)"
                  stroke="#ffb347"
                  strokeWidth={(2 * vbW) / Math.max(200, svgW)}
                  pointerEvents="none"
                />
              ))}
              <polygon
                points={draft.corners.map((c) => `${c.x * W},${c.y * H}`).join(' ')}
                fill="none"
                stroke="#fff"
                strokeWidth={(2.5 * vbW) / Math.max(200, svgW)}
                pointerEvents="none"
              />
              {draft.fold && (
                <line
                  x1={draft.fold.a.x * W}
                  y1={draft.fold.a.y * H}
                  x2={draft.fold.b.x * W}
                  y2={draft.fold.b.y * H}
                  stroke="#ff8a1f"
                  strokeDasharray={`${(8 * vbW) / Math.max(200, svgW)} ${(6 * vbW) / Math.max(200, svgW)}`}
                  strokeWidth={(2.5 * vbW) / Math.max(200, svgW)}
                  pointerEvents="none"
                />
              )}
              {/* crop */}
              <g fill="rgba(255,60,60,0.25)" pointerEvents="none">
                <rect x={0} y={0} width={W} height={draft.crop[0] * H} />
                <rect x={W - draft.crop[1] * W} y={0} width={draft.crop[1] * W} height={H} />
                <rect x={0} y={H - draft.crop[2] * H} width={W} height={draft.crop[2] * H} />
                <rect x={0} y={0} width={draft.crop[3] * W} height={H} />
              </g>
              {draft.masks.map((m) => (
                <MaskShape
                  key={m.id}
                  mask={m}
                  W={W}
                  H={H}
                  z={zoom.s}
                  selected={m.id === maskId}
                  onSelect={() => mode === 'masks' && setMaskId(m.id)}
                />
              ))}
              {drawing && (
                <polyline
                  points={drawing.map((p) => `${p.x * W},${p.y * H}`).join(' ')}
                  fill="rgba(255,60,60,0.2)"
                  stroke="#ff3c3c"
                  strokeWidth={(2 * vbW) / Math.max(200, svgW)}
                />
              )}
              {mode === 'corners' &&
                handlePts.map(({ c, i }) => (
                  <g key={i} onPointerDown={(e) => onHandleDown(e, { kind: 'corner', i })} className="handle">
                    <circle cx={c.x * W} cy={c.y * H} r={hs * 1.6} fill="transparent" />
                    <circle
                      cx={c.x * W}
                      cy={c.y * H}
                      r={hs}
                      fill={CORNER_COLORS[i]}
                      stroke={handle?.kind === 'corner' && handle.i === i ? '#fff' : '#000'}
                      strokeWidth={(3 * vbW) / Math.max(200, svgW)}
                    />
                    <text
                      x={c.x * W}
                      y={c.y * H}
                      fontSize={hs * 1.1}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#000"
                      fontWeight={800}
                      pointerEvents="none"
                    >
                      {i + 1}
                    </text>
                  </g>
                ))}
              {mode === 'mesh' &&
                draft.mesh?.offsets.map((_, i) => {
                  const p = meshPos(i);
                  return (
                    <circle
                      key={i}
                      className="handle"
                      cx={p.x * W}
                      cy={p.y * H}
                      r={hs * 0.8}
                      fill="#ffb347"
                      stroke={handle?.kind === 'mesh' && handle.i === i ? '#fff' : '#2a1600'}
                      strokeWidth={(3 * vbW) / Math.max(200, svgW)}
                      onPointerDown={(e) => onHandleDown(e, { kind: 'mesh', i })}
                    />
                  );
                })}
              {mode === 'masks' &&
                selMask &&
                selMask.points.map((p, i) => (
                  <circle
                    key={i}
                    className="handle"
                    cx={p.x * W}
                    cy={p.y * H}
                    r={hs * 0.8}
                    fill="#fff"
                    stroke={handle?.kind === 'mask' && handle.i === i ? '#ffb347' : '#ff3c3c'}
                    strokeWidth={(3 * vbW) / Math.max(200, svgW)}
                    onPointerDown={(e) => onHandleDown(e, { kind: 'mask', maskId: selMask.id, i })}
                  />
                ))}
            </svg>
          </div>
          {mode === 'corners' && (
            <div
              className="row"
              style={{ marginTop: '0.6rem' }}
              role="group"
              aria-label={L('Select corner', 'Ecke wählen')}
            >
              {cornerIds.map((i) => (
                <button
                  key={i}
                  className={`btn corner-pick${handle?.kind === 'corner' && handle.i === i ? ' on' : ''}`}
                  style={{ ['--c' as string]: CORNER_COLORS[i] }}
                  onClick={() => setHandle({ kind: 'corner', i })}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <p className="muted small" style={{ margin: '0.4rem 0 0' }}>
            {mode === 'image'
              ? L('Drag to move the view.', 'Ziehen verschiebt die Ansicht.')
              : L(
                  'Pick a point, then swipe anywhere on the image – the point follows your finger without being covered. “Fine” moves it 5× slower.',
                  'Punkt wählen, dann irgendwo aufs Bild wischen – der Punkt folgt, ohne vom Finger verdeckt zu werden. „Fein“ bewegt 5× langsamer.',
                )}
          </p>
          <div className="editor-tools">
            <button
              className="btn small"
              onClick={() => setZoom((z) => ({ ...z, s: Math.min(8, z.s * 1.5) }))}
            >
              ＋
            </button>
            <button
              className="btn small"
              onClick={() => setZoom((z) => ({ ...z, s: Math.max(1, z.s / 1.5) }))}
            >
              －
            </button>
            <button className="btn small" onClick={() => setZoom({ s: 1, cx: 0.5, cy: 0.5 })}>
              {L('Whole image', 'Ganzes Bild')}
            </button>
            {handle && (
              <button
                className="btn small"
                onClick={() => {
                  const p =
                    handle.kind === 'corner'
                      ? cornerAt(draft, handle.i)!
                      : handle.kind === 'mesh'
                        ? meshPos(handle.i)
                        : selMask?.points[handle.i];
                  if (p) setZoom({ s: 4, cx: p.x, cy: p.y });
                }}
              >
                {L('Zoom to point', 'Zum Punkt zoomen')}
              </button>
            )}
            <div style={{ marginTop: '0.4rem' }}>
              <button
                className={`btn small${showPreview ? ' on' : ''}`}
                onClick={() => setShowPreview((v) => !v)}
              >
                {L('Preview projector image', 'Vorschau Beamerbild')}
              </button>
              {showPreview && (
                <div style={{ marginTop: '0.5rem' }}>
                  <StagePreview
                    state={state}
                    now={() => store.conn.clock.now()}
                    outputId={output.id}
                    profile={dirty ? draft : null}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="stack">
          {handle && (
            <div className="panel">
              <h3>{L('Fine adjust', 'Feinjustage')}</h3>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div className="nudge">
                  <button
                    className="btn"
                    style={{ gridColumn: 2, gridRow: 1 }}
                    onClick={() => nudge(0, -1)}
                    aria-label="up"
                  >
                    ▲
                  </button>
                  <button
                    className="btn"
                    style={{ gridColumn: 1, gridRow: 2 }}
                    onClick={() => nudge(-1, 0)}
                    aria-label="left"
                  >
                    ◀
                  </button>
                  <button className={`btn c${fine ? ' on' : ''}`} onClick={() => setFine((f) => !f)}>
                    {fine ? L('fine', 'fein') : L('coarse', 'grob')}
                  </button>
                  <button
                    className="btn"
                    style={{ gridColumn: 3, gridRow: 2 }}
                    onClick={() => nudge(1, 0)}
                    aria-label="right"
                  >
                    ▶
                  </button>
                  <button
                    className="btn"
                    style={{ gridColumn: 2, gridRow: 3 }}
                    onClick={() => nudge(0, 1)}
                    aria-label="down"
                  >
                    ▼
                  </button>
                </div>
                {handle.kind === 'corner' && cornerAt(draft, handle.i) && (
                  <div className="stack grow">
                    <label>
                      X (px)
                      <input
                        type="number"
                        value={Math.round(cornerAt(draft, handle.i)!.x * res.w)}
                        onChange={(e) =>
                          commit(
                            moveHandle(
                              handle,
                              { x: Number(e.target.value) / res.w, y: cornerAt(draft, handle.i)!.y },
                              draft,
                            ),
                            draft,
                          )
                        }
                      />
                    </label>
                    <label>
                      Y (px)
                      <input
                        type="number"
                        value={Math.round(cornerAt(draft, handle.i)!.y * res.h)}
                        onChange={(e) =>
                          commit(
                            moveHandle(
                              handle,
                              { x: cornerAt(draft, handle.i)!.x, y: Number(e.target.value) / res.h },
                              draft,
                            ),
                            draft,
                          )
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          )}

          {mode === 'corners' && (
            <div className="panel">
              <p className="muted small">
                {L(
                  'Move the numbered corners until the white frame on the wall sits exactly on the edges of your surfaces. The colors match the test pattern on the projector.',
                  'Verschiebe die nummerierten Ecken, bis der weiße Rahmen an der Wand genau auf den Kanten deiner Flächen liegt. Die Farben entsprechen dem Testbild am Beamer.',
                )}
              </p>
              <button
                className="btn small"
                onClick={() =>
                  setDraft((p) => ({ ...p, corners: structuredClone(UNIT_QUAD) as Profile['corners'] }))
                }
              >
                {L('Reset corners', 'Ecken zurücksetzen')}
              </button>
            </div>
          )}

          {mode === 'corners' && !saved.pose && (
            <div className="panel stack">
              <h3 style={{ margin: 0 }}>{L('Room corner', 'Raumecke')}</h3>
              <p className="muted small" style={{ margin: 0 }}>
                {L(
                  'Does this projector hit two surfaces at an angle (wall + wall around the corner, or wall + floor)? Mark the crease: points 5 and 6 go onto the real corner line, each side gets its own perspective.',
                  'Trifft dieser Beamer zwei Flächen im Winkel (Wand + Wand ums Eck oder Wand + Boden)? Markiere den Knick: Punkte 5 und 6 kommen auf die echte Eckkante, jede Seite bekommt ihre eigene Perspektive.',
                )}
              </p>
              <div className="row">
                {(
                  [
                    [null, L('None', 'Keine')],
                    ['x', L('Vertical (wall | wall)', 'Senkrecht (Wand | Wand)')],
                    ['y', L('Horizontal (wall / floor)', 'Waagerecht (Wand / Boden)')],
                  ] as const
                ).map(([axis, label]) => (
                  <button
                    key={String(axis)}
                    className={`chip${(draft.fold?.axis ?? null) === axis ? ' on' : ''}`}
                    onClick={() => setFold(axis)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {draft.fold && (
                <label>
                  {L('Crease position in the stage image', 'Lage des Knicks im Bühnenbild')}:{' '}
                  {Math.round(draft.fold.at * 100)} %
                  <input
                    type="range"
                    min={0.05}
                    max={0.95}
                    step={0.005}
                    value={draft.fold.at}
                    onChange={(e) =>
                      setDraftRaw({ ...draft, fold: { ...draft.fold!, at: Number(e.target.value) } })
                    }
                  />
                </label>
              )}
            </div>
          )}

          {mode === 'mesh' && (
            <div className="panel stack">
              <p className="muted small" style={{ margin: 0 }}>
                {L(
                  'For uneven or bent surfaces: move the inner points to correct the image locally.',
                  'Für unebene oder gewölbte Flächen: Verschiebe die Punkte, um das Bild lokal zu korrigieren.',
                )}
              </p>
              <div className="row">
                {[0, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`chip${(draft.mesh?.cols ?? 0) === n ? ' on' : ''}`}
                    onClick={() =>
                      setDraft((p) => ({
                        ...p,
                        mesh:
                          n === 0
                            ? null
                            : {
                                cols: n,
                                rows: n,
                                offsets: Array.from({ length: n * n }, () => ({ x: 0, y: 0 })),
                              },
                      }))
                    }
                  >
                    {n === 0 ? L('off', 'aus') : `${n}×${n}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'image' && <ImagePanel draft={draft} setDraft={setDraft} L={L} />}

          {mode === 'masks' && (
            <MasksPanel
              draft={draft}
              setDraft={setDraft}
              selected={selMask}
              select={setMaskId}
              drawing={drawing}
              setDrawing={setDrawing}
              L={L}
              showOnProjector={output.showMasks}
              toggleShow={() =>
                store.send({ t: 'output.update', outputId: output.id, showMasks: !output.showMasks })
              }
            />
          )}

          <ProfilesPanel output={output} draft={draft} dirty={dirty} L={L} onLoad={(p) => commit(p, draft)} />

          <div
            className="calib-bar"
            role="toolbar"
            aria-label={L('Calibration actions', 'Kalibrier-Aktionen')}
          >
            <button
              className="btn icon"
              onClick={undo}
              disabled={history.length === 0}
              aria-label={L('Undo', 'Rückgängig')}
            >
              ↶
            </button>
            <button
              className="btn icon"
              onClick={redo}
              disabled={future.length === 0}
              aria-label={L('Redo', 'Wiederholen')}
            >
              ↷
            </button>
            <button
              className={`btn${fine ? ' on' : ''}`}
              onClick={() => setFine((f) => !f)}
              aria-pressed={fine}
            >
              {fine ? L('Fine', 'Fein') : L('Coarse', 'Grob')}
            </button>
            <button className="btn primary grow" disabled={!dirty} onClick={apply}>
              {L('Apply', 'Übernehmen')}
            </button>
          </div>
          <div className="panel stack">
            <button className="btn primary big" disabled={!dirty} onClick={apply}>
              {L('Apply calibration', 'Kalibrierung übernehmen')}
            </button>
            <button className="btn" disabled={!dirty} onClick={() => commit(structuredClone(saved), draft)}>
              {L('Discard changes', 'Änderungen verwerfen')}
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              {dirty
                ? L(
                    'The projector already shows your draft as a preview. It is saved only after “Apply”.',
                    'Der Beamer zeigt deinen Entwurf schon als Vorschau. Gespeichert wird erst mit „Übernehmen“.',
                  )
                : L('No unsaved changes.', 'Keine ungespeicherten Änderungen.')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MaskShape({
  mask,
  W,
  H,
  z,
  selected,
  onSelect,
}: {
  mask: Mask;
  W: number;
  H: number;
  z: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const color = mask.mode === 'include' ? '#4dff8a' : mask.mode === 'dim' ? '#78aaff' : '#ff3c3c';
  const common = {
    fill:
      mask.mode === 'include'
        ? 'rgba(77,255,138,0.15)'
        : mask.mode === 'dim'
          ? 'rgba(120,170,255,0.3)'
          : 'rgba(255,60,60,0.35)',
    stroke: color,
    strokeWidth: (selected ? 3 : 1.5) / z,
    strokeDasharray: mask.enabled ? undefined : `${6 / z} ${4 / z}`,
    onPointerDown: (e: RPointerEvent) => {
      e.stopPropagation();
      onSelect();
    },
    style: { cursor: 'pointer' },
  };
  const pts = mask.points.map((p) => ({ x: p.x * W, y: p.y * H }));
  const marginPx = mask.margin * W;
  if (mask.shape === 'polygon') {
    return (
      <g>
        {mask.mode === 'exclude' && marginPx > 0 && (
          <polygon
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke="rgba(255,60,60,0.35)"
            strokeWidth={marginPx * 2}
            strokeLinejoin="round"
            pointerEvents="none"
          />
        )}
        <polygon points={pts.map((p) => `${p.x},${p.y}`).join(' ')} {...common} fillRule="evenodd" />
      </g>
    );
  }
  const a = pts[0]!;
  const b = pts[1] ?? a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  return mask.shape === 'rect' ? (
    <g>
      {mask.mode === 'exclude' && marginPx > 0 && (
        <rect
          x={x - marginPx}
          y={y - marginPx}
          width={w + marginPx * 2}
          height={h + marginPx * 2}
          fill="rgba(255,60,60,0.18)"
          pointerEvents="none"
          rx={marginPx}
        />
      )}
      <rect x={x} y={y} width={w} height={h} {...common} />
    </g>
  ) : (
    <g>
      {mask.mode === 'exclude' && marginPx > 0 && (
        <ellipse
          cx={x + w / 2}
          cy={y + h / 2}
          rx={w / 2 + marginPx}
          ry={h / 2 + marginPx}
          fill="rgba(255,60,60,0.18)"
          pointerEvents="none"
        />
      )}
      <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />
    </g>
  );
}

function MasksPanel({
  draft,
  setDraft,
  selected,
  select,
  drawing,
  setDrawing,
  L,
  showOnProjector,
  toggleShow,
}: {
  draft: Profile;
  setDraft: (fn: (p: Profile) => Profile) => void;
  selected: Mask | null;
  select: (id: string | null) => void;
  drawing: Pt[] | null;
  setDrawing: (p: Pt[] | null) => void;
  L: Tr;
  showOnProjector: boolean;
  toggleShow: () => void;
}) {
  const add = (shape: Mask['shape'], points: Pt[]) => {
    const m: Mask = {
      id: uuid().slice(0, 12),
      name: `${L('Mask', 'Maske')} ${draft.masks.length + 1}`,
      mode: 'exclude',
      shape,
      points,
      margin: 0.01,
      feather: 0,
      safety: true,
      enabled: true,
    };
    setDraft((p) => ({ ...p, masks: [...p.masks, m] }));
    select(m.id);
  };
  const update = (patch: Partial<Mask>) =>
    selected &&
    setDraft((p) => ({ ...p, masks: p.masks.map((m) => (m.id === selected.id ? { ...m, ...patch } : m)) }));
  return (
    <div className="panel stack">
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Masks keep areas black: windows, doors, the neighbour’s house, the street. Red = no light, green = only light here.',
          'Masken halten Bereiche schwarz: Fenster, Türen, Nachbarhaus, Straße. Rot = kein Licht, grün = nur hier Licht.',
        )}
      </p>
      <label className="check">
        <input type="checkbox" checked={showOnProjector} onChange={toggleShow} />
        {L(
          'Show masked areas on the projector (setup only)',
          'Maskierte Bereiche am Beamer anzeigen (nur zum Einrichten)',
        )}
      </label>
      {drawing ? (
        <div className="stack">
          <p style={{ margin: 0 }}>
            {L('Tap the corners of the area on the image above.', 'Tippe oben die Ecken des Bereichs an.')} (
            {drawing.length})
          </p>
          <div className="row">
            <button
              className="btn primary"
              disabled={drawing.length < 3}
              onClick={() => {
                add('polygon', drawing);
                setDrawing(null);
              }}
            >
              {L('Finish shape', 'Form fertig')}
            </button>
            <button
              className="btn"
              onClick={() => setDrawing(drawing.slice(0, -1))}
              disabled={drawing.length === 0}
            >
              {L('Remove last point', 'Letzten Punkt entfernen')}
            </button>
            <button className="btn ghost" onClick={() => setDrawing(null)}>
              {L('Cancel', 'Abbrechen')}
            </button>
          </div>
        </div>
      ) : (
        <div className="row">
          <button className="btn small" onClick={() => setDrawing([])}>
            ＋ {L('Polygon', 'Vieleck')}
          </button>
          <button
            className="btn small"
            onClick={() =>
              add('rect', [
                { x: 0.4, y: 0.35 },
                { x: 0.6, y: 0.6 },
              ])
            }
          >
            ＋ {L('Rectangle', 'Rechteck')}
          </button>
          <button
            className="btn small"
            onClick={() =>
              add('ellipse', [
                { x: 0.42, y: 0.38 },
                { x: 0.58, y: 0.6 },
              ])
            }
          >
            ＋ {L('Ellipse', 'Ellipse')}
          </button>
        </div>
      )}
      {draft.masks.length > 0 && (
        <div className="list">
          {draft.masks.map((m, i) => (
            <div
              key={m.id}
              className="list-item"
              style={{ borderColor: m.id === selected?.id ? 'var(--lantern)' : undefined, padding: '0.5rem' }}
            >
              <button
                className="main"
                style={{ background: 'none', border: 0, textAlign: 'left', cursor: 'pointer' }}
                onClick={() => select(m.id)}
              >
                <div
                  className="title"
                  style={{
                    color: m.mode === 'include' ? 'var(--ok)' : m.mode === 'dim' ? '#9cc0ff' : '#ff8a8a',
                  }}
                >
                  {m.name}
                </div>
                <div className="muted small">
                  {m.mode === 'include'
                    ? L('only light here', 'nur hier Licht')
                    : m.mode === 'dim'
                      ? `${L('dimmed to', 'gedimmt auf')} ${Math.round((m.level ?? 0.5) * 100)} %`
                      : L('no light', 'kein Licht')}
                  {m.safety ? ` · ${L('safety', 'Sicherheit')}` : ''}
                  {!m.enabled ? ` · ${L('off', 'aus')}` : ''}
                </div>
              </button>
              <button
                className="btn icon small"
                disabled={i === 0}
                aria-label={L('Move up', 'Nach oben')}
                onClick={() =>
                  setDraft((p) => {
                    const masks = [...p.masks];
                    [masks[i - 1], masks[i]] = [masks[i]!, masks[i - 1]!];
                    return { ...p, masks };
                  })
                }
              >
                ↑
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div className="stack" style={{ borderTop: '1px solid var(--line)', paddingTop: '0.75rem' }}>
          <label>
            {L('Name', 'Name')}
            <input value={selected.name} onChange={(e) => update({ name: e.target.value.slice(0, 40) })} />
          </label>
          <div className="row">
            <button
              className={`chip${selected.mode === 'exclude' ? ' on' : ''}`}
              onClick={() => update({ mode: 'exclude' })}
            >
              {L('Keep black', 'Schwarz halten')}
            </button>
            <button
              className={`chip${selected.mode === 'include' ? ' on' : ''}`}
              onClick={() => update({ mode: 'include', safety: false })}
            >
              {L('Only light here', 'Nur hier Licht')}
            </button>
            <button
              className={`chip${selected.mode === 'dim' ? ' on' : ''}`}
              onClick={() => update({ mode: 'dim', safety: false, level: selected.level ?? 0.4 })}
            >
              {L('Dim', 'Abdunkeln')}
            </button>
          </div>
          {selected.mode === 'dim' && (
            <>
              <Slider
                label={L('Brightness in this area', 'Helligkeit in diesem Bereich')}
                value={Math.round((selected.level ?? 0.4) * 100)}
                min={0}
                max={100}
                step={5}
                format={(v) => `${v} %`}
                onChange={(v) => update({ level: v / 100 })}
              />
              <Slider
                label={L('Soft edge', 'Weiche Kante')}
                value={Math.round(selected.feather * 1000) / 10}
                min={0}
                max={5}
                step={0.5}
                format={(v) => `${v.toFixed(1)} %`}
                onChange={(v) => update({ feather: v / 100 })}
              />
            </>
          )}
          {selected.mode === 'exclude' && (
            <>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.safety}
                  onChange={(e) =>
                    update({ safety: e.target.checked, feather: e.target.checked ? 0 : selected.feather })
                  }
                />
                {L('Safety mask (hard edge, e.g. windows)', 'Sicherheitsmaske (harte Kante, z. B. Fenster)')}
              </label>
              <Slider
                label={L('Safety margin', 'Sicherheitsrand')}
                value={Math.round(selected.margin * 1000) / 10}
                min={0}
                max={8}
                step={0.5}
                format={(v) => `${v.toFixed(1)} %`}
                onChange={(v) => update({ margin: v / 100 })}
              />
              {!selected.safety && (
                <Slider
                  label={L('Soft edge', 'Weiche Kante')}
                  value={Math.round(selected.feather * 1000) / 10}
                  min={0}
                  max={5}
                  step={0.5}
                  format={(v) => `${v.toFixed(1)} %`}
                  onChange={(v) => update({ feather: v / 100 })}
                />
              )}
            </>
          )}
          <div className="row">
            <label className="check">
              <input
                type="checkbox"
                checked={selected.enabled}
                onChange={(e) => update({ enabled: e.target.checked })}
              />
              {L('Active', 'Aktiv')}
            </label>
            {selected.shape === 'polygon' && selected.points.length > 3 && (
              <button className="btn small" onClick={() => update({ points: selected.points.slice(0, -1) })}>
                {L('Remove last corner', 'Letzte Ecke entfernen')}
              </button>
            )}
            <button
              className="btn small danger"
              onClick={() => {
                setDraft((p) => ({ ...p, masks: p.masks.filter((m) => m.id !== selected.id) }));
                select(null);
              }}
            >
              {L('Delete mask', 'Maske löschen')}
            </button>
          </div>
        </div>
      )}
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'A black pixel is not zero light: projectors still glow slightly. Where light must not go, use the projector position or a physical cover.',
          'Ein schwarzes Pixel ist nicht null Licht: Beamer leuchten leicht nach. Wo wirklich kein Licht hin darf, hilft nur Position oder Abdeckung.',
        )}
      </p>
    </div>
  );
}

function ImagePanel({
  draft,
  setDraft,
  L,
}: {
  draft: Profile;
  setDraft: (fn: (p: Profile) => Profile) => void;
  L: Tr;
}) {
  const crop = (i: number, v: number) =>
    setDraft((p) => {
      const c = [...p.crop] as Profile['crop'];
      c[i] = v / 100;
      return { ...p, crop: c };
    });
  return (
    <div className="panel stack">
      <div>
        <div className="muted small" style={{ fontWeight: 600, marginBottom: 4 }}>
          {L('Rotate content', 'Inhalt drehen')}
        </div>
        <div className="row">
          {([0, 90, 180, 270] as const).map((r) => (
            <button
              key={r}
              className={`chip${draft.rotation === r ? ' on' : ''}`}
              onClick={() => setDraft((p) => ({ ...p, rotation: r }))}
            >
              {r}°
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <label className="check">
          <input
            type="checkbox"
            checked={draft.flipX}
            onChange={(e) => setDraft((p) => ({ ...p, flipX: e.target.checked }))}
          />
          {L('Mirror horizontally (rear projection)', 'Horizontal spiegeln (Rückprojektion)')}
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.flipY}
            onChange={(e) => setDraft((p) => ({ ...p, flipY: e.target.checked }))}
          />
          {L('Mirror vertically (ceiling mount)', 'Vertikal spiegeln (Deckenmontage)')}
        </label>
      </div>
      <div className="muted small" style={{ fontWeight: 600 }}>
        {L('Safe edges (crop)', 'Sichere Ränder (Beschnitt)')}
      </div>
      {[L('Top', 'Oben'), L('Right', 'Rechts'), L('Bottom', 'Unten'), L('Left', 'Links')].map((label, i) => (
        <Slider
          key={i}
          label={label}
          value={Math.round(draft.crop[i]! * 100)}
          min={0}
          max={40}
          step={1}
          format={(v) => `${v} %`}
          onChange={(v) => crop(i, v)}
        />
      ))}
      <div className="muted small" style={{ fontWeight: 600 }}>
        {L('Blend with neighbouring projector (overlap)', 'Überblenden zum Nachbar-Beamer (Überlappung)')}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Where two projector images overlap, fade both edges over the overlap width so the area is not twice as bright.',
          'Wo sich zwei Beamer-Bilder überlappen, blende beide Ränder über die Breite der Überlappung aus, damit die Stelle nicht doppelt hell ist.',
        )}
      </p>
      {[L('Top', 'Oben'), L('Right', 'Rechts'), L('Bottom', 'Unten'), L('Left', 'Links')].map((label, i) => (
        <Slider
          key={`b${i}`}
          label={label}
          value={Math.round((draft.blend?.[i] ?? 0) * 100)}
          min={0}
          max={40}
          step={1}
          format={(v) => `${v} %`}
          onChange={(v) =>
            setDraft((p) => {
              const b = [...(p.blend ?? [0, 0, 0, 0])] as NonNullable<Profile['blend']>;
              b[i] = v / 100;
              return { ...p, blend: b };
            })
          }
        />
      ))}
    </div>
  );
}

function ProfilesPanel({
  output,
  draft,
  dirty,
  L,
  onLoad,
}: {
  output: Output;
  draft: Profile;
  dirty: boolean;
  L: Tr;
  onLoad: (p: Profile) => void;
}) {
  const store = useStore();
  const [name, setName] = useState(draft.name);
  useEffect(() => setName(draft.name), [draft.id, draft.name]);
  return (
    <div className="panel stack">
      <h3 style={{ margin: 0 }}>{L('Calibration profiles', 'Kalibrierprofile')}</h3>
      <select
        value={output.activeProfileId}
        onChange={(e) => {
          if (
            dirty &&
            !window.confirm(
              L(
                'Switch profile and discard unsaved changes?',
                'Profil wechseln und ungespeicherte Änderungen verwerfen?',
              ),
            )
          )
            return;
          void store.send({ t: 'output.activateProfile', outputId: output.id, profileId: e.target.value });
        }}
        aria-label={L('Active profile', 'Aktives Profil')}
      >
        {output.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <label>
        {L('Profile name', 'Profilname')}
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          onBlur={() => name.trim() && name !== draft.name && onLoad({ ...draft, name: name.trim() })}
        />
      </label>
      <div className="row">
        <button
          className="btn small"
          onClick={() =>
            store.send({
              t: 'output.duplicateProfile',
              outputId: output.id,
              profileId: output.activeProfileId,
            })
          }
        >
          {L('Duplicate', 'Duplizieren')}
        </button>
        <button
          className="btn small"
          onClick={() =>
            download(`spectrastage-${output.name}-${draft.name}.json`, {
              format: 'spectrastage-profile',
              profile: draft,
            })
          }
        >
          {L('Export', 'Exportieren')}
        </button>
        <button
          className="btn small"
          onClick={async () => {
            try {
              const data = (await pickJsonFile()) as { profile?: unknown };
              const parsed = ProfileSchema.safeParse(data.profile);
              if (!parsed.success) throw new Error('invalid');
              onLoad({ ...parsed.data, id: draft.id });
              store.toast(L('Profile loaded – check and apply.', 'Profil geladen – prüfen und übernehmen.'));
            } catch {
              store.toast(
                L('This file is not a calibration profile.', 'Diese Datei ist kein Kalibrierprofil.'),
                'error',
              );
            }
          }}
        >
          {L('Import', 'Importieren')}
        </button>
        {output.profiles.length > 1 && (
          <button
            className="btn small danger"
            onClick={() =>
              window.confirm(L('Delete this profile?', 'Dieses Profil löschen?')) &&
              store.send({
                t: 'output.deleteProfile',
                outputId: output.id,
                profileId: output.activeProfileId,
              })
            }
          >
            {L('Delete', 'Löschen')}
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Use profiles for different setups, e.g. “Projector on ladder” or “Rain cover”.',
          'Nutze Profile für verschiedene Aufbauten, z. B. „Beamer auf Leiter“ oder „Mit Regenschutz“.',
        )}
      </p>
    </div>
  );
}
