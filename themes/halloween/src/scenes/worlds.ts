/**
 * Worlds: one scene spread over the whole stage. Every surface shows its own part of it –
 * the centerpiece (e.g. the house) exists exactly once on the main wall, the other walls continue
 * the world (graveyard, ghost forest …), the ground and the ceiling get their own parts.
 * Sky, clouds and the single moon are computed in shared world coordinates (see SKY_FRAG), and in
 * room mode they wrap around from the last wall back to the first.
 */
import type { SceneContext, SceneModule } from '@spectrastage/engine';
import { hybridScene, hash01 } from '@spectrastage/engine';
import { palette } from '../palette.ts';
import { bat, px } from '../shapes.ts';
import { speedOf } from './common.ts';
import { envPalette, SKY_FRAG, skyUniforms } from './env.ts';
import { drawWorldEvents } from './worldEvents.ts';

/** Night sky seen from below – stars, drifting clouds, a few bats. For a ceiling. */
export const nightSky: SceneModule = hybridScene(
  'nightSky',
  SKY_FRAG,
  (s) =>
    skyUniforms(
      s,
      envPalette(s.params),
      { moon: [0.5, -3], moonR: 0.06, horizonY: -0.6, clouds: 0.8, cloudBand: 2 },
      speedOf(s),
    ),
  (g, s, f) => {
    const pal = palette(s.params);
    const t = f.time * speedOf(s);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const period = 16 + hash01(i * 7 + 2) * 10;
      const u = ((t / period + hash01(i * 3)) % 1) * 1.3 - 0.15;
      const ang = hash01(i * 11) * Math.PI * 2;
      const cx = s.w / 2 + Math.cos(ang) * (u - 0.5) * s.w * 1.2;
      const cy = s.h / 2 + Math.sin(ang) * (u - 0.5) * s.h * 1.2;
      bat(g, cx, cy, px(s, 0.45, 0.05, 0.12), Math.sin(t * 15 + i), pal);
    }
  },
  { shaderScale: 0.5 },
);

export interface WorldParts {
  main: string;
  side: string[];
  ground: string[];
  ceiling?: string;
}

export const WORLDS: Record<string, WorldParts> = {
  // Walls are one continuous panorama (see panorama.ts); ground and ceiling are their own planes.
  spookWorld: { main: 'spookPanorama', side: ['spookPanorama'], ground: ['spidersAndFog'] },
  partyWorld: { main: 'partyPanorama', side: ['partyPanorama'], ground: ['pumpkinTrail'] },
  neonWorld: { main: 'neonPanorama', side: ['neonPanorama'], ground: ['neonFog'] },
  quietWorld: { main: 'quietPanorama', side: ['quietPanorama'], ground: ['ghostFootprints'] },
};

/** Which part scene a surface plays inside a world. */
export function partFor(parts: WorldParts, ctx: Pick<SceneContext, 'world' | 'kind'>): string {
  const w = ctx.world?.self;
  const role = w?.role ?? (ctx.kind === 'floor' ? 'ground' : 'main');
  const i = w?.roleIndex ?? 0;
  if (role === 'main') return parts.main;
  if (role === 'ground') return parts.ground[i % parts.ground.length]!;
  if (role === 'ceiling') return parts.ceiling ?? 'nightSky';
  return parts.side[i % parts.side.length]!;
}

export function worldScenes(byId: Record<string, SceneModule>): SceneModule[] {
  return Object.entries(WORLDS).map(([id, parts]) => {
    const main = byId[parts.main];
    return {
      id,
      create: (ctx) => {
        const mod = byId[partFor(parts, ctx)] ?? main!;
        // Parts learn which world they belong to (for world events that cross surfaces).
        const tag = (p: SceneContext['params']) => ({ ...p, worldId: id });
        const inst = mod.create({
          ...ctx,
          params: tag(ctx.params),
          overlay: (g, s, f) => drawWorldEvents(g, s, palette(s.params), f.time * speedOf(s)),
        });
        return {
          render: (target, frame) => inst.render(target, frame),
          resize: (w, h, ppm) => inst.resize(w, h, ppm),
          setParams: (p) => inst.setParams(tag(p)),
          dispose: () => inst.dispose(),
        };
      },
      ambientSound: main?.ambientSound,
    } satisfies SceneModule;
  });
}
