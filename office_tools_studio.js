/* Redmark Forge — Office Tools powered by ONLYOFFICE Docs */
(function(){
  "use strict";
  const CLOUD=(window.OMNI_CLOUD_ENGINE_URL||"https://omni-cloud-engine.onrender.com").replace(/\/+$/,"");
  const token=()=>sessionStorage.getItem("omni-cloud-token")||"";
  const officeExt=new Set(["doc","docx","docm","dot","dotx","dotm","odt","ott","fodt","rtf","txt","md","markdown","html","htm","xhtml","xls","xlsx","xlsm","xlsb","xlt","xltx","xltm","ods","ots","fods","csv","tsv","ppt","pptx","pptm","pps","ppsx","pot","potx","potm","odp","otp","fodp","pdf"]);
  const ext=n=>String(n||"").split(".").pop().toLowerCase();
  const $=id=>document.getElementById(id);
  let editor=null,current=null,apiServer="",apiPromise=null,mode="word";

  const notify=(m,e=false)=>window.omniNotify?window.omniNotify(m,e):console.log(m);
  const setStatus=(m,kind="")=>{const el=$("ot-save-state");if(el){el.textContent=m;el.className="ot-save-state "+kind;}const s=$("ot-engine-status");if(s){s.textContent=m;s.className="ot-engine-status "+kind;}};

  function injectCss(){
    if($("redmark-onlyoffice-css"))return;
    const s=document.createElement("style");s.id="redmark-onlyoffice-css";
    s.textContent=""+
      "#ot-onlyoffice-host{height:calc(100vh - 250px);min-height:720px;background:#eef2f7;position:relative}"+
      "#ot-onlyoffice-placeholder{position:absolute;inset:0}"+
      ".ot-engine-landing{min-height:720px;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 20% 10%,rgba(108,92,255,.16),transparent 42%),radial-gradient(circle at 90% 90%,rgba(255,79,154,.12),transparent 42%),#f7f8fc}"+
      ".ot-engine-card{width:min(820px,100%);padding:34px;border:1px solid rgba(108,92,255,.16);border-radius:26px;background:rgba(255,255,255,.94);box-shadow:0 24px 70px -28px rgba(39,30,110,.3)}"+
      ".ot-engine-card h3{font-size:1.7rem;margin:0 0 8px;color:#1c1b3a}.ot-engine-card p{color:#66708a;line-height:1.6;margin:0 0 18px}"+
      ".ot-engine-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.ot-engine-grid button{border:1px solid #dce2ef;background:#fff;border-radius:13px;padding:13px 10px;font-weight:900;cursor:pointer;color:#343b5d}.ot-engine-grid button:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(70,55,150,.12)}"+
      ".ot-engine-meta{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.ot-engine-chip{padding:7px 10px;border-radius:999px;background:#f1efff;color:#5b4fd0;font-size:.74rem;font-weight:900}"+
      ".ot-engine-warning{padding:12px 14px;border-radius:13px;background:#fff7e8;color:#805500;font-size:.78rem;line-height:1.5;margin-top:16px}"+
      ".ot-note-local{min-height:720px;background:#fff}.ot-note-local textarea{width:100%;height:720px;border:0;outline:0;padding:28px;font:15px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace;resize:vertical;color:#0f172a}"+
      "@media(max-width:800px){#ot-onlyoffice-host{height:calc(100vh - 230px);min-height:640px}.ot-engine-grid{grid-template-columns:1fr 1fr}.ot-engine-card{padding:22px}.ot-engine-landing{min-height:640px}}";
    document.head.appendChild(s);
  }

  function currentKind(){return mode==="excel"?"excel":mode==="powerpoint"?"powerpoint":mode==="pdf"?"pdf":"word";}
  function setMode(next){
    mode=next;
    ["word","excel","powerpoint","pdf","notepad"].forEach(t=>$("ot-"+t)?.classList.toggle("active",t===next));
    const labels={word:"Word / Writer",excel:"Excel / Calc",powerpoint:"PowerPoint / Impress",pdf:"PDF / Forms",notepad:"Notepad"};
    if($("ot-mode-label"))$("ot-mode-label").textContent=labels[next];
    if(next==="notepad"){if(editor)destroy(false);$("ot-onlyoffice-host").style.display="none";$("ot-note-local").style.display="block";}
    else{$("ot-note-local").style.display="none";$("ot-onlyoffice-host").style.display="block";if(!current)landing();}
  }

  function landing(message){
    if(current)return;
    $("ot-onlyoffice-host").innerHTML='<div class="ot-engine-landing"><div class="ot-engine-card">'+
      '<div class="ot-kicker">REDMARK OFFICE ENGINE</div><h3>Full Office editing, not a mock toolbar.</h3>'+
      '<p>Open a Word, Excel, PowerPoint or PDF file and Redmark Forge will hand it to the real ONLYOFFICE editor. The editor provides the full ribbon, menus, formulas, slides, comments, review tools, printing, export and more.</p>'+
      '<div class="ot-engine-grid"><button data-new="word">＋ Word</button><button data-new="excel">＋ Excel</button><button data-new="powerpoint">＋ PowerPoint</button><button data-open="1">📂 Open Office File</button></div>'+
      '<div class="ot-engine-meta"><span class="ot-engine-chip">DOCX / DOC / ODT</span><span class="ot-engine-chip">XLSX / XLS / ODS / CSV</span><span class="ot-engine-chip">PPTX / PPT / ODP</span><span class="ot-engine-chip">PDF + forms</span></div>'+
      '<div class="ot-engine-warning">'+(message||"Office files are uploaded to the configured Redmark Forge Render storage bridge for editing. Your cloud token stays in this browser session.")+'</div>'+
      '</div></div>';
    $("ot-onlyoffice-host").querySelectorAll("[data-new]").forEach(b=>b.onclick=()=>newOffice(b.dataset.new));
    $("ot-onlyoffice-host").querySelector("[data-open]")?.addEventListener("click",openPicker);
  }

  function openPicker(){
    let i=$("ot-file");
    if(!i){
      i=document.createElement("input");i.type="file";i.id="ot-file";i.hidden=true;
      i.accept=".doc,.docx,.docm,.dot,.dotx,.dotm,.odt,.ott,.fodt,.rtf,.txt,.md,.markdown,.html,.htm,.xls,.xlsx,.xlsm,.xlsb,.xlt,.xltx,.xltm,.ods,.ots,.fods,.csv,.tsv,.ppt,.pptx,.pptm,.pps,.ppsx,.pot,.potx,.potm,.odp,.otp,.fodp,.pdf,*/*";
      document.body.appendChild(i);i.addEventListener("change",()=>openFile(i.files?.[0]));
    }
    i.value="";i.click();
  }

  function loadApi(server){
    if(window.DocsAPI)return Promise.resolve();
    if(apiPromise&&apiServer===server)return apiPromise;
    apiServer=server;
    apiPromise=new Promise((resolve,reject)=>{
      const s=document.createElement("script");s.src=server+"/web-apps/apps/api/documents/api.js";s.async=true;
      s.onload=()=>window.DocsAPI?resolve():reject(new Error("ONLYOFFICE API loaded but DocsAPI is unavailable."));
      s.onerror=()=>reject(new Error("Could not load ONLYOFFICE editor API from "+server));
      document.head.appendChild(s);
    });
    return apiPromise;
  }

  function destroy(showLanding=true){
    try{editor?.requestClose?.();}catch(_){}
    try{editor?.destroyEditor?.();}catch(_){}
    editor=null;
    if(showLanding){current=null;landing();}
  }

  function renderEditor(config){
    injectCss();
    $("ot-onlyoffice-host").innerHTML='<div id="ot-onlyoffice-placeholder"></div>';
    const events={
      onAppReady:()=>setStatus("✓ ONLYOFFICE editor ready","ok"),
      onDocumentStateChange:e=>setStatus(e?.data?"● Unsaved changes":"✓ Saved / ready",e?.data?"dirty":"ok"),
      onError:e=>setStatus("ONLYOFFICE error: "+(e?.data?.errorDescription||"Unknown error"),"error"),
      onRequestClose:()=>{try{editor?.destroyEditor?.();}catch(_){} editor=null;current=null;landing("Editor closed. The latest force-saved version remains available.");},
      onRequestSaveAs:e=>notify("Use ONLYOFFICE File → Save Copy as… for format conversion."),
      onUserActionRequired:e=>notify("ONLYOFFICE needs input before opening this file (for example password, encoding or delimiter)."),
      onDownloadAs:e=>{if(e?.data?.url)window.open(e.data.url,"_blank","noopener");}
    };
    config.events={...(config.events||{}),...events};
    editor=new window.DocsAPI.DocEditor("ot-onlyoffice-placeholder",config);
    setStatus("Loading full Office editor…");
  }

  async function authenticatedJson(url,options={}){
    const t=token();if(!t)throw new Error("Enter the Render cloud token first using the Run on Render control.");
    const headers={...(options.headers||{}),"X-Omni-Cloud-Token":t};
    const r=await fetch(url,{...options,headers});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j.ok===false)throw new Error(j.error||("HTTP "+r.status));
    return j;
  }

  async function openFile(file){
    if(!file)return;
    const e=ext(file.name);
    if(!officeExt.has(e)){setMode("notepad");$("ot-note-editor").value=await file.text();current=null;setStatus("✓ Opened as Notepad text","ok");return;}
    try{
      if(!token())throw new Error("Render cloud token is required for full Office editing.");
      setStatus("Uploading "+file.name+" to Office Engine…");
      const fd=new FormData();fd.append("file",file,file.name);
      const j=await authenticatedJson(CLOUD+"/api/office/upload",{method:"POST",body:fd});
      current=j;
      setMode(e==="pdf"?"pdf":/^(xls|xlsx|xlsm|xlsb|xlt|xltx|xltm|ods|ots|fods|csv|tsv)$/.test(e)?"excel":/^(ppt|pptx|pptm|pps|ppsx|pot|potx|potm|odp|otp|fodp)$/.test(e)?"powerpoint":"word");
      await loadApi(j.documentServer);renderEditor(j.config);notify("Opened "+file.name+" in the full ONLYOFFICE editor.");
    }catch(err){landing("Office Engine is not available yet. "+err.message);setStatus("✕ "+err.message,"error");notify(err.message,true);}
  }

  async function newOffice(kind){
    try{
      if(!token())throw new Error("Render cloud token is required for the Office Engine.");
      setStatus("Creating a new "+kind+" file…");
      const j=await authenticatedJson(CLOUD+"/api/office/new",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind})});
      current=j;setMode(kind==="excel"?"excel":kind==="powerpoint"?"powerpoint":"word");
      await loadApi(j.documentServer);renderEditor(j.config);notify("Created "+j.filename+".");
    }catch(err){landing("New Office files need the Office Engine. "+err.message);setStatus("✕ "+err.message,"error");notify(err.message,true);}
  }

  async function saveOffice(){
    if(!current?.fileId)return notify("No Office document is open.");
    try{setStatus("Saving current Office document…");const j=await authenticatedJson(CLOUD+"/api/office/force-save/"+encodeURIComponent(current.fileId),{method:"POST"});if(j.result?.error)throw new Error("ONLYOFFICE returned error "+j.result.error);setStatus("✓ Save requested; Office Engine is compiling the current version.","ok");}
    catch(err){setStatus("✕ Save failed: "+err.message,"error");notify(err.message,true);}
  }

  async function downloadOffice(){
    if(!current?.config?.document?.url)return notify("No Office document is open.");
    try{const r=await fetch(current.config.document.url);if(!r.ok)throw new Error("Download HTTP "+r.status);const b=await r.blob();const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=current.filename||current.config.document.title||"office-file";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),30000);}
    catch(err){notify("Download failed: "+err.message,true);}
  }

  function newNote(){current=null;setMode("notepad");$("ot-note-editor").value="";$("ot-note-editor").focus();setStatus("✓ New Notepad file","ok");}
  function saveNote(asName){const name=asName||"Untitled.txt";const blob=new Blob([$("ot-note-editor").value],{type:"text/plain;charset=utf-8"});const u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),30000);setStatus("✓ Saved "+name,"ok");}

  function wire(){
    injectCss();
    ["word","excel","powerpoint","pdf","notepad"].forEach(t=>$("ot-"+t)?.addEventListener("click",()=>setMode(t)));
    $("ot-open")?.addEventListener("click",openPicker);
    $("ot-new")?.addEventListener("click",()=>mode==="notepad"?newNote():newOffice(currentKind()));
    $("ot-save")?.addEventListener("click",()=>mode==="notepad"?saveNote():saveOffice());
    $("ot-saveas")?.addEventListener("click",()=>mode==="notepad"?saveNote(prompt("Save Notepad file as — any extension is allowed","Untitled.txt")):notify("Use ONLYOFFICE File → Save Copy as… for Save As / format conversion."));
    $("ot-print")?.addEventListener("click",()=>mode==="notepad"?window.print():notify("Use the full ONLYOFFICE File → Print command."));
    $("ot-download")?.addEventListener("click",downloadOffice);
    $("ot-close")?.addEventListener("click",()=>destroy(true));
    $("ot-note-new")?.addEventListener("click",newNote);
    $("ot-note-open")?.addEventListener("click",openPicker);
    $("ot-note-save")?.addEventListener("click",()=>saveNote());
    $("ot-note-saveas")?.addEventListener("click",()=>saveNote(prompt("Save text file as — any extension is allowed","Untitled.txt")));
    $("ot-note-editor")?.addEventListener("input",()=>setStatus("● Unsaved Notepad changes","dirty"));
    setMode("word");landing();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",wire,{once:true});else wire();
  window.RedmarkOfficeTools={openFile,newOffice,saveOffice,downloadOffice,destroy};
})();