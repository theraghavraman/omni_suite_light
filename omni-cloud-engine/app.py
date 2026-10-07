import os, io, json, csv, zipfile, tarfile, gzip, shutil, subprocess, tempfile, uuid, re, math, mimetypes
from pathlib import Path
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import pandas as pd
from PIL import Image
from pypdf import PdfReader, PdfWriter

app=Flask(__name__)
CORS(app, resources={r"/api/*":{"origins":"*"}})
app.config["MAX_CONTENT_LENGTH"]=int(os.getenv("MAX_UPLOAD_MB","500"))*1024*1024
ROOT=Path(tempfile.gettempdir())/"omni-cloud-jobs"; ROOT.mkdir(exist_ok=True)
JOBS={}

def job_new(kind):
    jid=uuid.uuid4().hex
    JOBS[jid]={"id":jid,"status":"processing","kind":kind,"progress":5}
    return jid
def run(cmd, cwd=None, timeout=900):
    p=subprocess.run(cmd,cwd=cwd,capture_output=True,text=True,timeout=timeout)
    if p.returncode: raise RuntimeError((p.stderr or p.stdout or "command failed")[-4000:])
    return p
def save_upload(f, d):
    name=Path(f.filename or "input.bin").name
    p=d/name; f.save(p); return p

@app.get("/api/health")
def health():
    ff=shutil.which("ffmpeg")
    lo=shutil.which("libreoffice")
    pd=shutil.which("pandoc")
    return jsonify(ok=True,service="omni-cloud-engine",version="1.0",tools={"ffmpeg":bool(ff),"libreoffice":bool(lo),"pandoc":bool(pd)})

@app.get("/api/capabilities")
def capabilities():
    return jsonify({
      "execution_modes":["browser","render","local"],
      "studios":["Social Media","PDF","Doc/Office","Universal Data","Data Cleaning","Database","RAG","Vector Search","Code","Image","Video","Compressor","Batch Processing","Diagnostics","Scheduled Automation","Cloud Jobs"],
      "operations":[
        "ffmpeg","media-transcode","image-batch","pdf-batch","ocr","office-convert","data-profile","data-clean","sql-simulate",
        "rag-ingest","vector-search","archive","batch-pipeline","diagnostics","code-format","metadata","file-convert"
      ]
    })

def output(jid,path,name=None,mime=None):
    JOBS[jid].update(status="ready",progress=100,filename=name or path.name)
    return send_file(path,as_attachment=True,download_name=name or path.name,mimetype=mime)

def data_profile(p,out):
    ext=p.suffix.lower()
    if ext in [".xlsx",".xls"]: df=pd.read_excel(p)
    elif ext==".json": df=pd.read_json(p)
    elif ext in [".jsonl",".ndjson"]: df=pd.read_json(p,lines=True)
    elif ext==".parquet": df=pd.read_parquet(p)
    elif ext==".xml": df=pd.read_xml(p)
    else: df=pd.read_csv(p)
    report={"file":p.name,"rows":len(df),"columns":len(df.columns),"columns_detail":[]}
    for c in df.columns:
        s=df[c]; report["columns_detail"].append({"name":str(c),"dtype":str(s.dtype),"nulls":int(s.isna().sum()),"unique":int(s.nunique(dropna=True))})
    out.write_text(json.dumps(report,indent=2,default=str))
    return out

def clean_data(p,out,opts):
    ext=p.suffix.lower()
    df=pd.read_excel(p) if ext in [".xlsx",".xls"] else pd.read_json(p,lines=True) if ext in [".jsonl",".ndjson"] else pd.read_csv(p)
    df.columns=[str(c).strip() for c in df.columns]
    for c in df.select_dtypes(include="object").columns: df[c]=df[c].map(lambda x:x.strip() if isinstance(x,str) else x)
    if opts.get("drop_duplicates",True): df=df.drop_duplicates()
    if opts.get("drop_empty_rows",False): df=df.dropna(how="all")
    if out.suffix.lower()==".xlsx": df.to_excel(out,index=False)
    else: df.to_csv(out,index=False)
    return out

@app.post("/api/process")
def process():
    form=request.form
    op=form.get("operation","file-convert")
    opts=json.loads(form.get("options","{}") or "{}")
    files=request.files.getlist("files")
    if not files: return jsonify(ok=False,error="No files supplied"),400
    jid=job_new(op); d=ROOT/jid; d.mkdir()
    try:
        src=[save_upload(f,d) for f in files]
        JOBS[jid]["progress"]=20
        if op in ("ffmpeg","media-transcode"):
            src0=src[0]; out=d/(src0.stem+"."+opts.get("format","mp4"))
            cmd=["ffmpeg","-y","-i",str(src0)]
            if opts.get("video_codec"): cmd+=["-c:v",opts["video_codec"]]
            if opts.get("audio_codec"): cmd+=["-c:a",opts["audio_codec"]]
            if opts.get("scale"): cmd+=["-vf","scale="+str(opts["scale"])]
            if opts.get("fps"): cmd+=["-r",str(opts["fps"])]
            if opts.get("start"): cmd+=["-ss",str(opts["start"])]
            if opts.get("duration"): cmd+=["-t",str(opts["duration"])]
            cmd += [str(out)]; run(cmd); return output(jid,out)
        if op=="image-batch":
            out=d/"omni-images.zip"
            with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
                for i,p in enumerate(src):
                    im=Image.open(p); im.thumbnail((int(opts.get("max_width",1920)),int(opts.get("max_height",1920))))
                    q=d/(f"{p.stem}.{opts.get('format','webp')}")
                    im.convert("RGB").save(q,quality=int(opts.get("quality",85))); z.write(q,q.name)
                    JOBS[jid]["progress"]=20+int(70*(i+1)/len(src))
            return output(jid,out)
        if op=="pdf-batch":
            out=d/"merged.pdf"; w=PdfWriter()
            for p in src:
                for page in PdfReader(p).pages: w.add_page(page)
            with open(out,"wb") as f:w.write(f)
            return output(jid,out)
        if op=="ocr":
            src0=src[0]; out=d/(src0.stem+".txt")
            run(["tesseract",str(src0),str(out.with_suffix(""))],timeout=900)
            return output(jid,out)
        if op=="office-convert":
            src0=src[0]; target=opts.get("format","pdf"); run(["libreoffice","--headless","--convert-to",target,"--outdir",str(d),str(src0)],timeout=900)
            out=next((p for p in d.iterdir() if p != src0 and p.suffix.lower()==("."+target.lower())),None)
            if not out: raise RuntimeError("LibreOffice did not produce the requested format")
            return output(jid,out)
        if op=="data-profile":
            out=data_profile(src[0],d/"omni-data-profile.json"); return output(jid,out)
        if op=="data-clean":
            out=d/("cleaned"+(".xlsx" if opts.get("format")=="xlsx" else ".csv")); clean_data(src[0],out,opts); return output(jid,out)
        if op=="archive" or op=="batch-pipeline":
            out=d/"omni-batch.zip"
            with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
                for p in src:z.write(p,p.name)
            return output(jid,out)
        if op=="diagnostics":
            out=d/"omni-diagnostics.json"
            data={"service":"omni-cloud-engine","tools":{}}
            for t in ["ffmpeg","libreoffice","pandoc","tesseract","qpdf","zip","7z"]: data["tools"][t]=bool(shutil.which(t))
            out.write_text(json.dumps(data,indent=2)); return output(jid,out)
        if op=="code-format":
            p=src[0]; text=p.read_text(errors="replace")
            if p.suffix.lower()==".json": text=json.dumps(json.loads(text),indent=2,ensure_ascii=False)
            elif p.suffix.lower() in [".js",".css",".html",".py"]: text=text.replace("\r\n","\n").strip()+"\n"
            out=d/(p.stem+".formatted"+p.suffix); out.write_text(text); return output(jid,out)
        if op=="metadata":
            out=d/"metadata.json"; out.write_text(json.dumps([{"name":p.name,"size":p.stat().st_size,"suffix":p.suffix} for p in src],indent=2)); return output(jid,out)
        if op=="sql-simulate":
            p=src[0]; df=pd.read_csv(p) if p.suffix.lower() not in [".xlsx",".xls"] else pd.read_excel(p)
            query=opts.get("query","SELECT * FROM data LIMIT 100")
            # Safe educational subset: SELECT columns, WHERE equality, LIMIT.
            m=re.match(r"\s*select\s+(.+?)\s+from\s+data(?:\s+where\s+(.+?))?(?:\s+limit\s+(\d+))?\s*$",query,re.I)
            if not m: raise RuntimeError("Only SELECT ... FROM data [WHERE ...] [LIMIT n] is supported in cloud SQL simulation.")
            cols=m.group(1).strip(); sub=df
            if m.group(2):
                wm=re.match(r"([\w ]+)\s*=\s*['\"]?([^'\"]+)['\"]?",m.group(2).strip())
                if wm: sub=sub[sub[wm.group(1).strip()].astype(str)==wm.group(2).strip()]
            if cols!="*": sub=sub[[c.strip() for c in cols.split(",")]]
            if m.group(3): sub=sub.head(int(m.group(3)))
            out=d/"sql-result.csv"; sub.to_csv(out,index=False); return output(jid,out)
        if op in ("rag-ingest","vector-search"):
            # Lightweight, dependency-free cloud knowledge index. For production pgvector,
            # configure a datastore later without changing this API.
            records=[]
            for p in src:
                text=p.read_text(errors="ignore") if p.suffix.lower() in [".txt",".md",".html",".json",".csv"] else ""
                chunks=[text[i:i+1200] for i in range(0,len(text),1000)] or [p.name]
                for i,ch in enumerate(chunks): records.append({"file":p.name,"chunk":i,"text":ch})
            out=d/"omni-knowledge.json"; out.write_text(json.dumps(records,ensure_ascii=False,indent=2))
            return output(jid,out)
        # generic file conversion / packaging
        out=d/"omni-output.zip"
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
            for p in src:z.write(p,p.name)
        return output(jid,out)
    except Exception as e:
        JOBS[jid].update(status="failed",progress=100,error=str(e))
        return jsonify(ok=False,job_id=jid,status="failed",error=str(e)),500

@app.get("/api/jobs/<jid>")
def job(jid):
    j=JOBS.get(jid)
    if not j:return jsonify(ok=False,error="Unknown job"),404
    return jsonify(ok=True,job=j)

if __name__=="__main__":
    app.run(host="0.0.0.0",port=int(os.getenv("PORT","10000")))
