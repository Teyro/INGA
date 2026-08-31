'use strict';

/** Fachliche Datenzugriffe: Katalog, Exemplare, Leser, Ausleihe/Rückgabe, Mahnwesen. */

const { upsert, nextId, quoteIdent, TABLES } = require('./db');

const todayStr = () => new Date().toISOString().slice(0, 10) + ' 00:00:00.000';
const nowStamp = () => new Date().toISOString().slice(0, 19).replace('T', ' ') + '.000';

/* ------------------------------------------------------------- Katalog */

function searchKatalog(db, query, limit = 200) {
  if (!query) {
    return db.prepare(`SELECT * FROM "Katalog" ORDER BY "Titel" LIMIT ?`).all(limit);
  }
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM "Katalog"
       WHERE "Titel" LIKE ? OR "Autor" LIKE ? OR "ISBN" LIKE ? OR "EAN" LIKE ? OR "Schlagwort" LIKE ?
       ORDER BY "Titel" LIMIT ?`
    )
    .all(like, like, like, like, like, limit);
}

function getKatalog(db, katalogNi) {
  return db.prepare(`SELECT * FROM "Katalog" WHERE "KatalogNi" = ?`).get(katalogNi);
}

function saveKatalog(db, row) {
  const clean = { ...row };
  if (!clean.KatalogNi) clean.KatalogNi = nextId(db, 'Katalog', 'KatalogNi');
  if (!clean.ErfassDat) clean.ErfassDat = nowStamp();
  return upsert(db, 'Katalog', clean);
}

function deleteKatalog(db, katalogNi) {
  db.prepare(`DELETE FROM "Medien" WHERE "KatalogNi" = ?`).run(katalogNi);
  db.prepare(`DELETE FROM "Katalog" WHERE "KatalogNi" = ?`).run(katalogNi);
}

/* -------------------------------------------------------------- Medien */

function exemplareFuer(db, katalogNi) {
  return db.prepare(`SELECT * FROM "Medien" WHERE "KatalogNi" = ? ORDER BY "MedienNi"`).all(katalogNi);
}

function findExemplarByEtikett(db, etikett) {
  return db.prepare(`SELECT * FROM "Medien" WHERE "MedienEtik" = ?`).get(etikett);
}

function saveMedium(db, row) {
  const clean = { ...row };
  if (!clean.MedienNi) clean.MedienNi = nextId(db, 'Medien', 'MedienNi');
  if (!clean.ErfassDat) clean.ErfassDat = nowStamp();
  return upsert(db, 'Medien', clean);
}

function deleteMedium(db, medienNi) {
  db.prepare(`DELETE FROM "Medien" WHERE "MedienNi" = ?`).run(medienNi);
}

/** Ist das Exemplar gerade verliehen? */
function exemplarStatus(db, medienNi) {
  const offen = db
    .prepare(`SELECT * FROM "Ausleihe" WHERE "MedienNi" = ? AND "Rueckgabe" IS NULL`)
    .get(medienNi);
  return offen ? { verliehen: true, ausleihe: offen } : { verliehen: false, ausleihe: null };
}

/* --------------------------------------------------------------- Leser */

function searchLeser(db, query, limit = 200) {
  if (!query) {
    return db.prepare(`SELECT * FROM "Leser" ORDER BY "Nachname", "Vorname" LIMIT ?`).all(limit);
  }
  const like = `%${query}%`;
  return db
    .prepare(
      `SELECT * FROM "Leser"
       WHERE "Nachname" LIKE ? OR "Vorname" LIKE ? OR "AusweisId" LIKE ? OR "Kuerzel" LIKE ?
       ORDER BY "Nachname", "Vorname" LIMIT ?`
    )
    .all(like, like, like, like, limit);
}

function getLeser(db, leserNi) {
  return db.prepare(`SELECT * FROM "Leser" WHERE "LeserNi" = ?`).get(leserNi);
}

function saveLeser(db, row) {
  const clean = { ...row };
  if (!clean.LeserNi) clean.LeserNi = nextId(db, 'Leser', 'LeserNi');
  if (!clean.ImportDat) clean.ImportDat = nowStamp();
  return upsert(db, 'Leser', clean);
}

function deleteLeser(db, leserNi) {
  db.prepare(`DELETE FROM "Leser" WHERE "LeserNi" = ?`).run(leserNi);
}

/** Läuft eine Sperrung oder ist das Ausleih-Enddatum überschritten? */
function leserGesperrt(db, leserNi) {
  const leser = getLeser(db, leserNi);
  if (!leser) return { gesperrt: true, grund: 'unbekannter Leser' };
  if (leser.SperrungNi && leser.SperrungNi !== 0) {
    const sperr = db.prepare(`SELECT * FROM "Sperrung" WHERE "SperrungNi" = ?`).get(leser.SperrungNi);
    if (sperr) return { gesperrt: true, grund: sperr.SperrungBz || 'gesperrt' };
  }
  if (leser.AusleihBis && String(leser.AusleihBis).slice(0, 10) < todayStr().slice(0, 10)) {
    return { gesperrt: true, grund: 'Ausleihberechtigung abgelaufen' };
  }
  return { gesperrt: false, grund: null };
}

/* ---------------------------------------------------------- Ausleihe */

function offeneAusleihenVonLeser(db, leserNi) {
  return db
    .prepare(
      `SELECT a.*, m."MedienEtik", k."Titel", k."Autor"
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       WHERE a."LeserNi" = ? AND a."Rueckgabe" IS NULL
       ORDER BY a."AuslDatum"`
    )
    .all(leserNi);
}

function alleOffenenAusleihen(db) {
  return db
    .prepare(
      `SELECT a.*, m."MedienEtik", k."Titel", k."Autor", l."Nachname", l."Vorname"
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
       ORDER BY a."AuslDatum"`
    )
    .all();
}

/** Leihfrist in Tagen: zuerst die Medienart, sonst die Vorgabe aus den Einstellungen. */
function leihfristTage(db, katalogNi, fallbackTage) {
  const katalog = getKatalog(db, katalogNi);
  if (katalog?.MedArtKb) {
    const art = db.prepare(`SELECT * FROM "MedArt" WHERE "MedArtKb" = ?`).get(katalog.MedArtKb);
    if (art?.Frist) return Number(art.Frist);
  }
  return fallbackTage;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Ausleihen: prüft Sperre und Doppelausleihe, legt den Datensatz an.
 * Wirft eine Error mit sprechender Meldung, wenn es nicht geht – der Aufrufer
 * (IPC-Handler) reicht die Meldung unverändert an die Oberfläche weiter.
 */
function ausleihen(db, { medienNi, leserNi, benutzer, leihfristTageVorgabe }) {
  const medium = db.prepare(`SELECT * FROM "Medien" WHERE "MedienNi" = ?`).get(medienNi);
  if (!medium) throw new Error('Unbekanntes Exemplar.');
  const status = exemplarStatus(db, medienNi);
  if (status.verliehen) throw new Error('Dieses Exemplar ist bereits ausgeliehen.');
  const sperre = leserGesperrt(db, leserNi);
  if (sperre.gesperrt) throw new Error(`Ausleihe nicht möglich: ${sperre.grund}.`);

  const stmt = db.prepare(
    `INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl","ErfassAnw")
     VALUES (@MedienNi, @LeserNi, @AuslDatum, NULL, 0, @ErfassAnw)`
  );
  const info = stmt.run({
    MedienNi: medienNi,
    LeserNi: leserNi,
    AuslDatum: todayStr(),
    ErfassAnw: benutzer || 'inga',
  });
  return { id: info.lastInsertRowid, faelligAm: addDays(todayStr(), leihfristTage(db, medium.KatalogNi, leihfristTageVorgabe)) };
}

function zurueckgeben(db, ausleiheId) {
  db.prepare(`UPDATE "Ausleihe" SET "Rueckgabe" = ? WHERE id = ? AND "Rueckgabe" IS NULL`).run(todayStr(), ausleiheId);
}

function verlaengern(db, ausleiheId, maxVerlaengerung) {
  const row = db.prepare(`SELECT * FROM "Ausleihe" WHERE id = ?`).get(ausleiheId);
  if (!row) throw new Error('Ausleihe nicht gefunden.');
  if (row.Rueckgabe) throw new Error('Bereits zurückgegeben.');
  if ((row.AnzVerl || 0) >= maxVerlaengerung) throw new Error('Maximale Anzahl Verlängerungen erreicht.');
  db.prepare(`UPDATE "Ausleihe" SET "AnzVerl" = "AnzVerl" + 1 WHERE id = ?`).run(ausleiheId);
}

/**
 * Überfällige Ausleihen mit der passenden Mahnstufe (nach Tagen seit Ausleihe,
 * Leihfrist der Medienart eingerechnet). Nutzt Mahnstufen aus den Einstellungen.
 */
function ueberfaelligeMitStufe(db, { mahnstufen, leihfristTageVorgabe }) {
  const offen = alleOffenenAusleihen(db);
  const heute = new Date();
  const ergebnis = [];
  for (const a of offen) {
    const frist = leihfristTage(db, undefined, leihfristTageVorgabe);
    const faelligAm = new Date(addDays(a.AuslDatum, frist));
    const tageUeberfaellig = Math.floor((heute - faelligAm) / (1000 * 60 * 60 * 24));
    if (tageUeberfaellig <= 0) continue;
    let stufe = null;
    for (const s of mahnstufen) {
      if (tageUeberfaellig >= s.tageUeberfaellig) stufe = s;
    }
    if (stufe) ergebnis.push({ ...a, tageUeberfaellig, faelligAm: faelligAm.toISOString().slice(0, 10), stufe });
  }
  return ergebnis;
}

function mahnungEintragen(db, { medienNi, leserNi, auslDatum, gebuehr }) {
  db.prepare(
    `INSERT INTO "Mahnung" ("MedienNi","LeserNi","Mahndatum","MaGebuehr","AuslDatum","Rueckgabe")
     VALUES (?, ?, ?, ?, ?, NULL)`
  ).run(medienNi, leserNi, todayStr(), gebuehr, auslDatum);
}

function mahnhistorieVonLeser(db, leserNi) {
  return db
    .prepare(
      `SELECT mh.*, k."Titel" FROM "Mahnung" mh
       JOIN "Medien" me ON me."MedienNi" = mh."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = me."KatalogNi"
       WHERE mh."LeserNi" = ? ORDER BY mh."Mahndatum" DESC`
    )
    .all(leserNi);
}

/* ---------------------------------------------------------- Stammdaten */

function stammdaten(db) {
  const out = {};
  for (const table of ['MedArt', 'Zweig', 'Systematik', 'Sprache', 'Reihe', 'LeserGrupp', 'AuslGrupp', 'Sperrung', 'SperrKat', 'Fachber']) {
    out[table] = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
  }
  return out;
}

function kennzahlen(db) {
  const titel = db.prepare(`SELECT COUNT(*) AS n FROM "Katalog"`).get().n;
  const exemplare = db.prepare(`SELECT COUNT(*) AS n FROM "Medien"`).get().n;
  const leser = db.prepare(`SELECT COUNT(*) AS n FROM "Leser"`).get().n;
  const offen = db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe" WHERE "Rueckgabe" IS NULL`).get().n;
  return { titel, exemplare, leser, offen };
}

module.exports = {
  searchKatalog,
  getKatalog,
  saveKatalog,
  deleteKatalog,
  exemplareFuer,
  findExemplarByEtikett,
  saveMedium,
  deleteMedium,
  exemplarStatus,
  searchLeser,
  getLeser,
  saveLeser,
  deleteLeser,
  leserGesperrt,
  offeneAusleihenVonLeser,
  alleOffenenAusleihen,
  ausleihen,
  zurueckgeben,
  verlaengern,
  ueberfaelligeMitStufe,
  mahnungEintragen,
  mahnhistorieVonLeser,
  stammdaten,
  kennzahlen,
};
