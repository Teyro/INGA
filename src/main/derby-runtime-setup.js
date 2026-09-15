'use strict';

/**
 * EXPERIMENTELL (siehe perpustakaan-live.js): lädt die Java-Laufzeit (Temurin-
 * JRE) + Derby-Jars herunter, die für den direkten Zugriff auf eine echte
 * Perpustakaan-Datenbank nötig sind. Node hat keinen Derby-Treiber, Derby
 * ist reines Java – deshalb eine (schlanke) JRE statt eines vollen JDK:
 * rund 45–55 MB komprimiert je Plattform statt ~200 MB für ein komplettes
 * JDK.
 *
 * Reiner Funktionsbaustein, KEIN eigenes CLI-Skript – wird von zwei Seiten
 * genutzt:
 *  - scripts/setup-derby-runtime.js (Build-Zeit: lädt nach ins Projekt,
 *    landet über extraResources im fertigen Programmpaket)
 *  - src/main/main.js (Laufzeit: der "Assistent"-Knopf in den
 *    Einstellungen, falls die mitgelieferte Laufzeit auf einer echten
 *    Installation aus irgendeinem Grund fehlt/nicht startet – dann lädt
 *    INGA sie selbst in den userData-Ordner nach, siehe
 *    perpustakaan-live.js "zusätzliche Laufzeit-Basis")
 * – deshalb bewusst mit explizitem `zielOrdner`-Parameter statt eines
 * hart codierten, projektrelativen Pfads.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const DERBY_VERSION = '10.17.1.0';
const JRE_MAJOR = '21';

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

/** tar.gz (Linux/Mac) oder zip (Windows) entpacken – ohne fremde npm-Abhängigkeit, nutzt das im Betriebssystem eingebaute "tar" (auch unter Windows 10 1803+/11 vorhanden, wie bei electron-builder selbst üblich). */
function entpacken(archivPfad, zielOrdner) {
  fs.mkdirSync(zielOrdner, { recursive: true });
  try {
    if (archivPfad.endsWith('.zip')) {
      execFileSync('tar', ['-xf', archivPfad, '-C', zielOrdner], { stdio: 'inherit' }); // moderne tar-Versionen entpacken auch zip
    } else {
      execFileSync('tar', ['-xzf', archivPfad, '-C', zielOrdner], { stdio: 'inherit' });
    }
  } catch (err) {
    throw new Error(`Entpacken fehlgeschlagen (braucht "tar" im Systempfad – unter Windows 10 ab Version 1803/Windows 11 eingebaut): ${err.message}`);
  }
}

/** Adoptium-Archive enthalten einen einzigen Wurzelordner (z. B. "jdk-21.0.12.1+1-jre") – dessen Inhalt braucht INGA direkt unter <zielOrdner>/jre. Räumt den (nach dem Verschieben leeren bzw. bei abweichender Struktur übrig gebliebenen) Entpack-Ordner danach weg, statt ihn als Datenleiche liegen zu lassen. */
function verschiebeWurzelinhalt(entpackterOrdner, zielOrdner) {
  const eintraege = fs.readdirSync(entpackterOrdner);
  const wurzel = eintraege.length === 1 ? path.join(entpackterOrdner, eintraege[0]) : entpackterOrdner;
  fs.rmSync(zielOrdner, { recursive: true, force: true });
  fs.renameSync(wurzel, zielOrdner);
  fs.rmSync(entpackterOrdner, { recursive: true, force: true });
}

/** Lädt die JRE nach `<basisOrdner>/jre`, sofern dort noch keine (lauffähige) steht. */
async function holeJre(basisOrdner, plattform = aktuellePlattform()) {
  const jreZiel = path.join(basisOrdner, 'jre');
  if (fs.existsSync(path.join(jreZiel, 'bin', plattform === 'win' ? 'java.exe' : 'java'))) {
    return { ok: true, ueberuebersprungen: true, pfad: jreZiel };
  }
  const { url, dateiname } = await adoptiumDownloadUrl(plattform);
  const tmpArchiv = path.join(basisOrdner, dateiname);
  fs.mkdirSync(basisOrdner, { recursive: true });
  await herunterladen(url, tmpArchiv);
  const tmpEntpackt = path.join(basisOrdner, '_jre_entpackt');
  entpacken(tmpArchiv, tmpEntpackt);
  verschiebeWurzelinhalt(tmpEntpackt, jreZiel);
  fs.unlinkSync(tmpArchiv);
  return { ok: true, ueberuebersprungen: false, pfad: jreZiel };
}

/** Lädt die Derby-Jars nach `<basisOrdner>/derby-jars`, sofern dort noch keine liegen. */
async function holeDerbyJars(basisOrdner) {
  const jarsZiel = path.join(basisOrdner, 'derby-jars');
  fs.mkdirSync(jarsZiel, { recursive: true });
  const jars = [
    { name: 'derby', ziel: 'derby.jar' },
    { name: 'derbyshared', ziel: 'derbyshared.jar' },
  ];
  for (const jar of jars) {
    const zielPfad = path.join(jarsZiel, jar.ziel);
    if (fs.existsSync(zielPfad)) continue;
    const url = `https://repo1.maven.org/maven2/org/apache/derby/${jar.name}/${DERBY_VERSION}/${jar.name}-${DERBY_VERSION}.jar`;
    await herunterladen(url, zielPfad);
  }
  return { ok: true, pfad: jarsZiel };
}

/** Beide Teile zusammen nach `<basisOrdner>` (…/jre, …/derby-jars) – die von perpustakaan-live.js erwartete Ordnerstruktur. */
async function richteVollstaendigEin(basisOrdner, plattform = aktuellePlattform()) {
  const jre = await holeJre(basisOrdner, plattform);
  const jars = await holeDerbyJars(basisOrdner);
  return { jre, jars };
}

module.exports = { aktuellePlattform, holeJre, holeDerbyJars, richteVollstaendigEin, ADOPTIUM_ASSET };
