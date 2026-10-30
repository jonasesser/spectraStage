/** Theme manifest types: pure data, safe to import on the server (no rendering code). */

export type Locale = 'en' | 'de';
export type LocalizedText = { en: string; de: string };

export const SURFACE_KINDS = ['wall', 'floor', 'other'] as const;
export type SurfaceKind = (typeof SURFACE_KINDS)[number];

export type ParamDef =
  | {
      key: string;
      label: LocalizedText;
      type: 'number';
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | { key: string; label: LocalizedText; type: 'boolean'; default: boolean }
  | { key: string; label: LocalizedText; type: 'color'; default: string }
  /** One of the show's guest photos (ghost photo id, '' = none / automatic). */
  | { key: string; label: LocalizedText; type: 'photo'; default: string }
  | {
      key: string;
      label: LocalizedText;
      type: 'select';
      options: { value: string; label: LocalizedText }[];
      default: string;
    };

export type ParamValues = Record<string, number | boolean | string>;

export interface SceneManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  /** Surface kinds this scene is designed for (others still allowed). */
  kinds: SurfaceKind[];
  icon: string;
  /** Two CSS colors used for the controller card gradient. */
  colors: [string, string];
  params: ParamDef[];
  /**
   * World scene: spread over the whole stage – every surface shows its own part (main wall,
   * side walls, ground, ceiling). Shown first in the controller.
   */
  world?: boolean;
}

export interface EffectManifest {
  id: string;
  name: LocalizedText;
  icon: string;
  durationMs: number;
  cooldownMs: number;
  /** false = hidden/blocked while child-safe mode is on. */
  childSafe: boolean;
  kinds: SurfaceKind[];
}

export interface ActorManifest {
  id: string;
  name: LocalizedText;
  icon: string;
  /** Surface kinds the actor prefers to travel on (others used if none exist). */
  kinds: SurfaceKind[];
  /** Body size in meters. */
  sizeM: number;
  /** Base speed in meters per second. */
  speedMps: number;
  /** Stop-and-go: pause range at waypoints in seconds ([0,0] = continuous). */
  pauseSec: [number, number];
  /** Waypoints for random roaming (min, max). */
  waypoints: [number, number];
  childSafe: boolean;
}

export type TransitionType = 'cut' | 'crossfade' | 'fadeBlack';

export interface PlaylistTemplateItem {
  sceneId: string;
  durationSec: number;
  transition: { type: TransitionType; durationMs: number };
  params?: ParamValues;
  ambient?: { effectIds: string[]; minGapSec: number; maxGapSec: number };
}

export interface PlaylistTemplate {
  id: string;
  name: LocalizedText;
  kind: SurfaceKind;
  loop: boolean;
  items: PlaylistTemplateItem[];
}

export interface PresetAssignment {
  sceneId?: string;
  playlistTemplateId?: string;
  params?: ParamValues;
}

export interface PresetManifest {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  assignments: Partial<Record<SurfaceKind, PresetAssignment>>;
  /** Stage ambient actors enabled by this preset (empty = ambient off). */
  ambientActors?: string[];
}

export interface ThemeManifest {
  id: string;
  version: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: string;
  rating: 'family' | 'mature';
  scenes: SceneManifest[];
  effects: EffectManifest[];
  actors: ActorManifest[];
  presets: PresetManifest[];
  playlistTemplates: PlaylistTemplate[];
  /** Default scene per surface kind when a surface switches to this theme. */
  defaults: Record<SurfaceKind, string>;
  /** Playlist templates that auto-start for newly created surfaces of a kind (template behaviour). */
  autoPlaylists?: Partial<Record<SurfaceKind, string>>;
  /** Surfaces created for a new show so the preview works before any projector is connected. */
  starterStage?: { name: LocalizedText; kind: SurfaceKind }[];
}

export interface ThemeCatalog {
  themes: ThemeManifest[];
  get(id: string): ThemeManifest | undefined;
}

export function createCatalog(themes: ThemeManifest[]): ThemeCatalog {
  const map = new Map(themes.map((t) => [t.id, t]));
  return { themes, get: (id) => map.get(id) };
}

export function defaultParams(defs: readonly ParamDef[]): ParamValues {
  const out: ParamValues = {};
  for (const d of defs) out[d.key] = d.default;
  return out;
}

/** Validate and clamp user supplied params against definitions; unknown keys are dropped. */
export function sanitizeParams(defs: readonly ParamDef[], input: ParamValues | undefined): ParamValues {
  const out = defaultParams(defs);
  if (!input) return out;
  for (const d of defs) {
    const v = input[d.key];
    if (v === undefined) continue;
    switch (d.type) {
      case 'number':
        if (typeof v === 'number' && Number.isFinite(v)) out[d.key] = Math.min(d.max, Math.max(d.min, v));
        break;
      case 'boolean':
        if (typeof v === 'boolean') out[d.key] = v;
        break;
      case 'color':
        if (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) out[d.key] = v.toLowerCase();
        break;
      case 'select':
        if (typeof v === 'string' && d.options.some((o) => o.value === v)) out[d.key] = v;
        break;
      case 'photo':
        if (typeof v === 'string' && /^[A-Za-z0-9_-]{0,40}$/.test(v)) out[d.key] = v;
        break;
    }
  }
  return out;
}

export function localize(text: LocalizedText, locale: Locale): string {
  return text[locale] || text.en;
}
