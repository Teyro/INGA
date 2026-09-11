/**
 * EXPERIMENTELL (Branch feature/perpustakaan-live-db): src/main/perpustakaan-live.js
 * gegen ein echtes Test-Doppelgänger-Programm (test/fixtures/fake-bridge.mjs,
 * läuft als eigener Prozess) statt nur gegen einen verhaltenen Mock – prüft
 * damit den wirklichen spawn()-Mechanismus (Argumente, stdout-Auswertung,
 * Exit-Codes, Zeitüberschreitung). Der ECHTE Java-Bridge-Vertrag (Derby-
 * Zugriff, Sperrerkennung, Transaktions-Rollback) ist manuell gegen eine
 * synthetische Derby-Testdatenbank geprüft, siehe derby-bridge/README.md –
 * node:test hat kein Java zur Verfügung.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const require = createRequire(import.meta.url);

const FAKE_BRIDGE = path.join(import.meta.dirname, 'fixtures', 'fake-bridge.mjs');
process.env.INGA_TEST_JAVA_PFAD = FAKE_BRIDGE;

const { pruefeZugriff, dumpNachZip, ladeAusZip } = require('../src/main/perpustakaan-live.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-perp-live-test-'));
}

test('pruefeZugriff: frei -> ok:true', async () => {
  const ergebnis = await pruefeZugriff('/pfad/zu/normal-db');
  assert.deepEqual(ergebnis, { ok: true });
});

test('pruefeZugriff: von einer anderen JVM gesperrt (Perpustakaan vermutlich offen) -> gesperrt:true', async () => {
  const ergebnis = await pruefeZugriff('/pfad/zu/gesperrt-db');
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.gesperrt, true);
});

test('pruefeZugriff: sonstiger Fehler -> ok:false mit Grund, kein Absturz', async () => {
  const ergebnis = await pruefeZugriff('/pfad/zu/kaputt-db');
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.fehler, 'Simulierter Fehler');
});

test('dumpNachZip: schreibt ein Schema-Datei-Argument aus TABLES und liefert das Ergebnis-JSON der Bridge durch', async () => {
  const dir = tmpDir();
  const zielZip = path.join(dir, 'export.zip');
  const ergebnis = await dumpNachZip('/pfad/zu/normal-db', { Leser: ['LeserNi', 'Nachname'] }, zielZip);
  assert.deepEqual(ergebnis, { ok: true, tabellen: 1 });
  assert.ok(fs.existsSync(zielZip), 'die Bridge sollte tatsächlich ein Zip am Zielpfad erzeugt haben');
});

test('dumpNachZip: gesperrte Datenbank -> gesperrt:true, keine Zip-Datei nötig', async () => {
  const ergebnis = await dumpNachZip('/pfad/zu/gesperrt-db', { Leser: ['LeserNi'] }, path.join(tmpDir(), 'export.zip'));
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.gesperrt, true);
});

test('ladeAusZip: erfolgreicher Schreibvorgang', async () => {
  const ergebnis = await ladeAusZip('/pfad/zu/normal-db', '/irgendein/quell.zip');
  assert.deepEqual(ergebnis, { ok: true, tabellen: 1 });
});

test('ladeAusZip: Fehler beim Schreiben (z. B. Rollback in der Bridge) wird sauber gemeldet', async () => {
  const ergebnis = await ladeAusZip('/pfad/zu/kaputt-db', '/irgendein/quell.zip');
  assert.equal(ergebnis.ok, false);
  assert.equal(ergebnis.fehler, 'Simulierter Ladefehler');
});
