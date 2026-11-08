# CLAUDE.md

Projektnotizen für Claude Code. Sprache im Projekt (UI, Kommentare, Fehlermeldungen, Doku): **Deutsch**.

## Was ist das?

**Eventkompass** – OKR-Tracker für Events (v0.3).
Ein Event hat Ressorts (eins davon ist das **Führungsressort** mit den Event-Zielen). Jedes Ressort hat beliebig viele
**Ziele** (Objectives), jedes Ziel beliebig viele **Schlüsselergebnisse** (Key Results) mit Zielwert, Ist-Wert, Frist,
Abhängigkeiten (nur im selben Ressort) und Änderungshistorie. Fortschritt und Erreichung eines Ziels ergeben sich aus
seinen Schlüsselergebnissen. Nutzer registrieren sich mit Event + Ressort und dürfen nur Ziele/Schlüsselergebnisse ihres
eigenen Ressorts bearbeiten, alle sehen alles.

Wording (UI, Code-Kommentare, Doku): **Ziel** = Objective, **Schlüsselergebnis** = Key Result, **Zielwert** = `target`
eines Schlüsselergebnisses. „Kennzahl“/„KPI“ nicht mehr verwenden.

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

## Daten (`data/data.json`, `version: 4`)

- Nicht von Hand ändern, während der Container läuft (Zustand liegt im Speicher und wird komplett überschrieben).
- `{ version, events, ressorts, objectives, keyResults, users, sessions, invites, settings }` – `GET /api/state` gibt **nur**
  events/ressorts/objectives/keyResults heraus, nie `users`, `sessions` oder Passwort-Hashes. Nutzer nach außen immer über `publicUser()`.
- **Ressort:** `id, eventId, name, color, isLead, unreviewed, createdAt` (keine „Leitung“ – wer pflegt, ergibt sich aus der Nutzer-Zuordnung). Je Event genau ein `isLead` (nicht löschbar,
  wird mit dem Event angelegt). `unreviewed` = per Freitext bei automatischer Freischaltung entstanden.
- **Ziel (Objective):** `id, eventId, ressortId, title, description, deadline, archivedAt, archivedBy, createdAt, updatedAt`.
  Kein eigener Status: erreicht = alle aktiven Schlüsselergebnisse erreicht (und mindestens eins), Fortschritt = Durchschnitt.
  Archivieren (Admin) nur ohne aktive Schlüsselergebnisse. Ressortwechsel (Admin) nimmt alle Schlüsselergebnisse mit.
- **Schlüsselergebnis (Key Result):** `id, eventId, ressortId, objectiveId` (alle nie null; `ressortId`/`eventId` folgen dem Ziel),
  `title, description, type, target, current, unit, deadline, achieved, achievedAt, archivedAt, archivedBy, deps[], history[], createdAt, updatedAt`
  - Werden nie gelöscht: `DELETE` setzt `archivedAt` (Admin), `POST …/restore` hebt es auf (nur wenn das Ziel nicht archiviert ist).
    Archivierte sind nicht bearbeitbar, im Frontend nur im Ressort-Archiv (Admin) sichtbar (`activeKrs()`/`evKrs()` filtern sie heraus).
  - Nur zwei Typen: `number` (Anzahl, erreicht automatisch bei `current >= target`) und `bool` (Ja/Nein, von Hand, auch für Meilensteine).
    Frühere Typen `date`/`combo` migriert `migrate()` (v3) zu `bool`/`number`.
  - `deps` nur auf Schlüsselergebnisse mit gleicher `ressortId` (`cleanDeps()`), auch über Ziele hinweg; ein Ressortwechsel
    löst Abhängigkeiten in beide Richtungen
  - Zielwechsel per `PUT` mit `objectiveId`: innerhalb des Ressorts jeder Berechtigte, in ein anderes Ressort nur Admin
  - History: `id, at, who, userId, kind, from, to, note`, neueste zuerst; `who`/`userId` kommen aus der Session
- **Migration v4** (`migrate()`): `kpis` → `keyResults`; Schlüsselergebnisse ohne gültiges Ziel bekommen je Ressort ein
  Start-Ziel (Titel = Ressortname, Beschreibung `MIGRATED_OBJECTIVE_NOTE`), das der Nutzer umbenennen oder aufteilen soll.
- **User:** `id, email, name, passwordHash, role ('admin'|'member'), eventId, ressortId, requestedRessortName,
  status ('pending'|'active'|'disabled'), mustChangePassword, createdAt, approvedAt, approvedBy ('admin'|'auto'), lastLoginAt`
- **Session:** `tokenHash` (SHA-256 des Cookie-Tokens), `userId`, `expiresAt` (30 Tage). Cookie `ek_session`, `Secure` nur bei HTTPS.
- **Invite:** `id, email, ressortId|null, createdAt, createdBy, usedAt, userId`. Registrierung mit offener eingeladener E-Mail →
  sofort aktiv (`approvedBy: 'invite'`), festes Ressort hat Vorrang. Kein Mailversand; Link `/#einladung=<id>` füllt das Formular vor.
  Achtung: Die E-Mail wird nicht verifiziert – wer die eingeladene Adresse kennt, kann sich damit registrieren.
- **Settings:** `autoApproveUntil` – solange in der Zukunft, sind neue Registrierungen sofort aktiv.

## Rechte (Server ist maßgeblich, UI blendet nur aus)

- `canEditRessort(user, ressortId)`: Admin oder `user.ressortId === ressortId`. Gilt für Ziele und Schlüsselergebnisse
  (Anlegen, Wert, Erreichung, Stammdaten) – das Ressort eines Schlüsselergebnisses ist das seines Ziels.
- Nur Admin: Ziel/Schlüsselergebnis archivieren/wiederherstellen, einem anderen Ressort zuordnen, Events/Ressorts verwalten,
  `/api/admin/*`, `/api/reset` (+ `ALLOW_RESET`).
- Das Führungsressort hat **keine** Sonderrechte – es pflegt nur seine eigenen (Event-)Ziele.
- Ressorts und Events lassen sich nur löschen, wenn sie keine Ziele/Schlüsselergebnisse (auch archivierte) haben – Ressorts vorher zusammenführen.
- Schutz: letzter aktiver Admin kann nicht herabgestuft/gesperrt/gelöscht werden; Sperren/Einmal-Passwort beendet Sessions.
- Neue schreibende Endpunkte: Rechte prüfen **und** einen Test in `test/api.test.js` ergänzen.

## Frontend-Konventionen (`public/app.js`)

- Helfer: `$()`, `el(tag, attrs, ...children)` zum DOM-Bauen (kein `innerHTML` für Nutzerdaten), `append()` statt
  `Element.append` bei bedingten Kindern (sonst erscheint „null“ als Text).
- Globaler `state` (`me, data, users, eventId, view, ressortId, adminTab, userFilter`). Änderungen über
  `act(fn, msg)` → API → `reload()` → `render()`; `act` liefert `true/false`, Dialoge schließen mit `closeOn(close)`.
- Ein Ziel ist ein `objectiveBlock(o)` (Kopf mit Fortschritt/Status, darunter `krTable()` mit seinen Schlüsselergebnissen);
  `modalObjectiveForm(o, ressortId)` legt an/bearbeitet. Schlüsselergebnis-Zeilen haben genau einen Button: `modalKrForm(k, objective)`
  (eigene: Stand, Stammdaten inkl. Zielauswahl, Historie; speichert alles per `PUT /api/key-results/:id`) oder `modalHistory(k)` (fremde, nur lesen).
- Status/Fortschritt: `status(k)`/`pct(k)` je Schlüsselergebnis, `objStatus(o)`/`objAchieved(o)`/`avgPct()` je Ziel.
- Ansichten: `overview`, `ressort`, `admin` (Reiter Nutzer / Events / Ressorts). Anmeldung: `showAuth('login'|'register'|'pending'|'password')`.
- `api()` leitet bei 401 bzw. `PASSWORD_CHANGE_REQUIRED` selbst zur Anmeldung um (Fehler mit `silent`).
- Zahlen/Daten deutsch formatieren (`toLocaleString('de-DE')`, `de()`, `deTime()`).

## Deployment

Ziel ist Coolify (Dockerfile-Build, Volume auf `/data`, zunächst HTTP-Domain) – Schritte in `PLAN.md`, Phase 5.
