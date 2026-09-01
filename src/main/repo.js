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
function searchKatalog(db, { query, medArtKb, systemId, verfuegbarkeit } = {}, seitenOptionen = {}) {
  const bedingungen = ['1=1'];
  const params = [];
  if (query) {
    bedingungen.push(`(k."Titel" LIKE ? OR k."Autor" LIKE ? OR k."ISBN" LIKE ? OR k."EAN" LIKE ? OR k."Schlagwort" LIKE ?)`);
    const like = `%${query}%`;
    params.push(like, like, like, like, like);
  }
  if (medArtKb) { bedingungen.push(`k."MedArtKb" = ?`); params.push(medArtKb); }
  if (systemId) { bedingungen.push(`k."SystemId" = ?`); params.push(systemId); }
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
  }
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
function searchLeser(db, { query, leserGruNi, zweigId, gesperrt, leserNiIn } = {}, seitenOptionen = {}) {
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
  if (Array.isArray(leserNiIn)) {
    bedingungen.push(`l."LeserNi" IN (${leserNiIn.map(() => '?').join(',')})`);
    params.push(...leserNiIn);
  }
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
  medArtFristSpeichern,
  kennzahlen,
};
