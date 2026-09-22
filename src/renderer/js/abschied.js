'use strict';

/**
 * Abschiedsfenster beim Beenden (siehe main.js bereiteBeendenVor()/
 * createAbschiedFenster()): erscheint nur, wenn tatsächlich etwas zu tun
 * ist (ein fälliges Tages-Backup, ein wartendes Update) – ein normales
 * Beenden ohne anstehende Arbeit bleibt weiterhin sofort, ohne dieses
 * Fenster. Nutzt dasselbe kleine Preload wie der Splashscreen
 * (status-preload.js) für die Statuszeile.
 */
if (window.ingaFensterStatus) {
  window.ingaFensterStatus.onStatus((text) => {
    document.getElementById('status').textContent = text;
  });
}
