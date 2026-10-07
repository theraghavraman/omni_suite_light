FROM python:3.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libreoffice pandoc poppler-utils qpdf ghostscript tesseract-ocr \
    zip unzip p7zip-full ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
ENV PORT=10000 PYTHONUNBUFFERED=1
EXPOSE 10000
CMD ["gunicorn","-w","2","--threads","4","--timeout","900","-b","0.0.0.0:10000","app:app"]
