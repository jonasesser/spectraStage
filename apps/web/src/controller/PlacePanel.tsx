import { useEffect, useRef, useState } from 'react';
import {
  activeProfile,
  pictureToRoom,
  projectPose,
  roomFold,
  wallsOfPose,
  type Facade,
  type Mask,
  type Output,
  type RoomObject,
  type SessionState,
  type V3,
} from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { useStore } from './store.ts';
import { ObjectPanel } from './ObjectPanel.tsx';
import { FacadePanel } from './FacadePanel.tsx';
import { useKeepAlive } from './keepAlive.ts';

type Tab = 'door' | 'lamps' | 'objects' | 'masks';
type UV = { u: number; v: number };

/**
 * Placing the real things with the measured projector: the projector shows a free orange cross,
 * you move it from the phone onto the real thing (a corner of the garage door, a lamp, the foot
 * of a pumpkin, the corners of an area to keep dark) and take it over. The app knows from the
 * measuring where that is in the room – so it holds for every projector and shows up in the
 * 3D room for fine adjustment.
 */
export function PlacePanel({ output, state, L }: { output: Output; state: SessionState; L: Tr }) {
  const store = useStore();
  const profile = activeProfile(output);
  const pose = profile.pose!;
  const ref = profile.referenceResolution;
  const aspect = ref ? ref.w / ref.h : 16 / 9;
  const fold = roomFold(state.surfaces);
  const walls = profile.walls ?? wallsOfPose(fold, pose, aspect);
  const anchors = profile.anchors ?? [];
  const [tab, setTab] = useState<Tab>('door');
  const [cross, setCross] = useState<UV>({ u: 0.5, v: 0.5 });
  const [msg, setMsg] = useState<string | null>(null);
  const [fine, setFine] = useState(false);
  const timer = useRef(0);
  const last = useRef<UV>(cross);

  // the projector shows the cross (throttled while dragging)
  const show = (c: UV, now = false) => {
    last.current = c;
    const flush = () => {
      timer.current = 0;
      void store.send({ t: 'output.align', outputId: output.id, on: true, sel: null, mark: last.current });
    };
    if (now) {
      window.clearTimeout(timer.current);
      flush();
    } else if (!timer.current) timer.current = window.setTimeout(flush, 80);
  };
  useEffect(() => {
    show(cross, true);
    return () => {
      window.clearTimeout(timer.current);
      void store.send({ t: 'output.align', outputId: output.id, on: true, sel: null, mark: null });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [output.id]);
  // renew while this screen is open (expires on the projector if the page is closed / reloaded)
  useKeepAlive(() => show(last.current, true), true);
  const moveTo = (c: UV, now = false) => {
    const k = (x: number) => Math.min(1.1, Math.max(-0.1, x));
    const n = { u: k(c.u), v: k(c.v) };
    setCross(n);
    show(n, now);
  };
  /** Start the cross where a room point is (if the projector sees it). */
  const crossAt = (P: V3) => {
    const q = projectPose(pose, aspect, P);
    if (q) moveTo({ u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 }, true);
  };
  // door and lamps: outlines on all projectors while on these tabs; masks shown while drawing
  useEffect(() => {
    const facade = tab === 'door' || tab === 'lamps';
    void store.send({ t: 'facade.edit', on: facade });
    void store.send({ t: 'output.update', outputId: output.id, showMasks: tab === 'masks' });
    return () => {
      void store.send({ t: 'facade.edit', on: false });
      void store.send({ t: 'output.update', outputId: output.id, showMasks: false });
    };
  }, [tab, output.id, store]);

  // a turned / mirrored mount: dragging right moves the cross right on the wall
  const turned = profile.rotation === 180;
  const sx = turned !== profile.flipX ? -1 : 1;
  const sy = turned !== profile.flipY ? -1 : 1;

  const hit = () => pictureToRoom(fold, pose, aspect, anchors, walls, cross.u, cross.v);
  const mainFace = fold.faces.find((f) => f.role === 'main');
  /** The cross on the main wall: metres from its left and from the floor. */
  const onMain = (): { x: number; y: number } | null => {
    const h = hit();
    if (!h || !mainFace || h.face.id !== mainFace.id) {
      setMsg(
        L(
          'The cross is not on the main wall (or this projector does not light it).',
          'Das Kreuz liegt nicht auf der Hauptwand (oder dieser Beamer strahlt sie nicht an).',
        ),
      );
      return null;
    }
    setMsg(null);
    const r = mainFace.rect;
    return { x: h.x - r.x, y: r.y + r.h - h.y };
  };
  const facade: Facade = state.facade ?? {};
  const sendFacade = (f: Facade) => {
    const { frame: _frame, ...rest } = f;
    void store.send({ t: 'facade.set', facade: { ...rest, door: rest.door ?? null } });
  };

  // ---- door: two corners
  const [doorPts, setDoorPts] = useState<{ tl?: { x: number; y: number }; br?: { x: number; y: number } }>(
    {},
  );
  const takeDoor = (which: 'tl' | 'br') => {
    const p = onMain();
    if (!p) return;
    const next = { ...doorPts, [which]: p };
    setDoorPts(next);
    const a =
      next.tl ?? (facade.door ? { x: facade.door.left, y: facade.door.bottom + facade.door.h } : null);
    const b =
      next.br ?? (facade.door ? { x: facade.door.left + facade.door.w, y: facade.door.bottom } : null);
    if (a && b) {
      const left = Math.min(a.x, b.x);
      const bottom = Math.max(0, Math.min(a.y, b.y));
      sendFacade({
        ...facade,
        door: { left, bottom, w: Math.max(0.2, Math.abs(b.x - a.x)), h: Math.max(0.2, Math.abs(a.y - b.y)) },
      });
    }
  };
  const doorCorner = (which: 'tl' | 'br'): V3 | null => {
    const d = facade.door;
    if (!d || !mainFace) return null;
    const r = mainFace.rect;
    const x = r.x + (which === 'tl' ? d.left : d.left + d.w);
    const y = r.y + r.h - (which === 'tl' ? d.bottom + d.h : d.bottom);
    return [
      mainFace.o[0] + mainFace.ax[0] * (x - r.x) + mainFace.ay[0] * (y - r.y),
      mainFace.o[1] + mainFace.ax[1] * (x - r.x) + mainFace.ay[1] * (y - r.y),
      mainFace.o[2] + mainFace.ax[2] * (x - r.x) + mainFace.ay[2] * (y - r.y),
    ];
  };

  // ---- lamps
  const lamps = facade.lamps ?? [];
  const addLamp = () => {
    const p = onMain();
    if (!p || lamps.length >= 8) return;
    sendFacade({ ...facade, lamps: [...lamps, { x: p.x, y: p.y, size: 0.15 }] });
  };
  const moveLamp = (i: number) => {
    const p = onMain();
    if (!p) return;
    sendFacade({ ...facade, lamps: lamps.map((l, k) => (k === i ? { ...l, x: p.x, y: p.y } : l)) });
  };

  // ---- objects (pumpkins …)
  const [objSel, setObjSel] = useState<string | null>(null);
  const objects = state.objects ?? [];
  useEffect(() => {
    if (tab !== 'objects') return;
    void store.send({ t: 'object.edit', id: objSel });
    return () => void store.send({ t: 'object.edit', id: null });
  }, [tab, objSel, store]);
  useKeepAlive(() => void store.send({ t: 'object.edit', id: objSel }), tab === 'objects' && !!objSel);
  useKeepAlive(() => void store.send({ t: 'facade.edit', on: true }), tab === 'door' || tab === 'lamps');
  const patchObject = (id: string, patch: Partial<RoomObject>, final: boolean) => {
    void final;
    void store.send({ t: 'object.update', id, patch });
  };
  const placeObject = () => {
    const o = objects.find((x) => x.id === objSel);
    if (!o) return;
    const h = hit();
    if (!h || h.face.role !== 'ground') {
      setMsg(
        L(
          'Put the cross on the floor, right where the middle of the object stands on it (the front edge).',
          'Das Kreuz auf den Boden setzen – genau wo die Mitte des Gegenstands vorne auf dem Boden steht.',
        ),
      );
      return;
    }
    setMsg(null);
    // the cross marks the front foot: the middle lies half a depth further away from the projector
    const dx = h.P[0] - pose.pos[0];
    const dz = h.P[2] - pose.pos[2];
    const d = Math.hypot(dx, dz) || 1;
    const back = o.size[2] / 2;
    void store.send({
      t: 'object.update',
      id: o.id,
      patch: { pos: [h.P[0] + (dx / d) * back, 0, h.P[2] + (dz / d) * back] },
    });
  };

  // ---- masks (this projector)
  const [drawing, setDrawing] = useState<UV[] | null>(null);
  const toOut = (c: UV) => ({ x: sx < 0 ? 1 - c.u : c.u, y: sy < 0 ? 1 - c.v : c.v });
  const saveMasks = (masks: Mask[]) =>
    void store.send({
      t: 'output.saveProfile',
      outputId: output.id,
      profile: { ...profile, masks },
      activate: true,
    });
  const finishMask = () => {
    if (!drawing || drawing.length < 3) return;
    const m: Mask = {
      id: Math.random().toString(36).slice(2, 12),
      name: `${L('Dark area', 'Dunkler Bereich')} ${profile.masks.length + 1}`,
      mode: 'exclude',
      shape: 'polygon',
      points: drawing.map(toOut),
      margin: 0.005,
      feather: 0,
      safety: true,
      enabled: true,
    };
    saveMasks([...profile.masks, m]);
    setDrawing(null);
  };

  const tabs: [Tab, string][] = [
    ['door', `🚪 ${L('Door', 'Tor')}`],
    ['lamps', `💡 ${L('Lamps', 'Strahler')}`],
    ['objects', `🎃 ${L('Pumpkins & things', 'Kürbisse & Dinge')}`],
    ['masks', `⬛ ${L('Keep dark', 'Dunkel lassen')}`],
  ];
  return (
    <div className="stack" style={{ gap: '0.6rem' }}>
      <div className="row">
        {tabs.map(([k, label]) => (
          <button key={k} className={`chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <p className="small" style={{ margin: 0 }}>
        {L(
          'The projector shows an orange cross. Drag on the field below until it sits exactly on the real thing, then take it over.',
          'Der Beamer zeigt ein oranges Kreuz. Auf dem Feld unten ziehen, bis es genau auf dem echten Ding sitzt – dann übernehmen.',
        )}
      </p>
      <CrossPad
        fine={fine}
        onFine={() => setFine((v) => !v)}
        onMove={(dx, dy, final) =>
          moveTo({ u: last.current.u + sx * dx, v: last.current.v + sy * dy * aspect }, final)
        }
        L={L}
      />
      {msg && <div className="safety-note small">{msg}</div>}

      {tab === 'door' && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <div className="row">
            <button className="btn small" onClick={() => doorCorner('tl') && crossAt(doorCorner('tl')!)}>
              ↖ {L('Cross to the top left corner', 'Kreuz zur Ecke oben links')}
            </button>
            <button className="btn primary small" onClick={() => takeDoor('tl')}>
              ✓ {L('Top left of the door', 'Oben links am Tor')} {doorPts.tl ? '✔' : ''}
            </button>
          </div>
          <div className="row">
            <button className="btn small" onClick={() => doorCorner('br') && crossAt(doorCorner('br')!)}>
              ↘ {L('Cross to the bottom right corner', 'Kreuz zur Ecke unten rechts')}
            </button>
            <button className="btn primary small" onClick={() => takeDoor('br')}>
              ✓ {L('Bottom right of the door', 'Unten rechts am Tor')} {doorPts.br ? '✔' : ''}
            </button>
          </div>
          <span className="muted small">
            {L(
              'Put the cross on the top left corner of the real door, take it over, then the bottom right one. The dashed outline then lies on the door.',
              'Kreuz auf die echte Ecke oben links am Tor, übernehmen, dann unten rechts. Der gestrichelte Umriss liegt dann auf dem Tor.',
            )}
          </span>
        </div>
      )}

      {tab === 'lamps' && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <button className="btn primary small" disabled={lamps.length >= 8} onClick={addLamp}>
            ＋ {L('Lamp where the cross is', 'Strahler am Kreuz')}
          </button>
          {lamps.map((l, i) => (
            <div key={i} className="row">
              <span className="small" style={{ flex: 1 }}>
                💡 {i + 1}: {Math.round(l.x * 100)} / {Math.round(l.y * 100)} cm
              </span>
              <button className="btn small" onClick={() => moveLamp(i)}>
                📍 {L('Move to the cross', 'Aufs Kreuz setzen')}
              </button>
            </div>
          ))}
        </div>
      )}

      {(tab === 'door' || tab === 'lamps') && (
        <details className="panel">
          <summary className="small">
            {L('Fine adjustment, lamp effects, brightness', 'Feinjustierung, Strahler-Effekte, Helligkeit')}
          </summary>
          <FacadePanel state={state} L={L} />
        </details>
      )}

      {tab === 'objects' && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          {objSel && (
            <button className="btn primary small" onClick={placeObject}>
              📍{' '}
              {L(
                'Place it at the cross (cross on the floor at its front middle)',
                'Aufs Kreuz setzen (Kreuz vorne mittig, wo er auf dem Boden steht)',
              )}
            </button>
          )}
          <ObjectPanel
            L={L}
            objects={objects}
            selected={objSel}
            onSelect={setObjSel}
            onPatch={patchObject}
            mainAxis={mainFace ? { ax: mainFace.ax, n: mainFace.n } : { ax: [1, 0, 0], n: [0, 0, 1] }}
          />
        </div>
      )}

      {tab === 'masks' && (
        <div className="stack" style={{ gap: '0.4rem' }}>
          <span className="muted small">
            {L(
              'This projector leaves these areas dark (a window, a plant, a door to the neighbours …). Set the corners one after the other with the cross.',
              'Dieser Beamer lässt diese Bereiche dunkel (ein Fenster, eine Pflanze, die Nachbartür …). Ecken nacheinander mit dem Kreuz setzen.',
            )}
          </span>
          {drawing ? (
            <div className="row">
              <button className="btn primary small" onClick={() => setDrawing([...drawing, cross])}>
                ＋ {L('Corner here', 'Ecke hier')} ({drawing.length})
              </button>
              <button className="btn small" disabled={drawing.length < 3} onClick={finishMask}>
                ✓ {L('Done', 'Fertig')}
              </button>
              <button className="btn small ghost" onClick={() => setDrawing(null)}>
                {L('Cancel', 'Abbrechen')}
              </button>
            </div>
          ) : (
            <button className="btn primary small" onClick={() => setDrawing([])}>
              ＋ {L('New dark area', 'Neuer dunkler Bereich')}
            </button>
          )}
          {profile.masks.map((m) => (
            <div key={m.id} className="row">
              <label className="check" style={{ flex: 1 }}>
                <input
                  type="checkbox"
                  checked={m.enabled}
                  onChange={(e) =>
                    saveMasks(
                      profile.masks.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)),
                    )
                  }
                />
                {m.name}
              </label>
              <button
                className="btn small ghost"
                onClick={() => saveMasks(profile.masks.filter((x) => x.id !== m.id))}
                aria-label={L('Delete', 'Löschen')}
              >
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A touch field: dragging moves the cross on the wall; arrows for small steps. */
function CrossPad({
  fine,
  onFine,
  onMove,
  L,
}: {
  fine: boolean;
  onFine: () => void;
  onMove: (dx: number, dy: number, final: boolean) => void;
  L: Tr;
}) {
  const drag = useRef<{ x: number; y: number; w: number } | null>(null);
  const k = fine ? 0.06 : 0.35;
  const step = fine ? 0.0015 : 0.01;
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <div
        role="application"
        aria-label={L('Drag to move the cross', 'Ziehen bewegt das Kreuz')}
        style={{
          height: 160,
          borderRadius: 10,
          background: 'repeating-linear-gradient(45deg, #120f22, #120f22 10px, #0d0b19 10px, #0d0b19 20px)',
          border: '1px solid #3a3360',
          touchAction: 'none',
          display: 'grid',
          placeItems: 'center',
          color: '#9d93d9',
          userSelect: 'none',
        }}
        onPointerDown={(e) => {
          (e.target as Element).setPointerCapture?.(e.pointerId);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            w: e.currentTarget.getBoundingClientRect().width || 300,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = ((e.clientX - d.x) / d.w) * k;
          const dy = ((e.clientY - d.y) / d.w) * k;
          d.x = e.clientX;
          d.y = e.clientY;
          onMove(dx, dy, false);
        }}
        onPointerUp={() => {
          if (drag.current) onMove(0, 0, true);
          drag.current = null;
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        ✥ {L('drag here', 'hier ziehen')}
      </div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn small" onClick={() => onMove(-step, 0, true)} aria-label="links">
          ◀
        </button>
        <button className="btn small" onClick={() => onMove(0, -step, true)} aria-label="hoch">
          ▲
        </button>
        <button className="btn small" onClick={() => onMove(0, step, true)} aria-label="runter">
          ▼
        </button>
        <button className="btn small" onClick={() => onMove(step, 0, true)} aria-label="rechts">
          ▶
        </button>
        <button className={`btn small${fine ? ' on' : ''}`} onClick={onFine}>
          🎯 {L('Fine', 'Fein')}
        </button>
      </div>
    </div>
  );
}
