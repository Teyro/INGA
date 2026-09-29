'use strict';

/**
 * Perpustakaan-Modus: die ECHTE Perpustakaan-Datenbank ist die Hauptdatenbank,
 * INGAs eigene Datenbank nur noch Arbeitskopie und Sicherung.
 *
 *  - Lesen: INGA holt den Stand aus Perpustakaan beim Start, sobald das
 *    INGA-Fenster wieder in den Vordergrund kommt und regelmäßig, solange es
 *    im Vordergrund ist. Unveränderte Stände erkennt ein Inhalts-Hash der
 *    Bridge – dann wird nichts neu eingelesen.
 *  - Schreiben: jede Änderung in INGA (Ausleihe, Rückgabe, neuer Nutzer, …)
 *    wird unmittelbar danach als EINZELÄNDERUNG in Perpustakaan geschrieben
 *    (nur die tatsächlich geänderten Zeilen/Spalten, eine Transaktion – siehe
 *    Bridge.java apply()). Kein Überschreiben der ganzen Datenbank.
 *
 * Grenze, die sich nicht wegprogrammieren lässt: Derby (die Datenbank von
 * Perpustakaan) lässt immer nur EIN Programm gleichzeitig hinein. Ist
 * Perpustakaan geöffnet, kann INGA weder lesen noch schreiben – INGA arbeitet
 * dann mit seiner Kopie weiter, merkt sich die Änderungen ("ausstehend") und
 * trägt sie automatisch nach, sobald Perpustakaan wieder geschlossen ist.
 * INGA selbst hält die Datenbank nur für wenige Sekunden je Zugriff.
 *
 * Wie werden Änderungen erkannt? Nach jedem Abgleich merkt sich INGA den
 * exportierten Stand aller Perpustakaan-Tabellen ("Basis", auch auf der
 * Festplatte, damit nach einem Neustart nichts verloren geht). Der Unterschied
 * zwischen Basis und aktuellem Stand ist genau das, was in Perpustakaan
 * nachzutragen ist – unabhängig davon, welche Funktion in INGA ihn erzeugt hat.
 *
 * Dieses Modul kennt weder Electron noch Java direkt – alles kommt über
 * `abhaengigkeiten` herein (testbar mit einer nachgebauten Brücke, siehe
 * test/perpustakaan-modus.test.mjs).
 */

const fs = require('node:fs');
const path = require('node:path');

// Nicht abgleichen: StatMedien ist in INGA eine reine Momentaufnahme der
// offenen Ausleihen (csvio.computeStatMedien), in Perpustakaan aber dessen
// eigene Statistik – die soll INGA nicht umschreiben.
const NICHT_ABGLEICHEN = new Set(['StatMedien']);

const TRENNER = '\u0001';

/** Exportierter Stand aller Tabellen als Map Tabelle → { header, zeilen: string[][] } (NULL/leer einheitlich als ''). */
function schnappschuss(exportTabellen) {
  const ergebnis = new Map();
  for (const { table, header, rows } of exportTabellen) {
    if (NICHT_ABGLEICHEN.has(table)) continue;
    ergebnis.set(table, {
      header: [...header],
      zeilen: rows.map((r) => header.map((spalte) => (r[spalte] === null || r[spalte] === undefined ? '' : String(r[spalte])))),
    });
  }
  return ergebnis;
}

/**
 * Unterschied zweier Schnappschüsse als Liste von Tabellenblöcken
 * { tabelle, spalten, weg, neu } (Mengen-Semantik: doppelte Zeilen zählen
 * einzeln). Unterscheidet sich der Aufbau einer Tabelle (andere Spalten oder
 * Reihenfolge), wird der alte Stand über die Spaltennamen auf den neuen
 * umgerechnet – NICHT alles gelöscht und neu angelegt (das verlöre in
 * Perpustakaan Daten, die INGA gar nicht kennt, z. B. Bilder).
 */
function berechneAenderungen(basis, aktuell) {
  const bloecke = [];
  const tabellen = new Set([...basis.keys(), ...aktuell.keys()]);
  for (const tabelle of tabellen) {
    let alt = basis.get(tabelle) || { header: aktuell.get(tabelle).header, zeilen: [] };
    const neu = aktuell.get(tabelle) || { header: alt.header, zeilen: [] };
    if (alt.header.join(TRENNER) !== neu.header.join(TRENNER)) {
      const position = neu.header.map((h) => alt.header.indexOf(h));
      alt = { header: neu.header, zeilen: alt.zeilen.map((z) => position.map((i) => (i < 0 ? '' : z[i] ?? ''))) };
    }
    const vorrat = new Map();
    for (const z of alt.zeilen) {
      const k = z.join(TRENNER);
      const liste = vorrat.get(k);
      if (liste) liste.push(z);
      else vorrat.set(k, [z]);
    }
    const hinzu = [];
    for (const z of neu.zeilen) {
      const liste = vorrat.get(z.join(TRENNER));
      if (liste && liste.length) liste.pop();
      else hinzu.push(z);
    }
    const weg = [];
    for (const liste of vorrat.values()) weg.push(...liste);
    if (weg.length || hinzu.length) bloecke.push({ tabelle, spalten: neu.header, weg, neu: hinzu });
  }
  return bloecke;
}

function anzahlAenderungen(bloecke) {
  // Eine geänderte Zeile erscheint als "weg" + "neu" – für die Anzeige als eine zählen.
  return bloecke.reduce((summe, b) => summe + Math.max(b.weg.length, b.neu.length), 0);
}

function basisLaden(datei, dbPfad) {
  try {
    const roh = JSON.parse(fs.readFileSync(datei, 'utf8'));
    if (roh.dbPfad !== dbPfad || !roh.tabellen) return null;
    return { basis: new Map(Object.entries(roh.tabellen)), hash: roh.hash || null };
  } catch {
    return null;
  }
}

function basisSpeichern(datei, dbPfad, basis, hash) {
  const tmp = `${datei}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ dbPfad, hash, gespeichert: new Date().toISOString(), tabellen: Object.fromEntries(basis) }));
  fs.renameSync(tmp, datei); // erst vollständig schreiben, dann ersetzen – nie eine halbe Datei
}

/** Schnappschuss (wie schnappschuss()) direkt aus einem Perpustakaan-Zip – der TATSÄCHLICHE Stand in Perpustakaan. */
function schnappschussAusZip(zipPfad) {
  const AdmZip = require('adm-zip');
  const { parseCsv } = require('./csvio');
  const ergebnis = new Map();
  for (const eintrag of new AdmZip(zipPfad).getEntries()) {
    const name = eintrag.entryName.split(/[\\/]/).pop().replace(/\.csv$/i, '');
    if (NICHT_ABGLEICHEN.has(name)) continue;
    const { header, rows } = parseCsv(eintrag.getData().toString('utf8'));
    if (!header.length) continue;
    ergebnis.set(name, { header, zeilen: rows.map((r) => header.map((h) => r[h] ?? '')) });
  }
  return ergebnis;
}

/**
 * INGAs kompletten Stand nach Perpustakaan schreiben – aber als Abgleich
 * gegen den TATSÄCHLICHEN Perpustakaan-Stand statt "alles löschen und neu
 * befüllen": nur Zeilen/Spalten, die sich unterscheiden, werden geschrieben.
 * Wichtig, weil Perpustakaan Daten hat, die INGA nicht kennt (Cover-Bilder
 * im Katalog, Schülerfotos bei den Lesern – BLOB-Spalten); ein Löschen und
 * Neubefüllen hätte sie unwiederbringlich entfernt.
 * Liefert { ok, stand, anzahl } bzw. das Fehlerergebnis der Brücke.
 */
async function komplettAbgleichen({ bridge, dbPfad, stand, tmpDir }) {
  const zip = path.join(tmpDir, `inga-perpustakaan-komplett-${process.pid}-${Date.now()}.zip`);
  try {
    const gelesen = await bridge.dump(dbPfad, zip);
    if (!gelesen.ok) return gelesen;
    const bloecke = berechneAenderungen(schnappschussAusZip(zip), stand);
    if (bloecke.length) {
      const ergebnis = await bridge.apply(dbPfad, bloecke);
      if (!ergebnis.ok) return ergebnis;
    }
    return { ok: true, anzahl: anzahlAenderungen(bloecke) };
  } finally {
    fs.unlink(zip, () => {});
  }
}

/**
 * @param {object} a Abhängigkeiten
 * @param {() => object} a.holeDb                   aktuelle better-sqlite3-Datenbank
 * @param {() => object} a.holeEinstellungen        INGA-Einstellungen (Leihfristen für Fälligkeiten)
 * @param {(db, opts) => Array} a.exportTabellen    csvio.exportTabellen
 * @param {(db, zip) => void} a.importZip           csvio.importZip
 * @param {object} a.bridge                         { dump(dbPfad, zip) → {ok,hash,gesperrt,fehler}, apply(dbPfad, bloecke) → {ok,konflikt,gesperrt,fehler} }
 * @param {() => boolean} a.sichereIngaDb           Sicherung der INGA-Datenbank (true = ok)
 * @param {(dbPfad) => boolean} a.sicherePerpustakaanDb  Sicherung des Perpustakaan-Ordners (true = ok)
 * @param {string} a.basisDatei                     wo der Abgleichstand gespeichert wird
 * @param {string} a.tmpDir
 * @param {(status) => void} [a.meldeStatus]
 * @param {() => void} [a.meldeDatenNeu]            nach dem Einlesen eines neuen Perpustakaan-Stands
 */
function erstellePerpustakaanModus(a) {
  let dbPfad = null;
  let basis = null;
  let letzterHash = null;
  let aktiv = false;
  let ingaGesichert = false;
  let warteschlange = Promise.resolve();
  let schreibTimer = null;
  let letzteAenderungsZahl = null;
  let status = { aktiv: false, zustand: 'aus' };

  function setzeStatus(neu) {
    status = { aktiv, dbPfad, ...neu };
    a.meldeStatus?.(status);
    return status;
  }

  /** Hintereinander statt gleichzeitig: nie zwei Zugriffe auf Perpustakaan zur selben Zeit. */
  function inReihe(aufgabe) {
    const lauf = warteschlange.then(aufgabe, aufgabe);
    warteschlange = lauf.catch(() => {});
    return lauf;
  }

  function aenderungsZahl() {
    try {
      return a.holeDb().prepare('SELECT total_changes() AS n').get().n;
    } catch {
      return null;
    }
  }

  function aktuellerStand() {
    return schnappschuss(a.exportTabellen(a.holeDb(), { einstellungen: a.holeEinstellungen() }));
  }

  function offeneAenderungen() {
    if (!basis) return [];
    return berechneAenderungen(basis, aktuellerStand());
  }

  function fehlerStatus(ergebnis, extra = {}) {
    if (ergebnis.gesperrt) {
      return setzeStatus({ zustand: 'gesperrt', text: 'Perpustakaan ist gerade geöffnet – INGA arbeitet mit seiner Kopie weiter und trägt Änderungen nach, sobald Perpustakaan geschlossen ist.', ...extra });
    }
    if (ergebnis.konflikt) return setzeStatus({ zustand: 'konflikt', text: ergebnis.fehler, ...extra });
    return setzeStatus({ zustand: 'fehler', text: ergebnis.fehler || 'unbekannter Fehler', laufzeitFehlt: Boolean(ergebnis.laufzeitFehlt), ...extra });
  }

  /** INGA → Perpustakaan: nur die Unterschiede zur Basis. true = alles geschrieben (oder nichts zu tun). */
  async function schreibeJetzt() {
    if (!aktiv || !basis) return false;
    const aktuell = aktuellerStand();
    const bloecke = berechneAenderungen(basis, aktuell);
    letzteAenderungsZahl = aenderungsZahl();
    if (!bloecke.length) return true;
    const anzahl = anzahlAenderungen(bloecke);
    setzeStatus({ zustand: 'schreibt', ausstehend: anzahl, text: `Schreibe ${anzahl} Änderung${anzahl === 1 ? '' : 'en'} in Perpustakaan …` });
    const ergebnis = await a.bridge.apply(dbPfad, bloecke);
    if (!ergebnis.ok) {
      fehlerStatus(ergebnis, { ausstehend: anzahl });
      return false;
    }
    basis = aktuell;
    letzterHash = null; // Perpustakaan hat sich (durch uns) verändert
    basisSpeichern(a.basisDatei, dbPfad, basis, letzterHash);
    setzeStatus({ zustand: 'synchron', ausstehend: 0, letzterAbgleich: new Date().toISOString(), text: 'Mit Perpustakaan abgeglichen.' });
    return true;
  }

  /**
   * Perpustakaan → INGA. Vorher werden eigene, noch nicht geschriebene
   * Änderungen nachgetragen – sonst würde das Einlesen sie überschreiben.
   * `verwerfen`: eigene Änderungen bewusst verwerfen (Konfliktlösung
   * "Perpustakaan-Stand übernehmen").
   */
  async function leseJetzt({ erzwingen = false, verwerfen = false } = {}) {
    if (!aktiv) return status;
    if (basis && !verwerfen) {
      const geschrieben = await schreibeJetzt();
      if (!geschrieben) return status;
    }
    const zip = path.join(a.tmpDir, `inga-perpustakaan-modus-${process.pid}-${Date.now()}.zip`);
    try {
      const ergebnis = await a.bridge.dump(dbPfad, zip);
      if (!ergebnis.ok) {
        const offen = basis ? anzahlAenderungen(offeneAenderungen()) : 0;
        return fehlerStatus(ergebnis, { ausstehend: offen });
      }
      if (!erzwingen && basis && ergebnis.hash && ergebnis.hash === letzterHash) {
        return setzeStatus({ zustand: 'synchron', ausstehend: 0, letzterAbgleich: new Date().toISOString(), text: 'Mit Perpustakaan abgeglichen.' });
      }
      // Während des (asynchronen) Lesens kann in INGA schon wieder etwas
      // geändert worden sein – dann NICHT einlesen (würde es überschreiben),
      // sondern beim nächsten Durchlauf zuerst schreiben.
      if (basis && !verwerfen && offeneAenderungen().length) {
        planeSchreiben(0);
        return status;
      }
      if (!ingaGesichert) {
        if (!a.sichereIngaDb()) {
          return setzeStatus({ zustand: 'fehler', text: 'Die Sicherung der INGA-Datenbank ist fehlgeschlagen – aus Sicherheitsgründen wurde nichts eingelesen.' });
        }
        ingaGesichert = true;
      }
      a.importZip(a.holeDb(), zip);
      basis = aktuellerStand();
      letzterHash = ergebnis.hash || null;
      letzteAenderungsZahl = aenderungsZahl();
      basisSpeichern(a.basisDatei, dbPfad, basis, letzterHash);
      a.meldeDatenNeu?.();
      return setzeStatus({ zustand: 'synchron', ausstehend: 0, letzterAbgleich: new Date().toISOString(), text: 'Mit Perpustakaan abgeglichen.' });
    } finally {
      fs.unlink(zip, () => {});
    }
  }

  function planeSchreiben(verzoegerungMs = 250) {
    if (!aktiv) return;
    clearTimeout(schreibTimer);
    schreibTimer = setTimeout(() => {
      // Bei einem Konflikt/Fehler nicht endlos weiter versuchen – das löst
      // die Person in den Einstellungen (übernehmen/komplett schreiben).
      if (status.zustand === 'konflikt' || status.zustand === 'fehler') return;
      inReihe(schreibeJetzt).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    }, verzoegerungMs);
  }

  return {
    /** Modus einschalten. Ohne gespeicherte Basis (erstmals) wird der komplette Perpustakaan-Stand übernommen. */
    starte(neuerDbPfad) {
      if (aktiv && dbPfad === neuerDbPfad) return inReihe(() => leseJetzt());
      aktiv = true;
      dbPfad = neuerDbPfad;
      const geladen = basisLaden(a.basisDatei, dbPfad);
      basis = geladen?.basis || null;
      letzterHash = geladen?.hash || null;
      setzeStatus({ zustand: 'verbinde', text: 'Verbinde mit Perpustakaan …' });
      if (!a.sicherePerpustakaanDb(dbPfad)) {
        return Promise.resolve(setzeStatus({ zustand: 'fehler', text: 'Die Sicherung der Perpustakaan-Datenbank ist fehlgeschlagen – aus Sicherheitsgründen kein Zugriff.' }));
      }
      return inReihe(() => leseJetzt()).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    },

    /**
     * Modus ausschalten: vorher Ausstehendes noch schreiben (so gut es geht),
     * dann den Abgleichstand verwerfen – wird der Modus später wieder
     * eingeschaltet, übernimmt INGA wie beim ersten Mal den Perpustakaan-Stand,
     * statt zwischenzeitliche INGA-Änderungen (etwa einen Import) ungefragt
     * nach Perpustakaan zu schreiben.
     */
    async stoppe() {
      if (aktiv && basis && status.zustand !== 'konflikt' && status.zustand !== 'fehler') {
        clearTimeout(schreibTimer);
        await inReihe(schreibeJetzt).catch(() => {});
      }
      aktiv = false;
      clearTimeout(schreibTimer);
      basis = null;
      letzterHash = null;
      try { fs.rmSync(a.basisDatei, { force: true }); } catch (err) { console.error('[perpustakaan-modus] Abgleichstand ließ sich nicht löschen:', err.message); }
      return setzeStatus({ zustand: 'aus' });
    },

    /** Nach jedem Vorgang in INGA aufrufen – schreibt nur, wenn sich in der Datenbank wirklich etwas geändert hat. */
    nachVorgang() {
      if (!aktiv || !basis) return;
      const n = aenderungsZahl();
      if (n !== null && n === letzteAenderungsZahl) return;
      planeSchreiben();
    },

    /** Perpustakaan → INGA (Fenster im Vordergrund, regelmäßiger Takt, Knopf "Jetzt abgleichen"). */
    aktualisiere({ erzwingen = false } = {}) {
      if (!aktiv) return Promise.resolve(status);
      return inReihe(() => leseJetzt({ erzwingen })).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    },

    /** Konfliktlösung 1: eigene, nicht geschriebene INGA-Änderungen verwerfen und den Perpustakaan-Stand übernehmen (INGA wird vorher gesichert). */
    perpustakaanUebernehmen() {
      if (!aktiv) return Promise.resolve(status);
      ingaGesichert = false; // vor dem Verwerfen auf jeden Fall frisch sichern
      return inReihe(() => leseJetzt({ erzwingen: true, verwerfen: true })).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    },

    /** Konfliktlösung 2: INGAs kompletten Stand nach Perpustakaan schreiben (Perpustakaan wird vorher gesichert). */
    ingaKomplettSchreiben() {
      if (!aktiv) return Promise.resolve(status);
      return inReihe(async () => {
        if (!a.sicherePerpustakaanDb(dbPfad)) {
          return setzeStatus({ zustand: 'fehler', text: 'Die Sicherung der Perpustakaan-Datenbank ist fehlgeschlagen – aus Sicherheitsgründen wurde nichts geschrieben.' });
        }
        const aktuell = aktuellerStand();
        const ergebnis = await komplettAbgleichen({ bridge: a.bridge, dbPfad, stand: aktuell, tmpDir: a.tmpDir });
        if (!ergebnis.ok) return fehlerStatus(ergebnis);
        basis = aktuell;
        letzterHash = null;
        letzteAenderungsZahl = aenderungsZahl();
        basisSpeichern(a.basisDatei, dbPfad, basis, letzterHash);
        return setzeStatus({ zustand: 'synchron', ausstehend: 0, letzterAbgleich: new Date().toISOString(), text: 'INGA-Stand komplett in Perpustakaan geschrieben.' });
      }).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    },

    /** Erneut versuchen nach einem Fehler (nicht bei einem Konflikt). */
    erneutVersuchen() {
      if (!aktiv) return Promise.resolve(status);
      return inReihe(() => leseJetzt()).catch((err) => setzeStatus({ zustand: 'fehler', text: err.message }));
    },

    /** Vor dem Beenden: noch Ausstehendes schreiben (so gut es geht) – liefert die Zahl der NICHT geschriebenen Änderungen. */
    async abschliessen() {
      if (!aktiv || !basis) return 0;
      clearTimeout(schreibTimer);
      await inReihe(schreibeJetzt).catch(() => {});
      return anzahlAenderungen(offeneAenderungen());
    },

    status: () => status,
    istAktiv: () => aktiv,
    /** Anzahl der noch nicht nach Perpustakaan geschriebenen Änderungen. */
    ausstehend: () => (aktiv && basis ? anzahlAenderungen(offeneAenderungen()) : 0),
  };
}

module.exports = { erstellePerpustakaanModus, berechneAenderungen, schnappschuss, schnappschussAusZip, komplettAbgleichen, anzahlAenderungen, NICHT_ABGLEICHEN };
