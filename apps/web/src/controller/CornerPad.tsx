import { useRef, useState } from 'react';
import { projectPose, type Anchor, type Pose, type RoomCorner } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';

/**
 * Measuring a projector against the real room: pick a room corner, then move its marker on the
 * projector with this touchpad until it sits exactly on the real corner (look at the wall, not
 * at the phone). From 4 corners on, the app computes where the projector stands and how it is
 * aimed, and the glowing room edges on the projector snap onto the real edges.
 */
export function CornerPad({
  L,
  pose,
  aspect,
  corners,
  corner,
  onCorner,
  anchors,
  onAnchors,
  onDone,
}: {
  L: Tr;
  pose: Pose;
  aspect: number;
  corners: RoomCorner[];
  corner: string | null;
  onCorner: (id: string | null) => void;
  anchors: Anchor[];
  onAnchors: (list: Anchor[], final: boolean) => void;
  onDone: () => void;
}) {
  const [fine, setFine] = useState(false);
  const padRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; u: number; v: number } | null>(null);

  const predicted = (c: RoomCorner) => {
    const q = projectPose(pose, aspect, c.p);
    return q ? { u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 } : null;
  };
  // corners the projector (roughly) reaches first, the others after
  const reach = (c: RoomCorner) => {
    const q = predicted(c);
    return !!q && q.u > -0.15 && q.u < 1.15 && q.v > -0.15 && q.v < 1.15;
  };
  const sorted = [...corners].sort((a, b) => Number(reach(b)) - Number(reach(a)) || a.n - b.n);
  const sel = corners.find((c) => c.id === corner) ?? null;
  const anchor = sel ? anchors.find((a) => a.c === sel.id) : undefined;

  const ensure = (c: RoomCorner): Anchor[] => {
    if (anchors.some((a) => a.c === c.id)) return anchors;
    const q = predicted(c);
    const clamp = (x: number) => Math.min(0.97, Math.max(0.03, x));
    return [...anchors, { c: c.id, p: c.p, u: clamp(q?.u ?? 0.5), v: clamp(q?.v ?? 0.5) }];
  };
  const pick = (c: RoomCorner) => {
    onCorner(c.id);
    const list = ensure(c);
    if (list !== anchors) onAnchors(list, true);
  };
  const move = (u: number, v: number, final: boolean) => {
    if (!sel) return;
    const clamp = (x: number) => Math.min(1.2, Math.max(-0.2, x));
    onAnchors(
      ensure(sel).map((a) => (a.c === sel.id ? { ...a, u: clamp(u), v: clamp(v) } : a)),
      final,
    );
  };
  const nudge = (dx: number, dy: number) => {
    const a = anchor ?? (sel ? ensure(sel).find((x) => x.c === sel.id) : undefined);
    if (!a) return;
    const k = fine ? 0.0006 : 0.004;
    move(a.u + dx * k, a.v + dy * k * aspect, true);
  };

  const onDown = (e: React.PointerEvent) => {
    if (!sel) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const a = ensure(sel).find((x) => x.c === sel.id)!;
    dragRef.current = { x: e.clientX, y: e.clientY, u: a.u, v: a.v };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const pad = padRef.current;
    if (!d || !pad) return;
    // like a laptop touchpad: the whole pad moves the marker across about a third of the picture
    const k = (fine ? 0.06 : 0.35) / pad.clientWidth;
    move(d.u + (e.clientX - d.x) * k, d.v + (e.clientY - d.y) * k * aspect, false);
  };
  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    const pad = padRef.current;
    if (!d || !pad) return;
    const k = (fine ? 0.06 : 0.35) / pad.clientWidth;
    move(d.u + (e.clientX - d.x) * k, d.v + (e.clientY - d.y) * k * aspect, true);
  };

  // remaining error in pixels (1920 wide picture): how well the room edges match
  let err: number | null = null;
  if (anchors.length >= 4) {
    let s = 0;
    for (const a of anchors) {
      const q = projectPose(pose, aspect, a.p);
      if (!q) continue;
      s += (((q[0] + 1) / 2 - a.u) * 1920) ** 2 + (((1 - q[1]) / 2 - a.v) * (1920 / aspect)) ** 2;
    }
    err = Math.sqrt(s / anchors.length);
  }

  return (
    <div className="panel stack">
      <strong>📐 {L('Measure corners', 'Ecken einmessen')}</strong>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'The projector now shows the room edges and numbered corners as the app thinks they are. Pick a corner (number in the 3D view or below), then move the orange cross on the wall with the pad until it sits exactly on the real corner. From 4 corners on the projector position is computed – the more corners (also on other walls), the more precise.',
          'Der Beamer zeigt jetzt die Raumkanten und nummerierten Ecken, wie die App sie vermutet. Ecke wählen (Nummer im 3D-Bild oder unten), dann das orange Kreuz an der Wand mit dem Feld darunter verschieben, bis es genau auf der echten Ecke sitzt. Ab 4 Ecken berechnet die App den Beamer – je mehr Ecken (auch auf anderen Wänden), desto genauer.',
        )}
      </p>
      <div className="row">
        {sorted.map((c) => {
          const done = anchors.some((a) => a.c === c.id);
          return (
            <button
              key={c.id}
              className={`chip${c.id === corner ? ' on' : ''}`}
              title={c.label}
              style={reach(c) ? undefined : { opacity: 0.5 }}
              onClick={() => pick(c)}
            >
              {done ? '✓ ' : ''}
              {c.n}
            </button>
          );
        })}
      </div>
      {sel ? (
        <>
          <span className="small">
            <b>{sel.n}</b> · {sel.label}
          </span>
          <div
            ref={padRef}
            className="corner-pad"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
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
        </>
      ) : (
        <span className="muted small">{L('Choose a corner first.', 'Zuerst eine Ecke wählen.')}</span>
      )}
      <div className="small">
        {anchors.length < 4
          ? L(
              `${anchors.length} of at least 4 corners measured`,
              `${anchors.length} von mindestens 4 Ecken gemessen`,
            )
          : `${L(`${anchors.length} corners measured · accuracy`, `${anchors.length} Ecken gemessen · Genauigkeit`)} ±${Math.round(err ?? 0)} px`}
      </div>
      <div className="row">
        {anchor && (
          <button
            className="btn small"
            onClick={() => {
              onAnchors(
                anchors.filter((a) => a.c !== anchor.c),
                true,
              );
              onCorner(null);
            }}
          >
            {L('Remove this corner', 'Diese Ecke entfernen')}
          </button>
        )}
        {anchors.length > 0 && (
          <button
            className="btn small"
            onClick={() => {
              if (!window.confirm(L('Remove all measured corners?', 'Alle gemessenen Ecken entfernen?')))
                return;
              onAnchors([], true);
              onCorner(null);
            }}
          >
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
