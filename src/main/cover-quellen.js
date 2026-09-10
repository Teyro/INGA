'use strict';

/**
 * Cover-Datenquellen für den ISBN-basierten Cover-Download. Mehrere freie
 * Quellen nacheinander, damit ein Titel, den die erste Quelle nicht kennt,
 * noch eine zweite Chance bekommt, bevor er als "kein Cover gefunden" gilt.
 *
 * Erste Wahl sind Open Library und Google Books: offene, extra für genau
 * diesen Zweck vorgesehene Cover-APIs ohne Konto/Schlüssel, angesprochen
 * über die ISBN. Als Rückfallebene danach die allgemeine Bildersuche von
 * DuckDuckGo und Qwant (per Titel/Autor, ersatzweise ISBN) – für Titel, die
 * in keiner der beiden Buch-APIs stehen (kleine/regionale Verlage,
 * Lehr-/Arbeitshefte, ältere Ausgaben). Beide sind KEIN dokumentiertes,
 * stabiles Interface, sondern dieselben Anfragen, die auch ihre eigene
 * Weboberfläche stellt – kann sich jederzeit ändern oder geblockt werden,
 * deshalb bewusst ganz hinten in der Kette und mit derselben
 * Fehlertoleranz wie jede andere Quelle (schlägt einer der beiden Schritte
 * fehl, gilt die Quelle einfach als "nichts gefunden", nicht als Absturz).
 *
 * Bewusst NICHT Thalia oder ein anderer Buchhändler: die haben keine
 * öffentliche Cover-API – ein Abgriff der Produktbilder wäre Scraping einer
 * fremden Website (Nutzungsbedingungen, bricht bei jeder Layoutänderung).
 */

const TIMEOUT_MS = 12000;
const BILDSUCHE_KOPF = { 'User-Agent': 'Mozilla/5.0 (compatible; INGA-Buecherei/1.0; +https://github.com/Teyro/INGA)' };

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

/** Suchbegriff für die allgemeine Bildersuche: Titel+Autor, wenn bekannt (deutlich treffsicherer), sonst die ISBN als Notlösung. */
function bildsucheBegriff(isbn, { titel = '', autor = '' } = {}) {
  const titelAutor = [titel, autor].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
  return `${titelAutor || isbn} Buchcover`;
}

/** Ein per Bildersuche gefundenes Bild laden und grob auf Plausibilität prüfen (kein leerer/winziger Platzhalter). */
async function bildLaden(url) {
  if (!url) return null;
  const res = await holenMitTimeout(url, { headers: BILDSUCHE_KOPF });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.byteLength < 900 ? null : buf;
}

/**
 * DuckDuckGo-Bildersuche: die Trefferseite trägt ein Sitzungstoken ("vqd") im
 * HTML, das anschließend beim eigentlichen JSON-Endpunkt (i.js) mitgeschickt
 * werden muss – kein API-Schlüssel, aber auch kein dokumentiertes Interface.
 */
async function duckDuckGo(isbn, kontext) {
  const begriff = bildsucheBegriff(isbn, kontext);
  const seite = await holenMitTimeout(`https://duckduckgo.com/?q=${encodeURIComponent(begriff)}&iax=images&ia=images`, { headers: BILDSUCHE_KOPF });
  if (!seite.ok) return null;
  const html = await seite.text();
  const vqd = html.match(/vqd=['"]([^'"]+)['"]/)?.[1];
  if (!vqd) return null;
  const treffer = await holenMitTimeout(
    `https://duckduckgo.com/i.js?o=json&q=${encodeURIComponent(begriff)}&vqd=${encodeURIComponent(vqd)}`,
    { headers: { ...BILDSUCHE_KOPF, Referer: 'https://duckduckgo.com/' } }
  );
  if (!treffer.ok) return null;
  const json = await treffer.json();
  return bildLaden(json?.results?.[0]?.image);
}

/**
 * Qwant-Bildersuche: derselbe Endpunkt, den auch qwant.com/images selbst
 * aufruft – ebenfalls kein dokumentiertes/stabiles Interface.
 */
async function qwant(isbn, kontext) {
  const begriff = bildsucheBegriff(isbn, kontext);
  const res = await holenMitTimeout(
    `https://api.qwant.com/v3/search/images?q=${encodeURIComponent(begriff)}&count=5&locale=de_de&offset=0&device=desktop&safesearch=1`,
    { headers: BILDSUCHE_KOPF }
  );
  if (!res.ok) return null;
  const json = await res.json();
  return bildLaden(json?.data?.result?.items?.[0]?.media);
}

const COVER_QUELLEN = [
  { id: 'openlibrary', name: 'Open Library', hole: openLibrary },
  { id: 'google-books', name: 'Google Books', hole: googleBooks },
  { id: 'duckduckgo', name: 'DuckDuckGo-Bildersuche', hole: duckDuckGo },
  { id: 'qwant', name: 'Qwant-Bildersuche', hole: qwant },
];

/**
 * Probiert die Quellen der Reihe nach, bis eine ein Bild liefert. Wirft nie:
 * eine einzelne fehlgeschlagene/nicht erreichbare Quelle überspringt einfach
 * zur nächsten, statt den ganzen Download abzubrechen. `titel`/`autor`
 * verbessern nur die beiden Bildersuche-Quellen (Open Library/Google Books
 * suchen ausschließlich über die ISBN); `quellen` ist injizierbar (Tests,
 * oder um eine Quelle gezielt abzuschalten).
 */
async function coverFuerIsbnLaden(isbnRoh, { titel = '', autor = '', quellen = COVER_QUELLEN } = {}) {
  const isbn = String(isbnRoh ?? '').replace(/[^0-9Xx]/g, '');
  if (!isbn) return { ok: false, grund: 'keine ISBN/EAN hinterlegt' };
  for (const quelle of quellen) {
    try {
      const buf = await quelle.hole(isbn, { titel, autor });
      if (buf) return { ok: true, buf, quelle: quelle.id, quelleName: quelle.name };
    } catch {
      // diese Quelle hat nicht geklappt (Zeitüberschreitung, Netzwerkfehler, kaputtes JSON, …) – nächste versuchen
    }
  }
  return { ok: false, grund: `bei keiner der Quellen (${quellen.map((q) => q.name).join(', ')}) gefunden` };
}

module.exports = { COVER_QUELLEN, coverFuerIsbnLaden, openLibrary, googleBooks, duckDuckGo, qwant };
