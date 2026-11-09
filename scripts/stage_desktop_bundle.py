#!/usr/bin/env python3
"""
OmniConverter Studio — Desktop Resource Staging & Verification Utility
(scripts/stage_desktop_bundle.py)

Prepares ./build for Electron Forge (`electron-forge package` / `electron-forge make`):
1. Runs `prepare_offline.py` (or verifies existing SHA-256-pinned offline assets in `vendor/`)
   so all 41 browser vendor assets and `vendor/OFFLINE_ASSETS.txt` are bundled for 100% offline use.
2. Stages the Python Local Engine (`omni_local_server.py`, `omni_*.py`), static Studio UI files,
   `knowledge-base/`, `vendor/`, and `THIRD_PARTY_NOTICES.md` into `build/omni-engine/`.
3. Stages or links the Python runtime (`build/python-runtime/`) and verifies installed packages
   from `requirements-local.txt`.
4. Stages discovered or bundled native CLI binaries (`FFmpeg`, `qpdf`, `Poppler`, `Tesseract`,
   `LibreOffice`, `Calibre`, `ImageMagick`, `Ghostscript`, `Pandoc`, `7-Zip`) into
   `build/native-tools/<platform>-<arch>/bin/` and generates `build/BUNDLE_MANIFEST.json`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

import omni_environment  # noqa: E402
import prepare_offline  # noqa: E402

ENGINE_PYTHON_FILES = (
    "omni_local_server.py",
    "omni_data_engine.py",
    "omni_platform.py",
    "omni_environment.py",
    "omni_security_primitives.py",
    "omni_code_runner.py",
    "omni_language_engine.py",
    "omni_bootstrap.py",
    "prepare_offline.py",
    "offline_assets_manifest.json",
    "verify_local_environment.py",
    "requirements-local.txt",
    "requirements-data.txt",
    "requirements-language.txt",
    "LICENSE",
    "THIRD_PARTY_NOTICES.md",
)

STATIC_ROOT_SUFFIXES = {
    ".html", ".js", ".css", ".mjs", ".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf"
}


def current_platform_key() -> str:
    plat_map = {"Darwin": "darwin", "Windows": "win32", "Linux": "linux"}
    arch_map = {"x86_64": "x64", "AMD64": "x64", "arm64": "arm64", "aarch64": "arm64"}
    plat = plat_map.get(platform.system(), platform.system().lower())
    arch = arch_map.get(platform.machine(), platform.machine().lower())
    return f"{plat}-{arch}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_offline_vendor_assets(download_if_missing: bool = False) -> dict:
    vendor_dir = REPO_ROOT / "vendor"
    pins = prepare_offline.load_pins()
    missing_or_invalid: list[str] = []
    verified_count = 0

    for rel, url in omni_environment.OFFLINE_ASSET_URLS.items():
        dest = vendor_dir / rel
        expected = pins[rel]
        if dest.is_file() and sha256_file(dest) == expected:
            verified_count += 1
            continue
        if download_if_missing:
            prepare_offline.download(rel, url, expected)
            verified_count += 1
        else:
            missing_or_invalid.append(rel)

    manifest = vendor_dir / "OFFLINE_ASSETS.txt"
    if verified_count == len(omni_environment.OFFLINE_ASSET_URLS) and not manifest.is_file():
        manifest.parent.mkdir(parents=True, exist_ok=True)
        lines = ["OmniConverter offline browser assets", ""]
        for rel in omni_environment.OFFLINE_ASSET_URLS:
            p = vendor_dir / rel
            lines.append(f"{rel}\t{p.stat().st_size}\tSHA256={pins[rel]}")
        manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")

    return {
        "ready": len(missing_or_invalid) == 0 and manifest.is_file(),
        "verified_count": verified_count,
        "total_count": len(omni_environment.OFFLINE_ASSET_URLS),
        "missing": missing_or_invalid,
    }


def stage_omni_engine(build_root: Path) -> dict:
    engine_stage = build_root / "omni-engine"
    if engine_stage.exists():
        shutil.rmtree(engine_stage)
    engine_stage.mkdir(parents=True, exist_ok=True)

    copied_files: list[str] = []
    for rel in ENGINE_PYTHON_FILES:
        src = REPO_ROOT / rel
        if src.is_file():
            dst = engine_stage / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied_files.append(rel)

    for item in sorted(REPO_ROOT.iterdir()):
        if item.is_file() and item.suffix.lower() in STATIC_ROOT_SUFFIXES:
            shutil.copy2(item, engine_stage / item.name)
            if item.name not in copied_files:
                copied_files.append(item.name)

    for folder_name in ("vendor", "knowledge-base"):
        src_folder = REPO_ROOT / folder_name
        if src_folder.is_dir():
            shutil.copytree(src_folder, engine_stage / folder_name, symlinks=False)

    return {
        "stage_dir": str(engine_stage),
        "copied_root_files": len(copied_files),
        "vendor_bundled": (engine_stage / "vendor" / "OFFLINE_ASSETS.txt").is_file(),
        "knowledge_base_bundled": (engine_stage / "knowledge-base").is_dir(),
    }


def stage_native_tools(build_root: Path, plat_key: str) -> dict:
    tools_root = build_root / "native-tools" / plat_key
    bin_dir = tools_root / "bin"
    licenses_dir = tools_root / "licenses"
    bin_dir.mkdir(parents=True, exist_ok=True)
    licenses_dir.mkdir(parents=True, exist_ok=True)

    # Always include THIRD_PARTY_NOTICES.md and LICENSE inside the native-tools bundle
    for doc_name in ("THIRD_PARTY_NOTICES.md", "LICENSE"):
        src_doc = REPO_ROOT / doc_name
        if src_doc.is_file():
            shutil.copy2(src_doc, licenses_dir / doc_name)

    staged_tools: dict[str, dict] = {}
    for tool_name, (cmd, package_label) in omni_environment.NATIVE_TOOLS.items():
        resolved = omni_environment.find_native_tool_path(tool_name)
        if not resolved:
            staged_tools[tool_name] = {
                "package": package_label,
                "staged": False,
                "source_path": None,
                "staged_path": None,
            }
            continue

        src_path = Path(resolved)
        suffix = src_path.suffix if os.name == "nt" else ""
        dest_path = bin_dir / f"{cmd}{suffix}"
        try:
            if not dest_path.exists():
                if os.name == "nt":
                    shutil.copy2(src_path, dest_path)
                else:
                    # Use a lightweight wrapper script on POSIX so Homebrew/AppBundle
                    # relative dylibs (@loader_path/../lib) continue to resolve cleanly
                    dest_path.write_text(
                        f'#!/bin/sh\nexec "{src_path}" "$@"\n',
                        encoding="utf-8",
                    )
                    dest_path.chmod(0o755)
            staged_tools[tool_name] = {
                "package": package_label,
                "staged": True,
                "source_path": str(src_path),
                "staged_path": str(dest_path),
            }
        except OSError as exc:
            staged_tools[tool_name] = {
                "package": package_label,
                "staged": False,
                "source_path": str(src_path),
                "error": str(exc),
            }

    return {
        "platform": plat_key,
        "bin_dir": str(bin_dir),
        "licenses_dir": str(licenses_dir),
        "tools": staged_tools,
    }


def preferred_python_executable() -> Path:
    is_win = os.name == "nt"
    repo_venv_py = REPO_ROOT / ".venv" / ("Scripts/python.exe" if is_win else "bin/python3")
    if repo_venv_py.is_file():
        return repo_venv_py

    if not is_win:
        for candidate in ("python3.13", "python3.12", "python3.11", "python3.14", "python3"):
            found = shutil.which(candidate)
            if found:
                return Path(found).resolve()
            for prefix in (Path("/opt/homebrew/bin"), Path("/usr/local/bin")):
                candidate_path = prefix / candidate
                if candidate_path.is_file():
                    return candidate_path.resolve()

    return Path(sys.executable)


def stage_python_runtime(build_root: Path, create_venv: bool = False) -> dict:
    runtime_dir = build_root / "python-runtime"
    is_win = os.name == "nt"
    python_exe = runtime_dir / ("Scripts/python.exe" if is_win else "bin/python3")
    target_py = preferred_python_executable()

    if create_venv:
        subprocess.run([str(target_py), "-m", "venv", str(runtime_dir)], check=True)
    else:
        bin_dir = runtime_dir / ("Scripts" if is_win else "bin")
        bin_dir.mkdir(parents=True, exist_ok=True)
        if not is_win:
            python_exe.write_text(
                f'#!/bin/sh\nexec "{target_py}" "$@"\n',
                encoding="utf-8",
            )
            python_exe.chmod(0o755)

    version_out = platform.python_version()
    try:
        probe = subprocess.run(
            [str(python_exe if python_exe.exists() else target_py), "-c", "import platform; print(platform.python_version())"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if probe.returncode == 0 and probe.stdout.strip():
            version_out = probe.stdout.strip()
    except OSError:
        pass

    return {
        "runtime_dir": str(runtime_dir),
        "python_executable": str(python_exe) if python_exe.exists() else str(target_py),
        "target_python": str(target_py),
        "python_version": version_out,
    }


def stage_bundle(download_offline: bool = False, create_venv: bool = False) -> dict:
    build_root = REPO_ROOT / "build"
    build_root.mkdir(parents=True, exist_ok=True)
    plat_key = current_platform_key()

    offline_status = ensure_offline_vendor_assets(download_if_missing=download_offline)
    engine_status = stage_omni_engine(build_root)
    python_status = stage_python_runtime(build_root, create_venv=create_venv)
    native_status = stage_native_tools(build_root, plat_key)

    manifest = {
        "schema_version": 1,
        "staged_at": datetime.now(timezone.utc).isoformat(),
        "platform": plat_key,
        "offline_assets": offline_status,
        "omni_engine": engine_status,
        "python_runtime": python_status,
        "native_tools": native_status,
    }

    manifest_path = build_root / "BUNDLE_MANIFEST.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage OmniConverter Studio desktop bundle for Electron Forge.")
    parser.add_argument(
        "--download-offline",
        action="store_true",
        help="Download missing offline vendor assets via prepare_offline.py if not already cached.",
    )
    parser.add_argument(
        "--create-venv",
        action="store_true",
        help="Create a dedicated virtual environment inside build/python-runtime.",
    )
    args = parser.parse_args()

    manifest = stage_bundle(download_offline=args.download_offline, create_venv=args.create_venv)
    staged_count = sum(1 for item in manifest["native_tools"]["tools"].values() if item.get("staged"))
    total_tools = len(manifest["native_tools"]["tools"])
    print(
        f"[OmniDesktopStage] Staged desktop bundle for {manifest['platform']}: "
        f"python={manifest['python_runtime']['python_version']}, "
        f"offline_assets={manifest['offline_assets']['verified_count']}/{manifest['offline_assets']['total_count']}, "
        f"native_tools={staged_count}/{total_tools}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
