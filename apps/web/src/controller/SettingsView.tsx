import { useEffect, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { formatCode } from '@spectrastage/shared';
import { useLang, useT, type Tr } from '../lib/i18n.tsx';
import { api } from '../lib/api.ts';
import { KEYS, storage } from '../lib/storage.ts';
import { useShow, useStore } from './store.ts';
import { download, Light, pickJsonFile, Sheet, Slider } from './ui.tsx';

export function SettingsView() {
  const L = useT();
  const store = useStore();
  const { state, role, presence, secrets, subjectId } = useShow();
  const { locale, setLocale } = useLang();
  const owner = role === 'owner';
  const [name, setName] = useState(state.name);
  const [showKey, setShowKey] = useState(false);
  const [audit, setAudit] = useState<{ at: number; actor: string; summary: string }[] | null>(null);
  useEffect(() => setName(state.name), [state.name]);

  const theme = catalog.get(state.defaultThemeId) ?? catalog.themes[0]!;

  return (
    <div className="stack">
      <section className="panel stack">
        <h2>{L('Show', 'Show')}</h2>
        <label>
          {L('Name', 'Name')}
          <input
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 60))}
            onBlur={() =>
              name.trim() && name !== state.name && store.send({ t: 'session.rename', name: name.trim() })
            }
          />
        </label>
        <div>
          <div className="muted small" style={{ fontWeight: 600, marginBottom: 4 }}>
            {L('Language', 'Sprache')}
          </div>
          <div className="row">
            <button className={`chip${locale === 'de' ? ' on' : ''}`} onClick={() => setLocale('de')}>
              Deutsch
            </button>
            <button className={`chip${locale === 'en' ? ' on' : ''}`} onClick={() => setLocale('en')}>
              English
            </button>
          </div>
        </div>
        <label>
          {L('Default theme for new surfaces', 'Standard-Thema für neue Flächen')}
          <select
            value={state.defaultThemeId}
            onChange={(e) => store.send({ t: 'session.setDefaultTheme', themeId: e.target.value })}
          >
            {catalog.themes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.icon} {L.text(t.name)}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="panel stack">
        <h2>{L('Sound', 'Ton')}</h2>
        <p className="muted small" style={{ margin: 0 }}>
          {L(
            'Each projector PC plays its own sound through its speakers.',
            'Jeder Beamer-PC spielt den Ton über seine eigenen Lautsprecher.',
          )}
        </p>
        <Slider
          label={L('Master volume', 'Gesamtlautstärke')}
          value={Math.round(state.masterVolume * 100)}
          min={0}
          max={100}
          step={5}
          format={(v) => `${v}%`}
          onChange={(v) => store.send({ t: 'session.setAudio', masterVolume: v / 100 })}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={state.muted}
            onChange={(e) => store.send({ t: 'session.setAudio', muted: e.target.checked })}
          />
          {L('Mute everything', 'Alles stumm')}
        </label>
      </section>

      <section className="panel stack">
        <h2>{L('Safety', 'Sicherheit')}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={state.kidsSafe}
            disabled={!owner}
            onChange={(e) => store.send({ t: 'session.setKidsSafe', on: e.target.checked })}
          />
          {L(
            'Child-safe mode: no flashing, brightness changes are limited',
            'Kindersicherer Modus: kein Flackern, Helligkeitswechsel werden begrenzt',
          )}
        </label>
        {!state.kidsSafe && (
          <p className="safety-note">
            {L(
              'Child-safe mode is off. Fast brightness changes are possible.',
              'Kindersicherer Modus ist aus. Schnelle Helligkeitswechsel sind möglich.',
            )}
          </p>
        )}
        <SafetyChecklist L={L} />
      </section>

      <AmbientSettings L={L} />

      <section className="panel stack">
        <h2>{L('Helpers', 'Helfer')}</h2>
        <div className="list">
          {state.controllers.map((c) => (
            <div key={c.id} className="list-item">
              <Light level={presence.controllers[c.id]?.online ? 'ok' : 'off'} />
              <div className="main">
                <div className="title">
                  {c.name}
                  {c.id === subjectId ? ` (${L('you', 'du')})` : ''}
                </div>
                <div className="muted small">
                  {c.role === 'owner' ? L('Owner', 'Besitzer') : L('Helper', 'Helfer')}
                </div>
              </div>
              {owner && c.role !== 'owner' && (
                <button
                  className="btn small danger"
                  onClick={() => store.send({ t: 'controller.remove', controllerId: c.id })}
                >
                  {L('Remove', 'Entfernen')}
                </button>
              )}
            </div>
          ))}
        </div>
        {owner && (
          <>
            {secrets?.invites.map((i) => (
              <div key={i.code} className="list-item">
                <div className="main">
                  <div className="code-big" style={{ fontSize: '1.6rem' }}>
                    {formatCode(i.code)}
                  </div>
                  <div className="muted small">
                    {L('Invite – valid until', 'Einladung – gültig bis')}{' '}
                    {new Date(i.expiresAt).toLocaleTimeString(locale)} · {location.host}/?invite=
                    {formatCode(i.code)}
                  </div>
                </div>
              </div>
            ))}
            <button
              className="btn"
              onClick={async () => {
                try {
                  await api('POST', '/api/invites', {}, store.token);
                } catch (e) {
                  store.toast((e as Error).message, 'error');
                }
              }}
            >
              {L('Invite a helper', 'Helfer einladen')}
            </button>
            <p className="muted small" style={{ margin: 0 }}>
              {L(
                'Helpers can run the show but cannot approve projectors or delete the show.',
                'Helfer können die Show steuern, aber keine Beamer freigeben und die Show nicht löschen.',
              )}
            </p>
          </>
        )}
      </section>

      {owner && (
        <section className="panel stack">
          <h2>{L('Recovery key', 'Wiederherstellungs-Schlüssel')}</h2>
          <p className="muted small" style={{ margin: 0 }}>
            {L(
              'There is no account. This key is the only way to open your show on another phone or after clearing browser data. Keep it private.',
              'Es gibt kein Konto. Dieser Schlüssel ist der einzige Weg, deine Show auf einem anderen Handy oder nach dem Löschen der Browserdaten zu öffnen. Halte ihn geheim.',
            )}
          </p>
          <div className="row">
            <button className="btn" onClick={() => setShowKey(true)}>
              {L('Show key', 'Schlüssel anzeigen')}
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                if (
                  !window.confirm(
                    L(
                      'Create a new key? The old key stops working everywhere.',
                      'Neuen Schlüssel erzeugen? Der alte funktioniert dann nirgends mehr.',
                    ),
                  )
                )
                  return;
                try {
                  const r = await api<{ ownerToken: string }>(
                    'POST',
                    '/api/sessions/rotate-owner',
                    {},
                    store.token,
                  );
                  storage.set(KEYS.controllerToken, r.ownerToken);
                  storage.set('ss.controller.showRecovery', '1');
                  location.reload();
                } catch (e) {
                  store.toast((e as Error).message, 'error');
                }
              }}
            >
              {L('Replace key', 'Schlüssel ersetzen')}
            </button>
          </div>
          {showKey && <RecoveryKeySheet onClose={() => setShowKey(false)} />}
        </section>
      )}

      <section className="panel stack">
        <h2>{L('Backup', 'Sicherung')}</h2>
        <div className="row">
          <button
            className="btn"
            onClick={async () => {
              try {
                const data = await api('GET', '/api/sessions/export', undefined, store.token);
                download(`spectrastage-${state.name.replace(/[^\w-]+/g, '_')}.json`, data);
              } catch (e) {
                store.toast((e as Error).message, 'error');
              }
            }}
          >
            {L('Export show', 'Show exportieren')}
          </button>
          {owner && (
            <button
              className="btn"
              onClick={async () => {
                try {
                  const data = await pickJsonFile();
                  if (
                    !window.confirm(
                      L(
                        'Replace surfaces, calibrations and playlists with the file?',
                        'Flächen, Kalibrierungen und Playlists durch die Datei ersetzen?',
                      ),
                    )
                  )
                    return;
                  await api('POST', '/api/sessions/import', data, store.token);
                  store.toast(L('Show imported', 'Show importiert'));
                } catch (e) {
                  store.toast((e as Error).message, 'error');
                }
              }}
            >
              {L('Import show', 'Show importieren')}
            </button>
          )}
          <button
            className="btn ghost"
            onClick={async () => {
              const r = await api<{ entries: { at: number; actor: string; summary: string }[] }>(
                'GET',
                '/api/sessions/audit',
                undefined,
                store.token,
              ).catch(() => null);
              setAudit(r?.entries ?? []);
            }}
          >
            {L('Activity log', 'Protokoll')}
          </button>
        </div>
        {audit && (
          <Sheet title={L('Activity log', 'Protokoll')} onClose={() => setAudit(null)}>
            <div className="list">
              {audit.map((a, i) => (
                <div key={i} className="small">
                  <span className="muted num">{new Date(a.at).toLocaleTimeString(locale)}</span> ·{' '}
                  <b>{a.actor}</b>: {a.summary}
                </div>
              ))}
              {audit.length === 0 && <p className="muted">–</p>}
            </div>
          </Sheet>
        )}
      </section>

      <section className="panel stack">
        <h2>{L('This phone', 'Dieses Handy')}</h2>
        <button
          className="btn"
          onClick={() => {
            if (
              !window.confirm(
                L(
                  'Leave the show on this phone? Without the recovery key you cannot come back.',
                  'Show auf diesem Handy verlassen? Ohne Schlüssel kommst du nicht zurück.',
                ),
              )
            )
              return;
            storage.remove(KEYS.controllerToken);
            location.href = '/';
          }}
        >
          {L('Leave show on this phone', 'Show auf diesem Handy verlassen')}
        </button>
        {owner && (
          <button
            className="btn danger"
            onClick={async () => {
              if (
                !window.confirm(
                  L(
                    `Delete “${state.name}” for good? All projectors are disconnected.`,
                    `„${state.name}“ endgültig löschen? Alle Beamer werden getrennt.`,
                  ),
                )
              )
                return;
              try {
                await api('DELETE', '/api/sessions/current', undefined, store.token);
                storage.remove(KEYS.controllerToken);
                location.href = '/';
              } catch (e) {
                store.toast((e as Error).message, 'error');
              }
            }}
          >
            {L('Delete show', 'Show löschen')}
          </button>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          SpectraStage 1.0 · {L('Theme', 'Thema')}: {L.text(theme.name)}
        </p>
      </section>
    </div>
  );
}

export function RecoveryKeySheet({ onClose }: { onClose: () => void }) {
  const L = useT();
  const store = useStore();
  const key = store.token;
  const [copied, setCopied] = useState(false);
  return (
    <Sheet title={L('Your recovery key', 'Dein Wiederherstellungs-Schlüssel')} onClose={onClose}>
      <div className="stack">
        <p>
          {L(
            'Save this key somewhere safe (password manager, photo, paper). With it you can control your show from any phone.',
            'Speichere diesen Schlüssel sicher (Passwort-Manager, Foto, Zettel). Damit steuerst du deine Show von jedem Handy aus.',
          )}
        </p>
        <code
          style={{
            wordBreak: 'break-all',
            background: 'var(--night-deep)',
            padding: '0.75rem',
            borderRadius: 8,
            fontSize: '1rem',
            userSelect: 'all',
          }}
        >
          {key}
        </code>
        <div className="row">
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(key);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? L('Copied', 'Kopiert') : L('Copy key', 'Schlüssel kopieren')}
          </button>
          <button
            className="btn"
            onClick={() =>
              download('spectrastage-recovery-key.json', {
                format: 'spectrastage-recovery-key',
                recoveryKey: key,
              })
            }
          >
            {L('Save as file', 'Als Datei speichern')}
          </button>
        </div>
        <p className="muted small">
          {L(
            'Never send it to projector PCs – they only need the pairing code.',
            'Nie an Beamer-PCs geben – die brauchen nur den Pairing-Code.',
          )}
        </p>
        <button className="btn" onClick={onClose}>
          {L('Done', 'Erledigt')}
        </button>
      </div>
    </Sheet>
  );
}

function AmbientSettings({ L }: { L: Tr }) {
  const store = useStore();
  const { state } = useShow();
  const actors = catalog.themes.flatMap((t) =>
    t.actors.filter((a) => !state.kidsSafe || a.childSafe).map((a) => ({ t, a })),
  );
  const amb = state.ambient;
  const set = (patch: Partial<typeof amb>) =>
    store.send({
      t: 'session.setAmbient',
      ambient: {
        enabled: amb.enabled,
        actors: amb.actors,
        minGapSec: amb.minGapSec,
        maxGapSec: amb.maxGapSec,
        ...patch,
      },
    });
  return (
    <section className="panel stack">
      <h2>{L('Roaming creatures', 'Umherstreifende Kreaturen')}</h2>
      <label className="check">
        <input type="checkbox" checked={amb.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        {L('Send creatures across the stage by themselves', 'Kreaturen von selbst über die Bühne schicken')}
      </label>
      <div className="row">
        {actors.map(({ t, a }) => {
          const on = amb.actors.some((x) => x.themeId === t.id && x.actorId === a.id);
          return (
            <button
              key={`${t.id}/${a.id}`}
              className={`chip${on ? ' on' : ''}`}
              onClick={() =>
                set({
                  actors: on
                    ? amb.actors.filter((x) => !(x.themeId === t.id && x.actorId === a.id))
                    : [...amb.actors, { themeId: t.id, actorId: a.id }],
                })
              }
            >
              {a.icon} {L.text(a.name)}
            </button>
          );
        })}
      </div>
      <Slider
        label={L('About every', 'Etwa alle')}
        value={Math.round((amb.minGapSec + amb.maxGapSec) / 2)}
        min={10}
        max={300}
        step={5}
        format={(v) => `${v} s`}
        onChange={(v) => set({ minGapSec: Math.max(5, Math.round(v * 0.6)), maxGapSec: Math.round(v * 1.4) })}
      />
    </section>
  );
}

function SafetyChecklist({ L }: { L: Tr }) {
  const items = [
    L(
      'No reachable projector lens; children cannot look straight into the beam.',
      'Keine erreichbare Linse; Kinder können nicht direkt in den Strahl schauen.',
    ),
    L(
      'Floor projector from above: nobody can look up into it from the driveway.',
      'Bodenprojektor von oben: Niemand kann von der Einfahrt hinauf in die Linse schauen.',
    ),
    L(
      'No glare for drivers; no light onto the public road or neighbours’ windows.',
      'Keine Blendung für Autofahrer; kein Licht auf die Straße oder in Nachbarfenster.',
    ),
    L(
      'Cables secured, no tripping hazards, weather protection and ventilation.',
      'Kabel gesichert, keine Stolperfallen, Wetterschutz und Belüftung.',
    ),
    L(
      'Every adult knows the physical power switch of each projector.',
      'Alle Erwachsenen kennen den Netzschalter jedes Beamers.',
    ),
    L(
      'Software blackout is not a safety switch: an offline PC cannot receive it.',
      'Software-Blackout ist kein Sicherheitsschalter: Ein Offline-PC empfängt ihn nicht.',
    ),
  ];
  const [done, setDone] = useState<boolean[]>(
    () => storage.getJson<boolean[]>('ss.safety') ?? items.map(() => false),
  );
  return (
    <div className="stack">
      <h3 style={{ margin: 0 }}>{L('Before the show', 'Vor der Show')}</h3>
      {items.map((t, i) => (
        <label key={i} className="check">
          <input
            type="checkbox"
            checked={!!done[i]}
            onChange={(e) => {
              const next = [...done];
              next[i] = e.target.checked;
              setDone(next);
              storage.setJson('ss.safety', next);
            }}
          />
          {t}
        </label>
      ))}
    </div>
  );
}
