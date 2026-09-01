'use strict';

/** Kleines Element-Bauhilfsmittel, damit die Ansichten ohne Vorlagenmotor auskommen. */
function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'list') {
      try { node[key] = value; } catch { node.setAttribute(key, value); }
    } else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number' ? document.createTextNode(String(child)) : child);
  }
  return node;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function toast(message, kind = '') {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = kind;
  requestAnimationFrame(() => node.classList.add('show'));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => node.classList.remove('show'), 3200);
}

/**
 * Heutiges Kalenderdatum als "YYYY-MM-DD" für Datei-Vorschlagsnamen und
 * Vorschau-Platzhalter – bewusst über die lokalen Date-Getter statt über
 * `new Date().toISOString()`, das in Deutschland (positiver UTC-Offset)
 * kurz nach lokaler Mitternacht noch den Vortag liefern würde (derselbe
 * Fehler, den date-utils.js im Hauptprozess schon beheben musste).
 */
function heutigesDatumISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Ersetzt {Platzhalter} in einer Vorlage durch Werte aus `werte` – von der
 * Live-Vorschau in den Einstellungen UND vom tatsächlichen Mahnungsdruck
 * gleich genutzt (Platzhalter: {Vorname} {Nachname} {Titel} {Tage}
 * {Gebuehr} {Datum} {Faellig} {Stufe}), damit beide garantiert identisch
 * ersetzen. Unbekannte Platzhalter bleiben unverändert stehen.
 */
function fuellePlatzhalter(vorlage, werte) {
  return String(vorlage || '').replace(/\{(\w+)\}/g, (ganzerTreffer, name) => (Object.hasOwn(werte, name) ? werte[name] : ganzerTreffer));
}

function fmtDatum(value) {
  if (!value) return '–';
  const d = String(value).slice(0, 10);
  const [y, m, day] = d.split('-');
  return y && m && day ? `${day}.${m}.${y}` : d;
}

function fmtGeld(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}
