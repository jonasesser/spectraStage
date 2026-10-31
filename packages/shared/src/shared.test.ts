import { describe, expect, it } from 'vitest';
import {
  applyHomography,
  computeHomography,
  invertMat3,
  isConvexQuad,
  UNIT_QUAD,
  type Quad,
} from './homography.ts';
import { playlistPosition, activeScene, ambientSchedule, itemCueSchedule } from './playback.ts';
import type { Playlist, SessionState, Surface } from './schema.ts';
import { applyCommand, createInitialState, CommandError, mountOf, type ReducerContext } from './reducer.ts';
import { createCatalog, type ThemeManifest } from './theme.ts';
import {
  aimPose,
  arrangementPoses,
  poseRay,
  projectPose,
  roomCorners,
  roomEdges,
  solvePose,
  boxCorner,
  boxFrame,
  poseForWalls,
  cornerWalls,
  findOutliers,
  poseErrorPx,
  type V3,
  dirFromAngles,
  faceLocal,
  facePoint,
  mainAzimuth,
  poseDir,
  roomFold,
  roomHit,
  roomRay,
  wallQuads,
} from './room.ts';
import {
  buildActorRoute,
  routePose,
  cueLeadMs,
  ambientActorCues,
  rectPolygon,
  fitViewport,
  worldLayout,
  wallRing,
  completeRoom,
  placeNewSurface,
  tidyRoom,
  polygonBBox,
  surfacesForSides,
} from './stage.ts';
import { normalizeCode, isValidCode, formatCode } from './codes.ts';

describe('homography', () => {
  const dst: Quad = [
    { x: 0.1, y: 0.05 },
    { x: 0.95, y: 0.12 },
    { x: 0.85, y: 0.9 },
    { x: 0.05, y: 0.98 },
  ];
  it('maps the four corners exactly', () => {
    const h = computeHomography(UNIT_QUAD, dst)!;
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h, UNIT_QUAD[i]!);
      expect(p.x).toBeCloseTo(dst[i]!.x, 9);
      expect(p.y).toBeCloseTo(dst[i]!.y, 9);
    }
  });
  it('inverse maps back', () => {
    const h = computeHomography(UNIT_QUAD, dst)!;
    const inv = invertMat3(h)!;
    const p = { x: 0.37, y: 0.61 };
    const q = applyHomography(inv, applyHomography(h, p));
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y, 9);
  });
  it('identity for unit quad', () => {
    const h = computeHomography(UNIT_QUAD, UNIT_QUAD)!;
    const p = applyHomography(h, { x: 0.3, y: 0.8 });
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.8);
  });
  it('rejects degenerate quads', () => {
    expect(isConvexQuad(dst)).toBe(true);
    const bow: Quad = [UNIT_QUAD[0], UNIT_QUAD[2], UNIT_QUAD[1], UNIT_QUAD[3]];
    expect(isConvexQuad(bow)).toBe(false);
    expect(computeHomography(UNIT_QUAD, [UNIT_QUAD[0], UNIT_QUAD[0], UNIT_QUAD[0], UNIT_QUAD[0]])).toBeNull();
  });
});

describe('codes', () => {
  it('normalizes and validates', () => {
    expect(normalizeCode('abcd-efgh')).toBe('ABCDEFGH');
    expect(isValidCode('ABCDEFGH')).toBe(true);
    expect(isValidCode('ABCDEFG0')).toBe(false);
    expect(formatCode('ABCDEFGH')).toBe('ABCD-EFGH');
  });
});

const theme: ThemeManifest = {
  id: 't',
  version: '1',
  name: { en: 'T', de: 'T' },
  description: { en: '', de: '' },
  icon: '',
  rating: 'family',
  scenes: [
    {
      id: 'a',
      name: { en: 'A', de: 'A' },
      description: { en: '', de: '' },
      kinds: ['wall'],
      icon: '',
      colors: ['#000', '#fff'],
      params: [
        { key: 'speed', label: { en: '', de: '' }, type: 'number', min: 0, max: 2, step: 0.1, default: 1 },
      ],
    },
    {
      id: 'b',
      name: { en: 'B', de: 'B' },
      description: { en: '', de: '' },
      kinds: ['floor'],
      icon: '',
      colors: ['#000', '#fff'],
      params: [],
    },
  ],
  effects: [
    {
      id: 'e',
      name: { en: 'E', de: 'E' },
      icon: '',
      durationMs: 1000,
      cooldownMs: 0,
      childSafe: true,
      kinds: ['wall'],
    },
    {
      id: 'scary',
      name: { en: 'S', de: 'S' },
      icon: '',
      durationMs: 1000,
      cooldownMs: 0,
      childSafe: false,
      kinds: ['wall'],
    },
  ],
  actors: [
    {
      id: 'spider',
      name: { en: 'S', de: 'S' },
      icon: '',
      kinds: ['wall', 'floor'],
      sizeM: 0.4,
      speedMps: 0.5,
      pauseSec: [0.2, 1],
      waypoints: [3, 5],
      childSafe: true,
    },
  ],
  presets: [
    {
      id: 'p',
      name: { en: 'P', de: 'P' },
      description: { en: '', de: '' },
      icon: '',
      assignments: { wall: { sceneId: 'a' }, floor: { playlistTemplateId: 'pl' } },
      ambientActors: ['spider'],
    },
  ],
  playlistTemplates: [
    {
      id: 'pl',
      name: { en: 'PL', de: 'PL' },
      kind: 'floor',
      loop: true,
      items: [{ sceneId: 'b', durationSec: 10, transition: { type: 'cut', durationMs: 0 } }],
    },
  ],
  defaults: { wall: 'a', floor: 'b', other: 'a' },
};
const catalog = createCatalog([theme]);

function ctx(now = 1000, role: 'owner' | 'controller' = 'owner'): ReducerContext {
  let n = 0;
  return {
    now,
    actor: { id: 'c1', name: 'Tester', role },
    catalog,
    newId: () => `id${++n}`,
    newSeed: () => 42 + n++,
    leadMs: 0,
  };
}

describe('playlist playback', () => {
  const pl: Playlist = {
    id: 'p',
    name: 'P',
    kind: 'wall',
    loop: true,
    items: [10, 20, 30].map((d, i) => ({
      id: `i${i}`,
      scene: { themeId: 't', sceneId: 'a', params: {} },
      durationSec: d,
      transition: { type: 'cut', durationMs: 0 },
      ambient: null,
    })),
  };
  const pb = {
    mode: 'playlist' as const,
    playlistId: 'p',
    anchorIndex: 0,
    anchorTime: 0,
    pausedAt: null,
    seed: 1,
  };
  it('advances deterministically', () => {
    expect(playlistPosition(pl, pb, 5_000)!.index).toBe(0);
    expect(playlistPosition(pl, pb, 15_000)!.index).toBe(1);
    expect(playlistPosition(pl, pb, 45_000)!.index).toBe(2);
    const wrapped = playlistPosition(pl, pb, 65_000)!;
    expect(wrapped.index).toBe(0);
    expect(wrapped.cycle).toBe(1);
    expect(wrapped.itemStart).toBe(60_000);
  });
  it('handles very long runtimes without walking forever', () => {
    const p = playlistPosition(pl, pb, 60_000 * 1_000_000 + 12_000)!;
    expect(p.index).toBe(1);
  });
  it('respects pause and no-loop end', () => {
    expect(playlistPosition(pl, { ...pb, pausedAt: 12_000 }, 999_999)!.index).toBe(1);
    const end = playlistPosition({ ...pl, loop: false }, pb, 500_000)!;
    expect(end.ended).toBe(true);
    expect(end.index).toBe(2);
  });
  it('timed cues fire at fixed offsets inside the item', () => {
    const withCues: Playlist = {
      ...pl,
      items: pl.items.map((it, i) =>
        i === 1 ? { ...it, cues: [{ atSec: 5, themeId: 't', effectId: 'e' }] } : it,
      ),
    };
    const a = activeScene(pb, [withCues], 12_000)!;
    const sch = itemCueSchedule(a);
    expect(sch).toHaveLength(1);
    expect(sch[0]!.at).toBe(15_000);
    expect(itemCueSchedule(activeScene(pb, [withCues], 2_000)!)).toHaveLength(0);
  });
  it('ambient schedule is deterministic', () => {
    const withAmb: Playlist = {
      ...pl,
      items: pl.items.map((it) => ({
        ...it,
        durationSec: 120,
        ambient: { effects: [{ themeId: 't', effectId: 'e' }], minGapSec: 10, maxGapSec: 20 },
      })),
    };
    const a1 = activeScene(pb, [withAmb], 30_000)!;
    const a2 = activeScene(pb, [withAmb], 31_000)!;
    expect(a1.key).toBe(a2.key);
    const s1 = ambientSchedule(a1);
    expect(s1.length).toBeGreaterThan(3);
    expect(s1).toEqual(ambientSchedule(a2));
  });
});

describe('reducer', () => {
  function base(): SessionState {
    return createInitialState('s1', 'Show', 0, 't', 7);
  }
  it('approves a device and creates surface + output', () => {
    const s = base();
    s.devices.push({ id: 'd1', name: 'Garage', status: 'pending', outputId: null, joinedAt: 0 });
    const r = applyCommand(
      s,
      {
        t: 'device.approve',
        deviceId: 'd1',
        newOutput: { name: 'Garage', newSurface: { name: 'Garage', kind: 'wall' } },
      },
      ctx(),
    );
    expect(r.state.surfaces).toHaveLength(1);
    expect(r.state.outputs).toHaveLength(1);
    expect(r.state.devices[0]!.outputId).toBe(r.state.outputs[0]!.id);
    expect(r.approvedDevice).toBe('d1');
    expect(s.surfaces).toHaveLength(0); // input untouched
  });
  it('staggers surfaces that run the same template playlist', () => {
    let s = base();
    s = applyCommand(s, { t: 'surface.create', name: 'F1', kind: 'floor' }, ctx()).state;
    s = applyCommand(s, { t: 'surface.create', name: 'F2', kind: 'floor' }, ctx()).state;
    const r = applyCommand(s, { t: 'preset.apply', themeId: 't', presetId: 'p' }, ctx(2000));
    const idx = r.state.surfaces.map((x) => (x.playback.mode === 'playlist' ? x.playback.anchorIndex : -1));
    expect(idx).toEqual([0, 0]); // template has a single item → both at 0, no crash
  });
  it('pins a side exactly onto its measured corners and keeps them when a side is added', () => {
    let s = base();
    const c1 = ctx();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, c1).state;
    s = applyCommand(s, { t: 'output.create', name: 'Beamer' }, c1).state;
    const id = s.outputs[0]!.id;
    s = applyCommand(s, { t: 'output.setWalls', outputId: id, walls: ['vorne'] }, c1).state;
    const fold = roomFold(s.surfaces);
    const uv: Record<string, [number, number]> = {
      'vorne-links-oben': [0.1, 0.12],
      'vorne-rechts-oben': [0.88, 0.08],
      'vorne-rechts-unten': [0.93, 0.9],
      'vorne-links-unten': [0.05, 0.86],
    };
    const anchors = Object.entries(uv).map(([k, [u, v]]) => ({
      c: `c|${k}`,
      p: roomCorners(fold).find((c) => c.id === k)!.p,
      u,
      v,
    }));
    const w0 = polygonBBox(s.surfaces[0]!.polygon).w;
    s = applyCommand(s, { t: 'output.setAnchors', outputId: id, anchors }, c1).state;
    const pr = s.outputs[0]!.profiles[0]!;
    const q = wallQuads(fold, pr.pose!, 16 / 9, pr.anchors!, ['vorne']);
    expect(q).toHaveLength(1);
    q[0]!.keys.forEach((k, i) => expect(q[0]!.uv[i]).toEqual(uv[k]));
    // one wall alone does not change the room's size
    expect(polygonBBox(s.surfaces[0]!.polygon).w).toBeCloseTo(w0, 6);
    // adding the left wall keeps the measured front corners
    s = applyCommand(s, { t: 'output.setWalls', outputId: id, walls: ['vorne', 'links'] }, c1).state;
    expect(s.outputs[0]!.profiles[0]!.anchors).toHaveLength(4);
    s = applyCommand(s, { t: 'output.setWalls', outputId: id, walls: ['vorne'], reset: true }, c1).state;
    expect(s.outputs[0]!.profiles[0]!.anchors).toHaveLength(0);
  });
  it('measured corners move the projector to where it really stands', () => {
    let s = base();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, ctx()).state;
    s = applyCommand(s, { t: 'output.create', name: 'B' }, ctx()).state;
    const o = s.outputs[0]!;
    const fold = roomFold(s.surfaces);
    const truth = { ...aimPose([2, 0.6, 3.4], [2, 1.0, 0], 82, 0.03), shiftY: 0.15 };
    const anchors = roomCorners(fold)
      .map((c) => ({ c, q: projectPose(truth, 16 / 9, c.p) }))
      .filter((x) => x.q && Math.abs(x.q[0]) < 1.05 && Math.abs(x.q[1]) < 1.05)
      .map(({ c, q }) => ({ c: c.id, p: c.p, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 }));
    expect(anchors.length).toBe(4);
    const r = applyCommand(s, { t: 'output.setAnchors', outputId: o.id, anchors }, ctx()).state;
    const pose = r.outputs[0]!.profiles[0]!.pose!;
    for (const a of anchors) {
      const q = projectPose(pose, 16 / 9, a.p)!;
      expect((q[0] + 1) / 2).toBeCloseTo(a.u, 3);
      expect((1 - q[1]) / 2).toBeCloseTo(a.v, 3);
    }
  });
  it('measuring finds the projectors but never changes the size of the room', () => {
    let s = base();
    const c1 = ctx();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, c1).state;
    s = applyCommand(s, { t: 'output.create', name: 'A' }, c1).state;
    s = applyCommand(s, { t: 'output.create', name: 'B' }, c1).state;
    const fold0 = roomFold(s.surfaces);
    const box = boxFrame(fold0)!;
    expect(box).not.toBeNull();
    const [W, D, H] = [box.w, box.d, box.h];
    const before = JSON.stringify(s.surfaces.map((x) => x.polygon));
    const corners = roomCorners(fold0);
    const edges = roomEdges(fold0);
    const truths = [
      { ...aimPose([W * 0.5, H * 0.8, D * 0.95], [W * 0.5, H * 0.45, 0], 116, 0.01), shiftY: 0.15 },
      aimPose([W * 0.2, H * 0.7, D * 0.3], [W, H * 0.4, D * 0.7], 95, -0.02),
    ];
    const inImg = (q: [number, number] | null) => !!q && Math.abs(q[0]) < 0.97 && Math.abs(q[1]) < 0.97;
    truths.forEach((truth, k) => {
      const anchors: { c: string; p: V3; q?: V3; u: number; v: number }[] = [];
      for (const c of corners) {
        const P = boxCorner(box, c.id, W, D, H)!;
        const q = projectPose(truth, 16 / 9, P);
        if (inImg(q)) anchors.push({ c: `c|${c.id}`, p: c.p, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 });
      }
      for (const e of edges) {
        const [ka, kb] = e.id.split('|');
        const A = boxCorner(box, ka!, W, D, H)!;
        const B = boxCorner(box, kb!, W, D, H)!;
        for (const [n, t] of [
          ['A', 0.3],
          ['B', 0.7],
        ] as const) {
          const q = projectPose(truth, 16 / 9, [
            A[0] + (B[0] - A[0]) * t,
            A[1] + (B[1] - A[1]) * t,
            A[2] + (B[2] - A[2]) * t,
          ]);
          if (inImg(q))
            anchors.push({ c: `e|${e.id}|${n}`, p: e.a, q: e.b, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 });
        }
      }
      s = applyCommand(s, { t: 'output.setAnchors', outputId: s.outputs[k]!.id, anchors }, c1).state;
    });
    // sizes are the user's business – calibration only finds where the projectors stand
    expect(JSON.stringify(s.surfaces.map((x) => x.polygon))).toBe(before);
    expect(s.surfaces[0]!.roomDepth).toBeUndefined();
    for (const o of s.outputs) {
      const pr = o.profiles[0]!;
      expect(poseErrorPx(pr.pose!, 16 / 9, pr.anchors!)!).toBeLessThan(1);
    }
  });
  it('room depth and wall width are set by the user, own surfaces follow', () => {
    let s = base();
    const c1 = ctx();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, c1).state;
    s = applyCommand(s, { t: 'surface.create', name: 'Right', kind: 'wall' }, c1).state;
    const b0 = polygonBBox(s.surfaces[0]!.polygon);
    s = applyCommand(s, { t: 'room.setDepth', depth: 3.3 }, c1).state;
    const right = polygonBBox(s.surfaces[1]!.polygon);
    expect(right.w).toBeCloseTo(3.3, 6);
    expect(s.surfaces[0]!.roomDepth).toBe(3.3);
    s = applyCommand(s, { t: 'room.setWidth', width: b0.w * 1.5 }, c1).state;
    const b1 = polygonBBox(s.surfaces[0]!.polygon);
    expect(b1.w).toBeCloseTo(b0.w * 1.5, 6);
    expect(b1.x).toBeCloseTo(b0.x, 6);
    expect(polygonBBox(s.surfaces[1]!.polygon).x).toBeGreaterThanOrEqual(b1.x + b1.w - 1e-6);
  });
  it('sets the mounting of a projector from the app', () => {
    let s = base();
    const c1 = ctx();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, c1).state;
    s = applyCommand(s, { t: 'output.create', name: 'B' }, c1).state;
    const id = s.outputs[0]!.id;
    for (const m of ['ceiling', 'rear', 'ceilingRear', 'front'] as const) {
      s = applyCommand(s, { t: 'output.setMount', outputId: id, mount: m }, c1).state;
      expect(mountOf(s.outputs[0]!.profiles[0]!)).toBe(m);
    }
  });
  it('enforces owner-only commands', () => {
    const s = base();
    s.devices.push({ id: 'd1', name: 'X', status: 'pending', outputId: null, joinedAt: 0 });
    expect(() => applyCommand(s, { t: 'device.approve', deviceId: 'd1' }, ctx(1000, 'controller'))).toThrow(
      CommandError,
    );
  });
  it('applies presets per surface kind and enables ambient actors', () => {
    let s = base();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, ctx()).state;
    s = applyCommand(s, { t: 'surface.create', name: 'Floor', kind: 'floor' }, ctx()).state;
    const r = applyCommand(s, { t: 'preset.apply', themeId: 't', presetId: 'p' }, ctx(2000));
    expect(r.state.surfaces[0]!.playback.mode).toBe('scene');
    expect(r.state.surfaces[1]!.playback.mode).toBe('playlist');
    expect(r.state.ambient.enabled).toBe(true);
  });
  it('blocks non child-safe effects in kids mode and schedules effect cues with lead', () => {
    let s = base();
    s = applyCommand(s, { t: 'surface.create', name: 'Wall', kind: 'wall' }, ctx()).state;
    const sid = s.surfaces[0]!.id;
    expect(() =>
      applyCommand(s, { t: 'effect.fire', surfaceIds: [sid], themeId: 't', effectId: 'scary' }, ctx()),
    ).toThrow(/child-safe/);
    const r = applyCommand(
      s,
      { t: 'effect.fire', surfaceIds: [sid], themeId: 't', effectId: 'e' },
      { ...ctx(5000), leadMs: 250 },
    );
    expect(r.state.cues).toHaveLength(1);
    expect(r.state.cues[0]!.startAt).toBe(5250);
    // cue is pruned after it ended
    const later = applyCommand(r.state, { t: 'session.rename', name: 'X' }, ctx(10_000));
    expect(later.state.cues).toHaveLength(0);
  });
  it('rejects non-convex calibration', () => {
    let s = base();
    s.devices.push({ id: 'd1', name: 'G', status: 'pending', outputId: null, joinedAt: 0 });
    s = applyCommand(s, { t: 'device.approve', deviceId: 'd1' }, ctx()).state;
    const o = s.outputs[0]!;
    const p = structuredClone(o.profiles[0]!);
    p.corners = [p.corners[0], p.corners[2], p.corners[1], p.corners[3]];
    expect(() =>
      applyCommand(s, { t: 'output.saveProfile', outputId: o.id, profile: p, activate: true }, ctx()),
    ).toThrow(/convex/);
  });
});

describe('stage actors', () => {
  const surfaces: Surface[] = [
    {
      id: 'g',
      name: 'Garage',
      kind: 'wall',
      polygon: rectPolygon(0, 0, 4, 2.5),
      playback: {
        mode: 'scene',
        scene: { themeId: 't', sceneId: 'a', params: {} },
        seed: 1,
        startedAt: 0,
        transition: { type: 'cut', durationMs: 0 },
      },
      intensity: 1,
    },
    {
      id: 'w',
      name: 'Wall',
      kind: 'wall',
      polygon: rectPolygon(4.5, 0, 4, 2.5),
      playback: {
        mode: 'scene',
        scene: { themeId: 't', sceneId: 'a', params: {} },
        seed: 1,
        startedAt: 0,
        transition: { type: 'cut', durationMs: 0 },
      },
      intensity: 1,
    },
  ];
  const actor = theme.actors[0]!;
  const cue = { seed: 1234, speed: 1, fromSurfaceId: 'g', toSurfaceId: 'w' };
  it('routes are deterministic and cross from garage to wall', () => {
    const r1 = buildActorRoute(surfaces, actor, cue, 0)!;
    const r2 = buildActorRoute(surfaces, actor, cue, 0)!;
    expect(r1).toEqual(r2);
    expect(r1.totalMs).toBeGreaterThan(1000);
    const xs: number[] = [];
    for (let t = 0; t <= r1.totalMs; t += 100) {
      const p = routePose(r1, t);
      if (p.visible) xs.push(p.x);
    }
    expect(Math.min(...xs)).toBeLessThan(4);
    expect(Math.max(...xs)).toBeGreaterThan(4.5);
  });
  it('different seeds produce different random routes', () => {
    const a = buildActorRoute(surfaces, actor, { ...cue, toSurfaceId: null, seed: 1 }, 0)!;
    const b = buildActorRoute(surfaces, actor, { ...cue, toSurfaceId: null, seed: 2 }, 0)!;
    expect(a.segments[1]!.p0).not.toEqual(b.segments[1]!.p0);
  });
  it('poses are continuous (no teleport)', () => {
    const r = buildActorRoute(surfaces, actor, cue, 0)!;
    let prev = routePose(r, 0);
    for (let t = 16; t <= r.totalMs; t += 16) {
      const p = routePose(r, t);
      if (p.visible && prev.visible) expect(Math.hypot(p.x - prev.x, p.y - prev.y)).toBeLessThan(0.2);
      prev = p;
    }
  });
  it('ambient actors are deterministic per time', () => {
    const amb = {
      enabled: true,
      actors: [{ themeId: 't', actorId: 'spider' }],
      minGapSec: 10,
      maxGapSec: 20,
      seed: 9,
    };
    const a = ambientActorCues(amb, surfaces, catalog, 1_000_000);
    const b = ambientActorCues(amb, surfaces, catalog, 1_000_000);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
  it('lead time stays in 150..400ms', () => {
    expect(cueLeadMs([])).toBe(150);
    expect(cueLeadMs([20])).toBe(150);
    expect(cueLeadMs([300])).toBe(305);
    expect(cueLeadMs([2000])).toBe(400);
  });
  it('fitViewport keeps aspect', () => {
    const vp = fitViewport({ x: 0, y: 0, w: 4, h: 4 }, 16 / 9);
    expect(vp.w / vp.h).toBeCloseTo(16 / 9);
  });
});

describe('world layout', () => {
  const surf = (id: string, kind: Surface['kind'], x: number, y: number, role?: Surface['role']) =>
    ({
      id,
      name: id,
      kind,
      role,
      intensity: 1,
      polygon: rectPolygon(x, y, 4, 2.5),
      playback: { mode: 'off' },
    }) as unknown as Surface;
  it('rehearsed shows find their sides: main, right, left, floor in front', () => {
    const all = [
      surf('l', 'wall', -4, 0),
      surf('m', 'wall', 0, 0, 'main'),
      surf('r', 'wall', 4, 0),
      surf('b', 'wall', 8, 0),
      surf('f', 'floor', 0, 2.5),
      surf('f2', 'floor', 4, 2.5),
    ];
    const ids = (sides: string[]) => surfacesForSides(all, sides).map((s) => s.id);
    expect(ids(['main'])).toEqual(['m']);
    expect(ids(['main', 'right', 'floorFront'])).toEqual(['m', 'r', 'f']);
    expect(ids(['left'])).toEqual(['l']);
  });
  it('first wall is the main part, other walls are sides, floors are ground', () => {
    const w = worldLayout([surf('g', 'wall', 0, 0), surf('s', 'wall', 4, 0), surf('f', 'floor', 0, 2.5)]);
    expect(w.map((x) => x.role)).toEqual(['main', 'side', 'ground']);
  });
  it('an explicit main wall wins; sides are numbered left to right; room ring spans the walls', () => {
    const w = worldLayout([
      surf('a', 'wall', 8, 0),
      surf('b', 'wall', 0, 0),
      surf('c', 'wall', 4, 0, 'main'),
      surf('d', 'other', 0, -4, 'ceiling'),
    ]);
    expect(w.find((x) => x.id === 'c')!.role).toBe('main');
    expect(w.find((x) => x.id === 'b')!.roleIndex).toBe(0);
    expect(w.find((x) => x.id === 'a')!.roleIndex).toBe(1);
    expect(w.find((x) => x.id === 'd')!.role).toBe('ceiling');
    expect(wallRing(w)).toEqual({ x: 0, w: 12 });
  });
});

describe('complete room', () => {
  const s = (id: string, kind: Surface['kind'], x: number, y: number, w: number, h: number) =>
    ({
      id,
      name: id,
      kind,
      intensity: 1,
      polygon: rectPolygon(x, y, w, h),
      playback: { mode: 'off' },
    }) as unknown as Surface;
  it('added sides join a scene played in where it is made for them, else they go dark', () => {
    const main = s('g', 'wall', 0, 0, 4, 2.25);
    main.insert = {
      id: 'w1',
      scene: { themeId: 'halloween', sceneId: 'wallWitch', params: {} },
      seed: 5,
      startedAt: 1000,
      endAt: 61000,
      sides: ['main', 'right'],
    };
    const all = completeRoom([main]);
    const by = (id: string) => all.find((x) => x.id === id)!.insert!;
    expect(by('virtual:wall2').scene.sceneId).toBe('wallWitch'); // right of the main wall
    for (const id of ['virtual:wall3', 'virtual:wall4', 'virtual:floor'])
      expect(by(id).scene).toMatchObject({ sceneId: 'solidColor', params: { color: '#000000' } });
    expect(by('virtual:wall4').endAt).toBe(61000);
    // nothing played in: the added sides just mirror the main wall's programme
    expect(completeRoom([s('g', 'wall', 0, 0, 4, 2.25)]).every((x) => !x.insert)).toBe(true);
  });
  it('adds the missing walls, floor and ceiling at the size of the main wall', () => {
    const all = completeRoom([s('g', 'wall', 0, 0, 4, 2.25), s('f', 'floor', 0, 2.25, 4, 2.25)]);
    const v = all.filter((x) => x.id.startsWith('virtual:'));
    expect(v.map((x) => x.id).sort()).toEqual([
      'virtual:ceiling',
      'virtual:floorRest',
      'virtual:wall2',
      'virtual:wall3',
      'virtual:wall4',
    ]);
    const ring = wallRing(worldLayout(all))!;
    expect(ring).toEqual({ x: 0, w: 16 });
  });
  it('tidy room gives every surface the main wall size', () => {
    const t = tidyRoom([
      s('g', 'wall', 0, 0, 4.5, 2.6),
      s('f', 'floor', 0, 2.6, 4, 5),
      s('w', 'wall', 6, 0, 3, 2),
    ]);
    expect(t.f![2]).toEqual({ x: 4.5, y: 5.2 });
    expect(t.w![0]).toEqual({ x: 4.5, y: 0 });
  });
  it('new surfaces get the main wall size: walls to the right, floor below, other above', () => {
    const base = [s('g', 'wall', 0, 0, 4.5, 2.5)];
    expect(placeNewSurface(base, 'wall')[0]).toEqual({ x: 4.5, y: 0 });
    const f = placeNewSurface(base, 'floor');
    expect(f[0]).toEqual({ x: 0, y: 2.5 });
    expect(f[2]).toEqual({ x: 4.5, y: 5 });
    expect(placeNewSurface(base, 'other')[0]).toEqual({ x: 0, y: -2.5 });
  });
});

describe('room fold (3D)', () => {
  const s = (id: string, kind: Surface['kind'], x: number, y: number, w: number, h: number) =>
    ({
      id,
      name: id,
      kind,
      intensity: 1,
      polygon: rectPolygon(x, y, w, h),
      playback: { mode: 'off' },
    }) as unknown as Surface;
  const fold = roomFold([s('g', 'wall', 0, 0, 4, 2.25)]);
  it('a ray from the center hits the main wall straight ahead, the ceiling above, the floor below', () => {
    const az = mainAzimuth(fold);
    expect(roomHit(fold, dirFromAngles(az, 0))!.face.id).toBe('g');
    expect(roomHit(fold, dirFromAngles(az, 1.5))!.face.id).toBe('virtual:ceiling');
    expect(roomHit(fold, dirFromAngles(az, -1.5))!.face.id).toBe('virtual:floor');
  });
  it('a point on the neighbouring wall unfolds across the corner; the opposite wall is not drawn', () => {
    const main = fold.faces.find((f) => f.id === 'g')!;
    const right = fold.faces.find((f) => f.id === 'virtual:wall2')!;
    const p = facePoint(right, right.rect.x + 0.5, 1);
    const l = faceLocal(main, p)!;
    expect(l.x).toBeCloseTo(4.5);
    expect(l.y).toBeCloseTo(1);
    const back = fold.faces.find((f) => f.id === 'virtual:wall3')!;
    expect(faceLocal(main, facePoint(back, back.rect.x + 2, 1))).toBeNull();
    // ceiling ↔ side wall share an edge in 3D (not in the unfolded plan)
    const ceil = fold.faces.find((f) => f.role === 'ceiling')!;
    const q = facePoint(right, right.rect.x + 2, right.rect.y + 0.3);
    const lc = faceLocal(ceil, q)!;
    expect(lc.x).toBeGreaterThan(ceil.rect.x + ceil.rect.w);
  });
});

describe('projector setups', () => {
  const wall = {
    id: 'g',
    name: 'g',
    kind: 'wall',
    intensity: 1,
    polygon: rectPolygon(0, 0, 4, 2.25),
    playback: { mode: 'off' },
  } as unknown as Surface;
  it('one wide projector reaches the main wall and both side walls', () => {
    const [slot] = arrangementPoses([wall], 'threeWalls');
    const fold = roomFold([wall]);
    const hit = new Set<string>();
    const p = slot!.pose;
    for (const k of [-1, 0, 1]) {
      const yaw = p.yaw + (k * 0.95 * p.fov * Math.PI) / 360;
      const d = poseDir({ ...p, yaw });
      const h = roomRay(fold, p.pos, d);
      if (h) hit.add(h.face.role);
    }
    expect(hit.has('main')).toBe(true);
    expect(hit.has('side')).toBe(true);
  });
  it('per side setup gives 6 projectors', () => {
    expect(arrangementPoses([wall], 'sides')).toHaveLength(6);
  });
});

describe('corner measuring (projector pose from room corners)', () => {
  const wall = {
    id: 'g',
    name: 'g',
    kind: 'wall',
    intensity: 1,
    polygon: rectPolygon(0, 0, 4, 2.25),
    playback: { mode: 'off' },
  } as unknown as Surface;
  const fold = roomFold([wall]);
  const corners = roomCorners(fold);
  it('finds the 8 corners of the room', () => {
    expect(corners).toHaveLength(8);
    expect(corners[0]!.label).toBe('vorne links unten');
  });
  it('projectPose and poseRay are inverse', () => {
    const p = { ...aimPose([2, 1.5, 3], [2, 1, 0], 70, 0.1), shiftX: 0.1, shiftY: -0.4 };
    const P: V3 = [1.2, 0.4, 0];
    const q = projectPose(p, 16 / 9, P)!;
    const d = poseRay(p, 16 / 9, q[0], q[1]);
    const t = (P[0] - p.pos[0]) / d[0];
    expect(p.pos[1] + d[1] * t).toBeCloseTo(P[1], 6);
    expect(p.pos[2] + d[2] * t).toBeCloseTo(P[2], 6);
  });
  it('recovers a tilted, shifted projector covering three walls from the corners it sees', () => {
    const truth = { ...aimPose([0.5, 1.8, 0.5], [4, 0.8, 4], 110, 0.04), shiftY: 0.3 };
    const pts = corners
      .map((c) => ({ c, q: projectPose(truth, 16 / 9, c.p) }))
      .filter((x) => x.q && Math.abs(x.q[0]) < 1 && Math.abs(x.q[1]) < 1)
      .map(({ c, q }) => ({ p: c.p, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 }));
    expect(pts.length).toBeGreaterThanOrEqual(5);
    const start = aimPose([2, 1.4, 2.5], [2, 1.1, 0], 80, 0);
    const r = solvePose(start, 16 / 9, pts, fold)!;
    expect(r.errPx).toBeLessThan(0.5);
    expect(Math.hypot(...truth.pos.map((v, i) => v - r.pose.pos[i]!))).toBeLessThan(0.05);
  });
  it('finds the 12 edges of the room', () => {
    const e = roomEdges(fold);
    expect(e).toHaveLength(12);
    expect(e.some((x) => x.label === 'Vorne / Boden')).toBe(true);
  });
  it('five sides from one projector: visible corners plus points on the edges', () => {
    // projector at the back wall, sees main wall, both side walls, floor and ceiling
    const truth = { ...aimPose([2.1, 1.9, 3.85], [1.9, 1.0, 0], 118, -0.02), shiftY: 0.2 };
    const inImg = (q: [number, number] | null) => !!q && Math.abs(q[0]) < 0.98 && Math.abs(q[1]) < 0.98;
    const pts: { p: V3; q?: V3; u: number; v: number }[] = [];
    for (const c of corners) {
      const q = projectPose(truth, 16 / 9, c.p);
      if (inImg(q)) pts.push({ p: c.p, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 });
    }
    let edgePts = 0;
    for (const e of roomEdges(fold)) {
      for (const t of [0.3, 0.6, 0.85]) {
        const P: V3 = [
          e.a[0] + (e.b[0] - e.a[0]) * t,
          e.a[1] + (e.b[1] - e.a[1]) * t,
          e.a[2] + (e.b[2] - e.a[2]) * t,
        ];
        const q = projectPose(truth, 16 / 9, P);
        if (!inImg(q)) continue;
        pts.push({ p: e.a, q: e.b, u: (q![0] + 1) / 2, v: (1 - q![1]) / 2 });
        edgePts++;
      }
    }
    expect(edgePts).toBeGreaterThan(4);
    const r = solvePose(aimPose([2, 1.4, 2.5], [2, 1.1, 0], 90, 0), 16 / 9, pts, fold)!;
    expect(r.errPx).toBeLessThan(1);
    // what counts: the whole picture lines up – check points all over the room
    for (const P of [
      [0.5, 0.3, 0],
      [3.5, 2.0, 0],
      [4, 1, 1.5],
      [0, 1.8, 2.5],
      [2, 0, 1.5],
      [2, 2.25, 2],
    ] as V3[]) {
      const a = projectPose(truth, 16 / 9, P)!;
      const b = projectPose(r.pose, 16 / 9, P)!;
      expect(Math.hypot(a[0] - b[0], a[1] - b[1]) * 960).toBeLessThan(3);
    }
  });
  it('finds the point that was set on the couch instead of the hidden corner', () => {
    const truth = { ...aimPose([2, 1.6, 3.6], [2, 1.1, 0], 100, 0.02), shiftY: 0.1 };
    const pts: { c: string; p: V3; q?: V3; u: number; v: number }[] = [];
    for (const c of corners) {
      const q = projectPose(truth, 16 / 9, c.p);
      if (q && Math.abs(q[0]) < 0.97 && Math.abs(q[1]) < 0.97)
        pts.push({ c: `c|${c.id}`, p: c.p, u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 });
    }
    for (const e of roomEdges(fold))
      for (const t of [0.3, 0.7]) {
        const P: V3 = [
          e.a[0] + (e.b[0] - e.a[0]) * t,
          e.a[1] + (e.b[1] - e.a[1]) * t,
          e.a[2] + (e.b[2] - e.a[2]) * t,
        ];
        const q = projectPose(truth, 16 / 9, P);
        if (q && Math.abs(q[0]) < 0.97 && Math.abs(q[1]) < 0.97)
          pts.push({ c: `e|${e.id}|${t}`, p: e.a, q: e.b, u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 });
      }
    // the bottom left corner is hidden: the cross was put 8 % higher, on the couch
    const bad = pts.find((x) => x.c === 'c|vorne-links-unten')!;
    bad.v -= 0.08;
    const solved = solvePose(truth, 16 / 9, pts)!;
    const out = findOutliers(solved.pose, 16 / 9, pts);
    expect(out[0]?.c).toBe('c|vorne-links-unten');
  });
  it('a projector is set up to cover the sides chosen for it', () => {
    const b = boxFrame(fold)!;
    for (const walls of [['vorne'], ['links', 'vorne', 'rechts'], ['vorne', 'boden'], ['decke']] as const) {
      const pose = poseForWalls(fold, walls)!;
      expect(pose).not.toBeNull();
      for (const c of corners) {
        const n = cornerWalls(c.id).filter((w) => (walls as readonly string[]).includes(w)).length;
        // transitions between chosen sides (or all corners of a single side) are in the picture
        if (walls.length === 1 ? n < 1 : n < 2) continue;
        const q = projectPose(pose, 16 / 9, boxCorner(b, c.id, b.w, b.d, b.h)!)!;
        expect(Math.abs(q[0])).toBeLessThanOrEqual(1.0001);
        expect(Math.abs(q[1])).toBeLessThanOrEqual(1.0001);
      }
    }
    expect(poseForWalls(fold, ['vorne', 'hinten'])).toBeNull();
    // a wide projector in the room: front, both sides, floor and ceiling – possible, the corners
    // are measured anyway
    const five = poseForWalls(fold, ['links', 'vorne', 'rechts', 'boden', 'decke'])!;
    expect(five).not.toBeNull();
    for (const c of corners.filter((k) => k.id.startsWith('vorne'))) {
      const q = projectPose(five, 16 / 9, boxCorner(b, c.id, b.w, b.d, b.h)!);
      expect(q).not.toBeNull();
    }
  });
  it('a single wall (4 coplanar corners) still lines up exactly', () => {
    const truth = aimPose([1.5, 1.0, 3.0], [2.1, 1.2, 0], 60, -0.05);
    const pts = corners
      .filter((c) => Math.abs(c.p[2]) < 0.01)
      .map((c) => {
        const q = projectPose(truth, 16 / 9, c.p)!;
        return { p: c.p, u: (q[0] + 1) / 2, v: (1 - q[1]) / 2 };
      });
    expect(pts).toHaveLength(4);
    const r = solvePose(aimPose([2, 1.4, 2.5], [2, 1.1, 0], 50, 0), 16 / 9, pts, fold)!;
    expect(r.errPx).toBeLessThan(1);
  });
});

describe('scenes played in between', () => {
  it('fades in over the playback, plays once, then the playback goes on afresh', async () => {
    const { activeSceneFor } = await import('./playback.ts');
    const pb = {
      mode: 'scene' as const,
      scene: { themeId: 't', sceneId: 'a', params: {} },
      seed: 1,
      startedAt: 0,
      transition: { type: 'cut' as const, durationMs: 0 },
    };
    const ins = {
      id: 'x',
      scene: { themeId: 't', sceneId: 'b', params: {} },
      seed: 2,
      startedAt: 10_000,
      endAt: 58_000,
    };
    expect(activeSceneFor({ playback: pb, insert: ins }, [], 5_000)!.scene.sceneId).toBe('a');
    const during = activeSceneFor({ playback: pb, insert: ins }, [], 20_000)!;
    expect(during.scene.sceneId).toBe('b');
    expect(during.transition.type).toBe('crossfade');
    const after = activeSceneFor({ playback: pb, insert: ins }, [], 60_000)!;
    expect(after.scene.sceneId).toBe('a');
    expect(after.startedAt).toBe(58_000);
    expect(after.key).not.toBe(activeSceneFor({ playback: pb }, [], 60_000)!.key);
  });
});

describe('played in once: the other sides go dark', () => {
  it('puts the others on black for the same time and brings them back with the programme', () => {
    const basic: ThemeManifest = {
      ...theme,
      id: 'basic',
      scenes: [
        {
          ...theme.scenes[0]!,
          id: 'solidColor',
          params: [{ key: 'color', label: { en: 'C', de: 'C' }, type: 'color', default: '#202040' }],
        },
      ],
    };
    const c = { ...ctx(), catalog: createCatalog([theme, basic]) };
    let s = createInitialState('s', 'S', 0, 't', 7);
    s = applyCommand(s, { t: 'surface.create', name: 'W1', kind: 'wall' }, c).state;
    s = applyCommand(s, { t: 'surface.create', name: 'W2', kind: 'wall' }, c).state;
    const [w1, w2] = s.surfaces;
    s = applyCommand(
      s,
      { t: 'surface.insert', surfaceIds: [w1!.id], themeId: 't', sceneId: 'b', params: {}, sec: 20 },
      c,
    ).state;
    const on = s.surfaces.find((x) => x.id === w1!.id)!.insert!;
    const dark = s.surfaces.find((x) => x.id === w2!.id)!.insert!;
    expect(on.scene.sceneId).toBe('b');
    expect(dark.scene).toMatchObject({
      themeId: 'basic',
      sceneId: 'solidColor',
      params: { color: '#000000' },
    });
    expect([dark.startedAt, dark.endAt]).toEqual([on.startedAt, on.endAt]);
    s = applyCommand(s, { t: 'surface.resetProgram', surfaceIds: [w1!.id] }, c).state;
    expect(s.surfaces.every((x) => !x.insert)).toBe(true);
  });
});
