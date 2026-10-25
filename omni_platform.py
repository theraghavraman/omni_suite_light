"""Omni Suite platform services: capability discovery, dependency health, batch jobs,
data cleaning and privacy inspection. These helpers are intentionally local-only.
"""
from __future__ import annotations
import hashlib, importlib.util, json, re, shutil, subprocess
from pathlib import Path
from typing import Any
from omni_environment import PYTHON_IMPORTS as PYTHON_PACKAGES, OPTIONAL_PYTHON_IMPORTS, NATIVE_TOOLS, find_native_tool_path


DATA_BROWSER = {"csv","tsv","txt","json","jsonl","ndjson","yaml","yml","xml","html","md"}
DATABASE_FORMATS = {"sqlite","db","duckdb","sql","parquet","csv","json","jsonl","xlsx","ods"}
PRIVACY_PATTERNS = {
    "email": re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",re.I),
    # Separators are limited to space/dot/dash/parentheses on ONE line (no \n, \t or commas),
    # so values in adjacent CSV cells or rows are never glued together. Validated by _valid_phone().
    "phone": re.compile(r"(?<![\w+])(?<!\d[ ().-])\+?\(?(?:\d[ ().-]{0,2}){9,14}\d(?!\w)(?![ ().-]{1,2}\d)"),
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
            python[label]={"installed":bool(spec), "optional":label in OPTIONAL_PYTHON_IMPORTS}
            if spec: python[label]["origin"]=str(spec.origin or "")
        except Exception: python[label]={"installed":False, "optional":label in OPTIONAL_PYTHON_IMPORTS}
    native={}
    for label,(cmd,package) in NATIVE_TOOLS.items():
        path=find_native_tool_path(cmd)
        native[label]={"installed":bool(path),"path":path,"version":_version(path) if path else None,"package":package}
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

_ISO_DATE = re.compile(r"^\d{4}[-./]\d{1,2}[-./]\d{1,2}$")

def _valid_phone(text):
    digits = re.sub(r"\D", "", text)
    return 10 <= len(digits) <= 15 and not _ISO_DATE.match(text.strip())

PRIVACY_VALIDATORS = {"phone": _valid_phone}

def _mask(value):
    v = str(value)
    return v if len(v) <= 4 else v[:2] + "*" * (len(v) - 4) + v[-2:]

def privacy_scan(path, max_bytes=8_000_000):
    p=Path(path)
    with p.open("rb") as source:
        raw=source.read(max_bytes)
    text=raw.decode("utf-8",errors="replace")
    findings=[]
    for kind,rx in PRIVACY_PATTERNS.items():
        check=PRIVACY_VALIDATORS.get(kind)
        matches=[m for m in rx.finditer(text) if not check or check(m.group(0))]
        if matches:
            # Samples are masked so the report itself does not leak the personal data it found.
            findings.append({"type":kind,"count":len(matches),"samples":[_mask(m.group(0)[:80]) for m in matches[:3]]})
    sha256=hashlib.sha256(raw).hexdigest()
    return {"file":p.name,"bytes_scanned":len(raw),"truncated":p.stat().st_size>len(raw),"sha256":sha256,"findings":findings,
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
        elif name=="mask_pii":
            masked=[PRIVACY_PATTERNS[k] for k in ("email","pan_india","aadhaar_like","credit_card_like","phone")]
            def _mask_text(x):
                if not isinstance(x,str): return x
                for rx in masked: x=rx.sub(lambda m:_mask_value(m.group(0)),x)
                return x
            for c in out.select_dtypes(include=["object","string"]).columns: out[c]=out[c].map(_mask_text)
    return out

def _mask_value(v):
    s=str(v)
    return "****" if len(s)<=4 else s[:2]+"*"*max(2,len(s)-4)+s[-2:]

def _validate_database_url(url):
    from omni_security_primitives import validate_db_destination
    from pathlib import Path
    import os
    sqlite_root=os.environ.get("OMNI_ALLOWED_SQLITE_DIR")
    if not sqlite_root:
        raise ValueError("Database Studio is disabled until OMNI_ALLOWED_SQLITE_DIR points to an approved read-only SQLite directory.")
    scheme, destination=validate_db_destination(str(url or ""), sqlite_root=Path(sqlite_root))
    if scheme != "sqlite":
        raise ValueError("Remote database access is disabled until read-only database roles, an AST policy, query timeouts and egress controls are configured.")
    return Path(destination)

def database_query(url, query, params=None):
    database_file=_validate_database_url(url)
    return __import__("omni_security_primitives").read_sqlite_only(database_file, query, params or {})

def database_tables(url):
    import sqlite3
    database_file=_validate_database_url(url)
    con=sqlite3.connect(database_file.as_uri()+"?mode=ro",uri=True,timeout=2)
    try:
        con.execute("PRAGMA query_only=ON")
        names=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 1000")]
        tables={name:[r[1] for r in con.execute('PRAGMA table_info("'+name.replace('"','""')+'")')][:1000] for name in names}
        return {"schemas":["main"],"tables":{"main":names},"columns":tables}
    finally:
        con.close()

def batch_manifest(results):
    return {"total":len(results),"success":sum(1 for x in results if x.get("ok")),"failed":sum(1 for x in results if not x.get("ok")),"results":results}
