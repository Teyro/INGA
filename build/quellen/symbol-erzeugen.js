'use strict';

/**
 * Erzeugt das INGA-App-Symbol aus den Quellen in diesem Ordner:
 *   avatar-freigestellt.png – der freigestellte INGA-Avatar (links fehlende
 *                             Haare aus der rechten Seite gespiegelt ergänzt,
 *                             Haarkante rechts geglättet, Oberkörper links
 *                             schmaler mit natürlicher Schulter)
 *   buch.svg                – das aufgeschlagene Buch mit Lesezeichen
 * und schreibt alle benötigten Größen: build/icon.png (1024, macOS),
 * build/icon-flat.png (512, Linux), build/icon-256.png, build/icon.ico
 * (Windows, 16–256 px) und src/renderer/img/icon-256.png (Start-/
 * Abschiedsfenster, Linux-Fenstersymbol).
 *
 * Nicht Teil des normalen Builds (braucht Bildbibliotheken, die INGA selbst
 * nicht mitbringt). Aufruf bei Bedarf in einem Ordner außerhalb des Projekts:
 *   npm install sharp png-to-ico
 *   node <Pfad>/build/quellen/symbol-erzeugen.js
 */

const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');

const QUELLEN = __dirname;
const BUILD = path.join(__dirname, '..');
const RENDERER_IMG = path.join(__dirname, '..', '..', 'src', 'renderer', 'img');
const S = 1024;
const R = 220; // Eckenradius der Kachel

async function symbol() {
  const hintergrund = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ea8ff"/><stop offset="1" stop-color="#3d6fe0"/></linearGradient>
      <radialGradient id="licht" cx="0.78" cy="0.3" r="0.45"><stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="${S}" height="${S}" rx="${R}" fill="url(#g)"/>
    <rect width="${S}" height="${S}" rx="${R}" fill="url(#licht)"/>
  </svg>`);
  const kachelMaske = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}"><rect width="${S}" height="${S}" rx="${R}" fill="#fff"/></svg>`);

  // Avatar: Kopf ganz sichtbar, Körper läuft unten/links aus der Kachel
  const avatar = await sharp(path.join(QUELLEN, 'avatar-freigestellt.png')).resize({ width: Math.round(570 * 1.55) }).toBuffer();

  // Buch: leicht gedreht, weicher Schatten, schwebt über der präsentierenden Hand
  const buchRoh = await sharp(path.join(QUELLEN, 'buch.svg'), { density: 200 }).resize(320).png().toBuffer();
  const buch = await sharp(buchRoh).rotate(-9, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const bm = await sharp(buch).metadata();
  const alpha = await sharp(buch).ensureAlpha().extractChannel(3).toColourspace('b-w').blur(10).raw().toBuffer({ resolveWithObject: true });
  const schatten = Buffer.alloc(alpha.info.width * alpha.info.height * 4);
  for (let i = 0; i < alpha.info.width * alpha.info.height; i++) {
    schatten[i * 4] = 20; schatten[i * 4 + 1] = 40; schatten[i * 4 + 2] = 110; schatten[i * 4 + 3] = Math.round(alpha.data[i] * 0.35);
  }
  const schattenPng = await sharp(schatten, { raw: { width: alpha.info.width, height: alpha.info.height, channels: 4 } }).png().toBuffer();
  const bx = Math.round(824 - bm.width / 2);
  const by = Math.round(500 - bm.height);

  const ebene = await sharp({ create: { width: S, height: S, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: avatar, left: -3, top: 122 },
      { input: schattenPng, left: bx + 8, top: by + 14 },
      { input: buch, left: bx, top: by },
    ])
    .png()
    .toBuffer();
  const geclippt = await sharp(ebene).composite([{ input: kachelMaske, blend: 'dest-in' }]).png().toBuffer();
  return sharp(hintergrund).composite([{ input: geclippt }]).png().toBuffer();
}

(async () => {
  const gross = await symbol();
  await sharp(gross).png({ compressionLevel: 9 }).toFile(path.join(BUILD, 'icon.png'));
  await sharp(gross).resize(512).png({ compressionLevel: 9 }).toFile(path.join(BUILD, 'icon-flat.png'));
  await sharp(gross).resize(256).png({ compressionLevel: 9 }).toFile(path.join(BUILD, 'icon-256.png'));
  await sharp(gross).resize(256).png({ compressionLevel: 9 }).toFile(path.join(RENDERER_IMG, 'icon-256.png'));
  const ico = await Promise.all([16, 24, 32, 48, 64, 128, 256].map((g) => sharp(gross).resize(g).png().toBuffer()));
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), await (pngToIco.default || pngToIco)(ico));
  console.log('Symbole geschrieben.');
})();
