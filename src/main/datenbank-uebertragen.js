'use strict';

/**
 * Komplette INGA-Datenbank auf einen anderen Rechner mitnehmen bzw. von dort
 * einbinden – anders als der Perpustakaan-Export (csvio.js) wirklich ALLES,
 * was INGA selbst weiß: Ausleih-/Mahnhistorie inkl. IngaStufe, Sperren,
 * Ferien, Cover, Papierkorb und (auf Wunsch) die Einstellungen.
 *
 * Paketformat ("INGA-Datenbank_<Datum>.zip"):
 *   inga.sqlite3        – in sich geschlossene Kopie (VACUUM INTO, keine -wal-Reste)
 *   covers/<Datei>      – Coverbilder
 *   einstellungen.json  – Einstellungen OHNE rechnerbezogene Angaben
 *   info.json           – Version, Zeitpunkt, Kennzahlen (nur zur Anzeige)
 *
 * Eingebunden werden kann ein solches Paket ODER eine einzelne
 * inga.sqlite3 (z. B. von Hand aus dem Datenordner eines anderen Rechners
 * kopiert, gerne samt daneben liegender inga.sqlite3-wal – die wird dabei
 * mit eingearbeitet, sonst fehlten die zuletzt gemachten Änderungen).
 * Rein Node (better-sqlite3/adm-zip), ohne Electron – dadurch testbar.
 */

const fs = require('node:fs');
const path = require('node:path');
const AdmZip = require('adm-zip');
const Database = require('better-sqlite3');

const DB_EINTRAG = 'inga.sqlite3';

// Rechnerbezogen oder geheim – gehört nicht auf einen anderen Rechner.
const NICHT_UEBERTRAGEN = new Set(['perpustakaanLiveAktiv', 'perpustakaanLiveDbPfad', 'matrixZugangstoken', 'matrixVersenderId']);

function einstellungenFuerUebertragung(einstellungen) {
  return Object.fromEntries(Object.entries(einstellungen || {}).filter(([k]) => !NICHT_UEBERTRAGEN.has(k)));
}

function zaehle(db, tabelle) {
  try {
    return db.prepare(`SELECT COUNT(*) AS n FROM "${tabelle}"`).get().n;
  } catch {
    return 0;
  }
}

function kennzahlenVon(db) {
  return {
    titel: zaehle(db, 'Katalog'),
    exemplare: zaehle(db, 'Medien'),
    leser: zaehle(db, 'Leser'),
    ausleihen: zaehle(db, 'Ausleihe'),
  };
}

/** Schreibt das Übertragungspaket. `db` ist die laufende Datenbank. */
function exportiereIngaDatenbank(db, { coversDir, einstellungen, version, zielZip, tmpDir }) {
  const tmpDb = path.join(tmpDir, `inga-export-${process.pid}-${Date.now()}.sqlite3`);
  try {
    db.prepare('VACUUM INTO ?').run(tmpDb);
    const zip = new AdmZip();
    zip.addLocalFile(tmpDb, '', DB_EINTRAG);
    let cover = 0;
    if (coversDir && fs.existsSync(coversDir)) {
      for (const datei of fs.readdirSync(coversDir)) {
        const voll = path.join(coversDir, datei);
        if (!fs.statSync(voll).isFile()) continue;
        zip.addLocalFile(voll, 'covers');
        cover += 1;
      }
    }
    zip.addFile('einstellungen.json', Buffer.from(JSON.stringify(einstellungenFuerUebertragung(einstellungen), null, 2), 'utf8'));
    const info = { programm: 'INGA', version, erstellt: new Date().toISOString(), ...kennzahlenVon(db), cover };
    zip.addFile('info.json', Buffer.from(JSON.stringify(info, null, 2), 'utf8'));
    zip.writeZip(zielZip);
    return info;
  } finally {
    fs.rmSync(tmpDb, { force: true });
  }
}

function istSqliteDatei(datei) {
  const kopf = Buffer.alloc(16);
  const fd = fs.openSync(datei, 'r');
  try {
    fs.readSync(fd, kopf, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }
  return kopf.toString('latin1') === 'SQLite format 3\u0000';
}

/**
 * Prüft eine gewählte Datei und bereitet sie zum Einbinden vor – verändert
 * die laufende INGA-Datenbank dabei NOCH NICHT. Liefert eine geprüfte,
 * in sich geschlossene Datenbankdatei in `arbeitsDir`, die mitgebrachten
 * Cover, Einstellungen und Kennzahlen für die Rückfrage. Wirft mit
 * verständlicher Meldung, wenn die Datei nicht passt.
 */
function bereiteEinbindenVor(quelle, arbeitsDir) {
  fs.mkdirSync(arbeitsDir, { recursive: true });
  const rohDb = path.join(arbeitsDir, 'quelle.sqlite3');
  let cover = [];
  let einstellungen = null;
  let info = null;

  if (/\.zip$/i.test(quelle)) {
    const zip = new AdmZip(quelle);
    const eintraege = zip.getEntries();
    const dbEintrag = eintraege.find((e) => !e.isDirectory && e.entryName.split(/[\\/]/).pop() === DB_EINTRAG);
    if (!dbEintrag) {
      if (eintraege.some((e) => /(^|[\\/])Katalog\.csv$/i.test(e.entryName))) {
        throw new Error('Das ist eine Perpustakaan-Sicherung, keine INGA-Datenbank – bitte oben unter „Perpustakaan-Import“ einlesen.');
      }
      throw new Error('Die Zip-Datei enthält keine INGA-Datenbank (inga.sqlite3).');
    }
    fs.writeFileSync(rohDb, dbEintrag.getData());
    cover = eintraege
      .filter((e) => !e.isDirectory && /(^|[\\/])covers[\\/][^\\/]+$/.test(e.entryName))
      .map((e) => ({ datei: e.entryName.split(/[\\/]/).pop(), daten: e.getData() }));
    const einst = eintraege.find((e) => e.entryName === 'einstellungen.json');
    if (einst) {
      try { einstellungen = einstellungenFuerUebertragung(JSON.parse(einst.getData().toString('utf8'))); } catch { einstellungen = null; }
    }
    const infoEintrag = eintraege.find((e) => e.entryName === 'info.json');
    if (infoEintrag) {
      try { info = JSON.parse(infoEintrag.getData().toString('utf8')); } catch { info = null; }
    }
  } else {
    if (!istSqliteDatei(quelle)) throw new Error('Die gewählte Datei ist keine INGA-Datenbank (.sqlite3) und kein INGA-Datenbankpaket (.zip).');
    fs.copyFileSync(quelle, rohDb);
    // Liegt die zugehörige -wal-Datei daneben (INGA lief auf dem anderen
    // Rechner noch oder wurde nicht sauber beendet), stecken darin die
    // jüngsten Änderungen – mitnehmen, SQLite arbeitet sie beim Öffnen ein.
    if (fs.existsSync(`${quelle}-wal`)) fs.copyFileSync(`${quelle}-wal`, `${rohDb}-wal`);
  }

  if (!istSqliteDatei(rohDb)) throw new Error('Die enthaltene Datenbank ist beschädigt oder keine SQLite-Datei.');
  const geprueft = path.join(arbeitsDir, 'geprueft.sqlite3');
  fs.rmSync(geprueft, { force: true });
  let quellDb;
  try {
    quellDb = new Database(rohDb);
  } catch (err) {
    throw new Error(`Die Datenbank lässt sich nicht öffnen (${err.message}).`);
  }
  try {
    const tabellen = new Set(quellDb.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
    if (!tabellen.has('Katalog') || !tabellen.has('inga_meta')) {
      throw new Error('Das ist keine INGA-Datenbank (es fehlen die INGA-Tabellen).');
    }
    const pruefung = quellDb.prepare('PRAGMA quick_check').get();
    if (pruefung && Object.values(pruefung)[0] !== 'ok') throw new Error('Die Datenbank ist beschädigt (Integritätsprüfung fehlgeschlagen).');
    // Cover-Verweise ohne mitgebrachte Bilddatei entfernen: sonst zeigten
    // Titel womöglich ein gleichnamiges, aber fremdes Bild aus dem
    // bisherigen Cover-Ordner, und "fehlende Cover laden" übersähe sie.
    if (tabellen.has('inga_covers')) {
      const vorhanden = new Set(cover.map((c) => c.datei));
      const loeschen = quellDb.prepare('DELETE FROM inga_covers WHERE "KatalogNi" = ?');
      for (const { KatalogNi, dateiname } of quellDb.prepare('SELECT "KatalogNi", dateiname FROM inga_covers').all()) {
        if (!vorhanden.has(path.basename(String(dateiname)))) loeschen.run(KatalogNi);
      }
    }
    const kennzahlen = kennzahlenVon(quellDb);
    quellDb.prepare('VACUUM INTO ?').run(geprueft);
    return { dbDatei: geprueft, cover, einstellungen, info, kennzahlen };
  } finally {
    quellDb.close();
  }
}

module.exports = { exportiereIngaDatenbank, bereiteEinbindenVor, einstellungenFuerUebertragung, DB_EINTRAG };
