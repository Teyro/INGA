'use strict';

/**
 * Buchdaten per ISBN nachschlagen – zwei offene Quellen nacheinander (kein
 * Konto/API-Key nötig), analog zum Cover-Download in cover-quellen.js:
 * erst Open Library, findet die nichts (z. B. kleiner/regionaler Verlag,
 * Lehr-/Arbeitsheft), zusätzlich Google Books als zweite Chance. Liefert
 * nur Rohdaten zurück; die Oberfläche übernimmt sie NICHT automatisch in
 * den Katalog, sondern trägt sie lediglich in das gerade offene Formular
 * ein – gespeichert wird erst durch einen bewussten Klick auf "Speichern"
 * (manuelle Bestätigung).
 */

const TIMEOUT_MS = 12000;

function ersterJahrgang(text) {
  return String(text || '').match(/\d{4}/)?.[0] || '';
}

async function holenMitTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } finally {
    clearTimeout(timeout);
  }
}

async function openLibraryBuchdaten(isbn) {
  try {
    const res = await holenMitTimeout(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`);
    if (!res.ok) return { ok: false, grund: `HTTP ${res.status}` };
    const json = await res.json();
    const eintrag = json[`ISBN:${isbn}`];
    if (!eintrag) return { ok: false, grund: 'keine Daten gefunden' };
    return {
      ok: true,
      daten: {
        Titel: eintrag.title || '',
        UntTitel: eintrag.subtitle || '',
        Autor: (eintrag.authors || []).map((a) => a.name).join('; '),
        Verlag: (eintrag.publishers || []).map((p) => p.name).join('; '),
        ErschJahr: ersterJahrgang(eintrag.publish_date),
      },
    };
  } catch (err) {
    return { ok: false, grund: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message };
  }
}

async function googleBooksBuchdaten(isbn) {
  try {
    const res = await holenMitTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
    if (!res.ok) return { ok: false, grund: `HTTP ${res.status}` };
    const json = await res.json();
    const info = json?.items?.[0]?.volumeInfo;
    if (!info) return { ok: false, grund: 'keine Daten gefunden' };
    return {
      ok: true,
      daten: {
        Titel: info.title || '',
        UntTitel: info.subtitle || '',
        Autor: (info.authors || []).join('; '),
        Verlag: info.publisher || '',
        ErschJahr: ersterJahrgang(info.publishedDate),
      },
    };
  } catch (err) {
    return { ok: false, grund: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message };
  }
}

const BUCHDATEN_QUELLEN = [
  { id: 'openlibrary', name: 'Open Library', hole: openLibraryBuchdaten },
  { id: 'google-books', name: 'Google Books', hole: googleBooksBuchdaten },
];

/**
 * Probiert die Quellen der Reihe nach, bis eine Daten liefert. Scheitern
 * alle, wird der Grund der ERSTEN Quelle gemeldet (nicht eine allgemeine
 * Sammelmeldung) – bei technischen Fehlern (Zeitüberschreitung, kein
 * Internet, HTTP-Fehler) ist das die aussagekräftigere Meldung, und beide
 * Quellen scheitern ohnehin praktisch immer aus demselben Grund (dieselbe
 * ISBN, dieselbe Netzwerkverbindung). `isbnRoh` kann Bindestriche/
 * Leerzeichen enthalten (aus einem Barcode-Scan oder von Hand getippt);
 * `quellen` ist injizierbar (Tests, oder um eine Quelle gezielt
 * abzuschalten).
 */
async function holeBuchdaten(isbnRoh, quellen = BUCHDATEN_QUELLEN) {
  const isbn = String(isbnRoh || '').replace(/[^0-9Xx]/g, '');
  if (!isbn) return { ok: false, grund: 'keine ISBN angegeben' };

  let ersterFehler = null;
  for (const quelle of quellen) {
    const ergebnis = await quelle.hole(isbn);
    if (ergebnis.ok) return { ok: true, daten: ergebnis.daten, quelle: quelle.id, quelleName: quelle.name };
    if (!ersterFehler) ersterFehler = ergebnis.grund;
  }
  return { ok: false, grund: ersterFehler || 'keine Daten gefunden' };
}

module.exports = { holeBuchdaten, BUCHDATEN_QUELLEN };
