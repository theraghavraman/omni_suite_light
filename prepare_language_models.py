#!/usr/bin/env python3
"""Prepare the optional, isolated Omni Language Engine model assets.

This script is intentionally opt-in because the translation models are large.
It does not run as part of normal OmniConverter setup.

Examples:
  python prepare_language_models.py --translation
  python prepare_language_models.py --transliteration
  python prepare_language_models.py --all

Translation models are fetched into language-models/ and are then used with
local_files_only=True by omni_language_engine.py. No model is downloaded during
normal inference.
"""
from __future__ import annotations

import argparse
import os
import shutil
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MODEL_ROOT = ROOT / "language-models"

TRANSLATION_MODELS = {
    "en_indic": "ai4bharat/indictrans2-en-indic-dist-200M",
    "indic_en": "ai4bharat/indictrans2-indic-en-dist-200M",
    "indic_indic": "ai4bharat/indictrans2-indic-indic-dist-320M",
}

INDICXLIT_URL = "https://github.com/AI4Bharat/IndicXlit/releases/download/v1.0/indicxlit-en-indic-v1.0.zip"


def download_translation():
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:
        raise SystemExit("Install requirements-language.txt first; huggingface_hub is required.") from exc

    target_map = {
        "en_indic": MODEL_ROOT / "indictrans2-en-indic-dist-200M",
        "indic_en": MODEL_ROOT / "indictrans2-indic-en-dist-200M",
        "indic_indic": MODEL_ROOT / "indictrans2-indic-indic-dist-320M",
    }
    for key, model_id in TRANSLATION_MODELS.items():
        target = target_map[key]
        target.mkdir(parents=True, exist_ok=True)
        print(f"[GET] {model_id}")
        snapshot_download(
            repo_id=model_id,
            local_dir=str(target),
            allow_patterns=["*.json","*.py","*.safetensors","*.model","*.txt","*.md","*.gitattributes"],
            ignore_patterns=["*.bin"],
            token=os.environ.get("HF_TOKEN") or None,
        )
        print(f"[OK] {target}")


def download_transliteration():
    target = MODEL_ROOT / "indicxlit"
    target.mkdir(parents=True, exist_ok=True)
    archive = MODEL_ROOT / "indicxlit-en-indic-v1.0.zip"
    print("[GET] IndicXlit release")
    urllib.request.urlretrieve(INDICXLIT_URL, archive)
    print("[UNPACK] IndicXlit")
    with zipfile.ZipFile(archive) as z:
        z.extractall(target)
    archive.unlink(missing_ok=True)
    print(f"[OK] {target}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--translation", action="store_true")
    parser.add_argument("--transliteration", action="store_true")
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()

    if not (args.translation or args.transliteration or args.all):
        parser.error("Choose --translation, --transliteration or --all")

    MODEL_ROOT.mkdir(parents=True, exist_ok=True)
    if args.translation or args.all:
        download_translation()
    if args.transliteration or args.all:
        download_transliteration()
    print("\nOmni Language Engine assets prepared locally.")
    print("The normal Omni Assistant and Private RAG model stacks were not modified.")


if __name__ == "__main__":
    main()
