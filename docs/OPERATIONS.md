# Operating a show

## 1. Projector PCs

Any PC with a current Chrome or Edge works (Windows, macOS, Linux). One browser window per
projector. Usually each projector has its own PC; one PC with two outputs works too – open the
second window as `/display?slot=2` so it gets its own identity.

1. Connect the projector, set the projector as display (extended desktop), native resolution.
2. Open `https://<your-domain>/display`, enter the pairing code from the phone and a name.
3. Confirm the device on the phone (*Projectors* tab).
4. Click once into the window: fullscreen + sound + screen wake lock.
5. Disable sleep / screen saver in the OS power settings.

Keys on the projector PC: **B** local blackout (works offline), **F** fullscreen, **I** status info.

### Kiosk mode (recommended for the show)

Windows – shortcut target (one per projector, adjust the screen position):
```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --app=https://show.example.com/display ^
  --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --noerrdialogs ^
  --window-position=1920,0 --user-data-dir=C:\spectrastage\beamer1
```
- `--window-position` places the window on the projector (x = width of the primary screen).
- A separate `--user-data-dir` per window keeps the device identities apart.
- Browsers cannot place windows on a monitor without this flag or a user action; this is a
  browser restriction, not a SpectraStage limitation.

Edge accepts the same flags (`msedge.exe`).

### iPhone / iPad

Safari on iPhone has no fullscreen for web pages. Open the page, tap **Share → Add to Home
Screen**, then start SpectraStage from the home-screen icon: it runs without browser bars (also
recommended for the controller – no toolbars jumping in and out). In the calibration editor
select a point (1–4) and drag anywhere on the canvas – it works like a touchpad, so your finger
never covers the point; *Fine* slows it down.

## 2. Building the stage

1. *Stage* tab: each approved projector created a surface automatically. Rename surfaces, set
   their kind (wall / floor) and rough size in meters.
2. Lay the house out **unfolded**: walls side by side (a wall around the corner simply goes next
   to the garage), the driveway below the garage. Leave a gap where nothing is projected – the
   spider walks through it invisibly.
3. Dashed frames are the projector images. Move them over the surfaces they hit, drag the white
   corner to match the image size (a projector further away covers more meters).

### Worlds – one scene for the whole house

A *world* (Szenen → Welten, also every show preset) covers all surfaces at once; each projector
shows its part. The main wall gets the centerpiece (the haunted house exists only once), the walls
next to it continue the world (graveyard, ghosts, pumpkins), the ground and the ceiling get their own
parts. Sky, clouds and the moon continue across the seams.

- *Bühne → surface → Part of the world*: automatic (first wall = main wall) or main / side / ground /
  ceiling.
- **Room all around** (Bühne): lay the walls side by side in the order they go around the room; the
  last wall then connects back to the first. Floor below, ceiling above – all six sides work.

## 3. Calibrating

*Projectors* → *Calibrate*:
1. Switch on the test pattern (auto-off after 10 min).
2. **Corners**: drag the four numbered corners until the white frame / orange surface outlines
   sit on the real edges. Use *Zoom to point* and the arrow pad (coarse/fine) for precision.
3. **Fine grid** (optional): 3×3–5×5 points for bent or uneven surfaces.
4. **Masks**: rectangle/ellipse/polygon over windows, the door, the street. Leave *Safety mask*
   on for anything that must stay dark – hard edge plus safety margin. *Only light here* (green)
   limits light to a region. *Show masked areas on the projector* helps while setting up.
5. **Room corner** (optional, *Corners* tab): if one projector hits two surfaces at an angle
   (two walls around a corner, or wall and floor), choose *vertical* or *horizontal* and put points
   5 and 6 onto the real corner line. Each side then gets its own perspective. The crease position
   snaps to the border between the two surfaces on the stage and can be fine-tuned with the slider.
6. **Image**: rotation, mirroring (rear projection / ceiling mount), safe edges.
7. Everything previews live on the projector; nothing is saved until **Apply calibration**.
   Undo/redo with ↶ ↷ (Ctrl+Z on desktop).
8. Save variations as profiles (e.g. *ladder*, *rain cover*) and export them as files.

If the projector later reports a different resolution, that output turns **black** until you
either keep the calibration or recalibrate – it never silently projects outside the calibrated
area.

### Projectors in the 3D room: measuring corners and objects

Everything is done from the phone (Stage → 3D room); nothing has to be set on the projector PC.

- **Quick setup**: 6 projectors (one per side), 1 projector for 3 walls, 3 walls + floor + ceiling,
  1 projector wall + floor, main wall only. Connected projectors are re-aimed, planned ones replaced.
- **The room has 6 fixed sides** (front, right, back, left, floor, ceiling) – nothing to add or measure.
  Choose per projector which sides it lights (Projectors tab); it is set up to cover them
  (opposite sides are refused – that needs a second projector).
- **Calibrate** (projectors in the 3D room) opens the guided measuring: step by step only the
  corners of the sides chosen for this projector (front only = 4 corners); the projector shows
  those sides with their names (VORNE, LINKS …) and a cross – move it from the phone onto the real
  corner, “fits – next”. A measured corner is the truth: each chosen side is pinned exactly onto its
  measured corners (projective mapping, like the 2D corner calibration); sides not chosen stay
  dark. The computed projector position only fills in corners that could not be measured and keeps
  proportions on walls lit at an angle. A corner that cannot be reached can be skipped; then a point
  on one of the edges running into it stands in for it. Calibration never changes the size of the
  room or its surfaces: the proportions are set by the user with “wall width” (front/back) and
  “room depth” (sides, floor, ceiling) – the pictures always fill the sides completely. Choosing
  another side keeps the corners already measured (front + left = 6 corners, not 8). Measuring
  replaces an earlier flat 2D corner correction. **Proportions** (per projector, per side, horizontal
  and vertical, 5 %–500 %): narrower = the scene is laid out for a bigger area and put onto the
  side, so things get narrower and more of them fit; wider = the opposite. The side always stays lit
  completely, the room sizes (Stage → room size, in meters) do not change. On the side walls, floor and ceiling the
  proportion eases in from the edge to the front wall (100 % right at the edge, the set value at the
  far end), so creatures still go round the corner seamlessly; the front/back wall changes evenly.
  **Object size** (per side, 25 %–400 %): pumpkins, graves, figures and animals bigger or smaller,
  their places and spacing stay. **Shift** (per side, ↔ and ↕): moves the picture of the side, e.g.
  the floor so the path lies under the real door; things crossing over from other sides (bats,
  world events) are drawn where they really are, so they still meet at the corner.
  **Audience standpoint** (Stage → room panel; default: middle of the back wall, eyes at 1.6 m):
  things standing on the real floor (jack-o'-lanterns, ghosts, the cat, rolling pumpkins; not
  webs, spiders or footprints) are painted stretched away from there (like 3D street art), so
  from that spot they look upright; from elsewhere they look stretched.
  Mummy, cute monster and bloody groom are real rigged 3D models (`apps/web/public/models/*.glb`,
  Mixamo skeleton in T-pose, e.g. from Meshy; shrink new ones with `scripts/optimize-glb.py in.glb
  out.glb`); the scene places them, turns the head and solves the arms itself.
  The 3D wall scenes **Mummy breaks out** / **Cute monster peeks out** / **Guests break out** (the
  newest ghost photos come out of the wall one per round) (wall scenes, dark wall,
  ~50 s loop with sound; tempo and dark pause adjustable) are rendered from the same standpoint, so
  the monster seems to come out of the real wall. They are raymarched – a weak projector PC may
  stutter. “Measure again from scratch” resets points,
  position and 2D corrections; Stage → room panel can restore the planned width of the front wall.
- **📦 Objects**: add a box or a pillar; while it is selected every projector shows its yellow
  outline – drag it on the floor in the 3D view, nudge and size it until the outline sits on the real
  object. Looks: glow, fire flicker, spooky colours, glowing edges, dark. Objects hide the walls
  behind them for the projectors.
- **Diagnosis** (Projectors → details): GPU, scaling, window, render size, graphics mode, errors,
  picture brightness, why black is drawn on purpose, and a live picture of what the projector app
  draws. Graphics mode (standard / compatible / Full HD / power-saving GPU) switches live.

### Ghost photos (zombie camera)

Segmentation uses MediaPipe's multiclass selfie model (`selfie_multiclass.tflite`, ~16 MB): background, hair, body skin, face skin, clothes – the creature's colours go on all skin (face, ears, neck, hands) and the hair, the face mesh adds the make-up details.

Live tab → 👻 Ghost photos: start the camera on the phone and press the shutter (or tap the
camera picture). Every person in the picture becomes their own ghost photo – a group of five gives
five ghosts – saved in the show and rising together on the projectors, each from where the person
stood. Photos are only ever taken on the phone.

- **Face filter** (default): MediaPipe selfie segmentation cuts the people out; the face landmarker
  runs per person on a sharp crop around the head (small faces in groups too) and gives a 3D face
  mesh (468 points). A WebGL face filter (`apps/web/src/display/faceFilter.ts`) covers the mesh with
  a painted creature texture in two layers – a skin tint that keeps the real face's light, pores and
  wrinkles, and make-up details shaded by the real face – while the real eyes and mouth show
  through. 3D props (horns, witch hat, wolf ears, knife, arrow, neck bolts, fangs) follow the head
  pose; a head occluder hides what lies behind or inside the head. Creatures: zombie, ghost,
  vampire, skeleton, devil, werewolf, witch, cartoon. The people keep their own colours, slightly
  transparent like ghosts.
- **AI** (optional, ✨ Gemini or OpenAI): enter your own API key – it stays only in the open page
  (not saved, never sent to the SpectraStage server; enter it again after reloading). Each person's
  plain photo goes from the phone straight to the provider with a creature prompt, all people in
  parallel; the answer is cut out (OpenAI: transparent background; Gemini: black background +
  segmentation) and uploaded. When all are ready they rise together. If the AI fails, the face
  filter photo is used. The model id can be changed in the app (defaults in `lib/aiGhost.ts`). The
  CSP allows `connect-src` to `generativelanguage.googleapis.com` and `api.openai.com` for this.
- **Live picture on the projectors** (off by default): the camera video goes phone → projector PCs
  of the front wall via WebRTC (signalling through the show's WebSocket, STUN only – same Wi-Fi);
  they run the same face filter and let the guests drift along the main wall as live ghosts.
- Gallery: release saved ghosts again (several at once), call them back, delete them.

Models and the WebAssembly runtime are served by the app itself (/mediapipe/…), not precached by
the service worker. Needs camera permission on the phone (Permissions-Policy camera=self) and
`wasm-unsafe-eval` in the CSP. The face mesh data (`faceMesh.ts`) is MediaPipe's canonical face
model (Apache-2.0).

## 4. Running the show

- **Live**: tap surfaces on the stage map to choose targets, fire effects, send creatures (from →
  to, count, speed; ⇄ reverses), apply presets. *Full Halloween Show* runs auto-playing playlists
  on every surface plus roaming creatures – no tapping needed.
- **Scenes**: pick scenes per surface and fine-tune their parameters; start playlists.
- **Playlists**: scenes with durations, transitions, loop and random effects.
- **Blackout** (top right) turns every projector black immediately; *Resume* asks for confirmation.
  Per projector there is a separate blackout button.
- Status light per projector: green = fine, yellow = attention (slow network, low fps, sound not
  unlocked, local blackout), red = offline or calibration invalid. Tap for RTT, jitter, clock
  offset, fps and resolution.

### Dusk and auto mode

- Before it is fully dark, thin glowing content disappears in the ambient light. Use the
  **Neon show** preset (large bright saturated areas, dark creatures as silhouettes) and raise the
  **dusk boost** (Live tab) – it lifts brightness and saturation on every output; black stays black
  and creatures get glowing outlines.
- **Auto mode (schedule)** switches presets, boost and blackout at local clock times, e.g. 17:30
  Neon + boost 80 %, 18:30 Full show + boost 0, 21:00 blackout. It runs on the server; the phone can
  be switched off. Entries apply once per day; editing the schedule re-applies the current entry.

### When the internet drops

- Projector PCs keep playing: scenes, playlists and roaming creatures continue from the local
  clock. Effects you fire while a projector is offline are **not** played later.
- The phone shows *Offline* and disables all controls – it never pretends a command arrived.
- After reconnecting, every projector converges to the current show state automatically.
- Per projector you can choose what happens after a longer outage: keep playing (default),
  freeze the picture, or go black (*Projectors* → tap the card).

## 5. Safety checklist (before every show)

- [ ] Projector manual checked (risk group, allowed mounting, distances).
- [ ] No reachable lens; children cannot look straight into any beam – especially the floor
      projector from above: nobody may look up into it from the driveway.
- [ ] No glare for road users, no light onto the public road or into neighbours' windows (masks
      plus projector position – masks alone are not optical shielding).
- [ ] Cables secured, no tripping hazards, weather protection, ventilation, power protected.
- [ ] Every responsible adult knows the **physical power switch** of each projector. The software
      blackout is not a safety switch and cannot reach an offline PC.
- [ ] Child-safe mode on (default). Projections supervised while children are around.
- [ ] Test: blackout, local key `B`, internet off for 60 s on one PC (keeps playing, phone shows
      offline, no late effects), container restart (shows, devices and calibration survive).

## 6. Performance

The show is rendered live (like a game), not played back like a video, so it needs a GPU rather
than a video decoder. The engine keeps the load low automatically:

- Internal resolution is capped at about Full HD; 4K projectors receive an upscaled image.
- If a PC cannot hold 60 fps, the internal resolution drops first, then the output switches to a
  steady 30 fps (*Performance: Automatic*). *Eco* forces 30 fps and a lower resolution – use it for
  very weak PCs or projector-internal browsers; *Always 60 fps* disables the 30 fps fallback.
- Creature and effect overlays are uploaded at reduced resolution; the child-safe brightness
  measurement reads back asynchronously so it never stalls the GPU.

Check the frame rate on the projector PC with key **I**.

## 7. Burn-in

Before the first public show, run the *Full Halloween Show* for ≥ 4 hours on the real PCs and
watch the status info (`I`): fps should stay stable and the browser's memory (Task Manager) should
not grow continuously. Lower *Density* or projector resolution on weak PCs; the renderer also
reduces its internal resolution automatically when the frame rate drops.
