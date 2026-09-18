'use strict';

/**
 * Renderer-Fassung von src/main/titelleiste-farbe.js – dieselbe Logik
 * (Wochentagsfarbe nach METACOM-Schema, Kontrastfarbe für Text/Icons),
 * hier als einfaches <script>, weil die Renderer-Skripte keine
 * CommonJS-Module sind. Bei einer Änderung am Farbschema BEIDE Dateien
 * anpassen – die main-Fassung braucht ihre eigene Kopie für die native
 * Windows-Titelleisten-Symbolfarbe (setTitleBarOverlay, außerhalb des
 * Renderers).
 */

// index 0 = Sonntag (JS Date.getDay()), ... 6 = Samstag.
const TITELLEISTE_WOCHENTAG_FARBEN = [
  '#e78ba0', // Sonntag
  '#f4c542', // Montag
  '#3fa34d', // Dienstag
  '#3d6fe0', // Mittwoch
  '#d64545', // Donnerstag
  '#e8801a', // Freitag
  '#c9ccd1', // Samstag
];

function titelleisteWochentagsFarbe(datum = new Date()) {
  return TITELLEISTE_WOCHENTAG_FARBEN[datum.getDay()];
}

function titelleisteEffektiveFarbe(settings = {}, datum = new Date()) {
  const modus = settings.titelleisteModus;
  if (modus === 'wochentag') return titelleisteWochentagsFarbe(datum);
  if (modus === 'eigene') {
    const eigene = settings.titelleisteEigeneFarbe;
    return typeof eigene === 'string' && /^#[0-9a-f]{6}$/i.test(eigene) ? eigene : null;
  }
  return null;
}

function titelleisteKontrastfarbe(hexFarbe) {
  if (typeof hexFarbe !== 'string' || !/^#[0-9a-f]{6}$/i.test(hexFarbe)) return '#1a1a1a';
  const zahl = Number.parseInt(hexFarbe.slice(1), 16);
  const r = (zahl >> 16) & 255;
  const g = (zahl >> 8) & 255;
  const b = zahl & 255;
  const linear = (kanal) => {
    const c = kanal / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminanz = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminanz > 0.45 ? '#1a1a1a' : '#ffffff';
}
