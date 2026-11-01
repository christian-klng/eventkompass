# Eventkompass – OKR / Kennzahlen-Tracker für Events (v0.2)

Node/Express-Server mit JSON-Datei als Speicher, Frontend ohne Framework. Mit Login, Freigabe neuer Konten
und Rechten je Ressort.

## Starten (OrbStack / Docker)

```bash
docker compose up -d --build
open http://localhost:8090
```

Lokaler Admin (aus `docker-compose.yml`): `admin@example.test` – Passwort siehe `ADMIN_PASSWORD` dort.
Beim ersten Login muss ein neues Passwort gesetzt werden.

Daten liegen in `./data/data.json` (wird als Volume gemountet) und überleben Neustarts.
Beim allerersten Start werden Demo-Daten (Summit 2027, Führungsressort + 5 Ressorts, 16 Kennzahlen) angelegt.
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
- **Freigabe** neuer Konten durch Admins; alternativ Schalter „Automatisch freischalten bis …“ (1 h / 24 h / 7 Tage / eigenes Datum), läuft von selbst ab
- **Rechte:** Alle sehen alle Kennzahlen und Historien. Bearbeiten nur im eigenen Ressort; Event-/Ressort-Zuordnung ändert nur ein Admin
- **Führungsressort** je Event – pflegt die Event-Kennzahlen, hat sonst dieselben Rechte wie andere Ressorts
- **Verwaltung** (Admin): Nutzer (freigeben, sperren, Rolle, Zuordnung, Einmal-Passwort), Events, Ressorts (bestätigen, zusammenführen)
- Kennzahlen-Typen: **Anzahl** (Ziel- und Ist-Wert, automatisch erreicht) und **Ja/Nein** (von Hand abgehakt, auch für Meilensteine); Frist; Abhängigkeiten **nur innerhalb desselben Ressorts**
- Ein Button je Kennzahl: **Bearbeiten** (✎) für eigene Kennzahlen – Ist-Wert bzw. Ja/Nein, Erreicht-Datum, Kommentar, Stammdaten und Historie in einem Dialog; bei fremden Kennzahlen **Historie ansehen** (⟲). Der Autor kommt aus dem Login

## API

Alle Endpunkte außer den öffentlichen brauchen eine Session (Cookie). Schreibende Requests nur mit `Content-Type: application/json`.

| Methode | Pfad | Zweck | Wer |
|---|---|---|---|
| GET | `/api/health` | Healthcheck | öffentlich |
| GET | `/api/public/registration-options` | Event- und Ressort-Namen für die Registrierung | öffentlich |
| POST | `/api/auth/register` · `/login` · `/logout` | Konto, Anmeldung | öffentlich |
| GET / POST | `/api/auth/me` · `/api/auth/password` | Eigenes Konto, Passwort ändern | angemeldet |
| GET | `/api/state` | Events, Ressorts, Kennzahlen (für Admins plus Zahl offener Freigaben) | angemeldet |
| POST/PUT | `/api/kpis[/:id]` | Kennzahl anlegen / bearbeiten (Stammdaten, `current`, `achieved`, `achievedAt`, `note`) | eigenes Ressort |
| POST | `/api/kpis/:id/value` · `/achieve` | Ist-Wert / Erreichung `{value, achieved, achievedAt, note}` | eigenes Ressort |
| DELETE | `/api/kpis/:id` | Kennzahl löschen | Admin |
| POST/PUT/DELETE | `/api/events[/:id]` · `/api/ressorts[/:id]` | Events, Ressorts | Admin |
| POST | `/api/admin/ressorts/:id/merge` | Ressort in ein anderes überführen `{intoId}` | Admin |
| GET/PUT/DELETE | `/api/admin/users[/:id]` | Nutzer verwalten | Admin |
| POST | `/api/admin/users/:id/password` | Einmal-Passwort setzen | Admin |
| GET/PUT | `/api/admin/settings` | `{autoApproveUntil}` | Admin |
| POST | `/api/reset[?empty=1]` | Demo-Daten neu laden / Inhalte leeren (Nutzer bleiben) | Admin + `ALLOW_RESET` |

## Bekannte Grenzen (v0.2)

JSON-Datei statt Datenbank, keine Konflikterkennung bei gleichzeitigem Bearbeiten, kein Passwort-Reset per E-Mail,
ein Nutzer gehört zu genau einem Event und Ressort.
