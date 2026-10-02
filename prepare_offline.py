#!/usr/bin/env python3
"""
Download the browser-side dependencies required for a fully offline OmniConverter
installation. Run this once while Internet access is available; afterwards the
local UI can run without Internet.

Native engines are installed separately by the platform installer.
"""
from pathlib import Path
from urllib.request import Request, urlopen
import hashlib, os, sys, tempfile

ROOT = Path(__file__).resolve().parent
VENDOR = ROOT / "vendor"
ASSETS = {
    "pdfjs/pdf.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
    "pdfjs/pdf.worker.min.js": "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
    "jszip/jszip.min.js": "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
    "pdf-lib/pdf-lib.min.js": "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
    "tesseract/tesseract.min.js": "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
    "tesseract/worker.min.js": "https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/worker.min.js",
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
        with urlopen(req, timeout=120) as src, open(tmp, "wb") as out:
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
