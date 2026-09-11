'use strict';

/**
 * EXPERIMENTELL (Branch feature/perpustakaan-live-db, Version 0.9-intern):
 * direkter Zugriff auf die ECHTE Perpustakaan-Datenbank (Apache Derby,
 * embedded) statt nur auf Zip-Sicherungen. Node hat keinen Derby-Treiber –
 * es gibt schlicht keinen, Derby ist reines Java und spricht nur JDBC oder
 * seinen eigenen Netzwerkserver (den Perpustakaan nicht nutzt). Diese Datei
 * startet deshalb bei Bedarf einen kleinen mitgelieferten Java-Prozess
 * (derby-bridge/, siehe dort) und redet mit ihm über Kommandozeile + eine
 * einzelne JSON-Zeile auf stdout.
 *
 * "Ist Perpustakaan gerade geöffnet?": Derbys Embedded-Engine lässt IMMER
 * nur eine einzige JVM gleichzeitig auf eine Datenbank zugreifen – lesend
 * wie schreibend, ein zweiter Boot-Versuch scheitert unabhängig von der
 * Absicht mit SQLState XSDB6 ("Another instance of Derby may have already
 * booted the database"). Es gibt in Derbys Embedded-Modus KEINEN
 * Mittelweg, bei dem INGA "nur lesend" gleichzeitig mitläse, während
 * Perpustakaan die Datenbank offen hält (das bräuchte den separaten Derby
 * Network Server, den Perpustakaan nicht einsetzt) – das wurde in diesem
 * Zweig gezielt gegen eine echte, parallel offen gehaltene Testdatenbank
 * geprüft (siehe derby-bridge/README.md). "Auf nur lesend zurückstellen"
 * bedeutet hier deshalb ehrlich: gar kein Live-Zugriff in diesem Moment,
 * INGA arbeitet in der Zwischenzeit mit seiner eigenen, zuletzt
 * importierten Kopie weiter, statt es aussichtslos noch einmal zu
 * versuchen oder gar hängen zu bleiben.
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawn } = require('node:child_process');

const BRIDGE_TIMEOUT_MS = 30000;

/**
 * Wo die Java-Laufzeit + Derby-Jars liegen: gepackt unter extraResources
 * (siehe package.json "build.extraResources" und
 * scripts/setup-derby-runtime.js), in der Entwicklung direkt im
 * Projektordner (`npm run setup:derby-runtime` lädt sie dorthin). Ohne
 * heruntergeladene Laufzeit fällt java() auf ein System-Java zurück –
 * praktisch für die Entwicklung, wenn ohnehin ein JDK installiert ist.
 */
function ressourcenBasis() {
  const gepackt = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'derby-runtime'));
  return gepackt ? process.resourcesPath : path.join(__dirname, '..', '..');
}

// Test-Umgehung für javaPfad()/klassenpfad(): node:test kann kein Java
// bereitstellen, wohl aber ein kleines Fake-Programm (siehe
// test/perpustakaan-live.test.mjs) unterschieben, das echt als eigener
// Prozess läuft und denselben Kommandozeilen-/stdout-Vertrag wie
// Bridge.java bedient – testet damit den wirklichen spawn()-Mechanismus
// (Argumente, stdout/Exit-Code-Auswertung), nicht nur verhaltene Mocks.
// Ohne diese Variable unverändertes Produktionsverhalten.
function javaPfad() {
  if (process.env.INGA_TEST_JAVA_PFAD) return process.env.INGA_TEST_JAVA_PFAD;
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  const kandidat = path.join(ressourcenBasis(), 'derby-runtime', 'jre', 'bin', exe);
  return fs.existsSync(kandidat) ? kandidat : 'java';
}

function klassenpfad() {
  const basis = ressourcenBasis();
  const jarOrdner = path.join(basis, 'derby-runtime', 'derby-jars');
  const eigeneJars = fs.existsSync(jarOrdner) ? fs.readdirSync(jarOrdner).filter((f) => f.endsWith('.jar')).map((f) => path.join(jarOrdner, f)) : [];
  return [...eigeneJars, path.join(basis, 'derby-bridge', 'classes')].join(path.delimiter);
}

/** Schema-Datei für "dump" (siehe Bridge.java: `Tabellenname\tSpalte1,Spalte2,…` je Zeile) – EINE Quelle der Wahrheit mit csvio.js, dieselbe schema/perpustakaan-tables.json. */
function schreibeSchemaDatei(tables) {
  const zeilen = Object.entries(tables).map(([tabelle, spalten]) => `${tabelle}\t${spalten.join(',')}`);
  const datei = path.join(os.tmpdir(), `inga-derby-schema-${process.pid}-${Date.now()}.tsv`);
  fs.writeFileSync(datei, zeilen.join('\n') + '\n', 'utf8');
  return datei;
}

/**
 * Ruft die Bridge auf und liest ihre EINE JSON-Ergebniszeile von stdout –
 * unabhängig vom Exit-Code, den setzt Bridge.java auch in erwarteten
 * Fehlerfällen (gesperrt, ungültige Daten) ungleich 0. Nur wenn stdout gar
 * kein auswertbares JSON enthält (Absturz vor dem ersten druckeJson(),
 * fehlendes Java, …), gilt der Aufruf als grundsätzlich fehlgeschlagen.
 */
function rufeBridgeAuf(args) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let beendet = false;
    const kind = spawn(javaPfad(), ['-cp', klassenpfad(), 'Bridge', ...args], { windowsHide: true });

    const timer = setTimeout(() => {
      if (beendet) return;
      beendet = true;
      kind.kill();
      resolve({ ok: false, fehler: 'Zeitüberschreitung beim Zugriff auf die Perpustakaan-Datenbank.' });
    }, BRIDGE_TIMEOUT_MS);

    kind.stdout.on('data', (d) => { stdout += d; });
    kind.stderr.on('data', (d) => { stderr += d; });
    kind.on('error', (err) => {
      if (beendet) return;
      beendet = true;
      clearTimeout(timer);
      resolve({ ok: false, fehler: `Java-Laufzeit nicht gefunden/startbar (${err.message}).` });
    });
    kind.on('close', () => {
      if (beendet) return;
      beendet = true;
      clearTimeout(timer);
      const letzteZeile = stdout.trim().split('\n').filter(Boolean).pop();
      if (!letzteZeile) {
        resolve({ ok: false, fehler: stderr.trim() || 'Die Perpustakaan-Brücke hat keine Antwort geliefert.' });
        return;
      }
      try {
        resolve(JSON.parse(letzteZeile));
      } catch {
        resolve({ ok: false, fehler: 'Antwort der Perpustakaan-Brücke war kein gültiges JSON.' });
      }
    });
  });
}

/** Nur prüfen, ob die Datenbank gerade frei ist – für die Statusanzeige und vor jedem Lese-/Schreibversuch. */
async function pruefeZugriff(dbPfad) {
  return rufeBridgeAuf(['check', dbPfad]);
}

/** Live aus der Perpustakaan-Datenbank lesen: schreibt ein Perpustakaan-Zip, das anschließend GENAUSO wie eine hochgeladene Sicherung per csvio.importZip() eingelesen wird – keine zweite Import-Logik nötig. */
async function dumpNachZip(dbPfad, tables, zielZip) {
  const schemaDatei = schreibeSchemaDatei(tables);
  try {
    return await rufeBridgeAuf(['dump', dbPfad, schemaDatei, zielZip]);
  } finally {
    fs.unlink(schemaDatei, () => {});
  }
}

/**
 * INGAs aktuellen Stand zurück in die Perpustakaan-Datenbank schreiben:
 * `quellZip` kommt von csvio.exportZip() – exakt derselbe Weg wie beim
 * "Als Zip exportieren" heute schon. Alles in EINER Transaktion (siehe
 * Bridge.java: DELETE + INSERT je Tabelle, bei JEDEM Fehler kompletter
 * Rollback, nichts wird halb geschrieben).
 */
async function ladeAusZip(dbPfad, quellZip) {
  return rufeBridgeAuf(['load', dbPfad, quellZip]);
}

module.exports = { pruefeZugriff, dumpNachZip, ladeAusZip, javaPfad, klassenpfad };
