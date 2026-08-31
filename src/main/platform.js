'use strict';

/**
 * Alles, was sich zwischen macOS, Windows und Linux unterscheidet, steht hier:
 * Fensteraufbau, Menüstruktur und die Gestaltungssprache, an der sich die
 * Oberfläche ausrichtet.
 *
 *   mac    → Liquid Glass (Vibrancy, weiche Kanten, Ampelknöpfe in der Kopfzeile)
 *   win    → Fluent (Mica/Acrylic, 8-px-Ecken, Systemakzent, Fensterknöpfe rechts)
 *   kde    → Breeze/Qt (deckende Flächen, 4-px-Ecken, Rahmen vom Fenstermanager)
 *   gnome  → Adwaita/GTK (Kopfleiste im Fenster, 12-px-Ecken, ein Schließknopf)
 *
 * Unter Linux entscheidet die Werkzeugsammlung der Oberfläche: Qt-Schreibtische
 * (Plasma, LXQt) bekommen Breeze, GTK-Schreibtische (GNOME, XFCE, Cinnamon, MATE …)
 * Adwaita. Ist die Umgebung nicht zu erkennen, gilt Adwaita.
 */

const { readDesktopTheme } = require('./desktop');

const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = !IS_MAC && !IS_WIN;

function detectDesktop() {
  if (IS_MAC) return 'aqua';
  if (IS_WIN) return 'windows';
  const raw = [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
  ]
    .filter(Boolean)
    .join(':')
    .toLowerCase();
  if (/kde|plasma/.test(raw)) return 'kde';
  if (/lxqt/.test(raw)) return 'lxqt';
  if (/gnome|unity|budgie|cinnamon|pantheon/.test(raw)) return 'gnome';
  if (/xfce/.test(raw)) return 'xfce';
  if (/mate|lxde/.test(raw)) return 'mate';
  return 'unbekannt';
}

const DESKTOP = detectDesktop();
const OS = IS_MAC ? 'mac' : IS_WIN ? 'win' : 'linux';

const QT_DESKTOPS = new Set(['kde', 'lxqt']);

function styleForDesktop(desktop) {
  if (desktop === 'aqua') return 'mac';
  if (desktop === 'windows') return 'win';
  return QT_DESKTOPS.has(desktop) ? 'kde' : 'gnome';
}

function nativeStyle() {
  return styleForDesktop(DESKTOP);
}

function resolveStyle(uiStyle) {
  return !uiStyle || uiStyle === 'auto' ? nativeStyle() : uiStyle;
}

const STYLE_ACCENTS = { mac: '#4f8ef7', win: '#0067c0', kde: '#3daee9', gnome: '#3584e4' };

let desktopTheme = null;

function theme() {
  if (!desktopTheme) {
    desktopTheme = IS_LINUX
      ? readDesktopTheme(DESKTOP)
      : { accent: null, palette: null, font: null, dark: null };
  }
  return desktopTheme;
}

function accentColor(systemPreferences) {
  const fallback = STYLE_ACCENTS[nativeStyle()];
  if (IS_LINUX) return theme().accent || fallback;
  try {
    const value = systemPreferences.getAccentColor();
    if (typeof value === 'string' && value.length >= 6) return `#${value.slice(0, 6)}`;
  } catch {
    /* nicht verfügbar – Vorgabe reicht */
  }
  return fallback;
}

function systemPalette(style) {
  if (!IS_LINUX || (style !== 'kde' && style !== 'gnome')) return null;
  const found = theme();
  if (!found.palette && !found.font) return null;
  return { ...(found.palette || {}), dark: found.dark, font: found.font || null };
}

/**
 * Wer zeichnet die Titelleiste?
 *   mac      macOS blendet sie aus, die Kopfzeile der App steht an ihrer Stelle
 *   overlay  Windows legt nur die Fensterknöpfe über die Kopfzeile
 *   csd      GNOME-Art: rahmenloses Fenster, die Kopfleiste bringt den Schließknopf mit
 *   native   der Fenstermanager dekoriert, die Kopfzeile ist nur Werkzeugleiste
 */
function chromeFor(style, settings = {}) {
  if (style === 'mac' && IS_MAC) return 'mac';
  if (style === 'win' && IS_WIN) return 'overlay';
  if (style === 'gnome' && IS_LINUX && settings.linuxTitlebar !== 'system') return 'csd';
  return 'native';
}

function windowOptions({ settings, style, dark, background, kind = 'main' }) {
  const solid = settings.reduceTransparency === true;

  if (style === 'mac' && IS_MAC) {
    const material = kind === 'print' ? 'sidebar' : settings.vibrancy;
    const vibrancy = !solid && material !== 'none' ? material : undefined;
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: kind === 'print' ? 20 : 24 },
      vibrancy,
      visualEffectState: 'followWindow',
      backgroundColor: vibrancy ? '#00000000' : background,
    };
  }

  if (style === 'win' && IS_WIN) {
    const material = solid ? 'none' : settings.winBackdrop || 'mica';
    return {
      titleBarStyle: 'hidden',
      titleBarOverlay: {
        color: '#00000000',
        symbolColor: dark ? '#ffffff' : '#1a1a1a',
        height: kind === 'print' ? 44 : 48,
      },
      backgroundMaterial: material,
      backgroundColor: material === 'none' ? background : '#00000000',
    };
  }

  if (chromeFor(style, settings) === 'csd' && kind !== 'print') {
    return { frame: false, backgroundColor: background };
  }

  return { frame: true, backgroundColor: background };
}

function applyWindowMaterial(win, { settings, style, background, kind = 'main' }) {
  if (!win || win.isDestroyed()) return;
  const solid = settings.reduceTransparency === true;

  if (style === 'mac' && IS_MAC) {
    const material = kind === 'print' ? 'sidebar' : settings.vibrancy;
    const vibrancy = !solid && material !== 'none' ? material : null;
    win.setVibrancy(vibrancy);
    win.setBackgroundColor(vibrancy ? '#00000000' : background);
    return;
  }

  if (style === 'win' && IS_WIN) {
    const material = solid ? 'none' : settings.winBackdrop || 'mica';
    try {
      win.setBackgroundMaterial(material);
    } catch {
      /* ältere Windows-Versionen kennen Mica nicht */
    }
    win.setBackgroundColor(material === 'none' ? background : '#00000000');
    return;
  }

  win.setBackgroundColor(background);
}

const LABELS = {
  mac: { reveal: 'Im Finder zeigen', revealShort: 'Finder', settings: 'Einstellungen …' },
  win: { reveal: 'Im Explorer anzeigen', revealShort: 'Explorer', settings: 'Einstellungen …' },
  kde: { reveal: 'In der Dateiverwaltung anzeigen', revealShort: 'Dateiverwaltung', settings: 'Einstellungen …' },
  gnome: { reveal: 'In Dateien zeigen', revealShort: 'Dateien', settings: 'Einstellungen …' },
};

function labels(style) {
  return LABELS[style] || LABELS.kde;
}

module.exports = {
  IS_MAC,
  IS_WIN,
  IS_LINUX,
  OS,
  DESKTOP,
  STYLE_ACCENTS,
  styleForDesktop,
  nativeStyle,
  resolveStyle,
  accentColor,
  systemPalette,
  chromeFor,
  windowOptions,
  applyWindowMaterial,
  labels,
};
