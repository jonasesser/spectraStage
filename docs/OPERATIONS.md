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

## 3. Calibrating

*Projectors* → *Calibrate*:
1. Switch on the test pattern (auto-off after 10 min).
2. **Corners**: drag the four numbered corners until the white frame / orange surface outlines
   sit on the real edges. Use *Zoom to point* and the arrow pad (coarse/fine) for precision.
3. **Fine grid** (optional): 3×3–5×5 points for bent or uneven surfaces.
4. **Masks**: rectangle/ellipse/polygon over windows, the door, the street. Leave *Safety mask*
   on for anything that must stay dark – hard edge plus safety margin. *Only light here* (green)
   limits light to a region. *Show masked areas on the projector* helps while setting up.
5. **Image**: rotation, mirroring (rear projection / ceiling mount), safe edges.
6. Everything previews live on the projector; nothing is saved until **Apply calibration**.
   Undo/redo with ↶ ↷ (Ctrl+Z on desktop).
7. Save variations as profiles (e.g. *ladder*, *rain cover*) and export them as files.

If the projector later reports a different resolution, that output turns **black** until you
either keep the calibration or recalibrate – it never silently projects outside the calibrated
area.

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
