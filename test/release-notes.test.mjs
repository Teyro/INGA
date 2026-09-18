import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { formatiereReleaseNotes } = require('../src/main/release-notes.js');

test('formatiereReleaseNotes: einzelner String wird geglättet (Überschriften/Fett/Code weg)', () => {
  const roh = '### Neu\n- **Fett** Ding\n- `code` Ding';
  const ergebnis = formatiereReleaseNotes(roh);
  assert.equal(ergebnis, 'Neu\n- Fett Ding\n- code Ding');
});

test('formatiereReleaseNotes: Array mehrerer übersprungener Versionen wird zu einem Text zusammengefasst', () => {
  const roh = [
    { version: '1.3.0', note: 'Ding A' },
    { version: '1.2.0', note: 'Ding B' },
  ];
  const ergebnis = formatiereReleaseNotes(roh);
  assert.match(ergebnis, /1\.3\.0:\nDing A/);
  assert.match(ergebnis, /1\.2\.0:\nDing B/);
});

test('formatiereReleaseNotes: leer/null/undefined -> leerer String, kein Absturz', () => {
  assert.equal(formatiereReleaseNotes(null), '');
  assert.equal(formatiereReleaseNotes(undefined), '');
  assert.equal(formatiereReleaseNotes(''), '');
  assert.equal(formatiereReleaseNotes(42), '');
});

test('formatiereReleaseNotes: sehr lange Beschreibung wird auf 900 Zeichen gekappt', () => {
  const lang = 'x'.repeat(2000);
  const ergebnis = formatiereReleaseNotes(lang);
  assert.ok(ergebnis.length <= 903); // 900 + " …"
  assert.ok(ergebnis.endsWith('…'));
});
