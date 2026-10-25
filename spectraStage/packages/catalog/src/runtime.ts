import type { ThemeRuntime } from '@spectrastage/engine';

/** Theme runtimes are code-split: each theme loads only when a surface/cue needs it. */
const loaders: Record<string, () => Promise<ThemeRuntime>> = {
  halloween: () => import('@spectrastage/theme-halloween/runtime').then((m) => m.default),
  basic: () => import('@spectrastage/theme-basic/runtime').then((m) => m.default),
};

const cache = new Map<string, Promise<ThemeRuntime>>();

export function loadThemeRuntime(id: string): Promise<ThemeRuntime> {
  const loader = loaders[id];
  if (!loader) return Promise.reject(new Error(`Unknown theme runtime: ${id}`));
  let p = cache.get(id);
  if (!p) {
    p = loader();
    cache.set(id, p);
    p.catch(() => cache.delete(id));
  }
  return p;
}

export const installedRuntimeIds = Object.keys(loaders);
