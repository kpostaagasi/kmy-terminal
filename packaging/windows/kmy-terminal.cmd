@echo off
rem kmy terminal başlatıcı: veri %APPDATA%\kmy terminal altında tutulur.
set "BASE=%APPDATA%\kmy terminal"
if not defined BORSA_DATA_DIR set "BORSA_DATA_DIR=%BASE%\data"
if not defined BORSA_WORKSPACE_DIR set "BORSA_WORKSPACE_DIR=%BASE%\workspace"
if not exist "%BORSA_DATA_DIR%" mkdir "%BORSA_DATA_DIR%"
if not exist "%BORSA_WORKSPACE_DIR%" xcopy /e /i /q "%~dp0app\workspace" "%BORSA_WORKSPACE_DIR%" >nul
"%~dp0node.exe" "%~dp0app\bin\start.mjs" %*
