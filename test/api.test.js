// API-Tests für Login, Freigabe, Rechte und Abhängigkeiten. Start: npm test
// Jeder Test-Block bekommt ein eigenes Datenverzeichnis mit den Demo-Daten.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../lib/app.js';

const ADMIN = { email: 'admin@example.test', password: 'admin-start-123' };
let server, base, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'okr-test-'));
  const { app } = await createApp({ dataDir, seed: true, adminEmail: ADMIN.email, adminPassword: ADMIN.password, allowReset: true, log: () => {} });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

// Kleiner Client mit eigenem Cookie
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
}

async function adminClient() {
  const c = client();
  await c('POST', '/api/auth/login', ADMIN);
  const pw = await c('POST', '/api/auth/password', { currentPassword: ADMIN.password, newPassword: 'admin-neu-4567' });
  if (pw.status === 200) ADMIN.password = 'admin-neu-4567';
  else await c('POST', '/api/auth/login', ADMIN);
  return c;
}

let n = 0;
async function member(c, ressortId, extra = {}) {
  const m = client();
  const email = `m${++n}@example.test`;
  const reg = await m('POST', '/api/auth/register', { name: 'Mitglied ' + n, email, password: 'passwort-123', eventId: 'ev-summit-2027', ressortId, ...extra });
  if (reg.body.status === 'pending') {
    const users = await c('GET', '/api/admin/users');
    const u = users.body.find((x) => x.email === email);
    await c('PUT', `/api/admin/users/${u.id}`, { status: 'active', ressortId: ressortId || u.ressortId });
    await m('POST', '/api/auth/login', { email, password: 'passwort-123' });
  }
  return m;
}

test('ohne Login: nur öffentliche Endpunkte', async () => {
  const c = client();
  assert.equal((await c('GET', '/api/health')).status, 200);
  assert.deepEqual((await c('GET', '/api/health')).body, { ok: true });
  assert.equal((await c('GET', '/api/state')).status, 401);
  const opts = await c('GET', '/api/public/registration-options');
  assert.equal(opts.status, 200);
  assert.ok(opts.body.ressorts.some((r) => r.isLead));
  assert.equal(opts.body.users, undefined);
});

test('schreibende Requests ohne JSON werden abgelehnt', async () => {
  const res = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});

test('Admin muss Einmal-Passwort ändern, danach Zugriff', async () => {
  const c = client();
  const login = await c('POST', '/api/auth/login', ADMIN);
  assert.equal(login.status, 200);
  assert.equal(login.body.user.mustChangePassword, true);
  assert.equal(login.body.user.passwordHash, undefined);
  assert.equal((await c('GET', '/api/state')).body.code, 'PASSWORD_CHANGE_REQUIRED');
  const a = await adminClient();
  const st = await a('GET', '/api/state');
  assert.equal(st.status, 200);
  assert.equal(st.body.users, undefined);
  assert.equal(st.body.sessions, undefined);
});

test('Migration: Führungsressort und nur Abhängigkeiten im selben Ressort', async () => {
  const a = await adminClient();
  const { body } = await a('GET', '/api/state');
  const lead = body.ressorts.filter((r) => r.eventId === 'ev-summit-2027' && r.isLead);
  assert.equal(lead.length, 1);
  assert.ok(body.kpis.every((k) => k.ressortId));
  for (const k of body.kpis) for (const d of k.deps) assert.equal(body.kpis.find((x) => x.id === d).ressortId, k.ressortId);
  assert.deepEqual(body.kpis.find((k) => k.id === 'k-breakeven').deps, ['k-tickets', 'k-sponsoring']);
});

test('Registrierung ohne Schalter: wartet auf Freigabe, Login gesperrt', async () => {
  const m = client();
  const reg = await m('POST', '/api/auth/register', { name: 'Neu', email: 'neu@example.test', password: 'passwort-123', eventId: 'ev-summit-2027', newRessortName: 'Presse' });
  assert.equal(reg.body.status, 'pending');
  assert.equal((await m('POST', '/api/auth/login', { email: 'neu@example.test', password: 'passwort-123' })).status, 403);
  const a = await adminClient();
  const st = await a('GET', '/api/state');
  assert.ok(!st.body.ressorts.some((r) => r.name === 'Presse'), 'Ressort entsteht erst bei Freigabe');
  const u = (await a('GET', '/api/admin/users')).body.find((x) => x.email === 'neu@example.test');
  assert.equal(u.requestedRessortName, 'Presse');
  assert.equal((await a('PUT', `/api/admin/users/${u.id}`, { status: 'active' })).status, 400, 'ohne Ressort keine Freigabe');
  const ok = await a('PUT', `/api/admin/users/${u.id}`, { status: 'active', newRessortName: 'Presse' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.approvedBy, 'admin');
  assert.ok(ok.body.ressortId);
  assert.equal((await m('POST', '/api/auth/login', { email: 'neu@example.test', password: 'passwort-123' })).status, 200);
});

test('Registrierung mit aktivem Schalter: sofort aktiv, Ressort ungeprüft angelegt', async () => {
  const a = await adminClient();
  assert.equal((await a('PUT', '/api/admin/settings', { autoApproveUntil: new Date(Date.now() - 1000).toISOString() })).status, 400);
  await a('PUT', '/api/admin/settings', { autoApproveUntil: new Date(Date.now() + 3600000).toISOString() });
  const m = client();
  const reg = await m('POST', '/api/auth/register', { name: 'Auto', email: 'auto@example.test', password: 'passwort-123', eventId: 'ev-summit-2027', newRessortName: 'Volunteers' });
  assert.equal(reg.body.status, 'active');
  assert.equal(reg.body.user.approvedBy, 'auto');
  assert.equal((await m('GET', '/api/state')).status, 200);
  const r = (await a('GET', '/api/state')).body.ressorts.find((x) => x.name === 'Volunteers');
  assert.equal(r.unreviewed, true);
  // gleichnamiges Ressort wird wiederverwendet statt doppelt angelegt
  await client()('POST', '/api/auth/register', { name: 'Auto 2', email: 'auto2@example.test', password: 'passwort-123', eventId: 'ev-summit-2027', newRessortName: 'volunteers' });
  assert.equal((await a('GET', '/api/state')).body.ressorts.filter((x) => x.name.toLowerCase() === 'volunteers').length, 1);
  await a('PUT', '/api/admin/settings', { autoApproveUntil: null });
  const reg2 = await client()('POST', '/api/auth/register', { name: 'Spät', email: 'spaet@example.test', password: 'passwort-123', eventId: 'ev-summit-2027', ressortId: 'r-marketing' });
  assert.equal(reg2.body.status, 'pending');
});

test('Rechte: eigenes Ressort ja, fremdes Ressort und Führung nein', async () => {
  const a = await adminClient();
  const m = await member(a, 'r-marketing');
  assert.equal((await m('POST', '/api/kpis/k-reach/value', { value: 330000, note: 'Test' })).status, 200);
  const st = await m('GET', '/api/state');
  const h = st.body.kpis.find((k) => k.id === 'k-reach').history[0];
  assert.match(h.who, /^Mitglied/);
  assert.ok(h.userId);
  assert.equal((await m('POST', '/api/kpis/k-deck/achieve', { achieved: true })).status, 403);
  assert.equal((await m('POST', '/api/kpis/k-tickets/value', { value: 900 })).status, 403);
  assert.equal((await m('PUT', '/api/kpis/k-gold', { title: 'x' })).status, 403);
  assert.equal((await m('POST', '/api/kpis', { ressortId: 'r-sponsoring', title: 'x', type: 'bool' })).status, 403);
  assert.equal((await m('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'Podcast live', type: 'bool' })).status, 200);
  assert.equal((await m('DELETE', '/api/kpis/k-newsletter')).status, 403);
  assert.equal((await m('PUT', '/api/kpis/k-reach', { ressortId: 'r-programm' })).status, 403);
  assert.equal((await m('POST', '/api/events', { name: 'x' })).status, 403);
  assert.equal((await m('POST', '/api/ressorts', { eventId: 'ev-summit-2027', name: 'x' })).status, 403);
  assert.equal((await m('GET', '/api/admin/users')).status, 403);
  assert.equal((await m('POST', '/api/reset')).status, 403);
  // Alle dürfen alles lesen, inkl. Historie
  assert.ok(st.body.kpis.find((k) => k.id === 'k-gold').history.length > 0);
});

test('Führungsressort pflegt Event-Kennzahlen, aber keine Ressort-Kennzahlen', async () => {
  const a = await adminClient();
  const lead = (await a('GET', '/api/state')).body.ressorts.find((r) => r.isLead).id;
  const f = await member(a, lead);
  assert.equal((await f('POST', '/api/kpis/k-tickets/value', { value: 910 })).status, 200);
  assert.equal((await f('POST', '/api/kpis/k-reach/value', { value: 1 })).status, 403);
});

test('Abhängigkeiten nur innerhalb desselben Ressorts', async () => {
  const a = await adminClient();
  assert.equal((await a('PUT', '/api/kpis/k-newsletter', { deps: ['k-reach'] })).status, 200);
  assert.equal((await a('PUT', '/api/kpis/k-newsletter', { deps: ['k-deck'] })).status, 400);
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'x', type: 'bool', deps: ['k-tickets'] })).status, 400);
  // Ressortwechsel löst Abhängigkeiten in beide Richtungen
  const moved = await a('PUT', '/api/kpis/k-reach', { ressortId: 'r-programm' });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.body.deps, []);
  const st = await a('GET', '/api/state');
  assert.ok(!st.body.kpis.find((k) => k.id === 'k-newsletter').deps.includes('k-reach'));
});

test('Admin-Schutz: letzter Admin bleibt, Führungsressort nicht löschbar', async () => {
  const a = await adminClient();
  const users = (await a('GET', '/api/admin/users')).body;
  const me = users.find((u) => u.email === ADMIN.email);
  assert.equal((await a('PUT', `/api/admin/users/${me.id}`, { role: 'member' })).status, 400);
  assert.equal((await a('DELETE', `/api/admin/users/${me.id}`)).status, 400);
  const lead = (await a('GET', '/api/state')).body.ressorts.find((r) => r.isLead);
  assert.equal((await a('DELETE', `/api/ressorts/${lead.id}`)).status, 400);
});

test('Gesperrte Nutzer verlieren ihre Session; Einmal-Passwort erzwingt Wechsel', async () => {
  const a = await adminClient();
  const m = await member(a, 'r-programm');
  const me = (await m('GET', '/api/auth/me')).body.user;
  await a('PUT', `/api/admin/users/${me.id}`, { status: 'disabled' });
  assert.equal((await m('GET', '/api/state')).status, 401);
  await a('PUT', `/api/admin/users/${me.id}`, { status: 'active' });
  await a('POST', `/api/admin/users/${me.id}/password`, { password: 'einmal-pass-99' });
  const login = await m('POST', '/api/auth/login', { email: me.email, password: 'einmal-pass-99' });
  assert.equal(login.body.user.mustChangePassword, true);
  assert.equal((await m('GET', '/api/state')).status, 403);
});

test('Neues Event bekommt automatisch ein Führungsressort; Zusammenführen', async () => {
  const a = await adminClient();
  const ev = (await a('POST', '/api/events', { name: 'Herbstforum' })).body;
  let st = (await a('GET', '/api/state')).body;
  assert.equal(st.ressorts.filter((r) => r.eventId === ev.id && r.isLead).length, 1);
  const x = (await a('POST', '/api/ressorts', { eventId: ev.id, name: 'Presse' })).body;
  const y = (await a('POST', '/api/ressorts', { eventId: ev.id, name: 'PR' })).body;
  await a('POST', '/api/kpis', { ressortId: x.id, title: 'Pressemitteilung', type: 'bool' });
  assert.equal((await a('POST', `/api/admin/ressorts/${x.id}/merge`, { intoId: y.id })).status, 200);
  st = (await a('GET', '/api/state')).body;
  assert.ok(!st.ressorts.some((r) => r.id === x.id));
  assert.equal(st.kpis.find((k) => k.title === 'Pressemitteilung').ressortId, y.id);
});

test('Login-Bremse nach zu vielen Fehlversuchen', async () => {
  const c = client();
  let last;
  for (let i = 0; i < 11; i++) last = await c('POST', '/api/auth/login', { email: 'bremse@example.test', password: 'falsch-falsch' });
  assert.equal(last.status, 429);
});

test('Frische Installation ohne ADMIN_PASSWORD: Registrierung mit ADMIN_EMAIL wird Admin', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okr-test-'));
  const { app } = await createApp({ dataDir: dir, seed: false, adminEmail: 'Chef@Example.test', log: () => {} });
  const srv = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (p, body) => fetch(url + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const other = await post('/api/auth/register', { name: 'Jemand', email: 'jemand@example.test', password: 'passwort-123' });
    assert.equal(other.status, 400, 'ohne Event keine normale Registrierung');
    const chef = await post('/api/auth/register', { name: 'Chef', email: 'chef@example.test', password: 'passwort-123' });
    assert.equal(chef.status, 200);
    assert.equal(chef.body.user.role, 'admin');
    assert.equal(chef.body.status, 'active');
    // Es gibt jetzt einen Admin – derselbe Weg funktioniert nicht noch einmal
    const again = await post('/api/auth/register', { name: 'Chef 2', email: 'CHEF@example.test', password: 'passwort-123' });
    assert.equal(again.status, 400);
    assert.equal((await post('/api/auth/login', { email: 'chef@example.test', password: 'passwort-123' })).status, 200);
  } finally {
    srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Migration v3: Meilenstein → Ja/Nein, Anzahl + Datum → Anzahl', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okr-test-'));
  const K = (id, type, target, current, extra = {}) => ({ id, eventId: 'e1', ressortId: 'r1', title: id, type, target, current, unit: '', deadline: null, achieved: false, achievedFlag: false, achievedAt: null, deps: [], history: [], ...extra });
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    version: 2,
    events: [{ id: 'e1', name: 'Alt' }],
    ressorts: [{ id: 'r1', eventId: 'e1', name: 'Team', lead: 'Jemand', color: '#000' }],
    kpis: [
      K('meilenstein', 'date', 1, 1, { achieved: true, achievedAt: '2026-10-01' }),
      K('combo-voll', 'combo', 4, 4, { achievedFlag: false, history: [{ at: '2026-10-20T10:00:00.000Z' }] }),
      K('combo-offen', 'combo', 4, 2, { achievedFlag: true }),
    ],
  }));
  const { store } = await createApp({ dataDir: dir, log: () => {} });
  const k = (id) => store.state.kpis.find((x) => x.id === id);
  try {
    assert.equal(store.state.version, 3);
    assert.equal(k('meilenstein').type, 'bool');
    assert.equal(k('meilenstein').achievedAt, '2026-10-01');
    assert.equal(k('combo-voll').type, 'number');
    assert.equal(k('combo-voll').achieved, true);
    assert.equal(k('combo-voll').achievedAt, '2026-10-20');
    assert.equal(k('combo-offen').achieved, false);
    assert.ok(store.state.kpis.every((x) => !('achievedFlag' in x)));
    assert.ok(store.state.ressorts.every((r) => !('lead' in r)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Nur noch die Typen Anzahl und Ja/Nein', async () => {
  const a = await adminClient();
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'x', type: 'combo' })).status, 400);
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'x', type: 'date' })).status, 400);
  const st = await a('GET', '/api/state');
  assert.ok(st.body.kpis.every((k) => ['number', 'bool'].includes(k.type)));
});

test('Anzahl braucht einen Zielwert > 0 und ist ohne Werte nicht erreicht', async () => {
  const a = await adminClient();
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'ohne Ziel', type: 'number' })).status, 400);
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'Ziel 0', type: 'number', target: 0 })).status, 400);
  const k = (await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'Leads', type: 'number', target: 50 })).body;
  assert.equal(k.achieved, false);
  assert.equal((await a('PUT', `/api/kpis/${k.id}`, { target: 0 })).status, 400);
  const done = (await a('POST', `/api/kpis/${k.id}/value`, { value: 50 })).body;
  assert.equal(done.achieved, true);
  assert.ok(done.achievedAt, 'Datum beim Erreichen gesetzt');
  // Ja/Nein braucht keinen Zielwert
  assert.equal((await a('POST', '/api/kpis', { ressortId: 'r-marketing', title: 'Go-live', type: 'bool' })).body.achieved, false);
});

test('Migration: Anzahl mit Ziel 0 gilt nicht mehr als erreicht', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'okr-test-'));
  fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
    events: [{ id: 'e1', name: 'Alt' }], ressorts: [{ id: 'r1', eventId: 'e1', name: 'Team', color: '#000' }],
    kpis: [{ id: 'k0', eventId: 'e1', ressortId: 'r1', title: 'x', type: 'number', target: 0, current: 0, achieved: true, achievedAt: null, deps: [], history: [] }],
  }));
  const { store } = await createApp({ dataDir: dir, log: () => {} });
  try {
    assert.equal(store.state.kpis[0].achieved, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Bearbeiten speichert Ist-Wert, Erreichung und Kommentar mit Historie', async () => {
  const a = await adminClient();
  const k = (await a('POST', '/api/kpis', { ressortId: 'r-programm', title: 'Workshops', type: 'number', target: 10 })).body;
  let r = await a('PUT', `/api/kpis/${k.id}`, { current: 10, achievedAt: '2026-10-30', note: 'Alle geplant' });
  assert.equal(r.body.achieved, true);
  assert.equal(r.body.achievedAt, '2026-10-30');
  assert.equal(r.body.history[0].kind, 'Wert aktualisiert');
  assert.equal(r.body.history[0].note, 'Alle geplant');
  r = await a('PUT', `/api/kpis/${k.id}`, { note: 'Nur ein Kommentar' });
  assert.equal(r.body.history[0].kind, 'Kommentar');
  assert.equal((await a('PUT', `/api/kpis/${k.id}`, { current: 'abc' })).status, 400);
  const b = (await a('POST', '/api/kpis', { ressortId: 'r-programm', title: 'Agenda online', type: 'bool' })).body;
  r = await a('PUT', `/api/kpis/${b.id}`, { achieved: true, achievedAt: '2026-10-31' });
  assert.equal(r.body.achieved, true);
  assert.equal(r.body.achievedAt, '2026-10-31');
  assert.equal(r.body.history[0].kind, 'Erreichung eingetragen');
  r = await a('PUT', `/api/kpis/${b.id}`, { achieved: false });
  assert.equal(r.body.achievedAt, null);
  // Abgelehnte Anfrage ändert nichts
  const before = (await a('GET', '/api/state')).body.kpis.find((x) => x.id === k.id);
  assert.equal((await a('PUT', `/api/kpis/${k.id}`, { title: 'Neu', target: 0 })).status, 400);
  assert.equal((await a('GET', '/api/state')).body.kpis.find((x) => x.id === k.id).title, before.title);
});

test('Löschen archiviert nur; Admins stellen wieder her', async () => {
  const a = await adminClient();
  const k = (await a('POST', '/api/kpis', { ressortId: 'r-technik', title: 'WLAN getestet', type: 'bool', deps: ['k-location'] })).body;
  const m = await member(a, 'r-technik');
  assert.equal((await m('DELETE', `/api/kpis/${k.id}`)).status, 403, 'Mitglieder archivieren nicht');
  const arch = await a('DELETE', `/api/kpis/${k.id}`);
  assert.equal(arch.status, 200);
  assert.ok(arch.body.archivedAt);
  assert.equal(arch.body.history[0].kind, 'Archiviert');
  let st = (await a('GET', '/api/state')).body;
  assert.ok(st.kpis.some((x) => x.id === k.id), 'bleibt in den Daten');
  assert.equal((await a('PUT', `/api/kpis/${k.id}`, { title: 'x' })).status, 400, 'archiviert = nicht bearbeitbar');
  assert.equal((await m('POST', `/api/kpis/${k.id}/value`, { value: 1 })).status, 400);
  assert.equal((await a('PUT', '/api/kpis/k-stream', { deps: ['k-location', k.id] })).status, 400, 'nicht neu als Voraussetzung wählbar');
  assert.equal((await m('POST', `/api/kpis/${k.id}/restore`)).status, 403);
  const back = await a('POST', `/api/kpis/${k.id}/restore`);
  assert.equal(back.body.archivedAt, null);
  assert.equal(back.body.history[0].kind, 'Wiederhergestellt');
  assert.deepEqual(back.body.deps, ['k-location'], 'Abhängigkeiten bleiben erhalten');
});

test('Ressorts und Events mit Kennzahlen (auch archivierten) lassen sich nicht löschen', async () => {
  const a = await adminClient();
  const ev = (await a('POST', '/api/events', { name: 'Löschtest' })).body;
  const r = (await a('POST', '/api/ressorts', { eventId: ev.id, name: 'Weg damit' })).body;
  const k = (await a('POST', '/api/kpis', { ressortId: r.id, title: 'Rest', type: 'bool' })).body;
  await a('DELETE', `/api/kpis/${k.id}`); // archiviert
  assert.equal((await a('DELETE', `/api/ressorts/${r.id}`)).status, 400);
  assert.equal((await a('DELETE', `/api/events/${ev.id}`)).status, 400);
  const lead = (await a('GET', '/api/state')).body.ressorts.find((x) => x.eventId === ev.id && x.isLead);
  await a('POST', `/api/admin/ressorts/${r.id}/merge`, { intoId: lead.id });
  assert.equal((await a('GET', '/api/state')).body.kpis.find((x) => x.id === k.id).ressortId, lead.id, 'Zusammenführen nimmt archivierte mit');
  const leer = (await a('POST', '/api/ressorts', { eventId: ev.id, name: 'Leer' })).body;
  assert.equal((await a('DELETE', `/api/ressorts/${leer.id}`)).status, 200);
  const ev2 = (await a('POST', '/api/events', { name: 'Leeres Event' })).body;
  assert.equal((await a('DELETE', `/api/events/${ev2.id}`)).status, 200);
  assert.ok(!(await a('GET', '/api/state')).body.ressorts.some((x) => x.eventId === ev2.id), 'Führungsressort geht mit');
});
