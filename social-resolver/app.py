import os
import re
import tempfile
import shutil
import ipaddress
from pathlib import Path
from urllib.parse import urlparse, quote, unquote
import html as html_lib
import urllib.request
import json

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


def _balanced_json_object(text: str, start: int) -> str | None:
    """Return one JSON object beginning at *start*, respecting quoted strings."""
    if start < 0 or start >= len(text) or text[start] != "{":
        return None
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]
    return None


def _post_media_from_node(node: dict) -> list[str]:
    """Extract only the media belonging to one Instagram post node.

    Instagram currently exposes carousel items in more than one public JSON
    shape. Support both the older GraphQL edge_sidecar form and the newer
    carousel_media/image_versions2/video_versions form.
    """
    if not isinstance(node, dict):
        return []

    children = ((node.get("edge_sidecar_to_children") or {}).get("edges") or [])
    if children:
        ordered = [edge.get("node") or {} for edge in children]
    else:
        carousel = node.get("carousel_media") or []
        ordered = carousel if carousel else [node]

    found: list[str] = []

    def candidate_url(item: dict) -> str:
        is_video = bool(item.get("is_video")) or item.get("media_type") in (2, "2", "VIDEO")
        # New Instagram JSON: video_versions for video, image_versions2 for image.
        if is_video:
            versions = item.get("video_versions") or []
            versions = [v for v in versions if isinstance(v, dict) and v.get("url")]
            if versions:
                best = max(versions, key=lambda v: (int(v.get("width") or 0), int(v.get("height") or 0)))
                return best.get("url") or ""
        versions = item.get("image_versions2") or {}
        candidates = versions.get("candidates") if isinstance(versions, dict) else []
        candidates = [v for v in candidates if isinstance(v, dict) and v.get("url")]
        if candidates:
            best = max(candidates, key=lambda v: (int(v.get("width") or 0), int(v.get("height") or 0)))
            return best.get("url") or ""
        resources = item.get("display_resources") or []
        resources = [v for v in resources if isinstance(v, dict) and v.get("src")]
        if resources:
            best = max(resources, key=lambda v: (int(v.get("config_width") or v.get("width") or 0)))
            return best.get("src") or ""
        # Older GraphQL / normalized shapes.
        return item.get("video_url") or item.get("display_url") or item.get("media_url") or ""

    for item in ordered:
        if not isinstance(item, dict):
            continue
        value = normalize_media_url(candidate_url(item))
        if is_allowed_media_url(value) and value not in found:
            found.append(value)
    return found


def extract_instagram_media_from_json(value) -> list[str]:
    """Walk Instagram's JSON response and extract only the target post's media."""
    if isinstance(value, dict):
        for key in ("xdt_shortcode_media", "shortcode_media"):
            node = value.get(key)
            if isinstance(node, dict):
                media = _post_media_from_node(node)
                if media:
                    return media
        for key in ("data", "graphql", "items"):
            child = value.get(key)
            media = extract_instagram_media_from_json(child)
            if media:
                return media

        # Current Instagram web-info responses commonly look like:
        # data.xdt_api__v1__media__shortcode__web_info.items[0].carousel_media
        # (or the same object without carousel_media for a single post).
        for key, child in value.items():
            if key.endswith("media__shortcode__web_info") and isinstance(child, dict):
                items = child.get("items") or []
                for item in items:
                    if isinstance(item, dict):
                        media = _post_media_from_node(item)
                        if media:
                            return media
        # Some responses wrap the node directly under data without a stable key.
        if value.get("__typename") in {"XDTGraphSidecar", "GraphSidecar", "XDTGraphImage", "XDTGraphVideo"}:
            media = _post_media_from_node(value)
            if media:
                return media
        for child in value.values():
            if isinstance(child, (dict, list)):
                media = extract_instagram_media_from_json(child)
                if media:
                    return media
    elif isinstance(value, list):
        for child in value:
            media = extract_instagram_media_from_json(child)
            if media:
                return media
    return []


def _instagram_shortcode(source: str) -> str:
    match = re.search(r"/(?:p|reel|tv)/([^/?#]+)/?", source)
    return match.group(1) if match else ""


def _shortcode_to_media_pk(shortcode: str) -> int | None:
    """Convert Instagram's base64url shortcode to the numeric media id."""
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    try:
        value = 0
        for char in shortcode:
            idx = alphabet.index(char)
            value = value * 64 + idx
        return value
    except ValueError:
        return None


def instagram_private_media_info(source: str) -> list[str]:
    """Fetch exact public post media from Instagram's media-info endpoint."""
    shortcode = _instagram_shortcode(source)
    if not shortcode:
        return []
    media_pk = _shortcode_to_media_pk(shortcode)
    if media_pk is None:
        return []

    endpoint = f"https://i.instagram.com/api/v1/media/{media_pk}/info/"
    req = urllib.request.Request(
        endpoint,
        headers={
            "User-Agent": "Instagram 296.0.0.24.109 Android",
            "Accept": "*/*",
            "X-IG-App-ID": "936619743392459",
            "Referer": "https://www.instagram.com/",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            raw = response.read().decode("utf-8", "replace")
        payload = json.loads(raw)
        items = payload.get("items") or []
        if not items:
            return []
        item = items[0]
        # This endpoint is media-specific, so carousel_media belongs to the
        # exact post rather than the surrounding Instagram page.
        return _post_media_from_node(item)
    except Exception:
        return []


def jina_instagram_structured(source: str) -> list[str]:
    """Fetch only post-specific Instagram JSON/HTML through Jina.

    The normal Instagram page can contain profile/recommendation assets. We
    therefore try the post JSON endpoint and the post's embed document, both
    keyed to the exact shortcode, before any metadata fallback is considered.
    """
    if not is_instagram_url(source):
        return []

    shortcode = _instagram_shortcode(source)
    if not shortcode:
        return []

    targets = [
        f"https://www.instagram.com/p/{shortcode}/?__a=1&__d=dis",
        f"https://www.instagram.com/p/{shortcode}/embed/captioned/",
        f"https://www.instagram.com/p/{shortcode}/embed/",
    ]

    for target in targets:
        try:
            endpoint = "https://r.jina.ai/" + target
            req = urllib.request.Request(
                endpoint,
                headers={
                    "Accept": "text/html, application/json",
                    "X-Respond-With": "html",
                    "X-Retain-Media": "html",
                },
                method="GET",
            )
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = html_lib.unescape(response.read().decode("utf-8", "replace")).strip()

            # Direct JSON response.
            try:
                payload = json.loads(raw)
                media = extract_instagram_media_from_json(payload)
                if media:
                    return media
            except Exception:
                pass

            # Embedded/HTML JSON.
            media = extract_instagram_post_media(raw)
            if media:
                return media
        except Exception:
            continue

    return []


def extract_instagram_post_media(raw_html: str) -> list[str]:
    """Extract media from the specific Instagram post, never the surrounding profile/feed."""
    text = html_lib.unescape(raw_html or "")
    candidates = []

    # Instagram has used both shortcode_media and xdt_shortcode_media. Parse
    # the complete JSON object so profile/feed images elsewhere on the page
    # cannot leak into the result.
    for marker in ('"xdt_shortcode_media"', '"shortcode_media"'):
        pos = 0
        while True:
            hit = text.find(marker, pos)
            if hit < 0:
                break
            colon = text.find(":", hit + len(marker))
            if colon >= 0:
                start = text.find("{", colon + 1)
                if start >= 0:
                    blob = _balanced_json_object(text, start)
                    if blob:
                        try:
                            node = json.loads(blob)
                            media = _post_media_from_node(node)
                            for value in media:
                                if value not in candidates:
                                    candidates.append(value)
                        except Exception:
                            pass
            pos = hit + len(marker)

    return candidates


def extract_instagram_og_media(raw_html: str) -> list[str]:
    """Return only OpenGraph media explicitly declared for the post page."""
    text = html_lib.unescape(raw_html or "")
    found: list[str] = []

    for pattern in (
        r"""<meta[^>]+property=["']og:(?:video|image)(?::secure_url)?["'][^>]+content=["']([^"']+)["']""",
        r"""<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:(?:video|image)(?::secure_url)?["']""",
    ):
        for value in re.findall(pattern, text, flags=re.I):
            value = normalize_media_url(value)
            if is_allowed_media_url(value) and value not in found:
                found.append(value)

    return found


def extract_urls_from_html(raw_html: str) -> list[str]:
    text = html_lib.unescape(raw_html or "")
    found: list[str] = []

    def add(value: str):
        value = normalize_media_url(value)
        if is_allowed_media_url(value) and value not in found:
            found.append(value)

    # This generic helper is deliberately conservative. It is only a fallback
    # for direct media discovery; Instagram post pages are handled separately
    # by extract_instagram_post_media().
    html_patterns = [
        r"""<meta[^>]+property=["']og:(?:video|image)(?::secure_url)?["'][^>]+content=["']([^"']+)["']""",
        r"""<(?:video|source|audio)[^>]+(?:src|data-src)=["']([^"']+)["']""",
    ]
    for pattern in html_patterns:
        for value in re.findall(pattern, text, flags=re.I):
            add(value)

    # Generic CDN URLs are the final fallback. They are not used when a
    # post-specific Instagram structure was successfully parsed.
    generic = re.findall(r'''https://[^"'<>
\s]+(?:cdninstagram\.com|fbcdn\.net)[^"'<>
\s]*'''.replace("\n", ""), text, flags=re.I)
    for value in generic:
        add(value)

    return found


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
        # First try Instagram's media-info endpoint. It is keyed by the
        # exact shortcode/media id and returns the post's own carousel_media.
        urls = instagram_private_media_info(source)

        # If Instagram rejects that endpoint, use the structured Jina routes.
        if not urls:
            urls = jina_instagram_structured(source)

        # Jina may also return the original HTML with embedded post JSON.
        # Parse that before considering any generic page media.
        if not urls:
            urls = extract_instagram_post_media(raw)

        # Do NOT fall back to arbitrary CDN URLs on an Instagram post page.
        # Those URLs include Instagram's logo, profile assets, recommendations,
        # and other page chrome — exactly the false positives this resolver must
        # never show. A safe metadata fallback can return only the page's own
        # og:image/og:video.
        if not urls:
            urls = extract_instagram_og_media(raw)

        if not urls:
            return None

        # The structured extractor already preserves carousel order.
        media_urls = []
        for u in urls:
            if u not in media_urls:
                media_urls.append(u)

        videos = [u for u in media_urls if re.search(r"\.(?:mp4|m3u8)(?:[?#]|$)", u, re.I)]
        images = [u for u in media_urls if re.search(r"\.(?:jpe?g|png|webp|avif|gif)(?:[?#]|$)", u, re.I)]

        if not videos and not images:
            return None

        # Preserve discovery order. Instagram carousels can mix photos and videos,
        # so grouping all videos before all images would change the post order.
        ordered = media_urls
        thumb = images[0] if images else (videos[0] if videos else "")
        media_type = "video" if videos and not images and len(ordered) == 1 else ("carousel" if len(ordered) > 1 else "image_or_media")
        downloads = []
        for index, media in enumerate(ordered, 1):
            path = urlparse(media).path.lower()
            match = re.search(r"\.(jpe?g|png|webp|avif|gif|mp4|webm|mov|m4v|m3u8|mp3|m4a|aac|ogg)$", path)
            ext = match.group(1) if match else ""
            downloads.append({
                "quality": f"Item {index}" if len(ordered) > 1 else "Best",
                "format_id": None,
                "ext": ext,
                "media_type": "video" if ext in {"mp4","webm","mov","m4v","m3u8"} else ("image" if ext in {"jpg","jpeg","png","webp","avif","gif"} else "media"),
                "has_audio": ext in {"mp4","webm","mov","m4v","m3u8","mp3","m4a","aac","ogg"},
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
