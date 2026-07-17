@echo off
title Logi Actions Ring — Build ^& Run
cd /d "%~dp0"

REM Clear VS Code / IDE environment variables that prevent Electron GUI
set ELECTRON_RUN_AS_NODE=
set VSCODE_ESM_ENTRYPOINT=

echo ========================================
echo  Logi Actions Ring — Build ^& Launch
echo ========================================
echo.

echo [1/4] Building overlay renderer...
call npx vite build --config vite.config.overlay.ts
if %errorlevel% neq 0 (
    echo ERROR: Overlay build failed!
    pause
    exit /b 1
)

echo [2/4] Building dashboard renderer...
call npx vite build --config vite.config.dashboard.ts
if %errorlevel% neq 0 (
    echo ERROR: Dashboard build failed!
    pause
    exit /b 1
)

echo [3/4] Building main process + preloads...
call npx esbuild src/main/main.ts --bundle --platform=node --outfile=dist/main-bundled.js --external:electron --external:electron-store --format=cjs --target=node18
if %errorlevel% neq 0 (
    echo ERROR: Main process build failed!
    pause
    exit /b 1
)
call npx esbuild src/preload/overlay.ts --bundle --platform=node --outfile=dist/preload-overlay.js --external:electron --format=cjs --target=node18
call npx esbuild src/preload/dashboard.ts --bundle --platform=node --outfile=dist/preload-dashboard.js --external:electron --format=cjs --target=node18

echo.
echo [4/4] Launching Electron...
echo.
call npx electron .

pause
