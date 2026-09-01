'use strict';

const api = window.inga;
const state = {
  view: 'dashboard',
  stammdaten: null,
  settings: null,
  katalogSeite: 1,
  leserSeite: 1,
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
  wireBestand();
  wireEinstellungen();
  wireSheet();

  api.on('menu:action', onMenuAction);
  api.on('settings:updated', (s) => {
    state.settings = s;
    applyChrome({ ...data, settings: s });
    if (state.view === 'mahnungen') fuelleMahnstufenFilter();
  });
  api.on('cover:progress', aktualisiereCoverFortschritt);

  showView('dashboard');
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
  else if (name === 'mahnungen') { fuelleMahnstufenFilter(); loadMahnungen(); }
  else if (name === 'umlauf') loadUmlauf();
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
    const cover = el('div', { class: 'rank-cover' }, [el('span', {}, ['📕'])]);
    box.appendChild(
      el('div', { class: 'list-row', onclick: async () => openKatalogSheet(await api.katalog.get(row.KatalogNi)) }, [
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
];

function beiKatalogFilterAenderung() {
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
  document.getElementById('katalog-seite-zurueck').addEventListener('click', () => { state.katalogSeite = Math.max(1, state.katalogSeite - 1); loadKatalog(); });
  document.getElementById('katalog-seite-vor').addEventListener('click', () => { state.katalogSeite += 1; loadKatalog(); });
  document.getElementById('katalog-neu').addEventListener('click', () => openKatalogSheet(null));
  document.getElementById('katalog-csv').addEventListener('click', () => katalogExport('csv'));
  document.getElementById('katalog-xlsx').addEventListener('click', () => katalogExport('xlsx'));
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
  renderFilterChips('katalog-filter-chips', KATALOG_FILTER_FELDER);
  const tbody = document.getElementById('katalog-tbody');
  tbody.replaceChildren();
  aktualisierePaginierung('katalog', { seite, proSeite, gesamt, anzahlAngezeigt: rows.length });
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 6 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['📖']), 'Keine Titel gefunden.'])])]));
    return;
  }
  for (const row of rows) {
    const belegt = row.exemplareGesamt > 0 && row.exemplareVerfuegbar === 0;
    tbody.appendChild(
      el('tr', { onclick: () => openKatalogSheet(row) }, [
        el('td', {}, [row.Titel || '']),
        el('td', {}, [row.Autor || '']),
        el('td', {}, [medArtLabel(row.MedArtKb)]),
        el('td', {}, [row.ISBN || row.EAN || '']),
        el('td', {}, [row.ErschJahr || '']),
        el('td', { class: 'num' }, [el('span', { class: `badge ${belegt ? 'danger' : row.exemplareVerfuegbar > 0 ? 'ok' : ''}` }, [`${row.exemplareVerfuegbar}/${row.exemplareGesamt}`])]),
      ])
    );
  }
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
function buildCoverPanel(row) {
  const frame = el('div', { class: 'cover-frame' }, [el('span', { class: 'cover-placeholder' }, ['📕'])]);
  const panel = el('div', { class: 'cover-panel' }, [frame]);

  if (!row?.KatalogNi) {
    panel.appendChild(el('p', { class: 'hint' }, ['Erst speichern, dann lässt sich ein Cover laden.']));
    return panel;
  }

  const downloadBtn = el('button', { class: 'button small' }, ['Herunterladen']);
  const uploadBtn = el('button', { class: 'button small' }, ['Hochladen …']);
  const removeBtn = el('button', { class: 'button small', hidden: true }, ['Entfernen']);

  async function refreshFrame({ neuLaden } = {}) {
    if (neuLaden) invalidiereCover(row.KatalogNi);
    const dataUrl = await holeCoverGecacht(row.KatalogNi);
    frame.replaceChildren(dataUrl ? el('img', { src: dataUrl, alt: '' }) : el('span', { class: 'cover-placeholder' }, ['📕']));
    removeBtn.hidden = !dataUrl;
  }

  downloadBtn.addEventListener('click', async () => {
    downloadBtn.disabled = true;
    const result = await api.cover.fetchOne(row.KatalogNi);
    downloadBtn.disabled = false;
    if (result.ok) { toast('Cover geladen.'); await refreshFrame({ neuLaden: true }); }
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
  refreshFrame();
  return panel;
}

async function openKatalogSheet(row) {
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
  ];

  let extraBox = null;
  if (row?.KatalogNi) {
    const [exemplare, statistik] = await Promise.all([
      api.katalog.exemplareMitStatus(row.KatalogNi),
      api.katalog.ausleihStatistik(row.KatalogNi),
    ]);
    extraBox = el('div', {}, [
      el('div', { class: 'section-title' }, ['Exemplare']),
      exemplare.length
        ? el('div', {}, exemplare.map((m) =>
            el('div', { class: 'row-inline', style: { marginBottom: '6px' } }, [
              el('span', { class: 'badge' }, [m.MedienEtik || `#${m.MedienNi}`]),
              el('span', { class: `badge ${m.verliehen ? 'warn' : 'ok'}` }, [m.verliehen ? 'verliehen' : 'verfügbar']),
            ])
          ))
        : el('p', { class: 'hint' }, ['Noch keine Exemplare.']),
      el('div', { class: 'row-inline', style: { marginTop: '8px' } }, [
        el('input', { id: 'neues-etikett', type: 'text', placeholder: 'Neues Etikett / Barcode' }),
        el('button', {
          class: 'button small',
          onclick: async (e) => {
            const etikett = document.getElementById('neues-etikett').value.trim();
            if (!etikett) return;
            e.target.disabled = true;
            try {
              await api.medium.save({ KatalogNi: row.KatalogNi, MedienEtik: etikett });
              openKatalogSheet(await api.katalog.get(row.KatalogNi));
            } catch (err) {
              toast(err.message || String(err), 'error');
            } finally {
              e.target.disabled = false;
            }
          },
        }, ['+ Exemplar']),
      ]),
      el('p', { class: 'hint', style: { marginTop: '14px' } }, [`Insgesamt ${statistik.gesamt}× ausgeliehen.`]),
    ]);
  }

  openSheet({
    title: row ? row.Titel || 'Titel bearbeiten' : 'Neuer Titel',
    fields,
    values: row || {},
    before: buildCoverPanel(row),
    wide: true,
    extra: extraBox,
    onSave: async (values) => {
      const payload = row ? { ...values, KatalogNi: row.KatalogNi } : values;
      await api.katalog.save(payload);
      await loadKatalog();
      await refreshKennzahlen();
      toast('Gespeichert.');
    },
    onDelete: row
      ? async () => {
          await api.katalog.delete(row.KatalogNi);
          await loadKatalog();
          await refreshKennzahlen();
          toast('Titel gelöscht.');
        }
      : null,
  });
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
  ];

  let historyBox = null;
  if (row?.LeserNi) {
    const [offen, historie] = await Promise.all([api.leser.offeneAusleihen(row.LeserNi), api.leser.mahnhistorie(row.LeserNi)]);
    historyBox = el('div', {}, [
      offen.length
        ? el('div', {}, [
            el('div', { class: 'section-title' }, ['Offene Ausleihen']),
            ...offen.map((o) => el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${o.Titel} – seit ${fmtDatum(o.AuslDatum)}`])),
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

function wireAusleihe() {
  document.getElementById('ausleihe-bestaetigen').addEventListener('click', ausleihenAbschicken);
  for (const id of ['ausleihe-etikett', 'ausleihe-leser']) {
    document.getElementById(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') ausleihenAbschicken(); });
  }
}

async function ausleihenAbschicken() {
  const status = document.getElementById('ausleihe-status');
  const etikett = document.getElementById('ausleihe-etikett').value.trim();
  const leserText = document.getElementById('ausleihe-leser').value.trim();
  if (!etikett || !leserText) { status.textContent = 'Bitte Exemplar und Nutzer angeben.'; return; }

  const medium = await api.medium.findByEtikett(etikett);
  if (!medium) { status.textContent = `Kein Exemplar mit Etikett „${etikett}“ gefunden.`; return; }
  const leser = await findLeserByKennung(leserText);
  if (!leser) { status.textContent = `Kein Nutzer für „${leserText}“ gefunden.`; return; }

  const result = await api.ausleihe.ausleihen({ medienNi: medium.MedienNi, leserNi: leser.LeserNi, benutzer: 'inga' });
  if (!result.ok) { status.textContent = result.error; toast(result.error, 'error'); return; }
  const hinweisText = result.hinweise?.length ? ` (${result.hinweise.join(', ')})` : '';
  status.textContent = `Ausgeliehen an ${leser.Nachname}, ${leser.Vorname} – fällig am ${fmtDatum(result.faelligAm)}${hinweisText}.`;
  document.getElementById('ausleihe-etikett').value = '';
  document.getElementById('ausleihe-leser').value = '';
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

function wireMahnungen() {
  document.getElementById('mahn-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#mahnungen-tbody input[type="checkbox"]')) cb.checked = e.target.checked;
  });
  document.getElementById('mahnungen-suche').addEventListener('input', debounce(loadMahnungen, 200));
  document.getElementById('mahnungen-filter-stufe').addEventListener('change', loadMahnungen);
  document.getElementById('mahnungen-drucken').addEventListener('click', async () => {
    const checked = [...document.querySelectorAll('#mahnungen-tbody input[type="checkbox"]:checked')];
    if (!checked.length) { toast('Nichts ausgewählt.', 'error'); return; }
    const positionen = checked.map((cb) => JSON.parse(cb.dataset.payload));
    const result = await api.mahnung.erzeugenUndDrucken(positionen);
    toast(`${result.anzahl} Mahnung(en) erzeugt.`);
    await loadMahnungen();
    await refreshKennzahlen();
  });
}

/** Stufen sind nur nach ihrer Position (nicht nach Namen) eindeutig – zwei Stufen dürfen gleich heißen. */
function badgeKlasseFuerStufenIndex(index, anzahlStufen) {
  if (index >= anzahlStufen - 1) return 'danger';
  if (index >= 1) return 'warn';
  return '';
}

function fuelleMahnstufenFilter() {
  const sel = document.getElementById('mahnungen-filter-stufe');
  const bisher = sel.value;
  sel.replaceChildren(el('option', { value: '' }, ['Alle Stufen']), ...state.settings.mahnstufen.map((s, i) => el('option', { value: String(i) }, [s.text])));
  sel.value = bisher;
}

async function loadMahnungen() {
  const rows = await api.mahnung.ueberfaellige();
  const suche = document.getElementById('mahnungen-suche').value.trim().toLowerCase();
  const stufeFilter = document.getElementById('mahnungen-filter-stufe').value;
  const anzahlStufen = state.settings.mahnstufen.length;
  const gebuehrenAktiv = Boolean(state.settings.mahngebuehrenAktiv);
  document.getElementById('mahn-gebuehr-head').hidden = !gebuehrenAktiv;

  let gefiltert = rows;
  if (suche) gefiltert = gefiltert.filter((r) => `${r.Titel} ${r.Nachname} ${r.Vorname}`.toLowerCase().includes(suche));
  if (stufeFilter !== '') gefiltert = gefiltert.filter((r) => r.stufeIndex === Number(stufeFilter));

  const tbody = document.getElementById('mahnungen-tbody');
  tbody.replaceChildren();
  document.getElementById('mahn-alle').checked = false;
  if (!gefiltert.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 7 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['✉️']), 'Keine überfälligen Ausleihen.'])])]));
    return;
  }
  for (const row of gefiltert) {
    const badgeClass = badgeKlasseFuerStufenIndex(row.stufeIndex, anzahlStufen);
    tbody.appendChild(
      el('tr', { class: badgeClass === 'danger' ? 'row-overdue' : '' }, [
        el('td', {}, [el('input', { type: 'checkbox', 'data-payload': JSON.stringify(row) })]),
        el('td', {}, [row.Titel]),
        el('td', {}, [`${row.Nachname}, ${row.Vorname}`]),
        el('td', {}, [fmtDatum(row.faelligAm)]),
        el('td', {}, [String(row.tageUeberfaellig)]),
        el('td', {}, [el('span', { class: `badge ${badgeClass}` }, [row.stufe.text])]),
        el('td', { class: 'num', hidden: !gebuehrenAktiv }, [fmtGeld(row.gebuehr)]),
      ])
    );
  }
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

/* --------------------------------------------------------------- Bestand */

function aktualisiereCoverFortschritt(p) {
  const fill = document.getElementById('cover-progress-fill');
  const statusEl = document.getElementById('cover-download-status');
  if (!fill || !statusEl) return;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  fill.style.width = `${pct}%`;
  statusEl.textContent = `${p.done}/${p.total} geprüft – ${p.gefunden} Cover gefunden, ${p.fehler} ohne Treffer.`;
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

  const startBtn = document.getElementById('cover-download-start');
  const cancelBtn = document.getElementById('cover-download-abbrechen');
  const statusEl = document.getElementById('cover-download-status');
  const track = document.getElementById('cover-progress-track');
  const fill = document.getElementById('cover-progress-fill');

  startBtn.addEventListener('click', async () => {
    const nurFehlende = !document.getElementById('cover-alle-neu').checked;
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
  });
  cancelBtn.addEventListener('click', () => api.cover.fetchAllCancel());
}

/* ---------------------------------------------------------- Einstellungen */

function wireEinstellungen() {
  for (const id of ['set-uiStyle', 'set-theme']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  for (const id of [
    'set-leihfristTage', 'set-maxVerlaengerung', 'set-verlaengerungDauerTage', 'set-leihfristOffsetTage',
    'set-mahnGebuehrProTag', 'set-mahnGebuehrMax', 'set-mahnKarenztage',
    'set-absenderName', 'set-absenderAdresse', 'set-absenderEmail', 'set-absenderTelefon',
    'set-mahnBetreffVorlage', 'set-mahnSchluss',
  ]) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  for (const id of ['set-verlaengerungGesperrtBeiVormerkung', 'set-ueberfaelligTageOhneFerien']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  document.getElementById('set-mahngebuehrenAktiv').addEventListener('change', (e) => {
    document.getElementById('mahngebuehr-felder').hidden = !e.target.checked;
    speichereEinstellungenFormular();
  });

  document.getElementById('mahnstufe-hinzufuegen').addEventListener('click', () => {
    state.settings.mahnstufen.push({
      tageUeberfaellig: 7,
      gebuehr: 0.5,
      text: 'Mahnung',
      briefText: 'Liebe/r {Vorname} {Nachname},\n\ndas Medium ist seit {Tage} Tagen überfällig. Bitte gib es so bald wie möglich zurück.',
    });
    renderMahnstufen();
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
  };
  return fuellePlatzhalter(vorlage, werte);
}

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

    box.appendChild(
      el('div', { class: 'mahnstufe-card' }, [
        el('div', { class: 'mahnstufe-head' }, [
          el('span', { class: `badge ${badgeKlasseFuerStufenIndex(i, arr.length)}` }, [`Stufe ${i + 1}`]),
          el('input', { type: 'text', value: stufe.text, title: 'Bezeichnung', class: 'mahnstufe-text', onchange: (e) => { stufe.text = e.target.value; aktualisierePreview(); speichereEinstellungenFormular(); } }),
          el('div', { class: 'spacer' }),
          el('button', { class: 'icon-button', title: 'Nach oben', disabled: i === 0, onclick: () => { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); renderMahnstufen(); speichereEinstellungenFormular(); } }, ['↑']),
          el('button', { class: 'icon-button', title: 'Nach unten', disabled: i === arr.length - 1, onclick: () => { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); renderMahnstufen(); speichereEinstellungenFormular(); } }, ['↓']),
          el('button', { class: 'icon-button', title: 'Stufe löschen', onclick: () => { arr.splice(i, 1); renderMahnstufen(); speichereEinstellungenFormular(); } }, ['✕']),
        ]),
        el('div', { class: 'field-row' }, [
          el('div', { class: 'field' }, [el('label', {}, ['Tage überfällig']), el('input', { type: 'number', value: stufe.tageUeberfaellig, onchange: (e) => { stufe.tageUeberfaellig = Number(e.target.value); aktualisierePreview(); speichereEinstellungenFormular(); } })]),
        ]),
        el('div', { class: 'field' }, [
          el('label', {}, ['Brieftext']),
          el('textarea', { rows: 4, value: stufe.briefText || '', oninput: (e) => { stufe.briefText = e.target.value; aktualisierePreview(); }, onchange: () => speichereEinstellungenFormular() }),
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
  document.getElementById('set-leihfristTage').value = s.leihfristTage;
  document.getElementById('set-maxVerlaengerung').value = s.maxVerlaengerung;
  document.getElementById('set-verlaengerungDauerTage').value = s.verlaengerungDauerTage;
  document.getElementById('set-verlaengerungGesperrtBeiVormerkung').checked = Boolean(s.verlaengerungGesperrtBeiVormerkung);
  document.getElementById('set-leihfristOffsetTage').value = s.leihfristOffsetTage || 0;
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
  renderMahnstufen();
  renderMedArtFristen();
  loadFerien();
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
    openFerienImportPreview(result.termine);
  });

  document.getElementById('ferien-neuberechnen').addEventListener('click', async () => {
    const liste = await api.ausleihe.ferienVorschau();
    renderFerienNeuberechnenErgebnis(liste);
  });

  document.getElementById('ferien-import-close').addEventListener('click', closeFerienImportPreview);
  document.getElementById('ferien-import-abbrechen').addEventListener('click', closeFerienImportPreview);
  document.getElementById('ferien-import-backdrop').addEventListener('click', (e) => {
    if (e.target.id === 'ferien-import-backdrop') closeFerienImportPreview();
  });
  document.getElementById('ferien-import-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#ferien-import-tbody input[type="checkbox"]')) cb.checked = e.target.checked;
  });
  document.getElementById('ferien-import-uebernehmen').addEventListener('click', ferienImportUebernehmenAbschicken);
}

function behandleFerienImportErgebnis(result) {
  if (!result.ok) { toast(result.error, 'error'); return; }
  if (!result.termine.length) { toast('Keine Termine gefunden.', 'error'); return; }
  openFerienImportPreview(result.termine);
}

async function loadFerien() {
  const liste = await api.ferien.liste();
  renderFerienListe(liste);
}

function ferienTypBadgeKlasse(typ) {
  if (typ === 'Feiertag') return 'warn';
  if (typ === 'Schließzeit') return 'danger';
  return '';
}

function renderFerienListe(liste) {
  const tbody = document.getElementById('ferien-tbody');
  tbody.replaceChildren();
  if (!liste.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 6 }, [el('div', { class: 'empty small' }, ['Noch keine Ferien/Schließzeiten eingetragen.'])])]));
    return;
  }
  for (const row of liste) {
    tbody.appendChild(
      el('tr', { onclick: () => openFerienSheet(row) }, [
        el('td', {}, [row.bezeichnung]),
        el('td', {}, [fmtDatum(row.startdatum)]),
        el('td', {}, [fmtDatum(row.enddatum)]),
        el('td', {}, [el('span', { class: `badge ${ferienTypBadgeKlasse(row.typ)}` }, [row.typ])]),
        el('td', {}, [row.quelle]),
        el('td', { class: 'actions' }, [
          el('button', {
            class: 'icon-button',
            title: 'Löschen',
            onclick: async (e) => {
              e.stopPropagation();
              if (!confirm(`„${row.bezeichnung}“ wirklich löschen?`)) return;
              try {
                await api.ferien.loeschen(row.id);
                await loadFerien();
                toast('Eintrag gelöscht.');
              } catch (err) {
                toast(err.message || String(err), 'error');
              }
            },
          }, ['✕']),
        ]),
      ])
    );
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

/** Zeile in der Import-Vorschau: Checkbox + editierbare Bezeichnung/Typ, Von/Bis nur lesend. */
function ferienImportZeile(termin) {
  const bezeichnungInput = el('input', { type: 'text', value: termin.bezeichnung });
  const typSelect = el(
    'select',
    {},
    FERIEN_TYPEN.map((o) => el('option', { value: o.value, selected: o.value === (termin.typ || 'Ferien') }, [o.label]))
  );
  const checkbox = el('input', { type: 'checkbox', checked: true });
  const tr = el('tr', {}, [
    el('td', {}, [checkbox]),
    el('td', {}, [bezeichnungInput]),
    el('td', {}, [fmtDatum(termin.startdatum)]),
    el('td', {}, [fmtDatum(termin.enddatum)]),
    el('td', {}, [typSelect]),
  ]);
  tr._lesen = () => ({
    ausgewaehlt: checkbox.checked,
    bezeichnung: bezeichnungInput.value.trim(),
    startdatum: termin.startdatum,
    enddatum: termin.enddatum,
    typ: typSelect.value,
  });
  return tr;
}

function openFerienImportPreview(termine) {
  const tbody = document.getElementById('ferien-import-tbody');
  tbody.replaceChildren(...termine.map(ferienImportZeile));
  document.getElementById('ferien-import-alle').checked = true;
  document.getElementById('ferien-import-backdrop').hidden = false;
}

function closeFerienImportPreview() {
  document.getElementById('ferien-import-backdrop').hidden = true;
}

async function ferienImportUebernehmenAbschicken() {
  const zeilen = [...document.querySelectorAll('#ferien-import-tbody tr')].map((tr) => tr._lesen());
  const ausgewaehlt = zeilen.filter((z) => z.ausgewaehlt && z.bezeichnung);
  if (!ausgewaehlt.length) { toast('Nichts ausgewählt.', 'error'); return; }
  const result = await api.ferien.importUebernehmen(ausgewaehlt);
  if (!result.ok) { toast(result.error, 'error'); return; }
  closeFerienImportPreview();
  await loadFerien();
  toast(`${result.neu} Termin(e) übernommen${result.uebersprungen ? `, ${result.uebersprungen} bereits vorhanden übersprungen` : ''}.`);
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

const speichereEinstellungenFormular = debounce(async () => {
  const patch = {
    uiStyle: document.getElementById('set-uiStyle').value,
    theme: document.getElementById('set-theme').value,
    leihfristTage: Number(document.getElementById('set-leihfristTage').value) || 7,
    maxVerlaengerung: Number(document.getElementById('set-maxVerlaengerung').value) || 0,
    verlaengerungDauerTage: Number(document.getElementById('set-verlaengerungDauerTage').value) || 7,
    verlaengerungGesperrtBeiVormerkung: document.getElementById('set-verlaengerungGesperrtBeiVormerkung').checked,
    leihfristOffsetTage: Number(document.getElementById('set-leihfristOffsetTage').value) || 0,
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
  };
  state.settings = await api.settings.save(patch);
}, 250);

boot();
