#!/bin/sh
set -eu
echo "=== OmniConverter native engine installer ==="
OS="$(uname -s)"
have() { command -v "$1" >/dev/null 2>&1; }
if [ "$OS" = "Darwin" ]; then
  if ! have brew; then echo "Homebrew is required. Install it, then rerun this script."; exit 1; fi
  brew update
  brew install ffmpeg qpdf poppler imagemagick tesseract python calibre
  brew install --cask libreoffice
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements-data.txt || echo "[WARN] Some Data/Scientific Python packages could not be installed; the Local Engine will report missing modules."
  .venv/bin/python prepare_offline.py
  exit 0
fi
if [ "$OS" = "Linux" ]; then
  if have apt-get; then sudo apt-get update; sudo apt-get install -y ffmpeg qpdf poppler-utils imagemagick tesseract-ocr python3 libreoffice calibre
  elif have dnf; then sudo dnf install -y ffmpeg qpdf poppler-utils ImageMagick tesseract python3 libreoffice calibre
  elif have pacman; then sudo pacman -Sy --needed --noconfirm ffmpeg qpdf poppler imagemagick tesseract python libreoffice calibre
  elif have zypper; then sudo zypper install -y ffmpeg qpdf poppler-tools ImageMagick tesseract python3 libreoffice calibre
  else echo "No supported Linux package manager detected."; exit 1; fi
  python3 -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements-data.txt || echo "[WARN] Some Data/Scientific Python packages could not be installed; the Local Engine will report missing modules."
  .venv/bin/python prepare_offline.py
  exit 0
fi
echo "Unsupported OS: $OS"; exit 1
