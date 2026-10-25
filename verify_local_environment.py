#!/usr/bin/env python3
"""Strict local-environment verification for OmniConverter one-click setup."""
from __future__ import annotations
import importlib.util
import subprocess
import sys
from pathlib import Path
from omni_environment import PYTHON_IMPORTS, OPTIONAL_PYTHON_IMPORTS, NATIVE_GROUPS, OFFLINE_ASSETS, OPTIONAL_NATIVE_GROUPS, find_native_tool_path

ROOT = Path(__file__).resolve().parent


def check_python() -> dict[str, bool]:
    """Probe optional imports without letting missing parent packages crash the verifier."""
    result = {}
    for label, module in PYTHON_IMPORTS.items():
        try:
            result[label] = importlib.util.find_spec(module) is not None
        except (ImportError, ModuleNotFoundError, AttributeError, ValueError):
            result[label] = False
        except Exception:
            result[label] = False
    return result

def check_native() -> dict[str, str | None]:
    result = {}
    for label, candidates in NATIVE_GROUPS.items():
        result[label] = None
        for candidate in candidates:
            path = find_native_tool_path(candidate)
            if path:
                result[label] = path
                break
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
    print(f"Python runtime: {runtime_version} ({'PASS' if runtime_ok else 'UNSUPPORTED'})")
    py = check_python()
    native = check_native()
    assets = check_offline_assets()
    pip_ok, pip_msg = pip_check()

    missing_py = [x for x, ok in py.items() if not ok and x not in OPTIONAL_PYTHON_IMPORTS]
    missing_optional_py = [x for x, ok in py.items() if not ok and x in OPTIONAL_PYTHON_IMPORTS]
    required_total = sum(1 for x in py if x not in OPTIONAL_PYTHON_IMPORTS)
    required_ready = required_total - len(missing_py)
    missing_native = [x for x, path in native.items() if not path and x not in OPTIONAL_NATIVE_GROUPS]
    missing_optional_native = [x for x, path in native.items() if not path and x in OPTIONAL_NATIVE_GROUPS]
    required_native_total = len(native) - len(OPTIONAL_NATIVE_GROUPS)
    required_native_ready = required_native_total - len(missing_native)
    missing_assets = [x for x, ok in assets.items() if not ok]

    print(f"Python packages: {required_ready}/{required_total} required ready")
    print(f"Optional packages: {len(OPTIONAL_PYTHON_IMPORTS) - len(missing_optional_py)}/{len(OPTIONAL_PYTHON_IMPORTS)} ready")
    print(f"Native tools:    {required_native_ready}/{required_native_total} required ready")
    print(f"Optional native tools: {len(OPTIONAL_NATIVE_GROUPS) - len(missing_optional_native)}/{len(OPTIONAL_NATIVE_GROUPS)} ready")
    print(f"Offline assets:   {len(assets)-len(missing_assets)}/{len(assets)} ready")
    print(f"pip check:        {'PASS' if pip_ok else 'FAIL'}")

    if missing_py:
        print("Missing Python packages:", ", ".join(missing_py))
    if missing_optional_py:
        print("Optional Python packages not installed (non-blocking):", ", ".join(missing_optional_py))
    if missing_native:
        print("Missing native tools:", ", ".join(missing_native))
    if missing_optional_native:
        print("Optional native tools not detected (non-blocking):", ", ".join(missing_optional_native))
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
