import os, io, json, csv, zipfile, tarfile, gzip, shutil, subprocess, tempfile, uuid, re, math, mimetypes, sqlite3, ipaddress, socket, time, urllib.request, urllib.error
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, request, jsonify, send_file
from secrets import compare_digest
from flask_cors import CORS
import pandas as pd
from PIL import Image
from pypdf import PdfReader, PdfWriter
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

app=Flask(__name__)
ALLOWED_ORIGINS={x.strip().rstrip("/") for x in os.getenv(
    "CLOUD_ALLOWED_ORIGINS",
    "https://theraghavraman.github.io,http://127.0.0.1:8765,http://localhost:8765"
).split(",") if x.strip()}
CORS(app, resources={r"/api/*":{"origins":sorted(ALLOWED_ORIGINS),"allow_headers":["Content-Type","X-Omni-Cloud-Token"]}})
app.config["MAX_CONTENT_LENGTH"]=int(os.getenv("MAX_UPLOAD_MB","500"))*1024*1024
ROOT=Path(tempfile.gettempdir())/"omni-cloud-jobs"; ROOT.mkdir(exist_ok=True)
JOBS={}
MAX_JOBS=int(os.getenv("MAX_JOBS","25"))
JOB_TTL=int(os.getenv("JOB_TTL_SECONDS","3600"))
RATE_LIMIT=int(os.getenv("RATE_LIMIT_PER_MINUTE","12"))
RATE_WINDOW=60
RATE_BUCKET={}
CLOUD_TOKEN=os.getenv("OMNI_CLOUD_TOKEN","").strip()

SOCIAL_HOSTS={
    "youtube.com","youtu.be","instagram.com","facebook.com","fb.watch","tiktok.com",
    "x.com","twitter.com","pinterest.com","pin.it","reddit.com","linkedin.com",
    "threads.net","threads.com","snapchat.com","telegram.me","t.me","twitch.tv",
    "vimeo.com","dailymotion.com","tumblr.com","bsky.app","mastodon.social",
    "weibo.com","likee.video","rumble.com"
}

def request_origin():
    return (request.headers.get("Origin") or "").rstrip("/")

def cloud_authorized():
    if not CLOUD_TOKEN:
        return False, (jsonify(ok=False,error="Cloud Engine is not configured. Set OMNI_CLOUD_TOKEN on the Render service."), 503)
    supplied=request.headers.get("X-Omni-Cloud-Token","")
    if not compare_digest(supplied,CLOUD_TOKEN):
        return False, (jsonify(ok=False,error="Missing or invalid cloud-engine token."), 401)
    origin=request_origin()
    if origin and origin not in ALLOWED_ORIGINS:
        return False, (jsonify(ok=False,error="Origin not allowed."), 403)
    return True, None

def rate_allowed():
    key=request.headers.get("X-Forwarded-For","").split(",")[0].strip() or request.remote_addr or "unknown"
    now=time.time()
    bucket=RATE_BUCKET.get(key,[])
    bucket=[t for t in bucket if now-t<RATE_WINDOW]
    if len(bucket)>=RATE_LIMIT:
        RATE_BUCKET[key]=bucket
        return False
    bucket.append(now); RATE_BUCKET[key]=bucket
    return True

def prune_jobs():
    cutoff=time.time()-JOB_TTL
    for jid,j in list(JOBS.items()):
        if float(j.get("created_at",0))<cutoff and j.get("status") in {"ready","failed"}:
            JOBS.pop(jid,None)
    for key,values in list(RATE_BUCKET.items()):
        fresh=[t for t in values if time.time()-t<RATE_WINDOW]
        if fresh: RATE_BUCKET[key]=fresh
        else: RATE_BUCKET.pop(key,None)

def job_new(kind):
    prune_jobs()
    if len(JOBS)>=MAX_JOBS:
        raise RuntimeError("Cloud job queue is full. Retry after existing jobs expire.")
    jid=uuid.uuid4().hex
    JOBS[jid]={"id":jid,"status":"processing","kind":kind,"progress":5,"created_at":time.time()}
    return jid

def run(cmd, cwd=None, timeout=900):
    p=subprocess.run(cmd,cwd=cwd,capture_output=True,text=True,timeout=timeout)
    if p.returncode: raise RuntimeError((p.stderr or p.stdout or "command failed")[-4000:])
    return p
def save_upload(f, d):
    name=Path(f.filename or "input.bin").name
    p=d/name; f.save(p); return p

def public_social_url(value):
    try:
        parsed=urlparse(value)
        if parsed.scheme not in {"http","https"} or not parsed.hostname:
            raise ValueError("Only HTTP(S) public social URLs are supported.")
        host=parsed.hostname.lower().rstrip(".")
        if not any(host==allowed or host.endswith("."+allowed) for allowed in SOCIAL_HOSTS):
            raise ValueError("Social batch URL host is not in the allowed public-platform list.")
        try:
            infos=socket.getaddrinfo(host,443,type=socket.SOCK_STREAM)
            for item in infos:
                ip=ipaddress.ip_address(item[4][0])
                if not ip.is_global:
                    raise ValueError("Social batch URL resolves to a non-public IP address.")
        except socket.gaierror as exc:
            raise ValueError("Social batch URL host could not be resolved.") from exc
        return value
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Invalid social batch URL.") from exc

@app.get("/api/health")
def health():
    ff=shutil.which("ffmpeg")
    lo=shutil.which("libreoffice")
    pd=shutil.which("pandoc")
    return jsonify(ok=True,service="omni-cloud-engine",version="1.0",tools={"ffmpeg":bool(ff),"libreoffice":bool(lo),"pandoc":bool(pd),"yt-dlp":bool(shutil.which("yt-dlp"))})

@app.get("/api/capabilities")
def capabilities():
    return jsonify({
      "execution_modes":["browser","render","local"],
      "studios":["Social Media","PDF","Doc/Office","Universal Data","Data Cleaning","Database","RAG","Vector Search","Code","Image","Video","Compressor","Batch Processing","Diagnostics","Scheduled Automation","Cloud Jobs"],
      "operations":[
        "ffmpeg","media-transcode","image-batch","pdf-batch","ocr","office-convert","data-profile","data-clean","sql-simulate",
        "rag-ingest","vector-search","archive","batch-pipeline","diagnostics","code-format","code-clean","metadata","file-convert","social-batch","scheduled-pipeline"
      ]
    })

def output(jid,path,name=None,mime=None):
    JOBS[jid].update(status="ready",progress=100,filename=name or path.name)
    response=send_file(path,as_attachment=True,download_name=name or path.name,mimetype=mime)
    job_dir=Path(path).parent
    response.call_on_close(lambda: shutil.rmtree(job_dir,ignore_errors=True))
    return response

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

@app.post("/api/ai/generate")
def ai_generate():
    ok,denial=cloud_authorized()
    if not ok: return denial
    if not rate_allowed():
        return jsonify(ok=False,error="Rate limit exceeded. Retry shortly."),429
    payload=request.get_json(silent=True) or {}
    question=str(payload.get("question","")).strip()
    context=str(payload.get("context","")).strip()
    if not question or not context:
        return jsonify(ok=False,error="Both question and retrieved context are required."),400
    if len(question)>4000 or len(context)>24000:
        return jsonify(ok=False,error="Question or retrieved context exceeds the configured limit."),413
    api_key=os.getenv("OMNI_LLM_API_KEY","").strip()
    model=os.getenv("OMNI_LLM_MODEL","").strip()
    base=os.getenv("OMNI_LLM_BASE_URL","https://api.openai.com/v1").strip().rstrip("/")
    if not api_key or not model:
        return jsonify(ok=False,error="Cloud generation is not configured. Set OMNI_LLM_API_KEY and OMNI_LLM_MODEL on Render; OMNI_LLM_BASE_URL is optional."),503
    endpoint=base if base.endswith("/chat/completions") else base+"/chat/completions"
    prompt=("Answer using only the retrieved evidence. If the evidence does not support an answer, say you do not know. Cite claims as [Source N].\\n\\nRETRIEVED EVIDENCE:\\n"+context+"\\n\\nQUESTION:\\n"+question)
    body=json.dumps({"model":model,"messages":[
        {"role":"system","content":"You are Omni RAG. Ground every factual claim in the provided evidence. Do not invent facts; cite source numbers."},
        {"role":"user","content":prompt}
    ],"temperature":0.1,"max_tokens":700}).encode("utf-8")
    req=urllib.request.Request(endpoint,data=body,headers={"Authorization":"Bearer "+api_key,"Content-Type":"application/json","Accept":"application/json"})
    try:
        with urllib.request.urlopen(req,timeout=int(os.getenv("OMNI_LLM_TIMEOUT_SECONDS","90"))) as response:
            result=json.loads(response.read().decode("utf-8"))
        answer=str((((result.get("choices") or [{}])[0]).get("message") or {}).get("content") or "").strip()
        if not answer:
            return jsonify(ok=False,error="Configured LLM returned an empty answer."),502
        return jsonify(ok=True,text=answer,provider="render",model=model)
    except urllib.error.HTTPError as exc:
        detail=""
        try: detail=exc.read(1200).decode("utf-8","replace")
        except Exception: pass
        return jsonify(ok=False,error="Configured LLM returned HTTP "+str(exc.code)+((": "+detail[:800]) if detail else "")),502
    except Exception as exc:
        return jsonify(ok=False,error="Cloud LLM request failed: "+str(exc)[:500]),502

@app.post("/api/process")
def process():
    prune_jobs()
    ok,denial=cloud_authorized()
    if not ok: return denial
    if not rate_allowed():
        return jsonify(ok=False,error="Rate limit exceeded. Retry shortly."),429
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
        if op=="code-clean":
            p=src[0]; text=p.read_text(errors="replace").replace("\r\n","\n").replace("\r","\n")
            ext=p.suffix.lower()
            if ext==".json":
                text=json.dumps(json.loads(text),indent=2,ensure_ascii=False)+"\n"
            else:
                lines=text.split("\n")
                lines=[re.sub(r"[ \t]+$","",line) for line in lines]
                while lines and not lines[-1].strip(): lines.pop()
                text="\n".join(lines)+"\n"
            out=d/(p.stem+".cleaned"+p.suffix); out.write_text(text,encoding="utf-8"); return output(jid,out)

        if op=="code-format":
            p=src[0]; text=p.read_text(errors="replace")
            if p.suffix.lower()==".json": text=json.dumps(json.loads(text),indent=2,ensure_ascii=False)
            elif p.suffix.lower() in [".js",".css",".html",".py"]: text=text.replace("\r\n","\n").strip()+"\n"
            out=d/(p.stem+".formatted"+p.suffix); out.write_text(text); return output(jid,out)
        if op=="metadata":
            out=d/"metadata.json"; out.write_text(json.dumps([{"name":p.name,"size":p.stat().st_size,"suffix":p.suffix} for p in src],indent=2)); return output(jid,out)
        if op=="sql-simulate":
            db=sqlite3.connect(d/"omni.sqlite")
            for p in src:
                table=re.sub(r"\W+","_",p.stem).strip("_") or "data"
                if p.suffix.lower() in [".xlsx",".xls"]: df=pd.read_excel(p)
                elif p.suffix.lower() in [".jsonl",".ndjson"]: df=pd.read_json(p,lines=True)
                else: df=pd.read_csv(p)
                df.to_sql(table,db,index=False,if_exists="replace")
            query=opts.get("query","SELECT * FROM "+re.sub(r"\W+","_",src[0].stem)+" LIMIT 100")
            if not re.match(r"\s*select\b",query,re.I): raise RuntimeError("Cloud SQL simulation only permits SELECT statements.")
            df=pd.read_sql_query(query,db); db.close()
            out=d/"sql-result.csv"; df.to_csv(out,index=False); return output(jid,out)
        if op in ("rag-ingest","vector-search"):
            records=[]
            for p in src:
                text=p.read_text(errors="ignore") if p.suffix.lower() in [".txt",".md",".html",".json",".csv",".jsonl",".ndjson"] else ""
                chunks=[text[i:i+1400] for i in range(0,len(text),1100)] or [p.name]
                for i,ch in enumerate(chunks): records.append({"file":p.name,"chunk":i,"text":ch})
            if op=="vector-search" and opts.get("query"):
                corpus=[r["text"] for r in records]; q=str(opts["query"])
                vec=TfidfVectorizer(stop_words="english"); mat=vec.fit_transform(corpus+[q]); scores=cosine_similarity(mat[-1],mat[:-1]).ravel()
                for r,score in zip(records,scores): r["score"]=round(float(score),6)
                records=sorted(records,key=lambda x:x.get("score",0),reverse=True)[:int(opts.get("top_k",10))]
            out=d/"omni-knowledge.json"; out.write_text(json.dumps(records,ensure_ascii=False,indent=2)); return output(jid,out)
        if op=="social-batch":
            out=d/"social-results.json"; results=[]
            for i,p in enumerate(src):
                u=p.read_text(errors="ignore").strip() if p.suffix.lower()==".txt" else str(opts.get("url",""))
                if not u: continue
                u=public_social_url(u)
                try: results.append(json.loads(run(["yt-dlp","--dump-single-json","--skip-download","--no-playlist",u],timeout=180).stdout))
                except Exception as ex: results.append({"url":u,"error":str(ex)})
                JOBS[jid]["progress"]=20+int(70*(i+1)/len(src))
            out.write_text(json.dumps(results,ensure_ascii=False,indent=2)); return output(jid,out)
        if op=="scheduled-pipeline":
            out=d/"scheduled-report.json"; out.write_text(json.dumps({"status":"ready","inputs":[p.name for p in src]},indent=2)); return output(jid,out)
        # generic file conversion / packaging
        out=d/"omni-output.zip"
        with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:
            for p in src:z.write(p,p.name)
        return output(jid,out)
    except Exception as e:
        JOBS[jid].update(status="failed",progress=100,error=str(e))
        shutil.rmtree(d,ignore_errors=True)
        return jsonify(ok=False,job_id=jid,status="failed",error=str(e)),500

@app.get("/api/jobs/<jid>")
def job(jid):
    ok,denial=cloud_authorized()
    if not ok: return denial
    j=JOBS.get(jid)
    if not j:return jsonify(ok=False,error="Unknown job"),404
    return jsonify(ok=True,job=j)

if __name__=="__main__":
    app.run(host="0.0.0.0",port=int(os.getenv("PORT","10000")))
