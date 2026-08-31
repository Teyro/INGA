'use strict';

const api = window.inga;

function renderBrief(brief) {
  const { leser, posten, summe } = brief;
  return el('article', { class: 'brief' }, [
    el('div', { class: 'absender' }, [brief.absenderName || 'Schulbibliothek', brief.absenderAdresse ? el('div', {}, [brief.absenderAdresse]) : null]),
    el('div', { class: 'empfaenger' }, [
      el('div', {}, [`${leser?.Vorname || ''} ${leser?.Nachname || ''}`]),
      leser?.Strasse ? el('div', {}, [leser.Strasse]) : null,
      leser?.Ort ? el('div', {}, [`${leser.PLZ || ''} ${leser.Ort}`.trim()]) : null,
    ]),
    el('div', { class: 'datum' }, [brief.datum]),
    el('h1', {}, [posten[0]?.stufe?.text || 'Mahnung']),
    el('p', {}, [
      `Liebe/r ${leser?.Vorname || ''} ${leser?.Nachname || ''}, `,
      'die folgenden Medien sind überfällig. Bitte gib sie so bald wie möglich zurück.',
    ]),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Titel']), el('th', {}, ['Ausgeliehen am']), el('th', { class: 'num' }, ['Gebühr'])])]),
      el('tbody', {}, posten.map((p) =>
        el('tr', {}, [el('td', {}, [p.Titel]), el('td', {}, [fmtDatum(p.AuslDatum)]), el('td', { class: 'num' }, [fmtGeld(p.stufe.gebuehr)])])
      )),
    ]),
    el('div', { class: 'summe' }, [`Gesamt: ${fmtGeld(summe)}`]),
    el('p', { class: 'schluss' }, ['Vielen Dank für die Rückgabe.']),
  ]);
}

api.on('print:data', (data) => {
  document.getElementById('anzahl').textContent = `${data.briefe.length} Brief${data.briefe.length === 1 ? '' : 'e'}`;

  const root = document.documentElement;
  const s = data.settings || {};
  if (s.os) { root.dataset.os = s.os; root.dataset.chrome = s.os === 'mac' ? 'mac' : s.os === 'win' ? 'overlay' : 'native'; }
  if (s.ui) root.dataset.ui = s.ui;

  document.getElementById('page-style').textContent = `@page { size: A4; margin: 0; }`;
  const paper = document.getElementById('paper');
  paper.replaceChildren(...data.briefe.map(renderBrief));
});

document.getElementById('close').addEventListener('click', () => api.window.close());
document.getElementById('print').addEventListener('click', () => api.print.now());
document.getElementById('pdf').addEventListener('click', () => api.print.pdf({ name: 'Mahnungen' }));
