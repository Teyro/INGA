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
};

// StatMedien ist im Original eine abgeleitete Momentaufnahme der laufenden
// Ausleihen. INGA führt sie nicht als eigene Tabelle, sondern rechnet sie beim
// Export aus Ausleihe/Medien/Leser neu zusammen.
const DERIVED_TABLES = new Set(['StatMedien']);

const LEGACY_TABLES = Object.keys(TABLES).filter(
  (name) => !NATIVE_TABLES[name] && name !== 'Ausleihe' && name !== 'Mahnung' && !DERIVED_TABLES.has(name)
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
    if (table === 'Ausleihe' || table === 'Mahnung') continue; // eigene id-Spalte, siehe unten
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
const SCHEMA_VERSION = 1;
const MIGRATIONS = [];

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
  TABLES,
  SCHEMA_VERSION,
  MIGRATIONS,
  migriere,
  gespeicherteSchemaVersion,
};
