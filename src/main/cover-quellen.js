'use strict';

/**
 * Cover-Datenquellen für den ISBN-basierten Cover-Download. Mehrere freie
 * Quellen nacheinander, damit ein Titel, den die erste Quelle nicht kennt,
 * noch eine zweite Chance bekommt, bevor er als "kein Cover gefunden" gilt.
 *
 * Bewusst NICHT Thalia oder ein anderer Buchhändler: die haben keine
 * öffentliche Cover-API – ein Abgriff der Produktbilder wäre Scraping einer
 * fremden Website (Nutzungsbedingungen, bricht bei jeder Layoutänderung).
 * Hier ausschließlich offene, für genau diesen Zweck vorgesehene APIs ohne
 * Konto/Schlüssel: Open Library und Google Books.
 */

const TIMEOUT_MS = 12000;

async function holenMitTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Open Library liefert bei unbekannter ISBN gelegentlich ein winziges Platzhalterbild statt eines Fehlers – < 900 Byte gilt als "nicht gefunden". */
async function openLibrary(isbn) {
  const res = await holenMitTimeout(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength < 900 ? null : buf;
}

/** Google Books: erst die Trefferliste nach einer Cover-Adresse durchsuchen, dann das Bild selbst laden. */
async function googleBooks(isbn) {
  const suche = await holenMitTimeout(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`, { headers: { Accept: 'application/json' } });
  if (!suche.ok) return null;
  const json = await suche.json();
  const links = json?.items?.[0]?.volumeInfo?.imageLinks;
  const bildUrl = String(links?.thumbnail || links?.smallThumbnail || '').replace(/^http:/, 'https:');
  if (!bildUrl) return null;
  const bild = await holenMitTimeout(bildUrl);
  if (!bild.ok) return null;
  const buf = Buffer.from(await bild.arrayBuffer());
  return buf.byteLength < 200 ? null : buf;
}

const COVER_QUELLEN = [
  { id: 'openlibrary', name: 'Open Library', hole: openLibrary },
  { id: 'google-books', name: 'Google Books', hole: googleBooks },
];

/**
 * Probiert die Quellen der Reihe nach, bis eine ein Bild liefert. Wirft nie:
 * eine einzelne fehlgeschlagene/nicht erreichbare Quelle überspringt einfach
 * zur nächsten, statt den ganzen Download abzubrechen. `quellen` ist
 * injizierbar (Tests, oder um eine Quelle gezielt abzuschalten).
 */
async function coverFuerIsbnLaden(isbnRoh, quellen = COVER_QUELLEN) {
  const isbn = String(isbnRoh ?? '').replace(/[^0-9Xx]/g, '');
  if (!isbn) return { ok: false, grund: 'keine ISBN/EAN hinterlegt' };
  for (const quelle of quellen) {
    try {
      const buf = await quelle.hole(isbn);
      if (buf) return { ok: true, buf, quelle: quelle.id, quelleName: quelle.name };
    } catch {
      // diese Quelle hat nicht geklappt (Zeitüberschreitung, Netzwerkfehler, kaputtes JSON, …) – nächste versuchen
    }
  }
  return { ok: false, grund: `bei keiner der Quellen (${quellen.map((q) => q.name).join(', ')}) gefunden` };
}

module.exports = { COVER_QUELLEN, coverFuerIsbnLaden, openLibrary, googleBooks };
