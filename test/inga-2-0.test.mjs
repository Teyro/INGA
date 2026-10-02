/**
 * INGA 2.0: Klassen-Erkennung, Ausleihgrenzen, Schäden, Vormerkungszettel,
 * Erinnerungen, Rückstand pro Klasse, Lesepass, Empfehlungen, Anschaffungen,
 * Inventur, Leseausweise, Schuljahreswechsel, Jahresbericht, Datenschutz.
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
const erw = require('../src/main/erweiterungen.js');
const klassen = require('../src/main/klassen.js');
const { DEFAULT_SETTINGS, sanitizeSettings } = require('../src/main/store.js');
const { heuteISO, addTage } = require('../src/main/date-utils.js');

const einstellungen = { ...DEFAULT_SETTINGS, leihfristTage: 21 };
const stamp = (iso) => `${iso} 00:00:00.000`;

/** Kleine Schule: Gruppen wie im echten Bestand, Kinder mit Klasse an verschiedenen Stellen. */
function schule() {
  const db = openDatabase(fs.mkdtempSync(path.join(os.tmpdir(), 'inga-v2-')));
  const gruppe = db.prepare(`INSERT INTO "LeserGrupp" ("LeserGruNi", "LeserGruBz", "AusleihMax") VALUES (?, ?, ?)`);
  gruppe.run(1, '1c Fr. Brücker 26/27', 0);
  gruppe.run(2, '3a Fr. Warnholz 26/27', 0);
  gruppe.run(3, '4b Fr. Hoffmann 26/27', 0);
  gruppe.run(4, 'Lehrer', 5);
  const leser = (nachname, vorname, gruppeNi, jahrgang = null) =>
    repo.saveLeser(db, { Nachname: nachname, Vorname: vorname, LeserGruNi: gruppeNi, Jahrgang: jahrgang });
  const ids = {
    mia: leser('Muster', 'Mia', 1),                 // Klasse aus Gruppe: 1c
    ben: leser('Beispiel', 'Ben 3a', 2),            // Gruppe 3a, Vorname passt dazu
    lea: leser('Lustig', 'Lea', 3),                 // 4b → Abgängerin
    tom: leser('Test', 'Tom 2b', 0),                // nur Vorname: 2b
    ali: leser('Jahr', 'Ali', 0, '2c'),             // Jahrgang: 2c
    frau: leser('Lehrerin', 'Eva', 4),              // keine Klasse
  };
  const katalog = (titel, autor, system) => repo.saveKatalog(db, { Titel: titel, Autor: autor, SystemId: system, MedArtKb: 'Buc' });
  const k = {
    a: katalog('Drache Kokosnuss', 'Siegner', 'KIN'),
    b: katalog('Das magische Baumhaus', 'Osborne', 'KIN'),
    c: katalog('Die Olchis', 'Dietl', 'KIN'),
    d: katalog('Lexikon', 'Verlag', 'SACH'),
  };
  const medium = (katalogNi, etikett) => repo.saveMedium(db, { KatalogNi: katalogNi, MedienEtik: etikett });
  const m = { a1: medium(k.a, 'A1'), a2: medium(k.a, 'A2'), b1: medium(k.b, 'B1'), c1: medium(k.c, 'C1'), d1: medium(k.d, 'D1') };
  return { db, ids, k, m };
}

/** Ausleihe mit beliebigem Datum (und optional schon zurückgegeben). */
function ausleihe(db, medienNi, leserNi, ausgeliehen, zurueck = null) {
  return db.prepare(`INSERT INTO "Ausleihe" ("MedienNi", "LeserNi", "AuslDatum", "Rueckgabe", "AnzVerl", "ErfassAnw") VALUES (?, ?, ?, ?, 0, 'test')`)
    .run(medienNi, leserNi, stamp(ausgeliehen), zurueck ? stamp(zurueck) : null).lastInsertRowid;
}

test('Klassen: aus Jahrgang, Gruppe oder Vorname – in dieser Reihenfolge', () => {
  assert.equal(klassen.klasseVon({ Jahrgang: '2c', Vorname: 'Ali 4a' }, '1c Fr. X').kuerzel, '2c');
  assert.equal(klassen.klasseVon({ Jahrgang: '', Vorname: 'Glenn 4c' }, '1c Fr. Brücker 26/27').kuerzel, '1c');
  assert.equal(klassen.klasseVon({ Vorname: 'Glenn Asuming 4c' }, 'Lehrer').kuerzel, '4c');
  assert.equal(klassen.klasseVon({ Vorname: 'Eva' }, 'Lehrer'), null);
  assert.equal(klassen.klasseVon({ Vorname: 'Max' }, 'VSK A Frau Thom 2023/24'), null);
  assert.equal(klassen.lehrkraftAusGruppe('1c Fr. Brücker 26/27'), 'Fr. Brücker');
  assert.equal(klassen.schuljahrVon('2026-09-30'), '2026/27');
  assert.equal(klassen.schuljahrVon('2027-07-31'), '2026/27');
  assert.equal(klassen.schuljahrWeiter('1c Fr. Brücker 26/27'), '1c Fr. Brücker 27/28');
  assert.equal(klassen.schuljahrWeiter('VSK 2023/24'), 'VSK 2024/25');
  assert.equal(erw.vornameOhneKlasse('Glenn Asuming 4c'), 'Glenn Asuming');
});

test('Einstellungen: Grenzen je Klassenstufe und Lesepass-Stufen werden geprüft', () => {
  const s = sanitizeSettings({ ausleihLimitJeStufe: { 1: '2', 2: -5, x: 3 }, lesepassStufen: [20, 5, 'x', 10, 10] });
  assert.deepEqual(s.ausleihLimitJeStufe, { 1: 2, 2: 0 });
  assert.deepEqual(s.lesepassStufen, [5, 10, 20]);
});

test('Ausleihgrenze: Gruppe vor Klassenstufe vor allgemeiner Grenze', () => {
  const { db, ids, m } = schule();
  const e = { ...einstellungen, ausleihLimit: 9, ausleihLimitJeStufe: { 1: 1 } };
  assert.equal(repo.ausleihGrenzeFuer(db, ids.mia, e).grenze, 1);
  assert.equal(repo.ausleihGrenzeFuer(db, ids.frau, e).grenze, 5);
  assert.equal(repo.ausleihGrenzeFuer(db, ids.ben, e).grenze, 9);
  repo.ausleihen(db, { medienNi: m.a1, leserNi: ids.mia, einstellungen: e });
  assert.throws(() => repo.ausleihen(db, { medienNi: m.b1, leserNi: ids.mia, einstellungen: e }), /Klassenstufe 1/);
});

test('Schaden erfassen, auf Wunsch Exemplar als "Beschädigt" sperren, als erledigt markieren', () => {
  const { db, ids, k, m } = schule();
  erw.schadenErfassen(db, { medienNi: m.a1, leserNi: ids.ben, beschreibung: 'Seite 12 eingerissen', schwere: 'mittel', nichtVerfuegbar: true });
  const [s] = erw.schaedenFuerKatalog(db, k.a);
  assert.equal(s.beschreibung, 'Seite 12 eingerissen');
  assert.equal(s.Nachname, 'Beispiel');
  const medium = db.prepare(`SELECT "NichtVfNi" FROM "Medien" WHERE "MedienNi" = ?`).get(m.a1);
  assert.equal(db.prepare(`SELECT "NichtVfBz" FROM "Nichtverf" WHERE "NichtVfNi" = ?`).get(medium.NichtVfNi).NichtVfBz, 'Beschädigt');
  erw.schadenErledigt(db, s.id);
  assert.equal(erw.schaedenFuerKatalog(db, k.a)[0].erledigt, 1);
  assert.throws(() => erw.schadenErfassen(db, { medienNi: m.a1, beschreibung: '  ' }), /beschreiben/);
});

test('Vormerkung nach Rückgabe: Zettel-Daten für das wartende Kind', () => {
  const { db, ids, k, m } = schule();
  const { id } = repo.ausleihen(db, { medienNi: m.b1, leserNi: ids.ben, einstellungen });
  repo.vormerken(db, { katalogNi: k.b, leserNi: ids.tom });
  repo.zurueckgeben(db, id);
  const z = erw.vormerkungNachRueckgabe(db, id);
  assert.equal(z.titel, 'Das magische Baumhaus');
  assert.equal(z.vorname, 'Tom');
  assert.equal(z.klasse, '2b');
  const { id: id2 } = repo.ausleihen(db, { medienNi: m.c1, leserNi: ids.ben, einstellungen });
  repo.zurueckgeben(db, id2);
  assert.equal(erw.vormerkungNachRueckgabe(db, id2), null);
});

test('Bald fällig: nur Ausleihen, die in den nächsten Tagen fällig werden', () => {
  const { db, ids, m } = schule();
  const e = { ...einstellungen, leihfristTage: 21 };
  ausleihe(db, m.a1, ids.mia, addTage(heuteISO(), -19)); // fällig in 2 Tagen (ohne Ferien/Wochenende evtl. etwas später)
  ausleihe(db, m.b1, ids.ben, heuteISO());                // fällig in 21 Tagen
  ausleihe(db, m.c1, ids.tom, addTage(heuteISO(), -40));  // längst überfällig
  const bald = erw.baldFaellig(db, e, 5);
  assert.deepEqual(bald.map((b) => b.Nachname), ['Muster']);
  assert.equal(bald[0].klasse, '1c');
  assert.equal(bald[0].lehrkraft, 'Fr. Brücker');
});

test('Rückstand pro Klasse: eine Liste je Klasse mit Lehrkraft', () => {
  const { db, ids, m } = schule();
  ausleihe(db, m.a1, ids.mia, addTage(heuteISO(), -60));
  ausleihe(db, m.b1, ids.ben, addTage(heuteISO(), -60));
  ausleihe(db, m.c1, ids.lea, addTage(heuteISO(), -60));
  ausleihe(db, m.a2, ids.ben, heuteISO());
  const liste = erw.rueckstandProKlasse(db, einstellungen, 1);
  assert.deepEqual(liste.map((k) => k.klasse), ['1c', '3a', '4b']);
  assert.equal(liste[1].lehrkraft, 'Fr. Warnholz');
  assert.equal(liste[1].zeilen[0].Vorname, 'Ben');
});

test('Lesepass: gelesene Bücher im Schuljahr, Stufen', () => {
  const { db, ids, m } = schule();
  const sj = klassen.schuljahrVon(heuteISO());
  const start = klassen.schuljahrZeitraum(sj).von;
  for (const [i, medium] of [m.a1, m.b1, m.c1, m.d1].entries()) ausleihe(db, medium, ids.ben, addTage(start, i), addTage(start, i + 3));
  ausleihe(db, m.a2, ids.ben, addTage(start, 10), addTage(start, 12)); // gleicher Titel wie a1 → zählt nicht doppelt
  ausleihe(db, m.a1, ids.mia, addTage(start, -30), addTage(start, -20)); // altes Schuljahr
  const pass = erw.lesepass(db, { schuljahr: sj, stufen: [2, 4, 8] });
  assert.equal(pass.length, 1);
  assert.equal(pass[0].anzahl, 4);
  assert.equal(pass[0].stufe, 'Silber');
  assert.equal(pass[0].naechsteStufe, 8);
  assert.equal(erw.lesepass(db, { schuljahr: sj, klasse: '1c' })[0].anzahl, 0);
});

test('Empfehlungen: wer das las, las auch – sonst gleiche Autorin/Kategorie', () => {
  const { db, ids, k, m } = schule();
  ausleihe(db, m.a1, ids.mia, '2026-01-01', '2026-01-10');
  ausleihe(db, m.b1, ids.mia, '2026-01-11', '2026-01-20');
  ausleihe(db, m.a2, ids.ben, '2026-01-01', '2026-01-10');
  ausleihe(db, m.b1, ids.ben, '2026-02-01', '2026-02-10');
  const e = erw.empfehlungen(db, k.a, 3);
  assert.equal(e[0].Titel, 'Das magische Baumhaus');
  assert.equal(e[0].leser, 2);
  assert.ok(e.some((x) => x.Titel === 'Die Olchis' && x.grund === 'gleiche Kategorie'));
  const tipps = erw.lesetippsFuerLeser(db, ids.tom);
  assert.deepEqual(tipps, []);
  ausleihe(db, m.a1, ids.tom, '2026-03-01', '2026-03-05');
  assert.equal(erw.lesetippsFuerLeser(db, ids.tom)[0].Titel, 'Das magische Baumhaus');
});

test('Anschaffungen und Budget', () => {
  const { db } = schule();
  const sj = klassen.schuljahrVon(heuteISO());
  erw.budgetSetzen(db, sj, '300,50');
  const w = erw.anschaffungSpeichern(db, { titel: 'Neues Buch', preis: '12,99', anzahl: 2, wunsch_von: 'Klasse 2b' });
  assert.equal(erw.budget(db, sj).geplant, 25.98);
  erw.anschaffungSpeichern(db, { id: w, titel: 'Neues Buch', preis: '12,99', anzahl: 2, status: 'bestellt' });
  const b = erw.budget(db, sj);
  assert.equal(b.betrag, 300.5);
  assert.equal(b.ausgegeben, 25.98);
  assert.equal(Math.round(b.frei * 100) / 100, 274.52);
  erw.anschaffungSpeichern(db, { id: w, titel: 'Neues Buch', preis: '12,99', anzahl: 2, status: 'geliefert' });
  const eintrag = erw.anschaffungen(db)[0];
  assert.ok(eintrag.bestellt_am && eintrag.geliefert_am);
  erw.anschaffungLoeschen(db, w);
  assert.equal(erw.anschaffungen(db).length, 0);
  assert.throws(() => erw.anschaffungSpeichern(db, { titel: '' }), /Titel/);
});

test('Inventur: scannen, Fehlliste, Abschluss markiert Vermisstes, Wiedergefundenes wird frei', () => {
  const { db, ids, m } = schule();
  repo.ausleihen(db, { medienNi: m.d1, leserNi: ids.ben, einstellungen }); // ausgeliehen → nicht im Regal erwartet
  erw.inventurStarten(db);
  assert.throws(() => erw.inventurStarten(db), /bereits/);
  assert.equal(erw.inventurScan(db, 'A1').status, 'ok');
  assert.equal(erw.inventurScan(db, 'A1').status, 'doppelt');
  assert.equal(erw.inventurScan(db, 'D1').status, 'ausgeliehen');
  assert.equal(erw.inventurScan(db, 'XYZ').status, 'unbekannt');
  const stand = erw.inventurStand(db);
  assert.equal(stand.erwartet, 4);
  assert.deepEqual(stand.fehlend.map((f) => f.MedienEtik).sort(), ['A2', 'B1', 'C1']);
  const erg = erw.inventurAbschliessen(db, { fehlendeAlsVermisst: true });
  assert.equal(erg.vermisst, 3);
  assert.equal(repo.verlustliste(db).length, 3);
  // Nächste Inventur: B1 taucht wieder auf
  erw.inventurStarten(db);
  assert.equal(erw.inventurScan(db, 'B1').status, 'wiedergefunden');
  assert.equal(erw.inventurAbschliessen(db, { fehlendeAlsVermisst: false }).wiedergefunden, 1);
  assert.equal(repo.verlustliste(db).length, 2);
  erw.inventurStarten(db);
  erw.inventurAbbrechen(db);
  assert.equal(erw.inventurStand(db).aktiv, false);
});

test('Leseausweise: nach Klasse, Nummer aus Ausweis-ID oder LeserNi, Vorname ohne Klasse', () => {
  const { db, ids } = schule();
  db.prepare(`UPDATE "Leser" SET "AusweisId" = '000123' WHERE "LeserNi" = ?`).run(ids.ben);
  const alle = erw.ausweisDaten(db);
  assert.equal(alle.length, 6);
  const [ben] = erw.ausweisDaten(db, { klasse: '3a' });
  assert.deepEqual([ben.vorname, ben.nummer, ben.klasse], ['Ben', '000123', '3a']);
  assert.equal(erw.ausweisDaten(db, { leserNis: [ids.tom] })[0].nummer, String(ids.tom));
  assert.deepEqual(erw.klassenListe(db).map((k) => k.klasse), ['1c', '2b', '2c', '3a', '4b']);
});

test('Schuljahreswechsel: Gruppen und Kinder hochzählen, Abgänger in den Papierkorb', () => {
  const { db, ids, m } = schule();
  const plan = erw.schuljahreswechselPlan(db, einstellungen);
  assert.deepEqual(plan.gruppen.map((g) => g.neu), ['2c Fr. Brücker 27/28', '4a Fr. Warnholz 27/28', '1b Fr. Hoffmann 27/28']);
  assert.deepEqual(plan.abgaenger.map((a) => a.name), ['Lustig, Lea']);
  assert.deepEqual(plan.ohneKlasse.map((a) => a.name), ['Lehrerin, Eva']);

  // Ein zweites Abgänger-Kind mit offener Ausleihe bleibt, aus der Gruppe gelöst.
  const max = repo.saveLeser(db, { Nachname: 'Offen', Vorname: 'Max', LeserGruNi: 3 });
  repo.ausleihen(db, { medienNi: m.a1, leserNi: max, einstellungen });

  const erg = erw.schuljahreswechselAusfuehren(db, einstellungen);
  assert.equal(erg.papierkorb, 1);
  assert.equal(erg.behalten.length, 1);
  assert.equal(repo.getLeser(db, ids.lea), undefined);
  assert.match(repo.getLeser(db, max).Jahrgang, /^Abgang/);
  assert.equal(repo.getLeser(db, max).LeserGruNi, 0);
  assert.equal(repo.getLeser(db, ids.ben).Vorname, 'Ben 4a');
  assert.equal(repo.getLeser(db, ids.tom).Vorname, 'Tom 3b');
  assert.equal(repo.getLeser(db, ids.ali).Jahrgang, '3c');
  assert.equal(repo.getLeser(db, ids.mia).Vorname, 'Mia'); // Klasse kommt aus der Gruppe
  assert.equal(db.prepare(`SELECT "LeserGruBz" FROM "LeserGrupp" WHERE "LeserGruNi" = 1`).get().LeserGruBz, '2c Fr. Brücker 27/28');
  assert.equal(db.prepare(`SELECT "LeserGruBz" FROM "LeserGrupp" WHERE "LeserGruNi" = 4`).get().LeserGruBz, 'Lehrer');
  assert.equal(repo.papierkorbLeserListe(db).length, 1);
});

test('Jahresbericht: Kennzahlen, Monate Aug–Jul, Top-Bücher, Klassen, Lesepass, Budget', () => {
  const { db, ids, m } = schule();
  const sj = klassen.schuljahrVon(heuteISO());
  const start = klassen.schuljahrZeitraum(sj).von;
  ausleihe(db, m.a1, ids.mia, addTage(start, 3), addTage(start, 10));
  ausleihe(db, m.a2, ids.ben, addTage(start, 40), addTage(start, 50));
  ausleihe(db, m.b1, ids.ben, addTage(start, 41));
  erw.budgetSetzen(db, sj, 100);
  const b = erw.jahresbericht(db, einstellungen, sj);
  assert.equal(b.kennzahlen.ausleihen, 3);
  assert.equal(b.kennzahlen.aktiveLeser, 2);
  assert.equal(b.monate.length, 12);
  assert.equal(b.monate[0].monat.slice(5), '08');
  assert.equal(b.monate[0].anzahl, 1);
  assert.equal(b.top[0].Titel, 'Drache Kokosnuss');
  assert.equal(b.top[0].n, 2);
  assert.deepEqual(b.proKlasse.map((k) => k.klasse), ['1c', '3a']);
  assert.equal(b.budget.betrag, 100);
});

test('Datenschutz: alte Historie löschen, Auskunft über ein Kind', () => {
  const { db, ids, m } = schule();
  const alt = ausleihe(db, m.a1, ids.ben, addTage(heuteISO(), -500), addTage(heuteISO(), -480));
  ausleihe(db, m.b1, ids.ben, addTage(heuteISO(), -20), addTage(heuteISO(), -10));
  ausleihe(db, m.c1, ids.ben, addTage(heuteISO(), -400)); // offen – bleibt immer
  erw.schadenErfassen(db, { medienNi: m.a1, leserNi: ids.ben, beschreibung: 'Fleck' });
  db.prepare(`UPDATE inga_schaeden SET datum = ?`).run(stamp(addTage(heuteISO(), -490)));
  assert.equal(erw.historieVorschau(db, 12).ausleihen, 1);
  const r = erw.historieBereinigen(db, 12);
  assert.equal(r.ausleihen, 1);
  assert.equal(r.schaeden, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe" WHERE id = ?`).get(alt).n, 0);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe"`).get().n, 2);
  assert.deepEqual(erw.historieBereinigen(db, 0), { ausleihen: 0, mahnungen: 0, schaeden: 0 });

  const a = erw.auskunft(db, ids.ben);
  assert.equal(a.name, 'Beispiel, Ben');
  assert.equal(a.klasse, '3a');
  assert.equal(a.ausleihen.length, 2);
  assert.ok(a.felder.some((f) => f.feld === 'Nachname' && f.wert === 'Beispiel'));
});

test('Antolin und Neuerwerbungen', () => {
  const { db, k } = schule();
  db.prepare(`UPDATE "Katalog" SET "KlasseAnto" = '2-3' WHERE "KatalogNi" = ?`).run(k.b);
  db.prepare(`UPDATE "Katalog" SET "KlasseAnto" = '4' WHERE "KatalogNi" = ?`).run(k.c);
  db.prepare(`UPDATE "Katalog" SET "ErfassDat" = ? WHERE "KatalogNi" = ?`).run(stamp(addTage(heuteISO(), -400)), k.d);
  assert.deepEqual(erw.antolinBuecher(db, 3).map((b) => b.Titel), ['Das magische Baumhaus']);
  assert.equal(erw.antolinBuecher(db).length, 2);
  const neu = erw.neuerwerbungen(db, 60);
  assert.equal(neu.length, 3);
  assert.equal(neu.find((b) => b.Titel === 'Drache Kokosnuss').exemplare, 2);
});
