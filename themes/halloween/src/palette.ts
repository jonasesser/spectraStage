import type { ParamValues } from '@spectrastage/shared';

export interface Palette {
  /** Main glow color (pumpkins, lights). */
  primary: string;
  /** Warm highlight (window light, sparks). */
  secondary: string;
  /** Contrasting accent. */
  accent: string;
  /** Ghost / bone white. */
  ghost: string;
  /** Very dark sky gradient (top, bottom). Projection: keep close to black. */
  sky: [string, string];
  /** Dark silhouette fill with a hint of color. */
  shadow: string;
  /** Rim light for silhouettes. */
  rim: string;
  /** Extra party colors. */
  party: string[];
  /** Same colors as 0..1 RGB triples for shaders. */
  rgb: {
    primary: [number, number, number];
    secondary: [number, number, number];
    accent: [number, number, number];
    ghost: [number, number, number];
  };
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function make(p: Omit<Palette, 'rgb'>): Palette {
  return {
    ...p,
    rgb: { primary: rgb(p.primary), secondary: rgb(p.secondary), accent: rgb(p.accent), ghost: rgb(p.ghost) },
  };
}

export const PALETTES: Record<string, Palette> = {
  classic: make({
    primary: '#ff8a1f',
    secondary: '#ffd166',
    accent: '#a66bff',
    ghost: '#eaf6ff',
    sky: ['#07040f', '#140a24'],
    shadow: '#1b1030',
    rim: '#b07cff',
    party: ['#ff8a1f', '#ffd166', '#a66bff', '#6bff9e', '#ff6fb5'],
  }),
  violet: make({
    primary: '#c77dff',
    secondary: '#ffa6e8',
    accent: '#6fe3ff',
    ghost: '#f4ebff',
    sky: ['#06030f', '#170a30'],
    shadow: '#1d0f38',
    rim: '#ff8ae0',
    party: ['#c77dff', '#ffa6e8', '#6fe3ff', '#fff07a', '#8affc1'],
  }),
  green: make({
    primary: '#7dff6b',
    secondary: '#e3ff6b',
    accent: '#ff8a1f',
    ghost: '#e9ffec',
    sky: ['#020a06', '#08190f'],
    shadow: '#0c2216',
    rim: '#7dff9e',
    party: ['#7dff6b', '#e3ff6b', '#ff8a1f', '#b38cff', '#6fe3ff'],
  }),
  neon: make({
    primary: '#ff7a1a',
    secondary: '#ffe14d',
    accent: '#b84dff',
    ghost: '#f2f8ff',
    sky: ['#1c0840', '#3a0f66'],
    shadow: '#24093f',
    rim: '#d98bff',
    party: ['#ff7a1a', '#7dff4d', '#b84dff', '#ffe14d', '#4de8ff', '#ff4dd2'],
  }),
  blue: make({
    primary: '#6ec6ff',
    secondary: '#c2ecff',
    accent: '#ffd166',
    ghost: '#f0f8ff',
    sky: ['#02060f', '#08142a'],
    shadow: '#0c1830',
    rim: '#8fd3ff',
    party: ['#6ec6ff', '#c2ecff', '#ffd166', '#c77dff', '#7dffb0'],
  }),
};

export function palette(params: ParamValues): Palette {
  return PALETTES[String(params.mood ?? 'classic')] ?? (PALETTES.classic as Palette);
}

export function num(params: ParamValues, key: string, d: number): number {
  const v = params[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
}

/** Bright rim color used when the dusk boost is on (stays visible on dark and bright backgrounds). */
export const BOOST_RIM = '#e8ff8a';
