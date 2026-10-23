import { useEffect, useMemo, useState } from 'react';
import { useT } from '../lib/i18n.tsx';
import { KEYS, storage } from '../lib/storage.ts';
import { BrandMark } from '../Landing.tsx';
import { ControllerStore, StoreCtx, useSnap, useStore } from './store.ts';
import { SelectionCtx, Light } from './ui.tsx';
import { LiveView } from './LiveView.tsx';
import { ScenesView } from './ScenesView.tsx';
import { StageEditor } from './StageEditor.tsx';
import { OutputsView } from './OutputsView.tsx';
import { PlaylistsView } from './PlaylistsView.tsx';
import { RecoveryKeySheet, SettingsView } from './SettingsView.tsx';

type Tab = 'live' | 'scenes' | 'stage' | 'outputs' | 'playlists' | 'more';

export default function ControllerApp() {
  const L = useT();
  const token = storage.get(KEYS.controllerToken);
  const store = useMemo(
    () =>
      token
        ? new ControllerStore(token, (code) => {
            storage.remove(KEYS.controllerToken);
            window.alert(
              code === 'session_deleted'
                ? L('This show was deleted.', 'Diese Show wurde gelöscht.')
                : L(
                    'Access to this show was revoked or the key is no longer valid.',
                    'Der Zugang zu dieser Show wurde entzogen oder der Schlüssel ist ungültig.',
                  ),
            );
            location.href = '/';
          })
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token],
  );
  useEffect(() => {
    if (!store) {
      location.replace('/');
      return;
    }
    store.start();
    return () => store.stop();
  }, [store]);
  if (!store) return null;
  return (
    <StoreCtx.Provider value={store}>
      <Shell />
    </StoreCtx.Provider>
  );
}

function Shell() {
  const L = useT();
  const store = useStore();
  const snap = useSnap();
  const [tab, setTab] = useState<Tab>(() => (location.hash.slice(1) as Tab) || 'live');
  const [surfaceIds, setSurfaceIds] = useState<string[]>([]);
  const [showRecovery, setShowRecovery] = useState(() => storage.get('ss.controller.showRecovery') === '1');
  const selection = useMemo(() => ({ surfaceIds, setSurfaceIds }), [surfaceIds]);
  useEffect(() => {
    history.replaceState(null, '', `#${tab}`);
  }, [tab]);

  const { state, status } = snap;
  const online = status === 'online';
  const pending = state?.devices.filter((d) => d.status === 'pending').length ?? 0;
  const blackoutAll = !!state?.blackoutAll;

  const tabs: [Tab, string, string][] = [
    ['live', '✨', L('Live', 'Live')],
    ['scenes', '🎬', L('Scenes', 'Szenen')],
    ['stage', '🏠', L('Stage', 'Bühne')],
    ['outputs', '📽', L('Projectors', 'Beamer')],
    ['playlists', '🎞', L('Playlists', 'Playlists')],
    ['more', '⚙', L('More', 'Mehr')],
  ];

  return (
    <SelectionCtx.Provider value={selection}>
      <div className="shell">
        <header className="topbar">
          <BrandMark size={30} />
          <span className="show-name">{state?.name ?? 'SpectraStage'}</span>
          <span className="conn" role="status">
            <Light level={online ? 'ok' : status === 'connecting' ? 'warn' : 'bad'} />
            <span className="conn-label">
              {online
                ? L('Live', 'Live')
                : status === 'connecting'
                  ? L('Connecting', 'Verbinde')
                  : L('Offline', 'Offline')}
            </span>
          </span>
          <button
            className={`blackout-btn${blackoutAll ? ' active' : ''}`}
            disabled={!online || !state}
            onClick={() => {
              if (!blackoutAll) void store.send({ t: 'session.blackoutAll', on: true });
              else if (window.confirm(L('Switch all projectors back on?', 'Alle Beamer wieder einschalten?')))
                void store.send({ t: 'session.blackoutAll', on: false });
            }}
            aria-pressed={blackoutAll}
          >
            {blackoutAll ? L('RESUME', 'FORTSETZEN') : L('BLACKOUT', 'BLACKOUT')}
          </button>
        </header>
        <nav className="tabbar" aria-label={L('Sections', 'Bereiche')}>
          {tabs.map(([id, ico, label]) => (
            <button
              key={id}
              className={tab === id ? 'on' : ''}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <span className="ico" aria-hidden="true">
                {ico}
              </span>
              {label}
              {id === 'outputs' && pending > 0 && <span className="badge">{pending}</span>}
            </button>
          ))}
        </nav>
        <main className={`content${!online && state ? ' disabled' : ''}`} style={{ gridColumn: 'auto' }}>
          {!online && (
            <div className="offline-banner" style={{ margin: '-14px -12px 12px', pointerEvents: 'auto' }}>
              {L(
                'No connection to the server. Commands are disabled; projectors keep playing what they had.',
                'Keine Verbindung zum Server. Befehle sind gesperrt; die Beamer spielen weiter, was sie hatten.',
              )}
            </div>
          )}
          {blackoutAll && (
            <div className="blackout-banner" style={{ margin: '0 0 12px', borderRadius: 12 }}>
              <span>
                {L('All projectors are black (software).', 'Alle Beamer sind schwarz (Software).')}{' '}
                <span style={{ fontWeight: 400 }}>{L('Not a power switch.', 'Kein Netzschalter.')}</span>
              </span>
            </div>
          )}
          <div className="content-inner">
            {!state ? (
              <p className="muted">{L('Loading show…', 'Lade Show…')}</p>
            ) : tab === 'live' ? (
              <LiveView />
            ) : tab === 'scenes' ? (
              <ScenesView />
            ) : tab === 'stage' ? (
              <StageEditor />
            ) : tab === 'outputs' ? (
              <OutputsView />
            ) : tab === 'playlists' ? (
              <PlaylistsView />
            ) : (
              <SettingsView />
            )}
            {state?.lastChange && (
              <p className="muted small" style={{ marginTop: '1.5rem', textAlign: 'center' }}>
                {L('Last change', 'Letzte Änderung')}: {state.lastChange.actor} – {state.lastChange.summary}
              </p>
            )}
          </div>
        </main>
        {snap.toast && <div className={`toast ${snap.toast.kind}`}>{snap.toast.text}</div>}
        {showRecovery && snap.role === 'owner' && (
          <RecoveryKeySheet
            onClose={() => {
              storage.remove('ss.controller.showRecovery');
              setShowRecovery(false);
            }}
          />
        )}
      </div>
    </SelectionCtx.Provider>
  );
}
