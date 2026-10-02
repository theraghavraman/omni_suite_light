# OmniConverter Studio — Local Engine

OmniConverter can run in two modes:

- **Browser mode:** no installation; best for normal-sized jobs.
- **Local Engine mode:** optional native processing for large PDFs, media, images, archives and OCR.

## Install

### Windows
Run `install_windows.ps1` in PowerShell, then start `start_omni.bat`.

### macOS / Linux
Run `bash install_system_tools.command`, then `bash start_omni.command`.

The local service listens only on loopback at port 8765.

## Native capabilities

- FFmpeg: audio/video conversion and trimming.
- qpdf: PDF merge, split and compression.
- Poppler: PDF page rendering.
- ImageMagick: image conversion, resizing and compression.
- Tesseract: local OCR.
- Python standard library: ZIP/GZIP and the local HTTP bridge.

Native binaries are installed through the user's platform package manager rather than stored in GitHub.

## Using it from the website

Open the GitHub Pages site and select **Local Engine**. The status indicator changes to **connected** when the local bridge is running. Select files, choose an operation, and run the job.

The server exposes predefined operations only; it is not an arbitrary command-execution API.

## Troubleshooting

If the website says Browser-only mode:

1. Make sure the local engine terminal is still running.
2. Open `http://127.0.0.1:8765/api/health` in the browser.
3. Restart the engine after installing native tools so PATH changes are loaded.
4. Refresh the Local Engine panel.

For security, the service binds to 127.0.0.1 rather than a LAN interface.
