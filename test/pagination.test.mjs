/**
 * Pagination-Bugfix (Abschnitt 5 des Ausbau-Auftrags): searchKatalog()/
 * searchLeser() hatten ein festes, unveränderliches `LIMIT 300` ohne jede
 * Seitennavigation – ab dem 301. Treffer war ein Titel/Nutzer schlicht nicht
 * mehr auffindbar. Jetzt: echte Seitennavigation, korrekte Gesamtzahl auch
 * bei aktivem Filter (der komplett in SQL läuft, nicht mehr per
 * Array.filter() NACH dem LIMIT).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { openDatabase } = require('../src/main/db.js');
const repo = require('../src/main/repo.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-pagination-test-'));
}

function befuelleKatalog(db, anzahl) {
  for (let i = 1; i <= anzahl; i++) {
    const nr = String(i).padStart(3, '0');
    repo.saveKatalog(db, { Titel: `Buch ${nr}` });
  }
}

test('searchKatalog: Regressionstest – über 300 Titel bleiben alle auffindbar (vormals hartes LIMIT 300 ohne Seitennavigation)', () => {
  const db = openDatabase(tmpDir());
  befuelleKatalog(db, 350);

  const seite1 = repo.searchKatalog(db, {}, { seite: 1, proSeite: 250 });
  assert.equal(seite1.gesamt, 350);
  assert.equal(seite1.rows.length, 250);
  assert.equal(seite1.rows[0].Titel, 'Buch 001');

  const seite2 = repo.searchKatalog(db, {}, { seite: 2, proSeite: 250 });
  assert.equal(seite2.gesamt, 350);
  assert.equal(seite2.rows.length, 100); // Rest der 350
  // Buch 251 wäre mit dem alten LIMIT 300 gerade noch, "Buch 320" nie
  // auffindbar gewesen – jetzt ist es auf Seite 2 vorhanden.
  assert.ok(seite2.rows.some((r) => r.Titel === 'Buch 320'), '"Buch 320" muss über die Seitennavigation auffindbar sein');

  const alle = repo.searchKatalog(db, {}, { proSeite: 'alle' });
  assert.equal(alle.rows.length, 350);
  assert.equal(alle.proSeite, 'alle');
  db.close();
});

test('searchKatalog: Standard-Seitengröße ist 50, wenn nichts angegeben wird', () => {
  const db = openDatabase(tmpDir());
  befuelleKatalog(db, 60);
  const { rows, gesamt, seite, proSeite } = repo.searchKatalog(db, {});
  assert.equal(gesamt, 60);
  assert.equal(rows.length, 50);
  assert.equal(seite, 1);
  assert.equal(proSeite, 50);
  db.close();
});

test('searchKatalog: Verfügbarkeitsfilter läuft in SQL – Gesamtzahl UND Seiteninhalt berücksichtigen ihn korrekt', () => {
  const db = openDatabase(tmpDir());
  const verliehenerTitel = repo.saveKatalog(db, { Titel: 'Verliehen' });
  const medienNi = repo.saveMedium(db, { KatalogNi: verliehenerTitel, MedienEtik: 'P-0001' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tina', AusweisId: 'P-L-1' });
  repo.ausleihen(db, { medienNi, leserNi, einstellungen: { leihfristTage: 7, verlaengerungDauerTage: 7 } });
  const verfuegbarerTitel = repo.saveKatalog(db, { Titel: 'Verfügbar' });
  repo.saveMedium(db, { KatalogNi: verfuegbarerTitel, MedienEtik: 'P-0002' });

  const nurVerfuegbar = repo.searchKatalog(db, { verfuegbarkeit: 'verfuegbar' });
  assert.equal(nurVerfuegbar.gesamt, 1);
  assert.equal(nurVerfuegbar.rows[0].Titel, 'Verfügbar');

  const nurVerliehen = repo.searchKatalog(db, { verfuegbarkeit: 'verliehen' });
  assert.equal(nurVerliehen.gesamt, 1);
  assert.equal(nurVerliehen.rows[0].Titel, 'Verliehen');
  db.close();
});

test('searchLeser: Regressionstest – über 300 Nutzer bleiben alle auffindbar', () => {
  const db = openDatabase(tmpDir());
  for (let i = 1; i <= 320; i++) {
    repo.saveLeser(db, { Nachname: `Nachname${String(i).padStart(3, '0')}`, Vorname: 'Kind', AusweisId: `L-${i}` });
  }
  const seite1 = repo.searchLeser(db, {}, { seite: 1, proSeite: 250 });
  assert.equal(seite1.gesamt, 320);
  const seite2 = repo.searchLeser(db, {}, { seite: 2, proSeite: 250 });
  assert.equal(seite2.rows.length, 70);
  db.close();
});

test('searchLeser: gesperrt/aktiv laufen in SQL statt per Zeile im Speicher – Gesamtzahl stimmt', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Sperrung" ("SperrungNi","SperrungBz") VALUES (1, 'Mahngebühren offen')`).run();
  repo.saveLeser(db, { Nachname: 'Gesperrt', Vorname: 'Kind', AusweisId: 'G-1', SperrungNi: 1 });
  repo.saveLeser(db, { Nachname: 'Frei', Vorname: 'Kind', AusweisId: 'G-2' });

  const gesperrt = repo.searchLeser(db, { gesperrt: 'gesperrt' });
  assert.equal(gesperrt.gesamt, 1);
  assert.equal(gesperrt.rows[0].Nachname, 'Gesperrt');

  const aktiv = repo.searchLeser(db, { gesperrt: 'aktiv' });
  assert.equal(aktiv.gesamt, 1);
  assert.equal(aktiv.rows[0].Nachname, 'Frei');
  db.close();
});

test('searchLeser: leere leserNiIn-Liste liefert "keine Treffer" statt den Filter zu ignorieren', () => {
  const db = openDatabase(tmpDir());
  repo.saveLeser(db, { Nachname: 'Jemand', Vorname: 'Kind', AusweisId: 'X-1' });
  const ergebnis = repo.searchLeser(db, { leserNiIn: [] });
  assert.equal(ergebnis.gesamt, 0);
  assert.equal(ergebnis.rows.length, 0);
  db.close();
});

test('searchLeser: leserNiIn schränkt korrekt auf die angegebenen LeserNi ein (Grundlage für den "Rückstand"-Filter)', () => {
  const db = openDatabase(tmpDir());
  const a = repo.saveLeser(db, { Nachname: 'A', Vorname: 'Kind', AusweisId: 'R-1' });
  repo.saveLeser(db, { Nachname: 'B', Vorname: 'Kind', AusweisId: 'R-2' });
  const ergebnis = repo.searchLeser(db, { leserNiIn: [a] });
  assert.equal(ergebnis.gesamt, 1);
  assert.equal(ergebnis.rows[0].Nachname, 'A');
  db.close();
});
