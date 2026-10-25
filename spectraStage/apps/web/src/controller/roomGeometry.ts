/**
 * 3D room view geometry: thin wrapper around the shared room fold (the same geometry the
 * projectors use for the sky and for creatures moving around the viewer).
 */
import { facePoint, roomFold, type Surface, type V3 } from '@spectrastage/shared';

export type { V3 };

export interface RoomGeometry {
  /** Maps a stage point of a surface to 3D, or null if that surface is not placed. */
  map: (surfaceId: string, x: number, y: number) => V3 | null;
  placed: Set<string>;
  camera: V3;
  lookAt: V3;
}

export function roomGeometry(surfaces: readonly Surface[], _room = true): RoomGeometry {
  const fold = roomFold(surfaces, false);
  const byId = new Map(fold.faces.map((f) => [f.id, f]));
  const main = fold.faces.find((f) => f.role === 'main');
  const lookAt: V3 = main
    ? facePoint(main, main.rect.x + main.rect.w / 2, main.rect.y + main.rect.h / 2)
    : [0, 1.2, 0];
  return {
    map: (id, x, y) => {
      const f = byId.get(id);
      return f ? facePoint(f, x, y) : null;
    },
    placed: new Set(byId.keys()),
    camera: fold.center,
    lookAt,
  };
}
