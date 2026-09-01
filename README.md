# INGA

**I**NGA **I**st **N**icht **G**enehmigungspflichtige **A**nschaffung.

Eine freie, schlichte Bibliotheksverwaltung für Schulen: Katalog, Ausleihe,
Rückgabe, Nutzerverwaltung und Mahnwesen – als Desktop-App für Linux (KDE
Plasma, GNOME), macOS und Windows 11, jeweils mit nativer Optik statt einer
Web-Oberfläche in fremdem Gewand.

![Übersicht](docs/screenshots/dashboard.png)

## Warum

Bibliothekssoftware für Schulen ist meist teuer, browserbasiert oder beides.
INGA ist der Gegenentwurf: eine kleine, freie Desktop-App, die genau das kann,
was eine Schulbibliothek im Alltag braucht – nicht mehr, aber auch nicht
weniger.

## Die drei Module

INGA gliedert sich fachlich in drei Bereiche, die sich auch in der
Seitenleiste wiederfinden. Jeder hat seinen eigenen kleinen Namen:

### 📚 INGA – Inventar · Nutzer · Gebühren · Ausleihe

Das Kernmodul: Katalog und Exemplare (**I**nventar), Schüler:innen und
Lehrkräfte (**N**utzer), Mahn- und Verlustgebühren (**G**ebühren) sowie
Ausleihe/Rückgabe/Verlängerung (**A**usleihe). Das Dashboard fasst alle vier
Bereiche zusammen: Kennzahlen auf einen Blick, Schnellsprung zu Ausleihen und
Rückgabe, die zuletzt vergessenen Rückgaben und die zehn meistausgeliehenen
Bücher der Bibliothek.

### 🏷️ NELE – Neuzugänge Erfassen, Labeln, Einstellen

Der Weg eines neuen Buchs vom Karton ins Regal: Titel im Katalog **e**rfassen,
Exemplare mit Barcode-Etikett **l**abeln, Medienart/Systematik/Cover
**e**instellen. Die Buchdetailseite ist genau dafür gebaut – Cover per ISBN
laden oder hochladen, Exemplare anlegen, Klassifikation pflegen, alles auf
einer Seite.

### ✉️ JÖRN – Journal Überfälliger Rückgaben und Nachfristen

Das Mahnwesen: die laufend aktualisierte Liste überfälliger Ausleihen
(„Journal“), mehrstufige Mahnungen nach Tagen überfällig, individuell
formulierbare Brieftexte mit Platzhaltern, und die Möglichkeit, Fristen
kurzfristig zu verschieben (**N**achfristen) – etwa für eine
Ferienschließzeit.

## Funktionen

### Dashboard

- Kennzahlen: Titel, Exemplare, Nutzer, offene Ausleihen, überfällige
  Ausleihen
- Schnellsprung-Buttons zu Ausleihen, Rückgabe, neuem Titel und Mahnungen
- **Vergessene Rückgaben** – die dringendsten überfälligen Kinder zuerst,
  ein Klick öffnet direkt die Nutzerakte
- **Meistausgeliehene Bücher** – Top 10 über den gesamten Ausleihverlauf,
  mit Cover-Vorschau

### Katalog & Buchdetail (NELE)

- Titel anlegen, durchsuchen, filtern nach Medienart und Verfügbarkeit
- Exemplare mit Barcode/Etikett verwalten, Ausleihstatus pro Exemplar
- **Buchcover**: automatischer Download per ISBN/EAN von
  [Open Library](https://openlibrary.org/dev/docs/api/covers) (frei, ohne
  Konto), alternativ manueller Upload – einzeln pro Titel oder als
  Sammel-Download für den ganzen Bestand (mit Fortschrittsanzeige, unter
  „Import / Export“)
- Ausleihstatistik je Titel („insgesamt N× ausgeliehen“)

### Nutzerverwaltung

- Schüler:innen und Lehrkräfte, Gruppen, Zweige, Sperrungen,
  Ausleihberechtigung mit Ablaufdatum
- Filter nach Gruppe, Zweig und Status (aktiv / gesperrt / **mit
  Rückstand**)
- Nutzer mit überfälligen Ausleihen sind in der Liste rot markiert

### Ausleihe & Rückgabe

- Ausleihe per Barcode-Scanner oder Tastatur
- Leihfrist je Medienart, konfigurierbare Verlängerung
- Rückgabe-Liste mit Volltextsuche, „Nur überfällige“-Filter und
  Status-Badge pro Zeile

### Im Umlauf

„Was ist gerade unterwegs?“ – alle offenen Ausleihen auf einen Blick:
Buchtitel, Autor, Signatur/Barcode, Kind, Klasse, Ausleih-/Rückgabedatum,
Tage überfällig und Anzahl Verlängerungen. Filterbar per Freitext,
gruppierbar nach Klasse oder nach Kind (praktisch, um die Liste klassenweise
auszudrucken), Export als CSV (Excel-freundlich: Semikolon, UTF-8-BOM) und
als XLSX (Kopfzeile fett, Autofilter, passende Spaltenbreiten) sowie
Direktdruck/PDF im Querformat mit Kopf- (Schulname, Datum, Filter) und
Fußzeile (Seitenzahl). Schnellzugriff über die Startseite und die
Mahnliste.

### Mahnwesen (JÖRN)

- Beliebig viele Mahnstufen, sortier- und löschbar, jede mit eigener Gebühr
  und eigenem **Brieftext** (Platzhalter: `{Vorname}` `{Nachname}` `{Titel}`
  `{Tage}` `{Gebuehr}` `{Datum}` `{Faellig}` `{Stufe}`, live Vorschau direkt
  im Editor)
- Eigener Briefkopf: Absender, E-Mail, Telefon, Betreff-Vorlage,
  Schlusstext, Logo
- Formeller Brief per **PDF-Export** oder **direktem Druckauftrag**
- Filter nach Stufe und Freitextsuche in der Mahnliste

### Einstellungen

- Oberfläche (macOS/Windows/KDE/GNOME/automatisch, Hell/Dunkel)
- Standard-Leihfrist und maximale Verlängerungen
- **Fristverschiebung**: ein Tage-Offset, der sofort auf jede berechnete
  Fälligkeit wirkt (offene und künftige Ausleihen) – z. B. `+14` während
  einer kurzfristigen, noch nicht als Ferieneintrag erfassten Schließzeit
- **Einmalige Verschiebung**: verschiebt das Ausleihdatum aller aktuell
  offenen Ausleihen um X Tage, ohne die Standardfrist dauerhaft zu ändern
- **Ferien & Schließzeiten**: eigene Verwaltung für Ferien, Feiertage und
  Schließzeiten – manuell gepflegt, per ICS-Datei/URL importiert oder für
  Hamburg automatisch abgerufen (laufendes plus die nächsten drei
  Schuljahre, mit Vorschau vor der Übernahme). Fällt eine berechnete
  Rückgabefrist in einen solchen Zeitraum oder auf ein Wochenende, wird sie
  automatisch auf den nächsten echten Schultag danach verschoben – auch über
  mehrere direkt aneinandergrenzende Zeiträume hinweg (z. B. Ferien direkt
  gefolgt von einem Feiertag). Der Grund erscheint als Hinweis in der
  Rückgabeliste ("+12 Tage wegen Herbstferien"). Zusätzlich abschaltbar:
  Ferientage als Verzugstage nicht mitzählen

### Import & Export im Perpustakaan-Format

Ein Zip mit allen 65 Tabellen, Semikolon-getrennt, UTF-8. Tabellen, die INGA
nicht selbst bearbeitet (Rechnungswesen, Beschaffung, SEPA-Mandate,
Kursverwaltung, …), werden beim Import unverändert übernommen und beim
Export wieder mit ausgeliefert – ein Bestand geht auf dem Weg durch INGA
nicht kaputt. Buchcover sind rein INGA-intern und nicht Teil dieses Formats.

### Native Optik

Erkennt automatisch macOS (Liquid Glass), Windows 11 (Fluent/Mica) sowie
unter Linux KDE Plasma (Breeze) und GNOME (Adwaita) und passt Fensterrahmen,
Farben und Bedienelemente entsprechend an.

## Screenshots

| | |
|---|---|
| ![Dashboard](docs/screenshots/dashboard.png) Dashboard mit Schnellsprung und Top-10 | ![Katalog](docs/screenshots/katalog.png) Katalog mit Filtern |
| ![Buchdetail](docs/screenshots/buchdetail.png) Buchdetailseite (NELE) mit Cover | ![Nutzer](docs/screenshots/nutzer.png) Nutzerliste, überfällig rot markiert |
| ![Mahnungen](docs/screenshots/joern-mahnungen.png) Mahnliste (JÖRN) | ![Mahnungseditor](docs/screenshots/joern-editor.png) Mahnungseditor mit Brieftext-Vorschau |

*(Die Bilddateien fehlen noch – siehe [`docs/screenshots/README.md`](docs/screenshots/README.md)
für eine Anleitung, welche Screenshots wo hinkommen.)*

## Architektur

Electron ohne Oberflächen-Framework (kein React/Vue – reines HTML/CSS/JS),
SQLite über [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) als
Datenhaltung. Die Tabellen, die INGA versteht, tragen exakt die Spaltennamen
des Perpustakaan-Formats – dadurch braucht es keine Übersetzungsschicht beim
Import/Export.

```
src/
  main/       Hauptprozess: Fenster, Menü, Datenbank, Import/Export, Cover-Download, IPC
  preload/    contextBridge-API zwischen Haupt- und Renderer-Prozess
  renderer/   Oberfläche (index.html/app.js), Druckfenster für Mahnungen
  schema/     Referenzschema aller 65 Perpustakaan-Tabellen (generiert)
```

Buchcover landen als Dateien im `userData`-Ordner (`covers/`) und werden über
eine INGA-interne Tabelle referenziert – sie sind kein Teil des
Perpustakaan-Formats und bleiben deshalb bei Import/Export unangetastet.

Mahnungen entstehen als eigenes Fenster, das einen HTML-Brief pro Nutzer:in
rendert – von dort aus entweder direkt über den System-Druckdialog
(`webContents.print()`) oder als PDF (`webContents.printToPDF()`).

## Entwicklung

```bash
npm install
npm start          # App starten (Splashscreen 1–3 s, dann Hauptfenster)
npm test           # Kernlogik prüfen (Datenbank, Import/Export, Ausleihregeln)
```

### Fehlerbehebung

**`npm install` schlägt bei better-sqlite3 mit Compiler-Fehlern fehl**
(z. B. `no member named 'GetPrototype' in 'v8::Object'`): Das passiert mit
sehr neuen Node-Versionen, für die better-sqlite3 kein vorgebautes Binary
hat und deshalb aus dem Quellcode kompilieren muss – das schlägt dann gegen
aktuelles V8 fehl. Ab better-sqlite3 v13 (siehe `package.json`) tritt das
nicht mehr auf, da die Prebuilds N-API-basiert sind. Bei älteren Checkouts:
`npm install better-sqlite3@latest`.

**`npm start` bricht mit `Electron failed to install correctly, please
delete node_modules/electron and try installing again` ab**: `npm install`
lief zwar durch, aber Electrons eigenes `postinstall`-Skript hat das
~100–150 MB große Electron-Binary nicht vollständig heruntergeladen
(typisch bei instabiler Verbindung oder einem Netz/einer Firewall, die
GitHub-Release-Downloads blockiert – z. B. manche Schul- oder
Firmennetzwerke). Abhilfe:

```bash
rm -rf node_modules/electron
npm install electron --no-save   # lädt das Binary erneut, zeigt den echten Fehler
```

Bricht der Download wieder ab, hilft oft ein anderes Netzwerk (z. B.
Mobil-Hotspot) zum Testen, oder ein Mirror:

```bash
npm config set electron_mirror "https://npmmirror.com/mirrors/electron/"
rm -rf node_modules/electron && npm install electron --no-save
```

Erfolg prüfen: `cat node_modules/electron/path.txt` muss einen Pfad wie
`Electron.app/Contents/MacOS/Electron` ausgeben, und diese Datei muss
existieren.

## Bauen

```bash
npm run dist:linux   # AppImage, .deb, .rpm
npm run dist:win     # NSIS-Installer + portable .exe
npm run dist:mac     # .dmg (Apple Silicon + Intel)
```

Fertige Builds für alle drei Plattformen entstehen automatisch über GitHub
Actions bei jedem Push nach `main` und bei jedem Release-Tag (`v*`) – siehe
[`.github/workflows/build.yml`](.github/workflows/build.yml). Bei einem
Tag-Push wird zusätzlich automatisch ein GitHub Release mit allen
Build-Artefakten (AppImage, .deb, .rpm, Windows-Installer + portable .exe,
.dmg) angelegt.

## Lizenz

[GPL-3.0-or-later](LICENSE) – freie Software, für Schulen ohne
Genehmigungsvorbehalt.
