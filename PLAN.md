# Plan v0.2 – Nutzer & Rechte, Admin, Abhängigkeiten, Coolify

Stand: 01.11.2026 · Ausgangslage: v0.1 (Express + JSON-Datei, kein Login, läuft lokal in OrbStack auf :8090)

**Reihenfolge ist wichtig:** Erst Login und Rechte, dann online gehen. v0.1 hat keinen Zugriffsschutz und mit
`POST /api/reset` kann jeder alle Daten löschen – so darf die App nicht öffentlich erreichbar sein.

---

## Entscheidungen

**Entschieden**

| # | Thema | Entscheidung |
|---|---|---|
| E1 | Registrierung | Offen; neues Konto ist erst nach **Freigabe durch einen Admin** aktiv. Zusätzlich ein **Schalter „Automatisch freischalten bis …“**: Solange er aktiv ist, sind neue Konten sofort aktiv. Er läuft zu einem gewählten Zeitpunkt von selbst ab. |
| E2 | Freitext-Ressort | Mit Freigabe: Der Admin legt das Ressort beim Freischalten an oder ordnet einem bestehenden zu. Bei automatischer Freischaltung: Das Ressort wird sofort angelegt und als „neu, ungeprüft“ markiert; der Admin kann es später umbenennen oder zusammenführen. |
| E4 | Event-Ebene | Wird zum **Führungsressort**: ein echtes Ressort je Event, mit eigenem Team. Seine Mitglieder pflegen die Event-Kennzahlen. Es gelten dieselben Regeln wie für jedes andere Ressort (Rechte, Abhängigkeiten). |
| E7 | Coolify | Instanz vorhanden. Zunächst die **von Coolify erzeugte HTTP-Domain** (`http://….sslip.io`), HTTPS-Domain später. |

**Noch offen – meine Empfehlung gilt, wenn du nichts anderes sagst**

| # | Frage | Empfehlung |
|---|---|---|
| E3 | Dürfen Mitglieder im eigenen Ressort Kennzahlen **anlegen** und **löschen**? | Anlegen ja, **löschen nur Admin** (beim Löschen geht die Historie verloren). |
| E5 | Passwort vergessen | **Admin setzt ein Einmal-Passwort**, Nutzer muss es beim nächsten Login ändern. Reset per E-Mail braucht SMTP (später). |
| E6 | Speicher | **JSON-Datei bleibt für v0.2.** SQLite, sobald Nutzerzahl oder Datenmenge wächst. |
| E8 | Projektname für GitHub-Repo | „Eventkompass“ als Produktname, Repo `eventkompass` |
| E9 | Sehen Nutzer alle Events? | Ja, alle. Event-Auswahl oben bleibt, Standard = eigenes Event. |
| E10 | Hat das Führungsressort mehr Rechte als andere Ressorts (z. B. fremde Kennzahlen bearbeiten)? | **Nein** – nur seine eigenen Kennzahlen. Übergreifend ändern darf nur der Admin. |

---

## Phase 0 – Vorbereitung

1. `git init`, erster Commit, privates GitHub-Repo anlegen und pushen (Coolify baut aus Git).
2. Dockerfile aufräumen: `package-lock.json` mitkopieren und `npm ci --omit=dev` statt `npm install`;
   Container nicht als root laufen lassen (`USER node`, Rechte auf `/data` setzen).
3. `/api/health` gibt nur noch `{ ok: true }` zurück (verrät aktuell den Dateipfad).

## Phase 1 – Führungsressort und Abhängigkeiten

**Führungsressort (`server.js`, `seed.js`)**
- Ressort bekommt ein Feld `isLead`. Jedes Event hat genau ein Führungsressort (Name „Führung“, umbenennbar, nicht löschbar).
- `POST /api/events` legt das Führungsressort automatisch mit an.
- Kennzahlen haben künftig **immer** ein Ressort (`ressortId` nicht mehr `null`).
- Migration beim Start: je Event ein Führungsressort anlegen, falls keins da ist, und alle Kennzahlen mit `ressortId: null` hineinverschieben.

**Abhängigkeiten – Frontend (`public/app.js`, `index.html`, `style.css`)**
- Ansicht „Abhängigkeiten“ komplett entfernen: Nav-Button, `renderGraph()`, Button „Abhängigkeiten“ in der Ressort-Ansicht,
  `state.sel`, Graph-CSS (`.graph-*`).
- KPI-Bearbeiten-Dialog: Checkbox-Liste zeigt nur Kennzahlen **desselben Ressorts**.
- Auswahl „Event (übergeordnet)“ im Dialog entfällt; das Führungsressort steht in Listen an erster Stelle.
  Die Übersicht zeigt die Kennzahlen des Führungsressorts weiter prominent oben.
- Bleibt erhalten: Abhängigkeits-Chips in der Tabelle, Status „Blockiert“, Hinweis „… warten auf Abhängigkeiten“.

**Abhängigkeiten – Backend (`server.js`)**
- `POST/PUT /api/kpis`: `deps` nur zulassen, wenn `dep.ressortId === k.ressortId`; sonst 400.
- Wird eine Kennzahl einem anderen Ressort zugeordnet: ihre `deps` leeren und sie aus den `deps` der Kennzahlen im alten Ressort entfernen.

**Daten**
- Einmalige Migration: alle ressortübergreifenden `deps` entfernen (nach dem Verschieben ins Führungsressort).
- `seed.js` anpassen: Führungsressort mit „Verkaufte Tickets“, „Sponsoring-Volumen“, „Break-even erreicht“.
  „Break-even → Tickets + Sponsoring“ bleibt (selbes Ressort). Wegfallen: Tickets → Reichweite/Early-Bird/Shop/Registrierung,
  Sponsoring-Volumen → Deck/Gold, Registrierung → Ticketshop, Catering → Location.

## Phase 2 – Nutzer, Registrierung, Login

**Datenmodell** (in `data.json`, neben `events`, `ressorts`, `kpis`)
- `users`: `id, email, name, passwordHash, role ('admin'|'member'), eventId, ressortId, requestedRessortName,
  status ('pending'|'active'|'disabled'), mustChangePassword, createdAt, approvedAt, approvedBy ('admin'|'auto'), lastLoginAt`
- `sessions`: `tokenHash, userId, expiresAt` – in der Datei, damit ein Neustart nicht alle abmeldet.
- `settings`: `autoApproveUntil` (ISO-Zeitpunkt oder `null`)
- Ressort neu: `isLead`, `unreviewed` (bei automatisch angelegten Freitext-Ressorts).
- Datenformat bekommt eine `version`, Migrationen laufen beim Start in `load()`.

**Freigabe-Logik**
- Registrierung: wenn `autoApproveUntil` in der Zukunft liegt → Status `active`, `approvedBy: 'auto'`,
  Freitext-Ressort wird sofort angelegt (`unreviewed: true`). Sonst → Status `pending`, Ressort-Vorschlag bleibt in
  `requestedRessortName`.
- Der Schalter läuft von selbst ab (Vergleich mit der aktuellen Zeit bei jeder Registrierung, kein Hintergrund-Job nötig).

**Technik (ohne große neue Abhängigkeiten)**
- Passwort-Hash mit `node:crypto` `scrypt` + Salt; Mindestlänge 10 Zeichen.
- Session-Cookie: zufälliges Token, `HttpOnly`, `SameSite=Lax`, z. B. 30 Tage gültig; serverseitig nur Hash gespeichert.
  **`Secure` nur, wenn die Anfrage über HTTPS kommt** (`req.secure` mit `trust proxy`) – sonst würde der Browser das Cookie
  auf der HTTP-Domain verwerfen und niemand könnte sich anmelden. Beim späteren Wechsel auf HTTPS passt sich das von selbst an.
- `app.set('trust proxy', 1)` (Coolify/Traefik davor).
- Login-Bremse: max. ~10 Fehlversuche pro IP/E-Mail in 15 Minuten; gleiche Bremse für Registrierungen.
- Schreibende Requests nur mit `Content-Type: application/json` (zusammen mit `SameSite` ausreichender CSRF-Schutz).

**Neue Endpunkte**
- `GET /api/public/registration-options` – nur Event-Namen und Ressort-Namen je Event (ohne Login)
- `POST /api/auth/register` – `{ name, email, password, eventId, ressortId | newRessortName }`
- `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password`
- Alle bisherigen `/api/*` verlangen eine aktive Session (sonst 401).

**Admin anlegen:** Beim Start, wenn es noch keinen Admin gibt, wird einer aus `ADMIN_EMAIL` + `ADMIN_PASSWORD`
(Umgebungsvariablen) erzeugt, mit `mustChangePassword: true`.

**Frontend**
- Login-Seite und Registrierungs-Seite (Event: Select; Ressort: Select der Ressorts des gewählten Events, Führungsressort
  zuerst, + Option „Mein Ressort fehlt …“ → Freitextfeld).
- Nach der Registrierung: entweder direkt eingeloggt (automatische Freischaltung) oder Hinweis „Konto wartet auf Freigabe“.
- Feld „Dein Name“ oben rechts fällt weg → stattdessen Nutzername + Menü (Passwort ändern, Abmelden).
- 401 im `api()`-Helfer → zurück zum Login.

## Phase 3 – Rechte

**Rechte-Matrix** (gilt für das Führungsressort genauso wie für alle anderen Ressorts)

| Aktion | Mitglied | Admin |
|---|---|---|
| Alle Events, Ressorts, Kennzahlen und Historien lesen | ✓ | ✓ |
| Wert eingeben / Erreichung eintragen / Stammdaten ändern – **eigenes Ressort** | ✓ | ✓ |
| … fremdes Ressort | – | ✓ |
| Kennzahl im eigenen Ressort anlegen | ✓ (E3) | ✓ |
| Kennzahl löschen | – (E3) | ✓ |
| Kennzahl einem anderen Ressort zuordnen | – | ✓ |
| Ressorts und Events anlegen / ändern / löschen | – | ✓ |
| Eigene Event-/Ressort-Zuordnung ändern | – | ✓ |
| Nutzer verwalten, Freigabe-Schalter, `/api/reset` | – | ✓ |

**Umsetzung**
- Eine zentrale Funktion `canEditKpi(user, kpi)` im Server, geprüft in **jedem** schreibenden KPI-Endpunkt; 403 bei Verstoß.
  Die Prüfung im Server ist maßgeblich, die UI blendet nur aus.
- Autor in der Historie kommt aus der Session (`who` = Name, neu zusätzlich `userId`); das `who` aus dem Request wird ignoriert.
  Alte Einträge behalten ihren Freitext-Namen.
- Frontend: Aktions-Buttons (✎ ✓ ⋯, „+ Kennzahl“, „+ Ressort“, „+ Event“, „Bearbeiten“) nur zeigen, wenn erlaubt.
  Historie (⟲) bleibt für alle sichtbar. „Zugeordnet zu“ im KPI-Dialog nur für Admin änderbar.
- `/api/reset` nur für Admin **und** nur, wenn `ALLOW_RESET=true` gesetzt ist (in Produktion aus).

## Phase 4 – Admin-Screen

Neuer Menüpunkt „Verwaltung“ (nur für Admins) mit drei Reitern:

1. **Nutzer**
   - Oben der **Freigabe-Schalter**: „Neue Registrierungen automatisch freischalten“ mit Ende-Zeitpunkt
     (Schnellwahl 1 Stunde / 24 Stunden / 7 Tage oder eigenes Datum + Uhrzeit). Solange aktiv: gut sichtbarer Hinweis
     „Automatische Freischaltung aktiv bis …“ mit Button „Jetzt beenden“.
   - Tabelle: Name, E-Mail, Rolle, Event, Ressort, Status, registriert am, freigegeben (Admin/automatisch), letzter Login;
     Filter „Wartet auf Freigabe“ und „Automatisch freigeschaltet“ (zum Nachprüfen).
   - Bearbeiten-Dialog: Name, E-Mail, Rolle, Event, Ressort, Status (freigeben / sperren), Einmal-Passwort setzen.
     Bei Freigabe mit Ressort-Vorschlag: „neues Ressort anlegen“ oder „bestehendem zuordnen“.
   - Löschen eines Nutzers lässt seine Historien-Einträge stehen. Der letzte Admin kann sich nicht selbst entziehen/sperren.
2. **Events** – Tabelle mit Name, Beginn, Ende, Anzahl Ressorts/Kennzahlen/Nutzer; anlegen, bearbeiten, löschen
   (zieht die heutigen Buttons „+ Event“ / „Bearbeiten“ aus der Kopfzeile hierher).
3. **Ressorts** – je Event: umbenennen, Farbe, Leitung, löschen (nicht das Führungsressort), zwei Ressorts zusammenführen.
   Ressorts mit „neu, ungeprüft“ sind markiert, bis der Admin sie bestätigt.

API: `GET/PUT/DELETE /api/admin/users[/:id]`, `POST /api/admin/users/:id/password`, `GET/PUT /api/admin/settings`,
`POST /api/admin/ressorts/:id/merge`.

## Phase 5 – Deployment auf Coolify

1. In Coolify neue Ressource → privates GitHub-Repo (über die GitHub App) → Branch `main`.
2. **Build Pack: Dockerfile** (nicht Docker Compose – die `docker-compose.yml` mit dem Port-Mapping `8090:8080` bleibt nur für lokal).
   „Ports Exposes“: `8080`.
3. **Persistent Storage:** Volume auf `/data` mounten. Ohne das sind nach jedem Deploy alle Daten weg.
4. **Umgebungsvariablen:** `NODE_ENV=production`, `SEED=false`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (als Secret, nach dem
   ersten Login entfernen), `ALLOW_RESET` nicht setzen.
5. **Domain:** die von Coolify erzeugte `http://….sslip.io`-Adresse übernehmen.
6. Healthcheck auf `/api/health`, Port 8080 (im Alpine-Image ist `wget` vorhanden).
7. Automatisches Deploy bei Push auf `main` aktivieren.
8. Nach dem ersten Deploy: als Admin anmelden, Passwort ändern, Event(s) und Ressorts anlegen, Test-Registrierung mit
   und ohne automatische Freischaltung durchspielen.
9. **Später HTTPS:** eigene Domain in Coolify eintragen (`https://…`), Let's Encrypt läuft automatisch. Im Code ist
   nichts zu ändern (Cookie-`Secure` richtet sich nach der Anfrage).

**Hinweis zur HTTP-Domain:** Über HTTP gehen Passwörter und Session-Cookies unverschlüsselt durchs Netz (z. B. im
Hotel- oder Event-WLAN mitlesbar). Für Tests mit wenigen Leuten vertretbar; bevor echte Teams mit echten Passwörtern
starten, sollte HTTPS aktiv sein. Bis dahin den Freigabe-Schalter möglichst kurz offen lassen.

## Weitere notwendige Schritte

**Backups** – Die automatischen Backups in Coolify sind (soweit ich weiß) für die dort verwalteten Datenbanken gedacht,
nicht für ein Datei-Volume. Für `/data/data.json` braucht es eine eigene Sicherung, z. B. eine geplante Aufgabe in Coolify,
die täglich eine Kopie mit Datum anlegt und auf einen externen Speicher (S3) überträgt, oder Server-Snapshots beim Hoster.

**Datenschutz (DSGVO)** – Ab jetzt werden personenbezogene Daten gespeichert (Name, E-Mail, wer wann was geändert hat).
- Datenschutzerklärung und Impressum verlinken (Login-/Registrierungsseite), Zustimmung bei der Registrierung.
- Google Fonts (Inter) lokal ausliefern statt von `fonts.googleapis.com` laden.
- Vertrag zur Auftragsverarbeitung mit dem Server-Hoster prüfen.
- Klären, was beim Löschen eines Nutzers mit seinem Namen in der Historie passiert (behalten oder anonymisieren).

**Tests** – Rechteprüfung ist sicherheitsrelevant. Mindestens API-Tests mit `node:test` für: nicht angemeldet → 401,
fremdes Ressort → 403, eigenes Ressort → 200, Führungsressort-Mitglied an Ressort-KPI → 403, Admin → 200,
ressortübergreifende Abhängigkeit → 400, Registrierung → `pending` bzw. mit aktivem Schalter → `active`,
abgelaufener Schalter → `pending`. `npm test` in `package.json`, idealerweise als GitHub Action vor dem Deploy.

**Kleinere Punkte**
- Produktion startet leer (`SEED=false`). Klären, ob lokale Daten übernommen werden sollen.
- Bekannte Grenze bleibt: Bearbeiten zwei Personen gleichzeitig dieselbe Kennzahl, gewinnt die letzte Änderung.
- Ein Nutzer gehört zu genau einem Event und Ressort. Wer in zwei Events mitarbeitet, braucht zwei Konten
  oder später eine Erweiterung.
- `README.md` und `CLAUDE.md` nach jeder Phase aktualisieren.

## Aufwand (grob)

| Phase | Größe |
|---|---|
| 0 Vorbereitung | S |
| 1 Führungsressort & Abhängigkeiten | M |
| 2 Nutzer, Login, Freigabe | L |
| 3 Rechte | M |
| 4 Admin-Screen | M |
| 5 Coolify | S |
| Backups, DSGVO, Tests | M |
