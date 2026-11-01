// OKR Event-Tracker – kleiner Express-Server mit JSON-Datei als Speicher.
// Bewusst ohne Datenbank: für eine erste lokale Testversion reicht eine Datei,
// die unter DATA_DIR (Standard: ./data) liegt und als Docker-Volume gemountet wird.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { seedState } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'data.json');

// ---------- Speicher ----------
let state;
function load() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(DATA_FILE)) {
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } else {
    state = process.env.SEED === 'false' ? { events: [], ressorts: [], kpis: [] } : seedState();
    save();
  }
}
function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}
const today = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const find = (list, id) => list.find((x) => x.id === id);

// ---------- Fachlogik ----------
const KPI_TYPES = ['number', 'bool', 'date', 'combo'];

function fmtValue(k, value, achieved, achievedAt) {
  const num = k.type === 'number' || k.type === 'combo';
  const unit = k.unit ? ' ' + k.unit : '';
  const n = num ? Number(value).toLocaleString('de-DE') + unit : '';
  if (achieved) return 'Erreicht am ' + (achievedAt || today()) + (num ? ' (' + n + ')' : '');
  return num ? n : 'Offen';
}

function addHistory(k, entry) {
  k.history.unshift({ id: randomUUID(), at: now(), ...entry });
  k.updatedAt = now();
}

function recomputeAchieved(k) {
  if (k.type === 'number') k.achieved = Number(k.current) >= Number(k.target);
  if (k.type === 'combo') k.achieved = Number(k.current) >= Number(k.target) && !!k.achievedFlag;
  if (!k.achieved) k.achievedAt = null;
}

// ---------- App ----------
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ok = (res, body) => res.json(body);
const bad = (res, msg) => res.status(400).json({ error: msg });
const notFound = (res) => res.status(404).json({ error: 'Nicht gefunden' });

app.get('/api/health', (_req, res) => ok(res, { ok: true, dataFile: DATA_FILE }));
app.get('/api/state', (_req, res) => ok(res, state));

// --- Events ---
app.post('/api/events', (req, res) => {
  const { name, startDate, endDate } = req.body || {};
  if (!name) return bad(res, 'name fehlt');
  const ev = { id: randomUUID(), name, startDate: startDate || null, endDate: endDate || null, createdAt: now() };
  state.events.push(ev);
  save();
  ok(res, ev);
});
app.put('/api/events/:id', (req, res) => {
  const ev = find(state.events, req.params.id);
  if (!ev) return notFound(res);
  const { name, startDate, endDate } = req.body || {};
  if (name !== undefined) ev.name = name;
  if (startDate !== undefined) ev.startDate = startDate;
  if (endDate !== undefined) ev.endDate = endDate;
  save();
  ok(res, ev);
});
app.delete('/api/events/:id', (req, res) => {
  const id = req.params.id;
  if (!find(state.events, id)) return notFound(res);
  const ressortIds = state.ressorts.filter((r) => r.eventId === id).map((r) => r.id);
  state.ressorts = state.ressorts.filter((r) => r.eventId !== id);
  state.kpis = state.kpis.filter((k) => k.eventId !== id && !ressortIds.includes(k.ressortId));
  state.events = state.events.filter((e) => e.id !== id);
  save();
  ok(res, { ok: true });
});

// --- Ressorts ---
app.post('/api/ressorts', (req, res) => {
  const { eventId, name, lead, color } = req.body || {};
  if (!eventId || !find(state.events, eventId)) return bad(res, 'eventId ungültig');
  if (!name) return bad(res, 'name fehlt');
  const r = { id: randomUUID(), eventId, name, lead: lead || '', color: color || '#2563EB', createdAt: now() };
  state.ressorts.push(r);
  save();
  ok(res, r);
});
app.put('/api/ressorts/:id', (req, res) => {
  const r = find(state.ressorts, req.params.id);
  if (!r) return notFound(res);
  for (const f of ['name', 'lead', 'color']) if (req.body[f] !== undefined) r[f] = req.body[f];
  save();
  ok(res, r);
});
app.delete('/api/ressorts/:id', (req, res) => {
  const r = find(state.ressorts, req.params.id);
  if (!r) return notFound(res);
  const removed = state.kpis.filter((k) => k.ressortId === r.id).map((k) => k.id);
  state.kpis = state.kpis.filter((k) => k.ressortId !== r.id);
  state.kpis.forEach((k) => (k.deps = k.deps.filter((d) => !removed.includes(d))));
  state.ressorts = state.ressorts.filter((x) => x.id !== r.id);
  save();
  ok(res, { ok: true });
});

// --- Kennzahlen ---
app.post('/api/kpis', (req, res) => {
  const b = req.body || {};
  if (!b.eventId || !find(state.events, b.eventId)) return bad(res, 'eventId ungültig');
  if (b.ressortId && !find(state.ressorts, b.ressortId)) return bad(res, 'ressortId ungültig');
  if (!b.title) return bad(res, 'title fehlt');
  if (!KPI_TYPES.includes(b.type)) return bad(res, 'type ungültig (' + KPI_TYPES.join(', ') + ')');
  const num = b.type === 'number' || b.type === 'combo';
  const k = {
    id: randomUUID(),
    eventId: b.eventId,
    ressortId: b.ressortId || null,
    title: b.title,
    description: b.description || '',
    type: b.type,
    target: num ? Number(b.target || 0) : 1,
    current: num ? Number(b.current || 0) : 0,
    unit: num ? b.unit || '' : '',
    deadline: b.deadline || null,
    achieved: false,
    achievedFlag: false,
    achievedAt: null,
    deps: Array.isArray(b.deps) ? b.deps.filter((d) => find(state.kpis, d)) : [],
    history: [],
    createdAt: now(),
    updatedAt: now(),
  };
  recomputeAchieved(k);
  addHistory(k, { kind: 'Ziel gesetzt', who: b.who || 'Unbekannt', from: '–', to: num ? fmtValue(k, k.target) : 'Offen', note: b.note || 'Kennzahl angelegt' });
  state.kpis.push(k);
  save();
  ok(res, k);
});

// Stammdaten ändern (Titel, Ziel, Frist, Abhängigkeiten …)
app.put('/api/kpis/:id', (req, res) => {
  const k = find(state.kpis, req.params.id);
  if (!k) return notFound(res);
  const b = req.body || {};
  const changes = [];
  if (b.title !== undefined && b.title !== k.title) { changes.push('Titel'); k.title = b.title; }
  if (b.description !== undefined) k.description = b.description;
  if (b.unit !== undefined) k.unit = b.unit;
  if (b.deadline !== undefined && b.deadline !== k.deadline) { changes.push('Frist ' + (k.deadline || '–') + ' → ' + (b.deadline || '–')); k.deadline = b.deadline; }
  if (b.target !== undefined && Number(b.target) !== Number(k.target)) { changes.push('Ziel ' + k.target + ' → ' + b.target); k.target = Number(b.target); }
  if (b.ressortId !== undefined) k.ressortId = b.ressortId || null;
  if (Array.isArray(b.deps)) {
    const deps = b.deps.filter((d) => d !== k.id && find(state.kpis, d));
    if (JSON.stringify(deps) !== JSON.stringify(k.deps)) changes.push('Abhängigkeiten geändert');
    k.deps = deps;
  }
  recomputeAchieved(k);
  if (changes.length) addHistory(k, { kind: 'Stammdaten geändert', who: b.who || 'Unbekannt', from: '', to: changes.join(' · '), note: b.note || '' });
  save();
  ok(res, k);
});

// Ist-Wert eintragen (Zahl)
app.post('/api/kpis/:id/value', (req, res) => {
  const k = find(state.kpis, req.params.id);
  if (!k) return notFound(res);
  const { value, note, who } = req.body || {};
  if (k.type !== 'number' && k.type !== 'combo') return bad(res, 'Diese Kennzahl hat keinen Zahlenwert');
  const nv = Number(value);
  if (Number.isNaN(nv)) return bad(res, 'value muss eine Zahl sein');
  const from = fmtValue(k, k.current, k.achieved, k.achievedAt);
  const wasAchieved = k.achieved;
  k.current = nv;
  recomputeAchieved(k);
  if (k.achieved && !wasAchieved) k.achievedAt = k.achievedAt || today();
  if (!k.achieved) k.achievedAt = null;
  addHistory(k, { kind: 'Wert aktualisiert', who: who || 'Unbekannt', from, to: fmtValue(k, k.current, k.achieved, k.achievedAt), note: note || '' });
  save();
  ok(res, k);
});

// Ist-Erreichung eintragen (ja/nein, Datum, Anzahl oder Kombination)
app.post('/api/kpis/:id/achieve', (req, res) => {
  const k = find(state.kpis, req.params.id);
  if (!k) return notFound(res);
  const { achieved, achievedAt, value, note, who } = req.body || {};
  const from = fmtValue(k, k.current, k.achieved, k.achievedAt);
  const num = k.type === 'number' || k.type === 'combo';
  if (num && value !== undefined && value !== null && value !== '') {
    const nv = Number(value);
    if (Number.isNaN(nv)) return bad(res, 'value muss eine Zahl sein');
    k.current = nv;
  }
  if (k.type === 'bool' || k.type === 'date') k.achieved = !!achieved;
  if (k.type === 'combo') { k.achievedFlag = !!achieved; recomputeAchieved(k); }
  if (k.type === 'number') recomputeAchieved(k);
  k.achievedAt = k.achieved ? achievedAt || today() : null;
  addHistory(k, { kind: 'Erreichung eingetragen', who: who || 'Unbekannt', from, to: fmtValue(k, k.current, k.achieved, k.achievedAt), note: note || '' });
  save();
  ok(res, k);
});

app.delete('/api/kpis/:id', (req, res) => {
  const k = find(state.kpis, req.params.id);
  if (!k) return notFound(res);
  state.kpis = state.kpis.filter((x) => x.id !== k.id);
  state.kpis.forEach((x) => (x.deps = x.deps.filter((d) => d !== k.id)));
  save();
  ok(res, { ok: true });
});

// Alles zurücksetzen (nur zum Testen)
app.post('/api/reset', (req, res) => {
  state = req.query.empty === '1' ? { events: [], ressorts: [], kpis: [] } : seedState();
  save();
  ok(res, state);
});

load();
app.listen(PORT, () => {
  console.log(`OKR Event-Tracker läuft auf http://localhost:${PORT}  (Daten: ${DATA_FILE})`);
});
