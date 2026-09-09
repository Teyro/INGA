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

test('Migration Version 4: StandOrt-Altdaten aus legacy_rows (Perpustakaan-Import vor dieser Version) gehen beim Upgrade nicht verloren', () => {
  const dir = tmpDir();

  // Erster Start (aktuelle Version): legt die native StandOrt-Tabelle bereits
  // leer an. Für den Test wird der Zustand einer ÄLTEREN INGA-Version
  // nachgestellt, in der StandOrt noch reiner Legacy-Passthrough war: die
  // native Tabelle leeren, den Altbestand stattdessen als JSON in
  // legacy_rows ablegen (genau wie es ein Perpustakaan-Import vor Version 4
  // getan hätte) und die gespeicherte Schema-Version auf 3 zurücksetzen.
  let db = openDatabase(dir);
  db.prepare(`DELETE FROM "StandOrt"`).run();
  db.prepare(`INSERT INTO legacy_rows (table_name, seq, data) VALUES ('StandOrt', 0, ?)`).run(
    JSON.stringify({ StOrtNi: '7', StOrtBz: 'Regal Sachbücher', position: '1' })
  );
  db.prepare(`UPDATE inga_meta SET value = '3' WHERE key = 'schema_version'`).run();
  db.close();

  // Zweiter Start: Migration Version 4 ist jetzt fällig und muss die
  // Altdaten in die native Tabelle übernehmen.
  db = openDatabase(dir);
  assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION);
  const standort = db.prepare(`SELECT * FROM "StandOrt" WHERE "StOrtNi" = 7`).get();
  assert.ok(standort, 'StandOrt-Altdatensatz muss in die native Tabelle übernommen werden');
  assert.equal(standort.StOrtBz, 'Regal Sachbücher');
  const uebrig = db.prepare(`SELECT COUNT(*) AS n FROM legacy_rows WHERE table_name = 'StandOrt'`).get();
  assert.equal(uebrig.n, 0, 'nach der Übernahme darf nichts mehr doppelt in legacy_rows stehen');
  db.close();
});

test('Migration Version 9: nur Buch/Hörbuch-CD werden beim Upgrade sichtbar, alles andere ausgeblendet – eine bereits getroffene Wahl bleibt unangetastet', () => {
  const dir = tmpDir();

  let db = openDatabase(dir);
  const insert = db.prepare(`INSERT INTO "MedArt" ("MedArtKb","MedArtBz","verbergen") VALUES (?, ?, ?)`);
  insert.run('Buc', 'Buch', null);
  insert.run('HB', 'Hörbuch-CD', null);
  insert.run('DVD', 'DVD', null);
  insert.run('CDR', 'CD-ROM', null);
  insert.run('ZS', 'Zeitschrift', 0); // bereits bewusst eingeblendet – Migration darf das nicht überschreiben
  db.prepare(`UPDATE inga_meta SET value = '8' WHERE key = 'schema_version'`).run();
  db.close();

  db = openDatabase(dir);
  assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION);
  const verbergen = (kb) => db.prepare(`SELECT "verbergen" AS v FROM "MedArt" WHERE "MedArtKb" = ?`).get(kb).v;
  assert.equal(verbergen('Buc'), 0, 'Buch soll sichtbar sein');
  assert.equal(verbergen('HB'), 0, 'Hörbuch-CD soll sichtbar sein');
  assert.equal(verbergen('DVD'), 1, 'DVD soll ausgeblendet sein');
  assert.equal(verbergen('CDR'), 1, 'CD-ROM (Software) soll trotz "CD" im Namen ausgeblendet sein');
  assert.equal(verbergen('ZS'), 0, 'eine bereits getroffene Wahl darf die Migration nicht überschreiben');
  db.close();
});

test('Migration Version 5: Vormerkung-Altdaten aus legacy_rows gehen beim Upgrade nicht verloren', () => {
  const dir = tmpDir();

  let db = openDatabase(dir);
  db.prepare(`DELETE FROM "Vormerkung"`).run();
  db.prepare(`INSERT INTO legacy_rows (table_name, seq, data) VALUES ('Vormerkung', 0, ?)`).run(
    JSON.stringify({ LeserNi: '3', KatalogNi: '9', Prioritaet: '1', VormerkDat: '2026-01-01', VerfallDat: '' })
  );
  db.prepare(`UPDATE inga_meta SET value = '4' WHERE key = 'schema_version'`).run();
  db.close();

  db = openDatabase(dir);
  assert.equal(gespeicherteSchemaVersion(db), SCHEMA_VERSION);
  const vormerkung = db.prepare(`SELECT * FROM "Vormerkung" WHERE "LeserNi" = '3' AND "KatalogNi" = '9'`).get();
  assert.ok(vormerkung, 'Vormerkung-Altdatensatz muss in die native Tabelle übernommen werden');
  assert.equal(vormerkung.Prioritaet, '1');
  assert.ok(Number.isInteger(vormerkung.id), 'die neue Tabelle muss eine eigene id-Spalte haben (kein *Ni-Einzelschlüssel im Original)');
  const uebrig = db.prepare(`SELECT COUNT(*) AS n FROM legacy_rows WHERE table_name = 'Vormerkung'`).get();
  assert.equal(uebrig.n, 0);
  db.close();
});
