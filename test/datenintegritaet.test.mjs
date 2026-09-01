/**
 * Datenintegrität beim Löschen/Speichern (Abschnitt 7 des Ausbau-Auftrags):
 * Löschen mit laufender Ausleihe, doppelte Barcodes, Pflichtfelder. Alles
 * Regressionstests für konkrete, in der Code-Durchsicht gefundene Lücken.
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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-integritaet-test-'));
}

const einstellungen = { leihfristTage: 7, verlaengerungDauerTage: 7 };

test('deleteMedium: verweigert das Löschen eines ausgeliehenen Exemplars', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'D-1' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'D-L1' });
  repo.ausleihen(db, { medienNi, leserNi, einstellungen });

  assert.throws(() => repo.deleteMedium(db, medienNi), /noch ausgeliehen/);
  assert.ok(repo.exemplarStatus(db, medienNi), 'Exemplar muss weiterhin existieren');
  db.close();
});

test('deleteKatalog: verweigert das Löschen, solange mindestens ein Exemplar ausgeliehen ist', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch mit zwei Exemplaren' });
  const medienNi1 = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'D-2a' });
  repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'D-2b' }); // zweites, nicht ausgeliehenes Exemplar
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'D-L2' });
  repo.ausleihen(db, { medienNi: medienNi1, leserNi, einstellungen });

  assert.throws(() => repo.deleteKatalog(db, katalogNi), /noch ausgeliehen/);
  assert.ok(repo.getKatalog(db, katalogNi), 'Titel muss weiterhin existieren');
  db.close();
});

test('deleteLeser: verweigert das Löschen, solange noch offene Ausleihen bestehen', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'D-3' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'D-L3' });
  repo.ausleihen(db, { medienNi, leserNi, einstellungen });

  assert.throws(() => repo.deleteLeser(db, leserNi), /offene Ausleihen/);
  assert.ok(repo.getLeser(db, leserNi), 'Nutzer muss weiterhin existieren');
  db.close();
});

test('nach Rückgabe lassen sich Exemplar, Titel und Nutzer wieder löschen', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'D-4' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'D-L4' });
  const { id } = repo.ausleihen(db, { medienNi, leserNi, einstellungen });
  repo.zurueckgeben(db, id);

  assert.doesNotThrow(() => repo.deleteMedium(db, medienNi));
  assert.doesNotThrow(() => repo.deleteLeser(db, leserNi));
  db.close();
});

test('saveMedium: lehnt ein doppeltes Etikett/Barcode ab', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'DUP-1' });
  assert.throws(() => repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'DUP-1' }), /wird bereits/);
  db.close();
});

test('saveMedium: das Bearbeiten desselben Exemplars mit unverändertem Etikett bleibt erlaubt', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'DUP-2' });
  assert.doesNotThrow(() => repo.saveMedium(db, { MedienNi: medienNi, KatalogNi: katalogNi, MedienEtik: 'DUP-2', Zustand: 'gut' }));
  db.close();
});

test('saveMedium: lehnt ein leeres Etikett ab', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  assert.throws(() => repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: '' }), /Etikett/);
  db.close();
});

test('saveKatalog/saveLeser: lehnen leere Pflichtfelder ab', () => {
  const db = openDatabase(tmpDir());
  assert.throws(() => repo.saveKatalog(db, { Titel: '' }), /Titel/);
  assert.throws(() => repo.saveLeser(db, { Nachname: '  ' }), /Nachnamen/);
  db.close();
});
