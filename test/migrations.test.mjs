/**
 * Migrations- und Backup-Fundament (Schritt 0 des Ausbau-Auftrags):
 * Migrationen müssen auf einer bereits befüllten Datenbank sauber laufen,
 * dürfen keine Daten verwerfen, und davor muss automatisch ein Backup
 * entstehen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dbModule = require('../src/main/db.js');
const { openDatabase, gespeicherteSchemaVersion, migriere, SCHEMA_VERSION, MIGRATIONS } = dbModule;
const repo = require('../src/main/repo.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-migrate-test-'));
}

test('frische Datenbank landet direkt auf SCHEMA_VERSION, ohne Backup', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  db.close();
});

test('eine fällige Migration läuft, sichert vorher die Datenbank und verwirft keine Daten', () => {
  const dir = tmpDir();

  // Erster Start: Daten anlegen, wie eine echte Schule es hätte.
  let db = openDatabase(dir);
  const katalogNi = repo.saveKatalog(db, { Titel: 'Bestandsbuch' });
  repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'B-0001' });
  db.close();

  // Eine Test-Migration simulieren, wie eine echte Phase sie hinzufügen würde.
  const testMigration = {
    version: SCHEMA_VERSION + 1,
    beschreibung: 'Testspalte für die Migrationsprüfung',
    up(d) {
      d.exec(`CREATE TABLE IF NOT EXISTS migrations_test_marker (id INTEGER PRIMARY KEY)`);
    },
  };
  MIGRATIONS.push(testMigration);
  try {
    db = openDatabase(dir); // zweiter Start: Migration ist jetzt fällig
    assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION + 1);

    // Backup wurde vor der Migration erzeugt.
    const backupDir = path.join(dir, 'backups');
    const backups = fs.readdirSync(backupDir).filter((f) => f.includes('_migration'));
    assert.ok(backups.length >= 1, 'es sollte mindestens ein Migrations-Backup geben');

    // Bestehende Daten sind unangetastet.
    const katalog = db.prepare(`SELECT * FROM "Katalog" WHERE "Titel" = 'Bestandsbuch'`).get();
    assert.ok(katalog, 'Katalogeintrag muss die Migration überstehen');
    const medium = db.prepare(`SELECT * FROM "Medien" WHERE "MedienEtik" = 'B-0001'`).get();
    assert.ok(medium, 'Medienexemplar muss die Migration überstehen');

    // Erneuter Aufruf von migriere() ist ein No-Op (idempotent).
    const zweiterLauf = migriere(db);
    assert.equal(zweiterLauf.angewendet.length, 0);

    db.close();
  } finally {
    MIGRATIONS.pop(); // Testzustand nicht in andere Tests durchsickern lassen
  }
});
