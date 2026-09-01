/**
 * Erweiterte Filter (Abschnitt 5 des Ausbau-Auftrags): zusätzliche
 * Katalog-Filter (Kategorie, Klassenstufe, Standort, erweiterter Status)
 * und zusätzliche Nutzer-Filter (Klasse, aktive Ausleihen), jeweils
 * vollständig in SQL statt im Speicher.
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
const { DEFAULT_SETTINGS } = require('../src/main/store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-filter-test-'));
}

const basisEinstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7 };

test('searchKatalog: Kategorie (SystemId) und Klassenstufe filtern korrekt', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Systematik" ("SystemId","SystemBz") VALUES ('SACH', 'Sachbuch')`).run();
  repo.saveKatalog(db, { Titel: 'Sachbuch 1', SystemId: 'SACH', Klassenstu: '2' });
  repo.saveKatalog(db, { Titel: 'Roman 1', Klassenstu: '4' });

  const nurSach = repo.searchKatalog(db, { systemId: 'SACH' });
  assert.equal(nurSach.gesamt, 1);
  assert.equal(nurSach.rows[0].Titel, 'Sachbuch 1');

  const nurKlasse2 = repo.searchKatalog(db, { klassenstufe: '2' });
  assert.equal(nurKlasse2.gesamt, 1);
  assert.equal(nurKlasse2.rows[0].Titel, 'Sachbuch 1');
  db.close();
});

test('searchKatalog: Standort filtert über die Exemplare (Medien.StOrtNi)', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "StandOrt" ("StOrtNi","StOrtBz") VALUES (1, 'Regal A')`).run();
  const k1 = repo.saveKatalog(db, { Titel: 'Buch A' });
  repo.saveMedium(db, { KatalogNi: k1, MedienEtik: 'A-1', StOrtNi: 1 });
  const k2 = repo.saveKatalog(db, { Titel: 'Buch B' });
  repo.saveMedium(db, { KatalogNi: k2, MedienEtik: 'B-1' });

  const nurRegalA = repo.searchKatalog(db, { standortNi: 1 });
  assert.equal(nurRegalA.gesamt, 1);
  assert.equal(nurRegalA.rows[0].Titel, 'Buch A');
  db.close();
});

test('searchKatalog: Status "nicht verfügbar" (z. B. vermisst) über Medien.NichtVfNi', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Nichtverf" ("NichtVfNi","NichtVfBz") VALUES (1, 'Vermisst')`).run();
  const k1 = repo.saveKatalog(db, { Titel: 'Vermisstes Buch' });
  repo.saveMedium(db, { KatalogNi: k1, MedienEtik: 'V-1', NichtVfNi: 1 });
  const k2 = repo.saveKatalog(db, { Titel: 'Normales Buch' });
  repo.saveMedium(db, { KatalogNi: k2, MedienEtik: 'N-1' });

  const ergebnis = repo.searchKatalog(db, { verfuegbarkeit: 'nicht_verfuegbar' });
  assert.equal(ergebnis.gesamt, 1);
  assert.equal(ergebnis.rows[0].Titel, 'Vermisstes Buch');
  db.close();
});

test('searchKatalog: Freitextsuche findet auch über Verlag und Signatur/Barcode (Medien.MedienEtik)', () => {
  const db = openDatabase(tmpDir());
  const k1 = repo.saveKatalog(db, { Titel: 'Buch mit Verlag', Verlag: 'Sonderverlag Nord' });
  const k2 = repo.saveKatalog(db, { Titel: 'Buch mit Signatur' });
  repo.saveMedium(db, { KatalogNi: k2, MedienEtik: 'SIG-42' });

  assert.equal(repo.searchKatalog(db, { query: 'Sonderverlag' }).gesamt, 1);
  assert.equal(repo.searchKatalog(db, { query: 'SIG-42' }).gesamt, 1);
  db.close();
});

test('searchKatalog: leere katalogNiIn-Liste liefert "keine Treffer" (Grundlage für den Status-Filter "überfällig")', () => {
  const db = openDatabase(tmpDir());
  repo.saveKatalog(db, { Titel: 'Irgendein Buch' });
  const ergebnis = repo.searchKatalog(db, { katalogNiIn: [] });
  assert.equal(ergebnis.gesamt, 0);
  db.close();
});

test('katalogNiMitUeberfaelligemExemplar: liefert genau die Titel mit überfälligem Exemplar', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Überfälliges Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'UEB-1' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'UEB-L' });
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl") VALUES (?,?,?,NULL,0)`).run(
    medienNi,
    leserNi,
    '2020-01-01 00:00:00.000'
  );
  const treffer = repo.katalogNiMitUeberfaelligemExemplar(db, basisEinstellungen);
  assert.deepEqual(treffer, [katalogNi]);
  db.close();
});

test('searchLeser: Klasse (Jahrgang) filtert exakt', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'A', Vorname: 'Kind', AusweisId: 'K-1', Jahrgang: '4a' });
  repo.saveLeser(db, { Nachname: 'B', Vorname: 'Kind', AusweisId: 'K-2', Jahrgang: '4b' });
  const ergebnis = repo.searchLeser(db, { jahrgang: '4a' });
  assert.equal(ergebnis.gesamt, 1);
  assert.equal(ergebnis.rows[0].Nachname, 'A');
  db.close();
});

test('searchLeser: aktiveAusleihen "0"/"1+" filtert nach offenen Ausleihen', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'AA-1' });
  const leserMitBuch = repo.saveLeser(db, { Nachname: 'Aktiv', Vorname: 'Kind', AusweisId: 'AA-L1' });
  repo.saveLeser(db, { Nachname: 'Inaktiv', Vorname: 'Kind', AusweisId: 'AA-L2' });
  repo.ausleihen(db, { medienNi, leserNi: leserMitBuch, einstellungen: basisEinstellungen });

  const mitAusleihe = repo.searchLeser(db, { aktiveAusleihen: '1+' });
  assert.equal(mitAusleihe.gesamt, 1);
  assert.equal(mitAusleihe.rows[0].Nachname, 'Aktiv');

  const ohneAusleihe = repo.searchLeser(db, { aktiveAusleihen: '0' });
  assert.equal(ohneAusleihe.gesamt, 1);
  assert.equal(ohneAusleihe.rows[0].Nachname, 'Inaktiv');
  db.close();
});

test('distinctJahrgaenge: sortierte, eindeutige, nicht-leere Klassen', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'A', Vorname: 'K', AusweisId: 'J-1', Jahrgang: '4b' });
  repo.saveLeser(db, { Nachname: 'B', Vorname: 'K', AusweisId: 'J-2', Jahrgang: '2a' });
  repo.saveLeser(db, { Nachname: 'C', Vorname: 'K', AusweisId: 'J-3', Jahrgang: '4b' });
  repo.saveLeser(db, { Nachname: 'D', Vorname: 'K', AusweisId: 'J-4', Jahrgang: '' });
  assert.deepEqual(repo.distinctJahrgaenge(db), ['2a', '4b']);
  db.close();
});

test('stammdaten: enthält jetzt auch StandOrt (für den neuen Standort-Filter)', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "StandOrt" ("StOrtNi","StOrtBz") VALUES (1, 'Regal A')`).run();
  const s = repo.stammdaten(db);
  assert.equal(s.StandOrt.length, 1);
  assert.equal(s.StandOrt[0].StOrtBz, 'Regal A');
  db.close();
});
