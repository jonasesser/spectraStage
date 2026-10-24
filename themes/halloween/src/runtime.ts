import type { SceneModule, ThemeRuntime } from '@spectrastage/engine';
import { wallScenes } from './scenes/wall.ts';
import { floorScenes } from './scenes/floor.ts';
import { neonScenes } from './scenes/neon.ts';
import { darkScenes } from './scenes/dark.ts';
import { nightSky, worldScenes } from './scenes/worlds.ts';
import { panoramaScenes } from './scenes/panorama.ts';
import { effects } from './effects.ts';
import { actors } from './actors.ts';

const parts: Record<string, SceneModule> = Object.fromEntries(
  [...wallScenes, ...floorScenes, ...neonScenes, ...darkScenes, ...panoramaScenes, nightSky].map((s) => [
    s.id,
    s,
  ]),
);

export const halloweenRuntime: ThemeRuntime = {
  id: 'halloween',
  scenes: { ...parts, ...Object.fromEntries(worldScenes(parts).map((s) => [s.id, s])) },
  effects: Object.fromEntries(effects.map((e) => [e.id, e])),
  actors: Object.fromEntries(actors.map((a) => [a.id, a])),
};

export default halloweenRuntime;
