// JSON-Datei als Speicher. Der gesamte Zustand liegt im Speicher und wird bei jeder Änderung
// komplett nach DATA_DIR/data.json geschrieben (atomar über .tmp + rename).

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { seedState } from '../seed.js';

export const DATA_VERSION = 2;
export const LEAD_NAME = 'Führung';
export const LEAD_COLOR = '#111827';

export const emptyContent = () => ({ events: [], ressorts: [], kpis: [] });

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
    // Ersetzt nur die Inhalte (Events, Ressorts, Kennzahlen) – Nutzer und Einstellungen bleiben.
    replaceContent(content) {
      Object.assign(state, content);
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

export function leadRessort(state, eventId) {
  return state.ressorts.find((r) => r.eventId === eventId && r.isLead);
}

export function newLeadRessort(eventId) {
  return { id: randomUUID(), eventId, name: LEAD_NAME, lead: '', color: LEAD_COLOR, isLead: true, unreviewed: false, createdAt: new Date().toISOString() };
}

// Bringt ältere Datenstände auf den aktuellen Stand. Muss beliebig oft laufen können.
export function migrate(state) {
  state.events ||= [];
  state.ressorts ||= [];
  state.kpis ||= [];
  state.users ||= [];
  state.sessions ||= [];
  state.settings ||= {};
  if (state.settings.autoApproveUntil === undefined) state.settings.autoApproveUntil = null;

  for (const r of state.ressorts) {
    r.isLead = !!r.isLead;
    r.unreviewed = !!r.unreviewed;
  }
  // v2: Jedes Event hat ein Führungsressort; Kennzahlen auf Event-Ebene wandern dorthin.
  for (const ev of state.events) if (!leadRessort(state, ev.id)) state.ressorts.push(newLeadRessort(ev.id));
  for (const k of state.kpis) if (!k.ressortId) k.ressortId = leadRessort(state, k.eventId)?.id || null;
  // v2: Abhängigkeiten nur innerhalb desselben Ressorts.
  const byId = new Map(state.kpis.map((k) => [k.id, k]));
  for (const k of state.kpis) k.deps = (k.deps || []).filter((d) => d !== k.id && byId.get(d)?.ressortId === k.ressortId);

  state.version = DATA_VERSION;
  return state;
}
