import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { StageRenderer, SoundEngine } from '@spectrastage/engine';
import { catalog } from '@spectrastage/catalog/manifests';
import { loadThemeRuntime } from '@spectrastage/catalog/runtime';
import { formatCode, normalizeCode, type SessionState } from '@spectrastage/shared';
import { Connection, type ConnStatus } from '../lib/connection.ts';
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
      onPreview: (_outputId, profile) => rendererRef.current?.setPreviewProfile(profile),
    });
    connRef.current = conn;
    conn.start();
    return () => conn.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot]);

  // Renderer
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new StageRenderer({
      canvas: canvasRef.current,
      catalog,
      loadRuntime: loadThemeRuntime,
      now: () => connRef.current?.clock.now() ?? Date.now(),
      sound: soundRef.current,
      // Projector pixels are physical pixels; never render above 1:1.
      maxPixelRatio: 1,
    });
    rendererRef.current = r;
    r.start();
    // Read-only diagnostics hook (used by end-to-end tests and support).
    (window as unknown as { __spectrastage?: unknown }).__spectrastage = { stats: () => r.stats() };
    return () => {
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  const outputId =
    state && deviceId ? (state.devices.find((d) => d.id === deviceId)?.outputId ?? null) : null;
  const output = state && outputId ? state.outputs.find((o) => o.id === outputId) : undefined;

  useEffect(() => {
    rendererRef.current?.setState(phase === 'run' ? state : null, outputId);
    if (state) soundRef.current.setVolume(state.masterVolume * (output?.volume ?? 0.8), state.muted);
  }, [state, outputId, output?.volume, phase]);

  useEffect(() => {
    rendererRef.current?.setConnection(status === 'online');
  }, [status]);

  // Remember the device id across offline reloads.
  useEffect(() => {
    if (!deviceId && state && phase === 'run') {
      const cachedId = storage.get(`${KEYS.displayToken(slot)}.id`);
      if (cachedId) setDeviceId(cachedId);
    }
    if (deviceId) storage.set(`${KEYS.displayToken(slot)}.id`, deviceId);
  }, [deviceId, state, phase, slot]);

  // Telemetry every 5 s
  useEffect(() => {
    const id = window.setInterval(() => {
      const conn = connRef.current;
      const r = rendererRef.current;
      if (!conn || !r || phaseRef.current !== 'run') return;
      const st = r.stats();
      const cs = conn.clock.stats();
      const dpr = window.devicePixelRatio || 1;
      conn.sendTelemetry({
        fps: st.fps,
        quality: st.quality,
        width: Math.round(screen.width * dpr),
        height: Math.round(screen.height * dpr),
        version: VERSION,
        localBlackout: r.localBlackoutOn,
        audioUnlocked: soundRef.current.unlocked,
        fullscreen: !!document.fullscreenElement,
        rttMs: Math.round(cs.rttMs),
        jitterMs: Math.round(cs.jitterMs),
        clockOffsetMs: Math.round(cs.offsetMs),
        calibrationOk: st.calibrationOk,
      });
      if (showInfo) force((n) => n + 1);
    }, 5000);
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
      <canvas ref={canvasRef} className="projection-canvas" />
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
          {L(
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
          <div className="muted">
            B = {L('local blackout', 'lokaler Blackout')} · F = {L('fullscreen', 'Vollbild')} · I = Info
          </div>
        </div>
      )}
    </div>
  );
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
