'use strict';

/**
 * Lade-Sprüche im Stil alter Sims-Ladebildschirme – pro Start wird einer
 * zufällig gezogen. Rein dekorativ, ohne API-Zugriff (die Splash hat bewusst
 * kein Preload-Skript). Als externe Datei statt Inline-Skript, weil die CSP
 * (`default-src 'self'`) kein 'unsafe-inline' für Skripte erlaubt – nur für
 * Styles.
 */
const TIPPS = [
  'Wusstest du schon? Ein Buch kann nicht gleichzeitig ausgeliehen und im Regal sein. Auch nicht mit Quantenphysik.',
  'JÖRN vergisst nie eine überfällige Rückgabe. Nie.',
  'Tipp: Barcodes lassen sich auch von Hand eintippen – der Scanner freut sich trotzdem mehr.',
  'NELE labelt schneller, als du „Signatur“ sagen kannst.',
  '65 Tabellen, ein Zip, keine Übersetzungsschicht. So mag INGA das Perpustakaan-Format.',
  'Ein überfälliges Buch ist wie ein Montag: kommt garantiert wieder.',
  'Mahngebühren sind kein Taschengeld-Ersatz – aber sie tun auch nicht weh.',
  'Wusstest du schon? Bücher werden nicht schneller gefunden, wenn man lauter ruft.',
  'INGA druckt Mahnungen lieber auf Papier, als in Großbuchstaben zu schreien.',
  'Tipp: Ein Cover sagt mehr als tausend Worte – und lädt meistens auch schneller.',
  'Zwischen „Ausleihen“ und „Rückgabe“ liegt nur ein Klick. Und meistens ein paar Wochen.',
  'Der Bibliotheksausweis ist kein Freifahrtschein für die Turnhalle.',
  'Ladebalken sind wie Bibliothekar:innen: geduldig, aber nicht unendlich.',
  'Ein gutes Buch braucht keine Batterien. INGA leider schon ein bisschen Strom.',
  'Tipp: Wer zu spät zurückgibt, bekommt keine Standpauke – nur einen Brief von JÖRN.',
  'Katalogisieren ist wie Sockensortieren, nur mit mehr ISBN-Nummern.',
  'Wusstest du schon? Ein Exemplar kann immer nur an eine Person gleichzeitig verliehen sein. Teilen ist trotzdem erlaubt – nacheinander.',
  'INGA merkt sich alles. Auch, wer das Wörterbuch schon wieder nicht zurückgebracht hat.',
  'Tipp: Vor dem Ausleihen scannen, nicht danach. Sonst wird es kompliziert.',
  'Splashscreens sind wie Inhaltsverzeichnisse: kurz, aber wichtig.',
  'Ein Karton Neuzugänge wartet auf NELE: Erfassen, Labeln, Einstellen – fertig.',
  'Wusstest du schon? INGA braucht keine Genehmigung. Das steht sogar im Namen.',
  'Tipp: Ruhe bewahren, auch wenn die Rückgabe-Liste mal länger wird.',
];

document.getElementById('tip').textContent = TIPPS[Math.floor(Math.random() * TIPPS.length)];
