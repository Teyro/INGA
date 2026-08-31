'use strict';

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, systemPreferences } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');

const platform = require('./platform');
const { Store, DEFAULT_SETTINGS, defaultSettingsFor, sanitizeSettings } = require('./store');
const { openDatabase } = require('./db');
const repo = require('./repo');
const { importZip, exportZip } = require('./csvio');

const RENDERER = path.join(__dirname, '..', 'renderer');
const WINDOW_ICON = process.platform === 'linux' ? path.join(__dirname, '..', '..', 'build', 'icon-256.png') : undefined;

let mainWindow = null;
let printWindow = null;
let splashWindow = null;
let store = null;
let db = null;
let coversDir = null;
let activeStyle = platform.nativeStyle();
let coverBulkAbgebrochen = false;

function settings() {
  return store.get('settings', defaultSettingsFor(platform.nativeStyle(), platform.STYLE_ACCENTS[platform.nativeStyle()]));
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
    height: 340,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    backgroundColor: '#3d6fe0',
    ...(WINDOW_ICON ? { icon: WINDOW_ICON } : {}),
    webPreferences: { sandbox: true },
  });
  splashWindow.loadFile(path.join(RENDERER, 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
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

async function coverDataUrl(katalogNi) {
  const info = repo.coverInfo(db, katalogNi);
  if (!info) return null;
  try {
    const buf = await fs.readFile(path.join(coversDir, info.dateiname));
    const ext = info.dateiname.split('.').pop().toLowerCase();
    return `data:${COVER_MIME[ext] || 'image/jpeg'};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Lädt das Cover eines Titels per ISBN/EAN von Open Library (frei, ohne API-Key). */
async function downloadCoverForKatalog(katalogNi) {
  const katalog = repo.getKatalog(db, katalogNi);
  const isbn = String(katalog?.ISBN || katalog?.EAN || '').replace(/[^0-9Xx]/g, '');
  if (!isbn) return { ok: false, grund: 'keine ISBN/EAN hinterlegt' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, { signal: controller.signal });
    if (!res.ok) return { ok: false, grund: 'kein Cover gefunden' };
    const buf = Buffer.from(await res.arrayBuffer());
    // Open Library liefert bei unbekannter ISBN gelegentlich ein winziges
    // Platzhalterbild statt eines Fehlers – daran erkennen wir „nicht gefunden“.
    if (buf.byteLength < 900) return { ok: false, grund: 'kein Cover gefunden' };
    const dateiname = `${katalogNi}.jpg`;
    await fs.writeFile(path.join(coversDir, dateiname), buf);
    repo.setCover(db, katalogNi, dateiname, 'openlibrary');
    return { ok: true };
  } catch (err) {
    return { ok: false, grund: err.name === 'AbortError' ? 'Zeitüberschreitung' : err.message };
  } finally {
    clearTimeout(timeout);
  }
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

/* -------------------------------------------------------------------- IPC */

function registerIpc() {
  ipcMain.handle('bootstrap', () => bootstrapPayload());

  ipcMain.handle('settings:set', (_e, patch) => {
    const merged = sanitizeSettings(patch, settings());
    const next = { ...settings(), ...merged };
    store.set('settings', next);
    activeStyle = platform.resolveStyle(next.uiStyle);
    const background = isDark() ? '#12151c' : '#e8ecf3';
    if (mainWindow) platform.applyWindowMaterial(mainWindow, { settings: next, style: activeStyle, background, kind: 'main' });
    mainWindow?.webContents.send('settings:updated', next);
    return next;
  });
  ipcMain.handle('settings:read', () => settings());

  ipcMain.handle('katalog:search', (_e, filter) => repo.searchKatalog(db, filter));
  ipcMain.handle('katalog:get', (_e, katalogNi) => repo.getKatalog(db, katalogNi));
  ipcMain.handle('katalog:save', (_e, row) => repo.saveKatalog(db, row));
  ipcMain.handle('katalog:delete', (_e, katalogNi) => repo.deleteKatalog(db, katalogNi));
  ipcMain.handle('katalog:exemplare', (_e, katalogNi) => repo.exemplareFuer(db, katalogNi));
  ipcMain.handle('katalog:top-ausgeliehen', (_e, limit) => repo.topAusgelieheneBuecher(db, limit || 10));
  ipcMain.handle('katalog:ausleih-statistik', (_e, katalogNi) => repo.ausleihStatistikFuerKatalog(db, katalogNi));

  ipcMain.handle('medium:save', (_e, row) => repo.saveMedium(db, row));
  ipcMain.handle('medium:delete', (_e, medienNi) => repo.deleteMedium(db, medienNi));
  ipcMain.handle('medium:status', (_e, medienNi) => repo.exemplarStatus(db, medienNi));
  ipcMain.handle('medium:find-etikett', (_e, etikett) => repo.findExemplarByEtikett(db, etikett));

  ipcMain.handle('leser:search', (_e, filter) => repo.searchLeser(db, filter));
  ipcMain.handle('leser:get', (_e, leserNi) => repo.getLeser(db, leserNi));
  ipcMain.handle('leser:save', (_e, row) => repo.saveLeser(db, row));
  ipcMain.handle('leser:delete', (_e, leserNi) => repo.deleteLeser(db, leserNi));
  ipcMain.handle('leser:offene-ausleihen', (_e, leserNi) => repo.offeneAusleihenVonLeser(db, leserNi));
  ipcMain.handle('leser:mahnhistorie', (_e, leserNi) => repo.mahnhistorieVonLeser(db, leserNi));

  ipcMain.handle('ausleihe:alle-offen', () => repo.alleOffenenAusleihen(db));
  ipcMain.handle('ausleihe:ueberfaellige-alle', () =>
    repo.ueberfaelligeAusleihen(db, { leihfristTageVorgabe: settings().leihfristTage, leihfristOffsetTage: settings().leihfristOffsetTage })
  );
  ipcMain.handle('ausleihe:ausleihen', (_e, payload) => {
    try {
      const s = settings();
      return { ok: true, ...repo.ausleihen(db, { ...payload, leihfristTageVorgabe: s.leihfristTage, leihfristOffsetTage: s.leihfristOffsetTage }) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ausleihe:zurueckgeben', (_e, id) => repo.zurueckgeben(db, id));
  ipcMain.handle('ausleihe:verlaengern', (_e, id) => {
    try {
      repo.verlaengern(db, id, settings().maxVerlaengerung);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('ausleihe:verschieben-alle', (_e, tage) => {
    const anzahl = repo.verschiebeOffeneAusleihen(db, tage);
    return { anzahl };
  });

  ipcMain.handle('mahnung:ueberfaellige', () =>
    repo.ueberfaelligeMitStufe(db, {
      mahnstufen: settings().mahnstufen,
      leihfristTageVorgabe: settings().leihfristTage,
      leihfristOffsetTage: settings().leihfristOffsetTage,
    })
  );
  ipcMain.handle('mahnung:erzeugen-und-drucken', async (_e, positionen) => {
    const s = settings();
    const nachLeser = new Map();
    for (const p of positionen) {
      repo.mahnungEintragen(db, { medienNi: p.MedienNi, leserNi: p.LeserNi, auslDatum: p.AuslDatum, gebuehr: p.stufe.gebuehr });
      if (!nachLeser.has(p.LeserNi)) nachLeser.set(p.LeserNi, { leser: repo.getLeser(db, p.LeserNi), posten: [] });
      nachLeser.get(p.LeserNi).posten.push(p);
    }
    const briefe = [...nachLeser.values()].map(({ leser, posten }) => ({
      leser,
      posten,
      summe: posten.reduce((sum, p) => sum + Number(p.stufe.gebuehr || 0), 0),
      absenderName: s.absenderName,
      absenderAdresse: s.absenderAdresse,
      absenderEmail: s.absenderEmail,
      absenderTelefon: s.absenderTelefon,
      mahnBetreffVorlage: s.mahnBetreffVorlage,
      mahnSchluss: s.mahnSchluss,
      mahnLogoDataUrl: s.mahnLogoDataUrl,
      datum: new Date().toLocaleDateString('de-DE'),
    }));
    await openMahnungPrintWindow(briefe);
    return { anzahl: briefe.length };
  });

  ipcMain.handle('mahnung:logo-auswaehlen', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Logo auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = result.filePaths[0];
    const ext = (filePath.split('.').pop() || 'png').toLowerCase();
    const buf = await fs.readFile(filePath);
    if (buf.byteLength > 1_500_000) return { error: 'Datei zu groß (max. 1,5 MB).' };
    return { dataUrl: `data:${COVER_MIME[ext] || 'image/png'};base64,${buf.toString('base64')}` };
  });

  ipcMain.handle('cover:get', (_e, katalogNi) => coverDataUrl(katalogNi));
  ipcMain.handle('cover:fetch-one', async (_e, katalogNi) => downloadCoverForKatalog(katalogNi));
  ipcMain.handle('cover:upload', async (_e, katalogNi) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Cover auswählen',
      properties: ['openFile'],
      filters: [{ name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] }],
    });
    if (result.canceled || !result.filePaths[0]) return { ok: false };
    const quelle = result.filePaths[0];
    const ext = (quelle.split('.').pop() || 'jpg').toLowerCase();
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
  ipcMain.handle('cover:delete', async (_e, katalogNi) => {
    const info = repo.coverInfo(db, katalogNi);
    if (info) await fs.unlink(path.join(coversDir, info.dateiname)).catch(() => {});
    repo.removeCover(db, katalogNi);
    return { ok: true };
  });
  ipcMain.handle('cover:fetch-all', async (event, { nurFehlende = true } = {}) => {
    coverBulkAbgebrochen = false;
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
  });
  ipcMain.handle('cover:fetch-all-cancel', () => { coverBulkAbgebrochen = true; });

  ipcMain.handle('stammdaten:get', () => repo.stammdaten(db));
  ipcMain.handle('kennzahlen:get', () => repo.kennzahlen(db));

  ipcMain.handle('bestand:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Bestand importieren',
      properties: ['openFile'],
      filters: [{ name: 'Perpustakaan-Export', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    importZip(db, result.filePaths[0]);
    return { datei: result.filePaths[0], kennzahlen: repo.kennzahlen(db) };
  });

  ipcMain.handle('bestand:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Bestand exportieren',
      defaultPath: `inga_export_${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'Perpustakaan-Export', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return null;
    exportZip(db, result.filePath);
    return result.filePath;
  });

  ipcMain.handle('print:now', (event) => {
    const contents = event.sender;
    return new Promise((resolve) => {
      contents.print({ silent: false, printBackground: true }, (success, reason) => resolve({ success, reason }));
    });
  });

  ipcMain.handle('print:pdf', async (event, options = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      title: 'Als PDF sichern',
      defaultPath: `${(options.name || 'Mahnungen').replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePath) return null;
    const data = await event.sender.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    });
    await fs.writeFile(result.filePath, data);
    return result.filePath;
  });

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
    store = new Store(path.join(app.getPath('userData'), 'config'));
    db = openDatabase(app.getPath('userData'));
    coversDir = path.join(app.getPath('userData'), 'covers');
    await fs.mkdir(coversDir, { recursive: true }).catch(() => {});
    registerIpc();
    buildMenu();
    createSplashWindow();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!platform.IS_MAC) app.quit();
  });

  app.on('before-quit', () => {
    store?.flushAllSync();
    db?.close();
  });
}
