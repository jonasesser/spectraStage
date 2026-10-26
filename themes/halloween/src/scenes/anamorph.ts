/**
 * Things standing on the real floor (jack-o'-lanterns along the path …) painted for the audience:
 * stretched away from the viewer like 3D street art, so from the standpoint (Stage → room) they
 * look upright instead of lying flat like a sticker. Exact per horizontal strip of the picture.
 */
import type { DrawState } from '@spectrastage/engine';
import type { RoomFace } from '@spectrastage/shared';

let spr: HTMLCanvasElement | null = null;
let sg: CanvasRenderingContext2D | null = null;

export interface FloorView {
  f: RoomFace;
  eye: [number, number, number];
}

/** The floor face being drawn and the audience's eye point (null: not a floor / no viewer). */
export function floorView(s: DrawState): FloorView | null {
  const w = s.world;
  if (!w?.viewer) return null;
  const f = w.room.faces.find((x) => x.id === w.self.id);
  if (!f || f.role !== 'ground') return null;
  return { f, eye: w.viewer };
}

/**
 * Paints something standing at the floor point (X, Y) (stage meters) so it looks upright from the
 * eye point. `paint` draws it into a square sprite of `size` px: centred horizontally, its foot at
 * row `foot`. Sprite pixels are scene pixels (same ppm).
 */
export function drawStanding(
  g: CanvasRenderingContext2D,
  s: DrawState,
  v: FloorView,
  X: number,
  Y: number,
  size: number,
  foot: number,
  paint: (q: CanvasRenderingContext2D) => void,
): void {
  const S = Math.max(4, Math.ceil(size));
  if (!spr || !sg) {
    spr = document.createElement('canvas');
    sg = spr.getContext('2d');
    if (!sg) return;
  }
  if (spr.width < S || spr.height < S) {
    spr.width = Math.max(spr.width, S);
    spr.height = Math.max(spr.height, S);
  }
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.clearRect(0, 0, S, S);
  paint(sg);

  const { f, eye } = v;
  const ppm = s.ppm;
  const r = f.rect;
  const P: [number, number, number] = [
    f.o[0] + f.ax[0] * (X - r.x) + f.ay[0] * (Y - r.y),
    0,
    f.o[2] + f.ax[2] * (X - r.x) + f.ay[2] * (Y - r.y),
  ];
  const dx = P[0] - eye[0];
  const dz = P[2] - eye[2];
  const dist = Math.hypot(dx, dz);
  const H = eye[1];
  const toPx = (qx: number, qz: number): [number, number] => {
    const ox = qx - f.o[0];
    const oz = qz - f.o[2];
    return [(ox * f.ax[0] + oz * f.ax[2]) * ppm, (ox * f.ay[0] + oz * f.ay[2]) * ppm];
  };
  if (dist < 0.05 || H <= 0.1) {
    const [x, y] = toPx(P[0], P[2]);
    g.drawImage(spr, 0, 0, S, S, x - S / 2, y - foot, S, S);
    return;
  }
  // the viewer's right on the floor, in scene pixels per sprite pixel (before the depth factor)
  const rx = -dz / dist;
  const rz = dx / dist;
  const lat: [number, number] = [rx * f.ax[0] + rz * f.ax[2], rx * f.ay[0] + rz * f.ay[2]];
  // a sprite row at height h (meters above the floor) lands t(h) times as far from the viewer
  const tOf = (row: number) => {
    const h = Math.min(H * 0.85, (foot - row) / ppm);
    return H / (H - h);
  };
  const at = (row: number) => {
    const t = tOf(row);
    return toPx(eye[0] + dx * t, eye[2] + dz * t);
  };
  const N = 16;
  for (let i = 0; i < N; i++) {
    const y0 = (S * i) / N;
    const y1 = (S * (i + 1)) / N;
    const A0 = at(y0);
    const A1 = at(y1);
    const tm = tOf((y0 + y1) / 2);
    const a = lat[0] * tm;
    const b = lat[1] * tm;
    const c = (A1[0] - A0[0]) / (y1 - y0);
    const d = (A1[1] - A0[1]) / (y1 - y0);
    g.save();
    g.transform(a, b, c, d, A0[0] - a * (S / 2) - c * y0, A0[1] - b * (S / 2) - d * y0);
    // a hair of overlap so the strips do not show seams
    g.drawImage(spr, 0, y0, S, y1 - y0, 0, y0, S, y1 - y0 + 0.6);
    g.restore();
  }
}
