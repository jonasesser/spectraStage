import type { ThemeRuntime } from '@spectrastage/engine';
import { wallScenes } from './scenes/wall.ts';
import { floorScenes } from './scenes/floor.ts';
import { neonScenes } from './scenes/neon.ts';
import { darkScenes } from './scenes/dark.ts';
import { effects } from './effects.ts';
import { actors } from './actors.ts';

export const halloweenRuntime: ThemeRuntime = {
  id: 'halloween',
  scenes: Object.fromEntries(
    [...wallScenes, ...floorScenes, ...neonScenes, ...darkScenes].map((s) => [s.id, s]),
  ),
  effects: Object.fromEntries(effects.map((e) => [e.id, e])),
  actors: Object.fromEntries(actors.map((a) => [a.id, a])),
};

export default halloweenRuntime;
