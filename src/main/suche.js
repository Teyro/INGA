'use strict';

/**
 * Ähnlichkeitssuche für die Vorschlagslisten beim Ausleihen (Abschnitt 4):
 * "Meier" soll auch "Meyer"/"Maier" finden, ein vertippter Vorname das Kind
 * trotzdem – aber exakte und Präfix-Treffer sollen immer vor unscharfen
 * stehen. Bewusst ohne neue Abhängigkeit (kein Fuse.js o. Ä.): eine simple
 * Levenshtein-Distanz reicht für Namen/Titel dieser Länge und Stückzahl
 * (siehe Auftrag: "auch bei mehreren hundert Datensätzen ohne spürbare
 * Verzögerung") völlig aus.
 */

/**
 * Kleinschreibung, diakritische Zeichen vereinheitlicht (Meyer=meyer=MEYER,
 * é=e), ß=ss. `\p{Mn}` (Unicode-Kategorie "Mark, nonspacing") statt eines
 * festen Zeichenbereichs, um jedes über NFKD zerlegte Akzentzeichen zu
 * treffen, unabhängig von der Sprache.
 */
function normalisiere(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{Mn}/gu, '')
    .replace(/ß/g, 'ss')
    .trim();
}

/** Klassische iterative Levenshtein-Distanz (Einfüge-/Lösch-/Ersetzoperationen). */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const kosten = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + kosten);
    }
    prev = curr;
  }
  return prev[n];
}

/** Wie viele Vertipper bei dieser Anfragelänge noch als "dasselbe Wort gemeint" durchgehen. */
function toleranz(laenge) {
  if (laenge <= 3) return 1;
  if (laenge <= 6) return 2;
  return 3;
}

/**
 * Rang eines einzelnen Feldwerts gegen die Anfrage: 0 = kein Treffer, sonst
 * höher = besser. Exakt (100) und Präfix (90/70) liegen klar vor Teilstring
 * (80) und unscharfen Treffern (< 60) – "unscharfe Treffer erscheinen nach
 * den exakten" (Auftrag). Vergleicht zusätzlich Wort für Wort, damit ein
 * Nachname auch INNERHALB eines mehrteiligen Feldes ("Vorname Nachname")
 * gefunden wird, nicht nur als exaktes Präfix des Gesamtfelds.
 */
function feldRang(feld, q) {
  const f = normalisiere(feld);
  if (!q || !f) return 0;
  if (f === q) return 100;
  if (f.startsWith(q)) return 90;
  if (f.includes(q)) return 80;

  const tol = toleranz(q.length);
  let bester = 0;
  for (const wort of [f, ...f.split(/\s+/)]) {
    if (wort.length < 2) continue;
    if (wort.startsWith(q)) { bester = Math.max(bester, 70); continue; }
    const d = levenshtein(wort, q);
    if (d <= tol) bester = Math.max(bester, 60 - d * 10);
  }
  return bester;
}

/**
 * Sortiert `kandidaten` nach dem besten Rang über alle von `felderVon`
 * gelieferten Feldwerte, lässt Nicht-Treffer weg. `query` wird einmal
 * normalisiert statt bei jedem Feldvergleich neu.
 */
function ranglisteSortiert(kandidaten, query, felderVon) {
  const q = normalisiere(query);
  if (!q) return [];
  return kandidaten
    .map((k) => ({ k, rang: Math.max(0, ...felderVon(k).map((f) => feldRang(f, q))) }))
    .filter((x) => x.rang > 0)
    .sort((a, b) => b.rang - a.rang)
    .map((x) => x.k);
}

module.exports = { normalisiere, levenshtein, feldRang, ranglisteSortiert };
