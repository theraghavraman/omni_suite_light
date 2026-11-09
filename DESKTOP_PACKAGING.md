# OmniConverter Studio — Standalone Desktop Packaging Guide

This guide documents how OmniConverter Studio (`theraghavraman/omni_suite_light`) is packaged as a standalone desktop application that installs once and opens ready to use on **Windows**, **macOS**, and **Linux** using [Electron](https://electronjs.org/docs/latest/tutorial/process-model) and [Electron Forge](https://www.electronforge.io/core-concepts/build-lifecycle).

## 1. Architecture Overview

1. **Electron App Shell (`electron/main.cjs` & `electron/preload.cjs`)**
   - Spawns `omni_local_server.py` in the background bound strictly to `127.0.0.1` (`OMNI_HOST=127.0.0.1`) with `OMNI_NO_BROWSER=1` so no external browser window is opened.
   - Polls `http://127.0.0.1:<port>/healthz` until the Local Engine is ready, then loads `http://127.0.0.1:<port>/` inside a sandboxed `BrowserWindow` (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`).
   - Automatically injects the per-launch `window.OMNI_TOKEN` via `ui_auth_bootstrap()` so authenticated Local Engine requests succeed without exposing the token to external origins.
   - Cleanly terminates the Python child process tree (`SIGTERM` on macOS/Linux, `taskkill /T` on Windows) when the app closes.

2. **Bundled Python Runtime, Offline Assets & Native Tools (`scripts/stage_desktop_bundle.py`)**
   - Stages the Local Engine (`omni_local_server.py`, `omni_*.py`), Studio UI (`index.html`, `*.js`, `*.css`), `knowledge-base/`, and `THIRD_PARTY_NOTICES.md` into `build/omni-engine/`.
   - Verifies or downloads all 41 SHA-256-pinned browser assets (`PDF.js 6.2.108`, `Tesseract.js`, `JSZip`, `SheetJS`, `ExcelJS`, `PptxGenJS`, `DOMPurify`, `Mermaid`, `sql.js`, and 12 OCR language packs) into `vendor/` via `prepare_offline.py`.
   - Stages the Python runtime (`build/python-runtime/`) and OS/architecture-specific native CLI binaries (`FFmpeg`, `FFprobe`, `qpdf`, `Poppler`, `Tesseract`, `LibreOffice`, `Calibre`, `ImageMagick`, `Ghostscript`, `Pandoc`, `7-Zip`) into `build/native-tools/<platform>-<arch>/bin/` along with `THIRD_PARTY_NOTICES.md`.

3. **First-Launch Readiness Check (`omni_desktop_readiness.js`)**
   - Runs automatically on first launch in the desktop app and is accessible anytime via the top-right `READY` pill in the application bar.
   - Displays real-time readiness across Browser Studios, SHA-256 Offline Vendor Assets, the Python Local Engine, and each native CLI tool.

## 2. Building Desktop Installers Locally

### Step 1: Stage Offline Assets, Python Runtime, and Native Tools

```bash
python3 scripts/stage_desktop_bundle.py --download-offline --create-venv
```

To install the full local Python data and scientific stack into the staged runtime:

```bash
# macOS / Linux
build/python-runtime/bin/python3 -m pip install -r requirements-local.txt

# Windows (PowerShell)
.\build\python-runtime\Scripts\python.exe -m pip install -r requirements-local.txt
```

### Step 2: Install Node Dependencies & Run in Development Mode

```bash
npm install
npm run desktop:start
```

### Step 3: Build OS-Specific Installers (`out/make/`)

```bash
npm run desktop:make
```

Configured [Electron Forge Makers](https://www.electronforge.io/config/makers) in `electron/forge.config.cjs`:
- **Windows (`win32`)**: `@electron-forge/maker-squirrel` (`OmniConverter-Studio-Setup.exe`) and `.zip`
- **macOS (`darwin`)**: `@electron-forge/maker-dmg` (`OmniConverter-Studio.dmg`) and `.zip`
- **Linux (`linux`)**: `@electron-forge/maker-deb` (`.deb`), `@electron-forge/maker-rpm` (`.rpm`), and `.zip`

## 3. macOS Code Signing & Notarization

For direct macOS distribution outside the Mac App Store, set the following environment variables before running `npm run desktop:make` so `electron/forge.config.cjs` enables Hardened Runtime signing (`electron/entitlements.mac.plist`) and Apple `notarytool` notarization ([Apple Notarization Guidance](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)):

```bash
export OMNI_MAC_SIGN=1
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run desktop:make
```

## 4. Security Verification & Release Gates

Before distributing an installer, run the repository verification suite:

```bash
npm run desktop:verify
python3 .github/scripts/local_engine_security_test.py
node tests/test_security_browser.cjs
node .github/scripts/studio_wiring_check.mjs
```

 As documented in `SECURITY_REMEDIATION_STATUS.md`, unsafe operations (`code_execute`, `archive_extract` for 7z/RAR, and unverified LAN file transfers) remain fail-closed (`HTTP 503`) in the desktop bundle until isolated sandboxes and TLS device pairing are configured.
