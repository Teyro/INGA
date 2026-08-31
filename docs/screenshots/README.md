# Screenshots für die Haupt-README

Dieser Ordner ist bewusst (noch) ohne Bilder eingecheckt – in der
Entwicklungsumgebung, in der dieser Stand entstanden ist, gab es kein Display
und keine Root-Rechte, um einen virtuellen Bildschirm (Xvfb) zu installieren.
Die Haupt-`README.md` verlinkt trotzdem schon auf die Dateien unten, damit du
sie nur noch reinlegen musst.

## So machst du die Screenshots

```bash
npm start
```

Empfohlene Fenstergröße: Standard (1240×820) reicht. Für ein Kind mit
überfälliger Ausleihe in den Screenshots lohnt es sich, vorher kurz testweise
etwas auszuleihen und im Code das `AuslDatum` ein paar Tage zurückzudatieren
(oder einfach ein paar Tage warten 😉) – sonst ist die „Vergessene
Rückgaben“-Liste im Dashboard leer.

## Erwartete Dateien

| Datei | Zeigt |
|---|---|
| `dashboard.png` | Übersicht: Kennzahlen, Schnellsprung, „Vergessene Rückgaben“, „Meistausgeliehene Bücher“ |
| `katalog.png` | Katalog-Liste mit Medienart-/Verfügbarkeits-Filter |
| `buchdetail.png` | Die Buchdetailseite (breites Sheet) mit Cover, Exemplaren und Ausleihstatistik |
| `nutzer.png` | Nutzerliste mit Filtern und rot markierter überfälliger Zeile |
| `ruecktabe.png` | Offene Ausleihen mit Status-Badges |
| `joern-mahnungen.png` | JÖRN: die Mahnungen-Liste mit Filtern |
| `joern-editor.png` | JÖRN: der Mahnungseditor in den Einstellungen (Stufen, Brieftext, Vorschau) |
| `einstellungen-ausleihe.png` | Einstellungen: Fristverschiebung und Bulk-Verschiebung |
| `splash.png` | Der Splashscreen (kurz sichtbar beim Start) |

Format: PNG, am besten mit macOS-/Windows-/Linux-nativer Fensteroptik –
INGA passt sich ja automatisch an, ein Screenshot vom eigenen System zeigt
also direkt, wie es bei den meisten Nutzer:innen aussieht.
