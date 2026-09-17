'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, systemPreferences } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');

// Electrons Standard für app.getPath('userData') ist unter Linux
// "~/.config/<Name>" – gängig, aber nicht der XDG-Basisverzeichnis-Vorgabe für
// Nutzdaten (Datenbank, Backups) entsprechend. Vor jedem anderen app.*-Aufruf
// auf "~/.local/share/<Name>" (bzw. $XDG_DATA_HOME) umbiegen, damit
// Datenbank/Einstellungen/Backups/Logs unter allen drei Systemen im jeweils
// betriebssystemüblichen Nutzdaten-Verzeichnis landen (Windows %APPDATA%,
// macOS ~/Library/Application Support – Electrons Vorgabe dort passt bereits).
if (process.platform === 'linux') {
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  // Fester Name statt app.getName(): das läse im Entwicklungsbetrieb (npm
  // start) den package.json-Feldnamen "inga", in einem fertigen Paket aber
  // "INGA" (productName) – zwei unterschiedliche Ordner für dieselbe
  // Installation wären selbst genau die Art Stolperfalle, die diese
  // Umstellung eigentlich vermeiden soll.
  app.setPath('userData', path.join(xdgDataHome, 'INGA'));
}

const platform = require('./platform');
const { Store, DEFAULT_SETTINGS, defaultSettingsFor, sanitizeSettings } = require('./store');
const { openDatabase, TABLES } = require('./db');
const repo = require('./repo');
const ferien = require('./ferien');
const { parseIcs } = require('./ics');
const { ferienAbrufen } = require('./ferien-api');
const { heuteISO } = require('./date-utils');
const { importZip, exportZip } = require('./csvio');
const { sichereDatenbankSync, backupHeuteVorhanden, listeBackups, sicherePerpustakaanZipSync, perpustakaanBackupHeuteVorhanden, sichereOriginalPerpustakaanDbSync } = require('./backup');
const perpustakaanLive = require('./perpustakaan-live'); // EXPERIMENTELL, siehe dort
const derbyRuntimeSetup = require('./derby-runtime-setup'); // EXPERIMENTELL: Assistent "Java-Laufzeit reparieren", siehe dort
const { alsExcelCsv } = require('./export');
const { schreibeXlsx } = require('./xlsx');
const { sicher } = require('./fehler');
const { holeBuchdaten } = require('./isbn');
const { coverFuerIsbnLaden } = require('./cover-quellen');
const matrix = require('./matrix');
const { autoUpdater } = require('electron-updater');

/** Dateiname aus Nutzereingabe/Titel absichern – ohne Zeichen, die unter Windows/macOS/Linux in Dateinamen verboten oder problematisch sind. */
function sichererDateiname(name) {
  return String(name || 'Export').replace(/[\\/:*?"<>|]/g, '_').trim() || 'Export';
}

const RENDERER = path.join(__dirname, '..', 'renderer');
const WINDOW_ICON = process.platform === 'linux' ? path.join(__dirname, '..', '..', 'build', 'icon-256.png') : undefined;

let mainWindow = null;
let printWindow = null;
let umlaufPrintWindow = null;
let etikettenPrintWindow = null;
let splashWindow = null;
let store = null;
let db = null;
let coversDir = null;
let dbFile = null;
let backupDir = null;
let activeStyle = platform.nativeStyle();
let coverBulkAbgebrochen = false;
let coverBulkLaeuft = false;
// Auto-Update-Status für die Anzeige in den Einstellungen, siehe
// wireAutoUpdater()/autoUpdatePruefen() unten. `angeboteneVersion` verhindert,
// dass dieselbe Version innerhalb einer laufenden Sitzung nach einem "Später"
// bei jeder erneuten (z. B. periodischen) Prüfung erneut als Dialog aufpoppt.
let updateStatus = { status: 'unbekannt' };
let angeboteneVersion = null;
// EXPERIMENTELL (siehe perpustakaan-live.js): Zustand für die Statusanzeige
// in den Einstellungen. `bereit` entscheidet NICHT allein über einen
// tatsächlichen Zugriff – "Jetzt lesen"/"Jetzt schreiben" prüfen bei jedem
// Aufruf zusätzlich frisch, ob die Datenbank in diesem Moment frei ist
// (Perpustakaan könnte zwischenzeitlich geöffnet worden sein).
let perpustakaanLiveStatus = { aktiv: false };
let laufzeitReparaturLaeuft = false; // EXPERIMENTELL: verhindert doppelten Download bei Doppelklick auf "Java-Laufzeit reparieren"

function settings() {
  return store.get('settings', defaultSettingsFor(platform.nativeStyle(), platform.STYLE_ACCENTS[platform.nativeStyle()]));
}

/**
 * EXPERIMENTELL: sichert die echte Perpustakaan-Datenbank (IMMER, nicht nur
 * einmal täglich) und prüft danach, ob sie gerade zugreifbar ist – siehe
 * perpustakaan-live.js für die Begründung. Aktualisiert nur den Status für
 * die Anzeige in den Einstellungen; ob ein "Jetzt lesen"/"Jetzt schreiben"
 * am Ende wirklich klappt, entscheidet der jeweilige IPC-Handler mit einer
 * eigenen, frischen Prüfung.
 */
async function perpustakaanLiveBereitPruefen() {
  const dbPfad = settings().perpustakaanLiveDbPfad;
  // Kann bei einer großen, echten Datenbank spürbar dauern (der komplette
  // Ordner wird synchron gezippt) – siehe splashStatus(): harmlos, wenn
  // gerade kein Splashscreen (mehr) existiert, z. B. bei "Jetzt prüfen" in
  // den Einstellungen nach dem Start.
  splashStatus('Sichere Perpustakaan-Datenbank …');
  const sicherungsPfad = sichereOriginalPerpustakaanDbSync(dbPfad, backupDir);
  if (!sicherungsPfad) {
    perpustakaanLiveStatus = { aktiv: true, bereit: false, grund: 'Sicherung der Original-Datenbank fehlgeschlagen – Zugriff aus Sicherheitsgründen gesperrt.' };
    return perpustakaanLiveStatus;
  }
  // Schneller, unmittelbarer Vorab-Check statt jedes Mal erst die Bridge
  // zu starten und auf deren ENOENT zu warten – liefert dieselbe Auskunft
  // (siehe perpustakaan-live.js javaPfad()), nur ohne den unnötigen
  // Prozessstart-Versuch.
  if (!perpustakaanLive.laufzeitVorhanden()) {
    perpustakaanLiveStatus = { aktiv: true, bereit: false, laufzeitFehlt: true, sicherungsPfad, grund: perpustakaanLive.LAUFZEIT_FEHLT_HINWEIS };
    return perpustakaanLiveStatus;
  }
  splashStatus('Prüfe Perpustakaan-Zugriff …');
  const ergebnis = await perpustakaanLive.pruefeZugriff(dbPfad);
  if (ergebnis.ok) {
    perpustakaanLiveStatus = { aktiv: true, bereit: true, sicherungsPfad };
  } else if (ergebnis.gesperrt) {
    perpustakaanLiveStatus = { aktiv: true, bereit: false, gesperrt: true, grund: 'Perpustakaan scheint gerade geöffnet zu sein – bitte dort schließen.', sicherungsPfad };
  } else {
    // laufzeitFehlt: siehe perpustakaan-live.js rufeBridgeAuf() – steuert,
    // ob die Einstellungen den "Java-Laufzeit reparieren"-Assistenten
    // anbieten, statt nur die (für Bibliothekspersonal wenig hilfreiche)
    // Fehlermeldung anzuzeigen.
    perpustakaanLiveStatus = { aktiv: true, bereit: false, grund: ergebnis.fehler || 'unbekannter Fehler', laufzeitFehlt: Boolean(ergebnis.laufzeitFehlt), sicherungsPfad };
  }
  return perpustakaanLiveStatus;
}

/**
 * Fasst die drei möglichen Ausgangslagen zusammen (aus/aktiv ohne Ordner/
 * aktiv mit Ordner) – von main.js' Start UND vom "jetzt-pruefen"-IPC-Handler
 * genutzt, damit beide exakt denselben Status berechnen (vorher zwei fast,
 * aber nicht ganz gleiche Kopien dieser Verzweigung).
 */
async function perpustakaanLiveStatusAktualisieren() {
  const s = settings();
  if (!s.perpustakaanLiveAktiv) {
    perpustakaanLiveStatus = { aktiv: false };
    return perpustakaanLiveStatus;
  }
  if (!s.perpustakaanLiveDbPfad) {
    // Aktiviert, aber noch kein Ordner gewählt: eigener, unterscheidbarer
    // Zustand – "aktiv: false" wäre hier irreführend, da der Haken ja
    // bereits gesetzt ist.
    perpustakaanLiveStatus = { aktiv: true, bereit: false, grund: 'Noch kein Ordner der Perpustakaan-Datenbank ausgewählt.' };
    return perpustakaanLiveStatus;
  }
  return perpustakaanLiveBereitPruefen();
}

/**
 * Frische Zugriffsprüfung unmittelbar vor "Jetzt lesen"/"Jetzt schreiben"
 * (der Status aus perpustakaanLiveBereitPruefen()/-StatusAktualisieren()
 * kann inzwischen veraltet sein – Perpustakaan könnte zwischenzeitlich
 * geöffnet worden sein). Hält perpustakaanLiveStatus nebenbei aktuell und
 * liefert bei einem Problem direkt das Fehlerobjekt, das der jeweilige
 * IPC-Handler unverändert zurückgeben kann – `null`, wenn alles klar ist.
 * (Vorher zwei fast, aber nicht ganz gleiche Kopien dieser Prüfung in den
 * beiden Handlern.)
 */
async function perpustakaanLiveZugriffPruefenOderFehler(dbPfad) {
  const zugriff = await perpustakaanLive.pruefeZugriff(dbPfad);
  perpustakaanLiveStatus = zugriff.ok
    ? { aktiv: true, bereit: true }
    : { aktiv: true, bereit: false, gesperrt: Boolean(zugriff.gesperrt), grund: zugriff.gesperrt ? 'Perpustakaan scheint gerade geöffnet zu sein.' : zugriff.fehler };
  if (zugriff.ok) return null;
  return zugriff.gesperrt
    ? { ok: false, gesperrt: true, fehler: 'Perpustakaan scheint gerade geöffnet zu sein – bitte dort schließen und erneut versuchen.' }
    : { ok: false, fehler: zugriff.fehler || 'unbekannter Fehler' };
}

function isDark() {
  const mode = settings().theme;
  if (mode === 'light') return false;
  if (mode === 'dark') return true;
  if (platform.IS_LINUX) {
    const t = platform.systemPalette(activeStyle);
    if (t?.dark !== null && t?.dark !== undefined) return t.dark;
  }
  return require('electron').nativeTheme.shouldUseDarkColors;
}

function windowChrome(kind = 'main') {
  const s = settings();
  activeStyle = platform.resolveStyle(s.uiStyle);
  const background = isDark() ? '#12151c' : '#e8ecf3';
  return platform.windowOptions({ settings: s, style: activeStyle, dark: isDark(), background, kind });
}

/** Merged+validiert einen Settings-Patch, speichert ihn und benachrichtigt das Hauptfenster – von settings:set UND den Element-Anmelde-Handlern genutzt. */
function speichereSettingsPatch(patch) {
  const merged = sanitizeSettings(patch, settings());
  const next = { ...settings(), ...merged };
  store.set('settings', next);
  activeStyle = platform.resolveStyle(next.uiStyle);
  const background = isDark() ? '#12151c' : '#e8ecf3';
  if (mainWindow) platform.applyWindowMaterial(mainWindow, { settings: next, style: activeStyle, background, kind: 'main' });
  mainWindow?.webContents.send('settings:updated', next);
  return next;
}

function harden(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });
}

async function bootstrapPayload() {
  const s = settings();
  activeStyle = platform.resolveStyle(s.uiStyle);
  return {
    settings: s,
    os: platform.OS,
    desktop: platform.DESKTOP,
    ui: activeStyle,
    dark: isDark(),
    accent: s.accent || platform.accentColor(systemPreferences),
    chrome: platform.chromeFor(activeStyle, s),
    palette: platform.systemPalette(activeStyle),
    labels: platform.labels(activeStyle),
    kennzahlen: repo.kennzahlen(db),
    version: app.getVersion(),
  };
}

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    // War 340px – bei einem der längeren Sprüche in sprueche.js (mehrere
    // ganze Sätze) reichte das nicht: der Text wurde vom festen
    // Fenster/"overflow: hidden" im unteren Bereich abgeschnitten statt zu
    // umbrechen ("da kann man den Teil nicht lesen").
    height: 400,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    backgroundColor: '#3d6fe0',
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    webPreferences: { sandbox: true, preload: path.join(__dirname, '..', 'preload', 'splash-preload.js') },
  });
  splashWindow.loadFile(path.join(RENDERER, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

/**
 * Meldet den aktuellen Startschritt an die Splash (siehe splash.js/
 * splash-preload.js) – rein informativ für den Fall, dass der Start
 * einmal länger dauert oder hängen bleibt: bisher zeigte die Splash nur
 * eine unbewegte Ladeanimation, ohne erkennen zu lassen, WO es klemmt.
 * Harmlos außerhalb des Starts (Splash existiert dann nicht mehr) oder
 * ganz ohne Splash (z. B. in Tests) – einfach ein No-Op.
 */
function splashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.webContents.send('splash:status', text);
}

function closeSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
  splashWindow = null;
}

function createMainWindow() {
  const s = settings();
  activeStyle = platform.resolveStyle(s.uiStyle);
  const background = isDark() ? '#12151c' : '#e8ecf3';

  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 880,
    minHeight: 560,
    title: 'INGA',
    show: false,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    ...platform.windowOptions({ settings: s, style: activeStyle, dark: isDark(), background, kind: 'main' }),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  harden(mainWindow);
  mainWindow.loadFile(path.join(RENDERER, 'index.html'));
  mainWindow.once('ready-to-show', () => {
    // Künstliche Verzögerung, damit der Splashscreen tatsächlich sichtbar ist –
    // auf schnellen Rechnern wäre er sonst kaum wahrnehmbar, da das Hauptfenster
    // oft schon nach wenigen hundert Millisekunden bereit ist.
    setTimeout(() => {
      closeSplashWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
    }, 1000 + Math.floor(Math.random() * 2000)); // 1–3 s
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:state', { maximized: true }));
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:state', { maximized: false }));
}

function buildMenu() {
  const isMac = platform.IS_MAC;
  const template = [
    ...(isMac
      ? [
          {
            label: 'INGA',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Einstellungen …', accelerator: 'Cmd+,', click: () => mainWindow?.webContents.send('menu:action', 'settings') },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'Datei',
      submenu: [
        { label: 'Neuer Titel …', accelerator: 'CmdOrCtrl+N', click: () => mainWindow?.webContents.send('menu:action', 'neuer-titel') },
        { label: 'Neuer Leser …', accelerator: 'CmdOrCtrl+Shift+N', click: () => mainWindow?.webContents.send('menu:action', 'neuer-leser') },
        { type: 'separator' },
        { label: 'Bestand importieren …', click: () => mainWindow?.webContents.send('menu:action', 'import') },
        { label: 'Bestand exportieren …', click: () => mainWindow?.webContents.send('menu:action', 'export') },
        { type: 'separator' },
        ...(isMac ? [] : [{ label: 'Einstellungen …', click: () => mainWindow?.webContents.send('menu:action', 'settings') }, { type: 'separator' }]),
        isMac ? { role: 'close' } : { role: 'quit', label: 'Beenden' },
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Rückgängig' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einfügen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Ansicht',
      submenu: [
        { role: 'reload', label: 'Neu laden' },
        { role: 'toggleDevTools', label: 'Entwicklerwerkzeuge' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tatsächliche Größe' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
      ],
    },
    { role: 'windowMenu', label: 'Fenster' },
    {
      role: 'help',
      label: 'Hilfe',
      submenu: [
        {
          label: 'INGA auf GitHub',
          click: () => shell.openExternal('https://github.com/Teyro/INGA'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ---------------------------------------------------------------- Cover */

const COVER_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };

/**
 * Dateiendung aus einem (vom Nutzer per natívem Dialog gewählten) Pfad – auf
 * eine feste Allowlist begrenzt statt roh zu übernehmen. Ein Pfad ohne Punkt
 * würde sonst als "Endung" den kompletten Pfad liefern (inkl. Trennzeichen),
 * woraus beim Zusammenbauen des Zieldateinamens ein ungültiger bzw.
 * unerwarteter Pfad entstehen könnte.
 */
function sichereBildEndung(filePath, fallback = 'jpg') {
  const ext = (filePath.split('.').pop() || '').toLowerCase();
  return Object.hasOwn(COVER_MIME, ext) ? ext : fallback;
}

/** KatalogNi kommt per IPC aus dem Renderer – vor Dateisystemzugriffen als echte, positive Ganzzahl absichern. */
function alsKatalogNi(value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error('Ungültige KatalogNi.');
  return n;
}

async function coverDataUrl(katalogNi) {
  const info = repo.coverInfo(db, alsKatalogNi(katalogNi));
  if (!info) return null;
  try {
    const buf = await fs.readFile(path.join(coversDir, info.dateiname));
    const ext = info.dateiname.split('.').pop().toLowerCase();
    return `data:${COVER_MIME[ext] || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Lädt das Cover eines Titels per ISBN/EAN – probiert dafür mehrere freie
 * Quellen nacheinander (siehe cover-quellen.js: Open Library, Google Books,
 * dann als Rückfallebene die Bildersuche von DuckDuckGo und Qwant per
 * Titel/Autor), damit ein Titel, den die erste Quelle nicht kennt, noch
 * eine weitere Chance bekommt, bevor er als „kein Cover gefunden“ gilt.
 */
async function downloadCoverForKatalog(katalogNiRoh) {
  const katalogNi = alsKatalogNi(katalogNiRoh);
  const katalog = repo.getKatalog(db, katalogNi);
  const isbn = katalog?.ISBN || katalog?.EAN || '';
  if (!String(isbn).replace(/[^0-9Xx]/g, '')) return { ok: false, grund: 'keine ISBN/EAN hinterlegt' };

  try {
    const ergebnis = await coverFuerIsbnLaden(isbn, { titel: katalog?.Titel, autor: katalog?.Autor });
    if (!ergebnis.ok) return ergebnis;
    const dateiname = `${katalogNi}.jpg`;
    await fs.writeFile(path.join(coversDir, dateiname), ergebnis.buf);
    repo.setCover(db, katalogNi, dateiname, ergebnis.quelle);
    return { ok: true, quelle: ergebnis.quelleName };
  } catch (err) {
    return { ok: false, grund: err.message };
  }
}

/**
 * Automatisches Nachladen fehlender Cover, einmal pro Woche – dieselbe Logik
 * wie der manuelle "Cover für alle fehlenden Titel laden"-Knopf
 * (ipcMain 'cover:fetch-all'), nur unbeaufsichtigt im Hintergrund und mit
 * einer kleinen Pause zwischen den Anfragen (rücksichtsvoller gegenüber den
 * freien Bild-APIs als ein manueller, ungeduldiger Lauf). Teilt sich bewusst
 * denselben coverBulkLaeuft-Schalter mit dem manuellen Knopf, damit sich
 * beide nicht in die Quere kommen; ein bereits laufender manueller Abgleich
 * hat Vorrang, der automatische Lauf verschiebt sich dann einfach auf den
 * nächsten Programmstart.
 */
const COVER_AUTO_ABSTAND_MS = 7 * 24 * 60 * 60 * 1000;
async function coverAutoNachladenFallsFaellig() {
  if (!settings().autoCoverNachladenAktiv || coverBulkLaeuft) return;
  const wartung = store.get('wartung', {});
  const letzter = wartung.letzterAutoCoverLauf ? Date.parse(wartung.letzterAutoCoverLauf) : 0;
  if (letzter && Date.now() - letzter < COVER_AUTO_ABSTAND_MS) return;

  coverBulkLaeuft = true;
  try {
    const alle = db.prepare(`SELECT "KatalogNi" FROM "Katalog"`).all();
    for (const { KatalogNi } of alle) {
      if (repo.coverInfo(db, KatalogNi)) continue; // nur fehlende, wie beim manuellen Knopf mit "nurFehlende"
      await downloadCoverForKatalog(KatalogNi);
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  } catch (err) {
    console.error('[wartung] automatisches Cover-Nachladen fehlgeschlagen:', err.message);
  } finally {
    coverBulkLaeuft = false;
    store.set('wartung', { ...store.get('wartung', {}), letzterAutoCoverLauf: new Date().toISOString() });
  }
}

/**
 * Zusätzliche tägliche Sicherung im Benutzer-Dokumente-Ordner
 * ("Dokumente/INGA Backups"), NEBEN der gewohnten Sicherung im
 * INGA-eigenen userData-Ordner (siehe app.whenReady oben) – der ist auf
 * vielen Schulrechnern nicht ohne Weiteres einsehbar/mitnehmbar, das
 * Dokumente-Verzeichnis schon. Nutzt exakt dieselben, bereits an anderer
 * Stelle geprüften backup.js-Funktionen wie die userData-Sicherung, nur mit
 * einem zweiten Zielordner und eigenem "Grund"-Suffix im Dateinamen (leichter
 * unterscheidbar, falls beide Sicherungsordner einmal nebeneinander
 * betrachtet werden).
 */
function dokumenteBackupFallsFaelligSync() {
  if (!settings().dokumenteBackupAktiv) return;
  try {
    const dokumenteBackupDir = path.join(app.getPath('documents'), 'INGA Backups');
    if (!backupHeuteVorhanden(dokumenteBackupDir, 'dokumente')) {
      sichereDatenbankSync(db, dbFile, dokumenteBackupDir, { grund: 'dokumente' });
    }
    if (!perpustakaanBackupHeuteVorhanden(dokumenteBackupDir)) {
      sicherePerpustakaanZipSync(db, dokumenteBackupDir, exportZip);
    }
  } catch (err) {
    // Wirft absichtlich nie weiter – ein fehlendes/nicht schreibbares
    // Dokumente-Verzeichnis (z. B. auf einem Server-Profil) darf den
    // Programmstart nicht verhindern, die userData-Sicherung oben lief zu
    // diesem Zeitpunkt bereits.
    console.error('[wartung] Dokumente-Backup fehlgeschlagen:', err.message);
  }
}

/**
 * Auto-Update über GitHub Releases (siehe package.json "build.publish" +
 * die vom Build erzeugten latest*.yml-Dateien im Release). Fragt IMMER erst
 * nach, bevor irgendetwas heruntergeladen wird (autoDownload = false) – wie
 * ausdrücklich gewünscht: "soll ich jetzt updaten?".
 *
 * Vollautomatisches Herunterladen + Installieren nur unter Windows: INGA
 * ist nicht code-signiert (siehe package.json "win.signExecutable": false /
 * "mac.identity": null – bewusste Entscheidung, ein Zertifikat kostet Geld
 * und ist für ein kostenloses Schulprojekt kaum zu rechtfertigen). Ohne
 * Signatur prüft Squirrel.Mac auf macOS die heruntergeladene App NICHT
 * erfolgreich und würde mit einer kryptischen Fehlermeldung abbrechen -
 * dort (und unter Linux, wo INGA als AppImage/deb/rpm auf sehr
 * unterschiedliche Arten installiert sein kann) öffnet INGA stattdessen die
 * Release-Seite im Browser, die Aktualisierung bleibt dort ein bewusster,
 * manueller Schritt.
 */
function setzeUpdateStatus(next) {
  updateStatus = next;
  mainWindow?.webContents.send('update:status', updateStatus);
}

function wireAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('error', (err) => {
    setzeUpdateStatus({ status: 'fehler', fehler: err.message });
  });

  autoUpdater.on('update-not-available', () => {
    setzeUpdateStatus({ status: 'aktuell' });
  });

  autoUpdater.on('update-available', async (info) => {
    setzeUpdateStatus({ status: 'verfuegbar', version: info.version });
    if (angeboteneVersion === info.version) return; // in dieser Sitzung schon einmal "Später" gewählt
    angeboteneVersion = info.version;
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: process.platform === 'win32' ? ['Jetzt herunterladen', 'Später'] : ['Release-Seite öffnen', 'Später'],
      defaultId: 0,
      cancelId: 1,
      title: 'INGA-Update verfügbar',
      message: `INGA ${info.version} ist verfügbar (installiert: ${app.getVersion()}).`,
      detail: process.platform === 'win32'
        ? 'INGA lädt das Update im Hintergrund herunter und meldet sich, sobald ein Neustart zum Installieren ansteht.'
        : 'Für dieses Betriebssystem installiert INGA Updates nicht automatisch – die Downloadseite öffnet sich im Browser, die Installation bleibt wie gewohnt ein manueller Schritt.',
    });
    if (response !== 0) return;
    if (process.platform === 'win32') {
      autoUpdater.downloadUpdate();
    } else {
      shell.openExternal(`https://github.com/Teyro/INGA/releases/tag/v${info.version}`);
    }
  });

  autoUpdater.on('download-progress', (p) => {
    setzeUpdateStatus({ status: 'laedt', prozent: Math.round(p.percent) });
  });

  autoUpdater.on('update-downloaded', async () => {
    setzeUpdateStatus({ status: 'bereit' });
    if (!mainWindow) return;
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      buttons: ['Jetzt neu starten und installieren', 'Später'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update heruntergeladen',
      message: 'Das Update ist bereit. INGA jetzt neu starten, um es zu installieren?',
      detail: 'Bitte vorher laufende Vorgänge (Ausleihe, Rückgabe, offene Bearbeitung) abschließen.',
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
}

/**
 * Manuelle ODER stille automatische Prüfung – wirft nie, nur
 * Statusänderung über updateStatus. `manuell` (Knopf "Jetzt nach Updates
 * suchen" in den Einstellungen) setzt angeboteneVersion zurück: sonst
 * bliebe ein einmal mit "Später" weggeklickter automatischer Vorschlag
 * für den Rest der Sitzung stumm – auch wenn die Kollegin es sich anders
 * überlegt und GENAU DESHALB aktiv noch einmal nachfragt.
 */
async function autoUpdatePruefen(manuell = false) {
  if (manuell) angeboteneVersion = null;
  // In der Entwicklung (npm start/dev, ungepackt) gibt es keine latest.yml
  // und keinen sinnvollen Vergleichswert – electron-updater bricht das sonst
  // nur mit einer für Entwickler verwirrenden Fehlermeldung ab.
  if (!app.isPackaged) {
    setzeUpdateStatus({ status: 'entwicklung' });
    return updateStatus;
  }
  try {
    setzeUpdateStatus({ status: 'prueft' });
    await autoUpdater.checkForUpdates();
  } catch (err) {
    setzeUpdateStatus({ status: 'fehler', fehler: err.message });
  }
  return updateStatus;
}

/* ------------------------------------------------------ Mahnungen drucken */

async function openMahnungPrintWindow(briefe) {
  const s = settings();
  const data = { briefe, settings: { ...s, os: platform.OS, ui: activeStyle } };

  if (printWindow && !printWindow.isDestroyed()) {
    printWindow.focus();
    printWindow.webContents.send('print:data', data);
    return;
  }

  printWindow = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'Mahnungen',
    show: false,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    ...windowChrome('print'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  harden(printWindow);
  printWindow.loadFile(path.join(RENDERER, 'print.html'));
  printWindow.webContents.once('did-finish-load', () => {
    printWindow.webContents.send('print:data', data);
    printWindow.show();
  });
  printWindow.on('closed', () => {
    printWindow = null;
  });
}

/* ---------------------------------------------------------- Umlaufliste drucken */

async function openUmlaufPrintWindow(payload) {
  const s = settings();
  const data = { ...payload, settings: { ...s, os: platform.OS, ui: activeStyle } };

  if (umlaufPrintWindow && !umlaufPrintWindow.isDestroyed()) {
    umlaufPrintWindow.focus();
    umlaufPrintWindow.webContents.send('print:data', data);
    return;
  }

  umlaufPrintWindow = new BrowserWindow({
    width: 1100,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'Im Umlauf',
    show: false,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    ...windowChrome('print'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  harden(umlaufPrintWindow);
  umlaufPrintWindow.loadFile(path.join(RENDERER, 'umlauf-print.html'));
  umlaufPrintWindow.webContents.once('did-finish-load', () => {
    umlaufPrintWindow.webContents.send('print:data', data);
    umlaufPrintWindow.show();
  });
  umlaufPrintWindow.on('closed', () => {
    umlaufPrintWindow = null;
  });
}

async function openEtikettenPrintWindow(payload) {
  const s = settings();
  const data = { ...payload, settings: { ...s, os: platform.OS, ui: activeStyle } };

  if (etikettenPrintWindow && !etikettenPrintWindow.isDestroyed()) {
    etikettenPrintWindow.focus();
    etikettenPrintWindow.webContents.send('print:data', data);
    return;
  }

  etikettenPrintWindow = new BrowserWindow({
    width: 900,
    height: 820,
    minWidth: 640,
    minHeight: 480,
    title: 'Etiketten',
    show: false,
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    ...windowChrome('print'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  harden(etikettenPrintWindow);
  etikettenPrintWindow.loadFile(path.join(RENDERER, 'etiketten-print.html'));
  etikettenPrintWindow.webContents.once('did-finish-load', () => {
    etikettenPrintWindow.webContents.send('print:data', data);
    etikettenPrintWindow.show();
  });
  etikettenPrintWindow.on('closed', () => {
    etikettenPrintWindow = null;
  });
}

/* -------------------------------------------------------------------- IPC */

/**
 * Spielt eine Sicherung ein und startet INGA neu. Kopiert `quelle` ERST in
 * eine temporäre Datei, SOLANGE die laufende Datenbank noch geöffnet ist –
 * schlägt das fehl (Speicherplatz, Rechte), bleibt die App unberührt
 * nutzbar und der Fehler kommt sauber über sicher() zurück, statt dass die
 * Datenbank schon geschlossen wäre. Erst danach wird gesichert, die
 * laufende Datenbank geschlossen und die temporäre Datei an ihre Stelle
 * verschoben (ein Verschieben innerhalb desselben Ordners ist auf allen
 * drei Systemen praktisch atomar). Etwaige WAL-/Journal-Reste der bisher
 * laufenden Datenbank werden entfernt, damit sie nicht versehentlich auf
 * die neu eingespielte Datei angewendet werden.
 */
async function einspielenUndNeustarten(quelle) {
  const tmp = `${dbFile}.einspielen-tmp`;
  await fs.copyFile(quelle, tmp);
  sichereDatenbankSync(db, dbFile, backupDir, { grund: 'vor-einspielen' });
  db.close();
  await fs.rename(tmp, dbFile);
  for (const suffix of ['-wal', '-shm', '-journal']) {
    await fs.unlink(`${dbFile}${suffix}`).catch(() => {});
  }
  app.relaunch();
  app.exit(0);
}

function registerIpc() {
  ipcMain.handle('bootstrap', () => bootstrapPayload());

  ipcMain.handle('settings:set', (_e, patch) => speichereSettingsPatch(patch));
  ipcMain.handle('settings:read', () => settings());

  ipcMain.handle('katalog:search', (_e, filter, seitenOptionen) => repo.searchKatalog(db, filter, seitenOptionen));
  ipcMain.handle('katalog:ueberfaellige-ni', () => repo.katalogNiMitUeberfaelligemExemplar(db, settings()));
  ipcMain.handle('katalog:get', (_e, katalogNi) => repo.getKatalog(db, katalogNi));
  ipcMain.handle('katalog:save', sicher((_e, row) => repo.saveKatalog(db, row)));
  ipcMain.handle('katalog:delete', sicher((_e, katalogNi) => repo.deleteKatalog(db, katalogNi)));
  ipcMain.handle('katalog:exemplare', (_e, katalogNi) => repo.exemplareFuer(db, katalogNi));
  ipcMain.handle('katalog:exemplare-mit-status', (_e, katalogNi) => repo.exemplareMitStatusFuer(db, katalogNi));
  ipcMain.handle('katalog:exemplare-mit-ausleihe', (_e, katalogNi) => repo.exemplareMitAusleiheInfoFuer(db, katalogNi, settings()));
  ipcMain.handle('katalog:top-ausgeliehen', (_e, limit) => repo.topAusgelieheneBuecher(db, limit || 10));
  ipcMain.handle('katalog:ausleih-statistik', (_e, katalogNi) => repo.ausleihStatistikFuerKatalog(db, katalogNi));
  ipcMain.handle('katalog:isbn-nachschlagen', (_e, isbn) => holeBuchdaten(isbn));

  ipcMain.handle('statistik:pro-monat', (_e, monate) => repo.statistikAusleihenProMonat(db, monate || 12));
  ipcMain.handle('statistik:pro-klasse', () => repo.statistikAusleihenProKlasse(db));
  ipcMain.handle('statistik:pro-kategorie', () => repo.statistikAusleihenProKategorie(db));
  ipcMain.handle('statistik:ladenhueter', (_e, tage) => repo.ladenhueter(db, tage || 365));
  ipcMain.handle('statistik:verlustliste', () => repo.verlustliste(db));

  ipcMain.handle('medium:save', sicher((_e, row) => repo.saveMedium(db, row)));
  ipcMain.handle('medium:delete', sicher((_e, medienNi) => repo.deleteMedium(db, medienNi, 'inga')));
  ipcMain.handle('medium:status', (_e, medienNi) => repo.exemplarStatus(db, medienNi));
  ipcMain.handle('medium:find-etikett', (_e, etikett) => repo.findExemplarByEtikett(db, etikett));
  ipcMain.handle('medium:vorschlaege', (_e, query) => repo.medienVorschlaege(db, query));

  ipcMain.handle('leser:search', (_e, filter, seitenOptionen) => repo.searchLeser(db, filter, seitenOptionen));
  ipcMain.handle('leser:vorschlaege', (_e, query) => repo.leserVorschlaege(db, query));
  ipcMain.handle('leser:jahrgaenge', () => repo.distinctJahrgaenge(db));
  ipcMain.handle('leser:get', (_e, leserNi) => repo.getLeser(db, leserNi));
  ipcMain.handle('leser:save', sicher((_e, row) => repo.saveLeser(db, row)));
  ipcMain.handle('leser:delete', sicher((_e, leserNi) => repo.deleteLeser(db, leserNi, 'inga')));
  ipcMain.handle('leser:gesperrt', (_e, leserNi) => repo.leserGesperrt(db, leserNi));
  ipcMain.handle('leser:sperren', sicher((_e, { leserNi, tage }) => repo.leserSperren(db, leserNi, { tage })));
  ipcMain.handle('leser:entsperren', sicher((_e, leserNi) => repo.leserEntsperren(db, leserNi)));
  ipcMain.handle('leser:abschluss-meldung', () => repo.abschlussMeldung(db, settings()));
  ipcMain.handle('leser:abschluss-verschieben', sicher((_e, leserNis) => repo.kinderInPapierkorbVerschieben(db, leserNis, 'inga')));
  ipcMain.handle('leser:offene-ausleihen', (_e, leserNi) => repo.offeneAusleihenVonLeser(db, leserNi));
  ipcMain.handle('leser:mahnhistorie', (_e, leserNi) => repo.mahnhistorieVonLeser(db, leserNi));
  ipcMain.handle('leser:vormerkungen', (_e, leserNi) => repo.vormerkungenVonLeser(db, leserNi));

  ipcMain.handle('vormerkung:liste', (_e, katalogNi) => repo.vormerkungenFuer(db, katalogNi));
  ipcMain.handle('vormerkung:anlegen', sicher((_e, { katalogNi, leserNi }) => repo.vormerken(db, { katalogNi, leserNi })));
  ipcMain.handle('vormerkung:loeschen', sicher((_e, id) => {
    repo.vormerkungLoeschen(db, id);
    return { ok: true };
  }));

  ipcMain.handle('ausleihe:alle-offen', () => repo.alleOffenenAusleihen(db));
  ipcMain.handle('ausleihe:ueberfaellige-alle', () => repo.ueberfaelligeAusleihen(db, settings()));
  ipcMain.handle('ausleihe:ausleihen', (_e, payload) => {
    try {
      return { ok: true, ...repo.ausleihen(db, { ...payload, einstellungen: settings() }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ausleihe:zurueckgeben', sicher((_e, id) => repo.zurueckgeben(db, id)));
  ipcMain.handle('ausleihe:verlaengern', (_e, id) => {
    try {
      return { ok: true, ...repo.verlaengern(db, id, settings()) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ausleihe:verschieben-alle', (_e, tage) => {
    const anzahl = repo.verschiebeOffeneAusleihen(db, tage);
    return { anzahl };
  });
  ipcMain.handle('ausleihe:umlaufliste', () => repo.umlaufliste(db, settings()));

  ipcMain.handle('umlauf:drucken', async (_e, payload) => {
    await openUmlaufPrintWindow(payload);
    return { ok: true };
  });

  ipcMain.handle('etiketten:drucken', async (_e, payload) => {
    await openEtikettenPrintWindow(payload);
    return { ok: true };
  });

  /* ------------------------------------------------------- Allgemeiner Export */

  ipcMain.handle('export:csv', sicher(async (event, { dateiname, spalten, zeilen }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Als CSV exportieren',
      defaultPath: `${sichererDateiname(dateiname)}.csv`,
      filters: [{ name: 'CSV (Excel, Semikolon-getrennt)', extensions: ['csv'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, alsExcelCsv(spalten, zeilen), 'utf8');
    return result.filePath;
  }));

  ipcMain.handle('export:xlsx', sicher(async (event, { dateiname, blattname, spalten, zeilen }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Als Excel-Datei exportieren',
      defaultPath: `${sichererDateiname(dateiname)}.xlsx`,
      filters: [{ name: 'Excel-Arbeitsmappe', extensions: ['xlsx'] }],
    });
    if (result.canceled || !result.filePath) return null;
    schreibeXlsx(result.filePath, { blattname: blattname || dateiname, spalten, zeilen });
    return result.filePath;
  }));

  ipcMain.handle('mahnung:ueberfaellige', () => repo.ueberfaelligeMitStufe(db, settings()));
  ipcMain.handle('mahnung:rueckstandsliste', (_e, schwelleTage) => repo.rueckstandsliste(db, settings(), schwelleTage));
  /**
   * Erstellt für die ausgewählten Positionen EINE der beiden Stufen –
   * bewusst von der Kollegin am Knopf gewählt ("Erinnerung erstellen" /
   * "Mahnung erstellen", Abschnitt 5.2), nicht mehr automatisch pro Fall
   * bestimmt. Alle Positionen bekommen dieselbe Stufe, gruppiert wie bisher
   * zu einem Schreiben je Kind. Protokolliert je Fall, welche Stufe verschickt
   * wurde (repo.mahnungEintragen/IngaStufe) – Grundlage für die
   * "Erinnerung am …"-Anzeige in der Rückstandsliste.
   */
  ipcMain.handle('mahnung:erzeugen-und-drucken', async (_e, { positionen, stufeIndex }) => {
    const s = settings();
    const stufe = s.mahnstufen[stufeIndex] || s.mahnstufen[0] || { text: 'Mahnung', briefText: '' };
    const nachLeser = new Map();
    for (const p of positionen) {
      const gebuehr = repo.berechneMahngebuehr(p.tageUeberfaellig, s);
      repo.mahnungEintragen(db, { medienNi: p.MedienNi, leserNi: p.LeserNi, auslDatum: p.AuslDatum, gebuehr, stufe: stufeIndex + 1 });
      const position = { ...p, gebuehr, stufe, stufeIndex };
      if (!nachLeser.has(p.LeserNi)) nachLeser.set(p.LeserNi, { leser: repo.getLeser(db, p.LeserNi), posten: [] });
      nachLeser.get(p.LeserNi).posten.push(position);
    }
    const briefe = [...nachLeser.values()].map(({ leser, posten }) => ({
      leser,
      posten,
      summe: posten.reduce((sum, p) => sum + Number(p.gebuehr || 0), 0),
      mahngebuehrenAktiv: s.mahngebuehrenAktiv,
      absenderName: s.absenderName,
      absenderAdresse: s.absenderAdresse,
      absenderEmail: s.absenderEmail,
      absenderTelefon: s.absenderTelefon,
      mahnBetreffVorlage: s.mahnBetreffVorlage,
      mahnSchluss: s.mahnSchluss,
      mahnLogoDataUrl: s.mahnLogoDataUrl,
      bibliotheksName: s.bibliotheksName,
      datum: new Date().toLocaleDateString('de-DE'),
    }));
    await openMahnungPrintWindow(briefe);
    return { anzahl: briefe.length };
  });

  /**
   * "Probe-Mahnung drucken" im Mahnstufen-Editor (Einstellungen): exakt
   * derselbe Druck-Weg wie oben (mahnung:erzeugen-und-drucken), aber mit
   * frei erfundenen Beispieldaten statt echter Ausleihen – schreibt
   * bewusst NICHTS in die Datenbank (kein repo.mahnungEintragen), damit
   * ein Probedruck niemals echte Mahnhistorie oder Karteneinträge anlegt.
   * Nutzt die echten Absender-/Logo-/Schluss-Einstellungen, damit das
   * Ergebnis wirklich zeigt, was gedruckt würde.
   */
  ipcMain.handle('mahnung:probe-drucken', sicher(async (_e, stufeIndex) => {
    const s = settings();
    const stufe = s.mahnstufen[stufeIndex] || s.mahnstufen[0] || { text: 'Mahnung', briefText: '' };
    const heute = new Date();
    const faelligkeit = new Date(heute.getTime() - (stufe.tageUeberfaellig || 7) * 86400000);
    const gebuehr = repo.berechneMahngebuehr(stufe.tageUeberfaellig || 7, s);
    const posten = [{
      Titel: 'Beispielbuch – Die Reise zum Mond',
      AuslDatum: new Date(faelligkeit.getTime() - (s.leihfristTage || 7) * 86400000).toISOString().slice(0, 10),
      faelligAm: faelligkeit.toISOString().slice(0, 10),
      tageUeberfaellig: stufe.tageUeberfaellig || 7,
      gebuehr,
      stufe,
      stufeIndex,
    }];
    const brief = {
      leser: { Vorname: 'Anna', Nachname: 'Musterkind', Strasse: 'Musterstraße 1', PLZ: '12345', Ort: 'Musterstadt' },
      posten,
      summe: gebuehr,
      mahngebuehrenAktiv: s.mahngebuehrenAktiv,
      absenderName: s.absenderName,
      absenderAdresse: s.absenderAdresse,
      absenderEmail: s.absenderEmail,
      absenderTelefon: s.absenderTelefon,
      mahnBetreffVorlage: s.mahnBetreffVorlage,
      mahnSchluss: s.mahnSchluss,
      mahnLogoDataUrl: s.mahnLogoDataUrl,
      bibliotheksName: s.bibliotheksName,
      datum: heute.toLocaleDateString('de-DE'),
      probe: true,
    };
    await openMahnungPrintWindow([brief]);
    return { ok: true };
  }));

  // Keine eigene SMTP-Anbindung (kein Konto/Passwort, das INGA verwalten
  // müsste) – öffnet stattdessen das auf dem Rechner eingerichtete
  // E-Mail-Programm mit vorausgefülltem Brief, ganz ohne neue Abhängigkeit.
  ipcMain.handle('mail:oeffnen', sicher(async (_e, { to, subject, body }) => {
    if (!to) throw new Error('Keine E-Mail-Adresse hinterlegt.');
    const url = `mailto:${to}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
    await shell.openExternal(url);
  }));

  /* ------------------------------------------------------- Element (Matrix) */

  ipcMain.handle('element:anmelden', sicher(async (_e, { benutzername, passwort }) => {
    if (!benutzername || !passwort) throw new Error('Bitte Benutzername und Passwort angeben.');
    const homeserver = await matrix.homeserverFuerEinstellungen(settings());
    const { accessToken, userId } = await matrix.anmelden(homeserver, benutzername, passwort);
    return speichereSettingsPatch({ matrixZugangstoken: accessToken, matrixVersenderId: userId });
  }));

  ipcMain.handle('element:verbindung-testen', sicher(async () => {
    const s = settings();
    const token = String(s.matrixZugangstoken || '').trim();
    if (!token) throw new Error('Kein Zugangstoken hinterlegt – bitte zuerst anmelden.');
    const homeserver = await matrix.homeserverFuerEinstellungen(s);
    const userId = await matrix.werBinIch(homeserver, token);
    return speichereSettingsPatch({ matrixVersenderId: userId });
  }));

  ipcMain.handle('element:trennen', () => speichereSettingsPatch({ matrixZugangstoken: '', matrixVersenderId: '' }));

  ipcMain.handle('element:senden', async (_e, nachrichten) => {
    const s = settings();
    const ergebnisse = [];
    for (const n of nachrichten) {
      try {
        const { zielId } = await matrix.sendeAnPerson(s, n);
        ergebnisse.push({ ok: true, name: `${n.vorname} ${n.nachname}`, zielId });
      } catch (err) {
        ergebnisse.push({ ok: false, name: `${n.vorname} ${n.nachname}`, fehler: err.message });
      }
    }
    return ergebnisse;
  });

  ipcMain.handle('medart:einstellungen-speichern', sicher((_e, { medArtKb, frist, fristVerl, verbergen }) => {
    repo.medArtEinstellungenSpeichern(db, medArtKb, { frist, fristVerl, verbergen });
    return { ok: true };
  }));

  /* ------------------------------------------------------------ Ferien */

  ipcMain.handle('ferien:liste', () => ferien.listeFerien(db));
  ipcMain.handle('ferien:liste-gruppiert', () => ferien.gruppiereFuerAnzeige(db));
  ipcMain.handle('ferien:vorschau-fuer-import', (_e, termine) => ferien.vorschauFuerImport(db, termine));
  ipcMain.handle('ferien:schuljahr-loeschen', (_e, startJahr) => ({ anzahl: ferien.loescheSchuljahr(db, startJahr) }));
  ipcMain.handle('ferien:speichern', (_e, row) => {
    try {
      return { ok: true, id: ferien.saveFerienEintrag(db, row) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ferien:loeschen', (_e, id) => {
    ferien.deleteFerienEintrag(db, id);
    return { ok: true };
  });

  ipcMain.handle('ferien:import-ics-datei', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'ICS-Kalenderdatei importieren',
      properties: ['openFile'],
      filters: [{ name: 'Kalender (ICS)', extensions: ['ics'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    try {
      const text = await fs.readFile(result.filePaths[0], 'utf8');
      return { ok: true, termine: parseIcs(text) };
    } catch (err) {
      return { ok: false, error: `Datei konnte nicht gelesen werden: ${err.message}` };
    }
  });

  ipcMain.handle('ferien:import-ics-url', async (_e, url) => {
    if (!/^https?:\/\//i.test(String(url || ''))) return { ok: false, error: 'Bitte eine gültige http(s)-Adresse angeben.' };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return { ok: false, error: `Server antwortete mit HTTP ${res.status}.` };
      const text = await res.text();
      return { ok: true, termine: parseIcs(text) };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? 'Zeitüberschreitung beim Abruf.' : `Kalender nicht erreichbar: ${err.message}` };
    } finally {
      clearTimeout(timeout);
    }
  });

  ipcMain.handle('ferien:api-abrufen', async () => ferienAbrufen(heuteISO()));

  ipcMain.handle('ferien:import-uebernehmen', (_e, eintraege) => {
    try {
      return { ok: true, ...ferien.ferienImportUebernehmen(db, eintraege) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('ausleihe:ferien-vorschau', () => repo.vorschauFristenMitFerien(db, settings()));

  ipcMain.handle('mahnung:logo-auswaehlen', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Logo auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const ext = sichereBildEndung(filePath, 'png');
    const buf = await fs.readFile(filePath);
    if (buf.byteLength > 1_500_000) return { error: 'Datei zu groß (max. 1,5 MB).' };
    return { dataUrl: `data:${COVER_MIME[ext]};base64,${buf.toString('base64')}` };
  });

  ipcMain.handle('cover:get', (_e, katalogNi) => coverDataUrl(katalogNi));
  ipcMain.handle('cover:fetch-one', async (_e, katalogNi) => downloadCoverForKatalog(katalogNi));
  ipcMain.handle('cover:upload', async (_e, katalogNiRoh) => {
    const katalogNi = alsKatalogNi(katalogNiRoh);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Cover auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const quelle = result.filePaths[0];
    const ext = sichereBildEndung(quelle, 'jpg');
    const dateiname = `${katalogNi}.${ext}`;
    await fs.copyFile(quelle, path.join(coversDir, dateiname));
    // altes Cover mit ggf. anderer Endung entfernen, damit nicht zwei Dateien liegen bleiben
    const bisher = repo.coverInfo(db, katalogNi);
    if (bisher && bisher.dateiname !== dateiname) {
      await fs.unlink(path.join(coversDir, bisher.dateiname)).catch(() => {});
    }
    repo.setCover(db, katalogNi, dateiname, 'upload');
    return { ok: true };
  });
  ipcMain.handle('cover:delete', async (_e, katalogNiRoh) => {
    const katalogNi = alsKatalogNi(katalogNiRoh);
    const info = repo.coverInfo(db, katalogNi);
    if (info) await fs.unlink(path.join(coversDir, info.dateiname)).catch(() => {});
    repo.removeCover(db, katalogNi);
    return { ok: true };
  });
  ipcMain.handle('cover:fetch-all', async (event, { nurFehlende = true } = {}) => {
    // Schützt vor zwei sich überlappenden Sammel-Downloads (z. B. durch einen
    // Doppelklick, bevor der Button in der Oberfläche deaktiviert ist) – die
    // beiden Läufe würden sich sonst denselben coverBulkAbgebrochen-Schalter
    // teilen und sich gegenseitig ins Gehege kommen.
    if (coverBulkLaeuft) return { done: 0, total: 0, gefunden: 0, fehler: 0, abgebrochen: false, bereitsAktiv: true };
    coverBulkLaeuft = true;
    coverBulkAbgebrochen = false;
    try {
      const alle = db.prepare(`SELECT "KatalogNi" FROM "Katalog"`).all();
      let done = 0, gefunden = 0, fehler = 0;
      for (const { KatalogNi } of alle) {
        if (coverBulkAbgebrochen) break;
        done += 1;
        if (nurFehlende && repo.coverInfo(db, KatalogNi)) {
          event.sender.send('cover:progress', { done, total: alle.length, gefunden, fehler, uebersprungen: true });
          continue;
        }
        const result = await downloadCoverForKatalog(KatalogNi);
        if (result.ok) gefunden += 1; else fehler += 1;
        event.sender.send('cover:progress', { done, total: alle.length, gefunden, fehler });
      }
      return { done, total: alle.length, gefunden, fehler, abgebrochen: coverBulkAbgebrochen };
    } finally {
      coverBulkLaeuft = false;
    }
  });
  ipcMain.handle('cover:fetch-all-cancel', () => { coverBulkAbgebrochen = true; });

  ipcMain.handle('stammdaten:get', () => repo.stammdaten(db));
  ipcMain.handle('kennzahlen:get', () => repo.kennzahlen(db));

  ipcMain.handle('bestand:import', sicher(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Bestand importieren',
      properties: ['openFile'],
      filters: [{ name: 'Perpustakaan-Export', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    importZip(db, result.filePaths[0]);
    return { datei: result.filePaths[0], kennzahlen: repo.kennzahlen(db) };
  }));

  ipcMain.handle('bestand:export', sicher(async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Bestand exportieren',
      defaultPath: `inga_export_${heuteISO()}.zip`,
      filters: [{ name: 'Perpustakaan-Export', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    exportZip(db, result.filePath);
    return result.filePath;
  }));

  /* ------------------------------------------------------------ Backups */

  ipcMain.handle('backup:liste', () => listeBackups(backupDir));

  ipcMain.handle('backup:jetzt', sicher(async () => {
    const pfad = sichereDatenbankSync(db, dbFile, backupDir, { grund: 'manuell' });
    if (!pfad) throw new Error('Sicherung konnte nicht erstellt werden – bitte Speicherplatz und Schreibrechte prüfen.');
    return { pfad, liste: listeBackups(backupDir) };
  }));

  /**
   * Spielt eine Sicherung ein: sichert vorsorglich noch einmal den
   * aktuellen Stand (falls die Auswahl ein Versehen war), kopiert die
   * gewählte Datei über die laufende Datenbank und startet INGA neu – ein
   * frischer openDatabase()-Aufruf prüft dabei automatisch die
   * Schema-Version der eingespielten Datei und migriert sie bei Bedarf,
   * genau wie bei jedem normalen Programmstart.
   */
  ipcMain.handle('backup:einspielen', sicher(async (_e, dateiname) => {
    const quelle = path.join(backupDir, path.basename(String(dateiname || '')));
    if (path.dirname(quelle) !== backupDir) throw new Error('Ungültige Sicherungsdatei.');
    await fs.access(quelle).catch(() => {
      throw new Error('Diese Sicherung wurde nicht gefunden – wurde sie inzwischen gelöscht?');
    });
    await einspielenUndNeustarten(quelle);
  }));

  ipcMain.handle('backup:einspielen-datei', sicher(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Sicherung einspielen',
      properties: ['openFile'],
      filters: [{ name: 'INGA-Datenbank', extensions: ['sqlite3'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    await einspielenUndNeustarten(result.filePaths[0]);
  }));

  /* ------------------------------------------- EXPERIMENTELL: Perpustakaan-Direktzugriff (siehe perpustakaan-live.js) */

  ipcMain.handle('perpustakaan-live:status', () => perpustakaanLiveStatus);

  /**
   * Erneute Prüfung AUF ANFRAGE (Ordner gerade gewählt, Zugriff gerade
   * aktiviert) – dieselbe Sicherung+Prüfung wie beim Programmstart, damit
   * die Statusanzeige nicht bis zum nächsten Neustart veraltet bleibt.
   */
  ipcMain.handle('perpustakaan-live:jetzt-pruefen', sicher(() => perpustakaanLiveStatusAktualisieren()));

  ipcMain.handle('perpustakaan-live:pfad-waehlen', sicher(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Ordner der Perpustakaan-Datenbank wählen',
      properties: ['openDirectory'],
      message: 'Der Ordner mit service.properties/log/seg0 der echten Apache-Derby-Datenbank (NICHT der Perpustakaan-Programmordner selbst).',
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return result.filePaths[0];
  }));

  /** Live aus Perpustakaan lesen: exakt derselbe Import-Weg wie eine hochgeladene Sicherung (csvio.importZip) – der Java-Bridge-Export liefert nur dieselbe Zip-Form. */
  ipcMain.handle('perpustakaan-live:jetzt-lesen', sicher(async () => {
    const s = settings();
    if (!s.perpustakaanLiveAktiv || !s.perpustakaanLiveDbPfad) throw new Error('Der experimentelle Direktzugriff ist nicht aktiv.');
    const fehler = await perpustakaanLiveZugriffPruefenOderFehler(s.perpustakaanLiveDbPfad);
    if (fehler) return fehler;
    // Vor dem Überschreiben des eigenen Bestands per Import: Rückfall-
    // möglichkeit sichern und deren Erfolg auch wirklich prüfen (anders als
    // bei den täglichen Backups oben darf hier ein Fehlschlag nicht
    // stillschweigend durchgehen – sonst gäbe es beim Import keinen
    // Sicherheitsnetz mehr).
    if (!sichereDatenbankSync(db, dbFile, backupDir, { grund: 'vor-perpustakaan-lesen' })) {
      return { ok: false, fehler: 'Sicherung des aktuellen INGA-Bestands fehlgeschlagen – aus Sicherheitsgründen abgebrochen, es wurde nichts importiert.' };
    }
    const zielZip = path.join(os.tmpdir(), `inga-perpustakaan-dump-${Date.now()}.zip`);
    try {
      const ergebnis = await perpustakaanLive.dumpNachZip(s.perpustakaanLiveDbPfad, TABLES, zielZip);
      if (!ergebnis.ok) return ergebnis;
      importZip(db, zielZip);
      return { ok: true, kennzahlen: repo.kennzahlen(db) };
    } finally {
      fs.unlink(zielZip).catch(() => {});
    }
  }));

  /**
   * Schreibt INGAs aktuellen Stand in die echte Perpustakaan-Datenbank –
   * exakt derselbe Export-Weg wie "Bestand exportieren" (csvio.exportZip),
   * nur dass das Ergebnis-Zip statt auf die Festplatte über die Java-
   * Bridge in die Datenbank geladen wird. Sichert die Original-Datenbank
   * VOR JEDEM Schreibversuch noch einmal frisch (nicht nur einmal beim
   * Programmstart, siehe perpustakaanLiveBereitPruefen) – in einer langen
   * Sitzung mit mehreren Schreibversuchen wäre sonst nur der allererste
   * durch einen wirklich aktuellen Stand abgesichert. Sehr bewusst KEIN
   * eigener "Bist du sicher?"-Text hier: das gehört in die Oberfläche
   * (mehrfache, unmissverständliche Bestätigung), dieser Handler tut, worum
   * er gebeten wird, prüft aber die Sperre frisch und lehnt ohne aktive
   * Einstellung oder fehlgeschlagene Sicherung grundsätzlich ab.
   */
  ipcMain.handle('perpustakaan-live:jetzt-schreiben', sicher(async () => {
    const s = settings();
    if (!s.perpustakaanLiveAktiv || !s.perpustakaanLiveDbPfad) throw new Error('Der experimentelle Direktzugriff ist nicht aktiv.');
    const fehler = await perpustakaanLiveZugriffPruefenOderFehler(s.perpustakaanLiveDbPfad);
    if (fehler) return fehler;
    if (!sichereOriginalPerpustakaanDbSync(s.perpustakaanLiveDbPfad, backupDir)) {
      return { ok: false, fehler: 'Sicherung der Original-Perpustakaan-Datenbank fehlgeschlagen – aus Sicherheitsgründen abgebrochen, es wurde nichts geschrieben.' };
    }
    const quellZip = path.join(os.tmpdir(), `inga-perpustakaan-schreiben-${Date.now()}.zip`);
    try {
      exportZip(db, quellZip);
      return await perpustakaanLive.ladeAusZip(s.perpustakaanLiveDbPfad, quellZip);
    } finally {
      fs.unlink(quellZip).catch(() => {});
    }
  }));

  /**
   * Assistent "Java-Laufzeit reparieren": lädt die fehlende Java-Laufzeit +
   * Derby-Jars in den userData-Ordner nach (siehe
   * perpustakaan-live.js "zusätzliche Laufzeit-Basis" +
   * derby-runtime-setup.js) – für den Fall, dass die mit dem Programm
   * ausgelieferte Laufzeit auf einer echten Installation fehlt oder nicht
   * startbar ist (z. B. von einem Virenschutzprogramm entfernt). Braucht
   * eine Internetverbindung; meldet einen verständlichen Fehler, wenn keine
   * besteht, statt nur eine kryptische Netzwerk-Exception durchzureichen.
   */
  ipcMain.handle('perpustakaan-live:laufzeit-herunterladen', sicher(async () => {
    if (laufzeitReparaturLaeuft) return { ok: false, fehler: 'Die Reparatur läuft bereits – bitte kurz warten.' };
    laufzeitReparaturLaeuft = true;
    try {
      const ziel = path.join(app.getPath('userData'), 'derby-runtime');
      await derbyRuntimeSetup.richteVollstaendigEin(ziel);
      return await perpustakaanLiveStatusAktualisieren();
    } catch (err) {
      return { ok: false, fehler: `Herunterladen fehlgeschlagen (${err.message}) – bitte Internetverbindung prüfen und erneut versuchen.` };
    } finally {
      laufzeitReparaturLaeuft = false;
    }
  }));

  ipcMain.handle('papierkorb:leser-liste', () => repo.papierkorbLeserListe(db));
  ipcMain.handle('papierkorb:medien-liste', () => repo.papierkorbMedienListe(db));
  ipcMain.handle('papierkorb:leser-wiederherstellen', sicher((_e, id) => repo.leserWiederherstellen(db, id)));
  ipcMain.handle('papierkorb:medien-wiederherstellen', sicher((_e, id) => repo.medienWiederherstellen(db, id)));
  ipcMain.handle('papierkorb:leser-endgueltig-loeschen', sicher((_e, id) => repo.leserEndgueltigLoeschen(db, id)));
  ipcMain.handle('papierkorb:medien-endgueltig-loeschen', sicher((_e, id) => repo.medienEndgueltigLoeschen(db, id)));

  ipcMain.handle('print:now', (event, options = {}) => {
    const contents = event.sender;
    return new Promise((resolve) => {
      contents.print({ silent: false, printBackground: true, landscape: Boolean(options.landscape) }, (success, reason) =>
        resolve({ success, reason })
      );
    });
  });

  ipcMain.handle('print:pdf', sicher(async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Als PDF sichern',
      defaultPath: `${sichererDateiname(options.name || 'Mahnungen')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const pdfOptions = { printBackground: true, pageSize: 'A4', landscape: Boolean(options.landscape) };
    if (options.headerTemplate || options.footerTemplate) {
      // Kopf-/Fußzeile (Schulname/Datum/Filterbeschreibung, Seitenzahl) brauchen
      // echten Seitenrand, in den Chromium sie hineinrendert – anders als beim
      // randlosen Mahnbrief (siehe else-Zweig), der sein eigenes Layout per CSS
      // bis an den Rand zeichnet.
      pdfOptions.displayHeaderFooter = true;
      pdfOptions.headerTemplate = options.headerTemplate;
      pdfOptions.footerTemplate = options.footerTemplate;
      pdfOptions.margins = { top: 0.6, bottom: 0.6, left: 0.3, right: 0.3 };
    } else {
      pdfOptions.margins = { marginType: 'none' };
      pdfOptions.preferCSSPageSize = true;
    }
    const data = await event.sender.printToPDF(pdfOptions);
    await fs.writeFile(result.filePath, data);
    return result.filePath;
  }));

  /* ------------------------------------------------------------- Auto-Update */
  ipcMain.handle('update:status', () => updateStatus);
  ipcMain.handle('update:jetzt-pruefen', sicher(() => autoUpdatePruefen(true)));

  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || !win.isMaximizable()) return false;
    win.isMaximized() ? win.unmaximize() : win.maximize();
    return win.isMaximized();
  });
}

/* ------------------------------------------------------------------- App */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // Splash ZUERST, vor jeglicher Datenbank-/Sicherungsarbeit unten –
    // die kann (siehe splashStatus-Aufrufe) spürbar dauern, vor allem die
    // Perpustakaan-Original-Sicherung bei einer großen echten Datenbank.
    // Bis 1.2.0-beta.1 entstand die Splash erst NACH all dieser Arbeit:
    // wer in dieser Zeit gar kein Fenster sah, empfand das leicht als
    // "App hängt beim Start" – jetzt zeigt sich sofort etwas, und zwar
    // mit einer Statuszeile, die verrät, WO es gerade klemmt.
    createSplashWindow();
    buildMenu();

    const userDataDir = app.getPath('userData');
    // EXPERIMENTELL: zweiter Suchort für die Java-Laufzeit, falls die mit
    // dem Programm ausgelieferte auf einer echten Installation fehlt/nicht
    // startbar ist (siehe perpustakaan-live.js). Muss VOR
    // perpustakaanLiveStatusAktualisieren() gesetzt sein.
    perpustakaanLive.setzeZusaetzlicheLaufzeitBasis(userDataDir);
    splashStatus('Öffne Datenbank …');
    store = new Store(path.join(userDataDir, 'config'));
    db = openDatabase(userDataDir);
    coversDir = path.join(userDataDir, 'covers');
    await fs.mkdir(coversDir, { recursive: true }).catch(() => {});

    // Einmal täglich beim ersten Start ein Backup – zusätzlich zum
    // automatischen Backup vor einer fälligen Migration (siehe db.js).
    dbFile = path.join(userDataDir, 'inga.sqlite3');
    backupDir = path.join(userDataDir, 'backups');
    splashStatus('Sichere Datenbank …');
    if (!backupHeuteVorhanden(backupDir, 'start')) {
      sichereDatenbankSync(db, dbFile, backupDir, { grund: 'start' });
    }
    // Zusätzlich einmal täglich eine Perpustakaan-kompatible Zip-Sicherung
    // (dieselbe wie "Als Zip exportieren …" in Import/Export) – unabhängig
    // von der .sqlite3-Sicherung oben, eigene Rotation/eigener Tages-Check.
    if (!perpustakaanBackupHeuteVorhanden(backupDir)) {
      sicherePerpustakaanZipSync(db, backupDir, exportZip);
    }
    // Die zusätzliche Dokumente-Ordner-Sicherung (dokumenteBackupFallsFaelligSync)
    // ist NICHT mehr hier – die verdoppelte praktisch die obigen zwei
    // Sicherungen und damit die Wartezeit VOR dem ersten sichtbaren
    // Fenster. Läuft jetzt wie das Cover-Nachladen erst im Hintergrund
    // NACH dem Start (siehe unten), das Ergebnis ändert sich dadurch
    // nicht – nur WANN es passiert.
    // EXPERIMENTELL: bei jedem Start (nicht nur einmal täglich wie oben –
    // siehe backup.js) die ECHTE Perpustakaan-Datenbank sichern, BEVOR
    // überhaupt geprüft wird, ob sie gerade zugreifbar ist. Schlägt schon
    // diese Sicherung fehl, bleibt der Live-Zugriff für diesen Start
    // gesperrt (perpustakaanLiveStatusAktualisieren() -> perpustakaanLiveBereitPruefen()).
    await perpustakaanLiveStatusAktualisieren();

    registerIpc();
    wireAutoUpdater();
    splashStatus('Starte Oberfläche …');
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });

    // Hintergrundaufgaben NACH dem Start, mit etwas Abstand, damit sie das
    // Öffnen des Hauptfensters nicht verzögern: die zusätzliche
    // Dokumente-Ordner-Sicherung, eine stille Update-Prüfung (kein Dialog,
    // wenn ohnehin schon aktuell) und – falls seit über einer Woche nicht
    // mehr gelaufen – das automatische Cover-Nachladen.
    setTimeout(() => {
      dokumenteBackupFallsFaelligSync();
      if (settings().autoUpdateAktiv) autoUpdatePruefen();
      coverAutoNachladenFallsFaellig().catch((err) => console.error('[wartung] Cover-Nachladen fehlgeschlagen:', err.message));
    }, 5000);
    // Erneute stille Prüfung alle 6 Stunden – für Sitzungen, die tagelang
    // durchlaufen, nicht nur bei jedem Neustart.
    setInterval(() => {
      if (settings().autoUpdateAktiv) autoUpdatePruefen();
    }, 6 * 60 * 60 * 1000);
  });

  app.on('window-all-closed', () => {
    if (!platform.IS_MAC) app.quit();
  });

  app.on('before-quit', () => {
    store?.flushAllSync();
    db?.close();
  });
}
