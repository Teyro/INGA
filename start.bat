@echo off
REM Startet INGA unter Windows 11 - ohne Fachwissen bedienbar: prueft
REM fehlende Voraussetzungen (Node.js, Projektabhaengigkeiten) und meldet
REM sie verstaendlich, statt mit einem kryptischen Fehler abzubrechen.
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js wurde nicht gefunden.
  echo Bitte zuerst Node.js ^(Version 22 oder neuer^) installieren: https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -e "process.stdout.write(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 22 (
  echo Gefundene Node.js-Version ist zu alt. INGA braucht Node.js 22 oder neuer.
  echo Bitte eine aktuelle Version installieren: https://nodejs.org/
  pause
  exit /b 1
)

if not exist node_modules (
  echo Abhaengigkeiten werden einmalig installiert - das kann beim ersten Start ein paar Minuten dauern ...
  call npm install
  if errorlevel 1 (
    echo Installation fehlgeschlagen. Bitte die Meldung oben pruefen ^(z. B. Internetverbindung^).
    pause
    exit /b 1
  )
)

call npm start
if errorlevel 1 pause
