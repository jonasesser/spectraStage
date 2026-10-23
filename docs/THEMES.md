# Writing a theme

A theme is a workspace package under `themes/<id>` with two entry points:

- `src/manifest.ts` – **data only** (no rendering imports). Used by the server for validation and
  by the controller UI: scenes (with parameter definitions), effects, actors, presets, playlist
  templates, defaults per surface kind, optional auto-playing playlists.
- `src/runtime.ts` – default export `ThemeRuntime` with scene/effect/actor modules. Loaded lazily in
  the browser.

Register it in `packages/catalog/src/manifests.ts` and `packages/catalog/src/runtime.ts`.

## Rules

1. **Deterministic**: draw as a pure function of `(time, seed, params, size)`. No `Math.random()`
   in draw code, no state accumulated frame by frame. Use `createRng(seed)`, `hash01`, `noise1`
   and `memo()` for seeded precomputation. Several projectors may show the same surface and must
   look identical; reconnecting clients must not jump.
2. **Any aspect ratio**: surfaces can be 4:1 or 1:2. Use `s.w`, `s.h` and `s.ppm` (pixels per
   meter) to size things physically.
3. **Projection-friendly**: black = no light. Keep backgrounds dark, content bright.
4. **Child-safe**: no strobe, no hard full-frame flashes. The engine's limiter caps brightness rises
   anyway, but design for it. Mark adult content `childSafe: false` / `rating: 'mature'`.
5. **Clean up**: free GPU resources in `dispose()`. Respect `quality` (0.35–1) to scale particle counts.

## Building blocks (`@spectrastage/engine`)

- `canvasScene(id, draw)` – Canvas2D scene.
- `shaderScene(id, glsl, uniforms?)` – full-screen fragment shader (`uTime`, `uRes`, `uSeed` provided).
- `hybridScene(id, glsl, uniforms, draw)` – shader background + Canvas2D foreground.
- Effects: `{ id, draw(g, info), sound?(sound, seed) }` drawn on a transparent overlay of the surface.
- Actors: `{ id, draw(g, pose, info), upright?, sound? }` – drawn at the origin facing +x; the engine
  computes the route across the stage and the pose.
- `SoundApi`: procedural `whoosh`, `ooh`, `chime`, `knock`, `rumble`, `pop`, `flutter`, `scuttle`,
  `arpeggio`, `ambience`.
