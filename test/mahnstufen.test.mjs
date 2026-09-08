/**
 * Mahnstufen-Auswahl (ueberfaelligeMitStufe) – Regressionstest für einen
 * echten Bug: die Stufe wurde bislang in Array-Reihenfolge ermittelt, nicht
 * nach der Tage-Schwelle sortiert. "Mahnstufe hinzufügen" in der Oberfläche
 * hängt eine neue Stufe aber immer ans ENDE des Arrays an – jede Schule, die
 * eine weitere Stufe zwischen zwei bestehenden ergänzt (üblicher Fall: erst
 * 7/21/42 Tage, dann noch eine bei 14 Tagen dazwischen), bekäme dadurch bei
 * älteren Ausleihen die falsche, meist zu milde Stufe samt falschem
 * Brieftext und falscher Gebühr.
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
const { DEFAULT_SETTINGS } = require('../src/main/store.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-mahnstufen-test-'));
}

function leihe(db, { tageAlt, etikett }) {
  const katalogNi = repo.saveKatalog(db, { Titel: `Buch ${etikett}` });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: etikett });
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: etikett, AusweisId: `L-${etikett}` });
  const auslDatum = new Date(Date.now() - tageAlt * 86400000).toISOString().slice(0, 10);
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl") VALUES (?,?,?,NULL,0)`).run(
    medienNi,
    leserNi,
    `${auslDatum} 00:00:00.000`
  );
}

test('ueberfaelligeMitStufe: wählt die höchste erreichte Schwelle unabhängig von der Reihenfolge im mahnstufen-Array', () => {
  const db = openDatabase(tmpDir());
  // Absichtlich NICHT aufsteigend sortiert – genau der Zustand, den "Stufe
  // hinzufügen" (hängt immer ans Ende an) in der echten Oberfläche erzeugt.
  const einstellungen = {
    ...DEFAULT_SETTINGS,
    leihfristTage: 0, // sofort "ausgeliehen" = sofort fällig, damit tageAlt direkt tageUeberfaellig entspricht
    mahnstufen: [
      { tageUeberfaellig: 42, text: 'Letzte Mahnung', gebuehr: 0 },
      { tageUeberfaellig: 7, text: '1. Mahnung', gebuehr: 0 },
      { tageUeberfaellig: 21, text: '2. Mahnung', gebuehr: 0 },
    ],
  };
  leihe(db, { tageAlt: 45, etikett: 'A' }); // muss "Letzte Mahnung" (Index 0) bekommen, nicht "1. Mahnung"
  leihe(db, { tageAlt: 10, etikett: 'B' }); // muss "1. Mahnung" (Index 1) bekommen

  const ergebnis = repo.ueberfaelligeMitStufe(db, einstellungen);
  const treffer = Object.fromEntries(ergebnis.map((r) => [r.MedienEtik, r]));

  assert.equal(treffer.A.stufe.text, 'Letzte Mahnung', 'ein 45 Tage überfälliges Buch darf nicht in "1. Mahnung" landen');
  assert.equal(treffer.A.stufeIndex, 0);
  assert.equal(treffer.B.stufe.text, '1. Mahnung');
  assert.equal(treffer.B.stufeIndex, 1);
  db.close();
});

/* --------------------------------------------- Rückstandsliste (Abschnitt 5.2) */

const ZWEI_STUFEN = {
  ...DEFAULT_SETTINGS,
  leihfristTage: 0,
  mahnstufen: [
    { tageUeberfaellig: 14, gebuehr: 0, text: 'Erinnerung', briefText: '{Vorname}' },
    { tageUeberfaellig: 28, gebuehr: 0, text: 'Mahnung', briefText: '{Vorname} {Nachname}' },
  ],
};

test('rueckstandsliste: zeigt Fälle ab der eingestellten Schwelle, unabhängig von den Mahnstufen-Schwellen', () => {
  const db = openDatabase(tmpDir());
  leihe(db, { tageAlt: 5, etikett: 'A' }); // unter jeder Schwelle
  leihe(db, { tageAlt: 20, etikett: 'B' }); // über Schwelle 10, aber unter Stufe 1 (14) nur knapp drüber
  leihe(db, { tageAlt: 30, etikett: 'C' }); // erreicht Stufe 2

  const abZehn = repo.rueckstandsliste(db, ZWEI_STUFEN, 10);
  assert.equal(abZehn.length, 2); // B und C, nicht A

  const abFuenfzehn = repo.rueckstandsliste(db, ZWEI_STUFEN, 15);
  const treffer = Object.fromEntries(abFuenfzehn.map((r) => [r.MedienEtik, r]));
  assert.equal(treffer.B.stufeIndex, 0); // 20 Tage: Erinnerung erreicht, Mahnung noch nicht
  assert.equal(treffer.C.stufeIndex, 1); // 30 Tage: Mahnung erreicht
  db.close();
});

test('mahnungEintragen + letzteMahnungFuer: protokolliert die verschickte Stufe je Fall und findet sie wieder', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'M-1' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Test', Vorname: 'Tom', AusweisId: 'L-1' });
  const auslDatum = '2026-01-01 00:00:00.000';
  db.prepare(`INSERT INTO "Ausleihe" ("MedienNi","LeserNi","AuslDatum","Rueckgabe","AnzVerl") VALUES (?,?,?,NULL,0)`).run(medienNi, leserNi, auslDatum);

  assert.equal(repo.letzteMahnungFuer(db, medienNi, leserNi, auslDatum), null);

  repo.mahnungEintragen(db, { medienNi, leserNi, auslDatum, gebuehr: 0, stufe: 1 });
  const nachErinnerung = repo.letzteMahnungFuer(db, medienNi, leserNi, auslDatum);
  assert.equal(nachErinnerung.stufeIndex, 0);

  repo.mahnungEintragen(db, { medienNi, leserNi, auslDatum, gebuehr: 1.5, stufe: 2 });
  const nachMahnung = repo.letzteMahnungFuer(db, medienNi, leserNi, auslDatum);
  assert.equal(nachMahnung.stufeIndex, 1); // die zuletzt verschickte, nicht die erste
  db.close();
});

test('letzteMahnungFuer: ein Alt-Datensatz ohne IngaStufe wird auf Stufe 2 (Mahnung) abgebildet, geht nicht verloren', () => {
  const db = openDatabase(tmpDir());
  const katalogNi = repo.saveKatalog(db, { Titel: 'Buch' });
  const medienNi = repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: 'M-2' });
  const leserNi = repo.saveLeser(db, { Nachname: 'Alt', Vorname: 'Anna', AusweisId: 'L-2' });
  const auslDatum = '2025-01-01 00:00:00.000';
  // Simuliert einen Datensatz von vor der Zwei-Stufen-Umstellung (IngaStufe NULL).
  db.prepare(`INSERT INTO "Mahnung" ("MedienNi","LeserNi","Mahndatum","MaGebuehr","AuslDatum") VALUES (?,?,?,?,?)`).run(
    medienNi, leserNi, '2025-02-01 00:00:00.000', 2, auslDatum
  );
  const letzte = repo.letzteMahnungFuer(db, medienNi, leserNi, auslDatum);
  assert.equal(letzte.stufeIndex, 1);
  db.close();
});
