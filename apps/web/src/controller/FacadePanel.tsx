import { useEffect, useRef, useState } from 'react';
import { polygonBBox, type Facade, type SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';
import { useKeepAlive } from './keepAlive.ts';

type Lamp = NonNullable<Facade['lamps']>[number];
type Door = NonNullable<Facade['door']>;

const MODES: [NonNullable<Facade['lampFx']>, string, string][] = [
  ['auto', 'Changing', 'Wechselnd'],
  ['off', 'Off', 'Aus'],
  ['warm', 'Warm', 'Warm'],
  ['flicker', 'Broken', 'Kaputt flackernd'],
  ['pulse', 'Breathing', 'Atmend'],
  ['sweep', 'Searchlights', 'Suchscheinwerfer'],
  ['strobe', 'Lightning', 'Blitze'],
  ['chase', 'Taking turns', 'Abwechselnd'],
  ['colors', 'Colours', 'Farben'],
  ['fire', 'Fire', 'Feuer'],
];

/**
 * The house front on the main wall: where the real door is (scenes can then light only the
 * door and keep the frame dim – set per scene in Scenes) and the floodlights on the frame, which
 * the projector makes beam up and down. While this is open, every projector outlines door and
 * lamps so they can be lined up with the real ones.
 */
export function FacadePanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const main = state.surfaces.find((s) => s.role === 'main') ?? state.surfaces.find((s) => s.kind === 'wall');
  const box = main ? polygonBBox(main.polygon) : null;
  const [draft, setDraft] = useState<Facade | null>(null);
  const f: Facade = draft ?? state.facade ?? {};
  const timer = useRef(0);
  const pending = useRef<Facade | null>(null);
  const [outline, setOutline] = useState(false);
  useKeepAlive(() => void store.send({ t: 'facade.edit', on: true }), outline);
  useEffect(
    () => () => {
      if (outline) void store.send({ t: 'facade.edit', on: false });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [outline],
  );
  if (!box) return null;
  const W = box.w;
  const H = box.h;
  const send = (next: Facade, final = false) => {
    setDraft(next);
    pending.current = next;
    const flush = () => {
      timer.current = 0;
      const p = pending.current;
      if (!p) return;
      pending.current = null;
      const { frame: _frame, ...rest } = p;
      void store.send({ t: 'facade.set', facade: { ...rest, door: rest.door ?? null } }).finally(() => {
        if (!pending.current) setDraft(null);
      });
    };
    if (final) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 120);
  };
  const door = f.door ?? null;
  const setDoor = (d: Partial<Door>) => send({ ...f, door: { ...(door ?? defDoor(W, H)), ...d } });
  const lamps = f.lamps ?? [];
  const setLamp = (i: number, l: Partial<Lamp>) =>
    send({ ...f, lamps: lamps.map((x, k) => (k === i ? { ...x, ...l } : x)) });
  const cm = (v: number) => `${Math.round(v * 100)} cm`;
  return (
    <div
      className="stack"
      style={{ gap: '0.5rem' }}
      onPointerUp={() => pending.current && send(pending.current, true)}
    >
      <strong className="small">🏠 {L('House front (main wall)', 'Hausfront (Hauptwand)')}</strong>
      <span className="small muted">
        {L(
          'The real door as its own zone (scenes can light only the door, the frame stays dim – set per scene under Scenes), and the floodlights on the frame. Show the outlines on the projectors and move them onto the real door and lamps.',
          'Das echte Tor als eigene Zone (Szenen können nur das Tor bespielen, der Rahmen bleibt gedimmt – pro Szene unter Szenen) und die Strahler am Rahmen. Umrisse auf den Beamern anzeigen und auf das echte Tor und die Lampen schieben.',
        )}
      </span>
      <label className="check">
        <input
          type="checkbox"
          checked={outline}
          onChange={(e) => {
            setOutline(e.target.checked);
            void store.send({ t: 'facade.edit', on: e.target.checked });
          }}
        />
        {L('Show the outlines on the projectors', 'Umrisse auf den Beamern zeigen')}
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={!!door}
          onChange={(e) => send({ ...f, door: e.target.checked ? defDoor(W, H) : null }, true)}
        />
        {L('There is a door (e.g. the garage door)', 'Es gibt ein Tor (z. B. Garagentor)')}
      </label>
      {door && (
        <>
          <Slider
            label={L('Door: from the left', 'Tor: Abstand links')}
            value={door.left}
            min={0}
            max={W}
            step={0.01}
            onChange={(v) => setDoor({ left: v })}
            format={cm}
          />
          <Slider
            label={L('Door: width', 'Tor: Breite')}
            value={door.w}
            min={0.2}
            max={W}
            step={0.01}
            onChange={(v) => setDoor({ w: v })}
            format={cm}
          />
          <Slider
            label={L('Door: from the floor', 'Tor: Abstand unten')}
            value={door.bottom}
            min={0}
            max={H}
            step={0.01}
            onChange={(v) => setDoor({ bottom: v })}
            format={cm}
          />
          <Slider
            label={L('Door: height', 'Tor: Höhe')}
            value={door.h}
            min={0.2}
            max={H}
            step={0.01}
            onChange={(v) => setDoor({ h: v })}
            format={cm}
          />
        </>
      )}
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong className="small">💡 {L('Floodlights', 'Strahler')}</strong>
        <button
          className="btn small"
          disabled={lamps.length >= 8}
          onClick={() => {
            const d = door ?? defDoor(W, H);
            const right = lamps.length % 2 === 1;
            const l: Lamp = {
              x: Math.max(0.1, Math.min(W - 0.1, right ? d.left + d.w + 0.25 : d.left - 0.25)),
              y: Math.min(H - 0.1, d.bottom + d.h + 0.15),
              size: 0.15,
            };
            send({ ...f, lamps: [...lamps, l] }, true);
          }}
        >
          ＋ {L('Lamp', 'Strahler')}
        </button>
      </div>
      {lamps.map((l, i) => (
        <div key={i} className="stack" style={{ gap: '0.2rem' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small" style={{ fontWeight: 700 }}>
              💡 {i + 1}
            </span>
            <button
              className="btn small ghost"
              onClick={() => send({ ...f, lamps: lamps.filter((_, k) => k !== i) }, true)}
            >
              🗑
            </button>
          </div>
          <Slider
            label={L('From the left', 'Abstand links')}
            value={l.x}
            min={0}
            max={W}
            step={0.01}
            onChange={(v) => setLamp(i, { x: v })}
            format={cm}
          />
          <Slider
            label={L('From the floor', 'Höhe über dem Boden')}
            value={l.y}
            min={0}
            max={H}
            step={0.01}
            onChange={(v) => setLamp(i, { y: v })}
            format={cm}
          />
          <Slider
            label={L('Size', 'Größe')}
            value={l.size}
            min={0.04}
            max={0.6}
            step={0.01}
            onChange={(v) => setLamp(i, { size: v })}
            format={cm}
          />
        </div>
      ))}
      {lamps.length > 0 && (
        <>
          <div className="row">
            {MODES.map(([k, en, de]) => (
              <button
                key={k}
                className={`chip${(f.lampFx ?? 'auto') === k ? ' on' : ''}`}
                onClick={() => send({ ...f, lampFx: k }, true)}
              >
                {L(en, de)}
              </button>
            ))}
          </div>
          <Slider
            label={L('Brightness of the beams', 'Helligkeit der Strahlen')}
            value={Math.round((f.lampLevel ?? 0.8) * 100)}
            min={0}
            max={100}
            step={5}
            onChange={(v) => send({ ...f, lampLevel: v / 100 })}
            format={(v) => `${v} %`}
          />
        </>
      )}
    </div>
  );
}

/** A door to start from: the middle 70 % of the wall, from the floor up to 85 %. */
function defDoor(W: number, H: number): Door {
  return { left: W * 0.15, w: W * 0.7, bottom: 0, h: H * 0.85 };
}
