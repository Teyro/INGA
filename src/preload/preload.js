'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['menu:action', 'print:data', 'settings:updated', 'cover:progress', 'window:state']);

contextBridge.exposeInMainWorld('inga', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),

  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    save: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  katalog: {
    search: (filter, seitenOptionen) => ipcRenderer.invoke('katalog:search', filter, seitenOptionen),
    ueberfaelligeNi: () => ipcRenderer.invoke('katalog:ueberfaellige-ni'),
    get: (katalogNi) => ipcRenderer.invoke('katalog:get', katalogNi),
    save: (row) => ipcRenderer.invoke('katalog:save', row),
    delete: (katalogNi) => ipcRenderer.invoke('katalog:delete', katalogNi),
    exemplare: (katalogNi) => ipcRenderer.invoke('katalog:exemplare', katalogNi),
    exemplareMitStatus: (katalogNi) => ipcRenderer.invoke('katalog:exemplare-mit-status', katalogNi),
    topAusgeliehen: (limit) => ipcRenderer.invoke('katalog:top-ausgeliehen', limit),
    ausleihStatistik: (katalogNi) => ipcRenderer.invoke('katalog:ausleih-statistik', katalogNi),
    isbnNachschlagen: (isbn) => ipcRenderer.invoke('katalog:isbn-nachschlagen', isbn),
  },

  medium: {
    save: (row) => ipcRenderer.invoke('medium:save', row),
    delete: (medienNi) => ipcRenderer.invoke('medium:delete', medienNi),
    status: (medienNi) => ipcRenderer.invoke('medium:status', medienNi),
    findByEtikett: (etikett) => ipcRenderer.invoke('medium:find-etikett', etikett),
  },

  leser: {
    search: (filter, seitenOptionen) => ipcRenderer.invoke('leser:search', filter, seitenOptionen),
    jahrgaenge: () => ipcRenderer.invoke('leser:jahrgaenge'),
    get: (leserNi) => ipcRenderer.invoke('leser:get', leserNi),
    save: (row) => ipcRenderer.invoke('leser:save', row),
    delete: (leserNi) => ipcRenderer.invoke('leser:delete', leserNi),
    offeneAusleihen: (leserNi) => ipcRenderer.invoke('leser:offene-ausleihen', leserNi),
    mahnhistorie: (leserNi) => ipcRenderer.invoke('leser:mahnhistorie', leserNi),
    vormerkungen: (leserNi) => ipcRenderer.invoke('leser:vormerkungen', leserNi),
  },

  vormerkung: {
    liste: (katalogNi) => ipcRenderer.invoke('vormerkung:liste', katalogNi),
    anlegen: (payload) => ipcRenderer.invoke('vormerkung:anlegen', payload),
    loeschen: (id) => ipcRenderer.invoke('vormerkung:loeschen', id),
  },

  ausleihe: {
    alleOffen: () => ipcRenderer.invoke('ausleihe:alle-offen'),
    ueberfaelligeAlle: () => ipcRenderer.invoke('ausleihe:ueberfaellige-alle'),
    ausleihen: (payload) => ipcRenderer.invoke('ausleihe:ausleihen', payload),
    zurueckgeben: (id) => ipcRenderer.invoke('ausleihe:zurueckgeben', id),
    verlaengern: (id) => ipcRenderer.invoke('ausleihe:verlaengern', id),
    verschiebenAlle: (tage) => ipcRenderer.invoke('ausleihe:verschieben-alle', tage),
    ferienVorschau: () => ipcRenderer.invoke('ausleihe:ferien-vorschau'),
    umlaufliste: () => ipcRenderer.invoke('ausleihe:umlaufliste'),
  },

  umlauf: {
    drucken: (payload) => ipcRenderer.invoke('umlauf:drucken', payload),
  },

  etiketten: {
    drucken: (payload) => ipcRenderer.invoke('etiketten:drucken', payload),
  },

  export: {
    csv: (angaben) => ipcRenderer.invoke('export:csv', angaben),
    xlsx: (angaben) => ipcRenderer.invoke('export:xlsx', angaben),
  },

  mahnung: {
    ueberfaellige: () => ipcRenderer.invoke('mahnung:ueberfaellige'),
    erzeugenUndDrucken: (positionen) => ipcRenderer.invoke('mahnung:erzeugen-und-drucken', positionen),
    logoAuswaehlen: () => ipcRenderer.invoke('mahnung:logo-auswaehlen'),
  },

  cover: {
    get: (katalogNi) => ipcRenderer.invoke('cover:get', katalogNi),
    fetchOne: (katalogNi) => ipcRenderer.invoke('cover:fetch-one', katalogNi),
    upload: (katalogNi) => ipcRenderer.invoke('cover:upload', katalogNi),
    delete: (katalogNi) => ipcRenderer.invoke('cover:delete', katalogNi),
    fetchAll: (options) => ipcRenderer.invoke('cover:fetch-all', options),
    fetchAllCancel: () => ipcRenderer.invoke('cover:fetch-all-cancel'),
  },

  stammdaten: {
    get: () => ipcRenderer.invoke('stammdaten:get'),
  },
  medart: {
    fristSpeichern: (payload) => ipcRenderer.invoke('medart:frist-speichern', payload),
  },
  kennzahlen: () => ipcRenderer.invoke('kennzahlen:get'),

  statistik: {
    proMonat: (monate) => ipcRenderer.invoke('statistik:pro-monat', monate),
    proKlasse: () => ipcRenderer.invoke('statistik:pro-klasse'),
    proKategorie: () => ipcRenderer.invoke('statistik:pro-kategorie'),
    ladenhueter: (tage) => ipcRenderer.invoke('statistik:ladenhueter', tage),
    verlustliste: () => ipcRenderer.invoke('statistik:verlustliste'),
  },

  ferien: {
    liste: () => ipcRenderer.invoke('ferien:liste'),
    speichern: (row) => ipcRenderer.invoke('ferien:speichern', row),
    loeschen: (id) => ipcRenderer.invoke('ferien:loeschen', id),
    importIcsDatei: () => ipcRenderer.invoke('ferien:import-ics-datei'),
    importIcsUrl: (url) => ipcRenderer.invoke('ferien:import-ics-url', url),
    apiAbrufen: () => ipcRenderer.invoke('ferien:api-abrufen'),
    importUebernehmen: (eintraege) => ipcRenderer.invoke('ferien:import-uebernehmen', eintraege),
  },

  bestand: {
    importieren: () => ipcRenderer.invoke('bestand:import'),
    exportieren: () => ipcRenderer.invoke('bestand:export'),
  },

  backup: {
    liste: () => ipcRenderer.invoke('backup:liste'),
    jetzt: () => ipcRenderer.invoke('backup:jetzt'),
    einspielen: (dateiname) => ipcRenderer.invoke('backup:einspielen', dateiname),
    einspielenDatei: () => ipcRenderer.invoke('backup:einspielen-datei'),
  },

  papierkorb: {
    leserListe: () => ipcRenderer.invoke('papierkorb:leser-liste'),
    medienListe: () => ipcRenderer.invoke('papierkorb:medien-liste'),
    leserWiederherstellen: (id) => ipcRenderer.invoke('papierkorb:leser-wiederherstellen', id),
    medienWiederherstellen: (id) => ipcRenderer.invoke('papierkorb:medien-wiederherstellen', id),
    leserEndgueltigLoeschen: (id) => ipcRenderer.invoke('papierkorb:leser-endgueltig-loeschen', id),
    medienEndgueltigLoeschen: (id) => ipcRenderer.invoke('papierkorb:medien-endgueltig-loeschen', id),
  },

  print: {
    now: (options) => ipcRenderer.invoke('print:now', options),
    pdf: (options) => ipcRenderer.invoke('print:pdf', options),
  },

  mail: {
    oeffnen: (payload) => ipcRenderer.invoke('mail:oeffnen', payload),
  },

  element: {
    anmelden: (payload) => ipcRenderer.invoke('element:anmelden', payload),
    verbindungTesten: () => ipcRenderer.invoke('element:verbindung-testen'),
    trennen: () => ipcRenderer.invoke('element:trennen'),
    senden: (nachrichten) => ipcRenderer.invoke('element:senden', nachrichten),
  },

  window: {
    close: () => ipcRenderer.invoke('window:close'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:maximize'),
  },

  on: (channel, listener) => {
    if (!EVENTS.has(channel)) throw new Error(`Unbekannter Kanal: ${channel}`);
    const handler = (_event, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
