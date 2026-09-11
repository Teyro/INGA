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

```
check <dbPfad>                          -> {"ok":true} | {"ok":false,"gesperrt":true} | {"ok":false,"fehler":"…"}
dump  <dbPfad> <schemaDatei> <zipZiel>  -> {"ok":true,"tabellen":N} | …
load  <dbPfad> <zipQuelle>              -> {"ok":true,"tabellen":N} | …
```

`<schemaDatei>`: eine Zeile je Tabelle, `Tabellenname<TAB>Spalte1,Spalte2,…`
– von `perpustakaan-live.js` aus derselben `schema/perpustakaan-tables.json`
erzeugt, die auch `csvio.js` nutzt (eine Quelle der Wahrheit). `dump`
erzeugt/`load` erwartet exakt dasselbe Perpustakaan-CSV-Zip-Format wie
`csvio.js` (`;`-getrennt, CRLF, UTF-8, kein Quoting) – dadurch braucht es
**keine eigene Import-/Export-Logik**: `perpustakaan-live.js` reicht das
Ergebnis einfach an `csvio.importZip()`/`csvio.exportZip()` weiter.

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
  JDBC-Treiber wandelt das beim Einfügen korrekt um, ein anschließender
  `dump` liefert exakt denselben Wert zurück. NULL über eine leere CSV-
  Zelle funktioniert ebenso unabhängig vom Spaltentyp.
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

## Offene Risiken / was noch NICHT gegen echte Daten geprüft ist

- **Nie gegen die echte, mit dem realen Perpustakaan angelegte Datenbank
  getestet.** Die synthetischen Testdatenbanken oben wurden selbst mit
  quotierten Spaltennamen angelegt, in der Annahme, dass das echte
  Perpustakaan-Schema genauso vorgeht (plausibel, aber unverifiziert) –
  ein `dump`/`load` gegen die echte Datenbank kann trotz der Typ- und
  Fremdschlüssel-Prüfungen oben an einer abweichenden Spaltenreihenfolge/
  -benennung oder an Trigger-Constraints scheitern, die die
  Fremdschlüssel-Warteschlange nicht abdeckt (die reagiert gezielt nur
  auf SQLState 23503).
- **Windows/macOS nicht getestet** – nur unter Linux entwickelt/geprüft
  (diese Umgebung). `scripts/setup-derby-runtime.js` lädt plattform-
  passende Temurin-JREs, aber ob der Bridge-Aufruf (Pfade, Berechtigungen,
  `java.exe` unter Windows) dort genauso funktioniert, ist ungetestet.
- **macOS Universal-Build**: `dist:mac` baut arm64 UND x64 in einem
  Durchgang; `setup-derby-runtime.js` lädt aber nur EINE Architektur
  (die des CI-Runners). Ein x64-Build auf einem arm64-Runner bekäme
  aktuell die falsche JRE gebündelt – noch zu beheben (z. B. beide
  Architekturen laden und pro Zielarchitektur einbinden).
- **Nebenläufigkeit innerhalb EINER INGA-Sitzung**: zwei gleichzeitige
  Aufrufe von "Jetzt lesen"/"Jetzt schreiben" (z. B. Doppelklick) sind
  nicht explizit verhindert – jeder startet einen eigenen Bridge-Prozess,
  der zweite würde vermutlich (nicht getestet) mit `gesperrt:true`
  scheitern, weil der erste die Datenbank noch offen hält.

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
