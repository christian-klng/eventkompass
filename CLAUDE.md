# CLAUDE.md

Projektnotizen für Claude Code. Sprache im Projekt (UI, Kommentare, Fehlermeldungen, Doku): **Deutsch**.

## Was ist das?

**Eventkompass** – OKR-/Kennzahlen-Tracker für Events (v0.1, erste lokale Testversion).
Ein Event hat Ressorts (z. B. Marketing, Sponsoring); Kennzahlen (KPIs) hängen am Event oder an einem Ressort,
haben Ziel, Ist-Wert, Frist, Abhängigkeiten zu anderen KPIs und eine Änderungshistorie.

Namen: Ordner `okr-tracker`, npm-Paket `okr-event-tracker`, Container `okr-tracker`, UI-Titel „Eventkompass“.

## Stack

- **Backend:** Node (ESM, `"type": "module"`), Express 4, eine Datei: `server.js`
- **Speicher:** keine Datenbank – der gesamte Zustand liegt im Speicher und wird bei jeder Änderung komplett
  nach `DATA_DIR/data.json` geschrieben (atomar über `.tmp` + `rename`)
- **Frontend:** Vanilla JS ohne Framework/Build-Schritt: `public/index.html`, `public/app.js`, `public/style.css`.
  Wird von Express statisch ausgeliefert. Schrift Inter von Google Fonts.
- **Demo-Daten:** `seed.js` (Summit 2027, 5 Ressorts, 16 KPIs)
- Keine Tests, kein Linter, kein Build.

## Lokal starten (OrbStack / Docker)

Die App läuft in OrbStack unter **http://localhost:8090**.

```bash
docker compose up -d --build   # bauen + starten (oder ./start-dev.command per Doppelklick)
docker compose logs -f         # Logs
docker compose down            # stoppen
curl http://localhost:8090/api/health
```

**Ports:** Im Container lauscht die App auf `8080` (Dockerfile `ENV PORT=8080`), nach außen gemappt auf **8090**
(`docker-compose.yml`: `"8090:8080"`). Port 8080 auf dem Host ist durch ein anderes Projekt belegt
(`maki-caddy`) – nicht auf 8080 zurückstellen.

**Code-Änderungen** werden nur nach `docker compose up -d --build` wirksam – `server.js`, `seed.js` und `public/`
werden ins Image kopiert, nicht gemountet. Nur `./data` ist als Volume gemountet (`./data:/data`).

Ohne Docker: `npm install`, dann `PORT=8090 npm start` bzw. `PORT=8090 npm run dev` (`node --watch`).
Ohne `PORT` wäre der Standard 8080 → kollidiert hier. Docker-Image nutzt Node 22, lokal ist Node 24 installiert.

## Daten

- `data/data.json` – echte Laufzeitdaten, in `.gitignore`/`.dockerignore`. Nicht von Hand ändern, während der
  Container läuft (der Server hält den Zustand im Speicher und überschreibt die Datei beim nächsten Speichern).
- Seed nur beim allerersten Start, wenn `data.json` fehlt. `SEED: "false"` in `docker-compose.yml` → leerer Start.
- `POST /api/reset` lädt die Demo-Daten neu, `POST /api/reset?empty=1` leert alles. **Ohne Rückfrage, ohne Schutz** –
  nicht gegen echte Daten aufrufen.

## Datenmodell (`{ events, ressorts, kpis }`)

- **Event:** `id, name, startDate, endDate, createdAt`
- **Ressort:** `id, eventId, name, lead, color, createdAt`
- **KPI:** `id, eventId, ressortId|null` (null = Event-Ebene), `title, description, type, target, current, unit,
  deadline, achieved, achievedFlag, achievedAt, deps[], history[], createdAt, updatedAt`
- **KPI-Typen** (`KPI_TYPES` in `server.js`, Labels in `TYPE_LABEL` in `app.js`):
  - `number` – Anzahl; erreicht, wenn `current >= target` (automatisch)
  - `bool` – Ja/Nein; manuell über `/achieve`
  - `date` – Meilenstein; manuell über `/achieve`, mit Datum
  - `combo` – Anzahl + Datum; erreicht, wenn `current >= target` **und** `achievedFlag`
- **History-Eintrag:** `id, at, who, kind, from, to, note` – neueste zuerst (`unshift`). `kind` ist ein deutscher
  Freitext („Ziel gesetzt“, „Wert aktualisiert“, „Erreichung eingetragen“, „Stammdaten geändert“, „Kommentar“).
- Löschen kaskadiert im Server: Event → Ressorts + KPIs; Ressort → dessen KPIs; KPI-IDs werden aus `deps` anderer KPIs entfernt.
- Datumsfelder sind ISO-Strings `YYYY-MM-DD`; Zeitstempel volles ISO.

## API

Siehe Tabelle in `README.md`. Zusätzlich `GET /api/health`. Fehler: `400 { error }` bzw. `404 { error: 'Nicht gefunden' }`.
Der Autor (`who`) kommt aus dem Feld „Dein Name“ im Frontend (in `localStorage` unter `okr.who`), Standard „Unbekannt“.

## Frontend-Konventionen (`public/app.js`)

- Kleine Helfer: `$()` für `querySelector`, `el(tag, attrs, ...children)` zum DOM-Bauen (kein `innerHTML` für Nutzerdaten).
- Globaler `state` (`data, eventId, view, ressortId`); nach jeder Änderung `act(fn, msg)` → API-Call → `reload()` → komplettes `render()`.
- Ansichten: `overview`, `ressort`, `graph` (Abhängigkeits-Graph als SVG). Dialoge über `openModal()`.
- Status-Logik (Erreicht / Überfällig / Blockiert / Im Plan ≥70 % / Gefährdet ≥40 % / Kritisch) in `status(k)` – nur im Frontend.
- Zahlen/Daten deutsch formatieren (`toLocaleString('de-DE')`, `de()`).

## Bekannte Grenzen (v0.1)

Keine Anmeldung/Rechte, keine Konflikterkennung bei mehreren Nutzern, JSON-Datei statt DB, kein Drag & Drop im Graphen.
Kein Git-Repository initialisiert.
