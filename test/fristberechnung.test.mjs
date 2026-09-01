/**
 * Zentrale Fristberechnung (berechneRueckgabedatum) und Mahngebührenformel
 * (berechneMahngebuehr) – Phase B des Ausbau-Auftrags (Abschnitte 2 und 3).
 *
 * Enthält auch einen Regressionstest für einen Bug, der vor dieser Phase
 * bestand: „Verlängern“ erhöhte nur den Zähler AnzVerl, ohne dass sich das
 * daraus berechnete Rückgabedatum tatsächlich verschob.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-frist-test-'));
}

const basisEinstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7, maxVerlaengerung: 2, leihfristOffsetTage: 0 };

test('berechneRueckgabedatum: Basisfrist ohne Verlängerung/Verschiebung', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  const { datum, hinweise } = repo.berechneRueckgabedatum(db, {
    auslDatum: '2026-10-12',
    katalogNi: null,
    anzVerl: 0,
    einstellungen: basisEinstellungen,
  });
  assert.equal(datum, '2026-10-19');
  assert.equal(hinweise.length, 0);
  db.close();
});

test('berechneRueckgabedatum: globale Fristverschiebung wirkt und wird als Hinweis ausgegeben', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  const { datum, hinweise } = repo.berechneRueckgabedatum(db, {
    auslDatum: '2026-10-12',
    katalogNi: null,
    anzVerl: 0,
    einstellungen: { ...basisEinstellungen, leihfristOffsetTage: 12 },
  });
  // 2026-10-12 + 7 + 12 = 2026-10-31, ein Samstag – die Ferienverwaltung
  // verschiebt jede Fälligkeit zusätzlich vom Wochenende auf den nächsten
  // Schultag (hier: Montag, 2026-11-02, weil auch der 1.11. ein Sonntag ist).
  // Ohne eingetragene Ferien bleibt der bisherige Fristverschiebungs-Hinweis
  // trotzdem erhalten, nur ohne zusätzlichen Ferien-Hinweis (siehe
  // test/ferien.test.mjs für die Ferien-Hinweise selbst).
  assert.equal(datum, '2026-11-02');
  assert.ok(hinweise.some((h) => h.includes('12 Tage')));
  assert.ok(!hinweise.some((h) => h.includes('wegen')), 'reine Wochenendverschiebung braucht keinen Ferien-Hinweis');
  db.close();
});

test('verlaengern(): erhöht AnzVerl UND verschiebt das tatsächlich berechnete Rückgabedatum (Regressionstest)', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  const katalogNi = repo.saveKatalog(db, { Titel: 'Verlängerungsbuch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'V-0001' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tina', AusweisId: 'V-L-1' });

  const ausleihe = repo.ausleihen(db, { medienNi, leserNi, einstellungen: basisEinstellungen });

  const vorher = repo.alleOffenenAusleihen(db).find((a) => a.id === ausleihe.id);
  const faelligVorher = repo.berechneRueckgabedatum(db, { auslDatum: vorher.AuslDatum, katalogNi, anzVerl: 0, einstellungen: basisEinstellungen }).datum;
  assert.equal(ausleihe.faelligAm, faelligVorher);

  const ergebnis = repo.verlaengern(db, ausleihe.id, basisEinstellungen);

  // 7 Tage Basisfrist + 7 Tage für eine Verlängerung = 14 Tage nach AuslDatum – und
  // vor allem: ungleich dem Datum vor der Verlängerung (das war der Bug).
  const erwartetNachVerlaengerung = repo.berechneRueckgabedatum(db, { auslDatum: vorher.AuslDatum, katalogNi, anzVerl: 1, einstellungen: basisEinstellungen }).datum;
  assert.equal(ergebnis.faelligAm, erwartetNachVerlaengerung);
  assert.notEqual(ergebnis.faelligAm, faelligVorher, 'Verlängern muss das Rückgabedatum tatsächlich verschieben');
  assert.ok(ergebnis.hinweise.some((h) => h.includes('1 Verlängerung')));

  db.close();
});

test('berechneRueckgabedatum: Medienart-eigene Frist geht vor der Vorgabe', () => {
  const dir = tmpDir();
  const db = openDatabase(dir);
  db.prepare(`INSERT INTO "MedArt" ("MedArtKb","MedArtBz","Frist","FristVerl") VALUES ('LES', 'Lesekiste', 21, 14)`).run();
  const katalogNi = repo.saveKatalog(db, { Titel: 'Lesekiste 3', MedArtKb: 'LES' });

  const ohneVerl = repo.berechneRueckgabedatum(db, { auslDatum: '2026-01-01', katalogNi, anzVerl: 0, einstellungen: basisEinstellungen });
  assert.equal(ohneVerl.datum, '2026-01-22'); // 21 Tage statt der Vorgabe (7)

  const mitVerl = repo.berechneRueckgabedatum(db, { auslDatum: '2026-01-01', katalogNi, anzVerl: 1, einstellungen: basisEinstellungen });
  assert.equal(mitVerl.datum, '2026-02-05'); // 21 + 14 Tage Verlängerung der Medienart (nicht die globalen 7)
  db.close();
});

test('berechneMahngebuehr: aus, solange der Schalter aus ist', () => {
  const s = { ...DEFAULT_SETTINGS, mahngebuehrenAktiv: false, mahnGebuehrProTag: 1, mahnGebuehrMax: 10, mahnKarenztage: 0 };
  assert.equal(repo.berechneMahngebuehr(30, s), 0);
});

test('berechneMahngebuehr: Karenztage werden abgezogen, danach linear pro Tag', () => {
  const s = { ...DEFAULT_SETTINGS, mahngebuehrenAktiv: true, mahnGebuehrProTag: 0.5, mahnGebuehrMax: 0, mahnKarenztage: 3 };
  assert.equal(repo.berechneMahngebuehr(3, s), 0); // noch in der Karenz
  assert.equal(repo.berechneMahngebuehr(5, s), 1); // 2 Tage über der Karenz * 0,50 €
});

test('berechneMahngebuehr: bei 0 gedeckelt auf den Höchstbetrag', () => {
  const s = { ...DEFAULT_SETTINGS, mahngebuehrenAktiv: true, mahnGebuehrProTag: 1, mahnGebuehrMax: 5, mahnKarenztage: 0 };
  assert.equal(repo.berechneMahngebuehr(100, s), 5);
});
