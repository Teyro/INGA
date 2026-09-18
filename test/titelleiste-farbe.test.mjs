import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { wochentagsFarbe, effektiveFarbe, kontrastfarbe, WOCHENTAG_FARBEN } = require('../src/main/titelleiste-farbe.js');

test('wochentagsFarbe: liefert für jeden Wochentag eine gültige Hex-Farbe, Montag != Sonntag', () => {
  for (let tag = 0; tag <= 6; tag += 1) {
    const datum = new Date(2026, 0, 4 + tag); // 4.1.2026 ist ein Sonntag
    const farbe = wochentagsFarbe(datum);
    assert.match(farbe, /^#[0-9a-f]{6}$/i);
  }
  const montag = wochentagsFarbe(new Date(2026, 0, 5));
  const sonntag = wochentagsFarbe(new Date(2026, 0, 4));
  assert.notEqual(montag, sonntag);
  assert.equal(WOCHENTAG_FARBEN.length, 7);
});

test('effektiveFarbe: Modus "standard" (oder fehlend/unbekannt) -> null, Standardfarbe soll gelten', () => {
  assert.equal(effektiveFarbe({}), null);
  assert.equal(effektiveFarbe({ titelleisteModus: 'standard' }), null);
  assert.equal(effektiveFarbe({ titelleisteModus: 'unsinn' }), null);
});

test('effektiveFarbe: Modus "wochentag" -> Farbe des übergebenen Datums', () => {
  const montag = new Date(2026, 0, 5);
  assert.equal(effektiveFarbe({ titelleisteModus: 'wochentag' }, montag), wochentagsFarbe(montag));
});

test('effektiveFarbe: Modus "eigene" mit gültiger Hex-Farbe -> genau diese Farbe', () => {
  assert.equal(effektiveFarbe({ titelleisteModus: 'eigene', titelleisteEigeneFarbe: '#123abc' }), '#123abc');
});

test('effektiveFarbe: Modus "eigene" ohne/mit ungültiger Farbe -> null (Standardfarbe als Rückfall)', () => {
  assert.equal(effektiveFarbe({ titelleisteModus: 'eigene' }), null);
  assert.equal(effektiveFarbe({ titelleisteModus: 'eigene', titelleisteEigeneFarbe: 'rot' }), null);
  assert.equal(effektiveFarbe({ titelleisteModus: 'eigene', titelleisteEigeneFarbe: '#zzzzzz' }), null);
});

test('kontrastfarbe: helle Hintergrundfarben -> dunkler Text, dunkle Hintergrundfarben -> heller Text', () => {
  assert.equal(kontrastfarbe('#ffffff'), '#1a1a1a');
  assert.equal(kontrastfarbe('#f4c542'), '#1a1a1a'); // Montag-Gelb, hell
  assert.equal(kontrastfarbe('#000000'), '#ffffff');
  assert.equal(kontrastfarbe('#3d6fe0'), '#ffffff'); // Mittwoch-Blau, dunkel genug für weißen Text
});

test('kontrastfarbe: wirft nie, ungültige Eingabe ergibt einen definierten Rückfall', () => {
  assert.equal(kontrastfarbe(undefined), '#1a1a1a');
  assert.equal(kontrastfarbe('keine-farbe'), '#1a1a1a');
  assert.equal(kontrastfarbe(null), '#1a1a1a');
});
