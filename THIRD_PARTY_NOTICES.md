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
