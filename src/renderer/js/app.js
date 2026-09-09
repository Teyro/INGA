'use strict';

const api = window.inga;
const state = {
  view: 'dashboard',
  stammdaten: null,
  settings: null,
  katalogSeite: 1,
  leserSeite: 1,
  // Buchdetail (Abschnitt 3): aktuell ausgewählter Titel + die zuletzt
  // geladene Trefferliste (für die Pfeiltasten-Navigation), siehe wireKatalog.
  katalogAusgewaehltNi: null,
  katalogZeilen: [],
  // Direktsprung (Dashboard/Statistik -> Katalog, siehe springeZuBuchDetail):
  // erzwingt, dass genau dieser Titel im Treffer stehen bleibt, egal welche
  // Seite/Filter zuvor aktiv war – sonst würde die Detailzeile lautlos nicht
  // erscheinen, weil sie gar nicht im sichtbaren #katalog-tbody steckt.
  katalogSprungNi: null,
};

/**
 * Cover ändern sich selten, werden aber an mehreren Stellen in derselben
 * Sitzung angezeigt (Dashboard-Top-10, Buchdetailseite, ggf. erneut nach
 * Rückkehr zum Dashboard) – ein einfacher In-Memory-Cache erspart wiederholte
 * IPC-Rundreisen samt Base64-Kodierung für dasselbe Bild. Wird bei
 * Download/Upload/Löschen eines Covers gezielt invalidiert.
 */
const coverCache = new Map();

async function holeCoverGecacht(katalogNi) {
  if (coverCache.has(katalogNi)) return coverCache.get(katalogNi);
  const dataUrl = await api.cover.get(katalogNi);
  coverCache.set(katalogNi, dataUrl);
  return dataUrl;
}

function invalidiereCover(katalogNi, dataUrl) {
  if (dataUrl === undefined) coverCache.delete(katalogNi);
  else coverCache.set(katalogNi, dataUrl);
}

/* ------------------------------------------------------------------ Start */

async function boot() {
  const data = await api.bootstrap();
  applyChrome(data);
  state.settings = data.settings;
  state.stammdaten = await api.stammdaten.get();

  document.getElementById('win-close').addEventListener('click', () => api.window.close());
  document.getElementById('win-minimize').addEventListener('click', () => api.window.minimize());
  const maximizeButton = document.getElementById('win-maximize');
  maximizeButton.addEventListener('click', async () => setMaximizedState(await api.window.toggleMaximize()));
  api.on('window:state', ({ maximized }) => setMaximizedState(maximized));
  wireSpruch();
  wireUhr();

  for (const item of document.querySelectorAll('.nav-item')) {
    item.addEventListener('click', () => showView(item.dataset.view));
  }

  await fuelleAlleFilter();
  wireDashboard();
  wireKatalog();
  wireLeser();
  wireAusleihe();
  wireRueckgabe();
  wireMahnungen();
  wireUmlauf();
  wireStatistik();
  wireBestand();
  wireEtiketten();
  wireEinstellungen();
  wireSheet();

  api.on('menu:action', onMenuAction);
  api.on('settings:updated', (s) => {
    state.settings = s;
    applyChrome({ ...data, settings: s });
    if (state.view === 'mahnungen') renderMahnungenAktuell();
  });
  api.on('cover:progress', aktualisiereCoverFortschritt);

  showView('dashboard');
}

function setMaximizedState(maximized) {
  const button = document.getElementById('win-maximize');
  button.textContent = maximized ? '❐' : '□';
  button.title = maximized ? 'Wiederherstellen' : 'Maximieren';
}

/**
 * Easter Egg in der Kopfleiste: ein zufälliger Spruch aus SPRUECHE
 * (sprueche.js, dieselbe Liste wie der Splashscreen), neuer bei jedem
 * Klick – nie derselbe zweimal hintereinander.
 */
function wireSpruch() {
  const spruchEl = document.getElementById('spruch');
  const naechsterSpruch = () => {
    let neu;
    do { neu = SPRUECHE[Math.floor(Math.random() * SPRUECHE.length)]; } while (neu === spruchEl.dataset.aktuell && SPRUECHE.length > 1);
    spruchEl.dataset.aktuell = neu;
    spruchEl.textContent = `– ${neu}`;
  };
  spruchEl.addEventListener('click', naechsterSpruch);
  naechsterSpruch();
}

/**
 * Digitaluhr oben rechts in der Kopfleiste, mit Sekunden. Warnt kurz vor
 * Pausenende: ab 10:15 Uhr gelb, ab 10:18 Uhr orange, ab 10:19 Uhr
 * rot-blinkend, ab 10:20 Uhr wieder normal. Feste Randzeiten (keine eigene
 * Einstellung dafür, nur die Uhr selbst ist ein-/ausblendbar) – bei Bedarf
 * hier anpassen.
 */
const UHR_GELB_AB = 10 * 60 + 15; // 10:15 Uhr, in Minuten seit Mitternacht
const UHR_ORANGE_AB = 10 * 60 + 18; // 10:18 Uhr
const UHR_ROT_AB = 10 * 60 + 19; // 10:19 Uhr
const UHR_NORMAL_AB = 10 * 60 + 20; // 10:20 Uhr

function uhrFarbKlasse(stunden, minuten) {
  const m = stunden * 60 + minuten;
  if (m >= UHR_ROT_AB && m < UHR_NORMAL_AB) return 'uhr-rot';
  if (m >= UHR_ORANGE_AB && m < UHR_ROT_AB) return 'uhr-orange';
  if (m >= UHR_GELB_AB && m < UHR_ORANGE_AB) return 'uhr-gelb';
  return '';
}

function aktualisiereUhr() {
  const uhrEl = document.getElementById('uhr');
  const jetzt = new Date();
  const zwei = (n) => String(n).padStart(2, '0');
  uhrEl.textContent = `${zwei(jetzt.getHours())}:${zwei(jetzt.getMinutes())}:${zwei(jetzt.getSeconds())}`;
  uhrEl.className = `uhr ${uhrFarbKlasse(jetzt.getHours(), jetzt.getMinutes())}`.trim();
}

function wireUhr() {
  aktualisiereUhr();
  setInterval(aktualisiereUhr, 1000);
}

function applyChrome(data) {
  const root = document.documentElement;
  root.dataset.ui = data.ui;
  root.dataset.chrome = data.chrome;
  root.dataset.theme = data.dark ? 'dark' : 'light';
  root.style.setProperty('--font-scale', String((data.settings.fontScale || 100) / 100));
  const accent = data.accent || '#4f8ef7';
  const int = Number.parseInt(accent.replace('#', ''), 16);
  if (!Number.isNaN(int)) {
    root.style.setProperty('--accent-rgb', `${(int >> 16) & 255} ${(int >> 8) & 255} ${int & 255}`);
  }
  if (data.settings.reduceTransparency) root.dataset.transparency = 'reduced';
  document.getElementById('uhr').hidden = data.settings.uhrAnzeigen === false;
}

function onMenuAction(action) {
  if (action === 'neuer-titel') { showView('katalog'); openKatalogSheet(null); }
  else if (action === 'neuer-leser') { showView('leser'); openLeserSheet(null); }
  else if (action === 'import') { showView('bestand'); document.getElementById('bestand-import').click(); }
  else if (action === 'export') { showView('bestand'); document.getElementById('bestand-export').click(); }
  else if (action === 'settings') showView('einstellungen');
}

function showView(name) {
  state.view = name;
  for (const item of document.querySelectorAll('.nav-item')) item.classList.toggle('active', item.dataset.view === name);
  for (const section of document.querySelectorAll('.view[id^="view-"]')) section.hidden = section.id !== `view-${name}`;
  if (name === 'katalog') loadKatalog();
  else if (name === 'leser') loadLeser();
  else if (name === 'rueckgabe') loadRueckgabe();
  else if (name === 'mahnungen') loadMahnungen();
  else if (name === 'umlauf') loadUmlauf();
  else if (name === 'papierkorb') loadPapierkorb();
  else if (name === 'statistik') loadStatistik();
  else if (name === 'einstellungen') loadEinstellungen();
  else if (name === 'dashboard') loadDashboard();
}

/** Aktualisiert Kennzahlen und Zähler in Kopfleiste/Sidebar; liefert die Liste aller überfälligen Ausleihen zurück. */
async function refreshKennzahlen() {
  const k = await api.kennzahlen();
  document.getElementById('stat-titel').textContent = k.titel;
  document.getElementById('stat-exemplare').textContent = k.exemplare;
  document.getElementById('stat-leser').textContent = k.leser;
  document.getElementById('stat-offen').textContent = k.offen;
  document.getElementById('count-offen').textContent = k.offen ? String(k.offen) : '';

  const [ueberfaelligAlle, mahnfaellig] = await Promise.all([api.ausleihe.ueberfaelligeAlle(), api.mahnung.ueberfaellige()]);
  document.getElementById('stat-ueberfaellig').textContent = ueberfaelligAlle.length;
  document.getElementById('count-mahn').textContent = mahnfaellig.length ? String(mahnfaellig.length) : '';
  return ueberfaelligAlle;
}

/* ---------------------------------------------------------------- Dashboard */

function wireDashboard() {
  for (const btn of document.querySelectorAll('#view-dashboard [data-view]')) {
    btn.addEventListener('click', () => showView(btn.dataset.view));
  }
  for (const btn of document.querySelectorAll('#view-dashboard [data-action]')) {
    btn.addEventListener('click', () => onMenuAction(btn.dataset.action));
  }
}

async function loadDashboard() {
  const [ueberfaellig, top10] = await Promise.all([refreshKennzahlen(), api.katalog.topAusgeliehen(10)]);
  renderVergesseneRueckgaben(ueberfaellig);
  renderTopAusgeliehen(top10);
  await renderAbschlussHinweis();
}

/**
 * Schuljahresende: Hinweis, dass die Kinder der Abschlussklasse (Einstellung
 * "Abschlussklasse") die Schule verlassen – erscheint ab einen Monat vor
 * Beginn der eingetragenen Sommerferien (siehe repo.abschlussMeldung).
 * Bleibt einfach weg, wenn es nichts zu melden gibt.
 */
async function renderAbschlussHinweis() {
  const box = document.getElementById('abschluss-hinweis');
  const meldung = await api.leser.abschlussMeldung();
  if (!meldung) { box.hidden = true; box.replaceChildren(); return; }

  const anzahl = meldung.kinder.length;
  const plural = (n, einzahl, mehrzahl) => (n === 1 ? einzahl : mehrzahl);
  box.replaceChildren(
    el('div', { class: 'hinweis-banner' }, [
      el('span', { class: 'icon' }, ['🎓']),
      el('div', { class: 'hinweis-banner-inhalt' }, [
        el('div', { class: 'hinweis-banner-titel' }, [
          `${anzahl} ${plural(anzahl, 'Kind', 'Kinder')} der Klassenstufe ${meldung.klassenstufe} ${plural(anzahl, 'verlässt', 'verlassen')} zum Schuljahresende die Schule`,
        ]),
        el('div', { class: 'hinweis-banner-text' }, [
          `${meldung.sommerferienBezeichnung} beginnen am ${fmtDatum(meldung.sommerferienStart)}. Bitte rechtzeitig für die Ausleihe sperren und nach dem letzten Schultag archivieren.`,
        ]),
        el('div', { class: 'row-inline' }, [
          el('button', {
            class: 'button small',
            onclick: async (e) => {
              e.target.disabled = true;
              for (const kind of meldung.kinder) await api.leser.sperren(kind.LeserNi);
              toast(`${anzahl} ${plural(anzahl, 'Kind', 'Kinder')} für die Ausleihe gesperrt.`);
              await refreshKennzahlen();
              if (state.view === 'leser') await loadLeser();
            },
          }, ['Jetzt für die Ausleihe sperren']),
          el('button', {
            class: 'button small',
            onclick: async (e) => {
              if (!confirm(`${anzahl} ${plural(anzahl, 'Kind', 'Kinder')} wirklich in den Papierkorb verschieben? Kinder mit noch offenen Ausleihen werden dabei übersprungen (erst zurückgeben, dann erneut versuchen).`)) return;
              e.target.disabled = true;
              const ergebnis = await api.leser.abschlussVerschieben(meldung.kinder.map((k) => k.LeserNi));
              let text = `${ergebnis.verschoben} ${plural(ergebnis.verschoben, 'Kind', 'Kinder')} in den Papierkorb verschoben.`;
              if (ergebnis.uebersprungen.length) text += ` ${ergebnis.uebersprungen.length} übersprungen (noch offene Ausleihen): ${ergebnis.uebersprungen.map((u) => u.name).join(', ')}.`;
              toast(text, ergebnis.uebersprungen.length ? 'error' : '');
              await refreshKennzahlen();
              await renderAbschlussHinweis();
              if (state.view === 'leser') await loadLeser();
            },
          }, ['In den Papierkorb verschieben']),
        ]),
      ]),
    ])
  );
  box.hidden = false;
}

function renderVergesseneRueckgaben(ueberfaellig) {
  const box = document.getElementById('dash-vergessen');
  box.replaceChildren();
  if (!ueberfaellig.length) {
    box.appendChild(el('div', { class: 'empty small' }, [el('div', { class: 'icon' }, ['🎉']), 'Keine vergessenen Rückgaben – alles pünktlich zurück.']));
    return;
  }
  for (const row of ueberfaellig.slice(0, 8)) {
    box.appendChild(
      el('div', { class: 'list-row', onclick: async () => openLeserSheet(await api.leser.get(row.LeserNi)) }, [
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [`${row.Nachname}, ${row.Vorname}`]),
          el('div', { class: 'list-row-sub' }, [row.Titel]),
        ]),
        el('span', { class: 'badge danger' }, [`${row.tageUeberfaellig} ${row.tageUeberfaellig === 1 ? 'Tag' : 'Tage'}`]),
      ])
    );
  }
  if (ueberfaellig.length > 8) {
    box.appendChild(el('div', { class: 'list-more' }, [`+ ${ueberfaellig.length - 8} weitere in den Mahnungen`]));
  }
}

function renderTopAusgeliehen(top10) {
  const box = document.getElementById('dash-top10');
  box.replaceChildren();
  if (!top10.length) {
    box.appendChild(el('div', { class: 'empty small' }, [el('div', { class: 'icon' }, ['📚']), 'Noch keine Ausleihen erfasst.']));
    return;
  }
  top10.forEach((row, i) => {
    const cover = el('div', { class: 'rank-cover' }, [el('div', { class: 'cover-platzhalter-bild' })]);
    box.appendChild(
      el('div', { class: 'list-row', onclick: () => springeZuBuchDetail(row.KatalogNi) }, [
        el('div', { class: 'rank' }, [String(i + 1)]),
        cover,
        el('div', { class: 'list-row-main' }, [
          el('div', { class: 'list-row-title' }, [row.Titel]),
          el('div', { class: 'list-row-sub' }, [row.Autor || '']),
        ]),
        el('span', { class: 'badge' }, [`${row.anzahl}×`]),
      ])
    );
    holeCoverGecacht(row.KatalogNi).then((dataUrl) => { if (dataUrl) cover.replaceChildren(el('img', { src: dataUrl, alt: '' })); });
  });
}

/* ---------------------------------------------------------------- Sheet */

let sheetState = null;

function wireSheet() {
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
  document.getElementById('sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });
  document.getElementById('sheet-save').addEventListener('click', async () => {
    if (!sheetState) return;
    // Während des Speicherns gesperrt – sonst könnte ein schneller
    // Doppelklick (oder Klick+Enter) onSave() zweimal auslösen, bevor
    // closeSheet() das Sheet schließt, und so bei einem neuen Datensatz
    // zwei Zeilen statt einer anlegen.
    const saveBtn = document.getElementById('sheet-save');
    saveBtn.disabled = true;
    try {
      await sheetState.onSave(readSheetValues());
      closeSheet();
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });
  document.getElementById('sheet-delete').addEventListener('click', async () => {
    if (!sheetState?.onDelete) return;
    if (!confirm('Wirklich löschen?')) return;
    const deleteBtn = document.getElementById('sheet-delete');
    deleteBtn.disabled = true;
    try {
      await sheetState.onDelete();
      closeSheet();
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      deleteBtn.disabled = false;
    }
  });
}

/**
 * `before` (z. B. das Cover-Panel eines Buchs) erscheint vor den Feldern,
 * `wide` schaltet das Sheet auf ein zweispaltiges, breiteres Layout um.
 */
function openSheet({ title, fields, values, onSave, onDelete, extra, before, wide }) {
  sheetState = { fields, onSave, onDelete };
  document.getElementById('sheet-title').textContent = title;
  document.getElementById('sheet-panel').classList.toggle('wide', Boolean(wide));
  const body = document.getElementById('sheet-body');
  body.replaceChildren();
  if (before) body.appendChild(before);

  const fieldsWrap = el('div', { class: 'sheet-fields' });
  for (const f of fields) {
    const value = values?.[f.name] ?? '';
    let input;
    if (f.type === 'select') {
      input = el('select', { id: `f-${f.name}` }, [
        el('option', { value: '' }, ['–']),
        ...f.options.map((o) => el('option', { value: String(o.value), selected: String(o.value) === String(value) }, [o.label])),
      ]);
    } else if (f.type === 'textarea') {
      input = el('textarea', { id: `f-${f.name}`, rows: 3, value });
    } else {
      input = el('input', { id: `f-${f.name}`, type: f.type || 'text', value });
    }
    fieldsWrap.appendChild(el('div', { class: 'field' }, [el('label', {}, [f.label]), input]));
  }
  body.appendChild(fieldsWrap);

  if (extra) body.appendChild(el('div', { class: 'sheet-extra-full' }, [extra]));
  document.getElementById('sheet-delete').hidden = !onDelete;
  document.getElementById('sheet-backdrop').hidden = false;
}

function readSheetValues() {
  const out = {};
  for (const f of sheetState.fields) {
    const node = document.getElementById(`f-${f.name}`);
    out[f.name] = node.value === '' ? null : node.value;
  }
  return out;
}

function closeSheet() {
  document.getElementById('sheet-backdrop').hidden = true;
  sheetState = null;
}

/* -------------------------------------------------------------- Katalog */

function medArtOptions() {
  return (state.stammdaten.MedArt || []).map((m) => ({ value: m.MedArtKb, label: m.MedArtBz }));
}
function systematikOptions() {
  return (state.stammdaten.Systematik || []).map((s) => ({ value: s.SystemId, label: s.SystemBz }));
}
function zweigOptions() {
  return (state.stammdaten.Zweig || []).map((z) => ({ value: z.ZweigId, label: z.ZweigBz }));
}
function leserGruppOptions() {
  return (state.stammdaten.LeserGrupp || []).map((g) => ({ value: g.LeserGruNi, label: g.LeserGruBz }));
}
function standortOptions() {
  return (state.stammdaten.StandOrt || []).map((s) => ({ value: s.StOrtNi, label: s.StOrtBz }));
}
/* ------------------------------------------------------------ Etiketten */

/** Baut das Etiketten-Datenobjekt aus einem Exemplar (Medien-Zeile) und seinem Titel (Katalog-Zeile). */
function etikettAusExemplar(medium, katalog) {
  return {
    MedienEtik: medium.MedienEtik || '',
    Titel: katalog.Titel || '',
    Autor: katalog.Autor || '',
    antolin: Boolean(String(katalog.KlasseAnto || '').trim()),
  };
}

let letztesEtikettenFormat = 'zweckform-3475';

/** Öffnet das Etiketten-Druckfenster – gemeinsam genutzt von Buchdetailseite und der Etiketten-Ansicht. */
async function druckeEtiketten(labels, format = letztesEtikettenFormat, startPosition = 1) {
  if (!labels.length) { toast('Keine Exemplare zum Etikettieren.', 'error'); return; }
  letztesEtikettenFormat = format;
  await api.etiketten.drucken({ labels, format, startPosition: Math.max(1, Number(startPosition) || 1) });
}

function medArtLabel(kb) {
  const treffer = (state.stammdaten.MedArt || []).find((m) => m.MedArtKb === kb);
  return treffer ? treffer.MedArtBz : kb || '–';
}

/** Füllt die Filter-Dropdowns in Katalog und Nutzer – beim Start und nach jedem Import. */
async function fuelleAlleFilter() {
  const medArt = document.getElementById('katalog-filter-medienart');
  medArt.replaceChildren(el('option', { value: '' }, ['Alle Medienarten']), ...medArtOptions().map((o) => el('option', { value: o.value }, [o.label])));
  const kategorie = document.getElementById('katalog-filter-kategorie');
  kategorie.replaceChildren(el('option', { value: '' }, ['Alle Kategorien']), ...systematikOptions().map((o) => el('option', { value: o.value }, [o.label])));
  const standort = document.getElementById('katalog-filter-standort');
  standort.replaceChildren(el('option', { value: '' }, ['Alle Standorte']), ...standortOptions().map((o) => el('option', { value: o.value }, [o.label])));
  const gruppe = document.getElementById('leser-filter-gruppe');
  gruppe.replaceChildren(el('option', { value: '' }, ['Alle Gruppen']), ...leserGruppOptions().map((o) => el('option', { value: o.value }, [o.label])));
  const zweig = document.getElementById('leser-filter-zweig');
  zweig.replaceChildren(el('option', { value: '' }, ['Alle Zweige']), ...zweigOptions().map((o) => el('option', { value: o.value }, [o.label])));

  // Jahrgang/Klasse ist ein Freitextfeld ohne eigene Stammdaten-Tabelle –
  // die Auswahlliste kommt deshalb aus den tatsächlich vergebenen Werten.
  const jahrgaenge = await api.leser.jahrgaenge();
  const klasseOptionen = jahrgaenge.map((j) => el('option', { value: j }, [j]));
  document.getElementById('leser-filter-klasse').replaceChildren(el('option', { value: '' }, ['Alle Klassen']), ...klasseOptionen.map((o) => o.cloneNode(true)));
  document.getElementById('rueckgabe-filter-klasse').replaceChildren(el('option', { value: '' }, ['Alle Klassen']), ...klasseOptionen);
}

/**
 * Generische Filterleisten-Helfer: aktive Filter als entfernbare Chips plus
 * "Alle Filter zurücksetzen" – von Katalog, Nutzer und Rückgabe gleich
 * genutzt. `felder`: [{ istAktiv(), text(), zuruecksetzen() }].
 */
function renderFilterChips(containerId, felder) {
  const box = document.getElementById(containerId);
  box.replaceChildren();
  const aktive = felder.filter((f) => f.istAktiv());
  for (const f of aktive) {
    box.appendChild(
      el('span', { class: 'chip' }, [f.text(), el('button', { class: 'chip-remove', title: 'Filter entfernen', onclick: () => { f.zuruecksetzen(); f.neuLaden(); } }, ['✕'])])
    );
  }
  box.hidden = !aktive.length;
}

function wireFilterReset(buttonId, felder, neuLaden) {
  document.getElementById(buttonId).addEventListener('click', () => {
    for (const f of felder) f.zuruecksetzen();
    neuLaden();
  });
}

/** Chip-Feld für ein <input>/<select> mit einfachem .value – deckt die meisten Fälle ab. */
function feldChip(id, label, { anzeige, leerwert = '', neuLaden } = {}) {
  const node = () => document.getElementById(id);
  return {
    istAktiv: () => Boolean(node().value),
    text: () => `${label}: ${anzeige ? anzeige(node()) : node().tagName === 'SELECT' ? node().selectedOptions[0]?.textContent : node().value}`,
    zuruecksetzen: () => { node().value = leerwert; },
    neuLaden,
  };
}

/** Chip-Feld für eine Checkbox. */
function checkboxChip(id, label, neuLaden) {
  const node = () => document.getElementById(id);
  return { istAktiv: () => node().checked, text: () => label, zuruecksetzen: () => { node().checked = false; }, neuLaden };
}

/**
 * Aktualisiert die einheitliche Paginierungsleiste (Katalog/Nutzer): Anzeige
 * "x von y Treffern" inkl. Seitenzahl sowie Zurück/Weiter sperren, wenn es
 * keine weitere Seite gibt. `prefix` ist "katalog" oder "leser".
 */
function aktualisierePaginierung(prefix, { seite, proSeite, gesamt, anzahlAngezeigt }) {
  const gesamtSeiten = proSeite === 'alle' || !proSeite ? 1 : Math.max(1, Math.ceil(gesamt / proSeite));
  const treffer = document.getElementById(`${prefix}-treffer`);
  treffer.textContent = gesamt
    ? `${anzahlAngezeigt} von ${gesamt} Treffer${gesamt === 1 ? '' : 'n'}${gesamtSeiten > 1 ? ` – Seite ${seite} von ${gesamtSeiten}` : ''}`
    : 'Keine Treffer.';
  document.getElementById(`${prefix}-seite-zurueck`).disabled = seite <= 1;
  document.getElementById(`${prefix}-seite-vor`).disabled = seite >= gesamtSeiten;
}

const KATALOG_FILTER_FELDER = [
  feldChip('katalog-suche', 'Suche', { anzeige: (n) => `„${n.value}“`, neuLaden: () => beiKatalogFilterAenderung() }),
  feldChip('katalog-filter-medienart', 'Medienart', { neuLaden: () => beiKatalogFilterAenderung() }),
  feldChip('katalog-filter-status', 'Status', { neuLaden: () => beiKatalogFilterAenderung() }),
  feldChip('katalog-filter-kategorie', 'Kategorie', { neuLaden: () => beiKatalogFilterAenderung() }),
  feldChip('katalog-filter-standort', 'Standort', { neuLaden: () => beiKatalogFilterAenderung() }),
  feldChip('katalog-filter-klassenstufe', 'Klassenstufe', { neuLaden: () => beiKatalogFilterAenderung() }),
  // Kein <input>/<select> dahinter, sondern state.katalogSprungNi (siehe
  // springeZuBuchDetail) – trotzdem als Chip sichtbar, damit klar ist, wieso
  // die Liste nur einen Titel zeigt, und übers ✕ oder "Filter zurücksetzen"
  // normal wieder aufhebbar.
  {
    istAktiv: () => state.katalogSprungNi !== null,
    text: () => 'Direktsprung: 1 Titel',
    zuruecksetzen: () => { state.katalogSprungNi = null; },
    neuLaden: () => beiKatalogFilterAenderung(),
  },
];

function beiKatalogFilterAenderung() {
  state.katalogSprungNi = null;
  state.katalogSeite = 1;
  loadKatalog();
}

function wireKatalog() {
  document.getElementById('katalog-suche').addEventListener('input', debounce(beiKatalogFilterAenderung, 200));
  for (const id of ['katalog-filter-medienart', 'katalog-filter-status', 'katalog-filter-kategorie', 'katalog-filter-standort']) {
    document.getElementById(id).addEventListener('change', beiKatalogFilterAenderung);
  }
  document.getElementById('katalog-filter-klassenstufe').addEventListener('input', debounce(beiKatalogFilterAenderung, 200));
  wireFilterReset('katalog-filter-reset', KATALOG_FILTER_FELDER, beiKatalogFilterAenderung);
  document.getElementById('katalog-pro-seite').addEventListener('change', beiKatalogFilterAenderung);
  document.getElementById('katalog-seite-zurueck').addEventListener('click', () => { state.katalogSprungNi = null; state.katalogSeite = Math.max(1, state.katalogSeite - 1); loadKatalog(); });
  document.getElementById('katalog-seite-vor').addEventListener('click', () => { state.katalogSprungNi = null; state.katalogSeite += 1; loadKatalog(); });
  document.getElementById('katalog-neu').addEventListener('click', () => openKatalogSheet(null));
  document.getElementById('katalog-csv').addEventListener('click', () => katalogExport('csv'));
  document.getElementById('katalog-xlsx').addEventListener('click', () => katalogExport('xlsx'));

  // Pfeiltasten wechseln die Auswahl im Katalog, Escape schließt das Detail –
  // nur während der Katalog-Ansicht aktiv ist und die Kollegin nicht gerade
  // in ein Textfeld tippt (sonst würden z. B. Pfeiltasten im Suchfeld
  // blockiert). Siehe Abschnitt 3: Buchdetails ruhiger darstellen.
  document.addEventListener('keydown', (e) => {
    if (state.view !== 'katalog') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Escape') { schliesseBuchDetail(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    if (!state.katalogZeilen.length) return;
    e.preventDefault();
    const aktIndex = state.katalogZeilen.findIndex((r) => r.KatalogNi === state.katalogAusgewaehltNi);
    const naechsterIndex = aktIndex === -1
      ? 0
      : Math.min(state.katalogZeilen.length - 1, Math.max(0, aktIndex + (e.key === 'ArrowDown' ? 1 : -1)));
    waehleKatalogZeile(state.katalogZeilen[naechsterIndex]);
  });
}

/** Aktueller Filter als Objekt für repo.searchKatalog – von Anzeige UND Export gleich genutzt, damit "der Filter auch für den Export gilt". */
async function katalogAktuellerFilter() {
  const status = document.getElementById('katalog-filter-status').value;
  const filter = {
    query: document.getElementById('katalog-suche').value.trim(),
    medArtKb: document.getElementById('katalog-filter-medienart').value,
    systemId: document.getElementById('katalog-filter-kategorie').value,
    standortNi: document.getElementById('katalog-filter-standort').value,
    klassenstufe: document.getElementById('katalog-filter-klassenstufe').value.trim(),
  };
  // "Überfällig" hängt an der ferienbewussten Fälligkeitsberechnung und wird
  // deshalb nicht als eigener SQL-Ausdruck nachgebaut, sondern einmal
  // zentral ermittelt (siehe repo.katalogNiMitUeberfaelligemExemplar).
  if (status === 'ueberfaellig') filter.katalogNiIn = await api.katalog.ueberfaelligeNi();
  else if (status) filter.verfuegbarkeit = status;
  // Direktsprung siehe springeZuBuchDetail/KATALOG_FILTER_FELDER: zwingt den
  // Treffer auf genau diesen einen Titel, egal was sonst noch im Filter steht.
  if (state.katalogSprungNi !== null) filter.katalogNiIn = [state.katalogSprungNi];
  return filter;
}

async function loadKatalog() {
  const filter = await katalogAktuellerFilter();
  const proSeiteWert = document.getElementById('katalog-pro-seite').value;
  const { rows, gesamt, seite, proSeite } = await api.katalog.search(filter, {
    seite: state.katalogSeite,
    proSeite: proSeiteWert === 'alle' ? 'alle' : Number(proSeiteWert),
  });
  state.katalogSeite = seite;
  state.katalogZeilen = rows;
  renderFilterChips('katalog-filter-chips', KATALOG_FILTER_FELDER);
  const tbody = document.getElementById('katalog-tbody');
  tbody.replaceChildren();
  aktualisierePaginierung('katalog', { seite, proSeite, gesamt, anzahlAngezeigt: rows.length });
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 6 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['📖']), 'Keine Titel gefunden.'])])]));
    schliesseBuchDetail();
    return;
  }
  for (const row of rows) {
    const belegt = row.exemplareGesamt > 0 && row.exemplareVerfuegbar === 0;
    tbody.appendChild(
      el('tr', { 'data-katalog-ni': String(row.KatalogNi), class: row.KatalogNi === state.katalogAusgewaehltNi ? 'katalog-row-selected' : '', onclick: () => waehleKatalogZeile(row) }, [
        el('td', {}, [row.Titel || '']),
        el('td', {}, [row.Autor || '']),
        el('td', {}, [medArtLabel(row.MedArtKb)]),
        el('td', {}, [row.ISBN || row.EAN || '']),
        el('td', {}, [row.ErschJahr || '']),
        el('td', { class: 'num' }, [el('span', { class: `badge ${belegt ? 'danger' : row.exemplareVerfuegbar > 0 ? 'ok' : ''}` }, [`${row.exemplareVerfuegbar}/${row.exemplareGesamt}`])]),
      ])
    );
  }
  // Auswahl bleibt über ein Neuladen hinweg erhalten (z. B. nach dem
  // Speichern im Bearbeiten-Sheet), solange der Titel noch in der Liste ist –
  // sonst wird das Detail geschlossen, statt eine verwaiste Auswahl zu zeigen.
  const nochDa = rows.find((r) => r.KatalogNi === state.katalogAusgewaehltNi);
  if (nochDa) zeigeBuchDetail(nochDa);
  else if (state.katalogAusgewaehltNi !== null) schliesseBuchDetail();
}

const KATALOG_EXPORT_SPALTEN = [
  { schluessel: 'Titel', titel: 'Titel' },
  { schluessel: 'Autor', titel: 'Autor' },
  { schluessel: 'Medienart', titel: 'Medienart' },
  { schluessel: 'ISBN', titel: 'ISBN/EAN' },
  { schluessel: 'ErschJahr', titel: 'Jahr' },
  { schluessel: 'Exemplare', titel: 'Exemplare (verfügbar/gesamt)' },
];

/** Exportiert IMMER den aktuellen Filter (alle Seiten, nicht nur die angezeigte) – "der Filter gilt auch für den Export". */
async function katalogExport(art) {
  const filter = await katalogAktuellerFilter();
  const { rows } = await api.katalog.search(filter, { proSeite: 'alle' });
  if (!rows.length) { toast('Nichts zu exportieren.', 'error'); return; }
  const zeilen = rows.map((r) => ({
    Titel: r.Titel || '',
    Autor: r.Autor || '',
    Medienart: medArtLabel(r.MedArtKb),
    ISBN: r.ISBN || r.EAN || '',
    ErschJahr: r.ErschJahr || '',
    Exemplare: `${r.exemplareVerfuegbar}/${r.exemplareGesamt}`,
  }));
  const dateiname = `katalog_${heutigesDatumISO()}`;
  try {
    const pfad =
      art === 'xlsx'
        ? await api.export.xlsx({ dateiname, blattname: 'Katalog', spalten: KATALOG_EXPORT_SPALTEN, zeilen })
        : await api.export.csv({ dateiname, spalten: KATALOG_EXPORT_SPALTEN, zeilen });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
  }
}

/** Cover-Panel für die Buchdetailseite: Vorschau, Herunterladen (per ISBN), Hochladen, Entfernen. */
/**
 * ISBN-Nachschlagen (offene Quelle: Open Library) für neue UND bestehende
 * Titel – füllt Titel/Autor/Verlag/Jahr direkt in die gerade offenen
 * Sheet-Felder ein, speichert aber NICHTS von sich aus: erst ein
 * anschließender Klick auf "Speichern" übernimmt die Werte wirklich
 * (manuelle Bestätigung, wie im Auftrag verlangt).
 */
function buildIsbnLookupBlock() {
  const eingabe = el('input', { type: 'text', placeholder: 'ISBN eingeben', style: { maxWidth: '160px' } });
  const btn = el('button', { class: 'button small' }, ['Buchdaten übernehmen']);
  const status = el('p', { class: 'hint', style: { marginTop: '4px' } }, []);
  btn.addEventListener('click', async () => {
    const isbnFeld = document.getElementById('f-ISBN');
    const isbn = (eingabe.value.trim() || isbnFeld?.value.trim() || '');
    if (!isbn) { status.textContent = 'Bitte eine ISBN eingeben.'; return; }
    btn.disabled = true;
    status.textContent = 'Suche …';
    try {
      const result = await api.katalog.isbnNachschlagen(isbn);
      if (!result.ok) { status.textContent = `Keine Buchdaten gefunden (${result.grund || 'unbekannt'}).`; return; }
      for (const [feld, wert] of Object.entries(result.daten)) {
        if (!wert) continue;
        const input = document.getElementById(`f-${feld}`);
        if (input) input.value = wert;
      }
      if (isbnFeld && !isbnFeld.value) isbnFeld.value = isbn;
      status.textContent = 'Übernommen – bitte prüfen und speichern.';
    } finally {
      btn.disabled = false;
    }
  });
  return el('div', { class: 'isbn-lookup', style: { marginTop: '12px' } }, [
    el('div', { class: 'section-title' }, ['Per ISBN nachschlagen']),
    el('div', { class: 'row-inline' }, [eingabe, btn]),
    status,
  ]);
}

function buildCoverPanel(row) {
  const frame = el('div', { class: 'cover-frame' }, [el('div', { class: 'cover-platzhalter-bild' })]);
  const panel = el('div', { class: 'cover-panel' }, [frame]);

  if (!row?.KatalogNi) {
    panel.appendChild(el('p', { class: 'hint' }, ['Erst speichern, dann lässt sich ein Cover laden.']));
    panel.appendChild(buildIsbnLookupBlock());
    return panel;
  }

  const downloadBtn = el('button', { class: 'button small' }, ['Herunterladen']);
  const uploadBtn = el('button', { class: 'button small' }, ['Hochladen …']);
  const removeBtn = el('button', { class: 'button small', hidden: true }, ['Entfernen']);

  async function refreshFrame({ neuLaden } = {}) {
    if (neuLaden) invalidiereCover(row.KatalogNi);
    const dataUrl = await holeCoverGecacht(row.KatalogNi);
    frame.replaceChildren(dataUrl ? el('img', { src: dataUrl, alt: '' }) : el('div', { class: 'cover-platzhalter-bild' }));
    removeBtn.hidden = !dataUrl;
  }

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    const result = await api.cover.fetchOne(row.KatalogNi);
    downloadBtn.disabled = false;
    if (result.ok) { toast(`Cover geladen${result.quelle ? ` (${result.quelle})` : ''}.`); await refreshFrame({ neuLaden: true }); }
    else toast(`Kein Cover gefunden (${result.grund || 'unbekannt'}).`, 'error');
  });
  uploadBtn.addEventListener('click', async () => {
    const result = await api.cover.upload(row.KatalogNi);
    if (result.ok) { toast('Cover hochgeladen.'); await refreshFrame({ neuLaden: true }); }
  });
  removeBtn.addEventListener('click', async () => {
    await api.cover.delete(row.KatalogNi);
    invalidiereCover(row.KatalogNi, null);
    toast('Cover entfernt.');
    await refreshFrame();
  });

  panel.appendChild(el('div', { class: 'cover-actions' }, [downloadBtn, uploadBtn, removeBtn]));
  panel.appendChild(buildIsbnLookupBlock());
  refreshFrame();
  return panel;
}

/**
 * Metadaten bearbeiten (Titel/Autor/Verlag/ISBN/…) – bewusst noch das
 * modale Sheet, weil das Katalogisieren eine bewusste, eher seltene Aktion
 * ist. Der Alltag an der Theke (Status ansehen, Exemplare/Vormerkungen
 * verwalten) läuft dagegen über das ruhige Detail-Panel, siehe
 * zeigeBuchDetail()/baueBuchDetailInhalt() – dort gibt es einen
 * "Bearbeiten"-Knopf, der genau hierher führt.
 */
function openKatalogSheet(row) {
  const fields = [
    { name: 'Titel', label: 'Titel' },
    { name: 'UntTitel', label: 'Untertitel' },
    { name: 'Autor', label: 'Autor' },
    { name: 'Verlag', label: 'Verlag' },
    { name: 'ErschJahr', label: 'Erscheinungsjahr', type: 'number' },
    { name: 'ISBN', label: 'ISBN' },
    { name: 'EAN', label: 'EAN' },
    { name: 'MedArtKb', label: 'Medienart', type: 'select', options: medArtOptions() },
    { name: 'SystemId', label: 'Systematik', type: 'select', options: systematikOptions() },
    { name: 'Schlagwort', label: 'Schlagworte' },
    { name: 'KlasseAnto', label: 'Antolin-Klassenstufe' },
  ];

  openSheet({
    title: row ? row.Titel || 'Titel bearbeiten' : 'Neuer Titel',
    fields,
    values: row || {},
    before: buildCoverPanel(row),
    wide: true,
    onSave: async (values) => {
      const payload = row ? { ...values, KatalogNi: row.KatalogNi } : values;
      const katalogNi = await api.katalog.save(payload);
      await loadKatalog();
      await refreshKennzahlen();
      toast('Gespeichert.');
      // Bei neuen Titeln mit ISBN/EAN automatisch nach einem Cover suchen –
      // im Hintergrund (nicht abgewartet), damit das Sheet nicht erst auf den
      // Netzwerkaufruf warten muss. Beim Bearbeiten bestehender Titel nicht:
      // ein vorhandenes/bewusst entferntes Cover soll nicht überraschend
      // wieder auftauchen.
      if (!row && (payload.ISBN || payload.EAN)) {
        api.cover.fetchOne(katalogNi).then((result) => {
          if (!result.ok) return;
          invalidiereCover(katalogNi);
          toast(`Cover automatisch gefunden${result.quelle ? ` (${result.quelle})` : ''}.`);
        });
      }
    },
    onDelete: row
      ? async () => {
          await api.katalog.delete(row.KatalogNi);
          state.katalogAusgewaehltNi = null;
          await loadKatalog();
          await refreshKennzahlen();
          toast('Titel gelöscht.');
        }
      : null,
  });
}

/* ------------------------------------------------------- Buchdetail (Abschnitt 3) */

function markiereAusgewaehlteZeile() {
  for (const tr of document.querySelectorAll('#katalog-tbody tr[data-katalog-ni]')) {
    tr.classList.toggle('katalog-row-selected', Number(tr.dataset.katalogNi) === state.katalogAusgewaehltNi);
  }
}

// Schutz gegen Wettlauf bei schnell aufeinanderfolgender Auswahl (z. B.
// gehaltene Pfeiltaste): jede zeigeBuchDetail()-Anfrage bekommt eine
// aufsteigende Nummer und prüft nach ihrem await, ob sie noch die aktuellste
// ist – sonst würde ein spät auflösender Aufruf für Zeile A eine
// zwischenzeitlich für Zeile B aufgeklappte Detailzeile wieder verdrängen,
// obwohl B markiert bleibt.
let letzteBuchDetailAnfrage = 0;

/** Schließt das Detail (Accordion-Zeile), OHNE die Trefferliste neu zu laden oder ihre Scrollposition zu verändern. */
function schliesseBuchDetail() {
  letzteBuchDetailAnfrage += 1;
  state.katalogAusgewaehltNi = null;
  markiereAusgewaehlteZeile();
  for (const tr of document.querySelectorAll('.katalog-detail-row')) tr.remove();
}

async function waehleKatalogZeile(row) {
  state.katalogAusgewaehltNi = row.KatalogNi;
  await zeigeBuchDetail(row);
}

/**
 * Von woanders (Dashboard, Statistik) direkt zu einem Titel im Katalog
 * springen und ihn dort auswählen. Setzt dafür den Direktsprung-Filter
 * (state.katalogSprungNi), damit der Titel garantiert im Treffer steht –
 * unabhängig davon, welche Seite/Suche/Filter im Katalog zuvor aktiv war.
 * Sonst würde zeigeBuchDetail() die Zeile stumm nicht finden, wenn der Titel
 * z. B. auf einer anderen Seite oder außerhalb eines aktiven Filters liegt.
 */
async function springeZuBuchDetail(katalogNi) {
  showView('katalog');
  const buch = await api.katalog.get(katalogNi);
  if (!buch) return;
  // Andere Filter (Suche, Medienart, …) würden mit dem Direktsprung-Filter
  // UND-verknüpft und könnten den Titel sonst trotzdem verstecken – deshalb
  // vorher zurücksetzen, damit die Zeile sicher erscheint.
  for (const f of KATALOG_FILTER_FELDER) f.zuruecksetzen();
  state.katalogSprungNi = katalogNi;
  state.katalogSeite = 1;
  await loadKatalog();
  await waehleKatalogZeile(buch);
}

/**
 * Zeigt das Detail für `row` als aufgeklappte Zeile direkt unter der
 * gewählten Zeile (kein Overlay, keine verdeckte Liste, keine getrennt
 * scrollende Seitenspalte mehr – die stand auf schmaleren Bildschirmen weit
 * weg von der angeklickten Zeile und musste extra angescrollt werden).
 * Scrollt die aufgeklappte Zeile danach von selbst ins Bild, falls sie
 * (z. B. ganz unten in einer langen Liste) noch nicht sichtbar ist – damit
 * ist nie manuelles Scrollen/Wischen nötig, um das Ergebnis der eigenen
 * Auswahl zu sehen.
 */
async function zeigeBuchDetail(row) {
  const anfrageId = (letzteBuchDetailAnfrage += 1);
  markiereAusgewaehlteZeile();
  const inhalt = await baueBuchDetailInhalt(row);
  // Zwischenzeitlich kam eine neuere Auswahl an (oder das Detail wurde
  // geschlossen) – diese hier ist überholt und darf nichts mehr am DOM
  // ändern, siehe letzteBuchDetailAnfrage oben.
  if (anfrageId !== letzteBuchDetailAnfrage) return;

  for (const tr of document.querySelectorAll('.katalog-detail-row')) tr.remove();
  const zeile = document.querySelector(`#katalog-tbody tr[data-katalog-ni="${row.KatalogNi}"]`);
  if (!zeile) return;
  const detailTr = el('tr', { class: 'katalog-detail-row' }, [
    el('td', { colSpan: 6 }, [el('div', { class: 'katalog-detail-inhalt-anim' }, [inhalt])]),
  ]);
  zeile.after(detailTr);
  detailTr.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/**
 * Baut den Detailinhalt: zuerst, was an der Theke gebraucht wird (Titel,
 * Autor, je Exemplar Buchnummer + Status – verfügbar oder an wen/bis wann
 * ausgeliehen, inkl. Ferien-Hinweis), danach Exemplar-/Vormerkungsverwaltung,
 * zuletzt ein ruhigerer zweiter Block mit den reinen Katalogdaten.
 */
async function baueBuchDetailInhalt(row) {
  const [exemplare, vormerkungen, statistik] = await Promise.all([
    api.katalog.exemplareMitAusleihe(row.KatalogNi),
    api.vormerkung.liste(row.KatalogNi),
    api.katalog.ausleihStatistik(row.KatalogNi),
  ]);

  const neuLaden = async () => { await zeigeBuchDetail(await api.katalog.get(row.KatalogNi)); };

  const statusZeilen = exemplare.length
    ? exemplare.map((m) =>
        el('div', { class: 'buchdetail-status-row' }, [
          el('span', { class: 'buchdetail-status-etikett' }, [m.MedienEtik || `#${m.MedienNi}`]),
          m.verliehen
            ? el('div', { class: 'buchdetail-status-text' }, [
                `Ausgeliehen an ${m.ausleihe.Nachname}, ${m.ausleihe.Vorname} – bis ${fmtDatum(m.ausleihe.faelligAm)}`,
                m.ausleihe.hinweise?.length ? el('div', { class: 'hint' }, [m.ausleihe.hinweise.join(', ')]) : null,
              ])
            : el('span', { class: 'badge ok' }, ['Verfügbar']),
          el('div', { class: 'spacer' }),
          el('button', { class: 'icon-button', title: 'Etikett drucken', onclick: () => druckeEtiketten([etikettAusExemplar(m, row)]) }, ['🏷️']),
        ])
      )
    : [el('p', { class: 'hint' }, ['Noch keine Exemplare.'])];

  const katalogdaten = el('dl', { class: 'buchdetail-katalogdaten' }, [
    row.Verlag ? el('dt', {}, ['Verlag']) : null, row.Verlag ? el('dd', {}, [row.Verlag]) : null,
    row.ISBN || row.EAN ? el('dt', {}, ['ISBN/EAN']) : null, row.ISBN || row.EAN ? el('dd', {}, [row.ISBN || row.EAN]) : null,
    row.ErschJahr ? el('dt', {}, ['Jahr']) : null, row.ErschJahr ? el('dd', {}, [String(row.ErschJahr)]) : null,
    row.SystemId ? el('dt', {}, ['Systematik']) : null, row.SystemId ? el('dd', {}, [systematikOptions().find((o) => String(o.value) === String(row.SystemId))?.label || row.SystemId]) : null,
    row.Schlagwort ? el('dt', {}, ['Schlagworte']) : null, row.Schlagwort ? el('dd', {}, [row.Schlagwort]) : null,
    row.KlasseAnto ? el('dt', {}, ['Antolin']) : null, row.KlasseAnto ? el('dd', {}, [row.KlasseAnto]) : null,
  ]);

  return el('div', {}, [
    el('div', { class: 'buchdetail-titel' }, [row.Titel || '']),
    row.Autor ? el('div', { class: 'buchdetail-autor' }, [row.Autor]) : null,

    el('div', { class: 'section-title', style: { marginTop: '0' } }, ['Status']),
    ...statusZeilen,
    el('div', { class: 'row-inline', style: { marginTop: '10px' } }, [
      el('input', { id: 'neues-etikett', type: 'text', placeholder: 'Neues Exemplar: Etikett/Barcode' }),
      el('button', {
        class: 'button small',
        onclick: async (e) => {
          const etikett = document.getElementById('neues-etikett').value.trim();
          if (!etikett) return;
          e.target.disabled = true;
          try { await api.medium.save({ KatalogNi: row.KatalogNi, MedienEtik: etikett }); await neuLaden(); }
          catch (err) { toast(err.message || String(err), 'error'); }
          finally { e.target.disabled = false; }
        },
      }, ['+ Exemplar']),
    ]),

    el('div', { class: 'section-title' }, ['Vormerkungen']),
    vormerkungen.length
      ? el('div', {}, vormerkungen.map((v) =>
          el('div', { class: 'row-inline', style: { marginBottom: '6px' } }, [
            el('span', { class: 'badge' }, [`${v.Nachname}, ${v.Vorname}`]),
            el('span', { class: 'hint' }, [`seit ${fmtDatum(v.VormerkDat)}`]),
            el('button', {
              class: 'icon-button',
              title: 'Vormerkung entfernen',
              onclick: async () => {
                try { await api.vormerkung.loeschen(v.id); await neuLaden(); }
                catch (err) { toast(err.message || String(err), 'error'); }
              },
            }, ['✕']),
          ])
        ))
      : el('p', { class: 'hint' }, ['Keine Vormerkungen.']),
    el('div', { class: 'row-inline', style: { marginBottom: '4px' } }, [
      el('input', { id: 'neue-vormerkung', type: 'text', placeholder: 'Ausweisnummer / Kürzel' }),
      el('button', {
        class: 'button small',
        onclick: async (e) => {
          const kennung = document.getElementById('neue-vormerkung').value.trim();
          if (!kennung) return;
          e.target.disabled = true;
          try {
            const leser = await findLeserByKennung(kennung);
            if (!leser) { toast(`Kein Nutzer für „${kennung}“ gefunden.`, 'error'); return; }
            await api.vormerkung.anlegen({ katalogNi: row.KatalogNi, leserNi: leser.LeserNi });
            await neuLaden();
          } catch (err) {
            toast(err.message || String(err), 'error');
          } finally {
            e.target.disabled = false;
          }
        },
      }, ['+ Vormerken']),
    ]),

    el('div', { class: 'section-title' }, ['Katalogdaten']),
    katalogdaten,
    el('p', { class: 'hint' }, [`Insgesamt ${statistik.gesamt}× ausgeliehen.`]),

    el('div', { class: 'row-inline', style: { marginTop: '14px' } }, [
      el('button', { class: 'button small', onclick: () => openKatalogSheet(row) }, ['Bearbeiten']),
      exemplare.length ? el('button', { class: 'button small ghost', title: 'Ein Etikett je Exemplar dieses Titels', onclick: () => druckeEtiketten(exemplare.map((m) => etikettAusExemplar(m, row))) }, ['🏷️ Alle Etiketten drucken']) : null,
    ]),
  ]);
}

/* ------------------------------------------------------- Etiketten-Ansicht */

// KatalogNi -> { row, exemplare } der aktuell in der Etiketten-Ansicht
// angezeigten Treffer, damit Ankreuzen ohne erneuten Serverzugriff auskommt.
const etikettenTreffer = new Map();

function wireEtiketten() {
  document.getElementById('etiketten-suche').addEventListener('input', debounce(sucheEtiketten, 200));
  document.getElementById('etiketten-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#etiketten-tbody input[type="checkbox"]')) cb.checked = e.target.checked;
    aktualisiereEtikettenAuswahlInfo();
  });
  document.getElementById('etiketten-drucken').addEventListener('click', async () => {
    const ausgewaehlt = [...document.querySelectorAll('#etiketten-tbody input[type="checkbox"]:checked')].map((cb) => Number(cb.dataset.katalogNi));
    const labels = [];
    for (const katalogNi of ausgewaehlt) {
      const treffer = etikettenTreffer.get(katalogNi);
      if (!treffer) continue;
      for (const m of treffer.exemplare) labels.push(etikettAusExemplar(m, treffer.row));
    }
    if (!labels.length) { toast('Bitte mindestens einen Titel mit Exemplar auswählen.', 'error'); return; }
    const format = document.getElementById('etiketten-format').value;
    const start = document.getElementById('etiketten-start').value;
    await druckeEtiketten(labels, format, start);
  });
}

async function sucheEtiketten() {
  const query = document.getElementById('etiketten-suche').value.trim();
  const tbody = document.getElementById('etiketten-tbody');
  tbody.replaceChildren();
  etikettenTreffer.clear();
  document.getElementById('etiketten-alle').checked = false;
  if (!query) { aktualisiereEtikettenAuswahlInfo(); return; }

  const { rows, gesamt } = await api.katalog.search({ query }, { proSeite: 100 });
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 4 }, [el('div', { class: 'empty small' }, ['Keine Titel gefunden.'])])]));
    aktualisiereEtikettenAuswahlInfo();
    return;
  }
  if (gesamt > rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 4 }, [el('div', { class: 'hint' }, [`Zeigt die ersten ${rows.length} von ${gesamt} Treffern – bitte die Suche eingrenzen, um weitere zu sehen.`])])]));
  }
  // Exemplare aller Treffer parallel nachladen – für die Anzahl in der Liste
  // UND damit "Etiketten drucken" ohne weiteren Serverzugriff auskommt.
  const exemplareJeTitel = await Promise.all(rows.map((r) => api.katalog.exemplare(r.KatalogNi)));
  rows.forEach((row, i) => etikettenTreffer.set(row.KatalogNi, { row, exemplare: exemplareJeTitel[i] }));

  for (const row of rows) {
    const anzahl = etikettenTreffer.get(row.KatalogNi).exemplare.length;
    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [el('input', { type: 'checkbox', 'data-katalog-ni': row.KatalogNi, onchange: aktualisiereEtikettenAuswahlInfo })]),
        el('td', {}, [row.Titel || '']),
        el('td', {}, [row.Autor || '']),
        el('td', {}, [String(anzahl)]),
      ])
    );
  }
  aktualisiereEtikettenAuswahlInfo();
}

function aktualisiereEtikettenAuswahlInfo() {
  const checked = [...document.querySelectorAll('#etiketten-tbody input[type="checkbox"]:checked')].map((cb) => Number(cb.dataset.katalogNi));
  const anzahlEtiketten = checked.reduce((sum, ni) => sum + (etikettenTreffer.get(ni)?.exemplare.length || 0), 0);
  const info = document.getElementById('etiketten-auswahl-info');
  info.textContent = checked.length ? `${checked.length} Titel ausgewählt – ${anzahlEtiketten} Etikett${anzahlEtiketten === 1 ? '' : 'en'}` : '';
}

/* ---------------------------------------------------------------- Leser */

const LESER_FILTER_FELDER = [
  feldChip('leser-suche', 'Suche', { anzeige: (n) => `„${n.value}“`, neuLaden: () => beiLeserFilterAenderung() }),
  feldChip('leser-filter-klasse', 'Klasse', { neuLaden: () => beiLeserFilterAenderung() }),
  feldChip('leser-filter-status', 'Status', { neuLaden: () => beiLeserFilterAenderung() }),
  feldChip('leser-filter-gruppe', 'Gruppe', { neuLaden: () => beiLeserFilterAenderung() }),
  feldChip('leser-filter-zweig', 'Zweig', { neuLaden: () => beiLeserFilterAenderung() }),
  feldChip('leser-filter-ausleihen', 'Ausleihen', { neuLaden: () => beiLeserFilterAenderung() }),
];

function beiLeserFilterAenderung() {
  state.leserSeite = 1;
  loadLeser();
}

function wireLeser() {
  document.getElementById('leser-suche').addEventListener('input', debounce(beiLeserFilterAenderung, 200));
  for (const id of ['leser-filter-klasse', 'leser-filter-status', 'leser-filter-gruppe', 'leser-filter-zweig', 'leser-filter-ausleihen']) {
    document.getElementById(id).addEventListener('change', beiLeserFilterAenderung);
  }
  wireFilterReset('leser-filter-reset', LESER_FILTER_FELDER, beiLeserFilterAenderung);
  document.getElementById('leser-pro-seite').addEventListener('change', beiLeserFilterAenderung);
  document.getElementById('leser-seite-zurueck').addEventListener('click', () => { state.leserSeite = Math.max(1, state.leserSeite - 1); loadLeser(); });
  document.getElementById('leser-seite-vor').addEventListener('click', () => { state.leserSeite += 1; loadLeser(); });
  document.getElementById('leser-neu').addEventListener('click', () => openLeserSheet(null));
  document.getElementById('leser-csv').addEventListener('click', () => leserExport('csv'));
  document.getElementById('leser-xlsx').addEventListener('click', () => leserExport('xlsx'));
}

/**
 * Aktueller Filter als Objekt für repo.searchLeser – von Anzeige UND Export
 * gleich genutzt. `ueberfaelligSet` (LeserNi mit Rückstand) wird von
 * loadLeser() ohnehin für die rote Markierung geladen und hier nur
 * durchgereicht, statt ein zweites Mal abgefragt zu werden.
 */
function leserAktuellerFilter(ueberfaelligSet) {
  const status = document.getElementById('leser-filter-status').value;
  const filter = {
    query: document.getElementById('leser-suche').value.trim(),
    leserGruNi: document.getElementById('leser-filter-gruppe').value,
    zweigId: document.getElementById('leser-filter-zweig').value,
    jahrgang: document.getElementById('leser-filter-klasse').value,
    aktiveAusleihen: document.getElementById('leser-filter-ausleihen').value,
  };
  if (status === 'gesperrt' || status === 'aktiv') filter.gesperrt = status;
  // "Mit Rückstand" hängt an der ferienbewussten Fälligkeitsberechnung
  // (siehe repo.js) und wird deshalb nicht zweimal in SQL nachgebaut.
  else if (status === 'rueckstand') filter.leserNiIn = [...ueberfaelligSet];
  return filter;
}

async function loadLeser() {
  // Für die rote Markierung überfälliger Nutzer wird die Liste ohnehin
  // gebraucht, unabhängig vom aktuellen Statusfilter.
  const ueberfaellig = await api.ausleihe.ueberfaelligeAlle();
  const ueberfaelligSet = new Set(ueberfaellig.map((r) => r.LeserNi));

  const filter = leserAktuellerFilter(ueberfaelligSet);
  const proSeiteWert = document.getElementById('leser-pro-seite').value;
  const { rows, gesamt, seite, proSeite } = await api.leser.search(filter, {
    seite: state.leserSeite,
    proSeite: proSeiteWert === 'alle' ? 'alle' : Number(proSeiteWert),
  });
  state.leserSeite = seite;
  renderFilterChips('leser-filter-chips', LESER_FILTER_FELDER);

  const tbody = document.getElementById('leser-tbody');
  tbody.replaceChildren();
  aktualisierePaginierung('leser', { seite, proSeite, gesamt, anzahlAngezeigt: rows.length });
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['🧑‍🎓']), 'Keine Nutzer gefunden.'])])]));
    return;
  }
  for (const row of rows) {
    tbody.appendChild(
      el('tr', { class: ueberfaelligSet.has(row.LeserNi) ? 'row-overdue' : '', onclick: () => openLeserSheet(row) }, [
        el('td', {}, [`${row.Nachname || ''}, ${row.Vorname || ''}`]),
        el('td', {}, [row.Kuerzel || '']),
        el('td', {}, [row.Jahrgang || '']),
        el('td', {}, [row.emailPriv || '']),
        el('td', { class: 'num' }, [String(row.offeneAusleihen || 0)]),
      ])
    );
  }
}

const LESER_EXPORT_SPALTEN = [
  { schluessel: 'Name', titel: 'Name' },
  { schluessel: 'Kuerzel', titel: 'Kürzel' },
  { schluessel: 'Klasse', titel: 'Klasse/Jahrgang' },
  { schluessel: 'EMail', titel: 'E-Mail' },
  { schluessel: 'OffeneAusleihen', titel: 'Offene Ausleihen' },
];

async function leserExport(art) {
  const ueberfaellig = await api.ausleihe.ueberfaelligeAlle();
  const filter = leserAktuellerFilter(new Set(ueberfaellig.map((r) => r.LeserNi)));
  const { rows } = await api.leser.search(filter, { proSeite: 'alle' });
  if (!rows.length) { toast('Nichts zu exportieren.', 'error'); return; }
  const zeilen = rows.map((r) => ({
    Name: `${r.Nachname || ''}, ${r.Vorname || ''}`,
    Kuerzel: r.Kuerzel || '',
    Klasse: r.Jahrgang || '',
    EMail: r.emailPriv || '',
    OffeneAusleihen: r.offeneAusleihen || 0,
  }));
  const dateiname = `nutzer_${heutigesDatumISO()}`;
  try {
    const pfad =
      art === 'xlsx'
        ? await api.export.xlsx({ dateiname, blattname: 'Nutzer', spalten: LESER_EXPORT_SPALTEN, zeilen })
        : await api.export.csv({ dateiname, spalten: LESER_EXPORT_SPALTEN, zeilen });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
  }
}

async function openLeserSheet(row) {
  const fields = [
    { name: 'Nachname', label: 'Nachname' },
    { name: 'Vorname', label: 'Vorname' },
    { name: 'AusweisId', label: 'Ausweis-/Barcode-Nummer' },
    { name: 'Kuerzel', label: 'Kürzel' },
    { name: 'Jahrgang', label: 'Jahrgang / Klasse' },
    { name: 'ZweigId', label: 'Zweig', type: 'select', options: zweigOptions() },
    { name: 'LeserGruNi', label: 'Nutzergruppe', type: 'select', options: leserGruppOptions() },
    { name: 'emailPriv', label: 'E-Mail', type: 'email' },
    { name: 'FonPrivat', label: 'Telefon' },
    { name: 'AusleihBis', label: 'Ausleihberechtigt bis', type: 'date' },
    { name: 'Notizen', label: 'Notizen', type: 'textarea' },
  ];

  let historyBox = null;
  if (row?.LeserNi) {
    const [offen, historie, vormerkungen, sperre] = await Promise.all([
      api.leser.offeneAusleihen(row.LeserNi),
      api.leser.mahnhistorie(row.LeserNi),
      api.leser.vormerkungen(row.LeserNi),
      api.leser.gesperrt(row.LeserNi),
    ]);
    const neuLaden = async () => openLeserSheet(await api.leser.get(row.LeserNi));
    const sperreDauer = state.settings.sperreDauerTage || 14;
    const sperreBox = el('div', {}, [
      el('div', { class: 'section-title', style: { marginTop: '0' } }, ['Ausleihsperre']),
      sperre.gesperrt
        ? el('div', { class: 'row-inline', style: { flexWrap: 'wrap' } }, [
            el('span', { class: 'badge danger' }, [sperre.grund || 'gesperrt']),
            el('button', {
              class: 'button small',
              onclick: async () => { await api.leser.entsperren(row.LeserNi); toast('Entsperrt.'); await neuLaden(); },
            }, ['Entsperren']),
          ])
        : el('div', { class: 'row-inline', style: { flexWrap: 'wrap' } }, [
            el('span', { class: 'badge ok' }, ['nicht gesperrt']),
            el('button', {
              class: 'button small',
              title: 'Bleibt gesperrt, bis bewusst entsperrt wird',
              onclick: async () => { await api.leser.sperren(row.LeserNi); toast('Für die Ausleihe gesperrt.'); await neuLaden(); },
            }, ['Sperren']),
            el('button', {
              class: 'button small',
              title: `Läuft nach ${sperreDauer} Tagen von selbst wieder ab (Vorgabe in den Einstellungen änderbar)`,
              onclick: async () => { await api.leser.sperren(row.LeserNi, sperreDauer); toast(`Für ${sperreDauer} Tage gesperrt.`); await neuLaden(); },
            }, [`Für ${sperreDauer} Tage sperren`]),
          ]),
    ]);
    historyBox = el('div', {}, [
      sperreBox,
      offen.length
        ? el('div', {}, [
            el('div', { class: 'section-title' }, ['Offene Ausleihen']),
            ...offen.map((o) => el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${o.Titel} – seit ${fmtDatum(o.AuslDatum)}`])),
          ])
        : null,
      vormerkungen.length
        ? el('div', {}, [
            el('div', { class: 'section-title', style: { marginTop: '18px' } }, ['Vormerkungen']),
            ...vormerkungen.map((v) => el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${v.Titel} – seit ${fmtDatum(v.VormerkDat)}`])),
          ])
        : null,
      historie.length
        ? el('div', {}, [
            el('div', { class: 'section-title', style: { marginTop: '18px' } }, ['Mahnhistorie']),
            ...historie.slice(0, 8).map((h) =>
              el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${fmtDatum(h.Mahndatum)} – ${h.Titel} (${fmtGeld(h.MaGebuehr)})`])
            ),
          ])
        : null,
    ]);
  }

  openSheet({
    title: row ? `${row.Nachname}, ${row.Vorname}` : 'Neuer Nutzer',
    fields,
    values: row || {},
    extra: historyBox,
    onSave: async (values) => {
      const payload = row ? { ...values, LeserNi: row.LeserNi } : values;
      await api.leser.save(payload);
      await loadLeser();
      await refreshKennzahlen();
      toast('Gespeichert.');
    },
    onDelete: row
      ? async () => {
          await api.leser.delete(row.LeserNi);
          await loadLeser();
          await refreshKennzahlen();
          toast('Nutzer gelöscht.');
        }
      : null,
  });
}

/* -------------------------------------------------------------- Ausleihe */

/**
 * Für die Ausleihe/Rückgabe per Scanner: nur ein GENAUER Treffer auf
 * Ausweisnummer oder Kürzel zählt. Vorher fiel diese Funktion mangels
 * exaktem Treffer auf das erste Ergebnis der unscharfen Namenssuche zurück –
 * ein Barcode mit Tippfehler oder ein Kürzel, das zufällig zu einem anderen
 * Namen passt, hätte dadurch stillschweigend einem falschen Kind zugeordnet
 * werden können.
 */
async function findLeserByKennung(text) {
  // Muss die GESAMTE Datenbank durchsuchen, nicht nur eine Seite – deshalb
  // ausdrücklich proSeite:'alle' (unabhängig von der Seitengröße, die die
  // Nutzerliste in der Oberfläche gerade eingestellt hat).
  const { rows } = await api.leser.search({ query: text }, { proSeite: 'alle' });
  return rows.find((r) => r.AusweisId === text || r.Kuerzel === text) || null;
}

/**
 * Vorschlagsliste unter einem Textfeld (Abschnitt 4): ab dem zweiten Zeichen
 * `holeVorschlaege(query)` (entprellt), Pfeiltasten wählen, Enter übernimmt
 * die aktive Zeile (oder fällt auf `onEnter` zurück, wenn keine Zeile aktiv
 * ist – "wer eine gültige Nummer eintippt und Enter drückt, überspringt die
 * Liste wie bisher"), Escape schließt. Ein Klick auf eine Zeile wählt sie
 * ebenfalls. Liefert `{ getAusgewaehlt, reset }`, damit der Aufrufer weiß,
 * ob (und welche) Entität bewusst aus der Liste gewählt wurde, statt sie ein
 * zweites Mal über den Text auflösen zu müssen.
 */
function wireAutocomplete({ inputId, listeId, holeVorschlaege, baueZeile, textFuer, onEnter, maxEintraege = 6 }) {
  const input = document.getElementById(inputId);
  const liste = document.getElementById(listeId);
  let vorschlaege = [];
  let aktiverIndex = -1;
  let ausgewaehlt = null;

  function schliesseListe() {
    liste.replaceChildren();
    liste.hidden = true;
    vorschlaege = [];
    aktiverIndex = -1;
  }

  function markiereAktiv() {
    [...liste.children].forEach((li, i) => li.classList.toggle('aktiv', i === aktiverIndex));
    liste.children[aktiverIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function waehle(eintrag) {
    ausgewaehlt = eintrag;
    input.value = textFuer(eintrag);
    schliesseListe();
  }

  const sucheAusloesen = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { schliesseListe(); return; }
    vorschlaege = (await holeVorschlaege(q)).slice(0, maxEintraege);
    if (!vorschlaege.length) { schliesseListe(); return; }
    aktiverIndex = -1;
    liste.replaceChildren(
      ...vorschlaege.map((eintrag) => {
        const zeile = baueZeile(eintrag);
        zeile.classList.add('suggest-row');
        zeile.addEventListener('mousedown', (e) => { e.preventDefault(); waehle(eintrag); }); // mousedown vor dem blur-Timeout des Feldes
        return zeile;
      })
    );
    liste.hidden = false;
  }, 200);

  input.addEventListener('input', () => {
    ausgewaehlt = null; // Text hat sich geändert – vorherige Auswahl gilt nicht mehr sicher
    sucheAusloesen();
  });
  input.addEventListener('keydown', (e) => {
    if (!liste.hidden && vorschlaege.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); aktiverIndex = Math.min(vorschlaege.length - 1, aktiverIndex + 1); markiereAktiv(); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); aktiverIndex = Math.max(0, aktiverIndex - 1); markiereAktiv(); return; }
      if (e.key === 'Escape') { schliesseListe(); return; }
      if (e.key === 'Enter' && aktiverIndex >= 0) { e.preventDefault(); waehle(vorschlaege[aktiverIndex]); return; }
    }
    if (e.key === 'Enter') onEnter?.();
  });
  input.addEventListener('blur', () => setTimeout(schliesseListe, 150));

  return {
    getAusgewaehlt: () => ausgewaehlt,
    reset: () => { ausgewaehlt = null; schliesseListe(); },
  };
}

let ausleiheBuchAuto = null;
let ausleiheKindAuto = null;

function wireAusleihe() {
  document.getElementById('ausleihe-bestaetigen').addEventListener('click', ausleihenAbschicken);

  ausleiheBuchAuto = wireAutocomplete({
    inputId: 'ausleihe-etikett',
    listeId: 'ausleihe-etikett-vorschlaege',
    holeVorschlaege: (q) => api.medium.vorschlaege(q),
    textFuer: (m) => m.MedienEtik || '',
    onEnter: ausleihenAbschicken,
    baueZeile: (m) =>
      el('li', {}, [
        el('div', { class: 'suggest-main' }, [
          el('div', { class: 'suggest-title' }, [m.Titel || '']),
          el('div', { class: 'suggest-sub' }, [[m.Autor, m.MedienEtik].filter(Boolean).join(' · ')]),
        ]),
        el('span', { class: `badge ${m.verliehen ? 'danger' : 'ok'}` }, [m.verliehen ? 'nicht verfügbar' : 'verfügbar']),
      ]),
  });

  ausleiheKindAuto = wireAutocomplete({
    inputId: 'ausleihe-leser',
    listeId: 'ausleihe-leser-vorschlaege',
    holeVorschlaege: (q) => api.leser.vorschlaege(q),
    textFuer: (l) => `${l.Vorname || ''} ${l.Nachname || ''}`.trim(),
    onEnter: ausleihenAbschicken,
    baueZeile: (l) =>
      el('li', {}, [
        el('span', { class: 'suggest-avatar' }, ['🧑']), // kein Passbild-Upload in INGA – bewusst immer der neutrale Platzhalter statt einer Initialen-Bubble
        el('div', { class: 'suggest-main' }, [
          el('div', { class: 'suggest-title' }, [`${l.Vorname || ''} ${l.Nachname || ''}`.trim()]),
          el('div', { class: 'suggest-sub' }, [[l.Jahrgang, `${l.offeneAusleihen || 0} ausgeliehen`].filter(Boolean).join(' · ')]),
        ]),
      ]),
  });
}

async function ausleihenAbschicken() {
  const status = document.getElementById('ausleihe-status');
  const etikett = document.getElementById('ausleihe-etikett').value.trim();
  const leserText = document.getElementById('ausleihe-leser').value.trim();
  if (!etikett || !leserText) { status.textContent = 'Bitte Buch und Kind angeben.'; return; }

  // Bewusst aus der Vorschlagsliste gewählt? Sonst wie bisher exakt auflösen
  // (Buchnummer/Ausweisnummer/Kürzel) – "wer eine gültige Nummer eintippt und
  // Enter drückt, überspringt die Liste wie bisher".
  const medium = ausleiheBuchAuto?.getAusgewaehlt() || (await api.medium.findByEtikett(etikett));
  if (!medium) { status.textContent = `Kein Buch für „${etikett}“ gefunden.`; return; }
  const leser = ausleiheKindAuto?.getAusgewaehlt() || (await findLeserByKennung(leserText));
  if (!leser) { status.textContent = `Kein Kind für „${leserText}“ gefunden.`; return; }

  const result = await api.ausleihe.ausleihen({ medienNi: medium.MedienNi, leserNi: leser.LeserNi, benutzer: 'inga' });
  if (!result.ok) { status.textContent = result.error; toast(result.error, 'error'); return; }
  const hinweisText = result.hinweise?.length ? ` (${result.hinweise.join(', ')})` : '';
  status.textContent = `Ausgeliehen an ${leser.Nachname}, ${leser.Vorname} – fällig am ${fmtDatum(result.faelligAm)}${hinweisText}.`;
  if (result.vormerkungHinweis) toast(result.vormerkungHinweis, 'error');
  document.getElementById('ausleihe-etikett').value = '';
  document.getElementById('ausleihe-leser').value = '';
  ausleiheBuchAuto?.reset();
  ausleiheKindAuto?.reset();
  document.getElementById('ausleihe-etikett').focus();
  await refreshKennzahlen();
}

/* -------------------------------------------------------------- Rückgabe */

function wireRueckgabe() {
  document.getElementById('rueckgabe-etikett').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter') return;
    const etikett = e.target.value.trim();
    if (!etikett) return;
    const medium = await api.medium.findByEtikett(etikett);
    if (!medium) { toast(`Kein Exemplar mit Etikett „${etikett}“.`, 'error'); return; }
    const status = await api.medium.status(medium.MedienNi);
    if (!status.verliehen) { toast('Dieses Exemplar ist nicht ausgeliehen.', 'error'); return; }
    await api.ausleihe.zurueckgeben(status.ausleihe.id);
    e.target.value = '';
    toast('Zurückgegeben.');
    await loadRueckgabe();
    await refreshKennzahlen();
  });
  document.getElementById('rueckgabe-suche').addEventListener('input', debounce(loadRueckgabe, 200));
  document.getElementById('rueckgabe-nur-ueberfaellig').addEventListener('change', loadRueckgabe);
  for (const id of ['rueckgabe-filter-klasse', 'rueckgabe-filter-verlaengert']) {
    document.getElementById(id).addEventListener('change', loadRueckgabe);
  }
  for (const id of ['rueckgabe-filter-von', 'rueckgabe-filter-bis', 'rueckgabe-filter-tage']) {
    document.getElementById(id).addEventListener('input', debounce(loadRueckgabe, 200));
  }
  wireFilterReset('rueckgabe-filter-reset', RUECKGABE_FILTER_FELDER, loadRueckgabe);
  document.getElementById('rueckgabe-csv').addEventListener('click', () => rueckgabeExport('csv'));
  document.getElementById('rueckgabe-xlsx').addEventListener('click', () => rueckgabeExport('xlsx'));
  document.getElementById('rueckgabe-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#rueckgabe-tbody input[type="checkbox"]')) cb.checked = e.target.checked;
  });
  document.getElementById('rueckgabe-verlaengern-mehrere').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#rueckgabe-tbody input[type="checkbox"]:checked')].map((cb) => Number(cb.dataset.id));
    if (!ids.length) { toast('Nichts ausgewählt.', 'error'); return; }
    let erfolgreich = 0;
    const fehler = [];
    for (const id of ids) {
      const result = await api.ausleihe.verlaengern(id);
      if (result.ok) erfolgreich += 1;
      else fehler.push(result.error);
    }
    toast(
      fehler.length
        ? `${erfolgreich} verlängert, ${fehler.length} nicht möglich (${fehler[0]}).`
        : `${erfolgreich} Ausleihe(n) verlängert.`,
      fehler.length && !erfolgreich ? 'error' : ''
    );
    await loadRueckgabe();
  });
  document.getElementById('rueckgabe-zurueckgeben-mehrere').addEventListener('click', async () => {
    const ids = [...document.querySelectorAll('#rueckgabe-tbody input[type="checkbox"]:checked')].map((cb) => Number(cb.dataset.id));
    if (!ids.length) { toast('Nichts ausgewählt.', 'error'); return; }
    if (!confirm(`${ids.length} Ausleihe(n) wirklich als zurückgegeben verbuchen?`)) return;
    for (const id of ids) await api.ausleihe.zurueckgeben(id);
    toast(`${ids.length} Ausleihe(n) zurückgegeben.`);
    await loadRueckgabe();
    await refreshKennzahlen();
  });
}

const RUECKGABE_FILTER_FELDER = [
  feldChip('rueckgabe-suche', 'Suche', { anzeige: (n) => `„${n.value}“`, neuLaden: loadRueckgabe }),
  checkboxChip('rueckgabe-nur-ueberfaellig', 'Nur überfällige', loadRueckgabe),
  feldChip('rueckgabe-filter-klasse', 'Klasse', { neuLaden: loadRueckgabe }),
  feldChip('rueckgabe-filter-verlaengert', 'Verlängert', { neuLaden: loadRueckgabe }),
  feldChip('rueckgabe-filter-von', 'Ausgeliehen ab', { anzeige: (n) => fmtDatum(n.value), neuLaden: loadRueckgabe }),
  feldChip('rueckgabe-filter-bis', 'Ausgeliehen bis', { anzeige: (n) => fmtDatum(n.value), neuLaden: loadRueckgabe }),
  feldChip('rueckgabe-filter-tage', 'Überfällig ab', { anzeige: (n) => `${n.value} Tagen`, neuLaden: loadRueckgabe }),
];

/** Filtert die (vollständig geladenen, nicht paginierten) offenen Ausleihen anhand der aktuellen Formularwerte – von Anzeige UND Export gleich genutzt. */
function rueckgabeGefiltert(rows, ueberfMap) {
  const suche = document.getElementById('rueckgabe-suche').value.trim().toLowerCase();
  const nurUeberfaellig = document.getElementById('rueckgabe-nur-ueberfaellig').checked;
  const klasse = document.getElementById('rueckgabe-filter-klasse').value;
  const verlaengert = document.getElementById('rueckgabe-filter-verlaengert').value;
  const von = document.getElementById('rueckgabe-filter-von').value;
  const bis = document.getElementById('rueckgabe-filter-bis').value;
  const tageAb = Number(document.getElementById('rueckgabe-filter-tage').value) || 0;

  let gefiltert = rows;
  if (suche) gefiltert = gefiltert.filter((r) => `${r.Titel} ${r.Nachname} ${r.Vorname}`.toLowerCase().includes(suche));
  if (nurUeberfaellig) gefiltert = gefiltert.filter((r) => ueberfMap.has(r.id));
  if (klasse) gefiltert = gefiltert.filter((r) => (r.Jahrgang || '') === klasse);
  if (verlaengert === 'ja') gefiltert = gefiltert.filter((r) => (r.AnzVerl || 0) > 0);
  else if (verlaengert === 'nein') gefiltert = gefiltert.filter((r) => !(r.AnzVerl > 0));
  if (von) gefiltert = gefiltert.filter((r) => String(r.AuslDatum).slice(0, 10) >= von);
  if (bis) gefiltert = gefiltert.filter((r) => String(r.AuslDatum).slice(0, 10) <= bis);
  if (tageAb > 0) gefiltert = gefiltert.filter((r) => (ueberfMap.get(r.id)?.tageUeberfaellig || 0) >= tageAb);
  return gefiltert;
}

async function loadRueckgabe() {
  const [rows, ueberfaellig] = await Promise.all([api.ausleihe.alleOffen(), api.ausleihe.ueberfaelligeAlle()]);
  const ueberfMap = new Map(ueberfaellig.map((r) => [r.id, r]));
  const gefiltert = rueckgabeGefiltert(rows, ueberfMap);
  renderFilterChips('rueckgabe-filter-chips', RUECKGABE_FILTER_FELDER);

  const tbody = document.getElementById('rueckgabe-tbody');
  tbody.replaceChildren();
  document.getElementById('rueckgabe-alle').checked = false;
  if (!gefiltert.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 7 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['✅']), 'Keine offenen Ausleihen.'])])]));
    return;
  }
  for (const row of gefiltert) {
    const ueb = ueberfMap.get(row.id);
    // Grund für eine verschobene Frist (Verlängerung, Fristverschiebung) –
    // ab der Ferienverwaltung kommt hier zusätzlich der Ferien-Hinweis dazu.
    const hinweisText = ueb?.fristHinweise?.length ? ueb.fristHinweise.join(', ') : '';
    tbody.appendChild(
      el('tr', { class: ueb ? 'row-overdue' : '' }, [
        el('td', {}, [el('input', { type: 'checkbox', 'data-id': String(row.id) })]),
        el('td', {}, [`${row.Titel} – ${row.MedienEtik || ''}`]),
        el('td', {}, [`${row.Nachname}, ${row.Vorname}`]),
        el('td', {}, [fmtDatum(row.AuslDatum)]),
        el('td', { title: hinweisText || undefined }, [
          ueb ? el('span', { class: 'badge danger' }, [`${ueb.tageUeberfaellig} Tage überfällig`]) : el('span', { class: 'badge ok' }, ['pünktlich']),
          hinweisText ? el('span', { class: 'hint', style: { marginLeft: '6px' } }, [hinweisText]) : null,
        ]),
        el('td', {}, [String(row.AnzVerl || 0)]),
        el('td', { class: 'actions' }, [
          el('button', {
            class: 'button small',
            onclick: async () => {
              const result = await api.ausleihe.verlaengern(row.id);
              if (!result.ok) { toast(result.error, 'error'); return; }
              await loadRueckgabe();
              toast(`Verlängert bis ${fmtDatum(result.faelligAm)}.`);
            },
          }, ['Verlängern']),
          ' ',
          el('button', { class: 'button small primary', onclick: async () => { await api.ausleihe.zurueckgeben(row.id); await loadRueckgabe(); await refreshKennzahlen(); toast('Zurückgegeben.'); } }, ['Zurückgeben']),
        ]),
      ])
    );
  }
}

const RUECKGABE_EXPORT_SPALTEN = [
  { schluessel: 'Titel', titel: 'Titel' },
  { schluessel: 'Nutzer', titel: 'Nutzer' },
  { schluessel: 'Klasse', titel: 'Klasse' },
  { schluessel: 'AuslDatumFmt', titel: 'Ausgeliehen am' },
  { schluessel: 'FaelligFmt', titel: 'Fällig am' },
  { schluessel: 'TageUeberfaellig', titel: 'Tage überfällig' },
  { schluessel: 'AnzVerl', titel: 'Verlängerungen' },
];

/** Exportiert genau die aktuell gefilterte Liste (dieselbe Funktion wie die Anzeige) – "der Filter gilt auch für den Export". */
async function rueckgabeExport(art) {
  const [rows, ueberfaellig] = await Promise.all([api.ausleihe.alleOffen(), api.ausleihe.ueberfaelligeAlle()]);
  const ueberfMap = new Map(ueberfaellig.map((r) => [r.id, r]));
  const gefiltert = rueckgabeGefiltert(rows, ueberfMap);
  if (!gefiltert.length) { toast('Nichts zu exportieren.', 'error'); return; }
  const zeilen = gefiltert.map((r) => {
    const ueb = ueberfMap.get(r.id);
    return {
      Titel: `${r.Titel} – ${r.MedienEtik || ''}`,
      Nutzer: `${r.Nachname}, ${r.Vorname}`,
      Klasse: r.Jahrgang || '',
      AuslDatumFmt: fmtDatum(r.AuslDatum),
      FaelligFmt: ueb ? fmtDatum(ueb.faelligAm) : '',
      TageUeberfaellig: ueb?.tageUeberfaellig || 0,
      AnzVerl: r.AnzVerl || 0,
    };
  });
  const dateiname = `rueckgabe_${heutigesDatumISO()}`;
  try {
    const pfad =
      art === 'xlsx'
        ? await api.export.xlsx({ dateiname, blattname: 'Rückgabe', spalten: RUECKGABE_EXPORT_SPALTEN, zeilen })
        : await api.export.csv({ dateiname, spalten: RUECKGABE_EXPORT_SPALTEN, zeilen });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
  }
}

/* ------------------------------------------------------------- Mahnungen */

// Zuletzt geladene Rückstandsliste (repo.rueckstandsliste) – Suche/Klassen-
// filter/Sortierung rendern daraus nur neu, ohne bei jeder Änderung neu zu
// laden (nur die Schwelle selbst löst einen neuen IPC-Aufruf aus).
let mahnDaten = [];

// Je Fall (Ausleihe-id) von der Kollegin übersteuerte "Mahnung?"-Checkbox
// (Erinnerung/Mahnung-Vorschlag, Abschnitt 5.2/5.1) – renderMahnungenAktuell
// baut die Tabelle bei jeder Suche/Filter-/Sortierungsänderung und bei jedem
// "settings:updated" komplett neu aus mahnDaten; ohne diese Zuordnung würde
// dabei die Checkbox stumm wieder auf den Vorschlag (row.stufeIndex)
// zurückfallen und eine schon getroffene Entscheidung der Kollegin verloren
// gehen, bevor sie "Erinnerung erstellen"/"Mahnung erstellen" anwendet.
const mahnStufeUeberschreibung = new Map();

/** Stufen sind nur nach ihrer Position (nicht nach Namen) eindeutig – für den Stufen-Editor in den Einstellungen (renderMahnstufen). */
function badgeKlasseFuerStufenIndex(index, anzahlStufen) {
  if (index >= anzahlStufen - 1) return 'danger';
  if (index >= 1) return 'warn';
  return '';
}

function wireMahnungen() {
  document.getElementById('mahn-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#mahnungen-tbody input[type="checkbox"][data-payload]')) cb.checked = e.target.checked;
  });
  document.getElementById('mahnungen-suche').addEventListener('input', debounce(renderMahnungenAktuell, 200));
  document.getElementById('mahnungen-filter-klasse').addEventListener('change', renderMahnungenAktuell);
  document.getElementById('mahnungen-sortierung').addEventListener('change', renderMahnungenAktuell);
  document.getElementById('mahn-schwelle').addEventListener('input', debounce(loadMahnungen, 300));
  document.getElementById('mahnungen-im-umlauf').addEventListener('click', () => showView('umlauf'));

  document.getElementById('mahnungen-erinnerung-erstellen').addEventListener('click', () => mahnungenVorbereiten(0));
  document.getElementById('mahnungen-mahnung-erstellen').addEventListener('click', () => mahnungenVorbereiten(1));

  document.getElementById('mahnung-vorschau-close').addEventListener('click', schliesseMahnungVorschau);
  document.getElementById('mahnung-vorschau-abbrechen').addEventListener('click', schliesseMahnungVorschau);
  document.getElementById('mahnung-vorschau-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'mahnung-vorschau-backdrop') schliesseMahnungVorschau();
  });
}

async function loadMahnungen() {
  const schwelle = Number(document.getElementById('mahn-schwelle').value) || 0;
  mahnDaten = await api.mahnung.rueckstandsliste(schwelle);
  renderMahnungenAktuell();
}

/** Klassen-Dropdown aus den tatsächlich betroffenen Klassen befüllen (Jahrgang ist ein Freitextfeld, kein Stammdatum). */
function fuelleMahnungenKlassenFilter() {
  const sel = document.getElementById('mahnungen-filter-klasse');
  const bisher = sel.value;
  const klassen = [...new Set(mahnDaten.map((r) => r.Jahrgang).filter(Boolean))].sort();
  sel.replaceChildren(el('option', { value: '' }, ['Alle Klassen']), ...klassen.map((k) => el('option', { value: k }, [k])));
  sel.value = bisher;
}

/** Zeile als Mahnung markiert (Checkbox rechts) oder – falls noch nicht angefasst – der automatische Vorschlag nach den Mahnstufen-Schwellen. Von Zeilen-Rendering UND Sortierung gleich genutzt. */
function istAlsMahnungMarkiert(row) {
  return mahnStufeUeberschreibung.has(row.id) ? mahnStufeUeberschreibung.get(row.id) : row.stufeIndex === 1;
}

const MAHN_SORTIERUNG = {
  tage: (a, b) => b.tageUeberfaellig - a.tageUeberfaellig,
  name: (a, b) => `${a.Nachname},${a.Vorname}`.localeCompare(`${b.Nachname},${b.Vorname}`) || b.tageUeberfaellig - a.tageUeberfaellig,
  klasse: (a, b) => (a.Jahrgang || '').localeCompare(b.Jahrgang || '') || `${a.Nachname},${a.Vorname}`.localeCompare(`${b.Nachname},${b.Vorname}`),
  // "Vorsortiert als Mahnung/Erinnerung": beide Gruppen jeweils für sich
  // beieinander (Mahnung-Gruppe zuerst, da dringlicher), innerhalb einer
  // Gruppe wie gewohnt nach Tagen überfällig.
  einstufung: (a, b) => {
    const am = istAlsMahnungMarkiert(a);
    const bm = istAlsMahnungMarkiert(b);
    if (am !== bm) return am ? -1 : 1;
    return b.tageUeberfaellig - a.tageUeberfaellig;
  },
};

/** Rendert Suche/Klassenfilter/Sortierung aus der zuletzt geladenen Rückstandsliste neu – ein Eintrag pro überfälligem Buch, mehrere Bücher desselben Kindes stehen untereinander. */
function renderMahnungenAktuell() {
  fuelleMahnungenKlassenFilter();
  const suche = document.getElementById('mahnungen-suche').value.trim().toLowerCase();
  const klasseFilter = document.getElementById('mahnungen-filter-klasse').value;
  const sortierung = document.getElementById('mahnungen-sortierung').value;

  let gefiltert = mahnDaten;
  if (suche) gefiltert = gefiltert.filter((r) => `${r.Titel} ${r.Nachname} ${r.Vorname}`.toLowerCase().includes(suche));
  if (klasseFilter) gefiltert = gefiltert.filter((r) => r.Jahrgang === klasseFilter);
  gefiltert = [...gefiltert].sort(MAHN_SORTIERUNG[sortierung] || MAHN_SORTIERUNG.tage);

  const anzahlKinder = new Set(gefiltert.map((r) => r.LeserNi)).size;
  document.getElementById('mahn-zusammenfassung').textContent = gefiltert.length
    ? `${anzahlKinder} Kind${anzahlKinder === 1 ? '' : 'er'}, ${gefiltert.length} Buch${gefiltert.length === 1 ? '' : 'bücher'}`
    : '';

  const tbody = document.getElementById('mahnungen-tbody');
  tbody.replaceChildren();
  document.getElementById('mahn-alle').checked = false;
  if (!gefiltert.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 7 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['✉️']), 'Keine Rückstände über der eingestellten Schwelle.'])])]));
    return;
  }
  for (const row of gefiltert) {
    const zuletzt = row.letzteMahnung
      ? `${row.letzteMahnung.stufeIndex === 0 ? 'Erinnerung' : 'Mahnung'} am ${fmtDatum(row.letzteMahnung.datum)}`
      : '–';
    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [el('input', { type: 'checkbox', 'data-payload': JSON.stringify(row) })]),
        el('td', {}, [`${row.Vorname} ${row.Nachname}`]),
        el('td', {}, [row.Jahrgang || '']),
        el('td', {}, [row.Titel]),
        el('td', { class: 'num' }, [String(row.tageUeberfaellig)]),
        el('td', { class: 'hint' }, [zuletzt]),
        el('td', {}, [
          el('label', { class: 'checkbox-label', title: 'Angehakt: als Mahnung behandeln. Nicht angehakt: als Erinnerung. Vorbelegt nach der Schwelle in den Einstellungen, hier je Fall änderbar.' }, [
            el('input', {
              type: 'checkbox',
              'data-stufe-fuer-id': String(row.id),
              checked: istAlsMahnungMarkiert(row),
              // Neu rendern, nicht nur den Wert merken: bei "Sortieren:
              // Mahnung/Erinnerung" hängt die Gruppierung genau an dieser
              // Markierung – sonst bliebe eine umgestellte Zeile bis zum
              // nächsten Such-/Filterwechsel optisch in der falschen Gruppe.
              onchange: (e) => { mahnStufeUeberschreibung.set(row.id, e.target.checked); renderMahnungenAktuell(); },
            }),
            ' Mahnung',
          ]),
        ]),
      ])
    );
  }
}

/** Baut je Kind EIN Schreiben aus mehreren Positionen (dieselbe Gruppierung wie main.js/mahnung:erzeugen-und-drucken) – für die Vorschau vor dem Drucken. */
function baueMahnBriefeVorschau(positionen, stufeIndex) {
  const stufe = state.settings.mahnstufen[stufeIndex] || {};
  const nachLeser = new Map();
  for (const p of positionen) {
    if (!nachLeser.has(p.LeserNi)) nachLeser.set(p.LeserNi, { Nachname: p.Nachname, Vorname: p.Vorname, posten: [] });
    nachLeser.get(p.LeserNi).posten.push(p);
  }
  return [...nachLeser.values()].map((brief) => {
    const tageMax = Math.max(...brief.posten.map((p) => p.tageUeberfaellig || 0));
    const faelligMin = brief.posten.map((p) => p.faelligAm).sort()[0];
    const summe = brief.posten.reduce((sum, p) => sum + Number(p.gebuehr || 0), 0);
    const werte = {
      Vorname: brief.Vorname,
      Nachname: brief.Nachname,
      Titel: brief.posten.map((p) => p.Titel).join(', '),
      Tage: String(tageMax),
      Gebuehr: fmtGeld(summe),
      Datum: fmtDatum(heutigesDatumISO()),
      Faellig: fmtDatum(faelligMin),
      Stufe: stufe.text || '',
      Bibliothek: state.settings.bibliotheksName || 'die Bücherei',
    };
    return {
      ...brief,
      betreff: fuellePlatzhalter(state.settings.mahnBetreffVorlage || '', werte) || stufe.text || '',
      text: fuellePlatzhalter(stufe.briefText || '', werte),
    };
  });
}

/**
 * Nimmt von den links angehakten Zeilen nur die, deren rechte "Mahnung?"-
 * Checkbox zur gewünschten Stufe passt – so kann eine gemischte Auswahl
 * (manche als Erinnerung, andere als Mahnung markiert) in einem Durchgang
 * per "Alle auswählen" + beide Knöpfe nacheinander abgearbeitet werden,
 * statt die Auswahl von Hand in zwei Durchgänge aufteilen zu müssen.
 */
function mahnungenVorbereiten(stufeIndex) {
  const checked = [...document.querySelectorAll('#mahnungen-tbody input[type="checkbox"][data-payload]:checked')];
  if (!checked.length) { toast('Nichts ausgewählt.', 'error'); return; }
  const passend = checked.filter((cb) => {
    const payload = JSON.parse(cb.dataset.payload);
    const stufeCb = document.querySelector(`#mahnungen-tbody input[type="checkbox"][data-stufe-fuer-id="${payload.id}"]`);
    const alsMahnung = Boolean(stufeCb?.checked);
    return alsMahnung === (stufeIndex === 1);
  });
  if (!passend.length) {
    toast(`Von der Auswahl ist keine als „${stufeIndex === 1 ? 'Mahnung' : 'Erinnerung'}“ markiert.`, 'error');
    return;
  }
  const positionen = passend.map((cb) => JSON.parse(cb.dataset.payload));
  zeigeMahnungVorschau(positionen, stufeIndex);
}

/** Vorschau vor dem Erstellen: Anzahl der Schreiben + fertiger Text des ersten Falls – erst nach Bestätigung wird tatsächlich gedruckt/gespeichert (Abschnitt 5.2). */
function zeigeMahnungVorschau(positionen, stufeIndex) {
  const stufe = state.settings.mahnstufen[stufeIndex] || {};
  const briefe = baueMahnBriefeVorschau(positionen, stufeIndex);
  document.getElementById('mahnung-vorschau-titel').textContent = `${stufe.text || 'Schreiben'} erstellen`;
  document.getElementById('mahnung-vorschau-anzahl').textContent = `${briefe.length} Schreiben ${briefe.length === 1 ? 'wird' : 'werden'} erstellt.`;
  const erster = briefe[0];
  document.getElementById('mahnung-vorschau-text').textContent = erster ? `${erster.betreff}\n\n${erster.text}` : '';
  document.getElementById('mahnung-vorschau-backdrop').hidden = false;
  document.getElementById('mahnung-vorschau-weiter').onclick = async () => {
    schliesseMahnungVorschau();
    const result = await api.mahnung.erzeugenUndDrucken(positionen, stufeIndex);
    toast(`${result.anzahl} Schreiben erzeugt.`);
    await loadMahnungen();
    await refreshKennzahlen();
  };
}

function schliesseMahnungVorschau() {
  document.getElementById('mahnung-vorschau-backdrop').hidden = true;
}

/* ----------------------------------------------------------- Im Umlauf */

/** Für Export (CSV/XLSX) UND Druckvorschau identisch – Spaltenreihenfolge/-titel an einer Stelle. */
const UMLAUF_SPALTEN = [
  { schluessel: 'Titel', titel: 'Buchtitel' },
  { schluessel: 'Autor', titel: 'Autor' },
  { schluessel: 'MedienEtik', titel: 'Signatur/Barcode' },
  { schluessel: 'Kind', titel: 'Kind' },
  { schluessel: 'Jahrgang', titel: 'Klasse' },
  { schluessel: 'AuslDatumFmt', titel: 'Ausgeliehen am' },
  { schluessel: 'faelligAmFmt', titel: 'Rückgabe bis' },
  { schluessel: 'tageUeberfaellig', titel: 'Tage überfällig' },
  { schluessel: 'AnzVerl', titel: 'Verlängerungen' },
];

let umlaufDaten = [];

function wireUmlauf() {
  document.getElementById('umlauf-suche').addEventListener('input', debounce(renderUmlaufAktuell, 200));
  document.getElementById('umlauf-gruppierung').addEventListener('change', renderUmlaufAktuell);
  document.getElementById('umlauf-sortierung').addEventListener('change', renderUmlaufAktuell);
  document.getElementById('umlauf-csv').addEventListener('click', () => umlaufExport('csv'));
  document.getElementById('umlauf-xlsx').addEventListener('click', () => umlaufExport('xlsx'));
  document.getElementById('umlauf-drucken').addEventListener('click', umlaufDrucken);
  document.getElementById('mahnungen-im-umlauf').addEventListener('click', () => showView('umlauf'));
}

async function loadUmlauf() {
  umlaufDaten = await api.ausleihe.umlaufliste();
  renderUmlaufAktuell();
}

function umlaufGefiltert() {
  const suche = document.getElementById('umlauf-suche').value.trim().toLowerCase();
  if (!suche) return umlaufDaten;
  return umlaufDaten.filter((z) => `${z.Titel} ${z.Autor} ${z.Nachname} ${z.Vorname} ${z.MedienEtik}`.toLowerCase().includes(suche));
}

const UMLAUF_VERGLEICHE = {
  titel: (a, b) => (a.Titel || '').localeCompare(b.Titel || ''),
  kind: (a, b) => `${a.Nachname},${a.Vorname}`.localeCompare(`${b.Nachname},${b.Vorname}`),
  klasse: (a, b) => (a.Jahrgang || '').localeCompare(b.Jahrgang || ''),
  auslDatum: (a, b) => (a.AuslDatum || '').localeCompare(b.AuslDatum || ''),
  ueberfaellig: (a, b) => (b.tageUeberfaellig || 0) - (a.tageUeberfaellig || 0),
};

function umlaufSortiert(zeilen) {
  const modus = document.getElementById('umlauf-sortierung').value;
  return [...zeilen].sort(UMLAUF_VERGLEICHE[modus] || UMLAUF_VERGLEICHE.titel);
}

/** Ohne Gruppierung eine einzige namenlose Gruppe – so behandeln Druck/Export/Anzeige beide Fälle gleich. */
function umlaufGruppiert(zeilen) {
  const modus = document.getElementById('umlauf-gruppierung').value;
  if (modus === 'keine') return [{ titel: null, zeilen }];
  const schluesselFn = modus === 'klasse' ? (z) => z.Jahrgang || '(ohne Klasse)' : (z) => `${z.Nachname}, ${z.Vorname}`;
  const gruppen = new Map();
  for (const z of zeilen) {
    const schluessel = schluesselFn(z);
    if (!gruppen.has(schluessel)) gruppen.set(schluessel, []);
    gruppen.get(schluessel).push(z);
  }
  return [...gruppen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([titel, zeilen]) => ({ titel, zeilen }));
}

/** Kurzbeschreibung der aktiven Filter/Gruppierung – erscheint als Kopfzeile beim Druck/PDF. */
function umlaufFilterBeschreibung() {
  const teile = [];
  const suche = document.getElementById('umlauf-suche').value.trim();
  if (suche) teile.push(`Suche: „${suche}“`);
  const gruppierung = document.getElementById('umlauf-gruppierung');
  if (gruppierung.value !== 'keine') teile.push(gruppierung.selectedOptions[0].textContent);
  return teile.join(' · ') || 'Alle offenen Ausleihen';
}

function renderUmlaufAktuell() {
  const sortiert = umlaufSortiert(umlaufGefiltert());
  const gruppen = umlaufGruppiert(sortiert);

  document.getElementById('umlauf-treffer').textContent = `${sortiert.length} von ${umlaufDaten.length} offenen Ausleihen`;

  const tbody = document.getElementById('umlauf-tbody');
  tbody.replaceChildren();
  if (!sortiert.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 9 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['🔁']), 'Nichts im Umlauf.'])])]));
    return;
  }
  for (const gruppe of gruppen) {
    if (gruppe.titel) {
      tbody.appendChild(el('tr', { class: 'gruppe-kopf' }, [el('td', { colSpan: 9 }, [`${gruppe.titel} (${gruppe.zeilen.length})`])]));
    }
    for (const z of gruppe.zeilen) {
      tbody.appendChild(
        el('tr', { class: z.tageUeberfaellig > 0 ? 'row-overdue' : '' }, [
          el('td', {}, [z.Titel || '']),
          el('td', {}, [z.Autor || '']),
          el('td', {}, [z.MedienEtik || '']),
          el('td', {}, [`${z.Nachname || ''}, ${z.Vorname || ''}`]),
          el('td', {}, [z.Jahrgang || '']),
          el('td', {}, [fmtDatum(z.AuslDatum)]),
          el('td', { title: z.fristHinweise?.length ? z.fristHinweise.join(', ') : undefined }, [fmtDatum(z.faelligAm)]),
          el('td', { class: 'num' }, [z.tageUeberfaellig > 0 ? String(z.tageUeberfaellig) : '']),
          el('td', { class: 'num' }, [String(z.AnzVerl || 0)]),
        ])
      );
    }
  }
}

/** Dieselbe gefilterte/sortierte/gruppierte Reihenfolge wie die Anzeige – Export/Druck zeigen also immer genau das, was gerade auf dem Bildschirm steht. */
function umlaufFuerExport() {
  const zeilen = [];
  for (const gruppe of umlaufGruppiert(umlaufSortiert(umlaufGefiltert()))) {
    for (const z of gruppe.zeilen) {
      zeilen.push({
        Titel: z.Titel || '',
        Autor: z.Autor || '',
        MedienEtik: z.MedienEtik || '',
        Kind: `${z.Nachname || ''}, ${z.Vorname || ''}`,
        Jahrgang: z.Jahrgang || '',
        AuslDatumFmt: fmtDatum(z.AuslDatum),
        faelligAmFmt: fmtDatum(z.faelligAm),
        tageUeberfaellig: z.tageUeberfaellig || 0,
        AnzVerl: z.AnzVerl || 0,
      });
    }
  }
  return zeilen;
}

async function umlaufExport(art) {
  const zeilen = umlaufFuerExport();
  if (!zeilen.length) { toast('Nichts zu exportieren.', 'error'); return; }
  const dateiname = `im_umlauf_${heutigesDatumISO()}`;
  try {
    const pfad =
      art === 'xlsx'
        ? await api.export.xlsx({ dateiname, blattname: 'Im Umlauf', spalten: UMLAUF_SPALTEN, zeilen })
        : await api.export.csv({ dateiname, spalten: UMLAUF_SPALTEN, zeilen });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  } catch (err) {
    toast(`Export fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
  }
}

async function umlaufDrucken() {
  const gruppen = umlaufGruppiert(umlaufSortiert(umlaufGefiltert()));
  if (!gruppen.some((g) => g.zeilen.length)) { toast('Nichts zu drucken.', 'error'); return; }
  try {
    await api.umlauf.drucken({ titel: 'Im Umlauf – was ist gerade unterwegs?', filterBeschreibung: umlaufFilterBeschreibung(), gruppen });
  } catch (err) {
    toast(`Drucken fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
  }
}

/* ------------------------------------------------------------- Statistik */

function wireStatistik() {
  document.getElementById('statistik-ladenhueter-aktualisieren').addEventListener('click', loadLadenhueter);
  document.getElementById('statistik-ladenhueter-csv').addEventListener('click', async () => {
    const tage = Number(document.getElementById('statistik-ladenhueter-tage').value) || 365;
    const rows = await api.statistik.ladenhueter(tage);
    if (!rows.length) { toast('Nichts zu exportieren.', 'error'); return; }
    const spalten = [
      { schluessel: 'Titel', titel: 'Titel' },
      { schluessel: 'Autor', titel: 'Autor' },
      { schluessel: 'letzteAusleiheFmt', titel: 'Letzte Ausleihe' },
    ];
    const zeilen = rows.map((r) => ({ ...r, letzteAusleiheFmt: r.letzteAusleihe ? fmtDatum(r.letzteAusleihe) : 'nie' }));
    const pfad = await api.export.csv({ dateiname: `ladenhueter_${heutigesDatumISO()}`, spalten, zeilen });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  });
  document.getElementById('statistik-verlust-csv').addEventListener('click', async () => {
    const rows = await api.statistik.verlustliste();
    if (!rows.length) { toast('Nichts zu exportieren.', 'error'); return; }
    const spalten = [
      { schluessel: 'Titel', titel: 'Titel' },
      { schluessel: 'Autor', titel: 'Autor' },
      { schluessel: 'MedienEtik', titel: 'Signatur/Barcode' },
      { schluessel: 'grund', titel: 'Grund' },
    ];
    const pfad = await api.export.csv({ dateiname: `verlustliste_${heutigesDatumISO()}`, spalten, zeilen: rows });
    if (pfad) toast(`Exportiert nach ${pfad}`);
  });
}

async function loadStatistik() {
  const [proMonat, proKlasse, proKategorie] = await Promise.all([
    api.statistik.proMonat(12),
    api.statistik.proKlasse(),
    api.statistik.proKategorie(),
  ]);
  renderStatistikMonat(proMonat);
  renderStatistikTabelle('statistik-klasse-tbody', proKlasse, 'klasse');
  renderStatistikTabelle('statistik-kategorie-tbody', proKategorie, 'kategorie');
  await loadLadenhueter();
  await loadVerlustliste();
}

function renderStatistikMonat(rows) {
  const box = document.getElementById('statistik-monat');
  box.replaceChildren();
  const max = Math.max(1, ...rows.map((r) => r.anzahl));
  const monatsnamen = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
  for (const r of rows) {
    const [jahr, monat] = r.monat.split('-');
    box.appendChild(
      el('div', { class: 'stat-bar-row' }, [
        el('span', { class: 'stat-bar-label' }, [`${monatsnamen[Number(monat) - 1]} ${jahr.slice(2)}`]),
        el('div', { class: 'stat-bar-track' }, [el('div', { class: 'stat-bar-fill', style: { width: `${(r.anzahl / max) * 100}%` } })]),
        el('span', { class: 'stat-bar-wert' }, [String(r.anzahl)]),
      ])
    );
  }
}

function renderStatistikTabelle(tbodyId, rows, schluesselFeld) {
  const tbody = document.getElementById(tbodyId);
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', {}, [el('p', { class: 'hint' }, ['Noch keine Daten.'])])]));
    return;
  }
  for (const r of rows) {
    tbody.appendChild(el('tr', {}, [el('td', {}, [r[schluesselFeld]]), el('td', { class: 'num' }, [String(r.anzahl)])]));
  }
}

async function loadLadenhueter() {
  const tage = Number(document.getElementById('statistik-ladenhueter-tage').value) || 365;
  const rows = await api.statistik.ladenhueter(tage);
  const tbody = document.getElementById('statistik-ladenhueter-tbody');
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 3 }, [el('div', { class: 'empty small' }, ['Keine Ladenhüter gefunden.'])])]));
    return;
  }
  for (const r of rows) {
    tbody.appendChild(
      el('tr', { onclick: () => springeZuBuchDetail(r.KatalogNi) }, [
        el('td', {}, [r.Titel]),
        el('td', {}, [r.Autor || '']),
        el('td', {}, [r.letzteAusleihe ? fmtDatum(r.letzteAusleihe) : 'nie']),
      ])
    );
  }
}

async function loadVerlustliste() {
  const rows = await api.statistik.verlustliste();
  const tbody = document.getElementById('statistik-verlust-tbody');
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 4 }, [el('div', { class: 'empty small' }, ['Keine als nicht verfügbar markierten Exemplare.'])])]));
    return;
  }
  for (const r of rows) {
    tbody.appendChild(
      el('tr', {}, [el('td', {}, [r.Titel]), el('td', {}, [r.Autor || '']), el('td', {}, [r.MedienEtik || '']), el('td', {}, [r.grund || ''])])
    );
  }
}

/* ------------------------------------------------------------- Papierkorb */

async function loadPapierkorb() {
  const [leser, medien] = await Promise.all([api.papierkorb.leserListe(), api.papierkorb.medienListe()]);

  const leserTbody = document.getElementById('papierkorb-leser-tbody');
  leserTbody.replaceChildren();
  if (!leser.length) {
    leserTbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty small' }, ['Papierkorb ist leer.'])])]));
  }
  for (const r of leser) {
    leserTbody.appendChild(
      el('tr', {}, [
        el('td', {}, [`${r.Nachname}, ${r.Vorname}`]),
        el('td', {}, [r.Jahrgang || '']),
        el('td', {}, [fmtDatum(r.LoeschDat)]),
        el('td', {}, [r.LoeschAnw || '']),
        el('td', {}, [
          el('div', { class: 'row-inline' }, [
            el('button', {
              class: 'button small ghost',
              onclick: async () => {
                try { await api.papierkorb.leserWiederherstellen(r.id); toast('Wiederhergestellt.'); await loadPapierkorb(); await refreshKennzahlen(); }
                catch (err) { toast(err.message || String(err), 'error'); }
              },
            }, ['Wiederherstellen']),
            el('button', {
              class: 'button small ghost danger',
              onclick: async () => {
                if (!confirm(`„${r.Nachname}, ${r.Vorname}“ endgültig aus dem Papierkorb entfernen? Das lässt sich nicht rückgängig machen.`)) return;
                await api.papierkorb.leserEndgueltigLoeschen(r.id);
                await loadPapierkorb();
              },
            }, ['Endgültig löschen']),
          ]),
        ]),
      ])
    );
  }

  const medienTbody = document.getElementById('papierkorb-medien-tbody');
  medienTbody.replaceChildren();
  if (!medien.length) {
    medienTbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty small' }, ['Papierkorb ist leer.'])])]));
  }
  for (const r of medien) {
    medienTbody.appendChild(
      el('tr', {}, [
        el('td', {}, [r.Titel || '']),
        el('td', {}, [r.Autor || '']),
        el('td', {}, [r.MedienEtik || '']),
        el('td', {}, [fmtDatum(r.LoeschDat)]),
        el('td', {}, [r.LoeschAnw || '']),
        el('td', {}, [
          el('div', { class: 'row-inline' }, [
            el('button', {
              class: 'button small ghost',
              onclick: async () => {
                try { await api.papierkorb.medienWiederherstellen(r.id); toast('Wiederhergestellt.'); await loadPapierkorb(); await refreshKennzahlen(); }
                catch (err) { toast(err.message || String(err), 'error'); }
              },
            }, ['Wiederherstellen']),
            el('button', {
              class: 'button small ghost danger',
              onclick: async () => {
                if (!confirm(`Exemplar „${r.Titel}“ (${r.MedienEtik || 'ohne Etikett'}) endgültig aus dem Papierkorb entfernen? Das lässt sich nicht rückgängig machen.`)) return;
                await api.papierkorb.medienEndgueltigLoeschen(r.id);
                await loadPapierkorb();
              },
            }, ['Endgültig löschen']),
          ]),
        ]),
      ])
    );
  }
}

/* --------------------------------------------------------------- Bestand */

function aktualisiereCoverFortschritt(p) {
  const fill = document.getElementById('cover-progress-fill');
  const statusEl = document.getElementById('cover-download-status');
  if (!fill || !statusEl) return;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  fill.style.width = `${pct}%`;
  statusEl.textContent = `${p.done}/${p.total} geprüft – ${p.gefunden} Cover gefunden, ${p.fehler} ohne Treffer.`;
}

/**
 * Sammel-Cover-Download (Open Library, dann Google Books – siehe
 * cover-quellen.js) – dieselbe Aktion wie der Knopf "Cover herunterladen …"
 * in Import/Export, wiederverwendet für die aktive Nachfrage direkt nach
 * einem Bestandsimport.
 */
async function starteCoverBulkDownload(nurFehlende) {
  const startBtn = document.getElementById('cover-download-start');
  const cancelBtn = document.getElementById('cover-download-abbrechen');
  const statusEl = document.getElementById('cover-download-status');
  const track = document.getElementById('cover-progress-track');
  const fill = document.getElementById('cover-progress-fill');
  startBtn.disabled = true;
  cancelBtn.hidden = false;
  track.hidden = false;
  fill.style.width = '0%';
  statusEl.textContent = 'Starte Download …';
  const result = await api.cover.fetchAll({ nurFehlende });
  startBtn.disabled = false;
  cancelBtn.hidden = true;
  statusEl.textContent = `Fertig: ${result.gefunden} Cover geladen, ${result.fehler} ohne Treffer, von ${result.total} geprüften Titeln${result.abgebrochen ? ' (abgebrochen)' : ''}.`;
  toast(`${result.gefunden} Cover heruntergeladen.`);
  return result;
}

function wireBestand() {
  document.getElementById('bestand-import').addEventListener('click', async () => {
    try {
      const result = await api.bestand.importieren();
      if (!result) return;
      toast(`Import abgeschlossen: ${result.kennzahlen.titel} Titel, ${result.kennzahlen.leser} Nutzer.`);
      state.stammdaten = await api.stammdaten.get();
      await fuelleAlleFilter();
      await refreshKennzahlen();
      // Aktiv nachfragen statt stumm zu verlinken – ein frischer Import bringt
      // meist etliche Titel ohne Cover mit. "Nur fehlende" ist hier immer
      // richtig: gerade importierte Titel haben ohnehin noch keins.
      if (confirm('Sollen jetzt automatisch Buchcover für die importierten Titel heruntergeladen werden?\n\nVersucht dafür mehrere Quellen nacheinander (Open Library, Google Books) und kann je nach Bestandsgröße einige Minuten dauern.')) {
        await starteCoverBulkDownload(true);
      }
    } catch (err) {
      toast(`Import fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}. Ist die Datei ein gültiges Perpustakaan-Export-Zip?`, 'error');
    }
  });
  document.getElementById('bestand-export').addEventListener('click', async () => {
    try {
      const path = await api.bestand.exportieren();
      if (!path) return;
      toast(`Exportiert nach ${path}`);
    } catch (err) {
      toast(`Export fehlgeschlagen: ${err.message || 'unerwarteter Fehler'}.`, 'error');
    }
  });

  document.getElementById('cover-download-start').addEventListener('click', () => {
    starteCoverBulkDownload(!document.getElementById('cover-alle-neu').checked);
  });
  document.getElementById('cover-download-abbrechen').addEventListener('click', () => api.cover.fetchAllCancel());
}

/* ---------------------------------------------------------- Einstellungen */

/**
 * Sub-Navigation innerhalb der Einstellungen (Ferien/Mahnungen/Aussehen &
 * weitere App-Einstellungen) – dieselbe einfache Zeig-genau-eins-Logik wie
 * showView() für die Hauptansichten, nur eine Ebene tiefer und ohne eigenes
 * Neuladen der Daten (die lädt loadEinstellungen() ohnehin komplett).
 */
function wireEinstellungenNav() {
  for (const item of document.querySelectorAll('.settings-nav-item')) {
    item.addEventListener('click', () => {
      const ziel = item.dataset.einstPane;
      for (const el of document.querySelectorAll('.settings-nav-item')) el.classList.toggle('active', el.dataset.einstPane === ziel);
      for (const pane of document.querySelectorAll('.settings-pane')) pane.hidden = pane.id !== `einst-pane-${ziel}`;
    });
  }
}

function wireEinstellungen() {
  wireEinstellungenNav();
  for (const id of ['set-uiStyle', 'set-theme', 'set-ferienZaehlweise']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  for (const id of [
    'set-fontScale', 'set-bibliotheksName',
    'set-leihfristTage', 'set-maxVerlaengerung', 'set-verlaengerungDauerTage', 'set-leihfristOffsetTage', 'set-ausleihLimit', 'set-sperreDauerTage', 'set-abschlussKlassenstufe',
    'set-mahnGebuehrProTag', 'set-mahnGebuehrMax', 'set-mahnKarenztage',
    'set-absenderName', 'set-absenderAdresse', 'set-absenderEmail', 'set-absenderTelefon',
    'set-mahnBetreffVorlage', 'set-mahnSchluss',
    'set-matrixDomain', 'set-matrixHomeserver', 'set-matrixZugangstoken',
  ]) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  for (const id of ['set-verlaengerungGesperrtBeiVormerkung', 'set-ueberfaelligTageOhneFerien', 'set-matrixAktiv', 'set-uhrAnzeigen']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  document.getElementById('set-mahngebuehrenAktiv').addEventListener('change', (e) => {
    document.getElementById('mahngebuehr-felder').hidden = !e.target.checked;
    speichereEinstellungenFormular();
  });

  document.getElementById('fristverschiebung-anwenden').addEventListener('click', async () => {
    const tage = Number(document.getElementById('fristverschiebung-tage').value) || 0;
    if (!tage) { toast('Bitte eine Anzahl Tage ungleich 0 angeben.', 'error'); return; }
    if (!confirm(`Wirklich das Ausleihdatum aller offenen Ausleihen um ${tage} Tage verschieben? Das lässt sich nicht rückgängig machen.`)) return;
    const result = await api.ausleihe.verschiebenAlle(tage);
    toast(`${result.anzahl} offene Ausleihe(n) verschoben.`);
    await refreshKennzahlen();
  });

  document.getElementById('mahn-logo-hochladen').addEventListener('click', async () => {
    const result = await api.mahnung.logoAuswaehlen();
    if (!result) return;
    if (result.error) { toast(result.error, 'error'); return; }
    state.settings.mahnLogoDataUrl = result.dataUrl;
    zeigeLogoVorschau(result.dataUrl);
    speichereEinstellungenFormular();
  });
  document.getElementById('mahn-logo-entfernen').addEventListener('click', () => {
    state.settings.mahnLogoDataUrl = '';
    zeigeLogoVorschau('');
    speichereEinstellungenFormular();
  });

  wireFerien();
  wireBackup();
  wireElement();
}

/** Element (Matrix): Anmelden tauscht Benutzername/Passwort einmalig gegen ein Zugangstoken, das Passwort selbst wird nirgends gespeichert. */
function wireElement() {
  document.getElementById('matrix-anmelden').addEventListener('click', async () => {
    const benutzername = document.getElementById('matrix-benutzername').value.trim();
    const passwort = document.getElementById('matrix-passwort').value;
    if (!benutzername || !passwort) { toast('Bitte Benutzername und Passwort angeben.', 'error'); return; }
    try {
      state.settings = await api.element.anmelden({ benutzername, passwort });
      document.getElementById('matrix-passwort').value = '';
      document.getElementById('set-matrixZugangstoken').value = state.settings.matrixZugangstoken;
      aktualisiereMatrixStatus();
      toast('Angemeldet.');
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });
  document.getElementById('matrix-verbindung-testen').addEventListener('click', async () => {
    try {
      state.settings = await api.element.verbindungTesten();
      aktualisiereMatrixStatus();
      toast('Verbindung erfolgreich.');
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });
  document.getElementById('matrix-trennen').addEventListener('click', async () => {
    state.settings = await api.element.trennen();
    document.getElementById('set-matrixZugangstoken').value = '';
    aktualisiereMatrixStatus();
    toast('Verbindung getrennt.');
  });
}

function aktualisiereMatrixStatus() {
  const status = document.getElementById('matrix-versender-status');
  status.textContent = state.settings.matrixVersenderId ? `Angemeldet als ${state.settings.matrixVersenderId}` : 'Nicht angemeldet.';
}

function zeigeLogoVorschau(dataUrl) {
  const img = document.getElementById('mahn-logo-preview');
  const removeBtn = document.getElementById('mahn-logo-entfernen');
  if (dataUrl) { img.src = dataUrl; img.hidden = false; removeBtn.hidden = false; }
  else { img.hidden = true; removeBtn.hidden = true; }
}

/** Beispielgebühr für die Vorschau, nach derselben Formel wie repo.berechneMahngebuehr. */
function beispielGebuehr(tageUeberfaellig) {
  const s = state.settings;
  if (!s.mahngebuehrenAktiv) return 0;
  const tageMitGebuehr = Math.max(0, (Number(tageUeberfaellig) || 0) - (Number(s.mahnKarenztage) || 0));
  const betrag = tageMitGebuehr * (Number(s.mahnGebuehrProTag) || 0);
  const max = Number(s.mahnGebuehrMax) || 0;
  return max > 0 ? Math.min(betrag, max) : betrag;
}

/** Setzt {Platzhalter} für die Live-Vorschau einer Mahnstufe mit Beispieldaten – dieselbe Ersetzung wie im tatsächlichen Druck (siehe util.js/fuellePlatzhalter). */
function fuelleVorschauVorlage(vorlage, stufe) {
  const werte = {
    Vorname: 'Anna', Nachname: 'Muster', Titel: 'Beispielbuch',
    Tage: String(stufe.tageUeberfaellig || 0), Gebuehr: fmtGeld(beispielGebuehr(stufe.tageUeberfaellig)),
    Datum: fmtDatum(heutigesDatumISO()), Faellig: fmtDatum(heutigesDatumISO()), Stufe: stufe.text,
    Bibliothek: state.settings.bibliotheksName || 'die Bücherei',
  };
  return fuellePlatzhalter(vorlage, werte);
}

/**
 * Vorgefertigte Brieftexte zur Auswahl im Mahnstufen-Editor – 2 in normaler
 * Anrede (freundlich/formell), 2 in einfacher Sprache (kurze Sätze, aktive
 * Verben, ein Gedanke pro Satz) für Kinder oder Nutzer:innen, denen der
 * Standardtext schwerer verständlich ist. Ersetzen den Brieftext einer
 * Stufe komplett, wenn übernommen – siehe renderMahnstufen().
 */
const MAHN_VORLAGEN = [
  {
    id: 'freundlich',
    label: 'Freundliche Erinnerung',
    text:
      'Liebe/r {Vorname} {Nachname},\n\n' +
      'vielleicht hast du „{Titel}" einfach vergessen: Das Buch ist seit {Tage} Tagen ' +
      'überfällig (fällig war am {Faellig}). Bring es doch bitte bald zurück in die Bücherei – ' +
      'dann können auch andere Kinder es lesen.\n\nDanke dir!',
  },
  {
    id: 'bestimmt',
    label: 'Bestimmt / formell',
    text:
      'Sehr geehrte/r {Vorname} {Nachname},\n\n' +
      'hiermit weisen wir Sie darauf hin, dass „{Titel}" seit {Tage} Tagen überfällig ist ' +
      '(Rückgabetermin war der {Faellig}). Wir bitten um unverzügliche Rückgabe des Mediums ' +
      'an die Bibliothek.\n\nMit freundlichen Grüßen',
  },
  {
    id: 'einfach_kurz',
    label: 'Einfache Sprache – kurz',
    text:
      'Hallo {Vorname}!\n\n' +
      'Du hast das Buch „{Titel}" ausgeliehen.\n' +
      'Der Rückgabe-Termin war am {Faellig}.\n' +
      'Das Buch ist jetzt {Tage} Tage überfällig.\n\n' +
      'Bitte bring das Buch bald zur Bücherei zurück.\nDanke!',
  },
  {
    id: 'einfach_ausfuehrlich',
    label: 'Einfache Sprache – mit Erklärung',
    text:
      'Hallo {Vorname} {Nachname}!\n\n' +
      'Du hast dir das Buch „{Titel}" in der Bücherei ausgeliehen.\n\n' +
      'Jedes Buch hat eine Leih-Frist.\nDas ist der Tag, an dem du das Buch zurückbringen musst.\n' +
      'Deine Leih-Frist war am {Faellig}.\n\n' +
      'Das Buch ist jetzt schon {Tage} Tage überfällig.\nDas bedeutet: Die Zeit ist schon vorbei.\n\n' +
      'Bitte bring das Buch bald zurück in die Bücherei.\nDann können auch andere Kinder das Buch lesen.\n\n' +
      'Hast du Fragen? Dann komm einfach in die Bücherei.\nDanke, dass du das Buch zurückbringst!',
  },
];

function renderMahnstufen() {
  const box = document.getElementById('mahnstufen-liste');
  box.replaceChildren();
  const arr = state.settings.mahnstufen;

  arr.forEach((stufe, i) => {
    const previewBox = el('div', { class: 'mahnstufe-preview', hidden: true }, [fuelleVorschauVorlage(stufe.briefText, stufe)]);
    const previewToggle = el('button', {
      class: 'button small ghost',
      onclick: () => {
        previewBox.hidden = !previewBox.hidden;
        previewToggle.textContent = previewBox.hidden ? 'Vorschau' : 'Vorschau ausblenden';
      },
    }, ['Vorschau']);
    const aktualisierePreview = () => { previewBox.textContent = fuelleVorschauVorlage(stufe.briefText, stufe); };

    const textarea = el('textarea', { rows: 4, value: stufe.briefText || '', oninput: (e) => { stufe.briefText = e.target.value; aktualisierePreview(); }, onchange: () => speichereEinstellungenFormular() });
    const vorlagenAuswahl = el('select', {}, MAHN_VORLAGEN.map((v) => el('option', { value: v.id }, [v.label])));
    const vorlageUebernehmen = el('button', {
      class: 'button small ghost',
      type: 'button',
      title: 'Ersetzt den Brieftext dieser Stufe durch die ausgewählte Vorlage',
      onclick: () => {
        const vorlage = MAHN_VORLAGEN.find((v) => v.id === vorlagenAuswahl.value);
        if (!vorlage) return;
        if (stufe.briefText?.trim() && !confirm('Aktuellen Brieftext durch die Vorlage ersetzen?')) return;
        stufe.briefText = vorlage.text;
        textarea.value = vorlage.text;
        aktualisierePreview();
        speichereEinstellungenFormular();
      },
    }, ['Vorlage übernehmen']);

    box.appendChild(
      el('div', { class: 'mahnstufe-card' }, [
        el('div', { class: 'mahnstufe-head' }, [
          el('span', { class: `badge ${badgeKlasseFuerStufenIndex(i, arr.length)}` }, [i === 0 ? 'Stufe 1' : 'Stufe 2']),
          el('input', { type: 'text', value: stufe.text, title: 'Bezeichnung', class: 'mahnstufe-text', onchange: (e) => { stufe.text = e.target.value; aktualisierePreview(); speichereEinstellungenFormular(); } }),
        ]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [
            el('label', {}, [i === 0 ? 'Ab wie vielen Tagen überfällig als Erinnerung vorschlagen' : 'Ab wie vielen Tagen überfällig als Mahnung vorschlagen']),
            el('input', { type: 'number', value: stufe.tageUeberfaellig, onchange: (e) => { stufe.tageUeberfaellig = Number(e.target.value); aktualisierePreview(); speichereEinstellungenFormular(); } }),
          ]),
        ]),
        el('div', { class: 'field' }, [
          el('div', { class: 'row-inline', style: { justifyContent: 'space-between' } }, [
            el('label', {}, ['Brieftext']),
            el('div', { class: 'row-inline' }, [vorlagenAuswahl, vorlageUebernehmen]),
          ]),
          textarea,
        ]),
        previewToggle,
        previewBox,
      ])
    );
  });
}

async function loadEinstellungen() {
  const s = state.settings;
  document.getElementById('set-uiStyle').value = s.uiStyle;
  document.getElementById('set-theme').value = s.theme;
  document.getElementById('set-fontScale').value = s.fontScale || 100;
  document.getElementById('set-bibliotheksName').value = s.bibliotheksName || '';
  document.getElementById('set-uhrAnzeigen').checked = s.uhrAnzeigen !== false;
  document.getElementById('set-leihfristTage').value = s.leihfristTage;
  document.getElementById('set-maxVerlaengerung').value = s.maxVerlaengerung;
  document.getElementById('set-verlaengerungDauerTage').value = s.verlaengerungDauerTage;
  document.getElementById('set-ausleihLimit').value = s.ausleihLimit || 0;
  document.getElementById('set-sperreDauerTage').value = s.sperreDauerTage || 14;
  document.getElementById('set-abschlussKlassenstufe').value = s.abschlussKlassenstufe ?? '4';
  document.getElementById('set-verlaengerungGesperrtBeiVormerkung').checked = Boolean(s.verlaengerungGesperrtBeiVormerkung);
  document.getElementById('set-leihfristOffsetTage').value = s.leihfristOffsetTage || 0;
  document.getElementById('set-ferienZaehlweise').value = s.ferienZaehlweise || 'kalendertage';
  document.getElementById('set-ueberfaelligTageOhneFerien').checked = Boolean(s.ueberfaelligTageOhneFerien);
  document.getElementById('set-mahngebuehrenAktiv').checked = Boolean(s.mahngebuehrenAktiv);
  document.getElementById('mahngebuehr-felder').hidden = !s.mahngebuehrenAktiv;
  document.getElementById('set-mahnGebuehrProTag').value = s.mahnGebuehrProTag;
  document.getElementById('set-mahnGebuehrMax').value = s.mahnGebuehrMax;
  document.getElementById('set-mahnKarenztage').value = s.mahnKarenztage;
  document.getElementById('set-absenderName').value = s.absenderName || '';
  document.getElementById('set-absenderAdresse').value = s.absenderAdresse || '';
  document.getElementById('set-absenderEmail').value = s.absenderEmail || '';
  document.getElementById('set-absenderTelefon').value = s.absenderTelefon || '';
  document.getElementById('set-mahnBetreffVorlage').value = s.mahnBetreffVorlage || '';
  document.getElementById('set-mahnSchluss').value = s.mahnSchluss || '';
  zeigeLogoVorschau(s.mahnLogoDataUrl || '');
  document.getElementById('set-matrixAktiv').checked = Boolean(s.matrixAktiv);
  document.getElementById('set-matrixDomain').value = s.matrixDomain || '';
  document.getElementById('set-matrixHomeserver').value = s.matrixHomeserver || '';
  document.getElementById('set-matrixZugangstoken').value = s.matrixZugangstoken || '';
  aktualisiereMatrixStatus();
  renderMahnstufen();
  renderMedArtFristen();
  loadFerien();
  loadBackups();
}

/** Abweichende Fristen je Medienart – kleine Liste direkt in den Einstellungen, kein eigener Bereich nötig. */
function renderMedArtFristen() {
  const box = document.getElementById('medart-fristen-liste');
  box.replaceChildren();
  const arten = state.stammdaten.MedArt || [];
  if (!arten.length) {
    box.appendChild(el('p', { class: 'hint' }, ['Keine Medienarten vorhanden (erst nach einem Import).']));
    return;
  }
  for (const art of arten) {
    const speichern = debounce(async () => {
      await api.medart.fristSpeichern({
        medArtKb: art.MedArtKb,
        frist: document.getElementById(`medart-frist-${art.MedArtKb}`).value,
        fristVerl: document.getElementById(`medart-fristverl-${art.MedArtKb}`).value,
      });
      toast(`Frist für „${art.MedArtBz}“ gespeichert.`);
    }, 400);
    box.appendChild(
      el('div', { class: 'field-row', style: { alignItems: 'flex-end' } }, [
        el('div', { class: 'field' }, [el('label', {}, [art.MedArtBz || art.MedArtKb])]),
        el('div', { class: 'field' }, [
          el('label', {}, ['Leihfrist (Tage)']),
          el('input', { id: `medart-frist-${art.MedArtKb}`, type: 'number', min: '0', max: '365', value: art.Frist ?? '', placeholder: 'Vorgabe', onchange: speichern }),
        ]),
        el('div', { class: 'field' }, [
          el('label', {}, ['Verlängerung (Tage)']),
          el('input', { id: `medart-fristverl-${art.MedArtKb}`, type: 'number', min: '0', max: '365', value: art.FristVerl ?? '', placeholder: 'Vorgabe', onchange: speichern }),
        ]),
      ])
    );
  }
}

/* ------------------------------------------------------------- Ferien */

const FERIEN_TYPEN = ['Ferien', 'Feiertag', 'Schließzeit'].map((t) => ({ value: t, label: t }));

// Welche Schuljahre in der Baumansicht gerade aufgeklappt sind – Vorgabe
// beim ersten Laden ist "nur das laufende", danach merkt sich der Zustand,
// was die Kollegin manuell auf-/zugeklappt hat (siehe renderFerienBaum).
let ferienAufgeklappt = null;
// Zuletzt von der IPC geladene (ungefilterte) Gruppen – Auf-/Zuklappen und
// der "Vergangene ausblenden"-Schalter rendern daraus nur neu, ohne jedes Mal
// erneut zu laden (kein Datenbankzugriff für eine reine Anzeigefrage).
let ferienLetzteGruppen = [];

function wireFerien() {
  document.getElementById('ferien-neu').addEventListener('click', () => openFerienSheet(null));

  document.getElementById('ferien-ics-datei').addEventListener('click', async () => {
    const result = await api.ferien.importIcsDatei();
    if (!result) return; // Dialog abgebrochen
    behandleFerienImportErgebnis(result);
  });

  document.getElementById('ferien-ics-url').addEventListener('click', async () => {
    const url = prompt('Adresse (URL) des ICS-Ferienkalenders:');
    if (!url) return;
    const result = await api.ferien.importIcsUrl(url.trim());
    behandleFerienImportErgebnis(result);
  });

  const abrufBtn = document.getElementById('ferien-api-abrufen');
  const abrufStatus = document.getElementById('ferien-abruf-status');
  abrufBtn.addEventListener('click', async () => {
    abrufBtn.disabled = true;
    abrufStatus.textContent = 'Rufe Hamburger Schulferien/Feiertage ab …';
    const result = await api.ferien.apiAbrufen();
    abrufBtn.disabled = false;
    if (!result.ok) {
      abrufStatus.textContent = result.fehler;
      toast('Abruf fehlgeschlagen – ohne Internetverbindung geht das nur manuell oder per ICS-Datei.', 'error');
      return;
    }
    abrufStatus.textContent = `${result.termine.length} Termine von ${result.quelle} gefunden – bitte prüfen.`;
    if (!result.termine.length) { toast('Keine Termine gefunden.', 'error'); return; }
    await openFerienImportPreview(result.termine);
  });

  document.getElementById('ferien-neuberechnen').addEventListener('click', async () => {
    const liste = await api.ausleihe.ferienVorschau();
    renderFerienNeuberechnenErgebnis(liste);
  });

  document.getElementById('ferien-vergangene-ausblenden').addEventListener('change', anzeigeFerienBaumAktualisieren);

  document.getElementById('ferien-import-close').addEventListener('click', closeFerienImportPreview);
  document.getElementById('ferien-import-abbrechen').addEventListener('click', closeFerienImportPreview);
  document.getElementById('ferien-import-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'ferien-import-backdrop') closeFerienImportPreview();
  });
  document.getElementById('ferien-import-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#ferien-import-liste input[type="checkbox"][data-abschnitt]')) cb.checked = e.target.checked;
  });
  document.getElementById('ferien-import-uebernehmen').addEventListener('click', ferienImportUebernehmenAbschicken);
}

async function behandleFerienImportErgebnis(result) {
  if (!result.ok) { toast(result.error, 'error'); return; }
  if (!result.termine.length) { toast('Keine Termine gefunden.', 'error'); return; }
  await openFerienImportPreview(result.termine);
}

async function loadFerien() {
  ferienLetzteGruppen = await api.ferien.listeGruppiert();
  if (!ferienAufgeklappt) ferienAufgeklappt = new Set(ferienLetzteGruppen.filter((g) => g.aktuell).map((g) => g.startJahr));
  anzeigeFerienBaumAktualisieren();
}

/** Rendert aus dem zuletzt geladenen Bestand neu – für Auf-/Zuklappen und den "Vergangene ausblenden"-Schalter, ohne erneut zu laden. */
function anzeigeFerienBaumAktualisieren() {
  const ausblenden = document.getElementById('ferien-vergangene-ausblenden').checked;
  renderFerienBaum(ausblenden ? ferienLetzteGruppen.filter((g) => !g.vergangen) : ferienLetzteGruppen);
}

function ferienTypBadgeKlasse(typ) {
  if (typ === 'Feiertag') return 'warn';
  if (typ === 'Schließzeit') return 'danger';
  return '';
}

/** Ein Abschnitt (bereits zusammenhängende Tage gebündelt, siehe ferien.buendleAbschnitte) als Zeile im Baum. */
function ferienAbschnittRow(a) {
  const zeitraum = a.startdatum === a.enddatum ? fmtDatum(a.startdatum) : `${fmtDatum(a.startdatum)} – ${fmtDatum(a.enddatum)}`;
  const bearbeitbar = a.ids.length === 1;
  const bearbeiten = () => openFerienSheet({ id: a.ids[0], bezeichnung: a.bezeichnung, startdatum: a.startdatum, enddatum: a.enddatum, typ: a.typ });
  return el(
    'div',
    { class: 'ferien-abschnitt-row', onclick: bearbeitbar ? bearbeiten : undefined },
    [
      el('span', { class: `badge ${ferienTypBadgeKlasse(a.typ)}` }, [a.typ]),
      el('span', { class: 'ferien-abschnitt-bez' }, [a.bezeichnung]),
      el('span', { class: 'ferien-abschnitt-zeitraum' }, [zeitraum]),
      el('span', { class: 'ferien-abschnitt-tage' }, [`${a.tage} Tag${a.tage === 1 ? '' : 'e'}`]),
      el('div', { class: 'row-inline' }, [
        bearbeitbar ? el('button', { class: 'button small ghost', onclick: (e) => { e.stopPropagation(); bearbeiten(); } }, ['Bearbeiten']) : null,
        el('button', {
          class: 'button small ghost',
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm(`„${a.bezeichnung}“ (${zeitraum}) wirklich löschen?`)) return;
            try {
              for (const id of a.ids) await api.ferien.loeschen(id);
              await loadFerien();
              toast('Eintrag gelöscht.');
            } catch (err) {
              toast(err.message || String(err), 'error');
            }
          },
        }, ['Löschen']),
      ]),
    ]
  );
}

/**
 * Baumansicht: Schuljahre (neuestes oben), standardmäßig bis auf das
 * laufende zugeklappt, darunter die gebündelten Abschnitte. Ein
 * zusammenhängender Zeitraum ist EIN Abschnitt, keine Zeile pro Kalendertag
 * mehr – auch bei mehrjährigen Importen bleibt die Liste damit überschaubar.
 */
function renderFerienBaum(gruppen) {
  const box = document.getElementById('ferien-baum');
  box.replaceChildren();
  if (!gruppen.length) {
    box.appendChild(el('div', { class: 'empty small' }, ['Noch keine Ferien/Schließzeiten eingetragen.']));
    return;
  }
  for (const g of gruppen) {
    const offen = ferienAufgeklappt.has(g.startJahr);
    const inhalt = el('div', { class: 'ferien-jahr-inhalt', hidden: !offen }, g.abschnitte.map(ferienAbschnittRow));
    const kopf = el(
      'div',
      { class: `ferien-jahr-kopf${offen ? ' offen' : ''}`, onclick: () => { offen ? ferienAufgeklappt.delete(g.startJahr) : ferienAufgeklappt.add(g.startJahr); anzeigeFerienBaumAktualisieren(); } },
      [
        el('span', { class: 'chevron' }, ['▶']),
        el('span', { class: 'ferien-jahr-titel' }, [`Schuljahr ${g.schuljahr}`]),
        g.vergangen ? el('span', { class: 'ferien-jahr-badge' }, ['(vergangen)']) : null,
        el('div', { class: 'spacer' }),
        el('span', { class: 'ferien-jahr-badge' }, [`${g.abschnitte.length} Abschnitt${g.abschnitte.length === 1 ? '' : 'e'}`]),
        el('button', {
          class: 'button small ghost',
          title: `Gesamtes Schuljahr ${g.schuljahr} löschen`,
          onclick: async (e) => {
            e.stopPropagation();
            if (!confirm(`Wirklich ALLE Ferien-/Schließzeiteinträge des Schuljahrs ${g.schuljahr} löschen (${g.abschnitte.length} Abschnitte)?`)) return;
            const result = await api.ferien.schuljahrLoeschen(g.startJahr);
            await loadFerien();
            toast(`Schuljahr ${g.schuljahr} gelöscht (${result.anzahl} Einträge).`);
          },
        }, ['Schuljahr löschen']),
      ]
    );
    box.appendChild(el('div', { class: 'ferien-jahr' }, [kopf, inhalt]));
  }
}

function openFerienSheet(row) {
  openSheet({
    title: row ? row.bezeichnung : 'Neuer Ferien-/Schließzeiteintrag',
    fields: [
      { name: 'bezeichnung', label: 'Bezeichnung' },
      { name: 'startdatum', label: 'Von', type: 'date' },
      { name: 'enddatum', label: 'Bis', type: 'date' },
      { name: 'typ', label: 'Typ', type: 'select', options: FERIEN_TYPEN },
    ],
    values: row || { typ: 'Ferien' },
    onSave: async (values) => {
      const result = await api.ferien.speichern(row ? { ...values, id: row.id } : values);
      if (!result.ok) throw new Error(result.error);
      await loadFerien();
      await refreshKennzahlen();
      toast('Gespeichert.');
    },
    onDelete: row
      ? async () => {
          await api.ferien.loeschen(row.id);
          await loadFerien();
          toast('Eintrag gelöscht.');
        }
      : null,
  });
}

/**
 * Zeile in der Import-Vorschau: ein bereits gebündelter Abschnitt (nicht mehr
 * ein Kalendertag), mit Checkbox + editierbarer Bezeichnung/Typ, Von/Bis nur
 * lesend. Bereits vorhandene Abschnitte sind vorbelegt ABgewählt (werden beim
 * Übernehmen ohnehin automatisch übersprungen, siehe ferienImportUebernehmen).
 */
function ferienImportZeile(a) {
  const bezeichnungInput = el('input', { type: 'text', value: a.bezeichnung });
  const typSelect = el('select', {}, FERIEN_TYPEN.map((o) => el('option', { value: o.value, selected: o.value === (a.typ || 'Ferien') }, [o.label])));
  const checkbox = el('input', { type: 'checkbox', 'data-abschnitt': '1', checked: !a.bereitsVorhanden });
  const zeitraum = a.startdatum === a.enddatum ? fmtDatum(a.startdatum) : `${fmtDatum(a.startdatum)} – ${fmtDatum(a.enddatum)}`;
  const zeile = el('div', { class: 'ferien-abschnitt-row' }, [
    checkbox,
    bezeichnungInput,
    typSelect,
    el('span', { class: 'ferien-abschnitt-zeitraum' }, [zeitraum]),
    el('span', { class: 'ferien-abschnitt-tage' }, [`${a.tage} Tag${a.tage === 1 ? '' : 'e'}`]),
    a.bereitsVorhanden ? el('span', { class: 'badge' }, ['bereits vorhanden']) : null,
  ]);
  zeile._lesen = () => ({
    ausgewaehlt: checkbox.checked,
    bezeichnung: bezeichnungInput.value.trim(),
    startdatum: a.startdatum,
    enddatum: a.enddatum,
    typ: typSelect.value,
  });
  return zeile;
}

/** Termine (roh, ggf. tageweise) über die Vorschau-IPC bündeln/gruppieren lassen und als Schuljahr-Baum anzeigen. */
async function openFerienImportPreview(termine) {
  const gruppen = await api.ferien.vorschauFuerImport(termine);
  const box = document.getElementById('ferien-import-liste');
  box.replaceChildren(
    ...gruppen.map((g) =>
      el('div', { class: 'ferien-jahr' }, [
        el('div', { class: 'ferien-jahr-kopf offen', style: { cursor: 'default' } }, [
          el('span', { class: 'ferien-jahr-titel' }, [`Schuljahr ${g.schuljahr}`]),
          el('div', { class: 'spacer' }),
          el('span', { class: 'ferien-jahr-badge' }, [
            `${g.abschnitte.length} Abschnitt${g.abschnitte.length === 1 ? '' : 'e'}${g.anzahlVorhanden ? `, davon ${g.anzahlVorhanden} schon vorhanden` : ''}`,
          ]),
        ]),
        el('div', { class: 'ferien-jahr-inhalt' }, g.abschnitte.map(ferienImportZeile)),
      ])
    )
  );
  document.getElementById('ferien-import-alle').checked = true;
  document.getElementById('ferien-import-backdrop').hidden = false;
}

function closeFerienImportPreview() {
  document.getElementById('ferien-import-backdrop').hidden = true;
}

async function ferienImportUebernehmenAbschicken() {
  const zeilen = [...document.querySelectorAll('#ferien-import-liste .ferien-abschnitt-row')].map((zeile) => zeile._lesen());
  const ausgewaehlt = zeilen.filter((z) => z.ausgewaehlt && z.bezeichnung);
  if (!ausgewaehlt.length) { toast('Nichts ausgewählt.', 'error'); return; }
  const result = await api.ferien.importUebernehmen(ausgewaehlt);
  if (!result.ok) { toast(result.error, 'error'); return; }
  closeFerienImportPreview();
  await loadFerien();
  toast(`${result.neu} Abschnitt(e) übernommen${result.uebersprungen ? `, ${result.uebersprungen} bereits vorhanden übersprungen` : ''}.`);
}

/** Ergebnis von "Fristen anhand der Ferien neu berechnen" – reine Anzeige, siehe repo.vorschauFristenMitFerien. */
function renderFerienNeuberechnenErgebnis(liste) {
  const box = document.getElementById('ferien-neuberechnen-ergebnis');
  box.hidden = false;
  box.replaceChildren();
  if (!liste.length) {
    box.appendChild(el('p', { class: 'hint' }, ['Keine Änderungen durch die aktuelle Ferienplanung – alle offenen Ausleihen sind bereits korrekt eingeplant.']));
    return;
  }
  const table = el('table', {}, [
    el('thead', {}, [el('tr', {}, [el('th', {}, ['Titel']), el('th', {}, ['Nutzer']), el('th', {}, ['Bisher fällig']), el('th', {}, ['Neu fällig']), el('th', {}, ['Grund'])])]),
    el(
      'tbody',
      {},
      liste.map((r) =>
        el('tr', {}, [
          el('td', {}, [r.Titel]),
          el('td', {}, [`${r.Nachname}, ${r.Vorname}`]),
          el('td', {}, [fmtDatum(r.faelligOhneFerien)]),
          el('td', {}, [fmtDatum(r.faelligMitFerien)]),
          el('td', {}, [r.grund]),
        ])
      )
    ),
  ]);
  box.appendChild(el('p', { class: 'hint' }, [`${liste.length} offene Ausleihe(n) verschieben sich durch die aktuelle Ferienplanung:`]));
  box.appendChild(table);
}

/* ------------------------------------------------------------- Datensicherung */

function wireBackup() {
  document.getElementById('backup-jetzt').addEventListener('click', async () => {
    try {
      const { liste } = await api.backup.jetzt();
      renderBackupListe(liste);
      toast('Backup erstellt.');
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });

  document.getElementById('backup-einspielen-datei').addEventListener('click', async () => {
    if (!confirm('Diese Sicherung über die aktuelle Datenbank kopieren und INGA neu starten? Der aktuelle Stand wird vorher noch einmal automatisch gesichert.')) return;
    try {
      await api.backup.einspielenDatei();
      // Bei Erfolg beendet sich INGA selbst (app.relaunch()) – hier nichts
      // mehr zu tun. Bei "Abbrechen" im Dateidialog kommt einfach nichts
      // zurück, ohne Fehler.
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });
}

async function loadBackups() {
  const liste = await api.backup.liste();
  renderBackupListe(liste);
}

function fmtGroesse(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderBackupListe(liste) {
  const tbody = document.getElementById('backup-tbody');
  tbody.replaceChildren();
  if (!liste.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 4 }, [el('div', { class: 'empty small' }, ['Noch keine Sicherungen vorhanden.'])])]));
    return;
  }
  for (const b of liste) {
    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [b.datei]),
        el('td', {}, [new Date(b.erstellt).toLocaleString('de-DE')]),
        el('td', { class: 'num' }, [fmtGroesse(b.groesse)]),
        el('td', { class: 'actions' }, [
          el('button', {
            class: 'button small',
            onclick: async () => {
              if (!confirm(`„${b.datei}“ über die aktuelle Datenbank kopieren und INGA neu starten? Der aktuelle Stand wird vorher noch einmal automatisch gesichert.`)) return;
              try {
                await api.backup.einspielen(b.datei);
              } catch (err) {
                toast(err.message || String(err), 'error');
              }
            },
          }, ['Einspielen']),
        ]),
      ])
    );
  }
}

const speichereEinstellungenFormular = debounce(async () => {
  const patch = {
    uiStyle: document.getElementById('set-uiStyle').value,
    theme: document.getElementById('set-theme').value,
    fontScale: Number(document.getElementById('set-fontScale').value) || 100,
    bibliotheksName: document.getElementById('set-bibliotheksName').value,
    uhrAnzeigen: document.getElementById('set-uhrAnzeigen').checked,
    leihfristTage: Number(document.getElementById('set-leihfristTage').value) || 7,
    maxVerlaengerung: Number(document.getElementById('set-maxVerlaengerung').value) || 0,
    verlaengerungDauerTage: Number(document.getElementById('set-verlaengerungDauerTage').value) || 7,
    ausleihLimit: Number(document.getElementById('set-ausleihLimit').value) || 0,
    sperreDauerTage: Number(document.getElementById('set-sperreDauerTage').value) || 14,
    abschlussKlassenstufe: document.getElementById('set-abschlussKlassenstufe').value,
    verlaengerungGesperrtBeiVormerkung: document.getElementById('set-verlaengerungGesperrtBeiVormerkung').checked,
    leihfristOffsetTage: Number(document.getElementById('set-leihfristOffsetTage').value) || 0,
    ferienZaehlweise: document.getElementById('set-ferienZaehlweise').value,
    ueberfaelligTageOhneFerien: document.getElementById('set-ueberfaelligTageOhneFerien').checked,
    mahngebuehrenAktiv: document.getElementById('set-mahngebuehrenAktiv').checked,
    mahnGebuehrProTag: Number(document.getElementById('set-mahnGebuehrProTag').value) || 0,
    mahnGebuehrMax: Number(document.getElementById('set-mahnGebuehrMax').value) || 0,
    mahnKarenztage: Number(document.getElementById('set-mahnKarenztage').value) || 0,
    absenderName: document.getElementById('set-absenderName').value,
    absenderAdresse: document.getElementById('set-absenderAdresse').value,
    absenderEmail: document.getElementById('set-absenderEmail').value,
    absenderTelefon: document.getElementById('set-absenderTelefon').value,
    mahnBetreffVorlage: document.getElementById('set-mahnBetreffVorlage').value,
    mahnSchluss: document.getElementById('set-mahnSchluss').value,
    mahnLogoDataUrl: state.settings.mahnLogoDataUrl || '',
    mahnstufen: state.settings.mahnstufen,
    matrixAktiv: document.getElementById('set-matrixAktiv').checked,
    matrixDomain: document.getElementById('set-matrixDomain').value,
    matrixHomeserver: document.getElementById('set-matrixHomeserver').value,
    matrixZugangstoken: document.getElementById('set-matrixZugangstoken').value,
  };
  state.settings = await api.settings.save(patch);
}, 250);

boot();
