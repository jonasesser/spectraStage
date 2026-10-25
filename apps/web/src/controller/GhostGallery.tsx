import { useEffect, useState } from 'react';
import type { SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { useStore } from './store.ts';

/** Saved ghost photos: let them fly again (several at once), call them back, delete them. */
export function GhostGallery({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const ghosts = state.ghosts ?? [];
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string[]>([]);
  const now = store.conn.clock.now();
  const flying = (state.ghostFlights ?? []).filter((f) => f.endAt > now).length;

  useEffect(() => {
    let alive = true;
    const cache = ghostImagesFor(store.conn);
    for (const g of ghosts) {
      if (urls[g.id]) continue;
      void cache.url(g.id).then((u) => {
        if (alive && u) setUrls((m) => ({ ...m, [g.id]: u }));
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ghosts.map((g) => g.id).join(',')]);

  if (!ghosts.length)
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {L('No ghost photos yet.', 'Noch keine Geister-Fotos.')}
      </p>
    );
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const release = (ids: string[]) => void store.send({ t: 'ghost.release', ghostIds: ids.slice(-12) });
  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <strong className="small">
        👻 {L('Saved ghosts', 'Gespeicherte Geister')} ({ghosts.length})
        {flying > 0 && ` · ${flying} ${L('flying', 'fliegen gerade')}`}
      </strong>
      <div className="ghost-grid">
        {[...ghosts].reverse().map((g) => (
          <button
            key={g.id}
            className={`ghost-thumb${sel.includes(g.id) ? ' on' : ''}`}
            onClick={() => toggle(g.id)}
            aria-pressed={sel.includes(g.id)}
            title={new Date(g.at).toLocaleString()}
          >
            {urls[g.id] ? <img src={urls[g.id]} alt="" /> : <span>👻</span>}
          </button>
        ))}
      </div>
      <div className="row">
        {sel.length > 0 ? (
          <>
            <button className="btn small primary" onClick={() => (release(sel), setSel([]))}>
              👻 {L(`Release ${sel.length}`, `${sel.length} freilassen`)}
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (
                  !window.confirm(
                    L(`Delete ${sel.length} ghost photo(s)?`, `${sel.length} Geister-Foto(s) löschen?`),
                  )
                )
                  return;
                for (const id of sel) void store.send({ t: 'ghost.delete', ghostId: id });
                setSel([]);
              }}
            >
              🗑 {L('Delete', 'Löschen')}
            </button>
          </>
        ) : (
          <button className="btn small" onClick={() => release(ghosts.map((g) => g.id))}>
            👻 {L('Release all (newest 12)', 'Alle freilassen (neueste 12)')}
          </button>
        )}
        {flying > 0 && (
          <button className="btn small" onClick={() => void store.send({ t: 'ghost.stopFlights' })}>
            {L('Call them back', 'Zurückrufen')}
          </button>
        )}
        <button
          className="btn small ghost"
          onClick={() => {
            if (
              !window.confirm(
                L('Delete ALL ghost photos of this show?', 'ALLE Geister-Fotos dieser Show löschen?'),
              )
            )
              return;
            void store.send({ t: 'ghost.deleteAll' });
            setSel([]);
          }}
        >
          {L('Delete all', 'Alle löschen')}
        </button>
      </div>
    </div>
  );
}
