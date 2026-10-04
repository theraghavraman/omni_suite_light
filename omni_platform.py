"""Omni Suite platform services: capability discovery, dependency health, batch jobs,
data cleaning and privacy inspection. These helpers are intentionally local-only.
"""
from __future__ import annotations
import hashlib, importlib.util, json, re, shutil, subprocess
from pathlib import Path
from typing import Any

PYTHON_PACKAGES = {
    "pandas":"pandas","numpy":"numpy","pyarrow":"pyarrow","duckdb":"duckdb",
    "openpyxl":"openpyxl","xlrd":"xlrd","pyxlsb":"pyxlsb","odfpy":"odf",
    "fastavro":"fastavro","pyreadstat":"pyreadstat","tabulate":"tabulate",
    "polars":"polars","fastparquet":"fastparquet","scipy":"scipy","sympy":"sympy",
    "sqlalchemy":"sqlalchemy","psycopg":"psycopg","mysql_connector":"mysql.connector",
    "oracledb":"oracledb","pyodbc":"pyodbc","py7zr":"py7zr","rarfile":"rarfile",
    "imageio":"imageio","pydub":"pydub","moviepy":"moviepy","easyocr":"easyocr",
    "pymongo":"pymongo","msgpack":"msgpack","xarray":"xarray","netCDF4":"netCDF4",
    "h5py":"h5py","astropy":"astropy","cdflib":"cdflib","cfgrib":"cfgrib",
    "eccodes":"eccodes","Pillow":"PIL",
    "duckdb_engine":"duckdb_engine","snowflake_sqlalchemy":"snowflake.sqlalchemy","google_cloud_bigquery":"google.cloud.bigquery",
    "databricks_sql_connector":"databricks.sql","trino":"trino","clickhouse_sqlalchemy":"clickhouse_sqlalchemy","sqlalchemy_redshift":"sqlalchemy_redshift",
    "cassandra_driver":"cassandra","redis":"redis","neo4j":"neo4j","boto3":"boto3","fsspec":"fsspec","s3fs":"s3fs","gcsfs":"gcsfs",
}
NATIVE_TOOLS = {
    "ffmpeg":("ffmpeg","ffmpeg"), "qpdf":("qpdf","qpdf"), "pdftoppm":("pdftoppm","poppler"),
    "pdftotext":("pdftotext","poppler"), "magick":("magick","ImageMagick"),
    "convert":("convert","ImageMagick"), "tesseract":("tesseract","Tesseract"),
    "libreoffice":("libreoffice","LibreOffice"), "soffice":("soffice","LibreOffice"),
    "ebook-convert":("ebook-convert","Calibre"), "pandoc":("pandoc","Pandoc"),
    "ffprobe":("ffprobe","FFmpeg"), "7z":("7z","7-Zip"), "7zz":("7zz","7-Zip"),
    "zip":("zip","Info-ZIP"), "unzip":("unzip","Info-ZIP"), "gzip":("gzip","gzip"), "bzip2":("bzip2","bzip2"), "xz":("xz","xz"),
    "tar":("tar","tar"), "gs":("gs","Ghostscript"), "sqlite3":("sqlite3","SQLite"), "psql":("psql","PostgreSQL client"),
    "mysql":("mysql","MySQL client"), "isql":("isql","unixODBC"),
}
DATA_BROWSER = {"csv","tsv","txt","json","jsonl","ndjson","yaml","yml","xml","html","md"}
DATABASE_FORMATS = {"sqlite","db","duckdb","sql","parquet","csv","json","jsonl","xlsx","ods"}
PRIVACY_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",re.I),
    "phone": re.compile(r"(?<!\d)(?:\+?\d[\d\s().-]{8,}\d)(?!\d)"),
    "ipv4": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "url": re.compile(r'\bhttps?://[^\s<>"]+',re.I),
    "pan_india": re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b",re.I),
    "aadhaar_like": re.compile(r"(?<!\d)\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)"),
    "credit_card_like": re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"),
}

def _version(cmd):
    try:
        p=subprocess.run([cmd,"--version"],capture_output=True,text=True,timeout=5)
        return (p.stdout or p.stderr).splitlines()[0][:180] if p.returncode==0 else None
    except Exception: return None

def doctor():
    python={}
    for label,mod in PYTHON_PACKAGES.items():
        try:
            spec=importlib.util.find_spec(mod)
            python[label]={"installed":bool(spec)}
            if spec: python[label]["origin"]=str(spec.origin or "")
        except Exception: python[label]={"installed":False}
    native={}
    for label,(cmd,package) in NATIVE_TOOLS.items():
        path=shutil.which(cmd)
        native[label]={"installed":bool(path),"path":path,"version":_version(cmd) if path else None,"package":package}
    return {"python":python,"native":native}

def capability(source=None,target=None):
    s=(source or "").lower().lstrip("."); t=(target or "").lower().lstrip(".")
    if not s or not t:
        return {"mode":"unknown","reason":"Select an input and target first."}
    if s in DATA_BROWSER and t in DATA_BROWSER:
        return {"mode":"browser","reason":"Text/structured format can use the browser-first path.","local_fallback":True}
    if s in {"csv","tsv","json","jsonl","ndjson","yaml","yml"} and t in {"xlsx","ods","html","md","parquet","feather","arrow"}:
        return {"mode":"browser-first","reason":"Browser path is preferred; Local Engine remains available for scale/fidelity.","local_fallback":True}
    if s in {"pdf"} and t in {"png","jpg","jpeg","txt"}:
        return {"mode":"browser","reason":"Browser renderer can handle this path.","local_fallback":True}
    return {"mode":"local","reason":"Native/binary/specialist parser is required for reliable conversion.","local_fallback":False}

def _read_text(path):
    return Path(path).read_text(encoding="utf-8-sig",errors="replace")

def privacy_scan(path, max_bytes=8_000_000):
    p=Path(path); raw=p.read_bytes()[:max_bytes]
    text=raw.decode("utf-8",errors="replace")
    findings=[]
    for kind,rx in PRIVACY_PATTERNS.items():
        matches=list(rx.finditer(text))
        if matches:
            findings.append({"type":kind,"count":len(matches),"samples":[m.group(0)[:80] for m in matches[:3]]})
    sha256=hashlib.sha256(raw).hexdigest()
    return {"file":p.name,"bytes_scanned":len(raw),"sha256":sha256,"findings":findings,
            "risk":"high" if any(x["type"] in {"credit_card_like","aadhaar_like","pan_india"} for x in findings) else ("medium" if findings else "low")}

def clean_dataframe(df, actions):
    out=df.copy()
    for action in actions or []:
        name=action if isinstance(action,str) else action.get("action")
        if name=="drop_duplicates": out=out.drop_duplicates()
        elif name=="trim_strings":
            for c in out.select_dtypes(include=["object","string"]).columns: out[c]=out[c].map(lambda x:x.strip() if isinstance(x,str) else x)
        elif name=="lower_columns": out.columns=[str(c).strip().lower().replace(" ","_") for c in out.columns]
        elif name=="drop_empty_rows": out=out.dropna(how="all")
        elif name=="fill_numeric_zero": out[out.select_dtypes(include="number").columns]=out.select_dtypes(include="number").fillna(0)
        elif name=="sort_columns": out=out.reindex(sorted(out.columns),axis=1)
    return out

def database_query(url, query, params=None):
    from sqlalchemy import create_engine, text
    normalized=re.sub(r"^\s*--[^\n]*\n","",query or "").strip().lower()
    if not re.match(r"^(select|with|show|describe|desc|explain|pragma)\b",normalized):
        raise ValueError("Database Studio is read-only: only SELECT/WITH/SHOW/DESCRIBE/EXPLAIN/PRAGMA queries are allowed.")
    engine=create_engine(url, pool_pre_ping=True)
    try:
        with engine.connect() as con:
            result=con.execute(text(query), params or {})
            rows=[dict(r._mapping) for r in result]
            columns=list(result.keys())
        return {"columns":columns,"rows":rows,"row_count":len(rows)}
    finally: engine.dispose()

def database_tables(url):
    from sqlalchemy import create_engine, inspect
    engine=create_engine(url, pool_pre_ping=True)
    try:
        ins=inspect(engine)
        return {"schemas":ins.get_schema_names(),"tables":{s:ins.get_table_names(schema=s) for s in ins.get_schema_names()}}
    finally: engine.dispose()

def batch_manifest(results):
    return {"total":len(results),"success":sum(1 for x in results if x.get("ok")),"failed":sum(1 for x in results if not x.get("ok")),"results":results}
