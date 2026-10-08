# OmniConverter Studio

**A private, offline-capable file toolkit that keeps processing on your device.**

OmniConverter Studio is a browser-first document, image, OCR, audio, video, archive and data-engineering utility suite. The public layer works without installation for browser-capable jobs; the optional Local Engine adds native desktop processing for heavy and specialist formats.

It has two execution modes:
1. Browser mode — the public GitHub Pages site. Files are processed locally by JavaScript/WASM inside the browser.
2. Local Engine mode — the same interface served from your computer, with a Python loopback server that can call installed native tools such as FFmpeg, qpdf, Poppler, LibreOffice, Calibre, ImageMagick, Tesseract and Pandoc.

> GitHub Pages can run browser JavaScript, but it cannot execute programs installed on your PC. When a conversion needs a native program, use the Local Engine instructions below.


## Complete local environment profile

The repository now contains a single **complete Python profile** in `requirements-local.txt`. The one-click installers use this file rather than asking users to choose between dependency lists. It layers:

- Data Studio: pandas, PyArrow, DuckDB, YAML, SQLGlot, Excel/ODS/legacy spreadsheet readers, Avro, BSON/MessagePack and profiling.
- Scientific: NumPy, SciPy, SymPy, xarray, NetCDF4, HDF5/h5netcdf, Astropy, CDF/GRIB/eccodes and Pillow.
- Database: SQLAlchemy, PostgreSQL, MySQL, Oracle, ODBC, DuckDB, Snowflake, BigQuery, Databricks, Trino, ClickHouse, Redshift, Cassandra, Redis, Neo4j and DynamoDB connectors.
- Archive/media: py7zr, rarfile, imageio, pydub and MoviePy.
- Object-store/file adapters: fsspec, S3, GCS and Azure filesystem adapters.
- Local OCR/vision runtime: EasyOCR.

The installer also provisions the native engines required by the studios: FFmpeg/FFprobe, qpdf, Poppler, ImageMagick plus common image delegates, Ghostscript, Tesseract plus language packs, LibreOffice, Calibre, Pandoc and 7-Zip. It downloads the pinned browser/OCR assets into `vendor/` for the local offline deployment.

After installation, `verify_local_environment.py` runs a strict check of Python imports, native executables, offline assets and `pip check`. The setup is considered complete only when this verifier passes.

**One-command rule:** use `Omni.bat` on Windows or `Omni.command` on macOS/Linux. Those launchers automatically start the full installer when the local environment is not ready.

## 0.5 Platform layer

The suite now includes a **Local Engine Doctor**, dynamic capability routing, **Batch Lab** with isolated failures/retry, **Database Studio**, **Data Cleaning & Privacy Studio**, and a static CI contract audit. The Doctor reports Python packages and native executables separately so the UI can distinguish a real local capability from an unavailable dependency.

The extended Local Engine stack is declared in `requirements-extended.txt` and adds optional database drivers (PostgreSQL/MySQL/Oracle/ODBC), Polars, SciPy, SymPy, FastParquet, SQLAlchemy, archive/media helpers and image tooling. `easyocr` is intentionally not installed automatically because its ML runtime is substantially larger; it can be added separately when desired.

### Batch processing

Batch Lab uploads multiple files once, executes the selected operation, records per-file success/failure, preserves successful outputs, and supports retrying only failed inputs. A JSON manifest can be downloaded for automation/auditing.

### Database Studio

Database Studio is deliberately **read-only**: it permits SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA-style inspection and blocks mutating SQL. SQLite works without an external driver; PostgreSQL, MySQL, Oracle and ODBC drivers are optional Local Engine dependencies.

### Data Cleaning & Privacy

Cleaning supports duplicate removal, whitespace trimming, normalized column names, empty-row removal, numeric null filling and column ordering. Privacy scanning is heuristic and reports likely email, phone, IP, URL, PAN-like, Aadhaar-like and payment-card-like patterns plus a SHA-256 fingerprint. It is an aid for review, not a compliance certification.

## 1. Quick start — online browser version

Open the published GitHub Pages site.

### Basic workflow
1. Open the required tab.
2. Tap/click the upload area.
3. Select the file from your device.
4. Wait for the filename/control panel to appear.
5. Choose the required options.
6. Press the action button that appears.
7. The generated file is downloaded by the browser.

Desktop users can also drag files onto upload areas. Browser file inputs and drag/drop are standard File API mechanisms.

## 2. Typography

The interface uses a system-safe sans-serif font stack. No external web-font request is required by the application, so typography does not create an offline network dependency.

## 3. Browser mode vs Local Engine

| Capability | Browser / GitHub Pages | Local Engine |
|---|---|---|
| Image conversion | Yes | Yes |
| Image resizing / pixel reduction | Yes | Yes |
| Image → PDF | Yes | Yes |
| Browser OCR | Yes | Yes |
| PDF page rendering | Yes | Yes |
| Lightweight PDF operations | Yes | Yes |
| ZIP/GZIP browser operations | Yes | Yes |
| Large PDF processing | Memory-dependent | Recommended |
| Large ZIP/archive processing | Memory-dependent | Recommended |
| FFmpeg video conversion | Limited browser support | Yes |
| FFmpeg audio conversion | Limited browser support | Yes |
| qpdf PDF compression/merge/split | No native binary on Pages | Yes |
| Poppler PDF rendering/text extraction | No native binary on Pages | Yes |
| LibreOffice Office conversion | No | Yes |
| Calibre EPUB/ebook conversion | No | Yes |
| ImageMagick native processing | No | Yes |
| Native Tesseract OCR | No | Yes |
| Data format conversion / profiling | Limited browser support | Yes |
| Fully offline browser assets | No on first public visit | Yes after setup |

### Rule of thumb
Use Browser mode for ordinary images, OCR, text extraction and smaller jobs.
Use Local Engine when the application says native/local processing required, when a file is very large, or when you need FFmpeg/qpdf/Poppler/LibreOffice/Calibre/ImageMagick.

## 4. Windows — complete local setup

### Option A — one-click setup
From the repository folder, double-click:

    setup_and_start.bat

The launcher attempts to:
1. Check/install Python.
2. Install supported native utilities through Windows Package Manager when available.
3. Download the pinned browser-side JavaScript/WASM/OCR resources.
4. Start the local Python server.
5. Open the local OmniConverter page.

Keep the server window running while using Local Engine features.

### Option B — manual Windows setup
Open PowerShell in the project folder and run:

    powershell -ExecutionPolicy Bypass -File .\install_windows.ps1
    python prepare_offline.py
    python omni_local_server.py

Then open:

    http://127.0.0.1:8765/

### Windows native components
The installer attempts to obtain Python, FFmpeg, qpdf, Poppler, ImageMagick, Tesseract OCR, LibreOffice, Calibre and Pandoc, then installs both the core Data/Scientific stack and the optional extended Python stack.

If Windows Package Manager is unavailable, install missing utilities manually and restart the local server.

## 5. macOS / Linux — complete local setup

Run:

    bash setup_and_start.command

or:

    bash install_system_tools.command
    python3 prepare_offline.py
    python3 omni_local_server.py

Open http://127.0.0.1:8765/ if the browser does not open automatically.

The installer recognizes common package managers such as Homebrew, apt, dnf, pacman and zypper. Exact package availability depends on the OS/distribution.

## 6. What “Local Engine connected” means

The Local Engine listens only on 127.0.0.1:8765. Mutating/processing API requests require a per-launch `X-Omni-Token`, and browser origins are restricted to the local UI plus the published GitHub Pages origin by default. Custom trusted origins can be added with `OMNI_ALLOWED_ORIGINS`.

The browser UI checks http://127.0.0.1:8765/api/health and uses that response to pair the published UI with the running local engine.

If the engine is not running, the browser UI remains usable for browser-capable tools.

## 7. When Local Engine is required

### Video
Use Local Engine for MP4/MOV/MKV conversion, codec changes, reliable transcoding, large video files, precise FFmpeg trimming and audio/video extraction.

### Audio
Use Local Engine for MP3/AAC/FLAC/OGG/M4A conversion, large files and codec changes.

### PDF
Use Local Engine for large PDFs, qpdf compression, robust merge/split, Poppler rendering and native text extraction.

### Office documents
Use Local Engine for DOC/DOCX/ODT/RTF and related conversions through LibreOffice.

### EPUB / ebook
Use Local Engine for EPUB/PDF and other Calibre-supported ebook conversions.

### Images
Use Local Engine for very large images, batch conversion, ImageMagick-supported formats and native format handling unavailable in the browser.

### OCR
Browser OCR is useful for normal images. Use Local Engine for very large inputs or when native Tesseract is required.

## 8. Offline mode — what it actually means

The public GitHub Pages version normally references browser libraries from CDNs, so the first public visit is not a completely self-contained offline package.

Running:

    python prepare_offline.py

downloads the pinned browser assets into vendor/. The local server then rewrites the application's browser dependency URLs to local files when the required assets exist.

This includes PDF.js, JSZip, pdf-lib, Tesseract.js, the Tesseract worker/core WASM files and selected OCR language models.

After the one-time online preparation, the local browser application is designed to operate without Internet access.

Native utilities are intentionally not redistributed in this repository. The installers obtain them through the operating system/package manager, and those programs retain their own licenses.

### Format coverage — native Local Engine
The browser layer intentionally stays conservative because browsers cannot encode every desktop format. The Local Engine expands coverage through FFmpeg, ImageMagick, LibreOffice, Poppler/qpdf and Calibre.

**Video / animation:** MP4/MPEG-4, MKV, WebM, MOV, AVI, FLV, MPEG/MPG, M4V, 3GP/3G2, TS/M2TS/MTS, VOB, WMV, ASF, OGV, MXF, NUT, IVF, GIF and APNG.

**Audio:** MP3, WAV, M4A, AAC, FLAC, OGG/OGA, Opus, WMA, AMR, AIFF/AIF/AIFC, AC-3/E-AC-3, AU, CAF, W64, WavPack, TTA, APE and Matroska Audio.

**Images / graphics:** JPG/JPEG/JFIF, PNG/APNG, WebP, AVIF, TIFF, BMP, GIF, SVG, ICO, HEIC/HEIF, JPEG XL, JPEG-2000, TGA, DDS, EXR, HDR, DPX, EPS/PS, PDF, PNM/PPM/PGM/PBM/PAM, PCX, MIFF/MVG, ORA, PSD, FITS, FLIF and BPG, plus delegate-dependent formats. HEIC/HEIF output is a Local Engine/ImageMagick path; it is not silently substituted with JPG. ImageMagick documents 100+ major formats; exact read/write support depends on the installed delegates.

**Office / spreadsheets / presentations:** DOC/DOCX/DOCM, DOT/DOTX/DOTM, ODT/OTT/FODT, RTF/TXT/Markdown/HTML; XLS/XLSX/XLSM/XLSB/XLT/XLTX/XLTM, ODS/OTS/FODS, CSV/TSV; PPT/PPTX/PPTM/PPS/PPSX/POT/POTX/POTM, ODP/OTP/FODP. LibreOffice exposes these through conversion filters, although some formats/features are import-only or have fidelity limitations.

**Ebooks:** AZW/AZW3/AZW4, CBZ/CBR/CB7/CBC, CHM, DJVU, DOCX, EPUB, FB2/FBZ, HTML/HTMLZ, KEPUB, LIT, LRF, MOBI, ODT, PDF, PRC, PDB/PML, RB, RTF, SNB, TCR, TXT and TXZ. Calibre documents a broad input/output conversion matrix; not every output is appropriate for every source.

**Archives / compression:** ZIP, TAR, GZIP, BZIP2, XZ and 7z are available through the native archive bridge; ZIP/GZIP/DEFLATE/Brotli also remain available in the browser studio. Native 7z requires the local 7-Zip executable. Python provides the standard-library TAR/GZIP/BZIP2/XZ paths.

**PDF:** PDF merge/split/compress/render/text extraction remain PDF-specific operations. PDF → PPTX can be generated in the browser as a visual page replica, or by the Local Engine with Poppler. Each PDF page becomes a slide image; this is not editable-object reconstruction.

**Important:** “Supported” means the engine accepts the format family and will attempt conversion. Codec/delegate availability varies by local FFmpeg/ImageMagick/LibreOffice/Calibre build. FFmpeg builds can be inspected with `ffmpeg -formats` and `ffmpeg -codecs`.

### Data Studio — structured, semi-structured and database data
The Data Studio is the new data-engineering layer. It uses pandas/PyArrow/DuckDB and optional format-specific libraries locally; no dataset is uploaded to a cloud service by OmniConverter.

**Structured:** CSV/TSV, XLS/XLSX/XLSB, ODS, HDF5, Parquet, ORC, Feather/Arrow IPC, Avro, SQLite and DuckDB, plus Stata/SAS/SPSS readers.

**Semi-structured:** JSON, JSONL/NDJSON, YAML, XML, HTML tables, MessagePack and JSON Schema generation.

**Unstructured / binary:** line-oriented TXT/LOG/Markdown can be structured into JSONL/JSON/CSV, while arbitrary binary BLOBs can be converted between raw bytes, Base64, hex and generic SQL hexadecimal literals.

**SQL:** DDL/INSERT generation plus SQL dialect translation for Oracle, Microsoft SQL Server/T-SQL, PostgreSQL, MySQL, SQLite, DuckDB, Snowflake, BigQuery, Databricks, Redshift, Spark SQL, Trino, Presto, ClickHouse, Hive, Teradata, Athena and additional SQLGlot dialects. SQLGlot officially supports 30+ dialects with different support levels.

**NoSQL/document bridges:** MongoDB BSON/Extended JSON ↔ JSON/JSONL/CSV/SQL, DynamoDB AttributeValue JSON ↔ normal JSON, and generated CQL/Cypher from flattened document datasets. MongoDB documents that Extended JSON is useful when BSON type fidelity matters; Neo4j and Cassandra both provide CSV-oriented import workflows.

**Columnar / analytics:** Parquet, ORC, Feather/Arrow IPC and Avro provide interchange paths for analytical systems. Arrow exposes a common table model and dataset APIs for Parquet, IPC/Feather, CSV, JSON and ORC.

**Important:** Data-model conversion is not the same as database migration. A relational table, MongoDB document, Redis key/value structure and Neo4j graph have different semantics. Data Studio therefore generates bridge files/scripts rather than pretending that a lossless “everything-to-everything” conversion exists.

### Office Studio formats
Office Studio uses the Local Engine for native Office-family conversion. It now includes legacy, current, macro-enabled, template and OpenDocument families. VBA/macros and application-specific features are not guaranteed to survive conversion; LibreOffice documents fidelity limitations for complex Microsoft Office files.
- **Presentations:** PPT, PPTX, PPTM, PPS, PPSX, POT, POTX, POTM, ODP, OTP, FODP
- **Spreadsheets:** XLS, XLSX, XLSM, XLSB, XLT, XLTX, XLTM, ODS, OTS, FODS, CSV, TSV
- **Documents:** DOC, DOCX, DOCM, DOT, DOTX, DOTM, ODT, OTT, FODT, RTF, TXT, HTML
- **PDF → PPTX:** rendered as one slide per PDF page using Poppler.

## 8. Diagnostics and full option testing

The guide area includes **Run Browser Diagnostics** for a quick runtime check of the core browser libraries and capabilities.

The navigation also includes a separate **All Tests** screen. It inventories every studio, upload input, control, button and every selectable option. **Test Every Option** safely dispatches change events for each select option and keeps the structure and option results together. It does not pretend that clicking every conversion action with fabricated files proves the real conversion pipeline; native/heavy operations should be exercised with the Browser/Local Test Lab and real representative files.

The All Tests screen covers:
- PDF Suite
- Office Studio
- EPUB Studio
- Image Tools
- Image to Text / OCR
- Audio Studio
- Video Studio
- Compressor
- Local Engine

## 9. Browser upload troubleshooting

If an upload area does nothing:
1. Hard-refresh the page.
2. Tap/click the center of the upload area.
3. Try the normal file picker.
4. On desktop, try drag-and-drop.
5. Use the “Run Browser Diagnostics” button near the top of the page.

Diagnostics report core UI status, PDF.js, JSZip, pdf-lib, Tesseract.js, file-input count, upload-zone count and browser capabilities.

The application uses a direct user-gesture file-picker path with showPicker() when available and falls back to the normal file-input click. File pickers require user activation.

If a library is missing, the browser may be blocked from loading a CDN resource. Use the local launcher and prepare_offline.py.

## 10. Mobile use

For Android/iPhone:
- Tap the upload area rather than trying to drag files.
- Select Files, Photos or the appropriate system picker.
- Wait for the selected filename/control panel.
- Browser-capable tools work on mobile without Python.
- Native FFmpeg/LibreOffice/Calibre/qpdf/Poppler/ImageMagick jobs require the Local Engine on a Windows/macOS/Linux computer; a phone cannot launch that desktop engine by itself.

The browser receives a File object supplied by the user's selection; it does not receive the device's private filesystem path.

## 11. Large-file guidance

Browser processing can become memory-intensive because large binaries may need to be decoded, rendered or held in browser memory.

Prefer Local Engine for very large PDFs, large image batches, long audio, long/high-resolution video and large ZIP archives.

The Local Engine streams uploads/downloads and uses temporary processing files outside the website directory.

## 12. Security model

The public Render Cloud Engine is authenticated with the `OMNI_CLOUD_TOKEN` environment secret. The browser Cloud bridge keeps the operator-supplied token in `sessionStorage` only and sends it as `X-Omni-Cloud-Token`; never commit the token or hard-code it into the public site.

The Social Media resolver may use `https://r.jina.ai/` to retrieve public-page representations. The exact public URL being resolved may therefore be disclosed to that third-party service.

The local code runner can execute arbitrary code in the host user environment. Keep the Local Engine loopback-only and never expose the code-execution operation to a network interface.

The Local Engine binds to 127.0.0.1, exposes predefined operations rather than arbitrary shell commands, stores temporary files in the operating-system temporary directory and cleans stale temporary data.

Do not change the server binding to 0.0.0.0 unless you understand the security consequences.

## 13. Local Engine operations

The predefined local operations include:
- media
- pdf_merge
- pdf_split
- pdf_compress
- pdf_render
- pdf_to_text
- image
- ocr
- office_convert
- ebook_convert
- archive
- data_convert
- data_profile
- sql_transpile
- schema_generate
- nosql_convert
- zip
- gzip

The UI is the primary interface; users should not need to construct API requests manually.

## 14. Repository files

| File | Purpose |
|---|---|
| index.html | Main browser/local application |
| omni_local_server.py | Local HTTP/API/native processing engine |
| prepare_offline.py | Downloads pinned browser/WASM/OCR resources |
| setup_and_start.bat | Windows one-click setup + launch |
| setup_and_start.command | macOS/Linux one-click setup + launch |
| install_windows.ps1 | Windows native dependency installer |
| install_system_tools.command | macOS/Linux native dependency installer |
| start_omni.bat / start_omni.command | Local launchers |
| LOCAL_ENGINE.md | Detailed native/offline architecture |
| THIRD_PARTY_NOTICES.md | Third-party dependency/licensing notes |
| requirements-data.txt | Optional Data Studio Python stack |
| omni_data_engine.py | Structured/semi-structured data and SQL/NoSQL conversion engine |
| .github/workflows/local-engine-check.yml | Static/Python/native validation workflow |

## 15. Troubleshooting checklist

### Upload area does not open
- Hard refresh.
- Try Chrome/Edge/Safari.
- Tap/click directly on the upload area.
- Run Browser Diagnostics.
- Check whether the device/browser blocks file-picker interaction.

### File selected but conversion does not start
- Confirm the filename/control panel appeared.
- Confirm an action button is enabled.
- Try a smaller/standard-format test file.
- Run Browser Diagnostics.
- If the operation is native, start Local Engine.

### Local Engine says disconnected
Windows: start_omni.bat or setup_and_start.bat.
macOS/Linux: bash start_omni.command or bash setup_and_start.command.

Then check:

    http://127.0.0.1:8765/api/health

### Native tool missing
Restart the installer and verify that the package manager installed the utility. The Local Engine can run with a partial tool set, but operations requiring a missing executable will fail clearly.

### Offline browser resources missing
Run:

    python prepare_offline.py

or:

    python3 prepare_offline.py

Then restart the local server.

### GitHub Pages works but local features do not
This is expected until the local Python engine is running. GitHub Pages is a browser environment and cannot launch FFmpeg, LibreOffice, Calibre, qpdf or other programs installed on your computer.

## 15. Development / validation

The repository includes GitHub Actions checks for Python syntax, required setup files and native smoke tests on Windows, macOS and Ubuntu. The native matrix now exercises representative SVG/GIF image, audio, MPEG-4/MKV video, Office and ebook paths; it does not replace testing every OS release or every optional codec/delegate.

For real machine validation, test at least:
1. Local Engine health.
2. Native format capability inventory.
3. Image upload.
4. Image resize.
5. Image → PDF.
6. PDF → image.
7. OCR.
8. ZIP compression/extraction.
9. TAR/GZIP/BZIP2/XZ native archive compression.
10. FFmpeg audio conversion.
11. SVG → PNG and PNG → GIF.
12. MPEG-4 → MKV/GIF.
13. qpdf PDF operation.
14. LibreOffice Word/Excel/PowerPoint-family conversion.
15. Calibre ebook conversion.
16. 7z compression when 7-Zip is installed.

## Design principle
OmniConverter should remain useful before the user installs anything.

The browser experience is therefore the first layer, and conversion dispatch is explicitly browser-first.

For common structured/semi-structured data, OmniConverter now performs CSV/TSV/JSON/JSONL/YAML/XML/HTML/Markdown and common Excel/ODS-family conversions in the browser when the required browser engine is available. Data profiling and several document/NoSQL bridge operations also prefer browser execution.

Office Studio similarly prefers browser execution for common spreadsheet conversions, PDF → PPTX page-replica generation, and safe PPTX/PPSX/POTX package-type changes. Heavy native conversions such as high-fidelity Office rendering, PPT/PDF round-trips, legacy binary formats outside browser support, HDF5/Parquet/ORC/Avro database files, and other operations that browsers cannot reliably preserve fall back to the Local Engine.

The Local Engine is the second layer for capabilities that browsers cannot reliably provide. It should therefore be a fallback, not the default path. Browser conversion failures are caught and routed to the native engine only when appropriate.

The offline setup also vendors the browser conversion engines when prepare_offline.py is run; the public GitHub Pages build uses the same local-first assets with CDN fallback when the vendor assets are not present.

### References
- MDN File API — browser file access and File objects.
- MDN Using files from web applications — file inputs and drag/drop.
- MDN showPicker() — user-gesture file picker behavior.
- MDN User Activation — protected APIs require user activation.

## License

OmniConverter Studio source code is released under the MIT License. Third-party dependencies retain their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
