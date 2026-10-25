#!/usr/bin/env python3
"""Download pinned browser assets for an offline OmniConverter installation."""
from __future__ import annotations

from pathlib import Path
from urllib.request import Request, urlopen
import hashlib
import json
import os
import ssl
import sys
import tempfile

from omni_environment import OFFLINE_ASSET_URLS as ASSETS

try:
    import certifi
except ImportError:
    certifi = None

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
PIN_FILE = ROOT / "offline_assets_manifest.json"
MAX_ASSET_BYTES = 32 * 1024 * 1024


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_pins() -> dict[str, str]:
    pins = json.loads(PIN_FILE.read_text("utf-8"))
    if set(pins) != set(ASSETS):
        missing = sorted(set(ASSETS) - set(pins))
        extra = sorted(set(pins) - set(ASSETS))
        raise RuntimeError(f"Offline asset pin list mismatch; missing={missing}, extra={extra}")
    for rel, expected in pins.items():
        if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            raise RuntimeError(f"Invalid SHA-256 pin for {rel}")
    return pins


def download(rel: str, url: str, expected: str) -> None:
    dst = VENDOR / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.is_file() and digest(dst) == expected:
        print(f"[OK] {rel} ({dst.stat().st_size / 1024 / 1024:.1f} MB)")
        return
    print(f"[GET] {rel}", flush=True)
    fd, tmp = tempfile.mkstemp(prefix="omni-asset-", dir=str(dst.parent))
    total = 0
    h = hashlib.sha256()
    try:
        request = Request(url, headers={"User-Agent": "OmniConverter/1.0"})
        ssl_context = ssl.create_default_context(cafile=certifi.where() if certifi else None)
        with os.fdopen(fd, "wb") as output:
            with urlopen(request, timeout=120, context=ssl_context) as source:
                while True:
                    chunk = source.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_ASSET_BYTES:
                        raise RuntimeError("asset exceeds the configured download limit")
                    h.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
        if total == 0:
            raise RuntimeError("empty asset")
        actual = h.hexdigest()
        if actual != expected:
            raise RuntimeError(f"SHA-256 mismatch (expected {expected}, got {actual})")
        os.replace(tmp, dst)
        print(f"[DONE] {rel} ({total / 1024 / 1024:.1f} MB)")
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass


def main() -> int:
    try:
        pins = load_pins()
        print("=== OmniConverter offline asset setup (pinned SHA-256) ===")
        for rel, url in ASSETS.items():
            download(rel, url, pins[rel])
        lines = ["OmniConverter offline browser assets", ""]
        for rel in ASSETS:
            p = VENDOR / rel
            lines.append(f"{rel}\t{p.stat().st_size}\tSHA256={pins[rel]}")
        (VENDOR / "OFFLINE_ASSETS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
        print("Offline browser assets are ready.")
        return 0
    except Exception as exc:
        print(f"Offline asset setup failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
