import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { StageRenderer, type RendererStats } from '@spectrastage/engine';
import {
  activeProfile,
  completeRoom,
  polygonBBox,
  sanitizeParams,
  stageBounds,
  surfacesForSides,
  type BBox,
  type ParamValues,
  type SceneManifest,
  type SessionState,
} from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { showVideosFor } from '../lib/videos.ts';
import { useShow, useStore } from './store.ts';
import { ParamControl } from './ScenesView.tsx';

type Res = 'window' | '1080' | '4k';

/**
 * Testing on this PC, without any projector: a scene (also the 3D shows) rendered here with the
 * same engine the projectors use – only on this screen, the show itself is not touched – or the
 * picture of any projector live, exactly as it shows it. With the resolution of a real projector
 * (up to 4K) and the numbers of the graphics card, to find what overloads it.
 */
export function TestView() {
  const L = useT();
  const { state } = useShow();
  const [mode, setMode] = useState<'scene' | 'projector'>('scene');
  return (
    <div className="stack">
      <section className="panel stack">
        <h2 style={{ margin: 0 }}>🧪 {L('Test on this PC', 'Test auf diesem PC')}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {L(
            'Runs only here on this screen – the projectors and the show are not changed.',
            'Läuft nur hier auf diesem Bildschirm – die Beamer und die Show bleiben unverändert.',
          )}
        </p>
        <div className="row">
          <button className={`chip${mode === 'scene' ? ' on' : ''}`} onClick={() => setMode('scene')}>
            🎬 {L('Try a scene', 'Szene ausprobieren')}
          </button>
          <button className={`chip${mode === 'projector' ? ' on' : ''}`} onClick={() => setMode('projector')}>
            📽 {L('Live picture of a projector', 'Live-Bild eines Beamers')}
          </button>
        </div>
      </section>
      {state &&
        (mode === 'scene' ? <SceneTest state={state} L={L} /> : <ProjectorTest state={state} L={L} />)}
    </div>
  );
}

/** One scene, chosen here, on its sides – a local copy of the show, never sent. */
function SceneTest({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const [themeId, setThemeId] = useState(state.defaultThemeId);
  const theme = catalog.get(themeId) ?? catalog.themes[0]!;
  const scenes = theme.scenes.filter((s) => !s.params.some((p) => p.type === 'video'));
  const [sceneId, setSceneId] = useState<string>(() => scenes.find((s) => s.oneShotSec)?.id ?? scenes[0]!.id);
  const sc: SceneManifest | undefined = theme.scenes.find((s) => s.id === sceneId);
  const [params, setParams] = useState<ParamValues>(() => (sc ? sanitizeParams(sc.params, {}) : {}));
  const [start, setStart] = useState(() => store.conn.clock.now());
  const [view, setView] = useState<'sides' | 'stage'>('sides');
  const [res, setRes] = useState<Res>('window');
  const main = state.surfaces.find((s) => s.role === 'main') ?? state.surfaces.find((s) => s.kind === 'wall');
  // where it plays: its own sides (rehearsed shows, worlds everywhere) – else the main wall
  const targets = sc?.world
    ? state.surfaces
    : sc?.sides
      ? surfacesForSides(state.surfaces, sc.sides)
      : main
        ? [main]
        : [];
  const targetKey = targets.map((t) => t.id).join(',');
  // the local show: the chosen scene on those sides, from the start button on
  const local = useMemo<SessionState | null>(() => {
    if (!sc) return null;
    const next = structuredClone(state);
    for (const s of next.surfaces) {
      delete s.insert;
      if (!targetKey.split(',').includes(s.id)) continue;
      s.playback = {
        mode: 'scene',
        scene: { themeId: theme.id, sceneId: sc.id, params },
        seed: 4242,
        startedAt: start,
        transition: { type: 'cut', durationMs: 0 },
      };
    }
    next.blackoutAll = false;
    next.cues = [];
    return next;
  }, [state, sc, theme.id, params, start, targetKey]);
  // what is shown: the sides of the scene (bounding box) or the whole stage
  let rect: BBox | null = null;
  if (view === 'sides' && targets.length) {
    const bs = targets.map((t) => polygonBBox(t.polygon));
    const x0 = Math.min(...bs.map((b) => b.x));
    const y0 = Math.min(...bs.map((b) => b.y));
    const x1 = Math.max(...bs.map((b) => b.x + b.w));
    const y1 = Math.max(...bs.map((b) => b.y + b.h));
    rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const sorted = [...scenes].sort((a, b) => (b.oneShotSec ? 1 : 0) - (a.oneShotSec ? 1 : 0));
  return (
    <section className="panel stack">
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
      <label className="stack" style={{ gap: '0.2rem' }}>
        <span className="small">{L('Scene', 'Szene')}</span>
        <select
          value={sceneId}
          onChange={(e) => {
            const id = e.target.value;
            setSceneId(id);
            const n = theme.scenes.find((s) => s.id === id);
            setParams(n ? sanitizeParams(n.params, {}) : {});
            setStart(store.conn.clock.now());
          }}
        >
          {sorted.map((s) => (
            <option key={s.id} value={s.id}>
              {s.icon} {L.text(s.name)}
              {s.oneShotSec ? ` · ${L('show', 'Show')}` : s.world ? ` · ${L('world', 'Welt')}` : ''}
            </option>
          ))}
        </select>
      </label>
      <span className="muted small">
        {L('Plays on', 'Läuft auf')}: {targets.map((t) => t.name).join(', ') || '–'}
      </span>
      <div className="row">
        <button className="btn primary small" onClick={() => setStart(store.conn.clock.now())}>
          ↺ {L('From the start', 'Von vorn')}
        </button>
        <button className={`chip${view === 'sides' ? ' on' : ''}`} onClick={() => setView('sides')}>
          {L('Its sides', 'Ihre Seiten')}
        </button>
        <button className={`chip${view === 'stage' ? ' on' : ''}`} onClick={() => setView('stage')}>
          {L('Whole stage', 'Ganze Bühne')}
        </button>
      </div>
      <ResPicker res={res} setRes={setRes} L={L} />
      {local && <TestCanvas state={local} rect={rect} res={res} L={L} key={res} />}
      {sc && sc.params.filter((p) => p.type !== 'video').length > 0 && (
        <details className="panel">
          <summary className="small">{L('Settings of the scene', 'Einstellungen der Szene')}</summary>
          <div className="stack">
            {sc.params
              .filter((p) => p.type !== 'video')
              .map((p) => (
                <ParamControl
                  key={p.key}
                  def={p}
                  value={params[p.key]}
                  onChange={(v) => setParams((o) => ({ ...o, [p.key]: v }))}
                  L={L}
                />
              ))}
          </div>
        </details>
      )}
    </section>
  );
}

/** What one projector shows right now – the real show, as on that projector. */
function ProjectorTest({ state, L }: { state: SessionState; L: Tr }) {
  const [outputId, setOutputId] = useState(state.outputs[0]?.id ?? '');
  const [res, setRes] = useState<Res>('window');
  const out = state.outputs.find((o) => o.id === outputId);
  if (!state.outputs.length) return <p className="muted">{L('No projectors yet.', 'Noch keine Beamer.')}</p>;
  const ref = out ? activeProfile(out).referenceResolution : null;
  return (
    <section className="panel stack">
      <div className="row">
        {state.outputs.map((o) => (
          <button
            key={o.id}
            className={`chip${o.id === outputId ? ' on' : ''}`}
            onClick={() => setOutputId(o.id)}
          >
            📽 {o.name}
          </button>
        ))}
      </div>
      {ref && (
        <span className="muted small">
          {L('Projector picture', 'Beamer-Bild')}: {ref.w} × {ref.h}
        </span>
      )}
      <ResPicker res={res} setRes={setRes} L={L} />
      {out && (
        <TestCanvas
          state={state}
          outputId={out.id}
          aspect={ref ? ref.w / ref.h : 16 / 9}
          res={res}
          L={L}
          key={`${out.id}|${res}`}
        />
      )}
    </section>
  );
}

function ResPicker({ res, setRes, L }: { res: Res; setRes: (r: Res) => void; L: Tr }) {
  return (
    <div className="row">
      <span className="small">{L('Render size', 'Rechengröße')}:</span>
      {(
        [
          ['window', L('like the window', 'wie das Fenster')],
          ['1080', 'Full HD (1920)'],
          ['4k', '4K (3840)'],
        ] as const
      ).map(([k, label]) => (
        <button key={k} className={`chip${res === k ? ' on' : ''}`} onClick={() => setRes(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** The engine on this PC, with its numbers (frames per second, size, graphics card, errors). */
function TestCanvas({
  state,
  outputId,
  rect,
  aspect,
  res,
  L,
}: {
  state: SessionState;
  outputId?: string;
  rect?: BBox | null;
  aspect?: number;
  res: Res;
  L: Tr;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const r = useRef<StageRenderer | null>(null);
  const store = useStore();
  const [stats, setStats] = useState<RendererStats | null>(null);
  const [lost, setLost] = useState(0);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // the render size of a real projector: the canvas is drawn that big (shown smaller)
    const want = res === '4k' ? 3840 : res === '1080' ? 1920 : 0;
    const renderer = new StageRenderer({
      canvas,
      catalog,
      loadRuntime: loadThemeRuntime,
      now: () => store.conn.clock.now(),
      preview: !outputId,
      maxPixelRatio: 2,
      ...(want ? { fixedWidth: want, maxRenderPixels: want * Math.round(want / (aspect ?? 16 / 9)) } : {}),
    });
    r.current = renderer;
    renderer.setGhostImages(ghostImagesFor(store.conn).get);
    renderer.setVideos(showVideosFor(store.conn).url);
    renderer.start();
    const onLost = () => setLost((n) => n + 1);
    canvas.addEventListener('webglcontextlost', onLost);
    const t = window.setInterval(() => setStats(renderer.stats()), 500);
    return () => {
      window.clearInterval(t);
      canvas.removeEventListener('webglcontextlost', onLost);
      renderer.dispose();
      r.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputId, res]);
  useEffect(() => {
    r.current?.setState(state, outputId ?? null);
    showVideosFor(store.conn).sync((state.videos ?? []).map((v) => v.id));
  }, [state, outputId, store.conn]);
  const rectKey = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : '';
  useEffect(() => {
    const rr = r.current;
    if (!rr || outputId) return;
    if (!rect) return rr.setPreviewViewport(null);
    const m = Math.min(rect.w, rect.h) * 0.02;
    rr.setPreviewViewport({ x: rect.x - m, y: rect.y - m, w: rect.w + 2 * m, h: rect.h + 2 * m });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rectKey, outputId]);
  let ar = aspect ?? 16 / 9;
  if (!outputId) {
    if (rect) ar = rect.w / rect.h;
    else if (state.surfaces.length) {
      const b = stageBounds(completeRoom(state.surfaces));
      ar = Math.min(2.4, Math.max(0.6, b.w / b.h));
    }
  }
  const full = () => void ref.current?.requestFullscreen?.().catch(() => undefined);
  const bad = lost > 0 || !!stats?.contextLost || !!stats?.lastError;
  return (
    <div className="stack" style={{ gap: '0.4rem' }}>
      <canvas
        ref={ref}
        className="preview-canvas"
        style={{ aspectRatio: String(ar), width: '100%', background: '#000' }}
        onDoubleClick={full}
      />
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="small" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {stats
            ? `${stats.fps} fps · ${stats.renderW}×${stats.renderH} · ${L('quality', 'Qualität')} ${Math.round(stats.quality * 100)} %`
            : '…'}
        </span>
        <button className="btn small" onClick={full}>
          ⛶ {L('Full screen', 'Vollbild')}
        </button>
      </div>
      {stats?.gpu && <span className="muted small">{stats.gpu}</span>}
      {bad && (
        <div className="safety-note small">
          {lost > 0 || stats?.contextLost
            ? L(
                `Graphics card overloaded (picture lost ${lost}×) – this scene is too heavy here.`,
                `Grafikkarte überlastet (Bild ${lost}× verloren) – diese Szene ist hier zu schwer.`,
              )
            : `${L('Error', 'Fehler')}: ${stats?.lastError}`}
        </div>
      )}
    </div>
  );
}
