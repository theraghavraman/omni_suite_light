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
    try:
        with request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except Exception as exc:
        if hasattr(exc, "read"):
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"Local Engine request failed: {getattr(exc, 'code', '?')} {detail}") from exc
        raise

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
    assert int(health.get("engine_api_version") or 0) >= 4, "Local Engine API v4+ is required; stale engine detected"
    assert health.get("engine_build"), "Local Engine build identifier is required"
    print("1. Local Engine health/API contract: OK")
    caps=health.get("capabilities",{})
    required={"media_video":["mp4","mpeg","mkv","gif"],"media_audio":["mp3","flac","opus","wma"],"image":["svg","gif","tiff","heic"],"office":["docx","docm","xlsx","xlsm","pptx","pptm","odp"],"ebook":["epub","mobi","azw3","cbz","cbr","djvu"]}
    missing=[f"{k}:{v}" for k,vals in required.items() for v in vals if v not in caps.get(k,[])]
    assert not missing, "Missing native capabilities: "+", ".join(missing)
    print("2. Native format capability inventory: OK")

    magick=which("magick","convert")
    image=ROOT/"sample.png"
    run([magick,"-size","500x120","xc:white",str(image)])
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

    svg=ROOT/"sample.svg"; svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="white"/><rect x="20" y="20" width="120" height="80" fill="black"/><circle cx="240" cy="60" r="40" fill="gray"/></svg>',encoding="utf-8")
    svgup=upload(svg,"ci-test-token")
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

    data_caps=health.get("data",{})
    assert data_caps.get("modules",{}).get("pandas"), "pandas is required for Data Studio CI"
    assert data_caps.get("modules",{}).get("pyarrow"), "pyarrow is required for Data Studio CI"
    assert data_caps.get("modules",{}).get("sqlglot"), "sqlglot is required for Data Studio CI"
    assert data_caps.get("modules",{}).get("tabulate"), "tabulate is required for Data Studio CI"
    data_csv=ROOT/"data.csv"; data_csv.write_text("id,name,amount\n1,Alice,10.5\n2,Bob,20\n",encoding="utf-8")
    data_up=upload(data_csv,"ci-test-token")
    out=process({"op":"data_convert","input":data_up["file_id"],"format":"json"},"ci-test-token"); download(out["file_id"],ROOT/"data.json","ci-test-token")
    out=process({"op":"data_convert","input":data_up["file_id"],"format":"parquet"},"ci-test-token"); download(out["file_id"],ROOT/"data.parquet","ci-test-token")
    out=process({"op":"data_convert","input":data_up["file_id"],"format":"xlsx"},"ci-test-token"); download(out["file_id"],ROOT/"data.xlsx","ci-test-token")
    out=process({"op":"data_convert","input":data_up["file_id"],"format":"md"},"ci-test-token"); download(out["file_id"],ROOT/"data.md","ci-test-token"); assert "Alice" in (ROOT/"data.md").read_text(encoding="utf-8")
    print("17. Data Studio CSV -> JSON/Parquet/XLSX: OK")

    # Round-trip integrity: CSV -> Parquet -> CSV must preserve normalized values.
    out=process({"op":"data_convert","input":data_up["file_id"],"format":"parquet"},"ci-test-token")
    download(out["file_id"],ROOT/"roundtrip.parquet","ci-test-token")
    rt=upload(ROOT/"roundtrip.parquet","ci-test-token")
    out=process({"op":"data_convert","input":rt["file_id"],"format":"csv"},"ci-test-token")
    download(out["file_id"],ROOT/"roundtrip.csv","ci-test-token")
    roundtrip_text=(ROOT/"roundtrip.csv").read_text(encoding="utf-8")
    assert "Alice" in roundtrip_text and "20" in roundtrip_text

    # Avro must preserve numeric/boolean types instead of coercing every field to string.
    typed=ROOT/"typed.csv"; typed.write_text("id,amount,active\n1,10.5,true\n2,20.0,false\n",encoding="utf-8")
    typed_up=upload(typed,"ci-test-token")
    out=process({"op":"data_convert","input":typed_up["file_id"],"format":"avro"},"ci-test-token")
    download(out["file_id"],ROOT/"typed.avro","ci-test-token")
    import fastavro
    with open(ROOT/"typed.avro","rb") as fh:
        avro_rows=list(fastavro.reader(fh))
    assert isinstance(avro_rows[0]["id"],int)
    assert isinstance(avro_rows[0]["amount"],float)
    assert isinstance(avro_rows[0]["active"],bool)

    # Database conversion must allow an explicit table instead of silently taking the first table.
    db=ROOT/"multi.sqlite"
    import sqlite3
    con=sqlite3.connect(db)
    con.execute("create table customers(id integer,name text)")
    con.execute("create table orders(id integer,total real)")
    con.execute("insert into customers values(1,'Alice')")
    con.execute("insert into orders values(7,99.5)")
    con.commit(); con.close()
    dbup=upload(db,"ci-test-token")
    out=process({"op":"data_convert","input":dbup["file_id"],"format":"json","table":"orders"},"ci-test-token")
    download(out["file_id"],ROOT/"orders.json","ci-test-token")
    orders_text=(ROOT/"orders.json").read_text(encoding="utf-8")
    assert "99.5" in orders_text and "Alice" not in orders_text
    print("17b. Data Studio round-trip, Avro typing, and explicit DB table selection: OK")

    yaml_file=ROOT/"data.yaml"; yaml_file.write_text("records:\n  - id: 1\n    name: Alice\n  - id: 2\n    name: Bob\n",encoding="utf-8")
    yaml_up=upload(yaml_file,"ci-test-token")
    process({"op":"data_convert","input":yaml_up["file_id"],"format":"json"},"ci-test-token")
    process({"op":"data_convert","input":data_up["file_id"],"format":"yaml"},"ci-test-token")
    print("18. YAML/JSON structured-data conversion: OK")

    sql_file=ROOT/"oracle.sql"; sql_file.write_text("SELECT NVL(amount, 0) AS amount FROM sales WHERE id = 1",encoding="utf-8")
    sql_up=upload(sql_file,"ci-test-token")
    out=process({"op":"sql_transpile","input":sql_up["file_id"],"source":"oracle","target":"tsql"},"ci-test-token")
    download(out["file_id"],ROOT/"tsql.sql","ci-test-token")
    out=process({"op":"schema_generate","input":data_up["file_id"],"source_format":"csv","dialect":"postgres","table":"sales"},"ci-test-token")
    download(out["file_id"],ROOT/"schema.sql","ci-test-token")
    out=process({"op":"data_profile","input":data_up["file_id"]},"ci-test-token")
    download(out["file_id"],ROOT/"profile.json","ci-test-token")
    print("19. SQL dialect translation/schema/profile: OK")

    sci_mods=health.get("python_modules",{})
    for mod in ("numpy","xarray","netCDF4","h5py","astropy"):
        assert sci_mods.get(mod), f"{mod} is required for scientific Local Engine CI"
    import numpy as np
    import xarray as xr
    sci_nc=ROOT/"science.nc"
    xr.Dataset({"temperature":(("y","x"),np.arange(12,dtype=float).reshape(3,4))}).to_netcdf(sci_nc)
    sci_up=upload(sci_nc,"ci-test-token")
    out=process({"op":"scientific_profile","input":sci_up["file_id"],"source_format":"netcdf"},"ci-test-token")
    prof=ROOT/"science_profile.json";download(out["file_id"],prof,"ci-test-token")
    assert "temperature" in prof.read_text(encoding="utf-8")
    for fmt in ("json","csv","png","hdf5","fits"):
        out=process({"op":"scientific_convert","input":sci_up["file_id"],"source_format":"netcdf","format":fmt},"ci-test-token")
        download(out["file_id"],ROOT/f"science.{('h5' if fmt=='hdf5' else fmt)}","ci-test-token")
    print("20. Scientific NetCDF -> JSON/CSV/PNG/HDF5/FITS + profile: OK")

    docs=ROOT/"documents.json"; docs.write_text(json.dumps([{"_id":"1","name":"Alice","score":10},{"_id":"2","name":"Bob","score":20}]),encoding="utf-8")
    docs_up=upload(docs,"ci-test-token")
    process({"op":"nosql_convert","input":docs_up["file_id"],"source":"json","target":"jsonl"},"ci-test-token")
    process({"op":"nosql_convert","input":docs_up["file_id"],"source":"json","target":"dynamodb-json"},"ci-test-token")
    process({"op":"nosql_convert","input":docs_up["file_id"],"source":"json","target":"csv"},"ci-test-token")
    print("21. NoSQL JSON/JSONL/DynamoDB/CSV bridge: OK")

    # CI coverage: privacy scanning should detect common sensitive-data patterns and emit a stable report.
    sensitive=ROOT/"sensitive.txt"; sensitive.write_text("Contact: test@example.com\nPhone: +91 98765 43210\n",encoding="utf-8")
    sensitive_up=upload(sensitive,"ci-test-token")
    out=process({"op":"privacy_scan","input":sensitive_up["file_id"]},"ci-test-token")
    download(out["file_id"],ROOT/"privacy.json","ci-test-token")
    privacy_text=(ROOT/"privacy.json").read_text(encoding="utf-8")
    assert "sha256" in privacy_text and "email" in privacy_text.lower()
    print("22. Privacy scan report/hash contract: OK")

    # CI coverage: Data Clean should remove duplicates and normalize whitespace.
    dirty=ROOT/"dirty.csv"; dirty.write_text("name,value\n Alice ,10\n Alice ,10\n Bob ,20\n",encoding="utf-8")
    dirty_up=upload(dirty,"ci-test-token")
    out=process({"op":"data_clean","input":dirty_up["file_id"],"format":"csv","actions":["drop_duplicates","trim_strings","normalize_columns"]},"ci-test-token")
    download(out["file_id"],ROOT/"clean.csv","ci-test-token")
    clean_text=(ROOT/"clean.csv").read_text(encoding="utf-8")
    assert clean_text.count("Alice") == 1 and " Alice " not in clean_text
    print("23. Data Clean duplicate/whitespace normalization: OK")

    # CI coverage: line-oriented conversion should produce valid JSON Lines.
    lines=ROOT/"lines.txt"; lines.write_text('{"id":1,"name":"Alice"}\n{"id":2,"name":"Bob"}\n',encoding="utf-8")
    lines_up=upload(lines,"ci-test-token")
    out=process({"op":"text_lines","input":lines_up["file_id"],"target":"jsonl"},"ci-test-token")
    download(out["file_id"],ROOT/"lines.jsonl","ci-test-token")
    jsonl=(ROOT/"lines.jsonl").read_text(encoding="utf-8").strip().splitlines()
    assert len(jsonl)==2 and json.loads(jsonl[0])["name"]=="Alice"
    print("24. Text-lines JSONL bridge: OK")

    # CI coverage: qpdf page splitting should return a non-empty ZIP of individual pages.
    out=process({"op":"pdf_split","input":pdf["file_id"]},"ci-test-token")
    download(out["file_id"],ROOT/"split.zip","ci-test-token")
    with zipfile.ZipFile(ROOT/"split.zip") as z: assert any(n.endswith(".pdf") for n in z.namelist())
    print("25. PDF split archive: OK")

    # CI coverage: 7z archive path should work through the native tool or py7zr fallback.
    out=process({"op":"archive","input":up["file_id"],"format":"7z"},"ci-test-token")
    download(out["file_id"],ROOT/"sample.7z","ci-test-token")
    assert (ROOT/"sample.7z").stat().st_size > 0
    print("27. 7z archive/fallback path: OK")

    print("Expanded native + Data Studio + Scientific smoke test: PASS")
finally:
    if server:
        server.terminate()
        try: server.wait(timeout=5)
        except subprocess.TimeoutExpired: server.kill()
    shutil.rmtree(ROOT,ignore_errors=True)
