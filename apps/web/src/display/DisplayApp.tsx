import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { StageRenderer, SoundEngine } from '@spectrastage/engine';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { formatCode, normalizeCode, soundChoicesOf, type SessionState } from '@spectrastage/shared';
import { Connection, type ConnStatus } from '../lib/connection.ts';
import { ZombieReceiver } from './zombie.ts';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { showVideosFor, soundFetcher } from '../lib/videos.ts';
import type { ApiError } from '../lib/api.ts';
import { api } from '../lib/api.ts';
import { KEYS, storage } from '../lib/storage.ts';
import { useT } from '../lib/i18n.tsx';

const VERSION = '1.0.0';

type Phase = 'pair' | 'pending' | 'run';

function slotFromUrl(): string {
  const s = new URLSearchParams(location.search).get('slot') ?? '1';
  return /^[a-zA-Z0-9_-]{1,16}$/.test(s) ? s : '1';
}

export default function DisplayApp() {
  const slot = slotFromUrl();
  const [phase, setPhase] = useState<Phase>(() =>
    storage.get(KEYS.displayToken(slot))
      ? 'run'
      : storage.get(KEYS.displayPending(slot))
        ? 'pending'
        : 'pair',
  );
  const [notice, setNotice] = useState<string | null>(null);

  const reset = useCallback(
    (msg: string | null) => {
      storage.remove(KEYS.displayToken(slot));
      storage.remove(KEYS.displayPending(slot));
      storage.remove(KEYS.displaySnapshot(slot));
      setNotice(msg);
      setPhase('pair');
    },
    [slot],
  );

  if (phase === 'pair') return <PairForm slot={slot} notice={notice} onPaired={() => setPhase('pending')} />;
  return <Projection slot={slot} phase={phase} onApproved={() => setPhase('run')} onReset={reset} />;
}

function PairForm({ slot, notice, onPaired }: { slot: string; notice: string | null; onPaired: () => void }) {
  const L = useT();
  const [code, setCode] = useState('');
  const [name, setName] = useState(() => storage.get(KEYS.displayName(slot)) ?? '');
  const [error, setError] = useState<string | null>(notice);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length !== 8) {
      setError(L('The code has 8 characters.', 'Der Code hat 8 Zeichen.'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ pendingToken: string; deviceId: string }>('POST', '/api/pair', {
        code: c,
        name: name.trim() || 'Beamer',
      });
      storage.set(KEYS.displayPending(slot), res.pendingToken);
      storage.set(KEYS.displayName(slot), name.trim() || 'Beamer');
      onPaired();
    } catch (err) {
      const e2 = err as ApiError;
      setError(
        e2.status === 404
          ? L(
              'Code unknown or expired. Check the code on the phone.',
              'Code unbekannt oder abgelaufen. Prüfe den Code am Handy.',
            )
          : e2.status === 429
            ? L(
                'Too many attempts. Please wait a few minutes.',
                'Zu viele Versuche. Bitte ein paar Minuten warten.',
              )
            : e2.message,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="display-pair">
      <form className="pair-card" onSubmit={submit}>
        <h1>{L('Connect this projector', 'Diesen Beamer verbinden')}</h1>
        <p className="muted">
          {L(
            'Enter the pairing code shown on the show phone. The phone has to confirm this device afterwards.',
            'Gib den Pairing-Code vom Show-Handy ein. Das Handy muss das Gerät danach bestätigen.',
          )}
        </p>
        <label>
          {L('Pairing code', 'Pairing-Code')}
          <input
            className="code-input"
            value={code}
            onChange={(e) => setCode(formatCode(normalizeCode(e.target.value).slice(0, 8)))}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode="text"
            autoFocus
          />
        </label>
        <label>
          {L('Name of this projector', 'Name dieses Beamers')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            placeholder={L('e.g. Garage', 'z. B. Garage')}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary big" disabled={busy}>
          {busy ? L('Connecting…', 'Verbinde…') : L('Request connection', 'Verbindung anfragen')}
        </button>
        {slot !== '1' && <p className="muted small">Slot {slot}</p>}
      </form>
    </main>
  );
}

function Projection({
  slot,
  phase,
  onApproved,
  onReset,
}: {
  slot: string;
  phase: Phase;
  onApproved: () => void;
  onReset: (msg: string | null) => void;
}) {
  const L = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<ConnStatus>('connecting');
  const [state, setState] = useState<SessionState | null>(() =>
    storage.getJson<SessionState>(KEYS.displaySnapshot(slot)),
  );
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [hint, setHint] = useState(true);
  const [localBlackout, setLocalBlackout] = useState(false);
  const [cursorHidden, setCursorHidden] = useState(false);
  const connRef = useRef<Connection | null>(null);
  const rendererRef = useRef<StageRenderer | null>(null);
  const soundRef = useRef<SoundEngine>(new SoundEngine());
  const [, force] = useState(0);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  // Connection
  useEffect(() => {
    const token = storage.get(KEYS.displayToken(slot)) ?? storage.get(KEYS.displayPending(slot));
    if (!token) {
      onReset(null);
      return;
    }
    let lastSave = 0;
    const conn = new Connection(token, {
      onStatus: setStatus,
      onWelcome: (m) => setDeviceId(m.subjectId),
      onSnapshot: (s) => {
        setState(s);
        const now = Date.now();
        if (now - lastSave > 3000) {
          lastSave = now;
          storage.setJson(KEYS.displaySnapshot(slot), s);
        }
      },
      onApproved: (deviceToken, id) => {
        storage.set(KEYS.displayToken(slot), deviceToken);
        storage.remove(KEYS.displayPending(slot));
        setDeviceId(id);
        onApproved();
      },
      onRejected: () =>
        onReset(L('The phone declined this device.', 'Das Handy hat dieses Gerät abgelehnt.')),
      onAuthError: (code) =>
        onReset(
          code === 'session_deleted'
            ? L('The show was deleted.', 'Die Show wurde gelöscht.')
            : L(
                'This device was removed from the show. Pair it again.',
                'Dieses Gerät wurde aus der Show entfernt. Bitte neu verbinden.',
              ),
        ),
      onIdentify: (label, until) => rendererRef.current?.showIdentify(label, until),
      onPreview: (_outputId, profile, focus) => rendererRef.current?.setPreviewProfile(profile, focus),
    });
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  const outputId =
    state && deviceId ? (state.devices.find((d) => d.id === deviceId)?.outputId ?? null) : null;
  const output = state && outputId ? state.outputs.find((o) => o.id === outputId) : undefined;
  const renderMode = output?.renderMode ?? 'standard';
  const rendererModeRef = useRef(renderMode);
  rendererModeRef.current = renderMode;
  const stateRef = useRef(state);
  stateRef.current = state;
  const outputIdRef = useRef(outputId);
  outputIdRef.current = outputId;

  // Renderer
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new StageRenderer({
      canvas: canvasRef.current,
      catalog,
      loadRuntime: loadThemeRuntime,
      now: () => connRef.current?.clock.now() ?? Date.now(),
      sound: soundRef.current,
      // Render in physical projector pixels (Windows scaling 150 % on a 4K beamer = 3840 px).
      maxPixelRatio: 4,
      // Full HD modes, or after a GPU crash (context lost) this tab runs in a safe Full HD mode.
      maxRenderPixels:
        gpuSafe() || renderMode === 'fullhd' || renderMode === 'lowpower' ? 1920 * 1200 : undefined,
      powerPreference: renderMode === 'lowpower' ? 'low-power' : 'high-performance',
    });
    // GPU context lost and not restored (e.g. overloaded at 4K): reload in safe mode instead of
    // staying black.
    let lostTimer = 0;
    const canvas = canvasRef.current;
    const onLost = () => {
      lostTimer = window.setTimeout(() => {
        try {
          sessionStorage.setItem('ss-gpu-safe', '1');
        } catch {
          /* ignore */
        }
        location.reload();
      }, 3000);
    };
    const onRestored = () => window.clearTimeout(lostTimer);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    rendererRef.current = r;
    r.setState(phaseRef.current === 'run' ? stateRef.current : null, outputIdRef.current);
    r.start();
    // Read-only diagnostics hook (used by end-to-end tests and support).
    (window as unknown as { __spectrastage?: unknown }).__spectrastage = {
      stats: () => r.stats(),
      capture: (w: number) => r.capture(w, false),
    };
    return () => {
      window.clearTimeout(lostTimer);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      r.dispose();
      rendererRef.current = null;
    };
    // A new mode needs a fresh canvas (a WebGL context keeps its GPU choice).
  }, [renderMode]);

  // Zombie camera: a phone may stream its camera here; people become ghosts on the main wall
  useEffect(() => {
    const c = connRef.current;
    const r = rendererRef.current;
    if (!c || !r) return;
    const z = new ZombieReceiver(c, r);
    r.setGhostImages(ghostImagesFor(c).get);
    r.setVideos(showVideosFor(c).url);
    return () => {
      r.setGhostImages(null);
      r.setVideos(null);
      z.dispose();
    };
  }, [slot, renderMode]);

  useEffect(() => {
    rendererRef.current?.setState(phase === 'run' ? state : null, outputId);
    // the show's videos are loaded ahead on every projector PC
    const c = connRef.current;
    if (c && state) showVideosFor(c).sync((state.videos ?? []).map((v) => v.id));
    if (state) soundRef.current.setVolume(state.masterVolume * (output?.volume ?? 0.8), state.muted);
  }, [state, outputId, output?.volume, phase]);

  // replaced / switched-off sounds of the show
  const soundChoices = state?.soundChoices;
  useEffect(() => {
    soundRef.current.setChoices(soundChoicesOf(soundChoices ?? {}), soundFetcher(connRef.current));
  }, [soundChoices]);

  useEffect(() => {
    rendererRef.current?.setConnection(status === 'online');
  }, [status, renderMode]);

  // Remember the device id across offline reloads.
  useEffect(() => {
    if (!deviceId && state && phase === 'run') {
      const cachedId = storage.get(`${KEYS.displayToken(slot)}.id`);
      if (cachedId) setDeviceId(cachedId);
    }
    if (deviceId) storage.set(`${KEYS.displayToken(slot)}.id`, deviceId);
  }, [deviceId, state, phase, slot]);

  // Telemetry every 5 s (every 2 s with a live picture while the admin watches the diagnosis)
  const diagRef = useRef(0);
  diagRef.current = output?.diagUntil ?? 0;
  useEffect(() => {
    let last = 0;
    let busy = false;
    let lastLum = -1;
    let lastThumb: string | undefined;
    const id = window.setInterval(async () => {
      const conn = connRef.current;
      const r = rendererRef.current;
      if (!conn || !r || phaseRef.current !== 'run' || busy) return;
      const diag = diagRef.current > (conn.clock.now() ?? Date.now());
      const wall = Date.now();
      if (wall - last < (diag ? 2000 : 5000) - 100) return;
      last = wall;
      busy = true;
      const shot = await Promise.race([
        r.capture(diag ? 480 : 64, diag),
        new Promise<{ lum: number; image?: string }>((res) => setTimeout(() => res({ lum: -1 }), 3000)),
      ]);
      busy = false;
      if (shot.lum >= 0) lastLum = shot.lum;
      if (shot.image) lastThumb = shot.image;
      if (!diag) lastThumb = undefined;
      const st = r.stats();
      const cs = conn.clock.stats();
      const dpr = window.devicePixelRatio || 1;
      conn.sendTelemetry({
        fps: st.fps,
        quality: st.quality,
        ...screenResolution(dpr),
        version: VERSION,
        localBlackout: r.localBlackoutOn,
        audioUnlocked: soundRef.current.unlocked,
        fullscreen: !!document.fullscreenElement,
        rttMs: Math.round(cs.rttMs),
        jitterMs: Math.round(cs.jitterMs),
        clockOffsetMs: Math.round(cs.offsetMs),
        calibrationOk: st.calibrationOk,
        gpu: st.gpu.slice(0, 200),
        dpr,
        winW: Math.round(window.innerWidth * dpr),
        winH: Math.round(window.innerHeight * dpr),
        renderW: st.renderW,
        renderH: st.renderH,
        contextLost: st.contextLost,
        lastError: st.lastError,
        renderMode: rendererModeRef.current,
        lum: lastLum >= 0 ? Math.min(1, lastLum) : undefined,
        blackReason: st.blackReason,
        thumb: lastThumb && lastThumb.length < 150_000 ? lastThumb : undefined,
      });
      if (showInfo || st.contextLost || st.lastError) force((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [showInfo]);

  // User gesture: fullscreen, audio, wake lock
  const activate = useCallback(() => {
    soundRef.current.unlock();
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    requestWakeLock();
    setHint(false);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'b') {
        const on = !rendererRef.current?.localBlackoutOn;
        rendererRef.current?.setLocalBlackout(on);
        setLocalBlackout(on);
      } else if (k === 'f') activate();
      else if (k === 'i') setShowInfo((v) => !v);
      soundRef.current.unlock();
    };
    const onVis = () => document.visibilityState === 'visible' && requestWakeLock();
    window.addEventListener('keydown', onKey);
    document.addEventListener('visibilitychange', onVis);
    const t = window.setTimeout(() => setHint(false), 20_000);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVis);
      window.clearTimeout(t);
    };
  }, [activate]);

  // Hide cursor when idle
  useEffect(() => {
    let t = 0;
    const move = () => {
      setCursorHidden(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setCursorHidden(true), 2000);
    };
    move();
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      window.clearTimeout(t);
    };
  }, []);

  const conn = connRef.current;
  const stats = rendererRef.current?.stats();
  const cs = conn?.clock.stats();
  const deviceName = storage.get(KEYS.displayName(slot)) ?? '';

  return (
    <div
      className={`projection${cursorHidden ? ' no-cursor' : ''}`}
      onClick={activate}
      onDoubleClick={activate}
    >
      <canvas
        key={renderMode}
        ref={canvasRef}
        className={`projection-canvas${renderMode === 'compat' ? ' compat' : ''}`}
      />
      {phase === 'run' && stats && (stats.contextLost || stats.lastError || output?.resolutionMismatch) && (
        <div className="projection-problem">
          {stats.contextLost
            ? L('Graphics card overloaded – restarting…', 'Grafikkarte überlastet – starte neu …')
            : output?.resolutionMismatch
              ? L(
                  'Picture format changed – confirm it in the app (Projectors).',
                  'Bildformat geändert – in der App unter „Beamer“ bestätigen.',
                )
              : `${L('Render problem', 'Darstellungsproblem')}: ${stats.lastError}`}
        </div>
      )}
      {phase === 'pending' && (
        <div className="projection-center">
          <div className="pending-card">
            <div className="pulse-dot" />
            <h1>{L('Waiting for approval', 'Warte auf Freigabe')}</h1>
            <p>
              {L('Confirm', 'Bestätige')} <strong>{deviceName}</strong>{' '}
              {L('on the show phone.', 'am Show-Handy.')}
            </p>
            <p className="muted small">
              {status === 'online'
                ? L('Connected to server', 'Mit Server verbunden')
                : L('Connecting…', 'Verbinde…')}
            </p>
          </div>
        </div>
      )}
      {phase === 'run' && state && !outputId && (
        <div className="projection-center dim">
          <p>
            {deviceName}:{' '}
            {L(
              'connected – waiting for an output assignment on the phone.',
              'verbunden – wartet auf Zuordnung am Handy.',
            )}
          </p>
        </div>
      )}
      {phase === 'run' && !state && (
        <div className="projection-center dim">
          <p>
            {status === 'online'
              ? L('Loading show…', 'Lade Show…')
              : L('Connecting to server…', 'Verbinde mit Server…')}
          </p>
        </div>
      )}
      {hint && phase === 'run' && (
        <div className="projection-hint">
          {needsHomeScreenForFullscreen()
            ? L(
                'iPhone/iPad: Share → “Add to Home Screen”, then open it from there for fullscreen · tap once for sound',
                'iPhone/iPad: Teilen → „Zum Home-Bildschirm“, dann von dort öffnen = Vollbild · einmal tippen für Ton',
              )
            : L(
                'Click once for fullscreen and sound · B = blackout · I = info',
                'Einmal klicken für Vollbild und Ton · B = Blackout · I = Info',
              )}
        </div>
      )}
      {localBlackout && showInfo && (
        <div className="projection-badge">{L('Local blackout (B)', 'Lokaler Blackout (B)')}</div>
      )}
      {showInfo && (
        <div className="projection-info">
          <div>
            <b>SpectraStage</b> {VERSION} · {deviceName}
          </div>
          <div>
            {L('Server', 'Server')}: {status} · RTT {cs ? Math.round(cs.rttMs) : '–'} ms · Jitter{' '}
            {cs ? Math.round(cs.jitterMs) : '–'} ms
          </div>
          <div>
            {L('Output', 'Ausgang')}: {output?.name ?? '–'} · {stats?.width}×{stats?.height} · {stats?.fps}{' '}
            fps · Q {stats?.quality.toFixed(2)}
          </div>
          <div>
            {L('Calibration', 'Kalibrierung')}:{' '}
            {stats?.calibrationOk ? 'OK' : L('invalid → black', 'ungültig → schwarz')} ·{' '}
            {L('Blackout', 'Blackout')}: {stats?.blackout ? L('yes', 'ja') : L('no', 'nein')}
          </div>
          <div>
            {L('Screen', 'Bildschirm')}: {screen.width}×{screen.height} @ {window.devicePixelRatio} ·{' '}
            {L('Window', 'Fenster')}: {window.innerWidth}×{window.innerHeight} · {L('Format', 'Format')}:{' '}
            {output?.resolutionMismatch ? L('changed → black', 'geändert → schwarz') : 'OK'}
          </div>
          <div>
            {L('Mode', 'Modus')}: {renderMode} · GPU: {stats?.gpu}{' '}
            {stats?.contextLost ? '· CONTEXT LOST' : ''}
            {stats?.lastError ? ` · ${stats.lastError}` : ''}
          </div>
          <div className="muted">
            B = {L('local blackout', 'lokaler Blackout')} · F = {L('fullscreen', 'Vollbild')} · I = Info
          </div>
        </div>
      )}
    </div>
  );
}

function gpuSafe(): boolean {
  try {
    return sessionStorage.getItem('ss-gpu-safe') === '1';
  } catch {
    return false;
  }
}

/** Physical screen size in the current orientation (iOS reports portrait dimensions even in landscape). */
function screenResolution(dpr: number): { width: number; height: number } {
  let w = screen.width;
  let h = screen.height;
  if (window.innerWidth > window.innerHeight !== w > h) [w, h] = [h, w];
  return { width: Math.round(w * dpr), height: Math.round(h * dpr) };
}

/** iPhone/iPad Safari cannot make a web page fullscreen – only a home-screen web app can. */
export function needsHomeScreenForFullscreen(): boolean {
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  return ios && !standalone;
}

let wakeLock: { release: () => Promise<void> } | null = null;
function requestWakeLock(): void {
  const nav = navigator as Navigator & {
    wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> };
  };
  if (!nav.wakeLock || wakeLock) return;
  nav.wakeLock
    .request('screen')
    .then((l) => {
      wakeLock = l;
      (l as unknown as EventTarget).addEventListener?.('release', () => (wakeLock = null));
    })
    .catch(() => {});
}
