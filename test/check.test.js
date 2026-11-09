// Tests für die Prüfregeln des Pflege-Checks (public/check.js) – laufen ohne Browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'Europe/Berlin';
await import('../public/check.js');
const C = globalThis.Check;

test('Wörter zählen', () => {
  assert.equal(C.wordCount('Der Summit trägt sich selbst'), 5);
  assert.equal(C.wordCount('  Reichweite   steigern  '), 2);
  assert.equal(C.wordCount('Tickets – Sponsoring & Partner'), 3, 'Gedankenstrich und & zählen nicht');
  assert.equal(C.wordCount('Break-even 2027 erreichen'), 3, 'Bindestrich-Wort und Zahl zählen je einmal');
  assert.equal(C.wordCount(''), 0);
  assert.equal(C.wordCount(undefined), 0);
  assert.equal(C.objectiveIssue({ title: 'Sponsoren' }).key, 'short');
  assert.equal(C.objectiveIssue({ title: 'Wir gewinnen fünf neue Sponsoren' }), null);
});

test('Schlüsselergebnis quantitativ = Anzahl mit Zielwert', () => {
  assert.equal(C.krIssue({ type: 'number', target: 500 }), null);
  assert.equal(C.krIssue({ type: 'bool', target: 1 }).key, 'bool');
  assert.equal(C.krIssue({ type: 'number', target: 0 }).key, 'target');
});

test('Montag und Kalenderwoche, auch über den Jahreswechsel', () => {
  assert.equal(C.mondayOf('2026-11-09'), '2026-11-09');
  assert.equal(C.mondayOf('2026-11-15'), '2026-11-09', 'Sonntag gehört zur Woche davor');
  assert.equal(C.mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(C.isoWeek('2026-11-09'), 46);
  assert.equal(C.isoWeek('2026-12-31'), 53);
  assert.equal(C.isoWeek('2027-01-03'), 53, '3.1.2027 gehört noch zu KW 53/2026');
  assert.equal(C.isoWeek('2027-01-04'), 1);
  assert.equal(C.mondayOf('2027-03-29'), '2027-03-29', 'Zeitumstellung verschiebt nichts');
});

test('Ortszeit: Sonntag 23:30 und Montag 00:30 liegen in verschiedenen Wochen', () => {
  assert.equal(C.localDay('2026-11-15T22:30:00.000Z'), '2026-11-15'); // 23:30 MEZ
  assert.equal(C.localDay('2026-11-15T23:30:00.000Z'), '2026-11-16'); // 00:30 MEZ
  assert.equal(C.localDay('2026-11-02'), '2026-11-02', 'reines Datum bleibt');
});

test('Wochen eines Events', () => {
  const { weeks, current } = C.eventWeeks({ trackingStart: '2026-11-09', endDate: '2026-12-02' }, '2026-11-18');
  assert.deepEqual(weeks.map((w) => [w.index, w.kw, w.when]), [[1, 46, 'past'], [2, 47, 'current'], [3, 48, 'future'], [4, 49, 'future']]);
  assert.equal(current.from, '2026-11-16');
  assert.equal(current.to, '2026-11-22');
  const noEnd = C.eventWeeks({ trackingStart: '2026-11-09' }, '2026-11-18');
  assert.equal(noEnd.weeks.length, 2, 'ohne Eventende bis zur laufenden Woche');
  const later = C.eventWeeks({ trackingStart: '2026-12-07', endDate: '2027-03-16' }, '2026-11-18');
  assert.equal(later.notStarted, true);
  assert.equal(later.weeks.length, 0);
  const over = C.eventWeeks({ trackingStart: '2026-11-09', endDate: '2026-11-10' }, '2026-11-25');
  assert.equal(over.weeks.length, 3, 'nach dem Eventende weiter bis zur laufenden Woche');
});

test('Zustand je Woche aus der Historie', () => {
  const { weeks } = C.eventWeeks({ trackingStart: '2026-11-02', endDate: '2026-12-01' }, '2026-11-25');
  // W1 2.11. · W2 9.11. · W3 16.11. · W4 23.11. (laufend) · W5 30.11.
  const base = { type: 'number', target: 10, achieved: false, achievedAt: null, createdAt: '2026-11-10T08:00:00.000Z' };
  const k = { ...base, history: [
    { kind: 'Stammdaten geändert', at: '2026-11-18T10:00:00.000Z' }, // zählt nicht
    { kind: 'Angelegt', at: '2026-11-10T08:00:00.000Z' },
  ] };
  assert.deepEqual(C.krWeekStates(k, weeks), ['none', 'ok', 'stale', 'stale', 'future']);
  const confirmed = { ...k, history: [{ kind: 'Stand bestätigt', at: '2026-11-24T09:00:00.000Z' }, ...k.history] };
  assert.deepEqual(C.krWeekStates(confirmed, weeks), ['none', 'ok', 'stale', 'ok', 'future']);
  assert.equal(C.isMaintained(confirmed, weeks[3]), true);
  assert.equal(C.isMaintained(k, weeks[3]), false);
  const comment = { ...k, history: [{ kind: 'Kommentar', at: '2026-11-17T09:00:00.000Z' }, ...k.history] };
  assert.equal(C.krWeekStates(comment, weeks)[2], 'ok');
  const bool = { ...k, type: 'bool', history: [{ kind: 'Erreichung eingetragen', at: '2026-11-24T09:00:00.000Z' }] };
  assert.deepEqual(C.krWeekStates(bool, weeks), ['none', 'ok', 'stale', 'invalid', 'future'], 'rot nur in der laufenden Woche');
  const done = { ...k, achieved: true, achievedAt: '2026-11-17' };
  assert.deepEqual(C.krWeekStates(done, weeks), ['none', 'ok', 'ok', 'ok', 'future'], 'ab der Erreichung gepflegt');
});
