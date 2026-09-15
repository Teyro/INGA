/**
 * EXPERIMENTELL: prüft den userData-Nachlade-Fallback aus
 * src/main/perpustakaan-live.js (setzeZusaetzlicheLaufzeitBasis) sowie den
 * "bereits vorhanden -> kein Download nötig"-Kurzschluss aus
 * src/main/derby-runtime-setup.js – beides ohne echtes Java oder
 * Netzwerkzugriff. Eigene Datei (statt in perpustakaan-live.test.mjs),
 * weil dort INGA_TEST_JAVA_PFAD prozessweit gesetzt wird und javaPfad()
 * damit kurzschließt, bevor die hier geprüfte Kandidaten-Suche überhaupt
 * läuft – node:test führt jede *.test.mjs-Datei in einem eigenen Prozess
 * aus, die env-Variable würde sich also ohnehin nicht überschneiden, aber
 * so bleibt die Zuständigkeit klar getrennt.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);
const { javaPfad, klassenpfad, setzeZusaetzlicheLaufzeitBasis, laufzeitVorhanden } = require('../src/main/perpustakaan-live.js');
const { holeJre } = require('../src/main/derby-runtime-setup.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-derby-fallback-test-'));
}

test('javaPfad(): ohne mitgelieferte Laufzeit und ohne zusätzliche Basis -> bare "java" (Systempfad)', () => {
  setzeZusaetzlicheLaufzeitBasis(null);
  assert.equal(javaPfad(), 'java');
  assert.equal(laufzeitVorhanden(), false);
});

test('javaPfad(): findet eine per setzeZusaetzlicheLaufzeitBasis() nachgeladene Laufzeit (userData-Fallback)', () => {
  const basis = tmpDir();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const binOrdner = path.join(basis, 'derby-runtime', 'jre', 'bin');
  fs.mkdirSync(binOrdner, { recursive: true });
  fs.writeFileSync(path.join(binOrdner, exe), '');

  setzeZusaetzlicheLaufzeitBasis(basis);
  try {
    assert.equal(javaPfad(), path.join(binOrdner, exe));
    assert.equal(laufzeitVorhanden(), true);
  } finally {
    setzeZusaetzlicheLaufzeitBasis(null);
  }
});

test('klassenpfad(): bindet Jars aus der nachgeladenen Basis ein, Bridge-Klassen kommen weiter aus dem Programmordner', () => {
  const basis = tmpDir();
  const jarOrdner = path.join(basis, 'derby-runtime', 'derby-jars');
  fs.mkdirSync(jarOrdner, { recursive: true });
  fs.writeFileSync(path.join(jarOrdner, 'derby.jar'), '');

  setzeZusaetzlicheLaufzeitBasis(basis);
  try {
    const cp = klassenpfad().split(path.delimiter);
    assert.ok(cp.includes(path.join(jarOrdner, 'derby.jar')), 'nachgeladenes Jar sollte im Klassenpfad stehen');
    assert.ok(cp.some((p) => p.endsWith(path.join('derby-bridge', 'classes'))), 'Bridge-Klassen sollten weiterhin enthalten sein');
  } finally {
    setzeZusaetzlicheLaufzeitBasis(null);
  }
});

test('holeJre(): bereits vorhandene JRE wird übersprungen, kein Netzwerkzugriff nötig', async () => {
  const basis = tmpDir();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const binOrdner = path.join(basis, 'jre', 'bin');
  fs.mkdirSync(binOrdner, { recursive: true });
  fs.writeFileSync(path.join(binOrdner, exe), '');

  const ergebnis = await holeJre(basis, process.platform === 'win32' ? 'win' : 'linux');
  assert.equal(ergebnis.ok, true);
  assert.equal(ergebnis.ueberuebersprungen, true);
});
