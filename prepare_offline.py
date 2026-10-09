#!/usr/bin/env python3
"""
Download the browser-side dependencies required for a fully offline OmniConverter
installation. Run this once while Internet access is available; afterwards the
local UI can run without Internet.

Native engines are installed separately by the platform installer.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib, os, sys, tempfile, ssl
from omni_environment import OFFLINE_ASSET_URLS as ASSETS

try:
    import certifi
except ImportError as exc:
    raise SystemExit(
        "certifi is required for secure offline asset downloads. "
        "Run the repository installer so it can provision requirements-local.txt."
    ) from exc

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"

def download(rel, url):
    dst = VENDOR / rel
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists() and dst.stat().st_size > 0:
        print(f"[OK] {rel} ({dst.stat().st_size/1024/1024:.1f} MB)")
        return
    print(f"[GET] {rel}")
    req = Request(url, headers={"User-Agent": "OmniConverter/1.0"})
    fd, tmp = tempfile.mkstemp(prefix="omni-", dir=str(dst.parent))
    os.close(fd)
    try:
        total = 0
        ssl_context = ssl.create_default_context(cafile=certifi.where())
        with urlopen(req, timeout=120, context=ssl_context) as src, open(tmp, "wb") as out:
            while True:
                chunk = src.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
                total += len(chunk)
                if total % (10 * 1024 * 1024) < 1024 * 1024:
                    print(f"      {total/1024/1024:.1f} MB", flush=True)
        if total == 0:
            raise RuntimeError("empty download")
        os.replace(tmp, dst)
        print(f"[DONE] {rel} ({total/1024/1024:.1f} MB)")
    finally:
        try: os.unlink(tmp)
        except FileNotFoundError: pass

def main():
    print("=== OmniConverter offline asset setup ===")
    for rel, url in ASSETS.items():
        try:
            download(rel, url)
        except Exception as exc:
            print(f"[ERROR] {rel}: {exc}", file=sys.stderr)
            return 1
    manifest = ROOT / "vendor" / "OFFLINE_ASSETS.txt"
    lines = ["OmniConverter offline browser assets", ""]
    for rel in ASSETS:
        p = VENDOR / rel
        h = hashlib.sha256(p.read_bytes()).hexdigest()
        lines.append(f"{rel}\t{p.stat().st_size}\tSHA256={h}")
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\nOffline browser assets are ready.")
    print("You can now disconnect from the Internet and run start_omni.")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
