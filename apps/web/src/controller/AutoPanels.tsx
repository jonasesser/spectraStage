import { useEffect, useRef, useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import type { Schedule, ScheduleEntry, SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { uuid } from '../lib/storage.ts';
import { useStore } from './store.ts';
import { Slider } from './ui.tsx';

/** Dusk visibility boost: brighter, more saturated output while it is not fully dark yet. */
export function BoostPanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const [value, setValue] = useState(Math.round((state.boost ?? 0) * 100));
  const timer = useRef(0);
  useEffect(() => setValue(Math.round((state.boost ?? 0) * 100)), [state.boost]);
  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>{L('Dusk boost', 'Dämmerungs-Boost')}</h2>
        <span className="muted small">
          {value === 0 ? L('off – for full darkness', 'aus – für volle Dunkelheit') : ''}
        </span>
      </div>
      <Slider
        label={L('Brightness & color strength', 'Helligkeit & Farbkraft')}
        value={value}
        min={0}
        max={100}
        step={5}
        format={(v) => `${v} %`}
        onChange={(v) => {
          setValue(v);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => store.send({ t: 'session.setBoost', boost: v / 100 }), 200);
        }}
      />
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'While it is still getting dark, raise the boost and use the Neon show: large bright areas stay visible, black stays black. Creatures get glowing outlines.',
          'Solange es noch dämmert: Boost hoch und die Neon-Show nehmen. Große helle Flächen bleiben sichtbar, Schwarz bleibt schwarz. Kreaturen bekommen leuchtende Konturen.',
        )}
      </p>
    </section>
  );
}

function defaultTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Berlin';
  } catch {
    return 'Europe/Berlin';
  }
}

const presetOptions = () =>
  catalog.themes.flatMap((t) => t.presets.map((p) => ({ value: `preset:${t.id}/${p.id}`, t, p })));

/** One-shot scenes that can be played in by the schedule (videos need an upload, so not here). */
const insertOptions = () =>
  catalog.themes.flatMap((t) =>
    t.scenes
      .filter((sc) => sc.oneShotSec && !sc.params.some((p) => p.type === 'video'))
      .map((sc) => ({ value: `insert:${t.id}/${sc.id}`, t, sc })),
  );

function entryValue(e: ScheduleEntry): string {
  if (e.blackout === true) return 'blackout';
  if (e.insert) return `insert:${e.insert.themeId}/${e.insert.sceneId}`;
  if (e.playlistId) return `playlist:${e.playlistId}`;
  if (e.themeId && e.presetId) return `preset:${e.themeId}/${e.presetId}`;
  return '';
}

const newEntry = (at: string, patch: Partial<ScheduleEntry>): ScheduleEntry => ({
  id: uuid().slice(0, 12),
  at,
  themeId: null,
  presetId: null,
  playlistId: null,
  insert: null,
  boost: null,
  blackout: null,
  ...patch,
});

/**
 * Long kid-friendly evening (late October, sunset ~16:45): bright Neon show with full boost from
 * 16:00, boost steps down as it gets dark, then the full world show with the little witch, the cute
 * monster and the bride & groom played in regularly; calm atmosphere and blackout at the end.
 */
function longShow(themeId: string): ScheduleEntry[] {
  const show = (at: string, presetId: string, boost: number | null, blackout: boolean | null = null) =>
    newEntry(at, { themeId, presetId, boost, blackout });
  const boost = (at: string, b: number) => newEntry(at, { boost: b });
  const ins = (at: string, sceneId: string) => newEntry(at, { insert: { themeId, sceneId } });
  return [
    show('16:00', 'neonShow', 1, false),
    boost('16:30', 0.85),
    boost('17:00', 0.7),
    ins('17:15', 'wallWitch'),
    boost('17:30', 0.5),
    show('17:45', 'fullShow', 0.3),
    ins('18:00', 'wallBuddyDance'),
    boost('18:15', 0.15),
    ins('18:30', 'wallWitch'),
    boost('18:45', 0),
    ins('19:00', 'wallCouple'),
    ins('19:20', 'wallBuddyDance'),
    ins('19:40', 'wallWitch'),
    ins('20:00', 'wallCouple'),
    ins('20:20', 'wallBuddyDance'),
    ins('20:40', 'wallWitch'),
    show('21:00', 'quietAtmosphere', 0),
    newEntry('21:30', { blackout: true }),
  ];
}

/** Auto mode: switch shows / playlists, play in one-shots, boost and blackout at fixed local times. */
export function SchedulePanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const theme = catalog.get(state.defaultThemeId) ?? catalog.themes[0]!;
  const hasLong =
    theme.presets.some((p) => p.id === 'neonShow') && theme.scenes.some((x) => x.id === 'wallWitch');
  const suggestion = (): Omit<Schedule, 'lastApplied'> => ({
    enabled: false,
    timezone: defaultTimezone(),
    entries: hasLong
      ? longShow(theme.id)
      : [
          newEntry('17:30', {
            themeId: theme.id,
            presetId: theme.presets[0]!.id,
            boost: 0.8,
            blackout: false,
          }),
          newEntry('21:00', { blackout: true }),
        ],
  });
  const [draft, setDraft] = useState<Omit<Schedule, 'lastApplied'>>(() => state.schedule ?? suggestion());
  const savedJson = JSON.stringify(
    state.schedule ? { ...state.schedule, lastApplied: undefined, lastInserted: undefined } : null,
  );
  useEffect(() => {
    if (state.schedule) setDraft(state.schedule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJson]);
  const dirty = JSON.stringify({ ...draft, lastApplied: undefined, lastInserted: undefined }) !== savedJson;
  const save = (s: Omit<Schedule, 'lastApplied'>) =>
    store.send({
      t: 'session.setSchedule',
      schedule: { enabled: s.enabled, timezone: s.timezone, entries: s.entries },
    });
  const update = (i: number, patch: Partial<ScheduleEntry>) =>
    setDraft((d) => ({ ...d, entries: d.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const sorted = [...draft.entries].map((e, i) => ({ e, i })).sort((a, b) => (a.e.at < b.e.at ? -1 : 1));
  const activeId = state.schedule?.lastApplied?.split('|')[1];
  const playlists = [...state.playlists].sort((a, b) => a.name.localeCompare(b.name));
  const isTpl = (id: string) => id.startsWith('tpl-');

  return (
    <section className="panel stack">
      <div className="section-title">
        <h2>{L('Auto mode (schedule)', 'Automatik (Zeitplan)')}</h2>
        <label className="check" style={{ minHeight: 36 }}>
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => {
              const next = { ...draft, enabled: e.target.checked };
              setDraft(next);
              void save(next);
            }}
          />
          {draft.enabled ? L('on', 'an') : L('off', 'aus')}
        </label>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L(
          'At each time the show switches by itself – e.g. bright Neon show at dusk, normal show when it is dark, blackout at the end. "Play in once" entries (witch, monster …) appear once and the show goes on. Times can be changed any time, also during the show – after saving, the running show only restarts if its own entry changed. Runs on the server, the phone can be off.',
          'Zu jeder Uhrzeit schaltet die Show von selbst um – z. B. helle Neon-Show in der Dämmerung, normale Show bei Dunkelheit, Blackout am Ende. „Einmal einspielen“ (Hexe, Monster …) kommt einmal, danach läuft die Show weiter. Zeiten jederzeit änderbar, auch während der Show – nach dem Speichern startet die laufende Show nur neu, wenn ihr eigener Eintrag geändert wurde. Läuft auf dem Server, das Handy darf aus sein.',
        )}
      </p>
      {sorted.map(({ e, i }) => (
        <div
          key={e.id}
          className="list-item"
          style={{
            flexWrap: 'wrap',
            borderColor: e.id === activeId && draft.enabled ? 'var(--lantern)' : undefined,
          }}
        >
          <input
            type="time"
            value={e.at}
            onChange={(ev) => ev.target.value && update(i, { at: ev.target.value.slice(0, 5) })}
            aria-label={L('Time', 'Uhrzeit')}
            style={{
              background: 'var(--night-deep)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              minHeight: 44,
              padding: '0 0.5rem',
              color: 'var(--ink)',
            }}
          />
          <select
            className="grow"
            value={entryValue(e)}
            onChange={(ev) => {
              const v = ev.target.value;
              const clear = { themeId: null, presetId: null, playlistId: null, insert: null };
              if (v === 'blackout') update(i, { ...clear, blackout: true, boost: null });
              else if (!v) update(i, { ...clear, blackout: e.blackout === true ? false : e.blackout });
              else if (v.startsWith('playlist:'))
                update(i, { ...clear, playlistId: v.slice(9), blackout: false });
              else if (v.startsWith('insert:')) {
                const [t, sc] = v.slice(7).split('/');
                update(i, { ...clear, insert: { themeId: t!, sceneId: sc! }, boost: null, blackout: null });
              } else {
                const [t, p] = v.slice(7).split('/');
                update(i, { ...clear, themeId: t!, presetId: p!, blackout: false });
              }
            }}
            aria-label={L('What happens', 'Was passiert')}
          >
            <option value="">{L('Keep show, only change boost', 'Show behalten, nur Boost ändern')}</option>
            {playlists.length > 0 && (
              <optgroup label={L('🎞 Playlists (as edited by you)', '🎞 Playlists (so wie bearbeitet)')}>
                {playlists.map((p) => (
                  <option key={p.id} value={`playlist:${p.id}`}>
                    🎞 {p.name}
                    {isTpl(p.id) ? L(' · from template', ' · aus Vorlage') : L(' · own', ' · eigene')}
                  </option>
                ))}
              </optgroup>
            )}
            <optgroup label={L('📋 Templates (show presets)', '📋 Vorlagen (Show-Presets)')}>
              {presetOptions().map(({ value, t, p }) => (
                <option key={value} value={value}>
                  {L('Template', 'Vorlage')}: {p.icon} {L.text(p.name)}
                  {catalog.themes.length > 1 ? ` (${L.text(t.name)})` : ''}
                </option>
              ))}
            </optgroup>
            <optgroup label={L('✨ Play in once (show goes on)', '✨ Einmal einspielen (Show läuft weiter)')}>
              {insertOptions().map(({ value, sc }) => (
                <option key={value} value={value}>
                  {sc.icon} {L.text(sc.name)}
                </option>
              ))}
            </optgroup>
            <option value="blackout">⬛ {L('Blackout (end of show)', 'Blackout (Showende)')}</option>
          </select>
          {e.blackout !== true && !e.insert && (
            <select
              value={e.boost === null ? '' : String(Math.round(e.boost * 100))}
              onChange={(ev) =>
                update(i, { boost: ev.target.value === '' ? null : Number(ev.target.value) / 100 })
              }
              aria-label={L('Dusk boost', 'Dämmerungs-Boost')}
            >
              <option value="">{L('Boost unchanged', 'Boost unverändert')}</option>
              {[0, 25, 50, 75, 100].map((v) => (
                <option key={v} value={v}>
                  {L('Boost', 'Boost')} {v} %
                </option>
              ))}
            </select>
          )}
          <button
            className="btn icon small danger"
            aria-label={L('Remove', 'Entfernen')}
            onClick={() => setDraft((d) => ({ ...d, entries: d.entries.filter((_, j) => j !== i) }))}
          >
            ✕
          </button>
        </div>
      ))}
      <div className="row">
        <button
          className="btn small"
          disabled={draft.entries.length >= 24}
          onClick={() =>
            setDraft((d) => ({
              ...d,
              entries: [...d.entries, newEntry('20:00', {})],
            }))
          }
        >
          ＋ {L('Add time', 'Uhrzeit hinzufügen')}
        </button>
        {hasLong && (
          <button
            className="btn small"
            onClick={() =>
              (draft.entries.length === 0 ||
                window.confirm(
                  L(
                    'Replace the times with the long show (16:00 – 21:30)? Saved only when you tap Save.',
                    'Zeiten durch die lange Show (16:00 – 21:30) ersetzen? Gespeichert wird erst mit „Speichern“.',
                  ),
                )) &&
              setDraft((d) => ({ ...d, entries: longShow(theme.id) }))
            }
          >
            🎃 {L('Long show 16–21:30', 'Lange Show 16–21:30')}
          </button>
        )}
        <button className="btn small primary" disabled={!dirty} onClick={() => save(draft)}>
          {L('Save schedule', 'Zeitplan speichern')}
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {L('Time zone', 'Zeitzone')}: {draft.timezone}
        {state.schedule?.lastApplied && draft.enabled
          ? ` · ${L('active since', 'aktiv seit')} ${draft.entries.find((e) => e.id === activeId)?.at ?? '–'}`
          : ''}
      </p>
    </section>
  );
}
