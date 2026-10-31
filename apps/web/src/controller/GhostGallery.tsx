import { useEffect, useState } from 'react';
import type { SessionState } from '@spectrastage/shared';
import type { Tr } from '../lib/i18n.tsx';
import { ghostImagesFor } from '../lib/ghostImages.ts';
import { downloadGuestPhotos, groupGuestPhotos, KIND_LABEL, type GuestPhoto } from '../lib/guestPhotos.ts';
import { useStore } from './store.ts';

/** Thumbnail URLs for the given picture ids (loaded once per id). */
export function useGhostUrls(ids: readonly string[]): Record<string, string> {
  const store = useStore();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const key = ids.join(',');
  useEffect(() => {
    let alive = true;
    const cache = ghostImagesFor(store.conn);
    for (const id of ids) {
      if (urls[id]) continue;
      void cache.url(id).then((u) => {
        if (alive && u) setUrls((m) => ({ ...m, [id]: u }));
      });
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return urls;
}

/** Every guest as one card: without mask, with mask and (if made) the AI picture side by side. */
export function GuestPhotoGroups({
  photos,
  urls,
  isOn,
  onPick,
  L,
}: {
  photos: readonly GuestPhoto[];
  urls: Record<string, string>;
  isOn: (id: string) => boolean;
  onPick: (id: string) => void;
  L: Tr;
}) {
  return (
    <div className="guest-groups">
      {photos.map((p) => (
        <div key={p.key} className="guest-card" title={new Date(p.at).toLocaleString()}>
          {(['original', 'filter', 'ai'] as const).map((kind) => {
            const id = p[kind];
            if (!id) return null;
            return (
              <button
                key={kind}
                className={`ghost-thumb${isOn(id) ? ' on' : ''}`}
                onClick={() => onPick(id)}
                aria-pressed={isOn(id)}
              >
                {urls[id] ? <img src={urls[id]} alt="" /> : <span>👻</span>}
                <small>{L(...KIND_LABEL[kind])}</small>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Saved guest photos: let them fly again (several at once), call them back, download, delete. */
export function GhostGallery({ state, L }: { state: SessionState; L: Tr }) {
  const store = useStore();
  const ghosts = state.ghosts ?? [];
  const photos = groupGuestPhotos(ghosts);
  const urls = useGhostUrls(photos.flatMap((p) => p.ids));
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const now = store.conn.clock.now();
  const flying = (state.ghostFlights ?? []).filter((f) => f.endAt > now).length;

  if (!photos.length)
    return (
      <p className="muted small" style={{ margin: 0 }}>
        {L('No ghost photos yet.', 'Noch keine Geister-Fotos.')}
      </p>
    );
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // (the pictures without mask are for faces on figures – they never fly as ghosts)
  const flyable = new Set(ghosts.filter((g) => g.kind !== 'original').map((g) => g.id));
  const release = (ids: string[]) =>
    void store.send({ t: 'ghost.release', ghostIds: ids.filter((id) => flyable.has(id)).slice(-12) });
  // per guest the best flying picture: AI, else the mask one
  const best = photos.map((p) => p.ai ?? p.filter).filter((x): x is string => !!x);
  const download = async (only?: string[]) => {
    setBusy(true);
    try {
      await downloadGuestPhotos(store.conn.authToken, photos, only ? new Set(only) : undefined);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack" style={{ gap: '0.5rem' }}>
      <strong className="small">
        👻 {L('Guest photos', 'Gäste-Fotos')} ({photos.length})
        {flying > 0 && ` · ${flying} ${L('flying', 'fliegen gerade')}`}
      </strong>
      <GuestPhotoGroups photos={photos} urls={urls} isOn={(id) => sel.includes(id)} onPick={toggle} L={L} />
      <div className="row">
        {sel.length > 0 ? (
          <>
            <button
              className="btn small primary"
              disabled={!sel.some((id) => flyable.has(id))}
              onClick={() => (release(sel), setSel([]))}
            >
              👻 {L('Let fly', 'Fliegen lassen')}
            </button>
            <button className="btn small" disabled={busy} onClick={() => void download(sel)}>
              ⬇ {L(`Download ${sel.length}`, `${sel.length} herunterladen`)}
            </button>
            <button
              className="btn small danger"
              onClick={() => {
                if (!window.confirm(L(`Delete ${sel.length} picture(s)?`, `${sel.length} Bild(er) löschen?`)))
                  return;
                for (const id of sel) void store.send({ t: 'ghost.delete', ghostId: id });
                setSel([]);
              }}
            >
              🗑 {L('Delete', 'Löschen')}
            </button>
            <button className="btn small ghost" onClick={() => setSel([])}>
              {L('Deselect', 'Auswahl aufheben')}
            </button>
          </>
        ) : (
          <>
            <button className="btn small" onClick={() => release(best.slice(0, 12))}>
              👻 {L('All fly (newest 12)', 'Alle fliegen lassen (neueste 12)')}
            </button>
            <button className="btn small" disabled={busy} onClick={() => void download()}>
              ⬇ {busy ? L('Packing …', 'Packe …') : L('Download all (ZIP)', 'Alle herunterladen (ZIP)')}
            </button>
          </>
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
