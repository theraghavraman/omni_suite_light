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
| fastavro | MIT | Apache Avro serialization |
| pymongo | Apache License 2.0 | MongoDB BSON representation support |
| msgpack | Apache License 2.0 | MessagePack serialization |

These native programs are not bundled by this repository. If a future release bundles any native executable, revisit the applicable distribution obligations for that specific build.

This file is a practical dependency notice, not legal advice.
