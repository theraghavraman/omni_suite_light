# OmniConverter Studio — Full Local / Offline Edition

This repository supports two modes:

1. **GitHub/browser mode** — open the Pages site and use browser-side features.
2. **Full local mode** — install the native engines once, prepare the browser assets once, then run the complete UI from `127.0.0.1` without Internet access.

## One-click setup

### Windows

Double-click:

`setup_and_start.bat`

The Windows setup now installs **Poppler** automatically. Poppler supplies `pdftoppm` and `pdftotext`, which the Local Engine uses for PDF rendering, PDF text extraction and the native PDF → PPTX visual-replica path. The current Windows package is available through WinGet as `oschwartz10612.Poppler`.

Manual Windows install if needed:

```powershell
winget install --id oschwartz10612.Poppler --exact --silent --accept-package-agreements --accept-source-agreements
```

Then restart the terminal and run `start_omni.bat`. You can verify it with:

```powershell
pdftoppm -v
pdftotext -v
```

The public GitHub Pages version can generate the PDF → PPTX page-replica in the browser. The Local Engine provides the native Poppler path for larger PDFs and environments where browser rendering is not desirable.

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

The setup also creates a project-local `.venv` and installs the Data Studio/scientific Python stack there. Launchers automatically prefer that environment, so the Local Engine uses the packages that setup installed instead of depending on unrelated system Python packages.

## Native engines

The installer attempts to provide:

- FFmpeg — broad audio/video conversion, extraction, trimming and transcoding (MP4/MPEG-4, MKV, WebM, MOV, AVI, FLV, MPEG/MPG, TS/M2TS, 3GP, MP3, FLAC, Opus, WMA, AIFF and more).
- qpdf — PDF merging, splitting and optimization.
- Poppler — PDF rendering and text extraction.
- ImageMagick — broad image/graphics conversion, resizing, density and quality (SVG, GIF, TIFF, BMP, HEIC/HEIF, AVIF, JPEG XL, JPEG-2000, PSD, EXR, HDR and 100+ format families depending on delegates).
- Tesseract — native OCR.
- LibreOffice — Word/Excel/PowerPoint/OpenDocument conversions, including legacy, current, template and macro-enabled families where the installed filter supports them.
- Calibre — EPUB/ebook conversion across AZW/AZW3/AZW4, MOBI, CBZ/CBR/CB7, DJVU, FB2, LRF, LIT, PDB, PDF, DOCX, RTF, TXT and other documented formats.
- Python standard library — local HTTP server, archive operations and file streaming.
- Data Studio Python stack — pandas, PyArrow, DuckDB, PyYAML, SQLGlot, Excel/ODS readers, fastavro, BSON and MessagePack adapters.

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
- PDF → editable DOCX text extraction
- Unicode-safe Text/Markdown → DOCX/PDF
- Office document conversion
- EPUB/ebook conversion
- audio/video conversion and trimming
- image conversion/resizing
- OCR
- ZIP/GZIP/BZIP2/XZ/TAR/7z archive operations
- ZIP/GZIP

The browser features remain available for lightweight jobs.

## Native format coverage

The Local Engine exposes a capability inventory at /api/health. The UI uses this to document and test the broad format families without pretending every machine has identical codec/delegate support.

### Media
- Video/animation: MP4/MPEG-4, MKV, WebM, MOV, AVI, FLV, MPEG/MPG, M4V, 3GP/3G2, TS/M2TS/MTS, VOB, WMV, ASF, OGV, MXF, NUT, IVF, GIF and APNG.
- Audio: MP3, WAV, M4A, AAC, FLAC, OGG/OGA, Opus, WMA, AMR, AIFF/AIF/AIFC, AC-3/E-AC-3, AU, CAF, W64, WavPack, TTA, APE and MKA.

### Images
JPG/JPEG, PNG/APNG, WebP, AVIF, TIFF, BMP, GIF, SVG, ICO, HEIC/HEIF, JXL, JP2/J2K/J2C, TGA, DDS, EXR, HDR, DPX, EPS/PS, PDF, PNM family, PCX, MIFF/MVG, ORA, PSD, FITS, FLIF and BPG, subject to installed ImageMagick delegates.

### Office
DOC/DOCX/DOCM, DOT/DOTX/DOTM, ODT/OTT/FODT, RTF/TXT/Markdown/HTML; XLS/XLSX/XLSM/XLSB/XLT/XLTX/XLTM, ODS/OTS/FODS, CSV/TSV; PPT/PPTX/PPTM/PPS/PPSX/POT/POTX/POTM, ODP/OTP/FODP.

### Ebooks
AZW/AZW3/AZW4, CBZ/CBR/CB7/CBC, CHM, DJVU, DOCX, EPUB, FB2/FBZ, HTML/HTMLZ, KEPUB, LIT, LRF, MOBI, ODT, PDF, PRC, PDB/PML, RB, RTF, SNB, TCR, TXT and TXZ.

Format acceptance is intentionally broader than browser codec support. A particular conversion can still fail when the local executable was built without an encoder/decoder or delegate. FFmpeg exposes its enabled formats/codecs with ffmpeg -formats and ffmpeg -codecs.

## Data Studio

The Data Studio adds local conversion paths for structured and semi-structured data: CSV/TSV, JSON/JSONL, YAML, XML, Excel/XLSB, ODS, Parquet, ORC, Feather/Arrow IPC, Avro, SQLite, DuckDB, SQL scripts and MessagePack. It also provides SQL dialect translation, schema inference, dataset profiling, MongoDB BSON/Extended JSON conversion and DynamoDB JSON bridging.

SQL translation is powered by SQLGlot when installed; SQLGlot supports 30+ dialects with different support levels. Arrow/PyArrow provides the columnar interchange layer for Parquet, Feather/IPC, CSV, JSON and ORC.

The setup script installs the optional packages in `requirements-data.txt`. If they are absent, the Local Engine still starts and reports missing Data Studio modules at `/api/health` instead of crashing.

### Database-model boundary

The studio can generate SQL, CQL and Cypher bridge scripts and convert exported MongoDB/DynamoDB representations. It intentionally does not claim lossless conversion between fundamentally different data models such as relational rows, MongoDB documents, Redis structures and Neo4j graphs. Neo4j's own import documentation uses CSV as a common bridge for relational-to-graph migration, while MongoDB's export documentation distinguishes JSON/CSV from BSON type-preserving exports.

## Scientific / Earth / Astronomy Data Layer

The Universal Data & Signal Studio uses the Local Engine for native scientific formats that browsers do not reliably decode.

Supported readers:

- **FITS / FIT** — Astropy FITS reader for astronomy images and tables.
- **NetCDF / NC** — xarray with netCDF4/h5netcdf backends.
- **HDF5 / H5** — h5py hierarchical dataset reader.
- **NASA CDF** — cdflib reader.
- **GRIB / GRIB1 / GRIB2** — xarray + cfgrib + ecCodes reader.

These paths can convert scientific datasets to:

- JSON with dataset metadata, variables, dimensions, shapes, dtypes and values.
- CSV long-form data for analysis.
- PNG for compatible two-dimensional numeric arrays.
- NetCDF normalized datasets.
- HDF5 normalized datasets.
- FITS image/table output where the source data can be represented safely.

Scientific conversion is deliberately described as **normalized conversion**, not lossless source-format cloning. A FITS WCS header, NetCDF attributes, HDF5 group structure or GRIB meteorological metadata can contain semantics that do not have an equivalent in CSV or PNG. The JSON/profile path preserves more of that metadata than a flat media export.

The scientific Python stack is installed from `requirements-data.txt`. GRIB support requires an ecCodes runtime compatible with cfgrib. The installer reports missing packages rather than pretending unsupported scientific files are browser-readable.

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
