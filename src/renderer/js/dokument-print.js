'use strict';

/**
 * Druckfenster für die Dokumente aus INGA 2.0. main.js schickt per 'print:data'
 * { art, titel, daten, settings } – je Art baut eine Funktion unten die Blätter.
 * Feste Bögen (Ausweise, Zettel, Pässe, Urkunden, Aushänge) haben genau A4-Maß;
 * Listen (Klassenlisten, Jahresbericht, Auskunft, Inventur) fließen über Seiten.
 */

const api = window.inga;
let letzteDaten = null;

const DOKUMENTE = {
  ausweise: { titel: 'Leseausweise', baue: ausweise },
  vormerkzettel: { titel: 'Vormerkung abholbereit', baue: vormerkzettel },
  erinnerungen: { titel: 'Erinnerungen', baue: erinnerungen },
  klassenlisten: { titel: 'Rückstand pro Klasse', baue: klassenlisten },
  lesepass: { titel: 'Lesepass', baue: lesepaesse },
  urkunden: { titel: 'Urkunden', baue: urkunden, quer: true },
  aushang: { titel: 'Aushang', baue: aushang },
  jahresbericht: { titel: 'Jahresbericht', baue: jahresbericht },
  auskunft: { titel: 'Auskunft', baue: auskunft },
  inventur: { titel: 'Inventur – nicht gefunden', baue: inventurListe },
};

function schule(s) {
  return s.bibliotheksName || s.absenderName || 'Schulbibliothek';
}

function blatt(klassen, kinder) {
  return el('div', { class: `blatt ${klassen}` }, kinder);
}

function kopf(s, titel, unter, rechts) {
  return el('div', { class: 'dok-kopf' }, [
    s.mahnLogoDataUrl ? el('img', { src: s.mahnLogoDataUrl, alt: '' }) : null,
    el('div', {}, [el('h1', {}, [titel]), unter ? el('div', { class: 'unter' }, [unter]) : null]),
    el('div', { class: 'rechts' }, [schule(s), el('br'), rechts || `Stand: ${new Date().toLocaleDateString('de-DE')}`]),
  ]);
}

function inGruppen(liste, groesse) {
  const ergebnis = [];
  for (let i = 0; i < liste.length; i += groesse) ergebnis.push(liste.slice(i, i + groesse));
  return ergebnis;
}

function wochentagDatum(iso) {
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00`);
  return isNaN(d) ? fmtDatum(iso) : d.toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
}

function tabelle(spalten, zeilen) {
  return el('table', { class: 'dok-tabelle' }, [
    el('thead', {}, [el('tr', {}, spalten.map((sp) => el('th', { class: sp.num ? 'num' : '' }, [sp.titel])))]),
    el('tbody', {}, zeilen.map((z) => el('tr', {}, spalten.map((sp) => el('td', { class: sp.num ? 'num' : '' }, [String(sp.wert(z) ?? '')]))))),
  ]);
}

/* ------------------------------------------------------------- Leseausweise */
function ausweise({ ausweise: liste }, s) {
  return inGruppen(liste, 10).map((gruppe) => blatt('hoch fest', [
    el('div', { class: 'ausweise' }, gruppe.map((a) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      try {
        JsBarcode(svg, a.nummer, { format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.6 });
      } catch { /* ungültige Zeichen – dann nur die Nummer */ }
      return el('div', { class: 'ausweis' }, [
        el('div', { class: 'band' }, [
          s.mahnLogoDataUrl ? el('img', { src: s.mahnLogoDataUrl, alt: '' }) : null,
          el('b', {}, ['LESEAUSWEIS']),
          el('span', {}, [schule(s)]),
        ]),
        el('div', { class: 'name' }, [`${a.vorname} ${a.nachname}`.trim()]),
        el('div', { class: 'klasse' }, [a.klasse ? `Klasse ${a.klasse}` : '']),
        el('div', { class: 'code' }, [svg, el('div', {}, [a.nummer])]),
      ]);
    })),
  ]));
}

/* ------------------------------------------------------------- Zettel */
function vormerkzettel({ zettel }, s) {
  return inGruppen(zettel, 4).map((gruppe) => blatt('hoch fest', [
    el('div', { class: 'zettel-raster vier' }, gruppe.map((z) => el('div', { class: 'zettel' }, [
      el('div', { class: 'label', style: { marginTop: '0' } }, ['Zurücklegen für']),
      el('div', { class: 'gross' }, [`${z.vorname} ${z.nachname}`]),
      z.klasse ? el('div', { class: 'titel' }, [`Klasse ${z.klasse}`]) : null,
      el('div', { class: 'label' }, ['Buch']),
      el('div', { class: 'titel' }, [z.titel]),
      z.autor ? el('div', {}, [z.autor]) : null,
      el('div', { class: 'label' }, ['Exemplar']),
      el('div', {}, [z.etikett || '–']),
      el('div', { class: 'klein' }, [`Vorgemerkt am ${fmtDatum(z.vorgemerktAm)} · zurückgekommen am ${fmtDatum(z.datum)} · ${schule(s)}`]),
    ]))),
  ]));
}

function erinnerungen({ zeilen }, s) {
  return inGruppen(zeilen, 8).map((gruppe) => blatt('hoch fest', [
    el('div', { class: 'zettel-raster acht' }, gruppe.map((z) => el('div', { class: 'zettel erinnerung' }, [
      el('div', { class: 'hallo' }, [`Hallo ${z.Vorname}!`]),
      el('p', {}, ['Dein Buch ', el('b', {}, [`„${z.Titel}“`]), ' muss bald zurück in die Bücherei:']),
      el('p', { class: 'datum' }, [wochentagDatum(z.faelligAm)]),
      el('p', {}, ['Danke, dass du daran denkst! 📚']),
      el('div', { class: 'klein' }, [[z.klasse ? `Klasse ${z.klasse}` : '', schule(s)].filter(Boolean).join(' · ')]),
    ]))),
  ]));
}

/* ------------------------------------------------------------- Klassenlisten */
function klassenlisten({ klassen, schwelle }, s) {
  return klassen.map((k) => blatt('hoch fluss', [
    kopf(s, `Klasse ${k.klasse}`, k.lehrkraft ? `Für ${k.lehrkraft}: Bücher, die noch zurück in die Bücherei müssen` : 'Bücher, die noch zurück in die Bücherei müssen'),
    tabelle([
      { titel: 'Kind', wert: (z) => `${z.Vorname} ${z.Nachname}` },
      { titel: 'Buch', wert: (z) => z.Titel },
      { titel: 'Nummer', wert: (z) => z.MedienEtik || '' },
      { titel: 'Fällig seit', wert: (z) => fmtDatum(z.faelligAm) },
      { titel: 'Tage', num: true, wert: (z) => z.tageUeberfaellig },
      { titel: 'Zuletzt erinnert', wert: (z) => (z.letzteMahnung ? fmtDatum(z.letzteMahnung) : '–') },
    ], k.zeilen),
    el('p', { class: 'dok-hinweis' }, [`${k.zeilen.length} Buch/Bücher, überfällig seit mindestens ${schwelle} Tag(en). Vielen Dank fürs Erinnern in der Klasse!`]),
  ]));
}

/* ------------------------------------------------------------- Lesepass & Urkunden */
function lesepaesse({ paesse, schuljahr, stufen }, s) {
  const felder = Math.max(10, Math.ceil(Math.max(...stufen, ...paesse.map((p) => p.anzahl)) / 5) * 5);
  const namen = ['Bronze', 'Silber', 'Gold'];
  return inGruppen(paesse, 2).map((paar) => blatt('hoch fest', [
    el('div', { class: 'paesse' }, paar.map((p) => el('div', { class: 'pass' }, [
      el('div', { class: 'kopf' }, [
        el('h2', {}, ['Lesepass']),
        el('div', { class: 'wer' }, [`${p.Vorname} ${p.Nachname}${p.klasse ? ` · ${p.klasse}` : ''}`]),
        el('div', { class: 'sj' }, [`Schuljahr ${schuljahr} · ${schule(s)}`]),
      ]),
      el('div', { class: 'stempel' }, Array.from({ length: felder }, (_, i) => {
        const buch = p.buecher[i];
        const istStufe = stufen.includes(i + 1);
        return el('div', { class: `${buch ? 'voll' : ''} ${istStufe ? 'stufe' : ''}` }, [
          buch ? buch.titel.slice(0, 40) : '',
          el('span', { class: 'nr' }, [istStufe ? namen[stufen.indexOf(i + 1)] || String(i + 1) : String(i + 1)]),
        ]);
      })),
      el('div', { class: 'stufen' }, stufen.map((st, i) => el('span', {}, [`${p.anzahl >= st ? '✔' : '○'} ${namen[i] || 'Stufe ' + (i + 1)}: ${st} Bücher`]))),
    ]))),
  ]));
}

const MEDAILLE = { Bronze: '#a0643c', Silber: '#8c96a0', Gold: '#c8961e' };

function urkunden({ urkunden: liste, schuljahr }, s) {
  return liste.map((u) => blatt('quer fest', [
    el('div', { class: 'urkunde' }, [el('div', { class: 'rahmen' }, [
      s.mahnLogoDataUrl ? el('img', { src: s.mahnLogoDataUrl, alt: '', style: { height: '18mm', marginBottom: '4mm' } }) : null,
      el('h1', {}, ['URKUNDE']),
      el('div', { class: 'fuer' }, ['für']),
      el('div', { class: 'name' }, [`${u.Vorname} ${u.Nachname}`]),
      el('div', { class: 'text' }, [`hat im Schuljahr ${schuljahr} ${u.anzahl} Bücher aus der Schulbücherei gelesen und damit den`]),
      el('div', { class: 'medaille', style: { background: MEDAILLE[u.stufe] || '#2a78d6' } }, [u.stufe]),
      el('div', { class: 'text' }, ['Lesepass erreicht. Herzlichen Glückwunsch!']),
      el('div', { class: 'unterschrift' }, [
        el('div', {}, [`${new Date().toLocaleDateString('de-DE')}, ${schule(s)}`]),
        el('div', {}, ['Unterschrift']),
      ]),
    ])]),
  ]));
}

/* ------------------------------------------------------------- Aushang */
function aushang({ ueberschrift, unterzeile, buecher }, s) {
  return inGruppen(buecher, 12).map((gruppe, i) => blatt('hoch fest', [
    el('div', { class: 'aushang' }, [
      el('h1', {}, [ueberschrift]),
      el('div', { class: 'unter' }, [i ? `${unterzeile} (Fortsetzung)` : unterzeile]),
      el('div', { class: 'cover-raster' }, gruppe.map((b) => el('div', { class: 'cover-karte' }, [
        el('div', { class: 'bild' }, [b.cover ? el('img', { src: b.cover, alt: '' }) : el('div', { class: 'platzhalter' }, [b.Titel])]),
        el('div', { class: 't' }, [b.Titel]),
        b.Autor ? el('div', { class: 'a' }, [b.Autor]) : null,
        b.KlasseAnto ? el('div', { class: 'anto' }, [`Antolin ${b.KlasseAnto}`]) : null,
      ]))),
      el('div', { class: 'dok-hinweis', style: { marginTop: 'auto', textAlign: 'center' } }, [`${schule(s)} – frag in der Bücherei nach!`]),
    ]),
  ]));
}

/* ------------------------------------------------------------- Jahresbericht */
function jahresbericht({ bericht: b }, s) {
  const k = b.kennzahlen;
  const kpi = (l, w) => el('div', { class: 'kpi' }, [el('div', { class: 'l' }, [l]), el('div', { class: 'w' }, [w])]);
  const euro = (x) => (x === null || x === undefined ? '–' : Number(x).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }));
  const max = Math.max(1, ...b.monate.map((m) => m.anzahl));
  const monatsNamen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  const maxKlasse = Math.max(1, ...b.proKlasse.map((x) => x.anzahl));
  return [blatt('hoch fluss', [
    kopf(s, `Jahresbericht ${b.schuljahr}`, `Schulbücherei · ${fmtDatum(b.von)} bis ${fmtDatum(b.bis)}`),
    el('div', { class: 'kpis' }, [
      kpi('Ausleihen', k.ausleihen.toLocaleString('de-DE')),
      kpi('Aktive Leserinnen und Leser', k.aktiveLeser.toLocaleString('de-DE')),
      kpi('Titel im Bestand', k.titel.toLocaleString('de-DE')),
      kpi('Exemplare', k.exemplare.toLocaleString('de-DE')),
      kpi('Neue Exemplare', k.zugaenge.toLocaleString('de-DE')),
      kpi('Nutzer gesamt', k.leser.toLocaleString('de-DE')),
      kpi('Erinnerungen/Mahnungen', k.mahnungen.toLocaleString('de-DE')),
      kpi('Erfasste Schäden', k.schaeden.toLocaleString('de-DE')),
    ]),
    el('div', { class: 'dok-abschnitt' }, ['Ausleihen pro Monat']),
    el('div', { class: 'saeulen' }, b.monate.map((m) => el('div', { style: { height: `${(m.anzahl / max) * 100}%` } }))),
    el('div', { class: 'saeulen-achse' }, b.monate.map((m) => el('div', {}, [monatsNamen[Number(m.monat.slice(5)) - 1], el('b', {}, [String(m.anzahl)])]))),
    el('div', { class: 'zwei-spalten' }, [
      el('div', {}, [
        el('div', { class: 'dok-abschnitt' }, ['Die beliebtesten Bücher']),
        b.top.length
          ? tabelle([{ titel: '#', wert: (z) => b.top.indexOf(z) + 1 }, { titel: 'Titel', wert: (z) => z.Titel }, { titel: 'Ausleihen', num: true, wert: (z) => z.n }], b.top)
          : el('p', { class: 'dok-hinweis' }, ['Keine Ausleihen in diesem Schuljahr.']),
      ]),
      el('div', {}, [
        el('div', { class: 'dok-abschnitt' }, ['Ausleihen pro Klasse']),
        ...b.proKlasse.map((x) => el('div', { class: 'balken-zeile' }, [
          el('div', {}, [x.klasse]),
          el('div', { class: 'spur' }, [el('div', { style: { width: `${(x.anzahl / maxKlasse) * 100}%` } })]),
          el('div', { class: 'wert' }, [String(x.anzahl)]),
        ])),
      ]),
    ]),
    el('div', { class: 'zwei-spalten' }, [
      el('div', {}, [
        el('div', { class: 'dok-abschnitt' }, ['Lesepass']),
        el('p', {}, [`${b.lesepass.kinderMitBuechern} Kinder haben Bücher gelesen. Erreicht: ${b.lesepass.gold}× Gold, ${b.lesepass.silber}× Silber, ${b.lesepass.bronze}× Bronze.`]),
        b.lesepass.spitze.length ? el('p', { class: 'dok-hinweis' }, ['Fleißigste Leser: ' + b.lesepass.spitze.map((x) => `${x.name} (${x.klasse || '–'}, ${x.anzahl})`).join(', ')]) : null,
      ]),
      el('div', {}, [
        el('div', { class: 'dok-abschnitt' }, ['Budget']),
        el('p', {}, [`Budget: ${euro(b.budget.betrag)} · ausgegeben: ${euro(b.budget.ausgegeben)} · frei: ${euro(b.budget.frei)}`]),
        el('p', { class: 'dok-hinweis' }, [`Noch offene Wünsche: ${euro(b.budget.geplant)}`]),
      ]),
    ]),
    el('p', { class: 'dok-hinweis' }, [`Erstellt mit INGA am ${fmtDatum(b.erstellt)}.`]),
  ])];
}

/* ------------------------------------------------------------- Auskunft */
function auskunft({ auskunft: a }, s) {
  return [blatt('hoch fluss', [
    kopf(s, 'Auskunft über gespeicherte Daten', `${a.name}${a.klasse ? `, Klasse ${a.klasse}` : ''} · nach Art. 15 DSGVO`),
    el('div', { class: 'dok-abschnitt' }, ['Stammdaten']),
    tabelle([{ titel: 'Feld', wert: (z) => z.feld }, { titel: 'Inhalt', wert: (z) => z.wert }], a.felder),
    el('p', {}, [`Ausleihsperre: ${a.sperre.gesperrt ? `ja (${a.sperre.grund})` : 'nein'}`]),
    el('div', { class: 'dok-abschnitt' }, [`Ausleihen (${a.ausleihen.length})`]),
    a.ausleihen.length
      ? tabelle([
          { titel: 'Buch', wert: (z) => z.Titel }, { titel: 'Nummer', wert: (z) => z.MedienEtik || '' },
          { titel: 'Ausgeliehen', wert: (z) => fmtDatum(z.AuslDatum) }, { titel: 'Zurück', wert: (z) => (z.Rueckgabe ? fmtDatum(z.Rueckgabe) : 'noch ausgeliehen') },
        ], a.ausleihen)
      : el('p', {}, ['Keine.']),
    el('div', { class: 'dok-abschnitt' }, [`Erinnerungen/Mahnungen (${a.mahnungen.length})`]),
    a.mahnungen.length ? tabelle([{ titel: 'Datum', wert: (z) => fmtDatum(z.Mahndatum) }, { titel: 'Buch', wert: (z) => z.Titel }], a.mahnungen) : el('p', {}, ['Keine.']),
    el('div', { class: 'dok-abschnitt' }, [`Vormerkungen (${a.vormerkungen.length})`]),
    a.vormerkungen.length ? tabelle([{ titel: 'Seit', wert: (z) => fmtDatum(z.VormerkDat) }, { titel: 'Buch', wert: (z) => z.Titel }], a.vormerkungen) : el('p', {}, ['Keine.']),
    el('div', { class: 'dok-abschnitt' }, [`Erfasste Schäden (${a.schaeden.length})`]),
    a.schaeden.length ? tabelle([{ titel: 'Datum', wert: (z) => fmtDatum(z.datum) }, { titel: 'Buch', wert: (z) => z.Titel }, { titel: 'Beschreibung', wert: (z) => z.beschreibung }], a.schaeden) : el('p', {}, ['Keine.']),
    el('p', { class: 'dok-hinweis' }, [`Stand ${fmtDatum(a.erstellt)}. Die Daten werden nur für die Ausleihe in der Schulbücherei verwendet.`]),
  ])];
}

/* ------------------------------------------------------------- Inventur */
function inventurListe({ fehlend, erwartet, gescannt }, s) {
  return [blatt('hoch fluss', [
    kopf(s, 'Inventur: nicht gefunden', `${gescannt} von ${erwartet} erwarteten Exemplaren gescannt · ${fehlend.length} fehlen`),
    tabelle([
      { titel: 'Nummer', wert: (z) => z.MedienEtik || '' },
      { titel: 'Titel', wert: (z) => z.Titel },
      { titel: 'Autor', wert: (z) => z.Autor || '' },
    ], fehlend),
  ])];
}

/* ------------------------------------------------------------- Rahmen */
function render(daten) {
  const s = daten.settings || {};
  const root = document.documentElement;
  if (s.os) { root.dataset.os = s.os; root.dataset.chrome = s.os === 'mac' ? 'mac' : s.os === 'win' ? 'overlay' : 'native'; }
  if (s.ui) root.dataset.ui = s.ui;
  const dok = DOKUMENTE[daten.art];
  if (!dok) return;
  const quer = Boolean(dok.quer);
  document.getElementById('page-style').textContent = `@page { size: A4 ${quer ? 'landscape' : 'portrait'}; margin: 0; }`;
  const titel = daten.titel || dok.titel;
  document.title = titel;
  document.getElementById('titel').textContent = titel;
  const blaetter = dok.baue(daten.daten || {}, s);
  document.getElementById('anzahl').textContent = `${blaetter.length} Seite${blaetter.length === 1 ? '' : 'n'}`;
  document.getElementById('paper').replaceChildren(...blaetter);
}

api.on('print:data', (daten) => {
  letzteDaten = daten;
  render(daten);
});

document.getElementById('close').addEventListener('click', () => api.window.close());
document.getElementById('print').addEventListener('click', () =>
  api.print.now({ landscape: Boolean(DOKUMENTE[letzteDaten?.art]?.quer) }).catch((err) => alert(`Drucken fehlgeschlagen: ${err.message || err}`))
);
document.getElementById('pdf').addEventListener('click', () =>
  api.print.pdf({ name: letzteDaten?.titel || DOKUMENTE[letzteDaten?.art]?.titel || 'Dokument', landscape: Boolean(DOKUMENTE[letzteDaten?.art]?.quer) })
    .catch((err) => alert(`PDF-Export fehlgeschlagen: ${err.message || err}`))
);
