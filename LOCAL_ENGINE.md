# OmniConverter Studio — Full Local / Offline Edition

This repository supports two modes:

1. **GitHub/browser mode** — open the Pages site and use browser-side features.
2. **Full local mode** — install the native engines once, prepare the browser assets once, then run the complete UI from `127.0.0.1` without Internet access.

## One-click setup

### Windows

Double-click:

`setup_and_start.bat`

or run:

`powershell -ExecutionPolicy Bypass -File install_windows.ps1`

then:

`start_omni.bat`

### macOS / Linux

Run:

`bash setup_and_start.command`

or separately:

`bash install_system_tools.command`

then:

`bash start_omni.command`

The setup phase needs Internet access once because it downloads the browser libraries, Tesseract.js worker/core assets and selected OCR language models. After that, the local application is designed to run without Internet.

## Native engines

The installer attempts to provide:

- FFmpeg — audio/video conversion, extraction, trimming and transcoding.
- qpdf — PDF merging, splitting and optimization.
- Poppler — PDF rendering and text extraction.
- ImageMagick — image conversion, resizing, density and quality.
- Tesseract — native OCR.
- LibreOffice — Word/Excel/PowerPoint/OpenDocument conversions.
- Calibre — EPUB/ebook conversion.
- Python standard library — local HTTP server, ZIP/GZIP and file streaming.

## Browser assets

`prepare_offline.py` downloads pinned browser dependencies into `vendor/`:

- PDF.js 3.11.174
- JSZip 3.10.1
- pdf-lib 1.17.1
- Tesseract.js 5.1.1
- tesseract.js-core 5.1.1
- OCR models for English, Hindi, Bengali, Marathi, Tamil, Telugu, Gujarati, Punjabi, German, French, Spanish and Simplified Chinese.

Tesseract.js requires its worker, core and language resources to be hosted locally for a genuinely offline browser deployment.

## Local UI

The local server serves the actual `index.html` and `vendor/` directory, so users do not need GitHub Pages while working offline:

`http://127.0.0.1:8765/`

It automatically attempts to open the browser.

## Heavy-job routing

The Local Engine panel exposes native operations for:

- PDF merge
- PDF split
- PDF compression
- PDF rendering
- PDF text extraction
- Office document conversion
- EPUB/ebook conversion
- audio/video conversion and trimming
- image conversion/resizing
- OCR
- ZIP/GZIP

The browser features remain available for lightweight jobs.

## Security

The local service binds to loopback only. It does not expose an arbitrary shell command endpoint. Browser requests select predefined operations.

API hardening has two layers:
- **Origin allowlist:** by default the server accepts browser requests from `127.0.0.1:8765`, `localhost:8765` and the project's GitHub Pages origin. Additional trusted origins can be supplied through `OMNI_ALLOWED_ORIGINS`.
- **Per-launch token:** the server generates a cryptographically random token at startup (or uses `OMNI_TOKEN` when explicitly supplied). Upload, processing and output-download requests must provide it in `X-Omni-Token`. The health endpoint is used to pair an allowed browser origin with the running engine.

This prevents an unrelated website from using the loopback API merely because the engine happens to be running. Do not expose the service beyond loopback or weaken the origin/token checks.

Uploaded and generated files are stored in the operating system temporary directory and stale files are cleaned automatically.

## Large files

Uploads and output downloads are streamed to disk instead of being read into Python memory in one operation. This makes the local path substantially more suitable for large files than a pure browser workflow.

## Native binaries

The repository does not redistribute FFmpeg, qpdf, Poppler, ImageMagick, Tesseract, LibreOffice or Calibre binaries. The setup scripts obtain platform-appropriate packages. Their respective licenses and distribution terms apply.

## GitHub Pages

The public Pages version continues to use the browser/CDN path and does not require the local engine. For maximum offline capability, use the local launcher after running setup.
