#!/usr/bin/env bash
# Startet INGA unter Linux und macOS – ohne Fachwissen bedienbar: prüft
# fehlende Voraussetzungen (Node.js, Projektabhängigkeiten) und meldet sie
# verständlich, statt mit einem kryptischen Fehler abzubrechen.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js wurde nicht gefunden."
  echo "Bitte zuerst Node.js (Version 22 oder neuer) installieren: https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -e 'process.stdout.write(process.versions.node.split(".")[0])')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Gefundene Node.js-Version ist zu alt ($(node -v)). INGA braucht Node.js 22 oder neuer."
  echo "Bitte eine aktuelle Version installieren: https://nodejs.org/"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Abhängigkeiten werden einmalig installiert – das kann beim ersten Start ein paar Minuten dauern …"
  npm install
fi

exec npm start
