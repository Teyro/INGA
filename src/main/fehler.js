'use strict';

/**
 * Übersetzt technische Fehler (Dateisystem, SQLite) in verständliche
 * deutsche Sätze, statt eine Kollegin mit einem rohen Stacktrace oder einer
 * englischen Systemmeldung zu konfrontieren. Bereits auf Deutsch geschriebene
 * fachliche Fehler (z. B. repo.js: "Bitte einen Titel angeben.") passen auf
 * keines der technischen Muster unten und werden deshalb unverändert
 * durchgereicht.
 */
function uebersetzeFehler(err) {
  const code = err?.code;
  const message = String(err?.message || err || '');

  if (code === 'ENOENT') return 'Datei oder Ordner wurde nicht gefunden.';
  if (code === 'EACCES' || code === 'EPERM') return 'Keine Berechtigung für diesen Ordner/diese Datei.';
  if (code === 'ENOSPC') return 'Nicht genügend Speicherplatz auf dem Datenträger.';
  if (code === 'EBUSY') return 'Datei ist gerade in Benutzung (z. B. in einem anderen Programm geöffnet). Bitte schließen und erneut versuchen.';
  if (/SQLITE_CONSTRAINT/.test(message)) return 'Der Eintrag verletzt eine Datenbankregel (z. B. ein Wert, der eindeutig sein müsste, doppelt vergeben).';
  if (/SQLITE_/.test(message)) return 'Datenbankfehler. Bitte die Eingabe prüfen; besteht das Problem weiter, bitte an die IT-Unterstützung wenden.';
  return message || 'Ein unerwarteter Fehler ist aufgetreten.';
}

/**
 * Wrappt einen ipcMain.handle-Callback: läuft er durch, wird sein Ergebnis
 * unverändert zurückgegeben; wirft er, wird der ORIGINALE Fehler auf der
 * Konsole geloggt (für die Fehlersuche) und stattdessen eine Ablehnung mit
 * übersetzter, deutscher Meldung weitergereicht – nie ein roher Stacktrace
 * bis in die Oberfläche.
 */
function sicher(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      console.error('[ipc]', err);
      throw new Error(uebersetzeFehler(err));
    }
  };
}

module.exports = { uebersetzeFehler, sicher };
