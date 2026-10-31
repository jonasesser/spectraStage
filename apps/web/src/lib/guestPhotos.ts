/**
 * Guest photos (zombie camera): grouping the versions of one shot, downloading (single or as a
 * ZIP), fitting pictures under the server's upload limit and the ghost tail for flying ghosts.
 */

export type GhostKind = 'original' | 'filter' | 'ai';
export interface GhostEntry {
  id: string;
  at: number;
  kind?: GhostKind;
  group?: string;
}
/** One shot of one guest: without mask (original), with mask (filter) and optionally the AI one. */
export interface GuestPhoto {
  key: string;
  at: number;
  original?: string;
  filter?: string;
  ai?: string;
  /** all picture ids of this guest, in display order */
  ids: string[];
}

/** Groups the pictures per shot (newest first). Older pictures without a group stand alone. */
export function groupGuestPhotos(ghosts: readonly GhostEntry[]): GuestPhoto[] {
  const map = new Map<string, GuestPhoto>();
  for (const g of ghosts) {
    const key = g.group ?? `single-${g.id}`;
    let p = map.get(key);
    if (!p) {
      p = { key, at: g.at, ids: [] };
      map.set(key, p);
    }
    p.at = Math.min(p.at, g.at);
    const kind = g.kind ?? 'filter';
    if (!p[kind]) p[kind] = g.id;
  }
  const out = [...map.values()];
  for (const p of out) p.ids = [p.original, p.filter, p.ai].filter((x): x is string => !!x);
  return out.sort((a, b) => b.at - a.at);
}

export const KIND_LABEL: Record<GhostKind, [string, string]> = {
  original: ['Without mask', 'Ohne Maske'],
  filter: ['Mask', 'Maske'],
  ai: ['AI', 'KI'],
};

export async function fetchGhostBlob(token: string, id: string): Promise<Blob> {
  const res = await fetch(`/api/ghosts/${encodeURIComponent(id)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

export function extOf(type: string): string {
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg')) return 'jpg';
  if (type.includes('mp4')) return 'mp4';
  return 'png';
}

export function stamp(at: number): string {
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// --- ZIP (store only – the pictures are compressed already) ------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipFiles(files: { name: string; data: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    parts.push(local.buffer, name, f.data as Uint8Array<ArrayBuffer>);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint32(42, offset, true);
    const c = new Uint8Array(46 + name.length);
    c.set(new Uint8Array(cen.buffer), 0);
    c.set(name, 46);
    central.push(c);
    offset += 30 + name.length + f.data.length;
  }
  const size = central.reduce((s, c) => s + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end.buffer], {
    type: 'application/zip',
  });
}

/** Downloads guest photos: one picture directly, several as one ZIP. */
export async function downloadGuestPhotos(
  token: string,
  photos: readonly GuestPhoto[],
  only?: ReadonlySet<string>,
): Promise<number> {
  const items: { id: string; name: string }[] = [];
  photos.forEach((p, i) => {
    const n = photos.length - i;
    for (const kind of ['original', 'filter', 'ai'] as const) {
      const id = p[kind];
      if (!id || (only && !only.has(id))) continue;
      items.push({
        id,
        name: `gast-${String(n).padStart(3, '0')}_${stamp(p.at)}_${KIND_LABEL[kind][1].toLowerCase().replace(/ /g, '-')}`,
      });
    }
  });
  if (!items.length) return 0;
  if (items.length === 1) {
    const b = await fetchGhostBlob(token, items[0]!.id);
    downloadBlob(b, `${items[0]!.name}.${extOf(b.type)}`);
    return 1;
  }
  const files: { name: string; data: Uint8Array }[] = [];
  for (const it of items) {
    try {
      const b = await fetchGhostBlob(token, it.id);
      files.push({ name: `${it.name}.${extOf(b.type)}`, data: new Uint8Array(await b.arrayBuffer()) });
    } catch {
      // a picture that is gone (deleted meanwhile) is simply left out
    }
  }
  downloadBlob(zipFiles(files), `spectrastage-gaeste_${stamp(Date.now())}.zip`);
  return files.length;
}

// --- pictures for the server ---------------------------------------------------------------------
async function toCanvas(dataUrl: string): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

/** The server takes ghost photos up to ~1 MB: smaller in steps until it fits (WebP, else PNG). */
export async function fitForUpload(dataUrl: string, maxChars = 900_000): Promise<string> {
  if (dataUrl.length <= maxChars) return dataUrl;
  let c = await toCanvas(dataUrl);
  for (let step = 0; step < 8; step++) {
    let url = c.toDataURL('image/webp', 0.85);
    if (!url.startsWith('data:image/webp')) url = c.toDataURL('image/png');
    if (url.length <= maxChars || c.height < 160) return url;
    const k = Math.max(0.5, Math.sqrt(maxChars / url.length) * 0.95);
    const n = document.createElement('canvas');
    n.width = Math.max(1, Math.round(c.width * k));
    n.height = Math.max(1, Math.round(c.height * k));
    n.getContext('2d')!.drawImage(c, 0, 0, n.width, n.height);
    c = n;
  }
  return c.toDataURL('image/png');
}

/**
 * A real ghost: head and shoulders stay, below the shoulders the body narrows into a long,
 * curling tail that fades out – instead of a cut-off upper body like on a photo.
 * Works on the cut-out picture (transparent background).
 */
export async function ghostTail(dataUrl: string): Promise<string> {
  const src = await toCanvas(dataUrl);
  const W = src.width;
  const H = src.height;
  if (W < 8 || H < 8) return dataUrl;
  const d = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
  // opaque width per row (left/right edge)
  const left = new Int32Array(H).fill(-1);
  const right = new Int32Array(H).fill(-1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3]! > 60) {
        if (left[y]! < 0) left[y] = x;
        right[y] = x;
      }
  }
  let top = 0;
  while (top < H && left[top]! < 0) top++;
  let bottom = H - 1;
  while (bottom > top && left[bottom]! < 0) bottom--;
  const fig = bottom - top;
  if (fig < 20) return dataUrl;
  const width = (y: number) => (left[y]! < 0 ? 0 : right[y]! - left[y]! + 1);
  // head width: widest row in the upper fifth; shoulders: where it gets clearly wider below
  let head = 1;
  for (let y = top + Math.round(fig * 0.05); y < top + fig * 0.22; y++) head = Math.max(head, width(y));
  let shoulders = top + Math.round(fig * 0.45);
  for (let y = top + Math.round(fig * 0.22); y < top + fig * 0.7; y++)
    if (width(y) > head * 1.45) {
      shoulders = y;
      break;
    }
  // keep the shoulders a little, then the tail starts
  const start = Math.round(Math.min(top + fig * 0.62, Math.max(top + fig * 0.3, shoulders + fig * 0.07)));
  // centre of the body at the start
  let cx = W / 2;
  if (left[start]! >= 0) cx = (left[start]! + right[start]!) / 2;

  const tailLen = Math.round((H - start) * 1.35);
  const OH = start + tailLen;
  // the tail on its own canvas (the fade must not touch head and shoulders)
  const tail = document.createElement('canvas');
  tail.width = W;
  tail.height = tailLen;
  const tg = tail.getContext('2d')!;
  const sway = W * 0.09;
  const curl = Math.random() < 0.5 ? 1 : -1;
  for (let yo = 0; yo < tailLen; yo++) {
    const t = yo / tailLen;
    const sy = start + t * (H - 1 - start);
    // narrows towards a point, soft S-curve to the side
    const k = Math.max(0.035, 1 - 0.97 * Math.pow(t, 0.75));
    const off = curl * sway * Math.sin(t * Math.PI * 1.3) * t;
    tg.drawImage(src, 0, Math.floor(sy), W, 1, cx - cx * k + off, yo, W * k, 1);
  }
  // fade out towards the tip
  tg.globalCompositeOperation = 'destination-in';
  const grad = tg.createLinearGradient(0, 0, 0, tailLen);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.35, 'rgba(0,0,0,0.8)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  tg.fillStyle = grad;
  tg.fillRect(0, 0, W, tailLen);

  const out = document.createElement('canvas');
  out.width = W;
  out.height = OH;
  const g = out.getContext('2d')!;
  g.drawImage(src, 0, 0, W, start, 0, 0, W, start);
  g.drawImage(tail, 0, start);
  let url = out.toDataURL('image/webp', 0.88);
  if (!url.startsWith('data:image/webp')) url = out.toDataURL('image/png');
  return url;
}
