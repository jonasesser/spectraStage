import { useRef, useState } from 'react';
import { activeProfile, boxFrame, roomFold, type Output, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

/**
 * Squeeze or stretch the pictures on the side walls, floor and ceiling – by the depth of the room.
 * The sides stay pinned onto their corners and are always filled completely; only the
 * proportions of what is shown on them change (a deeper room = things look narrower there).
 */
export function ZoomSliders({ output, state, L }: { output: Output; state: SessionState; L: Tr }) {
  const store = useStore();
  const prof = activeProfile(output);
  const box = boxFrame(roomFold(state.surfaces));
  const [draft, setDraft] = useState<{ k: 'w' | 'd'; v: number } | null>(null);
  const timer = useRef(0);
  const pending = useRef<{ k: 'w' | 'd'; v: number } | null>(null);
  const walls = prof.walls ?? [];
  const sides = walls.filter((w) => w !== 'vorne' && w !== 'hinten');
  const front = walls.includes('vorne') || walls.includes('hinten');
  if (!prof.pose || !box || (!sides.length && !front)) return null;
  const depth = draft?.k === 'd' ? draft.v : box.d;
  const width = draft?.k === 'w' ? draft.v : box.w;
  const send = (d: { k: 'w' | 'd'; v: number }, final: boolean) => {
    setDraft(d);
    pending.current = d;
    const flush = () => {
      timer.current = 0;
      const p = pending.current;
      if (p === null) return;
      pending.current = null;
      void store
        .send(p.k === 'd' ? { t: 'room.setDepth', depth: p.v } : { t: 'room.setWidth', width: p.v })
        .finally(() => {
          if (pending.current === null) setDraft(null);
        });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 80);
  };
  return (
    <div
      className="stack"
      style={{ gap: '0.4rem' }}
      onPointerUp={() => pending.current !== null && send(pending.current, true)}
    >
      {front && (
        <>
          <span className="small muted">
            {L(
              'Proportions of the front / back wall: its width (height stays). The picture always fills the wall.',
              'Proportionen der vorderen / hinteren Wand: ihre Breite (die Höhe bleibt). Das Bild füllt die Wand immer ganz.',
            )}
          </span>
          <Slider
            label={L('Wall width', 'Wandbreite')}
            value={width}
            min={0.5}
            max={20}
            step={0.05}
            onChange={(v) => send({ k: 'w', v }, false)}
            format={(v) => `${v.toFixed(2)} m (${L('height', 'Höhe')} ${box.h.toFixed(2)} m)`}
          />
        </>
      )}
      {sides.length > 0 && (
        <>
          <span className="small muted">
            {L(
              'Squeeze / stretch the sides (left, right, floor, ceiling) by the room depth: more = squeezed, less = stretched. The pictures always fill the sides completely – only their proportions change.',
              'Seiten stauchen / strecken (links, rechts, Boden, Decke) über die Raumtiefe: mehr = gestaucht, weniger = gestreckt. Die Bilder füllen die Seiten immer ganz – nur ihre Proportionen ändern sich.',
            )}
          </span>
          <Slider
            label={L('Room depth', 'Raumtiefe')}
            value={depth}
            min={0.5}
            max={15}
            step={0.05}
            onChange={(v) => send({ k: 'd', v }, false)}
            format={(v) => `${v.toFixed(2)} m`}
          />
        </>
      )}
    </div>
  );
}
