'use strict';

/**
 * Import und Export im Perpustakaan-Format: ein Zip mit 65 CSV-Dateien,
 * Semikolon-getrennt, CRLF-Zeilenenden, UTF-8, ohne Anführungszeichen oder
 * Maskierung – in keiner der 65 Originaltabellen kommt ein Semikolon oder
 * Anführungszeichen innerhalb eines Feldes vor, das Format verzichtet deshalb
 * bewusst auf CSV-Quoting (Kompatibilität geht vor Robustheit gegen Grenzfälle,
 * die im Original nie auftreten).
 */

const AdmZip = require('adm-zip');
const { NATIVE_TABLES, DERIVED_TABLES, LEGACY_TABLES, ID_BASIERTE_TABELLEN, TABLES, quoteIdent, medArtStandardVerbergen } = require('./db');

function parseCsv(text) {
  const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
  if (!lines.length) return { header: [], rows: [] };
  const header = lines[0].split(';');
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(';');
    const row = {};
    header.forEach((col, i) => {
      row[col] = cells[i] ?? '';
    });
    return row;
  });
  return { header, rows };
}

function serializeCsv(header, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    // Sollte doch einmal ein Semikolon oder Zeilenumbruch auftreten (z. B. ein
    // frei getippter Notiztext in INGA), wird er entschärft statt die Datei zu
    // zerstören – das Original selbst erzeugt so etwas nie.
    return /[;\r\n]/.test(s) ? s.replace(/[;\r\n]/g, ' ') : s;
  };
  const lines = [header.join(';')];
  for (const row of rows) lines.push(header.map((col) => esc(row[col])).join(';'));
  return lines.join('\r\n') + '\r\n';
}

/* ------------------------------------------------------------- Import */

/**
 * Ausleihe + AuslHist zusammengeführt statt wie die übrigen Tabellen 1:1
 * spaltenweise übernommen. Im Original (Perpustakaan) führt "Ausleihe" NUR
 * die gerade laufenden Ausleihen – "Rueckgabe" trägt dort die FÄLLIGKEIT,
 * kein Rückgabevermerk. Sobald ein Medium zurückkommt, wandert die Zeile
 * nach "AuslHist" (dort ist "Rueckgabe" dann das tatsächliche
 * Rückgabedatum) und verschwindet aus "Ausleihe". INGA führt dagegen beides
 * in EINER Tabelle (offen = "Rueckgabe" NULL, siehe repo.js) – ohne diese
 * Zusammenführung würden importierte laufende Ausleihen fälschlich als
 * bereits zurückgegeben gelten (ihre Fälligkeit stünde ja schon in
 * "Rueckgabe"), und die komplette Rückgabehistorie ("AuslHist" ist keine
 * INGA-native Tabelle) verschwände unbemerkt in den unverstandenen Altdaten
 * (legacy_rows) – beides ist beim echten Import einer Perpustakaan-
 * Sicherung ("Perpustakaan Light") tatsächlich beobachtet worden. Rührt
 * keine der beiden Quelltabellen an, falls in `zip` keine von beiden
 * enthalten ist (z. B. ein Teil-Export) – wie beim generischen Pfad für die
 * übrigen Tabellen bleibt der bisherige INGA-Bestand dann unangetastet.
 */
function importAusleiheUndHistorie(db, ausleiheEntry, auslHistEntry) {
  if (!ausleiheEntry && !auslHistEntry) return;
  const cols = TABLES.Ausleihe; // AuslHist hat exakt dieselben Spalten
  db.prepare(`DELETE FROM "Ausleihe"`).run();
  const stmt = db.prepare(
    `INSERT INTO "Ausleihe" (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
  );
  if (ausleiheEntry) {
    const { rows } = parseCsv(ausleiheEntry.getData().toString('utf8'));
    for (const row of rows) {
      const params = {};
      for (const c of cols) params[c] = c === 'Rueckgabe' ? null : row[c] === '' ? null : row[c];
      stmt.run(params);
    }
  }
  if (auslHistEntry) {
    const { rows } = parseCsv(auslHistEntry.getData().toString('utf8'));
    for (const row of rows) {
      const params = {};
      for (const c of cols) params[c] = row[c] === '' ? null : row[c];
      stmt.run(params);
    }
  }
}

function importZip(db, filePath, { onProgress } = {}) {
  const zip = new AdmZip(filePath);
  const entries = new Map(zip.getEntries().map((e) => [e.entryName.replace(/\.csv$/i, ''), e]));

  const importTx = db.transaction(() => {
    let done = 0;
    const total = Object.keys(TABLES).length;

    importAusleiheUndHistorie(db, entries.get('Ausleihe'), entries.get('AuslHist'));
    done += 2;
    onProgress?.({ table: 'Ausleihe/AuslHist', done, total });

    for (const table of Object.keys(TABLES)) {
      if (table === 'Ausleihe' || table === 'AuslHist') continue; // siehe importAusleiheUndHistorie oben
      const entry = entries.get(table);
      done += 1;
      onProgress?.({ table, done, total });
      if (!entry) continue;
      const { header, rows } = parseCsv(entry.getData().toString('utf8'));
      if (!header.length) continue;

      if (ID_BASIERTE_TABELLEN.has(table)) {
        db.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
        const cols = TABLES[table];
        const stmt = db.prepare(
          `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
        );
        for (const row of rows) {
          const params = {};
          for (const c of cols) params[c] = row[c] === '' ? null : row[c];
          stmt.run(params);
        }
        continue;
      }

      if (NATIVE_TABLES[table] !== undefined && !DERIVED_TABLES.has(table)) {
        const pk = NATIVE_TABLES[table];
        const cols = TABLES[table];
        db.prepare(`DELETE FROM ${quoteIdent(table)}`).run();
        const stmt = db.prepare(
          `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
        );
        for (const row of rows) {
          const params = {};
          for (const c of cols) params[c] = row[c] === '' ? null : row[c];
          stmt.run(params);
        }
        // "verbergen" kennt das echte Perpustakaan nicht (kommt aus einer
        // Sicherung fast immer leer) – ohne diesen Schritt stünden nach jedem
        // Import wieder alle Medienarten in der Katalog-Auswahl, egal was in
        // den Einstellungen zuletzt bewusst gewählt wurde. Siehe
        // medArtStandardVerbergen() in db.js.
        if (table === 'MedArt') {
          const nachtragen = db.prepare(`UPDATE "MedArt" SET "verbergen" = ? WHERE "MedArtKb" = ? AND "verbergen" IS NULL`);
          for (const row of rows) {
            if (row.verbergen !== '' && row.verbergen !== undefined) continue;
            nachtragen.run(medArtStandardVerbergen(row.MedArtBz) ? 1 : 0, row.MedArtKb);
          }
        }
        continue;
      }

      if (DERIVED_TABLES.has(table)) continue; // wird nicht gespeichert, nur beim Export neu berechnet

      // Alles andere: unverändert als JSON-Zeilen sichern (Rechnungswesen,
      // Beschaffung, SEPA-Nebentabellen, Kurse, …) – INGA versteht sie nicht,
      // soll sie aber auch nicht verlieren.
      db.prepare(`DELETE FROM legacy_rows WHERE table_name = ?`).run(table);
      const stmt = db.prepare(`INSERT INTO legacy_rows (table_name, seq, data) VALUES (?, ?, ?)`);
      rows.forEach((row, i) => stmt.run(table, i, JSON.stringify(row)));

      // Header separat merken, falls er vom Referenzschema abweicht (neuere
      // Perpustakaan-Version mit zusätzlichen Spalten) – beim Export wird dann
      // dieser Header verwendet statt der eingebauten Referenz.
      db.prepare(`INSERT OR REPLACE INTO inga_meta (key, value) VALUES (?, ?)`).run(
        `legacy_header:${table}`,
        JSON.stringify(header)
      );
    }
  });

  importTx();
}

/* ------------------------------------------------------------- Export */

function computeStatMedien(db) {
  return db
    .prepare(
      `SELECT
         a."MedienNi" AS MedienNi,
         k."MedArtKb" AS MedArtKb,
         k."SystemId" AS SystemId,
         '' AS StatGruppe,
         a."LeserNi" AS LeserNi,
         l."LeserGruNi" AS LeserGruNi,
         l."PLZ" AS PLZ,
         l."AuslGruNi" AS AuslGruNi,
         a."AuslDatum" AS AuslDatum,
         '' AS AuslZeit,
         a."AnzVerl" AS Verlaeng
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
       WHERE a."Rueckgabe" IS NULL`
    )
    .all();
}

function exportZip(db, filePath) {
  const zip = new AdmZip();

  for (const table of Object.keys(TABLES)) {
    let header = TABLES[table];
    let rows;

    // Gegenstück zu importAusleiheUndHistorie: offene Ausleihen (Rueckgabe
    // NULL) gehen zurück nach "Ausleihe.csv" – ihre Fälligkeit kennt das
    // Perpustakaan-Format dort, INGA speichert aber keine feste Fälligkeit
    // (wird bei jeder Anzeige neu berechnet), das Feld bleibt deshalb leer,
    // statt eine möglicherweise falsche zu raten. Abgeschlossene Ausleihen
    // (Rueckgabe gesetzt) gehen nach "AuslHist.csv", mit dem tatsächlichen
    // Rückgabedatum.
    if (table === 'Ausleihe') {
      rows = db.prepare(`SELECT "MedienNi", "LeserNi", "AuslDatum", NULL AS "Rueckgabe", "AnzVerl", "ErfassAnw" FROM "Ausleihe" WHERE "Rueckgabe" IS NULL`).all();
    } else if (table === 'AuslHist') {
      rows = db.prepare(`SELECT * FROM "Ausleihe" WHERE "Rueckgabe" IS NOT NULL`).all();
    } else if (ID_BASIERTE_TABELLEN.has(table) || (NATIVE_TABLES[table] !== undefined && !DERIVED_TABLES.has(table))) {
      rows = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
    } else if (DERIVED_TABLES.has(table)) {
      rows = table === 'StatMedien' ? computeStatMedien(db) : [];
    } else {
      const storedHeader = db.prepare(`SELECT value FROM inga_meta WHERE key = ?`).get(`legacy_header:${table}`);
      if (storedHeader) header = JSON.parse(storedHeader.value);
      rows = db
        .prepare(`SELECT data FROM legacy_rows WHERE table_name = ? ORDER BY seq`)
        .all(table)
        .map((r) => JSON.parse(r.data));
    }

    zip.addFile(`${table}.csv`, Buffer.from(serializeCsv(header, rows), 'utf8'));
  }

  zip.writeZip(filePath);
}

module.exports = { importZip, exportZip, parseCsv, serializeCsv };
