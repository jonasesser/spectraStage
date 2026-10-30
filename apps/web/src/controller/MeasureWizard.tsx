import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeProfile,
  anchorWalls,
  cornerWalls,
  findOutliers,
  projectPose,
  roomCorners,
  roomEdges,
  roomFold,
  wallsOfPose,
  type Anchor,
  type Output,
  type Pose,
  type SessionState,
  type V3,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { WallPicker } from './WallPicker.tsx';
import { ProportionSliders } from './ProportionSliders.tsx';
import { PlacePanel } from './PlacePanel.tsx';

interface Target {
  id: string;
  kind: 'corner' | 'edge';
  title: string;
  /** What exactly to hit, in words. */
  hint: string;
  /** Box corner keys for the sketch (1 = corner, 2 = edge). */
  keys: string[];
  p: V3;
  q?: V3;
  /** Where the marker starts (predicted picture position, kept inside the picture). */
  u: number;
  v: number;
}

const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

const SIDE: Record<string, [string, string]> = {
  vorne: ['the front wall', 'die vordere Wand'],
  hinten: ['the back wall', 'die hintere Wand'],
  links: ['the left wall', 'die linke Wand'],
  rechts: ['the right wall', 'die rechte Wand'],
  boden: ['the floor', 'der Boden'],
  decke: ['the ceiling', 'die Decke'],
};
const side = (L: Tr, w: string) => L(...(SIDE[w] ?? [w, w]));

/**
 * Everything of the room this projector could be measured against – all corners and edges, also
 * those the app does not expect in the picture yet (its guess of the room can be wrong; a corner
 * the projector really reaches is what tells the app the true size).
 */
function targetsFor(state: SessionState, pose: Pose, aspect: number, L: Tr): Target[] {
  const fold = roomFold(state.surfaces);
  const clamp = (k: number) => Math.min(0.96, Math.max(0.04, k));
  const start = (P: V3) => {
    const q = projectPose(pose, aspect, P);
    // behind the projector: start in the middle; otherwise at the picture edge in its direction
    return q ? { u: clamp((q[0] + 1) / 2), v: clamp((1 - q[1]) / 2) } : { u: 0.5, v: 0.5 };
  };
  const out: Target[] = [];
  for (const c of roomCorners(fold)) {
    const walls = cornerWalls(c.id);
    const words = c.id.split('-');
    out.push({
      id: `c|${c.id}`,
      kind: 'corner',
      title:
        walls.length === 3
          ? `${L('Corner', 'Ecke')} ${words.join(' ')}`
          : `${L('Corner', 'Ecke')} ${c.n}: ${c.label}`,
      hint:
        walls.length === 3
          ? L(
              `Where ${side(L, walls[0]!)}, ${side(L, walls[1]!)} and ${side(L, walls[2]!)} meet.`,
              `Wo ${side(L, walls[0]!)}, ${side(L, walls[1]!)} und ${side(L, walls[2]!)} zusammenstoßen.`,
            )
          : '',
      keys: [c.id],
      p: c.p,
      ...start(c.p),
    });
  }
  for (const e of roomEdges(fold)) {
    const [ka, kb] = e.id.split('|');
    const both = anchorWalls(`e|${e.id}|A`);
    const vertical = both.every((w) => w !== 'boden' && w !== 'decke');
    for (const [k, t] of [
      ['1', 0.3],
      ['2', 0.7],
    ] as const) {
      const P = lerp(e.a, e.b, t);
      out.push({
        id: `e|${e.id}|${k === '1' ? 'A' : 'B'}`,
        kind: 'edge',
        title: `${L('Edge', 'Kante')} ${both.map((w) => side(L, w)).join(' / ')} · ${L('point', 'Punkt')} ${k}`,
        hint:
          both.length === 2
            ? L(
                `The ${vertical ? 'vertical' : 'horizontal'} line where ${side(L, both[0]!)} and ${side(L, both[1]!)} meet – put the cross anywhere exactly on it.`,
                `Die ${vertical ? 'senkrechte' : 'waagerechte'} Linie, an der ${side(L, both[0]!)} und ${side(L, both[1]!)} zusammenstoßen – das Kreuz irgendwo genau darauf setzen.`,
              )
            : '',
        keys: [ka!, kb!],
        p: e.a,
        q: e.b,
        ...start(P),
      });
    }
  }
  return out;
}

interface SketchItem {
  id: string;
  keys: string[];
  state: 'done' | 'todo' | 'skipped';
}

/**
 * The room seen from inside towards the front wall – and the place to measure: every corner of the
 * chosen sides is a point. Touch a point and drag: the cross on the wall moves along (the point
 * here springs back when let go – what counts is the cross on the wall).
 */
function RoomSketch({
  items,
  selected,
  onPick,
  onDrag,
  L,
}: {
  items: SketchItem[];
  selected: string | null;
  onPick: (id: string) => void;
  /** Finger movement in screen pixels since the touch began; final on release. */
  onDrag: (dx: number, dy: number, final: boolean, width: number) => void;
  L: Tr;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; id: string } | null>(null);
  const [off, setOff] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const pos = (k: string): [number, number] | null => {
    const [z, x, y] = k.split('-');
    if (!z || !x || !y) return null;
    const front = z === 'vorne';
    const left = x === 'links';
    const top = y === 'oben';
    return front ? [left ? 70 : 150, top ? 42 : 98] : [left ? 14 : 206, top ? 10 : 130];
  };
  const at = (it: SketchItem): [number, number] | null => {
    const ps = it.keys.map(pos);
    if (ps.some((p) => !p)) return null;
    if (ps.length === 1) return ps[0]!;
    return [(ps[0]![0] + ps[1]![0]) / 2, (ps[0]![1] + ps[1]![1]) / 2];
  };
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * 220,
      y: ((e.clientY - r.top) / r.height) * 140,
      w: r.width,
    };
  };
  const c = '#3ff2ff';
  const o = '#ffb347';
  const sel = items.find((i) => i.id === selected);
  const selPts = sel ? sel.keys.map(pos) : [];
  return (
    <svg
      ref={svgRef}
      viewBox="0 0 220 140"
      style={{ width: '100%', maxWidth: 420, display: 'block', margin: '0 auto', touchAction: 'none' }}
      role="img"
      aria-label={L(
        'Sketch of the room – touch a point and drag',
        'Skizze des Raums – Punkt antippen und ziehen',
      )}
      onPointerDown={(e) => {
        const p = toSvg(e);
        // the nearest point (generous, for fingers); else keep moving the selected one
        let best: SketchItem | null = null;
        let bd = 26;
        for (const it of items) {
          const q = at(it);
          if (!q) continue;
          const d = Math.hypot(q[0] - p.x, q[1] - p.y);
          if (d < bd) {
            bd = d;
            best = it;
          }
        }
        const id = best?.id ?? selected;
        if (!id) return;
        if (id !== selected) onPick(id);
        (e.target as Element).setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, id };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const w = svgRef.current!.getBoundingClientRect().width;
        const k = 220 / w;
        setOff({ id: d.id, dx: (e.clientX - d.x) * k, dy: (e.clientY - d.y) * k });
        onDrag(e.clientX - d.x, e.clientY - d.y, false, w);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        setOff(null);
        if (!d) return;
        onDrag(e.clientX - d.x, e.clientY - d.y, true, svgRef.current!.getBoundingClientRect().width);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setOff(null);
      }}
    >
      <rect x="0" y="0" width="220" height="140" rx="8" fill="#0b0918" />
      <g stroke={c} strokeWidth="1.5" fill="none" opacity="0.5">
        <rect x="70" y="42" width="80" height="56" />
        <line x1="14" y1="10" x2="70" y2="42" />
        <line x1="206" y1="10" x2="150" y2="42" />
        <line x1="14" y1="130" x2="70" y2="98" />
        <line x1="206" y1="130" x2="150" y2="98" />
      </g>
      <g fill="#9d93d9" fontSize="9" textAnchor="middle" fontFamily="system-ui, sans-serif">
        <text x="110" y="74">
          {L('front', 'vorne')}
        </text>
        <text x="36" y="74">
          {L('left', 'links')}
        </text>
        <text x="184" y="74">
          {L('right', 'rechts')}
        </text>
        <text x="110" y="122">
          {L('floor', 'Boden')}
        </text>
        <text x="110" y="24">
          {L('ceiling', 'Decke')}
        </text>
      </g>
      {selPts.length === 2 && selPts.every(Boolean) && (
        <line
          x1={selPts[0]![0]}
          y1={selPts[0]![1]}
          x2={selPts[1]![0]}
          y2={selPts[1]![1]}
          stroke={o}
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.7"
        />
      )}
      {items.map((it) => {
        const q = at(it);
        if (!q) return null;
        const isSel = it.id === selected;
        const dx = off && off.id === it.id ? off.dx : 0;
        const dy = off && off.id === it.id ? off.dy : 0;
        return (
          <g
            key={it.id}
            style={{ transition: off?.id === it.id ? 'none' : 'transform 0.25s ease-out' }}
            transform={`translate(${dx} ${dy})`}
          >
            {isSel && <circle cx={q[0]} cy={q[1]} r="13" fill="none" stroke={o} strokeWidth="2" />}
            <circle
              cx={q[0]}
              cy={q[1]}
              r={isSel ? 8 : 6}
              fill={
                isSel ? o : it.state === 'done' ? '#7dff8a' : it.state === 'skipped' ? '#5a5675' : '#c9c3ff'
              }
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Guided measuring of a projector against the real room – the red thread: one step after the
 * other, the projector highlights what to hit (a corner or a room edge) and an orange cross;
 * move the cross from the phone onto the real thing, “fits – next”. After enough points the app
 * knows where the projector stands; the glowing room lines then lie on the real ones.
 */
export function MeasureWizard({
  output,
  state,
  L,
  onDone,
}: {
  output: Output;
  state: SessionState;
  L: Tr;
  onDone: () => void;
}) {
  const store = useStore();
  const profile = activeProfile(output);
  const pose = profile.pose ?? null;
  const ref = profile.referenceResolution;
  const aspect = ref ? ref.w / ref.h : 16 / 9;
  const [draft, setDraft] = useState<Anchor[] | null>(null);
  const anchors = draft ?? profile.anchors ?? [];
  // corners measured before (e.g. the front wall, when the left wall is added) count as done
  const [history, setHistory] = useState<string[]>(() => (profile.anchors ?? []).map((a) => a.c));
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [fine, setFine] = useState(false);
  // measuring the room – or placing door, lamps, pumpkins and dark areas with a free cross
  const [tab, setTab] = useState<'measure' | 'place'>('measure');
  const dragBase = useRef<{ id: string; u: number; v: number } | null>(null);
  const timer = useRef(0);
  const pending = useRef<Anchor[] | null>(null);

  /** drag: throttled, fast pose refine · now: immediately, fast · full: immediately, full solve. */
  const send = (list: Anchor[], how: 'drag' | 'now' | 'full') => {
    const final = how !== 'drag';
    setDraft(list);
    pending.current = list;
    const flush = () => {
      timer.current = 0;
      const l = pending.current;
      if (!l) return;
      pending.current = null;
      void store
        .send({ t: 'output.setAnchors', outputId: output.id, anchors: l, quick: how !== 'full' })
        .finally(() => {
          if (!pending.current) setDraft(null);
        });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 90);
  };

  const walls = profile.walls ?? (pose ? wallsOfPose(roomFold(state.surfaces), pose, aspect) : []);
  const wallsKey = walls.join(',');
  const firstWalls = useRef(wallsKey);
  useEffect(() => {
    if (firstWalls.current === wallsKey) return;
    firstWalls.current = wallsKey;
    // other sides chosen: the corners still measured stay done, the new ones come next
    setHistory((profile.anchors ?? []).map((a) => a.c));
    setSkipped(new Set());
    setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallsKey]);
  // only the corners of the sides this projector lights; a point on an edge only stands in for
  // a corner that could not be reached (skipped) – one per edge running into that corner
  const targets = (pose ? targetsFor(state, pose, aspect, L) : []).filter((t) => {
    if (walls.length && !anchorWalls(t.id).some((w) => walls.includes(w))) return false;
    if (t.kind === 'corner') return true;
    if (!t.id.endsWith('|A')) return false;
    return t.keys.some((k) => skipped.has(`c|${k}`));
  });
  const current = targets.find((t) => !history.includes(t.id) && !skipped.has(t.id)) ?? null;
  const [active, setActive] = useState<string | null>(null);
  const target = targets.find((t) => t.id === active) ?? current;
  const anchor = target ? anchors.find((a) => a.c === target.id) : undefined;

  // the projector shows edges, corners and the cross of the active step
  useEffect(() => {
    if (tab !== 'measure') return;
    void store.send({
      t: 'output.align',
      outputId: output.id,
      on: true,
      sel: target?.id ?? null,
      mark: null,
    });
  }, [output.id, target?.id, store, tab]);
  useEffect(
    () => () => void store.send({ t: 'output.align', outputId: output.id, on: false, sel: null }),
    [output.id, store],
  );
  // a new step starts with its cross where the app expects the corner / edge
  useEffect(() => {
    if (!target || anchors.some((a) => a.c === target.id)) return;
    send(
      [
        ...anchors,
        { c: target.id, p: target.p, ...(target.q ? { q: target.q } : {}), u: target.u, v: target.v },
      ],
      'now',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  // points that do not fit the others (hidden corner set on furniture …) – checked when idle
  const outlierKey = draft ? null : JSON.stringify([pose, profile.anchors ?? []]);
  const outliers = useMemo(
    () => (outlierKey && pose ? findOutliers(pose, aspect, profile.anchors ?? []) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outlierKey],
  );

  if (!pose)
    return (
      <p className="muted">
        {L(
          'Put this projector into the 3D room first (Stage → 3D room).',
          'Stelle diesen Beamer zuerst in den 3D-Raum (Bühne → 3D-Raum).',
        )}
      </p>
    );

  const move = (u: number, v: number, how: 'drag' | 'now' | 'full', t: Target | null = target) => {
    if (!t) return;
    const c = (x: number) => Math.min(1.2, Math.max(-0.2, x));
    const has = anchors.some((a) => a.c === t.id);
    send(
      has
        ? anchors.map((a) => (a.c === t.id ? { ...a, u: c(u), v: c(v) } : a))
        : [...anchors, { c: t.id, p: t.p, ...(t.q ? { q: t.q } : {}), u: c(u), v: c(v) }],
      how,
    );
  };
  const nudge = (dx: number, dy: number) => {
    if (!anchor) return;
    const k = fine ? 0.0006 : 0.004;
    move(anchor.u + sx * dx * k, anchor.v + sy * dy * k * aspect, 'drag');
  };
  // the cross lives in the projector's own picture; a turned or mirrored mount turns the
  // directions on the wall – keep "drag right = cross goes right on the wall"
  const turned = profile.rotation === 180;
  const sx = turned !== profile.flipX ? -1 : 1;
  const sy = turned !== profile.flipY ? -1 : 1;
  const next = () => {
    if (!target) return;
    send(anchors, 'full');
    setHistory((h) => [...h.filter((x) => x !== target.id), target.id]);
    setActive(null);
  };
  const skip = () => {
    if (!target) return;
    send(
      anchors.filter((a) => a.c !== target.id),
      'full',
    );
    setSkipped((s) => new Set(s).add(target.id));
    setActive(null);
  };
  const back = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setActive(prev);
  };
  const restart = () => {
    if (
      !window.confirm(
        L('Measure this projector again from scratch?', 'Diesen Beamer komplett neu einmessen?'),
      )
    )
      return;
    // back to the start: points, computed position and 2D corrections are dropped
    setDraft(null);
    void store.send({
      t: 'output.setWalls',
      outputId: output.id,
      walls: walls.length ? (walls as never) : ['vorne'],
      reset: true,
    });
    setHistory([]);
    setSkipped(new Set());
    setActive(null);
    setHistory([]);
    setSkipped(new Set());
    setActive(null);
  };

  // the sketch: all points of the chosen sides; touch one to (re)measure it, drag to move it
  const items: SketchItem[] = targets.map((t) => ({
    id: t.id,
    keys: t.keys,
    state: skipped.has(t.id) ? 'skipped' : history.includes(t.id) ? 'done' : 'todo',
  }));
  const pick = (id: string) => {
    setSkipped((sk) => {
      if (!sk.has(id)) return sk;
      const n = new Set(sk);
      n.delete(id);
      return n;
    });
    setActive(id);
  };
  const sketch = (
    <RoomSketch
      items={items}
      selected={target?.id ?? null}
      onPick={pick}
      onDrag={(dx, dy, final, width) => {
        const t = target;
        if (!t) return;
        const a = anchors.find((x) => x.c === t.id);
        if (!dragBase.current || dragBase.current.id !== t.id)
          dragBase.current = { id: t.id, u: a?.u ?? t.u, v: a?.v ?? t.v };
        const k = (fine ? 0.06 : 0.35) / (width || 300);
        const b0 = dragBase.current;
        move(b0.u + sx * dx * k, b0.v + sy * dy * k * aspect, final ? 'full' : 'drag', t);
        if (final) dragBase.current = null;
      }}
      L={L}
    />
  );
  const doneSteps = history.length + skipped.size;
  const total = doneSteps + targets.filter((t) => !history.includes(t.id) && !skipped.has(t.id)).length;

  const tabs = (
    <div className="row" role="tablist">
      <button className={`chip${tab === 'measure' ? ' on' : ''}`} onClick={() => setTab('measure')}>
        📐 {L('Measure', 'Einmessen')}
      </button>
      <button className={`chip${tab === 'place' ? ' on' : ''}`} onClick={() => setTab('place')}>
        🎯 {L('Place things', 'Platzieren')}
      </button>
    </div>
  );
  if (tab === 'place')
    return (
      <div className="panel stack">
        {tabs}
        <PlacePanel output={output} state={state} L={L} />
        <div className="row">
          <button className="btn small primary" onClick={onDone}>
            ✓ {L('Done', 'Fertig')}
          </button>
        </div>
      </div>
    );

  return (
    <div className="panel stack">
      {tabs}
      <strong>📐 {L('Measure projector', 'Beamer einmessen')}</strong>
      <WallPicker output={output} state={state} L={L} />
      {target ? (
        <>
          <div className="muted small">
            {history.includes(target.id)
              ? L('Correct a corner', 'Ecke korrigieren')
              : `${L('Step', 'Schritt')} ${Math.min(total, doneSteps + 1)} ${L('of', 'von')} ${total}`}
          </div>
          <div style={{ fontWeight: 700 }}>{target.title}</div>
          {target.hint && <div className="small">{target.hint}</div>}
          <p className="small" style={{ margin: 0 }}>
            {target.kind === 'corner'
              ? L(
                  'Look at the wall and drag the point below: the orange cross moves on the wall – put it exactly onto this corner. Not reachable: “not visible – skip”. Tap another point to correct it.',
                  'Schau an die Wand und zieh unten am Punkt: Das orange Kreuz bewegt sich an der Wand – genau auf diese Ecke setzen. Nicht erreichbar: „Nicht sichtbar – überspringen“. Anderen Punkt antippen, um ihn zu korrigieren.',
                )
              : L(
                  'Instead of the corner you skipped: drag until the cross sits anywhere exactly on this real edge (the orange line shows where the app expects it). Not reachable either: skip.',
                  'Statt der übersprungenen Ecke: Ziehen, bis das Kreuz irgendwo genau auf dieser echten Kante sitzt (die orange Linie zeigt, wo die App sie vermutet). Auch nicht erreichbar: überspringen.',
                )}
          </p>
          {sketch}
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn small" onClick={() => nudge(-1, 0)} aria-label="links">
              ◀
            </button>
            <button className="btn small" onClick={() => nudge(0, -1)} aria-label="hoch">
              ▲
            </button>
            <button className="btn small" onClick={() => nudge(0, 1)} aria-label="runter">
              ▼
            </button>
            <button className="btn small" onClick={() => nudge(1, 0)} aria-label="rechts">
              ▶
            </button>
            <button className={`btn small${fine ? ' on' : ''}`} onClick={() => setFine((v) => !v)}>
              🎯 {L('Fine', 'Fein')}
            </button>
          </div>
          <div className="row">
            <button className="btn small" onClick={back} disabled={!history.length}>
              ← {L('Back', 'Zurück')}
            </button>
            <button className="btn small" onClick={skip}>
              {L('Not visible – skip', 'Nicht sichtbar – überspringen')}
            </button>
            <button className="btn primary" onClick={next}>
              ✓ {history.includes(target.id) ? L('Fits', 'Sitzt') : L('Fits – next', 'Sitzt – weiter')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            {L(
              'All corners are set. Check on the wall: the glowing lines should lie on the real edges. To correct a corner: touch its point and drag.',
              'Alle Ecken sind gesetzt. Prüf an der Wand: Die Leuchtlinien sollten auf den echten Kanten liegen. Ecke korrigieren: ihren Punkt antippen und ziehen.',
            )}
          </p>
          {sketch}
        </>
      )}
      <div className="small">
        {L(
          `${anchors.filter((a) => !a.q).length} corner(s) set – each side sits exactly on its set corners; corners not set follow from the others.`,
          `${anchors.filter((a) => !a.q).length} Ecke(n) gesetzt – jede Seite sitzt genau auf ihren gesetzten Ecken; nicht gesetzte Ecken ergeben sich aus den anderen.`,
        )}
      </div>
      {outliers.map((o) => {
        const t = targets.find((x) => x.id === o.c);
        return (
          <div key={o.c} className="safety-note small stack" style={{ gap: '0.4rem' }}>
            <span>
              ⚠ <b>{t?.title ?? o.c}</b>{' '}
              {L(
                `does not fit the other points (off by about ${Math.round(o.errPx)} px). Hidden, e.g. behind furniture? Set it again or remove it.`,
                `passt nicht zu den anderen Punkten (etwa ${Math.round(o.errPx)} px daneben). Verdeckt, z. B. hinter Möbeln? Neu setzen oder entfernen.`,
              )}
            </span>
            <div className="row">
              <button
                className="btn small"
                onClick={() => {
                  setHistory((h) => h.filter((x) => x !== o.c));
                  setActive(o.c);
                }}
              >
                {L('Set again', 'Neu setzen')}
              </button>
              <button
                className="btn small"
                onClick={() => {
                  send(
                    anchors.filter((a) => a.c !== o.c),
                    'full',
                  );
                  setSkipped((sk) => new Set(sk).add(o.c));
                  if (active === o.c) setActive(null);
                }}
              >
                {L('Remove', 'Entfernen')}
              </button>
            </div>
          </div>
        );
      })}
      <ProportionSliders output={output} L={L} />
      <div className="row">
        <button className="btn small" onClick={restart}>
          ↺ {L('Measure again from scratch', 'Komplett neu einmessen')}
        </button>
        <button className="btn small primary" onClick={onDone}>
          ✓ {L('Done', 'Fertig')}
        </button>
      </div>
    </div>
  );
}
