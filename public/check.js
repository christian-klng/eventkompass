// Pflege-Check: Sind Ziele und Schlüsselergebnisse sauber formuliert und wird jede Woche der Stand eingetragen?
// Reine Funktionen ohne DOM. Im Browser als normales Skript vor app.js geladen, in den Tests per import –
// beide Male steht das Ergebnis unter globalThis.Check.
(() => {
  const DAY = 86400000;
  const MIN_WORDS = 5;
  const MAX_WEEKS = 104;
  // Diese Einträge der Historie zählen als „Stand gepflegt“ (Stammdaten-Änderungen nicht).
  const UPDATE_KINDS = new Set(['Angelegt', 'Wert aktualisiert', 'Erreichung eingetragen', 'Kommentar', 'Stand bestätigt']);

  // Kalendertage als ganze Zahlen (über UTC gerechnet, damit die Sommerzeit keine Tage verschiebt).
  const dayNum = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / DAY; };
  const fromDayNum = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  const weekday = (n) => (new Date(n * DAY).getUTCDay() + 6) % 7; // 0 = Montag … 6 = Sonntag
  const pad = (n) => String(n).padStart(2, '0');
  // Zeitpunkt (ISO mit Uhrzeit) → Kalendertag in der Ortszeit des Browsers; reine Daten bleiben, wie sie sind.
  const localDay = (ts) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const today = () => localDay(new Date().toISOString());

  const mondayOf = (iso) => { const n = dayNum(iso); return fromDayNum(n - weekday(n)); };
  // ISO-Kalenderwoche: die Woche, in der der Donnerstag liegt
  function isoWeek(iso) {
    const n = dayNum(iso);
    const thu = n - weekday(n) + 3;
    const year = new Date(thu * DAY).getUTCFullYear();
    return Math.floor((thu - Date.UTC(year, 0, 1) / DAY) / 7) + 1;
  }

  // Wörter = durch Leerraum getrennt, mit mindestens einem Buchstaben oder einer Ziffer („–“, „&“ zählen nicht).
  const wordCount = (text) => String(text || '').trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

  function objectiveIssue(o) {
    const n = wordCount(o.title);
    if (n >= MIN_WORDS) return null;
    return { key: 'short', label: `${n} von ${MIN_WORDS} Wörtern`, text: `${n === 1 ? 'Nur 1 Wort' : `Nur ${n} Wörter`} – ein Ziel braucht mindestens ${MIN_WORDS} Wörter` };
  }
  function krIssue(k) {
    if (k.type !== 'number') return { key: 'bool', label: 'Ja / Nein', text: 'Ja / Nein ist nicht messbar – als Anzahl mit Zielwert formulieren' };
    if (!(Number(k.target) > 0)) return { key: 'target', label: 'Kein Zielwert', text: 'Kein Zielwert – bitte einen Zielwert größer als 0 angeben' };
    return null;
  }

  // Wochen eines Events ab trackingStart bis zum Eventende (mindestens bis zur laufenden Woche).
  // notStarted: Die Zählung beginnt erst in der Zukunft.
  function eventWeeks(ev, now = today()) {
    const cur = dayNum(mondayOf(now));
    const start = dayNum(mondayOf(ev.trackingStart || now));
    if (start > cur) return { weeks: [], current: null, notStarted: true, start: fromDayNum(start) };
    const end = Math.max(cur, ev.endDate ? dayNum(mondayOf(ev.endDate)) : cur);
    const weeks = [];
    for (let n = start, i = 1; n <= end && i <= MAX_WEEKS; n += 7, i++) {
      const from = fromDayNum(n);
      weeks.push({ index: i, kw: isoWeek(from), from, to: fromDayNum(n + 6), when: n < cur ? 'past' : n === cur ? 'current' : 'future' });
    }
    return { weeks, current: weeks.find((w) => w.when === 'current') || null, notStarted: false, start: fromDayNum(start) };
  }

  // Wann wurde ein Schlüsselergebnis gepflegt? Woche des Anlegens, Wochen mit Wert/Erreichung/Kommentar/Bestätigung
  // und – sobald erreicht – jede Woche ab der Erreichung.
  function maintenance(k) {
    const created = mondayOf(localDay(k.createdAt));
    const updated = new Set([created]);
    for (const h of k.history || []) if (UPDATE_KINDS.has(h.kind)) updated.add(mondayOf(localDay(h.at)));
    const achievedFrom = k.achieved && k.achievedAt ? mondayOf(k.achievedAt) : null;
    return { created, has: (from) => updated.has(from) || (!!achievedFrom && achievedFrom <= from) };
  }
  const isMaintained = (k, week) => !!week && maintenance(k).has(week.from);

  // Zustand je Woche: none (gab es noch nicht) · ok (gepflegt) · stale (nicht aktualisiert) · invalid (Formulierung, nur laufende Woche) · future
  function krWeekStates(k, weeks) {
    const m = maintenance(k);
    const issue = krIssue(k);
    return weeks.map((w) => {
      if (w.when === 'future') return 'future';
      if (w.from < m.created) return 'none';
      if (w.when === 'current' && issue) return 'invalid';
      return m.has(w.from) ? 'ok' : 'stale';
    });
  }

  globalThis.Check = { MIN_WORDS, UPDATE_KINDS, mondayOf, isoWeek, localDay, wordCount, objectiveIssue, krIssue, eventWeeks, isMaintained, krWeekStates };
})();
