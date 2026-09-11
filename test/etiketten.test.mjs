/**
 * Etikettendruck: reine Geometrie-/Seitenaufteilungslogik (kein DOM nötig,
 * siehe src/renderer/js/etiketten-geometrie.js für den UMD-artigen Export).
 * Die eigentliche Balken-/Layout-Darstellung läuft nur im Etiketten-
 * Druckfenster und lässt sich hier nicht mit prüfen (kein Electron/Display
 * in dieser Testumgebung) – das deckt zumindest ab, dass Etiketten korrekt
 * auf Bögen verteilt und positioniert werden, ohne Bögen zu verschwenden.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FORMATE, berechnePositionen } = require('../src/renderer/js/etiketten-geometrie.js');

test('Etiketten-Formate: alle bekannten Zweckform-/Avery-Formate vorhanden mit plausibler Geometrie', () => {
  for (const [id, format] of Object.entries(FORMATE)) {
    assert.ok(format.cols > 0 && format.rows > 0, `${id}: cols/rows müssen positiv sein`);
    assert.ok(format.pitchX > 0 && format.pitchY > 0, `${id}: pitchX/pitchY müssen positiv sein`);
    // Muss auf ein A4-Blatt (210 × 297 mm) passen.
    const breiteGenutzt = format.marginLeft + format.cols * format.pitchX;
    const hoeheGenutzt = format.marginTop + format.rows * format.pitchY;
    assert.ok(breiteGenutzt <= 210.5, `${id}: Raster ${breiteGenutzt}mm zu breit für A4`);
    assert.ok(hoeheGenutzt <= 297.5, `${id}: Raster ${hoeheGenutzt}mm zu hoch für A4`);
  }
});

test('Zweckform/Avery L4732REV: 80 Etiketten pro Bogen (5 × 16), als "kompakt" markiert (zu klein für Titel/Autor)', () => {
  const format = FORMATE['zweckform-l4732'];
  assert.equal(format.cols * format.rows, 80);
  assert.equal(format.kompakt, true);
});

test('berechnePositionen: Startposition 1 füllt den ersten Bogen ohne Lücke, zeilenweise', () => {
  const format = FORMATE['zweckform-3475']; // 3 Spalten × 8 Zeilen = 24/Bogen
  const labels = Array.from({ length: 5 }, (_, i) => ({ MedienEtik: `T-000${i}` }));
  const positionen = berechnePositionen(labels, format, 1);

  assert.equal(positionen.length, 24, 'ein Bogen voll (24 Zellen), auch wenn nur 5 Etiketten');
  const belegt = positionen.filter((p) => p.label);
  assert.equal(belegt.length, 5);
  assert.deepEqual(belegt.map((p) => p.label.MedienEtik), labels.map((l) => l.MedienEtik));
  // Erste 5 Zellen (Reihe für Reihe: 3 Spalten pro Zeile) sind belegt, Rest leer.
  assert.deepEqual(positionen.slice(0, 5).map((p) => Boolean(p.label)), [true, true, true, true, true]);
  assert.equal(positionen[5].label, null);
  // Zeile/Spalte-Berechnung: Position 4 (0-indiziert) = Zeile 1, Spalte 1 (3 Spalten).
  assert.deepEqual({ row: positionen[4].row, col: positionen[4].col }, { row: 1, col: 1 });
});

test('berechnePositionen: Startposition überspringt bereits verbrauchte Etiketten NUR auf dem ersten Bogen', () => {
  const format = FORMATE['zweckform-3651']; // 4 × 10 = 40/Bogen
  const labels = Array.from({ length: 45 }, (_, i) => ({ MedienEtik: `E-${i}` }));
  const positionen = berechnePositionen(labels, format, 10); // 9 Zellen überspringen

  assert.equal(positionen.length, 80, 'zwei volle Bögen (9 Leerzellen + 45 Etiketten = 54 Zellen, 40/Bogen → 2 Bögen)');
  const ersterBogen = positionen.filter((p) => p.bogen === 0);
  assert.equal(ersterBogen.length, 40);
  assert.deepEqual(ersterBogen.slice(0, 9).map((p) => p.label), Array(9).fill(null));
  assert.equal(ersterBogen[9].label.MedienEtik, 'E-0');

  const zweiterBogen = positionen.filter((p) => p.bogen === 1);
  // Zweiter Bogen beginnt wieder bei Position 0, keine Leerzellen mehr.
  assert.ok(zweiterBogen[0].label, 'zweiter Bogen startet ohne Lücke oben links');
});

test('berechnePositionen: Startposition größer als die Bogengröße wird sicher begrenzt statt den ganzen Bogen zu verschenken', () => {
  const format = FORMATE['zweckform-l7160']; // 21/Bogen
  const positionen = berechnePositionen([{ MedienEtik: 'X' }], format, 999);
  const ersterBogen = positionen.filter((p) => p.bogen === 0);
  assert.equal(ersterBogen.length, 21);
  assert.ok(ersterBogen.some((p) => p.label), 'mindestens eine Zelle muss das Etikett bekommen, egal wie hoch die Startposition');
});

test('berechnePositionen: left/top ergeben sich aus Rand + Spalte/Zeile × Rasterabstand', () => {
  const format = { cols: 2, rows: 2, marginTop: 5, marginLeft: 3, pitchX: 10, pitchY: 20 };
  const positionen = berechnePositionen([{ MedienEtik: 'A' }, { MedienEtik: 'B' }, { MedienEtik: 'C' }, { MedienEtik: 'D' }], format, 1);
  assert.deepEqual(positionen.map((p) => [p.left, p.top]), [
    [3, 5], [13, 5],
    [3, 25], [13, 25],
  ]);
});
