/**
 * Output warp: maps the stage view (u,v in 0..1, v down) to projector output space using a
 * 4-corner homography plus an optional bilinear mesh of correction offsets.
 * Pure math → unit-testable and shared with the controller's calibration preview.
 */
import { applyHomography, computeHomography, UNIT_QUAD, type Profile, type Pt } from '@spectrastage/shared';

export interface WarpMesh {
  /** Output positions, normalized 0..1 (y down), interleaved x,y. */
  positions: Float32Array;
  /** View texture coordinates (u, v with v down), interleaved. */
  uvs: Float32Array;
  indices: Uint32Array;
  segments: number;
}

/** Bilinear interpolation of mesh control offsets at (u,v). */
export function meshOffset(profile: Pick<Profile, 'mesh'>, u: number, v: number): Pt {
  const m = profile.mesh;
  if (!m || m.offsets.length !== m.cols * m.rows) return { x: 0, y: 0 };
  const fx = Math.min(m.cols - 1.000001, Math.max(0, u * (m.cols - 1)));
  const fy = Math.min(m.rows - 1.000001, Math.max(0, v * (m.rows - 1)));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const at = (x: number, y: number) => m.offsets[y * m.cols + x] ?? { x: 0, y: 0 };
  const a = at(x0, y0);
  const b = at(x0 + 1, y0);
  const c = at(x0, y0 + 1);
  const d = at(x0 + 1, y0 + 1);
  return {
    x: a.x * (1 - tx) * (1 - ty) + b.x * tx * (1 - ty) + c.x * (1 - tx) * ty + d.x * tx * ty,
    y: a.y * (1 - tx) * (1 - ty) + b.y * tx * (1 - ty) + c.y * (1 - tx) * ty + d.y * tx * ty,
  };
}

/** Content orientation: rotation (clockwise) and flips applied to the view texture coordinates. */
export function orientUv(profile: Pick<Profile, 'rotation' | 'flipX' | 'flipY'>, u: number, v: number): Pt {
  let x = u;
  let y = v;
  switch (profile.rotation) {
    case 90:
      [x, y] = [y, 1 - x];
      break;
    case 180:
      [x, y] = [1 - x, 1 - y];
      break;
    case 270:
      [x, y] = [1 - y, x];
      break;
  }
  if (profile.flipX) x = 1 - x;
  if (profile.flipY) y = 1 - y;
  return { x, y };
}

/** Projects a view coordinate (0..1) to output space (0..1). */
export function warpPoint(profile: Pick<Profile, 'corners' | 'mesh'>, u: number, v: number): Pt | null {
  const h = computeHomography(UNIT_QUAD, profile.corners);
  if (!h) return null;
  const p = applyHomography(h, { x: u, y: v });
  const o = meshOffset(profile, u, v);
  return { x: p.x + o.x, y: p.y + o.y };
}

export function buildWarpMesh(
  profile: Pick<Profile, 'corners' | 'mesh' | 'rotation' | 'flipX' | 'flipY'>,
  segments = 32,
): WarpMesh | null {
  const h = computeHomography(UNIT_QUAD, profile.corners);
  if (!h) return null;
  const n = segments + 1;
  const positions = new Float32Array(n * n * 2);
  const uvs = new Float32Array(n * n * 2);
  let i = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / segments;
      const v = y / segments;
      const p = applyHomography(h, { x: u, y: v });
      const o = meshOffset(profile, u, v);
      positions[i] = p.x + o.x;
      positions[i + 1] = p.y + o.y;
      const t = orientUv(profile, u, v);
      uvs[i] = t.x;
      uvs[i + 1] = t.y;
      i += 2;
    }
  }
  const indices = new Uint32Array(segments * segments * 6);
  let k = 0;
  for (let y = 0; y < segments; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * n + x;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      indices.set([a, c, b, b, c, d], k);
      k += 6;
    }
  }
  return { positions, uvs, indices, segments };
}
