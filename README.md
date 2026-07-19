# Lolgi Action Ring

A Windows desktop action ring for fast, contextual shortcuts. Invoke the overlay, choose an action bubble, and keep common tools close to your cursor.

> This is an independent project and is not affiliated with Logitech.

## What it does

- Displays a radial action ring as a desktop overlay.
- Supports General and per-application profiles, so the ring can change with the active app.
- Lets you configure, organize, and edit bubbles from a dashboard.
- Includes static actions, nested submenus, and incremental controls such as volume, brightness, and zoom.
- Uses continuous two-color fill animation for incremental controls.
- Shows hover labels outside of bubbles to keep text readable and avoid collisions.
- Provides built-in action handling for keyboard shortcuts, launch targets, system controls, and diagnostics.
- Persists configuration locally and includes migration support for saved settings.

## Platform support

The current release targets **Windows x64**. A macOS version is not available yet.

## Download and install

Build artifacts are intentionally not committed to this repository. Download the latest installer from the project release, then run:

`Lolgi Action Ring Setup <version>.exe`

The installer is currently unsigned, so Windows SmartScreen may ask you to confirm the first launch.

## Run from source

### Requirements

- Windows 10 or later
- Node.js 18 or later
- npm

### Setup

```powershell
git clone https://github.com/bits933/lolgi.git
cd lolgi
npm install
Set-Location "windows app"
npm install
```

### Development

From the repository root:

```powershell
npm run dev:app
```

This watches and rebuilds the Electron main process, overlay, and dashboard. In a second terminal, launch the app after the first build finishes:

```powershell
npm run app
```

To build and launch in one command:

```powershell
npm run start:app
```

## Build a Windows installer

```powershell
Set-Location "windows app"
npm run dist
```

The full release command:

1. Generates build identity information.
2. Type-checks the application and runs the test suite.
3. Builds the overlay, dashboard, and Electron main process.
4. Packages a Windows x64 NSIS installer.
5. Verifies the packaged application and writes a release manifest with checksums.

The installer is written to:

```text
windows app/release/Lolgi Action Ring Setup <version>.exe
```

## Verify the build

```powershell
Set-Location "windows app"
npm run validate
npm run verify:package
```

## Project structure

```text
windows app/
  src/main/       Electron lifecycle, windows, IPC, profiles, and actions
  src/renderer/   Overlay ring and configuration dashboard
  src/shared/     Shared types, geometry, profiles, and action definitions
  scripts/        Build identity, package verification, and release manifest tools
  release/        Generated installer and packaging output (not committed)
src/              Web prototype/source surface
```

## Privacy

Configuration and diagnostics are kept locally. Do not commit personal profiles, local debug material, installers, or AI-tool configuration; the repository `.gitignore` is configured to exclude them.

## License

No license has been selected yet. All rights reserved until a license is added.
