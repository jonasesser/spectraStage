import { useEffect, useMemo, useRef, useState } from 'react';
import {
  activeProfile,
  anchorWalls,
  cornerWalls,
  findOutliers,
  measureCount,
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
import { ZoomSliders } from './ZoomSliders.tsx';

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

/** The room seen from inside towards the front wall, with the corner or edge to hit marked. */
function RoomSketch({ keys, L }: { keys: string[]; L: Tr }) {
  const pos = (k: string): [number, number] | null => {
    const [z, x, y] = k.split('-');
    if (!z || !x || !y) return null;
    const front = z === 'vorne';
    const left = x === 'links';
    const top = y === 'oben';
    return front ? [left ? 70 : 150, top ? 42 : 98] : [left ? 6 : 214, top ? 6 : 134];
  };
  const pts = keys.map(pos);
  if (pts.some((p) => !p)) return null;
  const c = '#3ff2ff';
  const o = '#ffb347';
  return (
    <svg
      viewBox="0 0 220 140"
      style={{ width: '100%', maxWidth: 320, display: 'block', margin: '0 auto' }}
      role="img"
      aria-label={L('Sketch of the room', 'Skizze des Raums')}
    >
      <rect x="0" y="0" width="220" height="140" rx="8" fill="#0b0918" />
      <g stroke={c} strokeWidth="1.5" fill="none" opacity="0.7">
        <rect x="70" y="42" width="80" height="56" />
        <line x1="6" y1="6" x2="70" y2="42" />
        <line x1="214" y1="6" x2="150" y2="42" />
        <line x1="6" y1="134" x2="70" y2="98" />
        <line x1="214" y1="134" x2="150" y2="98" />
      </g>
      <g fill="#9d93d9" fontSize="10" textAnchor="middle" fontFamily="system-ui, sans-serif">
        <text x="110" y="74">
          {L('front', 'vorne')}
        </text>
        <text x="30" y="74">
          {L('left', 'links')}
        </text>
        <text x="190" y="74">
          {L('right', 'rechts')}
        </text>
        <text x="110" y="124">
          {L('floor', 'Boden')}
        </text>
        <text x="110" y="24">
          {L('ceiling', 'Decke')}
        </text>
      </g>
      {pts.length === 2 && (
        <line
          x1={pts[0]![0]}
          y1={pts[0]![1]}
          x2={pts[1]![0]}
          y2={pts[1]![1]}
          stroke={o}
          strokeWidth="5"
          strokeLinecap="round"
        />
      )}
      {pts.length === 1 && <circle cx={pts[0]![0]} cy={pts[0]![1]} r="7" fill={o} />}
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
  const [history, setHistory] = useState<string[]>([]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [fine, setFine] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; u: number; v: number } | null>(null);
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
  // only what belongs to the sides this projector lights (if chosen)
  const targets = (pose ? targetsFor(state, pose, aspect, L) : []).filter(
    (t) => !walls.length || anchorWalls(t.id).some((w) => walls.includes(w)),
  );
  const current = targets.find((t) => !history.includes(t.id) && !skipped.has(t.id)) ?? null;
  const [active, setActive] = useState<string | null>(null);
  const target = targets.find((t) => t.id === active) ?? current;
  const anchor = target ? anchors.find((a) => a.c === target.id) : undefined;

  // the projector shows edges, corners and the cross of the active step
  useEffect(() => {
    void store.send({ t: 'output.align', outputId: output.id, on: true, sel: target?.id ?? null });
  }, [output.id, target?.id, store]);
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

  const move = (u: number, v: number, how: 'drag' | 'now' | 'full') => {
    if (!target) return;
    const c = (x: number) => Math.min(1.2, Math.max(-0.2, x));
    send(
      anchors.map((a) => (a.c === target.id ? { ...a, u: c(u), v: c(v) } : a)),
      how,
    );
  };
  const nudge = (dx: number, dy: number) => {
    if (!anchor) return;
    const k = fine ? 0.0006 : 0.004;
    move(anchor.u + sx * dx * k, anchor.v + sy * dy * k * aspect, 'drag');
  };
  const scale = () => (fine ? 0.06 : 0.35) / (padRef.current?.clientWidth || 300);
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
    if (!window.confirm(L('Remove all measured points?', 'Alle gemessenen Punkte entfernen?'))) return;
    send([], 'full');
    setHistory([]);
    setSkipped(new Set());
    setActive(null);
  };

  const count = measureCount(anchors);
  let err: number | null = null;
  if (count >= 7) {
    let s = 0;
    let n = 0;
    for (const a of anchors) {
      const q = projectPose(pose, aspect, a.p);
      if (!q || a.q) continue;
      s += (((q[0] + 1) / 2 - a.u) * 1920) ** 2 + (((1 - q[1]) / 2 - a.v) * (1920 / aspect)) ** 2;
      n++;
    }
    err = n ? Math.sqrt(s / n) : 0;
  }
  const doneSteps = history.length + skipped.size;
  const total = doneSteps + targets.filter((t) => !history.includes(t.id) && !skipped.has(t.id)).length;

  return (
    <div className="panel stack">
      <strong>📐 {L('Measure projector', 'Beamer einmessen')}</strong>
      <WallPicker output={output} state={state} L={L} />
      {target ? (
        <>
          <div className="muted small">
            {L('Step', 'Schritt')} {Math.min(total, doneSteps + 1)} {L('of', 'von')} {total}
          </div>
          <div style={{ fontWeight: 700 }}>{target.title}</div>
          {target.hint && <div className="small">{target.hint}</div>}
          <RoomSketch keys={target.keys} L={L} />
          <p className="small" style={{ margin: 0 }}>
            {target.kind === 'corner'
              ? L(
                  'Look at the wall: move the orange cross exactly onto this corner. If your projector does not reach it: “not visible – skip”.',
                  'Schau an die Wand: Schiebe das orange Kreuz genau auf diese Ecke. Trifft dein Beamer sie nicht: „Nicht sichtbar – überspringen“.',
                )
              : L(
                  'Where the app expects this edge, the projector draws an orange line. Move the cross onto the real edge (not onto the orange line).',
                  'Wo die App diese Kante vermutet, zeichnet der Beamer eine orange Linie. Schiebe das Kreuz auf die echte Kante (nicht auf die orange Linie).',
                )}
          </p>
          <div
            ref={padRef}
            className="corner-pad"
            onPointerDown={(e) => {
              if (!anchor) return;
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX, y: e.clientY, u: anchor.u, v: anchor.v };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d) return;
              const k = scale();
              move(d.u + sx * (e.clientX - d.x) * k, d.v + sy * (e.clientY - d.y) * k * aspect, 'drag');
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              dragRef.current = null;
              if (!d) return;
              const k = scale();
              move(d.u + sx * (e.clientX - d.x) * k, d.v + sy * (e.clientY - d.y) * k * aspect, 'now');
            }}
            onPointerCancel={() => (dragRef.current = null)}
          >
            {L('Drag here – the cross moves on the wall', 'Hier ziehen – das Kreuz bewegt sich an der Wand')}
          </div>
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
              ✓ {L('Fits – next', 'Sitzt – weiter')}
            </button>
          </div>
        </>
      ) : (
        <p style={{ margin: 0 }}>
          {L(
            'All points this projector reaches are measured. Check on the wall: the glowing lines should lie on the real room edges.',
            'Alle Punkte, die dieser Beamer erreicht, sind gemessen. Prüf an der Wand: Die Leuchtlinien sollten auf den echten Raumkanten liegen.',
          )}
        </p>
      )}
      <div className="small">
        {count < 7
          ? L(
              `${anchors.length} points measured – a few more and the app computes the projector`,
              `${anchors.length} Punkte gemessen – noch ein paar, dann berechnet die App den Beamer`,
            )
          : `${L('Projector computed', 'Beamer berechnet')} · ${anchors.length} ${L('points', 'Punkte')}${
              err !== null ? ` · ${L('accuracy', 'Genauigkeit')} ±${Math.round(err)} px` : ''
            } · ${L('more points = more precise, “Done” any time', 'mehr Punkte = genauer, „Fertig“ jederzeit')}`}
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
      {count >= 7 && <ZoomSliders output={output} state={state} L={L} />}
      <div className="row">
        {anchors.length > 0 && (
          <button className="btn small" onClick={restart}>
            {L('Start over', 'Neu beginnen')}
          </button>
        )}
        <button className="btn small primary" onClick={onDone}>
          ✓ {L('Done', 'Fertig')}
        </button>
      </div>
    </div>
  );
}
