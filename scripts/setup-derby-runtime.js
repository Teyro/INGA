'use strict';

/**
 * EXPERIMENTELL (Branch feature/perpustakaan-live-db): lädt die Java-
 * Laufzeit + Derby-Jars herunter, die src/main/perpustakaan-live.js für den
 * direkten Zugriff auf eine echte Perpustakaan-Datenbank braucht, und legt
 * sie unter derby-runtime/ ab (bewusst NICHT in git – das wäre eine
 * "Riesen Datei" im Repository selbst; stattdessen wie Electrons eigene
 * Binärdateien bei jedem Build neu geholt, siehe package.json
 * "extraResources"/"predist"). Node hat keinen Derby-Treiber, Derby ist
 * reines Java – deshalb eine (schlanke) JRE statt eines vollen JDK: rund
 * 45–55 MB komprimiert je Plattform statt ~200 MB für ein komplettes JDK.
 *
 * Aufruf: `node scripts/setup-derby-runtime.js [win|mac|mac-arm|linux]`
 * (ohne Argument: aktuelle Plattform, wie sie CI/electron-builder gerade
 * baut). Bereits vorhandene Dateien werden übersprungen, ein zweiter
 * Aufruf ist also billig.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const DERBY_VERSION = '10.17.1.0';
const JRE_MAJOR = '21';

const ZIEL = path.join(__dirname, '..', 'derby-runtime');
const JRE_ZIEL = path.join(ZIEL, 'jre');
const JARS_ZIEL = path.join(ZIEL, 'derby-jars');

// Adoptium-Paketnamen je Plattform (image_type=jre, hotspot) – siehe
// https://api.adoptium.net/v3/assets/latest/21/hotspot?image_type=jre
const ADOPTIUM_ASSET = {
  linux: { os: 'linux', arch: 'x64', ext: 'tar.gz' },
  win: { os: 'windows', arch: 'x64', ext: 'zip' },
  mac: { os: 'mac', arch: 'x64', ext: 'tar.gz' },
  'mac-arm': { os: 'mac', arch: 'aarch64', ext: 'tar.gz' },
};

function aktuellePlattform() {
  if (process.platform === 'win32') return 'win';
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm' : 'mac';
  return 'linux';
}

function herunterladen(url, zielDatei) {
  return new Promise((resolve, reject) => {
    const anfrage = https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        herunterladen(res.headers.location, zielDatei).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode} bei ${url}`)); return; }
      const datei = fs.createWriteStream(zielDatei);
      res.pipe(datei);
      datei.on('finish', () => datei.close(resolve));
      datei.on('error', reject);
    });
    anfrage.on('error', reject);
  });
}

async function adoptiumDownloadUrl(plattform) {
  const asset = ADOPTIUM_ASSET[plattform];
  if (!asset) throw new Error(`Unbekannte Plattform „${plattform}“ – erwartet: ${Object.keys(ADOPTIUM_ASSET).join(', ')}`);
  const api = `https://api.adoptium.net/v3/assets/latest/${JRE_MAJOR}/hotspot?image_type=jre&os=${asset.os}&architecture=${asset.arch}`;
  const json = await new Promise((resolve, reject) => {
    https.get(api, { headers: { Accept: 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (d) => (data += d));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
  const treffer = json?.[0]?.binary?.package;
  if (!treffer?.link) throw new Error(`Adoptium-API lieferte kein passendes JRE für ${plattform} (${asset.os}/${asset.arch})`);
  return { url: treffer.link, dateiname: treffer.name };
}

/** tar.gz (Linux/Mac) oder zip (Windows) entpacken – ohne fremde npm-Abhängigkeit, nutzt die im Betriebssystem vorhandenen Werkzeuge (tar gibt es auch unter Windows 10+/11 eingebaut, wie bei electron-builder selbst üblich). */
function entpacken(archivPfad, zielOrdner) {
  fs.mkdirSync(zielOrdner, { recursive: true });
  if (archivPfad.endsWith('.zip')) {
    execFileSync('tar', ['-xf', archivPfad, '-C', zielOrdner], { stdio: 'inherit' }); // moderne tar-Versionen entpacken auch zip
  } else {
    execFileSync('tar', ['-xzf', archivPfad, '-C', zielOrdner], { stdio: 'inherit' });
  }
}

/** Adoptium-Archive enthalten einen einzigen Wurzelordner (z. B. "jdk-21.0.12.1+1-jre") – dessen Inhalt braucht INGA direkt unter derby-runtime/jre. Räumt den (nach dem Verschieben leeren bzw. bei abweichender Struktur übrig gebliebenen) Entpack-Ordner danach weg, statt ihn als Datenleiche liegen zu lassen. */
function verschiebeWurzelinhalt(entpackterOrdner, zielOrdner) {
  const eintraege = fs.readdirSync(entpackterOrdner);
  const wurzel = eintraege.length === 1 ? path.join(entpackterOrdner, eintraege[0]) : entpackterOrdner;
  fs.rmSync(zielOrdner, { recursive: true, force: true });
  fs.renameSync(wurzel, zielOrdner);
  fs.rmSync(entpackterOrdner, { recursive: true, force: true });
}

async function holeJre(plattform) {
  if (fs.existsSync(path.join(JRE_ZIEL, 'bin', plattform === 'win' ? 'java.exe' : 'java'))) {
    console.log('[derby-runtime] JRE bereits vorhanden, überspringe Download.');
    return;
  }
  const { url, dateiname } = await adoptiumDownloadUrl(plattform);
  console.log(`[derby-runtime] Lade JRE ${JRE_MAJOR} für ${plattform}: ${dateiname}`);
  const tmpArchiv = path.join(ZIEL, dateiname);
  fs.mkdirSync(ZIEL, { recursive: true });
  await herunterladen(url, tmpArchiv);
  const tmpEntpackt = path.join(ZIEL, '_jre_entpackt');
  entpacken(tmpArchiv, tmpEntpackt);
  verschiebeWurzelinhalt(tmpEntpackt, JRE_ZIEL);
  fs.unlinkSync(tmpArchiv);
  console.log('[derby-runtime] JRE bereit unter', JRE_ZIEL);
}

async function holeDerbyJars() {
  fs.mkdirSync(JARS_ZIEL, { recursive: true });
  const jars = [
    { name: 'derby', ziel: 'derby.jar' },
    { name: 'derbyshared', ziel: 'derbyshared.jar' },
  ];
  for (const jar of jars) {
    const zielPfad = path.join(JARS_ZIEL, jar.ziel);
    if (fs.existsSync(zielPfad)) continue;
    const url = `https://repo1.maven.org/maven2/org/apache/derby/${jar.name}/${DERBY_VERSION}/${jar.name}-${DERBY_VERSION}.jar`;
    console.log(`[derby-runtime] Lade ${jar.name}-${DERBY_VERSION}.jar …`);
    await herunterladen(url, zielPfad);
  }
  console.log('[derby-runtime] Derby-Jars bereit unter', JARS_ZIEL);
}

async function main() {
  const plattform = process.argv[2] || aktuellePlattform();
  await holeJre(plattform);
  await holeDerbyJars();
}

main().catch((err) => {
  console.error('[derby-runtime] Einrichtung fehlgeschlagen:', err.message);
  process.exit(1);
});
