import { useState } from 'react';
import { catalog } from '@spectrastage/catalog/manifests';
import { defaultParams, type Playlist, type PlaylistItem, type SessionState } from '@spectrastage/shared';
import { useT, type Tr } from '../lib/i18n.tsx';
import { uuid } from '../lib/storage.ts';
import { useShow, useStore } from './store.ts';
import { kindLabel } from './ui.tsx';

export function PlaylistsView() {
  const L = useT();
  const store = useStore();
  const { state } = useShow();
  const [editing, setEditing] = useState<Playlist | null>(null);
  if (editing)
    return <PlaylistEditor initial={editing} state={state} L={L} onClose={() => setEditing(null)} />;
  const theme = catalog.get(state.defaultThemeId) ?? catalog.themes[0]!;
  return (
    <div className="stack">
      <section className="panel">
        <div className="section-title">
          <h2>{L('Playlists', 'Playlists')}</h2>
          <button
            className="btn small primary"
            onClick={() =>
              setEditing({
                id: uuid().slice(0, 16),
                name: L('New playlist', 'Neue Playlist'),
                kind: 'wall',
                loop: true,
                items: [],
              })
            }
          >
            ＋ {L('New', 'Neu')}
          </button>
        </div>
        {state.playlists.length === 0 && (
          <p className="muted">
            {L(
              'No playlists yet. Start from a template below.',
              'Noch keine Playlists. Starte mit einer Vorlage unten.',
            )}
          </p>
        )}
        <div className="list">
          {state.playlists.map((p) => {
            const playingOn = state.surfaces.filter(
              (s) => s.playback.mode === 'playlist' && s.playback.playlistId === p.id,
            );
            return (
              <div key={p.id} className="list-item">
                <div className="main">
                  <div className="title">{p.name}</div>
                  <div className="muted small">
                    {kindLabel(p.kind, L)} · {p.items.length} {L('scenes', 'Szenen')} ·{' '}
                    {Math.round(p.items.reduce((a, b) => a + b.durationSec, 0) / 60)} min
                    {p.loop ? ` · ${L('loop', 'Schleife')}` : ''}
                    {playingOn.length > 0 ? ` · ▶ ${playingOn.map((s) => s.name).join(', ')}` : ''}
                  </div>
                </div>
                <button className="btn small" onClick={() => setEditing(structuredClone(p))}>
                  {L('Edit', 'Bearbeiten')}
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => store.send({ t: 'playlist.duplicate', playlistId: p.id })}
                  aria-label={L('Duplicate', 'Duplizieren')}
                >
                  ⧉
                </button>
              </div>
            );
          })}
        </div>
      </section>
      <section className="panel">
        <h2>{L('Templates', 'Vorlagen')}</h2>
        <div className="list">
          {catalog.themes.flatMap((t) =>
            t.playlistTemplates.map((tpl) => (
              <div key={`${t.id}/${tpl.id}`} className="list-item">
                <span aria-hidden="true">{t.icon}</span>
                <div className="main">
                  <div className="title">{L.text(tpl.name)}</div>
                  <div className="muted small">
                    {kindLabel(tpl.kind, L)} · {tpl.items.length} {L('scenes', 'Szenen')}
                  </div>
                </div>
                <button
                  className="btn small"
                  onClick={() =>
                    store.send({ t: 'playlist.fromTemplate', themeId: t.id, templateId: tpl.id })
                  }
                >
                  {L('Add', 'Hinzufügen')}
                </button>
              </div>
            )),
          )}
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          {L('Theme:', 'Thema:')} {L.text(theme.name)}
        </p>
      </section>
    </div>
  );
}

function PlaylistEditor({
  initial,
  state,
  L,
  onClose,
}: {
  initial: Playlist;
  state: SessionState;
  L: Tr;
  onClose: () => void;
}) {
  const store = useStore();
  const [p, setP] = useState<Playlist>(initial);
  const exists = state.playlists.some((x) => x.id === p.id);
  const update = (i: number, patch: Partial<PlaylistItem>) =>
    setP((cur) => ({ ...cur, items: cur.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const move = (i: number, d: number) =>
    setP((cur) => {
      const items = [...cur.items];
      const j = i + d;
      if (j < 0 || j >= items.length) return cur;
      [items[i], items[j]] = [items[j]!, items[i]!];
      return { ...cur, items };
    });
  const addItem = () => {
    const theme = catalog.get(state.defaultThemeId) ?? catalog.themes[0]!;
    const sc = theme.scenes.find((s) => s.kinds.includes(p.kind)) ?? theme.scenes[0]!;
    setP((cur) => ({
      ...cur,
      items: [
        ...cur.items,
        {
          id: uuid().slice(0, 16),
          scene: { themeId: theme.id, sceneId: sc.id, params: defaultParams(sc.params) },
          durationSec: 120,
          transition: { type: 'crossfade', durationMs: 3000 },
          ambient: null,
        },
      ],
    }));
  };
  const save = async () => {
    if (await store.send({ t: 'playlist.save', playlist: { ...p, name: p.name.trim() || 'Playlist' } })) {
      store.toast(L('Playlist saved', 'Playlist gespeichert'));
      onClose();
    }
  };
  return (
    <div className="stack">
      <div className="row between">
        <button className="btn" onClick={onClose}>
          ‹ {L('Back', 'Zurück')}
        </button>
        <button className="btn primary" onClick={save}>
          {L('Save playlist', 'Playlist speichern')}
        </button>
      </div>
      <section className="panel stack">
        <label>
          {L('Name', 'Name')}
          <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value.slice(0, 60) })} />
        </label>
        <div className="row">
          {(['wall', 'floor', 'other'] as const).map((k) => (
            <button
              key={k}
              className={`chip${p.kind === k ? ' on' : ''}`}
              onClick={() => setP({ ...p, kind: k })}
            >
              {kindLabel(k, L)}
            </button>
          ))}
          <label className="check">
            <input
              type="checkbox"
              checked={p.loop}
              onChange={(e) => setP({ ...p, loop: e.target.checked })}
            />
            {L('Loop', 'Schleife')}
          </label>
        </div>
      </section>
      {p.items.map((it, i) => {
        const theme = catalog.get(it.scene.themeId);
        const effects = theme?.effects ?? [];
        const ambientOn = !!it.ambient;
        return (
          <section key={it.id} className="panel stack">
            <div className="row between">
              <h3 style={{ margin: 0 }}>
                {i + 1}. {theme?.scenes.find((s) => s.id === it.scene.sceneId)?.icon}{' '}
                {theme
                  ? L.text(theme.scenes.find((s) => s.id === it.scene.sceneId)?.name ?? { en: '?', de: '?' })
                  : '?'}
              </h3>
              <div className="row">
                <button
                  className="btn icon small"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={L('Move up', 'Nach oben')}
                >
                  ↑
                </button>
                <button
                  className="btn icon small"
                  onClick={() => move(i, 1)}
                  disabled={i === p.items.length - 1}
                  aria-label={L('Move down', 'Nach unten')}
                >
                  ↓
                </button>
                <button
                  className="btn icon small danger"
                  onClick={() => setP({ ...p, items: p.items.filter((_, j) => j !== i) })}
                  aria-label={L('Remove', 'Entfernen')}
                >
                  ✕
                </button>
              </div>
            </div>
            <label>
              {L('Scene', 'Szene')}
              <select
                value={`${it.scene.themeId}/${it.scene.sceneId}`}
                onChange={(e) => {
                  const [tid, sid] = e.target.value.split('/');
                  const sc = catalog.get(tid!)?.scenes.find((s) => s.id === sid);
                  if (sc)
                    update(i, {
                      scene: { themeId: tid!, sceneId: sc.id, params: defaultParams(sc.params) },
                      ambient: tid !== it.scene.themeId ? null : it.ambient,
                    });
                }}
              >
                {catalog.themes.map((t) => (
                  <optgroup key={t.id} label={L.text(t.name)}>
                    {t.scenes.map((s) => (
                      <option key={s.id} value={`${t.id}/${s.id}`}>
                        {s.icon} {L.text(s.name)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className="row">
              <label className="grow">
                {L('Duration (min)', 'Dauer (Min.)')}
                <input
                  type="number"
                  min={0.1}
                  step={0.5}
                  value={Math.round((it.durationSec / 60) * 10) / 10}
                  onChange={(e) =>
                    update(i, { durationSec: Math.max(5, Math.round(Number(e.target.value) * 60) || 60) })
                  }
                />
              </label>
              <label className="grow">
                {L('Transition', 'Übergang')}
                <select
                  value={it.transition.type}
                  onChange={(e) =>
                    update(i, {
                      transition: {
                        ...it.transition,
                        type: e.target.value as PlaylistItem['transition']['type'],
                      },
                    })
                  }
                >
                  <option value="crossfade">{L('Crossfade', 'Überblenden')}</option>
                  <option value="fadeBlack">{L('Through black', 'Über Schwarz')}</option>
                  <option value="cut">{L('Cut', 'Harter Schnitt')}</option>
                </select>
              </label>
              <label className="grow">
                {L('Fade (s)', 'Blende (s)')}
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.5}
                  value={it.transition.durationMs / 1000}
                  onChange={(e) =>
                    update(i, {
                      transition: {
                        ...it.transition,
                        durationMs: Math.max(0, Math.min(10000, Number(e.target.value) * 1000)),
                      },
                    })
                  }
                />
              </label>
            </div>
            <TimedCues item={it} kidsSafe={state.kidsSafe} L={L} onChange={(cues) => update(i, { cues })} />
            <label className="check">
              <input
                type="checkbox"
                checked={ambientOn}
                onChange={(e) =>
                  update(i, {
                    ambient: e.target.checked
                      ? {
                          effects: effects
                            .slice(0, 3)
                            .map((x) => ({ themeId: it.scene.themeId, effectId: x.id })),
                          minGapSec: 20,
                          maxGapSec: 45,
                        }
                      : null,
                  })
                }
              />
              {L('Random effects during this scene', 'Zufällige Effekte während dieser Szene')}
            </label>
            {it.ambient && (
              <>
                <div className="row">
                  {effects
                    .filter((e) => !state.kidsSafe || e.childSafe)
                    .map((e) => {
                      const on = it.ambient!.effects.some((x) => x.effectId === e.id);
                      return (
                        <button
                          key={e.id}
                          className={`chip${on ? ' on' : ''}`}
                          onClick={() =>
                            update(i, {
                              ambient: {
                                ...it.ambient!,
                                effects: on
                                  ? it.ambient!.effects.filter((x) => x.effectId !== e.id)
                                  : [...it.ambient!.effects, { themeId: it.scene.themeId, effectId: e.id }],
                              },
                            })
                          }
                        >
                          {e.icon} {L.text(e.name)}
                        </button>
                      );
                    })}
                </div>
                <div className="row">
                  <label className="grow">
                    {L('Every (s) at least', 'Alle (s) mindestens')}
                    <input
                      type="number"
                      min={3}
                      max={600}
                      value={it.ambient.minGapSec}
                      onChange={(e) =>
                        update(i, {
                          ambient: {
                            ...it.ambient!,
                            minGapSec: Math.max(3, Math.min(600, Number(e.target.value) || 20)),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="grow">
                    {L('at most', 'höchstens')}
                    <input
                      type="number"
                      min={3}
                      max={600}
                      value={it.ambient.maxGapSec}
                      onChange={(e) =>
                        update(i, {
                          ambient: {
                            ...it.ambient!,
                            maxGapSec: Math.max(3, Math.min(600, Number(e.target.value) || 45)),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </>
            )}
          </section>
        );
      })}
      <button className="btn" onClick={addItem}>
        ＋ {L('Add scene', 'Szene hinzufügen')}
      </button>
      {exists && (
        <button
          className="btn danger"
          onClick={async () => {
            if (
              window.confirm(L('Delete this playlist?', 'Diese Playlist löschen?')) &&
              (await store.send({ t: 'playlist.delete', playlistId: p.id }))
            )
              onClose();
          }}
        >
          {L('Delete playlist', 'Playlist löschen')}
        </button>
      )}
    </div>
  );
}

function fmtTime(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
}

function parseTime(v: string): number {
  const m = v.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m) return NaN;
  return m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]);
}

/** Effects at fixed times inside one playlist item, e.g. "Boo! at 0:30". */
function TimedCues({
  item,
  kidsSafe,
  L,
  onChange,
}: {
  item: PlaylistItem;
  kidsSafe: boolean;
  L: Tr;
  onChange: (cues: NonNullable<PlaylistItem['cues']>) => void;
}) {
  const cues = item.cues ?? [];
  const themeEffects = (catalog.get(item.scene.themeId)?.effects ?? []).filter(
    (e) => !kidsSafe || e.childSafe,
  );
  const allEffects = catalog.themes.flatMap((t) =>
    t.effects.filter((e) => !kidsSafe || e.childSafe).map((e) => ({ t, e })),
  );
  const set = (i: number, patch: Partial<NonNullable<PlaylistItem['cues']>[number]>) =>
    onChange(cues.map((c, j) => (j === i ? { ...c, ...patch } : c)).sort((a, b) => a.atSec - b.atSec));
  return (
    <div className="stack">
      <div className="muted small" style={{ fontWeight: 600 }}>
        {L('Effects at fixed times', 'Effekte zu festen Zeiten')}
      </div>
      {cues.map((c, i) => (
        <div key={i} className="row" style={{ flexWrap: 'nowrap' }}>
          <input
            aria-label={L('Time (m:ss)', 'Zeit (m:ss)')}
            defaultValue={fmtTime(c.atSec)}
            style={{ width: 80 }}
            onBlur={(e) => {
              const v = parseTime(e.target.value);
              if (Number.isFinite(v)) set(i, { atSec: Math.min(item.durationSec - 1, Math.max(0, v)) });
              else e.target.value = fmtTime(c.atSec);
            }}
          />
          <select
            className="grow"
            value={`${c.themeId}/${c.effectId}`}
            onChange={(e) => {
              const [themeId, effectId] = e.target.value.split('/');
              set(i, { themeId: themeId!, effectId: effectId! });
            }}
            aria-label={L('Effect', 'Effekt')}
          >
            {allEffects.map(({ t, e }) => (
              <option key={`${t.id}/${e.id}`} value={`${t.id}/${e.id}`}>
                {e.icon} {L.text(e.name)}
              </option>
            ))}
          </select>
          <button
            className="btn icon small danger"
            aria-label={L('Remove', 'Entfernen')}
            onClick={() => onChange(cues.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      <div>
        <button
          className="btn small"
          disabled={themeEffects.length === 0 || cues.length >= 50}
          onClick={() => {
            const last = cues[cues.length - 1]?.atSec ?? 0;
            const at = Math.min(item.durationSec - 1, last + 30);
            onChange([...cues, { atSec: at, themeId: item.scene.themeId, effectId: themeEffects[0]!.id }]);
          }}
        >
          ＋ {L('Effect at a time', 'Effekt zu einer Zeit')}
        </button>
      </div>
    </div>
  );
}
