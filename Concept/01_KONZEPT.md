# SpectraStage
## Vollständiges Produkt- und Technikkonzept
Version 2.0 · 23.10.2026

## 1. Vision
Eine zentral über HTTPS auf dem eigenen öffentlichen Webserver gehostete, browserbasierte Projektions-App für zwei (oder später mehr) Projektoren: ein Garagentor als vertikale Spielfläche und die Einfahrt als perspektivisch verzerrte Bodenfläche. Beide Render-Clients werden über eine responsive Smartphone-Oberfläche in Echtzeit gesteuert. Kinderfreundlich, fröhlich-gruselig, jederzeit unterbrechbar, ohne Drittanbieter-Cloud-API und ohne Benutzerkonten.

**Produktziel:** Vollständige Anwendung statt Proof of Concept: Szenenbibliothek, Render-Engine, Zeitsteuerung, Audio-Reaktionen, optionales Push-to-talk mit zuverlässig steuerbaren Befehlen, Kalibrierung, Live-Controller, Betrieb, Tests und Dokumentation.

## 2. Nutzerrollen und Ablauf
- **Sitzungsinhaber/Showmaster:** öffnet die Controller-URL auf dem Smartphone, wählt Szenen je Fläche, steuert Spezialeffekte und Sicherheit, sieht den Verbindungsstatus.
- **Eingeladener Co-Controller (optional):** steuert nach expliziter Einladung; Berechtigungen pro Sitzung, kein Account.
- **Display/Renderer:** je ein Browserfenster pro physischem Projektor; rendert animierte Inhalte, meldet FPS/Gerätestatus und bestätigt Kommandos.
- **Guest/Publikum:** keinerlei Webzugriff nötig. Sieht ausschließlich Projektionen.

**Typischer Ablauf:** App auf eigenem öffentlichen Webserver öffnen → am Rechner Display 1 und Display 2 auf je einem HDMI-Ausgang im Vollbild öffnen → Kalibrierungsmodus aktivieren → sichere Projektionszonen prüfen → Szenen/Playlisten starten → vom Handy aus Effekte auslösen → bei Bedarf Blackout.

## 3. Kernfunktionen (vollständiger V1-Umfang)
### 3.1 Displays und Projektoren
- Beliebig viele logische Displays, für V1 zwei vorkonfiguriert (`garage`, `ground`).
- Je Display eindeutige URL `/display/:displayId`; eigener Fullscreen-Modus, Verbindung und Online-Status.
- Auflösung/DPR/FPS an Hardware anpassen; Fullscreen per Nutzeraktion, Chromium-Kiosk-Option dokumentieren.
- Ein Rechner mit zwei Monitorausgängen **oder** zwei unabhängige Rechner; kein proprietärer Player erforderlich.
- Synchronisierte Showzeit via Serveruhr und gemessene Latenz, aber je Display unabhängig laufende Szene.
- Nach Verbindungsabbruch lokale Animation stabil fortführen; danach autorisierten Zustand wiederherstellen.
- Kein zufälliger Wechsel des Displays: explizite Zuordnung/Pairing-Code und persistenter Gerätealias.

### 3.2 Szenen und visuelle Effekte
**Garage: mindestens sechs eigenständige Echtzeit-Szenen:**
1. **Haunted House:** leuchtende Fenster, freundliche Geister, Augen, Kürbisse, dezente Fledermäuse.
2. **Skeleton Disco:** tanzende Skelette mit rhythmischem Licht.
3. **Ghost Party:** Geister in mehreren Ebenen, spielerisches Schweben und Interaktionen.
4. **Pumpkin Magic:** Kürbisgesichter, wechselnde Mimiken, magische Funken.
5. **Monster Windows:** lustige Monster-Silhouetten hinter Fenstern, Klopfen an Scheiben.
6. **Moonlit Graveyard:** niedlicher Friedhof mit Mond und sanftem Nebel, keine Schockbilder.

**Boden: mindestens sechs eigenständige Echtzeit-Szenen:**
1. **Spiders & Fog:** freundlich gestaltete Spinnen bewegen sich über Nebelschwaden.
2. **Ghost Footprints:** auftauchende und verschwindende leuchtende Fußspuren.
3. **Magic Path:** magische Wegmarkierungen, Glitzer und Blätter.
4. **Pumpkin Trail:** kleine bewegte Kürbisse, Lichtpunkte und Sternspuren.
5. **Swirling Mist:** farbiger atmosphärischer Bodennebel mit partikelförmigen Highlights.
6. **Tiny Ghost Parade:** kleine freundliche Geister gleiten über den Boden.

**Overlay-/One-shot-Effekte:** mindestens 12, darunter `boo`, `batSwarm`, `pumpkinBurst`, `gentleLightning`, `spiderRush`, `ghostWave`, `confettiLeaves`, `sparkles`, `windowKnock`, `skeletonDanceBreak`, `magicCircle`, `footprintChase`.
- Mehrere animierte Layer; Overlays überschreiben nicht die Basis-Szene.
- Parameter: Dichte, Geschwindigkeit, Farbstimmung, Intensität, max. Partikelanzahl, Bewegungsstärke.
- Endlosschleifen ohne Sprung; reproduzierbare Seeds; weiche Übergänge; Preload vor Wechsel.
- Assets nach Möglichkeit prozedural (Canvas, SVG, Shader, Geometrie); keine urheberrechtlich problematischen Fremdassets; falls Assets genutzt werden, Lizenz lokal dokumentieren.
- Stil: **familienfreundlich** (freundlich-gruselig, keine Jumpscares, kein Gore, keine Stroboskopblitze).

### 3.3 Handy-Admin-UI
- Smartphone-first PWA-ähnliche Bedienung über HTTPS im LAN oder abgesichertes HTTP im isolierten LAN.
- Übersicht: beide Display-Karten, online/offline, aktuelle Szenen, Bildrate, aktive Overlays, Helligkeits-/Effektintensitätsregler.
- Quick Actions: Szene pro Display, Preset für beide Displays, One-shot-Effekt, Pause/Resume, Blackout.
- Presets: `Friendly Welcome`, `Classic Haunted`, `Skeleton Party`, `Magic Parade`, `Quiet Atmosphere`.
- Playlist-/Show-Editor: Szene, Dauer, Transition, Overlay-Cues, Ziel-Display, Loop, manuell überspringen.
- Live-Preview als ressourcenschonende Vorschau (nicht Pixelstreamingpflicht); Steuerungen unter 250 ms im lokalen Netzwerk bei normaler Belastung anstreben.
- Steuerung durch mehrere berechtigte Admins möglich; klar sichtbarer aktuell ausführender Operator.
- Große bedienbare Buttons, Dark UI, responsiv, Hoch-/Querformat.

### 3.4 Sound, Mikrofon und Sprache
- **Soundreaktionen optional und bewusst schaltbar**, deaktiviert per Default.
- Mikrofon nur nach ausdrücklichem Browser-Permission-Grant; sichtbar aktiver Zustand; keine dauerhafte Audioaufzeichnung, keine Server-Uploads, lokale Web-Audio-Verarbeitung.
- RMS/Lautstärke, Peaks/Klatschen, FFT-Frequenzbänder, Beat/Onset mit einstellbarer Schwelle, Debounce und Cooldown.
- Noise-gate, Kalibrierung gegen Grundrauschen, Trigger-Mindestabstände; keine automatische Auslösung durch jedes Gespräch.
- Reaktionsmapping in UI: z. B. `clap → ghostWave`, `beat → pumpkinPulse`, `loud → skeletonDanceBreak`, mit deaktivierbaren Regeln.
- Sprache **nicht als unzuverlässiges Always-On-Erkennungssystem**: optionaler Push-to-talk-Modus nur am Admin-Handy mit Browserunterstützung; deterministische Kommandoliste und sichtbare Bestätigung. Fallback immer Touch-Steuerung. Keine Cloud-Abhängigkeit für Kernfunktionen. Wenn lokale Spracherkennung im Browser nicht verfügbar ist, Feature klar deaktiviert statt versteckt auf Online-Dienste auszuweichen.
- Soundausgabe optional mit Master-Mute, Lautstärke und eigenständigen lokalen/rechtegeklärten Soundeffekten, ohne Auto-Play-Annahme.

### 3.5 Kalibrierung und Projektionsmapping
- Pro Display Testbild mit Gitter, Rand, Mittelpunkt, Nummern und Safe-Area.
- Transform: 4-Punkt-Keystone-/Homographie für Boden, affine Ausrichtung, Rotation, Flip, Cropping, Overscan, Masken/Polygone und Transformations-Reset.
- Mit Touch/Mouse anpassbare Eckpunkte samt numerischen Inputs; sofortige Vorschau; Presets speichern und exportieren.
- Edge-mask/Blackout-Polygone zur Begrenzung auf Einfahrt und weg von Gehweg/Straße.
- Hoher Kontrast, reine Schwarzflächen außerhalb der Projektionsmaske; Einschränkung dokumentieren: LCD/DLP strahlen auch bei Schwarz ggf. Licht ab.
- Kein automatisches „Sicherheitszertifikat“ durch Geometrie. Der Betreiber kontrolliert Einblick in die Lichtquelle und zulässige Installationshöhe/Projektorklasse gemäß Gerätehandbuch.

### 3.6 Sicherheit / Kindersicherheit
- Ein gut erreichbarer **Software-Blackout** (Broadcast an Displays) sowie separater Hinweis auf den **physischen Ausschalter/Netztrennung**. Software-Blackout ersetzt keine hardwareseitige Abschaltung.
- Projector placement checkliste vor Showbetrieb: keine erreichbare Linse, kein direkter Blick in den Strahl, Blendung des Verkehrs ausschließen, Kabel sichern, Wetterschutz, Belüftung, Brandschutz, erlaubte Montage, Stolperfallen.
- UI-Preset `Kids Mode` erzwungen in V1: keine abrupten Schreckeffekte; Lichtwechsel sanft, Flashes stark begrenzt, keine stroboskopartigen Effekte.
- Kein Face/Voice Tracking von Kindern; kein Kamera-Zugriff; keine personenbezogene Aufzeichnung.
- Security: **Keine Benutzeranmeldung und keine Accounts**. Sitzungsbasierte Capability-Tokens, gehashte Geheimnisse, kurzlebige Pairing-Codes, Rate-Limits, Origin-Prüfung, strikte WebSocket-Autorisierung; Kenntnis der öffentlichen URL allein gibt keine Rechte.

## 4. Architektur
```text
                     +-----------------------------+
                     | Smartphone Admin Controller |
                     | Scenes / Cues / Calibration |
                     +--------------+--------------+
                                    | HTTPS / WSS
                        +-----------v------------+
                        | Node.js / Fastify        |
                        | Pairing + WSS + State Store  |
                        | Shows + Scene Registry   |
                        | REST + Audit Events      |
                        +-----+-------------+-----+
                              |             |
                          WS / HTTP     WS / HTTP
                              |             |
                    +---------v---+    +----v---------+
                    | Garage      |    | Ground       |
                    | Renderer    |    | Renderer     |
                    | Three.js +  |    | Three.js +   |
                    | Canvas/2D   |    | Pixi/Canvas  |
                    +------+------+    +------+------+
                           |                  |
                      Short throw         Long throw
                           |                  |
                       Garage door           Driveway
```

**Stack:** TypeScript Monorepo (pnpm workspaces), Fastify Backend mit WebSocket, React + Vite für Dashboard, Rendering mit Three.js/WebGL2 und Canvas2D/PixiJS je Effekt, Zod für gemeinsame Schemas, SQLite (`better-sqlite3`) für Profile/Szenen/Shows/Konfiguration, Playwright/Vitest für Tests, verpflichtender PWA-Service-Worker für gecachte Renderer-Assets. Der öffentliche Webserver ist die zentrale Infrastruktur; keine Drittanbieter-Cloudpflicht.

**Warum nicht ausschließlich Three.js?** Flache animierte Formen und Partikel profitieren von Canvas 2D, volumetrische Portale/Shader von WebGL. Die Engine bietet beiden denselben Szenen-Lifecycle.

## 5. Datenmodell
- `Display`: id, name, type, capabilities, pairing, connection, currentScene, transform, mask, visualSettings.
- `SceneDefinition`: id, displayTargets, sceneFactory, paramsSchema, tags, preview, resourceBudget.
- `SceneInstance`: sceneId, params, startTimestamp, randomSeed, state.
- `OverlayCue`: id, targetDisplay(s), options, firedAt, duration, correlationId.
- `Preset`: name, scene per display, parameters, transition.
- `Show`: name, mode, playlist tracks, cues, loop, schedule.
- `AudioRule`: source, threshold, cooldown, effectId, target, enabled.
- `Device`: id, sessionId, friendlyName, capabilityTokenHash, pairingStatus, connection, lastSeen, rendererMetrics.
- `Session`: id, ownerTokenHash, createdAt, expiresAt, revision, state, recoveryPolicy.
- `PairingCode`: hash, sessionId, expiresAt, usesRemaining, rateLimitMetadata.
- `ClientCommand`: id, sessionId, targetDeviceIds, revision, issuedAt, expiresAt, acknowledgementState.
- `AuditEvent`: actor, command, target, outcome, timestamp.

All messages versioned, runtime-validated and acknowledged; server authoritative; display renderer sends heartbeat every 5 seconds.

## 6. REST- und WebSocket-Kontrakte (Vorschlag)
- `POST /api/sessions` (create anonymous session, issue owner capability), `GET /api/sessions/current`, `DELETE /api/sessions/current`.
- `POST /api/sessions/current/pairing-codes` (short-lived, rate-limited), `POST /api/pair` (request device join), `POST /api/devices/:id/approve`, `POST /api/devices/:id/revoke`.
- `GET /api/displays`, `POST /api/displays/:id/pair`, `PUT /api/displays/:id/calibration`.
- `GET /api/scenes`, `POST /api/displays/:id/scene`.
- `POST /api/effects/fire`, `POST /api/show/blackout`, `POST /api/show/resume`.
- `GET/POST/PUT/DELETE /api/shows`, `GET/POST/PUT /api/presets`.
- `GET/PUT /api/settings`, `GET /api/health`.
- `WS /ws/controller` und `WS /ws/display` mit Token-Autorisierung, `hello`, `state.snapshot`, `scene.set`, `effect.fire`, `calibration.set`, `blackout.set`, `heartbeat`, `ack`, `error`, `telemetry`.

## 7. Betriebsmodell
- `pnpm install`, `pnpm build`, `pnpm start`; zusätzlich `pnpm dev`.
- Konfiguration via `.env.example` mit PUBLIC_URL, PORT, TRUST_PROXY, DATABASE_PATH, SESSION_SECRET, TLS/Proxy-Einstellungen. Kein Admin-Setup, kein Passwort und kein Login.
- **Verpflichtend:** Dockerfile (Multi-stage), `.dockerignore`, produktives `compose.yaml`, persistentes SQLite-Volume, Healthcheck, SIGTERM/Graceful-Shutdown. Displayclients weiterhin im Browser.
- **Primärer Betrieb:** eigener öffentlicher Webserver mit `https://` und `wss://` über Reverse Proxy (NGINX/Caddy/Traefik), funktionierendem WebSocket Upgrade und korrekten Proxy-/Idle-Timeouts. Handy und Projektions-PCs können in getrennten Netzen sein.
- Kurzzeitiger Internetausfall: Bereits laufende Renderer behalten ihre Szene bei, weil Runtime/Assets nach Erstladen gecacht werden. Live-Befehle funktionieren erst nach Wiederverbindung; automatische Wiederanmeldung, Zustandssynchronisierung und UI-Statusanzeige. Vollständiger Neustart ohne zuvor gecachte Dateien ist nicht garantiert.
- Backup/Restore von Shows, Presets, Kalibrierungen als JSON und SQLite-Backup.
- Telemetrie lokal, kein Cloud-Tracking.

## 8. Performance und Qualitätsziele
- Renderziel 60 FPS auf durchschnittlichem Desktop, adaptive Qualität und Fallback 30 FPS.
- Das System soll auf einem älteren Laptop unter konservativer Partikelzahl nutzbar sein; Benchmarks auf Zielhardware.
- Kein Memory-Leak bei 4-stündiger Dauerschleife; Szenen müssen Assets/Listener/RenderTargets freigeben.
- Controller-Effektstart typischerweise <250 ms über LAN; Connection-Recovery und State-Reconciliation.
- WCAG-nahe Buttons/Fokus/Touch-Ziele; hochwertige kindgerechte Grafik und Übergänge.
- Tests für Auth, Messaging, State, Queue, Kalibrierungsarithmetik, Audioanalyse; Browser-End-to-End für beide Displays; manuelle Abnahmecheckliste.

## 9. Lieferumfang
- Voller Quellcode und lokal startbares Build.
- Mindestens 12 Echtzeit-Basisszenen, 12 One-shot-Effekte, 5 Presets.
- Vollständiges Admin-UI, Displayansichten, Kalibrierung, Audio-Reaktivität, Push-to-talk-Fallback-Konzept und echte Implementierung soweit Browser unterstützt.
- Setup/Deployment/Netzwerk/HTTPS-Doku, Tests, Demo-Daten, Lizenzaufstellung und Bedienungsanleitung.
- Bildschirmfreie Dauerlauf-Option; mobile Steuerung ohne externe Cloud.

## 10. Abgrenzungen und technische Realitäten
- Eine reine Web-App kann die physische Projektoroptik nicht kindersicher machen. Geometrie und Schutzabstände müssen vor Ort überprüft werden.
- Browser können Fullscreen, Audio und Mikrofonnutzung an Nutzerinteraktion oder sicheren Kontext knüpfen.
- Sprachkommandos sind browser- und plattformabhängig; Web Speech API ist nicht überall offline. Die App darf niemals für Kernfunktionen davon abhängen.
- Browser regeln keine echte Lampen-/Laserleistung: App-Regler verändern Bild-/Effektintensität, nicht notwendigerweise die Hardware-Helligkeit.
- Vollständige 3D-Inhalte dürfen mit 2D-Projektionseffekten kombiniert werden; nicht jedes Motiv muss zwanghaft 3D sein.


## 10. Verbindliche Produktentscheidung V2: SpectraStage als gehostete Multi-Session-App
**Projektname:** **SpectraStage** (Arbeitstitel; Namens-/Marken-/Domainverfügbarkeit nicht geprüft). Repo `SpectraStage`, Container `SpectraStage-server`.

### 10.1 Anonymous Session & Pairing UX
1. Nutzer öffnet `https://<your-domain>/` auf seinem Handy und drückt **Create Show**. Keine Registrierung, kein Login, kein Passwort.
2. Server erstellt eine zufällige `sessionId`, ein kryptografisch sicheres langlebigeres **Owner Capability Token** und eine kurzlebige **Pairing-ID** mit ca. 8 gut lesbaren Zeichen (alphabet ohne 0/O/1/I; Eingabe in Blöcken). Der Code ist **nur für den Beitritt**, niemals für vollständige Adminrechte.
3. Controller zeigt den Pairing-Code mit Gültigkeitsdauer und **Regenerate**. Das Owner Token ist nicht Teil des Pairing-Codes; nur HTTPS-Transport, sensible Tokens niemals in Logs oder URLs, wo vermeidbar. Controller speichert sein Token lokal im Browser und bietet eine explizite **Recovery-Key export/copy**-Funktion für Gerätewechsel sowie **Revoke Owner**. Informiere, dass Browserdatenverlust ohne Recovery-Key die Kontrolle unmöglich machen kann.
4. Jeder Projektions-PC öffnet `https://<your-domain>/display`, gibt Code und einen frei editierbaren Gerätenamen (z.B. `Garage`, `Driveway`, `Spare Projector`) ein. Der Server erzeugt eine **Pending Device**-Anfrage.
5. Controller sieht das neue Gerät und bestätigt oder lehnt es ab. Nach Bestätigung erhält das Gerät seinen eigenen **gerätgebundenen Capability Token**. Erst danach darf es Anzeigezustand empfangen und Telemetrie senden. In der Steuerung sind **1, 2 oder beliebig viele Geräte** separat oder als Gruppe steuerbar. Ein Code kann während der Gültigkeit mehrere Join-Requests ermöglichen, aber jede Anfrage benötigt Bestätigung. Implementiere rotierbare Codes und maximale Geräteanzahl als Konfiguration.
6. Ein Browserwechsel oder ein weiteres Handy benötigt entweder den ausdrücklich geteilten Recovery-Key oder einen gesonderten zeitlich begrenzten **Controller Invite Code** (kein Device Code). Einladung vom Owner genehmigen; Rollen `owner` und `controller` unterscheiden. Keine zentrale Benutzerkonten-Datenbank.
7. Mehrere Nutzer erstellen voneinander getrennte Shows auf demselben Server. State, Device, Playlist, Kalibrierung und Echtzeit-Nachrichten sind **streng nach Session isoliert**; Cross-Session-Tests sind Pflicht.
8. Sitzungsablauf / Cleanup: Inaktivitäts-TTL konfigurierbar (Default z.B. 30 Tage), aktive Sessions dürfen während einer laufenden Show nicht verfallen; Eigentümer kann Session/Devices entfernen und Tokens widerrufen. Daten Löschpolitik dokumentieren.

### 10.2 Realtime & Internetunterbrechungen
- `wss://` über denselben Origin. Heartbeat/Ping-Pong ca. alle 15–25 Sekunden, serverseitige Erkennung ausgefallener Clients, Browser-Online-Status ist nur Hinweis, nicht Wahrheit.
- Reconnect mit **exponentiellem Backoff und Jitter** (z.B. 0.5 s bis 30 s). Nach jedem Reconnect: Token validieren, `resume` mit letzter Revision, **vollständigen Session-State-Snapshot** empfangen und deterministisch mit Client-Rendering abgleichen.
- State-Änderungen auf dem Server in SQLite transaktional speichern; **monotone Revision pro Session**, Command-UUID, `ack`/`nack`, deduplizierende idempotente Verarbeitung. Out-of-order/alte Nachrichten verwerfen. Keine unendliche Replay-Queue.
- **Dauerzustand** (Szene, Playlist, Helligkeits-/Effektparameter, Kalibrierung, Blackout) nach Reconnect wiederherstellen. **Einmalige Effekte** (Boo/Lightning etc.) mit Ablaufzeit versehen und beim Reconnect **nicht nachträglich abspielen**. Nur aktuelle Zustände synchronisieren; vergangene Event-Cues nicht ungefragt wiederholen.
- Offline Render: Vorher geladene Assets lokal zwischenspeichern (Service Worker, versionsbasierter Cache, Vorladen aller aktiv genutzten Szene-Assets); bereits laufende Animation unabhängig vom Socket weiterlaufen lassen. Bei Wegfall des Internets keine schwarze Fläche oder Renderer-Neustart auslösen; ein kleines unaufdringliches Verbindungs-Symbol nur im Steuerungs-UI, nicht in der Projektion. Audio-Reaktivität auf dem jeweiligen Renderer funktioniert lokal weiter.
- Offline Controller: sichtbarer `Disconnected`-Status; **keine scheinbar erfolgreich ausgeführten Befehle**. Keine unbeschränkte Offline-Command-Warteschlange. Falls ein Befehl bereits gesendet, aber nicht quittiert wurde, beim Reconnect anhand Command-ID/Serverzustand auflösen.
- Multi-Tab und Multi-Client: eindeutige Client-IDs und Token-Abgrenzung; gleichzeitige Controller-Änderungen über revisionierte Serverzustände, letztes autorisiertes serverseitiges Update gilt; Konflikte UI-seitig erkennbar.
- Website/Server-Neustart: SQLite State wiederherstellen, Browser reconnected automatisch, Sessions/Devices bleiben gepairt; bei Client-Neustart ohne Internet nur gecachte Asset-Versionen möglich. Der Server kann nicht garantieren, dass Offline-Clients neue Befehle empfangen.
- Blackout ist ein **Softwareeffekt**, kein zuverlässiger Sicherheits-Stopp: bei Netztrennung kann ein Remote-Blackout nicht ankommen. Physische Projektorabschaltung vor Ort sicherstellen.

### 10.3 Deployment, Stack und Betrieb sind Pflicht
- Node.js LTS (unterstützte aktuelle LTS-Version, mindestens Node 22), **strict TypeScript** über Server, Web, Contracts, Szenen, Tests; keine neue JavaScript-only-App.
- **Docker Pflicht:** Multi-stage Produktions-Dockerfile, Docker Compose, Healthcheck, persistent SQLite-Storage, unprivileged runtime User, graceful shutdown, reproduzierbare Builds, einfaches Upgrade-/Backup-Konzept.
- Fastify + `@fastify/websocket`/`ws` bzw. gleichwertig, React + Vite, Three.js für WebGL, Canvas/PixiJS für 2D, Zod, SQLite, Vitest, Playwright, ESLint, Prettier.
- Domain-agnostisch: `PUBLIC_URL` und `TRUST_PROXY`, TLS-Termination am Reverse Proxy, `wss://` unter HTTPS, Reverse-Proxy Beispiel mit Upgrade/Connection-Headern, sinnvollen Read-/Idle-Timeouts und Body-Limits.
- Skalierung: V1 **single app server instance** mit SQLite und mehreren Sessions; kein sticky-session/Redis-Hochverfügbarkeitsversprechen. Dokumentiere, dass mehrere Serverinstanzen erst mit verteilter PubSub-/State-Architektur zulässig sind.
- Keine externe Google-/Apple-/Microsoft-Anmeldung, keine Passwortverwaltung. Keine kostenpflichtige API für Basisfunktionen. Webserver braucht Internet-Erreichbarkeit; die Animationsausführung braucht nach Caching keine permanente Serververbindung.
