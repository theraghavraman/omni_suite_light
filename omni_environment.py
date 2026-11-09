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

# These clients/utilities are reported by Doctor and health but are not guaranteed
# by every supported OS installer (for example, psql/mysql/isql on Windows).
OPTIONAL_NATIVE_GROUPS = frozenset({
    "ZIP", "Unzip", "gzip", "bzip2", "xz", "tar",
    "SQLite", "PostgreSQL client", "MySQL client", "unixODBC",
})

# EasyOCR is supported by the opt-in vision profile, not required by core setup.
OPTIONAL_PYTHON_IMPORTS = frozenset({"easyocr"})
NATIVE_TOOL_NAMES = tuple(NATIVE_TOOLS)

OFFLINE_ASSET_URLS = {
    "pdfjs/build/pdf.mjs": "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.mjs",
    "pdfjs/build/pdf.worker.mjs": "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.2.108/build/pdf.worker.mjs",
    "jszip/jszip.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "pdf-lib/pdf-lib.min.js": "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
    "tesseract/tesseract.min.js": "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    "sheetjs/xlsx.full.min.js": "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
    "jsyaml/js-yaml.min.js": "https://cdn.jsdelivr.net/npm/js-yaml@4.1.1/dist/js-yaml.min.js",
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
    # File Sharing QR scanner fallback for browsers without BarcodeDetector (Windows/Linux Chrome, Firefox, Safari)
    "jsqr/jsQR.js": "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js",
    "sqljs/sql-wasm.js": "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/sql-wasm.js",
    "sqljs/sql-wasm.wasm": "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.14.2/sql-wasm.wasm",
    "typescript/typescript.min.js": "https://cdnjs.cloudflare.com/ajax/libs/typescript/5.9.2/typescript.min.js",
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

NATIVE_PROBE_ARGS = {
    "ffmpeg": ("-version",),
    "ffprobe": ("-version",),
    "yt-dlp": ("--version",),
    "qpdf": ("--version",),
    "pdftoppm": ("-v",),
    "pdftotext": ("-v",),
    # Encode a real PNG: "-version" succeeds even when coder modules cannot be loaded.
    "magick": ("-size", "2x2", "xc:red", "png:-"),
    "convert": ("-size", "2x2", "xc:red", "png:-"),
    "rsvg-convert": ("--version",),
    "gs": ("--version",),
    "gswin64c": ("--version",),
    "tesseract": ("--version",),
    "soffice": ("--version",),
    "libreoffice": ("--version",),
    "ebook-convert": ("--version",),
    "pandoc": ("--version",),
    "7z": ("i",),
    "7zz": ("i",),
    "zip": ("-v",),
    "unzip": ("-v",),
    "gzip": ("--version",),
    "bzip2": ("--help",),
    "xz": ("--version",),
    "tar": ("--version",),
    "sqlite3": ("--version",),
    "psql": ("--version",),
    "mysql": ("--version",),
    "isql": ("--version",),
}

REQUIRED_NATIVE_GROUPS = tuple(label for label in NATIVE_GROUPS if label not in OPTIONAL_NATIVE_GROUPS)
TOOLS_MANIFEST_NAME = "TOOLS_MANIFEST.json"

_PLAT_MAP = {"Darwin": "darwin", "Windows": "win32", "Linux": "linux"}
_ARCH_MAP = {"x86_64": "x64", "AMD64": "x64", "amd64": "x64", "arm64": "arm64", "aarch64": "arm64", "ARM64": "arm64"}


def platform_key() -> str:
    """Electron-style <platform>-<arch> key, e.g. darwin-arm64 or win32-x64."""
    import platform

    plat = _PLAT_MAP.get(platform.system(), platform.system().lower())
    arch = _ARCH_MAP.get(platform.machine(), platform.machine().lower())
    return f"{plat}-{arch}"


def strict_bundle_resolution() -> bool:
    """True in the packaged desktop app: required tools must come from the bundle.

    Package-manager installs (Homebrew, apt, Chocolatey, Program Files) must not
    make a broken bundle look ready, so they are ignored in this mode.
    """
    import os

    return os.environ.get("OMNI_TOOL_RESOLUTION", "").strip().lower() == "bundled"


def _bundled_tool_roots() -> list:
    import os
    from pathlib import Path

    roots = []
    env_root = os.environ.get("OMNI_NATIVE_TOOLS_ROOT", "").strip()
    if env_root:
        roots.append(Path(env_root))
    here = Path(__file__).resolve().parent
    key = platform_key()
    # Packaged layout: <resources>/omni-engine/omni_environment.py + <resources>/native-tools/<key>
    roots.append(here.parent / "native-tools" / key)
    # Repository layout: build/native-tools/<key> staged by scripts/stage_desktop_bundle.py
    roots.append(here / "build" / "native-tools" / key)
    return roots


_MANIFEST_CACHE: dict = {}


def load_tools_manifest(root) -> dict | None:
    """Load <root>/TOOLS_MANIFEST.json (cached by mtime). Returns None when absent or invalid."""
    import json
    from pathlib import Path

    path = Path(root) / TOOLS_MANIFEST_NAME
    try:
        mtime = path.stat().st_mtime_ns
    except OSError:
        return None
    cached = _MANIFEST_CACHE.get(str(path))
    if cached and cached[0] == mtime:
        return cached[1]
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict) or not isinstance(data.get("tools"), dict):
            return None
    except (OSError, ValueError):
        return None
    _MANIFEST_CACHE[str(path)] = (mtime, data)
    return data


def bundled_tools_manifest():
    """Return (root, manifest) for the first staged/bundled native tool tree, or (None, None)."""
    for root in _bundled_tool_roots():
        manifest = load_tools_manifest(root)
        if manifest is not None:
            return root, manifest
    return None, None


def _manifest_tool_path(candidates) -> str | None:
    root, manifest = bundled_tools_manifest()
    if manifest is None:
        return None
    for candidate in candidates:
        entry = manifest["tools"].get(candidate)
        if not isinstance(entry, dict) or not entry.get("path"):
            continue
        resolved = root / entry["path"]
        try:
            if resolved.is_file():
                return str(resolved)
        except OSError:
            continue
    return None


def _system_tool_dirs() -> list:
    """OS-provided executable directories (never package-manager prefixes)."""
    import os
    from pathlib import Path

    if os.name == "nt":
        system_root = os.environ.get("SystemRoot", r"C:\Windows")
        return [Path(system_root) / "System32", Path(system_root)]
    return [Path("/usr/bin"), Path("/bin"), Path("/usr/sbin"), Path("/sbin")]


def _is_optional_tool(name: str) -> bool:
    for label, members in NATIVE_GROUPS.items():
        if name in members:
            return label in OPTIONAL_NATIVE_GROUPS
    return False


def bundled_tool_environment(root, manifest: dict, base_env: dict | None = None, sanitize_path: bool = True) -> dict:
    """Environment for running bundled tools: manifest env vars resolved against root.

    With sanitize_path, PATH holds only bundle directories plus OS system directories,
    so nothing from Homebrew/apt/Chocolatey can satisfy a lookup by accident.
    Mirrored by bundledToolEnvironment() in electron/main.cjs.
    """
    import os
    from pathlib import Path

    root = Path(root)
    env = dict(os.environ if base_env is None else base_env)
    for key, rels in (manifest.get("env") or {}).items():
        values = [rels] if isinstance(rels, str) else list(rels)
        env[key] = os.pathsep.join(str(root / rel) for rel in values)
    path_dirs = [str(root / rel) for rel in manifest.get("path_dirs") or []]
    tail = [str(d) for d in _system_tool_dirs()] if sanitize_path else [env.get("PATH", "")]
    env["PATH"] = os.pathsep.join([*path_dirs, *[t for t in tail if t]])
    env["OMNI_NATIVE_TOOLS_ROOT"] = str(root)
    env["OMNI_TOOL_RESOLUTION"] = "bundled"
    return env


_OFFLINE_CACHE: dict = {}


def offline_asset_status(ui_root) -> dict:
    """SHA-256 verification of the pinned offline browser assets under <ui_root>/vendor (cached by size/mtime)."""
    import hashlib
    import json
    from pathlib import Path

    root = Path(ui_root)
    try:
        pins = json.loads((root / "offline_assets_manifest.json").read_text("utf-8"))
    except (OSError, ValueError):
        pins = {rel: None for rel in OFFLINE_ASSET_URLS}
    verified, missing = 0, []
    for rel in OFFLINE_ASSET_URLS:
        path = root / "vendor" / rel
        try:
            st = path.stat()
        except OSError:
            missing.append(rel)
            continue
        key = (str(path), st.st_size, st.st_mtime_ns)
        if key not in _OFFLINE_CACHE:
            digest = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
            _OFFLINE_CACHE[key] = digest.hexdigest() == pins.get(rel)
        if _OFFLINE_CACHE[key]:
            verified += 1
        else:
            missing.append(rel)
    manifest_ok = (root / "vendor" / "OFFLINE_ASSETS.txt").is_file()
    if not manifest_ok:
        missing.append("OFFLINE_ASSETS.txt")
    return {"ready": not missing, "verified": verified, "total": len(OFFLINE_ASSET_URLS), "missing": missing}


_PROBE_CACHE: dict = {}


def probe_native_tool(path: str, name: str, timeout: float = 90.0, env: dict | None = None) -> tuple[bool, str | None]:
    """Execute a tool's version/info command. A tool is only "working" if this succeeds.

    Results are cached per (path, mtime, size) so /api/health stays fast.
    """
    import os
    import subprocess

    args = NATIVE_PROBE_ARGS.get(name, ("--version",))
    try:
        st = os.stat(path)
    except OSError:
        return False, None
    key = (path, st.st_mtime_ns, st.st_size, name)
    if env is None and key in _PROBE_CACHE:
        return _PROBE_CACHE[key]
    try:
        probe = subprocess.run(
            [path, *args],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            stdin=subprocess.DEVNULL,
            env=env,
        )
        output = "\n".join(part for part in (probe.stdout, probe.stderr) if part)
        first = next((line.strip() for line in output.splitlines() if line.strip()), "")
        result = (probe.returncode == 0, first[:180] or None)
    except (OSError, subprocess.SubprocessError):
        result = (False, None)
    if env is None:
        _PROBE_CACHE[key] = result
    return result


def is_bundled_path(path: str | None) -> bool:
    if not path:
        return False
    from pathlib import Path

    root, _manifest = bundled_tools_manifest()
    if root is None:
        return False
    try:
        resolved = Path(path).resolve()
        return resolved == Path(root).resolve() or Path(root).resolve() in resolved.parents
    except OSError:
        return False


def native_group_status() -> dict:
    """Per-group readiness: a group is ready only if one of its tools executes successfully."""
    groups: dict = {}
    for label, members in NATIVE_GROUPS.items():
        info = {"required": label not in OPTIONAL_NATIVE_GROUPS, "ready": False, "tool": None,
                "path": None, "version": None, "bundled": False}
        for member in members:
            path = find_native_tool_path(member)
            if not path:
                continue
            ok, version = probe_native_tool(path, member)
            info.update({"tool": member, "path": path, "version": version, "ready": ok, "bundled": is_bundled_path(path)})
            if ok:
                break
        groups[label] = info
    return groups


def find_native_tool_path(name: str) -> str | None:
    """Resolve native tool aliases consistently for Doctor, verifier, Electron bundle, and health API.

    Order: bundled TOOLS_MANIFEST.json -> (unless strict bundled mode) legacy bundled dirs,
    PATH and well-known install locations. In strict mode only OS-provided directories are
    consulted, and only for tools the inventory marks optional.
    """
    import os
    import platform
    import shutil
    from pathlib import Path

    candidates = _NATIVE_ALIASES.get(name, (name,))
    suffixes = (".exe", ".cmd", ".bat", "") if os.name == "nt" else ("",)
    repo_root = Path(__file__).resolve().parent

    # 0. Self-describing bundle manifest (packaged desktop app or staged build/).
    manifest_path = _manifest_tool_path(candidates)
    if manifest_path:
        return manifest_path

    if strict_bundle_resolution():
        if not _is_optional_tool(name):
            return None
        for search_dir in _system_tool_dirs():
            for candidate in candidates:
                for suffix in (".exe", "") if os.name == "nt" else ("",):
                    local_path = search_dir / f"{candidate}{suffix}"
                    try:
                        if local_path.is_file() and os.access(local_path, os.X_OK):
                            return str(local_path)
                    except OSError:
                        continue
        return None

    # 1. Check explicit bundled tool directories (OMNI_BUNDLED_TOOLS_DIR) and the repo venv
    plat_key = platform_key()

    bundled_dirs: list[Path] = []
    env_bundled = os.environ.get("OMNI_BUNDLED_TOOLS_DIR", "").strip()
    if env_bundled:
        for raw_dir in env_bundled.split(os.pathsep):
            if raw_dir.strip():
                bundled_dirs.append(Path(raw_dir.strip()))
    bundled_dirs.extend([
        repo_root / "build" / "python-runtime" / ("Scripts" if os.name == "nt" else "bin"),
        repo_root / ".venv" / ("Scripts" if os.name == "nt" else "bin"),
    ])
    del plat_key

    for search_dir in bundled_dirs:
        try:
            if not search_dir.is_dir():
                continue
        except OSError:
            continue
        for candidate in candidates:
            for suffix in suffixes:
                local_path = search_dir / f"{candidate}{suffix}"
                try:
                    if local_path.is_file():
                        if candidate == "convert" and not _is_imagemagick_convert(str(local_path)):
                            continue
                        return str(local_path)
                except OSError:
                    continue

    # 2. Check interactive/process PATH via shutil.which
    for candidate in candidates:
        path = shutil.which(candidate)
        if not path:
            continue
        if candidate == "convert" and not _is_imagemagick_convert(path):
            continue
        return path

    # 3. Platform-specific GUI fallback directories (Finder/Explorer launches do not inherit shell PATH)
    if platform.system() == "Darwin":
        mac_dirs = [
            Path("/opt/homebrew/bin"),
            Path("/usr/local/bin"),
            Path("/Applications/LibreOffice.app/Contents/MacOS"),
            Path("/Applications/calibre.app/Contents/MacOS"),
        ]
        for mac_dir in mac_dirs:
            for candidate in candidates:
                candidate_path = mac_dir / candidate
                try:
                    if candidate_path.is_file():
                        if candidate == "convert" and not _is_imagemagick_convert(str(candidate_path)):
                            continue
                        return str(candidate_path)
                except OSError:
                    continue

    # 4. Windows fallback for common Poppler and desktop native tool locations
    if os.name == "nt":
        program_files = os.environ.get("PROGRAMFILES", r"C:\Program Files")
        local_app_text = os.environ.get("LOCALAPPDATA", "")
        win_candidates: list[Path] = []
        if name in {"pdftoppm", "pdftotext"}:
            win_candidates.extend([
                Path(program_files) / "poppler" / "Library" / "bin" / f"{name}.exe",
                Path(program_files) / "poppler" / "bin" / f"{name}.exe",
                Path(local_app_text) / "poppler" / "Library" / "bin" / f"{name}.exe",
                Path(r"C:\msys64\mingw64\bin") / f"{name}.exe",
                Path(r"C:\ProgramData\chocolatey\bin") / f"{name}.exe",
            ])
            local_app = Path(local_app_text)
            if local_app.exists():
                win_candidates.extend(local_app.glob("Microsoft/WinGet/Packages/oschwartz10612.Poppler_*/**/Library/bin/" + f"{name}.exe"))
                win_candidates.extend(local_app.glob("Microsoft/WinGet/Packages/oschwartz10612.Poppler_*/**/bin/" + f"{name}.exe"))
        elif name in {"soffice", "libreoffice"}:
            win_candidates.append(Path(program_files) / "LibreOffice" / "program" / "soffice.exe")
        elif name == "ebook-convert":
            win_candidates.append(Path(program_files) / "Calibre2" / "ebook-convert.exe")
        elif name == "tesseract":
            win_candidates.append(Path(program_files) / "Tesseract-OCR" / "tesseract.exe")
        elif name in {"7z", "7zz"}:
            win_candidates.append(Path(program_files) / "7-Zip" / "7z.exe")
        for candidate_path in win_candidates:
            try:
                if candidate_path.is_file():
                    return str(candidate_path)
            except OSError:
                pass

    return None

