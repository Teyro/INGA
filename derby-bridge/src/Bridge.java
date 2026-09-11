import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.sql.*;
import java.util.*;
import java.util.zip.*;

/**
 * Kleine Brücke zwischen INGA (Node/Electron) und der echten Perpustakaan-
 * Datenbank (Apache Derby, embedded, kein Node-Treiber existiert dafür).
 * Wird von src/main/perpustakaan-live.js als eigener Prozess gestartet,
 * spricht NICHT interaktiv, sondern druckt am Ende genau EINE JSON-Zeile
 * auf stdout und beendet sich. Alles andere (Fortschritt, Fehlerdetails)
 * geht nach stderr, für Node uninteressant.
 *
 * Nutzung:
 *   check <dbPfad>                        – nur prüfen, ob die Datenbank
 *                                            gerade frei ist (siehe unten)
 *   dump  <dbPfad> <schemaDatei> <zipZiel> – alle Tabellen aus <schemaDatei>
 *                                            lesend als Perpustakaan-CSV-Zip
 *                                            exportieren (dieselbe Form wie
 *                                            csvio.js exportZip())
 *   load  <dbPfad> <zipQuelle>             – ein solches Zip zurück in die
 *                                            Datenbank schreiben (DELETE +
 *                                            INSERT je Tabelle, ALLES in
 *                                            EINER Transaktion – entweder
 *                                            komplett oder gar nicht)
 *
 * "Ist Perpustakaan gerade offen?": Derbys Embedded-Engine erlaubt technisch
 * nur EINER JVM gleichzeitig, eine Datenbank zu "booten" – ein zweiter
 * Boot-Versuch (egal ob lesend oder schreibend gemeint) scheitert IMMER mit
 * SQLState XSDB6 ("Another instance of Derby may have already booted the
 * database"), verschachtelt in der Exception-Kette. Das ist keine
 * Krücke, sondern die verlässlichste verfügbare Erkennung – ein "nur
 * lesend"-Modus, der eine von Perpustakaan offen gehaltene Datenbank
 * gleichzeitig mitlesen könnte, existiert in Derbys Embedded-Modus schlicht
 * NICHT (das bräuchte den separaten Derby Network Server, den Perpustakaan
 * nicht nutzt). Ist die Datenbank gerade offen, meldet dieses Programm das
 * sauber zurück – INGA fällt dann auf die zuletzt importierte eigene Kopie
 * zurück, statt es (aussichtslos) noch einmal zu versuchen.
 */
public class Bridge {

  public static void main(String[] args) {
    try {
      if (args.length == 0) { druckeFehler("kein Modus angegeben"); System.exit(2); return; }
      switch (args[0]) {
        case "check": check(args[1]); break;
        case "dump": dump(args[1], args[2], args[3]); break;
        case "load": load(args[1], args[2]); break;
        default: druckeFehler("unbekannter Modus: " + args[0]); System.exit(2);
      }
    } catch (GesperrtException e) {
      druckeJson("{\"ok\":false,\"gesperrt\":true}");
    } catch (Exception e) {
      e.printStackTrace();
      druckeFehler(e.getMessage() == null ? e.getClass().getName() : e.getMessage());
      System.exit(1);
    }
  }

  /** Wird geworfen, wenn eine andere JVM (vermutlich Perpustakaan selbst) die Datenbank gerade offen hält – siehe Klassenkommentar. */
  static class GesperrtException extends Exception {}

  static void druckeJson(String json) { System.out.println(json); }
  static void druckeFehler(String text) { druckeJson("{\"ok\":false,\"fehler\":" + jsonString(text) + "}"); }

  static String jsonString(String s) {
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '"' || c == '\\') b.append('\\').append(c);
      else if (c == '\n') b.append("\\n");
      else if (c == '\r') b.append("\\r");
      else if (c < 0x20) b.append(' ');
      else b.append(c);
    }
    return b.append('"').toString();
  }

  /** Prüft die Exception-Kette (verschachtelt über getNextException() UND getCause()) auf SQLState XSDB6. ArrayDeque erlaubt keine null-Elemente, deshalb der explizite null-Check vor jedem push(). */
  static boolean istGesperrtFehler(Throwable t) {
    Set<Throwable> gesehen = Collections.newSetFromMap(new IdentityHashMap<>());
    Deque<Throwable> stapel = new ArrayDeque<>();
    if (t != null) stapel.push(t);
    while (!stapel.isEmpty()) {
      Throwable cur = stapel.pop();
      if (!gesehen.add(cur)) continue;
      if (cur instanceof SQLException && "XSDB6".equals(((SQLException) cur).getSQLState())) return true;
      if (cur instanceof SQLException) {
        SQLException naechste = ((SQLException) cur).getNextException();
        if (naechste != null) stapel.push(naechste);
      }
      if (cur.getCause() != null) stapel.push(cur.getCause());
    }
    return false;
  }

  static Connection verbinde(String dbPfad) throws Exception {
    try {
      return DriverManager.getConnection("jdbc:derby:" + dbPfad);
    } catch (SQLException e) {
      if (istGesperrtFehler(e)) throw new GesperrtException();
      throw e;
    }
  }

  /** Sauberes Herunterfahren EINER Datenbank – Derby meldet Erfolg paradoxerweise über eine Exception (SQLState 08006), das ist normal und kein Fehler. */
  static void fahreHerunter(String dbPfad) {
    try {
      DriverManager.getConnection("jdbc:derby:" + dbPfad + ";shutdown=true");
    } catch (SQLException e) {
      // erwarteter "Erfolgsfall", siehe Kommentar oben – nichts zu tun
    }
  }

  static void check(String dbPfad) throws Exception {
    Connection c = verbinde(dbPfad);
    c.close();
    fahreHerunter(dbPfad);
    druckeJson("{\"ok\":true}");
  }

  /** Format der Schemadatei: je Zeile "Tabellenname\tSpalte1,Spalte2,…" – erzeugt von perpustakaan-live.js aus derselben schema/perpustakaan-tables.json, die auch csvio.js nutzt (eine Quelle der Wahrheit). */
  static LinkedHashMap<String, List<String>> leseSchema(String pfad) throws IOException {
    LinkedHashMap<String, List<String>> schema = new LinkedHashMap<>();
    for (String zeile : Files.readAllLines(Paths.get(pfad), StandardCharsets.UTF_8)) {
      if (zeile.isEmpty()) continue;
      String[] teile = zeile.split("\t", 2);
      schema.put(teile[0], Arrays.asList(teile[1].split(",", -1)));
    }
    return schema;
  }

  static String csvEscape(Object wertRoh) {
    if (wertRoh == null) return "";
    String wert = wertRoh.toString();
    if (wert.indexOf(';') >= 0 || wert.indexOf('\r') >= 0 || wert.indexOf('\n') >= 0) {
      return wert.replace(';', ' ').replace('\r', ' ').replace('\n', ' ');
    }
    return wert;
  }

  static String quoteIdent(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }

  static void dump(String dbPfad, String schemaDatei, String zipZiel) throws Exception {
    LinkedHashMap<String, List<String>> schema = leseSchema(schemaDatei);
    Connection c = verbinde(dbPfad);
    try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(zipZiel)), StandardCharsets.UTF_8)) {
      for (Map.Entry<String, List<String>> eintrag : schema.entrySet()) {
        String tabelle = eintrag.getKey();
        List<String> spalten = eintrag.getValue();
        String spaltenSql = String.join(", ", spalten.stream().map(Bridge::quoteIdent).toArray(String[]::new));
        zip.putNextEntry(new ZipEntry(tabelle + ".csv"));
        StringBuilder inhalt = new StringBuilder();
        inhalt.append(String.join(";", spalten)).append("\r\n");
        try (Statement st = c.createStatement();
             ResultSet rs = st.executeQuery("SELECT " + spaltenSql + " FROM " + quoteIdent(tabelle))) {
          while (rs.next()) {
            for (int i = 1; i <= spalten.size(); i++) {
              if (i > 1) inhalt.append(';');
              inhalt.append(csvEscape(rs.getString(i)));
            }
            inhalt.append("\r\n");
          }
        }
        byte[] bytes = inhalt.toString().getBytes(StandardCharsets.UTF_8);
        zip.write(bytes, 0, bytes.length);
        zip.closeEntry();
      }
    } finally {
      c.close();
      fahreHerunter(dbPfad);
    }
    druckeJson("{\"ok\":true,\"tabellen\":" + schema.size() + "}");
  }

  static void load(String dbPfad, String zipQuelle) throws Exception {
    Connection c = verbinde(dbPfad);
    int tabellenGeladen = 0;
    try {
      c.setAutoCommit(false);
      try (ZipFile zip = new ZipFile(zipQuelle)) {
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
          ZipEntry entry = entries.nextElement();
          if (entry.isDirectory() || !entry.getName().toLowerCase(Locale.ROOT).endsWith(".csv")) continue;
          String tabelle = entry.getName().replaceAll("\\.[Cc][Ss][Vv]$", "");
          try (BufferedReader reader = new BufferedReader(new InputStreamReader(zip.getInputStream(entry), StandardCharsets.UTF_8))) {
            String kopf = reader.readLine();
            if (kopf == null || kopf.isEmpty()) continue; // leere Datei, nichts zu tun
            String[] spalten = kopf.split(";", -1);
            String spaltenSql = String.join(", ", Arrays.stream(spalten).map(Bridge::quoteIdent).toArray(String[]::new));
            String platzhalter = String.join(", ", Collections.nCopies(spalten.length, "?"));
            try (Statement del = c.createStatement()) {
              del.execute("DELETE FROM " + quoteIdent(tabelle));
            }
            try (PreparedStatement ins = c.prepareStatement(
                "INSERT INTO " + quoteIdent(tabelle) + " (" + spaltenSql + ") VALUES (" + platzhalter + ")")) {
              String zeile;
              while ((zeile = reader.readLine()) != null) {
                String[] werte = zeile.split(";", -1);
                for (int i = 0; i < spalten.length; i++) {
                  String wert = i < werte.length ? werte[i] : "";
                  if (wert.isEmpty()) ins.setNull(i + 1, Types.VARCHAR); else ins.setString(i + 1, wert);
                }
                ins.addBatch();
              }
              ins.executeBatch();
            }
          }
          tabellenGeladen++;
        }
      }
      c.commit();
    } catch (Exception e) {
      try { c.rollback(); } catch (SQLException ignored) { /* Verbindung eventuell schon defekt – nichts mehr zu retten */ }
      throw e;
    } finally {
      c.close();
      fahreHerunter(dbPfad);
    }
    druckeJson("{\"ok\":true,\"tabellen\":" + tabellenGeladen + "}");
  }
}
