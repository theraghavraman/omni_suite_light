FROM python:3.13-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=10000

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN useradd --system --uid 10001 --create-home --home-dir /home/omni omni
COPY requirements.txt requirements-instagrapi.txt ./
RUN python -m pip install --upgrade pip && python -m pip install -r requirements.txt \
    && python -m pip install --no-deps -r requirements-instagrapi.txt

COPY app.py omni_security_primitives.py ./

EXPOSE 10000
USER 10001:10001
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-10000}"]
