/**
 * Regressionstests für die in der Code-Durchsicht zu 1.9.0 gefundenen
 * Fehler – vor allem rund um echte Perpustakaan-Daten (Nummern als Text,
 * 0 statt leer, eigener Nummernzähler IdentCnt) und die Nummernvergabe.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const { openDatabase, TABLES, gespeicherteSchemaVersion, SCHEMA_VERSION } = require('../src/main/db.js');
const { importZip, exportZip, parseCsv } = require('../src/main/csvio.js');
const repo = require('../src/main/repo.js');
const ferien = require('../src/main/ferien.js');
const { DEFAULT_SETTINGS, sanitizeSettings } = require('../src/main/store.js');

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip');
const einstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7, maxVerlaengerung: 2 };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-review19-test-'));
}

/** Echte Sicherung + eine offene Ausleihe, eine Mahnung, eine Vormerkung für Leser 176 / Exemplar 5 (alles als Text, wie Perpustakaan es liefert). */
function fixtureMitAusleihe(dir) {
  const zip = new AdmZip(FIXTURE);
  const leserRow = TABLES.Leser.map((c) => ({ LeserNi: '176', Nachname: 'Muster', Vorname: 'Max', Jahrgang: '3a', SperrungNi: '0' }[c] ?? '')).join(';');
  zip.updateFile('Leser.csv', Buffer.from(`${TABLES.Leser.join(';')}\r\n${leserRow}\r\n`));
  zip.updateFile('Ausleihe.csv', Buffer.from('MedienNi;LeserNi;AuslDatum;Rueckgabe;AnzVerl;ErfassAnw\r\n5;176;2026-06-18 00:00:00.000;2026-06-25 00:00:00.000;0;teyro\r\n'));
  zip.updateFile('Mahnung.csv', Buffer.from('MedienNi;LeserNi;Mahndatum;MaGebuehr;AuslDatum;Rueckgabe\r\n5;176;2026-07-01 00:00:00.000;0.0;2026-06-18 00:00:00.000;\r\n'));
  zip.updateFile('Vormerkung.csv', Buffer.from('LeserNi;KatalogNi;Prioritaet;VormerkDat;VerfallDat\r\n176;5;1;2026-06-01 00:00:00.000;\r\n'));
  const zipPfad = path.join(dir, 'mit-ausleihe.zip');
  zip.writeZip(zipPfad);
  return zipPfad;
}

test('importierte offene Ausleihe: als verliehen erkannt, keine Doppelausleihe, in der Nutzerakte sichtbar', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, fixtureMitAusleihe(dir));

  // Die Oberfläche übergibt Nummern als Zahl (aus INTEGER-PRIMARY-KEY-Spalten).
  assert.equal(repo.exemplarStatus(db, 5).verliehen, true);
  assert.throws(() => repo.ausleihen(db, { medienNi: 5, leserNi: 176, einstellungen }), /bereits ausgeliehen/);
  assert.equal(repo.offeneAusleihenVonLeser(db, 176).length, 1);
  assert.equal(repo.vormerkungenVonLeser(db, 176).length, 1);
  assert.equal(repo.mahnhistorieVonLeser(db, 176).length, 1);
  const katalogNi = db.prepare(`SELECT "KatalogNi" FROM "Medien" WHERE "MedienNi" = 5`).get().KatalogNi;
  assert.equal(typeof katalogNi, 'number');
  assert.equal(repo.exemplareFuer(db, katalogNi).length, 1);
  assert.equal(repo.exemplareFuer(db, String(katalogNi)).length, 1, 'auch als Text übergeben (Formularfeld) gefunden');
  assert.ok(repo.letzteMahnungFuer(db, 5, 176, '2026-06-18 00:00:00.000'));
  assert.throws(() => repo.deleteLeser(db, 176), /offene Ausleihen/);
  db.close();
});

test('Migration 10: bereits als Text gespeicherte Nummern einer bestehenden Datenbank werden zu Zahlen', () => {
  const dir = tmpDir();
  let db = openDatabase(dir);
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum") VALUES ('7', '8', '2026-09-01 00:00:00.000')`).run();
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum") VALUES ('007', 'x', '2026-09-01 00:00:00.000')`).run();
  db.prepare(`UPDATE inga_meta SET value = '9' WHERE key = 'schema_version'`).run();
  db.close();

  db = openDatabase(dir);
  assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION);
  const zeilen = db.prepare(`SELECT typeof("MedienNi") AS m, typeof("LeserNi") AS l, "MedienNi" AS wert FROM "Ausleihe" ORDER BY id`).all();
  assert.deepEqual(zeilen[0], { m: 'integer', l: 'integer', wert: 7 });
  assert.equal(zeilen[1].wert, '007', 'nicht-kanonische Werte bleiben unverändert (verlustfreier Export)');
  assert.equal(repo.exemplarStatus(db, 7).verliehen, true);
  db.close();
});

test('Perpustakaan-"0" bei NichtVfNi: Verlustliste und Filter "nicht verfügbar" bleiben leer', () => {
  const db = openDatabase(tmpDir());
  importZip(db, FIXTURE);
  assert.equal(repo.verlustliste(db).length, 0);
  assert.equal(repo.searchKatalog(db, { verfuegbarkeit: 'nicht_verfuegbar' }).gesamt, 0);
  db.close();
});

test('Medienart mit Perpustakaan-"FristVerl" 0: Verlängern verschiebt die Fälligkeit trotzdem (Vorgabe greift)', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "MedArt" ("MedArtKb","MedArtBz","Frist","FristVerl") VALUES ('Buc','Buch','28','0')`).run();
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch', MedArtKb: 'Buc' });
  const ohne = repo.berechneRueckgabedatum(db, { auslDatum: '2026-01-05', katalogNi, anzVerl: 0, einstellungen });
  const mit = repo.berechneRueckgabedatum(db, { auslDatum: '2026-01-05', katalogNi, anzVerl: 1, einstellungen });
  assert.equal(ohne.datum, '2026-02-02'); // 28 Tage aus der Medienart
  assert.equal(mit.datum, '2026-02-09'); // + 7 Tage Vorgabe statt + 0
  db.close();
});

test('Nummernvergabe: eine gelöschte Nummer wird nicht neu vergeben, Wiederherstellen überschreibt nichts', () => {
  const db = openDatabase(tmpDir());
  const alt = repo.saveLeser(db, { Nachname: 'Alt', Vorname: 'A' });
  repo.deleteLeser(db, alt, 'test');
  const neu = repo.saveLeser(db, { Nachname: 'Neu', Vorname: 'N' });
  assert.notEqual(neu, alt, 'die Nummer des gelöschten Nutzers darf nicht wieder vergeben werden');

  const [eintrag] = repo.papierkorbLeserListe(db);
  repo.leserWiederherstellen(db, eintrag.id);
  assert.equal(repo.getLeser(db, neu).Nachname, 'Neu', 'der neue Nutzer bleibt unangetastet');
  assert.equal(repo.getLeser(db, alt).Nachname, 'Alt');
  db.close();
});

test('Wiederherstellen: ist die alte Nummer schon an jemand anderen vergeben (Altbestand), gibt es eine neue statt zu überschreiben', () => {
  const db = openDatabase(tmpDir());
  const alt = repo.saveLeser(db, { Nachname: 'Alt', Vorname: 'A' });
  repo.deleteLeser(db, alt, 'test');
  // wie vor 1.9 möglich: dieselbe Nummer direkt erneut vergeben
  repo.saveLeser(db, { LeserNi: alt, Nachname: 'Belegt', Vorname: 'B' });
  const [eintrag] = repo.papierkorbLeserListe(db);
  const wiederhergestellt = repo.leserWiederherstellen(db, eintrag.id);
  assert.notEqual(wiederhergestellt, alt);
  assert.equal(repo.getLeser(db, alt).Nachname, 'Belegt');
  assert.equal(repo.getLeser(db, wiederhergestellt).Nachname, 'Alt');
  db.close();
});

test('IdentCnt: INGA vergibt keine Nummer, die Perpustakaan schon hatte, und hebt den Zähler beim Export an', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  importZip(db, FIXTURE);
  // Perpustakaan-Zähler künstlich über dem höchsten vorhandenen Titel
  db.prepare(`UPDATE legacy_rows SET data = ? WHERE table_name = 'IdentCnt' AND data LIKE '%"Katalog"%'`).run(JSON.stringify({ Entity: 'Katalog', IdentNr: '2000' }));
  const katalogNi = repo.saveKatalog(db, { Titel: 'Neu in INGA' });
  assert.equal(katalogNi, 2001);
  repo.saveLeser(db, { Nachname: 'Neu', Vorname: 'N' });

  const ziel = path.join(dir, 'export.zip');
  exportZip(db, ziel);
  const { rows } = parseCsv(new AdmZip(ziel).getEntry('IdentCnt.csv').getData().toString('utf8'));
  const zaehler = Object.fromEntries(rows.map((r) => [r.Entity, r.IdentNr]));
  assert.equal(zaehler.Katalog, '2001');
  assert.equal(zaehler.Medien, '1747', 'unverändert, INGA hat kein Exemplar angelegt');
  assert.equal(zaehler.Leser, '1', 'fehlender Zähler wird ergänzt');
  db.close();
});

test('deleteKatalog: räumt Vormerkungen und Cover-Verweis des Titels mit ab', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Weg damit' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y' });
  repo.vormerken(db, { katalogNi, leserNi });
  repo.setCover(db, katalogNi, `${katalogNi}.jpg`, 'test');
  const { coverDatei } = repo.deleteKatalog(db, katalogNi);
  assert.equal(coverDatei, `${katalogNi}.jpg`);
  assert.equal(repo.coverInfo(db, katalogNi), null);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "Vormerkung"`).get().n, 0);
  db.close();
});

test('vormerken: VormerkDat im Perpustakaan-Zeitstempelformat', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'T' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y' });
  repo.vormerken(db, { katalogNi, leserNi });
  assert.match(repo.vormerkungenFuer(db, katalogNi)[0].VormerkDat, /^\d{4}-\d{2}-\d{2} 00:00:00\.000$/);
  db.close();
});

test('verschiebeOffeneAusleihen: bereits verschickte Mahnungen bleiben ihrer Ausleihe zugeordnet', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'T' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'V-1' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y' });
  repo.ausleihen(db, { medienNi, leserNi, einstellungen });
  const vorher = repo.offeneAusleihenVonLeser(db, leserNi)[0];
  repo.mahnungEintragen(db, { medienNi, leserNi, auslDatum: vorher.AuslDatum, gebuehr: 0, stufe: 1 });
  repo.verschiebeOffeneAusleihen(db, 14);
  const nachher = repo.offeneAusleihenVonLeser(db, leserNi)[0];
  assert.notEqual(nachher.AuslDatum, vorher.AuslDatum);
  assert.ok(repo.letzteMahnungFuer(db, medienNi, leserNi, nachher.AuslDatum), 'Mahnung muss nach dem Verschieben noch gefunden werden');
  db.close();
});

test('importZip: Tabellen in einem Unterordner und mit UTF-8-BOM werden trotzdem gelesen', () => {
  const dir = tmpDir();
  const zip = new AdmZip();
  const kopf = TABLES.Katalog.join(';');
  const zeile = TABLES.Katalog.map((c) => ({ KatalogNi: '1', Titel: 'Aus dem Unterordner' }[c] ?? '')).join(';');
  zip.addFile('Sicherung/Katalog.csv', Buffer.from(`﻿${kopf}\r\n${zeile}\r\n`, 'utf8'));
  const zipPfad = path.join(dir, 'unterordner.zip');
  zip.writeZip(zipPfad);
  const db = openDatabase(dir);
  importZip(db, zipPfad);
  assert.equal(repo.getKatalog(db, 1)?.Titel, 'Aus dem Unterordner');
  db.close();
});

test('importZip: eine Datei ohne bekannte Tabellen wird mit klarer Meldung abgelehnt statt "erfolgreich" nichts zu tun', () => {
  const dir = tmpDir();
  const zip = new AdmZip();
  zip.addFile('irgendwas.txt', Buffer.from('hallo'));
  const zipPfad = path.join(dir, 'falsch.zip');
  zip.writeZip(zipPfad);
  const db = openDatabase(dir);
  assert.throws(() => importZip(db, zipPfad), /keine bekannten Perpustakaan-Tabellen/);
  db.close();
});

test('sanitizeSettings: unsinnige Zahlen (negative Leihfrist …) werden auf plausible Grenzen begrenzt', () => {
  const clean = sanitizeSettings({ leihfristTage: -7, ausleihLimit: -1, fontScale: 5000, leihfristOffsetTage: -20 }, DEFAULT_SETTINGS);
  assert.equal(clean.leihfristTage, 1);
  assert.equal(clean.ausleihLimit, 0);
  assert.equal(clean.fontScale, 250);
  assert.equal(clean.leihfristOffsetTage, -20, 'negative Fristverschiebung bleibt erlaubt');
});

test('Ferien: eine Ausleihe am letzten Ferientag (mit Uhrzeit im AuslDatum) zählt als in die Ferien fallend', () => {
  const liste = [{ bezeichnung: 'Herbstferien', startdatum: '2026-10-19', enddatum: '2026-10-30', typ: 'Ferien' }];
  const { namen } = ferien.verlaengerungDurchFerien('2026-10-30 00:00:00.000', '2026-11-06', liste);
  assert.deepEqual(namen, ['Herbstferien']);
});
