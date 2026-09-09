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
const { DEFAULT_SETTINGS } = require('../src/main/store.js');
const { addTage, heuteISO } = require('../src/main/date-utils.js');

const einstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 28, maxVerlaengerung: 2 };

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

  const result = repo.ausleihen(db, { medienNi, leserNi, einstellungen });
  assert.ok(result.id);

  assert.throws(() => repo.ausleihen(db, { medienNi, leserNi, einstellungen }), /bereits ausgeliehen/);

  const status2 = repo.exemplarStatus(db, medienNi);
  assert.equal(status2.verliehen, true);

  repo.verlaengern(db, result.id, einstellungen);
  const offen = repo.offeneAusleihenVonLeser(db, leserNi);
  assert.equal(offen.length, 1);
  assert.equal(offen[0].AnzVerl, 1);

  repo.zurueckgeben(db, result.id);
  const status3 = repo.exemplarStatus(db, medienNi);
  assert.equal(status3.verliehen, false);

  // Regressionstest: alleOffenenAusleihen() (Rückgabe-Liste, Überfälligkeits-
  // Ermittlung, Umlaufliste) filterte nicht nach "Rueckgabe IS NULL" – eine
  // zurückgegebene Ausleihe blieb dadurch für immer in der Rückgabe-Ansicht
  // stehen und konnte, sobald ihre ursprüngliche Frist in der Vergangenheit
  // lag, sogar dauerhaft als "überfällig" auftauchen.
  assert.equal(
    repo.alleOffenenAusleihen(db).some((a) => a.id === result.id),
    false,
    'eine zurückgegebene Ausleihe darf nicht mehr unter den offenen Ausleihen erscheinen'
  );

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

  assert.throws(() => repo.ausleihen(db, { medienNi, leserNi, einstellungen }), /Gebühren offen/);
  db.close();
});

test('leserSperren: unbefristet gesperrt bleibt gesperrt, bis explizit entsperrt', () => {
  const db = openDatabase(tmpDir());
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tim', AusweisId: 'S-1' });
  assert.equal(repo.leserGesperrt(db, leserNi).gesperrt, false);

  repo.leserSperren(db, leserNi);
  const gesperrt = repo.leserGesperrt(db, leserNi);
  assert.equal(gesperrt.gesperrt, true);
  assert.equal(gesperrt.grund, 'gesperrt');

  repo.leserEntsperren(db, leserNi);
  assert.equal(repo.leserGesperrt(db, leserNi).gesperrt, false);
  db.close();
});

test('leserSperren: befristete Sperre (Tage) läuft von selbst wieder ab', () => {
  const db = openDatabase(tmpDir());
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tina', AusweisId: 'S-2' });

  repo.leserSperren(db, leserNi, { tage: 14 });
  const leser = repo.getLeser(db, leserNi);
  // "für 14 Tage ab heute" -> gesperrt bis einschließlich heute + 13 Tage.
  assert.equal(leser.IngaGesperrtBis, addTage(heuteISO(), 13));
  assert.equal(repo.leserGesperrt(db, leserNi).gesperrt, true);

  // Eine bereits abgelaufene Frist (simuliert: gestern) sperrt nicht mehr.
  db.prepare(`UPDATE "Leser" SET "IngaGesperrtBis" = ? WHERE "LeserNi" = ?`).run(addTage(heuteISO(), -1), leserNi);
  assert.equal(repo.leserGesperrt(db, leserNi).gesperrt, false);
  db.close();
});

test('ausleihen(): eine über leserSperren gesetzte Sperre blockiert die Ausleihe genauso wie SperrungNi', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Testbuch 3' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'T-0003' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Gesperrt', Vorname: 'Petra' });
  repo.leserSperren(db, leserNi, { tage: 7 });
  assert.throws(() => repo.ausleihen(db, { medienNi, leserNi, einstellungen }), /gesperrt/);
  db.close();
});

test('searchLeser: Filter "gesperrt"/"aktiv" berücksichtigt auch die neue Sperre (IngaGesperrt/IngaGesperrtBis)', () => {
  const db = openDatabase(tmpDir());
  const gesperrtNi = repo.saveLeser(db, { Nachname: 'Gesperrt', Vorname: 'Kind', AusweisId: 'F-1' });
  const freiNi = repo.saveLeser(db, { Nachname: 'Frei', Vorname: 'Kind', AusweisId: 'F-2' });
  repo.leserSperren(db, gesperrtNi, { tage: 5 });

  const gesperrt = repo.searchLeser(db, { gesperrt: 'gesperrt' });
  assert.equal(gesperrt.gesamt, 1);
  assert.equal(gesperrt.rows[0].LeserNi, gesperrtNi);

  const aktiv = repo.searchLeser(db, { gesperrt: 'aktiv' });
  assert.equal(aktiv.gesamt, 1);
  assert.equal(aktiv.rows[0].LeserNi, freiNi);
  db.close();
});

test('Ausleihlimit: blockiert ab der eingestellten Anzahl gleichzeitiger Ausleihen, 0 bleibt unbegrenzt', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const leserNi = repo.saveLeser(db, { Nachname: 'Limit', Vorname: 'Lisa' });
  const katalogNi = repo.saveKatalog(db, { Titel: 'Limitbuch' });
  const medien = Array.from({ length: 3 }, (_, i) =>
    repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: `LIM-000${i + 1}` })
  );

  const mitLimit = { ...einstellungen, ausleihLimit: 2 };
  repo.ausleihen(db, { medienNi: medien[0], leserNi, einstellungen: mitLimit });
  repo.ausleihen(db, { medienNi: medien[1], leserNi, einstellungen: mitLimit });
  assert.throws(
    () => repo.ausleihen(db, { medienNi: medien[2], leserNi, einstellungen: mitLimit }),
    /maximal 2 Medien/
  );

  // 0 (Vorgabe) bedeutet unbegrenzt – dieselbe Person darf trotz zweier
  // offener Ausleihen ein drittes Medium ausleihen.
  const ohneLimit = { ...einstellungen, ausleihLimit: 0 };
  const result = repo.ausleihen(db, { medienNi: medien[2], leserNi, einstellungen: ohneLimit });
  assert.ok(result.id);

  db.close();
});

test('Papierkorb: gelöschte Nutzer:innen und Exemplare landen dort und lassen sich wiederherstellen', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const leserNi = repo.saveLeser(db, { Nachname: 'Papier', Vorname: 'Korbina', Jahrgang: '3a' });
  const katalogNi = repo.saveKatalog(db, { Titel: 'Papierkorbbuch', Autor: 'Anna Autorin' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'PK-0001' });

  repo.deleteLeser(db, leserNi, 'testuser');
  assert.equal(repo.getLeser(db, leserNi), undefined, 'Leser sollte aus der Live-Tabelle verschwunden sein');
  let leserPapierkorb = repo.papierkorbLeserListe(db);
  assert.equal(leserPapierkorb.length, 1);
  assert.equal(leserPapierkorb[0].Nachname, 'Papier');
  assert.equal(leserPapierkorb[0].LoeschAnw, 'testuser');

  repo.deleteMedium(db, medienNi, 'testuser');
  let medienPapierkorb = repo.papierkorbMedienListe(db);
  assert.equal(medienPapierkorb.length, 1);
  assert.equal(medienPapierkorb[0].Titel, 'Papierkorbbuch', 'Katalogdaten des Titels müssen mit in den Papierkorb übernommen werden');
  assert.equal(medienPapierkorb[0].MedienEtik, 'PK-0001', 'Exemplar-eigene Felder dürfen nicht von den Katalogdaten überschrieben werden');

  // Wiederherstellen: dieselbe LeserNi/MedienNi wie vor dem Löschen, Papierkorb-Eintrag verschwindet.
  const wiederhergestellteLeserNi = repo.leserWiederherstellen(db, leserPapierkorb[0].id);
  assert.equal(wiederhergestellteLeserNi, leserNi);
  assert.ok(repo.getLeser(db, leserNi), 'Leser sollte wieder in der Live-Tabelle stehen');
  assert.equal(repo.papierkorbLeserListe(db).length, 0);

  const wiederhergestellteMedienNi = repo.medienWiederherstellen(db, medienPapierkorb[0].id);
  assert.equal(wiederhergestellteMedienNi, medienNi);
  assert.equal(repo.exemplarStatus(db, medienNi).verliehen, false);
  assert.equal(repo.papierkorbMedienListe(db).length, 0);

  // Endgültig löschen: Papierkorb-Eintrag verschwindet, ohne die Live-Tabelle zu berühren.
  repo.deleteMedium(db, medienNi, 'testuser');
  medienPapierkorb = repo.papierkorbMedienListe(db);
  repo.medienEndgueltigLoeschen(db, medienPapierkorb[0].id);
  assert.equal(repo.papierkorbMedienListe(db).length, 0);

  db.close();
});

test('Papierkorb: Exemplar lässt sich nicht wiederherstellen, wenn der Titel inzwischen gelöscht wurde', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip'));

  const katalogNi = repo.saveKatalog(db, { Titel: 'Verwaistes Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'PK-0002' });
  repo.deleteMedium(db, medienNi, 'testuser');
  const eintrag = repo.papierkorbMedienListe(db)[0];

  // deleteKatalog löscht den Titel samt (noch vorhandener) Exemplare – hier
  // manuell simuliert, weil das Exemplar selbst schon im Papierkorb liegt.
  db.prepare(`DELETE FROM "Katalog" WHERE "KatalogNi" = ?`).run(katalogNi);

  assert.throws(() => repo.medienWiederherstellen(db, eintrag.id), /Titel wurde inzwischen gelöscht/);
  db.close();
});
