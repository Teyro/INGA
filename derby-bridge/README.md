# derby-bridge – EXPERIMENTELL (Branch `feature/perpustakaan-live-db`)

Kleines Java-Programm, das Node (INGA) den direkten Zugriff auf eine echte
Perpustakaan-Datenbank (Apache Derby, embedded) erlaubt. Node hat keinen
Derby-Treiber – Derby ist reines Java und spricht nur JDBC oder seinen
eigenen Netzwerkserver, den Perpustakaan nicht nutzt. Siehe
`src/main/perpustakaan-live.js` für die Node-Seite (startet dieses Programm
als eigenen Prozess, redet über Kommandozeile + eine JSON-Zeile auf stdout).

## Bauen

Braucht ein volles JDK (nicht nur die JRE, die `scripts/setup-derby-runtime.js`
für den *Betrieb* herunterlädt – die kann nicht kompilieren):

```sh
javac -cp derby-runtime/derby-jars/derby.jar:derby-runtime/derby-jars/derbyshared.jar \
      -d derby-bridge/classes derby-bridge/src/Bridge.java
```

(`derby-runtime/` vorher per `npm run setup:derby-runtime` befüllen, oder
ein beliebiges JDK 11+ mit den Derby-10.17-Jars verwenden.)

Die kompilierten `.class`-Dateien sind bewusst **mit ins Repository
eingecheckt** (`derby-bridge/classes/`, wenige KB) – anders als
`derby-runtime/` (Java-Laufzeit + Jars, ~150 MB, siehe `.gitignore`) gibt es
dafür keinen laufenden CI-Kompilierschritt. Nach einer Änderung an
`Bridge.java` das Kommando oben erneut ausführen und die neuen `.class`-
Dateien mit committen.

## Protokoll

Einmal-Aufrufe (eine JSON-Zeile auf stdout, dann Ende):

```
check <dbPfad>                          -> {"ok":true} | {"ok":false,"gesperrt":true} | {"ok":false,"fehler":"…"}
dump  <dbPfad> <schemaDatei> <zipZiel>  -> {"ok":true,"tabellen":N,"hash":"…","fehlend":[…]} | …
load  <dbPfad> <zipQuelle>              -> {"ok":true,"tabellen":N} | …   (nur noch Altweg, INGA nutzt apply)
```

Dauerbetrieb (Perpustakaan-Modus): `serve` liest Aufträge zeilenweise von
stdin (`<id>\t<befehl>\t<arg>…`, UTF-8) und antwortet je Auftrag mit einer
JSON-Zeile samt `"id"`. Befehle: `open <dbPfad> <leerlaufMs>`, `check`,
`dump`, `apply <aenderungsDatei>`, `load`, `close`, `quit`. Die Datenbank
bleibt zwischen dicht aufeinanderfolgenden Aufträgen offen und wird nach
`leerlaufMs` wieder freigegeben (Derby lässt nur EINE JVM hinein).

`apply`: Einzeländerungen (Format siehe Kommentar an `Sitzung.apply()`),
alles in einer Transaktion. Tabellen mit Primärschlüssel: UPDATE nur der
geänderten Spalten, DELETE/INSERT über den Schlüssel, INSERT auf einen schon
vergebenen Schlüssel = `{"konflikt":true}`. Ohne Primärschlüssel (AuslHist):
Zeilen über alle vergleichbaren Spalten (keine CLOB/BLOB).

**Echte Perpustakaan-Datenbank**: Tabellen/Spalten UNQUOTIERT angelegt, also
in GROSSBUCHSTABEN im Schema `DEFAULT`; Datum = DATE, Wahrheitswerte =
BOOLEAN, lange Texte = CLOB, Bilder = BLOB (Katalog.BILDEIGEN,
Leser.PASSBDATEN – INGA kennt sie nicht und fasst sie nie an). Die Brücke
löst Namen deshalb über die Datenbank-Metadaten ohne Beachtung der
Groß-/Kleinschreibung auf und liest/schreibt jeden Wert passend zum echten
Spaltentyp; `dump` liefert exakt das Format von Perpustakaans eigenem
CSV-Export (Datum `2026-06-18 00:00:00.000`, Dezimal `0.0`, `true`/`false`).

## Was echt geprüft wurde (gegen eine synthetische Test-Derby-Datenbank, KEINE echten Daten)

Alles unten wurde in dieser Entwicklungsumgebung tatsächlich ausgeführt,
nicht nur überlegt (JDK 21 + Derby 10.17.1.0 lokal, siehe Kommentare oben):

- **`check`/`dump`/`load` gegen eine freie Datenbank** funktionieren.
- **"Ist Perpustakaan gerade offen?"**: eine zweite JVM, die dieselbe
  Datenbank gleichzeitig geöffnet hält, lässt JEDEN Boot-Versuch (auch
  `check`) mit SQLState `XSDB6` scheitern – das erkennt `Bridge.java`
  zuverlässig (Exception-Kette über `getNextException()`+`getCause()`
  durchsucht) und meldet `{"ok":false,"gesperrt":true}`. Bestätigt: Derbys
  Embedded-Modus erlaubt **grundsätzlich keinen** gleichzeitigen
  Lesezugriff einer zweiten JVM, während eine andere die Datenbank offen
  hält – das gilt für `check` UND `dump` UND `load` gleichermaßen. Ein
  "nur lesend mitlesen, während Perpustakaan offen ist" ist mit Derbys
  Embedded-Treiber technisch **nicht möglich** (bräuchte den separaten
  Derby Network Server, den Perpustakaan nicht einsetzt).
- **Rundlauf `dump` → Werte ändern → `load` → erneuter `dump`**: die
  Änderungen kommen korrekt an, inklusive NULL-Behandlung (leeres Feld)
  und Escaping eines Semikolons im Wert (wird wie in `csvio.js` durch ein
  Leerzeichen ersetzt).
- **Rollback bei Fehlern**: ein `load` mit einer nicht existierenden
  Tabelle im Zip scheitert komplett (nichts wird geschrieben) – ein
  anschließender `dump` bestätigt, dass der vorherige Stand unverändert
  blieb. Die gesamte `load`-Operation läuft in EINER Transaktion.
- **Quotierte, gemischtgroße Spaltennamen** (`"MedArtKb"` statt `MEDARTKB`)
  funktionieren wie erwartet – wichtig, weil Derby unquotierte Bezeichner
  sonst auf Großbuchstaben normalisiert, `schema/perpustakaan-tables.json`
  aber durchgehend gemischte Groß-/Kleinschreibung nutzt (aus echten
  Perpustakaan-CSV-Exports reverse-engineered).
- **Typ-Umwandlung beim Laden**: `load` bindet jeden CSV-Wert unabhängig
  von der tatsächlichen Spalte per `setString()`/`setNull(VARCHAR)`. Gegen
  TIMESTAMP- und DECIMAL-Spalten geprüft, inklusive des echten
  Perpustakaan-Zeitformats mit drei Nachkommastellen bei den
  Millisekunden (`"2026-06-18 00:00:00.000"`, siehe csvio.js) – Derbys
  JDBC-Treiber wandelt das beim Einfügen korrekt um. NULL über eine leere
  CSV-Zelle funktioniert ebenso unabhängig vom Spaltentyp.
- **TIMESTAMP-Format bei `dump` (gefundener Bug, behoben)**: `dump` las
  ursprünglich JEDE Spalte generisch per `rs.getString()` – für TIMESTAMP-
  Spalten ruft das intern `java.sql.Timestamp#toString()` auf, das die
  Nachkommastellen nur mit MINDESTENS einer Ziffer ausgibt, nicht auf drei
  Stellen aufgefüllt: ein Wert exakt zur vollen Sekunde (der praktische
  Normalfall bei Ausleih-/Fälligkeitsdatum) kam als `"…00:00:00.0"`
  zurück statt `"…00:00:00.000"` wie in echten Perpustakaan-CSV-Exporten
  und wie INGA selbst neue Datensätze schreibt (`date-utils.js
  heuteStamp()`). Gegen eine synthetische Testdatenbank mit mehreren
  Nachkommastellen-Fällen (glatte Sekunde, 120 ms, 5 ms) reproduziert und
  verifiziert. Für die reine Kalenderrechnung in INGA folgenlos
  (`date-utils.js parseKalenderdatum()` liest ohnehin nur die ersten 10
  Zeichen), ABER `repo.js letzteMahnungFuer()` vergleicht `AuslDatum` per
  EXAKTER Zeichenkettengleichheit, um eine bereits verschickte Mahnung/
  Erinnerung zu einer Ausleihe wiederzufinden – bei unterschiedlicher
  Nachkommastellenzahl für denselben Zeitpunkt wäre dieser Abgleich nach
  einem "Jetzt aus Perpustakaan lesen" stillschweigend fehlgeschlagen
  (die "Erinnerung am …"-Anzeige in der Rückstandsliste hätte eine
  bereits verschickte Mahnung nicht mehr gefunden). Nie gegen eine echte
  Installation aufgefallen, weil ein regulärer, von Perpustakaan selbst
  erzeugter CSV-Export diesen JDBC-`toString()`-Weg gar nicht durchläuft
  – nur der Live-Lesezugriff. Behoben durch eine eigene `csvWert()`, die
  TIMESTAMP-Spalten (per `ResultSetMetaData`) erkennt und die
  Nachkommastellen explizit auf drei Ziffern normiert (auffüllen oder
  abschneiden), alle anderen Spaltentypen bleiben unverändert bei
  `getString()`. Erneut gegen dieselbe Testdatenbank geprüft: liefert
  jetzt für alle drei Fälle exakt das erwartete Format.
- **Fremdschlüssel-Reihenfolge bei `load` (gefundener Bug, behoben)**:
  ursprünglich verarbeitete `load` DELETE+INSERT tabellenweise in
  Zip-Reihenfolge – gegen eine synthetische Fremdschlüssel-Testdatenbank
  (Eltern-/Kind-Tabelle) reproduziert: das DELETE der Eltern-Tabelle
  scheiterte zuverlässig, solange die Kind-Tabelle noch (alte,
  referenzierende) Zeilen hatte. Behoben durch zwei getrennte Durchgänge
  (erst ALLE Tabellen leeren, dann ALLE befüllen), je Durchgang mit einer
  Warteschlange: schlägt eine Tabelle an genau dieser Fremdschlüssel-
  Verletzung (SQLState `23503`) fehl, wandert sie ans Ende und wird
  später erneut versucht – ohne das Schema selbst kennen zu müssen. Gegen
  dieselbe Testdatenbank erneut geprüft: funktioniert jetzt korrekt,
  Rollback bei einem echten (nicht auflösbaren) Fehler weiterhin intakt.

## Gegen eine echte Perpustakaan-Datenbank geprüft (Stand 1.11.0-beta.1)

Mit einer KOPIE einer echten Perpustakaan-Datenbank (Derby 10.16.1.1,
1829 Titel, 311 Nutzer, 43 offene Ausleihen), lokal in der Entwicklungs-
umgebung: `dump` stimmt spaltengenau mit Perpustakaans eigenem CSV-Export
überein; Neuanlage Nutzer (mit Zeilenumbruch/Semikolon in Notizen), Ausleihe
mit Fälligkeit, Rückgabe (AUSLEIHE → AUSLHIST), Verlängerung, Titeländerung
und Nummernzähler (IDENTCNT) kommen korrekt an; Sperre durch eine zweite JVM
(Derby 10.16, wie Perpustakaan) wird erkannt und Ausstehendes danach
nachgetragen; die Datenbank öffnet sich nach INGAs Zugriffen (Derby 10.17,
Soft-Upgrade) weiterhin mit Derby 10.16. Frühere, unten stehende Befunde
stammen aus synthetischen Testdatenbanken.

## Offene Risiken / was noch NICHT gegen echte Daten geprüft ist

- **Nur gegen eine Kopie getestet, nicht im laufenden Schulbetrieb** –
  und nicht gegen Perpustakaan selbst, das nach INGAs Änderungen die
  Datenbank öffnet (geprüft ist nur, dass Derby 10.16 sie lesen kann und
  die Werte stimmen). Perpustakaan-interne Zusammenhänge, die nicht in der
  Datenbank stehen (Caches, eigene Plausibilitätsregeln), sind unbekannt.
- **Leihfristen**: INGA schreibt für offene Ausleihen die Fälligkeit nach
  SEINEN Leihfrist-Einstellungen nach Perpustakaan (bei jeder Änderung
  einer Ausleihe) – weichen die Fristen in Perpustakaan ab, gilt danach
  INGAs Datum.
- **Windows/macOS nicht getestet** – nur unter Linux entwickelt/geprüft
  (diese Umgebung). `scripts/setup-derby-runtime.js` lädt plattform-
  passende Temurin-JREs, aber ob der Bridge-Aufruf (Pfade, Berechtigungen,
  `java.exe` unter Windows) dort genauso funktioniert, ist ungetestet.
- **macOS Universal-Build**: `dist:mac` baut arm64 UND x64 in einem
  Durchgang; `setup-derby-runtime.js` lädt aber nur EINE Architektur
  (die des CI-Runners). Ein x64-Build auf einem arm64-Runner bekäme
  aktuell die falsche JRE gebündelt – noch zu beheben (z. B. beide
  Architekturen laden und pro Zielarchitektur einbinden).
- **Nebenläufigkeit innerhalb EINER INGA-Sitzung**: im Perpustakaan-Modus
  laufen alle Zugriffe nacheinander über EINEN Dauerprozess. Die alten
  Einmal-Aufrufe (ohne Modus) werden, solange der Dauerprozess läuft,
  ebenfalls über ihn geleitet.

**Vor dem ersten Einsatz mit echten Daten**: unbedingt zuerst gegen eine
**Kopie** der echten Perpustakaan-Datenbank ausprobieren (Ordner kopieren,
den Kopie-Ordner in den Einstellungen auswählen), nicht gegen das Original.

## Weitere Bugfixes aus dem ersten Review (main.js)

Bei der Durchsicht von `src/main/main.js` (nicht nur der Bridge selbst)
gefunden und behoben:

- **"Jetzt lesen" prüfte das Ergebnis der eigenen INGA-Sicherung nicht**:
  `sichereDatenbankSync(...)` kann `null` liefern (Sicherung
  fehlgeschlagen), der Rückgabewert wurde aber verworfen – ein Import wäre
  auch ohne Rückfallmöglichkeit durchgelaufen. Jetzt: Fehlschlag bricht
  den Import ab, es wird nichts importiert.
- **"Jetzt schreiben" sicherte die Original-Datenbank nur einmal beim
  Programmstart**, nicht vor jedem einzelnen Schreibversuch. In einer
  langen Sitzung mit mehreren Schreibvorgängen wäre nur der erste durch
  einen wirklich aktuellen Stand abgesichert gewesen. Jetzt: frische
  Sicherung (inkl. Erfolgsprüfung) unmittelbar vor jedem Schreibversuch.
- **Irreführender Status "deaktiviert"**, wenn der Zugriff zwar aktiviert,
  aber noch kein Datenbankordner gewählt war. Jetzt ein eigener,
  unterscheidbarer Zustand ("noch kein Ordner ausgewählt").
- Doppelt vorhandene Status-/Zugriffsprüfungs-Logik in den Handlern für
  "jetzt lesen"/"jetzt schreiben"/Programmstart/"jetzt prüfen" in zwei
  gemeinsame Hilfsfunktionen zusammengefasst.
