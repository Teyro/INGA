/**
 * Ähnlichkeitssuche (Abschnitt 4 des Umbau-Auftrags): reine Rang-/Distanz-
 * logik (suche.js) sowie die darauf aufbauenden Vorschlagslisten fürs
 * Ausleihen (repo.leserVorschlaege/medienVorschlaege).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const suche = require('../src/main/suche.js');
const { openDatabase } = require('../src/main/db.js');
const repo = require('../src/main/repo.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-suche-test-'));
}

/* --------------------------------------------------------------- suche.js */

test('normalisiere: Groß-/Kleinschreibung und Umlaute vereinheitlicht', () => {
  assert.equal(suche.normalisiere('MÜLLER'), 'muller');
  assert.equal(suche.normalisiere('Straße'), 'strasse');
});

test('levenshtein: 0 bei Gleichheit, 1 bei einem Vertipper', () => {
  assert.equal(suche.levenshtein('meier', 'meier'), 0);
  assert.equal(suche.levenshtein('meier', 'meyer'), 1);
});

test('feldRang: exakt vor Präfix vor Teilstring vor unscharf', () => {
  const exakt = suche.feldRang('Schulz', 'schulz');
  const praefix = suche.feldRang('Schulze', 'schulz');
  const teilstring = suche.feldRang('Ana Schulz', 'schulz');
  const unscharf = suche.feldRang('Schulz', 'shculz'); // vertippt, kein Präfix/Teilstring
  assert.ok(exakt > praefix);
  assert.ok(praefix >= teilstring);
  assert.ok(teilstring > unscharf);
  assert.ok(unscharf > 0);
});

test('ranglisteSortiert: "Meier" findet auch Meyer/Maier, exakter Treffer zuerst', () => {
  const kandidaten = [{ name: 'Meyer' }, { name: 'Maier' }, { name: 'Meier' }, { name: 'Schmidt' }];
  const ergebnis = suche.ranglisteSortiert(kandidaten, 'Meier', (k) => [k.name]);
  assert.deepEqual(ergebnis.map((k) => k.name), ['Meier', 'Meyer', 'Maier']);
});

test('ranglisteSortiert: ein vertippter Vorname findet die Person trotzdem, über den Nachnamen im selben Feld', () => {
  const kandidaten = [{ name: 'Anna Schulz' }, { name: 'Bernd Meier' }];
  // "Ana" statt "Anna" - Vertipper im Vornamen, Nachname exakt im Feld enthalten.
  const ergebnis = suche.ranglisteSortiert(kandidaten, 'Ana Schulz', (k) => [k.name]);
  assert.equal(ergebnis[0]?.name, 'Anna Schulz');
});

/* -------------------------------------------------------- Vorschlagslisten */

test('leserVorschlaege: findet über Vorname, Nachname, Kürzel und Ausweisnummer, unscharf', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'Schulz', Vorname: 'Emma', Kuerzel: 'ESC', AusweisId: 'L-001', Jahrgang: '3a' });
  repo.saveLeser(db, { Nachname: 'Meyer', Vorname: 'Ben', Kuerzel: 'BME', AusweisId: 'L-002', Jahrgang: '4b' });

  const treffer = repo.leserVorschlaege(db, 'schulz');
  assert.equal(treffer.length, 1);
  assert.equal(treffer[0].Nachname, 'Schulz');

  // Tippfehlertolerant: "Meier" statt "Meyer".
  const fuzzy = repo.leserVorschlaege(db, 'Meier');
  assert.equal(fuzzy[0]?.Nachname, 'Meyer');

  db.close();
});

test('leserVorschlaege: unter 2 Zeichen keine Vorschläge (noch zu unspezifisch)', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'Schulz', Vorname: 'Emma', AusweisId: 'L-001' });
  assert.deepEqual(repo.leserVorschlaege(db, 'S'), []);
  db.close();
});

test('medienVorschlaege: findet über Buchnummer, Titel und Autor, zeigt verliehene Exemplare markiert statt sie auszublenden', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Sternenschweif', Autor: 'Linda Chapman' });
  const medienNi1 = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'ST-0001' });
  repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'ST-0002' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tina', AusweisId: 'L-1' });
  repo.ausleihen(db, { medienNi: medienNi1, leserNi, einstellungen: { leihfristTage: 21, verlaengerungDauerTage: 21 } });

  const perTitel = repo.medienVorschlaege(db, 'Sternenschweif');
  assert.equal(perTitel.length, 2);
  assert.ok(perTitel.some((m) => m.verliehen === true));
  assert.ok(perTitel.some((m) => m.verliehen === false));

  // Die exakte Buchnummer steht an erster Stelle (auch wenn ST-0002 als sehr
  // ähnliche Nummer unscharf mit auftauchen kann – exakt geht immer vor).
  const perBuchnummer = repo.medienVorschlaege(db, 'ST-0001');
  assert.equal(perBuchnummer[0].MedienEtik, 'ST-0001');
  assert.equal(perBuchnummer[0].verliehen, true);

  db.close();
});
