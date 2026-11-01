# CLAUDE.md

Projektnotizen für Claude Code. Sprache im Projekt (UI, Kommentare, Fehlermeldungen, Doku): **Deutsch**.

## Was ist das?

**Eventkompass** – OKR-/Kennzahlen-Tracker für Events (v0.2).
Ein Event hat Ressorts (eins davon ist das **Führungsressort** mit den Event-Kennzahlen); jede Kennzahl (KPI) gehört
zu genau einem Ressort und hat Ziel, Ist-Wert, Frist, Abhängigkeiten (nur im selben Ressort) und eine Änderungshistorie.
Nutzer registrieren sich mit Event + Ressort und dürfen nur Kennzahlen ihres eigenen Ressorts bearbeiten, alle sehen alles.

Namen: Ordner `okr-tracker`, npm-Paket `okr-event-tracker`, Container `okr-tracker`, UI-Titel „Eventkompass“.
Plan und offene Punkte: `PLAN.md`.

## Stack & Dateien

- **Backend:** Node (ESM), Express 4, keine weiteren Abhängigkeiten
  - `server.js` – nur Start (Umgebungsvariablen → `createApp()` → `listen`)
  - `lib/app.js` – `createApp()`: alle Routen, Rechteprüfung, Fachlogik
  - `lib/store.js` – JSON-Speicher + `migrate()` (läuft bei jedem Start, muss idempotent bleiben)
  - `lib/auth.js` – scrypt-Passwörter, Session-Tokens, Cookies, Login-Bremse
- **Frontend:** Vanilla JS ohne Build: `public/index.html`, `public/app.js`, `public/style.css`
- **Demo-Daten:** `seed.js` · **Tests:** `test/api.test.js` (`npm test`, `node:test`, startet die App mit Temp-Ordner)

## Lokal starten (OrbStack / Docker)

Die App läuft in OrbStack unter **http://localhost:8090**.

```bash
docker compose up -d --build   # bauen + starten (oder ./start-dev.command)
docker compose logs -f
docker compose down
npm test                        # API-Tests, laufen ohne Docker
```

- **Ports:** im Container `8080`, nach außen **8090**. Port 8080 auf dem Host ist durch ein anderes Projekt belegt (`maki-caddy`).
- **Code-Änderungen** wirken erst nach `docker compose up -d --build` (Code wird ins Image kopiert, nur `./data` ist gemountet).
- **Lokaler Admin:** `ADMIN_EMAIL`/`ADMIN_PASSWORD` in `docker-compose.yml`; wird nur angelegt, solange es keinen Admin gibt.
  Erster Login erzwingt einen Passwortwechsel. Für einen frischen Stand: Container stoppen, `data/data.json` löschen, neu starten.
  Alternativ (so auf dem Server): nur `ADMIN_EMAIL` setzen – wer sich mit dieser Adresse registriert, wird Admin, solange es keinen gibt.
  Beim Start loggt die App, ob und welche Admins existieren.
- Container läuft als `node` (nicht root); Dockerfile macht `/app` lesbar, weil lokale Dateien teils Rechte 600 haben.

## Daten (`data/data.json`, `version: 3`)

- Nicht von Hand ändern, während der Container läuft (Zustand liegt im Speicher und wird komplett überschrieben).
- `{ version, events, ressorts, kpis, users, sessions, invites, settings }` – `GET /api/state` gibt **nur** events/ressorts/kpis heraus,
  nie `users`, `sessions` oder Passwort-Hashes. Nutzer nach außen immer über `publicUser()`.
- **Ressort:** `id, eventId, name, color, isLead, unreviewed, createdAt` (keine „Leitung“ – wer pflegt, ergibt sich aus der Nutzer-Zuordnung). Je Event genau ein `isLead` (nicht löschbar,
  wird mit dem Event angelegt). `unreviewed` = per Freitext bei automatischer Freischaltung entstanden.
- **KPI:** `id, eventId, ressortId` (nie null), `title, description, type, target, current, unit, deadline, achieved,
  achievedAt, archivedAt, archivedBy, deps[], history[], createdAt, updatedAt`
  - Kennzahlen werden nie gelöscht: `DELETE` setzt `archivedAt` (Admin), `POST …/restore` hebt es auf. Archivierte sind
    nicht bearbeitbar, im Frontend nur im Ressort-Archiv (Admin) sichtbar (`activeKpis()`/`evKpis()` filtern sie heraus).
  - Nur zwei Typen: `number` (Anzahl, erreicht automatisch bei `current >= target`) und `bool` (Ja/Nein, von Hand, auch für Meilensteine).
    Frühere Typen `date`/`combo` migriert `migrate()` (v3) zu `bool`/`number`.
  - `deps` nur auf KPIs mit gleicher `ressortId` (`cleanDeps()`); Ressortwechsel löst Abhängigkeiten in beide Richtungen
  - History: `id, at, who, userId, kind, from, to, note`, neueste zuerst; `who`/`userId` kommen aus der Session
- **User:** `id, email, name, passwordHash, role ('admin'|'member'), eventId, ressortId, requestedRessortName,
  status ('pending'|'active'|'disabled'), mustChangePassword, createdAt, approvedAt, approvedBy ('admin'|'auto'), lastLoginAt`
- **Session:** `tokenHash` (SHA-256 des Cookie-Tokens), `userId`, `expiresAt` (30 Tage). Cookie `ek_session`, `Secure` nur bei HTTPS.
- **Invite:** `id, email, ressortId|null, createdAt, createdBy, usedAt, userId`. Registrierung mit offener eingeladener E-Mail →
  sofort aktiv (`approvedBy: 'invite'`), festes Ressort hat Vorrang. Kein Mailversand; Link `/#einladung=<id>` füllt das Formular vor.
  Achtung: Die E-Mail wird nicht verifiziert – wer die eingeladene Adresse kennt, kann sich damit registrieren.
- **Settings:** `autoApproveUntil` – solange in der Zukunft, sind neue Registrierungen sofort aktiv.

## Rechte (Server ist maßgeblich, UI blendet nur aus)

- `canEditRessort(user, ressortId)`: Admin oder `user.ressortId === ressortId`. Gilt für Anlegen, Wert, Erreichung, Stammdaten.
- Nur Admin: KPI archivieren/wiederherstellen, KPI anderem Ressort zuordnen, Events/Ressorts verwalten, `/api/admin/*`, `/api/reset` (+ `ALLOW_RESET`).
- Das Führungsressort hat **keine** Sonderrechte – es pflegt nur seine eigenen (Event-)Kennzahlen.
- Ressorts und Events lassen sich nur löschen, wenn sie keine Kennzahlen (auch archivierte) haben – Ressorts vorher zusammenführen.
- Schutz: letzter aktiver Admin kann nicht herabgestuft/gesperrt/gelöscht werden; Sperren/Einmal-Passwort beendet Sessions.
- Neue schreibende Endpunkte: Rechte prüfen **und** einen Test in `test/api.test.js` ergänzen.

## Frontend-Konventionen (`public/app.js`)

- Helfer: `$()`, `el(tag, attrs, ...children)` zum DOM-Bauen (kein `innerHTML` für Nutzerdaten), `append()` statt
  `Element.append` bei bedingten Kindern (sonst erscheint „null“ als Text).
- Globaler `state` (`me, data, users, eventId, view, ressortId, adminTab, userFilter`). Änderungen über
  `act(fn, msg)` → API → `reload()` → `render()`; `act` liefert `true/false`, Dialoge schließen mit `closeOn(close)`.
- KPI-Zeilen haben genau einen Button: `modalKpiForm(k)` (eigene: Stand, Stammdaten, Historie; speichert alles per `PUT /api/kpis/:id`)
  oder `modalHistory(k)` (fremde, nur lesen).
- Ansichten: `overview`, `ressort`, `admin` (Reiter Nutzer / Events / Ressorts). Anmeldung: `showAuth('login'|'register'|'pending'|'password')`.
- `api()` leitet bei 401 bzw. `PASSWORD_CHANGE_REQUIRED` selbst zur Anmeldung um (Fehler mit `silent`).
- Zahlen/Daten deutsch formatieren (`toLocaleString('de-DE')`, `de()`, `deTime()`).

## Deployment

Ziel ist Coolify (Dockerfile-Build, Volume auf `/data`, zunächst HTTP-Domain) – Schritte in `PLAN.md`, Phase 5.
