/**
 * Ghost photos (zombie camera) for drawing: loaded once with the show's token, turned into a
 * ghostly look (pale blue-white, translucent, details kept so people recognise themselves) plus
 * a soft glow, cached per id.
 */
export interface GhostImage {
  img: HTMLCanvasElement;
  glow: HTMLCanvasElement;
}

export class GhostImages {
  private cache = new Map<string, GhostImage | 'loading' | 'failed'>();
  constructor(private token: () => string) {}

  get = (id: string): GhostImage | null => {
    const c = this.cache.get(id);
    if (c && c !== 'loading' && c !== 'failed') return c;
    if (!c) {
      this.cache.set(id, 'loading');
      void this.load(id);
    }
    return null;
  };

  /** Plain picture URL for thumbnails (object URL). */
  async url(id: string): Promise<string | null> {
    try {
      const res = await fetch(`/api/ghosts/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${this.token()}` },
      });
      if (!res.ok) return null;
      return URL.createObjectURL(await res.blob());
    } catch {
      return null;
    }
  }

  private async load(id: string): Promise<void> {
    try {
      const res = await fetch(`/api/ghosts/${encodeURIComponent(id)}`, {
        headers: { authorization: `Bearer ${this.token()}` },
      });
      if (!res.ok) throw new Error(String(res.status));
      const bmp = await createImageBitmap(await res.blob());
      const w = bmp.width;
      const h = bmp.height;
      const img = document.createElement('canvas');
      img.width = w;
      img.height = h;
      const g = img.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0);
      // the photo keeps its colours – a bit lifted so it glows on the dark scene
      const data = g.getImageData(0, 0, w, h);
      const d = data.data;
      for (let p = 0; p < d.length; p += 4) {
        d[p] = 24 + d[p]! * 0.95;
        d[p + 1] = 28 + d[p + 1]! * 0.95;
        d[p + 2] = 36 + d[p + 2]! * 0.95;
      }
      g.putImageData(data, 0, 0);
      const glow = document.createElement('canvas');
      const pad = Math.round(h * 0.08);
      glow.width = w + pad * 2;
      glow.height = h + pad * 2;
      const gg = glow.getContext('2d')!;
      gg.filter = `blur(${Math.max(3, Math.round(h / 30))}px) brightness(1.8)`;
      gg.drawImage(img, pad, pad);
      bmp.close();
      this.cache.set(id, { img, glow });
    } catch {
      this.cache.set(id, 'failed');
    }
  }
}

const perConn = new WeakMap<object, GhostImages>();
/** One shared cache per connection (show). */
export function ghostImagesFor(conn: { authToken: string }): GhostImages {
  let g = perConn.get(conn);
  if (!g) {
    g = new GhostImages(() => conn.authToken);
    perConn.set(conn, g);
  }
  return g;
}
