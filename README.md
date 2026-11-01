# Eventkompass – OKR / Kennzahlen-Tracker für Events (v0.1)

Erste lokal lauffähige Version: Node/Express-Server mit JSON-Datei als Speicher, Frontend ohne Framework.

## Starten (OrbStack / Docker)

```bash
docker compose up -d --build
open http://localhost:8090
```

Daten liegen in `./data/data.json` (wird als Volume gemountet) und überleben Neustarts.
Beim allerersten Start werden Demo-Daten (Summit 2027, 5 Ressorts, 16 Kennzahlen) angelegt.
Ohne Demo-Daten: in `docker-compose.yml` `SEED: "false"` setzen **bevor** `data/data.json` existiert.

Stoppen: `docker compose down` · Logs: `docker compose logs -f`

## Ohne Docker

```bash
npm install
PORT=8090 npm start          # http://localhost:8090
```

Ohne `PORT` startet der Server auf 8080 – der Port ist auf diesem Mac schon belegt.

## Was geht

- Events anlegen/bearbeiten/löschen, Event-Auswahl oben
- Ressorts anlegen/bearbeiten/löschen (beliebige Anzahl, Farbe, Leitung)
- Kennzahlen anlegen – Typen: **Anzahl**, **Ja/Nein**, **Meilenstein (Datum)**, **Anzahl + Datum**; Event- oder Ressort-Ebene; Frist; Abhängigkeiten zu anderen Kennzahlen
- **Wert eingeben** (✎) – neuer Ist-Wert + Kommentar, landet in der Historie
- **Historie** (⟲) – alle Änderungen mit Zeit, Person, von → nach, Kommentar
- **Ist-Erreichung** (✓) – typabhängig: Ja/Nein, erreichte Anzahl, „Erreicht am“
- **Bearbeiten** (⋯) – Stammdaten, Zuordnung, Abhängigkeiten, Löschen
- Abhängigkeits-Graph: Spalte pro Ressort, Pfeile grün = Voraussetzung erfüllt, orange gestrichelt = offen
- „Dein Name“ oben rechts wird als Autor in die Historie geschrieben (im Browser gemerkt)

## API (für spätere Integrationen)

| Methode | Pfad | Zweck |
|---|---|---|
| GET | `/api/state` | Gesamtzustand |
| POST/PUT/DELETE | `/api/events[/:id]` | Events |
| POST/PUT/DELETE | `/api/ressorts[/:id]` | Ressorts |
| POST/PUT/DELETE | `/api/kpis[/:id]` | Kennzahlen (Stammdaten) |
| POST | `/api/kpis/:id/value` | Ist-Wert eintragen `{value, note, who}` |
| POST | `/api/kpis/:id/achieve` | Erreichung `{achieved, achievedAt, value, note, who}` |
| POST | `/api/reset[?empty=1]` | Demo-Daten neu laden / alles leeren |

## Bekannte Grenzen (v0.1)

Keine Anmeldung/Rechte, keine Mehrbenutzer-Konflikterkennung, JSON-Datei statt Datenbank, kein Drag&Drop im Graphen.
