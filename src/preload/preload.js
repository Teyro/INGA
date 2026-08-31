'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['menu:action', 'print:data', 'settings:updated']);

contextBridge.exposeInMainWorld('inga', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),

  settings: {
    read: () => ipcRenderer.invoke('settings:read'),
    save: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  katalog: {
    search: (query) => ipcRenderer.invoke('katalog:search', query),
    get: (katalogNi) => ipcRenderer.invoke('katalog:get', katalogNi),
    save: (row) => ipcRenderer.invoke('katalog:save', row),
    delete: (katalogNi) => ipcRenderer.invoke('katalog:delete', katalogNi),
    exemplare: (katalogNi) => ipcRenderer.invoke('katalog:exemplare', katalogNi),
  },

  medium: {
    save: (row) => ipcRenderer.invoke('medium:save', row),
    delete: (medienNi) => ipcRenderer.invoke('medium:delete', medienNi),
    status: (medienNi) => ipcRenderer.invoke('medium:status', medienNi),
    findByEtikett: (etikett) => ipcRenderer.invoke('medium:find-etikett', etikett),
  },

  leser: {
    search: (query) => ipcRenderer.invoke('leser:search', query),
    get: (leserNi) => ipcRenderer.invoke('leser:get', leserNi),
    save: (row) => ipcRenderer.invoke('leser:save', row),
    delete: (leserNi) => ipcRenderer.invoke('leser:delete', leserNi),
    offeneAusleihen: (leserNi) => ipcRenderer.invoke('leser:offene-ausleihen', leserNi),
    mahnhistorie: (leserNi) => ipcRenderer.invoke('leser:mahnhistorie', leserNi),
  },

  ausleihe: {
    alleOffen: () => ipcRenderer.invoke('ausleihe:alle-offen'),
    ausleihen: (payload) => ipcRenderer.invoke('ausleihe:ausleihen', payload),
    zurueckgeben: (id) => ipcRenderer.invoke('ausleihe:zurueckgeben', id),
    verlaengern: (id) => ipcRenderer.invoke('ausleihe:verlaengern', id),
  },

  mahnung: {
    ueberfaellige: () => ipcRenderer.invoke('mahnung:ueberfaellige'),
    erzeugenUndDrucken: (positionen) => ipcRenderer.invoke('mahnung:erzeugen-und-drucken', positionen),
  },

  stammdaten: {
    get: () => ipcRenderer.invoke('stammdaten:get'),
  },
  kennzahlen: () => ipcRenderer.invoke('kennzahlen:get'),

  bestand: {
    importieren: () => ipcRenderer.invoke('bestand:import'),
    exportieren: () => ipcRenderer.invoke('bestand:export'),
  },

  print: {
    now: () => ipcRenderer.invoke('print:now'),
    pdf: (options) => ipcRenderer.invoke('print:pdf', options),
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
