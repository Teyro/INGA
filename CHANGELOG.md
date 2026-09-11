# Änderungsprotokoll

Alle nennenswerten Änderungen an INGA, neueste zuerst. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/), aber auf Deutsch und mit
Blick auf das, was für den Bibliotheksalltag praktisch relevant ist.

## Unveröffentlicht

## 0.8.5 – 2026-09-11

### Neu
- **4. Etikettenformat: Zweckform/Avery L4732REV** (35,6 × 16,9 mm,
  80/Bogen, Layout 5 × 16) – nachgebaut nach einem vom Nutzer
  fotografierten Original-Bogen. Zu klein für Titel/Autor: zeigt nur die
  Etikettnummer über dem Strichcode, wie auf den bereits im Einsatz
  befindlichen Etiketten dieses Formats.

## 0.8.0 – 2026-09-11

### Neu
- **„Im Umlauf“-Ausdruck überarbeitet**: zeigt jetzt zusätzlich die
  Ausleihe-Nummer je Zeile, und im Briefkopf oben das in den
  Mahnungs-Einstellungen hinterlegte Bibliothekslogo sowie Datum/Uhrzeit
  im Stil der bisherigen Rückstandslisten-Ausdrucke.
- **Mahnungen: „Erinnerung + Mahnung erstellen“**: neuer, jetzt
  hervorgehobener Knopf, der eine gemischte Auswahl (manche Fälle als
  Erinnerung, andere als Mahnung markiert) in einem Rutsch erledigt –
  bisher mussten dafür nacheinander beide einzelnen Knöpfe geklickt
  werden. Die beiden einzelnen Knöpfe „Nur Erinnerungen erstellen“/„Nur
  Mahnungen erstellen“ bleiben für den Fall, dass gezielt nur eine Sorte
  gedruckt werden soll – alle drei jetzt mit einheitlicher, korrigierter
  Knopffarbe (vorher: einer der beiden grau, einer orange, ohne
  erkennbaren Grund für den Unterschied).
- **Schnelle Verlängerung per Buchnummer**: neues Eingabefeld in der
  Rückgabe-Ansicht sowie ein Schnellzugriff-Knopf auf der Startseite –
  Nummer eintippen oder scannen, Enter oder Klick auf „Verlängern“,
  fertig, ohne die Zeile erst in der Liste suchen zu müssen.

## 0.7.0 – 2026-09-10

### Neu
- **Buchdaten automatisch beim Katalogisieren ergänzen**: sobald beim
  Anlegen eines neuen Titels im ISBN-Feld eine vollständige, gültige ISBN
  steht (getippt oder per Scanner eingelesen), werden Titel/Untertitel/
  Autor/Verlag/Erscheinungsjahr automatisch nachgeschlagen und in die noch
  leeren Felder eingetragen – ganz ohne eigenen Knopf-Klick. Bereits
  eingetippte Angaben werden nie überschrieben, gespeichert wird
  weiterhin erst durch bewusstes Bestätigen. Die Nachschlage-Quelle nutzt
  jetzt zusätzlich Google Books als zweite Chance, wenn Open Library
  nichts findet (siehe „Buchdaten per ISBN nachschlagen“ oben im
  Katalog). Der bestehende Knopf „Buchdaten übernehmen“ bleibt für
  bestehende Titel und ein bewusstes erneutes Nachschlagen erhalten.
  (Vorschläge bereits während des Tippens einzelner ISBN-Ziffern wurden
  geprüft, sind mit den verfügbaren kostenlosen Quellen aber nicht
  zuverlässig möglich – Google Books blockt anonyme Anfragen schnell,
  und keine der beiden Quellen unterstützt eine ISBN-Teilzeichenketten-
  Suche.)

## 0.6.0 – 2026-09-10

### Neu
- **Cover-Suche: DuckDuckGo und Qwant als zusätzliche Quellen**. Findet
  weder Open Library noch Google Books ein Cover zur ISBN (kleine/
  regionale Verlage, Lehr-/Arbeitshefte, ältere Ausgaben), probiert INGA
  jetzt zusätzlich die allgemeine Bildersuche von DuckDuckGo und Qwant –
  per Titel/Autor statt ISBN, da beide keine ISBN-Datenbank sind. Beide
  sind kein offiziell dokumentiertes Interface (dieselben Anfragen wie die
  jeweils eigene Weboberfläche), deshalb bewusst nur als letzte
  Rückfallebene hinter den beiden echten Buch-APIs, mit derselben
  Fehlertoleranz wie jede andere Quelle: liefert eine nichts, wird ohne
  Umweg die nächste probiert. Qwant blockiert Anfragen ohne echten Browser
  inzwischen per Bot-Erkennung (Captcha) und liefert deshalb in der Praxis
  meist kein Ergebnis – bleibt trotzdem als kostenloser, für den Ablauf
  ungefährlicher Versuch in der Kette, falls sich das wieder ändert.

## 0.5.0 – 2026-09-09

### Neu
- **Medienarten aus- und einblenden**: unsere Bücherei verleiht nur Bücher
  und Hörbuch-/Audio-CDs – Katalog-Auswahl (Neuanlage/Bearbeiten) und
  -Filter zeigen deshalb standardmäßig nur diese beiden, alle anderen
  Medienarten (Zeitschrift, DVD, Spiel, Software, …) sind ausgeblendet.
  Einzeln wieder einblendbar unter Einstellungen → Aussehen und weitere
  App-Einstellungen → Medienarten, direkt neben den schon vorhandenen
  Leih-/Verlängerungsfristen je Medienart. Bereits katalogisierte Titel
  bleiben unabhängig davon immer sichtbar/bearbeitbar. Nutzt ein natives,
  bisher ungenutztes Perpustakaan-Feld (`MedArt.verbergen`) – bleibt beim
  Export/Import erhalten, eine echte Perpustakaan-Sicherung liefert es
  aber praktisch immer leer, weshalb der Import fehlende Werte einmalig
  nach Bezeichnung vorbelegt (bestehende Datenbanken erhalten dieselbe
  Vorbelegung per Migration).

## 0.4.0 – 2026-09-09

### Neu
- **Kopfleisten-Uhr**: Digitaluhr mit Sekunden oben rechts, warnt kurz vor
  Pausenende (10:15–10:18 Uhr gelb, 10:18–10:19 Uhr orange, 10:19–10:20 Uhr
  rot-blinkend, danach wieder normal) – ein-/ausblendbar unter Einstellungen
  → Aussehen und weitere App-Einstellungen.
- **Ausleihsperre je Kind**: in der Nutzerakte unbefristet („Sperren“) oder
  befristet („Für X Tage sperren“, Vorgabe 14 Tage, änderbar) sperrbar –
  eine befristete Sperre läuft von selbst wieder ab. Der bestehende Filter
  „Gesperrt“ in der Nutzerliste berücksichtigt das mit (Datenbank-Migration
  Version 8, `Leser.IngaGesperrt`/`IngaGesperrtBis`, zusätzlich zu den
  bestehenden Perpustakaan-Feldern `SperrungNi`/`AusleihBis`).
- **Schuljahresende-Meldung**: ab einen Monat vor Beginn der eingetragenen
  Sommerferien ein Hinweis auf der Übersicht für die Abschlussklasse
  (Einstellung „Abschlussklasse“, Vorgabe „4“) mit Knöpfen zum Sperren bzw.
  – nach Sicherheitsabfrage – Verschieben in den Papierkorb.
- **Perpustakaan-kompatible Zip-Sicherung beim Start**: zusätzlich zur
  eigenen .sqlite3-Sicherung legt INGA jetzt einmal täglich beim
  Programmstart auch eine `perpustakaan_backup_…zip` im selben
  Sicherungsordner an – für den Fall, dass die Daten einmal wieder in einer
  echten Perpustakaan-Installation gebraucht werden.
- Mahnungen: neue Sortierung „Mahnung/Erinnerung“ – gruppiert die
  Rückstandsliste so, dass beide Einstufungen jeweils für sich beieinander
  stehen (Mahnung-Gruppe zuerst), innerhalb einer Gruppe weiter nach Tagen
  überfällig.

### Behoben
- **Import laufender Ausleihen aus echten Perpustakaan-Sicherungen**: das
  Original führt laufende („Ausleihe“, „Rueckgabe“ = Fälligkeit) und
  abgeschlossene Ausleihen („AuslHist“, „Rueckgabe“ = tatsächliches
  Rückgabedatum) in zwei getrennten Tabellen. Beim Import wurde
  „Ausleihe.csv“ bisher 1:1 spaltenweise übernommen – jede laufende
  Ausleihe hatte danach fälschlich ein gesetztes „Rueckgabe“ und galt als
  bereits zurückgegeben, die komplette Rückgabehistorie („AuslHist“, keine
  INGA-native Tabelle) ging unbemerkt verloren. Import und Export führen
  beide Tabellen jetzt korrekt zusammen bzw. spalten sie wieder auf.
- Deaktivierte „Bestätigen“-Knöpfe (`.button.primary:disabled`) wurden per
  Transparenz abgedunkelt – mischte sich mit dem Hintergrund zu einem
  unklaren „Grau mit Orange-Stich“ statt erkennbar „gerade nicht
  klickbar“. Jetzt eine feste, eindeutige Deaktiviert-Optik, auch in den
  Druckfenstern.
- Buchdetail (Katalog): das feste Seitenpanel neben der Trefferliste
  scrollte auf kleineren Bildschirmen unabhängig von der Liste und lag oft
  weit weg von der angeklickten Zeile. Das Detail klappt jetzt immer direkt
  unter der gewählten Zeile auf und scrollt sich danach von selbst ins
  Bild – keine Fensterbreiten-Fallunterscheidung mehr nötig.
- Sprung vom Dashboard/Statistik zu einem Titel im Katalog blieb wirkungslos,
  wenn dieser gerade durch eine andere Seite/Suche/Filter verdeckt war (die
  Detailzeile hätte sich unter eine gar nicht sichtbare Tabellenzeile
  hängen müssen). Der Sprung setzt die Katalog-Filter jetzt selbst zurück
  und sorgt so dafür, dass der Titel garantiert im Treffer steht.
- Mahnungen: das Ankreuzen/Entfernen von „Mahnung“ bei einer einzelnen Zeile
  wirkte sich bei der Sortierung „Mahnung/Erinnerung“ erst nach dem
  nächsten Such- oder Filterwechsel auf die Gruppierung aus.
- Katalog: schnell aufeinanderfolgende Auswahl (z. B. gehaltene Pfeiltaste)
  konnte dazu führen, dass die aufgeklappte Detailzeile zur falschen Zeile
  gehörte, wenn eine ältere Anfrage später als eine neuere fertig wurde.

## 0.3.0 – 2026-09-09

### Neu
- **Einstellungen zusammengefasst**: ein Menüpunkt „Einstellungen“ mit genau
  drei Unterpunkten (Ferien / Mahnungen / Aussehen und weitere
  App-Einstellungen) statt verstreuter Dialoge – links eine schmale Liste,
  rechts der Inhalt. Neue Felder Schriftgröße und Bibliotheksname (neuer
  Platzhalter `{Bibliothek}` in Mahntexten).
- **Ferien**: Übersicht bündelt zusammenhängende Tage zu Abschnitten und
  gruppiert nach Schuljahr (Accordion, standardmäßig bis aufs laufende
  zugeklappt, vergangene ausblendbar, ganzes Schuljahr auf einmal löschbar).
  Import zeigt vorher, was dazukommt, und überspringt Dubletten. **Der
  eigentliche Zweck der Ferienverwaltung**: eine Ausleihfrist verlängert
  sich jetzt automatisch um die Länge jedes Ferien-/Schließzeit-Abschnitts,
  der die Ausleihspanne berührt (Kalender- oder Schultage wählbar) – wirkt
  auch auf Mahnfristen.
- **Buchdetail ruhiger**: fester Detailbereich neben der Trefferliste statt
  eines Flyouts darüber (Accordion-Fallback bei schmalem Fenster). Liste
  bleibt sichtbar und behält ihre Scrollposition, Pfeiltasten/Escape
  bedienbar, Status (verfügbar/ausgeliehen an wen/bis wann) steht vor den
  reinen Katalogdaten.
- **Ausleihe mit Namenssuche**: die Felder „Kind“/„Buch“ akzeptieren jetzt
  Nummer oder Klartext, mit unscharfer, tastaturbedienbarer Vorschlagsliste
  (neues `suche.js`, Levenshtein-basiert, ohne neue Abhängigkeit – findet
  „Meier“ auch bei „Meyer“/„Maier“). Bereits ausgeliehene Exemplare bleiben
  markiert sichtbar statt ausgeblendet zu werden.
- **Mahnungen überarbeitet**: nur noch zwei Stufen (Erinnerung ans Kind,
  Mahnung an die Eltern, Vorgabe ab 7 Tagen). Rückstandsliste mit
  einstellbarer Schwelle und je Fall übersteuerbarer Erinnerung/Mahnung-
  Markierung (Checkbox rechts in der Zeile), Sammel-Erstellung je Kind mit
  Vorschau vor dem Drucken, protokolliert je Fall, welche Stufe wann
  verschickt wurde (Datenbank-Migration Version 7, `Mahnung.IngaStufe`).
- **Buchcover aus mehreren Quellen**: probiert jetzt Open Library und danach
  Google Books. Nach jedem Bestandsimport aktive Nachfrage, ob die Cover
  gleich mit heruntergeladen werden sollen; neue Titel mit ISBN/EAN suchen
  ihr Cover automatisch im Hintergrund. Generisches Platzhalterbild ersetzt
  die bisherige Emoji-Notlösung.
- **Kopfleisten-Uhr**: Digitaluhr mit Sekunden oben rechts, warnt kurz vor
  Pausenende (10:15–10:18 Uhr gelb, 10:18–10:19 Uhr orange, 10:19–10:20 Uhr
  rot-blinkend, danach wieder normal) – ein-/ausblendbar.
- **Ausleihsperre je Kind**: in der Nutzerakte unbefristet („Sperren“) oder
  befristet („Für X Tage sperren“, Vorgabe 14 Tage, änderbar) sperrbar –
  eine befristete Sperre läuft von selbst wieder ab. Der bestehende Filter
  „Gesperrt“ in der Nutzerliste berücksichtigt das mit (Datenbank-Migration
  Version 8, `Leser.IngaGesperrt`/`IngaGesperrtBis`).
- **Schuljahresende-Meldung**: ab einen Monat vor Beginn der eingetragenen
  Sommerferien ein Hinweis auf der Übersicht für die Abschlussklasse
  (Einstellung „Abschlussklasse“, Vorgabe „4“) mit Knöpfen zum Sperren bzw.
  – nach Sicherheitsabfrage – Verschieben in den Papierkorb.

### Behoben
- `searchLeser`: ein SQL-Bug (Drei-Wert-Logik bei NULL-Vergleichen) ließ
  Nutzer:innen ohne jede Sperre im Filter „Aktiv“ fälschlich gar nicht
  auftauchen.
- Mahnungen: eine per Checkbox gesetzte Erinnerung/Mahnung-Übersteuerung
  ging beim Neu-Rendern der Rückstandsliste (Suche/Filter, oder nach dem
  ersten der beiden „…erstellen“-Knöpfe) wieder verloren.
- Druckfenster (Mahnungen/Im Umlauf/Etiketten) hatten `app.css` nie
  mitgeladen und zeigten dadurch unstylisierte Browser-Standardknöpfe ohne
  jeden Kontrast – jetzt mit denselben Stilen wie das Hauptfenster, dazu
  eine eigene, kräftige Farbe für alle „Bestätigen“-Knöpfe.

## 0.2.0 – 2026-09-09

### Neu
- **Mahnungen über Element (Matrix) verschicken**: vierte Option neben
  Druck/PDF/E-Mail im Mahnungen-Druckfenster. Adresse wird automatisch aus
  Vorname.Nachname der/des Angemahnten und einer einstellbaren Domain
  gebildet (Vorgabe `soed.hamburg.de`), vor dem Senden wird geprüft, ob
  unter dieser Adresse überhaupt ein Konto existiert. Anmeldung per
  Benutzername/Passwort in den Einstellungen – nur das dabei ausgestellte
  Zugangstoken wird gespeichert, nie das Passwort selbst – oder direkt per
  Zugangstoken für ein eigenes Bot-Konto. Homeserver wird automatisch per
  `.well-known/matrix/client` ermittelt, mit manuellem Override. Direkt-
  nachrichten-Raum wird beim ersten Kontakt angelegt und danach
  wiederverwendet statt bei jeder Mahnung neu. Keine neue Abhängigkeit
  (reines `fetch()` gegen die Matrix-Client-Server-API). Neue Tests
  (`test/matrix.test.mjs`, gemocktes `fetch`).
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
