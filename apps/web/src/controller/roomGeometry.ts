/**
 * Folds the unfolded stage back into a 3D room, for the 3D room view.
 *
 * Walls (main + side, in stage-x order) are placed one after another on the floor plan; between
 * walls that touch in the unfolded layout there is a corner (90°, or 360°/n in room mode), walls
 * with a gap continue straight. A floor laid out below a wall becomes the ground in front of it,
 * a ceiling laid out above a wall becomes the ceiling over the room. Plan coordinates: x/z on the
 * ground, y up, walls face the inside (+normal).
 */
import { worldLayout, type Surface } from '@spectrastage/shared';

export type V3 = [number, number, number];
type Rect = { x: number; y: number; w: number; h: number };

interface WallPlace {
  id: string;
  rect: Rect;
  start: [number, number];
  dir: [number, number];
  normal: [number, number];
}

export interface RoomGeometry {
  /** Maps a stage point of a surface to 3D, or null if that surface is not placed. */
  map: (surfaceId: string, x: number, y: number) => V3 | null;
  placed: Set<string>;
  camera: V3;
  lookAt: V3;
}

const rot = (d: [number, number], a: number): [number, number] => [
  d[0] * Math.cos(a) - d[1] * Math.sin(a),
  d[0] * Math.sin(a) + d[1] * Math.cos(a),
];

export function roomGeometry(surfaces: readonly Surface[], room: boolean): RoomGeometry {
  const lay = worldLayout(surfaces);
  const walls = lay.filter((w) => w.role === 'main' || w.role === 'side').sort((a, b) => a.rect.x - b.rect.x);
  const turn = room && walls.length >= 3 ? (Math.PI * 2) / walls.length : Math.PI / 2;
  const places: WallPlace[] = [];
  let p: [number, number] = [0, 0];
  let d: [number, number] = [1, 0];
  walls.forEach((w, i) => {
    if (i > 0) {
      const prev = walls[i - 1]!.rect;
      const gap = w.rect.x - (prev.x + prev.w);
      if (Math.abs(gap) < 0.3) d = rot(d, turn);
      else p = [p[0] + d[0] * gap, p[1] + d[1] * gap];
    }
    places.push({ id: w.id, rect: w.rect, start: p, dir: d, normal: rot(d, Math.PI / 2) });
    p = [p[0] + d[0] * w.rect.w, p[1] + d[1] * w.rect.w];
  });
  const byId = new Map(places.map((w) => [w.id, w]));
  const parent = new Map<string, { wall: WallPlace; kind: 'ground' | 'ceiling' }>();
  for (const s of lay) {
    if (s.role !== 'ground' && s.role !== 'ceiling') continue;
    const overlap = (w: WallPlace) => s.rect.x < w.rect.x + w.rect.w && s.rect.x + s.rect.w > w.rect.x;
    const wall =
      s.role === 'ground'
        ? places.find((w) => overlap(w) && Math.abs(s.rect.y - (w.rect.y + w.rect.h)) < 0.6)
        : places.find((w) => overlap(w) && Math.abs(s.rect.y + s.rect.h - w.rect.y) < 0.6);
    if (wall) parent.set(s.id, { wall, kind: s.role });
  }

  const map = (id: string, x: number, y: number): V3 | null => {
    const w = byId.get(id);
    if (w) {
      const a = x - w.rect.x;
      return [w.start[0] + w.dir[0] * a, w.rect.y + w.rect.h - y, w.start[1] + w.dir[1] * a];
    }
    const pr = parent.get(id);
    if (!pr) return null;
    const pw = pr.wall;
    const a = x - pw.rect.x;
    const depth = pr.kind === 'ground' ? y - (pw.rect.y + pw.rect.h) : pw.rect.y - y;
    const h = pr.kind === 'ground' ? 0 : pw.rect.h;
    return [
      pw.start[0] + pw.dir[0] * a + pw.normal[0] * depth,
      h,
      pw.start[1] + pw.dir[1] * a + pw.normal[1] * depth,
    ];
  };

  // Camera: center of a closed room, otherwise in front of the main wall.
  const main = places.find((w) => lay.find((l) => l.id === w.id)?.role === 'main') ?? places[0];
  let camera: V3 = [0, 1.6, 4];
  let lookAt: V3 = [0, 1.2, 0];
  if (main) {
    const mid = (w: WallPlace) => [
      w.start[0] + (w.dir[0] * w.rect.w) / 2,
      w.start[1] + (w.dir[1] * w.rect.w) / 2,
    ];
    const mm = mid(main);
    const eye = Math.min(1.6, main.rect.h * 0.6);
    lookAt = [mm[0]!, main.rect.h * 0.5, mm[1]!];
    if (room && places.length >= 3) {
      let cx = 0;
      let cz = 0;
      for (const w of places) {
        const m = mid(w);
        cx += m[0]!;
        cz += m[1]!;
      }
      camera = [cx / places.length, eye, cz / places.length];
    } else {
      const dist = Math.max(3, main.rect.w * 0.9);
      camera = [mm[0]! + main.normal[0] * dist, eye, mm[1]! + main.normal[1] * dist];
    }
  }
  return { map, placed: new Set([...byId.keys(), ...parent.keys()]), camera, lookAt };
}
