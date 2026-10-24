#!/usr/bin/env python3
"""Create a GitHub Pages tree from an explicit browser-asset allowlist."""
from __future__ import annotations

from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
ROOT_SUFFIXES = {".html", ".js", ".css", ".mjs", ".svg", ".ico", ".png", ".jpg", ".jpeg", ".webp", ".woff", ".woff2", ".ttf"}
KB_SUFFIXES = {".md", ".markdown", ".txt", ".text", ".html", ".htm", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".rst", ".pdf", ".docx"}
VENDOR_SUFFIXES = {".js", ".mjs", ".css", ".json", ".wasm", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ttf", ".woff", ".woff2", ".traineddata", ".gz"}


def copy_tree(source: Path, target: Path, allowed: set[str]) -> None:
    if not source.is_dir():
        return
    for path in sorted(source.rglob("*")):
        rel = path.relative_to(source)
        if any(part.startswith(".") for part in rel.parts) or path.is_symlink():
            continue
        if not path.is_file() or path.suffix.lower() not in allowed:
            continue
        out = target / rel
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, out)


def main() -> int:
    if DIST.exists():
        shutil.rmtree(DIST)
    DIST.mkdir()
    for path in sorted(ROOT.iterdir()):
        if path.is_symlink() or not path.is_file() or path.suffix.lower() not in ROOT_SUFFIXES:
            continue
        shutil.copyfile(path, DIST / path.name)
    copy_tree(ROOT / "knowledge-base", DIST / "knowledge-base", KB_SUFFIXES)
    copy_tree(ROOT / "vendor", DIST / "vendor", VENDOR_SUFFIXES)
    # Fail closed if a future allowlist change accidentally copies repository internals.
    forbidden = {".env", ".git", "Dockerfile", "pyproject.toml", "requirements-local.txt", "omni_local_server.py"}
    leaked = [p.relative_to(DIST).as_posix() for p in DIST.rglob("*") if p.name in forbidden]
    if leaked:
        print("Forbidden file(s) in Pages artifact: " + ", ".join(leaked), file=sys.stderr)
        return 1
    if not (DIST / "index.html").is_file():
        print("Pages allowlist omitted index.html", file=sys.stderr)
        return 1
    print("Built curated Pages tree at dist/; repository, installer, service, and test files were excluded.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
