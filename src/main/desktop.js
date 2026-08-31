'use strict';

/**
 * Liest Akzentfarbe, Farbschema und Schriftart des Linux-Schreibtischs, soweit sich
 * das ohne Zusatzpakete aus den Konfigurationsdateien von GTK/GNOME und Qt/KDE
 * herausfinden lässt. Schlägt das fehl, bleibt es bei den Vorgabewerten des Stils –
 * ein falscher Rateversuch wäre schlimmer als gar keine Angabe.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function readFileSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** GNOME/GTK: dconf-Ini-artige Dateien und gsettings-Exporte grob parsen. */
function readGnomeTheme() {
  const candidates = [
    path.join(os.homedir(), '.config/gtk-4.0/settings.ini'),
    path.join(os.homedir(), '.config/gtk-3.0/settings.ini'),
  ];
  let dark = null;
  let font = null;
  for (const file of candidates) {
    const text = readFileSafe(file);
    if (!text) continue;
    const themeMatch = /gtk-theme-name\s*=\s*(.+)/i.exec(text);
    const fontMatch = /gtk-font-name\s*=\s*(.+)/i.exec(text);
    if (themeMatch && dark === null) dark = /dark/i.test(themeMatch[1]);
    if (fontMatch && !font) font = fontMatch[1].trim().replace(/\s+\d+$/, '');
    if (dark !== null && font) break;
  }
  return { accent: null, palette: null, font, dark };
}

/** KDE/Qt: kdeglobals im INI-Format, Abschnitte [General]/[Colors:Window] etc. */
function readKdeTheme() {
  const file = path.join(os.homedir(), '.config/kdeglobals');
  const text = readFileSafe(file);
  if (!text) return { accent: null, palette: null, font: null, dark: null };

  const section = (name) => {
    const re = new RegExp(`\\[${name}\\][^\\[]*`, 'i');
    return (re.exec(text) || [''])[0];
  };
  const key = (block, name) => {
    const re = new RegExp(`${name}\\s*=\\s*([\\d,]+)`, 'i');
    return (re.exec(block) || [])[1] || null;
  };
  const toHex = (rgb) => {
    if (!rgb) return null;
    const [r, g, b] = rgb.split(',').map((n) => Number.parseInt(n, 10));
    if ([r, g, b].some((n) => Number.isNaN(n))) return null;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  };

  const general = section('General');
  const accent = toHex(key(general, 'AccentColor') || key(section('Colors:Selection'), 'BackgroundNormal'));
  const winBg = toHex(key(section('Colors:Window'), 'BackgroundNormal'));
  const winFg = toHex(key(section('Colors:Window'), 'ForegroundNormal'));
  const viewBg = toHex(key(section('Colors:View'), 'BackgroundNormal'));
  const viewFg = toHex(key(section('Colors:View'), 'ForegroundNormal'));
  const fontLine = key(general, 'font');
  const font = fontLine ? fontLine.split(',')[0] : null;

  // Grob geschätzt: ein dunkler Fensterhintergrund heißt dunkles Farbschema.
  let dark = null;
  if (winBg) {
    const n = Number.parseInt(winBg.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    dark = (r * 299 + g * 587 + b * 114) / 1000 < 128;
  }

  const palette = { windowBg: winBg, windowFg: winFg, viewBg, viewFg };
  return { accent, palette, font, dark };
}

function readDesktopTheme(desktop) {
  try {
    if (desktop === 'kde' || desktop === 'lxqt') return readKdeTheme();
    return readGnomeTheme();
  } catch {
    return { accent: null, palette: null, font: null, dark: null };
  }
}

module.exports = { readDesktopTheme };
