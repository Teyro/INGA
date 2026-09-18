import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { extrahiere } = require('../scripts/changelog-extract.js');

const BEISPIEL = `# Änderungsprotokoll

## Unveröffentlicht

## 1.2.0 – 2026-09-20

### Neu
- Ding A
- Ding B

## 1.1.1 – 2026-09-15

### Behoben
- Ding C
`;

test('extrahiere: findet den Abschnitt zwischen der eigenen Überschrift und der nächsten', () => {
  const ergebnis = extrahiere(BEISPIEL, '1.2.0');
  assert.match(ergebnis, /### Neu/);
  assert.match(ergebnis, /Ding A/);
  assert.match(ergebnis, /Ding B/);
  assert.doesNotMatch(ergebnis, /Ding C/);
});

test('extrahiere: letzter Abschnitt der Datei (kein nachfolgendes "## ") funktioniert auch', () => {
  const ergebnis = extrahiere(BEISPIEL, '1.1.1');
  assert.match(ergebnis, /Ding C/);
});

test('extrahiere: unbekannte Version -> null', () => {
  assert.equal(extrahiere(BEISPIEL, '9.9.9'), null);
});

test('extrahiere: Versionen mit Punkten werden nicht als Platzhalter fehlinterpretiert (1.2.0 matcht NICHT 1x2x0)', () => {
  const mitVerwirrung = BEISPIEL + '\n## 1x2x0 – nie\n\nFalscher Treffer\n';
  const ergebnis = extrahiere(mitVerwirrung, '1.2.0');
  assert.doesNotMatch(ergebnis, /Falscher Treffer/);
});

test('gegen die echte CHANGELOG.md: die aktuelle package.json-Version hat einen Abschnitt', () => {
  const changelog = fs.readFileSync(path.join(import.meta.dirname, '..', 'CHANGELOG.md'), 'utf8');
  const pkg = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'));
  const ergebnis = extrahiere(changelog, pkg.version);
  assert.ok(ergebnis && ergebnis.length > 0, `Kein CHANGELOG-Abschnitt für aktuelle Version "${pkg.version}" gefunden`);
});
