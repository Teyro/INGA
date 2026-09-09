/**
 * Cover-Datenquellen (Abschnitt Buchcover-Import): mehrere freie Quellen
 * nacheinander (Open Library, Google Books), gegen ein gemocktes fetch()
 * (kein echtes Netzwerk in dieser Testumgebung nötig/erreichbar).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { coverFuerIsbnLaden } = require('../src/main/cover-quellen.js');

/** Kleiner fetch()-Mock: Handler bekommt die URL, gibt {status, json?, bytes?} zurück. */
function mitGemocktemFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const antwort = await handler(String(url));
    return {
      ok: antwort.status >= 200 && antwort.status < 300,
      status: antwort.status,
      json: async () => antwort.json,
      arrayBuffer: async () => antwort.bytes?.buffer ?? new ArrayBuffer(antwort.groesse ?? 0),
    };
  };
  return fn().finally(() => {
    global.fetch = original;
  });
}

test('coverFuerIsbnLaden: ohne ISBN/EAN kein Netzwerkaufruf, klare Fehlermeldung', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('fetch hätte hier nicht aufgerufen werden dürfen'); };
  try {
    const ergebnis = await coverFuerIsbnLaden('');
    assert.equal(ergebnis.ok, false);
    assert.match(ergebnis.grund, /keine ISBN/);
  } finally {
    global.fetch = original;
  }
});

test('coverFuerIsbnLaden: findet Open Library, wenn dort ein echtes Cover liegt', async () => {
  await mitGemocktemFetch(
    (url) => (url.includes('covers.openlibrary.org') ? { status: 200, groesse: 5000 } : { status: 404 }),
    async () => {
      const ergebnis = await coverFuerIsbnLaden('978-3-551-55678-1');
      assert.equal(ergebnis.ok, true);
      assert.equal(ergebnis.quelle, 'openlibrary');
      assert.equal(ergebnis.buf.byteLength, 5000);
    }
  );
});

test('coverFuerIsbnLaden: Open Library liefert nur ein winziges Platzhalterbild -> weiter zu Google Books', async () => {
  await mitGemocktemFetch(
    (url) => {
      if (url.includes('covers.openlibrary.org')) return { status: 200, groesse: 43 }; // Platzhalter, kein echtes Cover
      if (url.includes('googleapis.com/books')) {
        return { status: 200, json: { items: [{ volumeInfo: { imageLinks: { thumbnail: 'http://books.google.com/books/content?id=xyz&zoom=1' } } }] } };
      }
      if (url.startsWith('https://books.google.com')) return { status: 200, groesse: 8000 };
      return { status: 404 };
    },
    async () => {
      const ergebnis = await coverFuerIsbnLaden('9783551556781');
      assert.equal(ergebnis.ok, true);
      assert.equal(ergebnis.quelle, 'google-books');
      assert.equal(ergebnis.buf.byteLength, 8000);
    }
  );
});

test('coverFuerIsbnLaden: keine der Quellen findet etwas -> ok:false mit verständlicher Meldung', async () => {
  await mitGemocktemFetch(
    () => ({ status: 404 }),
    async () => {
      const ergebnis = await coverFuerIsbnLaden('9780000000000');
      assert.equal(ergebnis.ok, false);
      assert.match(ergebnis.grund, /Open Library.*Google Books|Google Books.*Open Library/);
    }
  );
});

test('coverFuerIsbnLaden: eine abstürzende Quelle (Netzwerkfehler) blockiert nicht die nächste', async () => {
  await mitGemocktemFetch(
    (url) => {
      if (url.includes('covers.openlibrary.org')) throw new Error('ECONNRESET');
      if (url.includes('googleapis.com/books')) {
        return { status: 200, json: { items: [{ volumeInfo: { imageLinks: { smallThumbnail: 'http://books.google.com/x.jpg' } } }] } };
      }
      return { status: 200, groesse: 3000 };
    },
    async () => {
      const ergebnis = await coverFuerIsbnLaden('9783551556781');
      assert.equal(ergebnis.ok, true);
      assert.equal(ergebnis.quelle, 'google-books');
    }
  );
});

test('coverFuerIsbnLaden: ISBN wird von Trennzeichen befreit, bevor sie in die Quellen-URLs eingesetzt wird', async () => {
  const angefragteUrls = [];
  await mitGemocktemFetch(
    (url) => { angefragteUrls.push(url); return { status: 200, groesse: 5000 }; },
    () => coverFuerIsbnLaden('978-3-551-55678-1')
  );
  assert.ok(angefragteUrls[0].includes('9783551556781'), `URL sollte die bereinigte ISBN enthalten: ${angefragteUrls[0]}`);
});
