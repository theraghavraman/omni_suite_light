#!/usr/bin/env python3
"""Strict local-environment verification for OmniConverter (one-click setup and desktop bundle).

Every check is behavioural, so a missing or broken dependency can never look ready:
* Python packages are actually imported (not just located with find_spec).
* Native tools are executed with their version/info command.
* Offline browser assets are checked against their pinned SHA-256.

`--json` prints a single machine-readable line (used by the desktop smoke test).
Exit code 0 only when every required item passes.
"""
from __future__ import annotations

import hashlib
import importlib
import json
import subprocess
import sys
import time
from pathlib import Path

from omni_environment import (
    NATIVE_GROUPS,
    OFFLINE_ASSETS,
    OPTIONAL_NATIVE_GROUPS,
    OPTIONAL_PYTHON_IMPORTS,
    PYTHON_IMPORTS,
    find_native_tool_path,
    is_bundled_path,
    probe_native_tool,
    strict_bundle_resolution,
)

ROOT = Path(__file__).resolve().parent


def check_python() -> dict[str, dict]:
    """Import every inventory module; record the error for anything that fails to load."""
    result: dict[str, dict] = {}
    for label, module in PYTHON_IMPORTS.items():
        started = time.time()
        try:
            importlib.import_module(module)
            result[label] = {"ok": True, "seconds": round(time.time() - started, 2)}
        except BaseException as exc:  # noqa: BLE001 - a broken native extension may raise anything
            result[label] = {"ok": False, "error": f"{type(exc).__name__}: {exc}"[:300]}
    return result


def check_native() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for label, candidates in NATIVE_GROUPS.items():
        entry = {"ok": False, "tool": None, "path": None, "version": None, "bundled": False}
        for candidate in candidates:
            path = find_native_tool_path(candidate)
            if not path:
                continue
            ok, version = probe_native_tool(path, candidate)
            entry.update({"ok": ok, "tool": candidate, "path": path, "version": version, "bundled": is_bundled_path(path)})
            if ok:
                break
        result[label] = entry
    return result


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_offline_assets() -> dict[str, bool]:
    """Pinned assets must match their SHA-256; OFFLINE_ASSETS.txt must exist and be non-empty."""
    try:
        pins = json.loads((ROOT / "offline_assets_manifest.json").read_text("utf-8"))
    except (OSError, ValueError):
        pins = {}
    result: dict[str, bool] = {}
    for rel in OFFLINE_ASSETS:
        path = ROOT / rel
        if not path.is_file() or path.stat().st_size == 0:
            result[rel] = False
        elif rel == "vendor/OFFLINE_ASSETS.txt":
            result[rel] = True
        else:
            pin = pins.get(rel[len("vendor/"):])
            result[rel] = pin is not None and _sha256(path) == pin
    return result


def pip_check() -> tuple[bool, str]:
    p = subprocess.run([sys.executable, "-m", "pip", "check"], capture_output=True, text=True)
    return p.returncode == 0, (p.stdout + p.stderr).strip()


def check_python_runtime() -> tuple[bool, str]:
    major, minor = sys.version_info[:2]
    supported = (major == 3 and 11 <= minor <= 15)
    return supported, f"{major}.{minor}"


def collect() -> dict:
    runtime_ok, runtime_version = check_python_runtime()
    py = check_python()
    native = check_native()
    assets = check_offline_assets()
    pip_ok, pip_msg = pip_check()

    missing_py = [x for x, r in py.items() if not r["ok"] and x not in OPTIONAL_PYTHON_IMPORTS]
    missing_optional_py = [x for x, r in py.items() if not r["ok"] and x in OPTIONAL_PYTHON_IMPORTS]
    missing_native = [x for x, r in native.items() if not r["ok"] and x not in OPTIONAL_NATIVE_GROUPS]
    missing_optional_native = [x for x, r in native.items() if not r["ok"] and x in OPTIONAL_NATIVE_GROUPS]
    missing_assets = [x for x, ok in assets.items() if not ok]
    passed = runtime_ok and not missing_py and not missing_native and not missing_assets and pip_ok
    return {
        "result": "PASS" if passed else "FAIL",
        "python_executable": sys.executable,
        "python_prefix": sys.prefix,
        "python_version": runtime_version,
        "python_runtime_supported": runtime_ok,
        "strict_bundle_resolution": strict_bundle_resolution(),
        "python": py,
        "native": native,
        "offline_assets": assets,
        "pip_check_ok": pip_ok,
        "pip_check": pip_msg[-2000:],
        "summary": {
            "python_required_ready": sum(1 for x, r in py.items() if r["ok"] and x not in OPTIONAL_PYTHON_IMPORTS),
            "python_required_total": sum(1 for x in py if x not in OPTIONAL_PYTHON_IMPORTS),
            "native_required_ready": sum(1 for x, r in native.items() if r["ok"] and x not in OPTIONAL_NATIVE_GROUPS),
            "native_required_total": sum(1 for x in native if x not in OPTIONAL_NATIVE_GROUPS),
            "offline_ready": len(assets) - len(missing_assets),
            "offline_total": len(assets),
        },
        "missing": {
            "python": missing_py,
            "python_optional": missing_optional_py,
            "native": missing_native,
            "native_optional": missing_optional_native,
            "offline_assets": missing_assets,
        },
    }


def main() -> int:
    as_json = "--json" in sys.argv[1:]
    report = collect()
    if as_json:
        print(json.dumps(report, default=str))
        return 0 if report["result"] == "PASS" else 1

    s = report["summary"]
    missing = report["missing"]
    print("=== OmniConverter Local Environment Verification ===")
    print(f"Python: {report['python_executable']}")
    print(f"Python runtime: {report['python_version']} ({'PASS' if report['python_runtime_supported'] else 'UNSUPPORTED'})")
    print(f"Python packages: {s['python_required_ready']}/{s['python_required_total']} required import cleanly")
    print(f"Optional packages: {len(OPTIONAL_PYTHON_IMPORTS) - len(missing['python_optional'])}/{len(OPTIONAL_PYTHON_IMPORTS)} ready")
    print(f"Native tools:    {s['native_required_ready']}/{s['native_required_total']} required run successfully")
    print(f"Optional native tools: {len(OPTIONAL_NATIVE_GROUPS) - len(missing['native_optional'])}/{len(OPTIONAL_NATIVE_GROUPS)} ready")
    print(f"Offline assets:   {s['offline_ready']}/{s['offline_total']} verified (SHA-256)")
    print(f"pip check:        {'PASS' if report['pip_check_ok'] else 'FAIL'}")
    if missing["python"]:
        print("Python packages that failed to import:")
        for name in missing["python"]:
            print(f"  - {name}: {report['python'][name].get('error')}")
    if missing["python_optional"]:
        print("Optional Python packages not installed (non-blocking):", ", ".join(missing["python_optional"]))
    if missing["native"]:
        print("Native tools missing or not runnable:")
        for name in missing["native"]:
            print(f"  - {name}: {report['native'][name]['path'] or 'not found'}")
    if missing["native_optional"]:
        print("Optional native tools not detected (non-blocking):", ", ".join(missing["native_optional"]))
    if missing["offline_assets"]:
        print("Missing or modified offline assets:", ", ".join(missing["offline_assets"]))
    if report["pip_check"] and not report["pip_check_ok"]:
        print("pip check details:", report["pip_check"])
    if report["result"] != "PASS":
        print("RESULT: FAIL")
        return 1
    print("RESULT: PASS — complete local dependency profile is ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
