#!/usr/bin/env python3
"""
OmniConverter Local Engine
- Core HTTP server uses only the Python standard library.
- Data/Scientific Studio operations use the optional requirements-data.txt stack.
- Binds to 127.0.0.1 only.
- Browser UI talks to this process over localhost.
- Heavy media/PDF/image/OCR work is delegated to native tools when installed.
"""
from __future__ import annotations
import urllib.request
import base64, bz2, gzip, hashlib, json, lzma, mimetypes, os, platform, secrets, shutil, subprocess, tarfile, tempfile, threading, time, urllib.parse, zipfile, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import omni_data_engine
import omni_platform
import omni_code_runner
import omni_language_engine

HOST = os.environ.get("OMNI_HOST", "127.0.0.1")
PORT = int(os.environ.get("OMNI_PORT", "8765"))
ENGINE_API_VERSION = 4
ENGINE_BUILD = "omni-local-2026.10-complete-language"
ROOT = Path(tempfile.gettempdir()) / "omni_converter_engine"
ROOT.mkdir(parents=True, exist_ok=True)
LOCK = threading.Lock()
FILES: dict[str, Path] = {}
MAX_UPLOAD = int(os.environ.get("OMNI_MAX_UPLOAD", str(8 * 1024**3)))
TOKEN = os.environ.get("OMNI_TOKEN") or secrets.token_urlsafe(32)
ALLOWED_ORIGINS = {"http://127.0.0.1:8765", "http://localhost:8765", "https://theraghavraman.github.io"}
ALLOWED_ORIGINS.update(origin.strip().rstrip("/") for origin in os.environ.get("OMNI_ALLOWED_ORIGINS", "").split(",") if origin.strip())

def request_origin(handler):
    return handler.headers.get("Origin", "").rstrip("/")

def host_allowed(handler):
    host = handler.headers.get("Host", "").split(":", 1)
    hostname = host[0].strip().lower()
    port = host[1] if len(host) == 2 else "80"
    return hostname in {"127.0.0.1", "localhost"} and port == "8765"

def origin_allowed(handler):
    origin = request_origin(handler)
    return bool(origin) and origin in ALLOWED_ORIGINS

def cors_origin(handler):
    origin = request_origin(handler)
    return origin if origin in ALLOWED_ORIGINS else ""

def authorize(handler):
    if not origin_allowed(handler):
        handler.send_json({"ok": False, "error": "Origin not allowed"}, 403)
        return False
    if not secrets.compare_digest(handler.headers.get("X-Omni-Token", ""), TOKEN):
        handler.send_json({"ok": False, "error": "Missing or invalid local-engine token"}, 401)
        return False
    return True

TOOLS = {
    "ffmpeg": ["ffmpeg", "-version"],
    "ffprobe": ["ffprobe", "-version"],
    "yt-dlp": ["yt-dlp", "--version"],
    "qpdf": ["qpdf", "--version"],
    "pdftoppm": ["pdftoppm", "-v"],
    "pdftotext": ["pdftotext", "-v"],
    "magick": ["magick", "-version"],
    "convert": ["convert", "-version"],
    "rsvg-convert": ["rsvg-convert", "--version"],
    "tesseract": ["tesseract", "--version"],
    "soffice": ["soffice", "--version"],
    "libreoffice": ["libreoffice", "--version"],
    "ebook-convert": ["ebook-convert", "--version"],
    "pandoc": ["pandoc", "--version"],
    "zip": ["zip", "-v"],
    "unzip": ["unzip", "-v"],
    "7z": ["7z", "--help"],
}

def tool_path(name):
    p = shutil.which(name)
    if p:
        return p

    # Windows winget/ZIP installs can land Poppler outside the PATH inherited
    # by a Python process that was launched before installation.
    if platform.system().lower() == "windows" and name in {"pdftoppm", "pdftotext"}:
        candidates = [
            Path(os.environ.get("PROGRAMFILES", r"C:\\Program Files")) / "poppler" / "Library" / "bin" / f"{name}.exe",
            Path(os.environ.get("PROGRAMFILES", r"C:\\Program Files")) / "poppler" / "bin" / f"{name}.exe",
            Path(os.environ.get("LOCALAPPDATA", "")) / "poppler" / "Library" / "bin" / f"{name}.exe",
            Path(r"C:\\msys64\\mingw64\\bin") / f"{name}.exe",
            Path(r"C:\\ProgramData\\chocolatey\\bin") / f"{name}.exe",
        ]
        local_app = Path(os.environ.get("LOCALAPPDATA", ""))
        if local_app.exists():
            candidates.extend(local_app.glob(r"Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_*\\**\\Library\\bin\\"+f"{name}.exe"))
            candidates.extend(local_app.glob(r"Microsoft\\WinGet\\Packages\\oschwartz10612.Poppler_*\\**\\bin\\"+f"{name}.exe"))
        for candidate in candidates:
            try:
                if candidate and candidate.is_file():
                    return str(candidate)
            except OSError:
                pass

    if name == "magick":
        return shutil.which("convert")
    if name == "soffice":
        return shutil.which("libreoffice")
    if name == "libreoffice":
        return shutil.which("soffice") or shutil.which("libreoffice")
    return None

def tool_versions():
    out = {}
    for name, cmd in TOOLS.items():
        path = tool_path(name)
        out[name] = {"installed": bool(path), "path": path}
    return out

def safe_name(name: str, fallback="input.bin") -> str:
    name = os.path.basename(name or fallback).replace("\\", "_")
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:180] or fallback

def new_id(prefix="f"):
    raw = f"{time.time_ns()}-{os.urandom(8).hex()}".encode()
    return prefix + hashlib.sha256(raw).hexdigest()[:20]

def get_file(fid):
    with LOCK:
        p = FILES.get(fid)
    if not p or not p.exists():
        raise ValueError("Unknown or expired file id")
    return p

def register(path):
    fid = new_id()
    with LOCK:
        FILES[fid] = path
    return fid

def cleanup_old():
    cutoff = time.time() - 6 * 3600
    for p in ROOT.iterdir():
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
        except OSError:
            pass

def run(cmd, timeout=7200):
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        raise RuntimeError(f"Required tool is not installed: {cmd[0]}") from e
    except subprocess.TimeoutExpired as e:
        raise RuntimeError("Local job timed out") from e
    if cp.returncode != 0:
        msg = (cp.stderr or cp.stdout or f"exit {cp.returncode}").strip()
        raise RuntimeError(msg[-5000:])
    return cp

def require_tool(name):
    p = tool_path(name)
    if not p:
        raise RuntimeError(f"{name} is not installed. Run setup_and_start.bat on Windows or install_system_tools.command on macOS/Linux.")
    return p

def output_path(stem, ext):
    return ROOT / f"{safe_name(stem)}_{new_id('o')[:10]}.{ext.lstrip('.')}"

def build_pdf_pptx(inp: Path, out: Path, dpi: int = 120):
    """Create a PPTX visual replica: one slide per PDF page, rendered as a PNG."""
    require_tool("pdftoppm")
    work = ROOT / new_id("pdfppt")
    work.mkdir()
    prefix = work / "page"
    try:
        run(["pdftoppm", "-r", str(max(72, min(240, dpi))), "-png", str(inp), str(prefix)], timeout=3600)
        pages = sorted(work.glob("page-*.png"))
        if not pages:
            raise RuntimeError("PDF rendering produced no pages")

        import struct

        def png_size(path):
            with open(path, "rb") as fh:
                sig = fh.read(24)
            if sig[:8] != b"\\x89PNG\\r\\n\\x1a\\n":
                raise RuntimeError("Invalid PNG generated from PDF")
            return struct.unpack(">II", sig[16:24])

        def esc_xml(s):
            return (str(s).replace("&", "&amp;").replace("<", "&lt;")
                    .replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;"))

        content_types = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            '<Default Extension="xml" ContentType="application/xml"/>',
            '<Default Extension="png" ContentType="image/png"/>',
            '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
            '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
            '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
            '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>']
        for i in range(1, len(pages) + 1):
            content_types.append(f'<Override PartName="/ppt/slides/slide{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
        content_types.append('</Types>')
        content_types = ''.join(content_types)

        root_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>'''

        pres_rels = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>']
        for i in range(1, len(pages) + 1):
            pres_rels.append(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{i}.xml"/>')
        pres_rels.append('</Relationships>')
        pres_rels = ''.join(pres_rels)

        slide_master_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>'''

        slide_layout_rels = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>'''

        theme = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="OmniConverter">
<a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Office"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>'''

        master = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld name="Omni Master"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>'''

        layout = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr><p:sldLayoutIdLst/></p:sldLayout>'''

        pres = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
            '<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">',
            '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>']
        for i in range(1, len(pages) + 1):
            pres.append(f'<p:sldId id="{255+i}" r:id="rId{i+1}"/>')
        pres.append('</p:sldIdLst><p:sldSz cx="9144000" cy="6858000" type="screen4x3"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle/><p:embeddedFontLst/></p:presentation>')
        pres = ''.join(pres)

        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("[Content_Types].xml", content_types)
            z.writestr("_rels/.rels", root_rels)
            z.writestr("ppt/presentation.xml", pres)
            z.writestr("ppt/_rels/presentation.xml.rels", pres_rels)
            z.writestr("ppt/slideMasters/slideMaster1.xml", master)
            z.writestr("ppt/slideMasters/_rels/slideMaster1.xml.rels", slide_master_rels)
            z.writestr("ppt/slideLayouts/slideLayout1.xml", layout)
            z.writestr("ppt/slideLayouts/_rels/slideLayout1.xml.rels", slide_layout_rels)
            z.writestr("ppt/theme/theme1.xml", theme)

            for i, page in enumerate(pages, 1):
                w, h = png_size(page)
                slide_rels = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{i}.png"/>
</Relationships>'''
                # Fit page inside a 4:3 slide while preserving aspect ratio.
                slide_w, slide_h = 9144000, 6858000
                scale = min(slide_w / w, slide_h / h)
                cx, cy = int(w * scale), int(h * scale)
                x, y = (slide_w - cx) // 2, (slide_h - cy) // 2
                slide = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
<p:cSld name="Page {i}"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:pic><p:nvPicPr><p:cNvPr id="2" name="PDF page {i}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
</p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'''
                z.writestr(f"ppt/slides/slide{i}.xml", slide)
                z.writestr(f"ppt/slides/_rels/slide{i}.xml.rels", slide_rels)
                z.write(page, f"ppt/media/image{i}.png")
    finally:
        shutil.rmtree(work, ignore_errors=True)


# ---------------- Local AI provider bridge ----------------
AI_PROVIDER = os.environ.get("OMNI_AI_PROVIDER", "auto").strip().lower()
OLLAMA_URL = os.environ.get("OMNI_OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
LMSTUDIO_URL = os.environ.get("OMNI_LMSTUDIO_URL", "http://127.0.0.1:1234").rstrip("/")
AI_MODEL = os.environ.get("OMNI_AI_MODEL", "").strip()
AI_TIMEOUT = int(os.environ.get("OMNI_AI_TIMEOUT", "300"))

def _ai_http(url, payload=None, timeout=10):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json","Accept":"application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def _local_ai_status():
    providers=[]
    try:
        x=_ai_http(OLLAMA_URL+"/api/tags", timeout=2)
        models=[m.get("name") for m in x.get("models",[]) if m.get("name")]
        providers.append({"provider":"ollama","available":True,"url":OLLAMA_URL,"models":models})
    except Exception as e:
        providers.append({"provider":"ollama","available":False,"url":OLLAMA_URL,"models":[],"error":str(e)})
    try:
        x=_ai_http(LMSTUDIO_URL+"/v1/models", timeout=2)
        models=[m.get("id") for m in x.get("data",[]) if m.get("id")]
        providers.append({"provider":"lmstudio","available":True,"url":LMSTUDIO_URL,"models":models})
    except Exception as e:
        providers.append({"provider":"lmstudio","available":False,"url":LMSTUDIO_URL,"models":[],"error":str(e)})
    preferred=AI_PROVIDER
    selected=None
    if preferred in ("ollama","lmstudio"):
        selected=next((p for p in providers if p["provider"]==preferred and p["available"]),None)
    elif preferred=="auto":
        selected=next((p for p in providers if p["available"]),None)
    return {"enabled":bool(selected),"provider":selected["provider"] if selected else None,"model":AI_MODEL or ((selected["models"][0] if selected and selected["models"] else None)), "providers":providers, "local_only":True}

def _ai_select():
    s=_local_ai_status()
    if not s["enabled"]: raise RuntimeError("No local AI provider is running. Start Ollama or LM Studio, load a model, then try again.")
    return s

def _ai_chat(messages, model=None, temperature=0.1, max_tokens=512):
    s=_ai_select(); provider=s["provider"]; model=model or AI_MODEL or s["model"]
    if not model: raise RuntimeError("Local AI provider is running but no model is loaded.")
    if provider=="ollama":
        # Ollama's chat API carries images in a message-level "images" array.
        ollama_messages=[]
        for m in messages:
            content=m.get("content","")
            images=[]
            if isinstance(content,list):
                text_parts=[]
                for part in content:
                    if isinstance(part,dict) and part.get("type")=="text":
                        text_parts.append(str(part.get("text","")))
                    elif isinstance(part,dict) and part.get("type")=="image_url":
                        u=((part.get("image_url") or {}).get("url") or "")
                        if u: images.append(u.split(",",1)[-1])
                content="\n".join(text_parts)
            item={"role":m.get("role","user"),"content":str(content)}
            if images: item["images"]=images
            ollama_messages.append(item)
        payload={"model":model,"messages":ollama_messages,"stream":False,"options":{"temperature":temperature,"num_predict":max_tokens}}
        out=_ai_http(OLLAMA_URL+"/api/chat",payload,AI_TIMEOUT)
        return {"text":str(out.get("message",{}).get("content","")).strip(),"provider":provider,"model":model}
    payload={"model":model,"messages":messages,"temperature":temperature,"max_tokens":max_tokens,"stream":False}
    out=_ai_http(LMSTUDIO_URL+"/v1/chat/completions",payload,AI_TIMEOUT)
    text=str((out.get("choices") or [{}])[0].get("message",{}).get("content","")).strip()
    return {"text":text,"provider":provider,"model":model}

def _ai_embed(text, model=None):
    s=_ai_select(); provider=s["provider"]; model=model or AI_MODEL or s["model"]
    if provider=="ollama":
        out=_ai_http(OLLAMA_URL+"/api/embed",{"model":model,"input":[str(text)]},AI_TIMEOUT)
        vec=(out.get("embeddings") or [[]])[0]
    else:
        out=_ai_http(LMSTUDIO_URL+"/v1/embeddings",{"model":model,"input":[str(text)]},AI_TIMEOUT)
        vec=((out.get("data") or [{}])[0]).get("embedding",[])
    if not vec: raise RuntimeError("Local provider returned no embedding. Load an embedding-capable model or use retrieval-only mode.")
    return {"vector":vec,"provider":provider,"model":model}

def local_ai_capabilities():
    s=_local_ai_status()
    return {"provider":s["provider"],"model":s["model"],"available":s["enabled"],"local_only":True,"providers":s["providers"]}

def process_job(payload):
    op = payload.get("op")
    if op == "ai_status":
        return {"ok": True, "ai": local_ai_capabilities()}

    if op == "ai_chat":
        messages=payload.get("messages") or [{"role":"user","content":str(payload.get("prompt",""))}]
        return {"ok":True, **_ai_chat(messages, payload.get("model"), float(payload.get("temperature",0.1)), int(payload.get("max_tokens",512)))}

    if op == "ai_embed":
        return {"ok":True, **_ai_embed(str(payload.get("text","")), payload.get("model"))}

    if op == "ai_generate":
        prompt=str(payload.get("prompt",""))
        image=payload.get("image_data_url")
        user_content=prompt
        if image:
            user_content=[{"type":"text","text":prompt},{"type":"image_url","image_url":{"url":image}}]
        messages=[{"role":"system","content":"You are Omni Suite AI Assist. Use only the supplied Studio context. Never invent facts. Be concise, practical and accurate."},{"role":"user","content":user_content}]
        return {"ok":True, **_ai_chat(messages, None, float(payload.get("temperature",0.2)), int(payload.get("max_tokens",220)))}

    if op == "health":
        return {"ok": True, "engine_api_version": ENGINE_API_VERSION, "engine_build": ENGINE_BUILD, "platform": platform.platform(), "python": platform.python_version(), "tools": tool_versions(), "python_modules": omni_data_engine.module_status(), "doctor": omni_platform.doctor(), "capability_engine": {"version": 1, "supported_modes": ["browser","browser-first","local","unknown"], "ai": local_ai_capabilities()}, "capabilities": {"media_video": ["mp4","mkv","webm","mov","avi","flv","mpeg","mpg","m4v","3gp","3g2","ts","m2ts","mts","vob","wmv","asf","ogv","nut","mxf","ivf","gif","apng"], "media_audio": ["mp3","wav","m4a","aac","flac","ogg","oga","opus","wma","amr","aiff","aif","aifc","ac3","eac3","au","caf","w64","wv","tta","ape","mka"], "image": ["jpg","jpeg","jpe","jfif","png","apng","webp","avif","tiff","tif","bmp","gif","svg","ico","heic","heif","jxl","jp2","j2k","j2c","jng","tga","dds","exr","hdr","dpx","eps","eps3","ps","pdf","pnm","ppm","pgm","pbm","pam","pcx","miff","mvg","ora","psd","xcf","fits","flif","bpg"], "office": ["pdf","docx","doc","docm","dot","dotx","dotm","odt","ott","fodt","rtf","txt","md","html","htm","epub","xls","xlsx","xlsm","xlsb","xlt","xltx","xltm","ods","ots","fods","csv","tsv","sylk","dif","ppt","pptx","pptm","pps","ppsx","pot","potx","potm","odp","otp","fodp","sxi","key"], "ebook": ["azw","azw3","azw4","cbz","cbr","cb7","cbc","chm","djvu","docx","epub","fb2","fbz","html","htmlz","kepub","lit","lrf","mobi","odt","pdf","prc","pdb","pml","rb","rtf","snb","tcr","txt","txz","zip","oeb","pmlz"], "archive": ["zip","tar","gz","bz2","xz","7z"], "archive_extract": ["7z","rar"], "language_translation": omni_language_engine.capability().get("translation", []), "language_transliteration": omni_language_engine.capability().get("transliteration", []), "scientific": ["fits","fit","netcdf","nc","hdf5","h5","cdf","grib","grib2","grb","grb2"]}, "data": {"formats": sorted(omni_data_engine.DATA_FORMATS | {"jsonschema"}), "modules": omni_data_engine.module_status(), "sql_dialects": omni_data_engine.SQL_DIALECTS}}

    if op == "code_capabilities":
        return {"ok": True, "languages": omni_code_runner.available_languages()}

    if op == "code_execute":
        return omni_code_runner.execute(
            str(payload.get("language", "")),
            str(payload.get("source", "")),
            str(payload.get("stdin", "")),
            int(payload.get("timeout", 8)),
        )

    if op == "doctor":
        return {"ok": True, "doctor": omni_platform.doctor()}

    if op == "capability":
        return {"ok": True, "capability": omni_platform.capability(payload.get("source_format") or payload.get("source"), payload.get("format") or payload.get("target"))}

    if op == "privacy_scan":
        inp=get_file(payload["input"])
        report=omni_platform.privacy_scan(inp, int(payload.get("max_bytes", 8000000)))
        out=output_path(inp.stem+"_privacy","json"); out.write_text(json.dumps(report,indent=2),encoding="utf-8")
        return file_result(out,out.name,"application/json")

    if op == "data_clean":
        inp=get_file(payload["input"])
        source=omni_data_engine.ext(inp,payload.get("source_format"))
        df=omni_data_engine.read_data(inp,source,payload.get("table"))
        df=omni_platform.clean_dataframe(df,payload.get("actions",[]))
        target=str(payload.get("format",source)).lower().lstrip(".")
        if target not in (omni_data_engine.DATA_FORMATS | {"jsonschema"}): raise ValueError("Unsupported Data Cleaning output format")
        out=output_path(inp.stem+"_cleaned",target); omni_data_engine.write_data(df,out,target,payload.get("table","data"),payload.get("dialect","sqlite"))
        return file_result(out,out.name)

    if op == "batch_convert":
        inputs=list(payload.get("inputs",[]))
        if not inputs: raise ValueError("No input files supplied")
        delegated_op=str(payload.get("job_op") or payload.get("operation") or "data_convert").strip()
        if delegated_op not in {"data_convert","privacy_scan","data_clean"}:
            raise ValueError("Unsupported batch operation")
        base={k:v for k,v in payload.items() if k not in {"op","inputs","job_op","operation"}}
        results=[]
        for fid in inputs:
            item={"op":delegated_op,"input":fid,**base}
            try:
                result=process_job(item)
                results.append({"ok":True,"input":fid,"output":result.get("file_id"),"name":result.get("name"),"payload":item})
            except Exception as exc:
                results.append({"ok":False,"input":fid,"error":str(exc),"payload":item})
        manifest=omni_platform.batch_manifest(results)
        out=output_path("omni_batch_manifest","json"); out.write_text(json.dumps(manifest,indent=2),encoding="utf-8")
        return file_result(out,out.name,"application/json")

    if op == "database_tables":
        return omni_platform.database_tables(str(payload["url"]))

    if op == "database_query":
        result=omni_platform.database_query(str(payload["url"]),str(payload["query"]),payload.get("params"))
        out=output_path("database_query","json"); out.write_text(json.dumps(result,indent=2,default=str),encoding="utf-8")
        return file_result(out,out.name,"application/json")

    if op == "social_download":
        url = str(payload.get("url", "")).strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError("Only HTTP/HTTPS media URLs are supported")
        try:
            import yt_dlp
        except Exception as exc:
            raise RuntimeError("yt-dlp is not installed. Relaunch the Omni Suite Local Engine setup to install the Social Media Downloader.") from exc

        mode = str(payload.get("mode", "best")).lower()
        quality = str(payload.get("quality", "best")).lower()
        info_only = bool(payload.get("info_only", False))
        work = ROOT / new_id("social")
        work.mkdir(parents=True, exist_ok=True)
        try:
            common = {
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "restrictfilenames": True,
                "outtmpl": str(work / "%(title).180B [%(id)s].%(ext)s"),
            }
            if info_only:
                common.update({"skip_download": True})
                with yt_dlp.YoutubeDL(common) as ydl:
                    info = ydl.extract_info(url, download=False)
                if info.get("_type") == "playlist":
                    entries = [e for e in (info.get("entries") or []) if e]
                    info = entries[0] if entries else info
                formats = []
                for f in (info.get("formats") or []):
                    if f.get("vcodec") != "none" or f.get("acodec") != "none":
                        formats.append({
                            "format_id": f.get("format_id"),
                            "ext": f.get("ext"),
                            "height": f.get("height"),
                            "fps": f.get("fps"),
                            "filesize": f.get("filesize") or f.get("filesize_approx"),
                            "has_video": f.get("vcodec") not in (None, "none"),
                            "has_audio": f.get("acodec") not in (None, "none"),
                        })
                return {
                    "ok": True,
                    "title": info.get("title") or "Untitled media",
                    "uploader": info.get("uploader") or info.get("channel") or "",
                    "thumbnail": info.get("thumbnail") or "",
                    "duration": info.get("duration"),
                    "webpage_url": info.get("webpage_url") or url,
                    "extractor": info.get("extractor_key") or info.get("extractor") or "generic",
                    "is_live": bool(info.get("is_live")),
                    "formats": formats[-80:],
                }

            if mode == "audio":
                common["format"] = "bestaudio/best"
                common["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}]
            elif quality in {"1080", "720", "480", "360"}:
                common["format"] = f"bv*[height<={quality}]+ba/b[height<={quality}]/b"
                common["merge_output_format"] = "mp4"
            else:
                common["format"] = "bv*+ba/b"
                common["merge_output_format"] = "mp4"

            with yt_dlp.YoutubeDL(common) as ydl:
                ydl.extract_info(url, download=True)

            candidates = [p for p in work.rglob("*") if p.is_file()]
            if not candidates:
                raise RuntimeError("The extractor found no downloadable media for this URL.")
            # Prefer the largest completed media file and ignore transient partial files.
            candidates = [p for p in candidates if not p.name.endswith((".part", ".ytdl"))]
            if not candidates:
                raise RuntimeError("Download did not complete.")
            out = max(candidates, key=lambda p: p.stat().st_size)
            final = output_path(out.stem, out.suffix.lstrip(".") or "bin")
            shutil.copy2(out, final)
            return file_result(final, final.name)
        except Exception as exc:
            raise RuntimeError(f"Social Media Downloader: {exc}") from exc
        finally:
            shutil.rmtree(work, ignore_errors=True)

    if op == "media":
        require_tool("ffmpeg")
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "mp4")).lower().lstrip(".")
        allowed = {"mp4","mkv","webm","mov","avi","flv","mpeg","mpg","m4v","3gp","3g2","ts","m2ts","mts","vob","wmv","asf","ogv","nut","mxf","ivf","mp3","wav","m4a","aac","flac","ogg","oga","opus","wma","amr","aiff","aif","aifc","ac3","eac3","au","caf","w64","wv","tta","ape","mka","gif","apng"}
        if fmt not in allowed:
            raise ValueError("Unsupported media output format")
        out = output_path(inp.stem, fmt)
        cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
        start = payload.get("start")
        end = payload.get("end")
        if start is not None:
            cmd += ["-ss", str(float(start))]
        cmd += ["-i", str(inp)]
        if end is not None and start is not None:
            cmd += ["-t", str(max(0.01, float(end)-float(start)))]
        if payload.get("audio_only"):
            cmd += ["-vn"]
        if payload.get("video_only"):
            cmd += ["-an"]
        if payload.get("scale"):
            cmd += ["-vf", f"scale={int(payload['scale'])}:-2"]
        if fmt in {"mp3","aac","m4a","flac","ogg","opus","wav"}:
            cmd += ["-vn"] if not payload.get("keep_video") else []
        cmd += [str(out)]
        run(cmd)
        return file_result(out, inp.stem + "." + fmt)

    if op == "pdf_merge":
        require_tool("qpdf")
        inputs = [get_file(x) for x in payload.get("inputs", [])]
        if not inputs:
            raise ValueError("No PDF inputs")
        out = output_path("merged", "pdf")
        # qpdf page selection syntax preserves pages without loading all PDFs into Python memory.
        cmd = ["qpdf", "--empty", "--pages"] + [str(p) for p in inputs] + ["--", str(out)]
        run(cmd)
        return file_result(out, "merged.pdf")

    if op == "pdf_split":
        require_tool("qpdf")
        inp = get_file(payload["input"])
        work = ROOT / new_id("split")
        work.mkdir()
        prefix = work / "page"
        run(["qpdf", str(inp), "--split-pages", str(prefix) + "-%d.pdf"])
        archive = output_path(inp.stem + "_pages", "zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(work.glob("page-*.pdf")):
                z.write(p, p.name)
        shutil.rmtree(work, ignore_errors=True)
        return file_result(archive, archive.name)

    if op == "pdf_compress":
        require_tool("qpdf")
        inp = get_file(payload["input"])
        out = output_path(inp.stem + "_compressed", "pdf")
        run(["qpdf", "--stream-data=compress", "--object-streams=generate", "--compression-level=9", str(inp), str(out)])
        return file_result(out, out.name)

    if op == "pdf_render":
        require_tool("pdftoppm")
        inp = get_file(payload["input"])
        work = ROOT / new_id("render")
        work.mkdir()
        prefix = work / "page"
        dpi = int(payload.get("dpi", 150))
        run(["pdftoppm", "-r", str(max(36, min(600, dpi))), "-png", str(inp), str(prefix)])
        archive = output_path(inp.stem + "_rendered", "zip")
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_STORED) as z:
            for p in sorted(work.glob("page-*.png")):
                z.write(p, p.name)
        shutil.rmtree(work, ignore_errors=True)
        return file_result(archive, archive.name)

    if op == "image":
        magick = tool_path("magick") or tool_path("convert")
        if not magick:
            raise RuntimeError("ImageMagick is not installed. Run the platform installer.")
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "jpg")).lower().lstrip(".")
        allowed = {"jpg","jpeg","jpe","jfif","png","apng","webp","avif","tiff","tif","bmp","gif","svg","ico","heic","heif","jxl","jp2","j2k","j2c","jng","tga","dds","exr","hdr","dpx","eps","eps3","ps","pdf","pnm","ppm","pgm","pbm","pam","pcx","miff","mvg","ora","psd","xcf","fits","flif","bpg"}
        if fmt not in allowed:
            raise ValueError("Unsupported image output format")
        out = output_path(inp.stem, "jpg" if fmt == "jpeg" else fmt)

        # SVG -> PNG gets an explicit librsvg path. This avoids relying on
        # ImageMagick's optional SVG delegate configuration.
        if inp.suffix.lower() == ".svg" and fmt == "png":
            rsvg = tool_path("rsvg-convert")
            if rsvg:
                rsvg_cmd = [rsvg]
                if payload.get("width"):
                    rsvg_cmd += ["--width", str(max(1, int(payload["width"])))]
                if payload.get("height"):
                    rsvg_cmd += ["--height", str(max(1, int(payload["height"])))]
                if payload.get("density"):
                    dpi = max(1, int(payload["density"]))
                    rsvg_cmd += ["--dpi-x", str(dpi), "--dpi-y", str(dpi)]
                rsvg_cmd += ["--output", str(out), str(inp)]
                try:
                    run(rsvg_cmd)
                    return file_result(out, out.name)
                except RuntimeError:
                    out.unlink(missing_ok=True)
                    # ImageMagick remains the compatibility fallback.

        cmd = [magick, str(inp)]
        if payload.get("width") or payload.get("height"):
            w = str(int(payload["width"])) if payload.get("width") else ""
            h = str(int(payload["height"])) if payload.get("height") else ""
            cmd += ["-resize", f"{w}x{h}>"]
        if payload.get("density"):
            cmd += ["-density", str(int(payload["density"]))]
        if payload.get("quality") is not None and fmt in {"jpg","jpeg","webp","avif"}:
            cmd += ["-quality", str(max(1, min(100, int(payload["quality"]))))]
        if payload.get("strip", True):
            cmd += ["-strip"]
        cmd += [str(out)]
        run(cmd)
        return file_result(out, out.name)

    if op == "ocr":
        require_tool("tesseract")
        inp = get_file(payload["input"])
        lang = str(payload.get("lang", "eng"))
        outbase = ROOT / new_id("ocr")
        cmd = ["tesseract", str(inp), str(outbase), "-l", lang, "--oem", "1"]
        run(cmd, timeout=3600)
        txt = Path(str(outbase) + ".txt")
        if not txt.exists():
            raise RuntimeError("Tesseract completed without producing text")
        out = ROOT / (safe_name(inp.stem) + "_ocr.txt")
        shutil.move(str(txt), str(out))
        return file_result(out, out.name, "text/plain")

    if op == "pdf_to_ppt":
        inp = get_file(payload["input"])
        out = output_path(inp.stem + "_presentation", "pptx")
        build_pdf_pptx(inp, out, int(payload.get("dpi", 120)))
        return file_result(out, out.name)

    if op == "text_document":
        office = tool_path("soffice") or tool_path("libreoffice")
        if not office:
            raise RuntimeError("LibreOffice is required for Unicode-safe local DOCX/PDF generation.")
        title=safe_name(str(payload.get("title","Omni Document")),"document")
        text=str(payload.get("text",""))
        if not text.strip() and payload.get("input"):
            src=get_file(payload["input"])
            text=src.read_text(encoding="utf-8-sig",errors="replace")
            if not payload.get("title"): payload["title"]=src.stem
        target=str(payload.get("format","pdf")).lower().lstrip(".")
        if target not in {"pdf","docx","odt","rtf","txt"}:
            raise ValueError("Text document target must be PDF, DOCX, ODT, RTF or TXT")
        work=ROOT/new_id("textdoc"); work.mkdir()
        html=work/"document.html"
        import html as _html
        paragraphs=[]
        for raw in text.replace("\r","").split("\n"):
            if not raw.strip():
                paragraphs.append("<p>&nbsp;</p>")
            elif raw.startswith("### "):
                paragraphs.append("<h3>"+_html.escape(raw[4:])+"</h3>")
            elif raw.startswith("## "):
                paragraphs.append("<h2>"+_html.escape(raw[3:])+"</h2>")
            elif raw.startswith("# "):
                paragraphs.append("<h1>"+_html.escape(raw[2:])+"</h1>")
            else:
                paragraphs.append("<p>"+_html.escape(raw)+"</p>")
        html.write_text('<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:"Noto Sans","Noto Sans Devanagari","Segoe UI",sans-serif;margin:2cm;font-size:11pt}h1{font-size:20pt}h2{font-size:16pt}h3{font-size:13pt}p{line-height:1.45;margin:0 0 8pt}</style></head><body><h1>'+_html.escape(str(payload.get("title","Omni Document")))+"</h1>"+''.join(paragraphs)+"</body></html>",encoding="utf-8")
        if target=="txt":
            out=output_path(title,"txt"); out.write_text(text,encoding="utf-8")
        else:
            run([office,"--headless","--convert-to",target,"--outdir",str(work),str(html)],timeout=3600)
            produced=[p for p in work.iterdir() if p.is_file() and p.name!="document.html"]
            if not produced:
                raise RuntimeError("LibreOffice did not produce the requested document.")
            out=output_path(title,target); shutil.move(str(produced[0]),str(out))
        shutil.rmtree(work,ignore_errors=True)
        return file_result(out,out.name)

    if op == "office_convert":
        office = tool_path("soffice") or tool_path("libreoffice")
        if not office:
            raise RuntimeError("LibreOffice is not installed. Run the platform installer.")
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "pdf")).lower().lstrip(".")
        allowed = {"pdf","docx","doc","docm","dot","dotx","dotm","odt","ott","fodt","rtf","txt","md","html","htm","epub","xls","xlsx","xlsm","xlsb","xlt","xltx","xltm","ods","ots","fods","csv","tsv","sylk","dif","ppt","pptx","pptm","pps","ppsx","pot","potx","potm","odp","otp","fodp","sxi","key"}
        if fmt not in allowed:
            raise ValueError("Unsupported Office output format")
        work = ROOT / new_id("office")
        work.mkdir()
        run([office, "--headless", "--convert-to", fmt, "--outdir", str(work), str(inp)], timeout=3600)
        outputs = list(work.glob("*"))
        if not outputs:
            shutil.rmtree(work, ignore_errors=True)
            raise RuntimeError("LibreOffice did not produce an output file")
        out = output_path(inp.stem, outputs[0].suffix.lstrip(".") or fmt)
        shutil.move(str(outputs[0]), str(out))
        shutil.rmtree(work, ignore_errors=True)
        return file_result(out, out.name)

    if op == "ebook_convert":
        ebook = tool_path("ebook-convert")
        if not ebook:
            raise RuntimeError("Calibre ebook-convert is not installed. Run the platform installer.")
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "pdf")).lower().lstrip(".")
        allowed = {"azw","azw3","azw4","cbz","cbr","cb7","cbc","chm","djvu","docx","epub","fb2","fbz","html","htmlz","kepub","lit","lrf","mobi","odt","pdf","prc","pdb","pml","rb","rtf","snb","tcr","txt","txz","zip","oeb","pmlz"}
        if fmt not in allowed:
            raise ValueError("Unsupported ebook output format")
        out = output_path(inp.stem, fmt)
        run([ebook, str(inp), str(out)], timeout=7200)
        return file_result(out, out.name)

    if op == "pdf_to_docx":
        require_tool("pdftotext")
        inp=get_file(payload["input"])
        work=ROOT/new_id("pdfdocx"); work.mkdir()
        txt=work/"extracted.txt"
        run([tool_path("pdftotext"),"-layout",str(inp),str(txt)],timeout=3600)
        text=txt.read_text(encoding="utf-8",errors="replace")
        result=process_job({"op":"text_document","title":inp.stem,"text":text,"format":"docx"})
        shutil.rmtree(work,ignore_errors=True)
        return result

    if op == "pdf_to_text":
        pdftotext = tool_path("pdftotext")
        if not pdftotext:
            raise RuntimeError("Poppler pdftotext is not installed. Run the platform installer.")
        inp = get_file(payload["input"])
        out = output_path(inp.stem + "_text", "txt")
        run([pdftotext, "-layout", str(inp), str(out)], timeout=3600)
        return file_result(out, out.name, "text/plain")

    if op == "scientific_profile":
        inp=get_file(payload["input"])
        report=omni_data_engine.scientific_profile(inp,payload.get("source_format"))
        out=output_path(inp.stem+"_scientific_profile","json")
        out.write_text(json.dumps(report,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
        return file_result(out,out.name,"application/json")

    if op == "scientific_convert":
        inp=get_file(payload["input"])
        target=str(payload.get("format","json")).lower().lstrip(".")
        allowed={"json","csv","png","netcdf","nc","hdf5","h5","fits"}
        if target not in allowed:
            raise ValueError("Scientific output must be JSON, CSV, PNG, NetCDF, HDF5 or FITS")
        ext=target
        out=output_path(inp.stem+"_scientific",ext)
        omni_data_engine.scientific_convert(inp,out,target,payload.get("source_format"),int(payload.get("max_rows",2000000)))
        return file_result(out,out.name)

    if op == "data_convert":
        inp=get_file(payload["input"])
        source=omni_data_engine.ext(inp,payload.get("source_format"))
        target=str(payload.get("format","csv")).lower().lstrip(".")
        if source not in omni_data_engine.DATA_FORMATS or target not in (omni_data_engine.DATA_FORMATS | {"jsonschema"}):
            raise ValueError("Unsupported Data Studio format")
        df=omni_data_engine.read_data(inp,source,payload.get("table"))
        out=output_path(inp.stem,target)
        omni_data_engine.write_data(df,out,target,payload.get("table","data"),payload.get("dialect","sqlite"))
        return file_result(out,out.name)

    if op == "blob_convert":
        inp=get_file(payload["input"])
        source=str(payload.get("source","binary")); target=str(payload.get("target","base64"))
        ext_out={"binary":"bin","base64":"b64","hex":"hex","sql":"sql"}.get(target,target)
        out=output_path(inp.stem+"_blob",ext_out)
        omni_data_engine.blob_convert(inp,out,source,target)
        return file_result(out,out.name)

    if op == "text_lines":
        inp=get_file(payload["input"]); target=str(payload.get("target","jsonl"))
        out=output_path(inp.stem+"_lines",target)
        out.write_text(omni_data_engine.text_lines(inp,target),encoding="utf-8")
        return file_result(out,out.name)

    if op == "data_profile":
        inp=get_file(payload["input"])
        report=omni_data_engine.profile(inp,omni_data_engine.ext(inp,payload.get("source_format")),payload.get("table"))
        out=output_path(inp.stem+"_profile","json")
        out.write_text(json.dumps(report,indent=2),encoding="utf-8")
        return file_result(out,out.name,"application/json")

    if op == "sql_transpile":
        inp=get_file(payload["input"])
        text=inp.read_text(encoding="utf-8-sig",errors="replace")
        result=omni_data_engine.transpile_sql(text,str(payload.get("source","sqlite")),str(payload.get("target","postgres")))
        out=output_path(inp.stem+"_transpiled","sql")
        out.write_text(result,encoding="utf-8")
        return file_result(out,out.name,"application/sql")

    if op == "schema_generate":
        inp=get_file(payload["input"])
        result=omni_data_engine.schema(inp,omni_data_engine.ext(inp,payload.get("source_format")),str(payload.get("dialect","postgres")),safe_name(payload.get("table","data"),"data"))
        out=output_path(inp.stem+"_schema","sql")
        out.write_text(result,encoding="utf-8")
        return file_result(out,out.name,"application/sql")

    if op == "nosql_convert":
        inp=get_file(payload["input"])
        target=str(payload.get("target","json"))
        out=output_path(inp.stem+"_nosql",target)
        omni_data_engine.nosql_convert(inp,out,str(payload.get("source","json")),target)
        return file_result(out,out.name)

    if op == "language_capability":
        return {"ok": True, "language_engine": omni_language_engine.config()}

    if op == "language_translate":
        result = omni_language_engine.translate(
            str(payload.get("text", "")),
            str(payload.get("source", "")),
            str(payload.get("target", "")),
            int(payload.get("max_new_tokens", 512)),
        )
        return {"ok": True, **result}

    if op == "language_transliterate":
        result = omni_language_engine.transliterate(
            str(payload.get("text", "")),
            str(payload.get("source", "")),
            str(payload.get("target", "Latn")),
            int(payload.get("topk", 4)),
        )
        return {"ok": True, **result}

    if op == "archive_extract":
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "")).lower().lstrip(".")
        if fmt not in {"7z", "rar"}:
            raise ValueError("Archive extraction supports only 7z and RAR")
        native7z = shutil.which("7z") or shutil.which("7zz")
        if not native7z:
            raise RuntimeError("7-Zip executable (7z/7zz) is required for 7z/RAR extraction.")
        with tempfile.TemporaryDirectory(prefix="omni_archive_extract_") as tmp:
            out_dir = Path(tmp)
            run([native7z, "x", "-y", f"-o{out_dir}", str(inp)], timeout=3600)
            out = output_path(inp.stem + "_extracted", "zip")
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
                for path in out_dir.rglob("*"):
                    if not path.is_file():
                        continue
                    rel = path.relative_to(out_dir)
                    if any(part in {"", ".", ".."} for part in rel.parts):
                        continue
                    z.write(path, str(rel))
        return file_result(out, out.name)

    if op == "archive":
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "zip")).lower().lstrip(".")
        allowed = {"zip","tar","gz","bz2","xz","7z"}
        if fmt not in allowed:
            raise ValueError("Unsupported archive output format")
        if fmt == "zip":
            out = output_path(inp.stem, "zip")
            with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
                z.write(inp, safe_name(inp.name))
        elif fmt == "tar":
            out = output_path(inp.stem, "tar")
            with tarfile.open(out, "w") as t:
                t.add(inp, arcname=safe_name(inp.name))
        elif fmt == "gz":
            out = output_path(inp.stem, "gz")
            with open(inp, "rb") as src, gzip.open(out, "wb", compresslevel=9) as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        elif fmt == "bz2":
            out = output_path(inp.stem, "bz2")
            with open(inp, "rb") as src, bz2.open(out, "wb", compresslevel=9) as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        elif fmt == "xz":
            out = output_path(inp.stem, "xz")
            with open(inp, "rb") as src, lzma.open(out, "wb", preset=9) as dst:
                shutil.copyfileobj(src, dst, 1024 * 1024)
        else:
            out = output_path(inp.stem, "7z")
            native7z = shutil.which("7z") or shutil.which("7zz")
            if native7z:
                run([native7z, "a", "-y", str(out), str(inp)], timeout=3600)
            else:
                try:
                    import py7zr
                except Exception as exc:
                    raise RuntimeError("7-Zip output requires the 7z/7zz executable or the optional py7zr package.") from exc
                with py7zr.SevenZipFile(out, "w") as archive:
                    archive.write(inp, arcname=safe_name(inp.name))
        return file_result(out, out.name)

    if op == "zip":
        inputs = [get_file(x) for x in payload.get("inputs", [])]
        if not inputs:
            raise ValueError("No files to archive")
        out = output_path("archive", "zip")
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for p in inputs:
                z.write(p, safe_name(p.name))
        return file_result(out, out.name)

    if op == "gzip":
        inp = get_file(payload["input"])
        out = output_path(inp.stem, "gz")
        with open(inp, "rb") as src, gzip.open(out, "wb", compresslevel=9) as dst:
            shutil.copyfileobj(src, dst, 1024 * 1024)
        return file_result(out, out.name)

    raise ValueError(f"Unknown operation: {op}")

def file_result(path, name, mime=None):
    fid = register(path)
    return {"ok": True, "file_id": fid, "name": name, "size": path.stat().st_size, "mime": mime or mimetypes.guess_type(name)[0] or "application/octet-stream"}

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OmniEngine/1.0"

    def log_message(self, fmt, *args):
        print("[OmniEngine]", fmt % args, flush=True)

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        origin = cors_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename,X-Omni-Token")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if not host_allowed(self):
            self.send_json({"ok": False, "error": "Host not allowed"}, 403)
            return
        self.send_response(204)
        origin = cors_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename,X-Omni-Token")
        self.end_headers()

    def serve_static(self, parsed_path):
        root = Path(__file__).resolve().parent
        rel = urllib.parse.unquote(parsed_path.lstrip("/"))
        if not rel or rel.endswith("/"):
            rel = "index.html"
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_json({"ok":False,"error":"Forbidden"},403)
            return True
        if not target.is_file():
            return False

        data = None
        if target.name == "index.html":
            data = target.read_bytes()
            vendor = root / "vendor"
            local_ready = (
                (vendor / "pdfjs/pdf.min.js").is_file()
                and (vendor / "pdfjs/pdf.worker.min.js").is_file()
                and (vendor / "jszip/jszip.min.js").is_file()
                and (vendor / "pdf-lib/pdf-lib.min.js").is_file()
                and (vendor / "tesseract/tesseract.min.js").is_file()
                and (vendor / "tesseract/worker.min.js").is_file()
                and (vendor / "tesseract/core/tesseract-core.wasm.js").is_file()
                and (vendor / "tesseract/core/tesseract-core-simd.wasm.js").is_file()
                and (vendor / "sheetjs/xlsx.full.min.js").is_file()
                and (vendor / "jsyaml/js-yaml.min.js").is_file()
                and all((vendor / "tesseract/lang" / f"{lang}.traineddata.gz").is_file() for lang in ("eng","hin","ben","mar","tam","tel","guj","pan","deu","fra","spa","chi_sim"))
            )
            if local_ready:
                html = data.decode("utf-8")
                html = html.replace(
                    "./vendor/sheetjs/xlsx.full.min.js", "./vendor/sheetjs/xlsx.full.min.js"
                ).replace(
                    "./vendor/jsyaml/js-yaml.min.js", "./vendor/jsyaml/js-yaml.min.js"
                ).replace(
                    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
                    "./vendor/pdfjs/pdf.min.js"
                ).replace(
                    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
                    "./vendor/jszip/jszip.min.js"
                ).replace(
                    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
                    "./vendor/pdf-lib/pdf-lib.min.js"
                ).replace(
                    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
                    "./vendor/tesseract/tesseract.min.js"
                ).replace(
                    "window.OMNI_PDF_WORKER || 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'",
                    "'./vendor/pdfjs/pdf.worker.min.js'"
                )
                html = html.replace(
                    '<head>',
                    '<head><script>window.OMNI_PDF_WORKER="./vendor/pdfjs/pdf.worker.min.js";window.OMNI_TESSERACT_OPTIONS={workerPath:"./vendor/tesseract/worker.min.js",langPath:"./vendor/tesseract/lang/",corePath:"./vendor/tesseract/core/",workerBlobURL:false};</script>',
                    1
                )
                data = html.encode("utf-8")
        if data is None:
            size = target.stat().st_size
        else:
            size = len(data)

        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if target.suffix.lower() == ".js":
            ctype = "application/javascript"
        if target.suffix.lower() == ".wasm":
            ctype = "application/wasm"
        if target.name == "index.html" and data is not None:
            html = data.decode("utf-8")
            html = html.replace("</head>", "<script>window.OMNI_TOKEN=" + json.dumps(TOKEN) + ";</script></head>", 1)
            data = html.encode("utf-8")
            size = len(data)
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        origin = cors_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        if data is not None:
            self.wfile.write(data)
        else:
            with open(target,"rb") as src:
                while True:
                    chunk=src.read(1024*1024)
                    if not chunk: break
                    self.wfile.write(chunk)
        return True

    def do_GET(self):
        cleanup_old()
        if not host_allowed(self):
            self.send_json({"ok": False, "error": "Host not allowed"}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path not in ("/api/health",) and not parsed.path.startswith("/api/"):
            if self.serve_static(parsed.path):
                return
        if parsed.path == "/api/ai/status":
            if not origin_allowed(self):
                self.send_json({"ok":False,"error":"Origin not allowed"},403); return
            s=local_ai_capabilities(); s["token"]=TOKEN; self.send_json({"ok":True, **s}); return
        if parsed.path in ("/", "/api/health"):
            if not origin_allowed(self):
                self.send_json({"ok": False, "error": "Origin not allowed"}, 403)
                return
            health = process_job({"op":"health"})
            # Never disclose the engine token to requests without an allowed browser Origin.
            if request_origin(self):
                health["token"] = TOKEN
            self.send_json(health)
            return
        if parsed.path.startswith("/api/download/"):
            if not authorize(self):
                return
            fid = parsed.path.rsplit("/", 1)[-1]
            try:
                p = get_file(fid)
                size = p.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
                self.send_header("Content-Disposition", f'attachment; filename="{safe_name(p.name)}"')
                self.send_header("Content-Length", str(size))
                origin = cors_origin(self)
                if origin:
                    self.send_header("Access-Control-Allow-Origin", origin)
                    self.send_header("Vary", "Origin")
                self.end_headers()
                with open(p, "rb") as src:
                    while True:
                        chunk = src.read(1024 * 1024)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)}, 404)
            return
        self.send_json({"ok":False,"error":"Not found"},404)

    def do_POST(self):
        cleanup_old()
        if not host_allowed(self):
            self.send_json({"ok": False, "error": "Host not allowed"}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/upload":
            if not authorize(self):
                return
            try:
                length = int(self.headers.get("Content-Length","0"))
                if length <= 0 or length > MAX_UPLOAD:
                    raise ValueError("Upload size is missing or exceeds local-engine limit")
                fid = new_id("u")
                name = safe_name(urllib.parse.unquote(self.headers.get("X-Filename","input.bin")))
                path = ROOT / f"{fid}_{name}"
                remaining = length
                with open(path, "wb") as f:
                    while remaining:
                        chunk = self.rfile.read(min(1024*1024, remaining))
                        if not chunk:
                            raise ValueError("Unexpected end of upload")
                        f.write(chunk)
                        remaining -= len(chunk)
                with LOCK:
                    FILES[fid] = path
                self.send_json({"ok":True,"file_id":fid,"name":name,"size":path.stat().st_size})
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)},400)
            return
        if parsed.path == "/api/process":
            if not authorize(self):
                return
            try:
                length = int(self.headers.get("Content-Length","0"))
                if length > 10*1024*1024:
                    raise ValueError("Job metadata is unexpectedly large")
                payload = json.loads(self.rfile.read(length) or b"{}")
                result = process_job(payload)
                self.send_json(result)
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)},400)
            return
        self.send_json({"ok":False,"error":"Not found"},404)

def main():
    print("OmniConverter Local Engine")
    print(f"Local UI: http://{HOST}:{PORT}/")
    print(f"API:      http://{HOST}:{PORT}/api/health")
    print("Installed engines:", json.dumps(tool_versions(), indent=2))
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    threading.Timer(0.8, lambda: webbrowser.open(f"http://{HOST}:{PORT}/")).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
