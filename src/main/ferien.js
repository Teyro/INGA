'use strict';

/**
 * Ferien- und Schließzeitenverwaltung: die `ferien`-Tabelle selbst (CRUD +
 * Validierung, egal ob manuell gepflegt oder importiert) sowie die reine
 * Verschiebungslogik, die berechnet, ob ein Datum ein Schultag ist und –
 * falls nicht – auf welchen Tag eine Fälligkeit dadurch verschoben wird.
 * Bleibt bewusst getrennt von repo.js: repo.js kennt die Ausleihe-Fachlogik
 * (Medienart, Verlängerung, Einstellungen), dieses Modul kennt nur Kalender.
 */

const { addTage, istWochenende, tageDifferenz, heuteISO } = require('./date-utils');

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
  // Gegen die schon zu Abschnitten gebündelten Bestandsdaten prüfen (siehe
  // buendleAbschnitte) statt nur gegen die rohen Zeilen – so werden neue,
  // bereits gebündelte Importe auch dann als Dublette erkannt, wenn eine
  // ältere Bibliothek denselben Zeitraum noch als mehrere Einzeltag-Zeilen
  // aus einem Import von vor dieser Umstellung gespeichert hat.
  let bestehendeAbschnitte = buendleAbschnitte(listeFerien(db));
  const istDoppelt = (e) =>
    bestehendeAbschnitte.some((b) => b.bezeichnung === e.bezeichnung && b.startdatum === e.startdatum && b.enddatum === e.enddatum);
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
      bestehendeAbschnitte = [...bestehendeAbschnitte, clean];
      neu += 1;
    }
  });
  tx();
  return { neu, uebersprungen };
}

/* -------------------------------------------------- Kompakte Übersicht (Abschnitt 2.1) */

/**
 * Bündelt zusammenhängende Ferieneinträge gleicher Bezeichnung/Typ zu einem
 * Abschnitt – Grundlage sowohl für die Anzeige (viele Kalender liefern beim
 * Import jeden Ferientag als eigenen Eintrag) als auch für den Import selbst
 * (siehe main.js: die Importvorschau bündelt VOR dem Übernehmen, damit gar
 * nicht erst hunderte Einzeltag-Zeilen entstehen). Rein additiv nach
 * Kalendertagen: zwei Einträge werden zusammengefasst, wenn sie sich
 * unmittelbar berühren oder überlappen UND dieselbe Bezeichnung/denselben Typ
 * haben – ein direkt anschließender, ANDERS benannter Termin (z. B. ein
 * Feiertag direkt nach den Ferien) bleibt bewusst ein eigener Abschnitt.
 * `id`s der zusammengefassten Zeilen werden gesammelt (für Bearbeiten/Löschen
 * in der Oberfläche), unterschiedliche `quelle`-Werte ergeben `"gemischt"`.
 */
function buendleAbschnitte(eintraege) {
  const sortiert = [...(eintraege || [])].sort(
    (a, b) => a.startdatum.localeCompare(b.startdatum) || String(a.bezeichnung).localeCompare(String(b.bezeichnung))
  );
  const abschnitte = [];
  for (const e of sortiert) {
    const letzter = abschnitte[abschnitte.length - 1];
    const passtAnLetzten =
      letzter && letzter.bezeichnung === e.bezeichnung && letzter.typ === e.typ && e.startdatum <= addTage(letzter.enddatum, 1);
    if (passtAnLetzten) {
      if (e.enddatum > letzter.enddatum) letzter.enddatum = e.enddatum;
      if (e.id !== undefined) letzter.ids.push(e.id);
      if (e.quelle && letzter.quelle && e.quelle !== letzter.quelle) letzter.quelle = 'gemischt';
    } else {
      abschnitte.push({
        bezeichnung: e.bezeichnung,
        typ: e.typ,
        startdatum: e.startdatum,
        enddatum: e.enddatum,
        quelle: e.quelle,
        ids: e.id !== undefined ? [e.id] : [],
      });
    }
  }
  return abschnitte.map((a) => ({ ...a, tage: tageDifferenz(a.startdatum, a.enddatum) + 1 }));
}

/** Hamburger Schuljahr (1. August – 31. Juli) für ein Kalenderdatum: Startjahr + Anzeige-Label "2026/27". */
function schuljahrFuer(datumISO) {
  const [jahrStr, monatStr] = String(datumISO).slice(0, 7).split('-');
  const jahr = Number(jahrStr);
  const monat = Number(monatStr);
  const startJahr = monat >= 8 ? jahr : jahr - 1;
  return { startJahr, label: `${startJahr}/${String((startJahr + 1) % 100).padStart(2, '0')}` };
}

/**
 * Gruppiert bereits gebündelte Abschnitte nach Schuljahr (neuestes zuerst,
 * jeweils nach Startdatum sortiert) und kennzeichnet vergangene Schuljahre.
 * `heuteISOStr` ist injizierbar für Tests, Vorgabe das echte heutige Datum.
 */
function gruppiereNachSchuljahr(abschnitte, heuteISOStr) {
  const heutigesStartJahr = schuljahrFuer(heuteISOStr || heuteISO()).startJahr;
  const nachSchuljahr = new Map();
  for (const a of abschnitte) {
    const { startJahr, label } = schuljahrFuer(a.startdatum);
    if (!nachSchuljahr.has(startJahr)) nachSchuljahr.set(startJahr, { schuljahr: label, startJahr, abschnitte: [] });
    nachSchuljahr.get(startJahr).abschnitte.push(a);
  }
  return [...nachSchuljahr.values()]
    .map((g) => ({
      ...g,
      vergangen: g.startJahr < heutigesStartJahr,
      aktuell: g.startJahr === heutigesStartJahr,
      abschnitte: g.abschnitte.sort((x, y) => x.startdatum.localeCompare(y.startdatum)),
    }))
    .sort((x, y) => y.startJahr - x.startJahr);
}

/** Für die Ferien-Übersicht in den Einstellungen: Bestand gebündelt und nach Schuljahr gruppiert. */
function gruppiereFuerAnzeige(db, heuteISOStr) {
  return gruppiereNachSchuljahr(buendleAbschnitte(listeFerien(db)), heuteISOStr);
}

/**
 * Vorschau vor dem Übernehmen eines Imports/Abrufs: bündelt die rohen
 * (möglicherweise tageweise vorliegenden) Termine zu Abschnitten, gruppiert
 * nach Schuljahr und markiert je Abschnitt, ob er (als Abschnitt, nicht nur
 * als Einzeltag) bereits vorhanden ist – Grundlage für "Schuljahr 2027/28: 6
 * Abschnitte, davon 2 schon vorhanden" in der Oberfläche.
 */
function vorschauFuerImport(db, termine, heuteISOStr) {
  const bestehendeAbschnitte = buendleAbschnitte(listeFerien(db));
  const istVorhanden = (a) => bestehendeAbschnitte.some((b) => b.bezeichnung === a.bezeichnung && b.startdatum === a.startdatum && b.enddatum === a.enddatum);
  const abschnitte = buendleAbschnitte(termine).map((a) => ({ ...a, bereitsVorhanden: istVorhanden(a) }));
  return gruppiereNachSchuljahr(abschnitte, heuteISOStr).map((g) => ({
    ...g,
    anzahlVorhanden: g.abschnitte.filter((a) => a.bereitsVorhanden).length,
  }));
}

/** Löscht ein komplettes Schuljahr (1.8. des Startjahrs bis 31.7. des Folgejahrs) auf einmal. */
function loescheSchuljahr(db, startJahr) {
  const von = `${startJahr}-08-01`;
  const bis = `${Number(startJahr) + 1}-07-31`;
  const info = db.prepare(`DELETE FROM ferien WHERE startdatum >= ? AND startdatum <= ?`).run(von, bis);
  return info.changes;
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

/* --------------------------------------------- Frist verlängert sich um Ferien (Abschnitt 2.2) */

/**
 * Eigentlicher Zweck der Ferienverwaltung: Fällt die Ausleihspanne
 * (`auslDatum` bis zur naiv berechneten Fälligkeit) ganz oder teilweise in
 * einen Ferien-/Schließzeit-Zeitraum, verschiebt sich die Fälligkeit um dessen
 * volle Länge nach hinten – nicht nur um den überlappenden Teil (Beispiel aus
 * dem Auftrag: Ausleihe 14.10., 28 Tage Frist, Herbstferien 20.10.–31.10.
 * liegen komplett VOR der naiven Fälligkeit 11.11., trotzdem verschiebt sich
 * die Fälligkeit um die vollen 12 Ferientage auf den 23.11.). Feiertage zählen
 * bewusst nicht mit (nur `typ: 'Ferien'` und `'Schließzeit'`) – ein einzelner
 * Feiertag verlängert die Leihfrist nicht extra, er wird wie bisher nur über
 * `verschobenesDatumMitHinweis` behandelt, falls die Fälligkeit direkt darauf
 * fällt. Läuft iterativ (wie `verschobenesDatumMitHinweis`), weil eine
 * Verlängerung die Fälligkeit in einen WEITEREN, bis dahin nicht berührten
 * Ferienabschnitt schieben kann (z. B. Herbstferien knapp gefolgt von
 * Weihnachtsferien). `zaehlweise` steuert, ob die volle Kalenderlänge eines
 * Abschnitts zählt oder nur seine Schultage (siehe `schultageZwischen`).
 */
/**
 * Anzahl der Werktage (Mo–Fr) innerhalb eines Zeitraums – für die Zählweise
 * "Schultage" wird ein Ferienabschnitt damit auf seine eigenen Werktage
 * verkürzt (die enthaltenen Wochenenden zählen nicht extra). Bewusst NICHT
 * `istSchultagAn`/`schultageZwischen`: die zählen einen Tag innerhalb der
 * Ferien selbst grundsätzlich als "kein Schultag" (weil er in der Ferienliste
 * steckt) – hier soll es aber um die Werktage GENAU DIESES Abschnitts gehen.
 */
function werktageInZeitraum(startdatum, enddatum) {
  let zaehl = 0;
  let d = startdatum;
  while (d <= enddatum) {
    if (!istWochenende(d)) zaehl++;
    d = addTage(d, 1);
  }
  return zaehl;
}

function verlaengerungDurchFerien(auslDatum, naivesDatum, ferienListe, zaehlweise = 'kalendertage') {
  const relevante = (ferienListe || []).filter((f) => f.typ === 'Ferien' || f.typ === 'Schließzeit');
  let ende = naivesDatum;
  const beruecksichtigt = new Set();
  const namen = [];
  // Obergrenze als Sicherheitsnetz gegen fehlerhafte Daten (siehe
  // verschobenesDatumMitHinweis) – im Normalbetrieb weit unerreicht, da jeder
  // Ferienabschnitt nur einmal zählt.
  for (let i = 0; i < 1000; i++) {
    const treffer = relevante.find(
      (f) => !beruecksichtigt.has(f) && auslDatum <= f.enddatum.slice(0, 10) && ende >= f.startdatum.slice(0, 10)
    );
    if (!treffer) break;
    beruecksichtigt.add(treffer);
    const start = treffer.startdatum.slice(0, 10);
    const endeAbschnitt = treffer.enddatum.slice(0, 10);
    const tage = zaehlweise === 'schultage' ? werktageInZeitraum(start, endeAbschnitt) : tageDifferenz(start, endeAbschnitt) + 1;
    if (tage <= 0) continue;
    ende = addTage(ende, tage);
    namen.push(treffer.bezeichnung);
  }
  if (!namen.length) return { datum: naivesDatum, namen: [] };
  return { datum: ende, namen };
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
  buendleAbschnitte,
  schuljahrFuer,
  gruppiereNachSchuljahr,
  gruppiereFuerAnzeige,
  vorschauFuerImport,
  loescheSchuljahr,
  verlaengerungDurchFerien,
};
