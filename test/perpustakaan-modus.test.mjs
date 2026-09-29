/**
 * Perpustakaan-Modus (src/main/perpustakaan-modus.js): Echtzeit-Abgleich
 * zwischen INGA und der Perpustakaan-Datenbank. node:test hat kein Java –
 * die Brücke wird hier durch ein nachgebautes "Perpustakaan" ersetzt, das
 * dieselbe Semantik wie Bridge.java apply() hat (Primärschlüssel → UPDATE nur
 * geänderter Spalten, INSERT-Konflikt bei schon vergebener Nummer, Sperre,
 * solange Perpustakaan "geöffnet" ist). Die echte Brücke ist zusätzlich gegen
 * eine Kopie einer echten Perpustakaan-Datenbank geprüft (derby-bridge/README.md).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const { openDatabase } = require('../src/main/db.js');
const { importZip, exportTabellen, parseCsv, serializeCsv } = require('../src/main/csvio.js');
const repo = require('../src/main/repo.js');
const { DEFAULT_SETTINGS } = require('../src/main/store.js');
const { erstellePerpustakaanModus, berechneAenderungen } = require('../src/main/perpustakaan-modus.js');

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'perpustakaan_backup_2026-08-25_155205.zip');
const einstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 28 };

// Primärschlüssel wie in der echten Perpustakaan-Datenbank (per Derby-Metadaten ermittelt).
const PK = {
  Leser: ['LeserNi'], Medien: ['MedienNi'], Katalog: ['KatalogNi'], Ausleihe: ['MedienNi'],
  Vormerkung: ['KatalogNi', 'LeserNi'], IdentCnt: ['Entity'], MedArt: ['MedArtKb'], Parameter: ['ParmId'],
  LeserAbg: ['LeserNi'], MedienAbg: ['KatalogNi', 'MedienNi'], Mahnung: ['AuslDatum', 'LeserNi', 'MahnDatum', 'MedienNi'],
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'inga-pmodus-test-'));
}

/** Nachgebautes Perpustakaan: Tabellen als { header, zeilen }, mit denselben Regeln wie Bridge.java. */
function nachgebautesPerpustakaan() {
  const tabellen = new Map();
  for (const e of new AdmZip(FIXTURE).getEntries()) {
    const { header, rows } = parseCsv(e.getData().toString('utf8'));
    tabellen.set(e.entryName.replace(/\.csv$/, ''), { header, zeilen: rows.map((r) => header.map((h) => r[h] ?? '')) });
  }
  const p = {
    tabellen,
    gesperrt: false,
    aufrufe: [],
    zeilen(t) {
      const { header, zeilen } = tabellen.get(t);
      return zeilen.map((z) => Object.fromEntries(header.map((h, i) => [h, z[i]])));
    },
    fuegeEin(t, obj) {
      const tab = tabellen.get(t);
      tab.zeilen.push(tab.header.map((h) => (obj[h] === undefined || obj[h] === null ? '' : String(obj[h]))));
    },
    async dump(_dbPfad, zipZiel) {
      p.aufrufe.push('dump');
      if (p.gesperrt) return { ok: false, gesperrt: true };
      const zip = new AdmZip();
      const hash = crypto.createHash('sha256');
      for (const [name, { header, zeilen }] of tabellen) {
        const text = serializeCsv(header, zeilen.map((z) => Object.fromEntries(header.map((h, i) => [h, z[i]]))));
        hash.update(name + text);
        zip.addFile(`${name}.csv`, Buffer.from(text, 'utf8'));
      }
      zip.writeZip(zipZiel);
      return { ok: true, hash: hash.digest('hex') };
    },
    async apply(_dbPfad, bloecke) {
      p.aufrufe.push('apply');
      if (p.gesperrt) return { ok: false, gesperrt: true };
      const kopie = new Map([...tabellen].map(([k, v]) => [k, { header: v.header, zeilen: v.zeilen.map((z) => [...z]) }]));
      for (const { tabelle, spalten, weg, neu } of bloecke) {
        const tab = kopie.get(tabelle);
        const idx = (h) => tab.header.indexOf(h);
        const alsZeile = (werte) => tab.header.map((h) => { const i = spalten.indexOf(h); return i < 0 ? '' : werte[i]; });
        const pk = PK[tabelle];
        if (pk) {
          const schl = (werte, header) => pk.map((k) => werte[header.indexOf(k)]).join('|');
          const wegNach = new Map(weg.map((w) => [schl(w, spalten), w]));
          for (const n of neu) {
            const k = schl(n, spalten);
            const vorhanden = tab.zeilen.find((z) => schl(z, tab.header) === k);
            if (wegNach.has(k)) {
              const alt = wegNach.get(k);
              wegNach.delete(k);
              if (!vorhanden) { tab.zeilen.push(alsZeile(n)); continue; }
              spalten.forEach((h, i) => { if (alt[i] !== n[i] && idx(h) >= 0) vorhanden[idx(h)] = n[i]; });
            } else {
              if (vorhanden) return { ok: false, konflikt: true, fehler: `In Perpustakaan gibt es in „${tabelle}“ bereits ${k}` };
              tab.zeilen.push(alsZeile(n));
            }
          }
          for (const k of wegNach.keys()) tab.zeilen = tab.zeilen.filter((z) => schl(z, tab.header) !== k);
        } else {
          for (const w of weg) {
            const i = tab.zeilen.findIndex((z) => z.join('\u0001') === alsZeile(w).join('\u0001'));
            if (i >= 0) tab.zeilen.splice(i, 1);
          }
          for (const n of neu) tab.zeilen.push(alsZeile(n));
        }
      }
      for (const [k, v] of kopie) tabellen.set(k, v);
      return { ok: true };
    },
    async komplettSchreiben() {
      return { ok: true };
    },
  };
  return p;
}

function aufbau({ dir = tmpDir(), perpustakaan = nachgebautesPerpustakaan(), db } = {}) {
  db ??= openDatabase(dir);
  const meldungen = [];
  let datenNeu = 0;
  const modus = erstellePerpustakaanModus({
    holeDb: () => db,
    holeEinstellungen: () => einstellungen,
    exportTabellen,
    importZip,
    bridge: perpustakaan,
    sichereIngaDb: () => true,
    sicherePerpustakaanDb: () => true,
    basisDatei: path.join(dir, 'basis.json'),
    tmpDir: dir,
    meldeStatus: (s) => meldungen.push(s),
    meldeDatenNeu: () => { datenNeu += 1; },
  });
  return { dir, db, perpustakaan, modus, meldungen, datenNeu: () => datenNeu };
}

const warte = (ms) => new Promise((r) => setTimeout(r, ms));

test('berechneAenderungen: nur tatsächlich geänderte Zeilen, doppelte Zeilen zählen einzeln', () => {
  const basis = new Map([['T', { header: ['a', 'b'], zeilen: [['1', 'x'], ['2', 'y'], ['3', 'z'], ['3', 'z']] }]]);
  const aktuell = new Map([['T', { header: ['a', 'b'], zeilen: [['1', 'x'], ['2', 'Y'], ['3', 'z'], ['4', 'w']] }]]);
  const [block, ...rest] = berechneAenderungen(basis, aktuell);
  assert.equal(rest.length, 0);
  assert.deepEqual(block.weg.sort(), [['2', 'y'], ['3', 'z']]);
  assert.deepEqual(block.neu.sort(), [['2', 'Y'], ['4', 'w']]);
  assert.deepEqual(berechneAenderungen(aktuell, aktuell), []);
});

test('Erster Start: INGA übernimmt den kompletten Perpustakaan-Stand', async () => {
  const { db, modus, datenNeu } = aufbau();
  const status = await modus.starte('/perpustakaan');
  assert.equal(status.zustand, 'synchron');
  assert.equal(repo.kennzahlen(db).titel, 1798);
  assert.equal(datenNeu(), 1);
  assert.equal(modus.ausstehend(), 0);
});

test('Änderungen in INGA landen sofort als Einzeländerung in Perpustakaan (inkl. Fälligkeit und Nummernzähler)', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const katalogVorher = perpustakaan.zeilen('Katalog').length;

  const leser = { LeserNi: repo.saveLeser(db, { Nachname: 'Muster', Vorname: 'Mia 2a' }) };
  const medienNi = db.prepare('SELECT "MedienNi" FROM "Medien" LIMIT 1').get().MedienNi;
  const { faelligAm } = repo.ausleihen(db, { medienNi, leserNi: leser.LeserNi, benutzer: 'inga', einstellungen });
  modus.nachVorgang();
  await warte(400);
  await modus.aktualisiere(); // wartet auf die Reihe
  assert.equal(modus.status().zustand, 'synchron');

  const pLeser = perpustakaan.zeilen('Leser').find((l) => l.LeserNi === String(leser.LeserNi));
  assert.equal(pLeser?.Nachname, 'Muster');
  const pAusleihe = perpustakaan.zeilen('Ausleihe').find((a) => a.MedienNi === String(medienNi));
  assert.ok(pAusleihe, 'Ausleihe muss in Perpustakaan stehen');
  assert.equal(pAusleihe.Rueckgabe, `${faelligAm} 00:00:00.000`, 'Perpustakaan führt in Rueckgabe die Fälligkeit');
  const zaehler = perpustakaan.zeilen('IdentCnt').find((z) => z.Entity === 'Leser');
  assert.ok(Number(zaehler?.IdentNr) >= Number(leser.LeserNi), 'Perpustakaan darf die Nummer nicht noch einmal vergeben');
  assert.equal(perpustakaan.zeilen('Katalog').length, katalogVorher, 'nichts sonst angefasst');
});

test('Änderungen in Perpustakaan erscheinen in INGA', async () => {
  const { db, modus, perpustakaan, datenNeu } = aufbau();
  await modus.starte('/perpustakaan');
  const k = perpustakaan.tabellen.get('Katalog');
  k.zeilen[0][k.header.indexOf('Titel')] = 'In Perpustakaan geändert';
  const katalogNi = k.zeilen[0][k.header.indexOf('KatalogNi')];
  await modus.aktualisiere();
  assert.equal(repo.getKatalog(db, katalogNi).Titel, 'In Perpustakaan geändert');
  assert.equal(datenNeu(), 2);

  // Unverändert: kein erneutes Einlesen.
  await modus.aktualisiere();
  assert.equal(datenNeu(), 2);
});

test('Perpustakaan geöffnet: Änderungen werden gemerkt und später automatisch nachgetragen', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const leser = { LeserNi: repo.saveLeser(db, { Nachname: 'Später', Vorname: 'Sam' }) };
  perpustakaan.gesperrt = true;
  await modus.aktualisiere();
  assert.equal(modus.status().zustand, 'gesperrt');
  assert.ok(modus.status().ausstehend >= 1, 'neuer Nutzer (+ Nummernzähler) ausstehend');
  assert.equal(perpustakaan.zeilen('Leser').some((l) => l.Nachname === 'Später'), false);
  // INGA bleibt benutzbar: die Änderung ist in der Kopie.
  assert.equal(repo.getLeser(db, leser.LeserNi).Nachname, 'Später');

  perpustakaan.gesperrt = false;
  await modus.aktualisiere();
  assert.equal(modus.status().zustand, 'synchron');
  assert.ok(perpustakaan.zeilen('Leser').some((l) => l.Nachname === 'Später'));
});

test('Rückgabe: Ausleihe verschwindet in Perpustakaan und landet in der Historie', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const leser = { LeserNi: repo.saveLeser(db, { Nachname: 'Rück', Vorname: 'Rita' }) };
  const medienNi = db.prepare('SELECT "MedienNi" FROM "Medien" LIMIT 1 OFFSET 3').get().MedienNi;
  const { id } = repo.ausleihen(db, { medienNi, leserNi: leser.LeserNi, benutzer: 'inga', einstellungen });
  await modus.aktualisiere();
  assert.ok(perpustakaan.zeilen('Ausleihe').some((a) => a.MedienNi === String(medienNi)));
  repo.zurueckgeben(db, id);
  await modus.aktualisiere();
  assert.equal(perpustakaan.zeilen('Ausleihe').some((a) => a.MedienNi === String(medienNi)), false);
  assert.ok(perpustakaan.zeilen('AuslHist').some((a) => a.MedienNi === String(medienNi) && a.Rueckgabe));
});

test('Neustart: Änderungen, die nicht mehr geschrieben werden konnten, gehen nicht verloren', async () => {
  const dir = tmpDir();
  const perpustakaan = nachgebautesPerpustakaan();
  const erster = aufbau({ dir, perpustakaan });
  await erster.modus.starte('/perpustakaan');
  perpustakaan.gesperrt = true;
  repo.saveLeser(erster.db, { Nachname: 'Offline', Vorname: 'Olli' });
  await erster.modus.abschliessen(); // wie beim Beenden von INGA: Modus bleibt eingeschaltet

  perpustakaan.gesperrt = false;
  const zweiter = aufbau({ dir, perpustakaan, db: erster.db });
  await zweiter.modus.starte('/perpustakaan');
  assert.equal(zweiter.modus.status().zustand, 'synchron');
  assert.ok(perpustakaan.zeilen('Leser').some((l) => l.Nachname === 'Offline'));
});

test('Konflikt: dieselbe Nummer in beiden Programmen vergeben -> nichts wird geschrieben, Perpustakaan-Stand lässt sich übernehmen', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  perpustakaan.gesperrt = true;
  const leser = { LeserNi: repo.saveLeser(db, { Nachname: 'INGA-Kind', Vorname: 'A' }) };
  await modus.aktualisiere();
  // Währenddessen legt jemand in Perpustakaan einen Nutzer mit derselben Nummer an.
  perpustakaan.fuegeEin('Leser', { LeserNi: leser.LeserNi, Nachname: 'Perpustakaan-Kind', Vorname: 'B' });
  perpustakaan.gesperrt = false;
  await modus.aktualisiere();
  assert.equal(modus.status().zustand, 'konflikt');
  assert.equal(perpustakaan.zeilen('Leser').filter((l) => l.LeserNi === String(leser.LeserNi)).length, 1);

  // Automatische Wiederholung versucht es bei einem Konflikt NICHT von selbst weiter.
  const aufrufeVorher = perpustakaan.aufrufe.length;
  modus.nachVorgang();
  await warte(400);
  assert.equal(perpustakaan.aufrufe.length, aufrufeVorher);

  await modus.perpustakaanUebernehmen();
  assert.equal(modus.status().zustand, 'synchron');
  assert.equal(repo.getLeser(db, leser.LeserNi).Nachname, 'Perpustakaan-Kind');
});

test('Einlesen überschreibt keine gleichzeitig entstandene INGA-Änderung', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const originalDump = perpustakaan.dump;
  perpustakaan.dump = async (...args) => {
    // Während Perpustakaan gelesen wird, ändert jemand etwas in INGA.
    repo.saveLeser(db, { Nachname: 'Zwischendurch', Vorname: 'Zoe' });
    const k = perpustakaan.tabellen.get('Katalog');
    k.zeilen[1][k.header.indexOf('Titel')] = 'geändert';
    perpustakaan.dump = originalDump;
    return originalDump(...args);
  };
  await modus.aktualisiere();
  await warte(400);
  await modus.aktualisiere();
  assert.ok(repo.searchLeser(db, {}).rows.some((l) => l.Nachname === 'Zwischendurch'), 'INGA-Änderung ist noch da');
  assert.ok(perpustakaan.zeilen('Leser').some((l) => l.Nachname === 'Zwischendurch'), 'und wurde nach Perpustakaan geschrieben');
});

test('berechneAenderungen: abweichender Tabellenaufbau wird über die Spaltennamen verglichen, nicht komplett ersetzt', () => {
  const basis = new Map([['T', { header: ['b', 'a'], zeilen: [['x', '1'], ['y', '2']] }]]);
  const aktuell = new Map([['T', { header: ['a', 'b', 'c'], zeilen: [['1', 'x', ''], ['2', 'Y', '']] }]]);
  const bloecke = berechneAenderungen(basis, aktuell);
  assert.equal(bloecke.length, 1);
  assert.deepEqual(bloecke[0].weg, [['2', 'y', '']]);
  assert.deepEqual(bloecke[0].neu, [['2', 'Y', '']]);
});

test('Komplett schreiben gleicht gegen den tatsächlichen Perpustakaan-Stand ab (nur Unterschiede)', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const k = perpustakaan.tabellen.get('Katalog');
  const katalogNi = k.zeilen[2][k.header.indexOf('KatalogNi')];
  perpustakaan.gesperrt = true;
  repo.saveKatalog(db, { ...repo.getKatalog(db, katalogNi), Titel: 'Von INGA' });
  await modus.aktualisiere();
  perpustakaan.gesperrt = false;
  const status = await modus.ingaKomplettSchreiben();
  assert.equal(status.zustand, 'synchron');
  assert.equal(perpustakaan.zeilen('Katalog').find((z) => z.KatalogNi === katalogNi).Titel, 'Von INGA');
  assert.equal(perpustakaan.zeilen('Katalog').length, k.zeilen.length);
  assert.equal(modus.ausstehend(), 0);
});

test('Aus- und wieder Einschalten: INGA übernimmt wieder den Perpustakaan-Stand, statt Zwischenänderungen hochzuschieben', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  await modus.stoppe();
  const leser = repo.saveLeser(db, { Nachname: 'Ohne-Modus', Vorname: 'Otto' });
  await modus.starte('/perpustakaan');
  assert.equal(modus.status().zustand, 'synchron');
  assert.equal(perpustakaan.zeilen('Leser').some((l) => l.Nachname === 'Ohne-Modus'), false);
  assert.equal(repo.getLeser(db, leser), undefined);
});

test('Einlesen aus Perpustakaan behält INGA-eigene Felder (Ausleihsperre, Mahnstufe)', async () => {
  const { db, modus, perpustakaan } = aufbau();
  await modus.starte('/perpustakaan');
  const leserNi = repo.saveLeser(db, { Nachname: 'Gesperrt', Vorname: 'Gina' });
  const medienNi = db.prepare('SELECT "MedienNi" FROM "Medien" LIMIT 1 OFFSET 7').get().MedienNi;
  const ausleihe = repo.ausleihen(db, { medienNi, leserNi, benutzer: 'inga', einstellungen });
  repo.leserSperren(db, leserNi, {});
  const auslDatum = db.prepare('SELECT "AuslDatum" FROM "Ausleihe" WHERE id = ?').get(ausleihe.id).AuslDatum;
  repo.mahnungEintragen(db, { medienNi, leserNi, auslDatum, gebuehr: 0, stufe: 1 });
  await modus.aktualisiere();
  // Perpustakaan ändert etwas anderes -> INGA liest neu ein
  const k = perpustakaan.tabellen.get('Katalog');
  k.zeilen[3][k.header.indexOf('Titel')] = 'Neu eingelesen';
  await modus.aktualisiere();
  assert.equal(repo.getKatalog(db, k.zeilen[3][k.header.indexOf('KatalogNi')]).Titel, 'Neu eingelesen');
  assert.equal(repo.leserGesperrt(db, leserNi).gesperrt, true, 'Sperre muss erhalten bleiben');
  assert.equal(repo.letzteMahnungFuer(db, medienNi, leserNi, auslDatum)?.stufeIndex, 0, 'Mahnstufe muss erhalten bleiben');
});

test('Kein doppelter Schlüssel für Perpustakaan: Papierkorb je Person einmal, Mahnung je Ausleihe und Tag einmal', () => {
  const db = openDatabase(tmpDir());
  db.prepare(`INSERT INTO "Katalog" ("KatalogNi","Titel") VALUES (1,'T')`).run();
  db.prepare(`INSERT INTO "Medien" ("MedienNi","KatalogNi","MedienEtik") VALUES (9,1,'X9')`).run();
  const leserNi = repo.saveLeser(db, { Nachname: 'Zweimal', Vorname: 'Z' });
  repo.deleteLeser(db, leserNi, 'inga');
  const [eintrag] = repo.papierkorbLeserListe(db);
  repo.leserWiederherstellen(db, eintrag.id);
  repo.deleteLeser(db, leserNi, 'inga');
  assert.equal(repo.papierkorbLeserListe(db).length, 1);

  const l2 = repo.saveLeser(db, { Nachname: 'Mahn', Vorname: 'M' });
  const { id } = repo.ausleihen(db, { medienNi: 9, leserNi: l2, benutzer: 'inga', einstellungen });
  const auslDatum = db.prepare('SELECT "AuslDatum" FROM "Ausleihe" WHERE id = ?').get(id).AuslDatum;
  repo.mahnungEintragen(db, { medienNi: 9, leserNi: l2, auslDatum, gebuehr: 0, stufe: 1 });
  repo.mahnungEintragen(db, { medienNi: 9, leserNi: l2, auslDatum, gebuehr: 1.5, stufe: 2 });
  const mahnungen = db.prepare('SELECT * FROM "Mahnung"').all();
  assert.equal(mahnungen.length, 1);
  assert.equal(mahnungen[0].IngaStufe, 2);
});
