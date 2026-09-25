# Änderungsprotokoll

Alle nennenswerten Änderungen an INGA, neueste zuerst. Format angelehnt an
[Keep a Changelog](https://keepachangelog.com/de/), aber auf Deutsch und mit
Blick auf das, was für den Bibliotheksalltag praktisch relevant ist.

## Unveröffentlicht

## 1.10.0 – 2026-09-25

### Neu
- **INGA-Datenbank auf einen anderen Rechner übertragen** (Import /
  Export → "INGA-Datenbank übertragen"): "Datenbank sichern …" packt den
  kompletten INGA-Stand in eine Datei (`INGA-Datenbank_<Datum>.zip`) –
  anders als der Perpustakaan-Export auch Ausleih-/Mahnhistorie,
  Sperren, Ferien, Papierkorb, Cover und die Einstellungen.
  "Datenbank einbinden …" liest so ein Paket am neuen Rechner ein; eine
  einzelne `inga.sqlite3` aus dem Datenordner eines anderen Rechners geht
  auch (eine daneben liegende `inga.sqlite3-wal` wird automatisch
  berücksichtigt). Vor dem Ersetzen zeigt INGA, was in der Datei steckt,
  und sichert den bisherigen Stand automatisch. Rechnerbezogene Angaben
  (Perpustakaan-Ordner, Element-Zugang) werden nicht mitgenommen.
- **Neues App-Symbol mit dem INGA-Avatar**, auch im Startbildschirm und
  im Abschiedsfenster.

## 1.9.1 – 2026-09-25

### Behoben
- **INGA konnte im Startbildschirm hängen bleiben.** Zwei Ursachen sind
  abgesichert: Trat beim Start ein Fehler auf (z. B. Datenbank gesperrt
  oder beschädigt), blieb bisher einfach der Startbildschirm stehen –
  jetzt erscheint eine verständliche Meldung, und INGA beendet sich
  sauber. Und meldet das Hauptfenster auf einem Rechner nie
  "fertig gezeichnet", wird es nach spätestens 10 Sekunden trotzdem
  angezeigt.
- Neu: ein Start-Protokoll (`logs/start.log` im INGA-Datenordner) hält
  jeden Startschritt und jeden Fehler fest – falls es doch noch einmal
  hakt, zeigt die letzte Zeile, wo.

## 1.9.0 – 2026-09-23

Komplette Quellcode-Durchsicht mit Fehlersuche. Keine neuen Funktionen,
aber eine ganze Reihe echter Fehler behoben – mehrere davon betrafen nur
Daten aus einer echten Perpustakaan-Sicherung und fielen deshalb mit
selbst in INGA angelegten Testdaten nicht auf.

### Behoben – wichtig
- **Automatisches Update unter Windows lief ins Leere.** Die
  Update-Beschreibung (`latest.yml`) verwies auf `INGA-Setup-….exe`,
  GitHub hatte die Datei aber als `INGA.Setup.….exe` gespeichert
  (Leerzeichen werden beim Hochladen zu Punkten) – "Jetzt
  herunterladen" scheiterte deshalb. Installer heißen jetzt
  `INGA-Setup-1.9.0.exe` bzw. `INGA-1.9.0-portable.exe`. **Von 1.5.0
  aus bitte dieses eine Mal noch von Hand installieren**, danach klappt
  das automatische Update wieder.
- **Aus Perpustakaan importierte laufende Ausleihen wurden teilweise
  übersehen:** Ein bereits verliehenes Buch ließ sich ein zweites Mal
  ausleihen, und die Nutzerakte zeigte weder offene Ausleihen noch
  Vormerkungen oder Mahnhistorie. Ursache: Nummern kamen beim Import als
  Text an, INGA vergleicht mit Zahlen. Wird beim ersten Start von 1.9
  einmalig in der Datenbank bereinigt (mit automatischer Sicherung davor)
  und bei jedem Import gleich richtig gespeichert.
- **Verlustliste und Katalogfilter "nicht verfügbar" zeigten nach einem
  Perpustakaan-Import alle Exemplare** (Perpustakaan trägt für
  "verfügbar" eine 0 ein, nicht ein leeres Feld).
- **"Verlängern" verschob das Rückgabedatum bei importierten
  Medienarten nicht** (Perpustakaan trägt als Verlängerungsfrist 0 ein).
  0 bedeutet jetzt – wie ein leeres Feld – "Vorgabe aus den
  Einstellungen".
- **"Erinnerung + Mahnung erstellen" druckte nur eine der beiden
  Gruppen**, obwohl beide als verschickt vermerkt wurden. Jetzt landen
  alle Schreiben zusammen im Druckfenster.
- **Änderungen im Mahntext-Editor gingen verloren**, sobald zwischendurch
  schon einmal gespeichert worden war (z. B. nach dem ersten Klick
  außerhalb des Textfelds) – das nächste Speichern schrieb dann wieder
  den alten Text.
- **Ein heruntergeladenes Update wurde bei langen Sitzungen nie
  installiert:** die 6-stündliche Update-Prüfung setzte den Status von
  "wird beim Beenden installiert" wieder auf "verfügbar" zurück.
- **Nummern gelöschter Nutzer/Exemplare/Titel wurden neu vergeben.** Ein
  neuer Datensatz erbte dadurch fremde Ausleih-/Mahnhistorie (beim Titel
  sogar das alte Cover), und "Wiederherstellen" aus dem Papierkorb
  überschrieb ihn stillschweigend. INGA berücksichtigt jetzt außerdem
  Perpustakaans eigenen Nummernzähler und hebt ihn beim Export an, damit
  Perpustakaan nach dem Zurückspielen keine Nummer doppelt vergibt.
- **"Ferien von URL importieren …" tat nichts** (die dafür genutzte
  Eingabeabfrage gibt es in Electron nicht) – jetzt mit eigenem
  Eingabefenster.

### Behoben – weitere
- Beim Beenden mit wartendem Update konnte INGA hängen bleiben (und
  danach den nächsten Start blockieren), falls die Installation nicht
  angestoßen werden konnte – jetzt mit Sicherheitsnetz.
- Das Abschiedsfenster blieb während der Sicherung eine leere Fläche; es
  zeigt jetzt seinen Text.
- INGA-Symbol fehlte in Startbildschirm und Abschiedsfenster des
  fertigen Programms (kaputtes Bild).
- "Sicherung einspielen": die Sicherung des aktuellen Stands davor wird
  jetzt geprüft (sonst Abbruch), Nicht-Datenbankdateien werden abgelehnt.
- Nutzerakte: "Ausleihberechtigt bis" aus Perpustakaan wurde nicht
  angezeigt und beim Speichern gelöscht.
- "Alle offenen Ausleihen verschieben" ließ die Angabe "Zuletzt
  erinnert/gemahnt" in der Rückstandsliste verschwinden.
- Ferienkalender (ICS) mit Terminen mit Uhrzeit ließen den ganzen
  Import scheitern; eine Ausleihe am letzten Ferientag wurde nicht
  verlängert.
- Cover-Suche speicherte gelegentlich eine Fehlerseite statt eines
  Bildes; gelöschte Titel hinterließen ihr Cover.
- "Java-Laufzeit reparieren" (experimentell): ein abgebrochener Download
  blieb dauerhaft kaputt liegen, eine hängende Verbindung ließ den
  Assistenten ewig warten; Lesen/Schreiben großer Perpustakaan-Datenbanken
  brach nach 30 Sekunden ab.
- Import: Zip-Dateien mit Unterordner wurden stillschweigend ignoriert,
  eine falsche Datei wurde als "erfolgreich importiert" gemeldet.
- Nach "Jetzt aus Perpustakaan lesen" waren Medienarten-/Filterlisten bis
  zum Neustart veraltet; von Perpustakaan ausgeblendete Medienarten
  wurden angezeigt.
- Einstellungen: unsinnige Zahlen (z. B. negative Leihfrist) werden
  begrenzt; Excel-Export mit Anführungszeichen im Blattnamen war
  unlesbar.
- Ausleihe/Rückgabe: das Scanfeld hat beim Öffnen der Ansicht sofort den
  Fokus; die Wochentagsfarbe der Titelleiste wechselt auch um
  Mitternacht.

## 1.5.0 – 2026-09-22

### Geändert
- **Automatische Sicherung läuft jetzt beim Beenden statt beim Start.**
  Stellte sich im echten Bibliotheksalltag als unpraktikabel heraus,
  sobald das Backup mal länger dauerte – Warten VOR dem ersten Klick ist
  ärgerlich, ein paar Sekunden länger beim ohnehin schon beendeten
  Programm kaum spürbar. Beim Beenden erscheint dafür ein kleines
  Abschiedsfenster ("Danke fürs Benutzen von INGA!") – aber NUR an dem
  Tag, an dem tatsächlich noch etwas zu sichern ist; ein gewöhnliches
  Beenden ohne anstehende Arbeit bleibt weiterhin sofort.
- **Update-Installation verschiebt sich auf das nächste Beenden.** Bisher
  fragte INGA sofort nach dem Herunterladen "jetzt neu starten?" – das
  konnte mitten in eine Ausleihe/Rückgabe platzen. Jetzt lädt INGA im
  Hintergrund herunter (nach Bestätigung im "Update verfügbar"-Dialog wie
  gewohnt), informiert nur per Toast, und installiert automatisch beim
  nächsten Beenden – nach einem eigenen, NICHT überspringbaren
  Vor-Update-Backup (Dateiname `INGA_vor-Update-Backup_<Zeitstempel>.zip`,
  wird nie automatisch mitgelöscht). Schlägt dieses Backup fehl, wird
  NICHT installiert – das Update bleibt einfach bis zum nächsten Beenden
  heruntergeladen liegen.
- Die stille Update-Prüfung nach dem Start wartet jetzt 10 statt 5
  Sekunden.

### Neu
- **5 zusätzliche Textvorschläge für Erinnerungen/Mahnungen** (jetzt 9
  insgesamt): humorvoll, sachlich-neutral und persönlich-warm als neue
  Tonlagen, dazu eine Checklisten-Form und eine ganz knappe Variante –
  nicht nur mehr vom Gleichen, auch strukturell unterschiedlich.

### Behoben (bei der erneuten Quellcode-Durchsicht gefunden)
- Ein Fehler beim Vorbereiten des Beendens (z. B. beim Erstellen des
  Abschiedsfensters) hätte INGA daran gehindert, sich überhaupt noch zu
  beenden – jetzt mit Sicherheitsnetz, das INGA in jedem Fall schließt.
- electron-updater installiert von sich aus beim Beenden, sobald ein
  Download fertig ist (eigener, standardmäßig aktiver Mechanismus) – das
  hätte theoretisch am neuen Pflicht-Backup vorbei installieren können.
  Ausdrücklich abgeschaltet (`autoInstallOnAppQuit = false`): installiert
  wird ausschließlich über den einen, backup-gesicherten Weg.
- Die zusätzliche Dokumente-Ordner-Sicherung hätte sich um einen Tag
  verzögert, wenn sie mitten am Tag eingeschaltet wird, nachdem das
  reguläre Backup bei einem früheren Beenden desselben Tages schon
  gelaufen war – jetzt unabhängig geprüft.

## 1.4.0 – 2026-09-19

Bündelt die drei Beta-Versionen 1.2.0-beta.1 bis .3 (siehe deren eigene
Abschnitte unten) als erste reguläre Version dieser Reihe, dazu:

### Behoben
- **„‚INGA' ist beschädigt und kann nicht geöffnet werden" unter
  macOS.** War kein beschädigter Download, sondern ein echter Fehler in
  der Build-Konfiguration: `mac.identity: null` ließ electron-builder die
  Signierung komplett auslassen, wodurch die von Electron selbst
  mitgebrachte (Ad-hoc-)Signatur über die von electron-builder danach
  noch veränderten Ressourcen ungültig wurde – genau das meldet
  Gatekeeper als „beschädigt", ohne die sonst übliche Möglichkeit, per
  Rechtsklick trotzdem zu öffnen. Behoben durch echtes Ad-hoc-Signieren
  (`mac.identity: "-"`, dazu `mac.hardenedRuntime: false`, wie von
  electron-builder für genau diese Kombination empfohlen) – jetzt die
  gewohnte, harmlosere „unbekannter Herausgeber"-Meldung mit
  Rechtsklick-Öffnen-Option. Ersetzt keine echte Code-Signatur/
  Notarisierung (weiterhin kein Zertifikat), siehe README „Warnung beim
  ersten Start" für die verbleibenden, plattformüblichen Klick-Schritte
  (macOS und Windows SmartScreen).
- **macOS-Build brach durch das neue Ad-hoc-Signieren zunächst komplett
  ab** ("Permission denied" beim Signieren einer Datei aus der
  mitgelieferten Java-Laufzeit, `lib/server/classes.jsa`) – manche
  Dateien im heruntergeladenen Temurin-JRE-Archiv sind schreibgeschützt,
  kein Problem beim reinen Ausführen, bricht aber das nachträgliche
  Signieren des ganzen App-Bündels. `derby-runtime-setup.js` ergänzt
  nach dem Entpacken jetzt pauschal Schreibrechte für den Eigentümer.

### Geändert
- **Electron 34 → 44** (aktuellste Version) – behebt nebenbei sämtliche
  von `npm audit` gemeldeten Sicherheitslücken in Electron und dessen
  `extract-zip`-Abhängigkeit (vorher: 2 hoch eingestufte, jetzt: keine).
  Betroffene APIs durchgesehen (Dialoge, Fenster-/Titelleisten-Optionen,
  Zwischenablage, Benachrichtigungen, native Zusatzmodule) – INGA nutzt
  keine davon auf eine Art, die von den bekannten Breaking Changes
  zwischen diesen Versionen betroffen wäre, bis auf eine kleine,
  harmlose Nebenwirkung: Dateiauswahldialoge ohne eigens gesetzten
  Startordner (z. B. „Sicherung einspielen") öffnen jetzt im
  Downloads-Ordner statt im zuletzt verwendeten Ordner (Electron-Vorgabe
  seit Version 43).

### Neu
- **„Was ist neu" im Update-Dialog**: zeigt jetzt denselben Text wie der
  zugehörige Abschnitt in diesem Änderungsprotokoll – der `release`-Job
  extrahiert ihn passend zur Versionsnummer (`scripts/changelog-extract.js`)
  und setzt ihn als GitHub-Release-Beschreibung, electron-updater
  übernimmt ihn unverändert. Bleibt zusätzlich in den Einstellungen
  sichtbar, auch nachdem der Dialog mit „Später" weggeklickt wurde.

## 1.2.0-beta.3 – 2026-09-18

### Neu
- **Titelleiste einfärben** (Einstellungen → Verschiedenes): entweder
  automatisch nach Wochentag (Montag gelb, Dienstag grün, Mittwoch blau,
  Donnerstag rot, Freitag orange, Wochenende dezentes Grau/Rosé – angelehnt
  an das in Förder-/Grundschulen verbreitete METACOM-Farbschema für
  Wochentage) oder mit einer frei gewählten eigenen Farbe. Standardmäßig
  aus (Standardfarbe wie gewohnt). Unter Windows passt sich dabei auch die
  Farbe der nativen Fensterknöpfe an, damit sie lesbar bleiben.
- **Automatische Sicherung beim Start abschaltbar** (Einstellungen →
  Aussehen → Datensicherung): wer eine eigene, bereits zuverlässige
  Sicherung hat, kann INGAs automatisches Backup beim Programmstart jetzt
  komplett ausschalten – "Backup jetzt" bleibt immer verfügbar. Die
  zusätzliche Dokumente-Ordner-Sicherung (seit 1.2.0-beta.1) wirkt nur
  noch, solange diese Grundeinstellung aktiv ist.
- **Automatische Klassenerkennung** (Einstellungen → Verschiedenes,
  standardmäßig an): trägt jemand mehrere Klassen kommagetrennt in das
  Klasse/Jahrgang-Feld ein (z.&nbsp;B. „4a,4b,4c“), zeigen Nutzerliste,
  Rückstandsliste, Im-Umlauf und Papierkorb das jetzt als saubere,
  einzeln abgesetzte Kürzel-Chips statt eines Komma-Klumpens – rein
  optisch, der gespeicherte Text bleibt unverändert. Ausgeschaltet
  erscheint das Feld exakt wie eingetragen.

### Behoben
- **Experimentell (Perpustakaan-Direktzugriff): TIMESTAMP-Werte beim
  Live-Lesen falsch formatiert.** `dump` las Zeitstempel bisher generisch
  wie jede andere Spalte, wodurch Werte exakt zur vollen Sekunde (der
  Normalfall bei Ausleih-/Fälligkeitsdatum) als `"…00:00:00.0"` statt wie
  überall sonst in INGA üblich als `"…00:00:00.000"` zurückkamen. Betraf
  nur den Live-Lesezugriff (ein normaler, von Perpustakaan selbst
  erzeugter CSV-Export war davon nie betroffen); konnte dazu führen, dass
  die Rückstandsliste eine bereits verschickte Erinnerung/Mahnung zu
  einer neu eingelesenen Ausleihe nicht mehr wiedererkannte. Gefunden und
  behoben bei einer erneuten Prüfung gegen synthetische Testdatenbanken
  (siehe `derby-bridge/README.md`).

## 1.2.0-beta.2 – 2026-09-17

### Behoben
- **Programmstart konnte minutenlang ohne sichtbares Fenster hängen.**
  Der Splashscreen entstand erst, NACHDEM sämtliche Sicherungs- und
  Perpustakaan-Prüfarbeit beim Start bereits durchgelaufen war – wer in
  dieser Zeit gar kein Fenster sah, empfand das als abgestürzte App.
  Betroffen vor allem mit aktiviertem experimentellem
  Perpustakaan-Direktzugriff: die Original-Datenbank wird dabei bei jedem
  Start komplett gezippt, das kann bei einer großen echten Datenbank
  spürbar dauern. Splashscreen erscheint jetzt SOFORT beim Start, noch
  vor jeglicher Datenbank-/Sicherungsarbeit, und zeigt eine Statuszeile
  ("Öffne Datenbank …", "Sichere Perpustakaan-Datenbank …", "Prüfe
  Perpustakaan-Zugriff …", …), damit erkennbar bleibt, wo es klemmt,
  statt nur eine unbewegte Ladeanimation zu zeigen.
- Die neue tägliche Dokumente-Ordner-Sicherung (seit 1.2.0-beta.1)
  verdoppelte praktisch die beiden bestehenden Start-Sicherungen und
  damit die Wartezeit vor dem ersten sichtbaren Fenster – läuft jetzt wie
  das automatische Cover-Nachladen erst im Hintergrund nach dem Start.
- **Splashscreen: längere Lade-Sprüche wurden am unteren Rand
  abgeschnitten** ("da kann man den Teil nicht lesen") – das Fenster war
  dafür schlicht zu klein. Etwas größer, Schriftgröße/Zeilenabstand des
  Spruchs angepasst.

## 1.2.0-beta.1 – 2026-09-15

Erste Beta dieser Reihe – neue Funktionen laufen zunächst über den
Beta-Update-Kanal (siehe "Automatische Updates" unten), bevor sie als
reguläre 1.2.0 erscheinen.

### Neu
- **Automatische Updates**: INGA prüft beim Start und danach alle paar
  Stunden im Hintergrund beim GitHub-Repository nach einer neueren
  Version, fragt aber IMMER erst nach, bevor irgendetwas heruntergeladen
  wird. Unter Windows lädt INGA ein bestätigtes Update selbst herunter und
  bietet danach einen Neustart zum Installieren an; unter macOS/Linux (wo
  INGA nicht signiert ist bzw. auf sehr unterschiedliche Arten installiert
  sein kann) öffnet sich stattdessen die Download-Seite im Browser.
  Ein-/ausschaltbar sowie manuell anstoßbar in den Einstellungen unter
  „Aussehen und weitere App-Einstellungen“ → „Wartung“.
- **Experimentell (Perpustakaan-Direktzugriff): Assistent bei fehlender
  Java-Laufzeit.** Die Fehlermeldung „Java-Laufzeit nicht gefunden/
  startbar“ ist jetzt konkret und nennt eine wahrscheinliche Ursache
  (Virenschutz/Firewall hat die mitgelieferte Laufzeit entfernt). Ein
  neuer Knopf „Java-Laufzeit reparieren“ lädt die fehlende Laufzeit direkt
  in den INGA-eigenen Programmdaten-Ordner nach, ohne Neuinstallation.
- **Zusätzliche tägliche Sicherung im Dokumente-Ordner** (`Dokumente/INGA
  Backups`, neben der gewohnten Sicherung im INGA-eigenen
  Programmdaten-Ordner) – leichter zu finden/mitzunehmen. Ein-/
  ausschaltbar in den Einstellungen (Datensicherung).
- **Wöchentliches automatisches Nachladen fehlender Cover** im
  Hintergrund, dieselben freien Bildquellen wie beim manuellen Knopf im
  Katalog. Ein-/ausschaltbar in den Einstellungen (Wartung).
- **Mahnungen: „Probe-Mahnung drucken“**. Öffnet die aktuell bearbeitete
  Mahnstufe mit erfundenen Beispieldaten im echten Druckfenster – zum
  Prüfen von Layout/Brieftext, ohne dass etwas gespeichert oder verschickt
  wird.
- **Dashboard aufgeräumt**: Kennzahlen und Schnellzugriff haben jetzt
  eigene Überschriften, dazu eine kleine Statuszeile am unteren Rand mit
  Programmversion, Zeitpunkt der letzten Sicherung und einem Hinweis, wenn
  ein Update verfügbar ist.

### Behoben
- `adm-zip` (zum Lesen/Schreiben von Zip-Dateien beim Import/Export und
  bei Sicherungen) auf 0.6.1 aktualisiert – behebt zwei öffentlich
  gemeldete Sicherheitslücken (Speicherausschöpfung durch präparierte
  Zip-Dateien, Umgehen des Zielordners über Symlink-Einträge beim
  Entpacken).

### Bekannt
- Die vom Nutzer gemeldete `spawn java ENOENT`-Meldung deutet auf eine
  echte Installation hin, bei der die mitgelieferte Java-Laufzeit trotz
  erfolgreicher CI-Builds nicht am erwarteten Ort ankommt – die genaue
  Ursache (Packaging, Virenschutz, Pfadlänge, …) ist weiterhin nicht
  abschließend geklärt. Der neue Reparatur-Assistent umgeht das Problem
  zuverlässig, statt die Ursache weiter zu vermuten.

## 1.1.1 – 2026-09-15

### Behoben
- **"Bestätigen"-Knöpfe (Ausleihen, Speichern, Drucken, …) unter Windows
  komplett unsichtbar im Ruhezustand** – eigentliche Ursache war ein
  CSS-Spezifitäts-Problem: die Windows-Regel für den normalen
  Knopf-Hintergrund war (unbeabsichtigt) spezifischer als die Regel für
  "Bestätigen"-Knöpfe und hat deren Farbe deshalb IMMER überschrieben,
  unabhängig von der Reihenfolge im Stylesheet – vorher nur als blasses
  Grau sichtbar. Der Fix aus Version 1.1.0 (deckender statt blasser
  Hintergrund) hat das versehentlich von „blass“ zu „komplett unsichtbar“
  verschlimmert, statt die eigentliche Ursache zu beheben. Jetzt richtig
  korrigiert (niedrigere CSS-Spezifität der Windows-Regel); betraf
  nebenbei auch den Hover-/Klick-Zustand normaler Knöpfe sowie
  „ghost“-Knöpfe unter Windows, die dieselbe Ursache hatten.
- **Farbe der "Bestätigen"-Knöpfe überarbeitet**: ruhig blau im
  Normalzustand (dieselbe Farbe wie Fokusringe/aktive Navigation),
  kräftiges Orange beim Überfahren mit der Maus – auf Nutzerwunsch statt
  durchgehend Orange.

## 1.1.0 – 2026-09-15

### Neu
- **Mahnungen: WYSIWYG-Brieftext-Editor mit Reitern**. Statt eines
  kleinen, vierzeiligen Textfelds jetzt ein deutlich größeres
  contenteditable-Feld mit eigener Werkzeugleiste (fett/kursiv/
  unterstrichen sowie ein Menü zum Einfügen der `{Platzhalter}`) – die
  Formatierung erscheint tatsächlich im gedruckten/als PDF exportierten
  Brief. Erinnerung und Mahnung stehen jetzt als zwei Reiter übereinander
  statt beide gleichzeitig untereinander (war „sehr winzig und
  unübersichtlich“). E-Mail- und Element-Versand (können kein Fett/
  Kursiv darstellen) bekommen automatisch die reine Textfassung.

### Behoben
- **Rückgabe-Suche funktionierte für Buchnummern gar nicht**: das Suchfeld
  durchsuchte nur Titel und Namen, eine Buchnummer/Signatur fand es
  überhaupt nicht – wirkte, als würde die Suche gar nicht reagieren.
  Zusätzlich gab es dort bisher drei kaum unterscheidbare Eingabefelder
  (Suche, Barcode-Rückgabe, Barcode-Verlängerung); jetzt EIN Suchfeld für
  Name, Titel und Buchnummer zusammen. Ein gescannter Barcode gibt bei
  genau einem Treffer weiterhin per Enter sofort zurück (auch bei sehr
  schnell scannenden Barcode-Scannern zuverlässig, vorher ein
  Zeitfenster-Fehler möglich).
- **Knöpfe unter Windows kaum sichtbar** („grau unterlegt, erst beim
  Drüberfahren färbt er sich ein“): der ruhende Zustand nutzte eine sehr
  blasse 4-6-%-Abtönung, die für eine echte Mica-Textur gedacht war, auf
  dem hier tatsächlich flachen Fensterhintergrund aber kaum zu erkennen
  war. Jetzt derselbe deutlich sichtbare Knopfhintergrund wie auf
  macOS/Linux.

## 1.0.0 – 2026-09-12

### Neu
- **Direkter Zugriff auf die echte Perpustakaan-Datenbank (experimentell)**:
  bisher nur auf einem separaten internen Branch, jetzt zusammengeführt.
  Unter Einstellungen → „Experimentell ⚠️“ (deutlich gekennzeichnet,
  standardmäßig AUS) lässt sich INGA direkt mit der echten, live
  verwendeten Apache-Derby-Datenbank von Perpustakaan verbinden –
  „Jetzt aus Perpustakaan lesen“ und „Jetzt in Perpustakaan schreiben“
  statt nur über Zip-Sicherungen. Dafür bringt INGA eine kleine,
  mitgelieferte Java-Brücke mit (es gibt keinen Node-Treiber für Derby);
  die dafür nötige Java-Laufzeit wird bei jedem Build automatisch bezogen
  (nicht Teil des Quellcodes).
  - Erkennt zuverlässig, ob Perpustakaan die Datenbank gerade selbst
    geöffnet hält (Derbys Embedded-Engine erlaubt ohnehin nur einer JVM
    gleichzeitig Zugriff) und verweigert den Zugriff in dem Fall, statt
    etwas Unmögliches zu versuchen – INGA arbeitet währenddessen mit der
    zuletzt importierten eigenen Kopie weiter.
  - Vor jedem Programmstart mit aktiviertem Zugriff UND unmittelbar vor
    jedem einzelnen Schreibversuch: vollständige Sicherung der
    Original-Datenbank, deren Erfolg auch tatsächlich geprüft wird –
    schlägt sie fehl, wird nichts geschrieben.
  - **Wichtig**: gegen eine selbst gebaute Testdatenbank ausführlich
    geprüft (siehe `derby-bridge/README.md`), aber noch **nie gegen eine
    echte Perpustakaan-Installation**. Vor dem ersten Einsatz mit echten
    Daten unbedingt zuerst an einer **Kopie** der echten Datenbank
    ausprobieren, nicht am Original.

## 0.8.6 – 2026-09-12

### Neu
- **„Im Umlauf“ um Telefonnummern und Medienart erweitert**: der Ausdruck
  (und CSV-/XLSX-Export) zeigt jetzt zusätzlich Telefon privat/
  geschäftlich sowie die Medienart-Kurzbezeichnung je Zeile – nachgezogen
  aus einer vom Nutzer gezeigten Perpustakaan-Säumnisliste, die diese
  Angaben enthielt. Kind und Buch stehen dafür jetzt platzsparend
  zweizeilig (Name/Klasse bzw. Titel/Autor) statt in eigenen breiten
  Spalten, damit trotz mehr Information nichts unübersichtlicher wird.

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
