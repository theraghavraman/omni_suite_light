#!/usr/bin/env python3
"""
OmniConverter Local Engine
- No third-party Python packages required.
- Binds to 127.0.0.1 only.
- Browser UI talks to this process over localhost.
- Heavy media/PDF/image/OCR work is delegated to native tools when installed.
"""
from __future__ import annotations
import base64, hashlib, json, mimetypes, os, platform, secrets, shutil, subprocess, tempfile, threading, time, urllib.parse, zipfile, gzip, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("OMNI_PORT", "8765"))
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
    "qpdf": ["qpdf", "--version"],
    "pdftoppm": ["pdftoppm", "-v"],
    "pdftotext": ["pdftotext", "-v"],
    "magick": ["magick", "-version"],
    "convert": ["convert", "-version"],
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
        raise RuntimeError(f"{name} is not installed. Run the platform installer in the OmniConverter repository.")
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

def process_job(payload):
    op = payload.get("op")
    if op == "health":
        return {"ok": True, "platform": platform.platform(), "python": platform.python_version(), "tools": tool_versions(), "capabilities": {"media_video": ["mp4","mkv","webm","mov","avi","flv","mpeg","mpg","m4v","3gp","3g2","ts","m2ts","mts","vob","wmv","asf","ogv","nut","mxf","ivf","gif","apng"], "media_audio": ["mp3","wav","m4a","aac","flac","ogg","oga","opus","wma","amr","aiff","aif","aifc","ac3","eac3","au","caf","w64","wv","tta","ape","mka"], "image": ["jpg","jpeg","jpe","jfif","png","apng","webp","avif","tiff","tif","bmp","gif","svg","ico","heic","heif","jxl","jp2","j2k","j2c","jng","tga","dds","exr","hdr","dpx","eps","eps3","ps","pdf","pnm","ppm","pgm","pbm","pam","pcx","miff","mvg","ora","psd","xcf","fits","flif","bpg"], "office": ["pdf","docx","doc","docm","dot","dotx","dotm","odt","ott","fodt","rtf","txt","md","html","htm","epub","xls","xlsx","xlsm","xlsb","xlt","xltx","xltm","ods","ots","fods","csv","tsv","sylk","dif","ppt","pptx","pptm","pps","ppsx","pot","potx","potm","odp","otp","fodp","sxi","key"], "ebook": ["azw","azw3","azw4","cbz","cbr","cb7","cbc","chm","djvu","docx","epub","fb2","fbz","html","htmlz","kepub","lit","lrf","mobi","odt","pdf","prc","pdb","pml","rb","rtf","snb","tcr","txt","txz","zip","oeb","pmlz"]}}

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

    if op == "pdf_to_text":
        pdftotext = shutil.which("pdftotext")
        if not pdftotext:
            raise RuntimeError("Poppler pdftotext is not installed.")
        inp = get_file(payload["input"])
        out = output_path(inp.stem + "_text", "txt")
        run([pdftotext, "-layout", str(inp), str(out)], timeout=3600)
        return file_result(out, out.name, "text/plain")

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
                and (vendor / "tesseract/lang/eng.traineddata.gz").is_file()
            )
            if local_ready:
                html = data.decode("utf-8")
                html = html.replace(
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
