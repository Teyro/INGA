'use strict';

const api = window.inga;
let letzteDaten = null;

/** Escaped Text für die Verwendung innerhalb eines HTML-Templates (Kopf-/Fußzeile beim PDF-Export). */
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function zeile(z) {
  return el('tr', {}, [
    el('td', {}, [z.Titel || '']),
    el('td', {}, [z.Autor || '']),
    el('td', {}, [z.MedienEtik || '']),
    el('td', {}, [`${z.Nachname || ''}, ${z.Vorname || ''}`]),
    el('td', {}, [z.Jahrgang || '']),
    el('td', {}, [fmtDatum(z.AuslDatum)]),
    el('td', {}, [fmtDatum(z.faelligAm)]),
    el('td', { class: 'num' }, [z.tageUeberfaellig > 0 ? String(z.tageUeberfaellig) : '']),
    el('td', { class: 'num' }, [String(z.AnzVerl || 0)]),
  ]);
}

function tabelle(gruppen) {
  const tbody = el('tbody', {}, []);
  for (const gruppe of gruppen) {
    if (gruppe.titel) {
      tbody.appendChild(el('tr', { class: 'gruppe-kopf' }, [el('td', { colSpan: 9 }, [gruppe.titel])]));
    }
    for (const z of gruppe.zeilen) tbody.appendChild(zeile(z));
  }
  return el('table', { class: 'umlauf-tabelle' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', {}, ['Buchtitel']), el('th', {}, ['Autor']), el('th', {}, ['Signatur/Barcode']),
        el('th', {}, ['Kind']), el('th', {}, ['Klasse']), el('th', {}, ['Ausgeliehen am']),
        el('th', {}, ['Rückgabe bis']), el('th', { class: 'num' }, ['Tage überfällig']), el('th', { class: 'num' }, ['Verlängerungen']),
      ]),
    ]),
    tbody,
  ]);
}

function anzahlZeilen(gruppen) {
  return gruppen.reduce((n, g) => n + g.zeilen.length, 0);
}

function render(data) {
  const anzahl = anzahlZeilen(data.gruppen || []);
  document.getElementById('anzahl').textContent = `${anzahl} Ausleihe${anzahl === 1 ? '' : 'n'}`;

  const root = document.documentElement;
  const s = data.settings || {};
  if (s.os) { root.dataset.os = s.os; root.dataset.chrome = s.os === 'mac' ? 'mac' : s.os === 'win' ? 'overlay' : 'native'; }
  if (s.ui) root.dataset.ui = s.ui;

  document.getElementById('page-style').textContent = `@page { size: A4 landscape; margin: 12mm; }`;

  const schulname = s.absenderName || 'Schulbibliothek';
  const datum = new Date().toLocaleDateString('de-DE');
  const kopf = el('div', { class: 'umlauf-kopf' }, [
    el('div', { class: 'umlauf-kopf-schule' }, [schulname]),
    el('h1', {}, [data.titel || 'Im Umlauf – was ist gerade unterwegs?']),
    el('div', { class: 'umlauf-kopf-meta' }, [
      el('span', {}, [`Stand: ${datum}`]),
      data.filterBeschreibung ? el('span', {}, [data.filterBeschreibung]) : null,
    ]),
  ]);

  const paper = document.getElementById('paper');
  paper.replaceChildren(el('div', { class: 'umlauf-blatt' }, [kopf, tabelle(data.gruppen || [])]));
}

api.on('print:data', (data) => {
  letzteDaten = data;
  render(data);
});

document.getElementById('close').addEventListener('click', () => api.window.close());

document.getElementById('print').addEventListener('click', () =>
  api.print.now({ landscape: true }).catch((err) => alert(`Drucken fehlgeschlagen: ${err.message || err}`))
);

document.getElementById('pdf').addEventListener('click', () => {
  const s = letzteDaten?.settings || {};
  const schulname = escapeHtml(s.absenderName || 'Schulbibliothek');
  const filterBeschreibung = escapeHtml(letzteDaten?.filterBeschreibung || '');
  const datum = escapeHtml(new Date().toLocaleDateString('de-DE'));
  api.print
    .pdf({
      name: 'Im Umlauf',
      landscape: true,
      headerTemplate: `<div style="font-size:8px; width:100%; padding:0 10mm; display:flex; justify-content:space-between; color:#333;"><span>${schulname}</span><span>${filterBeschreibung}</span><span>${datum}</span></div>`,
      footerTemplate: `<div style="font-size:8px; width:100%; text-align:center; color:#333;">Seite <span class="pageNumber"></span> von <span class="totalPages"></span></div>`,
    })
    .catch((err) => alert(`PDF-Export fehlgeschlagen: ${err.message || err}`));
});
