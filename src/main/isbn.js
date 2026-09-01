'use strict';

/**
 * Buchdaten per ISBN nachschlagen – offene Quelle (Open Library, kein
 * Konto/API-Key nötig), analog zum bereits vorhandenen Cover-Download in
 * main.js. Liefert nur Rohdaten zurück; die Oberfläche übernimmt sie NICHT
 * automatisch in den Katalog, sondern trägt sie lediglich in das gerade
 * offene Formular ein – gespeichert wird erst durch einen bewussten Klick
 * auf "Speichern" (manuelle Bestätigung).
 */

const TIMEOUT_MS = 12000;

function ersterJahrgang(text) {
  return String(text || '').match(/\d{4}/)?.[0] || '';
}

/** `isbnRoh` kann Bindestriche/Leerzeichen enthalten (aus einem Barcode-Scan oder von Hand getippt). */
async function holeBuchdaten(isbnRoh) {
  const isbn = String(isbnRoh || '').replace(/[^0-9Xx]/g, '');
  if (!isbn) return { ok: false, grund: 'keine ISBN angegeben' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
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
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { holeBuchdaten };
