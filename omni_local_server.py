#!/usr/bin/env python3
"""
OmniConverter Local Engine
- No third-party Python packages required.
- Binds to 127.0.0.1 only.
- Browser UI talks to this process over localhost.
- Heavy media/PDF/image/OCR work is delegated to native tools when installed.
"""
from __future__ import annotations
import base64, hashlib, json, mimetypes, os, platform, shutil, subprocess, tempfile, threading, time, urllib.parse, zipfile, gzip
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HOST = "127.0.0.1"
PORT = int(os.environ.get("OMNI_PORT", "8765"))
ROOT = Path(tempfile.gettempdir()) / "omni_converter_engine"
ROOT.mkdir(parents=True, exist_ok=True)
LOCK = threading.Lock()
FILES: dict[str, Path] = {}
MAX_UPLOAD = int(os.environ.get("OMNI_MAX_UPLOAD", str(8 * 1024**3)))

TOOLS = {
    "ffmpeg": ["ffmpeg", "-version"],
    "ffprobe": ["ffprobe", "-version"],
    "qpdf": ["qpdf", "--version"],
    "pdftoppm": ["pdftoppm", "-v"],
    "magick": ["magick", "-version"],
    "convert": ["convert", "-version"],
    "tesseract": ["tesseract", "--version"],
    "zip": ["zip", "-v"],
    "unzip": ["unzip", "-v"],
}

def tool_path(name):
    p = shutil.which(name)
    if p:
        return p
    if name == "magick":
        return shutil.which("convert")
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

def process_job(payload):
    op = payload.get("op")
    if op == "health":
        return {"ok": True, "platform": platform.platform(), "python": platform.python_version(), "tools": tool_versions()}

    if op == "media":
        require_tool("ffmpeg")
        inp = get_file(payload["input"])
        fmt = str(payload.get("format", "mp4")).lower().lstrip(".")
        allowed = {"mp4","mkv","webm","mov","avi","mp3","wav","m4a","aac","flac","ogg","opus","gif"}
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
        allowed = {"jpg","jpeg","png","webp","avif","tiff","bmp","gif","pdf"}
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
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type,X-Filename,X-Omni-Token")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        cleanup_old()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/api/health"):
            self.send_json(process_job({"op":"health"}))
            return
        if parsed.path.startswith("/api/download/"):
            fid = parsed.path.rsplit("/", 1)[-1]
            try:
                p = get_file(fid)
                data = p.read_bytes()
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(p.name)[0] or "application/octet-stream")
                self.send_header("Content-Disposition", f'attachment; filename="{safe_name(p.name)}"')
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_json({"ok":False,"error":str(e)}, 404)
            return
        self.send_json({"ok":False,"error":"Not found"},404)

    def do_POST(self):
        cleanup_old()
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/upload":
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
    print(f"Listening on http://{HOST}:{PORT}")
    print("Installed engines:", json.dumps(tool_versions(), indent=2))
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
