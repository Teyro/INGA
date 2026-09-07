/**
 * Element/Matrix-Versand: reine Adressbildung ohne Netzwerk plus die
 * Netzwerk-Abläufe gegen ein gemocktes fetch() (kein echter Matrix-Server
 * in dieser Testumgebung nötig/erreichbar).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const matrix = require('../src/main/matrix.js');

test('localpartAusName/matrixIdAusName: Umlaute, Bindestriche, Leerzeichen', () => {
  assert.equal(matrix.localpartAusName('Anna', 'Muster'), 'anna.muster');
  assert.equal(matrix.localpartAusName('Jörg', 'Müller-Schmidt'), 'joerg.mueller-schmidt');
  assert.equal(matrix.localpartAusName('Anna Sophie', 'Groß'), 'anna-sophie.gross');
  assert.equal(matrix.localpartAusName('', 'Muster'), null, 'leerer Vorname -> keine Adresse');
  assert.equal(matrix.localpartAusName('Anna', ''), null, 'leerer Nachname -> keine Adresse');
  assert.equal(matrix.matrixIdAusName('Anna', 'Muster', 'soed.hamburg.de'), '@anna.muster:soed.hamburg.de');
  assert.equal(matrix.matrixIdAusName('Anna', 'Muster', ''), null, 'ohne Domain keine Adresse');
});

/** Kleiner fetch()-Mock: Handler bekommt (url, options), gibt {status, json} oder {status, text} zurück. */
function mitGemocktemFetch(handler, fn) {
  const original = global.fetch;
  global.fetch = async (url, options) => {
    const antwort = await handler(String(url), options || {});
    return {
      ok: antwort.status >= 200 && antwort.status < 300,
      status: antwort.status,
      text: async () => (antwort.json !== undefined ? JSON.stringify(antwort.json) : antwort.text || ''),
      json: async () => antwort.json,
    };
  };
  return fn().finally(() => {
    global.fetch = original;
  });
}

test('ermittleHomeserver: nutzt .well-known/matrix/client, fällt bei Fehler auf die Domain selbst zurück', async () => {
  await mitGemocktemFetch(
    async (url) => (url.includes('.well-known') ? { status: 200, json: { 'm.homeserver': { base_url: 'https://matrix.example.org/' } } } : { status: 404 }),
    async () => {
      const homeserver = await matrix.ermittleHomeserver('example.org');
      assert.equal(homeserver, 'https://matrix.example.org', 'nachgestellter Schrägstrich wird entfernt');
    }
  );

  await mitGemocktemFetch(
    async () => { throw new Error('Netzwerk down'); },
    async () => {
      const homeserver = await matrix.ermittleHomeserver('example.org');
      assert.equal(homeserver, 'https://example.org');
    }
  );
});

test('profilExistiert: 200 -> true, 404 -> false, andere Fehler werden weitergereicht statt verschluckt', async () => {
  await mitGemocktemFetch(
    async () => ({ status: 200, json: {} }),
    async () => assert.equal(await matrix.profilExistiert('https://hs', 'tok', '@a:hs'), true)
  );
  await mitGemocktemFetch(
    async () => ({ status: 404, json: { errcode: 'M_NOT_FOUND' } }),
    async () => assert.equal(await matrix.profilExistiert('https://hs', 'tok', '@a:hs'), false)
  );
  await mitGemocktemFetch(
    async () => ({ status: 500, json: { error: 'Serverfehler' } }),
    async () => assert.rejects(() => matrix.profilExistiert('https://hs', 'tok', '@a:hs'))
  );
});

test('sendeAnPerson: voller Ablauf – Profilprüfung, neuer Direktraum, Nachricht senden', async () => {
  const aufrufe = [];
  const einstellungen = {
    matrixAktiv: true,
    matrixDomain: 'soed.hamburg.de',
    matrixHomeserver: 'https://matrix.soed.hamburg.de', // Override, damit kein .well-known-Aufruf nötig ist
    matrixZugangstoken: 'geheimes-token',
    matrixVersenderId: '@bibliothek:soed.hamburg.de',
  };

  await mitGemocktemFetch(
    async (url, options) => {
      aufrufe.push({ url, method: options.method || 'GET' });
      if (url.includes('/profile/')) return { status: 200, json: {} };
      if (url.includes('/account_data/m.direct') && (options.method || 'GET') === 'GET') return { status: 404, json: { errcode: 'M_NOT_FOUND' } };
      if (url.includes('/createroom')) return { status: 200, json: { room_id: '!neuerRaum:soed.hamburg.de' } };
      if (url.includes('/account_data/m.direct') && options.method === 'PUT') return { status: 200, json: {} };
      if (url.includes('/send/m.room.message/')) return { status: 200, json: { event_id: '$abc' } };
      throw new Error(`unerwarteter Aufruf: ${url}`);
    },
    async () => {
      const result = await matrix.sendeAnPerson(einstellungen, { vorname: 'Anna', nachname: 'Muster', text: 'Bitte Buch zurückgeben.' });
      assert.equal(result.zielId, '@anna.muster:soed.hamburg.de');
    }
  );

  const sendeAufruf = aufrufe.find((a) => a.url.includes('/send/m.room.message/'));
  assert.ok(sendeAufruf, 'Nachricht muss tatsächlich gesendet werden');
  assert.ok(sendeAufruf.url.includes('!neuerRaum%3Asoed.hamburg.de') || sendeAufruf.url.includes('!neuerRaum:soed.hamburg.de'), 'Nachricht muss im neu angelegten Raum landen');
});

test('sendeAnPerson: bricht mit klarer Meldung ab, wenn kein Konto unter der gebildeten Adresse existiert', async () => {
  const einstellungen = {
    matrixAktiv: true,
    matrixDomain: 'soed.hamburg.de',
    matrixHomeserver: 'https://matrix.soed.hamburg.de',
    matrixZugangstoken: 'geheimes-token',
    matrixVersenderId: '@bibliothek:soed.hamburg.de',
  };
  await mitGemocktemFetch(
    async (url) => (url.includes('/profile/') ? { status: 404, json: { errcode: 'M_NOT_FOUND' } } : { status: 500 }),
    async () => {
      await assert.rejects(
        () => matrix.sendeAnPerson(einstellungen, { vorname: 'Kein', nachname: 'Konto', text: 'x' }),
        /Kein Element-Konto.*@kein\.konto:soed\.hamburg\.de.*gefunden/
      );
    }
  );
});

test('anmelden: übersetzt M_FORBIDDEN in eine verständliche deutsche Meldung', async () => {
  await mitGemocktemFetch(
    async () => ({ status: 403, json: { errcode: 'M_FORBIDDEN', error: 'Invalid password' } }),
    async () => {
      await assert.rejects(() => matrix.anmelden('https://hs', 'anna', 'falsch'), /Benutzername oder Passwort falsch/);
    }
  );
});

test('sendeAnPerson: verweigert den Versand, wenn Element in den Einstellungen nicht aktiv ist – ganz ohne Netzwerkzugriff', async () => {
  const original = global.fetch;
  global.fetch = () => { throw new Error('fetch hätte hier nicht aufgerufen werden dürfen'); };
  try {
    await assert.rejects(
      () => matrix.sendeAnPerson({ matrixAktiv: false }, { vorname: 'A', nachname: 'B', text: 'x' }),
      /nicht aktiviert/
    );
  } finally {
    global.fetch = original;
  }
});
