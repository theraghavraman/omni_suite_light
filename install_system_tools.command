#!/bin/sh
set -eu
cd "$(dirname "$0")"

echo "=== OmniConverter COMPLETE macOS/Linux Local Setup ==="
echo "[INFO] This installs the full Python + native + offline browser stack."

have() { command -v "$1" >/dev/null 2>&1; }

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
elif have sudo; then
  SUDO="sudo"
else
  echo "[ERROR] sudo is required for system package installation."
  exit 1
fi

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
  if ! have brew; then
    echo "[SETUP] Homebrew not found; bootstrapping official Homebrew installer..."
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi

  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi

  brew update
  brew install python@3.13 ffmpeg qpdf poppler imagemagick libheif libraw openexr jpeg-xl libwebp ghostscript tesseract tesseract-lang calibre eccodes pandoc p7zip sevenzip zip unzip unixodbc freetds libpq mysql-client sqlite pkgconf
  brew install --cask libreoffice

  PYTHON="$(brew --prefix python@3.13)/bin/python3.13"
  "$PYTHON" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements-local.txt
  .venv/bin/python prepare_offline.py
  .venv/bin/python verify_local_environment.py
  touch .omni_setup_complete
  echo "[OK] Complete macOS local setup is ready."
  exit 0
fi

if [ "$OS" = "Linux" ]; then
  if have apt-get; then
    $SUDO apt-get update
    $SUDO apt-get install -y       ffmpeg qpdf poppler-utils imagemagick ghostscript       libheif-dev libraw-dev libopenexr-dev libjxl-dev libwebp-dev       libjpeg-dev libpng-dev libtiff-dev libopenjp2-7-dev       tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin tesseract-ocr-ben       tesseract-ocr-mar tesseract-ocr-tam tesseract-ocr-tel tesseract-ocr-guj       tesseract-ocr-pan tesseract-ocr-deu tesseract-ocr-fra tesseract-ocr-spa       tesseract-ocr-chi-sim       python3 python3-venv python3-dev build-essential pkg-config       libreoffice calibre pandoc p7zip-full zip unzip sqlite3       unixodbc unixodbc-dev freetds-dev libpq-dev default-libmysqlclient-dev       libeccodes-dev
    PYTHON=python3
  elif have dnf; then
    $SUDO dnf install -y       ffmpeg qpdf poppler-utils ImageMagick ghostscript       libheif-devel libraw-devel openexr-devel libjxl-devel libwebp-devel       libjpeg-turbo-devel libpng-devel libtiff-devel openjpeg2-devel       tesseract tesseract-langpack-eng tesseract-langpack-hin tesseract-langpack-ben       tesseract-langpack-mar tesseract-langpack-tam tesseract-langpack-tel       tesseract-langpack-guj tesseract-langpack-pan tesseract-langpack-deu       tesseract-langpack-fra tesseract-langpack-spa tesseract-langpack-chi_sim       python3 python3-devel gcc gcc-c++ make pkgconf-pkg-config       libreoffice calibre pandoc p7zip p7zip-plugins zip unzip sqlite       unixODBC unixODBC-devel freetds-devel libpq-devel mariadb-connector-c-devel       eccodes-devel
    PYTHON=python3
  elif have pacman; then
    $SUDO pacman -Sy --needed --noconfirm       ffmpeg qpdf poppler imagemagick ghostscript       libheif libraw openexr libjxl libwebp       tesseract tesseract-data-eng tesseract-data-hin tesseract-data-ben       tesseract-data-mar tesseract-data-tam tesseract-data-tel tesseract-data-guj       tesseract-data-pan tesseract-data-deu tesseract-data-fra tesseract-data-spa       tesseract-data-chi_sim       python python-pip base-devel pkgconf       libreoffice-fresh calibre pandoc p7zip zip unzip sqlite       unixodbc freetds libpq mariadb-libs eccodes
    PYTHON=python3
  elif have zypper; then
    $SUDO zypper --non-interactive refresh
    $SUDO zypper --non-interactive install --no-recommends       ffmpeg qpdf poppler-tools ImageMagick ghostscript       libheif-devel libraw-devel openexr-devel libjxl-devel libwebp-devel       libjpeg-devel libpng-devel libtiff-devel openjpeg2-devel       tesseract-ocr tesseract-ocr-traineddata-tesseract-ocr       python3 python3-pip python3-devel gcc gcc-c++ make pkg-config       libreoffice calibre pandoc p7zip zip unzip sqlite3       unixODBC unixODBC-devel freetds-devel postgresql-devel libmysqlclient-devel       eccodes-devel
    PYTHON=python3
  else
    echo "[ERROR] No supported Linux package manager detected (apt, dnf, pacman or zypper)."
    exit 1
  fi

  "$PYTHON" -m venv .venv
  .venv/bin/python -m pip install --upgrade pip
  .venv/bin/python -m pip install -r requirements-local.txt
  .venv/bin/python prepare_offline.py
  .venv/bin/python verify_local_environment.py
  touch .omni_setup_complete
  echo "[OK] Complete Linux local setup is ready."
  exit 0
fi

echo "Unsupported OS: $OS"
exit 1
