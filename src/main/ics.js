'use strict';

/**
 * Sehr kleiner ICS/iCal-Parser – bewusst kein vollständiger RFC-5545-Parser
 * (keine Wiederholungsregeln, keine Zeitzonen-Datenbank), sondern genau so
 * viel, wie Ferienkalender in der Praxis brauchen: VEVENT-Blöcke mit SUMMARY,
 * DTSTART und DTEND als ganztägige Termine. Reicht für die üblichen
 * Ferienkalender-Downloads von Schulbehörden und Kalenderdiensten.
 */

const { addTage } = require('./date-utils');

/** Ent-faltet nach RFC 5545 umgebrochene Zeilen (Fortsetzung beginnt mit Leerzeichen/Tab). */
function entfalteZeilen(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n');
}

/** "20261019" oder "20261019T000000Z" → "2026-10-19"; ungültige Werte liefern null statt zu werfen. */
function parseIcsDatum(wert) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(String(wert ?? ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * Liefert eine Liste von { bezeichnung, startdatum, enddatum } – bereits im
 * gleichen Format wie die `ferien`-Tabelle, aber noch ohne `typ`/`quelle`
 * (die legt der Aufrufer beim Import fest, z. B. immer "Ferien" oder anhand
 * einer Nutzerauswahl in der Vorschau).
 */
function parseIcs(text) {
  const zeilen = entfalteZeilen(text);
  const termine = [];
  let aktuelles = null;
  for (const zeileRoh of zeilen) {
    const zeile = zeileRoh.trim();
    if (zeile === 'BEGIN:VEVENT') {
      aktuelles = {};
      continue;
    }
    if (zeile === 'END:VEVENT') {
      if (aktuelles?.start) termine.push(aktuelles);
      aktuelles = null;
      continue;
    }
    if (!aktuelles) continue;
    const idx = zeile.indexOf(':');
    if (idx < 0) continue;
    // Vor dem ":" können noch Parameter stehen (z. B. "DTSTART;VALUE=DATE") –
    // für unsere Zwecke reicht der Schlüssel vor dem ersten ";".
    const schluessel = zeile.slice(0, idx).split(';')[0].toUpperCase();
    const wert = zeile.slice(idx + 1);
    if (schluessel === 'SUMMARY') {
      aktuelles.bezeichnung = wert.replace(/\\,/g, ',').replace(/\\n/gi, ' ').replace(/\\\\/g, '\\').trim();
    } else if (schluessel === 'DTSTART') {
      aktuelles.start = parseIcsDatum(wert);
    } else if (schluessel === 'DTEND') {
      aktuelles.endeExklusiv = parseIcsDatum(wert);
    }
  }
  return termine
    .filter((t) => t.start)
    .map((t) => ({
      bezeichnung: t.bezeichnung || '(ohne Bezeichnung)',
      startdatum: t.start,
      // DTEND ist bei ganztägigen ICS-Terminen exklusiv (der Termin endet AM
      // DTEND-Tag um 00:00, nicht an dessen Ende) – ohne eigenes DTEND gilt
      // der Termin nur am Starttag.
      enddatum: t.endeExklusiv ? addTage(t.endeExklusiv, -1) : t.start,
    }));
}

module.exports = { parseIcs };
