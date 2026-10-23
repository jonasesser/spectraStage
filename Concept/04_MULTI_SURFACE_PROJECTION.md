# SpectraStage – Multi-Surface Projection, Cross-Device Synchronization & Masking

**Document type:** Additional concept / requirements extension  
**Status:** Proposal for agent review; planning only  
**Applies to:** SpectraStage core, projector clients, mobile controller and all themes  
**Suggested location:** `concept/04_MULTI_SURFACE_PROJECTION.md`

## 1. Goal

SpectraStage must treat multiple independent projectors, computers and physical building surfaces as parts of a **single coordinated virtual stage**. A character or effect must be able to move convincingly from a garage door onto an adjacent house wall, including surfaces driven by different computers. Administrators must be able to calibrate projection regions and exclude windows, doors, neighboring property, reflective areas and any other surfaces that should not receive projected content.

The platform must remain theme-independent. A spider crawling from the garage door to the wall is the initial Halloween example, not a hard-coded special case.

## 2. Terminology & Model

- **Session:** Independently controlled show with its own devices, stage layout, timeline and access capabilities.
- **Display client:** Browser attached to a physical projector; registered to exactly one session at a time.
- **Output / viewport:** A renderable projector output with its own pixels, resolution, calibration and optional crop.
- **Physical surface:** Named real-world region such as `Garage Door`, `House Wall`, or `Driveway`.
- **Virtual stage:** Shared logical coordinate space containing the physical surfaces and their relationships.
- **Projection mapping:** Transformation of virtual stage content into calibrated output coordinates.
- **Exclusion mask:** Region to be deliberately kept black in the projector output.
- **Show timeline:** Shared time reference for deterministic animations and scheduled cues.
- **Handoff:** Continued movement of the same virtual object across outputs without restarting or teleporting it.

One output may cover multiple physical surfaces, and one physical surface may be covered by multiple outputs. Do **not** assume a one-to-one relationship.

## 3. Core User Stories

1. I can register two or more display clients to a session with the existing pairing workflow and name their outputs (e.g., `Garage`, `Wall`, `Ground`).
2. In the admin interface, I can visually place these outputs and surfaces in a shared stage layout and calibrate their geometry.
3. A spider that starts on the garage door can follow a path onto the house wall, rendered by two separate devices with synchronized position, speed and animation phase.
4. I can define arbitrary polygons over windows and other areas to black out projection there, including holes inside otherwise active surfaces.
5. I can preview and edit masks and paths from my phone, with precision adjustments available on a larger screen.
6. I can save multiple calibration profiles for different weather, projector placement, resolutions or event setups.
7. A temporary disconnection does not freeze a running animation; when connectivity returns, devices reconcile without restarting the scene or replaying stale cues.
8. An administrator can independently stop an output, dim a defined region or blackout all outputs.

## 4. Shared Stage Coordinate System

- Define a **global stage space** in configurable units (preferably meters for physical planning, with a normalized 2D fallback).
- Model each physical surface as a planar 2D polygon embedded in the stage, with local UV coordinates and transforms into global stage coordinates. Surface boundaries and adjacency must be explicit.
- Support irregularly shaped building surfaces and discontinuities. A wall and garage door may be on different planes; no requirement to pretend they form a single flat screen.
- Define transitions between surfaces as editable **paths/portals**, including entry point, exit point, orientation, scale and timing. This permits smooth-looking handoffs even when physical geometry is imperfect.
- Give every animated instance a persistent global ID, deterministic seed, timeline start time, path and animation state. Rendering is a per-output view of the same logical instance, not two separately launched copies.
- Handle overlap between outputs via explicit priority / blend regions, not accidental double brightness. Where possible, provide edge-blend correction; recognize that true seamless blending needs compatible projectors and reliable calibration.

### Practical first implementation

Start with a **2.5D mapping system**: polygonal planar surfaces plus UV transforms, editable cross-surface paths and per-output perspective transforms (homographies). Reserve the architecture for later full 3D mesh projection mapping. Do not make high-end 3D reconstruction mandatory for the first release.

## 5. Projection Calibration and Admin Editor

Provide a dedicated **Stage Mapping Editor**, separate from the live show controls.

**Stage layout:**
- Add, name, move, rotate and resize physical surfaces.
- Assign output(s) to each surface and set adjacency / cross-surface path connections.
- Overlay optional user-uploaded reference photograph(s) for planning (stored per session); never require external image services.
- Display output footprints, projector resolutions, surface boundaries, overlap regions and excluded polygons.

**Per-output calibration:**
- Render numbered corners, checkerboard, alignment grids and high-contrast test targets on demand.
- Provide 4-corner keystone/homography adjustment; support extra mesh/control points for uneven geometry when needed.
- Support physical aspect ratios, output orientation, viewport scale/offset, rotation, crop and safe edge margins.
- Show a controller-side preview with the chosen output's transformed geometry and masks.
- Support a **test pattern timeout** to avoid leaving bright patterns active accidentally.
- Save, duplicate, export/import and restore calibration profiles, with undo/redo and an explicit Apply/Save workflow.
- Protect against accidental loss of calibration when output resolution or browser scaling changes: detect, warn and offer recalibration.

**Mobile experience:**
- Phone: select outputs/surfaces, drag polygon vertices with zoom/pan and a large handle size, toggle masks and run alignment patterns.
- Desktop/tablet: full precision editor, coordinates, snapping, multi-selection, guide lines and keyboard nudges.

## 6. Exclusion Masks and Safe Projection Zones

Masks are **per output** because different projectors illuminate surfaces from different angles. Allow masks to be composed with surface masks and shared stage restrictions.

**Required functionality:**
- Draw polygons, rectangles and ellipses; edit vertices, add/remove points, reorder shapes.
- Support multiple excluded regions and holes (e.g., glass windows inside a projected wall).
- Offer positive inclusion regions as well as exclusions, with a clearly documented composition order.
- Provide hard-edge black masks and optional configurable feathering for cosmetic transitions. **Safety-critical exclusion regions must use hard edges**; feathering must not allow light into a prohibited area.
- Persist masks with the calibration profile, including output resolution and transform version.
- Mask **all layers**: background, characters, particle effects, transitions, calibration previews where appropriate, and audio-reactive overlays. Applying masking only to a background is unacceptable.
- Apply final pixel masks as the last visual stage before displaying a frame to ensure content cannot override them.
- Provide a visually obvious `Show Excluded Areas` admin overlay that is never visible in the public show.
- Add a configurable **mask safety margin** around windows / glass / reflective or off-property surfaces.
- When a profile is missing, invalid or has a resolution mismatch, default that output to a black frame until corrected or deliberately approved.

**Important physical limitation:** A black pixel on a projector does not guarantee zero emitted light. Masks reduce projected image content but cannot provide certified optical shielding. Use physical positioning, barriers/shutters and manufacturer safety instructions where strict avoidance is necessary.

## 7. Cross-Client Synchronization

The central service coordinates each session using **WebSockets (WSS)**, but the animation must not depend on an uninterrupted stream of per-frame commands.

**Synchronization design:**
- Server assigns a monotonically increasing session state version, unique event IDs and a shared show epoch.
- Clients estimate server clock offset and jitter through repeated time exchange, using a monotonic local clock for rendering.
- Animations evaluate as a deterministic function of shared show time, instance seed and scene parameters: `frame = render(showTime, sceneState, calibration)`.
- Send **time-stamped future cues** (scene changes, spider path start, effects) with a scheduling lead time that accounts for measured latency. Clients execute at the designated shared time, not immediately on packet arrival.
- Periodically resync clocks and adjust gradually to avoid animation jumps; expose measured clock drift, RTT and sync quality in the controller.
- On reconnect, obtain an authoritative state snapshot plus currently active timeline; discard stale one-shot effects and do not replay expired cues.
- Commands must be idempotent via IDs, acknowledgement and a versioned state model. Out-of-order updates must not overwrite a newer state.
- Allow configurable failover behavior per output: `continue current show locally`, `freeze`, or `blackout` after a chosen extended outage. Default to continuing the existing show for brief outages.
- Persist any data needed for deterministic animation locally in the browser where technically feasible; cache required theme assets ahead of show start.
- Use Service Worker/offline caching as an **optional resilience enhancement**, with clear browser/storage limits. The application remains centrally hosted and initially needs connectivity to load and pair.

**Handoff behavior:**
- A single virtual spider travels along one global path with a known start time and duration.
- Each projector clips/renders only the portion visible in its calibrated viewport, including overlaps if configured.
- Position, velocity, scale, facing, leg cycle and effects are synchronized from the same global state.
- When a path crosses a gap, use a configurable hidden segment, visual transition or timed exit/re-entry rather than forcing implausible movement.

**Quality targets (to validate, not promise):** Strive for a visually convincing handoff on a typical home network, ideally under ~50 ms perceived timing error when clock and rendering allow. Measure actual jitter and warn when unsuitable. Internet latency and browser scheduling prevent any unconditional frame-perfect guarantee.

## 8. Show Design and Control

- Add a **Stage View** to the controller with all current outputs, surfaces and live scene assignments.
- Support cue triggers targeting: one output, one physical surface, a group, or the entire stage.
- Provide editable global animation paths and configurable handoffs between surfaces.
- Support manually triggering a spider traversal from Garage to Wall, reversing it, changing speed and spawning several independently seeded characters.
- Include an optional cue sequence/playlist and scene schedule so complex effects do not require live tapping.
- Show per-client online/reconnecting/offline state, active profile, scene, health and estimated synchronization quality.
- Device naming and roles are independent of pairing code and can be changed later.
- Require confirmation before applying risky calibration changes to a live public-facing show; allow preview before commit.

## 9. Multi-Session Security and Network Behavior

- Maintain the no-account experience specified by the main concept: session owner capability token, short-lived pairing code for requesting device admission, and controller approval for new outputs.
- Authorize all WebSocket messages against the relevant session/device privileges; enforce strict session separation.
- A pairing code must **never** itself grant controller ownership.
- Store session secrets safely; do not print them in logs or include them in public client URLs.
- Rate-limit pairing attempts, rotate/expire codes, and support removing or revoking an output.
- Projector clients must not accept control from unpaired browsers or another session.

## 10. Suggested Data Model (Illustrative)

- `Session`: id, title, owner capability reference, themeId, stateVersion, showEpoch
- `DisplayClient`: id, sessionId, displayName, capabilities, connectionStatus, lastSeen
- `Output`: id, clientId, width, height, devicePixelRatio, profileId
- `Surface`: id, sessionId, label, polygon, planeTransform, adjacency
- `MappingProfile`: id, outputId, name, referenceResolution, homography, mesh?, safeMargins
- `Mask`: id, profileId, shape, geometry, mode, safetyMargin, hardEdge
- `ProjectionAssignment`: outputId, surfaceId, uvMapping, renderPriority, blendZone?
- `Path`: id, sessionId, ordered surface segments, controlPoints, transitionRules
- `AnimatedInstance`: id, sceneId, pathId, startAtShowTime, seed, parameters
- `Cue`: id, sessionId, type, target, scheduledShowTime, stateVersion, payload

TypeScript strict schemas and runtime validation are required. Use persistent SQLite storage and schema migrations as specified in the core architecture; do not assume every scene instance requires frequent database writes.

## 11. Recommended Incremental Implementation Inside the Full Product

1. Calibrated independent outputs, per-output masks and safe default black frames.
2. Stage editor with multiple surfaces, assignments and cross-surface paths.
3. Shared timeline/time synchronization, deterministic animation state and timestamped cues.
4. Working `Garage → House Wall` spider demonstration between **two browser clients on separate computers**.
5. Reconnection and state recovery; preview, diagnostics and profile management.
6. Overlap blending and deeper mesh-based geometry only when core requirements are met.

These are implementation milestones, **not** permission to ship an incomplete demo. The deliverable must meet the agreed final acceptance criteria.

## 12. Acceptance Tests

- Pair three outputs into a session and control them independently and as a group; a second session remains completely isolated.
- Calibrate one output against the garage door and another against the house wall; save/reload both profiles.
- Mark two windows as excluded polygons. Verify that all visual content and effects remain black inside exclusion zones during scene changes.
- Run a spider along an editable global route that exits the garage output and enters the wall output without reinitializing the animation; verify correct orientation and timing.
- Disconnect the internet briefly on one client during traversal. Existing animation continues locally; after reconnection, client rejoins the actual global state rather than replaying expired effects.
- Restart the central server. Clients reconnect automatically; persisted session and calibration configurations are recovered.
- Change output resolution and confirm invalid calibration never silently projects outside the intended active region.
- Use the mobile controller to edit/enable/disable a mask, trigger a traversal, select a profile and blackout individual/all outputs.
- Confirm all controls are operational and no calibration or mask setting bypasses the final render-stage mask.

## 13. Questions the Code Agent Must Resolve Before Implementation

1. Should stage geometry begin as a photo-assisted 2.5D layout, or will physical wall/garage dimensions be measured?
2. Will Garage and Wall always use separate projectors, or will one projector sometimes cover both?
3. Are the surfaces on the same plane, around a corner or separated by an unprojected gap?
4. What approximate projector resolutions, brightness classes, mounting positions and browser/OS combinations should be tested first?
5. Is a simple black-window mask sufficient aesthetically, or is physical light avoidance required for specific locations?
6. Which output and synchronization diagnostics should be shown prominently on a phone?
7. Should the stage editor offer photo-based point correspondence before a full 3D scene editor?

**Review instruction:** This extension must be read together with the existing `concept/` documentation. If there are contradictions, present them and ask the user before implementation. Do not replace the existing pairing, Docker, Node.js/TypeScript or multi-session requirements.
