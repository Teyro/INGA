#!/usr/bin/env node
/**
 * Test-Doppelgänger für derby-bridge/src/Bridge.java – dieselbe
 * Kommandozeilen-/stdout-JSON-Vertrag, aber ohne echtes Java/Derby. Läuft
 * als eigener Prozess (siehe test/perpustakaan-live.test.mjs,
 * INGA_TEST_JAVA_PFAD), testet damit den wirklichen spawn()-Mechanismus in
 * perpustakaan-live.js statt nur einen verhaltenen Mock.
 *
 * perpustakaan-live.js ruft immer `<javaPfad> -cp <klassenpfad> Bridge <args…>`
 * auf – die ersten drei Argumente werden hier einfach übersprungen, danach
 * folgt derselbe Modus/dieselben Argumente wie bei der echten Bridge.
 */
const args = process.argv.slice(2 + 3); // node, dieses Skript, dann "-cp <cp> Bridge"
const modus = args[0];

if (modus === 'check') {
  const dbPfad = args[1];
  if (dbPfad.includes('gesperrt')) console.log(JSON.stringify({ ok: false, gesperrt: true }));
  else if (dbPfad.includes('kaputt')) { console.log(JSON.stringify({ ok: false, fehler: 'Simulierter Fehler' })); process.exitCode = 1; }
  else console.log(JSON.stringify({ ok: true }));
} else if (modus === 'dump') {
  const [, dbPfad, , zielZip] = args;
  if (dbPfad.includes('gesperrt')) { console.log(JSON.stringify({ ok: false, gesperrt: true })); process.exitCode = 1; }
  else {
    // Ein winziges, aber gültiges Zip schreiben, damit ein Aufrufer es öffnen kann.
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('Leser.csv', Buffer.from('LeserNi;Nachname\r\n1;Test\r\n', 'utf8'));
    zip.writeZip(zielZip);
    console.log(JSON.stringify({ ok: true, tabellen: 1 }));
  }
} else if (modus === 'load') {
  const [, dbPfad] = args;
  if (dbPfad.includes('gesperrt')) { console.log(JSON.stringify({ ok: false, gesperrt: true })); process.exitCode = 1; }
  else if (dbPfad.includes('kaputt')) { console.log(JSON.stringify({ ok: false, fehler: 'Simulierter Ladefehler' })); process.exitCode = 1; }
  else console.log(JSON.stringify({ ok: true, tabellen: 1 }));
} else if (modus === 'huelle-nichts-aus') {
  // Simuliert einen Absturz VOR der ersten druckeJson()-Zeile.
  process.exitCode = 1;
} else if (modus === 'troedle') {
  await new Promise((r) => setTimeout(r, 5000));
  console.log(JSON.stringify({ ok: true }));
} else {
  console.error('unbekannter Testmodus: ' + modus);
  process.exitCode = 2;
}
