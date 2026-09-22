'use strict';

/**
 * Eigenes, bewusst winziges Preload-Skript für die kleinen Hilfsfenster
 * ohne eigene Programmlogik – Splashscreen (Programmstart) und
 * Abschiedsfenster (Programmende, siehe main.js createAbschiedFenster()) –
 * NICHT das volle preload.js der Hauptoberfläche. Diese Fenster bekommen
 * dadurch genau eine Fähigkeit: Statustexte vom Hauptprozess empfangen
 * (main.js splashStatus()/abschiedStatus()), damit sich erkennen lässt,
 * WO ein länger dauernder Start/eine länger dauernde Sicherung beim
 * Beenden gerade steckt, statt nur eine unbewegte Ladeanimation zu
 * zeigen. Kein invoke/send zurück zum Hauptprozess nötig – reine
 * Einbahnstraße, für beide Fenster identisch (derselbe IPC-Kanal
 * "fenster:status" kollidiert nicht – jedes Fenster bekommt nur die
 * Nachrichten, die main.js gezielt an SEIN webContents schickt).
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ingaFensterStatus', {
  onStatus: (callback) => ipcRenderer.on('fenster:status', (_event, text) => callback(text)),
});
