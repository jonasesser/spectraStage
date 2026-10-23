# SpectraStage — Final Specification (v3)

This document supersedes `Concept/01_KONZEPT.md`, `Concept/02_CODE_AGENT_PROMPT.md`, `Concept/04_MULTI_SURFACE_PROJECTION.md` and the
additional requirements where they conflict. Everything not changed here still applies from the
concept. Decisions taken with the product owner on 2026‑10‑23 are marked **[D]**.

## 1. Product
SpectraStage is a hosted, browser-based **interactive projection & animation platform**.
A show owner creates an anonymous *show session* on a phone, pairs any number of projection
PCs by code, assigns each to a *surface* (e.g. garage door, driveway), calibrates them and
controls scenes, effects and playlists live. Halloween is the first theme; the core knows no
theme-specific content.

## 2. Product decisions
| # | Decision |
|---|----------|
| D1 | Delivered complete in one go; Halloween ships as a ready-made **template** (presets + auto-playing playlists with ambient effects) so no manual editing is needed. |
| D2 | **Public instance**: anyone may create shows. Protection via IP rate limits, global session cap, payload limits, per-connection message limits. |
| D3 | Theme is chosen **per surface**; a show can mix themes. |
| D4 | Child-safety mode (flash limiter, gentle transitions, no shock effects) is **on by default and can be switched off** per show. |
| D5 | Display that loses the server **keeps running** (scene + playlist advance locally); reconciles on reconnect. Local hotkey `B` blacks out a display even when offline. |
| D6 | Shows are stored **without expiry** (configurable `SESSION_TTL_DAYS`, default 0 = never). JSON export/import. |
| D7 | UI in **German and English** (switchable). Code/docs in English. |
| D8 | Visual style: **stylized/cartoon 2D + shaders**, procedural, no third-party assets. |
| D9 | **No microphone, no speech control** (dropped from scope). Control only via phone admin panel. |
| D10 | **Each device plays its own sound** (procedural Web Audio). Projection PCs are normally separate machines. |
| D11 | Hosting on **Easypanel behind Cloudflare** (Easypanel's Traefik terminates TLS). App reads real client IP from `CF-Connecting-IP`; WS heartbeat < 100 s (Cloudflare idle timeout). Compose file provided for generic Docker hosts too. |
| D12 | Co-controllers via single-use, time-limited **invite code** created by the owner. Owner can revoke. |
| D13 | Playlist editor per surface (scene, duration, transition, loop, skip, ambient random effects, timed effect cues). |
| D14 | Git: commit locally, never push. |
| D15 | **Virtual stage** = one schematic 2D plane in meters. Physical surfaces are polygons placed on it. Corners and floors are represented by *unfolding* (wall at 90° placed next to the garage, driveway below it). Gaps are simply empty stage space. |
| D16 | **Outputs** (projector clients) are independent of surfaces: each output shows a resizable rectangle (viewport) of the stage. Any n:m coverage is possible (one projector over garage + wall, two projectors on one wall, 3–4+ projectors). |
| D17 | **Actors** (spider, bats, ghosts …) are stage-level instances with deterministic but **random** routes generated at runtime from the surface layout (seeded random walk over the surfaces, optional *from → to* surfaces). They may leave the projected area. No hand-drawn path editor in this release. |
| D18 | Cues (effects, actor runs) are scheduled at a future show time with an **automatic lead of 150–400 ms** derived from the measured RTT of the session's outputs. |
| D19 | Failover per output: `continue` (default) / `freeze` / `blackout` after N seconds offline. |
| D20 | Controller shows a **status light per output** (online, sync quality, FPS, calibration validity) with details on tap (RTT, jitter, clock offset, resolution, profile). |
| D21 | **Masks per output** in output space: polygon / rectangle / ellipse, include or exclude, safety margin, hard edges for safety masks, optional feather for cosmetic masks. Applied as the very last pixel stage over all layers. |
| D22 | Calibration per output: **profiles** (several, duplicate, export/import), 4-corner homography **plus optional mesh grid** (up to 5×5) for uneven surfaces, rotation/flip, crop margins, test pattern with timeout, undo/redo and explicit *Apply*. Missing/invalid profile or resolution mismatch → output stays black until fixed or deliberately accepted. |
| D23 | No reference photo upload in this release (schematic layout instead). Overlaps are shown in the stage editor; each output has manual edge blending (gamma-corrected ramps per edge) and *dim* masks. |
| D24 | Playlist items support effects at fixed times in addition to random ambient effects. Effects inherit the color mood of the scene they play over. |

## 3. Concepts
- **Session (Show)**: isolated unit of state. Has a revision counter incremented on every change.
- **Stage**: 2D plane in meters containing surfaces and output viewports.
- **Surface**: physical region (`wall` / `floor` / `other`), polygon in stage space. Owns theme, scene, parameters, playlist playback. Scenes render in surface-local coordinates.
- **Output**: what one projector shows: a stage viewport + calibration profiles + masks + blackout/intensity/volume/failover.
- **Device**: one browser window on a projection PC. Paired by code, approved by a controller, bound to one output (swappable without losing calibration).
- **Cue**: timed instance in the shared show timeline (effect on surfaces, or actor run across the stage) with start time, duration and seed. Active cues are part of the state, so reconnecting clients join them mid-flight; ended cues are pruned and never replayed.
- **Controller**: phone/browser with role `owner` or `controller`.
- **Theme package**: bundle of scenes, effects, presets, template playlists and sounds; registered at build time (no runtime upload).

## 4. Security model (no accounts)
- Owner token = 32 random bytes (base64url) = **recovery key**. Stored in browser `localStorage`, exportable/copyable, rotatable ("revoke owner" issues a new key and invalidates the old one).
- All tokens stored as SHA‑256 hashes only. Tokens never appear in URLs or logs; WS authenticates in the first message.
- Device pairing code: 8 chars from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (≈40 bit), shown as `XXXX-XXXX`, valid 15 min, regenerable. It only creates a **pending** join request; a controller must approve. Grants nothing else.
- Controller invite code: same format, separate namespace, single use, 15 min.
- Every REST/WS operation is scoped by the session bound to the token; cross-session tests are mandatory.
- Rate limits (per client IP): session creation 10/h, pairing attempts 20/10 min, invite redemption 20/10 min, WS messages 60/s burst; global `MAX_SESSIONS`, `MAX_DEVICES_PER_SESSION`, max pending joins.
- WS `Origin` must match `PUBLIC_URL` (when set). Body limit 256 KB, WS frame limit 256 KB.

## 5. Realtime protocol
- Single endpoint `GET /ws` (same origin, `wss://` behind TLS). First client message `hello {token, clientId, lastRevision}`.
- Server sends full `snapshot` (state is small) after hello and after every change. Clients ignore snapshots with lower revision.
- Commands: `{type:"cmd", id:uuid, cmd}` → `ack {id, revision}` / `nack {id, code}`. Server deduplicates the last 500 command ids per session (resend returns the original result).
- Effects and actor runs are **cues** `{startAt, endAt, seed, …}` held in state while active; clients render them as a pure function of `showTime - startAt`, so all outputs agree and a reconnecting client resumes mid-flight. Ended cues are pruned and never replayed.
- Liveness: app-level `ping/pong` every 15 s (also used for clock sync, min-RTT filter); server terminates silent sockets after 45 s. Reconnect with exponential backoff 0.5–30 s + jitter.
- Controllers disable all actions while disconnected (no offline queue).

## 6. Playback model (deterministic, offline-capable)
- Manual scene: `{themeId, sceneId, params, seed, startedAt}`.
- Playlist playback: `{playlistId, anchorIndex, anchorTime, pausedAt?}`; clients compute the current item from the synchronized server clock. Skip/pause move the anchor. Works while offline.
- Ambient effects inside a playlist item are generated deterministically from `(seed, time slot)` so all clients agree without messages.

## 7. Rendering pipeline (per output, one WebGL2 canvas, Three.js)
1. For every surface intersecting the viewport: render its scene (with crossfade) + surface effects in surface-local coordinates.
2. Compose the **view** (viewport of stage space): surface polygons textured with their layers; actors (stage-space) clipped to the surfaces; optional test pattern (stage grid, surface outlines, labels).
3. **Warp** the view into output pixels: homography from 4 corners + bilinear mesh offsets, applied on a finely subdivided mesh; rotation/flip; crop margins.
4. **Final pass**: output masks (include/exclude, safety margin), intensity, safety limiter gain, blackout/failover fade. Nothing is drawn after this.
- Scenes and actors must be deterministic functions of time + seed (so overlapping outputs agree).
- **Safety limiter** (when child-safe on): measures mean luminance of each frame on a tiny downsampled target and caps the rate of brightness increase (≈ < 3 flashes/s, WCAG 2.3.1 orientation).
- Adaptive quality: render scale 1.0 → 0.75 → 0.5 when FPS < 50 sustained.

## 8. Operational safety
Software blackout (per output, global, local hotkey) is a convenience, **not** an optical safety control: a projector may still emit light, and a remote blackout cannot reach an offline PC. Docs + UI state this and include the site checklist (lens access, viewing into beam esp. floor projector from above, road glare, cables, weather, ventilation).

## 9. Stack
Node 22, pnpm workspaces, TypeScript strict, Fastify 5 + `@fastify/websocket`, better-sqlite3 (WAL, transactional), Zod, React 18 + Vite, Three.js, Vitest, Playwright, ESLint, Prettier, Docker multi-stage, Compose.
