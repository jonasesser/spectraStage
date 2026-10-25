import { useRef, useState } from 'react';
import { activeProfile, roomFold, wallsOfPose, type Output, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

type Side = 'links' | 'rechts' | 'boden' | 'decke';
const NAMES: Record<Side, [string, string]> = {
  links: ['Left', 'Links'],
  rechts: ['Right', 'Rechts'],
  boden: ['Floor', 'Boden'],
  decke: ['Ceiling', 'Decke'],
};

/**
 * Squeeze or stretch the picture of each side this projector lights, along the room depth and
 * starting at the transition to the front wall (which stays in place). Squeeze fits the whole
 * side into the part a slanted projector lights; stretch shows less of it, bigger.
 */
export function ZoomSliders({ output, state, L }: { output: Output; state: SessionState; L: Tr }) {
  const store = useStore();
  const prof = activeProfile(output);
  const ref = prof.referenceResolution;
  const aspect = ref ? ref.w / ref.h : 16 / 9;
  const walls = prof.walls ?? (prof.pose ? wallsOfPose(roomFold(state.surfaces), prof.pose, aspect) : []);
  const sides = walls.filter((w): w is Side => w in NAMES);
  const [draft, setDraft] = useState<Partial<Record<Side, number>> | null>(null);
  const [linked, setLinked] = useState(true);
  const timer = useRef(0);
  const pending = useRef<Partial<Record<Side, number>> | null>(null);
  if (!prof.pose || !sides.length) return null;
  const zoom = draft ?? prof.zoom ?? {};
  const send = (z: Partial<Record<Side, number>>, final: boolean) => {
    setDraft(z);
    pending.current = z;
    const flush = () => {
      timer.current = 0;
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      void store.send({ t: 'output.setZoom', outputId: output.id, zoom: p }).finally(() => {
        if (!pending.current) setDraft(null);
      });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 80);
  };
  const set = (side: Side, v: number, final: boolean) => {
    const z = { ...zoom };
    if (linked) for (const s of sides) z[s] = v;
    else z[side] = v;
    send(z, final);
  };
  const fmt = (v: number) =>
    Math.abs(v - 1) < 0.005
      ? L('true size', 'echte Größe')
      : v < 1
        ? `${L('squeezed', 'gestaucht')} ${Math.round(v * 100)} %`
        : `${L('stretched', 'gestreckt')} ${Math.round(v * 100)} %`;
  return (
    <div
      className="stack"
      style={{ gap: '0.4rem' }}
      onPointerUp={() => pending.current && send(pending.current, true)}
    >
      <span className="small muted">
        {L(
          'Squeeze / stretch the picture per side (from the transition to the front wall):',
          'Bild pro Seite stauchen / strecken (ab dem Übergang zur vorderen Wand):',
        )}
      </span>
      <label
        className="small"
        style={{ display: 'flex', flexDirection: 'row', gap: '0.5rem', alignItems: 'center' }}
      >
        <input type="checkbox" checked={linked} onChange={(e) => setLinked(e.target.checked)} />
        {L(
          'All sides together (edges between them stay matched)',
          'Alle Seiten gemeinsam (Kanten dazwischen passen weiter)',
        )}
      </label>
      {(linked ? sides.slice(0, 1) : sides).map((s) => {
        // logarithmic slider: −1 … +1 ↔ 0.4× … 2.5×
        const v = zoom[s] ?? 1;
        return (
          <Slider
            key={s}
            label={linked ? sides.map((x) => L(...NAMES[x])).join(' + ') : L(...NAMES[s])}
            value={Math.log(v) / Math.log(2.5)}
            min={-1}
            max={1}
            step={0.01}
            onChange={(x) => set(s, Math.round(Math.pow(2.5, x) * 100) / 100, false)}
            format={(x) => fmt(Math.pow(2.5, x))}
          />
        );
      })}
      <button className="btn small ghost" onClick={() => send({}, true)}>
        {L('Back to true size', 'Zurück auf echte Größe')}
      </button>
    </div>
  );
}
