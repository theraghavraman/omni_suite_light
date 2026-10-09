"""Shared environment inventories and executable resolution for the Local Engine.

Keep dependency, native-tool, and offline-asset checks here so the installer,
Doctor, bootstrap and health API report a consistent environment.
"""
from __future__ import annotations

PYTHON_IMPORTS = {
    "pandas": "pandas",
    "numpy": "numpy",
    "pyarrow": "pyarrow",
    "duckdb": "duckdb",
    "yaml": "yaml",
    "sqlglot": "sqlglot",
    "openpyxl": "openpyxl",
    "xlrd": "xlrd",
    "pyxlsb": "pyxlsb",
    "odfpy": "odf",
    "tables": "tables",
    "lxml": "lxml",
    "fastavro": "fastavro",
    "pymongo": "pymongo",
    "msgpack": "msgpack",
    "tabulate": "tabulate",
    "pyreadstat": "pyreadstat",
    "xarray": "xarray",
    "cftime": "cftime",
    "netCDF4": "netCDF4",
    "h5py": "h5py",
    "h5netcdf": "h5netcdf",
    "astropy": "astropy",
    "cdflib": "cdflib",
    "cfgrib": "cfgrib",
    "eccodes": "eccodes",
    "Pillow": "PIL",
    "fastparquet": "fastparquet",
    "polars": "polars",
    "scipy": "scipy",
    "sympy": "sympy",
    "sqlalchemy": "sqlalchemy",
    "psycopg": "psycopg",
    "mysql_connector": "mysql.connector",
    "oracledb": "oracledb",
    "pyodbc": "pyodbc",
    "py7zr": "py7zr",
    "rarfile": "rarfile",
    "imageio": "imageio",
    "pydub": "pydub",
    "moviepy": "moviepy",
    "easyocr": "easyocr",
    "duckdb_engine": "duckdb_engine",
    "snowflake_sqlalchemy": "snowflake.sqlalchemy",
    "google_cloud_bigquery": "google.cloud.bigquery",
    "databricks_sql_connector": "databricks.sql",
    "trino": "trino",
    "clickhouse_sqlalchemy": "clickhouse_sqlalchemy",
    "sqlalchemy_redshift": "sqlalchemy_redshift",
    "cassandra_driver": "cassandra",
    "redis": "redis",
    "neo4j": "neo4j",
    "boto3": "boto3",
    "fsspec": "fsspec",
    "s3fs": "s3fs",
    "gcsfs": "gcsfs",
}

NATIVE_TOOLS = {
    "ffmpeg": ("ffmpeg", "FFmpeg"),
    "ffprobe": ("ffprobe", "FFmpeg"),
    "yt-dlp": ("yt-dlp", "yt-dlp"),
    "qpdf": ("qpdf", "qpdf"),
    "pdftoppm": ("pdftoppm", "poppler"),
    "pdftotext": ("pdftotext", "poppler"),
    "magick": ("magick", "ImageMagick"),
    "convert": ("convert", "ImageMagick"),
    "rsvg-convert": ("rsvg-convert", "librsvg"),
    "gs": ("gs", "Ghostscript"),
    "gswin64c": ("gswin64c", "Ghostscript"),
    "tesseract": ("tesseract", "Tesseract"),
    "soffice": ("soffice", "LibreOffice"),
    "libreoffice": ("libreoffice", "LibreOffice"),
    "ebook-convert": ("ebook-convert", "Calibre"),
    "pandoc": ("pandoc", "Pandoc"),
    "7z": ("7z", "7-Zip"),
    "7zz": ("7zz", "7-Zip"),
    "zip": ("zip", "Info-ZIP"),
    "unzip": ("unzip", "Info-ZIP"),
    "gzip": ("gzip", "gzip"),
    "bzip2": ("bzip2", "bzip2"),
    "xz": ("xz", "xz"),
    "tar": ("tar", "tar"),
    "sqlite3": ("sqlite3", "SQLite"),
    "psql": ("psql", "PostgreSQL client"),
    "mysql": ("mysql", "MySQL client"),
    "isql": ("isql", "unixODBC"),
}

NATIVE_GROUPS = {
    "FFmpeg": ("ffmpeg",),
    "FFprobe": ("ffprobe",),
    "yt-dlp": ("yt-dlp",),
    "qpdf": ("qpdf",),
    "Poppler pdftoppm": ("pdftoppm",),
    "Poppler pdftotext": ("pdftotext",),
    "ImageMagick": ("magick", "convert"),
    "rsvg-convert": ("rsvg-convert",),
    "Ghostscript": ("gs", "gswin64c"),
    "Tesseract": ("tesseract",),
    "LibreOffice": ("soffice", "libreoffice"),
    "Calibre": ("ebook-convert",),
    "Pandoc": ("pandoc",),
    "7-Zip": ("7zz", "7z"),
    "ZIP": ("zip",),
    "Unzip": ("unzip",),
    "gzip": ("gzip",),
    "bzip2": ("bzip2",),
    "xz": ("xz",),
    "tar": ("tar",),
    "SQLite": ("sqlite3",),
    "PostgreSQL client": ("psql",),
    "MySQL client": ("mysql",),
    "unixODBC": ("isql",),
}

# EasyOCR is supported by the opt-in vision profile, not required by core setup.
OPTIONAL_PYTHON_IMPORTS = frozenset({"easyocr"})
NATIVE_TOOL_NAMES = tuple(NATIVE_TOOLS)

OFFLINE_ASSET_URLS = {
    "pdfjs/pdf.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "pdfjs/pdf.worker.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    "jszip/jszip.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "pdf-lib/pdf-lib.min.js": "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
    "tesseract/tesseract.min.js": "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    "sheetjs/xlsx.full.min.js": "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
    "jsyaml/js-yaml.min.js": "https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.min.js",
    # Office Tools + Diagram Forge (loaded on demand by omni_vendor_loader.js)
    "mammoth/mammoth.browser.min.js": "https://cdn.jsdelivr.net/npm/mammoth@1.13.0/mammoth.browser.min.js",
    "docx/docx.iife.js": "https://cdn.jsdelivr.net/npm/docx@9.9.0/dist/index.iife.js",
    "pptxgenjs/pptxgen.bundle.js": "https://cdn.jsdelivr.net/npm/pptxgenjs@4.0.1/dist/pptxgen.bundle.js",
    "exceljs/exceljs.min.js": "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
    "formula/parser.min.js": "https://cdn.jsdelivr.net/npm/fast-formula-parser@1.0.19/build/parser.min.js",
    "formula/formula.min.js": "https://cdn.jsdelivr.net/npm/@formulajs/formulajs@4.6.1/lib/browser/formula.min.js",
    "dompurify/purify.min.js": "https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js",
    "mermaid/mermaid.min.js": "https://cdn.jsdelivr.net/npm/mermaid@12.1.0/dist/mermaid.min.js",
    "dagre/dagre.min.js": "https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js",
    "tesseract/worker.min.js": "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
    "tesseract/core/tesseract-core.wasm.js": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm.js",
    "tesseract/core/tesseract-core.wasm": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core.wasm",
    "tesseract/core/tesseract-core-simd.wasm.js": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm.js",
    "tesseract/core/tesseract-core-simd.wasm": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd.wasm",
    "tesseract/core/tesseract-core-lstm.wasm.js": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm.js",
    "tesseract/core/tesseract-core-lstm.wasm": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-lstm.wasm",
    "tesseract/core/tesseract-core-simd-lstm.wasm.js": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js",
    "tesseract/core/tesseract-core-simd-lstm.wasm": "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm",
    "tesseract/lang/eng.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz",
    "tesseract/lang/hin.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/hin@1.0.0/4.0.0_best_int/hin.traineddata.gz",
    "tesseract/lang/ben.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/ben@1.0.0/4.0.0_best_int/ben.traineddata.gz",
    "tesseract/lang/mar.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/mar@1.0.0/4.0.0_best_int/mar.traineddata.gz",
    "tesseract/lang/tam.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/tam@1.0.0/4.0.0_best_int/tam.traineddata.gz",
    "tesseract/lang/tel.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/tel@1.0.0/4.0.0_best_int/tel.traineddata.gz",
    "tesseract/lang/guj.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/guj@1.0.0/4.0.0_best_int/guj.traineddata.gz",
    "tesseract/lang/pan.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/pan@1.0.0/4.0.0_best_int/pan.traineddata.gz",
    "tesseract/lang/deu.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/deu@1.0.0/4.0.0_best_int/deu.traineddata.gz",
    "tesseract/lang/fra.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/fra@1.0.0/4.0.0_best_int/fra.traineddata.gz",
    "tesseract/lang/spa.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/spa@1.0.0/4.0.0_best_int/spa.traineddata.gz",
    "tesseract/lang/chi_sim.traineddata.gz": "https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_sim@1.0.0/4.0.0_best_int/chi_sim.traineddata.gz",
}

# The browser's local/offline profile must validate every asset downloaded by prepare_offline.py.
OFFLINE_ASSETS = tuple(f"vendor/{rel}" for rel in OFFLINE_ASSET_URLS) + ("vendor/OFFLINE_ASSETS.txt",)

_NATIVE_ALIASES = {
    "magick": ("magick", "convert"),
    "convert": ("convert",),
    "soffice": ("soffice", "libreoffice"),
    "libreoffice": ("libreoffice", "soffice"),
    "gs": ("gs", "gswin64c"),
    "gswin64c": ("gswin64c", "gs"),
    "7z": ("7z", "7zz"),
    "7zz": ("7zz", "7z"),
}

def _is_imagemagick_convert(path: str) -> bool:
    """Distinguish ImageMagick's convert from Windows' built-in convert.exe."""
    import subprocess
    try:
        probe = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=5)
        output = (probe.stdout or "") + "\n" + (probe.stderr or "")
        return probe.returncode == 0 and "imagemagick" in output.lower()
    except (OSError, subprocess.SubprocessError):
        return False

def find_native_tool_path(name: str) -> str | None:
    """Resolve native tool aliases consistently for Doctor, verifier and health API."""
    import os
    import shutil
    candidates = _NATIVE_ALIASES.get(name, (name,))
    for candidate in candidates:
        path = shutil.which(candidate)
        if not path:
            continue
        if candidate == "convert" and not _is_imagemagick_convert(path):
            continue
        return path

    # Match the engine's Windows fallback for common Poppler package locations.
    if os.name == "nt" and name in {"pdftoppm", "pdftotext"}:
        from pathlib import Path
        program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        local_app_text = os.environ.get("LOCALAPPDATA", "")
        candidates = [
            Path(program_files) / "poppler" / "Library" / "bin" / f"{name}.exe",
            Path(program_files) / "poppler" / "bin" / f"{name}.exe",
            Path(local_app_text) / "poppler" / "Library" / "bin" / f"{name}.exe",
            Path(r"C:\msys64\mingw64\bin") / f"{name}.exe",
            Path(r"C:\ProgramData\chocolatey\bin") / f"{name}.exe",
        ]
        local_app = Path(local_app_text)
        if local_app.exists():
            candidates.extend(local_app.glob("Microsoft/WinGet/Packages/oschwartz10612.Poppler_*/**/Library/bin/" + f"{name}.exe"))
            candidates.extend(local_app.glob("Microsoft/WinGet/Packages/oschwartz10612.Poppler_*/**/bin/" + f"{name}.exe"))
        for candidate in candidates:
            try:
                if candidate.is_file():
                    return str(candidate)
            except OSError:
                pass
    return None
