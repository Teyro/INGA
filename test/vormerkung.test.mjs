/**
 * Vormerkungen/Reservierungen (Abschnitt 6 des Ausbau-Auftrags). Die
 * Tabelle "Vormerkung" existierte im Perpustakaan-Schema bereits, wurde von
 * INGA aber nirgends genutzt – ebenso die Einstellung
 * "verlaengerungGesperrtBeiVormerkung", die bislang wirkungslos war.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-vormerkung-test-'));
}

const einstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7 };

function aufbau(db) {
  const katalogNi = repo.saveKatalog(db, { Titel: 'Begehrtes Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'V-1' });
  const leserA = repo.saveLeser(db, { Nachname: 'Erste', Vorname: 'Person', AusweisId: 'V-A' });
  const leserB = repo.saveLeser(db, { Nachname: 'Zweite', Vorname: 'Person', AusweisId: 'V-B' });
  return { katalogNi, medienNi, leserA, leserB };
}

test('vormerken: legt eine Vormerkung mit aufsteigender Priorität an', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, leserA, leserB } = aufbau(db);
  const v1 = repo.vormerken(db, { katalogNi, leserNi: leserA });
  const v2 = repo.vormerken(db, { katalogNi, leserNi: leserB });
  assert.equal(v1.prioritaet, 1);
  assert.equal(v2.prioritaet, 2);

  const liste = repo.vormerkungenFuer(db, katalogNi);
  assert.equal(liste.length, 2);
  assert.equal(liste[0].Nachname, 'Erste', 'zuerst vorgemerkt = zuerst in der Liste');
  db.close();
});

test('vormerken: dieselbe Person kann denselben Titel nicht doppelt vormerken', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, leserA } = aufbau(db);
  repo.vormerken(db, { katalogNi, leserNi: leserA });
  assert.throws(() => repo.vormerken(db, { katalogNi, leserNi: leserA }), /bereits vorgemerkt/);
  db.close();
});

test('vormerkungLoeschen: entfernt genau die angegebene Vormerkung', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, leserA } = aufbau(db);
  const { id } = repo.vormerken(db, { katalogNi, leserNi: leserA });
  repo.vormerkungLoeschen(db, id);
  assert.equal(repo.vormerkungenFuer(db, katalogNi).length, 0);
  db.close();
});

test('ausleihen: erfüllt automatisch eine eigene Vormerkung und meldet verbleibende Vormerkungen anderer', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, medienNi, leserA, leserB } = aufbau(db);
  repo.vormerken(db, { katalogNi, leserNi: leserA });
  repo.vormerken(db, { katalogNi, leserNi: leserB });

  // leserA leiht das Buch aus, für das er selbst vorgemerkt hatte.
  const ergebnis = repo.ausleihen(db, { medienNi, leserNi: leserA, einstellungen });
  assert.ok(ergebnis.vormerkungHinweis?.includes('Zweite, Person'), 'muss auf die verbleibende fremde Vormerkung hinweisen');

  const restliste = repo.vormerkungenFuer(db, katalogNi);
  assert.equal(restliste.length, 1, 'die eigene Vormerkung muss beim Ausleihen automatisch entfernt werden');
  assert.equal(restliste[0].Nachname, 'Zweite');
  db.close();
});

test('ausleihen: kein Hinweis, wenn niemand (mehr) vorgemerkt hat', () => {
  const db = openDatabase(tmpDir());
  const { medienNi, leserA } = aufbau(db);
  const ergebnis = repo.ausleihen(db, { medienNi, leserNi: leserA, einstellungen });
  assert.equal(ergebnis.vormerkungHinweis, null);
  db.close();
});

test('verlaengern: gesperrt, wenn eine ANDERE Person vorgemerkt hat und die Einstellung aktiv ist', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, medienNi, leserA, leserB } = aufbau(db);
  const { id } = repo.ausleihen(db, { medienNi, leserNi: leserA, einstellungen });
  repo.vormerken(db, { katalogNi, leserNi: leserB });

  const mitSperre = { ...einstellungen, verlaengerungGesperrtBeiVormerkung: true };
  assert.throws(() => repo.verlaengern(db, id, mitSperre), /vorgemerkt/);

  const ohneSperre = { ...einstellungen, verlaengerungGesperrtBeiVormerkung: false };
  assert.doesNotThrow(() => repo.verlaengern(db, id, ohneSperre));
  db.close();
});

test('verlaengern: eine Vormerkung der AUSLEIHENDEN Person selbst blockiert die eigene Verlängerung nicht', () => {
  const db = openDatabase(tmpDir());
  const { katalogNi, medienNi, leserA } = aufbau(db);
  const { id } = repo.ausleihen(db, { medienNi, leserNi: leserA, einstellungen });
  // Vormerkung durch die ausleihende Person selbst wäre unüblich, aber die
  // Regel darf sich in diesem Fall trotzdem nicht selbst blockieren.
  db.prepare(`INSERT INTO "Vormerkung" ("LeserNi","KatalogNi","Prioritaet","VormerkDat") VALUES (?,?,?,?)`).run(
    leserA,
    katalogNi,
    1,
    '2026-01-01'
  );
  const mitSperre = { ...einstellungen, verlaengerungGesperrtBeiVormerkung: true };
  assert.doesNotThrow(() => repo.verlaengern(db, id, mitSperre));
  db.close();
});
