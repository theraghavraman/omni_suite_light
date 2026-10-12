# Third-party notices

OmniConverter Studio does not redistribute native executable binaries. Native tools are installed separately by the user's operating system/package manager. Browser-side libraries may be downloaded into `vendor/` by `prepare_offline.py`; when those files are redistributed, retain the upstream license/copyright notices supplied with them.

## Browser-side dependencies

| Dependency | Version used | License | Role |
|---|---:|---|---|
| PDF.js | 3.11.174 | Apache License 2.0 | PDF parsing/rendering |
| JSZip | 3.10.1 | MIT OR GPL-3.0 | ZIP/archive handling |
| pdf-lib | 1.17.1 | MIT | PDF creation/manipulation |
| Tesseract.js | 5.1.1 | Apache License 2.0 | Browser OCR |
| tesseract.js-core | 5.1.1 | Apache License 2.0 | OCR WASM core |
| Tesseract.js worker | 5.1.1 | Apache License 2.0 | Browser OCR worker |
| Tesseract language data | @tesseract.js-data packages 1.0.0 | Apache License 2.0 | OCR language models |
| Outfit | Current web font | SIL Open Font License 1.1 | Application UI typography |
| mammoth.js | 1.13.0 | BSD 2-Clause | Office Tools: DOCX → HTML with formatting and images |
| docx | 9.9.0 | MIT | Office Tools: DOCX writer (runs, lists, tables, images, links) |
| ExcelJS | 4.4.0 | MIT | Office Tools: XLSX read/write with styles, formulas, column widths and merges |
| fast-formula-parser | 1.0.19 | MIT | Office Tools: spreadsheet formula parsing and evaluation |
| Formula.js (@formulajs/formulajs) | 4.6.1 | MIT | Office Tools: additional Excel-compatible functions |
| DOMPurify | 3.4.16 | Apache License 2.0 OR MPL 2.0 | Office Tools: sanitising opened and pasted HTML |
| Mermaid | 12.1.0 | MIT | Diagram Forge: text-to-diagram rendering |
| dagre (@dagrejs/dagre) | 1.1.4 | MIT | Diagram Forge: automatic graph layout |

Office Tools and Diagram Forge load these libraries on demand through `omni_vendor_loader.js` (local `vendor/` copy first, pinned CDN URL second). No GPL/AGPL editor engine is used: HyperFormula (GPL-3.0) and ONLYOFFICE (AGPL-3.0) were deliberately avoided. Diagram Forge reads and writes the open draw.io/diagrams.net mxGraph XML format with its own code; no draw.io source is included.

The exact download URLs and pinned versions are defined in `prepare_offline.py`. Outfit is loaded at runtime from Google Fonts for the public UI; its SIL Open Font License 1.1 permits use and redistribution subject to the license terms. If `vendor/` is committed, preserve the license/copyright files and headers supplied by each upstream package.

## Optional GRIB / meteorological data support

GRIB support is not installed by the default Local Engine dependency profile. Install it separately with `pip install -r requirements-grib-optional.txt` only after reviewing this section.

| Dependency | Python package license | Distribution caveat | Role |
|---|---|---|---|
| cfgrib | Apache License 2.0 | Depends on ecCodes for GRIB decoding | GRIB data access through xarray |
| eccodes / eccodeslib | Apache License 2.0 for the ECMWF Python bindings / package metadata | Some binary-wheel distributions report bundled GPL-licensed toolchain/copyleft components; review the exact wheel, included license texts, and corresponding source obligations before redistributing a container or binary bundle | GRIB/BUFR decoding |
| eckitlib | Apache License 2.0 for upstream package metadata | Some binary-wheel distributions report bundled GPL-licensed toolchain/copyleft components; review the exact wheel, included license texts, and corresponding source obligations before redistribution | ECMWF native support library |

The optional GRIB stack is intentionally excluded from the default Local Engine and container dependency set while this binary-bundle review remains separate. Do not represent the optional GRIB distribution as fully license-cleared without checking the exact platform wheels and their included notices/source obligations.

## Python runtime dependencies

The default Local Engine, cloud engine, and social resolver install Python dependencies from the requirement manifests. The CI workflow generates resolved, version-specific license inventories and CycloneDX SBOMs for each environment; retain those artifacts with any release review. The following table highlights direct dependencies and their declared license families. Confirm the exact resolved version and bundled notices in the generated inventory before redistributing an image.

| Profile | Dependency | Declared license family | Review note |
|---|---|---|---|
| Local Engine | gunicorn | MIT | |
| Local Engine | duckdb-engine | MIT | |
| Local Engine | snowflake-sqlalchemy | Apache-2.0 | |
| Local Engine | google-cloud-bigquery | Apache-2.0 | |
| Local Engine | databricks-sql-connector | Apache-2.0 | |
| Local Engine | trino | Apache-2.0 | |
| Local Engine | clickhouse-sqlalchemy | MIT | |
| Local Engine | sqlalchemy-redshift | MIT | |
| Local Engine | cassandra-driver | Apache-2.0 | |
| Local Engine | redis | MIT | |
| Local Engine | neo4j | Apache-2.0 / Python-2.0 | Composite SPDX expression in package metadata |
| Local Engine | boto3 | Apache-2.0 | |
| Local Engine | fsspec | BSD-3-Clause | |
| Local Engine | s3fs | BSD | |
| Local Engine | gcsfs | BSD-3-Clause | |
| Local Engine | pyxlsb | LGPL-3.0-or-later | Preserve LGPL notice and applicable source/relinking obligations |
| Local Engine | charset-normalizer | MIT | |
| Local Engine | certifi | MPL-2.0 | File-level copyleft terms may apply to modifications |
| Local Engine | oauthlib | BSD-3-Clause | Pinned to patched 4.x line following CI vulnerability finding |
| Local Engine | yt-dlp | Unlicense | Verify upstream notices for the resolved version |
| Data profile | pandas | BSD-3-Clause | |
| Data profile | pyarrow | Apache-2.0 | |
| Data profile | duckdb | MIT | |
| Data profile | PyYAML | MIT | |
| Data profile | sqlglot | MIT | |
| Data profile | openpyxl | MIT | |
| Data profile | xlrd | BSD-3-Clause | |
| Data profile | odfpy | Apache-2.0 / GPL / LGPL listed in package metadata | Confirm applicable upstream license and preserve notices |
| Data profile | tables (PyTables) | BSD | |
| Data profile | lxml | BSD-3-Clause | |
| Data profile | fastavro | MIT | |
| Data profile | pymongo | Apache-2.0 | |
| Data profile | msgpack | Apache-2.0 | |
| Data profile | tabulate | MIT | |
| Data profile | pyreadstat | Apache-2.0 | |
| Data profile | numpy | BSD-3-Clause plus bundled third-party license components | Preserve notices included by the wheel |
| Data profile | xarray | Apache-2.0 | |
| Data profile | cftime | MIT | |
| Data profile | netCDF4 | MIT | |
| Data profile | h5py | BSD-3-Clause | |
| Data profile | h5netcdf | BSD | |
| Data profile | astropy | BSD-3-Clause | |
| Data profile | cdflib | MIT | |
| Data profile | Pillow | MIT-CMU | Require Pillow 12.3.0 or later for the known security fixes |
| Extended profile | fastparquet | Apache-2.0 | |
| Extended profile | polars | MIT | |
| Extended profile | scipy | BSD | |
| Extended profile | sympy | BSD | |
| Extended profile | SQLAlchemy | MIT | |
| Extended profile | psycopg | LGPL-3.0-only | Preserve LGPL notice and applicable source/relinking obligations |
| Extended profile | mysql-connector-python | GPL-2.0 with Universal FOSS Exception | Review exact Oracle license text and exception applicability before redistribution |
| Extended profile | oracledb | UPL-1.0 OR Apache-2.0 | |
| Extended profile | pyodbc | MIT | |
| Extended profile | py7zr | LGPL-2.1-or-later | Preserve LGPL notice and applicable source/relinking obligations |
| Extended profile | rarfile | ISC | |
| Extended profile | imageio | BSD-2-Clause | |
| Extended profile | pydub | MIT | |
| Cloud engine | Flask | BSD-3-Clause | |
| Cloud engine | flask-cors | MIT | License verified from upstream PyPI metadata; corrected by CI audit override |
| Cloud engine | pypdf | BSD-3-Clause | |
| Cloud engine | python-multipart | Apache-2.0 | |
| Cloud engine | scikit-learn | BSD-3-Clause | |
| Social resolver | FastAPI | MIT | |
| Social resolver | Uvicorn | BSD-3-Clause | |
| Social resolver | instagrapi | MIT | |

The default Local Engine profile deliberately excludes MoviePy because its current dependency metadata requires Pillow below 12.0, which conflicts with the patched Pillow line. Omni's conversion stack uses native FFmpeg for media conversion. The optional GRIB stack is listed separately above and is not installed by default.

## Native tools installed separately

| Tool | Typical license | Used for |
|---|---|---|
| FFmpeg | LGPL or GPL depending on build/configuration | Broad audio/video transcoding, containers and animation formats |
| qpdf | Apache License 2.0 | PDF merge/split/compression |
| Poppler | GPL | PDF rendering/text extraction |
| ImageMagick | ImageMagick License | Broad raster/vector-adjacent image conversion and resizing; delegate availability varies |
| Tesseract | Apache License 2.0 | Native OCR |
| LibreOffice | MPL 2.0 | Word/Excel/PowerPoint/OpenDocument and related office-family conversion |
| Calibre | GPL | Broad ebook conversion including EPUB, MOBI, AZW, comics, DJVU and document inputs |
| pandas | BSD 3-Clause | DataFrame-based structured/semi-structured data I/O and normalization |
| PyArrow | Apache License 2.0 | Arrow/Feather/Parquet/ORC data interchange |
| DuckDB | MIT | Local analytical SQL engine and database-file interchange |
| PyYAML | MIT | YAML parsing and serialization |
| SQLGlot | MIT | SQL parsing, formatting and dialect transpilation |
| openpyxl | MIT | XLSX workbook I/O |
| xlrd | BSD 3-Clause | Legacy XLS reading |
| pyxlsb | BSD 3-Clause | XLSB reading |
| odfpy | Apache License 2.0 | OpenDocument spreadsheet I/O |
| PyTables | BSD 3-Clause | HDF5-based pandas table storage |
| fastavro | MIT | Apache Avro serialization |
| pymongo | Apache License 2.0 | MongoDB BSON representation support |
| msgpack | Apache License 2.0 | MessagePack serialization |
| SheetJS Community Edition | 0.20.3 | Apache License 2.0 | Browser-first spreadsheet parsing/writing |
| PptxGenJS | 4.0.1 | MIT | Browser-first PPTX generation and PDF-page-to-PPTX rendering |
| js-yaml | 4.1.0 | MIT | Browser-first YAML parsing/serialization |

These native programs are not bundled by this repository. If a future release bundles any native executable, revisit the applicable distribution obligations for that specific build.

This file is a practical dependency notice, not legal advice.

## Optional Omni Language Engine

The multilingual AI stack is intentionally isolated from Omni Assistant and Private RAG. It is optional and is not installed by the normal local dependency profile.

| Dependency/model | License | Role |
|---|---|---|
| AI4Bharat IndicTrans2 model checkpoints | MIT | High-quality Indic translation |
| AI4Bharat IndicXlit | MIT | Roman↔native Indic transliteration |
| PyTorch | BSD-style | Local model runtime |
| Hugging Face Transformers | Apache License 2.0 | Local translation model runtime |
| IndicTransToolkit | See upstream distribution | IndicTrans2 preprocessing/postprocessing |

Model binaries are not committed to the normal source tree. Use `prepare_language_models.py` to materialize them under `language-models/` after reviewing the upstream model terms. The language engine uses local model files at inference time and has no online translation fallback.

## Browser AI models

No model is loaded at page startup. Each model below is downloaded from its public Hugging Face repository the first time its feature is used, cached by the browser, and run on-device with Transformers.js 4.3.0 (Apache License 2.0). AI Assist text actions do not use browser models; they go through the Local Engine to Ollama or LM Studio.

| Model (repository) | License | Used by |
|---|---|---|
| all-MiniLM-L6-v2 (`Xenova/all-MiniLM-L6-v2`) | Apache License 2.0 | Private RAG and Omni Assistant embeddings |
| Gemma 3 270M IT (`onnx-community/gemma-3-270m-it-ONNX`) | Gemma Terms of Use | Private RAG and Omni Assistant answers |
| DeepSeek Coder 1.3B Instruct (`onnx-community/deepseek-coder-1.3b-instruct-ONNX`) | DeepSeek License (upstream `deepseek-ai/deepseek-coder-1.3b-instruct`) | Code and Database Studio explanations |
| Opus-MT en↔hi (`Xenova/opus-mt-en-hi`, `Xenova/opus-mt-hi-en`) | Apache License 2.0 (upstream Helsinki-NLP) | Language Studio browser mini model |
| BiRefNet lite (`onnx-community/BiRefNet_lite-ONNX`) | MIT | AI Assist: Remove background (Image Tools) |
| Depth Anything V2 Small (`onnx-community/depth-anything-v2-small`) | Apache License 2.0 | AI Assist: Depth map (Image Tools) |
| Whisper base (`onnx-community/whisper-base`) | Apache License 2.0 (upstream `openai/whisper-base`) | AI Assist: Transcribe (Audio and Video Studio) |

Verify the upstream model repository/license before redistributing model weights. Omni Suite does not commit third-party model binaries to this repository.

## File Sharing Studio

| Dependency | License | Role |
|---|---|---|
| qrcode-generator 1.4.4 by Kazuhiko Arase (`qrcode_generator.js`, bundled unmodified) | MIT | Offline QR encoder for the LAN transfer pairing code and the offline fallback of the static QR designer |
| qr-code-styling 1.9.2 (loaded from jsDelivr when online) | MIT | Styled dots, corners and logo in the static QR designer |
