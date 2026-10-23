/**
 * Output masks, painted in output pixel space.
 * Composition order (documented, see SPEC D21):
 *   1. Start fully visible – or fully black if at least one enabled *include* mask exists,
 *      then paint all include masks visible.
 *   2. Paint cosmetic (non-safety) exclusions black, optionally feathered.
 *   3. Paint safety exclusions black with HARD edges, expanded by their safety margin.
 *   4. Paint crop margins black.
 * The renderer multiplies the final frame by this mask as the very last step.
 */
import type { Mask, Profile, Pt } from '@spectrastage/shared';

function shapePath(g: CanvasRenderingContext2D, m: Mask, w: number, h: number): void {
  g.beginPath();
  const pts = m.points.map((p) => ({ x: p.x * w, y: p.y * h }));
  if (m.shape === 'polygon') {
    pts.forEach((p, i) => (i === 0 ? g.moveTo(p.x, p.y) : g.lineTo(p.x, p.y)));
    g.closePath();
    return;
  }
  const a = pts[0] as Pt;
  const b = pts[1] ?? a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const rw = Math.abs(b.x - a.x);
  const rh = Math.abs(b.y - a.y);
  if (m.shape === 'rect') g.rect(x, y, rw, rh);
  else g.ellipse(x + rw / 2, y + rh / 2, Math.max(0.5, rw / 2), Math.max(0.5, rh / 2), 0, 0, Math.PI * 2);
}

export function paintMask(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  profile: Pick<Profile, 'masks' | 'crop' | 'blend'>,
): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.filter = 'none';
  g.globalCompositeOperation = 'source-over';
  const masks = profile.masks.filter((m) => m.enabled);
  const includes = masks.filter((m) => m.mode === 'include');
  g.fillStyle = includes.length > 0 ? '#000' : '#fff';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#fff';
  for (const m of includes) {
    shapePath(g, m, w, h);
    g.fill('evenodd');
  }
  // Dim regions: multiply brightness inside the shape by `level`.
  for (const m of masks.filter((x) => x.mode === 'dim')) {
    const v = Math.round(Math.max(0, Math.min(1, m.level ?? 0.5)) * 255);
    g.globalCompositeOperation = 'multiply';
    g.filter = m.feather > 0 ? `blur(${Math.round(m.feather * w)}px)` : 'none';
    g.fillStyle = `rgb(${v},${v},${v})`;
    shapePath(g, m, w, h);
    g.fill('evenodd');
    g.filter = 'none';
    g.globalCompositeOperation = 'source-over';
  }
  // Edge blending for overlapping projectors: smooth (gamma-corrected) ramps at the edges.
  const blend = profile.blend ?? [0, 0, 0, 0];
  const ramp = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    rx: number,
    ry: number,
    rw: number,
    rh: number,
  ) => {
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      const s = t * t * (3 - 2 * t);
      const v = Math.round(Math.pow(s, 1 / 2.2) * 255);
      grad.addColorStop(t, `rgb(${v},${v},${v})`);
    }
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = grad;
    g.fillRect(rx, ry, rw, rh);
    g.globalCompositeOperation = 'source-over';
  };
  const [bt, br, bb, bl] = blend.map((x) => Math.max(0, Math.min(0.5, x ?? 0)));
  if (bt! > 0) ramp(0, 0, 0, bt! * h, 0, 0, w, bt! * h);
  if (bb! > 0) ramp(0, h, 0, h - bb! * h, 0, h - bb! * h, w, bb! * h);
  if (bl! > 0) ramp(0, 0, bl! * w, 0, 0, 0, bl! * w, h);
  if (br! > 0) ramp(w, 0, w - br! * w, 0, w - br! * w, 0, br! * w, h);
  const excludes = masks.filter((m) => m.mode === 'exclude');
  g.fillStyle = '#000';
  g.strokeStyle = '#000';
  g.lineJoin = 'round';
  for (const m of excludes.filter((x) => !x.safety)) {
    g.filter = m.feather > 0 ? `blur(${Math.round(m.feather * w)}px)` : 'none';
    shapePath(g, m, w, h);
    g.fill('evenodd');
    if (m.margin > 0) {
      g.lineWidth = m.margin * w * 2;
      g.stroke();
    }
  }
  g.filter = 'none';
  for (const m of excludes.filter((x) => x.safety)) {
    shapePath(g, m, w, h);
    g.fill('evenodd');
    // Hard margin: stroke centered on the outline → expands the area by `margin`. +1px covers AA seams.
    g.lineWidth = Math.max(2, m.margin * w * 2 + 2);
    g.stroke();
  }
  const [top, right, bottom, left] = profile.crop;
  if (top > 0) g.fillRect(0, 0, w, Math.ceil(top * h));
  if (bottom > 0) g.fillRect(0, Math.floor(h - bottom * h), w, Math.ceil(bottom * h) + 1);
  if (left > 0) g.fillRect(0, 0, Math.ceil(left * w), h);
  if (right > 0) g.fillRect(Math.floor(w - right * w), 0, Math.ceil(right * w) + 1, h);
  g.restore();
}

/** Calibration overlay showing excluded areas (admin only, never in normal show mode). */
export function paintMaskOverlay(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  profile: Pick<Profile, 'masks'>,
): void {
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const m of profile.masks) {
    if (!m.enabled) continue;
    shapePath(g, m, w, h);
    g.save();
    g.clip('evenodd');
    g.strokeStyle =
      m.mode === 'include'
        ? 'rgba(80,255,140,0.55)'
        : m.mode === 'dim'
          ? 'rgba(120,170,255,0.6)'
          : 'rgba(255,60,60,0.6)';
    g.lineWidth = Math.max(1, w / 400);
    const step = Math.max(8, w / 60);
    g.beginPath();
    for (let x = -h; x < w; x += step) {
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
    }
    g.stroke();
    g.restore();
    shapePath(g, m, w, h);
    g.setLineDash([Math.max(6, w / 120), Math.max(4, w / 200)]);
    g.lineWidth = Math.max(2, w / 300);
    g.strokeStyle = m.mode === 'include' ? '#4dff8a' : m.mode === 'dim' ? '#78aaff' : '#ff3c3c';
    g.stroke();
    g.setLineDash([]);
    const c = m.points[0];
    if (c && m.name) {
      g.fillStyle = g.strokeStyle;
      g.font = `${Math.round(Math.max(12, w / 70))}px sans-serif`;
      g.fillText(m.name, c.x * w + 6, c.y * h + Math.max(14, w / 60));
    }
  }
  g.restore();
}
