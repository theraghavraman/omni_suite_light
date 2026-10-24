FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libreoffice pandoc poppler-utils qpdf ghostscript tesseract-ocr \
    zip unzip p7zip-full ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN useradd --system --uid 10001 --create-home --home-dir /home/omni omni
COPY omni-cloud-engine/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY omni-cloud-engine/app.py ./app.py
COPY omni-cloud-engine/omni_security_primitives.py ./omni_security_primitives.py
ENV PORT=10000 PYTHONUNBUFFERED=1
EXPOSE 10000
USER 10001:10001
CMD ["gunicorn","-w","2","--threads","4","--timeout","900","-b","0.0.0.0:10000","app:app"]
