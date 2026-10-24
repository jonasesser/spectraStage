import { useEffect, useRef, useState } from 'react';
import {
  activeProfile,
  measureCount,
  projectPose,
  roomCorners,
  roomEdges,
  roomFold,
  type Anchor,
  type Output,
  type Pose,
  type SessionState,
  type V3,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';

interface Target {
  id: string;
  kind: 'corner' | 'edge';
  title: string;
  p: V3;
  q?: V3;
  /** Where the marker starts (predicted picture position). */
  u: number;
  v: number;
}

const lerp = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** What this projector should be measured against, from where the app currently thinks it points. */
function targetsFor(state: SessionState, pose: Pose, aspect: number, L: Tr): Target[] {
  const fold = roomFold(state.surfaces);
  const uv = (P: V3) => {
    const q = projectPose(pose, aspect, P);
    return q ? { u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 } : null;
  };
  const inside = (x: { u: number; v: number } | null, m = 0.02) =>
    !!x && x.u > m && x.u < 1 - m && x.v > m && x.v < 1 - m;
  const out: Target[] = [];
  for (const c of roomCorners(fold)) {
    const x = uv(c.p);
    if (!x || x.u < -0.1 || x.u > 1.1 || x.v < -0.1 || x.v > 1.1) continue;
    const clamp = (k: number) => Math.min(0.97, Math.max(0.03, k));
    out.push({
      id: `c|${c.id}`,
      kind: 'corner',
      title: `${L('Corner', 'Ecke')} ${c.n}: ${c.label}`,
      p: c.p,
      u: clamp(x.u),
      v: clamp(x.v),
    });
  }
  for (const e of roomEdges(fold)) {
    const vis: { t: number; u: number; v: number }[] = [];
    for (let i = 0; i <= 40; i++) {
      const x = uv(lerp(e.a, e.b, i / 40));
      if (inside(x, 0.04)) vis.push({ t: i / 40, ...x! });
    }
    if (vis.length < 5) continue;
    for (const [k, f] of [
      ['A', 0.25],
      ['B', 0.75],
    ] as const) {
      const s = vis[Math.round((vis.length - 1) * f)]!;
      out.push({
        id: `e|${e.id}|${k}`,
        kind: 'edge',
        title: `${L('Edge', 'Kante')} ${e.label} · ${L('point', 'Punkt')} ${k}`,
        p: e.a,
        q: e.b,
        u: s.u,
        v: s.v,
      });
    }
  }
  return out;
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

  const send = (list: Anchor[], final: boolean) => {
    setDraft(list);
    pending.current = list;
    const flush = () => {
      timer.current = 0;
      const l = pending.current;
      if (!l) return;
      pending.current = null;
      void store.send({ t: 'output.setAnchors', outputId: output.id, anchors: l }).finally(() => {
        if (!pending.current) setDraft(null);
      });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 90);
  };

  const targets = pose ? targetsFor(state, pose, aspect, L) : [];
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
      true,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.id]);

  if (!pose)
    return (
      <p className="muted">
        {L(
          'Put this projector into the 3D room first (Stage → 3D room).',
          'Stelle diesen Beamer zuerst in den 3D-Raum (Bühne → 3D-Raum).',
        )}
      </p>
    );

  const move = (u: number, v: number, final: boolean) => {
    if (!target) return;
    const c = (x: number) => Math.min(1.2, Math.max(-0.2, x));
    send(
      anchors.map((a) => (a.c === target.id ? { ...a, u: c(u), v: c(v) } : a)),
      final,
    );
  };
  const nudge = (dx: number, dy: number) => {
    if (!anchor) return;
    const k = fine ? 0.0006 : 0.004;
    move(anchor.u + dx * k, anchor.v + dy * k * aspect, true);
  };
  const scale = () => (fine ? 0.06 : 0.35) / (padRef.current?.clientWidth || 300);
  const next = () => {
    if (!target) return;
    send(anchors, true);
    setHistory((h) => [...h.filter((x) => x !== target.id), target.id]);
    setActive(null);
  };
  const skip = () => {
    if (!target) return;
    send(
      anchors.filter((a) => a.c !== target.id),
      true,
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
    send([], true);
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
      {target ? (
        <>
          <div className="muted small">
            {L('Step', 'Schritt')} {Math.min(total, doneSteps + 1)} {L('of', 'von')} {total}
          </div>
          <div style={{ fontWeight: 700 }}>{target.title}</div>
          <p className="small" style={{ margin: 0 }}>
            {target.kind === 'corner'
              ? L(
                  'Look at the wall: move the orange cross exactly onto this corner of the room.',
                  'Schau an die Wand: Schiebe das orange Kreuz genau auf diese Raumecke.',
                )
              : L(
                  'This edge glows orange on the projector. Move the cross anywhere exactly onto the real edge.',
                  'Diese Kante leuchtet am Beamer orange. Schiebe das Kreuz irgendwo genau auf die echte Kante.',
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
              move(d.u + (e.clientX - d.x) * k, d.v + (e.clientY - d.y) * k * aspect, false);
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              dragRef.current = null;
              if (!d) return;
              const k = scale();
              move(d.u + (e.clientX - d.x) * k, d.v + (e.clientY - d.y) * k * aspect, true);
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
            }`}
      </div>
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
