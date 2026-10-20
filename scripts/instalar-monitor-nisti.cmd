@echo off
setlocal
REM Instala o monitor NISTI na entrada da sessao Windows do usuario atual.
set "SRC=%~dp0abrir-monitor-nisti.cmd"
set "DIR=%LOCALAPPDATA%\NISTI\Monitor"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
if not exist "%SRC%" (
 echo ERRO: mantenha este arquivo com abrir-monitor-nisti.cmd na mesma pasta.
 pause
 exit /b 1
)
if not exist "%DIR%" mkdir "%DIR%"
if not exist "%STARTUP%" (
 echo ERRO: pasta Startup nao encontrada.
 pause
 exit /b 1
)
copy /Y "%SRC%" "%DIR%\abrir-monitor-nisti.cmd" >nul
if errorlevel 1 exit /b 1
copy /Y "%DIR%\abrir-monitor-nisti.cmd" "%STARTUP%\NISTI-Monitor.cmd" >nul
if errorlevel 1 exit /b 1
echo NISTI configurado para abrir quando este usuario entrar no Windows.
start "" "%DIR%\abrir-monitor-nisti.cmd"
pause
endlocal
