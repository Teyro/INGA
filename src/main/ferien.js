'use strict';

/**
 * Ferien- und Schließzeitenverwaltung: die `ferien`-Tabelle selbst (CRUD +
 * Validierung, egal ob manuell gepflegt oder importiert) sowie die reine
 * Verschiebungslogik, die berechnet, ob ein Datum ein Schultag ist und –
 * falls nicht – auf welchen Tag eine Fälligkeit dadurch verschoben wird.
 * Bleibt bewusst getrennt von repo.js: repo.js kennt die Ausleihe-Fachlogik
 * (Medienart, Verlängerung, Einstellungen), dieses Modul kennt nur Kalender.
 */

const { addTage, istWochenende, tageDifferenz } = require('./date-utils');

const TYPEN = ['Ferien', 'Feiertag', 'Schließzeit'];
const QUELLEN = ['manuell', 'Import'];

function alsDatum(wert, feld) {
  const s = String(wert ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${feld}: bitte ein gültiges Datum angeben.`);
  return s;
}

/** Wirft eine Error mit verständlicher deutscher Meldung, statt eines rohen SQL-Fehlers. */
function validiere(row) {
  const bezeichnung = String(row?.bezeichnung ?? '').trim();
  if (!bezeichnung) throw new Error('Bitte eine Bezeichnung angeben (z. B. „Herbstferien“).');
  const startdatum = alsDatum(row.startdatum, 'Startdatum');
  const enddatum = alsDatum(row.enddatum ?? row.startdatum, 'Enddatum');
  if (enddatum < startdatum) throw new Error('Das Enddatum darf nicht vor dem Startdatum liegen.');
  const typ = TYPEN.includes(row.typ) ? row.typ : 'Ferien';
  const quelle = QUELLEN.includes(row.quelle) ? row.quelle : 'manuell';
  return { bezeichnung: bezeichnung.slice(0, 200), startdatum, enddatum, typ, quelle };
}

function listeFerien(db) {
  return db.prepare(`SELECT * FROM ferien ORDER BY startdatum`).all();
}

function getFerienEintrag(db, id) {
  return db.prepare(`SELECT * FROM ferien WHERE id = ?`).get(id);
}

function saveFerienEintrag(db, row) {
  const clean = validiere(row);
  if (row?.id) {
    db.prepare(
      `UPDATE ferien SET bezeichnung=@bezeichnung, startdatum=@startdatum, enddatum=@enddatum, typ=@typ, quelle=@quelle WHERE id=@id`
    ).run({ ...clean, id: row.id });
    return row.id;
  }
  const info = db
    .prepare(
      `INSERT INTO ferien (bezeichnung, startdatum, enddatum, typ, quelle) VALUES (@bezeichnung, @startdatum, @enddatum, @typ, @quelle)`
    )
    .run(clean);
  return info.lastInsertRowid;
}

function deleteFerienEintrag(db, id) {
  db.prepare(`DELETE FROM ferien WHERE id = ?`).run(id);
}

/**
 * Übernimmt mehrere importierte Termine (ICS oder API-Abruf) in einem Rutsch,
 * mit derselben Validierung wie die manuelle Pflege. Termine, die bereits
 * identisch vorhanden sind (gleiche Bezeichnung + gleicher Zeitraum), werden
 * übersprungen statt doppelt angelegt – wichtig, weil ein Import/Abruf
 * durchaus mehrfach ausgeführt wird (z. B. jedes Schuljahr erneut, oder
 * versehentlich zweimal hintereinander).
 */
function ferienImportUebernehmen(db, eintraege) {
  const bestehende = listeFerien(db);
  const istDoppelt = (e) =>
    bestehende.some((b) => b.bezeichnung === e.bezeichnung && b.startdatum === e.startdatum && b.enddatum === e.enddatum);
  let neu = 0;
  let uebersprungen = 0;
  const tx = db.transaction(() => {
    for (const roh of eintraege || []) {
      const clean = validiere({ ...roh, quelle: 'Import' });
      if (istDoppelt(clean)) {
        uebersprungen += 1;
        continue;
      }
      saveFerienEintrag(db, clean);
      bestehende.push(clean);
      neu += 1;
    }
  });
  tx();
  return { neu, uebersprungen };
}

/** Der erste Ferien-/Feiertags-/Schließzeit-Eintrag, der das Datum abdeckt (oder null). */
function ferienEintragFuer(datum, ferienListe) {
  return ferienListe.find((f) => datum >= f.startdatum.slice(0, 10) && datum <= f.enddatum.slice(0, 10)) || null;
}

/** Schultag = weder Wochenende noch von einem Ferien-/Feiertags-/Schließzeit-Eintrag abgedeckt. */
function istSchultagAn(datum, ferienListe) {
  if (istWochenende(datum)) return false;
  return !ferienEintragFuer(datum, ferienListe);
}

/**
 * Verschiebt ein (bereits berechnetes) Fälligkeitsdatum auf den nächsten
 * echten Schultag, falls es auf ein Wochenende, einen Feiertag oder in
 * Ferien/eine Schließzeit fällt. Läuft dafür Tag für Tag vor – dadurch werden
 * auch mehrere unmittelbar aneinandergrenzende freie Zeiträume (z. B. Ferien
 * direkt gefolgt von einem Feiertag) automatisch komplett durchgeschoben,
 * ohne dass das gesondert behandelt werden müsste. `namen` sammelt die
 * Bezeichnungen aller dabei überstrichenen Ferien-/Feiertags-Einträge – für
 * einen nachvollziehbaren Hinweis in der Oberfläche (z. B. „+12 Tage wegen
 * Herbstferien“). Reine Wochenendtage ohne eigenen Eintrag tragen nichts zu
 * `namen` bei, verlängern aber die Schleife wie jeder andere freie Tag auch.
 * Die Obergrenze von 3650 Iterationen ist ein reines Sicherheitsnetz gegen
 * eine Endlosschleife bei fehlerhaften Daten (z. B. ein Ferieneintrag ohne
 * Ende weit in der Zukunft) – im Normalbetrieb nie erreicht.
 */
function verschobenesDatumMitHinweis(datum, ferienListe) {
  let d = datum;
  const namen = [];
  for (let i = 0; i < 3650 && !istSchultagAn(d, ferienListe); i++) {
    const treffer = ferienEintragFuer(d, ferienListe);
    if (treffer && !namen.includes(treffer.bezeichnung)) namen.push(treffer.bezeichnung);
    d = addTage(d, 1);
  }
  return { datum: d, namen };
}

/**
 * Anzahl Schultage zwischen `vonExklusiv` (ausschließlich) und `bisInklusiv`
 * (einschließlich) – Grundlage für die Einstellung „Während der Ferien keine
 * Überfälligkeit zählen“: Wochenenden und Ferien-/Feiertage in diesem
 * Zeitraum zählen dann nicht als Verzugstage. Ist der Zeitraum leer oder
 * negativ (noch nicht überfällig), wird das Ergebnis unverändert durchgereicht.
 */
function schultageZwischen(vonExklusiv, bisInklusiv, ferienListe) {
  const gesamtDiff = tageDifferenz(vonExklusiv, bisInklusiv);
  if (gesamtDiff <= 0) return gesamtDiff;
  let zaehl = 0;
  let d = vonExklusiv;
  for (let i = 0; i < gesamtDiff; i++) {
    d = addTage(d, 1);
    if (istSchultagAn(d, ferienListe)) zaehl++;
  }
  return zaehl;
}

module.exports = {
  TYPEN,
  QUELLEN,
  listeFerien,
  getFerienEintrag,
  saveFerienEintrag,
  deleteFerienEintrag,
  ferienImportUebernehmen,
  ferienEintragFuer,
  istSchultagAn,
  verschobenesDatumMitHinweis,
  schultageZwischen,
};
