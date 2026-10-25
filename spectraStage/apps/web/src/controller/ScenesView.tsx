import { useEffect, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import {
  activeScene,
  sanitizeParams,
  type ParamDef,
  type ParamValues,
  type SessionState,
  type Surface,
} from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { useShow, useStore } from './store.ts';
import { Slider, SurfacePicker, useSelection } from './ui.tsx';

export function ScenesView() {
  const L = useT();
  const store = useStore();
  const { state } = useShow();
  const sel = useSelection(state);
  const [themeId, setThemeId] = useState(state.defaultThemeId);
  const theme = catalog.get(themeId) ?? catalog.themes[0]!;
  const now = store.conn.clock.now();
  const targets = state.surfaces.filter((s) => sel.ids.includes(s.id));
  const activeIds = new Set(
    targets.map((s) => {
      const a = activeScene(s.playback, state.playlists, now);
      return a ? `${a.scene.themeId}/${a.scene.sceneId}` : '';
    }),
  );
  const kinds = new Set(targets.map((s) => s.kind));
  const worlds = theme.scenes.filter((sc) => sc.world);
  const scenes = [...theme.scenes.filter((sc) => !sc.world)].sort((a, b) => {
    const sa = a.kinds.some((k) => kinds.has(k)) ? 0 : 1;
    const sb = b.kinds.some((k) => kinds.has(k)) ? 0 : 1;
    return sa - sb;
  });

  return (
    <div className="stack">
      <SurfacePicker state={state} L={L} />
      <div className="row">
        {catalog.themes.map((t) => (
          <button
            key={t.id}
            className={`chip${t.id === theme.id ? ' on' : ''}`}
            onClick={() => setThemeId(t.id)}
          >
            {t.icon} {L.text(t.name)}
          </button>
        ))}
      </div>
      {worlds.length > 0 && (
        <section className="panel">
          <div className="section-title">
            <h2>{L('Worlds', 'Welten')}</h2>
            <span className="muted small">
              {L(
                'One scene over the whole stage – every projector shows its part',
                'Eine Szene über die ganze Bühne – jeder Beamer zeigt seinen Teil',
              )}
            </span>
          </div>
          <div className="tiles">
            {worlds.map((sc) => (
              <button
                key={sc.id}
                className={`tile scene-tile${activeIds.has(`${theme.id}/${sc.id}`) ? ' active' : ''}`}
                style={{ background: `linear-gradient(135deg, ${sc.colors[0]}, ${sc.colors[1]})` }}
                onClick={() =>
                  state.surfaces.length &&
                  store.send({
                    t: 'surface.setScene',
                    surfaceIds: state.surfaces.map((s) => s.id),
                    themeId: theme.id,
                    sceneId: sc.id,
                  })
                }
                title={L.text(sc.description)}
              >
                <span className="ti" aria-hidden="true">
                  {sc.icon}
                </span>
                {L.text(sc.name)}
              </button>
            ))}
          </div>
        </section>
      )}
      <section className="panel">
        <div className="section-title">
          <h2>{L('Single scenes', 'Einzelne Szenen')}</h2>
          <span className="muted small">
            {L('Tap to play on the selected surfaces', 'Antippen = auf gewählten Flächen abspielen')}
          </span>
        </div>
        <div className="tiles">
          {scenes.map((sc) => {
            const fits = sc.kinds.some((k) => kinds.has(k));
            return (
              <button
                key={sc.id}
                className={`tile scene-tile${activeIds.has(`${theme.id}/${sc.id}`) ? ' active' : ''}`}
                style={{
                  background: `linear-gradient(135deg, ${sc.colors[0]}, ${sc.colors[1]})`,
                  opacity: fits || kinds.size === 0 ? 1 : 0.6,
                }}
                onClick={() =>
                  targets.length &&
                  store.send({
                    t: 'surface.setScene',
                    surfaceIds: targets.map((s) => s.id),
                    themeId: theme.id,
                    sceneId: sc.id,
                  })
                }
                title={L.text(sc.description)}
              >
                <span className="ti" aria-hidden="true">
                  {sc.icon}
                </span>
                {L.text(sc.name)}
              </button>
            );
          })}
        </div>
      </section>

      {targets.length === 1 && <ParamsPanel surface={targets[0]!} state={state} L={L} />}
      {targets.length > 1 && (
        <p className="muted small">
          {L(
            'Select a single surface to fine-tune its scene.',
            'Wähle eine einzelne Fläche, um ihre Szene fein einzustellen.',
          )}
        </p>
      )}

      <section className="panel">
        <h2>{L('Start a playlist', 'Playlist starten')}</h2>
        {state.playlists.length === 0 ? (
          <p className="muted">
            {L('No playlists yet – see the Playlists tab.', 'Noch keine Playlists – siehe Tab „Playlists“.')}
          </p>
        ) : (
          <div className="list">
            {state.playlists.map((p) => (
              <div key={p.id} className="list-item">
                <div className="main">
                  <div className="title">{p.name}</div>
                  <div className="muted small">
                    {p.items.length} {L('scenes', 'Szenen')} ·{' '}
                    {Math.round(p.items.reduce((a, b) => a + b.durationSec, 0) / 60)} min
                    {p.loop ? ` · ${L('loop', 'Schleife')}` : ''}
                  </div>
                </div>
                <button
                  className="btn primary small"
                  disabled={p.items.length === 0 || targets.length === 0}
                  onClick={() =>
                    store.send({
                      t: 'surface.playPlaylist',
                      surfaceIds: targets.map((s) => s.id),
                      playlistId: p.id,
                    })
                  }
                >
                  ▶ {L('Play', 'Abspielen')}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function ParamsPanel({ surface, state, L }: { surface: Surface; state: SessionState; L: Tr }) {
  const store = useStore();
  const act = activeScene(surface.playback, state.playlists, store.conn.clock.now());
  const sc = act ? catalog.get(act.scene.themeId)?.scenes.find((x) => x.id === act.scene.sceneId) : undefined;
  const [local, setLocal] = useState<ParamValues>(() =>
    sc && act ? sanitizeParams(sc.params, act.scene.params) : {},
  );
  const key = act ? `${act.key}` : '';
  const timer = useRef(0);
  useEffect(() => {
    if (sc && act) setLocal(sanitizeParams(sc.params, act.scene.params));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!sc || !act) return null;
  const change = (k: string, v: number | boolean | string) => {
    const next = { ...local, [k]: v };
    setLocal(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(
      () => store.send({ t: 'surface.setParams', surfaceId: surface.id, params: { [k]: v } }),
      150,
    );
  };
  return (
    <section className="panel">
      <h2>
        {sc.icon} {L.text(sc.name)} · {surface.name}
      </h2>
      <div className="stack">
        {sc.params.map((p) => (
          <ParamControl key={p.key} def={p} value={local[p.key]} onChange={(v) => change(p.key, v)} L={L} />
        ))}
        <Slider
          label={L('Surface brightness', 'Helligkeit der Fläche')}
          value={Math.round(surface.intensity * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => store.send({ t: 'surface.update', surfaceId: surface.id, intensity: v / 100 })}
        />
        {surface.playback.mode === 'playlist' && (
          <p className="muted small">
            {L(
              'Changing a value stops the playlist on this surface.',
              'Eine Änderung stoppt die Playlist auf dieser Fläche.',
            )}
          </p>
        )}
      </div>
    </section>
  );
}

export function ParamControl({
  def,
  value,
  onChange,
  L,
}: {
  def: ParamDef;
  value: unknown;
  onChange: (v: number | boolean | string) => void;
  L: Tr;
}) {
  switch (def.type) {
    case 'number':
      return (
        <Slider
          label={L.text(def.label)}
          value={typeof value === 'number' ? value : def.default}
          min={def.min}
          max={def.max}
          step={def.step}
          onChange={onChange}
          format={(v) => (def.step < 1 ? v.toFixed(1) : String(v))}
        />
      );
    case 'boolean':
      return (
        <label className="check">
          <input
            type="checkbox"
            checked={typeof value === 'boolean' ? value : def.default}
            onChange={(e) => onChange(e.target.checked)}
          />
          {L.text(def.label)}
        </label>
      );
    case 'color':
      return (
        <label>
          {L.text(def.label)}
          <input
            type="color"
            value={typeof value === 'string' ? value : def.default}
            onChange={(e) => onChange(e.target.value)}
            style={{ height: 44, width: 80 }}
          />
        </label>
      );
    case 'select':
      return (
        <div>
          <div className="muted small" style={{ fontWeight: 600, marginBottom: 4 }}>
            {L.text(def.label)}
          </div>
          <div className="row">
            {def.options.map((o) => (
              <button
                key={o.value}
                className={`chip${(value ?? def.default) === o.value ? ' on' : ''}`}
                onClick={() => onChange(o.value)}
              >
                {L.text(o.label)}
              </button>
            ))}
          </div>
        </div>
      );
  }
}
