import { useEffect, useState } from 'react';
import {
  activeProfile,
  bboxIntersects,
  polygonBBox,
  formatCode,
  type Device,
  type Output,
  type SessionState,
  type Telemetry,
} from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { api } from '../lib/api.ts';
import { useShow, useStore } from './store.ts';
import { Light, outputHealth, Sheet, Slider, kindLabel } from './ui.tsx';
import { CalibrationEditor } from './CalibrationEditor.tsx';
import { MeasureWizard } from './MeasureWizard.tsx';
import { StagePreview } from './Preview.tsx';

export function OutputsView() {
  const L = useT();
  const { state, presence, role } = useShow();
  const [calibrate, setCalibrate] = useState<string | null>(null);
  const pending = state.devices.filter((d) => d.status === 'pending');
  const out = calibrate ? state.outputs.find((o) => o.id === calibrate) : undefined;
  const [flat, setFlat] = useState(false);
  // projectors in the 3D room are measured against the real room (guided); the flat 2D
  // calibration stays available for fine corrections
  if (out && activeProfile(out).pose && !flat)
    return (
      <div className="stack">
        <MeasureWizard output={out} state={state} L={L} onDone={() => setCalibrate(null)} />
        <button className="btn small ghost" onClick={() => setFlat(true)}>
          {L('Flat 2D corner correction (experts)', 'Flache 2D-Eckkorrektur (Experten)')}
        </button>
      </div>
    );
  if (out)
    return (
      <CalibrationEditor
        output={out}
        onClose={() => {
          setCalibrate(null);
          setFlat(false);
        }}
      />
    );
  return (
    <div className="stack">
      {pending.length > 0 && (
        <section className="panel" style={{ borderColor: 'var(--warn)' }}>
          <h2>{L('Waiting for approval', 'Wartet auf Freigabe')}</h2>
          <div className="list">
            {pending.map((d) => (
              <PendingDevice
                key={d.id}
                device={d}
                state={state}
                owner={role === 'owner'}
                online={!!presence.devices[d.id]?.online}
                L={L}
              />
            ))}
          </div>
        </section>
      )}
      <PairingPanel L={L} />
      <section className="stack">
        {state.outputs.length === 0 && (
          <div className="panel">
            <p className="muted" style={{ margin: 0 }}>
              {L(
                'No projectors yet. Connect one with the pairing code above.',
                'Noch keine Beamer. Verbinde einen mit dem Pairing-Code oben.',
              )}
            </p>
          </div>
        )}
        {state.outputs.map((o) => (
          <OutputCard key={o.id} output={o} state={state} L={L} onCalibrate={() => setCalibrate(o.id)} />
        ))}
      </section>
      <DevicesPanel state={state} L={L} />
    </div>
  );
}

function PairingPanel({ L }: { L: Tr }) {
  const store = useStore();
  const { secrets } = useShow();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const code = secrets?.pairingCode;
  const left = secrets?.pairingExpiresAt ? Math.max(0, secrets.pairingExpiresAt - now) : 0;
  const regenerate = async () => {
    try {
      await api('POST', '/api/pairing-code', {}, store.token);
    } catch (e) {
      store.toast((e as Error).message, 'error');
    }
  };
  return (
    <section className="panel">
      <div className="section-title">
        <h2>{L('Connect a projector PC', 'Beamer-PC verbinden')}</h2>
      </div>
      <ol className="muted small" style={{ paddingLeft: '1.2rem', marginTop: 0 }}>
        <li>
          {L('On the projector PC open', 'Am Beamer-PC öffnen:')}{' '}
          <b style={{ color: 'var(--ink)' }}>{location.host}/display</b>
        </li>
        <li>
          {L(
            'Enter this code and a name, e.g. “Garage”.',
            'Diesen Code und einen Namen eingeben, z. B. „Garage“.',
          )}
        </li>
        <li>{L('Confirm the device here.', 'Das Gerät hier bestätigen.')}</li>
      </ol>
      {code && left > 0 ? (
        <div className="row between">
          <div>
            <div className="code-big" aria-label={L('Pairing code', 'Pairing-Code')}>
              {formatCode(code)}
            </div>
            <div className="muted small num">
              {L('valid for', 'gültig noch')} {Math.floor(left / 60000)}:
              {String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} min
            </div>
          </div>
          <button className="btn" onClick={regenerate}>
            {L('New code', 'Neuer Code')}
          </button>
        </div>
      ) : (
        <button className="btn primary" onClick={regenerate}>
          {L('Create pairing code', 'Pairing-Code erzeugen')}
        </button>
      )}
      <p className="muted small" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        {L(
          'The code only allows a join request. Nothing happens without your confirmation.',
          'Der Code erlaubt nur eine Beitrittsanfrage. Ohne deine Bestätigung passiert nichts.',
        )}
      </p>
    </section>
  );
}

function PendingDevice({
  device,
  state,
  owner,
  online,
  L,
}: {
  device: Device;
  state: SessionState;
  owner: boolean;
  online: boolean;
  L: Tr;
}) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const uncovered = state.surfaces.filter((s) => {
    const b = polygonBBox(s.polygon);
    return !state.outputs.some((o) => bboxIntersects(b, activeProfile(o).viewport));
  });
  // projectors planned in the 3D room that no PC drives yet
  const planned = state.outputs.filter(
    (o) => !state.devices.some((d) => d.outputId === o.id && d.status === 'approved'),
  );
  const [mode, setMode] = useState<'newSurface' | 'existingSurface' | 'existingOutput'>(
    planned.length > 0 ? 'existingOutput' : uncovered.length > 0 ? 'existingSurface' : 'newSurface',
  );
  const [name, setName] = useState(device.name);
  const [kind, setKind] = useState<'wall' | 'floor' | 'other'>('wall');
  const [surfaceId, setSurfaceId] = useState(uncovered[0]?.id ?? state.surfaces[0]?.id ?? '');
  const [outputId, setOutputId] = useState(planned[0]?.id ?? state.outputs[0]?.id ?? '');
  const approve = async () => {
    const ok = await store.send(
      mode === 'existingOutput'
        ? { t: 'device.approve', deviceId: device.id, outputId }
        : mode === 'existingSurface'
          ? {
              t: 'device.approve',
              deviceId: device.id,
              newOutput: { name: name.trim() || device.name, surfaceId },
            }
          : {
              t: 'device.approve',
              deviceId: device.id,
              newOutput: {
                name: name.trim() || device.name,
                newSurface: { name: name.trim() || device.name, kind },
              },
            },
    );
    if (ok) setOpen(false);
  };
  return (
    <div className="list-item pending">
      <Light level={online ? 'ok' : 'off'} />
      <div className="main">
        <div className="title">{device.name}</div>
        <div className="muted small">
          {online
            ? L('waiting on the projector PC', 'wartet am Beamer-PC')
            : L('not connected right now', 'gerade nicht verbunden')}
        </div>
      </div>
      {owner ? (
        <>
          <button
            className="btn small danger"
            onClick={() => store.send({ t: 'device.reject', deviceId: device.id })}
          >
            {L('Decline', 'Ablehnen')}
          </button>
          <button className="btn small primary" onClick={() => setOpen(true)}>
            {L('Approve', 'Freigeben')}
          </button>
        </>
      ) : (
        <span className="muted small">
          {L('Only the owner can approve', 'Nur der Besitzer kann freigeben')}
        </span>
      )}
      {open && (
        <Sheet title={`${L('Approve', 'Freigeben')}: ${device.name}`} onClose={() => setOpen(false)}>
          <div className="stack">
            <div className="stack" role="radiogroup">
              <label className="check">
                <input type="radio" checked={mode === 'newSurface'} onChange={() => setMode('newSurface')} />
                {L('New projector on a new surface', 'Neuer Beamer auf neuer Fläche')}
              </label>
              {state.surfaces.length > 0 && (
                <label className="check">
                  <input
                    type="radio"
                    checked={mode === 'existingSurface'}
                    onChange={() => setMode('existingSurface')}
                  />
                  {L('New projector on an existing surface', 'Neuer Beamer auf vorhandener Fläche')}
                </label>
              )}
              {state.outputs.length > 0 && (
                <label className="check">
                  <input
                    type="radio"
                    checked={mode === 'existingOutput'}
                    onChange={() => setMode('existingOutput')}
                  />
                  {L(
                    'Replaces an existing projector PC (keeps calibration)',
                    'Ersetzt einen vorhandenen Beamer-PC (Kalibrierung bleibt)',
                  )}
                </label>
              )}
            </div>
            {mode !== 'existingOutput' && (
              <label>
                {L('Projector name', 'Name des Beamers')}
                <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} />
              </label>
            )}
            {mode === 'newSurface' && (
              <div className="row">
                {(['wall', 'floor', 'other'] as const).map((k) => (
                  <button key={k} className={`chip${kind === k ? ' on' : ''}`} onClick={() => setKind(k)}>
                    {kindLabel(k, L)}
                  </button>
                ))}
              </div>
            )}
            {mode === 'existingSurface' && (
              <select
                value={surfaceId}
                onChange={(e) => setSurfaceId(e.target.value)}
                aria-label={L('Surface', 'Fläche')}
              >
                {state.surfaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            {mode === 'existingOutput' && (
              <select
                value={outputId}
                onChange={(e) => setOutputId(e.target.value)}
                aria-label={L('Projector', 'Beamer')}
              >
                {state.outputs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
            <button className="btn primary big" onClick={approve}>
              {L('Approve device', 'Gerät freigeben')}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function OutputCard({
  output,
  state,
  L,
  onCalibrate,
}: {
  output: Output;
  state: SessionState;
  L: Tr;
  onCalibrate: () => void;
}) {
  const store = useStore();
  const { presence } = useShow();
  const [details, setDetails] = useState(false);
  const [preview, setPreview] = useState(false);
  const h = outputHealth(output, state, presence, L);
  const device = state.devices.find((d) => d.outputId === output.id && d.status === 'approved');
  const tel = device ? presence.devices[device.id]?.telemetry : null;
  const profile = activeProfile(output);
  const now = Date.now();
  const testOn = output.testPattern.mode !== 'off' && output.testPattern.until > now;
  const blackout = output.blackout || state.blackoutAll;
  return (
    <section className="panel">
      <div className="row between" style={{ flexWrap: 'nowrap' }}>
        <button
          className="row"
          style={{
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
            flexWrap: 'nowrap',
            minWidth: 0,
          }}
          onClick={() => setDetails((v) => !v)}
          aria-expanded={details}
        >
          <Light level={h.level} title={h.reasons.join(', ')} />
          <span style={{ textAlign: 'left', minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>📽 {output.name}</h2>
            <span className="muted small">
              {h.reasons[0] ?? (device ? `${device.name} · ${L('all good', 'alles gut')}` : '')}
            </span>
          </span>
        </button>
        <button
          className={`btn small${blackout ? ' danger' : ''}`}
          onClick={() => store.send({ t: 'output.blackout', outputIds: [output.id], on: !output.blackout })}
          aria-pressed={output.blackout}
        >
          {output.blackout ? L('Resume', 'Fortsetzen') : L('Blackout', 'Blackout')}
        </button>
      </div>
      {output.resolutionMismatch && (
        <div className="safety-note" style={{ marginTop: '0.75rem' }}>
          {L('The projector reports a new resolution', 'Der Beamer meldet eine neue Auflösung')} (
          {output.resolutionMismatch.w}×{output.resolutionMismatch.h}
          {profile.referenceResolution
            ? `, ${L('calibrated for', 'kalibriert für')} ${profile.referenceResolution.w}×${profile.referenceResolution.h}`
            : ''}
          ).{' '}
          {L('The output stays black until you decide.', 'Der Ausgang bleibt schwarz, bis du entscheidest.')}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button
              className="btn small"
              onClick={() => store.send({ t: 'output.acceptResolution', outputId: output.id })}
            >
              {L('Keep calibration anyway', 'Kalibrierung trotzdem verwenden')}
            </button>
            <button className="btn small primary" onClick={onCalibrate}>
              {L('Recalibrate', 'Neu kalibrieren')}
            </button>
          </div>
        </div>
      )}
      {details && (
        <dl className="kv" style={{ marginTop: '0.75rem' }}>
          <dt>{L('Device', 'Gerät')}</dt>
          <dd>{device?.name ?? '–'}</dd>
          <dt>{L('Status', 'Status')}</dt>
          <dd>{h.reasons.length ? h.reasons.join(' · ') : L('all good', 'alles gut')}</dd>
          <dt>RTT / Jitter</dt>
          <dd>{tel ? `${tel.rttMs} / ${tel.jitterMs} ms` : '–'}</dd>
          <dt>{L('Clock offset', 'Uhr-Abweichung')}</dt>
          <dd>{tel ? `${tel.clockOffsetMs} ms` : '–'}</dd>
          <dt>{L('Frame rate', 'Bildrate')}</dt>
          <dd>{tel ? `${tel.fps} fps · Q ${tel.quality.toFixed(2)}` : '–'}</dd>
          <dt>{L('Resolution', 'Auflösung')}</dt>
          <dd>{tel ? `${tel.width}×${tel.height}` : '–'}</dd>
          <dt>{L('Profile', 'Profil')}</dt>
          <dd>{profile.name}</dd>
          <dt>{L('Fullscreen / sound', 'Vollbild / Ton')}</dt>
          <dd>{tel ? `${tel.fullscreen ? '✓' : '✗'} / ${tel.audioUnlocked ? '✓' : '✗'}` : '–'}</dd>
        </dl>
      )}
      {details && device && <Diagnosis output={output} tel={tel ?? null} L={L} />}
      <div className="row" style={{ marginTop: '0.75rem' }}>
        <button className="btn primary" onClick={onCalibrate}>
          {L('Calibrate', 'Kalibrieren')}
        </button>
        <button
          className={`btn${testOn ? ' on' : ''}`}
          onClick={() =>
            store.send({
              t: 'output.testPattern',
              outputId: output.id,
              mode: testOn ? 'off' : 'grid',
              minutes: 10,
            })
          }
        >
          {testOn ? L('Test pattern off', 'Testbild aus') : L('Test pattern', 'Testbild')}
        </button>
        <button className={`btn${preview ? ' on' : ''}`} onClick={() => setPreview((v) => !v)}>
          {L('Preview', 'Vorschau')}
        </button>
        {device && (
          <button className="btn" onClick={() => store.send({ t: 'device.identify', deviceId: device.id })}>
            {L('Identify', 'Identifizieren')}
          </button>
        )}
      </div>
      {preview && (
        <div style={{ marginTop: '0.75rem' }}>
          <StagePreview state={state} now={() => store.conn.clock.now()} outputId={output.id} />
          <p className="muted small" style={{ margin: '0.4rem 0 0' }}>
            {L(
              'Exactly what this projector shows – including calibration, masks and blackout.',
              'Genau das, was dieser Beamer zeigt – inklusive Kalibrierung, Masken und Blackout.',
            )}
          </p>
        </div>
      )}
      <div className="stack" style={{ marginTop: '0.75rem' }}>
        <Slider
          label={L('Brightness', 'Helligkeit')}
          value={Math.round(output.intensity * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => store.send({ t: 'output.update', outputId: output.id, intensity: v / 100 })}
        />
        <Slider
          label={L('Volume', 'Lautstärke')}
          value={Math.round(output.volume * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => store.send({ t: 'output.update', outputId: output.id, volume: v / 100 })}
        />
        {details && (
          <label>
            {L('Performance', 'Leistung')}
            <select
              value={output.performance ?? 'auto'}
              onChange={(e) =>
                store.send({
                  t: 'output.update',
                  outputId: output.id,
                  performance: e.target.value as 'auto' | 'high' | 'eco',
                })
              }
            >
              <option value="auto">{L('Automatic (recommended)', 'Automatisch (empfohlen)')}</option>
              <option value="high">{L('Always 60 fps, full quality', 'Immer 60 fps, volle Qualität')}</option>
              <option value="eco">
                {L(
                  'Eco – 30 fps for weak PCs / projector browsers',
                  'Eco – 30 fps für schwache PCs / Beamer-Browser',
                )}
              </option>
            </select>
          </label>
        )}
        {details && (
          <label>
            {L('Graphics mode (switches live)', 'Grafikmodus (schaltet sofort um)')}
            <select
              value={output.renderMode ?? 'standard'}
              onChange={(e) =>
                store.send({
                  t: 'output.update',
                  outputId: output.id,
                  renderMode: e.target.value as 'standard' | 'compat' | 'fullhd' | 'lowpower',
                })
              }
            >
              <option value="standard">
                {L('Standard – graphics card, up to native 4K', 'Standard – Grafikkarte, bis nativ 4K')}
              </option>
              <option value="compat">
                {L(
                  'Compatible – if the picture stays black in fullscreen',
                  'Kompatibel – wenn das Bild im Vollbild schwarz bleibt',
                )}
              </option>
              <option value="fullhd">{L('Full HD – less load', 'Full HD – weniger Last')}</option>
              <option value="lowpower">
                {L(
                  'Power-saving graphics chip (laptops with two GPUs), Full HD',
                  'Stromspar-Grafikchip (Laptops mit zwei GPUs), Full HD',
                )}
              </option>
            </select>
          </label>
        )}
        {details && (
          <div className="row">
            <label className="grow">
              {L('If the projector PC loses the server', 'Wenn der Beamer-PC den Server verliert')}
              <select
                value={output.failover.mode}
                onChange={(e) =>
                  store.send({
                    t: 'output.update',
                    outputId: output.id,
                    failover: { ...output.failover, mode: e.target.value as Output['failover']['mode'] },
                  })
                }
              >
                <option value="continue">{L('keep playing', 'weiterspielen')}</option>
                <option value="freeze">{L('freeze picture', 'Bild einfrieren')}</option>
                <option value="blackout">{L('go black', 'schwarz schalten')}</option>
              </select>
            </label>
            {output.failover.mode !== 'continue' && (
              <label>
                {L('after (s)', 'nach (s)')}
                <input
                  type="number"
                  min={5}
                  max={3600}
                  value={output.failover.afterSec}
                  onChange={(e) =>
                    store.send({
                      t: 'output.update',
                      outputId: output.id,
                      failover: {
                        ...output.failover,
                        afterSec: Math.max(5, Math.min(3600, Number(e.target.value) || 60)),
                      },
                    })
                  }
                  style={{ width: 100 }}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function DevicesPanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const { presence, role } = useShow();
  const approved = state.devices.filter((d) => d.status === 'approved');
  if (approved.length === 0) return null;
  return (
    <section className="panel">
      <h2>{L('Projector PCs', 'Beamer-PCs')}</h2>
      <div className="list">
        {approved.map((d) => {
          const p = presence.devices[d.id];
          return (
            <div key={d.id} className="list-item">
              <Light level={p?.online ? 'ok' : 'bad'} title={p?.online ? 'online' : 'offline'} />
              <div className="main">
                <div className="title">{d.name}</div>
                <select
                  value={d.outputId ?? ''}
                  onChange={(e) =>
                    store.send({ t: 'device.assign', deviceId: d.id, outputId: e.target.value || null })
                  }
                  aria-label={L('Shows output', 'Zeigt Ausgang')}
                  style={{ marginTop: 4, minHeight: 36 }}
                >
                  <option value="">{L('– not assigned –', '– nicht zugeordnet –')}</option>
                  {state.outputs.map((o) => (
                    <option key={o.id} value={o.id}>
                      📽 {o.name}
                    </option>
                  ))}
                </select>
              </div>
              {role === 'owner' && (
                <button
                  className="btn small danger"
                  onClick={() =>
                    window.confirm(
                      L(
                        `Remove “${d.name}”? It will need to pair again.`,
                        `„${d.name}“ entfernen? Es muss sich dann neu verbinden.`,
                      ),
                    ) && store.send({ t: 'device.remove', deviceId: d.id })
                  }
                >
                  {L('Remove', 'Entfernen')}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const BLACK_REASONS: Record<string, [string, string]> = {
  'no-show': ['not connected to the show yet', 'noch nicht mit der Show verbunden'],
  'no-output': ['no projector assigned', 'keinem Beamer zugeordnet'],
  blackout: ['blackout is on', 'Blackout ist an'],
  'local-blackout': ['local blackout (key B on the projector PC)', 'lokaler Blackout (Taste B am Beamer-PC)'],
  offline: ['offline for too long (failover)', 'zu lange offline (Ausfall-Verhalten)'],
  format: ['picture format changed – confirm above', 'Bildformat geändert – oben bestätigen'],
};

/** Remote diagnosis of a projector PC, entirely from the phone. */
function Diagnosis({ output, tel, L }: { output: Output; tel: Telemetry | null; L: Tr }) {
  const store = useStore();
  const live = (output.diagUntil ?? 0) > Date.now();
  if (!tel)
    return (
      <p className="muted small">{L('No data from the projector yet.', 'Noch keine Daten vom Beamer.')}</p>
    );
  const reason = tel.blackReason ? BLACK_REASONS[tel.blackReason] : null;
  let verdict: string;
  let bad = false;
  if (tel.contextLost) {
    verdict = L(
      'The graphics card dropped the picture (context lost) – it restarts automatically. If this repeats, try graphics mode Full HD.',
      'Die Grafikkarte hat das Bild verloren (Context lost) – startet automatisch neu. Passiert das öfter: Grafikmodus „Full HD“ probieren.',
    );
    bad = true;
  } else if (reason) verdict = `${L('Black on purpose', 'Absichtlich schwarz')}: ${L(reason[0], reason[1])}.`;
  else if (tel.lum !== undefined && tel.lum < 0.004) {
    verdict = L(
      'The app draws a black picture although the show runs – rendering problem.',
      'Die App zeichnet ein schwarzes Bild, obwohl die Show läuft – Darstellungsproblem.',
    );
    bad = true;
  } else
    verdict = L(
      'The app draws the picture. If the projector still shows black, the browser/driver does not display it: switch the graphics mode (e.g. “Compatible”) and watch the wall.',
      'Die App zeichnet das Bild. Zeigt der Beamer trotzdem Schwarz, bringt Browser/Treiber es nicht auf den Schirm: Grafikmodus umschalten (z. B. „Kompatibel“) und auf die Wand schauen.',
    );
  return (
    <div className="stack" style={{ marginTop: '0.75rem' }}>
      <strong>{L('Diagnosis', 'Diagnose')}</strong>
      <div className={bad ? 'safety-note' : 'muted small'}>{verdict}</div>
      <dl className="kv">
        <dt>{L('Picture brightness', 'Bildhelligkeit')}</dt>
        <dd>{tel.lum !== undefined ? `${Math.round(tel.lum * 100)} %` : '–'}</dd>
        <dt>{L('Screen', 'Bildschirm')}</dt>
        <dd>
          {tel.width}×{tel.height}
          {tel.dpr ? ` · ${L('scaling', 'Skalierung')} ${Math.round(tel.dpr * 100)} %` : ''}
        </dd>
        <dt>{L('Window', 'Fenster')}</dt>
        <dd>
          {tel.winW ? `${tel.winW}×${tel.winH}` : '–'} ·{' '}
          {tel.fullscreen ? L('fullscreen', 'Vollbild') : L('windowed', 'Fenster')}
        </dd>
        <dt>{L('Rendered at', 'Gerechnet in')}</dt>
        <dd>{tel.renderW ? `${tel.renderW}×${tel.renderH}` : '–'}</dd>
        <dt>{L('Graphics mode', 'Grafikmodus')}</dt>
        <dd>{tel.renderMode ?? '–'}</dd>
        <dt>GPU</dt>
        <dd style={{ wordBreak: 'break-word' }}>{tel.gpu ?? '–'}</dd>
        {tel.lastError && (
          <>
            <dt>{L('Error', 'Fehler')}</dt>
            <dd style={{ wordBreak: 'break-word' }}>{tel.lastError}</dd>
          </>
        )}
      </dl>
      <button
        className={`btn small${live ? ' on' : ''}`}
        onClick={() => store.send({ t: 'output.update', outputId: output.id, diag: !live })}
      >
        📷{' '}
        {live
          ? L('Stop live picture', 'Live-Bild beenden')
          : L('Live picture from the projector (5 min)', 'Live-Bild vom Beamer (5 Min.)')}
      </button>
      {live && tel.thumb && (
        <img
          src={tel.thumb}
          alt={L('What the projector app draws', 'Was die Beamer-App zeichnet')}
          style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line, #333)' }}
        />
      )}
    </div>
  );
}
