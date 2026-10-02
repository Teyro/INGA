'use strict';

/**
 * INGA 2.0: Schuljahreswechsel, Inventur, Leseausweise, Schäden, Vormerkungs-
 * zettel, Erinnerungen vor der Fälligkeit, Rückstand pro Klasse, Lesepass,
 * Antolin, Neuerwerbungen, Empfehlungen, Anschaffungen/Budget, Jahresbericht
 * und Datenschutz.
 *
 * Alles, was es in Perpustakaan nicht gibt (Schäden, Inventur, Anschaffungen,
 * Budget), liegt in eigenen inga_*-Tabellen (Migration 11 in db.js) – der
 * Perpustakaan-Abgleich und -Export fasst sie nicht an.
 */

const repo = require('./repo');
const ferien = require('./ferien');
const { quoteIdent } = require('./db');
const { heuteISO, heuteStamp, jetztStamp, addTage, tageDifferenz } = require('./date-utils');
const { klasseVon, klasseAusText, gruppenNamen, mitKlassen, schuljahrVon, schuljahrZeitraum, schuljahrWeiter, lehrkraftAusGruppe } = require('./klassen');

const ni = (x) => (x === null || x === undefined || x === '' ? x : Number(x));

/** Vorname ohne angehängte Klasse ("Glenn Asuming 4c" → "Glenn Asuming"). */
function vornameOhneKlasse(vorname) {
  return String(vorname ?? '').replace(/\s+(?:Kl(?:asse|\.)?\s*)?[1-9]\s?[a-z]$/i, '').trim();
}

function leserMitKlasse(db, leserNi) {
  const l = repo.getLeser(db, ni(leserNi));
  if (!l) return null;
  return mitKlassen(db, [l])[0];
}

/** Grund "nicht verfügbar" (Stammdaten Nichtverf) mit dieser Bezeichnung – legt ihn bei Bedarf an. */
function nichtVerfuegbarGrund(db, bezeichnung) {
  const vorhanden = db.prepare(`SELECT "NichtVfNi" FROM "Nichtverf" WHERE lower("NichtVfBz") = lower(?)`).get(bezeichnung);
  if (vorhanden) return vorhanden.NichtVfNi;
  const naechste = (db.prepare(`SELECT MAX(CAST("NichtVfNi" AS INTEGER)) AS m FROM "Nichtverf"`).get().m || 0) + 1;
  db.prepare(`INSERT INTO "Nichtverf" ("NichtVfNi", "NichtVfBz", "Frist", "FristVerl", "position") VALUES (?, ?, 0, 0, ?)`).run(naechste, bezeichnung, naechste);
  return naechste;
}

/* ================================================================ Schäden */

function schadenErfassen(db, { medienNi, leserNi, beschreibung, schwere, nichtVerfuegbar }) {
  const text = String(beschreibung ?? '').trim();
  if (!text) throw new Error('Bitte kurz beschreiben, was beschädigt ist.');
  db.transaction(() => {
    db.prepare(`INSERT INTO inga_schaeden ("MedienNi", "LeserNi", datum, beschreibung, schwere, erledigt) VALUES (?, ?, ?, ?, ?, 0)`)
      .run(ni(medienNi), leserNi ? ni(leserNi) : null, jetztStamp(), text, schwere || 'leicht');
    if (nichtVerfuegbar) {
      db.prepare(`UPDATE "Medien" SET "NichtVfNi" = ? WHERE "MedienNi" = ?`).run(nichtVerfuegbarGrund(db, 'Beschädigt'), ni(medienNi));
    }
  })();
}

function schaedenFuerKatalog(db, katalogNi) {
  return db.prepare(
    `SELECT s.*, m."MedienEtik", l."Nachname", l."Vorname" FROM inga_schaeden s
     JOIN "Medien" m ON m."MedienNi" = s."MedienNi"
     LEFT JOIN "Leser" l ON l."LeserNi" = s."LeserNi"
     WHERE m."KatalogNi" = ? ORDER BY s.datum DESC`
  ).all(ni(katalogNi));
}

function schadenErledigt(db, id, erledigt = true) {
  db.prepare(`UPDATE inga_schaeden SET erledigt = ? WHERE id = ?`).run(erledigt ? 1 : 0, ni(id));
}

/* ================================================================ Vormerkung nach Rückgabe */

/** Wartet für das Buch dieser (gerade zurückgegebenen) Ausleihe jemand? Dann die erste Vormerkung mit allem für den Zettel. */
function vormerkungNachRueckgabe(db, ausleiheId) {
  const a = db.prepare(
    `SELECT a.*, m."MedienEtik", m."KatalogNi", k."Titel", k."Autor" FROM "Ausleihe" a
     JOIN "Medien" m ON m."MedienNi" = a."MedienNi" JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
     WHERE a.id = ?`
  ).get(ni(ausleiheId));
  if (!a) return null;
  const v = repo.vormerkungenFuer(db, a.KatalogNi).find((x) => String(x.LeserNi) !== String(a.LeserNi));
  if (!v) return null;
  const leser = leserMitKlasse(db, v.LeserNi);
  return {
    titel: a.Titel, autor: a.Autor, etikett: a.MedienEtik,
    nachname: v.Nachname, vorname: vornameOhneKlasse(v.Vorname), klasse: leser?.klasse?.kuerzel || '',
    vorgemerktAm: v.VormerkDat, datum: heuteISO(),
  };
}

/* ================================================================ Erinnerung vor Fälligkeit */

function baldFaellig(db, einstellungen, tage = 3) {
  const heute = heuteISO();
  const ferienListe = ferien.listeFerien(db);
  const gruppen = gruppenNamen(db);
  const gruppeVon = new Map(db.prepare(`SELECT "LeserNi", "LeserGruNi" FROM "Leser"`).all().map((r) => [String(r.LeserNi), r.LeserGruNi]));
  return repo.alleOffenenAusleihen(db)
    .map((a) => ({ ...a, faelligAm: repo.berechneRueckgabedatumAusRow(a, einstellungen, ferienListe).datum }))
    .filter((a) => {
      const rest = tageDifferenz(heute, a.faelligAm);
      return rest >= 0 && rest <= tage;
    })
    .map((a) => {
      const klasse = klasseVon(a, gruppen.get(String(gruppeVon.get(String(a.LeserNi)))));
      return { ...a, Vorname: vornameOhneKlasse(a.Vorname), klasse: klasse?.kuerzel || '', lehrkraft: klasse?.lehrkraft || '', resttage: tageDifferenz(heute, a.faelligAm) };
    })
    .sort((x, y) => (x.klasse || 'zzz').localeCompare(y.klasse || 'zzz') || String(x.Nachname).localeCompare(String(y.Nachname)));
}

/* ================================================================ Rückstand pro Klasse */

function rueckstandProKlasse(db, einstellungen, schwelleTage = 1) {
  const gruppen = gruppenNamen(db);
  const leser = new Map(db.prepare(`SELECT "LeserNi", "LeserGruNi", "Jahrgang", "Vorname" FROM "Leser"`).all().map((r) => [String(r.LeserNi), r]));
  const nachKlasse = new Map();
  for (const a of repo.rueckstandsliste(db, einstellungen, schwelleTage)) {
    const l = leser.get(String(a.LeserNi)) || a;
    const klasse = klasseVon(l, gruppen.get(String(l.LeserGruNi)));
    const schluessel = klasse?.kuerzel || 'ohne Klasse';
    if (!nachKlasse.has(schluessel)) nachKlasse.set(schluessel, { klasse: schluessel, lehrkraft: klasse?.lehrkraft || '', zeilen: [] });
    nachKlasse.get(schluessel).zeilen.push({
      Nachname: a.Nachname, Vorname: vornameOhneKlasse(a.Vorname), Titel: a.Titel, MedienEtik: a.MedienEtik,
      AuslDatum: a.AuslDatum, faelligAm: a.faelligAm, tageUeberfaellig: a.tageUeberfaellig,
      letzteMahnung: a.letzteMahnung?.datum || null,
    });
  }
  return [...nachKlasse.values()].sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }));
}

/* ================================================================ Lesepass */

/** Gelesene (zurückgegebene) Bücher je Kind im Schuljahr, mit erreichter Stufe. */
function lesepass(db, { schuljahr, klasse, stufen = [5, 10, 20] } = {}) {
  const sj = schuljahr || schuljahrVon(heuteISO());
  const { von, bis } = schuljahrZeitraum(sj);
  const rows = db.prepare(
    `SELECT a."LeserNi", m."KatalogNi", k."Titel", MAX(a."AuslDatum") AS datum FROM "Ausleihe" a
     JOIN "Medien" m ON m."MedienNi" = a."MedienNi" JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
     WHERE a."Rueckgabe" IS NOT NULL AND substr(a."AuslDatum", 1, 10) BETWEEN ? AND ?
     GROUP BY a."LeserNi", m."KatalogNi" ORDER BY datum`
  ).all(von, bis);
  const proLeser = new Map();
  for (const r of rows) {
    if (!proLeser.has(String(r.LeserNi))) proLeser.set(String(r.LeserNi), []);
    proLeser.get(String(r.LeserNi)).push({ titel: r.Titel, datum: r.datum });
  }
  const leser = mitKlassen(db, db.prepare(`SELECT * FROM "Leser" ORDER BY "Nachname", "Vorname"`).all());
  const namen = ['Bronze', 'Silber', 'Gold'];
  return leser
    .map((l) => {
      const buecher = proLeser.get(String(l.LeserNi)) || [];
      const erreicht = stufen.filter((s) => buecher.length >= s).length;
      return {
        LeserNi: l.LeserNi, Nachname: l.Nachname, Vorname: vornameOhneKlasse(l.Vorname), klasse: l.klasse?.kuerzel || '',
        anzahl: buecher.length, buecher, stufe: erreicht ? namen[erreicht - 1] || `Stufe ${erreicht}` : null,
        naechsteStufe: stufen[erreicht] ?? null,
      };
    })
    .filter((l) => !klasse || l.klasse === klasse)
    .filter((l) => klasse || l.anzahl > 0)
    .sort((a, b) => b.anzahl - a.anzahl || a.Nachname.localeCompare(b.Nachname));
}

/* ================================================================ Antolin, Neuerwerbungen, Empfehlungen */

function mitVerfuegbarkeit(db, buecher) {
  const zaehle = db.prepare(
    `SELECT COUNT(*) AS gesamt, SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL) THEN 1 ELSE 0 END) AS frei
     FROM "Medien" m WHERE m."KatalogNi" = ?`
  );
  return buecher.map((b) => { const z = zaehle.get(b.KatalogNi); return { ...b, exemplare: z.gesamt || 0, verfuegbar: z.frei || 0 }; });
}

function antolinBuecher(db, stufe) {
  const alle = db.prepare(`SELECT "KatalogNi", "Titel", "Autor", "KlasseAnto" FROM "Katalog" WHERE trim(COALESCE("KlasseAnto", '')) != '' ORDER BY "Titel"`).all();
  const gefiltert = stufe ? alle.filter((b) => String(b.KlasseAnto).includes(String(stufe))) : alle;
  return mitVerfuegbarkeit(db, gefiltert);
}

function neuerwerbungen(db, tage = 60, limit = 48) {
  const ab = addTage(heuteISO(), -Math.max(1, Number(tage) || 60));
  return mitVerfuegbarkeit(db, db.prepare(
    `SELECT "KatalogNi", "Titel", "Autor", "ErfassDat" FROM "Katalog" WHERE substr(COALESCE("ErfassDat", ''), 1, 10) >= ? ORDER BY "ErfassDat" DESC, "Titel" LIMIT ?`
  ).all(ab, limit));
}

/** "Wer dieses Buch las, las auch …" – aus der Ausleihhistorie; zu wenig Daten → gleiche Autorin/Systematik. */
function empfehlungen(db, katalogNi, limit = 6) {
  const k = ni(katalogNi);
  const treffer = db.prepare(
    `SELECT k2."KatalogNi", k2."Titel", k2."Autor", COUNT(DISTINCT a2."LeserNi") AS leser
     FROM "Ausleihe" a1 JOIN "Medien" m1 ON m1."MedienNi" = a1."MedienNi"
     JOIN "Ausleihe" a2 ON a2."LeserNi" = a1."LeserNi" JOIN "Medien" m2 ON m2."MedienNi" = a2."MedienNi"
     JOIN "Katalog" k2 ON k2."KatalogNi" = m2."KatalogNi"
     WHERE m1."KatalogNi" = ? AND m2."KatalogNi" != ?
     GROUP BY k2."KatalogNi" ORDER BY leser DESC, k2."Titel" LIMIT ?`
  ).all(k, k, limit).map((r) => ({ ...r, grund: `${r.leser} Kind${r.leser === 1 ? '' : 'er'} lasen auch das` }));
  if (treffer.length < limit) {
    const buch = repo.getKatalog(db, k);
    if (buch) {
      const schon = new Set([k, ...treffer.map((t) => t.KatalogNi)]);
      const aehnlich = db.prepare(
        `SELECT "KatalogNi", "Titel", "Autor", CASE WHEN "Autor" = ? AND "Autor" != '' THEN 'gleiche Autorin / gleicher Autor' ELSE 'gleiche Kategorie' END AS grund
         FROM "Katalog" WHERE ("Autor" = ? AND COALESCE("Autor", '') != '') OR ("SystemId" = ? AND COALESCE("SystemId", '') != '')
         ORDER BY CASE WHEN "Autor" = ? THEN 0 ELSE 1 END, "Titel" LIMIT 40`
      ).all(buch.Autor, buch.Autor, buch.SystemId, buch.Autor);
      for (const a of aehnlich) {
        if (treffer.length >= limit) break;
        if (!schon.has(a.KatalogNi)) { treffer.push(a); schon.add(a.KatalogNi); }
      }
    }
  }
  return mitVerfuegbarkeit(db, treffer);
}

/** Lesetipps für ein Kind: Empfehlungen zu seinen letzten Büchern, ohne schon Gelesenes. */
function lesetippsFuerLeser(db, leserNi, limit = 6) {
  const gelesen = db.prepare(
    `SELECT DISTINCT m."KatalogNi" FROM "Ausleihe" a JOIN "Medien" m ON m."MedienNi" = a."MedienNi" WHERE a."LeserNi" = ? ORDER BY a."AuslDatum" DESC`
  ).all(ni(leserNi)).map((r) => r.KatalogNi);
  if (!gelesen.length) return [];
  const schon = new Set(gelesen);
  const punkte = new Map();
  for (const k of gelesen.slice(0, 8)) {
    for (const e of empfehlungen(db, k, 8)) {
      if (schon.has(e.KatalogNi)) continue;
      const alt = punkte.get(e.KatalogNi) || { ...e, punkte: 0 };
      alt.punkte += e.leser || 0.5;
      punkte.set(e.KatalogNi, alt);
    }
  }
  return [...punkte.values()].sort((a, b) => b.punkte - a.punkte || b.verfuegbar - a.verfuegbar).slice(0, limit);
}

/* ================================================================ Anschaffungen & Budget */

const STATUS = ['wunsch', 'bestellt', 'geliefert', 'abgelehnt'];

function anschaffungen(db, { status } = {}) {
  const rows = db.prepare(`SELECT * FROM inga_anschaffungen ORDER BY CASE status WHEN 'wunsch' THEN 0 WHEN 'bestellt' THEN 1 WHEN 'geliefert' THEN 2 ELSE 3 END, erstellt DESC`).all();
  return status ? rows.filter((r) => r.status === status) : rows;
}

function anschaffungSpeichern(db, row) {
  const titel = String(row.titel ?? '').trim();
  if (!titel) throw new Error('Bitte einen Titel angeben.');
  const status = STATUS.includes(row.status) ? row.status : 'wunsch';
  const werte = {
    titel, autor: row.autor || '', isbn: row.isbn || '', wunsch_von: row.wunsch_von || '', notiz: row.notiz || '',
    status, preis: row.preis === '' || row.preis === null || row.preis === undefined ? null : Number(String(row.preis).replace(',', '.')) || 0,
    anzahl: Math.max(1, Number(row.anzahl) || 1),
  };
  if (row.id) {
    const alt = db.prepare(`SELECT * FROM inga_anschaffungen WHERE id = ?`).get(ni(row.id));
    if (!alt) throw new Error('Diesen Eintrag gibt es nicht mehr.');
    const bestellt = status === 'bestellt' && !alt.bestellt_am ? heuteISO() : alt.bestellt_am;
    const geliefert = status === 'geliefert' && !alt.geliefert_am ? heuteISO() : alt.geliefert_am;
    db.prepare(`UPDATE inga_anschaffungen SET titel=@titel, autor=@autor, isbn=@isbn, wunsch_von=@wunsch_von, notiz=@notiz, status=@status, preis=@preis, anzahl=@anzahl, bestellt_am=@bestellt_am, geliefert_am=@geliefert_am WHERE id=@id`)
      .run({ ...werte, id: ni(row.id), bestellt_am: bestellt || (status === 'geliefert' ? heuteISO() : null), geliefert_am: geliefert });
    return ni(row.id);
  }
  return db.prepare(`INSERT INTO inga_anschaffungen (titel, autor, isbn, wunsch_von, notiz, status, preis, anzahl, erstellt, bestellt_am, geliefert_am)
    VALUES (@titel, @autor, @isbn, @wunsch_von, @notiz, @status, @preis, @anzahl, @erstellt, @bestellt_am, @geliefert_am)`)
    .run({ ...werte, erstellt: heuteISO(), bestellt_am: status === 'bestellt' || status === 'geliefert' ? heuteISO() : null, geliefert_am: status === 'geliefert' ? heuteISO() : null })
    .lastInsertRowid;
}

function anschaffungLoeschen(db, id) {
  db.prepare(`DELETE FROM inga_anschaffungen WHERE id = ?`).run(ni(id));
}

/** Budget eines Schuljahres: festgelegter Betrag, ausgegeben (bestellt + geliefert), noch frei. */
function budget(db, schuljahr) {
  const sj = schuljahr || schuljahrVon(heuteISO());
  const { von, bis } = schuljahrZeitraum(sj);
  const betrag = db.prepare(`SELECT betrag FROM inga_budget WHERE schuljahr = ?`).get(sj)?.betrag ?? null;
  const ausgegeben = db.prepare(
    `SELECT COALESCE(SUM(COALESCE(preis, 0) * COALESCE(anzahl, 1)), 0) AS s FROM inga_anschaffungen
     WHERE status IN ('bestellt', 'geliefert') AND COALESCE(bestellt_am, erstellt) BETWEEN ? AND ?`
  ).get(von, bis).s;
  const geplant = db.prepare(`SELECT COALESCE(SUM(COALESCE(preis, 0) * COALESCE(anzahl, 1)), 0) AS s FROM inga_anschaffungen WHERE status = 'wunsch'`).get().s;
  return { schuljahr: sj, betrag, ausgegeben, frei: betrag === null ? null : betrag - ausgegeben, geplant };
}

function budgetSetzen(db, schuljahr, betrag) {
  const sj = schuljahr || schuljahrVon(heuteISO());
  const wert = betrag === '' || betrag === null ? null : Number(String(betrag).replace(',', '.'));
  if (wert === null) db.prepare(`DELETE FROM inga_budget WHERE schuljahr = ?`).run(sj);
  else db.prepare(`INSERT INTO inga_budget (schuljahr, betrag) VALUES (?, ?) ON CONFLICT(schuljahr) DO UPDATE SET betrag = excluded.betrag`).run(sj, wert);
  return budget(db, sj);
}

/* ================================================================ Inventur */

function aktiveInventur(db) {
  return db.prepare(`SELECT * FROM inga_inventur WHERE abgeschlossen IS NULL ORDER BY id DESC LIMIT 1`).get() || null;
}

function inventurStarten(db, { standortNi } = {}) {
  if (aktiveInventur(db)) throw new Error('Es läuft bereits eine Inventur – bitte erst abschließen oder abbrechen.');
  db.prepare(`INSERT INTO inga_inventur (gestartet, standort) VALUES (?, ?)`).run(jetztStamp(), standortNi ? ni(standortNi) : null);
  return inventurStand(db);
}

function erwarteteExemplare(db, inventur) {
  // Erwartet im Regal: alle Exemplare (ggf. eines Standorts), die gerade NICHT ausgeliehen sind.
  return db.prepare(
    `SELECT m."MedienNi", m."MedienEtik", m."NichtVfNi", k."Titel", k."Autor", k."KatalogNi" FROM "Medien" m
     JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
     WHERE (? IS NULL OR m."StOrtNi" = ?)
       AND NOT EXISTS (SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = m."MedienNi" AND a."Rueckgabe" IS NULL)
     ORDER BY k."Titel"`
  ).all(inventur.standort, inventur.standort);
}

function inventurScan(db, etikett) {
  const inv = aktiveInventur(db);
  if (!inv) throw new Error('Keine Inventur gestartet.');
  const code = String(etikett ?? '').trim();
  const m = db.prepare(
    `SELECT m.*, k."Titel" FROM "Medien" m JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi" WHERE m."MedienEtik" = ?`
  ).get(code);
  if (!m) return { status: 'unbekannt', etikett: code };
  const offen = db.prepare(`SELECT 1 FROM "Ausleihe" WHERE "MedienNi" = ? AND "Rueckgabe" IS NULL`).get(m.MedienNi);
  const doppelt = db.prepare(`SELECT 1 FROM inga_inventur_scan WHERE inventur_id = ? AND "MedienNi" = ?`).get(inv.id, m.MedienNi);
  if (!doppelt) db.prepare(`INSERT INTO inga_inventur_scan (inventur_id, "MedienNi", zeit) VALUES (?, ?, ?)`).run(inv.id, m.MedienNi, jetztStamp());
  return {
    status: doppelt ? 'doppelt' : offen ? 'ausgeliehen' : (Number(m.NichtVfNi) || 0) !== 0 ? 'wiedergefunden' : 'ok',
    titel: m.Titel, etikett: m.MedienEtik, medienNi: m.MedienNi,
  };
}

function inventurStand(db) {
  const inv = aktiveInventur(db);
  if (!inv) return { aktiv: false };
  const erwartet = erwarteteExemplare(db, inv);
  const gescannt = new Set(db.prepare(`SELECT "MedienNi" FROM inga_inventur_scan WHERE inventur_id = ?`).all(inv.id).map((r) => String(r.MedienNi)));
  const fehlend = erwartet.filter((m) => !gescannt.has(String(m.MedienNi)));
  return { aktiv: true, inventur: inv, erwartet: erwartet.length, gescannt: gescannt.size, fehlend };
}

/** Abschließen: nicht gefundene Exemplare auf Wunsch als "Vermisst (Inventur)" markieren, wiedergefundene wieder freigeben. */
function inventurAbschliessen(db, { fehlendeAlsVermisst = true } = {}) {
  const stand = inventurStand(db);
  if (!stand.aktiv) throw new Error('Keine Inventur gestartet.');
  let vermisst = 0;
  let wiedergefunden = 0;
  db.transaction(() => {
    if (fehlendeAlsVermisst && stand.fehlend.length) {
      const grund = nichtVerfuegbarGrund(db, 'Vermisst (Inventur)');
      const setze = db.prepare(`UPDATE "Medien" SET "NichtVfNi" = ? WHERE "MedienNi" = ?`);
      for (const m of stand.fehlend) { setze.run(grund, m.MedienNi); vermisst++; }
    }
    // Als vermisst geführt, aber jetzt im Regal gefunden → wieder verfügbar.
    const vermisstGrund = db.prepare(`SELECT "NichtVfNi" FROM "Nichtverf" WHERE lower("NichtVfBz") = lower('Vermisst (Inventur)')`).get()?.NichtVfNi;
    if (vermisstGrund) {
      wiedergefunden = db.prepare(
        `UPDATE "Medien" SET "NichtVfNi" = 0 WHERE "NichtVfNi" = ? AND "MedienNi" IN (SELECT "MedienNi" FROM inga_inventur_scan WHERE inventur_id = ?)`
      ).run(vermisstGrund, stand.inventur.id).changes;
    }
    db.prepare(`UPDATE inga_inventur SET abgeschlossen = ? WHERE id = ?`).run(jetztStamp(), stand.inventur.id);
  })();
  return { vermisst, wiedergefunden, fehlend: stand.fehlend, erwartet: stand.erwartet, gescannt: stand.gescannt };
}

function inventurAbbrechen(db) {
  const inv = aktiveInventur(db);
  if (!inv) return;
  db.transaction(() => {
    db.prepare(`DELETE FROM inga_inventur_scan WHERE inventur_id = ?`).run(inv.id);
    db.prepare(`DELETE FROM inga_inventur WHERE id = ?`).run(inv.id);
  })();
}

/* ================================================================ Leseausweise */

function ausweisDaten(db, { leserNis, klasse } = {}) {
  let leser = mitKlassen(db, db.prepare(`SELECT * FROM "Leser" ORDER BY "Nachname", "Vorname"`).all());
  if (Array.isArray(leserNis) && leserNis.length) {
    const set = new Set(leserNis.map(String));
    leser = leser.filter((l) => set.has(String(l.LeserNi)));
  }
  if (klasse) leser = leser.filter((l) => l.klasse?.kuerzel === klasse);
  return leser
    .map((l) => ({
      LeserNi: l.LeserNi, nachname: l.Nachname || '', vorname: vornameOhneKlasse(l.Vorname), klasse: l.klasse?.kuerzel || '',
      nummer: String(l.AusweisId || l.Kuerzel || l.LeserNi).trim(),
    }))
    .sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }) || a.nachname.localeCompare(b.nachname));
}

/** Alle erkannten Klassen (für Auswahllisten). */
function klassenListe(db) {
  const leser = mitKlassen(db, db.prepare(`SELECT "LeserNi", "Jahrgang", "Vorname", "LeserGruNi" FROM "Leser"`).all());
  const zaehler = new Map();
  for (const l of leser) if (l.klasse) zaehler.set(l.klasse.kuerzel, (zaehler.get(l.klasse.kuerzel) || 0) + 1);
  return [...zaehler.entries()].map(([klasse, anzahl]) => ({ klasse, anzahl })).sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true }));
}

/* ================================================================ Schuljahreswechsel */

/**
 * Plant den Wechsel ins nächste Schuljahr, ohne etwas zu ändern:
 *  - Gruppen mit Klasse im Namen werden hochgezählt ("1c Fr. Brücker 26/27" →
 *    "2c Fr. Brücker 27/28"); die Lehrkraft geht mit ihrer Klasse mit. Gruppen der
 *    Abschlussstufe werden zu neuen 1. Klassen (die Lehrkraft übernimmt die neuen
 *    Erstklässler) – oder bleiben, wenn das abgewählt ist.
 *  - Kinder mit Klasse im Feld "Jahrgang" bzw. am Vornamen werden hochgezählt.
 *  - Kinder der Abschlussstufe gehen in den Papierkorb – außer mit offenen
 *    Ausleihen: die bleiben, aus ihrer Gruppe gelöst, mit "Abgang <Schuljahr>".
 */
function schuljahreswechselPlan(db, einstellungen, { neueErsteKlassen = true, vornamenAnpassen = true } = {}) {
  const abschluss = Number(einstellungen.abschlussKlassenstufe) || 4;
  const gruppen = db.prepare(`SELECT "LeserGruNi", "LeserGruBz" FROM "LeserGrupp" ORDER BY "LeserGruBz"`).all();
  const gruppenPlan = gruppen.map((g) => {
    const k = klasseAusText(g.LeserGruBz);
    if (!k) return { ...g, neu: g.LeserGruBz, art: 'unveraendert' };
    const ersetzeKlasse = (neueStufe) => g.LeserGruBz.replace(/^((?:Kl(?:asse|\.)?\s*)?)[1-9](\s?[a-z]?)/i, `$1${neueStufe}$2`);
    if (k.stufe >= abschluss) {
      return neueErsteKlassen
        ? { ...g, neu: schuljahrWeiter(ersetzeKlasse(1)), art: 'neue1' }
        : { ...g, neu: g.LeserGruBz, art: 'abschluss' };
    }
    return { ...g, neu: schuljahrWeiter(ersetzeKlasse(k.stufe + 1)), art: 'hoch' };
  });

  const gruppenNamenMap = new Map(gruppen.map((g) => [String(g.LeserGruNi), g.LeserGruBz]));
  const offen = new Set(db.prepare(`SELECT DISTINCT "LeserNi" FROM "Ausleihe" WHERE "Rueckgabe" IS NULL`).all().map((r) => String(r.LeserNi)));
  const leser = db.prepare(`SELECT * FROM "Leser" ORDER BY "Nachname", "Vorname"`).all();
  const abgaenger = [];
  const aenderungen = [];
  const ohneKlasse = [];
  for (const l of leser) {
    const k = klasseVon(l, gruppenNamenMap.get(String(l.LeserGruNi)));
    if (!k) { ohneKlasse.push({ LeserNi: l.LeserNi, name: `${l.Nachname}, ${l.Vorname}` }); continue; }
    const name = `${l.Nachname}, ${vornameOhneKlasse(l.Vorname)}`;
    if (k.stufe >= abschluss) {
      abgaenger.push({ LeserNi: l.LeserNi, name, klasse: k.kuerzel, offeneAusleihen: offen.has(String(l.LeserNi)) });
      continue;
    }
    const neu = `${k.stufe + 1}${k.buchstabe}`;
    const patch = {};
    if (k.quelle === 'jahrgang') patch.Jahrgang = String(l.Jahrgang).replace(/^((?:Kl(?:asse|\.)?\s*)?)[1-9]/i, `$1${k.stufe + 1}`);
    const amVornamen = klasseAusText(l.Vorname, { amEnde: true });
    if (vornamenAnpassen && amVornamen && amVornamen.kuerzel === k.kuerzel) {
      patch.Vorname = String(l.Vorname).replace(/([1-9])(\s?[a-z])$/i, `${k.stufe + 1}$2`);
    }
    aenderungen.push({ LeserNi: l.LeserNi, name, von: k.kuerzel, nach: neu, quelle: k.quelle, patch });
  }
  return {
    schuljahr: schuljahrVon(heuteISO()), abschlussStufe: abschluss,
    gruppen: gruppenPlan.filter((g) => g.art !== 'unveraendert'),
    gruppenUnveraendert: gruppenPlan.filter((g) => g.art === 'unveraendert'),
    aenderungen, abgaenger, ohneKlasse,
  };
}

function schuljahreswechselAusfuehren(db, einstellungen, optionen = {}) {
  const plan = schuljahreswechselPlan(db, einstellungen, optionen);
  const ergebnis = { gruppen: 0, kinder: 0, papierkorb: 0, behalten: [] };
  db.transaction(() => {
    // Erst die Abgänger (sie hängen noch an ihren alten Gruppen).
    const ohneOffene = plan.abgaenger.filter((a) => !a.offeneAusleihen).map((a) => a.LeserNi);
    const r = repo.kinderInPapierkorbVerschieben(db, ohneOffene, 'Schuljahreswechsel');
    ergebnis.papierkorb = r.verschoben;
    const abgang = `Abgang ${plan.schuljahr}`;
    const loese = db.prepare(`UPDATE "Leser" SET "LeserGruNi" = 0, "Jahrgang" = ? WHERE "LeserNi" = ?`);
    for (const a of plan.abgaenger.filter((x) => x.offeneAusleihen)) {
      loese.run(abgang, a.LeserNi);
      ergebnis.behalten.push(a);
    }
    for (const u of r.uebersprungen) ergebnis.behalten.push({ name: u.name, grund: u.grund });
    const umbenennen = db.prepare(`UPDATE "LeserGrupp" SET "LeserGruBz" = ? WHERE "LeserGruNi" = ?`);
    for (const g of plan.gruppen) {
      if (g.neu !== g.LeserGruBz) { umbenennen.run(g.neu, g.LeserGruNi); ergebnis.gruppen++; }
    }
    for (const a of plan.aenderungen) {
      const spalten = Object.keys(a.patch);
      if (!spalten.length) continue;
      db.prepare(`UPDATE "Leser" SET ${spalten.map((s) => `${quoteIdent(s)} = ?`).join(', ')} WHERE "LeserNi" = ?`).run(...spalten.map((s) => a.patch[s]), a.LeserNi);
      ergebnis.kinder++;
    }
    db.prepare(`INSERT OR REPLACE INTO inga_meta (key, value) VALUES ('letzter_schuljahreswechsel', ?)`).run(jetztStamp());
  })();
  ergebnis.kinderGesamt = plan.aenderungen.length;
  return ergebnis;
}

/* ================================================================ Jahresbericht */

function jahresbericht(db, einstellungen, schuljahr) {
  const sj = schuljahr || schuljahrVon(heuteISO());
  const { von, bis } = schuljahrZeitraum(sj);
  const imZeitraum = `substr(a."AuslDatum", 1, 10) BETWEEN ? AND ?`;
  const ausleihen = db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe" a WHERE ${imZeitraum}`).get(von, bis).n;
  const aktiveLeser = db.prepare(`SELECT COUNT(DISTINCT "LeserNi") AS n FROM "Ausleihe" a WHERE ${imZeitraum}`).get(von, bis).n;
  const monateRoh = new Map(db.prepare(`SELECT substr(a."AuslDatum", 1, 7) AS monat, COUNT(*) AS n FROM "Ausleihe" a WHERE ${imZeitraum} GROUP BY monat`).all(von, bis).map((r) => [r.monat, r.n]));
  const monate = [];
  for (let i = 0; i < 12; i++) {
    const jahr = Number(von.slice(0, 4)) + (i >= 5 ? 1 : 0);
    const monat = ((7 + i) % 12) + 1;
    const schluessel = `${jahr}-${String(monat).padStart(2, '0')}`;
    monate.push({ monat: schluessel, anzahl: monateRoh.get(schluessel) || 0 });
  }
  const top = db.prepare(
    `SELECT k."Titel", k."Autor", COUNT(*) AS n FROM "Ausleihe" a JOIN "Medien" m ON m."MedienNi" = a."MedienNi" JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
     WHERE ${imZeitraum} GROUP BY k."KatalogNi" ORDER BY n DESC, k."Titel" LIMIT 10`
  ).all(von, bis);
  const gruppen = gruppenNamen(db);
  const leserMap = new Map(db.prepare(`SELECT "LeserNi", "Jahrgang", "Vorname", "LeserGruNi" FROM "Leser"`).all().map((l) => [String(l.LeserNi), l]));
  const proKlasse = new Map();
  for (const r of db.prepare(`SELECT "LeserNi", COUNT(*) AS n FROM "Ausleihe" a WHERE ${imZeitraum} GROUP BY "LeserNi"`).all(von, bis)) {
    const l = leserMap.get(String(r.LeserNi));
    const k = l ? klasseVon(l, gruppen.get(String(l.LeserGruNi)))?.kuerzel : null;
    const schluessel = k || 'ohne Klasse / gelöscht';
    proKlasse.set(schluessel, (proKlasse.get(schluessel) || 0) + r.n);
  }
  const zugaenge = db.prepare(`SELECT COUNT(*) AS n FROM "Medien" WHERE substr(COALESCE("ErfassDat", ''), 1, 10) BETWEEN ? AND ?`).get(von, bis).n;
  const neueTitel = db.prepare(`SELECT COUNT(*) AS n FROM "Katalog" WHERE substr(COALESCE("ErfassDat", ''), 1, 10) BETWEEN ? AND ?`).get(von, bis).n;
  const schaeden = db.prepare(`SELECT COUNT(*) AS n FROM inga_schaeden WHERE substr(datum, 1, 10) BETWEEN ? AND ?`).get(von, bis).n;
  const mahnungen = db.prepare(`SELECT COUNT(*) AS n FROM "Mahnung" WHERE substr("Mahndatum", 1, 10) BETWEEN ? AND ?`).get(von, bis).n;
  const pass = lesepass(db, { schuljahr: sj, stufen: einstellungen.lesepassStufen || [5, 10, 20] });
  const stufenZahl = (name) => pass.filter((p) => p.stufe === name).length;
  return {
    schuljahr: sj, von, bis, erstellt: heuteISO(),
    kennzahlen: { ...repo.kennzahlen(db), ausleihen, aktiveLeser, zugaenge, neueTitel, schaeden, mahnungen },
    monate, top,
    proKlasse: [...proKlasse.entries()].map(([klasse, anzahl]) => ({ klasse, anzahl })).sort((a, b) => a.klasse.localeCompare(b.klasse, 'de', { numeric: true })),
    lesepass: { kinderMitBuechern: pass.length, bronze: stufenZahl('Bronze'), silber: stufenZahl('Silber'), gold: stufenZahl('Gold'), spitze: pass.slice(0, 5).map((p) => ({ name: `${p.Vorname} ${p.Nachname.slice(0, 1)}.`, klasse: p.klasse, anzahl: p.anzahl })) },
    budget: budget(db, sj),
  };
}

/* ================================================================ Datenschutz */

/** Zurückgegebene Ausleihen (und deren Mahnungen) älter als `monate` Monate löschen; Schäden anonymisieren. */
function historieBereinigen(db, monate) {
  const m = Number(monate) || 0;
  if (m <= 0) return { ausleihen: 0, mahnungen: 0, schaeden: 0 };
  const grenze = addTage(heuteISO(), -Math.round(m * 30.44));
  let ergebnis;
  db.transaction(() => {
    const mahnungen = db.prepare(
      `DELETE FROM "Mahnung" WHERE substr("Mahndatum", 1, 10) < ? AND NOT EXISTS (
         SELECT 1 FROM "Ausleihe" a WHERE a."MedienNi" = "Mahnung"."MedienNi" AND a."LeserNi" = "Mahnung"."LeserNi" AND a."AuslDatum" = "Mahnung"."AuslDatum" AND a."Rueckgabe" IS NULL)`
    ).run(grenze).changes;
    const ausleihen = db.prepare(`DELETE FROM "Ausleihe" WHERE "Rueckgabe" IS NOT NULL AND substr("Rueckgabe", 1, 10) < ?`).run(grenze).changes;
    const schaeden = db.prepare(`UPDATE inga_schaeden SET "LeserNi" = NULL WHERE "LeserNi" IS NOT NULL AND substr(datum, 1, 10) < ?`).run(grenze).changes;
    db.prepare(`INSERT OR REPLACE INTO inga_meta (key, value) VALUES ('letzte_bereinigung', ?)`).run(jetztStamp());
    ergebnis = { ausleihen, mahnungen, schaeden, grenze };
  })();
  return ergebnis;
}

/** Wie viel würde gelöscht? (für die Anzeige in den Einstellungen) */
function historieVorschau(db, monate) {
  const m = Number(monate) || 0;
  if (m <= 0) return { ausleihen: 0 };
  const grenze = addTage(heuteISO(), -Math.round(m * 30.44));
  return { ausleihen: db.prepare(`SELECT COUNT(*) AS n FROM "Ausleihe" WHERE "Rueckgabe" IS NOT NULL AND substr("Rueckgabe", 1, 10) < ?`).get(grenze).n, grenze };
}

/** Auskunft: alles, was INGA über ein Kind gespeichert hat (DSGVO Art. 15). */
function auskunft(db, leserNi) {
  const l = leserMitKlasse(db, leserNi);
  if (!l) throw new Error('Diesen Nutzer gibt es nicht (mehr).');
  const felder = Object.entries(l)
    .filter(([k, v]) => k !== 'klasse' && v !== null && v !== undefined && String(v).trim() !== '' && String(v) !== '0' && !/^Inga/.test(k))
    .map(([k, v]) => ({ feld: k, wert: String(v) }));
  const ausleihen = db.prepare(
    `SELECT a."AuslDatum", a."Rueckgabe", a."AnzVerl", k."Titel", m."MedienEtik" FROM "Ausleihe" a
     JOIN "Medien" m ON m."MedienNi" = a."MedienNi" JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi"
     WHERE a."LeserNi" = ? ORDER BY a."AuslDatum" DESC`
  ).all(ni(leserNi));
  return {
    erstellt: heuteISO(),
    name: `${l.Nachname}, ${vornameOhneKlasse(l.Vorname)}`, klasse: l.klasse?.kuerzel || '',
    felder,
    sperre: repo.leserGesperrt(db, ni(leserNi)),
    ausleihen,
    mahnungen: repo.mahnhistorieVonLeser(db, ni(leserNi)),
    vormerkungen: repo.vormerkungenVonLeser(db, ni(leserNi)),
    schaeden: db.prepare(`SELECT s.datum, s.beschreibung, k."Titel" FROM inga_schaeden s JOIN "Medien" m ON m."MedienNi" = s."MedienNi" JOIN "Katalog" k ON k."KatalogNi" = m."KatalogNi" WHERE s."LeserNi" = ? ORDER BY s.datum DESC`).all(ni(leserNi)),
  };
}

module.exports = {
  vornameOhneKlasse,
  schadenErfassen, schaedenFuerKatalog, schadenErledigt,
  vormerkungNachRueckgabe, baldFaellig, rueckstandProKlasse,
  lesepass, antolinBuecher, neuerwerbungen, empfehlungen, lesetippsFuerLeser,
  anschaffungen, anschaffungSpeichern, anschaffungLoeschen, budget, budgetSetzen,
  aktiveInventur, inventurStarten, inventurScan, inventurStand, inventurAbschliessen, inventurAbbrechen,
  ausweisDaten, klassenListe,
  schuljahreswechselPlan, schuljahreswechselAusfuehren,
  jahresbericht, historieBereinigen, historieVorschau, auskunft,
};
