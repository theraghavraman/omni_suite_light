#!/usr/bin/env python3
"""Representative native smoke test for OmniConverter Local Engine."""
from pathlib import Path
import json, os, shutil, subprocess, tempfile, time, zipfile
from urllib import request

ORIGIN = os.environ.get("OMNI_TEST_ORIGIN", "http://127.0.0.1:8765")

ROOT = Path(tempfile.mkdtemp(prefix="omni-ci-"))
server = None

def which(*names):
    for n in names:
        p = shutil.which(n)
        if p: return p
    raise RuntimeError("Missing executable: " + ", ".join(names))

def run(cmd):
    print("+", " ".join(map(str, cmd)))
    return subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

def post(url, body, headers):
    req = request.Request(url, data=body, headers=headers, method="POST")
    with request.urlopen(req, timeout=60) as r: return json.loads(r.read())

def process(payload, token):
    return post("http://127.0.0.1:8765/api/process", json.dumps(payload).encode(), {"Content-Type":"application/json","Origin":ORIGIN,"X-Omni-Token":token})

def upload(path, token):
    return post("http://127.0.0.1:8765/api/upload", path.read_bytes(), {"Content-Type":"application/octet-stream","Origin":ORIGIN,"X-Filename":path.name,"X-Omni-Token":token})

def download(fid, path, token):
    req=request.Request("http://127.0.0.1:8765/api/download/"+fid, headers={"Origin":ORIGIN,"X-Omni-Token":token})
    with request.urlopen(req, timeout=60) as r: path.write_bytes(r.read())

try:
    env=os.environ.copy(); env["OMNI_TOKEN"]="ci-test-token"
    server=subprocess.Popen(["python","omni_local_server.py"],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    health=None
    for _ in range(40):
        try:
            with request.urlopen(request.Request("http://127.0.0.1:8765/api/health",headers={"Origin":"http://127.0.0.1:8765"}),timeout=2) as r: health=json.loads(r.read()); break
        except Exception: time.sleep(.25)
    assert health and health.get("ok") and health.get("token")=="ci-test-token"
    print("1. Local Engine health: OK")
    caps=health.get("capabilities",{})
    required={"media_video":["mp4","mpeg","mkv","gif"],"media_audio":["mp3","flac","opus","wma"],"image":["svg","gif","tiff","heic"],"office":["docx","docm","xlsx","xlsm","pptx","pptm","odp"],"ebook":["epub","mobi","azw3","cbz","cbr","djvu"]}
    missing=[f"{k}:{v}" for k,vals in required.items() for v in vals if v not in caps.get(k,[])]
    assert not missing, "Missing native capabilities: "+", ".join(missing)
    print("2. Native format capability inventory: OK")

    magick=which("magick","convert")
    image=ROOT/"sample.png"
    run([magick,"-size","500x120","xc:white","-gravity","center","-pointsize","32","-fill","black","-annotate","0","Omni CI",str(image)])
    up=upload(image,"ci-test-token"); print("3. Image upload: OK")

    out=process({"op":"image","input":up["file_id"],"format":"png","width":200},"ci-test-token")
    download(out["file_id"],ROOT/"resized.png","ci-test-token"); print("4. Image resize: OK")

    out=process({"op":"image","input":up["file_id"],"format":"pdf"},"ci-test-token")
    download(out["file_id"],ROOT/"image.pdf","ci-test-token"); print("5. Image -> PDF: OK")
    pdf=upload(ROOT/"image.pdf","ci-test-token")

    out=process({"op":"pdf_render","input":pdf["file_id"],"dpi":72},"ci-test-token")
    download(out["file_id"],ROOT/"render.zip","ci-test-token"); print("6. PDF -> image: OK")

    out=process({"op":"ocr","input":up["file_id"],"lang":"eng"},"ci-test-token")
    download(out["file_id"],ROOT/"ocr.txt","ci-test-token"); print("7. OCR: OK")

    out=process({"op":"zip","inputs":[up["file_id"],pdf["file_id"]]},"ci-test-token")
    download(out["file_id"],ROOT/"archive.zip","ci-test-token")
    with zipfile.ZipFile(ROOT/"archive.zip") as z: assert z.namelist()
    print("8. ZIP compression/extraction: OK")
    for fmt in ("tar","gz","bz2","xz"):
        process({"op":"archive","input":up["file_id"],"format":fmt},"ci-test-token")
    print("9. Native TAR/GZIP/BZIP2/XZ compression: OK")

    run([which("ffmpeg"),"-y","-f","lavfi","-i","anullsrc=r=8000:cl=mono","-t","0.2",str(ROOT/"tone.wav")])
    media=upload(ROOT/"tone.wav","ci-test-token")
    process({"op":"media","input":media["file_id"],"format":"mp3"},"ci-test-token")
    process({"op":"media","input":media["file_id"],"format":"flac"},"ci-test-token")
    print("10. FFmpeg audio conversion (MP3/FLAC): OK")

    svg=ROOT/"sample.svg"; svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="white"/><text x="20" y="75" font-size="42">Omni SVG</text></svg>',encoding="utf-8")
    svgup=upload(svg,"sample.svg")
    out=process({"op":"image","input":svgup["file_id"],"format":"png"},"ci-test-token")
    download(out["file_id"],ROOT/"svg.png","ci-test-token"); print("11. SVG -> PNG: OK")
    process({"op":"image","input":up["file_id"],"format":"gif"},"ci-test-token"); print("12. PNG -> GIF: OK")

    run([which("ffmpeg"),"-y","-f","lavfi","-i","color=c=blue:s=320x180:r=10","-t","0.3","-pix_fmt","yuv420p",str(ROOT/"sample.mp4")])
    video=upload(ROOT/"sample.mp4","ci-test-token")
    process({"op":"media","input":video["file_id"],"format":"mkv"},"ci-test-token")
    process({"op":"media","input":video["file_id"],"format":"gif"},"ci-test-token"); print("13. MPEG-4 -> MKV/GIF: OK")

    process({"op":"pdf_compress","input":pdf["file_id"]},"ci-test-token"); print("14. qpdf PDF operation: OK")

    txt=ROOT/"sample.txt"; txt.write_text("OmniConverter CI",encoding="utf-8")
    txtup=upload(txt,"ci-test-token")
    process({"op":"office_convert","input":txtup["file_id"],"format":"pdf"},"ci-test-token")
    csv=ROOT/"sample.csv"; csv.write_text("Name,Value\\nOmni,42\\n",encoding="utf-8"); csvup=upload(csv,"ci-test-token")
    process({"op":"office_convert","input":csvup["file_id"],"format":"xlsx"},"ci-test-token")
    process({"op":"office_convert","input":csvup["file_id"],"format":"ods"},"ci-test-token"); print("15. LibreOffice document/spreadsheet conversion: OK")

    html=ROOT/"sample.html"; html.write_text("<html><body><h1>OmniConverter CI</h1></body></html>",encoding="utf-8")
    htmlup=upload(html,"ci-test-token")
    process({"op":"ebook_convert","input":htmlup["file_id"],"format":"epub"},"ci-test-token"); print("16. Calibre ebook conversion: OK")

    print("Expanded native format smoke test: PASS")
finally:
    if server:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(ROOT,ignore_errors=True)
