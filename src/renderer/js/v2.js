'use strict';

/**
 * INGA 2.0 – Oberfläche der neuen Funktionen. Wird nach app.js geladen und nutzt
 * dessen Hilfsfunktionen (el, toast, openSheet, showView, …). Neue Ansichten und
 * Knöpfe werden hier beim Laden ins Fenster eingesetzt – app.js verdrahtet danach
 * wie gewohnt (boot() wartet zuerst auf die Bootstrap-Daten, dieses Skript läuft
 * davor).
 *
 * Neu in der Seitenleiste: Leseförderung (Lesepass, Antolin, Neu in der Bücherei),
 * Anschaffungen & Budget, Inventur, Schuljahreswechsel, Berichte & Datenschutz.
 * Eingebaut in bestehende Ansichten: Vormerkzettel bei der Rückgabe, Schäden,
 * Empfehlungen im Buchdetail, Auskunft/Ausweis/Lesetipps in der Nutzerakte,
 * Leseausweise in der Nutzerliste, Erinnerungen & Klassenlisten bei den Mahnungen,
 * Grenzen je Klassenstufe und Datenschutz in den Einstellungen.
 */

/* ============================================================ Hilfen */

function schuljahrJetzt() {
  const d = new Date();
  const start = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  return `${start}/${String((start + 1) % 100).padStart(2, '0')}`;
}

function schuljahrListe(anzahl = 4) {
  const start = Number(schuljahrJetzt().slice(0, 4));
  return Array.from({ length: anzahl }, (_, i) => `${start - i}/${String((start - i + 1) % 100).padStart(2, '0')}`);
}

function euro(x) {
  if (x === null || x === undefined || x === '' || isNaN(x)) return '–';
  return Number(x).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function druckeDokument(art, daten, titel) {
  return api.dokument.drucken({ art, daten, titel });
}

async function fuelleKlassen(select, ersteOption = 'Alle Klassen') {
  const wert = select.value;
  const klassen = await api.v2.klassen();
  select.replaceChildren(
    el('option', { value: '' }, [ersteOption]),
    ...klassen.map((k) => el('option', { value: k.klasse }, [`${k.klasse} (${k.anzahl})`]))
  );
  if ([...select.options].some((o) => o.value === wert)) select.value = wert;
}

function v2Karte(titel, kinder, hinweis) {
  return el('div', { class: 'card', style: { padding: '18px', marginBottom: '16px' } }, [
    titel ? el('div', { class: 'v2-kartentitel' }, [titel]) : null,
    hinweis ? el('p', { class: 'hint', style: { marginTop: '0' } }, [hinweis]) : null,
    ...kinder,
  ]);
}

function v2Tabelle(spalten, zeilen, leer = 'Keine Einträge.') {
  if (!zeilen.length) return el('div', { class: 'empty' }, [leer]);
  return el('table', {}, [
    el('thead', {}, [el('tr', {}, spalten.map((s) => el('th', { class: s.num ? 'num' : '' }, [s.titel])))]),
    el('tbody', {}, zeilen.map((z) => el('tr', {}, spalten.map((s) => el('td', { class: s.num ? 'num' : '' }, [s.wert(z)]))))),
  ]);
}

/** Segmentierte Reiter innerhalb einer Ansicht. */
function v2Reiter(container, reiter, onWechsel) {
  const leiste = el('div', { class: 'v2-reiter' });
  for (const [schluessel, name] of reiter) {
    leiste.appendChild(el('button', {
      class: 'v2-reiter-knopf', 'data-reiter': schluessel,
      onclick: () => {
        for (const b of leiste.children) b.classList.toggle('aktiv', b.dataset.reiter === schluessel);
        onWechsel(schluessel);
      },
    }, [name]));
  }
  container.appendChild(leiste);
  return (schluessel) => leiste.querySelector(`[data-reiter="${schluessel}"]`)?.click();
}

/** Cover als data:-URL für Aushänge (fehlende Cover → Platzhalter mit Titel). */
async function mitCovern(buecher) {
  return Promise.all(buecher.map(async (b) => ({ ...b, cover: await api.cover.get(b.KatalogNi).catch(() => null) })));
}

/* ============================================================ Neue Ansichten einsetzen */

const V2_ANSICHTEN = [
  ['lesefoerderung', '⭐', 'Leseförderung'],
  ['anschaffungen', '🛒', 'Anschaffungen'],
  ['inventur', '📋', 'Inventur'],
  ['schuljahr', '🎓', 'Schuljahreswechsel'],
  ['berichte', '📄', 'Berichte & Datenschutz'],
];

(function ansichtenEinsetzen() {
  const sidebar = document.getElementById('sidebar');
  const abschnitt = el('div', { class: 'nav-section' }, [el('h4', {}, ['Mehr'])]);
  for (const [id, symbol, name] of V2_ANSICHTEN) {
    abschnitt.appendChild(el('div', { class: 'nav-item', 'data-view': id }, [el('span', { class: 'icon' }, [symbol]), el('span', { class: 'label' }, [name])]));
    document.getElementById('content').appendChild(el('section', { class: 'view', id: `view-${id}`, hidden: true }, [
      el('div', { class: 'toolbar' }, [el('h1', {}, [name]), el('div', { class: 'spacer' }), el('div', { id: `v2-${id}-werkzeuge`, class: 'row-inline' })]),
      el('div', { class: 'view', id: `v2-${id}` }),
    ]));
  }
  // Vor "System" einhängen, damit Einstellungen unten bleiben.
  const sektionen = sidebar.querySelectorAll('.nav-section');
  sidebar.insertBefore(abschnitt, sektionen[sektionen.length - 1]);

  // Nutzerliste: Leseausweise
  document.getElementById('leser-neu').before(el('button', { class: 'button', id: 'v2-ausweise', onclick: () => ausweiseDialog() }, ['🪪 Ausweise']));
  // Mahnungen: Erinnerungen vor Fälligkeit und Klassenlisten
  document.getElementById('mahnungen-im-umlauf').before(
    el('button', { class: 'button', onclick: () => { showView('berichte'); v2ZeigeBericht('erinnerungen'); } }, ['🔔 Bald fällig …']),
    el('button', { class: 'button', onclick: () => druckeRueckstandProKlasse(Number(document.getElementById('mahn-schwelle').value) || 1) }, ['🏫 Pro Klasse drucken'])
  );
  // Einstellungen: eigener Bereich
  const nav = document.querySelector('.settings-nav');
  nav.appendChild(el('div', { class: 'settings-nav-item', 'data-einst-pane': 'zwei' }, ['Klassen, Leseförderung & Datenschutz']));
  document.querySelector('.settings-content').appendChild(einstellungenBereich());
})();

/** Wird von showView() (app.js) für jede Ansicht aufgerufen. */
window.v2Ansicht = function v2Ansicht(name) {
  const laden = {
    lesefoerderung: ladeLesefoerderung,
    anschaffungen: ladeAnschaffungen,
    inventur: ladeInventur,
    schuljahr: ladeSchuljahr,
    berichte: ladeBerichte,
    einstellungen: ladeV2Einstellungen,
  }[name];
  if (laden) laden().catch((err) => toast(err.message || String(err), 'error'));
};

/* ============================================================ Rückgabe: Vormerkzettel & Schäden */

/** Zurückgeben – und wenn jemand auf das Buch wartet, Bescheid geben und den Zettel anbieten. */
async function zurueckgebenMitHinweis(id, { sammeln } = {}) {
  const r = await api.ausleihe.zurueckgeben(id);
  const v = r?.vormerkung;
  if (v) {
    if (sammeln) sammeln.push(v);
    else vormerkungMelden([v]);
  }
  return r;
}

function vormerkungMelden(liste) {
  if (!liste.length) return;
  const text = liste.map((v) => `• „${v.titel}“ für ${v.vorname} ${v.nachname}${v.klasse ? ` (${v.klasse})` : ''}`).join('\n');
  if (confirm(`Vorgemerkt – bitte zurücklegen:\n\n${text}\n\nZettel zum Einlegen drucken?`)) druckeDokument('vormerkzettel', { zettel: liste });
}

function schadenDialog({ medienNi, leserNi, titel, etikett, ausleiheId }) {
  const felder = [
    { name: 'beschreibung', label: 'Was ist beschädigt?', type: 'textarea' },
    { name: 'schwere', label: 'Wie schlimm?', type: 'select', options: [
      { value: 'leicht', label: 'Leicht (z. B. Knick, kleiner Fleck)' },
      { value: 'mittel', label: 'Mittel (z. B. Seite eingerissen)' },
      { value: 'schwer', label: 'Schwer (nicht mehr ausleihbar)' },
    ] },
    { name: 'sperren', label: 'Exemplar sperren?', type: 'select', options: [
      { value: 'nein', label: 'Nein, kann weiter ausgeliehen werden' },
      { value: 'ja', label: 'Ja, als „Beschädigt“ sperren' },
    ] },
  ];
  if (ausleiheId) felder.push({ name: 'zurueck', label: 'Gleich zurückgeben?', type: 'select', options: [{ value: 'ja', label: 'Ja' }, { value: 'nein', label: 'Nein' }] });
  openSheet({
    title: `Schaden: ${titel}${etikett ? ` (${etikett})` : ''}`,
    fields: felder,
    values: { schwere: 'leicht', sperren: 'nein', zurueck: 'ja' },
    onSave: async (w) => {
      await api.v2.schadenErfassen({ medienNi, leserNi, beschreibung: w.beschreibung, schwere: w.schwere, nichtVerfuegbar: w.sperren === 'ja' || w.schwere === 'schwer' });
      if (ausleiheId && w.zurueck !== 'nein') await zurueckgebenMitHinweis(ausleiheId);
      toast('Schaden erfasst.');
      if (state.view === 'rueckgabe') { await loadRueckgabe(); await refreshKennzahlen(); }
    },
  });
}

/* ============================================================ Buchdetail & Nutzerakte */

async function v2BuchDetailExtras(row) {
  const [schaeden, tipps] = await Promise.all([api.v2.schaedenKatalog(row.KatalogNi), api.v2.empfehlungen(row.KatalogNi)]);
  return el('div', {}, [
    schaeden.length ? el('div', { class: 'section-title' }, ['Schäden']) : null,
    ...schaeden.map((s) => el('div', { class: 'row-inline', style: { marginBottom: '4px' } }, [
      el('span', { class: `badge ${s.erledigt ? 'ok' : 'danger'}` }, [s.erledigt ? 'erledigt' : s.schwere || 'Schaden']),
      el('span', { class: 'hint' }, [`${fmtDatum(s.datum)} · ${s.MedienEtik || ''} · ${s.beschreibung}${s.Nachname ? ` (${s.Nachname}, ${s.Vorname})` : ''}`]),
      el('button', {
        class: 'icon-button', title: s.erledigt ? 'Wieder als offen markieren' : 'Als erledigt markieren (z. B. repariert)',
        onclick: async (e) => { await api.v2.schadenErledigt(s.id, !s.erledigt); e.target.closest('.row-inline').querySelector('.badge').textContent = s.erledigt ? s.schwere : 'erledigt'; s.erledigt = !s.erledigt; },
      }, [s.erledigt ? '↺' : '✓']),
    ])),
    tipps.length ? el('div', { class: 'section-title' }, ['Wer das las, las auch …']) : null,
    tipps.length ? el('div', { class: 'v2-tipps' }, tipps.map((t) => el('div', { class: 'v2-tipp' }, [
      el('div', { class: 'v2-tipp-titel' }, [t.Titel]),
      el('div', { class: 'hint' }, [[t.Autor, t.grund].filter(Boolean).join(' · ')]),
      el('span', { class: `badge ${t.verfuegbar ? 'ok' : ''}` }, [t.verfuegbar ? 'verfügbar' : 'ausgeliehen']),
    ]))) : null,
  ]);
}

async function v2LeserExtras(row) {
  const tipps = await api.v2.lesetipps(row.LeserNi);
  return el('div', {}, [
    el('div', { class: 'section-title', style: { marginTop: '18px' } }, ['Mehr']),
    el('div', { class: 'row-inline', style: { flexWrap: 'wrap' } }, [
      el('button', { class: 'button small', onclick: async () => druckeDokument('ausweise', { ausweise: await api.v2.ausweise({ leserNis: [row.LeserNi] }) }, 'Leseausweis') }, ['🪪 Ausweis drucken']),
      el('button', { class: 'button small', title: 'Alles, was INGA über dieses Kind gespeichert hat (DSGVO Art. 15)', onclick: async () => druckeDokument('auskunft', { auskunft: await api.v2.auskunft(row.LeserNi) }, 'Auskunft') }, ['🔒 Datenauskunft drucken']),
    ]),
    tipps.length ? el('div', { class: 'section-title', style: { marginTop: '18px' } }, ['Lesetipps']) : null,
    ...tipps.map((t) => el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${t.Titel}${t.Autor ? ` – ${t.Autor}` : ''}${t.verfuegbar ? ' ✓ verfügbar' : ''}`])),
  ]);
}

async function ausweiseDialog() {
  const klassen = await api.v2.klassen();
  openSheet({
    title: 'Leseausweise drucken',
    fields: [{ name: 'klasse', label: 'Für welche Klasse? (leer = alle Nutzer)', type: 'select', options: klassen.map((k) => ({ value: k.klasse, label: `${k.klasse} (${k.anzahl} Kinder)` })) }],
    values: {},
    extra: el('p', { class: 'hint' }, ['10 Ausweise pro A4-Bogen im Scheckkartenformat mit Barcode der Ausweisnummer (oder der Nutzernummer, wenn keine Ausweisnummer eingetragen ist) – passt zum Scannen bei der Ausleihe. Für einzelne Kinder: in der Nutzerakte „Ausweis drucken“.']),
    onSave: async (w) => {
      const ausweise = await api.v2.ausweise(w.klasse ? { klasse: w.klasse } : {});
      if (!ausweise.length) { toast('Keine Nutzer gefunden.', 'error'); return; }
      druckeDokument('ausweise', { ausweise }, w.klasse ? `Leseausweise ${w.klasse}` : 'Leseausweise');
    },
  });
}

/* ============================================================ Leseförderung */

let lfReiter = null;

async function ladeLesefoerderung() {
  const box = document.getElementById('v2-lesefoerderung');
  if (box.dataset.aufgebaut) return;
  box.dataset.aufgebaut = '1';
  const inhalt = el('div');
  lfReiter = v2Reiter(box, [['lesepass', '⭐ Lesepass'], ['antolin', '🦉 Antolin'], ['neu', '🆕 Neu in der Bücherei']], (r) => {
    ({ lesepass: zeigeLesepass, antolin: zeigeAntolin, neu: zeigeNeu })[r](inhalt).catch((err) => toast(err.message, 'error'));
  });
  box.appendChild(inhalt);
  lfReiter('lesepass');
}

async function zeigeLesepass(inhalt) {
  const sjWahl = el('select', { class: 'filter-select' }, schuljahrListe().map((s) => el('option', { value: s }, [`Schuljahr ${s}`])));
  const klasseWahl = el('select', { class: 'filter-select' });
  await fuelleKlassen(klasseWahl, 'Alle Kinder mit Büchern');
  const liste = el('div');
  const stufen = state.settings.lesepassStufen || [5, 10, 20];
  const laden = async () => {
    const pass = await api.v2.lesepass({ schuljahr: sjWahl.value, klasse: klasseWahl.value || null });
    const mitStufe = pass.filter((p) => p.stufe);
    liste.replaceChildren(
      el('div', { class: 'row-inline', style: { margin: '10px 0', flexWrap: 'wrap' } }, [
        el('span', { class: 'hint' }, [`${pass.length} Kinder · Stufen: Bronze ab ${stufen[0]}, Silber ab ${stufen[1] ?? '–'}, Gold ab ${stufen[2] ?? '–'} gelesenen Büchern`]),
        el('div', { class: 'spacer' }),
        el('button', { class: 'button', disabled: !pass.length, onclick: () => druckeDokument('lesepass', { paesse: pass, schuljahr: sjWahl.value, stufen }, 'Lesepässe') }, ['🖨 Lesepässe drucken']),
        el('button', { class: 'button primary', disabled: !mitStufe.length, onclick: () => druckeDokument('urkunden', { urkunden: mitStufe, schuljahr: sjWahl.value }, 'Urkunden') }, [`🏅 Urkunden drucken (${mitStufe.length})`]),
      ]),
      v2Tabelle([
        { titel: 'Kind', wert: (p) => `${p.Nachname}, ${p.Vorname}` },
        { titel: 'Klasse', wert: (p) => p.klasse || '–' },
        { titel: 'Gelesen', num: true, wert: (p) => el('span', { title: p.buecher.map((b) => b.titel).join('\n') }, [String(p.anzahl)]) },
        { titel: 'Sterne', wert: (p) => el('span', { class: 'v2-sterne', 'aria-label': `${p.anzahl} Bücher` }, ['★'.repeat(Math.min(p.anzahl, 20)) + (p.anzahl > 20 ? '+' : '')]) },
        { titel: 'Stufe', wert: (p) => (p.stufe ? el('span', { class: `badge v2-stufe-${p.stufe.toLowerCase()}` }, [`🏅 ${p.stufe}`]) : el('span', { class: 'hint' }, [p.naechsteStufe ? `noch ${p.naechsteStufe - p.anzahl} bis zur nächsten Stufe` : ''])) },
        { titel: '', wert: (p) => el('div', { class: 'row-inline' }, [
          el('button', { class: 'button small', onclick: () => druckeDokument('lesepass', { paesse: [p], schuljahr: sjWahl.value, stufen }, `Lesepass ${p.Vorname}`) }, ['Pass']),
          p.stufe ? el('button', { class: 'button small', onclick: () => druckeDokument('urkunden', { urkunden: [p], schuljahr: sjWahl.value }, `Urkunde ${p.Vorname}`) }, ['Urkunde']) : null,
        ]) },
      ], pass, 'In diesem Schuljahr wurden noch keine Bücher zurückgegeben.'),
    );
  };
  sjWahl.addEventListener('change', laden);
  klasseWahl.addEventListener('change', laden);
  inhalt.replaceChildren(
    el('p', { class: 'hint' }, ['Jedes zurückgegebene Buch zählt als gelesen (ein Titel nur einmal pro Schuljahr). Die Stufen lassen sich unter Einstellungen → „Klassen, Leseförderung & Datenschutz“ ändern.']),
    el('div', { class: 'row-inline' }, [sjWahl, klasseWahl]),
    liste,
  );
  await laden();
}

async function zeigeAntolin(inhalt) {
  const stufeWahl = el('select', { class: 'filter-select' }, [
    el('option', { value: '' }, ['Alle Klassenstufen']),
    ...[1, 2, 3, 4].map((s) => el('option', { value: String(s) }, [`Klasse ${s}`])),
  ]);
  const nurFrei = el('input', { type: 'checkbox' });
  const liste = el('div');
  let buecher = [];
  const zeichne = () => {
    const sichtbar = nurFrei.checked ? buecher.filter((b) => b.verfuegbar > 0) : buecher;
    liste.replaceChildren(
      el('div', { class: 'row-inline', style: { margin: '10px 0' } }, [
        el('span', { class: 'hint' }, [`${sichtbar.length} Antolin-Bücher`]),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'button primary', disabled: !sichtbar.length,
          onclick: async () => druckeDokument('aushang', {
            ueberschrift: 'Antolin-Bücher', unterzeile: stufeWahl.value ? `für Klasse ${stufeWahl.value}` : 'in unserer Schulbücherei',
            buecher: await mitCovern(sichtbar.slice(0, 48)),
          }, 'Aushang Antolin'),
        }, ['🖼 Aushang drucken']),
      ]),
      v2Tabelle([
        { titel: 'Titel', wert: (b) => b.Titel },
        { titel: 'Autor', wert: (b) => b.Autor || '' },
        { titel: 'Antolin', wert: (b) => b.KlasseAnto },
        { titel: 'Verfügbar', num: true, wert: (b) => `${b.verfuegbar} von ${b.exemplare}` },
      ], sichtbar, 'Keine Bücher mit Antolin-Klassenstufe. Eintragen lässt sie sich beim Bearbeiten eines Titels im Katalog.'),
    );
  };
  const laden = async () => { buecher = await api.v2.antolin(stufeWahl.value || null); zeichne(); };
  stufeWahl.addEventListener('change', laden);
  nurFrei.addEventListener('change', zeichne);
  inhalt.replaceChildren(
    el('div', { class: 'row-inline' }, [stufeWahl, el('label', { class: 'checkbox-label' }, [nurFrei, ' Nur gerade verfügbare'])]),
    liste,
  );
  await laden();
}

async function zeigeNeu(inhalt) {
  const tage = el('input', { type: 'number', min: 1, max: 730, value: state.settings.neuerwerbungenTage || 60, style: { maxWidth: '80px' } });
  const liste = el('div');
  const laden = async () => {
    const buecher = await api.v2.neuerwerbungen(Number(tage.value) || 60);
    liste.replaceChildren(
      el('div', { class: 'row-inline', style: { margin: '10px 0' } }, [
        el('span', { class: 'hint' }, [`${buecher.length} neue Titel`]),
        el('div', { class: 'spacer' }),
        el('button', {
          class: 'button primary', disabled: !buecher.length,
          onclick: async () => druckeDokument('aushang', { ueberschrift: 'Neu in der Bücherei!', unterzeile: 'Diese Bücher warten auf dich', buecher: await mitCovern(buecher) }, 'Aushang Neu in der Bücherei'),
        }, ['🖼 Aushang drucken']),
      ]),
      v2Tabelle([
        { titel: 'Titel', wert: (b) => b.Titel },
        { titel: 'Autor', wert: (b) => b.Autor || '' },
        { titel: 'Erfasst', wert: (b) => fmtDatum(b.ErfassDat) },
        { titel: 'Verfügbar', num: true, wert: (b) => `${b.verfuegbar} von ${b.exemplare}` },
      ], buecher, 'In diesem Zeitraum wurden keine Titel neu erfasst.'),
    );
  };
  tage.addEventListener('input', debounce(laden, 300));
  inhalt.replaceChildren(el('label', { class: 'hint' }, ['Neu erfasst in den letzten ', tage, ' Tagen']), liste);
  await laden();
}

/* ============================================================ Anschaffungen & Budget */

const ANSCHAFFUNG_STATUS = { wunsch: 'Wunsch', bestellt: 'Bestellt', geliefert: 'Geliefert', abgelehnt: 'Abgelehnt' };
let anschaffungFilter = '';

async function ladeAnschaffungen() {
  const box = document.getElementById('v2-anschaffungen');
  const werkzeuge = document.getElementById('v2-anschaffungen-werkzeuge');
  werkzeuge.replaceChildren(el('button', { class: 'button primary', onclick: () => anschaffungSheet() }, ['+ Wunsch / Bestellung']));
  const sj = box.dataset.schuljahr || schuljahrJetzt();
  const [b, liste] = await Promise.all([api.v2.budget(sj), api.v2.anschaffungen()]);
  const sjWahl = el('select', { class: 'filter-select' }, schuljahrListe().map((s) => el('option', { value: s, selected: s === sj }, [`Schuljahr ${s}`])));
  sjWahl.addEventListener('change', () => { box.dataset.schuljahr = sjWahl.value; ladeAnschaffungen(); });
  const betrag = el('input', { type: 'text', value: b.betrag === null ? '' : String(b.betrag).replace('.', ','), placeholder: 'z. B. 500', style: { maxWidth: '110px' } });
  betrag.addEventListener('change', async () => { await api.v2.budgetSetzen(sjWahl.value, betrag.value.trim()); await ladeAnschaffungen(); toast('Budget gespeichert.'); });
  const anteil = b.betrag ? Math.min(1, b.ausgegeben / b.betrag) : 0;
  const status = !b.betrag ? null : b.frei < 0 ? ['danger', '⚠︎ überzogen'] : anteil > 0.85 ? ['warn', '⚠︎ fast aufgebraucht'] : ['ok', 'im Rahmen'];
  const sichtbar = anschaffungFilter ? liste.filter((a) => a.status === anschaffungFilter) : liste;
  box.replaceChildren(
    v2Karte(null, [
      el('div', { class: 'row-inline', style: { flexWrap: 'wrap', gap: '18px' } }, [
        sjWahl,
        el('label', { class: 'hint' }, ['Budget ', betrag, ' €']),
        el('div', { class: 'v2-zahl' }, [el('span', { class: 'hint' }, ['Ausgegeben']), el('b', {}, [euro(b.ausgegeben)])]),
        el('div', { class: 'v2-zahl' }, [el('span', { class: 'hint' }, ['Noch frei']), el('b', {}, [euro(b.frei)])]),
        el('div', { class: 'v2-zahl' }, [el('span', { class: 'hint' }, ['Offene Wünsche']), el('b', {}, [euro(b.geplant)])]),
        status ? el('span', { class: `badge ${status[0] === 'ok' ? 'ok' : 'danger'}` }, [status[1]]) : null,
      ]),
      b.betrag ? el('div', { class: 'v2-meter', role: 'meter', 'aria-valuenow': Math.round(anteil * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 }, [
        el('div', { class: `v2-meter-fuellung ${status?.[0] || ''}`, style: { width: `${Math.round(anteil * 100)}%` } }),
      ]) : el('p', { class: 'hint' }, ['Trag oben das Budget für dieses Schuljahr ein, dann zeigt INGA, wie viel noch frei ist.']),
    ]),
    el('div', { class: 'row-inline', style: { marginBottom: '10px' } }, [
      ...[['', 'Alle'], ...Object.entries(ANSCHAFFUNG_STATUS)].map(([k, n]) => el('button', {
        class: `button small ${anschaffungFilter === k ? 'primary' : 'ghost'}`,
        onclick: () => { anschaffungFilter = k; ladeAnschaffungen(); },
      }, [`${n} (${k ? liste.filter((a) => a.status === k).length : liste.length})`])),
    ]),
    v2Tabelle([
      { titel: 'Titel', wert: (a) => el('div', {}, [el('div', {}, [a.titel]), a.autor ? el('div', { class: 'hint' }, [a.autor]) : null]) },
      { titel: 'Gewünscht von', wert: (a) => a.wunsch_von || '' },
      { titel: 'Preis', num: true, wert: (a) => (a.preis === null ? '–' : `${a.anzahl > 1 ? `${a.anzahl} × ` : ''}${euro(a.preis)}`) },
      { titel: 'Status', wert: (a) => el('span', { class: `badge ${a.status === 'geliefert' ? 'ok' : a.status === 'abgelehnt' ? 'danger' : ''}` }, [ANSCHAFFUNG_STATUS[a.status] + (a.status === 'bestellt' && a.bestellt_am ? ` ${fmtDatum(a.bestellt_am)}` : a.status === 'geliefert' && a.geliefert_am ? ` ${fmtDatum(a.geliefert_am)}` : '')]) },
      { titel: '', wert: (a) => el('div', { class: 'row-inline' }, [
        a.status === 'wunsch' ? el('button', { class: 'button small', onclick: () => statusSetzen(a, 'bestellt') }, ['Bestellt']) : null,
        a.status === 'bestellt' ? el('button', { class: 'button small', onclick: () => statusSetzen(a, 'geliefert') }, ['Geliefert']) : null,
        a.status === 'geliefert' ? el('button', { class: 'button small primary', title: 'Als neuen Titel im Katalog anlegen', onclick: () => openKatalogSheet(null, { Titel: a.titel, Autor: a.autor, ISBN: a.isbn }) }, ['In Katalog']) : null,
        el('button', { class: 'button small ghost', onclick: () => anschaffungSheet(a) }, ['Bearbeiten']),
      ]) },
    ], sichtbar, 'Noch keine Einträge – Wünsche von Kindern und Lehrkräften hier sammeln.'),
  );
}

async function statusSetzen(a, status) {
  await api.v2.anschaffungSpeichern({ ...a, status });
  await ladeAnschaffungen();
}

function anschaffungSheet(a = null) {
  openSheet({
    title: a ? 'Anschaffung bearbeiten' : 'Neuer Wunsch / neue Bestellung',
    fields: [
      { name: 'titel', label: 'Titel' },
      { name: 'autor', label: 'Autor' },
      { name: 'isbn', label: 'ISBN' },
      { name: 'wunsch_von', label: 'Gewünscht von (Kind, Klasse, Lehrkraft)' },
      { name: 'preis', label: 'Preis je Stück (€)' },
      { name: 'anzahl', label: 'Anzahl', type: 'number' },
      { name: 'status', label: 'Status', type: 'select', options: Object.entries(ANSCHAFFUNG_STATUS).map(([value, label]) => ({ value, label })) },
      { name: 'notiz', label: 'Notiz (z. B. Händler, Bestellnummer)', type: 'textarea' },
    ],
    values: a ? { ...a, preis: a.preis === null ? '' : String(a.preis).replace('.', ',') } : { status: 'wunsch', anzahl: 1 },
    onSave: async (w) => {
      await api.v2.anschaffungSpeichern({ ...w, id: a?.id });
      await ladeAnschaffungen();
      toast('Gespeichert.');
    },
    onDelete: a ? async () => { await api.v2.anschaffungLoeschen(a.id); await ladeAnschaffungen(); toast('Gelöscht.'); } : null,
  });
}

/* ============================================================ Inventur */

const INVENTUR_TEXT = {
  ok: ['ok', '✓ gefunden'],
  wiedergefunden: ['ok', '✓ wiedergefunden (war als vermisst/nicht verfügbar geführt)'],
  doppelt: ['', 'schon gescannt'],
  ausgeliehen: ['danger', '⚠︎ steht im Regal, ist aber als ausgeliehen verbucht'],
  unbekannt: ['danger', '⚠︎ unbekannte Nummer'],
};
const inventurProtokoll = [];

async function ladeInventur() {
  const box = document.getElementById('v2-inventur');
  const stand = await api.v2.inventurStand();
  const werkzeuge = document.getElementById('v2-inventur-werkzeuge');
  werkzeuge.replaceChildren();
  if (!stand.aktiv) {
    const standort = el('select', { class: 'filter-select' }, [el('option', { value: '' }, ['Ganzer Bestand']), ...standortOptions().map((o) => el('option', { value: o.value }, [o.label]))]);
    box.replaceChildren(v2Karte('Inventur starten', [
      el('p', {}, ['Bei der Inventur scannst du nacheinander jedes Buch im Regal. Am Ende zeigt INGA, welche Bücher fehlen – ausgeliehene Bücher werden dabei natürlich nicht erwartet. Du kannst jederzeit unterbrechen und später weitermachen.']),
      el('div', { class: 'row-inline' }, [
        standort,
        el('button', { class: 'button primary', onclick: async () => { await api.v2.inventurStarten({ standortNi: standort.value || null }); inventurProtokoll.length = 0; await ladeInventur(); } }, ['Inventur starten']),
      ]),
    ]));
    return;
  }
  const anteil = stand.erwartet ? stand.gescannt / stand.erwartet : 0;
  const feld = el('input', { type: 'text', placeholder: 'Buchnummer scannen …', class: 'v2-scanfeld', autocomplete: 'off' });
  const protokoll = el('div', { class: 'v2-protokoll' });
  const zeichneProtokoll = () => protokoll.replaceChildren(...inventurProtokoll.slice(0, 12).map((p) => {
    const [art, text] = INVENTUR_TEXT[p.status] || ['', p.status];
    return el('div', { class: 'row-inline' }, [el('span', { class: `badge ${art}` }, [text]), el('span', {}, [`${p.etikett}${p.titel ? ` – ${p.titel}` : ''}`])]);
  }));
  zeichneProtokoll();
  const zaehler = el('b', {}, [`${stand.gescannt} von ${stand.erwartet}`]);
  const offenText = el('span', { class: 'hint' }, [`· noch ${stand.fehlend.length} offen`]);
  const fuellung = el('div', { class: 'v2-meter-fuellung', style: { width: `${Math.round(anteil * 100)}%` } });
  feld.addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !feld.value.trim()) return;
    const code = feld.value.trim();
    feld.value = '';
    try {
      const r = await api.v2.inventurScan(code);
      inventurProtokoll.unshift(r);
      zeichneProtokoll();
      const neu = await api.v2.inventurStand();
      zaehler.textContent = `${neu.gescannt} von ${neu.erwartet}`;
      offenText.textContent = `· noch ${neu.fehlend.length} offen`;
      fuellung.style.width = `${Math.round((neu.erwartet ? neu.gescannt / neu.erwartet : 0) * 100)}%`;
    } catch (err) { toast(err.message, 'error'); }
  });
  werkzeuge.replaceChildren(
    el('button', { class: 'button', onclick: async () => { const s = await api.v2.inventurStand(); druckeDokument('inventur', s, 'Inventur – fehlt noch'); } }, ['🖨 Fehlliste']),
    el('button', { class: 'button ghost', onclick: async () => { if (confirm('Inventur abbrechen? Alle Scans dieser Inventur werden verworfen.')) { await api.v2.inventurAbbrechen(); await ladeInventur(); } } }, ['Abbrechen']),
    el('button', { class: 'button primary', onclick: () => inventurAbschliessenDialog() }, ['Abschließen …']),
  );
  box.replaceChildren(
    v2Karte(`Inventur seit ${fmtDatum(stand.inventur.gestartet)}`, [
      el('div', { class: 'row-inline' }, [el('span', { class: 'hint' }, ['Gescannt: ']), zaehler, offenText]),
      el('div', { class: 'v2-meter', role: 'meter' }, [fuellung]),
      feld,
      el('p', { class: 'hint' }, ['Scanner oder Tastatur: Nummer eingeben und Enter. Doppelt gescannte Bücher zählen nur einmal.']),
      protokoll,
    ]),
  );
  feld.focus();
}

async function inventurAbschliessenDialog() {
  const stand = await api.v2.inventurStand();
  openSheet({
    title: 'Inventur abschließen',
    fields: [{ name: 'vermisst', label: `${stand.fehlend.length} Exemplare nicht gefunden – was tun?`, type: 'select', options: [
      { value: 'ja', label: 'Als „Vermisst (Inventur)“ markieren (Verlustliste)' },
      { value: 'nein', label: 'Nichts ändern, nur abschließen' },
    ] }],
    values: { vermisst: 'ja' },
    extra: el('p', { class: 'hint' }, ['Bücher, die als vermisst geführt waren und jetzt gescannt wurden, werden automatisch wieder freigegeben. Die Fehlliste lässt sich vorher über „Fehlliste“ drucken.']),
    onSave: async (w) => {
      const r = await api.v2.inventurAbschliessen({ fehlendeAlsVermisst: w.vermisst === 'ja' });
      toast(`Inventur abgeschlossen: ${r.gescannt} gefunden, ${r.vermisst} als vermisst markiert, ${r.wiedergefunden} wiedergefunden.`);
      await ladeInventur();
    },
  });
}

/* ============================================================ Schuljahreswechsel */

async function ladeSchuljahr() {
  const box = document.getElementById('v2-schuljahr');
  const neue1 = el('input', { type: 'checkbox', checked: true });
  const vornamen = el('input', { type: 'checkbox', checked: true });
  const ergebnis = el('div');
  const optionen = () => ({ neueErsteKlassen: neue1.checked, vornamenAnpassen: vornamen.checked });
  const vorschau = async () => {
    const p = await api.v2.schuljahrPlan(optionen());
    ergebnis.replaceChildren(
      v2Karte(`Vorschau: Wechsel in das nächste Schuljahr (Abschlussklasse ${p.abschlussStufe})`, [
        el('div', { class: 'stat-row' }, [
          el('div', { class: 'card stat-card' }, [el('div', { class: 'n' }, [String(p.aenderungen.length)]), el('div', { class: 'label' }, ['Kinder rücken auf'])]),
          el('div', { class: 'card stat-card' }, [el('div', { class: 'n' }, [String(p.abgaenger.length)]), el('div', { class: 'label' }, ['Abgänger'])]),
          el('div', { class: 'card stat-card' }, [el('div', { class: 'n' }, [String(p.gruppen.length)]), el('div', { class: 'label' }, ['Gruppen werden umbenannt'])]),
          el('div', { class: 'card stat-card' }, [el('div', { class: 'n' }, [String(p.ohneKlasse.length)]), el('div', { class: 'label' }, ['ohne erkannte Klasse'])]),
        ]),
        el('div', { class: 'section-title' }, ['Gruppen']),
        v2Tabelle([
          { titel: 'Bisher', wert: (g) => g.LeserGruBz },
          { titel: 'Neu', wert: (g) => el('b', {}, [g.neu]) },
          { titel: '', wert: (g) => (g.art === 'neue1' ? el('span', { class: 'badge' }, ['wird neue 1. Klasse']) : g.art === 'abschluss' ? el('span', { class: 'badge' }, ['bleibt']) : '') },
        ], p.gruppen, 'Keine Gruppe mit Klasse im Namen.'),
        p.gruppenUnveraendert.length ? el('p', { class: 'hint' }, [`Unverändert: ${p.gruppenUnveraendert.map((g) => g.LeserGruBz).join(', ')}`]) : null,
        el('div', { class: 'section-title' }, ['Abgänger']),
        el('p', { class: 'hint' }, ['Kommen in den Papierkorb (dort wiederherstellbar). Wer noch Bücher hat, bleibt mit „Abgang …“ in der Nutzerliste, bis alles zurück ist.']),
        v2Tabelle([
          { titel: 'Kind', wert: (a) => a.name },
          { titel: 'Klasse', wert: (a) => a.klasse },
          { titel: '', wert: (a) => (a.offeneAusleihen ? el('span', { class: 'badge danger' }, ['hat noch Bücher – bleibt vorerst']) : el('span', { class: 'badge' }, ['→ Papierkorb'])) },
        ], p.abgaenger, 'Keine Abgänger.'),
        el('details', {}, [
          el('summary', { class: 'hint' }, [`Alle ${p.aenderungen.length} Kinder, die aufrücken`]),
          v2Tabelle([
            { titel: 'Kind', wert: (a) => a.name },
            { titel: 'Von', wert: (a) => a.von },
            { titel: 'Nach', wert: (a) => a.nach },
            { titel: 'Erkannt aus', wert: (a) => ({ jahrgang: 'Jahrgang', gruppe: 'Gruppe', vorname: 'Vorname' })[a.quelle] },
          ], p.aenderungen),
        ]),
        p.ohneKlasse.length ? el('details', {}, [
          el('summary', { class: 'hint' }, [`${p.ohneKlasse.length} Nutzer ohne erkannte Klasse (bleiben unverändert, z. B. Lehrkräfte)`]),
          el('p', { class: 'hint' }, [p.ohneKlasse.map((o) => o.name).join(' · ')]),
        ]) : null,
        el('div', { class: 'row-inline', style: { marginTop: '16px' } }, [
          el('button', {
            class: 'button primary',
            onclick: async (e) => {
              if (!confirm(`Schuljahreswechsel jetzt durchführen?\n\n${p.aenderungen.length} Kinder rücken auf, ${p.abgaenger.length} Abgänger, ${p.gruppen.length} Gruppen werden umbenannt.\n\nINGA sichert vorher automatisch (Einstellungen → Datensicherung).`)) return;
              e.target.disabled = true;
              try {
                const r = await api.v2.schuljahrAusfuehren(optionen());
                ergebnis.replaceChildren(v2Karte('✓ Schuljahreswechsel erledigt', [
                  el('p', {}, [`${r.kinder} Kinder angepasst, ${r.gruppen} Gruppen umbenannt, ${r.papierkorb} Abgänger in den Papierkorb verschoben.`]),
                  r.behalten.length ? el('p', { class: 'hint' }, [`Noch in der Nutzerliste (haben Bücher): ${r.behalten.map((b) => b.name).join(', ')}`]) : null,
                  el('p', { class: 'hint' }, ['Neue Erstklässler bitte wie gewohnt anlegen oder importieren und der passenden 1. Klasse zuordnen.']),
                ]));
                state.stammdaten = await api.stammdaten.get();
                await fuelleAlleFilter();
                await refreshKennzahlen();
              } catch (err) {
                toast(err.message, 'error');
                e.target.disabled = false;
              }
            },
          }, ['Schuljahreswechsel durchführen']),
        ]),
      ]),
    );
  };
  neue1.addEventListener('change', vorschau);
  vornamen.addEventListener('change', vorschau);
  box.replaceChildren(
    v2Karte('Ins neue Schuljahr wechseln', [
      el('p', {}, ['Zählt alle Klassen um eins hoch, verschiebt die Abgänger in den Papierkorb und benennt die Klassen-Gruppen um (z. B. „1c Fr. Brücker 26/27“ → „2c Fr. Brücker 27/28“). INGA erkennt die Klasse aus dem Feld „Jahrgang“, aus der Nutzergruppe oder aus dem Vornamen („Mia 3b“). Zuerst die Vorschau prüfen – geändert wird erst beim Klick auf „durchführen“.']),
      el('label', { class: 'checkbox-label' }, [neue1, ' Gruppen der Abschlussklassen werden zu neuen 1. Klassen (Lehrkraft übernimmt die neuen Erstklässler)']),
      el('label', { class: 'checkbox-label' }, [vornamen, ' Klasse am Vornamen mit hochzählen („Ben 3a“ → „Ben 4a“)']),
      el('p', { class: 'hint' }, ['Die Abschlussklasse stellst du unter Einstellungen → Allgemein → Ausleihe ein.']),
    ]),
    ergebnis,
  );
  await vorschau();
}

/* ============================================================ Berichte & Datenschutz */

async function druckeRueckstandProKlasse(schwelle) {
  const klassen = await api.v2.rueckstandProKlasse(schwelle);
  if (!klassen.length) { toast('Keine überfälligen Bücher.'); return; }
  druckeDokument('klassenlisten', { klassen, schwelle }, 'Rückstand pro Klasse');
}

async function ladeBerichte() {
  const box = document.getElementById('v2-berichte');
  if (box.dataset.aufgebaut) return;
  box.dataset.aufgebaut = '1';
  const sjWahl = el('select', { class: 'filter-select' }, schuljahrListe().map((s) => el('option', { value: s }, [`Schuljahr ${s}`])));
  const schwelle = el('input', { type: 'number', min: 0, value: 1, style: { maxWidth: '70px' } });
  const tage = el('input', { type: 'number', min: 0, max: 30, value: state.settings.erinnerungTageVorher ?? 3, style: { maxWidth: '70px' } });
  const baldListe = el('div', { id: 'v2-bald-liste' });
  const ladeBald = async () => {
    const zeilen = await api.v2.baldFaellig(Number(tage.value));
    baldListe.replaceChildren(
      el('div', { class: 'row-inline', style: { margin: '8px 0' } }, [
        el('span', { class: 'hint' }, [`${zeilen.length} Bücher werden bald fällig`]),
        el('div', { class: 'spacer' }),
        el('button', { class: 'button primary', disabled: !zeilen.length, onclick: () => druckeDokument('erinnerungen', { zeilen }, 'Erinnerungen') }, ['🖨 Erinnerungszettel drucken']),
      ]),
      v2Tabelle([
        { titel: 'Kind', wert: (z) => `${z.Nachname}, ${z.Vorname}` },
        { titel: 'Klasse', wert: (z) => z.klasse || '–' },
        { titel: 'Buch', wert: (z) => z.Titel },
        { titel: 'Fällig', wert: (z) => `${fmtDatum(z.faelligAm)}${z.resttage === 0 ? ' (heute)' : z.resttage === 1 ? ' (morgen)' : ` (in ${z.resttage} Tagen)`}` },
      ], zeilen, 'In diesem Zeitraum wird nichts fällig.'),
    );
  };
  tage.addEventListener('input', debounce(ladeBald, 300));
  box.replaceChildren(
    el('div', { id: 'v2-bericht-jahresbericht' }, [v2Karte('📊 Jahresbericht', [
      el('p', { class: 'hint' }, ['Für Schulkonferenz oder Förderverein: Ausleihen pro Monat, beliebteste Bücher, Ausleihen pro Klasse, Zugänge, Lesepass und Budget – als Druck oder PDF.']),
      el('div', { class: 'row-inline' }, [sjWahl, el('button', { class: 'button primary', onclick: async () => druckeDokument('jahresbericht', { bericht: await api.v2.jahresbericht(sjWahl.value) }, `Jahresbericht ${sjWahl.value}`) }, ['Jahresbericht erstellen'])]),
    ])]),
    el('div', { id: 'v2-bericht-erinnerungen' }, [v2Karte('🔔 Freundliche Erinnerung vor der Fälligkeit', [
      el('p', { class: 'hint' }, ['Kleine Zettel (8 pro Seite) für Kinder, deren Buch bald zurück muss – bevor es überfällig wird. Zum Verteilen in der Klasse oder ins Postfach.']),
      el('label', { class: 'hint' }, ['Fällig in den nächsten ', tage, ' Tagen']),
      baldListe,
    ])]),
    el('div', { id: 'v2-bericht-klassen' }, [v2Karte('🏫 Rückstand pro Klasse für die Lehrkräfte', [
      el('p', { class: 'hint' }, ['Eine Seite pro Klasse mit allen überfälligen Büchern – für das Fach der Lehrkraft, statt einzelner Briefe.']),
      el('div', { class: 'row-inline' }, [el('label', { class: 'hint' }, ['Überfällig seit mindestens ', schwelle, ' Tagen']), el('button', { class: 'button primary', onclick: () => druckeRueckstandProKlasse(Number(schwelle.value) || 0) }, ['Klassenlisten drucken'])]),
    ])]),
    el('div', { id: 'v2-bericht-datenschutz' }, [v2Karte('🔒 Datenschutz', [
      el('p', {}, ['Auskunft für ein Kind (alles, was INGA gespeichert hat): in der Nutzerakte über „Datenauskunft drucken“.']),
      el('p', {}, ['Automatisches Löschen alter Ausleihen: Einstellungen → „Klassen, Leseförderung & Datenschutz“.']),
    ])]),
  );
  await ladeBald();
}

function v2ZeigeBericht(teil) {
  ladeBerichte().then(() => document.getElementById(`v2-bericht-${teil}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/* ============================================================ Einstellungen */

function einstellungenBereich() {
  const zahl = (id, attrs = {}) => el('input', { type: 'number', id, min: 0, style: { maxWidth: '80px' }, ...attrs });
  return el('section', { class: 'settings-pane', id: 'einst-pane-zwei', hidden: true }, [
    el('h2', {}, ['Klassen, Leseförderung & Datenschutz']),
    el('div', { class: 'section-title', style: { marginTop: '0' } }, ['Ausleihgrenze je Klassenstufe']),
    el('div', { class: 'card', style: { padding: '18px', marginBottom: '16px' } }, [
      el('p', { class: 'hint', style: { marginTop: '0' } }, ['Wie viele Medien ein Kind gleichzeitig haben darf – z. B. Klasse 1 nur ein Buch. 0 = es gilt die allgemeine Grenze (Allgemein → Ausleihe). Eine Grenze an der Nutzergruppe selbst (aus Perpustakaan) geht vor.']),
      el('div', { class: 'row-inline', style: { gap: '18px', flexWrap: 'wrap' } }, [1, 2, 3, 4].map((s) => el('label', {}, [`Klasse ${s}: `, zahl(`v2-limit-${s}`, { max: 99 })]))),
      el('div', { class: 'field', style: { marginTop: '14px' } }, [
        el('label', {}, ['Erinnerung vor der Fälligkeit']),
        el('div', { class: 'row-inline' }, [zahl('v2-erinnerungTageVorher', { max: 30 }), el('span', { class: 'hint' }, ['Tage vorher (Berichte → „Bald fällig“)'])]),
      ]),
    ]),
    el('div', { class: 'section-title' }, ['Leseförderung']),
    el('div', { class: 'card', style: { padding: '18px', marginBottom: '16px' } }, [
      el('div', { class: 'row-inline', style: { gap: '18px', flexWrap: 'wrap' } }, [
        el('label', {}, ['🥉 Bronze ab ', zahl('v2-stufe-0', { min: 1 }), ' Büchern']),
        el('label', {}, ['🥈 Silber ab ', zahl('v2-stufe-1', { min: 1 }), ' Büchern']),
        el('label', {}, ['🥇 Gold ab ', zahl('v2-stufe-2', { min: 1 }), ' Büchern']),
      ]),
      el('p', { class: 'hint' }, ['Gezählt werden im Schuljahr zurückgegebene Bücher (jeder Titel einmal).']),
      el('div', { class: 'field', style: { marginTop: '10px' } }, [
        el('label', {}, ['„Neu in der Bücherei“ zeigt Zugänge der letzten']),
        el('div', { class: 'row-inline' }, [zahl('v2-neuerwerbungenTage', { min: 1, max: 730 }), el('span', { class: 'hint' }, ['Tage'])]),
      ]),
    ]),
    el('div', { class: 'section-title' }, ['Datenschutz']),
    el('div', { class: 'card', style: { padding: '18px', marginBottom: '16px' } }, [
      el('div', { class: 'field' }, [
        el('label', {}, ['Zurückgegebene Ausleihen automatisch löschen nach']),
        el('div', { class: 'row-inline' }, [zahl('v2-historieLoeschenMonate', { max: 120 }), el('span', { class: 'hint' }, ['Monaten (0 = nie löschen)'])]),
      ]),
      el('p', { class: 'hint' }, ['Offene Ausleihen bleiben immer. Gelöscht werden alte, abgeschlossene Ausleihen samt zugehöriger Mahnungen; bei Schäden wird nur der Name entfernt. Läuft einmal täglich beim Start, vorher wird gesichert. Achtung: Lesepass, Empfehlungen und Statistik können nur auf noch vorhandene Ausleihen zurückgreifen.']),
      el('p', { class: 'hint', id: 'v2-historie-vorschau' }),
      el('button', { class: 'button', id: 'v2-historie-jetzt' }, ['Jetzt bereinigen']),
    ]),
  ]);
}

let v2EinstellungenVerdrahtet = false;

async function ladeV2Einstellungen() {
  const s = state.settings;
  for (const st of [1, 2, 3, 4]) document.getElementById(`v2-limit-${st}`).value = s.ausleihLimitJeStufe?.[st] ?? 0;
  const stufen = s.lesepassStufen || [5, 10, 20];
  [0, 1, 2].forEach((i) => { document.getElementById(`v2-stufe-${i}`).value = stufen[i] ?? ''; });
  document.getElementById('v2-erinnerungTageVorher').value = s.erinnerungTageVorher ?? 3;
  document.getElementById('v2-neuerwerbungenTage').value = s.neuerwerbungenTage ?? 60;
  document.getElementById('v2-historieLoeschenMonate').value = s.historieLoeschenMonate ?? 0;
  await zeigeHistorieVorschau();
  if (v2EinstellungenVerdrahtet) return;
  v2EinstellungenVerdrahtet = true;
  const speichern = debounce(async () => {
    const zahl = (id) => Number(document.getElementById(id).value) || 0;
    state.settings = await api.settings.save({
      ausleihLimitJeStufe: Object.fromEntries([1, 2, 3, 4].map((st) => [st, zahl(`v2-limit-${st}`)])),
      lesepassStufen: [0, 1, 2].map((i) => zahl(`v2-stufe-${i}`)).filter((x) => x > 0),
      erinnerungTageVorher: zahl('v2-erinnerungTageVorher'),
      neuerwerbungenTage: zahl('v2-neuerwerbungenTage') || 60,
      historieLoeschenMonate: zahl('v2-historieLoeschenMonate'),
    });
    await zeigeHistorieVorschau();
  }, 400);
  for (const node of document.querySelectorAll('#einst-pane-zwei input')) node.addEventListener('input', speichern);
  document.getElementById('v2-historie-jetzt').addEventListener('click', async () => {
    const monate = Number(document.getElementById('v2-historieLoeschenMonate').value) || 0;
    if (!monate) { toast('Bitte zuerst die Anzahl Monate eintragen.', 'error'); return; }
    const v = await api.v2.historieVorschau(monate);
    if (!confirm(`${v.ausleihen} abgeschlossene Ausleihen von vor dem ${fmtDatum(v.grenze)} jetzt löschen? INGA sichert vorher automatisch.`)) return;
    const r = await api.v2.historieBereinigen();
    toast(`${r.ausleihen} alte Ausleihen und ${r.mahnungen} Mahnungen gelöscht.`);
    await zeigeHistorieVorschau();
  });
}

async function zeigeHistorieVorschau() {
  const monate = Number(document.getElementById('v2-historieLoeschenMonate').value) || 0;
  const ziel = document.getElementById('v2-historie-vorschau');
  if (!monate) { ziel.textContent = 'Automatisches Löschen ist aus.'; return; }
  const v = await api.v2.historieVorschau(monate);
  ziel.textContent = v.ausleihen ? `Derzeit betroffen: ${v.ausleihen} abgeschlossene Ausleihen von vor dem ${fmtDatum(v.grenze)}.` : 'Derzeit ist nichts so alt.';
}
