/**
 * Reine Kalendertag-Arithmetik – insbesondere die Regression, die den alten
 * Code hatte: `new Date(dateStr).toISOString().slice(0,10)` verschiebt in
 * Zeitzonen mit positivem UTC-Offset (wie Deutschland, ganzjährig) das
 * Ergebnis regelmäßig um einen Tag nach hinten.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { addTage, tageDifferenz, wochentag, istWochenende, parseKalenderdatum, formatKalenderdatum } = require('../src/main/date-utils.js');

test('addTage: einfache Addition über Monatsgrenze', () => {
  assert.equal(addTage('2026-10-12', 7), '2026-10-19');
  assert.equal(addTage('2026-10-28', 7), '2026-11-04');
});

test('addTage: Herbstferien-Beispiel aus dem Auftrag (12.10. + 7 Tage = 19.10.)', () => {
  assert.equal(addTage('2026-10-12 00:00:00.000', 7), '2026-10-19');
});

test('addTage: funktioniert unabhängig von der Systemzeitzone (Regressionstest)', () => {
  // Der alte Code (new Date(str) lokal parsen, dann .toISOString() -> UTC
  // zurücklesen) lieferte in TZ=Europe/Berlin für dieses Datum den 18.10.
  // statt des 19.10. – dieser Test schlägt fehl, falls der Fehler wiederkehrt.
  const ursprung = process.env.TZ;
  process.env.TZ = 'Europe/Berlin';
  try {
    assert.equal(addTage('2026-10-12', 7), '2026-10-19');
  } finally {
    if (ursprung === undefined) delete process.env.TZ;
    else process.env.TZ = ursprung;
  }
});

test('addTage: negative Werte funktionieren (Rückrechnung)', () => {
  assert.equal(addTage('2026-01-03', -5), '2025-12-29');
});

test('tageDifferenz: ganze Kalendertage, Uhrzeitanteile werden ignoriert', () => {
  assert.equal(tageDifferenz('2026-10-01', '2026-10-08'), 7);
  assert.equal(tageDifferenz('2026-10-08 23:59:59.000', '2026-10-01 00:00:00.000'), -7);
});

test('wochentag/istWochenende', () => {
  // 2026-10-17 ist ein Samstag
  assert.equal(wochentag('2026-10-17'), 6);
  assert.equal(istWochenende('2026-10-17'), true);
  assert.equal(istWochenende('2026-10-19'), false); // Montag
});

test('parseKalenderdatum/formatKalenderdatum: Rundreise ohne Verschiebung', () => {
  assert.equal(formatKalenderdatum(parseKalenderdatum('2026-12-31')), '2026-12-31');
});

test('addTage: lehnt erkennbar ungültige Daten ab statt still falsch zu rechnen', () => {
  assert.throws(() => addTage('nicht-datum', 1), /Ungültiges Datum/);
});
