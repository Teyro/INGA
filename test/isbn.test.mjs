/**
 * ISBN-Nachschlagen (Abschnitt 6) – testet die Auswertung der Open-Library-
 * Antwort ohne echten Netzwerkzugriff (globaler fetch wird für die Dauer
 * jedes Tests durch eine Fake-Antwort ersetzt und danach zurückgesetzt).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { holeBuchdaten } = require('../src/main/isbn.js');

function mitFakeFetch(antwortFn, aufgabe) {
  const original = global.fetch;
  global.fetch = antwortFn;
  return aufgabe().finally(() => {
    global.fetch = original;
  });
}

test('holeBuchdaten: liest Titel/Autor/Verlag/Jahr aus einer gültigen Open-Library-Antwort', async () => {
  await mitFakeFetch(
    async () => ({
      ok: true,
      json: async () => ({
        'ISBN:9783125121037': {
          title: 'Beispielbuch',
          subtitle: 'Ein Untertitel',
          authors: [{ name: 'Anna Autorin' }, { name: 'Bert Beispiel' }],
          publishers: [{ name: 'Testverlag' }],
          publish_date: '15. März 2020',
        },
      }),
    }),
    async () => {
      const result = await holeBuchdaten('978-3-12-512103-7');
      assert.equal(result.ok, true);
      assert.equal(result.daten.Titel, 'Beispielbuch');
      assert.equal(result.daten.UntTitel, 'Ein Untertitel');
      assert.equal(result.daten.Autor, 'Anna Autorin; Bert Beispiel');
      assert.equal(result.daten.Verlag, 'Testverlag');
      assert.equal(result.daten.ErschJahr, '2020');
    }
  );
});

test('holeBuchdaten: keine ISBN angegeben liefert sofort ok:false, ohne fetch aufzurufen', async () => {
  let aufgerufen = false;
  await mitFakeFetch(
    async () => {
      aufgerufen = true;
      throw new Error('sollte nicht aufgerufen werden');
    },
    async () => {
      const result = await holeBuchdaten('');
      assert.equal(result.ok, false);
      assert.equal(aufgerufen, false);
    }
  );
});

test('holeBuchdaten: keine Daten zu dieser ISBN gefunden', async () => {
  await mitFakeFetch(
    async () => ({ ok: true, json: async () => ({}) }),
    async () => {
      const result = await holeBuchdaten('0000000000');
      assert.equal(result.ok, false);
      assert.match(result.grund, /keine Daten/);
    }
  );
});

test('holeBuchdaten: HTTP-Fehler wird sauber gemeldet statt zu werfen', async () => {
  await mitFakeFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      const result = await holeBuchdaten('9783125121037');
      assert.equal(result.ok, false);
      assert.match(result.grund, /500/);
    }
  );
});

test('holeBuchdaten: Open Library kennt die ISBN nicht -> Google Books als zweite Quelle liefert die Daten', async () => {
  await mitFakeFetch(
    async (url) => {
      if (String(url).includes('openlibrary.org')) return { ok: true, json: async () => ({}) }; // nichts gefunden
      if (String(url).includes('googleapis.com/books')) {
        return {
          ok: true,
          json: async () => ({
            items: [
              {
                volumeInfo: {
                  title: 'Beispielbuch',
                  subtitle: 'Ein Untertitel',
                  authors: ['Anna Autorin', 'Bert Beispiel'],
                  publisher: 'Testverlag',
                  publishedDate: '2020-03-15',
                },
              },
            ],
          }),
        };
      }
      throw new Error(`unerwartete URL im Test: ${url}`);
    },
    async () => {
      const result = await holeBuchdaten('9783125121037');
      assert.equal(result.ok, true);
      assert.equal(result.quelle, 'google-books');
      assert.equal(result.daten.Titel, 'Beispielbuch');
      assert.equal(result.daten.Autor, 'Anna Autorin; Bert Beispiel');
      assert.equal(result.daten.Verlag, 'Testverlag');
      assert.equal(result.daten.ErschJahr, '2020');
    }
  );
});

test('holeBuchdaten: weder Open Library noch Google Books kennen die ISBN -> die Meldung der ERSTEN Quelle wird gemeldet', async () => {
  await mitFakeFetch(
    async (url) => {
      if (String(url).includes('openlibrary.org')) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({}) };
    },
    async () => {
      const result = await holeBuchdaten('9780000000000');
      assert.equal(result.ok, false);
      assert.match(result.grund, /404/);
    }
  );
});

test('holeBuchdaten: Netzwerkfehler (z. B. kein Internet) führt nicht zu einem Absturz', async () => {
  await mitFakeFetch(
    async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    },
    async () => {
      const result = await holeBuchdaten('9783125121037');
      assert.equal(result.ok, false);
      assert.match(result.grund, /ENOTFOUND/);
    }
  );
});
