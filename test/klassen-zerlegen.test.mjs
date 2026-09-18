import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { klassenZerlegen } = require('../src/renderer/js/util.js');

test('klassenZerlegen: mehrere kommagetrennte Klassen -> Array der einzelnen, getrimmten Kürzel', () => {
  assert.deepEqual(klassenZerlegen('4a,4b,4c'), ['4a', '4b', '4c']);
  assert.deepEqual(klassenZerlegen('4a, 4b, 4c'), ['4a', '4b', '4c']);
  assert.deepEqual(klassenZerlegen('4a;4b'), ['4a', '4b']);
});

test('klassenZerlegen: nur eine einzelne Klasse (ohne Trennzeichen) -> null, Anzeige bleibt unverändert', () => {
  assert.equal(klassenZerlegen('4a'), null);
  assert.equal(klassenZerlegen(''), null);
  assert.equal(klassenZerlegen(undefined), null);
  assert.equal(klassenZerlegen(null), null);
});

test('klassenZerlegen: leere/nur-Komma-Fragmente werden verworfen, kein leerer Chip', () => {
  assert.deepEqual(klassenZerlegen('4a,,4b'), ['4a', '4b']);
  assert.equal(klassenZerlegen('4a,'), null); // nach dem Trennen bleibt nur EIN echtes Kürzel
});
