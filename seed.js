// Demo-Daten für den ersten Start. Werden nur geschrieben, wenn noch keine data.json existiert.
export function seedState() {
  const ev = { id: 'ev-summit-2027', name: 'Summit 2027', startDate: '2027-03-15', endDate: '2027-03-16', createdAt: '2026-09-01T09:00:00.000Z' };
  const R = (id, name, lead, color) => ({ id, eventId: ev.id, name, lead, color, createdAt: '2026-09-01T09:00:00.000Z' });
  const ressorts = [
    R('r-marketing', 'Marketing', 'Lena Hartmann', '#2563EB'),
    R('r-sponsoring', 'Sponsoring', 'Jonas Weber', '#7C3AED'),
    R('r-programm', 'Programm', 'Aylin Demir', '#DB2777'),
    R('r-technik', 'Technik & Location', 'Marco Brandt', '#0F766E'),
    R('r-teilnehmer', 'Teilnehmermanagement', 'Sara Köhler', '#B45309'),
  ];
  const H = (at, who, from, to, note = '', kind = 'Wert aktualisiert') => ({ id: 'h-' + Math.random().toString(36).slice(2, 8), at: at + 'T10:00:00.000Z', who, from, to, note, kind });
  const K = (id, ressortId, title, type, target, current, unit, deadline, achievedAt, deps, history) => ({
    id, eventId: ev.id, ressortId, title, description: '', type, target, current, unit, deadline,
    achieved: !!achievedAt, achievedFlag: !!achievedAt, achievedAt: achievedAt || null, deps, history,
    createdAt: '2026-09-01T09:00:00.000Z', updatedAt: history[0] ? history[0].at : '2026-09-01T09:00:00.000Z',
  });
  const kpis = [
    K('k-tickets', null, 'Verkaufte Tickets', 'number', 1200, 860, 'Tickets', '2027-03-14', null, ['k-reach', 'k-earlybird', 'k-shop', 'k-reg'],
      [H('2026-10-28', 'Lena H.', '790 Tickets', '860 Tickets', 'Early-Bird-Welle 2 läuft gut.'), H('2026-10-14', 'Lena H.', '610 Tickets', '790 Tickets'), H('2026-09-01', 'Christian K.', '–', '1.200 Tickets', 'Ziel festgelegt', 'Ziel gesetzt')]),
    K('k-sponsoring', null, 'Sponsoring-Volumen', 'number', 150000, 110000, '€', '2027-01-31', null, ['k-deck', 'k-gold'],
      [H('2026-10-22', 'Jonas W.', '85.000 €', '110.000 €', 'Zusage Gold-Partner Nr. 2.')]),
    K('k-breakeven', null, 'Break-even erreicht', 'bool', 1, 0, '', '2027-02-28', null, ['k-tickets', 'k-sponsoring'],
      [H('2026-09-01', 'Christian K.', '–', 'Offen', 'Berechnung: 980 Tickets + 120.000 € Sponsoring', 'Ziel gesetzt')]),
    K('k-reach', 'r-marketing', 'Social-Media-Reichweite', 'number', 500000, 320000, 'Impressions', '2027-03-01', null, [],
      [H('2026-10-29', 'Lena H.', '255.000 Impressions', '320.000 Impressions', 'LinkedIn-Kampagne Speaker-Announcements.')]),
    K('k-newsletter', 'r-marketing', 'Newsletter-Abonnenten', 'number', 8000, 6400, 'Abonnenten', '2027-02-15', null, [],
      [H('2026-10-27', 'Lena H.', '6.100 Abonnenten', '6.400 Abonnenten')]),
    K('k-earlybird', 'r-marketing', 'Early-Bird-Kampagne gestartet', 'date', 1, 1, '', '2026-09-15', '2026-09-15', [],
      [H('2026-09-15', 'Lena H.', 'Offen', 'Erreicht am 2026-09-15', 'Kampagne live, Landingpage online.', 'Erreichung eingetragen')]),
    K('k-shop', 'r-technik', 'Ticketshop live', 'bool', 1, 1, '', '2026-09-01', '2026-08-29', ['k-location'],
      [H('2026-08-29', 'Marco B.', 'Offen', 'Erreicht am 2026-08-29', 'Zahlungsanbieter angebunden, Testkäufe OK.', 'Erreichung eingetragen')]),
    K('k-deck', 'r-sponsoring', 'Sponsoring-Deck finalisiert', 'bool', 1, 1, '', '2026-08-31', '2026-08-20', [],
      [H('2026-08-20', 'Jonas W.', 'Offen', 'Erreicht am 2026-08-20', '', 'Erreichung eingetragen')]),
    K('k-gold', 'r-sponsoring', 'Gold-Sponsoren gewonnen', 'combo', 4, 2, 'Sponsoren', '2026-12-15', null, ['k-deck'],
      [H('2026-10-22', 'Jonas W.', '1 Sponsoren', '2 Sponsoren', 'Vertrag mit zweitem Partner unterschrieben.')]),
    K('k-speaker', 'r-programm', 'Speaker bestätigt', 'combo', 24, 17, 'Speaker', '2026-12-15', null, ['k-cfp'],
      [H('2026-10-30', 'Aylin D.', '14 Speaker', '17 Speaker', 'Drei Zusagen aus dem CfP-Nachrücker-Pool.')]),
    K('k-cfp', 'r-programm', 'Call for Papers geschlossen', 'date', 1, 1, '', '2026-10-15', '2026-10-17', [],
      [H('2026-10-17', 'Aylin D.', 'Offen', 'Erreicht am 2026-10-17', 'Zwei Tage verlängert – 142 Einreichungen.', 'Erreichung eingetragen')]),
    K('k-keynote', 'r-programm', 'Keynote bestätigt', 'bool', 1, 0, '', '2026-11-30', null, [],
      [H('2026-10-24', 'Aylin D.', 'Offen', 'Offen', 'Zweites Gespräch mit Wunschkandidatin am 05.11.', 'Kommentar')]),
    K('k-location', 'r-technik', 'Location-Vertrag unterzeichnet', 'bool', 1, 1, '', '2026-06-30', '2026-06-24', [],
      [H('2026-06-24', 'Marco B.', 'Offen', 'Erreicht am 2026-06-24', '', 'Erreichung eingetragen')]),
    K('k-stream', 'r-technik', 'Streaming-Setup getestet', 'bool', 1, 0, '', '2027-02-15', null, ['k-location'], []),
    K('k-catering', 'r-teilnehmer', 'Catering-Angebote eingeholt', 'number', 3, 2, 'Angebote', '2026-11-15', null, ['k-location'],
      [H('2026-10-21', 'Sara K.', '1 Angebote', '2 Angebote')]),
    K('k-reg', 'r-teilnehmer', 'Registrierungs-Workflow live', 'bool', 1, 0, '', '2026-10-20', null, ['k-shop'],
      [H('2026-10-19', 'Sara K.', 'Offen', 'Offen', 'Verzögert: DSGVO-Freigabe der Teilnehmerdaten fehlt noch.', 'Kommentar')]),
  ];
  return { events: [ev], ressorts, kpis };
}
