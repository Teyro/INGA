'use strict';

const api = window.inga;

/** Setzt {Vorname} {Nachname} {Titel} {Tage} {Gebuehr} {Datum} {Faellig} {Stufe} in einer Vorlage ein. */
function fuelleVorlage(vorlage, werte) {
  return String(vorlage || '').replace(/\{(\w+)\}/g, (match, key) => (Object.hasOwn(werte, key) ? werte[key] : match));
}

/** Die Stufe des dringendsten Postens eines Briefs – bestimmt Betreff und Brieftext, falls mehrere Medien überfällig sind. */
function massgeblicheStufe(posten) {
  const dringendster = posten.reduce((max, p) => (!max || (p.stufeIndex ?? -1) >= (max.stufeIndex ?? -1) ? p : max), null);
  return dringendster?.stufe || {};
}

function renderBrief(brief) {
  const { leser, posten, summe } = brief;
  const stufe = massgeblicheStufe(posten);
  const tageMax = Math.max(...posten.map((p) => p.tageUeberfaellig || 0));
  const faelligMin = posten.map((p) => p.faelligAm).sort()[0];
  const werte = {
    Vorname: leser?.Vorname || '',
    Nachname: leser?.Nachname || '',
    Titel: posten.map((p) => p.Titel).join(', '),
    Tage: String(tageMax),
    Gebuehr: fmtGeld(summe),
    Datum: brief.datum,
    Faellig: fmtDatum(faelligMin),
    Stufe: stufe.text || 'Mahnung',
  };

  return el('article', { class: 'brief' }, [
    el('div', { class: 'briefkopf' }, [
      brief.mahnLogoDataUrl ? el('img', { class: 'logo', src: brief.mahnLogoDataUrl, alt: '' }) : null,
      el('div', { class: 'absender' }, [
        brief.absenderName || 'Schulbibliothek',
        brief.absenderAdresse ? el('div', {}, [brief.absenderAdresse]) : null,
        [brief.absenderEmail, brief.absenderTelefon].filter(Boolean).length
          ? el('div', { class: 'kontakt' }, [[brief.absenderEmail, brief.absenderTelefon].filter(Boolean).join(' · ')])
          : null,
      ]),
    ]),
    el('div', { class: 'empfaenger' }, [
      el('div', {}, [`${leser?.Vorname || ''} ${leser?.Nachname || ''}`]),
      leser?.Strasse ? el('div', {}, [leser.Strasse]) : null,
      leser?.Ort ? el('div', {}, [`${leser.PLZ || ''} ${leser.Ort}`.trim()]) : null,
    ]),
    el('div', { class: 'datum' }, [brief.datum]),
    el('h1', {}, [fuelleVorlage(brief.mahnBetreffVorlage, werte) || stufe.text || 'Mahnung']),
    ...fuelleVorlage(stufe.briefText, werte)
      .split('\n')
      .map((zeile) => (zeile.trim() ? el('p', {}, [zeile]) : null)),
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [el('th', {}, ['Titel']), el('th', {}, ['Ausgeliehen am']), el('th', {}, ['Tage überfällig']), el('th', { class: 'num' }, ['Gebühr'])])]),
      el('tbody', {}, posten.map((p) =>
        el('tr', {}, [el('td', {}, [p.Titel]), el('td', {}, [fmtDatum(p.AuslDatum)]), el('td', {}, [String(p.tageUeberfaellig || 0)]), el('td', { class: 'num' }, [fmtGeld(p.stufe.gebuehr)])])
      )),
    ]),
    el('div', { class: 'summe' }, [`Gesamt: ${fmtGeld(summe)}`]),
    ...String(brief.mahnSchluss || '')
      .split('\n')
      .map((zeile) => (zeile.trim() ? el('p', { class: 'schluss' }, [zeile]) : el('br'))),
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
