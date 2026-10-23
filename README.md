# SpectraStage

Web-based interactive projection & animation platform. A phone creates an anonymous show, any
number of projector PCs join with a pairing code, and everything – scenes, effects, creatures
crawling from the garage door onto the house wall, calibration and masks – is controlled live
from the phone. Halloween is the first theme; the core is theme-independent.

> German quick start for the operator: [docs/SCHNELLSTART.md](docs/SCHNELLSTART.md)

## Features

| Area | What you get |
| --- | --- |
| Sessions | No accounts. Owner capability key (= recovery key), 8-char pairing codes (join request only, approval required), co-controller invites, revoke/rotate, strict per-show isolation |
| Stage | Unfolded 2D stage in meters: polygon surfaces (wall / floor / other), any number of projector outputs with resizable viewports, n:m coverage |
| Sync | Deterministic rendering from a shared server clock (NTP-style sync with slewing), cues scheduled 150–400 ms ahead, actors computed identically on every client → seamless cross-projector handoff |
| Offline | Displays keep animating (scenes, playlists, roaming creatures) without the server; service worker caches the app; per-output failover: continue / freeze / blackout |
| Calibration | Per-output profiles, 4-corner homography + 3×3…5×5 mesh warp, rotation/flip, crop, undo/redo, live preview on the projector before *Apply*, export/import, resolution-mismatch guard (black until resolved), test pattern with timeout |
| Masks | Polygon / rectangle / ellipse, include / exclude, safety masks with hard edges + margin, cosmetic feather, applied as the very last pixel stage |
| Halloween theme | 13 real-time scenes (2 GLSL shaders + shader fog), 12 effects, 4 actors (spider, bat, ghost, black cat), 6 presets, auto-playing wall/ground show templates with random effects |
| Basic theme | Aurora (shader), starfield, color waves, solid color, 2 effects, firefly actor |
| Safety | Child-safe mode (default on): brightness-rise limiter on every frame (< 3 flashes/s), no shock effects. Global / per-output / local (key `B`) blackout, clearly labelled as *not* a power switch |
| Sound | Procedural Web Audio on each projector PC (no audio files), master + per-output volume |
| Controller | Mobile-first React UI (DE/EN): live stage map with moving creatures, effects, presets, scene parameters, playlist editor, stage editor, calibration & mask editor, device management, backup |

## Architecture

```
apps/server        Fastify + WebSocket, SQLite (WAL, migrations), capability tokens, rate limits
apps/web           React + Vite: landing, controller (/c), projector view (/display), service worker
packages/shared    Zod schemas, protocol, pure reducer, playback & stage math (homography, actor routes)
packages/engine    Three.js renderer: surface layers → stage view → warp mesh → mask × gain; sound; clock
packages/catalog   Build-time theme registry (manifests for the server, lazy runtimes for the browser)
themes/halloween   Theme package (manifest = data, runtime = rendering)
themes/basic       Neutral theme
tests/e2e          Playwright end-to-end tests
```

Server state is authoritative and revisioned; every change is persisted transactionally and the
full (small) snapshot is broadcast. Animation never depends on a stream of per-frame messages:
`frame = f(showTime, state, seed, calibration)`. See [SPEC.md](SPEC.md) for all decisions.

## Development

Requirements: Node.js ≥ 22, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev            # server on :3000 (tsx watch) + Vite on :5173 (proxies /api and /ws)
pnpm lint && pnpm typecheck && pnpm test
pnpm build && pnpm start   # production build served by the Node server on :3000
pnpm test:e2e       # Playwright (needs a Chromium: `npx playwright install chromium` or PW_CHROMIUM=/path)
```

Open `http://localhost:5173/` on the phone/desktop for the controller and
`http://localhost:5173/display` in a second browser window for a projector. Use
`/display?slot=2` for a second window on the same PC (separate identity).

## Deployment

Docker image + Compose, designed for Easypanel behind Cloudflare: see
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). Security model: [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).
Operating the show (projector PCs, kiosk mode, calibration, safety): [docs/OPERATIONS.md](docs/OPERATIONS.md).
Writing new themes: [docs/THEMES.md](docs/THEMES.md).

## Tested

- Unit/integration (Vitest): homography, warp/mesh, clock sync, playlist scheduling, ambient
  determinism, actor routes (continuity, determinism, garage→wall crossing), reducer permissions,
  pairing/approval, session isolation, invite single-use, command dedup, restart persistence,
  cue expiry, revocation, export/import.
- End-to-end (Playwright, Chromium/SwiftShader): create show → pair two projector windows →
  approve → scenes render → effect + spider run → global blackout reaches the renderer; second
  show stays isolated.
- Not verifiable in this build environment: real projector hardware, 60 fps on target PCs,
  the Docker build itself (no Docker daemon available – the build steps were executed manually),
  4 h burn-in. See the checklist in [docs/OPERATIONS.md](docs/OPERATIONS.md).

## Platform notes

- Fullscreen, audio and wake lock need one click on each projector PC (browser policy). Kiosk
  flags for Chrome/Edge are in OPERATIONS.md.
- A black pixel is not zero light. Masks and blackout reduce image content; they are not optical
  safety devices. A remote blackout cannot reach an offline PC – the local key `B` and the
  projector's power switch always work.
- Microphone and speech control were removed from scope (product decision D9).
