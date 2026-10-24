import { useState } from 'react';
import type { RoomObject, V3 } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

/**
 * Real objects in the room (a box, a pillar, a gravestone …). While one is selected, every
 * projector draws its outline: move and size it from the phone until the glowing outline sits
 * exactly on the real thing – then the projectors light it with its own look and hide the
 * walls behind it.
 */
interface Preset {
  en: string;
  de: string;
  icon: string;
  shape: RoomObject['shape'];
  size: [number, number, number];
  look: RoomObject['look'];
}
/** Typical furniture (left dark) and props (lit) with a sensible starting size. */
const PRESETS: Preset[] = [
  { en: 'Couch', de: 'Couch', icon: '🛋', shape: 'box', size: [2.0, 0.85, 0.9], look: 'dark' },
  { en: 'Armchair', de: 'Sessel', icon: '💺', shape: 'box', size: [0.9, 0.9, 0.9], look: 'dark' },
  { en: 'Table', de: 'Tisch', icon: '🪑', shape: 'box', size: [1.2, 0.75, 0.8], look: 'dark' },
  { en: 'Cupboard', de: 'Schrank', icon: '🗄', shape: 'box', size: [1.0, 1.9, 0.6], look: 'dark' },
  {
    en: 'Vase / plant',
    de: 'Vase / Pflanze',
    icon: '🪴',
    shape: 'cylinder',
    size: [0.35, 0.8, 0.35],
    look: 'dark',
  },
  { en: 'Box', de: 'Kiste', icon: '📦', shape: 'box', size: [0.6, 0.6, 0.6], look: 'glow' },
  { en: 'Pillar', de: 'Säule', icon: '🛢', shape: 'cylinder', size: [0.4, 1.2, 0.4], look: 'spooky' },
  { en: 'Gravestone', de: 'Grabstein', icon: '🪦', shape: 'box', size: [0.6, 0.9, 0.15], look: 'edges' },
];

export function ObjectPanel({
  L,
  objects,
  selected,
  onSelect,
  onPatch,
  mainAxis,
}: {
  L: Tr;
  objects: RoomObject[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<RoomObject>, final: boolean) => void;
  mainAxis: { ax: V3; n: V3 };
}) {
  const store = useStore();
  const [fine, setFine] = useState(false);
  const o = objects.find((x) => x.id === selected) ?? null;
  const add = async (preset: Preset) => {
    const before = new Set(objects.map((x) => x.id));
    const name = L(preset.en, preset.de);
    const n = objects.filter((x) => x.name.startsWith(name)).length;
    await store.send({
      t: 'object.create',
      shape: preset.shape,
      name: n ? `${name} ${n + 1}` : name,
      size: preset.size,
      look: preset.look,
    });
    for (let i = 0; i < 20; i++) {
      const created = (store.get().state?.objects ?? []).find((x) => !before.has(x.id));
      if (created) return onSelect(created.id);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  // nudge along the main wall (left/right) and towards it (forward/back)
  const nudge = (side: number, fwd: number) => {
    if (!o) return;
    const k = fine ? 0.005 : 0.03;
    onPatch(
      o.id,
      {
        pos: [
          o.pos[0] + (mainAxis.ax[0] * side - mainAxis.n[0] * fwd) * k,
          o.pos[1],
          o.pos[2] + (mainAxis.ax[2] * side - mainAxis.n[2] * fwd) * k,
        ],
      },
      true,
    );
  };
  const looks: [RoomObject['look'], string][] = [
    ['glow', L('Glow', 'Leuchten')],
    ['flicker', L('Fire flicker', 'Feuer-Flackern')],
    ['spooky', L('Spooky colours', 'Gruselfarben')],
    ['edges', L('Glowing edges', 'Leuchtende Kanten')],
    ['dark', L('Dark (no picture on it)', 'Dunkel (kein Bild darauf)')],
  ];
  return (
    <div className="panel stack">
      <strong>📦 {L('Objects in the room', 'Objekte im Raum')}</strong>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Add an object, then watch the room: every projector shows its yellow outline. Drag it on the floor in the 3D view or use the buttons, set its size until the outline sits exactly on the real thing.',
          'Objekt hinzufügen und in den Raum schauen: Jeder Beamer zeigt seinen gelben Umriss. Im 3D-Bild auf dem Boden ziehen oder mit den Knöpfen schieben und die Größe einstellen, bis der Umriss genau auf dem echten Ding sitzt.',
        )}
      </p>
      <div className="row">
        {objects.map((x) => (
          <button
            key={x.id}
            className={`chip${x.id === selected ? ' on' : ''}`}
            onClick={() => onSelect(x.id === selected ? null : x.id)}
          >
            {x.shape === 'box' ? '📦' : '🛢'} {x.name}
          </button>
        ))}
      </div>
      <span className="small muted">
        {L('Not to be lit (picture left out there):', 'Nicht anstrahlen (dort bleibt es dunkel):')}
      </span>
      <div className="row">
        {PRESETS.filter((p) => p.look === 'dark').map((p) => (
          <button key={p.de} className="btn small" onClick={() => void add(p)}>
            ＋ {p.icon} {L(p.en, p.de)}
          </button>
        ))}
      </div>
      <span className="small muted">{L('To be lit as a prop:', 'Als Requisite bespielen:')}</span>
      <div className="row">
        {PRESETS.filter((p) => p.look !== 'dark').map((p) => (
          <button key={p.de} className="btn small" onClick={() => void add(p)}>
            ＋ {p.icon} {L(p.en, p.de)}
          </button>
        ))}
      </div>
      {o && (
        <>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn small" onClick={() => nudge(-1, 0)} aria-label="links">
              ◀
            </button>
            <button className="btn small" onClick={() => nudge(0, 1)} aria-label="nach hinten">
              ▲
            </button>
            <button className="btn small" onClick={() => nudge(0, -1)} aria-label="nach vorne">
              ▼
            </button>
            <button className="btn small" onClick={() => nudge(1, 0)} aria-label="rechts">
              ▶
            </button>
            <button className={`btn small${fine ? ' on' : ''}`} onClick={() => setFine((v) => !v)}>
              🎯 {L('Fine', 'Fein')}
            </button>
          </div>
          <div onPointerUp={() => onPatch(o.id, {}, true)}>
            <Slider
              label={L('Width', 'Breite')}
              value={o.size[0]}
              min={0.05}
              max={4}
              step={0.01}
              onChange={(v) => onPatch(o.id, { size: [v, o.size[1], o.size[2]] }, false)}
              format={(v) => `${Math.round(v * 100)} cm`}
            />
            <Slider
              label={L('Height', 'Höhe')}
              value={o.size[1]}
              min={0.05}
              max={3}
              step={0.01}
              onChange={(v) => onPatch(o.id, { size: [o.size[0], v, o.size[2]] }, false)}
              format={(v) => `${Math.round(v * 100)} cm`}
            />
            <Slider
              label={L('Depth', 'Tiefe')}
              value={o.size[2]}
              min={0.05}
              max={4}
              step={0.01}
              onChange={(v) => onPatch(o.id, { size: [o.size[0], o.size[1], v] }, false)}
              format={(v) => `${Math.round(v * 100)} cm`}
            />
            <Slider
              label={L('Rotation', 'Drehung')}
              value={(o.yaw * 180) / Math.PI}
              min={-180}
              max={180}
              step={0.5}
              onChange={(v) => onPatch(o.id, { yaw: (v * Math.PI) / 180 }, false)}
              format={(v) => `${Math.round(v)}°`}
            />
            <Slider
              label={L('Above the floor', 'Über dem Boden')}
              value={o.pos[1]}
              min={0}
              max={2.5}
              step={0.01}
              onChange={(v) => onPatch(o.id, { pos: [o.pos[0], v, o.pos[2]] }, false)}
              format={(v) => `${Math.round(v * 100)} cm`}
            />
          </div>
          <label>
            {L('Look', 'Aussehen')}
            <select
              value={o.look}
              onChange={(e) => onPatch(o.id, { look: e.target.value as RoomObject['look'] }, true)}
            >
              {looks.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="row">
            {L('Colour', 'Farbe')}
            <input
              type="color"
              value={o.color}
              onChange={(e) => onPatch(o.id, { color: e.target.value }, true)}
            />
          </label>
          <div className="row">
            <button
              className="btn small danger"
              onClick={() => {
                if (!window.confirm(L(`Remove ${o.name}?`, `${o.name} entfernen?`))) return;
                void store.send({ t: 'object.delete', id: o.id });
                onSelect(null);
              }}
            >
              🗑 {L('Remove', 'Entfernen')}
            </button>
            <button className="btn small primary" onClick={() => onSelect(null)}>
              ✓ {L('Done', 'Fertig')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
