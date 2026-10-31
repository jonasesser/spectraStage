/**
 * The show's uploaded videos on a projector PC: loaded ahead (with the show's token) as local
 * object URLs, so a video played in starts at once and every PC has it.
 */
export class ShowVideos {
  private cache = new Map<string, string | 'loading' | 'failed'>();
  constructor(private token: () => string) {}

  url = (id: string): string | null => {
    const c = this.cache.get(id);
    if (c && c !== 'loading' && c !== 'failed') return c;
    if (!c) this.load(id);
    return null;
  };

  /** Load these (new ones), forget the others. */
  sync(ids: readonly string[]): void {
    for (const id of ids) if (!this.cache.has(id)) this.load(id);
    for (const [id, v] of this.cache)
      if (!ids.includes(id)) {
        if (v !== 'loading' && v !== 'failed') URL.revokeObjectURL(v);
        this.cache.delete(id);
      }
  }

  private load(id: string): void {
    this.cache.set(id, 'loading');
    void fetch(`/api/videos/${encodeURIComponent(id)}`, {
      headers: { authorization: `Bearer ${this.token()}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (this.cache.get(id) === 'loading') this.cache.set(id, URL.createObjectURL(blob));
      })
      .catch(() => {
        if (this.cache.get(id) === 'loading') this.cache.set(id, 'failed');
      });
  }
}

const perConn = new WeakMap<object, ShowVideos>();
export function showVideosFor(conn: { authToken: string }): ShowVideos {
  let v = perConn.get(conn);
  if (!v) {
    v = new ShowVideos(() => conn.authToken);
    perConn.set(conn, v);
  }
  return v;
}

/** Fetches a sound recording (own uploads need the show's token; library files are public). */
export function soundFetcher(conn: { authToken: string } | null): (url: string) => Promise<ArrayBuffer> {
  return (url) =>
    fetch(
      url,
      conn && url.startsWith('/api/') ? { headers: { authorization: `Bearer ${conn.authToken}` } } : {},
    ).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.arrayBuffer();
    });
}
