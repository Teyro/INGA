/**
 * Umlaufliste (Abschnitt 4) sowie die dafür gebauten allgemeinen
 * Export-Bausteine (CSV für deutsches Excel, minimaler XLSX-Schreiber).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../src/main/db.js');
const repo = require('../src/main/repo.js');
const { alsExcelCsv } = require('../src/main/export.js');
const { xlsxAlsBuffer, spaltenBuchstabe, sicherBlattname } = require('../src/main/xlsx.js');
const { DEFAULT_SETTINGS } = require('../src/main/store.js');
const AdmZip = require('adm-zip');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-umlauf-test-'));
}

const basisEinstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 7, verlaengerungDauerTage: 7 };

test('umlaufliste: enthält Klasse, Kind, Fälligkeit und Verlängerungen für jede offene Ausleihe', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Wanderndes Buch', Autor: 'A. Utor' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'U-0001' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Max', AusweisId: 'U-L-1', Jahrgang: '4a' });
  repo.ausleihen(db, { medienNi, leserNi, einstellungen: basisEinstellungen });

  const liste = repo.umlaufliste(db, basisEinstellungen);
  assert.equal(liste.length, 1);
  const zeile = liste[0];
  assert.equal(zeile.Titel, 'Wanderndes Buch');
  assert.equal(zeile.MedienEtik, 'U-0001');
  assert.equal(zeile.Nachname, 'Muster');
  assert.equal(zeile.Jahrgang, '4a');
  assert.equal(zeile.AnzVerl, 0);
  assert.ok(zeile.faelligAm);
  db.close();
});

test('umlaufliste: zurückgegebene Ausleihen tauchen nicht mehr auf', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Zurück im Regal' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'U-0002' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Mia', AusweisId: 'U-L-2' });
  const { id } = repo.ausleihen(db, { medienNi, leserNi, einstellungen: basisEinstellungen });
  repo.zurueckgeben(db, id);

  assert.equal(repo.umlaufliste(db, basisEinstellungen).length, 0);
  db.close();
});

test('alsExcelCsv: BOM, Semikolon-Trennzeichen und Quoting für deutsches Excel', () => {
  const csv = alsExcelCsv(
    [{ schluessel: 'titel', titel: 'Titel' }, { schluessel: 'info', titel: 'Info' }],
    [{ titel: 'Häschen', info: 'a;b' }, { titel: 'Zeile mit "Zitat"', info: 'ok' }]
  );
  const bytes = Buffer.from(csv, 'utf8');
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'Datei muss mit UTF-8-BOM beginnen');
  assert.ok(csv.includes('Titel;Info\r\n'));
  assert.ok(csv.includes('Häschen;"a;b"\r\n'), 'ein Semikolon im Wert muss in Anführungszeichen stehen');
  assert.ok(csv.includes('"Zeile mit ""Zitat""";ok\r\n'), 'Anführungszeichen im Wert werden verdoppelt');
});

test('spaltenBuchstabe: A..Z, dann AA..', () => {
  assert.equal(spaltenBuchstabe(0), 'A');
  assert.equal(spaltenBuchstabe(25), 'Z');
  assert.equal(spaltenBuchstabe(26), 'AA');
});

test('sicherBlattname: entfernt in Excel verbotene Zeichen und kappt auf 31 Zeichen', () => {
  const ergebnis = sicherBlattname('Import: Test/Sonder*Zeichen[eckig]');
  assert.equal(ergebnis.length, 31);
  assert.ok(!/[[\]:*?/\\]/.test(ergebnis), 'darf keines der verbotenen Zeichen mehr enthalten');
  assert.equal(ergebnis, 'Import  Test Sonder Zeichen eck');
  assert.equal(sicherBlattname('x'.repeat(50)).length, 31);
  assert.equal(sicherBlattname(''), 'Tabelle1');
});

test('xlsxAlsBuffer: erzeugt ein gültiges Zip mit allen Pflichtteilen einer XLSX-Datei', () => {
  const buf = xlsxAlsBuffer({
    blattname: 'Testblatt',
    spalten: [{ schluessel: 'a', titel: 'Spalte A' }, { schluessel: 'b', titel: 'Zahl' }],
    zeilen: [{ a: 'Häschen & <Freunde>', b: 3 }, { a: 'Ümlaut "Test"', b: 0 }],
  });
  const zip = new AdmZip(buf);
  const namen = zip.getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(namen, [
    '[Content_Types].xml',
    '_rels/.rels',
    'xl/_rels/workbook.xml.rels',
    'xl/styles.xml',
    'xl/workbook.xml',
    'xl/worksheets/sheet1.xml',
  ]);

  const workbook = zip.getEntry('xl/workbook.xml').getData().toString('utf8');
  assert.ok(workbook.includes('Testblatt'));

  const sheet = zip.getEntry('xl/worksheets/sheet1.xml').getData().toString('utf8');
  assert.ok(sheet.includes('<t>Spalte A</t>'));
  assert.ok(sheet.includes('Häschen &amp; &lt;Freunde&gt;'), 'Sonderzeichen müssen XML-escaped sein');
  assert.ok(sheet.includes('<v>3</v>'), 'Zahlen als numerische Zelle, nicht als Text');
  assert.ok(sheet.includes('autoFilter'), 'Autofilter über die Tabelle muss gesetzt sein');
  assert.ok(sheet.includes('s="1"'), 'Kopfzeile referenziert den fetten Style');

  // Grobe Wohlgeformtheits-Prüfung je XML-Teil: jeder öffnende Tag (der
  // nicht selbstschließend ist) hat einen passenden schließenden Tag.
  for (const entry of zip.getEntries()) {
    const xml = entry.getData().toString('utf8');
    const oeffnend = xml.match(/<([a-zA-Z][\w:]*)(\s[^>]*)?(?<!\/)>/g) || [];
    const schliessend = xml.match(/<\/[a-zA-Z][\w:]*>/g) || [];
    assert.equal(oeffnend.length, schliessend.length, `${entry.entryName}: Tags nicht balanciert`);
  }
});
