import { useRef, useState } from 'react';
import { boxFrame, DEFAULT_VIEWER, roomFold, type SessionState, type Viewer } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

/**
 * Where the audience stands: things on the floor (pumpkins along the path …) are painted so they
 * look upright from there. Default: middle of the back wall, eyes at 1.6 m.
 */
export function ViewerSliders({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const [draft, setDraft] = useState<Viewer | null>(null);
  const timer = useRef(0);
  const pending = useRef<Viewer | null | undefined>(undefined);
  const box = boxFrame(roomFold(state.surfaces));
  const v = draft ?? state.viewer ?? DEFAULT_VIEWER;
  const send = (nv: Viewer | null, final: boolean) => {
    setDraft(nv);
    pending.current = nv;
    const flush = () => {
      timer.current = 0;
      const p = pending.current;
      if (p === undefined) return;
      pending.current = undefined;
      void store.send({ t: 'room.setViewer', viewer: p }).finally(() => {
        if (pending.current === undefined) setDraft(null);
      });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 120);
  };
  const set = (k: keyof Viewer, val: number) => send({ ...v, [k]: val }, false);
  const w = box?.w ?? 4;
  const d = box?.d ?? 4;
  return (
    <div
      className="stack"
      style={{ gap: '0.4rem' }}
      onPointerUp={() => pending.current !== undefined && send(pending.current, true)}
    >
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong className="small">{L('Audience standpoint', 'Standpunkt der Zuschauer')}</strong>
        {state.viewer && (
          <button className="btn small ghost" onClick={() => send(null, true)}>
            ↺
          </button>
        )}
      </div>
      <span className="small muted">
        {L(
          'Things on the floor (pumpkins along the path …) are painted so they look upright from here – like 3D street art. From elsewhere they look stretched.',
          'Dinge auf dem Boden (Kürbisse am Weg …) werden so gemalt, dass sie von hier aus aufrecht stehen – wie 3D-Straßenmalerei. Von woanders sehen sie gestreckt aus.',
        )}
      </span>
      <Slider
        label={L('From the front wall', 'Abstand zur Vorderwand')}
        value={v.z}
        min={0}
        max={1}
        step={0.01}
        onChange={(z) => set('z', z)}
        format={(z) =>
          `${(z * d).toFixed(1)} m${z > 0.985 ? ` · ${L('at the back wall', 'an der hinteren Wand')}` : ''}`
        }
      />
      <Slider
        label={L('Left / right', 'Links / rechts')}
        value={v.x}
        min={0}
        max={1}
        step={0.01}
        onChange={(x) => set('x', x)}
        format={(x) =>
          Math.abs(x - 0.5) < 0.01
            ? L('middle', 'Mitte')
            : `${(Math.abs(x - 0.5) * w).toFixed(1)} m ${x < 0.5 ? L('left', 'links') : L('right', 'rechts')}`
        }
      />
      <Slider
        label={L('Eye height', 'Augenhöhe')}
        value={v.eye}
        min={0.5}
        max={2.2}
        step={0.05}
        onChange={(e) => set('eye', e)}
        format={(e) => `${e.toFixed(2)} m`}
      />
    </div>
  );
}
