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
  catalog.themes.flatMap((t) => t.presets.map((p) => ({ value: `${t.id}/${p.id}`, t, p })));

/** Auto mode: switch presets, boost and blackout at fixed local times. */
export function SchedulePanel({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const theme = catalog.get(state.defaultThemeId) ?? catalog.themes[0]!;
  const suggestion = (): Omit<Schedule, 'lastApplied'> => ({
    enabled: false,
    timezone: defaultTimezone(),
    entries: [
      {
        id: uuid().slice(0, 12),
        at: '17:30',
        themeId: theme.id,
        presetId: theme.presets.find((p) => p.id === 'neonShow')?.id ?? theme.presets[0]!.id,
        boost: 0.8,
        blackout: false,
      },
      {
        id: uuid().slice(0, 12),
        at: '18:30',
        themeId: theme.id,
        presetId: theme.presets[0]!.id,
        boost: 0,
        blackout: null,
      },
      { id: uuid().slice(0, 12), at: '21:00', themeId: null, presetId: null, boost: null, blackout: true },
    ],
  });
  const [draft, setDraft] = useState<Omit<Schedule, 'lastApplied'>>(() => state.schedule ?? suggestion());
  const savedJson = JSON.stringify(state.schedule ? { ...state.schedule, lastApplied: undefined } : null);
  useEffect(() => {
    if (state.schedule) setDraft(state.schedule);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedJson]);
  const dirty = JSON.stringify({ ...draft, lastApplied: undefined }) !== savedJson;
  const save = (s: Omit<Schedule, 'lastApplied'>) =>
    store.send({
      t: 'session.setSchedule',
      schedule: { enabled: s.enabled, timezone: s.timezone, entries: s.entries },
    });
  const update = (i: number, patch: Partial<ScheduleEntry>) =>
    setDraft((d) => ({ ...d, entries: d.entries.map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const sorted = [...draft.entries].map((e, i) => ({ e, i })).sort((a, b) => (a.e.at < b.e.at ? -1 : 1));
  const activeId = state.schedule?.lastApplied?.split('|')[1];

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
          'At each time the show switches by itself – e.g. bright Neon show at dusk, normal show when it is dark, blackout at the end. Runs on the server, the phone can be off.',
          'Zu jeder Uhrzeit schaltet die Show von selbst um – z. B. helle Neon-Show in der Dämmerung, normale Show bei Dunkelheit, Blackout am Ende. Läuft auf dem Server, das Handy darf aus sein.',
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
            value={
              e.blackout === true ? 'blackout' : e.themeId && e.presetId ? `${e.themeId}/${e.presetId}` : ''
            }
            onChange={(ev) => {
              const v = ev.target.value;
              if (v === 'blackout') update(i, { themeId: null, presetId: null, blackout: true, boost: null });
              else if (!v)
                update(i, {
                  themeId: null,
                  presetId: null,
                  blackout: e.blackout === true ? false : e.blackout,
                });
              else {
                const [t, p] = v.split('/');
                update(i, { themeId: t!, presetId: p!, blackout: false });
              }
            }}
            aria-label={L('What happens', 'Was passiert')}
          >
            <option value="">{L('Keep show, only change boost', 'Show behalten, nur Boost ändern')}</option>
            {presetOptions().map(({ value, t, p }) => (
              <option key={value} value={value}>
                {p.icon} {L.text(p.name)}
                {catalog.themes.length > 1 ? ` (${L.text(t.name)})` : ''}
              </option>
            ))}
            <option value="blackout">⬛ {L('Blackout (end of show)', 'Blackout (Showende)')}</option>
          </select>
          {e.blackout !== true && (
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
              entries: [
                ...d.entries,
                {
                  id: uuid().slice(0, 12),
                  at: '20:00',
                  themeId: theme.id,
                  presetId: theme.presets[0]!.id,
                  boost: null,
                  blackout: false,
                },
              ],
            }))
          }
        >
          ＋ {L('Add time', 'Uhrzeit hinzufügen')}
        </button>
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
