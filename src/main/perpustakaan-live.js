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

// "check" ist schnell, Lesen/Schreiben der kompletten Datenbank kann auf
// einem langsamen Schulrechner (JVM-Start, Virenscanner, große Tabellen)
// deutlich länger dauern – bei 30 s für alles brach ein an sich
// erfolgreicher Schreibvorgang sonst mitten drin mit "Zeitüberschreitung"
// ab (Derby rollt die Transaktion dann zwar sauber zurück, geschrieben ist
// aber nichts).
const BRIDGE_TIMEOUT_MS = 30000;
const BRIDGE_TIMEOUT_DATEN_MS = 5 * 60 * 1000;

// Gemeinsamer Text für main.js (schneller Vorab-Check über
// laufzeitVorhanden(), siehe perpustakaanLiveBereitPruefen()) UND den
// ENOENT-Zweig unten – eine Quelle der Wahrheit statt zweier Kopien, die
// bei einer künftigen Textänderung leicht auseinanderlaufen könnten.
const LAUFZEIT_FEHLT_HINWEIS =
  'Die mit INGA ausgelieferte Java-Laufzeit fehlt oder wurde von einem ' +
  'Virenschutz-/Firewall-Programm entfernt. Klicken Sie unten auf „Java-' +
  'Laufzeit reparieren“, um sie automatisch neu herunterzuladen – dafür ' +
  'wird kurz eine Internetverbindung gebraucht.';

/**
 * Wo die Java-Laufzeit + Derby-Jars liegen können, in Prüfreihenfolge:
 *  1. mitgeliefert – gepackt unter extraResources (siehe package.json
 *     "build.extraResources" und scripts/setup-derby-runtime.js), in der
 *     Entwicklung direkt im Projektordner (`npm run setup:derby-runtime`
 *     lädt sie dorthin).
 *  2. zusätzliche Laufzeit-Basis – NUR zur Laufzeit von main.js gesetzt
 *     (mit app.getPath('userData')): falls die mitgelieferte Laufzeit auf
 *     einer echten Installation aus irgendeinem Grund fehlt/nicht startbar
 *     ist (Antivirus/Firewall haben java.exe entfernt, unvollständige
 *     Installation, …), lädt der "Java-Laufzeit reparieren"-Assistent
 *     (main.js, IPC "perpustakaan-live:laufzeit-herunterladen") sie
 *     hierhin nach.
 * Findet sich in KEINER der beiden Basen eine startbare JRE, fällt
 * javaPfad() zuletzt auf ein bloßes "java" (Systempfad) zurück – praktisch
 * für die Entwicklung, wenn ohnehin ein JDK installiert ist.
 *
 * setzeZusaetzlicheLaufzeitBasis() ist bewusst ein Setter statt eines
 * direkten require('electron') hier in dieser Datei – test/perpustakaan-
 * live.test.mjs lädt sie mit reinem `node --test` ohne Electron-Laufzeit.
 */
let zusaetzlicheLaufzeitBasis = null;
function setzeZusaetzlicheLaufzeitBasis(pfad) {
  zusaetzlicheLaufzeitBasis = pfad;
}

/** Alle Orte, an denen eine funktionsfähige Laufzeit stehen könnte, in obiger Prüfreihenfolge. */
function laufzeitBasisKandidaten() {
  const gepackt = process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'derby-runtime'));
  const kandidaten = [gepackt ? process.resourcesPath : path.join(__dirname, '..', '..')];
  if (zusaetzlicheLaufzeitBasis) kandidaten.push(zusaetzlicheLaufzeitBasis);
  return kandidaten;
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
  for (const basis of laufzeitBasisKandidaten()) {
    const kandidat = path.join(basis, 'derby-runtime', 'jre', 'bin', exe);
    if (fs.existsSync(kandidat)) return kandidat;
  }
  return 'java';
}

/** true, sobald IRGENDEINE der Kandidaten-Basen eine startbare JRE hat – für die Statusanzeige/den Assistenten, ohne extra einen Bridge-Aufruf zu riskieren. */
function laufzeitVorhanden() {
  return javaPfad() !== 'java';
}

function klassenpfad() {
  // Die Bridge-Klassen selbst liegen NUR im (gepackten oder Entwicklungs-)
  // Programmordner, nie im userData-Nachlade-Ordner – der Assistent lädt
  // ausschließlich die Java-Laufzeit + Derby-Jars nach, niemals INGA-
  // eigenen Code.
  const programmBasis = laufzeitBasisKandidaten()[0];
  const jars = [];
  for (const basis of laufzeitBasisKandidaten()) {
    const jarOrdner = path.join(basis, 'derby-runtime', 'derby-jars');
    if (!fs.existsSync(jarOrdner)) continue;
    for (const datei of fs.readdirSync(jarOrdner).filter((f) => f.endsWith('.jar'))) jars.push(path.join(jarOrdner, datei));
  }
  return [...jars, path.join(programmBasis, 'derby-bridge', 'classes')].join(path.delimiter);
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
function rufeBridgeAuf(args, zeitlimitMs = BRIDGE_TIMEOUT_MS) {
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
    }, zeitlimitMs);

    // Als Text statt Buffer-Stücke aneinanderhängen: ein Umlaut, der genau
    // auf eine Stückgrenze fällt, käme sonst als Zeichensalat in der
    // Fehlermeldung an.
    kind.stdout.setEncoding('utf8');
    kind.stderr.setEncoding('utf8');
    kind.stdout.on('data', (d) => { stdout += d; });
    kind.stderr.on('data', (d) => { stderr += d; });
    kind.on('error', (err) => {
      if (beendet) return;
      beendet = true;
      clearTimeout(timer);
      const hinweis = err.code === 'ENOENT'
        ? LAUFZEIT_FEHLT_HINWEIS
        : `Java-Laufzeit lässt sich nicht starten (${err.code || err.message}).`;
      resolve({ ok: false, fehler: hinweis, laufzeitFehlt: err.code === 'ENOENT' });
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

/* ------------------------------------------------------------------
 * Dauerbetrieb für den Perpustakaan-Modus (siehe perpustakaan-modus.js):
 * EIN langlebiger Java-Prozess ("Bridge serve") statt eines neuen pro
 * Zugriff – spart bei jeder einzelnen Änderung den JVM-Start (auf einem
 * Schulrechner schnell 1–2 Sekunden). Die Bridge gibt die Datenbank nach
 * kurzer Ruhe von selbst wieder frei (LEERLAUF_DB_MS), damit Perpustakaan
 * sie öffnen kann; der Java-Prozess selbst beendet sich nach längerer Ruhe
 * (LEERLAUF_PROZESS_MS) und wird beim nächsten Zugriff neu gestartet.
 * Solange er läuft, gehen AUCH die Einmal-Aufrufe unten über ihn – ein
 * zweiter Java-Prozess würde sonst an der eigenen Sperre scheitern.
 * ------------------------------------------------------------------ */

const LEERLAUF_DB_MS = 3000;
const LEERLAUF_PROZESS_MS = 2 * 60 * 1000;

let dienst = null; // { kind, offen: Map(id → {resolve, timer}), naechsteId, dbPfad, puffer, leerlaufTimer }

function dienstLaeuft() {
  return Boolean(dienst && !dienst.beendet);
}

function starteDienst() {
  const kind = spawn(javaPfad(), ['-cp', klassenpfad(), 'Bridge', 'serve'], { windowsHide: true });
  const d = { kind, offen: new Map(), naechsteId: 1, dbPfad: null, puffer: '', beendet: false, leerlaufTimer: null, startFehler: null };
  kind.stdout.setEncoding('utf8');
  kind.stderr.setEncoding('utf8');
  kind.stdout.on('data', (daten) => {
    d.puffer += daten;
    let umbruch;
    while ((umbruch = d.puffer.indexOf('\n')) >= 0) {
      const zeile = d.puffer.slice(0, umbruch).trim();
      d.puffer = d.puffer.slice(umbruch + 1);
      if (!zeile) continue;
      let antwort;
      try { antwort = JSON.parse(zeile); } catch { continue; }
      const wartend = d.offen.get(antwort.id);
      if (!wartend) continue;
      d.offen.delete(antwort.id);
      clearTimeout(wartend.timer);
      delete antwort.id;
      wartend.resolve(antwort);
    }
  });
  kind.stderr.on('data', () => {}); // Stacktraces – für INGA uninteressant, Puffer aber leeren
  const beende = (fehler) => {
    if (d.beendet) return;
    d.beendet = true;
    clearTimeout(d.leerlaufTimer);
    for (const wartend of d.offen.values()) {
      clearTimeout(wartend.timer);
      wartend.resolve(fehler);
    }
    d.offen.clear();
    if (dienst === d) dienst = null;
  };
  kind.on('error', (err) => beende({
    ok: false,
    fehler: err.code === 'ENOENT' ? LAUFZEIT_FEHLT_HINWEIS : `Java-Laufzeit lässt sich nicht starten (${err.code || err.message}).`,
    laufzeitFehlt: err.code === 'ENOENT',
  }));
  kind.on('close', () => beende({ ok: false, fehler: 'Die Perpustakaan-Brücke wurde unerwartet beendet.' }));
  kind.stdin.on('error', () => {}); // Schreiben in einen gerade beendeten Prozess – wird über 'close' gemeldet
  return d;
}

/** Schickt einen Auftrag an den Dauerprozess (startet ihn bei Bedarf) und wartet auf dessen Antwortzeile. */
function dienstAuftrag(dbPfad, befehl, args = [], zeitlimitMs = BRIDGE_TIMEOUT_DATEN_MS) {
  if (!dienstLaeuft()) dienst = starteDienst();
  const d = dienst;
  clearTimeout(d.leerlaufTimer);
  const sende = (bef, argumente, limit) => new Promise((resolve) => {
    if (d.beendet) { resolve({ ok: false, fehler: 'Die Perpustakaan-Brücke läuft nicht.' }); return; }
    const id = d.naechsteId++;
    const timer = setTimeout(() => {
      d.offen.delete(id);
      resolve({ ok: false, fehler: 'Zeitüberschreitung beim Zugriff auf die Perpustakaan-Datenbank.' });
      // Ein hängender Prozess hielte womöglich die Datenbank – lieber neu starten.
      beendeDienst();
    }, limit);
    d.offen.set(id, { resolve, timer });
    // Tabs/Zeilenumbrüche in Pfaden würden das Zeilenprotokoll zerstören.
    const teile = [String(id), bef, ...argumente.map((a) => String(a).replace(/[\t\r\n]/g, ' '))];
    d.kind.stdin.write(teile.join('\t') + '\n', 'utf8');
  });
  const ablauf = (async () => {
    if (d.dbPfad !== dbPfad) {
      const geoeffnet = await sende('open', [dbPfad, LEERLAUF_DB_MS], BRIDGE_TIMEOUT_MS);
      if (!geoeffnet.ok) return geoeffnet;
      d.dbPfad = dbPfad;
    }
    return sende(befehl, args, zeitlimitMs);
  })();
  return ablauf.finally(() => {
    if (d.beendet || d.offen.size) return;
    clearTimeout(d.leerlaufTimer);
    d.leerlaufTimer = setTimeout(() => { if (!d.offen.size) beendeDienst(); }, LEERLAUF_PROZESS_MS);
  });
}

/** Dauerprozess sauber beenden (gibt die Datenbank frei) – beim Beenden von INGA und nach Zeitüberschreitungen. */
function beendeDienst() {
  const d = dienst;
  if (!d || d.beendet) return;
  dienst = null;
  try {
    d.kind.stdin.write('0\tquit\n', 'utf8');
    d.kind.stdin.end();
  } catch { /* schon beendet */ }
  // Falls der Prozess nicht reagiert: nach kurzer Zeit hart beenden.
  setTimeout(() => { if (!d.beendet) d.kind.kill(); }, 3000).unref?.();
}

/** Maskierung für die Änderungsdatei (siehe Bridge.java apply()). */
function maskiere(wert) {
  if (wert === null || wert === undefined) return '';
  return String(wert).replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/**
 * Änderungen in die Perpustakaan-Datenbank schreiben – EINE Transaktion.
 * `aenderungen`: [{ tabelle, spalten: [...], weg: [[Werte…]], neu: [[Werte…]] }]
 * (siehe perpustakaan-modus.js berechneAenderungen()).
 */
async function wendeAenderungenAn(dbPfad, aenderungen) {
  const zeilen = [];
  for (const { tabelle, spalten, weg, neu } of aenderungen) {
    zeilen.push(['T', tabelle, ...spalten].map(maskiere).join('\t'));
    for (const w of weg) zeilen.push(['-', ...w].map(maskiere).join('\t'));
    for (const n of neu) zeilen.push(['+', ...n].map(maskiere).join('\t'));
  }
  const datei = path.join(os.tmpdir(), `inga-perpustakaan-aenderungen-${process.pid}-${Date.now()}.txt`);
  fs.writeFileSync(datei, zeilen.join('\n') + '\n', 'utf8');
  try {
    return await dienstAuftrag(dbPfad, 'apply', [datei]);
  } finally {
    fs.unlink(datei, () => {});
  }
}

/** Nur prüfen, ob die Datenbank gerade frei ist – für die Statusanzeige und vor jedem Lese-/Schreibversuch. */
async function pruefeZugriff(dbPfad) {
  if (dienstLaeuft()) return dienstAuftrag(dbPfad, 'check', [], BRIDGE_TIMEOUT_MS);
  return rufeBridgeAuf(['check', dbPfad]);
}

/** Live aus der Perpustakaan-Datenbank lesen: schreibt ein Perpustakaan-Zip, das anschließend GENAUSO wie eine hochgeladene Sicherung per csvio.importZip() eingelesen wird – keine zweite Import-Logik nötig. */
async function dumpNachZip(dbPfad, tables, zielZip) {
  const schemaDatei = schreibeSchemaDatei(tables);
  try {
    if (dienstLaeuft()) return await dienstAuftrag(dbPfad, 'dump', [schemaDatei, zielZip]);
    return await rufeBridgeAuf(['dump', dbPfad, schemaDatei, zielZip], BRIDGE_TIMEOUT_DATEN_MS);
  } finally {
    fs.unlink(schemaDatei, () => {});
  }
}

/** Wie dumpNachZip(), aber immer über den Dauerprozess (Perpustakaan-Modus) – liefert zusätzlich einen Inhalts-Hash, um unveränderte Stände zu erkennen. */
async function dumpUeberDienst(dbPfad, tables, zielZip) {
  const schemaDatei = schreibeSchemaDatei(tables);
  try {
    return await dienstAuftrag(dbPfad, 'dump', [schemaDatei, zielZip]);
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
  if (dienstLaeuft()) return dienstAuftrag(dbPfad, 'load', [quellZip]);
  return rufeBridgeAuf(['load', dbPfad, quellZip], BRIDGE_TIMEOUT_DATEN_MS);
}

module.exports = {
  pruefeZugriff, dumpNachZip, ladeAusZip, javaPfad, klassenpfad, setzeZusaetzlicheLaufzeitBasis, laufzeitVorhanden, LAUFZEIT_FEHLT_HINWEIS,
  // Perpustakaan-Modus (Dauerprozess)
  dienstAuftrag, dienstLaeuft, beendeDienst, wendeAenderungenAn, dumpUeberDienst,
};
