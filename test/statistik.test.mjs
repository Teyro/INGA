/**
 * Statistik (Abschnitt 6): Ausleihen pro Monat/Klasse/Kategorie,
 * Ladenhüter, Verlustliste.
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
const { heuteISO } = require('../src/main/date-utils.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-statistik-test-'));
}

function ausleiheEintragen(db, { medienNi, leserNi, auslDatum }) {
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl") VALUES (?,?,?,NULL,0)`).run(
    medienNi,
    leserNi,
    `${auslDatum} 00:00:00.000`
  );
}

test('statistikAusleihenProMonat: liefert die letzten N Monate inkl. Monate ohne Ausleihe (0), laufender Monat zuletzt', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'S-1' });
  const leserNi = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'S-L1' });
  ausleiheEintragen(db, { medienNi, leserNi, auslDatum: heuteISO() });
  ausleiheEintragen(db, { medienNi, leserNi, auslDatum: heuteISO() });

  const ergebnis = repo.statistikAusleihenProMonat(db, 3);
  assert.equal(ergebnis.length, 3);
  assert.equal(ergebnis[2].monat, heuteISO().slice(0, 7), 'letzter Eintrag muss der laufende Monat sein');
  assert.equal(ergebnis[2].anzahl, 2);
  db.close();
});

test('statistikAusleihenProKlasse: gruppiert nach Jahrgang, ohne Klasse landet in eigener Gruppe', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi1 = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'S-2a' });
  const medienNi2 = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'S-2b' });
  const leser4a = repo.saveLeser(db, { Nachname: 'A', Vorname: 'K', AusweisId: 'S-L2', Jahrgang: '4a' });
  const leserOhne = repo.saveLeser(db, { Nachname: 'B', Vorname: 'K', AusweisId: 'S-L3' });
  ausleiheEintragen(db, { medienNi: medienNi1, leserNi: leser4a, auslDatum: heuteISO() });
  ausleiheEintragen(db, { medienNi: medienNi2, leserNi: leserOhne, auslDatum: heuteISO() });

  const ergebnis = repo.statistikAusleihenProKlasse(db);
  const klassen = Object.fromEntries(ergebnis.map((r) => [r.klasse, r.anzahl]));
  assert.equal(klassen['4a'], 1);
  assert.equal(klassen['(ohne Klasse)'], 1);
  db.close();
});

test('statistikAusleihenProKategorie: gruppiert nach Systematik, ohne Kategorie landet in eigener Gruppe', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Systematik" ("SystemId","SystemBz") VALUES ('SACH','Sachbuch')`).run();
  const k1 = repo.saveKatalog(db, { Titel: 'Sachbuch', SystemId: 'SACH' });
  const m1 = repo.saveMedium(db, { KatalogNi: k1, MedienEtik: 'S-3a' });
  const k2 = repo.saveKatalog(db, { Titel: 'Roman' });
  const m2 = repo.saveMedium(db, { KatalogNi: k2, MedienEtik: 'S-3b' });
  const leser = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'S-L4' });
  ausleiheEintragen(db, { medienNi: m1, leserNi: leser, auslDatum: heuteISO() });
  ausleiheEintragen(db, { medienNi: m2, leserNi: leser, auslDatum: heuteISO() });

  const ergebnis = repo.statistikAusleihenProKategorie(db);
  const kategorien = Object.fromEntries(ergebnis.map((r) => [r.kategorie, r.anzahl]));
  assert.equal(kategorien['Sachbuch'], 1);
  assert.equal(kategorien['(ohne Kategorie)'], 1);
  db.close();
});

test('ladenhueter: findet nie ausgeliehene UND lange nicht ausgeliehene Titel, nicht aber kürzlich ausgeliehene', () => {
  const db = openDatabase(tmpDir());
  const nieAusgeliehen = repo.saveKatalog(db, { Titel: 'Nie ausgeliehen' });
  repo.saveMedium(db, { KatalogNi: nieAusgeliehen, MedienEtik: 'S-5a' });

  const langeHer = repo.saveKatalog(db, { Titel: 'Lange her' });
  const mLangeHer = repo.saveMedium(db, { KatalogNi: langeHer, MedienEtik: 'S-5b' });
  const leser = repo.saveLeser(db, { Nachname: 'X', Vorname: 'Y', AusweisId: 'S-L5' });
  ausleiheEintragen(db, { medienNi: mLangeHer, leserNi: leser, auslDatum: '2020-01-01' });

  const kuerzlich = repo.saveKatalog(db, { Titel: 'Kürzlich' });
  const mKuerzlich = repo.saveMedium(db, { KatalogNi: kuerzlich, MedienEtik: 'S-5c' });
  ausleiheEintragen(db, { medienNi: mKuerzlich, leserNi: leser, auslDatum: heuteISO() });

  const ergebnis = repo.ladenhueter(db, 365);
  const titel = ergebnis.map((r) => r.Titel);
  assert.ok(titel.includes('Nie ausgeliehen'));
  assert.ok(titel.includes('Lange her'));
  assert.ok(!titel.includes('Kürzlich'));
  db.close();
});

test('verlustliste: nur Exemplare mit gesetztem NichtVfNi, mit lesbarem Grund', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Nichtverf" ("NichtVfNi","NichtVfBz") VALUES (1,'Vermisst')`).run();
  const k1 = repo.saveKatalog(db, { Titel: 'Vermisstes Buch' });
  repo.saveMedium(db, { KatalogNi: k1, MedienEtik: 'S-6a', NichtVfNi: 1 });
  const k2 = repo.saveKatalog(db, { Titel: 'Normales Buch' });
  repo.saveMedium(db, { KatalogNi: k2, MedienEtik: 'S-6b' });

  const ergebnis = repo.verlustliste(db);
  assert.equal(ergebnis.length, 1);
  assert.equal(ergebnis[0].Titel, 'Vermisstes Buch');
  assert.equal(ergebnis[0].grund, 'Vermisst');
  db.close();
});
