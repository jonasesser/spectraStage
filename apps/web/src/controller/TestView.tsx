import { useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { SoundEngine, StageRenderer, type RendererStats, type SoundApi } from '@spectrastage/engine';
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
import { storage } from '../lib/storage.ts';
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
  const [mode, setMode] = useState<'scene' | 'projector' | 'sounds'>('scene');
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
          <button className={`chip${mode === 'sounds' ? ' on' : ''}`} onClick={() => setMode('sounds')}>
            🔊 {L('All sounds', 'Alle Klänge')}
          </button>
        </div>
      </section>
      {state &&
        (mode === 'scene' ? (
          <SceneTest state={state} L={L} />
        ) : mode === 'projector' ? (
          <ProjectorTest state={state} L={L} />
        ) : (
          <SoundBoard L={L} />
        ))}
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
  // uploaded videos (Kling …) are played by the theme's video scene: "video:<id>" in the list
  const player = theme.scenes.find((s) => s.params.some((p) => p.type === 'video'));
  const videoId = sceneId.startsWith('video:') ? sceneId.slice(6) : null;
  const sc: SceneManifest | undefined = videoId ? player : theme.scenes.find((s) => s.id === sceneId);
  const [params, setParams] = useState<ParamValues>(() => (sc ? sanitizeParams(sc.params, {}) : {}));
  const [start, setStart] = useState(() => store.conn.clock.now());
  const [view, setView] = useState<'sides' | 'stage'>('sides');
  const [res, setRes] = useState<Res>('window');
  // nothing runs until started (a scene that overloads the graphics card must not start by itself)
  const [run, setRun] = useState(false);
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
        scene: {
          themeId: theme.id,
          sceneId: sc.id,
          params: videoId ? { ...params, video: videoId } : params,
        },
        seed: 4242,
        startedAt: start,
        transition: { type: 'cut', durationMs: 0 },
      };
    }
    next.blackoutAll = false;
    next.cues = [];
    return next;
  }, [state, sc, theme.id, params, start, targetKey, videoId]);
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
            const n = id.startsWith('video:') ? player : theme.scenes.find((s) => s.id === id);
            setParams(n ? sanitizeParams(n.params, {}) : {});
            setStart(store.conn.clock.now());
          }}
        >
          {player &&
            (state.videos ?? []).map((v) => (
              <option key={v.id} value={`video:${v.id}`}>
                🎥 {v.name} · {L('video', 'Video')} ({Math.round(v.sec)} s)
              </option>
            ))}
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
      <RunButton run={run} setRun={setRun} L={L} />
      {run && local && (
        <TestCanvas
          state={local}
          rect={rect}
          res={res}
          L={L}
          key={res}
          soundSurface={targets[0]?.id ?? null}
        />
      )}
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
  const [run, setRun] = useState(false);
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
      <RunButton run={run} setRun={setRun} L={L} />
      {run && out && (
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

/** One sound engine for the test area (unlocked by the start / play buttons – browsers need a click). */
let testSound: SoundEngine | null = null;
function sound(): SoundEngine {
  testSound ??= new SoundEngine();
  testSound.unlock();
  return testSound;
}

function RunButton({ run, setRun, L }: { run: boolean; setRun: (v: boolean) => void; L: Tr }) {
  return (
    <button
      className={`btn${run ? '' : ' primary'}`}
      onClick={() => {
        sound();
        setRun(!run);
      }}
    >
      {run ? `⏹ ${L('Stop', 'Stoppen')}` : `▶ ${L('Start', 'Starten')}`}
    </button>
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
  soundSurface = null,
}: {
  soundSurface?: string | null;
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
      // with sound: the scene's own sounds (one side plays them) / the projector's sounds
      sound: sound(),
      ...(soundSurface ? { previewSound: soundSurface } : {}),
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
      <span className="muted small">{gpuName(ref.current) ?? stats?.gpu ?? ''}</span>
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

/** The graphics card as the browser names it (ANGLE string: shows Direct3D / OpenGL and the card). */
function gpuName(c: HTMLCanvasElement | null): string | null {
  if (!c) return null;
  try {
    const gl = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// All sounds, one by one – to find the ones that get on your nerves
// ---------------------------------------------------------------------------
interface SoundItem {
  id: string;
  group: string;
  name: string;
  play: (s: SoundApi) => (() => void) | void;
}

const BASICS = (L: Tr): SoundItem[] => [
  {
    id: 'b:whoosh',
    group: L('Building blocks', 'Bausteine'),
    name: L('Whoosh', 'Wusch'),
    play: (s) => s.whoosh(),
  },
  {
    id: 'b:ooh',
    group: L('Building blocks', 'Bausteine'),
    name: L('Ghostly ooh', 'Geister-Uuuh'),
    play: (s) => s.ooh(),
  },
  {
    id: 'b:chime',
    group: L('Building blocks', 'Bausteine'),
    name: L('Chime', 'Glöckchen'),
    play: (s) => s.chime(),
  },
  {
    id: 'b:knock',
    group: L('Building blocks', 'Bausteine'),
    name: L('Knocking', 'Klopfen'),
    play: (s) => s.knock(),
  },
  {
    id: 'b:rumble',
    group: L('Building blocks', 'Bausteine'),
    name: L('Rumble', 'Grollen'),
    play: (s) => s.rumble(),
  },
  { id: 'b:pop', group: L('Building blocks', 'Bausteine'), name: L('Pop', 'Plopp'), play: (s) => s.pop() },
  {
    id: 'b:flutter',
    group: L('Building blocks', 'Bausteine'),
    name: L('Wings', 'Flügelschlag'),
    play: (s) => s.flutter(),
  },
  {
    id: 'b:scuttle',
    group: L('Building blocks', 'Bausteine'),
    name: L('Scuttle', 'Krabbeln'),
    play: (s) => s.scuttle(),
  },
  {
    id: 'b:arpeggio',
    group: L('Building blocks', 'Bausteine'),
    name: L('Melody', 'Melodie'),
    play: (s) => s.arpeggio(),
  },
  {
    id: 'b:wind',
    group: L('Background', 'Hintergrund'),
    name: L('Wind', 'Wind'),
    play: (s) => s.ambience('wind', 0.05),
  },
  {
    id: 'b:drone',
    group: L('Background', 'Hintergrund'),
    name: L('Drone', 'Brummen'),
    play: (s) => s.ambience('drone', 0.05),
  },
  {
    id: 'b:crickets',
    group: L('Background', 'Hintergrund'),
    name: L('Crickets', 'Grillen'),
    play: (s) => s.ambience('crickets', 0.05),
  },
];

function SoundBoard({ L }: { L: Tr }) {
  const [items, setItems] = useState<SoundItem[]>(() => BASICS(L));
  const [bad, setBad] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(storage.get('ss.test.badSounds') ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const [playing, setPlaying] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    let alive = true;
    // effects and creatures of every theme bring their own sounds
    void Promise.all(
      catalog.themes.map(async (t) => {
        const rt = await loadThemeRuntime(t.id).catch(() => null);
        if (!rt) return [];
        const out: SoundItem[] = [];
        for (const e of t.effects) {
          const m = rt.effects[e.id];
          if (m?.sound)
            out.push({
              id: `e:${t.id}/${e.id}`,
              group: `${t.icon} ${L('Effects', 'Effekte')}`,
              name: `${e.icon} ${L.text(e.name)}`,
              play: (s) => m.sound!(s, 7),
            });
        }
        for (const a of t.actors) {
          const m = rt.actors[a.id];
          if (m?.sound)
            out.push({
              id: `a:${t.id}/${a.id}`,
              group: `${t.icon} ${L('Creatures', 'Kreaturen')}`,
              name: `${a.icon ?? ''} ${L.text(a.name)}`,
              play: (s) => m.sound!(s, 7),
            });
        }
        return out;
      }),
    ).then((lists) => alive && setItems([...BASICS(L), ...lists.flat()]));
    return () => {
      alive = false;
      stopRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const play = (it: SoundItem) => {
    stopRef.current?.();
    stopRef.current = null;
    const s = sound();
    const stop = it.play(s);
    if (typeof stop === 'function') {
      stopRef.current = stop;
      setPlaying(it.id);
    } else setPlaying(null);
  };
  const toggleBad = (id: string) => {
    const n = new Set(bad);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setBad(n);
    storage.set('ss.test.badSounds', JSON.stringify([...n]));
  };
  const groups = [...new Set(items.map((i) => i.group))];
  const list = items.filter((i) => bad.has(i.id)).map((i) => `${i.group} – ${i.name} (${i.id})`);
  return (
    <section className="panel stack">
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'Every sound on its own. Mark the annoying ones with 👎 and send the list – the scene sounds play in “Try a scene” with the scene.',
          'Jeder Klang einzeln. Nervige mit 👎 markieren und die Liste schicken – die Klänge der Szenen hörst du unter „Szene ausprobieren“ mit der Szene.',
        )}
      </p>
      {playing && (
        <button
          className="btn small"
          onClick={() => {
            stopRef.current?.();
            stopRef.current = null;
            setPlaying(null);
          }}
        >
          ⏹ {L('Stop the background sound', 'Hintergrund-Klang stoppen')}
        </button>
      )}
      {groups.map((g) => (
        <div key={g} className="stack" style={{ gap: '0.3rem' }}>
          <strong className="small">{g}</strong>
          {items
            .filter((i) => i.group === g)
            .map((i) => (
              <div key={i.id} className="row" style={{ alignItems: 'center' }}>
                <button className="btn small" onClick={() => play(i)}>
                  ▶
                </button>
                <span className="small" style={{ flex: 1 }}>
                  {i.name}
                </span>
                <button
                  className={`chip${bad.has(i.id) ? ' on' : ''}`}
                  onClick={() => toggleBad(i.id)}
                  aria-pressed={bad.has(i.id)}
                >
                  👎 {L('annoying', 'nervt')}
                </button>
              </div>
            ))}
        </div>
      ))}
      {list.length > 0 && (
        <div className="stack" style={{ gap: '0.3rem' }}>
          <strong className="small">{L('Marked as annoying', 'Als nervig markiert')}</strong>
          <pre className="small" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {list.join('\n')}
          </pre>
          <button
            className="btn small"
            onClick={() => void navigator.clipboard?.writeText(list.join('\n')).catch(() => undefined)}
          >
            {L('Copy the list', 'Liste kopieren')}
          </button>
        </div>
      )}
    </section>
  );
}
