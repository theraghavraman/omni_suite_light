# Omni Suite Local Engine container
# Provides a reproducible Linux runtime for the native Local Engine.
FROM python:3.13-slim-bookworm

LABEL org.opencontainers.image.title="OmniConverter Studio Local Engine"
LABEL org.opencontainers.image.description="Browser-first OmniConverter native Local Engine"
LABEL org.opencontainers.image.source="https://github.com/theraghavraman/omni_suite_light"
LABEL org.opencontainers.image.licenses="MIT"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMNI_HOST=0.0.0.0 \
    OMNI_PORT=8765

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg qpdf poppler-utils imagemagick librsvg2-bin ghostscript \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-hin \
    libreoffice calibre pandoc p7zip-full zip unzip \
    libeccodes-dev libhdf5-dev libnetcdf-dev \
    build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements-local.txt requirements-data.txt requirements-extended.txt ./
RUN python -m pip install --upgrade pip && \
    python -m pip install -r requirements-local.txt

COPY . .

RUN python -m py_compile omni_local_server.py omni_data_engine.py omni_platform.py omni_code_runner.py omni_bootstrap.py

EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/health', timeout=3)" || exit 1

CMD ["python", "omni_local_server.py"]
