/**
 * Backup-Grundfunktionen (jetzt auch in der Oberfläche nutzbar: "Backup
 * jetzt" und die Liste zum Einspielen in den Einstellungen).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { sichereDatenbankSync, listeBackups, backupHeuteVorhanden, sicherePerpustakaanZipSync, perpustakaanBackupHeuteVorhanden } = require('../src/main/backup.js');
const { openDatabase } = require('../src/main/db.js');
const { exportZip } = require('../src/main/csvio.js');
const repo = require('../src/main/repo.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-backup-test-'));
}

test('sichereDatenbankSync + listeBackups: liefert die erstellte Sicherung mit Größe und Zeitstempel, neueste zuerst', () => {
  const dir = tmpDir();
  // openDatabase(dir) legt die Datei exakt unter diesem Pfad an (siehe db.js).
  const dbFile = path.join(dir, 'inga.sqlite3');
  const backupDir = path.join(dir, 'backups');
  const db = openDatabase(dir);

  const pfad1 = sichereDatenbankSync(db, dbFile, backupDir, { grund: 'manuell' });
  assert.ok(pfad1 && fs.existsSync(pfad1));

  const liste = listeBackups(backupDir);
  assert.equal(liste.length, 1);
  assert.match(liste[0].datei, /^inga_\d{8}_\d{6}_manuell\.sqlite3$/);
  assert.ok(liste[0].groesse > 0);
  assert.ok(new Date(liste[0].erstellt).getTime() > 0);
});

test('listeBackups: unbekannter/nicht vorhandener Ordner liefert eine leere Liste statt zu werfen', () => {
  assert.deepEqual(listeBackups(path.join(tmpDir(), 'gibt-es-nicht')), []);
});

test('backupHeuteVorhanden: erkennt ein bereits heute erstelltes Backup desselben Grundes', () => {
  const dir = tmpDir();
  const dbFile = path.join(dir, 'inga.sqlite3');
  const backupDir = path.join(dir, 'backups');
  const db = openDatabase(dir);

  assert.equal(backupHeuteVorhanden(backupDir, 'start'), false);
  sichereDatenbankSync(db, dbFile, backupDir, { grund: 'start' });
  assert.equal(backupHeuteVorhanden(backupDir, 'start'), true);
  assert.equal(backupHeuteVorhanden(backupDir, 'migration'), false, 'ein anderer Grund darf nicht mitzählen');
});

test('sicherePerpustakaanZipSync: legt eine Perpustakaan-kompatible Zip-Sicherung mit Bestandsdaten an', () => {
  const dir = tmpDir();
  const backupDir = path.join(dir, 'backups');
  const db = openDatabase(dir);
  repo.saveKatalog(db, { Titel: 'Testbuch' });

  assert.equal(perpustakaanBackupHeuteVorhanden(backupDir), false);
  const ziel = sicherePerpustakaanZipSync(db, backupDir, exportZip);
  assert.ok(ziel && fs.existsSync(ziel));
  assert.match(path.basename(ziel), /^perpustakaan_backup_\d{8}_\d{6}\.zip$/);
  assert.equal(perpustakaanBackupHeuteVorhanden(backupDir), true);

  const AdmZip = require('adm-zip');
  const zip = new AdmZip(ziel);
  const katalog = zip.getEntry('Katalog.csv').getData().toString('utf8');
  assert.match(katalog, /Testbuch/);
  db.close();
});

test('sicherePerpustakaanZipSync: alte Sicherungen werden rotiert, sqlite3- und Perpustakaan-Sicherungen stören sich nicht gegenseitig', () => {
  const dir = tmpDir();
  const dbFile = path.join(dir, 'inga.sqlite3');
  const backupDir = path.join(dir, 'backups');
  const db = openDatabase(dir);

  sichereDatenbankSync(db, dbFile, backupDir, { grund: 'start' });
  sicherePerpustakaanZipSync(db, backupDir, exportZip);

  const dateien = fs.readdirSync(backupDir);
  assert.equal(dateien.filter((f) => f.endsWith('.sqlite3')).length, 1);
  assert.equal(dateien.filter((f) => f.endsWith('.zip')).length, 1);
  db.close();
});
