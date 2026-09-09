'use strict';

/** Fachliche Datenzugriffe: Katalog, Exemplare, Leser, Ausleihe/Rückgabe, Mahnwesen. */

const { upsert, nextId, quoteIdent, TABLES } = require('./db');
const { heuteISO, heuteStamp, jetztStamp, addTage, tageDifferenz, parseKalenderdatum } = require('./date-utils');
const ferien = require('./ferien');
const suche = require('./suche');

// todayStr/nowStamp/addDays hießen früher so und rechneten über
// `new Date().toISOString()` – das liefert das UTC-Datum statt des lokalen
// und verschiebt Fristen in Deutschland regelmäßig um einen Tag (siehe
// date-utils.js). Beide Namen bleiben als dünne Weiterleitung erhalten, damit
// hier nicht jede Fundstelle einzeln umbenannt werden muss.
const todayStr = heuteStamp;
const nowStamp = jetztStamp;

/* ------------------------------------------------------------- Seitenweise Listen */

const STANDARD_SEITENGROESSE = 50;
// Deckelt eine "pro Seite"-Angabe aus dem Renderer, damit ein manipulierter
// IPC-Aufruf nicht versehentlich die komplette Tabelle auf einmal anfordert.
const MAX_SEITENGROESSE = 1000;

/**
 * Normalisiert Seite/Seitengröße für datenbankseitiges LIMIT/OFFSET.
 * `proSeite: 'alle'` (oder <= 0) bedeutet "kein LIMIT" – für den Fall, dass
 * eine Kollegin wirklich die komplette Liste auf einen Blick braucht (z. B.
 * zum Drucken). Vormals hatten searchKatalog/searchLeser stattdessen ein
 * festes, unveränderliches `LIMIT 300` OHNE jede Seitennavigation – das war
 * der gemeldete Bug ("es werden immer nur begrenzt viele Bücher angezeigt"):
 * ab dem 301. Treffer war ein Titel schlicht nicht mehr auffindbar, auch
 * nicht über eine speziellere Suche, solange die ersten 300 Treffer bereits
 * anders lauteten. Jetzt wird immer die komplette (gefilterte) Trefferzahl
 * ermittelt und seitenweise nachgeladen, nicht mehr im Speicher abgeschnitten.
 */
function seitenGrenzen({ seite = 1, proSeite = STANDARD_SEITENGROESSE } = {}) {
  const alle = proSeite === 'alle' || Number(proSeite) <= 0;
  const groesse = alle ? null : Math.min(MAX_SEITENGROESSE, Math.max(1, Math.round(Number(proSeite)) || STANDARD_SEITENGROESSE));
  const seiteNr = Math.max(1, Math.round(Number(seite)) || 1);
  return { alle, groesse, offset: alle ? 0 : (seiteNr - 1) * groesse, seite: seiteNr };
}

/* ------------------------------------------------------------- Katalog */

/**
 * Katalogsuche mit Filtern (Medienart, Systematik, Verfügbarkeit) und echter
 * Seitennavigation. Liefert je Titel gleich die Exemplarzahlen mit, damit die
 * Liste nicht mehr pro Zeile einzeln nachfragen muss. Sowohl die Trefferzahl
 * als auch die Verfügbarkeitsfilterung laufen vollständig in SQL (nicht mehr
 * per Array.filter() NACH einem LIMIT) – sonst wäre die angezeigte
 * Gesamtzahl bei aktivem Verfügbarkeitsfilter falsch bzw. eine Seite könnte
 * nach dem Filtern weniger Zeilen zeigen, als sie eigentlich sollte.
 */
function searchKatalog(
  db,
  { query, medArtKb, systemId, standortNi, klassenstufe, verfuegbarkeit, katalogNiIn } = {},
  seitenOptionen = {}
) {
  if (Array.isArray(katalogNiIn) && katalogNiIn.length === 0) {
    const { alle, groesse, seite } = seitenGrenzen(seitenOptionen);
    return { rows: [], gesamt: 0, seite, proSeite: alle ? 'alle' : groesse };
  }

  const bedingungen = ['1=1'];
  const params = [];
  if (query) {
    // Deckt auch Verlag und die Signatur/den Barcode einzelner Exemplare ab
    // (Perpustakaan hat kein Signaturfeld auf Katalogebene – das steht am
    // Exemplar, siehe Medien.MedienEtik), nicht nur Titel/Autor/ISBN/Schlagwort.
    bedingungen.push(`(
      k."Titel" LIKE ? OR k."Autor" LIKE ? OR k."ISBN" LIKE ? OR k."EAN" LIKE ? OR k."Schlagwort" LIKE ? OR k."Verlag" LIKE ?
      OR EXISTS (SELECT 1 FROM "Medien" mq WHERE mq."KatalogNi" = k."KatalogNi" AND mq."MedienEtik" LIKE ?)
    )`);
    const like = `%${query}%`;
    params.push(like, like, like, like, like, like, like);
  }
  if (medArtKb) { bedingungen.push(`k."MedArtKb" = ?`); params.push(medArtKb); }
  if (systemId) { bedingungen.push(`k."SystemId" = ?`); params.push(systemId); }
  if (klassenstufe) { bedingungen.push(`k."Klassenstu" = ?`); params.push(klassenstufe); }
  if (standortNi) {
    bedingungen.push(`EXISTS (SELECT 1 FROM "Medien" mo WHERE mo."KatalogNi" = k."KatalogNi" AND mo."StOrtNi" = ?)`);
    params.push(standortNi);
  }
  if (Array.isArray(katalogNiIn)) {
    bedingungen.push(`k."KatalogNi" IN (${katalogNiIn.map(() => '?').join(',')})`);
    params.push(...katalogNiIn);
  }
  if (verfuegbarkeit === 'verfuegbar') {
    bedingungen.push(`EXISTS (
      SELECT 1 FROM "Medien" mv WHERE mv."KatalogNi" = k."KatalogNi"
        AND NOT EXISTS (SELECT 1 FROM "Ausleihe" av WHERE av."MedienNi" = mv."MedienNi" AND av."Rueckgabe" IS NULL)
    )`);
  } else if (verfuegbarkeit === 'verliehen') {
    bedingungen.push(`EXISTS (SELECT 1 FROM "Medien" mv WHERE mv."KatalogNi" = k."KatalogNi")`);
    bedingungen.push(`NOT EXISTS (
      SELECT 1 FROM "Medien" mv2 WHERE mv2."KatalogNi" = k."KatalogNi"
        AND NOT EXISTS (SELECT 1 FROM "Ausleihe" av2 WHERE av2."MedienNi" = mv2."MedienNi" AND av2."Rueckgabe" IS NULL)
    )`);
  } else if (verfuegbarkeit === 'nicht_verfuegbar') {
    // "Nicht verfügbar" (z. B. vermisst, in Reparatur – siehe Stammdaten-
    // Tabelle Nichtverf): mindestens ein Exemplar mit gesetztem NichtVfNi.
    bedingungen.push(`EXISTS (SELECT 1 FROM "Medien" mn WHERE mn."KatalogNi" = k."KatalogNi" AND mn."NichtVfNi" IS NOT NULL)`);
  }
  // "überfällig" hängt an der ferienbewussten Fälligkeitsberechnung (siehe
  // ueberfaelligeAusleihen) und lässt sich nicht sinnvoll ein zweites Mal in
  // SQL nachbilden – der Aufrufer ermittelt die betroffenen KatalogNi einmal
  // zentral und übergibt sie hier als katalogNiIn (siehe oben), genau wie bei
  // searchLeser/leserNiIn.
  const where = bedingungen.join(' AND ');

  const gesamt = db.prepare(`SELECT COUNT(*) AS n FROM "Katalog" k WHERE ${where}`).get(...params).n;

  const { alle, groesse, offset, seite } = seitenGrenzen(seitenOptionen);
  let sql = `
    SELECT k.*,
      (SELECT COUNT(*) FROM "Medien" m WHERE m."KatalogNi" = k."KatalogNi") AS exemplareGesamt,
      (SELECT COUNT(*) FROM "Medien" m
        WHERE m."KatalogNi" = k."KatalogNi"
          AND NOT EXISTS (SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL)
      ) AS exemplareVerfuegbar
    FROM "Katalog" k WHERE ${where}
    ORDER BY k."Titel"`;
  const abfrageParams = [...params];
  if (!alle) {
    sql += ` LIMIT ? OFFSET ?`;
    abfrageParams.push(groesse, offset);
  }
  const rows = db.prepare(sql).all(...abfrageParams);
  return { rows, gesamt, seite, proSeite: alle ? 'alle' : groesse };
}

function getKatalog(db, katalogNi) {
  return db.prepare(`SELECT * FROM "Katalog" WHERE "KatalogNi" = ?`).get(katalogNi);
}

function saveKatalog(db, row) {
  const clean = { ...row };
  if (!String(clean.Titel ?? '').trim()) throw new Error('Bitte einen Titel angeben.');
  if (!clean.KatalogNi) clean.KatalogNi = nextId(db, 'Katalog', 'KatalogNi');
  if (!clean.ErfassDat) clean.ErfassDat = nowStamp();
  return upsert(db, 'Katalog', clean);
}

/**
 * Löscht einen Titel samt aller Exemplare – aber nur, wenn keines davon
 * gerade ausgeliehen ist. Ohne diese Prüfung würde eine noch offene Ausleihe
 * verwaist zurückbleiben: sie verschwindet dann (die Rückgabe-/Umlauf-/
 * Mahnlisten arbeiten mit JOINs auf Medien/Katalog) aus jeder Liste, in der
 * kennzahlen()-Zählung ("offene Ausleihen") aber weiter mitgezählt, und lässt
 * sich über die Oberfläche nie mehr zurückgeben.
 */
function deleteKatalog(db, katalogNi) {
  const exemplare = exemplareFuer(db, katalogNi);
  if (exemplare.some((m) => exemplarStatus(db, m.MedienNi).verliehen)) {
    throw new Error('Mindestens ein Exemplar dieses Titels ist noch ausgeliehen. Bitte erst alle Exemplare zurückgeben, dann löschen.');
  }
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

/**
 * Wie exemplareMitStatusFuer, aber je verliehenem Exemplar zusätzlich an wen
 * und bis wann – Grundlage für den Status-Block der ruhigen Buchdetailansicht
 * (Abschnitt 3: "Titel, Autor, Buchnummer, Status – verfügbar/ausgeliehen an
 * wen bis wann"). Ein Titel hat typischerweise nur eine Handvoll Exemplare,
 * ein Einzelabfrage-Join je verliehenem Exemplar ist hier unproblematisch
 * (anders als bei den Listen über ALLE offenen Ausleihen, siehe
 * ueberfaelligeAusleihen).
 */
function exemplareMitAusleiheInfoFuer(db, katalogNi, einstellungen) {
  const exemplare = exemplareMitStatusFuer(db, katalogNi);
  if (!exemplare.some((m) => m.verliehen)) return exemplare.map((m) => ({ ...m, ausleihe: null }));
  const ferienListe = ferien.listeFerien(db);
  return exemplare.map((m) => {
    if (!m.verliehen) return { ...m, ausleihe: null };
    const ausleihe = db
      .prepare(
        `SELECT a.*, l."Nachname", l."Vorname" FROM "Ausleihe" a
         JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
         WHERE a."MedienNi" = ? AND a."Rueckgabe" IS NULL`
      )
      .get(m.MedienNi);
    if (!ausleihe) return { ...m, ausleihe: null };
    const { datum, hinweise } = berechneRueckgabedatum(db, { auslDatum: ausleihe.AuslDatum, katalogNi, anzVerl: ausleihe.AnzVerl, einstellungen });
    return {
      ...m,
      ausleihe: { id: ausleihe.id, Nachname: ausleihe.Nachname, Vorname: ausleihe.Vorname, AuslDatum: ausleihe.AuslDatum, faelligAm: datum, hinweise },
    };
  });
}

/**
 * Vorschläge fürs Feld "Buch" beim Ausleihen (Abschnitt 4): Buchnummer,
 * Titel oder Autor, unscharf. Arbeitet auf EXEMPLAR-Ebene (nicht Titel-
 * Ebene) – ausgeliehen wird immer ein konkretes Exemplar, und bereits
 * verliehene Exemplare sollen auftauchen (nur gekennzeichnet), nicht
 * verschwinden ("sonst sucht man an der Theke vergeblich weiter").
 */
function medienVorschlaege(db, query, limit = 6) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const alle = db
    .prepare(
      `SELECT m."MedienNi", m."MedienEtik", m."KatalogNi", k."Titel", k."Autor",
        EXISTS(SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL) AS verliehen
       FROM "Medien" m JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"`
    )
    .all();
  return suche
    .ranglisteSortiert(alle, q, (m) => [m.MedienEtik, m.Titel, m.Autor])
    .slice(0, limit)
    .map((m) => ({ ...m, verliehen: Boolean(m.verliehen) }));
}

function findExemplarByEtikett(db, etikett) {
  return db.prepare(`SELECT * FROM "Medien" WHERE "MedienEtik" = ?`).get(etikett);
}

function saveMedium(db, row) {
  const clean = { ...row };
  const etikett = String(clean.MedienEtik ?? '').trim();
  if (!etikett) throw new Error('Bitte ein Etikett/Barcode für das Exemplar angeben.');
  // Eindeutigkeit der Signatur/des Barcodes: ohne diese Prüfung könnten zwei
  // Exemplare denselben Code tragen – findExemplarByEtikett() liefert dann
  // beim Scannen (Ausleihe/Rückgabe) über .get() nur zufällig eines der
  // beiden, das andere wäre über den Scanner nie mehr erreichbar.
  const doppelt = db
    .prepare(`SELECT "MedienNi" FROM "Medien" WHERE "MedienEtik" = ? AND "MedienNi" != ?`)
    .get(etikett, clean.MedienNi || -1);
  if (doppelt) throw new Error(`Das Etikett/der Barcode „${etikett}“ wird bereits von einem anderen Exemplar verwendet.`);
  clean.MedienEtik = etikett;
  if (!clean.MedienNi) clean.MedienNi = nextId(db, 'Medien', 'MedienNi');
  if (!clean.ErfassDat) clean.ErfassDat = nowStamp();
  return upsert(db, 'Medien', clean);
}

/**
 * Löscht ein Exemplar – nicht, solange es ausgeliehen ist (siehe deleteKatalog
 * für die Begründung). Landet zuvor im Papierkorb (Tabelle "MedienAbg", siehe
 * verschiebeInPapierkorb) statt endgültig verloren zu gehen – Perpustakaan
 * Professional bietet das ("Papierkorb für Medien und Leser mit
 * Wiederherstellungsmöglichkeit"), INGA bislang nicht. Die Momentaufnahme
 * enthält zusätzlich die Katalogdaten des Titels (Titel/Autor/…), damit der
 * Papierkorb auch dann lesbar bleibt, wenn der Titel danach separat gelöscht
 * wird – deshalb erst Katalog, dann (überschreibend) Medien einmischen: bei
 * überschneidenden Spalten (KatalogNi, ErfassDat, ErfassAnw) gewinnt das
 * Exemplar, genau wie im Perpustakaan-Format vorgesehen.
 */
function deleteMedium(db, medienNi, benutzer) {
  if (exemplarStatus(db, medienNi).verliehen) {
    throw new Error('Dieses Exemplar ist noch ausgeliehen. Bitte erst zurückgeben, dann löschen.');
  }
  const medium = db.prepare(`SELECT * FROM "Medien" WHERE "MedienNi" = ?`).get(medienNi);
  if (medium) {
    const katalog = db.prepare(`SELECT * FROM "Katalog" WHERE "KatalogNi" = ?`).get(medium.KatalogNi) || {};
    verschiebeInPapierkorb(db, 'MedienAbg', { ...katalog, ...medium }, benutzer);
  }
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
 * Nutzersuche mit Filtern (Gruppe, Zweig, gesperrt) und echter
 * Seitennavigation. Liefert die Anzahl offener Ausleihen gleich mit, statt
 * dass die Liste sie pro Zeile einzeln nachfragen muss.
 *
 * `gesperrt`/`aktiv` bilden dieselbe Regel wie leserGesperrt() ab, aber als
 * SQL-Bedingung (statt eines JS-Aufrufs je Zeile NACH einem festen LIMIT) –
 * sonst wäre weder die Trefferzahl noch die Seitengröße bei aktivem Filter
 * korrekt. `leserNiIn` filtert zusätzlich auf eine vorgegebene Liste von
 * LeserNi (z. B. "mit Rückstand": die Überfälligkeits-Ermittlung hängt an der
 * ferienbewussten Fristberechnung und lässt sich nicht sinnvoll noch einmal
 * separat in SQL nachbilden – der Aufrufer ermittelt die betroffenen
 * LeserNi einmal über ueberfaelligeAusleihen() und übergibt sie hier, damit
 * Zählung und Seitennavigation trotzdem korrekt bleiben). Eine leere
 * `leserNiIn`-Liste bedeutet "keine Treffer" statt "Filter ignorieren".
 */
function searchLeser(db, { query, leserGruNi, zweigId, jahrgang, aktiveAusleihen, gesperrt, leserNiIn } = {}, seitenOptionen = {}) {
  if (Array.isArray(leserNiIn) && leserNiIn.length === 0) {
    const { alle, groesse, seite } = seitenGrenzen(seitenOptionen);
    return { rows: [], gesamt: 0, seite, proSeite: alle ? 'alle' : groesse };
  }

  const bedingungen = ['1=1'];
  const params = [];
  if (query) {
    bedingungen.push(`(l."Nachname" LIKE ? OR l."Vorname" LIKE ? OR l."AusweisId" LIKE ? OR l."Kuerzel" LIKE ?)`);
    const like = `%${query}%`;
    params.push(like, like, like, like);
  }
  if (leserGruNi) { bedingungen.push(`l."LeserGruNi" = ?`); params.push(leserGruNi); }
  if (zweigId) { bedingungen.push(`l."ZweigId" = ?`); params.push(zweigId); }
  if (jahrgang) { bedingungen.push(`l."Jahrgang" = ?`); params.push(jahrgang); }
  if (Array.isArray(leserNiIn)) {
    bedingungen.push(`l."LeserNi" IN (${leserNiIn.map(() => '?').join(',')})`);
    params.push(...leserNiIn);
  }
  const offeneAusleihenAusdruck = `(SELECT COUNT(*) FROM "Ausleihe" ao WHERE ao."LeserNi" = l."LeserNi" AND ao."Rueckgabe" IS NULL)`;
  if (aktiveAusleihen === '0') bedingungen.push(`${offeneAusleihenAusdruck} = 0`);
  else if (aktiveAusleihen === '1+') bedingungen.push(`${offeneAusleihenAusdruck} > 0`);
  // IngaGesperrt/IngaGesperrtBis: eigene, befristbare Ausleihsperre (siehe
  // leserGesperrt/leserSperren) – zusätzlich zu den bereits vorhandenen
  // Perpustakaan-Feldern SperrungNi (statischer Sperrgrund) und AusleihBis
  // (allgemeine Ausleihberechtigung).
  const gesperrtAusdruck = `(
    COALESCE(l."IngaGesperrt", 0) = 1
    OR (l."IngaGesperrtBis" IS NOT NULL AND l."IngaGesperrtBis" != '' AND substr(l."IngaGesperrtBis", 1, 10) >= ?)
    OR (l."SperrungNi" IS NOT NULL AND l."SperrungNi" != 0 AND EXISTS (SELECT 1 FROM "Sperrung" s WHERE s."SperrungNi" = l."SperrungNi"))
    OR (l."AusleihBis" IS NOT NULL AND l."AusleihBis" != '' AND substr(l."AusleihBis", 1, 10) < ?)
  )`;
  if (gesperrt === 'gesperrt') { bedingungen.push(gesperrtAusdruck); params.push(todayStr().slice(0, 10), todayStr().slice(0, 10)); }
  else if (gesperrt === 'aktiv') { bedingungen.push(`NOT ${gesperrtAusdruck}`); params.push(todayStr().slice(0, 10), todayStr().slice(0, 10)); }
  const where = bedingungen.join(' AND ');

  const gesamt = db.prepare(`SELECT COUNT(*) AS n FROM "Leser" l WHERE ${where}`).get(...params).n;

  const { alle, groesse, offset, seite } = seitenGrenzen(seitenOptionen);
  let sql = `
    SELECT l.*,
      (SELECT COUNT(*) FROM "Ausleihe" a WHERE a."LeserNi" = l."LeserNi" AND a."Rueckgabe" IS NULL) AS offeneAusleihen
    FROM "Leser" l WHERE ${where}
    ORDER BY l."Nachname", l."Vorname"`;
  const abfrageParams = [...params];
  if (!alle) {
    sql += ` LIMIT ? OFFSET ?`;
    abfrageParams.push(groesse, offset);
  }
  const rows = db.prepare(sql).all(...abfrageParams);
  return { rows, gesamt, seite, proSeite: alle ? 'alle' : groesse };
}

/**
 * Vorschläge fürs Feld "Kind" beim Ausleihen (Abschnitt 4): Nummer, Vorname,
 * Nachname oder Kürzel, unscharf ("Meier" findet auch "Meyer"/"Maier").
 * Liefert zusätzlich Klasse/Jahrgang und die Anzahl offener Ausleihen, damit
 * der Vorschlag das ohne weiteren Aufruf anzeigen kann.
 */
function leserVorschlaege(db, query, limit = 6) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return [];
  const alle = db
    .prepare(
      `SELECT l.*, (SELECT COUNT(*) FROM "Ausleihe" a WHERE a."LeserNi" = l."LeserNi" AND a."Rueckgabe" IS NULL) AS offeneAusleihen
       FROM "Leser" l`
    )
    .all();
  return suche
    .ranglisteSortiert(alle, q, (l) => [l.Vorname, l.Nachname, `${l.Vorname} ${l.Nachname}`, l.Kuerzel, l.AusweisId])
    .slice(0, limit);
}

function getLeser(db, leserNi) {
  return db.prepare(`SELECT * FROM "Leser" WHERE "LeserNi" = ?`).get(leserNi);
}

function saveLeser(db, row) {
  const clean = { ...row };
  if (!String(clean.Nachname ?? '').trim()) throw new Error('Bitte einen Nachnamen angeben.');
  if (!clean.LeserNi) clean.LeserNi = nextId(db, 'Leser', 'LeserNi');
  if (!clean.ImportDat) clean.ImportDat = nowStamp();
  return upsert(db, 'Leser', clean);
}

/**
 * Löscht einen Nutzer – nicht, solange er noch offene Ausleihen hat (siehe
 * deleteKatalog für die Begründung). Landet zuvor im Papierkorb (Tabelle
 * "LeserAbg", siehe verschiebeInPapierkorb und deleteMedium).
 */
function deleteLeser(db, leserNi, benutzer) {
  if (offeneAusleihenVonLeser(db, leserNi).length) {
    throw new Error('Dieser Nutzer hat noch offene Ausleihen. Bitte erst alle Bücher zurückgeben, dann löschen.');
  }
  const leser = getLeser(db, leserNi);
  if (leser) verschiebeInPapierkorb(db, 'LeserAbg', leser, benutzer);
  db.prepare(`DELETE FROM "Leser" WHERE "LeserNi" = ?`).run(leserNi);
}

/**
 * Ist die Ausleihe für diese Person gerade gesperrt – und warum? Prüft der
 * Reihe nach: die eigene, unbefristete Sperre (IngaGesperrt, manuell per
 * Klick gesetzt), die eigene befristete Sperre (IngaGesperrtBis, siehe
 * leserSperren), die Perpustakaan-Sperrgrund-Stammdaten (SperrungNi) und
 * zuletzt die allgemeine Ausleihberechtigung (AusleihBis).
 */
function leserGesperrt(db, leserNi) {
  const leser = getLeser(db, leserNi);
  if (!leser) return { gesperrt: true, grund: 'unbekannter Leser' };
  const heute = todayStr().slice(0, 10);
  if (leser.IngaGesperrt) return { gesperrt: true, grund: 'gesperrt' };
  if (leser.IngaGesperrtBis && String(leser.IngaGesperrtBis).slice(0, 10) >= heute) {
    return { gesperrt: true, grund: `gesperrt bis ${String(leser.IngaGesperrtBis).slice(0, 10)}` };
  }
  if (leser.SperrungNi && leser.SperrungNi !== 0) {
    const sperr = db.prepare(`SELECT * FROM "Sperrung" WHERE "SperrungNi" = ?`).get(leser.SperrungNi);
    if (sperr) return { gesperrt: true, grund: sperr.SperrungBz || 'gesperrt' };
  }
  if (leser.AusleihBis && String(leser.AusleihBis).slice(0, 10) < heute) {
    return { gesperrt: true, grund: 'Ausleihberechtigung abgelaufen' };
  }
  return { gesperrt: false, grund: null };
}

/**
 * Sperrt eine Person für die Ausleihe – entweder unbefristet (manuell per
 * Klick, bleibt bis zum bewussten Entsperren) oder befristet für `tage` Tage
 * ab heute (läuft danach von selbst wieder ab, ohne dass jemand entsperren
 * müsste). `tage` überschreibt eine evtl. vorhandene unbefristete Sperre
 * NICHT gleichzeitig mit auf – wer befristet sperrt, während schon
 * unbefristet gesperrt ist, bleibt weiter unbefristet gesperrt (strengere
 * Sperre gewinnt); "Entsperren" hebt in jedem Fall beides auf.
 */
function leserSperren(db, leserNi, { tage } = {}) {
  if (tage) {
    const bis = addTage(todayStr().slice(0, 10), Math.max(1, Math.round(Number(tage))) - 1);
    db.prepare(`UPDATE "Leser" SET "IngaGesperrtBis" = ? WHERE "LeserNi" = ?`).run(bis, leserNi);
    return { gesperrtBis: bis };
  }
  db.prepare(`UPDATE "Leser" SET "IngaGesperrt" = 1 WHERE "LeserNi" = ?`).run(leserNi);
  return { gesperrtBis: null };
}

function leserEntsperren(db, leserNi) {
  db.prepare(`UPDATE "Leser" SET "IngaGesperrt" = 0, "IngaGesperrtBis" = NULL WHERE "LeserNi" = ?`).run(leserNi);
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
         ma."Frist" AS medArtFrist, ma."FristVerl" AS medArtFristVerl,
         l."Nachname", l."Vorname", l."Jahrgang"
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       LEFT JOIN "MedArt" ma ON ma."MedArtKb" = k."MedArtKb"
       JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
       WHERE a."Rueckgabe" IS NULL
       ORDER BY a."AuslDatum"`
    )
    .all();
}

/**
 * Umlaufliste ("Was ist gerade unterwegs?"): alle offenen Ausleihen mit
 * allen Spalten, die die gedruckte/exportierte Liste braucht – Klasse
 * (Jahrgang), Tage überfällig und Anzahl Verlängerungen inklusive. Nutzt
 * dieselbe zentrale, ferienbewusste Fälligkeitsberechnung wie überall sonst
 * (Ferienliste einmal geladen, nicht pro Zeile). Bewusst ohne eigene
 * Pagination: die Liste ist für den Druck "auf einen Blick" gedacht und in
 * einer Grundschulbibliothek realistisch immer klein genug (offene Ausleihen
 * insgesamt, nicht der ganze Bestand).
 */
function umlaufliste(db, einstellungen) {
  const offen = alleOffenenAusleihen(db);
  const ferienListe = ferien.listeFerien(db);
  const heute = heuteISO();
  return offen.map((a) => {
    const { datum: faelligAm, hinweise } = berechneRueckgabedatumAusRow(a, einstellungen, ferienListe);
    return {
      id: a.id,
      Titel: a.Titel,
      Autor: a.Autor,
      MedienEtik: a.MedienEtik,
      Nachname: a.Nachname,
      Vorname: a.Vorname,
      Jahrgang: a.Jahrgang || '',
      AuslDatum: a.AuslDatum,
      faelligAm,
      tageUeberfaellig: Math.max(0, tageDifferenz(faelligAm, heute)),
      AnzVerl: a.AnzVerl || 0,
      fristHinweise: hinweise,
    };
  });
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
 * Verschiebt ein rein aus der Frist errechnetes Datum um die Ferien, die in
 * die Ausleihspanne fallen (ferien.verlaengerungDurchFerien – der eigentliche
 * Zweck der Ferienverwaltung, siehe dort), und schiebt das Ergebnis
 * anschließend noch auf den nächsten echten Schultag, falls es selbst auf ein
 * Wochenende oder einen Feiertag fällt (ferien.verschobenesDatumMitHinweis).
 * Hängt bei Bedarf nachvollziehbare Hinweise an ("+12 Tage wegen
 * Herbstferien"). `hinweise` wird nicht mutiert, sondern eine neue Liste
 * zurückgegeben.
 */
function mitFerienverschiebung(auslDatum, naivesDatum, ferienListe, hinweise, zaehlweise) {
  const { datum: nachVerlaengerung, namen: namenVerlaengerung } = ferien.verlaengerungDurchFerien(auslDatum, naivesDatum, ferienListe, zaehlweise);
  const { datum, namen: namenNudge } = ferien.verschobenesDatumMitHinweis(nachVerlaengerung, ferienListe);

  const hinweiseNeu = [...hinweise];
  if (namenVerlaengerung.length) {
    const verlaengertTage = tageDifferenz(naivesDatum, nachVerlaengerung);
    hinweiseNeu.push(`+${verlaengertTage} Ferientag${verlaengertTage === 1 ? '' : 'e'} wegen ${namenVerlaengerung.join(' und ')}`);
  }
  const namenNeu = namenNudge.filter((n) => !namenVerlaengerung.includes(n));
  if (namenNeu.length) {
    const nudgeTage = tageDifferenz(nachVerlaengerung, datum);
    hinweiseNeu.push(`+${nudgeTage} Tag${nudgeTage === 1 ? '' : 'e'} wegen ${namenNeu.join(' und ')}`);
  }
  return { datum, hinweise: hinweiseNeu };
}

/**
 * Zentrale Fälligkeitsberechnung: Basisfrist (Medienart, sonst die
 * Vorgabe aus den Einstellungen) + je Verlängerung die Verlängerungsdauer
 * (ebenfalls Medienart vor Vorgabe) + globale Fristverschiebung, danach bei
 * Bedarf auf den nächsten Schultag verschoben (Ferien/Feiertage/Wochenende,
 * siehe ferien.js). Wird von der Ausleihe, der Verlängerung und der
 * Überfälligkeits-Ermittlung genutzt – nie an mehreren Stellen kopieren.
 * Für Einzelabfragen (DB-Zugriff für Katalog+Medienart+Ferienliste); für
 * Listen siehe berechneRueckgabedatumAusRow, die ohne Zusatzabfrage je Zeile
 * auskommt.
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
  const naiv = addDays(auslDatum, gesamt);
  const { datum, hinweise: hinweiseMitFerien } = mitFerienverschiebung(auslDatum, naiv, ferien.listeFerien(db), hinweise, einstellungen.ferienZaehlweise);
  return { datum, tageGesamt: gesamt, hinweise: hinweiseMitFerien };
}

/**
 * Wie berechneRueckgabedatum, aber aus einer bereits geladenen Zeile von
 * alleOffenenAusleihen – ohne DB-Zugriff je Aufruf. `ferienListe` einmal pro
 * Listenaufruf laden (siehe ueberfaelligeAusleihen) statt pro Zeile neu.
 */
function berechneRueckgabedatumAusRow(row, einstellungen, ferienListe = []) {
  const { gesamt, hinweise } = fristTageGesamt({
    basisFristTage: istGesetzt(row.medArtFrist) ? row.medArtFrist : einstellungen.leihfristTage,
    verlaengerungFristTage: istGesetzt(row.medArtFristVerl) ? row.medArtFristVerl : einstellungen.verlaengerungDauerTage,
    anzVerl: row.AnzVerl,
    offsetTage: einstellungen.leihfristOffsetTage,
  });
  const naiv = addDays(row.AuslDatum, gesamt);
  const { datum, hinweise: hinweiseMitFerien } = mitFerienverschiebung(row.AuslDatum, naiv, ferienListe, hinweise, einstellungen.ferienZaehlweise);
  return { datum, tageGesamt: gesamt, hinweise: hinweiseMitFerien };
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

/* ------------------------------------------------------------ Vormerkungen */

/** Merkt einen Titel für einen Nutzer vor – lehnt eine doppelte Vormerkung (derselbe Nutzer, derselbe Titel) ab. */
function vormerken(db, { katalogNi, leserNi }) {
  const doppelt = db.prepare(`SELECT id FROM "Vormerkung" WHERE "KatalogNi" = ? AND "LeserNi" = ?`).get(katalogNi, leserNi);
  if (doppelt) throw new Error('Dieser Titel ist für diesen Nutzer bereits vorgemerkt.');
  const bisherige = db.prepare(`SELECT MAX(CAST("Prioritaet" AS INTEGER)) AS max FROM "Vormerkung" WHERE "KatalogNi" = ?`).get(katalogNi);
  const naechstePrioritaet = (bisherige?.max || 0) + 1;
  const info = db
    .prepare(`INSERT INTO "Vormerkung" ("LeserNi","KatalogNi","Prioritaet","VormerkDat") VALUES (?, ?, ?, ?)`)
    .run(leserNi, katalogNi, naechstePrioritaet, heuteISO());
  return { id: info.lastInsertRowid, prioritaet: naechstePrioritaet };
}

/** Vormerkungen für einen Titel, in der Reihenfolge, in der sie vergeben wurden (wer zuerst vorgemerkt hat, ist zuerst dran). */
function vormerkungenFuer(db, katalogNi) {
  return db
    .prepare(
      `SELECT v.*, l."Nachname", l."Vorname" FROM "Vormerkung" v
       JOIN "Leser" l ON l."LeserNi" = v."LeserNi"
       WHERE v."KatalogNi" = ? ORDER BY CAST(v."Prioritaet" AS INTEGER)`
    )
    .all(katalogNi);
}

/** Vormerkungen eines Nutzers, für die Nutzerakte. */
function vormerkungenVonLeser(db, leserNi) {
  return db
    .prepare(
      `SELECT v.*, k."Titel", k."Autor" FROM "Vormerkung" v
       JOIN "Katalog" k ON k."KatalogNi" = v."KatalogNi"
       WHERE v."LeserNi" = ? ORDER BY v."VormerkDat"`
    )
    .all(leserNi);
}

function vormerkungLoeschen(db, id) {
  db.prepare(`DELETE FROM "Vormerkung" WHERE id = ?`).run(id);
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

  const ausleihLimit = Number(einstellungen?.ausleihLimit) || 0;
  if (ausleihLimit > 0) {
    const offeneAnzahl = db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe" WHERE "LeserNi" = ? AND "Rueckgabe" IS NULL`).get(leserNi).n;
    if (offeneAnzahl >= ausleihLimit) {
      throw new Error(`Ausleihe nicht möglich: Diese Person hat bereits ${offeneAnzahl} von maximal ${ausleihLimit} Medien gleichzeitig ausgeliehen.`);
    }
  }

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

  // Merkte der ausleihende Nutzer diesen Titel selbst vor, gilt die
  // Vormerkung jetzt als erfüllt – erst danach die verbleibenden (fremden)
  // Vormerkungen ermitteln, damit sie in der Rückgabe nicht mitgezählt wird.
  db.prepare(`DELETE FROM "Vormerkung" WHERE "KatalogNi" = ? AND "LeserNi" = ?`).run(medium.KatalogNi, leserNi);
  const vormerkungenAndere = vormerkungenFuer(db, medium.KatalogNi);

  const { datum, hinweise } = berechneRueckgabedatum(db, { auslDatum, katalogNi: medium.KatalogNi, anzVerl: 0, einstellungen });
  return {
    id: info.lastInsertRowid,
    faelligAm: datum,
    hinweise,
    vormerkungHinweis: vormerkungenAndere.length
      ? `Achtung: ${vormerkungenAndere.length} weitere Vormerkung${vormerkungenAndere.length === 1 ? '' : 'en'} für diesen Titel (${vormerkungenAndere.map((v) => `${v.Nachname}, ${v.Vorname}`).join('; ')}).`
      : null,
  };
}

function zurueckgeben(db, ausleiheId) {
  db.prepare(`UPDATE "Ausleihe" SET "Rueckgabe" = ? WHERE id = ? AND "Rueckgabe" IS NULL`).run(todayStr(), ausleiheId);
}

/**
 * Verlängert eine Ausleihe um eine weitere Verlängerungsdauer (Medienart
 * oder Vorgabe aus den Einstellungen) und gibt das neu berechnete
 * Rückgabedatum gleich mit zurück, damit die Oberfläche es sofort anzeigen
 * kann, ohne die Liste komplett neu zu laden.
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

  if (einstellungen.verlaengerungGesperrtBeiVormerkung) {
    const vonAnderen = vormerkungenFuer(db, row.KatalogNi).filter((v) => v.LeserNi !== row.LeserNi);
    if (vonAnderen.length) {
      throw new Error(`Verlängerung nicht möglich: Dieser Titel ist von ${vonAnderen[0].Nachname}, ${vonAnderen[0].Vorname} vorgemerkt.`);
    }
  }

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
  const ferienListe = ferien.listeFerien(db);
  const heute = heuteISO();
  const ergebnis = [];
  for (const a of offen) {
    // Kein DB-Zugriff je Zeile mehr (a.medArtFrist/medArtFristVerl kommen
    // schon aus dem JOIN in alleOffenenAusleihen, ferienListe wird einmal für
    // die ganze Liste geladen) – wichtig, weil diese Schleife bei jedem
    // Dashboard-/Listen-Aufruf über alle offenen Ausleihen läuft.
    const { datum: faelligAm, hinweise } = berechneRueckgabedatumAusRow(a, einstellungen, ferienListe);
    // "Während der Ferien keine Überfälligkeit zählen": Ferientage (und
    // Wochenenden) zwischen Fälligkeit und heute zählen dann nicht als
    // Verzugstage – ein Kind, das wegen der Ferien nicht in die Bücherei
    // kann, soll dafür nicht "bestraft" werden.
    const tageUeberfaellig = einstellungen.ueberfaelligTageOhneFerien
      ? ferien.schultageZwischen(faelligAm, heute, ferienListe)
      : tageDifferenz(faelligAm, heute);
    if (tageUeberfaellig <= 0) continue;
    ergebnis.push({ ...a, tageUeberfaellig, faelligAm, fristHinweise: hinweise });
  }
  ergebnis.sort((x, y) => y.tageUeberfaellig - x.tageUeberfaellig);
  return ergebnis;
}

/** KatalogNi mit mindestens einem aktuell überfälligen Exemplar – für den Status-Filter "überfällig" in searchKatalog (siehe katalogNiIn dort). */
function katalogNiMitUeberfaelligemExemplar(db, einstellungen) {
  return [...new Set(ueberfaelligeAusleihen(db, einstellungen).map((a) => a.KatalogNi))];
}

/**
 * Die Mahnstufe mit der höchsten Schwelle, die bei `tageUeberfaellig` schon
 * erreicht ist, oder `null`, wenn noch keine erreicht ist. Sortiert dafür
 * erst nach Schwelle aufsteigend (Regressionsfix: die Oberfläche hängt eine
 * neue Stufe beim Anlegen immer ANS ENDE des Arrays an, nicht an die nach
 * Tagen richtige Stelle; ein Durchlauf in Array-Reihenfolge hätte dann bei
 * jeder nicht mehr zufällig schon sortierten Stufenliste die falsche –
 * meist zu milde – Stufe gewählt). `stufeIndex` bleibt der Index in der
 * URSPRÜNGLICHEN (unsortierten) Liste, weil die Oberfläche darüber die Stufe
 * wiedererkennt (Vorlagen-Auswahl in den Einstellungen, Badges).
 */
function erreichteStufe(tageUeberfaellig, mahnstufen) {
  const nachSchwelle = (mahnstufen || []).map((s, stufeIndex) => ({ ...s, stufeIndex })).sort((a, b) => a.tageUeberfaellig - b.tageUeberfaellig);
  let treffer = null;
  for (const s of nachSchwelle) {
    if (tageUeberfaellig < s.tageUeberfaellig) break; // aufsteigend sortiert: alles Weitere ist noch strenger
    treffer = s;
  }
  return treffer;
}

/**
 * Überfällige Ausleihen mit der passenden Mahnstufe (nach Tagen überfällig).
 * Nutzt Mahnstufen aus den Einstellungen; Ausleihen, die noch keine Stufe
 * erreicht haben, tauchen hier nicht auf (siehe dafür ueberfaelligeAusleihen
 * bzw. rueckstandsliste, die AUCH knapp-noch-nicht-fällige Fälle zeigt).
 * Liefert zusätzlich stufeIndex mit – die Oberfläche braucht ihn, um die
 * Stufe eindeutig wiederzuerkennen (Namen allein sind nicht eindeutig, falls
 * beide Stufen gleich benannt wurden).
 */
function ueberfaelligeMitStufe(db, einstellungen) {
  const ergebnis = [];
  for (const a of ueberfaelligeAusleihen(db, einstellungen)) {
    const treffer = erreichteStufe(a.tageUeberfaellig, einstellungen.mahnstufen);
    if (treffer) {
      const { stufeIndex, ...stufe } = treffer;
      ergebnis.push({ ...a, stufe, stufeIndex, gebuehr: berechneMahngebuehr(a.tageUeberfaellig, einstellungen) });
    }
  }
  return ergebnis;
}

/**
 * Letzte für GENAU diese Ausleihe (Medium+Kind+Ausleihdatum identifizieren
 * sie eindeutig) verschickte Erinnerung/Mahnung, falls vorhanden – für die
 * Anzeige "Erinnerung am 12.09." in der Rückstandsliste (Abschnitt 5.2).
 * Datensätze von vor der Zwei-Stufen-Umstellung (ohne IngaStufe oder mit
 * einer höheren als der jetzt gültigen Stufe 2) werden auf Stufe 2
 * abgebildet – "es gehen keine Vorgänge verloren" (Auftrag 5.1).
 */
function letzteMahnungFuer(db, medienNi, leserNi, auslDatum) {
  const row = db
    .prepare(
      `SELECT "Mahndatum","IngaStufe" FROM "Mahnung"
       WHERE "MedienNi" = ? AND "LeserNi" = ? AND "AuslDatum" = ?
       ORDER BY "Mahndatum" DESC, id DESC LIMIT 1`
    )
    .get(medienNi, leserNi, auslDatum);
  if (!row) return null;
  const stufeIndex = row.IngaStufe && row.IngaStufe <= 1 ? 0 : 1;
  return { datum: row.Mahndatum, stufeIndex };
}

/**
 * Rückstandsliste zum Abarbeiten (Abschnitt 5.2): alle offenen Ausleihen, die
 * mindestens `schwelleTage` überfällig sind (bewusst NICHT an eine Mahnstufe
 * gekoppelt – die Schwelle ist frei einstellbar, auch niedriger als Stufe 1),
 * je Fall die aktuell erreichte Stufe (falls schon eine erreicht ist) sowie
 * wann zuletzt welche Stufe für GENAU diesen Fall verschickt wurde.
 */
function rueckstandsliste(db, einstellungen, schwelleTage = 14) {
  const schwelle = Math.max(0, Number(schwelleTage) || 0);
  return ueberfaelligeAusleihen(db, einstellungen)
    .filter((a) => a.tageUeberfaellig >= schwelle)
    .map((a) => {
      const stufe = erreichteStufe(a.tageUeberfaellig, einstellungen.mahnstufen);
      return {
        ...a,
        stufeIndex: stufe ? stufe.stufeIndex : null,
        stufeText: stufe ? stufe.text : null,
        gebuehr: berechneMahngebuehr(a.tageUeberfaellig, einstellungen),
        letzteMahnung: letzteMahnungFuer(db, a.MedienNi, a.LeserNi, a.AuslDatum),
      };
    });
}

/**
 * Vorschau für den Button „Fristen anhand der Ferien neu berechnen“: für
 * jede offene Ausleihe wird verglichen, welches Datum ohne Ferienlogik
 * fällig wäre gegenüber dem tatsächlichen, ferienbewussten Fälligkeitsdatum.
 * Nur Ausleihen, bei denen sich dadurch etwas ändert, tauchen in der Liste
 * auf. Es wird bewusst NICHTS gespeichert: INGA berechnet Fälligkeiten immer
 * live aus Ausleihdatum + Einstellungen + Ferienliste, es gibt kein
 * gespeichertes "altes" Rückgabedatum, das aktualisiert werden müsste – neue
 * oder geänderte Ferieneinträge wirken automatisch auf jede Anzeige. Diese
 * Funktion dient allein dazu, den Kolleginnen die Auswirkung VOR dem
 * nächsten Blick in die Rückgabe-/Mahnliste sichtbar zu machen.
 */
function vorschauFristenMitFerien(db, einstellungen) {
  const offen = alleOffenenAusleihen(db);
  const ferienListe = ferien.listeFerien(db);
  const ergebnis = [];
  for (const a of offen) {
    const { gesamt } = fristTageGesamt({
      basisFristTage: istGesetzt(a.medArtFrist) ? a.medArtFrist : einstellungen.leihfristTage,
      verlaengerungFristTage: istGesetzt(a.medArtFristVerl) ? a.medArtFristVerl : einstellungen.verlaengerungDauerTage,
      anzVerl: a.AnzVerl,
      offsetTage: einstellungen.leihfristOffsetTage,
    });
    const ohneFerien = addDays(a.AuslDatum, gesamt);
    const nachVerlaengerung = ferien.verlaengerungDurchFerien(a.AuslDatum, ohneFerien, ferienListe, einstellungen.ferienZaehlweise);
    const nachNudge = ferien.verschobenesDatumMitHinweis(nachVerlaengerung.datum, ferienListe);
    const mitFerien = nachNudge.datum;
    const namen = [...nachVerlaengerung.namen, ...nachNudge.namen.filter((n) => !nachVerlaengerung.namen.includes(n))];
    if (mitFerien === ohneFerien) continue;
    ergebnis.push({
      id: a.id,
      Titel: a.Titel,
      Nachname: a.Nachname,
      Vorname: a.Vorname,
      faelligOhneFerien: ohneFerien,
      faelligMitFerien: mitFerien,
      differenzTage: tageDifferenz(ohneFerien, mitFerien),
      grund: namen.join(' und '),
    });
  }
  ergebnis.sort((x, y) => x.faelligMitFerien.localeCompare(y.faelligMitFerien));
  return ergebnis;
}

/** `stufe` ist 1 (Erinnerung) oder 2 (Mahnung) – siehe letzteMahnungFuer/rueckstandsliste. */
function mahnungEintragen(db, { medienNi, leserNi, auslDatum, gebuehr, stufe }) {
  db.prepare(
    `INSERT INTO "Mahnung" ("MedienNi","LeserNi","Mahndatum","MaGebuehr","AuslDatum","Rueckgabe","IngaStufe")
     VALUES (?, ?, ?, ?, ?, NULL, ?)`
  ).run(medienNi, leserNi, todayStr(), gebuehr, auslDatum, stufe || null);
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

/* ----------------------------------------------------------- Statistik */

/** "YYYY-MM" für den Monat, der `n` Monate vor dem heutigen liegt (n=0 → laufender Monat). */
function monatVorNMonaten(n) {
  const heute = parseKalenderdatum(heuteISO());
  const gesamtMonate = heute.getUTCFullYear() * 12 + heute.getUTCMonth() - n;
  const jahr = Math.floor(gesamtMonate / 12);
  const monat = ((gesamtMonate % 12) + 12) % 12;
  return `${jahr}-${String(monat + 1).padStart(2, '0')}`;
}

/** Anzahl Ausleihen je Kalendermonat, die letzten `monate` Monate (Vorgabe: 12), auch Monate ohne Ausleihe mit 0. */
function statistikAusleihenProMonat(db, monate = 12) {
  const ab = monatVorNMonaten(monate - 1);
  const rows = db
    .prepare(`SELECT substr("AuslDatum", 1, 7) AS monat, COUNT(*) AS anzahl FROM "Ausleihe" WHERE substr("AuslDatum", 1, 7) >= ? GROUP BY monat`)
    .all(ab);
  const nachMonat = new Map(rows.map((r) => [r.monat, r.anzahl]));
  const ergebnis = [];
  for (let i = monate - 1; i >= 0; i--) {
    const monat = monatVorNMonaten(i);
    ergebnis.push({ monat, anzahl: nachMonat.get(monat) || 0 });
  }
  return ergebnis;
}

/** Anzahl Ausleihen je Klasse (Leser.Jahrgang – Freitextfeld, kein Stammdatum), absteigend. */
function statistikAusleihenProKlasse(db) {
  return db
    .prepare(
      `SELECT COALESCE(NULLIF(l."Jahrgang", ''), '(ohne Klasse)') AS klasse, COUNT(*) AS anzahl
       FROM "Ausleihe" a JOIN "Leser" l ON l."LeserNi" = a."LeserNi"
       GROUP BY klasse ORDER BY anzahl DESC`
    )
    .all();
}

/** Anzahl Ausleihen je Kategorie (Systematik), absteigend. */
function statistikAusleihenProKategorie(db) {
  return db
    .prepare(
      `SELECT COALESCE(s."SystemBz", '(ohne Kategorie)') AS kategorie, COUNT(*) AS anzahl
       FROM "Ausleihe" a
       JOIN "Medien" m ON m."MedienNi" = a."MedienNi"
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       LEFT JOIN "Systematik" s ON s."SystemId" = k."SystemId"
       GROUP BY kategorie ORDER BY anzahl DESC`
    )
    .all();
}

/**
 * Ladenhüter: Titel, deren letzte Ausleihe mindestens `seitTagen` zurückliegt
 * (Vorgabe 365) – nie ausgeliehene Titel zählen mit ("letzte Ausleihe": nie).
 * Nur Titel mit mindestens einem Exemplar (sonst tauchen auch längst
 * ausgesonderte Karteileichen ohne Bestand auf).
 */
function ladenhueter(db, seitTagen = 365) {
  const grenze = addTage(heuteISO(), -seitTagen);
  return db
    .prepare(
      `SELECT k."KatalogNi", k."Titel", k."Autor", MAX(a."AuslDatum") AS letzteAusleihe
       FROM "Katalog" k
       JOIN "Medien" m ON m."KatalogNi" = k."KatalogNi"
       LEFT JOIN "Ausleihe" a ON a."MedienNi" = m."MedienNi"
       GROUP BY k."KatalogNi"
       HAVING letzteAusleihe IS NULL OR letzteAusleihe < ?
       ORDER BY letzteAusleihe IS NOT NULL, letzteAusleihe`
    )
    .all(grenze);
}

/** Verlustliste: alle Exemplare, die als "nicht verfügbar" markiert sind (z. B. vermisst, beschädigt – siehe Stammdaten "Nichtverf"). */
function verlustliste(db) {
  return db
    .prepare(
      `SELECT m."MedienNi", m."MedienEtik", k."Titel", k."Autor", nv."NichtVfBz" AS grund
       FROM "Medien" m
       JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
       LEFT JOIN "Nichtverf" nv ON nv."NichtVfNi" = m."NichtVfNi"
       WHERE m."NichtVfNi" IS NOT NULL
       ORDER BY k."Titel"`
    )
    .all();
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

/**
 * Medienart-Einstellungen speichern: abweichende Leih-/Verlängerungsfrist
 * (leer = Vorgabe aus den Einstellungen gilt wieder) sowie ob sie in
 * Katalog-Auswahl/-Filter auftaucht ("verbergen" – ein natives
 * Perpustakaan-Feld, siehe medArtStandardVerbergen()/Migration Version 9).
 */
function medArtEinstellungenSpeichern(db, medArtKb, { frist, fristVerl, verbergen }) {
  const zuNullOderZahl = (v) => (v === '' || v === null || v === undefined ? null : Number(v));
  db.prepare(`UPDATE "MedArt" SET "Frist" = ?, "FristVerl" = ?, "verbergen" = ? WHERE "MedArtKb" = ?`).run(
    zuNullOderZahl(frist),
    zuNullOderZahl(fristVerl),
    verbergen ? 1 : 0,
    medArtKb
  );
}

function stammdaten(db) {
  const out = {};
  for (const table of ['MedArt', 'Zweig', 'Systematik', 'Sprache', 'Reihe', 'LeserGrupp', 'AuslGrupp', 'Sperrung', 'SperrKat', 'Fachber', 'StandOrt']) {
    out[table] = db.prepare(`SELECT * FROM ${quoteIdent(table)}`).all();
  }
  return out;
}

/** Distinkte, tatsächlich vergebene Klassen/Jahrgänge – für den Klassenfilter in der Nutzerliste (kein eigenes Stammdatum, Jahrgang ist ein Freitextfeld). */
function distinctJahrgaenge(db) {
  return db
    .prepare(`SELECT DISTINCT "Jahrgang" AS jahrgang FROM "Leser" WHERE "Jahrgang" IS NOT NULL AND "Jahrgang" != '' ORDER BY "Jahrgang"`)
    .all()
    .map((r) => r.jahrgang);
}

/* -------------------------------------------------- Schuljahresende (Abschluss) */

/**
 * Kinder einer Klassenstufe, die zum Schuljahresende die Schule verlassen –
 * vergleicht `Jahrgang` als Präfix, weil das Feld Freitext ist (z. B. "4a",
 * "4b", nicht nur "4"). Bereits in den Papierkorb verschobene Kinder stehen
 * nicht mehr in "Leser" und tauchen hier folgerichtig nicht mehr auf.
 */
function abschlussKinder(db, klassenstufe) {
  const stufe = String(klassenstufe ?? '').trim();
  if (!stufe) return [];
  return db.prepare(`SELECT * FROM "Leser" WHERE "Jahrgang" LIKE ? ORDER BY "Jahrgang", "Nachname", "Vorname"`).all(`${stufe}%`);
}

/**
 * Die nächste (oder gerade laufende) Sommerferien-Eintragung – erkannt am
 * Namen (unscharf, "sommer" case-insensitive), weil es keinen eigenen Typ
 * "Sommerferien" gibt und Ferien frei benannt werden (siehe ferien.js). Ein
 * bereits vorbeigegangener Eintrag (Enddatum vor heute) zählt nicht mehr.
 * `listeFerien` liefert nach Startdatum aufsteigend sortiert, der erste
 * Treffer ist damit automatisch der nächstliegende.
 */
function naechsteSommerferien(db, heuteISOStr) {
  const heute = heuteISOStr || heuteISO();
  return ferien.listeFerien(db).find((f) => f.typ === 'Ferien' && /sommer/i.test(f.bezeichnung) && f.enddatum.slice(0, 10) >= heute) || null;
}

/**
 * Meldung "Kinder verlassen zum Schuljahresende die Schule": erscheint ab
 * einen Monat vor Beginn der (nächsten eingetragenen) Sommerferien, solange
 * es noch betroffene Kinder gibt. Liefert `null`, wenn keine Sommerferien
 * eingetragen sind, es noch zu früh ist, oder niemand (mehr) betroffen ist
 * (z. B. schon alle in den Papierkorb verschoben) – die Oberfläche zeigt in
 * diesem Fall einfach keinen Hinweis an.
 */
function abschlussMeldung(db, einstellungen, heuteISOStr) {
  const heute = heuteISOStr || heuteISO();
  const sommerferien = naechsteSommerferien(db, heute);
  if (!sommerferien) return null;
  const start = sommerferien.startdatum.slice(0, 10);
  if (heute < addTage(start, -30)) return null;
  const klassenstufe = einstellungen.abschlussKlassenstufe || '';
  const kinder = abschlussKinder(db, klassenstufe);
  if (!kinder.length) return null;
  return { sommerferienStart: start, sommerferienBezeichnung: sommerferien.bezeichnung, klassenstufe, kinder };
}

/**
 * Verschiebt mehrere Kinder auf einmal in den Papierkorb (siehe deleteLeser)
 * – ein Kind mit noch offenen Ausleihen wird übersprungen statt den ganzen
 * Durchgang abzubrechen, damit die übrigen trotzdem verschoben werden.
 */
function kinderInPapierkorbVerschieben(db, leserNis, benutzer) {
  let verschoben = 0;
  const uebersprungen = [];
  for (const leserNi of leserNis) {
    try {
      deleteLeser(db, leserNi, benutzer);
      verschoben += 1;
    } catch (err) {
      const leser = getLeser(db, leserNi);
      uebersprungen.push({ leserNi, name: leser ? `${leser.Nachname}, ${leser.Vorname}` : String(leserNi), grund: err.message });
    }
  }
  return { verschoben, uebersprungen };
}

/* ---------------------------------------------------------- Papierkorb */

/**
 * Schreibt eine Momentaufnahme von `row` in eine Papierkorb-Tabelle
 * (LeserAbg/MedienAbg) – nur Spalten, die diese Tabelle laut Referenzschema
 * tatsächlich kennt, Rest wird ignoriert. LoeschDat/LoeschAnw kommen immer
 * dazu. Nutzt bewusst kein upsert() (kein *Ni-Einzelschlüssel, siehe
 * ID_BASIERTE_TABELLEN) – jeder Löschvorgang bekommt eine neue Papierkorb-Zeile
 * (eigene id), auch wenn dieselbe Person/dasselbe Exemplar zuvor schon einmal
 * gelöscht und wiederhergestellt wurde.
 */
function verschiebeInPapierkorb(db, abgTable, row, benutzer) {
  const spalten = TABLES[abgTable].filter((c) => c !== 'LoeschDat' && c !== 'LoeschAnw');
  const cols = ['LoeschDat', 'LoeschAnw', ...spalten];
  const eintrag = { LoeschDat: nowStamp(), LoeschAnw: benutzer || 'inga' };
  for (const spalte of spalten) eintrag[spalte] = Object.hasOwn(row, spalte) ? row[spalte] : null;
  db.prepare(
    `INSERT INTO ${quoteIdent(abgTable)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`
  ).run(eintrag);
}

function papierkorbLeserListe(db) {
  return db.prepare(`SELECT * FROM "LeserAbg" ORDER BY "LoeschDat" DESC`).all();
}

function papierkorbMedienListe(db) {
  return db.prepare(`SELECT * FROM "MedienAbg" ORDER BY "LoeschDat" DESC`).all();
}

/** Holt eine Papierkorb-Zeile per id, wirft einen verständlichen Fehler statt still nichts zu tun. */
function papierkorbEintrag(db, table, id) {
  const row = db.prepare(`SELECT * FROM ${quoteIdent(table)} WHERE id = ?`).get(id);
  if (!row) throw new Error('Dieser Papierkorb-Eintrag existiert nicht (mehr) – Liste bitte neu laden.');
  return row;
}

/** Stellt einen gelöschten Nutzer wieder her (gleiche LeserNi wie vor dem Löschen) und entfernt den Papierkorb-Eintrag. */
function leserWiederherstellen(db, id) {
  const eintrag = papierkorbEintrag(db, 'LeserAbg', id);
  const spalten = TABLES.Leser;
  const row = {};
  for (const s of spalten) row[s] = eintrag[s];
  upsert(db, 'Leser', row);
  db.prepare(`DELETE FROM "LeserAbg" WHERE id = ?`).run(id);
  return row.LeserNi;
}

/**
 * Stellt ein gelöschtes Exemplar wieder her (gleiche MedienNi wie vor dem
 * Löschen) – nur, wenn der zugehörige Titel noch existiert, sonst würde ein
 * verwaistes Exemplar entstehen (siehe deleteKatalog: ein Titel nimmt beim
 * Löschen alle seine Exemplare mit, ohne sie einzeln in den Papierkorb zu
 * legen).
 */
function medienWiederherstellen(db, id) {
  const eintrag = papierkorbEintrag(db, 'MedienAbg', id);
  const katalog = db.prepare(`SELECT "KatalogNi" FROM "Katalog" WHERE "KatalogNi" = ?`).get(eintrag.KatalogNi);
  if (!katalog) throw new Error('Der zugehörige Titel wurde inzwischen gelöscht – Exemplar kann nicht ohne Titel wiederhergestellt werden.');
  const spalten = TABLES.Medien;
  const row = {};
  for (const s of spalten) row[s] = eintrag[s];
  const doppelt = db.prepare(`SELECT "MedienNi" FROM "Medien" WHERE "MedienEtik" = ?`).get(row.MedienEtik);
  if (doppelt) throw new Error(`Das Etikett/der Barcode „${row.MedienEtik}“ wird bereits von einem anderen Exemplar verwendet – bitte dort erst ändern.`);
  upsert(db, 'Medien', row);
  db.prepare(`DELETE FROM "MedienAbg" WHERE id = ?`).run(id);
  return row.MedienNi;
}

function leserEndgueltigLoeschen(db, id) {
  db.prepare(`DELETE FROM "LeserAbg" WHERE id = ?`).run(id);
}

function medienEndgueltigLoeschen(db, id) {
  db.prepare(`DELETE FROM "MedienAbg" WHERE id = ?`).run(id);
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
  exemplareMitAusleiheInfoFuer,
  medienVorschlaege,
  findExemplarByEtikett,
  saveMedium,
  deleteMedium,
  exemplarStatus,
  searchLeser,
  leserVorschlaege,
  getLeser,
  saveLeser,
  deleteLeser,
  leserGesperrt,
  leserSperren,
  leserEntsperren,
  offeneAusleihenVonLeser,
  alleOffenenAusleihen,
  umlaufliste,
  vormerken,
  vormerkungenFuer,
  vormerkungenVonLeser,
  vormerkungLoeschen,
  ausleihen,
  zurueckgeben,
  verlaengern,
  verschiebeOffeneAusleihen,
  ueberfaelligeAusleihen,
  ueberfaelligeMitStufe,
  erreichteStufe,
  letzteMahnungFuer,
  rueckstandsliste,
  katalogNiMitUeberfaelligemExemplar,
  vorschauFristenMitFerien,
  berechneRueckgabedatum,
  berechneRueckgabedatumAusRow,
  berechneMahngebuehr,
  mahnungEintragen,
  mahnhistorieVonLeser,
  topAusgelieheneBuecher,
  ausleihStatistikFuerKatalog,
  statistikAusleihenProMonat,
  statistikAusleihenProKlasse,
  statistikAusleihenProKategorie,
  ladenhueter,
  verlustliste,
  coverInfo,
  setCover,
  removeCover,
  stammdaten,
  distinctJahrgaenge,
  abschlussKinder,
  naechsteSommerferien,
  abschlussMeldung,
  kinderInPapierkorbVerschieben,
  medArtEinstellungenSpeichern,
  kennzahlen,
  papierkorbLeserListe,
  papierkorbMedienListe,
  leserWiederherstellen,
  medienWiederherstellen,
  leserEndgueltigLoeschen,
  medienEndgueltigLoeschen,
};
