#!/bin/sh
set -eu
echo "=== OmniConverter native engine installer ==="
OS="$(uname -s)"
have() { command -v "$1" >/dev/null 2>&1; }
if [ "$OS" = "Darwin" ]; then
  if ! have brew; then echo "Homebrew is required. Install it, then rerun this script."; exit 1; fi
  brew update
  brew install ffmpeg qpdf poppler imagemagick tesseract python
  exit 0
fi
if [ "$OS" = "Linux" ]; then
  if have apt-get; then sudo apt-get update; sudo apt-get install -y ffmpeg qpdf poppler-utils imagemagick tesseract-ocr python3
  elif have dnf; then sudo dnf install -y ffmpeg qpdf poppler-utils ImageMagick tesseract python3
  elif have pacman; then sudo pacman -Sy --needed --noconfirm ffmpeg qpdf poppler imagemagick tesseract python
  elif have zypper; then sudo zypper install -y ffmpeg qpdf poppler-tools ImageMagick tesseract python3
  else echo "No supported Linux package manager detected."; exit 1; fi
  exit 0
fi
echo "Unsupported OS: $OS"; exit 1
