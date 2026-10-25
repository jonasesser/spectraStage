import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  activeProfile,
  fitViewport,
  polygonBBox,
  stageBounds,
  worldLayout,
  type Output,
  type SessionState,
  type Surface,
  type Viewport,
} from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { useShow, useStore } from './store.ts';
import { kindColor, kindLabel } from './ui.tsx';
import { Room3D } from './Room3D.tsx';

type V = { x: number; y: number };
type Sel = { type: 'surface'; id: string; vertex: number | null } | { type: 'output'; id: string } | null;
type Drag =
  | { kind: 'pan'; start: V; box: Box }
  | { kind: 'surface'; id: string; start: V; orig: V[] }
  | { kind: 'vertex'; id: string; index: number }
  | { kind: 'output'; id: string; start: V; orig: Viewport }
  | { kind: 'resize'; id: string; orig: Viewport; aspect: number };
type Box = { x: number; y: number; w: number; h: number };

function outputAspect(o: Output): number {
  const r = activeProfile(o).referenceResolution;
  return r ? r.w / r.h : 16 / 9;
}

export function StageEditor() {
  const L = useT();
  const store = useStore();
  const { state } = useShow();
  const svgRef = useRef<SVGSVGElement>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [snap, setSnap] = useState(true);
  const [view, setView] = useState<'plan' | '3d'>('plan');
  const [drafts, setDrafts] = useState<{ polys: Record<string, V[]>; vps: Record<string, Viewport> }>({
    polys: {},
    vps: {},
  });
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, V>());
  const pinch = useRef<{ dist: number; box: Box } | null>(null);

  const fitBox = useMemo((): Box => {
    const b = stageBounds(state.surfaces, state.outputs);
    const pad = Math.max(b.w, b.h) * 0.12 + 0.5;
    return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.surfaces.length, state.outputs.length]);
  const [box, setBox] = useState<Box>(fitBox);
  useEffect(() => setBox(fitBox), [fitBox]);

  const polyOf = (s: Surface) => drafts.polys[s.id] ?? s.polygon;
  const vpOf = (o: Output) => drafts.vps[o.id] ?? activeProfile(o).viewport;
  const [svgW, setSvgW] = useState(600);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSvgW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Handle size in stage units ≈ 16 screen pixels, whatever the zoom or screen size.
  const unit = (16 * box.w) / Math.max(200, svgW);
  const sn = (v: number) => (snap ? Math.round(v / 0.05) * 0.05 : Math.round(v * 1000) / 1000);

  const toStage = (e: { clientX: number; clientY: number }): V => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = pt.matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  const begin = (e: RPointerEvent, d: Drag, s: Sel) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = d;
    if (s) setSel(s);
  };

  const onBgDown = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), box };
      drag.current = null;
      return;
    }
    if (e.target === svgRef.current || (e.target as Element).getAttribute('data-bg')) {
      setSel(null);
      drag.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, box };
    }
  };

  const onMove = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      const f = pinch.current.dist / Math.max(10, d);
      const ob = pinch.current.box;
      const w = Math.min(400, Math.max(2, ob.w * f));
      const h = (ob.h / ob.w) * w;
      setBox({ x: ob.x + (ob.w - w) / 2, y: ob.y + (ob.h - h) / 2, w, h });
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      const rect = svgRef.current!.getBoundingClientRect();
      const k = d.box.w / rect.width;
      setBox({
        ...d.box,
        x: d.box.x - (e.clientX - d.start.x) * k,
        y: d.box.y - (e.clientY - d.start.y) * k,
      });
      return;
    }
    const p = toStage(e);
    if (d.kind === 'surface') {
      const dx = sn(p.x - d.start.x);
      const dy = sn(p.y - d.start.y);
      setDrafts((s) => ({
        ...s,
        polys: { ...s.polys, [d.id]: d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) },
      }));
    } else if (d.kind === 'vertex') {
      const surf = state.surfaces.find((s) => s.id === d.id);
      if (!surf) return;
      const cur = [...(drafts.polys[d.id] ?? surf.polygon)];
      cur[d.index] = { x: sn(p.x), y: sn(p.y) };
      setDrafts((s) => ({ ...s, polys: { ...s.polys, [d.id]: cur } }));
    } else if (d.kind === 'output') {
      setDrafts((s) => ({
        ...s,
        vps: {
          ...s.vps,
          [d.id]: { ...d.orig, x: sn(d.orig.x + p.x - d.start.x), y: sn(d.orig.y + p.y - d.start.y) },
        },
      }));
    } else if (d.kind === 'resize') {
      const w = Math.max(0.3, sn(p.x - d.orig.x));
      setDrafts((s) => ({ ...s, vps: { ...s.vps, [d.id]: { ...d.orig, w, h: w / d.aspect } } }));
    }
  };

  const onUp = async (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind === 'pan') return;
    if (d.kind === 'surface' || d.kind === 'vertex') {
      const poly = drafts.polys[d.id];
      if (poly) await store.send({ t: 'surface.update', surfaceId: d.id, polygon: poly });
      setDrafts((s) => {
        const polys = { ...s.polys };
        delete polys[d.id];
        return { ...s, polys };
      });
    } else {
      const vp = drafts.vps[d.id];
      if (vp) await store.send({ t: 'output.setViewport', outputId: d.id, viewport: vp });
      setDrafts((s) => {
        const vps = { ...s.vps };
        delete vps[d.id];
        return { ...s, vps };
      });
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toStage(e);
    const f = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    const w = Math.min(400, Math.max(2, box.w * f));
    const h = (box.h / box.w) * w;
    setBox({ x: p.x - ((p.x - box.x) / box.w) * w, y: p.y - ((p.y - box.y) / box.h) * h, w, h });
  };

  const zoom = (f: number) => {
    const w = Math.min(400, Math.max(2, box.w * f));
    const h = (box.h / box.w) * w;
    setBox({ x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h });
  };

  // Keyboard nudging on desktop
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).tagName === 'INPUT') return;
      const step = e.shiftKey ? 0.25 : 0.05;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[
        e.key
      ];
      if (!d) return;
      e.preventDefault();
      if (sel.type === 'surface') {
        const s = state.surfaces.find((x) => x.id === sel.id);
        if (!s) return;
        const poly = s.polygon.map((p, i) =>
          sel.vertex === null || sel.vertex === i ? { x: p.x + d[0]!, y: p.y + d[1]! } : p,
        );
        void store.send({ t: 'surface.update', surfaceId: s.id, polygon: poly });
      } else {
        const o = state.outputs.find((x) => x.id === sel.id);
        if (!o) return;
        const vp = activeProfile(o).viewport;
        void store.send({
          t: 'output.setViewport',
          outputId: o.id,
          viewport: { ...vp, x: vp.x + d[0]!, y: vp.y + d[1]! },
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sel, state, store]);

  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = [];
    const step = box.w > 60 ? 5 : box.w > 20 ? 1 : 0.5;
    for (let x = Math.floor(box.x / step) * step; x <= box.x + box.w; x += step)
      lines.push({ x1: x, y1: box.y, x2: x, y2: box.y + box.h, major: Math.abs(x % (step * 2)) < 1e-6 });
    for (let y = Math.floor(box.y / step) * step; y <= box.y + box.h; y += step)
      lines.push({ x1: box.x, y1: y, x2: box.x + box.w, y2: y, major: Math.abs(y % (step * 2)) < 1e-6 });
    return lines;
  }, [box]);

  const selSurface = sel?.type === 'surface' ? state.surfaces.find((s) => s.id === sel.id) : undefined;
  const selOutput = sel?.type === 'output' ? state.outputs.find((o) => o.id === sel.id) : undefined;

  return (
    <div className="split">
      <div>
        <div className="row" role="tablist" style={{ marginBottom: '0.5rem' }}>
          <button className={`chip${view === 'plan' ? ' on' : ''}`} onClick={() => setView('plan')}>
            🗺️ {L('Plan (unfolded)', 'Plan (aufgeklappt)')}
          </button>
          <button className={`chip${view === '3d' ? ' on' : ''}`} onClick={() => setView('3d')}>
            🥽 {L('3D room', '3D-Raum')}
          </button>
        </div>
        {view === '3d' && (
          <Room3D
            state={state}
            L={L}
            selected={sel?.type === 'output' ? sel.id : null}
            onSelect={(id) => setSel(id ? { type: 'output', id } : null)}
          />
        )}
        {view === 'plan' && (
          <>
            <div className="editor" style={{ aspectRatio: '4 / 3', maxHeight: '70vh' }}>
              <svg
                ref={svgRef}
                viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
                preserveAspectRatio="xMidYMid meet"
                onPointerDown={onBgDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
                onWheel={onWheel}
              >
                <rect data-bg="1" x={box.x} y={box.y} width={box.w} height={box.h} fill="#07060f" />
                {gridLines.map((l, i) => (
                  <line
                    key={i}
                    {...l}
                    stroke={l.major ? '#2a2550' : '#1a1735'}
                    strokeWidth={unit * 0.08}
                    pointerEvents="none"
                  />
                ))}
                {state.surfaces.map((s) => {
                  const poly = polyOf(s);
                  const b = polygonBBox(poly);
                  const isSel = selSurface?.id === s.id;
                  return (
                    <g key={s.id}>
                      <polygon
                        points={poly.map((p) => `${p.x},${p.y}`).join(' ')}
                        fill={kindColor(s.kind)}
                        fillOpacity={isSel ? 0.35 : 0.18}
                        stroke={kindColor(s.kind)}
                        strokeWidth={unit * (isSel ? 0.35 : 0.18)}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) =>
                          begin(
                            e,
                            { kind: 'surface', id: s.id, start: toStage(e), orig: poly },
                            { type: 'surface', id: s.id, vertex: null },
                          )
                        }
                      />
                      <text
                        x={b.x + b.w / 2}
                        y={b.y + b.h / 2}
                        fontSize={unit * 1.6}
                        textAnchor="middle"
                        fill="#f3efe6"
                        pointerEvents="none"
                        fontWeight={700}
                      >
                        {s.name}
                      </text>
                      <text
                        x={b.x + b.w / 2}
                        y={b.y + b.h / 2 + unit * 1.8}
                        fontSize={unit * 1.1}
                        textAnchor="middle"
                        fill="#a9a3c9"
                        pointerEvents="none"
                      >
                        {b.w.toFixed(2)} × {b.h.toFixed(2)} m
                      </text>
                      {isSel &&
                        poly.map((p, i) => {
                          const n = poly[(i + 1) % poly.length]!;
                          return (
                            <g key={i}>
                              <circle
                                className="handle"
                                cx={(p.x + n.x) / 2}
                                cy={(p.y + n.y) / 2}
                                r={unit * 0.55}
                                fill="#14112b"
                                stroke="#ffb347"
                                strokeWidth={unit * 0.12}
                                strokeDasharray={`${unit * 0.3} ${unit * 0.2}`}
                                onPointerDown={(e) => {
                                  const next = [
                                    ...poly.slice(0, i + 1),
                                    { x: (p.x + n.x) / 2, y: (p.y + n.y) / 2 },
                                    ...poly.slice(i + 1),
                                  ];
                                  setDrafts((d) => ({ ...d, polys: { ...d.polys, [s.id]: next } }));
                                  begin(
                                    e,
                                    { kind: 'vertex', id: s.id, index: i + 1 },
                                    { type: 'surface', id: s.id, vertex: i + 1 },
                                  );
                                }}
                              />
                              <circle
                                className="handle"
                                cx={p.x}
                                cy={p.y}
                                r={unit * (sel?.type === 'surface' && sel.vertex === i ? 1.1 : 0.85)}
                                fill="#ffb347"
                                stroke="#2a1600"
                                strokeWidth={unit * 0.15}
                                onPointerDown={(e) =>
                                  begin(
                                    e,
                                    { kind: 'vertex', id: s.id, index: i },
                                    { type: 'surface', id: s.id, vertex: i },
                                  )
                                }
                              />
                            </g>
                          );
                        })}
                    </g>
                  );
                })}
                {state.outputs
                  .filter((o) => !activeProfile(o).pose)
                  .map((o) => {
                    const vp = vpOf(o);
                    const isSel = selOutput?.id === o.id;
                    return (
                      <g key={o.id}>
                        <rect
                          x={vp.x}
                          y={vp.y}
                          width={vp.w}
                          height={vp.h}
                          fill={isSel ? 'rgba(255,255,255,0.06)' : 'transparent'}
                          stroke={isSel ? '#ffffff' : 'rgba(255,255,255,0.6)'}
                          strokeWidth={unit * (isSel ? 0.25 : 0.15)}
                          strokeDasharray={`${unit * 0.8} ${unit * 0.5}`}
                          style={{ cursor: 'move' }}
                          onPointerDown={(e) =>
                            begin(
                              e,
                              { kind: 'output', id: o.id, start: toStage(e), orig: vp },
                              { type: 'output', id: o.id },
                            )
                          }
                        />
                        <text
                          x={vp.x + unit * 0.6}
                          y={vp.y + unit * 1.6}
                          fontSize={unit * 1.2}
                          fill="#ffffff"
                          pointerEvents="none"
                        >
                          📽 {o.name}
                        </text>
                        {isSel && (
                          <rect
                            className="handle"
                            x={vp.x + vp.w - unit}
                            y={vp.y + vp.h - unit}
                            width={unit * 2}
                            height={unit * 2}
                            fill="#fff"
                            stroke="#14112b"
                            strokeWidth={unit * 0.15}
                            onPointerDown={(e) =>
                              begin(e, { kind: 'resize', id: o.id, orig: vp, aspect: outputAspect(o) }, null)
                            }
                          />
                        )}
                      </g>
                    );
                  })}
              </svg>
            </div>
            <div className="editor-tools">
              <button className="btn small" onClick={() => zoom(1 / 1.3)} aria-label="Zoom in">
                ＋
              </button>
              <button className="btn small" onClick={() => zoom(1.3)} aria-label="Zoom out">
                －
              </button>
              <button className="btn small" onClick={() => setBox(fitBox)}>
                {L('Fit', 'Einpassen')}
              </button>
              <label className="check" style={{ minHeight: 36 }}>
                <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />{' '}
                {L('Snap 5 cm', '5-cm-Raster')}
              </label>
            </div>
            <p className="muted small">
              {L(
                'Lay out your house unfolded: walls side by side, the driveway below the garage. Dashed frames are the projector images – drag the white corner to make an image bigger or smaller.',
                'Lege dein Haus „aufgeklappt“ an: Wände nebeneinander, die Einfahrt unter dem Garagentor. Gestrichelte Rahmen sind die Beamer-Bilder – mit der weißen Ecke machst du ein Bild größer oder kleiner.',
              )}
            </p>
          </>
        )}
      </div>
      <div className="stack">
        <RoomPanel state={state} L={L} />
        <details className="panel">
          <summary className="small">
            {L('Special cases: add own surfaces', 'Sonderfälle: eigene Flächen anlegen')}
          </summary>
          <AddSurface L={L} />
        </details>
        {selSurface && (
          <SurfacePanel
            key={selSurface.id}
            surface={selSurface}
            vertex={sel?.type === 'surface' ? sel.vertex : null}
            state={state}
            L={L}
            onDeleted={() => setSel(null)}
          />
        )}
        {selOutput && !activeProfile(selOutput).pose && (
          <OutputPlacement key={selOutput.id} output={selOutput} state={state} L={L} />
        )}
        {!sel && (
          <div className="panel">
            <p className="muted" style={{ margin: 0 }}>
              {L(
                'Tap a surface or a projector frame to edit it.',
                'Tippe eine Fläche oder einen Beamer-Rahmen an, um sie zu bearbeiten.',
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function roleLabel(r: 'main' | 'side' | 'ground' | 'ceiling', L: Tr): string {
  return {
    main: L('Main wall – centerpiece, e.g. the house', 'Hauptwand – Mittelpunkt, z. B. das Haus'),
    side: L('Side wall – the world continues', 'Seitenwand – die Welt geht weiter'),
    ground: L('Ground', 'Boden'),
    ceiling: L('Ceiling – night sky', 'Decke – Nachthimmel'),
  }[r];
}

/** Room mode: walls all the way around – the world wraps from the last wall to the first. */
function RoomPanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const lay = worldLayout(state.surfaces);
  const mainId = lay.find((x) => x.role === 'main')?.id;
  const extra = state.surfaces.filter((x) => x.id !== mainId);
  // an earlier measurement may have changed the width of the front wall: back to the width it was
  // planned with (the frame of the front projector)
  const main = state.surfaces.find((x) => x.id === mainId);
  const mainBox = main ? polygonBBox(main.polygon) : null;
  const plannedW = state.outputs
    .map((o) => activeProfile(o))
    .find((pr) => pr.walls?.length === 1 && pr.walls[0] === 'vorne')?.viewport.w;
  const widthOff = !!(mainBox && plannedW && Math.abs(mainBox.w - plannedW) / plannedW > 0.05);
  const restoreWidth = async () => {
    if (!main || !mainBox || !plannedW) return;
    const k = plannedW / mainBox.w;
    const x0 = mainBox.x;
    const scale = (pts: { x: number; y: number }[]) => pts.map((p) => ({ x: x0 + (p.x - x0) * k, y: p.y }));
    await store.send({ t: 'surface.update', surfaceId: main.id, polygon: scale(main.polygon) });
    // floors / ceilings along the front wall follow
    for (const sf of state.surfaces) {
      const role = lay.find((x) => x.id === sf.id)?.role;
      if (role !== 'ground' && role !== 'ceiling') continue;
      const bb = polygonBBox(sf.polygon);
      if (bb.x + bb.w <= mainBox.x || bb.x >= mainBox.x + mainBox.w) continue;
      await store.send({ t: 'surface.update', surfaceId: sf.id, polygon: scale(sf.polygon) });
    }
  };
  const reset = async () => {
    if (
      !window.confirm(
        L(
          `Keep only the main wall and remove ${extra.length} other surface(s)? The app adds the other 5 sides itself.`,
          `Nur die Hauptwand behalten und ${extra.length} weitere Fläche(n) entfernen? Die anderen 5 Seiten ergänzt die App selbst.`,
        ),
      )
    )
      return;
    for (const x of extra) await store.send({ t: 'surface.delete', surfaceId: x.id });
  };
  return (
    <div className="panel stack">
      <strong>{L('The room: 6 fixed sides', 'Der Raum: 6 feste Seiten')}</strong>
      <ol className="small" style={{ margin: 0, paddingLeft: '1.2rem' }}>
        <li>
          {L(
            'Front, right, back, left, floor and ceiling are always there – nothing to add or measure.',
            'Vorne, Rechts, Hinten, Links, Boden und Decke sind immer da – nichts anlegen, nichts ausmessen.',
          )}
        </li>
        <li>
          {L(
            'Projectors tab: choose for each projector which sides it lights.',
            'Reiter „Beamer“: pro Beamer wählen, welche Seiten er bestrahlt.',
          )}
        </li>
        <li>
          {L(
            '“Calibrate”: move the crosses onto the real corners of the chosen sides, step by step – each side sits exactly on its corners.',
            '„Kalibrieren“: Schritt für Schritt die Kreuze auf die echten Ecken der gewählten Seiten schieben – jede Seite sitzt genau auf ihren Ecken.',
          )}
        </li>
      </ol>
      {widthOff && (
        <button className="btn small" onClick={() => void restoreWidth()}>
          ↔ {L('Restore the width of the front wall', 'Breite der Vorderwand wiederherstellen')} (
          {mainBox!.w.toFixed(1)} → {plannedW!.toFixed(1)} m)
        </button>
      )}
      {extra.length > 0 && (
        <button className="btn small" onClick={() => void reset()}>
          🧹 {L('Reset to the 6 fixed sides', 'Auf die 6 festen Seiten zurücksetzen')} ({extra.length}{' '}
          {L('extra surfaces', 'zusätzliche Flächen')})
        </button>
      )}
    </div>
  );
}

function AddSurface({ L }: { L: Tr }) {
  const store = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'wall' | 'floor' | 'other'>('wall');
  return (
    <div className="panel">
      <h3>{L('Add surface', 'Fläche hinzufügen')}</h3>
      <div className="stack">
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 60))}
          placeholder={L('e.g. House wall', 'z. B. Hauswand')}
          aria-label={L('Name', 'Name')}
        />
        <div className="row">
          {(['wall', 'floor', 'other'] as const).map((k) => (
            <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
              <span className="dot" style={{ background: kindColor(k) }} />
              {kindLabel(k, L)}
            </button>
          ))}
        </div>
        <button
          className="btn primary"
          onClick={async () => {
            if (await store.send({ t: 'surface.create', name: name.trim() || kindLabel(kind, L), kind }))
              setName('');
          }}
        >
          {L('Add', 'Hinzufügen')}
        </button>
      </div>
    </div>
  );
}

function SurfacePanel({
  surface,
  vertex,
  state,
  L,
  onDeleted,
}: {
  surface: Surface;
  vertex: number | null;
  state: SessionState;
  L: Tr;
  onDeleted: () => void;
}) {
  const store = useStore();
  const b = polygonBBox(surface.polygon);
  const [name, setName] = useState(surface.name);
  const [w, setW] = useState(b.w.toFixed(2));
  const [h, setH] = useState(b.h.toFixed(2));
  useEffect(() => {
    setW(b.w.toFixed(2));
    setH(b.h.toFixed(2));
  }, [b.w, b.h]);
  const applySize = () => {
    const nw = Number(w);
    const nh = Number(h);
    if (!(nw > 0.1 && nh > 0.1)) return;
    const poly = surface.polygon.map((p) => ({
      x: b.x + ((p.x - b.x) / b.w) * nw,
      y: b.y + ((p.y - b.y) / b.h) * nh,
    }));
    void store.send({ t: 'surface.update', surfaceId: surface.id, polygon: poly });
  };
  return (
    <div className="panel">
      <h3>{L('Surface', 'Fläche')}</h3>
      <div className="stack">
        <label>
          {L('Name', 'Name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            onBlur={() =>
              name.trim() &&
              name !== surface.name &&
              store.send({ t: 'surface.update', surfaceId: surface.id, name: name.trim() })
            }
          />
        </label>
        <div className="row">
          {(['wall', 'floor', 'other'] as const).map((k) => (
            <button
              key={k}
              className={`chip${surface.kind === k ? ' on' : ''}`}
              onClick={() => store.send({ t: 'surface.update', surfaceId: surface.id, kind: k })}
            >
              <span className="dot" style={{ background: kindColor(k) }} />
              {kindLabel(k, L)}
            </button>
          ))}
        </div>
        <label>
          {L('Part of the world', 'Teil der Welt')}
          <select
            value={surface.role ?? 'auto'}
            onChange={(e) =>
              store.send({
                t: 'surface.update',
                surfaceId: surface.id,
                role: e.target.value as NonNullable<Surface['role']>,
              })
            }
          >
            <option value="auto">
              {L('Automatic', 'Automatisch')} (
              {roleLabel(worldLayout(state.surfaces).find((x) => x.id === surface.id)?.role ?? 'side', L)})
            </option>
            {(['main', 'side', 'ground', 'ceiling'] as const).map((r) => (
              <option key={r} value={r}>
                {roleLabel(r, L)}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="grow">
            {L('Width (m)', 'Breite (m)')}
            <input
              type="number"
              step="0.05"
              min="0.1"
              value={w}
              onChange={(e) => setW(e.target.value)}
              onBlur={applySize}
            />
          </label>
          <label className="grow">
            {L('Height (m)', 'Höhe (m)')}
            <input
              type="number"
              step="0.05"
              min="0.1"
              value={h}
              onChange={(e) => setH(e.target.value)}
              onBlur={applySize}
            />
          </label>
        </div>
        <p className="muted small">
          {L(
            'Drag the dashed dots to add corners for irregular shapes.',
            'Ziehe an den gestrichelten Punkten, um Ecken für unregelmäßige Formen hinzuzufügen.',
          )}
        </p>
        <div className="row">
          {vertex !== null && surface.polygon.length > 3 && (
            <button
              className="btn small"
              onClick={() =>
                store.send({
                  t: 'surface.update',
                  surfaceId: surface.id,
                  polygon: surface.polygon.filter((_, i) => i !== vertex),
                })
              }
            >
              {L('Remove corner', 'Ecke entfernen')}
            </button>
          )}
          <button
            className="btn small danger"
            onClick={async () => {
              if (
                window.confirm(L(`Delete surface “${surface.name}”?`, `Fläche „${surface.name}“ löschen?`))
              ) {
                if (await store.send({ t: 'surface.delete', surfaceId: surface.id })) onDeleted();
              }
            }}
          >
            {L('Delete surface', 'Fläche löschen')}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutputPlacement({ output, state, L }: { output: Output; state: SessionState; L: Tr }) {
  const store = useStore();
  const vp = activeProfile(output).viewport;
  const [fitTo, setFitTo] = useState('');
  const overlaps = state.outputs
    .filter((o) => o.id !== output.id)
    .map((o) => {
      const b = activeProfile(o).viewport;
      const w = Math.min(vp.x + vp.w, b.x + b.w) - Math.max(vp.x, b.x);
      const h = Math.min(vp.y + vp.h, b.y + b.h) - Math.max(vp.y, b.y);
      return { o, w, h };
    })
    .filter((x) => x.w > 0.02 && x.h > 0.02);
  return (
    <div className="panel">
      <h3>📽 {output.name}</h3>
      <dl className="kv">
        <dt>{L('Position', 'Position')}</dt>
        <dd>
          {vp.x.toFixed(2)} / {vp.y.toFixed(2)} m
        </dd>
        <dt>{L('Image size', 'Bildgröße')}</dt>
        <dd>
          {vp.w.toFixed(2)} × {vp.h.toFixed(2)} m
        </dd>
      </dl>
      {overlaps.length > 0 && (
        <p className="safety-note" style={{ marginTop: '0.75rem' }}>
          {overlaps.map(({ o, w, h }) => (
            <span key={o.id} style={{ display: 'block' }}>
              {L('Overlaps', 'Überlappt mit')} 📽 {o.name}: {w.toFixed(2)} × {h.toFixed(2)} m (
              {Math.round((Math.min(w, vp.w) / vp.w) * 100)} % {L('of the width', 'der Breite')})
            </span>
          ))}
          {L(
            'Use “Blend with neighbouring projector” in its calibration, or a mask, so the overlap is not twice as bright.',
            'Nutze „Überblenden zum Nachbar-Beamer“ in der Kalibrierung oder eine Maske, damit die Überlappung nicht doppelt hell ist.',
          )}
        </p>
      )}
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <label>
          {L('Fit image to', 'Bild einpassen auf')}
          <select value={fitTo} onChange={(e) => setFitTo(e.target.value)}>
            <option value="">{L('Choose…', 'Auswählen…')}</option>
            <option value="*">{L('All surfaces', 'Alle Flächen')}</option>
            {state.surfaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn"
          disabled={!fitTo}
          onClick={() => {
            const polys = fitTo === '*' ? state.surfaces : state.surfaces.filter((s) => s.id === fitTo);
            if (polys.length === 0) return;
            const b = stageBounds(polys);
            void store.send({
              t: 'output.setViewport',
              outputId: output.id,
              viewport: fitViewport(b, outputAspect(output), 0.03),
            });
          }}
        >
          {L('Fit', 'Einpassen')}
        </button>
        <p className="muted small">
          {L(
            'The frame shows which part of the stage this projector covers. Fine alignment on the real wall happens in Projectors → Calibrate.',
            'Der Rahmen zeigt, welchen Teil der Bühne dieser Beamer abdeckt. Die Feinjustage an der echten Wand machst du unter Beamer → Kalibrieren.',
          )}
        </p>
      </div>
    </div>
  );
}
