#!/usr/bin/env python3
"""Rebuild knowledge-base/manifest.json from the files actually in the folder.

Rule: every supported file inside knowledge-base/ is knowledge for Omni Assistant.
Nobody has to edit the manifest by hand; titles already in the manifest are kept,
new files get a title from their first Markdown heading or their file name.

Usage:
    python3 .github/scripts/build_kb_manifest.py          # rewrite manifest.json
    python3 .github/scripts/build_kb_manifest.py --check  # exit 1 if it is stale

The same logic runs live inside omni_local_server.py (see knowledge_manifest()),
and in the GitHub Pages workflow before every deploy.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KB = ROOT / "knowledge-base"
MANIFEST = KB / "manifest.json"
TEXT_EXT = {".md", ".markdown", ".txt", ".text", ".html", ".htm", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".rst"}
BINARY_EXT = {".pdf", ".docx"}
SUPPORTED = TEXT_EXT | BINARY_EXT


def _title_from(path: Path) -> str:
    if path.suffix.lower() in {".md", ".markdown"}:
        try:
            for line in path.read_text("utf-8", errors="ignore").splitlines()[:40]:
                m = re.match(r"^#\s+(.+?)\s*#*\s*$", line)
                if m:
                    return m.group(1).strip()
        except OSError:
            pass
    name = re.sub(r"\s+-\s+", " — ", path.stem)
    name = re.sub(r"\s{2,}", " ", re.sub(r"(?<=\w)[-_]+(?=\w)|_+", " ", name)).strip()
    return name[:1].upper() + name[1:] if name else path.name


def build(kb: Path = KB) -> dict:
    old_titles: dict[str, str] = {}
    try:
        old = json.loads((kb / "manifest.json").read_text("utf-8"))
        for f in (old if isinstance(old, list) else old.get("files", [])):
            if isinstance(f, dict) and f.get("path") and f.get("title"):
                old_titles[f["path"]] = f["title"]
    except (OSError, ValueError):
        pass
    files = []
    for p in sorted(kb.rglob("*"), key=lambda x: x.relative_to(kb).as_posix().lower()):
        rel = p.relative_to(kb).as_posix()
        if not p.is_file() or rel == "manifest.json" or any(part.startswith(".") for part in p.relative_to(kb).parts):
            continue
        ext = p.suffix.lower()
        if ext not in SUPPORTED:
            continue
        files.append({
            "path": rel,
            "title": old_titles.get(rel) or _title_from(p),
            "type": ext.lstrip("."),
        })
    return {"version": 4, "rule": "Every supported file in knowledge-base/ is loaded by Omni Assistant.", "files": files}


def render(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    text = render(build())
    current = MANIFEST.read_text("utf-8") if MANIFEST.exists() else ""
    if "--check" in sys.argv:
        if current != text:
            print("knowledge-base/manifest.json is stale; run .github/scripts/build_kb_manifest.py")
            return 1
        print("knowledge-base/manifest.json is up to date.")
        return 0
    if current != text:
        MANIFEST.write_text(text, "utf-8")
    print(f"manifest.json lists {len(json.loads(text)['files'])} knowledge files.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
