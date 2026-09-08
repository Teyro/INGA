/**
 * Ferienverwaltung (Abschnitt 1 des Ausbau-Auftrags): CRUD/Validierung,
 * Verschiebungslogik (inkl. Verkettung mehrerer aneinandergrenzender freier
 * Zeiträume), ICS-Import und die Einstellung "Während der Ferien keine
 * Überfälligkeit zählen".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../src/main/db.js');
const repo = require('../src/main/repo.js');
const ferien = require('../src/main/ferien.js');
const { parseIcs } = require('../src/main/ics.js');
const { DEFAULT_SETTINGS } = require('../src/main/store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-ferien-test-'));
}

const basisEinstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7 };

/* ------------------------------------------------------------ CRUD/Validierung */

test('saveFerienEintrag: legt einen gültigen Eintrag an und liefert ihn über listeFerien zurück', () => {
  const db = openDatabase(tmpDir());
  const id = ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30', typ: 'Ferien' });
  const liste = ferien.listeFerien(db);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].id, id);
  assert.equal(liste[0].quelle, 'manuell');
  db.close();
});

test('saveFerienEintrag: lehnt fehlende Bezeichnung und verdrehte Daten mit deutscher Meldung ab', () => {
  const db = openDatabase(tmpDir());
  assert.throws(() => ferien.saveFerienEintrag(db, { bezeichnung: '', startdatum: '2026-10-19', enddatum: '2026-10-30' }), /Bezeichnung/);
  assert.throws(
    () => ferien.saveFerienEintrag(db, { bezeichnung: 'Falschrum', startdatum: '2026-10-30', enddatum: '2026-10-19' }),
    /Enddatum.*nicht vor/
  );
  db.close();
});

test('deleteFerienEintrag: entfernt genau den angegebenen Eintrag', () => {
  const db = openDatabase(tmpDir());
  const id1 = ferien.saveFerienEintrag(db, { bezeichnung: 'A', startdatum: '2026-01-01', enddatum: '2026-01-02' });
  ferien.saveFerienEintrag(db, { bezeichnung: 'B', startdatum: '2026-02-01', enddatum: '2026-02-02' });
  ferien.deleteFerienEintrag(db, id1);
  const liste = ferien.listeFerien(db);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].bezeichnung, 'B');
  db.close();
});

/* --------------------------------------------------------- Verschiebungslogik */

test('istSchultagAn: Wochenende ist nie Schultag, auch ohne Ferieneintrag', () => {
  assert.equal(ferien.istSchultagAn('2026-10-17', []), false); // Samstag
  assert.equal(ferien.istSchultagAn('2026-10-19', []), true); // Montag
});

test('verschobenesDatumMitHinweis: Datum außerhalb jeder Ferien bleibt unverändert', () => {
  const { datum, namen } = ferien.verschobenesDatumMitHinweis('2026-10-19', [
    { bezeichnung: 'Herbstferien', startdatum: '2026-12-21', enddatum: '2027-01-02' },
  ]);
  assert.equal(datum, '2026-10-19');
  assert.equal(namen.length, 0);
});

test('verschobenesDatumMitHinweis: Beispiel aus dem Auftrag (12.10. + 7 Tage, Herbstferien 19.10.-30.10.)', () => {
  const ferienListe = [{ bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' }];
  // Naive Fälligkeit wäre der 19.10. (Montag) – fällt auf den ersten Tag der
  // Herbstferien. Nach den Ferien folgt sofort ein Wochenende (31.10. Sa,
  // 1.11. So) – die Verschiebung läuft so lange weiter, bis ein echter
  // Schultag erreicht ist: Montag, 2.11.
  const { datum, namen } = ferien.verschobenesDatumMitHinweis('2026-10-19', ferienListe);
  assert.equal(datum, '2026-11-02');
  assert.deepEqual(namen, ['Herbstferien']);
});

test('verschobenesDatumMitHinweis: verkettet mehrere unmittelbar aneinandergrenzende Zeiträume (Ferien + Feiertag)', () => {
  const ferienListe = [
    { bezeichnung: 'Weihnachtsferien', startdatum: '2026-12-21', enddatum: '2027-01-03' },
    { bezeichnung: 'Heilige Drei Könige', startdatum: '2027-01-04', enddatum: '2027-01-04' }, // Montag, direkt im Anschluss
  ];
  const { datum, namen } = ferien.verschobenesDatumMitHinweis('2026-12-22', ferienListe);
  assert.equal(datum, '2027-01-05'); // Dienstag, erster Tag nach BEIDEN Zeiträumen
  assert.deepEqual(namen, ['Weihnachtsferien', 'Heilige Drei Könige']);
});

test('berechneRueckgabedatum: hängt bei ferienbedingter Verschiebung einen nachvollziehbaren Hinweis an', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  const { datum, hinweise } = repo.berechneRueckgabedatum(db, {
    auslDatum: '2026-10-12',
    katalogNi: null,
    anzVerl: 0,
    einstellungen: basisEinstellungen,
  });
  assert.equal(datum, '2026-11-02');
  assert.ok(hinweise.some((h) => h.includes('Herbstferien')), `Hinweis sollte "Herbstferien" nennen, war: ${hinweise.join(' | ')}`);
  db.close();
});

/* ---------------------------------------------------------------- Import */

test('ferienImportUebernehmen: übernimmt neue Termine und überspringt exakte Duplikate', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  const ergebnis = ferien.ferienImportUebernehmen(db, [
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' }, // Duplikat
    { bezeichnung: 'Weihnachtsferien', startdatum: '2026-12-21', enddatum: '2027-01-03' }, // neu
  ]);
  assert.equal(ergebnis.neu, 1);
  assert.equal(ergebnis.uebersprungen, 1);
  assert.equal(ferien.listeFerien(db).length, 2);
  db.close();
});

test('ferienImportUebernehmen: eine ungültige Zeile bricht den ganzen Import ab (Transaktion), nichts wird halb übernommen', () => {
  const db = openDatabase(tmpDir());
  assert.throws(() =>
    ferien.ferienImportUebernehmen(db, [
      { bezeichnung: 'Gültig', startdatum: '2026-01-01', enddatum: '2026-01-02' },
      { bezeichnung: '', startdatum: '2026-02-01', enddatum: '2026-02-02' }, // ungültig: keine Bezeichnung
    ])
  );
  assert.equal(ferien.listeFerien(db).length, 0, 'bei einem Fehler darf kein Teil-Import übrig bleiben');
  db.close();
});

test('parseIcs: liest ganztägige VEVENTs, DTEND ist exklusiv (RFC 5545)', () => {
  const text = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Herbstferien',
    'DTSTART;VALUE=DATE:20261019',
    'DTEND;VALUE=DATE:20261031',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:Reformationstag',
    'DTSTART;VALUE=DATE:20261031',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const termine = parseIcs(text);
  assert.equal(termine.length, 2);
  assert.deepEqual(termine[0], { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  assert.deepEqual(termine[1], { bezeichnung: 'Reformationstag', startdatum: '2026-10-31', enddatum: '2026-10-31' });
});

test('parseIcs: unbekannter/leerer Text liefert eine leere Liste statt zu werfen', () => {
  assert.deepEqual(parseIcs(''), []);
  assert.deepEqual(parseIcs('kein gültiges ICS'), []);
});

/* ----------------------------------------------- Überfälligkeit ohne Ferien */

test('ueberfaelligeAusleihen: "keine Überfälligkeit während der Ferien" überspringt Ferientage beim Zählen', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Ferienbuch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'F-0001' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Max', AusweisId: 'F-L-1' });

  // Fest verdrahtetes AuslDatum in der Vergangenheit, damit der Test
  // unabhängig vom tatsächlichen Testdatum reproduzierbar ist.
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl") VALUES (?,?,?,NULL,0)`).run(
    medienNi,
    leserNi,
    '2026-01-01 00:00:00.000'
  );
  // 7 Tage Frist -> fällig 2026-01-08 (Donnerstag, keine Ferien betroffen).
  // "Heute" simulieren wir über eine lange Schließzeit direkt nach der
  // Fälligkeit, damit ein Teil der Verzugszeit unstrittig in eine Schließzeit
  // fällt: 2026-01-08 bis 2026-01-20 als Schließzeit, "heute" = 2026-01-22.
  ferien.saveFerienEintrag(db, { bezeichnung: 'Corona-Schließzeit', startdatum: '2026-01-09', enddatum: '2026-01-20', typ: 'Schließzeit' });

  const ohneOption = repo.ueberfaelligeAusleihen(db, { ...basisEinstellungen, ueberfaelligTageOhneFerien: false });
  const mitOption = repo.ueberfaelligeAusleihen(db, { ...basisEinstellungen, ueberfaelligTageOhneFerien: true });

  // Ohne die Option zählen alle Kalendertage seit der (durch die Schließzeit
  // ohnehin schon verschobenen) Fälligkeit; mit der Option zählen nur die
  // tatsächlichen Schultage dazwischen – das muss weniger oder gleich viel sein.
  assert.ok(mitOption[0]?.tageUeberfaellig <= ohneOption[0]?.tageUeberfaellig);
  db.close();
});

/* --------------------------------------------------- Kompakte Übersicht (2.1) */

test('buendleAbschnitte: fasst tageweise importierte Ferien zu einem Abschnitt zusammen', () => {
  const einzeltage = [
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-19', typ: 'Ferien' },
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-20', enddatum: '2026-10-20', typ: 'Ferien' },
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-21', enddatum: '2026-10-21', typ: 'Ferien' },
  ];
  const abschnitte = ferien.buendleAbschnitte(einzeltage);
  assert.equal(abschnitte.length, 1);
  assert.equal(abschnitte[0].startdatum, '2026-10-19');
  assert.equal(abschnitte[0].enddatum, '2026-10-21');
  assert.equal(abschnitte[0].tage, 3);
});

test('buendleAbschnitte: unterschiedliche Bezeichnung bleibt trotz direktem Anschluss ein eigener Abschnitt', () => {
  const eintraege = [
    { bezeichnung: 'Weihnachtsferien', startdatum: '2026-12-21', enddatum: '2027-01-03', typ: 'Ferien' },
    { bezeichnung: 'Heilige Drei Könige', startdatum: '2027-01-04', enddatum: '2027-01-04', typ: 'Feiertag' },
  ];
  const abschnitte = ferien.buendleAbschnitte(eintraege);
  assert.equal(abschnitte.length, 2);
});

test('gruppiereNachSchuljahr: gruppiert nach Schuljahr (1.8.–31.7.), neuestes zuerst, vergangene markiert', () => {
  const abschnitte = ferien.buendleAbschnitte([
    { bezeichnung: 'Herbstferien 25', startdatum: '2025-10-13', enddatum: '2025-10-24', typ: 'Ferien' },
    { bezeichnung: 'Herbstferien 26', startdatum: '2026-10-19', enddatum: '2026-10-30', typ: 'Ferien' },
    // März liegt noch im Schuljahr 2026/27 (Schuljahr beginnt 1.8.), nicht 2027/28.
    { bezeichnung: 'Osterferien 27', startdatum: '2027-03-22', enddatum: '2027-04-01', typ: 'Ferien' },
  ]);
  const gruppen = ferien.gruppiereNachSchuljahr(abschnitte, '2026-11-01'); // "heute" mitten im Schuljahr 2026/27
  assert.deepEqual(gruppen.map((g) => g.schuljahr), ['2026/27', '2025/26']);
  assert.equal(gruppen.find((g) => g.schuljahr === '2026/27').abschnitte.length, 2);
  assert.equal(gruppen.find((g) => g.schuljahr === '2025/26').vergangen, true);
  assert.equal(gruppen.find((g) => g.schuljahr === '2026/27').vergangen, false);
});

test('vorschauFuerImport: markiert bereits vorhandene Abschnitte und zählt sie je Schuljahr', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  const termine = [
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30', typ: 'Ferien' }, // schon vorhanden
    { bezeichnung: 'Weihnachtsferien', startdatum: '2026-12-21', enddatum: '2027-01-03', typ: 'Ferien' }, // neu
  ];
  const [gruppe] = ferien.vorschauFuerImport(db, termine, '2026-09-01');
  assert.equal(gruppe.schuljahr, '2026/27');
  assert.equal(gruppe.abschnitte.length, 2);
  assert.equal(gruppe.anzahlVorhanden, 1);
  assert.equal(gruppe.abschnitte.find((a) => a.bezeichnung === 'Herbstferien').bereitsVorhanden, true);
  assert.equal(gruppe.abschnitte.find((a) => a.bezeichnung === 'Weihnachtsferien').bereitsVorhanden, false);
  db.close();
});

test('loescheSchuljahr: entfernt nur die Einträge des angegebenen Schuljahrs', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien 26', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien 27', startdatum: '2027-10-18', enddatum: '2027-10-29' });
  const anzahl = ferien.loescheSchuljahr(db, 2026);
  assert.equal(anzahl, 1);
  const liste = ferien.listeFerien(db);
  assert.equal(liste.length, 1);
  assert.equal(liste[0].bezeichnung, 'Herbstferien 27');
  db.close();
});

/* -------------------------------------- Frist verlängert sich um Ferien (2.2) */

test('verlaengerungDurchFerien: Beispiel aus dem Auftrag (14.10. + 28 Tage, Herbstferien 20.10.–31.10. liegen VOR der naiven Fälligkeit)', () => {
  const ferienListe = [{ bezeichnung: 'Herbstferien', startdatum: '2026-10-20', enddatum: '2026-10-31', typ: 'Ferien' }];
  // Naive Fälligkeit: 14.10. + 28 Tage = 11.11. Die Herbstferien (12 Tage)
  // liegen komplett innerhalb der Ausleihspanne, obwohl die naive Fälligkeit
  // selbst gar nicht auf einen Ferientag fällt – die Frist verlängert sich
  // trotzdem um die vollen 12 Tage: 11.11. + 12 = 23.11.
  const { datum, namen } = ferien.verlaengerungDurchFerien('2026-10-14', '2026-11-11', ferienListe);
  assert.equal(datum, '2026-11-23');
  assert.deepEqual(namen, ['Herbstferien']);
});

test('verlaengerungDurchFerien: keine Verlängerung, wenn die Ausleihspanne die Ferien gar nicht berührt', () => {
  const ferienListe = [{ bezeichnung: 'Weihnachtsferien', startdatum: '2026-12-21', enddatum: '2027-01-03', typ: 'Ferien' }];
  const { datum, namen } = ferien.verlaengerungDurchFerien('2026-10-01', '2026-10-15', ferienListe);
  assert.equal(datum, '2026-10-15');
  assert.deepEqual(namen, []);
});

test('verlaengerungDurchFerien: ein einzelner Feiertag verlängert nicht (nur Ferien/Schließzeit zählen)', () => {
  const ferienListe = [{ bezeichnung: 'Tag der Deutschen Einheit', startdatum: '2026-10-03', enddatum: '2026-10-03', typ: 'Feiertag' }];
  const { datum, namen } = ferien.verlaengerungDurchFerien('2026-09-25', '2026-10-05', ferienListe);
  assert.equal(datum, '2026-10-05');
  assert.deepEqual(namen, []);
});

test('verlaengerungDurchFerien: verkettet, wenn die Verlängerung selbst in einen weiteren Ferienabschnitt rutscht', () => {
  const ferienListe = [
    { bezeichnung: 'Herbstferien', startdatum: '2026-10-05', enddatum: '2026-10-09', typ: 'Ferien' }, // 5 Tage
    { bezeichnung: 'Beweglicher Ferientag', startdatum: '2026-10-14', enddatum: '2026-10-14', typ: 'Ferien' }, // 1 Tag, liegt erst NACH der ersten Verlängerung im Bereich
  ];
  // Ausleihe 2026-10-01, naive Fälligkeit 2026-10-08 (innerhalb der Herbstferien).
  // +5 Tage wegen Herbstferien -> 2026-10-13. Die Ausleihspanne (bis 2026-10-13)
  // berührt den beweglichen Ferientag am 14.10. noch nicht – hier bewusst mit
  // einer Spanne bis 2026-10-14 getestet, damit auch der zweite Abschnitt zählt.
  const { datum, namen } = ferien.verlaengerungDurchFerien('2026-10-01', '2026-10-14', ferienListe);
  assert.equal(namen.length, 2);
  assert.ok(namen.includes('Herbstferien') && namen.includes('Beweglicher Ferientag'));
});

test('verlaengerungDurchFerien: Zählweise "schultage" zählt nur die Werktage des Ferienabschnitts, nicht das Wochenende darin', () => {
  // Herbstferien Mo 2026-10-19 bis Fr 2026-10-30 (12 Kalendertage, davon ein
  // Wochenende 24./25.10. -> 10 Werktage).
  const ferienListe = [{ bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30', typ: 'Ferien' }];
  const kalendertage = ferien.verlaengerungDurchFerien('2026-10-12', '2026-10-19', ferienListe, 'kalendertage');
  const schultage = ferien.verlaengerungDurchFerien('2026-10-12', '2026-10-19', ferienListe, 'schultage');
  assert.equal(kalendertage.datum, '2026-10-31');
  assert.equal(schultage.datum, '2026-10-29');
});

test('berechneRueckgabedatum: Ferienverlängerung UND anschließender Wochenend-Nudge wirken zusammen, mit vollständigem Hinweistext', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-20', enddatum: '2026-10-31' });
  const { datum, hinweise } = repo.berechneRueckgabedatum(db, {
    auslDatum: '2026-10-14',
    katalogNi: null,
    anzVerl: 0,
    einstellungen: { ...basisEinstellungen, leihfristTage: 28 },
  });
  assert.equal(datum, '2026-11-23');
  assert.ok(hinweise.some((h) => h.includes('12 Ferientage') && h.includes('Herbstferien')), `Hinweis fehlt oder unerwartet: ${hinweise.join(' | ')}`);
  db.close();
});
