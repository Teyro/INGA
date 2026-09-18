'use strict';

/**
 * Optionale Einfärbung der (selbst gezeichneten) Titelleiste – siehe
 * Einstellungen "Verschiedenes". Drei Modi (Einstellung
 * `titelleisteModus`):
 *   'standard' (Vorgabe) – unverändert, wie bisher (var(--surface)).
 *   'wochentag' – Farbe je nach heutigem Wochentag, nach dem
 *     METACOM-Farbschema für Wochentagssymbole (in der Unterstützten
 *     Kommunikation/Förderschulen verbreitet, an Eric Carles "Die kleine
 *     Raupe Nimmersatt" angelehnt): Montag gelb, Dienstag grün, Mittwoch
 *     blau, Donnerstag rot, Freitag orange. Samstag/Sonntag sind bei
 *     METACOM beide weiß (Sonntag-Beschriftung rot) – als GANZE
 *     Titelleistenfarbe wäre reines Weiß kaum sichtbar/kontrastarm,
 *     deshalb hier bewusst ein helles Grau (Samstag) bzw. ein
 *     Rosé-Ton (Sonntag, angelehnt an die rote Sonntagsbeschriftung)
 *     statt exaktem Weiß – praktische Anpassung, kein Widerspruch zum
 *     Schema selbst (Wochentage Montag–Freitag sind unverändert).
 *   'eigene' – eine feste, frei gewählte Farbe (`titelleisteEigeneFarbe`).
 *
 * Reine, ungetestete UI-Politur hätte hier auch ohne eigene Datei
 * gereicht – als eigenständiges Modul, weil sich Wochentag-Zuordnung und
 * die Kontrastberechnung (schwarzer oder weißer Text/Icon-Farbe je nach
 * gewählter Farbe – nötig, damit z. B. Gelb nicht mit weißer Schrift
 * praktisch unlesbar wird) gut isoliert mit node:test prüfen lassen, ganz
 * ohne Electron.
 */

// index 0 = Sonntag (JS Date.getDay()), ... 6 = Samstag.
const WOCHENTAG_FARBEN = [
  '#e78ba0', // Sonntag – Rosé (METACOM: weiß, Beschriftung rot)
  '#f4c542', // Montag – Gelb
  '#3fa34d', // Dienstag – Grün
  '#3d6fe0', // Mittwoch – Blau
  '#d64545', // Donnerstag – Rot
  '#e8801a', // Freitag – Orange
  '#c9ccd1', // Samstag – helles Grau (METACOM: weiß)
];

const STANDARD_MODUS = 'standard';
const MODI = ['standard', 'wochentag', 'eigene'];

/** `datum` optional (Testbarkeit) – Vorgabe: heute. */
function wochentagsFarbe(datum = new Date()) {
  return WOCHENTAG_FARBEN[datum.getDay()];
}

const HEX_MUSTER = /^#[0-9a-f]{6}$/i;

/**
 * Die tatsächlich anzuwendende Titelleistenfarbe aus den Einstellungen –
 * oder `null`, wenn die Standardfarbe gelten soll (Modus "standard",
 * unbekannter Modus, oder "eigene" ohne gültige/mit ungültiger Farbe).
 */
function effektiveFarbe(settings = {}, datum = new Date()) {
  const modus = MODI.includes(settings.titelleisteModus) ? settings.titelleisteModus : STANDARD_MODUS;
  if (modus === 'wochentag') return wochentagsFarbe(datum);
  if (modus === 'eigene') {
    const eigene = settings.titelleisteEigeneFarbe;
    return typeof eigene === 'string' && HEX_MUSTER.test(eigene) ? eigene : null;
  }
  return null;
}

/**
 * Schwarz oder Weiß, je nachdem, was auf `hexFarbe` besser lesbar ist –
 * relative Luminanz nach der (vereinfachten, für Titelleisten-Text
 * ausreichend genauen) WCAG-Formel. Wirft nie: ein unerwartetes Format
 * ergibt einfach Schwarz (die bisherige, "helle" Standard-Titelleiste
 * nutzt ohnehin dunklen Text).
 */
function kontrastfarbe(hexFarbe) {
  if (typeof hexFarbe !== 'string' || !HEX_MUSTER.test(hexFarbe)) return '#1a1a1a';
  const zahl = Number.parseInt(hexFarbe.slice(1), 16);
  const r = (zahl >> 16) & 255;
  const g = (zahl >> 8) & 255;
  const b = zahl & 255;
  // sRGB -> relative Luminanz (WCAG), 0..1
  const linear = (kanal) => {
    const c = kanal / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminanz = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminanz > 0.45 ? '#1a1a1a' : '#ffffff';
}

module.exports = { WOCHENTAG_FARBEN, MODI, wochentagsFarbe, effektiveFarbe, kontrastfarbe };
