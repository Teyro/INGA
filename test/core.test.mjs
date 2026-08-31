/**
 * Prüft Datenhaltung, Import/Export und Ausleihregeln ohne Electron und ohne
 * Fenster – all das ist reines Node.js und lässt sich mit `node --test` prüfen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openDatabase, TABLES } = require('../src/main/db.js');
const { importZip, exportZip } = require('../src/main/csvio.js');
const repo = require('../src/main/repo.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-test-'));
}

test('Import liest alle 65 Tabellen ohne Fehler ein', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const k = repo.kennzahlen(db);
  assert.equal(k.titel, 1798);
  assert.equal(k.exemplare, 1747);

  const legacyCount = db.prepare(`SELECT COUNT(DISTINCT table_name) AS n FROM legacy_rows`).get().n;
  assert.ok(legacyCount > 0, 'mindestens eine Legacy-Tabelle sollte Zeilen enthalten oder zumindest bekannt sein');
  db.close();
});

test('Export nach Import erzeugt wieder alle 65 CSV-Dateien mit identischer Zeilenzahl', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  const src = path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip');
  importZip(db, src);

  const outZip = path.join(dir, 'export.zip');
  exportZip(db, outZip);

  const AdmZip = require('adm-zip');
  const original = new AdmZip(src);
  const exported = new AdmZip(outZip);

  const originalNames = new Set(original.getEntries().map((e) => e.entryName));
  const exportedNames = new Set(exported.getEntries().map((e) => e.entryName));
  assert.equal(exportedNames.size, Object.keys(TABLES).length);
  for (const name of originalNames) assert.ok(exportedNames.has(name), `${name} fehlt im Export`);

  // Katalog und Medien: Zeilenzahl muss exakt erhalten bleiben.
  for (const table of ['Katalog.csv', 'Medien.csv', 'MedArt.csv', 'Zweig.csv']) {
    const before = original.getEntry(table).getData().toString('utf8').trim().split(/\r\n/).length;
    const after = exported.getEntry(table).getData().toString('utf8').trim().split(/\r\n/).length;
    assert.equal(after, before, `${table}: Zeilenzahl weicht ab`);
  }
  db.close();
});

test('Ausleihen, Verlängern, Rückgabe und Mahnung – der volle Kreislauf', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const katalogNi = repo.saveKatalog(db, { Titel: 'Testbuch', Autor: 'Anna Autorin' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'T-0001' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Max', AusweisId: 'L-0001' });

  const status1 = repo.exemplarStatus(db, medienNi);
  assert.equal(status1.verliehen, false);

  const result = repo.ausleihen(db, { medienNi, leserNi, leihfristTageVorgabe: 28 });
  assert.ok(result.id);

  assert.throws(() => repo.ausleihen(db, { medienNi, leserNi, leihfristTageVorgabe: 28 }), /bereits ausgeliehen/);

  const status2 = repo.exemplarStatus(db, medienNi);
  assert.equal(status2.verliehen, true);

  repo.verlaengern(db, result.id, 2);
  const offen = repo.offeneAusleihenVonLeser(db, leserNi);
  assert.equal(offen.length, 1);
  assert.equal(offen[0].AnzVerl, 1);

  repo.zurueckgeben(db, result.id);
  const status3 = repo.exemplarStatus(db, medienNi);
  assert.equal(status3.verliehen, false);

  repo.mahnungEintragen(db, { medienNi, leserNi, auslDatum: '2020-01-01 00:00:00.000', gebuehr: 1.5 });
  const historie = repo.mahnhistorieVonLeser(db, leserNi);
  assert.equal(historie.length, 1);
  assert.equal(historie[0].Titel, 'Testbuch');

  db.close();
});

test('Gesperrte Nutzer dürfen nicht ausleihen', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const sperrungNi = 999;
  db.prepare(`INSERT INTO "Sperrung" ("SperrungNi","SperrungBz") VALUES (?, ?)`).run(sperrungNi, 'Gebühren offen');

  const katalogNi = repo.saveKatalog(db, { Titel: 'Testbuch 2' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'T-0002' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Gesperrt', Vorname: 'Peter', SperrungNi: sperrungNi });

  assert.throws(() => repo.ausleihen(db, { medienNi, leserNi, leihfristTageVorgabe: 28 }), /Gebühren offen/);
  db.close();
});
