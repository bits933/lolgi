@echo off
title Logi Actions Ring - Build and Run
cd /d "%~dp0"

REM Clear IDE variables that can force Electron to run as a Node process.
set ELECTRON_RUN_AS_NODE=
set VSCODE_ESM_ENTRYPOINT=

echo ========================================
echo  Logi Actions Ring - Build and Launch
echo ========================================
echo.

echo [1/2] Running the complete application build...
call npm run build
if errorlevel 1 (
    echo ERROR: Application build failed.
    pause
    exit /b 1
)

echo.
echo [2/2] Launching Electron...
echo.
call npm run electron
if errorlevel 1 (
    echo ERROR: Electron exited with an error.
    pause
    exit /b 1
)

pause
