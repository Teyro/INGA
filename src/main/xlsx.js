'use strict';

/**
 * Minimaler, aber korrekter XLSX-Schreiber (OOXML SpreadsheetML) ohne
 * externe XLSX-Bibliothek – nur mit dem bereits vorhandenen `adm-zip`
 * (demselben Paket, das INGA schon für den Perpustakaan-Export nutzt; eine
 * XLSX-Datei ist im Kern ein Zip aus ein paar XML-Dateien). Deckt bewusst nur
 * das ab, was die Listen-Exporte brauchen: EIN Arbeitsblatt, fette
 * Kopfzeile, Autofilter über die gesamte Tabelle, feste Spaltenbreiten –
 * kein Formeln-/Mehrblatt-/Diagramm-Schnickschnack.
 */

const AdmZip = require('adm-zip');

/** Spaltenindex (0-basiert) → Excel-Spaltenbuchstabe ("A", "B", … "Z", "AA", …). */
function spaltenBuchstabe(index) {
  let n = index + 1;
  let buchstabe = '';
  while (n > 0) {
    const rest = (n - 1) % 26;
    buchstabe = String.fromCharCode(65 + rest) + buchstabe;
    n = Math.floor((n - 1) / 26);
  }
  return buchstabe;
}

/**
 * Entfernt Zeichen, die in XML 1.0 nicht erlaubt sind (fast alle
 * Steuerzeichen unterhalb von Codepunkt 32, außer Tab/LF/CR) – ohne das
 * würde ein versehentlich eingetipptes Steuerzeichen (selten, aber möglich
 * z. B. beim Einfügen aus einer anderen Anwendung) eine für Excel
 * unlesbare Datei erzeugen. Arbeitet zeichenweise über Codepunkte statt mit
 * einer Regex-Zeichenklasse, damit hier keine schwer lesbaren
 * Steuerzeichen-Escapes im Quelltext stehen.
 */
function ohneUngueltigeXmlZeichen(text) {
  let ergebnis = '';
  for (const zeichen of text) {
    const code = zeichen.codePointAt(0);
    if (code === 9 || code === 10 || code === 13 || code >= 32) ergebnis += zeichen;
  }
  return ergebnis;
}

function xmlEscape(wert) {
  return ohneUngueltigeXmlZeichen(String(wert ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function istZahl(wert) {
  return typeof wert === 'number' && Number.isFinite(wert);
}

function baueSheetXml(spalten, zeilen) {
  const letzteSpalte = spaltenBuchstabe(Math.max(0, spalten.length - 1));
  const letzteZeile = Math.max(1, zeilen.length + 1);

  const cols = spalten
    .map((s, i) => {
      const breite = s.breite || Math.max(10, String(s.titel || '').length + 2);
      return `<col min="${i + 1}" max="${i + 1}" width="${breite}" customWidth="1"/>`;
    })
    .join('');

  const kopfzeile = `<row r="1">${spalten
    .map((s, i) => `<c r="${spaltenBuchstabe(i)}1" t="inlineStr" s="1"><is><t>${xmlEscape(s.titel)}</t></is></c>`)
    .join('')}</row>`;

  const datenzeilen = zeilen
    .map((zeile, zi) => {
      const r = zi + 2;
      const zellen = spalten
        .map((s, i) => {
          const wert = zeile[s.schluessel];
          const ref = `${spaltenBuchstabe(i)}${r}`;
          if (wert === null || wert === undefined || wert === '') return `<c r="${ref}"/>`;
          if (istZahl(wert)) return `<c r="${ref}" t="n"><v>${wert}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(wert)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r}">${zellen}</row>`;
    })
    .join('');

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<dimension ref="A1:${letzteSpalte}${letzteZeile}"/>` +
    `<sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${kopfzeile}${datenzeilen}</sheetData>` +
    `<autoFilter ref="A1:${letzteSpalte}${letzteZeile}"/>` +
    `</worksheet>`
  );
}

const CONTENT_TYPES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
  `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
  `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
  `</Types>`;

const RELS_ROOT =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
  `</Relationships>`;

const RELS_WORKBOOK =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
  `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><sz val="11"/><name val="Calibri"/><b/></font></fonts>` +
  `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
  `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
  `<cellXfs count="2">` +
  `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
  `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
  `</cellXfs>` +
  `</styleSheet>`;

function workbookXml(blattname) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlEscape(blattname)}" sheetId="1" r:id="rId1"/></sheets>` +
    `</workbook>`
  );
}

/** Excel-Tabellenblattnamen: max. 31 Zeichen, ohne eckige Klammern, Doppelpunkt, Stern, Schrägstriche. */
function sicherBlattname(name) {
  const bereinigt = String(name || 'Tabelle1')
    .split('')
    .map((z) => (['[', ']', ':', '*', '?', '/', '\\'].includes(z) ? ' ' : z))
    .join('')
    .trim();
  return bereinigt.slice(0, 31) || 'Tabelle1';
}

function xlsxDateien({ blattname = 'Tabelle1', spalten, zeilen }) {
  return {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': RELS_ROOT,
    'xl/workbook.xml': workbookXml(sicherBlattname(blattname)),
    'xl/_rels/workbook.xml.rels': RELS_WORKBOOK,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': baueSheetXml(spalten, zeilen),
  };
}

/**
 * Schreibt eine XLSX-Datei mit genau einem Arbeitsblatt.
 * `spalten`: [{ schluessel, titel, breite? }] – `schluessel` liest den Wert
 * aus jedem Objekt in `zeilen`, `titel` erscheint fett in der Kopfzeile.
 */
function schreibeXlsx(filePath, angaben) {
  const zip = new AdmZip();
  for (const [pfad, inhalt] of Object.entries(xlsxDateien(angaben))) {
    zip.addFile(pfad, Buffer.from(inhalt, 'utf8'));
  }
  zip.writeZip(filePath);
}

/** Wie schreibeXlsx, liefert aber den fertigen Buffer statt eine Datei zu schreiben (für Tests). */
function xlsxAlsBuffer(angaben) {
  const zip = new AdmZip();
  for (const [pfad, inhalt] of Object.entries(xlsxDateien(angaben))) {
    zip.addFile(pfad, Buffer.from(inhalt, 'utf8'));
  }
  return zip.toBuffer();
}

module.exports = { schreibeXlsx, xlsxAlsBuffer, spaltenBuchstabe, sicherBlattname };
