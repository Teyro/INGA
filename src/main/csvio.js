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
const { NATIVE_TABLES, DERIVED_TABLES, LEGACY_TABLES, ID_BASIERTE_TABELLEN, TABLES, quoteIdent } = require('./db');

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

function importZip(db, filePath, { onProgress } = {}) {
  const zip = new AdmZip(filePath);
  const entries = new Map(zip.getEntries().map((e) => [e.entryName.replace(/\.csv$/i, ''), e]));

  const importTx = db.transaction(() => {
    let done = 0;
    const total = Object.keys(TABLES).length;

    for (const table of Object.keys(TABLES)) {
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

    if (ID_BASIERTE_TABELLEN.has(table) || (NATIVE_TABLES[table] !== undefined && !DERIVED_TABLES.has(table))) {
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
