# Setup- und Sicherheitscheckliste

## Vor der Show
- [ ] Beide Beamer technisch geprüft; Modell und Risikogruppe im Gerätehandbuch kontrolliert.
- [ ] Keine frei erreichbare Projektorlinse und keine Position, von der Kinder direkt in den Strahl schauen können.
- [ ] Langdistanzgerät auf der Garage fest, wettergeschützt und ausreichend belüftet montiert.
- [ ] Kurzdistanzgerät vor dem Garagentor mechanisch geschützt, ohne Lüftungsöffnungen zu blockieren.
- [ ] Keine Projektion blendet Verkehrsteilnehmer oder reicht auf eine öffentliche Straße, falls das gefährlich oder unzulässig ist.
- [ ] Keine Stolperstellen durch Netzkabel, Stative oder Verlängerungsleitungen.
- [ ] Physische Abschaltung der Projektoren erreichbar und allen verantwortlichen Erwachsenen bekannt.
- [ ] Beamer können auch bei abgeschalteter Anzeige noch Licht emittieren: Blackout nicht als Augenschutz behandeln.

## Technische Inbetriebnahme
- [ ] Öffentliche HTTPS-Domain erreichbar; WebSocket (`wss://`) funktioniert hinter Reverse Proxy.
- [ ] Server läuft als Docker-Compose-Deployment mit persistentem Datenbankvolume und Healthcheck.
- [ ] Am Handy anonyme Show erstellt; Pairing-Code angezeigt (ohne Login).
- [ ] Display-PCs tragen Code ein und werden am Handy einzeln bestätigt.
- [ ] Eine zweite Sitzung sieht keine Geräte der ersten.
- [ ] Beide Displays mit eindeutiger URL geöffnet und korrekt gepairt.
- [ ] Vollbild auf jeweils richtigem Monitor/HDMI-Ausgang.
- [ ] Testgitter projiziert, vier Eckpunkte angepasst, Flächen maskiert.
- [ ] Szenen getrennt umschaltbar; Presets und Overlays getestet.
- [ ] Handy im selben Netzwerk; Verbindung und Reconnect getestet.
- [ ] Audio-Reaktionen zunächst AUS; erst nach manueller Schwellenkalibrierung aktivieren.
- [ ] Kid-safe Mode aktiv; keine hektischen Flash-Effekte.
- [ ] Blackout und physische Abschaltung getestet.
- [ ] Wetterschutz, Stromversorgung und Temperaturentwicklung im Dauertest überprüft.

## Während der Show
- [ ] Projektionen werden beaufsichtigt; keine unkontrollierte Annäherung an Lichtquelle.
- [ ] Bei direkter Sicht in die Linse oder unerwarteter Blendung: Projektor physisch abschalten und Standort ändern.
- [ ] Bei Regen, übermäßiger Hitze, Stromproblem oder unsicherem Stand: Betrieb beenden.

## Verbindungsstabilität
- [ ] Internet an einem Projektions-PC für 60 Sekunden trennen: Szene läuft unverändert weiter.
- [ ] Controller sieht korrekten Offline-Status und behauptet keine erfolgreiche Fernsteuerung.
- [ ] Internet wiederherstellen: WSS verbindet automatisch; neuester Stand wird synchronisiert.
- [ ] Einmalige Effekte werden nicht verspätet nachgeholt.
- [ ] Container-Neustart prüfen: Sessions, Geräte und Kalibrierung bleiben erhalten.
- [ ] Physischer Projektor-Aus-Schalter bleibt erreichbar, da Netzwerk-Blackout nicht garantiert ist.
