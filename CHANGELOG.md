# Änderungsprotokoll

Alle nennenswerten Änderungen an INGA, neueste zuerst. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/), aber auf Deutsch und mit
Blick auf das, was für den Bibliotheksalltag praktisch relevant ist.

## Unveröffentlicht

### Neu
- **Easter Egg in der Kopfleiste**: neben „INGA" steht jetzt ein zufälliger
  Spruch (dieselbe Liste wie der Splashscreen, jetzt in `sprueche.js`
  gemeinsam genutzt) – ein Klick zeigt einen neuen, nie zweimal
  hintereinander denselben.
- **Etikettendruck massiv ausgebaut**: eigener Bereich „Etiketten“ in der
  Seitenleiste (Titel suchen, mehrere ankreuzen, je Titel ein Etikett pro
  Exemplar) plus Schnellzugriff auf der Buchdetailseite (einzelnes Exemplar
  oder „Alle Etiketten drucken“). 3 echte Zweckform-/Avery-Bogenformate
  (3475, L7160, 3651) mit Rand-/Rasterabstand aus den offiziellen
  Produktmaßen, Startposition für angebrochene Bögen, Code-128-Strichcode
  je Etikett (`JsBarcode`, vendored, MIT-Lizenz) sowie eine kleine
  „Antolin“-Kennzeichnung bei hinterlegter Antolin-Klassenstufe. Vorschau,
  Druck und PDF-Export wie beim Mahnwesen. Neue Geometrie-Tests
  (`test/etiketten.test.mjs`).
- **Papierkorb für Nutzer:innen und Exemplare** (Datenbank-Migration Version
  6, Tabellen `LeserAbg`/`MedienAbg`): Löschen verschiebt die Zeile zunächst
  in den Papierkorb (neuer Bereich unter System) statt sie endgültig zu
  entfernen – „Wiederherstellen" (gleiche LeserNi/MedienNi wie vorher) oder
  „Endgültig löschen". Ein Exemplar lässt sich nur wiederherstellen, solange
  der zugehörige Titel noch existiert. Entspricht der von Perpustakaan
  Professional beworbenen Funktion „Papierkorb für Medien und Leser mit
  Wiederherstellungsmöglichkeit" (in Perpustakaan Light nicht enthalten).
- **Mahnungen per E-Mail**: dritte Option neben Druck/PDF im
  Mahnungen-Druckfenster – öffnet für jede Person mit hinterlegter
  E-Mail-Adresse das Standard-Mailprogramm mit vorausgefülltem Betreff und
  Brieftext. Keine eigene Mailserver-Anbindung (kein Konto/Passwort in
  INGA), entspricht sinngemäß „Mahn-Emails" aus Perpustakaan Professional.
- **Antolin-Klassenstufe** je Titel (Katalog-Feld `KlasseAnto`) – sinngemäß
  „Antolin-Unterstützung" aus Perpustakaan Professional; das Pendant auf
  Exemplarebene (`AntolinEti`, ein Etikett pro physischem Exemplar) wurde
  nicht übernommen, da es dafür noch keine Einzel-Exemplar-Bearbeitung in
  INGA gibt und im vorliegenden Bestand nie befüllt war.
- **Ausleihlimit**: neue Einstellung „Max. gleichzeitige Ausleihen pro
  Person" (Vorgabe: 0 = unbegrenzt) unter Einstellungen → Ausleihe. Greift
  beim Ausleihen mit einer klaren Fehlermeldung, unabhängig von Medienart
  oder Klasse.
- **Notizen-Feld je Nutzer:in**: freies Textfeld in der Nutzerakte, z. B. für
  Sondervereinbarungen oder Hinweise für das Bibliotheksteam. Entspricht dem
  `Notizen`-Feld im Perpustakaan-Format, war dort schon immer vorhanden, in
  INGA aber bislang nicht editierbar.
- **Mehrere Brieftext-Vorlagen im Mahnstufen-Editor**: 4 vorgefertigte Texte
  zur Auswahl (Freundliche Erinnerung, Bestimmt/formell, sowie zwei in
  einfacher Sprache – kurz und mit Erklärung), per Klick in den Brieftext
  einer Stufe übernehmbar. Der bisherige freie Brieftext bleibt unverändert
  erhalten, die Vorlagen sind nur ein Ausgangspunkt.
- Rahmenlose Kopfleiste (GNOME): Minimieren- und Maximieren-Knopf ergänzt,
  bislang war nur Schließen verdrahtet.
- **Ferienverwaltung**: eigener Bereich „Ferien & Schließzeiten" in den
  Einstellungen – manuelle Pflege, ICS-Import (Datei/URL), automatischer
  Abruf der Hamburger Schulferien/Feiertage. Fällt eine berechnete
  Rückgabefrist in einen Ferien-/Feiertagszeitraum oder auf ein Wochenende,
  verschiebt INGA sie automatisch auf den nächsten echten Schultag – auch
  über mehrere aneinandergrenzende Zeiträume hinweg. Neue Einstellung
  „Während der Ferien keine Überfälligkeit zählen".
- **„Im Umlauf"**: neue Ansicht mit allen offenen Ausleihen (Titel, Autor,
  Signatur, Kind, Klasse, Daten, Tage überfällig, Verlängerungen),
  gruppierbar nach Klasse/Kind, druckbar (A4 quer, Kopf-/Fußzeile mit
  Seitenzahl) und exportierbar als CSV/Excel.
- **CSV-/Excel-Export** für Katalog, Nutzer, Rückgabe und Umlaufliste –
  Excel-freundliches CSV (Semikolon, UTF-8-BOM) sowie ein eigener, minimaler
  XLSX-Schreiber (Kopfzeile fett, Autofilter, Spaltenbreiten).
- **Erweiterte Filter**: Katalog (Kategorie, Standort, Klassenstufe, Status
  inkl. „überfällig"/„nicht verfügbar"), Nutzer (Klasse, aktive Ausleihen),
  Rückgabe (Zeitraum, Überfälligkeit ab X Tagen, verlängert ja/nein,
  Klasse) – als entfernbare Filter-Chips mit „Alle Filter zurücksetzen".
- **Datensicherung in den Einstellungen**: Liste vorhandener Backups,
  „Backup jetzt", „Sicherung einspielen" (aus der Liste oder aus einer
  Datei).
- Mahngebühren komplett abschaltbar (Vorgabe: aus) – Mahnungen bleiben als
  Erinnerung erhalten, nur ohne Geldbeträge.
- Standard-Ausleihfrist auf 7 Tage, Verlängerungsdauer und maximale Anzahl
  Verlängerungen konfigurierbar, abweichende Fristen je Medienart.
- Start-Skripte `start.sh`/`start.bat` für alle drei Systeme (prüfen
  Node.js, installieren Abhängigkeiten beim ersten Start).

### Geändert
- Katalog- und Nutzerliste: echte Seitennavigation (25/50/100/250/Alle)
  statt einer festen Höchstzahl.
- Unter Linux landen Datenbank/Einstellungen/Backups jetzt in
  `~/.local/share/INGA` statt in Electrons Vorgabe `~/.config/INGA` – passend
  zur XDG-Konvention für Nutzdaten.

### Behoben
- **Rahmenlose Kopfleiste (GNOME) hatte nur einen Schließen-Knopf** –
  Minimieren und Maximieren/Wiederherstellen waren im Hauptprozess und
  Preload bereits vollständig angebunden, aber in der Oberfläche nie
  verdrahtet; ohne native Fensterdekoration ließ sich das Fenster unter
  GNOME dadurch weder minimieren noch maximieren.
- **Katalog/Nutzer zeigten nie mehr als 300 Treffer an** (hartes `LIMIT`
  ohne Seitennavigation) – ab dem 301. Titel/Nutzer war er schlicht nicht
  mehr auffindbar.
- **Zurückgegebene Bücher verschwanden nie aus der Rückgabe-Liste** und
  konnten dauerhaft als „überfällig" auftauchen (fehlende
  `Rueckgabe IS NULL`-Bedingung).
- **Falsche Mahnstufe** konnte gewählt werden, sobald die Stufen nicht nach
  Tagen aufsteigend sortiert waren (passiert automatisch, sobald man eine
  weitere Stufe hinzufügt).
- Löschen von Titel/Exemplar/Nutzer mit einer noch laufenden Ausleihe ließ
  die Ausleihe verwaist zurück – wird jetzt verweigert.
- Keine Eindeutigkeitsprüfung für Barcode/Signatur eines Exemplars – zwei
  gleiche Codes ließen sich anlegen.
- Zeitzonenfehler in der Fristberechnung (`new Date().toISOString()`
  lieferte das UTC- statt das lokale Datum, verschob Fristen in Deutschland
  regelmäßig um einen Tag) sowie an mehreren weiteren Stellen mit
  Datei-Vorschlagsnamen/Vorschauen.
- Barcode-Ausleihe fiel bei einem Tippfehler auf eine unscharfe Treffer
  zurück, statt „kein Treffer" zu melden.
- Zahlreiche technische Fehler (Dateisystem, Datenbank) erschienen als
  englische Rohmeldung statt eines verständlichen deutschen Satzes.

## Erster Stand

- Katalog, Exemplare, Nutzer:innen, Ausleihe/Rückgabe/Verlängerung,
  mehrstufiges Mahnwesen mit PDF-/Druckausgabe, Buchcover per ISBN,
  Import/Export im Perpustakaan-Format, native Optik je Betriebssystem.
