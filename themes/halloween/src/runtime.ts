import type { SceneModule, ThemeRuntime } from '@spectrastage/engine';
import { withObjectScale } from './shapes.ts';
import { wallScenes } from './scenes/wall.ts';
import { wallMonsterScenes } from './scenes/wallMonster.ts';
import { wallShowScenes } from './scenes/wallShow.ts';
import { floorScenes } from './scenes/floor.ts';
import { neonScenes } from './scenes/neon.ts';
import { darkScenes } from './scenes/dark.ts';
import { ceilingScenes, nightSky, worldScenes } from './scenes/worlds.ts';
import { groundScenes, panoramaScenes } from './scenes/panorama.ts';
import { effects } from './effects.ts';
import { actors } from './actors.ts';

const parts: Record<string, SceneModule> = Object.fromEntries(
  [
    ...wallScenes,
    ...wallMonsterScenes,
    ...wallShowScenes,
    ...floorScenes,
    ...neonScenes,
    ...darkScenes,
    ...panoramaScenes,
    ...groundScenes,
    ...ceilingScenes,
    nightSky,
  ].map((s) => [s.id, s]),
);

/** Object size of the side (projector setting) while the scene draws. */
function sized(m: SceneModule): SceneModule {
  return {
    ...m,
    create: (ctx) => {
      const inst = m.create(ctx);
      const k = ctx.world?.objectScale ?? 1;
      if (k === 1) return inst;
      return {
        render: (target, frame) => withObjectScale(k, () => inst.render(target, frame)),
        resize: (w, h, ppm) => inst.resize(w, h, ppm),
        setParams: (p) => inst.setParams(p),
        dispose: () => inst.dispose(),
      };
    },
  };
}

const all = { ...parts, ...Object.fromEntries(worldScenes(parts).map((s) => [s.id, s])) };

export const halloweenRuntime: ThemeRuntime = {
  id: 'halloween',
  scenes: Object.fromEntries(Object.entries(all).map(([id, m]) => [id, sized(m)])),
  effects: Object.fromEntries(effects.map((e) => [e.id, e])),
  actors: Object.fromEntries(actors.map((a) => [a.id, a])),
};

export default halloweenRuntime;
