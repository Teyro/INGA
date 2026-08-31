'use strict';

const api = window.inga;
const state = { view: 'dashboard', stammdaten: null, settings: null };

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

  wireKatalog();
  wireLeser();
  wireAusleihe();
  wireRueckgabe();
  wireMahnungen();
  wireBestand();
  wireEinstellungen();
  wireSheet();

  api.on('menu:action', onMenuAction);
  api.on('settings:updated', (s) => { state.settings = s; applyChrome({ ...data, settings: s }); });

  await refreshKennzahlen();
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
  else if (name === 'mahnungen') loadMahnungen();
  else if (name === 'einstellungen') loadEinstellungen();
  else if (name === 'dashboard') refreshKennzahlen();
}

async function refreshKennzahlen() {
  const k = await api.kennzahlen();
  document.getElementById('stat-titel').textContent = k.titel;
  document.getElementById('stat-exemplare').textContent = k.exemplare;
  document.getElementById('stat-leser').textContent = k.leser;
  document.getElementById('stat-offen').textContent = k.offen;
  document.getElementById('count-offen').textContent = k.offen ? String(k.offen) : '';
  const ueberfaellig = await api.mahnung.ueberfaellige();
  document.getElementById('count-mahn').textContent = ueberfaellig.length ? String(ueberfaellig.length) : '';
}

/* ---------------------------------------------------------------- Sheet */

let sheetState = null;

function wireSheet() {
  document.getElementById('sheet-close').addEventListener('click', closeSheet);
  document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
  document.getElementById('sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });
  document.getElementById('sheet-save').addEventListener('click', async () => {
    if (!sheetState) return;
    try {
      await sheetState.onSave(readSheetValues());
      closeSheet();
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
  });
  document.getElementById('sheet-delete').addEventListener('click', async () => {
    if (!sheetState?.onDelete) return;
    if (!confirm('Wirklich löschen?')) return;
    await sheetState.onDelete();
    closeSheet();
  });
}

function openSheet({ title, fields, values, onSave, onDelete, extra }) {
  sheetState = { fields, onSave, onDelete };
  document.getElementById('sheet-title').textContent = title;
  const body = document.getElementById('sheet-body');
  body.replaceChildren();
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
    body.appendChild(el('div', { class: 'field' }, [el('label', {}, [f.label]), input]));
  }
  if (extra) body.appendChild(extra);
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

function wireKatalog() {
  document.getElementById('katalog-suche').addEventListener('input', debounce(loadKatalog, 200));
  document.getElementById('katalog-neu').addEventListener('click', () => openKatalogSheet(null));
}

async function loadKatalog() {
  const query = document.getElementById('katalog-suche').value.trim();
  const rows = await api.katalog.search(query);
  const tbody = document.getElementById('katalog-tbody');
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['📖']), 'Keine Titel gefunden.'])])]));
    return;
  }
  for (const row of rows) {
    const exemplare = await api.katalog.exemplare(row.KatalogNi);
    tbody.appendChild(
      el('tr', { onclick: () => openKatalogSheet(row) }, [
        el('td', {}, [row.Titel || '']),
        el('td', {}, [row.Autor || '']),
        el('td', {}, [row.ISBN || row.EAN || '']),
        el('td', {}, [row.ErschJahr || '']),
        el('td', { class: 'num' }, [String(exemplare.length)]),
      ])
    );
  }
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

  let exemplareBox = null;
  if (row?.KatalogNi) {
    const exemplare = await api.katalog.exemplare(row.KatalogNi);
    exemplareBox = el('div', {}, [
      el('div', { class: 'section-title' }, ['Exemplare']),
      ...exemplare.map((m) =>
        el('div', { class: 'row-inline', style: { marginBottom: '6px' } }, [
          el('span', { class: 'badge' }, [m.MedienEtik || `#${m.MedienNi}`]),
        ])
      ),
      el('div', { class: 'row-inline', style: { marginTop: '8px' } }, [
        el('input', { id: 'neues-etikett', type: 'text', placeholder: 'Neues Etikett / Barcode' }),
        el('button', {
          class: 'button small',
          onclick: async () => {
            const etikett = document.getElementById('neues-etikett').value.trim();
            if (!etikett) return;
            await api.medium.save({ KatalogNi: row.KatalogNi, MedienEtik: etikett });
            openKatalogSheet(await api.katalog.get(row.KatalogNi));
          },
        }, ['+ Exemplar']),
      ]),
    ]);
  }

  openSheet({
    title: row ? row.Titel || 'Titel bearbeiten' : 'Neuer Titel',
    fields,
    values: row || {},
    extra: exemplareBox,
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

function wireLeser() {
  document.getElementById('leser-suche').addEventListener('input', debounce(loadLeser, 200));
  document.getElementById('leser-neu').addEventListener('click', () => openLeserSheet(null));
}

async function loadLeser() {
  const query = document.getElementById('leser-suche').value.trim();
  const rows = await api.leser.search(query);
  const tbody = document.getElementById('leser-tbody');
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['🧑‍🎓']), 'Keine Nutzer gefunden.'])])]));
    return;
  }
  for (const row of rows) {
    const offen = await api.leser.offeneAusleihen(row.LeserNi);
    tbody.appendChild(
      el('tr', { onclick: () => openLeserSheet(row) }, [
        el('td', {}, [`${row.Nachname || ''}, ${row.Vorname || ''}`]),
        el('td', {}, [row.Kuerzel || '']),
        el('td', {}, [row.Jahrgang || '']),
        el('td', {}, [row.emailPriv || '']),
        el('td', { class: 'num' }, [String(offen.length)]),
      ])
    );
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
    const historie = await api.leser.mahnhistorie(row.LeserNi);
    if (historie.length) {
      historyBox = el('div', {}, [
        el('div', { class: 'section-title' }, ['Mahnhistorie']),
        ...historie.slice(0, 8).map((h) =>
          el('div', { class: 'hint', style: { marginBottom: '4px' } }, [`${fmtDatum(h.Mahndatum)} – ${h.Titel} (${fmtGeld(h.MaGebuehr)})`])
        ),
      ]);
    }
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

async function findLeserByKennung(text) {
  const rows = await api.leser.search(text);
  return rows.find((r) => r.AusweisId === text || r.Kuerzel === text) || rows[0] || null;
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
  status.textContent = `Ausgeliehen an ${leser.Nachname}, ${leser.Vorname} – fällig am ${fmtDatum(result.faelligAm)}.`;
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
}

async function loadRueckgabe() {
  const rows = await api.ausleihe.alleOffen();
  const tbody = document.getElementById('rueckgabe-tbody');
  tbody.replaceChildren();
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 5 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['✅']), 'Keine offenen Ausleihen.'])])]));
    return;
  }
  for (const row of rows) {
    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [`${row.Titel} – ${row.MedienEtik || ''}`]),
        el('td', {}, [`${row.Nachname}, ${row.Vorname}`]),
        el('td', {}, [fmtDatum(row.AuslDatum)]),
        el('td', {}, [String(row.AnzVerl || 0)]),
        el('td', { class: 'actions' }, [
          el('button', { class: 'button small', onclick: async () => { await api.ausleihe.verlaengern(row.id); await loadRueckgabe(); toast('Verlängert.'); } }, ['Verlängern']),
          ' ',
          el('button', { class: 'button small primary', onclick: async () => { await api.ausleihe.zurueckgeben(row.id); await loadRueckgabe(); await refreshKennzahlen(); toast('Zurückgegeben.'); } }, ['Zurückgeben']),
        ]),
      ])
    );
  }
}

/* ------------------------------------------------------------- Mahnungen */

function wireMahnungen() {
  document.getElementById('mahn-alle').addEventListener('change', (e) => {
    for (const cb of document.querySelectorAll('#mahnungen-tbody input[type="checkbox"]')) cb.checked = e.target.checked;
  });
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

function stufeBadgeClass(stufe, mahnstufen) {
  const index = mahnstufen.findIndex((s) => s === stufe || s.text === stufe.text);
  if (index >= mahnstufen.length - 1) return 'danger';
  if (index >= 1) return 'warn';
  return '';
}

async function loadMahnungen() {
  const rows = await api.mahnung.ueberfaellige();
  const tbody = document.getElementById('mahnungen-tbody');
  tbody.replaceChildren();
  document.getElementById('mahn-alle').checked = false;
  if (!rows.length) {
    tbody.appendChild(el('tr', {}, [el('td', { colSpan: 7 }, [el('div', { class: 'empty' }, [el('div', { class: 'icon' }, ['✉️']), 'Keine überfälligen Ausleihen.'])])]));
    return;
  }
  const mahnstufen = state.settings.mahnstufen;
  for (const row of rows) {
    tbody.appendChild(
      el('tr', {}, [
        el('td', {}, [el('input', { type: 'checkbox', 'data-payload': JSON.stringify(row) })]),
        el('td', {}, [row.Titel]),
        el('td', {}, [`${row.Nachname}, ${row.Vorname}`]),
        el('td', {}, [fmtDatum(row.faelligAm)]),
        el('td', {}, [String(row.tageUeberfaellig)]),
        el('td', {}, [el('span', { class: `badge ${stufeBadgeClass(row.stufe, mahnstufen)}` }, [row.stufe.text])]),
        el('td', { class: 'num' }, [fmtGeld(row.stufe.gebuehr)]),
      ])
    );
  }
}

/* --------------------------------------------------------------- Bestand */

function wireBestand() {
  document.getElementById('bestand-import').addEventListener('click', async () => {
    const result = await api.bestand.importieren();
    if (!result) return;
    toast(`Import abgeschlossen: ${result.kennzahlen.titel} Titel, ${result.kennzahlen.leser} Nutzer.`);
    state.stammdaten = await api.stammdaten.get();
    await refreshKennzahlen();
  });
  document.getElementById('bestand-export').addEventListener('click', async () => {
    const path = await api.bestand.exportieren();
    if (!path) return;
    toast(`Exportiert nach ${path}`);
  });
}

/* ---------------------------------------------------------- Einstellungen */

function wireEinstellungen() {
  for (const id of ['set-uiStyle', 'set-theme']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  for (const id of ['set-leihfristTage', 'set-maxVerlaengerung', 'set-absenderName', 'set-absenderAdresse']) {
    document.getElementById(id).addEventListener('change', speichereEinstellungenFormular);
  }
  document.getElementById('mahnstufe-hinzufuegen').addEventListener('click', () => {
    state.settings.mahnstufen.push({ tageUeberfaellig: 7, gebuehr: 0.5, text: 'Mahnung' });
    renderMahnstufen();
    speichereEinstellungenFormular();
  });
}

function renderMahnstufen() {
  const box = document.getElementById('mahnstufen-liste');
  box.replaceChildren();
  state.settings.mahnstufen.forEach((stufe, i) => {
    box.appendChild(
      el('div', { class: 'mahnstufe-row' }, [
        el('input', { type: 'number', value: stufe.tageUeberfaellig, title: 'Tage überfällig', onchange: (e) => { stufe.tageUeberfaellig = Number(e.target.value); speichereEinstellungenFormular(); } }),
        el('input', { type: 'number', step: '0.1', value: stufe.gebuehr, title: 'Gebühr €', onchange: (e) => { stufe.gebuehr = Number(e.target.value); speichereEinstellungenFormular(); } }),
        el('input', { type: 'text', value: stufe.text, title: 'Bezeichnung', onchange: (e) => { stufe.text = e.target.value; speichereEinstellungenFormular(); } }),
        el('button', { class: 'icon-button', onclick: () => { state.settings.mahnstufen.splice(i, 1); renderMahnstufen(); speichereEinstellungenFormular(); } }, ['✕']),
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
  document.getElementById('set-absenderName').value = s.absenderName || '';
  document.getElementById('set-absenderAdresse').value = s.absenderAdresse || '';
  renderMahnstufen();
}

const speichereEinstellungenFormular = debounce(async () => {
  const patch = {
    uiStyle: document.getElementById('set-uiStyle').value,
    theme: document.getElementById('set-theme').value,
    leihfristTage: Number(document.getElementById('set-leihfristTage').value) || 28,
    maxVerlaengerung: Number(document.getElementById('set-maxVerlaengerung').value) || 0,
    absenderName: document.getElementById('set-absenderName').value,
    absenderAdresse: document.getElementById('set-absenderAdresse').value,
    mahnstufen: state.settings.mahnstufen,
  };
  state.settings = await api.settings.save(patch);
}, 250);

boot();
