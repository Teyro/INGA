'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

/**
 * Kleiner JSON-Speicher: eine Datei pro Bereich im userData-Ordner.
 * Schreibvorgänge werden gebündelt und atomar über eine .tmp-Datei ausgeführt.
 */
class Store {
  constructor(dir) {
    this.dir = dir;
    this.cache = new Map();
    this.timers = new Map();
    this.writing = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) {
    return path.join(this.dir, `${name}.json`);
  }

  get(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let value = fallback;
    try {
      const raw = fs.readFileSync(this.file(name), 'utf8');
      const parsed = JSON.parse(raw);
      value = parsed && typeof parsed === 'object' ? { ...fallback, ...parsed } : fallback;
    } catch {
      value = fallback;
    }
    this.cache.set(name, value);
    return value;
  }

  set(name, value) {
    this.cache.set(name, value);
    this.schedule(name);
    return value;
  }

  schedule(name) {
    clearTimeout(this.timers.get(name));
    this.timers.set(
      name,
      setTimeout(() => this.flush(name), 250)
    );
  }

  flush(name) {
    clearTimeout(this.timers.get(name));
    this.timers.delete(name);
    const value = this.cache.get(name);
    if (value === undefined) return Promise.resolve();

    const queued = (this.writing.get(name) || Promise.resolve()).then(async () => {
      const target = this.file(name);
      const tmp = `${target}.tmp`;
      try {
        await fsp.writeFile(tmp, JSON.stringify(this.cache.get(name)), 'utf8');
        await fsp.rename(tmp, target);
      } catch (err) {
        console.error(`[store] ${name} konnte nicht gespeichert werden:`, err.message);
      }
    });
    this.writing.set(name, queued);
    return queued;
  }

  flushAllSync() {
    for (const name of [...this.timers.keys()]) {
      clearTimeout(this.timers.get(name));
      this.timers.delete(name);
      const value = this.cache.get(name);
      if (value === undefined) continue;
      const target = this.file(name);
      const tmp = `${target}.tmp`;
      try {
        fs.writeFileSync(tmp, JSON.stringify(value), 'utf8');
        fs.renameSync(tmp, target);
      } catch (err) {
        console.error(`[store] ${name} konnte nicht gespeichert werden:`, err.message);
      }
    }
  }
}

// Platzhalter, die beim Drucken ersetzt werden: {Vorname} {Nachname} {Titel}
// {Tage} {Gebuehr} {Datum} {Faellig} {Stufe}
const DEFAULT_BRIEFTEXT =
  'Liebe/r {Vorname} {Nachname},\n\n' +
  'die unten aufgeführten Medien sind seit {Tage} Tagen überfällig (fällig war am {Faellig}). ' +
  'Bitte gib sie so bald wie möglich in der Bibliothek zurück.';
const DEFAULT_BRIEFTEXT_LETZTE =
  'Liebe/r {Vorname} {Nachname},\n\n' +
  'trotz vorheriger Mahnung(en) sind die unten aufgeführten Medien weiterhin nicht zurückgegeben – ' +
  'sie sind nun seit {Tage} Tagen überfällig. Bitte gib sie umgehend zurück, ' +
  'andernfalls kontaktieren wir die Erziehungsberechtigten.';

const DEFAULT_SETTINGS = {
  uiStyle: 'auto', // auto | mac | win | kde | gnome
  theme: 'auto', // auto | light | dark
  vibrancy: 'under-window',
  winBackdrop: 'mica', // mica | acrylic | tabbed | none
  linuxTitlebar: 'app', // app | system
  accent: '#4f8ef7',
  fontScale: 100,
  reduceTransparency: false,
  highContrast: false,

  // Ausleihe
  leihfristTage: 28,
  maxVerlaengerung: 2,
  // Wirkt zusätzlich zur Leihfrist (Standard oder Medienart) auf JEDE
  // berechnete Fälligkeit – z. B. +14 für eine Ferienschließzeit. Betrifft
  // offene und künftige Ausleihen sofort, ohne AuslDatum zu verändern.
  leihfristOffsetTage: 0,

  // Mahnwesen
  mahnstufen: [
    { tageUeberfaellig: 7, gebuehr: 0.5, text: '1. Mahnung', briefText: DEFAULT_BRIEFTEXT },
    { tageUeberfaellig: 21, gebuehr: 1.5, text: '2. Mahnung', briefText: DEFAULT_BRIEFTEXT },
    { tageUeberfaellig: 42, gebuehr: 3.0, text: 'Letzte Mahnung', briefText: DEFAULT_BRIEFTEXT_LETZTE },
  ],
  absenderName: '',
  absenderAdresse: '',
  absenderEmail: '',
  absenderTelefon: '',
  mahnBetreffVorlage: '{Stufe} – bitte Medien zurückgeben',
  mahnSchluss: 'Vielen Dank für die Rückgabe.\n\nMit freundlichen Grüßen\nDie Schulbibliothek',
  mahnLogoDataUrl: '',

  // Drucken
  printPaper: 'A4',
  lastExportReveal: false,
};

function defaultSettingsFor(style, accent) {
  const base = { ...DEFAULT_SETTINGS, accent: accent || DEFAULT_SETTINGS.accent };
  if (style === 'win') return { ...base };
  if (style === 'kde') return { ...base };
  if (style === 'gnome') return { ...base };
  return base;
}

const ENUMS = {
  uiStyle: ['auto', 'mac', 'win', 'kde', 'gnome'],
  theme: ['auto', 'light', 'dark'],
  linuxTitlebar: ['app', 'system'],
  winBackdrop: ['mica', 'acrylic', 'tabbed', 'none'],
  vibrancy: ['under-window', 'sidebar', 'fullscreen-ui', 'hud', 'popover', 'content', 'header', 'none'],
  printPaper: ['A4', 'Letter'],
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function sanitizeSettings(next, current = DEFAULT_SETTINGS) {
  const clean = {};
  if (!next || typeof next !== 'object') return clean;

  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    if (!Object.hasOwn(next, key)) continue;
    const value = next[key];
    const previous = Object.hasOwn(current, key) ? current[key] : fallback;

    if (key === 'mahnstufen') {
      clean[key] = Array.isArray(value)
        ? value
            .map((stufe) => ({
              tageUeberfaellig: clamp(Math.round(Number(stufe?.tageUeberfaellig) || 0), 0, 365),
              gebuehr: clamp(Number(stufe?.gebuehr) || 0, 0, 1000),
              text: typeof stufe?.text === 'string' ? stufe.text.slice(0, 80) : 'Mahnung',
              briefText: typeof stufe?.briefText === 'string' ? stufe.briefText.slice(0, 4000) : DEFAULT_BRIEFTEXT,
            }))
            .slice(0, 10)
        : previous;
      continue;
    }
    if (key === 'accent') {
      clean[key] = /^#[0-9a-f]{6}$/i.test(value) ? value : previous;
      continue;
    }
    // Logo als data:-URL: nicht wie andere Freitexte auf 200 Zeichen kappen
    // (würde die Base64-Daten zerstören) – nur Format prüfen, Größe begrenzen.
    if (key === 'mahnLogoDataUrl') {
      if (value === '') { clean[key] = ''; continue; }
      clean[key] = typeof value === 'string' && /^data:image\/(png|jpeg|jpg|gif|webp);base64,/.test(value) && value.length <= 2_000_000
        ? value
        : previous;
      continue;
    }
    if (key === 'mahnSchluss' || key === 'absenderAdresse') {
      clean[key] = typeof value === 'string' ? value.slice(0, 2000) : previous;
      continue;
    }
    if (typeof fallback === 'boolean') {
      clean[key] = value === true || value === false ? value : previous;
      continue;
    }
    if (typeof fallback === 'number') {
      const number = Number(value);
      clean[key] = Number.isFinite(number) ? number : previous;
      continue;
    }
    if (typeof value !== 'string') {
      clean[key] = previous;
      continue;
    }
    const allowed = ENUMS[key];
    clean[key] = allowed ? (allowed.includes(value) ? value : previous) : value.slice(0, 200);
  }

  return clean;
}

module.exports = {
  Store,
  DEFAULT_SETTINGS,
  defaultSettingsFor,
  sanitizeSettings,
};
