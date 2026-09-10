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

- Klick auf einen Titel klappt das Detail direkt unter der Zeile auf
  (Titel/Autor/Status je Exemplar zuerst, Katalogdaten darunter) und
  scrollt sich von selbst ins Bild – kein Flyout über der Liste, kein
  Verlust der Scrollposition, per Pfeiltasten/Escape bedienbar
- Titel anlegen, durchsuchen, filtern nach Medienart, Kategorie,
  Klassenstufe, Standort und Status (verfügbar / ausgeliehen / überfällig /
  nicht verfügbar) – echte Seitennavigation (25/50/100/250/Alle) statt einer
  festen Höchstzahl, aktive Filter als entfernbare Chips, Export der
  gefilterten Liste als CSV/Excel
- Freitextsuche deckt Titel, Autor, Verlag, ISBN/EAN, Schlagwort UND die
  Signatur/den Barcode einzelner Exemplare ab
- Exemplare mit Barcode/Etikett verwalten, Ausleihstatus pro Exemplar –
  Etiketten dafür direkt ausdrucken, siehe „Etiketten“ unten
- **Buchcover**: automatischer Download per ISBN/EAN, probiert dafür
  mehrere freie Quellen nacheinander – zuerst [Open Library](https://openlibrary.org/dev/docs/api/covers)
  und [Google Books](https://developers.google.com/books) (beide ohne
  Konto, extra für Bücher vorgesehen, über die ISBN), als Rückfallebene
  danach die Bildersuche von DuckDuckGo und Qwant per Titel/Autor (für
  Titel, die keine der beiden Buch-APIs kennt – kein offiziell
  dokumentiertes Interface, kann gelegentlich nichts liefern, kostet dann
  aber nur einen übersprungenen Versuch) – alternativ manueller Upload.
  Einzeln pro Titel, als Sammel-Download für den ganzen Bestand (mit
  Fortschrittsanzeige, unter „Import / Export“ – dort wird nach jedem
  Bestandsimport aktiv nachgefragt), oder automatisch beim Anlegen eines
  neuen Titels mit ISBN/EAN. Ohne Treffer bei keiner Quelle zeigt INGA ein
  generisches Platzhalterbild statt einer Lücke.
- Ausleihstatistik je Titel („insgesamt N× ausgeliehen“)
- **Antolin-Klassenstufe** je Titel (freies Feld) für Titel mit
  Antolin-Lesequiz
- **Buchdaten per ISBN nachschlagen**: Titel/Untertitel/Autor/Verlag/Jahr
  über [Open Library](https://openlibrary.org/dev/docs/api/books) laden –
  füllt nur das gerade offene Formular, gespeichert wird erst durch
  bewusstes Bestätigen (Klick auf „Speichern“)

### Etiketten

Barcode-Etiketten für Exemplare, mit echten, physisch passenden
Bogenformaten – eigener Bereich in der Seitenleiste, dazu Schnellzugriff
direkt auf der Buchdetailseite (einzelnes Exemplar oder „Alle Etiketten
drucken“ für den ganzen Titel).

- **3 Etikettenformate**: Zweckform 3475 (70 × 36 mm, 24/Bogen), Zweckform/
  Avery L7160 (63,5 × 38,1 mm, 21/Bogen) sowie Zweckform 3651 (52,5 × 29,7
  mm, 40/Bogen, kompakt) – Rand und Rasterabstand aus den offiziellen
  Produktmaßen, nicht nur der reinen Etikettengröße, damit der Ausdruck auf
  einem echten Bogen sitzt
- **Startposition**: für angebrochene Bögen – überspringt die angegebene
  Anzahl bereits verbrauchter Etiketten, nur auf dem ersten Bogen
- Jedes Etikett zeigt Titel, Autor, einen Strichcode (Code 128) der
  Signatur/des Barcodes sowie eine kleine **„Antolin“-Kennzeichnung**, wenn
  für den Titel eine Antolin-Klassenstufe hinterlegt ist (ein eigenes,
  schlichtes Kennzeichen – nicht das Marken-Logo von Antolin, siehe
  Hinweis unten)
- Auswahl mehrerer Titel gleichzeitig (Freitextsuche, „Alle Treffer
  auswählen“) – gedruckt wird je ausgewähltem Titel ein Etikett für jedes
  seiner Exemplare
- Vorschau am Bildschirm, danach Druck oder PDF-Export wie beim Mahnwesen

*Da die Entwicklungsumgebung ohne Bildschirm auskommt (siehe
[`docs/screenshots/README.md`](docs/screenshots/README.md)), war ein
Testdruck hier nicht möglich – Rand-/Rastermaße sind aus offiziellen
Produktangaben und der quelloffenen [glabels](https://github.com/samlown/glabels)-Etikettendatenbank
abgeleitet und automatisiert geprüft (`test/etiketten.test.mjs`), aber
vor dem ersten Bogen aus dem echten Etikettenpapier lohnt sich ein
Probedruck auf normalem Papier gegen das Licht.*

### Nutzerverwaltung

- Schüler:innen und Lehrkräfte, Gruppen, Zweige, Sperrungen,
  Ausleihberechtigung mit Ablaufdatum, freies **Notizen**-Feld je Nutzer:in
  (z. B. Sondervereinbarungen)
- **Ausleihsperre je Nutzer:in** direkt in der Nutzerakte: unbefristet
  ("Sperren", bleibt bis zum bewussten "Entsperren") oder befristet ("Für
  X Tage sperren", läuft danach von selbst wieder ab – Vorgabe 14 Tage,
  änderbar unter Einstellungen)
- Filter nach Klasse, Gruppe, Zweig, Status (aktiv / gesperrt / **mit
  Rückstand**) und Anzahl aktiver Ausleihen – echte Seitennavigation, Filter
  als Chips, Export als CSV/Excel
- Nutzer mit überfälligen Ausleihen sind in der Liste rot markiert
- **Schuljahresende**: ab einen Monat vor Beginn der eingetragenen
  Sommerferien erscheint auf der Übersicht ein Hinweis für die
  Abschlussklasse (Einstellung "Abschlussklasse", Vorgabe "4") mit Knöpfen
  zum Sperren bzw. – nach Sicherheitsabfrage – Verschieben in den Papierkorb

### Ausleihe & Rückgabe

- Ausleihe per Barcode-Scanner oder Tastatur, oder per **Namenssuche**:
  die Felder "Kind"/"Buch" akzeptieren Nummer oder Klartext, mit
  unscharfer, tastaturbedienbarer Vorschlagsliste ab dem zweiten Zeichen
  ("Meier" findet auch "Meyer"/"Maier") – bereits ausgeliehene Exemplare
  bleiben markiert sichtbar statt ausgeblendet zu werden
- Leihfrist je Medienart, konfigurierbare Verlängerung – verlängert sich
  außerdem automatisch um die Länge jedes Ferien-/Schließzeit-Abschnitts,
  der die Ausleihspanne berührt (Kalender- oder Schultage wählbar)
- **Ausleihlimit**: maximale Anzahl gleichzeitig offener Ausleihen pro
  Person, einstellbar unter Einstellungen → Ausleihe (Vorgabe: 0 =
  unbegrenzt)
- Rückgabe-Liste mit Volltextsuche, Filtern (nur überfällige,
  Überfälligkeit ab X Tagen, verlängert ja/nein, Klasse,
  Ausleihdatum-Zeitraum), Status-Badge pro Zeile und Export als CSV/Excel
- **Vormerkungen**: ein Titel lässt sich auf der Buchdetailseite für eine
  Person vormerken (mehrere Personen möglich, Reihenfolge nach Anmeldung).
  Leiht die vormerkende Person den Titel selbst aus, gilt die Vormerkung
  automatisch als erfüllt; leiht jemand anderes aus, erscheint ein
  Hinweis. Einstellung „Verlängerung gesperrt, wenn Buch vorgemerkt ist“
  verhindert eine Verlängerung, solange eine andere Person wartet

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

- Genau zwei Stufen: **Erinnerung** (freundlich, ans Kind gerichtet, keine
  Gebühr) und **Mahnung** (sachlich, an die Eltern gerichtet, mit Hinweis
  auf Ersatz bei Verlust) – Vorgabe: unter 7 Tagen überfällig eine
  Erinnerung, ab 7 Tagen eine Mahnung, beide Schwellen und Brieftexte
  änderbar (Platzhalter: `{Vorname}` `{Nachname}` `{Titel}` `{Tage}`
  `{Gebuehr}` `{Datum}` `{Faellig}` `{Stufe}` `{Bibliothek}`, live Vorschau
  direkt im Editor) – dazu 4 vorgefertigte **Textvorlagen** zur Auswahl
  (freundlich, bestimmt/formell, sowie zwei in **einfacher Sprache** für
  Kinder oder Nutzer:innen, denen der Standardtext schwerer verständlich
  ist)
- **Rückstandsliste** zum Abarbeiten: einstellbare Schwelle ("überfällig
  seit mindestens X Tagen", Vorgabe 1), ein Eintrag pro überfälligem Buch,
  sortierbar nach Tagen/Name/Klasse/Einstufung. Je Fall zeigt und
  übersteuert eine Checkbox rechts, ob Erinnerung oder Mahnung erstellt
  wird (vorbelegt nach der Schwelle, änderbar); "Erinnerung erstellen" und
  "Mahnung erstellen" nehmen sich aus der Auswahl automatisch nur die
  passend markierten Fälle. Vorschau vor dem Drucken, protokolliert je Fall
  welche Stufe wann verschickt wurde
- Eigener Briefkopf: Absender, E-Mail, Telefon, Betreff-Vorlage,
  Schlusstext, Logo
- Formeller Brief per **PDF-Export**, **direktem Druckauftrag**, **per
  E-Mail** (öffnet das auf dem Rechner eingerichtete Mailprogramm mit
  vorausgefülltem Betreff/Text – keine eigene Mailserver-Anbindung nötig,
  eine Mail pro Empfänger:in mit hinterlegter Adresse) oder **über
  [Element](https://element.io)** (Matrix-Messenger): die Adresse wird
  automatisch aus Vorname.Nachname und einer einstellbaren Domain gebildet
  (Vorgabe `soed.hamburg.de`), Anmeldung per Benutzername/Passwort (nur das
  dabei ausgestellte Zugangstoken wird gespeichert, nie das Passwort) oder
  direkt per Zugangstoken für ein Bot-Konto – siehe Einstellungen →
  Mahnungen

### Einstellungen

Ein Menüpunkt „Einstellungen“ mit genau drei Unterpunkten – links eine
schmale Liste, rechts der Inhalt des gewählten Punkts, keine verstreuten
Dialoge:

- **Ferien**: Übersicht bündelt zusammenhängende Tage zu Abschnitten und
  gruppiert nach Schuljahr (Accordion, standardmäßig bis aufs laufende
  zugeklappt, vergangene ausblendbar, ganzes Schuljahr auf einmal
  löschbar) – manuell gepflegt, per ICS-Datei/URL importiert oder für
  Hamburg automatisch abgerufen, mit Vorschau vor der Übernahme
  ("Schuljahr 2027/28: 6 Abschnitte, davon 2 schon vorhanden", Dubletten
  werden übersprungen). Fällt eine Ausleihfrist ganz oder teilweise in
  Ferien oder eine Schließzeit, verschiebt sich die Fälligkeit automatisch
  um deren Länge (Kalender- oder Schultage wählbar) – der Grund erscheint
  als Hinweis in der Rückgabeliste ("+12 Ferientage wegen Herbstferien").
  Zusätzlich abschaltbar: Ferientage als Verzugstage nicht mitzählen
- **Mahnungen**: die beiden Mahnstufen samt Fristen/Brieftexten (siehe
  oben), Briefkopf/Absender und der Versand über Element (Matrix)
- **Aussehen und weitere App-Einstellungen**: Oberfläche
  (macOS/Windows/KDE/GNOME/automatisch, Hell/Dunkel), Schriftgröße,
  Bibliotheksname (Platzhalter `{Bibliothek}` in Mahntexten),
  **Kopfleisten-Uhr** ein-/ausblendbar, Standard-Leihfrist und maximale
  Verlängerungen, Standard-Sperrdauer und Abschlussklasse (siehe
  Nutzerverwaltung). Dort außerdem je **Medienart** an-/abwählbar, ob sie in
  Katalog-Auswahl und -Filter überhaupt zur Wahl steht (Vorbelegung: nur
  Buch und Hörbuch/Audio-CD, alles andere ausgeblendet – bereits
  katalogisierte Titel bleiben davon unberührt), samt ihrer abweichenden
  Leih-/Verlängerungsfristen. Außerdem **Fristverschiebung** (ein
  Tage-Offset, der sofort auf jede berechnete Fälligkeit wirkt – z. B.
  `+14` während einer kurzfristigen, noch nicht als Ferieneintrag
  erfassten Schließzeit), **einmalige Verschiebung** des Ausleihdatums
  aller offenen Ausleihen um X Tage, sowie die **Datensicherung**:
  automatisches Backup einmal
  täglich beim Programmstart und vor jeder Migration (Rotation: die
  letzten 10 bleiben erhalten, zusätzlich eine Perpustakaan-kompatible
  Zip-Sicherung), dazu „Backup jetzt“ und „Sicherung einspielen“ direkt in
  den Einstellungen – Einspielen sichert vorher automatisch noch einmal
  den aktuellen Stand und startet INGA neu

### Papierkorb

Gelöschte Nutzer:innen und Exemplare landen zunächst im Papierkorb statt
endgültig verloren zu gehen – mit **Wiederherstellen** (dieselbe LeserNi/
MedienNi wie vor dem Löschen) oder **Endgültig löschen**. Ein Exemplar lässt
sich nur wiederherstellen, solange der zugehörige Titel noch existiert. Kein
automatisches Aufräumen – Einträge bleiben, bis sie bewusst entfernt werden.
(Titel selbst haben keinen Papierkorb: Löschen eines Titels nimmt alle seine
Exemplare unwiderruflich mit, siehe Warnhinweis beim Löschen.)

### Statistik

Ausleihen pro Monat (letzte 12 Monate, als Balken), pro Klasse und pro
Kategorie; **Ladenhüter** (Titel, die seit einer einstellbaren Anzahl Tage
nicht oder nie ausgeliehen wurden); **Verlustliste** (alle als „nicht
verfügbar“ markierten Exemplare mit Grund). Ladenhüter und Verlustliste
je als CSV exportierbar.

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
Import/Export. Einzige Ausnahme vom Prinzip „keine Abhängigkeiten im
Renderer“: [`JsBarcode`](https://github.com/lindell/JsBarcode) (MIT-Lizenz)
liegt als einzelne Datei unter `src/renderer/js/vendor/` und wird per
`<script>`-Tag eingebunden – für die Strichcodes auf den Etiketten, ohne
Build-Schritt oder npm-Abhängigkeit im Renderer.

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

## Starten (ohne Installation aus dem Quellcode)

Die einfachste Art, INGA zu benutzen: ein fertiges Programm für das eigene
Betriebssystem aus [Releases](https://github.com/Teyro/INGA/releases)
herunterladen (Windows-Installer/portable .exe, macOS .dmg, Linux
AppImage/.deb/.rpm) und starten – keine weitere Installation nötig.

## Aus dem Quellcode starten (für Entwicklung oder wenn kein fertiges Release passt)

Voraussetzung: [Node.js](https://nodejs.org/) Version 22 oder neuer, auf
allen drei Systemen gleich.

**Windows 11:** `start.bat` doppelklicken (oder im Explorer ausführen).
**macOS / Linux:** `./start.sh` im Terminal ausführen (einmalig
`chmod +x start.sh`, falls "Permission denied").

Beide Skripte prüfen, ob Node.js in einer passenden Version vorhanden ist,
installieren beim allerersten Start automatisch die Abhängigkeiten und
starten dann INGA – verständliche Meldung statt kryptischem Fehler, falls
etwas fehlt.

Von Hand (identisch auf allen drei Systemen):

```bash
npm install
npm start          # App starten (Splashscreen 1–3 s, dann Hauptfenster)
npm test           # Kernlogik prüfen (Datenbank, Import/Export, Ausleihregeln)
```

### Plattformunabhängigkeit im Detail

- Datenbank, Einstellungen, Backups landen im betriebssystemüblichen
  Nutzdaten-Verzeichnis, nie im Programmordner: Windows `%APPDATA%\INGA`,
  macOS `~/Library/Application Support/INGA`, Linux `~/.local/share/INGA`
  (bzw. `$XDG_DATA_HOME/INGA`).
- Alle Datei-Ein-/Ausgaben (Import/Export, Ferien-ICS, CSV/Excel-Export)
  erzwingen UTF-8 – Umlaute bleiben auf allen drei Systemen korrekt.
- CSV-Exporte für Menschen (Umlaufliste, Katalog, Nutzer, Rückgabe) nutzen
  Semikolon als Trennzeichen und eine UTF-8-BOM, damit deutsches Excel sie
  ohne Umweg richtig öffnet.
- Keine hartkodierten Pfade oder Backslashes im Code – durchgängig
  `path.join()`; Zeilenenden im Repository sind über `.gitattributes` auf
  LF normiert.

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
