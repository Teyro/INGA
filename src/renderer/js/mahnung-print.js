'use strict';

const api = window.inga;

/** Die Stufe des dringendsten Postens eines Briefs – bestimmt Betreff und Brieftext, falls mehrere Medien überfällig sind. */
function massgeblicheStufe(posten) {
  const dringendster = posten.reduce((max, p) => (!max || (p.stufeIndex ?? -1) >= (max.stufeIndex ?? -1) ? p : max), null);
  return dringendster?.stufe || {};
}

function renderBrief(brief) {
  const { leser, posten, summe, mahngebuehrenAktiv } = brief;
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
    el('h1', {}, [fuellePlatzhalter(brief.mahnBetreffVorlage, werte) || stufe.text || 'Mahnung']),
    ...fuellePlatzhalter(stufe.briefText, werte)
      .split('\n')
      .map((zeile) => (zeile.trim() ? el('p', {}, [zeile]) : null)),
    el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', {}, ['Titel']),
          el('th', {}, ['Ausgeliehen am']),
          el('th', {}, ['Tage überfällig']),
          mahngebuehrenAktiv ? el('th', { class: 'num' }, ['Gebühr']) : null,
        ]),
      ]),
      el(
        'tbody',
        {},
        posten.map((p) =>
          el('tr', {}, [
            el('td', {}, [p.Titel]),
            el('td', {}, [fmtDatum(p.AuslDatum)]),
            el('td', {}, [String(p.tageUeberfaellig || 0)]),
            mahngebuehrenAktiv ? el('td', { class: 'num' }, [fmtGeld(p.gebuehr)]) : null,
          ])
        )
      ),
    ]),
    mahngebuehrenAktiv ? el('div', { class: 'summe' }, [`Gesamt: ${fmtGeld(summe)}`]) : null,
    ...String(brief.mahnSchluss || '')
      .split('\n')
      .map((zeile) => (zeile.trim() ? el('p', { class: 'schluss' }, [zeile]) : el('br'))),
  ]);
}

let aktuelleBriefe = [];

api.on('print:data', (data) => {
  aktuelleBriefe = data.briefe;
  document.getElementById('anzahl').textContent = `${data.briefe.length} Brief${data.briefe.length === 1 ? '' : 'e'}`;

  const root = document.documentElement;
  const s = data.settings || {};
  if (s.os) { root.dataset.os = s.os; root.dataset.chrome = s.os === 'mac' ? 'mac' : s.os === 'win' ? 'overlay' : 'native'; }
  if (s.ui) root.dataset.ui = s.ui;

  document.getElementById('page-style').textContent = `@page { size: A4; margin: 0; }`;
  const paper = document.getElementById('paper');
  paper.replaceChildren(...data.briefe.map(renderBrief));
});

/**
 * Reintext-Fassung eines Briefs für mailto: – dieselben Platzhalter wie
 * renderBrief(), aber ohne HTML: Anrede/Brieftext, Medienliste als einfache
 * Zeilen, Schlusstext. Kein Briefkopf/keine Anschrift (steht schon in der
 * E-Mail selbst: Absender = Konto des Versendenden, Empfänger = To-Feld).
 */
function brieftextAlsEmail(brief) {
  const { leser, posten, summe, mahngebuehrenAktiv } = brief;
  const stufe = massgeblicheStufe(posten);
  const tageMax = Math.max(...posten.map((p) => p.tageUeberfaellig || 0));
  const faelligMin = posten.map((p) => p.faelligAm).sort()[0];
  const werte = {
    Vorname: leser?.Vorname || '', Nachname: leser?.Nachname || '',
    Titel: posten.map((p) => p.Titel).join(', '), Tage: String(tageMax),
    Gebuehr: fmtGeld(summe), Datum: brief.datum, Faellig: fmtDatum(faelligMin), Stufe: stufe.text || 'Mahnung',
  };
  const zeilen = [
    fuellePlatzhalter(stufe.briefText, werte),
    '',
    ...posten.map((p) => `- ${p.Titel} (ausgeliehen am ${fmtDatum(p.AuslDatum)}, ${p.tageUeberfaellig || 0} Tage überfällig${mahngebuehrenAktiv ? `, ${fmtGeld(p.gebuehr)}` : ''})`),
    mahngebuehrenAktiv ? `\nGesamt: ${fmtGeld(summe)}` : '',
    brief.mahnSchluss || '',
  ];
  return {
    to: leser?.emailPriv || leser?.emailGesch || '',
    subject: fuellePlatzhalter(brief.mahnBetreffVorlage, werte) || stufe.text || 'Mahnung',
    body: zeilen.filter((z) => z !== '').join('\n'),
  };
}

/**
 * Reintext-Fassung eines Briefs für Element (Matrix) – dieselbe
 * Platzhalter-Füllung wie brieftextAlsEmail(), aber ohne Betreff (Matrix-
 * Nachrichten haben keinen) und mit Vorname/Nachname statt einer Adresse:
 * die eigentliche Element-Adresse bildet main.js/matrix.js erst aus den
 * beiden plus der eingestellten Domain.
 */
function brieftextAlsElement(brief) {
  const { leser, posten, summe, mahngebuehrenAktiv } = brief;
  const stufe = massgeblicheStufe(posten);
  const tageMax = Math.max(...posten.map((p) => p.tageUeberfaellig || 0));
  const faelligMin = posten.map((p) => p.faelligAm).sort()[0];
  const werte = {
    Vorname: leser?.Vorname || '', Nachname: leser?.Nachname || '',
    Titel: posten.map((p) => p.Titel).join(', '), Tage: String(tageMax),
    Gebuehr: fmtGeld(summe), Datum: brief.datum, Faellig: fmtDatum(faelligMin), Stufe: stufe.text || 'Mahnung',
  };
  const betreff = fuellePlatzhalter(brief.mahnBetreffVorlage, werte) || stufe.text || 'Mahnung';
  const zeilen = [
    betreff,
    '',
    fuellePlatzhalter(stufe.briefText, werte),
    '',
    ...posten.map((p) => `- ${p.Titel} (ausgeliehen am ${fmtDatum(p.AuslDatum)}, ${p.tageUeberfaellig || 0} Tage überfällig${mahngebuehrenAktiv ? `, ${fmtGeld(p.gebuehr)}` : ''})`),
    mahngebuehrenAktiv ? `\nGesamt: ${fmtGeld(summe)}` : '',
    brief.mahnSchluss || '',
  ];
  return {
    vorname: leser?.Vorname || '',
    nachname: leser?.Nachname || '',
    text: zeilen.filter((z) => z !== '').join('\n'),
  };
}

document.getElementById('close').addEventListener('click', () => api.window.close());
document.getElementById('print').addEventListener('click', () => api.print.now().catch((err) => alert(`Drucken fehlgeschlagen: ${err.message || err}`)));
document.getElementById('pdf').addEventListener('click', () => api.print.pdf({ name: 'Mahnungen' }).catch((err) => alert(`PDF-Export fehlgeschlagen: ${err.message || err}`)));
document.getElementById('email').addEventListener('click', async () => {
  const mails = aktuelleBriefe.map(brieftextAlsEmail);
  const ohneAdresse = mails.filter((m) => !m.to).length;
  for (const m of mails.filter((m) => m.to)) {
    try { await api.mail.oeffnen(m); } catch (err) { alert(`E-Mail konnte nicht geöffnet werden: ${err.message || err}`); }
  }
  if (ohneAdresse) alert(`${ohneAdresse} von ${mails.length} Personen haben keine hinterlegte E-Mail-Adresse – für diese wurde nichts geöffnet.`);
});
document.getElementById('element').addEventListener('click', async (e) => {
  e.target.disabled = true;
  try {
    const nachrichten = aktuelleBriefe.map(brieftextAlsElement);
    const ergebnisse = await api.element.senden(nachrichten);
    const erfolgreich = ergebnisse.filter((r) => r.ok);
    const fehlgeschlagen = ergebnisse.filter((r) => !r.ok);
    let meldung = `${erfolgreich.length} von ${ergebnisse.length} Nachrichten über Element gesendet.`;
    if (fehlgeschlagen.length) {
      meldung += `\n\nFehlgeschlagen:\n${fehlgeschlagen.map((r) => `- ${r.name}: ${r.fehler}`).join('\n')}`;
    }
    alert(meldung);
  } catch (err) {
    alert(`Element-Versand fehlgeschlagen: ${err.message || err}`);
  } finally {
    e.target.disabled = false;
  }
});
