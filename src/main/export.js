'use strict';

/**
 * Allgemeiner CSV-Export für Listenansichten (Umlaufliste, Katalog, Nutzer,
 * Rückgabe) – bewusst getrennt von csvio.js: das dort verwendete Format ist
 * exakt das Perpustakaan-Austauschformat (keine Anführungszeichen, weil im
 * Original nie nötig, Semikolon rein zufällig aus demselben Grund wie hier).
 * Hier geht es um von Menschen weiterverarbeitete Export-Dateien, die in
 * deutschem Excel korrekt aufgehen müssen: Semikolon als Trennzeichen
 * (Excels deutsche Standardeinstellung), UTF-8-BOM (ohne die interpretiert
 * Excel unter Windows Umlaute sonst oft falsch), echtes CSV-Quoting für
 * Felder mit Semikolon, Anführungszeichen oder Zeilenumbruch, CRLF-Zeilenenden.
 */

function zelleAlsCsv(wert) {
  if (wert === null || wert === undefined) return '';
  const s = String(wert);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * `spalten`: [{ schluessel, titel }], `zeilen`: Array von Objekten mit
 * diesen Schlüsseln. Liefert den fertigen Dateiinhalt inkl. BOM als String.
 */
function alsExcelCsv(spalten, zeilen) {
  const BOM = String.fromCharCode(0xfeff);
  const kopf = spalten.map((s) => zelleAlsCsv(s.titel)).join(';');
  const koerper = zeilen.map((z) => spalten.map((s) => zelleAlsCsv(z[s.schluessel])).join(';'));
  return BOM + [kopf, ...koerper].join('\r\n') + '\r\n';
}

module.exports = { alsExcelCsv };
