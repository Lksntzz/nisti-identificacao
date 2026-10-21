@echo off
setlocal
title NISTI - Backup Criptografado
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%~dp0nisti-backup-assistant.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
echo Pressione qualquer tecla para fechar esta janela.
pause >nul
exit /b %RESULT%
