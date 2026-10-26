import { useRef, useState } from 'react';
import {
  activeProfile,
  ROOM_WALL_LABEL,
  type Output,
  type RoomWall,
  type SideLook,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

type Props = Partial<Record<RoomWall, SideLook>>;

const ONE: SideLook = { x: 1, y: 1 };
const changed = (c: SideLook) =>
  c.x !== 1 || c.y !== 1 || (c.size ?? 1) !== 1 || (c.dx ?? 0) !== 0 || (c.dy ?? 0) !== 0;

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
  const set = (w: RoomWall, key: keyof SideLook, v: number, final: boolean) => {
    const cur = props[w] ?? ONE;
    send({ ...props, [w]: { ...cur, [key]: v } }, final);
  };
  // 5 % … 500 % on a log scale (each step the same feel; narrower is needed most)
  const toPos = (v: number) => Math.log(Math.min(5, Math.max(0.05, v)));
  const fromPos = (t: number) => {
    const v = Math.exp(t);
    return Math.abs(v - 1) < 0.02 ? 1 : Math.round(v * 100) / 100;
  };
  const toSize = (v: number) => Math.log(Math.min(4, Math.max(0.25, v)));
  const pctOf = (v: number) => `${Math.round(v * 100)} %`;
  const fmtSize = (t: number) => {
    const v = fromPos(t);
    return v === 1
      ? `100 % · ${L('original', 'original')}`
      : `${pctOf(v)} · ${v < 1 ? L('smaller', 'kleiner') : L('bigger', 'größer')}`;
  };
  const fmtShift = (pos: string, neg: string) => (v: number) =>
    Math.abs(v) < 0.005 ? '0' : `${Math.round(Math.abs(v) * 100)} % ${v > 0 ? pos : neg}`;
  const fmt = (t: number) => {
    const v = fromPos(t);
    const pct = pctOf(v);
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
          'Per side, horizontally and vertically: narrower = things get narrower and more of them fit, wider = they get wider. Object size: pumpkins, graves, figures and animals bigger / smaller, their spacing stays. Shift: moves the picture of the side (things crossing over from other sides stay where they really are). The side is always lit completely; the sizes of the room do not change.',
          'Pro Seite waagerecht und senkrecht: schmaler = die Dinge werden schmaler und es passen mehr drauf, breiter = sie werden breiter. Objektgröße: Kürbisse, Grabsteine, Figuren und Tiere größer / kleiner, ihre Abstände bleiben. Verschieben: schiebt das Bild der Seite (was von anderen Seiten herüberkommt, bleibt da, wo es wirklich ist). Die Seite wird immer ganz bestrahlt; die Raummaße ändern sich nicht.',
        )}
      </span>
      {walls.map((w) => {
        const cur = props[w] ?? ONE;
        return (
          <div key={w} className="stack" style={{ gap: '0.2rem' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small" style={{ fontWeight: 700 }}>
                {ROOM_WALL_LABEL[w]}
              </span>
              {changed(cur) && (
                <button className="btn small ghost" onClick={() => send({ ...props, [w]: ONE }, true)}>
                  ↺
                </button>
              )}
            </div>
            <Slider
              label={`↔ ${L('horizontal', 'waagerecht')}`}
              value={toPos(cur.x)}
              min={Math.log(0.05)}
              max={Math.log(5)}
              step={0.005}
              onChange={(t) => set(w, 'x', fromPos(t), false)}
              format={fmt}
            />
            <Slider
              label={`↕ ${L('vertical', 'senkrecht')}`}
              value={toPos(cur.y)}
              min={Math.log(0.05)}
              max={Math.log(5)}
              step={0.005}
              onChange={(t) => set(w, 'y', fromPos(t), false)}
              format={fmt}
            />
            <Slider
              label={`⬤ ${L('Object size', 'Objektgröße')}`}
              value={toSize(cur.size ?? 1)}
              min={Math.log(0.25)}
              max={Math.log(4)}
              step={0.005}
              onChange={(t) => set(w, 'size', fromPos(t), false)}
              format={fmtSize}
            />
            <Slider
              label={`⇆ ${L('Shift', 'Verschieben')}`}
              value={cur.dx ?? 0}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => set(w, 'dx', Math.abs(v) < 0.015 ? 0 : v, false)}
              format={fmtShift(L('right', 'rechts'), L('left', 'links'))}
            />
            <Slider
              label={`⇅ ${L('Shift', 'Verschieben')}`}
              value={cur.dy ?? 0}
              min={-1}
              max={1}
              step={0.01}
              onChange={(v) => set(w, 'dy', Math.abs(v) < 0.015 ? 0 : v, false)}
              format={fmtShift(
                w === 'boden' ? L('towards you', 'zum Zuschauer') : L('down', 'runter'),
                w === 'boden' ? L('towards the wall', 'zur Wand') : L('up', 'hoch'),
              )}
            />
          </div>
        );
      })}
    </div>
  );
}
