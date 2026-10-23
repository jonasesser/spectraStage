# SpectraStage — Übergabepaket

Dieses ZIP enthält das vollständige **Konzept** und den **Master-Prompt** für einen Code-Agenten. **Es enthält noch nicht den Anwendungscode.** Der Agent soll diesen anhand der Spezifikation erstellen.

## Inhalte
- `01_KONZEPT.md`: Produktvision, Benutzerführung, Szenen, Sicherheit, Audio, technische Architektur, Betrieb, Akzeptanzziele.
- `02_CODE_AGENT_PROMPT.md`: ausführlicher englischer Implementierungsauftrag mit Muss-Anforderungen und überprüfbaren Abnahmetests.
- `03_CHECKLIST.md`: Checkliste für den ersten echten Aufbau mit den zwei Projektoren.

## Verwendung
1. ZIP in das gewünschte Projektverzeichnis entpacken.
2. `01_KONZEPT.md` und `02_CODE_AGENT_PROMPT.md` dem Code-Agenten als Arbeitskontext geben.
3. Den vollständigen Inhalt von `02_CODE_AGENT_PROMPT.md` als Agentenauftrag verwenden.
4. Nach erfolgreichem Build `03_CHECKLIST.md` beim Aufbau vor Ort abarbeiten.

Die V1 ist absichtlich umfassend. Ein Agent darf die Umsetzung intern in Phasen planen, soll aber keine Pflichtfunktion als bloße spätere Idee ablegen.

## Architekturentscheidung V2
Öffentlicher HTTPS-Webserver mit Node.js/TypeScript/Fastify, **verpflichtendem Docker Compose**, WebSockets, mehreren getrennten anonymen Shows und Pairing-Codes für beliebig viele Projektions-PCs. Keine Accounts, keine Anmeldung. Nach Verbindungsabbruch läuft eine bereits gestartete Projektion weiter und wird nach Reconnect mit dem Server abgeglichen. Beachte Abschnitt 10 im Konzept und `MANDATORY V2 OVERRIDES` im Agent-Prompt.

**Name:** SpectraStage (Arbeitstitel; Name/Domain/Marke nicht geprüft).
