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
import { applyCommand, createInitialState, CommandError, type ReducerContext } from './reducer.ts';
import { createCatalog, type ThemeManifest } from './theme.ts';
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
