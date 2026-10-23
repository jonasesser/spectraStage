import type { EffectRef, Playback, Playlist, PlaylistItem, SceneRef, Transition } from './schema.ts';
import { createRng, hashInts } from './random.ts';

export interface PlaylistPosition {
  index: number;
  item: PlaylistItem;
  /** Absolute server time at which the current item started. */
  itemStart: number;
  /** Absolute server time at which the item ends (Infinity if held at the end). */
  itemEnd: number;
  /** Increments every time the playlist wraps around (for seeding). */
  cycle: number;
  ended: boolean;
}

const MAX_WALK = 100000;

/**
 * Deterministically computes which playlist item is active at `now`.
 * Every client computes the same result from the same playback anchor + synced clock,
 * so playlists continue advancing while a display is offline.
 */
export function playlistPosition(
  playlist: Playlist,
  playback: Extract<Playback, { mode: 'playlist' }>,
  now: number,
): PlaylistPosition | null {
  const items = playlist.items;
  if (items.length === 0) return null;
  const effectiveNow = playback.pausedAt ?? now;
  let index = Math.min(playback.anchorIndex, items.length - 1);
  let start = playback.anchorTime;
  let cycle = 0;
  const dur = (i: number) => (items[i] as PlaylistItem).durationSec * 1000;

  if (effectiveNow < start) {
    const item = items[index] as PlaylistItem;
    return { index, item, itemStart: start, itemEnd: start + dur(index), cycle, ended: false };
  }

  // Walk to the end of the list from the anchor.
  while (index < items.length && start + dur(index) <= effectiveNow) {
    start += dur(index);
    index++;
  }
  if (index < items.length) {
    const item = items[index] as PlaylistItem;
    return { index, item, itemStart: start, itemEnd: start + dur(index), cycle, ended: false };
  }
  if (!playlist.loop) {
    const last = items.length - 1;
    const item = items[last] as PlaylistItem;
    return { index: last, item, itemStart: start - dur(last), itemEnd: Infinity, cycle, ended: true };
  }
  // Loop: skip whole cycles arithmetically, then walk.
  const total = items.reduce((s, it) => s + it.durationSec * 1000, 0);
  const remaining = effectiveNow - start;
  const cycles = Math.floor(remaining / total);
  start += cycles * total;
  cycle = 1 + cycles;
  index = 0;
  let guard = 0;
  while (start + dur(index) <= effectiveNow && guard++ < MAX_WALK) {
    start += dur(index);
    index = (index + 1) % items.length;
    if (index === 0) cycle++;
  }
  const item = items[index] as PlaylistItem;
  return { index, item, itemStart: start, itemEnd: start + dur(index), cycle, ended: false };
}

export interface ActiveScene {
  scene: SceneRef;
  /** Unique key for this scene activation; a change means "start a new scene instance". */
  key: string;
  seed: number;
  startedAt: number;
  transition: Transition;
  /** Present when driven by a playlist. */
  position?: PlaylistPosition;
}

export function activeScene(
  playback: Playback,
  playlists: readonly Playlist[],
  now: number,
): ActiveScene | null {
  if (playback.mode === 'scene') {
    return {
      scene: playback.scene,
      key: `s:${playback.seed}:${playback.startedAt}`,
      seed: playback.seed,
      startedAt: playback.startedAt,
      transition: playback.transition,
    };
  }
  const playlist = playlists.find((p) => p.id === playback.playlistId);
  if (!playlist) return null;
  const pos = playlistPosition(playlist, playback, now);
  if (!pos) return null;
  const seed = hashInts(playback.seed, pos.cycle * 1000 + pos.index);
  return {
    scene: pos.item.scene,
    key: `p:${playlist.id}:${playback.seed}:${playback.anchorTime}:${pos.cycle}:${pos.index}`,
    seed,
    startedAt: pos.itemStart,
    transition: pos.item.transition,
    position: pos,
  };
}

export interface ScheduledEffect {
  at: number;
  effect: EffectRef;
  seed: number;
  key: string;
}

/** Deterministic ambient effect schedule for one playlist item activation. */
export function ambientSchedule(active: ActiveScene): ScheduledEffect[] {
  const pos = active.position;
  const ambient = pos?.item.ambient;
  if (!pos || !ambient || ambient.effects.length === 0) return [];
  const rng = createRng(hashInts(active.seed, 0xa11b));
  const minGap = Math.min(ambient.minGapSec, ambient.maxGapSec) * 1000;
  const maxGap = Math.max(ambient.minGapSec, ambient.maxGapSec) * 1000;
  const end = Number.isFinite(pos.itemEnd) ? pos.itemEnd : pos.itemStart + 3600_000;
  const out: ScheduledEffect[] = [];
  let t = pos.itemStart + minGap + rng() * (maxGap - minGap);
  let n = 0;
  while (t < end - 1500 && n < 500) {
    const effect = ambient.effects[Math.floor(rng() * ambient.effects.length)] as EffectRef;
    out.push({ at: t, effect, seed: Math.floor(rng() * 2 ** 31), key: `${active.key}:a${n}` });
    t += minGap + rng() * (maxGap - minGap);
    n++;
  }
  return out;
}
