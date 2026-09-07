'use strict';

/**
 * Geometrie und Seitenaufteilung für den Etikettendruck – reine Berechnung,
 * ohne DOM-Zugriff, deshalb sowohl im Etiketten-Druckfenster per <script>
 * eingebunden als auch von node:test direkt per require() prüfbar (siehe
 * test/etiketten.test.mjs). Läuft in beiden Umgebungen unverändert (UMD-
 * artiger Export unten).
 *
 * Maße abgeleitet aus den offiziellen Produktmaßen (Zweckform 3475: 70×36 mm/
 * 24 pro Bogen; Avery L7160, auch bei Zweckform als Universal-Etikett
 * geführt: 63,5×38,1 mm/21 pro Bogen; Zweckform 3651: 52,5×29,7 mm/40 pro
 * Bogen) und der quelloffenen glabels-Etikettendatenbank für Rand-/
 * Rasterabstand (dort in pt hinterlegt, hier nach mm umgerechnet – 1pt =
 * 25,4/72 mm). marginTop/marginLeft sind der Abstand der ERSTEN
 * Etikettenecke vom Blattrand, pitchX/pitchY der Mittenabstand
 * (Etikettengröße + Lücke) zur nächsten Spalte/Zeile.
 */
const FORMATE = {
  'zweckform-3475': { label: 'Zweckform 3475 (70 × 36 mm, 24/Bogen)', cols: 3, rows: 8, marginTop: 4.43, marginLeft: 0, pitchX: 70.02, pitchY: 36.01 },
  'zweckform-l7160': { label: 'Zweckform/Avery L7160 (63,5 × 38,1 mm, 21/Bogen)', cols: 3, rows: 7, marginTop: 15.49, marginLeft: 7.48, pitchX: 66.04, pitchY: 38.1 },
  'zweckform-3651': { label: 'Zweckform 3651 (52,5 × 29,7 mm, 40/Bogen)', cols: 4, rows: 10, marginTop: 1.0, marginLeft: 1.0, pitchX: 52.0, pitchY: 29.5 },
};

/**
 * Verteilt `labels` auf Bögen des gegebenen Formats, beginnend an
 * `startPosition` (1 = oben links) auf dem ERSTEN Bogen – jeder weitere
 * Bogen beginnt wieder bei Position 1. Gibt eine flache Liste von Zellen
 * zurück: { bogen, row, col, left, top, width, height, label }, wobei
 * `label` bei übersprungenen (bereits verbrauchten) Positionen null ist.
 */
function berechnePositionen(labels, format, startPosition) {
  const proBogen = format.cols * format.rows;
  const vorlauf = Math.max(0, Math.min(proBogen - 1, (Number(startPosition) || 1) - 1));
  const zellen = [...Array(vorlauf).fill(null), ...labels];
  const anzahlBoegen = Math.max(1, Math.ceil(zellen.length / proBogen));

  const ergebnis = [];
  for (let bogen = 0; bogen < anzahlBoegen; bogen++) {
    for (let i = 0; i < proBogen; i++) {
      const label = zellen[bogen * proBogen + i] ?? null;
      const row = Math.floor(i / format.cols);
      const col = i % format.cols;
      ergebnis.push({
        bogen,
        row,
        col,
        left: format.marginLeft + col * format.pitchX,
        top: format.marginTop + row * format.pitchY,
        width: format.pitchX,
        height: format.pitchY,
        label,
      });
    }
  }
  return ergebnis;
}

const api = { FORMATE, berechnePositionen };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else (typeof window !== 'undefined' ? window : globalThis).EtikettenGeometrie = api;
