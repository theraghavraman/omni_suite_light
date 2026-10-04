"""
OmniConverter Data Studio engine.
"""
from __future__ import annotations
import json, sqlite3
from pathlib import Path

DATA_FORMATS = {"csv","tsv","txt","json","jsonl","ndjson","yaml","yml","xml","html","md","xlsx","xls","xlsb","ods","parquet","feather","arrow","ipc","orc","avro","sqlite","db","duckdb","sql","dta","sas","sav","msgpack","mpk"}
SQL_DIALECTS = ["oracle","tsql","postgres","mysql","sqlite","duckdb","snowflake","bigquery","databricks","redshift","spark","trino","presto","clickhouse","hive","teradata","athena","doris","drill","druid","materialize","singlestore","starrocks","tableau"]

def _mod(name, package=None):
    try: return __import__(name)
    except Exception as exc: raise RuntimeError(f"Python package '{package or name}' is required for this Data Studio operation. Run the Local Engine data setup.") from exc

def module_status():
    names=["pandas","pyarrow","duckdb","yaml","sqlglot","openpyxl","xlrd","pyxlsb","odf","lxml","fastavro","bson","msgpack"]
    out={}
    for name in names:
        try: __import__(name); out[name]=True
        except Exception: out[name]=False
    return out

def ext(path, override=None):
    return str(override or Path(path).suffix).lower().lstrip(".").replace("ndjson","jsonl")

def _records(obj):
    if isinstance(obj,list): return obj
    if isinstance(obj,dict):
        for key in ("records","data","items","documents","rows"):
            if isinstance(obj.get(key),list): return obj[key]
        return [obj]
    return [{"value":obj}]

def _df_from_records(obj):
    pd=_mod("pandas"); records=_records(obj)
    if records and all(isinstance(x,dict) for x in records): return pd.json_normalize(records,sep=".")
    return pd.DataFrame(records)

def read_data(path,fmt=None):
    pd=_mod("pandas"); fmt=ext(path,fmt)
    if fmt in {"csv","tsv","txt"}: return pd.read_csv(path,sep="\\t" if fmt=="tsv" else ",")
    if fmt in {"json","jsonl"}:
        if fmt=="jsonl": return pd.read_json(path,lines=True)
        with open(path,"r",encoding="utf-8-sig") as fh: return _df_from_records(json.load(fh))
    if fmt in {"yaml","yml"}:
        yaml=_mod("yaml","PyYAML")
        with open(path,"r",encoding="utf-8-sig") as fh: return _df_from_records(yaml.safe_load(fh))
    if fmt=="xml": return pd.read_xml(path)
    if fmt=="html":
        tables=pd.read_html(path)
        if not tables: raise RuntimeError("No HTML tables found")
        return tables[0]
    if fmt=="xlsx": return pd.read_excel(path,engine="openpyxl")
    if fmt=="xls": return pd.read_excel(path,engine="xlrd")
    if fmt=="xlsb": return pd.read_excel(path,engine="pyxlsb")
    if fmt=="ods": return pd.read_excel(path,engine="odf")
    if fmt=="parquet": return pd.read_parquet(path)
    if fmt in {"feather","arrow","ipc"}: return pd.read_feather(path)
    if fmt=="orc": return pd.read_orc(path)
    if fmt=="avro":
        fastavro=_mod("fastavro")
        with open(path,"rb") as fh: return _df_from_records(list(fastavro.reader(fh)))
    if fmt in {"sqlite","db"}:
        con=sqlite3.connect(path)
        try:
            tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            if not tables: raise RuntimeError("SQLite database contains no user tables")
            q=tables[0].replace('"','""'); return pd.read_sql_query(f'SELECT * FROM "{q}"',con)
        finally: con.close()
    if fmt=="duckdb":
        duckdb=_mod("duckdb"); con=duckdb.connect(str(path),read_only=True)
        try:
            tables=con.execute("SHOW TABLES").fetchall()
            if not tables: raise RuntimeError("DuckDB contains no tables")
            q=tables[0][0].replace('"','""'); return con.execute(f'SELECT * FROM "{q}"').df()
        finally: con.close()
    if fmt=="sql":
        text=Path(path).read_text(encoding="utf-8-sig",errors="replace"); con=sqlite3.connect(":memory:")
        try:
            con.executescript(text); tables=[r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
            if not tables: raise RuntimeError("SQL contains no SQLite-compatible tables")
            q=tables[0].replace('"','""'); return pd.read_sql_query(f'SELECT * FROM "{q}"',con)
        except Exception as exc: raise RuntimeError("SQL input is not SQLite-compatible. Use SQL Dialect Converter first.") from exc
        finally: con.close()
    if fmt=="msgpack":
        msgpack=_mod("msgpack")
        with open(path,"rb") as fh: return _df_from_records(msgpack.unpack(fh,raw=False))
    if fmt=="dta": return pd.read_stata(path)
    if fmt=="sas": return pd.read_sas(path)
    if fmt=="sav": return pd.read_spss(path)
    raise RuntimeError(f"Unsupported Data Studio input format: {fmt}")

def _literal(value):
    import math
    if value is None: return "NULL"
    if hasattr(value,"item"):
        try: value=value.item()
        except Exception: pass
    if isinstance(value,bool): return "TRUE" if value else "FALSE"
    if isinstance(value,(int,float)) and not isinstance(value,bool):
        if isinstance(value,float) and (math.isnan(value) or math.isinf(value)): return "NULL"
        return str(value)
    if hasattr(value,"isoformat") and not isinstance(value,str):
        try: return "'" + value.isoformat(sep=" ").replace("'","''") + "'"
        except Exception: pass
    return "'" + str(value).replace("'","''") + "'"

def _ident(name,dialect):
    name=str(name).strip() or "column"
    if dialect=="mysql": return chr(96)+name.replace(chr(96),chr(96)*2)+chr(96)
    if dialect=="tsql": return "["+name.replace("]","]]")+"]"
    return '"'+name.replace('"','""')+'"'

def _type(dtype):
    s=str(dtype).lower()
    if "bool" in s: return "BOOLEAN"
    if "int" in s: return "BIGINT"
    if "float" in s or "double" in s: return "DOUBLE"
    if "datetime" in s or "timestamp" in s: return "TIMESTAMP"
    if "date" in s: return "DATE"
    return "TEXT"

def dataframe_sql(df,table,dialect="sqlite"):
    cols=",\\n  ".join(f"{_ident(c,dialect)} {_type(df[c].dtype)}" for c in df.columns)
    names=", ".join(_ident(c,dialect) for c in df.columns)
    lines=[f"CREATE TABLE {_ident(table,dialect)} (\\n  {cols}\\n);"]
    for row in df.itertuples(index=False,name=None): lines.append(f"INSERT INTO {_ident(table,dialect)} ({names}) VALUES ({', '.join(_literal(v) for v in row)});")
    return "\\n".join(lines)+"\\n"

def write_data(df,out,fmt,table="data",dialect="sqlite"):
    fmt=ext(out,fmt)
    if fmt=="csv": df.to_csv(out,index=False)
    elif fmt=="tsv": df.to_csv(out,index=False,sep="\\t")
    elif fmt=="json": df.to_json(out,orient="records",indent=2,date_format="iso")
    elif fmt=="jsonl": df.to_json(out,orient="records",lines=True,date_format="iso")
    elif fmt in {"yaml","yml"}:
        yaml=_mod("yaml","PyYAML"); payload=json.loads(df.to_json(orient="records",date_format="iso")); Path(out).write_text(yaml.safe_dump(payload,sort_keys=False,allow_unicode=True),encoding="utf-8")
    elif fmt=="xml": df.to_xml(out,index=False,root_name="data",row_name="row")
    elif fmt=="html": df.to_html(out,index=False)
    elif fmt=="md": Path(out).write_text(df.to_markdown(index=False),encoding="utf-8")
    elif fmt=="xlsx": df.to_excel(out,index=False,engine="openpyxl")
    elif fmt=="ods": df.to_excel(out,index=False,engine="odf")
    elif fmt=="parquet": df.to_parquet(out,index=False,engine="pyarrow")
    elif fmt in {"feather","arrow","ipc"}: df.reset_index(drop=True).to_feather(out)
    elif fmt=="orc": df.to_orc(out,index=False,engine="pyarrow")
    elif fmt=="avro":
        fastavro=_mod("fastavro"); records=json.loads(df.to_json(orient="records",date_format="iso")); schema={"type":"record","name":"OmniData","fields":[{"name":str(c),"type":["null","string"],"default":None} for c in df.columns]}
        with open(out,"wb") as fh: fastavro.writer(fh,schema,records)
    elif fmt in {"sqlite","db"}:
        con=sqlite3.connect(out); df.to_sql(table,con,if_exists="replace",index=False); con.close()
    elif fmt=="duckdb":
        duckdb=_mod("duckdb"); con=duckdb.connect(str(out)); con.register("_omni_df",df); q=table.replace('"','""'); con.execute(f'CREATE OR REPLACE TABLE "{q}" AS SELECT * FROM _omni_df'); con.close()
    elif fmt=="sql": Path(out).write_text(dataframe_sql(df,table,dialect),encoding="utf-8")
    elif fmt=="msgpack":
        msgpack=_mod("msgpack")
        with open(out,"wb") as fh: msgpack.pack(json.loads(df.to_json(orient="records",date_format="iso")),fh,use_bin_type=True)
    elif fmt=="jsonschema":
        props={}
        for c in df.columns:
            s=str(df[c].dtype).lower(); typ="boolean" if "bool" in s else "number" if "int" in s or "float" in s else "string"; props[str(c)]={"type":typ}
        Path(out).write_text(json.dumps({"$schema":"https://json-schema.org/draft/2020-12/schema","type":"array","items":{"type":"object","properties":props}},indent=2),encoding="utf-8")
    else: raise RuntimeError(f"Unsupported Data Studio output format: {fmt}")

def blob_convert(inp,out,source,target):
    source=source.lower(); target=target.lower()
    if source=="binary":
        raw=Path(inp).read_bytes()
    elif source=="base64":
        import base64
        raw=base64.b64decode(Path(inp).read_text(encoding="utf-8").strip(),validate=True)
    elif source=="hex":
        raw=bytes.fromhex(Path(inp).read_text(encoding="utf-8").strip())
    else:
        raise RuntimeError("BLOB source must be binary, base64 or hex")
    if target=="binary":
        Path(out).write_bytes(raw)
    elif target=="base64":
        import base64
        Path(out).write_text(base64.b64encode(raw).decode("ascii"),encoding="utf-8")
    elif target=="hex":
        Path(out).write_text(raw.hex(),encoding="utf-8")
    elif target=="sql":
        Path(out).write_text("X'"+raw.hex().upper()+"'\n",encoding="utf-8")
    else:
        raise RuntimeError("BLOB target must be binary, base64, hex or sql")

def text_lines(path,target):
    lines=Path(path).read_text(encoding="utf-8-sig",errors="replace").splitlines()
    records=[{"line_number":i+1,"text":line} for i,line in enumerate(lines)]
    if target=="json":
        return json.dumps(records,indent=2,ensure_ascii=False)
    if target in {"jsonl","ndjson"}:
        return "\n".join(json.dumps(x,ensure_ascii=False) for x in records)+"\n"
    if target=="csv":
        import csv, io
        buf=io.StringIO(); w=csv.DictWriter(buf,fieldnames=["line_number","text"]); w.writeheader(); w.writerows(records); return buf.getvalue()
    raise RuntimeError("Text/Log target must be JSON, JSONL or CSV")

def profile(path,fmt=None):
    df=read_data(path,fmt); cols=[]
    for c in df.columns:
        s=df[c]; cols.append({"name":str(c),"dtype":str(s.dtype),"nulls":int(s.isna().sum()),"unique":int(s.nunique(dropna=True))})
    return {"rows":int(len(df)),"columns":int(len(df.columns)),"columns_detail":cols}

def transpile_sql(text,source,target):
    sqlglot=_mod("sqlglot"); return "\\n\\n".join(sqlglot.transpile(text,read=source,write=target,pretty=True))

def schema(path,fmt,dialect,table): return dataframe_sql(read_data(path,fmt),table,dialect)

def _ddb_unwrap(v):
    if isinstance(v,dict) and len(v)==1:
        k,x=next(iter(v.items()))
        if k=="S": return x
        if k=="N": return float(x) if "." in str(x) else int(x)
        if k=="BOOL": return bool(x)
        if k=="NULL": return None
        if k=="B": return {"$binary":x}
        if k=="L": return [_ddb_unwrap(i) for i in x]
        if k=="M": return {kk:_ddb_unwrap(vv) for kk,vv in x.items()}
    if isinstance(v,dict): return {k:_ddb_unwrap(x) for k,x in v.items()}
    if isinstance(v,list): return [_ddb_unwrap(x) for x in v]
    return v

def _ddb_wrap(v):
    if v is None: return {"NULL":True}
    if isinstance(v,bool): return {"BOOL":v}
    if isinstance(v,(int,float)): return {"N":str(v)}
    if isinstance(v,dict):
        if set(v)=={"$binary"}: return {"B":v["$binary"]}
        return {"M":{k:_ddb_wrap(x) for k,x in v.items()}}
    if isinstance(v,list): return {"L":[_ddb_wrap(x) for x in v]}
    return {"S":str(v)}

def nosql_convert(inp,out,source,target):
    source=source.lower().lstrip("."); target=target.lower().lstrip(".")
    if source=="bson":
        bson=_mod("bson","pymongo")
        with open(inp,"rb") as fh: records=bson.decode_all(fh)
    else:
        text=Path(inp).read_text(encoding="utf-8-sig",errors="replace")
        if source in {"json","mongojson","jsonl","ndjson"}: records=[json.loads(x) for x in text.splitlines() if x.strip()] if source in {"jsonl","ndjson"} else _records(json.loads(text))
        elif source=="dynamodb-json": records=[_ddb_unwrap(x) for x in _records(json.loads(text))]
        else: raise RuntimeError("NoSQL Bridge accepts JSON/NDJSON/Mongo BSON/DynamoDB JSON document exports.")
    if target=="bson":
        bson=_mod("bson","pymongo")
        with open(out,"wb") as fh:
            for rec in records: fh.write(bson.BSON.encode(rec))
    elif target in {"json","mongojson"}: Path(out).write_text(json.dumps(records,indent=2,default=str),encoding="utf-8")
    elif target in {"jsonl","ndjson"}: Path(out).write_text("\\n".join(json.dumps(x,default=str) for x in records)+"\\n",encoding="utf-8")
    elif target=="dynamodb-json": Path(out).write_text(json.dumps([_ddb_wrap(x) for x in records],indent=2,default=str),encoding="utf-8")
    elif target=="csv": _df_from_records(records).to_csv(out,index=False)
    elif target=="sql": Path(out).write_text(dataframe_sql(_df_from_records(records),"documents","sqlite"),encoding="utf-8")
    elif target=="cql":
        df=_df_from_records(records); cols=", ".join(f'"{str(c).replace(chr(34),chr(34)*2)}" {"bigint" if "int" in str(df[c].dtype).lower() else "double" if "float" in str(df[c].dtype).lower() else "text"}' for c in df.columns); Path(out).write_text(f'CREATE TABLE "documents" ({cols});\\n',encoding="utf-8")
    elif target=="cypher":
        lines=[]
        for row in _df_from_records(records).to_dict(orient="records"):
            props=", ".join(str(k)+": "+_literal(v) for k,v in row.items()); lines.append("CREATE (n:Document {"+props+"});")
        Path(out).write_text("\\n".join(lines)+"\\n",encoding="utf-8")
    else: raise RuntimeError("Unsupported NoSQL target")
