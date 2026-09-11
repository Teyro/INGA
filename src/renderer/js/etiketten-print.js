'use strict';

const api = window.inga;
const { FORMATE, berechnePositionen } = EtikettenGeometrie;

/**
 * Zeichnet den Etikett-Inhalt. `format.kompakt` (z. B. Zweckform/Avery
 * L4732REV, 35,6 × 16,9 mm) ist für Titel/Autor zu klein – dort nur die
 * Etikettnummer über einem etwas kleineren Barcode, ohne Titel/Autor/
 * Antolin-Marke, genau wie auf den bereits im Einsatz befindlichen
 * Etiketten dieses Formats.
 */
function fuelleEtikett(zelle, label, format) {
  if (!label) { zelle.classList.add('leer'); return; }

  if (format?.kompakt) {
    zelle.classList.add('kompakt');
    zelle.appendChild(el('div', { class: 'barcode-nummer' }, [label.MedienEtik || '']));
    if (label.MedienEtik) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'barcode');
      zelle.appendChild(svg);
      try {
        JsBarcode(svg, label.MedienEtik, { format: 'CODE128', displayValue: false, margin: 0, height: 24, width: 1.1 });
      } catch {
        // siehe unten – Etikett bleibt dann ohne Balken, die Nummer darüber zeigt den Code trotzdem.
      }
    }
    return;
  }

  if (label.antolin) zelle.appendChild(el('div', { class: 'antolin-marke', title: 'Antolin-Klassenstufe hinterlegt' }, ['Antolin']));
  zelle.appendChild(el('div', { class: 'titel' }, [label.Titel || '']));
  if (label.Autor) zelle.appendChild(el('div', { class: 'autor' }, [label.Autor]));

  if (label.MedienEtik) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'barcode');
    zelle.appendChild(svg);
    try {
      JsBarcode(svg, label.MedienEtik, { format: 'CODE128', displayValue: false, margin: 0, height: 46, width: 1.6 });
    } catch {
      // Ungültige Zeichen für CODE128 (praktisch nie bei Signaturen/Barcodes) –
      // Etikett bleibt dann ohne Balken, der Text darunter zeigt den Code trotzdem.
    }
    zelle.appendChild(el('div', { class: 'barcode-text' }, [label.MedienEtik]));
  }
}

function baueBoegen(labels, format, startPosition) {
  const paper = document.getElementById('paper');
  paper.replaceChildren();
  const positionen = berechnePositionen(labels, format, startPosition);

  const boegen = new Map();
  for (const p of positionen) {
    if (!boegen.has(p.bogen)) boegen.set(p.bogen, el('div', { class: 'etiketten-blatt' }));
    const zelle = el('div', { class: 'etikett', style: { left: `${p.left}mm`, top: `${p.top}mm`, width: `${p.width}mm`, height: `${p.height}mm` } });
    fuelleEtikett(zelle, p.label, format);
    boegen.get(p.bogen).appendChild(zelle);
  }
  for (const blatt of boegen.values()) paper.appendChild(blatt);
}

api.on('print:data', (data) => {
  const format = FORMATE[data.format] || FORMATE['zweckform-3475'];
  document.getElementById('anzahl').textContent = `${data.labels.length} Etikett${data.labels.length === 1 ? '' : 'en'} – ${format.label}`;

  const root = document.documentElement;
  const s = data.settings || {};
  if (s.os) { root.dataset.os = s.os; root.dataset.chrome = s.os === 'mac' ? 'mac' : s.os === 'win' ? 'overlay' : 'native'; }
  if (s.ui) root.dataset.ui = s.ui;

  document.getElementById('page-style').textContent = `@page { size: A4; margin: 0; }`;
  baueBoegen(data.labels, format, data.startPosition);
});

document.getElementById('close').addEventListener('click', () => api.window.close());
document.getElementById('print').addEventListener('click', () => api.print.now().catch((err) => alert(`Drucken fehlgeschlagen: ${err.message || err}`)));
document.getElementById('pdf').addEventListener('click', () => api.print.pdf({ name: 'Etiketten' }).catch((err) => alert(`PDF-Export fehlgeschlagen: ${err.message || err}`)));
