'use strict';

/**
 * Reine Kalendertag-Arithmetik – ohne Zeitzonen-Stolperfallen.
 *
 * Bisherige Fehlerquelle (siehe CHANGELOG): `new Date().toISOString().slice(0,10)`
 * liefert das UTC-Datum, nicht das lokale – nachts (z. B. 00:15 Uhr MEZ) war
 * das "heutige" Datum dadurch noch der Vortag. Und wer ein lokal geparstes
 * Datum per `.setDate()` verschiebt und danach wieder über `.toISOString()`
 * ausgibt, bekommt in Zeitzonen mit positivem UTC-Offset (wie Deutschland)
 * ebenfalls ein um einen Tag falsches Ergebnis, sobald die lokale Mitternacht
 * auf den Vortag in UTC fällt (praktisch immer, außer exakt zur Zeitumstellung).
 *
 * Der Ausweg: Ein Kalendertag hat weder Uhrzeit noch Zeitzone. "Heute" wird
 * bewusst mit den LOKALEN Date-Gettern gelesen (das ist der Tag, den die
 * Kollegin gerade an ihrem Bildschirm erlebt) – jede weitere Rechnung
 * (addieren, Differenz, Wochentag) läuft danach ausschließlich über
 * UTC-verankerte Date-Objekte (Date.UTC/getUTC*), damit sie von der
 * Zeitzone der Maschine und von Zeitumstellungen komplett unabhängig ist.
 */

function pad(n) {
  return String(n).padStart(2, '0');
}

/** Heutiges Kalenderdatum am Ort der Nutzerin, als "YYYY-MM-DD". */
function heuteISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Wie die bisherigen AuslDatum/Rueckgabe-Werte: "YYYY-MM-DD 00:00:00.000". */
function heuteStamp() {
  return `${heuteISO()} 00:00:00.000`;
}

/** Aktueller Zeitstempel (für ErfassDat o. ä.), lokale Uhrzeit, sekundengenau. */
function jetztStamp() {
  const d = new Date();
  const zeit = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return `${heuteISO()} ${zeit}.000`;
}

/** "YYYY-MM-DD ..." (oder reines "YYYY-MM-DD") → UTC-verankertes Date für Kalenderrechnung. */
function parseKalenderdatum(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr ?? ''));
  if (!m) throw new Error(`Ungültiges Datum: ${dateStr}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatKalenderdatum(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Kalendertag + n Tage (n darf negativ sein) – unabhängig von der Zeitzone der Maschine. */
function addTage(dateStr, tage) {
  const d = parseKalenderdatum(dateStr);
  d.setUTCDate(d.getUTCDate() + Math.round(Number(tage) || 0));
  return formatKalenderdatum(d);
}

/** Ganze Kalendertage zwischen zwei Daten (bis − von), unabhängig von enthaltenen Uhrzeitanteilen. */
function tageDifferenz(vonStr, bisStr) {
  const a = parseKalenderdatum(vonStr);
  const b = parseKalenderdatum(bisStr);
  return Math.round((b - a) / 86400000);
}

/** Wochentag als 0=Sonntag … 6=Samstag, zeitzonenunabhängig. */
function wochentag(dateStr) {
  return parseKalenderdatum(dateStr).getUTCDay();
}

/** Samstag oder Sonntag? */
function istWochenende(dateStr) {
  const w = wochentag(dateStr);
  return w === 0 || w === 6;
}

module.exports = {
  heuteISO,
  heuteStamp,
  jetztStamp,
  parseKalenderdatum,
  formatKalenderdatum,
  addTage,
  tageDifferenz,
  wochentag,
  istWochenende,
};
