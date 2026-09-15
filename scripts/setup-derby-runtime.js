'use strict';

/**
 * Build-Zeit-CLI: lädt die Java-Laufzeit + Derby-Jars nach derby-runtime/
 * (bewusst NICHT in git – das wäre eine "Riesen Datei" im Repository
 * selbst; stattdessen wie Electrons eigene Binärdateien bei jedem Build
 * neu geholt, siehe package.json "extraResources"). Die eigentliche
 * Download-/Entpack-Logik steckt in src/main/derby-runtime-setup.js, weil
 * sie auch zur LAUFZEIT gebraucht wird (Assistent in den Einstellungen,
 * falls die mitgelieferte Laufzeit auf einer echten Installation fehlt –
 * siehe main.js "perpustakaan-live:laufzeit-herunterladen").
 *
 * Aufruf: `node scripts/setup-derby-runtime.js [win|mac|mac-arm|linux]`
 * (ohne Argument: aktuelle Plattform, wie sie CI/electron-builder gerade
 * baut). Bereits vorhandene Dateien werden übersprungen, ein zweiter
 * Aufruf ist also billig.
 */

const path = require('node:path');
const { aktuellePlattform, holeJre, holeDerbyJars } = require('../src/main/derby-runtime-setup');

const ZIEL = path.join(__dirname, '..', 'derby-runtime');

async function main() {
  const plattform = process.argv[2] || aktuellePlattform();
  console.log(`[derby-runtime] Richte Laufzeit für ${plattform} unter ${ZIEL} ein …`);
  const jre = await holeJre(ZIEL, plattform);
  console.log(jre.ueberuebersprungen ? '[derby-runtime] JRE bereits vorhanden, überspringe Download.' : `[derby-runtime] JRE bereit unter ${jre.pfad}`);
  const jars = await holeDerbyJars(ZIEL);
  console.log('[derby-runtime] Derby-Jars bereit unter', jars.pfad);
}

main().catch((err) => {
  console.error('[derby-runtime] Einrichtung fehlgeschlagen:', err.message);
  process.exit(1);
});
