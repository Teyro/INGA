'use strict';

/**
 * Eigenes, bewusst winziges Preload-Skript NUR für den Splashscreen –
 * NICHT das volle preload.js der Hauptoberfläche. Die Splash bekommt
 * dadurch genau eine Fähigkeit: Statustexte vom Hauptprozess empfangen
 * (siehe main.js splashStatus()), damit sich erkennen lässt, WO ein
 * hängender Programmstart gerade steckt, statt nur eine unbewegte
 * Ladeanimation zu zeigen. Kein invoke/send zurück zum Hauptprozess nötig
 * – reine Einbahnstraße.
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ingaSplash', {
  onStatus: (callback) => ipcRenderer.on('splash:status', (_event, text) => callback(text)),
});
