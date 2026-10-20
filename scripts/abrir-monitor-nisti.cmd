@echo off
setlocal
REM NISTI Notificacoes - usar em PC Windows dedicado e autorizado.
REM Janela de aplicativo, NAO kiosk InPrivate: mantem o pareamento entre reinicios.
set "MONITOR_URL=https://nisti-identificacao.lksntz1411.workers.dev/monitor-notificacoes"
set "PROFILE=%LOCALAPPDATA%\NISTI\MonitorEdge"
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" (
  echo Microsoft Edge nao encontrado neste computador.
  echo Instale o Microsoft Edge e execute novamente.
  pause
  exit /b 1
)
if not exist "%PROFILE%" mkdir "%PROFILE%"
start "" "%EDGE%" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --autoplay-policy=no-user-gesture-required --start-fullscreen --app="%MONITOR_URL%"
endlocal
