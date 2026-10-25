import { useRef, useState } from 'react';
import { activeProfile, ROOM_WALL_LABEL, type Output, type RoomWall } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

type Props = Partial<Record<RoomWall, { x: number; y: number }>>;

/**
 * Proportions per side for this projector: horizontally and vertically. Narrower = the things on
 * the side get narrower and more of them fit; wider = they get wider. The side is always lit
 * completely, and the sizes of the room (stage) do not change.
 */
export function ProportionSliders({ output, L }: { output: Output; L: Tr }) {
  const store = useStore();
  const prof = activeProfile(output);
  const [draft, setDraft] = useState<Props | null>(null);
  const timer = useRef(0);
  const pending = useRef<Props | null>(null);
  const walls = (prof.walls ?? []) as RoomWall[];
  if (!prof.pose || !walls.length) return null;
  const props: Props = draft ?? (prof.proportions as Props | undefined) ?? {};
  const send = (p: Props, final: boolean) => {
    setDraft(p);
    pending.current = p;
    const flush = () => {
      timer.current = 0;
      const q = pending.current;
      if (!q) return;
      pending.current = null;
      void store
        .send({ t: 'output.setProportions', outputId: output.id, proportions: q as never })
        .finally(() => {
          if (!pending.current) setDraft(null);
        });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 120);
  };
  const set = (w: RoomWall, axis: 'x' | 'y', v: number, final: boolean) => {
    const cur = props[w] ?? { x: 1, y: 1 };
    send({ ...props, [w]: { ...cur, [axis]: v } }, final);
  };
  // 10 % … 200 %: mostly needed is narrower, so most of the way is below 100 %
  const toPos = (v: number) => Math.min(2, Math.max(0.1, v));
  const fromPos = (t: number) => Math.round(t * 100) / 100;
  const fmt = (t: number) => {
    const v = fromPos(t);
    const pct = `${Math.round(v * 100)} %`;
    return Math.abs(v - 1) < 0.005
      ? `100 % · ${L('original', 'original')}`
      : v < 1
        ? `${pct} · ${L('narrower', 'schmaler')}`
        : `${pct} · ${L('wider', 'breiter')}`;
  };
  return (
    <div
      className="stack"
      style={{ gap: '0.4rem' }}
      onPointerUp={() => pending.current && send(pending.current, true)}
    >
      <strong className="small">{L('Proportions', 'Proportionen')}</strong>
      <span className="small muted">
        {L(
          'Per side, horizontally and vertically: narrower = things get narrower and more of them fit, wider = they get wider. The side is always lit completely; the sizes of the room do not change.',
          'Pro Seite waagerecht und senkrecht: schmaler = die Dinge werden schmaler und es passen mehr drauf, breiter = sie werden breiter. Die Seite wird immer ganz bestrahlt; die Raummaße ändern sich nicht.',
        )}
      </span>
      {walls.map((w) => {
        const cur = props[w] ?? { x: 1, y: 1 };
        return (
          <div key={w} className="stack" style={{ gap: '0.2rem' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small" style={{ fontWeight: 700 }}>
                {ROOM_WALL_LABEL[w]}
              </span>
              {(cur.x !== 1 || cur.y !== 1) && (
                <button
                  className="btn small ghost"
                  onClick={() => send({ ...props, [w]: { x: 1, y: 1 } }, true)}
                >
                  ↺
                </button>
              )}
            </div>
            <Slider
              label={`↔ ${L('horizontal', 'waagerecht')}`}
              value={toPos(cur.x)}
              min={0.1}
              max={2}
              step={0.01}
              onChange={(t) => set(w, 'x', fromPos(t), false)}
              format={fmt}
            />
            <Slider
              label={`↕ ${L('vertical', 'senkrecht')}`}
              value={toPos(cur.y)}
              min={0.1}
              max={2}
              step={0.01}
              onChange={(t) => set(w, 'y', fromPos(t), false)}
              format={fmt}
            />
          </div>
        );
      })}
    </div>
  );
}
