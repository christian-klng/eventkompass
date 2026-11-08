// Express-App: Login/Registrierung, Rechteprüfung, Fachlogik für Events, Ressorts, Ziele und Schlüsselergebnisse.
// createApp() baut die App inkl. Speicher – server.js startet sie, die Tests ebenso.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { seedState } from '../seed.js';
import { createStore, emptyContent, newLeadRessort } from './store.js';
import {
  hashPassword, verifyPassword, newToken, hashToken, readCookie, setSessionCookie, clearSessionCookie,
  createLimiter, SESSION_COOKIE, SESSION_DAYS, MIN_PASSWORD,
} from './auth.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const KR_TYPES = ['number', 'bool']; // Anzahl (automatisch erreicht) und Ja/Nein (von Hand)
const PALETTE = ['#2563EB', '#7C3AED', '#DB2777', '#0F766E', '#B45309', '#0891B2', '#65A30D', '#9333EA', '#DC2626', '#4B5563'];
const USER_STATUS = ['pending', 'active', 'disabled'];

const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const find = (list, id) => list.find((x) => x.id === id);
const normEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// ---------- Fachlogik Schlüsselergebnisse ----------
function fmtValue(k, value, achieved, achievedAt) {
  const num = k.type === 'number';
  const unit = k.unit ? ' ' + k.unit : '';
  const n = num ? Number(value).toLocaleString('de-DE') + unit : '';
  if (achieved) return 'Erreicht am ' + (achievedAt || today()) + (num ? ' (' + n + ')' : '');
  return num ? n : 'Offen';
}

function addHistory(k, user, entry) {
  k.history.unshift({ id: randomUUID(), at: now(), who: user.name, userId: user.id, ...entry });
  k.updatedAt = now();
}

// Anzahl gilt nur mit echtem Zielwert (> 0) als erreicht; das Datum wird beim Erreichen festgehalten.
function recomputeAchieved(k) {
  if (k.type === 'number') k.achieved = Number(k.target) > 0 && Number(k.current) >= Number(k.target);
  k.achievedAt = k.achieved ? k.achievedAt || today() : null;
}
const validTarget = (t) => t !== undefined && t !== null && t !== '' && Number.isFinite(Number(t)) && Number(t) > 0;

// Was Clients über Nutzer erfahren dürfen (nie Hash oder Sessions).
const publicUser = (u) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, eventId: u.eventId, ressortId: u.ressortId,
  requestedRessortName: u.requestedRessortName || '', status: u.status, mustChangePassword: !!u.mustChangePassword,
  createdAt: u.createdAt, approvedAt: u.approvedAt || null, approvedBy: u.approvedBy || null, lastLoginAt: u.lastLoginAt || null,
});

export async function createApp({ dataDir, seed = true, adminEmail, adminPassword, adminName, allowReset = false, log = console.log } = {}) {
  const store = createStore(dataDir, { seed });
  const { state } = store;
  const save = () => store.save();

  // Erster Admin aus Umgebungsvariablen, solange es noch keinen gibt.
  if (!state.users.some((u) => u.role === 'admin')) {
    if (adminEmail && adminPassword) {
      state.users.push({
        id: randomUUID(), email: normEmail(adminEmail), name: adminName || 'Admin', passwordHash: await hashPassword(adminPassword),
        role: 'admin', eventId: state.events[0]?.id || null, ressortId: null, requestedRessortName: '', status: 'active',
        mustChangePassword: true, createdAt: now(), approvedAt: now(), approvedBy: 'admin', lastLoginAt: null,
      });
      save();
      // Länge hilft bei der Fehlersuche (z. B. mitgespeicherte Anführungszeichen), ohne das Passwort zu verraten.
      log(`Admin ${normEmail(adminEmail)} angelegt (Passwort: ${String(adminPassword).length} Zeichen) – muss beim ersten Login geändert werden.`);
    } else if (adminEmail) {
      log(`Noch kein Admin: Wer sich mit ${normEmail(adminEmail)} registriert, wird Admin.`);
    } else {
      log('Achtung: Es gibt noch keinen Admin. ADMIN_EMAIL (und optional ADMIN_PASSWORD) setzen und neu starten.');
    }
  } else {
    log('Admins: ' + state.users.filter((u) => u.role === 'admin').map((u) => `${u.email} (${u.status})`).join(', '));
  }
  // Solange es keinen Admin gibt, wird eine Registrierung mit ADMIN_EMAIL zum Admin.
  const isBootstrapAdmin = (email) => !!adminEmail && email === normEmail(adminEmail) && !state.users.some((u) => u.role === 'admin');

  // Je IP großzügiger (geteiltes Event-WLAN), je E-Mail strenger.
  const ipLimiter = createLimiter({ max: 30, windowMs: 15 * 60 * 1000 });
  const mailLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
  const registerLimiter = createLimiter({ max: 30, windowMs: 15 * 60 * 1000 });

  const autoApproveActive = () => !!state.settings.autoApproveUntil && new Date(state.settings.autoApproveUntil) > new Date();
  const activeAdmins = () => state.users.filter((u) => u.role === 'admin' && u.status === 'active');
  const canEditRessort = (user, ressortId) => user.role === 'admin' || (!!user.ressortId && user.ressortId === ressortId);
  const canEditKr = (user, k) => canEditRessort(user, k.ressortId);
  const activeKrsOf = (objectiveId) => state.keyResults.filter((k) => k.objectiveId === objectiveId && !k.archivedAt);

  function startSession(req, res, user) {
    const token = newToken();
    state.sessions = state.sessions.filter((s) => new Date(s.expiresAt) > new Date());
    state.sessions.push({ tokenHash: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString() });
    user.lastLoginAt = now();
    setSessionCookie(req, res, token);
  }
  const dropSessions = (userId) => (state.sessions = state.sessions.filter((s) => s.userId !== userId));

  // Legt ein Ressort aus einem Freitext an – oder nimmt ein gleichnamiges, falls es schon existiert.
  function ressortFromName(eventId, name, unreviewed) {
    const clean = String(name).trim().slice(0, 60);
    const existing = state.ressorts.find((r) => r.eventId === eventId && r.name.toLowerCase() === clean.toLowerCase());
    if (existing) return existing;
    const count = state.ressorts.filter((r) => r.eventId === eventId).length;
    const r = { id: randomUUID(), eventId, name: clean, color: PALETTE[count % PALETTE.length], isLead: false, unreviewed, createdAt: now() };
    state.ressorts.push(r);
    return r;
  }

  // ---------- App ----------
  const app = express();
  app.set('trust proxy', 1); // Coolify/Traefik davor
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(express.static(PUBLIC_DIR));

  const ok = (res, body) => res.json(body);
  const bad = (res, msg) => res.status(400).json({ error: msg });
  const notFound = (res) => res.status(404).json({ error: 'Nicht gefunden' });
  const forbidden = (res, msg = 'Keine Berechtigung') => res.status(403).json({ error: msg });

  // Schreibende Requests nur als JSON – zusammen mit SameSite=Lax der Schutz gegen CSRF.
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && !String(req.headers['content-type'] || '').startsWith('application/json')) return res.status(415).json({ error: 'Content-Type application/json erforderlich' });
    next();
  });

  // Session auflösen
  app.use('/api', (req, _res, next) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const s = state.sessions.find((x) => x.tokenHash === hashToken(token));
      const user = s && new Date(s.expiresAt) > new Date() ? find(state.users, s.userId) : null;
      if (user && user.status === 'active') { req.user = user; req.sessionHash = s.tokenHash; }
    }
    next();
  });

  // ---------- Öffentlich ----------
  app.get('/api/health', (_req, res) => ok(res, { ok: true }));

  app.get('/api/public/registration-options', (_req, res) => ok(res, {
    events: state.events.map((e) => ({ id: e.id, name: e.name, startDate: e.startDate })),
    ressorts: state.ressorts.map((r) => ({ id: r.id, eventId: r.eventId, name: r.name, isLead: r.isLead })),
  }));

  // Einladungslink (/#einladung=<id>): E-Mail vorausfüllen und ggf. das feste Ressort zeigen
  app.get('/api/public/invites/:id', (req, res) => {
    const inv = state.invites.find((i) => i.id === req.params.id && !i.usedAt);
    if (!inv) return res.status(404).json({ error: 'Diese Einladung ist nicht mehr gültig.' });
    const r = find(state.ressorts, inv.ressortId);
    ok(res, { email: inv.email, ressort: r ? { id: r.id, name: r.name, eventId: r.eventId, eventName: find(state.events, r.eventId)?.name || '' } : null });
  });

  app.post('/api/auth/register', async (req, res) => {
    if (registerLimiter.blocked(req.ip)) return res.status(429).json({ error: 'Zu viele Registrierungen – bitte später erneut versuchen.' });
    const b = req.body || {};
    const name = String(b.name || '').trim().slice(0, 80);
    const email = normEmail(b.email);
    if (!name) return bad(res, 'Bitte deinen Namen angeben.');
    if (!validEmail(email)) return bad(res, 'Bitte eine gültige E-Mail-Adresse angeben.');
    if (String(b.password || '').length < MIN_PASSWORD) return bad(res, `Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`);
    if (state.users.some((u) => u.email === email)) return bad(res, 'Zu dieser E-Mail-Adresse gibt es schon ein Konto.');
    if (isBootstrapAdmin(email)) {
      registerLimiter.hit(req.ip);
      const admin = {
        id: randomUUID(), email, name, passwordHash: await hashPassword(b.password), role: 'admin',
        eventId: find(state.events, b.eventId)?.id || null, ressortId: null, requestedRessortName: '', status: 'active',
        mustChangePassword: false, createdAt: now(), approvedAt: now(), approvedBy: 'admin', lastLoginAt: null,
      };
      state.users.push(admin);
      startSession(req, res, admin);
      save();
      log(`Admin ${email} per Registrierung angelegt.`);
      return ok(res, { status: admin.status, user: publicUser(admin) });
    }
    // Eingeladene E-Mail: Freigabe entfällt; ein in der Einladung festgelegtes Ressort hat Vorrang.
    const invite = state.invites.find((i) => i.email === email && !i.usedAt);
    const newName = String(b.newRessortName || '').trim();
    let eventId = b.eventId;
    let ressort = invite ? find(state.ressorts, invite.ressortId) || null : null;
    if (ressort) eventId = ressort.eventId;
    else {
      if (!state.events.length) return bad(res, 'Es ist noch kein Event angelegt – bitte später registrieren.');
      if (!find(state.events, eventId)) return bad(res, 'Bitte ein Event auswählen.');
      if (b.ressortId) {
        ressort = find(state.ressorts, b.ressortId);
        if (!ressort || ressort.eventId !== eventId) return bad(res, 'Ressort passt nicht zum Event.');
      } else if (!newName) return bad(res, 'Bitte ein Ressort auswählen oder eintragen.');
    }
    registerLimiter.hit(req.ip);

    const auto = !!invite || autoApproveActive();
    if (!ressort && auto) ressort = ressortFromName(eventId, newName, true);
    const user = {
      id: randomUUID(), email, name, passwordHash: await hashPassword(b.password), role: 'member',
      eventId, ressortId: ressort?.id || null, requestedRessortName: ressort ? '' : newName.slice(0, 60),
      status: auto ? 'active' : 'pending', mustChangePassword: false, createdAt: now(),
      approvedAt: auto ? now() : null, approvedBy: invite ? 'invite' : auto ? 'auto' : null, lastLoginAt: null,
    };
    state.users.push(user);
    if (invite) { invite.usedAt = now(); invite.userId = user.id; }
    if (auto) startSession(req, res, user);
    save();
    ok(res, { status: user.status, user: auto ? publicUser(user) : undefined });
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = normEmail(req.body?.email);
    if (ipLimiter.blocked(req.ip) || mailLimiter.blocked(email)) return res.status(429).json({ error: 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.' });
    const user = state.users.find((u) => u.email === email);
    if (!user || !(await verifyPassword(req.body?.password, user.passwordHash))) {
      ipLimiter.hit(req.ip);
      mailLimiter.hit(email);
      return res.status(401).json({ error: 'E-Mail oder Passwort ist falsch.' });
    }
    if (user.status === 'pending') return forbidden(res, 'Dein Konto wartet noch auf Freigabe durch einen Admin.');
    if (user.status !== 'active') return forbidden(res, 'Dein Konto ist gesperrt.');
    mailLimiter.reset(email);
    startSession(req, res, user);
    save();
    ok(res, { user: publicUser(user) });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.sessionHash) { state.sessions = state.sessions.filter((s) => s.tokenHash !== req.sessionHash); save(); }
    clearSessionCookie(req, res);
    ok(res, { ok: true });
  });

  // ---------- Ab hier nur mit Login ----------
  app.use('/api', (req, res, next) => (req.user ? next() : res.status(401).json({ error: 'Bitte anmelden.' })));

  app.get('/api/auth/me', (req, res) => ok(res, { user: publicUser(req.user) }));

  app.post('/api/auth/password', async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) return bad(res, 'Das aktuelle Passwort stimmt nicht.');
    if (String(newPassword || '').length < MIN_PASSWORD) return bad(res, `Das neue Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`);
    if (newPassword === currentPassword) return bad(res, 'Das neue Passwort muss sich vom alten unterscheiden.');
    req.user.passwordHash = await hashPassword(newPassword);
    req.user.mustChangePassword = false;
    state.sessions = state.sessions.filter((s) => s.userId !== req.user.id || s.tokenHash === req.sessionHash);
    save();
    ok(res, { user: publicUser(req.user) });
  });

  // Einmal-Passwort muss erst ersetzt werden.
  app.use('/api', (req, res, next) => (req.user.mustChangePassword ? res.status(403).json({ error: 'Bitte zuerst ein neues Passwort setzen.', code: 'PASSWORD_CHANGE_REQUIRED' }) : next()));

  const requireAdmin = (req, res, next) => (req.user.role === 'admin' ? next() : forbidden(res, 'Nur für Admins'));

  app.get('/api/state', (req, res) => {
    const body = { events: state.events, ressorts: state.ressorts, objectives: state.objectives, keyResults: state.keyResults };
    if (req.user.role === 'admin') body.admin = { pendingUsers: state.users.filter((u) => u.status === 'pending').length, autoApproveUntil: autoApproveActive() ? state.settings.autoApproveUntil : null };
    ok(res, body);
  });

  // --- Events (nur Admin) ---
  app.post('/api/events', requireAdmin, (req, res) => {
    const { name, startDate, endDate } = req.body || {};
    if (!name) return bad(res, 'name fehlt');
    const ev = { id: randomUUID(), name, startDate: startDate || null, endDate: endDate || null, createdAt: now() };
    state.events.push(ev);
    state.ressorts.push(newLeadRessort(ev.id));
    save();
    ok(res, ev);
  });
  app.put('/api/events/:id', requireAdmin, (req, res) => {
    const ev = find(state.events, req.params.id);
    if (!ev) return notFound(res);
    const { name, startDate, endDate } = req.body || {};
    if (name !== undefined) ev.name = name;
    if (startDate !== undefined) ev.startDate = startDate;
    if (endDate !== undefined) ev.endDate = endDate;
    save();
    ok(res, ev);
  });
  // Ziele und Schlüsselergebnisse gehen nie verloren: Events und Ressorts lassen sich nur ohne sie (auch archivierte) löschen.
  app.delete('/api/events/:id', requireAdmin, (req, res) => {
    const id = req.params.id;
    if (!find(state.events, id)) return notFound(res);
    const n = state.objectives.filter((o) => o.eventId === id).length + state.keyResults.filter((k) => k.eventId === id).length;
    if (n) return bad(res, `Das Event hat noch ${n} Ziel(e) bzw. Schlüsselergebnis(se) (inkl. archivierter) und kann deshalb nicht gelöscht werden.`);
    state.ressorts = state.ressorts.filter((r) => r.eventId !== id);
    state.events = state.events.filter((e) => e.id !== id);
    for (const u of state.users) if (u.eventId === id) { u.eventId = null; u.ressortId = null; }
    save();
    ok(res, { ok: true });
  });

  // --- Ressorts (nur Admin) ---
  app.post('/api/ressorts', requireAdmin, (req, res) => {
    const { eventId, name, color } = req.body || {};
    if (!eventId || !find(state.events, eventId)) return bad(res, 'eventId ungültig');
    if (!name) return bad(res, 'name fehlt');
    const r = { id: randomUUID(), eventId, name, color: color || '#2563EB', isLead: false, unreviewed: false, createdAt: now() };
    state.ressorts.push(r);
    save();
    ok(res, r);
  });
  app.put('/api/ressorts/:id', requireAdmin, (req, res) => {
    const r = find(state.ressorts, req.params.id);
    if (!r) return notFound(res);
    for (const f of ['name', 'color']) if (req.body[f] !== undefined) r[f] = req.body[f];
    if (req.body.unreviewed !== undefined) r.unreviewed = !!req.body.unreviewed;
    save();
    ok(res, r);
  });
  app.delete('/api/ressorts/:id', requireAdmin, (req, res) => {
    const r = find(state.ressorts, req.params.id);
    if (!r) return notFound(res);
    if (r.isLead) return bad(res, 'Das Führungsressort kann nicht gelöscht werden.');
    const n = state.objectives.filter((o) => o.ressortId === r.id).length + state.keyResults.filter((k) => k.ressortId === r.id).length;
    if (n) return bad(res, `Das Ressort hat noch ${n} Ziel(e) bzw. Schlüsselergebnis(se) (inkl. archivierter). Bitte zuerst mit einem anderen Ressort zusammenführen.`);
    state.ressorts = state.ressorts.filter((x) => x.id !== r.id);
    for (const u of state.users) if (u.ressortId === r.id) u.ressortId = null;
    save();
    ok(res, { ok: true });
  });
  // Zwei Ressorts zusammenführen: Ziele, Schlüsselergebnisse und Nutzer wandern ins Zielressort, die Quelle verschwindet.
  app.post('/api/admin/ressorts/:id/merge', requireAdmin, (req, res) => {
    const src = find(state.ressorts, req.params.id);
    const dst = find(state.ressorts, req.body?.intoId);
    if (!src || !dst) return notFound(res);
    if (src.id === dst.id || src.eventId !== dst.eventId) return bad(res, 'Nur verschiedene Ressorts desselben Events lassen sich zusammenführen.');
    if (src.isLead) return bad(res, 'Das Führungsressort kann nicht in ein anderes Ressort aufgehen.');
    for (const o of state.objectives) if (o.ressortId === src.id) o.ressortId = dst.id;
    for (const k of state.keyResults) if (k.ressortId === src.id) k.ressortId = dst.id;
    for (const u of state.users) if (u.ressortId === src.id) u.ressortId = dst.id;
    for (const i of state.invites) if (i.ressortId === src.id) i.ressortId = dst.id;
    state.ressorts = state.ressorts.filter((x) => x.id !== src.id);
    save();
    ok(res, dst);
  });

  // --- Ziele ---
  // Ein Ziel gehört zu einem Ressort; es bündelt Schlüsselergebnisse. Fortschritt und Erreichung ergeben sich aus ihnen.
  app.post('/api/objectives', (req, res) => {
    const b = req.body || {};
    const r = find(state.ressorts, b.ressortId);
    if (!r) return bad(res, 'ressortId ungültig');
    if (!canEditRessort(req.user, r.id)) return forbidden(res, 'Du kannst nur in deinem eigenen Ressort Ziele anlegen.');
    const title = String(b.title || '').trim();
    if (!title) return bad(res, 'Bitte eine Bezeichnung für das Ziel angeben.');
    const o = {
      id: randomUUID(), eventId: r.eventId, ressortId: r.id, title, description: String(b.description || ''),
      deadline: b.deadline || null, archivedAt: null, archivedBy: null, createdAt: now(), updatedAt: now(),
    };
    state.objectives.push(o);
    save();
    ok(res, o);
  });

  app.put('/api/objectives/:id', (req, res) => {
    const o = find(state.objectives, req.params.id);
    if (!o) return notFound(res);
    if (!canEditRessort(req.user, o.ressortId)) return forbidden(res, 'Du kannst nur Ziele deines eigenen Ressorts bearbeiten.');
    if (o.archivedAt) return bad(res, 'Das Ziel ist archiviert – ein Admin kann es im Ressort wiederherstellen.');
    const b = req.body || {};
    if (b.title !== undefined && !String(b.title).trim()) return bad(res, 'Bitte eine Bezeichnung für das Ziel angeben.');
    let newRessort = null;
    if (b.ressortId !== undefined && b.ressortId !== o.ressortId) {
      if (req.user.role !== 'admin') return forbidden(res, 'Nur Admins können Ziele einem anderen Ressort zuordnen.');
      newRessort = find(state.ressorts, b.ressortId);
      if (!newRessort || newRessort.eventId !== o.eventId) return bad(res, 'ressortId ungültig');
    }
    if (b.title !== undefined) o.title = String(b.title).trim();
    if (b.description !== undefined) o.description = String(b.description);
    if (b.deadline !== undefined) o.deadline = b.deadline || null;
    if (newRessort) {
      // Alle Schlüsselergebnisse wandern mit; Abhängigkeiten zum alten Ressort passen nicht mehr.
      const moving = state.keyResults.filter((k) => k.objectiveId === o.id);
      const ids = new Set(moving.map((k) => k.id));
      for (const k of state.keyResults) if (!ids.has(k.id)) k.deps = k.deps.filter((d) => !ids.has(d));
      for (const k of moving) { k.ressortId = newRessort.id; k.deps = k.deps.filter((d) => ids.has(d)); }
      o.ressortId = newRessort.id;
    }
    o.updatedAt = now();
    save();
    ok(res, o);
  });

  // „Löschen“ archiviert nur (Admin) – und nur, wenn keine aktiven Schlüsselergebnisse mehr daran hängen.
  app.delete('/api/objectives/:id', requireAdmin, (req, res) => {
    const o = find(state.objectives, req.params.id);
    if (!o) return notFound(res);
    const n = activeKrsOf(o.id).length;
    if (n) return bad(res, `Das Ziel hat noch ${n} aktive(s) Schlüsselergebnis(se). Bitte zuerst archivieren oder einem anderen Ziel zuordnen.`);
    if (!o.archivedAt) { o.archivedAt = now(); o.archivedBy = req.user.name; o.updatedAt = now(); save(); }
    ok(res, o);
  });

  app.post('/api/objectives/:id/restore', requireAdmin, (req, res) => {
    const o = find(state.objectives, req.params.id);
    if (!o) return notFound(res);
    if (o.archivedAt) { o.archivedAt = null; o.archivedBy = null; o.updatedAt = now(); save(); }
    ok(res, o);
  });

  // --- Schlüsselergebnisse ---
  // Abhängigkeiten nur innerhalb desselben Ressorts (auch über Ziele hinweg); liefert null bei ungültigen Angaben.
  // Archivierte lassen sich nicht neu als Voraussetzung wählen; bestehende Verweise bleiben für eine Wiederherstellung erhalten.
  function cleanDeps(deps, k) {
    if (!Array.isArray(deps)) return [];
    const out = [];
    for (const d of new Set(deps)) {
      const dep = find(state.keyResults, d);
      if (!dep || d === k.id || dep.ressortId !== k.ressortId) return null;
      if (dep.archivedAt && !(k.deps || []).includes(d)) return null;
      out.push(d);
    }
    return out;
  }

  app.post('/api/key-results', (req, res) => {
    const b = req.body || {};
    const o = find(state.objectives, b.objectiveId);
    if (!o) return bad(res, 'objectiveId ungültig');
    if (o.archivedAt) return bad(res, 'Das Ziel ist archiviert.');
    if (!canEditRessort(req.user, o.ressortId)) return forbidden(res, 'Du kannst nur in deinem eigenen Ressort Schlüsselergebnisse anlegen.');
    if (!b.title) return bad(res, 'title fehlt');
    if (!KR_TYPES.includes(b.type)) return bad(res, 'type ungültig (' + KR_TYPES.join(', ') + ')');
    const num = b.type === 'number';
    if (num && !validTarget(b.target)) return bad(res, 'Bitte einen Zielwert größer als 0 angeben.');
    const k = {
      id: randomUUID(),
      eventId: o.eventId,
      ressortId: o.ressortId,
      objectiveId: o.id,
      title: b.title,
      description: b.description || '',
      type: b.type,
      target: num ? Number(b.target) : 1,
      current: num ? Number(b.current || 0) : 0,
      unit: num ? b.unit || '' : '',
      deadline: b.deadline || null,
      achieved: false,
      achievedAt: null,
      archivedAt: null,
      archivedBy: null,
      deps: [],
      history: [],
      createdAt: now(),
      updatedAt: now(),
    };
    const deps = cleanDeps(b.deps, k);
    if (!deps) return bad(res, 'Abhängigkeiten sind nur zu Schlüsselergebnissen desselben Ressorts möglich.');
    k.deps = deps;
    recomputeAchieved(k);
    addHistory(k, req.user, { kind: 'Angelegt', from: '–', to: num ? fmtValue(k, k.target) : 'Offen', note: b.note || 'Schlüsselergebnis angelegt' });
    state.keyResults.push(k);
    save();
    ok(res, k);
  });

  // Bearbeiten: Stammdaten (Titel, Zielwert, Frist, Abhängigkeiten, Ziel …) und der aktuelle Stand
  // (Ist-Wert bzw. Ja/Nein, Erreicht-Datum, Kommentar) in einem Schritt. Jede Art von Änderung landet in der Historie.
  app.put('/api/key-results/:id', (req, res) => {
    const k = find(state.keyResults, req.params.id);
    if (!k) return notFound(res);
    if (!canEditKr(req.user, k)) return forbidden(res, 'Du kannst nur Schlüsselergebnisse deines eigenen Ressorts bearbeiten.');
    if (k.archivedAt) return bad(res, 'Das Schlüsselergebnis ist archiviert – ein Admin kann es im Ressort wiederherstellen.');
    const b = req.body || {};
    // Erst alles prüfen, dann ändern – damit eine abgelehnte Anfrage nichts halb speichert.
    const num = k.type === 'number';
    if (num && b.target !== undefined && !validTarget(b.target)) return bad(res, 'Bitte einen Zielwert größer als 0 angeben.');
    const hasCurrent = num && b.current !== undefined && b.current !== null && b.current !== '';
    if (hasCurrent && Number.isNaN(Number(b.current))) return bad(res, 'Der Ist-Wert muss eine Zahl sein.');
    // Anderes Ziel: im eigenen Ressort darf das jeder, in ein anderes Ressort nur ein Admin.
    let newObjective = null;
    if (b.objectiveId !== undefined && b.objectiveId !== k.objectiveId) {
      newObjective = find(state.objectives, b.objectiveId);
      if (!newObjective || newObjective.eventId !== k.eventId) return bad(res, 'objectiveId ungültig');
      if (newObjective.archivedAt) return bad(res, 'Das Ziel ist archiviert.');
      if (newObjective.ressortId !== k.ressortId && req.user.role !== 'admin') return forbidden(res, 'Nur Admins können Schlüsselergebnisse einem anderen Ressort zuordnen.');
    }
    const newRessortId = newObjective && newObjective.ressortId !== k.ressortId ? newObjective.ressortId : null;
    let deps = null;
    if (Array.isArray(b.deps)) {
      deps = cleanDeps(b.deps, { id: k.id, ressortId: newRessortId || k.ressortId });
      if (!deps) return bad(res, 'Abhängigkeiten sind nur zu Schlüsselergebnissen desselben Ressorts möglich.');
    }

    const before = fmtValue(k, k.current, k.achieved, k.achievedAt);
    const changes = [];
    if (newObjective) {
      changes.push('Ziel ' + (find(state.objectives, k.objectiveId)?.title || '–') + ' → ' + newObjective.title);
      k.objectiveId = newObjective.id;
    }
    if (newRessortId) {
      // Alte Abhängigkeiten passen nicht mehr: in beide Richtungen lösen.
      for (const x of state.keyResults) x.deps = x.deps.filter((d) => d !== k.id);
      k.deps = [];
      changes.push('Ressort ' + (find(state.ressorts, k.ressortId)?.name || '–') + ' → ' + find(state.ressorts, newRessortId).name);
      k.ressortId = newRessortId;
    }
    if (deps) {
      if (JSON.stringify(deps) !== JSON.stringify(k.deps)) changes.push('Abhängigkeiten geändert');
      k.deps = deps;
    }
    if (b.title !== undefined && b.title !== k.title) { changes.push('Titel'); k.title = b.title; }
    if (b.description !== undefined) k.description = b.description;
    if (b.unit !== undefined) k.unit = b.unit;
    if (b.deadline !== undefined && b.deadline !== k.deadline) { changes.push('Frist ' + (k.deadline || '–') + ' → ' + (b.deadline || '–')); k.deadline = b.deadline; }
    if (num && b.target !== undefined && Number(b.target) !== Number(k.target)) { changes.push('Zielwert ' + k.target + ' → ' + b.target); k.target = Number(b.target); }

    // Aktueller Stand
    let stateChanged = false;
    if (hasCurrent && Number(b.current) !== Number(k.current)) { k.current = Number(b.current); stateChanged = true; }
    if (!num && b.achieved !== undefined && !!b.achieved !== k.achieved) { k.achieved = !!b.achieved; stateChanged = true; }
    recomputeAchieved(k);
    if (k.achieved && b.achievedAt && b.achievedAt !== k.achievedAt) { k.achievedAt = b.achievedAt; stateChanged = true; }
    const after = fmtValue(k, k.current, k.achieved, k.achievedAt);
    const note = String(b.note || '').trim();

    if (changes.length) addHistory(k, req.user, { kind: 'Stammdaten geändert', from: '', to: changes.join(' · '), note: stateChanged ? '' : note });
    if (stateChanged) addHistory(k, req.user, { kind: num ? 'Wert aktualisiert' : 'Erreichung eingetragen', from: before, to: after, note });
    else if (!changes.length && note) addHistory(k, req.user, { kind: 'Kommentar', from: '', to: after, note });
    save();
    ok(res, k);
  });

  // Ist-Wert eintragen (Zahl)
  app.post('/api/key-results/:id/value', (req, res) => {
    const k = find(state.keyResults, req.params.id);
    if (!k) return notFound(res);
    if (!canEditKr(req.user, k)) return forbidden(res, 'Du kannst nur Schlüsselergebnisse deines eigenen Ressorts bearbeiten.');
    if (k.archivedAt) return bad(res, 'Das Schlüsselergebnis ist archiviert – ein Admin kann es im Ressort wiederherstellen.');
    const { value, note } = req.body || {};
    if (k.type !== 'number') return bad(res, 'Dieses Schlüsselergebnis hat keinen Zahlenwert');
    const nv = Number(value);
    if (Number.isNaN(nv)) return bad(res, 'value muss eine Zahl sein');
    const from = fmtValue(k, k.current, k.achieved, k.achievedAt);
    const wasAchieved = k.achieved;
    k.current = nv;
    recomputeAchieved(k);
    if (k.achieved && !wasAchieved) k.achievedAt = k.achievedAt || today();
    if (!k.achieved) k.achievedAt = null;
    addHistory(k, req.user, { kind: 'Wert aktualisiert', from, to: fmtValue(k, k.current, k.achieved, k.achievedAt), note: note || '' });
    save();
    ok(res, k);
  });

  // Erreichung eintragen (Ja/Nein mit Datum, optional mit Wert)
  app.post('/api/key-results/:id/achieve', (req, res) => {
    const k = find(state.keyResults, req.params.id);
    if (!k) return notFound(res);
    if (!canEditKr(req.user, k)) return forbidden(res, 'Du kannst nur Schlüsselergebnisse deines eigenen Ressorts bearbeiten.');
    if (k.archivedAt) return bad(res, 'Das Schlüsselergebnis ist archiviert – ein Admin kann es im Ressort wiederherstellen.');
    const { achieved, achievedAt, value, note } = req.body || {};
    const from = fmtValue(k, k.current, k.achieved, k.achievedAt);
    const num = k.type === 'number';
    if (num && value !== undefined && value !== null && value !== '') {
      const nv = Number(value);
      if (Number.isNaN(nv)) return bad(res, 'value muss eine Zahl sein');
      k.current = nv;
    }
    if (k.type === 'bool') k.achieved = !!achieved;
    else recomputeAchieved(k);
    k.achievedAt = k.achieved ? achievedAt || today() : null;
    addHistory(k, req.user, { kind: 'Erreichung eingetragen', from, to: fmtValue(k, k.current, k.achieved, k.achievedAt), note: note || '' });
    save();
    ok(res, k);
  });

  // „Löschen“ archiviert nur (Admin): Das Schlüsselergebnis verschwindet aus den Listen, Historie und Abhängigkeiten bleiben.
  app.delete('/api/key-results/:id', requireAdmin, (req, res) => {
    const k = find(state.keyResults, req.params.id);
    if (!k) return notFound(res);
    if (!k.archivedAt) {
      k.archivedAt = now();
      k.archivedBy = req.user.name;
      addHistory(k, req.user, { kind: 'Archiviert', from: '', to: 'Archiviert', note: '' });
      save();
    }
    ok(res, k);
  });

  app.post('/api/key-results/:id/restore', requireAdmin, (req, res) => {
    const k = find(state.keyResults, req.params.id);
    if (!k) return notFound(res);
    if (find(state.objectives, k.objectiveId)?.archivedAt) return bad(res, 'Das zugehörige Ziel ist archiviert – bitte zuerst das Ziel wiederherstellen.');
    if (k.archivedAt) {
      k.archivedAt = null;
      k.archivedBy = null;
      addHistory(k, req.user, { kind: 'Wiederhergestellt', from: 'Archiviert', to: fmtValue(k, k.current, k.achieved, k.achievedAt), note: '' });
      save();
    }
    ok(res, k);
  });

  // --- Verwaltung: Nutzer & Einstellungen ---
  app.get('/api/admin/users', requireAdmin, (_req, res) => ok(res, state.users.map(publicUser)));

  app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
    const u = find(state.users, req.params.id);
    if (!u) return notFound(res);
    const b = req.body || {};
    const next = { ...u };
    if (b.name !== undefined) next.name = String(b.name).trim().slice(0, 80);
    if (b.email !== undefined) next.email = normEmail(b.email);
    if (b.role !== undefined) next.role = b.role === 'admin' ? 'admin' : 'member';
    if (b.status !== undefined) next.status = b.status;
    if (b.eventId !== undefined) next.eventId = b.eventId || null;
    if (b.ressortId !== undefined) next.ressortId = b.ressortId || null;
    if (!next.name) return bad(res, 'Name fehlt.');
    if (!validEmail(next.email)) return bad(res, 'E-Mail-Adresse ungültig.');
    if (state.users.some((x) => x.id !== u.id && x.email === next.email)) return bad(res, 'Diese E-Mail-Adresse ist schon vergeben.');
    if (!USER_STATUS.includes(next.status)) return bad(res, 'Status ungültig.');
    if (next.eventId && !find(state.events, next.eventId)) return bad(res, 'Event ungültig.');
    const newName = String(b.newRessortName || '').trim();
    if (newName) {
      if (!next.eventId) return bad(res, 'Für ein neues Ressort zuerst ein Event wählen.');
    } else if (next.ressortId) {
      const r = find(state.ressorts, next.ressortId);
      if (!r || r.eventId !== next.eventId) return bad(res, 'Ressort passt nicht zum Event.');
    }
    if (next.status === 'active' && next.role === 'member' && !next.ressortId && !newName) return bad(res, 'Bitte vor der Freigabe ein Ressort zuordnen.');
    const losesAdmin = u.role === 'admin' && u.status === 'active' && (next.role !== 'admin' || next.status !== 'active');
    if (losesAdmin && activeAdmins().length <= 1) return bad(res, 'Der letzte aktive Admin kann nicht herabgestuft oder gesperrt werden.');

    if (newName) { next.ressortId = ressortFromName(next.eventId, newName, false).id; }
    if (next.ressortId) next.requestedRessortName = '';
    if (u.status !== 'active' && next.status === 'active') { next.approvedAt = now(); next.approvedBy = 'admin'; }
    Object.assign(u, next);
    if (u.status !== 'active') dropSessions(u.id);
    save();
    ok(res, publicUser(u));
  });

  app.post('/api/admin/users/:id/password', requireAdmin, async (req, res) => {
    const u = find(state.users, req.params.id);
    if (!u) return notFound(res);
    if (String(req.body?.password || '').length < MIN_PASSWORD) return bad(res, `Das Passwort muss mindestens ${MIN_PASSWORD} Zeichen haben.`);
    u.passwordHash = await hashPassword(req.body.password);
    u.mustChangePassword = true;
    dropSessions(u.id);
    save();
    ok(res, publicUser(u));
  });

  app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
    const u = find(state.users, req.params.id);
    if (!u) return notFound(res);
    if (u.id === req.user.id) return bad(res, 'Du kannst dein eigenes Konto nicht löschen.');
    if (u.role === 'admin' && u.status === 'active' && activeAdmins().length <= 1) return bad(res, 'Der letzte aktive Admin kann nicht gelöscht werden.');
    // Historien-Einträge bleiben mit Namen stehen.
    state.users = state.users.filter((x) => x.id !== u.id);
    dropSessions(u.id);
    save();
    ok(res, { ok: true });
  });

  // Einladungen: E-Mail (+ optional festes Ressort). Wer sich damit registriert, ist ohne Freigabe aktiv.
  const publicInvite = (i) => ({ id: i.id, email: i.email, ressortId: i.ressortId, createdAt: i.createdAt, createdBy: i.createdBy, usedAt: i.usedAt, userId: i.userId });
  app.get('/api/admin/invites', requireAdmin, (_req, res) => ok(res, state.invites.map(publicInvite)));
  app.post('/api/admin/invites', requireAdmin, (req, res) => {
    const email = normEmail(req.body?.email);
    if (!validEmail(email)) return bad(res, 'Bitte eine gültige E-Mail-Adresse angeben.');
    const existing = state.users.find((u) => u.email === email);
    if (existing) return bad(res, existing.status === 'pending' ? 'Diese Person hat sich schon registriert – bitte in der Nutzerliste freigeben.' : 'Zu dieser E-Mail-Adresse gibt es schon ein Konto.');
    if (state.invites.some((i) => i.email === email && !i.usedAt)) return bad(res, 'Diese E-Mail-Adresse ist bereits eingeladen.');
    const ressortId = req.body?.ressortId || null;
    if (ressortId && !find(state.ressorts, ressortId)) return bad(res, 'Ressort ungültig.');
    const inv = { id: randomUUID(), email, ressortId, createdAt: now(), createdBy: req.user.name, usedAt: null, userId: null };
    state.invites.push(inv);
    save();
    ok(res, publicInvite(inv));
  });
  app.delete('/api/admin/invites/:id', requireAdmin, (req, res) => {
    if (!state.invites.some((i) => i.id === req.params.id)) return notFound(res);
    state.invites = state.invites.filter((i) => i.id !== req.params.id);
    save();
    ok(res, { ok: true });
  });

  app.get('/api/admin/settings', requireAdmin, (_req, res) => ok(res, { autoApproveUntil: autoApproveActive() ? state.settings.autoApproveUntil : null }));
  app.put('/api/admin/settings', requireAdmin, (req, res) => {
    const until = req.body?.autoApproveUntil;
    if (until !== null && until !== undefined) {
      const d = new Date(until);
      if (Number.isNaN(d.getTime()) || d <= new Date()) return bad(res, 'Der Zeitpunkt muss in der Zukunft liegen.');
      state.settings.autoApproveUntil = d.toISOString();
    } else state.settings.autoApproveUntil = null;
    save();
    ok(res, { autoApproveUntil: state.settings.autoApproveUntil });
  });

  // Inhalte zurücksetzen (nur zum Testen, in Produktion aus). Nutzer bleiben erhalten.
  app.post('/api/reset', requireAdmin, (req, res) => {
    if (!allowReset) return forbidden(res, 'Zurücksetzen ist deaktiviert (ALLOW_RESET).');
    store.replaceContent(req.query.empty === '1' ? emptyContent() : seedState());
    ok(res, { ok: true });
  });

  app.use('/api', (_req, res) => notFound(res));

  return { app, store };
}
