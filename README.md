# Eventkompass – OKR-Tracker für Events (v0.3)

Node/Express-Server mit JSON-Datei als Speicher, Frontend ohne Framework. Mit Login, Freigabe neuer Konten
und Rechten je Ressort. Folgt dem OKR-Rahmenwerk: Jedes Ressort hat **Ziele** (Objectives), jedes Ziel **Schlüsselergebnisse** (Key Results).

## Starten (OrbStack / Docker)

```bash
docker compose up -d --build
open http://localhost:8090
```

Lokaler Admin (aus `docker-compose.yml`): `admin@example.test` – Passwort siehe `ADMIN_PASSWORD` dort.
Beim ersten Login muss ein neues Passwort gesetzt werden.

Daten liegen in `./data/data.json` (wird als Volume gemountet) und überleben Neustarts.
Beim allerersten Start werden Demo-Daten (Summit 2027, Führungsressort + 5 Ressorts, 6 Ziele mit 16 Schlüsselergebnissen) angelegt.
Bestehende Daten aus v0.2 („Kennzahlen“) werden beim Start automatisch migriert: je Ressort entsteht ein Start-Ziel mit dem Namen des Ressorts, das die bisherigen Einträge als Schlüsselergebnisse enthält.
Ohne Demo-Daten: in `docker-compose.yml` `SEED: "false"` setzen **bevor** `data/data.json` existiert.

Stoppen: `docker compose down` · Logs: `docker compose logs -f` · Tests: `npm test`

## Ohne Docker

```bash
npm install
PORT=8090 ADMIN_EMAIL=admin@example.test ADMIN_PASSWORD=lokal-admin-2026 npm start   # http://localhost:8090
```

Ohne `PORT` startet der Server auf 8080 – der Port ist auf diesem Mac schon belegt.

## Umgebungsvariablen

| Variable | Zweck |
|---|---|
| `PORT` | Port im Container/Prozess (Standard 8080) |
| `DATA_DIR` | Ordner für `data.json` (im Image `/data`) |
| `SEED` | `false` = erster Start ohne Demo-Daten |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Legt beim Start einen Admin an, **solange es noch keinen gibt**. Ohne `ADMIN_PASSWORD`: Wer sich mit `ADMIN_EMAIL` registriert, wird Admin (nur solange es keinen gibt, auch ohne Event) |
| `ALLOW_RESET` | `true` erlaubt Admins `POST /api/reset` – nur lokal |

## Was geht

- **Registrierung** mit Event (Auswahl) und Ressort (Auswahl oder Freitext „Mein Ressort fehlt …“)
- **Einladungen** (Verwaltung → Nutzer): E-Mail eintragen, optional festes Ressort; wer sich damit registriert, ist ohne Freigabe aktiv. Es werden keine Mails verschickt – den Link (`/#einladung=<id>`) gibt der Admin selbst weiter
- **Freigabe** neuer Konten durch Admins; alternativ Schalter „Automatisch freischalten bis …“ (1 h / 24 h / 7 Tage / eigenes Datum), läuft von selbst ab
- **Ziele und Schlüsselergebnisse:** pro Ressort beliebig viele Ziele, pro Ziel beliebig viele Schlüsselergebnisse. Ein Ziel gilt als erreicht, wenn alle seine Schlüsselergebnisse erreicht sind; sein Fortschritt ist deren Durchschnitt
- **Rechte:** Alle sehen alle Ziele, Schlüsselergebnisse und Historien. Bearbeiten nur im eigenen Ressort; Ressort-Zuordnung ändert nur ein Admin
- **Führungsressort** je Event – pflegt die Event-Ziele, hat sonst dieselben Rechte wie andere Ressorts
- **Verwaltung** (Admin): Nutzer (freigeben, sperren, Rolle, Zuordnung, Einmal-Passwort), Events, Ressorts (bestätigen, zusammenführen)
- **Archiv:** „Löschen“ archiviert Ziele und Schlüsselergebnisse nur; Admins sehen sie je Ressort unter „Archiv“ und können sie wiederherstellen. Ein Ziel lässt sich erst ohne aktive Schlüsselergebnisse archivieren
- Typen von Schlüsselergebnissen: **Anzahl** (Zielwert und Ist-Wert, automatisch erreicht) und **Ja/Nein** (von Hand abgehakt, auch für Meilensteine); Frist; Abhängigkeiten **nur innerhalb desselben Ressorts** (auch zwischen Zielen)
- Ein Button je Schlüsselergebnis: **Bearbeiten** (✎) für eigene – Ist-Wert bzw. Ja/Nein, Erreicht-Datum, Kommentar, Stammdaten (inkl. Zielwechsel) und Historie in einem Dialog; bei fremden **Historie ansehen** (⟲). Der Autor kommt aus dem Login

## API

Alle Endpunkte außer den öffentlichen brauchen eine Session (Cookie). Schreibende Requests nur mit `Content-Type: application/json`.

| Methode | Pfad | Zweck | Wer |
|---|---|---|---|
| GET | `/api/health` | Healthcheck | öffentlich |
| GET | `/api/public/registration-options` | Event- und Ressort-Namen für die Registrierung | öffentlich |
| POST | `/api/auth/register` · `/login` · `/logout` | Konto, Anmeldung | öffentlich |
| GET / POST | `/api/auth/me` · `/api/auth/password` | Eigenes Konto, Passwort ändern | angemeldet |
| GET | `/api/state` | Events, Ressorts, Ziele, Schlüsselergebnisse (für Admins plus Zahl offener Freigaben) | angemeldet |
| POST/PUT | `/api/objectives[/:id]` | Ziel anlegen `{ressortId, title, description?, deadline?}` / bearbeiten (`ressortId` nur Admin) | eigenes Ressort |
| DELETE / POST | `/api/objectives/:id` · `/restore` | Ziel **archivieren** (nur ohne aktive Schlüsselergebnisse) / wiederherstellen | Admin |
| POST/PUT | `/api/key-results[/:id]` | Schlüsselergebnis anlegen `{objectiveId, title, type, target?, …}` / bearbeiten (Stammdaten, `objectiveId`, `current`, `achieved`, `achievedAt`, `note`) | eigenes Ressort |
| POST | `/api/key-results/:id/value` · `/achieve` | Ist-Wert / Erreichung `{value, achieved, achievedAt, note}` | eigenes Ressort |
| DELETE | `/api/key-results/:id` | Schlüsselergebnis **archivieren** (wird nicht gelöscht) | Admin |
| POST | `/api/key-results/:id/restore` | Archiviertes Schlüsselergebnis wiederherstellen (Ziel muss aktiv sein) | Admin |
| POST/PUT/DELETE | `/api/events[/:id]` · `/api/ressorts[/:id]` | Events, Ressorts | Admin |
| POST | `/api/admin/ressorts/:id/merge` | Ressort in ein anderes überführen `{intoId}` | Admin |
| GET/PUT/DELETE | `/api/admin/users[/:id]` | Nutzer verwalten | Admin |
| POST | `/api/admin/users/:id/password` | Einmal-Passwort setzen | Admin |
| GET/PUT | `/api/admin/settings` | `{autoApproveUntil}` | Admin |
| GET/POST/DELETE | `/api/admin/invites[/:id]` | Einladungen `{email, ressortId?}` | Admin |
| GET | `/api/public/invites/:id` | E-Mail und festes Ressort einer offenen Einladung (für den Link) | öffentlich |
| POST | `/api/reset[?empty=1]` | Demo-Daten neu laden / Inhalte leeren (Nutzer bleiben) | Admin + `ALLOW_RESET` |

## Bekannte Grenzen (v0.3)

JSON-Datei statt Datenbank, keine Konflikterkennung bei gleichzeitigem Bearbeiten, kein Passwort-Reset per E-Mail,
ein Nutzer gehört zu genau einem Event und Ressort.
