'use strict';

/**
 * Automatischer Abruf der Hamburger Schulferien/Feiertage über eine offene
 * API. Primärquelle openholidaysapi.org (liefert Schulferien UND Feiertage
 * für Hamburg), bei Fehlschlag Fallback auf ferien-api.de (nur Schulferien).
 * Wirft absichtlich nie: ohne Internetverbindung oder wenn beide Quellen
 * ausfallen, kommt `{ ok: false, fehler }` zurück – der Aufrufer zeigt dann
 * eine verständliche Meldung statt eines Absturzes. Die zurückgelieferten
 * Termine werden NIE direkt gespeichert, sondern immer erst als Vorschau
 * angezeigt (siehe ferien:api-abrufen in main.js).
 */

const OPENHOLIDAYS_BASE = 'https://openholidaysapi.org';
const FERIEN_API_BASE = 'https://ferien-api.de/api/v1';
const TIMEOUT_MS = 12000;

/** Hamburger Schuljahr beginnt am 1. August – "laufendes Schuljahr" bezogen auf ein beliebiges Kalenderdatum. */
function heutigesSchuljahrStart(heuteISOStr) {
  const [jahrStr, monatStr] = String(heuteISOStr).split('-');
  const jahr = Number(jahrStr);
  const monat = Number(monatStr);
  return monat >= 8 ? jahr : jahr - 1;
}

async function holenMitTimeout(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    throw new Error(err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message);
  } finally {
    clearTimeout(timer);
  }
}

function nameAus(eintrag, fallback) {
  const liste = Array.isArray(eintrag?.name) ? eintrag.name : [];
  return liste.find((n) => n.language === 'DE')?.text || liste[0]?.text || fallback;
}

/** Schulferien + Feiertage für Hamburg, laufendes plus die nächsten drei Schuljahre (je Schuljahr einzeln abgefragt). */
async function holeVonOpenHolidays(heuteISOStr) {
  const startJahr = heutigesSchuljahrStart(heuteISOStr);
  const ergebnisse = [];
  for (let i = 0; i < 4; i++) {
    const von = `${startJahr + i}-08-01`;
    const bis = `${startJahr + i + 1}-07-31`;
    const gemeinsam = `countryIsoCode=DE&subdivisionCode=DE-HH&languageIsoCode=DE&validFrom=${von}&validTo=${bis}`;
    const [schulferien, feiertage] = await Promise.all([
      holenMitTimeout(`${OPENHOLIDAYS_BASE}/SchoolHolidays?${gemeinsam}`),
      holenMitTimeout(`${OPENHOLIDAYS_BASE}/PublicHolidays?${gemeinsam}`),
    ]);
    for (const f of schulferien || []) {
      ergebnisse.push({ bezeichnung: nameAus(f, 'Ferien'), startdatum: String(f.startDate).slice(0, 10), enddatum: String(f.endDate).slice(0, 10), typ: 'Ferien' });
    }
    for (const f of feiertage || []) {
      ergebnisse.push({ bezeichnung: nameAus(f, 'Feiertag'), startdatum: String(f.startDate).slice(0, 10), enddatum: String(f.endDate).slice(0, 10), typ: 'Feiertag' });
    }
  }
  return ergebnisse;
}

/** Fallback: ferien-api.de kennt nur Schulferien (keine Feiertage), je Kalenderjahr abgefragt. */
async function holeVonFerienApiDe(heuteISOStr) {
  const startJahr = heutigesSchuljahrStart(heuteISOStr);
  const jahre = [startJahr, startJahr + 1, startJahr + 2, startJahr + 3, startJahr + 4];
  const ergebnisse = [];
  let mindestensEinJahrOk = false;
  for (const jahr of jahre) {
    let liste;
    try {
      liste = await holenMitTimeout(`${FERIEN_API_BASE}/holidays/HH/${jahr}`);
      mindestensEinJahrOk = true;
    } catch {
      continue; // ein einzelnes (noch nicht gepflegtes) Jahr soll den Rest nicht verhindern
    }
    for (const f of liste || []) {
      ergebnisse.push({ bezeichnung: f.name, startdatum: String(f.start).slice(0, 10), enddatum: String(f.end).slice(0, 10), typ: 'Ferien' });
    }
  }
  if (!mindestensEinJahrOk) throw new Error('keine der abgefragten Jahre lieferte Daten');
  return ergebnisse;
}

async function ferienAbrufen(heuteISOStr) {
  try {
    const termine = await holeVonOpenHolidays(heuteISOStr);
    return { ok: true, quelle: 'openholidaysapi.org', termine };
  } catch (err) {
    try {
      const termine = await holeVonFerienApiDe(heuteISOStr);
      return { ok: true, quelle: 'ferien-api.de (nur Schulferien, ohne Feiertage)', termine };
    } catch (err2) {
      return { ok: false, fehler: `Weder openholidaysapi.org (${err.message}) noch ferien-api.de (${err2.message}) erreichbar. Bitte Internetverbindung prüfen oder Ferien manuell/per ICS-Datei eintragen.` };
    }
  }
}

module.exports = { ferienAbrufen, heutigesSchuljahrStart };
