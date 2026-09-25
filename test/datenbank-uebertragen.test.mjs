/**
 * INGA-Datenbank auf einen anderen Rechner übertragen (datenbank-uebertragen.js):
 * Paket schreiben, wieder einlesen, einzelne inga.sqlite3 samt -wal,
 * sinnvolle Ablehnung falscher Dateien.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/main/db.js');
const repo = require('../src/main/repo.js');
const { exportiereIngaDatenbank, bereiteEinbindenVor } = require('../src/main/datenbank-uebertragen.js');
const { DEFAULT_SETTINGS } = require('../src/main/store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-uebertragen-test-'));
}

function bestand(dir) {
  const db = openDatabase(dir);
  const k1 = repo.saveKatalog(db, { Titel: 'Mit Cover' });
  const k2 = repo.saveKatalog(db, { Titel: 'Ohne Cover-Datei' });
  const m = repo.saveMedium(db, { KatalogNi: k1, MedienEtik: 'U-1' });
  const l = repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Mia' });
  repo.ausleihen(db, { medienNi: m, leserNi: l, einstellungen: { ...DEFAULT_SETTINGS } });
  fs.mkdirSync(path.join(dir, 'covers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'covers', `${k1}.jpg`), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));
  repo.setCover(db, k1, `${k1}.jpg`, 'test');
  repo.setCover(db, k2, `${k2}.jpg`, 'test'); // Verweis ohne Datei
  return { db, k1, k2 };
}

test('Export → Einbinden: komplette Datenbank, Cover und Einstellungen (ohne rechnerbezogene) kommen an', () => {
  const quelle = tmpDir();
  const { db, k1, k2 } = bestand(quelle);
  const zipPfad = path.join(tmpDir(), 'INGA-Datenbank.zip');
  const info = exportiereIngaDatenbank(db, {
    coversDir: path.join(quelle, 'covers'),
    einstellungen: { ...DEFAULT_SETTINGS, bibliotheksName: 'Schulbücherei', perpustakaanLiveDbPfad: 'C:\\\\Perpustakaan\\\\db', matrixZugangstoken: 'geheim' },
    version: '1.9.2',
    zielZip: zipPfad,
    tmpDir: os.tmpdir(),
  });
  db.close();
  assert.equal(info.titel, 2);
  assert.equal(info.cover, 1);

  const vorbereitet = bereiteEinbindenVor(zipPfad, tmpDir());
  assert.deepEqual(vorbereitet.kennzahlen, { titel: 2, exemplare: 1, leser: 1, ausleihen: 1 });
  assert.deepEqual(vorbereitet.cover.map((c) => c.datei), [`${k1}.jpg`]);
  assert.equal(vorbereitet.einstellungen.bibliotheksName, 'Schulbücherei');
  assert.equal('perpustakaanLiveDbPfad' in vorbereitet.einstellungen, false, 'rechnerbezogene Pfade gehören nicht auf einen anderen Rechner');
  assert.equal('matrixZugangstoken' in vorbereitet.einstellungen, false, 'Zugangsdaten werden nicht mitgenommen');

  // Die vorbereitete Datei lässt sich als INGA-Datenbank öffnen, der verwaiste Cover-Verweis ist entfernt.
  const ziel = tmpDir();
  fs.copyFileSync(vorbereitet.dbDatei, path.join(ziel, 'inga.sqlite3'));
  const neu = openDatabase(ziel);
  assert.equal(repo.kennzahlen(neu).offen, 1);
  assert.ok(repo.coverInfo(neu, k1));
  assert.equal(repo.coverInfo(neu, k2), null);
  neu.close();
});

test('Einbinden einer einzelnen inga.sqlite3 samt daneben liegender -wal-Datei: auch die jüngsten Änderungen kommen mit', () => {
  const quelle = tmpDir();
  const { db } = bestand(quelle);
  // Rohkopie wie beim "von Hand aus dem Datenordner kopieren", während INGA
  // (noch) lief: die letzte Änderung steht nur in der -wal-Datei.
  db.pragma('wal_autocheckpoint = 0');
  repo.saveLeser(db, { Nachname: 'Nur', Vorname: 'ImWal' });
  const kopie = tmpDir();
  fs.copyFileSync(path.join(quelle, 'inga.sqlite3'), path.join(kopie, 'inga.sqlite3'));
  fs.copyFileSync(path.join(quelle, 'inga.sqlite3-wal'), path.join(kopie, 'inga.sqlite3-wal'));
  db.close();

  const vorbereitet = bereiteEinbindenVor(path.join(kopie, 'inga.sqlite3'), tmpDir());
  assert.equal(vorbereitet.kennzahlen.leser, 2);
  const pruef = new Database(vorbereitet.dbDatei, { readonly: true });
  assert.ok(pruef.prepare(`SELECT 1 FROM "Leser" WHERE "Nachname" = 'Nur'`).get());
  pruef.close();
});

test('Einbinden: Perpustakaan-Sicherung, fremde SQLite-Datei und Nicht-Datenbank werden verständlich abgelehnt', () => {
  const dir = tmpDir();
  const perpustakaan = path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip');
  assert.throws(() => bereiteEinbindenVor(perpustakaan, tmpDir()), /Perpustakaan-Sicherung/);

  const fremd = path.join(dir, 'fremd.sqlite3');
  const f = new Database(fremd);
  f.exec('CREATE TABLE irgendwas (x)');
  f.close();
  assert.throws(() => bereiteEinbindenVor(fremd, tmpDir()), /keine INGA-Datenbank/);

  const text = path.join(dir, 'notiz.sqlite3');
  fs.writeFileSync(text, 'nur Text, keine Datenbank');
  assert.throws(() => bereiteEinbindenVor(text, tmpDir()), /keine INGA-Datenbank/);

  const leeresZip = path.join(dir, 'leer.zip');
  const z = new AdmZip();
  z.addFile('hallo.txt', Buffer.from('x'));
  z.writeZip(leeresZip);
  assert.throws(() => bereiteEinbindenVor(leeresZip, tmpDir()), /keine INGA-Datenbank/);
});
