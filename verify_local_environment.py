#!/usr/bin/env python3
"""Strict local-environment verification for OmniConverter one-click setup."""
from __future__ import annotations
import importlib.util
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

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

NATIVE_GROUPS = {
    "FFmpeg": ("ffmpeg",),
    "FFprobe": ("ffprobe",),
    "qpdf": ("qpdf",),
    "Poppler pdftoppm": ("pdftoppm",),
    "Poppler pdftotext": ("pdftotext",),
    "ImageMagick": ("magick", "convert"),
    "Ghostscript": ("gs", "gswin64c"),
    "Tesseract": ("tesseract",),
    "LibreOffice": ("soffice", "libreoffice"),
    "Calibre": ("ebook-convert",),
    "Pandoc": ("pandoc",),
    "7-Zip": ("7zz", "7z"),
}

OFFLINE_ASSETS = (
    "vendor/pdfjs/pdf.min.js",
    "vendor/pdfjs/pdf.worker.min.js",
    "vendor/jszip/jszip.min.js",
    "vendor/pdf-lib/pdf-lib.min.js",
    "vendor/tesseract/tesseract.min.js",
    "vendor/tesseract/worker.min.js",
    "vendor/sheetjs/xlsx.full.min.js",
    "vendor/jsyaml/js-yaml.min.js",
    "vendor/OFFLINE_ASSETS.txt",
)

def check_python() -> dict[str, bool]:
    return {label: importlib.util.find_spec(module) is not None for label, module in PYTHON_IMPORTS.items()}

def check_native() -> dict[str, str | None]:
    result = {}
    for label, candidates in NATIVE_GROUPS.items():
        result[label] = next((shutil.which(c) for c in candidates if shutil.which(c)), None)
    return result

def check_offline_assets() -> dict[str, bool]:
    return {rel: (ROOT / rel).is_file() and (ROOT / rel).stat().st_size > 0 for rel in OFFLINE_ASSETS}

def pip_check() -> tuple[bool, str]:
    p = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, text=True)
    return p.returncode == 0, (p.stdout + p.stderr).strip()

def check_python_runtime() -> tuple[bool, str]:
    major, minor = sys.version_info[:2]
    supported = (major == 3 and 11 <= minor <= 13)
    return supported, f"{major}.{minor}"

def main() -> int:
    print("=== OmniConverter Local Environment Verification ===")
    print(f"Python: {sys.executable}")
    runtime_ok, runtime_version = check_python_runtime()
    print(f"Python runtime: {runtime_version} ({\"PASS\" if runtime_ok else \"UNSUPPORTED\"})")
    py = check_python()
    native = check_native()
    assets = check_offline_assets()
    pip_ok, pip_msg = pip_check()

    missing_py = [x for x, ok in py.items() if not ok]
    missing_native = [x for x, path in native.items() if not path]
    missing_assets = [x for x, ok in assets.items() if not ok]

    print(f"Python packages: {len(py)-len(missing_py)}/{len(py)} ready")
    print(f"Native tools:    {len(native)-len(missing_native)}/{len(native)} ready")
    print(f"Offline assets:   {len(assets)-len(missing_assets)}/{len(assets)} ready")
    print(f"pip check:        {'PASS' if pip_ok else 'FAIL'}")

    if missing_py:
        print("Missing Python packages:", ", ".join(missing_py))
    if missing_native:
        print("Missing native tools:", ", ".join(missing_native))
    if missing_assets:
        print("Missing offline assets:", ", ".join(missing_assets))
    if pip_msg:
        print("pip check details:", pip_msg)

    if (not runtime_ok) or missing_py or missing_native or missing_assets or not pip_ok:
        print("RESULT: FAIL")
        return 1

    print("RESULT: PASS — complete local dependency profile is ready.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
