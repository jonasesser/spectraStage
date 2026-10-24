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
| D25 | Dusk support: session-wide *boost* (brightness/saturation lift in the final pass, black stays black, thicker creature outlines) and Neon high-contrast scenes; **auto mode** = server-side schedule applying presets / boost / blackout at local times (IANA time zone). |
| D26 | **Worlds are the core**: a scene is one world spread over the whole stage; every surface shows its own part. Roles per surface (auto: first wall = *main* with the centerpiece, e.g. the house – exactly once; other walls = *side*, floors = *ground*; *ceiling* explicit). Sky, clouds and the single moon are computed in shared world coordinates with a shared seed; all surfaces run playlists in lockstep. Single scenes per surface remain a secondary feature. |
| D27 | **Room mode**: walls laid out side by side in the order they go around; the world wraps from the last wall to the first (tileable sky/clouds at the seam). Floor below, ceiling above – up to all six sides of a room. |
| D28 | **Room corner per projector**: one projector may cover two surfaces at an angle (wall\|wall or wall/floor). Calibration marks the crease (points 5/6) and its position in the stage image; each side gets its own homography, the warp mesh has an exact vertex line on the crease. |
