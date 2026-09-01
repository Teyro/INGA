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
