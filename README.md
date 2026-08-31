# INGA

**I**NGA **I**st **N**icht **G**enehmigungspflichtige **A**nschaffung.

Eine freie, schlichte Bibliotheksverwaltung für Schulen: Katalog, Ausleihe,
Rückgabe, Nutzerverwaltung und Mahnwesen – als Desktop-App für Linux (KDE
Plasma), macOS und Windows 11, jeweils mit nativer Optik statt einer
Web-Oberfläche in fremdem Gewand.

## Warum

Bibliothekssoftware für Schulen ist meist teuer, browserbasiert oder beides.
INGA ist der Gegenentwurf: eine kleine, freie Desktop-App, die genau das kann,
was eine Schulbibliothek im Alltag braucht – nicht mehr, aber auch nicht
weniger.

## Funktionen

- **Katalog** – Titel anlegen, durchsuchen, Exemplare mit Barcode/Etikett verwalten
- **Ausleihe & Rückgabe** – per Barcode-Scanner oder Tastatur, mit Leihfrist je
  Medienart und konfigurierbarer Verlängerung
- **Nutzerverwaltung** – Schüler:innen und Lehrkräfte, Gruppen, Sperrungen,
  Ausleihberechtigung mit Ablaufdatum
- **Mahnwesen** – mehrstufige Mahnungen nach Tagen überfällig, als formeller
  Brief per **PDF-Export** oder **direktem Druckauftrag**
- **Import & Export im Perpustakaan-Format** – ein Zip mit allen 65 Tabellen,
  Semikolon-getrennt, UTF-8. Tabellen, die INGA nicht selbst bearbeitet
  (Rechnungswesen, Beschaffung, SEPA-Mandate, Kursverwaltung, …), werden beim
  Import unverändert übernommen und beim Export wieder mit ausgeliefert –
  ein Bestand geht auf dem Weg durch INGA nicht kaputt.
- **Native Optik** – erkennt automatisch macOS (Liquid Glass), Windows 11
  (Fluent/Mica) sowie unter Linux KDE Plasma (Breeze) und GNOME (Adwaita) und
  passt Fensterrahmen, Farben und Bedienelemente entsprechend an

## Architektur

Electron ohne Oberflächen-Framework (kein React/Vue – reines HTML/CSS/JS),
SQLite über [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) als
Datenhaltung. Die Tabellen, die INGA versteht, tragen exakt die Spaltennamen
des Perpustakaan-Formats – dadurch braucht es keine Übersetzungsschicht beim
Import/Export.

```
src/
  main/       Hauptprozess: Fenster, Menü, Datenbank, Import/Export, IPC
  preload/    contextBridge-API zwischen Haupt- und Renderer-Prozess
  renderer/   Oberfläche (index.html/app.js), Druckfenster für Mahnungen
  schema/     Referenzschema aller 65 Perpustakaan-Tabellen (generiert)
```

Mahnungen entstehen als eigenes Fenster, das einen HTML-Brief pro Nutzer:in
rendert – von dort aus entweder direkt über den System-Druckdialog
(`webContents.print()`) oder als PDF (`webContents.printToPDF()`).

## Entwicklung

```bash
npm install
npm start          # App starten
npm test           # Kernlogik prüfen (Datenbank, Import/Export, Ausleihregeln)
```

## Bauen

```bash
npm run dist:linux   # AppImage, .deb, .rpm
npm run dist:win     # NSIS-Installer + portable .exe
npm run dist:mac     # .dmg (Apple Silicon + Intel)
```

Fertige Builds für alle drei Plattformen entstehen automatisch über GitHub
Actions bei jedem Release-Tag (siehe `.github/workflows/build.yml`).

## Lizenz

[GPL-3.0-or-later](LICENSE) – freie Software, für Schulen ohne
Genehmigungsvorbehalt.
