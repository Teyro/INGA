'use strict';

/** Fachliche Datenzugriffe: Katalog, Exemplare, Leser, Ausleihe/Rückgabe, Mahnwesen. */

const { upsert, nextId, quoteIdent, TABLES } = require('./db');
const { heuteISO, heuteStamp, jetztStamp, addTage, tageDifferenz } = require('./date-utils');
const ferien = require('./ferien');

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

/** Löscht ein Exemplar – nicht, solange es ausgeliehen ist (siehe deleteKatalog für die Begründung). */
function deleteMedium(db, medienNi) {
  if (exemplarStatus(db, medienNi).verliehen) {
    throw new Error('Dieses Exemplar ist noch ausgeliehen. Bitte erst zurückgeben, dann löschen.');
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
  const gesperrtAusdruck = `(
    (l."SperrungNi" IS NOT NULL AND l."SperrungNi" != 0 AND EXISTS (SELECT 1 FROM "Sperrung" s WHERE s."SperrungNi" = l."SperrungNi"))
    OR (l."AusleihBis" IS NOT NULL AND l."AusleihBis" != '' AND substr(l."AusleihBis", 1, 10) < ?)
  )`;
  if (gesperrt === 'gesperrt') { bedingungen.push(gesperrtAusdruck); params.push(todayStr().slice(0, 10)); }
  else if (gesperrt === 'aktiv') { bedingungen.push(`NOT ${gesperrtAusdruck}`); params.push(todayStr().slice(0, 10)); }
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

/** Löscht einen Nutzer – nicht, solange er noch offene Ausleihen hat (siehe deleteKatalog für die Begründung). */
function deleteLeser(db, leserNi) {
  if (offeneAusleihenVonLeser(db, leserNi).length) {
    throw new Error('Dieser Nutzer hat noch offene Ausleihen. Bitte erst alle Bücher zurückgeben, dann löschen.');
  }
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
 * Verschiebt ein rein aus der Frist errechnetes Datum ggf. auf den nächsten
 * Schultag (siehe ferien.js) und hängt bei Bedarf einen nachvollziehbaren
 * Hinweis an ("+12 Tage wegen Herbstferien"). `hinweise` wird nicht mutiert,
 * sondern eine neue Liste zurückgegeben.
 */
function mitFerienverschiebung(naivesDatum, ferienListe, hinweise) {
  const { datum, namen } = ferien.verschobenesDatumMitHinweis(naivesDatum, ferienListe);
  if (!namen.length) return { datum, hinweise };
  const verschobenTage = tageDifferenz(naivesDatum, datum);
  const hinweisText = `+${verschobenTage} Tag${verschobenTage === 1 ? '' : 'e'} wegen ${namen.join(' und ')}`;
  return { datum, hinweise: [...hinweise, hinweisText] };
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
  const { datum, hinweise: hinweiseMitFerien } = mitFerienverschiebung(naiv, ferien.listeFerien(db), hinweise);
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
  const { datum, hinweise: hinweiseMitFerien } = mitFerienverschiebung(naiv, ferienListe, hinweise);
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
 * Überfällige Ausleihen mit der passenden Mahnstufe (nach Tagen überfällig).
 * Nutzt Mahnstufen aus den Einstellungen; Ausleihen, die noch keine Stufe
 * erreicht haben, tauchen hier nicht auf (siehe dafür ueberfaelligeAusleihen).
 * Liefert zusätzlich stufeIndex mit – die Oberfläche braucht ihn, um die
 * Stufe eindeutig wiederzuerkennen (Namen allein sind nicht eindeutig, falls
 * zwei Stufen gleich benannt wurden).
 */
function ueberfaelligeMitStufe(db, einstellungen) {
  // Die Stufe mit der höchsten Schwelle wählen, die noch erreicht ist – dafür
  // erst nach Schwelle aufsteigend sortieren (Regressionsfix: die Oberfläche
  // hängt eine neue Stufe beim Anlegen immer ANS ENDE des Arrays an, nicht an
  // die nach Tagen richtige Stelle; ein Durchlauf in Array-Reihenfolge hätte
  // dann bei jeder nicht mehr zufällig schon sortierten Stufenliste die
  // falsche – meist zu milde – Stufe gewählt). stufeIndex bleibt der Index in
  // der URSPRÜNGLICHEN (unsortierten) Liste, weil die Oberfläche darüber die
  // Stufe wiedererkennt (Mahnstufen-Filter, Badges).
  const stufenNachSchwelle = (einstellungen.mahnstufen || [])
    .map((s, stufeIndex) => ({ ...s, stufeIndex }))
    .sort((a, b) => a.tageUeberfaellig - b.tageUeberfaellig);

  const ergebnis = [];
  for (const a of ueberfaelligeAusleihen(db, einstellungen)) {
    let treffer = null;
    for (const s of stufenNachSchwelle) {
      if (a.tageUeberfaellig < s.tageUeberfaellig) break; // aufsteigend sortiert: alles Weitere ist noch strenger
      treffer = s;
    }
    if (treffer) {
      const { stufeIndex, ...stufe } = treffer;
      ergebnis.push({ ...a, stufe, stufeIndex, gebuehr: berechneMahngebuehr(a.tageUeberfaellig, einstellungen) });
    }
  }
  return ergebnis;
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
    const { datum: mitFerien, namen } = ferien.verschobenesDatumMitHinweis(ohneFerien, ferienListe);
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
  umlaufliste,
  ausleihen,
  zurueckgeben,
  verlaengern,
  verschiebeOffeneAusleihen,
  ueberfaelligeAusleihen,
  ueberfaelligeMitStufe,
  katalogNiMitUeberfaelligemExemplar,
  vorschauFristenMitFerien,
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
  distinctJahrgaenge,
  medArtFristSpeichern,
  kennzahlen,
};
