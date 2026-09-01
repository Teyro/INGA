'use strict';

/**
 * Datenhaltung für INGA.
 *
 * Die Tabellen, die INGA selbst bearbeitet (Katalog, Medien, Leser, Ausleihe,
 * Mahnung und die Stammdaten-Tabellen), tragen exakt die Spaltennamen des
 * Perpustakaan-Exports – dadurch ist der Import/Export verlustfrei und ohne
 * Übersetzungsschicht möglich. Alle Tabellen, die INGA nicht selbst versteht
 * (Rechnungswesen, Beschaffung, SEPA-Nebentabellen, Kurse, …), landen unangetastet
 * als JSON-Zeilen in `legacy_rows` und werden beim Export wieder eingesetzt. So
 * bleibt ein Perpustakaan-Bestand nach einem Ausflug durch INGA vollständig.
 */

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const TABLES = require('../schema/perpustakaan-tables.json');
const { sichereDatenbankSync } = require('./backup');

// Tabelle → Primärschlüssel-Spalte. Fehlt ein Eintrag, verwaltet SQLite die Zeile
// über ihre eingebaute rowid (Ausleihe und Mahnung haben keinen natürlichen
// Einzelschlüssel – im Original identifiziert erst die Kombination aus Medium,
// Leser und Datum eine Zeile eindeutig).
const NATIVE_TABLES = {
  Katalog: 'KatalogNi',
  Medien: 'MedienNi',
  Leser: 'LeserNi',
  Ausleihe: null,
  Mahnung: null,
  MedArt: 'MedArtKb',
  Zweig: 'ZweigId',
  Systematik: 'SystemId',
  Sprache: 'SpracheNi',
  Reihe: 'ReiheNi',
  Schlagwort: 'SchlagwSort',
  LeserGrupp: 'LeserGruNi',
  AuslGrupp: 'AuslGruNi',
  Sperrung: 'SperrungNi',
  SperrKat: 'SperrKatNi',
  Parameter: 'ParmId',
  Mandant: 'MandantNi',
  Benutzer: 'BenutzerNi',
  Fachber: 'FachberNi',
  // Ursprünglich reine Legacy-Passthrough-Tabellen (INGA "verstand" sie
  // nicht, reichte sie nur unverändert durch) – seit dem Standort- und dem
  // erweiterten Status-Filter (Abschnitt 5) braucht INGA sie aktiv als
  // Stammdaten, siehe Migration Version 4 in MIGRATIONS unten.
  StandOrt: 'StOrtNi',
  Nichtverf: 'NichtVfNi',
  // Vormerkungen: kein *Ni-Einzelschlüssel im Original (LeserNi+KatalogNi
  // bilden zusammen eine Zeile) – bekommt wie Ausleihe/Mahnung eine eigene
  // id-Spalte, siehe die Sonderbehandlung unten und Migration Version 5.
  Vormerkung: null,
};

// StatMedien ist im Original eine abgeleitete Momentaufnahme der laufenden
// Ausleihen. INGA führt sie nicht als eigene Tabelle, sondern rechnet sie beim
// Export aus Ausleihe/Medien/Leser neu zusammen.
const DERIVED_TABLES = new Set(['StatMedien']);

// Tabellen mit eigener id-Spalte statt eines *Ni-Einzelschlüssels (siehe
// NATIVE_TABLES-Kommentare oben) – für die WHERE-Klausel unten UND für die
// Sonderbehandlung in createSchema()/csvio.js an einer Stelle gepflegt.
const ID_BASIERTE_TABELLEN = new Set(['Ausleihe', 'Mahnung', 'Vormerkung']);

const LEGACY_TABLES = Object.keys(TABLES).filter(
  (name) => !NATIVE_TABLES[name] && !ID_BASIERTE_TABELLEN.has(name) && !DERIVED_TABLES.has(name)
);

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function createSchema(db) {
  // Der Perpustakaan-Namenskonvention nach sind *Ni-Spalten durchlaufende
  // Nummern (KatalogNi, MedienNi, LeserNi, LeserGruNi …) – die werden als
  // „INTEGER PRIMARY KEY“ angelegt (SQLite-rowid-Alias, passend zu nextId()).
  // *Kb/*Id/*Sort-Spalten sind dagegen kurze Textcodes (MedArtKb wie "Buc",
  // ZweigId wie "N", ParmId wie "backupDate") – ein rowid-Alias würde bei
  // deren Import mit „datatype mismatch“ abbrechen, weil er zwingend eine
  // ganze Zahl verlangt. Die bekommen ein typloses PRIMARY KEY: erzwingt nur
  // Eindeutigkeit, keine Typumwandlung.
  for (const [table, pk] of Object.entries(NATIVE_TABLES)) {
    if (ID_BASIERTE_TABELLEN.has(table)) continue; // eigene id-Spalte, siehe unten
    const columns = TABLES[table];
    const pkType = pk && pk.endsWith('Ni') ? 'INTEGER PRIMARY KEY' : 'PRIMARY KEY';
    const defs = columns.map((col) => {
      if (col === pk) return `${quoteIdent(col)} ${pkType}`;
      return quoteIdent(col);
    });
    db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${defs.join(', ')})`);
  }

  db.exec(`CREATE TABLE IF NOT EXISTS "Ausleihe" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${TABLES.Ausleihe.map(quoteIdent).join(', ')}
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS "Mahnung" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${TABLES.Mahnung.map(quoteIdent).join(', ')}
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS "Vormerkung" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ${TABLES.Vormerkung.map(quoteIdent).join(', ')}
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_vormerkung_katalog ON "Vormerkung" ("KatalogNi")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_vormerkung_leser ON "Vormerkung" ("LeserNi")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ausleihe_offen ON "Ausleihe" ("Rueckgabe")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ausleihe_leser ON "Ausleihe" ("LeserNi")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ausleihe_medien ON "Ausleihe" ("MedienNi")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_medien_katalog ON "Medien" ("KatalogNi")`);
  // Zusammengesetzte Indizes für die häufigen "offene Ausleihe zu X"-Abfragen
  // (Exemplarstatus, Verfügbarkeitszähler im Katalog, offene-Ausleihen-Zähler
  // je Nutzer) – vermeidet einen Extra-Lookup über den Einzelspalten-Index.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ausleihe_medien_offen ON "Ausleihe" ("MedienNi", "Rueckgabe")`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_ausleihe_leser_offen ON "Ausleihe" ("LeserNi", "Rueckgabe")`);

  db.exec(`CREATE TABLE IF NOT EXISTS legacy_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    seq INTEGER NOT NULL,
    data TEXT NOT NULL
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_legacy_table ON legacy_rows (table_name)`);

  db.exec(`CREATE TABLE IF NOT EXISTS inga_meta (key TEXT PRIMARY KEY, value TEXT)`);

  // Buchcover: rein INGA-intern (kein Perpustakaan-Feld), deshalb außerhalb von
  // TABLES/NATIVE_TABLES geführt und nicht Teil von Import/Export. Die
  // eigentliche Bilddatei liegt im userData-Ordner, hier steht nur der Verweis.
  db.exec(`CREATE TABLE IF NOT EXISTS inga_covers (
    "KatalogNi" INTEGER PRIMARY KEY,
    "dateiname" TEXT NOT NULL,
    "quelle" TEXT,
    "aktualisiert" TEXT
  )`);
}

/**
 * Schema-Migrationen für alles, was über die Basistabellen aus createSchema()
 * hinausgeht (die per "CREATE TABLE IF NOT EXISTS" bereits selbst idempotent
 * und für neue wie bestehende Datenbanken geeignet sind). SCHEMA_VERSION 1
 * ist der Stand, den createSchema() abbildet; künftige Phasen hängen hier
 * weitere Einträge an.
 *
 * Anforderungen an jede Migration:
 *  - `up(db)` muss auf einer bereits befüllten, produktiven Datenbank sauber
 *    laufen und darf nie Daten verwerfen (additiv: neue Tabellen/Spalten/
 *    Indizes, keine DROP/DELETE auf bestehenden Fachdaten).
 *  - Läuft in einer eigenen Transaktion – schlägt sie fehl, bleibt die
 *    Datenbank auf dem vorherigen Versionsstand stehen statt halb migriert.
 *  - Vor der ersten tatsächlich fälligen Migration sichert openDatabase()
 *    automatisch die bisherige Datenbankdatei (siehe backup.js).
 *
 * Beispiel für eine künftige Phase:
 *   { version: 2, beschreibung: 'Ferien-Tabelle', up(db) {
 *       db.exec(`CREATE TABLE IF NOT EXISTS ferien ( ... )`);
 *     } }
 */
/**
 * Übernimmt Altdaten einer Tabelle, die bislang nur als opake JSON-Zeilen in
 * legacy_rows lag (ein Perpustakaan-Import, bevor INGA die Tabelle selbst
 * verstand), in die frisch angelegte native Tabelle – und räumt legacy_rows
 * danach auf. `insertSql` bekommt die Spalten als @Spaltenname-Platzhalter
 * übergeben (fertig zusammengesetzt vom Aufrufer, da INSERT vs.
 * INSERT OR IGNORE je nach Zieltabelle unterschiedlich sein kann).
 */
function uebernehmeLegacyAltdaten(db, table, columns, insertSql) {
  const vorhandene = db.prepare(`SELECT data FROM legacy_rows WHERE table_name = ? ORDER BY seq`).all(table);
  if (!vorhandene.length) return;
  const stmt = db.prepare(insertSql);
  for (const zeile of vorhandene) {
    const parsed = JSON.parse(zeile.data);
    const params = {};
    for (const c of columns) params[c] = parsed[c] === '' || parsed[c] === undefined ? null : parsed[c];
    stmt.run(params);
  }
  db.prepare(`DELETE FROM legacy_rows WHERE table_name = ?`).run(table);
  db.prepare(`DELETE FROM inga_meta WHERE key = ?`).run(`legacy_header:${table}`);
}

const SCHEMA_VERSION = 5;
const MIGRATIONS = [
  {
    version: 2,
    beschreibung: 'Ferien-Tabelle für die Ferienverwaltung (manuell, ICS-Import, API-Abruf)',
    up(db) {
      // Rein INGA-intern (kein Perpustakaan-Feld, siehe inga_covers) – deshalb
      // eigene, sprechende Spaltennamen statt der Perpustakaan-Konvention.
      db.exec(`CREATE TABLE IF NOT EXISTS ferien (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bezeichnung TEXT NOT NULL,
        startdatum TEXT NOT NULL,
        enddatum TEXT NOT NULL,
        typ TEXT NOT NULL DEFAULT 'Ferien',
        quelle TEXT NOT NULL DEFAULT 'manuell'
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_ferien_zeitraum ON ferien (startdatum, enddatum)`);
    },
  },
  {
    version: 3,
    beschreibung: 'Indizes für Katalog-/Nutzerfilter (Pagination-Fix: datenbankseitiges statt Im-Speicher-Filtern)',
    up(db) {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_katalog_titel ON "Katalog" ("Titel")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_katalog_medart ON "Katalog" ("MedArtKb")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_katalog_system ON "Katalog" ("SystemId")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leser_name ON "Leser" ("Nachname", "Vorname")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leser_gruppe ON "Leser" ("LeserGruNi")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leser_zweig ON "Leser" ("ZweigId")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_leser_sperrung ON "Leser" ("SperrungNi")`);
    },
  },
  {
    version: 4,
    beschreibung:
      'StandOrt/Nichtverf werden echte Stammdaten-Tabellen statt nur Legacy-Passthrough (Standort- und erweiterter Status-Filter)',
    up(db) {
      // Beide Tabellen waren bisher reiner Legacy-Passthrough (INGA "verstand"
      // sie nicht, reichte sie beim Import/Export nur unverändert als JSON in
      // legacy_rows durch, siehe LEGACY_TABLES) – für den neuen Standort- und
      // Status-Filter (Abschnitt 5) braucht INGA sie jetzt aktiv als
      // Stammdaten, genau wie MedArt/Zweig/Systematik. createSchema() legt sie
      // für neue Datenbanken über NATIVE_TABLES bereits an; hier zusätzlich
      // idempotent (falls diese Migration vor einem createSchema-Update
      // greift) UND mit Übernahme bereits vorhandener Altdaten.
      for (const table of ['StandOrt', 'Nichtverf']) {
        const pk = NATIVE_TABLES[table];
        const columns = TABLES[table];
        const defs = columns.map((col) => (col === pk ? `${quoteIdent(col)} INTEGER PRIMARY KEY` : quoteIdent(col)));
        db.exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (${defs.join(', ')})`);
        uebernehmeLegacyAltdaten(
          db,
          table,
          columns,
          `INSERT OR IGNORE INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
           VALUES (${columns.map((c) => `@${c}`).join(', ')})`
        );
      }
    },
  },
  {
    version: 5,
    beschreibung: 'Vormerkung wird eine echte Tabelle statt nur Legacy-Passthrough (Vormerkungen/Reservierungen)',
    up(db) {
      // Kein *Ni-Einzelschlüssel im Original (LeserNi+KatalogNi bilden
      // zusammen eine Zeile) – bekommt wie Ausleihe/Mahnung eine eigene
      // id-Spalte (siehe createSchema()/ID_BASIERTE_TABELLEN).
      const columns = TABLES.Vormerkung;
      db.exec(`CREATE TABLE IF NOT EXISTS "Vormerkung" (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ${columns.map(quoteIdent).join(', ')}
      )`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vormerkung_katalog ON "Vormerkung" ("KatalogNi")`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_vormerkung_leser ON "Vormerkung" ("LeserNi")`);
      uebernehmeLegacyAltdaten(
        db,
        'Vormerkung',
        columns,
        `INSERT INTO "Vormerkung" (${columns.map(quoteIdent).join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
      );
    },
  },
];

function gespeicherteSchemaVersion(db) {
  const row = db.prepare(`SELECT value FROM inga_meta WHERE key = 'schema_version'`).get();
  return row ? Number(row.value) || 0 : 0;
}

function setzeSchemaVersion(db, version) {
  db.prepare(
    `INSERT INTO inga_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(version));
}

/**
 * Führt alle noch nicht angewendeten Migrationen aus (aufsteigend nach
 * Version), jede in ihrer eigenen Transaktion. `vorAllen` wird genau einmal
 * VOR der ersten fälligen Migration aufgerufen – der Aufrufer hängt hier das
 * automatische Backup ein. Auf einer frisch angelegten Datenbank (noch keine
 * gespeicherte Version, aber auch keine fälligen Migrationen älter als
 * SCHEMA_VERSION) wird nur der Versionsstand vermerkt, ohne Backup.
 */
function migriere(db, { vorAllen } = {}) {
  const bisher = gespeicherteSchemaVersion(db);
  const faellig = MIGRATIONS.filter((m) => m.version > bisher).sort((a, b) => a.version - b.version);
  if (!faellig.length) {
    if (bisher < SCHEMA_VERSION) setzeSchemaVersion(db, SCHEMA_VERSION);
    return { bisher, angewendet: [] };
  }
  vorAllen?.();
  const angewendet = [];
  for (const m of faellig) {
    const tx = db.transaction(() => {
      m.up(db);
      setzeSchemaVersion(db, m.version);
    });
    tx();
    angewendet.push(m.version);
  }
  return { bisher, angewendet };
}

function openDatabase(userDataDir) {
  const file = path.join(userDataDir, 'inga.sqlite3');
  const backupDir = path.join(userDataDir, 'backups');
  const bestandVorher = fs.existsSync(file);
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  createSchema(db);
  // Backup nur, wenn vor dem Öffnen bereits eine Datenbank existierte und
  // tatsächlich eine Migration ansteht – eine brandneue, leere Datenbank
  // muss nicht gesichert werden.
  migriere(db, {
    vorAllen: bestandVorher ? () => sichereDatenbankSync(db, file, backupDir, { grund: 'migration' }) : undefined,
  });
  return db;
}

/* --------------------------------------------------------- Kleine Helfer */

function upsert(db, table, row) {
  const pk = NATIVE_TABLES[table];
  const columns = TABLES[table];
  const cols = columns.filter((c) => Object.hasOwn(row, c));
  if (!cols.length) throw new Error(`${table}: keine bekannten Spalten in der Zeile`);
  const placeholders = cols.map((c) => `@${c}`);
  const updateSet = cols.filter((c) => c !== pk).map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`);
  const sql = `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')})
    VALUES (${placeholders.join(', ')})
    ${pk ? `ON CONFLICT(${quoteIdent(pk)}) DO UPDATE SET ${updateSet.join(', ')}` : ''}`;
  const stmt = db.prepare(sql);
  const params = {};
  for (const c of cols) params[c] = row[c] ?? null;
  const info = stmt.run(params);
  return pk ? row[pk] ?? info.lastInsertRowid : info.lastInsertRowid;
}

function nextId(db, table, pk) {
  const row = db.prepare(`SELECT MAX(${quoteIdent(pk)}) AS m FROM ${quoteIdent(table)}`).get();
  return (row?.m || 0) + 1;
}

module.exports = {
  openDatabase,
  upsert,
  nextId,
  quoteIdent,
  NATIVE_TABLES,
  DERIVED_TABLES,
  LEGACY_TABLES,
  ID_BASIERTE_TABELLEN,
  TABLES,
  SCHEMA_VERSION,
  MIGRATIONS,
  migriere,
  gespeicherteSchemaVersion,
};
