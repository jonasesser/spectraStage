import { useContext, useEffect, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer } from '@spectrastage/engine';
import { activeScene, playlistPosition, type SessionState, type Surface } from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { useShow, useStore } from './store.ts';
import { StageMap } from './StageMap.tsx';
import { SelectionCtx, Slider, SurfacePicker, useSelection } from './ui.tsx';

export function LiveView() {
  const L = useT();
  const store = useStore();
  const { state, presence } = useShow();
  const sel = useSelection(state);
  const ctx = useContext(SelectionCtx);
  const [themeId, setThemeId] = useState(state.defaultThemeId);
  const theme = catalog.get(themeId) ?? catalog.themes[0]!;
  const [fired, setFired] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const now = () => store.conn.clock.now();

  const toggle = (id: string) => {
    const cur = ctx.surfaceIds.filter((x) => state.surfaces.some((s) => s.id === x));
    ctx.setSurfaceIds(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const fire = async (effectId: string) => {
    if (sel.ids.length === 0) return;
    setFired(effectId);
    window.setTimeout(() => setFired(null), 500);
    await store.send({ t: 'effect.fire', surfaceIds: sel.ids, themeId: theme.id, effectId }, (r) =>
      r.code === 'cooldown'
        ? L('Just a moment – effect is still running.', 'Kurz warten – Effekt läuft noch.')
        : (r.message ?? 'Error'),
    );
  };

  const targets = state.surfaces.filter((s) => sel.ids.includes(s.id));
  const effects = theme.effects.filter((e) => !state.kidsSafe || e.childSafe);

  return (
    <div className="stack">
      <StageMap
        state={state}
        presence={presence}
        selected={sel.ids}
        allSelected={sel.all}
        onToggle={toggle}
        now={now}
        L={L}
      />
      <SurfacePicker state={state} L={L} />

      {catalog.themes.length > 1 && (
        <div className="row" role="group" aria-label={L('Theme', 'Thema')}>
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
      )}

      <section className="panel">
        <div className="section-title">
          <h2>{L('Effects', 'Effekte')}</h2>
          <span className="muted small">
            {sel.all ? L('on all surfaces', 'auf allen Flächen') : targets.map((s) => s.name).join(', ')}
          </span>
        </div>
        {state.surfaces.length === 0 ? (
          <p className="muted">{L('Connect a projector first.', 'Verbinde zuerst einen Beamer.')}</p>
        ) : (
          <div className="tiles">
            {effects.map((e) => (
              <button
                key={e.id}
                className={`tile${fired === e.id ? ' fired' : ''}`}
                onClick={() => fire(e.id)}
              >
                <span className="ti" aria-hidden="true">
                  {e.icon}
                </span>
                {L.text(e.name)}
              </button>
            ))}
          </div>
        )}
      </section>

      <CreaturesPanel state={state} themeId={theme.id} L={L} />

      <section className="panel">
        <div className="section-title">
          <h2>{L('Presets', 'Presets')}</h2>
          <span className="muted small">{L('applies to all surfaces', 'gilt für alle Flächen')}</span>
        </div>
        <div className="tiles">
          {theme.presets.map((p) => (
            <button
              key={p.id}
              className="tile"
              onClick={() => store.send({ t: 'preset.apply', themeId: theme.id, presetId: p.id })}
              title={L.text(p.description)}
            >
              <span className="ti" aria-hidden="true">
                {p.icon}
              </span>
              {L.text(p.name)}
            </button>
          ))}
        </div>
      </section>

      <NowPlaying state={state} surfaces={targets} L={L} />

      <section className="panel">
        <div className="section-title">
          <h2>{L('Live preview', 'Live-Vorschau')}</h2>
          <button className={`btn small${preview ? ' on' : ''}`} onClick={() => setPreview((v) => !v)}>
            {preview ? L('Hide', 'Ausblenden') : L('Show', 'Anzeigen')}
          </button>
        </div>
        {preview ? (
          <LivePreview state={state} now={now} />
        ) : (
          <p className="muted small">
            {L(
              'Renders the whole stage on this phone (uses battery).',
              'Rendert die ganze Bühne auf diesem Handy (kostet Akku).',
            )}
          </p>
        )}
      </section>
    </div>
  );
}

function CreaturesPanel({ state, themeId, L }: { state: SessionState; themeId: string; L: Tr }) {
  const store = useStore();
  const theme = catalog.get(themeId)!;
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [count, setCount] = useState(1);
  const [speed, setSpeed] = useState(1);
  const actors = theme.actors.filter((a) => !state.kidsSafe || a.childSafe);
  if (actors.length === 0) return null;
  const activeRuns = state.cues.filter((c) => c.kind === 'actor').length;
  const spawn = (actorId: string) =>
    store.send({
      t: 'actor.spawn',
      themeId,
      actorId,
      count,
      speed,
      fromSurfaceId: from || null,
      toSurfaceId: to || null,
    });
  const swap = () => {
    setFrom(to);
    setTo(from);
  };
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{L('Creatures', 'Kreaturen')}</h2>
        {activeRuns > 0 && (
          <button className="btn small ghost" onClick={() => store.send({ t: 'cue.stop' })}>
            {L('Stop all', 'Alle stoppen')} ({activeRuns})
          </button>
        )}
      </div>
      <div className="tiles">
        {actors.map((a) => (
          <button key={a.id} className="tile" onClick={() => spawn(a.id)}>
            <span className="ti" aria-hidden="true">
              {a.icon}
            </span>
            {L('Send', 'Losschicken')}: {L.text(a.name)}
          </button>
        ))}
      </div>
      <div className="stack" style={{ marginTop: '0.8rem' }}>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="grow">
            {L('From', 'Von')}
            <select value={from} onChange={(e) => setFrom(e.target.value)}>
              <option value="">{L('Random', 'Zufällig')}</option>
              {state.surfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn icon"
            onClick={swap}
            aria-label={L('Swap direction', 'Richtung tauschen')}
            title={L('Reverse', 'Umkehren')}
          >
            ⇄
          </button>
          <label className="grow">
            {L('To', 'Nach')}
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{L('Random', 'Zufällig')}</option>
              {state.surfaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <Slider
            label={L('How many', 'Anzahl')}
            value={count}
            min={1}
            max={6}
            step={1}
            onChange={setCount}
          />
          <Slider
            label={L('Speed', 'Tempo')}
            value={speed}
            min={0.4}
            max={2.5}
            step={0.1}
            onChange={setSpeed}
            format={(v) => `${v.toFixed(1)}×`}
          />
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={state.ambient.enabled}
            onChange={(e) =>
              store.send({
                t: 'session.setAmbient',
                ambient: {
                  enabled: e.target.checked,
                  actors:
                    state.ambient.actors.length > 0
                      ? state.ambient.actors
                      : actors.map((a) => ({ themeId, actorId: a.id })),
                  minGapSec: state.ambient.minGapSec,
                  maxGapSec: state.ambient.maxGapSec,
                },
              })
            }
          />
          {L(
            'Creatures roam on their own every now and then',
            'Kreaturen streifen ab und zu von selbst umher',
          )}
        </label>
      </div>
    </section>
  );
}

function NowPlaying({ state, surfaces, L }: { state: SessionState; surfaces: Surface[]; L: Tr }) {
  const store = useStore();
  const now = store.conn.clock.now();
  if (surfaces.length === 0) return null;
  return (
    <section className="panel">
      <h2>{L('Now playing', 'Läuft gerade')}</h2>
      <div className="list">
        {surfaces.map((s) => {
          const act = activeScene(s.playback, state.playlists, now);
          const sc = act
            ? catalog.get(act.scene.themeId)?.scenes.find((x) => x.id === act.scene.sceneId)
            : undefined;
          const pb = s.playback;
          const pl = pb.mode === 'playlist' ? state.playlists.find((p) => p.id === pb.playlistId) : undefined;
          const pos = pl && pb.mode === 'playlist' ? playlistPosition(pl, pb, now) : null;
          const paused = pb.mode === 'playlist' && pb.pausedAt !== null;
          return (
            <div key={s.id} className="list-item">
              <span style={{ fontSize: '1.6rem' }} aria-hidden="true">
                {sc?.icon ?? '•'}
              </span>
              <div className="main">
                <div className="title">
                  {s.name}: {sc ? L.text(sc.name) : '–'}
                </div>
                <div className="muted small">
                  {pl && pos
                    ? `${L('Playlist', 'Playlist')} „${pl.name}“ · ${pos.index + 1}/${pl.items.length}${paused ? ` · ${L('paused', 'pausiert')}` : ''}`
                    : L('Single scene', 'Einzelne Szene')}
                </div>
              </div>
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <button
                  className="btn icon"
                  aria-label={L('Previous', 'Zurück')}
                  onClick={() => store.send({ t: 'surface.skip', surfaceIds: [s.id], direction: -1 })}
                >
                  ⏮
                </button>
                {pl && (
                  <button
                    className="btn icon"
                    aria-label={paused ? L('Play', 'Abspielen') : L('Pause', 'Pause')}
                    onClick={() => store.send({ t: 'surface.pause', surfaceIds: [s.id], paused: !paused })}
                  >
                    {paused ? '▶' : '⏸'}
                  </button>
                )}
                <button
                  className="btn icon"
                  aria-label={L('Next', 'Weiter')}
                  onClick={() => store.send({ t: 'surface.skip', surfaceIds: [s.id], direction: 1 })}
                >
                  ⏭
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function LivePreview({ state, now }: { state: SessionState; now: () => number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<StageRenderer | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const renderer = new StageRenderer({
      canvas: ref.current,
      catalog,
      loadRuntime: loadThemeRuntime,
      now,
      preview: true,
      maxPixelRatio: 1,
    });
    r.current = renderer;
    renderer.start();
    return () => renderer.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    r.current?.setState(state, null);
  }, [state]);
  return <canvas ref={ref} className="preview-canvas" />;
}
