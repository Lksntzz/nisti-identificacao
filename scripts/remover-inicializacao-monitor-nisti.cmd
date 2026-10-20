@echo off
setlocal
set "FILE=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NISTI-Monitor.cmd"
if exist "%FILE%" del /Q "%FILE%"
echo Monitor NISTI removido da inicializacao automatica.
echo Dados de pareamento foram mantidos.
pause
endlocal
