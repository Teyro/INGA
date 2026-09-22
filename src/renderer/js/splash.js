'use strict';

/**
 * Lade-Spruch im Stil alter Sims-Ladebildschirme – pro Start wird einer
 * zufällig aus SPRUECHE (sprueche.js) gezogen. Als externe Datei statt
 * Inline-Skript, weil die CSP (`default-src 'self'`) kein 'unsafe-inline'
 * für Skripte erlaubt – nur für Styles.
 *
 * Statuszeile: die Splash teilt sich seit 1.4.1 mit dem Abschiedsfenster
 * (siehe abschied.js) ein gemeinsames, absichtlich winziges Preload-Skript
 * NUR für diesen einen Zweck (status-preload.js) – main.js meldet darüber,
 * welchen Startschritt es gerade ausführt (Datenbank öffnen, Sicherung,
 * Perpustakaan-Zugriff prüfen …), damit ein hängender Start nicht wie ein
 * unbewegtes, stummes Bild aussieht, sondern erkennen lässt, WO es klemmt.
 * `window.ingaFensterStatus` defensiv geprüft, falls die Splash mal ohne
 * dieses Preload geladen wird.
 */
document.getElementById('tip').textContent = SPRUECHE[Math.floor(Math.random() * SPRUECHE.length)];

if (window.ingaFensterStatus) {
  window.ingaFensterStatus.onStatus((text) => {
    document.getElementById('status').textContent = text;
  });
}
