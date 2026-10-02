# OmniConverter Studio

A browser-based document, media, image, OCR and archive utility suite with an optional native local engine.

## Run online

Open the GitHub Pages site. Browser-side tools work without installing the native engine.

## Run locally — recommended for full capability

### Windows
Run `setup_and_start.bat`.

### macOS / Linux
Run `bash setup_and_start.command`.

The setup installs available native engines and downloads the browser-side assets into `vendor/`. After setup, the local application can be used without Internet access.

## Local capabilities

- PDF rendering, merge, split, compression and text extraction
- Office conversion through LibreOffice
- EPUB/ebook conversion through Calibre
- Audio/video conversion and trimming through FFmpeg
- Image conversion/resizing/compression through ImageMagick
- Native Tesseract OCR
- Browser OCR with locally hosted Tesseract.js assets and language models
- ZIP/GZIP processing
- Browser-side conversion tools for lightweight jobs
- Large-file streaming through the local engine

## Architecture

The same `index.html` powers the public browser experience and the local experience. When the Python local server detects a complete `vendor/` asset set, it serves the HTML with local JavaScript/WASM/OCR resources instead of CDN URLs.

The local engine binds to `127.0.0.1:8765` only.

## Setup requirements

Initial setup requires Internet access to download browser assets and platform packages. After setup, the local UI is designed to operate offline.

## Files

- `index.html` — main application
- `omni_local_server.py` — local HTTP/API engine
- `prepare_offline.py` — downloads pinned browser dependencies
- `install_windows.ps1` — Windows native setup
- `install_system_tools.command` — macOS/Linux native setup
- `start_omni.bat` / `start_omni.command` — launchers
- `LOCAL_ENGINE.md` — detailed local/offline documentation
- `THIRD_PARTY_NOTICES.md` — dependency licensing notes

## Important

Native binaries are not redistributed in the Git repository. The installers obtain them through the user's platform package manager. Their own licenses apply.

Tesseract.js requires local worker/core/language resources for a genuinely offline browser deployment; the preparation script handles those resources.
