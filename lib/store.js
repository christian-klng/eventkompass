// JSON-Datei als Speicher. Der gesamte Zustand liegt im Speicher und wird bei jeder Änderung
// komplett nach DATA_DIR/data.json geschrieben (atomar über .tmp + rename).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedState } from '../seed.js';

export const DATA_VERSION = 5;
export const LEAD_NAME = 'Führung';
export const LEAD_COLOR = '#111827';
// Beschreibung der Ziele, die die Migration v4 für vorhandene Schlüsselergebnisse anlegt.
export const MIGRATED_OBJECTIVE_NOTE = 'Bei der Umstellung auf Ziele und Schlüsselergebnisse automatisch angelegt. Bitte umbenennen oder die Schlüsselergebnisse auf eigene Ziele verteilen.';

export const emptyContent = () => ({ events: [], ressorts: [], objectives: [], keyResults: [] });

export function createStore(dataDir, { seed = true } = {}) {
  const file = path.join(dataDir, 'data.json');
  fs.mkdirSync(dataDir, { recursive: true });
  const state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : seed ? seedState() : emptyContent();
  migrate(state);
  const store = {
    file,
    state,
    save() {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, file);
    },
    // Ersetzt nur die Inhalte (Events, Ressorts, Ziele, Schlüsselergebnisse) – Nutzer und Einstellungen bleiben.
    replaceContent(content) {
      delete state.kpis;
      Object.assign(state, emptyContent(), content);
      migrate(state);
      for (const u of state.users) {
        if (u.eventId && !state.events.some((e) => e.id === u.eventId)) u.eventId = null;
        if (u.ressortId && !state.ressorts.some((r) => r.id === u.ressortId)) u.ressortId = null;
      }
      store.save();
    },
  };
  store.save();
  return store;
}

// Montag der Woche eines Datums (YYYY-MM-DD, Kalendertage ohne Uhrzeit) – Wochen laufen Montag bis Sonntag.
export function mondayOf(iso = new Date().toISOString().slice(0, 10)) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m[0]) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function leadRessort(state, eventId) {
  return state.ressorts.find((r) => r.eventId === eventId && r.isLead);
}

export function newLeadRessort(eventId) {
  return { id: randomUUID(), eventId, name: LEAD_NAME, color: LEAD_COLOR, isLead: true, unreviewed: false, createdAt: new Date().toISOString() };
}

// Bringt ältere Datenstände auf den aktuellen Stand. Muss beliebig oft laufen können.
export function migrate(state) {
  state.events ||= [];
  state.ressorts ||= [];
  state.objectives ||= [];
  // v4: „Kennzahlen“ (kpis) heißen jetzt Schlüsselergebnisse (keyResults) und hängen an Zielen.
  state.keyResults ||= [];
  if (Array.isArray(state.kpis)) { state.keyResults.push(...state.kpis); delete state.kpis; }
  state.users ||= [];
  state.sessions ||= [];
  state.invites ||= [];
  state.settings ||= {};
  if (state.settings.autoApproveUntil === undefined) state.settings.autoApproveUntil = null;

  // v5: Wochenzählung für den Pflege-Check – Standard ist die Woche der Umstellung.
  for (const ev of state.events) if (!ev.trackingStart) ev.trackingStart = mondayOf();

  for (const r of state.ressorts) {
    delete r.lead; // Ressort-Leitung entfällt – wer pflegt, ergibt sich aus der Nutzer-Zuordnung
    r.isLead = !!r.isLead;
    r.unreviewed = !!r.unreviewed;
  }
  // v2: Jedes Event hat ein Führungsressort; Kennzahlen auf Event-Ebene wandern dorthin.
  for (const ev of state.events) if (!leadRessort(state, ev.id)) state.ressorts.push(newLeadRessort(ev.id));
  for (const k of state.keyResults) if (!k.ressortId) k.ressortId = leadRessort(state, k.eventId)?.id || null;
  // v2: Abhängigkeiten nur innerhalb desselben Ressorts.
  const byId = new Map(state.keyResults.map((k) => [k.id, k]));
  for (const k of state.keyResults) k.deps = (k.deps || []).filter((d) => d !== k.id && byId.get(d)?.ressortId === k.ressortId);
  // v3: Nur noch zwei Typen. Meilenstein → Ja/Nein; Anzahl + Datum → Anzahl (erreicht, sobald das Ziel erreicht ist).
  for (const k of state.keyResults) {
    if (k.type === 'date') k.type = 'bool';
    if (k.type === 'combo') {
      k.type = 'number';
      k.achieved = Number(k.current) >= Number(k.target);
      k.achievedAt = k.achieved ? k.achievedAt || (k.history?.[0]?.at || new Date().toISOString()).slice(0, 10) : null;
    }
    delete k.achievedFlag;
    k.archivedAt ??= null; // „Löschen“ archiviert nur
    k.archivedBy ??= null;
    k.history ||= [];
    // Anzahl ohne Zielwert (früher als 0 gespeichert) ist nie erreicht.
    if (k.type === 'number' && !(Number(k.target) > 0)) { k.achieved = false; k.achievedAt = null; }
  }
  // v4: Ziele. Jedes Schlüsselergebnis gehört zu genau einem Ziel; das Ziel bestimmt das Ressort.
  for (const o of state.objectives) {
    o.description ??= '';
    o.deadline ??= null;
    o.archivedAt ??= null;
    o.archivedBy ??= null;
  }
  const objById = new Map(state.objectives.map((o) => [o.id, o]));
  for (const k of state.keyResults) {
    const o = objById.get(k.objectiveId);
    if (o) { k.ressortId = o.ressortId; k.eventId = o.eventId; continue; }
    // Ohne (gültiges) Ziel: ein Start-Ziel je Ressort, benannt nach dem Ressort.
    const r = state.ressorts.find((x) => x.id === k.ressortId) || leadRessort(state, k.eventId);
    if (!r) continue;
    k.ressortId = r.id;
    let start = state.objectives.find((x) => x.ressortId === r.id && x.description === MIGRATED_OBJECTIVE_NOTE && !x.archivedAt);
    if (!start) {
      start = { id: randomUUID(), eventId: r.eventId, ressortId: r.id, title: r.name, description: MIGRATED_OBJECTIVE_NOTE, deadline: null, archivedAt: null, archivedBy: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      state.objectives.push(start);
      objById.set(start.id, start);
    }
    k.objectiveId = start.id;
  }

  state.version = DATA_VERSION;
  return state;
}
