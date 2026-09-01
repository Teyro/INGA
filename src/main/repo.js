'use strict';

/** Fachliche Datenzugriffe: Katalog, Exemplare, Leser, Ausleihe/Rückgabe, Mahnwesen. */

const { upsert, nextId, quoteIdent, TABLES } = require('./db');
const { heuteISO, heuteStamp, jetztStamp, addTage, tageDifferenz } = require('./date-utils');

// todayStr/nowStamp/addDays hießen früher so und rechneten über
// `new Date().toISOString()` – das liefert das UTC-Datum statt des lokalen
// und verschiebt Fristen in Deutschland regelmäßig um einen Tag (siehe
// date-utils.js). Beide Namen bleiben als dünne Weiterleitung erhalten, damit
// hier nicht jede Fundstelle einzeln umbenannt werden muss.
const todayStr = heuteStamp;
const nowStamp = jetztStamp;

/* ------------------------------------------------------------- Katalog */

/**
 * Katalogsuche mit Filtern (Medienart, Verfügbarkeit). Liefert je Titel gleich
 * die Exemplarzahlen mit, damit die Liste nicht mehr pro Zeile einzeln
 * nachfragen muss.
 */
function searchKatalog(db, { query, medArtKb, systemId, verfuegbarkeit } = {}, limit = 300) {
  let sql = `
    SELECT k.*,
      (SELECT COUNT(*) FROM "Medien" m WHERE m."KatalogNi" = k."KatalogNi") AS exemplareGesamt,
      (SELECT COUNT(*) FROM "Medien" m
        WHERE m."KatalogNi" = k."KatalogNi"
          AND NOT EXISTS (SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL)
      ) AS exemplareVerfuegbar
    FROM "Katalog" k WHERE 1=1`;
  const params = [];
  if (query) {
    sql += ` AND (k."Titel" LIKE ? OR k."Autor" LIKE ? OR k."ISBN" LIKE ? OR k."EAN" LIKE ? OR k."Schlagwort" LIKE ?)`;
    const like = `%${query}%`;
    params.push(like, like, like, like, like);
  }
  if (medArtKb) { sql += ` AND k."MedArtKb" = ?`; params.push(medArtKb); }
  if (systemId) { sql += ` AND k."SystemId" = ?`; params.push(systemId); }
  sql += ` ORDER BY k."Titel" LIMIT ?`;
  params.push(limit);

  let rows = db.prepare(sql).all(...params);
  if (verfuegbarkeit === 'verfuegbar') rows = rows.filter((r) => r.exemplareVerfuegbar > 0);
  else if (verfuegbarkeit === 'verliehen') rows = rows.filter((r) => r.exemplareGesamt > 0 && r.exemplareVerfuegbar === 0);
  return rows;
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

/** Wie exemplareFuer, aber inklusive Ausleihstatus je Exemplar – ohne dafür pro Exemplar einzeln nachzufragen. */
function exemplareMitStatusFuer(db, katalogNi) {
  return db
    .prepare(
      `SELECT m.*,
        EXISTS(SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL) AS verliehen
       FROM "Medien" m WHERE m."KatalogNi" = ? ORDER BY m."MedienNi"`
    )
    .all(katalogNi)
    .map((m) => ({ ...m, verliehen: Boolean(m.verliehen) }));
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

/**
 * Nutzersuche mit Filtern (Gruppe, Zweig, gesperrt). Liefert die Anzahl
 * offener Ausleihen gleich mit, statt dass die Liste sie pro Zeile einzeln
 * nachfragen muss.
 */
function searchLeser(db, { query, leserGruNi, zweigId, gesperrt } = {}, limit = 300) {
  let sql = `
    SELECT l.*,
      (SELECT COUNT(*) FROM "Ausleihe" a WHERE a."LeserNi" = l."LeserNi" AND a."Rueckgabe" IS NULL) AS offeneAusleihen
    FROM "Leser" l WHERE 1=1`;
  const params = [];
  if (query) {
    sql += ` AND (l."Nachname" LIKE ? OR l."Vorname" LIKE ? OR l."AusweisId" LIKE ? OR l."Kuerzel" LIKE ?)`;
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  if (leserGruNi) { sql += ` AND l."LeserGruNi" = ?`; params.push(leserGruNi); }
  if (zweigId) { sql += ` AND l."ZweigId" = ?`; params.push(zweigId); }
  sql += ` ORDER BY l."Nachname", l."Vorname" LIMIT ?`;
  params.push(limit);

  let rows = db.prepare(sql).all(...params);
  if (gesperrt === 'gesperrt') rows = rows.filter((r) => leserGesperrt(db, r.LeserNi).gesperrt);
  else if (gesperrt === 'aktiv') rows = rows.filter((r) => !leserGesperrt(db, r.LeserNi).gesperrt);
  return rows;
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

/**
 * Alle offenen Ausleihen inkl. der Leihfrist der jeweiligen Medienart
 * (medArtFrist, per LEFT JOIN – NULL wenn die Medienart keine eigene Frist
 * hat oder gar keine gesetzt ist). Der JOIN spart genau die Datenbankzugriffe,
 * die sonst pro Zeile in einer Schleife anfallen würden (siehe
 * ueberfaelligeAusleihen).
 */
function alleOffenenAusleihen(db) {
  return db
    .prepare(
      `SELECT a.*, m."MedienEtik", k."KatalogNi", k."Titel", k."Autor",
         ma."Frist" AS medArtFrist, ma."FristVerl" AS medArtFristVerl, l."Nachname", l."Vorname"
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       LEFT JOIN "MedArt" ma ON ma."MedArtKb" = k."MedArtKb"
       JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
       ORDER BY a."AuslDatum"`
    )
    .all();
}

const addDays = addTage;

/** true, wenn ein aus der Datenbank gelesener Wert tatsächlich gesetzt ist (0 zählt als gesetzt, '' und NULL nicht). */
function istGesetzt(wert) {
  return wert !== null && wert !== undefined && wert !== '';
}

/**
 * Reine Tagesrechnung ohne Datenbankzugriff – der gemeinsame Kern von
 * berechneRueckgabedatum() und berechneRueckgabedatumAusRow(). Liefert neben
 * der Gesamttagezahl auch nachvollziehbare Hinweise (z. B. für die Anzeige
 * „+7 Tage durch 1 Verlängerung“ in der Ausleihliste).
 */
function fristTageGesamt({ basisFristTage, verlaengerungFristTage, anzVerl = 0, offsetTage = 0 }) {
  const hinweise = [];
  let gesamt = Number(basisFristTage) || 0;
  const anz = Number(anzVerl) || 0;
  if (anz > 0) {
    const verlTage = (Number(verlaengerungFristTage) || 0) * anz;
    gesamt += verlTage;
    hinweise.push(`+${verlTage} Tag${verlTage === 1 ? '' : 'e'} durch ${anz} Verlängerung${anz === 1 ? '' : 'en'}`);
  }
  const offset = Number(offsetTage) || 0;
  if (offset) {
    gesamt += offset;
    hinweise.push(`${offset > 0 ? '+' : ''}${offset} Tag${Math.abs(offset) === 1 ? '' : 'e'} Fristverschiebung`);
  }
  return { gesamt, hinweise };
}

/**
 * Zentrale Fälligkeitsberechnung: Basisfrist (Medienart, sonst die
 * Vorgabe aus den Einstellungen) + je Verlängerung die Verlängerungsdauer
 * (ebenfalls Medienart vor Vorgabe) + globale Fristverschiebung. Wird von
 * der Ausleihe, der Verlängerung und (ab der Ferienverwaltung) auch von der
 * feiertagsbewussten Verschiebung genutzt – nie an mehreren Stellen kopieren.
 * Für Einzelabfragen (ein DB-Zugriff für Katalog+Medienart); für Listen siehe
 * berechneRueckgabedatumAusRow, die ohne Zusatzabfrage auskommt.
 */
function berechneRueckgabedatum(db, { auslDatum, katalogNi, anzVerl = 0, einstellungen }) {
  const katalog = katalogNi ? getKatalog(db, katalogNi) : null;
  const art = katalog?.MedArtKb ? db.prepare(`SELECT * FROM "MedArt" WHERE "MedArtKb" = ?`).get(katalog.MedArtKb) : null;
  const { gesamt, hinweise } = fristTageGesamt({
    basisFristTage: istGesetzt(art?.Frist) ? art.Frist : einstellungen.leihfristTage,
    verlaengerungFristTage: istGesetzt(art?.FristVerl) ? art.FristVerl : einstellungen.verlaengerungDauerTage,
    anzVerl,
    offsetTage: einstellungen.leihfristOffsetTage,
  });
  return { datum: addDays(auslDatum, gesamt), tageGesamt: gesamt, hinweise };
}

/** Wie berechneRueckgabedatum, aber aus einer bereits geladenen Zeile von alleOffenenAusleihen – ohne DB-Zugriff. */
function berechneRueckgabedatumAusRow(row, einstellungen) {
  const { gesamt, hinweise } = fristTageGesamt({
    basisFristTage: istGesetzt(row.medArtFrist) ? row.medArtFrist : einstellungen.leihfristTage,
    verlaengerungFristTage: istGesetzt(row.medArtFristVerl) ? row.medArtFristVerl : einstellungen.verlaengerungDauerTage,
    anzVerl: row.AnzVerl,
    offsetTage: einstellungen.leihfristOffsetTage,
  });
  return { datum: addDays(row.AuslDatum, gesamt), tageGesamt: gesamt, hinweise };
}

/**
 * Mahngebühr für eine Ausleihe mit `tageUeberfaellig` Tagen Verzug: pro Tag
 * nach Ablauf der Karenzzeit ein fester Betrag, gedeckelt auf den
 * Höchstbetrag. Ist der Schalter aus, immer 0 – die Aufrufer blenden die
 * Gebühr dann komplett aus, statt nur 0,00 € anzuzeigen.
 */
function berechneMahngebuehr(tageUeberfaellig, einstellungen) {
  if (!einstellungen.mahngebuehrenAktiv) return 0;
  const karenz = Number(einstellungen.mahnKarenztage) || 0;
  const proTag = Number(einstellungen.mahnGebuehrProTag) || 0;
  const max = Number(einstellungen.mahnGebuehrMax) || 0;
  const tageMitGebuehr = Math.max(0, (Number(tageUeberfaellig) || 0) - karenz);
  const betrag = tageMitGebuehr * proTag;
  return max > 0 ? Math.min(betrag, max) : betrag;
}

/**
 * Ausleihen: prüft Sperre und Doppelausleihe, legt den Datensatz an.
 * Wirft eine Error mit sprechender Meldung, wenn es nicht geht – der Aufrufer
 * (IPC-Handler) reicht die Meldung unverändert an die Oberfläche weiter.
 */
function ausleihen(db, { medienNi, leserNi, benutzer, einstellungen }) {
  const medium = db.prepare(`SELECT * FROM "Medien" WHERE "MedienNi" = ?`).get(medienNi);
  if (!medium) throw new Error('Unbekanntes Exemplar.');
  const status = exemplarStatus(db, medienNi);
  if (status.verliehen) throw new Error('Dieses Exemplar ist bereits ausgeliehen.');
  const sperre = leserGesperrt(db, leserNi);
  if (sperre.gesperrt) throw new Error(`Ausleihe nicht möglich: ${sperre.grund}.`);

  const auslDatum = todayStr();
  const stmt = db.prepare(
    `INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl","ErfassAnw")
     VALUES (@MedienNi, @LeserNi, @AuslDatum, NULL, 0, @ErfassAnw)`
  );
  const info = stmt.run({
    MedienNi: medienNi,
    LeserNi: leserNi,
    AuslDatum: auslDatum,
    ErfassAnw: benutzer || 'inga',
  });
  const { datum, hinweise } = berechneRueckgabedatum(db, { auslDatum, katalogNi: medium.KatalogNi, anzVerl: 0, einstellungen });
  return { id: info.lastInsertRowid, faelligAm: datum, hinweise };
}

function zurueckgeben(db, ausleiheId) {
  db.prepare(`UPDATE "Ausleihe" SET "Rueckgabe" = ? WHERE id = ? AND "Rueckgabe" IS NULL`).run(todayStr(), ausleiheId);
}

/**
 * Verlängert eine Ausleihe um eine weitere Verlängerungsdauer (Medienart
 * oder Vorgabe aus den Einstellungen) und gibt das neu berechnete
 * Rückgabedatum gleich mit zurück, damit die Oberfläche es sofort anzeigen
 * kann, ohne die Liste komplett neu zu laden.
 *
 * Hinweis: `einstellungen.verlaengerungGesperrtBeiVormerkung` wird hier noch
 * nicht ausgewertet – das greift erst, sobald es Vormerkungen gibt.
 */
function verlaengern(db, ausleiheId, einstellungen) {
  const row = db
    .prepare(
      `SELECT a.*, m."KatalogNi" FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       WHERE a.id = ?`
    )
    .get(ausleiheId);
  if (!row) throw new Error('Ausleihe nicht gefunden.');
  if (row.Rueckgabe) throw new Error('Bereits zurückgegeben.');
  const maxVerlaengerung = Number(einstellungen.maxVerlaengerung) || 0;
  if ((row.AnzVerl || 0) >= maxVerlaengerung) throw new Error('Maximale Anzahl Verlängerungen erreicht.');

  db.prepare(`UPDATE "Ausleihe" SET "AnzVerl" = "AnzVerl" + 1 WHERE id = ?`).run(ausleiheId);
  const { datum, hinweise } = berechneRueckgabedatum(db, {
    auslDatum: row.AuslDatum,
    katalogNi: row.KatalogNi,
    anzVerl: (row.AnzVerl || 0) + 1,
    einstellungen,
  });
  return { faelligAm: datum, hinweise };
}

/**
 * Verschiebt das Ausleihdatum aller offenen Ausleihen um die angegebene Anzahl
 * Tage (kann negativ sein) – dadurch verschiebt sich auch die berechnete
 * Fälligkeit entsprechend. Für einmalige Aktionen wie „alle Fristen wegen
 * Ferien um 14 Tage nach hinten schieben“. Behält das Zeitformat von
 * todayStr() bei, damit Export/Import unverändert bleiben.
 */
function verschiebeOffeneAusleihen(db, tage) {
  const delta = Math.round(Number(tage) || 0);
  if (!delta) return 0;
  const offen = db.prepare(`SELECT id, "AuslDatum" FROM "Ausleihe" WHERE "Rueckgabe" IS NULL`).all();
  const stmt = db.prepare(`UPDATE "Ausleihe" SET "AuslDatum" = ? WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const row of offen) {
      stmt.run(`${addDays(row.AuslDatum, delta)} 00:00:00.000`, row.id);
    }
  });
  tx();
  return offen.length;
}

/**
 * Alle offenen Ausleihen, die überfällig sind (Leihfrist der Medienart bzw.
 * Vorgabe plus globale Fristverschiebung eingerechnet) – unabhängig davon, ob
 * sie eine Mahnstufe erreicht haben. Grundlage für Übersicht/Dashboard und für
 * die rote Markierung in Nutzer- und Rückgabeliste. Absteigend nach Tagen
 * überfällig sortiert (am dringendsten zuerst).
 */
function ueberfaelligeAusleihen(db, einstellungen) {
  const offen = alleOffenenAusleihen(db);
  const heute = heuteISO();
  const ergebnis = [];
  for (const a of offen) {
    // Kein DB-Zugriff je Zeile mehr (a.medArtFrist/medArtFristVerl kommen
    // schon aus dem JOIN in alleOffenenAusleihen) – wichtig, weil diese
    // Schleife bei jedem Dashboard-/Listen-Aufruf über alle offenen
    // Ausleihen läuft.
    const { datum: faelligAm, hinweise } = berechneRueckgabedatumAusRow(a, einstellungen);
    const tageUeberfaellig = tageDifferenz(faelligAm, heute);
    if (tageUeberfaellig <= 0) continue;
    ergebnis.push({ ...a, tageUeberfaellig, faelligAm, fristHinweise: hinweise });
  }
  ergebnis.sort((x, y) => y.tageUeberfaellig - x.tageUeberfaellig);
  return ergebnis;
}

/**
 * Überfällige Ausleihen mit der passenden Mahnstufe (nach Tagen überfällig).
 * Nutzt Mahnstufen aus den Einstellungen; Ausleihen, die noch keine Stufe
 * erreicht haben, tauchen hier nicht auf (siehe dafür ueberfaelligeAusleihen).
 * Liefert zusätzlich stufeIndex mit – die Oberfläche braucht ihn, um die
 * Stufe eindeutig wiederzuerkennen (Namen allein sind nicht eindeutig, falls
 * zwei Stufen gleich benannt wurden).
 */
function ueberfaelligeMitStufe(db, einstellungen) {
  const ergebnis = [];
  for (const a of ueberfaelligeAusleihen(db, einstellungen)) {
    let stufe = null;
    let stufeIndex = -1;
    (einstellungen.mahnstufen || []).forEach((s, i) => {
      if (a.tageUeberfaellig >= s.tageUeberfaellig) { stufe = s; stufeIndex = i; }
    });
    if (stufe) ergebnis.push({ ...a, stufe, stufeIndex, gebuehr: berechneMahngebuehr(a.tageUeberfaellig, einstellungen) });
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

/**
 * Die meistausgeliehenen Titel über den gesamten Verlauf (offene und
 * zurückgegebene Ausleihen), für das Dashboard.
 */
function topAusgelieheneBuecher(db, limit = 10) {
  return db
    .prepare(
      `SELECT k."KatalogNi", k."Titel", k."Autor", COUNT(*) AS anzahl
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       GROUP BY k."KatalogNi"
       ORDER BY anzahl DESC, k."Titel"
       LIMIT ?`
    )
    .all(limit);
}

/** Wie oft wurde ein Titel insgesamt ausgeliehen (für die Buchdetailseite). */
function ausleihStatistikFuerKatalog(db, katalogNi) {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS gesamt
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       WHERE m."KatalogNi" = ?`
    )
    .get(katalogNi);
  return { gesamt: row?.gesamt || 0 };
}

/* ------------------------------------------------------------- Cover */

function coverInfo(db, katalogNi) {
  return db.prepare(`SELECT * FROM inga_covers WHERE "KatalogNi" = ?`).get(katalogNi) || null;
}

function setCover(db, katalogNi, dateiname, quelle) {
  db.prepare(
    `INSERT INTO inga_covers ("KatalogNi","dateiname","quelle","aktualisiert") VALUES (?, ?, ?, ?)
     ON CONFLICT("KatalogNi") DO UPDATE SET "dateiname" = excluded."dateiname", "quelle" = excluded."quelle", "aktualisiert" = excluded."aktualisiert"`
  ).run(katalogNi, dateiname, quelle, nowStamp());
}

function removeCover(db, katalogNi) {
  db.prepare(`DELETE FROM inga_covers WHERE "KatalogNi" = ?`).run(katalogNi);
}

/* ---------------------------------------------------------- Stammdaten */

/** Abweichende Leih-/Verlängerungsfrist einer Medienart speichern (leer = Vorgabe aus den Einstellungen gilt wieder). */
function medArtFristSpeichern(db, medArtKb, { frist, fristVerl }) {
  const zuNullOderZahl = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  db.prepare(`UPDATE "MedArt" SET "Frist" = ?, "FristVerl" = ? WHERE "MedArtKb" = ?`).run(
    zuNullOderZahl(frist),
    zuNullOderZahl(fristVerl),
    medArtKb
  );
}

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
  exemplareMitStatusFuer,
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
  verschiebeOffeneAusleihen,
  ueberfaelligeAusleihen,
  ueberfaelligeMitStufe,
  berechneRueckgabedatum,
  berechneRueckgabedatumAusRow,
  berechneMahngebuehr,
  mahnungEintragen,
  mahnhistorieVonLeser,
  topAusgelieheneBuecher,
  ausleihStatistikFuerKatalog,
  coverInfo,
  setCover,
  removeCover,
  stammdaten,
  medArtFristSpeichern,
  kennzahlen,
};
