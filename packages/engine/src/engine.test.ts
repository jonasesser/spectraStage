import { describe, expect, it } from 'vitest';
import { UNIT_QUAD, type Profile } from '@spectrastage/shared';
import { buildWarpMesh, meshOffset, orientUv, warpPoint } from './warp.ts';
import { ServerClock } from './clock.ts';

const base: Pick<Profile, 'corners' | 'mesh' | 'fold' | 'rotation' | 'flipX' | 'flipY'> = {
  corners: structuredClone(UNIT_QUAD) as Profile['corners'],
  mesh: null,
  rotation: 0,
  flipX: false,
  flipY: false,
};

describe('warp', () => {
  it('identity calibration maps view to output 1:1', () => {
    const p = warpPoint(base, 0.25, 0.75)!;
    expect(p.x).toBeCloseTo(0.25);
    expect(p.y).toBeCloseTo(0.75);
  });
  it('corners land exactly where calibrated', () => {
    const prof = {
      ...base,
      corners: [
        { x: 0.1, y: 0.1 },
        { x: 0.9, y: 0.05 },
        { x: 0.95, y: 0.9 },
        { x: 0.05, y: 0.95 },
      ] as Profile['corners'],
    };
    const m = buildWarpMesh(prof, 8)!;
    const n = 9;
    const at = (x: number, y: number) => [m.positions[(y * n + x) * 2], m.positions[(y * n + x) * 2 + 1]];
    expect(at(0, 0)[0]).toBeCloseTo(0.1);
    expect(at(8, 0)[0]).toBeCloseTo(0.9);
    expect(at(8, 8)[1]).toBeCloseTo(0.9);
    expect(at(0, 8)[1]).toBeCloseTo(0.95);
    expect(m.indices.length).toBe(8 * 8 * 6);
  });
  it('mesh offsets interpolate bilinearly', () => {
    const prof = {
      ...base,
      mesh: {
        cols: 3,
        rows: 3,
        offsets: Array.from({ length: 9 }, (_, i) => (i === 4 ? { x: 0.02, y: -0.01 } : { x: 0, y: 0 })),
      },
    };
    expect(meshOffset(prof, 0.5, 0.5).x).toBeCloseTo(0.02);
    expect(meshOffset(prof, 0.25, 0.5).x).toBeCloseTo(0.01);
    expect(meshOffset(prof, 0, 0).x).toBeCloseTo(0);
  });
  it('orientation rotates and mirrors content', () => {
    expect(orientUv({ rotation: 180, flipX: false, flipY: false }, 0, 0)).toEqual({ x: 1, y: 1 });
    expect(orientUv({ rotation: 0, flipX: true, flipY: false }, 0.2, 0.3)).toEqual({ x: 0.8, y: 0.3 });
    const r = orientUv({ rotation: 90, flipX: false, flipY: false }, 0, 0);
    expect(r).toEqual({ x: 0, y: 1 });
  });
});

describe('clock sync', () => {
  it('estimates the offset from the lowest-RTT samples', () => {
    const c = new ServerClock();
    // server is 5000 ms ahead; one slow sample must not dominate
    c.addSample(1000, 6000 + 10, 1020);
    c.addSample(2000, 7000 + 200, 2400);
    c.addSample(3000, 8000 + 8, 3016);
    const s = c.stats();
    expect(Math.abs(s.offsetMs - 5000)).toBeLessThan(5);
    expect(s.rttMs).toBeLessThanOrEqual(20);
  });
});

describe('room corner (fold)', () => {
  const fold: Pick<Profile, 'corners' | 'mesh' | 'fold' | 'rotation' | 'flipX' | 'flipY'> = {
    ...base,
    fold: { axis: 'x', at: 0.4, a: { x: 0.5, y: 0.1 }, b: { x: 0.5, y: 0.9 } },
  };
  it('maps the crease of the stage image onto the marked corner line', () => {
    expect(warpPoint(fold, 0.4, 0)!.x).toBeCloseTo(0.5);
    expect(warpPoint(fold, 0.4, 0)!.y).toBeCloseTo(0.1);
    expect(warpPoint(fold, 0.4, 1)!.y).toBeCloseTo(0.9);
    expect(warpPoint(fold, 0, 0)!.x).toBeCloseTo(0);
    expect(warpPoint(fold, 1, 1)!.x).toBeCloseTo(1);
  });
  it('is continuous across the crease and the mesh has a vertex column on it', () => {
    const l = warpPoint(fold, 0.4 - 1e-6, 0.5)!;
    const r = warpPoint(fold, 0.4 + 1e-6, 0.5)!;
    expect(Math.abs(l.x - r.x)).toBeLessThan(1e-4);
    const m = buildWarpMesh(fold, 32)!;
    const us = new Set<number>();
    for (let i = 0; i < m.uvs.length; i += 2) us.add(Math.round(m.uvs[i]! * 1e6));
    expect(us.has(400000)).toBe(true);
  });
});

describe('projector camera matches the shared projector model', () => {
  it('three.js pose camera (with lens shift) projects like projectPose', async () => {
    const THREE = await import('three');
    const { applyLensShift } = await import('./renderer.ts');
    const { aimPose, projectPose } = await import('@spectrastage/shared');
    const pose = { ...aimPose([1, 1.7, 3], [2.5, 0.8, 0], 80, 0.2), shiftX: 0.15, shiftY: 0.7 };
    const aspect = 16 / 10;
    const cam = new THREE.PerspectiveCamera(50, aspect, 0.05, 100);
    cam.fov = (2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) / aspect) * 180) / Math.PI;
    cam.position.set(...pose.pos);
    cam.rotation.set(pose.pitch, -pose.yaw, pose.roll, 'YXZ');
    cam.updateProjectionMatrix();
    applyLensShift(cam, pose);
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    for (const P of [
      [0.3, 0.2, 0],
      [3.7, 2.0, 0],
      [4, 0.5, 1.2],
    ] as [number, number, number][]) {
      const v = new THREE.Vector3(...P).project(cam);
      const q = projectPose(pose, aspect, P)!;
      expect(v.x).toBeCloseTo(q[0], 6);
      expect(v.y).toBeCloseTo(q[1], 6);
    }
  });
});
