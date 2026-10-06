import os
import re
import tempfile
import shutil
import ipaddress
from pathlib import Path
from urllib.parse import urlparse, quote, unquote
import html as html_lib
import urllib.request

import yt_dlp
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, HttpUrl

APP_NAME = "Omni Social Resolver"
MAX_DURATION = int(os.getenv("MAX_DURATION", "900"))
MAX_DOWNLOAD_MB = int(os.getenv("MAX_DOWNLOAD_MB", "300"))
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "https://theraghavraman.github.io")

SUPPORTED_HOSTS = {
    "instagram.com", "facebook.com", "fb.watch", "tiktok.com",
    "youtube.com", "youtu.be", "x.com", "twitter.com", "pinterest.com",
    "pin.it", "reddit.com", "threads.net", "threads.com", "twitch.tv",
    "vimeo.com", "dailymotion.com", "tumblr.com", "bsky.app",
    "weibo.com", "likee.video", "rumble.com", "linkedin.com",
}

app = FastAPI(title=APP_NAME, version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


class ResolveRequest(BaseModel):
    url: HttpUrl


def validate_public_url(raw: str) -> str:
    p = urlparse(str(raw))
    if p.scheme not in ("http", "https") or not p.hostname:
        raise HTTPException(400, "Only public HTTP/HTTPS URLs are supported.")

    host = p.hostname.lower().rstrip(".")
    if host == "localhost" or host.endswith(".localhost"):
        raise HTTPException(400, "Local URLs are not supported.")

    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise HTTPException(400, "Private/local network URLs are not supported.")
    except ValueError:
        pass

    if not any(host == h or host.endswith("." + h) for h in SUPPORTED_HOSTS):
        raise HTTPException(400, "This platform is not enabled in Omni Social Media Studio.")

    return p._replace(fragment="").geturl()


def ydl_opts() -> dict:
    return {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "skip_download": True,
        "socket_timeout": 25,
        "retries": 2,
        "fragment_retries": 2,
        "cachedir": False,
    }


def extract_info(url: str) -> dict:
    try:
        with yt_dlp.YoutubeDL(ydl_opts()) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:
        raise HTTPException(422, f"Could not resolve public media: {str(exc)[:300]}")

    if not info:
        raise HTTPException(422, "No public media was found.")

    if info.get("entries"):
        entries = [x for x in info.get("entries") or [] if x]
        if entries:
            info = entries[0]

    duration = info.get("duration")
    if duration and float(duration) > MAX_DURATION:
        raise HTTPException(413, f"Media is longer than the {MAX_DURATION // 60}-minute limit.")

    return info


MEDIA_HOST_SUFFIXES = (
    "cdninstagram.com",
    "fbcdn.net",
    "instagram.com",
)

def is_allowed_media_url(raw: str) -> bool:
    try:
        p = urlparse(raw)
        host = (p.hostname or "").lower().rstrip(".")
        return p.scheme in ("http", "https") and any(
            host == suffix or host.endswith("." + suffix)
            for suffix in MEDIA_HOST_SUFFIXES
        )
    except Exception:
        return False


def normalize_media_url(value: str) -> str:
    value = html_lib.unescape(str(value or "")).strip()
    for _ in range(2):
        value = value.replace("\\\\/","/").replace("\\u0026","&").replace("\\u003d","=").replace("\\u003D","=")
    return value


def extract_urls_from_html(raw_html: str) -> list[str]:
    text = html_lib.unescape(raw_html or "")
    found: list[str] = []

    def add(value: str):
        value = normalize_media_url(value)
        if is_allowed_media_url(value) and value not in found:
            found.append(value)

    # Instagram's embedded post data uses these fields for the actual post
    # media. Prefer them over arbitrary <img> elements such as the profile avatar.
    structured_patterns = [
        r"""["']display_url["']\s*:\s*["']([^"']+)["']""",
        r"""["']video_url["']\s*:\s*["']([^"']+)["']""",
        r"""["']media_url["']\s*:\s*["']([^"']+)["']""",
    ]
    structured = []
    for pattern in structured_patterns:
        for value in re.findall(pattern, text, flags=re.I):
            value = normalize_media_url(value)
            if is_allowed_media_url(value) and value not in structured:
                structured.append(value)

    # HTML metadata is the next-best source and normally points at the post
    # cover rather than the account avatar.
    html_patterns = [
        r"""<meta[^>]+property=["']og:(?:video|image)(?::secure_url)?["'][^>]+content=["']([^"']+)["']""",
        r"""<(?:video|source|audio)[^>]+(?:src|data-src)=["']([^"']+)["']""",
        r"""<img[^>]+(?:src|data-src)=["']([^"']+)["']""",
    ]
    html_urls = []
    for pattern in html_patterns:
        for value in re.findall(pattern, text, flags=re.I):
            value = normalize_media_url(value)
            if is_allowed_media_url(value) and value not in html_urls:
                html_urls.append(value)

    # Generic CDN URLs are only a final fallback.
    generic = re.findall(r'''https://[^"'<>
\s]+(?:cdninstagram\.com|fbcdn\.net)[^"'<>
\s]*'''.replace("\n", ""), text, flags=re.I)
    generic_urls = []
    for value in generic:
        value = normalize_media_url(value)
        if is_allowed_media_url(value) and value not in generic_urls:
            generic_urls.append(value)

    return structured or html_urls or generic_urls


def jina_instagram_media(source: str) -> dict | None:
    """Fallback for public Instagram pages when Instagram rate-limits the Render IP.

    Jina fetches the public page using its browser reader and preserves media URLs.
    No Instagram credentials or cookies are used.
    """
    if not is_instagram_url(source):
        return None
    try:
        endpoint = "https://r.jina.ai/" + source
        req = urllib.request.Request(
            endpoint,
            headers={
                "Accept": "text/html",
                "X-Respond-With": "html",
                "X-Retain-Media": "html",
                "X-Retain-Images": "all",
                "X-Retain-Links": "all",
            },
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read().decode("utf-8", "replace")
        urls = extract_urls_from_html(raw)
        if not urls:
            return None

        # Keep all media items in the order exposed by Instagram's embedded
        # post data. This is important for carousel posts: the first image is
        # only the cover, not the complete post.
        media_urls = []
        for u in urls:
            if u not in media_urls:
                media_urls.append(u)

        videos = [u for u in media_urls if re.search(r"\.(?:mp4|m3u8)(?:[?#]|$)", u, re.I)]
        images = [u for u in media_urls if re.search(r"\.(?:jpe?g|png|webp|avif)(?:[?#]|$)", u, re.I)]

        if not videos and not images:
            return None

        ordered = videos + images if videos else images
        thumb = images[0] if images else (videos[0] if videos else "")
        media_type = "video" if videos and not images else ("carousel" if len(ordered) > 1 else "image_or_media")
        downloads = []
        for index, media in enumerate(ordered, 1):
            downloads.append({
                "quality": f"Item {index}" if len(ordered) > 1 else "Best",
                "format_id": None,
                "has_audio": bool(re.search(r"\.(?:mp4|m3u8)(?:[?#]|$)", media, re.I)),
                "url": "/api/media-proxy?url=" + quote(media, safe=""),
            })

        return {
            "success": True,
            "platform": "Instagram",
            "title": "Public Instagram media",
            "uploader": "",
            "duration": None,
            "thumbnail": thumb,
            "webpage_url": source,
            "type": media_type,
            "downloads": downloads,
        }
    except Exception:
        return None


def is_instagram_url(raw: str) -> bool:
    try:
        host = (urlparse(raw).hostname or "").lower().rstrip(".")
        return host == "instagram.com" or host.endswith(".instagram.com")
    except Exception:
        return False


def choose_formats(info: dict) -> list[dict]:
    formats = info.get("formats") or []
    candidates = []

    for f in formats:
        url = f.get("url")
        height = f.get("height")
        vcodec = f.get("vcodec")
        acodec = f.get("acodec")
        ext = (f.get("ext") or "").lower()
        if not url or not vcodec or vcodec == "none":
            continue
        if ext not in {"mp4", "webm", "mov", "m4v"}:
            continue
        if height and int(height) > 2160:
            continue
        candidates.append({
            "format_id": f.get("format_id"),
            "height": int(height or 0),
            "ext": ext,
            "has_audio": bool(acodec and acodec != "none"),
        })

    result = []
    for target in (1080, 720, 480, 360):
        eligible = [x for x in candidates if x["height"] and x["height"] <= target]
        if not eligible:
            continue
        eligible.sort(key=lambda x: (x["height"], x["has_audio"], x["ext"] == "mp4"), reverse=True)
        pick = eligible[0]
        if not any(x["quality"] == f'{pick["height"]}p' for x in result):
            result.append({
                "quality": f'{pick["height"]}p',
                "height": pick["height"],
                "format_id": pick["format_id"],
                "ext": pick["ext"],
                "has_audio": pick["has_audio"],
            })

    if not result and candidates:
        pick = sorted(candidates, key=lambda x: (x["height"], x["has_audio"]), reverse=True)[0]
        result.append({
            "quality": f'{pick["height"]}p' if pick["height"] else "Best",
            "height": pick["height"],
            "format_id": pick["format_id"],
            "ext": pick["ext"],
            "has_audio": pick["has_audio"],
        })

    return result


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": APP_NAME,
        "version": "1.0",
        "yt_dlp": yt_dlp.version.__version__,
        "max_duration": MAX_DURATION,
        "max_download_mb": MAX_DOWNLOAD_MB,
    }


@app.post("/api/resolve")
def resolve(body: ResolveRequest):
    url = validate_public_url(str(body.url))
    try:
        info = extract_info(url)
    except HTTPException as exc:
        if is_instagram_url(url):
            fallback = jina_instagram_media(url)
            if fallback:
                return JSONResponse(fallback)
        raise exc
    formats = choose_formats(info)

    if not formats:
        formats = [{"quality": "Best", "height": 0, "format_id": None, "ext": info.get("ext") or "mp4", "has_audio": True}]

    base = {
        "success": True,
        "platform": info.get("extractor_key") or info.get("extractor") or "Social",
        "title": info.get("title") or "Public media",
        "uploader": info.get("uploader") or info.get("channel") or info.get("creator") or "",
        "duration": info.get("duration"),
        "thumbnail": info.get("thumbnail") or "",
        "webpage_url": info.get("webpage_url") or url,
        "type": "video" if info.get("vcodec") not in (None, "none") else "image_or_media",
        "downloads": [],
    }

    for f in formats:
        base["downloads"].append({
            "quality": f["quality"],
            "format_id": f.get("format_id"),
            "has_audio": f.get("has_audio", False),
            "url": f"/api/download?url={quote(url, safe='')}&quality={quote(f['quality'])}",
        })

    return JSONResponse(base)


@app.get("/api/media-proxy")
def media_proxy(url: str = Query(...)):
    """Proxy a short-lived public CDN media URL so browser CORS does not block downloads."""
    target = unquote(url)
    if not is_allowed_media_url(target):
        raise HTTPException(400, "Media URL is not an allowed public CDN URL.")
    req = urllib.request.Request(
        target,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.instagram.com/",
        },
        method="GET",
    )
    try:
        upstream = urllib.request.urlopen(req, timeout=30)
    except Exception as exc:
        raise HTTPException(502, f"Media CDN request failed: {str(exc)[:200]}")
    content_type = upstream.headers.get("Content-Type", "application/octet-stream")
    content_length = upstream.headers.get("Content-Length")
    headers = {}
    if content_length:
        headers["Content-Length"] = content_length

    def stream():
        try:
            while True:
                chunk = upstream.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk
        finally:
            upstream.close()

    return StreamingResponse(stream(), media_type=content_type, headers=headers)


@app.get("/api/download")
def download(url: str = Query(...), quality: str = Query("Best")):
    source = validate_public_url(url)
    info = extract_info(source)

    if quality.isdigit():
        target = int(quality)
        fmt = f"bestvideo[height<={target}]+bestaudio/best[height<={target}]/best"
    elif re.match(r"^\d+p$", quality, re.I):
        target = int(re.sub(r"[^0-9]", "", quality))
        fmt = f"bestvideo[height<={target}]+bestaudio/best[height<={target}]/best"
    else:
        fmt = "bestvideo+bestaudio/best"

    safe_title = re.sub(r"[^A-Za-z0-9._-]+", "_", info.get("title") or "omni-social-media")[:100] or "omni-social-media"

    with tempfile.TemporaryDirectory(prefix="omni-social-") as tmp:
        out = Path(tmp) / "%(title).120s.%(ext)s"
        opts = {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": fmt,
            "merge_output_format": "mp4",
            "outtmpl": str(out),
            "socket_timeout": 25,
            "retries": 2,
            "fragment_retries": 2,
            "max_filesize": MAX_DOWNLOAD_MB * 1024 * 1024,
            "restrictfilenames": True,
            "overwrites": True,
        }
        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([source])
        except Exception as exc:
            raise HTTPException(422, f"Download failed: {str(exc)[:300]}")

        files = [p for p in Path(tmp).glob("*") if p.is_file()]
        if not files:
            raise HTTPException(500, "The resolver produced no output file.")

        path = max(files, key=lambda p: p.stat().st_mtime)
        final_path = Path(tempfile.mkstemp(prefix="omni-social-", suffix=path.suffix)[1])
        shutil.copy2(path, final_path)

    media_type = "video/mp4" if final_path.suffix.lower() == ".mp4" else "application/octet-stream"
    return FileResponse(
        final_path,
        media_type=media_type,
        filename=f"{safe_title}.mp4" if media_type == "video/mp4" else f"{safe_title}{final_path.suffix}",
    )


@app.get("/")
def root():
    return {"ok": True, "service": APP_NAME, "docs": "/docs"}
