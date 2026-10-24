import { describe, expect, it } from 'vitest';
import { rectPolygon, type Surface } from '@spectrastage/shared';
import { roomGeometry } from './roomGeometry.ts';

const surf = (
  id: string,
  kind: Surface['kind'],
  x: number,
  y: number,
  w: number,
  h: number,
  role?: Surface['role'],
) =>
  ({
    id,
    name: id,
    kind,
    role,
    intensity: 1,
    polygon: rectPolygon(x, y, w, h),
    playback: { mode: 'off' },
  }) as unknown as Surface;

describe('room geometry (3D view)', () => {
  it('folds four walls into a closed room and puts the floor in front of the main wall', () => {
    const g = roomGeometry(
      [
        surf('a', 'wall', 0, 0, 4, 2.5),
        surf('b', 'wall', 4, 0, 3, 2.5),
        surf('c', 'wall', 7, 0, 4, 2.5),
        surf('d', 'wall', 11, 0, 3, 2.5),
        surf('f', 'floor', 0, 2.5, 4, 3),
        surf('top', 'other', 0, -3, 4, 3, 'ceiling'),
      ],
      true,
    );
    const end = g.map('d', 14, 2.5)!;
    expect(end[0]).toBeCloseTo(0);
    expect(end[2]).toBeCloseTo(0);
    // corner between wall a and b is shared
    expect(g.map('a', 4, 1)![0]).toBeCloseTo(g.map('b', 4, 1)![0]);
    // floor: 1 m away from the main wall, on the ground
    const f = g.map('f', 2, 3.5)!;
    expect(f[1]).toBe(0);
    expect(f[2]).toBeCloseTo(1);
    // ceiling at wall height
    expect(g.map('top', 2, -1)![1]).toBeCloseTo(2.5);
    // camera in the middle of the room
    expect(g.camera[0]).toBeCloseTo(2);
    expect(g.camera[2]).toBeCloseTo(1.5);
  });
  it('garage + side wall at 90°: the side wall turns towards the viewer', () => {
    const g = roomGeometry([surf('g', 'wall', 0, 0, 4.5, 2.6), surf('s', 'wall', 4.5, 0, 3, 2.6)], false);
    const p = g.map('s', 7.5, 2.6)!;
    expect(p[0]).toBeCloseTo(4.5);
    expect(p[2]).toBeCloseTo(3);
  });
});
