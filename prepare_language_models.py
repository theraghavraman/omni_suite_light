#!/usr/bin/env python3
"""Prepare optional language model assets from explicitly pinned revisions.

Exact 40-character model commits and the IndicXlit release SHA-256 must be
provided by a maintainer after reviewing the upstream artifacts. The script
never follows a branch/tag implicitly and never extracts unchecked paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import ssl
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parent
MODEL_ROOT = ROOT / "language-models"
MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_ENTRY_BYTES = 256 * 1024**2
MAX_ENTRIES = 10000

TRANSLATION_MODELS = {
    "en_indic": ("ai4bharat/indictrans2-en-indic-dist-200M", "OMNI_HF_REV_EN_INDIC"),
    "indic_en": ("ai4bharat/indictrans2-indic-en-dist-200M", "OMNI_HF_REV_INDIC_EN"),
    "indic_indic": ("ai4bharat/indictrans2-indic-indic-dist-320M", "OMNI_HF_REV_INDIC_INDIC"),
}
INDICXLIT_URL = "https://github.com/AI4Bharat/IndicXlit/releases/download/v1.0/indicxlit-en-indic-v1.0.zip"


def approved_revision(env_name: str) -> str:
    revision = os.environ.get(env_name, "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", revision):
        raise RuntimeError(f"{env_name} must be a maintainer-reviewed 40-character Git commit SHA")
    return revision


def download_translation() -> None:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise SystemExit("Install requirements-language.txt first; huggingface_hub is required.") from exc

    for key, (model_id, revision_env) in TRANSLATION_MODELS.items():
        revision = approved_revision(revision_env)
        target = MODEL_ROOT / model_id.rsplit("/", 1)[-1]
        target.mkdir(parents=True, exist_ok=True, mode=0o700)
        print(f"[GET] {model_id} at {revision}")
        snapshot_download(
            repo_id=model_id,
            revision=revision,
            local_dir=str(target),
            allow_patterns=["*.json", "*.safetensors", "*.model", "*.txt", "*.md", "*.gitattributes"],
            ignore_patterns=["*.bin", "*.py"],
            token=os.environ.get("HF_TOKEN") or None,
        )
        print(f"[OK] {target}")


def download_verified_archive() -> Path:
    expected = os.environ.get("OMNI_INDICXLIT_SHA256", "").strip().lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RuntimeError("OMNI_INDICXLIT_SHA256 must be set to the maintainer-reviewed release SHA-256")
    try:
        import certifi
    except ImportError as exc:
        raise RuntimeError("certifi is required for verified model downloads") from exc
    context = ssl.create_default_context(cafile=certifi.where())
    target = MODEL_ROOT / "indicxlit-en-indic-v1.0.zip"
    fd, temp_name = tempfile.mkstemp(prefix="indicxlit-", suffix=".part", dir=MODEL_ROOT)
    os.close(fd)
    digest = hashlib.sha256()
    total = 0
    try:
        req = urllib.request.Request(INDICXLIT_URL, headers={"User-Agent": "OmniConverter/1.0"})
        with urllib.request.urlopen(req, timeout=60, context=context) as source, open(temp_name, "wb") as out:
            while True:
                chunk = source.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ARCHIVE_BYTES:
                    raise RuntimeError("IndicXlit archive exceeds the configured download limit")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError("IndicXlit release SHA-256 did not match the reviewed value")
        os.replace(temp_name, target)
        return target
    finally:
        try:
            os.unlink(temp_name)
        except FileNotFoundError:
            pass


def safe_extract_zip(archive: Path, target: Path) -> None:
    target.mkdir(parents=True, exist_ok=True, mode=0o700)
    root = target.resolve(strict=True)
    with zipfile.ZipFile(archive) as source:
        entries = source.infolist()
        if len(entries) > MAX_ENTRIES:
            raise RuntimeError("IndicXlit archive contains too many entries")
        total = sum(int(item.file_size) for item in entries)
        if total > MAX_ARCHIVE_BYTES:
            raise RuntimeError("IndicXlit archive expands beyond the configured limit")
        for item in entries:
            name = item.filename
            path = PurePosixPath(name)
            mode = (item.external_attr >> 16) & 0xFFFF
            if (not name or "\\" in name or path.is_absolute() or
                    any(part in {"", ".", ".."} for part in path.parts) or
                    (mode and (mode & 0o170000) == 0o120000)):
                raise RuntimeError("IndicXlit archive contains an unsafe path or link")
            if item.file_size > MAX_ENTRY_BYTES:
                raise RuntimeError("IndicXlit archive entry exceeds the per-file limit")
            dest = root.joinpath(*path.parts)
            if not dest.resolve(strict=False).is_relative_to(root):
                raise RuntimeError("IndicXlit archive entry escapes the model directory")
        for item in entries:
            if item.is_dir():
                dest = root.joinpath(*PurePosixPath(item.filename).parts)
                dest.mkdir(parents=True, exist_ok=True, mode=0o700)
                continue
            dest = root.joinpath(*PurePosixPath(item.filename).parts)
            dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if not dest.parent.resolve(strict=True).is_relative_to(root):
                raise RuntimeError("IndicXlit archive parent escapes the model directory")
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            if hasattr(os, "O_NOFOLLOW"):
                flags |= os.O_NOFOLLOW
            fd = os.open(dest, flags, 0o600)
            written = 0
            try:
                with source.open(item) as inp, os.fdopen(fd, "wb") as out:
                    while True:
                        chunk = inp.read(64 * 1024)
                        if not chunk:
                            break
                        written += len(chunk)
                        if written > MAX_ENTRY_BYTES:
                            raise RuntimeError("IndicXlit expanded entry exceeds the per-file limit")
                        out.write(chunk)
                if written != item.file_size:
                    raise RuntimeError("IndicXlit entry size did not match its ZIP metadata")
            except Exception:
                dest.unlink(missing_ok=True)
                raise


def download_transliteration() -> None:
    target = MODEL_ROOT / "indicxlit"
    archive = download_verified_archive()
    try:
        safe_extract_zip(archive, target)
    finally:
        archive.unlink(missing_ok=True)
    print(f"[OK] {target}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--translation", action="store_true")
    parser.add_argument("--transliteration", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    if not (args.translation or args.transliteration or args.all):
        parser.error("Choose --translation, --transliteration or --all")
    MODEL_ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.translation or args.all:
        download_translation()
    if args.transliteration or args.all:
        download_transliteration()
    print("\nOmni Language Engine assets prepared locally.")
    print("Exact revisions and artifact integrity are required; normal inference remains local-only.")


if __name__ == "__main__":
    main()
