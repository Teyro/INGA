import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.sql.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.zip.*;

/**
 * Kleine Brücke zwischen INGA (Node/Electron) und der echten Perpustakaan-
 * Datenbank (Apache Derby, embedded, kein Node-Treiber existiert dafür).
 * Wird von src/main/perpustakaan-live.js als eigener Prozess gestartet.
 *
 * Einmal-Aufrufe (drucken genau EINE JSON-Zeile auf stdout und beenden sich):
 *   check <dbPfad>                        – nur prüfen, ob die Datenbank frei ist
 *   dump  <dbPfad> <schemaDatei> <zipZiel> – alle Tabellen aus <schemaDatei> als
 *                                            Perpustakaan-CSV-Zip exportieren
 *   load  <dbPfad> <zipQuelle>             – ein solches Zip komplett zurück-
 *                                            schreiben (EINE Transaktion)
 *
 * Dauerbetrieb für den Perpustakaan-Modus (Echtzeit-Abgleich):
 *   serve – liest Aufträge zeilenweise von stdin ("<id>\t<befehl>\t<arg>…",
 *           UTF-8) und antwortet je Auftrag mit einer JSON-Zeile samt "id".
 *           Befehle: open <dbPfad> <leerlaufMs>, check, dump <schema> <zip>,
 *           apply <aenderungsDatei>, load <zip>, close, quit.
 *           Die Datenbank bleibt zwischen dicht aufeinanderfolgenden Aufträgen
 *           offen und wird nach <leerlaufMs> ohne Auftrag wieder freigegeben –
 *           Derby erlaubt nur EINER JVM gleichzeitig den Zugriff, Perpustakaan
 *           selbst soll also so wenig wie möglich ausgesperrt werden.
 *
 * Die echte Perpustakaan-Datenbank legt ihre Tabellen UNQUOTIERT an (Derby
 * speichert die Namen dann in GROSSBUCHSTABEN, Schema "DEFAULT"), INGA kennt
 * sie in der Schreibweise der Perpustakaan-CSV-Exporte ("Ausleihe",
 * "MedienNi"). Tabellen und Spalten werden deshalb über die Metadaten der
 * Datenbank OHNE Beachtung der Groß-/Kleinschreibung aufgelöst (siehe Katalog).
 * Außerdem sind Datumsfelder dort DATE (nicht TIMESTAMP), Wahrheitswerte
 * BOOLEAN, lange Texte CLOB – alle Werte werden deshalb passend zum echten
 * Spaltentyp gelesen (Format wie in Perpustakaans eigenem CSV-Export) und
 * geschrieben (siehe setzeWert()).
 *
 * "Ist Perpustakaan gerade offen?": ein zweiter Boot-Versuch einer anderen JVM
 * scheitert IMMER mit SQLState XSDB6 – das wird als {"gesperrt":true} gemeldet.
 */
public class Bridge {

  static PrintStream aus;

  public static void main(String[] args) throws Exception {
    // stdout ausdrücklich als UTF-8: unter Windows wäre es sonst die
    // Codepage des Systems, Umlaute in Fehlermeldungen kämen in Node
    // (liest UTF-8) als Zeichensalat an.
    aus = new PrintStream(new FileOutputStream(FileDescriptor.out), true, "UTF-8");
    if (args.length == 0) { druckeJson(fehlerJson(null, "kein Modus angegeben")); System.exit(2); return; }
    if (args[0].equals("serve")) { serve(); return; }
    Sitzung s = new Sitzung();
    try {
      switch (args[0]) {
        case "check": s.dbPfad = args[1]; druckeJson(s.check(null)); break;
        case "dump": s.dbPfad = args[1]; druckeJson(s.dump(null, args[2], args[3])); break;
        case "load": s.dbPfad = args[1]; druckeJson(s.load(null, args[2])); break;
        default: druckeJson(fehlerJson(null, "unbekannter Modus: " + args[0])); System.exit(2);
      }
    } catch (GesperrtException e) {
      druckeJson("{\"ok\":false,\"gesperrt\":true}");
      System.exit(1);
    } catch (KonfliktException e) {
      druckeJson("{\"ok\":false,\"konflikt\":true,\"fehler\":" + jsonString(e.getMessage()) + "}");
      System.exit(1);
    } catch (Exception e) {
      e.printStackTrace();
      druckeJson(fehlerJson(null, text(e)));
      System.exit(1);
    } finally {
      s.schliesse();
    }
  }

  /* ------------------------------------------------------------ Dauerbetrieb */

  static void serve() throws Exception {
    Sitzung s = new Sitzung();
    ScheduledExecutorService zeitgeber = Executors.newSingleThreadScheduledExecutor(r -> {
      Thread t = new Thread(r, "leerlauf");
      t.setDaemon(true);
      return t;
    });
    ScheduledFuture<?> leerlauf = null;
    BufferedReader ein = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String zeile;
    while ((zeile = ein.readLine()) != null) {
      if (zeile.isEmpty()) continue;
      String[] teile = zeile.split("\t", -1);
      String id = teile[0];
      String befehl = teile.length > 1 ? teile[1] : "";
      if (leerlauf != null) leerlauf.cancel(false);
      String antwort;
      synchronized (s) {
        try {
          switch (befehl) {
            case "open":
              s.schliesse();
              s.dbPfad = teile[2];
              s.leerlaufMs = teile.length > 3 ? Long.parseLong(teile[3]) : 3000;
              antwort = "{\"id\":" + id + ",\"ok\":true}";
              break;
            case "check": antwort = s.check(id); s.schliesse(); break;
            case "dump": antwort = s.dump(id, teile[2], teile[3]); break;
            case "apply": antwort = s.apply(id, teile[2]); break;
            case "load": antwort = s.load(id, teile[2]); break;
            case "close": s.schliesse(); antwort = "{\"id\":" + id + ",\"ok\":true}"; break;
            case "quit":
              s.schliesse();
              druckeJson("{\"id\":" + id + ",\"ok\":true}");
              return;
            default: antwort = fehlerJson(id, "unbekannter Befehl: " + befehl);
          }
        } catch (GesperrtException e) {
          s.schliesse();
          antwort = "{\"id\":" + id + ",\"ok\":false,\"gesperrt\":true}";
        } catch (KonfliktException e) {
          antwort = "{\"id\":" + id + ",\"ok\":false,\"konflikt\":true,\"fehler\":" + jsonString(e.getMessage()) + "}";
        } catch (Exception e) {
          e.printStackTrace();
          // Nach einem unerwarteten Fehler lieber frisch verbinden als mit
          // einer womöglich defekten Verbindung weiterzuarbeiten.
          s.schliesse();
          antwort = fehlerJson(id, text(e));
        }
      }
      druckeJson(antwort);
      if (s.c != null) {
        leerlauf = zeitgeber.schedule(() -> { synchronized (s) { s.schliesse(); } }, s.leerlaufMs, TimeUnit.MILLISECONDS);
      }
    }
    // stdin geschlossen (INGA beendet): Datenbank sauber freigeben.
    synchronized (s) { s.schliesse(); }
  }

  /* ------------------------------------------------------------ Hilfen */

  static class GesperrtException extends Exception {}

  static class KonfliktException extends Exception {
    KonfliktException(String text) { super(text); }
  }

  static synchronized void druckeJson(String json) { aus.println(json); aus.flush(); }

  static String fehlerJson(String id, String text) {
    return "{" + (id == null ? "" : "\"id\":" + id + ",") + "\"ok\":false,\"fehler\":" + jsonString(text) + "}";
  }

  static String text(Throwable e) {
    return e.getMessage() == null ? e.getClass().getName() : e.getMessage();
  }

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

  /** Prüft die Exception-Kette (verschachtelt über getNextException() UND getCause()) auf SQLState XSDB6. */
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

  static boolean hatSqlState(SQLException e, String state) {
    for (SQLException cur = e; cur != null; cur = cur.getNextException()) {
      if (state.equals(cur.getSQLState())) return true;
    }
    return false;
  }

  static String quoteIdent(String name) { return "\"" + name.replace("\"", "\"\"") + "\""; }

  static String csvEscape(String wert) {
    if (wert == null) return "";
    if (wert.indexOf(';') >= 0 || wert.indexOf('\r') >= 0 || wert.indexOf('\n') >= 0) {
      return wert.replace(';', ' ').replace('\r', ' ').replace('\n', ' ');
    }
    return wert;
  }

  static String rtrim(String s) {
    int ende = s.length();
    while (ende > 0 && s.charAt(ende - 1) == ' ') ende--;
    return s.substring(0, ende);
  }

  static boolean istLob(int typ) {
    return typ == Types.CLOB || typ == Types.BLOB || typ == Types.LONGVARCHAR || typ == Types.LONGVARBINARY
        || typ == Types.NCLOB || typ == Types.LONGNVARCHAR || typ == Types.VARBINARY || typ == Types.BINARY;
  }

  static boolean istBinaer(int typ) {
    return typ == Types.BLOB || typ == Types.LONGVARBINARY || typ == Types.VARBINARY || typ == Types.BINARY;
  }

  /* ------------------------------------------------------------ Tabellen-Katalog */

  static class Spalte {
    final String name; final int typ;
    Spalte(String name, int typ) { this.name = name; this.typ = typ; }
  }

  static class Tabelle {
    final String schema, name;
    final Map<String, Spalte> spalten = new LinkedHashMap<>(); // Schlüssel: GROSSGESCHRIEBEN
    final List<String> pk = new ArrayList<>(); // echte Spaltennamen
    Tabelle(String schema, String name) { this.schema = schema; this.name = name; }
    String sql() { return quoteIdent(schema) + "." + quoteIdent(name); }
    Spalte spalte(String inga) { return spalten.get(inga.toUpperCase(Locale.ROOT)); }
  }

  /**
   * Alle Benutzertabellen der Datenbank, aufgelöst OHNE Beachtung der Groß-/
   * Kleinschreibung. Gibt es denselben Namen in mehreren Schemas, gewinnt das
   * Schema mit den meisten Tabellen (bei Perpustakaan "DEFAULT").
   */
  static Map<String, Tabelle> leseKatalog(Connection c) throws SQLException {
    DatabaseMetaData m = c.getMetaData();
    Map<String, List<String[]>> jeName = new HashMap<>();
    Map<String, Integer> tabellenJeSchema = new HashMap<>();
    try (ResultSet rs = m.getTables(null, null, "%", new String[] { "TABLE" })) {
      while (rs.next()) {
        String schema = rs.getString("TABLE_SCHEM");
        String name = rs.getString("TABLE_NAME");
        if (schema.startsWith("SYS")) continue;
        jeName.computeIfAbsent(name.toUpperCase(Locale.ROOT), k -> new ArrayList<>()).add(new String[] { schema, name });
        tabellenJeSchema.merge(schema, 1, Integer::sum);
      }
    }
    Map<String, Tabelle> katalog = new HashMap<>();
    for (Map.Entry<String, List<String[]>> e : jeName.entrySet()) {
      String[] wahl = e.getValue().get(0);
      for (String[] kandidat : e.getValue()) {
        if (tabellenJeSchema.get(kandidat[0]) > tabellenJeSchema.get(wahl[0])) wahl = kandidat;
      }
      Tabelle t = new Tabelle(wahl[0], wahl[1]);
      try (ResultSet rs = m.getColumns(null, wahl[0], wahl[1], "%")) {
        while (rs.next()) {
          String name = rs.getString("COLUMN_NAME");
          t.spalten.put(name.toUpperCase(Locale.ROOT), new Spalte(name, rs.getInt("DATA_TYPE")));
        }
      }
      TreeMap<Integer, String> pk = new TreeMap<>();
      try (ResultSet rs = m.getPrimaryKeys(null, wahl[0], wahl[1])) {
        while (rs.next()) pk.put(rs.getInt("KEY_SEQ"), rs.getString("COLUMN_NAME"));
      }
      t.pk.addAll(pk.values());
      katalog.put(e.getKey(), t);
    }
    return katalog;
  }

  /* ------------------------------------------------------------ Werte lesen/schreiben */

  /**
   * Wert im Format von Perpustakaans eigenem CSV-Export: Datum als
   * "2026-06-18 00:00:00.000" (DATE und TIMESTAMP, Millisekunden immer
   * dreistellig – repo.js letzteMahnungFuer() vergleicht AuslDatum als exakte
   * Zeichenkette), Dezimalzahlen ohne überflüssige Nullen ("0.0", "12.5"),
   * CHAR ohne Auffüll-Leerzeichen, Wahrheitswerte "true"/"false".
   */
  static String leseWert(ResultSet rs, int i, int typ) throws SQLException {
    switch (typ) {
      case Types.DATE: {
        java.sql.Date d = rs.getDate(i);
        return d == null ? null : d.toString() + " 00:00:00.000";
      }
      case Types.TIMESTAMP: {
        Timestamp ts = rs.getTimestamp(i);
        if (ts == null) return null;
        String basis = ts.toString();
        int punkt = basis.indexOf('.');
        if (punkt < 0) return basis + ".000";
        return basis.substring(0, punkt + 1) + (basis.substring(punkt + 1) + "000").substring(0, 3);
      }
      case Types.TIME: {
        Time t = rs.getTime(i);
        return t == null ? null : t.toString();
      }
      case Types.DECIMAL:
      case Types.NUMERIC: {
        BigDecimal b = rs.getBigDecimal(i);
        if (b == null) return null;
        String s = b.stripTrailingZeros().toPlainString();
        return s.contains(".") ? s : s + ".0";
      }
      case Types.BOOLEAN:
      case Types.BIT: {
        boolean w = rs.getBoolean(i);
        return rs.wasNull() ? null : (w ? "true" : "false");
      }
      case Types.CHAR:
      case Types.NCHAR: {
        String s = rs.getString(i);
        return s == null ? null : rtrim(s);
      }
      default:
        if (istBinaer(typ)) return null; // Bilder o. Ä. – kommen im CSV-Format nicht vor
        return rs.getString(i);
    }
  }

  /** Bindet einen Text aus INGA passend zum echten Spaltentyp (leer = NULL). */
  static void setzeWert(PreparedStatement ps, int idx, Tabelle t, Spalte sp, String wert) throws SQLException {
    if (wert == null || wert.isEmpty()) { ps.setNull(idx, sp.typ); return; }
    String w = wert.trim();
    try {
      switch (sp.typ) {
        case Types.DATE:
          ps.setDate(idx, java.sql.Date.valueOf(w.length() >= 10 ? w.substring(0, 10) : w));
          return;
        case Types.TIMESTAMP:
          ps.setTimestamp(idx, Timestamp.valueOf(w.length() == 10 ? w + " 00:00:00" : w));
          return;
        case Types.TIME: {
          String z = w.contains(" ") ? w.substring(w.indexOf(' ') + 1) : w;
          if (z.contains(".")) z = z.substring(0, z.indexOf('.'));
          ps.setTime(idx, Time.valueOf(z));
          return;
        }
        case Types.BOOLEAN:
        case Types.BIT: {
          String k = w.toLowerCase(Locale.ROOT);
          boolean b;
          if (k.equals("true") || k.equals("ja") || k.equals("wahr")) b = true;
          else if (k.equals("false") || k.equals("nein") || k.equals("falsch")) b = false;
          else b = new BigDecimal(k).signum() != 0;
          ps.setBoolean(idx, b);
          return;
        }
        case Types.INTEGER:
        case Types.SMALLINT:
        case Types.TINYINT:
        case Types.BIGINT:
          ps.setLong(idx, new BigDecimal(w).longValueExact());
          return;
        case Types.DECIMAL:
        case Types.NUMERIC:
          ps.setBigDecimal(idx, new BigDecimal(w.replace(',', '.')));
          return;
        case Types.DOUBLE:
        case Types.FLOAT:
        case Types.REAL:
          ps.setDouble(idx, Double.parseDouble(w.replace(',', '.')));
          return;
        default:
          if (istBinaer(sp.typ)) { ps.setNull(idx, sp.typ); return; }
          ps.setString(idx, wert);
      }
    } catch (IllegalArgumentException | ArithmeticException e) {
      throw new SQLException("Ungültiger Wert „" + wert + "“ für " + t.name + "." + sp.name, "22018");
    }
  }

  /* ------------------------------------------------------------ Sitzung */

  static class Sitzung {
    String dbPfad;
    long leerlaufMs = 3000;
    Connection c;
    Map<String, Tabelle> katalog;

    Connection verbinde() throws Exception {
      if (c != null) return c;
      if (dbPfad == null) throw new IllegalStateException("Keine Datenbank geöffnet.");
      if (!Files.isDirectory(Paths.get(dbPfad)) || !Files.exists(Paths.get(dbPfad, "service.properties"))) {
        throw new IllegalStateException("Im gewählten Ordner liegt keine Perpustakaan-Datenbank (service.properties fehlt): " + dbPfad);
      }
      try {
        c = DriverManager.getConnection("jdbc:derby:" + dbPfad);
      } catch (SQLException e) {
        if (istGesperrtFehler(e)) throw new GesperrtException();
        throw e;
      }
      katalog = leseKatalog(c);
      return c;
    }

    /** Verbindung schließen UND die Datenbank herunterfahren – erst dann kann Perpustakaan sie wieder öffnen. */
    void schliesse() {
      if (c == null) return;
      try { if (!c.getAutoCommit()) c.rollback(); } catch (SQLException ignored) { }
      try { c.close(); } catch (SQLException ignored) { }
      c = null;
      katalog = null;
      try {
        DriverManager.getConnection("jdbc:derby:" + dbPfad + ";shutdown=true");
      } catch (SQLException e) {
        // Derby meldet ein erfolgreiches Herunterfahren über eine Exception (08006) – normal.
      }
    }

    Tabelle tabelle(String inga) { return katalog.get(inga.toUpperCase(Locale.ROOT)); }

    String check(String id) throws Exception {
      verbinde();
      return "{" + (id == null ? "" : "\"id\":" + id + ",") + "\"ok\":true}";
    }

    /** Format der Schemadatei: je Zeile "Tabellenname\tSpalte1,Spalte2,…" (aus schema/perpustakaan-tables.json). */
    String dump(String id, String schemaDatei, String zipZiel) throws Exception {
      LinkedHashMap<String, List<String>> schema = new LinkedHashMap<>();
      for (String zeile : Files.readAllLines(Paths.get(schemaDatei), StandardCharsets.UTF_8)) {
        if (zeile.isEmpty()) continue;
        String[] teile = zeile.split("\t", 2);
        schema.put(teile[0], Arrays.asList(teile[1].split(",", -1)));
      }
      verbinde();
      MessageDigest hash = MessageDigest.getInstance("SHA-256");
      List<String> fehlend = new ArrayList<>();
      try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(zipZiel)), StandardCharsets.UTF_8)) {
        for (Map.Entry<String, List<String>> eintrag : schema.entrySet()) {
          String name = eintrag.getKey();
          List<String> spalten = eintrag.getValue();
          StringBuilder inhalt = new StringBuilder();
          inhalt.append(String.join(";", spalten)).append("\r\n");
          Tabelle t = tabelle(name);
          if (t == null) {
            fehlend.add(name);
          } else {
            // Spalten, die es in dieser Perpustakaan-Version nicht gibt, bleiben leer.
            List<Spalte> vorhanden = new ArrayList<>();
            int[] position = new int[spalten.size()];
            for (int i = 0; i < spalten.size(); i++) {
              Spalte sp = t.spalte(spalten.get(i));
              position[i] = sp == null ? -1 : vorhanden.size() + 1;
              if (sp != null) vorhanden.add(sp);
            }
            if (!vorhanden.isEmpty()) {
              StringBuilder sql = new StringBuilder("SELECT ");
              for (int i = 0; i < vorhanden.size(); i++) sql.append(i > 0 ? ", " : "").append(quoteIdent(vorhanden.get(i).name));
              sql.append(" FROM ").append(t.sql());
              try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql.toString())) {
                while (rs.next()) {
                  for (int i = 0; i < spalten.size(); i++) {
                    if (i > 0) inhalt.append(';');
                    if (position[i] > 0) inhalt.append(csvEscape(leseWert(rs, position[i], vorhanden.get(position[i] - 1).typ)));
                  }
                  inhalt.append("\r\n");
                }
              }
            }
          }
          byte[] bytes = inhalt.toString().getBytes(StandardCharsets.UTF_8);
          hash.update(name.getBytes(StandardCharsets.UTF_8));
          hash.update(bytes);
          zip.putNextEntry(new ZipEntry(name + ".csv"));
          zip.write(bytes, 0, bytes.length);
          zip.closeEntry();
        }
      }
      StringBuilder hex = new StringBuilder();
      for (byte b : hash.digest()) hex.append(String.format("%02x", b));
      StringBuilder f = new StringBuilder("[");
      for (int i = 0; i < fehlend.size(); i++) f.append(i > 0 ? "," : "").append(jsonString(fehlend.get(i)));
      f.append("]");
      return "{" + (id == null ? "" : "\"id\":" + id + ",") + "\"ok\":true,\"tabellen\":" + schema.size()
          + ",\"hash\":\"" + hex + "\",\"fehlend\":" + f + "}";
    }

    /* -------------------------------------------------------- Einzeländerungen */

    /**
     * Änderungsdatei (UTF-8), erzeugt von perpustakaan-live.js:
     *   T\t<Tabelle>\t<Spalte1>\t<Spalte2>…   – beginnt einen Tabellenblock
     *   -\t<Wert1>\t<Wert2>…                   – diese Zeile gibt es in INGA nicht mehr
     *   +\t<Wert1>\t<Wert2>…                   – diese Zeile ist in INGA neu
     * Werte: leer = NULL; "\\", "\t", "\n", "\r" maskiert.
     *
     * Tabellen MIT Primärschlüssel: "-" und "+" mit demselben Schlüssel werden
     * zu einem UPDATE nur der tatsächlich geänderten Spalten (was Perpustakaan
     * in anderen Spalten desselben Datensatzes geändert hat, bleibt stehen);
     * nur "-" = DELETE, nur "+" = INSERT – ist die Nummer dort inzwischen schon
     * vergeben, ist das ein Konflikt (nichts wird geschrieben).
     * Tabellen OHNE Primärschlüssel (AuslHist, …): Zeilen werden über alle
     * vergleichbaren Spalten wiedergefunden (Mengen-Semantik, Duplikate zählen).
     * Alles in EINER Transaktion – entweder komplett oder gar nicht.
     */
    String apply(String id, String datei) throws Exception {
      List<String> zeilen = Files.readAllLines(Paths.get(datei), StandardCharsets.UTF_8);
      verbinde();
      c.setAutoCommit(false);
      int geaendert = 0;
      try {
        int i = 0;
        while (i < zeilen.size()) {
          String kopf = zeilen.get(i++);
          if (kopf.isEmpty()) continue;
          String[] k = teile(kopf);
          if (!k[0].equals("T")) throw new IllegalStateException("Änderungsdatei beschädigt (Zeile " + i + ")");
          String name = k[1];
          String[] spalten = Arrays.copyOfRange(k, 2, k.length);
          List<String[]> weg = new ArrayList<>();
          List<String[]> neu = new ArrayList<>();
          while (i < zeilen.size() && !zeilen.get(i).startsWith("T\t")) {
            String z = zeilen.get(i++);
            if (z.isEmpty()) continue;
            String[] w = teile(z);
            String[] werte = new String[spalten.length];
            for (int j = 0; j < spalten.length; j++) werte[j] = j + 1 < w.length ? w[j + 1] : null;
            (w[0].equals("-") ? weg : neu).add(werte);
          }
          Tabelle t = tabelle(name);
          if (t == null) throw new IllegalStateException("Die Tabelle „" + name + "“ gibt es in dieser Perpustakaan-Datenbank nicht.");
          geaendert += wendeAn(t, spalten, weg, neu);
        }
        c.commit();
      } catch (Exception e) {
        try { c.rollback(); } catch (SQLException ignored) { }
        throw e;
      } finally {
        try { c.setAutoCommit(true); } catch (SQLException ignored) { }
      }
      return "{\"id\":" + (id == null ? "null" : id) + ",\"ok\":true,\"geaendert\":" + geaendert + "}";
    }

    int wendeAn(Tabelle t, String[] spalten, List<String[]> weg, List<String[]> neu) throws Exception {
      Spalte[] sp = new Spalte[spalten.length];
      for (int j = 0; j < spalten.length; j++) sp[j] = t.spalte(spalten[j]);
      int[] pkIdx = new int[t.pk.size()];
      boolean mitPk = !t.pk.isEmpty();
      for (int p = 0; p < t.pk.size(); p++) {
        pkIdx[p] = -1;
        for (int j = 0; j < spalten.length; j++) if (sp[j] != null && sp[j].name.equals(t.pk.get(p))) pkIdx[p] = j;
        if (pkIdx[p] < 0) mitPk = false;
      }
      int anzahl = 0;
      if (mitPk) {
        LinkedHashMap<String, Deque<String[]>> wegNachSchluessel = new LinkedHashMap<>();
        for (String[] w : weg) wegNachSchluessel.computeIfAbsent(schluessel(w, pkIdx), x -> new ArrayDeque<>()).add(w);
        List<String[]> nurNeu = new ArrayList<>();
        List<String[][]> paare = new ArrayList<>();
        for (String[] n : neu) {
          Deque<String[]> alt = wegNachSchluessel.get(schluessel(n, pkIdx));
          if (alt != null && !alt.isEmpty()) paare.add(new String[][] { alt.poll(), n });
          else nurNeu.add(n);
        }
        for (Deque<String[]> rest : wegNachSchluessel.values()) {
          for (String[] w : rest) anzahl += loescheNachPk(t, sp, pkIdx, w);
        }
        for (String[][] paar : paare) anzahl += aktualisiere(t, sp, pkIdx, paar[0], paar[1]);
        for (String[] n : nurNeu) {
          try {
            anzahl += fuegeEin(t, sp, n);
          } catch (SQLException e) {
            if (hatSqlState(e, "23505")) {
              throw new KonfliktException("In Perpustakaan gibt es in „" + t.name + "“ bereits einen Datensatz mit "
                  + beschreibeSchluessel(t, pkIdx, n) + " – vermutlich wurde er dort inzwischen angelegt.");
            }
            throw e;
          }
        }
      } else {
        LinkedHashMap<String, List<String[]>> gruppen = new LinkedHashMap<>();
        for (String[] w : weg) gruppen.computeIfAbsent(String.join("\u0001", ersetzeNull(w)), x -> new ArrayList<>()).add(w);
        for (List<String[]> gruppe : gruppen.values()) {
          String[] w = gruppe.get(0);
          int vorhanden = zaehleGleiche(t, sp, w);
          if (vorhanden == 0) continue; // dort schon weg
          loescheGleiche(t, sp, w);
          for (int r = 0; r < vorhanden - gruppe.size(); r++) fuegeEin(t, sp, w);
          anzahl += Math.min(vorhanden, gruppe.size());
        }
        for (String[] n : neu) anzahl += fuegeEin(t, sp, n);
      }
      return anzahl;
    }

    int loescheNachPk(Tabelle t, Spalte[] sp, int[] pkIdx, String[] w) throws SQLException {
      StringBuilder sql = new StringBuilder("DELETE FROM ").append(t.sql()).append(" WHERE ");
      for (int p = 0; p < pkIdx.length; p++) sql.append(p > 0 ? " AND " : "").append(quoteIdent(sp[pkIdx[p]].name)).append(" = ?");
      try (PreparedStatement ps = c.prepareStatement(sql.toString())) {
        for (int p = 0; p < pkIdx.length; p++) setzeWert(ps, p + 1, t, sp[pkIdx[p]], w[pkIdx[p]]);
        return ps.executeUpdate();
      } catch (SQLException e) {
        throw mitKontext(e, t, "Löschen", beschreibeSchluessel(t, pkIdx, w));
      }
    }

    int aktualisiere(Tabelle t, Spalte[] sp, int[] pkIdx, String[] alt, String[] neu) throws SQLException {
      List<Integer> geaendert = new ArrayList<>();
      for (int j = 0; j < sp.length; j++) {
        if (sp[j] != null && !Objects.equals(leer(alt[j]), leer(neu[j]))) geaendert.add(j);
      }
      if (geaendert.isEmpty()) return 0;
      StringBuilder sql = new StringBuilder("UPDATE ").append(t.sql()).append(" SET ");
      for (int g = 0; g < geaendert.size(); g++) sql.append(g > 0 ? ", " : "").append(quoteIdent(sp[geaendert.get(g)].name)).append(" = ?");
      sql.append(" WHERE ");
      for (int p = 0; p < pkIdx.length; p++) sql.append(p > 0 ? " AND " : "").append(quoteIdent(sp[pkIdx[p]].name)).append(" = ?");
      int n;
      try (PreparedStatement ps = c.prepareStatement(sql.toString())) {
        int idx = 1;
        for (int j : geaendert) setzeWert(ps, idx++, t, sp[j], neu[j]);
        for (int p = 0; p < pkIdx.length; p++) setzeWert(ps, idx++, t, sp[pkIdx[p]], alt[pkIdx[p]]);
        n = ps.executeUpdate();
      } catch (SQLException e) {
        throw mitKontext(e, t, "Ändern", beschreibeSchluessel(t, pkIdx, neu));
      }
      // Dort inzwischen gelöscht: INGAs Stand wieder anlegen, statt die Änderung zu verlieren.
      if (n == 0) return fuegeEin(t, sp, neu);
      return n;
    }

    int fuegeEin(Tabelle t, Spalte[] sp, String[] w) throws SQLException {
      StringBuilder namen = new StringBuilder();
      StringBuilder platz = new StringBuilder();
      List<Integer> idx = new ArrayList<>();
      for (int j = 0; j < sp.length; j++) {
        if (sp[j] == null || istBinaer(sp[j].typ)) continue;
        namen.append(idx.isEmpty() ? "" : ", ").append(quoteIdent(sp[j].name));
        platz.append(idx.isEmpty() ? "?" : ", ?");
        idx.add(j);
      }
      if (idx.isEmpty()) return 0;
      try (PreparedStatement ps = c.prepareStatement("INSERT INTO " + t.sql() + " (" + namen + ") VALUES (" + platz + ")")) {
        for (int k = 0; k < idx.size(); k++) setzeWert(ps, k + 1, t, sp[idx.get(k)], w[idx.get(k)]);
        return ps.executeUpdate();
      } catch (SQLException e) {
        if (hatSqlState(e, "23505")) throw e; // Konflikt – wird oben verständlich gemeldet
        throw mitKontext(e, t, "Anlegen", "");
      }
    }

    String bedingungAlleSpalten(Spalte[] sp, String[] w, List<Integer> benutzt) {
      StringBuilder sql = new StringBuilder();
      for (int j = 0; j < sp.length; j++) {
        if (sp[j] == null || istLob(sp[j].typ)) continue; // lange Texte lassen sich in Derby nicht vergleichen
        sql.append(sql.length() > 0 ? " AND " : "").append(quoteIdent(sp[j].name));
        if (leer(w[j]) == null) sql.append(" IS NULL");
        else { sql.append(" = ?"); benutzt.add(j); }
      }
      return sql.length() == 0 ? "1=1" : sql.toString();
    }

    int zaehleGleiche(Tabelle t, Spalte[] sp, String[] w) throws SQLException {
      List<Integer> benutzt = new ArrayList<>();
      String bedingung = bedingungAlleSpalten(sp, w, benutzt);
      try (PreparedStatement ps = c.prepareStatement("SELECT COUNT(*) FROM " + t.sql() + " WHERE " + bedingung)) {
        for (int k = 0; k < benutzt.size(); k++) setzeWert(ps, k + 1, t, sp[benutzt.get(k)], w[benutzt.get(k)]);
        try (ResultSet rs = ps.executeQuery()) { rs.next(); return rs.getInt(1); }
      }
    }

    void loescheGleiche(Tabelle t, Spalte[] sp, String[] w) throws SQLException {
      List<Integer> benutzt = new ArrayList<>();
      String bedingung = bedingungAlleSpalten(sp, w, benutzt);
      try (PreparedStatement ps = c.prepareStatement("DELETE FROM " + t.sql() + " WHERE " + bedingung)) {
        for (int k = 0; k < benutzt.size(); k++) setzeWert(ps, k + 1, t, sp[benutzt.get(k)], w[benutzt.get(k)]);
        ps.executeUpdate();
      }
    }

    /* -------------------------------------------------------- Komplett schreiben */

    /**
     * Lädt ein Perpustakaan-Zip komplett in die Datenbank (erst ALLE Tabellen
     * leeren, dann ALLE befüllen – bei Fremdschlüsseln findet
     * mitFremdschluesselRetry() selbst eine passende Reihenfolge), ALLES in
     * EINER Transaktion.
     */
    String load(String id, String zipQuelle) throws Exception {
      List<Object[]> tabellen = new ArrayList<>(); // {Tabelle, String[] spalten, List<String[]> zeilen}
      List<String[]> roh = new ArrayList<>();
      Map<String, List<String[]>> zeilenJeTabelle = new LinkedHashMap<>();
      try (ZipFile zip = new ZipFile(zipQuelle)) {
        Enumeration<? extends ZipEntry> entries = zip.entries();
        while (entries.hasMoreElements()) {
          ZipEntry entry = entries.nextElement();
          if (entry.isDirectory() || !entry.getName().toLowerCase(Locale.ROOT).endsWith(".csv")) continue;
          String name = entry.getName().replaceAll("^.*[\\\\/]", "").replaceAll("\\.[Cc][Ss][Vv]$", "");
          try (BufferedReader reader = new BufferedReader(new InputStreamReader(zip.getInputStream(entry), StandardCharsets.UTF_8))) {
            String kopf = reader.readLine();
            if (kopf == null || kopf.isEmpty()) continue;
            if (kopf.startsWith("﻿")) kopf = kopf.substring(1);
            List<String[]> zeilen = new ArrayList<>();
            String zeile;
            while ((zeile = reader.readLine()) != null) if (!zeile.isEmpty()) zeilen.add(zeile.split(";", -1));
            roh.add(new String[] { name, kopf });
            zeilenJeTabelle.put(name, zeilen);
          }
        }
      }
      verbinde();
      for (String[] r : roh) {
        Tabelle t = tabelle(r[0]);
        if (t == null) throw new IllegalStateException("Die Tabelle „" + r[0] + "“ gibt es in dieser Perpustakaan-Datenbank nicht.");
        tabellen.add(new Object[] { t, r[1].split(";", -1), zeilenJeTabelle.get(r[0]) });
      }
      c.setAutoCommit(false);
      try {
        mitFremdschluesselRetry(tabellen, x -> {
          try (Statement del = c.createStatement()) { del.execute("DELETE FROM " + ((Tabelle) x[0]).sql()); }
        });
        mitFremdschluesselRetry(tabellen, x -> {
          Tabelle t = (Tabelle) x[0];
          String[] spalten = (String[]) x[1];
          Spalte[] sp = new Spalte[spalten.length];
          for (int j = 0; j < spalten.length; j++) sp[j] = t.spalte(spalten[j]);
          @SuppressWarnings("unchecked") List<String[]> zeilen = (List<String[]>) x[2];
          for (String[] z : zeilen) {
            String[] werte = new String[spalten.length];
            for (int j = 0; j < spalten.length; j++) werte[j] = j < z.length ? z[j] : "";
            fuegeEin(t, sp, werte);
          }
        });
        c.commit();
      } catch (Exception e) {
        try { c.rollback(); } catch (SQLException ignored) { }
        throw e;
      } finally {
        try { c.setAutoCommit(true); } catch (SQLException ignored) { }
      }
      return "{" + (id == null ? "" : "\"id\":" + id + ",") + "\"ok\":true,\"tabellen\":" + tabellen.size() + "}";
    }
  }

  interface TabellenAktion { void anwenden(Object[] t) throws SQLException; }

  /** Schlägt eine Tabelle an einer Fremdschlüssel-Verletzung (23503) fehl, wandert sie ans Ende und wird später erneut versucht. */
  static void mitFremdschluesselRetry(List<Object[]> tabellen, TabellenAktion aktion) throws SQLException {
    Deque<Object[]> warteschlange = new ArrayDeque<>(tabellen);
    int versucheOhneFortschritt = 0;
    while (!warteschlange.isEmpty()) {
      Object[] t = warteschlange.poll();
      try {
        aktion.anwenden(t);
        versucheOhneFortschritt = 0;
      } catch (SQLException e) {
        if (hatSqlState(e, "23503") && versucheOhneFortschritt < warteschlange.size() + 1) {
          warteschlange.offer(t);
          versucheOhneFortschritt++;
          continue;
        }
        throw e;
      }
    }
  }

  /* ------------------------------------------------------------ Kleinkram */

  static String[] teile(String zeile) {
    String[] roh = zeile.split("\t", -1);
    for (int i = 0; i < roh.length; i++) roh[i] = entmaskiere(roh[i]);
    return roh;
  }

  static String entmaskiere(String s) {
    if (s.indexOf('\\') < 0) return s;
    StringBuilder b = new StringBuilder();
    for (int i = 0; i < s.length(); i++) {
      char ch = s.charAt(i);
      if (ch == '\\' && i + 1 < s.length()) {
        char n = s.charAt(++i);
        b.append(n == 't' ? '\t' : n == 'n' ? '\n' : n == 'r' ? '\r' : n);
      } else b.append(ch);
    }
    return b.toString();
  }

  static String leer(String s) { return s == null || s.isEmpty() ? null : s; }

  static String[] ersetzeNull(String[] w) {
    String[] r = new String[w.length];
    for (int i = 0; i < w.length; i++) r[i] = w[i] == null ? "" : w[i];
    return r;
  }

  static String schluessel(String[] w, int[] pkIdx) {
    StringBuilder b = new StringBuilder();
    for (int p : pkIdx) b.append(w[p] == null ? "" : rtrim(w[p].trim())).append('\u0001');
    return b.toString();
  }

  static String beschreibeSchluessel(Tabelle t, int[] pkIdx, String[] w) {
    StringBuilder b = new StringBuilder();
    for (int p = 0; p < pkIdx.length; p++) b.append(p > 0 ? ", " : "").append(t.pk.get(p)).append(" = ").append(w[pkIdx[p]]);
    return b.toString();
  }

  static SQLException mitKontext(SQLException e, Tabelle t, String aktion, String schluessel) {
    String grund = e.getMessage();
    if (hatSqlState(e, "22001")) grund = "Ein Text ist zu lang für das entsprechende Feld in Perpustakaan.";
    SQLException neu = new SQLException(aktion + " in „" + t.name + "“" + (schluessel.isEmpty() ? "" : " (" + schluessel + ")")
        + " fehlgeschlagen: " + grund, e.getSQLState());
    neu.setNextException(e);
    return neu;
  }
}
