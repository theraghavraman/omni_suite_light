#!/usr/bin/env python3
"""Regression checks for the shared Local Engine environment inventories."""
from pathlib import Path
import sys
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import omni_environment as env


def main() -> int:
    # Doctor and health expose this shared native inventory; every verifier
    # group must reference a tool in that same inventory.
    native_names = set(env.NATIVE_TOOLS)
    assert set(env.NATIVE_TOOL_NAMES) == native_names
    assert all(tool in native_names for group in env.NATIVE_GROUPS.values() for tool in group)
    assert env.OPTIONAL_NATIVE_GROUPS <= set(env.NATIVE_GROUPS)

    # Keep the audit-found omissions in the shared lists.
    assert {"yaml", "sqlglot", "lxml", "cftime", "h5netcdf", "easyocr"} <= set(env.PYTHON_IMPORTS)
    assert "easyocr" in env.OPTIONAL_PYTHON_IMPORTS
    assert {"yt-dlp", "sqlite3", "psql", "mysql", "isql", "gswin64c"} <= native_names

    # The downloader, verifier, and bootstrap derive offline paths from the
    # same URL manifest and also require the generated manifest file.
    expected_assets = {f"vendor/{name}" for name in env.OFFLINE_ASSET_URLS}
    expected_assets.add("vendor/OFFLINE_ASSETS.txt")
    assert set(env.OFFLINE_ASSETS) == expected_assets

    # Simulate Windows' built-in convert.exe: it must not count as ImageMagick.
    with patch("shutil.which", return_value=r"C:\Windows\System32\convert.exe"), patch.object(
        env, "_is_imagemagick_convert", return_value=False
    ):
        assert env.find_native_tool_path("convert") is None

    print("Environment inventory and Windows convert regression checks: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
