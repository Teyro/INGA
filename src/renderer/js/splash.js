'use strict';

/**
 * Lade-Spruch im Stil alter Sims-Ladebildschirme – pro Start wird einer
 * zufällig aus SPRUECHE (sprueche.js) gezogen. Rein dekorativ, ohne
 * API-Zugriff (die Splash hat bewusst kein Preload-Skript). Als externe
 * Datei statt Inline-Skript, weil die CSP (`default-src 'self'`) kein
 * 'unsafe-inline' für Skripte erlaubt – nur für Styles.
 */
document.getElementById('tip').textContent = SPRUECHE[Math.floor(Math.random() * SPRUECHE.length)];
