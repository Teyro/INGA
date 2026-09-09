/**
 * Schuljahresende: Kinder einer Klassenstufe, die die Schule verlassen –
 * Meldung ab einen Monat vor den (nächsten eingetragenen) Sommerferien,
 * und das Verschieben mehrerer Kinder auf einmal in den Papierkorb.
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
const { DEFAULT_SETTINGS } = require('../src/main/store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-abschluss-test-'));
}

const einstellungen = { ...DEFAULT_SETTINGS, abschlussKlassenstufe: '4' };

test('abschlussKinder: findet Jahrgänge per Präfix ("4" findet "4a"/"4b", nicht "14" oder "3")', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'A', Vorname: 'A', Jahrgang: '4a' });
  repo.saveLeser(db, { Nachname: 'B', Vorname: 'B', Jahrgang: '4b' });
  repo.saveLeser(db, { Nachname: 'C', Vorname: 'C', Jahrgang: '3c' });
  repo.saveLeser(db, { Nachname: 'D', Vorname: 'D', Jahrgang: '' });

  const kinder = repo.abschlussKinder(db, '4');
  assert.equal(kinder.length, 2);
  assert.deepEqual(kinder.map((k) => k.Nachname).sort(), ['A', 'B']);
  db.close();
});

test('naechsteSommerferien: findet den Eintrag mit "Sommer" im Namen, unabhängig von Groß-/Kleinschreibung', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30' });
  ferien.saveFerienEintrag(db, { bezeichnung: 'SOMMERFERIEN', startdatum: '2027-07-08', enddatum: '2027-08-18' });

  const gefunden = repo.naechsteSommerferien(db, '2027-01-01');
  assert.equal(gefunden?.startdatum, '2027-07-08');
  db.close();
});

test('abschlussMeldung: erscheint erst ab einen Monat vor Beginn der Sommerferien', () => {
  const db = openDatabase(tmpDir());
  ferien.saveFerienEintrag(db, { bezeichnung: 'Sommerferien', startdatum: '2027-07-08', enddatum: '2027-08-18' });
  repo.saveLeser(db, { Nachname: 'Vier', Vorname: 'Kind', Jahrgang: '4a' });

  assert.equal(repo.abschlussMeldung(db, einstellungen, '2027-05-01'), null, 'mehr als einen Monat vorher: noch keine Meldung');
  const meldung = repo.abschlussMeldung(db, einstellungen, '2027-06-10'); // innerhalb des letzten Monats vor Ferienbeginn
  assert.ok(meldung);
  assert.equal(meldung.sommerferienStart, '2027-07-08');
  assert.equal(meldung.kinder.length, 1);
  db.close();
});

test('abschlussMeldung: ohne eingetragene Sommerferien oder ohne betroffene Kinder keine Meldung', () => {
  const db = openDatabase(tmpDir());
  assert.equal(repo.abschlussMeldung(db, einstellungen, '2027-07-01'), null, 'keine Ferien eingetragen');

  ferien.saveFerienEintrag(db, { bezeichnung: 'Sommerferien', startdatum: '2027-07-08', enddatum: '2027-08-18' });
  assert.equal(repo.abschlussMeldung(db, einstellungen, '2027-07-01'), null, 'keine Kinder der Klassenstufe');
  db.close();
});

test('kinderInPapierkorbVerschieben: verschiebt mehrere auf einmal, ein Kind mit offener Ausleihe wird übersprungen statt den Durchgang abzubrechen', () => {
  const db = openDatabase(tmpDir());
  const frei1 = repo.saveLeser(db, { Nachname: 'Frei1', Vorname: 'Kind', Jahrgang: '4a' });
  const frei2 = repo.saveLeser(db, { Nachname: 'Frei2', Vorname: 'Kind', Jahrgang: '4a' });
  const mitAusleihe = repo.saveLeser(db, { Nachname: 'Mit', Vorname: 'Ausleihe', Jahrgang: '4b' });
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'A-1' });
  repo.ausleihen(db, { medienNi, leserNi: mitAusleihe, einstellungen: DEFAULT_SETTINGS });

  const ergebnis = repo.kinderInPapierkorbVerschieben(db, [frei1, frei2, mitAusleihe], 'inga');
  assert.equal(ergebnis.verschoben, 2);
  assert.equal(ergebnis.uebersprungen.length, 1);
  assert.equal(ergebnis.uebersprungen[0].leserNi, mitAusleihe);

  assert.equal(repo.getLeser(db, frei1), undefined);
  assert.equal(repo.getLeser(db, mitAusleihe).LeserNi, mitAusleihe);
  const papierkorb = repo.papierkorbLeserListe(db);
  assert.equal(papierkorb.length, 2);
  db.close();
});
