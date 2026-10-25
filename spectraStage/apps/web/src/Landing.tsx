import { useState, type FormEvent } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { formatCode, normalizeCode } from '@spectrastage/shared';
import type { ApiError } from './lib/api.ts';
import { api } from './lib/api.ts';
import { KEYS, storage } from './lib/storage.ts';
import { useLang, useT } from './lib/i18n.tsx';

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <path
        d="M8 50 L32 12 L56 50 Z"
        fill="rgba(255,179,71,0.12)"
        stroke="#ffb347"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path d="M32 12 L20 50 M32 12 L44 50" stroke="rgba(255,179,71,0.45)" strokeWidth="2" />
      <circle cx="32" cy="40" r="5.5" fill="#ffb347" />
    </svg>
  );
}

type Mode = 'create' | 'recover' | 'join';

export default function Landing() {
  const L = useT();
  const { locale, setLocale } = useLang();
  const hasShow = !!storage.get(KEYS.controllerToken);
  const [mode, setMode] = useState<Mode>(
    new URLSearchParams(location.search).has('invite') ? 'join' : 'create',
  );
  const [name, setName] = useState(L('Halloween at our place', 'Halloween bei uns'));
  const [themeId, setThemeId] = useState(catalog.themes[0]?.id ?? 'halloween');
  const [key, setKey] = useState('');
  const [code, setCode] = useState(new URLSearchParams(location.search).get('invite') ?? '');
  const [helper, setHelper] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = (token: string, role: 'owner' | 'controller') => {
    storage.set(KEYS.controllerToken, token);
    storage.set(KEYS.controllerRole, role);
    location.href = '/c';
  };

  const fail = (err: unknown) => {
    const e = err as ApiError;
    if (e.status === 429)
      setError(
        L(
          'Too many attempts – please wait a few minutes.',
          'Zu viele Versuche – bitte ein paar Minuten warten.',
        ),
      );
    else if (e.status === 401 || e.status === 404)
      setError(L('Not valid. Please check your input.', 'Ungültig. Bitte Eingabe prüfen.'));
    else setError(e.message);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        const r = await api<{ ownerToken: string }>('POST', '/api/sessions', {
          name: name.trim() || 'Show',
          themeId,
          locale,
        });
        storage.set('ss.controller.showRecovery', '1');
        go(r.ownerToken, 'owner');
      } else if (mode === 'recover') {
        await api('POST', '/api/sessions/recover', { recoveryKey: key.trim() });
        go(key.trim(), 'owner');
      } else {
        const r = await api<{ token: string }>('POST', '/api/join', {
          code: normalizeCode(code),
          name: helper.trim() || 'Helfer',
        });
        go(r.token, 'controller');
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="landing">
      <div className="landing-inner">
        <div className="brand row between">
          <div className="row">
            <BrandMark />
            <span className="brand-name">SpectraStage</span>
          </div>
          <button className="btn ghost small" onClick={() => setLocale(locale === 'de' ? 'en' : 'de')}>
            {locale === 'de' ? 'English' : 'Deutsch'}
          </button>
        </div>
        <h1 className="landing-hero">{L('Turn your house into a stage.', 'Mach dein Haus zur Bühne.')}</h1>
        <p className="muted">
          {L(
            'Projection shows for garage doors, walls and driveways – controlled from your phone. No account, no app install.',
            'Projektions-Shows für Garagentor, Hauswand und Einfahrt – gesteuert vom Handy. Ohne Konto, ohne App-Installation.',
          )}
        </p>

        {hasShow && (
          <div className="panel">
            <div className="row between">
              <span>
                {L('Your show is saved on this phone.', 'Deine Show ist auf diesem Handy gespeichert.')}
              </span>
              <a className="btn primary" href="/c">
                {L('Open show', 'Show öffnen')}
              </a>
            </div>
          </div>
        )}

        <div className="panel">
          <div className="row" role="tablist">
            <button
              className={`chip${mode === 'create' ? ' on' : ''}`}
              onClick={() => setMode('create')}
              role="tab"
              aria-selected={mode === 'create'}
            >
              {L('New show', 'Neue Show')}
            </button>
            <button
              className={`chip${mode === 'recover' ? ' on' : ''}`}
              onClick={() => setMode('recover')}
              role="tab"
              aria-selected={mode === 'recover'}
            >
              {L('Recovery key', 'Wiederherstellungs-Schlüssel')}
            </button>
            <button
              className={`chip${mode === 'join' ? ' on' : ''}`}
              onClick={() => setMode('join')}
              role="tab"
              aria-selected={mode === 'join'}
            >
              {L('Join as helper', 'Als Helfer beitreten')}
            </button>
          </div>
          <form className="stack" style={{ marginTop: '1rem' }} onSubmit={submit}>
            {mode === 'create' && (
              <>
                <label>
                  {L('Name of the show', 'Name der Show')}
                  <input value={name} onChange={(e) => setName(e.target.value.slice(0, 60))} />
                </label>
                <div className="theme-pick" role="radiogroup" aria-label={L('Theme', 'Thema')}>
                  {catalog.themes.map((t) => (
                    <button
                      type="button"
                      key={t.id}
                      className={t.id === themeId ? 'on' : ''}
                      onClick={() => setThemeId(t.id)}
                      role="radio"
                      aria-checked={t.id === themeId}
                    >
                      <span className="ti">{t.icon}</span>
                      <b>{L.text(t.name)}</b>
                      <div className="muted small">{L.text(t.description)}</div>
                    </button>
                  ))}
                </div>
                <button className="btn primary big" disabled={busy}>
                  {busy ? L('Creating…', 'Erstelle…') : L('Create show', 'Show erstellen')}
                </button>
              </>
            )}
            {mode === 'recover' && (
              <>
                <label>
                  {L('Recovery key', 'Wiederherstellungs-Schlüssel')}
                  <input
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
                <p className="muted small">
                  {L(
                    'Use this when you switch phones or cleared the browser data.',
                    'Für ein neues Handy oder nach dem Löschen der Browserdaten.',
                  )}
                </p>
                <button className="btn primary big" disabled={busy || key.trim().length < 20}>
                  {L('Open show', 'Show öffnen')}
                </button>
              </>
            )}
            {mode === 'join' && (
              <>
                <label>
                  {L('Invite code', 'Einladungscode')}
                  <input
                    className="code-input"
                    value={code}
                    onChange={(e) => setCode(formatCode(normalizeCode(e.target.value).slice(0, 8)))}
                    placeholder="ABCD-EFGH"
                    autoComplete="off"
                  />
                </label>
                <label>
                  {L('Your name', 'Dein Name')}
                  <input value={helper} onChange={(e) => setHelper(e.target.value.slice(0, 60))} />
                </label>
                <button className="btn primary big" disabled={busy || normalizeCode(code).length !== 8}>
                  {L('Join show', 'Show beitreten')}
                </button>
              </>
            )}
            {error && <p className="error">{error}</p>}
          </form>
        </div>

        <div className="panel">
          <h3>{L('Is this computer connected to a projector?', 'Hängt dieser Computer an einem Beamer?')}</h3>
          <p className="muted small">
            {L(
              'Open the projector view on it, enter the pairing code from your phone and press F11 for fullscreen.',
              'Öffne dort die Beamer-Ansicht, gib den Pairing-Code vom Handy ein und drücke F11 für Vollbild.',
            )}
          </p>
          <a className="btn" href="/display">
            {L('Open projector view', 'Beamer-Ansicht öffnen')}
          </a>
        </div>
      </div>
    </main>
  );
}
