'use strict';

/**
 * Sicherungskopien der SQLite-Datenbank: vor jeder Migration automatisch
 * (siehe db.js), einmal täglich beim Programmstart, sowie jederzeit manuell
 * über "Backup jetzt" in den Einstellungen. Immer synchron gehalten (wie
 * store.js) – better-sqlite3 selbst ist ebenfalls synchron, und ein Backup
 * beim Start bzw. vor einer Migration muss ohnehin abgeschlossen sein, bevor
 * es weitergeht.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BACKUPS = 10;
const DATEI_MUSTER = /^inga_\d{8}_\d{6}_[a-z]+\.sqlite3$/;

function pad(n) {
  return String(n).padStart(2, '0');
}

function zeitstempelFuerDateiname() {
  const d = new Date();
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function heutigesDatumFuerDateiname() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function eigeneBackups(backupDir) {
  try {
    return fs.readdirSync(backupDir).filter((f) => DATEI_MUSTER.test(f)).sort();
  } catch {
    return [];
  }
}

function rotiere(backupDir) {
  const dateien = eigeneBackups(backupDir);
  const ueberzaehlig = dateien.slice(0, Math.max(0, dateien.length - MAX_BACKUPS));
  for (const f of ueberzaehlig) {
    try {
      fs.unlinkSync(path.join(backupDir, f));
    } catch (err) {
      console.error(`[backup] konnte altes Backup ${f} nicht entfernen:`, err.message);
    }
  }
}

/**
 * Kopiert die Datenbank in den Backup-Ordner und hält dort nur die letzten
 * MAX_BACKUPS Stände vor. `db` wird vorher per WAL-Checkpoint geleert, damit
 * eine reine Dateikopie von `dbFile` genügt (sonst könnten Änderungen, die
 * noch in der -wal-Datei stehen, im Backup fehlen). Wirft absichtlich nie –
 * ein fehlgeschlagenes Backup soll weder den Programmstart noch eine fällige
 * Migration verhindern, wird aber geloggt und als `null` zurückgemeldet.
 */
function sichereDatenbankSync(db, dbFile, backupDir, { grund = 'manuell' } = {}) {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    console.error('[backup] WAL-Checkpoint fehlgeschlagen, sichere trotzdem:', err.message);
  }
  try {
    fs.mkdirSync(backupDir, { recursive: true });
    const ziel = path.join(backupDir, `inga_${zeitstempelFuerDateiname()}_${grund}.sqlite3`);
    fs.copyFileSync(dbFile, ziel);
    rotiere(backupDir);
    return ziel;
  } catch (err) {
    console.error('[backup] Sicherung fehlgeschlagen:', err.message);
    return null;
  }
}

/** Gab es heute schon ein Backup mit diesem Grund? Für "einmal täglich beim Start". */
function backupHeuteVorhanden(backupDir, grund) {
  const heute = heutigesDatumFuerDateiname();
  return eigeneBackups(backupDir).some((f) => f.startsWith(`inga_${heute}_`) && f.endsWith(`_${grund}.sqlite3`));
}

function listeBackups(backupDir) {
  return eigeneBackups(backupDir)
    .reverse()
    .map((datei) => {
      const voll = path.join(backupDir, datei);
      const { size, mtime } = fs.statSync(voll);
      return { datei, pfad: voll, groesse: size, erstellt: mtime.toISOString() };
    });
}

// listeBackups() wird aktuell nirgends aufgerufen – vorgesehen für eine
// "Backups verwalten"-Ansicht in den Einstellungen (noch nicht gebaut, siehe
// Abschlussbericht), deshalb bewusst exportiert statt entfernt.
module.exports = { sichereDatenbankSync, backupHeuteVorhanden, listeBackups };
