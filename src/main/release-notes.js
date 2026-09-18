'use strict';

/**
 * Bereitet `info.releaseNotes` von electron-updater (siehe main.js
 * wireAutoUpdater()) für die reine Textanzeige im Update-Dialog/den
 * Einstellungen auf. Eigenes, kleines Modul (statt direkt in main.js)
 * nur wegen der Testbarkeit – main.js selbst braucht Electron und lässt
 * sich nicht mit reinem `node --test` laden.
 */

const ZEICHEN_GRENZE = 900;

/**
 * `releaseNotesRoh` ist je nach Fall ein einzelner String (Update von der
 * aktuellen auf die neueste Version) ODER ein Array `{version, note}`
 * (mehrere übersprungene Zwischenversionen). Kommt 1:1 aus dem GitHub-
 * Release-Text, der wiederum aus CHANGELOG.md stammt (siehe
 * .github/workflows/build.yml "release"-Job + scripts/changelog-extract.js)
 * – von Hand geschriebenes Deutsch, keine automatische Commit-Liste. Grobe
 * Markdown-Politur (Überschriften-Rauten/Fett-Sternchen/Code-Backticks
 * weg) für die reine Textanzeige; eine längere Beschreibung wird gekappt,
 * damit der Dialog nicht ausufert – die ungekürzte Fassung steht immer auf
 * der GitHub-Releases-Seite.
 */
function formatiereReleaseNotes(releaseNotesRoh) {
  let text = '';
  if (Array.isArray(releaseNotesRoh)) {
    text = releaseNotesRoh.map((eintrag) => `${eintrag.version}:\n${eintrag.note || ''}`).join('\n\n');
  } else if (typeof releaseNotesRoh === 'string') {
    text = releaseNotesRoh;
  }
  text = text
    .replace(/\r\n/g, '\n')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
  if (text.length > ZEICHEN_GRENZE) text = `${text.slice(0, ZEICHEN_GRENZE).trim()} …`;
  return text;
}

module.exports = { formatiereReleaseNotes };
