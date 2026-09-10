/**
 * Cover-Datenquellen (Abschnitt Buchcover-Import): mehrere freie Quellen
 * nacheinander (Open Library, Google Books), gegen ein gemocktes fetch()
 * (kein echtes Netzwerk in dieser Testumgebung nötig/erreichbar).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { coverFuerIsbnLaden, duckDuckGo, qwant, COVER_QUELLEN } = require('../src/main/cover-quellen.js');

/** Kleiner fetch()-Mock: Handler bekommt die URL, gibt {status, json?, text?, bytes?} zurück. */
function mitGemocktemFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = async (url) => {
    const antwort = await handler(String(url));
    return {
      ok: antwort.status >= 200 && antwort.status < 300,
      status: antwort.status,
      json: async () => antwort.json,
      text: async () => antwort.text ?? '',
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

test('COVER_QUELLEN: DuckDuckGo und Qwant stehen als Rückfallebene HINTER den beiden Buch-APIs', () => {
  const ids = COVER_QUELLEN.map((q) => q.id);
  assert.deepEqual(ids, ['openlibrary', 'google-books', 'duckduckgo', 'qwant']);
});

test('coverFuerIsbnLaden: weder Open Library noch Google Books kennen die ISBN -> DuckDuckGo-Bildersuche liefert ein Cover', async () => {
  await mitGemocktemFetch(
    (url) => {
      if (url.includes('covers.openlibrary.org') || url.includes('googleapis.com/books')) return { status: 404 };
      if (url.startsWith('https://duckduckgo.com/?q=')) return { status: 200, text: `<script>vqd="1234-5678"</script>` };
      if (url.startsWith('https://duckduckgo.com/i.js')) return { status: 200, json: { results: [{ image: 'https://bilder.example/cover.jpg' }] } };
      if (url === 'https://bilder.example/cover.jpg') return { status: 200, groesse: 4000 };
      return { status: 404 };
    },
    async () => {
      const ergebnis = await coverFuerIsbnLaden('9780000000001', { titel: 'Die kleine Hexe', autor: 'Otfried Preußler' });
      assert.equal(ergebnis.ok, true);
      assert.equal(ergebnis.quelle, 'duckduckgo');
      assert.equal(ergebnis.buf.byteLength, 4000);
    }
  );
});

test('coverFuerIsbnLaden: auch DuckDuckGo findet nichts -> Qwant-Bildersuche als letzte Quelle liefert ein Cover', async () => {
  await mitGemocktemFetch(
    (url) => {
      if (url.includes('covers.openlibrary.org') || url.includes('googleapis.com/books') || url.includes('duckduckgo.com')) return { status: 404 };
      if (url.startsWith('https://api.qwant.com/v3/search/images')) {
        return { status: 200, json: { data: { result: { items: [{ media: 'https://bilder.example/qwant.jpg' }] } } } };
      }
      if (url === 'https://bilder.example/qwant.jpg') return { status: 200, groesse: 6000 };
      return { status: 404 };
    },
    async () => {
      const ergebnis = await coverFuerIsbnLaden('9780000000002', { titel: 'Die kleine Hexe' });
      assert.equal(ergebnis.ok, true);
      assert.equal(ergebnis.quelle, 'qwant');
      assert.equal(ergebnis.buf.byteLength, 6000);
    }
  );
});

test('duckDuckGo(): kein "vqd"-Token auf der Trefferseite gefunden -> gilt als "nichts gefunden", kein Absturz', async () => {
  await mitGemocktemFetch(
    () => ({ status: 200, text: '<html>keine Bildertreffer</html>' }),
    async () => {
      const buf = await duckDuckGo('9780000000003', { titel: 'Unbekannter Titel' });
      assert.equal(buf, null);
    }
  );
});

test('qwant(): Suchbegriff nutzt Titel+Autor statt der ISBN, wenn beide bekannt sind', async () => {
  const angefragteUrls = [];
  await mitGemocktemFetch(
    (url) => { angefragteUrls.push(url); return { status: 404 }; },
    () => qwant('9780000000004', { titel: 'Die kleine Hexe', autor: 'Otfried Preußler' })
  );
  const query = decodeURIComponent(angefragteUrls[0]);
  assert.ok(query.includes('Die kleine Hexe Otfried Preußler'), `Suchbegriff sollte Titel+Autor enthalten: ${query}`);
  assert.ok(!query.includes('9780000000004'), 'die ISBN soll nur als Notlösung im Suchbegriff stehen, nicht zusätzlich zu Titel/Autor');
});

test('qwant(): ohne Titel/Autor dient die ISBN als Suchbegriff', async () => {
  const angefragteUrls = [];
  await mitGemocktemFetch(
    (url) => { angefragteUrls.push(url); return { status: 404 }; },
    () => qwant('9780000000005', {})
  );
  const query = decodeURIComponent(angefragteUrls[0]);
  assert.ok(query.includes('9780000000005'), `Suchbegriff sollte auf die ISBN zurückfallen: ${query}`);
});
