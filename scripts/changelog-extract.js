'use strict';

/**
 * Extrahiert den Abschnitt zu EINER Version aus CHANGELOG.md (zwischen
 * ihrer eigenen "## X.Y.Z …"-Überschrift und der nächsten "## ") – für den
 * GitHub-Release-Text (siehe .github/workflows/build.yml "release"-Job)
 * UND für die automatische Update-Prüfung: electron-updater übernimmt den
 * Release-Text 1:1 als `releaseNotes` (siehe main.js wireAutoUpdater()) –
 * damit sieht die Kollegin beim Update-Dialog denselben von Hand
 * geschriebenen deutschen Text wie auf der GitHub-Releases-Seite, statt
 * einer automatisch generierten Commit-Liste.
 *
 * Aufruf: `node scripts/changelog-extract.js <version>` (ohne führendes
 * "v", z. B. "1.2.0-beta.3") – gibt den Abschnitt auf stdout aus, oder
 * bricht mit einer Fehlermeldung ab, falls die Version nicht gefunden
 * wurde (lieber laut scheitern als eine leere Release-Beschreibung
 * veröffentlichen).
 */

const fs = require('node:fs');
const path = require('node:path');

function extrahiere(changelogText, version) {
  const zeilen = changelogText.split('\n');
  // Escaped für den regulären Ausdruck: die Version kann Punkte enthalten,
  // die sonst als "beliebiges Zeichen" gelten würden.
  const versionMuster = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const kopfMuster = new RegExp(`^##\\s+${versionMuster}\\b`);
  const startIndex = zeilen.findIndex((z) => kopfMuster.test(z));
  if (startIndex === -1) return null;
  const rest = zeilen.slice(startIndex + 1);
  const endeIndex = rest.findIndex((z) => /^##\s+/.test(z));
  const abschnitt = endeIndex === -1 ? rest : rest.slice(0, endeIndex);
  return abschnitt.join('\n').trim();
}

function main() {
  const version = process.argv[2];
  if (!version) {
    console.error('Aufruf: node scripts/changelog-extract.js <version>');
    process.exit(1);
  }
  const changelogPfad = path.join(__dirname, '..', 'CHANGELOG.md');
  const text = fs.readFileSync(changelogPfad, 'utf8');
  const abschnitt = extrahiere(text, version);
  if (abschnitt === null) {
    console.error(`[changelog-extract] Kein Abschnitt "## ${version}" in CHANGELOG.md gefunden.`);
    process.exit(1);
  }
  process.stdout.write(abschnitt + '\n');
}

if (require.main === module) main();

module.exports = { extrahiere };
