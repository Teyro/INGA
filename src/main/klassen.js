'use strict';

/**
 * Klassen der Kinder – eine Quelle der Wahrheit für alles, was nach Klassen
 * fragt (Ausleihgrenzen, Rückstandslisten für Lehrkräfte, Lesepass,
 * Leseausweise, Jahresbericht, Schuljahreswechsel).
 *
 * In echten Perpustakaan-Beständen steht die Klasse an unterschiedlichen
 * Stellen: im Feld "Jahrgang" (INGA), im Namen der Nutzergruppe
 * ("1c Fr. Brücker 26/27") oder angehängt an den Vornamen ("Glenn 4c").
 * Reihenfolge der Auswertung: Jahrgang, dann Gruppe (wird von der Schule
 * jedes Jahr gepflegt, also am aktuellsten), zuletzt der Vorname.
 */

/** "4c", "4 c", "Klasse 4c", "4c Fr. Haist 26/27" → { stufe: 4, buchstabe: 'c', kuerzel: '4c' } – sonst null. */
function klasseAusText(text, { amEnde = false } = {}) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const muster = amEnde
    ? /(?:^|\s)(?:Kl(?:asse|\.)?\s*)?([1-9])\s?([a-z])$/i
    : /^(?:Kl(?:asse|\.)?\s*)?([1-9])\s?([a-z])?(?=\s|$|[.,;:/-])/i;
  const m = t.match(muster);
  if (!m) return null;
  const stufe = Number(m[1]);
  const buchstabe = (m[2] || '').toLowerCase();
  return { stufe, buchstabe, kuerzel: `${stufe}${buchstabe}` };
}

/** Lehrkraft aus einem Gruppennamen ("1c Fr. Brücker 26/27" → "Fr. Brücker"). */
function lehrkraftAusGruppe(name) {
  const rest = String(name ?? '').replace(/^(?:Kl(?:asse|\.)?\s*)?[1-9]\s?[a-z]?\s*/i, '').replace(/\s*\d{2,4}\s*\/\s*\d{2,4}\s*$/, '').trim();
  return rest || null;
}

/**
 * Klasse eines Lesers. `gruppenName`: Name seiner Nutzergruppe (LeserGrupp.LeserGruBz).
 * Liefert { stufe, buchstabe, kuerzel, quelle: 'jahrgang'|'gruppe'|'vorname', lehrkraft } oder null.
 */
function klasseVon(leser, gruppenName) {
  if (!leser) return null;
  const ausJahrgang = klasseAusText(leser.Jahrgang);
  if (ausJahrgang) return { ...ausJahrgang, quelle: 'jahrgang', lehrkraft: gruppenName ? lehrkraftAusGruppe(gruppenName) : null };
  const ausGruppe = klasseAusText(gruppenName);
  if (ausGruppe) return { ...ausGruppe, quelle: 'gruppe', lehrkraft: lehrkraftAusGruppe(gruppenName) };
  const ausVorname = klasseAusText(leser.Vorname, { amEnde: true });
  if (ausVorname) return { ...ausVorname, quelle: 'vorname', lehrkraft: null };
  return null;
}

/** Alle Gruppen als Map LeserGruNi → Bezeichnung. */
function gruppenNamen(db) {
  const map = new Map();
  for (const g of db.prepare(`SELECT "LeserGruNi", "LeserGruBz" FROM "LeserGrupp"`).all()) map.set(String(g.LeserGruNi), g.LeserGruBz || '');
  return map;
}

/** Hängt an jeden Leser `klasse` (siehe klasseVon) an – eine Abfrage für die Gruppen statt einer je Zeile. */
function mitKlassen(db, leserListe) {
  const gruppen = gruppenNamen(db);
  return leserListe.map((l) => ({ ...l, klasse: klasseVon(l, gruppen.get(String(l.LeserGruNi))) }));
}

/** Schuljahr eines Datums ("2026-09-30" → "2026/27"); Wechsel am 1. August. */
function schuljahrVon(datum) {
  const t = String(datum ?? '').slice(0, 10);
  const jahr = Number(t.slice(0, 4));
  const monat = Number(t.slice(5, 7));
  if (!jahr || !monat) return null;
  const start = monat >= 8 ? jahr : jahr - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Zeitraum eines Schuljahres ("2026/27" → von 2026-08-01 bis 2027-07-31). */
function schuljahrZeitraum(schuljahr) {
  const start = Number(String(schuljahr).slice(0, 4));
  return { von: `${start}-08-01`, bis: `${start + 1}-07-31` };
}

/** Schuljahresangabe in einem Text eins weiterzählen ("26/27" → "27/28", "2023/24" → "2024/25"). */
function schuljahrWeiter(text) {
  return String(text ?? '').replace(/(\d{2,4})\s*\/\s*(\d{2,4})/, (_, a, b) => {
    const n = (x) => String(Number(x) + 1).padStart(x.length, '0');
    return `${n(a)}/${n(b).slice(-b.length)}`;
  });
}

module.exports = { klasseAusText, lehrkraftAusGruppe, klasseVon, gruppenNamen, mitKlassen, schuljahrVon, schuljahrZeitraum, schuljahrWeiter };
