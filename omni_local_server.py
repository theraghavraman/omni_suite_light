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
import ipaddress
import base64, bz2, gzip, hashlib, json, lzma, mimetypes, os, platform, secrets, shutil, subprocess, sys, tarfile, tempfile, threading, time, urllib.parse, zipfile, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from omni_environment import NATIVE_TOOLS as ENV_NATIVE_TOOLS, find_native_tool_path
import omni_security_primitives
from omni_security_primitives import parse_local_authority
from pathlib import PurePosixPath
import omni_data_engine
import omni_platform
import omni_code_runner
import omni_language_engine

HOST = os.environ.get("OMNI_HOST", "127.0.0.1")
PORT = int(os.environ.get("OMNI_PORT", "8765"))
ENGINE_API_VERSION = 4
ENGINE_BUILD = "omni-local-2026.10-complete-language"
ROOT = Path(tempfile.mkdtemp(prefix="omni_converter_engine_"))
if os.name != "nt":
    os.chmod(ROOT, 0o700)
LOCK = threading.Lock()
FILES: dict[str, Path] = {}
MAX_UPLOAD = min(max(1, int(os.environ.get("OMNI_MAX_UPLOAD", str(512 * 1024**2)))), 1024**3)
MAX_TEMP_BYTES = min(max(MAX_UPLOAD, int(os.environ.get("OMNI_MAX_TEMP_BYTES", str(2 * 1024**3)))), 4 * 1024**3)
MAX_CONCURRENT_UPLOADS = 3
UPLOAD_SLOTS = threading.BoundedSemaphore(MAX_CONCURRENT_UPLOADS)
TOKEN = os.environ.get("OMNI_TOKEN") or secrets.token_urlsafe(32)
LOCAL_UI_ORIGINS = {f"http://127.0.0.1:{PORT}", f"http://localhost:{PORT}"}
# Directory that holds index.html. Defaults to this file's folder (repository checkout);
# a pip-installed engine must be pointed at a checkout with OMNI_UI_ROOT or `omni-engine serve --ui`.
UI_ROOT = Path(os.environ.get("OMNI_UI_ROOT") or Path(__file__).resolve().parent).resolve()
UI_AVAILABLE = (UI_ROOT / "index.html").is_file()
ALLOWED_ORIGINS = set(LOCAL_UI_ORIGINS)

PUBLIC_STATIC_ROOT_FILES = {"index.html", "favicon.ico", "favicon.svg", "favicon-32.png", "apple-touch-icon.png"}
PUBLIC_STATIC_VENDOR_SUFFIXES = {".js", ".mjs", ".css", ".json", ".wasm", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".ttf", ".woff", ".woff2", ".map", ".traineddata", ".gz"}

def approved_static_path(rel):
    if not rel or "\\" in rel or "\x00" in rel:
        return False
    parts = PurePosixPath(rel).parts
    if any(part in (".", "..") or part.startswith(".") for part in parts):
        return False
    if len(parts) == 1:
        return rel in PUBLIC_STATIC_ROOT_FILES or PurePosixPath(rel).suffix.lower() in {".js", ".css"}
    if parts[0] == "vendor":
        return PurePosixPath(rel).suffix.lower() in PUBLIC_STATIC_VENDOR_SUFFIXES
    if parts[0] == "knowledge-base":
        return PurePosixPath(rel).suffix.lower() in KB_SUPPORTED_EXT | {".json"}
    return False

def request_origin(handler):
    return handler.headers.get("Origin", "").rstrip("/")

def host_allowed(handler):
    peer = getattr(handler, "client_address", ("", 0))[0]
    try:
        if not ipaddress.ip_address(peer).is_loopback:
            return False
    except ValueError:
        return False
    return parse_local_authority(handler.headers.get("Host", ""), PORT)

def origin_allowed(handler):
    origin = request_origin(handler)
    return bool(origin) and origin in ALLOWED_ORIGINS

def cors_origin(handler):
    origin = request_origin(handler)
    return origin if origin in ALLOWED_ORIGINS else ""

def same_origin_browser_request(handler):
    # Browsers omit Origin on same-origin GET/HEAD requests. Fetch metadata
    # identifies requests issued by the UI served from this loopback origin.
    return not request_origin(handler) and handler.headers.get("Sec-Fetch-Site", "").lower() == "same-origin"

# Operations that run arbitrary code are refused when the request comes from a remote
# (e.g. GitHub Pages) origin, even with a valid token, unless explicitly re-enabled.
REMOTE_BLOCKED_OPS = {"code_execute"}

def local_ui_request(handler):
    return request_origin(handler) in LOCAL_UI_ORIGINS or same_origin_browser_request(handler)

def local_session_request(handler):
    return local_ui_request(handler)

def authorize(handler):
    # The browser UI gets same-origin access without receiving a bearer secret.
    # Remote browser origins are rejected; local non-browser clients can still
    # authenticate with the process token.
    if local_ui_request(handler):
        return True
    if request_origin(handler):
        handler.send_json({"ok": False, "error": "Origin not allowed"}, 403)
        return False
    if not secrets.compare_digest(handler.headers.get("X-Omni-Token", ""), TOKEN):
        handler.send_json({"ok": False, "error": "Missing or invalid local-engine token"}, 401)
        return False
    return True

# The Doctor and verifier use the same canonical native-tool inventory.
TOOLS = {
    name: [command, "--version"]
    for name, (command, _package) in ENV_NATIVE_TOOLS.items()
}


def tool_path(name):
    return find_native_tool_path(name)


def tool_versions():
    out = {}
    for name, cmd in TOOLS.items():
        path = tool_path(name)
        out[name] = {"installed": bool(path), "path": path}
    return out

def safe_name(name: str, fallback="input.bin") -> str:
    name = os.path.basename(name or fallback).replace("\\", "_")
    return "".join(c if c.isalnum() or c in "._-" else "_" for c in name)[:180] or fallback

KB_SUPPORTED_EXT = {".md", ".markdown", ".txt", ".text", ".html", ".htm", ".json", ".csv", ".tsv", ".xml", ".yaml", ".yml", ".rst", ".pdf", ".docx"}

def knowledge_manifest(kb: Path) -> dict:
    """Live manifest: every supported file in knowledge-base/ (same rule as .github/scripts/build_kb_manifest.py)."""
    titles = {}
    try:
        old = json.loads((kb / "manifest.json").read_text("utf-8"))
        for f in (old if isinstance(old, list) else old.get("files", [])):
            if isinstance(f, dict) and f.get("path") and f.get("title"):
                titles[f["path"]] = f["title"]
    except (OSError, ValueError):
        pass
    files = []
    if kb.is_dir():
        for p in sorted(kb.rglob("*"), key=lambda x: x.relative_to(kb).as_posix().lower()):
            rel = p.relative_to(kb).as_posix()
            if (not p.is_file() or rel == "manifest.json" or p.suffix.lower() not in KB_SUPPORTED_EXT
                    or any(part.startswith(".") for part in p.relative_to(kb).parts)):
                continue
            files.append({"path": rel, "title": titles.get(rel) or p.stem.replace("_", " "), "type": p.suffix.lower().lstrip(".")})
    return {"version": 4, "rule": "Every supported file in knowledge-base/ is loaded by Omni Assistant.", "files": files}

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

_LAST_CLEANUP = 0.0

def cleanup_old():
    # Runs on every request, and File Sharing polls every couple of seconds; scanning the whole
    # work folder that often is wasted disk I/O for files that only expire after 6 hours.
    global _LAST_CLEANUP
    now = time.time()
    if now - _LAST_CLEANUP < 60:
        return
    _LAST_CLEANUP = now
    cutoff = now - 6 * 3600
    stale_paths = set()
    for p in ROOT.iterdir():
        try:
            if p.is_file() and p.stat().st_mtime < cutoff:
                p.unlink(missing_ok=True)
                stale_paths.add(p.resolve())
        except OSError:
            pass
    if stale_paths:
        with LOCK:
            for fid, p in list(FILES.items()):
                try:
                    if p.resolve() in stale_paths:
                        FILES.pop(fid, None)
                except OSError:
                    FILES.pop(fid, None)

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
            if sig[:8] != b"\x89PNG\r\n\x1a\n":
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


# --- Temporary LAN File Transfer -------------------------------------------------
TRANSFER_PORT_BASE = int(os.environ.get("OMNI_TRANSFER_PORT", "8766"))
TRANSFER_MAX_UPLOAD = int(os.environ.get("OMNI_TRANSFER_MAX_UPLOAD", str(8 * 1024**3)))
TRANSFER_TTL = int(os.environ.get("OMNI_TRANSFER_TTL", "900"))
TRANSFER_SESSIONS = {}
TRANSFER_LOCK = threading.Lock()
TRANSFER_HTTPD = None
TRANSFER_PORT = None
TRANSFER_CHUNK = 1024 * 1024
TRANSFER_MAX_PIN_FAILURES = 5
# Originals chosen in this computer's own file dialog, shared in place. Never deleted by Omni.
TRANSFER_PICKED = {}
TRANSFER_PICK_LOCK = threading.Lock()

def transfer_inbox():
    """Folder where files sent from a phone land on this computer.

    Files received here belong to the user, so they are kept after the
    session ends (unlike the temporary copies made for "send" sessions)."""
    custom = os.environ.get("OMNI_TRANSFER_DIR", "").strip()
    base = Path(custom).expanduser() if custom else Path.home() / "Downloads" / "Omni Transfers"
    base.mkdir(parents=True, exist_ok=True)
    return base

def transfer_display_name(name: str, fallback="received-file") -> str:
    """Keep a readable original name (spaces, unicode) while stripping paths and control chars."""
    name = os.path.basename(str(name or "").replace("\\", "/")).strip()
    name = "".join(c for c in name if c.isprintable() and c not in '<>:"/\\|?*').strip(" .")
    return (name or fallback)[:180]

def transfer_unique_path(folder: Path, name: str) -> Path:
    stem, suffix = os.path.splitext(name)
    candidate = folder / name
    n = 2
    while candidate.exists() or candidate.with_name(candidate.name + ".part").exists():
        candidate = folder / f"{stem} ({n}){suffix}"
        n += 1
    return candidate

def content_disposition(name: str) -> str:
    # http.server encodes headers as Latin-1, so a Hindi/CJK/emoji letter that safe_name keeps
    # (isalnum) crashed the response mid-download. filename* carries the real UTF-8 name.
    ascii_name = "".join(c if c.isascii() else "_" for c in safe_name(name, "download.bin"))
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{urllib.parse.quote(name)}"

def byte_range(header, size):
    """(start, end) inclusive for a single "bytes=" Range, None to send the whole file.

    Raises ValueError when the range cannot be satisfied (HTTP 416). Multi-range
    requests are answered with the whole file, which RFC 9110 allows."""
    import re
    m = re.fullmatch(r"\s*bytes=(\d*)-(\d*)\s*", header or "")
    if not m or not (m.group(1) or m.group(2)):
        return None
    if m.group(1):
        start = int(m.group(1))
        end = min(int(m.group(2)) if m.group(2) else size - 1, size - 1)
    else:
        start, end = max(0, size - int(m.group(2))), size - 1
    if start > end:
        raise ValueError("Range not satisfiable")
    return start, end

def stream_file(handler, path: Path, extra_headers=None, name=None):
    """Serve a file with resume support (Range) and, where the OS has it, zero-copy sendfile.

    A phone whose Wi-Fi drops mid-way can resume instead of starting a multi-GB
    download again, and the kernel moves the bytes from disk to the socket
    without a Python read/write loop holding a CPU core busy."""
    size = path.stat().st_size
    try:
        rng = byte_range(handler.headers.get("Range"), size)
    except ValueError:
        handler.send_response(416)
        handler.send_header("Content-Range", f"bytes */{size}")
        handler.send_header("Content-Length", "0")
        for k, v in (extra_headers or {}).items():
            handler.send_header(k, v)
        handler.end_headers()
        return
    start, end = rng or (0, size - 1)
    length = end - start + 1
    handler.send_response(206 if rng else 200)
    handler.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
    handler.send_header("Content-Length", str(length))
    handler.send_header("Accept-Ranges", "bytes")
    if rng:
        handler.send_header("Content-Range", f"bytes {start}-{end}/{size}")
    handler.send_header("Content-Disposition", content_disposition(name or path.name))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("X-Content-Type-Options", "nosniff")
    handler.send_header("X-Frame-Options", "DENY")
    handler.send_header("Referrer-Policy", "no-referrer")
    for k, v in (extra_headers or {}).items():
        handler.send_header(k, v)
    handler.end_headers()
    if length <= 0:
        return
    with open(path, "rb") as src:
        if hasattr(os, "sendfile"):
            handler.connection.sendfile(src, start, length)
            return
        # Windows has no os.sendfile; socket.sendfile would fall back to 8 KB sends there.
        src.seek(start)
        remaining = length
        while remaining:
            chunk = src.read(min(TRANSFER_CHUNK, remaining))
            if not chunk:
                break
            handler.wfile.write(chunk)
            remaining -= len(chunk)

def _default_route_ip():
    """Address the OS would use to reach the internet. Behind a VPN, proxy TUN
    or hotspot bridge this is NOT the Wi-Fi address a phone can reach, so it is
    only one hint among several."""
    import socket
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return ""
    finally:
        s.close()

def _quiet(args, timeout=4):
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=timeout).stdout or ""
    except Exception:
        return ""

def _interface_ipv4():
    """Every IPv4 address on this machine as (interface, label, ip)."""
    import re, socket
    found, system = [], platform.system()
    if system == "Windows":
        txt = _quiet(["powershell", "-NoProfile", "-Command",
                      "Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object { $_.InterfaceAlias + '|' + $_.IPAddress }"], 8)
        for line in txt.splitlines():
            if "|" in line:
                alias, ip = line.rsplit("|", 1)
                found.append((alias.strip(), alias.strip(), ip.strip()))
    else:
        ports = {}
        if system == "Darwin":
            # Map en0/en1 to "Wi-Fi" / "Ethernet" so the right one is recognisable.
            port = None
            for line in _quiet(["networksetup", "-listallhardwareports"]).splitlines():
                if line.startswith("Hardware Port:"): port = line.split(":", 1)[1].strip()
                elif line.startswith("Device:") and port: ports[line.split(":", 1)[1].strip()] = port
        txt = _quiet(["ip", "-4", "-o", "addr", "show"]) if system == "Linux" else ""
        if txt:
            for m in re.finditer(r"^\d+:\s+(\S+)\s+inet\s+(\d+\.\d+\.\d+\.\d+)", txt, re.M):
                found.append((m.group(1), m.group(1), m.group(2)))
        else:
            iface = None
            for line in _quiet(["ifconfig"]).splitlines():
                head = re.match(r"^([A-Za-z0-9_.\-]+):?\s", line)
                if head and not line[:1].isspace(): iface = head.group(1).rstrip(":")
                m = re.search(r"\binet (?:addr:)?(\d+\.\d+\.\d+\.\d+)", line)
                if m and iface: found.append((iface, ports.get(iface, iface), m.group(1)))
    if not found:
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                found.append(("", "", info[4][0]))
        except OSError:
            pass
    return found

_VIRTUAL_IFACES = ("utun", "tun", "tap", "ppp", "ipsec", "gif", "stf", "bridge", "vmnet", "vboxnet", "docker", "br-",
                   "veth", "virbr", "awdl", "llw", "anpi", "ap1", "tailscale", "zt", "wg", "lo", "vethernet", "virtualbox",
                   "vmware", "hyper-v", "loopback", "bluetooth", "vpn", "teredo", "isatap", "npcap", "cloudflare", "nordlynx",
                   "proton", "mullvad", "openvpn", "wintun", "clash", "meta")

def lan_addresses():
    """Candidate addresses a phone on the same Wi-Fi could use, best first.

    The old single guess used the default route, which on a Mac with a VPN,
    proxy TUN (Clash, Surge, Cloudflare WARP…), Tailscale or Internet Sharing
    points at a virtual interface the phone can never reach — the QR then
    opened nothing. Here every interface is listed and ranked instead."""
    override = os.environ.get("OMNI_LAN_IP", "").strip()
    default_ip = _default_route_ip()
    seen, out = set(), []
    for iface, label, ip in _interface_ipv4():
        try:
            addr = ipaddress.IPv4Address(ip)
        except ValueError:
            continue
        if ip in seen or addr.is_loopback or addr.is_link_local or addr.is_unspecified or addr.is_multicast:
            continue
        seen.add(ip)
        name = (iface + " " + label).lower()
        virtual = any(name.startswith(v) or (" " + v) in name for v in _VIRTUAL_IFACES)
        wifi = any(k in name for k in ("wi-fi", "wifi", "wlan", "wireless", "airport")) or iface.startswith("wl")
        wired = not wifi and (any(k in name for k in ("ethernet", "thunderbolt", "usb lan")) or iface.startswith(("eth", "enp", "eno", "ens")))
        score = 0
        if addr.is_private: score += 40
        if wifi: score += 30
        elif wired: score += 20
        elif iface.startswith("en"): score += 15
        if virtual: score -= 60
        if addr in ipaddress.ip_network("100.64.0.0/10") or addr in ipaddress.ip_network("198.18.0.0/15"): score -= 50
        if ip == default_ip and not virtual: score += 5
        if ip == override: score += 1000
        kind = "Wi-Fi" if wifi else ("Ethernet" if wired else ("Virtual / VPN" if virtual else "Network"))
        out.append({"ip": ip, "iface": iface, "label": label or iface or "Network", "kind": kind, "score": score, "likely": score > 0})
    if override and override not in seen:
        out.append({"ip": override, "iface": "", "label": "OMNI_LAN_IP", "kind": "Manual", "score": 1000, "likely": True})
    if default_ip and default_ip not in seen and not default_ip.startswith("127."):
        private = ipaddress.IPv4Address(default_ip).is_private
        out.append({"ip": default_ip, "iface": "", "label": "Default route", "kind": "Network", "score": 40 if private else 0, "likely": private})
    out.sort(key=lambda a: -a["score"])
    return out

def lan_ip():
    addrs = lan_addresses()
    return addrs[0]["ip"] if addrs else "127.0.0.1"

def firewall_hint():
    """Best-effort warning when the OS firewall will silently drop the phone."""
    system = platform.system()
    if system == "Darwin":
        fw = "/usr/libexec/ApplicationFirewall/socketfilterfw"
        if not Path(fw).exists() or "enabled" not in _quiet([fw, "--getglobalstate"]).lower():
            return ""
        if "enabled" in _quiet([fw, "--getblockall"]).lower():
            return "macOS Firewall is set to block all incoming connections, so the phone cannot connect. Turn that off in System Settings › Network › Firewall › Options."
        exe = os.path.realpath(sys.executable)
        if "blocked" in _quiet([fw, "--getappblocked", exe]).lower():
            return "macOS Firewall is blocking Python. Allow it in System Settings › Network › Firewall › Options, then start a new session."
        return "macOS Firewall is on. If macOS asks whether Python may accept incoming connections, click Allow."
    if system == "Windows":
        return "If Windows asks whether Python may communicate on networks, allow Private networks."
    return ""

def _native_pick_paths(title="Choose files to send to your phone"):
    """Open this computer's file dialog and return the chosen paths ([] when cancelled).

    Raises NotImplementedError when no dialog is available, so the browser can
    fall back to its own file picker."""
    system = platform.system()
    if system == "Darwin":
        cmd = ["osascript", "-e", "tell me to activate",
               "-e", f'set picked to choose file with prompt "{title}" with multiple selections allowed',
               "-e", 'set out to ""',
               "-e", "repeat with f in picked",
               "-e", "set out to out & POSIX path of f & linefeed",
               "-e", "end repeat",
               "-e", "return out"]
    elif system == "Windows":
        cmd = ["powershell", "-NoProfile", "-STA", "-Command",
               "Add-Type -AssemblyName System.Windows.Forms;[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
               "$o=New-Object System.Windows.Forms.Form -Property @{TopMost=$true;ShowInTaskbar=$false};"
               f"$d=New-Object System.Windows.Forms.OpenFileDialog -Property @{{Multiselect=$true;Title='{title}'}};"
               "if($d.ShowDialog($o) -eq [System.Windows.Forms.DialogResult]::OK){$d.FileNames -join [char]10}"]
    elif shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", "--multiple", "--separator=\n", "--title=" + title]
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getopenfilename", str(Path.home()), "--multiple", "--separate-output", "--title", title]
    else:
        cmd = [sys.executable, "-c",
               "import sys,tkinter,tkinter.filedialog as d;r=tkinter.Tk();r.withdraw();r.attributes('-topmost',True);"
               "sys.stdout.write('\\n'.join(d.askopenfilenames(title=sys.argv[1])))", title]
    try:
        cp = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900)
    except subprocess.TimeoutExpired:
        return []
    except OSError as e:
        raise NotImplementedError("No file chooser is available on this computer: " + str(e))
    # Cancel is exit 1 for zenity/kdialog and AppleScript error -128; PowerShell and tkinter exit 0.
    cancelled = cp.returncode == 1 and (cmd[0] in ("zenity", "kdialog") or "-128" in cp.stderr)
    if cp.returncode and not cancelled:
        detail = cp.stderr.strip().splitlines()[-1] if cp.stderr.strip() else ""
        raise NotImplementedError("The file chooser could not be opened" + (": " + detail if detail else "."))
    return [line for line in cp.stdout.splitlines() if line.strip()]

def transfer_pick():
    """Let the user choose files in the native dialog and share them without copying.

    Files dropped into the browser have to be streamed into the engine first
    (a full copy of every byte); files picked here are served straight from
    where they already are on disk."""
    if not TRANSFER_PICK_LOCK.acquire(blocking=False):
        raise ValueError("A file chooser is already open on this computer.")
    try:
        paths = _native_pick_paths()
    finally:
        TRANSFER_PICK_LOCK.release()
    out = []
    for raw in paths:
        p = Path(raw).expanduser()
        try:
            if not p.is_file():
                continue
            size = p.stat().st_size
        except OSError:
            continue
        pid = new_id("p")
        with TRANSFER_LOCK:
            TRANSFER_PICKED[pid] = p
        out.append({"id": pid, "name": p.name, "size": size})
    return {"ok": True, "files": out}

def _drop_session_files(sess):
    # Only temporary copies are removed. Files a phone sent to this computer
    # are saved in the inbox folder and always kept.
    for p in sess.get("owned_paths", []):
        try: p.unlink(missing_ok=True)
        except OSError: pass

def transfer_cleanup():
    now = time.time()
    with TRANSFER_LOCK:
        stale = [k for k,v in TRANSFER_SESSIONS.items() if v.get("expires",0) <= now]
        dropped = [TRANSFER_SESSIONS.pop(k) for k in stale]
    for sess in dropped:
        _drop_session_files(sess)
    stop_transfer_server_if_idle()

def transfer_session(token):
    transfer_cleanup()
    with TRANSFER_LOCK:
        s = TRANSFER_SESSIONS.get(token)
        if not s: raise ValueError("This transfer session has ended or expired. Start a new one on your computer.")
        return s

def transfer_file_name(s, fid, p):
    return (s.get("names") or {}).get(fid) or p.name

def transfer_cookie_name(token):
    return "omni_tx_" + token[:12]

def transfer_unlocked(handler, token, s):
    """True when the phone has entered this session's PIN (proved by an HttpOnly cookie)."""
    jar = handler.headers.get("Cookie", "")
    want = transfer_cookie_name(token) + "="
    for part in jar.split(";"):
        part = part.strip()
        if part.startswith(want):
            key = part[len(want):]
            with TRANSFER_LOCK:
                return any(secrets.compare_digest(key, k) for k in s.get("unlock_keys", ()))
    return False

def transfer_files_json(s):
    with TRANSFER_LOCK:
        files = list(s.get("files", []))
    out = []
    for fid, p in files:
        try:
            out.append({"id": fid, "name": transfer_file_name(s, fid, p), "size": p.stat().st_size})
        except OSError:
            continue
    return out

def start_transfer_server():
    raise NotImplementedError("LAN transfer is disabled until HTTPS identity is verified on both devices.")

def stop_transfer_server_if_idle():
    global TRANSFER_HTTPD, TRANSFER_PORT
    with TRANSFER_LOCK:
        active = bool(TRANSFER_SESSIONS)
    if not active and TRANSFER_HTTPD:
        h = TRANSFER_HTTPD
        TRANSFER_HTTPD, TRANSFER_PORT = None, None
        threading.Thread(target=h.shutdown, daemon=True).start()

TRANSFER_PAGE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0F766E">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>Omni Transfer</title>
<style>
:root{--bg:#F3F6F5;--card:#FFFFFF;--ink:#13233A;--muted:#5E6B7A;--line:#E3E8EC;--accent:#0F766E;--accent2:#14B8A6;--soft:#E6F4F1;--warn:#B42318;--warnsoft:#FDECEA;--ok:#067647;--oksoft:#E7F6EE;--shadow:0 10px 30px -18px rgba(15,35,58,.35)}
@media (prefers-color-scheme:dark){:root{--bg:#0C1416;--card:#142024;--ink:#E8F1F0;--muted:#93A4A8;--line:#22343A;--soft:#123331;--warnsoft:#3A1A17;--warn:#FDA29B;--oksoft:#11302A;--ok:#6CE9A6;--shadow:none}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
.top{position:sticky;top:0;z-index:5;padding:calc(14px + env(safe-area-inset-top)) 18px 14px;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff}
.top-row{display:flex;align-items:center;justify-content:space-between;gap:10px;max-width:640px;margin:auto}
.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:18px;letter-spacing:-.01em}
.logo{width:34px;height:34px;border-radius:10px;background:rgba(255,255,255,.2);display:grid;place-items:center;font-size:18px}
.conn{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;background:rgba(255,255,255,.18);font-size:12px;font-weight:700;white-space:nowrap}
.conn i{width:8px;height:8px;border-radius:50%;background:#FDE68A}.conn.on i{background:#86EFAC;box-shadow:0 0 0 3px rgba(134,239,172,.3)}.conn.off i{background:#FCA5A5}
main{max-width:640px;margin:auto;padding:16px 16px calc(28px + env(safe-area-inset-bottom))}
.intro{margin:4px 2px 14px}
.intro h1{margin:0 0 4px;font-size:24px;line-height:1.2;letter-spacing:-.02em}
.intro p{margin:0;color:var(--muted);font-size:14px}
.meta{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0 0}
.chip{display:inline-flex;align-items:center;gap:6px;padding:7px 11px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:13px;color:var(--muted)}
.chip b{color:var(--ink);font-variant-numeric:tabular-nums;letter-spacing:.06em}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:16px;margin-bottom:14px}
.card h2{margin:0 0 10px;font-size:15px;font-weight:800;display:flex;justify-content:space-between;align-items:center}
.card h2 small{font-weight:600;color:var(--muted);font-size:12px}
.pick{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:150px;padding:20px;border:2px dashed color-mix(in srgb,var(--accent) 45%,transparent);border-radius:16px;background:var(--soft);text-align:center;cursor:pointer;transition:transform .15s}
.pick:active{transform:scale(.98)}
.pick .ico{width:52px;height:52px;border-radius:16px;background:var(--accent);color:#fff;display:grid;place-items:center;font-size:26px;font-weight:700}
.pick strong{font-size:17px}.pick span{color:var(--muted);font-size:13px}
.pick input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.pick.drag{border-color:var(--accent);transform:scale(1.01)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}
.btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:46px;padding:0 16px;border-radius:13px;border:1px solid var(--accent);background:var(--accent);color:#fff;font-family:inherit;font-weight:700;font-size:15px;line-height:1;text-decoration:none;cursor:pointer;white-space:nowrap}
.btn.ghost{background:transparent;color:var(--accent)}
.btn:active{opacity:.85}
.btn[disabled]{opacity:.5;pointer-events:none}
.list{display:grid;gap:10px}
.file{display:grid;grid-template-columns:42px 1fr auto;align-items:center;gap:12px;padding:10px;border:1px solid var(--line);border-radius:14px;background:var(--card)}
.ext{width:42px;height:42px;border-radius:11px;background:var(--soft);color:var(--accent);display:grid;place-items:center;font:800 10px/1 ui-monospace,Menlo,monospace;text-transform:uppercase;overflow:hidden}
.fname{min-width:0}.fname b{display:block;font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fname small{display:block;color:var(--muted);font-size:12px;margin-top:2px}
.bar{height:5px;border-radius:5px;background:var(--line);overflow:hidden;margin-top:7px}.bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--accent),var(--accent2));transition:width .2s}
.tag{font-size:12px;font-weight:800;padding:6px 9px;border-radius:9px;background:var(--oksoft);color:var(--ok)}
.tag.err{background:var(--warnsoft);color:var(--warn)}.tag.wait{background:var(--soft);color:var(--accent)}
.file .btn{min-height:40px;padding:0 14px;font-size:14px}
.empty{padding:18px 8px;text-align:center;color:var(--muted);font-size:14px}
.note{font-size:12.5px;color:var(--muted);margin:10px 2px 0;text-align:center}
.ended{text-align:center;padding:36px 18px}.ended .ico{font-size:40px}.ended h2{justify-content:center;font-size:20px}
.toast{position:fixed;left:16px;right:16px;bottom:calc(16px + env(safe-area-inset-bottom));max-width:600px;margin:auto;padding:13px 15px;border-radius:14px;background:#13233A;color:#fff;font-size:14px;font-weight:600;box-shadow:0 16px 40px rgba(0,0,0,.3);transform:translateY(calc(100% + 60px));visibility:hidden;transition:transform .25s,visibility .25s;z-index:10}
.toast.show{transform:none;visibility:visible}.toast.err{background:var(--warn);color:#fff}
[hidden]{display:none!important}
</style></head><body>
<header class="top"><div class="top-row"><div class="brand"><span class="logo">&#8644;</span>Omni Transfer</div><span id="conn" class="conn"><i></i><span>Connecting</span></span></div></header>
<main>
  <section class="intro"><h1 id="title">Loading&hellip;</h1><p id="lead">Private transfer over your Wi-Fi. Nothing goes to the internet.</p>
    <div class="meta"><span class="chip">Ends in <b id="left">&mdash;</b></span></div></section>

  <section id="pinView" hidden>
    <div class="card"><h2>Enter the PIN</h2>
      <p class="note" style="text-align:left;margin:0 0 10px">Type the 6-digit PIN shown on your computer to unlock this transfer.</p>
      <form id="pinForm"><input id="pinInput" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" placeholder="000000"
        style="width:100%;font-size:28px;letter-spacing:8px;text-align:center;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--soft);color:inherit">
      <button class="btn" type="submit" style="width:100%;margin-top:12px">Unlock</button></form>
      <p id="pinErr" class="note" style="color:var(--warn)"></p></div>
  </section>

  <section id="sendView" hidden>
    <div class="card"><h2>Files on your computer <small id="sendCount"></small></h2><div id="sendList" class="list"></div>
      <button id="dlAll" class="btn ghost" type="button" style="width:100%;margin-top:12px" hidden>Download all</button></div>
    <p class="note">On iPhone, downloads appear in the Files app &rsaquo; Downloads.</p>
  </section>

  <section id="recvView" hidden>
    <div class="card">
      <label class="pick" id="pick"><input id="pickInput" type="file" multiple><span class="ico">+</span><strong>Choose files to send</strong><span>Photos, videos, documents &mdash; any type</span></label>
      <div class="row2"><label class="btn ghost" for="photoInput">Photos &amp; videos</label><label class="btn ghost" for="camInput">Take photo</label></div>
      <input id="photoInput" type="file" accept="image/*,video/*" multiple hidden><input id="camInput" type="file" accept="image/*" capture="environment" hidden>
    </div>
    <div class="card" id="queueCard" hidden><h2>Sending <small id="queueInfo"></small></h2><div id="queue" class="list"></div></div>
    <div class="card"><h2>Received on computer <small id="recvCount"></small></h2><div id="recvList" class="list"><div class="empty">Nothing sent yet.</div></div></div>
    <p class="note">Keep this page open until every file shows &ldquo;Sent&rdquo;.</p>
  </section>

  <section id="endedView" class="card ended" hidden><div class="ico">&#8987;</div><h2>Session ended</h2><p class="note" id="endedMsg">This link has expired or was stopped on the computer. Start a new transfer there and scan the new QR code.</p></section>
</main>
<div id="toast" class="toast" role="status"></div>
<script>
(function(){
var TOKEN=__TOKEN__;
var $=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
var fmt=function(n){n=+n||0;var u=['B','KB','MB','GB','TB'],i=0;while(n>=1024&&i<4){n/=1024;i++}return (n<10&&i?n.toFixed(1):Math.round(n))+' '+u[i]};
var ext=function(n){var m=/\.([a-z0-9]{1,5})$/i.exec(n||'');return m?m[1]:'file'};
var mode=null, expires=0, ended=false, poll=null, busy=false, toastTimer=null, uploaded=0, listSig='';
function toast(msg,err){var t=$('toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.className='toast'},3800)}
function conn(state,label){var c=$('conn');c.className='conn '+state;c.lastChild.textContent=label}
function tick(){if(!expires||ended)return;var s=Math.max(0,Math.round(expires-Date.now()/1000));$('left').textContent=Math.floor(s/60)+':'+String(s%60).padStart(2,'0');if(!s)end('This session has expired.')}
function end(msg){if(ended)return;ended=true;clearInterval(poll);$('sendView').hidden=true;$('recvView').hidden=true;$('endedView').hidden=false;$('title').textContent='Transfer finished';$('lead').textContent='';document.querySelector('.meta').hidden=true;conn('off','Ended')}
function setup(j){
  mode=j.mode;
  if(mode==='send'){$('title').textContent='Download from your computer';$('lead').textContent='Tap a file to save it to this device.';$('sendView').hidden=false}
  else{$('title').textContent='Send to your computer';$('lead').textContent='Files are saved on the computer in Downloads › Omni Transfers.';$('recvView').hidden=false;bindPicker()}
}
function renderSend(files){
  $('sendCount').textContent=files.length?files.length+(files.length>1?' files':' file'):'';
  $('sendList').innerHTML=files.map(function(f){var url='/api/download/'+encodeURIComponent(TOKEN)+'/'+encodeURIComponent(f.id);return '<div class="file"><span class="ext">'+esc(ext(f.name))+'</span><div class="fname"><b>'+esc(f.name)+'</b><small>'+fmt(f.size)+'</small></div><a class="btn" href="'+url+'" download="'+esc(f.name)+'">Save</a></div>'}).join('')||'<div class="empty">No files shared yet.</div>';
  $('dlAll').hidden=files.length<2;
}
function renderRecv(files){
  $('recvCount').textContent=files.length?files.length+(files.length>1?' files':' file'):'';
  $('recvList').innerHTML=files.slice().reverse().map(function(f){return '<div class="file"><span class="ext">'+esc(ext(f.name))+'</span><div class="fname"><b>'+esc(f.name)+'</b><small>'+fmt(f.size)+'</small></div><span class="tag">Saved</span></div>'}).join('')||'<div class="empty">Nothing sent yet.</div>';
}
function showPin(msg){$('pinView').hidden=false;$('sendView').hidden=true;$('recvView').hidden=true;$('title').textContent='Unlock transfer';$('lead').textContent='Private transfer over your Wi-Fi. Nothing goes to the internet.';$('pinErr').textContent=msg&&!/^Enter the PIN/.test(msg)?msg:'';conn('off','Locked');setTimeout(function(){$('pinInput').focus()},50)}
$('pinForm').addEventListener('submit',function(e){e.preventDefault();var pin=$('pinInput').value.trim();if(!/^\d{6}$/.test(pin)){$('pinErr').textContent='The PIN has 6 digits.';return}
  fetch('/api/unlock/'+encodeURIComponent(TOKEN),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:pin}),credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return {r:r,j:j}})}).then(function(x){
    $('pinInput').value='';if(x.r.ok){$('pinView').hidden=true;mode=null;listSig='';refresh();return}
    if(x.r.status===401){$('pinErr').textContent=x.j.error||'Wrong PIN.';return}end(x.j&&x.j.error)}).catch(function(){$('pinErr').textContent='Connection lost. Check you are on the same Wi-Fi.'})});
function refresh(){
  if(ended||document.hidden||!$('pinView').hidden)return Promise.resolve();
  return fetch('/api/status/'+encodeURIComponent(TOKEN),{cache:'no-store',credentials:'same-origin'}).then(function(r){return r.json().then(function(j){return {r:r,j:j}})}).then(function(x){
    if(x.r.status===401&&x.j&&x.j.pin_required){showPin(x.j.error);return}
    if(!x.r.ok){end(x.j&&x.j.error);return}
    var j=x.j;if(!mode)setup(j);expires=j.expires||0;tick();
    conn('on','Connected');
    /* Rebuild the list only when it changed: re-rendering every poll recreated the Save links under the user's finger. */
    var sig=JSON.stringify(j.files||[]);if(sig===listSig)return;listSig=sig;
    if(mode==='send')renderSend(j.files||[]);else renderRecv(j.files||[]);
  }).catch(function(){conn('off','Offline')});
}
/* Picker is created once and never re-rendered, so the phone's file chooser is never interrupted. */
function bindPicker(){
  ['pickInput','photoInput','camInput'].forEach(function(id){$(id).addEventListener('change',function(e){var fs=Array.prototype.slice.call(e.target.files||[]);e.target.value='';if(fs.length)enqueue(fs)})});
  var p=$('pick');['dragenter','dragover'].forEach(function(n){p.addEventListener(n,function(e){e.preventDefault();p.classList.add('drag')})});['dragleave','drop'].forEach(function(n){p.addEventListener(n,function(e){e.preventDefault();p.classList.remove('drag')})});
  p.addEventListener('drop',function(e){var fs=Array.prototype.slice.call(e.dataTransfer.files||[]);if(fs.length)enqueue(fs)});
}
var queue=[];
function enqueue(files){
  files.forEach(function(f){var id='q'+Math.random().toString(36).slice(2);queue.push({id:id,file:f});
    var row=document.createElement('div');row.className='file';row.id=id;row.innerHTML='<span class="ext">'+esc(ext(f.name))+'</span><div class="fname"><b>'+esc(f.name)+'</b><small>'+fmt(f.size)+' · waiting</small><div class="bar"><i></i></div></div><span class="tag wait">Queued</span>';$('queue').prepend(row)});
  $('queueCard').hidden=false;run();
}
function run(){
  if(busy)return;var next=queue.shift();if(!next){$('queueInfo').textContent=uploaded?uploaded+' sent':'';return}
  busy=true;var f=next.file,row=$(next.id),bar=row.querySelector('.bar i'),small=row.querySelector('small'),tag=row.querySelector('.tag');
  tag.className='tag wait';tag.textContent='0%';var t0=Date.now();
  var xhr=new XMLHttpRequest();xhr.open('POST','/api/upload/'+encodeURIComponent(TOKEN));
  xhr.setRequestHeader('X-Filename',encodeURIComponent(f.name||'file'));xhr.setRequestHeader('Content-Type',f.type||'application/octet-stream');
  xhr.upload.onprogress=function(e){if(!e.lengthComputable)return;var pc=Math.round(e.loaded/e.total*100),sec=(Date.now()-t0)/1000;bar.style.width=pc+'%';tag.textContent=pc+'%';small.textContent=fmt(e.loaded)+' of '+fmt(e.total)+(sec>1?' · '+fmt(e.loaded/sec)+'/s':'')};
  xhr.onload=function(){var j={};try{j=JSON.parse(xhr.responseText)}catch(_){}
    if(xhr.status>=200&&xhr.status<300){bar.style.width='100%';tag.className='tag';tag.textContent='Sent';small.textContent=fmt(f.size)+' · saved as '+(j.name||f.name);uploaded++;refresh()}
    else{tag.className='tag err';tag.textContent='Failed';small.textContent=j.error||('Upload failed ('+xhr.status+')');toast(j.error||'Upload failed',true);if(xhr.status===404)end(j.error);if(xhr.status===401&&j.pin_required)showPin(j.error)}
    busy=false;run()};
  xhr.onerror=function(){tag.className='tag err';tag.textContent='Failed';small.textContent='Connection lost. Check you are on the same Wi-Fi.';toast('Connection lost while sending '+f.name,true);busy=false;run()};
  xhr.send(f);
}
$('dlAll').addEventListener('click',function(){var links=Array.prototype.slice.call(document.querySelectorAll('#sendList a.btn'));links.forEach(function(a,i){setTimeout(function(){a.click()},i*900)})});
window.addEventListener('beforeunload',function(e){if(busy||queue.length){e.preventDefault();e.returnValue=''}});
document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh()});
refresh();poll=setInterval(refresh,2500);setInterval(tick,1000);
})();
</script></body></html>"""

def transfer_html(token):
    return TRANSFER_PAGE.replace("__TOKEN__", json.dumps(token))

class LANTransferHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OmniLANTransfer/1.1"
    def log_message(self, fmt, *args):
        if "/api/status/" in getattr(self, "path", ""): return  # the phone polls this every few seconds
        print("[OmniLAN]", fmt % args, flush=True)
    def send_bytes(self, data, ctype="text/plain; charset=utf-8", status=200, extra=None):
        self.send_response(status); self.send_header("Content-Type",ctype); self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff"); self.send_header("Referrer-Policy","no-referrer")
        if extra:
            for k,v in extra.items(): self.send_header(k,v)
        self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
    def send_json(self,obj,status=200): self.send_bytes(json.dumps(obj).encode(),"application/json; charset=utf-8",status)
    def do_GET(self):
        try:
            parsed=urllib.parse.urlparse(self.path); parts=[p for p in parsed.path.split("/") if p]
            if len(parts)==2 and parts[0]=="share":
                try:
                    s=transfer_session(parts[1])
                    with TRANSFER_LOCK: s["connected"]=True; s["last_seen"]=time.time()
                except ValueError:
                    pass  # the page itself shows the "session ended" state
                self.send_bytes(transfer_html(parts[1]).encode(),"text/html; charset=utf-8"); return
            if len(parts)==3 and parts[0]=="api" and parts[1]=="status":
                s=transfer_session(parts[2])
                if not transfer_unlocked(self, parts[2], s):
                    self.send_json({"ok":False,"pin_required":True,"error":"Enter the PIN shown on your computer."},401); return
                with TRANSFER_LOCK:
                    s["connected"]=True; s["last_seen"]=time.time()
                    mode=s["mode"]; expires=s.get("expires",0)
                self.send_json({"ok":True,"mode":mode,"expires":expires,"max_upload":TRANSFER_MAX_UPLOAD,"files":transfer_files_json(s)}); return
            if len(parts)==4 and parts[0]=="api" and parts[1]=="download":
                s=transfer_session(parts[2])
                if not transfer_unlocked(self, parts[2], s):
                    self.send_json({"ok":False,"pin_required":True,"error":"Enter the PIN shown on your computer."},401); return
                with TRANSFER_LOCK: p=s.get("file_map",{}).get(parts[3])
                if not p or not p.exists(): raise ValueError("File not found")
                stream_file(self, p, name=transfer_file_name(s, parts[3], p)); return
            if parsed.path in ("/", "/favicon.ico"):
                self.send_bytes(b"", "text/plain", 204); return
            self.send_json({"ok":False,"error":"Not found"},404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e: self.send_json({"ok":False,"error":str(e)},404)
    def do_POST(self):
        part=None
        try:
            parsed=urllib.parse.urlparse(self.path); parts=[p for p in parsed.path.split("/") if p]
            if len(parts)==3 and parts[0]=="api" and parts[1]=="unlock":
                s=transfer_session(parts[2])
                length=int(self.headers.get("Content-Length","0"))
                if length<=0 or length>256: raise ValueError("Invalid PIN request.")
                pin=str(json.loads(self.rfile.read(length) or b"{}").get("pin","")).strip()
                with TRANSFER_LOCK:
                    ok=secrets.compare_digest(pin, s["pin"])
                    if not ok:
                        s["pin_failures"]=s.get("pin_failures",0)+1
                        left=TRANSFER_MAX_PIN_FAILURES-s["pin_failures"]
                    else:
                        key=secrets.token_urlsafe(24); s["unlock_keys"].add(key); max_age=max(1,int(s["expires"]-time.time()))
                if not ok:
                    if left<=0:
                        with TRANSFER_LOCK: dead=TRANSFER_SESSIONS.pop(parts[2], None)
                        if dead: _drop_session_files(dead)
                        self.send_json({"ok":False,"error":"Too many wrong PINs. This session has ended."},404); return
                    self.send_json({"ok":False,"pin_required":True,"error":f"Wrong PIN. {left} attempt(s) left."},401); return
                self.send_bytes(json.dumps({"ok":True}).encode(),"application/json; charset=utf-8",200,
                    {"Set-Cookie":f"{transfer_cookie_name(parts[2])}={key}; Max-Age={max_age}; Path=/; HttpOnly; SameSite=Strict"}); return
            if len(parts)==3 and parts[0]=="api" and parts[1]=="upload":
                s=transfer_session(parts[2])
                if not transfer_unlocked(self, parts[2], s):
                    self.close_connection=True  # the unread upload body must not be parsed as the next request
                    self.send_json({"ok":False,"pin_required":True,"error":"Enter the PIN shown on your computer."},401); return
                if s["mode"]!="receive": raise ValueError("This session only shares files from the computer.")
                length=int(self.headers.get("Content-Length","0"))
                if length<=0: raise ValueError("The selected file is empty.")
                if length>TRANSFER_MAX_UPLOAD: raise ValueError("File is larger than the transfer limit of "+str(TRANSFER_MAX_UPLOAD//1024**3)+" GB.")
                name=transfer_display_name(urllib.parse.unquote(self.headers.get("X-Filename","")))
                inbox=transfer_inbox()
                with TRANSFER_LOCK:
                    dest=transfer_unique_path(inbox, name)
                    part=dest.with_name(dest.name+".part"); part.touch()
                with open(part,"wb") as f:
                    remaining=length
                    while remaining:
                        chunk=self.rfile.read(min(TRANSFER_CHUNK,remaining))
                        if not chunk: raise ValueError("Upload was interrupted. Try again.")
                        f.write(chunk); remaining-=len(chunk)
                os.replace(part, dest); part=None
                fid=new_id("t")
                with TRANSFER_LOCK:
                    s["file_map"][fid]=dest; s["files"].append((fid,dest)); s["connected"]=True; s["last_seen"]=time.time()
                print(f"[OmniLAN] received {dest}", flush=True)
                self.send_json({"ok":True,"id":fid,"name":dest.name,"size":dest.stat().st_size}); return
            self.send_json({"ok":False,"error":"Not found"},404)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:
            self.close_connection=True
            status=404 if "expired" in str(e) else 400
            self.send_json({"ok":False,"error":str(e)},status)
        finally:
            if part is not None:
                try: part.unlink(missing_ok=True)
                except OSError: pass

def transfer_start(payload):
    raise NotImplementedError("LAN transfer is disabled until HTTPS identity is verified on both devices.")

def transfer_status(token):
    s=transfer_session(token)
    with TRANSFER_LOCK:
        mode=s["mode"]; pin=s["pin"]; expires=s["expires"]; connected=s.get("connected",False); last=s.get("last_seen",0)
    return {"ok":True,"token":token,"mode":mode,"pin":pin,"expires":expires,"connected":connected,"active":bool(last and time.time()-last<8),"inbox":str(transfer_inbox()) if mode=="receive" else "","files":transfer_files_json(s)}

def transfer_reveal(token, fid=""):
    """Show a received file (or the inbox folder) in Finder / Explorer / the file manager."""
    s=transfer_session(token) if token else None
    target=transfer_inbox()
    if s and fid:
        with TRANSFER_LOCK: p=s.get("file_map",{}).get(fid)
        if p and p.exists(): target=p
    system=platform.system()
    if system=="Darwin":
        cmd=["open","-R",str(target)] if target.is_file() else ["open",str(target)]
    elif system=="Windows":
        cmd=["explorer","/select,",str(target)] if target.is_file() else ["explorer",str(target)]
    else:
        cmd=["xdg-open",str(target.parent if target.is_file() else target)]
    try: subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as e: raise ValueError("Could not open the folder: "+str(e))
    return {"ok":True,"path":str(target)}

def transfer_stop(token):
    with TRANSFER_LOCK: s=TRANSFER_SESSIONS.pop(token,None)
    if s:
        _drop_session_files(s)
    stop_transfer_server_if_idle()
    return {"ok":True}

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

    if op == "transfer_start": return transfer_start(payload)
    if op == "transfer_status": return transfer_status(str(payload.get("token","")))
    if op == "transfer_stop": return transfer_stop(str(payload.get("token","")))

    if op == "health":
        return {"ok": True, "engine_api_version": ENGINE_API_VERSION, "engine_build": ENGINE_BUILD, "platform": platform.platform(), "python": platform.python_version(), "tools": tool_versions(), "python_modules": omni_data_engine.module_status(), "doctor": omni_platform.doctor(), "capability_engine": {"version": 1, "supported_modes": ["browser","browser-first","local","unknown"], "ai": local_ai_capabilities()}, "capabilities": {"media_video": ["mp4","mkv","webm","mov","avi","flv","mpeg","mpg","m4v","3gp","3g2","ts","m2ts","mts","vob","wmv","asf","ogv","nut","mxf","ivf","gif","apng"], "media_audio": ["mp3","wav","m4a","aac","flac","ogg","oga","opus","wma","amr","aiff","aif","aifc","ac3","eac3","au","caf","w64","wv","tta","ape","mka"], "image": ["jpg","jpeg","jpe","jfif","png","apng","webp","avif","tiff","tif","bmp","gif","svg","ico","heic","heif","jxl","jp2","j2k","j2c","jng","tga","dds","exr","hdr","dpx","eps","eps3","ps","pdf","pnm","ppm","pgm","pbm","pam","pcx","miff","mvg","ora","psd","xcf","fits","flif","bpg"], "office": ["pdf","docx","doc","docm","dot","dotx","dotm","odt","ott","fodt","rtf","txt","md","html","htm","epub","xls","xlsx","xlsm","xlsb","xlt","xltx","xltm","ods","ots","fods","csv","tsv","sylk","dif","ppt","pptx","pptm","pps","ppsx","pot","potx","potm","odp","otp","fodp","sxi","key"], "ebook": ["azw","azw3","azw4","cbz","cbr","cb7","cbc","chm","djvu","docx","epub","fb2","fbz","html","htmlz","kepub","lit","lrf","mobi","odt","pdf","prc","pdb","pml","rb","rtf","snb","tcr","txt","txz","zip","oeb","pmlz"], "archive": ["zip","tar","gz","bz2","xz","7z"], "archive_extract": ["7z","rar"], "language_translation": omni_language_engine.capability().get("translation", []), "language_transliteration": omni_language_engine.capability().get("transliteration", []), "scientific": ["fits","fit","netcdf","nc","hdf5","h5","cdf","grib","grib2","grb","grb2"]}, "data": {"formats": sorted(omni_data_engine.DATA_FORMATS | {"jsonschema"}), "modules": omni_data_engine.module_status(), "sql_dialects": omni_data_engine.SQL_DIALECTS}}

    if op == "code_capabilities":
        return {"ok": True, "available": False, "sandbox": None, "reason": "Code execution is disabled until a verified rootless sandbox is configured."}

    if op == "code_execute":
        raise RuntimeError("Code execution is unavailable until a verified rootless sandbox with output, CPU, memory and process limits is installed.")

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
        raise RuntimeError("7z/RAR extraction is unavailable until extraction runs inside an isolated, resource-limited sandbox.")

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


ETL_RUN_TIMEOUT = max(30, int(os.environ.get("OMNI_ETL_TIMEOUT", "3600")))

def hop_local_request(path, username, password, timeout=5, max_bytes=65536):
    """Call a fixed loopback Apache Hop endpoint; never accept an upstream URL from the browser."""
    credentials = base64.b64encode((str(username) + ":" + str(password)).encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        "http://127.0.0.1:8081" + path,
        headers={
            "Authorization": "Basic " + credentials,
            "Accept": "application/json, application/xml, text/xml, text/html, */*",
            "User-Agent": "Redmark-Forge-ETL-Studio/1.0",
        },
        method="GET",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            body = body[:max_bytes] + b"\n[response truncated]"
        return response.status, response.headers.get("Content-Type", ""), body.decode("utf-8", "replace")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "OmniEngine/1.0"

    def log_message(self, fmt, *args):
        print("[OmniEngine]", fmt % args, flush=True)

    def send_json(self, obj, status=200):
        data = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy-Report-Only", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
        origin = cors_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename")
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
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename")
        self.end_headers()

    def serve_static(self, parsed_path):
        if not UI_AVAILABLE:
            return False  # never fall back to serving arbitrary files (e.g. site-packages)
        root = UI_ROOT
        rel = urllib.parse.unquote(parsed_path.lstrip("/"))
        if not rel or rel.endswith("/"):
            rel = "index.html"
        if not approved_static_path(rel):
            self.send_json({"ok":False,"error":"Not found"},404)
            return True
        parts = PurePosixPath(rel).parts
        if any(root.joinpath(*parts[:i]).is_symlink() for i in range(1, len(parts)+1)):
            self.send_json({"ok":False,"error":"Symbolic links are not public assets"},403)
            return True
        target = (root / rel).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            self.send_json({"ok":False,"error":"Forbidden"},403)
            return True
        if rel == "knowledge-base/manifest.json":
            # Every supported file in knowledge-base/ is assistant knowledge, even if
            # the committed manifest has not been regenerated yet.
            body = json.dumps(knowledge_manifest(root / "knowledge-base"), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            origin = cors_origin(self)
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return True
        if not target.is_file():
            return False

        data = None
        if target.name == "index.html":
            data = target.read_bytes()
            vendor = root / "vendor"
            local_ready = (
                (vendor / "pdfjs/build/pdf.mjs").is_file()
                and (vendor / "pdfjs/build/pdf.worker.mjs").is_file()
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
                    "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js",
                    "./vendor/sheetjs/xlsx.full.min.js"
                ).replace(
                    "https://cdn.jsdelivr.net/npm/js-yaml@4.1.1/dist/js-yaml.min.js",
                    "./vendor/jsyaml/js-yaml.min.js"
                ).replace(
                    "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
                    "./vendor/jszip/jszip.min.js"
                ).replace(
                    "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js",
                    "./vendor/pdf-lib/pdf-lib.min.js"
                ).replace(
                    "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js",
                    "./vendor/tesseract/tesseract.min.js"
                )
                html = html.replace(
                    '<head>',
                    '<head><script>window.OMNI_TESSERACT_OPTIONS={workerPath:"./vendor/tesseract/worker.min.js",langPath:"./vendor/tesseract/lang/",corePath:"./vendor/tesseract/core/",workerBlobURL:false};</script>',
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
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy-Report-Only", "default-src 'self' data: blob: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: blob: https:; font-src 'self' data: https:; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")
        origin = cors_origin(self)
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Content-Length", str(size))
        self.end_headers()
        if self.command == "HEAD":
            return True
        if data is not None:
            self.wfile.write(data)
        else:
            with open(target,"rb") as src:
                while True:
                    chunk=src.read(1024*1024)
                    if not chunk: break
                    self.wfile.write(chunk)
        return True

    def do_HEAD(self):
        # Diagnostics probes ./vendor assets with HEAD; without this handler the stdlib answers 501.
        if not host_allowed(self):
            self.send_response(403); self.send_header("Content-Length", "0"); self.end_headers(); return
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/") and self.serve_static(parsed.path):
            return
        self.send_response(404); self.send_header("Content-Length", "0"); self.end_headers()

    def do_GET(self):
        cleanup_old(); transfer_cleanup()
        if not host_allowed(self):
            self.send_json({"ok": False, "error": "Host not allowed"}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/healthz":
            self.send_json({"ok":True,"service":"omni-local-engine","api_version":ENGINE_API_VERSION})
            return
        if parsed.path == "/api/etl/hop/projects":
            if not authorize(self): return
            try:
                root = (Path.home() / "OmniETL" / "projects").resolve()
                root.mkdir(parents=True, exist_ok=True)
                pipelines = []
                for candidate in root.rglob("*.hpl"):
                    try:
                        resolved = candidate.resolve()
                        resolved.relative_to(root)
                    except (OSError, ValueError):
                        continue
                    if resolved.is_file():
                        pipelines.append({"name": resolved.name, "path": resolved.relative_to(root).as_posix(), "modified": int(resolved.stat().st_mtime)})
                    if len(pipelines) >= 500:
                        break
                pipelines.sort(key=lambda item: item["path"].casefold())
                self.send_json({"ok": True, "folder": str(root), "pipelines": pipelines, "limit": 500})
            except Exception as e:
                self.send_json({"ok": False, "error": "Could not inspect the ETL projects folder: " + str(e)}, 500)
            return
        if parsed.path not in ("/api/health",) and not parsed.path.startswith("/api/"):
            if self.serve_static(parsed.path):
                return
        if parsed.path == "/api/ai/status":
            if not local_session_request(self):
                self.send_json({"ok":False,"error":"Origin not allowed"},403); return
            s=local_ai_capabilities(); self.send_json({"ok":True, **s}); return
        if parsed.path == "/api/health":
            if not local_session_request(self):
                self.send_json({"ok": False, "error": "Origin not allowed"}, 403)
                return
            health = process_job({"op":"health"})
            health.pop("token", None)
            self.send_json(health)
            return
        if parsed.path == "/api/transfer/status":
            if not authorize(self): return
            q=urllib.parse.parse_qs(parsed.query)
            try: self.send_json(transfer_status(q.get("token",[""])[0]))
            except Exception as e: self.send_json({"ok":False,"error":str(e)},404)
            return
        if parsed.path.startswith("/api/transfer/download/"):
            if not authorize(self): return
            parts=parsed.path.split("/")
            if len(parts)<6: self.send_json({"ok":False,"error":"Invalid transfer download path"},400); return
            token,fid=parts[-2],parts[-1]
            try:
                s=transfer_session(token)
                with TRANSFER_LOCK: p=s.get("file_map",{}).get(fid)
                if not p or not p.exists(): raise ValueError("File not found")
                origin=cors_origin(self)
                stream_file(self, p, {"Access-Control-Allow-Origin": origin, "Vary": "Origin"} if origin else None, name=transfer_file_name(s, fid, p))
            except Exception as e: self.send_json({"ok":False,"error":str(e)},404)
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
        cleanup_old(); transfer_cleanup()
        if not host_allowed(self):
            self.send_json({"ok": False, "error": "Host not allowed"}, 403)
            return
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/api/etl/hop/status", "/api/etl/hop/run"):
            if not authorize(self): return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > 65536:
                    raise ValueError("ETL request body is missing or too large.")
                payload = json.loads(self.rfile.read(length) or b"{}")
                username = str(payload.get("username", "cluster"))[:256]
                password = str(payload.get("password", "cluster"))[:1024]
                if not username or not password:
                    raise ValueError("Enter the Hop Server username and password.")
                if parsed.path == "/api/etl/hop/status":
                    try:
                        code, content_type, body = hop_local_request("/hop/status/?json=Y", username, password, timeout=4, max_bytes=32768)
                        self.send_json({"ok": True, "reachable": True, "endpoint": "http://127.0.0.1:8081", "http_status": code, "content_type": content_type, "response": body[:12000]})
                    except Exception as e:
                        code = getattr(e, "code", None)
                        if code == 401:
                            message = "Hop Server rejected these credentials (HTTP 401). Check the username and password."
                        elif code:
                            message = "Hop Server returned HTTP " + str(code) + "."
                        else:
                            message = "Could not reach Hop Server at 127.0.0.1:8081. Start Hop Server and try again."
                        self.send_json({"ok": True, "reachable": False, "endpoint": "http://127.0.0.1:8081", "error": message})
                    return
                rel = str(payload.get("path", "")).strip()
                if not rel or "\\" in rel or rel.startswith("/"):
                    raise ValueError("Choose a pipeline from the local project list.")
                root = (Path.home() / "OmniETL" / "projects").resolve()
                candidate = (root / rel).resolve()
                try:
                    candidate.relative_to(root)
                except ValueError:
                    raise ValueError("Pipeline path must stay inside the OmniETL projects folder.")
                if candidate.suffix.lower() != ".hpl" or not candidate.is_file():
                    raise ValueError("The selected .hpl pipeline was not found inside the OmniETL projects folder.")
                query = urllib.parse.urlencode({"pipeline": str(candidate), "json": "Y"})
                try:
                    code, content_type, body = hop_local_request("/hop/execPipeline?" + query, username, password, timeout=ETL_RUN_TIMEOUT, max_bytes=65536)
                except Exception as e:
                    code = getattr(e, "code", None)
                    reason = getattr(e, "reason", e)
                    if code is None and isinstance(reason, TimeoutError):
                        self.send_json({"ok": False, "error": "Hop Server did not finish this pipeline within " + str(ETL_RUN_TIMEOUT) + " seconds. It may still be running; check the Hop Server status page. Set OMNI_ETL_TIMEOUT to allow longer runs."}, 504)
                        return
                    detail = ""
                    try: detail = e.read(12000).decode("utf-8", "replace") if hasattr(e, "read") else ""
                    except Exception: pass
                    if code == 401:
                        message = "Hop Server rejected these credentials (HTTP 401)."
                    elif code:
                        message = "Hop Server returned HTTP " + str(code) + "."
                    else:
                        message = "Could not reach Hop Server at 127.0.0.1:8081."
                    self.send_json({"ok": False, "error": message + (("\n" + detail[:12000]) if detail else "")}, 502)
                    return
                lowered = body.lower().replace(" ", "")
                if "<result>error</result>" in lowered or '"result":"error"' in lowered or '"result":"ERROR"' in body:
                    self.send_json({"ok": False, "error": "Hop Server reported a pipeline execution error.", "response": body[:12000], "http_status": code}, 400)
                    return
                self.send_json({"ok": True, "success": True, "message": "Hop Server returned an execution response.", "http_status": code, "content_type": content_type, "response": body[:12000]})
            except Exception as e:
                self.send_json({"ok": False, "error": str(e)}, 400)
            return
        if parsed.path == "/api/upload":
            if not authorize(self):
                return
            if not UPLOAD_SLOTS.acquire(blocking=False):
                self.send_json({"ok":False,"error":"Upload capacity is busy. Retry shortly."},429)
                return
            path = None
            try:
                length = int(self.headers.get("Content-Length","0"))
                if length <= 0 or length > MAX_UPLOAD:
                    self.send_json({"ok":False,"error":"Upload size is missing or exceeds local-engine limit"},413)
                    return
                with LOCK:
                    stored_bytes=sum(p.stat().st_size for p in ROOT.iterdir() if p.is_file())
                if stored_bytes + length > MAX_TEMP_BYTES:
                    self.send_json({"ok":False,"error":"Local temporary storage quota is full. Download or clear previous jobs first."},413)
                    return
                self.connection.settimeout(30)
                fid = new_id("u")
                name = safe_name(urllib.parse.unquote(self.headers.get("X-Filename","input.bin")))
                suffix=Path(name).suffix.lower()
                path = omni_security_primitives.atomic_stream_upload(self.rfile, ROOT, length, MAX_UPLOAD, suffix)
                with LOCK:
                    FILES[fid] = path
                self.send_json({"ok":True,"file_id":fid,"name":name,"size":path.stat().st_size})
            except Exception as e:
                if path and path.exists():
                    path.unlink(missing_ok=True)
                self.send_json({"ok":False,"error":str(e)},400)
            finally:
                UPLOAD_SLOTS.release()
            return
        if parsed.path == "/api/transfer/start":
            if not authorize(self): return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length>1024*1024: raise ValueError("Transfer metadata too large")
                payload=json.loads(self.rfile.read(length) or b"{}"); self.send_json(transfer_start(payload))
            except NotImplementedError as e: self.send_json({"ok":False,"error":str(e)},503)
            except Exception as e: self.send_json({"ok":False,"error":str(e)},400)
            return
        if parsed.path == "/api/transfer/pick":
            if not authorize(self): return
            try: self.send_json(transfer_pick())
            except NotImplementedError as e: self.send_json({"ok":False,"error":str(e),"fallback":True},501)
            except Exception as e: self.send_json({"ok":False,"error":str(e)},400)
            return
        if parsed.path == "/api/transfer/status":
            # POST variant: same-origin GETs carry no Origin header, POSTs always do.
            if not authorize(self): return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length>4096: raise ValueError("Request too large")
                payload=json.loads(self.rfile.read(length) or b"{}")
                self.send_json(transfer_status(str(payload.get("token",""))))
            except Exception as e: self.send_json({"ok":False,"error":str(e)},404)
            return
        if parsed.path == "/api/transfer/reveal":
            if not authorize(self): return
            try:
                length=int(self.headers.get("Content-Length","0"))
                if length>4096: raise ValueError("Request too large")
                payload=json.loads(self.rfile.read(length) or b"{}")
                self.send_json(transfer_reveal(str(payload.get("token","")), str(payload.get("id",""))))
            except Exception as e: self.send_json({"ok":False,"error":str(e)},400)
            return
        if parsed.path == "/api/transfer/stop":
            if not authorize(self): return
            try:
                length=int(self.headers.get("Content-Length","0")); payload=json.loads(self.rfile.read(length) or b"{}"); self.send_json(transfer_stop(str(payload.get("token",""))))
            except Exception as e: self.send_json({"ok":False,"error":str(e)},400)
            return
        if parsed.path == "/api/process":
            if not authorize(self):
                return
            try:
                length = int(self.headers.get("Content-Length","0"))
                if length > 10*1024*1024:
                    raise ValueError("Job metadata is unexpectedly large")
                payload = json.loads(self.rfile.read(length) or b"{}")
                if payload.get("op") in {"code_execute", "archive_extract"}:
                    self.send_json({"ok":False,"error":"This operation is unavailable until its required isolation boundary is configured."},503)
                    return
                result = process_job(payload)
                self.send_json(result)
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)},400)
            return
        self.send_json({"ok":False,"error":"Not found"},404)

def main():
    ui_host = "localhost" if HOST in ("127.0.0.1", "::1") else HOST
    print("OmniConverter Local Engine")
    if UI_AVAILABLE:
        print(f"Local UI: http://{ui_host}:{PORT}/   (serving {UI_ROOT})")
    else:
        print("Local UI: not available - running API-only. Point OMNI_UI_ROOT (or `omni-engine serve --ui PATH`) at a checkout containing index.html.")
    print(f"API:      http://{HOST}:{PORT}/api/health")
    print("Installed engines:", json.dumps(tool_versions(), indent=2))
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    if UI_AVAILABLE:
        threading.Timer(0.8, lambda: webbrowser.open(f"http://{ui_host}:{PORT}/")).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
